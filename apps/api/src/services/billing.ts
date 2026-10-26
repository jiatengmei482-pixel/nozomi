/**
 * 供应商应付账单与付款批次的业务流程（M5-01，ADR 0040）。规则在 @nozomi/domain 的 billing.ts，取数在 repos/billing.ts。
 *
 * - 出账（`generateStatements`）：给一期（已经结束的月份）里每个有还没出账的应付的供应商，按币种各出一张账单。可以反复运行：
 *   一笔应付同一时刻只挂在一张有效的账单上，同一期同一币种只有一张有效的账单；同一家供应商一家一家排队（advisory lock），几个实例同时跑也只出一次。
 *   定时任务每小时出一次「上个月」的；财务也可以手动出（同一个函数）。
 * - 供应商确认 / 提异议；确认期满（出账起 7 天）还没确认、也没提异议，系统视为确认。平台答复异议后回到待确认（重新给 7 天）。
 * - 平台作废（明细释放）后马上按现在的数据重出这一期这家供应商的账单。
 * - 付款给供应商的双人复核（`statement.payout`）：财务发起、另一位财务批准；批准时合计为正进付款日（默认次月 20 日）的批次，为 0 无需付款，为负转入下期。
 * - 付款批次：一个付款日一个，收复核通过的账单；财务锁定后等银行转账（转账文件、流水号回填在 M5-02）。
 */
import { randomInt } from "node:crypto";
import {
  BILLING_RULES,
  ORDER_NO_ALPHABET,
  type PayoutBatchStatus,
  type StatementAction,
  type StatementStatus,
  billingToday,
  confirmDueAt,
  draftStatements,
  isBillingPeriod,
  payDueDate,
  payoutDateFor,
  periodEnded,
  periodLastDay,
  periodToGenerate,
  statementActionAllowed,
  statusAfterApproval,
} from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { type Db, withPlatformTx, withTenantTx } from "../db/context.ts";
import { AppError } from "../errors.ts";
import type { Page, TimeCursor } from "../pagination.ts";
import type { Approval } from "../repos/approvals.ts";
import { type AuditOrigin, insertAuditLog } from "../repos/audit-logs.ts";
import {
  type BatchSummary,
  type PayoutBatch,
  type PlatformStatementFilter,
  type Statement,
  type StatementActorType,
  type StatementEvent,
  type StatementLine,
  closeBatch,
  closedBatchDates,
  contractPaymentDay,
  findBatch,
  findStatement,
  insertStatement,
  insertStatementEvent,
  insertStatementLines,
  listAutoConfirmDue,
  listBatchStatements,
  listBatches,
  listBillableItems,
  listCurrentCurrencies,
  listPlatformStatements,
  listStatementEvents,
  listStatementLines,
  listTenantStatements,
  listTenantsWithBillableItems,
  lockBatchFor,
  lockTenantBilling,
  pendingReviewOf,
  tenantName,
  tenantStatus,
  updateStatement,
  voidStatementLines,
} from "../repos/billing.ts";
import { type ApprovalKind, approvalStale, requestApproval } from "./approvals.ts";
import { consoleOrigin, platformActor, tenantActor } from "./audit.ts";
import { notFound } from "./errors.ts";
import type { PlatformPrincipal } from "./platform-auth.ts";
import type { TenantPrincipal } from "./tenant-auth.ts";

export interface BillingActor {
  type: StatementActorType;
  id: string | null;
  origin: AuditOrigin;
}

const SYSTEM_ORIGIN = (now: Date): AuditOrigin => ({ occurredAt: now, actor: { type: "system", id: null, email: null }, ip: null, source: "job" });

function systemActor(now: Date): BillingActor {
  return { type: "system", id: null, origin: SYSTEM_ORIGIN(now) };
}

function platformBillingActor(principal: PlatformPrincipal, ip: string, now: Date): BillingActor {
  return { type: "platform_user", id: principal.user.id, origin: consoleOrigin(platformActor(principal.user), ip, now) };
}

const STATE_MESSAGES: Readonly<Record<StatementAction, string>> = {
  confirm: "只有待确认、有异议的账单能确认",
  auto_confirm: "只有待确认的账单能自动确认",
  dispute: "只有待确认的账单能提异议（已经提过的等平台答复）",
  reply: "只有有异议的账单能答复",
  void: "只有待确认、有异议、待复核的账单能作废；已进付款批次或已有复核结论的不能",
  request_review: "只有供应商已确认的账单能发起付款复核",
  approve: "只有待复核的账单能批准付款",
  pay: "只有已进付款批次的账单能记为已付款",
};

