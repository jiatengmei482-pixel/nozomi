/**
 * M4-29：客户改单要供应商确认，改单和取消都通知供应商和司机（ADR 0060）。真实 PostgreSQL + 本机假 SMTP；收款服务用替身。全部数据在测试里构造，都是虚构的。
 * 覆盖：确认前原预约有效；联系信息直接生效；通知（供应商、司机、客人）、免打扰、手动模式、没邮箱；待办和角标；同意 / 拒绝 / 调整中 / 代处理；
 * 差价退回；库存；超时边界和提醒；已不适用；救援；所有取消入口的通知；并发；规则 4；没权限。跨租户见 tenant-isolation.itest.ts。
 */
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DEFAULT_CANCELLATION_POLICY, applyBasisPoints } from "@nozomi/domain";
import { TEST_PASSWORD, type TenantFixture, type TestApi, createTestApi } from "./testing/api.ts";
import { assign, newDriver, newVehicle } from "./testing/dispatch.ts";
import { type FakeSmtp, type FakeSmtpMessage, decodedMailText, startFakeSmtp } from "./testing/fake-integrations.ts";
import { type Market, addStaff, buildMarket, ok } from "./testing/market.ts";
import { platformLogin, tenantLogin } from "./testing/money.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";
import { FakePaymentProvider } from "./testing/payments.ts";
import { type SalesFlow, salesFlow } from "./testing/sales-flow.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const tokyoDate = (ms: number): string => new Date(ms + 9 * HOUR).toISOString().slice(0, 10);
/** 乙的商务 7 座 19,800 → 对外价 21,780（默认加价 10%）；调价日 +20% → 23,760 → 26,136 */
const SELL = applyBasisPoints(19_800, 1_000);
const SURGE_SELL = applyBasisPoints(23_760, 1_000);
const GUEST_NAME = "王小明";
const GUEST_PHONE = "+819012345678";
const GUEST_EMAIL = "guest@example.com";

let api: TestApi;
let m: Market;
let pay: FakePaymentProvider;
let flow: SalesFlow;
let smtp: FakeSmtp;
let b: TenantFixture;
let ops: string;
const serviceEmail = "service.fictional@platform.test";

before(async () => {
  smtp = await startFakeSmtp();
  pay = new FakePaymentProvider();
  api = await createTestApi({
    payments: pay,
    env: { SMTP_HOST: smtp.host, SMTP_PORT: String(smtp.port), SMTP_ENCRYPTION: "none", SMTP_USERNAME: "mailer", SMTP_PASSWORD: "fake-smtp-password-Zq7", SMTP_FROM_NAME: "NOZOMI", SMTP_FROM_ADDRESS: "noreply@example.test" },
    integrationSecretsTtlMs: 0,
  });
  m = await buildMarket(api);
  flow = await salesFlow(api, m, pay);
  b = { ...m.b, adminToken: await tenantLogin(api, m.b.adminEmail) };
  // 接送机 · 商务：任何时候取消都免费（要测「进了 24 小时还能提」）
  await addStaff(api, m.root, serviceEmail, "customer_service");
  const ops2 = await addStaff(api, m.root, "ops2@platform.test", "operations");
  const rules = DEFAULT_CANCELLATION_POLICY.map((rule) => ({ category: rule.category, level: rule.level, tiers: rule.tiers.map((tier) => ({ min_hours_before: tier.minHoursBefore, fee_bp: rule.category === "airport_transfer" ? 0 : tier.feeBp })) }));
  const requested = await ok(api.call("POST", "/platform/v1/cancellation-policy/changes", { token: m.staff.operations.token, body: { rules } }), 202);
  await ok(api.call("POST", `/platform/v1/approvals/${requested.approval.id}/approve`, { token: ops2.token, body: {} }));
});
after(async () => {
  await api.close();
  await smtp.close();
});

beforeEach(async () => {
  await api.db.owner.query("update notification_events set expanded_at = coalesce(expanded_at, now())");
  await api.db.owner.query("update notifications set status = 'expired', last_error_code = 'ORDER_STATE_CHANGED', lease_token = null, lease_until = null where status in ('pending', 'sending')");
  await api.db.owner.query("update tenant_notification_settings set driver_link_delivery = 'auto', quiet_start = null, quiet_end = null");
  await api.db.owner.query("update order_changes set status = 'cancelled', decided_at = now() where status in ('awaiting_payment', 'pending_confirmation', 'adjusting')");
  api.clock.advance(HOUR);
  b.adminToken = await tenantLogin(api, m.b.adminEmail);
  ops = await platformLogin(api, m.staff.operations.email);
  smtp.reset();
});

/** 东京 10:00 的第 n 天之后。每个用例按现在往后挑，彼此不碰调价日。 */
const dayAhead = (days: number): number => Math.ceil(api.clock.now().getTime() / DAY) * DAY + HOUR + days * DAY;
const fictionalEmail = (): string => `fictional.driver.${randomUUID().slice(0, 8)}@example.test`;
const tick = () => api.app.notificationJobs.tick();
const texts = (mails: readonly FakeSmtpMessage[]): string => mails.map((mail) => decodedMailText(mail.data)).join("\n");
const mailsTo = (email: string): FakeSmtpMessage[] => smtp.messages.filter((mail) => mail.to.includes(email));
const tokenInMail = (text: string): string | null => /\/driver#(nzd_[A-Za-z0-9_.-]+)/.exec(text)?.[1] ?? null;

async function dispatched(serviceMs = dayAhead(10), driverExtra?: Record<string, unknown>): Promise<{ order: any; driver: any; email: string; token: string }> {
  const order = await flow.paidOrder({ serviceTime: iso(serviceMs) });
  const email = fictionalEmail();
  const driver = await newDriver(api, b, driverExtra ?? { email });
  const vehicle = await newVehicle(api, b, m.ids.biz7);
  const res = await ok(assign(api, b, order.id, driver.id, vehicle.id));
  await tick();
  smtp.reset();
  return { order, driver, email, token: res.driver_link.token };
}

