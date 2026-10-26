/**
 * 供应商应付账单与付款批次（M5-01 的接口，ADR 0040；页面在 M4-03）。字段与 `apps/api/openapi.yaml` 对齐，由 billing.contract.test.ts 保证。
 *
 * - 金额都是供应商的结算币种，有正有负（`amount` 是带符号的十进制字符串）；
 * - 供应商的账单（`/tenant/v1/statements`）没有对外价、加价比例，也没有平台员工的编号和付款复核的说明（规则 4）。
 */
import type { PayoutBatchStatus, StatementLineKind, StatementStatus } from "@nozomi/domain";
import { TENANT_BASE, query } from "./areas.ts";
import type { Approval } from "./channels.ts";
import { apiRequest } from "./client.ts";
import type { ListPage, Money } from "./dispatch.ts";
import { PLATFORM_BASE } from "./platform.ts";

export const PLATFORM_STATEMENTS_PATH = `${PLATFORM_BASE}/statements`;
export const PAYOUT_BATCHES_PATH = `${PLATFORM_BASE}/payout-batches`;
export const TENANT_STATEMENTS_PATH = `${TENANT_BASE}/statements`;

export type StatementEventAction = "issue" | "confirm" | "auto_confirm" | "dispute" | "reply" | "void" | "request_review" | "approve" | "pay";

export interface TenantStatement {
  id: string;
  statement_no: string;
  period: string;
  currency: string;
  status: StatementStatus;
  total: Money;
  line_count: number;
  pay_due_on: string;
  payout_on: string | null;
  issued_at: string;
  confirm_due_at: string;
  confirmed_at: string | null;
  confirmed_by_type: "tenant_user" | "system" | null;
  disputed_at: string | null;
  dispute_reason: string | null;
  approved_at: string | null;
  paid_at: string | null;
  voided_at: string | null;
  void_reason: string | null;
  version: number;
}

export interface PlatformStatement extends TenantStatement {
  tenant: { id: string; name: string };
  confirmed_by: string | null;
  approval_id: string | null;
  payout_batch_id: string | null;
  voided_by: string | null;
}

export interface StatementLine {
  id: string;
  kind: StatementLineKind;
  order_id: string | null;
  order_no: string | null;
  service_date: string | null;
  prior_period: boolean;
  amount: Money;
  detail: Record<string, unknown>;
  voided: boolean;
}

export interface StatementSummaryEntry {
  kind: StatementLineKind;
  count: number;
  amount: Money;
}

export interface TenantStatementEvent {
  action: StatementEventAction;
  actor_type: "tenant_user" | "platform_user" | "system";
  note: string | null;
  at: string;
}

export interface PlatformStatementEvent extends TenantStatementEvent {
  actor_id: string | null;
}

export interface TenantStatementDetail extends TenantStatement {
  summary: StatementSummaryEntry[];
  lines: StatementLine[];
  events: TenantStatementEvent[];
}

export interface PlatformStatementDetail extends PlatformStatement {
  pending_approval_id: string | null;
  summary: StatementSummaryEntry[];
  lines: StatementLine[];
  events: PlatformStatementEvent[];
}

export interface PayoutBatch {
  id: string;
  pay_date: string;
  status: PayoutBatchStatus;
  created_at: string;
  closed_at: string | null;
  closed_by: string | null;
  paid_at: string | null;
  statement_count: number;
  totals: { currency: string; count: number; total: Money }[];
  version: number;
}

export interface PayoutBatchDetail extends PayoutBatch {
  statements: PlatformStatement[];
}

export interface GenerateResult {
  period: string;
  created: PlatformStatement[];
  failed: { tenant: { id: string; name: string }; code: string; message: string }[];
}

// ---- 运营后台 ----

export interface PlatformStatementQuery {
  tenant_id?: string;
  period?: string;
  status?: StatementStatus;
  payout_batch_id?: string;
  limit?: number;
  cursor?: string;
}

const platformStatement = (id: string): string => `${PLATFORM_STATEMENTS_PATH}/${encodeURIComponent(id)}`;

export function listPlatformStatements(token: string, values: PlatformStatementQuery): Promise<ListPage<PlatformStatement>> {
  return apiRequest("GET", query(PLATFORM_STATEMENTS_PATH, values), { token });
}

export function getPlatformStatement(token: string, id: string): Promise<{ statement: PlatformStatementDetail }> {
  return apiRequest("GET", platformStatement(id), { token });
}

/** 手工出账：不给周期就是现在该出的那一期（上个月）。 */
export function generateStatements(token: string, period: string | null): Promise<GenerateResult> {
  return apiRequest("POST", `${PLATFORM_STATEMENTS_PATH}/generate`, { token, body: { period } });
}

export function replyToDispute(token: string, id: string, note: string): Promise<{ statement: PlatformStatementDetail }> {
  return apiRequest("POST", `${platformStatement(id)}/reply`, { token, body: { note } });
}

export function voidStatement(token: string, id: string, reason: string): Promise<{ statement: PlatformStatementDetail; reissued: PlatformStatement[] }> {
  return apiRequest("POST", `${platformStatement(id)}/void`, { token, body: { reason } });
}

/** 发起付款复核（202）：另一位有审核权限的财务在「待审核」里批准。 */
export function requestPayoutApproval(token: string, id: string, note: string | null): Promise<{ approval: Approval }> {
  return apiRequest("POST", `${platformStatement(id)}/payout-approval`, { token, body: { note } });
}

