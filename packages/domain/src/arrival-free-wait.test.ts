import { test } from "node:test";
import assert from "node:assert/strict";
import { ARRIVAL_FREE_WAIT_FLOOR, arrivalFreeWaitRange, isFlightArrival, lockArrivalFreeWait, relockAllowed } from "./arrival-free-wait.ts";

const limited = (minutes: number) => ({ mode: "limited" as const, minutes });

test("按航班锁定接机免费等待（M9E-31，业主 2026-11-16）：国际一律 90、国内一律 60，不看商品设的分钟数", () => {
  assert.deepEqual(ARRIVAL_FREE_WAIT_FLOOR, { international: 90, domestic: 60 });
  for (const product of [limited(60), limited(75), limited(90), limited(120), null]) {
    assert.equal(lockArrivalFreeWait(product, "international").minutes, 90, `商品 ${JSON.stringify(product)}：国际 90`);
    assert.equal(lockArrivalFreeWait(product, "domestic").minutes, 60, `商品 ${JSON.stringify(product)}：国内 60`);
  }
});

test("航班类型未确认（Q2）：按国内线 60 锁，依据里 flightKind 为 null；商品设的只记进 base", () => {
  const locked = lockArrivalFreeWait(limited(100), null);
  assert.equal(locked.minutes, 60);
  assert.deepEqual(locked.basis, { flightKind: null, base: limited(100), floorMinutes: 60 });
});

test("商品不限时也按 90 / 60（M9E-31）；依据照记商品的「不限时」", () => {
  for (const [kind, minutes] of [["international", 90], ["domestic", 60], [null, 60]] as const) {
    const locked = lockArrivalFreeWait({ mode: "unlimited" }, kind);
    assert.equal(locked.minutes, minutes, String(kind));
    assert.deepEqual(locked.basis.base, { mode: "unlimited" });
  }
  assert.deepEqual(lockArrivalFreeWait(limited(120), "international").basis, { flightKind: "international", base: limited(120), floorMinutes: 90 });
});

test("还不知道航班类型时给客人看的两个数：固定「国际线最长 90 分钟、国内线最长 60 分钟」", () => {
  assert.deepEqual(arrivalFreeWaitRange(), { international: 90, domestic: 60 });
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
