/**
 * M3-03 测试角色补充：取消与退款的钱、时间、并发（ADR 0029），经真实接口、真实 PostgreSQL；收款服务用替身。
 * - 钱：同一张单多次改期（涨、降、再涨）后取消，客人「总付 − 总退」正好等于最终对外价 × 扣款比例，供应商得最终结算价 × 比例；
 *   改期退差价失败后客人取消、财务再重试那笔失败的退款——取消的退款已经包含了它，那一笔作废、重试被拒，不会多退；
 * - 时间：真的取消（不只是试算）落在阶梯边界上：正好 48 小时免费，差 1 毫秒扣 50%；
 * - 并发与幂等：取消与司机接到客人同时、待支付的取消与付款成功通知同时、两次「免收取消费」复核都被批准、
 *   退款和补差价「收款服务其实做成了但应答超时」后重试不重复。
 * 数据都在测试里构造，测试结束随 schema 一起删除（规则 1）。每个测试按「现在」往后挑自己的用车日期，不依赖别的测试先跑。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { applyBasisPoints, portionBasisPoints } from "@nozomi/domain";
import { PaymentProviderError } from "./integrations/payments.ts";
import { type TestApi, createTestApi } from "./testing/api.ts";
import { type Market, type Staff, addStaff, allValues, buildMarket, ok } from "./testing/market.ts";
import { FakePaymentProvider, deliverWebhook } from "./testing/payments.ts";
import { type SalesFlow, salesFlow } from "./testing/sales-flow.ts";
import { completeOrder, platformLogin, tenantLogin } from "./testing/money.ts";

let api: TestApi;
let m: Market;
let pay: FakePaymentProvider;
let flow: SalesFlow;
let finance: Staff;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** 乙的商务 7 座：结算价 19,800，加价 10% → 对外价 21,780；调价日 +20% → 结算价 23,760、对外价 26,136 */
const BASE_SETTLEMENT = 19_800;
const SURGE_SETTLEMENT = 23_760;
const BASE_SELL = applyBasisPoints(BASE_SETTLEMENT, 1_000);
const SURGE_SELL = applyBasisPoints(SURGE_SETTLEMENT, 1_000);

before(async () => {
  pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay });
  m = await buildMarket(api);
  flow = await salesFlow(api, m, pay);
  finance = await addStaff(api, m.root, "fin@platform.test", "finance");
});
after(() => api.close());

/** 东京当地日期（今天往后 `days` 天）。 */
function tokyoDay(days: number): string {
  return new Date(api.clock.now().getTime() + days * DAY + 9 * HOUR).toISOString().slice(0, 10);
}
/** 东京当地某天 10:00 的时刻。 */
const tenAm = (day: string): string => `${day}T10:00:00+09:00`;

/** 乙（或甲）的商品在这一天 +20%（每个测试自己建，不依赖别的测试）。 */
async function surge(day: string, side: "a" | "b" = "b"): Promise<void> {
  const token = await tenantLogin(api, m[side].adminEmail);
  const product = side === "b" ? m.ids.pb : m.ids.pa;
  const version = (await ok(api.call("GET", `/tenant/v1/products/${product}`, { token }))).version;
  await ok(
    api.call("POST", `/tenant/v1/products/${product}/adjust-rules`, {
      token,
      headers: { "if-match": `"${version}"`, "idempotency-key": crypto.randomUUID() },
      body: { name: `${day} +20%`, travel_from: day, travel_to: day, cycle: { type: "daily" }, steps: [{ type: "percent", value: 2_000 }] },
    }),
    201,
  );
}

async function salesGet(orderId: string): Promise<any> {
  api.clock.advance(1_000);
  return (await ok(api.call("GET", `/sales/v1/orders/${orderId}`, { token: await flow.token() }))).order;
}

async function reschedule(orderId: string, serviceTime: string): Promise<any> {
  const version = (await salesGet(orderId)).version;
  api.clock.advance(1_000);
  return api.call("PATCH", `/sales/v1/orders/${orderId}`, { token: await flow.token(), headers: { "if-match": `"${version}"` }, body: { service_time: serviceTime } });
}

