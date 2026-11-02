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
  type PaymentStatus,
  type RefundStatus,
  type ServiceCategory,
  VEHICLE_LEVEL_NAMES,
  type VehicleLevel,
  isCurrencyCode,
  parseMajor,
} from "@nozomi/domain";
import type { CancelTier, OrderTodo } from "../api/order-money.ts";
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

/** 状态流水里值得写出来的原因（中文）。其余的（派车、出发、到达……状态变化本身就说明了）不写，也不把代码原样给人看（M4-19）。 */
const ORDER_EVENT_NOTES: Readonly<Record<string, string>> = {
  REASSIGNED: "改派",
  CHANGED: "改单",
  CHANGE_REQUESTED: "客人申请修改",
  CHANGE_ADJUSTING: "修改调整中",
  CHANGE_REJECTED: "修改被拒绝",
  CHANGE_EXPIRED: "修改没有确认",
  NO_SHOW_APPROVED: "审核通过",
  RESCUE_TRIGGERED: "发起救援",
  RESCUED: "转给救援供应商",
  RESCUE_ASSIGNED: "救援接单",
  DRIVER_MISSING_REPORTED: "客人报告司机未到",
  EXTRA_CHARGE_DISPUTED: "客人对加收提异议",
};

/** 状态流水一行后面的括号：取消写取消原因，其余按上表；没有要说的返回空串。 */
export function orderEventNote(event: { to_status: string; reason: string | null }, paid: boolean): string {
  if (event.reason === null) return "";
  if (event.to_status === "cancelled") return `（${orderCancelReasonText(event.reason, paid)}）`;
  const note = ORDER_EVENT_NOTES[event.reason];
  return note === undefined ? "" : `（${note}）`;
}

/** 订单上的取消原因：没付过款就取消的单不涉及扣款，「客人取消」不写「按取消政策扣款」（和官网「您取消了订单」一致，M4-10）。 */
export function orderCancelReasonText(reason: OrderCancelReason | string | null, paid: boolean): string {
  if (!paid && reason === "GUEST_REQUEST") return "客人取消了订单";
  return cancelReasonName(reason);
}

/** 运营代取消能选的原因（付款前的两种只由系统用）。 */
export const PLATFORM_CANCEL_REASONS: readonly OrderCancelReason[] = ["GUEST_REQUEST", "FLIGHT_CANCELLED", "FORCE_MAJEURE", "SUPPLIER_FAULT", "PLATFORM_FAULT", "CHANGE_NOT_CONFIRMED"];

/** 收款记录的状态（`PAYMENT_STATUSES` 每一个都要有中文名）。 */
export const PAYMENT_STATUS_NAMES: Readonly<Record<PaymentStatus, string>> = {
  creating: "正在建付款",
  requires_payment: "等客人付款",
  processing: "付款处理中",
  succeeded: "已付款",
  canceled: "已作废（没有付款）",
  failed: "扣款失败",
};

export function paymentStatusName(status: string): string {
  return PAYMENT_STATUS_NAMES[status as PaymentStatus] ?? status;
}

export const CHANGE_STATUS_BADGES: Readonly<Record<OrderChangeStatus, BadgeSpec>> = {
  awaiting_payment: { tone: "info", label: "补差价中" },
  pending_confirmation: { tone: "warning", label: "修改待确认" },
  adjusting: { tone: "info", label: "调整中" },
  applied: { tone: "success", label: "已生效" },
  rejected: { tone: "danger", label: "已拒绝" },
  expired: { tone: "neutral", label: "超时没确认" },
  failed: { tone: "danger", label: "差价没扣到" },
  cancelled: { tone: "neutral", label: "已作废" },
};

/** 待办的说法（ADR 0060）。 */
export const ORDER_TODO_NAMES: Readonly<Record<OrderTodo["kind"], string>> = {
  change_request: "客人申请修改，等你处理",
  contact_changed: "客人改了联系信息，已生效",
  change_applied: "修改已生效",
  change_expired: "修改没有通过（超时或平台代为拒绝）",
  order_cancelled: "订单已取消",
  rescue_started: "订单进入救援改派",
};

/** 这条待办里司机那边要怎么办；不用管司机时返回 null。 */
export function orderTodoDriverText(todo: Pick<OrderTodo, "needs_driver_adjustment" | "driver_name" | "driver_notice">): string | null {
  if (!todo.needs_driver_adjustment || todo.driver_name === null) return null;
  if (todo.driver_notice === "no_email") return `需调整司机：${todo.driver_name} 没有邮箱，系统通知不到，请马上联系他。`;
  if (todo.driver_notice === "manual") return `需调整司机：你们设置了手动发送，系统没有给 ${todo.driver_name} 发邮件，请马上联系他。`;
  return `需调整司机：系统已发邮件给 ${todo.driver_name}，请确认他已经知道。`;
}

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
