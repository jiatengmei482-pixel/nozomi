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

/**
 * 浮点数能放心用的范围：绝对值不超过 10^15（最小货币单位）。再大，相邻两个浮点数的间隔就接近 1，「修正到 15 位有效数字」会把个位改掉。
 * 平台里单个金额的上限是 10 亿，离这个范围还差六个数量级。
 */
export const FLOAT_ROUNDING_LIMIT = 1_000_000_000_000_000;

/**
 * 四舍五入到整数，0.5 远离零。先修正浮点表示误差（如 1.005*100 = 100.49999…）。
 * **只给本来就是浮点数的输入用**（汇率换算：汇率是浮点数）。适用范围：绝对值不超过 `FLOAT_ROUNDING_LIMIT`，超出就抛 RangeError，不给出一个可能错的数。
 * 金额和基点、取整单位之间的计算不要用它：用下面基于整数的函数，计价路径用 `roundFractionHalfAwayFromZero` / `roundFractionToUnit`。
 */
export function roundHalfAwayFromZero(value: number): number {
  if (!Number.isFinite(value) || Math.abs(value) > FLOAT_ROUNDING_LIMIT) throw new RangeError(`数值超出了浮点数四舍五入能保证正确的范围（绝对值不超过 10^15）：${value}`);
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

/** 整数运算的结果换回 number：超出安全整数范围就抛 RangeError（不会悄悄丢精度）。 */
function safeMinor(value: bigint): number {
  const minor = Number(value);
  assertMinor(minor);
  return minor;
}

/** 按基点加价：minor × (1 + bp/10000)，结果四舍五入到最小单位。全程整数运算；结果超出安全整数范围时抛 RangeError。 */
export function applyBasisPoints(minor: number, bp: number): number {
  assertMinor(minor);
  if (!Number.isSafeInteger(bp)) throw new RangeError(`基点必须是整数：${bp}`);
  return safeMinor(roundFractionHalfAwayFromZero(BigInt(minor) * BigInt(10_000 + bp), 10_000n));
}

/** 取金额的百分比部分：minor × bp/10000（如违约金 = 结算价 × 30%）。全程整数运算；结果超出安全整数范围时抛 RangeError。 */
export function portionBasisPoints(minor: number, bp: number): number {
  assertMinor(minor);
  if (!Number.isSafeInteger(bp)) throw new RangeError(`基点必须是整数：${bp}`);
  return safeMinor(roundFractionHalfAwayFromZero(BigInt(minor) * BigInt(bp), 10_000n));
}

/** 按品牌取整单位取整，如 JPY 取整到 100 日元（unitMinor = 100）。全程整数运算，对任何安全整数都对；结果超出安全整数范围时抛 RangeError。 */
export function roundToUnit(minor: number, unitMinor: number): number {
  assertMinor(minor);
  return roundFractionToUnit(BigInt(minor), 1n, unitMinor);
}

/**
 * 精确的分数 numerator / denominator 四舍五入到整数，0.5 远离零。全程整数运算，没有浮点误差。
 * 计价的中间结果（里程单价 × 米数 ÷ 1000、百分比调价连乘）用分数精确保留，只在最后调用这里取整一次。
 */
export function roundFractionHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError("分母不能为 0");
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const quotient = n / d;
  const rounded = (n % d) * 2n >= d ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

/**
 * 精确的分数金额（最小货币单位）按取整单位取整：先除以取整单位，四舍五入（0.5 远离零），再乘回来。只取整这一次。
 * 取整单位为 1 就是取整到最小货币单位。结果超出安全整数范围时抛 RangeError——计价时先用 pricing.ts 的上限挡住（`exceedsSettlementLimit`），走不到这里。
 */
export function roundFractionToUnit(numerator: bigint, denominator: bigint, unitMinor: number): number {
  if (!Number.isSafeInteger(unitMinor) || unitMinor <= 0) throw new RangeError(`取整单位必须是正整数：${unitMinor}`);
  return safeMinor(roundFractionHalfAwayFromZero(numerator, denominator * BigInt(unitMinor)) * BigInt(unitMinor));
}
