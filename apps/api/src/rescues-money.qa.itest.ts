/**
 * M3-04 测试角色补充：救援改派里的钱（ADR 0031），经真实接口、真实 PostgreSQL；收款服务、汇率用替身。
 * - 跨币种救援差价：客人付美元、原供应商日元、救援供应商韩元——两边各用自己报价时的快照汇率（之后汇率变了也不跟着变），只取整一次；
 * - 同一张单救援两次：第二次的「原结算价」和汇率是第一次救援记下的（救援供应商的结算价、它那次报价的汇率），违约金基数是它的结算价；
 *   两次的应扣款项各记各的供应商，客人付的钱和订单号始终不变，每个失约的供应商各记一次履约失败；
 * - 不可抗力只免最近一次救援的应扣款项，之前那次的不受影响；免除后这次救援没有「待扣」的款项；
 * - 救援中客人自己取消：客人照取消阶梯扣费，原供应商应得 0（客人扣的钱全归平台），违约金照记。
 * 测试数据在这里构造，测试结束随 schema 一起删除（规则 1）。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { CurrencyCode, FxQuote } from "@nozomi/domain";
import { type HttpMethod, type TenantFixture, type TestApi, createTestApi } from "./testing/api.ts";
import { DROPOFF, type Market, buildMarket, marketProduct, ok } from "./testing/market.ts";
import { platformLogin, tenantLogin } from "./testing/money.ts";
import { FakePaymentProvider, deliverWebhook } from "./testing/payments.ts";
import { type SalesFlow, salesFlow } from "./testing/sales-flow.ts";

const HOUR = 3_600_000;

/** 汇率替身：现在的中央汇率（测试里会改，用来证明差价用的是快照而不是现在的汇率） */
const rates = new Map<string, string>([
  ["JPY>USD", "0.0067"],
  ["KRW>USD", "0.00072"],
  ["KRW>JPY", "0.12"],
]);
const fxQuote = async (from: CurrencyCode, to: CurrencyCode, at: Date): Promise<FxQuote | null> => {
  const rate = rates.get(`${from}>${to}`);
  return rate === undefined ? null : { from, to, rate, asOf: at.toISOString() };
};

let api: TestApi;
let m: Market;
let pay: FakePaymentProvider;
let flow: SalesFlow;
let c: TenantFixture;
let d: TenantFixture;

/** 和 testing/market.ts 的 marketProduct 一样，只是品牌的结算币种可以换（这里给韩元的供应商用）。 */
async function productIn(who: TenantFixture, currency: CurrencyCode, price: number): Promise<string> {
  const call = (method: HttpMethod, path: string, body: unknown, version?: number, status = 200): Promise<any> =>
    ok(
      api.call(method, `/tenant/v1${path}`, {
        token: who.adminToken,
        body,
        headers: { ...(version === undefined ? {} : { "if-match": `"${version}"` }), ...(method === "POST" && /^\/(products|brands|areas)$|\/price-rules$/.test(path) ? { "idempotency-key": randomUUID() } : {}) },
      }),
      status,
    );
  const brand = (await call("POST", "/brands", { name: `品牌-${who.tenantId.slice(0, 4)}`, currency }, undefined, 201)).id;
  api.clock.advance(1_000);
  const area = (await call("POST", "/areas", { city_id: m.ids.tokyo, name: { zh: "东京全域" }, biz_type: "general", polygons: [{ kind: "operate", geometry: { type: "Polygon", coordinates: [[[139.0, 35.0], [140.0, 35.0], [140.0, 36.0], [139.0, 36.0], [139.0, 35.0]]] } }] }, undefined, 201)).id;
  const created = await call("POST", "/products", { brand_id: brand, city_id: m.ids.tokyo, category: "airport_transfer", poi_id: m.ids.narita, areas: [{ area_id: area }], vehicle_groups: [{ vehicle_group_id: m.ids.biz7, passengers: 6, luggage: 4 }], dispatchers: [{ name: "调度", phone: "0312345678" }] }, undefined, 201);
  const saved = await call("PUT", `/products/${created.id}/service-rules`, { booking: { service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 1 }, free_wait: { pickup: { mode: "limited", minutes: 90 }, dropoff: { mode: "limited", minutes: 15 } } }, 1);
  const version = (await call("PUT", `/products/${created.id}/content`, { zh: { title: "成田机场接送", pickup_guide: "到达大厅 3 号门" } }, saved.version)).version as number;
  await call("POST", `/products/${created.id}/price-rules`, { area_id: area, vehicle_group_id: m.ids.biz7, direction: "both", pricing_model: "fixed", valid_from: "2026-01-01", base_price: price }, version, 201);
  await call("POST", `/products/${created.id}/publish`, undefined);
  return created.id;
}

