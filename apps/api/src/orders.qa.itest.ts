/**
 * M3-01 测试角色补充（ADR 0026）：钱、库存、竞态、Webhook 边界、隔离与规则 4、畸形入参。经真实接口、真实 PostgreSQL（独立 schema），收款服务用替身。
 * 与 orders.itest.ts 不重复：跨币种（两位小数 / 零小数）、报价后改价、幂等键跨渠道、重放已取消的单、并发同一报价、
 * 只释放一次、超时与付款通知同时到、超时检查拿着旧的付款编号、Webhook 的请求体上限和内容异常、日志与通知记录里没有卡信息、
 * 平台员工的权限矩阵、平台角色只能改允许的列、下单与查单的畸形入参不 500。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { CurrencyCode, FxQuote, PlatformRole } from "@nozomi/domain";
import { withPlatformTx } from "./db/context.ts";
import type { CreateOrderPaymentInput, ProviderPayment } from "./integrations/payments.ts";
import { type ApiResponse, TEST_PASSWORD, type TestApi, addTenantUser, createTestApi } from "./testing/api.ts";
import { deniedByDatabase } from "./testing/db.ts";
import { type Market, DROPOFF, SERVICE_TIME, allKeys, newChannel, ok, salesCredentials, buildMarket } from "./testing/market.ts";
import { assertMatchesOperation } from "./testing/openapi.ts";
import { FakePaymentProvider, deliverWebhook } from "./testing/payments.ts";

/** 替身加两个钩子：建付款返回之前、取消付款之前，测试可以插进别的操作（模拟两件事同时发生）。 */
class HookedPayments extends FakePaymentProvider {
  beforeCreateReturns: ((input: CreateOrderPaymentInput) => Promise<void>) | null = null;
  beforeCancel: ((intentId: string) => Promise<void>) | null = null;
  override async createOrderPayment(input: CreateOrderPaymentInput): Promise<ProviderPayment> {
    const created = await super.createOrderPayment(input);
    const hook = this.beforeCreateReturns;
    this.beforeCreateReturns = null;
    if (hook !== null) await hook(input);
    return created;
  }
  override async cancelPayment(intentId: string): Promise<ProviderPayment> {
    const hook = this.beforeCancel;
    this.beforeCancel = null;
    if (hook !== null) await hook(intentId);
    return super.cancelPayment(intentId);
  }
}

/** 汇率替身：1 日元 = 0.0067 美元、9.6 韩元 */
const RATES: Partial<Record<CurrencyCode, string>> = { USD: "0.0067", KRW: "9.6" };
const fxQuote = async (from: CurrencyCode, to: CurrencyCode, at: Date): Promise<FxQuote | null> => (from === "JPY" && RATES[to] !== undefined ? { from, to, rate: RATES[to] as string, asOf: at.toISOString() } : null);

let api: TestApi;
let m: Market;
let pay: HookedPayments;
let channelId: string;
let creds: { clientId: string; secret: string; token: string };
let issuedAt = 0;

before(async () => {
  pay = new HookedPayments();
  api = await createTestApi({ payments: pay, quote: { fx: { quote: fxQuote } } });
  m = await buildMarket(api);
  channelId = (await newChannel(api, m.staff.cm1.token, { name: "QA 官网" })).id;
  creds = await salesCredentials(api, m, channelId);
  issuedAt = api.clock.now().getTime();
});
after(() => api.close());

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

async function quoteFor(vehicleGroupId: string, extra: Record<string, unknown> = {}, who?: string): Promise<any> {
  who ??= await salesToken();
  api.clock.advance(1_000);
  const res = await api.call("POST", "/sales/v1/quotes", { token: who, body: ask({ vehicle_group_ids: [vehicleGroupId], ...extra }) });
  assert.equal(res.status, 200, res.text);
  const found = res.body.quotes.find((q: any) => q.vehicle_group_id === vehicleGroupId);
  assert.ok(found, `没有报出 ${vehicleGroupId} 的价：${res.text}`);
  return found;
}

const details = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  passenger: { name: "李四", phone: "+86 138 0013 8000", email: "qa-guest@example.com" },
  flight_no: "MU521",
  dropoff_address: "新宿站南口",
  save_payment_method: true,
  ...extra,
});

async function placeOrder(body: unknown, key: string | null = randomUUID(), who?: string): Promise<ApiResponse> {
  who ??= await salesToken();
  api.clock.advance(1_000);
  const res = await api.call("POST", "/sales/v1/orders", { token: who, body, ...(key === null ? {} : { headers: { "idempotency-key": key } }) });
  assert.notEqual(res.status, 500, res.text);
  assertMatchesOperation("POST", "/sales/v1/orders", res.status, res.body);
  return res;
}

async function newOrder(vehicleGroupId: string = m.ids.biz7, quoteExtra: Record<string, unknown> = {}): Promise<any> {
  const quote = await quoteFor(vehicleGroupId, quoteExtra);
  const res = await placeOrder({ quote_id: quote.quote_id, ...details() });
  assert.equal(res.status, 201, res.text);
  return res.body.order;
}

const intentOf = (orderId: string): string => {
  const intent = pay.intentOf(orderId);
  assert.ok(intent, "替身里没有这张单的付款");
  return intent.id;
};

async function notify(type: string, object: Record<string, unknown>, options: { id?: string; livemode?: boolean } = {}): Promise<{ status: number; body: any }> {
  const raw = pay.event(type, object, { ...options, created: api.clock.now() });
  return deliverWebhook(api.app, raw, pay.sign(raw, api.clock.now()));
}

async function paid(orderId: string): Promise<any> {
  const intent = intentOf(orderId);
  pay.pay(intent);
  const res = await notify("payment_intent.succeeded", pay.intentObject(intent));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body;
}

const row = async (sql: string, params: unknown[] = []): Promise<any> => (await api.db.owner.query(sql, params)).rows[0];
const orderState = async (id: string): Promise<[string, string]> => {
  const r = await row("select o.status, p.status as payment from orders o join order_payments p on p.order_id = o.id where o.id = $1", [id]);
  return [r.status, r.payment];
};

