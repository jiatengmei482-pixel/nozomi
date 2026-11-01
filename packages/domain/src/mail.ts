/**
 * 发邮件的两条规则（M4-14，ADR 0048）：邮件内容防邮件头注入、SMTP 主机防 SSRF。纯函数，真正发信在 apps/api/src/integrations/smtp.ts。
 */
import { ipAddressAllowed, ipAddressClass, parseIpv4, webhookHostAllowed } from "./webhooks.ts";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export const MAIL_RULES = {
  addressMaxLength: 254,
  subjectMaxLength: 200,
} as const;

export type MailMessageIssueReason = "REQUIRED" | "FORMAT" | "TOO_LONG";

export interface MailMessageIssue {
  field: "to" | "subject" | "text";
  reason: MailMessageIssueReason;
}

/** 只认一个地址的写法：没有姓名、尖括号、逗号、分号、空白和换行，所以没法多塞一个收件人或一行邮件头。 */
const MAIL_ADDRESS = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

export function isSingleMailAddress(value: string): boolean {
  return value.length <= MAIL_RULES.addressMaxLength && MAIL_ADDRESS.test(value);
}

/** C0、DEL、C1 控制字符和 Unicode 的行、段分隔符：换行之外，有的邮件程序也把它们当断行。 */
const HEADER_FORBIDDEN = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

/** 邮件内容的问题；空数组 = 可以发。 */
export function mailMessageIssues(message: MailMessage): MailMessageIssue[] {
  const issues: MailMessageIssue[] = [];
  if (message.to === "") issues.push({ field: "to", reason: "REQUIRED" });
  else if (!isSingleMailAddress(message.to)) issues.push({ field: "to", reason: "FORMAT" });
  if (message.subject.trim() === "") issues.push({ field: "subject", reason: "REQUIRED" });
  else if (HEADER_FORBIDDEN.test(message.subject)) issues.push({ field: "subject", reason: "FORMAT" });
  else if (message.subject.length > MAIL_RULES.subjectMaxLength) issues.push({ field: "subject", reason: "TOO_LONG" });
  if (message.text.trim() === "") issues.push({ field: "text", reason: "REQUIRED" });
  return issues;
}

export interface SmtpTargetOptions {
  /** 只有 local / ci：放行回环地址（本机的假 SMTP 服务器） */
  allowLoopback: boolean;
}

function isLoopbackName(host: string): boolean {
  const name = host.replace(/\.$/, "").toLowerCase();
  return name === "localhost" || ((parseIpv4(name) !== null || name.includes(":")) && ipAddressClass(name) === "loopback");
}

/** SMTP 主机（解析之前）：内网、回环、链路本地、元数据地址和只在内网解析的名字都不行。 */
export function smtpHostAllowed(host: string, options: SmtpTargetOptions): boolean {
  return webhookHostAllowed(host) || (options.allowLoopback && isLoopbackName(host));
}

/** 解析到的地址：必须是公网地址。 */
export function smtpAddressAllowed(address: string, options: SmtpTargetOptions): boolean {
  return ipAddressAllowed(address) || (options.allowLoopback && ipAddressClass(address) === "loopback");
}
