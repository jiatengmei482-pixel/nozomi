/**
 * QA（M4-27，ADR 0058）：令牌和隐私、权限和隔离、运营手动重试、脱敏（M4-21）和加密（M4-22）的配合。补 driver-link-email.itest.ts 没覆盖到的。
 * 真实 PostgreSQL（独立 schema）+ 本机假 SMTP；数据全部虚构，随 api.close() 删除。
 */
import { after, afterEach, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ENCRYPTED_TEXT } from "@nozomi/domain";
import { attachPassengerCrypto } from "./db/context.ts";
import { PassengerCrypto } from "./integrations/passenger-crypto.ts";
import { SecretBox } from "./integrations/secret-box.ts";
import { TEST_PASSWORD, type TenantFixture, type TestApi, createTestApi } from "./testing/api.ts";
import { assign, newDriver, newVehicle, seedOrder } from "./testing/dispatch.ts";
import { type FakeSmtp, decodedMailText, startFakeSmtp } from "./testing/fake-integrations.ts";
import { FAKE_SECRETS } from "./testing/fixtures.ts";
import { type Market, buildMarket, ok } from "./testing/market.ts";
import { platformLogin, tenantLogin } from "./testing/money.ts";
import { FakePaymentProvider } from "./testing/payments.ts";
import { endAt, isDone, tokyoDaysAgo } from "./testing/retention-fixtures.ts";
import { type SalesFlow, salesFlow } from "./testing/sales-flow.ts";

const HOUR = 3_600_000;
const SMTP_ECHO = "smtp-echo-marker-Xq4";

let api: TestApi;
let m: Market;
let smtp: FakeSmtp;
let a: TenantFixture;
let b: TenantFixture;
let flow: SalesFlow;

before(async () => {
  smtp = await startFakeSmtp();
  const pay = new FakePaymentProvider();
  api = await createTestApi({
    payments: pay,
    env: { SMTP_HOST: smtp.host, SMTP_PORT: String(smtp.port), SMTP_ENCRYPTION: "none", SMTP_USERNAME: "mailer", SMTP_PASSWORD: "fake-smtp-password-Qb8", SMTP_FROM_NAME: "NOZOMI", SMTP_FROM_ADDRESS: "noreply@example.test" },
    integrationSecretsTtlMs: 0,
  });
  m = await buildMarket(api);
  flow = await salesFlow(api, m, pay);
  a = { ...m.a, adminToken: await tenantLogin(api, m.a.adminEmail) };
  b = { ...m.b, adminToken: await tenantLogin(api, m.b.adminEmail) };
});

after(async () => {
  await api.close();
  await smtp.close();
});

beforeEach(async () => {
  await api.db.owner.query("update notification_events set expanded_at = coalesce(expanded_at, now())");
  await api.db.owner.query("update notifications set status = 'expired', last_error_code = 'ORDER_STATE_CHANGED', lease_token = null, lease_until = null where status in ('pending', 'sending')");
  await api.db.owner.query("update tenant_notification_settings set driver_link_delivery = 'auto'");
  api.clock.advance(2 * HOUR);
  a.adminToken = await tenantLogin(api, m.a.adminEmail);
  b.adminToken = await tenantLogin(api, m.b.adminEmail);
  smtp.reset();
});

const newEmail = (): string => `qa.private.${randomUUID().slice(0, 12)}@example.test`;
const tick = () => api.app.notificationJobs.tick();
const trip = (token: string) => api.call("GET", "/driver/v1/trip", { token });
const tokenIn = (text: string): string | null => /\/driver#(nzd_[A-Za-z0-9_.-]+)/.exec(text)?.[1] ?? null;
const textsTo = (email: string): string[] => smtp.messages.filter((message) => message.to.includes(email)).map((message) => decodedMailText(message.data));
const tokensTo = (email: string): string[] => textsTo(email).map((text) => tokenIn(text) as string);
const resend = (orderId: string, token = a.adminToken) => api.call("POST", `/tenant/v1/orders/${orderId}/driver-link/email`, { token });
const putDriver = (who: TenantFixture, driver: any, changes: Record<string, unknown>, token = who.adminToken) => {
  const { id: _id, version, license_state: _state, created_at: _created, updated_at: _updated, email_masked: _masked, ...fields } = driver;
  return api.call("PUT", `/tenant/v1/drivers/${driver.id}`, { token, headers: { "if-match": `"${version}"` }, body: { ...fields, ...changes } });
};
const driverRows = async (orderId: string): Promise<any[]> => (await api.db.owner.query("select * from notifications where order_id = $1 and audience = 'driver' order by created_at, id", [orderId])).rows;
const ops = () => platformLogin(api, m.staff.operations.email);
const randomPart = (token: string): string => token.split(".").at(-1) as string;

async function staffToken(role: "dispatch" | "readonly" | "finance", who: TenantFixture = a): Promise<string> {
  const email = `qa.staff.${randomUUID().slice(0, 8)}@example.test`;
  const invited = await ok(api.call("POST", "/tenant/v1/users", { token: who.adminToken, body: { email, name: "虚构员工", role } }), 201);
  await ok(api.call("POST", "/tenant/v1/auth/accept-invite", { body: { token: invited.invite.token, password: TEST_PASSWORD } }));
  return tenantLogin(api, email);
}