before(async () => {
  pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay, quote: { fx: { quote: fxQuote } } });
  m = await buildMarket(api);
  // 丙：商务 7 座 21,000 日元，提前 1 小时就能订；丁：韩元 200,000，提前 1 小时就能订
  c = await api.tenantWithAdmin(m.root, "丙车队", "admin@money-c.test");
  await marketProduct(api, c, m.ids, [[m.ids.biz7, 21_000]], { leadTimeHours: 1 });
  d = await api.tenantWithAdmin(m.root, "丁车队", "admin@money-d.test");
  await productIn(d, "KRW", 200_000);
  flow = await salesFlow(api, m, pay);
});
after(() => api.close());

const ops = (): Promise<string> => platformLogin(api, m.staff.operations.email);
const tenantToken = (who: TenantFixture): Promise<string> => tenantLogin(api, who.adminEmail);

/** 询价、下单、付款，客人付 `currency`：乙 19,800 日元中标。 */
async function paidOrder(hours: number, currency: CurrencyCode): Promise<{ id: string; serviceAt: number; orderNo: string }> {
  const serviceAt = Math.floor((api.clock.now().getTime() + hours * HOUR) / 60_000) * 60_000;
  const serviceTime = new Date(serviceAt).toISOString().replace(/\.\d{3}Z$/, "Z");
  api.clock.advance(1_000);
  const quoted = await ok(
    api.call("POST", "/sales/v1/quotes", {
      token: await flow.token(),
      body: { city_id: m.ids.tokyo, category: "airport_transfer", place_id: m.ids.narita, direction: "pickup", dropoff: DROPOFF, service_time: serviceTime, passengers: 2, luggage: 1, currency, vehicle_group_ids: [m.ids.biz7] },
    }),
  );
  const quote = quoted.quotes.find((entry: any) => entry.vehicle_group_id === m.ids.biz7);
  assert.ok(quote, JSON.stringify(quoted));
  api.clock.advance(1_000);
  const created = await ok(
    api.call("POST", "/sales/v1/orders", {
      token: await flow.token(),
      headers: { "idempotency-key": randomUUID() },
      body: { quote_id: quote.quote_id, passenger: { name: "王小明", phone: "+81 90-1234-5678", email: "guest@example.com" }, flight_no: "NH 211", dropoff_address: "东京站八重洲口", save_payment_method: true },
    }),
    201,
  );
  const intent = pay.intentOf(created.order.id);
  assert.ok(intent);
  pay.pay(intent.id);
  const raw = pay.event("payment_intent.succeeded", pay.intentObject(intent.id), { created: api.clock.now() });
  const res = await deliverWebhook(api.app, raw, pay.sign(raw, api.clock.now()));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return { id: created.order.id, serviceAt, orderNo: created.order.order_no };
}

function moveTo(serviceAt: number, msBefore: number): void {
  const delta = serviceAt - msBefore - api.clock.now().getTime();
  assert.ok(delta >= 0, "时钟只能往后拨");
  api.clock.advance(delta);
}

async function declare(who: TenantFixture, orderId: string): Promise<any> {
  return ok(api.call("POST", `/tenant/v1/orders/${orderId}/declare-unable`, { token: await tenantToken(who), body: { reason: "车坏了" } }));
}

async function offerAndAccept(orderId: string, who: TenantFixture): Promise<void> {
  const offered = await ok(api.call("POST", `/platform/v1/orders/${orderId}/rescue/offers`, { token: await ops(), body: { tenant_id: who.tenantId } }), 201);
  await ok(api.call("POST", `/tenant/v1/rescue-offers/${offered.offer.id}/accept`, { token: await tenantToken(who), body: {} }));
}

async function platformDetail(orderId: string): Promise<any> {
  return ok(api.call("GET", `/platform/v1/orders/${orderId}`, { token: await ops() }));
}

const deductionsOf = async (who: TenantFixture, orderId: string): Promise<[string, string, string, string][]> =>
  (await ok(api.call("GET", `/tenant/v1/deductions?order_id=${orderId}`, { token: await tenantToken(who) }))).items
    .map((entry: any) => [entry.kind, entry.amount.amount, entry.amount.currency, entry.status] as [string, string, string, string])
    .sort((x: string[], y: string[]) => (x[0] as string).localeCompare(y[0] as string));

