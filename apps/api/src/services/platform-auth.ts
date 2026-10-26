/**
 * 平台员工的登录、会话校验、退出、接受邀请。
 * 登录分两步（ADR 0030）：密码正确先建一个「待验证」的会话（15 分钟），完成两步验证（services/platform-mfa.ts）后同一个令牌恢复正常。
 */
import {
  PENDING_SESSION_TTL_MS,
  type PlatformAction,
  type PlatformGrant,
  type PlatformSessionPurpose,
  type SecondFactorState,
  checkPasswordStrength,
  effectiveAllowlist,
  grantCan,
  ipAllowed,
  platformSessionRefusal,
  resolvePlatformGrant,
  secondFactorState,
} from "@nozomi/domain";
import { hashInviteToken } from "../auth/invite-token.ts";
import { hashResetToken } from "../auth/reset-token.ts";
import { hashPassword, sameStoredPassword, verifyPassword, verifyPasswordAgainstNothing } from "../auth/password.ts";
import { issueSession } from "../auth/session.ts";
import { bearerToken, verifyAccessToken } from "../auth/token.ts";
import type { AppContext } from "../context.ts";
import { withPlatformTx } from "../db/context.ts";
import { insertAuditLog } from "../repos/audit-logs.ts";
import {
  type PlatformUser,
  activatePlatformUser,
  deleteOtherPlatformSessions,
  deletePlatformSession,
  deletePlatformSessionsOfUser,
  findPlatformSessionUser,
  findPlatformUserByEmail,
  findPlatformUserByInviteToken,
  findPlatformUserByResetToken,
  insertPlatformSession,
  lockPlatformUser,
  resetPlatformUserPassword,
  setPlatformUserPassword,
} from "../repos/platform-users.ts";
import { ANONYMOUS_ACTOR, consoleOrigin, platformActor } from "./audit.ts";
import {
  accountDisabled,
  currentPasswordIncorrect,
  forbidden,
  invalidCredentials,
  inviteInvalid,
  ipNotAllowed,
  mfaRequired,
  passwordChangeRequired,
  passwordUnchanged,
  resetTokenInvalid,
  unauthenticated,
  weakPassword,
} from "./errors.ts";
import { clearLoginReservation, reserveLogin } from "./login-guard.ts";

export interface LoginInput {
  email: string;
  password: string;
}

export interface PlatformLoginResult {
  accessToken: string;
  /** 令牌的过期时间（登录起 8 小时）；两步验证没在 15 分钟内完成，会话会先失效 */
  expiresAt: Date;
  user: PlatformUser;
  /** 这个会话接下来要做什么：输入动态码，还是先绑定 */
  secondFactor: Exclude<SecondFactorState, "verified">;
}

type LoginFailure = "unknown_email" | "not_activated" | "wrong_password" | "account_disabled" | "ip_not_allowed";

