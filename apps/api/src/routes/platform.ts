/**
 * /platform/v1：平台员工的接口。这里只做鉴权、校验、调用、返回；流程在 services/。
 * 除登录、接受邀请、凭重置令牌设密码外，每个接口的第一步都是鉴权（带所需的操作）。
 * 账号必须先修改密码时，鉴权这一步就会拦下除「查看自己、修改密码、退出」之外的全部接口（ADR 0013）。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { integrationStatus } from "@nozomi/config";
import { type PlatformAction, ROUTE_FAILURE_MESSAGES, type RouteFailureCode, fxTableState, routeCallAllowed, routeUsageDay } from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { withPlatformTx } from "../db/context.ts";
import { decodeSequenceCursor, decodeTimeCursor } from "../pagination.ts";
import { insertAuditLog, listAuditLogsAcrossTenants } from "../repos/audit-logs.ts";
import { listColleagues } from "../repos/platform-users.ts";
import { routeUsageStatus } from "../repos/route-estimates.ts";
import { latestFetch, latestRateSet } from "../repos/fx.ts";
import { consoleOrigin, platformActor } from "../services/audit.ts";
import { type DashboardSummary, type StatusCounts, getDashboardSummary } from "../services/dashboard.ts";
import {
  type PlatformPrincipal,
  acceptPlatformInvite,
  authenticatePlatform,
  platformCredentials,
  changePlatformPassword,
  checkPlatformInvite,
  checkPlatformResetToken,
  platformLogin,
  platformLogout,
  principalCan,
  resetPlatformPassword,
} from "../services/platform-auth.ts";
import { inviteStaff, issueStaffPasswordReset, listStaff, setStaffStatus } from "../services/platform-staff.ts";
import {
  createTenant,
  getTenant,
  inviteTenantAdmin,
  issueTenantAdminPasswordReset,
  listTenants,
} from "../services/platform-tenants.ts";
import {
  acceptInviteSchema,
  auditFilterSchema,
  changePasswordSchema,
  emailSchema,
  loginSchema,
  pageQuerySchema,
  parseInput,
  personNameSchema,
  resetPasswordSchema,
  resourceId,
  tokenCheckSchema,
  uuidSchema,
} from "../validation.ts";
import { auditLogJson, inviteJson, pageJson, platformUserJson, staffJson, tenantJson, tenantUserJson } from "./serialize.ts";
import { recoveryCodesRemaining } from "../services/platform-mfa.ts";

/** 角色键：内置角色或自建角色（`custom_` + 16 位十六进制）；存不存在由业务层查（400 `ROLE_NOT_FOUND`） */
export const roleKeySchema = z.string().regex(/^([a-z_]{2,40}|custom_[0-9a-f]{16})$/, "不是合法的角色");

const staffSchema = z.object({
  email: emailSchema,
  name: personNameSchema,
  role: roleKeySchema,
});

const adminSchema = z.object({ email: emailSchema, name: personNameSchema });

const tenantSchema = z.object({
  name: z.string().trim().min(1).max(100),
  admin: adminSchema,
});

const adminEmailSchema = z.object({ email: emailSchema });

const auditQuerySchema = auditFilterSchema.extend({ tenant_id: uuidSchema.optional() });

function statusCountsJson(counts: StatusCounts): Record<string, number> {
  return { total: counts.total, active: counts.active, disabled: counts.disabled };
}

function dashboardSummaryJson(summary: DashboardSummary): Record<string, unknown> {
  const master = summary.masterData;
  return {
    tenants: summary.tenants === null ? null : { total: summary.tenants.total, active: summary.tenants.active, suspended: summary.tenants.suspended, bidding: summary.tenants.bidding, by_status: summary.tenants.byStatus },
    master_data:
      master === null
        ? null
        : {
            cities: statusCountsJson(master.cities),
            places: {
              ...statusCountsJson(master.places),
              by_type: Object.fromEntries(Object.entries(master.places.byType).map(([type, counts]) => [type, statusCountsJson(counts)])),
              airports_without_city: master.places.airportsWithoutCity,
            },
            vehicle_groups: statusCountsJson(master.vehicleGroups),
            addons: statusCountsJson(master.addons),
          },
    fx:
      summary.fx === null
        ? null
        : {
            state: summary.fx.state,
            as_of: summary.fx.asOf?.toISOString() ?? null,
            stale_at: summary.fx.staleAt?.toISOString() ?? null,
            held: summary.fx.held,
            last_attempt_status: summary.fx.lastAttemptStatus,
            locks: summary.fx.locks.map((lock) => ({ currency: lock.currency, rate: lock.rate, expires_at: lock.expiresAt.toISOString() })),
          },
  };
}