async function cancel(orderId: string): Promise<any> {
  api.clock.advance(1_000);
  return api.call("POST", `/sales/v1/orders/${orderId}/cancel`, { token: await flow.token(), body: {} });
}

async function platformDetail(orderId: string): Promise<any> {
  return ok(api.call("GET", `/platform/v1/orders/${orderId}`, { token: await platformLogin(api, m.staff.operations.email) }));
}

/** 把时钟拨到「离 `serviceAt` 还有 `msBefore` 毫秒」，先在 5 秒前换好渠道令牌（换令牌会拨 1 秒）。 */
async function moveTo(serviceAt: number, msBefore: number): Promise<void> {
  const target = serviceAt - msBefore;
  assert.ok(target - 5_000 >= api.clock.now().getTime(), "时钟只能往后拨");
  api.clock.advance(target - 5_000 - api.clock.now().getTime());
  await flow.token();
  api.clock.advance(target - api.clock.now().getTime());
}

/** 客人在收款服务那边实际被扣走的钱：成功的收款合计 − 成功的退款合计。 */
function customerNet(orderId: string): { collected: number; refunded: number; net: number } {
  const collected = [pay.intentOf(orderId), ...pay.chargesOf(orderId)].filter((intent) => intent !== undefined && intent.status === "succeeded").reduce((sum, intent) => sum + (intent as { amountMinor: number }).amountMinor, 0);
  const refunded = pay.refundsOf(orderId).filter((refund) => refund.status === "succeeded").reduce((sum, refund) => sum + refund.amountMinor, 0);
  return { collected, refunded, net: collected - refunded };
}

test("改期降价的退差价失败后，客人在 50% 档取消：取消的退款包含那一笔差价、那一笔作废；财务再重试被拒（409 REFUND_SUPERSEDED），客人最终只被扣「最终对外价 × 50%」", async () => {
  const surgeDay = tokyoDay(4);
  const baseDay = tokyoDay(5);
  // 调价日甲乙都 +20%：乙 23,760 仍比甲 24,000 便宜，乙中标，客人付 26,136（只有下单这一笔收款）
  await surge(surgeDay, "b");
  await surge(surgeDay, "a");
  const order = await flow.paidOrder({ serviceTime: tenAm(surgeDay) });
  assert.equal(Number(order.price.total.amount), SURGE_SELL);
  // 改到不调价的第二天：便宜 4,356，从下单那笔退；收款服务明确拒绝（失败，等财务处理）
  pay.nextRefundIs("failed", "charge_for_pending_refund_disputed");
  const changed = await reschedule(order.id, tenAm(baseDay));
  assert.equal(changed.status, 200, changed.text);
  assert.deepEqual([changed.body.change.price_difference.kind, changed.body.order.price.total.amount], ["refund", String(BASE_SELL)]);
  const failed = (await platformDetail(order.id)).refunds.find((refund: any) => refund.purpose === "change");
  assert.equal(failed.status, "failed");
  // 离新的用车时间 30 小时取消：扣最终对外价的 50%
  const serviceAt = Date.parse(tenAm(baseDay));
  await moveTo(serviceAt, 30 * HOUR);
  const cancelled = await cancel(order.id);
  assert.equal(cancelled.status, 200, cancelled.text);
  const fee = portionBasisPoints(BASE_SELL, 5_000);
  assert.equal(cancelled.body.order.cancellation.fee.amount, String(fee));
  // 财务按「退款失败」的提示去重试那笔改期的退差价
  api.clock.advance(1_000);
  const retried = await api.call("POST", `/platform/v1/orders/${order.id}/refunds/${failed.id}/retry`, { token: await platformLogin(api, finance.email) });
  const money = customerNet(order.id);
  assert.equal(money.net, fee, `客人付了 ${money.collected}、共退 ${money.refunded}，实际只扣了 ${money.net}；应扣 ${fee}（多退了 ${fee - money.net}）；重试的应答 ${retried.status} ${retried.body?.outcome ?? retried.body?.error?.code}`);
  assert.deepEqual([retried.status, retried.body.error?.code], [409, "REFUND_SUPERSEDED"], retried.text);
  const refunds = (await platformDetail(order.id)).refunds;
  const superseded = refunds.find((refund: any) => refund.id === failed.id);
  assert.deepEqual([superseded.status, typeof superseded.superseded_at], ["failed", "string"], "失败的那一笔标为作废");
  assert.deepEqual(refunds.filter((refund: any) => refund.purpose === "cancellation").map((refund: any) => [refund.status, refund.superseded_at]), [["succeeded", null]]);
  assert.equal((await salesGet(order.id)).cancellation.refund_status, "succeeded", "渠道看到的退款状态不受作废的那一笔影响");
});

