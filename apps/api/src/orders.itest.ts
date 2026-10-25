/**
 * M3-01：下单与付款（ADR 0026），经真实接口、真实 PostgreSQL；收款服务用替身（testing/payments.ts），通知按 Stripe 的格式和签名算法现场生成。
 * - 下单全流程：quote_id → 待支付（预占库存、建付款、保存支付方式）→ Stripe 通知付款成功 → 自动确认 → 租户看得到（结算价），渠道看得到中标租户名；
 * - 幂等键、报价过期 / 别的渠道的报价 / 一个报价下两单、商品下架、下单信息校验；
 * - Stripe 没配置时不能下单；收款服务出错时用同一个键重试；
 * - 并发下单不超卖；超时未付款自动取消、释放库存；最后一刻付了款的不取消；
 * - 通知：签名、重放、同一事件只处理一次（含并发）、未知事件、对不上的付款、失败、金额不符、退款、拒付、测试 / 正式模式；
 * - 租户隔离（租户 A 读不到、改不了租户 B 的订单）和规则 4（租户端没有渠道、对外价、加价比例、汇率）。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadConfig } from "@nozomi/config";
import { buildApp } from "./app.ts";
import { withTenantTx } from "./db/context.ts";
import { loadMigrationFiles } from "./db/migrate.ts";
import { QUOTE_CATALOG_TTL_MS } from "./services/quote-catalog.ts";
import { type ApiResponse, type TestApi, addTenantUser, createTestApi } from "./testing/api.ts";
import { deniedByDatabase } from "./testing/db.ts";
import { testEnv } from "./testing/fixtures.ts";
import { type Market, DROPOFF, SERVICE_TIME, allKeys, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { assertMatchesOpenApi, assertMatchesOperation } from "./testing/openapi.ts";
import { FakePaymentProvider, deliverWebhook } from "./testing/payments.ts";

let api: TestApi;
let m: Market;
let pay: FakePaymentProvider;
let channelId: string;
let creds: { clientId: string; secret: string; token: string };
let issuedAt = 0;

before(async () => {
  pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay });
  m = await buildMarket(api);
  channelId = (await newChannel(api, m.staff.cm1.token, { name: "官网" })).id;
  creds = await salesCredentials(api, m, channelId);
  issuedAt = api.clock.now().getTime();
});
after(() => api.close());

/** 渠道的访问令牌 2 小时过期；测试里时钟拨得多，超过 1 小时就重新换一个。 */
let token = "";
async function salesToken(): Promise<string> {
  if (token === "" || api.clock.now().getTime() - issuedAt > 3_600_000) {
    api.clock.advance(1_000);
    token = (await ok(api.call("POST", "/sales/v1/oauth/token", { ip: "198.51.100.10", body: { grant_type: "client_credentials", client_id: creds.clientId, client_secret: creds.secret } }))).access_token;
    issuedAt = api.clock.now().getTime();
  }
  return token;
}

const ask = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({ city_id: m.ids.tokyo, category: "airport_transfer", place_id: m.ids.narita, direction: "pickup", dropoff: DROPOFF, service_time: SERVICE_TIME, passengers: 2, luggage: 1, currency: "JPY", ...extra });

/** 询价，返回这个车型组的报价。每次先把时钟拨过一秒（限流按秒计）。 */
async function quoteFor(vehicleGroupId: string, who?: string): Promise<any> {
  who ??= await salesToken();
  api.clock.advance(1_000);
  const res = await api.call("POST", "/sales/v1/quotes", { token: who, body: ask({ vehicle_group_ids: [vehicleGroupId] }) });
  assert.equal(res.status, 200, res.text);
  const found = res.body.quotes.find((q: any) => q.vehicle_group_id === vehicleGroupId);
  assert.ok(found, `没有报出 ${vehicleGroupId} 的价：${res.text}`);
  return found;
}

/** 接机（成田）要填的：乘客、航班号、市区一端的地址、同意保存支付方式。 */
const details = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  passenger: { name: "王小明", phone: "+81 90-1234-5678", email: "guest@example.com" },
  flight_no: "nh 211",
  dropoff_address: "东京站八重洲口",
  messaging: { app: "line", handle: "xiaoming" },
  channel_order_no: "WEB-0001",
  save_payment_method: true,
  ...extra,
});

async function placeOrder(body: Record<string, unknown>, key: string | null = randomUUID(), who?: string): Promise<ApiResponse> {
  who ??= await salesToken();
  api.clock.advance(1_000);
  const res = await api.call("POST", "/sales/v1/orders", { token: who, body, ...(key === null ? {} : { headers: { "idempotency-key": key } }) });
  assertMatchesOperation("POST", "/sales/v1/orders", res.status, res.body);
  return res;
}

async function salesOrder(id: string, who?: string): Promise<ApiResponse> {
  who ??= await salesToken();
  api.clock.advance(1_000);
  const res = await api.call("GET", `/sales/v1/orders/${id}`, { token: who });
  assertMatchesOperation("GET", "/sales/v1/orders/{id}", res.status, res.body);
  return res;
}

/** 下一张单（用新报价），返回订单。 */
async function newOrder(vehicleGroupId: string = m.ids.biz7, extra: Record<string, unknown> = {}): Promise<any> {
  const quote = await quoteFor(vehicleGroupId);
  const res = await placeOrder({ quote_id: quote.quote_id, ...details(extra) });
  assert.equal(res.status, 201, res.text);
  return res.body.order;
}

const intentOf = (orderId: string): string => {
  const intent = pay.intentOf(orderId);
  assert.ok(intent, "替身里没有这张单的付款");
  return intent.id;
};

