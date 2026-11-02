/**
 * M4-31 测试角色：运营代改乘客邮箱要双人复核（ADR 0065）——通知、存储和日志、权限和范围、M4-29 / M4-30 回归。
 * 真实 PostgreSQL + 本机假 SMTP，从不连真实的邮件服务。
 * - 通知：批准前新地址一封都收不到（改单通知、派车通知、查订单链接、运营重发的链接）；批准后新地址收到的那封内容对（链接能开这一单、没有旧邮箱原文）；旧地址收到什么；
 * - 存储和日志：明文写入开关开、关两种情况下，新邮箱在整个库里、两个应用的日志里的形态；有结论（批准、驳回、撤回）后清空；
 * - 权限和范围：自建角色（只有编辑、编辑 + 审核）、客服撤回别人的、财务风控只读、渠道范围外 404、租户令牌、`/tenant/v1` 不含对外价和加价比例；
 * - 回归：M4-29 运营代改（三项都给、履约字段等确认、代供应商处理）、M4-30 查订单和重发不受影响。
 * 全部是虚构数据，测试结束删掉整个 schema。
 */
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { type ApiResponse, type TestApi, createTestApi } from "./testing/api.ts";
import { assign, newDriver, newVehicle } from "./testing/dispatch.ts";
import { type FakeSmtp, decodedMailText, startFakeSmtp } from "./testing/fake-integrations.ts";
import { type Market, type Staff, addStaff, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { platformLogin, tenantLogin } from "./testing/money.ts";
import { FakePaymentProvider, deliverWebhook } from "./testing/payments.ts";
import { type SiteApi, resetLinkLimits, siteApi } from "./testing/site.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ADDRESS = { lng: 139.7, lat: 35.6 };
const NAME = "虚构乘客丙";
const PHONE = "+81 90-2222-3333";
const REVIEW = { verification: "order_details", reason: "核对了行程、用车时间、人数和航班号，客人说原邮箱已停用" };
const FORBIDDEN_TENANT_KEYS = ["sell", "sell_price", "sell_minor", "markup_bp", "markup", "fx_buffer_bp"];

let api: TestApi;
let m: Market;
let smtp: FakeSmtp;
let pay: FakePaymentProvider;
let site: SiteApi;
let siteLogs = "";
let siteClientId: string;
let smtpEnv: Record<string, string>;
let cs: Staff;
let cs2: Staff;
let ops2: Staff;
let ipSeq = 0;

const nextIp = (): string => {
  ipSeq += 1;
  return `10.${90 + Math.floor(ipSeq / 250)}.0.${(ipSeq % 250) + 1}`;
};
const fictional = (label: string): string => `qa31p.${label}.${randomUUID().slice(0, 8)}@example.test`;

before(async () => {
  smtp = await startFakeSmtp();
  smtpEnv = { SMTP_HOST: smtp.host, SMTP_PORT: String(smtp.port), SMTP_ENCRYPTION: "none", SMTP_USERNAME: "mailer", SMTP_PASSWORD: "fake-smtp-password-Qc9", SMTP_FROM_NAME: "NOZOMI", SMTP_FROM_ADDRESS: "noreply@example.test", PUBLIC_BASE_URL: "https://book.example.test" };
  pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay, env: smtpEnv, integrationSecretsTtlMs: 0 });
  m = await buildMarket(api);
  const siteChannelId = (await newChannel(api, m.staff.cm1.token, { name: "NOZOMI 官网" })).id;
  siteClientId = (await salesCredentials(api, m, siteChannelId)).clientId;
  site = await siteApi(api, siteClientId, pay, smtpEnv, { integrationSecretsTtlMs: 0, logDestination: { write: (line) => void (siteLogs += line) } });
  const root = await platformLogin(api, "root@platform.test");
  cs = await addStaff(api, root, "qa31p.cs@platform.test", "customer_service");
  cs2 = await addStaff(api, root, "qa31p.cs2@platform.test", "customer_service");
  ops2 = await addStaff(api, root, "qa31p.ops2@platform.test", "operations");
});

after(async () => {
  await site?.close();
  await api?.close();
  await smtp?.close();
});

beforeEach(async () => {
  await drain(site);
  await resetLinkLimits(api);
});