/** 把甲的商品（经济 4 座只有甲有）在某几天设成限量。 */
async function limitEco4(from: string, to: string, total: number): Promise<void> {
  const call = (method: "GET" | "PUT" | "POST", path: string, body?: unknown, version?: number) =>
    ok(api.call(method, `/tenant/v1/products/${m.ids.pa}${path}`, { token: m.a.adminToken, ...(body === undefined ? {} : { body }), ...(version === undefined ? {} : { headers: { "if-match": `"${version}"` } }) }));
  const version = async (): Promise<number> => (await call("GET", `/inventory?from=${from}&to=${to}`)).version;
  const current = await call("GET", `/inventory?from=${from}&to=${to}`);
  if (current.mode !== "limited") await call("PUT", "/inventory", { mode: "limited" }, await version());
  await call("POST", "/inventory/batch-set", { from, to, total }, await version());
}
const day = async (date: string): Promise<[number, number, number]> => {
  const r = await row("select total, held, sold from inventory_days where tenant_id = $1 and product_id = $2 and day = $3", [m.a.tenantId, m.ids.pa, date]);
  return [r.total, r.held, r.sold];
};

// ---- 钱 ----

test("跨币种（美元，两位小数）：订单、收款金额严格等于报价快照（对外价、汇率、缓冲、加价比例），结算价仍是日元；Stripe 收的是美分整数", async () => {
  const quote = await quoteFor(m.ids.biz7, { currency: "USD" });
  assert.equal(quote.price.total.currency, "USD");
  assert.match(quote.price.total.amount, /^\d+\.\d{2}$/);
  const snapshot = (await row("select snapshot from quotes where id = $1", [quote.quote_id])).snapshot;
  const res = await placeOrder({ quote_id: quote.quote_id, ...details() });
  assert.equal(res.status, 201, res.text);
  const order = res.body.order;
  assert.deepEqual(order.price, quote.price, "下单应答的对外价和汇率与报价一字不差");
  const intent = pay.intentOf(order.id);
  assert.ok(intent);
  assert.deepEqual([intent.amountMinor, intent.currency], [snapshot.winner.sell.sellMinor, "USD"]);
  assert.ok(Number.isSafeInteger(intent.amountMinor));
  assert.equal(intent.amountMinor, Math.round(Number(quote.price.total.amount) * 100), "美分 = 美元 × 100");
  const sale = await row("select * from order_sales where order_id = $1", [order.id]);
  assert.deepEqual([Number(sale.sell_minor), sale.currency, sale.markup_bp, sale.fx, sale.fx_buffer_bp], [snapshot.winner.sell.sellMinor, "USD", snapshot.winner.sell.markupBp, snapshot.winner.sell.fx, snapshot.winner.sell.fxBufferBp]);
  assert.equal(sale.fx.rate, "0.0067");
  const saved = await row("select settlement_minor, settlement_currency, settlement from orders where id = $1", [order.id]);
  assert.deepEqual([Number(saved.settlement_minor), saved.settlement_currency, saved.settlement], [snapshot.winner.offer.settlement.totalMinor, "JPY", snapshot.winner.offer.settlement]);
  const payment = await row("select amount_minor, currency from order_payments where order_id = $1", [order.id]);
  assert.deepEqual([Number(payment.amount_minor), payment.currency], [snapshot.winner.sell.sellMinor, "USD"]);

  // 金额以美元为单位（少乘了 100）、币种换成日元：都是对不上，不确认
  pay.pay(intent.id);
  assert.equal((await notify("payment_intent.succeeded", pay.intentObject(intent.id, { amount: Math.round(intent.amountMinor / 100) }))).body.result, "mismatch");
  assert.equal((await notify("payment_intent.succeeded", pay.intentObject(intent.id, { currency: "jpy" }))).body.result, "mismatch");
  assert.equal((await notify("payment_intent.succeeded", pay.intentObject(intent.id, { amount: intent.amountMinor + 1 }))).body.result, "mismatch");
  assert.deepEqual(await orderState(order.id), ["pending_payment", "requires_payment"]);
  // 币种大写也认（Stripe 发小写，大小写不影响）
  assert.equal((await notify("payment_intent.succeeded", pay.intentObject(intent.id, { currency: "USD" }))).body.result, "applied");
  assert.deepEqual(await orderState(order.id), ["confirmed", "succeeded"]);

  // 规则 4：租户看到日元结算价，看不到美元、汇率、对外价
  const tenant = await api.call("GET", `/tenant/v1/orders/${order.id}`, { token: m.b.adminToken });
  assert.equal(tenant.status, 200, tenant.text);
  assert.deepEqual(tenant.body.order.settlement.total, { amount: String(snapshot.winner.offer.settlement.totalMinor), currency: "JPY" });
  for (const leak of ["USD", "0.0067", quote.price.total.amount, String(snapshot.winner.sell.sellMinor), quote.quote_id, channelId]) assert.ok(!tenant.text.includes(leak), `租户应答里出现了 ${leak}`);
  const list = await api.call("GET", "/tenant/v1/orders?limit=200", { token: m.b.adminToken });
  for (const leak of ["USD", "0.0067", quote.quote_id]) assert.ok(!list.text.includes(leak), `租户列表里出现了 ${leak}`);
});

test("跨币种（韩元，零小数）：对外价没有小数点，Stripe 金额就是韩元整数", async () => {
  const quote = await quoteFor(m.ids.biz7, { currency: "KRW" });
  assert.match(quote.price.total.amount, /^\d+$/, "韩元没有小数");
  const res = await placeOrder({ quote_id: quote.quote_id, ...details() });
  assert.equal(res.status, 201, res.text);
  const intent = pay.intentOf(res.body.order.id);
  assert.deepEqual([intent?.amountMinor, intent?.currency], [Number(quote.price.total.amount), "KRW"]);
  assert.deepEqual(res.body.order.price.total, quote.price.total);
});

test("运营后台的订单详情：汇率照报价快照给出，含人工锁定（M2-06）——没有锁定为 null，快照里有锁定就写明哪一边、锁定值、到期时间", async () => {
  const quote = await quoteFor(m.ids.biz7, { currency: "USD" });
  const placed = await placeOrder({ quote_id: quote.quote_id, ...details() });
  assert.equal(placed.status, 201, placed.text);
  const id = placed.body.order.id as string;
  const detail = async (): Promise<any> => {
    const res = await api.call("GET", `/platform/v1/orders/${id}`, { token: m.staff.operations.token });
    assert.equal(res.status, 200, res.text);
    assertMatchesOperation("GET", "/platform/v1/orders/{id}", res.status, res.body);
    return res.body.order.fx;
  };
  const plain = await detail();
  assert.deepEqual([plain.rate, plain.lock], ["0.0067", null]);
  // 报价时日元一边用的是人工锁定（快照原样存进订单的销售端一侧）
  const lockId = randomUUID();
  const locked: FxQuote = { ...(await row("select fx from order_sales where order_id = $1", [id])).fx, lock: { legs: [{ currency: "JPY", rate: "149.5", lockId, expiresAt: "2026-10-09T00:00:00.000Z" }], usesSource: false } };
  await api.db.owner.query("update order_sales set fx = $2::jsonb where order_id = $1", [id, JSON.stringify(locked)]);
  assert.deepEqual((await detail()).lock, { legs: [{ currency: "JPY", rate: "149.5", lock_id: lockId, expires_at: "2026-10-09T00:00:00.000Z" }], uses_source: false });
});

