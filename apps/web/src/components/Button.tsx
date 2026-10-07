/**
 * 按钮（docs/design/02-components.md 第 1 节）。
 * 执行操作用 <Button>；跳转页面用 <LinkButton>（真正的链接，外观是按钮）。
 */
import type { ButtonHTMLAttributes, MouseEvent, ReactNode, Ref } from "react";
import { Link, type LinkProps } from "react-router";
import { Icon, type IconName } from "./Icon.tsx";

export type ButtonVariant = "primary" | "secondary" | "text" | "danger";
export type ControlSize = "sm" | "md" | "lg";

interface Appearance {
  variant?: ButtonVariant;
  size?: ControlSize;
  /** 宽度撑满容器 */
  block?: boolean;
}

function buttonClass({ variant = "secondary", size = "md", block = false }: Appearance, extra?: string): string {
  return ["button", `button--${variant}`, `button--${size}`, block ? "button--block" : "", extra ?? ""].filter(Boolean).join(" ");
}

export interface ButtonProps extends Appearance, Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  type?: "button" | "submit";
  /** 已点击、等待结果：显示转圈和进行时文字，不响应再次点击；不用 disabled，焦点不丢 */
  loading?: boolean;
  loadingText?: string;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({ variant, size, block, type = "button", loading = false, loadingText, className, onClick, children, ref, ...rest }: ButtonProps) {
  const handleClick = (event: MouseEvent<HTMLButtonElement>): void => {
    if (loading) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };
  const appearance: Appearance = {
    ...(variant !== undefined ? { variant } : {}),
    ...(size !== undefined ? { size } : {}),
    ...(block !== undefined ? { block } : {}),
  };
  return (
    <button {...rest} ref={ref} type={type} className={buttonClass(appearance, className)} aria-busy={loading || undefined} onClick={handleClick}>
      {loading ? (
        <>
          <span className="spinner" aria-hidden="true" />
          <span>{loadingText ?? children}</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}

export interface LinkButtonProps extends Appearance, LinkProps {}

export function LinkButton({ variant, size, block, className, ...rest }: LinkButtonProps) {
  const appearance: Appearance = {
    ...(variant !== undefined ? { variant } : {}),
    ...(size !== undefined ? { size } : {}),
    ...(block !== undefined ? { block } : {}),
  };
  return <Link {...rest} className={buttonClass(appearance, className)} />;
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "aria-label" | "children"> {
  icon: IconName;
  /** 按钮的名称：读屏读它，悬停和键盘聚焦时的气泡也显示它 */
  label: string;
  /** 气泡贴按钮的哪一边，避免伸出屏幕 */
  tooltipAlign?: "start" | "end";
  ref?: Ref<HTMLButtonElement>;
  children?: ReactNode;
}

export function IconButton({ icon, label, tooltipAlign = "end", className, ref, children, ...rest }: IconButtonProps) {
  return (
    <button {...rest} ref={ref} type="button" aria-label={label} className={["icon-button", className ?? ""].filter(Boolean).join(" ")}>
      <Icon name={icon} />
      {children}
      <span className={`tooltip tooltip--${tooltipAlign}`} aria-hidden="true">
        {label}
      </span>
    </button>
  );
}
