/**
 * 工单（M4-02，ADR 0034）。纯函数，不碰数据库和网络。
 *
 * 需求：《平台运营端与渠道对接》「客服与工单」（所有需要人来判断的事都走工单，工单绑定订单；7 种类型、发起方、处理结果；
 * 流转：创建 → 分派 → 征求租户意见（24 小时内回复，超时视为认可）→ 判定（金额超过阈值需主管复核）→ 执行 → 关闭（租户可在 7 天内申诉一次）；
 * 时效目标：首次响应 ≤ 2 小时，用车当天的紧急工单 ≤ 15 分钟，一般工单 3 个工作日内结案）、
 * 「履约保障与服务标准」（no-show 待审核转工单；客人赔付表；投诉时限：服务后 14 天内，租户 24 小时内回复，平台 3 个工作日内判定）。
 */
import { instantToLocal } from "./service-time.ts";

// ---- 类型、来源、优先级 ----

/**
 * 工单类型。需求的「附加费用审核」沿用 ADR 0029 在订单详情里审（异常队列列出待审核的），不另设工单类型；
 * 多一种「其他」给不属于以上任何一类、但需要人跟进的事。
 */
export const TICKET_TYPES = ["complaint", "no_show_review", "fulfilment_failure", "order_change", "lost_and_found", "tenant_appeal", "other"] as const;
export type TicketType = (typeof TICKET_TYPES)[number];

export const TICKET_TYPE_NAMES: Readonly<Record<TicketType, string>> = {
  complaint: "客人投诉",
  no_show_review: "no-show 审核",
  fulfilment_failure: "履约失败",
  order_change: "修改订单",
  lost_and_found: "失物招领",
  tenant_appeal: "租户申诉",
  other: "其他",
};

/** 谁提出的：客人（官网订单页）、渠道（接口）、租户（供应商后台）、平台（客服手工）、系统（自动生成）。 */
export const TICKET_SOURCES = ["guest", "channel", "tenant", "platform", "system"] as const;
export type TicketSource = (typeof TICKET_SOURCES)[number];

/** 每种来源能建哪几类（需求「工单类型」表的发起方）。客服可以代客人、渠道、供应商登记（来源照实选）。 */
export const TICKET_TYPES_BY_SOURCE: Readonly<Record<TicketSource, readonly TicketType[]>> = {
  guest: ["complaint", "order_change", "lost_and_found", "other"],
  channel: ["complaint", "order_change", "lost_and_found", "other"],
  tenant: ["tenant_appeal", "lost_and_found", "other"],
  platform: ["complaint", "fulfilment_failure", "order_change", "lost_and_found", "other"],
  system: ["no_show_review"],
};

export function ticketTypeAllowed(source: TicketSource, type: TicketType): boolean {
  return TICKET_TYPES_BY_SOURCE[source].includes(type);
}

export const TICKET_PRIORITIES = ["urgent", "high", "normal", "low"] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const TICKET_PRIORITY_NAMES: Readonly<Record<TicketPriority, string>> = { urgent: "紧急", high: "高", normal: "普通", low: "低" };

export const TICKET_RULES = {
  /** 首次响应：一般 2 小时，紧急（用车当天）15 分钟 */
  firstResponseMinutes: 120,
  urgentFirstResponseMinutes: 15,
  /** 结案：3 个工作日（周一到周五，按平台所在地的日历；不扣节假日，见 ADR 0034） */
  resolutionBusinessDays: 3,
  businessTimeZone: "Asia/Tokyo",
  /** 征求租户意见：24 小时内回复，超时视为认可 */
  tenantReplyHours: 24,
  /** 判定后租户可在 7 天内申诉一次 */
  appealDays: 7,
  subjectMax: 200,
  bodyMax: 4000,
  noteMax: 1000,
  /** 一条留言最多带几张订单里的照片作证据 */
  maxFilesPerMessage: 10,
} as const;

/**
 * 默认优先级：用车当天（城市当地日期，含已经过了用车时间的当天）的单是紧急；no-show 审核是高（订单卡在待审核）；其余普通。
 * 建工单的人可以另外指定。
 */
