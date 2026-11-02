/**
 * M4-30：官网查订单改成把链接发到下单邮箱（ADR 0061），经真实接口、真实 PostgreSQL、本机假 SMTP（从不连真实的邮件服务）。
 * - 应答不透露订单是否存在：对上、对不上、订单号不存在、别的渠道的单、已脱敏，状态码、应答内容、应答头一样；发信在应答之后的后台任务里；
 * - 限速按地址、订单号、邮箱，和订单存不存在无关；限速后的应答也一样；
 * - 邮件里是新签发的查看链接（同一套令牌），能打开这张单；之前的链接（下单时的、上一封邮件的）继续有效；邮件里没有姓名、电话、行程、金额；
 * - 运营核实后重发：发到下单邮箱（运营、客服）；发到新邮箱要另一位同事审核（运营），发起人不能自己批准；没权限、不是官网的单、
 *   缺核实方式和原因都拒绝；全程审计；租户碰不到这几个接口；新邮箱有结论后从库里清掉。
 * 全部是虚构数据，测试结束删掉整个 schema。
 */
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { type TestApi, createTestApi } from "./testing/api.ts";
import { type FakeSmtp, decodedMailText, startFakeSmtp } from "./testing/fake-integrations.ts";
import { type Market, addStaff, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { tenantLogin } from "./testing/money.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";
import { FakePaymentProvider } from "./testing/payments.ts";
import { type SalesFlow, salesFlow } from "./testing/sales-flow.ts";
import { type SiteApi, siteApi } from "./testing/site.ts";

const HOUR = 3_600_000;
const NO_SMTP = { SMTP_HOST: "", SMTP_PORT: "", SMTP_ENCRYPTION: "", SMTP_USERNAME: "", SMTP_PASSWORD: "", SMTP_FROM_NAME: "", SMTP_FROM_ADDRESS: "" };
const ADDRESS = { lng: 139.7, lat: 35.6 };

let api: TestApi;
let m: Market;
let smtp: FakeSmtp;
let pay: FakePaymentProvider;
let site: SiteApi;
let siteClientId: string;
let other: SalesFlow;
let staff: { cs: { id: string; token: string }; ops2: { id: string; token: string }; finance: { token: string }; risk: { token: string } };
let ipSeq = 0;
let emailSeq = 0;

/** 每个用例用自己的来源地址：地址的额度不互相影响。 */
const nextIp = (): string => `198.51.${100 + Math.floor((ipSeq += 1) / 250)}.${(ipSeq % 250) + 1}`;
const newEmail = (): string => `fictional.guest${(emailSeq += 1)}.${randomUUID().slice(0, 8)}@example.test`;

before(async () => {
  smtp = await startFakeSmtp();
  const smtpEnv = { SMTP_HOST: smtp.host, SMTP_PORT: String(smtp.port), SMTP_ENCRYPTION: "none", SMTP_USERNAME: "mailer", SMTP_PASSWORD: "fake-smtp-password-Vx3", SMTP_FROM_NAME: "NOZOMI", SMTP_FROM_ADDRESS: "noreply@example.test" };
  pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay, env: smtpEnv, integrationSecretsTtlMs: 0 });
  m = await buildMarket(api);
  const siteChannelId = (await newChannel(api, m.staff.cm1.token, { name: "NOZOMI 官网" })).id;
  siteClientId = (await salesCredentials(api, m, siteChannelId)).clientId;
  site = await siteApi(api, siteClientId, pay, { ...smtpEnv, PUBLIC_BASE_URL: "https://book.example.test" }, { integrationSecretsTtlMs: 0 });
  other = await salesFlow(api, m, pay);
  staff = {
    cs: await addStaff(api, m.root, "cs@platform.test", "customer_service"),
    ops2: await addStaff(api, m.root, "ops2@platform.test", "operations"),
    finance: await addStaff(api, m.root, "finance@platform.test", "finance"),
    risk: await addStaff(api, m.root, "risk@platform.test", "risk"),
  };
});

after(async () => {
  await site?.close();
  await api.close();
  await smtp.close();
});

beforeEach(() => {
  smtp.reset();
});

async function placeOrder(email: string): Promise<{ order: any; link: { token: string } }> {
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
  return { order: created.order, link: created.link };
}

