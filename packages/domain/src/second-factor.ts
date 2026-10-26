/**
 * 平台员工登录的先后顺序（M4-05，ADR 0030）：密码 → 两步验证（第一次是绑定，之后每次输入动态码）→ 必须修改密码时先改密码 → 正常使用。
 *
 * 密码正确就建会话、发令牌（和 ADR 0013 一样，令牌只是会话的凭证），但这个会话在完成两步验证之前是「待验证」的：
 * 只能查看自己、退出、做两步验证；完成之后同一个令牌恢复正常，不用重新登录。判断在鉴权函数里统一做，新接口默认被拦。
 */
import type { SessionPurpose } from "./temporary-password.ts";

/** 会话的两步验证状态 */
export type SecondFactorState =
  /** 这个会话已经通过两步验证 */
  | "verified"
  /** 账号绑定过验证器，这个会话还没输入动态码（或恢复码） */
  | "verify_required"
  /** 账号还没绑定验证器（新员工、上线前就有的账号、被重置过的账号）：先绑定 */
  | "enrollment_required";

export function secondFactorState(sessionVerified: boolean, enrolled: boolean): SecondFactorState {
  if (sessionVerified) return "verified";
  return enrolled ? "verify_required" : "enrollment_required";
}

/**
 * 平台接口声明的用途：
 * - `self_service`：查看自己、退出——任何状态都放行；
 * - `second_factor`：两步验证本身（输入动态码、绑定）——待验证时放行；验证过之后按普通接口对待（必须改密码时被拦）；
 * - `password_change`：修改自己的密码——要先完成两步验证（否则只知道密码的人能把本人锁在门外）；必须改密码时放行；
 * - `general`：其余一切。
 */
export type PlatformSessionPurpose = SessionPurpose | "second_factor" | "password_change";

export type PlatformSessionRefusal = "MFA_REQUIRED" | "PASSWORD_CHANGE_REQUIRED";

/** 这个请求能不能放行；不能时给出原因。两步验证在前，改密码在后。 */
export function platformSessionRefusal(state: SecondFactorState, mustChangePassword: boolean, purpose: PlatformSessionPurpose): PlatformSessionRefusal | null {
  if (purpose === "self_service") return null;
  if (state !== "verified") return purpose === "second_factor" ? null : "MFA_REQUIRED";
  if (mustChangePassword && purpose !== "password_change") return "PASSWORD_CHANGE_REQUIRED";
  return null;
}

/** 密码正确、还没做两步验证的会话多久过期：15 分钟（够装好验证器 App 并绑定；过了就重新输密码） */
export const PENDING_SESSION_TTL_MS = 15 * 60 * 1000;
/** 开始绑定后，生成的密钥多久内必须确认（输入一次动态码） */
export const ENROLLMENT_TTL_MS = 15 * 60 * 1000;
