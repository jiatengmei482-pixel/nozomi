/**
 * 供应商入驻的接口（M4-01，ADR 0028）。这里只做鉴权、校验、调用、返回；流程在 services/tenant-onboarding.ts。
 *
 * - `/tenant/v1/company*`、`/tenant/v1/performance`：供应商自己的企业信息、资质、合同、状态记录、提醒、评分。租户编号只来自令牌；
 *   这里的应答没有对外价和加价比例（规则 4），也没有平台员工的身份和内部说明。
 * - `/platform/v1/tenants/:id/*`、`/platform/v1/tenant-documents`：运营的审核、合同、状态动作、详情页。
 * 文件上传：请求体就是文件本身（PDF / JPEG / PNG，最大 10 MB），`Content-Type` 写文件的类型；文件名放在查询参数 `file_name`。
 * 文件下载：原样返回，带 `X-Content-Type-Options: nosniff` 和 `Content-Security-Policy: sandbox`，伪装成图片的内容不会被浏览器当页面执行。
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_INFO,
  type DocumentRequirement,
  type PlatformAction,
  SCORE_WEIGHTS_BP,
  type ScoreComponent,
  TENANT_RULES,
  type TenantAction,
  type TenantIssue,
  addDays,
  computeTenantScore,
  requiredDocumentTypes,
} from "@nozomi/domain";
import { bearerToken } from "../auth/token.ts";
import type { AppContext } from "../context.ts";
import { withPlatformTx, withTenantTx } from "../db/context.ts";
import { decodeTimeCursor } from "../pagination.ts";
import type { Approval } from "../repos/approvals.ts";
import { type Notice, type ScoreDay, type StatusEvent, type StoredContract, type StoredDocument, type StoredFileMeta, type StoredProfile, listScoreDays } from "../repos/tenant-onboarding.ts";
import { findOwnTenant, findTenantForPlatform, type Tenant } from "../repos/tenants.ts";
import { notFound } from "../services/errors.ts";
import { type PlatformPrincipal, authenticatePlatform, platformCredentials } from "../services/platform-auth.ts";
import { type TenantPrincipal, authenticateTenant } from "../services/tenant-auth.ts";
import {
  type CompanyOverview,
  type UploadInput,
  getCompanyForPlatform,
  getFileForPlatform,
  getOwnCompany,
  getOwnFile,
  listDocumentQueueForPlatform,
  listOwnContracts,
  listOwnNotices,
  listOwnStatusEvents,
  listStatusEventsForPlatform,
  putOwnProfile,
  requestContract,
  requestSuspendTenant,
  requestTerminateTenant,
  resumeTenant,
  reviewDocument,
  signTenant,
  startTrial,
  submitForReview,
  submitOwnDocument,
  tenantToday,
  uploadContractFile,
  uploadOwnFile,
} from "../services/tenant-onboarding.ts";
import { ifMatchVersion, pageQuerySchema, parseInput, resourceId, uuidSchema } from "../validation.ts";
import { approvalJson } from "./channels.ts";
import { tenantJson } from "./serialize.ts";

type Json = Record<string, unknown>;

const FILE_TYPES = ["application/pdf", "image/jpeg", "image/png", "application/octet-stream"];
/** 请求体上限比文件上限多一点：超过文件上限的由业务层报 413（统一的错误格式），远超的由框架直接拒绝 */
const UPLOAD_BODY_LIMIT = TENANT_RULES.maxFileBytes + 1024;

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional().transform((value) => (value === undefined || value === null || value === "" ? null : value));
const reasonSchema = z.string().trim().min(1).max(TENANT_RULES.maxReasonLength);

const profileSchema = z.object({
  country_code: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "两位国家代码，如 JP").nullable(),
  legal_name: optionalText(200),
  registration_no: optionalText(100),
  address: optionalText(300),
  contact_name: optionalText(100),
  contact_phone: optionalText(40),
  contact_email: z.string().trim().toLowerCase().max(254).email().nullable().optional().transform((value) => value ?? null),
});

