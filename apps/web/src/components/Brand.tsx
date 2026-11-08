/**
 * NOZOMI 品牌标识（ADR 0066）：一个圆角方块里画一条「N」形的路线，起点、终点两个圆点，意思是「从这里到那里」。
 * 只用 currentColor 和 CSS 令牌上色，亮、暗两套都跟着主题走；不用外部图片和字体。
 * 标志本身是装饰（aria-hidden），可读的名字由旁边的字标「NOZOMI」提供。
 */
export function BrandMark({ className = "brand-mark" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect className="brand-mark__tile" width="32" height="32" rx="9" />
      <path className="brand-mark__route" d="M10 22V10l12 12V10" />
      <circle className="brand-mark__stop" cx="10" cy="22" r="2.75" />
      <circle className="brand-mark__stop" cx="22" cy="10" r="2.75" />
    </svg>
  );
}

/** 标志 + 字标。`tone="on-brand"` 放在品牌色带上，默认放在普通底色上。 */
export function Brand({ tone = "default", className = "" }: { tone?: "default" | "on-brand"; className?: string }) {
  return (
    <span className={`brand brand--${tone} ${className}`.trim()}>
      <BrandMark />
      <span className="brand__word">NOZOMI</span>
    </span>
  );
}
