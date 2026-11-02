/**
 * M4-31：运营「代客人改单」改乘客邮箱要双人复核（ADR 0065），经真实接口、真实 PostgreSQL、本机假 SMTP（从不连真实的邮件服务）。
 * - 一个人改不了：改了邮箱的那一项发起复核 `order.passenger_email`，批准前订单上的邮箱不变，新地址收不到任何信；
 * - 同一次提交的其他字段照常（联系信息直接生效、履约字段等供应商确认）；只改邮箱的不产生改单记录；
 * - 发起人不能批、客服不能批；运营批准后才生效，之后带链接的通知发到新地址；驳回、撤回不改、不发；
 * - 等审核期间的新邮箱加密存，有结论就清空；审计、复核记录、应答里只有打码地址；
 * - 客人自己用订单链接改邮箱、渠道替客人改：照旧直接生效；审核期间客人自己改过的，批准 409；
 * - 权限和隔离：没权限的角色、租户令牌、数据范围外的运营进不来；供应商看不到新邮箱。
 * 全部是虚构数据，测试结束删掉整个 schema。
 */
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { type TestApi, createTestApi } from "./testing/api.ts";
import { type FakeSmtp, decodedMailText, startFakeSmtp } from "./testing/fake-integrations.ts";
import { type Market, type Staff, addStaff, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { platformLogin, tenantLogin } from "./testing/money.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";
import { FakePaymentProvider, deliverWebhook } from "./testing/payments.ts";
import { type SalesFlow, salesFlow } from "./testing/sales-flow.ts";
import { type SiteApi, siteApi } from "./testing/site.ts";

const ADDRESS = { lng: 139.7, lat: 35.6 };
const REVIEW = { verification: "callback_phone", reason: "客人来电说下单邮箱填错了，回拨下单电话确认是本人" };

let api: TestApi;
let m: Market;
let smtp: FakeSmtp;
let pay: FakePaymentProvider;
let site: SiteApi;
let other: SalesFlow;
let cs: Staff;
let ops2: Staff;
let ipSeq = 0;

const nextIp = (): string => `198.51.${100 + Math.floor((ipSeq += 1) / 250)}.${(ipSeq % 250) + 1}`;
const fictional = (label: string): string => `fictional.${label}.${randomUUID().slice(0, 8)}@example.test`;

before(async () => {
  smtp = await startFakeSmtp();
  const smtpEnv = { SMTP_HOST: smtp.host, SMTP_PORT: String(smtp.port), SMTP_ENCRYPTION: "none", SMTP_USERNAME: "mailer", SMTP_PASSWORD: "fake-smtp-password-Wd5", SMTP_FROM_NAME: "NOZOMI", SMTP_FROM_ADDRESS: "noreply@example.test" };
  pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay, env: { ...smtpEnv, PUBLIC_BASE_URL: "https://book.example.test" }, integrationSecretsTtlMs: 0 });
  m = await buildMarket(api);
  const siteChannelId = (await newChannel(api, m.staff.cm1.token, { name: "NOZOMI 官网" })).id;
  const clientId = (await salesCredentials(api, m, siteChannelId)).clientId;
  site = await siteApi(api, clientId, pay, { ...smtpEnv, PUBLIC_BASE_URL: "https://book.example.test" }, { integrationSecretsTtlMs: 0 });
  other = await salesFlow(api, m, pay);
  cs = await addStaff(api, m.root, "cs.email-review@platform.test", "customer_service");
  ops2 = await addStaff(api, m.root, "ops2.email-review@platform.test", "operations");
});

after(async () => {
  await site?.close();
  await api.close();
  await smtp.close();
});

beforeEach(() => {
  smtp.reset();
});

const login = (email: string): Promise<string> => platformLogin(api, email);

/** 官网下单并付款（确认后的单才能改）。 */
async function paidSiteOrder(email: string): Promise<{ order: any; token: string }> {
  api.clock.advance(1_000);
  const ip = nextIp();
  const quoted = await ok(site.call("POST", "/site/v1/quotes", { ip, body: { city_id: m.ids.tokyo, airport_id: m.ids.narita, direction: "pickup", address: ADDRESS, service_local: "2026-10-30T10:00", passengers: 2, luggage: 1 } }));
  const quote = quoted.quotes.find((q: any) => q.vehicle_group.id === m.ids.biz7);
  assert.ok(quote, JSON.stringify(quoted));
  api.clock.advance(1_000);
  const created = await ok(
    site.call("POST", "/site/v1/orders", {
      ip,
      headers: { "idempotency-key": randomUUID() },
      body: { quote_id: quote.quote_id, passenger: { name: "虚构乘客", phone: "+81 90-1111-2222", email }, flight_no: "NH211", dropoff_address: "虚构市虚构路一号", save_payment_method: true },
    }),
    201,
  );
  const intent = pay.intentOf(created.order.id);
  assert.ok(intent);
  pay.pay(intent.id);
  const raw = pay.event("payment_intent.succeeded", pay.intentObject(intent.id), { created: api.clock.now() });
  const delivered = await deliverWebhook(api.app, raw, pay.sign(raw, api.clock.now()));
  assert.equal(delivered.status, 200, JSON.stringify(delivered.body));
  await deliver();
  smtp.reset();
  return { order: created.order, token: created.link.token };
}

