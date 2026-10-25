/**
 * 供应商入驻（M4-01，ADR 0028）：企业信息、资质上传与审核、合同版本、状态机的人工动作、给供应商的提醒。
 * 每日的自动检查（资质到期、评分、自动观察 / 暂停 / 转正式）在 tenant-jobs.ts，状态怎么写在这里的 `applyTenantChange`。
 *
 * 事务：
 * - 供应商自己读写（企业信息、上传、提交资质）在租户事务里，行级安全兜底。
 * - 状态变化一律在平台事务里做（租户角色不能改 `tenants`）：供应商点「提交审核」也是平台事务，但租户编号只来自令牌。
 * - 每次状态、暂停原因、观察期变化：改主体（版本加一）+ 一行状态记录 + 一条审计 + 需要时一条给供应商的提醒，同一个事务。
 */
import { createHash } from "node:crypto";
import {
  CONTRACT_TERMS,
  type DocumentFact,
  type DocumentRequirement,
  type DocumentType,
  type ObservationReason,
  type SuspensionReason,
  TENANT_RULES,
  TENANT_STATUS_NAMES,
  type TenantIssue,
  type TenantStatus,
  type TenantTrigger,
  contractIssues,
  documentInputIssues,
  documentRequirements,
  effectiveContract,
  tenantDate,
  isCurrencyCode,
  requiredDocumentsExpired,
  requiredDocumentsValid,
  signIssues,
  startTrialIssues,
  submitIssues,
  tenantTransition,
  type DocumentFileType,
  cleanFileName,
  detectDocumentFileType,
} from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { type Db, withPlatformTx, withTenantTx } from "../db/context.ts";
import { AppError } from "../errors.ts";
import type { Page, TimeCursor } from "../pagination.ts";
import type { Approval } from "../repos/approvals.ts";
import { type AuditAction, type AuditOrigin, type AuditValues, insertAuditLog } from "../repos/audit-logs.ts";
import { findProduct } from "../repos/products.ts";
import {
  type Notice,
  type ProfileFields,
  type QueuedDocument,
  type StatusEvent,
  type StoredContract,
  type StoredDocument,
  type StoredFileMeta,
  type StoredProfile,
  countOpenOrders,
  findDocument,
  hasLaterDocument,
  findFileMeta,
  findFileWithData,
  findProfile,
  insertContract,
  insertDocument,
  insertFile,
  insertNotice,
  insertStatusEvent,
  listContracts,
  listDocumentQueue,
  listDocuments,
  listNotices,
  listStatusEvents,
  setDocumentReview,
  supersedeEarlierDocuments,
  upsertProfile,
} from "../repos/tenant-onboarding.ts";
import { type Tenant, type TenantState, findOwnTenant, findTenantForPlatform, saveTenantState, tenantState } from "../repos/tenants.ts";
import { validationFailed } from "../validation.ts";
import { type ApprovalKind, approvalStale, requestApproval } from "./approvals.ts";
import { consoleOrigin, platformActor, tenantActor } from "./audit.ts";
import { notFound, versionConflict } from "./errors.ts";
import type { PlatformPrincipal } from "./platform-auth.ts";
import { publishCheckOf } from "./products.ts";
import type { TenantPrincipal } from "./tenant-auth.ts";

/** 「今天」（资质到期、合同生效、每日评分都按它；ADR 0028）。 */
export function tenantToday(now: Date): string {
  return tenantDate(now);
}

const SYSTEM_ORIGIN = (now: Date): AuditOrigin => ({ occurredAt: now, actor: { type: "system", id: null, email: null }, ip: null, source: "job" });

// ---- 错误 ----

function stateInvalid(status: TenantStatus, message: string): AppError {
  return new AppError(409, "TENANT_STATE_INVALID", message, { status });
}

function conditionsUnmet(message: string, issues: readonly TenantIssue[]): AppError {
  return new AppError(409, "TENANT_CONDITIONS_UNMET", message, { issues: issues.map((issue) => ({ path: issue.path, reason: issue.reason, ...(issue.detail === undefined ? {} : { detail: issue.detail }) })) });
}

function issuesInvalid(issues: readonly TenantIssue[]): AppError {
  return validationFailed("body", issues.map((issue) => ({ path: issue.path, reason: issue.reason, message: ISSUE_MESSAGES[issue.reason] ?? issue.reason, ...(issue.detail === undefined ? {} : { detail: issue.detail }) })));
}

const ISSUE_MESSAGES: Readonly<Record<string, string>> = {
  REQUIRED: "必填",
  NOT_APPLICABLE: "这种证件没有到期日",
  INVALID_DATE: "不是合法的日期（YYYY-MM-DD）",
  ALREADY_EXPIRED: "到期日已经到了或过了：请上传还在有效期内的证件",
  UNKNOWN_DOCUMENT_TYPE: "不认识的证件类型",
  TOO_LONG: "太长了",
  IN_THE_PAST: "生效日期不能早于今天",
  NOT_AFTER_LATEST: "生效日期要晚于已有的最后一个合同版本",
  UNSUPPORTED_CURRENCY: "不支持这个币种",
  UNKNOWN_FILE: "文件不存在，或不是这家供应商的",
  WRONG_FILE_PURPOSE: "这个文件不能用在这里（资质要用资质文件，合同要用合同文件）",
};

