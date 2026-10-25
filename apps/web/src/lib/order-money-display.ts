/**
 * 取消、改单、事后加收、取消政策在页面上的说法（M3-03，ADR 0029）。
 */
import {
  EXTRA_CHARGE_TYPE_NAMES,
  type ExtraChargeStatus,
  type ExtraChargeType,
  ORDER_CANCEL_REASON_NAMES,
  type OrderCancelReason,
  type OrderChangeStatus,
  type RefundStatus,
  type ServiceCategory,
  VEHICLE_LEVEL_NAMES,
  type VehicleLevel,
  isCurrencyCode,
  parseMajor,
} from "@nozomi/domain";
import type { CancelTier } from "../api/order-money.ts";
import { tidyAmountText } from "./amount-input.ts";
import type { BadgeSpec } from "../components/StatusBadge.tsx";

export const POLICY_PAGE_PATH = "/platform/cancellation-policy";
export const PLATFORM_ORDER_LIST_PATH = "/platform/orders";

export function platformOrderPath(id: string): string {
  return `${PLATFORM_ORDER_LIST_PATH}/${encodeURIComponent(id)}`;
}

export const POLICY_CATEGORY_NAMES: Readonly<Record<ServiceCategory, string>> = { airport_transfer: "接送机", point_to_point: "点对点", charter: "包车" };

export function levelName(level: VehicleLevel): string {
  return VEHICLE_LEVEL_NAMES[level];
}

const percent = (bp: number): string => `${Number.isInteger(bp / 100) ? bp / 100 : (bp / 100).toFixed(2)}%`;
const feeText = (bp: number): string => (bp === 0 ? "免费" : `扣 ${percent(bp)}`);

/**
 * 一条阶梯写成一句话：「用车前 ≥ 48 小时 免费；24–48 小时 扣 50%；< 24 小时 扣 100%」。
 * 每档的意思是「距用车不少于 N 小时」；后一档的上限就是前一档的下限。
 */
export function tiersText(tiers: readonly CancelTier[]): string {
  return tiers
    .map((tier, index) => {
      const upper = index === 0 ? null : (tiers[index - 1] as CancelTier).min_hours_before;
      const range = upper === null ? (tier.min_hours_before === 0 ? "任何时候" : `用车前 ≥ ${tier.min_hours_before} 小时`) : tier.min_hours_before === 0 ? `< ${upper} 小时` : `${tier.min_hours_before}–${upper} 小时`;
      return `${range} ${feeText(tier.fee_bp)}`;
    })
    .join("；");
}

export function cancelReasonName(reason: OrderCancelReason | string | null): string {
  if (reason === null) return "—";
  return ORDER_CANCEL_REASON_NAMES[reason as OrderCancelReason] ?? reason;
}

/** 运营代取消能选的原因（付款前的两种只由系统用）。 */
export const PLATFORM_CANCEL_REASONS: readonly OrderCancelReason[] = ["GUEST_REQUEST", "FLIGHT_CANCELLED", "FORCE_MAJEURE", "SUPPLIER_FAULT", "PLATFORM_FAULT", "CHANGE_NOT_CONFIRMED"];

export const CHANGE_STATUS_BADGES: Readonly<Record<OrderChangeStatus, BadgeSpec>> = {
  awaiting_payment: { tone: "info", label: "补差价中" },
  pending_confirmation: { tone: "warning", label: "等供应商确认" },
  applied: { tone: "success", label: "已生效" },
  rejected: { tone: "danger", label: "供应商拒绝" },
  expired: { tone: "neutral", label: "超时没确认" },
  failed: { tone: "danger", label: "差价没扣到" },
  cancelled: { tone: "neutral", label: "已作废" },
};

export const EXTRA_STATUS_BADGES: Readonly<Record<ExtraChargeStatus, BadgeSpec>> = {
  in_window: { tone: "info", label: "异议期内" },
  review: { tone: "warning", label: "待平台审核" },
  disputed: { tone: "warning", label: "客人有异议" },
  approved: { tone: "info", label: "等扣款" },
  charging: { tone: "info", label: "扣款中" },
  charged: { tone: "success", label: "已扣款" },
  charge_failed: { tone: "danger", label: "扣款失败" },
  rejected: { tone: "neutral", label: "已驳回" },
  withdrawn: { tone: "neutral", label: "已撤回" },
};

export const REFUND_STATUS_BADGES: Readonly<Record<RefundStatus, BadgeSpec>> = {
  pending: { tone: "info", label: "等着发" },
  processing: { tone: "info", label: "处理中" },
  succeeded: { tone: "success", label: "已退" },
  failed: { tone: "danger", label: "失败" },
};

export function extraTypeName(type: ExtraChargeType): string {
  return EXTRA_CHARGE_TYPE_NAMES[type];
}

export const REVIEW_REASON_NAMES: Readonly<Record<string, string>> = { OVER_THRESHOLD: "超过对外价 50%", NO_EVIDENCE: "没有凭证", DISPUTED: "客人提了异议" };

/** 每种品类能加收的类型（和后端同一份规则：接送机、点对点是一口价，只有付费等待、加停靠点、加附加服务）。 */
export function extraTypesFor(category: ServiceCategory): ExtraChargeType[] {
  const all: ExtraChargeType[] = ["charter_overtime", "charter_over_km", "waiting", "extra_stop", "extra_addon", "toll", "parking"];
  return category === "charter" ? all : ["waiting", "extra_stop", "extra_addon"];
}

/** 改单里改了的字段的名字。 */
export const CHANGE_FIELD_NAMES: Readonly<Record<string, string>> = {
  passenger: "乘客",
  flight_no: "航班号",
  messaging: "即时通讯",
  notes: "备注",
  pickup_address: "上车点地址",
  dropoff_address: "下车点地址",
  service_time: "用车时间",
  passengers: "人数",
  luggage: "行李",
};

/** 改单里一个字段的值写成文字（改前改后对比用）。 */
export function changeValueText(field: string, value: unknown, timeZone: string): string {
  if (value === null || value === undefined || value === "") return "—";
  if (field === "service_time" && typeof value === "string") return new Intl.DateTimeFormat("zh-CN", { timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  if (field === "passenger" && typeof value === "object") {
    const passenger = value as { name?: string; phone?: string; email?: string };
    return [passenger.name, passenger.phone, passenger.email].filter(Boolean).join(" · ");
  }
  if (field === "messaging" && typeof value === "object") {
    const messaging = value as { app?: string; handle?: string };
    return `${messaging.app ?? ""}：${messaging.handle ?? ""}`;
  }
  return String(value);
}

/**
 * 金额输入框（主单位，如「2,000」「¥2000」「12.50」）→ 最小货币单位整数；写法不对、不是正数返回 null。
 * 写法的整理和价格表同一个（lib/amount-input.ts），换算用 @nozomi/domain 的 parseMajor（和后端同口径）。
 */
export function amountToMinor(text: string, currency: string): number | null {
  if (!isCurrencyCode(currency)) return null;
  const tidy = tidyAmountText(text, currency);
  if (!tidy.ok) return null;
  try {
    const minor = parseMajor(tidy.text, currency);
    return minor > 0 ? minor : null;
  } catch {
    return null;
  }
}
