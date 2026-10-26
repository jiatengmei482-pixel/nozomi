/**
 * 供应商应付账单与付款批次的接口（M5-01，ADR 0040）。这里只做鉴权、校验、调用、返回；规则在 @nozomi/domain 的 billing.ts，流程在 services/billing.ts。
 *
 * 供应商（`/tenant/v1`，租户编号只来自令牌；别的供应商的账单当作不存在）：
 * - `GET /tenant/v1/statements`、`GET …/{id}`：自己的账单、明细、经过（`statement.read`：管理员、财务、只读）；
 * - `POST …/{id}/confirm`、`POST …/{id}/dispute`：确认、提异议（`statement.confirm`：管理员、财务）。
 *   应答里只有结算价一侧的金额（结算价、供应商应得、加收报的金额、应扣款项），没有对外价和加价比例（规则 4）。
 * 运营后台（`/platform/v1`，`statement.read` / `statement.manage` / `statement.review`）：
 * - `GET /platform/v1/statements`、`GET …/{id}`；`POST …/generate`（手动出账）、`POST …/{id}/reply`（答复异议）、`POST …/{id}/void`（作废重出）、
 *   `POST …/{id}/payout-approval`（发起付款复核，批准走 `/platform/v1/approvals/{id}/approve`）；
 * - `GET /platform/v1/payout-batches`、`GET …/{id}`、`POST …/{id}/close`（锁定，等银行转账；转账文件和流水号回填在 M5-02）。
 * 数据范围（ADR 0030）：一张账单里有一家供应商在各个城市、各个渠道的订单，切不开——限定了任一维度的人一律 403 `DATA_SCOPE_DENIED`。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { BILLING_RULES, PAYOUT_BATCH_STATUSES, type PlatformAction, STATEMENT_STATUSES, type CurrencyCode, isBillingPeriod, payoutTotals, scopeIsRestricted, statementSummary } from "@nozomi/domain";
import { bearerToken } from "../auth/token.ts";
import type { AppContext } from "../context.ts";
import { decodeTimeCursor } from "../pagination.ts";
import type { PayoutBatch, Statement } from "../repos/billing.ts";
import {
  type StatementView,
  closeBatchForPlatform,
  confirmByTenant,
  disputeByTenant,
  generateForPlatform,
  getBatchForPlatform,
  getStatementForPlatform,
  getStatementForTenant,
  listBatchesForPlatform,
  listStatementsForPlatform,
  listStatementsForTenant,
  replyToDispute,
  requestPayoutReview,
  voidStatement,
} from "../services/billing.ts";
import { dataScopeDenied } from "../services/errors.ts";
import { type PlatformPrincipal, authenticatePlatform, platformCredentials } from "../services/platform-auth.ts";
import { salesMoney } from "../services/sales-quotes.ts";
import { authenticateTenant } from "../services/tenant-auth.ts";
import { pageQuerySchema, parseInput, resourceId, uuidSchema } from "../validation.ts";
import { approvalJson } from "./channels.ts";

type Json = Record<string, unknown>;

const iso = (date: Date | null): string | null => date?.toISOString() ?? null;
const periodSchema = z.string().refine(isBillingPeriod, "账单周期的格式是 YYYY-MM");
const requiredNote = z.string().trim().min(1).max(BILLING_RULES.noteMaxLength);
const optionalNote = z.string().trim().max(BILLING_RULES.noteMaxLength).nullable().default(null).transform((value) => (value === "" ? null : value));

const tenantListSchema = z.object({ period: periodSchema.optional(), status: z.enum(STATEMENT_STATUSES).optional() }).strict();
const platformListSchema = pageQuerySchema.extend({
  tenant_id: uuidSchema.transform((value) => value.toLowerCase()).optional(),
  period: periodSchema.optional(),
  status: z.enum(STATEMENT_STATUSES).optional(),
  payout_batch_id: uuidSchema.transform((value) => value.toLowerCase()).optional(),
});
const generateSchema = z.object({ period: periodSchema.nullable().default(null) }).strict();
const disputeSchema = z.object({ reason: requiredNote }).strict();
const replySchema = z.object({ note: requiredNote }).strict();
const voidSchema = z.object({ reason: requiredNote }).strict();
const approvalSchema = z.object({ note: optionalNote }).strict();
const batchListSchema = z.object({ status: z.enum(PAYOUT_BATCH_STATUSES).optional() }).strict();

/** 账单的公共部分（供应商和运营后台都有）：金额都是结算币种，有正有负。 */
function statementBase(statement: Statement): Json {
  const money = (minor: number): Json => salesMoney(minor, statement.currency);
  return {
    id: statement.id,
    statement_no: statement.statementNo,
    period: statement.period,
    currency: statement.currency,
    status: statement.status,
    total: money(statement.totalMinor),
    line_count: statement.lineCount,
    pay_due_on: statement.payDueOn,
    payout_on: statement.payoutOn,
    issued_at: statement.issuedAt.toISOString(),
    confirm_due_at: statement.confirmDueAt.toISOString(),
    confirmed_at: iso(statement.confirmedAt),
    confirmed_by_type: statement.confirmedByType,
    disputed_at: iso(statement.disputedAt),
    dispute_reason: statement.disputeReason,
    approved_at: iso(statement.approvedAt),
    paid_at: iso(statement.paidAt),
    voided_at: iso(statement.voidedAt),
    void_reason: statement.voidReason,
    version: statement.version,
  };
}