test("报价之后供应商改了价格：订单仍按快照收钱和结算，不重新报价", async () => {
  const quote = await quoteFor(m.ids.biz7);
  const snapshot = (await row("select snapshot from quotes where id = $1", [quote.quote_id])).snapshot;
  const rules = (await api.db.owner.query("select id, params from price_rules where tenant_id = $1 and product_id = $2", [m.b.tenantId, m.ids.pb])).rows;
  assert.ok(rules.length > 0);
  for (const rule of rules) {
    const params = { ...rule.params };
    const key = Object.keys(params).find((k) => /base/i.test(k) && typeof params[k] === "number");
    assert.ok(key, JSON.stringify(params));
    params[key] = 50_000;
    await api.db.owner.query("update price_rules set params = $3::jsonb where tenant_id = $1 and id = $2", [m.b.tenantId, rule.id, JSON.stringify(params)]);
  }
  try {
    api.clock.advance(31_000);
    const fresh = await quoteFor(m.ids.biz7);
    assert.notEqual(fresh.price.total.amount, quote.price.total.amount, "改价已经生效（新询价的价格变了）");
    const res = await placeOrder({ quote_id: quote.quote_id, ...details() });
    assert.equal(res.status, 201, res.text);
    assert.deepEqual(res.body.order.price.total, quote.price.total);
    assert.equal(pay.intentOf(res.body.order.id)?.amountMinor, Number(quote.price.total.amount));
    assert.equal(Number((await row("select settlement_minor from orders where id = $1", [res.body.order.id])).settlement_minor), snapshot.winner.offer.settlement.totalMinor);
  } finally {
    for (const rule of rules) await api.db.owner.query("update price_rules set params = $3::jsonb where tenant_id = $1 and id = $2", [m.b.tenantId, rule.id, JSON.stringify(rule.params)]);
    api.clock.advance(31_000);
  }
});

// ---- 幂等 ----

test("幂等键按渠道隔离：另一个渠道用同一个键下自己的单照常建；另一个渠道拿同一个键 + 本渠道的报价得不到本渠道的单", async () => {
  const key = `qa-${randomUUID()}`;
  const mineQuote = await quoteFor(m.ids.biz7);
  const mine = await placeOrder({ quote_id: mineQuote.quote_id, ...details() }, key);
  assert.equal(mine.status, 201, mine.text);
  const other = (await newChannel(api, m.staff.cm1.token, { name: "QA 别的渠道" })).id;
  const otherToken = (await salesCredentials(api, m, other, "198.51.100.88")).token;
  const stolen = await placeOrder({ quote_id: mineQuote.quote_id, ...details() }, key, otherToken);
  assert.deepEqual([stolen.status, stolen.body.error.details.issues?.[0]?.reason], [400, "UNKNOWN_QUOTE"]);
  assert.ok(!stolen.text.includes(mine.body.order.id));
  const theirsQuote = await quoteFor(m.ids.biz7, {}, otherToken);
  const theirs = await placeOrder({ quote_id: theirsQuote.quote_id, ...details() }, key, otherToken);
  assert.equal(theirs.status, 201, theirs.text);
  assert.notEqual(theirs.body.order.id, mine.body.order.id);
  assert.equal(theirs.headers["idempotent-replayed"], undefined);
});

test("重放：报价过期后同一个键 + 同样内容仍返回那张单；单超时取消后重放返回已取消的单、没有 client_secret、不再碰收款服务", async () => {
  const quote = await quoteFor(m.ids.biz7);
  const key = randomUUID();
  const body = { quote_id: quote.quote_id, ...details() };
  const first = await placeOrder(body, key);
  assert.equal(first.status, 201, first.text);
  api.clock.advance(30 * 60_000 - 10_000);
  const pastQuote = await placeOrder(body, key);
  assert.deepEqual([pastQuote.status, pastQuote.headers["idempotent-replayed"], pastQuote.body.order.id, pastQuote.body.payment.client_secret], [201, "true", first.body.order.id, first.body.payment.client_secret]);
  api.clock.advance(20_000);
  await api.app.orderJobs.tick();
  assert.deepEqual(await orderState(first.body.order.id), ["cancelled", "canceled"]);
  const calls = pay.calls.length;
  const cancelled = await placeOrder(body, key);
  assert.deepEqual([cancelled.status, cancelled.body.order.id, cancelled.body.order.status, cancelled.body.payment.client_secret], [201, first.body.order.id, "cancelled", null]);
  assert.equal(pay.calls.length, calls, "已取消的单不再去收款服务建或查付款");
  assert.equal((await row("select count(*)::int as n from orders o join order_sales s on s.order_id = o.id where s.quote_id = $1", [quote.quote_id])).n, 1);
});

test("同一个报价换两个键同时下单（限量商品）：一张 201、一张 409；只建一张单，库存只占 1", async () => {
  await limitEco4("2026-10-20", "2026-10-20", 5);
  const quote = await quoteFor(m.ids.eco4);
  const who = await salesToken();
  api.clock.advance(1_000);
  const results = await Promise.all([0, 1, 2].map(() => api.call("POST", "/sales/v1/orders", { token: who, body: { quote_id: quote.quote_id, ...details() }, headers: { "idempotency-key": randomUUID() } })));
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409, 409], results.map((r) => r.text).join("\n"));
  for (const r of results.filter((x) => x.status === 409)) assert.equal(r.body.error.code, "QUOTE_ALREADY_ORDERED");
  assert.equal((await row("select count(*)::int as n from order_sales where quote_id = $1", [quote.quote_id])).n, 1);
  assert.deepEqual(await day("2026-10-20"), [5, 1, 0], "回滚的那几次没有留下预占");
  // 收尾：这张单超时取消，库存回到 0
  api.clock.advance(31 * 60_000);
  await api.app.orderJobs.tick();
  assert.deepEqual(await day("2026-10-20"), [5, 0, 0]);
});

// ---- 库存 ----