/** 发一条按 Stripe 格式签了名的通知。 */
async function notify(type: string, object: Record<string, unknown>, options: { id?: string; livemode?: boolean } = {}): Promise<{ status: number; body: any; raw: string; signature: string }> {
  const raw = pay.event(type, object, { ...options, created: api.clock.now() });
  const signature = pay.sign(raw, api.clock.now());
  const res = await deliverWebhook(api.app, raw, signature);
  assertMatchesOperation("POST", "/webhooks/stripe", res.status, res.body);
  return { ...res, raw, signature };
}

/** 客人付款成功，Stripe 发来 payment_intent.succeeded。 */
async function paid(orderId: string): Promise<any> {
  const intent = intentOf(orderId);
  pay.pay(intent);
  const res = await notify("payment_intent.succeeded", pay.intentObject(intent));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body;
}

const tenantCall = async (who: string, url: string, template: string): Promise<ApiResponse> => {
  const res = await api.call("GET", url, { token: who });
  assertMatchesOpenApi("GET", template, res);
  return res;
};
const platformCall = tenantCall;

const row = async (sql: string, params: unknown[]): Promise<any> => (await api.db.owner.query(sql, params)).rows[0];

test("下单全流程：quote_id → 待支付（金额以快照为准、建付款并保存支付方式）→ 付款成功的通知 → 自动确认；租户看得到结算价，渠道看得到中标租户名", async () => {
  const quote = await quoteFor(m.ids.biz7);
  // 商务 7 座：甲 20,000 × 1.1 = 22,000，乙 19,800 × 1.1 = 21,780 → 乙中标
  assert.deepEqual(quote.price.total, { amount: "21780", currency: "JPY" });
  const created = await placeOrder({ quote_id: quote.quote_id, ...details() });
  assert.equal(created.status, 201, created.text);
  const order = created.body.order;
  const payment = created.body.payment;
  assert.match(order.order_no, /^NZ20261007[0-9A-HJ-NP-Z]{8}$/);
  assert.deepEqual(
    [order.status, order.price.total, order.payment_status, order.winning_tenant, order.quote_id, order.flight_no, order.passenger.phone, order.dropoff.address, order.pickup, order.service_local, order.timezone, order.free_wait_minutes],
    ["pending_payment", { amount: "21780", currency: "JPY" }, "requires_payment", null, quote.quote_id, "NH211", "+819012345678", "东京站八重洲口", null, "2026-10-20T10:00", "Asia/Tokyo", 90],
  );
  assert.equal(new Date(order.payment_due_at).getTime() - new Date(order.created_at).getTime(), 30 * 60_000, "30 分钟内付款");
  // 付款：替身里建了一笔 PaymentIntent（客人支付的币种和金额，最小单位整数），client_secret 交给前端
  const intent = pay.intentOf(order.id);
  assert.ok(intent);
  assert.deepEqual([intent.amountMinor, intent.currency, intent.input.customer.email, intent.input.orderNo], [21_780, "JPY", "guest@example.com", order.order_no]);
  assert.deepEqual([payment.provider, payment.status, payment.client_secret, payment.publishable_key], ["stripe", "requires_payment", intent.clientSecret, pay.publishableKey]);
  // 付款前：没有中标租户、结算价、加价比例
  const keys = [...allKeys(created.body)];
  assert.deepEqual(keys.filter((key) => /settle|markup|margin|candidate|supplier|product|tenant_id|band/i.test(key)), []);
  for (const secret of [m.b.tenantId, "乙车队", "19800", m.ids.pb]) assert.ok(!created.text.includes(secret), `应答里出现了 ${secret}`);

  // 库里：订单属于中标的乙，金额全部来自快照
  const saved = await row("select * from orders where id = $1", [order.id]);
  assert.deepEqual([saved.tenant_id, saved.status, Number(saved.settlement_minor), saved.settlement_currency, saved.product_id, saved.inventory_held, saved.flight_no], [m.b.tenantId, "pending_payment", 19_800, "JPY", m.ids.pb, false, "NH211"]);
  const sale = await row("select * from order_sales where order_id = $1", [order.id]);
  const snapshot = (await row("select snapshot from quotes where id = $1", [quote.quote_id])).snapshot;
  assert.deepEqual([Number(sale.sell_minor), sale.currency, sale.markup_bp, sale.channel_id, sale.fx, sale.supplier_tenant_id, saved.product_version], [snapshot.winner.sell.sellMinor, "JPY", 1_000, channelId, null, m.b.tenantId, snapshot.winner.productVersion]);
  assert.deepEqual(saved.settlement, snapshot.winner.offer.settlement);
  const record = await row("select * from order_payments where order_id = $1", [order.id]);
  assert.deepEqual([record.status, record.intent_id, record.customer_id, Number(record.amount_minor), record.currency, record.payment_method_id], ["requires_payment", intent.id, intent.customerId, 21_780, "JPY", null]);
  assert.ok(record.save_consent_at instanceof Date, "记下了客人同意保存支付方式的时间");
  assert.equal((await row("select l.ordered from quotes q join quote_logs l on l.id = q.quote_log_id where q.id = $1", [quote.quote_id])).ordered, true, "询价日志记了已下单");
  // 没付款的单租户看不到
  assert.equal((await tenantCall(m.b.adminToken, `/tenant/v1/orders/${order.id}`, "/tenant/v1/orders/{id}")).status, 404);
  assert.equal((await tenantCall(m.b.adminToken, "/tenant/v1/orders", "/tenant/v1/orders")).body.total, 0);

  // 付款成功：Stripe 通知 → 自动确认（租户不能拒单），记下保存的支付方式
  assert.deepEqual(await paid(order.id), { received: true, duplicate: false, result: "applied" });
  const confirmed = await row("select status, confirmed_at from orders where id = $1", [order.id]);
  assert.equal(confirmed.status, "confirmed");
  const settled = await row("select status, payment_method_id, succeeded_at from order_payments where order_id = $1", [order.id]);
  assert.deepEqual([settled.status, settled.payment_method_id, settled.succeeded_at instanceof Date], ["succeeded", pay.intentOf(order.id)?.paymentMethodId, true]);
  const afterPay = await salesOrder(order.id);
  assert.deepEqual([afterPay.body.order.status, afterPay.body.order.payment_status, afterPay.body.order.winning_tenant], ["confirmed", "succeeded", { name: "乙车队" }]);

  // 租户乙看得到：结算价和明细，状态流水
  const list = await tenantCall(m.b.adminToken, "/tenant/v1/orders", "/tenant/v1/orders");
  assert.deepEqual([list.body.total, list.body.items[0].id, list.body.items[0].settlement.total], [1, order.id, { amount: "19800", currency: "JPY" }]);
  const detail = await tenantCall(m.b.adminToken, `/tenant/v1/orders/${order.id}`, "/tenant/v1/orders/{id}");
  assert.deepEqual(detail.body.events.map((e: any) => [e.from_status, e.to_status, e.actor]), [[null, "pending_payment", "channel"], ["pending_payment", "confirmed", "payment"]]);
  assert.deepEqual([detail.body.order.passenger, detail.body.order.flight_no], [{ name: "王小明", phone: "+819012345678", email: "guest@example.com" }, "NH211"]);

  // 运营后台：对外价、结算价、加价比例、付款状态、报价快照里的全部候选
  const platformList = await platformCall(m.staff.readonly.token, `/platform/v1/orders?q=${order.order_no}`, "/platform/v1/orders");
  const item = platformList.body.items[0];
  assert.deepEqual([platformList.body.total, item.sell, item.settlement.total, item.markup_bp, item.tenant, item.channel.id, item.payment.status, item.payment.payment_method_saved], [1, { amount: "21780", currency: "JPY" }, { amount: "19800", currency: "JPY" }, 1_000, { id: m.b.tenantId, name: "乙车队" }, channelId, "succeeded", true]);
  assert.equal((await platformCall(m.staff.readonly.token, "/platform/v1/orders?q=WEB-0001", "/platform/v1/orders")).body.total >= 1, true, "按渠道订单号找");
  const platformDetail = await platformCall(m.staff.operations.token, `/platform/v1/orders/${order.id}`, "/platform/v1/orders/{id}");
  assert.deepEqual(platformDetail.body.quote.candidates.map((c: any) => [c.tenant_id, c.sell.amount, c.position]), [[m.b.tenantId, "21780", 1], [m.a.tenantId, "22000", 2]]);
  assert.deepEqual(platformDetail.body.payment_events.map((e: any) => [e.type, e.result]), [["payment_intent.succeeded", "applied"]]);
});