const login = (email: string): Promise<string> => platformLogin(api, email);
const ops = (): Promise<string> => login(m.staff.operations.email);

function futureTokyo(days: number): string {
  const date = new Date(api.clock.now().getTime() + 9 * HOUR + days * DAY).toISOString().slice(0, 10);
  return `${date}T10:00`;
}

async function paidSiteOrder(email: string, via: SiteApi = site): Promise<{ order: any; token: string }> {
  api.clock.advance(1_000);
  const ip = nextIp();
  const quoted = await ok(via.call("POST", "/site/v1/quotes", { ip, body: { city_id: m.ids.tokyo, airport_id: m.ids.narita, direction: "pickup", address: ADDRESS, service_local: futureTokyo(10), passengers: 2, luggage: 1 } }));
  const quote = quoted.quotes.find((q: any) => q.vehicle_group.id === m.ids.biz7);
  assert.ok(quote, JSON.stringify(quoted));
  api.clock.advance(1_000);
  const created = await ok(
    via.call("POST", "/site/v1/orders", {
      ip,
      headers: { "idempotency-key": randomUUID() },
      body: { quote_id: quote.quote_id, passenger: { name: NAME, phone: PHONE, email }, flight_no: "JL061", dropoff_address: "虚构市虚构町五丁目", save_payment_method: true },
    }),
    201,
  );
  const intent = pay.intentOf(created.order.id);
  assert.ok(intent);
  pay.pay(intent.id);
  const raw = pay.event("payment_intent.succeeded", pay.intentObject(intent.id), { created: api.clock.now() });
  assert.equal((await deliverWebhook(api.app, raw, pay.sign(raw, api.clock.now()))).status, 200);
  await drain(via);
  return { order: created.order, token: created.link.token };
}

async function drain(via: SiteApi): Promise<void> {
  await via.app.backgroundIdle();
  for (let i = 0; i < 20; i += 1) {
    await via.app.notificationJobs.tick();
    const left = await api.db.owner.query("select count(*)::int as n from notifications where status = 'pending' and next_attempt_at <= $1", [api.clock.now()]);
    if (left.rows[0].n === 0) break;
  }
  smtp.reset();
}
async function deliver(via: SiteApi = site): Promise<void> {
  await via.app.backgroundIdle();
  for (let i = 0; i < 5; i += 1) await via.app.notificationJobs.tick();
}
const mailsTo = (email: string): string[] => smtp.messages.filter((message) => message.to.some((to: string) => to.toLowerCase() === email.toLowerCase())).map((message) => decodedMailText(message.data));
const tokenIn = (text: string): string | null => /\/book\/order#(nzo_[A-Za-z0-9_-]{43})/.exec(text)?.[1] ?? null;

async function detail(orderId: string): Promise<any> {
  return ok(api.call("GET", `/platform/v1/orders/${orderId}`, { token: await ops() }));
}
async function platformPatch(orderId: string, token: string, body: unknown, via: { call: SiteApi["call"] } = api): Promise<ApiResponse> {
  const v = (await detail(orderId)).order.version;
  api.clock.advance(1_000);
  return via.call("PATCH", `/platform/v1/orders/${orderId}`, { token, headers: { "if-match": `"${v}"` }, body });
}
async function emailOf(orderId: string): Promise<string> {
  return (await ok(api.call("POST", `/platform/v1/orders/${orderId}/passenger/reveal`, { token: await ops() }))).passenger.email;
}
const decide = (approvalId: string, decision: "approve" | "reject" | "withdraw", token: string, body: Record<string, unknown> = {}, via: { call: SiteApi["call"] } = api): Promise<ApiResponse> =>
  via.call("POST", `/platform/v1/approvals/${approvalId}/${decision}`, { token, body });
const lookup = (orderNo: string, email: string): Promise<ApiResponse> => site.call("POST", "/site/v1/orders/lookup", { ip: nextIp(), body: { order_no: orderNo, email } });
const resend = (orderId: string, token: string, body: Record<string, unknown>): Promise<ApiResponse> => api.call("POST", `/platform/v1/orders/${orderId}/view-link/resend`, { token, body });

