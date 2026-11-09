/**
 * 供应商名称和企业信息的维护（M4-34，ADR 0071）。规则在 @nozomi/domain 的 tenant-profile.ts，取数在 repos/tenant-profile-changes.ts。
 *
 * - 平台（`tenant.edit`）：直接改对外显示名称（`If-Match` 供应商的版本）和企业信息（`If-Match` 企业信息的版本），任何状态都能改，记审计（改前改后）。
 * - 供应商改名称、法定名称、登记号：提交申请（同时只有一条等处理的），审核期间旧值照常用；
 *   平台一位同事（`tenant.review`）核对后发起复核，另一位（`tenant.approve`）批准才生效——批准时核对提交时的旧值没被平台改过；也可以直接驳回（原因必填，供应商看得到）。
 * - 申请的提交、撤回在平台事务里做（供应商对申请表只读），租户编号只来自令牌，每条 SQL 都带它。
 * - 通知中心：提交时通知平台运营（`tenant.profile_change_submitted`），生效、驳回时通知供应商的管理员。
 */
import { PROFILE_CHANGE_FIELDS, PROFILE_FIELD_NAMES, type ProfileChangeField, type ProfileChangeInput, profileChangeDrift, profileChangeIssues } from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { type Db, isUniqueViolation, withPlatformTx, withTenantTx } from "../db/context.ts";
import { AppError } from "../errors.ts";
import type { Approval } from "../repos/approvals.ts";
import { type AuditOrigin, insertAuditLog } from "../repos/audit-logs.ts";
import { enqueueNotification } from "../repos/notifications.ts";
import { type ProfileFields, type StoredProfile, findProfile, upsertProfile } from "../repos/tenant-onboarding.ts";
import {
  type ProfileChange,
  type ProfileChangeValues,
  decideProfileChange,
  findPendingProfileChange,
  findProfileChange,
  insertProfileChange,
  listOwnProfileChanges,
  listProfileChangesForPlatform,
} from "../repos/tenant-profile-changes.ts";
import { type Tenant, findTenantForPlatform, renameTenant } from "../repos/tenants.ts";
import { validationFailed } from "../validation.ts";
import { type ApprovalKind, approvalStale, requestApproval } from "./approvals.ts";
import { consoleOrigin, platformActor, tenantActor } from "./audit.ts";
import { notFound, versionConflict } from "./errors.ts";
import type { PlatformPrincipal } from "./platform-auth.ts";
import type { TenantPrincipal } from "./tenant-auth.ts";
import { profileValues } from "./tenant-onboarding.ts";

const LIST_LIMIT = 50;

const ISSUE_MESSAGES: Readonly<Record<string, string>> = {
  REQUIRED: "至少要改一项：对外显示名称、法定名称、登记号",
  EMPTY: "不能为空",
  TOO_LONG: "太长了",
  UNCHANGED: "和现在的一样，不用申请",
};

async function lockedTenant(db: Db, tenantId: string): Promise<Tenant> {
  const tenant = await findTenantForPlatform(db, tenantId, { lock: true });
  if (!tenant) throw notFound("供应商");
  return tenant;
}

function currentValues(tenant: Tenant, profile: StoredProfile | null): Record<ProfileChangeField, string | null> {
  return { name: tenant.name, legal_name: profile?.legalName ?? null, registration_no: profile?.registrationNo ?? null };
}

// ---- 平台直接改 ----

/** 改对外显示名称。`If-Match` 是供应商的版本（状态变化也会让它加一，冲突时刷新再改）。和现在一样的不写。 */
export async function renameTenantByPlatform(ctx: AppContext, principal: PlatformPrincipal, tenantId: string, expectedVersion: number, name: string, ip: string): Promise<Tenant> {
  const now = ctx.now();
  return withPlatformTx(ctx.pool, async (db) => {
    const tenant = await lockedTenant(db, tenantId);
    if (tenant.version !== expectedVersion) throw versionConflict(tenant.version);
    if (tenant.name === name) return tenant;
    const renamed = await renameTenant(db, tenantId, name, now);
    await insertAuditLog(db, consoleOrigin(platformActor(principal.user), ip, now), { tenantId, resource: "tenant", resourceId: tenantId, action: "update", before: { name: tenant.name }, after: { name: renamed.name } });
    return renamed;
  });
}

