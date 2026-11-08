/**
 * 官网上的价格（M6-05，ADR 0066 第 4 节）：拿已经格式化好的金额文字（`moneyText` 的「22,000 JPY」），
 * 把数字和币种分成两段套上共用的 `.price` 样式——数字大、粗、等宽，币种小一号。只管样式，不改文字：
 * 两段之间保留一个空格，读屏和复制出来的仍是原来那串。
 */
export function SitePrice({ text, size }: { text: string; size?: "sm" | "lg" }) {
  const cut = text.lastIndexOf(" ");
  const className = size === undefined ? "price" : `price price--${size}`;
  if (cut <= 0) {
    return (
      <span className={className}>
        <span className="price__amount">{text}</span>
      </span>
    );
  }
  return (
    <span className={className}>
      <span className="price__amount">{text.slice(0, cut)}</span> <span className="price__currency">{text.slice(cut + 1)}</span>
    </span>
  );
}