test("限量最后 1 个：两单同时抢只成一单；超时取消释放只释放一次（超时检查跑两轮、付款被取消的通知晚到，都不会把别的单的预占也减掉）", async () => {
  await limitEco4("2026-10-22", "2026-10-22", 1);
  const at = { service_time: "2026-10-22T10:00:00+09:00" };
  const quotes = [await quoteFor(m.ids.eco4, at), await quoteFor(m.ids.eco4, at)];
  const who = await salesToken();
  api.clock.advance(1_000);
  const results = await Promise.all(quotes.map((q) => api.call("POST", "/sales/v1/orders", { token: who, body: { quote_id: q.quote_id, ...details() }, headers: { "idempotency-key": randomUUID() } })));
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409], results.map((r) => r.text).join("\n"));
  assert.deepEqual(await day("2026-10-22"), [1, 1, 0]);
  const first = (results.find((r) => r.status === 201) as ApiResponse).body.order;

  // 总量加到 2，再下一单：两单都预占
  await limitEco4("2026-10-22", "2026-10-22", 2);
  api.clock.advance(20 * 60_000);
  const second = await newOrder(m.ids.eco4, at);
  assert.deepEqual(await day("2026-10-22"), [2, 2, 0]);
  // 第一单到期（第二单还没到期）
  api.clock.advance(11 * 60_000);
  assert.equal((await api.app.orderJobs.tick()).cancelled >= 1, true);
  assert.deepEqual(await day("2026-10-22"), [2, 1, 0]);
  await api.app.orderJobs.tick();
  await Promise.all([api.app.orderJobs.tick(), api.app.orderJobs.tick()]);
  const late = await notify("payment_intent.canceled", pay.intentObject(intentOf(first.id), { status: "canceled" }));
  assert.equal(late.status, 200);
  assert.deepEqual(await day("2026-10-22"), [2, 1, 0], "第二单的预占还在");
  assert.equal((await row("select count(*)::int as n from order_events where order_id = $1 and to_status = 'cancelled'", [first.id])).n, 1);
  assert.equal((await row("select status from orders where id = $1", [second.id])).status, "pending_payment");
  await paid(second.id);
  assert.deepEqual(await day("2026-10-22"), [2, 0, 1]);
});

test("竞态：到期的单客人刚付了款，超时检查和付款成功的通知同时到——只确认一次，库存预占转已售一次", async () => {
  await limitEco4("2026-10-23", "2026-10-23", 3);
  const order = await newOrder(m.ids.eco4, { service_time: "2026-10-23T10:00:00+09:00" });
  assert.deepEqual(await day("2026-10-23"), [3, 1, 0]);
  const intent = intentOf(order.id);
  pay.pay(intent);
  api.clock.advance(31 * 60_000);
  const raw = pay.event("payment_intent.succeeded", pay.intentObject(intent), { created: api.clock.now() });
  const [, hook] = await Promise.all([api.app.orderJobs.tick(), deliverWebhook(api.app, raw, pay.sign(raw, api.clock.now()))]);
  assert.equal(hook.status, 200);
  assert.deepEqual(await orderState(order.id), ["confirmed", "succeeded"]);
  assert.deepEqual(await day("2026-10-23"), [3, 0, 1]);
  assert.equal((await row("select count(*)::int as n from order_events where order_id = $1 and to_status = 'confirmed'", [order.id])).n, 1);
});

test("竞态：超时检查和「付款被取消」的通知同时到——只取消一次、只释放一次", async () => {
  await limitEco4("2026-10-24", "2026-10-24", 3);
  const at = { service_time: "2026-10-24T10:00:00+09:00" };
  const keep = await newOrder(m.ids.eco4, at);
  api.clock.advance(5 * 60_000);
  const order = await newOrder(m.ids.eco4, at);
  assert.deepEqual(await day("2026-10-24"), [3, 2, 0]);
  await paid(keep.id);
  assert.deepEqual(await day("2026-10-24"), [3, 1, 1]);
  api.clock.advance(31 * 60_000);
  const raw = pay.event("payment_intent.canceled", pay.intentObject(intentOf(order.id), { status: "canceled" }), { created: api.clock.now() });
  await Promise.all([api.app.orderJobs.tick(), deliverWebhook(api.app, raw, pay.sign(raw, api.clock.now()))]);
  assert.deepEqual(await orderState(order.id), ["cancelled", "canceled"]);
  assert.deepEqual(await day("2026-10-24"), [3, 0, 1]);
  assert.equal((await row("select count(*)::int as n from order_events where order_id = $1 and to_status = 'cancelled'", [order.id])).n, 1);
});

test("取消后钱才到：不复活、不占库存、租户看不到；渠道查到已取消；运营后台标「取消后到账」", async () => {
  await limitEco4("2026-10-25", "2026-10-25", 1);
  const order = await newOrder(m.ids.eco4, { service_time: "2026-10-25T10:00:00+09:00" });
  api.clock.advance(31 * 60_000);
  await api.app.orderJobs.tick();
  assert.deepEqual(await day("2026-10-25"), [1, 0, 0]);
  // 名额被别人订走
  const other = await newOrder(m.ids.eco4, { service_time: "2026-10-25T10:00:00+09:00" });
  assert.deepEqual(await day("2026-10-25"), [1, 1, 0]);
  const intent = intentOf(order.id);
  const res = await notify("payment_intent.succeeded", pay.intentObject(intent, { status: "succeeded", payment_method: "pm_fake_late2" }));
  assert.equal(res.status, 200);
  assert.deepEqual(await day("2026-10-25"), [1, 1, 0], "没有超卖");
  const record = await row("select o.status, o.confirmed_at, p.paid_after_cancel from orders o join order_payments p on p.order_id = o.id where o.id = $1", [order.id]);
  assert.deepEqual([record.status, record.confirmed_at, record.paid_after_cancel], ["cancelled", null, true]);
  assert.equal((await api.call("GET", `/tenant/v1/orders/${order.id}`, { token: m.a.adminToken })).status, 404);
  api.clock.advance(1_000);
  const sales = await api.call("GET", `/sales/v1/orders/${order.id}`, { token: await salesToken() });
  assert.deepEqual([sales.body.order.status, sales.body.order.winning_tenant], ["cancelled", null]);
  const platform = await api.call("GET", `/platform/v1/orders/${order.id}`, { token: m.staff.operations.token });
  assert.equal(platform.body.order.payment.paid_after_cancel, true);
  api.clock.advance(31 * 60_000);
  await api.app.orderJobs.tick();
  assert.equal((await row("select status from orders where id = $1", [other.id])).status, "cancelled");
});

