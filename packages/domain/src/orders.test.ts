import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ORDER_NO_PATTERN,
  ORDER_PAYMENT_RULES,
  ORDER_STATUSES,
  PAYMENT_INTENT_STATUSES,
  type OrderDetailsInput,
  type OrderStatus,
  type OrderTripShape,
  isFlightNo,
  isInternationalPhone,
  normalizeFlightNo,
  onPaymentSucceeded,
  orderDetailsIssues,
  orderNumber,
  orderStatusIsFinal,
  orderTransitionAllowed,
  orderVisibleToTenant,
  paymentDeadline,
  paymentMatchesOrder,
  paymentOverdue,
  paymentStatusOf,
} from "./orders.ts";

test("状态机：付款成功自动确认、待支付可以取消；没有「待确认」「已拒绝」（租户不能拒单）", () => {
  assert.equal(orderTransitionAllowed("pending_payment", "confirmed"), true);
  assert.equal(orderTransitionAllowed("pending_payment", "cancelled"), true);
  assert.equal(orderTransitionAllowed("pending_payment", "assigned"), false, "不付款不能派车");
  assert.equal(orderTransitionAllowed("pending_payment", "completed"), false);
  assert.ok(!(ORDER_STATUSES as readonly string[]).includes("rejected"));
});

test("状态机：服务开始前可以取消，开始后不能；完成、取消是终态；救援改派只从已确认 / 已派车进入", () => {
  const allowed = (from: OrderStatus): OrderStatus[] => ORDER_STATUSES.filter((to) => orderTransitionAllowed(from, to));
  assert.deepEqual(allowed("confirmed"), ["assigned", "cancelled", "rescue_pending"]);
  assert.deepEqual(allowed("assigned"), ["in_service", "cancelled", "rescue_pending"]);
  assert.deepEqual(allowed("in_service"), ["completed"]);
  assert.deepEqual(allowed("rescue_pending"), ["confirmed", "assigned", "cancelled"]);
  assert.deepEqual(ORDER_STATUSES.filter(orderStatusIsFinal), ["completed", "cancelled"]);
  for (const status of ORDER_STATUSES) assert.equal(orderTransitionAllowed(status, status), false, `${status} 不能转到自己`);
  for (const from of ORDER_STATUSES) assert.equal(orderTransitionAllowed(from, "pending_payment"), false, "不能回到待支付");
});

test("租户只看得到付过款的单", () => {
  assert.equal(orderVisibleToTenant(null), false);
  assert.equal(orderVisibleToTenant(new Date()), true);
  assert.equal(orderVisibleToTenant("2026-10-07T01:00:00Z"), true);
});

test("付款期限：下单后 30 分钟；到点的那一刻起就算超时", () => {
  const created = new Date("2026-10-07T01:00:00.000Z");
  const due = paymentDeadline(created);
  assert.equal(ORDER_PAYMENT_RULES.paymentTimeoutMinutes, 30);
  assert.equal(due.toISOString(), "2026-10-07T01:30:00.000Z");
  assert.equal(paymentOverdue(due, new Date(due.getTime() - 1)), false);
  assert.equal(paymentOverdue(due, due), true);
  assert.equal(paymentOverdue(due, new Date(due.getTime() + 60_000)), true);
});

test("PaymentIntent 的状态 → 平台的付款状态（3DS 验证中也算等客人付款）", () => {
  const mapped = Object.fromEntries(PAYMENT_INTENT_STATUSES.map((status) => [status, paymentStatusOf(status)]));
  assert.deepEqual(mapped, {
    requires_payment_method: "requires_payment",
    requires_confirmation: "requires_payment",
    requires_action: "requires_payment",
    processing: "processing",
    requires_capture: "processing",
    canceled: "canceled",
    succeeded: "succeeded",
  });
});

test("付款和订单对账：金额、币种都对上才确认（币种不分大小写）", () => {
  assert.equal(paymentMatchesOrder({ minor: 21_978, currency: "JPY" }, { minor: 21_978, currency: "jpy" }), true);
  assert.equal(paymentMatchesOrder({ minor: 21_978, currency: "JPY" }, { minor: 21_977, currency: "JPY" }), false);
  assert.equal(paymentMatchesOrder({ minor: 21_978, currency: "JPY" }, { minor: 21_978, currency: "USD" }), false);
});

test("付款成功的通知：待支付的确认；已确认的不动；已取消的不复活，记成钱到了单却取消了", () => {
  assert.equal(onPaymentSucceeded("pending_payment"), "confirm");
  assert.equal(onPaymentSucceeded("confirmed"), "already");
  assert.equal(onPaymentSucceeded("assigned"), "already");
  assert.equal(onPaymentSucceeded("cancelled"), "paid_after_cancel");
});

test("订单号：NZ + UTC 日期 + 8 位随机（不含 I、O）", () => {
  const no = orderNumber(new Date("2026-10-07T23:59:59Z"), "K3M9Q2XA");
  assert.equal(no, "NZ20261007K3M9Q2XA");
  assert.match(no, ORDER_NO_PATTERN);
  assert.throws(() => orderNumber(new Date(), "K3M9Q2XI"), RangeError);
  assert.throws(() => orderNumber(new Date(), "K3M9Q2X"), RangeError);
  assert.doesNotMatch("NZ20261007K3M9Q2XO", ORDER_NO_PATTERN);
});

