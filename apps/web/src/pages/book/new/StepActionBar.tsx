/**
 * 新预订页每一步的按钮（「上一步」+ 这一步的主按钮）放在哪里（M9E-32，业主验收意见 2026-11-16，ADR 0100）：
 *
 * - 电脑（≥ 1024px，两栏）：照旧在这一步的正文末尾（`book-new__actions`），布局不变。
 * - 手机和平板（≤ 1023px，`useCompactScreen`；平板 769–1023 业主 2026-11-17 定为同手机）：一条底部按钮条，左边次要按钮「上一步」、右边主按钮；第 2 步上面多一行「车型 · 一口价 价格」。
 *   - 主站：`position: fixed` 贴屏幕底部，留 `env(safe-area-inset-*)`；条的实际高度量出来写到 <html> 的 `--book-actionbar-h`，
 *     页面（body）底部留出同样高度、`scroll-padding-bottom` 也用它，所以不挡表单最后一项和页脚。
 *   - 嵌入页（`frame` 给了宿主可视区）：iframe 被撑到内容全高，fixed / sticky 只会贴在内容最末尾。条留在文档流里自己的位置，
 *     收到带 `top` 的 viewport 后按宿主屏幕的下沿往上挪（`frameBarShift`，translateY，写在 `--book-actionbar-shift`），
 *     不低于原位置、不高过 iframe 上沿；没收到（旧版组件脚本、直接打开）时退回 `position: sticky; bottom: 0`。
 * - 主按钮点不了（如第 2 步还没选车）时保持灰色并显示原因，按钮用 `aria-describedby` 指向原因（`STEP_BAR_REASON_ID`）；不隐藏。
 *
 * 只写长度变量，不改别的样式（styles.edge.test.ts 只放行这个文件里写这两个变量的 setProperty）。
 */
import { type ReactNode, useEffect, useRef, useState } from "react";
import { type HostViewportSource, frameBarShift } from "../../../embed/frame-bar.ts";
import { stepBarCopy } from "../../../lib/step-bar-texts.ts";

/** 单栏宽度：≤ 1023px（手机 + 平板，业主 2026-11-17：平板也用底部按钮条）。电脑两栏仍是 ≥ 1024px */
export const COMPACT_QUERY = "(max-width: 1023px)";
/** 主按钮点不了的原因（同一时间页面上只有一条按钮条） */
export const STEP_BAR_REASON_ID = "book-step-reason";
/** 主站手机底部条的实际高度（<html> 上；页面底部留出同样高度） */
export const STEP_BAR_HEIGHT_VARIABLE = "--book-actionbar-h";
/** 嵌入页里条往上挪多少（条自己身上） */
export const STEP_BAR_SHIFT_VARIABLE = "--book-actionbar-shift";
/** 主站手机底部条在页面上时 <html> 带这个属性（book-new.css 按它给 body 留底部空白） */
const ACTIVE_ATTRIBUTE = "data-book-actionbar";
/** 嵌入页里收到了带 top 的 viewport：条按宿主屏幕摆放（book-new.css 按它从 sticky 换成 translateY） */
const TRACKED_ATTRIBUTE = "data-tracked";

export function useCompactScreen(): boolean {
  const query = typeof window.matchMedia === "function" ? window.matchMedia(COMPACT_QUERY) : null;
  const [compact, setCompact] = useState(query?.matches ?? false);
  useEffect(() => {
    if (query === null) return;
    const update = (): void => setCompact(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, [query?.media]);
  return compact;
}

/**
 * 主站手机上：页面在的时候给 viewport meta 加 `viewport-fit=cover`，`env(safe-area-inset-*)` 才有值（iPhone 的底部横条、横屏刘海）；
 * 离开页面还原。只动这一页，别的页面的 meta 不变（全站的 index.html 不改）。<html> 同时带 `data-viewport-fit="cover"`，
 * book-new.css 按它给 body 左右留出安全区（横屏时内容不进刘海）。
 */
export function useViewportFitCover(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (meta === null) return;
    const original = meta.getAttribute("content") ?? "";
    if (/viewport-fit\s*=/i.test(original)) return;
    const root = document.documentElement;
    meta.setAttribute("content", original.trim() === "" ? "viewport-fit=cover" : `${original}, viewport-fit=cover`);
    root.setAttribute("data-viewport-fit", "cover");
    return () => {
      meta.setAttribute("content", original);
      root.removeAttribute("data-viewport-fit");
    };
  }, [active]);
}

