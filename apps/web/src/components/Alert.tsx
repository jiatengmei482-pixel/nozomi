/**
 * 提示条（docs/design/02-components.md 第 8 节）。
 * 四种类型各有固定的图标，形状不同，不只靠颜色区分。
 */
import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon.tsx";

export type AlertKind = "info" | "success" | "warning" | "danger";

export interface Notice {
  kind: AlertKind;
  text: string;
}

const ICONS: Readonly<Record<AlertKind, IconName>> = {
  info: "info",
  success: "check-circle",
  warning: "alert-triangle",
  danger: "alert-circle",
};

export function Alert({ kind, children }: { kind: AlertKind; children: ReactNode }) {
  return (
    <div className={`alert alert--${kind}`}>
      <Icon name={ICONS[kind]} className="alert__icon" />
      <div className="alert__body">{children}</div>
    </div>
  );
}

/**
 * 表单或页面顶部放提示条的位置。两个播报区域一开始就在页面里（空的），之后只往里填内容，
 * 读屏才会在内容出现时读出：出错和警告进 role="alert"，信息和成功进 role="status"。
 */
export function AlertSlot({ notice }: { notice: Notice | null }) {
  const assertive = notice && (notice.kind === "danger" || notice.kind === "warning") ? notice : null;
  const polite = notice && (notice.kind === "info" || notice.kind === "success") ? notice : null;
  return (
    <div className="alert-slot">
      <div role="alert">{assertive && <Alert kind={assertive.kind}>{assertive.text}</Alert>}</div>
      <div role="status">{polite && <Alert kind={polite.kind}>{polite.text}</Alert>}</div>
    </div>
  );
}
