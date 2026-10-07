/**
 * 租户用户的登录、会话校验、退出、接受邀请。
 *
 * 登录和接受邀请是仅有的两个「还不知道租户」的入口：先在登录前事务里按邮箱 / 邀请令牌定位到
 * （租户编号，用户编号）——那个事务读不到 tenant_users，只能调用两个定位函数——
 * 之后的读写全部回到那个租户的事务里做，行级安全照常生效。
 */
import {
  type SessionPurpose,
  type TenantAction,
  checkPasswordStrength,
  passwordChangeRequiredFirst,
  tenantRoleCan,
} from "@nozomi/domain";
import { hashInviteToken } from "../auth/invite-token.ts";
import { hashResetToken, tenantIdOfResetToken } from "../auth/reset-token.ts";
import { hashPassword, verifyPassword, verifyPasswordAgainstNothing } from "../auth/password.ts";
import { issueSession } from "../auth/session.ts";
import { verifyAccessToken } from "../auth/token.ts";
import type { AppContext } from "../context.ts";
import { withPreAuthTx, withTenantTx } from "../db/context.ts";
import type { Page, SequenceCursor } from "../pagination.ts";
import { type AuditLog, type TenantAuditLogFilter, insertAuditLog, listTenantAuditLogs } from "../repos/audit-logs.ts";
import {
  type TenantUser,
  type TenantUserSecrets,
  activateTenantUser,
  deleteOtherTenantSessions,
  deleteTenantSession,
  deleteTenantSessionsOfUser,
  findTenantSessionUser,
  findTenantUserByResetToken,
  findTenantUserSecrets,
  insertTenantSession,
  lockTenantUser,
  resetTenantUserPassword,
  setTenantUserPassword,
  locateTenantUserByEmailAcrossTenants,
  locateTenantUserByInviteTokenAcrossTenants,
} from "../repos/tenant-users.ts";
import { type Tenant, findOwnTenant } from "../repos/tenants.ts";
import { ANONYMOUS_ACTOR, consoleOrigin, tenantActor } from "./audit.ts";
import {
  accountDisabled,
  currentPasswordIncorrect,
  forbidden,
  invalidCredentials,
  inviteInvalid,
  passwordChangeRequired,
  passwordUnchanged,
  resetTokenInvalid,
  unauthenticated,
  weakPassword,
} from "./errors.ts";
import { clearLoginReservation, reserveLogin } from "./login-guard.ts";
import type { AcceptInviteInput, ChangePasswordInput, LoginInput, ResetPasswordInput } from "./platform-auth.ts";

export interface TenantLoginResult {
  accessToken: string;
  expiresAt: Date;
  user: TenantUser;
  tenant: Tenant;
}

type LoginFailure = "unknown_email" | "not_activated" | "wrong_password" | "account_disabled";

interface Located {
  secrets: TenantUserSecrets;
  tenant: Tenant;
}

export async function tenantLogin(ctx: AppContext, input: LoginInput, ip: string): Promise<TenantLoginResult> {
  const now = ctx.now();
  const reservation = await reserveLogin(ctx, "tenant", input.email, ip, now);
  const locator = await withPreAuthTx(ctx.pool, (db) => locateTenantUserByEmailAcrossTenants(db, input.email));
  const found: Located | null = locator
    ? await withTenantTx(ctx.pool, locator.tenantId, async (db) => {
        const secrets = await findTenantUserSecrets(db, locator.tenantId, locator.userId);
        const tenant = await findOwnTenant(db, locator.tenantId);
        return secrets && tenant ? { secrets, tenant } : null;
      })
    : null;
  const passwordHash = found?.secrets.passwordHash ?? null;
  const passwordMatches =
    passwordHash !== null
      ? await verifyPassword(input.password, passwordHash)
      : await verifyPasswordAgainstNothing(input.password);

  const failure: LoginFailure | null = !found
    ? "unknown_email"
    : passwordHash === null || found.secrets.user.status === "invited"
      ? "not_activated"
      : !passwordMatches
        ? "wrong_password"
        : found.secrets.user.status === "disabled"
          ? "account_disabled"
          : null;

  if (failure !== null || !found) {
    const origin = consoleOrigin(ANONYMOUS_ACTOR, ip, now);
    const after = { email: input.email, reason: failure };
    if (found) {
      const { tenantId, id } = found.secrets.user;
      await withTenantTx(ctx.pool, tenantId, (db) =>
        insertAuditLog(db, origin, {
          tenantId,
          resource: "tenant_user",
          resourceId: id,
          action: "login_failed",
          before: null,
          after,
        }),
      );
    } else {
      await withPreAuthTx(ctx.pool, (db) =>
        insertAuditLog(db, origin, {
          tenantId: null,
          resource: "tenant_user",
          resourceId: null,
          action: "login_failed",
          before: null,
          after,
        }),
      );
    }
    throw failure === "account_disabled" ? accountDisabled() : invalidCredentials();
  }

  const { user } = found.secrets;
  const tenantId = user.tenantId;
  const session = issueSession(
    ctx.config.authJwtSecret,
    { audience: "tenant", userId: user.id, tenantId, role: user.role },
    now,
  );
  await withTenantTx(ctx.pool, tenantId, async (db) => {
    await insertTenantSession(db, tenantId, {
      id: session.sessionId,
      tenantId,
      userId: user.id,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
    });
    await insertAuditLog(db, consoleOrigin(tenantActor(user), ip, now), {
      tenantId,
      resource: "tenant_user",
      resourceId: user.id,
      action: "login",
      before: null,
      after: null,
    });
  });
  await clearLoginReservation(ctx, reservation);
  return { accessToken: session.accessToken, expiresAt: session.expiresAt, user, tenant: found.tenant };
}