test("日期边界：东京时间 0:30 用车（UTC 还是前一天）按当地日期占库存；只设了当地那一天的库存也能下单", async () => {
  await limitEco4("2026-10-21", "2026-10-21", 2);
  const local = await newOrder(m.ids.eco4, { service_time: "2026-10-21T00:30:00+09:00" });
  const utc = await newOrder(m.ids.eco4, { service_time: "2026-10-20T15:30:00Z" });
  for (const order of [local, utc]) assert.deepEqual([order.service_date, order.service_local, order.service_time], ["2026-10-21", "2026-10-21T00:30", "2026-10-20T15:30:00.000Z"]);
  assert.deepEqual(await day("2026-10-21"), [2, 2, 0]);
  api.clock.advance(31 * 60_000);
  await api.app.orderJobs.tick();
  assert.deepEqual(await day("2026-10-21"), [2, 0, 0]);
});

/**
 * 防回归（曾经的缺陷，已修）：下单第 2 步（在收款服务建付款）进行中，超时检查先把单取消了（这时还没有付款编号，直接取消、收款记录标成已取消）；
 * 第 3 步记下付款编号时把收款状态覆盖成了 `requires_payment`。结果：订单已取消，收款记录却是「等客人付款」，运营后台看到的付款状态不对；
 * 第 3 步紧接着去收款服务取消这笔付款，如果那次取消失败，就一直停在「等客人付款」。
 * 原因：services/orders.ts `ensurePayment` 第 3 步只看 `record.intentId === null` 就写 `status: paymentStatusOf(created.status)`，没看订单 / 收款记录已经是取消。
 */
test("建付款进行中订单被超时取消：收款记录仍是已取消（不被第 3 步改回「等客人付款」），刚建的付款在收款服务被取消", async () => {
  const quote = await quoteFor(m.ids.biz7);
  pay.beforeCreateReturns = async () => {
    api.clock.advance(31 * 60_000);
    await api.app.orderJobs.tick();
  };
  const res = await placeOrder({ quote_id: quote.quote_id, ...details() });
  assert.equal(res.status, 201, res.text);
  const id = res.body.order.id as string;
  assert.equal(res.body.payment.client_secret, null, "已取消的单不给 client_secret");
  assert.equal(pay.intents.get(intentOf(id))?.status, "canceled", "刚建的付款在收款服务被取消了");
  assert.deepEqual(await orderState(id), ["cancelled", "canceled"]);
});

/**
 * 防回归（曾经的缺陷，已修）：超时检查一轮先列出到期的单（含当时的付款编号），再一张张处理；处理前一张时要调收款服务，可能要几秒到几十秒。
 * 这期间渠道用同一个 Idempotency-Key 重试一张「第一次建付款失败」的到期单：接口给它建了付款、返回 client_secret（订单已过付款期限却还能拿到付款凭据）。
 * 轮到这张单时，超时检查拿的还是列表里的旧值（没有付款编号），直接取消订单——没有先去收款服务取消那笔付款。
 * 结果：订单已取消，Stripe 那笔 PaymentIntent 仍然可以付，客人付了就是「取消后到账」，要人工退款。ADR 0026 写的「先取消付款再取消订单，保证不会出现订单取消了客人却还能付款」不成立。
 * 原因：services/order-jobs.ts `expire` 用的是 `listOverduePendingOrders` 时的 intentId，没有在锁住订单后重新读；services/orders.ts `ensurePayment` 不看付款期限。
 */
test("超时检查列表之后、处理之前渠道重试这张到期单：不再建付款、不给付款凭据，订单取消，收款服务里没有能付的付款", async () => {
  const earlier = await newOrder();
  const quote = await quoteFor(m.ids.biz7);
  const key = randomUUID();
  const body = { quote_id: quote.quote_id, ...details() };
  pay.failNext("PAYMENT_PROVIDER_UNAVAILABLE");
  const failed = await placeOrder(body, key);
  assert.equal(failed.status, 502, failed.text);
  const lateId = failed.body.error.details.order_id as string;
  api.clock.advance(31 * 60_000);
  let retried: ApiResponse | null = null;
  pay.beforeCancel = async (intentId) => {
    assert.equal(intentId, intentOf(earlier.id), "先处理更早到期的那张");
    retried = await placeOrder(body, key);
  };
  await api.app.orderJobs.tick();
  assert.ok(retried !== null);
  const again = retried as ApiResponse;
  assert.equal(again.status, 201, again.text);
  assert.equal((await row("select status from orders where id = $1", [lateId])).status, "cancelled");
  const intent = pay.intentOf(lateId);
  assert.ok(intent === undefined || intent.status === "canceled", `订单已取消，收款服务里的付款还是 ${intent?.status}，客人还能付款`);
});

// ---- Webhook ----

test("Webhook：多个 v1 里有一个对就收；超大请求体 413 不记录；Content-Type 带 charset 照常；签名对但内容不是事件 400 且不记录", async () => {
  const order = await newOrder();
  const intent = intentOf(order.id);
  const raw = pay.event("payment_intent.processing", pay.intentObject(intent, { status: "processing" }), { created: api.clock.now() });
  const t = Math.floor(api.clock.now().getTime() / 1000);
  const good = pay.sign(raw, api.clock.now()).split(",")[1] as string;
  const multi = await deliverWebhook(api.app, raw, `t=${t},v1=${"0".repeat(64)},${good},v0=${"1".repeat(64)}`);
  assert.deepEqual([multi.status, multi.body.result], [200, "applied"]);
  assert.equal((await orderState(order.id))[1], "processing");

  const before = (await row("select count(*)::int as n from payment_events")).n;
  const huge = pay.event("payment_intent.processing", { ...pay.intentObject(intent), padding: "x".repeat(300 * 1024) }, { created: api.clock.now() });
  const big = await deliverWebhook(api.app, huge, pay.sign(huge, api.clock.now()));
  assert.equal(big.status, 413, JSON.stringify(big.body));

  const charset = pay.event("payment_intent.requires_action", pay.intentObject(intent, { status: "requires_action" }), { created: api.clock.now() });
  const res = await api.app.inject({ method: "POST", url: "/webhooks/stripe", headers: { "content-type": "application/json; charset=utf-8", "stripe-signature": pay.sign(charset, api.clock.now()) }, payload: charset });
  assert.equal(res.statusCode, 200, res.body);

  for (const bad of ["null", "[]", '"x"', "{", JSON.stringify({ id: "evt_x", object: "event", type: "payment_intent.succeeded", created: t, data: { object: { ...pay.intentObject(intent), amount: 21780.5 } } }), JSON.stringify({ id: "evt_y", object: "event", type: "payment_intent.succeeded", created: t, data: { object: { ...pay.intentObject(intent), amount: "21780" } } })]) {
    const r = await deliverWebhook(api.app, bad, pay.sign(bad, api.clock.now()));
    assert.deepEqual([r.status, r.body?.error?.code], [400, "WEBHOOK_PAYLOAD_INVALID"], bad.slice(0, 60));
  }
  assert.equal((await row("select count(*)::int as n from payment_events")).n, before + 1, "只多了带 charset 的那一条");
  assert.equal((await orderState(order.id))[0], "pending_payment");
});