function stateInvalid(statement: Statement, action: StatementAction): AppError {
  return new AppError(409, "STATEMENT_STATE_INVALID", STATE_MESSAGES[action], { status: statement.status });
}

function assertAction(statement: Statement, action: StatementAction): void {
  if (!statementActionAllowed(statement.status, action)) throw stateInvalid(statement, action);
}

function statementNo(period: string): string {
  let random = "";
  for (let i = 0; i < 8; i += 1) random += ORDER_NO_ALPHABET[randomInt(ORDER_NO_ALPHABET.length)];
  return `ST${period.replace("-", "")}${random}`;
}

// ---- 出账 ----

/**
 * 给一家供应商出一期的账（调用方的平台事务里）：先排队（同一家一次只有一个在出），再取还没出账的应付、按币种组成草稿，
 * 跳过这一期已经有有效账单的币种。返回新出的账单。
 */
export async function generateForTenant(db: Db, tenantId: string, period: string, actor: BillingActor): Promise<(Statement & { tenantName: string })[]> {
  const now = actor.origin.occurredAt;
  await lockTenantBilling(db, tenantId);
  const items = await listBillableItems(db, tenantId, periodLastDay(period));
  const drafts = draftStatements(period, items, await listCurrentCurrencies(db, tenantId, period));
  if (drafts.length === 0) return [];
  const today = billingToday(now);
  const payDue = payDueDate(period, (await contractPaymentDay(db, tenantId, today)) ?? BILLING_RULES.paymentDay, (await tenantStatus(db, tenantId)) === "terminated");
  const name = await tenantName(db, tenantId);
  const created: (Statement & { tenantName: string })[] = [];
  for (const draft of drafts) {
    const id = await insertStatement(db, { tenantId, statementNo: statementNo(period), period, currency: draft.currency, totalMinor: draft.totalMinor, lineCount: draft.lines.length, payDueOn: payDue, confirmDueAt: confirmDueAt(now), now });
    await insertStatementLines(db, tenantId, id, draft.lines, now);
    await insertStatementEvent(db, tenantId, id, { action: "issue", actorType: actor.type, actorId: actor.id, note: null, data: { total_minor: draft.totalMinor, line_count: draft.lines.length, prior_period_lines: draft.lines.filter((line) => line.priorPeriod).length }, at: now });
    await insertAuditLog(db, actor.origin, { tenantId: null, resource: "statement", resourceId: id, action: "issue", before: null, after: { tenant_id: tenantId, period, currency: draft.currency, total_minor: draft.totalMinor, line_count: draft.lines.length, pay_due_on: payDue } });
    created.push({ ...((await findStatement(db, id)) as Statement), tenantName: name });
  }
  return created;
}

export interface GenerateResult {
  period: string;
  created: (Statement & { tenantName: string })[];
  /** 出账时出错的供应商（下一轮再试） */
  failed: string[];
}

/** 给一期出账：逐家供应商，每家一个事务（一家出错不影响别的）。只能出已经结束的月份。 */
export async function generateStatements(ctx: AppContext, period: string, actor: BillingActor, log: { error(obj: object, msg: string): void } | null = null): Promise<GenerateResult> {
  const today = billingToday(actor.origin.occurredAt);
  if (!isBillingPeriod(period)) throw new AppError(400, "VALIDATION_FAILED", "请求参数校验未通过", { location: "body", issues: [{ path: "/period", message: "账单周期的格式是 YYYY-MM" }] });
  if (!periodEnded(period, today)) throw new AppError(409, "PERIOD_NOT_ENDED", `${period} 还没结束（按东京日期），月份结束后才能出账`, { period, today });
  const tenants = await withPlatformTx(ctx.pool, (db) => listTenantsWithBillableItems(db, periodLastDay(period)));
  const result: GenerateResult = { period, created: [], failed: [] };
  for (const tenantId of tenants) {
    try {
      result.created.push(...(await withPlatformTx(ctx.pool, (db) => generateForTenant(db, tenantId, period, actor))));
    } catch (err) {
      if (log === null) throw err;
      log.error({ err, tenantId, period }, "出账失败，下一轮再试");
      result.failed.push(tenantId);
    }
  }
  return result;
}

