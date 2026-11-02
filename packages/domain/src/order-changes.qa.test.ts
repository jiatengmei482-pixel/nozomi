/**
 * M4-29 测试角色：期限和免费取消规则的不变量（ADR 0060）。纯函数，在一张时间网格上逐点核对，不只测文档里举的例子。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ORDER_CHANGE_RULES, changeAdjustingDeadline, changeConfirmDeadline, changeConfirmOverdue, changeRemindAfterMinutes, changeDeclineAdvice, earliestServiceAt, freeCancelAfterUnconfirmedChange, orderChangeOpen, orderChangeStillApplicable, orderChangeTransitionAllowed, ORDER_CHANGE_STATUSES } from "./order-changes.ts";
import { driverNoticeSendBlock } from "./driver-link-email.ts";
import { notificationExpiresAt, notificationQuietUntil } from "./notifications.ts";

const HOUR = 3_600_000;
const MIN = 60_000;
const NOW = new Date("2026-11-02T00:00:00Z");
const at = (ms: number): Date => new Date(NOW.getTime() + ms);
/** 离用车的时长：从几分钟到 30 天，边界两侧都有 */
const LEADS = [5 * MIN, 29 * MIN, 30 * MIN, 31 * MIN, HOUR, 1.5 * HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 22 * HOUR, 23 * HOUR, 23.5 * HOUR, 24 * HOUR - 1, 24 * HOUR, 24 * HOUR + 1, 24.5 * HOUR, 25 * HOUR, 26 * HOUR, 46 * HOUR, 47 * HOUR, 48 * HOUR, 72 * HOUR, 240 * HOUR, 720 * HOUR];

test("提出期限：离用车 ≤ 24 小时是提出后 30 分钟；更远是用车前 23.5 小时；任何时候都晚于现在", () => {
  for (const lead of LEADS) {
    const due = changeConfirmDeadline(NOW, at(lead), null).getTime();
    assert.equal(due, NOW.getTime() + (lead <= 24 * HOUR ? 30 * MIN : lead - 23.5 * HOUR), `离用车 ${lead / HOUR} 小时`);
    assert.ok(due > NOW.getTime());
  }
});

test("改期的期限不晚于新的用车时间；最早用车时间取两者早的", () => {
  for (const lead of LEADS) {
    const newAt = at(lead);
    const original = at(lead + 2 * HOUR);
    const earliest = earliestServiceAt(original, newAt);
    assert.equal(earliest.getTime(), newAt.getTime());
    assert.ok(changeConfirmDeadline(NOW, earliest, newAt).getTime() <= newAt.getTime(), `离新时间 ${lead / HOUR} 小时`);
    assert.equal(earliestServiceAt(newAt, original).getTime(), newAt.getTime(), "往后改取原时间");
    assert.equal(earliestServiceAt(newAt, null).getTime(), newAt.getTime());
  }
});

test("调整中的期限：一定晚于现在；≤ 24 小时不会比原来短；> 24 小时不超过 24 小时；有余量时不晚于用车前 1 小时；至少给 2 小时（放得下时）", () => {
  for (const lead of LEADS) {
    const earliest = at(lead);
    const current = changeConfirmDeadline(NOW, earliest, null);
    const due = changeAdjustingDeadline(NOW, current, earliest).getTime();
    const label = `离用车 ${lead / HOUR} 小时`;
    assert.ok(due > NOW.getTime(), label);
    if (lead <= 24 * HOUR) assert.ok(due >= current.getTime(), `${label}：不缩短`);
    else {
      assert.ok(due <= NOW.getTime() + ORDER_CHANGE_RULES.adjustingMaxHours * HOUR, `${label}：远期最多 24 小时`);
      assert.ok(due <= Math.max(earliest.getTime() - HOUR, current.getTime()), `${label}：不晚于用车前 1 小时`);
      assert.ok(due >= NOW.getTime() + ORDER_CHANGE_RULES.adjustingMinHours * HOUR, `${label}：至少 2 小时`);
    }
    if (lead >= 3 * HOUR) assert.ok(due <= earliest.getTime() - HOUR, `${label}：有余量时不晚于用车前 1 小时`);
    if (lead >= 3 * HOUR) assert.ok(due >= NOW.getTime() + 2 * HOUR, `${label}：有余量时至少 2 小时`);
  }
});