// ---- 状态变化（唯一的写法）----

export interface ChangeActor {
  type: "tenant_user" | "platform_user" | "system";
  id: string | null;
  origin: AuditOrigin;
}

export function platformChangeActor(principal: PlatformPrincipal, ip: string, now: Date): ChangeActor {
  return { type: "platform_user", id: principal.user.id, origin: consoleOrigin(platformActor(principal.user), ip, now) };
}

export function systemChangeActor(now: Date): ChangeActor {
  return { type: "system", id: null, origin: SYSTEM_ORIGIN(now) };
}

const TRIGGER_ACTIONS: Readonly<Record<TenantTrigger | "observation", AuditAction>> = {
  submit: "submit",
  return: "return",
  sign: "sign",
  start_trial: "start_trial",
  promote: "promote",
  suspend: "suspend",
  resume: "resume",
  terminate: "terminate",
  observation: "observe",
};

function stateValues(state: TenantState): AuditValues {
  return { status: state.status, suspension_reasons: state.suspensionReasons, observation_reasons: state.observationReasons };
}

/**
 * 写一次状态变化：主体、状态记录、审计、提醒。`before` 是调用方锁住后读到的。状态、暂停原因、观察原因都没变时什么都不做，返回 `before`。
 */
export async function applyTenantChange(db: Db, before: Tenant, next: TenantState, meta: { trigger: TenantTrigger | "observation"; actor: ChangeActor; note: string | null; approvalId?: string | null }): Promise<Tenant> {
  const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((value) => b.includes(value));
  if (before.status === next.status && same(before.suspensionReasons, next.suspensionReasons) && same(before.observationReasons, next.observationReasons)) return before;
  const now = meta.actor.origin.occurredAt;
  const after = await saveTenantState(db, before.id, next, now);
  await insertStatusEvent(db, before.id, {
    trigger: meta.trigger,
    fromStatus: before.status,
    toStatus: after.status,
    suspensionBefore: before.suspensionReasons,
    suspensionAfter: after.suspensionReasons,
    observationBefore: before.observationReasons,
    observationAfter: after.observationReasons,
    actor: { type: meta.actor.type, id: meta.actor.id },
    note: meta.note,
    approvalId: meta.approvalId ?? null,
    occurredAt: now,
  });
  await insertAuditLog(db, meta.actor.origin, {
    tenantId: before.id,
    resource: "tenant",
    resourceId: before.id,
    action: TRIGGER_ACTIONS[meta.trigger],
    before: stateValues(tenantState(before)),
    after: { ...stateValues(next), ...(meta.note === null ? {} : { reason: meta.note }), ...(meta.approvalId ? { approval_id: meta.approvalId } : {}) },
  });
  const key = `${after.version}`;
  if (before.status !== after.status || !same(before.suspensionReasons, after.suspensionReasons)) {
    await insertNotice(db, before.id, { kind: "status_changed", dedupeKey: `status:${key}`, data: { from: before.status, to: after.status, suspension_reasons: after.suspensionReasons }, now });
  }
  if (before.observationReasons.length === 0 && after.observationReasons.length > 0) {
    await insertNotice(db, before.id, { kind: "observation_started", dedupeKey: `observation:${key}`, data: { reasons: after.observationReasons }, now });
  } else if (before.observationReasons.length > 0 && after.observationReasons.length === 0) {
    await insertNotice(db, before.id, { kind: "observation_ended", dedupeKey: `observation:${key}`, data: {}, now });
  }
  return after;
}

/** 状态机的一步（`tenantTransition`）：不允许时 409 `TENANT_STATE_INVALID`。返回改完的状态（还没写）。 */
function transitioned(tenant: Tenant, trigger: TenantTrigger, by: "tenant" | "platform" | "system", now: Date): TenantState {
  const result = tenantTransition(tenant.status, trigger, by, tenant.suspendedFrom);
  if (!result.ok) throw stateInvalid(tenant.status, `供应商现在是「${TENANT_STATUS_NAMES[tenant.status]}」，不能做这一步`);
  const state = tenantState(tenant);
  const to = result.to;
  const next: TenantState = { ...state, status: to };
  if (trigger === "sign") next.signedAt = now;
  if (trigger === "start_trial") next.trialStartedAt = now;
  if (trigger === "promote") next.activatedAt = now;
  if (trigger === "terminate") {
    next.terminatedAt = now;
    next.suspendedFrom = null;
    next.suspensionReasons = [];
    next.suspendedAt = null;
    next.observationReasons = [];
    next.observationSince = null;
  }
  if (trigger === "resume") {
    next.suspendedFrom = null;
    next.suspensionReasons = [];
    next.suspendedAt = null;
  }
  return next;
}

/** 加上暂停原因：还没暂停的转成暂停（记下暂停之前的状态），已经暂停的只加原因。 */
export function withSuspension(tenant: Tenant, reasons: readonly SuspensionReason[], now: Date): TenantState {
  const state = tenantState(tenant);
  const merged = [...new Set([...state.suspensionReasons, ...reasons])];
  if (tenant.status === "suspended") return { ...state, suspensionReasons: merged };
  const result = tenantTransition(tenant.status, "suspend", "system");
  if (!result.ok) return state;
  return { ...state, status: "suspended", suspendedFrom: tenant.status, suspensionReasons: merged, suspendedAt: now };
}

