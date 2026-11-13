/**
 * 页面脚本量出来、写进 <html> 的尺寸变量（M6-11）。不是设计令牌：只能是长度，不能是颜色、字号。
 *
 * - 全站只有这个模块调 `style.setProperty`（styles.edge.test.ts 核对）；变量名只接受 `MEASURED_LENGTHS` 里登记的，
 *   值固定写成「整数px」（向上取整，量不出来按 0px）。
 * - `MEASURED_LENGTHS` 是「变量 → 允许引用它的样式表」：两个样式测试共用这一份，引用了不在名单里的变量、
 *   或在名单以外的样式表里引用，都会被拦下。每加一个都要在对应页面规范里写明：
 *   --driver-bar-height：司机页吸底按钮条的实际高度（docs/design/pages/driver.md 3b，M6-08），只许 driver.css 引用。
 */
import { useLayoutEffect } from "react";

export const MEASURED_LENGTHS = {
  "--driver-bar-height": ["driver.css"],
} as const satisfies Record<`--${string}`, readonly `${string}.css`[]>;

export type MeasuredLengthName = keyof typeof MEASURED_LENGTHS;

export function isMeasuredLengthName(name: string): name is MeasuredLengthName {
  return Object.hasOwn(MEASURED_LENGTHS, name);
}

/** 量出来的长度写成「整数px」：向上取整（留够空白）；不是有限的正数时按 0px。 */
export function measuredPixels(length: number): string {
  return `${Number.isFinite(length) && length > 0 ? Math.ceil(length) : 0}px`;
}

/**
 * 把 `element` 的实际高度写进 <html> 的 `name`（绘制前量好，第一帧就留够空白；大小变了跟着改）；
 * 元素没了（`null`）或组件卸载时去掉变量，样式里的后备值照旧生效。
 */
export function useMeasuredHeight(element: HTMLElement | null, name: MeasuredLengthName): void {
  useLayoutEffect(() => {
    if (!isMeasuredLengthName(name)) throw new Error(`${String(name)} 不是登记过的实测尺寸变量`);
    if (element === null) return;
    const root = document.documentElement;
    const measure = (): void => root.style.setProperty(name, measuredPixels(element.getBoundingClientRect().height));
    measure();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(element);
    return () => {
      observer?.disconnect();
      root.style.removeProperty(name);
    };
  }, [element, name]);
}
