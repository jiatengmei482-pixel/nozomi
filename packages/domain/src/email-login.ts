/**
 * 邮箱验证码登录的规则（M4-06，ADR 0050）：哪种登录方式可用、验证码的长度和时限、限速的数字、邮件内容、审计里的打码。纯函数，不碰数据库和网络。
 */

export const EMAIL_CODE_TTL_MS = 10 * 60 * 1000;
/** 一个码最多试几次；数据库的检查约束写着同一个数 */
export const EMAIL_CODE_MAX_ATTEMPTS = 5;
export const EMAIL_CODE_RESEND_INTERVAL_MS = 60 * 1000;

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** 一条发码的限速：窗口内最多几封。 */
export interface EmailCodeSendLimit {
  maxSends: number;
  windowMs: number;
  /** 登录成功后这一条的计数清零。24 小时那条不清：否则攻击期间本人每登录一次，攻击者就多一轮额度 */
  resetOnLogin?: boolean;
}

/** 同一来源地址（不分邮箱） */
export const EMAIL_CODE_SEND_LIMIT_PER_IP: EmailCodeSendLimit = { maxSends: 20, windowMs: FIFTEEN_MINUTES_MS };
/** 同一邮箱的连发间隔 */
export const EMAIL_CODE_SEND_COOLDOWN: EmailCodeSendLimit = { maxSends: 1, windowMs: EMAIL_CODE_RESEND_INTERVAL_MS };
/**
 * 同一邮箱的累计上限。24 小时是固定窗口：每个窗口 20 封 × 每封 5 次 = 100 次猜测；跨两个窗口的短时峰值可到两倍，长期平均仍是每天 100 次（ADR 0050）。
 */
export const EMAIL_CODE_SEND_LIMITS_PER_EMAIL: readonly EmailCodeSendLimit[] = [
  { maxSends: 5, windowMs: FIFTEEN_MINUTES_MS, resetOnLogin: true },
  { maxSends: 20, windowMs: ONE_DAY_MS },
];

export interface LoginMethods {
  emailCode: boolean;
  password: boolean;
}

/**
 * 现在哪些登录方式可用。验证码只看邮件发送配没配；密码只有「明确要求关闭」且「邮件可用」时才关闭：
 * 没有邮件时关掉密码就谁也进不来了，宁可开着。
 */
export function resolveLoginMethods(input: { mailConfigured: boolean; passwordLoginDisabled: boolean }): LoginMethods {
  return { emailCode: input.mailConfigured, password: !(input.passwordLoginDisabled && input.mailConfigured) };
}

/** 审计和日志里的邮箱：只留第一个字符和域名（`a***@example.com`）。 */
export function maskLoginEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "***";
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}

export type LoginPortal = "platform" | "tenant";

const PORTAL_NAMES: Readonly<Record<LoginPortal, string>> = { platform: "运营后台", tenant: "供应商后台" };

/** 验证码邮件：主题里没有验证码（手机通知栏、邮件列表不露出），正文没有链接。 */
export function emailCodeMail(portal: LoginPortal, code: string): { subject: string; text: string } {
  return {
    subject: "NOZOMI 登录验证码",
    text: [
      `你正在登录 NOZOMI ${PORTAL_NAMES[portal]}，验证码是：`,
      "",
      code,
      "",
      `验证码 ${EMAIL_CODE_TTL_MS / 60_000} 分钟内有效，只能用一次。请不要告诉任何人，NOZOMI 的工作人员也不会向你索取。`,
      "如果不是你本人操作，请忽略这封邮件，你的账号不受影响。",
    ].join("\n"),
  };
}
