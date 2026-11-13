/**
 * 分步配置的步骤标题：脚本为读屏把焦点移过来时，聚焦框画不画（docs/design/01-tokens.md 第 5 节「程序聚焦的例外」，M6-10）。
 *
 * - 输入方式在**触发这次换步的那次点击 / 按键当时**由事件本身定（`click` 的 `detail > 0` 是点击，`detail === 0` 或 `keydown` 是按键），
 *   作为这次换步的参数记下（连同要去的地址），换步后标题聚焦时取用；中间等保存、等加载都不变。不看全局的「最近一次输入」。
 * - 浏览器后退 / 前进、直接打开网址（路由的 `POP`）、没有记下参数的换步，一律 "unknown"（画框）。
 *   不写进 `location.state`：历史记录里恢复出来的、`<Navigate replace state>` 转手的都不是这一次的输入。
 * - 标题上写 `data-focus-source` 再 `focus()`；标题自己的 `pointerdown` 写 "pointer"、非修饰键的 `keydown` 写 "keyboard"，失去焦点时去掉。
 * - 只用在供应商后台（`enabled`）；运营后台的只读查看照旧走全站的 `:focus-visible`。
 */
import { type KeyboardEvent, type ReactNode, type Ref, useEffect } from "react";
import { type NavigationType, useLocation, useNavigationType } from "react-router";

export type InputSource = "pointer" | "keyboard";
export type FocusSource = InputSource | "unknown";

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta"]);

/** 这次点击 / 按键本身是哪种输入。读屏「点」链接时发的 `click` 没有 `detail`，算按键（显示框）。 */
export function inputSourceOf(event: { type: string; detail?: number }): InputSource {
  if (event.type === "pointerdown" || event.type === "mousedown" || event.type === "touchstart") return "pointer";
  if (event.type.startsWith("key")) return "keyboard";
  return (event.detail ?? 0) > 0 ? "pointer" : "keyboard";
}

/** 记下的这一次换步：去哪、怎么触发的；被哪一次导航（`location.key`）取用过 */
let pending: { source: InputSource; path: string; key: string | null } | null = null;

/** 触发换步的处理函数里调用：`to` 是要去的地址。 */
export function markStepChange(source: InputSource, to: string): void {
  pending = { source, path: new URL(to, window.location.href).pathname, key: null };
}

/** 只给测试用：清掉记下的换步。 */
export function resetStepChange(): void {
  pending = null;
}

/**
 * 这一次导航带没带输入方式。地址是记下的那个（或它下面的步骤：从列表点进 `/products/{id}`，再转到第一个没完成的步骤）才算；
 * 同一次导航可以取多次（开发模式下副作用会跑两遍），换了导航就不算了。
 */
export function navigationSource(location: { pathname: string; key: string }, type: `${NavigationType}`): FocusSource {
  if (type === "POP" || pending === null) return "unknown";
  if (pending.key === null && (location.pathname === pending.path || location.pathname.startsWith(`${pending.path}/`))) pending.key = location.key;
  return pending.key === location.key ? pending.source : "unknown";
}

/**
 * 页面上的链接（步骤导航、「去修改」「去填」、「下一步」、列表里的商品名……）被点击 / 按 Enter 时，
 * 用这次 `click` 自己的 `detail` 记下输入方式和链接的地址。离开确认拦下的点击也会记，之后对话框里的按钮会重新记。
 */
export function useLinkStepSources(enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const onClick = (event: MouseEvent): void => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank") return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      markStepChange(inputSourceOf(event), url.pathname);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [enabled]);
}

/**
 * 把焦点移到步骤标题。`source` 不给就按这一次导航算（换步、进入这一步）；「载入最新内容」这类不换地址的，传按钮那次点击的输入方式。
 */
export function useStepTitleFocus(enabled: boolean): (title: HTMLElement | null, source?: FocusSource, options?: FocusOptions) => void {
  const location = useLocation();
  const type = useNavigationType();
  return (title, source, options) => {
    if (title === null) return;
    if (enabled) title.dataset["focusSource"] = source ?? navigationSource(location, type);
    title.focus(options);
  };
}

export function StepTitle({ ref, enabled, children }: { ref?: Ref<HTMLHeadingElement>; enabled: boolean; children: ReactNode }) {
  return (
    <h2
      className="step__title"
      ref={ref}
      tabIndex={-1}
      {...(enabled
        ? {
            onPointerDown: (event: { currentTarget: HTMLHeadingElement }) => {
              event.currentTarget.dataset["focusSource"] = "pointer";
            },
            onKeyDown: (event: KeyboardEvent<HTMLHeadingElement>) => {
              if (!MODIFIER_KEYS.has(event.key)) event.currentTarget.dataset["focusSource"] = "keyboard";
            },
            onBlur: (event: { currentTarget: HTMLHeadingElement }) => {
              delete event.currentTarget.dataset["focusSource"];
            },
          }
        : {})}
    >
      {children}
    </h2>
  );
}