test("电话要国际格式；航班号去空格转大写后核对", () => {
  assert.equal(isInternationalPhone("+81 90-1234-5678"), true);
  assert.equal(isInternationalPhone("+86 (138) 0013 8000"), true);
  assert.equal(isInternationalPhone("090-1234-5678"), false, "没有国家码");
  assert.equal(isInternationalPhone("+0 1234567890"), false);
  assert.equal(isInternationalPhone("+8112345"), false, "太短");
  assert.equal(normalizeFlightNo(" nh 211 "), "NH211");
  for (const ok of ["NH211", "mu5101", "7C1101", "JL 5", "UAL123A"]) assert.equal(isFlightNo(ok), true, ok);
  for (const bad of ["N", "NH", "NH21111", "NH-211", "航班"]) assert.equal(isFlightNo(bad), false, bad);
});

const airportPickup: OrderTripShape = { category: "airport_transfer", direction: "pickup", placeType: "airport", hasPickupPoint: false, hasDropoffPoint: true };
const good: OrderDetailsInput = {
  passenger: { name: "王小明", phone: "+81 90-1234-5678", email: "guest@example.com" },
  flightNo: "NH211",
  pickupAddress: null,
  dropoffAddress: "东京站八重洲口",
  messaging: { app: "line", handle: "xiaoming" },
  notes: null,
  channelOrderNo: "WEB-0001",
  savePaymentMethodConsent: true,
};
const paths = (input: OrderDetailsInput, trip: OrderTripShape = airportPickup): string[] => orderDetailsIssues(input, trip).map((issue) => `${issue.path}:${issue.reason}`);

test("下单信息：接机要航班号、市区一端要地址；机场那一端不填地址", () => {
  assert.deepEqual(paths(good), []);
  assert.deepEqual(paths({ ...good, flightNo: null }), ["/flight_no:REQUIRED"]);
  assert.deepEqual(paths({ ...good, flightNo: "NH-211" }), ["/flight_no:INVALID_FLIGHT_NO"]);
  assert.deepEqual(paths({ ...good, dropoffAddress: "  " }), ["/dropoff_address:REQUIRED"]);
  assert.deepEqual(paths({ ...good, pickupAddress: "成田 1 号航站楼" }), ["/pickup_address:NOT_APPLICABLE"]);
  assert.deepEqual(paths({ ...good, dropoffAddress: "地".repeat(301) }), ["/dropoff_address:TOO_LONG"]);
});

test("下单信息：送机的航班号可填可不填；接站、点对点、包车不填航班号", () => {
  const airportDropoff: OrderTripShape = { ...airportPickup, direction: "dropoff", hasPickupPoint: true, hasDropoffPoint: false };
  assert.deepEqual(paths({ ...good, flightNo: null, pickupAddress: "酒店", dropoffAddress: null }, airportDropoff), []);
  assert.deepEqual(paths({ ...good, pickupAddress: "酒店", dropoffAddress: null }, airportDropoff), []);
  const station: OrderTripShape = { ...airportPickup, placeType: "station" };
  assert.deepEqual(paths(good, station), ["/flight_no:NOT_APPLICABLE"]);
  assert.deepEqual(paths({ ...good, flightNo: null }, station), []);
  const p2p: OrderTripShape = { category: "point_to_point", direction: null, placeType: null, hasPickupPoint: true, hasDropoffPoint: true };
  assert.deepEqual(paths({ ...good, flightNo: null, pickupAddress: "酒店" }, p2p), []);
  assert.deepEqual(paths({ ...good, flightNo: null, pickupAddress: null }, p2p), ["/pickup_address:REQUIRED"]);
  const charter: OrderTripShape = { category: "charter", direction: null, placeType: null, hasPickupPoint: true, hasDropoffPoint: false };
  assert.deepEqual(paths({ ...good, flightNo: null, pickupAddress: "酒店", dropoffAddress: null }, charter), []);
});

test("下单信息：乘客姓名、国际格式的电话、邮箱必填；必须同意保存支付方式；其余选填但有长度和格式", () => {
  assert.deepEqual(paths({ ...good, passenger: { name: "", phone: "", email: "" } }), ["/passenger/name:REQUIRED", "/passenger/phone:REQUIRED", "/passenger/email:REQUIRED"]);
  assert.deepEqual(paths({ ...good, passenger: { ...good.passenger, phone: "090-1234-5678", email: "no-at-sign" } }), ["/passenger/phone:INVALID_PHONE", "/passenger/email:INVALID_FORMAT"]);
  assert.deepEqual(paths({ ...good, passenger: { ...good.passenger, name: "名".repeat(101) } }), ["/passenger/name:TOO_LONG"]);
  assert.deepEqual(paths({ ...good, savePaymentMethodConsent: false }), ["/save_payment_method:CONSENT_REQUIRED"]);
  assert.deepEqual(paths({ ...good, messaging: { app: "wechat", handle: " " } }), ["/messaging/handle:REQUIRED"]);
  assert.deepEqual(paths({ ...good, messaging: null, notes: "注".repeat(501) }), ["/notes:TOO_LONG"]);
  assert.deepEqual(paths({ ...good, channelOrderNo: "有中文" }), ["/channel_order_no:INVALID_FORMAT"]);
  assert.deepEqual(paths({ ...good, channelOrderNo: "x".repeat(65) }), ["/channel_order_no:TOO_LONG"]);
});
