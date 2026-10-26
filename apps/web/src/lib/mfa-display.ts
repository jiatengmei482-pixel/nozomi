/**
 * 两步验证的文案（ADR 0030）：出错时说人话、告诉下一步怎么办。
 */
import { ApiError, NetworkError } from "../api/client.ts";
import { NETWORK_FAILURE_TEXT, isThrottled, throttledText } from "./failure.ts";

/** 动态码输入框：只留数字，最多 6 位（粘贴「123 456」也行）。 */
export function cleanCodeInput(value: string): string {
  return value.replace(/\D/g, "").slice(0, 6);
}

export function codeProblem(code: string): string | null {
  return /^\d{6}$/.test(code) ? null : "请输入验证器上显示的 6 位数字";
}

export function recoveryCodeProblem(code: string): string | null {
  return code.replace(/[\s-]/g, "").length === 16 ? null : "恢复码是 16 个字母和数字（可以不带连字符）";
}

/** 两步验证的接口出错时显示什么。 */
export function mfaFailureText(err: unknown): string {
  if (err instanceof NetworkError) return NETWORK_FAILURE_TEXT;
  if (isThrottled(err)) return throttledText(err.retryAfterSeconds);
  if (err instanceof ApiError) {
    switch (err.code) {
      case "MFA_CODE_INVALID":
        return "动态码或恢复码不对。请看验证器上现在显示的数字再输一次；手机时间不准也会对不上。";
      case "MFA_CODE_REUSED":
        return "这个动态码刚刚用过了。请等验证器上出现下一个（最多 30 秒）再输入。";
      case "MFA_ENROLLMENT_NOT_STARTED":
        return "这个二维码已经过期（15 分钟），请重新生成一个再扫。";
      case "MFA_ENCRYPTION_NOT_CONFIGURED":
        return "平台还没有配置好两步验证需要的加密密钥，现在不能绑定或验证。请联系技术人员。";
      case "MFA_SECRET_UNAVAILABLE":
        return "读不出你的两步验证密钥。请联系超级管理员重置你的两步验证，然后重新绑定。";
      case "MFA_CODE_REQUIRED":
        return "请先输入现在验证器上的动态码（或一个恢复码），确认是你本人。";
      default:
        if (err.status < 500 && err.message !== "") return err.message;
    }
  }
  return "系统暂时无法完成两步验证，请稍后再试。";
}

/** 恢复码存成文件时的内容。 */
export function recoveryCodesText(email: string, codes: readonly string[], issuedAt: Date): string {
  return [
    `NOZOMI 运营后台 · 两步验证恢复码`,
    `账号：${email}`,
    `生成时间：${issuedAt.toISOString()}`,
    "",
    "手机丢了或验证器打不开时，登录时可以用其中一个代替动态码。每个只能用一次。",
    "请存在只有你自己能打开的地方（密码管理器、打印出来锁好），不要发给任何人。",
    "",
    ...codes,
    "",
  ].join("\n");
}