export interface StepActionBarProps {
  /** 单栏宽度（手机、平板，`useCompactScreen`） */
  compact: boolean;
  /** 嵌入页：宿主可视区（`BookingShell.hostViewport`）；主站不给 */
  frame?: HostViewportSource | undefined;
  /** 次要按钮（「上一步」），在左边 */
  back?: ReactNode;
  /** 这一步的主按钮；点不了时调用方给 `disabled` 和 `aria-describedby={STEP_BAR_REASON_ID}` */
  primary?: ReactNode;
  /** 主按钮点不了的原因（文字） */
  reason?: string | null;
  /** 只在手机条上显示的一行（第 2 步「车型 · 一口价 价格」） */
  summary?: ReactNode;
}

export function StepActionBar({ compact, frame, back, primary, reason = null, summary }: StepActionBarProps) {
  const slotRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const mode = !compact ? "inline" : frame === undefined ? "fixed" : "frame";

  // 主站：量条的高度写到 <html>，页面底部留出同样高度
  useEffect(() => {
    const bar = barRef.current;
    if (mode !== "fixed" || bar === null) return;
    const root = document.documentElement;
    const measure = (): void => {
      root.style.setProperty(STEP_BAR_HEIGHT_VARIABLE, `${Math.ceil(bar.getBoundingClientRect().height)}px`);
    };
    root.setAttribute(ACTIVE_ATTRIBUTE, "");
    measure();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(bar);
    return () => {
      observer?.disconnect();
      root.removeAttribute(ACTIVE_ATTRIBUTE);
      root.style.removeProperty(STEP_BAR_HEIGHT_VARIABLE);
    };
  }, [mode]);

  // 嵌入页：按宿主屏幕的下沿摆放；宿主发来新位置时马上挪，iframe 自己变高变窄、条变高时下一帧再算
  useEffect(() => {
    const slot = slotRef.current;
    const bar = barRef.current;
    if (mode !== "frame" || frame === undefined || slot === null || bar === null) return;
    let raf = 0;
    const place = (): void => {
      const view = frame.current();
      if (view === null || view.top === null) {
        slot.removeAttribute(TRACKED_ATTRIBUTE);
        bar.style.removeProperty(STEP_BAR_SHIFT_VARIABLE);
        return;
      }
      // 先换成文档流里的原位置（不再 sticky）再量
      slot.setAttribute(TRACKED_ATTRIBUTE, "");
      const shift = frameBarShift({ frameTop: view.top, hostHeight: view.height, frameHeight: window.innerHeight, slotTop: slot.getBoundingClientRect().top, barHeight: bar.getBoundingClientRect().height });
      bar.style.setProperty(STEP_BAR_SHIFT_VARIABLE, `${shift}px`);
    };
    const schedule = (): void => {
      if (raf === 0) {
        raf = requestAnimationFrame(() => {
          raf = 0;
          place();
        });
      }
    };
    place();
    const unsubscribe = frame.subscribe(place);
    window.addEventListener("resize", schedule);
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
    observer?.observe(bar);
    observer?.observe(document.body);
    return () => {
      unsubscribe();
      window.removeEventListener("resize", schedule);
      observer?.disconnect();
      if (raf !== 0) cancelAnimationFrame(raf);
    };
  }, [mode, frame]);

  const reasonLine =
    reason !== null && reason !== "" ? (
      <p id={STEP_BAR_REASON_ID} className="step-bar__reason">
        {reason}
      </p>
    ) : null;

  if (mode === "inline") {
    if (back == null && primary == null) return null;
    return (
      <>
        <div className="book-new__actions">
          {back}
          {primary}
        </div>
        {reasonLine}
      </>
    );
  }
  return (
    <div ref={slotRef} className={`step-bar-slot step-bar-slot--${mode}`}>
      <div ref={barRef} className="step-bar" role="group" aria-label={stepBarCopy("label")}>
        {summary != null && summary !== false && <p className="step-bar__summary">{summary}</p>}
        {reasonLine}
        <div className="step-bar__buttons">
          {back}
          {primary}
        </div>
      </div>
    </div>
  );
}
