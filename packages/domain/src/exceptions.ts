/**
 * 订单异常队列（M4-02，ADR 0034）。纯函数，不碰数据库和网络。
 *
 * 需求：《平台运营端与渠道对接》「订单中心与异常处理 · 异常队列」（系统自动生成，处理完标记关闭；运营每天从异常队列开始工作）。
 * 表里 8 种异常的触发条件、处理方式、时限照搬；另加「救援中」（ADR 0031 的救援改派还没有结论的），让运营在一个队列里看到全部要人处理的单。
 * 「渠道状态回传失败」现在只有推给供应商的 Webhook（ADR 0027）——推给渠道的回传在接入第一个外部分销商时做，到时同一种异常也覆盖它。
 */
import type { OrderStatus } from "./orders.ts";

export const EXCEPTION_TYPES = [
  "dispatch_overdue",
  "departure_overdue",
  "arrival_overdue",
  "push_failed",
  "no_show_review",
  "extra_charge_review",
  "fulfilment_unfinished",
  "payment_issue",
  "rescue",
] as const;
export type ExceptionType = (typeof EXCEPTION_TYPES)[number];

export const EXCEPTION_TYPE_NAMES: Readonly<Record<ExceptionType, string>> = {
  dispatch_overdue: "超时未派车",
  departure_overdue: "司机未出发",
  arrival_overdue: "司机未到达",
  push_failed: "状态推送失败",
  no_show_review: "no-show 待审核",
  extra_charge_review: "附加费用待审核",
  fulfilment_unfinished: "履约未结束",
  payment_issue: "支付异常",
  rescue: "救援中",
};

/** 需求表里的「处理方式」，运营后台照着显示。 */
export const EXCEPTION_HANDLING: Readonly<Record<ExceptionType, string>> = {
  dispatch_overdue: "电话催租户；用车前 6 小时仍未派车，自动进入救援改派",
  departure_overdue: "联系租户和司机",
  arrival_overdue: "联系司机，并主动联系客人；到点 15 分钟仍未到达且联系不上，启动救援改派或请客人自行打车凭票报销",
  push_failed: "技术排查后手工重发",
  no_show_review: "转工单审核",
  extra_charge_review: "审核通过后推送渠道",
  fulfilment_unfinished: "催租户提交",
  payment_issue: "财务核实，必要时取消订单",
  rescue: "按救援流程处理：发救援单、人工指定或取消退款",
};

/**
 * 处理时限（分钟，从系统发现时起算）：立即 = 0；「当天」按 24 小时（ADR 0034 待定事项，待负责人确认）；救援中按「立即」。
 */
export const EXCEPTION_DUE_MINUTES: Readonly<Record<ExceptionType, number>> = {
  dispatch_overdue: 0,
  departure_overdue: 15,
  arrival_overdue: 5,
  push_failed: 120,
  no_show_review: 24 * 60,
  extra_charge_review: 24 * 60,
  fulfilment_unfinished: 24 * 60,
  payment_issue: 24 * 60,
  rescue: 0,
};

export function exceptionDueAt(type: ExceptionType, openedAt: Date): Date {
  return new Date(openedAt.getTime() + EXCEPTION_DUE_MINUTES[type] * 60_000);
}

export function exceptionOverdue(dueAt: Date, now: Date): boolean {
  return now.getTime() > dueAt.getTime();
}

/** 支付异常的几种原因：退款失败（重试耗尽或被拒）、事后加收扣款失败、拒付、订单取消后才付到钱。 */
export const PAYMENT_ISSUE_REASONS = ["refund_failed", "charge_failed", "chargeback", "paid_after_cancel"] as const;
export type PaymentIssueReason = (typeof PAYMENT_ISSUE_REASONS)[number];

// ---- 状态 ----

/** `open` 待处理 / `claimed` 已认领（有人在处理）/ `closed` 已关闭（人工处理完，或条件已解除由系统关闭）。 */
export const EXCEPTION_STATUSES = ["open", "claimed", "closed"] as const;
export type ExceptionStatus = (typeof EXCEPTION_STATUSES)[number];

export const EXCEPTION_STATUS_NAMES: Readonly<Record<ExceptionStatus, string>> = { open: "待处理", claimed: "处理中", closed: "已关闭" };

/** 关闭方式：人工处理完（`resolved`，说明必填）/ 条件已解除（`cleared`，系统发现已经派车、已经退成功等，自动关闭）。 */
export const EXCEPTION_CLOSE_KINDS = ["resolved", "cleared"] as const;
export type ExceptionCloseKind = (typeof EXCEPTION_CLOSE_KINDS)[number];

export type ExceptionActionRefusal = "EXCEPTION_CLOSED";

/** 认领（含转给别人）、关闭：已关闭的不能再动。 */
export function exceptionActionRefusal(status: ExceptionStatus): ExceptionActionRefusal | null {
  return status === "closed" ? "EXCEPTION_CLOSED" : null;
}

// ---- 触发条件里用到的时间点 ----

export const EXCEPTION_RULES = {
  /** 履约未结束：服务结束 24 小时后仍未「已完成」 */
  unfinishedHoursAfterService: 24,
  /** 推送失败只看最近这么多天的（更早的失败多半早已处理，订单也已结束） */
  pushFailureLookbackDays: 7,
} as const;

/** 还在履约中（派了车、还没完成）的状态：服务结束 24 小时后还在这些状态就是「履约未结束」。 */
export const UNFINISHED_STATUSES: readonly OrderStatus[] = ["assigned", "departed", "arrived", "in_service"];

/** 「履约未结束」的触发时刻：预计服务结束（包车按套餐时长）+ 24 小时。 */
export function fulfilmentUnfinishedAt(serviceEndAt: Date): Date {
  return new Date(serviceEndAt.getTime() + EXCEPTION_RULES.unfinishedHoursAfterService * 3_600_000);
}
