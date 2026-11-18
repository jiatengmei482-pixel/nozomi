/**
 * 页面脚本量出来、写进元素样式的尺寸变量（M6-11）。不是设计令牌：只能是长度，不能是颜色、字号。
 *
 * - 全站只有这个模块调 `style.setProperty`，而且只有 `writeLength` 里这一处（styles.edge.test.ts 核对）；
 *   变量名只接受 `MEASURED_LENGTHS` 里登记的，值固定写成「整数px」（`measuredPixels`）。
 * - `MEASURED_LENGTHS` 是「变量 → 种类 + 允许引用它的样式表」：两个样式测试共用这一份，引用了不在名单里的变量、
 *   或在名单以外的样式表里引用，都会被拦下。每加一个都要在对应页面规范里写明：
 *   - --driver-bar-height：司机页吸底按钮条的实际高度（docs/design/pages/driver.md 3b，M6-08），只许 driver.css 引用；
 *   - --book-actionbar-h：新预订页手机底部按钮条的实际高度（ADR 0100，M9E-32），只许 book-new.css 引用；
 *   - --book-actionbar-shift：嵌入页里这条按宿主屏幕往上挪的距离（≤ 0，写在条自己身上；ADR 0100，M9E-32），只许 book-new.css 引用。
 * - 种类：`height` 用 `useMeasuredHeight` 写在 <html> 上（向上取整、不小于 0）；`offset` 用 `setMeasuredOffset` 写在指定元素上（四舍五入、可为负）。
 */
import { useLayoutEffect } from "react";

export type MeasuredLengthKind = "height" | "offset";

export const MEASURED_LENGTHS = {
  "--driver-bar-height": { kind: "height", sheets: ["driver.css"] },
  "--book-actionbar-h": { kind: "height", sheets: ["book-new.css"] },
  "--book-actionbar-shift": { kind: "offset", sheets: ["book-new.css"] },
} as const satisfies Record<`--${string}`, { kind: MeasuredLengthKind; sheets: readonly `${string}.css`[] }>;

export type MeasuredLengthName = keyof typeof MEASURED_LENGTHS;
type NameOfKind<K extends MeasuredLengthKind> = { [N in MeasuredLengthName]: (typeof MEASURED_LENGTHS)[N]["kind"] extends K ? N : never }[MeasuredLengthName];

export function isMeasuredLengthName(name: string): name is MeasuredLengthName {
  return Object.hasOwn(MEASURED_LENGTHS, name);
}

/**
 * 量出来的长度写成「整数px」。`height`：向上取整（留够空白），不是有限的正数时按 0px；
 * `offset`：四舍五入、可以是负数，不是有限数时按 0px（不会写出 -0px）。
 */
export function measuredPixels(length: number, kind: MeasuredLengthKind = "height"): string {
  if (kind === "offset") return `${Number.isFinite(length) ? Math.round(length) || 0 : 0}px`;
  return `${Number.isFinite(length) && length > 0 ? Math.ceil(length) : 0}px`;
}

/** 唯一写样式的地方：变量名不在名单里、或种类不对就报错，不写 */
function writeLength(target: HTMLElement, name: string, kind: MeasuredLengthKind, length: number): void {
  if (!isMeasuredLengthName(name)) throw new Error(`${String(name)} 不是登记过的实测尺寸变量`);
  if (MEASURED_LENGTHS[name].kind !== kind) throw new Error(`${name} 不是${kind === "height" ? "高度" : "位移"}变量`);
  target.style.setProperty(name, measuredPixels(length, kind));
}

/** 去掉变量（样式里的后备值照旧生效）；只认登记过的变量名 */
export function clearMeasuredLength(target: HTMLElement, name: MeasuredLengthName): void {
  if (!isMeasuredLengthName(name)) throw new Error(`${String(name)} 不是登记过的实测尺寸变量`);
  target.style.removeProperty(name);
}

/** 把位移（`offset` 变量）写在 `target` 自己身上 */
export function setMeasuredOffset(target: HTMLElement, name: NameOfKind<"offset">, length: number): void {
  writeLength(target, name, "offset", length);
}

/**
 * 把 `element` 的实际高度写进 <html> 的 `name`（绘制前量好，第一帧就留够空白；大小变了跟着改）；
 * 元素没了（`null`）或组件卸载时去掉变量，样式里的后备值照旧生效。
 */
export function useMeasuredHeight(element: HTMLElement | null, name: NameOfKind<"height">): void {
  useLayoutEffect(() => {
    if (!isMeasuredLengthName(name) || MEASURED_LENGTHS[name].kind !== "height") throw new Error(`${String(name)} 不是登记过的实测尺寸变量`);
    if (element === null) return;
    const root = document.documentElement;
    const measure = (): void => writeLength(root, name, "height", element.getBoundingClientRect().height);
    measure();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(element);
    return () => {
      observer?.disconnect();
      clearMeasuredLength(root, name);
    };
  }, [element, name]);
}