async function salesGet(orderId: string): Promise<any> {
  api.clock.advance(1_000);
  return (await ok(api.call("GET", `/sales/v1/orders/${orderId}`, { token: await flow.token() }))).order;
}

async function patch(orderId: string, body: Record<string, unknown>): Promise<any> {
  const version = (await salesGet(orderId)).version;
  api.clock.advance(1_000);
  return api.call("PATCH", `/sales/v1/orders/${orderId}`, { token: await flow.token(), headers: { "if-match": `"${version}"` }, body });
}

const tenantDecide = (orderId: string, changeId: string, decision: "confirm" | "reject" | "adjusting", body: Record<string, unknown> = {}, token = b.adminToken) => api.call("POST", `/tenant/v1/orders/${orderId}/changes/${changeId}/${decision}`, { token, body });
const platformDecide = (orderId: string, changeId: string, decision: "confirm" | "reject" | "adjusting", note = "电话联系过供应商", token = ops) => api.call("POST", `/platform/v1/orders/${orderId}/changes/${changeId}/${decision}`, { token, body: { note } });
const todos = async (): Promise<any> => ok(api.call("GET", "/tenant/v1/order-todos", { token: b.adminToken }));
const todosOf = async (orderId: string): Promise<any[]> => (await todos()).items.filter((item: any) => item.order_id === orderId);

async function surge(day: string): Promise<void> {
  const version = (await ok(api.call("GET", `/tenant/v1/products/${m.ids.pb}`, { token: b.adminToken }))).version;
  await ok(api.call("POST", `/tenant/v1/products/${m.ids.pb}/adjust-rules`, { token: b.adminToken, headers: { "if-match": `"${version}"`, "idempotency-key": randomUUID() }, body: { name: `临时 ${day}`, travel_from: day, travel_to: day, cycle: { type: "daily" }, vehicle_group_ids: [m.ids.biz7], steps: [{ type: "percent", value: 2_000 }] } }), 201);
}

const assertNoGuestInfo = (text: string, order: any): void => {
  for (const secret of [GUEST_NAME, GUEST_PHONE, GUEST_EMAIL, order.dropoff.address, "19800", String(SELL), "19,800", "21,780"]) assert.ok(!text.includes(secret), `司机邮件里不能有：${secret}`);
};

test("关键流程：改时间 → 订单待确认、原时间不变 → 供应商收到邮件和待办、司机收到提醒 → 同意 → 订单更新、司机收到新链接、客人收到结果", async () => {
  const oldAt = dayAhead(10);
  const newAt = dayAhead(12);
  const { order, email, token } = await dispatched(oldAt);
  const res = await patch(order.id, { service_time: iso(newAt) });
  assertMatchesOpenApi("PATCH", "/sales/v1/orders/{id}", res);
  assert.equal(res.status, 200, res.text);
  assert.deepEqual([res.body.change.status, res.body.order.service_time, res.body.order.price.total.amount], ["pending_confirmation", order.service_time, order.price.total.amount], "确认前原预约有效");
  const changeId = res.body.change.id;

  await tick();
  const tenantMails = mailsTo(m.b.adminEmail);
  assert.equal(tenantMails.length, 1);
  const tenantText = texts(tenantMails);
  assert.match(tenantText, /客人申请修改订单/);
  assert.match(tenantText, /需调整司机/);
  assert.match(tenantText, /用车时间/);
  for (const secret of [String(SELL), "21,780", "对外价", "加价"]) assert.ok(!tenantText.includes(secret), secret);
  const driverText = texts(mailsTo(email));
  assert.match(driverText, /按原任务执行/);
  assert.equal(tokenInMail(driverText), null, "这封不带链接");
  assertNoGuestInfo(driverText, order);
  assert.equal(mailsTo(GUEST_EMAIL).length, 0, "官网单才发客人；销售端的单由渠道发");

  const list = await api.call("GET", "/tenant/v1/orders?change=pending", { token: b.adminToken });
  assertMatchesOpenApi("GET", "/tenant/v1/orders", list);
  assert.deepEqual(list.body.items.map((item: any) => [item.id, item.pending_change]), [[order.id, true]]);
  const board = await api.call("GET", "/tenant/v1/order-todos", { token: b.adminToken });
  assertMatchesOpenApi("GET", "/tenant/v1/order-todos", board);
  assert.equal(board.body.change_requests, 1);
  assert.deepEqual([board.body.items[0].kind, board.body.items[0].needs_driver_adjustment, board.body.items[0].driver_notice, board.body.items[0].fields], ["change_request", true, "email", ["service_time"]]);
  assert.equal((await api.call("GET", "/driver/v1/trip", { token })).body.pending_change.fields[0], "service_time", "司机页提示");

  smtp.reset();
  const confirmed = await tenantDecide(order.id, changeId, "confirm");
  assertMatchesOpenApi("POST", "/tenant/v1/orders/{id}/changes/{changeId}/confirm", confirmed);
  assert.deepEqual([confirmed.status, confirmed.body.change.status], [200, "applied"]);
  assert.equal((await salesGet(order.id)).service_time, new Date(newAt).toISOString());
  assert.deepEqual((await todosOf(order.id)).map((item) => item.kind), ["change_applied"], "要决定的那条关掉，留一条提醒调整司机");
  await tick();
  const updated = texts(mailsTo(email));
  assert.match(updated, /任务有更新/);
  const emailToken = tokenInMail(updated);
  assert.ok(emailToken, "这封带新链接");
  assertNoGuestInfo(updated.replace(emailToken, ""), order);
  const opened = await api.call("GET", "/driver/v1/trip", { token: emailToken });
  assert.deepEqual([opened.status, opened.body.order.service_time, opened.body.pending_change], [200, new Date(newAt).toISOString(), null]);
  assert.match(texts(mailsTo(m.b.adminEmail)), /这张订单有修改/);
  const leaked = await api.db.owner.query("select count(*)::int as n from notifications n join notification_events e on e.id = n.event_id where e.order_id = $1 and e.data::text like $2", [order.id, `%${emailToken}%`]);
  assert.equal(leaked.rows[0].n, 0, "令牌不进发件箱");
});

