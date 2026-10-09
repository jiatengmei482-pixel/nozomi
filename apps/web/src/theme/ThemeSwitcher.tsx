/**
 * 主题切换：一个图标按钮，点开是「跟随系统 / 亮色 / 暗色」。登录页右上角和后台顶栏用的是同一个组件。
 */
import { useState } from "react";
import { Dropdown } from "../components/Dropdown.tsx";
import { Icon, type IconName } from "../components/Icon.tsx";
import { THEME_OPTIONS, type ThemeChoice, applyThemeChoice, browserThemeStorage, readThemeChoice, saveThemeChoice } from "./theme.ts";

const ICONS: Readonly<Record<ThemeChoice, IconName>> = { system: "monitor", light: "sun", dark: "moon" };

export function ThemeSwitcher() {
  const [choice, setChoice] = useState<ThemeChoice>(() => readThemeChoice(browserThemeStorage()));

  const choose = (next: ThemeChoice): void => {
    setChoice(next);
    saveThemeChoice(browserThemeStorage(), next);
    applyThemeChoice(document.documentElement, next);
  };

  return (
    <Dropdown buttonClassName="icon-button" buttonContent={<Icon name={ICONS[choice]} />} label="切换主题" align="end">
      {THEME_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="menuitemradio"
          aria-checked={option.value === choice}
          className="menu-item"
          onClick={() => choose(option.value)}
        >
          <Icon name={ICONS[option.value]} />
          <span className="menu-item__text">{option.label}</span>
          {option.value === choice && <Icon name="check" className="menu-item__check" />}
        </button>
      ))}
    </Dropdown>
  );
}
