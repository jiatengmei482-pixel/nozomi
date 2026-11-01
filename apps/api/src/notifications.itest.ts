/**
 * M4-08：通知中心（ADR 0049），连真实的 PostgreSQL 和本机的假 SMTP，**从不连真实的邮件服务**；收款用替身。
 * - 官网付款后客人收到确认邮件，链接打得开；链接令牌不在库、日志、记录页里；
 * - 邮件没配置：下单、付款不受影响，记录保留，配好后发出；过了有效期明确过期；
 * - 重复事件幂等，同一封不重复发；失败退避、最终失败看得见、手动重试（权限、审计）；
 * - 其他渠道的单没有客人邮件；供应商邮件没有对外价和加价比例；租户 A 读不到、改不了租户 B。
 */
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import { NOTIFICATION_EVENTS, type NotificationEvent } from "@nozomi/domain";
import { withPlatformTx, withTenantTx } from "./db/context.ts";
import { SMTP_SEND_DEADLINE_MS } from "./integrations/smtp.ts";
import { beginSending, claimDueNotifications, enqueueNotification } from "./repos/notifications.ts";
import { NOTIFICATION_LEASE_MS } from "./services/notification-jobs.ts";
import { type TestApi, TEST_PASSWORD, createTestApi } from "./testing/api.ts";
import { assign, newDriver, newVehicle, seedOrder } from "./testing/dispatch.ts";
import { type FakeSmtp, type FakeSmtpMessage, startFakeSmtp } from "./testing/fake-integrations.ts";
import { type Market, addStaff, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { tenantLogin } from "./testing/money.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";
import { FakePaymentProvider, deliverWebhook } from "./testing/payments.ts";
import { type SalesFlow, salesFlow } from "./testing/sales-flow.ts";
import { type SiteApi, siteApi } from "./testing/site.ts";

const HOUR = 3_600_000;
const GUEST_EMAIL = "guest.notify@example.com";
const PASSENGER = { name: "王小明", phone: "+81 90-1234-5678", email: GUEST_EMAIL };
const NO_SMTP = { SMTP_HOST: "", SMTP_PORT: "", SMTP_ENCRYPTION: "", SMTP_USERNAME: "", SMTP_PASSWORD: "", SMTP_FROM_NAME: "", SMTP_FROM_ADDRESS: "" };

let api: TestApi;
let m: Market;
let pay: FakePaymentProvider;
let smtp: FakeSmtp;
/** 配好邮件的官网 */
let site: SiteApi;
/** 同一个库上没配邮件的官网 */
let unconfigured: SiteApi;
let other: SalesFlow;
let serviceClock = 0;
const logLines: string[] = [];

before(async () => {
  pay = new FakePaymentProvider();
  smtp = await startFakeSmtp();
  api = await createTestApi({ payments: pay });
  m = await buildMarket(api);
  const channelId = (await newChannel(api, m.staff.cm1.token, { name: "NOZOMI 官网" })).id;
  const client = await salesCredentials(api, m, channelId);
  const smtpEnv = { SMTP_HOST: smtp.host, SMTP_PORT: String(smtp.port), SMTP_ENCRYPTION: "none", SMTP_USERNAME: "mailer", SMTP_PASSWORD: "fake-smtp-password-Zq7", SMTP_FROM_NAME: "NOZOMI", SMTP_FROM_ADDRESS: "noreply@example.test" };
  const logDestination = new Writable({
    write(chunk, _encoding, done) {
      logLines.push(String(chunk));
      done();
    },
  });
  site = await siteApi(api, client.clientId, pay, smtpEnv, { logDestination, integrationSecretsTtlMs: 0 });
  unconfigured = await siteApi(api, client.clientId, pay, NO_SMTP, { integrationSecretsTtlMs: 0 });
  other = await salesFlow(api, m, pay);
});

after(async () => {
  await unconfigured?.close();
  await site?.close();
  await smtp?.close();
  await api.close();
});

/** 把积压的处理掉，每个用例从干净的状态开始（发件箱、记录都标成已处理）。 */
beforeEach(async () => {
  await api.db.owner.query("update notification_events set expanded_at = coalesce(expanded_at, now())");
  await api.db.owner.query("update notifications set status = 'expired', last_error_code = 'ORDER_STATE_CHANGED', lease_token = null, lease_until = null where status in ('pending', 'sending')");
  await api.db.owner.query("update tenant_notification_settings set quiet_start = null, quiet_end = null");
  smtp.reset();
});

/** 每张单用不同的用车时间，避开同一天的额度。 */
function nextService(): { local: string } {
  serviceClock += 1;
  const at = new Date(api.clock.now().getTime() + 10 * 24 * HOUR + serviceClock * HOUR);
  return { local: new Date(at.getTime() + 9 * HOUR).toISOString().slice(0, 16) };
}

async function placeOrder(on: SiteApi = site): Promise<{ orderId: string; orderNo: string; token: string; sellMinorText: string }> {
  api.clock.advance(1_000);
  const quotes = await on.call("POST", "/site/v1/quotes", { ip: `198.51.100.${(serviceClock % 200) + 1}`, body: { category: "airport_transfer", city_id: m.ids.tokyo, airport_id: m.ids.narita, direction: "pickup", address: { lng: 139.7, lat: 35.6 }, service_local: nextService().local, passengers: 2, luggage: 1 } });
  assert.equal(quotes.status, 200, quotes.text);
  const quote = quotes.body.quotes.find((row: any) => row.vehicle_group.id === m.ids.biz7);
  assert.ok(quote, quotes.text);
  api.clock.advance(1_000);
  const res = await on.call("POST", "/site/v1/orders", { ip: `198.51.100.${(serviceClock % 200) + 1}`, headers: { "idempotency-key": randomUUID() }, body: { quote_id: quote.quote_id, passenger: PASSENGER, flight_no: "NH211", dropoff_address: "东京站八重洲口", save_payment_method: true } });
  assert.equal(res.status, 201, res.text);
  const order = res.body.order;
  const token = res.body.link.token;
  return { orderId: order.id, orderNo: order.order_no, token, sellMinorText: String(quote.sell_price?.amount ?? quote.total?.amount ?? "") };
}

async function payFor(orderId: string): Promise<string> {
  const intent = pay.intentOf(orderId);
  assert.ok(intent);
  pay.pay(intent.id);
  const raw = pay.event("payment_intent.succeeded", pay.intentObject(intent.id), { created: api.clock.now() });
  const res = await deliverWebhook(api.app, raw, pay.sign(raw, api.clock.now()));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return raw;
}

/** 邮件正文解码（nodemailer 对非 ASCII 用 base64 或 quoted-printable）。 */
function bodyOf(message: FakeSmtpMessage): string {
  const split = message.data.search(/\r?\n\r?\n/);
  const head = message.data.slice(0, split);
  const body = message.data.slice(split).trim();
  if (/content-transfer-encoding:\s*base64/i.test(head)) return Buffer.from(body.replace(/\s/g, ""), "base64").toString("utf8");
  if (/content-transfer-encoding:\s*quoted-printable/i.test(head)) {
    return Buffer.from(body.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))), "latin1").toString("utf8");
  }
  return body;
}

const rowsOf = async (orderId: string): Promise<any[]> => (await api.db.owner.query("select * from notifications where order_id = $1 order by audience, recipient", [orderId])).rows;
const guestRow = async (orderId: string, event: string = "order.confirmed"): Promise<any> => (await rowsOf(orderId)).find((row) => row.audience === "guest" && row.event === event);
const tenantTokenA = (): Promise<string> => tenantLogin(api, m.a.adminEmail);
const dumpOfDatabase = async (): Promise<string> => JSON.stringify([(await api.db.owner.query("select * from notifications")).rows, (await api.db.owner.query("select * from notification_events")).rows, (await api.db.owner.query("select * from audit_logs where resource like 'notification%'")).rows]);
/** 让一张单的所有发送记录马上到期（退避的等待在真实时钟之外用测试时钟走）。 */
const makeDue = (id: string): Promise<unknown> => api.db.owner.query("update notifications set next_attempt_at = $2 where id = $1", [id, api.clock.now()]);