/** 去掉暂停原因；一个都不剩时回到暂停之前的状态。 */
export function withoutSuspension(tenant: Tenant, reasons: readonly SuspensionReason[]): TenantState {
  const state = tenantState(tenant);
  if (tenant.status !== "suspended") return state;
  const left = state.suspensionReasons.filter((reason) => !reasons.includes(reason));
  if (left.length > 0) return { ...state, suspensionReasons: left };
  return { ...state, status: tenant.suspendedFrom ?? "active", suspendedFrom: null, suspensionReasons: [], suspendedAt: null };
}

/** 观察原因换成 `reasons`（每天重算）。 */
export function withObservation(tenant: Tenant, reasons: readonly ObservationReason[], now: Date): TenantState {
  const state = tenantState(tenant);
  const list = [...reasons];
  return { ...state, observationReasons: list, observationSince: list.length === 0 ? null : (state.observationSince ?? now) };
}

// ---- 资质的现状 ----

function documentFact(document: StoredDocument): DocumentFact {
  return { id: document.id, type: document.type, status: document.status, expiresOn: document.expiresOn, seq: document.seq };
}

export interface CompanyOverview {
  tenant: Tenant;
  profile: StoredProfile | null;
  documents: StoredDocument[];
  requirements: DocumentRequirement[];
  contracts: StoredContract[];
  effectiveContract: StoredContract | null;
  /** 现在做下一步还缺什么（申请中：提交审核；审核中：签约） */
  nextStepIssues: TenantIssue[];
  today: string;
}

async function overviewIn(db: Db, tenant: Tenant, now: Date, platform: boolean): Promise<CompanyOverview> {
  const today = tenantToday(now);
  const profile = await findProfile(db, tenant.id);
  const documents = await listDocuments(db, tenant.id, { withReviewerNames: platform });
  const requirements = documentRequirements(profile?.countryCode ?? null, documents.map(documentFact), today);
  const contracts = await listContracts(db, tenant.id);
  const effective = effectiveContract(contracts, today);
  const nextStepIssues = tenant.status === "applying" ? submitIssues(profile, requirements) : tenant.status === "reviewing" ? signIssues(requirements, effective !== null) : [];
  return { tenant, profile, documents, requirements, contracts, effectiveContract: effective, nextStepIssues, today };
}

// ---- 供应商自己：企业信息、文件、资质、提交审核 ----

export async function getOwnCompany(ctx: AppContext, tenantId: string): Promise<CompanyOverview> {
  const now = ctx.now();
  return withTenantTx(ctx.pool, tenantId, async (db) => {
    const tenant = await findOwnTenant(db, tenantId);
    if (!tenant) throw notFound("供应商");
    return overviewIn(db, tenant, now, false);
  }, { snapshot: true });
}

/** 改企业信息：只有「申请中」能改（提交审核以后改要先被退回）。If-Match 是企业信息的版本（还没填过时是 0 以外的任何值都不对，见下）。 */
export async function putOwnProfile(ctx: AppContext, principal: TenantPrincipal, expectedVersion: number | null, fields: ProfileFields, ip: string): Promise<StoredProfile> {
  const now = ctx.now();
  const tenantId = principal.tenantId;
  return withTenantTx(ctx.pool, tenantId, async (db) => {
    const tenant = await findOwnTenant(db, tenantId);
    if (!tenant) throw notFound("供应商");
    if (tenant.status !== "applying") throw stateInvalid(tenant.status, "企业信息只能在「申请中」修改；提交审核以后要改，请联系平台退回");
    const before = await findProfile(db, tenantId, { lock: true });
    // 第一次填（还没有版本）不带 If-Match；以后每次都要带当前的版本
    if (before !== null && expectedVersion !== before.version) throw versionConflict(before.version);
    if (before === null && expectedVersion !== null) throw versionConflict(0);
    const saved = await upsertProfile(db, tenantId, fields, now);
    await insertAuditLog(db, consoleOrigin(tenantActor(principal.user), ip, now), { tenantId, resource: "tenant_profile", resourceId: tenantId, action: before === null ? "create" : "update", before: before === null ? null : profileValues(before), after: profileValues(saved) });
    return saved;
  });
}

function profileValues(profile: StoredProfile): AuditValues {
  return {
    country_code: profile.countryCode,
    legal_name: profile.legalName,
    registration_no: profile.registrationNo,
    address: profile.address,
    contact_name: profile.contactName,
    contact_phone: profile.contactPhone,
    contact_email: profile.contactEmail,
  };
}

export interface UploadInput {
  bytes: Buffer;
  /** 请求头里声明的类型（不含参数） */
  declaredType: string | null;
  fileName: string | null;
}

