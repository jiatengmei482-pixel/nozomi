/**
 * 敏感操作双人复核的通用机制（M2-04，ADR 0023）。
 *
 * 每一类要复核的操作登记成一个 `ApprovalKind`：谁能看、谁能发起、谁能审核，批准时怎么生效。
 * - 发起（`requestApproval`）：在调用方的事务里写一条待审核记录和一条审计（`approval` / `request`）。发起之前调用方自己把内容校验好。
 * - 审核（`decideApproval`）：锁住这条记录；发起人不能批准、驳回自己发起的（数据库也有约束）；批准时在**同一个事务里**调这一类的 `apply` 让改动生效——
 *   生效失败（发起之后对象被别人改过、现在已经不合规则）整个事务回滚，记录仍是待审核，审核人看到原因后可以驳回。
 * - 撤回：只有发起人自己能撤回待审核的。
 * 汇率人工锁定（M2-06）按这里登记了两类；以后的结算条款、退款超过阈值、停用租户同样登记一类即可。
 */
import { type ApprovalDecision, type ApprovalStatus, type PlatformAction, approvalDecisionRefusal, approvalStatusAfter, platformRoleCan } from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { type Db, withPlatformTx } from "../db/context.ts";
import { AppError } from "../errors.ts";
import type { Page, TimeCursor } from "../pagination.ts";
import { type Approval, type ApprovalFilter, findApproval, insertApproval, listApprovals, setApprovalDecision } from "../repos/approvals.ts";
import { type AuditOrigin, type AuditResource, type AuditValues, insertAuditLog } from "../repos/audit-logs.ts";
import { consoleOrigin, platformActor } from "./audit.ts";
import { forbidden, notFound } from "./errors.ts";
import type { PlatformPrincipal } from "./platform-auth.ts";

export interface ApprovalKind {
  kind: string;
  /** 审计日志里「改的是什么」 */
  resource: AuditResource;
  readAction: PlatformAction;
  requestAction: PlatformAction;
  reviewAction: PlatformAction;
  /**
   * 批准时让改动生效（在批准的事务里，审核人的身份）。不能生效时抛 AppError（多半是 409）：整个批准回滚，记录仍是待审核。
   * 自己写被改对象的审计日志。
   */
  apply(db: Db, approval: Approval, origin: AuditOrigin): Promise<void>;
  /** 批准的事务提交之后要做的事（如作废进程内的缓存，M2-06）；在事务里做会让别的请求在提交前把旧数据读回缓存。可选 */
  afterApply?(ctx: AppContext, approval: Approval): void | Promise<void>;
}

export type ApprovalKinds = ReadonlyMap<string, ApprovalKind>;

export function approvalKinds(list: readonly ApprovalKind[]): ApprovalKinds {
  return new Map(list.map((kind) => [kind.kind, kind]));
}

const REFUSAL_MESSAGES = {
  APPROVAL_NOT_PENDING: "这条复核已经有结论了（批准、驳回或撤回），不能再改",
  APPROVAL_SELF_REVIEW: "发起人不能审核自己发起的改动，请让另一位有审核权限的同事处理",
  APPROVAL_NOT_REQUESTER: "只有发起人自己能撤回",
} as const;

export interface ApprovalRequest {
  kind: ApprovalKind;
  resourceId: string;
  summary: string;
  payload: AuditValues;
  before: AuditValues | null;
  baseVersion: number | null;
  note: string | null;
}

/** 在调用方的事务里发起一条复核。权限由调用方的接口检查（`kind.requestAction`）。 */
export async function requestApproval(db: Db, origin: AuditOrigin, principal: PlatformPrincipal, request: ApprovalRequest): Promise<Approval> {
  if (!platformRoleCan(principal.user.role, request.kind.requestAction)) throw forbidden(request.kind.requestAction);
  const id = await insertApproval(db, {
    kind: request.kind.kind,
    resource: request.kind.resource,
    resourceId: request.resourceId,
    summary: request.summary,
    payload: request.payload,
    before: request.before,
    baseVersion: request.baseVersion,
    requestedBy: principal.user.id,
    requestNote: request.note,
    now: origin.occurredAt,
  });
  await insertAuditLog(db, origin, { tenantId: null, resource: "approval", resourceId: id, action: "request", before: request.before, after: { kind: request.kind.kind, resource: request.kind.resource, resource_id: request.resourceId, summary: request.summary, payload: request.payload } });
  return (await findApproval(db, id)) as Approval;
}

