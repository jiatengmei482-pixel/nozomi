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

const EMAIL_IN_TEXT = /[^\s@，。；：、,;:()（）<>「」]+@[^\s@，。；：、,;:()（）<>「」]+\.[^\s@，。；：、,;:()（）<>「」]+/g;
const NUMBER_IN_TEXT = /[+＋]?[0-9０-９](?:[0-9０-９\s()（）.\-‐－ー]*[0-9０-９])?/g;
const MIN_PHONE_DIGITS = 7;

/**
 * 手写内容里的联系方式打码（M4-20，ADR 0054）：司机写的联系记录备注可能抄了客人的电话、邮箱、姓名。
 * 7 位以上的数字串只留末 4 位（日期、时间连写也会被打码，宁可多打）；邮箱按 `maskEmail`；给了姓名的把姓名换成打码后的。
 * 只能认出这些形式，其他账号（如 LINE 编号）认不出。
 */
export function maskContactsInText(text: string, passengerName: string | null = null): string {
  const name = passengerName?.trim() ?? "";
  const withoutName = name === "" ? text : text.replaceAll(name, maskName(name));
  return withoutName.replace(EMAIL_IN_TEXT, (email) => maskEmail(email)).replace(NUMBER_IN_TEXT, (found) => {
    const digits = found.replace(/[^0-9０-９]/g, "");
    return digits.length < MIN_PHONE_DIGITS ? found : `****${digits.slice(-4)}`;
  });
}

export function maskPassenger(passenger: PassengerContact): PassengerContact {
  return { name: maskName(passenger.name), phone: maskPhone(passenger.phone), email: maskEmail(passenger.email) };
}