export function registerPlatformRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** 普通接口的鉴权：账号必须先修改密码时一律被拦（ADR 0013）。新接口都用这个。 */
  const authenticate = (request: FastifyRequest, action?: PlatformAction): Promise<PlatformPrincipal> =>
    authenticatePlatform(ctx, platformCredentials(request), action === undefined ? {} : { action });
  /** 只给「查看自己、退出」用：两步验证没完成、账号必须先修改密码时也放行。 */
  const authenticateSelfService = (request: FastifyRequest): Promise<PlatformPrincipal> =>
    authenticatePlatform(ctx, platformCredentials(request), { purpose: "self_service" });

  app.post("/platform/v1/auth/login", async (request) => {
    const input = parseInput(loginSchema, request.body, "body");
    const result = await platformLogin(ctx, input, request.ip);
    return {
      access_token: result.accessToken,
      token_type: "Bearer",
      expires_at: result.expiresAt.toISOString(),
      user: platformUserJson(result.user),
      must_change_password: result.user.mustChangePassword,
      // 密码对了只是第一步（ADR 0030）：接着输入动态码，或者先绑定
      second_factor: { status: result.secondFactor },
    };
  });

  app.post("/platform/v1/auth/logout", async (request, reply) => {
    const principal = await authenticateSelfService(request);
    await platformLogout(ctx, principal, request.ip);
    return reply.code(204).send();
  });

  app.get("/platform/v1/auth/me", async (request) => {
    const principal = await authenticateSelfService(request);
    const verified = principal.secondFactor === "verified";
    const scope = principal.grant.scope;
    return {
      user: platformUserJson(principal.user),
      // 两步验证完成之前不给权限清单（前端只显示两步验证的页面）
      permissions: verified ? [...principal.grant.actions] : [],
      data_scope: { city_ids: scope.cityIds, channel_ids: scope.channelIds },
      must_change_password: principal.user.mustChangePassword,
      second_factor: {
        status: principal.secondFactor,
        enabled_at: principal.user.totpEnabledAt?.toISOString() ?? null,
        recovery_codes_remaining: verified ? await recoveryCodesRemaining(ctx, principal.user.id) : null,
      },
    };
  });

  app.post("/platform/v1/auth/accept-invite", async (request) => {
    const input = parseInput(acceptInviteSchema, request.body, "body");
    return { user: platformUserJson(await acceptPlatformInvite(ctx, input, request.ip)) };
  });

  app.post("/platform/v1/auth/check-invite", async (request, reply) => {
    const input = parseInput(tokenCheckSchema, request.body, "body");
    await checkPlatformInvite(ctx, input.token);
    return reply.code(204).send();
  });

  app.post("/platform/v1/auth/check-reset-token", async (request, reply) => {
    const input = parseInput(tokenCheckSchema, request.body, "body");
    await checkPlatformResetToken(ctx, input.token);
    return reply.code(204).send();
  });

  app.post("/platform/v1/auth/change-password", async (request, reply) => {
    // 要先完成两步验证（只知道密码的人不能改密码把本人锁在门外）；必须先修改密码时放行
    const principal = await authenticatePlatform(ctx, platformCredentials(request), { purpose: "password_change" });
    const input = parseInput(changePasswordSchema, request.body, "body");
    await changePlatformPassword(
      ctx,
      principal,
      { currentPassword: input.current_password, newPassword: input.new_password },
      request.ip,
    );
    return reply.code(204).send();
  });

  app.post("/platform/v1/auth/reset-password", async (request) => {
    const input = parseInput(resetPasswordSchema, request.body, "body");
    return { user: platformUserJson(await resetPlatformPassword(ctx, input, request.ip)) };
  });

  app.get("/platform/v1/staff", async (request) => {
    await authenticate(request, "staff.read");
    const query = parseInput(pageQuerySchema, request.query, "querystring");
    const page = await listStaff(ctx, query.limit, decodeTimeCursor(query.cursor ?? null));
    return pageJson(page, staffJson);
  });

  app.post("/platform/v1/staff", async (request, reply) => {
    const principal = await authenticate(request, "staff.manage");
    const input = parseInput(staffSchema, request.body, "body");
    const created = await inviteStaff(ctx, principal, input, request.ip);
    return reply.code(201).send({ user: platformUserJson(created.user), invite: inviteJson(created.invite) });
  });

  app.post("/platform/v1/staff/:id/disable", async (request) => {
    const principal = await authenticate(request, "staff.manage");
    const id = resourceId(request.params, "账号");
    return platformUserJson(await setStaffStatus(ctx, principal, id, "disabled", request.ip));
  });

  app.post("/platform/v1/staff/:id/enable", async (request) => {
    const principal = await authenticate(request, "staff.manage");
    const id = resourceId(request.params, "账号");
    return platformUserJson(await setStaffStatus(ctx, principal, id, "active", request.ip));
  });

  app.post("/platform/v1/staff/:id/password-reset", async (request, reply) => {
    const principal = await authenticate(request, "staff.manage");
    const id = resourceId(request.params, "账号");
    const issued = await issueStaffPasswordReset(ctx, principal, id, request.ip);
    return reply.code(201).send({ user: platformUserJson(issued.user), reset: inviteJson(issued.reset) });
  });

  app.get("/platform/v1/tenants", async (request) => {
    await authenticate(request, "tenant.read");
    const query = parseInput(pageQuerySchema, request.query, "querystring");
    const page = await listTenants(ctx, query.limit, decodeTimeCursor(query.cursor ?? null));
    return pageJson(page, tenantJson);
  });

  app.post("/platform/v1/tenants", async (request, reply) => {
    const principal = await authenticate(request, "tenant.create");
    const input = parseInput(tenantSchema, request.body, "body");
    const created = await createTenant(ctx, principal, input, request.ip);
    return reply.code(201).send({
      tenant: tenantJson(created.tenant),
      admin_user: tenantUserJson(created.adminUser),
      invite: inviteJson(created.invite),
    });
  });

  app.get("/platform/v1/tenants/:id", async (request) => {
    await authenticate(request, "tenant.read");
    return tenantJson(await getTenant(ctx, resourceId(request.params, "租户")));
  });

  app.post("/platform/v1/tenants/:id/admin-invites", async (request, reply) => {
    const principal = await authenticate(request, "tenant.create");
    const id = resourceId(request.params, "租户");
    const input = parseInput(adminSchema, request.body, "body");
    const invited = await inviteTenantAdmin(ctx, principal, id, input, request.ip);
    return reply.code(201).send({ user: tenantUserJson(invited.user), invite: inviteJson(invited.invite) });
  });

  app.post("/platform/v1/tenants/:id/admin-password-resets", async (request, reply) => {
    const principal = await authenticate(request, "tenant.create");
    const id = resourceId(request.params, "租户");
    const input = parseInput(adminEmailSchema, request.body, "body");
    const issued = await issueTenantAdminPasswordReset(ctx, principal, id, input.email, request.ip);
    return reply.code(201).send({ user: tenantUserJson(issued.user), reset: inviteJson(issued.reset) });
  });

  app.get("/platform/v1/audit-logs", async (request) => {
    await authenticate(request, "audit_log.read");
    const query = parseInput(auditQuerySchema, request.query, "querystring");
    const page = await withPlatformTx(ctx.pool, (db) =>
      listAuditLogsAcrossTenants(
        db,
        {
          actorId: query.actor_id,
          tenantId: query.tenant_id,
          resource: query.resource,
          resourceId: query.resource_id,
          action: query.action,
          from: query.from,
          to: query.to,
        },
        query.limit,
        decodeSequenceCursor(query.cursor ?? null),
      ),
    );
    return pageJson(page, auditLogJson);
  });

  app.get("/platform/v1/dashboard/summary", async (request) => {
    const principal = await authenticate(request);
    return dashboardSummaryJson(await getDashboardSummary(ctx, principal.grant));
  });

  // 同事名单（M4-03）：处理人、判定人在页面上显示成名字，异常和工单转交时从里面选。只有编号、姓名、是否在用，任何已登录的平台员工都能看
  app.get("/platform/v1/colleagues", async (request) => {
    await authenticate(request);
    return { items: await withPlatformTx(ctx.pool, (db) => listColleagues(db)) };
  });

  app.get("/platform/v1/integrations", async (request) => {
    const principal = await authenticate(request, "integration.read");
    const now = ctx.now();
    const fx = await withPlatformTx(ctx.pool, async (db) => {
      await insertAuditLog(db, consoleOrigin(platformActor(principal.user), request.ip, now), {
        tenantId: null,
        resource: "integration",
        resourceId: null,
        action: "view",
        before: null,
        after: null,
      });
      const current = await latestRateSet(db);
      return { current, last: await latestFetch(db), routes: await routeUsageStatus(db, routeUsageDay(now)) };
    });
    return {
      // 谷歌地图、Stripe 按生效的值、标出来源（ADR 0041）；打码后的末 4 位只给能管理密钥的人（超级管理员）
      items: integrationStatus(ctx.config, { effective: ctx.integrations.effective, hints: principalCan(principal, "integration.manage") }),
      // 汇率数据源的运行状态（ADR 0022）：超过 48 小时没更新是 stale，跨币种报价已暂停
      fx_center: {
        state: fxTableState(fx.current?.asOf.toISOString() ?? null, now),
        as_of: fx.current?.asOf.toISOString() ?? null,
        auto_fetch: ctx.config.fx.autoFetch,
        last_attempt_status: fx.last?.status ?? null,
        last_attempt_at: fx.last?.startedAt.toISOString() ?? null,
        last_error_code: fx.last?.errorCode ?? null,
      },
      // 路线预估（谷歌地图 Routes API，ADR 0042）：今天（东京时间）调用了几次、每日上限、失败和被上限挡下的次数，最近一次成功和失败
      routes: {
        day: fx.routes.day,
        calls: fx.routes.calls,
        daily_limit: ctx.config.routes.dailyLimit,
        daily_limit_reached: !routeCallAllowed(fx.routes.calls, ctx.config.routes.dailyLimit),
        failures: fx.routes.failures,
        refused: fx.routes.refused,
        last_success_at: fx.routes.lastSuccessAt?.toISOString() ?? null,
        last_failure:
          fx.routes.lastFailure === null
            ? null
            : { code: fx.routes.lastFailure.code, message: ROUTE_FAILURE_MESSAGES[fx.routes.lastFailure.code as RouteFailureCode] ?? null, at: fx.routes.lastFailure.at.toISOString() },
      },
    };
  });
}
