/** 登录和账号相关的业务错误。集中在这里，保证同一种情况在平台和租户两边的错误码、说明完全一致。 */
import { PASSWORD_ISSUE_MESSAGES, type PasswordIssue, type StatusChangeError } from "@nozomi/domain";
import { AppError } from "../errors.ts";

/** 邮箱不存在、密码错误、账号未激活共用这一个错误：从响应上分辨不出邮箱是否存在。 */
export function invalidCredentials(): AppError {
  return new AppError(401, "INVALID_CREDENTIALS", "邮箱或密码不正确");
}

export function accountDisabled(): AppError {
  return new AppError(403, "ACCOUNT_DISABLED", "账号已停用，请联系管理员");
}

export function unauthenticated(): AppError {
  return new AppError(401, "UNAUTHENTICATED", "请先登录");
}

export function forbidden(required: string): AppError {
  return new AppError(403, "FORBIDDEN", "当前角色没有这个操作的权限", { required });
}

export function notFound(what: string): AppError {
  return new AppError(404, "NOT_FOUND", `${what}不存在`);
}

/** 令牌不存在、已用过、已过期共用这一个错误。 */
export function inviteInvalid(): AppError {
  return new AppError(400, "INVITE_INVALID", "邀请无效或已过期，请联系邀请人重新发出邀请");
}

export function weakPassword(issues: readonly PasswordIssue[]): AppError {
  return new AppError(400, "WEAK_PASSWORD", "密码强度不够", {
    issues: issues.map((code) => ({ code, message: PASSWORD_ISSUE_MESSAGES[code] })),
  });
}

export function emailTaken(): AppError {
  return new AppError(409, "EMAIL_TAKEN", "这个邮箱已被使用");
}

export function lastAdminRequired(roleName: string): AppError {
  return new AppError(409, "LAST_ADMIN_REQUIRED", `至少要保留一个在用的${roleName}`);
}

const STATUS_CHANGE_MESSAGES: Readonly<Record<StatusChangeError, string>> = {
  STATUS_INVITED_IS_NOT_SETTABLE: "不能把账号改回待激活",
  ACCOUNT_NOT_ACTIVATED: "账号从未激活，不能直接启用，请重新邀请",
};

export function statusChangeRejected(code: StatusChangeError): AppError {
  return new AppError(409, code, STATUS_CHANGE_MESSAGES[code]);
}

export function tooManyLoginAttempts(retryAfterSeconds: number): AppError {
  return new AppError(429, "TOO_MANY_LOGIN_ATTEMPTS", "尝试次数过多，请稍后再试", {
    retry_after_seconds: retryAfterSeconds,
  });
}

export function currentPasswordIncorrect(): AppError {
  return new AppError(400, "CURRENT_PASSWORD_INCORRECT", "当前密码不正确");
}

export function passwordUnchanged(): AppError {
  return new AppError(400, "PASSWORD_UNCHANGED", "新密码不能和当前密码相同");
}

/** 重置令牌不存在、已用过、已过期、账号已停用，共用这一个错误。 */
export function resetTokenInvalid(): AppError {
  return new AppError(400, "RESET_TOKEN_INVALID", "重置链接无效或已过期，请联系管理员重新发起");
}

/** 只有在用的账号才能发重置令牌：待激活的请重新邀请，已停用的请先启用。 */
export function accountNotActive(): AppError {
  return new AppError(409, "ACCOUNT_NOT_ACTIVE", "账号不是在用状态：待激活的账号请重新邀请，已停用的账号请先启用");
}