test("官网付款后：客人收到确认邮件，链接打得开；令牌不在库、日志、记录页；邮箱打码；记录已发送", async () => {
  const order = await placeOrder();
  await payFor(order.orderId);
  const done = await site.app.notificationJobs.tick();
  assert.equal(done.notConfigured, false);

  const mail = smtp.messages.find((message) => message.to.includes(GUEST_EMAIL));
  assert.ok(mail, "客人没收到邮件");
  const text = bodyOf(mail);
  assert.match(text, new RegExp(order.orderNo));
  const url = /http[^\s]*\/book\/order#(nzo_[A-Za-z0-9_-]+)/.exec(text);
  assert.ok(url, text);
  const token = url[1] as string;
  assert.notEqual(token, order.token, "邮件里的链接是新生成的，不复用页面上的");
  const opened = await site.call("GET", "/site/v1/order", { token });
  assert.equal(opened.status, 200, opened.text);
  assert.equal(opened.body.order.order_no, order.orderNo);

  const row = await guestRow(order.orderId);
  assert.deepEqual([row.status, row.attempts, row.locale, row.channel, row.last_error_code], ["sent", 1, "zh-CN", "email", null]);
  assert.ok(row.sent_at);
  const linkRows = await api.db.owner.query("select issued_via from site_order_links where order_id = $1 order by created_at, issued_via", [order.orderId]);
  assert.ok(linkRows.rows.some((link) => link.issued_via === "email"));

  const list = await api.call("GET", `/platform/v1/notifications?order_no=${order.orderNo}`, { token: m.staff.operations.token });
  assert.equal(list.status, 200, list.text);
  assertMatchesOpenApi("GET", "/platform/v1/notifications", list);
  const item = list.body.items.find((entry: any) => entry.audience === "guest");
  assert.equal(item.recipient, "gu***@example.com");
  assert.equal(item.status, "sent");
  assert.equal(item.order.order_no, order.orderNo);
  assert.equal(item.retryable, false);
  assert.ok(!list.text.includes(GUEST_EMAIL));
  assert.ok(!list.text.includes(token));
  const byId = await api.call("GET", `/platform/v1/notifications?order_id=${order.orderId}&status=sent&audience=guest&event=order.confirmed`, { token: m.staff.operations.token });
  assert.equal(byId.body.total, 1);

  assert.ok(!(await dumpOfDatabase()).includes(token), "令牌进了库");
  assert.ok(!logLines.join("").includes(token), "令牌进了日志");
  assert.ok(!logLines.join("").includes(GUEST_EMAIL), "邮箱进了日志");
});

test("规则 4：发给供应商的邮件没有对外价、加价比例；客人的邮件才有已付金额", async () => {
  const order = await placeOrder();
  await payFor(order.orderId);
  await site.app.notificationJobs.tick();
  const tenantMail = smtp.messages.find((message) => message.to.includes(m.a.adminEmail) || message.to.includes(m.b.adminEmail));
  assert.ok(tenantMail, "供应商没收到邮件");
  const decoded = `${tenantMail.data}\n${bodyOf(tenantMail)}`;
  assert.match(decoded, new RegExp(order.orderNo));
  const sale = (await api.db.owner.query<{ sell_minor: string; markup_bp: number }>("select sell_minor, markup_bp from order_sales where order_id = $1", [order.orderId])).rows[0]!;
  const yen = Number(sale.sell_minor).toLocaleString("en-US");
  for (const forbidden of [String(sale.sell_minor), yen, "对外价", "加价", "已付"]) assert.ok(!decoded.includes(forbidden), `供应商邮件里有 ${forbidden}`);
  const guestMail = smtp.messages.find((message) => message.to.includes(GUEST_EMAIL));
  assert.ok(guestMail);
  assert.match(bodyOf(guestMail), /已付金额/);
});

test("邮件没配置：下单、付款照常；记录留着，原因写明，不算次数；手动重试 409；配好后自动发", async () => {
  const order = await placeOrder(unconfigured);
  await payFor(order.orderId);
  const confirmed = await api.db.owner.query("select status from orders where id = $1", [order.orderId]);
  assert.equal(confirmed.rows[0].status, "confirmed");

  const first = await unconfigured.app.notificationJobs.tick();
  assert.equal(first.notConfigured, true);
  assert.equal(smtp.messages.length, 0);
  const row = await guestRow(order.orderId);
  assert.deepEqual([row.status, row.attempts, row.last_error_code], ["pending", 0, "NOT_CONFIGURED"]);

  const page = await unconfigured.call("GET", "/platform/v1/notifications?status=pending", { token: m.staff.operations.token });
  assert.equal(page.body.summary.mail_configured, false);
  assert.ok(page.body.summary.waiting >= 1);

  await api.db.owner.query("update notifications set status = 'failed', last_error_code = 'TIMEOUT' where id = $1", [row.id]);
  const refused = await unconfigured.call("POST", `/platform/v1/notifications/${row.id}/retry`, { token: m.staff.operations.token });
  assert.deepEqual([refused.status, refused.body.error.code], [409, "MAIL_NOT_CONFIGURED"]);
  await api.db.owner.query("update notifications set status = 'pending', last_error_code = 'NOT_CONFIGURED' where id = $1", [row.id]);

  await site.app.notificationJobs.tick();
  const sent = await guestRow(order.orderId);
  assert.deepEqual([sent.status, sent.attempts, sent.last_error_code], ["sent", 1, null]);
  assert.equal(smtp.messages.filter((message) => message.to.includes(GUEST_EMAIL)).length, 1);
});

test("没配置期间过了有效期：明确过期；配好后不再发", async () => {
  const order = await placeOrder(unconfigured);
  await payFor(order.orderId);
  await unconfigured.app.notificationJobs.tick();
  const row = await guestRow(order.orderId);
  await api.db.owner.query("update notifications set expires_at = $2 where id = $1", [row.id, new Date(api.clock.now().getTime() - 1)]);
  const swept = await site.app.notificationJobs.tick();
  assert.ok(swept.expired >= 1);
  const expired = await guestRow(order.orderId);
  assert.deepEqual([expired.status, expired.last_error_code], ["expired", "EXPIRED"]);
  assert.equal(smtp.messages.filter((message) => message.to.includes(GUEST_EMAIL)).length, 0);
});

test("重复事件幂等：同一个 Stripe 通知来两次、两轮任务并发，确认邮件只有一封", async () => {
  const order = await placeOrder();
  const raw = await payFor(order.orderId);
  const again = await deliverWebhook(api.app, raw, pay.sign(raw, api.clock.now()));
  assert.equal(again.status, 200);
  await Promise.all([site.app.notificationJobs.tick(), site.app.notificationJobs.tick(), site.app.notificationJobs.tick()]);
  await site.app.notificationJobs.tick();
  assert.equal((await rowsOf(order.orderId)).filter((row) => row.audience === "guest").length, 1);
  assert.equal(smtp.messages.filter((message) => message.to.includes(GUEST_EMAIL)).length, 1);
  await withTenantTx(api.db.pool, (await api.db.owner.query("select tenant_id from orders where id = $1", [order.orderId])).rows[0].tenant_id, (db) => enqueueNotification(db, { event: "order.driver_arrived", tenantId: null, orderId: null, dedupeKey: "never" }, api.clock.now())).then(
    () => assert.fail("租户事务不能写 tenant_id 为空的事件"),
    (err: Error) => assert.match(err.message, /row-level security/),
  );
});

