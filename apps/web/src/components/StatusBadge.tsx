/**
 * 状态徽标（docs/design/02-components.md 第 7 节）：颜色 + 圆点 + 写出状态名的文字。
 * 每个业务对象的「状态 → 颜色 → 文字」对照表集中放在这个文件里，页面不各自决定。
 */
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
