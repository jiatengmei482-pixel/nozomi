/**
 * M4-29 测试角色：改单的钱和库存（ADR 0060）。真实 PostgreSQL，收款服务用替身。
 * 不变量：收款服务那边「收到手 − 退回去」= 客人最后该付的；金额都是整数；库存只在同意时挪，拒绝、超时、取消都不留痕。
 * 用默认取消政策（商务 7 座：≥48 小时免费，24–48 小时扣 50%，<24 小时扣 100%）。
 */
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DAY, GUEST_EMAIL, GUEST_NAME, HOUR, MINUTE, SELL, SURGE_SELL, type World, buildWorld, iso, resetBetweenTests, tokyoDate } from "./testing/change-approval-qa.ts";
import { DROPOFF, ok } from "./testing/market.ts";
import { deliverWebhook } from "./testing/payments.ts";

let w: World;
let fxRate = "0.0067";
before(async () => {
  w = await buildWorld({ fx: { quote: async (from, to, at) => (from === "JPY" && to === "USD" ? { from, to, rate: fxRate, asOf: at.toISOString() } : null) } });
});
after(async () => {
  await w.close();
});
beforeEach(async () => {
  await resetBetweenTests(w);
});

const DIFF = SURGE_SELL - SELL;
const refundSum = (orderId: string): number => w.pay.refundsOf(orderId).reduce((sum, refund) => sum + refund.amountMinor, 0);

/** 派好车的单，改到调价日（要补差价）。 */
async function surcharged(): Promise<{ order: any; changeId: string; oldAt: number; newAt: number; email: string; token: string }> {
  const oldAt = w.freshDay();
  const newAt = oldAt + DAY;
  await w.surge(tokyoDate(newAt));
  const { order, email, token } = await w.dispatched(oldAt);
  const res = await w.patch(order.id, { service_time: iso(newAt) });
  assert.equal(res.status, 200, res.text);
  assert.deepEqual([res.body.change.status, res.body.change.price_difference.kind, res.body.change.price_difference.amount.amount], ["pending_confirmation", "charge", String(DIFF)]);
  return { order, changeId: res.body.change.id, oldAt, newAt, email, token };
}

/** 已经改到调价日（同意过、补过差价）的单，再改回平日（要退差价）。直接在调价日下单时中标的是甲，不是乙。 */
async function cheaper(): Promise<{ order: any; changeId: string; oldAt: number; newAt: number }> {
  const first = await surcharged();
  await ok(w.tenantDecide(first.order.id, first.changeId, "confirm"));
  const order = first.order;
  const oldAt = first.newAt;
  const newAt = first.newAt + DAY;
  assert.equal(Number((await w.salesGet(order.id)).price.total.amount), SURGE_SELL);
  const res = await w.patch(order.id, { service_time: iso(newAt) });
  assert.equal(res.status, 200, res.text);
  assert.deepEqual([res.body.change.status, res.body.change.price_difference.kind, res.body.change.price_difference.amount.amount], ["pending_confirmation", "refund", String(DIFF)]);
  return { order, changeId: res.body.change.id, oldAt, newAt };
}

test("补收方向：提出时先扣差价；同意后不退；之后全额取消（免费期内）钱全部退回，不多不少", async () => {
  const { order, changeId } = await surcharged();
  assert.equal(w.net(order.id), SURGE_SELL, "先扣差价");
  await ok(w.tenantDecide(order.id, changeId, "confirm"));
  assert.equal(refundSum(order.id), 0, "同意不退");
  const seen = await w.salesGet(order.id);
  assert.equal(Number(seen.price.total.amount), SURGE_SELL, "对外价改成新价");
  await ok(w.salesCancel(order.id));
  assert.equal(w.net(order.id), 0);
  assert.equal(refundSum(order.id), SURGE_SELL);
});

