import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TICKET_STATUSES,
  TICKET_TYPES,
  appealDeadline,
  appealRefusal,
  decisionAgainstTenant,
  defaultTicketPriority,
  firstResponseDueAt,
  outcomeNeedsCompensation,
  resolutionDueAt,
  tenantReplyDueAt,
  ticketCloseRefusal,
  ticketDecisionRefusal,
  ticketNumber,
  ticketOutcomeAllowed,
  ticketTransitionAllowed,
  ticketTypeAllowed,
} from "./tickets.ts";

test("谁能建哪类工单：客人和渠道建投诉、改单、失物、其他；租户建申诉、失物、其他；客服不能代建申诉和 no-show 审核；no-show 审核只由系统建", () => {
  assert.equal(ticketTypeAllowed("guest", "complaint"), true);
  assert.equal(ticketTypeAllowed("channel", "tenant_appeal"), false);
  assert.equal(ticketTypeAllowed("tenant", "tenant_appeal"), true);
  assert.equal(ticketTypeAllowed("tenant", "complaint"), false);
  assert.equal(ticketTypeAllowed("platform", "fulfilment_failure"), true);
  assert.equal(ticketTypeAllowed("platform", "no_show_review"), false);
  assert.equal(ticketTypeAllowed("platform", "tenant_appeal"), false);
  assert.equal(ticketTypeAllowed("system", "no_show_review"), true);
  assert.equal(TICKET_TYPES.length, 7);
});

test("默认优先级：用车当天（城市当地日期）紧急；no-show 审核高；其余普通", () => {
  const order = { serviceDate: "2026-10-20", timeZone: "Asia/Tokyo" };
  // 东京 10/20 00:30 = UTC 10/19 15:30
  assert.equal(defaultTicketPriority("complaint", order, new Date("2026-10-19T15:30:00Z")), "urgent");
  assert.equal(defaultTicketPriority("complaint", order, new Date("2026-10-19T14:59:00Z")), "normal");
  assert.equal(defaultTicketPriority("no_show_review", order, new Date("2026-10-21T01:00:00Z")), "high");
});

test("时效：首次响应 2 小时、紧急 15 分钟；结案 3 个工作日（跳过东京的周六周日）；租户 24 小时内回复", () => {
  const created = new Date("2026-10-23T06:00:00Z"); // 周五 15:00（东京）
  assert.equal(firstResponseDueAt("normal", created).toISOString(), "2026-10-23T08:00:00.000Z");
  assert.equal(firstResponseDueAt("urgent", created).toISOString(), "2026-10-23T06:15:00.000Z");
  assert.equal(resolutionDueAt(created).toISOString(), "2026-10-28T06:00:00.000Z"); // 下周三
  assert.equal(resolutionDueAt(new Date("2026-10-26T01:00:00Z")).toISOString(), "2026-10-29T01:00:00.000Z"); // 周一 → 周四
  assert.equal(tenantReplyDueAt(created).toISOString(), "2026-10-24T06:00:00.000Z");
});

test("状态流转：判定前可以等租户、处理中、复核、判定、关闭；复核只去已判定或退回处理中；已判定只能关闭；已关闭是终态", () => {
  assert.equal(ticketTransitionAllowed("open", "awaiting_tenant"), true);
  assert.equal(ticketTransitionAllowed("awaiting_tenant", "in_progress"), true);
  assert.equal(ticketTransitionAllowed("pending_review", "decided"), true);
  assert.equal(ticketTransitionAllowed("pending_review", "in_progress"), true);
  assert.equal(ticketTransitionAllowed("pending_review", "closed"), false);
  assert.equal(ticketTransitionAllowed("decided", "in_progress"), false);
  for (const status of TICKET_STATUSES) assert.equal(ticketTransitionAllowed("closed", status), false);
});