test("跨币种 + 同一单救援两次：差价按两边各自的快照汇率、只取整一次；第二次以第一次救援的结算价和汇率为准；客人付的钱、订单号始终不变", async () => {
  rates.set("JPY>USD", "0.0067");
  rates.set("KRW>USD", "0.00072");
  const order = await paidOrder(10 * 24, "USD");
  const before = await platformDetail(order.id);
  assert.equal(before.order.tenant.id, m.b.tenantId, "乙 19,800 日元中标");
  const sell = before.order.sell;
  assert.equal(sell.currency, "USD");

  // 第一次救援：乙声明（离用车 10 天，违约金 0）；之后日元汇率变了（0.0067 → 0.0070）——差价仍按下单时的 0.0067
  await declare(m.b, order.id);
  rates.set("JPY>USD", "0.007");
  const found = await ok(api.call("GET", `/platform/v1/orders/${order.id}/rescue/candidates`, { token: await ops() }));
  const viaD = found.candidates.find((entry: any) => entry.tenant.id === d.tenantId);
  assert.ok(viaD, JSON.stringify(found));
  // 200,000 KRW × 0.00072 = 144 USD；÷ 0.0067（原快照）= 21,492.537… → 21,493 − 19,800 = 1,693 日元（用现在的 0.0070 会是 771）
  assert.deepEqual(viaD.settlement, { amount: "200000", currency: "KRW" });
  assert.deepEqual(viaD.difference, { amount: "1693", currency: "JPY" });
  await offerAndAccept(order.id, d);
  const first = await platformDetail(order.id);
  assert.equal(first.order.tenant.id, d.tenantId);
  assert.deepEqual(first.order.sell, sell, "客人付的钱不变");
  assert.equal(first.order.order_no, order.orderNo);
  assert.deepEqual(await deductionsOf(m.b, order.id), [["penalty", "0", "JPY", "pending"], ["rescue_difference", "1693", "JPY", "pending"]]);
  assert.deepEqual(await deductionsOf(d, order.id), [], "救援供应商没有应扣款项");

  // 第二次救援：丁在用车前 10 小时声明（30% × 200,000 KRW = 60,000 KRW）；韩元汇率也变了（0.00072 → 0.0006）——
  // 丁这一行的「原汇率」是它接单时那次报价的 0.00072
  moveTo(order.serviceAt, 10 * HOUR);
  rates.set("JPY>USD", "0.0075");
  rates.set("KRW>USD", "0.0006");
  const second = await declare(d, order.id);
  assert.equal(second.rescue.penalty_bp, 3000);
  assert.deepEqual(second.rescue.deductions.map((entry: any) => [entry.kind, entry.amount.amount, entry.amount.currency]), [["penalty", "60000", "KRW"]], "违约金基数是丁的结算价（韩元）");
  const again = await ok(api.call("GET", `/platform/v1/orders/${order.id}/rescue/candidates`, { token: await ops() }));
  assert.ok(!again.candidates.some((entry: any) => [m.b.tenantId, d.tenantId].includes(entry.tenant.id)), "以前接过这一单的都不是候选");
  const viaC = again.candidates.find((entry: any) => entry.tenant.id === c.tenantId);
  assert.ok(viaC, JSON.stringify(again));
  // 21,000 JPY × 0.0075（丙这次报价）= 157.5 USD；÷ 0.00072（丁那次报价的快照）= 218,750 KRW − 200,000 = 18,750 KRW（按现在的 0.0006 会是 62,500）
  assert.deepEqual(viaC.difference, { amount: "18750", currency: "KRW" });
  await offerAndAccept(order.id, c);

  const final = await platformDetail(order.id);
  assert.equal(final.order.tenant.id, c.tenantId);
  assert.deepEqual(final.order.sell, sell, "两次改派后客人付的钱仍不变");
  assert.equal(final.order.order_no, order.orderNo);
  assert.equal(final.rescues.length, 2);
  assert.deepEqual(final.rescues.map((r: any) => [r.original_tenant.id, r.rescue_tenant.id, r.original_settlement.amount, r.original_settlement.currency]), [
    [m.b.tenantId, d.tenantId, "19800", "JPY"],
    [d.tenantId, c.tenantId, "200000", "KRW"],
  ]);
  assert.deepEqual(await deductionsOf(m.b, order.id), [["penalty", "0", "JPY", "pending"], ["rescue_difference", "1693", "JPY", "pending"]], "第二次救援不碰乙的应扣款项");
  assert.deepEqual(await deductionsOf(d, order.id), [["penalty", "60000", "KRW", "pending"], ["rescue_difference", "18750", "KRW", "pending"]]);
  assert.deepEqual(await deductionsOf(c, order.id), []);
  const rows = (await api.db.owner.query<{ tenant_id: string; status: string }>("select tenant_id, status from orders where id = $1 order by created_at, updated_at", [order.id])).rows;
  assert.deepEqual(rows.map((row) => row.status).sort(), ["confirmed", "rescued", "rescued"]);
  const sale = (await api.db.owner.query<{ supplier_tenant_id: string; sell_minor: string }>("select supplier_tenant_id, sell_minor from order_sales where order_id = $1", [order.id])).rows[0];
  assert.equal(sale?.supplier_tenant_id, c.tenantId);
  const failures = (await api.db.owner.query<{ tenant_id: string }>("select tenant_id from tenant_performance_events where order_id = $1 and kind = 'failure' order by tenant_id", [order.id])).rows.map((row) => row.tenant_id);
  assert.deepEqual(failures, [m.b.tenantId, d.tenantId].sort(), "两个失约的供应商各记一次");

  // 不可抗力：只认最近一次救援（丁的），乙那次的应扣款项照旧
  const waived = await ok(api.call("POST", `/platform/v1/orders/${order.id}/rescue/force-majeure`, { token: await ops(), body: { note: "台风，机场关闭" } }));
  assert.equal(waived.waived, 2);
  assert.deepEqual((await deductionsOf(d, order.id)).map((entry) => entry[3]), ["waived", "waived"]);
  assert.deepEqual((await deductionsOf(m.b, order.id)).map((entry) => entry[3]), ["pending", "pending"]);
  const pendingOfD = (await api.db.owner.query<{ n: number }>("select count(*)::int as n from tenant_deductions where tenant_id = $1 and order_id = $2 and status = 'pending'", [d.tenantId, order.id])).rows[0]?.n;
  assert.equal(pendingOfD, 0, "免除后这次救援没有待扣的款项");
});

