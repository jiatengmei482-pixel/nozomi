/**
 * 金额与币种。
 *
 * 规则（见 docs/adr/0004-money.md）：
 * - 金额一律用「最小货币单位」的整数存储和计算（JPY 1 = 1，CNY 1 = 100 分）。
 * - 百分比一律用基点（basis point，1% = 100 bp）的整数表示，避免浮点误差累积。
 * - 舍入统一用「四舍五入，0.5 远离零」。
 */

export const CURRENCIES = {
  JPY: { minorDigits: 0, symbol: "¥" },
  KRW: { minorDigits: 0, symbol: "₩" },
  CNY: { minorDigits: 2, symbol: "CN¥" },
  USD: { minorDigits: 2, symbol: "US$" },
  HKD: { minorDigits: 2, symbol: "HK$" },
  TWD: { minorDigits: 2, symbol: "NT$" },
  THB: { minorDigits: 2, symbol: "฿" },
} as const;

export type CurrencyCode = keyof typeof CURRENCIES;

export interface Money {
  /** 最小货币单位的整数 */
  minor: number;
  currency: CurrencyCode;
}

export function isCurrencyCode(code: string): code is CurrencyCode {
  return Object.hasOwn(CURRENCIES, code);
}

export function minorDigits(currency: CurrencyCode): number {
  return CURRENCIES[currency].minorDigits;
}

/** 四舍五入到整数，0.5 远离零。先修正浮点表示误差（如 1.005*100 = 100.49999…）。 */
export function roundHalfAwayFromZero(value: number): number {
  const corrected = Number(value.toPrecision(15));
  const r = Math.round(Math.abs(corrected));
  return corrected < 0 ? -r : r;
}

export function assertMinor(minor: number): void {
  if (!Number.isSafeInteger(minor)) throw new RangeError(`金额必须是安全整数（最小货币单位）：${minor}`);
}

/** 把用户输入的十进制字符串（如 "4600.5"）转成最小单位整数，小数位超出币种精度时报错。 */
export function parseMajor(input: string, currency: CurrencyCode): number {
  const s = input.trim();
  const digits = minorDigits(currency);
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new RangeError(`金额格式不正确：${input}`);
  const [, sign, intPart = "0", frac = ""] = m;
  if (frac.length > digits) throw new RangeError(`${currency} 最多 ${digits} 位小数：${input}`);
  const minor = Number(intPart + frac.padEnd(digits, "0"));
  assertMinor(minor);
  return sign ? -minor : minor;
}

/** 最小单位整数 → 十进制字符串（不带符号和千分位），用于 API 输出。 */
export function formatMajor(minor: number, currency: CurrencyCode): string {
  assertMinor(minor);
  const digits = minorDigits(currency);
  if (digits === 0) return String(minor);
  const neg = minor < 0;
  const abs = String(Math.abs(minor)).padStart(digits + 1, "0");
  return `${neg ? "-" : ""}${abs.slice(0, -digits)}.${abs.slice(-digits)}`;
}

/** 按基点加价：minor × (1 + bp/10000)，结果四舍五入到最小单位。 */
export function applyBasisPoints(minor: number, bp: number): number {
  assertMinor(minor);
  if (!Number.isInteger(bp)) throw new RangeError(`基点必须是整数：${bp}`);
  return roundHalfAwayFromZero((minor * (10_000 + bp)) / 10_000);
}

/** 取金额的百分比部分：minor × bp/10000（如违约金 = 结算价 × 30%）。 */
export function portionBasisPoints(minor: number, bp: number): number {
  assertMinor(minor);
  if (!Number.isInteger(bp)) throw new RangeError(`基点必须是整数：${bp}`);
  return roundHalfAwayFromZero((minor * bp) / 10_000);
}

/** 按品牌取整单位取整，如 JPY 取整到 100 日元（unitMinor = 100）。 */
export function roundToUnit(minor: number, unitMinor: number): number {
  assertMinor(minor);
  if (!Number.isSafeInteger(unitMinor) || unitMinor <= 0) throw new RangeError(`取整单位必须是正整数：${unitMinor}`);
  return roundHalfAwayFromZero(minor / unitMinor) * unitMinor;
}