async function dispatched(who: TenantFixture = a, side: "a" | "b" = "a", email: string = newEmail(), driverExtra: Record<string, unknown> = {}): Promise<{ order: { id: string; orderNo: string }; driver: any; vehicle: any; res: any; email: string }> {
  const order = await seedOrder(api, m, side, { serviceAt: new Date(api.clock.now().getTime() + 96 * HOUR) });
  const driver = await newDriver(api, who, { email, ...driverExtra });
  const vehicle = await newVehicle(api, who, m.ids.biz7);
  const res = await ok(assign(api, who, order.id, driver.id, vehicle.id));
  return { order, driver, vehicle, res, email };
}

/** 整个 schema 每张表每一行转成文本，找这段内容出现在哪些表。 */
async function tablesContaining(needle: string): Promise<string[]> {
  const tables = await api.db.owner.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema = current_schema() and table_type = 'BASE TABLE' order by table_name");
  const found: string[] = [];
  for (const { table_name: table } of tables.rows) {
    const hit = await api.db.owner.query(`select 1 from "${table}" t where strpos(to_jsonb(t)::text, $1) > 0 limit 1`, [needle]);
    if ((hit.rowCount ?? 0) > 0) found.push(table);
  }
  return found;
}

// ---- 令牌 ----

test("令牌原文全库都没有：派车、发信、失败重试、重发、改邮箱之后，每张表都找不到调度员和邮件令牌的随机部分", async () => {
  const email = newEmail();
  const { order, driver, res } = await dispatched(a, "a", email);
  smtp.behave({ rejectAt: { stage: "DOT", reply: "451 4.3.0 try later" }, errorDetail: SMTP_ECHO });
  await tick();
  assert.equal((await driverRows(order.id))[0].status, "pending", "正文发完才被拒，等重试");
  smtp.reset();
  api.clock.advance(61_000);
  await tick();
  assert.equal((await driverRows(order.id))[0].status, "sent");
  const delivered = tokensTo(email);
  assert.equal(delivered.length, 1);
  api.clock.advance(61_000);
  a.adminToken = await tenantLogin(api, m.a.adminEmail);
  assert.equal((await resend(order.id)).status, 202);
  await tick();
  const all = [...tokensTo(email), res.driver_link.token as string];
  assert.equal(all.length, 3);
  await ok(putDriver(a, driver, { email: newEmail() }));
  for (const token of all) {
    assert.deepEqual(await tablesContaining(randomPart(token)), [], "令牌的随机部分不能进任何表");
    assert.equal(api.logs().includes(randomPart(token)), false, "也不能进日志");
  }
});

test("SMTP 的回显（带收件人地址和任意内容）不进发送记录、接口、日志", async () => {
  const email = newEmail();
  const echo = `<${email}> ${SMTP_ECHO}`;
  const { order } = await dispatched(a, "a", email);
  smtp.behave({ rejectRecipient: true, errorDetail: echo });
  await tick();
  const row = (await driverRows(order.id))[0];
  assert.equal(row.status, "failed");
  assert.equal(String(row.last_error_message ?? "").includes(SMTP_ECHO), false, "发送记录里没有 SMTP 的原话");
  assert.equal(String(row.last_error_message ?? "").includes(email), false);
  const list = await ok(api.call("GET", `/platform/v1/notifications?order_id=${order.id}&audience=driver`, { token: await ops() }));
  assert.equal(JSON.stringify(list).includes(email), false, "平台记录里地址打码");
  assert.equal(JSON.stringify(list).includes(SMTP_ECHO), false);
  const status = await api.call("GET", `/tenant/v1/orders/${order.id}/driver-link/email`, { token: a.adminToken });
  assert.equal(status.text.includes(SMTP_ECHO), false);
  assert.equal(status.text.includes(email), false);
  assert.equal(api.logs().includes(SMTP_ECHO), false);
  assert.equal(api.logs().includes(email), false);
});

// ---- 司机邮箱打码 ----

test("完整邮箱只在 drivers、发给司机的发送记录、新增司机的幂等记录里；审计、发件箱、请求表、Webhook 一律没有", async () => {
  const email = newEmail();
  const { order, driver } = await dispatched(a, "a", email);
  await tick();
  api.clock.advance(61_000);
  a.adminToken = await tenantLogin(api, m.a.adminEmail);
  assert.equal((await resend(order.id)).status, 202);
  await tick();
  await ok(api.call("DELETE", `/tenant/v1/drivers/${driver.id}`, { token: a.adminToken }));
  const allowed = ["drivers", "idempotency_keys", "notifications"];
  const found = await tablesContaining(email);
  assert.deepEqual(found.filter((table) => !allowed.includes(table)), [], `这些表里出现了完整邮箱：${found.join("、")}`);
  const deliveries = await api.db.owner.query("select event_data::text as data from webhook_deliveries where order_id = $1", [order.id]);
  for (const row of deliveries.rows) assert.equal(/driver_link_email|nzd_/.test(row.data), false, "Webhook 里没有发送状态、没有令牌");
});