const lookup = (orderNo: string, email: string, ip = nextIp()) => site.call("POST", "/site/v1/orders/lookup", { ip, body: { order_no: orderNo, email } });
/** 后台任务（查单、排进通知中心）做完，再让通知中心发一轮。 */
async function deliver(): Promise<void> {
  await site.app.backgroundIdle();
  await site.app.notificationJobs.tick();
}
const mailsTo = (email: string): string[] => smtp.messages.filter((message) => message.to.includes(email)).map((message) => decodedMailText(message.data));
const tokenIn = (text: string): string | null => /\/book\/order#(nzo_[A-Za-z0-9_-]{43})/.exec(text)?.[1] ?? null;
const guestOrder = (token: string) => site.call("GET", "/site/v1/order", { token, ip: nextIp() });
/** 应答里和请求无关、每次都不同的头 */
const stableHeaders = (headers: Record<string, unknown>): string[] => Object.keys(headers).filter((name) => !["date", "x-request-id", "content-length"].includes(name)).sort();

test("应答不透露订单是否存在：对上、邮箱不对、订单号不存在、别的渠道的单、手机号也是邮箱的写法——状态码、内容、应答头都一样；只有对上的收到信", async () => {
  const email = newEmail();
  const placed = await placeOrder(email);
  const foreign = await other.unpaidOrder();
  // 应答之前不碰订单：订单表被锁住时，对上的那次照样马上 202；后台任务等锁放开才查单、排信
  const holder = await api.db.owner.connect();
  let matched;
  try {
    await holder.query("begin");
    await holder.query("lock table orders in access exclusive mode");
    matched = await Promise.race([lookup(placed.order.order_no, email), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("应答在等订单表：查单不该在应答之前")), 5_000))]);
    const queued = await api.db.owner.query("select count(*)::int as n from notification_events where event = 'order.view_link'");
    assert.equal(queued.rows[0].n, 0, "应答不等查单和发信");
  } finally {
    await holder.query("rollback");
    holder.release();
  }
  const cases = [
    { name: "对上", res: matched },
    { name: "对上（大小写、全角、空白不同）", res: await lookup(` ${placed.order.order_no.toLowerCase()} `, `　${email.toUpperCase().replace("@", "＠")} `) },
    { name: "邮箱不对", res: await lookup(placed.order.order_no, newEmail()) },
    { name: "订单号不存在", res: await lookup("NZ20261007ZZZZZZZZ", email) },
    { name: "别的渠道的单（下单邮箱是对的）", res: await lookup(foreign.order_no, "guest@example.com") },
  ];
  for (const { name, res } of cases) {
    assertMatchesOpenApi("POST", "/site/v1/orders/lookup", res);
    assert.equal(res.status, 202, `${name}：${res.text}`);
    assert.deepEqual(res.body, cases[0]?.res.body, name);
    assert.deepEqual(stableHeaders(res.headers), stableHeaders(cases[0]?.res.headers ?? {}), name);
  }
  await deliver();
  const mails = mailsTo(email);
  assert.equal(mails.length, 2, "两次对上的各一封");
  assert.equal(mailsTo("guest@example.com").length, 0, "别的渠道的客人不由平台发信");
  assert.equal(smtp.messages.length, 2, "对不上的不发任何信");
});