test("Webhook：已确认的单晚到「付款被取消」不取消、不释放；同一张单不同事件同时到（成功 + 失败）结果一致", async () => {
  await limitEco4("2026-10-26", "2026-10-26", 2);
  const order = await newOrder(m.ids.eco4, { service_time: "2026-10-26T10:00:00+09:00" });
  const intent = intentOf(order.id);
  pay.pay(intent);
  const ok1 = pay.event("payment_intent.succeeded", pay.intentObject(intent), { created: api.clock.now() });
  const fail = pay.event("payment_intent.payment_failed", pay.intentObject(intent, { status: "requires_payment_method", last_payment_error: { code: "card_declined", decline_code: "generic_decline", message: "x" } }), { created: api.clock.now() });
  const both = await Promise.all([deliverWebhook(api.app, ok1, pay.sign(ok1, api.clock.now())), deliverWebhook(api.app, fail, pay.sign(fail, api.clock.now()))]);
  assert.deepEqual(both.map((r) => r.status), [200, 200]);
  assert.deepEqual(await orderState(order.id), ["confirmed", "succeeded"]);
  const late = await notify("payment_intent.canceled", pay.intentObject(intent, { status: "canceled" }));
  assert.equal(late.status, 200);
  assert.deepEqual(await orderState(order.id), ["confirmed", "succeeded"]);
  assert.deepEqual(await day("2026-10-26"), [2, 0, 1]);
});

test("Webhook：卡信息、账单信息、签名密钥、client_secret 不进日志，也不进通知记录", async () => {
  const order = await newOrder();
  const intent = intentOf(order.id);
  pay.pay(intent);
  const secret = pay.intentOf(order.id)?.clientSecret as string;
  const billing = { email: "billing-qa@example.com", phone: "+819099998888", name: "Card Holder QA", address: { line1: "1-2-3 Ginza QA" } };
  await notify("payment_intent.succeeded", pay.intentObject(intent, { charges: { data: [{ billing_details: billing, payment_method_details: { card: { last4: "4242", exp_month: 12, exp_year: 2030, fingerprint: "fpQA123456" } } }] } }));
  await notify("charge.refunded", { id: "ch_fake_qa", object: "charge", payment_intent: intent, amount: 21_780, amount_refunded: 100, currency: "jpy", refunded: false, billing_details: billing, payment_method_details: { card: { last4: "4242", fingerprint: "fpQA123456" } } });
  await notify("charge.dispute.created", { id: "dp_fake_qa", object: "dispute", payment_intent: intent, amount: 21_780, currency: "jpy", reason: "fraudulent", status: "needs_response", evidence: { billing_address: "1-2-3 Ginza QA", customer_email_address: "billing-qa@example.com" } });
  const forged = pay.event("payment_intent.succeeded", pay.intentObject(intent), { created: api.clock.now() });
  await deliverWebhook(api.app, forged, `t=${Math.floor(api.clock.now().getTime() / 1000)},v1=${"a".repeat(64)}`);
  const logs = api.logs();
  const stored = JSON.stringify((await api.db.owner.query("select * from payment_events where order_id = $1", [order.id])).rows);
  for (const leak of [pay.webhookSecret, pay.webhookSecret.slice(6), secret, "billing-qa@example.com", "fpQA123456", "1-2-3 Ginza QA", "Card Holder QA", "+819099998888"]) {
    assert.ok(!logs.includes(leak), `日志里出现了 ${leak.slice(0, 12)}…`);
    assert.ok(!stored.includes(leak), `通知记录里出现了 ${leak.slice(0, 12)}…`);
  }
});

// ---- 隔离与权限 ----

async function staffToken(role: PlatformRole): Promise<string> {
  if (role === "super_admin") return m.root;
  const email = `qa-${role.replaceAll("_", "-")}-${randomUUID().slice(0, 6)}@platform.test`;
  const invited = await ok(api.call("POST", "/platform/v1/staff", { token: m.root, body: { email, name: role, role } }), 201);
  await ok(api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: invited.invite.token, password: TEST_PASSWORD } }));
  return (await ok(api.platformLogin({ body: { email, password: TEST_PASSWORD } }))).access_token;
}

test("权限矩阵：平台十个角色看订单（列表、详情）；租户角色；令牌串用（平台令牌查租户接口、租户令牌查平台接口、渠道令牌查两边）", async () => {
  const order = await newOrder();
  await paid(order.id);
  const expected: Record<PlatformRole, boolean> = { super_admin: true, operations: true, customer_service: true, finance: true, risk: true, readonly: true, tenant_onboarding: false, channel_manager: false, master_data: false, tech: false };
  for (const [role, allowed] of Object.entries(expected) as [PlatformRole, boolean][]) {
    const who = await staffToken(role);
    const list = await api.call("GET", "/platform/v1/orders", { token: who });
    const detail = await api.call("GET", `/platform/v1/orders/${order.id}`, { token: who });
    assert.deepEqual([list.status, detail.status], allowed ? [200, 200] : [403, 403], `${role}: ${list.text.slice(0, 120)}`);
    if (!allowed) assert.ok(!detail.text.includes("qa-guest@example.com"), `${role} 看到了乘客邮箱`);
  }
  for (const [role, allowed] of [["finance", true], ["readonly", true], ["dispatch", true], ["pricing", false]] as const) {
    const user = await addTenantUser(api, m.b.adminToken, `qa-${role}-${randomUUID().slice(0, 6)}@market-b.test`, role);
    const detail = await api.call("GET", `/tenant/v1/orders/${order.id}`, { token: user.token });
    assert.equal(detail.status, allowed ? 200 : 403, `${role}: ${detail.text.slice(0, 120)}`);
  }
  const sales = await salesToken();
  for (const [url, who] of [[`/tenant/v1/orders/${order.id}`, m.root], [`/platform/v1/orders/${order.id}`, m.b.adminToken], [`/tenant/v1/orders/${order.id}`, sales], [`/platform/v1/orders/${order.id}`, sales], ["/tenant/v1/orders", undefined], ["/platform/v1/orders", undefined]] as const) {
    const res = await api.call("GET", url, who === undefined ? {} : { token: who });
    assert.ok(res.status === 401 || res.status === 403, `${url} 用错的令牌得到 ${res.status}`);
    assert.ok(!res.text.includes("qa-guest@example.com"));
  }
  // 渠道令牌查订单不能用租户 / 平台令牌代替
  const wrong = await api.call("GET", `/sales/v1/orders/${order.id}`, { token: m.root });
  assert.equal(wrong.status, 401, wrong.text);
});