test("联系信息直接生效并通知（司机收到带链接的邮件，邮件里没有新内容）；有申请没结论时联系信息照改，履约字段 409", async () => {
  const { order, email } = await dispatched();
  const direct = await patch(order.id, { passenger: { name: "李虚构", phone: "+81 80-1111-2222", email: "changed@example.test" }, notes: "带婴儿车" });
  assert.deepEqual([direct.status, direct.body.change.status, direct.body.order.passenger.name, direct.body.order.notes], [200, "applied", "李虚构", "带婴儿车"]);
  await tick();
  const tenantText = texts(mailsTo(m.b.adminEmail));
  assert.match(tenantText, /这张订单有修改/);
  assert.doesNotMatch(tenantText, /需调整司机/, "联系信息不用调整司机");
  const driverText = texts(mailsTo(email));
  assert.ok(tokenInMail(driverText));
  for (const secret of ["李虚构", "+818011112222", "changed@example.test", "带婴儿车"]) assert.ok(!driverText.includes(secret), secret);
  assert.deepEqual((await todosOf(order.id)).map((item) => [item.kind, item.needs_driver_adjustment]), [["contact_changed", false]]);

  const pending = await patch(order.id, { passengers: 3 });
  assert.equal(pending.body.change.status, "pending_confirmation");
  assert.equal((await patch(order.id, { luggage: 3 })).body.error.code, "CHANGE_IN_PROGRESS");
  assert.equal((await patch(order.id, { notes: "再改备注" })).status, 200);
  assert.equal((await salesGet(order.id)).passengers, 2, "人数还是原来的");
});

test("拆开提交：报价失败时联系信息也不生效（同一个事务）", async () => {
  const { order } = await dispatched();
  const res = await patch(order.id, { notes: "不该生效", service_time: iso(api.clock.now().getTime() + 2 * HOUR) });
  assert.deepEqual([res.status, res.body.error.code], [409, "CHANGE_NOT_SERVICEABLE"]);
  const now = await salesGet(order.id);
  assert.deepEqual([now.notes, now.changes.length], [order.notes, 0]);
});

test("免打扰不影响：改单、申请、取消都马上发", async () => {
  const { order } = await dispatched(dayAhead(20));
  const local = new Date(api.clock.now().getTime() + 9 * HOUR);
  const pad = (n: number): string => String(n).padStart(2, "0");
  const start = `${pad(local.getUTCHours())}:00`;
  const end = `${pad((local.getUTCHours() + 2) % 24)}:00`;
  await api.db.owner.query("update tenant_notification_settings set quiet_start = $2, quiet_end = $3 where tenant_id = $1", [b.tenantId, start, end]);
  const inserted = await api.db.owner.query("select 1 from tenant_notification_settings where tenant_id = $1", [b.tenantId]);
  if (inserted.rowCount === 0) await api.db.owner.query("insert into tenant_notification_settings (tenant_id, quiet_start, quiet_end, updated_at) values ($1, $2, $3, now())", [b.tenantId, start, end]);
  await patch(order.id, { notes: "x" });
  await patch(order.id, { passengers: 3 });
  api.clock.advance(1_000);
  await ok(api.call("POST", `/sales/v1/orders/${order.id}/cancel`, { token: await flow.token(), body: {} }));
  await tick();
  const held = await api.db.owner.query("select event, status, last_error_code from notifications where order_id = $1 and audience = 'tenant' and last_error_code = 'QUIET_HOURS'", [order.id]);
  assert.deepEqual(held.rows, []);
  const sent = await api.db.owner.query("select event, status from notifications where order_id = $1 and audience = 'tenant' and event in ('order.changed', 'order.cancelled') and status = 'sent'", [order.id]);
  assert.deepEqual(sent.rows.map((row) => row.event).sort(), ["order.cancelled", "order.changed"]);
});

test("拒绝：原因必填；差价退回；免费取消；结果说清楚；司机按原任务；原因不给客人看", async () => {
  const oldAt = dayAhead(30);
  const newAt = oldAt + 2 * DAY;
  await surge(tokyoDate(newAt));
  const { order, email, token } = await dispatched(oldAt);
  const res = await patch(order.id, { service_time: iso(newAt) });
  assert.deepEqual([res.body.change.status, res.body.change.price_difference.amount.amount], ["pending_confirmation", String(SURGE_SELL - SELL)]);
  assert.equal(pay.chargesOf(order.id).length, 1, "先扣差价");
  const changeId = res.body.change.id;
  assert.equal((await tenantDecide(order.id, changeId, "reject", {})).status, 400, "原因必填");
  assert.equal((await tenantDecide(order.id, changeId, "reject", { note: "   " })).status, 400);
  const SECRET_REASON = "结算价太低不想跑";
  const rejected = await tenantDecide(order.id, changeId, "reject", { note: SECRET_REASON });
  assertMatchesOpenApi("POST", "/tenant/v1/orders/{id}/changes/{changeId}/reject", rejected);
  assert.deepEqual([rejected.status, rejected.body.change.status, rejected.body.change.decision_note], [200, "rejected", SECRET_REASON]);
  assert.deepEqual(pay.refundsOf(order.id).map((refund) => refund.amountMinor), [SURGE_SELL - SELL], "差价退回");
  const now = await salesGet(order.id);
  assert.deepEqual([now.service_time, now.price.total.amount, now.free_cancel_available, now.changes[0].status], [order.service_time, order.price.total.amount, true, "rejected"]);
  assert.ok(!JSON.stringify(now).includes(SECRET_REASON), "拒绝原因不给渠道");
  await tick();
  assert.match(texts(mailsTo(email)), /按原任务执行/);
  assert.equal((await api.call("GET", "/driver/v1/trip", { token })).status, 200, "原来的链接还能用");
  assert.deepEqual(await todosOf(order.id), [], "供应商自己拒绝的不用再提醒");
  await ok(api.call("POST", `/sales/v1/orders/${order.id}/cancel`, { token: await flow.token(), body: { reason: "CHANGE_NOT_CONFIRMED" } }));
});