test("幂等：同一个键 + 同样的内容返回同一张单（不再建付款）；同一个键换了内容 422；同一个报价换个键再下 409；同一个键同时来两次只建一张", async () => {
  const quote = await quoteFor(m.ids.biz7);
  const key = randomUUID();
  const body = { quote_id: quote.quote_id, ...details() };
  const first = await placeOrder(body, key);
  assert.equal(first.status, 201, first.text);
  const creates = pay.calls.filter((c) => c.startsWith("create:")).length;
  const again = await placeOrder(body, key);
  assert.deepEqual([again.status, again.headers["idempotent-replayed"], again.body.order.id, again.body.payment.client_secret], [201, "true", first.body.order.id, first.body.payment.client_secret]);
  assert.equal(pay.calls.filter((c) => c.startsWith("create:")).length, creates, "重放不会再建一笔付款");
  const changed = await placeOrder({ ...body, notes: "改了内容" }, key);
  assert.deepEqual([changed.status, changed.body.error.code], [422, "IDEMPOTENCY_KEY_REUSED"]);
  const twice = await placeOrder(body, randomUUID());
  assert.deepEqual([twice.status, twice.body.error.code], [409, "QUOTE_ALREADY_ORDERED"]);
  assert.equal((await row("select count(*)::int as n from order_sales where quote_id = $1", [quote.quote_id])).n, 1);

  const other = await quoteFor(m.ids.biz7);
  const sameKey = randomUUID();
  const token = await salesToken();
  api.clock.advance(1_000);
  const both = await Promise.all([0, 1].map(() => api.call("POST", "/sales/v1/orders", { token, body: { quote_id: other.quote_id, ...details() }, headers: { "idempotency-key": sameKey } })));
  assert.deepEqual(both.map((r) => r.status), [201, 201], both.map((r) => r.text).join("\n"));
  assert.equal(both[0]?.body.order.id, both[1]?.body.order.id);
  assert.equal((await row("select count(*)::int as n from order_sales where idempotency_key = $1", [sameKey])).n, 1);
});

