/**
 * 工单的数据访问（M4-02，ADR 0034）。
 *
 * - `tickets`、`ticket_messages` 是租户表：和哪个供应商有关就带它的 tenant_id；供应商在租户事务里只读自己的（行级安全）。
 *   客服建工单、留言、判定，渠道和客人建工单，供应商回复和申诉，都在平台事务里写（供应商的写入带着令牌里的租户编号）。
 * - `ticket_notes`（内部备注）、`ticket_compensations`（客人那边的赔付金额）是平台表：租户角色没有任何权限（规则 4）。
 */
import { randomInt } from "node:crypto";
import { type CompensationScenario, type CurrencyCode, type LiableParty, ORDER_NO_ALPHABET, type TicketOutcome, type TicketPriority, type TicketSource, type TicketStatus, type TicketType, ticketNumber } from "@nozomi/domain";
import type { Db } from "../db/context.ts";
import { type Page, type TimeCursor, toPage } from "../pagination.ts";

type Row = Record<string, any>;

export type TicketCreatorType = "platform_user" | "tenant_user" | "channel" | "guest" | "system";

export interface Ticket {
  tenantId: string;
  id: string;
  ticketNo: string;
  type: TicketType;
  source: TicketSource;
  createdByType: TicketCreatorType;
  createdBy: string | null;
  orderId: string;
  parentTicketId: string | null;
  priority: TicketPriority;
  subject: string;
  description: string;
  language: string | null;
  status: TicketStatus;
  assigneeId: string | null;
  assignedAt: Date | null;
  firstResponseDueAt: Date;
  firstRespondedAt: Date | null;
  resolutionDueAt: Date;
  tenantReplyRequestedAt: Date | null;
  tenantReplyDueAt: Date | null;
  tenantRepliedAt: Date | null;
  outcome: TicketOutcome | null;
  liableParty: LiableParty | null;
  decisionNote: string | null;
  decidedAt: Date | null;
  decidedBy: string | null;
  approvalId: string | null;
  /** 判定时记下的履约事件：`complaint`、`failure:<类型>`（申诉成立时只撤销这几条） */
  recordedEvents: string[];
  closedAt: Date | null;
  closedBy: string | null;
  closeNote: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const COLUMNS =
  "t.tenant_id, t.id, t.ticket_no, t.type, t.source, t.created_by_type, t.created_by, t.order_id, t.parent_ticket_id, t.priority, t.subject, t.description, t.language, t.status, t.assignee_id, t.assigned_at, " +
  "t.first_response_due_at, t.first_responded_at, t.resolution_due_at, t.tenant_reply_requested_at, t.tenant_reply_due_at, t.tenant_replied_at, t.outcome, t.liable_party, t.decision_note, t.decided_at, t.decided_by, " +
  "t.approval_id, t.recorded_events, t.closed_at, t.closed_by, t.close_note, t.version, t.created_at, t.updated_at";

function toTicket(row: Row): Ticket {
  return {
    tenantId: row["tenant_id"],
    id: row["id"],
    ticketNo: row["ticket_no"],
    type: row["type"],
    source: row["source"],
    createdByType: row["created_by_type"],
    createdBy: row["created_by"],
    orderId: row["order_id"],
    parentTicketId: row["parent_ticket_id"],
    priority: row["priority"],
    subject: row["subject"],
    description: row["description"],
    language: row["language"],
    status: row["status"],
    assigneeId: row["assignee_id"],
    assignedAt: row["assigned_at"],
    firstResponseDueAt: row["first_response_due_at"],
    firstRespondedAt: row["first_responded_at"],
    resolutionDueAt: row["resolution_due_at"],
    tenantReplyRequestedAt: row["tenant_reply_requested_at"],
    tenantReplyDueAt: row["tenant_reply_due_at"],
    tenantRepliedAt: row["tenant_replied_at"],
    outcome: row["outcome"],
    liableParty: row["liable_party"],
    decisionNote: row["decision_note"],
    decidedAt: row["decided_at"],
    decidedBy: row["decided_by"],
    approvalId: row["approval_id"],
    recordedEvents: row["recorded_events"],
    closedAt: row["closed_at"],
    closedBy: row["closed_by"],
    closeNote: row["close_note"],
    version: row["version"],
    createdAt: row["created_at"],
    updatedAt: row["updated_at"],
  };
}

/** 工单号的随机部分：6 位（和订单号同一套字符）。 */
export function randomTicketSuffix(): string {
  let text = "";
  for (let i = 0; i < 6; i++) text += ORDER_NO_ALPHABET[randomInt(ORDER_NO_ALPHABET.length)];
  return text;
}

export type NewTicket = Pick<Ticket, "tenantId" | "type" | "source" | "createdByType" | "createdBy" | "orderId" | "parentTicketId" | "priority" | "subject" | "description" | "language" | "firstResponseDueAt" | "resolutionDueAt">;

/** 新建一张工单（平台事务）。工单号撞了（极少）换一个随机部分再试，最多 5 次。 */
export async function insertTicket(db: Db, ticket: NewTicket, now: Date): Promise<Ticket> {
  for (let attempt = 0; ; attempt++) {
    const ticketNo = ticketNumber(now, randomTicketSuffix());
    await db.query("savepoint ticket_no");
    try {
      const result = await db.query<Row>(
        `insert into tickets as t (tenant_id, ticket_no, type, source, created_by_type, created_by, order_id, parent_ticket_id, priority, subject, description, language, status,
                                   first_response_due_at, resolution_due_at, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'open', $13, $14, $15, $15) returning ${COLUMNS}`,
        [ticket.tenantId, ticketNo, ticket.type, ticket.source, ticket.createdByType, ticket.createdBy, ticket.orderId, ticket.parentTicketId, ticket.priority, ticket.subject, ticket.description, ticket.language, ticket.firstResponseDueAt, ticket.resolutionDueAt, now],
      );
      await db.query("release savepoint ticket_no");
      return toTicket(result.rows[0] as Row);
    } catch (err) {
      await db.query("rollback to savepoint ticket_no");
      if (attempt < 4 && (err as { constraint?: string }).constraint === "tickets_ticket_no_key") continue;
      throw err;
    }
  }
}

/** 按编号找工单（平台事务）；`tenantId` 给了只找这个供应商的（供应商的回复、申诉）。 */
export async function findTicket(db: Db, id: string, options: { tenantId?: string; lock?: boolean } = {}): Promise<Ticket | null> {
  const result = await db.query<Row>(`select ${COLUMNS} from tickets t where t.id = $1 and ($2::uuid is null or t.tenant_id = $2) ${options.lock ? "for update" : ""}`, [id, options.tenantId ?? null]);
  const row = result.rows[0];
  return row === undefined ? null : toTicket(row);
}

export type TicketChange = Partial<
  Pick<
    Ticket,
    | "status"
    | "priority"
    | "assigneeId"
    | "assignedAt"
    | "firstRespondedAt"
    | "tenantReplyRequestedAt"
    | "tenantReplyDueAt"
    | "tenantRepliedAt"
    | "outcome"
    | "liableParty"
    | "decisionNote"
    | "decidedAt"
    | "decidedBy"
    | "approvalId"
    | "recordedEvents"
    | "closedAt"
    | "closedBy"
    | "closeNote"
  >
>;

const CHANGE_COLUMNS: Readonly<Record<keyof TicketChange, string>> = {
  status: "status",
  priority: "priority",
  assigneeId: "assignee_id",
  assignedAt: "assigned_at",
  firstRespondedAt: "first_responded_at",
  tenantReplyRequestedAt: "tenant_reply_requested_at",
  tenantReplyDueAt: "tenant_reply_due_at",
  tenantRepliedAt: "tenant_replied_at",
  outcome: "outcome",
  liableParty: "liable_party",
  decisionNote: "decision_note",
  decidedAt: "decided_at",
  decidedBy: "decided_by",
  approvalId: "approval_id",
  recordedEvents: "recorded_events",
  closedAt: "closed_at",
  closedBy: "closed_by",
  closeNote: "close_note",
};

/** 改一张工单（版本加一）。条件是版本没变：并发的两次改动只有一个成功，返回 null 的由调用方报冲突。 */
export async function updateTicket(db: Db, ticket: Pick<Ticket, "tenantId" | "id" | "version">, change: TicketChange, now: Date): Promise<Ticket | null> {
  const sets: string[] = [];
  const values: unknown[] = [ticket.tenantId, ticket.id, ticket.version, now];
  for (const [key, column] of Object.entries(CHANGE_COLUMNS) as [keyof TicketChange, string][]) {
    if (change[key] === undefined) continue;
    values.push(change[key]);
    sets.push(`${column} = $${values.length}`);
  }
  const result = await db.query<Row>(
    `update tickets t set ${[...sets, "version = t.version + 1", "updated_at = $4"].join(", ")} where t.tenant_id = $1 and t.id = $2 and t.version = $3 returning ${COLUMNS}`,
    values,
  );
  const row = result.rows[0];
  return row === undefined ? null : toTicket(row);
}

export interface TicketFilter {
  /** 不给 = 全部；`active` = 还没结论的（待处理、等租户、处理中、复核中） */
  status: TicketStatus | "active" | null;
  type: TicketType | null;
  tenantId: string | null;
  orderId: string | null;
  assigneeId: string | null;
  /** 首次响应或结案过了期限、还没结论的 */
  overdue: boolean;
  /** 工单号、订单号 */
  q: string | null;
  now: Date;
  /** 数据范围（ADR 0030）：只列这几个城市 / 渠道的订单的工单；null 或不给 = 不限制 */
  scopeCityIds?: readonly string[] | null;
  scopeChannelIds?: readonly string[] | null;
}

export interface TicketRow extends Ticket {
  orderNo: string;
  tenantName: string;
}

const ACTIVE = ["open", "awaiting_tenant", "in_progress", "pending_review"];

/** 运营后台的工单队列（平台事务，跨供应商），按创建时间从新到旧。 */
export async function listTickets(db: Db, filter: TicketFilter, limit: number, after: TimeCursor | null): Promise<Page<TicketRow> & { total: number }> {
  const where = `($1::text is null or (case when $1 = 'active' then t.status = any($9::text[]) else t.status = $1 end))
    and ($2::text is null or t.type = $2) and ($3::uuid is null or t.tenant_id = $3) and ($4::uuid is null or t.order_id = $4) and ($5::uuid is null or t.assignee_id = $5)
    and (not $6::boolean or (t.status = any($9::text[]) and ((t.first_responded_at is null and t.first_response_due_at < $8) or t.resolution_due_at < $8)))
    and ($7::text is null or t.ticket_no = $7 or o.order_no = $7)
    and ($10::uuid[] is null or o.city_id = any($10::uuid[]))
    and ($11::uuid[] is null or exists (select 1 from order_sales s where s.order_id = t.order_id and s.channel_id = any($11::uuid[])))`;
  const params = [filter.status, filter.type, filter.tenantId, filter.orderId, filter.assigneeId, filter.overdue, filter.q, filter.now, ACTIVE, filter.scopeCityIds ?? null, filter.scopeChannelIds ?? null];
  const from = "from tickets t join orders o on o.tenant_id = t.tenant_id and o.id = t.order_id join tenants tn on tn.id = t.tenant_id";
  const result = await db.query<Row>(
    `select ${COLUMNS}, o.order_no, tn.name as tenant_name, t.created_at::text as cursor_time ${from}
      where ${where} and ($12::timestamptz is null or (t.created_at, t.id) < ($12::timestamptz, $13::uuid))
      order by t.created_at desc, t.id desc limit $14`,
    [...params, after?.t ?? null, after?.id ?? null, limit + 1],
  );
  const total = await db.query<{ n: number }>(`select count(*)::int as n ${from} where ${where}`, params);
  const page = toPage(result.rows, limit, (row) => ({ ...toTicket(row), orderNo: row["order_no"], tenantName: row["tenant_name"] }), (row) => ({ t: row["cursor_time"], id: row["id"] }));
  return { ...page, total: (total.rows[0] as { n: number }).n };
}

/** 供应商自己的工单（租户事务，行级安全），按创建时间从新到旧。 */
export async function listTenantTickets(db: Db, tenantId: string, filter: { status: TicketStatus | "active" | null; orderId: string | null }, limit: number, after: TimeCursor | null): Promise<Page<TicketRow> & { total: number }> {
  const where = `t.tenant_id = $1 and ($2::text is null or (case when $2 = 'active' then t.status = any($4::text[]) else t.status = $2 end)) and ($3::uuid is null or t.order_id = $3)`;
  const params = [tenantId, filter.status, filter.orderId, ACTIVE];
  const from = "from tickets t join orders o on o.tenant_id = t.tenant_id and o.id = t.order_id join tenants tn on tn.id = t.tenant_id";
  const result = await db.query<Row>(
    `select ${COLUMNS}, o.order_no, tn.name as tenant_name, t.created_at::text as cursor_time ${from}
      where ${where} and ($5::timestamptz is null or (t.created_at, t.id) < ($5::timestamptz, $6::uuid))
      order by t.created_at desc, t.id desc limit $7`,
    [...params, after?.t ?? null, after?.id ?? null, limit + 1],
  );
  const total = await db.query<{ n: number }>(`select count(*)::int as n ${from} where ${where}`, params);
  const page = toPage(result.rows, limit, (row) => ({ ...toTicket(row), orderNo: row["order_no"], tenantName: row["tenant_name"] }), (row) => ({ t: row["cursor_time"], id: row["id"] }));
  return { ...page, total: (total.rows[0] as { n: number }).n };
}

/** 一个订单编号的全部工单（平台事务；救援改派前后几家供应商的都在里面）。 */
export async function listOrderTickets(db: Db, orderId: string): Promise<Ticket[]> {
  const result = await db.query<Row>(`select ${COLUMNS} from tickets t where t.order_id = $1 order by t.created_at, t.id`, [orderId]);
  return result.rows.map(toTicket);
}

/** 对一张工单的申诉（一张判定只能申诉一次）。 */
export async function findAppeal(db: Db, tenantId: string, parentTicketId: string): Promise<Ticket | null> {
  const result = await db.query<Row>(`select ${COLUMNS} from tickets t where t.tenant_id = $1 and t.parent_ticket_id = $2`, [tenantId, parentTicketId]);
  const row = result.rows[0];
  return row === undefined ? null : toTicket(row);
}

/** 还没有审核工单的 no-show 申请（异常队列的定时任务给它们建工单）。 */
export async function listNoShowClaimsWithoutTicket(db: Db, limit: number): Promise<{ tenantId: string; orderId: string; serviceDate: string; timeZone: string; submittedAt: Date }[]> {
  const result = await db.query<Row>(
    `select c.tenant_id, c.order_id, o.service_date::text as service_date, o.timezone, c.submitted_at
       from order_no_show_claims c join orders o on o.tenant_id = c.tenant_id and o.id = c.order_id
      where c.status = 'pending_review' and o.status = 'no_show_claimed'
        and not exists (select 1 from tickets t where t.tenant_id = c.tenant_id and t.order_id = c.order_id and t.type = 'no_show_review')
      order by c.submitted_at limit $1`,
    [limit],
  );
  return result.rows.map((row) => ({ tenantId: row["tenant_id"], orderId: row["order_id"], serviceDate: row["service_date"], timeZone: row["timezone"], submittedAt: row["submitted_at"] }));
}

// ---- 对话 ----

export interface TicketMessage {
  id: string;
  ticketId: string;
  authorType: TicketCreatorType;
  authorId: string | null;
  body: string;
  fileIds: string[];
  createdAt: Date;
}

function toMessage(row: Row): TicketMessage {
  return { id: row["id"], ticketId: row["ticket_id"], authorType: row["author_type"], authorId: row["author_id"], body: row["body"], fileIds: row["file_ids"], createdAt: row["created_at"] };
}

export async function insertTicketMessage(db: Db, ticket: Pick<Ticket, "tenantId" | "id">, message: Pick<TicketMessage, "authorType" | "authorId" | "body" | "fileIds">, now: Date): Promise<TicketMessage> {
  const result = await db.query<Row>(
    "insert into ticket_messages (tenant_id, ticket_id, author_type, author_id, body, file_ids, created_at) values ($1, $2, $3, $4, $5, $6::uuid[], $7) returning id, ticket_id, author_type, author_id, body, file_ids, created_at",
    [ticket.tenantId, ticket.id, message.authorType, message.authorId, message.body, message.fileIds, now],
  );
  return toMessage(result.rows[0] as Row);
}

export async function listTicketMessages(db: Db, tenantId: string, ticketId: string): Promise<TicketMessage[]> {
  const result = await db.query<Row>("select id, ticket_id, author_type, author_id, body, file_ids, created_at from ticket_messages where tenant_id = $1 and ticket_id = $2 order by seq", [tenantId, ticketId]);
  return result.rows.map(toMessage);
}

/** 这些照片是不是都属于这张单（这个供应商的那一行）：留言只能引用这一单的照片作证据。 */
export async function countOrderFiles(db: Db, tenantId: string, orderId: string, fileIds: readonly string[]): Promise<number> {
  if (fileIds.length === 0) return 0;
  const result = await db.query<{ n: number }>("select count(*)::int as n from order_files where tenant_id = $1 and order_id = $2 and id = any($3::uuid[])", [tenantId, orderId, [...fileIds]]);
  return (result.rows[0] as { n: number }).n;
}

// ---- 内部备注 ----

export interface TicketNote {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: Date;
}

export async function insertTicketNote(db: Db, ticketId: string, authorId: string, body: string, now: Date): Promise<void> {
  await db.query("insert into ticket_notes (ticket_id, author_id, body, created_at) values ($1, $2, $3, $4)", [ticketId, authorId, body, now]);
}

export async function listTicketNotes(db: Db, ticketId: string): Promise<TicketNote[]> {
  const result = await db.query<Row>("select n.id, n.author_id, u.name as author_name, n.body, n.created_at from ticket_notes n join platform_users u on u.id = n.author_id where n.ticket_id = $1 order by n.seq", [ticketId]);
  return result.rows.map((row) => ({ id: row["id"], authorId: row["author_id"], authorName: row["author_name"], body: row["body"], createdAt: row["created_at"] }));
}

// ---- 赔付记录 ----

export type PayoutStatus = "none" | "pending" | "paid";

export interface TicketCompensation {
  ticketId: string;
  orderId: string;
  supplierTenantId: string;
  scenario: CompensationScenario;
  liableParty: LiableParty;
  tableVersion: number;
  customerBp: number;
  currency: CurrencyCode;
  sellMinor: number;
  ratioMinor: number;
  downgradeDifferenceMinor: number;
  minimumMinor: number;
  minimumFx: Record<string, unknown> | null;
  toppedUp: boolean;
  compensationMinor: number;
  reimbursementClaimedMinor: number;
  reimbursementCapMinor: number;
  reimbursementMinor: number;
  refundMinor: number;
  manualPayoutMinor: number;
  orderCancelled: boolean;
  payoutStatus: PayoutStatus;
  payoutReference: string | null;
  paidAt: Date | null;
  paidBy: string | null;
  tenantCurrency: CurrencyCode;
  tenantTotalMinor: number;
  createdAt: Date;
  updatedAt: Date;
}

const COMPENSATION_COLUMNS =
  "ticket_id, order_id, supplier_tenant_id, scenario, liable_party, table_version, customer_bp, currency, sell_minor, ratio_minor, downgrade_difference_minor, minimum_minor, minimum_fx, topped_up, compensation_minor, " +
  "reimbursement_claimed_minor, reimbursement_cap_minor, reimbursement_minor, refund_minor, manual_payout_minor, order_cancelled, payout_status, payout_reference, paid_at, paid_by, tenant_currency, tenant_total_minor, created_at, updated_at";

const NUMBER_FIELDS = ["sell_minor", "ratio_minor", "downgrade_difference_minor", "minimum_minor", "compensation_minor", "reimbursement_claimed_minor", "reimbursement_cap_minor", "reimbursement_minor", "refund_minor", "manual_payout_minor", "tenant_total_minor"];

function toCompensation(row: Row): TicketCompensation {
  for (const field of NUMBER_FIELDS) row[field] = Number(row[field]);
  return {
    ticketId: row["ticket_id"],
    orderId: row["order_id"],
    supplierTenantId: row["supplier_tenant_id"],
    scenario: row["scenario"],
    liableParty: row["liable_party"],
    tableVersion: row["table_version"],
    customerBp: row["customer_bp"],
    currency: row["currency"],
    sellMinor: row["sell_minor"],
    ratioMinor: row["ratio_minor"],
    downgradeDifferenceMinor: row["downgrade_difference_minor"],
    minimumMinor: row["minimum_minor"],
    minimumFx: row["minimum_fx"],
    toppedUp: row["topped_up"],
    compensationMinor: row["compensation_minor"],
    reimbursementClaimedMinor: row["reimbursement_claimed_minor"],
    reimbursementCapMinor: row["reimbursement_cap_minor"],
    reimbursementMinor: row["reimbursement_minor"],
    refundMinor: row["refund_minor"],
    manualPayoutMinor: row["manual_payout_minor"],
    orderCancelled: row["order_cancelled"],
    payoutStatus: row["payout_status"],
    payoutReference: row["payout_reference"],
    paidAt: row["paid_at"],
    paidBy: row["paid_by"],
    tenantCurrency: row["tenant_currency"],
    tenantTotalMinor: row["tenant_total_minor"],
    createdAt: row["created_at"],
    updatedAt: row["updated_at"],
  };
}

export async function insertTicketCompensation(db: Db, value: Omit<TicketCompensation, "payoutStatus" | "payoutReference" | "paidAt" | "paidBy" | "createdAt" | "updatedAt">, now: Date): Promise<TicketCompensation> {
  const result = await db.query<Row>(
    `insert into ticket_compensations (ticket_id, order_id, supplier_tenant_id, scenario, liable_party, table_version, customer_bp, currency, sell_minor, ratio_minor, downgrade_difference_minor, minimum_minor, minimum_fx, topped_up,
                                       compensation_minor, reimbursement_claimed_minor, reimbursement_cap_minor, reimbursement_minor, refund_minor, manual_payout_minor, order_cancelled, payout_status, tenant_currency, tenant_total_minor, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $25) returning ${COMPENSATION_COLUMNS}`,
    [
      value.ticketId, value.orderId, value.supplierTenantId, value.scenario, value.liableParty, value.tableVersion, value.customerBp, value.currency, value.sellMinor, value.ratioMinor, value.downgradeDifferenceMinor,
      value.minimumMinor, value.minimumFx === null ? null : JSON.stringify(value.minimumFx), value.toppedUp, value.compensationMinor, value.reimbursementClaimedMinor, value.reimbursementCapMinor, value.reimbursementMinor,
      value.refundMinor, value.manualPayoutMinor, value.orderCancelled, value.manualPayoutMinor > 0 ? "pending" : "none", value.tenantCurrency, value.tenantTotalMinor, now,
    ],
  );
  return toCompensation(result.rows[0] as Row);
}

export async function findTicketCompensation(db: Db, ticketId: string, options: { lock?: boolean } = {}): Promise<TicketCompensation | null> {
  const result = await db.query<Row>(`select ${COMPENSATION_COLUMNS} from ticket_compensations where ticket_id = $1 ${options.lock ? "for update" : ""}`, [ticketId]);
  const row = result.rows[0];
  return row === undefined ? null : toCompensation(row);
}

export async function listTicketCompensations(db: Db, ticketIds: readonly string[]): Promise<Map<string, TicketCompensation>> {
  if (ticketIds.length === 0) return new Map();
  const result = await db.query<Row>(`select ${COMPENSATION_COLUMNS} from ticket_compensations where ticket_id = any($1::uuid[])`, [[...ticketIds]]);
  return new Map(result.rows.map((row) => [row["ticket_id"] as string, toCompensation(row)]));
}

/** 登记另付已付（只改「待支付」的）。返回改了的那一条；已经登记过的返回 null。 */
export async function markPayoutPaid(db: Db, ticketId: string, payout: { reference: string; paidBy: string; now: Date }): Promise<TicketCompensation | null> {
  const result = await db.query<Row>(
    `update ticket_compensations set payout_status = 'paid', payout_reference = $2, paid_by = $3, paid_at = $4, updated_at = $4 where ticket_id = $1 and payout_status = 'pending' returning ${COMPENSATION_COLUMNS}`,
    [ticketId, payout.reference, payout.paidBy, payout.now],
  );
  const row = result.rows[0];
  return row === undefined ? null : toCompensation(row);
}

// ---- 工单记下的应扣款项、履约事件（申诉成立时撤销） ----

/** 免除一张工单记下的、还没免除的应扣款项。返回免除了几条。 */
export async function waiveTicketDeductions(db: Db, tenantId: string, ticketId: string, reason: string, now: Date): Promise<number> {
  const result = await db.query("update tenant_deductions set status = 'waived', waived_at = $3, waive_reason = $4, updated_at = $3 where tenant_id = $1 and ticket_id = $2 and status = 'pending'", [tenantId, ticketId, now, reason]);
  return result.rowCount ?? 0;
}

/** 撤销一条履约事件（申诉成立：那张工单判定时记下的投诉、履约失败）。返回删了几条。 */
export async function deletePerformanceEvent(db: Db, tenantId: string, orderId: string, kind: "complaint" | "failure", failureType: string | null): Promise<number> {
  const result = await db.query("delete from tenant_performance_events where tenant_id = $1 and order_id = $2 and kind = $3 and ($4::text is null or failure_type = $4)", [tenantId, orderId, kind, failureType]);
  return result.rowCount ?? 0;
}