/** 改企业信息（整体替换，任何状态都能改）。第一次填没有版本、不带 `If-Match`；以后要带。和现在一样的不写。 */
export async function putProfileByPlatform(ctx: AppContext, principal: PlatformPrincipal, tenantId: string, expectedVersion: number | null, fields: ProfileFields, ip: string): Promise<StoredProfile> {
  const now = ctx.now();
  return withPlatformTx(ctx.pool, async (db) => {
    await lockedTenant(db, tenantId);
    const before = await findProfile(db, tenantId, { lock: true });
    if (before !== null && expectedVersion !== before.version) throw versionConflict(before.version);
    if (before === null && expectedVersion !== null) throw versionConflict(0);
    const after = profileValues(fields);
    if (before !== null && Object.entries(after).every(([key, value]) => profileValues(before)[key as keyof typeof after] === value)) return before;
    const saved = await upsertProfile(db, tenantId, fields, now);
    await insertAuditLog(db, consoleOrigin(platformActor(principal.user), ip, now), { tenantId, resource: "tenant_profile", resourceId: tenantId, action: before === null ? "create" : "update", before: before === null ? null : profileValues(before), after: profileValues(saved) });
    return saved;
  });
}

// ---- 供应商的修改申请 ----

export function listOwnChanges(ctx: AppContext, tenantId: string): Promise<ProfileChange[]> {
  return withTenantTx(ctx.pool, tenantId, (db) => listOwnProfileChanges(db, tenantId, LIST_LIMIT), { snapshot: true });
}

function pendingExists(id: string | null): AppError {
  return new AppError(409, "PROFILE_CHANGE_PENDING_EXISTS", "已经有一条等平台处理的修改申请，先撤回它再提交", id === null ? {} : { change_id: id });
}

/** 提交修改申请：名称、法定名称、登记号里改哪几项给哪几项；和现在一样的 400。审核期间旧值照常用。 */
export async function submitProfileChange(ctx: AppContext, principal: TenantPrincipal, input: ProfileChangeInput & { note: string | null }, ip: string): Promise<ProfileChange> {
  const now = ctx.now();
  const tenantId = principal.tenantId;
  try {
    return await withPlatformTx(ctx.pool, async (db) => {
      const tenant = await lockedTenant(db, tenantId);
      const profile = await findProfile(db, tenantId);
      const current = currentValues(tenant, profile);
      const issues = profileChangeIssues(input, current);
      if (issues.length > 0) throw validationFailed("body", issues.map((issue) => ({ path: issue.path, reason: issue.reason, message: ISSUE_MESSAGES[issue.reason] ?? issue.reason })));
      const existing = await findPendingProfileChange(db, tenantId);
      if (existing !== null) throw pendingExists(existing);
      const fields = PROFILE_CHANGE_FIELDS.filter((field) => input[field] !== undefined);
      const proposed: ProfileChangeValues = Object.fromEntries(fields.map((field) => [field, input[field] as string]));
      const previous: ProfileChangeValues = Object.fromEntries(fields.map((field) => [field, current[field]]));
      const id = await insertProfileChange(db, { tenantId, fields, proposed, previous, note: input.note, submittedBy: principal.user.id, now });
      await insertAuditLog(db, consoleOrigin(tenantActor(principal.user), ip, now), { tenantId, resource: "tenant_profile_change", resourceId: id, action: "submit", before: previous, after: { ...proposed, status: "pending", ...(input.note === null ? {} : { note: input.note }) } });
      await enqueueNotification(db, { event: "tenant.profile_change_submitted", tenantId, orderId: null, dedupeKey: `tenant.profile_change_submitted:${id}`, data: { tenant_name: tenant.name, profile_fields: fields } }, now);
      return (await findProfileChange(db, id, { tenantId })) as ProfileChange;
    });
  } catch (err) {
    if (isUniqueViolation(err, "tenant_profile_changes_pending_key")) throw pendingExists(null);
    throw err;
  }
}

