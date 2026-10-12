import { useEffect, useRef } from "react";

/**
 * 表单有没保存的修改时拦住「离开」：
 * - 点站内的任何链接（面包屑、侧边栏、「新增航站楼」…）：先不跳，把目的地交给 `onAttempt`，由页面弹确认；
 * - 刷新、关标签页、去站外：浏览器自带的离开确认（beforeunload）。
 * 浏览器的「后退」拦不住：路由收到通知时地址已经变了，这一种目前不确认。
 */
export function useLeaveGuard(active: boolean, onAttempt: (to: string) => void): void {
  const latest = useRef(onAttempt);
  latest.current = onAttempt;
  useEffect(() => {
    if (!active) return;
    const onClick = (event: MouseEvent): void => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      // 只是页内的锚点（跳到正文）不算离开
      if (url.pathname === window.location.pathname && url.search === window.location.search && url.hash !== "") return;
      event.preventDefault();
      event.stopPropagation();
      latest.current(`${url.pathname}${url.search}${url.hash}`);
    };
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };
    document.addEventListener("click", onClick, true);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [active]);
}