export function generateForPlatform(ctx: AppContext, principal: PlatformPrincipal, period: string | null, ip: string): Promise<GenerateResult> {
  const now = ctx.now();
  return generateStatements(ctx, period ?? periodToGenerate(now), platformBillingActor(principal, ip, now));
}

// ---- 查看 ----

export interface StatementView {
  statement: Statement;
  tenantName: string;
  lines: StatementLine[];
  events: StatementEvent[];
  pendingApprovalId: string | null;
}

async function loadView(db: Db, statement: Statement, withPending: boolean): Promise<StatementView> {
  return {
    statement,
    tenantName: await tenantName(db, statement.tenantId),
    lines: await listStatementLines(db, statement.tenantId, statement.id),
    events: await listStatementEvents(db, statement.tenantId, statement.id),
    pendingApprovalId: withPending ? await pendingReviewOf(db, statement.id) : null,
  };
}

export function listStatementsForTenant(ctx: AppContext, tenantId: string, filter: { period: string | null; status: StatementStatus | null }): Promise<Statement[]> {
  return withTenantTx(ctx.pool, tenantId, (db) => listTenantStatements(db, tenantId, filter));
}

/** 供应商看自己的一张账单（租户事务：行级安全；别的供应商的当作不存在）。 */
export async function getStatementForTenant(ctx: AppContext, tenantId: string, id: string): Promise<StatementView> {
  return withTenantTx(ctx.pool, tenantId, async (db) => {
    const statement = await findStatement(db, id, { tenantId });
    if (statement === null) throw notFound("账单");
    return { statement, tenantName: "", lines: await listStatementLines(db, tenantId, id), events: await listStatementEvents(db, tenantId, id), pendingApprovalId: null };
  });
}

export function listStatementsForPlatform(ctx: AppContext, filter: PlatformStatementFilter, limit: number, after: TimeCursor | null): Promise<Page<Statement & { tenantName: string }> & { total: number }> {
  return withPlatformTx(ctx.pool, (db) => listPlatformStatements(db, filter, limit, after), { snapshot: true });
}

export async function getStatementForPlatform(ctx: AppContext, id: string): Promise<StatementView> {
  return withPlatformTx(ctx.pool, async (db) => {
    const statement = await findStatement(db, id);
    if (statement === null) throw notFound("账单");
    return loadView(db, statement, true);
  });
}

// ---- 供应商确认、提异议 ----

/**
 * 供应商确认自己的账单（平台事务；只在令牌里的租户里找，别的供应商的 404）。已确认过的再确认：原样返回（幂等）。
 */
export async function confirmByTenant(ctx: AppContext, principal: TenantPrincipal, id: string, ip: string): Promise<StatementView> {
  const now = ctx.now();
  return withPlatformTx(ctx.pool, async (db) => {
    const statement = await findStatement(db, id, { tenantId: principal.tenantId, lock: true });
    if (statement === null) throw notFound("账单");
    if (statement.status !== "confirmed") {
      assertAction(statement, "confirm");
      await updateStatement(db, statement.tenantId, id, { status: "confirmed", confirmed_at: now, confirmed_by_type: "tenant_user", confirmed_by: principal.user.id }, now);
      await insertStatementEvent(db, statement.tenantId, id, { action: "confirm", actorType: "tenant_user", actorId: principal.user.id, note: null, data: { from: statement.status }, at: now });
      await insertAuditLog(db, consoleOrigin(tenantActor(principal.user), ip, now), { tenantId: principal.tenantId, resource: "statement", resourceId: id, action: "confirm", before: { status: statement.status }, after: { status: "confirmed" } });
    }
    return loadView(db, (await findStatement(db, id)) as Statement, false);
  });
}

export async function disputeByTenant(ctx: AppContext, principal: TenantPrincipal, id: string, reason: string, ip: string): Promise<StatementView> {
  const now = ctx.now();
  return withPlatformTx(ctx.pool, async (db) => {
    const statement = await findStatement(db, id, { tenantId: principal.tenantId, lock: true });
    if (statement === null) throw notFound("账单");
    assertAction(statement, "dispute");
    await updateStatement(db, statement.tenantId, id, { status: "disputed", disputed_at: now, dispute_reason: reason }, now);
    await insertStatementEvent(db, statement.tenantId, id, { action: "dispute", actorType: "tenant_user", actorId: principal.user.id, note: reason, data: {}, at: now });
    await insertAuditLog(db, consoleOrigin(tenantActor(principal.user), ip, now), { tenantId: principal.tenantId, resource: "statement", resourceId: id, action: "dispute", before: { status: statement.status }, after: { status: "disputed", reason } });
    return loadView(db, (await findStatement(db, id)) as Statement, false);
  });
}

