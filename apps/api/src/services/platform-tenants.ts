/**
 * 平台侧的租户管理：创建租户（同时邀请第一个管理员）、查看、暂停、恢复、补发管理员邀请。
 * 这些是平台员工的跨租户操作，在 withPlatformTx 里执行，每条 SQL 自己带租户条件，并写审计日志（ADR 0003）。
 */
import { newInvite } from "../auth/invite-token.ts";
import type { AppContext } from "../context.ts";
import { withPlatformTx } from "../db/context.ts";
import type { Page, TimeCursor } from "../pagination.ts";
import { insertAuditLog } from "../repos/audit-logs.ts";
import { type TenantUser, findTenantUserByEmail } from "../repos/tenant-users.ts";
import {
  type Tenant,
  type TenantStatus,
  findTenantForPlatform,
  insertTenant,
  listTenantsAcrossTenants,
  setTenantStatus,
} from "../repos/tenants.ts";
import { consoleOrigin, platformActor } from "./audit.ts";
import { notFound } from "./errors.ts";
import type { PlatformPrincipal } from "./platform-auth.ts";
import type { IssuedInvite } from "./platform-staff.ts";
import { asEmailTaken, inviteTenantUserInTx, issueTenantPasswordResetInTx } from "./tenant-users.ts";

export function listTenants(ctx: AppContext, limit: number, after: TimeCursor | null): Promise<Page<Tenant>> {
  return withPlatformTx(ctx.pool, (db) => listTenantsAcrossTenants(db, limit, after));
}

export async function getTenant(ctx: AppContext, tenantId: string): Promise<Tenant> {
  const tenant = await withPlatformTx(ctx.pool, (db) => findTenantForPlatform(db, tenantId, { lock: false }));
  if (!tenant) throw notFound("租户");
  return tenant;
}

export interface AdminInput {
  email: string;
  name: string;
}

export interface CreatedTenant {
  tenant: Tenant;
  adminUser: TenantUser;
  invite: IssuedInvite;
}

export async function createTenant(
  ctx: AppContext,
  principal: PlatformPrincipal,
  input: { name: string; admin: AdminInput },
  ip: string,
): Promise<CreatedTenant> {
  const now = ctx.now();
  const invite = newInvite(now);
  const origin = consoleOrigin(platformActor(principal.user), ip, now);
  try {
    return await withPlatformTx(ctx.pool, async (db) => {
      const tenant = await insertTenant(db, input.name, now);
      await insertAuditLog(db, origin, {
        tenantId: tenant.id,
        resource: "tenant",
        resourceId: tenant.id,
        action: "create",
        before: null,
        after: { name: tenant.name, status: tenant.status },
      });
      const adminUser = await inviteTenantUserInTx(db, tenant.id, { ...input.admin, role: "admin" }, invite, origin);
      return { tenant, adminUser, invite: { token: invite.token, expiresAt: invite.expiresAt } };
    });
  } catch (err) {
    throw asEmailTaken(err);
  }
}

export async function inviteTenantAdmin(
  ctx: AppContext,
  principal: PlatformPrincipal,
  tenantId: string,
  input: AdminInput,
  ip: string,
): Promise<{ user: TenantUser; invite: IssuedInvite }> {
  const now = ctx.now();
  const invite = newInvite(now);
  try {
    const user = await withPlatformTx(ctx.pool, async (db) => {
      const tenant = await findTenantForPlatform(db, tenantId, { lock: false });
      if (!tenant) throw notFound("租户");
      return inviteTenantUserInTx(
        db,
        tenantId,
        { ...input, role: "admin" },
        invite,
        consoleOrigin(platformActor(principal.user), ip, now),
      );
    });
    return { user, invite: { token: invite.token, expiresAt: invite.expiresAt } };
  } catch (err) {
    throw asEmailTaken(err);
  }
}

/**
 * 暂停或恢复租户。暂停不影响该租户用户的登录和已有会话（需求文档「租户状态」：暂停 = 商品不参与比价、
 * 已有订单继续履约）；这里只改状态并写审计，状态的业务含义由 M4-01 实现。状态没变化时不重复处理。
 */
export async function changeTenantStatus(
  ctx: AppContext,
  principal: PlatformPrincipal,
  tenantId: string,
  status: TenantStatus,
  reason: string | null,
  ip: string,
): Promise<Tenant> {
  const now = ctx.now();
  return withPlatformTx(ctx.pool, async (db) => {
    const before = await findTenantForPlatform(db, tenantId, { lock: true });
    if (!before) throw notFound("租户");
    if (before.status === status) return before;
    const after = await setTenantStatus(db, tenantId, status, now);
    await insertAuditLog(db, consoleOrigin(platformActor(principal.user), ip, now), {
      tenantId,
      resource: "tenant",
      resourceId: tenantId,
      action: status === "suspended" ? "suspend" : "resume",
      before: { status: before.status },
      after: reason === null ? { status: after.status } : { status: after.status, reason },
    });
    return after;
  });
}

/**
 * 平台给某个租户的管理员发一次性密码重置令牌（租户唯一的管理员忘了密码时用）。
 * 只对该租户里在用的管理员有效；邮箱不是这个租户的管理员时返回 404。
 */
export async function issueTenantAdminPasswordReset(
  ctx: AppContext,
  principal: PlatformPrincipal,
  tenantId: string,
  email: string,
  ip: string,
): Promise<{ user: TenantUser; reset: IssuedInvite }> {
  const now = ctx.now();
  return withPlatformTx(ctx.pool, async (db) => {
    const tenant = await findTenantForPlatform(db, tenantId, { lock: false });
    if (!tenant) throw notFound("租户");
    const target = await findTenantUserByEmail(db, tenantId, email, { lock: true });
    if (!target || target.user.role !== "admin") throw notFound("这个租户的管理员账号");
    const reset = await issueTenantPasswordResetInTx(db, tenantId, target, consoleOrigin(platformActor(principal.user), ip, now));
    return { user: target.user, reset };
  });
}
