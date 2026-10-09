/**
 * /tenant/v1：租户用户的接口。这里只做鉴权、校验、调用、返回；流程在 services/。
 *
 * 租户编号只来自令牌（`principal.tenantId`）：这个文件里没有任何地方从请求参数或请求体读 tenant_id，
 * 校验结构里也没有这个字段，请求里带了会被丢掉。
 * 规则 4：这里的任何返回都不能包含对外价和加价比例。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { TENANT_ROLES, type TenantAction, type TenantRole, tenantPermissions } from "@nozomi/domain";
import { bearerToken } from "../auth/token.ts";
import type { AppContext } from "../context.ts";
import { decodeSequenceCursor, decodeTimeCursor } from "../pagination.ts";
import {
  type TenantPrincipal,
  acceptTenantInvite,
  authenticateTenant,
  changeTenantPassword,
  listOwnAuditLogs,
  resetTenantPassword,
  tenantLogin,
  tenantLogout,
} from "../services/tenant-auth.ts";
import { disableUser, inviteUser, issueUserPasswordReset, listUsers, updateUser } from "../services/tenant-users.ts";
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
} from "../validation.ts";
import { inviteJson, pageJson, tenantAuditLogJson, tenantJson, tenantUserJson } from "./serialize.ts";

const TENANT_ROLE_KEYS = TENANT_ROLES.map((role) => role.key) as [TenantRole, ...TenantRole[]];

const inviteUserSchema = z.object({
  email: emailSchema,
  name: personNameSchema,
  role: z.enum(TENANT_ROLE_KEYS),
});

const updateUserSchema = z.object({
  name: personNameSchema,
  role: z.enum(TENANT_ROLE_KEYS),
  status: z.enum(["invited", "active", "disabled"]),
});

export function registerTenantRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** 普通接口的鉴权：账号必须先修改密码时一律被拦（ADR 0013）。新接口都用这个。 */
  const authenticate = (request: FastifyRequest, action?: TenantAction): Promise<TenantPrincipal> =>
    authenticateTenant(ctx, bearerToken(request.headers.authorization), action === undefined ? {} : { action });
  /** 只给「查看自己、修改密码、退出」三个接口用：账号必须先修改密码时也放行。 */
  const authenticateSelfService = (request: FastifyRequest): Promise<TenantPrincipal> =>
    authenticateTenant(ctx, bearerToken(request.headers.authorization), { purpose: "self_service" });

  app.post("/tenant/v1/auth/login", async (request) => {
    const input = parseInput(loginSchema, request.body, "body");
    const result = await tenantLogin(ctx, input, request.ip);
    return {
      access_token: result.accessToken,
      token_type: "Bearer",
      expires_at: result.expiresAt.toISOString(),
      user: tenantUserJson(result.user),
      tenant: tenantJson(result.tenant),
      must_change_password: result.user.mustChangePassword,
    };
  });

  app.post("/tenant/v1/auth/logout", async (request, reply) => {
    const principal = await authenticateSelfService(request);
    await tenantLogout(ctx, principal, request.ip);
    return reply.code(204).send();
  });

  app.get("/tenant/v1/auth/me", async (request) => {
    const principal = await authenticateSelfService(request);
    return {
      user: tenantUserJson(principal.user),
      tenant: tenantJson(principal.tenant),
      permissions: tenantPermissions(principal.user.role),
      must_change_password: principal.user.mustChangePassword,
    };
  });

  app.post("/tenant/v1/auth/accept-invite", async (request) => {
    const input = parseInput(acceptInviteSchema, request.body, "body");
    return { user: tenantUserJson(await acceptTenantInvite(ctx, input, request.ip)) };
  });

  app.post("/tenant/v1/auth/change-password", async (request, reply) => {
    const principal = await authenticateSelfService(request);
    const input = parseInput(changePasswordSchema, request.body, "body");
    await changeTenantPassword(
      ctx,
      principal,
      { currentPassword: input.current_password, newPassword: input.new_password },
      request.ip,
    );
    return reply.code(204).send();
  });

  app.post("/tenant/v1/auth/reset-password", async (request) => {
    const input = parseInput(resetPasswordSchema, request.body, "body");
    return { user: tenantUserJson(await resetTenantPassword(ctx, input, request.ip)) };
  });

  app.get("/tenant/v1/users", async (request) => {
    const principal = await authenticate(request, "user.read");
    const query = parseInput(pageQuerySchema, request.query, "querystring");
    const page = await listUsers(ctx, principal.tenantId, query.limit, decodeTimeCursor(query.cursor ?? null));
    return pageJson(page, tenantUserJson);
  });

  app.post("/tenant/v1/users", async (request, reply) => {
    const principal = await authenticate(request, "user.manage");
    const input = parseInput(inviteUserSchema, request.body, "body");
    const invited = await inviteUser(ctx, principal, input, request.ip);
    return reply.code(201).send({ user: tenantUserJson(invited.user), invite: inviteJson(invited.invite) });
  });

  app.put("/tenant/v1/users/:id", async (request) => {
    const principal = await authenticate(request, "user.manage");
    const id = resourceId(request.params, "账号");
    const input = parseInput(updateUserSchema, request.body, "body");
    return tenantUserJson(await updateUser(ctx, principal, id, input, request.ip));
  });

  app.delete("/tenant/v1/users/:id", async (request, reply) => {
    const principal = await authenticate(request, "user.manage");
    const id = resourceId(request.params, "账号");
    await disableUser(ctx, principal, id, request.ip);
    return reply.code(204).send();
  });

  app.post("/tenant/v1/users/:id/password-reset", async (request, reply) => {
    const principal = await authenticate(request, "user.manage");
    const id = resourceId(request.params, "账号");
    const issued = await issueUserPasswordReset(ctx, principal, id, request.ip);
    return reply.code(201).send({ user: tenantUserJson(issued.user), reset: inviteJson(issued.reset) });
  });

  app.get("/tenant/v1/audit-logs", async (request) => {
    const principal = await authenticate(request, "audit_log.read");
    const query = parseInput(auditFilterSchema, request.query, "querystring");
    const page = await listOwnAuditLogs(
      ctx,
      principal.tenantId,
      {
        actorId: query.actor_id,
        resource: query.resource,
        resourceId: query.resource_id,
        action: query.action,
        from: query.from,
        to: query.to,
      },
      query.limit,
      decodeSequenceCursor(query.cursor ?? null),
    );
    return pageJson(page, tenantAuditLogJson);
  });
}
