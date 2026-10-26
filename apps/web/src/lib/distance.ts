import { roundFractionHalfAwayFromZero } from "@nozomi/domain";

/** 「约 18 公里」；不到 1 公里写「不到 1 公里」。 */
export function formatDistance(km: number): string {
  return km < 1 ? "不到 1 公里" : `约 ${Math.round(km)} 公里`;
}

/**
 * 整数米 → 显示用的公里数（不带单位）：四舍五入到 1 位小数（50 米进位，和 domain 的取整同一个函数），去掉末尾的 0，整数部分带千分位
 * （04-data-display.md 第 2 节）：`7295` → `7.3`、`7249` → `7.2`、`12000` → `12`、`1234560` → `1,234.6`。
 * 只用来显示（报价试算的路程、价格说明里的里程）；回填输入框要原样换算，用 price-form.ts 的 `metersToKmText`。
 */
export function kmText(meters: number): string {
  const tenths = roundFractionHalfAwayFromZero(BigInt(meters), 100n);
  const abs = tenths < 0n ? -tenths : tenths;
  const whole = String(abs / 10n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const tenth = abs % 10n;
  return `${tenths < 0n ? "-" : ""}${whole}${tenth === 0n ? "" : `.${tenth}`}`;
}