/** 认文件：按开头的字节判断格式，和声明的不一致、不是 PDF / JPEG / PNG 都是 415。大小由路由层限制（413）。 */
function checkedFile(input: UploadInput): { contentType: DocumentFileType; sha256: string; fileName: string } {
  if (input.bytes.length === 0) throw validationFailed("body", [{ path: "/", reason: "EMPTY_FILE", message: "文件是空的" }]);
  if (input.bytes.length > TENANT_RULES.maxFileBytes) throw new AppError(413, "PAYLOAD_TOO_LARGE", "文件太大了：最大 10 MB", { max_bytes: TENANT_RULES.maxFileBytes });
  const detected = detectDocumentFileType(input.bytes);
  if (detected === null || (input.declaredType !== null && input.declaredType !== "application/octet-stream" && input.declaredType !== detected)) {
    throw new AppError(415, "UNSUPPORTED_MEDIA_TYPE", "只收 PDF、JPEG、PNG 文件，并且请求头的 Content-Type 要和文件的实际格式一致", { detected, declared: input.declaredType });
  }
  return { contentType: detected, sha256: createHash("sha256").update(input.bytes).digest("hex"), fileName: cleanFileName(input.fileName) };
}

function fileValues(file: StoredFileMeta): AuditValues {
  return { purpose: file.purpose, content_type: file.contentType, byte_size: file.byteSize, sha256: file.sha256, file_name: file.fileName };
}

/** 供应商上传一份资质文件（只存，不算提交；提交见 `submitOwnDocument`）。 */
export async function uploadOwnFile(ctx: AppContext, principal: TenantPrincipal, input: UploadInput, ip: string): Promise<StoredFileMeta> {
  const now = ctx.now();
  const checked = checkedFile(input);
  const tenantId = principal.tenantId;
  return withTenantTx(ctx.pool, tenantId, async (db) => {
    const file = await insertFile(db, { tenantId, purpose: "document", ...checked, byteSize: input.bytes.length, data: input.bytes, uploadedAt: now, uploadedBy: { type: "tenant_user", id: principal.user.id } });
    await insertAuditLog(db, consoleOrigin(tenantActor(principal.user), ip, now), { tenantId, resource: "tenant_file", resourceId: file.id, action: "upload", before: null, after: fileValues(file) });
    return file;
  });
}

export async function getOwnFile(ctx: AppContext, tenantId: string, fileId: string): Promise<StoredFileMeta & { data: Buffer }> {
  const file = await withTenantTx(ctx.pool, tenantId, (db) => findFileWithData(db, tenantId, fileId));
  if (!file) throw notFound("文件");
  return file;
}

export interface DocumentInput {
  type: string;
  fileId: string;
  expiresOn: string | null;
  note: string | null;
}

/**
 * 提交一份资质（新交或换证）：文件必须是本供应商上传的资质文件、还没用过；类型和到期日按 `documentInputIssues`。
 * 提交后是「审核中」；同类型里已经通过的那份照常有效，直到这份审核通过把它取代。
 */
export async function submitOwnDocument(ctx: AppContext, principal: TenantPrincipal, input: DocumentInput, ip: string): Promise<StoredDocument> {
  const now = ctx.now();
  const today = tenantToday(now);
  const issues = documentInputIssues(input, today);
  if (issues.length > 0) throw issuesInvalid(issues);
  const tenantId = principal.tenantId;
  return withTenantTx(ctx.pool, tenantId, async (db) => {
    const file = await findFileMeta(db, tenantId, input.fileId);
    if (!file) throw issuesInvalid([{ path: "/file_id", reason: "UNKNOWN_FILE" }]);
    if (file.purpose !== "document") throw issuesInvalid([{ path: "/file_id", reason: "WRONG_FILE_PURPOSE" }]);
    const used = await db.query("select 1 from tenant_documents where tenant_id = $1 and file_id = $2", [tenantId, input.fileId]);
    if ((used.rowCount ?? 0) > 0) throw new AppError(409, "FILE_ALREADY_USED", "这个文件已经提交过一次了；要再交，请重新上传");
    const id = await insertDocument(db, { tenantId, type: input.type as DocumentType, fileId: input.fileId, expiresOn: input.expiresOn, note: input.note, submittedBy: principal.user.id, now });
    const document = (await findDocument(db, tenantId, id, { withReviewerNames: false })) as StoredDocument;
    await insertAuditLog(db, consoleOrigin(tenantActor(principal.user), ip, now), { tenantId, resource: "tenant_document", resourceId: id, action: "create", before: null, after: documentValues(document) });
    return document;
  });
}

function documentValues(document: StoredDocument): AuditValues {
  return { type: document.type, status: document.status, expires_on: document.expiresOn, file_id: document.fileId, note: document.note, review_reason: document.reviewReason };
}

/** 提交审核（申请中 → 审核中）：企业信息填齐、每项必交资质都有一份在审核中或已通过的。在平台事务里做（租户角色不能改主体）。 */
export async function submitForReview(ctx: AppContext, principal: TenantPrincipal, ip: string): Promise<Tenant> {
  const now = ctx.now();
  const tenantId = principal.tenantId;
  return withPlatformTx(ctx.pool, async (db) => {
    const tenant = await findTenantForPlatform(db, tenantId, { lock: true });
    if (!tenant) throw notFound("供应商");
    const next = transitioned(tenant, "submit", "tenant", now);
    const overview = await overviewIn(db, tenant, now, false);
    if (overview.nextStepIssues.length > 0) throw conditionsUnmet("资料还没有交齐，不能提交审核", overview.nextStepIssues);
    return applyTenantChange(db, tenant, next, { trigger: "submit", actor: { type: "tenant_user", id: principal.user.id, origin: consoleOrigin(tenantActor(principal.user), ip, now) }, note: null });
  });
}