test("报价：过期的 410；别的渠道的、不存在的当作不存在；商品下架、供应商被暂停 409；都不建单", async () => {
  const before = (await row("select count(*)::int as n from orders", [])).n;
  const quote = await quoteFor(m.ids.biz7);
  api.clock.advance(30 * 60_000);
  const expired = await placeOrder({ quote_id: quote.quote_id, ...details() });
  assert.deepEqual([expired.status, expired.body.error.code, expired.body.error.details.expires_at], [410, "QUOTE_EXPIRED", quote.expires_at]);

  const otherChannel = (await newChannel(api, m.staff.cm1.token, { name: "别的渠道" })).id;
  const otherToken = (await salesCredentials(api, m, otherChannel, "198.51.100.77")).token;
  const theirs = await quoteFor(m.ids.biz7, otherToken);
  for (const quoteId of [theirs.quote_id, "QT20261007ZZZZZZZZZZ"]) {
    const res = await placeOrder({ quote_id: quoteId, ...details() });
    assert.deepEqual([res.status, res.body.error.code, res.body.error.details.issues[0].reason], [400, "VALIDATION_FAILED", "UNKNOWN_QUOTE"], quoteId);
  }
  // 别的渠道看不到这个渠道的订单
  const mine = await newOrder();
  assert.equal((await salesOrder(mine.id, otherToken)).status, 404);
  assert.equal((await salesOrder(mine.id)).status, 200);

  const beforeUnpublish = await quoteFor(m.ids.biz7);
  await ok(api.call("POST", `/tenant/v1/products/${m.ids.pb}/unpublish`, { token: m.b.adminToken }));
  const gone = await placeOrder({ quote_id: beforeUnpublish.quote_id, ...details() });
  assert.deepEqual([gone.status, gone.body.error.code, gone.body.error.details.reason], [409, "QUOTE_NO_LONGER_AVAILABLE", "PRODUCT_UNPUBLISHED"]);
  await ok(api.call("POST", `/tenant/v1/products/${m.ids.pb}/publish`, { token: m.b.adminToken }));
  const beforeSuspend = await quoteFor(m.ids.biz7);
  await ok(api.call("POST", `/platform/v1/tenants/${m.b.tenantId}/suspend`, { token: m.root, body: { reason: "测试暂停" } }));
  const suspended = await placeOrder({ quote_id: beforeSuspend.quote_id, ...details() });
  assert.deepEqual([suspended.status, suspended.body.error.details.reason], [409, "TENANT_SUSPENDED"]);
  await ok(api.call("POST", `/platform/v1/tenants/${m.b.tenantId}/resume`, { token: m.root, body: {} }));
  assert.equal((await row("select count(*)::int as n from orders", [])).n, before + 1, "只有那一张正常的单");
});

test("下单信息：接机要航班号、市区一端要地址、电话要国际格式、必须同意保存支付方式；要带 Idempotency-Key；不认识的字段拒绝", async () => {
  const quote = await quoteFor(m.ids.biz7);
  const issues = (res: ApiResponse): string[] => res.body.error.details.issues.map((i: any) => `${i.path}:${i.reason ?? ""}`);
  const bad = await placeOrder({ quote_id: quote.quote_id, ...details({ flight_no: null, dropoff_address: null, passenger: { name: "王", phone: "090-1234-5678", email: "guest@example.com" }, save_payment_method: false }) });
  assert.equal(bad.status, 400);
  assert.deepEqual(issues(bad), ["/passenger/phone:INVALID_PHONE", "/flight_no:REQUIRED", "/dropoff_address:REQUIRED", "/save_payment_method:CONSENT_REQUIRED"]);
  const noKey = await placeOrder({ quote_id: quote.quote_id, ...details() }, null);
  assert.deepEqual([noKey.status, noKey.body.error.details.location], [400, "headers"]);
  for (const extra of [{ tenant_id: m.a.tenantId }, { sell: "1" }]) assert.equal((await placeOrder({ quote_id: quote.quote_id, ...details(), ...extra })).status, 400, JSON.stringify(extra));
  assert.equal((await row("select count(*)::int as n from order_sales where quote_id = $1", [quote.quote_id])).n, 0, "校验不过不建单，报价还能用");
  assert.equal((await placeOrder({ quote_id: quote.quote_id, ...details() })).status, 201);
});

test("Stripe 没配置：下单 503 PAYMENT_NOT_CONFIGURED（和 /health 的「未配置」一致），通知 503；什么都不建", async () => {
  const quote = await quoteFor(m.ids.biz7);
  const config = loadConfig({ ...testEnv(api.db.url), STRIPE_SECRET_KEY: "", STRIPE_PUBLISHABLE_KEY: "", STRIPE_WEBHOOK_SECRET: "" });
  const token = await salesToken();
  const bare = buildApp({ config, pool: api.db.pool, migrationFiles: await loadMigrationFiles(), now: api.clock.now, logger: false });
  try {
    api.clock.advance(1_000);
    const res = await bare.inject({ method: "POST", url: "/sales/v1/orders", headers: { authorization: `Bearer ${token}`, "idempotency-key": randomUUID() }, payload: { quote_id: quote.quote_id, ...details() } });
    assertMatchesOperation("POST", "/sales/v1/orders", res.statusCode, res.json());
    assert.deepEqual([res.statusCode, res.json().error.code], [503, "PAYMENT_NOT_CONFIGURED"]);
    assert.match(res.json().error.message, /未配置/);
    const health = (await bare.inject({ method: "GET", url: "/health" })).json();
    assert.equal(health.integrations.find((i: any) => i.key === "stripe").state, "missing");
    const hook = await deliverWebhook(bare, "{}", "t=1,v1=00");
    assert.deepEqual([hook.status, hook.body.error.code], [503, "PAYMENT_NOT_CONFIGURED"]);
  } finally {
    await bare.close();
  }
  assert.equal((await row("select count(*)::int as n from order_sales where quote_id = $1", [quote.quote_id])).n, 0);
});

