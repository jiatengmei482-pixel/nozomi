/**
 * M3-03 测试角色补充：服务后加收的钱、时间、并发（ADR 0029），经真实接口、真实 PostgreSQL；收款服务用替身。
 * - 并发：异议期最后 1 毫秒客人异议与平台审核同时到；两位客服同时通过同一项；两位财务同时重试扣款失败的；两个定时任务实例同时跑到期的；
 * - 幂等：离线扣款「其实扣到了、应答超时」后自动重试不重复扣；
 * - 钱：同一张单几项加收各按「金额 × (1 + 加价比例)」四舍五入扣，合计正确；部分通过只扣通过的；供应商看不到客人付的；
 * - 时间：异议期到点那一刻（定时任务还没跑）供应商还能不能撤回。
 * 数据都在测试里构造，测试结束随 schema 一起删除（规则 1）。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { applyBasisPoints } from "@nozomi/domain";
import { PaymentProviderError } from "./integrations/payments.ts";
import { type TestApi, createTestApi } from "./testing/api.ts";
import { type Market, type Staff, addStaff, allKeys, buildMarket, ok } from "./testing/market.ts";
import { FakePaymentProvider } from "./testing/payments.ts";
import { type SalesFlow, salesFlow } from "./testing/sales-flow.ts";
import { completeOrder, platformLogin, tenantLogin, uploadReceipt } from "./testing/money.ts";

let api: TestApi;
let m: Market;
let pay: FakePaymentProvider;
let flow: SalesFlow;
let finance: Staff;
let finance2: Staff;
let support: Staff;

const HOUR = 3_600_000;
const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

before(async () => {
  pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay });
  m = await buildMarket(api);
  flow = await salesFlow(api, m, pay);
  finance = await addStaff(api, m.root, "fin@platform.test", "finance");
  finance2 = await addStaff(api, m.root, "fin2@platform.test", "finance");
  support = await addStaff(api, m.root, "cs@platform.test", "customer_service");
});
after(() => api.close());

/** 一张已完成的单（乙中标，结算价 19,800，对外价 21,780，加价 10%）。 */
async function completed(): Promise<any> {
  const order = await flow.paidOrder({ serviceTime: iso(api.clock.now().getTime() + 3 * 24 * HOUR) });
  await completeOrder(api, m, "b", order.id);
  return order;
}

async function submit(orderId: string, body: Record<string, unknown>, token: string): Promise<any> {
  return (await ok(api.call("POST", `/tenant/v1/orders/${orderId}/extra-charges`, { token, body }), 201)).extra_charge;
}

async function decide(orderId: string, chargeId: string, body: Record<string, unknown>, token: string): Promise<any> {
  return api.call("POST", `/platform/v1/orders/${orderId}/extra-charges/${chargeId}/decide`, { token, body });
}

async function platformCharges(orderId: string): Promise<any[]> {
  return (await ok(api.call("GET", `/platform/v1/orders/${orderId}`, { token: await platformLogin(api, m.staff.operations.email) }))).extra_charges;
}

/** 拨到 `until` 之前 `msBefore` 毫秒（先在 5 秒前换好渠道令牌）。 */
async function moveTo(until: number, msBefore: number): Promise<string> {
  api.clock.advance(until - msBefore - 5_000 - api.clock.now().getTime());
  const token = await flow.token();
  api.clock.advance(until - msBefore - api.clock.now().getTime());
  return token;
}

