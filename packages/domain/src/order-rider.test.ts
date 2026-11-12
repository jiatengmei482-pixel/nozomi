/**
 * 乘车人和举牌姓名（M8-32，ADR 0082）的纯函数：下单校验、存进乘客对象的写法、接口里的 `rider`、打码、脱敏和明文占位。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { type OrderDetailsInput, type OrderTripShape, orderDetailsIssues, orderRiderOf } from "./orders.ts";
import { ENCRYPTED_PASSENGER, containsPassenger, contactOnly, maskOrderValues, replacePassengers, riderJson, scrubOrderValues } from "./privacy.ts";

const trip: OrderTripShape = { category: "airport_transfer", direction: "pickup", placeType: "airport", hasPickupPoint: false, hasDropoffPoint: true };
const base: OrderDetailsInput = {
  passenger: { name: "王小明", phone: "+86 138 0000 0000", email: "booker@example.com" },
  flightNo: "NH211",
  pickupAddress: null,
  dropoffAddress: "京王广场酒店",
  messaging: null,
  notes: null,
  channelOrderNo: null,
  savePaymentMethodConsent: true,
};
const issuesOf = (rider: OrderDetailsInput["rider"]) => orderDetailsIssues({ ...base, ...(rider === undefined ? {} : { rider }) }, trip).map((issue) => [issue.path, issue.reason]);

test("下单校验：三项都选填；乘车人姓名和电话要么都给、要么都不给；电话要国际格式；过长报 TOO_LONG；不给（渠道下单）没有任何新规则", () => {
  assert.deepEqual(issuesOf(undefined), []);
  assert.deepEqual(issuesOf({ signName: null, name: null, phone: null }), []);
  assert.deepEqual(issuesOf({ signName: "WANG XIAOMING", name: "李华", phone: "+81 90-5555-6666" }), []);
  assert.deepEqual(issuesOf({ signName: null, name: "李华", phone: null }), [["/passenger_phone", "REQUIRED"]]);
  assert.deepEqual(issuesOf({ signName: null, name: "  ", phone: "+81 90-5555-6666" }), [["/passenger_name", "REQUIRED"]]);
  assert.deepEqual(issuesOf({ signName: null, name: "李华", phone: "090-5555-6666" }), [["/passenger_phone", "INVALID_PHONE"]]);
  assert.deepEqual(issuesOf({ signName: "长".repeat(101), name: "长".repeat(101), phone: "+81 90-5555-6666" }), [["/sign_name", "TOO_LONG"], ["/passenger_name", "TOO_LONG"]]);
});

test("存进乘客对象的写法：去首尾空白、电话规范化；三项都空或没给时为 null（不存这个键，旧订单原样）", () => {
  assert.deepEqual(orderRiderOf({ signName: " WANG ", name: " 李华 ", phone: " +81 90-5555-6666 " }), { signName: "WANG", name: "李华", phone: "+819055556666" });
  assert.deepEqual(orderRiderOf({ signName: "WANG", name: null, phone: null }), { signName: "WANG", name: null, phone: null });
  assert.equal(orderRiderOf({ signName: " ", name: null, phone: "" }), null);
  assert.equal(orderRiderOf(undefined), null);
});

test("接口里的 rider 和 passenger：联系人只有三项，乘车人单独一项；没有乘车人为 null", () => {
  const passenger = { name: "王小明", phone: "+8613800000000", email: "booker@example.com", rider: { signName: "LI HUA", name: "李华", phone: "+819055556666" } };
  assert.deepEqual(contactOnly(passenger), { name: "王小明", phone: "+8613800000000", email: "booker@example.com" });
  assert.deepEqual(riderJson(passenger), { sign_name: "LI HUA", name: "李华", phone: "+819055556666" });
  assert.equal(riderJson({ name: "王小明", phone: "+8613800000000", email: "booker@example.com" }), null);
  assert.equal(riderJson({ ...passenger, rider: { signName: null, name: null, phone: null } }), null);
});

test("运营后台打码：rider 的姓名、举牌姓名同姓名规则，电话同电话规则；备注里出现的乘车人姓名也打码", () => {
  const masked = maskOrderValues({ passenger: { name: "王小明", phone: "+8613800000000", email: "booker@example.com" }, rider: { sign_name: "LI HUA", name: "李华", phone: "+819055556666" }, notes: "请联系李华" });
  assert.notEqual(masked.rider.name, "李华");
  assert.notEqual(masked.rider.sign_name, "LI HUA");
  assert.notEqual(masked.rider.phone, "+819055556666");
  assert.ok(!masked.notes.includes("李华"), masked.notes);
  assert.deepEqual(maskOrderValues({ rider: { sign_name: "LI HUA", name: null, phone: null } }).rider.name, null, "没有的项保持 null");
});

test("脱敏：rider 整个变成 null；明文占位（不写明文时）rider 也换成 null，内容只在密文里；有 rider 的内容算含乘客", () => {
  const values = { passenger: { name: "王小明", phone: "+8613800000000", email: "booker@example.com" }, rider: { sign_name: "LI HUA", name: "李华", phone: "+819055556666" } };
  assert.equal(scrubOrderValues(values, ["王小明", "李华"]).rider, null);
  const replaced = replacePassengers(values, ENCRYPTED_PASSENGER);
  assert.deepEqual([replaced.passenger, replaced.rider], [ENCRYPTED_PASSENGER, null]);
  assert.equal(containsPassenger(values), true);
});