export function defaultTicketPriority(type: TicketType, order: { serviceDate: string; timeZone: string }, now: Date): TicketPriority {
  if (instantToLocal(now, order.timeZone).date === order.serviceDate) return "urgent";
  return type === "no_show_review" ? "high" : "normal";
}

/** 首次响应的期限。 */
export function firstResponseDueAt(priority: TicketPriority, createdAt: Date): Date {
  const minutes = priority === "urgent" ? TICKET_RULES.urgentFirstResponseMinutes : TICKET_RULES.firstResponseMinutes;
  return new Date(createdAt.getTime() + minutes * 60_000);
}

/**
 * 结案期限：从创建起数 3 个工作日（周一到周五）：创建时刻往后一天一天地加 24 小时，落在周六、周日（平台所在地）的那一天不计数。
 * 周五下午建的工单，期限是下周三下午。
 */
export function resolutionDueAt(createdAt: Date, businessDays: number = TICKET_RULES.resolutionBusinessDays): Date {
  let at = createdAt.getTime();
  let counted = 0;
  while (counted < businessDays) {
    at += 86_400_000;
    const weekday = new Date(`${instantToLocal(new Date(at), TICKET_RULES.businessTimeZone).date}T00:00:00Z`).getUTCDay();
    if (weekday !== 0 && weekday !== 6) counted += 1;
  }
  return new Date(at);
}

export function tenantReplyDueAt(requestedAt: Date): Date {
  return new Date(requestedAt.getTime() + TICKET_RULES.tenantReplyHours * 3_600_000);
}

// ---- 状态 ----

/**
 * - `open` 待处理：刚建，还没人处理；
 * - `awaiting_tenant` 等租户回复（24 小时）；
 * - `in_progress` 处理中（有人认领、租户回复了、复核被驳回退回）；
 * - `pending_review` 判定待复核（赔给客人的钱超过阈值，双人复核）；
 * - `decided` 已判定（结论已执行；租户 7 天内可以申诉一次）；
 * - `closed` 已关闭（终态）。
 */