/** 这个人能看到哪几类复核。 */
export function visibleKinds(kinds: ApprovalKinds, principal: PlatformPrincipal): string[] {
  return [...kinds.values()].filter((kind) => platformRoleCan(principal.user.role, kind.readAction)).map((kind) => kind.kind);
}

/** 这个人对这条复核能做什么（给前端决定显示哪些按钮）。 */
export function approvalAbilities(kinds: ApprovalKinds, principal: PlatformPrincipal, approval: Approval): { approve: boolean; reject: boolean; withdraw: boolean } {
  const kind = kinds.get(approval.kind);
  const canReview = kind !== undefined && platformRoleCan(principal.user.role, kind.reviewAction);
  const can = (decision: ApprovalDecision): boolean => approvalDecisionRefusal({ status: approval.status, requestedBy: approval.requestedBy.id }, principal.user.id, decision) === null;
  return { approve: canReview && can("approve"), reject: canReview && can("reject"), withdraw: can("withdraw") };
}

export function listApprovalsFor(ctx: AppContext, kinds: ApprovalKinds, principal: PlatformPrincipal, filter: Omit<ApprovalFilter, "kinds">, limit: number, after: TimeCursor | null): Promise<Page<Approval> & { total: number }> {
  return withPlatformTx(ctx.pool, (db) => listApprovals(db, { ...filter, kinds: visibleKinds(kinds, principal) }, limit, after), { snapshot: true });
}

export async function getApproval(ctx: AppContext, kinds: ApprovalKinds, principal: PlatformPrincipal, id: string): Promise<Approval> {
  const approval = await withPlatformTx(ctx.pool, (db) => findApproval(db, id));
  // 看不到的那几类当作不存在
  if (!approval || !visibleKinds(kinds, principal).includes(approval.kind)) throw notFound("复核记录");
  return approval;
}

/**
 * 批准 / 驳回 / 撤回。批准时在同一个事务里让改动生效；生效失败整个回滚（记录仍是待审核）。
 * 看不到这一类的：404；看得到但没有审核权限的：403；发起人审核自己的：409 `APPROVAL_SELF_REVIEW`。
 */
export async function decideApproval(ctx: AppContext, kinds: ApprovalKinds, principal: PlatformPrincipal, id: string, decision: ApprovalDecision, note: string | null, ip: string): Promise<Approval> {
  const now = ctx.now();
  const origin = consoleOrigin(platformActor(principal.user), ip, now);
  const decided = await withPlatformTx(ctx.pool, async (db) => {
    const approval = await findApproval(db, id, { lock: true });
    const kind = approval === null ? undefined : kinds.get(approval.kind);
    if (!approval || !kind || !platformRoleCan(principal.user.role, kind.readAction)) throw notFound("复核记录");
    if (decision !== "withdraw" && !platformRoleCan(principal.user.role, kind.reviewAction)) throw forbidden(kind.reviewAction);
    const refusal = approvalDecisionRefusal({ status: approval.status, requestedBy: approval.requestedBy.id }, principal.user.id, decision);
    if (refusal !== null) throw new AppError(409, refusal, REFUSAL_MESSAGES[refusal], { status: approval.status });
    if (decision === "approve") await kind.apply(db, approval, origin);
    const status: ApprovalStatus = approvalStatusAfter(decision);
    await setApprovalDecision(db, id, { status, decidedBy: decision === "withdraw" ? null : principal.user.id, note, now });
    await insertAuditLog(db, origin, { tenantId: null, resource: "approval", resourceId: id, action: decision, before: { status: approval.status }, after: { status, kind: approval.kind, resource_id: approval.resourceId, note } });
    return { approval: (await findApproval(db, id)) as Approval, kind };
  });
  if (decision === "approve") await decided.kind.afterApply?.(ctx, decided.approval);
  return decided.approval;
}

/** 发起之后对象被别人改过（版本对不上）：不能照旧生效。 */
export function approvalStale(currentVersion: number): AppError {
  return new AppError(409, "APPROVAL_STALE", "发起这条复核之后，要改的对象已经被别的改动改过了；请驳回，再按现在的内容重新发起", { current_version: currentVersion });
}
