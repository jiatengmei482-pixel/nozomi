/**
 * 全屏选择页（M8-37，业主 2026-11-12：移动设备优先保证操作流程）：原生 <dialog> 的 showModal()。
 * - 在页面最上层（top layer）：吸顶的摘要条、地图、底部按钮、别的浮层都盖不住它；
 * - 占满屏幕（含刘海和底部安全区），上面是标题和「取消」，中间可以滚动，底部可以放「确定」；
 * - Esc（安卓返回键）或「取消」关闭；关闭后焦点回到打开它的那个元素；默认焦点落在带 `data-autofocus` 的元素上。
 * 新预订页在手机触屏上用它选地址、日期、时间（`useFullScreenPickers`）。
 */
import { type ReactNode, useEffect, useId, useRef } from "react";
import { Button } from "./Button.tsx";

export interface FullScreenSheetProps {
  open: boolean;
  title: string;
  onClose(): void;
  children: ReactNode;
  /** 底部固定的操作（如「确定」） */
  footer?: ReactNode;
}

export function FullScreenSheet({ open, title, onClose, children, footer }: FullScreenSheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const opener = document.activeElement;
    if (!dialog.open) dialog.showModal();
    dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    return () => {
      if (dialog.open) dialog.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [open]);
  if (!open) return null;
  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="sheet__header">
        <h2 className="sheet__title" id={titleId}>
          {title}
        </h2>
        <Button variant="text" onClick={onClose}>
          取消
        </Button>
      </div>
      <div className="sheet__body">{children}</div>
      {footer && <div className="sheet__footer">{footer}</div>}
    </dialog>
  );
}