test("同一张单改期三次（涨、降、再涨）后在 50% 档取消：客人总付 − 总退 = 最终对外价 × 50%；供应商得最终结算价 × 50%；每笔退款都对着一笔收款且不超过它", async () => {
  const day1 = tokyoDay(6);
  const surgeDay = tokyoDay(7);
  const day3 = tokyoDay(8);
  await surge(surgeDay);
  const order = await flow.paidOrder({ serviceTime: tenAm(day1) });
  assert.equal(Number(order.price.total.amount), BASE_SELL);
  const diff = SURGE_SELL - BASE_SELL;
  const up = await reschedule(order.id, tenAm(surgeDay));
  assert.deepEqual([up.status, up.body.change.price_difference], [200, { kind: "charge", amount: { amount: String(diff), currency: "JPY" } }], up.text);
  const down = await reschedule(order.id, tenAm(day3));
  assert.deepEqual([down.status, down.body.change.price_difference?.kind], [200, "refund"], down.text);
  const again = await reschedule(order.id, tenAm(surgeDay));
  assert.deepEqual([again.status, again.body.change.price_difference?.kind, again.body.order.price.total.amount], [200, "charge", String(SURGE_SELL)], again.text);
  assert.equal(pay.chargesOf(order.id).filter((charge) => charge.status === "succeeded").length, 2, "补了两次差价");

  await moveTo(Date.parse(tenAm(surgeDay)), 30 * HOUR);
  const res = await cancel(order.id);
  assert.equal(res.status, 200, res.text);
  const fee = portionBasisPoints(SURGE_SELL, 5_000);
  const money = customerNet(order.id);
  assert.deepEqual([money.collected, money.net], [BASE_SELL + 2 * diff, fee], JSON.stringify(money));
  assert.equal(res.body.order.cancellation.refund.amount, String(BASE_SELL + 2 * diff - diff - fee), "这次取消退的 = 实际付了的（三笔收款 − 已退的差价）− 取消费");
  const detail = await platformDetail(order.id);
  assert.deepEqual(detail.order.cancellation.tenant_share, { amount: String(portionBasisPoints(SURGE_SETTLEMENT, 5_000)), currency: "JPY" });
  // 平台记的每笔收款「已退」不超过收到的，合计和收款服务一致
  for (const payment of detail.payments) assert.ok(Number(payment.refunded.amount) <= Number(payment.amount.amount), JSON.stringify(payment));
  const recorded = detail.refunds.filter((refund: any) => refund.status === "succeeded").reduce((sum: number, refund: any) => sum + Number(refund.amount.amount), 0);
  assert.equal(recorded, money.refunded);
  const tenant = await ok(api.call("GET", `/tenant/v1/orders/${order.id}`, { token: await tenantLogin(api, m.b.adminEmail) }));
  assert.deepEqual(tenant.order.cancellation, { fee_bp: 5_000, tenant_share: { amount: String(portionBasisPoints(SURGE_SETTLEMENT, 5_000)), currency: "JPY" } });
  assert.ok(!allValues(tenant).has(String(SURGE_SELL)), "供应商看不到对外价");
});