/** 整个测试 schema 里每张表逐行转成文字搜一遍（不分大小写）。 */
async function tablesContaining(needle: string): Promise<string[]> {
  const tables = (await api.db.owner.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema = current_schema() and table_type = 'BASE TABLE'")).rows.map((row) => row.table_name);
  const hits: string[] = [];
  for (const table of tables) {
    const found = await api.db.owner.query(`select 1 from "${table}" t where position(lower($1) in lower(t::text)) > 0 limit 1`, [needle]);
    if (found.rowCount !== null && found.rowCount > 0) hits.push(table);
  }
  return hits.sort();
}

function allKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const item of value) allKeys(item, keys);
  else if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      keys.add(key);
      allKeys(item, keys);
    }
  }
  return keys;
}

async function customRole(grants: string[], scope: Record<string, unknown>): Promise<string> {
  const root = await login("root@platform.test");
  const created = await ok(api.call("POST", "/platform/v1/roles", { token: root, body: { name: `QA31 ${randomUUID().slice(0, 6)}`, grants, data_scope: scope } }), 201);
  const key = created.role?.key ?? created.key;
  const staff = await addStaff(api, root, `qa31p.role.${randomUUID().slice(0, 8)}@platform.test`, key);
  return login(staff.email);
}

// ---------------------------------------------------------------------------------------------------------------
// 通知
// ---------------------------------------------------------------------------------------------------------------

test("批准前：新地址一封都收不到——同一次提交的改单通知、供应商派车、客人用新邮箱查订单、运营重发到下单邮箱，全部发到原来的地址（或不发）", async () => {
  const email = fictional("guest");
  const placed = await paidSiteOrder(email);
  const fresh = fictional("fresh");
  const requested = await ok(platformPatch(placed.order.id, await login(cs.email), { passenger: { name: "虚构新名", email: fresh }, notes: "代改备注", email_review: REVIEW }));
  assert.equal(requested.email_review.status, "pending_review");
  await deliver();
  assert.ok(mailsTo(email).length >= 1, "姓名、备注改了：通知发到原来的邮箱");

  const b = { ...m.b, adminToken: await tenantLogin(api, m.b.adminEmail) };
  const driver = await newDriver(api, b, { email: `qa31p.driver.${randomUUID().slice(0, 6)}@example.test` });
  const vehicle = await newVehicle(api, b, m.ids.biz7);
  assert.equal((await assign(api, b, placed.order.id, driver.id, vehicle.id)).status, 200);
  assert.equal((await lookup(placed.order.order_no, fresh)).status, 202);
  assert.equal((await lookup(placed.order.order_no, fresh.toUpperCase())).status, 202);
  assert.equal((await lookup(placed.order.order_no, email)).status, 202);
  assert.equal((await resend(placed.order.id, await login(cs.email), { target: "original", verification: "callback_phone", reason: "客人说没收到" })).status, 202);
  await deliver();
  assert.equal(mailsTo(fresh).length, 0, "批准前新地址收到了信");
  const toOld = mailsTo(email);
  assert.ok(toOld.length >= 3, `派车、查订单、重发都发到原来的邮箱：${toOld.length}`);
  for (const text of toOld) assert.equal(text.includes(fresh), false, "发给原邮箱的信里不该出现新邮箱");
});

test("批准后：新地址只收到一封订单修改通知，链接能打开这一单；信里没有原来的邮箱原文；原来的地址这时什么都收不到（ADR 不做）；之后查订单只认新邮箱", async () => {
  const email = fictional("guest");
  const placed = await paidSiteOrder(email);
  const fresh = fictional("fresh");
  const requested = await ok(platformPatch(placed.order.id, await login(cs.email), { passenger: { email: fresh }, email_review: REVIEW }), 202);
  await deliver();
  smtp.reset();
  await ok(decide(requested.email_review.approval_id, "approve", await ops(), { note: "核实过" }));
  await deliver();
  const toFresh = mailsTo(fresh);
  assert.equal(toFresh.length, 1, `新地址收到 ${toFresh.length} 封`);
  const text = toFresh[0] as string;
  assert.ok(text.includes(placed.order.order_no), "信里有订单号");
  assert.equal(text.includes(email), false, "新地址的人不该看到原来的邮箱原文");
  assert.equal(text.toLowerCase().includes(email.toLowerCase()), false);
  const link = tokenIn(text);
  assert.ok(link, "信里带订单链接");
  const opened = await ok(site.call("GET", "/site/v1/order", { token: link, ip: nextIp() }));
  assert.equal(opened.order.id, placed.order.id);
  assert.equal(mailsTo(email).length, 0, "批准时原来的地址收不到任何信（ADR 0065「不做」）");

  smtp.reset();
  await resetLinkLimits(api);
  assert.equal((await lookup(placed.order.order_no, email)).status, 202);
  assert.equal((await lookup(placed.order.order_no, fresh)).status, 202);
  await deliver();
  assert.equal(mailsTo(email).length, 0, "批准后用原邮箱查订单收不到链接");
  assert.equal(mailsTo(fresh).length, 1, "用新邮箱查订单收到链接");

  // 记录在案：原来发到旧邮箱的订单链接批准后仍然有效（M4-30「旧链接仍有效」）
  const old = await site.call("GET", "/site/v1/order", { token: placed.token, ip: nextIp() });
  assert.equal(old.status, 200, "旧链接（下单时发的）仍能打开");
});