test("到期判断：正好到点算到期，差 1 毫秒不算", () => {
  const due = at(30 * MIN);
  assert.equal(changeConfirmOverdue(due, due), true);
  assert.equal(changeConfirmOverdue(due, new Date(due.getTime() - 1)), false);
});

test("提醒门槛：离用车越近越短，边界算近的那一档", () => {
  const cases: [number, number][] = [[HOUR, 15], [24 * HOUR, 15], [24 * HOUR + 1, 60], [48 * HOUR, 60], [48 * HOUR + 1, 240], [720 * HOUR, 240]];
  for (const [lead, minutes] of cases) assert.equal(changeRemindAfterMinutes(at(lead), NOW), minutes, `离用车 ${lead / HOUR} 小时`);
  for (const lead of LEADS.filter((item) => item <= 24 * HOUR && item > 30 * MIN)) assert.ok(changeRemindAfterMinutes(at(lead), NOW) < ORDER_CHANGE_RULES.confirmMinutes, "临近出发的提醒在失效之前");
});

test("状态机：有结论的是终态；没结论的正好是 orderChangeOpen 那三种；不能跳回去", () => {
  for (const from of ORDER_CHANGE_STATUSES) {
    if (orderChangeOpen(from)) continue;
    for (const to of ORDER_CHANGE_STATUSES) assert.equal(orderChangeTransitionAllowed(from, to), false, `${from} → ${to}`);
  }
  assert.equal(orderChangeTransitionAllowed("adjusting", "pending_confirmation"), false, "只能标一次");
  assert.equal(orderChangeTransitionAllowed("awaiting_payment", "applied"), false, "扣到差价也不能直接生效");
  assert.equal(orderChangeTransitionAllowed("awaiting_payment", "adjusting"), false);
});

test("还适用吗：航班号、地址到接到客人前都适用；时间、人数、行李到司机出发前；服务开始后都不适用", () => {
  for (const status of ["confirmed", "assigned", "departed", "arrived"]) assert.equal(orderChangeStillApplicable(status as never, ["flight_no", "dropoff_address"]), true, status);
  for (const status of ["departed", "arrived", "in_service", "completed", "cancelled"]) assert.equal(orderChangeStillApplicable(status as never, ["service_time"]), false, status);
  for (const status of ["in_service", "completed", "cancelled", "rescue_pending"]) assert.equal(orderChangeStillApplicable(status as never, ["flight_no"]), false, status);
  assert.equal(orderChangeStillApplicable("departed", ["flight_no", "passengers"]), false, "混了就按严的");
});

test("免费取消：只看最近一次要确认的修改；联系信息、扣款失败、作废的不算；生效了就没有；只有用车前 24 小时内提出的改期才给（协调人定的规则，原来人数、地址也给）", () => {
  const facts = (status: "rejected" | "expired" | "applied" | "failed" | "cancelled" | "pending_confirmation", after: Record<string, unknown>) => ({ status, after, before: { service_time: at(12 * HOUR).toISOString() }, requestedAt: NOW });
  const time = { service_time: "x", service_local: "x" };
  const free = (changes: Parameters<typeof freeCancelAfterUnconfirmedChange>[1]): boolean => freeCancelAfterUnconfirmedChange("assigned", changes);
  assert.equal(free([]), false);
  assert.equal(free([facts("rejected", time)]), true);
  assert.equal(free([facts("expired", time)]), true);
  assert.equal(free([facts("rejected", { passengers: 3 })]), false, "没改时间");
  assert.equal(free([facts("rejected", { flight_no: "JL5" })]), false, "只改航班号");
  assert.equal(free([facts("applied", { notes: "x" }), facts("rejected", { flight_no: "JL5" })]), false);
  assert.equal(free([facts("rejected", time), facts("applied", { notes: "x" })]), true, "改备注不抹掉");
  assert.equal(free([facts("rejected", time), facts("applied", { luggage: 3 })]), false);
  assert.equal(free([facts("rejected", time), facts("pending_confirmation", { luggage: 3 })]), false, "新申请没结论时不算");
  assert.equal(free([facts("failed", time)]), false);
  assert.equal(free([facts("cancelled", time)]), false);
  assert.equal(freeCancelAfterUnconfirmedChange("arrived", [facts("rejected", time)]), false, "司机已到达");
  assert.equal(changeDeclineAdvice("assigned", facts("rejected", { flight_no: "JL5" })), "policy");
  assert.equal(changeDeclineAdvice("assigned", facts("rejected", { flight_no: "JL5", passengers: 3 })), "policy");
  assert.equal(changeDeclineAdvice("in_service", facts("rejected", { flight_no: "JL5" })), "started");
});