test("只改航班号的被拒：不给免费取消（它能在免费取消期外提交）", async () => {
  const { order } = await dispatched();
  const res = await patch(order.id, { flight_no: "JL5" });
  assert.equal(res.body.change.status, "pending_confirmation");
  await ok(tenantDecide(order.id, res.body.change.id, "reject", { note: "这个航班接不了" }));
  const now = await salesGet(order.id);
  assert.deepEqual([now.flight_no, now.free_cancel_available], ["NH211", false]);
  assert.equal((await api.call("POST", `/sales/v1/orders/${order.id}/cancel`, { token: await flow.token(), body: { reason: "CHANGE_NOT_CONFIRMED" } })).body.error.code, "FREE_CANCEL_NOT_APPLICABLE");
});

test("调整中：只能标一次；远期期限变成 24 小时内；到期记没确认、差价退回；要决定的待办一直在；客人看得到状态", async () => {
  const oldAt = dayAhead(40);
  const newAt = oldAt + 2 * DAY;
  await surge(tokyoDate(newAt));
  const { order } = await dispatched(oldAt);
  const res = await patch(order.id, { service_time: iso(newAt) });
  const changeId = res.body.change.id;
  assert.equal(Date.parse(res.body.change.confirm_due_at), oldAt - 23.5 * HOUR, "远期不自动失效，进了 24 小时后 30 分钟才失效");
  const marked = await tenantDecide(order.id, changeId, "adjusting", { note: "在换司机" });
  assertMatchesOpenApi("POST", "/tenant/v1/orders/{id}/changes/{changeId}/adjusting", marked);
  assert.deepEqual([marked.status, marked.body.change.status, marked.body.change.decision_note], [200, "adjusting", "在换司机"]);
  assert.equal(Date.parse(marked.body.change.confirm_due_at), api.clock.now().getTime() + 24 * HOUR);
  assert.equal((await tenantDecide(order.id, changeId, "adjusting")).body.error.code, "CHANGE_NOT_PENDING", "只能标一次");
  const seen = await salesGet(order.id);
  assert.deepEqual([seen.changes[0].status, seen.service_time], ["adjusting", order.service_time]);
  assert.equal((await patch(order.id, { passengers: 3 })).body.error.code, "CHANGE_IN_PROGRESS", "调整中也算没结论");
  assert.equal((await todosOf(order.id))[0].kind, "change_request");
  assert.equal((await api.call("POST", `/tenant/v1/order-todos/${(await todosOf(order.id))[0].id}/ack`, { token: b.adminToken })).body.error.code, "TODO_NEEDS_DECISION");

  api.clock.advance(Date.parse(marked.body.change.confirm_due_at) - api.clock.now().getTime() - 1);
  assert.equal((await salesGet(order.id)).changes[0].status, "adjusting");
  api.clock.advance(HOUR);
  await api.app.orderJobs.money();
  const after = await salesGet(order.id);
  assert.deepEqual([after.changes[0].status, after.free_cancel_available, pay.refundsOf(order.id).length], ["expired", true, 1]);
  b.adminToken = await tenantLogin(api, m.b.adminEmail);
  assert.deepEqual((await todosOf(order.id)).map((item) => item.kind), ["change_expired"]);
});

test("超时边界：远期不失效；进 24 小时后提的是提出后 30 分钟；截止前 1 毫秒能同意，到点 409 记没确认", async () => {
  const serviceAt = dayAhead(50);
  const { order } = await dispatched(serviceAt);
  const moved = await dispatched(serviceAt + 10 * 60_000);
  const res = await patch(order.id, { passengers: 3 });
  const due = Date.parse(res.body.change.confirm_due_at);
  assert.equal(due, serviceAt - 23.5 * HOUR);
  assert.equal((await api.app.orderJobs.money()).changes.expired, 0, "远期不失效");
  api.clock.advance(due - 60_000 - api.clock.now().getTime());
  const near = await patch(moved.order.id, { passengers: 3 });
  const nearDue = Date.parse(near.body.change.confirm_due_at);
  assert.equal(nearDue, api.clock.now().getTime() + 30 * 60_000, "已经进了 24 小时：提出后 30 分钟");
  b.adminToken = await tenantLogin(api, m.b.adminEmail);
  api.clock.advance(due - 1 - api.clock.now().getTime());
  const justInTime = await tenantDecide(order.id, res.body.change.id, "confirm");
  assert.deepEqual([justInTime.status, justInTime.body.change?.status], [200, "applied"], justInTime.text);
  api.clock.advance(nearDue - api.clock.now().getTime());
  const late = await tenantDecide(moved.order.id, near.body.change.id, "confirm");
  assert.deepEqual([late.status, late.body.error.code], [409, "CHANGE_CONFIRMATION_EXPIRED"]);
  const now = await salesGet(moved.order.id);
  assert.deepEqual([now.changes[0].status, now.passengers, now.free_cancel_available], ["expired", 2, true]);
});