const documentSchema = z.object({
  type: z.enum(DOCUMENT_TYPES),
  file_id: uuidSchema,
  expires_on: z.string().max(10).nullable().optional().transform((value) => value ?? null),
  note: optionalText(TENANT_RULES.maxReasonLength),
});

const fileQuerySchema = z.object({ file_name: z.string().max(500).optional() });
const limitSchema = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) });
const scoreQuerySchema = z.object({ days: z.coerce.number().int().min(1).max(366).default(TENANT_RULES.scoreWindowDays) });
const queueQuerySchema = pageQuerySchema.extend({ kind: z.enum(["pending", "expiring"]).default("pending"), within_days: z.coerce.number().int().min(0).max(366).default(30) });
const approveSchema = z.object({ expires_on: z.string().max(10).nullable().optional() });
const decisionSchema = z.object({ reason: reasonSchema });
const noteSchema = z.object({ note: optionalText(TENANT_RULES.maxReasonLength) });
const startTrialSchema = z.object({ test_order_note: reasonSchema });
const contractSchema = z.object({ valid_from: z.string().max(10), settle_currency: z.string().trim().toUpperCase().max(3), file_id: uuidSchema.nullable().optional().transform((value) => value ?? null), note: optionalText(TENANT_RULES.maxReasonLength) });

const iso = (value: Date | null): string | null => (value === null ? null : value.toISOString());

// ---- 序列化 ----

function profileJson(profile: StoredProfile | null): Json | null {
  if (profile === null) return null;
  return {
    country_code: profile.countryCode,
    legal_name: profile.legalName,
    registration_no: profile.registrationNo,
    address: profile.address,
    contact_name: profile.contactName,
    contact_phone: profile.contactPhone,
    contact_email: profile.contactEmail,
    version: profile.version,
    updated_at: profile.updatedAt.toISOString(),
  };
}

function fileJson(file: StoredFileMeta): Json {
  return { id: file.id, purpose: file.purpose, content_type: file.contentType, byte_size: file.byteSize, sha256: file.sha256, file_name: file.fileName, uploaded_at: file.uploadedAt.toISOString() };
}

/** 一份资质。`platform`：审核人带姓名和邮箱（供应商只看到「平台」审核的，不知道是谁）。 */
function documentJson(document: StoredDocument, platform: boolean): Json {
  return {
    id: document.id,
    type: document.type,
    type_name: DOCUMENT_TYPE_INFO[document.type].name,
    status: document.status,
    expires_on: document.expiresOn,
    note: document.note,
    file: { id: document.fileId, content_type: document.file.contentType, byte_size: document.file.byteSize, file_name: document.file.fileName },
    submitted_at: document.submittedAt.toISOString(),
    reviewed_at: iso(document.reviewedAt),
    review_reason: document.reviewReason,
    ...(platform ? { reviewed_by: document.reviewedBy } : {}),
  };
}

function requirementJson(item: DocumentRequirement): Json {
  return {
    type: item.type,
    type_name: DOCUMENT_TYPE_INFO[item.type].name,
    required: item.required,
    expiry: DOCUMENT_TYPE_INFO[item.type].expiry,
    state: item.state,
    approved_document_id: item.approved?.id ?? null,
    latest_document_id: item.latest?.id ?? null,
    expires_on: item.approved?.expiresOn ?? null,
    days_left: item.daysLeft,
  };
}

function contractJson(contract: StoredContract): Json {
  return {
    id: contract.id,
    version: contract.version,
    valid_from: contract.validFrom,
    settle_currency: contract.settleCurrency,
    settle_cycle: contract.settleCycle,
    payment_day: contract.paymentDay,
    service_fee_bp: 0,
    deposit: 0,
    file_id: contract.fileId,
    note: contract.note,
    created_at: contract.createdAt.toISOString(),
  };
}