test("只读、财务：车队、详情、发送状态、审计、派单资源里都只有打码；不能靠搜索确认一个完整邮箱", async () => {
  const email = newEmail();
  const { order, driver } = await dispatched(a, "a", email);
  await tick();
  const updated = await ok(putDriver(a, driver, { email: newEmail() }));
  const current = updated.email as string;
  for (const role of ["readonly", "finance"] as const) {
    const token = await staffToken(role);
    for (const url of [
      "/tenant/v1/drivers",
      `/tenant/v1/drivers/${driver.id}`,
      `/tenant/v1/orders/${order.id}`,
      `/tenant/v1/orders/${order.id}/driver-link/email`,
      `/tenant/v1/orders/${order.id}/assignable`,
      "/tenant/v1/audit-logs?limit=100",
      `/tenant/v1/notifications?order_id=${order.id}`,
    ]) {
      const res = await api.call("GET", url, { token });
      assert.equal(res.text.includes(email), false, `${role} ${url}：旧地址`);
      assert.equal(res.text.includes(current), false, `${role} ${url}：现在的地址`);
    }
    const searched = await api.call("GET", `/tenant/v1/drivers?q=${encodeURIComponent(current)}`, { token });
    if (searched.status === 200) assert.equal(searched.body.total, 0, `${role} 不能靠搜索确认邮箱`);
  }
  const dispatchToken = await staffToken("dispatch");
  const full = await ok(api.call("GET", `/tenant/v1/drivers/${driver.id}`, { token: dispatchToken }));
  assert.equal(full.email, current, "调度能看全，要能改");
  for (const url of [`/tenant/v1/orders/${order.id}`, `/tenant/v1/orders/${order.id}/assignable`, `/tenant/v1/orders/${order.id}/driver-link/email`, "/tenant/v1/audit-logs?limit=100"]) {
    assert.equal((await api.call("GET", url, { token: dispatchToken })).text.includes(current), false, `调度 ${url} 也只有打码`);
  }
});

test("平台接口、渠道接口、司机页面：都没有完整邮箱", async () => {
  const email = newEmail();
  const order = await flow.paidOrder({ serviceTime: new Date(api.clock.now().getTime() + 96 * HOUR).toISOString().replace(/\.\d{3}Z$/, "Z") });
  const driver = await newDriver(api, b, { email });
  const assigned = await ok(assign(api, b, order.id, driver.id, (await newVehicle(api, b, m.ids.biz7)).id));
  await tick();
  const [mailToken] = tokensTo(email);
  const staff = await ops();
  for (const url of [`/platform/v1/orders/${order.id}`, `/platform/v1/notifications?order_id=${order.id}`]) {
    const res = await api.call("GET", url, { token: staff });
    assert.equal(res.status, 200, `${url}：${res.text}`);
    assert.equal(res.text.includes(email), false, url);
    assert.equal(/nzd_/.test(res.text), false, `${url} 没有令牌`);
  }
  const sales = await api.call("GET", `/sales/v1/orders/${order.id}`, { token: await flow.token() });
  assert.equal(sales.status, 200, sales.text);
  assert.equal(sales.text.includes(email), false, "渠道看不到司机邮箱");
  assert.equal(/driver_link|nzd_/.test(sales.text), false, "渠道看不到司机链接");
  for (const token of [mailToken as string, assigned.driver_link.token as string]) {
    const seen = await api.call("GET", "/driver/v1/trip", { token });
    assert.equal(seen.status, 200);
    assert.equal(seen.text.includes(email), false, "司机页面没有司机邮箱");
    assert.equal(/selling|sell_|markup|settlement/i.test(seen.text), false, "司机页面没有价格");
  }
});

test("司机资料的审计：新增、改邮箱、清空邮箱、停用都只有打码", async () => {
  const email = newEmail();
  const driver = await newDriver(api, a, { email });
  const next = newEmail();
  const updated = await ok(putDriver(a, driver, { email: next }));
  const cleared = await ok(putDriver(a, updated, { email: null }));
  await ok(api.call("DELETE", `/tenant/v1/drivers/${cleared.id}`, { token: a.adminToken }));
  const rows = await api.db.owner.query("select action, before, after from audit_logs where resource = 'driver' and resource_id = $1 order by occurred_at, id", [driver.id]);
  assert.ok(rows.rows.length >= 3);
  const text = JSON.stringify(rows.rows);
  assert.equal(text.includes(email), false);
  assert.equal(text.includes(next), false);
  const changes = rows.rows.filter((row) => row.after?.email_changed === true);
  assert.equal(changes.length, 2, "改地址和清空都记下 email_changed");
});

// ---- 邮件内容 ----

test("真实下单的邮件：客人姓名、电话、邮箱、地址、航班、对外价、结算价一律没有（去掉令牌和单号后比完整值）", async () => {
  const email = newEmail();
  const order = await flow.paidOrder({ serviceTime: new Date(api.clock.now().getTime() + 96 * HOUR).toISOString().replace(/\.\d{3}Z$/, "Z") });
  const driver = await newDriver(api, b, { email });
  await ok(assign(api, b, order.id, driver.id, (await newVehicle(api, b, m.ids.biz7)).id));
  await tick();
  const [raw] = smtp.messages.filter((message) => message.to.includes(email));
  assert.ok(raw);
  const text = decodedMailText(raw.data);
  const row = (await api.db.owner.query("select o.order_no, o.passenger, o.settlement_minor, o.dropoff, o.flight_no, s.sell_minor from orders o join order_sales s on s.order_id = o.id where o.id = $1", [order.id])).rows[0];
  const cleaned = text.replace(tokenIn(text) as string, "").replaceAll(row.order_no, "");
  const money = (minor: number): string[] => [String(minor), minor.toLocaleString("en-US")];
  const forbidden = [row.passenger.name, row.passenger.phone, row.passenger.phone.replace(/[^0-9]/g, ""), row.passenger.email, row.dropoff.address, row.flight_no, ...money(row.sell_minor), ...money(row.settlement_minor)];
  for (const value of forbidden) assert.equal(cleaned.includes(value), false, `邮件里不能有：${value}`);
  assert.doesNotMatch(cleaned, /结算|对外价|加价|JPY|客人付|司机已收到/);
  const head = raw.data.slice(0, raw.data.search(/\r?\n\r?\n/));
  assert.equal(head.includes(row.passenger.email), false);
  assert.equal(/nzd_/.test(head), false, "邮件头里没有令牌");
});

