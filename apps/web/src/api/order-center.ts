/**
 * 订单中心的异常队列、工单、赔付表（M4-02 的接口，ADR 0034；页面在 M4-03），以及同事名单（处理人显示成名字）。
 * 字段与 `apps/api/openapi.yaml` 对齐，由 order-center.contract.test.ts 保证。
 *
 * - 运营后台的工单有客人那边的赔付金额（对外价 × 比例、退款、另付）和内部备注；
 * - 供应商的工单（`/tenant/v1/tickets`）没有这些：没有内部备注、处理人、判定人、客人赔付金额（规则 4）。页面按接口给的显示，不从别处拼。
 */
import type { CompensationScenario, ExceptionStatus, ExceptionType, LiableParty, TicketOutcome, TicketPriority, TicketSource, TicketStatus, TicketType } from "@nozomi/domain";
import { TENANT_BASE, query } from "./areas.ts";
import type { Approval } from "./channels.ts";
import { apiRequest } from "./client.ts";
import type { ListPage, Money } from "./dispatch.ts";
import type { CancellationPolicy } from "./order-money.ts";
import { PLATFORM_BASE } from "./platform.ts";
import type { DeductionBasis } from "./rescues.ts";

export const EXCEPTIONS_PATH = `${PLATFORM_BASE}/exceptions`;
export const PLATFORM_TICKETS_PATH = `${PLATFORM_BASE}/tickets`;
export const TENANT_TICKETS_PATH = `${TENANT_BASE}/tickets`;
export const COMPENSATION_TABLE_PATH = `${PLATFORM_BASE}/compensation-table`;
export const COLLEAGUES_PATH = `${PLATFORM_BASE}/colleagues`;

// ---- 同事名单 ----

export interface Colleague {
  id: string;
  name: string;
  active: boolean;
}

export function listColleagues(token: string): Promise<{ items: Colleague[] }> {
  return apiRequest("GET", COLLEAGUES_PATH, { token });
}

// ---- 异常队列 ----

export interface OrderException {
  id: string;
  type: ExceptionType;
  type_name: string;
  handling: string;
  order: { id: string; order_no: string; service_time: string };
  tenant: { id: string; name: string };
  detail: Record<string, unknown>;
  status: ExceptionStatus;
  opened_at: string;
  due_at: string;
  overdue: boolean;
  assignee: { id: string; name: string | null } | null;
  claimed_at: string | null;
  close_kind: "resolved" | "cleared" | null;
  closed_at: string | null;
  closed_by: string | null;
  resolution: string | null;
  version: number;
}

export interface ExceptionQuery {
  status?: "active" | ExceptionStatus;
  type?: ExceptionType;
  assignee?: string;
  order_id?: string;
  tenant_id?: string;
  overdue?: "true";
  limit?: number;
  cursor?: string;
}

const oneException = (id: string): string => `${EXCEPTIONS_PATH}/${encodeURIComponent(id)}`;

export function listExceptions(token: string, values: ExceptionQuery): Promise<ListPage<OrderException>> {
  return apiRequest("GET", query(EXCEPTIONS_PATH, values), { token });
}

export function getException(token: string, id: string): Promise<{ exception: OrderException }> {
  return apiRequest("GET", oneException(id), { token });
}

/** 认领：不给人就是自己；已经是自己在处理的，可以转给别人。 */
export function claimException(token: string, id: string, assigneeId: string | null): Promise<{ exception: OrderException }> {
  return apiRequest("POST", `${oneException(id)}/claim`, { token, body: { assignee_id: assigneeId } });
}

export function closeException(token: string, id: string, resolution: string): Promise<{ exception: OrderException }> {
  return apiRequest("POST", `${oneException(id)}/close`, { token, body: { resolution } });
}

// ---- 赔付表 ----

export interface CompensationScenarioRow {
  scenario: CompensationScenario;
  name: string;
  customer_bp: number;
  full_refund: boolean;
  reimbursement: boolean;
  downgrade_difference: boolean;
}

export interface CompensationTableView {
  version: number;
  effective_at: string | null;
  scenarios: CompensationScenarioRow[];
  minimum_jpy: number;
  reimbursement_cap_bp: number;
  review_at_or_above_sell_bp: number;
}

export interface CompensationTableChange {
  customer_bp: Record<CompensationScenario, number>;
  minimum_jpy: number;
  reimbursement_cap_bp: number;
  review_at_or_above_sell_bp: number;
  note: string | null;
}

export function getCompensationTable(token: string): Promise<{ compensation_table: CompensationTableView; cancellation_policy: CancellationPolicy }> {
  return apiRequest("GET", COMPENSATION_TABLE_PATH, { token });
}