function issueJson(issue: TenantIssue): Json {
  return { path: issue.path, reason: issue.reason, ...(issue.detail === undefined ? {} : { detail: issue.detail }) };
}

function overviewJson(overview: CompanyOverview, platform: boolean): Json {
  const country = overview.profile?.countryCode ?? null;
  return {
    tenant: tenantJson(overview.tenant),
    today: overview.today,
    profile: profileJson(overview.profile),
    required_document_types: requiredDocumentTypes(country),
    requirements: overview.requirements.map(requirementJson),
    documents: overview.documents.map((document) => documentJson(document, platform)),
    contracts: overview.contracts.map(contractJson),
    effective_contract: overview.effectiveContract === null ? null : contractJson(overview.effectiveContract),
    next_step_issues: overview.nextStepIssues.map(issueJson),
  };
}

/** 状态记录。供应商看到的没有操作者的身份和说明（人工暂停的原因、测试单说明是平台内部的记录），只有「平台 / 系统 / 你们自己」和原因代码。 */
function statusEventJson(event: StatusEvent, platform: boolean): Json {
  return {
    id: event.id,
    trigger: event.trigger,
    from_status: event.fromStatus,
    to_status: event.toStatus,
    suspension_before: event.suspensionBefore,
    suspension_after: event.suspensionAfter,
    observation_before: event.observationBefore,
    observation_after: event.observationAfter,
    actor: platform ? { type: event.actor.type, id: event.actor.id, email: event.actor.email } : { type: event.actor.type },
    ...(platform ? { note: event.note, approval_id: event.approvalId } : {}),
    occurred_at: event.occurredAt.toISOString(),
  };
}

function noticeJson(notice: Notice): Json {
  return { id: notice.id, kind: notice.kind, data: notice.data, created_at: notice.createdAt.toISOString() };
}

function scoreDayJson(day: ScoreDay): Json {
  const result = computeTenantScore(day.input);
  return {
    date: day.date,
    window_from: day.windowFrom,
    score_centi: day.scoreCenti,
    raw_score_centi: day.rawScoreCenti,
    is_default: day.isDefault,
    completed_orders: day.input.completedOrders,
    no_shows: day.noShows,
    components: Object.fromEntries((Object.keys(SCORE_WEIGHTS_BP) as ScoreComponent[]).map((key) => [key, { value: result.components[key].value, points_centi: result.components[key].pointsCenti, weight_bp: result.components[key].weightBp }])),
    inputs: {
      dispatch_on_time: day.input.dispatch.onTime,
      dispatch_total: day.input.dispatch.total,
      arrival_on_time: day.input.arrival.onTime,
      arrival_total: day.input.arrival.total,
      rating_sum: day.input.ratings.sum,
      rating_count: day.input.ratings.count,
      upheld_complaints: day.input.upheldComplaints,
      failures: day.input.failures,
    },
  };
}

function performanceJson(tenant: Tenant, days: ScoreDay[], today: string): Json {
  const latest = days.at(-1) ?? null;
  return {
    today,
    status: tenant.status,
    observation_reasons: tenant.observationReasons,
    suspension_reasons: tenant.suspensionReasons,
    rules: {
      window_days: TENANT_RULES.scoreWindowDays,
      default_score_centi: 450,
      min_completed_orders: 20,
      observation_below_centi: TENANT_RULES.observationBelowCenti,
      suspend_below_centi: TENANT_RULES.suspendBelowCenti,
      no_show_window_days: TENANT_RULES.noShowWindowDays,
      no_show_observation: TENANT_RULES.noShowObservationCount,
      no_show_suspend: TENANT_RULES.noShowSuspendCount,
      weights_bp: SCORE_WEIGHTS_BP,
      trial_daily_order_limit: TENANT_RULES.trialDailyOrderLimit,
    },
    latest: latest === null ? null : scoreDayJson(latest),
    trend: days.map((day) => ({ date: day.date, score_centi: day.scoreCenti, raw_score_centi: day.rawScoreCenti, is_default: day.isDefault, completed_orders: day.input.completedOrders })),
  };
}