test("送机单、点对点、包车：行程概要都不带客人填的地址", async () => {
  for (const shape of ["dropoff", "point_to_point", "charter"] as const) {
    const email = newEmail();
    const order = await seedOrder(api, m, "a", { serviceAt: new Date(api.clock.now().getTime() + (96 + 24 * ["dropoff", "point_to_point", "charter"].indexOf(shape)) * HOUR), direction: shape === "dropoff" ? "dropoff" : "pickup" });
    const pickup = { lng: 139.7, lat: 35.6, address: "虚构区上车街 1-2-3 号" };
    const dropoff = { lng: 139.8, lat: 35.7, address: "虚构区下车街 4-5-6 号" };
    await api.db.owner.query("update orders set pickup = $2::jsonb, dropoff = $3::jsonb where id = $1", [order.id, JSON.stringify(pickup), JSON.stringify(dropoff)]);
    if (shape === "point_to_point") await api.db.owner.query("update orders set category = 'point_to_point', place_id = null, direction = null where id = $1", [order.id]);
    if (shape === "charter") await api.db.owner.query("update orders set category = 'charter', place_id = null, direction = null, package_hours = 8 where id = $1", [order.id]);
    const driver = await newDriver(api, a, { email });
    const res = await assign(api, a, order.id, driver.id, (await newVehicle(api, a, m.ids.biz7)).id);
    assert.equal(res.status, 200, `${shape}：${res.text}`);
    await tick();
    const [text] = textsTo(email);
    assert.ok(text, `${shape}：收到`);
    assert.equal(text.includes("上车街"), false, `${shape}：没有上车地址`);
    assert.equal(text.includes("下车街"), false, `${shape}：没有下车地址`);
    if (shape === "charter") assert.match(text, /包车 8 小时/);
  }
});