function stateInvalid(change: ProfileChange, message: string): AppError {
  return new AppError(409, "PROFILE_CHANGE_STATE_INVALID", message, { status: change.status });
}

/** 撤回自己等处理的申请（只在令牌里的租户里找，别的供应商的 404）。已经发起的复核会过期（批准时 `APPROVAL_STALE`）。 */
export async function withdrawProfileChange(ctx: AppContext, principal: TenantPrincipal, id: string, ip: string): Promise<ProfileChange> {
  const now = ctx.now();
  const tenantId = principal.tenantId;
  return withPlatformTx(ctx.pool, async (db) => {
    const change = await findProfileChange(db, id, { tenantId, lock: true });
    if (change === null) throw notFound("修改申请");
    if (change.status !== "pending") throw stateInvalid(change, "只有等处理的申请能撤回");
    await decideProfileChange(db, tenantId, id, { status: "withdrawn" }, now);
    await insertAuditLog(db, consoleOrigin(tenantActor(principal.user), ip, now), { tenantId, resource: "tenant_profile_change", resourceId: id, action: "withdraw", before: { status: change.status }, after: { status: "withdrawn" } });
    return (await findProfileChange(db, id, { tenantId })) as ProfileChange;
  });
}

// ---- 平台处理申请 ----

export function listChangesForPlatform(ctx: AppContext, tenantId: string): Promise<ProfileChange[]> {
  return withPlatformTx(
    ctx.pool,
    async (db) => {
      if ((await findTenantForPlatform(db, tenantId, { lock: false })) === null) throw notFound("供应商");
      return listProfileChangesForPlatform(db, tenantId, LIST_LIMIT);
    },
    { snapshot: true },
  );
}

function reviewPending(approvalId: string | null): AppError {
  return new AppError(409, "PROFILE_CHANGE_REVIEW_PENDING", "这条申请已经有一条待审核的复核：先在「待审核」里批准、驳回或撤回那条复核", { approval_id: approvalId ?? "" });
}

function changeLines(change: ProfileChange): string {
  return change.fields.map((field) => `${PROFILE_FIELD_NAMES[field]}「${change.previous[field] ?? "（空）"}」→「${change.proposed[field] ?? ""}」`).join("，");
}

/** 发起复核（核对过营业执照、登记簿以后）：只有等处理的；同一条申请同时只有一条待审核的复核。批准时核对申请的版本。 */
export async function requestProfileChangeReview(ctx: AppContext, principal: PlatformPrincipal, tenantId: string, id: string, note: string | null, ip: string): Promise<Approval> {
  const now = ctx.now();
  return withPlatformTx(ctx.pool, async (db) => {
    const change = await findProfileChange(db, id, { tenantId, lock: true });
    if (change === null) throw notFound("修改申请");
    if (change.status !== "pending") throw stateInvalid(change, "只有等处理的申请能发起复核");
    if (change.pendingApprovalId !== null) throw reviewPending(change.pendingApprovalId);
    const tenant = await lockedTenant(db, tenantId);
    return requestApproval(db, consoleOrigin(platformActor(principal.user), ip, now), principal, {
      kind: TENANT_PROFILE_CHANGE,
      resourceId: id,
      summary: `供应商「${tenant.name}」申请修改：${changeLines(change)}`,
      payload: { change_id: id, tenant_id: tenantId, tenant_name: tenant.name, fields: change.fields, ...change.proposed },
      before: change.previous,
      baseVersion: change.version,
      note,
    });
  });
}

/** 驳回（原因必填，供应商看得到）。有待审核的复核时先处理复核。 */
export async function rejectProfileChange(ctx: AppContext, principal: PlatformPrincipal, tenantId: string, id: string, reason: string, ip: string): Promise<ProfileChange> {
  const now = ctx.now();
  return withPlatformTx(ctx.pool, async (db) => {
    const change = await findProfileChange(db, id, { tenantId, lock: true });
    if (change === null) throw notFound("修改申请");
    if (change.status !== "pending") throw stateInvalid(change, "只有等处理的申请能驳回");
    if (change.pendingApprovalId !== null) throw reviewPending(change.pendingApprovalId);
    await decideProfileChange(db, tenantId, id, { status: "rejected", rejectedBy: principal.user.id, reason }, now);
    await insertAuditLog(db, consoleOrigin(platformActor(principal.user), ip, now), { tenantId, resource: "tenant_profile_change", resourceId: id, action: "reject", before: { status: change.status }, after: { status: "rejected", reason } });
    await notifyTenant(db, "tenant.profile_change_rejected", change, reason, now);
    return (await findProfileChange(db, id, { tenantId })) as ProfileChange;
  });
}