function sendFile(reply: FastifyReply, file: StoredFileMeta & { data: Buffer }): FastifyReply {
  const ascii = file.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return reply
    .header("content-type", file.contentType)
    .header("content-disposition", `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`)
    .header("x-content-type-options", "nosniff")
    .header("content-security-policy", "default-src 'none'; sandbox")
    .send(file.data);
}

function uploadInput(request: FastifyRequest): UploadInput {
  const query = parseInput(fileQuerySchema, request.query, "querystring");
  const declared = typeof request.headers["content-type"] === "string" ? (request.headers["content-type"].split(";")[0] ?? "").trim().toLowerCase() : null;
  return { bytes: Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0), declaredType: declared, fileName: query.file_name ?? null };
}

function approvalResponse(approval: Approval, principal: PlatformPrincipal): Json {
  return { approval: approvalJson(approval, principal) };
}

/** 路径里的第二个编号（`:fileId`、`:documentId`）：格式不对按不存在处理。 */
function secondId(params: unknown, key: string, what: string): string {
  return resourceId({ id: typeof params === "object" && params !== null ? (params as Record<string, unknown>)[key] : undefined }, what);
}

export function registerTenantOnboardingRoutes(app: FastifyInstance, ctx: AppContext): void {
  const tenantAuth = (request: FastifyRequest, action: TenantAction): Promise<TenantPrincipal> => authenticateTenant(ctx, bearerToken(request.headers.authorization), { action });
  const platformAuth = (request: FastifyRequest, action: PlatformAction): Promise<PlatformPrincipal> => authenticatePlatform(ctx, platformCredentials(request), { action });

  app.register(async (scoped) => {
    for (const type of FILE_TYPES) {
      if (!scoped.hasContentTypeParser(type)) scoped.addContentTypeParser(type, { parseAs: "buffer" }, (_request, body, done) => done(null, body));
    }
    const upload = { bodyLimit: UPLOAD_BODY_LIMIT };

    // ---- 供应商 ----

    scoped.get("/tenant/v1/company", async (request) => {
      const principal = await tenantAuth(request, "company.read");
      return overviewJson(await getOwnCompany(ctx, principal.tenantId), false);
    });

    scoped.put("/tenant/v1/company/profile", async (request) => {
      const principal = await tenantAuth(request, "company.manage");
      // 第一次填写没有版本，不带 If-Match；以后每次都要带
      const version = request.headers["if-match"] === undefined ? null : ifMatchVersion(request.headers["if-match"]);
      const input = parseInput(profileSchema, request.body, "body");
      const saved = await putOwnProfile(
        ctx,
        principal,
        version,
        { countryCode: input.country_code, legalName: input.legal_name, registrationNo: input.registration_no, address: input.address, contactName: input.contact_name, contactPhone: input.contact_phone, contactEmail: input.contact_email },
        request.ip,
      );
      return profileJson(saved);
    });

    scoped.post("/tenant/v1/company/files", upload, async (request, reply) => {
      const principal = await tenantAuth(request, "company.manage");
      return reply.code(201).send(fileJson(await uploadOwnFile(ctx, principal, uploadInput(request), request.ip)));
    });

    scoped.get("/tenant/v1/company/files/:id", async (request, reply) => {
      const principal = await tenantAuth(request, "company.read");
      return sendFile(reply, await getOwnFile(ctx, principal.tenantId, resourceId(request.params, "文件")));
    });

    scoped.post("/tenant/v1/company/documents", async (request, reply) => {
      const principal = await tenantAuth(request, "company.manage");
      const input = parseInput(documentSchema, request.body, "body");
      const document = await submitOwnDocument(ctx, principal, { type: input.type, fileId: input.file_id, expiresOn: input.expires_on, note: input.note }, request.ip);
      return reply.code(201).send(documentJson(document, false));
    });

    scoped.post("/tenant/v1/company/submit", async (request) => {
      const principal = await tenantAuth(request, "company.manage");
      return tenantJson(await submitForReview(ctx, principal, request.ip));
    });

    scoped.get("/tenant/v1/company/contracts", async (request) => {
      const principal = await tenantAuth(request, "company.read");
      return { items: (await listOwnContracts(ctx, principal.tenantId)).map(contractJson) };
    });

    scoped.get("/tenant/v1/company/status-events", async (request) => {
      const principal = await tenantAuth(request, "company.read");
      const query = parseInput(limitSchema, request.query, "querystring");
      return { items: (await listOwnStatusEvents(ctx, principal.tenantId, query.limit)).map((event) => statusEventJson(event, false)) };
    });

    scoped.get("/tenant/v1/company/notices", async (request) => {
      const principal = await tenantAuth(request, "company.read");
      const query = parseInput(pageQuerySchema, request.query, "querystring");
      const page = await listOwnNotices(ctx, principal.tenantId, query.limit, decodeTimeCursor(query.cursor ?? null));
      return { items: page.items.map(noticeJson), next_cursor: page.nextCursor };
    });

    scoped.get("/tenant/v1/performance", async (request) => {
      const principal = await tenantAuth(request, "performance.read");
      const query = parseInput(scoreQuerySchema, request.query, "querystring");
      const today = tenantToday(ctx.now());
      const tenantId = principal.tenantId;
      const loaded = await withTenantTx(ctx.pool, tenantId, async (db) => ({ tenant: await findOwnTenant(db, tenantId), days: await listScoreDays(db, tenantId, addDays(today, -(query.days - 1)), today) }), { snapshot: true });
      if (loaded.tenant === null) throw notFound("供应商");
      return performanceJson(loaded.tenant, loaded.days, today);
    });

    // ---- 运营后台 ----

    scoped.get("/platform/v1/tenants/:id/company", async (request) => {
      await platformAuth(request, "tenant.read");
      return overviewJson(await getCompanyForPlatform(ctx, resourceId(request.params, "供应商")), true);
    });

    scoped.get("/platform/v1/tenants/:id/status-events", async (request) => {
      await platformAuth(request, "tenant.read");
      const query = parseInput(limitSchema, request.query, "querystring");
      return { items: (await listStatusEventsForPlatform(ctx, resourceId(request.params, "供应商"), query.limit)).map((event) => statusEventJson(event, true)) };
    });

    scoped.get("/platform/v1/tenants/:id/performance", async (request) => {
      await platformAuth(request, "tenant.read");
      const tenantId = resourceId(request.params, "供应商");
      const query = parseInput(scoreQuerySchema, request.query, "querystring");
      const today = tenantToday(ctx.now());
      const loaded = await withPlatformTx(ctx.pool, async (db) => ({ tenant: await findTenantForPlatform(db, tenantId, { lock: false }), days: await listScoreDays(db, tenantId, addDays(today, -(query.days - 1)), today) }), { snapshot: true });
      if (loaded.tenant === null) throw notFound("供应商");
      return performanceJson(loaded.tenant, loaded.days, today);
    });

    scoped.get("/platform/v1/tenants/:id/files/:fileId", async (request, reply) => {
      await platformAuth(request, "tenant.review");
      return sendFile(reply, await getFileForPlatform(ctx, resourceId(request.params, "供应商"), secondId(request.params, "fileId", "文件")));
    });

    scoped.post("/platform/v1/tenants/:id/files", upload, async (request, reply) => {
      const principal = await platformAuth(request, "tenant.review");
      const id = resourceId(request.params, "供应商");
      return reply.code(201).send(fileJson(await uploadContractFile(ctx, principal, id, uploadInput(request), request.ip)));
    });

    scoped.get("/platform/v1/tenant-documents", async (request) => {
      await platformAuth(request, "tenant.read");
      const query = parseInput(queueQuerySchema, request.query, "querystring");
      const page = await listDocumentQueueForPlatform(ctx, { kind: query.kind, withinDays: query.within_days }, query.limit, decodeTimeCursor(query.cursor ?? null));
      return {
        items: page.items.map((item) => ({ tenant: { id: item.document.tenantId, name: item.tenantName, status: item.tenantStatus }, document: documentJson(item.document, true) })),
        next_cursor: page.nextCursor,
        total: page.total,
      };
    });

    const decide = (path: string, decision: "approve" | "reject" | "request_supplement"): void => {
      scoped.post(`/platform/v1/tenants/:id/documents/:documentId/${path}`, async (request) => {
        const principal = await platformAuth(request, "tenant.review");
        const tenantId = resourceId(request.params, "供应商");
        const documentId = secondId(request.params, "documentId", "资质");
        const input = decision === "approve" ? { reason: null, ...withExpiry(parseInput(approveSchema, request.body ?? {}, "body")) } : { reason: parseInput(decisionSchema, request.body, "body").reason };
        const result = await reviewDocument(ctx, principal, tenantId, documentId, decision, input, request.ip);
        return { document: documentJson(result.document, true), tenant: tenantJson(result.tenant) };
      });
    };
    decide("approve", "approve");
    decide("reject", "reject");
    decide("request-supplement", "request_supplement");

    scoped.post("/platform/v1/tenants/:id/contracts", async (request, reply) => {
      const principal = await platformAuth(request, "tenant.review");
      const id = resourceId(request.params, "供应商");
      const input = parseInput(contractSchema, request.body, "body");
      const approval = await requestContract(ctx, principal, id, { validFrom: input.valid_from, settleCurrency: input.settle_currency, fileId: input.file_id, note: input.note }, request.ip);
      return reply.code(202).send(approvalResponse(approval, principal));
    });

    scoped.post("/platform/v1/tenants/:id/sign", async (request) => {
      const principal = await platformAuth(request, "tenant.change_status");
      const id = resourceId(request.params, "供应商");
      const input = parseInput(noteSchema, request.body ?? {}, "body");
      return tenantJson(await signTenant(ctx, principal, id, input.note, request.ip));
    });

    scoped.post("/platform/v1/tenants/:id/start-trial", async (request) => {
      const principal = await platformAuth(request, "tenant.change_status");
      const id = resourceId(request.params, "供应商");
      const input = parseInput(startTrialSchema, request.body, "body");
      return tenantJson(await startTrial(ctx, principal, id, input.test_order_note, request.ip));
    });

    scoped.post("/platform/v1/tenants/:id/suspend", async (request, reply) => {
      const principal = await platformAuth(request, "tenant.change_status");
      const id = resourceId(request.params, "供应商");
      const input = parseInput(decisionSchema, request.body, "body");
      return reply.code(202).send(approvalResponse(await requestSuspendTenant(ctx, principal, id, input.reason, request.ip), principal));
    });

    scoped.post("/platform/v1/tenants/:id/resume", async (request) => {
      const principal = await platformAuth(request, "tenant.change_status");
      const id = resourceId(request.params, "供应商");
      const input = parseInput(noteSchema, request.body ?? {}, "body");
      return tenantJson(await resumeTenant(ctx, principal, id, input.note, request.ip));
    });

    scoped.post("/platform/v1/tenants/:id/terminate", async (request, reply) => {
      const principal = await platformAuth(request, "tenant.change_status");
      const id = resourceId(request.params, "供应商");
      const input = parseInput(decisionSchema, request.body, "body");
      return reply.code(202).send(approvalResponse(await requestTerminateTenant(ctx, principal, id, input.reason, request.ip), principal));
    });
  });
}

function withExpiry(input: { expires_on?: string | null | undefined }): { expiresOn?: string | null } {
  return input.expires_on === undefined ? {} : { expiresOn: input.expires_on };
}