test("驳回、撤回：新地址不收信，原来的地址也不收「有人申请改邮箱」（ADR 不做）；订单详情不再显示等审核", async () => {
  const email = fictional("guest");
  const placed = await paidSiteOrder(email);
  const first = fictional("first");
  const r1 = await ok(platformPatch(placed.order.id, await login(cs.email), { passenger: { email: first }, email_review: REVIEW }), 202);
  await ok(decide(r1.email_review.approval_id, "reject", await ops(), { note: "核实不充分" }));
  const second = fictional("second");
  const r2 = await ok(platformPatch(placed.order.id, await login(cs.email), { passenger: { email: second }, email_review: REVIEW }), 202);
  await ok(decide(r2.email_review.approval_id, "withdraw", await login(cs.email)));
  await deliver();
  assert.equal(mailsTo(first).length + mailsTo(second).length, 0);
  assert.equal(mailsTo(email).length, 0);
  assert.equal((await detail(placed.order.id)).pending_email_review, null);
});

// ---------------------------------------------------------------------------------------------------------------
// 存储和日志
// ---------------------------------------------------------------------------------------------------------------

test("明文写入开着（默认）：等审核期间新邮箱原文只在 passenger_email_changes 里；驳回后整个库搜不到；两个应用的日志里自始至终没有新邮箱（含 400、409 的请求）", async () => {
  const email = fictional("guest");
  const placed = await paidSiteOrder(email);
  const fresh = fictional("plain.fresh");
  const apiLogStart = api.logs().length;
  const siteLogStart = siteLogs.length;
  const missing = await platformPatch(placed.order.id, await login(cs.email), { passenger: { email: fresh } });
  assert.equal(missing.status, 400);
  const requested = await ok(platformPatch(placed.order.id, await login(cs.email), { passenger: { email: fresh }, email_review: REVIEW }), 202);
  const again = await platformPatch(placed.order.id, await login(ops2.email), { passenger: { email: fresh.toUpperCase() }, email_review: REVIEW });
  assert.equal(again.status, 409);
  assert.deepEqual(await tablesContaining(fresh), ["passenger_email_changes"], "等审核期间只在这一张表里");
  const row = (await api.db.owner.query("select email, email_enc, previous_email, previous_email_enc from passenger_email_changes where approval_id = $1", [requested.email_review.approval_id])).rows[0];
  assert.notEqual(row.email_enc, null, "有密文");
  await ok(decide(requested.email_review.approval_id, "reject", await ops(), { note: "不批" }));
  await deliver();
  assert.deepEqual(await tablesContaining(fresh), [], "驳回后整个库里都没有新邮箱原文");
  const logs = api.logs().slice(apiLogStart) + siteLogs.slice(siteLogStart);
  assert.equal(logs.toLowerCase().includes(fresh.toLowerCase()), false, "日志里有新邮箱原文");
  assert.equal(logs.toLowerCase().includes(email.toLowerCase()), false, "日志里有原邮箱原文");
});

