import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type OrderChangeCheck,
  changeConfirmDeadline,
  changeConfirmOverdue,
  freeCancelAfterUnconfirmedChange,
  orderChangeOpen,
  orderChangeRefusal,
  orderChangeTransitionAllowed,
  priceDifference,
  rescheduleNeedsConfirmation,
} from "./order-changes.ts";

const now = new Date("2026-10-25T00:00:00.000Z");
const HOUR = 3_600_000;
const check = (extra: Partial<OrderChangeCheck>): OrderChangeCheck => ({ status: "confirmed", fields: ["flight_no"], inFreeWindow: true, passengers: 2, luggage: 1, capacity: { passengers: 6, luggage: 4 }, newServiceAt: null, now, ...extra });

test("没有变化不算改单", () => {
  assert.deepEqual(orderChangeRefusal(check({ fields: [] })), { reason: "NO_CHANGE" });
});

test("状态：乘客信息、备注、地址到接到客人之前都能改；时间、人数、行李只在司机出发之前", () => {
  for (const status of ["confirmed", "assigned", "departed", "arrived"] as const) assert.equal(orderChangeRefusal(check({ status, fields: ["passenger", "notes"] })), null, status);
  for (const status of ["pending_payment", "in_service", "completed", "cancelled", "no_show", "no_show_claimed", "rescue_pending"] as const) assert.equal(orderChangeRefusal(check({ status }))?.reason, "ORDER_STATE_INVALID", status);
  assert.equal(orderChangeRefusal(check({ status: "assigned", fields: ["service_time"], newServiceAt: new Date(now.getTime() + 72 * HOUR) })), null);
  assert.deepEqual(orderChangeRefusal(check({ status: "departed", fields: ["service_time", "notes"], newServiceAt: new Date(now.getTime() + 72 * HOUR) })), { reason: "ORDER_STATE_INVALID", fields: ["service_time"] });
  assert.deepEqual(orderChangeRefusal(check({ status: "arrived", fields: ["passengers"] })), { reason: "ORDER_STATE_INVALID", fields: ["passengers"] });
});

test("出了免费取消期只能改航班号和乘客信息（含即时通讯）；备注、地址、时间、人数都不行", () => {
  assert.equal(orderChangeRefusal(check({ inFreeWindow: false, fields: ["flight_no", "passenger", "messaging"] })), null);
  assert.deepEqual(orderChangeRefusal(check({ inFreeWindow: false, fields: ["passenger", "notes", "pickup_address"] })), { reason: "OUTSIDE_FREE_WINDOW", fields: ["notes", "pickup_address"] });
  assert.deepEqual(orderChangeRefusal(check({ inFreeWindow: false, fields: ["service_time"], newServiceAt: new Date(now.getTime() + 2 * HOUR) })), { reason: "OUTSIDE_FREE_WINDOW", fields: ["service_time"] });
});

test("人数、行李超出车型容量按取消重下；正好等于容量可以", () => {
  assert.equal(orderChangeRefusal(check({ fields: ["passengers", "luggage"], passengers: 6, luggage: 4 })), null);
  assert.deepEqual(orderChangeRefusal(check({ fields: ["passengers"], passengers: 7 })), { reason: "CAPACITY_EXCEEDED", fields: ["passengers"] });
  assert.deepEqual(orderChangeRefusal(check({ fields: ["luggage"], luggage: 5 })), { reason: "CAPACITY_EXCEEDED", fields: ["luggage"] });
});

test("新的用车时间不能是现在或过去", () => {
  assert.deepEqual(orderChangeRefusal(check({ fields: ["service_time"], newServiceAt: now })), { reason: "SERVICE_TIME_PASSED", fields: ["service_time"] });
  assert.equal(orderChangeRefusal(check({ fields: ["service_time"], newServiceAt: new Date(now.getTime() + 1) })), null);
});