test("业务回滚时事件也没有：发件箱和业务同一个事务", async () => {
  const key = `rollback-${randomUUID()}`;
  await withTenantTx(api.db.pool, m.a.tenantId, async (db) => {
    await enqueueNotification(db, { event: "order.driver_arrived", tenantId: m.a.tenantId, orderId: null, dedupeKey: key }, api.clock.now());
    throw new Error("业务失败");
  }).catch(() => undefined);
  assert.equal((await api.db.owner.query("select 1 from notification_events where dedupe_key = $1", [key])).rowCount, 0);
});

test("其他渠道的单：客人由渠道通知，没有客人邮件；供应商照样收到", async () => {
  const created = await other.paidOrder({ serviceTime: new Date(api.clock.now().getTime() + 200 * HOUR).toISOString() });
  await site.app.notificationJobs.tick();
  const rows = await rowsOf(created.id);
  assert.ok(rows.length >= 1);
  assert.ok(rows.every((row) => row.audience === "tenant"), JSON.stringify(rows.map((row) => row.audience)));
});

test("失败退避：连不上按 1 分钟、5 分钟……重试，次数用完最终失败并可见；手动重试成功；权限和审计", async () => {
  const order = await placeOrder();
  await payFor(order.orderId);
  smtp.behave({ dropOnConnect: true });
  await site.app.notificationJobs.tick();
  let row = await guestRow(order.orderId);
  assert.equal(row.status, "pending");
  assert.equal(row.attempts, 1);
  assert.equal(row.last_error_code, "UNREACHABLE");
  assert.equal(new Date(row.next_attempt_at).getTime(), api.clock.now().getTime() + 60_000);
  const second = await site.app.notificationJobs.tick();
  assert.equal(second.sent + second.failed + second.retrying, 0, "没到时间不发");
  for (let attempt = 2; attempt <= 6; attempt += 1) {
    await makeDue(row.id);
    await site.app.notificationJobs.tick();
    row = await guestRow(order.orderId);
    assert.equal(row.attempts, attempt);
  }
  assert.deepEqual([row.status, row.last_error_code], ["failed", "UNREACHABLE"]);
  assert.ok(logLines.join("").includes("notification.failed"));

  const listed = await api.call("GET", `/platform/v1/notifications?status=failed&order_id=${order.orderId}&audience=guest`, { token: m.staff.operations.token });
  assert.deepEqual([listed.body.items[0].retryable, listed.body.items[0].last_error.code], [true, "UNREACHABLE"]);
  assert.ok(listed.body.items[0].last_error.message.length > 0);

  // 权限：只读、渠道经理不能重试；只读也不能看；客服能看（登录后确认）
  for (const token of [m.staff.readonly.token, m.staff.cm1.token, m.staff.masterData.token]) {
    assert.equal((await api.call("POST", `/platform/v1/notifications/${row.id}/retry`, { token })).status, 403);
    assert.equal((await api.call("GET", "/platform/v1/notifications", { token })).status, 403);
  }
  const support = await addStaff(api, m.root, `support-${randomUUID().slice(0, 8)}@platform.test`, "customer_service");
  assert.equal((await api.call("GET", "/platform/v1/notifications", { token: support.token })).status, 200);
  assert.equal((await api.call("POST", `/platform/v1/notifications/${randomUUID()}/retry`, { token: m.staff.operations.token })).status, 404);

  smtp.reset();
  const retried = await site.call("POST", `/platform/v1/notifications/${row.id}/retry`, { token: m.staff.operations.token });
  assert.equal(retried.status, 200, retried.text);
  assertMatchesOpenApi("POST", "/platform/v1/notifications/{id}/retry", retried);
  assert.equal(retried.body.notification.status, "sent");
  assert.equal(smtp.messages.filter((message) => message.to.includes(GUEST_EMAIL)).length, 1);
  const audit = await api.db.owner.query("select actor_id, before, after from audit_logs where resource = 'notification' and action = 'retry' and resource_id = $1", [row.id]);
  assert.equal(audit.rowCount, 1);
  assert.equal(audit.rows[0].actor_id, m.staff.operations.id);
  assert.equal(audit.rows[0].before.last_error_code, "UNREACHABLE");
  assert.ok(!JSON.stringify(audit.rows[0]).includes(GUEST_EMAIL));

  const again = await site.call("POST", `/platform/v1/notifications/${row.id}/retry`, { token: m.staff.operations.token });
  assert.deepEqual([again.status, again.body.error.code], [409, "NOTIFICATION_NOT_RETRYABLE"]);
});

test("收件人被拒立刻最终失败；手动重试失败回到失败，不再排自动重试", async () => {
  const order = await placeOrder();
  await payFor(order.orderId);
  smtp.behave({ rejectRecipient: true });
  await site.app.notificationJobs.tick();
  const row = await guestRow(order.orderId);
  assert.deepEqual([row.status, row.attempts, row.last_error_code], ["failed", 1, "RECIPIENT_REJECTED"]);
  assert.ok(!logLines.join("").includes(GUEST_EMAIL));
  const retried = await site.call("POST", `/platform/v1/notifications/${row.id}/retry`, { token: m.staff.operations.token });
  assert.equal(retried.body.notification.status, "failed");
  assert.equal(retried.body.notification.attempts, 2);
});

test("收件人地址不合格（想注入邮件头）：一个字节都不发，最终失败", async () => {
  const order = await placeOrder();
  await payFor(order.orderId);
  await site.app.notificationJobs.expandEvents(api.clock.now());
  const row = await guestRow(order.orderId);
  await api.db.owner.query("update orders set passenger = jsonb_set(passenger, '{email}', to_jsonb($2::text)) where id = $1", [order.orderId, "x@example.com\r\nBcc: spy@example.com"]);
  await site.app.notificationJobs.tick();
  assert.deepEqual([(await guestRow(order.orderId)).status, (await guestRow(order.orderId)).last_error_code], ["failed", "MESSAGE_INVALID"]);
  assert.ok(!smtp.messages.some((message) => message.to.some((to) => to.includes("spy@"))));
});

test("配置问题（密码错）不算次数：改好后接着发", async () => {
  const order = await placeOrder();
  await payFor(order.orderId);
  smtp.behave({ rejectAuth: true });
  await site.app.notificationJobs.tick();
  const row = await guestRow(order.orderId);
  assert.deepEqual([row.status, row.attempts, row.last_error_code], ["pending", 0, "AUTH_FAILED"]);
  assert.equal(new Date(row.next_attempt_at).getTime(), api.clock.now().getTime() + 300_000);
  smtp.reset();
  await makeDue(row.id);
  await site.app.notificationJobs.tick();
  assert.equal((await guestRow(order.orderId)).status, "sent");
});

test("发送中途进程退出：租约到期后不自动重发，记 OUTCOME_UNKNOWN，人工决定；重复的结果记不上", async () => {
  const order = await placeOrder();
  await payFor(order.orderId);
  await site.app.notificationJobs.expandEvents(api.clock.now());
  const row = await guestRow(order.orderId);
  await api.db.owner.query("update notifications set status = 'sending', lease_token = gen_random_uuid(), lease_until = $2 where id = $1", [row.id, new Date(api.clock.now().getTime() - 1)]);
  const swept = await site.app.notificationJobs.tick();
  assert.equal(swept.abandoned, 1);
  const failed = await guestRow(order.orderId);
  assert.deepEqual([failed.status, failed.last_error_code, failed.lease_token], ["failed", "OUTCOME_UNKNOWN", null]);
  assert.equal(smtp.messages.filter((message) => message.to.includes(GUEST_EMAIL)).length, 0);
});

test("订单情况变了不再发：取消前没发出去的确认邮件过期，取消邮件照发", async () => {
  const order = await placeOrder();
  await payFor(order.orderId);
  await site.app.notificationJobs.expandEvents(api.clock.now());
  const cancelled = await site.call("POST", "/site/v1/order/cancel", { token: order.token, body: {} });
  assert.equal(cancelled.status, 200, cancelled.text);
  await site.app.notificationJobs.tick();
  const confirmation = await guestRow(order.orderId, "order.confirmed");
  assert.deepEqual([confirmation.status, confirmation.last_error_code], ["expired", "ORDER_STATE_CHANGED"]);
  const cancellation = await guestRow(order.orderId, "order.cancelled");
  assert.equal(cancellation.status, "sent");
  const refused = await site.call("POST", `/platform/v1/notifications/${confirmation.id}/retry`, { token: m.staff.operations.token });
  assert.deepEqual([refused.status, refused.body.error.code], [409, "NOTIFICATION_NOT_RETRYABLE"]);
});