export function listPayoutBatches(token: string, status?: PayoutBatchStatus): Promise<{ items: PayoutBatch[] }> {
  return apiRequest("GET", query(PAYOUT_BATCHES_PATH, { status }), { token });
}

export function getPayoutBatch(token: string, id: string): Promise<{ batch: PayoutBatchDetail }> {
  return apiRequest("GET", `${PAYOUT_BATCHES_PATH}/${encodeURIComponent(id)}`, { token });
}

export function closePayoutBatch(token: string, id: string): Promise<{ batch: PayoutBatchDetail }> {
  return apiRequest("POST", `${PAYOUT_BATCHES_PATH}/${encodeURIComponent(id)}/close`, { token });
}

// ---- 供应商 ----

const tenantStatement = (id: string): string => `${TENANT_STATEMENTS_PATH}/${encodeURIComponent(id)}`;

export function listTenantStatements(token: string, values: { period?: string; status?: StatementStatus } = {}): Promise<{ items: TenantStatement[] }> {
  return apiRequest("GET", query(TENANT_STATEMENTS_PATH, values), { token });
}

export function getTenantStatement(token: string, id: string): Promise<{ statement: TenantStatementDetail }> {
  return apiRequest("GET", tenantStatement(id), { token });
}

export function confirmStatement(token: string, id: string): Promise<{ statement: TenantStatementDetail }> {
  return apiRequest("POST", `${tenantStatement(id)}/confirm`, { token });
}

export function disputeStatement(token: string, id: string, reason: string): Promise<{ statement: TenantStatementDetail }> {
  return apiRequest("POST", `${tenantStatement(id)}/dispute`, { token, body: { reason } });
}

/** 合同测试用：前端读的字段（必须和 openapi.yaml 里这几个结构的字段一模一样）。 */
export const BILLING_SCHEMA_FIELDS = {
  TenantStatement: ["id", "statement_no", "period", "currency", "status", "total", "line_count", "pay_due_on", "payout_on", "issued_at", "confirm_due_at", "confirmed_at", "confirmed_by_type", "disputed_at", "dispute_reason", "approved_at", "paid_at", "voided_at", "void_reason", "version"],
  PlatformStatement: ["id", "statement_no", "period", "currency", "status", "total", "line_count", "pay_due_on", "payout_on", "issued_at", "confirm_due_at", "confirmed_at", "confirmed_by_type", "disputed_at", "dispute_reason", "approved_at", "paid_at", "voided_at", "void_reason", "version", "tenant", "confirmed_by", "approval_id", "payout_batch_id", "voided_by"],
  StatementLine: ["id", "kind", "order_id", "order_no", "service_date", "prior_period", "amount", "detail", "voided"],
  StatementSummaryEntry: ["kind", "count", "amount"],
  TenantStatementEvent: ["action", "actor_type", "note", "at"],
  PlatformStatementEvent: ["action", "actor_type", "actor_id", "note", "at"],
  TenantStatementDetail: ["id", "statement_no", "period", "currency", "status", "total", "line_count", "pay_due_on", "payout_on", "issued_at", "confirm_due_at", "confirmed_at", "confirmed_by_type", "disputed_at", "dispute_reason", "approved_at", "paid_at", "voided_at", "void_reason", "version", "summary", "lines", "events"],
  PlatformStatementDetail: ["id", "statement_no", "period", "currency", "status", "total", "line_count", "pay_due_on", "payout_on", "issued_at", "confirm_due_at", "confirmed_at", "confirmed_by_type", "disputed_at", "dispute_reason", "approved_at", "paid_at", "voided_at", "void_reason", "version", "tenant", "confirmed_by", "approval_id", "payout_batch_id", "voided_by", "pending_approval_id", "summary", "lines", "events"],
  PayoutBatch: ["id", "pay_date", "status", "created_at", "closed_at", "closed_by", "paid_at", "statement_count", "totals", "version"],
  PayoutBatchDetail: ["id", "pay_date", "status", "created_at", "closed_at", "closed_by", "paid_at", "statement_count", "totals", "version", "statements"],
} as const satisfies {
  TenantStatement: readonly (keyof TenantStatement)[];
  PlatformStatement: readonly (keyof PlatformStatement)[];
  StatementLine: readonly (keyof StatementLine)[];
  StatementSummaryEntry: readonly (keyof StatementSummaryEntry)[];
  TenantStatementEvent: readonly (keyof TenantStatementEvent)[];
  PlatformStatementEvent: readonly (keyof PlatformStatementEvent)[];
  TenantStatementDetail: readonly (keyof TenantStatementDetail)[];
  PlatformStatementDetail: readonly (keyof PlatformStatementDetail)[];
  PayoutBatch: readonly (keyof PayoutBatch)[];
  PayoutBatchDetail: readonly (keyof PayoutBatchDetail)[];
};

/** 运营后台首页「账单」卡片：待确认、有异议、待复核（已确认、等发起付款复核）的张数。 */
export async function countPlatformStatements(token: string): Promise<{ issued: number; disputed: number; confirmed: number }> {
  const [issued, disputed, confirmed] = await Promise.all((["issued", "disputed", "confirmed"] as const).map((status) => listPlatformStatements(token, { status, limit: 1 })));
  return { issued: issued?.total ?? 0, disputed: disputed?.total ?? 0, confirmed: confirmed?.total ?? 0 };
}
