import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type OrderChangeCheck,
  CONFIRM_FIELDS,
  CONTACT_FIELDS,
  changeAdjustingDeadline,
  changeConfirmDeadline,
  changeConfirmOverdue,
  changeFieldsNeedConfirmation,
  changeRemindAfterMinutes,
  changeDeclineAdvice,
  earliestServiceAt,
  freeCancelAfterUnconfirmedChange,
  orderChangeDecidable,
  orderChangeOpen,
  orderChangeStillApplicable,
  orderChangeRefusal,
  orderChangeTransitionAllowed,
  priceDifference,
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

test("字段分类：姓名电话邮箱、即时通讯、备注是联系信息；时间、地址、航班、人数、行李要确认", () => {
  assert.deepEqual([...CONTACT_FIELDS].sort(), ["messaging", "notes", "passenger"]);
  assert.deepEqual([...CONFIRM_FIELDS].sort(), ["dropoff_address", "flight_no", "luggage", "passengers", "pickup_address", "service_time"]);
  assert.equal(changeFieldsNeedConfirmation(["passenger", "notes"]), false);
  assert.equal(changeFieldsNeedConfirmation(["notes", "flight_no"]), true);
});

test("最早用车时间：原来的和新的里早的那个；没改时间就是原来的", () => {
  const old = new Date(now.getTime() + 72 * HOUR);
  const sooner = new Date(now.getTime() + 2 * HOUR);
  assert.equal(earliestServiceAt(old, null), old);
  assert.equal(earliestServiceAt(old, sooner), sooner);
  assert.equal(earliestServiceAt(sooner, old), sooner);
});

test("期限：24 小时内提出后 30 分钟；更远的到最早用车前 24 小时 + 30 分钟才失效；到点那一刻起算超时", () => {
  const at = (hours: number): Date => new Date(now.getTime() + hours * HOUR);
  const near = changeConfirmDeadline(now, at(23), null);
  assert.equal(near.toISOString(), "2026-10-25T00:30:00.000Z");
  assert.equal(changeConfirmDeadline(now, at(24), null).toISOString(), "2026-10-25T00:30:00.000Z", "正好 24 小时");
  assert.equal(changeConfirmDeadline(now, at(120), null).getTime(), at(96.5).getTime(), "远期不自动失效，进了 24 小时才算");
  assert.equal(changeConfirmDeadline(now, at(0.1), at(0.1)).getTime(), at(0.1).getTime(), "改到 6 分钟后：不晚于新的用车时间");
  assert.equal(changeConfirmDeadline(now, at(-1), null).toISOString(), "2026-10-25T00:30:00.000Z", "用车时间已过才改航班号，仍给 30 分钟");
  assert.equal(changeConfirmOverdue(near, new Date(near.getTime() - 1)), false);
  assert.equal(changeConfirmOverdue(near, near), true);
});

test("调整中的期限：永远不缩短原期限；原期限太紧时放宽（远期最多 24 小时，24 小时内 2 小时），都不晚于用车前 1 小时", () => {
  const at = (hours: number): Date => new Date(now.getTime() + hours * HOUR);
  assert.equal(changeAdjustingDeadline(now, at(696.5), at(720)).getTime(), at(696.5).getTime(), "远期：原期限够长，不缩短");
  assert.equal(changeAdjustingDeadline(now, at(2.5), at(26)).getTime(), at(4).getTime(), "最早用车前 22 小时");
  assert.equal(changeAdjustingDeadline(now, at(0.5), at(24.5)).getTime(), at(2.5).getTime(), "离用车 24.5 小时：至少 2 小时");
  assert.equal(changeAdjustingDeadline(now, at(0.5), at(10)).getTime(), at(2).getTime(), "24 小时内 2 小时");
  assert.equal(changeAdjustingDeadline(now, at(0.5), at(2)).getTime(), at(1).getTime(), "不晚于用车前 1 小时");
  assert.equal(changeAdjustingDeadline(now, at(0.5), at(1.2)).getTime(), at(0.5).getTime(), "快用车了不会变短");
});

test("提醒运营的时限：离最早用车时间越近越短，边界按毫秒", () => {
  const at = (hours: number): Date => new Date(now.getTime() + hours * HOUR);
  assert.equal(changeRemindAfterMinutes(at(24), now), 15);
  assert.equal(changeRemindAfterMinutes(new Date(at(24).getTime() + 1), now), 60);
  assert.equal(changeRemindAfterMinutes(at(48), now), 60);
  assert.equal(changeRemindAfterMinutes(new Date(at(48).getTime() + 1), now), 240);
});

test("改单状态机：补差价 → 等确认 / 没扣到；等确认 → 调整中 / 生效 / 拒绝 / 超时；调整中不能退回等确认；有结论的不能再变", () => {
  assert.equal(orderChangeTransitionAllowed("awaiting_payment", "pending_confirmation"), true);
  assert.equal(orderChangeTransitionAllowed("awaiting_payment", "applied"), false, "改单不再有扣到差价就生效这条路");
  assert.equal(orderChangeTransitionAllowed("awaiting_payment", "failed"), true);
  for (const to of ["adjusting", "applied", "rejected", "expired", "cancelled"] as const) assert.equal(orderChangeTransitionAllowed("pending_confirmation", to), true, to);
  for (const to of ["applied", "rejected", "expired", "cancelled"] as const) assert.equal(orderChangeTransitionAllowed("adjusting", to), true, to);
  assert.equal(orderChangeTransitionAllowed("adjusting", "pending_confirmation"), false);
  assert.equal(orderChangeTransitionAllowed("pending_confirmation", "failed"), false);
  for (const final of ["applied", "rejected", "expired", "failed", "cancelled"] as const) {
    assert.equal(orderChangeTransitionAllowed(final, "applied"), false);
    assert.equal(orderChangeOpen(final), false);
    assert.equal(orderChangeDecidable(final), false);
  }
  for (const open of ["awaiting_payment", "pending_confirmation", "adjusting"] as const) assert.equal(orderChangeOpen(open), true);
  assert.equal(orderChangeDecidable("awaiting_payment"), false, "差价没扣到不让供应商处理");
  assert.equal(orderChangeDecidable("adjusting"), true);
});