test("退款方向：确认前不退；同意才退差价且只退一次；之后再取消，退的是剩下的", async () => {
  const { order, changeId } = await cheaper();
  assert.equal(refundSum(order.id), 0, "确认前不退");
  assert.equal(Number((await w.salesGet(order.id)).price.total.amount), SURGE_SELL, "确认前对外价不变");
  await ok(w.tenantDecide(order.id, changeId, "confirm"));
  assert.deepEqual(w.pay.refundsOf(order.id).map((refund) => refund.amountMinor), [DIFF]);
  assert.equal((await w.tenantDecide(order.id, changeId, "confirm")).status, 409, "再点一次");
  assert.equal(refundSum(order.id), DIFF, "重复处理不重复退");
  assert.equal(w.net(order.id), SELL);
  assert.equal(Number((await w.salesGet(order.id)).price.total.amount), SELL);
  await ok(w.salesCancel(order.id));
  assert.equal(w.net(order.id), 0);
});

test("退款方向被拒：一分钱不动，对外价和结算价都是原来的", async () => {
  const { order, changeId } = await cheaper();
  await ok(w.tenantDecide(order.id, changeId, "reject", { note: "排不出车" }));
  assert.equal(refundSum(order.id), 0);
  const seen = await w.salesGet(order.id);
  assert.equal(Number(seen.price.total.amount), SURGE_SELL);
  const row = (await w.api.db.owner.query("select settlement_minor from orders where id = $1", [order.id])).rows[0];
  assert.equal(Number(row.settlement_minor), 23_760);
});

test("补收被拒：差价退回一次；重复拒绝 409、不重复退；再取消只退原价", async () => {
  const { order, changeId } = await surcharged();
  await ok(w.tenantDecide(order.id, changeId, "reject", { note: "排不出车" }));
  assert.deepEqual(w.pay.refundsOf(order.id).map((refund) => refund.amountMinor), [DIFF]);
  for (const decision of ["reject", "confirm", "adjusting"] as const) {
    const again = await w.tenantDecide(order.id, changeId, decision, { note: "再点" });
    assert.deepEqual([again.status, again.body.error.code], [409, "CHANGE_NOT_PENDING"], decision);
  }
  assert.equal(refundSum(order.id), DIFF);
  assert.equal(w.net(order.id), SELL);
  await ok(w.salesCancel(order.id));
  assert.equal(w.net(order.id), 0);
  assert.equal(refundSum(order.id), SURGE_SELL);
});

test("待确认时取消（免费期内）：原价和差价一次退完，申请作废，之后不能再处理", async () => {
  const { order, changeId } = await surcharged();
  await ok(w.salesCancel(order.id));
  assert.equal(w.net(order.id), 0);
  assert.equal(refundSum(order.id), SURGE_SELL);
  const late = await w.tenantDecide(order.id, changeId, "confirm");
  assert.equal(late.status, 409, late.text);
  await w.api.app.orderJobs.money();
  assert.equal(refundSum(order.id), SURGE_SELL, "定时任务不再退");
});

test("待确认时取消（已进收费档）：取消费按原价算，差价全退（不把差价算进取消费）", async () => {
  const { order, oldAt } = await surcharged();
  w.api.clock.advance(oldAt - 30 * HOUR - w.api.clock.now().getTime());
  await w.relogin();
  const fee = await ok(w.api.call("GET", `/sales/v1/orders/${order.id}/cancel-fee`, { token: await w.flow.token() }));
  assert.equal(fee.fee.amount, String(Math.round(SELL / 2)), "扣 50%（原价的）");
  await ok(w.salesCancel(order.id));
  assert.equal(w.net(order.id), Math.round(SELL / 2), "客人只被扣取消费，差价全退");
  assert.ok(w.pay.refundsOf(order.id).every((refund) => Number.isInteger(refund.amountMinor)));
});