export interface TenantPrincipal {
  sessionId: string;
  /** 当前租户：只来自令牌，接口层不从请求参数或请求体里取 */
  tenantId: string;
  user: TenantUser;
  tenant: Tenant;
}

/** 一次已登录的租户请求要做什么：需要哪个操作的权限；是不是「查看自己 / 改密码 / 退出」。 */
export interface TenantAccess {
  action?: TenantAction;
  /** 不写就是 `general`：账号必须先修改密码时会被拦下。只有查看自己、改密码、退出三个接口写 `self_service` */
  purpose?: SessionPurpose;
}

/**
 * 校验租户访问令牌并核对数据库里的会话和用户：令牌无效、过期、会话已删除、用户不在用，都是 401。
 * 核对本身就在令牌所属租户的事务里做。租户被暂停不影响登录和会话（暂停的租户还要继续履约已有订单）；
 * 租户的当前状态随 `tenant` 一起返回，由前端提示。
 * 用户被标记为「必须先修改密码」时，除 `self_service` 的请求外一律 403 `PASSWORD_CHANGE_REQUIRED`
 * ——和平台一侧同一条规则，在这里统一判断；新接口不声明用途就默认被拦。
 * 传了 `action` 时再检查当前角色（以数据库为准）有没有这个操作的权限，没有则 403。
 */
export async function authenticateTenant(
  ctx: AppContext,
  token: string | null,
  access: TenantAccess = {},
): Promise<TenantPrincipal> {
  const { action, purpose = "general" } = access;
  const now = ctx.now();
  const claims = token === null ? null : verifyAccessToken(ctx.config.authJwtSecret, "tenant", token, now);
  if (!claims || claims.tid === null) throw unauthenticated();
  const tenantId = claims.tid;
  const found = await withTenantTx(ctx.pool, tenantId, async (db) => {
    const user = await findTenantSessionUser(db, tenantId, claims.sid, claims.sub, now);
    const tenant = await findOwnTenant(db, tenantId);
    return user && tenant ? { user, tenant } : null;
  });
  if (!found || found.user.status !== "active") throw unauthenticated();
  if (passwordChangeRequiredFirst(found.user.mustChangePassword, purpose)) throw passwordChangeRequired();
  if (action !== undefined && !tenantRoleCan(found.user.role, action)) throw forbidden(action);
  return { sessionId: claims.sid, tenantId, user: found.user, tenant: found.tenant };
}

export async function tenantLogout(ctx: AppContext, principal: TenantPrincipal, ip: string): Promise<void> {
  const now = ctx.now();
  const tenantId = principal.tenantId;
  await withTenantTx(ctx.pool, tenantId, async (db) => {
    await deleteTenantSession(db, tenantId, principal.sessionId);
    await insertAuditLog(db, consoleOrigin(tenantActor(principal.user), ip, now), {
      tenantId,
      resource: "tenant_user",
      resourceId: principal.user.id,
      action: "logout",
      before: null,
      after: null,
    });
  });
}