export async function platformLogin(ctx: AppContext, input: LoginInput, ip: string): Promise<PlatformLoginResult> {
  const now = ctx.now();
  const reservation = await reserveLogin(ctx, "platform", input.email, ip, now);
  const found = await withPlatformTx(ctx.pool, (db) => findPlatformUserByEmail(db, input.email));
  const passwordMatches = found?.passwordHash
    ? await verifyPassword(input.password, found.passwordHash)
    : await verifyPasswordAgainstNothing(input.password);

  // IP 白名单只在密码正确之后才看（和「账号已停用」一样）：不在名单里的人从应答上也分辨不出邮箱是否存在
  const failure: LoginFailure | null = !found
    ? "unknown_email"
    : found.passwordHash === null || found.user.status === "invited"
      ? "not_activated"
      : !passwordMatches
        ? "wrong_password"
        : found.user.status === "disabled"
          ? "account_disabled"
          : !ipAllowed(ip, effectiveAllowlist(found.user.ipAllowlist, found.roleIpAllowlist))
            ? "ip_not_allowed"
            : null;

  const reject = async (reason: LoginFailure): Promise<never> => {
    await withPlatformTx(ctx.pool, (db) =>
      insertAuditLog(db, consoleOrigin(ANONYMOUS_ACTOR, ip, now), {
        tenantId: null,
        resource: "platform_user",
        resourceId: found?.user.id ?? null,
        action: "login_failed",
        before: null,
        after: { email: input.email, reason },
      }),
    );
    if (reason === "account_disabled") throw accountDisabled();
    if (reason === "ip_not_allowed") throw ipNotAllowed();
    throw invalidCredentials();
  };
  if (failure !== null || !found) return reject(failure ?? "unknown_email");

  const session = issueSession(
    ctx.config.authJwtSecret,
    { audience: "platform", userId: found.user.id, tenantId: null, role: found.user.role },
    now,
  );
  // 密码是在事务外验证的（慢计算不持锁）。建会话前锁住账号再核对一次：这期间密码被改过或账号被停用，
  // 刚才的验证就不算数——否则「改密 / 重设让全部会话失效」之后，还会冒出一个用旧密码建的新会话。
  const user = await withPlatformTx(ctx.pool, async (db) => {
    const locked = await lockPlatformUser(db, found.user.id);
    if (!locked || locked.user.status !== "active" || !sameStoredPassword(found.passwordHash, locked.passwordHash)) {
      return null;
    }
    const user = locked.user;
    // 会话先是「待验证」的，15 分钟内完成两步验证才延长到令牌的 8 小时
    await insertPlatformSession(db, {
      id: session.sessionId,
      userId: user.id,
      createdAt: session.createdAt,
      expiresAt: new Date(Math.min(session.expiresAt.getTime(), now.getTime() + PENDING_SESSION_TTL_MS)),
    });
    await insertAuditLog(db, consoleOrigin(platformActor(user), ip, now), {
      tenantId: null,
      resource: "platform_user",
      resourceId: user.id,
      action: "login",
      before: null,
      after: null,
    });
    return { user, enrolled: locked.totpSecret !== null };
  });
  if (!user) return reject("wrong_password");
  await clearLoginReservation(ctx, reservation);
  return { accessToken: session.accessToken, expiresAt: session.expiresAt, user: user.user, secondFactor: user.enrolled ? "verify_required" : "enrollment_required" };
}

export interface PlatformPrincipal {
  sessionId: string;
  user: PlatformUser;
  /** 角色给的接口操作和数据范围（每个请求从数据库现查，ADR 0030） */
  grant: PlatformGrant;
  /** 这个会话的两步验证状态 */
  secondFactor: SecondFactorState;
  /** 令牌的过期时间：完成两步验证时会话延长到这里 */
  tokenExpiresAt: Date;
}

/** 这个人能不能做这个操作（以数据库里的当前角色为准）。 */
export function principalCan(principal: PlatformPrincipal, action: PlatformAction): boolean {
  return grantCan(principal.grant, action);
}

/** 一次已登录的平台请求要做什么：需要哪个操作的权限；用途（见 domain 的 `PlatformSessionPurpose`）。 */
export interface PlatformAccess {
  action?: PlatformAction;
  /**
   * 不写就是 `general`：两步验证没完成、账号必须先修改密码时都会被拦下。
   * 查看自己、退出写 `self_service`；两步验证本身写 `second_factor`；修改密码写 `password_change`。
   */
  purpose?: PlatformSessionPurpose;
}

/** 鉴权要用到的请求信息：令牌和来源地址（来源地址按 TRUST_PROXY_HOPS 取，ADR 0008）。 */
export interface PlatformCredentials {
  token: string | null;
  ip: string;
}

export function platformCredentials(request: { headers: { authorization?: string | undefined }; ip: string }): PlatformCredentials {
  return { token: bearerToken(request.headers.authorization), ip: request.ip };
}

/**
 * 校验平台访问令牌并核对数据库里的会话、账号和角色（一条查询）。判断顺序：
 * 1. 令牌无效、过期、会话已删除、账号不在用：401；
 * 2. 来源地址不在这个账号的 IP 白名单里（员工自己的不空用自己的，否则用角色的；都空不限制）：403 `IP_NOT_ALLOWED`；
 * 3. 两步验证没完成：除 `self_service`、`second_factor` 外一律 403 `MFA_REQUIRED`；
 * 4. 必须先修改密码：除 `self_service`、`password_change` 外一律 403 `PASSWORD_CHANGE_REQUIRED`（ADR 0013）；
 * 5. 传了 `action` 时检查当前角色有没有这个操作的权限，没有则 403 `FORBIDDEN`。
 * 都在这里统一判断，接口不用各自记得；新接口不声明用途就默认被拦。
 */