test("超时提醒进异常队列：更远 4 小时、48 小时内 1 小时、24 小时内 15 分钟；有结论后自动关闭；只提醒不失效", async () => {
  const exceptionsOf = async (orderId: string): Promise<any[]> => (await api.db.owner.query("select status, close_kind, detail from order_exceptions where order_id = $1 and type = 'change_unconfirmed'", [orderId])).rows;
  const far = await dispatched(dayAhead(60));
  const farChange = (await patch(far.order.id, { passengers: 3 })).body.change;
  api.clock.advance(4 * HOUR - 10_000);
  await api.app.orderJobs.exceptions();
  assert.deepEqual(await exceptionsOf(far.order.id), [], "不到 4 小时");
  api.clock.advance(11_000);
  await api.app.orderJobs.exceptions();
  assert.deepEqual((await exceptionsOf(far.order.id)).map((row) => row.status), ["open"]);
  await tick();
  const staffMail = await api.db.owner.query("select count(*)::int as n from notification_events where event = 'exception.opened' and order_id = $1", [far.order.id]);
  assert.equal(staffMail.rows[0].n, 1, "邮件提醒运营");
  assert.equal((await salesGet(far.order.id)).changes[0].status, "pending_confirmation", "只提醒不失效");
  b.adminToken = await tenantLogin(api, m.b.adminEmail);
  await ok(tenantDecide(far.order.id, farChange.id, "reject", { note: "排不出车" }));
  await api.app.orderJobs.exceptions();
  assert.deepEqual((await exceptionsOf(far.order.id)).map((row) => [row.status, row.close_kind]), [["closed", "cleared"]]);

  const mid = dayAhead(70);
  const middle = await dispatched(mid);
  await patch(middle.order.id, { passengers: 3 });
  api.clock.advance(mid - 40 * HOUR - api.clock.now().getTime());
  await api.db.owner.query("update order_changes set requested_at = $2 where order_id = $1", [middle.order.id, new Date(api.clock.now().getTime() - 59 * 60_000)]);
  await api.app.orderJobs.exceptions();
  assert.deepEqual(await exceptionsOf(middle.order.id), [], "48 小时内：不到 1 小时");
  api.clock.advance(61_000);
  await api.app.orderJobs.exceptions();
  assert.equal((await exceptionsOf(middle.order.id)).length, 1);

  b.adminToken = await tenantLogin(api, m.b.adminEmail);
  const close = await dispatched(mid + 3 * HOUR);
  const closeChange = (await patch(close.order.id, { passengers: 3 })).body.change;
  await api.db.owner.query("update order_changes set requested_at = $2, confirm_due_at = $3, earliest_service_at = $4 where id = $1", [closeChange.id, new Date(api.clock.now().getTime() - 14 * 60_000), new Date(api.clock.now().getTime() + 16 * 60_000), new Date(api.clock.now().getTime() + 10 * HOUR)]);
  await api.app.orderJobs.exceptions();
  assert.deepEqual(await exceptionsOf(close.order.id), [], "24 小时内：不到 15 分钟");
  api.clock.advance(61_000);
  await api.app.orderJobs.exceptions();
  assert.equal((await exceptionsOf(close.order.id)).length, 1);
});

test("订单走到修改不再适用：司机出发后，同意 409；定时任务记没确认、差价退回；航班号的还能处理", async () => {
  const oldAt = dayAhead(80);
  const newAt = oldAt + 2 * DAY;
  await surge(tokyoDate(newAt));
  const { order } = await dispatched(oldAt);
  const res = await patch(order.id, { service_time: iso(newAt) });
  const other = await dispatched(oldAt + HOUR);
  const flight = await patch(other.order.id, { flight_no: "JL5" });
  for (const id of [order.id, other.order.id]) await ok(api.call("POST", `/tenant/v1/orders/${id}/events`, { token: b.adminToken, body: { type: "departed" } }));
  assert.equal((await tenantDecide(order.id, res.body.change.id, "confirm")).body.error.code, "ORDER_STATE_INVALID");
  await api.app.orderJobs.money();
  const after = await salesGet(order.id);
  assert.deepEqual([after.changes[0].status, after.service_time, pay.refundsOf(order.id).length], ["expired", order.service_time, 1]);
  assert.equal((await salesGet(other.order.id)).changes[0].status, "pending_confirmation", "航班号到接到客人之前都适用");
  assert.equal((await tenantDecide(other.order.id, flight.body.change.id, "confirm")).status, 200);
  assert.equal((await salesGet(other.order.id)).flight_no, "JL5");
});

test("库存：确认前原日期不释放、新日期不预留；同意时新日期满了 409、申请留着；加库存后同意才挪", async () => {
  const oldAt = dayAhead(90);
  const newAt = oldAt + 2 * DAY;
  const oldDay = tokyoDate(oldAt);
  const newDay = tokyoDate(newAt);
  await api.db.owner.query("update products set inventory_mode = 'limited' where id = $1", [m.ids.pb]);
  for (const day of [oldDay, newDay]) await api.db.owner.query("insert into inventory_days (tenant_id, product_id, day, total, created_at, updated_at) values ($1, $2, $3, 5, now(), now())", [b.tenantId, m.ids.pb, day]);
  try {
    const day = async (value: string): Promise<{ total: number; sold: number }> => (await api.db.owner.query("select total, sold from inventory_days where product_id = $1 and day = $2", [m.ids.pb, value])).rows[0];
    const { order } = await dispatched(oldAt);
    assert.equal((await day(oldDay)).sold, 1);
    const res = await patch(order.id, { service_time: iso(newAt) });
    assert.equal(res.body.change.status, "pending_confirmation");
    assert.deepEqual([(await day(oldDay)).sold, (await day(newDay)).sold], [1, 0], "申请期间不动库存");
    await api.db.owner.query("update inventory_days set sold = total where product_id = $1 and day = $2", [m.ids.pb, newDay]);
    const full = await tenantDecide(order.id, res.body.change.id, "confirm");
    assert.deepEqual([full.status, full.body.error.code, full.body.error.details.reason], [409, "CHANGE_NOT_SERVICEABLE", "SOLD_OUT"]);
    const still = await salesGet(order.id);
    assert.deepEqual([still.changes[0].status, still.service_time], ["pending_confirmation", order.service_time], "申请留着，原预约有效");
    assert.equal((await day(oldDay)).sold, 1, "回滚：原日期没动");
    await api.db.owner.query("update inventory_days set total = total + 1 where product_id = $1 and day = $2", [m.ids.pb, newDay]);
    assert.equal((await tenantDecide(order.id, res.body.change.id, "confirm")).status, 200);
    assert.deepEqual([(await day(oldDay)).sold, (await day(newDay)).sold], [0, 6]);
  } finally {
    await api.db.owner.query("update products set inventory_mode = 'unlimited' where id = $1", [m.ids.pb]);
  }
});

