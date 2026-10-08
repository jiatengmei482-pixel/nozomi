/**
 * 租户用户管理：列表、邀请、改姓名 / 角色 / 状态、停用。
 * 所有函数都显式接收 tenantId；租户请求在 withTenantTx 里执行（行级安全兜底）。
 * `inviteTenantUserInTx` 也被平台侧「创建租户」「补发管理员邀请」复用，那时它在 withPlatformTx 里执行。
 */
import {
  type AccountStatus,
  type TenantRole,
  checkStatusChange,
  removesLastKeyRoleHolder,
} from "@nozomi/domain";
import { type NewInvite, newInvite } from "../auth/invite-token.ts";
import { newTenantResetToken } from "../auth/reset-token.ts";
import type { AppContext } from "../context.ts";
import { type Db, isUniqueViolation, withTenantTx } from "../db/context.ts";
import type { Page, TimeCursor } from "../pagination.ts";
import { type AuditOrigin, insertAuditLog } from "../repos/audit-logs.ts";
import {
  type TenantUser,
  countActiveAdminsForUpdate,
  deleteTenantSessionsOfUser,
  findTenantUserByEmail,
  insertInvitedTenantUser,
  listTenantUsers,
  lockTenantUser,
  reissueTenantInvite,
  setTenantResetToken,
  updateTenantUser,
} from "../repos/tenant-users.ts";
import { accountValues, consoleOrigin, tenantActor } from "./audit.ts";
import { accountNotActive, emailTaken, lastAdminRequired, notFound, statusChangeRejected } from "./errors.ts";
import type { IssuedInvite } from "./platform-staff.ts";
import type { TenantPrincipal } from "./tenant-auth.ts";

export function listUsers(ctx: AppContext, tenantId: string, limit: number, after: TimeCursor | null): Promise<Page<TenantUser>> {
  return withTenantTx(ctx.pool, tenantId, (db) => listTenantUsers(db, tenantId, limit, after));
}

export interface TenantUserInput {
  email: string;
  name: string;
  role: TenantRole;
}

export interface InvitedTenantUser {
  user: TenantUser;
  invite: IssuedInvite;
}

/** 唯一约束冲突统一成「邮箱已被使用」：邮箱全平台唯一，不透露它属于哪个租户。 */
export function asEmailTaken(err: unknown): unknown {
  return isUniqueViolation(err, "tenant_users_email_key") ? emailTaken() : err;
}

/**
 * 在调用方的事务里邀请一个用户并写审计日志。
 * 邮箱是本租户里一个从未激活过的用户时重新发邀请；已经激活过，或属于别的租户，都是「邮箱已被使用」。
 */
export async function inviteTenantUserInTx(
  db: Db,
  tenantId: string,
  input: TenantUserInput,
  invite: NewInvite,
  origin: AuditOrigin,
): Promise<TenantUser> {
  const fields = { ...input, inviteTokenHash: invite.tokenHash, inviteExpiresAt: invite.expiresAt };
  // 锁住已有的这一行：和「本人正在接受邀请」排好先后，不会两边各做一半
  const existing = await findTenantUserByEmail(db, tenantId, input.email, { lock: true });
  if (existing && existing.passwordHash !== null) throw emailTaken();
  const saved = existing
    ? await reissueTenantInvite(db, tenantId, existing.user.id, fields, origin.occurredAt)
    : await insertInvitedTenantUser(db, tenantId, fields, origin.occurredAt);
  // 重发时用户刚好已被激活：按「邮箱已被使用」处理
  if (!saved) throw emailTaken();
  await insertAuditLog(db, origin, {
    tenantId,
    resource: "tenant_user",
    resourceId: saved.id,
    action: "invite",
    before: existing ? accountValues(existing.user) : null,
    after: accountValues(saved),
  });
  return saved;
}

export async function inviteUser(
  ctx: AppContext,
  principal: TenantPrincipal,
  input: TenantUserInput,
  ip: string,
): Promise<InvitedTenantUser> {
  const now = ctx.now();
  const tenantId = principal.tenantId;
  const invite = newInvite(now);
  try {
    const user = await withTenantTx(ctx.pool, tenantId, (db) =>
      inviteTenantUserInTx(db, tenantId, input, invite, consoleOrigin(tenantActor(principal.user), ip, now)),
    );
    return { user, invite: { token: invite.token, expiresAt: invite.expiresAt } };
  } catch (err) {
    throw asEmailTaken(err);
  }
}

export interface TenantUserUpdate {
  name: string;
  role: TenantRole;
  status: AccountStatus;
}