test("拒绝时退差价失败：再取消总退款不超过实付；失败那笔被作废，财务重试不会多退", async () => {
  const { order, changeId } = await surcharged();
  w.pay.nextRefundIs("failed", "expired_or_canceled_card");
  await ok(w.tenantDecide(order.id, changeId, "reject", { note: "排不出车" }));
  const failed = (await w.api.db.owner.query("select id, status, superseded_at from order_refunds where order_id = $1", [order.id])).rows;
  assert.equal(failed.length, 1);
  assert.equal(failed[0].status, "failed");
  await ok(w.salesCancel(order.id));
  assert.equal(w.net(order.id), 0, "取消一次退完（含失败的那笔）");
  const finance = await w.api.db.owner.query("select superseded_at from order_refunds where id = $1", [failed[0].id]);
  assert.notEqual(finance.rows[0].superseded_at, null, "失败那笔已作废");
  const retried = await w.api.call("POST", `/platform/v1/orders/${order.id}/refunds/${failed[0].id}/retry`, { token: w.m.root, body: {} });
  assert.notEqual(retried.status, 200, retried.text);
  assert.equal(w.net(order.id), 0);
});

test("补收失败：402，订单不变，没有申请、待办、供应商和司机通知；再提一次成功时才扣到一笔", async () => {
  const oldAt = w.freshDay();
  const newAt = oldAt + DAY;
  await w.surge(tokyoDate(newAt));
  const { order, email } = await w.dispatched(oldAt);
  w.pay.declineNextCharge();
  const res = await w.patch(order.id, { service_time: iso(newAt) });
  assert.deepEqual([res.status, res.body.error.code], [402, "CHANGE_PAYMENT_DECLINED"]);
  assert.equal((await w.salesGet(order.id)).service_time, new Date(oldAt).toISOString());
  assert.deepEqual(await w.todosOf(order.id), [], "供应商没有要处理的");
  await w.tick();
  assert.deepEqual(await w.events(order.id, "order.%change%"), {}, "没有发出 change_pending");
  assert.equal(w.mailsTo(email).length, 0);
  assert.equal(w.net(order.id), SELL);
  const again = await w.patch(order.id, { service_time: iso(newAt) });
  assert.equal(again.body.change.status, "pending_confirmation", again.text);
  assert.equal(w.net(order.id), SURGE_SELL);
  assert.equal(w.pay.chargesOf(order.id).filter((intent) => intent.status === "succeeded").length, 1);
});

test("补收时收款服务超时：504，定时任务用同一笔重试，只扣一次，供应商只被通知一次；还没扣到时取消，不会再扣", async () => {
  const oldAt = w.freshDay();
  const newAt = oldAt + DAY;
  await w.surge(tokyoDate(newAt));
  const { order } = await w.dispatched(oldAt);
  w.pay.failNext("PAYMENT_PROVIDER_TIMEOUT");
  const res = await w.patch(order.id, { service_time: iso(newAt) });
  assert.equal(res.status, 504, res.text);
  assert.deepEqual(await w.todosOf(order.id), [], "还没扣到不通知供应商");
  w.api.clock.advance(3 * MINUTE);
  await w.api.app.orderJobs.money();
  await w.api.app.orderJobs.money();
  assert.equal(w.pay.chargesOf(order.id).length, 1);
  assert.equal(w.net(order.id), SURGE_SELL);
  await w.relogin();
  assert.deepEqual((await w.todosOf(order.id)).map((item) => item.kind), ["change_request"]);
  assert.deepEqual(await w.events(order.id, "order.change_pending"), { "order.change_pending": 1 });

  const second = await w.dispatched(w.freshDay());
  const target = second.order.service_time;
  const nextAt = Date.parse(target) + DAY;
  await w.surge(tokyoDate(nextAt));
  w.pay.failNext("PAYMENT_PROVIDER_TIMEOUT");
  assert.equal((await w.patch(second.order.id, { service_time: iso(nextAt) })).status, 504);
  await ok(w.salesCancel(second.order.id));
  w.api.clock.advance(3 * MINUTE);
  await w.api.app.orderJobs.money();
  assert.equal(w.pay.chargesOf(second.order.id).filter((intent) => intent.status === "succeeded").length, 0, "取消后不再扣");
  assert.equal(w.net(second.order.id), 0);
});