export function listOwnContracts(ctx: AppContext, tenantId: string): Promise<StoredContract[]> {
  return withTenantTx(ctx.pool, tenantId, (db) => listContracts(db, tenantId), { snapshot: true });
}

export function listOwnStatusEvents(ctx: AppContext, tenantId: string, limit: number): Promise<StatusEvent[]> {
  return withTenantTx(ctx.pool, tenantId, (db) => listStatusEvents(db, tenantId, { withActorEmails: false, limit }), { snapshot: true });
}

export function listOwnNotices(ctx: AppContext, tenantId: string, limit: number, after: TimeCursor | null): Promise<Page<Notice>> {
  return withTenantTx(ctx.pool, tenantId, (db) => listNotices(db, tenantId, limit, after), { snapshot: true });
}

// ---- 平台：查看 ----

async function tenantForPlatform(db: Db, tenantId: string, lock: boolean): Promise<Tenant> {
  const tenant = await findTenantForPlatform(db, tenantId, { lock });
  if (!tenant) throw notFound("供应商");
  return tenant;
}

export function getCompanyForPlatform(ctx: AppContext, tenantId: string): Promise<CompanyOverview> {
  const now = ctx.now();
  return withPlatformTx(ctx.pool, async (db) => overviewIn(db, await tenantForPlatform(db, tenantId, false), now, true), { snapshot: true });
}

export function listStatusEventsForPlatform(ctx: AppContext, tenantId: string, limit: number): Promise<StatusEvent[]> {
  return withPlatformTx(ctx.pool, async (db) => {
    await tenantForPlatform(db, tenantId, false);
    return listStatusEvents(db, tenantId, { withActorEmails: true, limit });
  }, { snapshot: true });
}

export async function getFileForPlatform(ctx: AppContext, tenantId: string, fileId: string): Promise<StoredFileMeta & { data: Buffer }> {
  const file = await withPlatformTx(ctx.pool, (db) => findFileWithData(db, tenantId, fileId));
  if (!file) throw notFound("文件");
  return file;
}

/** 审核队列：待审核的，或 `withinDays` 天内到期（含已过期）的。 */
export function listDocumentQueueForPlatform(ctx: AppContext, filter: { kind: "pending" | "expiring"; withinDays: number }, limit: number, after: TimeCursor | null): Promise<Page<QueuedDocument> & { total: number }> {
  const today = tenantToday(ctx.now());
  const before = new Date(Date.parse(`${today}T00:00:00Z`) + filter.withinDays * 86_400_000).toISOString().slice(0, 10);
  return withPlatformTx(ctx.pool, (db) => listDocumentQueue(db, { kind: filter.kind, beforeDate: before }, limit, after), { snapshot: true });
}

/** 运营上传合同扫描件（发起合同版本时引用）。 */
export async function uploadContractFile(ctx: AppContext, principal: PlatformPrincipal, tenantId: string, input: UploadInput, ip: string): Promise<StoredFileMeta> {
  const now = ctx.now();
  const checked = checkedFile(input);
  return withPlatformTx(ctx.pool, async (db) => {
    const tenant = await tenantForPlatform(db, tenantId, false);
    if (tenant.status === "terminated") throw stateInvalid(tenant.status, "已清退的供应商不能再上传合同");
    const file = await insertFile(db, { tenantId, purpose: "contract", ...checked, byteSize: input.bytes.length, data: input.bytes, uploadedAt: now, uploadedBy: { type: "platform_user", id: principal.user.id } });
    await insertAuditLog(db, consoleOrigin(platformActor(principal.user), ip, now), { tenantId, resource: "tenant_file", resourceId: file.id, action: "upload", before: null, after: fileValues(file) });
    return file;
  });
}

// ---- 平台：审核资质 ----

export type DocumentDecision = "approve" | "reject" | "request_supplement";

/**
 * 审核一份资质。只有「审核中」、而且是这一类型最新提交的那份能审（更早的已经被它代替：409 `DOCUMENT_SUPERSEDED`）。
 * - 通过：可以改正到期日（照证件上的写；不能已经过期）；同类型更早的都被取代。之后如果供应商只因资质过期而暂停、现在必交资质都有效了，自动恢复。
 * - 驳回、要求补充：必须写原因。供应商在「审核中」而这是必交的一项：退回「申请中」，改好再提交。
 * 每次都给供应商一条提醒。
 */
