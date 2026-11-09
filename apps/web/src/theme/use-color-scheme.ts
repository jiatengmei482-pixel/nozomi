/**
 * 页面现在实际是亮色还是暗色（M8-10）：`<html data-theme>` 手动指定优先，否则跟随系统。
 * 切换主题（改 data-theme）或系统改了深浅色时重新渲染；给要按主题换内容的地方用（如路线图按主题取不同的图）。
 */
import { useEffect, useState } from "react";

export type ColorScheme = "light" | "dark";

const DARK_QUERY = "(prefers-color-scheme: dark)";

export function currentColorScheme(): ColorScheme {
  const chosen = document.documentElement.dataset["theme"];
  if (chosen === "dark" || chosen === "light") return chosen;
  return (window.matchMedia?.(DARK_QUERY).matches ?? false) ? "dark" : "light";
}

export function useColorScheme(): ColorScheme {
  const [scheme, setScheme] = useState<ColorScheme>(currentColorScheme);
  useEffect(() => {
    const update = (): void => setScheme(currentColorScheme());
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const media = window.matchMedia?.(DARK_QUERY);
    media?.addEventListener?.("change", update);
    update();
    return () => {
      observer.disconnect();
      media?.removeEventListener?.("change", update);
    };
  }, []);
  return scheme;
}
