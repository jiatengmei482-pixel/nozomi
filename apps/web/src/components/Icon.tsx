/**
 * 线性图标：自绘的内联 SVG，描边跟随文字颜色，不引用外部图片或图标字体。
 * 默认是装饰性的（aria-hidden）；单独表达含义时由外层元素提供文字（aria-label 或旁边的文字）。
 */
import type { ReactNode } from "react";

export type IconName =
  | "eye"
  | "eye-off"
  | "sun"
  | "moon"
  | "monitor"
  | "menu"
  | "home"
  | "info"
  | "check-circle"
  | "alert-triangle"
  | "alert-circle"
  | "chevron-down"
  | "chevron-right"
  | "check"
  | "database"
  | "plus"
  | "search"
  | "x"
  | "copy"
  | "external"
  | "filter"
  | "map"
  | "more"
  | "undo"
  | "redo"
  | "target"
  | "minus";

const SHAPES: Readonly<Record<IconName, ReactNode>> = {
  eye: (
    <>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  "eye-off": (
    <>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      <path d="M4 3l16 18" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: <path d="M20.5 13.5A8.5 8.5 0 1 1 10.5 3.5a6.5 6.5 0 0 0 10 10z" />,
  monitor: (
    <>
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </>
  ),
  menu: <path d="M3 6h18M3 12h18M3 18h18" />,
  home: <path d="M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5M12 7.5v.5" />
    </>
  ),
  "check-circle": (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l2.7 2.7L16 9.5" />
    </>
  ),
  "alert-triangle": (
    <>
      <path d="M12 3.5L2.5 20h19L12 3.5z" />
      <path d="M12 10v4.5M12 17v.5" />
    </>
  ),
  "alert-circle": (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v6M12 16v.5" />
    </>
  ),
  "chevron-down": <path d="M6 9l6 6 6-6" />,
  "chevron-right": <path d="M9 6l6 6-6 6" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  database: (
    <>
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      <path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M16.5 16.5L21 21" />
    </>
  ),
  x: <path d="M6 6l12 12M18 6L6 18" />,
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 0 1 2-2h9" />
    </>
  ),
  map: <path d="M3 6.5l6-2.5 6 2.5 6-2.5v13.5l-6 2.5-6-2.5-6 2.5V6.5zM9 4v13.5M15 6.5V20" />,
  more: <path d="M5 12h.01M12 12h.01M19 12h.01" />,
  undo: <path d="M8 6L4 10l4 4M4 10h10a6 6 0 0 1 0 12h-3" />,
  redo: <path d="M16 6l4 4-4 4M20 10H10a6 6 0 0 0 0 12h3" />,
  target: (
    <>
      <circle cx="12" cy="12" r="6" />
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
    </>
  ),
  minus: <path d="M5 12h14" />,
  filter: <path d="M3 5h18l-7 8.5V19l-4 2v-7.5L3 5z" />,
  external: <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />,
};

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      className={className ? `icon ${className}` : "icon"}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {SHAPES[name]}
    </svg>
  );
}
