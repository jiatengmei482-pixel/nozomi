import { test } from "node:test";
import assert from "node:assert/strict";
import { changeFreeWaitPreview, dispatchedFreeWaitNote, productFreeWait } from "./free-wait-display.ts";
import { orderFreeWaitDetail } from "./dispatch-display.ts";

const pickup = {
  status: "confirmed",
  category: "airport_transfer" as const,
  direction: "pickup" as const,
  flight_no: "NH211",
  flight_kind: null,
  free_wait_minutes: 60,
  free_wait_basis: { flight_kind: null, base: { mode: "limited" as const, minutes: 60 }, floor_minutes: 60 },
  dispatch: { driver: null },
};

test("供应商审批改单的提示（2026-11-15 按推荐，审查建议 1）：派单前按同意时重新锁定写「60 → 90 分钟」；不变写不变；已派车写不变；不改航班的为 null", () => {
  assert.equal(changeFreeWaitPreview(pickup, { flight_kind: "international" }), "同意后免费等待 60 → 90 分钟");
  assert.equal(changeFreeWaitPreview(pickup, { flight_kind: "domestic" }), "同意后免费等待不变（60 分钟）");
  assert.equal(changeFreeWaitPreview({ ...pickup, dispatch: { driver: { name: "佐藤" } } }, { flight_kind: "international" }), "已派车：同意后免费等待不变（60 分钟）");
  assert.equal(changeFreeWaitPreview({ ...pickup, status: "assigned" }, { flight_kind: "international" }), "已派车：同意后免费等待不变（60 分钟）");
  assert.equal(changeFreeWaitPreview(pickup, { notes: "x" }), null);
  assert.equal(changeFreeWaitPreview({ ...pickup, direction: "dropoff", free_wait_basis: null, free_wait_minutes: 15 }, { flight_no: "JL5" }), null, "送机不按航班定");
  // 以前的单没有依据（审查建议 2）：派单前改航班照新规则锁定，商品值取这一单的分钟数
  assert.equal(changeFreeWaitPreview({ ...pickup, free_wait_basis: null }, { flight_kind: "international" }), "同意后免费等待 60 → 90 分钟");
  // 点对点接机清掉航班号（审查建议 3）：回到商品的值
  const p2p = { ...pickup, category: "point_to_point" as const, direction: null, flight_no: "JL5", flight_kind: "international" as const, free_wait_minutes: 90, free_wait_basis: { flight_kind: "international" as const, base: { mode: "limited" as const, minutes: 30 }, floor_minutes: 90 } };
  assert.equal(changeFreeWaitPreview(p2p, { flight_no: null, flight_kind: null }), "同意后免费等待 90 → 30 分钟");
  assert.equal(changeFreeWaitPreview({ ...pickup, free_wait_basis: { ...pickup.free_wait_basis, base: { mode: "unlimited" } }, free_wait_minutes: null }, { flight_kind: "international" }), "同意后免费等待不变（不限时）");
});

test("商品自己设的免费等待：有依据取依据里的；以前的单取订单的分钟数（null = 不限时）", () => {
  assert.deepEqual(productFreeWait(pickup), { mode: "limited", minutes: 60 });
  assert.deepEqual(productFreeWait({ free_wait_minutes: 45, free_wait_basis: null }), { mode: "limited", minutes: 45 });
  assert.deepEqual(productFreeWait({ free_wait_minutes: null, free_wait_basis: null }), { mode: "unlimited" });
});

test("客人订单页派单后的说明（审查建议 6）：按派单时的航班类型锁定 N 分钟；没派单、没按航班锁定、不限时的为 null", () => {
  assert.equal(dispatchedFreeWaitNote({ free_wait_minutes: 90, free_wait_basis: { flight_kind: "international", base: null, floor_minutes: 90 }, dispatched: true }), "按派单时的国际航班锁定 90 分钟");
  assert.equal(dispatchedFreeWaitNote({ free_wait_minutes: 60, free_wait_basis: { flight_kind: null, base: null, floor_minutes: 60 }, dispatched: true }), "按派单时航班类型未确认（按国内线）锁定 60 分钟");
  assert.equal(dispatchedFreeWaitNote({ free_wait_minutes: 90, free_wait_basis: { flight_kind: "international", base: null, floor_minutes: 90 }, dispatched: false }), null);
  assert.equal(dispatchedFreeWaitNote({ free_wait_minutes: 90, free_wait_basis: null, dispatched: true }), null);
});

test("供应商看到的依据（审查建议 7）：商品没设免费等待写「商品没设」", () => {
  assert.equal(orderFreeWaitDetail(90, { flight_kind: "international", base: null, floor_minutes: 90 }), "90 分钟（国际航班；商品没设，按平台规定补到 90 分钟）");
  assert.equal(orderFreeWaitDetail(90, { flight_kind: "international", base: { mode: "limited", minutes: 60 }, floor_minutes: 90 }), "90 分钟（国际航班；商品设 60 分钟，按平台规定补到 90 分钟）");
});
