/**
 * 服务后加收（M3-03，ADR 0029）。纯函数，不碰数据库和网络。
 *
 * 需求：《平台运营端与渠道对接》「服务后加收费用」：
 * 1. 客人付款时用 Stripe 保存支付方式，用于事后扣款；
 * 2. 可加收的只有：包车超时 / 超公里、付费等待、客人现场加的停靠点或附加服务、包车的高速费和停车费（凭票实报）。接送机和点对点为一口价，含高速和停车费；
 * 3. 租户在服务结束 24 小时内提交金额和凭证 → 邮件通知客人，48 小时内可提异议 → 无异议自动扣款；
 * 4. 单笔超过订单对外价 50%、无凭证或客人有异议时，转工单人工审核；
 * 5. 平台订单不允许司机现场收现金。
 * 「财务结算 · 一单的账务分录」：附加费用 应收 + 金额 × (1 + 加价比例)，应付 + 金额，毛利 + 加价部分。
 * 《用车报价服务平台》「8. 订单与履约」：停车费等实报实销的费用必须上传凭证照片；「履约时间点」：服务结束后 24 小时内必须提交完成和附加费用。
 * 第五轮决策 ⑤：事后加收走 Stripe 保存的支付方式；48 小时异议期；平台单不收现金。
 */
import type { ServiceCategory } from "./master-data.ts";
import type { CurrencyCode } from "./money.ts";
import type { OrderStatus } from "./orders.ts";
import { type FxQuote, sellPrice } from "./quote.ts";

/**
 * 加收项的类型：
 * `charter_overtime` 包车超时、`charter_over_km` 包车超公里、`waiting` 付费等待（免费等待之后、客人最终上车的）、
 * `extra_stop` 客人现场加的停靠点、`extra_addon` 客人现场加的附加服务、`toll` 包车的高速费、`parking` 包车的停车费（凭票实报）。
 */
export const EXTRA_CHARGE_TYPES = ["charter_overtime", "charter_over_km", "waiting", "extra_stop", "extra_addon", "toll", "parking"] as const;
export type ExtraChargeType = (typeof EXTRA_CHARGE_TYPES)[number];

export const EXTRA_CHARGE_TYPE_NAMES: Readonly<Record<ExtraChargeType, string>> = {
  charter_overtime: "包车超时",
  charter_over_km: "包车超公里",
  waiting: "付费等待",
  extra_stop: "现场加停靠点",
  extra_addon: "现场加附加服务",
  toll: "高速费（凭票实报）",
  parking: "停车费（凭票实报）",
};

/** 只有包车能收的：超时、超公里、高速费、停车费（接送机和点对点是一口价，含高速和停车费）。 */
const CHARTER_ONLY: readonly ExtraChargeType[] = ["charter_overtime", "charter_over_km", "toll", "parking"];
/** 必须有凭证（票据照片）才能提交的：实报实销的高速费、停车费。 */
const RECEIPT_REQUIRED: readonly ExtraChargeType[] = ["toll", "parking"];

export function extraChargeTypeAllowed(type: ExtraChargeType, category: ServiceCategory): boolean {
  return category === "charter" || !CHARTER_ONLY.includes(type);
}

export function extraChargeNeedsReceipt(type: ExtraChargeType): boolean {
  return RECEIPT_REQUIRED.includes(type);
}

export const EXTRA_CHARGE_RULES = {
  /** 服务结束后多少小时内能提交（正好 24 小时还能交） */
  submitWithinHours: 24,
  /** 客人的异议期（小时），从提交起算 */
  disputeHours: 48,
  /** 单笔超过订单对外价的这个比例（基点）转人工审核（正好 50% 不转） */
  reviewAboveSellBp: 5_000,
  /** 单笔最多是这一单结算价的多少（基点）：超过就不让提交（多半是填错了数量级） */
  maxOfSettlementBp: 10_000,
  /** 一张单最多几项 */
  maxItemsPerOrder: 10,
  /** 一项最多几张凭证照片 */
  maxFilesPerItem: 5,
  /** 说明最长多少个字 */
  descriptionMax: 200,
  /** 客人异议的理由最长多少个字 */
  disputeReasonMax: 500,
  /** 收款服务出错（不是卡被拒）时自动重试几次 */
  maxChargeAttempts: 5,
  /** 自动重试的间隔（分钟） */
  chargeRetryMinutes: 10,
} as const;