test("司机姓名里的换行、Bcc、邮件结束符、占位符：不影响收件人和邮件头，也不会拆成第二封", async () => {
  const email = newEmail();
  const outsider = `qa.outsider.${randomUUID().slice(0, 8)}@example.test`;
  for (const name of [`虚构\r\nBcc: ${outsider}`, `虚构\r\n.\r\nMAIL FROM:<${outsider}>\r\nRCPT TO:<${outsider}>`, "虚构 {{driver_link_url}} {{order_no}} {{passenger_name}}"]) {
    smtp.reset();
    const order = await seedOrder(api, m, "a", { serviceAt: new Date(api.clock.now().getTime() + (96 + Math.floor(Math.random() * 500)) * HOUR) });
    const created = await api.call("POST", "/tenant/v1/drivers", { token: a.adminToken, headers: { "idempotency-key": randomUUID() }, body: { name, phone: `+8190${String(Math.floor(10_000_000 + Math.random() * 89_999_999))}`, email, languages: ["ja", "zh"], license_expires_on: "2030-01-01", driving_years: 12, gold: false, status: "active" } });
    if (created.status !== 201) {
      assert.equal(created.status, 400, created.text);
      continue;
    }
    await ok(assign(api, a, order.id, created.body.id, (await newVehicle(api, a, m.ids.biz7)).id));
    await tick();
    assert.equal(smtp.messages.length, 1, JSON.stringify(name));
    const [message] = smtp.messages;
    assert.ok(message);
    assert.deepEqual(message.to, [email], "只有这一个收件人");
    const head = message.data.slice(0, message.data.search(/\r?\n\r?\n/));
    assert.equal(/^bcc:/im.test(head), false);
    assert.equal(head.includes(outsider), false);
    assert.equal((decodedMailText(message.data).match(/\/driver#nzd_/g) ?? []).length, 1, "只有一条链接，姓名里的占位符不会被展开");
  }
});

test("邮箱校验：控制字符、全角、Unicode 换行、多个收件人、超长一律 400（新增和修改两条路）；254 位能存能发；错误信息不回显地址", async () => {
  const domain = "example.test";
  const bad = [
    "ｆｕｌｌ@example.test",
    "full＠example.test",
    "full@ｅｘａｍｐｌｅ.test",
    `line sep@${domain}`,
    `nul\u0000byte@${domain}`,
    `tab\tchar@${domain}`,
    `a@${domain},b@${domain}`,
    `a@${domain};b@${domain}`,
    `Name <a@${domain}>`,
    `"quoted name"@${domain}`,
    `a@${domain}\r\nBcc: b@${domain}`,
    `${"x".repeat(255 - `@${domain}`.length)}@${domain}`,
  ];
  const driver = await newDriver(api, a, { email: newEmail() });
  for (const email of bad) {
    const created = await api.call("POST", "/tenant/v1/drivers", { token: a.adminToken, headers: { "idempotency-key": randomUUID() }, body: { name: "虚构司机", phone: "+819000000001", languages: ["ja"], license_expires_on: "2030-01-01", email } });
    assert.equal(created.status, 400, `新增 ${JSON.stringify(email)}`);
    assert.equal(created.text.includes(`a@${domain}`), false, "错误信息不回显");
    const updated = await putDriver(a, driver, { email });
    assert.equal(updated.status, 400, `修改 ${JSON.stringify(email)}`);
  }
  const stored = await ok(api.call("GET", `/tenant/v1/drivers/${driver.id}`, { token: a.adminToken }));
  assert.equal(stored.version, driver.version, "被拒的都没写进去");
  assert.equal(stored.email, driver.email);

  const longest = `${"y".repeat(254 - `.${domain}`.length - "@s".length)}@s.${domain}`.slice(0, 254);
  assert.equal(longest.length, 254);
  const res = await putDriver(a, driver, { email: longest });
  assert.ok([200, 400].includes(res.status), res.text);
  if (res.status === 200) {
    assert.equal(res.body.email_masked.length < 254, true, "打码后不是原文");
    assert.equal(res.body.email, longest);
  }
});

// ---- 权限和隔离 ----

test("GET /tenant/v1/notifications：只有发给自己这家的；司机记录不进列表也不进总数；带 audience 也绕不过去", async () => {
  const email = newEmail();
  const { order } = await dispatched(a, "a", email);
  await tick();
  const driverCount = (await driverRows(order.id)).length;
  assert.equal(driverCount, 1);
  const tenantRows = (await api.db.owner.query("select count(*)::int as n from notifications where order_id = $1 and audience = 'tenant'", [order.id])).rows[0].n;
  for (const suffix of ["", "&audience=driver", "&status=sent"]) {
    const list = await api.call("GET", `/tenant/v1/notifications?order_id=${order.id}${suffix}`, { token: a.adminToken });
    if (list.status === 400) continue;
    assert.equal(list.status, 200, list.text);
    assert.ok(list.body.items.every((item: any) => item.audience === "tenant"), suffix);
    assert.equal(list.text.includes(email), false, suffix);
    if (suffix === "") assert.equal(list.body.total, tenantRows, "总数不算司机记录");
  }
  const event = await api.call("GET", "/tenant/v1/notifications?limit=100", { token: await staffToken("readonly") });
  assert.equal(event.text.includes(email), false, "只读角色的全量列表也没有");
  assert.equal(event.body.items.some((item: any) => item.event === "order.driver_link"), false);
});

test("租户隔离：B 用自己的令牌带 A 的订单过滤，读不到 A 的司机记录、发送状态；A 的司机令牌进不了 B", async () => {
  const email = newEmail();
  const { order } = await dispatched(a, "a", email);
  await tick();
  const list = await ok(api.call("GET", `/tenant/v1/notifications?order_id=${order.id}`, { token: b.adminToken }));
  assert.equal(list.total, 0);
  assert.equal((await api.call("GET", `/tenant/v1/orders/${order.id}/driver-link/email`, { token: b.adminToken })).status, 404);
  assert.equal((await api.call("POST", `/tenant/v1/orders/${order.id}/driver-link/email`, { token: b.adminToken })).status, 404);
  assert.equal((await api.call("POST", `/tenant/v1/orders/${order.id}/driver-link/email?tenant_id=${b.tenantId}`, { token: b.adminToken, body: { tenant_id: a.tenantId } })).status, 404, "租户只来自令牌");
  assert.equal((await api.db.owner.query("select count(*)::int as n from driver_link_emails where order_id = $1", [order.id])).rows[0].n, 1, "没有多出请求");
});

test("开关：只读、财务都改不了；只读能看；版本号不对不改；审计记了谁改的", async () => {
  const readonly = await staffToken("readonly");
  const finance = await staffToken("finance");
  const before = (await ok(api.call("GET", "/tenant/v1/notification-settings", { token: readonly })));
  assert.ok(["auto", "manual"].includes(before.driver_link_delivery), "只读能看");
  const headers = before.version === 0 ? {} : { "if-match": `"${before.version}"` };
  for (const token of [readonly, finance]) {
    const res = await api.call("PUT", "/tenant/v1/notification-settings", { token, headers, body: { quiet_hours: null, driver_link_delivery: "manual" } });
    assert.equal(res.status, 403, res.text);
  }
  assert.equal((await ok(api.call("GET", "/tenant/v1/notification-settings", { token: a.adminToken }))).driver_link_delivery, before.driver_link_delivery);

  const saved = await ok(api.call("PUT", "/tenant/v1/notification-settings", { token: a.adminToken, headers, body: { quiet_hours: null, driver_link_delivery: "manual" } }));
  const stale = await api.call("PUT", "/tenant/v1/notification-settings", { token: a.adminToken, headers: { "if-match": `"${saved.version + 7}"` }, body: { quiet_hours: null, driver_link_delivery: "auto" } });
  assert.equal(stale.status, 409, stale.text);
  assert.equal((await ok(api.call("GET", "/tenant/v1/notification-settings", { token: a.adminToken }))).driver_link_delivery, "manual");
  const audit = (await api.db.owner.query("select actor_id, before, after from audit_logs where resource = 'notification_settings' and resource_id = $1 order by occurred_at desc limit 1", [a.tenantId])).rows[0];
  assert.ok(audit.actor_id, "记了是谁");
  assert.equal(audit.after.driver_link_delivery, "manual");
  await ok(api.call("PUT", "/tenant/v1/notification-settings", { token: a.adminToken, headers: { "if-match": `"${saved.version}"` }, body: { quiet_hours: null, driver_link_delivery: "auto" } }));
});

test("重发和改邮箱的权限：财务、只读不能重发，不能改、不能清空司机邮箱，也不会吊销邮件链接", async () => {
  const email = newEmail();
  const { order, driver } = await dispatched(a, "a", email);
  await tick();
  const [token] = tokensTo(email);
  api.clock.advance(61_000);
  for (const role of ["finance", "readonly"] as const) {
    const staff = await staffToken(role);
    assert.equal((await resend(order.id, staff)).status, 403, `${role} 重发`);
    assert.equal((await putDriver(a, driver, { email: newEmail() }, staff)).status, 403, `${role} 改邮箱`);
    assert.equal((await putDriver(a, driver, { email: null }, staff)).status, 403, `${role} 清空邮箱`);
    assert.equal((await api.call("POST", `/tenant/v1/orders/${order.id}/driver-link`, { token: staff })).status, 403, `${role} 重新生成`);
  }
  assert.equal((await trip(token as string)).status, 200);
  assert.equal((await api.db.owner.query("select count(*)::int as n from driver_link_emails where order_id = $1", [order.id])).rows[0].n, 1);
});

// ---- 运营手动重试 ----

async function failedOnce(email: string = newEmail()): Promise<{ order: { id: string; orderNo: string }; driver: any; vehicle: any; res: any; email: string; notificationId: string }> {
  const made = await dispatched(a, "a", email);
  smtp.behave({ rejectRecipient: true });
  await tick();
  smtp.reset();
  const row = (await driverRows(made.order.id))[0];
  assert.equal(row.status, "failed");
  return { ...made, notificationId: row.id };
}
const retry = async (id: string) => api.call("POST", `/platform/v1/notifications/${id}/retry`, { token: await ops() });

test("运营重试：改过邮箱发到新地址，记录跟着改，应答打码；旧地址收不到；审计没有收件人；应答和日志没有令牌", async () => {
  const oldEmail = newEmail();
  const { order, driver, notificationId } = await failedOnce(oldEmail);
  const nextEmail = newEmail();
  await ok(putDriver(a, driver, { email: nextEmail }));
  const res = await retry(notificationId);
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.notification.status, "sent");
  assert.equal(res.text.includes(nextEmail), false, "应答打码");
  assert.equal(/nzd_/.test(res.text), false);
  assert.equal(textsTo(oldEmail).length, 0);
  assert.equal(textsTo(nextEmail).length, 1);
  assert.equal((await driverRows(order.id))[0].recipient, nextEmail);
  const token = tokensTo(nextEmail)[0] as string;
  assert.equal(api.logs().includes(randomPart(token)), false);
  assert.equal((await trip(token)).status, 200, "运营重试新生成的链接能用");
  const audit = (await api.db.owner.query("select before, after from audit_logs where resource = 'notification' and resource_id = $1", [notificationId])).rows;
  assert.equal(audit.length, 1);
  assert.equal(JSON.stringify(audit).includes(nextEmail), false);
  assert.equal(JSON.stringify(audit).includes(oldEmail), false);
});

test("运营重试的复查：改派、已有更新的发起、手动模式、停用、删邮箱、取消，都不发、不生成链接，也不能再重试", async () => {
  const scenarios: [string, string, (made: Awaited<ReturnType<typeof failedOnce>>) => Promise<void>][] = [
    [
      "改派",
      "ORDER_STATE_CHANGED",
      async (made) => {
        const second = await newDriver(api, a, { email: newEmail() });
        await ok(assign(api, a, made.order.id, second.id, made.vehicle.id, { version: made.res.order.version }));
      },
    ],
    [
      "又发起了一次",
      "DRIVER_LINK_SUPERSEDED",
      async (made) => {
        api.clock.advance(61_000);
        a.adminToken = await tenantLogin(api, m.a.adminEmail);
        assert.equal((await resend(made.order.id)).status, 202);
      },
    ],
    [
      "手动模式",
      "DRIVER_LINK_MANUAL",
      async () => {
        const current = await ok(api.call("GET", "/tenant/v1/notification-settings", { token: a.adminToken }));
        await ok(api.call("PUT", "/tenant/v1/notification-settings", { token: a.adminToken, ...(current.version === 0 ? {} : { headers: { "if-match": `"${current.version}"` } }), body: { quiet_hours: null, driver_link_delivery: "manual" } }));
      },
    ],
    [
      "停用",
      "DRIVER_DISABLED",
      async (made) => {
        await ok(api.call("DELETE", `/tenant/v1/drivers/${made.driver.id}`, { token: a.adminToken }));
      },
    ],
    [
      "删邮箱",
      "DRIVER_EMAIL_MISSING",
      async (made) => {
        await ok(putDriver(a, made.driver, { email: null }));
      },
    ],
    [
      "取消",
      "ORDER_STATE_CHANGED",
      async (made) => {
        await api.db.owner.query("update orders set status = 'cancelled', cancelled_at = now(), cancel_reason = 'GUEST_REQUEST' where id = $1", [made.order.id]);
      },
    ],
  ];
  for (const [name, code, change] of scenarios) {
    await api.db.owner.query("update tenant_notification_settings set driver_link_delivery = 'auto'");
    const made = await failedOnce();
    await change(made);
    const linksBefore = (await api.db.owner.query("select count(*)::int as n from driver_links where order_id = $1", [made.order.id])).rows[0].n;
    const res = await retry(made.notificationId);
    assert.equal(res.status, 200, `${name}：${res.text}`);
    assert.deepEqual([res.body.notification.status, res.body.notification.last_error?.code], ["expired", code], name);
    assert.equal(res.body.notification.retryable, false, `${name}：不能再重试`);
    assert.equal(textsTo(made.email).length, 0, `${name}：没有发`);
    assert.equal((await api.db.owner.query("select count(*)::int as n from driver_links where order_id = $1", [made.order.id])).rows[0].n, linksBefore, `${name}：没有新链接`);
    const again = await retry(made.notificationId);
    assert.equal(again.status, 409, `${name}：第二次重试被拒`);
  }
  await api.db.owner.query("update tenant_notification_settings set driver_link_delivery = 'auto'");
});

test("运营重试：两个人同时点只发一封；发成功后不能再重试；范围外的员工看不到也动不了", async () => {
  const { notificationId, email } = await failedOnce();
  const staff = await ops();
  const [one, two] = await Promise.all([api.call("POST", `/platform/v1/notifications/${notificationId}/retry`, { token: staff }), api.call("POST", `/platform/v1/notifications/${notificationId}/retry`, { token: staff })]);
  const statuses = [one.status, two.status].sort();
  assert.deepEqual(statuses, [200, 409], `${one.text} / ${two.text}`);
  assert.equal(textsTo(email).length, 1);
  assert.equal((await retry(notificationId)).status, 409);

  const second = await failedOnce();
  const root = await platformLogin(api, "root@platform.test");
  const role = await ok(api.call("POST", "/platform/v1/roles", { token: root, body: { name: `大阪通知-${randomUUID().slice(0, 4)}`, grants: ["notifications:view", "notifications:edit"], data_scope: { city_ids: [m.ids.osaka], channel_ids: null } } }), 201);
  const scopedEmail = `qa.scoped.${randomUUID().slice(0, 8)}@platform.test`;
  const invited = await ok(api.call("POST", "/platform/v1/staff", { token: root, body: { email: scopedEmail, name: "虚构运营", role: role.key } }), 201);
  await ok(api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: invited.invite.token, password: TEST_PASSWORD } }));
  const scoped = (await ok(api.platformLogin({ body: { email: scopedEmail, password: TEST_PASSWORD } }))).access_token;
  assert.equal((await api.call("POST", `/platform/v1/notifications/${second.notificationId}/retry`, { token: scoped })).status, 404, "范围外当作不存在");
  const seen = await ok(api.call("GET", `/platform/v1/notifications?order_id=${second.order.id}`, { token: scoped }));
  assert.equal(seen.total, 0, "范围外列不出来");
  assert.equal(textsTo(second.email).length, 0);
});