test("救援：没结论的申请（含调整中）作废、差价退回；告诉客人和司机；原供应商收到邮件和待办", async () => {
  const oldAt = dayAhead(100);
  const newAt = oldAt + 2 * DAY;
  await surge(tokyoDate(newAt));
  const { order, email } = await dispatched(oldAt);
  const res = await patch(order.id, { service_time: iso(newAt) });
  await ok(tenantDecide(order.id, res.body.change.id, "adjusting"));
  smtp.reset();
  await ok(api.call("POST", `/tenant/v1/orders/${order.id}/declare-unable`, { token: b.adminToken, body: { reason: "车坏了" } }));
  const after = await salesGet(order.id);
  assert.equal(after.changes[0].status, "cancelled");
  assert.deepEqual(pay.refundsOf(order.id).map((refund) => refund.amountMinor), [SURGE_SELL - SELL]);
  await tick();
  assert.match(texts(mailsTo(email)), /任务已取消或已转给别的供应商/);
  assert.match(texts(mailsTo(m.b.adminEmail)), /进入救援改派/);
  assert.deepEqual((await todosOf(order.id)).map((item) => item.kind), ["rescue_started"], "要决定的那条关掉");
});

test("取消：通知即生效；供应商和司机都收到；没结论的申请关掉；待办可以点知道了", async () => {
  const { order, email, token } = await dispatched();
  const res = await patch(order.id, { passengers: 3 });
  smtp.reset();
  api.clock.advance(1_000);
  const cancelled = await ok(api.call("POST", `/sales/v1/orders/${order.id}/cancel`, { token: await flow.token(), body: {} }));
  assert.deepEqual([cancelled.order.status, cancelled.order.changes[0].id, cancelled.order.changes[0].status], ["cancelled", res.body.change.id, "cancelled"]);
  await tick();
  const tenantText = texts(mailsTo(m.b.adminEmail));
  assert.match(tenantText, /订单已取消/);
  assert.match(tenantText, /需调整司机/);
  const driverText = texts(mailsTo(email));
  assert.match(driverText, /任务已取消/);
  assert.equal(tokenInMail(driverText), null);
  assertNoGuestInfo(driverText, order);
  assert.equal((await api.call("GET", "/driver/v1/trip", { token })).status, 401);
  const items = await todosOf(order.id);
  assert.deepEqual(items.map((item) => [item.kind, item.needs_driver_adjustment]), [["order_cancelled", true]]);
  const acked = await api.call("POST", `/tenant/v1/order-todos/${items[0].id}/ack`, { token: b.adminToken });
  assertMatchesOpenApi("POST", "/tenant/v1/order-todos/{id}/ack", acked);
  assert.equal(acked.status, 200);
  assert.equal((await api.call("POST", `/tenant/v1/order-todos/${items[0].id}/ack`, { token: b.adminToken })).status, 200, "重复点没关系");
  assert.deepEqual(await todosOf(order.id), []);
});

test("其他取消入口也通知：运营代取消；没派司机的不发司机；没付款的单不通知供应商", async () => {
  const assigned = await dispatched();
  await ok(api.call("POST", `/platform/v1/orders/${assigned.order.id}/cancel`, { token: ops, body: { reason: "FLIGHT_CANCELLED", note: "航班取消，有证明" } }));
  const noDriver = await flow.paidOrder({ serviceTime: iso(dayAhead(11)) });
  await ok(api.call("POST", `/platform/v1/orders/${noDriver.id}/cancel`, { token: ops, body: { reason: "GUEST_REQUEST", note: "客人来电" } }));
  const unpaid = await flow.unpaidOrder({ serviceTime: iso(dayAhead(12)) });
  api.clock.advance(1_000);
  await ok(api.call("POST", `/sales/v1/orders/${unpaid.id}/cancel`, { token: await flow.token(), body: {} }));
  await tick();
  const events = async (id: string): Promise<string[]> => (await api.db.owner.query("select event from notification_events where order_id = $1 and event like '%cancelled'", [id])).rows.map((row) => row.event).sort();
  assert.deepEqual(await events(assigned.order.id), ["order.cancelled", "order.driver_cancelled"]);
  assert.deepEqual(await events(noDriver.id), ["order.cancelled"]);
  assert.deepEqual(await events(unpaid.id), [], "供应商不知道这单");
  assert.match(texts(mailsTo(assigned.email)), /任务已取消/);
});