test("补收重试时才被拒：申请记为失败，供应商从头到尾没被打扰，钱不动；可以再提", async () => {
  const oldAt = w.freshDay();
  const newAt = oldAt + DAY;
  await w.surge(tokyoDate(newAt));
  const { order } = await w.dispatched(oldAt);
  w.pay.failNext("PAYMENT_PROVIDER_TIMEOUT");
  assert.equal((await w.patch(order.id, { service_time: iso(newAt) })).status, 504);
  w.pay.declineNextCharge();
  w.api.clock.advance(3 * MINUTE);
  await w.api.app.orderJobs.money();
  await w.relogin();
  const seen = await w.salesGet(order.id);
  assert.deepEqual([seen.changes[0].status, seen.service_time, w.net(order.id)], ["failed", order.service_time, SELL]);
  assert.deepEqual(await w.todosOf(order.id), []);
  assert.deepEqual(await w.events(order.id, "order.change_pending"), {});
  assert.equal((await w.patch(order.id, { service_time: iso(newAt) })).body.change.status, "pending_confirmation");
});

test("扣差价的请求在路上时客人取消：差价扣到后退回，净额 0；供应商不会收到要处理的申请", async () => {
  const oldAt = w.freshDay();
  const newAt = oldAt + DAY;
  await w.surge(tokyoDate(newAt));
  const { order } = await w.dispatched(oldAt);
  const original = w.pay.chargeSavedPaymentMethod.bind(w.pay);
  w.pay.chargeSavedPaymentMethod = async (input) => {
    w.pay.chargeSavedPaymentMethod = original;
    const result = await original(input);
    await ok(w.salesCancel(order.id));
    return result;
  };
  const res = await w.patch(order.id, { service_time: iso(newAt) });
  assert.equal(res.status, 200, res.text);
  assert.equal(w.net(order.id), 0);
  assert.equal(res.body.change.status, "cancelled");
  assert.deepEqual((await w.todosOf(order.id)).map((item) => item.kind), ["order_cancelled"]);
  assert.deepEqual(await w.events(order.id, "order.change_pending"), {});
});

test("同一个申请提交两次（并发）：只扣一笔差价，只有一条没结论的申请", async () => {
  const oldAt = w.freshDay();
  const newAt = oldAt + DAY;
  await w.surge(tokyoDate(newAt));
  const { order } = await w.dispatched(oldAt);
  const version = (await w.salesGet(order.id)).version;
  const token = await w.flow.token();
  const send = () => w.api.call("PATCH", `/sales/v1/orders/${order.id}`, { token, headers: { "if-match": `"${version}"` }, body: { service_time: iso(newAt) } });
  const results = await Promise.all([send(), send(), send()]);
  assert.deepEqual(results.map((res) => res.status).sort(), [200, 409, 409], results.map((res) => res.text).join("\n"));
  for (const res of results.filter((item) => item.status === 409)) assert.equal(res.body.error.code, "CHANGE_IN_PROGRESS");
  assert.equal(w.pay.chargesOf(order.id).length, 1);
  assert.equal(w.net(order.id), SURGE_SELL);
});

test("超时失效：差价退回一次，定时任务再跑不重复退；客人拿到的说法和订单一致", async () => {
  const { order, changeId } = await surcharged();
  const due = Date.parse((await w.salesGet(order.id)).changes[0].confirm_due_at);
  w.api.clock.advance(due - w.api.clock.now().getTime());
  await w.api.app.orderJobs.money();
  await w.api.app.orderJobs.money();
  assert.equal(refundSum(order.id), DIFF);
  const seen = await w.salesGet(order.id);
  assert.deepEqual([seen.changes[0].id, seen.changes[0].status, Number(seen.price.total.amount)], [changeId, "expired", SELL]);
});