/**
 * 修改一个用户的姓名、角色、状态；新值由 `decide` 根据锁住的当前值给出。
 * 改姓名、改角色、停用 / 启用各写一条审计日志（只含变了的那一项）。目标用户不属于当前租户时和不存在一样，返回 404。
 */
async function changeUser(
  ctx: AppContext,
  principal: TenantPrincipal,
  userId: string,
  decide: (current: TenantUser) => TenantUserUpdate,
  ip: string,
): Promise<TenantUser> {
  const now = ctx.now();
  const tenantId = principal.tenantId;
  return withTenantTx(ctx.pool, tenantId, async (db) => {
    // 先锁全部在用的管理员，再锁目标用户：所有请求的加锁顺序一致
    const activeAdmins = await countActiveAdminsForUpdate(db, tenantId);
    const target = await lockTenantUser(db, tenantId, userId);
    if (!target) throw notFound("账号");
    const before = target.user;
    const update = decide(before);
    const rejected = checkStatusChange(before.status, target.passwordHash !== null, update.status);
    if (rejected) throw statusChangeRejected(rejected);
    if (removesLastKeyRoleHolder("admin", activeAdmins, before, update)) throw lastAdminRequired("管理员");

    const after = await updateTenantUser(db, tenantId, userId, update, now);
    if (after.status === "disabled") await deleteTenantSessionsOfUser(db, tenantId, userId);

    const origin = consoleOrigin(tenantActor(principal.user), ip, now);
    const event = { tenantId, resource: "tenant_user", resourceId: userId } as const;
    if (before.name !== after.name) {
      await insertAuditLog(db, origin, {
        ...event,
        action: "update",
        before: { name: before.name },
        after: { name: after.name },
      });
    }
    if (before.role !== after.role) {
      await insertAuditLog(db, origin, {
        ...event,
        action: "change_role",
        before: { role: before.role },
        after: { role: after.role },
      });
    }
    if (before.status !== after.status) {
      await insertAuditLog(db, origin, {
        ...event,
        action: after.status === "disabled" ? "disable" : "enable",
        before: { status: before.status },
        after: { status: after.status },
      });
    }
    return after;
  });
}

/** 整体替换一个用户的姓名、角色、状态。 */
export function updateUser(
  ctx: AppContext,
  principal: TenantPrincipal,
  userId: string,
  update: TenantUserUpdate,
  ip: string,
): Promise<TenantUser> {
  return changeUser(ctx, principal, userId, () => update, ip);
}

/** 停用一个用户（接口上的「删除」）：姓名和角色不变，只把状态改成停用。已停用的不重复处理。 */
export async function disableUser(ctx: AppContext, principal: TenantPrincipal, userId: string, ip: string): Promise<void> {
  await changeUser(ctx, principal, userId, (current) => ({ name: current.name, role: current.role, status: "disabled" }), ip);
}

/**
 * 在调用方的事务里给一个在用的租户用户发一次性密码重置令牌并写审计日志。
 * 发出令牌不改变现有密码，也不让现有会话失效。租户管理员和平台（对租户管理员）共用。
 */
export async function issueTenantPasswordResetInTx(
  db: Db,
  tenantId: string,
  target: { user: TenantUser; passwordHash: string | null },
  origin: AuditOrigin,
): Promise<IssuedInvite> {
  if (target.user.status !== "active" || target.passwordHash === null) throw accountNotActive();
  const reset = newTenantResetToken(tenantId, origin.occurredAt);
  await setTenantResetToken(db, tenantId, target.user.id, reset.tokenHash, reset.expiresAt, origin.occurredAt);
  await insertAuditLog(db, origin, {
    tenantId,
    resource: "tenant_user",
    resourceId: target.user.id,
    action: "request_password_reset",
    before: null,
    after: null,
  });
  return { token: reset.token, expiresAt: reset.expiresAt };
}

/** 租户管理员给本租户的用户发密码重置令牌。目标不属于当前租户时和不存在一样，返回 404。 */
export async function issueUserPasswordReset(
  ctx: AppContext,
  principal: TenantPrincipal,
  userId: string,
  ip: string,
): Promise<{ user: TenantUser; reset: IssuedInvite }> {
  const now = ctx.now();
  const tenantId = principal.tenantId;
  return withTenantTx(ctx.pool, tenantId, async (db) => {
    const target = await lockTenantUser(db, tenantId, userId);
    if (!target) throw notFound("账号");
    const reset = await issueTenantPasswordResetInTx(db, tenantId, target, consoleOrigin(tenantActor(principal.user), ip, now));
    return { user: target.user, reset };
  });
}