test("异议期最后 1 毫秒：客人异议和平台审核同时到——异议一定成功；审核只有在异议之后才可能通过（不会批准一项异议期内、没异议的）；被驳回 / 没批的定时任务不扣", async () => {
  const order = await completed();
  const token = await tenantLogin(api, m.b.adminEmail);
  const item = await submit(order.id, { type: "extra_stop", amount: 1_000 }, token);
  const until = Date.parse(item.dispute_until);
  const sales = await moveTo(until, 5_000);
  const ops = await platformLogin(api, m.staff.operations.email);
  api.clock.advance(until - 1 - api.clock.now().getTime());
  const [disputed, decided] = await Promise.all([
    api.call("POST", `/sales/v1/orders/${order.id}/extra-charges/${item.id}/dispute`, { token: sales, body: { reason: "没有加停靠点" } }),
    decide(order.id, item.id, { decision: "approve" }, ops),
  ]);
  assert.equal(disputed.status, 200, disputed.text);
  if (decided.status === 200) {
    // 异议先到、审核后到：审核的是「有异议的」那一项（ADR：客人异议转平台审核）
    assert.ok(decided.body.extra_charge.review_reasons.includes("DISPUTED"), decided.text);
    assert.ok(Date.parse(decided.body.extra_charge.disputed_at) <= Date.parse(decided.body.extra_charge.decided_at));
    assert.equal(pay.chargesOf(order.id).length, 1);
  } else {
    assert.deepEqual([decided.status, decided.body.error?.code], [409, "EXTRA_CHARGE_STATE_INVALID"], decided.text);
    assert.equal(disputed.body.extra_charge.status, "disputed");
    api.clock.advance(1);
    await api.app.orderJobs.money();
    assert.deepEqual([(await platformCharges(order.id))[0].status, pay.chargesOf(order.id).length], ["disputed", 0], "有异议的到点也不自动扣");
  }
});

test("两位客服同时通过同一项待审核的加收：只扣一次", async () => {
  const order = await completed();
  const item = await submit(order.id, { type: "extra_stop", amount: 2_000 }, await tenantLogin(api, m.b.adminEmail));
  api.clock.advance(48 * HOUR);
  await api.app.orderJobs.money();
  assert.equal((await platformCharges(order.id))[0].status, "review", "没有凭证：转人工");
  const [ops, cs] = [await platformLogin(api, m.staff.operations.email), await platformLogin(api, support.email)];
  const results = await Promise.all([decide(order.id, item.id, { decision: "approve" }, ops), decide(order.id, item.id, { decision: "approve", approved_amount: 1_500 }, cs)]);
  assert.equal(results.filter((res) => res.status === 200).length, 1, JSON.stringify(results.map((res) => [res.status, res.body?.error?.code])));
  const winner = results.find((res) => res.status === 200) as { body: any };
  const charges = pay.chargesOf(order.id);
  assert.equal(charges.length, 1, "只扣一次");
  assert.equal(charges[0]?.amountMinor, applyBasisPoints(Number(winner.body.extra_charge.approved_amount.amount), 1_000), "扣的是通过的那个金额 × 1.1");
  assert.equal((await platformCharges(order.id))[0].status, "charged");
});

test("缺陷复现：通过后正在扣款的那几秒里，另一位客服又审了一次（改成部分通过）——应当 409；实际被接受，记下的通过金额和实际扣的对不上", async () => {
  const order = await completed();
  const item = await submit(order.id, { type: "extra_stop", amount: 2_000 }, await tenantLogin(api, m.b.adminEmail));
  api.clock.advance(48 * HOUR);
  await api.app.orderJobs.money();
  const [ops, cs] = [await platformLogin(api, m.staff.operations.email), await platformLogin(api, support.email)];
  const original = pay.chargeSavedPaymentMethod.bind(pay);
  let second: any = null;
  pay.chargeSavedPaymentMethod = async (input) => {
    pay.chargeSavedPaymentMethod = original;
    // 第一位通过、扣款请求在路上（这一项是「正在扣」）时，第二位提交了「部分通过 1,500」
    second = await decide(order.id, item.id, { decision: "approve", approved_amount: 1_500, note: "按 1,500 算" }, cs);
    return original(input);
  };
  const first = await decide(order.id, item.id, { decision: "approve" }, ops);
  assert.equal(first.status, 200, first.text);
  const stored = (await platformCharges(order.id))[0];
  const charged = pay.chargesOf(order.id).filter((charge) => charge.status === "succeeded").map((charge) => charge.amountMinor);
  assert.deepEqual(charged, [2_200], "只扣了一次（第一位通过的 2,000 × 1.1）");
  assert.equal(applyBasisPoints(Number(stored.approved_amount.amount), 1_000), charged[0], `记下的通过金额 ${stored.approved_amount.amount} 和实际扣的 ${charged[0]} 对不上`);
  assert.deepEqual([second?.status, second?.body?.error?.code], [409, "EXTRA_CHARGE_STATE_INVALID"], `正在扣款时又审了一次：${second?.status} ${second?.body?.extra_charge?.status}`);
});