test("跨币种：美元的单，差价按下单时的汇率快照算（改期前汇率变了也不跟）；差价、退款都是整数分；补收后取消，退回正好等于实付", async () => {
  const oldAt = w.freshDay();
  const newAt = oldAt + DAY;
  await w.surge(tokyoDate(newAt));
  const token = await w.flow.token();
  w.api.clock.advance(1_000);
  const quoted = await ok(w.api.call("POST", "/sales/v1/quotes", { token, body: { city_id: w.m.ids.tokyo, category: "airport_transfer", place_id: w.m.ids.narita, direction: "pickup", dropoff: DROPOFF, service_time: iso(oldAt), passengers: 2, luggage: 1, currency: "USD", vehicle_group_ids: [w.m.ids.biz7] } }));
  const quote = quoted.quotes[0];
  w.api.clock.advance(1_000);
  const created = await ok(w.api.call("POST", "/sales/v1/orders", { token: await w.flow.token(), headers: { "idempotency-key": randomUUID() }, body: { quote_id: quote.quote_id, passenger: { name: GUEST_NAME, phone: "+81 90-1234-5678", email: GUEST_EMAIL }, flight_no: "NH 211", dropoff_address: "东京站八重洲口", save_payment_method: true } }), 201);
  const intent = w.pay.intentOf(created.order.id);
  assert.ok(intent);
  assert.equal(intent.currency, "USD");
  w.pay.pay(intent.id);
  const raw = w.pay.event("payment_intent.succeeded", w.pay.intentObject(intent.id), { created: w.api.clock.now() });
  assert.equal((await deliverWebhook(w.api.app, raw, w.pay.sign(raw, w.api.clock.now()))).status, 200);
  fxRate = "0.0100"; // 下单之后汇率大变：改期不能按新汇率算
  const res = await w.patch(created.order.id, { service_time: iso(newAt) });
  assert.equal(res.status, 200, res.text);
  const charge = w.pay.chargesOf(created.order.id)[0];
  assert.ok(charge);
  assert.equal(charge.currency, "USD");
  assert.ok(Number.isInteger(charge.amountMinor) && charge.amountMinor > 0);
  // 19,800 / 23,760 × 0.0067 × 1.1 ≈ 差 $29：按新汇率 0.01 算会是约 $43，超过 $35 就是用错了汇率
  assert.ok(charge.amountMinor < 3_500, `差价 ${charge.amountMinor} 分：应该按快照汇率`);
  assert.equal(res.body.change.price_difference.amount.currency, "USD");
  await ok(w.tenantDecide(created.order.id, res.body.change.id, "reject", { note: "排不出车" }));
  assert.deepEqual(w.pay.refundsOf(created.order.id).map((refund) => [refund.amountMinor, refund.currency]), [[charge.amountMinor, "USD"]]);
  await ok(w.salesCancel(created.order.id));
  assert.equal(w.net(created.order.id), 0);
  for (const refund of w.pay.refundsOf(created.order.id)) assert.ok(Number.isInteger(refund.amountMinor));
  const settled = (await w.api.db.owner.query("select settlement_minor, settlement_currency from orders where id = $1", [created.order.id])).rows[0];
  assert.deepEqual([Number(settled.settlement_minor), settled.settlement_currency], [19_800, "JPY"], "结算价还是日元");
});

// ---- 库存 ----

