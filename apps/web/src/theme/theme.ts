/**
 * 主题：跟随系统 / 亮色 / 暗色。
 * 机制见 docs/design/tokens.css：<html> 不带 data-theme = 跟随系统；data-theme="light" | "dark" = 手动指定。
 * 用户的选择存在 localStorage；index.html 里的内联脚本在首次绘制前用同一个键读取它，避免闪一下。
 */
export type ThemeChoice = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "nozomi.theme";

export const THEME_OPTIONS: readonly { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "跟随系统" },
  { value: "light", label: "亮色" },
  { value: "dark", label: "暗色" },
];

type ThemeStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function readThemeChoice(storage: ThemeStorage | null): ThemeChoice {
  try {
    const stored = storage?.getItem(THEME_STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

export function saveThemeChoice(storage: ThemeStorage | null, choice: ThemeChoice): void {
  try {
    if (choice === "system") storage?.removeItem(THEME_STORAGE_KEY);
    else storage?.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // 存储不可用时选择只在本次打开期间有效
  }
}

export function applyThemeChoice(root: { dataset: DOMStringMap }, choice: ThemeChoice): void {
  if (choice === "system") delete root.dataset["theme"];
  else root.dataset["theme"] = choice;
}

export function browserThemeStorage(): ThemeStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