async function deliver(): Promise<void> {
  await site.app.backgroundIdle();
  await api.app.notificationJobs.tick();
}
const mailsTo = (email: string): string[] => smtp.messages.filter((message) => message.to.includes(email)).map((message) => decodedMailText(message.data));
const tokenIn = (text: string): string | null => /\/book\/order#(nzo_[A-Za-z0-9_-]{43})/.exec(text)?.[1] ?? null;
const guestOrder = (token: string) => site.call("GET", "/site/v1/order", { token, ip: nextIp() });

async function detail(orderId: string, token = m.staff.operations.token): Promise<any> {
  return ok(api.call("GET", `/platform/v1/orders/${orderId}`, { token }));
}

async function platformPatch(orderId: string, token: string, body: Record<string, unknown>) {
  const version = (await detail(orderId)).order.version;
  api.clock.advance(1_000);
  return api.call("PATCH", `/platform/v1/orders/${orderId}`, { token, headers: { "if-match": `"${version}"` }, body });
}

async function passengerOf(orderId: string): Promise<{ name: string; phone: string; email: string }> {
  return (await ok(api.call("POST", `/platform/v1/orders/${orderId}/passenger/reveal`, { token: m.staff.operations.token }))).passenger;
}

const decide = (approvalId: string, decision: "approve" | "reject" | "withdraw", token: string, body: Record<string, unknown> = {}) => api.call("POST", `/platform/v1/approvals/${approvalId}/${decision}`, { token, body });

/** 和这张单有关的全部审计（订单、改单、复核）。 */
async function auditText(orderId: string): Promise<string> {
  const rows = await api.db.owner.query(
    "select resource, action, before, after from audit_logs where resource_id = $1 or after->>'order_id' = $1::text or before->>'order_id' = $1::text or (resource = 'approval' and after->>'resource_id' = $1::text) order by occurred_at, id",
    [orderId],
  );
  return JSON.stringify(rows.rows);
}

