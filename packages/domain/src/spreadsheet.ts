/**
 * 表格（Excel）里人填的数字和日期怎么读（M1-05 的批量导入）。纯函数，换算全程按字符处理，不做浮点运算
 * （唯一用到浮点数的地方是 `storedNumberDecimal`：借 Number → String 找回 Excel 存盘前用户填的写法，不参与换算）。
 */
import { addDays } from "./pricing.ts";
import { isLocalDate } from "./service-time.ts";

const NUMBER_TEXT = /^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d{1,3}))?$/;
/** 带千分位的写法：第一组 1 到 3 位、不以 0 开头，后面每组正好三位（`12,500`、`1,234,567.89`） */
const GROUPED = /^([+-]?)([1-9]\d{0,2})((?:,\d{3})+)((?:\.\d+)?(?:[eE][+-]?\d{1,3})?)$/;
const MAX_DIGITS = 40;

/**
 * 把表格里的一个数字写成普通的十进制字符串（`"12000"`、`"123.45"`、`"-0.5"`）：
 * 去掉千分位逗号和首尾空白，科学计数（Excel 存很大或很小的数时会这样写，如 `1.2E+4`）展开，小数末尾多余的 0 去掉。
 * 值一位不改，全程按字符处理。不是数字返回 null。
 *
 * 千分位的规则（和金额输入框的口径一致，页面可以直接用这个函数）：逗号只能当千分位——第一组 1 到 3 位、不以 0 开头，
 * 后面每组正好三位。`0,500`（欧洲写法的 0.5）、`12,50`、`1,2345`、`,500` 都不是数字：逗号可能是小数点，不猜。
 */
export function plainDecimal(text: string): string | null {
  const trimmed = text.trim();
  const grouped = GROUPED.exec(trimmed);
  const match = NUMBER_TEXT.exec(grouped ? `${grouped[1]}${grouped[2]}${(grouped[3] as string).replace(/,/g, "")}${grouped[4]}` : trimmed);
  if (!match) return null;
  const [, sign, whole = "", fraction = "", exponentText] = match;
  let digits = whole + fraction;
  let point = whole.length + (exponentText === undefined ? 0 : Number(exponentText));
  if (point < 0) {
    digits = "0".repeat(-point) + digits;
    point = 0;
  } else if (point > digits.length) digits += "0".repeat(point - digits.length);
  if (digits.length > MAX_DIGITS) return null;
  const integer = digits.slice(0, point).replace(/^0+(?=\d)/, "") || "0";
  const decimals = digits.slice(point).replace(/0+$/, "");
  const magnitude = decimals === "" ? integer : `${integer}.${decimals}`;
  return sign === "-" && /[1-9]/.test(magnitude) ? `-${magnitude}` : magnitude;
}

/** 有效数字的位数（去掉符号、小数点、开头的 0）。 */
function significantDigits(plain: string): number {
  return plain.replace(/^-/, "").replace(".", "").replace(/^0+/, "").replace(/0+$/, "").length;
}

/** 双精度浮点数能原样记住的十进制有效数字位数：不超过 15 位的十进制数存进去再取出来不会变 */
const EXACT_DOUBLE_DIGITS = 15;

/**
 * 表格里**存成数字**的单元格的原文 → 普通的十进制字符串。
 *
 * Excel 把数字存成双精度浮点数，存盘时写 17 位有效数字：填的是 19.99，文件里是 `19.989999999999998`；填 5.1，文件里是 `5.0999999999999996`。
 * 所以对数字类型的单元格，有效数字超过 15 位时，取「能还原同一个双精度数的最短十进制写法」——那就是用户填的那个数。
 * （最短写法用 JS 的 Number → String 求，只用来找回写法；之后的换算仍然按字符做，不做浮点运算。）
 * 取了最短写法仍然超过 15 位的（`0.30000000000000004`、17 位以上的整数）说明它本来就不是一个 15 位以内的数：
 * 原样返回、一位不改，由后面按精度或范围去拒绝——不给出一个近似的数。
 *
 * 存成文字的单元格不走这里（用 `plainDecimal`）：文字就是用户敲的那些字符。不是数字返回 null。
 */
