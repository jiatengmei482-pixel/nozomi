import { useEffect } from "react";

/** 窄屏（< 768px）：月历排成一天一行的列表（02-components.md 第 32 节）。 */
export const isNarrowScreen = (): boolean => typeof window.matchMedia === "function" && window.matchMedia("(max-width: 767px)").matches;

/**
 * 手机上打开本月的月历时，把「今天」那一行滚到屏幕中间（tenant-prices.md 第 10 节、tenant-inventory.md 第 9 节）：
 * 已经过去的日子照常列着，但不用先划过它们才看到今天。`todayId` 是今天那一格的元素 id；看的不是本月时给 null。
 * 每换一次月份只滚一次；今天已经在屏幕上半部分时不动（月初那几天不用滚）。宽屏是七列的格子，一屏看得完，不滚。
 */
export function useScrollToToday(todayId: string | null): void {
  useEffect(() => {
    if (todayId === null || !isNarrowScreen()) return;
    const node = document.getElementById(todayId);
    if (!node) return;
    if (node.getBoundingClientRect().top <= window.innerHeight / 2) return;
    node.scrollIntoView?.({ block: "center" });
  }, [todayId]);
}
