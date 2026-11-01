/**
 * 乘客信息打码（M4-19，ADR 0052；需求《平台运营端》「个人信息保护」：列表里默认打码，点「查看」才显示全文并记日志）。纯函数。
 * 只用在运营后台：供应商付款后看得到全文（需求「支付后可见乘客姓名、电话、航班号」），司机要联系客人。
 */
import { maskEmail } from "./notifications.ts";

export interface PassengerContact {
  name: string;
  phone: string;
  email: string;
}

/** 按字符（不是 UTF-16 单元）留第一个字，其余换成两个星号；只有一个字的全打码。 */
export function maskName(name: string): string {
  const chars = Array.from(name.trim());
  if (chars.length <= 1) return "*";
  return `${chars[0] as string}**`;
}

/** 只留末 4 位（前面的 + 留着，看得出是国际号码）；不足 8 位的全打码。 */
export function maskPhone(phone: string): string {
  const value = phone.trim();
  const plus = value.startsWith("+") ? "+" : "";
  const digits = value.slice(plus.length);
  if (digits.length < 8) return `${plus}****`;
  return `${plus}${"*".repeat(digits.length - 4)}${digits.slice(-4)}`;
}

/** 邮箱的本名、域名里不会有的字符：空白、标点、斜杠（「a@x.com/b@y.org」是两个地址）。@ 认半角和全角。 */
const EMAIL_PART = "[^\\s@＠，。；：、,;:()（）<>「」/／]+";
const EMAIL_IN_TEXT = new RegExp(`${EMAIL_PART}[@＠]${EMAIL_PART}[.．]${EMAIL_PART}`, "g");
/** 电话里的分隔：空白（含全角）、括号、点、斜杠和各种写法的连字符（输入法打出来的减号 U+2212、破折号 U+2013 / U+2014、不换行连字符 U+2011、长音 ー ｰ）。不含冒号，所以时间不会连起来。 */
const NUMBER_IN_TEXT = /[+＋(（]*[0-9０-９](?:[0-9０-９\s()（）.．/／\-‐‑–—−－ーｰ]*[0-9０-９])?/g;
const MIN_PHONE_DIGITS = 7;
const NAME_SEPARATOR = /[\s·・･,，.]+/u;
/** 姓名里连写时的间隔：备注里可能有也可能没有，半角全角都算（`\s` 包含全角空格）。 */
const NAME_GAP = "\\s*";
/** 中日文敬称：单字的姓只有紧跟这些才打码。 */
const HONORIFIC = "(?=先生|女士|小姐|太太|老师|さん|さま|様|氏|君|ちゃん)";
const LATIN_MIN_LENGTH = 3;
const CJK_MIN_LENGTH = 2;

const isLatin = (text: string): boolean => /^[\p{Script=Latin}\p{M}'’-]+$/u.test(text);

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/**
 * 一段姓名的匹配式；太短、不打码时返回 null（规则见 ADR 0054「姓名的打码规则」）：
 * - 拉丁字母：至少 3 个字母，前后不能连着字母（否则 Li 会打到 line 里）；不区分大小写；
 * - 中日文：至少 2 个字；只有 1 个字的（姓「王」）只在紧跟敬称时才算，否则「王」「田」这样的普通字都会被打码。
 */
function namePattern(chars: readonly string[]): string | null {
  const text = chars.join("");
  const body = chars.map(escapeRegExp).join(NAME_GAP);
  if (isLatin(text)) return chars.length < LATIN_MIN_LENGTH ? null : `(?<![\\p{Script=Latin}])${body}(?![\\p{Script=Latin}])`;
  return chars.length < CJK_MIN_LENGTH ? `${body}${HONORIFIC}` : body;
}

/**
 * 要找的写法，长的在前：全名（忽略空格）、各段；中日文姓名连写（没有空格，分不出姓和名）时再加上第 1 个字、前 2 个字（都只算跟着敬称的）和后 2 个字（名）。
 */
function nameMatchers(name: string): { pattern: string; mask: string }[] {
  const parts = name.split(NAME_SEPARATOR).filter((part) => part !== "");
  if (parts.length === 0) return [];
  const whole = parts.flatMap((part) => Array.from(part));
  const found: { pattern: string | null; mask: string }[] = [{ pattern: namePattern(whole), mask: maskName(name) }];
  for (const part of parts.length > 1 ? parts : []) found.push({ pattern: namePattern(Array.from(part)), mask: maskName(part) });
  if (parts.length === 1 && !isLatin(parts[0] as string) && whole.length >= 3) {
    const given = whole.slice(-2);
    const family = whole.slice(0, 2);
    found.push({ pattern: namePattern(given), mask: maskName(given.join("")) });
    found.push({ pattern: `${family.map(escapeRegExp).join(NAME_GAP)}${HONORIFIC}`, mask: maskName(family.join("")) });
    found.push({ pattern: `${escapeRegExp(whole[0] as string)}${HONORIFIC}`, mask: maskName(whole[0] as string) });
  }
  return found.flatMap((entry) => (entry.pattern === null ? [] : [{ pattern: entry.pattern, mask: entry.mask }]));
}

function maskNameInText(text: string, name: string): string {
  let result = text;
  for (const { pattern, mask } of nameMatchers(name)) result = result.replace(new RegExp(pattern, "giu"), () => mask);
  return result;
}

/**
 * 手写内容里的联系方式打码（M4-20，ADR 0054）：司机写的联系记录备注可能抄了客人的电话、邮箱、姓名。
 * 7 位以上的数字串只留末 4 位（日期、时间连写也可能被打码，宁可多打）；邮箱按 `maskEmail`；给了姓名的按 `nameMatchers` 找出来换成打码后的。
 * 只能认出这些形式，其他账号（如 LINE 编号）认不出。
 */
export function maskContactsInText(text: string, passengerName: string | null = null): string {
  const withoutName = passengerName === null ? text : maskNameInText(text, passengerName);
  return withoutName.replace(EMAIL_IN_TEXT, (email) => maskEmail(email.replace("＠", "@"))).replace(NUMBER_IN_TEXT, (found) => {
    const digits = found.replace(/[^0-9０-９]/g, "");
    return digits.length < MIN_PHONE_DIGITS ? found : `****${digits.slice(-4)}`;
  });
}

export function maskPassenger(passenger: PassengerContact): PassengerContact {
  return { name: maskName(passenger.name), phone: maskPhone(passenger.phone), email: maskEmail(passenger.email) };
}