test("库存：新日期满了不让提；不预留；拒绝和超时都不留痕；取消只还原日期", async () => {
  const oldAt = w.freshDay();
  const newAt = oldAt + DAY;
  const [oldDay, newDay] = [tokyoDate(oldAt), tokyoDate(newAt)];
  await w.limited([oldDay, newDay]);
  const { order } = await w.dispatched(oldAt);
  assert.deepEqual([await w.sold(oldDay), await w.sold(newDay)], [1, 0]);

  await w.api.db.owner.query("update inventory_days set sold = total where product_id = $1 and day = $2", [w.m.ids.pb, newDay]);
  const full = await w.patch(order.id, { service_time: iso(newAt) });
  assert.deepEqual([full.status, full.body.error.code], [409, "CHANGE_NOT_SERVICEABLE"], "新日期满了不让提");
  assert.deepEqual((await w.salesGet(order.id)).changes, []);
  await w.api.db.owner.query("update inventory_days set sold = 0 where product_id = $1 and day = $2", [w.m.ids.pb, newDay]);

  const rejected = await w.patch(order.id, { service_time: iso(newAt) });
  assert.deepEqual([await w.sold(oldDay), await w.sold(newDay)], [1, 0], "申请期间不动");
  await ok(w.tenantDecide(order.id, rejected.body.change.id, "reject", { note: "排不出车" }));
  assert.deepEqual([await w.sold(oldDay), await w.sold(newDay)], [1, 0], "拒绝不留痕");

  const expired = await w.patch(order.id, { service_time: iso(newAt) });
  w.api.clock.advance(Date.parse(expired.body.change.confirm_due_at) - w.api.clock.now().getTime());
  await w.relogin();
  await w.api.app.orderJobs.money();
  assert.deepEqual([await w.sold(oldDay), await w.sold(newDay)], [1, 0], "超时不留痕");
});

test("库存：待确认时取消，原日期释放，新日期不动；同意后再取消，释放的是新日期", async () => {
  const oldAt = w.freshDay();
  const newAt = oldAt + DAY;
  const [oldDay, newDay] = [tokyoDate(oldAt), tokyoDate(newAt)];
  await w.limited([oldDay, newDay]);
  const pending = await w.dispatched(oldAt);
  await w.patch(pending.order.id, { service_time: iso(newAt) });
  await ok(w.salesCancel(pending.order.id));
  assert.deepEqual([await w.sold(oldDay), await w.sold(newDay)], [0, 0]);

  const applied = await w.dispatched(oldAt);
  const change = (await w.patch(applied.order.id, { service_time: iso(newAt) })).body.change;
  await ok(w.tenantDecide(applied.order.id, change.id, "confirm"));
  assert.deepEqual([await w.sold(oldDay), await w.sold(newDay)], [0, 1], "同意才挪");
  await ok(w.salesCancel(applied.order.id));
  assert.deepEqual([await w.sold(oldDay), await w.sold(newDay)], [0, 0]);
});

test("库存并发：两张单同时同意改到只剩一个名额的日子，只有一张成功；不超卖；输的那张原日期不动、申请留着", async () => {
  const oldAt = w.freshDay();
  const newAt = oldAt + DAY;
  const [oldDay, newDay] = [tokyoDate(oldAt), tokyoDate(newAt)];
  await w.limited([oldDay, newDay]);
  await w.api.db.owner.query("update inventory_days set total = 1 where product_id = $1 and day = $2", [w.m.ids.pb, newDay]);
  const first = await w.dispatched(oldAt);
  const second = await w.dispatched(oldAt + 3 * HOUR);
  const firstChange = (await w.patch(first.order.id, { service_time: iso(newAt) })).body.change;
  const secondChange = (await w.patch(second.order.id, { service_time: iso(newAt + 3 * HOUR) })).body.change;
  assert.deepEqual([firstChange.status, secondChange.status], ["pending_confirmation", "pending_confirmation"], "提出时不预留，两张都能提");
  const results = await Promise.all([w.tenantDecide(first.order.id, firstChange.id, "confirm"), w.tenantDecide(second.order.id, secondChange.id, "confirm")]);
  assert.deepEqual(results.map((res) => res.status).sort(), [200, 409], results.map((res) => res.text).join("\n"));
  assert.equal(results.find((res) => res.status === 409)?.body.error.details.reason, "SOLD_OUT");
  assert.equal(await w.sold(newDay), 1, "不超卖");
  assert.equal(await w.sold(oldDay), 1, "输的那张还占着原日期");
  const loser = results[0]?.status === 409 ? first : second;
  const seen = await w.salesGet(loser.order.id);
  assert.deepEqual([seen.changes[0].status, seen.service_time], ["pending_confirmation", loser.order.service_time]);
});

