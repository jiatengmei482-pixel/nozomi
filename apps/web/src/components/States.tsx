/**
 * 加载状态与错误状态（docs/design/02-components.md 第 12、13 节）。
 */
import type { ReactNode } from "react";
import { Icon } from "./Icon.tsx";

/** 骨架屏：按最终布局画灰块。灰块对读屏隐藏，另放一个只给读屏的「加载中」。 */
export function Skeleton({ lines, label = "加载中" }: { lines: readonly ("short" | "medium" | "long" | "control")[]; label?: string }) {
  return (
    <div className="skeleton" aria-busy="true">
      <span className="visually-hidden" role="status">
        {label}
      </span>
      <div className="skeleton__blocks" aria-hidden="true">
        {lines.map((kind, index) => (
          <span key={index} className={`skeleton__block skeleton__block--${kind}`} />
        ))}
      </div>
    </div>
  );
}

/** 某个区域加载失败，或页面处于无法继续的状态：标题 + 说明 + 最多一个操作。 */
export function StateBlock({ title, description, action, headingLevel = "h2" }: { title: string; description: string; action?: ReactNode; headingLevel?: "h1" | "h2" }) {
  const Heading = headingLevel;
  return (
    <div className="state-block">
      <Icon name="alert-circle" className="state-block__icon" />
      <Heading className="state-block__title">{title}</Heading>
      <p className="state-block__description">{description}</p>
      {action && <div className="state-block__action">{action}</div>}
    </div>
  );
}