export async function authenticatePlatform(
  ctx: AppContext,
  credentials: PlatformCredentials,
  access: PlatformAccess = {},
): Promise<PlatformPrincipal> {
  const { action, purpose = "general" } = access;
  const now = ctx.now();
  const claims = credentials.token === null ? null : verifyAccessToken(ctx.config.authJwtSecret, "platform", credentials.token, now);
  if (!claims) throw unauthenticated();
  const found = await withPlatformTx(ctx.pool, (db) => findPlatformSessionUser(db, claims.sid, claims.sub, now));
  if (!found || found.user.status !== "active") throw unauthenticated();
  if (!ipAllowed(credentials.ip, effectiveAllowlist(found.user.ipAllowlist, found.role.ipAllowlist))) throw ipNotAllowed();
  const state = secondFactorState(found.sessionVerified, found.enrolled);
  const refusal = platformSessionRefusal(state, found.user.mustChangePassword, purpose);
  if (refusal === "MFA_REQUIRED") throw mfaRequired(state === "enrollment_required" ? "enrollment_required" : "verify_required");
  if (refusal === "PASSWORD_CHANGE_REQUIRED") throw passwordChangeRequired();
  const grant = resolvePlatformGrant(found.role);
  if (action !== undefined && !grantCan(grant, action)) throw forbidden(action);
  return { sessionId: claims.sid, user: found.user, grant, secondFactor: state, tokenExpiresAt: new Date(claims.exp * 1000) };
}

export async function platformLogout(ctx: AppContext, principal: PlatformPrincipal, ip: string): Promise<void> {
  const now = ctx.now();
  await withPlatformTx(ctx.pool, async (db) => {
    await deletePlatformSession(db, principal.sessionId);
    await insertAuditLog(db, consoleOrigin(platformActor(principal.user), ip, now), {
      tenantId: null,
      resource: "platform_user",
      resourceId: principal.user.id,
      action: "logout",
      before: null,
      after: null,
    });
  });
}

export interface AcceptInviteInput {
  token: string;
  password: string;
}

/** 邀请令牌还能不能用：账号还没激活、令牌没过期。平台、租户两边共用这个判断。 */
export function inviteUsable(record: { user: { status: string }; inviteExpiresAt: Date | null }, now: Date): boolean {
  return record.user.status === "invited" && record.inviteExpiresAt !== null && record.inviteExpiresAt.getTime() > now.getTime();
}

/** 重置令牌还能不能用：账号在用、令牌没过期。平台、租户两边共用这个判断。 */
export function resetTokenUsable(record: { user: { status: string }; resetExpiresAt: Date | null }, now: Date): boolean {
  return record.user.status === "active" && record.resetExpiresAt !== null && record.resetExpiresAt.getTime() > now.getTime();
}

/**
 * 只核对邀请令牌还能不能用：不设置密码、不消费令牌、不写审计。设密码页打开时先调它，
 * 失效的链接直接显示「已失效」，不让人白填一次表单。
 * 能用时什么也不返回（不透露是哪个账号）；不存在、已用过、已过期抛同一个错误，和接受邀请时一样。
 */
export async function checkPlatformInvite(ctx: AppContext, token: string): Promise<void> {
  const now = ctx.now();
  const invited = await withPlatformTx(ctx.pool, (db) => findPlatformUserByInviteToken(db, hashInviteToken(token)));
  if (!invited || !inviteUsable(invited, now)) throw inviteInvalid();
}

/** 只核对重置令牌还能不能用，规则同 `checkPlatformInvite`。 */
export async function checkPlatformResetToken(ctx: AppContext, token: string): Promise<void> {
  const now = ctx.now();
  const found = await withPlatformTx(ctx.pool, (db) => findPlatformUserByResetToken(db, hashResetToken(token)));
  if (!found || !resetTokenUsable(found, now)) throw resetTokenInvalid();
}