/** 转人工审核的原因：超过对外价 50%、没有凭证、客人提了异议。 */
export const EXTRA_CHARGE_REVIEW_REASONS = ["OVER_THRESHOLD", "NO_EVIDENCE", "DISPUTED"] as const;
export type ExtraChargeReviewReason = (typeof EXTRA_CHARGE_REVIEW_REASONS)[number];

export type ExtraChargeSubmitRefusal =
  /** 订单还没完成（或已取消、客人未出现）：只有服务完成后才能加收 */
  | "ORDER_NOT_COMPLETED"
  /** 服务结束超过 24 小时了 */
  | "SUBMIT_WINDOW_CLOSED"
  /** 这一单的品类不能收这一项（接送机、点对点是一口价） */
  | "TYPE_NOT_ALLOWED"
  /** 高速费、停车费没有附票据照片 */
  | "RECEIPT_REQUIRED"
  /** 金额不对：不是正整数，或超过了这一单的结算价 */
  | "AMOUNT_INVALID"
  | "AMOUNT_OVER_LIMIT"
  /** 这一单的加收项已经到上限了 */
  | "TOO_MANY_ITEMS";

export interface ExtraChargeSubmission {
  type: ExtraChargeType;
  amountMinor: number;
  fileCount: number;
}

export interface ExtraChargeOrderFacts {
  status: OrderStatus;
  category: ServiceCategory;
  completedAt: Date | null;
  settlementMinor: number;
  /** 这一单已经有几项（撤回、驳回的不算） */
  existingItems: number;
}

/** 服务结束后的提交期限：完成时间 + 24 小时（含这一刻）。 */
export function extraChargeSubmitDeadline(completedAt: Date): Date {
  return new Date(completedAt.getTime() + EXTRA_CHARGE_RULES.submitWithinHours * 3_600_000);
}

/** 这一项能不能提交；能提交返回 null。 */
export function extraChargeSubmitRefusal(item: ExtraChargeSubmission, order: ExtraChargeOrderFacts, now: Date): ExtraChargeSubmitRefusal | null {
  if (order.status !== "completed" || order.completedAt === null) return "ORDER_NOT_COMPLETED";
  if (now.getTime() > extraChargeSubmitDeadline(order.completedAt).getTime()) return "SUBMIT_WINDOW_CLOSED";
  if (!extraChargeTypeAllowed(item.type, order.category)) return "TYPE_NOT_ALLOWED";
  if (!Number.isSafeInteger(item.amountMinor) || item.amountMinor <= 0) return "AMOUNT_INVALID";
  if (item.amountMinor * 10_000 > order.settlementMinor * EXTRA_CHARGE_RULES.maxOfSettlementBp) return "AMOUNT_OVER_LIMIT";
  if (extraChargeNeedsReceipt(item.type) && item.fileCount === 0) return "RECEIPT_REQUIRED";
  if (order.existingItems >= EXTRA_CHARGE_RULES.maxItemsPerOrder) return "TOO_MANY_ITEMS";
  return null;
}

/**
 * 客人要付多少（客人支付币种）：金额 × 汇率（下单时的快照）×（1 + 汇率缓冲）×（1 + 加价比例），四舍五入到最小货币单位
 * （需求「附加费用：应收 + 金额 × (1 + 加价比例)」；跨币种和订单本身一样加 1.5% 缓冲；不按渠道的取整单位取整、不补最低毛利——那是对整单的规则）。
 */
export function extraChargeCustomerMinor(input: { amountMinor: number; settlementCurrency: CurrencyCode; currency: CurrencyCode; markupBp: number; fxBufferBp: number; fx: FxQuote | null }): number {
  const price = sellPrice({ settlementMinor: input.amountMinor, settlementCurrency: input.settlementCurrency, currency: input.currency, markupBp: input.markupBp, markupFloorBp: 0, fxBufferBp: input.fxBufferBp, fx: input.fx });
  if ("failure" in price) throw new RangeError(`加收金额换算不出客人支付的金额：${price.failure}`);
  return price.sellMinor;
}