test("真的取消落在阶梯边界上（商务车 ≥ 48 小时免费）：正好 48 小时全额退、供应商 0；另一单差 1 毫秒扣 50%", async () => {
  const day = tokyoDay(10);
  const first = await flow.paidOrder({ serviceTime: tenAm(day) });
  const second = await flow.paidOrder({ serviceTime: `${day}T10:01:00+09:00` });
  const firstAt = Date.parse(tenAm(day));
  await moveTo(firstAt, 48 * HOUR);
  const free = await api.call("POST", `/sales/v1/orders/${first.id}/cancel`, { token: await flow.token(), body: {} });
  assert.equal(free.status, 200, free.text);
  assert.deepEqual([free.body.order.cancellation.fee_bp, free.body.order.cancellation.refund.amount], [0, String(BASE_SELL)]);
  await moveTo(firstAt + 60_000, 48 * HOUR - 1);
  const half = await api.call("POST", `/sales/v1/orders/${second.id}/cancel`, { token: await flow.token(), body: {} });
  assert.equal(half.status, 200, half.text);
  const fee = portionBasisPoints(BASE_SELL, 5_000);
  assert.deepEqual([half.body.order.cancellation.fee_bp, half.body.order.cancellation.refund.amount], [5_000, String(BASE_SELL - fee)]);
  assert.equal(customerNet(second.id).net, fee);
  const tenant = await ok(api.call("GET", `/tenant/v1/orders/${second.id}`, { token: await tenantLogin(api, m.b.adminEmail) }));
  assert.deepEqual(tenant.order.cancellation.tenant_share, { amount: String(portionBasisPoints(BASE_SETTLEMENT, 5_000)), currency: "JPY" });
});

test("取消与司机接到客人同时发生：要么取消成功、退款一次、之后不能再接到；要么接到了、取消 409、不退款——不会两边都成功", async () => {
  for (let round = 0; round < 3; round += 1) {
    const order = await flow.paidOrder({ serviceTime: `${tokyoDay(12)}T1${round}:00:00+09:00` });
    await completeOrder(api, m, "b", order.id, "assigned");
    const admin = await tenantLogin(api, m.b.adminEmail);
    for (const type of ["departed", "arrived"]) await ok(api.call("POST", `/tenant/v1/orders/${order.id}/events`, { token: admin, body: { type } }));
    api.clock.advance(1_000);
    const token = await flow.token();
    const [cancelled, picked] = await Promise.all([api.call("POST", `/sales/v1/orders/${order.id}/cancel`, { token, body: {} }), api.call("POST", `/tenant/v1/orders/${order.id}/events`, { token: admin, body: { type: "picked_up" } })]);
    const status = (await platformDetail(order.id)).order.status;
    const refunds = pay.refundsOf(order.id);
    if (cancelled.status === 200) {
      assert.notEqual(picked.status, 200, "取消成功了，接到客人就不能也成功");
      assert.deepEqual([status, refunds.length], ["cancelled", 1]);
    } else {
      assert.deepEqual([cancelled.status, cancelled.body.error.code, picked.status, status, refunds.length], [409, "ORDER_STATE_INVALID", 200, "in_service", 0]);
    }
  }
});

test("待支付的单取消与付款成功通知同时到：最后一定是已取消、全额退一次；状态流水里确认和取消各一次", async () => {
  for (let round = 0; round < 3; round += 1) {
    const order = await flow.unpaidOrder({ serviceTime: `${tokyoDay(13)}T1${round}:00:00+09:00` });
    const intent = pay.intentOf(order.id) as { id: string };
    pay.pay(intent.id);
    const raw = pay.event("payment_intent.succeeded", pay.intentObject(intent.id), { created: api.clock.now() });
    api.clock.advance(1_000);
    const token = await flow.token();
    const [cancelled, hook] = await Promise.all([api.call("POST", `/sales/v1/orders/${order.id}/cancel`, { token, body: {} }), deliverWebhook(api.app, raw, pay.sign(raw, api.clock.now()))]);
    assert.equal(cancelled.status, 200, cancelled.text);
    assert.equal(hook.status, 200, JSON.stringify(hook.body));
    const detail = await platformDetail(order.id);
    assert.equal(detail.order.status, "cancelled");
    assert.deepEqual(pay.refundsOf(order.id).map((refund) => [refund.amountMinor, refund.status]), [[BASE_SELL, "succeeded"]], "离用车很远：免费，全额退一次");
    const events = detail.events.map((event: any) => event.to_status);
    assert.deepEqual([events.filter((s: string) => s === "confirmed").length, events.filter((s: string) => s === "cancelled").length], [1, 1], JSON.stringify(events));
  }
});

