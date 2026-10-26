/**
 * 救援改派与违约金在页面上的说法（M3-04，ADR 0031）；M4-03 起应扣款项多两种：客人赔付、替代交通报销（工单判定，ADR 0034）。规则（阶梯、期限）用 @nozomi/domain 的同一份，页面不另写一套。
 */
import {
  COMPENSATION_SCENARIO_NAMES,
  DEDUCTION_KIND_NAMES,
  DEDUCTION_STATUS_NAMES,
  type DeductionKind,
  type DeductionStatus,
  type PenaltyTier,
  RESCUE_OFFER_STATUS_NAMES,
  RESCUE_STATUS_NAMES,
  RESCUE_TRIGGER_NAMES,
  type RescueOfferStatus,
  type RescueStatus,
  type RescueTrigger,
  formatMajor,
  isCurrencyCode,
  parseMajor,
  rescuePenalty,
  rescuePenaltyMinor,
} from "@nozomi/domain";
import type { Money } from "../api/dispatch.ts";
import type { DeductionBasis } from "../api/rescues.ts";
import type { BadgeSpec } from "../components/StatusBadge.tsx";
import { basisPointsText } from "./adjust-form.ts";
import { moneyText } from "./dispatch-display.ts";

export const RESCUE_QUEUE_PATH = "/platform/rescues";
export const RESCUE_OFFERS_PATH = "/rescue-offers";
export const DEDUCTIONS_PATH = "/deductions";

export function triggerName(trigger: RescueTrigger | null): string {
  return trigger === null ? "—" : RESCUE_TRIGGER_NAMES[trigger];
}

/** 救援的状态：要运营动手的（待处理、候选都不接）是危险 / 警告色，等供应商接单是信息色，有结论的中性 / 成功。 */
export const RESCUE_STATUS_BADGES: Readonly<Record<RescueStatus, BadgeSpec>> = {
  open: { tone: "danger", label: RESCUE_STATUS_NAMES.open },
  offering: { tone: "info", label: RESCUE_STATUS_NAMES.offering },
  exhausted: { tone: "warning", label: RESCUE_STATUS_NAMES.exhausted },
  rescued: { tone: "success", label: RESCUE_STATUS_NAMES.rescued },
  cancelled: { tone: "neutral", label: RESCUE_STATUS_NAMES.cancelled },
};

export const OFFER_STATUS_BADGES: Readonly<Record<RescueOfferStatus, BadgeSpec>> = {
  pending: { tone: "warning", label: RESCUE_OFFER_STATUS_NAMES.pending },
  accepted: { tone: "success", label: RESCUE_OFFER_STATUS_NAMES.accepted },
  declined: { tone: "neutral", label: RESCUE_OFFER_STATUS_NAMES.declined },
  expired: { tone: "neutral", label: RESCUE_OFFER_STATUS_NAMES.expired },
  withdrawn: { tone: "neutral", label: RESCUE_OFFER_STATUS_NAMES.withdrawn },
};

export const DEDUCTION_STATUS_BADGES: Readonly<Record<DeductionStatus, BadgeSpec>> = {
  pending: { tone: "warning", label: DEDUCTION_STATUS_NAMES.pending },
  waived: { tone: "neutral", label: DEDUCTION_STATUS_NAMES.waived },
};

export function deductionKindName(kind: DeductionKind): string {
  return DEDUCTION_KIND_NAMES[kind];
}

const TIER_TEXT: Readonly<Record<PenaltyTier, string>> = { none: "0（用车前 24 小时以上）", partial: "原结算价的 30%（用车前 2–24 小时）", full: "原结算价的 100%" };

/** 违约金阶梯的一句话：「原结算价的 30%（用车前 2–24 小时）」。 */
export function penaltyText(tier: PenaltyTier | null): string {
  return tier === null ? "—" : TIER_TEXT[tier];
}

/** 一条应扣款项是怎么算的。 */
export function deductionBasisText(kind: DeductionKind, basis: DeductionBasis, currency: string): string {
  const money = (minor: number | undefined): string => (minor === undefined || !isCurrencyCode(currency) ? "—" : moneyText({ amount: formatMajor(minor, currency), currency }));
  if (kind === "penalty") return `${triggerName(basis.trigger ?? null)}：原结算价 ${money(basis.settlement_minor)} × ${basisPointsText(basis.bp ?? 0)}%`;
  const scenario = basis.scenario === undefined ? "" : COMPENSATION_SCENARIO_NAMES[basis.scenario];
  const ticket = basis.ticket_no === undefined ? "" : `工单 ${basis.ticket_no}`;
  if (kind === "compensation") {
    const difference = basis.downgrade_settlement_difference_minor ?? 0;
    return `${[ticket, scenario].filter(Boolean).join(" · ")}：结算价 ${money(basis.settlement_minor)} × ${basisPointsText(basis.bp ?? 0)}%${difference > 0 ? ` + 车型差价 ${money(difference)}` : ""}`;
  }
  if (kind === "reimbursement") return `${[ticket, scenario].filter(Boolean).join(" · ")}：客人凭票报销的替代交通，全部由供应商承担${basis.same_currency === false ? "（按订单报价时的汇率换成结算币种）" : ""}`;
  const raw = basis.raw_minor ?? 0;
  return `救援结算价${basis.same_currency === false ? "（按两边报价时的汇率换算）" : ""} ${money(basis.rescue_in_original_minor)} − 原结算价 ${money(basis.original_minor)}${raw < 0 ? "，为负记 0" : ""}`;
}

export interface PenaltyPreview {
  tier: PenaltyTier;
  bp: number;
  amount: string;
}

/** 供应商「现在声明无法履约」会落在哪一档、违约金多少（和后端同一个函数算；按点按钮那一刻的时间，提交时以服务器时间为准）。 */
export function declarePenaltyPreview(serviceTime: string, now: Date, settlement: Money): PenaltyPreview | null {
  if (!isCurrencyCode(settlement.currency)) return null;
  const penalty = rescuePenalty("tenant_declared", new Date(serviceTime), now);
  const minor = rescuePenaltyMinor(parseMajor(settlement.amount, settlement.currency), penalty.bp);
  return { tier: penalty.tier, bp: penalty.bp, amount: moneyText({ amount: formatMajor(minor, settlement.currency), currency: settlement.currency }) };
}

/** 救援单还剩多久：「还剩 12 分钟」；到期了是「已过期」。 */
export function offerRemainingText(expiresAt: string, now: Date): string {
  const ms = new Date(expiresAt).getTime() - now.getTime();
  if (ms <= 0) return "已过期";
  const minutes = Math.floor(ms / 60_000);
  return minutes >= 1 ? `还剩 ${minutes} 分钟` : `还剩 ${Math.ceil(ms / 1_000)} 秒`;
}

/** 运营能发起的情形和要写清楚的说明。 */
export const PLATFORM_TRIGGER_HINTS: Readonly<Record<RescueTrigger, string>> = {
  tenant_declared: "供应商来电说接不了：写清楚是谁、什么时候说的、什么原因",
  dispatch_overdue: "用车前 6 小时仍未派车（系统每分钟会自动发起；没到时间不能发起）",
  driver_no_show: "到点 15 分钟司机仍未到达、联系不上：写清楚联系了谁、几次",
  tenant_suspended: "供应商在暂停中、这是它的未来订单",
};
