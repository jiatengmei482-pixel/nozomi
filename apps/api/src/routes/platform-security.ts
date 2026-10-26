/**
 * 平台账号安全的接口（M4-05，ADR 0030）：两步验证、员工详情 / 改角色和 IP 白名单 / 重置两步验证、角色管理。
 * 这里只做鉴权、校验、调用、返回；流程在 services/platform-mfa.ts、platform-staff.ts、platform-roles.ts。
 *
 * - `auth/mfa/verify`、`auth/mfa/enrollment`、`auth/mfa/enrollment/confirm` 的用途是 `second_factor`：会话还没完成两步验证时放行。
 * - 其余接口是普通接口：两步验证没完成、必须先修改密码时被拦。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { IP_ALLOWLIST_MAX_ENTRIES, type PlatformAction, actionsOfGrants, isPlatformRole, platformPermissions } from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { type PlatformPrincipal, authenticatePlatform, platformCredentials } from "../services/platform-auth.ts";
import { type FactorInput, confirmPlatformEnrollment, regeneratePlatformRecoveryCodes, startPlatformEnrollment, verifyPlatformSecondFactor } from "../services/platform-mfa.ts";
import { type RoleInput, type RoleView, createRole, getRole, listRoles, removeRole, requestRoleChange } from "../services/platform-roles.ts";
import { type StaffDetail, getStaffMember, requestStaffMfaReset, updateStaff } from "../services/platform-staff.ts";
import { parseInput, personNameSchema, resourceId, uuidSchema, validationFailed } from "../validation.ts";
import { approvalJson } from "./channels.ts";
import { roleKeySchema } from "./platform.ts";
import { platformUserJson, staffJson } from "./serialize.ts";

type Json = Record<string, unknown>;

const codeSchema = z.string().trim().min(1).max(20);
const recoveryCodeSchema = z.string().trim().min(1).max(40);

/** 动态码和恢复码二选一 */
const factorSchema = z.object({ code: codeSchema.optional(), recovery_code: recoveryCodeSchema.optional() }).strict();

function factorInput(input: z.infer<typeof factorSchema>, required: boolean): FactorInput {
  if (input.code !== undefined && input.recovery_code !== undefined) {
    throw validationFailed("body", [{ path: "/", reason: "ONE_OF", message: "动态码和恢复码只填一个" }]);
  }
  if (required && input.code === undefined && input.recovery_code === undefined) {
    throw validationFailed("body", [{ path: "/code", reason: "REQUIRED", message: "请输入动态码或恢复码" }]);
  }
  return { code: input.code, recoveryCode: input.recovery_code };
}

const confirmSchema = z.object({ code: codeSchema }).strict();

const allowlistSchema = z.array(z.string().trim().min(1).max(64)).max(IP_ALLOWLIST_MAX_ENTRIES);

const staffPatchSchema = z
  .object({ name: personNameSchema.optional(), role: roleKeySchema.optional(), ip_allowlist: allowlistSchema.optional() })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "至少改一项");

const noteSchema = z.object({ request_note: z.string().trim().max(500).optional() }).strict();

const scopeIdsSchema = z.array(uuidSchema.transform((id) => id.toLowerCase())).max(500).nullable();

const roleBodySchema = z
  .object({
    name: z.string().trim().min(1).max(50),
    description: z.string().trim().max(500).nullable().optional(),
    grants: z.array(z.string().max(60)).max(100),
    data_scope: z.object({ city_ids: scopeIdsSchema, channel_ids: scopeIdsSchema }).strict().optional(),
    ip_allowlist: allowlistSchema.optional(),
  })
  .strict();

const roleChangeSchema = roleBodySchema.extend({ request_note: z.string().trim().max(500).optional() }).strict();

function roleInput(input: z.infer<typeof roleBodySchema>): RoleInput {
  return {
    name: input.name,
    description: input.description ?? null,
    grants: input.grants,
    scope: { cityIds: input.data_scope?.city_ids ?? null, channelIds: input.data_scope?.channel_ids ?? null },
    ipAllowlist: input.ip_allowlist ?? [],
  };
}

function roleKeyParam(params: unknown): string {
  const key = (params as { key?: unknown } | undefined)?.key;
  const parsed = roleKeySchema.safeParse(key);
  if (!parsed.success) throw validationFailed("body", [{ path: "/key", reason: "INVALID", message: "不是合法的角色" }]);
  return parsed.data;
}

export function roleJson(role: RoleView): Json {
  const permissions = role.builtin ? (isPlatformRole(role.key) ? [...platformPermissions(role.key)] : []) : actionsOfGrants(role.grants ?? []);
  return {
    key: role.key,
    name: role.name,
    builtin: role.builtin,
    description: role.description,
    grants: role.effectiveGrants,
    permissions,
    data_scope: {
      city_ids: role.scope.cityIds,
      channel_ids: role.scope.channelIds,
      cities: (role.scope.cityIds ?? []).map((id) => ({ id, name: role.scopeNames.cities.get(id) ?? null })),
      channels: (role.scope.channelIds ?? []).map((id) => ({ id, name: role.scopeNames.channels.get(id) ?? null })),
    },
    ip_allowlist: role.ipAllowlist,
    version: role.version,
    staff_count: role.staffCount,
    created_at: role.createdAt.toISOString(),
    updated_at: role.updatedAt.toISOString(),
  };
}