/** 提交时就知道要转人工的原因（超过对外价 50%、没有凭证）。客人异议在之后加上。 */
export function extraChargeReviewReasons(customerMinor: number, orderSellMinor: number, fileCount: number): ExtraChargeReviewReason[] {
  const reasons: ExtraChargeReviewReason[] = [];
  if (customerMinor * 10_000 > orderSellMinor * EXTRA_CHARGE_RULES.reviewAboveSellBp) reasons.push("OVER_THRESHOLD");
  if (fileCount === 0) reasons.push("NO_EVIDENCE");
  return reasons;
}

/** 异议期到什么时候：提交（= 通知客人）的那一刻 + 48 小时。到这一刻起不能再提异议，没异议的可以扣款。 */
export function disputeDeadline(submittedAt: Date): Date {
  return new Date(submittedAt.getTime() + EXTRA_CHARGE_RULES.disputeHours * 3_600_000);
}

/** 现在还能不能提异议：还没到异议期截止的那一刻（按毫秒；截止前 1 毫秒可以，截止那一刻不行）。 */
export function disputeOpen(disputeUntil: Date, now: Date): boolean {
  return now.getTime() < disputeUntil.getTime();
}

/**
 * 一项加收的状态：
 * `in_window` 异议期内（不扣款，客人可以提异议、供应商可以撤回）；`review` 待平台审核（超过 50%、没有凭证，异议期结束后）；
 * `disputed` 客人提了异议，待平台审核；`approved` 审核通过（可以部分通过），等扣款；`charging` 正在扣款；`charged` 已扣款；
 * `charge_failed` 扣款失败（卡被拒、需要验证、没有保存的支付方式、重试用完），等财务处理；`rejected` 平台驳回；`withdrawn` 供应商撤回。
 */
export const EXTRA_CHARGE_STATUSES = ["in_window", "review", "disputed", "approved", "charging", "charged", "charge_failed", "rejected", "withdrawn"] as const;
export type ExtraChargeStatus = (typeof EXTRA_CHARGE_STATUSES)[number];

const EXTRA_TRANSITIONS: Readonly<Record<ExtraChargeStatus, readonly ExtraChargeStatus[]>> = {
  // 异议期结束：没有要转人工的原因 → 直接扣款；有 → 待审核。异议期内：客人异议、供应商撤回
  in_window: ["charging", "review", "disputed", "withdrawn"],
  review: ["approved", "rejected"],
  disputed: ["approved", "rejected"],
  approved: ["charging"],
  // 收款服务出错（超时、连不上）回到「等扣款」排下一次；卡被拒、次数用完 → 扣款失败
  charging: ["charged", "charge_failed", "approved"],
  // 财务处理后：重新扣一次，或者不收了（驳回）
  charge_failed: ["charging", "rejected"],
  charged: [],
  rejected: [],
  withdrawn: [],
};

export function extraChargeTransitionAllowed(from: ExtraChargeStatus, to: ExtraChargeStatus): boolean {
  return EXTRA_TRANSITIONS[from].includes(to);
}

/** 异议期结束后这一项去哪：有要转人工的原因 → 待审核；没有 → 自动扣款。 */
export function afterDisputeWindow(reviewReasons: readonly ExtraChargeReviewReason[]): "review" | "charging" {
  return reviewReasons.length > 0 ? "review" : "charging";
}

/** 审核的结论：通过（全额）、部分通过（金额比提交的少）、驳回。 */
export const EXTRA_CHARGE_DECISIONS = ["approve", "reject"] as const;
export type ExtraChargeDecision = (typeof EXTRA_CHARGE_DECISIONS)[number];

/** 审核通过的金额：不填就是提交的金额；部分通过要在 1 和提交的金额之间。不对返回 null。 */
export function approvedExtraChargeAmount(submittedMinor: number, approvedMinor: number | null): number | null {
  if (approvedMinor === null) return submittedMinor;
  return Number.isSafeInteger(approvedMinor) && approvedMinor >= 1 && approvedMinor <= submittedMinor ? approvedMinor : null;
}

/** 收款服务出错（不是卡被拒）后下一次什么时候扣；次数用完返回 null（记为扣款失败）。 */
export function nextChargeAttemptAt(attempts: number, now: Date): Date | null {
  if (attempts >= EXTRA_CHARGE_RULES.maxChargeAttempts) return null;
  return new Date(now.getTime() + EXTRA_CHARGE_RULES.chargeRetryMinutes * 60_000);
}
