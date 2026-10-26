/**
 * M4-02 测试角色：工单状态机、申诉 7 天、征求意见 24 小时、时效（跨午夜、跨月、时区）、异常时限的边界。
 * 期望值按需求「客服与工单」「订单中心与异常处理」和 ADR 0034 独立写出，不读实现里的常量。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TICKET_STATUSES,
  TICKET_TYPES,
  type TicketOutcome,
  type TicketStatus,
  type TicketType,
  appealRefusal,
  defaultTicketPriority,
  firstResponseDueAt,
  resolutionDueAt,
  tenantReplyDueAt,
  ticketActive,
  ticketCloseRefusal,
  ticketDecisionRefusal,
  ticketNumber,
  ticketTransitionAllowed,
} from "./tickets.ts";
import { EXCEPTION_TYPES, exceptionDueAt, exceptionOverdue, fulfilmentUnfinishedAt } from "./exceptions.ts";

/** ADR 0034「流转」：待处理 →（认领 / 留言）处理中 →（征求租户意见）等租户回复 →（回复）处理中 → 判定（或判定待复核）→ 已判定 → 关闭；没判定的可以直接关。 */
const ALLOWED: Readonly<Record<TicketStatus, readonly TicketStatus[]>> = {
  open: ["in_progress", "awaiting_tenant", "pending_review", "decided", "closed"],
  in_progress: ["awaiting_tenant", "pending_review", "decided", "closed"],
  awaiting_tenant: ["in_progress", "pending_review", "decided", "closed"],
  pending_review: ["decided", "in_progress"],
  decided: ["closed"],
  closed: [],
};

test("状态机：36 种 (from, to) 组合逐个比对；不能回到待处理、不能原地跳、已判定不能退回、复核中不能直接关、已关闭是终态", () => {
  for (const from of TICKET_STATUSES) {
    for (const to of TICKET_STATUSES) {
      assert.equal(ticketTransitionAllowed(from, to), ALLOWED[from].includes(to), `${from} → ${to}`);
    }
  }
  for (const from of TICKET_STATUSES) assert.equal(ticketTransitionAllowed(from, "open"), false, `${from} → open`);
  for (const status of TICKET_STATUSES) assert.equal(ticketTransitionAllowed(status, status), false, `${status} 原地`);
  assert.deepEqual(TICKET_STATUSES.filter(ticketActive), ["open", "awaiting_tenant", "in_progress"]);
});

test("判定：只有没结论的（待处理、处理中、等租户回复）能判；复核中、已判定、已关闭的都不行；结论要属于这一类工单", () => {
  const now = new Date("2026-10-26T00:00:00Z");
  for (const status of TICKET_STATUSES) {
    const refusal = ticketDecisionRefusal({ type: "complaint", status, tenantReplyDueAt: null }, "upheld", now);
    assert.equal(refusal, ["open", "in_progress", "awaiting_tenant"].includes(status) ? null : "TICKET_STATE_INVALID", status);
  }
  const outcomes: Record<TicketType, TicketOutcome[]> = {
    complaint: ["upheld", "rejected"],
    fulfilment_failure: ["upheld", "rejected"],
    no_show_review: ["approved", "rejected"],
    tenant_appeal: ["upheld", "rejected"],
    order_change: ["resolved"],
    lost_and_found: ["resolved"],
    other: ["resolved"],
  };
  for (const type of TICKET_TYPES) {
    for (const outcome of ["upheld", "rejected", "approved", "resolved"] as const) {
      const refusal = ticketDecisionRefusal({ type, status: "in_progress", tenantReplyDueAt: null }, outcome, now);
      assert.equal(refusal, outcomes[type].includes(outcome) ? null : "OUTCOME_NOT_ALLOWED", `${type} / ${outcome}`);
    }
  }
});

test("征求租户意见 24 小时：期限前 1 毫秒不能判，正好到期那一刻起能判（超时视为认可）；跨午夜、跨月照样按 24 小时整", () => {
  const asked = new Date("2026-10-31T23:30:00+09:00");
  const due = tenantReplyDueAt(asked);
  assert.equal(due.toISOString(), "2026-11-01T14:30:00.000Z");
  const waiting = { type: "complaint" as const, status: "awaiting_tenant" as const, tenantReplyDueAt: due };
  assert.equal(ticketDecisionRefusal(waiting, "upheld", new Date(due.getTime() - 1)), "TENANT_REPLY_PENDING");
  assert.equal(ticketDecisionRefusal(waiting, "upheld", due), null);
  assert.equal(ticketDecisionRefusal(waiting, "rejected", new Date(due.getTime() + 1)), null);
  // 供应商回复后（处理中），不受 24 小时限制
  assert.equal(ticketDecisionRefusal({ ...waiting, status: "in_progress" }, "upheld", new Date(due.getTime() - 3_600_000)), null);
});