test("改期要供应商确认：原来的或新的用车时间离现在不到 24 小时（正好 24 小时不用）", () => {
  const far = new Date(now.getTime() + 72 * HOUR);
  assert.equal(rescheduleNeedsConfirmation(far, new Date(now.getTime() + 24 * HOUR), now), false);
  assert.equal(rescheduleNeedsConfirmation(far, new Date(now.getTime() + 24 * HOUR - 1), now), true, "改到明天：供应商未必排得出车");
  assert.equal(rescheduleNeedsConfirmation(new Date(now.getTime() + 24 * HOUR - 1), far, now), true, "原来的用车时间已经进了 24 小时");
  assert.equal(rescheduleNeedsConfirmation(far, new Date(now.getTime() + 96 * HOUR), now), false);
});

test("供应商 30 分钟内确认：到点那一刻起算超时", () => {
  const due = changeConfirmDeadline(now);
  assert.equal(due.toISOString(), "2026-10-25T00:30:00.000Z");
  assert.equal(changeConfirmOverdue(due, new Date(due.getTime() - 1)), false);
  assert.equal(changeConfirmOverdue(due, due), true);
});

test("改单状态机：补差价 → 等确认 / 生效 / 没扣到；等确认 → 生效 / 拒绝 / 超时；订单取消时作废；有结论的不能再变", () => {
  assert.equal(orderChangeTransitionAllowed("awaiting_payment", "pending_confirmation"), true);
  assert.equal(orderChangeTransitionAllowed("awaiting_payment", "applied"), true);
  assert.equal(orderChangeTransitionAllowed("awaiting_payment", "failed"), true);
  assert.equal(orderChangeTransitionAllowed("pending_confirmation", "applied"), true);
  assert.equal(orderChangeTransitionAllowed("pending_confirmation", "rejected"), true);
  assert.equal(orderChangeTransitionAllowed("pending_confirmation", "expired"), true);
  assert.equal(orderChangeTransitionAllowed("pending_confirmation", "cancelled"), true);
  assert.equal(orderChangeTransitionAllowed("pending_confirmation", "failed"), false);
  for (const final of ["applied", "rejected", "expired", "failed", "cancelled"] as const) {
    assert.equal(orderChangeTransitionAllowed(final, "applied"), false);
    assert.equal(orderChangeOpen(final), false);
  }
  assert.equal(orderChangeOpen("awaiting_payment"), true);
  assert.equal(orderChangeOpen("pending_confirmation"), true);
});

test("改期被拒或没确认后客人可以免费取消；之后又改成功了就不行；没扣到差价、作废的不算", () => {
  assert.equal(freeCancelAfterUnconfirmedChange([]), false);
  assert.equal(freeCancelAfterUnconfirmedChange([{ status: "rejected", reschedule: true }]), true);
  assert.equal(freeCancelAfterUnconfirmedChange([{ status: "expired", reschedule: true }]), true);
  assert.equal(freeCancelAfterUnconfirmedChange([{ status: "rejected", reschedule: true }, { status: "applied", reschedule: true }]), false);
  assert.equal(freeCancelAfterUnconfirmedChange([{ status: "expired", reschedule: true }, { status: "applied", reschedule: false }]), true, "之后只改了航班号，不影响");
  assert.equal(freeCancelAfterUnconfirmedChange([{ status: "rejected", reschedule: true }, { status: "failed", reschedule: true }]), true);
  assert.equal(freeCancelAfterUnconfirmedChange([{ status: "pending_confirmation", reschedule: true }]), false);
});

test("差价：多了补收、少了退回、一样不动", () => {
  assert.deepEqual(priceDifference(22_000, 26_400), { kind: "charge", amountMinor: 4_400 });
  assert.deepEqual(priceDifference(22_000, 20_000), { kind: "refund", amountMinor: 2_000 });
  assert.deepEqual(priceDifference(22_000, 22_000), { kind: "none", amountMinor: 0 });
});