test("库存并发：同意和取消同时到，不管谁赢两个日期最后都是 0（多跑几轮）", async () => {
  const oldAt = w.freshDay();
  const newAt = oldAt + DAY;
  const [oldDay, newDay] = [tokyoDate(oldAt), tokyoDate(newAt)];
  await w.limited([oldDay, newDay], 50);
  for (let round = 0; round < 5; round += 1) {
    const { order } = await w.dispatched(oldAt + round * 2 * HOUR);
    const change = (await w.patch(order.id, { service_time: iso(newAt + round * 2 * HOUR) })).body.change;
    const token = await w.flow.token();
    const calls = [w.tenantDecide(order.id, change.id, "confirm"), w.api.call("POST", `/sales/v1/orders/${order.id}/cancel`, { token, body: {} })];
    const [confirm, cancel] = await Promise.all(round % 2 === 0 ? calls : calls.reverse()).then((res) => (round % 2 === 0 ? res : res.reverse()));
    assert.equal(cancel?.status, 200, cancel?.text);
    assert.ok([200, 409].includes(confirm?.status as number), confirm?.text);
    assert.deepEqual([await w.sold(oldDay), await w.sold(newDay)], [0, 0], `第 ${round} 轮`);
    assert.equal(w.net(order.id), 0, `第 ${round} 轮：钱也退完`);
  }
});

test("库存时区：东京 23:50 改到第二天 00:10（UTC 还是同一天）算跨天要挪；同一天改钟点不挪；跨月也按当地日期", async () => {
  // 找一个未来的月末：东京这个月最后一天
  const probe = new Date(w.freshDay() + 40 * DAY);
  const monthEnd = Date.UTC(probe.getUTCFullYear(), probe.getUTCMonth() + 1, 0);
  const lateNight = monthEnd + 14 * HOUR + 50 * MINUTE; // 东京当天 23:50
  const justAfter = lateNight + 20 * MINUTE; // 东京下个月 1 号 00:10，UTC 还是月末那天
  const [oldDay, newDay] = [tokyoDate(lateNight), tokyoDate(justAfter)];
  assert.notEqual(oldDay, newDay);
  assert.equal(new Date(lateNight).toISOString().slice(0, 10), new Date(justAfter).toISOString().slice(0, 10), "UTC 是同一天");
  assert.notEqual(oldDay.slice(0, 7), newDay.slice(0, 7), "跨月");
  await w.limited([oldDay, newDay]);
  const { order } = await w.dispatched(lateNight);
  const change = (await w.patch(order.id, { service_time: iso(justAfter) })).body.change;
  await ok(w.tenantDecide(order.id, change.id, "confirm"));
  assert.deepEqual([await w.sold(oldDay), await w.sold(newDay)], [0, 1]);
  const seen = await w.salesGet(order.id);
  assert.equal(seen.service_date, newDay);

  const sameDayAt = justAfter + DAY;
  const sameDay = tokyoDate(sameDayAt);
  await w.limited([sameDay]);
  const other = await w.dispatched(sameDayAt);
  const moved = (await w.patch(other.order.id, { service_time: iso(sameDayAt + 2 * HOUR) })).body.change;
  await ok(w.tenantDecide(other.order.id, moved.id, "confirm"));
  assert.equal(await w.sold(sameDay), 1, "同一天不动库存");
});