test("扣款失败后两位财务同时重试：只扣到一次（一个成功、另一个 409）", async () => {
  const order = await completed();
  const item = await submit(order.id, { type: "waiting", amount: 1_000, file_ids: [await uploadReceipt(api, await tenantLogin(api, m.b.adminEmail), order.id)] }, await tenantLogin(api, m.b.adminEmail));
  api.clock.advance(48 * HOUR);
  pay.declineNextCharge("card_declined", "insufficient_funds");
  await api.app.orderJobs.money();
  assert.equal((await platformCharges(order.id))[0].status, "charge_failed");
  const tokens = [await platformLogin(api, finance.email), await platformLogin(api, finance2.email)];
  const results = await Promise.all(tokens.map((token) => api.call("POST", `/platform/v1/orders/${order.id}/extra-charges/${item.id}/retry`, { token })));
  assert.deepEqual(results.map((res) => res.status).sort(), [200, 409], JSON.stringify(results.map((res) => res.body)));
  assert.deepEqual(pay.chargesOf(order.id).map((charge) => charge.status).sort(), ["requires_payment_method", "succeeded"], "被拒的那一笔 + 重试成功的一笔");
  assert.equal((await platformCharges(order.id))[0].status, "charged");
});

test("两个定时任务实例同时跑到期的加收：每项只扣一次", async () => {
  const order = await completed();
  const token = await tenantLogin(api, m.b.adminEmail);
  const file = await uploadReceipt(api, token, order.id);
  for (const amount of [1_000, 1_200, 1_400]) await submit(order.id, { type: "waiting", amount, file_ids: [file] }, token);
  api.clock.advance(48 * HOUR);
  await Promise.all([api.app.orderJobs.money(), api.app.orderJobs.money()]);
  const charges = pay.chargesOf(order.id);
  assert.deepEqual(charges.map((charge) => charge.amountMinor).sort((x, y) => x - y), [1_100, 1_320, 1_540]);
  assert.deepEqual((await platformCharges(order.id)).map((item) => item.status), ["charged", "charged", "charged"]);
});

test("离线扣款其实扣到了、应答超时：10 分钟后自动重试用同一条收款记录，只扣一次", async () => {
  const order = await completed();
  const token = await tenantLogin(api, m.b.adminEmail);
  await submit(order.id, { type: "waiting", amount: 3_000, file_ids: [await uploadReceipt(api, token, order.id)] }, token);
  api.clock.advance(48 * HOUR);
  const original = pay.chargeSavedPaymentMethod.bind(pay);
  pay.chargeSavedPaymentMethod = async (input) => {
    pay.chargeSavedPaymentMethod = original;
    await original(input);
    throw new PaymentProviderError("PAYMENT_PROVIDER_TIMEOUT", "替身模拟：扣到了，但应答超时");
  };
  await api.app.orderJobs.money();
  assert.equal((await platformCharges(order.id))[0].status, "approved", "当时不知道扣没扣到：等重试");
  api.clock.advance(10 * 60_000);
  await api.app.orderJobs.money();
  assert.equal((await platformCharges(order.id))[0].status, "charged");
  assert.deepEqual(pay.chargesOf(order.id).map((charge) => [charge.amountMinor, charge.status]), [[3_300, "succeeded"]], "收款服务那边只有一笔");
  const detail = await ok(api.call("GET", `/platform/v1/orders/${order.id}`, { token: await platformLogin(api, m.staff.operations.email) }));
  assert.deepEqual(detail.payments.filter((payment: any) => payment.kind === "extra_charge").map((payment: any) => [payment.status, payment.amount.amount]), [["succeeded", "3300"]]);
});

