/**
 * M3-03：改单（ADR 0029），经真实接口、真实 PostgreSQL；收款服务用替身。
 * - 改信息直接生效（If-Match、状态流水、推 order.changed、供应商看到改前改后）；
 * - 改期：同一家供应商按新时间重新报价，对外价按原加价比例；贵了先用保存的支付方式补差价（被拒 402 不改、收款服务出错由定时任务接着扣），便宜了退差价；
 * - 用车前 24 小时内的改期要供应商 30 分钟内确认；拒绝 / 超时：补收的差价退回、客人可以免费取消；
 * - 出了免费取消期只能改航班号和乘客信息；超出容量、报不出价按取消重下；司机出发后不能改时间；
 * - 并发改单只有一个成功；取消订单时没结论的改单作废；运营代改写审计；跨租户、渠道隔离。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CANCELLATION_POLICY, applyBasisPoints } from "@nozomi/domain";
import { type TestApi, createTestApi } from "./testing/api.ts";
import { type Market, type Staff, SERVICE_TIME, addStaff, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";
import { FakePaymentProvider } from "./testing/payments.ts";
import { type SalesFlow, salesFlow } from "./testing/sales-flow.ts";
import { assign, newDriver, newVehicle, startFakeReceiver, type FakeReceiver } from "./testing/dispatch.ts";
import { platformLogin, tenantLogin } from "./testing/money.ts";

let api: TestApi;
let m: Market;
let pay: FakePaymentProvider;
let flow: SalesFlow;
let ops2: Staff;
let receiver: FakeReceiver;
let otherChannel: { clientId: string; secret: string };

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** 东京当地的日期（调价规则的出行日期按它） */
const tokyoDate = (ms: number): string => new Date(ms + 9 * HOUR).toISOString().slice(0, 10);
const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

before(async () => {
  pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay });
  m = await buildMarket(api);
  flow = await salesFlow(api, m, pay);
  ops2 = await addStaff(api, m.root, "ops2@platform.test", "operations");
  receiver = await startFakeReceiver();
  await ok(api.call("PUT", "/tenant/v1/webhooks", { token: m.b.adminToken, body: { url: receiver.url, events: ["order.changed", "order.cancelled"] } }), 201);
  otherChannel = await salesCredentials(api, m, (await newChannel(api, m.staff.cm1.token, { name: "别的渠道" })).id);
  // 乙的商务 7 座：2026-10-22 那一天 +20%（19,800 → 23,760）
  const version = (await ok(api.call("GET", `/tenant/v1/products/${m.ids.pb}`, { token: m.b.adminToken }))).version;
  await ok(api.call("POST", `/tenant/v1/products/${m.ids.pb}/adjust-rules`, { token: m.b.adminToken, headers: { "if-match": `"${version}"`, "idempotency-key": crypto.randomUUID() }, body: { name: "10/22 +20%", travel_from: "2026-10-22", travel_to: "2026-10-22", cycle: { type: "daily" }, steps: [{ type: "percent", value: 2_000 }] } }), 201);
  // 接送机 · 经济：任何时候取消都免费（给「24 小时内改期要确认」的测试用：原来的用车时间进了 24 小时也还在免费取消期里）
  const ops = m.staff.operations.token;
  const rules = DEFAULT_CANCELLATION_POLICY.map((rule) => ({ category: rule.category, level: rule.level, tiers: rule.category === "airport_transfer" && rule.level === "economy" ? [{ min_hours_before: 0, fee_bp: 0 }] : rule.tiers.map((tier) => ({ min_hours_before: tier.minHoursBefore, fee_bp: tier.feeBp })) }));
  const requested = await ok(api.call("POST", "/platform/v1/cancellation-policy/changes", { token: ops, body: { rules } }), 202);
  await ok(api.call("POST", `/platform/v1/approvals/${requested.approval.id}/approve`, { token: ops2.token, body: {} }));
});
after(async () => {
  await receiver.close();
  await api.close();
});

/** 渠道接口每秒最多 10 次：每次调用前把时钟拨过一秒。 */
async function salesGet(orderId: string): Promise<any> {
  api.clock.advance(1_000);
  return (await ok(api.call("GET", `/sales/v1/orders/${orderId}`, { token: await flow.token() }))).order;
}

async function patch(orderId: string, body: Record<string, unknown>, version?: number, token?: string): Promise<any> {
  const v = version ?? (await salesGet(orderId)).version;
  api.clock.advance(1_000);
  return api.call("PATCH", `/sales/v1/orders/${orderId}`, { token: token ?? (await flow.token()), headers: { "if-match": `"${v}"` }, body });
}