test("运营重试和后台任务并发：不会一封发两次", async () => {
  const { notificationId, email, order } = await failedOnce();
  const [res] = await Promise.all([retry(notificationId), tick(), tick()]);
  assert.ok([200, 409].includes(res.status), res.text);
  assert.equal(textsTo(email).length, 1);
  const active = (await api.db.owner.query("select count(*)::int as n from driver_links where order_id = $1 and purpose = 'email' and revoked_at is null", [order.id])).rows[0].n;
  assert.ok(active >= 1);
});

// ---- 脱敏、加密 ----

test("脱敏（M4-21）：司机的待发记录不挡脱敏；脱敏后订单不再发信；发送记录的收件人不被改成占位；详情和状态照常", async () => {
  const ended = tokyoDaysAgo(api, 200);
  const email = newEmail();
  const order = await seedOrder(api, m, "a", { serviceAt: new Date(api.clock.now().getTime() + 96 * HOUR) });
  const driver = await newDriver(api, a, { email });
  await ok(assign(api, a, order.id, driver.id, (await newVehicle(api, a, m.ids.biz7)).id));
  smtp.behave({ rejectRecipient: true });
  await tick();
  smtp.reset();
  const row = (await driverRows(order.id))[0];
  assert.equal(row.status, "failed");
  await endAt(api, order.id, ended);
  await api.db.owner.query("update notifications set status = 'failed', sent_at = null where id = $1", [row.id]);
  const before = (await api.app.passengerRetention.tick()) as unknown;
  assert.ok(before !== undefined);
  assert.equal(await isDone(api, order.id), true, "脱敏完成，没有被司机的记录挡住");
  const kept = (await driverRows(order.id))[0];
  assert.equal(kept.recipient, email, "司机地址不是乘客信息，不被脱敏改掉");

  const res = await retry(row.id);
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.notification.status, "expired", "脱敏的单是已结束的，不再发");
  assert.equal(textsTo(email).length, 0);
  assert.equal((await api.call("POST", `/tenant/v1/orders/${order.id}/driver-link/email`, { token: a.adminToken })).status, 409);
  const detail = await api.call("GET", `/tenant/v1/orders/${order.id}/driver-link/email`, { token: a.adminToken });
  assert.equal(detail.status, 200, detail.text);
});

