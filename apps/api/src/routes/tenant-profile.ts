/**
 * 供应商名称和企业信息的维护（M4-34，ADR 0071）的接口。这里只做鉴权、校验、调用、返回；流程在 services/tenant-profile.ts。
 *
 * - 平台：`PATCH /platform/v1/tenants/:id`（改对外显示名称）、`PUT /platform/v1/tenants/:id/company/profile`（改企业信息）——`tenant.edit`；
 *   供应商的修改申请：看（`tenant.read`）、发起复核和驳回（`tenant.review`），批准在「待审核」里（`tenant.approve`）。
 * - 供应商：`/tenant/v1/company/profile-changes*`。租户编号只来自令牌；应答里没有平台员工的身份。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { PROFILE_CHANGE_NOTE_MAX, PROFILE_LIMITS, type PlatformAction, type TenantAction } from "@nozomi/domain";
import { bearerToken } from "../auth/token.ts";
import type { AppContext } from "../context.ts";
import type { ProfileChange } from "../repos/tenant-profile-changes.ts";
import { type PlatformPrincipal, authenticatePlatform, platformCredentials } from "../services/platform-auth.ts";
import { type TenantPrincipal, authenticateTenant } from "../services/tenant-auth.ts";
import {
  listChangesForPlatform,
  listOwnChanges,
  putProfileByPlatform,
  rejectProfileChange,
  renameTenantByPlatform,
  requestProfileChangeReview,
  submitProfileChange,
  withdrawProfileChange,
} from "../services/tenant-profile.ts";
import { ifMatchVersion, parseInput, resourceId } from "../validation.ts";
import { approvalJson } from "./channels.ts";
import { tenantJson } from "./serialize.ts";
import { profileFieldsOf, profileJson, profileSchema } from "./tenant-onboarding.ts";

type Json = Record<string, unknown>;

const renameSchema = z.object({ name: z.string().trim().min(1).max(PROFILE_LIMITS.name) }).strict();
// 长度按字符数在业务层查（日文、表情各算一个）；这里只挡明显超长的
const changeText = (max: number) => z.string().trim().max(max * 2).optional();
const changeSchema = z
  .object({
    name: changeText(PROFILE_LIMITS.name),
    legal_name: changeText(PROFILE_LIMITS.legal_name),
    registration_no: changeText(PROFILE_LIMITS.registration_no),
    note: z.string().trim().max(PROFILE_CHANGE_NOTE_MAX).nullable().optional().transform((value) => (value === undefined || value === null || value === "" ? null : value)),
  })
  .strict();
const noteSchema = z.object({ note: z.string().trim().max(PROFILE_CHANGE_NOTE_MAX).nullable().optional().transform((value) => (value === undefined || value === null || value === "" ? null : value)) });
const reasonSchema = z.object({ reason: z.string().trim().min(1).max(PROFILE_CHANGE_NOTE_MAX) });

const iso = (value: Date | null): string | null => (value === null ? null : value.toISOString());

/** 一条申请。`platform`：带提交人的姓名邮箱、驳回人、等审核的复核；供应商看到的没有平台员工的身份。 */
function changeJson(change: ProfileChange, platform: boolean): Json {
  return {
    id: change.id,
    fields: change.fields,
    proposed: change.proposed,
    previous: change.previous,
    note: change.note,
    status: change.status,
    submitted_by: platform ? { id: change.submittedBy.id, name: change.submittedBy.name, email: change.submittedBy.email } : { name: change.submittedBy.name },
    submitted_at: change.submittedAt.toISOString(),
    decided_at: iso(change.decidedAt),
    reject_reason: change.rejectReason,
    ...(platform ? { rejected_by: change.rejectedBy, approval_id: change.approvalId, pending_approval_id: change.pendingApprovalId } : {}),
    version: change.version,
  };
}

function secondId(params: unknown): string {
  return resourceId({ id: typeof params === "object" && params !== null ? (params as Record<string, unknown>)["changeId"] : undefined }, "修改申请");
}

export function registerTenantProfileRoutes(app: FastifyInstance, ctx: AppContext): void {
  const tenantAuth = (request: FastifyRequest, action: TenantAction): Promise<TenantPrincipal> => authenticateTenant(ctx, bearerToken(request.headers.authorization), { action });
  const platformAuth = (request: FastifyRequest, action: PlatformAction): Promise<PlatformPrincipal> => authenticatePlatform(ctx, platformCredentials(request), { action });

  // ---- 运营后台 ----

  app.patch("/platform/v1/tenants/:id", async (request) => {
    const principal = await platformAuth(request, "tenant.edit");
    const id = resourceId(request.params, "供应商");
    const version = ifMatchVersion(request.headers["if-match"]);
    const input = parseInput(renameSchema, request.body, "body");
    return tenantJson(await renameTenantByPlatform(ctx, principal, id, version, input.name, request.ip));
  });

  app.put("/platform/v1/tenants/:id/company/profile", async (request) => {
    const principal = await platformAuth(request, "tenant.edit");
    const id = resourceId(request.params, "供应商");
    // 还没有企业信息时不带 If-Match；以后每次都要带
    const version = request.headers["if-match"] === undefined ? null : ifMatchVersion(request.headers["if-match"]);
    const input = parseInput(profileSchema, request.body, "body");
    return profileJson(await putProfileByPlatform(ctx, principal, id, version, profileFieldsOf(input), request.ip));
  });

  app.get("/platform/v1/tenants/:id/profile-changes", async (request) => {
    await platformAuth(request, "tenant.read");
    return { items: (await listChangesForPlatform(ctx, resourceId(request.params, "供应商"))).map((change) => changeJson(change, true)) };
  });

  app.post("/platform/v1/tenants/:id/profile-changes/:changeId/approval", async (request, reply) => {
    const principal = await platformAuth(request, "tenant.review");
    const id = resourceId(request.params, "供应商");
    const changeId = secondId(request.params);
    const input = parseInput(noteSchema, request.body ?? {}, "body");
    const approval = await requestProfileChangeReview(ctx, principal, id, changeId, input.note, request.ip);
    return reply.code(202).send({ approval: approvalJson(approval, principal) });
  });

  app.post("/platform/v1/tenants/:id/profile-changes/:changeId/reject", async (request) => {
    const principal = await platformAuth(request, "tenant.review");
    const id = resourceId(request.params, "供应商");
    const changeId = secondId(request.params);
    const input = parseInput(reasonSchema, request.body, "body");
    return { change: changeJson(await rejectProfileChange(ctx, principal, id, changeId, input.reason, request.ip), true) };
  });

  // ---- 供应商 ----

  app.get("/tenant/v1/company/profile-changes", async (request) => {
    const principal = await tenantAuth(request, "company.read");
    return { items: (await listOwnChanges(ctx, principal.tenantId)).map((change) => changeJson(change, false)) };
  });

  app.post("/tenant/v1/company/profile-changes", async (request, reply) => {
    const principal = await tenantAuth(request, "company.manage");
    const input = parseInput(changeSchema, request.body, "body");
    const change = await submitProfileChange(
      ctx,
      principal,
      {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.legal_name === undefined ? {} : { legal_name: input.legal_name }),
        ...(input.registration_no === undefined ? {} : { registration_no: input.registration_no }),
        note: input.note,
      },
      request.ip,
    );
    return reply.code(201).send(changeJson(change, false));
  });

  app.post("/tenant/v1/company/profile-changes/:id/withdraw", async (request) => {
    const principal = await tenantAuth(request, "company.manage");
    return changeJson(await withdrawProfileChange(ctx, principal, resourceId(request.params, "修改申请"), request.ip), false);
  });
}