// ---- 平台：答复异议、作废重出 ----

/** 答复异议：回到待确认，重新给一个确认期。账目要改的，先在源头改好（例如审核加收），再作废重出。 */
export async function replyToDispute(ctx: AppContext, principal: PlatformPrincipal, id: string, note: string, ip: string): Promise<StatementView> {
  const now = ctx.now();
  return withPlatformTx(ctx.pool, async (db) => {
    const statement = await findStatement(db, id, { lock: true });
    if (statement === null) throw notFound("账单");
    assertAction(statement, "reply");
    const due = confirmDueAt(now);
    await updateStatement(db, statement.tenantId, id, { status: "issued", confirm_due_at: due }, now);
    await insertStatementEvent(db, statement.tenantId, id, { action: "reply", actorType: "platform_user", actorId: principal.user.id, note, data: { confirm_due_at: due.toISOString() }, at: now });
    await insertAuditLog(db, consoleOrigin(platformActor(principal.user), ip, now), { tenantId: null, resource: "statement", resourceId: id, action: "reply", before: { status: statement.status }, after: { status: "issued", note, confirm_due_at: due.toISOString() } });
    return loadView(db, (await findStatement(db, id)) as Statement, true);
  });
}

/**
 * 作废并重出：账单和明细作废（应付释放），在同一个事务里按现在的数据重出这一期这家供应商的账单（作废期间改好的源头数据会带进来）。
 * 有待审核的付款复核时不能作废（先驳回或撤回那条复核）。
 */
export async function voidStatement(ctx: AppContext, principal: PlatformPrincipal, id: string, reason: string, ip: string): Promise<{ voided: StatementView; reissued: (Statement & { tenantName: string })[] }> {
  const now = ctx.now();
  const actor = platformBillingActor(principal, ip, now);
  return withPlatformTx(ctx.pool, async (db) => {
    const statement = await findStatement(db, id, { lock: true });
    if (statement === null) throw notFound("账单");
    assertAction(statement, "void");
    const pending = await pendingReviewOf(db, id);
    if (pending !== null) throw new AppError(409, "STATEMENT_REVIEW_PENDING", "这张账单有待审核的付款复核，先驳回或撤回那条复核再作废", { approval_id: pending });
    await lockTenantBilling(db, statement.tenantId);
    await voidStatementLines(db, statement.tenantId, id, now);
    await updateStatement(db, statement.tenantId, id, { status: "void", voided_at: now, voided_by: principal.user.id, void_reason: reason }, now);
    await insertStatementEvent(db, statement.tenantId, id, { action: "void", actorType: "platform_user", actorId: principal.user.id, note: reason, data: { from: statement.status }, at: now });
    await insertAuditLog(db, actor.origin, { tenantId: null, resource: "statement", resourceId: id, action: "void", before: { status: statement.status, total_minor: statement.totalMinor }, after: { status: "void", reason } });
    const reissued = await generateForTenant(db, statement.tenantId, statement.period, actor);
    return { voided: await loadView(db, (await findStatement(db, id)) as Statement, false), reissued };
  });
}

// ---- 付款给供应商：双人复核 ----