test("派车在租户事务里也能入发件箱；不是官网的单不产生客人的记录", async () => {
  const seeded = await seedOrder(api, m, "a", { serviceAt: new Date(api.clock.now().getTime() + 48 * HOUR) });
  const token = await tenantTokenA();
  const driver = await newDriver(api, { ...m.a, adminToken: token });
  const vehicle = await newVehicle(api, { ...m.a, adminToken: token }, m.ids.biz7);
  await ok(assign(api, { ...m.a, adminToken: token }, seeded.id, driver.id, vehicle.id));
  const inBox = await api.db.owner.query("select tenant_id, event, data from notification_events where order_id = $1 and event = 'order.assigned'", [seeded.id]);
  assert.equal(inBox.rowCount, 1);
  assert.equal(inBox.rows[0].tenant_id, m.a.tenantId);
  assert.deepEqual(inBox.rows[0].data, { driver_id: driver.id, vehicle_id: vehicle.id });
  await site.app.notificationJobs.tick();
  assert.deepEqual((await rowsOf(seeded.id)).filter((row) => row.event === "order.assigned"), []);
});

test("官网单的派车、到达：邮件带司机信息", async () => {
  const order = await placeOrder();
  await payFor(order.orderId);
  await site.app.notificationJobs.tick();
  const tenantRow = (await api.db.owner.query<{ tenant_id: string }>("select tenant_id from orders where id = $1", [order.orderId])).rows[0]!;
  const side = tenantRow.tenant_id === m.a.tenantId ? m.a : m.b;
  const token = await tenantLogin(api, side.adminEmail);
  const who = { ...side, adminToken: token };
  const driver = await newDriver(api, who);
  const vehicle = await newVehicle(api, who, m.ids.biz7);
  smtp.reset();
  await ok(assign(api, who, order.orderId, driver.id, vehicle.id));
  await site.app.notificationJobs.tick();
  const mail = smtp.messages.find((message) => message.to.includes(GUEST_EMAIL));
  assert.ok(mail);
  const text = bodyOf(mail);
  assert.ok(text.includes(driver.name), text);
  assert.ok(text.includes(driver.phone), text);
  assert.ok(text.includes(vehicle.plate), text);
  assert.equal((await guestRow(order.orderId, "order.assigned")).status, "sent");
  const driver2 = await newDriver(api, who);
  const vehicle2 = await newVehicle(api, who, m.ids.biz7);
  await ok(assign(api, who, order.orderId, driver2.id, vehicle2.id));
  const driver3 = await newDriver(api, who);
  const vehicle3 = await newVehicle(api, who, m.ids.biz7);
  await ok(assign(api, who, order.orderId, driver3.id, vehicle3.id));
  smtp.reset();
  await site.app.notificationJobs.tick();
  const assigned = (await rowsOf(order.orderId)).filter((row) => row.event === "order.assigned").map((row) => row.status).sort();
  assert.deepEqual(assigned, ["expired", "sent", "sent"], "改派后中间那个司机的通知不再发");
  assert.ok(bodyOf(smtp.messages.find((message) => message.to.includes(GUEST_EMAIL)) as FakeSmtpMessage).includes(driver3.name));
  smtp.reset();
  await ok(api.call("POST", `/tenant/v1/orders/${order.orderId}/events`, { token, body: { type: "departed" } }));
  await ok(api.call("POST", `/tenant/v1/orders/${order.orderId}/events`, { token, body: { type: "arrived" } }));
  await site.app.notificationJobs.tick();
  assert.equal((await guestRow(order.orderId, "order.driver_arrived")).status, "sent");
  assert.equal(smtp.messages.filter((message) => message.to.includes(GUEST_EMAIL)).length, 1);
});

test("真实业务流程都入发件箱：客人改单、事后加收（客人看到的金额）、工单回复、超时提醒、异常、征求意见", async () => {
  const order = await placeOrder();
  await payFor(order.orderId);
  await site.app.notificationJobs.tick();
  const tenantRow = (await api.db.owner.query<{ tenant_id: string; version: number; service_at: Date }>("select tenant_id, version, service_at from orders where id = $1", [order.orderId])).rows[0]!;
  const side = tenantRow.tenant_id === m.a.tenantId ? m.a : m.b;
  const token = await tenantLogin(api, side.adminEmail);

  // 改单
  smtp.reset();
  const view = await site.call("GET", "/site/v1/order", { token: order.token });
  const changed = await site.call("PATCH", "/site/v1/order", { token: order.token, headers: { "if-match": `"${view.body.order.version}"` }, body: { flight_no: "JL5" } });
  assert.equal(changed.status, 200, changed.text);
  await site.app.notificationJobs.tick();
  assert.equal((await guestRow(order.orderId, "order.changed")).status, "sent");
  const changeMail = smtp.messages.find((message) => message.to.includes(GUEST_EMAIL));
  assert.ok(changeMail);
  assert.match(bodyOf(changeMail), /航班号/);
  assert.ok((await rowsOf(order.orderId)).some((row) => row.event === "order.changed" && row.audience === "tenant" && row.status === "sent"));

  // 超时未派车：提醒供应商一次；异常发给运营
  await api.db.owner.query("update orders set dispatch_due_at = $2 where id = $1", [order.orderId, new Date(api.clock.now().getTime() - 1000)]);
  await site.app.orderJobs.remind();
  await site.app.orderJobs.remind();
  await site.app.orderJobs.exceptions();
  await site.app.notificationJobs.tick();
  const overdue = (await rowsOf(order.orderId)).filter((row) => row.event === "order.dispatch_overdue");
  assert.ok(overdue.length >= 1);
  assert.ok(overdue.every((row) => row.audience === "tenant" && row.status === "sent"));
  assert.equal(new Set(overdue.map((row) => row.event_id)).size, 1);
  assert.ok((await rowsOf(order.orderId)).some((row) => row.event === "exception.opened" && row.recipient === m.staff.operations.email));

  // 完成后事后加收：客人看到自己要付的钱（含加价），不是结算价
  const who = { ...side, adminToken: token };
  const driver = await newDriver(api, who);
  await ok(assign(api, who, order.orderId, driver.id, (await newVehicle(api, who, m.ids.biz7)).id));
  for (const type of ["departed", "arrived", "picked_up", "completed"]) await ok(api.call("POST", `/tenant/v1/orders/${order.orderId}/events`, { token, body: { type } }));
  await site.app.notificationJobs.tick();
  smtp.reset();
  const charge = await api.call("POST", `/tenant/v1/orders/${order.orderId}/extra-charges`, { token, body: { type: "waiting", amount: 2_000, description: "等了 40 分钟" } });
  assert.equal(charge.status, 201, charge.text);
  await site.app.notificationJobs.tick();
  const chargeMail = smtp.messages.find((message) => message.to.includes(GUEST_EMAIL));
  assert.ok(chargeMail);
  const text = bodyOf(chargeMail);
  assert.match(text, /JPY 2200/);
  assert.doesNotMatch(text, /JPY 2000/);
  assert.match(text, /等待/);
  assert.equal((await guestRow(order.orderId, "extra_charge.submitted")).status, "sent");

  // 工单：回复客人只说有回复，不抄内容；征求意见发给供应商
  const ticket = await site.call("POST", "/site/v1/order/tickets", { token: order.token, body: { type: "complaint", subject: "司机态度", description: "投诉", language: "zh" } });
  assert.equal(ticket.status, 201, ticket.text);
  const ticketId = ticket.body.ticket.id;
  smtp.reset();
  await ok(api.call("POST", `/platform/v1/tickets/${ticketId}/messages`, { token: m.staff.operations.token, body: { body: "这段回复只在订单页看", to_guest: true } }), 201);
  await ok(api.call("POST", `/platform/v1/tickets/${ticketId}/request-reply`, { token: m.staff.operations.token, body: { body: "请说明司机到达时间" } }));
  await site.app.notificationJobs.tick();
  assert.equal((await guestRow(order.orderId, "ticket.guest_reply")).status, "sent");
  const replyMail = smtp.messages.find((message) => message.to.includes(GUEST_EMAIL));
  assert.ok(replyMail);
  assert.doesNotMatch(bodyOf(replyMail), /这段回复只在订单页看/);
  const replyRequested = (await rowsOf(order.orderId)).filter((row) => row.event === "ticket.reply_requested");
  assert.ok(replyRequested.length >= 1 && replyRequested.every((row) => row.audience === "tenant" && row.status === "sent"));
});