export async function reviewDocument(ctx: AppContext, principal: PlatformPrincipal, tenantId: string, documentId: string, decision: DocumentDecision, input: { reason: string | null; expiresOn?: string | null }, ip: string): Promise<{ document: StoredDocument; tenant: Tenant }> {
  const now = ctx.now();
  const today = tenantToday(now);
  if (decision !== "approve" && (input.reason === null || input.reason.trim() === "")) throw issuesInvalid([{ path: "/reason", reason: "REQUIRED" }]);
  const actor = platformChangeActor(principal, ip, now);
  return withPlatformTx(ctx.pool, async (db) => {
    let tenant = await tenantForPlatform(db, tenantId, true);
    const document = await findDocument(db, tenantId, documentId, { lock: true, withReviewerNames: true });
    if (!document) throw notFound("资质");
    if (tenant.status === "terminated") throw stateInvalid(tenant.status, "已清退的供应商不再审核资质");
    if (document.status !== "pending") throw new AppError(409, "DOCUMENT_NOT_PENDING", "这份资质已经审核过了", { status: document.status });
    if (await hasLaterDocument(db, tenantId, document.type, document.seq)) throw new AppError(409, "DOCUMENT_SUPERSEDED", "供应商之后又交了一份同类型的资质，请审核最新的那份");
    let expiresOn = document.expiresOn;
    if (decision === "approve" && input.expiresOn !== undefined) {
      const issues = documentInputIssues({ type: document.type, expiresOn: input.expiresOn, note: null }, today);
      if (issues.length > 0) throw issuesInvalid(issues);
      expiresOn = input.expiresOn;
    }
    if (decision === "approve" && expiresOn !== null && expiresOn <= today) throw issuesInvalid([{ path: "/expires_on", reason: "ALREADY_EXPIRED", detail: { today } }]);
    const status = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "supplement_requested";
    const reason = decision === "approve" ? null : (input.reason as string).trim();
    await setDocumentReview(db, tenantId, documentId, { status, reason, expiresOn, reviewerId: principal.user.id, now });
    if (decision === "approve") await supersedeEarlierDocuments(db, tenantId, document.type, document.seq, principal.user.id, now);
    const reviewed = (await findDocument(db, tenantId, documentId, { withReviewerNames: true })) as StoredDocument;
    await insertAuditLog(db, actor.origin, { tenantId, resource: "tenant_document", resourceId: documentId, action: decision, before: documentValues(document), after: documentValues(reviewed) });
    await insertNotice(db, tenantId, { kind: "document_reviewed", dedupeKey: `document_reviewed:${documentId}`, data: { document_id: documentId, type: document.type, status, reason }, now });

    const overview = await overviewIn(db, tenant, now, true);
    const required = overview.requirements.some((item) => item.required && item.type === document.type);
    if (decision !== "approve" && required && tenant.status === "reviewing") {
      tenant = await applyTenantChange(db, tenant, transitioned(tenant, "return", "platform", now), { trigger: "return", actor, note: reason });
    }
    if (decision === "approve" && tenant.status === "suspended" && tenant.suspensionReasons.includes("document_expired") && requiredDocumentsExpired(overview.requirements).length === 0) {
      const next = withoutSuspension(tenant, ["document_expired"]);
      tenant = await applyTenantChange(db, tenant, next, { trigger: next.status === "suspended" ? "suspend" : "resume", actor, note: "资质已更新" });
    }
    return { document: reviewed, tenant };
  });
}

// ---- 平台：签约、开始试运营、恢复 ----

/** 签约（审核中 → 已签约）：必交资质全部审核通过且有效 + 有一份已生效的合同。 */
export async function signTenant(ctx: AppContext, principal: PlatformPrincipal, tenantId: string, note: string | null, ip: string): Promise<Tenant> {
  const now = ctx.now();
  return withPlatformTx(ctx.pool, async (db) => {
    const tenant = await tenantForPlatform(db, tenantId, true);
    const next = transitioned(tenant, "sign", "platform", now);
    const overview = await overviewIn(db, tenant, now, true);
    if (overview.nextStepIssues.length > 0) throw conditionsUnmet("还不能签约", overview.nextStepIssues);
    return applyTenantChange(db, tenant, next, { trigger: "sign", actor: platformChangeActor(principal, ip, now), note });
  });
}

/** 有几个商品通过了上架校验（必须项全部通过）。 */
async function publishableProducts(db: Db, tenantId: string, now: Date): Promise<number> {
  const ids = await db.query<{ id: string }>("select id from products where tenant_id = $1 order by id", [tenantId]);
  let count = 0;
  for (const { id } of ids.rows) {
    const product = await findProduct(db, tenantId, id, { lock: false });
    if (product !== null && (await publishCheckOf(db, tenantId, product, now)).canPublish) count += 1;
  }
  return count;
}

/** 开始试运营（已签约 → 试运营）：至少 1 个商品通过上架校验、运营确认完成了一次测试单（写测试单的说明）、资质仍然有效。 */
export async function startTrial(ctx: AppContext, principal: PlatformPrincipal, tenantId: string, testOrderNote: string, ip: string): Promise<Tenant> {
  const now = ctx.now();
  return withPlatformTx(ctx.pool, async (db) => {
    const tenant = await tenantForPlatform(db, tenantId, true);
    const next = transitioned(tenant, "start_trial", "platform", now);
    const overview = await overviewIn(db, tenant, now, true);
    const issues = startTrialIssues({ publishableProducts: await publishableProducts(db, tenantId, now), testOrderNote, documentsValid: requiredDocumentsValid(overview.requirements) });
    if (issues.length > 0) throw conditionsUnmet("还不能开始试运营", issues);
    return applyTenantChange(db, tenant, next, { trigger: "start_trial", actor: platformChangeActor(principal, ip, now), note: testOrderNote.trim() });
  });
}