/** 发起付款复核：只有供应商已确认的；一张账单同时只有一条待审核的。批准时核对账单的版本（发起后被作废、改过就 `APPROVAL_STALE`）。 */
export async function requestPayoutReview(ctx: AppContext, principal: PlatformPrincipal, id: string, note: string | null, ip: string): Promise<Approval> {
  const now = ctx.now();
  return withPlatformTx(ctx.pool, async (db) => {
    const statement = await findStatement(db, id, { lock: true });
    if (statement === null) throw notFound("账单");
    assertAction(statement, "request_review");
    const pending = await pendingReviewOf(db, id);
    if (pending !== null) throw new AppError(409, "STATEMENT_REVIEW_PENDING", "这张账单已经有一条待审核的付款复核", { approval_id: pending });
    const name = await tenantName(db, statement.tenantId);
    const origin = consoleOrigin(platformActor(principal.user), ip, now);
    const approval = await requestApproval(db, origin, principal, {
      kind: STATEMENT_PAYOUT,
      resourceId: id,
      summary: `付款给供应商「${name}」：${statement.period} 账单 ${statement.statementNo}，合计 ${statement.totalMinor} ${statement.currency}（${statement.lineCount} 条明细），应付日 ${statement.payDueOn}`,
      payload: { statement_id: id, tenant_id: statement.tenantId, tenant_name: name, statement_no: statement.statementNo, period: statement.period, currency: statement.currency, total_minor: statement.totalMinor, line_count: statement.lineCount, pay_due_on: statement.payDueOn },
      before: { status: statement.status },
      baseVersion: statement.version,
      note,
    });
    await insertStatementEvent(db, statement.tenantId, id, { action: "request_review", actorType: "platform_user", actorId: principal.user.id, note, data: { approval_id: approval.id }, at: now });
    return approval;
  });
}

/** 付款日：从应付日起第一个不早于今天、批次还开着的；锁住那个批次（和锁定批次排好先后），锁到之后发现刚被锁定就顺延。 */
async function lockPayoutBatch(db: Db, payDue: string, now: Date): Promise<PayoutBatch> {
  const today = billingToday(now);
  const closed = new Set(await closedBatchDates(db, payDue));
  for (;;) {
    const date = payoutDateFor(payDue, today, (candidate) => closed.has(candidate));
    const batch = await lockBatchFor(db, date, now);
    if (batch.status === "open") return batch;
    closed.add(date);
  }
}

export const STATEMENT_PAYOUT: ApprovalKind = {
  kind: "statement.payout",
  resource: "statement",
  readAction: "statement.read",
  requestAction: "statement.manage",
  reviewAction: "statement.review",
  // 一张账单里有这家供应商在各个城市、各个渠道的订单：限定了数据范围的人看不到、审不了（ADR 0040）
  unscopedOnly: true,
  async apply(db, approval, origin) {
    const id = approval.payload["statement_id"] as string;
    const statement = await findStatement(db, id, { lock: true });
    if (statement === null || statement.status !== "confirmed" || statement.version !== approval.baseVersion) throw approvalStale(statement?.version ?? 0);
    const now = origin.occurredAt;
    const outcome = statusAfterApproval(statement.totalMinor);
    const batch = outcome === "in_payout" ? await lockPayoutBatch(db, statement.payDueOn, now) : null;
    await updateStatement(db, statement.tenantId, id, { status: outcome, approval_id: approval.id, approved_at: now, payout_batch_id: batch?.id ?? null, payout_on: batch?.payDate ?? null }, now);
    await insertStatementEvent(db, statement.tenantId, id, { action: "approve", actorType: "platform_user", actorId: origin.actor.id, note: null, data: { approval_id: approval.id, outcome, payout_on: batch?.payDate ?? null }, at: now });
    await insertAuditLog(db, origin, {
      tenantId: null,
      resource: "statement",
      resourceId: id,
      action: "approve",
      before: { status: statement.status },
      after: { status: outcome, approval_id: approval.id, requested_by: approval.requestedBy.id, payout_batch_id: batch?.id ?? null, payout_on: batch?.payDate ?? null, total_minor: statement.totalMinor, currency: statement.currency },
    });
  },
};

export const BILLING_APPROVAL_KINDS: readonly ApprovalKind[] = [STATEMENT_PAYOUT];

// ---- 付款批次 ----

export function listBatchesForPlatform(ctx: AppContext, status: PayoutBatchStatus | null): Promise<BatchSummary[]> {
  return withPlatformTx(ctx.pool, (db) => listBatches(db, { status }), { snapshot: true });
}

export async function getBatchForPlatform(ctx: AppContext, id: string): Promise<{ batch: PayoutBatch; statements: (Statement & { tenantName: string })[] }> {
  return withPlatformTx(
    ctx.pool,
    async (db) => {
      const batch = await findBatch(db, id);
      if (batch === null) throw notFound("付款批次");
      return { batch, statements: await listBatchStatements(db, id) };
    },
    { snapshot: true },
  );
}