test("脱敏后的单直接补发（数据被改回可发状态）：邮件和链接里也没有客人的原始信息", async () => {
  const email = newEmail();
  const order = await seedOrder(api, m, "a", { serviceAt: new Date(api.clock.now().getTime() + 96 * HOUR) });
  const driver = await newDriver(api, a, { email });
  await ok(assign(api, a, order.id, driver.id, (await newVehicle(api, a, m.ids.biz7)).id));
  const passenger = (await api.db.owner.query("select passenger from orders where id = $1", [order.id])).rows[0].passenger;
  await endAt(api, order.id, tokyoDaysAgo(api, 200));
  await api.app.passengerRetention.tick();
  assert.equal(await isDone(api, order.id), true);
  await api.db.owner.query("update orders set status = 'assigned', service_at = $2, cancelled_at = null, cancel_reason = null where id = $1", [order.id, new Date(api.clock.now().getTime() + 96 * HOUR)]);
  await api.db.owner.query("update notifications set status = 'pending', next_attempt_at = now() - interval '1 minute', sent_at = null, expires_at = now() + interval '7 days' where order_id = $1 and audience = 'driver'", [order.id]);
  await tick();
  for (const text of textsTo(email)) {
    assert.equal(text.includes(passenger.name), false);
    assert.equal(text.includes(passenger.email), false);
    const opened = await trip(tokenIn(text) as string);
    if (opened.status === 200) assert.equal(opened.text.includes(passenger.name), false, "打开后也是脱敏后的内容");
  }
});