/** 平台内部的说明（发起付款复核时财务写的）：供应商只看到「已提交复核」这一步，不带说明。 */
const INTERNAL_NOTE_ACTIONS: ReadonlySet<string> = new Set(["request_review", "approve"]);

function viewJson(view: StatementView, platform: boolean): Json {
  const { statement } = view;
  const currency: CurrencyCode = statement.currency;
  const active = view.lines.filter((line) => line.voidedAt === null);
  const summary = statementSummary(active);
  return {
    ...(platform ? platformStatementJson({ ...statement, tenantName: view.tenantName }) : statementBase(statement)),
    ...(platform ? { pending_approval_id: view.pendingApprovalId } : {}),
    summary: Object.entries(summary.byKind)
      .filter(([, entry]) => entry.count > 0)
      .map(([kind, entry]) => ({ kind, count: entry.count, amount: salesMoney(entry.amountMinor, currency) })),
    lines: view.lines.map((line) => ({
      id: line.id,
      kind: line.kind,
      order_id: line.orderId,
      order_no: line.orderNo,
      service_date: line.serviceDate,
      prior_period: line.priorPeriod,
      amount: salesMoney(line.amountMinor, line.currency),
      detail: line.detail,
      voided: line.voidedAt !== null,
    })),
    events: view.events.map((event) => ({ action: event.action, actor_type: event.actorType, ...(platform ? { actor_id: event.actorId } : {}), note: platform || !INTERNAL_NOTE_ACTIONS.has(event.action) ? event.note : null, at: event.at.toISOString() })),
  };
}

function platformStatementJson(statement: Statement & { tenantName: string }): Json {
  return {
    ...statementBase(statement),
    tenant: { id: statement.tenantId, name: statement.tenantName },
    confirmed_by: statement.confirmedBy,
    approval_id: statement.approvalId,
    payout_batch_id: statement.payoutBatchId,
    voided_by: statement.voidedBy,
  };
}

function batchJson(batch: PayoutBatch, totals: { currency: string; count: number; totalMinor: number }[]): Json {
  return {
    id: batch.id,
    pay_date: batch.payDate,
    status: batch.status,
    created_at: batch.createdAt.toISOString(),
    closed_at: iso(batch.closedAt),
    closed_by: batch.closedBy,
    paid_at: iso(batch.paidAt),
    statement_count: totals.reduce((sum, entry) => sum + entry.count, 0),
    totals: totals.map((entry) => ({ currency: entry.currency, count: entry.count, total: salesMoney(entry.totalMinor, entry.currency as CurrencyCode) })),
    version: batch.version,
  };
}