test("邮件里的链接：新签发的查看令牌能打开这张单；下单时的链接和上一封邮件的链接继续有效；邮件里没有姓名、电话、行程、金额", async () => {
  const email = newEmail();
  const placed = await placeOrder(email);
  assert.equal((await lookup(placed.order.order_no, email)).status, 202);
  await deliver();
  const first = mailsTo(email)[0] as string;
  const firstToken = tokenIn(first);
  assert.ok(firstToken, first);
  assert.match(first, /https:\/\/book\.example\.test\/book\/order#nzo_/);
  assert.match(first, new RegExp(placed.order.order_no));
  for (const secret of ["虚构乘客", "+81 90-1111-2222", "819011112222", "虚构市虚构路一号", "NH211", "JPY", "成田"]) assert.equal(first.includes(secret), false, `邮件里不该有 ${secret}`);

  const opened = await guestOrder(firstToken as string);
  assert.equal(opened.status, 200, opened.text);
  assert.equal(opened.body.order.id, placed.order.id);

  api.clock.advance(60_000);
  assert.equal((await lookup(placed.order.order_no, email)).status, 202);
  await deliver();
  const secondToken = tokenIn(mailsTo(email)[1] as string);
  assert.ok(secondToken && secondToken !== firstToken, "每封信是新签发的链接");
  for (const token of [placed.link.token, firstToken as string, secondToken as string]) assert.equal((await guestOrder(token)).status, 200, "新签发不吊销旧的");

  const links = await api.db.owner.query<{ issued_via: string; token_hash: string }>("select issued_via, token_hash from site_order_links where order_id = $1 order by created_at", [placed.order.id]);
  assert.deepEqual(links.rows.map((row) => row.issued_via), ["order", "email", "email"]);
  assert.equal(JSON.stringify(links.rows).includes(firstToken as string), false, "库里只有哈希");
  const events = await api.db.owner.query("select data from notification_events where order_id = $1 and event = 'order.view_link'", [placed.order.id]);
  assert.equal(JSON.stringify(events.rows).includes(email), false, "发件箱里没有邮箱");
  assert.equal(api.logs().includes(email) || api.logs().includes(firstToken as string), false, "日志里没有邮箱、令牌");
});

test("限速：每个地址 15 分钟 10 次；每个订单号每小时 3 次（换地址、换邮箱也挡）；每个邮箱每小时 3 次（换订单号也挡）；存不存在一样计、被挡的应答一样、被挡的不发信", async () => {
  const email = newEmail();
  const placed = await placeOrder(email);
  const missingNo = "NZ20261007QQQQQQQQ";

  // 订单号：存在的单和不存在的单，前 3 次都 202，第 4 次都 429，应答一样
  for (let i = 0; i < 3; i += 1) {
    assert.equal((await lookup(placed.order.order_no, i === 0 ? email : newEmail())).status, 202);
    assert.equal((await lookup(missingNo, newEmail())).status, 202);
  }
  const blockedReal = await lookup(placed.order.order_no, email);
  const blockedMissing = await lookup(missingNo, email);
  assertMatchesOpenApi("POST", "/site/v1/orders/lookup", blockedReal);
  assert.deepEqual([blockedReal.status, blockedReal.body.error.code], [429, "RATE_LIMITED"]);
  assert.deepEqual([blockedMissing.status, blockedMissing.body], [blockedReal.status, blockedReal.body], "存在和不存在的订单号被挡时应答一样");
  assert.equal(blockedReal.headers["retry-after"], blockedMissing.headers["retry-after"]);
  await deliver();
  assert.equal(mailsTo(email).length, 1, "被挡的那次不发");

  // 邮箱：换订单号也挡
  const target = newEmail();
  for (let i = 0; i < 3; i += 1) assert.equal((await lookup(`NZ20261007EMAIL00${i}`, target)).status, 202);
  const byEmail = await lookup("NZ20261007EMAIL009", target);
  assert.deepEqual([byEmail.status, byEmail.body.error.code], [429, "RATE_LIMITED"]);

  // 地址：15 分钟 10 次，被挡的不占订单号、邮箱的额度
  const ip = nextIp();
  for (let i = 0; i < 10; i += 1) assert.equal((await lookup(`NZ20261007IPADDR0${i}`, newEmail(), ip)).status, 202);
  const byIp = await lookup("NZ20261007IPADDR0A", newEmail(), ip);
  assert.deepEqual([byIp.status, byIp.body.error.code], [429, "RATE_LIMITED"]);
  const fresh = newEmail();
  for (let i = 0; i < 3; i += 1) await lookup("NZ20261007IPADDR0B", fresh, ip);
  assert.equal((await lookup("NZ20261007IPADDR0B", fresh)).status, 202, "被地址额度挡下的不算这个订单号、这个邮箱的次数");

  // 一小时后订单号的额度恢复（天的额度还剩）
  api.clock.advance(HOUR + 1_000);
  assert.equal((await lookup(placed.order.order_no, email)).status, 202);
});

test("格式不对的 400 和订单无关：手机号、不像邮箱的、不认识的字段", async () => {
  const placed = await placeOrder(newEmail());
  for (const body of [{ order_no: placed.order.order_no, email: "+819011112222" }, { order_no: placed.order.order_no, email: "not-an-email" }, { order_no: placed.order.order_no, contact: "x@example.test" }, { order_no: "NZ123", email: "x@example.test" }]) {
    const res = await site.call("POST", "/site/v1/orders/lookup", { ip: nextIp(), body });
    assertMatchesOpenApi("POST", "/site/v1/orders/lookup", res);
    assert.deepEqual([res.status, res.body.error.code], [400, "VALIDATION_FAILED"], JSON.stringify(body));
  }
});

test("邮件没配置：一律 503（和订单无关），页面让客人联系客服；不排任何通知", async () => {
  const unconfigured = await siteApi(api, siteClientId, pay, NO_SMTP, { integrationSecretsTtlMs: 0 });
  try {
    const email = newEmail();
    const placed = await placeOrder(email);
    const real = await unconfigured.call("POST", "/site/v1/orders/lookup", { ip: nextIp(), body: { order_no: placed.order.order_no, email } });
    const missing = await unconfigured.call("POST", "/site/v1/orders/lookup", { ip: nextIp(), body: { order_no: "NZ20261007NOSMTP00", email } });
    assertMatchesOpenApi("POST", "/site/v1/orders/lookup", real);
    assert.deepEqual([real.status, real.body.error.code], [503, "ORDER_LINK_EMAIL_UNAVAILABLE"]);
    assert.deepEqual([missing.status, missing.body], [real.status, real.body]);
    await unconfigured.app.backgroundIdle();
    const events = await api.db.owner.query("select count(*)::int as n from notification_events where order_id = $1 and event = 'order.view_link'", [placed.order.id]);
    assert.equal(events.rows[0].n, 0);
  } finally {
    await unconfigured.close();
  }
});

test("没配置官网：503 SITE_NOT_OPEN（和订单无关）", async () => {
  const closed = await siteApi(api, null, pay);
  try {
    const res = await closed.call("POST", "/site/v1/orders/lookup", { ip: nextIp(), body: { order_no: "NZ20261007ABCDEFGH", email: "x@example.test" } });
    assert.deepEqual([res.status, res.body.error.code], [503, "SITE_NOT_OPEN"]);
  } finally {
    await closed.close();
  }
});

test("已脱敏的单（ADR 0055）：和对不上一样，应答相同、不发信", async () => {
  const email = newEmail();
  const placed = await placeOrder(email);
  await api.db.owner.query("update orders set passenger_anonymized_at = now() where id = $1", [placed.order.id]);
  const res = await lookup(placed.order.order_no, email);
  assert.equal(res.status, 202);
  await deliver();
  assert.equal(mailsTo(email).length, 0);
});

// ---- 运营后台：核实后重发 ----

const viewLink = (orderId: string, token: string) => api.call("GET", `/platform/v1/orders/${orderId}/view-link`, { token });
const resend = (orderId: string, token: string, body: Record<string, unknown>) => api.call("POST", `/platform/v1/orders/${orderId}/view-link/resend`, { token, body });
const ORIGINAL = { target: "original", verification: "callback_phone", reason: "客人来电，回拨下单电话确认是本人，链接找不到了" };

async function auditOf(orderId: string): Promise<any[]> {
  return (await api.db.owner.query("select actor_id, resource, resource_id, action, after from audit_logs where resource_id = $1 or (resource = 'approval' and after->>'resource_id' = $1::text) order by occurred_at, id", [orderId])).rows;
}

test("运营重发到下单邮箱：客服、运营能发；先核实（方式、原因必填）；排进通知中心发出；有审计；旧链接照样有效", async () => {
  const email = newEmail();
  const placed = await placeOrder(email);
  const status = await viewLink(placed.order.id, staff.cs.token);
  assertMatchesOpenApi("GET", "/platform/v1/orders/{id}/view-link", status);
  assert.equal(status.status, 200, status.text);
  assert.deepEqual([status.body.available, status.body.unavailable_reason, status.body.pending_review], [true, null, null]);
  assert.match(status.body.email_masked, /^fi\*\*\*@example\.test$/);
  assert.equal(status.text.includes(email), false, "只有打码后的地址");

  for (const body of [{ target: "original" }, { ...ORIGINAL, verification: undefined }, { ...ORIGINAL, reason: "  " }, { ...ORIGINAL, verification: "guess" }]) {
    const res = await resend(placed.order.id, staff.cs.token, body);
    assertMatchesOpenApi("POST", "/platform/v1/orders/{id}/view-link/resend", res);
    assert.deepEqual([res.status, res.body.error.code], [400, "VALIDATION_FAILED"], JSON.stringify(body));
  }
  const sent = await resend(placed.order.id, staff.cs.token, ORIGINAL);
  assertMatchesOpenApi("POST", "/platform/v1/orders/{id}/view-link/resend", sent);
  assert.equal(sent.status, 202, sent.text);
  assert.deepEqual([sent.body.request.status, sent.body.request.target, sent.body.approval], ["queued", "original", null]);
  await deliver();
  const mail = mailsTo(email)[0] as string;
  assert.ok(mail, "发到了下单邮箱");
  assert.equal((await guestOrder(tokenIn(mail) as string)).body.order.id, placed.order.id);
  assert.equal((await guestOrder(placed.link.token)).status, 200, "旧链接仍有效");

  const audit = (await auditOf(placed.order.id)).filter((row) => row.action === "send_view_link");
  assert.equal(audit.length, 1);
  assert.deepEqual([audit[0].actor_id, audit[0].resource, audit[0].after.target, audit[0].after.verification], [staff.cs.id, "order", "original", "callback_phone"]);
  assert.match(audit[0].after.email_masked, /^fi\*\*\*@/);
  assert.equal(JSON.stringify(audit).includes(email), false, "审计里只有打码后的地址");
  const listed = await viewLink(placed.order.id, m.staff.operations.token);
  assert.deepEqual(listed.body.requests.map((row: any) => [row.target, row.status, row.verification]), [["original", "queued", "callback_phone"]]);
});

test("运营重发：没权限的角色 403（财务、风控、只读、渠道经理）；租户的令牌进不来；不是官网的单 409；不存在的单 404", async () => {
  const placed = await placeOrder(newEmail());
  for (const token of [staff.finance.token, staff.risk.token, m.staff.readonly.token, m.staff.cm1.token]) {
    const res = await resend(placed.order.id, token, ORIGINAL);
    assert.equal(res.status, 403, res.text);
  }
  assert.equal((await viewLink(placed.order.id, m.staff.cm1.token)).status, 403, "看不了订单的也看不了");
  const tenantToken = await tenantLogin(api, m.b.adminEmail);
  assert.equal((await resend(placed.order.id, tenantToken, ORIGINAL)).status, 401, "租户令牌不能调平台接口");
  assert.equal((await api.call("GET", `/tenant/v1/orders/${placed.order.id}/view-link`, { token: tenantToken })).status, 404, "供应商那边没有这个接口");

  const foreign = await other.unpaidOrder();
  const notSite = await resend(foreign.id, m.staff.operations.token, ORIGINAL);
  assert.deepEqual([notSite.status, notSite.body.error.code], [409, "NOT_SITE_ORDER"]);
  assert.deepEqual([(await viewLink(foreign.id, m.staff.operations.token)).body.available, (await viewLink(foreign.id, m.staff.operations.token)).body.unavailable_reason], [false, "NOT_SITE_ORDER"]);
  assert.equal((await resend(randomUUID(), m.staff.operations.token, ORIGINAL)).status, 404);
});

test("发到核实后的新邮箱：要另一位同事审核；发起人不能自己批；客服不能审核；批准后才发到新邮箱，下单邮箱不收；新邮箱有结论后从库里清掉；全程审计", async () => {
  const email = newEmail();
  const placed = await placeOrder(email);
  const fresh = newEmail();
  const same = await resend(placed.order.id, staff.cs.token, { ...ORIGINAL, target: "new_email", email: email.toUpperCase() });
  assert.deepEqual([same.status, same.body.error.code], [409, "SAME_AS_ORDER_EMAIL"]);
  assert.equal((await resend(placed.order.id, staff.cs.token, { ...ORIGINAL, target: "new_email" })).status, 400, "没填新邮箱");
  assert.equal((await resend(placed.order.id, staff.cs.token, { ...ORIGINAL, target: "original", email: fresh })).status, 400, "发到原邮箱不能带新邮箱");

  const requested = await resend(placed.order.id, staff.cs.token, { target: "new_email", email: fresh, verification: "payment_details", reason: "下单时邮箱写错了一个字母，核对了卡号末 4 位和付款时间" });
  assertMatchesOpenApi("POST", "/platform/v1/orders/{id}/view-link/resend", requested);
  assert.equal(requested.status, 202, requested.text);
  assert.equal(requested.body.request.status, "pending_review");
  const approvalId = requested.body.approval.id;
  assert.equal(requested.text.includes(fresh), false, "应答里只有打码后的地址");
  const stored = await api.db.owner.query("select recipient, recipient_enc, recipient_masked from view_link_requests where approval_id = $1", [approvalId]);
  assert.match(stored.rows[0].recipient_masked, /^fi\*\*\*@example\.test$/);
  const approval = await ok(api.call("GET", `/platform/v1/approvals/${approvalId}`, { token: m.staff.operations.token }));
  assert.equal(JSON.stringify(approval).includes(fresh), false, "复核记录里只有打码后的地址");
  assert.equal(approval.approval.kind, "order.view_link_email");

  const again = await resend(placed.order.id, m.staff.operations.token, { target: "new_email", email: newEmail(), verification: "other", reason: "又来一次" });
  assert.deepEqual([again.status, again.body.error.code], [409, "VIEW_LINK_REVIEW_PENDING"]);
  assert.equal((await viewLink(placed.order.id, staff.cs.token)).body.pending_review.approval_id, approvalId);

  await deliver();
  assert.equal(mailsTo(fresh).length + mailsTo(email).length, 0, "批准之前谁都不发");
  assert.equal((await api.call("POST", `/platform/v1/approvals/${approvalId}/approve`, { token: staff.cs.token, body: {} })).status, 403, "客服（这里也是发起人）不能审核");
  const approved = await ok(api.call("POST", `/platform/v1/approvals/${approvalId}/approve`, { token: m.staff.operations.token, body: { note: "核对过付款信息" } }));
  assert.equal(approved.approval.status, "approved");
  const cleared = await api.db.owner.query("select status, recipient, recipient_enc from view_link_requests where approval_id = $1", [approvalId]);
  assert.deepEqual([cleared.rows[0].status, cleared.rows[0].recipient, cleared.rows[0].recipient_enc], ["queued", null, null], "批准后新邮箱从这张表清掉");

  await deliver();
  const mail = mailsTo(fresh)[0] as string;
  assert.ok(mail, "发到了核实后的新邮箱");
  assert.equal(mailsTo(email).length, 0, "下单邮箱不收这一封");
  assert.equal((await guestOrder(tokenIn(mail) as string)).body.order.id, placed.order.id);
  const revealed = await ok(api.call("POST", `/platform/v1/orders/${placed.order.id}/passenger/reveal`, { token: m.staff.operations.token }));
  assert.equal(revealed.passenger.email, email, "不改订单上的邮箱：客人打开链接后自己改");

  const audit = await auditOf(placed.order.id);
  const sentAudit = audit.filter((row) => row.action === "send_view_link");
  assert.deepEqual(sentAudit.map((row) => [row.actor_id, row.after.target, row.after.approval_id]), [[m.staff.operations.id, "new_email", approvalId]]);
  assert.ok(audit.some((row) => row.resource === "approval" && row.action === "request"), "发起有审计");
  assert.equal(JSON.stringify(audit).includes(fresh), false);
});

test("发到新邮箱：运营发起的，自己不能批（409）；被驳回、被撤回：不发信，新邮箱从库里清掉，可以重新发起", async () => {
  const email = newEmail();
  const placed = await placeOrder(email);
  const first = newEmail();
  const requested = await ok(resend(placed.order.id, staff.ops2.token, { target: "new_email", email: first, verification: "order_details", reason: "核对了行程和人数" }), 202);
  const self = await api.call("POST", `/platform/v1/approvals/${requested.approval.id}/approve`, { token: staff.ops2.token, body: {} });
  assert.deepEqual([self.status, self.body.error.code], [409, "APPROVAL_SELF_REVIEW"]);
  await ok(api.call("POST", `/platform/v1/approvals/${requested.approval.id}/reject`, { token: m.staff.operations.token, body: { note: "核实不充分" } }));
  const second = newEmail();
  const again = await ok(resend(placed.order.id, staff.cs.token, { target: "new_email", email: second, verification: "callback_phone", reason: "回拨确认" }), 202);
  await ok(api.call("POST", `/platform/v1/approvals/${again.approval.id}/withdraw`, { token: staff.cs.token, body: {} }));
  const rows = await api.db.owner.query("select status, recipient, recipient_enc from view_link_requests where order_id = $1 order by created_at", [placed.order.id]);
  assert.deepEqual(rows.rows.map((row) => [row.status, row.recipient, row.recipient_enc]), [["dismissed", null, null], ["dismissed", null, null]]);
  await deliver();
  assert.equal(mailsTo(first).length + mailsTo(second).length + mailsTo(email).length, 0);
});

test("运营重发的连点保护：同一张单每小时 5 次", async () => {
  const placed = await placeOrder(newEmail());
  for (let i = 0; i < 5; i += 1) assert.equal((await resend(placed.order.id, staff.ops2.token, ORIGINAL)).status, 202);
  const limited = await resend(placed.order.id, staff.ops2.token, ORIGINAL);
  assert.deepEqual([limited.status, limited.body.error.code], [429, "RATE_LIMITED"]);
});