/**
 * 人工恢复（暂停 → 暂停之前的状态）：清掉全部暂停原因（「评分低于红线需运营人工恢复」）。资质过期的不能这样恢复——
 * 换上新证件审核通过后系统自动恢复；还有过期的必交资质时 409 `DOCUMENTS_INVALID`。直接生效（和启用渠道一样，需求只要求停用复核）。
 */
export async function resumeTenant(ctx: AppContext, principal: PlatformPrincipal, tenantId: string, note: string | null, ip: string): Promise<Tenant> {
  const now = ctx.now();
  return withPlatformTx(ctx.pool, async (db) => {
    const tenant = await tenantForPlatform(db, tenantId, true);
    const next = transitioned(tenant, "resume", "platform", now);
    const overview = await overviewIn(db, tenant, now, true);
    const expired = requiredDocumentsExpired(overview.requirements);
    if (expired.length > 0) {
      throw new AppError(409, "DOCUMENTS_INVALID", "有必交资质已过期：请供应商换上新证件，审核通过后会自动恢复", { expired: expired.join(",") });
    }
    return applyTenantChange(db, tenant, next, { trigger: "resume", actor: platformChangeActor(principal, ip, now), note });
  });
}

// ---- 双人复核的三类：人工暂停、清退、合同版本 ----

export const TENANT_SUSPEND: ApprovalKind = {
  kind: "tenant.suspend",
  resource: "tenant",
  readAction: "tenant.read",
  requestAction: "tenant.change_status",
  reviewAction: "tenant.approve",
  async apply(db, approval, origin) {
    const tenant = await tenantForPlatform(db, approval.resourceId, true);
    if (tenant.status !== "trial" && tenant.status !== "active" && !(tenant.status === "suspended" && !tenant.suspensionReasons.includes("manual"))) throw stateInvalid(tenant.status, "供应商现在的状态不能暂停");
    await applyTenantChange(db, tenant, withSuspension(tenant, ["manual"], origin.occurredAt), { trigger: "suspend", actor: approverActor(origin), note: approval.requestNote, approvalId: approval.id });
  },
};

export const TENANT_TERMINATE: ApprovalKind = {
  kind: "tenant.terminate",
  resource: "tenant",
  readAction: "tenant.read",
  requestAction: "tenant.change_status",
  reviewAction: "tenant.approve",
  async apply(db, approval, origin) {
    const tenant = await tenantForPlatform(db, approval.resourceId, true);
    const open = await countOpenOrders(db, tenant.id);
    if (open > 0) throw openOrders(open);
    await applyTenantChange(db, tenant, transitioned(tenant, "terminate", "platform", origin.occurredAt), { trigger: "terminate", actor: approverActor(origin), note: approval.requestNote, approvalId: approval.id });
  },
};

export const TENANT_CONTRACT: ApprovalKind = {
  kind: "tenant.contract",
  resource: "tenant_contract",
  readAction: "tenant.read",
  requestAction: "tenant.review",
  reviewAction: "tenant.approve",
  async apply(db, approval, origin) {
    const tenantId = approval.resourceId;
    const tenant = await tenantForPlatform(db, tenantId, true);
    if (tenant.status === "terminated") throw stateInvalid(tenant.status, "供应商已清退");
    const payload = approval.payload;
    const contracts = await listContracts(db, tenantId);
    const latest = contracts.at(-1) ?? null;
    if ((latest?.version ?? 0) !== approval.baseVersion) throw approvalStale(latest?.version ?? 0);
    const validFrom = payload["valid_from"] as string;
    const today = tenantToday(origin.occurredAt);
    // 不追溯：发起时不早于今天，批准时可能已经过了午夜（ADR 0028「合同」）
    if (validFrom < today) throw validFromPassed(validFrom, today);
    const contract = await insertContract(db, {
      tenantId,
      validFrom,
      settleCurrency: payload["settle_currency"] as string,
      settleCycle: CONTRACT_TERMS.settleCycle,
      paymentDay: CONTRACT_TERMS.paymentDay,
      fileId: (payload["file_id"] as string | null) ?? null,
      note: (payload["note"] as string | null) ?? null,
      approvalId: approval.id,
      requestedBy: approval.requestedBy.id,
      approvedBy: origin.actor.id as string,
      createdAt: origin.occurredAt,
    });
    await insertAuditLog(db, origin, { tenantId, resource: "tenant_contract", resourceId: contract.id, action: "create", before: latest === null ? null : contractValues(latest), after: { ...contractValues(contract), approval_id: approval.id, requested_by: approval.requestedBy.email } });
  },
};

export const TENANT_APPROVAL_KINDS: readonly ApprovalKind[] = [TENANT_SUSPEND, TENANT_TERMINATE, TENANT_CONTRACT];

function approverActor(origin: AuditOrigin): ChangeActor {
  return { type: "platform_user", id: origin.actor.id, origin };
}

function validFromPassed(validFrom: string, today: string): AppError {
  return new AppError(409, "CONTRACT_VALID_FROM_PASSED", `合同生效日期 ${validFrom} 已早于今天（${today}），不能追溯修改结算条款：请驳回或撤回后按新的生效日期重新发起`, { valid_from: validFrom, today });
}