test("关闭：判定过的都能关；没判定的除 no-show 审核外都能直接关；复核中、已关闭的不能关", () => {
  for (const type of TICKET_TYPES) {
    for (const status of TICKET_STATUSES) {
      const refusal = ticketCloseRefusal({ type, status });
      let expected: string | null;
      if (status === "decided") expected = null;
      else if (status === "pending_review" || status === "closed") expected = "TICKET_STATE_INVALID";
      else expected = type === "no_show_review" ? "DECISION_REQUIRED" : null;
      assert.equal(refusal, expected, `${type} / ${status}`);
    }
  }
});

test("申诉 7 天：按毫秒算，跨月；正好 7 天可以、多 1 毫秒不行；已关闭的判定同样能申诉", () => {
  const decidedAt = new Date("2026-10-28T10:00:00.000Z");
  const parent = { type: "complaint" as const, status: "decided" as const, outcome: "upheld" as const, liableParty: "tenant" as const, decidedAt };
  const at = (iso: string) => appealRefusal(parent, new Date(iso));
  assert.equal(at("2026-10-28T10:00:00.000Z"), null, "判定当刻");
  assert.equal(at("2026-11-04T09:59:59.999Z"), null);
  assert.equal(at("2026-11-04T10:00:00.000Z"), null, "正好 7 天");
  assert.equal(at("2026-11-04T10:00:00.001Z"), "APPEAL_WINDOW_CLOSED");
  assert.equal(appealRefusal({ ...parent, status: "closed" }, new Date("2026-11-04T10:00:00.000Z")), null);
});

test("申诉：哪些判定能申诉——投诉 / 履约失败成立且责任在租户、no-show 被驳回；其余（责任在平台、不成立、no-show 通过、已处理、申诉本身、没判定）都不能", () => {
  const decidedAt = new Date("2026-10-20T00:00:00Z");
  const now = new Date("2026-10-21T00:00:00Z");
  const cases: [TicketType, TicketOutcome | null, "tenant" | "platform" | null, TicketStatus, boolean][] = [
    ["complaint", "upheld", "tenant", "decided", true],
    ["fulfilment_failure", "upheld", "tenant", "decided", true],
    ["no_show_review", "rejected", null, "decided", true],
    ["complaint", "upheld", "platform", "decided", false],
    ["fulfilment_failure", "upheld", "platform", "decided", false],
    ["complaint", "rejected", null, "decided", false],
    ["no_show_review", "approved", null, "decided", false],
    ["tenant_appeal", "rejected", null, "decided", false],
    ["tenant_appeal", "upheld", null, "decided", false],
    ["order_change", "resolved", null, "decided", false],
    ["lost_and_found", "resolved", null, "decided", false],
    ["complaint", null, null, "closed", false],
    ["complaint", "upheld", "tenant", "pending_review", false],
  ];
  for (const [type, outcome, liableParty, status, appealable] of cases) {
    const refusal = appealRefusal({ type, outcome, liableParty, status, decidedAt: outcome === null ? null : decidedAt }, now);
    assert.equal(refusal, appealable ? null : "NOT_APPEALABLE", `${type} / ${outcome} / ${liableParty} / ${status}`);
  }
});

test("优先级：用车当天（城市当地日期）紧急，按城市时区判断跨午夜；跨月；no-show 审核不在当天时是高", () => {
  const bangkok = { serviceDate: "2026-11-01", timeZone: "Asia/Bangkok" };
  // 曼谷 UTC+7：11/01 00:00 = 10/31 17:00Z
  assert.equal(defaultTicketPriority("complaint", bangkok, new Date("2026-10-31T16:59:59.999Z")), "normal");
  assert.equal(defaultTicketPriority("complaint", bangkok, new Date("2026-10-31T17:00:00.000Z")), "urgent");
  assert.equal(defaultTicketPriority("complaint", bangkok, new Date("2026-11-01T16:59:59.999Z")), "urgent");
  assert.equal(defaultTicketPriority("complaint", bangkok, new Date("2026-11-01T17:00:00.000Z")), "normal");
  // 同一时刻，东京已经是 11/01、曼谷还是 10/31
  const instant = new Date("2026-10-31T16:00:00Z");
  assert.equal(defaultTicketPriority("complaint", { serviceDate: "2026-11-01", timeZone: "Asia/Tokyo" }, instant), "urgent");
  assert.equal(defaultTicketPriority("complaint", bangkok, instant), "normal");
  assert.equal(defaultTicketPriority("no_show_review", bangkok, instant), "high");
  assert.equal(defaultTicketPriority("no_show_review", bangkok, new Date("2026-11-01T00:00:00Z")), "urgent");
});