test("手动模式不给司机发信，调度员看到提示；没邮箱的司机也一样", async () => {
  const noEmail = await dispatched(dayAhead(13), {});
  await patch(noEmail.order.id, { passengers: 3 });
  assert.equal((await todosOf(noEmail.order.id))[0].driver_notice, "no_email");
  await tick();
  assert.equal((await api.db.owner.query("select count(*)::int as n from notifications where order_id = $1 and audience = 'driver' and event = 'order.driver_change_pending'", [noEmail.order.id])).rows[0].n, 0);
  assert.match(texts(mailsTo(m.b.adminEmail)), /没有邮箱/);

  const manual = await dispatched();
  await api.db.owner.query("update tenant_notification_settings set driver_link_delivery = 'manual' where tenant_id = $1", [b.tenantId]);
  smtp.reset();
  await patch(manual.order.id, { passengers: 3 });
  assert.equal((await todosOf(manual.order.id))[0].driver_notice, "manual");
  await tick();
  assert.equal(mailsTo(manual.email).length, 0);
  assert.match(texts(mailsTo(m.b.adminEmail)), /手动发送/);
  const row = await api.db.owner.query("select status, last_error_code from notifications where order_id = $1 and audience = 'driver' and event = 'order.driver_change_pending'", [manual.order.id]);
  assert.deepEqual(row.rows.map((item) => [item.status, item.last_error_code]), [["expired", "DRIVER_LINK_MANUAL"]]);
});

test("改派之后：旧司机收不到排队的通知，新司机的链接不受影响", async () => {
  const { order, email } = await dispatched();
  const res = await patch(order.id, { passengers: 3 });
  const nextEmail = fictionalEmail();
  const next = await newDriver(api, b, { email: nextEmail });
  await ok(assign(api, b, order.id, next.id, (await newVehicle(api, b, m.ids.biz7)).id, { reason: "换司机" } as never));
  await tick();
  assert.equal(mailsTo(email).filter((mail) => /客人申请修改/.test(decodedMailText(mail.data))).length, 0, "排队期间改派了，不发给旧司机");
  await ok(tenantDecide(order.id, res.body.change.id, "confirm"));
  await tick();
  assert.match(texts(mailsTo(nextEmail)), /任务有更新/);
});

test("运营代处理：有权限、必填原因、写审计；客服没有权限；代拒绝供应商看得到；不是双人复核（代改的人可以代同意）", async () => {
  const { order } = await dispatched();
  const version = (await salesGet(order.id)).version;
  const requested = await ok(api.call("PATCH", `/platform/v1/orders/${order.id}`, { token: ops, headers: { "if-match": `"${version}"` }, body: { passengers: 3 } }));
  assert.equal(requested.change.status, "pending_confirmation", "运营代改同样要确认");
  assert.equal((await platformDecide(order.id, requested.change.id, "confirm", "x", await platformLogin(api, serviceEmail))).status, 403, "客服不能替供应商答应");
  assert.equal((await api.call("POST", `/platform/v1/orders/${order.id}/changes/${requested.change.id}/confirm`, { token: ops, body: {} })).status, 400, "原因必填");
  const done = await platformDecide(order.id, requested.change.id, "confirm");
  assertMatchesOpenApi("POST", "/platform/v1/orders/{id}/changes/{changeId}/confirm", done);
  assert.deepEqual([done.status, done.body.change.status, done.body.change.decided_by_platform], [200, "applied", true]);
  assert.equal((await salesGet(order.id)).passengers, 3);
  const audit = await api.db.owner.query("select actor_email, action from audit_logs where resource = 'order_change' and resource_id = $1 order by occurred_at, id", [requested.change.id]);
  assert.deepEqual(audit.rows.map((row) => [row.actor_email, row.action]), [[m.staff.operations.email, "request"], [m.staff.operations.email, "change"]]);
  assert.deepEqual((await todosOf(order.id)).map((item) => item.kind), ["change_applied"], "代同意的留一条给供应商");

  const second = (await patch(order.id, { luggage: 3 })).body.change;
  assert.equal((await platformDecide(order.id, second.id, "adjusting")).body.change.status, "adjusting");
  const rejected = await platformDecide(order.id, second.id, "reject", "供应商电话说排不出车");
  assert.deepEqual([rejected.body.change.status, rejected.body.change.decided_by_platform], ["rejected", true]);
  assert.ok((await todosOf(order.id)).some((item) => item.kind === "change_expired"));
  const rejectAudit = await api.db.owner.query("select after from audit_logs where resource = 'order_change' and resource_id = $1 and action = 'reject'", [second.id]);
  assert.deepEqual([rejectAudit.rows[0].after.by_platform, rejectAudit.rows[0].after.tenant_id, rejectAudit.rows[0].after.note], [true, b.tenantId, "供应商电话说排不出车"]);
});

test("没权限：只读角色看得到待办，处理不了；数据范围外的运营 404", async () => {
  const { order } = await dispatched();
  const res = await patch(order.id, { passengers: 3 });
  const email = `fictional.staff.${randomUUID().slice(0, 8)}@example.test`;
  const invited = await ok(api.call("POST", "/tenant/v1/users", { token: b.adminToken, body: { email, name: "虚构只读", role: "readonly" } }), 201);
  await ok(api.call("POST", "/tenant/v1/auth/accept-invite", { body: { token: invited.invite.token, password: TEST_PASSWORD } }));
  const readonly = await tenantLogin(api, email);
  assert.equal((await api.call("GET", "/tenant/v1/order-todos", { token: readonly })).status, 200);
  for (const decision of ["confirm", "adjusting"] as const) assert.equal((await tenantDecide(order.id, res.body.change.id, decision, {}, readonly)).status, 403, decision);
  assert.equal((await tenantDecide(order.id, res.body.change.id, "reject", { note: "x" }, readonly)).status, 403);
  const item = (await todosOf(order.id))[0];
  assert.equal((await api.call("POST", `/tenant/v1/order-todos/${item.id}/ack`, { token: readonly })).status, 403);
  assert.equal((await salesGet(order.id)).changes[0].status, "pending_confirmation");
});