test("收款服务出错：超时 504 / 连不上 502，应答里有订单号；用同一个键重试接着建付款；没人重试的到期自动取消", async () => {
  const quote = await quoteFor(m.ids.biz7);
  const key = randomUUID();
  pay.failNext("PAYMENT_PROVIDER_TIMEOUT");
  const timedOut = await placeOrder({ quote_id: quote.quote_id, ...details() }, key);
  assert.deepEqual([timedOut.status, timedOut.body.error.code, timedOut.body.error.details.retryable], [504, "PAYMENT_PROVIDER_TIMEOUT", true]);
  const orderId = timedOut.body.error.details.order_id as string;
  assert.deepEqual(Object.values(await row("select o.status, p.status as payment, p.intent_id from orders o join order_payments p on p.order_id = o.id where o.id = $1", [orderId])), ["pending_payment", "creating", null]);
  const retried = await placeOrder({ quote_id: quote.quote_id, ...details() }, key);
  assert.deepEqual([retried.status, retried.body.order.id, retried.body.payment.client_secret], [201, orderId, pay.intentOf(orderId)?.clientSecret]);

  const abandoned = await quoteFor(m.ids.biz7);
  pay.failNext("PAYMENT_PROVIDER_UNAVAILABLE");
  const unavailable = await placeOrder({ quote_id: abandoned.quote_id, ...details() });
  assert.deepEqual([unavailable.status, unavailable.body.error.code], [502, "PAYMENT_PROVIDER_UNAVAILABLE"]);
  const abandonedId = unavailable.body.error.details.order_id as string;
  api.clock.advance(30 * 60_000);
  await api.app.orderJobs.tick();
  assert.deepEqual(Object.values(await row("select o.status, o.cancel_reason, p.status as payment from orders o join order_payments p on p.order_id = o.id where o.id = $1", [abandonedId])), ["cancelled", "PAYMENT_TIMEOUT", "canceled"]);
});

test("通知的签名：密钥不对、没有签名头、过了 5 分钟的重放都 400，什么都不记；同一个事件只处理一次（含同时到达）", async () => {
  const order = await newOrder();
  const intent = intentOf(order.id);
  pay.pay(intent);
  const raw = pay.event("payment_intent.succeeded", pay.intentObject(intent), { created: api.clock.now() });
  const forged = await deliverWebhook(api.app, raw, pay.sign(raw, api.clock.now(), `whsec_${randomUUID().replaceAll("-", "")}`));
  assert.deepEqual([forged.status, forged.body.error.code, forged.body.error.details.reason], [400, "WEBHOOK_SIGNATURE_INVALID", "SIGNATURE_MISMATCH"]);
  assert.equal((await deliverWebhook(api.app, raw, undefined)).body.error.details.reason, "SIGNATURE_MISSING");
  const tampered = await deliverWebhook(api.app, raw.replace('"amount":21780', '"amount":21781'), pay.sign(raw, api.clock.now()));
  assert.equal(tampered.body.error.details.reason, "SIGNATURE_MISMATCH", "改过的请求体");
  const signature = pay.sign(raw, api.clock.now());
  api.clock.advance(5 * 60_000 + 1_000);
  const replayed = await deliverWebhook(api.app, raw, signature);
  assert.deepEqual([replayed.status, replayed.body.error.details.reason], [400, "SIGNATURE_TIMESTAMP_OUT_OF_TOLERANCE"]);
  assert.equal((await row("select count(*)::int as n from payment_events where object_id = $1", [intent])).n, 0, "签名不过的什么都不记");
  assert.equal((await row("select status from orders where id = $1", [order.id])).status, "pending_payment");

  // 同一个事件：两次同时到达，只处理一次
  const fresh = pay.event("payment_intent.succeeded", pay.intentObject(intent), { created: api.clock.now() });
  const freshSig = pay.sign(fresh, api.clock.now());
  const both = await Promise.all([deliverWebhook(api.app, fresh, freshSig), deliverWebhook(api.app, fresh, freshSig)]);
  assert.deepEqual(both.map((r) => r.status), [200, 200]);
  assert.deepEqual(both.map((r) => r.body.duplicate).sort(), [false, true]);
  // 再来一次（Stripe 没收到 2xx 时会重发）
  const third = await deliverWebhook(api.app, fresh, freshSig);
  assert.deepEqual(third.body, { received: true, duplicate: true, result: null });
  assert.equal((await row("select count(*)::int as n from order_events where order_id = $1 and to_status = 'confirmed'", [order.id])).n, 1, "只确认了一次");
  assert.equal((await row("select count(*)::int as n from payment_events where object_id = $1", [intent])).n, 1);
});