test("租户 A 用各种筛选、翻页都碰不到租户 B 的单；待支付的单租户筛 status=pending_payment 也看不到", async () => {
  const pending = await newOrder();
  const confirmed = await newOrder();
  await paid(confirmed.id);
  for (const query of ["", "?status=confirmed", "?status=pending_payment", "?from=2026-10-01&to=2026-12-31", `?tenant_id=${m.b.tenantId}`, "?limit=1"]) {
    const a = await api.call("GET", `/tenant/v1/orders${query}`, { token: m.a.adminToken });
    assert.ok(a.status === 200 || a.status === 400, `${query}: ${a.status}`);
    for (const id of [pending.id, confirmed.id]) assert.ok(!a.text.includes(id), `A 的列表 ${query} 里出现了 B 的单`);
  }
  const b = await api.call("GET", "/tenant/v1/orders?status=pending_payment", { token: m.b.adminToken });
  assert.deepEqual([b.status, b.body.total], [200, 0], "待支付的单租户自己也看不到");
  assert.equal((await api.call("GET", `/tenant/v1/orders/${pending.id}`, { token: m.b.adminToken })).status, 404);
});

test("数据库层面：平台角色改每日库存只能改预占和已售，改询价日志只能改「已下单」；订单的销售端一侧、状态流水只追加；订单、收款不能删", async () => {
  const order = await newOrder();
  await limitEco4("2026-10-27", "2026-10-27", 1);
  const platform = (sql: string, params: unknown[] = []) => withPlatformTx(api.db.pool, (db) => db.query(sql, params));
  const inv = [m.a.tenantId, m.ids.pa];
  await platform("update inventory_days set held = held, sold = sold, updated_at = now() where tenant_id = $1 and product_id = $2 and day = '2026-10-27'", inv);
  for (const sql of [
    "update inventory_days set total = 999 where tenant_id = $1 and product_id = $2",
    "update inventory_days set day = day + 1 where tenant_id = $1 and product_id = $2",
    "update inventory_days set product_id = product_id where tenant_id = $1 and product_id = $2",
    "update inventory_days set tenant_id = tenant_id where tenant_id = $1 and product_id = $2",
    "delete from inventory_days where tenant_id = $1 and product_id = $2",
  ]) await assert.rejects(platform(sql, inv), deniedByDatabase, sql);
  // 一行都没改到也拒绝（按语句检查）
  await assert.rejects(platform("update inventory_days set total = 1 where false"), deniedByDatabase);
  const log = (await row("select l.id from quotes q join quote_logs l on l.id = q.quote_log_id join order_sales s on s.quote_id = q.id where s.order_id = $1", [order.id])).id;
  await platform("update quote_logs set ordered = true where id = $1", [log]);
  for (const sql of ["update quote_logs set bids = '[]'::jsonb where id = $1", "update quote_logs set channel_id = channel_id where id = $1", "update quote_logs set currency = 'USD' where id = $1", "delete from quote_logs where id = $1"]) {
    await assert.rejects(platform(sql, [log]), deniedByDatabase, sql);
  }
  // 改期后对外价按原加价比例重算（M3-03，ADR 0029）：平台只能改 sell_minor 这一列，加价比例、汇率、币种、渠道等仍然不能改
  for (const sql of [
    "update order_sales set markup_bp = 0 where order_id = $1",
    "update order_sales set fx = null where order_id = $1",
    "update order_sales set currency = 'USD' where order_id = $1",
    "update order_sales set sell_minor = sell_minor, channel_id = channel_id where order_id = $1",
    "delete from order_sales where order_id = $1",
    "update order_events set to_status = 'confirmed' where order_id = $1",
    "delete from order_events where order_id = $1",
    "delete from order_payments where order_id = $1",
    "delete from orders where id = $1",
  ]) await assert.rejects(platform(sql, [order.id]), deniedByDatabase, sql);
  // 被拒绝的语句一行都没改：库里仍是原样
  const sale = await row("select sell_minor from order_sales where order_id = $1", [order.id]);
  assert.equal(Number(sale.sell_minor), Number(order.price.total.amount));
  await platform("update order_sales set sell_minor = sell_minor where order_id = $1", [order.id]);
});

// ---- 畸形入参 ----

