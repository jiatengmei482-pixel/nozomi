/**
 * 对话框（docs/design/02-components.md 第 9 节）：原生 <dialog> 的 showModal()，自带焦点限制和 Esc。
 * - 确认类：点遮罩可以关闭；带表单的（`dismissOnBackdrop={false}`）点遮罩不关闭。
 * - `busy` 时（确认后在等结果）Esc、点遮罩、关闭按钮都不起作用。
 * - 关闭后焦点回到打开它的那个元素。
 * - 默认焦点落在带 `data-autofocus` 的元素上。
 */
import { type ReactNode, useEffect, useId, useRef } from "react";
import { Icon } from "./Icon.tsx";

export interface DialogProps {
  open: boolean;
  title: string;
  /** 标题下面的一行小字（等宽），例如编码 */
  subtitle?: string;
  size?: "confirm" | "form";
  busy?: boolean;
  dismissOnBackdrop?: boolean;
  onClose(): void;
  children: ReactNode;
  footer?: ReactNode;
}

export function Dialog({ open, title, subtitle, size = "confirm", busy = false, dismissOnBackdrop = true, onClose, children, footer }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    // 记下是谁打开的：关闭后（不管是 Esc、取消还是关闭按钮）焦点回到它上面
    const opener = document.activeElement;
    if (!dialog.open) dialog.showModal();
    // 默认焦点：标了 data-autofocus 的那个（危险确认时是「取消」）；没标的由浏览器落在第一个可操作的元素上
    dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [open]);
  if (!open) return null;
  return (
    <dialog
      ref={ref}
      className={`dialog dialog--${size}`}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current && dismissOnBackdrop && !busy) onClose();
      }}
    >
      <div className="dialog__panel">
        <div className="dialog__header">
          <div className="dialog__titles">
            <h2 className="dialog__title" id={titleId}>
              {title}
            </h2>
            {subtitle && <p className="dialog__subtitle">{subtitle}</p>}
          </div>
          <button type="button" className="icon-button" aria-label="关闭" disabled={busy} onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="dialog__body">{children}</div>
        {footer && <div className="dialog__footer">{footer}</div>}
      </div>
    </dialog>
  );
}