test("明文写入关着（PASSENGER_PLAINTEXT_WRITE=false）：等审核期间、批准之后、发信之后，整个库里都搜不到新邮箱原文，也搜不到原邮箱原文；日志里也没有", async () => {
  let strictLogs = "";
  const strict = await siteApi(api, siteClientId, pay, { ...smtpEnv, PASSENGER_PLAINTEXT_WRITE: "false" }, { integrationSecretsTtlMs: 0, logDestination: { write: (line) => void (strictLogs += line) } });
  try {
    const email = fictional("strict.guest");
    const placed = await paidSiteOrder(email, strict);
    const fresh = fictional("strict.fresh");
    assert.deepEqual(await tablesContaining(email), [], "前提：下单时就没存原文");
    const requested = await strict.call("PATCH", `/platform/v1/orders/${placed.order.id}`, { token: await login(cs.email), headers: { "if-match": `"${(await detail(placed.order.id)).order.version}"` }, body: { passenger: { name: "虚构改名", email: fresh }, email_review: REVIEW } });
    assert.equal(requested.status, 200, requested.text);
    assert.deepEqual(await tablesContaining(fresh), [], "等审核期间库里没有新邮箱原文");
    assert.deepEqual(await tablesContaining(email), [], "等审核期间库里没有原邮箱原文（发起时的邮箱也加密）");
    await deliver(strict);
    const approved = await decide(requested.body.email_review.approval_id, "approve", await ops(), {}, strict);
    assert.equal(approved.status, 200, approved.text);
    await deliver(strict);
    assert.equal(mailsTo(fresh).length, 1, "发到了新邮箱");
    assert.deepEqual(await tablesContaining(fresh), [], "批准、发信之后库里也没有新邮箱原文");
    assert.deepEqual(await tablesContaining(email), []);
    assert.equal(strictLogs.toLowerCase().includes(fresh.toLowerCase()), false, "日志里没有新邮箱");
    const cleared = (await api.db.owner.query("select email, email_enc, previous_email, previous_email_enc from passenger_email_changes where order_id = $1", [placed.order.id])).rows;
    assert.deepEqual(cleared, [{ email: null, email_enc: null, previous_email: null, previous_email_enc: null }]);
  } finally {
    await strict.close();
  }
});

test("复核记录、复核列表、订单详情、审计里只有打码地址（新、旧都打码）；打码不泄露完整的本地部分", async () => {
  const email = fictional("guest");
  const placed = await paidSiteOrder(email);
  const fresh = fictional("fresh");
  const requested = await ok(platformPatch(placed.order.id, await login(cs.email), { passenger: { email: fresh }, email_review: REVIEW }), 202);
  const approvalId = requested.email_review.approval_id;
  const views = [
    JSON.stringify(requested),
    (await api.call("GET", `/platform/v1/approvals/${approvalId}`, { token: await ops() })).text,
    (await api.call("GET", "/platform/v1/approvals?status=pending", { token: await ops() })).text,
    (await api.call("GET", "/platform/v1/approvals?status=pending", { token: await login(cs.email) })).text,
    JSON.stringify(await detail(placed.order.id)),
    (await api.call("GET", `/platform/v1/orders?q=${encodeURIComponent(placed.order.order_no)}`, { token: await ops() })).text,
  ];
  await ok(decide(approvalId, "approve", await ops()));
  views.push((await api.call("GET", `/platform/v1/approvals/${approvalId}`, { token: await ops() })).text);
  const audits = await api.db.owner.query("select before, after from audit_logs where occurred_at >= $1", [new Date(api.clock.now().getTime() - 60_000)]);
  views.push(JSON.stringify(audits.rows));
  const freshLocal = fresh.split("@")[0] as string;
  const emailLocal = email.split("@")[0] as string;
  for (const [i, text] of views.entries()) {
    assert.equal(text.toLowerCase().includes(freshLocal.toLowerCase()), false, `第 ${i} 处出现了新邮箱的本地部分`);
    assert.equal(text.toLowerCase().includes(emailLocal.toLowerCase()), false, `第 ${i} 处出现了原邮箱的本地部分`);
  }
  const shown = await ok(api.call("GET", `/platform/v1/approvals/${approvalId}`, { token: await ops() }));
  assert.equal(shown.approval.kind, "order.passenger_email");
  assert.equal(shown.approval.payload?.verification ?? "order_details", "order_details");
});

// ---------------------------------------------------------------------------------------------------------------
// 权限和范围
// ---------------------------------------------------------------------------------------------------------------