export function storedNumberDecimal(raw: string): string | null {
  const plain = plainDecimal(raw);
  if (plain === null || significantDigits(plain) <= EXACT_DOUBLE_DIGITS) return plain;
  const value = Number(plain);
  if (!Number.isFinite(value)) return plain;
  const shortest = plainDecimal(String(value));
  return shortest !== null && significantDigits(shortest) <= EXACT_DOUBLE_DIGITS ? shortest : plain;
}

export type ScaledIssue =
  /** 小数位比允许的多（日元带小数、美元三位小数、起步里程两位小数） */
  | "PRECISION"
  /** 不在允许的范围里（负数、大得存不下的数也是这个） */
  | "OUT_OF_RANGE";

/**
 * 十进制写法（`plainDecimal` / `storedNumberDecimal` 的结果）× 10^`scale` → 整数，全程按字符：
 * 金额（主单位 → 最小货币单位，`scale` = 币种的小数位）、里程（公里 → 百米，`scale` = 1）都用这一个函数，符号、小数位、范围统一在这里处理。
 * - 小数位超过 `scale`：`PRECISION`（不四舍五入）；
 * - 结果不在 `[min, max]` 里：`OUT_OF_RANGE`——负数、`1E+21` 这样大得存不下的数都是它，不会被说成「不是整数」。
 */
export function scaledInteger(plain: string, scale: number, range: { min: number; max: number }): { value: number } | { issue: ScaledIssue } {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(plain);
  if (!match || !Number.isInteger(scale) || scale < 0) throw new RangeError(`不是十进制数字：${plain}`);
  const [, sign, whole = "0", fraction = ""] = match;
  if (fraction.length > scale) return { issue: "PRECISION" };
  const digits = `${whole}${fraction.padEnd(scale, "0")}`.replace(/^0+(?=\d)/, "");
  // 位数比安全整数还多的直接是超出范围（不拿去换成 number）
  if (digits.length > 15) return { issue: "OUT_OF_RANGE" };
  const value = sign === "-" && digits !== "0" ? -Number(digits) : Number(digits);
  return value < range.min || value > range.max ? { issue: "OUT_OF_RANGE" } : { value };
}

/** 表格里的一个整数（`"10"`、`"10.0"`、`"1E+1"`）；不是整数、不是数字返回 null。 */
export function plainInteger(text: string): number | null {
  const plain = plainDecimal(text);
  if (plain === null || plain.includes(".")) return null;
  const value = Number(plain);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * 表格里的一个日期：`2026-10-01`、`2026/10/1`、`2026.10.01`（后面带 `T00:00:00` 或 ` 00:00:00` 也认），
 * 或 Excel 把日期存成的序号（如 46296）。序号默认按 1900 纪元算；文件声明用 1904 纪元（老版本的 Mac Excel）时传 `date1904`。
 * 认不出、日期不存在、带着不是零点的时间返回 null。
 */
export function sheetDate(text: string, options: { date1904?: boolean } = {}): string | null {
  const trimmed = text.trim();
  const written = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ]00:00(?::00(?:\.0+)?)?Z?)?$/.exec(trimmed);
  if (written) {
    const date = `${written[1]}-${(written[2] as string).padStart(2, "0")}-${(written[3] as string).padStart(2, "0")}`;
    return isLocalDate(date) ? date : null;
  }
  const serial = plainInteger(trimmed);
  if (serial === null) return null;
  // 1904 纪元：序号 0 是 1904-01-01
  if (options.date1904 === true) return serial < 0 || serial > 2_957_003 ? null : addDays("1904-01-01", serial);
  // 1900 纪元：序号 1 是 1900-01-01；Excel 把 1900 年当成闰年，所以 61 以后的序号要按 1899-12-30 起算。只认 1900-03-01 之后、9999 年之前的
  if (serial < 61 || serial > 2_958_465) return null;
  return addDays("1899-12-30", serial);
}