async function tenantDetail(side: "a" | "b", orderId: string): Promise<any> {
  return ok(api.call("GET", `/tenant/v1/orders/${orderId}`, { token: await tenantLogin(api, m[side].adminEmail) }));
}

test("改信息（航班号、乘客、备注、下车点地址）：直接生效、推 order.changed、供应商看到改前改后；If-Match 必填、版本对不上 409；没有变化 422；写法不对 400", async () => {
  const order = await flow.paidOrder();
  assert.equal((await api.call("PATCH", `/sales/v1/orders/${order.id}`, { token: await flow.token(), body: { notes: "x" } })).status, 428);
  assert.equal((await patch(order.id, { notes: "x" }, order.version + 5)).body.error.code, "VERSION_CONFLICT");
  const res = await patch(order.id, { flight_no: "jl 5", passenger: { name: "王大明", phone: "+81 80-0000-1111", email: "big@example.com" }, notes: "带婴儿车", dropoff_address: "东京站丸之内北口" });
  assertMatchesOpenApi("PATCH", "/sales/v1/orders/{id}", res);
  assert.equal(res.status, 200, res.text);
  assert.deepEqual([res.body.change.status, res.body.change.fields.sort(), res.body.change.price_difference], ["applied", ["dropoff_address", "flight_no", "notes", "passenger"], null]);
  assert.deepEqual([res.body.order.flight_no, res.body.order.passenger.phone, res.body.order.dropoff.address, res.body.order.notes], ["JL5", "+818000001111", "东京站丸之内北口", "带婴儿车"]);
  const tenant = await tenantDetail("b", order.id);
  assert.equal(tenant.changes.length, 1);
  assert.deepEqual([tenant.changes[0].before.flight_no, tenant.changes[0].after.flight_no, tenant.changes[0].settlement_before.amount, tenant.changes[0].settlement_after.amount], ["NH211", "JL5", "19800", "19800"]);
  assert.deepEqual(tenant.events.at(-1).reason, "CHANGED");
  const queued = await api.db.owner.query("select event_data from webhook_deliveries where order_id = $1 and event_type = 'order.changed'", [order.id]);
  assert.deepEqual([queued.rows.length, queued.rows[0].event_data.status, queued.rows[0].event_data.after.flight_no], [1, "applied", "JL5"]);
  assert.equal((await patch(order.id, { flight_no: "JL5" })).body.error.code, "NO_CHANGE");
  const bad = await patch(order.id, { passenger: { name: "x", phone: "090-1234", email: "nope" }, pickup_address: "成田" });
  assert.deepEqual([bad.status, bad.body.error.details.issues.map((issue: any) => issue.path).sort()], [400, ["/passenger/email", "/passenger/phone", "/pickup_address"]]);
  assert.equal((await patch(order.id, { vehicle_group_id: m.ids.eco4 })).status, 400, "车型不能改：取消重下");
  const other = (await ok(api.call("POST", "/sales/v1/oauth/token", { ip: "198.51.100.11", body: { grant_type: "client_credentials", client_id: otherChannel.clientId, client_secret: otherChannel.secret } }))).access_token;
  assert.equal((await patch(order.id, { notes: "y" }, undefined, other)).status, 404, "别的渠道的单当作不存在");
});