test("权限：只有「订单 · 编辑」的自建角色能发起、不能批；另一位客服不能撤回别人发起的；财务、风控、只读批不了；租户令牌批不了", async () => {
  const email = fictional("guest");
  const placed = await paidSiteOrder(email);
  const fresh = fictional("fresh");
  const editOnly = await customRole(["orders:view", "orders:edit", "approvals:view"], { city_ids: null, channel_ids: null });
  const requested = await platformPatch(placed.order.id, editOnly, { passenger: { email: fresh }, email_review: REVIEW });
  assert.equal(requested.status, 202, `有「订单 · 编辑」的自建角色能发起：${requested.text}`);
  const approvalId = requested.body.email_review.approval_id;
  const editOnly2 = await customRole(["orders:view", "orders:edit", "approvals:view"], { city_ids: null, channel_ids: null });
  assert.ok([403, 404].includes((await decide(approvalId, "approve", editOnly2)).status), "没有审核那一格的不能批");
  assert.ok([403, 409].includes((await decide(approvalId, "withdraw", await login(cs2.email))).status), "不是发起人不能撤回");
  const root = await login("root@platform.test");
  const finance = await addStaff(api, root, `qa31p.fin.${randomUUID().slice(0, 6)}@platform.test`, "finance");
  const risk = await addStaff(api, root, `qa31p.risk.${randomUUID().slice(0, 6)}@platform.test`, "risk");
  for (const [label, token] of [["客服", await login(cs2.email)], ["财务", finance.token], ["风控", risk.token], ["只读", await login(m.staff.readonly.email)]] as const) {
    const res = await decide(approvalId, "approve", token);
    assert.ok([403, 404].includes(res.status), `${label}：${res.status} ${res.text}`);
  }
  const tenantToken = await tenantLogin(api, m.b.adminEmail);
  assert.equal((await decide(approvalId, "approve", tenantToken)).status, 401, "租户令牌");
  assert.equal(await emailOf(placed.order.id), email);
  // 只有审核那一格（没有订单 · 编辑）的自建角色：能批，不能发起
  const reviewOnly = await customRole(["orders:view", "order_view_link:view", "order_view_link:review", "approvals:view"], { city_ids: null, channel_ids: null });
  assert.equal((await platformPatch(placed.order.id, reviewOnly, { notes: "没有编辑权限" })).status, 403);
  await ok(decide(approvalId, "approve", reviewOnly));
  assert.equal(await emailOf(placed.order.id), fresh);
});

test("数据范围：限定在别的渠道的运营角色——改单、看复核、批准一律 404；超级管理员可以批客服发起的", async () => {
  const email = fictional("guest");
  const placed = await paidSiteOrder(email);
  const fresh = fictional("fresh");
  const otherChannel = (await newChannel(api, m.staff.cm1.token, { name: `QA31 别的渠道 ${randomUUID().slice(0, 4)}` })).id;
  const scoped = await customRole(["orders:view", "orders:edit", "order_view_link:view", "order_view_link:review", "approvals:view"], { city_ids: null, channel_ids: [otherChannel] });
  assert.equal((await platformPatch(placed.order.id, scoped, { passenger: { email: fresh }, email_review: REVIEW })).status, 404);
  const requested = await ok(platformPatch(placed.order.id, await login(cs.email), { passenger: { email: fresh }, email_review: REVIEW }), 202);
  const approvalId = requested.email_review.approval_id;
  assert.equal((await api.call("GET", `/platform/v1/approvals/${approvalId}`, { token: scoped })).status, 404);
  assert.equal((await api.call("GET", "/platform/v1/approvals?status=pending", { token: scoped })).text.includes(approvalId), false);
  assert.equal((await decide(approvalId, "approve", scoped)).status, 404);
  assert.equal(await emailOf(placed.order.id), email);
  await ok(decide(approvalId, "approve", await login("root@platform.test")));
  assert.equal(await emailOf(placed.order.id), fresh);
});