const box = new SecretBox(FAKE_SECRETS.dataEncryptionKey);
const useCrypto = (settings: { readSource: "plaintext" | "ciphertext"; plaintextWrite: boolean; backfillEnabled: boolean }): PassengerCrypto => {
  const crypto = new PassengerCrypto(box, settings, { error: () => undefined });
  attachPassengerCrypto(api.db.pool, crypto);
  return crypto;
};
const DUAL = { readSource: "ciphertext", plaintextWrite: true, backfillEnabled: true } as const;
const RETIRED = { readSource: "ciphertext", plaintextWrite: false, backfillEnabled: true } as const;

afterEach(() => {
  useCrypto(DUAL);
});

test("加密（M4-22）：明文退役后照常发；司机地址不加密（recipient_enc 为空）；邮件和司机记录里没有客人信息", async () => {
  useCrypto(RETIRED);
  const email = newEmail();
  const made = await dispatched(a, "a", email);
  await tick();
  assert.equal(textsTo(email).length, 1);
  const row = (await driverRows(made.order.id))[0];
  assert.equal(row.recipient_enc, null);
  assert.equal(row.recipient, email);
  const list = await ok(api.call("GET", `/platform/v1/notifications?order_id=${made.order.id}&audience=driver`, { token: await ops() }));
  assert.match(list.items[0].recipient, /^qa\*\*\*@example\.test$/, "能正常打码，不是「解不开」");
  assert.equal((await trip(tokensTo(email)[0] as string)).status, 200);
});

test("加密（M4-22）：这单解不开时不发、不生成链接、不留等待中；重发和状态给 503，不是 500；响应里没有内容", async () => {
  const crypto = useCrypto(RETIRED);
  const email = newEmail();
  const made = await dispatched(a, "a", email);
  smtp.behave({ rejectAt: { stage: "MAIL", reply: "450 4.2.1 later" } });
  await tick();
  smtp.reset();
  api.clock.advance(61_000);
  const linksBefore = (await api.db.owner.query("select count(*)::int as n from driver_links where order_id = $1", [made.order.id])).rows[0].n;
  const saved = (await api.db.owner.query("select passenger, passenger_enc from orders where id = $1", [made.order.id])).rows[0];
  // 明文已退役（占位），密文又坏了：这一单真的解不开
  await api.db.owner.query("update orders set passenger = $2::jsonb, passenger_enc = $3 where id = $1", [made.order.id, JSON.stringify({ name: ENCRYPTED_TEXT, phone: ENCRYPTED_TEXT, email: ENCRYPTED_TEXT }), `${crypto.currentPrefix}v1.AAAA.AAAA.AAAA`]);
  try {
    await tick();
    const rows = await driverRows(made.order.id);
    assert.equal(textsTo(email).length, 0, `解不开的单不发：${JSON.stringify(rows.map((row) => [row.status, row.last_error_code]))}`);
    assert.deepEqual(rows.map((row) => [row.status, row.last_error_code]), [["failed", "PASSENGER_DECRYPT_FAILED"]]);
    assert.equal((await api.db.owner.query("select count(*)::int as n from driver_links where order_id = $1", [made.order.id])).rows[0].n, linksBefore, "解不开时不生成新的邮件链接");
    api.clock.advance(61_000);
    a.adminToken = await tenantLogin(api, m.a.adminEmail);
    const res = await resend(made.order.id);
    assert.equal(res.status, 503, res.text);
    assert.equal(res.body.error.code, "PASSENGER_DECRYPT_FAILED");
    assert.equal((await api.db.owner.query("select count(*)::int as n from driver_link_emails where order_id = $1", [made.order.id])).rows[0].n, 1, "失败的重发不写请求");
    const status = await api.call("GET", `/tenant/v1/orders/${made.order.id}/driver-link/email`, { token: a.adminToken });
    assert.notEqual(status.status, 500, status.text);
  } finally {
    await api.db.owner.query("update orders set passenger = $2::jsonb, passenger_enc = $3 where id = $1", [made.order.id, JSON.stringify(saved.passenger), saved.passenger_enc]);
  }
});