test("一个人改不了乘客邮箱：发起复核，批准前订单邮箱不变、新地址收不到信，同一次提交的姓名直接生效；客服、发起人不能批；运营批准后生效并通知新地址", async () => {
  const email = fictional("guest");
  const placed = await paidSiteOrder(email);
  const fresh = fictional("fresh");

  const bypass = await platformPatch(placed.order.id, cs.token, { passenger: { name: "虚构乘客", phone: "+81 90-1111-2222", email: fresh } });
  assert.equal(bypass.status, 400, `原来一个人就能改掉邮箱：${bypass.text}`);
  assert.equal((await passengerOf(placed.order.id)).email, email);
  const missing = await platformPatch(placed.order.id, cs.token, { passenger: { name: "虚构新姓名", email: fresh } });
  assertMatchesOpenApi("PATCH", "/platform/v1/orders/{id}", missing);
  assert.deepEqual([missing.status, missing.body.error.code], [400, "VALIDATION_FAILED"], missing.text);
  assert.ok(missing.body.error.details.issues.some((issue: any) => issue.path === "/email_review"), "改邮箱要写核实方式和原因");
  assert.equal((await passengerOf(placed.order.id)).name, "虚构乘客", "校验失败什么都不改");

  const res = await platformPatch(placed.order.id, cs.token, { passenger: { name: "虚构新姓名", email: fresh }, email_review: REVIEW });
  assertMatchesOpenApi("PATCH", "/platform/v1/orders/{id}", res);
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.change.status, "applied", "姓名直接生效");
  assert.equal(res.body.email_review.status, "pending_review");
  assert.match(res.body.email_review.email_masked, /^fi\*\*\*@example\.test$/);
  assert.equal(res.text.includes(fresh), false, "应答里只有打码地址");
  const approvalId = res.body.email_review.approval_id;

  const now = await passengerOf(placed.order.id);
  assert.deepEqual([now.name, now.email], ["虚构新姓名", email], "邮箱等批准，姓名已改");
  const shown = await detail(placed.order.id, cs.token);
  assertMatchesOpenApi("GET", "/platform/v1/orders/{id}", { status: 200, headers: {}, text: JSON.stringify(shown), body: shown });
  assert.equal(shown.pending_email_review.approval_id, approvalId);
  assert.equal(JSON.stringify(shown).includes(fresh), false);
  const stored = await api.db.owner.query("select status, email, email_enc, previous_email, previous_email_enc, email_masked from passenger_email_changes where approval_id = $1", [approvalId]);
  assert.equal(stored.rows[0].status, "pending_review");
  assert.notEqual(stored.rows[0].email_enc, null, "等审核期间的新邮箱加密存（明文列按 PASSENGER_PLAINTEXT_WRITE，和订单的乘客信息一样）");
  assert.notEqual(stored.rows[0].previous_email_enc, null);

  await deliver();
  assert.equal(mailsTo(fresh).length, 0, "批准之前新地址收不到任何信");
  const oldMails = mailsTo(email);
  assert.ok(oldMails.length >= 1, "姓名改了：订单修改的通知发到原来的邮箱");

  const approvalRes = await api.call("GET", `/platform/v1/approvals/${approvalId}`, { token: m.staff.operations.token });
  assertMatchesOpenApi("GET", "/platform/v1/approvals/{id}", approvalRes);
  const approval = await ok(Promise.resolve(approvalRes));
  assert.equal(approval.approval.kind, "order.passenger_email");
  assert.equal(JSON.stringify(approval).includes(fresh), false, "复核记录里只有打码地址");
  assert.equal(JSON.stringify(approval).includes(email), false);

  const byCs = await decide(approvalId, "approve", cs.token);
  assert.ok([403, 409].includes(byCs.status), `客服（这里也是发起人）不能批：${byCs.text}`);
  const csOther = await addStaff(api, m.root, `cs.other.${randomUUID().slice(0, 6)}@platform.test`, "customer_service");
  assert.equal((await decide(approvalId, "approve", csOther.token)).status, 403, "不是发起人的客服也不能批");
  assert.equal((await passengerOf(placed.order.id)).email, email);

  const approved = await ok(decide(approvalId, "approve", m.staff.operations.token, { note: "回拨核实过" }));
  assert.equal(approved.approval.status, "approved");
  assert.equal((await passengerOf(placed.order.id)).email, fresh, "批准后才生效");
  const cleared = await api.db.owner.query("select status, email, email_enc, previous_email, previous_email_enc, change_id from passenger_email_changes where approval_id = $1", [approvalId]);
  assert.deepEqual([cleared.rows[0].status, cleared.rows[0].email, cleared.rows[0].email_enc, cleared.rows[0].previous_email, cleared.rows[0].previous_email_enc], ["applied", null, null, null, null], "有结论后清空");
  assert.ok(cleared.rows[0].change_id, "生效的那次改单记下来");
  assert.equal((await detail(placed.order.id)).pending_email_review, null);

  await deliver();
  const newMails = mailsTo(fresh);
  assert.equal(newMails.length, 1, "批准后新地址收到订单修改的通知");
  const link = tokenIn(newMails[0] as string);
  assert.ok(link, "通知里带订单链接");
  assert.equal((await guestOrder(link)).body.order.id, placed.order.id);

  const audit = await auditText(placed.order.id);
  assert.equal(audit.includes(fresh), false, "审计里只有打码地址");
  assert.equal(audit.includes(email), false);
  assert.ok(audit.includes("order.passenger_email"), "发起复核有审计");
});