test("租户接口：等审核期间接单的供应商看不到新邮箱、复核和等审核状态；订单详情、列表、通知里都没有对外价和加价比例", async () => {
  const email = fictional("guest");
  const placed = await paidSiteOrder(email);
  const fresh = fictional("fresh");
  const requested = await ok(platformPatch(placed.order.id, await login(cs.email), { passenger: { name: "虚构改名二", email: fresh }, email_review: REVIEW }));
  await deliver();
  const tenant = await tenantLogin(api, m.b.adminEmail);
  const responses = [
    await api.call("GET", `/tenant/v1/orders/${placed.order.id}`, { token: tenant }),
    await api.call("GET", "/tenant/v1/orders", { token: tenant }),
    await api.call("GET", "/tenant/v1/notifications", { token: tenant }),
    await api.call("GET", "/tenant/v1/todos", { token: tenant }),
  ];
  for (const res of responses) {
    if (res.status === 404) continue;
    assert.equal(res.status, 200, res.text);
    assert.equal(res.text.toLowerCase().includes(fresh.toLowerCase()), false, "供应商看到了新邮箱");
    assert.equal(res.text.includes(requested.email_review.approval_id), false);
    assert.equal(res.text.includes("pending_email_review") || res.text.includes("passenger_email"), false);
    const keys = allKeys(res.body);
    for (const key of FORBIDDEN_TENANT_KEYS) assert.equal(keys.has(key), false, `租户接口里有 ${key}`);
  }
  assert.equal((await api.call("GET", `/platform/v1/approvals/${requested.email_review.approval_id}`, { token: tenant })).status, 401);
  assert.equal((await api.call("GET", `/tenant/v1/orders/${placed.order.id}`, { token: await tenantLogin(api, m.a.adminEmail) })).status, 404, "别家供应商读不到");
});

// ---------------------------------------------------------------------------------------------------------------
// 回归：M4-29、M4-30
// ---------------------------------------------------------------------------------------------------------------

test("M4-29 回归：三项都给且邮箱没变照旧直接生效；人数等供应商确认；运营代供应商同意；改单通知发到原邮箱", async () => {
  const email = fictional("guest");
  const placed = await paidSiteOrder(email);
  const contact = await ok(platformPatch(placed.order.id, await login(cs.email), { passenger: { name: "虚构改名三", phone: PHONE, email } }));
  assert.equal(contact.change.status, "applied");
  assert.equal(contact.email_review, null);
  const trip = await ok(platformPatch(placed.order.id, await login(cs.email), { passengers: 3 }));
  assert.equal(trip.change.status, "pending_confirmation");
  const confirmed = await api.call("POST", `/platform/v1/orders/${placed.order.id}/changes/${trip.change.id}/confirm`, { token: await ops(), body: { note: "电话确认供应商同意" } });
  assert.equal(confirmed.status, 200, confirmed.text);
  assert.equal((await detail(placed.order.id)).order.passengers, 3);
  await deliver();
  assert.ok(mailsTo(email).length >= 1);
});

test("M4-30 回归：查订单发到下单邮箱、运营重发到下单邮箱直接发；发到新邮箱仍要复核，批准后发到新邮箱但订单上的邮箱不变", async () => {
  const email = fictional("guest");
  const placed = await paidSiteOrder(email);
  assert.equal((await lookup(placed.order.order_no, email)).status, 202);
  assert.equal((await resend(placed.order.id, await login(cs.email), { target: "original", verification: "callback_phone", reason: "客人说没收到" })).status, 202);
  await deliver();
  assert.equal(mailsTo(email).length, 2);
  const other = fictional("m430.new");
  const requested = await ok(resend(placed.order.id, await login(cs.email), { target: "new_email", email: other, verification: "order_details", reason: "核对了行程" }), 202);
  await deliver();
  assert.equal(mailsTo(other).length, 0);
  await ok(decide(requested.approval.id, "approve", await ops()));
  await deliver();
  assert.equal(mailsTo(other).length, 1);
  assert.equal(await emailOf(placed.order.id), email, "M4-30 发到新邮箱不改订单上的邮箱");
  // 两类复核并存：M4-30 的在等时照样能发起 M4-31 的改邮箱
  const pending430 = await ok(resend(placed.order.id, await login(cs.email), { target: "new_email", email: fictional("m430.second"), verification: "order_details", reason: "又核对了一次" }), 202);
  const change = await platformPatch(placed.order.id, await login(cs.email), { passenger: { email: fictional("m431") }, email_review: REVIEW });
  assert.equal(change.status, 202, change.text);
  await ok(decide(pending430.approval.id, "withdraw", await login(cs.email)));
});
