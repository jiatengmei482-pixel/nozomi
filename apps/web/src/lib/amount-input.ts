/**
 * 金额输入框里的字 → 一个干净的十进制写法（docs/design/pages/tenant-prices.md 3.6）。价格表、调价步骤、服务规则里的金额都用这一个。
 * 认：全角数字和符号、空格、千分位逗号、这一格自己币种的代码和符号（粘贴进来的「¥18,500」「18500円」「JPY 18,500」）。
 * 不认，并且说清楚：逗号后面不是正好三位的（「12,50」可能是把逗号当小数点）、别的币种的代码和符号。
 * 这里只整理写法，不做任何换算；换成最小货币单位由 @nozomi/domain 的 parseMajor 做。
 */
import { CURRENCIES, plainDecimal } from "@nozomi/domain";

export type AmountText =
  | { ok: true; text: string }
  /** empty：没填（只有符号也算没填）；negative：带负号；grouping：千分位的逗号位置不对；other-currency：带着别的币种的标记；not-number：别的认不出来的 */
  | { ok: false; reason: "empty" | "negative" | "grouping" | "other-currency" | "not-number" };

/** 各币种自己的符号（代码另算）。「¥」日元和人民币都在用。 */
const SYMBOLS: Readonly<Record<string, readonly string[]>> = { JPY: ["¥", "円"], CNY: ["¥", "元", "RMB", "CN¥"], USD: ["US$", "$"], KRW: ["₩", "원"], HKD: ["HK$", "$"], TWD: ["NT$", "$"], THB: ["฿"] };
const ALL_MARKS: readonly string[] = [...new Set([...Object.keys(CURRENCIES), ...Object.values(SYMBOLS).flat(), "€", "£"])].sort((x, y) => y.length - x.length);
const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const markPattern = (marks: readonly string[]): RegExp => new RegExp(marks.map(escape).join("|"), "gi");

/** 全角的数字、小数点、逗号、货币符号、空格换成半角。 */
export function halfWidthAmount(text: string): string {
  return text.replace(/[０-９．，＄]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0)).replace(/￥/g, "¥").replace(/　/g, " ");
}

export function tidyAmountText(raw: string, currency: string | null): AmountText {
  let text = halfWidthAmount(raw).replace(/\s/g, "");
  if (text === "") return { ok: false, reason: "empty" };
  // 从长到短认币种的标记（「CN¥」先于「¥」）：自己币种的去掉，别的币种的记下来
  const own = new Set(currency === null ? [] : [currency, ...(SYMBOLS[currency.toUpperCase()] ?? [])].map((mark) => mark.toUpperCase()));
  let foreign = false;
  text = text.replace(markPattern(ALL_MARKS), (mark) => {
    if (!own.has(mark.toUpperCase())) foreign = true;
    return "";
  });
  if (foreign) return { ok: false, reason: "other-currency" };
  if (/^-/.test(text)) return { ok: false, reason: "negative" };
  if (text.replace(/,/g, "") === "") return { ok: false, reason: "empty" };
  const digits = plainDigits(text);
  if (digits !== null) return { ok: true, text: digits };
  return { ok: false, reason: /^[\d.,]+$/.test(text) && text.includes(",") ? "grouping" : "not-number" };
}

/**
 * 输入框里的一个不带符号的数 → 只有数字和小数点的写法（用户敲的位数原样留着，后面查小数位要用）。
 * 是不是数字、千分位写得对不对，只问 @nozomi/domain 的 plainDecimal（和导入 Excel 是同一个口径：第一组 1 到 3 位、不以 0 开头，
 * 后面每组正好三位）；这里只多一条：输入框里不收科学计数和正负号。不是数字返回 null。
 */
export function plainDigits(text: string): string | null {
  if (/^\d+(\.\d+)?$/.test(text)) return text;
  // 带逗号的：千分位写得对不对由 plainDecimal 说了算
  if (!/^\d[\d,]*(\.\d+)?$/.test(text) || plainDecimal(text) === null) return null;
  return text.replace(/,/g, "");
}

export const GROUPING_PROBLEM = "逗号的位置不对：千分位的逗号前面不能以 0 开头、后面要正好三位（如 12,500）；小数点请用「.」";
export function otherCurrencyProblem(currency: string | null): string {
  return `这一格的币种是 ${currency ?? "商品的币种"}，请不要带别的币种的符号，只填数字`;
}