test("通知的各种事件：失败记原因、单仍待支付；成功后晚到的失败不改回去；金额不符不确认；退款、拒付记下（退款币种对不上不记）；未知类型、对不上的付款、测试 / 正式模式不一致都只记录", async () => {
  const order = await newOrder();
  const intent = intentOf(order.id);
  pay.decline(intent);
  const failed = await notify("payment_intent.payment_failed", pay.intentObject(intent));
  assert.equal(failed.body.result, "applied");
  const afterFail = await row("select o.status, p.status as payment, p.last_error from orders o join order_payments p on p.order_id = o.id where o.id = $1", [order.id]);
  assert.deepEqual([afterFail.status, afterFail.payment, afterFail.last_error.code, afterFail.last_error.decline_code], ["pending_payment", "requires_payment", "card_declined", "insufficient_funds"]);

  // 金额不符（只有篡改或配置错误才会出现）：不确认
  pay.pay(intent);
  const wrong = await notify("payment_intent.succeeded", pay.intentObject(intent, { amount: 100 }));
  assert.equal(wrong.body.result, "mismatch");
  assert.equal((await row("select status from orders where id = $1", [order.id])).status, "pending_payment");
  assert.equal((await notify("payment_intent.succeeded", pay.intentObject(intent))).body.result, "applied");
  // 晚到的「失败」「处理中」不会把已付款改回去
  await notify("payment_intent.payment_failed", pay.intentObject(intent, { status: "requires_payment_method" }));
  await notify("payment_intent.processing", pay.intentObject(intent, { status: "processing" }));
  assert.deepEqual(Object.values(await row("select o.status, p.status as payment from orders o join order_payments p on p.order_id = o.id where o.id = $1", [order.id])), ["confirmed", "succeeded"]);

  // 退款（退款流程在 M3-03，这里只记下金额）、拒付
  const charge = { id: "ch_fake_1", object: "charge", payment_intent: intent, amount: 21_780, amount_refunded: 5_000, currency: "jpy", refunded: false };
  assert.equal((await notify("charge.refunded", charge)).body.result, "applied");
  assert.equal((await notify("charge.refunded", { ...charge, amount_refunded: 3_000 })).body.result, "applied", "乱序的旧通知");
  // 币种对不上的退款通知：不记退款（已退金额不变），记 mismatch
  assert.equal((await notify("charge.refunded", { ...charge, id: "ch_fake_usd", amount_refunded: 9_000, currency: "usd" })).body.result, "mismatch");
  assert.equal(Number((await row("select refunded_minor from order_payments where order_id = $1", [order.id])).refunded_minor), 5_000);
  assert.equal((await notify("charge.dispute.created", { id: "dp_fake_1", object: "dispute", payment_intent: intent, amount: 21_780, currency: "jpy", reason: "fraudulent", status: "needs_response" })).body.result, "applied");
  const detail = await platformCall(m.staff.operations.token, `/platform/v1/orders/${order.id}`, "/platform/v1/orders/{id}");
  assert.deepEqual([detail.body.order.payment.refunded, detail.body.order.payment.disputed], [{ amount: "5000", currency: "JPY" }, true]);

  assert.equal((await notify("customer.created", { id: "cus_x", object: "customer" })).body.result, "ignored");
  assert.equal((await notify("payment_intent.succeeded", { ...pay.intentObject(intent), id: "pi_not_ours" })).body.result, "unmatched");
  assert.equal((await notify("payment_intent.succeeded", pay.intentObject(intent), { livemode: true })).body.result, "livemode_mismatch");
  const results = (await api.db.owner.query("select type, result from payment_events where order_id = $1 order by received_at, id", [order.id])).rows.map((r) => `${r.type}:${r.result}`);
  assert.ok(results.includes("payment_intent.succeeded:mismatch") && results.includes("charge.dispute.created:applied"), results.join(", "));
  assert.ok(api.logs().includes("拒付"), "拒付记了错误日志");
});

test("付款被取消（payment_intent.canceled）：待支付的单取消、记原因", async () => {
  const order = await newOrder();
  const intent = intentOf(order.id);
  await notify("payment_intent.canceled", pay.intentObject(intent, { status: "canceled" }));
  assert.deepEqual(Object.values(await row("select o.status, o.cancel_reason, p.status as payment from orders o join order_payments p on p.order_id = o.id where o.id = $1", [order.id])), ["cancelled", "PAYMENT_CANCELED", "canceled"]);
  assert.equal((await salesOrder(order.id)).body.order.cancel_reason, "PAYMENT_CANCELED");
});

test("超时：到期前不动；到期后先在收款服务取消付款再取消订单；最后一刻付了款（通知还没到）的不取消、确认；取消后钱才到的记成支付异常；收款服务出错下一轮再试", async () => {
  const flaky = await newOrder();
  const paidLate = await newOrder();
  const abandoned = await newOrder();
  pay.pay(intentOf(paidLate.id));
  const status = async (id: string): Promise<string> => (await row("select status from orders where id = $1", [id])).status;
  api.clock.advance(30 * 60_000 - 10_000);
  await api.app.orderJobs.tick();
  assert.deepEqual([await status(flaky.id), await status(paidLate.id), await status(abandoned.id)], ["pending_payment", "pending_payment", "pending_payment"], "还没到期");
  api.clock.advance(10_000);
  // 到期的按到期时间处理：第一张（flaky）在收款服务取消付款时出错，留给下一轮
  pay.failNext("PAYMENT_PROVIDER_UNAVAILABLE");
  assert.deepEqual(await api.app.orderJobs.tick(), { cancelled: 1, confirmed: 1, deferred: 1 });
  assert.deepEqual([await status(flaky.id), await status(paidLate.id), await status(abandoned.id)], ["pending_payment", "confirmed", "cancelled"]);
  assert.equal((await row("select actor from order_events where order_id = $1 and to_status = 'confirmed'", [paidLate.id])).actor, "system", "最后一刻付了款的确认，不取消");
  assert.equal(pay.intents.get(intentOf(abandoned.id))?.status, "canceled", "先在收款服务取消了付款");
  assert.deepEqual(await api.app.orderJobs.tick(), { cancelled: 1, confirmed: 0, deferred: 0 });
  assert.equal(await status(flaky.id), "cancelled");
  // 通知晚到：已经确认的不重复确认
  assert.equal((await notify("payment_intent.succeeded", pay.intentObject(intentOf(paidLate.id)))).body.result, "applied");
  assert.equal((await row("select count(*)::int as n from order_events where order_id = $1 and to_status = 'confirmed'", [paidLate.id])).n, 1);
  // 取消之后钱才到（取消付款和付款同时发生）：不复活订单，标记给财务
  const late = await notify("payment_intent.succeeded", pay.intentObject(intentOf(abandoned.id), { status: "succeeded", payment_method: "pm_fake_late" }));
  assert.equal(late.body.result, "applied");
  assert.deepEqual(Object.values(await row("select o.status, p.status as payment, p.paid_after_cancel from orders o join order_payments p on p.order_id = o.id where o.id = $1", [abandoned.id])), ["cancelled", "succeeded", true]);
  assert.ok(api.logs().includes("需要财务核实并退款"));
});