test("改期涨价：先用保存的支付方式补差价（对外价按原加价比例），再生效；派车截止时间按新时间；改回来降价退差价（从补收的那一笔退）", async () => {
  const order = await flow.paidOrder();
  const sellBefore = Number(order.price.total.amount);
  assert.equal(sellBefore, applyBasisPoints(19_800, 1_000), "默认加价 10%");
  const res = await patch(order.id, { service_time: "2026-10-22T10:00:00+09:00" });
  assert.equal(res.status, 200, res.text);
  const sellAfter = applyBasisPoints(23_760, 1_000);
  assert.deepEqual([res.body.change.status, res.body.change.price_difference], ["applied", { kind: "charge", amount: { amount: String(sellAfter - sellBefore), currency: "JPY" } }]);
  assert.deepEqual([res.body.order.service_local, res.body.order.price.total.amount], ["2026-10-22T10:00", String(sellAfter)]);
  const charges = pay.chargesOf(order.id);
  assert.deepEqual(charges.map((charge) => [charge.amountMinor, charge.status, charge.charge?.purpose]), [[sellAfter - sellBefore, "succeeded", "change"]]);
  const tenant = await tenantDetail("b", order.id);
  assert.deepEqual([tenant.order.settlement.total.amount, tenant.order.service_date, tenant.order.dispatch.due_at], ["23760", "2026-10-22", "2026-10-21T01:00:00.000Z"]);
  assert.ok(!JSON.stringify(tenant).includes(String(sellAfter)), "供应商看不到新的对外价");
  const detail = await ok(api.call("GET", `/platform/v1/orders/${order.id}`, { token: await platformLogin(api, m.staff.operations.email) }));
  assert.deepEqual(detail.payments.map((payment: any) => [payment.kind, payment.status, payment.amount.amount]), [["order", "succeeded", String(sellBefore)], ["change", "succeeded", String(sellAfter - sellBefore)]]);
  assert.deepEqual([detail.changes[0].sell_before.amount, detail.changes[0].sell_after.amount], [String(sellBefore), String(sellAfter)]);

  const back = await patch(order.id, { service_time: SERVICE_TIME });
  assert.deepEqual([back.status, back.body.change.price_difference.kind, back.body.order.price.total.amount], [200, "refund", String(sellBefore)]);
  const refunds = pay.refundsOf(order.id);
  assert.deepEqual(refunds.map((refund) => [refund.amountMinor, refund.intentId]), [[sellAfter - sellBefore, charges[0]?.id]]);
});

test("补差价被拒（卡被拒）：402、不改，改单记为没扣到；之后可以再改", async () => {
  const order = await flow.paidOrder();
  pay.declineNextCharge("card_declined", "insufficient_funds");
  const res = await patch(order.id, { service_time: "2026-10-22T10:00:00+09:00" });
  assert.deepEqual([res.status, res.body.error.code, res.body.error.details.decline_code], [402, "CHANGE_PAYMENT_DECLINED", "insufficient_funds"]);
  const now = await salesGet(order.id);
  assert.deepEqual([now.service_local, now.price.total.amount, now.changes.map((change: any) => change.status)], ["2026-10-20T10:00", order.price.total.amount, ["failed"]]);
  assert.equal((await patch(order.id, { notes: "再改一次" })).status, 200);
});

test("补差价时收款服务出错：504，改单留在「补差价」，别的改单 409；定时任务过 2 分钟用同一条收款记录接着扣（不会扣两次）并生效", async () => {
  const order = await flow.paidOrder();
  pay.failNext("PAYMENT_PROVIDER_TIMEOUT");
  const res = await patch(order.id, { service_time: "2026-10-22T10:00:00+09:00" });
  assert.deepEqual([res.status, res.body.error.code, res.body.error.details.retryable], [504, "PAYMENT_PROVIDER_TIMEOUT", true]);
  assert.equal((await patch(order.id, { notes: "另一个改动" })).body.error.code, "CHANGE_IN_PROGRESS");
  assert.equal((await api.app.orderJobs.money()).changes.resumed, 0, "还不到 2 分钟");
  api.clock.advance(3 * 60_000);
  assert.equal((await api.app.orderJobs.money()).changes.resumed, 1);
  const after = await salesGet(order.id);
  assert.deepEqual([after.service_local, after.changes.map((change: any) => change.status)], ["2026-10-22T10:00", ["applied"]]);
  assert.equal(pay.chargesOf(order.id).length, 1, "同一个幂等键：只扣了一次");
  assert.equal(pay.calls.filter((call) => call.startsWith("charge:")).length >= 2, true, "确实重试过");
});

test("补差价扣款的同时客人取消了订单：改单作废，扣到的差价和订单的钱都退回", async () => {
  const order = await flow.paidOrder();
  const original = pay.chargeSavedPaymentMethod.bind(pay);
  pay.chargeSavedPaymentMethod = async (input) => {
    const result = await original(input);
    pay.chargeSavedPaymentMethod = original;
    // 扣款请求在路上的时候客人取消了（取消时这笔差价还没扣到）
    await ok(api.call("POST", `/sales/v1/orders/${order.id}/cancel`, { token: await flow.token(), body: {} }));
    return result;
  };
  const res = await patch(order.id, { service_time: "2026-10-22T10:00:00+09:00" });
  assert.equal(res.status, 200, res.text);
  assert.deepEqual([res.body.order.status, res.body.change.status, res.body.order.service_local], ["cancelled", "cancelled", "2026-10-20T10:00"]);
  const diff = Number(pay.chargesOf(order.id)[0]?.amountMinor);
  assert.ok(diff > 0);
  assert.deepEqual(pay.refundsOf(order.id).map((refund) => refund.amountMinor).sort((x, y) => x - y), [diff, Number(order.price.total.amount)].sort((x, y) => x - y), "下单付的全额（离用车还远）和补收的差价都退了");
});

