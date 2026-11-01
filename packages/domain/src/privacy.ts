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

export function maskPassenger(passenger: PassengerContact): PassengerContact {
  return { name: maskName(passenger.name), phone: maskPhone(passenger.phone), email: maskEmail(passenger.email) };
}