test("发起人不能批（运营发起，自己批 409）；驳回、撤回：订单邮箱不变、新地址不收信、新邮箱清空；同一张单同时只有一条在等", async () => {
  const email = fictional("guest");
  const placed = await paidSiteOrder(email);
  const first = fictional("first");
  const requested = await platformPatch(placed.order.id, ops2.token, { passenger: { email: first }, email_review: { verification: "order_details", reason: "核对了行程、用车时间和人数" } });
  assertMatchesOpenApi("PATCH", "/platform/v1/orders/{id}", requested);
  assert.equal(requested.status, 202, `只改邮箱：没有立即生效的改动，202：${requested.text}`);
  assert.equal(requested.body.change, null);
  const approvalId = requested.body.email_review.approval_id;
  const changes = await api.db.owner.query("select count(*)::int as n from order_changes where order_id = $1", [placed.order.id]);
  assert.equal(changes.rows[0].n, 0, "只改邮箱不产生改单记录");

  const self = await decide(approvalId, "approve", ops2.token);
  assert.deepEqual([self.status, self.body.error.code], [409, "APPROVAL_SELF_REVIEW"]);
  const again = await platformPatch(placed.order.id, cs.token, { passenger: { email: fictional("again") }, email_review: REVIEW });
  assert.deepEqual([again.status, again.body.error.code], [409, "PASSENGER_EMAIL_REVIEW_PENDING"], again.text);
  assert.equal(again.body.error.details.approval_id, approvalId);
  const contactWhilePending = await platformPatch(placed.order.id, cs.token, { notes: "等审核期间别的字段照改" });
  assert.equal(contactWhilePending.status, 200, contactWhilePending.text);

  await ok(decide(approvalId, "reject", m.staff.operations.token, { note: "核实不充分" }));
  const second = fictional("second");
  const requested2 = await ok(platformPatch(placed.order.id, cs.token, { passenger: { email: second }, email_review: REVIEW }), 202);
  await ok(decide(requested2.email_review.approval_id, "withdraw", cs.token));
  const rows = await api.db.owner.query("select status, email, email_enc, previous_email, previous_email_enc from passenger_email_changes where order_id = $1 order by created_at", [placed.order.id]);
  assert.deepEqual(rows.rows.map((row) => [row.status, row.email, row.email_enc, row.previous_email, row.previous_email_enc]), [["dismissed", null, null, null, null], ["dismissed", null, null, null, null]]);
  assert.equal((await passengerOf(placed.order.id)).email, email);
  await deliver();
  assert.equal(mailsTo(first).length + mailsTo(second).length, 0);
  assert.equal((await auditText(placed.order.id)).includes(first), false);
});

test("其他字段照常：履约字段（人数）等供应商确认、备注直接生效、邮箱进复核——同一次提交互不阻塞；同一个邮箱的不同写法不用复核", async () => {
  const email = fictional("guest");
  const placed = await paidSiteOrder(email);
  const fresh = fictional("fresh");
  const res = await platformPatch(placed.order.id, m.staff.operations.token, { passengers: 3, notes: "带一个婴儿车", passenger: { email: fresh }, email_review: REVIEW });
  assertMatchesOpenApi("PATCH", "/platform/v1/orders/{id}", res);
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.change.status, "pending_confirmation", "人数等供应商确认");
  assert.equal(res.body.email_review.status, "pending_review");
  const shown = await detail(placed.order.id);
  assert.deepEqual([shown.order.notes, shown.order.passengers], ["带一个婴儿车", 2], "备注已生效，人数没变");
  assert.deepEqual(shown.changes.map((change: any) => change.status).sort(), ["applied", "pending_confirmation"]);
  assert.equal((await passengerOf(placed.order.id)).email, email);
  await ok(decide(res.body.email_review.approval_id, "approve", ops2.token));
  assert.equal((await passengerOf(placed.order.id)).email, fresh);
  assert.equal((await detail(placed.order.id)).changes.filter((change: any) => change.status === "pending_confirmation").length, 1, "邮箱生效不影响等确认的那一项");

  const sameMailbox = await platformPatch(placed.order.id, cs.token, { passenger: { email: ` ${fresh.toUpperCase()} ` } });
  assert.equal(sameMailbox.status, 200, `同一个收件箱的不同写法不用复核：${sameMailbox.text}`);
  assert.equal(sameMailbox.body.email_review, null);
});

test("客人自己用订单链接改邮箱照旧直接生效；审核期间客人自己改过的，批准 409（不覆盖客人填的），驳回后保留客人的", async () => {
  const email = fictional("guest");
  const placed = await paidSiteOrder(email);
  const byStaff = fictional("staff");
  const requested = await ok(platformPatch(placed.order.id, cs.token, { passenger: { email: byStaff }, email_review: REVIEW }), 202);
  const view = (await guestOrder(placed.token)).body.order;
  const guestEmail = fictional("self");
  const changed = await site.call("PATCH", "/site/v1/order", { token: placed.token, ip: nextIp(), headers: { "if-match": `"${view.version}"` }, body: { passenger: { name: "虚构乘客", phone: "+81 90-1111-2222", email: guestEmail } } });
  assert.equal(changed.status, 200, changed.text);
  assert.equal((await passengerOf(placed.order.id)).email, guestEmail, "客人拿着链接，本来就有权改：直接生效");
  const stale = await decide(requested.email_review.approval_id, "approve", m.staff.operations.token);
  assert.deepEqual([stale.status, stale.body.error.code], [409, "APPROVAL_STALE"], stale.text);
  assert.equal(stale.text.includes(guestEmail) || stale.text.includes(byStaff), false);
  await ok(decide(requested.email_review.approval_id, "reject", m.staff.operations.token, { note: "客人已自己改" }));
  assert.equal((await passengerOf(placed.order.id)).email, guestEmail);
  await deliver();
  assert.equal(mailsTo(byStaff).length, 0);
});