test("判定：结论要属于这类工单；等租户回复的，期限那一刻起才能判（超时视为认可）；已判定的不能再判", () => {
  const due = new Date("2026-10-24T06:00:00Z");
  const waiting = { type: "complaint" as const, status: "awaiting_tenant" as const, tenantReplyDueAt: due };
  assert.equal(ticketDecisionRefusal(waiting, "upheld", new Date(due.getTime() - 1)), "TENANT_REPLY_PENDING");
  assert.equal(ticketDecisionRefusal(waiting, "upheld", due), null);
  assert.equal(ticketDecisionRefusal({ ...waiting, status: "in_progress" }, "approved", due), "OUTCOME_NOT_ALLOWED");
  assert.equal(ticketDecisionRefusal({ ...waiting, status: "decided" }, "upheld", due), "TICKET_STATE_INVALID");
  assert.equal(ticketOutcomeAllowed("no_show_review", "approved"), true);
  assert.equal(ticketOutcomeAllowed("lost_and_found", "upheld"), false);
  assert.equal(outcomeNeedsCompensation("complaint", "upheld"), true);
  assert.equal(outcomeNeedsCompensation("fulfilment_failure", "upheld"), true);
  assert.equal(outcomeNeedsCompensation("complaint", "rejected"), false);
  assert.equal(outcomeNeedsCompensation("tenant_appeal", "upheld"), false);
});

test("关闭：判定过的可以关；没判定的可以直接关（重复、撤回），no-show 审核除外；复核中、已关闭的不能关", () => {
  assert.equal(ticketCloseRefusal({ type: "complaint", status: "decided" }), null);
  assert.equal(ticketCloseRefusal({ type: "complaint", status: "open" }), null);
  assert.equal(ticketCloseRefusal({ type: "no_show_review", status: "in_progress" }), "DECISION_REQUIRED");
  assert.equal(ticketCloseRefusal({ type: "complaint", status: "pending_review" }), "TICKET_STATE_INVALID");
  assert.equal(ticketCloseRefusal({ type: "complaint", status: "closed" }), "TICKET_STATE_INVALID");
});

test("申诉：只有对租户不利的判定（投诉成立且责任在租户、no-show 被驳回）能申诉；判定后 7 天内（正好 7 天还行）", () => {
  const decidedAt = new Date("2026-10-20T00:00:00Z");
  const parent = { type: "complaint" as const, status: "decided" as const, outcome: "upheld" as const, liableParty: "tenant" as const, decidedAt };
  assert.equal(appealDeadline(decidedAt).toISOString(), "2026-10-27T00:00:00.000Z");
  assert.equal(appealRefusal(parent, new Date("2026-10-27T00:00:00.000Z")), null);
  assert.equal(appealRefusal({ ...parent, status: "closed" }, new Date("2026-10-27T00:00:00.000Z")), null);
  assert.equal(appealRefusal(parent, new Date("2026-10-27T00:00:00.001Z")), "APPEAL_WINDOW_CLOSED");
  assert.equal(appealRefusal({ ...parent, liableParty: "platform" }, decidedAt), "NOT_APPEALABLE");
  assert.equal(appealRefusal({ ...parent, outcome: "rejected" }, decidedAt), "NOT_APPEALABLE");
  assert.equal(appealRefusal({ ...parent, status: "in_progress" }, decidedAt), "NOT_APPEALABLE");
  assert.equal(decisionAgainstTenant({ type: "no_show_review", outcome: "rejected", liableParty: null }), true);
  assert.equal(decisionAgainstTenant({ type: "no_show_review", outcome: "approved", liableParty: null }), false);
  assert.equal(decisionAgainstTenant({ type: "lost_and_found", outcome: "resolved", liableParty: null }), false);
});

test("工单号：TK + UTC 日期 + 6 位（不含 I、O）", () => {
  assert.equal(ticketNumber(new Date("2026-10-26T23:59:00Z"), "K3M9Q2"), "TK20261026K3M9Q2");
  assert.throws(() => ticketNumber(new Date(), "K3M9QI"), RangeError);
});