test("同一张单运营两次发起「免收取消费」复核、两条都被批：只取消一次、只退一次", async () => {
  const day = tokyoDay(16);
  const order = await flow.paidOrder({ serviceTime: tenAm(day) });
  await moveTo(Date.parse(tenAm(day)), 30 * HOUR);
  const ops = await platformLogin(api, m.staff.operations.email);
  const body = { reason: "GUEST_REQUEST", waive_fee: true, note: "客人投诉，免收" };
  const requests = await Promise.all([0, 1].map(() => api.call("POST", `/platform/v1/orders/${order.id}/cancel`, { token: ops, body })));
  const ids = [...new Set(requests.filter((res) => res.status === 202).map((res) => res.body.approval.id as string))];
  assert.ok(ids.length >= 1, JSON.stringify(requests.map((res) => [res.status, res.body])));
  const fin = await platformLogin(api, finance.email);
  const results = await Promise.all(ids.map((id) => api.call("POST", `/platform/v1/approvals/${id}/approve`, { token: fin, body: {} })));
  assert.equal(results.filter((res) => res.status === 200).length, 1, JSON.stringify(results.map((res) => [res.status, res.body?.error?.code])));
  for (const res of results.filter((entry) => entry.status !== 200)) assert.equal(res.body.error.code, "APPROVAL_STALE");
  assert.deepEqual(pay.refundsOf(order.id).map((refund) => refund.amountMinor), [BASE_SELL], "免收：全额退一次");
  assert.equal((await platformDetail(order.id)).events.filter((event: any) => event.to_status === "cancelled").length, 1);
});

test("退款时收款服务其实退成了、但应答超时：定时任务用同一个幂等键再发，只退一次，平台记的已退和收款服务一致", async () => {
  const order = await flow.paidOrder({ serviceTime: tenAm(tokyoDay(20)) });
  const original = pay.refundPayment.bind(pay);
  pay.refundPayment = async (input) => {
    pay.refundPayment = original;
    await original(input);
    throw new PaymentProviderError("PAYMENT_PROVIDER_TIMEOUT", "替身模拟：退成了，但应答超时");
  };
  assert.equal((await cancel(order.id)).status, 200);
  assert.equal((await platformDetail(order.id)).refunds[0].status, "pending", "当时不知道退没退成");
  api.clock.advance(61_000);
  await api.app.orderJobs.money();
  const detail = await platformDetail(order.id);
  assert.deepEqual(detail.refunds.map((refund: any) => [refund.status, refund.amount.amount]), [["succeeded", String(BASE_SELL)]]);
  assert.equal(pay.refundsOf(order.id).length, 1, "收款服务那边只有一笔退款");
  assert.equal(detail.payments[0].refunded.amount, String(BASE_SELL));
  assert.equal(customerNet(order.id).net, 0);
});

test("改期补差价时收款服务其实扣到了、但应答超时：定时任务用同一条收款记录接着扣，只扣一次并生效", async () => {
  const day = tokyoDay(22);
  const surgeDay = tokyoDay(23);
  await surge(surgeDay);
  const order = await flow.paidOrder({ serviceTime: tenAm(day) });
  const original = pay.chargeSavedPaymentMethod.bind(pay);
  pay.chargeSavedPaymentMethod = async (input) => {
    pay.chargeSavedPaymentMethod = original;
    await original(input);
    throw new PaymentProviderError("PAYMENT_PROVIDER_TIMEOUT", "替身模拟：扣到了，但应答超时");
  };
  const res = await reschedule(order.id, tenAm(surgeDay));
  assert.deepEqual([res.status, res.body.error.code], [504, "PAYMENT_PROVIDER_TIMEOUT"]);
  api.clock.advance(3 * 60_000);
  await api.app.orderJobs.money();
  const now = await salesGet(order.id);
  assert.deepEqual([now.service_local, now.price.total.amount, now.changes.map((change: any) => change.status)], [`${surgeDay}T10:00`, String(SURGE_SELL), ["applied"]]);
  assert.deepEqual(pay.chargesOf(order.id).map((charge) => [charge.amountMinor, charge.status]), [[SURGE_SELL - BASE_SELL, "succeeded"]], "只扣了一次");
  const detail = await platformDetail(order.id);
  assert.deepEqual(detail.payments.map((payment: any) => [payment.kind, payment.status]), [["order", "succeeded"], ["change", "succeeded"]]);
});