test("用车前 24 小时提醒：只发官网的、只提醒一次；下单时不足 24 小时的不发", async () => {
  const order = await placeOrder();
  await payFor(order.orderId);
  const before24 = (await api.db.owner.query<{ service_at: Date }>("select service_at from orders where id = $1", [order.orderId])).rows[0]!.service_at;
  assert.equal(await site.app.notificationJobs.sweepReminders(), 0, "还没到 24 小时");
  const hoursLeft = (before24.getTime() - api.clock.now().getTime()) / HOUR;
  await api.db.owner.query("update orders set service_at = service_at - make_interval(secs => $2::double precision), confirmed_at = confirmed_at - interval '30 days' where id = $1", [order.orderId, (hoursLeft - 23) * 3600]);
  assert.ok((await site.app.notificationJobs.sweepReminders()) >= 1);
  await site.app.notificationJobs.tick();
  assert.equal((await guestRow(order.orderId, "order.service_reminder")).status, "sent");
  const again = await site.app.notificationJobs.sweepReminders();
  await site.app.notificationJobs.tick();
  assert.equal((await rowsOf(order.orderId)).filter((row) => row.event === "order.service_reminder").length, 1, `第二轮扫到 ${again} 张`);
});

test("每个事件都渲染得出来、都有人收到（供应商、平台员工的事件）", async () => {
  const seeded = await seedOrder(api, m, "a", { serviceAt: new Date(api.clock.now().getTime() + 72 * HOUR) });
  const now = api.clock.now();
  const events: { event: NotificationEvent; tenantId: string | null; orderId: string | null; data: Record<string, unknown> }[] = [
    { event: "order.rescue_assigned", tenantId: m.a.tenantId, orderId: seeded.id, data: {} },
    { event: "order.changed", tenantId: m.a.tenantId, orderId: seeded.id, data: { fields: ["flight_no", "passengers"] } },
    { event: "order.change_pending", tenantId: m.a.tenantId, orderId: seeded.id, data: { confirm_due_at: new Date(now.getTime() + 1_800_000).toISOString() } },
    { event: "order.cancelled", tenantId: m.a.tenantId, orderId: seeded.id, data: {} },
    { event: "order.dispatch_overdue", tenantId: m.a.tenantId, orderId: seeded.id, data: {} },
    { event: "ticket.reply_requested", tenantId: m.a.tenantId, orderId: seeded.id, data: { ticket_no: "TK-1" } },
    { event: "tenant.document_expiring", tenantId: m.a.tenantId, orderId: null, data: { document_type: "vehicle_insurance", expires_on: "2026-12-01", days_left: 30 } },
    { event: "tenant.document_expired", tenantId: m.a.tenantId, orderId: null, data: { document_type: "vehicle_insurance", expires_on: "2026-12-01" } },
    { event: "tenant.observation_started", tenantId: m.a.tenantId, orderId: null, data: { reasons: ["score_below_threshold"] } },
    { event: "tenant.status_changed", tenantId: m.a.tenantId, orderId: null, data: { status: "suspended" } },
    { event: "payout_account.submitted", tenantId: m.a.tenantId, orderId: null, data: { payout_currency: "SGD", payout_account: "•••• 9876" } },
    { event: "payout_account.approved", tenantId: m.a.tenantId, orderId: null, data: { payout_currency: "SGD", payout_account: "•••• 9876" } },
    { event: "payout_account.rejected", tenantId: m.a.tenantId, orderId: null, data: { payout_currency: "SGD", payout_account: "•••• 9876", reject_reason: "户名不一致" } },
    { event: "exception.opened", tenantId: null, orderId: seeded.id, data: { type: "rescue" } },
    { event: "fx.alert", tenantId: null, orderId: null, data: { kind: "held", currencies: ["USD"] } },
    { event: "fx.alert", tenantId: null, orderId: null, data: { kind: "stale", as_of: now.toISOString() } },
    { event: "fx.alert", tenantId: null, orderId: null, data: { kind: "source_rejected", detail: "缺少币种：SGD" } },
    { event: "site.lookup_ceiling", tenantId: null, orderId: null, data: {} },
  ];
  assert.ok(events.length > 0 && NOTIFICATION_EVENTS.length >= events.length);
  const risk = await addStaff(api, m.root, `risk-${randomUUID().slice(0, 8)}@platform.test`, "risk");
  for (const [index, event] of events.entries()) await enqueueNotificationFromPlatform(event, `all-${index}-${randomUUID()}`);
  await site.app.notificationJobs.tick();
  await site.app.notificationJobs.tick();
  const rows = (await api.db.owner.query("select event, audience, recipient, status, last_error_code from notifications where event_id in (select id from notification_events where dedupe_key like 'all-%')")).rows;
  const bad = rows.filter((row) => row.status !== "sent");
  assert.deepEqual(bad, []);
  for (const event of events) assert.ok(rows.some((row) => row.event === event.event), `${event.event} 没有产生记录`);
  const recipientsOf = (event: string): string[] => rows.filter((row) => row.event === event).map((row) => row.recipient);
  assert.ok(recipientsOf("site.lookup_ceiling").includes(risk.email));
  assert.ok(recipientsOf("fx.alert").includes(m.staff.masterData.email));
  assert.ok(!recipientsOf("fx.alert").includes(m.staff.cm1.email), "渠道经理不收汇率告警");
  assert.ok(recipientsOf("exception.opened").includes(m.staff.operations.email));
  assert.ok(recipientsOf("tenant.status_changed").every((email) => email === m.a.adminEmail));
  for (const message of smtp.messages) assert.doesNotMatch(bodyOf(message), /\{\{/, "有占位符没有替换");
});

async function enqueueNotificationFromPlatform(event: { event: NotificationEvent; tenantId: string | null; orderId: string | null; data: Record<string, unknown> }, dedupeKey: string): Promise<void> {
  await api.db.owner.query("insert into notification_events (tenant_id, event, order_id, dedupe_key, data, occurred_at) values ($1, $2, $3, $4, $5, $6)", [event.tenantId, event.event, event.orderId, dedupeKey, JSON.stringify(event.data), api.clock.now()]);
}

test("限定了数据范围的员工：只收、只看范围内的；不属于订单的看不到", async () => {
  const seeded = await seedOrder(api, m, "a", { serviceAt: new Date(api.clock.now().getTime() + 80 * HOUR) });
  const created = await api.call("POST", "/platform/v1/roles", { token: m.root, body: { name: `大阪客服-${randomUUID().slice(0, 6)}`, grants: ["notifications:view", "notifications:edit", "exceptions:view", "exceptions:edit", "orders:view"], data_scope: { city_ids: [m.ids.osaka], channel_ids: null } } });
  assert.equal(created.status, 201, created.text);
  const key = created.body.role?.key ?? created.body.key;
  const staff = await addStaff(api, m.root, `osaka-${randomUUID().slice(0, 8)}@platform.test`, key);
  await enqueueNotificationFromPlatform({ event: "exception.opened", tenantId: null, orderId: seeded.id, data: { type: "rescue" } }, `scope-${randomUUID()}`);
  await enqueueNotificationFromPlatform({ event: "fx.alert", tenantId: null, orderId: null, data: { kind: "stale", as_of: "x" } }, `scope-${randomUUID()}`);
  await site.app.notificationJobs.tick();
  const row = (await rowsOf(seeded.id))[0];
  assert.ok(row);
  assert.ok(!(await rowsOf(seeded.id)).some((entry) => entry.recipient === staff.email), "东京的单不该发给只管大阪的员工");
  const list = await api.call("GET", `/platform/v1/notifications?order_id=${seeded.id}`, { token: staff.token });
  assert.equal(list.status, 200, list.text);
  assert.deepEqual(list.body.items, []);
  assert.equal(list.body.summary.waiting, 0);
  const all = await api.call("GET", "/platform/v1/notifications?event=fx.alert", { token: staff.token });
  assert.deepEqual(all.body.items, []);
  await api.db.owner.query("update notifications set status = 'failed', last_error_code = 'TIMEOUT' where id = $1", [row.id]);
  assert.equal((await site.call("POST", `/platform/v1/notifications/${row.id}/retry`, { token: staff.token })).status, 404);
});

test("模板页：按事件 × 接收方 × 语言 × 通道列出；供应商的模板没有对外价", async () => {
  const res = await api.call("GET", "/platform/v1/notification-templates", { token: m.staff.operations.token });
  assert.equal(res.status, 200, res.text);
  assertMatchesOpenApi("GET", "/platform/v1/notification-templates", res);
  assert.ok(res.body.items.some((item: any) => item.event === "order.confirmed" && item.audience === "guest" && item.locale === "zh-CN" && item.channel === "email" && item.variables.includes("view_url")));
  assert.equal((await api.call("GET", "/platform/v1/notification-templates", { token: m.staff.readonly.token })).status, 403);
});

test("租户隔离：A 只读得到发给自己的，读不到 B 的和发给客人的；数据库策略也挡住", async () => {
  const seededA = await seedOrder(api, m, "a", { serviceAt: new Date(api.clock.now().getTime() + 90 * HOUR) });
  const seededB = await seedOrder(api, m, "b", { serviceAt: new Date(api.clock.now().getTime() + 90 * HOUR) });
  await enqueueNotificationFromPlatform({ event: "order.confirmed", tenantId: m.a.tenantId, orderId: seededA.id, data: {} }, `iso-${randomUUID()}`);
  await enqueueNotificationFromPlatform({ event: "order.confirmed", tenantId: m.b.tenantId, orderId: seededB.id, data: {} }, `iso-${randomUUID()}`);
  await site.app.notificationJobs.tick();
  const eventId = (await rowsOf(seededA.id))[0].event_id as string;
  await api.db.owner.query("insert into notifications (event_id, tenant_id, event, audience, locale, channel, recipient, order_id, order_no, status, sent_at, next_attempt_at, expires_at, created_at, updated_at) values ($1, $2, 'order.confirmed', 'guest', 'zh-CN', 'email', 'hidden-guest@example.com', $3, $4, 'sent', now(), now(), now(), now(), now())", [eventId, m.a.tenantId, seededA.id, seededA.orderNo]);

  const tokenA = await tenantTokenA();
  const tokenB = await tenantLogin(api, m.b.adminEmail);
  const listA = await api.call("GET", `/tenant/v1/notifications?order_id=${seededA.id}`, { token: tokenA });
  assert.equal(listA.status, 200, listA.text);
  assertMatchesOpenApi("GET", "/tenant/v1/notifications", listA);
  assert.deepEqual(listA.body.items.map((item: any) => item.audience), ["tenant"]);
  assert.ok(!listA.text.includes("hidden-guest"));
  assert.ok(!listA.text.includes(m.a.adminEmail), "收件人打码");

  const crossRead = await api.call("GET", `/tenant/v1/notifications?order_id=${seededB.id}`, { token: tokenA });
  assert.deepEqual([crossRead.status, crossRead.body.items], [200, []]);
  const smuggled = await api.call("GET", `/tenant/v1/notifications?tenant_id=${m.b.tenantId}`, { token: tokenA });
  assert.ok(smuggled.status === 400 || smuggled.body.items.every((item: any) => item.order?.id !== seededB.id));

  const visible = await withTenantTx(api.db.pool, m.a.tenantId, (db) => db.query<{ tenant_id: string; audience: string }>("select tenant_id, audience from notifications"));
  assert.ok(visible.rows.length > 0);
  assert.ok(visible.rows.every((row) => row.tenant_id === m.a.tenantId && row.audience === "tenant"), "漏写条件的查询也读不到别家和客人的");
  await assert.rejects(withTenantTx(api.db.pool, m.a.tenantId, (db) => db.query("select * from notification_events")), /permission denied/);
  await assert.rejects(withTenantTx(api.db.pool, m.a.tenantId, (db) => db.query("update notifications set status = 'sent'")), /permission denied/);
  await assert.rejects(withTenantTx(api.db.pool, m.a.tenantId, (db) => enqueueNotification(db, { event: "order.confirmed", tenantId: m.b.tenantId, orderId: seededB.id, dedupeKey: `spoof-${randomUUID()}` }, api.clock.now())), /row-level security/);

  // 改不了：A 改免打扰只影响自己；请求体传 tenant_id 被拒
  const denied = await api.call("PUT", "/tenant/v1/notification-settings", { token: tokenA, body: { quiet_hours: { start: "22:00", end: "07:00" }, tenant_id: m.b.tenantId } });
  assert.equal(denied.status, 400);
  const beforeB = await api.call("GET", "/tenant/v1/notification-settings", { token: tokenB });
  const versionA = (await api.call("GET", "/tenant/v1/notification-settings", { token: tokenA })).body.version;
  const saved = await api.call("PUT", "/tenant/v1/notification-settings", { token: tokenA, ...(versionA === 0 ? {} : { headers: { "if-match": `"${versionA}"` } }), body: { quiet_hours: { start: "22:00", end: "07:00" } } });
  assert.equal(saved.status, 200, saved.text);
  const afterB = await api.call("GET", "/tenant/v1/notification-settings", { token: tokenB });
  assert.deepEqual(afterB.body, beforeB.body);
  await assert.rejects(withTenantTx(api.db.pool, m.a.tenantId, (db) => db.query("insert into tenant_notification_settings (tenant_id, updated_at) values ($1, now())", [m.b.tenantId])), /row-level security/);
  const updatedOther = await withTenantTx(api.db.pool, m.a.tenantId, (db) => db.query("update tenant_notification_settings set quiet_start = '01:00', quiet_end = '02:00' where tenant_id = $1", [m.b.tenantId]));
  assert.equal(updatedOther.rowCount, 0);
});

test("免打扰：权限、校验、版本；非紧急的推迟到时段结束且不算次数，用车当天的照发，发给客人的不受影响", async () => {
  const token = await tenantTokenA();
  const dispatchEmail = `dispatch-${randomUUID().slice(0, 8)}@market-a.test`;
  const invited = await ok(api.call("POST", "/tenant/v1/users", { token, body: { email: dispatchEmail, name: "调度", role: "dispatch" } }), 201);
  await ok(api.call("POST", "/tenant/v1/auth/accept-invite", { body: { token: invited.invite.token, password: TEST_PASSWORD } }));
  const dispatchToken = await tenantLogin(api, dispatchEmail);
  assert.equal((await api.call("GET", "/tenant/v1/notification-settings", { token: dispatchToken })).status, 200);
  assert.equal((await api.call("PUT", "/tenant/v1/notification-settings", { token: dispatchToken, body: { quiet_hours: null } })).status, 403);

  const current = (await api.call("GET", "/tenant/v1/notification-settings", { token })).body;
  assertMatchesOpenApi("GET", "/tenant/v1/notification-settings", { status: 200, headers: {}, text: "", body: current });
  const headers = current.version === 0 ? {} : { "if-match": `"${current.version}"` };
  const invalid = await api.call("PUT", "/tenant/v1/notification-settings", { token, headers, body: { quiet_hours: { start: "07:00", end: "07:00" } } });
  assert.equal(invalid.status, 400);
  // 把现在（测试时钟的东京时间）放进免打扰时段
  const localHour = (api.clock.now().getUTCHours() + 9) % 24;
  const pad = (hour: number): string => `${String(hour).padStart(2, "0")}:00`;
  const saved = await api.call("PUT", "/tenant/v1/notification-settings", { token, headers, body: { quiet_hours: { start: pad(localHour), end: pad((localHour + 2) % 24) } } });
  assert.equal(saved.status, 200, saved.text);
  assertMatchesOpenApi("PUT", "/tenant/v1/notification-settings", saved);
  const stale = await api.call("PUT", "/tenant/v1/notification-settings", { token, headers: { "if-match": `"${saved.body.version + 5}"` }, body: { quiet_hours: null } });
  assert.deepEqual([stale.status, stale.body.error.code], [409, "VERSION_CONFLICT"]);
  const audit = await api.db.owner.query("select 1 from audit_logs where resource = 'notification_settings' and action = 'update' and tenant_id = $1", [m.a.tenantId]);
  assert.ok((audit.rowCount ?? 0) >= 1);

  const later = await seedOrder(api, m, "a", { serviceAt: new Date(api.clock.now().getTime() + 120 * HOUR) });
  const today = await seedOrder(api, m, "a", { serviceAt: new Date(api.clock.now().getTime() + 3 * 60_000) });
  await enqueueNotificationFromPlatform({ event: "order.rescue_assigned", tenantId: m.a.tenantId, orderId: later.id, data: {} }, `quiet-${randomUUID()}`);
  await enqueueNotificationFromPlatform({ event: "order.rescue_assigned", tenantId: m.a.tenantId, orderId: today.id, data: {} }, `quiet-${randomUUID()}`);
  await site.app.notificationJobs.tick();
  const held = (await rowsOf(later.id))[0];
  assert.deepEqual([held.status, held.attempts, held.last_error_code], ["pending", 0, "QUIET_HOURS"]);
  assert.ok(new Date(held.next_attempt_at).getTime() > api.clock.now().getTime());
  const urgent = (await rowsOf(today.id)).map((row) => row.status);
  assert.ok(urgent.length >= 2, "管理员和调度各一封");
  assert.ok(urgent.every((status) => status === "sent"), JSON.stringify(urgent));
  assert.ok((await rowsOf(today.id)).some((row) => row.recipient === dispatchEmail));

  const none = await api.call("PUT", "/tenant/v1/notification-settings", { token, headers: { "if-match": `"${saved.body.version}"` }, body: { quiet_hours: null } });
  assert.equal(none.body.quiet_hours, null);
  // 只读、调度能看记录；商品价格看不到
  const pricingEmail = `pricing-${randomUUID().slice(0, 8)}@market-a.test`;
  const invitedPricing = await ok(api.call("POST", "/tenant/v1/users", { token, body: { email: pricingEmail, name: "价格", role: "pricing" } }), 201);
  await ok(api.call("POST", "/tenant/v1/auth/accept-invite", { body: { token: invitedPricing.invite.token, password: TEST_PASSWORD } }));
  assert.equal((await api.call("GET", "/tenant/v1/notifications", { token: await tenantLogin(api, pricingEmail) })).status, 403);
  assert.equal((await api.call("GET", "/tenant/v1/notifications", { token: dispatchToken })).status, 200);
});

test("没有管理员和调度时发给企业信息的联系邮箱；都没有不产生记录、记一条日志", async () => {
  const root = m.root;
  const lonely = await api.tenantWithAdmin(root, `独立车队-${randomUUID().slice(0, 6)}`, `lonely-${randomUUID().slice(0, 8)}@market-c.test`);
  await api.db.owner.query("update tenant_users set status = 'disabled' where tenant_id = $1", [lonely.tenantId]);
  await enqueueNotificationFromPlatform({ event: "tenant.status_changed", tenantId: lonely.tenantId, orderId: null, data: { status: "active" } }, `lonely-${randomUUID()}`);
  await site.app.notificationJobs.tick();
  const none = await api.db.owner.query("select 1 from notifications where tenant_id = $1", [lonely.tenantId]);
  assert.equal(none.rowCount, 0);
  assert.ok(logLines.join("").includes("notification.no_recipient"));
  await api.db.owner.query("insert into tenant_profiles (tenant_id, contact_email, updated_at) values ($1, 'contact@market-c.test', now())", [lonely.tenantId]);
  await enqueueNotificationFromPlatform({ event: "tenant.status_changed", tenantId: lonely.tenantId, orderId: null, data: { status: "active" } }, `lonely-${randomUUID()}`);
  await site.app.notificationJobs.tick();
  const row = (await api.db.owner.query("select recipient, status from notifications where tenant_id = $1", [lonely.tenantId])).rows[0];
  assert.deepEqual(row, { recipient: "contact@market-c.test", status: "sent" });
});

test("进程在取走之后、开始发之前退出：没发出去，放回去由下一轮发，不算「可能已发出」、不用人处理", async () => {
  const order = await placeOrder();
  await payFor(order.orderId);
  await site.app.notificationJobs.expandEvents(api.clock.now());
  const row = await guestRow(order.orderId);
  const now = api.clock.now();
  const claimed = await withPlatformTx(api.db.pool, (db) => claimDueNotifications(db, now, new Date(now.getTime() - 1), 50, { preparing: true }));
  assert.ok(claimed.some((item) => item.id === row.id));
  await site.app.notificationJobs.tick();
  const done = await guestRow(order.orderId);
  assert.deepEqual([done.status, done.attempts, done.last_error_code], ["sent", 1, null], "放回去后同一轮就发了（到期的）");
  assert.equal(smtp.messages.filter((message) => message.to.includes(GUEST_EMAIL)).length, 1);
});

test("开始发之后才退出：才算「可能已发出」", async () => {
  const seeded = await seedOrder(api, m, "a", { serviceAt: new Date(api.clock.now().getTime() + 100 * HOUR) });
  await enqueueNotificationFromPlatform({ event: "order.rescue_assigned", tenantId: m.a.tenantId, orderId: seeded.id, data: {} }, `crash-${randomUUID()}`);
  await site.app.notificationJobs.expandEvents(api.clock.now());
  const now = api.clock.now();
  const claimed = await withPlatformTx(api.db.pool, (db) => claimDueNotifications(db, now, new Date(now.getTime() + 60_000), 50, { preparing: true }));
  const mine = claimed.find((item) => item.orderId === seeded.id);
  assert.ok(mine);
  assert.equal(await withPlatformTx(api.db.pool, (db) => beginSending(db, mine, new Date(now.getTime() - 1))), true);
  await site.app.notificationJobs.tick();
  const row = (await rowsOf(seeded.id)).find((item) => item.id === mine.id);
  assert.deepEqual([row.status, row.last_error_code], ["failed", "OUTCOME_UNKNOWN"]);
});

test("一批排得长也不会在发送前过期：开始发时租约重新计时；别人接手后这一方不发", async () => {
  const seeded = await seedOrder(api, m, "a", { serviceAt: new Date(api.clock.now().getTime() + 110 * HOUR) });
  await enqueueNotificationFromPlatform({ event: "order.rescue_assigned", tenantId: m.a.tenantId, orderId: seeded.id, data: {} }, `lease-${randomUUID()}`);
  await site.app.notificationJobs.expandEvents(api.clock.now());
  const now = api.clock.now();
  const claimed = await withPlatformTx(api.db.pool, (db) => claimDueNotifications(db, now, new Date(now.getTime() + 60_000), 50, { preparing: true }));
  const mine = claimed.find((item) => item.orderId === seeded.id);
  assert.ok(mine);
  assert.ok(NOTIFICATION_LEASE_MS > SMTP_SEND_DEADLINE_MS * 2, "租约要比一次发信的总时限长得多");
  api.clock.advance(59_000);
  const before = (await rowsOf(seeded.id)).find((item) => item.id === mine.id).lease_until as Date;
  await withPlatformTx(api.db.pool, (db) => beginSending(db, mine, new Date(api.clock.now().getTime() + NOTIFICATION_LEASE_MS)));
  const after = (await rowsOf(seeded.id)).find((item) => item.id === mine.id);
  assert.ok(new Date(after.lease_until).getTime() > before.getTime());
  assert.equal(after.prepared_only, false);
  await api.db.owner.query("update notifications set status = 'expired', last_error_code = 'ORDER_STATE_CHANGED', lease_token = null, lease_until = null where id = $1", [mine.id]);
});

test("救援改派中：积压的客人确认邮件照发，不被永久作废", async () => {
  const order = await placeOrder();
  await payFor(order.orderId);
  await site.app.notificationJobs.expandEvents(api.clock.now());
  await api.db.owner.query("update orders set status = 'rescue_pending' where id = $1", [order.orderId]);
  await site.app.notificationJobs.tick();
  assert.equal((await guestRow(order.orderId)).status, "sent");
  const tenantRows = (await rowsOf(order.orderId)).filter((row) => row.audience === "tenant" && row.event === "order.confirmed");
  assert.ok(tenantRows.every((row) => row.status === "expired" && row.last_error_code === "ORDER_STATE_CHANGED"), "供应商的那一行已经不归它了");
});

test("改了用车时间：等待中的记录有效期跟着改，改晚了不会提前过期", async () => {
  const seeded = await seedOrder(api, m, "a", { serviceAt: new Date(api.clock.now().getTime() + 50 * HOUR) });
  await enqueueNotificationFromPlatform({ event: "order.rescue_assigned", tenantId: m.a.tenantId, orderId: seeded.id, data: {} }, `rebase-${randomUUID()}`);
  await unconfigured.app.notificationJobs.tick();
  const later = new Date(api.clock.now().getTime() + 90 * HOUR);
  await api.db.owner.query("update orders set service_at = $2 where id = $1", [seeded.id, later]);
  await enqueueNotificationFromPlatform({ event: "order.changed", tenantId: m.a.tenantId, orderId: seeded.id, data: { fields: ["service_time"] } }, `rebase-${randomUUID()}`);
  await unconfigured.app.notificationJobs.tick();
  const row = (await rowsOf(seeded.id)).find((item) => item.event === "order.rescue_assigned");
  assert.equal(new Date(row.expires_at).getTime(), later.getTime());
});

test("清掉免打扰：推迟中的通知下一轮就发，不等到原来算好的时间；改成还覆盖现在的时段则继续等", async () => {
  const token = await tenantTokenA();
  const current = (await api.call("GET", "/tenant/v1/notification-settings", { token })).body;
  const localHour = (api.clock.now().getUTCHours() + 9) % 24;
  const pad = (hour: number): string => `${String(hour).padStart(2, "0")}:00`;
  const saved = await ok(api.call("PUT", "/tenant/v1/notification-settings", { token, ...(current.version === 0 ? {} : { headers: { "if-match": `"${current.version}"` } }), body: { quiet_hours: { start: pad(localHour), end: pad((localHour + 3) % 24) } } }));
  const seeded = await seedOrder(api, m, "a", { serviceAt: new Date(api.clock.now().getTime() + 300 * HOUR) });
  await enqueueNotificationFromPlatform({ event: "order.rescue_assigned", tenantId: m.a.tenantId, orderId: seeded.id, data: {} }, `quiet-${randomUUID()}`);
  await site.app.notificationJobs.tick();
  assert.equal((await rowsOf(seeded.id))[0].last_error_code, "QUIET_HOURS");

  api.clock.advance(1_000);
  const longer = await ok(api.call("PUT", "/tenant/v1/notification-settings", { token, headers: { "if-match": `"${saved.version}"` }, body: { quiet_hours: { start: pad(localHour), end: pad((localHour + 5) % 24) } } }));
  await site.app.notificationJobs.tick();
  const stillHeld = (await rowsOf(seeded.id))[0];
  assert.equal(stillHeld.status, "pending");

  api.clock.advance(1_000);
  await ok(api.call("PUT", "/tenant/v1/notification-settings", { token, headers: { "if-match": `"${longer.version}"` }, body: { quiet_hours: null } }));
  await site.app.notificationJobs.tick();
  assert.equal((await rowsOf(seeded.id))[0].status, "sent");
});

test("姓名、地址里的换行在接口层被拒（官网下单、渠道下单、改单都是单行字段）", async () => {
  const order = await placeOrder();
  const view = await site.call("GET", "/site/v1/order", { token: order.token });
  for (const body of [{ passenger: { ...PASSENGER, name: "王\n小明" } }, { passenger: { ...PASSENGER, name: "王\u2028小明" } }, { dropoff_address: "东京站\r\n假通知" }]) {
    const res = await site.call("PATCH", "/site/v1/order", { token: order.token, headers: { "if-match": `"${view.body.order.version}"` }, body });
    assert.deepEqual([res.status, res.body.error.code], [400, "VALIDATION_FAILED"], JSON.stringify(body));
  }
  const token = await other.token();
  const created = await api.call("POST", "/sales/v1/orders", { token, headers: { "idempotency-key": randomUUID() }, body: { quote_id: "QT20261007ABCDEFGHJK", passenger: { ...PASSENGER, name: "王\n小明" }, save_payment_method: true } });
  assert.deepEqual([created.status, created.body.error.code], [400, "VALIDATION_FAILED"]);
});

test("坏事件隔离后看得见：出错到上限不再处理，运营后台有数量；只算全平台不限范围的人", async () => {
  await api.db.owner.query("insert into notification_events (tenant_id, event, dedupe_key, data, occurred_at) values ($1, 'extra_charge.submitted', $2, $3, $4)", [m.a.tenantId, `bad-${randomUUID()}`, JSON.stringify({ dispute_until: "not-a-date" }), api.clock.now()]);
  await site.app.notificationJobs.tick();
  const stored = (await api.db.owner.query("select expanded_at, expand_attempts, expand_error from notification_events where data ->> 'dispute_until' = 'not-a-date' order by occurred_at desc limit 1")).rows[0];
  assert.equal(stored.expand_attempts, 3);
  assert.ok(stored.expanded_at);
  assert.equal(stored.expand_error, "EXPAND_FAILED");
  assert.ok(logLines.join("").includes("notification.expand_failed"));
  const page = await site.call("GET", "/platform/v1/notifications", { token: m.staff.operations.token });
  assert.equal(page.status, 200, page.text);
  assertMatchesOpenApi("GET", "/platform/v1/notifications", page);
  assert.ok(page.body.summary.failed_events >= 1);
});

test("改回原用车时间能重新提醒，但同一个用车时刻没作废的不会重复排", async () => {
  const seeded = await placeOrder();
  await payFor(seeded.orderId);
  await site.app.notificationJobs.tick();
  const service = new Date(api.clock.now().getTime() + 20 * HOUR);
  await api.db.owner.query("update orders set service_at = $2, confirmed_at = $3 where id = $1", [seeded.orderId, service, new Date(service.getTime() - 40 * 24 * HOUR)]);
  assert.ok((await site.app.notificationJobs.sweepReminders()) >= 1);
  assert.equal(await countReminders(seeded.orderId), 1);
  await site.app.notificationJobs.sweepReminders();
  assert.equal(await countReminders(seeded.orderId), 1, "等着发的不重复排");
});

const countReminders = async (orderId: string): Promise<number> => (await api.db.owner.query("select 1 from notification_events where order_id = $1 and event = 'order.service_reminder'", [orderId])).rowCount ?? 0;