test("并发改单：同一个版本同时来两次，只有一个成功", async () => {
  const order = await flow.paidOrder();
  const version = (await salesGet(order.id)).version;
  const results = await Promise.all(["A1", "B2"].map((flight) => patch(order.id, { flight_no: `NH${flight.slice(1)}` }, version)));
  assert.deepEqual(results.map((res) => res.status).sort(), [200, 409]);
  const conflict = results.find((res) => res.status === 409);
  assert.ok(["VERSION_CONFLICT", "CHANGE_IN_PROGRESS"].includes(conflict?.body.error.code));
  assert.equal((await salesGet(order.id)).changes.length, 1);
});

test("报不出价（新时间在提前预订时长之内）按取消重下：409 CHANGE_NOT_SERVICEABLE；超出车型容量 422 CHANGE_REQUIRES_REBOOK；人数在容量内直接改", async () => {
  const order = await flow.paidOrder();
  const soon = await patch(order.id, { service_time: iso(api.clock.now().getTime() + 2 * HOUR) });
  assert.deepEqual([soon.status, soon.body.error.code, soon.body.error.details.reason], [409, "CHANGE_NOT_SERVICEABLE", "LEAD_TIME_TOO_SHORT"]);
  api.clock.advance(1_000);
  const crowd = await patch(order.id, { passengers: 7 });
  assert.deepEqual([crowd.status, crowd.body.error.code], [422, "CHANGE_REQUIRES_REBOOK"]);
  const fine = await patch(order.id, { passengers: 6, luggage: 4 });
  assert.deepEqual([fine.status, fine.body.order.passengers, fine.body.order.luggage], [200, 6, 4]);
});

test("运营代客人改单：同样的规则，写审计", async () => {
  const order = await flow.paidOrder();
  const ops = await platformLogin(api, m.staff.operations.email);
  const version = (await salesGet(order.id)).version;
  assert.equal((await api.call("PATCH", `/platform/v1/orders/${order.id}`, { token: await platformLogin(api, m.staff.readonly.email), headers: { "if-match": `"${version}"` }, body: { notes: "x" } })).status, 403);
  const res = await api.call("PATCH", `/platform/v1/orders/${order.id}`, { token: ops, headers: { "if-match": `"${version}"` }, body: { notes: "客人来电：多一件行李", luggage: 2 } });
  assertMatchesOpenApi("PATCH", "/platform/v1/orders/{id}", res);
  assert.deepEqual([res.status, res.body.change.status, res.body.change.requested_by], [200, "applied", "platform_user"]);
  const audit = await api.db.owner.query("select actor_email, before, after from audit_logs where resource = 'order_change' and action = 'change' and after->>'order_id' = $1", [order.id]);
  assert.deepEqual(audit.rows.map((row) => [row.actor_email, row.before.luggage, row.after.luggage]), [[m.staff.operations.email, 1, 2]]);
});

test("出了免费取消期只能改航班号和乘客信息；司机出发后不能改时间和人数", async () => {
  const order = await flow.paidOrder({ serviceTime: iso(api.clock.now().getTime() + 4 * DAY) });
  const departed = await flow.paidOrder({ serviceTime: iso(api.clock.now().getTime() + 4 * DAY + HOUR) });
  const who = { ...m.b, adminToken: await tenantLogin(api, m.b.adminEmail) };
  await ok(assign(api, who, departed.id, (await newDriver(api, who)).id, (await newVehicle(api, who, m.ids.biz7)).id));
  api.clock.advance(new Date(order.service_time).getTime() - 30 * HOUR - api.clock.now().getTime());
  await ok(api.call("POST", `/tenant/v1/orders/${departed.id}/events`, { token: await tenantLogin(api, m.b.adminEmail), body: { type: "departed" } }));
  const locked = await patch(order.id, { notes: "x", flight_no: "NH1" });
  assert.deepEqual([locked.status, locked.body.error.code, locked.body.error.details.fields], [409, "CHANGE_NOT_ALLOWED", ["notes"]]);
  assert.equal((await patch(order.id, { flight_no: "NH1", messaging: { app: "whatsapp", handle: "+819000000000" } })).status, 200, "航班号、乘客信息照样能改");
  const moving = await patch(departed.id, { luggage: 2 });
  assert.deepEqual([moving.status, moving.body.error.code], [409, "ORDER_STATE_INVALID"]);
});