test("渠道替客人改邮箱不受影响（渠道的单，客人的通知由渠道发）", async () => {
  const order = await other.paidOrder();
  const version = (await ok(api.call("GET", `/sales/v1/orders/${order.id}`, { token: await other.token() }))).order.version;
  const fresh = fictional("channel");
  const res = await api.call("PATCH", `/sales/v1/orders/${order.id}`, { token: await other.token(), headers: { "if-match": `"${version}"` }, body: { passenger: { name: "王小明", phone: "+819012345678", email: fresh } } });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.change.status, "applied");
  assert.equal((await passengerOf(order.id)).email, fresh);
});

test("权限：财务、风控、只读改不了；租户令牌进不来；供应商（本单和别家）看不到新邮箱和复核；数据范围外的运营 404、看不到复核", async () => {
  const email = fictional("guest");
  const placed = await paidSiteOrder(email);
  const fresh = fictional("fresh");
  const finance = await addStaff(api, m.root, `fin.${randomUUID().slice(0, 6)}@platform.test`, "finance");
  const risk = await addStaff(api, m.root, `risk.${randomUUID().slice(0, 6)}@platform.test`, "risk");
  for (const token of [finance.token, risk.token, m.staff.readonly.token]) {
    assert.equal((await platformPatch(placed.order.id, token, { passenger: { email: fresh }, email_review: REVIEW })).status, 403);
  }
  const tenantB = await tenantLogin(api, m.b.adminEmail);
  const tenantA = await tenantLogin(api, m.a.adminEmail);
  assert.equal((await api.call("PATCH", `/platform/v1/orders/${placed.order.id}`, { token: tenantB, headers: { "if-match": '"1"' }, body: { passenger: { email: fresh }, email_review: REVIEW } })).status, 401, "租户令牌不能调平台接口");

  const requested = await ok(platformPatch(placed.order.id, cs.token, { passenger: { email: fresh }, email_review: REVIEW }), 202);
  const own = await api.call("GET", `/tenant/v1/orders/${placed.order.id}`, { token: tenantB });
  assert.equal(own.status, 200, own.text);
  assert.equal(own.text.includes(fresh) || own.text.includes(requested.email_review.approval_id) || own.text.includes("pending_email_review"), false, "接单的供应商看不到等审核的新邮箱");
  assert.equal((await api.call("GET", `/tenant/v1/orders/${placed.order.id}`, { token: tenantA })).status, 404, "别家供应商读不到这张单");
  assert.equal((await api.call("GET", `/platform/v1/approvals/${requested.email_review.approval_id}`, { token: tenantB })).status, 401);

  const root = await login("root@platform.test");
  const grants = ["orders:view", "orders:edit", "order_view_link:view", "order_view_link:review", "approvals:view"];
  const roleIn = async (cityId: string): Promise<string> => {
    const created = await ok(api.call("POST", "/platform/v1/roles", { token: root, body: { name: `邮箱复核 ${randomUUID().slice(0, 6)}`, grants, data_scope: { city_ids: [cityId], channel_ids: null } } }), 201);
    const staff = await addStaff(api, root, `scoped.${randomUUID().slice(0, 8)}@platform.test`, created.role?.key ?? created.key);
    return login(staff.email);
  };
  const osaka = await roleIn(m.ids.osaka);
  assert.equal((await platformPatch(placed.order.id, osaka, { notes: "范围外" })).status, 404);
  assert.equal((await api.call("GET", `/platform/v1/approvals/${requested.email_review.approval_id}`, { token: osaka })).status, 404, "范围外看不到这条复核");
  assert.equal((await decide(requested.email_review.approval_id, "approve", osaka)).status, 404);
  assert.equal((await passengerOf(placed.order.id)).email, email);
  const tokyo = await roleIn(m.ids.tokyo);
  await ok(decide(requested.email_review.approval_id, "approve", tokyo));
  assert.equal((await passengerOf(placed.order.id)).email, fresh, "范围内、有审核权限的自建角色可以批");
});