test("司机通知发送前复查：改派后的旧司机不发（取消除外）；手动、停用、没邮箱不发；等确认的通知有结论后不发；带链接的看锚点", () => {
  const facts = {
    now: NOW,
    event: "order.driver_changed",
    driverId: "d1",
    order: { status: "assigned", driverId: "d1" },
    changeOpen: null,
    anchor: { driverId: "d1", revokedAt: null, expiresAt: at(HOUR) },
    mode: "auto" as const,
    driver: { email: "fictional.driver@example.test", status: "active" },
  };
  assert.equal(driverNoticeSendBlock(facts), null);
  assert.equal(driverNoticeSendBlock({ ...facts, order: { status: "assigned", driverId: "d2" } }), "ORDER_STATE_CHANGED");
  assert.equal(driverNoticeSendBlock({ ...facts, order: { status: "cancelled", driverId: "d1" } }), "ORDER_STATE_CHANGED");
  assert.equal(driverNoticeSendBlock({ ...facts, event: "order.driver_cancelled", order: { status: "cancelled", driverId: "d2" }, anchor: null }), null, "取消：通知的就是当时那位");
  assert.equal(driverNoticeSendBlock({ ...facts, anchor: null }), "DRIVER_LINK_REVOKED");
  assert.equal(driverNoticeSendBlock({ ...facts, anchor: { ...facts.anchor, revokedAt: NOW } }), "DRIVER_LINK_REVOKED");
  assert.equal(driverNoticeSendBlock({ ...facts, anchor: { ...facts.anchor, expiresAt: NOW } }), "DRIVER_LINK_REVOKED", "正好到期算过期");
  assert.equal(driverNoticeSendBlock({ ...facts, anchor: { ...facts.anchor, driverId: "d2" } }), "DRIVER_LINK_REVOKED");
  assert.equal(driverNoticeSendBlock({ ...facts, event: "order.driver_change_pending", changeOpen: false, anchor: null }), "CHANGE_DECIDED");
  assert.equal(driverNoticeSendBlock({ ...facts, event: "order.driver_change_pending", changeOpen: null, anchor: null }), "CHANGE_DECIDED");
  assert.equal(driverNoticeSendBlock({ ...facts, event: "order.driver_cancelled", mode: "manual" as never, order: { status: "cancelled", driverId: "d1" }, anchor: null }), "DRIVER_LINK_MANUAL");
  assert.equal(driverNoticeSendBlock({ ...facts, driver: { email: null, status: "active" } }), "DRIVER_EMAIL_MISSING");
  assert.equal(driverNoticeSendBlock({ ...facts, driver: { email: "x@example.test", status: "disabled" } }), "DRIVER_DISABLED");
  assert.equal(driverNoticeSendBlock({ ...facts, driver: null }), "DRIVER_DISABLED");
});

test("通知有效期：用车时间之后才发生的取消也能发给司机；用车前的不晚于用车时间", () => {
  const service = at(10 * HOUR);
  assert.equal(notificationExpiresAt("order.driver_cancelled", { occurredAt: NOW, serviceAt: service, disputeUntil: null }).getTime(), service.getTime());
  const late = at(11 * HOUR);
  assert.ok(notificationExpiresAt("order.driver_cancelled", { occurredAt: late, serviceAt: service, disputeUntil: null }).getTime() > late.getTime());
  assert.ok(notificationExpiresAt("order.driver_cancelled", { occurredAt: new Date(service.getTime() - MIN), serviceAt: service, disputeUntil: null }).getTime() > service.getTime() - MIN, "离用车 1 分钟时取消也有时间发");
});

test("免打扰：修改、取消、申请、救援，不管离用车多远都马上发", () => {
  const quiet = { start: "00:00", end: "23:59" };
  for (const event of ["order.cancelled", "order.changed", "order.change_pending", "order.rescue_started"] as const) {
    assert.equal(notificationQuietUntil({ event, quietHours: quiet, now: NOW, serviceAt: at(720 * HOUR), occurredAt: NOW } as never), null, event);
  }
});