test("24 小时内的改期要供应商 30 分钟内确认：等确认时订单不变；别的供应商确认不了；确认后生效", async () => {
  const order = await flow.paidOrder({ vehicleGroupId: m.ids.eco4, serviceTime: iso(api.clock.now().getTime() + 3 * DAY) });
  const serviceAt = new Date(order.service_time).getTime();
  api.clock.advance(serviceAt - 22 * HOUR - api.clock.now().getTime());
  const res = await patch(order.id, { service_time: iso(serviceAt + 2 * DAY) });
  const requestedAt = api.clock.now().getTime();
  assert.equal(res.status, 200, res.text);
  assert.deepEqual([res.body.change.status, res.body.change.confirm_due_at, res.body.order.service_time], ["pending_confirmation", new Date(requestedAt + 30 * 60_000).toISOString(), order.service_time]);
  const tenant = await tenantDetail("a", order.id);
  const change = tenant.changes[0];
  assert.deepEqual([change.status, change.after.service_time], ["pending_confirmation", new Date(serviceAt + 2 * DAY).toISOString()]);
  assert.equal((await api.call("POST", `/tenant/v1/orders/${order.id}/changes/${change.id}/confirm`, { token: await tenantLogin(api, m.b.adminEmail), body: {} })).status, 404, "别的供应商的单当作不存在");
  const confirmed = await api.call("POST", `/tenant/v1/orders/${order.id}/changes/${change.id}/confirm`, { token: await tenantLogin(api, m.a.adminEmail), body: { note: "排得出车" } });
  assertMatchesOpenApi("POST", "/tenant/v1/orders/{id}/changes/{changeId}/confirm", confirmed);
  assert.deepEqual([confirmed.status, confirmed.body.change.status, confirmed.body.change.decision_note], [200, "applied", "排得出车"]);
  assert.equal((await salesGet(order.id)).service_time, new Date(serviceAt + 2 * DAY).toISOString());
  assert.equal((await api.call("POST", `/tenant/v1/orders/${order.id}/changes/${change.id}/reject`, { token: await tenantLogin(api, m.a.adminEmail), body: {} })).body.error.code, "CHANGE_NOT_PENDING");
});