test("救援中客人自己取消：客人照取消阶梯扣费，原供应商应得 0（取消费全归平台），违约金照记；不能再接救援单", async () => {
  rates.set("JPY>USD", "0.0067");
  const order = await flow.paidOrder({ serviceTime: new Date(Math.floor((api.clock.now().getTime() + 30 * HOUR) / 60_000) * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z") });
  const serviceAt = new Date(order.service_time ?? (await platformDetail(order.id)).order.service_time).getTime();
  moveTo(serviceAt, 10 * HOUR);
  const declared = await declare(m.b, order.id);
  assert.equal(declared.rescue.deductions[0].amount.amount, "5940");
  const offered = await ok(api.call("POST", `/platform/v1/orders/${order.id}/rescue/offers`, { token: await ops(), body: { tenant_id: c.tenantId } }), 201);

  const preview = await ok(api.call("GET", `/sales/v1/orders/${order.id}/cancel-fee`, { token: await flow.token() }));
  const cancelled = await api.call("POST", `/sales/v1/orders/${order.id}/cancel`, { token: await flow.token(), body: { reason: "GUEST_REQUEST" } });
  assert.equal(cancelled.status, 200, cancelled.text);
  const detail = await platformDetail(order.id);
  assert.equal(detail.order.status, "cancelled");
  assert.equal(detail.order.cancellation.tenant_share.amount, "0", "原供应商没有履约，分不到取消费");
  const fee = Number(detail.order.cancellation.customer_fee?.amount ?? "0");
  const refunded = detail.refunds.reduce((sum: number, refund: any) => sum + Number(refund.amount.amount), 0);
  assert.equal(fee + refunded, Number(detail.order.sell.amount), "客人：扣的 + 退的 = 付的");
  assert.ok(fee > 0, `离用车 10 小时客人取消要扣费：${JSON.stringify(preview)}`);
  assert.equal(detail.rescues[0].status, "cancelled");
  assert.equal(detail.rescues[0].offers[0].status, "withdrawn");
  assert.deepEqual(await deductionsOf(m.b, order.id), [["penalty", "5940", "JPY", "pending"]], "违约金照记，没有差价");
  const accept = await api.call("POST", `/tenant/v1/rescue-offers/${offered.offer.id}/accept`, { token: await tenantToken(c), body: {} });
  assert.equal(accept.body.error.code, "RESCUE_OFFER_CLOSED");
  const original = await ok(api.call("GET", `/tenant/v1/orders/${order.id}`, { token: await tenantToken(m.b) }));
  assert.equal(original.order.status, "cancelled");
  const tenantShare = (await api.db.owner.query<{ cancel_tenant_share_minor: number | null }>("select cancel_tenant_share_minor from orders where id = $1 and tenant_id = $2", [order.id, m.b.tenantId])).rows[0];
  assert.equal(Number(tenantShare?.cancel_tenant_share_minor), 0);
});