function openOrders(count: number): AppError {
  return new AppError(409, "TENANT_HAS_OPEN_ORDERS", "这家供应商还有没履约完的订单，全部完成或取消以后才能清退", { open_orders: count });
}

function contractValues(contract: StoredContract): AuditValues {
  return { version: contract.version, valid_from: contract.validFrom, settle_currency: contract.settleCurrency, settle_cycle: contract.settleCycle, payment_day: contract.paymentDay, file_id: contract.fileId, note: contract.note };
}

/** 发起人工暂停（双人复核）。原因必填（暂停的原因会出现在状态记录里）。 */
export async function requestSuspendTenant(ctx: AppContext, principal: PlatformPrincipal, tenantId: string, reason: string, ip: string): Promise<Approval> {
  const now = ctx.now();
  return withPlatformTx(ctx.pool, async (db) => {
    const tenant = await tenantForPlatform(db, tenantId, false);
    if (tenant.status === "suspended" && tenant.suspensionReasons.includes("manual")) throw stateInvalid(tenant.status, "这家供应商已经被人工暂停了");
    if (tenant.status !== "trial" && tenant.status !== "active" && tenant.status !== "suspended") throw stateInvalid(tenant.status, `供应商现在是「${TENANT_STATUS_NAMES[tenant.status]}」，还不参与比价，不用暂停`);
    return requestApproval(db, consoleOrigin(platformActor(principal.user), ip, now), principal, {
      kind: TENANT_SUSPEND,
      resourceId: tenantId,
      summary: `暂停供应商「${tenant.name}」：${reason}`,
      payload: { tenant_id: tenantId, tenant_name: tenant.name, reason },
      before: stateValues(tenantState(tenant)),
      // 不核对版本（ADR 0023 暂停渠道的做法）：批准时按那一刻的状态再查一遍能不能暂停 / 清退
      baseVersion: null,
      note: reason,
    });
  });
}

/** 发起清退（双人复核）：已有订单全部履约完毕才能发起。 */
export async function requestTerminateTenant(ctx: AppContext, principal: PlatformPrincipal, tenantId: string, reason: string, ip: string): Promise<Approval> {
  const now = ctx.now();
  return withPlatformTx(ctx.pool, async (db) => {
    const tenant = await tenantForPlatform(db, tenantId, false);
    if (tenant.status === "terminated") throw stateInvalid(tenant.status, "这家供应商已经清退了");
    const open = await countOpenOrders(db, tenantId);
    if (open > 0) throw openOrders(open);
    return requestApproval(db, consoleOrigin(platformActor(principal.user), ip, now), principal, {
      kind: TENANT_TERMINATE,
      resourceId: tenantId,
      summary: `清退供应商「${tenant.name}」：${reason}`,
      payload: { tenant_id: tenantId, tenant_name: tenant.name, reason },
      before: stateValues(tenantState(tenant)),
      // 不核对版本（ADR 0023 暂停渠道的做法）：批准时按那一刻的状态再查一遍能不能暂停 / 清退
      baseVersion: null,
      note: reason,
    });
  });
}

export interface ContractInput {
  validFrom: string;
  settleCurrency: string;
  fileId: string | null;
  note: string | null;
}

/** 发起一个新的合同版本（修改租户结算条款，双人复核）。批准后写入；生效日期到了就是现在的合同。 */
export async function requestContract(ctx: AppContext, principal: PlatformPrincipal, tenantId: string, input: ContractInput, ip: string): Promise<Approval> {
  const now = ctx.now();
  const today = tenantToday(now);
  return withPlatformTx(ctx.pool, async (db) => {
    const tenant = await tenantForPlatform(db, tenantId, false);
    if (tenant.status === "terminated") throw stateInvalid(tenant.status, "已清退的供应商不能再签合同");
    const contracts = await listContracts(db, tenantId);
    const latest = contracts.at(-1) ?? null;
    const issues = contractIssues({ validFrom: input.validFrom, note: input.note }, { today, latestValidFrom: latest?.validFrom ?? null });
    if (!isCurrencyCode(input.settleCurrency)) issues.push({ path: "/settle_currency", reason: "UNSUPPORTED_CURRENCY" });
    if (input.fileId !== null) {
      const file = await findFileMeta(db, tenantId, input.fileId);
      if (!file) issues.push({ path: "/file_id", reason: "UNKNOWN_FILE" });
      else if (file.purpose !== "contract") issues.push({ path: "/file_id", reason: "WRONG_FILE_PURPOSE" });
    }
    if (issues.length > 0) throw issuesInvalid(issues);
    const version = (latest?.version ?? 0) + 1;
    return requestApproval(db, consoleOrigin(platformActor(principal.user), ip, now), principal, {
      kind: TENANT_CONTRACT,
      resourceId: tenantId,
      summary: `供应商「${tenant.name}」的合同第 ${version} 版：${input.validFrom} 起生效，结算币种 ${input.settleCurrency}，月结、次月 ${CONTRACT_TERMS.paymentDay} 日付款`,
      payload: { tenant_id: tenantId, tenant_name: tenant.name, version, valid_from: input.validFrom, settle_currency: input.settleCurrency, file_id: input.fileId, note: input.note },
      before: latest === null ? null : contractValues(latest),
      baseVersion: latest?.version ?? 0,
      note: input.note,
    });
  });
}