test("首次响应：一般 2 小时、紧急 15 分钟（高、低优先级也是 2 小时）", () => {
  const created = new Date("2026-10-31T23:50:00Z");
  assert.equal(firstResponseDueAt("urgent", created).toISOString(), "2026-11-01T00:05:00.000Z");
  for (const priority of ["high", "normal", "low"] as const) assert.equal(firstResponseDueAt(priority, created).toISOString(), "2026-11-01T01:50:00.000Z", priority);
});

test("结案 3 个工作日：按东京的星期几（不是 UTC），跳过周六周日，跨月", () => {
  const cases: [string, string, string][] = [
    // [创建（UTC）, 期限（UTC）, 说明]
    ["2026-10-26T01:00:00Z", "2026-10-29T01:00:00.000Z", "周一 → 周四"],
    ["2026-10-28T01:00:00Z", "2026-11-02T01:00:00.000Z", "周三 → 下周一（跨月）"],
    ["2026-10-30T06:00:00Z", "2026-11-04T06:00:00.000Z", "周五 → 下周三（跨月）"],
    ["2026-10-31T01:00:00Z", "2026-11-04T01:00:00.000Z", "周六 → 周三"],
    ["2026-11-01T01:00:00Z", "2026-11-04T01:00:00.000Z", "周日 → 周三"],
    // UTC 周五 16:00 = 东京周六 01:00：按东京算是周六建的
    ["2026-10-23T16:00:00Z", "2026-10-27T16:00:00.000Z", "东京周六凌晨 → 周三凌晨"],
    // UTC 周日 15:30 = 东京周一 00:30
    ["2026-10-25T15:30:00Z", "2026-10-28T15:30:00.000Z", "东京周一凌晨 → 周四凌晨"],
  ];
  for (const [created, due, label] of cases) assert.equal(resolutionDueAt(new Date(created)).toISOString(), due, label);
});

test("工单号：日期用 UTC（东京已经是第二天也按 UTC 当天），随机部分 6 位、不含 I 和 O", () => {
  assert.equal(ticketNumber(new Date("2026-10-31T23:59:59Z"), "ABCDEF"), "TK20261031ABCDEF");
  for (const bad of ["ABCDE", "ABCDEFG", "abcdef", "ABCDEO", "ABCDEI", "ABC-EF"]) assert.throws(() => ticketNumber(new Date(), bad), RangeError, bad);
});

test("异常时限（需求表）：超时未派车、救援中立即；司机未出发 15 分钟；司机未到达 5 分钟；推送失败 2 小时；其余 24 小时。正好到时限不算超时，多 1 毫秒算", () => {
  const minutes: Record<string, number> = {
    dispatch_overdue: 0,
    departure_overdue: 15,
    arrival_overdue: 5,
    push_failed: 120,
    no_show_review: 1440,
    extra_charge_review: 1440,
    fulfilment_unfinished: 1440,
    payment_issue: 1440,
    rescue: 0,
  };
  assert.deepEqual([...EXCEPTION_TYPES].sort(), Object.keys(minutes).sort());
  const opened = new Date("2026-10-31T23:59:00Z");
  for (const type of EXCEPTION_TYPES) {
    const due = exceptionDueAt(type, opened);
    assert.equal(due.getTime() - opened.getTime(), (minutes[type] as number) * 60_000, type);
    assert.equal(exceptionOverdue(due, due), false, `${type} 正好到时限`);
    assert.equal(exceptionOverdue(due, new Date(due.getTime() + 1)), true, `${type} 多 1 毫秒`);
  }
  assert.equal(fulfilmentUnfinishedAt(new Date("2026-10-31T20:00:00Z")).toISOString(), "2026-11-01T20:00:00.000Z");
});
