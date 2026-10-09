/**
 * 表格（Excel）里人填的数字和日期怎么读（M1-05 的批量导入）。纯函数，全程按字符处理，不经过浮点数。
 */
import { addDays } from "./pricing.ts";
import { isLocalDate } from "./service-time.ts";

const NUMBER_TEXT = /^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d{1,3}))?$/;
const MAX_DIGITS = 40;

/**
 * 把表格里的一个数字写成普通的十进制字符串（`"12000"`、`"123.45"`、`"-0.5"`）：
 * 去掉千分位逗号和首尾空白，科学计数（Excel 存很大或很小的数时会这样写，如 `1.2E+4`）展开，小数末尾多余的 0 去掉。
 * 值一位不改——`0.30000000000000004` 还是这么多位，由后面按币种的小数位去拒绝。不是数字返回 null。
 */
export function plainDecimal(text: string): string | null {
  const match = NUMBER_TEXT.exec(text.trim().replace(/(\d),(?=\d{3}(\D|$))/g, "$1"));
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