export async function acceptTenantInvite(ctx: AppContext, input: AcceptInviteInput, ip: string): Promise<TenantUser> {
  const now = ctx.now();
  const tokenHash = hashInviteToken(input.token);
  const locator = await withPreAuthTx(ctx.pool, (db) => locateTenantUserByInviteTokenAcrossTenants(db, tokenHash));
  if (!locator) throw inviteInvalid();
  const tenantId = locator.tenantId;
  const invited = await withTenantTx(ctx.pool, tenantId, (db) => findTenantUserSecrets(db, tenantId, locator.userId));
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
  return withTenantTx(ctx.pool, tenantId, async (db) => {
    const user = await activateTenantUser(db, tenantId, tokenHash, passwordHash, now);
    if (!user) throw inviteInvalid();
    await insertAuditLog(db, consoleOrigin(tenantActor(user), ip, now), {
      tenantId,
      resource: "tenant_user",
      resourceId: user.id,
      action: "accept_invite",
      before: { status: "invited" },
      after: { status: user.status },
    });
    return user;
  });
}

/**
 * 已登录的租户用户自己改密码：要提供当前密码（核对当前密码和登录一样限速）。
 * 成功后这个用户的其他会话全部失效，当前会话保留；「必须先修改密码」的标记同时清掉。
 */
export async function changeTenantPassword(
  ctx: AppContext,
  principal: TenantPrincipal,
  input: ChangePasswordInput,
  ip: string,
): Promise<void> {
  const now = ctx.now();
  const { user, tenantId } = principal;
  const reservation = await reserveLogin(ctx, "tenant-change-password", user.email, ip, now);
  const current = await withTenantTx(ctx.pool, tenantId, (db) => findTenantUserSecrets(db, tenantId, user.id));
  const matches = current?.passwordHash
    ? await verifyPassword(input.currentPassword, current.passwordHash)
    : await verifyPasswordAgainstNothing(input.currentPassword);
  if (!matches) throw currentPasswordIncorrect();
  await clearLoginReservation(ctx, reservation);
  if (input.newPassword.normalize("NFKC") === input.currentPassword.normalize("NFKC")) throw passwordUnchanged();
  const issues = checkPasswordStrength(input.newPassword, user.email);
  if (issues.length > 0) throw weakPassword(issues);
  const passwordHash = await hashPassword(input.newPassword);
  await withTenantTx(ctx.pool, tenantId, async (db) => {
    const locked = await lockTenantUser(db, tenantId, user.id);
    if (!locked || locked.user.status !== "active") throw unauthenticated();
    await setTenantUserPassword(db, tenantId, user.id, passwordHash, now);
    await deleteOtherTenantSessions(db, tenantId, user.id, principal.sessionId);
    await insertAuditLog(db, consoleOrigin(tenantActor(user), ip, now), {
      tenantId,
      resource: "tenant_user",
      resourceId: user.id,
      action: "change_password",
      before: null,
      after: null,
    });
  });
}

/**
 * 凭管理员发的一次性重置令牌设置新密码。成功后这个用户的全部会话失效。
 * 租户编号取自令牌本身（发令牌时写进去的），整个过程都在那个租户的事务里。
 */
export async function resetTenantPassword(ctx: AppContext, input: ResetPasswordInput, ip: string): Promise<TenantUser> {
  const now = ctx.now();
  const tenantId = tenantIdOfResetToken(input.token);
  if (tenantId === null) throw resetTokenInvalid();
  const tokenHash = hashResetToken(input.token);
  const found = await withTenantTx(ctx.pool, tenantId, (db) => findTenantUserByResetToken(db, tenantId, tokenHash));
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
  return withTenantTx(ctx.pool, tenantId, async (db) => {
    const user = await resetTenantUserPassword(db, tenantId, tokenHash, passwordHash, now);
    if (!user) throw resetTokenInvalid();
    await deleteTenantSessionsOfUser(db, tenantId, user.id);
    await insertAuditLog(db, consoleOrigin(tenantActor(user), ip, now), {
      tenantId,
      resource: "tenant_user",
      resourceId: user.id,
      action: "reset_password",
      before: null,
      after: null,
    });
    return user;
  });
}

/** 租户管理员查本租户的操作日志。 */
export function listOwnAuditLogs(
  ctx: AppContext,
  tenantId: string,
  filter: TenantAuditLogFilter,
  limit: number,
  after: SequenceCursor | null,
): Promise<Page<AuditLog>> {
  return withTenantTx(ctx.pool, tenantId, (db) => listTenantAuditLogs(db, tenantId, filter, limit, after));
}