export async function acceptPlatformInvite(ctx: AppContext, input: AcceptInviteInput, ip: string): Promise<PlatformUser> {
  const now = ctx.now();
  const tokenHash = hashInviteToken(input.token);
  const invited = await withPlatformTx(ctx.pool, (db) => findPlatformUserByInviteToken(db, tokenHash));
  if (!invited || !inviteUsable(invited, now)) throw inviteInvalid();
  const issues = checkPasswordStrength(input.password, invited.user.email);
  if (issues.length > 0) throw weakPassword(issues);
  const passwordHash = await hashPassword(input.password);
  return withPlatformTx(ctx.pool, async (db) => {
    const user = await activatePlatformUser(db, tokenHash, passwordHash, now);
    if (!user) throw inviteInvalid();
    await insertAuditLog(db, consoleOrigin(platformActor(user), ip, now), {
      tenantId: null,
      resource: "platform_user",
      resourceId: user.id,
      action: "accept_invite",
      before: { status: "invited" },
      after: { status: user.status },
    });
    return user;
  });
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

/**
 * 已登录的平台员工自己改密码：要提供当前密码（核对当前密码和登录一样限速）。
 * 成功后这个账号的其他会话全部失效，当前会话保留；「必须先修改密码」的标记同时清掉，
 * 所以用临时密码登录的人改完密码后，手里的令牌马上可以访问其他接口。
 *
 * 并发：当前密码在事务外验证（慢计算不持锁）；写入前锁住账号，再确认两件事——
 * 本会话还在（否则 401：别的会话刚改了密码、或密码被重设，本会话已被作废），
 * 库里的密码还是刚才验证过的那个（否则 400 当前密码不正确：同一会话的重复提交已经把它改掉了）。
 * 所以同一个当前密码只能被用来改一次，后到的请求不会盖掉先到的。
 */
export async function changePlatformPassword(
  ctx: AppContext,
  principal: PlatformPrincipal,
  input: ChangePasswordInput,
  ip: string,
): Promise<void> {
  const now = ctx.now();
  const user = principal.user;
  const reservation = await reserveLogin(ctx, "platform-change-password", user.email, ip, now);
  const current = await withPlatformTx(ctx.pool, (db) => findPlatformUserByEmail(db, user.email));
  const matches = current?.passwordHash
    ? await verifyPassword(input.currentPassword, current.passwordHash)
    : await verifyPasswordAgainstNothing(input.currentPassword);
  if (!matches) throw currentPasswordIncorrect();
  await clearLoginReservation(ctx, reservation);
  if (input.newPassword.normalize("NFKC") === input.currentPassword.normalize("NFKC")) throw passwordUnchanged();
  const issues = checkPasswordStrength(input.newPassword, user.email);
  if (issues.length > 0) throw weakPassword(issues);
  const passwordHash = await hashPassword(input.newPassword);
  await withPlatformTx(ctx.pool, async (db) => {
    const locked = await lockPlatformUser(db, user.id);
    if (!locked || locked.user.status !== "active") throw unauthenticated();
    if (!(await findPlatformSessionUser(db, principal.sessionId, user.id, now))) throw unauthenticated();
    if (!sameStoredPassword(current?.passwordHash ?? null, locked.passwordHash)) throw currentPasswordIncorrect();
    await setPlatformUserPassword(db, user.id, passwordHash, false, now);
    await deleteOtherPlatformSessions(db, user.id, principal.sessionId);
    await insertAuditLog(db, consoleOrigin(platformActor(user), ip, now), {
      tenantId: null,
      resource: "platform_user",
      resourceId: user.id,
      action: "change_password",
      before: null,
      after: null,
    });
  });
}

export interface ResetPasswordInput {
  token: string;
  password: string;
}

/** 凭管理员发的一次性重置令牌设置新密码。成功后这个账号的全部会话失效。 */
export async function resetPlatformPassword(ctx: AppContext, input: ResetPasswordInput, ip: string): Promise<PlatformUser> {
  const now = ctx.now();
  const tokenHash = hashResetToken(input.token);
  const found = await withPlatformTx(ctx.pool, (db) => findPlatformUserByResetToken(db, tokenHash));
  if (!found || !resetTokenUsable(found, now)) throw resetTokenInvalid();
  const issues = checkPasswordStrength(input.password, found.user.email);
  if (issues.length > 0) throw weakPassword(issues);
  const passwordHash = await hashPassword(input.password);
  return withPlatformTx(ctx.pool, async (db) => {
    const user = await resetPlatformUserPassword(db, tokenHash, passwordHash, now);
    if (!user) throw resetTokenInvalid();
    await deletePlatformSessionsOfUser(db, user.id);
    await insertAuditLog(db, consoleOrigin(platformActor(user), ip, now), {
      tenantId: null,
      resource: "platform_user",
      resourceId: user.id,
      action: "reset_password",
      before: null,
      after: null,
    });
    return user;
  });
}