test("并发：同意和取消、代处理和供应商、同意和改派、同意和客户再改，都只有一个结果，钱不多退", async () => {
  // 同意和取消
  const raced = await dispatched(dayAhead(14));
  const racedChange = (await patch(raced.order.id, { passengers: 3 })).body.change;
  api.clock.advance(1_000);
  const salesToken = await flow.token();
  const [confirmed, cancelled] = await Promise.all([tenantDecide(raced.order.id, racedChange.id, "confirm"), api.call("POST", `/sales/v1/orders/${raced.order.id}/cancel`, { token: salesToken, body: {} })]);
  assert.equal(cancelled.status, 200, cancelled.text);
  const afterCancel = await salesGet(raced.order.id);
  assert.equal(afterCancel.status, "cancelled");
  if (confirmed.status === 200) assert.equal(afterCancel.changes[0].status, "applied");
  else assert.deepEqual([confirmed.status, afterCancel.changes[0].status], [409, "cancelled"], confirmed.text);
  assert.equal(pay.refundsOf(raced.order.id).reduce((sum, refund) => sum + refund.amountMinor, 0), SELL, "只退一次");

  // 代处理和供应商同时
  const both = await dispatched(dayAhead(15));
  const bothChange = (await patch(both.order.id, { passengers: 3 })).body.change;
  const decisions = await Promise.all([tenantDecide(both.order.id, bothChange.id, "confirm"), platformDecide(both.order.id, bothChange.id, "reject")]);
  assert.deepEqual(decisions.map((res) => res.status).sort(), [200, 409]);
  assert.equal(decisions.find((res) => res.status === 409)?.body.error.code, "CHANGE_NOT_PENDING");

  // 同意和改派：谁先都行，司机通知跟着现在的司机
  const swap = await dispatched(dayAhead(16));
  const swapChange = (await patch(swap.order.id, { passengers: 3 })).body.change;
  const nextEmail = fictionalEmail();
  const next = await newDriver(api, b, { email: nextEmail });
  const vehicle = await newVehicle(api, b, m.ids.biz7);
  const [swapConfirmed, swapped] = await Promise.all([tenantDecide(swap.order.id, swapChange.id, "confirm"), assign(api, b, swap.order.id, next.id, vehicle.id)]);
  assert.equal(swapConfirmed.status, 200, swapConfirmed.text);
  assert.ok([200, 409].includes(swapped.status), swapped.text);
  await tick();
  const stale = mailsTo(swap.email).filter((mail) => tokenInMail(decodedMailText(mail.data)) !== null);
  for (const mail of stale) {
    const token = tokenInMail(decodedMailText(mail.data)) as string;
    if (swapped.status === 200) assert.equal((await api.call("GET", "/driver/v1/trip", { token })).status, 401, "改派后旧司机手里的新链接也失效");
  }

  // 同意和客户再改：再改要么版本对不上要么还在进行中
  const again = await dispatched(dayAhead(17));
  const againChange = (await patch(again.order.id, { passengers: 3 })).body.change;
  const version = (await salesGet(again.order.id)).version;
  api.clock.advance(1_000);
  const token = await flow.token();
  const [agreed, repatched] = await Promise.all([tenantDecide(again.order.id, againChange.id, "confirm"), api.call("PATCH", `/sales/v1/orders/${again.order.id}`, { token, headers: { "if-match": `"${version}"` }, body: { luggage: 3 } })]);
  assert.equal(agreed.status, 200, agreed.text);
  assert.equal(repatched.status === 200 || ["VERSION_CONFLICT", "CHANGE_IN_PROGRESS"].includes(repatched.body.error?.code), true, repatched.text);
  const finals = (await salesGet(again.order.id)).changes.map((change: any) => change.status);
  assert.equal(finals.filter((status: string) => status === "pending_confirmation" || status === "adjusting").length <= 1, true);
});

test("规则 4：待办和详情里没有对外价、加价比例；客人邮件没有结算价", async () => {
  const oldAt = dayAhead(110);
  const newAt = oldAt + 2 * DAY;
  await surge(tokyoDate(newAt));
  const { order } = await dispatched(oldAt);
  const res = await patch(order.id, { service_time: iso(newAt) });
  const scan = (text: string): void => {
    assert.ok(!/markup|sell_|"sell|price_difference/.test(text), "没有对外价和加价的字段");
    for (const value of [String(SELL), String(SURGE_SELL)]) assert.ok(!text.split(/[^0-9]/).includes(value), value);
  };
  scan((await api.call("GET", "/tenant/v1/order-todos", { token: b.adminToken })).text);
  scan((await api.call("GET", `/tenant/v1/orders/${order.id}`, { token: b.adminToken })).text);
  scan((await api.call("GET", "/driver/v1/trip", { token: (await dispatched(dayAhead(18))).token })).text);
  const applied = await tenantDecide(order.id, res.body.change.id, "confirm");
  scan(applied.text);
  const webhook = await api.db.owner.query("select event_data from webhook_deliveries where order_id = $1", [order.id]);
  for (const row of webhook.rows) scan(JSON.stringify(row.event_data));
  await tick();
  scan(texts(mailsTo(m.b.adminEmail)));
});

test("定时任务和有效期：等处理的邮件在申请有结论后不再发（CHANGE_DECIDED）；待办在用车过去 3 天后不再计入，要决定的除外", async () => {
  const { order } = await dispatched(dayAhead(19));
  const res = await patch(order.id, { passengers: 3 });
  await ok(tenantDecide(order.id, res.body.change.id, "confirm"));
  await tick();
  const pending = await api.db.owner.query("select status, last_error_code from notifications where order_id = $1 and audience = 'tenant' and event = 'order.change_pending'", [order.id]);
  assert.ok(pending.rows.length > 0);
  for (const row of pending.rows) assert.deepEqual([row.status, row.last_error_code], ["expired", "CHANGE_DECIDED"]);
  assert.equal((await todosOf(order.id)).length, 1);
  api.clock.advance(Date.parse(order.service_time) - api.clock.now().getTime() + 4 * DAY);
  b.adminToken = await tenantLogin(api, m.b.adminEmail);
  assert.deepEqual(await todosOf(order.id), []);
});
