/** 平台员工的登录、会话校验、退出、接受邀请。 */
import { type PlatformAction, checkPasswordStrength, platformRoleCan } from "@nozomi/domain";
import { hashInviteToken } from "../auth/invite-token.ts";
import { hashResetToken } from "../auth/reset-token.ts";
import { hashPassword, verifyPassword, verifyPasswordAgainstNothing } from "../auth/password.ts";
import { issueSession } from "../auth/session.ts";
import { verifyAccessToken } from "../auth/token.ts";
import type { AppContext } from "../context.ts";
import { withSystemTx } from "../db/context.ts";
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
  expiresAt: Date;
  user: PlatformUser;
}

type LoginFailure = "unknown_email" | "not_activated" | "wrong_password" | "account_disabled";

export async function platformLogin(ctx: AppContext, input: LoginInput, ip: string): Promise<PlatformLoginResult> {
  const now = ctx.now();
  const reservation = await reserveLogin(ctx, "platform", input.email, ip, now);
  const found = await withSystemTx(ctx.pool, (db) => findPlatformUserByEmail(db, input.email));
  const passwordMatches = found?.passwordHash
    ? await verifyPassword(input.password, found.passwordHash)
    : await verifyPasswordAgainstNothing(input.password);

  const failure: LoginFailure | null = !found
    ? "unknown_email"
    : found.passwordHash === null || found.user.status === "invited"
      ? "not_activated"
      : !passwordMatches
        ? "wrong_password"
        : found.user.status === "disabled"
          ? "account_disabled"
          : null;

  if (failure !== null || !found) {
    await withSystemTx(ctx.pool, (db) =>
      insertAuditLog(db, consoleOrigin(ANONYMOUS_ACTOR, ip, now), {
        tenantId: null,
        resource: "platform_user",
        resourceId: found?.user.id ?? null,
        action: "login_failed",
        before: null,
        after: { email: input.email, reason: failure },
      }),
    );
    throw failure === "account_disabled" ? accountDisabled() : invalidCredentials();
  }

  const user = found.user;
  const session = issueSession(
    ctx.config.authJwtSecret,
    { audience: "platform", userId: user.id, tenantId: null, role: user.role },
    now,
  );
  await withSystemTx(ctx.pool, async (db) => {
    await insertPlatformSession(db, {
      id: session.sessionId,
      userId: user.id,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
    });
    await insertAuditLog(db, consoleOrigin(platformActor(user), ip, now), {
      tenantId: null,
      resource: "platform_user",
      resourceId: user.id,
      action: "login",
      before: null,
      after: null,
    });
  });
  await clearLoginReservation(ctx, reservation);
  return { accessToken: session.accessToken, expiresAt: session.expiresAt, user };
}

export interface PlatformPrincipal {
  sessionId: string;
  user: PlatformUser;
}

/**
 * 校验平台访问令牌并核对数据库里的会话和账号：令牌无效、过期、会话已删除、账号不在用，都是 401。
 * 传了 `action` 时再检查当前角色（以数据库为准，不看令牌里的角色）有没有这个操作的权限，没有则 403。
 */
export async function authenticatePlatform(
  ctx: AppContext,
  token: string | null,
  action?: PlatformAction,
): Promise<PlatformPrincipal> {
  const now = ctx.now();
  const claims = token === null ? null : verifyAccessToken(ctx.config.authJwtSecret, "platform", token, now);
  if (!claims) throw unauthenticated();
  const user = await withSystemTx(ctx.pool, (db) => findPlatformSessionUser(db, claims.sid, claims.sub, now));
  if (!user || user.status !== "active") throw unauthenticated();
  if (action !== undefined && !platformRoleCan(user.role, action)) throw forbidden(action);
  return { sessionId: claims.sid, user };
}

export async function platformLogout(ctx: AppContext, principal: PlatformPrincipal, ip: string): Promise<void> {
  const now = ctx.now();
  await withSystemTx(ctx.pool, async (db) => {
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

export async function acceptPlatformInvite(ctx: AppContext, input: AcceptInviteInput, ip: string): Promise<PlatformUser> {
  const now = ctx.now();
  const tokenHash = hashInviteToken(input.token);
  const invited = await withSystemTx(ctx.pool, (db) => findPlatformUserByInviteToken(db, tokenHash));
  if (
    !invited ||
    invited.user.status !== "invited" ||
    invited.inviteExpiresAt === null ||
    invited.inviteExpiresAt.getTime() <= now.getTime()
  ) {
    throw inviteInvalid();
  }
  const issues = checkPasswordStrength(input.password, invited.user.email);
  if (issues.length > 0) throw weakPassword(issues);
  const passwordHash = await hashPassword(input.password);
  return withSystemTx(ctx.pool, async (db) => {
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
 * 成功后这个账号的其他会话全部失效，当前会话保留。
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
  const current = await withSystemTx(ctx.pool, (db) => findPlatformUserByEmail(db, user.email));
  const matches = current?.passwordHash
    ? await verifyPassword(input.currentPassword, current.passwordHash)
    : await verifyPasswordAgainstNothing(input.currentPassword);
  if (!matches) throw currentPasswordIncorrect();
  await clearLoginReservation(ctx, reservation);
  if (input.newPassword.normalize("NFKC") === input.currentPassword.normalize("NFKC")) throw passwordUnchanged();
  const issues = checkPasswordStrength(input.newPassword, user.email);
  if (issues.length > 0) throw weakPassword(issues);
  const passwordHash = await hashPassword(input.newPassword);
  await withSystemTx(ctx.pool, async (db) => {
    const locked = await lockPlatformUser(db, user.id);
    if (!locked || locked.user.status !== "active") throw unauthenticated();
    await setPlatformUserPassword(db, user.id, passwordHash, now);
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
  const found = await withSystemTx(ctx.pool, (db) => findPlatformUserByResetToken(db, tokenHash));
  if (
    !found ||
    found.user.status !== "active" ||
    found.resetExpiresAt === null ||
    found.resetExpiresAt.getTime() <= now.getTime()
  ) {
    throw resetTokenInvalid();
  }
  const issues = checkPasswordStrength(input.password, found.user.email);
  if (issues.length > 0) throw weakPassword(issues);
  const passwordHash = await hashPassword(input.password);
  return withSystemTx(ctx.pool, async (db) => {
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