test("同一单几项加收累计：各自按金额 × 1.1 四舍五入扣（.5 往上），部分通过的按通过的；供应商只看到自己报的和通过的金额，看不到客人付的", async () => {
  const order = await completed();
  const token = await tenantLogin(api, m.b.adminEmail);
  const file = await uploadReceipt(api, token, order.id);
  // 1,005 × 1.1 = 1,105.5 → 1,106；1,234 × 1.1 = 1,357.4 → 1,357；2,345 无凭证转人工，部分通过 1,115 × 1.1 = 1,226.5 → 1,227
  const a = await submit(order.id, { type: "waiting", amount: 1_005, file_ids: [file] }, token);
  const b = await submit(order.id, { type: "extra_addon", amount: 1_234, file_ids: [file] }, token);
  const c = await submit(order.id, { type: "extra_stop", amount: 2_345 }, token);
  api.clock.advance(48 * HOUR);
  await api.app.orderJobs.money();
  const partial = await decide(order.id, c.id, { decision: "approve", approved_amount: 1_115 }, await platformLogin(api, support.email));
  assert.equal(partial.status, 200, partial.text);
  const byPayment = pay.chargesOf(order.id).map((charge) => charge.amountMinor).sort((x, y) => x - y);
  assert.deepEqual(byPayment, [1_106, 1_227, 1_357]);
  const detail = await ok(api.call("GET", `/platform/v1/orders/${order.id}`, { token: await platformLogin(api, m.staff.operations.email) }));
  const extra = detail.payments.filter((payment: any) => payment.kind === "extra_charge" && payment.status === "succeeded").reduce((sum: number, payment: any) => sum + Number(payment.amount.amount), 0);
  assert.equal(extra, 1_106 + 1_357 + 1_227);
  const sales = (await ok(api.call("GET", `/sales/v1/orders/${order.id}`, { token: await flow.token() }))).order;
  assert.deepEqual(sales.extra_charges.map((item: any) => [item.id, item.amount.amount]), [[a.id, "1106"], [b.id, "1357"], [c.id, "1227"]], "客人看到的是自己付的");
  const tenant = await ok(api.call("GET", `/tenant/v1/orders/${order.id}`, { token: await tenantLogin(api, m.b.adminEmail) }));
  const text = JSON.stringify(tenant);
  for (const customer of ["1106", "1357", "1227", "21780"]) assert.ok(!text.includes(customer), `供应商看得到客人付的 ${customer}`);
  for (const key of ["customer_amount", "markup_bp", "sell", "price", "payments"]) assert.ok(!allKeys(tenant).has(key), `供应商看得到 ${key}`);
});

test("缺陷复现：异议期到点那一刻（定时任务还没跑）供应商还能撤回——应当 409（ADR：只能撤回异议期内的）", async () => {
  const order = await completed();
  const token = await tenantLogin(api, m.b.adminEmail);
  const item = await submit(order.id, { type: "waiting", amount: 1_000, file_ids: [await uploadReceipt(api, token, order.id)] }, token);
  const until = Date.parse(item.dispute_until);
  api.clock.advance(until - 10_000 - api.clock.now().getTime());
  const fresh = await tenantLogin(api, m.b.adminEmail);
  api.clock.advance(until - api.clock.now().getTime());
  const res = await api.call("POST", `/tenant/v1/orders/${order.id}/extra-charges/${item.id}/withdraw`, { token: fresh });
  assert.deepEqual([res.status, res.body.error?.code], [409, "EXTRA_CHARGE_STATE_INVALID"], `异议期已过仍撤回成功：${res.status} ${res.body.extra_charge?.status}`);
});
