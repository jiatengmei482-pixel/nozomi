/**
 * 下拉菜单：一个按钮 + 点开的菜单面板。主题切换和顶栏的账号菜单共用。
 *
 * 键盘：Enter / 空格 / ↓ 打开并聚焦第一项（有选中项时聚焦选中项）；↑↓ Home End 在项之间移动；
 * Esc 关闭并把焦点还给按钮；Tab 离开时关闭。点菜单外面、点任一菜单项后关闭。
 */
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";

export interface DropdownProps {
  /** 按钮的 class 与内容；纯图标按钮必须给 label */
  buttonClassName: string;
  buttonContent: ReactNode;
  label?: string;
  /** 面板贴按钮的哪一边 */
  align?: "start" | "end";
  children: ReactNode;
}

function menuItems(menu: HTMLElement | null): HTMLElement[] {
  return menu ? [...menu.querySelectorAll<HTMLElement>('[role^="menuitem"]')] : [];
}

export function Dropdown({ buttonClassName, buttonContent, label, align = "end", children }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const items = menuItems(menuRef.current);
    (items.find((item) => item.getAttribute("aria-checked") === "true") ?? items[0])?.focus();

    const closeIfOutside = (event: Event): void => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeIfOutside);
    document.addEventListener("focusin", closeIfOutside);
    return () => {
      document.removeEventListener("pointerdown", closeIfOutside);
      document.removeEventListener("focusin", closeIfOutside);
    };
  }, [open]);

  const closeAndRefocus = (): void => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const items = menuItems(menuRef.current);
    const current = items.indexOf(document.activeElement as HTMLElement);
    const moveTo = (index: number): void => {
      event.preventDefault();
      items[(index + items.length) % items.length]?.focus();
    };
    if (event.key === "Escape") {
      event.preventDefault();
      closeAndRefocus();
    } else if (event.key === "ArrowDown") moveTo(current + 1);
    else if (event.key === "ArrowUp") moveTo(current - 1);
    else if (event.key === "Home") moveTo(0);
    else if (event.key === "End") moveTo(items.length - 1);
  };

  return (
    <div className="dropdown" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className={buttonClassName}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {buttonContent}
        {label && (
          <span className={`tooltip tooltip--${align}`} aria-hidden="true">
            {label}
          </span>
        )}
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          className={`dropdown__menu dropdown__menu--${align}`}
          onKeyDown={onMenuKeyDown}
          onClick={(event) => {
            if (event.target instanceof Element && event.target.closest('[role^="menuitem"]')) closeAndRefocus();
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
