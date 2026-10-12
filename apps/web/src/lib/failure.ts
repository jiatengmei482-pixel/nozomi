/**
 * 把一次失败的请求变成给用户看的话。不显示状态码、英文报错和内部字段名。
 */
import { ApiError, NetworkError } from "../api/client.ts";

export const NETWORK_FAILURE_TEXT = "网络连接失败，请检查网络后重试。";

/** 「尝试次数过多」的提示；后端给了等待时间就写出分钟数（不足一分钟按一分钟）。 */
export function throttledText(retryAfterSeconds: number | null): string {
  if (retryAfterSeconds === null || !Number.isFinite(retryAfterSeconds) || retryAfterSeconds <= 0) {
    return "尝试次数过多，请稍后再试。";
  }
  return `尝试次数过多，请 ${Math.ceil(retryAfterSeconds / 60)} 分钟后再试。`;
}

/** 这些错误码的后端说明是给开发者看的（「请求参数校验未通过」），不直接给用户。 */
const GENERIC_REJECTIONS: ReadonlySet<string> = new Set(["VALIDATION_FAILED", "BAD_REQUEST"]);

export function isUnauthenticated(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401;
}

/** 账号正在用临时密码，后端拒绝了改密码以外的操作（ADR 0013）。 */
export function isPasswordChangeRequired(err: unknown): boolean {
  return err instanceof ApiError && err.status === 403 && err.code === "PASSWORD_CHANGE_REQUIRED";
}

export function isThrottled(err: unknown): err is ApiError {
  return err instanceof ApiError && err.status === 429;
}

/**
 * 表单顶部提示条的文字。`action` 是正在做的事（「登录」「设置密码」「保存」），用在服务器出错的那句话里。
 * 业务规则类的拒绝（4xx）直接用后端返回的中文说明。
 */
export function failureText(err: unknown, action: string): string {
  if (err instanceof NetworkError) return NETWORK_FAILURE_TEXT;
  if (isThrottled(err)) return throttledText(err.retryAfterSeconds);
  if (err instanceof ApiError && GENERIC_REJECTIONS.has(err.code)) return "提交的内容不符合要求，请检查后重试。";
  if (err instanceof ApiError && err.status < 500 && err.message !== "") return err.message;
  return `系统暂时无法${action}，请稍后再试。`;
}

/** 后端 WEAK_PASSWORD 时 details.issues 里的每一条说明。 */
export function weakPasswordMessages(err: ApiError): string[] {
  const issues = err.details["issues"];
  if (!Array.isArray(issues)) return [];
  return issues.flatMap((issue: unknown) => {
    if (typeof issue !== "object" || issue === null) return [];
    const message = (issue as { message?: unknown }).message;
    return typeof message === "string" && message !== "" ? [message] : [];
  });
}