test("订单走到哪一步修改还适用：时间人数行李到司机出发之前；地址航班到接到客人之前", () => {
  assert.equal(orderChangeStillApplicable("assigned", ["service_time"]), true);
  assert.equal(orderChangeStillApplicable("departed", ["service_time"]), false);
  assert.equal(orderChangeStillApplicable("departed", ["flight_no"]), true);
  assert.equal(orderChangeStillApplicable("arrived", ["pickup_address"]), true);
  assert.equal(orderChangeStillApplicable("in_service", ["flight_no"]), false);
  assert.equal(orderChangeStillApplicable("rescue_pending", ["flight_no"]), false);
});

test("免费取消：用车前 24 小时内提出的改期被拒或没确认才给；正好 24 小时不给，差 1 毫秒给", () => {
  const serviceAt = new Date(now.getTime() + 24 * HOUR);
  const reschedule = (status: "rejected" | "expired" | "applied" | "failed" | "cancelled" | "pending_confirmation" | "adjusting", msBefore = 24 * HOUR - 1) => ({
    status,
    before: { service_time: serviceAt.toISOString(), service_local: "x" },
    after: { service_time: "y", service_local: "y" },
    requestedAt: new Date(serviceAt.getTime() - msBefore),
  });
  assert.equal(freeCancelAfterUnconfirmedChange("assigned", []), false);
  assert.equal(freeCancelAfterUnconfirmedChange("assigned", [reschedule("rejected")]), true, "差 1 毫秒");
  assert.equal(freeCancelAfterUnconfirmedChange("confirmed", [reschedule("expired")]), true);
  assert.equal(freeCancelAfterUnconfirmedChange("assigned", [reschedule("rejected", 24 * HOUR)]), false, "正好 24 小时");
  assert.equal(freeCancelAfterUnconfirmedChange("assigned", [reschedule("expired", 48 * HOUR)]), false, "24 小时前提出、拖到 24 小时内才超时：已知代价，按阶梯");
  assert.equal(freeCancelAfterUnconfirmedChange("assigned", [reschedule("rejected"), reschedule("applied")]), false, "之后有生效的修改");
  assert.equal(freeCancelAfterUnconfirmedChange("assigned", [reschedule("rejected"), reschedule("failed")]), true, "没扣到差价的不算");
  assert.equal(freeCancelAfterUnconfirmedChange("assigned", [reschedule("rejected"), reschedule("cancelled")]), true);
  for (const status of ["pending_confirmation", "adjusting"] as const) assert.equal(freeCancelAfterUnconfirmedChange("assigned", [reschedule("rejected"), reschedule(status)]), false, `最近一条还没结论：${status}`);
  assert.equal(freeCancelAfterUnconfirmedChange("assigned", [reschedule("rejected"), { ...reschedule("applied"), after: { notes: "x" }, before: { notes: null } }]), true, "联系信息不影响");
  for (const status of ["departed", "arrived", "in_service", "completed", "cancelled", "rescue_pending", "no_show_claimed"] as const) assert.equal(freeCancelAfterUnconfirmedChange(status, [reschedule("rejected")]), false, status);
});

test("免费取消：人数、地址、航班、行李的申请都不算；最近一条不是改期就不给", () => {
  const requestedAt = new Date(now.getTime() - HOUR);
  const before = { service_time: now.toISOString() };
  for (const field of ["passengers", "luggage", "flight_no", "pickup_address", "dropoff_address"]) assert.equal(freeCancelAfterUnconfirmedChange("assigned", [{ status: "rejected", before: { [field]: 1 }, after: { [field]: 2 }, requestedAt }]), false, field);
  const time = { status: "rejected" as const, before, after: { service_time: "y" }, requestedAt };
  assert.equal(freeCancelAfterUnconfirmedChange("assigned", [time, { status: "rejected", before: {}, after: { flight_no: "JL5" }, requestedAt }]), false);
  assert.equal(freeCancelAfterUnconfirmedChange("assigned", [{ ...time, status: "rejected", after: { service_time: "y", passengers: 3 }, before: { ...before, passengers: 2 } }]), true, "同时改了时间");
});

test("告诉客人接下来能做什么：免费、按政策、服务已开始三选一", () => {
  const time = { status: "rejected" as const, before: { service_time: now.toISOString() }, after: { service_time: "y" }, requestedAt: new Date(now.getTime() - HOUR) };
  assert.equal(changeDeclineAdvice("assigned", time), "free_cancel");
  assert.equal(changeDeclineAdvice("departed", time), "policy");
  assert.equal(changeDeclineAdvice("assigned", { ...time, after: { passengers: 3 } }), "policy");
  assert.equal(changeDeclineAdvice("in_service", time), "started");
});

test("差价：多了补收、少了退回、一样不动", () => {
  assert.deepEqual(priceDifference(22_000, 26_400), { kind: "charge", amountMinor: 4_400 });
  assert.deepEqual(priceDifference(22_000, 20_000), { kind: "refund", amountMinor: 2_000 });
  assert.deepEqual(priceDifference(22_000, 22_000), { kind: "none", amountMinor: 0 });
});