test("并发下单不超卖：限量 2 单的那一天，6 个报价同时下单只成 2 单；付款转已售，超时未付的释放", async () => {
  // 甲的商品（经济 4 座只有甲有）设成限量：2026-10-20 可售 2 单
  const call = (method: "GET" | "PUT" | "POST", path: string, body?: unknown, version?: number) =>
    ok(api.call(method, `/tenant/v1/products/${m.ids.pa}${path}`, { token: m.a.adminToken, ...(body === undefined ? {} : { body }), ...(version === undefined ? {} : { headers: { "if-match": `"${version}"` } }) }));
  const version = async (): Promise<number> => (await call("GET", "/inventory?from=2026-10-20&to=2026-10-20")).version;
  await call("PUT", "/inventory", { mode: "limited" }, await version());
  await call("POST", "/inventory/batch-set", { from: "2026-10-20", to: "2026-10-20", total: 2 }, await version());
  const quotes = [];
  for (let i = 0; i < 6; i += 1) quotes.push(await quoteFor(m.ids.eco4));
  const token = await salesToken();
  api.clock.advance(1_000);
  const results = await Promise.all(quotes.map((quote) => api.call("POST", "/sales/v1/orders", { token, body: { quote_id: quote.quote_id, ...details() }, headers: { "idempotency-key": randomUUID() } })));
  for (const res of results) assertMatchesOperation("POST", "/sales/v1/orders", res.status, res.body);
  const won = results.filter((res) => res.status === 201);
  const lost = results.filter((res) => res.status !== 201);
  assert.equal(won.length, 2, results.map((r) => `${r.status} ${r.body?.error?.code ?? ""}`).join(", "));
  assert.deepEqual([...new Set(lost.map((res) => `${res.status}:${res.body.error.code}:${res.body.error.details.reason}`))], ["409:SOLD_OUT:SOLD_OUT"]);
  const day = async (): Promise<[number, number, number]> => {
    const r = await row("select total, held, sold from inventory_days where tenant_id = $1 and product_id = $2 and day = '2026-10-20'", [m.a.tenantId, m.ids.pa]);
    return [r.total, r.held, r.sold];
  };
  assert.deepEqual(await day(), [2, 2, 0], "两单预占");
  assert.equal((await row("select count(*)::int as n from orders where product_id = $1 and inventory_held", [m.ids.pa])).n, 2);
  // 订满之后询价报不出
  await salesToken();
  api.clock.advance(1_000);
  const soldOut = await api.call("POST", "/sales/v1/quotes", { token, body: ask({ vehicle_group_ids: [m.ids.eco4] }) });
  assert.equal(soldOut.body.quotes.length, 0);
  assert.ok(soldOut.body.unavailable[0].reasons.includes("SOLD_OUT"), JSON.stringify(soldOut.body.unavailable));
  // 一单付款：预占转已售；另一单超时：释放
  const [first, second] = won.map((res) => res.body.order);
  await paid(first.id);
  assert.deepEqual(await day(), [2, 1, 1]);
  api.clock.advance(30 * 60_000);
  await api.app.orderJobs.tick();
  assert.equal((await row("select status from orders where id = $1", [second.id])).status, "cancelled");
  assert.deepEqual(await day(), [2, 0, 1], "超时未付款，预占释放");
  // 释放之后又能订了
  assert.equal((await newOrder(m.ids.eco4)).status, "pending_payment");
  assert.deepEqual(await day(), [2, 1, 1]);
});

test("租户隔离：租户 A 读不到、改不了租户 B 的订单（接口 404，数据库层面读不到、改不了）；没付款的单租户看不到；权限按角色", async () => {
  const order = await newOrder();
  await paid(order.id);
  // B 能看；A 看不到（和不存在一样 404），列表里也没有
  assert.equal((await tenantCall(m.b.adminToken, `/tenant/v1/orders/${order.id}`, "/tenant/v1/orders/{id}")).status, 200);
  const fromA = await tenantCall(m.a.adminToken, `/tenant/v1/orders/${order.id}`, "/tenant/v1/orders/{id}");
  const missing = await tenantCall(m.a.adminToken, `/tenant/v1/orders/${randomUUID()}`, "/tenant/v1/orders/{id}");
  assert.deepEqual([fromA.status, fromA.body], [404, missing.body]);
  const listA = await tenantCall(m.a.adminToken, "/tenant/v1/orders?limit=200", "/tenant/v1/orders");
  assert.ok(!listA.body.items.some((item: any) => item.id === order.id));
  assert.ok(listA.body.items.every((item: any) => item.product_id === m.ids.pa), "A 只看到自己的单");
  // 请求里带 tenant_id 没有用（租户只来自令牌）
  const sneaky = await tenantCall(m.a.adminToken, `/tenant/v1/orders?tenant_id=${m.b.tenantId}`, "/tenant/v1/orders");
  assert.equal(sneaky.status, 200);
  assert.ok(!sneaky.body.items.some((item: any) => item.id === order.id), "查询参数里的 tenant_id 被忽略");
  // 数据库层面：A 的租户事务读不到 B 的单，也改不了别人的单；B 自己也只能改派车和履约的那几列、只能在履约的范围里改状态（M3-02，ADR 0027）；订单的销售端一侧、收款、通知一张都碰不到
  const seen = await withTenantTx(api.db.pool, m.a.tenantId, (db) => db.query("select id from orders where id = $1", [order.id]));
  assert.equal(seen.rowCount, 0);
  await assert.rejects(withTenantTx(api.db.pool, m.a.tenantId, (db) => db.query("update orders set notes = 'x' where id = $1", [order.id])), deniedByDatabase);
  await assert.rejects(withTenantTx(api.db.pool, m.b.tenantId, (db) => db.query("update orders set status = 'cancelled' where id = $1", [order.id])), deniedByDatabase, "B 自己也不能直接取消（取消只有平台能写）");
  await assert.rejects(withTenantTx(api.db.pool, m.a.tenantId, (db) => db.query("insert into order_events (tenant_id, order_id, to_status, actor, occurred_at) values ($1, $2, 'cancelled', 'system', now())", [m.b.tenantId, order.id])), deniedByDatabase);
  for (const table of ["order_sales", "order_payments", "payment_events"]) {
    await assert.rejects(withTenantTx(api.db.pool, m.b.tenantId, (db) => db.query(`select * from ${table}`)), deniedByDatabase, table);
  }
  // 角色：调度、财务、只读能看；商品价格不能看
  const dispatcher = await addTenantUser(api, m.b.adminToken, "dispatch@market-b.test", "dispatch");
  const pricing = await addTenantUser(api, m.b.adminToken, "pricing@market-b.test", "pricing");
  assert.equal((await tenantCall(dispatcher.token, "/tenant/v1/orders", "/tenant/v1/orders")).status, 200);
  const denied = await tenantCall(pricing.token, "/tenant/v1/orders", "/tenant/v1/orders");
  assert.deepEqual([denied.status, denied.body.error.details.required], [403, "order.read"]);
  // 平台：主数据运营、渠道经理看不到订单（有乘客联系方式），只读能看
  for (const who of [m.staff.masterData.token, m.staff.cm1.token]) assert.equal((await platformCall(who, "/platform/v1/orders", "/platform/v1/orders")).status, 403);
  assert.equal((await platformCall(m.staff.readonly.token, `/platform/v1/orders/${randomUUID()}`, "/platform/v1/orders/{id}")).status, 404);
});