export const TICKET_STATUSES = ["open", "awaiting_tenant", "in_progress", "pending_review", "decided", "closed"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_STATUS_NAMES: Readonly<Record<TicketStatus, string>> = {
  open: "待处理",
  awaiting_tenant: "等租户回复",
  in_progress: "处理中",
  pending_review: "判定待复核",
  decided: "已判定",
  closed: "已关闭",
};

const TICKET_TRANSITIONS: Readonly<Record<TicketStatus, readonly TicketStatus[]>> = {
  open: ["awaiting_tenant", "in_progress", "pending_review", "decided", "closed"],
  awaiting_tenant: ["in_progress", "pending_review", "decided", "closed"],
  in_progress: ["awaiting_tenant", "pending_review", "decided", "closed"],
  pending_review: ["decided", "in_progress"],
  decided: ["closed"],
  closed: [],
};

export function ticketTransitionAllowed(from: TicketStatus, to: TicketStatus): boolean {
  return TICKET_TRANSITIONS[from].includes(to);
}

/** 还没有结论的（判定之前）：可以认领、留言、征求租户意见、判定。 */
export function ticketActive(status: TicketStatus): boolean {
  return status === "open" || status === "awaiting_tenant" || status === "in_progress";
}

// ---- 判定 ----

/** 每种工单可选的结论。 */
export const TICKET_OUTCOMES = {
  complaint: ["upheld", "rejected"],
  fulfilment_failure: ["upheld", "rejected"],
  no_show_review: ["approved", "rejected"],
  tenant_appeal: ["upheld", "rejected"],
  order_change: ["resolved"],
  lost_and_found: ["resolved"],
  other: ["resolved"],
} as const satisfies Record<TicketType, readonly string[]>;

export type TicketOutcome = "upheld" | "rejected" | "approved" | "resolved";

export function ticketOutcomeAllowed(type: TicketType, outcome: TicketOutcome): boolean {
  return (TICKET_OUTCOMES[type] as readonly string[]).includes(outcome);
}

/** 成立时要带赔付（按赔付表算）的：投诉成立、履约失败成立。 */
export function outcomeNeedsCompensation(type: TicketType, outcome: TicketOutcome): boolean {
  return (type === "complaint" || type === "fulfilment_failure") && outcome === "upheld";
}

export type TicketDecisionRefusal = "TICKET_STATE_INVALID" | "TENANT_REPLY_PENDING" | "OUTCOME_NOT_ALLOWED";

/**
 * 能不能判定：只有还没结论的；等租户回复的，要等租户回复或者 24 小时过了（「超时视为认可」——期限那一刻起可以判）。
 */
export function ticketDecisionRefusal(ticket: { type: TicketType; status: TicketStatus; tenantReplyDueAt: Date | null }, outcome: TicketOutcome, now: Date): TicketDecisionRefusal | null {
  if (!ticketActive(ticket.status)) return "TICKET_STATE_INVALID";
  if (!ticketOutcomeAllowed(ticket.type, outcome)) return "OUTCOME_NOT_ALLOWED";
  if (ticket.status === "awaiting_tenant" && ticket.tenantReplyDueAt !== null && now.getTime() < ticket.tenantReplyDueAt.getTime()) return "TENANT_REPLY_PENDING";
  return null;
}

/**
 * 能不能关闭：判定过的可以关；没判定的只有不影响订单和账的几类可以直接关（重复、撤回）——
 * no-show 审核不判定订单就一直卡在待审核，不能直接关；复核中的不能关。
 */
export function ticketCloseRefusal(ticket: { type: TicketType; status: TicketStatus }): "TICKET_STATE_INVALID" | "DECISION_REQUIRED" | null {
  if (ticket.status === "decided") return null;
  if (!ticketActive(ticket.status)) return "TICKET_STATE_INVALID";
  return ticket.type === "no_show_review" ? "DECISION_REQUIRED" : null;
}

// ---- 申诉 ----

/** 判定对租户不利（可以申诉）的结论：投诉 / 履约失败成立且责任在租户、no-show 被驳回。 */
export function decisionAgainstTenant(ticket: { type: TicketType; outcome: TicketOutcome | null; liableParty: "tenant" | "platform" | null }): boolean {
  if (ticket.type === "no_show_review") return ticket.outcome === "rejected";
  if (ticket.type === "complaint" || ticket.type === "fulfilment_failure") return ticket.outcome === "upheld" && ticket.liableParty === "tenant";
  return false;
}

export function appealDeadline(decidedAt: Date): Date {
  return new Date(decidedAt.getTime() + TICKET_RULES.appealDays * 86_400_000);
}

export type AppealRefusal = "NOT_APPEALABLE" | "APPEAL_WINDOW_CLOSED";

/** 租户能不能对这张工单申诉：判定过、对它不利、判定后 7 天内（正好 7 天还行）。「一次」由数据库唯一约束保证。 */
export function appealRefusal(parent: { type: TicketType; status: TicketStatus; outcome: TicketOutcome | null; liableParty: "tenant" | "platform" | null; decidedAt: Date | null }, now: Date): AppealRefusal | null {
  if ((parent.status !== "decided" && parent.status !== "closed") || parent.decidedAt === null || !decisionAgainstTenant(parent)) return "NOT_APPEALABLE";
  return now.getTime() <= appealDeadline(parent.decidedAt).getTime() ? null : "APPEAL_WINDOW_CLOSED";
}

// ---- 工单号 ----

/** `TK` + 创建日期（UTC，年月日）+ 6 位随机字符（数字和大写字母，不含 I、O），如 `TK20261026K3M9Q2`。全平台唯一（数据库唯一约束兜底）。 */
export const TICKET_NO_PATTERN = /^TK\d{8}[0-9A-HJ-NP-Z]{6}$/;

export function ticketNumber(createdAt: Date, random: string): string {
  if (!/^[0-9A-HJ-NP-Z]{6}$/.test(random)) throw new RangeError("工单号的随机部分应当是 6 位数字或大写字母（不含 I、O）");
  return `TK${createdAt.toISOString().slice(0, 10).replaceAll("-", "")}${random}`;
}