function staffDetailJson(detail: StaffDetail): Json {
  return { ...staffJson(detail.user), role_ip_allowlist: detail.roleIpAllowlist, recovery_codes_remaining: detail.user.totpEnabledAt === null ? null : detail.recoveryCodesRemaining };
}

export function registerPlatformSecurityRoutes(app: FastifyInstance, ctx: AppContext): void {
  const authenticate = (request: FastifyRequest, action?: PlatformAction): Promise<PlatformPrincipal> =>
    authenticatePlatform(ctx, platformCredentials(request), action === undefined ? {} : { action });
  const secondFactor = (request: FastifyRequest): Promise<PlatformPrincipal> => authenticatePlatform(ctx, platformCredentials(request), { purpose: "second_factor" });

  // ---- 两步验证 ----

  app.post("/platform/v1/auth/mfa/verify", async (request) => {
    const principal = await secondFactor(request);
    const input = factorInput(parseInput(factorSchema, request.body, "body"), true);
    const result = await verifyPlatformSecondFactor(ctx, principal, input, request.ip);
    return {
      user: platformUserJson(result.user),
      must_change_password: result.user.mustChangePassword,
      second_factor: { status: "verified", method: result.method, recovery_codes_remaining: result.recoveryCodesRemaining },
    };
  });

  app.post("/platform/v1/auth/mfa/enrollment", async (request) => {
    const principal = await secondFactor(request);
    const input = factorInput(parseInput(factorSchema, request.body ?? {}, "body"), false);
    const started = await startPlatformEnrollment(ctx, principal, input, request.ip);
    return { secret: started.secret, otpauth_uri: started.otpauthUri, expires_at: started.expiresAt.toISOString() };
  });

  app.post("/platform/v1/auth/mfa/enrollment/confirm", async (request) => {
    const principal = await secondFactor(request);
    const input = parseInput(confirmSchema, request.body, "body");
    const result = await confirmPlatformEnrollment(ctx, principal, input.code, request.ip);
    return {
      user: platformUserJson(result.user),
      must_change_password: result.user.mustChangePassword,
      second_factor: { status: "verified", method: "enrollment", recovery_codes_remaining: result.recoveryCodes.length },
      recovery_codes: result.recoveryCodes,
    };
  });

  app.post("/platform/v1/auth/mfa/recovery-codes", async (request) => {
    const principal = await authenticate(request);
    const input = factorInput(parseInput(factorSchema, request.body, "body"), true);
    return { recovery_codes: await regeneratePlatformRecoveryCodes(ctx, principal, input, request.ip) };
  });

  // ---- 员工 ----

  app.get("/platform/v1/staff/:id", async (request) => {
    await authenticate(request, "staff.read");
    return staffDetailJson(await getStaffMember(ctx, resourceId(request.params, "账号")));
  });

  app.patch("/platform/v1/staff/:id", async (request) => {
    const principal = await authenticate(request, "staff.manage");
    const id = resourceId(request.params, "账号");
    const input = parseInput(staffPatchSchema, request.body, "body");
    return staffDetailJson(await updateStaff(ctx, principal, id, { name: input.name, role: input.role, ipAllowlist: input.ip_allowlist }, request.ip));
  });

  app.post("/platform/v1/staff/:id/mfa-reset", async (request, reply) => {
    const principal = await authenticate(request, "staff.manage");
    const id = resourceId(request.params, "账号");
    const input = parseInput(noteSchema, request.body ?? {}, "body");
    const approval = await requestStaffMfaReset(ctx, principal, id, input.request_note ?? null, request.ip);
    return reply.code(202).send({ approval: approvalJson(approval, principal) });
  });

  // ---- 角色 ----

  app.get("/platform/v1/roles", async (request) => {
    await authenticate(request, "role.read");
    return { items: (await listRoles(ctx)).map(roleJson) };
  });

  app.get("/platform/v1/roles/:key", async (request) => {
    await authenticate(request, "role.read");
    return roleJson(await getRole(ctx, roleKeyParam(request.params)));
  });

  app.post("/platform/v1/roles", async (request, reply) => {
    const principal = await authenticate(request, "role.manage");
    const input = parseInput(roleBodySchema, request.body, "body");
    return reply.code(201).send(roleJson(await createRole(ctx, principal, roleInput(input), request.ip)));
  });

  app.post("/platform/v1/roles/:key/changes", async (request, reply) => {
    const principal = await authenticate(request, "role.manage");
    const key = roleKeyParam(request.params);
    const input = parseInput(roleChangeSchema, request.body, "body");
    const approval = await requestRoleChange(ctx, principal, key, roleInput(input), input.request_note ?? null, request.ip);
    return reply.code(202).send({ approval: approvalJson(approval, principal) });
  });

  app.delete("/platform/v1/roles/:key", async (request, reply) => {
    const principal = await authenticate(request, "role.manage");
    await removeRole(ctx, principal, roleKeyParam(request.params), request.ip);
    return reply.code(204).send();
  });
}
