import { test } from "node:test";
import assert from "node:assert/strict";
import { ARRIVAL_FREE_WAIT_FLOOR, arrivalFreeWaitRange, isFlightArrival, lockArrivalFreeWait, relockAllowed } from "./arrival-free-wait.ts";

const limited = (minutes: number) => ({ mode: "limited" as const, minutes });

test("按航班锁定接机免费等待（M9E-28，ADR 0097）：国际 max(商品, 90)、国内 max(商品, 60)", () => {
  assert.deepEqual(ARRIVAL_FREE_WAIT_FLOOR, { international: 90, domestic: 60 });
  assert.equal(lockArrivalFreeWait(limited(60), "international").minutes, 90, "商品 60、国际航班补到 90");
  assert.equal(lockArrivalFreeWait(limited(60), "domestic").minutes, 60);
  assert.equal(lockArrivalFreeWait(limited(120), "international").minutes, 120, "商品设得更长按商品");
  assert.equal(lockArrivalFreeWait(limited(75), "domestic").minutes, 75);
  assert.equal(lockArrivalFreeWait(limited(90), "international").minutes, 90, "正好等于下限");
  assert.equal(lockArrivalFreeWait(null, "international").minutes, 90, "商品没设按下限");
  assert.equal(lockArrivalFreeWait(null, "domestic").minutes, 60);
});

test("航班类型未确认（Q2）：按 max(商品, 60) 锁，依据里 flightKind 为 null、下限 60", () => {
  const locked = lockArrivalFreeWait(limited(45), null);
  assert.equal(locked.minutes, 60);
  assert.deepEqual(locked.basis, { flightKind: null, base: limited(45), floorMinutes: 60 });
  assert.equal(lockArrivalFreeWait(limited(100), null).minutes, 100);
});

test("商品不限时：不管什么航班都不限时（不压低）；依据照记", () => {
  for (const kind of ["international", "domestic", null] as const) {
    const locked = lockArrivalFreeWait({ mode: "unlimited" }, kind);
    assert.equal(locked.minutes, null, String(kind));
    assert.deepEqual(locked.basis.base, { mode: "unlimited" });
  }
  assert.deepEqual(lockArrivalFreeWait(limited(60), "international").basis, { flightKind: "international", base: limited(60), floorMinutes: 90 });
});

test("还不知道航班类型时给客人看的两个数（「国际线最长 X 分钟、国内线最长 Y 分钟」）", () => {
  assert.deepEqual(arrivalFreeWaitRange(limited(60)), { international: 90, domestic: 60 });
  assert.deepEqual(arrivalFreeWaitRange(limited(75)), { international: 90, domestic: 75 });
  assert.deepEqual(arrivalFreeWaitRange(limited(120)), { international: 120, domestic: 120 });
  assert.deepEqual(arrivalFreeWaitRange(null), { international: 90, domestic: 60 });
  assert.equal(arrivalFreeWaitRange({ mode: "unlimited" }), null);
});

test("哪些单按航班定：机场接机；带航班号的点对点（Q5）；接站、送机、包车、没航班号的点对点不算", () => {
  assert.equal(isFlightArrival({ category: "airport_transfer", direction: "pickup", placeType: "airport", flightNo: "NH211" }), true);
  assert.equal(isFlightArrival({ category: "airport_transfer", direction: "pickup", placeType: "airport", flightNo: null }), true, "渠道没给航班号也是接机（按未确认锁）");
  assert.equal(isFlightArrival({ category: "airport_transfer", direction: "pickup", placeType: "station", flightNo: null }), false, "接站");
  assert.equal(isFlightArrival({ category: "airport_transfer", direction: "dropoff", placeType: "airport", flightNo: "NH211" }), false, "送机");
  assert.equal(isFlightArrival({ category: "point_to_point", direction: null, placeType: null, flightNo: "NH211" }), true);
  assert.equal(isFlightArrival({ category: "point_to_point", direction: null, placeType: null, flightNo: " " }), false);
  assert.equal(isFlightArrival({ category: "point_to_point", direction: null, placeType: null, flightNo: null }), false);
  assert.equal(isFlightArrival({ category: "charter", direction: null, placeType: null, flightNo: "NH211" }), false);
});

test("下单后改航班能不能重新锁定（Q3）：派单前（待付款、已确认且没派司机）能，派单后不能", () => {
  assert.equal(relockAllowed({ status: "confirmed", driverId: null }), true);
  assert.equal(relockAllowed({ status: "pending_payment", driverId: null }), true);
  assert.equal(relockAllowed({ status: "confirmed", driverId: "d1" }), false, "已确认但已经派了司机");
  for (const status of ["assigned", "departed", "arrived", "in_service", "completed", "cancelled"]) assert.equal(relockAllowed({ status, driverId: null }), false, status);
});
