/**
 * /platform/v1：平台员工的接口。这里只做鉴权、校验、调用、返回；流程在 services/。
 * 除登录和接受邀请外，每个接口的第一步都是 `authenticatePlatform`（带所需的操作）。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { integrationStatus } from "@nozomi/config";
import { PLATFORM_ROLES, type PlatformAction, type PlatformRole, platformPermissions } from "@nozomi/domain";
import { bearerToken } from "../auth/token.ts";
import type { AppContext } from "../context.ts";
import { withPlatformTx } from "../db/context.ts";
import { decodeSequenceCursor, decodeTimeCursor } from "../pagination.ts";
import { insertAuditLog, listAuditLogsAcrossTenants } from "../repos/audit-logs.ts";
import { consoleOrigin, platformActor } from "../services/audit.ts";
import {
  type PlatformPrincipal,
  acceptPlatformInvite,
  authenticatePlatform,
  changePlatformPassword,
  platformLogin,
  platformLogout,
  resetPlatformPassword,
} from "../services/platform-auth.ts";
import { inviteStaff, issueStaffPasswordReset, listStaff, setStaffStatus } from "../services/platform-staff.ts";
import {
  changeTenantStatus,
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
  uuidSchema,
} from "../validation.ts";
import { auditLogJson, inviteJson, pageJson, platformUserJson, tenantJson, tenantUserJson } from "./serialize.ts";

const PLATFORM_ROLE_KEYS = PLATFORM_ROLES.map((role) => role.key) as [PlatformRole, ...PlatformRole[]];

const staffSchema = z.object({
  email: emailSchema,
  name: personNameSchema,
  role: z.enum(PLATFORM_ROLE_KEYS),
});

const adminSchema = z.object({ email: emailSchema, name: personNameSchema });

const tenantSchema = z.object({
  name: z.string().trim().min(1).max(100),
  admin: adminSchema,
});

const suspendSchema = z.object({ reason: z.string().trim().min(1).max(500).optional() });

const adminEmailSchema = z.object({ email: emailSchema });

const auditQuerySchema = auditFilterSchema.extend({ tenant_id: uuidSchema.optional() });

export function registerPlatformRoutes(app: FastifyInstance, ctx: AppContext): void {
  const authenticate = (request: FastifyRequest, action?: PlatformAction): Promise<PlatformPrincipal> =>
    authenticatePlatform(ctx, bearerToken(request.headers.authorization), action);

  app.post("/platform/v1/auth/login", async (request) => {
    const input = parseInput(loginSchema, request.body, "body");
    const result = await platformLogin(ctx, input, request.ip);
    return {
      access_token: result.accessToken,
      token_type: "Bearer",
      expires_at: result.expiresAt.toISOString(),
      user: platformUserJson(result.user),
    };
  });

  app.post("/platform/v1/auth/logout", async (request, reply) => {
    const principal = await authenticate(request);
    await platformLogout(ctx, principal, request.ip);
    return reply.code(204).send();
  });

  app.get("/platform/v1/auth/me", async (request) => {
    const principal = await authenticate(request);
    return { user: platformUserJson(principal.user), permissions: platformPermissions(principal.user.role) };
  });

  app.post("/platform/v1/auth/accept-invite", async (request) => {
    const input = parseInput(acceptInviteSchema, request.body, "body");
    return { user: platformUserJson(await acceptPlatformInvite(ctx, input, request.ip)) };
  });

  app.post("/platform/v1/auth/change-password", async (request, reply) => {
    const principal = await authenticate(request);
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
    return pageJson(page, platformUserJson);
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

  app.post("/platform/v1/tenants/:id/suspend", async (request) => {
    const principal = await authenticate(request, "tenant.change_status");
    const id = resourceId(request.params, "租户");
    const input = parseInput(suspendSchema, request.body, "body");
    return tenantJson(await changeTenantStatus(ctx, principal, id, "suspended", input.reason ?? null, request.ip));
  });

  app.post("/platform/v1/tenants/:id/resume", async (request) => {
    const principal = await authenticate(request, "tenant.change_status");
    const id = resourceId(request.params, "租户");
    return tenantJson(await changeTenantStatus(ctx, principal, id, "active", null, request.ip));
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

  app.get("/platform/v1/integrations", async (request) => {
    const principal = await authenticate(request, "integration.read");
    await withPlatformTx(ctx.pool, (db) =>
      insertAuditLog(db, consoleOrigin(platformActor(principal.user), request.ip, ctx.now()), {
        tenantId: null,
        resource: "integration",
        resourceId: null,
        action: "view",
        before: null,
        after: null,
      }),
    );
    return { items: integrationStatus(ctx.config) };
  });
}
