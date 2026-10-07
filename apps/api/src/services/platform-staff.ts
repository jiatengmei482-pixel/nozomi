/** 平台员工账号管理：创建（发邀请）、停用、启用；以及命令行创建超级管理员。 */
import { type PlatformRole, checkPasswordStrength, checkStatusChange, removesLastKeyRoleHolder } from "@nozomi/domain";
import { newInvite } from "../auth/invite-token.ts";
import { newPlatformResetToken } from "../auth/reset-token.ts";
import { hashPassword } from "../auth/password.ts";
import type { AppContext } from "../context.ts";
import { isUniqueViolation, withPlatformTx } from "../db/context.ts";
import type { Pool } from "../db/pool.ts";
import type { Page, TimeCursor } from "../pagination.ts";
import { insertAuditLog } from "../repos/audit-logs.ts";
import {
  type PlatformUser,
  countActiveSuperAdminsForUpdate,
  deletePlatformSessionsOfUser,
  findPlatformUserByEmail,
  insertActivePlatformUser,
  insertInvitedPlatformUser,
  listPlatformUsers,
  lockPlatformUser,
  reissuePlatformInvite,
  setPlatformResetToken,
  setPlatformUserPassword,
  setPlatformUserStatus,
} from "../repos/platform-users.ts";
import { accountValues, consoleOrigin, platformActor } from "./audit.ts";
import { AppError } from "../errors.ts";
import { accountNotActive, emailTaken, lastAdminRequired, notFound, statusChangeRejected, weakPassword } from "./errors.ts";
import type { PlatformPrincipal } from "./platform-auth.ts";

export function listStaff(ctx: AppContext, limit: number, after: TimeCursor | null): Promise<Page<PlatformUser>> {
  return withPlatformTx(ctx.pool, (db) => listPlatformUsers(db, limit, after));
}

export interface StaffInput {
  email: string;
  name: string;
  role: PlatformRole;
}

export interface IssuedInvite {
  token: string;
  expiresAt: Date;
}

export interface InvitedStaff {
  user: PlatformUser;
  invite: IssuedInvite;
}

export async function inviteStaff(
  ctx: AppContext,
  principal: PlatformPrincipal,
  input: StaffInput,
  ip: string,
): Promise<InvitedStaff> {
  const now = ctx.now();
  const invite = newInvite(now);
  const fields = { ...input, inviteTokenHash: invite.tokenHash, inviteExpiresAt: invite.expiresAt };
  try {
    const user = await withPlatformTx(ctx.pool, async (db) => {
      // 锁住已有的这一行：和「本人正在接受邀请」排好先后，不会两边各做一半
      const existing = await findPlatformUserByEmail(db, input.email, { lock: true });
      if (existing && existing.passwordHash !== null) throw emailTaken();
      const saved = existing
        ? await reissuePlatformInvite(db, existing.user.id, fields, now)
        : await insertInvitedPlatformUser(db, fields, now);
      // 重发时账号刚好已被激活：按「邮箱已有激活过的账号」处理
      if (!saved) throw emailTaken();
      await insertAuditLog(db, consoleOrigin(platformActor(principal.user), ip, now), {
        tenantId: null,
        resource: "platform_user",
        resourceId: saved.id,
        action: "invite",
        before: existing ? accountValues(existing.user) : null,
        after: accountValues(saved),
      });
      return saved;
    });
    return { user, invite: { token: invite.token, expiresAt: invite.expiresAt } };
  } catch (err) {
    // 两个请求同时创建同一个邮箱：后到的那个撞上唯一约束
    if (isUniqueViolation(err, "platform_users_email_key")) throw emailTaken();
    throw err;
  }
}

export async function setStaffStatus(
  ctx: AppContext,
  principal: PlatformPrincipal,
  userId: string,
  status: "active" | "disabled",
  ip: string,
): Promise<PlatformUser> {
  const now = ctx.now();
  return withPlatformTx(ctx.pool, async (db) => {
    // 先锁全部在用的超级管理员，再锁目标账号：所有请求的加锁顺序一致
    const activeSuperAdmins = await countActiveSuperAdminsForUpdate(db);
    const target = await lockPlatformUser(db, userId);
    if (!target) throw notFound("账号");
    const before = target.user;
    if (before.status === status) return before;
    const rejected = checkStatusChange(before.status, target.passwordHash !== null, status);
    if (rejected) throw statusChangeRejected(rejected);
    if (removesLastKeyRoleHolder("super_admin", activeSuperAdmins, before, { role: before.role, status })) {
      throw lastAdminRequired("超级管理员");
    }
    const after = await setPlatformUserStatus(db, userId, status, now);
    if (status === "disabled") await deletePlatformSessionsOfUser(db, userId);
    await insertAuditLog(db, consoleOrigin(platformActor(principal.user), ip, now), {
      tenantId: null,
      resource: "platform_user",
      resourceId: userId,
      action: status === "disabled" ? "disable" : "enable",
      before: { status: before.status },
      after: { status: after.status },
    });
    return after;
  });
}