export function registerBillingRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** 运营后台的财务接口：先鉴权，再看数据范围（限定了范围的人不能用）。 */
  const platform = async (request: FastifyRequest, action: PlatformAction): Promise<PlatformPrincipal> => {
    const principal = await authenticatePlatform(ctx, platformCredentials(request), { action });
    if (scopeIsRestricted(principal.grant.scope)) throw dataScopeDenied();
    return principal;
  };

  // ---- 供应商 ----

  app.get("/tenant/v1/statements", async (request) => {
    const principal = await authenticateTenant(ctx, bearerToken(request.headers.authorization), { action: "statement.read" });
    const query = parseInput(tenantListSchema, request.query, "querystring");
    return { items: (await listStatementsForTenant(ctx, principal.tenantId, { period: query.period ?? null, status: query.status ?? null })).map(statementBase) };
  });

  app.get("/tenant/v1/statements/:id", async (request) => {
    const principal = await authenticateTenant(ctx, bearerToken(request.headers.authorization), { action: "statement.read" });
    return { statement: viewJson(await getStatementForTenant(ctx, principal.tenantId, resourceId(request.params, "账单")), false) };
  });

  app.post("/tenant/v1/statements/:id/confirm", async (request) => {
    const principal = await authenticateTenant(ctx, bearerToken(request.headers.authorization), { action: "statement.confirm" });
    return { statement: viewJson(await confirmByTenant(ctx, principal, resourceId(request.params, "账单"), request.ip), false) };
  });

  app.post("/tenant/v1/statements/:id/dispute", async (request) => {
    const principal = await authenticateTenant(ctx, bearerToken(request.headers.authorization), { action: "statement.confirm" });
    const id = resourceId(request.params, "账单");
    const input = parseInput(disputeSchema, request.body, "body");
    return { statement: viewJson(await disputeByTenant(ctx, principal, id, input.reason, request.ip), false) };
  });

  // ---- 运营后台 ----

  app.get("/platform/v1/statements", async (request) => {
    await platform(request, "statement.read");
    const query = parseInput(platformListSchema, request.query, "querystring");
    const page = await listStatementsForPlatform(ctx, { tenantId: query.tenant_id ?? null, period: query.period ?? null, status: query.status ?? null, payoutBatchId: query.payout_batch_id ?? null }, query.limit, decodeTimeCursor(query.cursor ?? null));
    return { items: page.items.map(platformStatementJson), next_cursor: page.nextCursor, total: page.total };
  });

  app.post("/platform/v1/statements/generate", async (request) => {
    const principal = await platform(request, "statement.manage");
    const input = parseInput(generateSchema, request.body ?? {}, "body");
    const result = await generateForPlatform(ctx, principal, input.period, request.ip, request.log);
    return {
      period: result.period,
      created: result.created.map(platformStatementJson),
      failed: result.failed.map((entry) => ({ tenant: { id: entry.tenantId, name: entry.tenantName }, code: entry.code, message: entry.message })),
    };
  });

  app.get("/platform/v1/statements/:id", async (request) => {
    await platform(request, "statement.read");
    return { statement: viewJson(await getStatementForPlatform(ctx, resourceId(request.params, "账单")), true) };
  });

  app.post("/platform/v1/statements/:id/reply", async (request) => {
    const principal = await platform(request, "statement.manage");
    const id = resourceId(request.params, "账单");
    const input = parseInput(replySchema, request.body, "body");
    return { statement: viewJson(await replyToDispute(ctx, principal, id, input.note, request.ip), true) };
  });

  app.post("/platform/v1/statements/:id/void", async (request) => {
    const principal = await platform(request, "statement.manage");
    const id = resourceId(request.params, "账单");
    const input = parseInput(voidSchema, request.body, "body");
    const result = await voidStatement(ctx, principal, id, input.reason, request.ip);
    return { statement: viewJson(result.voided, true), reissued: result.reissued.map(platformStatementJson) };
  });

  app.post("/platform/v1/statements/:id/payout-approval", async (request, reply) => {
    const principal = await platform(request, "statement.manage");
    const id = resourceId(request.params, "账单");
    const input = parseInput(approvalSchema, request.body ?? {}, "body");
    const approval = await requestPayoutReview(ctx, principal, id, input.note, request.ip);
    return reply.code(202).send({ approval: approvalJson(approval, principal) });
  });

  app.get("/platform/v1/payout-batches", async (request) => {
    await platform(request, "statement.read");
    const query = parseInput(batchListSchema, request.query, "querystring");
    return { items: (await listBatchesForPlatform(ctx, query.status ?? null)).map((batch) => batchJson(batch, batch.totals)) };
  });

  app.get("/platform/v1/payout-batches/:id", async (request) => {
    await platform(request, "statement.read");
    const found = await getBatchForPlatform(ctx, resourceId(request.params, "付款批次"));
    const totals = payoutTotalsOf(found.statements);
    return { batch: { ...batchJson(found.batch, totals), statements: found.statements.map(platformStatementJson) } };
  });

  app.post("/platform/v1/payout-batches/:id/close", async (request) => {
    const principal = await platform(request, "statement.manage");
    const id = resourceId(request.params, "付款批次");
    await closeBatchForPlatform(ctx, principal, id, request.ip);
    const found = await getBatchForPlatform(ctx, id);
    return { batch: { ...batchJson(found.batch, payoutTotalsOf(found.statements)), statements: found.statements.map(platformStatementJson) } };
  });
}

function payoutTotalsOf(statements: readonly Statement[]): { currency: string; count: number; totalMinor: number }[] {
  return payoutTotals(statements.map((statement) => ({ currency: statement.currency, totalMinor: statement.totalMinor })));
}