function notifyTenant(db: Db, event: "tenant.profile_change_approved" | "tenant.profile_change_rejected", change: ProfileChange, reason: string | null, now: Date): Promise<void> {
  return enqueueNotification(db, { event, tenantId: change.tenantId, orderId: null, dedupeKey: `${event}:${change.id}`, data: { profile_fields: change.fields, ...(reason === null ? {} : { reject_reason: reason }) } }, now);
}

/**
 * 批准：在批准的事务里（审核人的身份）把申请写进 `tenants.name` / `tenant_profiles`。
 * 申请撤回或版本变了 → `APPROVAL_STALE`；提交时的旧值被平台改过 → `APPROVAL_STALE`（不能用旧申请盖掉平台的改动），都整个回滚，复核仍待审核，审核人驳回即可。
 */
export const TENANT_PROFILE_CHANGE: ApprovalKind = {
  kind: "tenant.profile_change",
  resource: "tenant_profile_change",
  readAction: "tenant.read",
  requestAction: "tenant.review",
  reviewAction: "tenant.approve",
  async apply(db, approval, origin) {
    const tenantId = approval.payload["tenant_id"] as string;
    const change = await findProfileChange(db, approval.resourceId, { tenantId, lock: true });
    if (change === null || change.status !== "pending" || change.version !== approval.baseVersion) throw approvalStale(change?.version ?? 0);
    const tenant = await lockedTenant(db, tenantId);
    const profile = await findProfile(db, tenantId, { lock: true });
    if (profileChangeDrift(change.previous, currentValues(tenant, profile)).length > 0) throw approvalStale(change.version);
    await applyChange(db, change, tenant, profile, approval, origin);
  },
};

async function applyChange(db: Db, change: ProfileChange, tenant: Tenant, profile: StoredProfile | null, approval: Approval, origin: AuditOrigin): Promise<void> {
  const now = origin.occurredAt;
  const stamp = { approval_id: approval.id, change_id: change.id };
  if (change.fields.includes("name")) {
    const renamed = await renameTenant(db, tenant.id, change.proposed["name"] as string, now);
    await insertAuditLog(db, origin, { tenantId: tenant.id, resource: "tenant", resourceId: tenant.id, action: "update", before: { name: tenant.name }, after: { name: renamed.name, ...stamp } });
  }
  if (change.fields.includes("legal_name") || change.fields.includes("registration_no")) {
    const base: ProfileFields = profile ?? { countryCode: null, legalName: null, registrationNo: null, address: null, contactName: null, contactPhone: null, contactEmail: null };
    const next: ProfileFields = {
      ...base,
      ...(change.fields.includes("legal_name") ? { legalName: change.proposed["legal_name"] as string } : {}),
      ...(change.fields.includes("registration_no") ? { registrationNo: change.proposed["registration_no"] as string } : {}),
    };
    const saved = await upsertProfile(db, tenant.id, next, now);
    await insertAuditLog(db, origin, { tenantId: tenant.id, resource: "tenant_profile", resourceId: tenant.id, action: profile === null ? "create" : "update", before: profile === null ? null : profileValues(profile), after: { ...profileValues(saved), ...stamp } });
  }
  await decideProfileChange(db, tenant.id, change.id, { status: "approved", approvalId: approval.id }, now);
  await insertAuditLog(db, origin, { tenantId: tenant.id, resource: "tenant_profile_change", resourceId: change.id, action: "approve", before: { status: change.status }, after: { status: "approved", approval_id: approval.id, requested_by: approval.requestedBy.id } });
  await notifyTenant(db, "tenant.profile_change_approved", change, null, now);
}

export const TENANT_PROFILE_APPROVAL_KINDS: readonly ApprovalKind[] = [TENANT_PROFILE_CHANGE];