test("下单的畸形入参：都是 4xx，不是 500，都不建单", async () => {
  const quote = await quoteFor(m.ids.biz7);
  const q = quote.quote_id;
  const before = (await row("select count(*)::int as n from orders")).n;
  const cases: [string, unknown][] = [
    ["姓名 101 字", { quote_id: q, ...details({ passenger: { name: "王".repeat(101), phone: "+81 90-1234-5678", email: "a@b.cd" } }) }],
    ["姓名 5000 字", { quote_id: q, ...details({ passenger: { name: "a".repeat(5_000), phone: "+81 90-1234-5678", email: "a@b.cd" } }) }],
    ["姓名只有空格", { quote_id: q, ...details({ passenger: { name: "   ", phone: "+81 90-1234-5678", email: "a@b.cd" } }) }],
    ["姓名带 NUL", { quote_id: q, ...details({ passenger: { name: "王\u0000明", phone: "+81 90-1234-5678", email: "a@b.cd" } }) }],
    ["备注带孤立代理字符", { quote_id: q, ...details({ notes: "a\uD800b" }) }],
    ["电话不带国家码", { quote_id: q, ...details({ passenger: { name: "王", phone: "09012345678", email: "a@b.cd" } }) }],
    ["电话有字母", { quote_id: q, ...details({ passenger: { name: "王", phone: "+81 90-ABCD-5678", email: "a@b.cd" } }) }],
    ["电话太短", { quote_id: q, ...details({ passenger: { name: "王", phone: "+8112", email: "a@b.cd" } }) }],
    ["电话 41 位", { quote_id: q, ...details({ passenger: { name: "王", phone: `+${"1".repeat(40)}`, email: "a@b.cd" } }) }],
    ["电话是数字", { quote_id: q, ...details({ passenger: { name: "王", phone: 819012345678, email: "a@b.cd" } }) }],
    ["邮箱没有 @", { quote_id: q, ...details({ passenger: { name: "王", phone: "+81 90-1234-5678", email: "guest.example.com" } }) }],
    ["航班号只有航司", { quote_id: q, ...details({ flight_no: "NH" }) }],
    ["航班号 5 位数字", { quote_id: q, ...details({ flight_no: "NH12345" }) }],
    ["航班号带中文", { quote_id: q, ...details({ flight_no: "全日空211" }) }],
    ["航班号 21 位", { quote_id: q, ...details({ flight_no: "N".repeat(21) }) }],
    ["地址 301 字", { quote_id: q, ...details({ dropoff_address: "路".repeat(301) }) }],
    ["接机一端不该填上车地址", { quote_id: q, ...details({ pickup_address: "成田" }) }],
    ["即时通讯不认识", { quote_id: q, ...details({ messaging: { app: "telegram", handle: "x" } }) }],
    ["即时通讯账号为空", { quote_id: q, ...details({ messaging: { app: "line", handle: " " } }) }],
    ["渠道订单号带空格", { quote_id: q, ...details({ channel_order_no: "WEB 1" }) }],
    ["渠道订单号带中文", { quote_id: q, ...details({ channel_order_no: "订单1" }) }],
    ["同意是字符串", { quote_id: q, ...details({ save_payment_method: "true" }) }],
    ["没有同意字段", { quote_id: q, passenger: { name: "王", phone: "+81 90-1234-5678", email: "a@b.cd" }, flight_no: "NH211", dropoff_address: "x" }],
    ["quote_id 是数字", { ...details(), quote_id: 123 }],
    ["quote_id 格式不对", { ...details(), quote_id: "QT' or 1=1 --" }],
    ["quote_id 小写", { ...details(), quote_id: q.toLowerCase() }],
    ["乘客是数组", { quote_id: q, ...details({ passenger: [] }) }],
    ["请求体是数组", [{ quote_id: q }]],
    ["多了 passengers 字段", { quote_id: q, ...details(), passengers: 0 }],
  ];
  for (const [name, body] of cases) {
    const res = await placeOrder(body);
    assert.ok(res.status >= 400 && res.status < 500, `${name}：${res.status} ${res.text.slice(0, 200)}`);
  }
  for (const key of ["short", "k".repeat(129), "键键键键键键键键", "has space here", "a/b/c/d/e/f"]) {
    const res = await placeOrder({ quote_id: q, ...details() }, key);
    assert.deepEqual([res.status, res.body.error.details.location], [400, "headers"], key);
  }
  // 请求体不是 JSON：415，和 openapi 登记的一致
  const who = await salesToken();
  const plain = await api.app.inject({ method: "POST", url: "/sales/v1/orders", headers: { authorization: `Bearer ${who}`, "content-type": "application/xml", "idempotency-key": randomUUID() }, payload: JSON.stringify({ quote_id: q, ...details() }) });
  assert.equal(plain.statusCode, 415, plain.body);
  assertMatchesOperation("POST", "/sales/v1/orders", plain.statusCode, plain.json());
  assert.equal(plain.json().error.code, "UNSUPPORTED_MEDIA_TYPE");
  assert.equal((await row("select count(*)::int as n from orders")).n, before, "一张单都没建");
  assert.equal((await placeOrder({ quote_id: q, ...details() })).status, 201, "报价还能用");
});

test("询价的人数、时间畸形 4xx；查单的编号畸形 404；运营后台的筛选畸形 400", async () => {
  const who = await salesToken();
  for (const extra of [{ passengers: 0 }, { passengers: -1 }, { passengers: 1.5 }, { passengers: "2" }, { passengers: 1_000_000 }, { luggage: -1 }, { service_time: "2026-10-20 10:00" }, { service_time: "2026-02-30T10:00:00+09:00" }, { service_time: "2026-10-20T10:00:00" }, { service_time: "2026-10-20T25:00:00+09:00" }, { service_time: 1760000000 }, { service_time: "" }]) {
    api.clock.advance(1_000);
    const res = await api.call("POST", "/sales/v1/quotes", { token: who, body: ask({ vehicle_group_ids: [m.ids.biz7], ...extra }) });
    assert.ok(res.status >= 400 && res.status < 500, `${JSON.stringify(extra)}：${res.status} ${res.text.slice(0, 200)}`);
  }
  for (const id of ["abc", "00000000-0000-0000-0000-00000000000g", "%00", "' or 1=1 --", "x".repeat(500)]) {
    api.clock.advance(1_000);
    for (const [url, tok] of [[`/sales/v1/orders/${id}`, who], [`/tenant/v1/orders/${id}`, m.b.adminToken], [`/platform/v1/orders/${id}`, m.root]] as const) {
      const res = await api.call("GET", url, { token: tok });
      assert.ok(res.status === 404 || res.status === 400 || res.status === 414, `${url}：${res.status}`);
    }
  }
  for (const query of ["status=paid", "tenant_id=abc", "channel_id=1", `q=${"x".repeat(65)}`, "cursor=%%%", "cursor=eyJ0IjoieCJ9", "limit=0", "limit=-1", "limit=abc", "q=%00"]) {
    const res = await api.call("GET", `/platform/v1/orders?${query}`, { token: m.root });
    assert.equal(res.status, 400, `${query}：${res.status} ${res.text.slice(0, 200)}`);
  }
  for (const query of ["status=paid", "from=2026-13-01", "to=yesterday", "cursor=%%%", "from=2026-02-30"]) {
    const res = await api.call("GET", `/tenant/v1/orders?${query}`, { token: m.b.adminToken });
    assert.equal(res.status, 400, `${query}：${res.status} ${res.text.slice(0, 200)}`);
  }
});

test("allKeys 自检：租户订单应答里没有付款、渠道一类的键（与 orders.itest.ts 的字段扫描同口径，用跨币种单再扫一遍）", async () => {
  const order = await newOrder(m.ids.biz7, { currency: "USD" });
  await paid(order.id);
  const detail = await api.call("GET", `/tenant/v1/orders/${order.id}`, { token: m.b.adminToken });
  assert.equal(detail.status, 200);
  assert.deepEqual([...allKeys(detail.body)].filter((key) => /sell|markup|channel|fx|quote|payment|intent|customer|refund|dispute|buffer/i.test(key)), []);
});