export interface NewSuperAdmin {
  email: string;
  name: string;
  password: string;
}

/**
 * 创建一个在用的超级管理员（`pnpm admin:create` 用）。这是平台上第一个账号的唯一来源；
 * 之后的平台账号由超级管理员在后台创建。审计日志记为「系统 / 命令行」。
 */
export async function createSuperAdmin(pool: Pool, input: NewSuperAdmin, now: Date): Promise<PlatformUser> {
  const issues = checkPasswordStrength(input.password, input.email);
  if (issues.length > 0) throw weakPassword(issues);
  const passwordHash = await hashPassword(input.password);
  try {
    return await withPlatformTx(pool, async (db) => {
      const user = await insertActivePlatformUser(
        db,
        { email: input.email, name: input.name, role: "super_admin", passwordHash },
        now,
      );
      await insertAuditLog(
        db,
        { occurredAt: now, actor: { type: "system", id: null, email: null }, ip: null, source: "cli" },
        {
          tenantId: null,
          resource: "platform_user",
          resourceId: user.id,
          action: "create",
          before: null,
          after: accountValues(user),
        },
      );
      return user;
    });
  } catch (err) {
    if (isUniqueViolation(err, "platform_users_email_key")) throw emailTaken();
    throw err;
  }
}

/**
 * 给一个在用的平台员工发一次性密码重置令牌（超级管理员操作）。
 * 发出令牌不改变现有密码，也不让现有会话失效——否则这个功能可以被用来把别人锁在门外。
 */
export async function issueStaffPasswordReset(
  ctx: AppContext,
  principal: PlatformPrincipal,
  userId: string,
  ip: string,
): Promise<{ user: PlatformUser; reset: IssuedInvite }> {
  const now = ctx.now();
  const reset = newPlatformResetToken(now);
  const user = await withPlatformTx(ctx.pool, async (db) => {
    const target = await lockPlatformUser(db, userId);
    if (!target) throw notFound("账号");
    if (target.user.status !== "active" || target.passwordHash === null) throw accountNotActive();
    await setPlatformResetToken(db, userId, reset.tokenHash, reset.expiresAt, now);
    await insertAuditLog(db, consoleOrigin(platformActor(principal.user), ip, now), {
      tenantId: null,
      resource: "platform_user",
      resourceId: userId,
      action: "request_password_reset",
      before: null,
      after: null,
    });
    return target.user;
  });
  return { user, reset: { token: reset.token, expiresAt: reset.expiresAt } };
}

/**
 * 在服务器上给一个在用的超级管理员重设密码（`pnpm admin:reset-password` 用）。
 * 这是「最后一个超级管理员忘了密码」时的恢复途径。该账号的全部会话失效；审计日志记为「系统 / 命令行」。
 */
export async function resetSuperAdminPassword(
  pool: Pool,
  input: { email: string; password: string },
  now: Date,
): Promise<PlatformUser> {
  const found = await withPlatformTx(pool, (db) => findPlatformUserByEmail(db, input.email));
  if (!found || found.user.role !== "super_admin" || found.user.status !== "active" || found.passwordHash === null) {
    throw new AppError(404, "NOT_FOUND", "没有这个邮箱的在用超级管理员");
  }
  const issues = checkPasswordStrength(input.password, input.email);
  if (issues.length > 0) throw weakPassword(issues);
  const passwordHash = await hashPassword(input.password);
  return withPlatformTx(pool, async (db) => {
    const locked = await lockPlatformUser(db, found.user.id);
    if (!locked || locked.user.role !== "super_admin" || locked.user.status !== "active") {
      throw new AppError(404, "NOT_FOUND", "没有这个邮箱的在用超级管理员");
    }
    await setPlatformUserPassword(db, locked.user.id, passwordHash, now);
    await deletePlatformSessionsOfUser(db, locked.user.id);
    await insertAuditLog(
      db,
      { occurredAt: now, actor: { type: "system", id: null, email: null }, ip: null, source: "cli" },
      {
        tenantId: null,
        resource: "platform_user",
        resourceId: locked.user.id,
        action: "reset_password",
        before: null,
        after: null,
      },
    );
    return locked.user;
  });
}