test("规则 4：租户端订单接口的应答里逐层没有渠道、对外价、加价比例、汇率、付款的任何字段，原文里也没有对外价和渠道", async () => {
  const order = await newOrder();
  await paid(order.id);
  const list = await tenantCall(m.b.adminToken, "/tenant/v1/orders?limit=200", "/tenant/v1/orders");
  const detail = await tenantCall(m.b.adminToken, `/tenant/v1/orders/${order.id}`, "/tenant/v1/orders/{id}");
  for (const res of [list, detail]) {
    const keys = [...allKeys(res.body)];
    assert.deepEqual(keys.filter((key) => /sell|markup|margin|channel|fx|quote|payment|intent|customer_id|candidate|winner|band|buffer|rank/i.test(key)), [], res.text.slice(0, 200));
    for (const secret of [channelId, "21780", "官网", "WEB-0001", pay.intentOf(order.id)?.id ?? "pi_"]) assert.ok(!res.text.includes(secret), `租户的应答里出现了 ${secret}`);
  }
  assert.ok(detail.text.includes("19800"), "结算价租户能看");
});

test("每日加急库存：两单同时抢最后一个加急名额只成一单；用完之后询价报不出；待支付的单超时取消后名额回来", async () => {
  // 乙的商品开加急：提前 24 小时以内加收 3,000，每天限 1 单
  const product = await ok(api.call("GET", `/tenant/v1/products/${m.ids.pb}`, { token: m.b.adminToken }));
  await ok(
    api.call("PUT", `/tenant/v1/products/${m.ids.pb}/service-rules`, {
      token: m.b.adminToken,
      headers: { "if-match": `"${product.version}"` },
      body: { booking: { service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 24 }, urgent: { enabled: true, daily_quota: 1, tiers: [{ within_hours: 24, surcharge: 3_000 }] }, free_wait: { pickup: { mode: "limited", minutes: 90 }, dropoff: { mode: "limited", minutes: 15 } } },
    }),
  );
  // 询价用的商品目录有 30 秒缓存（ADR 0020，改规则 1 分钟内生效）：等它过期，新的服务规则才进询价
  api.clock.advance(QUOTE_CATALOG_TTL_MS);
  // 6 小时后用车（东京时间，取整点）：只有乙能加急
  const at = new Date(Math.ceil((api.clock.now().getTime() + 6 * 3_600_000) / 3_600_000) * 3_600_000);
  const serviceTime = `${new Date(at.getTime() + 9 * 3_600_000).toISOString().slice(0, 16)}:00+09:00`;
  const urgentQuote = async (): Promise<ApiResponse> => {
    const who = await salesToken();
    api.clock.advance(1_000);
    return api.call("POST", "/sales/v1/quotes", { token: who, body: ask({ service_time: serviceTime, vehicle_group_ids: [m.ids.biz7] }) });
  };
  const quotes = [(await urgentQuote()).body.quotes[0], (await urgentQuote()).body.quotes[0]];
  // (19,800 + 3,000) × 1.1 = 25,080
  assert.deepEqual(quotes.map((q) => [q.urgent, q.price.total.amount]), [[true, "25080"], [true, "25080"]]);
  const who = await salesToken();
  api.clock.advance(1_000);
  const results = await Promise.all(quotes.map((q) => api.call("POST", "/sales/v1/orders", { token: who, body: { quote_id: q.quote_id, ...details() }, headers: { "idempotency-key": randomUUID() } })));
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409], results.map((r) => r.text).join("\n"));
  const lost = results.find((r) => r.status === 409) as ApiResponse;
  assert.deepEqual([lost.body.error.code, lost.body.error.details.reason], ["SOLD_OUT", "URGENT_SOLD_OUT"]);
  const won = (results.find((r) => r.status === 201) as ApiResponse).body.order;
  assert.equal((await row("select urgent from orders where id = $1", [won.id])).urgent, true);
  // 名额用完：乙报 URGENT_SOLD_OUT，甲提前量不够——这个车型组报不出
  const full = await urgentQuote();
  assert.equal(full.body.quotes.length, 0);
  assert.deepEqual([...full.body.unavailable[0].reasons].sort(), ["LEAD_TIME_TOO_SHORT", "SOLD_OUT"]);
  // 没付款，超时取消：名额回来
  api.clock.advance(30 * 60_000);
  await api.app.orderJobs.tick();
  assert.equal((await row("select status from orders where id = $1", [won.id])).status, "cancelled");
  assert.equal((await urgentQuote()).body.quotes.length, 1);
});
