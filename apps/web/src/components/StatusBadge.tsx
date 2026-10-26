/**
 * 状态徽标（docs/design/02-components.md 第 7 节）：颜色 + 圆点 + 写出状态名的文字。
 * 每个业务对象的「状态 → 颜色 → 文字」对照表集中放在这个文件里，页面不各自决定。
 */
import { DRIVER_STATUS_NAMES, type DriverStatus, ORDER_STATUS_NAMES, type OrderStatus, VEHICLE_STATUS_NAMES, type VehicleStatus } from "@nozomi/domain";
import type { TenantStatus } from "../api/types.ts";

export type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger";

export interface BadgeSpec {
  tone: BadgeTone;
  label: string;
}

/** 租户状态。「已暂停」= 被平台暂停、商品不参与比价但仍要履约已有订单，需要留意，用警告色。 */
export const TENANT_STATUS_BADGES: Readonly<Record<TenantStatus, BadgeSpec>> = {
  active: { tone: "success", label: "正常" },
  suspended: { tone: "warning", label: "已暂停" },
};

export function StatusBadge({ tone, label }: BadgeSpec) {
  return (
    <span className={`badge badge--${tone}`}>
      <span className="badge__dot" aria-hidden="true" />
      {label}
    </span>
  );
}

/** 订单状态（M3-02）：要供应商去做事的（已确认待派车）是提示色；在路上的是信息色；结束的是中性 / 成功；客人未出现、救援是警告；取消是中性。 */
export const ORDER_STATUS_BADGES: Readonly<Record<OrderStatus, BadgeSpec>> = {
  pending_payment: { tone: "neutral", label: ORDER_STATUS_NAMES.pending_payment },
  confirmed: { tone: "warning", label: "待派车" },
  assigned: { tone: "info", label: ORDER_STATUS_NAMES.assigned },
  departed: { tone: "info", label: ORDER_STATUS_NAMES.departed },
  arrived: { tone: "info", label: ORDER_STATUS_NAMES.arrived },
  in_service: { tone: "info", label: ORDER_STATUS_NAMES.in_service },
  completed: { tone: "success", label: ORDER_STATUS_NAMES.completed },
  no_show_claimed: { tone: "warning", label: ORDER_STATUS_NAMES.no_show_claimed },
  no_show: { tone: "neutral", label: ORDER_STATUS_NAMES.no_show },
  cancelled: { tone: "neutral", label: ORDER_STATUS_NAMES.cancelled },
  rescue_pending: { tone: "danger", label: ORDER_STATUS_NAMES.rescue_pending },
};

export const DRIVER_STATUS_BADGES: Readonly<Record<DriverStatus, BadgeSpec>> = {
  active: { tone: "success", label: DRIVER_STATUS_NAMES.active },
  disabled: { tone: "neutral", label: DRIVER_STATUS_NAMES.disabled },
};

export const VEHICLE_STATUS_BADGES: Readonly<Record<VehicleStatus, BadgeSpec>> = {
  available: { tone: "success", label: VEHICLE_STATUS_NAMES.available },
  maintenance: { tone: "warning", label: VEHICLE_STATUS_NAMES.maintenance },
  disabled: { tone: "neutral", label: VEHICLE_STATUS_NAMES.disabled },
};

/** 推给供应商的 Webhook 的投递状态：最终失败是异常（危险色，等人工重推）。 */
export const DELIVERY_STATUS_BADGES: Readonly<Record<"pending" | "succeeded" | "failed", BadgeSpec>> = {
  pending: { tone: "info", label: "等待投递" },
  succeeded: { tone: "success", label: "成功" },
  failed: { tone: "danger", label: "失败" },
};