export function requestCompensationTableChange(token: string, body: CompensationTableChange): Promise<{ approval: Approval }> {
  return apiRequest("POST", `${COMPENSATION_TABLE_PATH}/changes`, { token, body });
}

// ---- 工单（运营后台） ----

export type TicketAuthorType = "platform_user" | "tenant_user" | "channel" | "guest" | "system";

export interface PlatformTicket {
  id: string;
  ticket_no: string;
  type: TicketType;
  source: TicketSource;
  created_by_type: TicketAuthorType;
  created_by: string | null;
  order: { id: string; order_no: string };
  tenant: { id: string; name: string };
  parent_ticket_id: string | null;
  priority: TicketPriority;
  subject: string;
  description: string;
  language: string | null;
  status: TicketStatus;
  assignee_id: string | null;
  assigned_at: string | null;
  first_response_due_at: string;
  first_responded_at: string | null;
  resolution_due_at: string;
  overdue: boolean;
  tenant_reply_requested_at: string | null;
  tenant_reply_due_at: string | null;
  tenant_replied_at: string | null;
  outcome: TicketOutcome | null;
  liable_party: LiableParty | null;
  decision_note: string | null;
  decided_at: string | null;
  decided_by: string | null;
  approval_id: string | null;
  appeal_until: string | null;
  closed_at: string | null;
  closed_by: string | null;
  close_note: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface TicketMessage {
  id: string;
  author_type: TicketAuthorType;
  author_id: string | null;
  body: string;
  file_ids: string[];
  created_at: string;
}

export interface TicketNote {
  id: string;
  author: { id: string; name: string };
  body: string;
  created_at: string;
}

/** 工单记下的供应商应扣款项（结算币种） */
export interface TicketDeduction {
  id: string;
  kind: "penalty" | "rescue_difference" | "compensation" | "reimbursement";
  amount: Money;
  status: "pending" | "waived";
  basis: DeductionBasis;
  waived_at: string | null;
  waive_reason: string | null;
  created_at: string;
}

export interface TicketCompensation {
  scenario: CompensationScenario;
  scenario_name: string;
  liable_party: LiableParty;
  table_version: number;
  customer_bp: number;
  sell: Money;
  ratio_amount: Money;
  downgrade_difference: Money;
  minimum: Money;
  minimum_fx: Record<string, unknown> | null;
  topped_up: boolean;
  compensation: Money;
  reimbursement_claimed: Money;
  reimbursement_cap: Money;
  reimbursement: Money;
  refund: Money;
  manual_payout: Money;
  order_cancelled: boolean;
  payout_status: "none" | "pending" | "paid";
  payout_reference: string | null;
  paid_at: string | null;
  paid_by: string | null;
  tenant_total: Money;
  created_at: string;
}

export interface TicketAppealRef {
  id: string;
  ticket_no: string;
  status: TicketStatus;
  outcome: string | null;
}

export interface PlatformTicketDetail {
  ticket: PlatformTicket;
  messages: TicketMessage[];
  notes: TicketNote[];
  compensation: TicketCompensation | null;
  deductions: TicketDeduction[];
  refund_ids: string[];
  parent: { id: string; ticket_no: string; type: TicketType; outcome: string | null; decided_by: string | null } | null;
  appeal: TicketAppealRef | null;
  approval: Approval | null;
}

export interface CompensationInput {
  scenario: CompensationScenario;
  liable_party: LiableParty;
  /** 车型降级：两个车型组的结算价之差（被投诉供应商结算币种的最小单位） */
  downgrade_settlement_difference: number | null;
  /** 司机未到：客人凭票申请报销的替代交通（客人支付币种的最小单位） */
  reimbursement_amount: number | null;
  major: boolean;
}

export interface CompensationQuote {
  scenario: CompensationScenario;
  scenario_name: string;
  liable_party: LiableParty;
  table_version: number;
  customer_bp: number;
  customer: { ratio_amount: Money; downgrade_difference: Money; minimum: Money; topped_up: boolean; compensation: Money; reimbursement_cap: Money; reimbursement: Money; refund: Money; manual_payout: Money };
  tenant: { ratio_amount: Money; downgrade_difference: Money; reimbursement: Money; total: Money };
  order_will_be_cancelled: boolean;
  needs_review: boolean;
}

export interface PlatformTicketQuery {
  status?: "active" | TicketStatus;
  type?: TicketType;
  tenant_id?: string;
  order_id?: string;
  assignee?: string;
  overdue?: "true";
  q?: string;
  limit?: number;
  cursor?: string;
}

export interface PlatformTicketCreate {
  type: "complaint" | "fulfilment_failure" | "order_change" | "lost_and_found" | "other";
  order_id: string;
  tenant_id: string | null;
  source: "guest" | "channel" | "tenant" | "platform";
  priority: TicketPriority | null;
  subject: string;
  description: string;
  language: string | null;
}

export interface TicketDecision {
  outcome: TicketOutcome;
  note: string;
  compensation: CompensationInput | null;
  driver_absent: boolean;
}

const platformTicket = (id: string): string => `${PLATFORM_TICKETS_PATH}/${encodeURIComponent(id)}`;

export function listPlatformTickets(token: string, values: PlatformTicketQuery): Promise<ListPage<PlatformTicket>> {
  return apiRequest("GET", query(PLATFORM_TICKETS_PATH, values), { token });
}

export function getPlatformTicket(token: string, id: string): Promise<PlatformTicketDetail> {
  return apiRequest("GET", platformTicket(id), { token });
}

export function createPlatformTicket(token: string, body: PlatformTicketCreate): Promise<PlatformTicketDetail> {
  return apiRequest("POST", PLATFORM_TICKETS_PATH, { token, body });
}

export function assignTicket(token: string, id: string, assigneeId: string | null): Promise<PlatformTicketDetail> {
  return apiRequest("POST", `${platformTicket(id)}/assign`, { token, body: { assignee_id: assigneeId } });
}

/** 留言：`internal` 为真是内部备注（只有平台看得到），否则是给供应商看的对话。 */
export function addTicketMessage(token: string, id: string, body: string, internal: boolean): Promise<PlatformTicketDetail> {
  return apiRequest("POST", `${platformTicket(id)}/messages`, { token, body: { body, internal } });
}

export function requestTenantReply(token: string, id: string, body: string): Promise<PlatformTicketDetail> {
  return apiRequest("POST", `${platformTicket(id)}/request-reply`, { token, body: { body } });
}

export function quoteCompensation(token: string, id: string, body: CompensationInput): Promise<{ quote: CompensationQuote }> {
  return apiRequest("POST", `${platformTicket(id)}/compensation-quote`, { token, body });
}

/** 判定。赔给客人的钱达到复核阈值时后端返回 202，工单变成「判定待复核」，`approval` 是待审核的复核。 */
export function decideTicket(token: string, id: string, body: TicketDecision): Promise<PlatformTicketDetail> {
  return apiRequest("POST", `${platformTicket(id)}/decide`, { token, body });
}

export function closeTicket(token: string, id: string, note: string): Promise<PlatformTicketDetail> {
  return apiRequest("POST", `${platformTicket(id)}/close`, { token, body: { note } });
}

/** 财务登记另付（报销等退不回卡上的钱）已经付了：银行转账的凭证号。 */
export function markTicketPayout(token: string, id: string, reference: string): Promise<PlatformTicketDetail> {
  return apiRequest("POST", `${platformTicket(id)}/payout`, { token, body: { reference } });
}

// ---- 工单（供应商） ----

export interface TenantTicket {
  id: string;
  ticket_no: string;
  type: TicketType;
  source: TicketSource;
  order: { id: string; order_no: string };
  parent_ticket_id: string | null;
  priority: TicketPriority;
  subject: string;
  description: string;
  status: TicketStatus;
  tenant_reply_requested_at: string | null;
  tenant_reply_due_at: string | null;
  tenant_replied_at: string | null;
  outcome: TicketOutcome | null;
  liable_party: LiableParty | null;
  decision_note: string | null;
  decided_at: string | null;
  appeal_until: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TenantTicketDetail {
  ticket: TenantTicket;
  messages: TicketMessage[];
  deductions: TicketDeduction[];
  appeal: TicketAppealRef | null;
}

export interface TenantTicketCreate {
  type: "tenant_appeal" | "lost_and_found" | "other";
  order_id: string | null;
  parent_ticket_id: string | null;
  subject: string;
  description: string;
}

const tenantTicket = (id: string): string => `${TENANT_TICKETS_PATH}/${encodeURIComponent(id)}`;

export function listTenantTickets(token: string, values: { status?: "active" | TicketStatus; order_id?: string; limit?: number; cursor?: string }): Promise<ListPage<TenantTicket>> {
  return apiRequest("GET", query(TENANT_TICKETS_PATH, values), { token });
}

export function getTenantTicket(token: string, id: string): Promise<TenantTicketDetail> {
  return apiRequest("GET", tenantTicket(id), { token });
}

export function createTenantTicket(token: string, body: TenantTicketCreate): Promise<TenantTicketDetail> {
  return apiRequest("POST", TENANT_TICKETS_PATH, { token, body });
}

export function replyTenantTicket(token: string, id: string, body: string): Promise<TenantTicketDetail> {
  return apiRequest("POST", `${tenantTicket(id)}/messages`, { token, body: { body, file_ids: [] } });
}

/** 合同测试用：前端读的字段（必须和 openapi.yaml 里这几个结构的字段一模一样）。 */
export const ORDER_CENTER_SCHEMA_FIELDS = {
  OrderException: ["id", "type", "type_name", "handling", "order", "tenant", "detail", "status", "opened_at", "due_at", "overdue", "assignee", "claimed_at", "close_kind", "closed_at", "closed_by", "resolution", "version"],
  CompensationTable: ["version", "effective_at", "scenarios", "minimum_jpy", "reimbursement_cap_bp", "review_at_or_above_sell_bp"],
  CompensationQuote: ["scenario", "scenario_name", "liable_party", "table_version", "customer_bp", "customer", "tenant", "order_will_be_cancelled", "needs_review"],
  TicketCompensation: ["scenario", "scenario_name", "liable_party", "table_version", "customer_bp", "sell", "ratio_amount", "downgrade_difference", "minimum", "minimum_fx", "topped_up", "compensation", "reimbursement_claimed", "reimbursement_cap", "reimbursement", "refund", "manual_payout", "order_cancelled", "payout_status", "payout_reference", "paid_at", "paid_by", "tenant_total", "created_at"],
  PlatformTicket: ["id", "ticket_no", "type", "source", "created_by_type", "created_by", "order", "tenant", "parent_ticket_id", "priority", "subject", "description", "language", "status", "assignee_id", "assigned_at", "first_response_due_at", "first_responded_at", "resolution_due_at", "overdue", "tenant_reply_requested_at", "tenant_reply_due_at", "tenant_replied_at", "outcome", "liable_party", "decision_note", "decided_at", "decided_by", "approval_id", "appeal_until", "closed_at", "closed_by", "close_note", "version", "created_at", "updated_at"],
  TenantTicket: ["id", "ticket_no", "type", "source", "order", "parent_ticket_id", "priority", "subject", "description", "status", "tenant_reply_requested_at", "tenant_reply_due_at", "tenant_replied_at", "outcome", "liable_party", "decision_note", "decided_at", "appeal_until", "closed_at", "created_at", "updated_at"],
  TicketMessage: ["id", "author_type", "author_id", "body", "file_ids", "created_at"],
  TicketDeduction: ["id", "kind", "amount", "status", "basis", "waived_at", "waive_reason", "created_at"],
} as const satisfies {
  OrderException: readonly (keyof OrderException)[];
  CompensationTable: readonly (keyof CompensationTableView)[];
  CompensationQuote: readonly (keyof CompensationQuote)[];
  TicketCompensation: readonly (keyof TicketCompensation)[];
  PlatformTicket: readonly (keyof PlatformTicket)[];
  TenantTicket: readonly (keyof TenantTicket)[];
  TicketMessage: readonly (keyof TicketMessage)[];
  TicketDeduction: readonly (keyof TicketDeduction)[];
};

/** 工单详情的顶层字段：运营后台、供应商各一份。 */
export const TICKET_DETAIL_FIELDS = {
  PlatformTicketDetail: ["ticket", "messages", "notes", "compensation", "deductions", "refund_ids", "parent", "appeal", "approval"],
  TenantTicketDetail: ["ticket", "messages", "deductions", "appeal"],
} as const satisfies { PlatformTicketDetail: readonly (keyof PlatformTicketDetail)[]; TenantTicketDetail: readonly (keyof TenantTicketDetail)[] };

// ---- 首页的数量（用列表接口的 total） ----

/** 运营后台首页「异常队列」卡片：没关的、其中已超时的。 */
export async function countExceptions(token: string): Promise<{ active: number; overdue: number }> {
  const [active, overdue] = await Promise.all([listExceptions(token, { status: "active", limit: 1 }), listExceptions(token, { status: "active", overdue: "true", limit: 1 })]);
  return { active: active.total, overdue: overdue.total };
}

/** 运营后台首页「工单」卡片：没有结论的、其中已超时的、判定待复核的。 */
export async function countPlatformTickets(token: string): Promise<{ active: number; overdue: number }> {
  const [active, overdue] = await Promise.all([listPlatformTickets(token, { status: "active", limit: 1 }), listPlatformTickets(token, { status: "active", overdue: "true", limit: 1 })]);
  return { active: active.total, overdue: overdue.total };
}

/** 供应商后台首页「工单」卡片：没有结论的、其中等你们回复的。 */
export async function countTenantTickets(token: string): Promise<{ active: number; awaiting: number }> {
  const [active, awaiting] = await Promise.all([listTenantTickets(token, { status: "active", limit: 1 }), listTenantTickets(token, { status: "awaiting_tenant", limit: 1 })]);
  return { active: active.total, awaiting: awaiting.total };
}