/** 锁定批次：不再收新的账单（之后复核通过的顺延到下个月的付款日），等银行转账（M5-02）。已锁定的再锁：原样返回。 */
export async function closeBatchForPlatform(ctx: AppContext, principal: PlatformPrincipal, id: string, ip: string): Promise<void> {
  const now = ctx.now();
  await withPlatformTx(ctx.pool, async (db) => {
    const batch = await findBatch(db, id, { lock: true });
    if (batch === null) throw notFound("付款批次");
    if (batch.status !== "open") return;
    await closeBatch(db, id, principal.user.id, now);
    await insertAuditLog(db, consoleOrigin(platformActor(principal.user), ip, now), { tenantId: null, resource: "payout_batch", resourceId: id, action: "close", before: { status: batch.status }, after: { status: "closed", pay_date: batch.payDate } });
  });
}

// ---- 定时任务 ----

/** 确认期满还是待确认的：系统视为确认（每张一个事务，锁住再判断）。 */
export async function autoConfirmStatements(ctx: AppContext, limit: number): Promise<number> {
  const now = ctx.now();
  const due = await withPlatformTx(ctx.pool, (db) => listAutoConfirmDue(db, now, limit));
  let confirmed = 0;
  for (const entry of due) {
    const done = await withPlatformTx(ctx.pool, async (db) => {
      const statement = await findStatement(db, entry.id, { tenantId: entry.tenantId, lock: true });
      if (statement === null || statement.status !== "issued" || statement.confirmDueAt.getTime() > now.getTime()) return false;
      await updateStatement(db, statement.tenantId, statement.id, { status: "confirmed", confirmed_at: now, confirmed_by_type: "system", confirmed_by: null }, now);
      await insertStatementEvent(db, statement.tenantId, statement.id, { action: "auto_confirm", actorType: "system", actorId: null, note: null, data: { confirm_due_at: statement.confirmDueAt.toISOString() }, at: now });
      await insertAuditLog(db, SYSTEM_ORIGIN(now), { tenantId: null, resource: "statement", resourceId: statement.id, action: "confirm", before: { status: "issued" }, after: { status: "confirmed", by: "system" } });
      return true;
    });
    if (done) confirmed += 1;
  }
  return confirmed;
}

export interface BillingTickResult {
  period: string;
  issued: number;
  failed: number;
  autoConfirmed: number;
}

const FIRST_TICK_MS = 15_000;
const TICK_INTERVAL_MS = 60 * 60_000;
const STOP_WAIT_MS = 3_000;
const AUTO_CONFIRM_BATCH = 200;

export interface BillingJobLog {
  info(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

/**
 * 账单的定时任务（和订单、供应商的定时任务一样跑在 API 进程里，ADR 0022「定时任务和多实例」）：启动后 15 秒第一次，之后每小时一轮。
 * 每一轮：给上个月（东京日期）出账（已经出过的不重复）；确认期满的视为确认。
 * 只有服务进程（`buildApp({ jobs: true })`）启动它；测试直接调 `tick()`。
 */
export class BillingJobs {
  private readonly ctx: AppContext;
  private readonly log: BillingJobLog;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private ticking: Promise<unknown> | null = null;
  private stopped = true;

  constructor(ctx: AppContext, log: BillingJobLog) {
    this.ctx = ctx;
    this.log = log;
  }

  async tick(): Promise<BillingTickResult> {
    const now = this.ctx.now();
    const generated = await generateStatements(this.ctx, periodToGenerate(now), systemActor(now), this.log);
    if (generated.created.length > 0) this.log.info({ event: "statement.issued", period: generated.period, count: generated.created.length }, `已出 ${generated.period} 的供应商账单 ${generated.created.length} 张`);
    const autoConfirmed = await autoConfirmStatements(this.ctx, AUTO_CONFIRM_BATCH);
    return { period: generated.period, issued: generated.created.length, failed: generated.failed.length, autoConfirmed };
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule(FIRST_TICK_MS);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (this.ticking !== null) await Promise.race([this.ticking, new Promise((resolve) => setTimeout(resolve, STOP_WAIT_MS).unref())]);
  }

  private schedule(delay: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.ticking = this.tick()
        .catch((err: unknown) => this.log.error({ err }, "账单定时任务这一轮失败"))
        .finally(() => {
          this.ticking = null;
          this.schedule(TICK_INTERVAL_MS);
        });
    }, delay);
    this.timer.unref();
  }
}