test("要确认的改期贵了：先补差价再等确认；供应商拒绝 → 补收的差价退回，客人可以按「改期没确认」免费取消；30 分钟没确认 → 同样", async () => {
  const order = await flow.paidOrder({ vehicleGroupId: m.ids.eco4, serviceTime: iso(api.clock.now().getTime() + 6 * DAY) });
  const serviceAt = new Date(order.service_time).getTime();
  // 后面两张也先下好（时钟拨到用车前 22 小时之后，提前预订时长就不够了）
  const second = await flow.paidOrder({ vehicleGroupId: m.ids.eco4, serviceTime: iso(serviceAt + HOUR) });
  const third = await flow.paidOrder({ vehicleGroupId: m.ids.eco4, serviceTime: iso(serviceAt + 2 * HOUR) });
  const target = serviceAt + 2 * DAY;
  // 甲的经济 4 座：新的那一天 +20%（12,000 → 14,400）
  const version = (await ok(api.call("GET", `/tenant/v1/products/${m.ids.pa}`, { token: await tenantLogin(api, m.a.adminEmail) }))).version;
  await ok(api.call("POST", `/tenant/v1/products/${m.ids.pa}/adjust-rules`, { token: await tenantLogin(api, m.a.adminEmail), headers: { "if-match": `"${version}"`, "idempotency-key": crypto.randomUUID() }, body: { name: "改期测试", travel_from: tokyoDate(target), travel_to: tokyoDate(target), cycle: { type: "daily" }, vehicle_group_ids: [m.ids.eco4], steps: [{ type: "percent", value: 2_000 }] } }), 201);
  api.clock.advance(serviceAt - 22 * HOUR - api.clock.now().getTime());
  const res = await patch(order.id, { service_time: iso(target) });
  const diff = applyBasisPoints(14_400, 1_000) - applyBasisPoints(12_000, 1_000);
  assert.deepEqual([res.status, res.body.change.status, res.body.change.price_difference.amount.amount], [200, "pending_confirmation", String(diff)]);
  assert.equal(pay.chargesOf(order.id).length, 1, "先把差价扣到");
  const changeId = res.body.change.id;
  const rejected = await api.call("POST", `/tenant/v1/orders/${order.id}/changes/${changeId}/reject`, { token: await tenantLogin(api, m.a.adminEmail), body: { note: "那天车都派出去了" } });
  assert.deepEqual([rejected.status, rejected.body.change.status], [200, "rejected"]);
  assert.deepEqual(pay.refundsOf(order.id).map((refund) => refund.amountMinor), [diff], "差价退回");
  const now = await salesGet(order.id);
  assert.deepEqual([now.free_cancel_available, now.service_time, now.price.total.amount], [true, order.service_time, order.price.total.amount]);
  const fee = await ok(api.call("GET", `/sales/v1/orders/${order.id}/cancel-fee?reason=CHANGE_NOT_CONFIRMED`, { token: await flow.token() }));
  assert.deepEqual([fee.fee_bp, fee.refund.amount], [0, order.price.total.amount]);
  const cancelled = await ok(api.call("POST", `/sales/v1/orders/${order.id}/cancel`, { token: await flow.token(), body: { reason: "CHANGE_NOT_CONFIRMED" } }));
  assert.deepEqual([cancelled.order.cancellation.reason, cancelled.order.cancellation.refund.amount], ["CHANGE_NOT_CONFIRMED", order.price.total.amount]);

  // 30 分钟没确认：定时任务记为超时，差价退回
  const pending = await patch(second.id, { service_time: iso(target + HOUR) });
  assert.equal(pending.body.change.status, "pending_confirmation");
  api.clock.advance(30 * 60_000);
  const late = await api.call("POST", `/tenant/v1/orders/${second.id}/changes/${pending.body.change.id}/confirm`, { token: await tenantLogin(api, m.a.adminEmail), body: {} });
  assert.deepEqual([late.status, late.body.error.code], [409, "CHANGE_CONFIRMATION_EXPIRED"]);
  assert.equal((await salesGet(second.id)).changes[0].status, "expired");
  assert.equal(pay.refundsOf(second.id).length, 1);

  await ok(patch(third.id, { service_time: iso(target + 2 * HOUR) }));
  api.clock.advance(30 * 60_000);
  assert.equal((await api.app.orderJobs.money()).changes.expired, 1);
  assert.deepEqual([(await salesGet(third.id)).free_cancel_available, pay.refundsOf(third.id).length], [true, 1]);
});

test("取消订单时没结论的改单作废，补收的差价跟着全额退款一起退", async () => {
  // 用车日期和新日期都避开前面测试的调价日
  const order = await flow.paidOrder({ vehicleGroupId: m.ids.eco4, serviceTime: iso(api.clock.now().getTime() + 12 * DAY) });
  const serviceAt = new Date(order.service_time).getTime();
  const target = serviceAt + 2 * DAY;
  const version = (await ok(api.call("GET", `/tenant/v1/products/${m.ids.pa}`, { token: await tenantLogin(api, m.a.adminEmail) }))).version;
  await ok(api.call("POST", `/tenant/v1/products/${m.ids.pa}/adjust-rules`, { token: await tenantLogin(api, m.a.adminEmail), headers: { "if-match": `"${version}"`, "idempotency-key": crypto.randomUUID() }, body: { name: "改期测试 2", travel_from: tokyoDate(target), travel_to: tokyoDate(target), cycle: { type: "daily" }, vehicle_group_ids: [m.ids.eco4], steps: [{ type: "percent", value: 2_000 }] } }), 201);
  api.clock.advance(serviceAt - 22 * HOUR - api.clock.now().getTime());
  const pending = await ok(patch(order.id, { service_time: iso(target) }));
  const diff = Number(pending.change.price_difference.amount.amount);
  const cancelled = await ok(api.call("POST", `/sales/v1/orders/${order.id}/cancel`, { token: await flow.token(), body: {} }));
  assert.equal(cancelled.order.changes[0].status, "cancelled");
  assert.equal(cancelled.order.cancellation.refund.amount, String(Number(order.price.total.amount) + diff), "经济车这一单任何时候取消都免费：下单付的 + 补收的差价都退");
  assert.deepEqual(pay.refundsOf(order.id).map((refund) => refund.amountMinor).sort((a, b) => a - b), [diff, Number(order.price.total.amount)].sort((a, b) => a - b));
  assert.equal((await patch(order.id, { notes: "x" })).body.error.code, "ORDER_STATE_INVALID");
});
