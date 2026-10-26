/**
 * 账单与付款批次的数据访问（M5-01，ADR 0040）。
 *
 * - `statements`（账单）、`statement_lines`（明细）、`statement_events`（经过）是租户表：供应商在租户事务里只读自己的（行级安全）；
 *   出账、确认、提异议、答复、作废、复核都在平台事务里做，所有按供应商的查询都带着租户编号（供应商的请求里来自令牌）。
 * - `payout_batches`（付款批次）是平台表，租户角色没有任何权限。
 * - 「还没出账的应付」按来源键找：一笔应付同一时刻只能挂在一张有效的账单上（`statement_lines_source_key`）。
 */
import type { BillableItem, CurrencyCode, PayoutBatchStatus, StatementLineKind, StatementStatus } from "@nozomi/domain";
import { ORDER_CONCLUDED_STATUSES, deductionBillable, extraChargeBillable, orderBillable } from "@nozomi/domain";
import type { Db } from "../db/context.ts";
import { type Page, type TimeCursor, toPage } from "../pagination.ts";

type Row = Record<string, any>;

export type StatementActorType = "tenant_user" | "platform_user" | "system";

export interface Statement {
  tenantId: string;
  id: string;
  statementNo: string;
  period: string;
  currency: CurrencyCode;
  status: StatementStatus;
  totalMinor: number;
  lineCount: number;
  payDueOn: string;
  confirmDueAt: Date;
  issuedAt: Date;
  confirmedAt: Date | null;
  confirmedByType: "tenant_user" | "system" | null;
  confirmedBy: string | null;
  disputedAt: Date | null;
  disputeReason: string | null;
  approvalId: string | null;
  approvedAt: Date | null;
  payoutBatchId: string | null;
  payoutOn: string | null;
  paidAt: Date | null;
  voidedAt: Date | null;
  voidedBy: string | null;
  voidReason: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface StatementLine {
  id: string;
  kind: StatementLineKind;
  sourceKey: string;
  orderId: string | null;
  orderNo: string | null;
  serviceDate: string | null;
  priorPeriod: boolean;
  amountMinor: number;
  currency: CurrencyCode;
  detail: Record<string, unknown>;
  voidedAt: Date | null;
}

export interface StatementEvent {
  seq: number;
  action: string;
  actorType: StatementActorType;
  actorId: string | null;
  note: string | null;
  data: Record<string, unknown>;
  at: Date;
}

export interface PayoutBatch {
  id: string;
  payDate: string;
  status: PayoutBatchStatus;
  createdAt: Date;
  closedAt: Date | null;
  closedBy: string | null;
  paidAt: Date | null;
  version: number;
}

const COLUMNS = `s.tenant_id, s.id, s.statement_no, s.period, s.currency, s.status, s.total_minor, s.line_count, s.pay_due_on::text as pay_due_on, s.confirm_due_at, s.issued_at,
  s.confirmed_at, s.confirmed_by_type, s.confirmed_by, s.disputed_at, s.dispute_reason, s.approval_id, s.approved_at, s.payout_batch_id, s.payout_on::text as payout_on, s.paid_at,
  s.voided_at, s.voided_by, s.void_reason, s.version, s.created_at, s.updated_at`;

function toStatement(row: Row): Statement {
  return {
    tenantId: row["tenant_id"],
    id: row["id"],
    statementNo: row["statement_no"],
    period: row["period"],
    currency: row["currency"],
    status: row["status"],
    totalMinor: Number(row["total_minor"]),
    lineCount: row["line_count"],
    payDueOn: row["pay_due_on"],
    confirmDueAt: row["confirm_due_at"],
    issuedAt: row["issued_at"],
    confirmedAt: row["confirmed_at"],
    confirmedByType: row["confirmed_by_type"],
    confirmedBy: row["confirmed_by"],
    disputedAt: row["disputed_at"],
    disputeReason: row["dispute_reason"],
    approvalId: row["approval_id"],
    approvedAt: row["approved_at"],
    payoutBatchId: row["payout_batch_id"],
    payoutOn: row["payout_on"],
    paidAt: row["paid_at"],
    voidedAt: row["voided_at"],
    voidedBy: row["voided_by"],
    voidReason: row["void_reason"],
    version: row["version"],
    createdAt: row["created_at"],
    updatedAt: row["updated_at"],
  };
}

function toLine(row: Row): StatementLine {
  return {
    id: row["id"],
    kind: row["kind"],
    sourceKey: row["source_key"],
    orderId: row["order_id"],
    orderNo: row["order_no"],
    serviceDate: row["service_date"],
    priorPeriod: row["prior_period"],
    amountMinor: Number(row["amount_minor"]),
    currency: row["currency"],
    detail: row["detail"],
    voidedAt: row["voided_at"],
  };
}

function toBatch(row: Row): PayoutBatch {
  return {
    id: row["id"],
    payDate: row["pay_date"],
    status: row["status"],
    createdAt: row["created_at"],
    closedAt: row["closed_at"],
    closedBy: row["closed_by"],
    paidAt: row["paid_at"],
    version: row["version"],
  };
}

// ---- 还没出账的应付 ----

/** 这一笔应付现在有没有挂在一张有效的账单上（SQL 片段：`$1` 是租户编号）。 */
const billed = (key: string): string => `exists (select 1 from statement_lines l where l.tenant_id = $1 and l.source_key = ${key} and l.voided_at is null)`;

/**
 * 一个供应商还没出账、服务日期不晚于 `until` 的应付（domain 的出账口径逐笔判断）：订单（已完成、客人未出现、有偿取消）、已扣到款的事后加收、
 * 订单到了终态的应扣款项、出过账后被免除的应扣款项、转入下期的上期账单。
 */
export async function listBillableItems(db: Db, tenantId: string, until: string): Promise<BillableItem[]> {
  const items: BillableItem[] = [];
  const orders = await db.query(
    `select o.id, o.order_no, o.status, o.service_date::text as service_date, o.settlement_minor, o.settlement_currency, o.cancel_tenant_share_minor, o.cancel_fee_bp, o.cancel_reason
       from orders o
      where o.tenant_id = $1 and o.service_date <= $2::date
        and (o.status in ('completed', 'no_show') or (o.status = 'cancelled' and o.cancel_tenant_share_minor > 0))
        and not ${billed("'order:' || o.id::text")}`,
    [tenantId, until],
  );
  for (const row of orders.rows) {
    const share = row["cancel_tenant_share_minor"] === null ? null : Number(row["cancel_tenant_share_minor"]);
    const billable = orderBillable({ status: row["status"], settlementMinor: Number(row["settlement_minor"]), cancelTenantShareMinor: share });
    if (billable === null) continue;
    items.push({
      sourceKey: `order:${row["id"]}`,
      kind: billable.kind,
      currency: row["settlement_currency"],
      amountMinor: billable.amountMinor,
      serviceDate: row["service_date"],
      orderId: row["id"],
      orderNo: row["order_no"],
      detail:
        billable.kind === "cancellation"
          ? { order_status: row["status"], settlement_minor: Number(row["settlement_minor"]), cancel_fee_bp: row["cancel_fee_bp"], cancel_reason: row["cancel_reason"] }
          : { order_status: row["status"], settlement_minor: Number(row["settlement_minor"]) },
    });
  }
  const charges = await db.query(
    `select e.id, e.type, e.status, e.amount_minor, e.approved_minor, e.currency, o.id as order_id, o.order_no, o.service_date::text as service_date
       from order_extra_charges e join orders o on o.tenant_id = e.tenant_id and o.id = e.order_id
      where e.tenant_id = $1 and e.status = 'charged' and o.service_date <= $2::date
        and not ${billed("'extra_charge:' || e.id::text")}`,
    [tenantId, until],
  );
  for (const row of charges.rows) {
    const amount = extraChargeBillable({ status: row["status"], amountMinor: Number(row["amount_minor"]), approvedMinor: row["approved_minor"] === null ? null : Number(row["approved_minor"]) });
    if (amount === null) continue;
    items.push({
      sourceKey: `extra_charge:${row["id"]}`,
      kind: "extra_charge",
      currency: row["currency"],
      amountMinor: amount,
      serviceDate: row["service_date"],
      orderId: row["order_id"],
      orderNo: row["order_no"],
      detail: { extra_charge_id: row["id"], type: row["type"], submitted_minor: Number(row["amount_minor"]) },
    });
  }
  const deductions = await db.query(
    `select d.id, d.kind, d.status, d.amount_minor, d.currency, d.basis, d.waive_reason, o.id as order_id, o.order_no, o.status as order_status, o.service_date::text as service_date,
            ${billed("'deduction:' || d.id::text")} as billed,
            ${billed("'deduction_waiver:' || d.id::text")} as waiver_billed
       from tenant_deductions d join orders o on o.tenant_id = d.tenant_id and o.id = d.order_id
      where d.tenant_id = $1 and o.service_date <= $2::date and d.amount_minor > 0
        and ((d.status = 'pending' and not ${billed("'deduction:' || d.id::text")}) or (d.status = 'waived' and not ${billed("'deduction_waiver:' || d.id::text")}))`,
    [tenantId, until],
  );
  for (const row of deductions.rows) {
    const billable = deductionBillable({
      status: row["status"],
      amountMinor: Number(row["amount_minor"]),
      orderConcluded: (ORDER_CONCLUDED_STATUSES as readonly string[]).includes(row["order_status"]),
      billed: row["billed"],
      waiverBilled: row["waiver_billed"],
    });
    if (billable === null) continue;
    items.push({
      sourceKey: `${billable.kind}:${row["id"]}`,
      kind: billable.kind,
      currency: row["currency"],
      amountMinor: billable.amountMinor,
      serviceDate: row["service_date"],
      orderId: row["order_id"],
      orderNo: row["order_no"],
      detail: billable.kind === "deduction" ? { deduction_id: row["id"], deduction_kind: row["kind"], basis: row["basis"] } : { deduction_id: row["id"], deduction_kind: row["kind"], waive_reason: row["waive_reason"] },
    });
  }
  const carries = await db.query(
    `select s.id, s.statement_no, s.period, s.currency, s.total_minor from statements s
      where s.tenant_id = $1 and s.status = 'carried' and not ${billed("'carry:' || s.id::text")}`,
    [tenantId],
  );
  for (const row of carries.rows) {
    items.push({
      sourceKey: `carry:${row["id"]}`,
      kind: "carry_forward",
      currency: row["currency"],
      amountMinor: Number(row["total_minor"]),
      serviceDate: null,
      orderId: null,
      orderNo: null,
      detail: { statement_id: row["id"], statement_no: row["statement_no"], period: row["period"] },
    });
  }
  return items;
}

/** 有还没出账的应付的供应商（服务日期不晚于 `until`）：出账的定时任务逐家做。 */
export async function listTenantsWithBillableItems(db: Db, until: string): Promise<string[]> {
  const unbilled = (key: string, tenant: string): string => `not exists (select 1 from statement_lines l where l.tenant_id = ${tenant} and l.source_key = ${key} and l.voided_at is null)`;
  const result = await db.query<{ tenant_id: string }>(
    `select tenant_id from orders o
      where o.service_date <= $1::date and (o.status in ('completed', 'no_show') or (o.status = 'cancelled' and o.cancel_tenant_share_minor > 0))
        and ${unbilled("'order:' || o.id::text", "o.tenant_id")}
     union
     select e.tenant_id from order_extra_charges e join orders o on o.tenant_id = e.tenant_id and o.id = e.order_id
      where e.status = 'charged' and o.service_date <= $1::date and ${unbilled("'extra_charge:' || e.id::text", "e.tenant_id")}
     union
     select d.tenant_id from tenant_deductions d join orders o on o.tenant_id = d.tenant_id and o.id = d.order_id
      where o.service_date <= $1::date and d.amount_minor > 0
        and ((d.status = 'pending' and o.status = any($2::text[]) and ${unbilled("'deduction:' || d.id::text", "d.tenant_id")})
          or (d.status = 'waived' and not ${unbilled("'deduction:' || d.id::text", "d.tenant_id")} and ${unbilled("'deduction_waiver:' || d.id::text", "d.tenant_id")}))
     order by 1`,
    [until, [...ORDER_CONCLUDED_STATUSES]],
  );
  return result.rows.map((row) => row.tenant_id);
}

// ---- 账单 ----

/** 同一个供应商的出账排队（几个实例、定时任务和手动出账同时到时，一家一家来；事务结束自动放开）。 */
export async function lockTenantBilling(db: Db, tenantId: string): Promise<void> {
  await db.query("select pg_advisory_xact_lock(hashtextextended('nozomi-billing:' || $1::text, 0))", [tenantId]);
}

/** 这一期已经有有效账单的币种。 */
export async function listCurrentCurrencies(db: Db, tenantId: string, period: string): Promise<string[]> {
  const result = await db.query<{ currency: string }>("select currency from statements where tenant_id = $1 and period = $2 and status <> 'void'", [tenantId, period]);
  return result.rows.map((row) => row.currency);
}

export interface NewStatement {
  tenantId: string;
  statementNo: string;
  period: string;
  currency: CurrencyCode;
  totalMinor: number;
  lineCount: number;
  payDueOn: string;
  confirmDueAt: Date;
  now: Date;
}

export async function insertStatement(db: Db, statement: NewStatement): Promise<string> {
  const result = await db.query<{ id: string }>(
    `insert into statements (tenant_id, statement_no, period, currency, status, total_minor, line_count, pay_due_on, confirm_due_at, issued_at, created_at, updated_at)
     values ($1, $2, $3, $4, 'issued', $5, $6, $7::date, $8, $9, $9, $9) returning id`,
    [statement.tenantId, statement.statementNo, statement.period, statement.currency, statement.totalMinor, statement.lineCount, statement.payDueOn, statement.confirmDueAt, statement.now],
  );
  return (result.rows[0] as { id: string }).id;
}

export async function insertStatementLines(db: Db, tenantId: string, statementId: string, lines: readonly (BillableItem & { priorPeriod: boolean })[], now: Date): Promise<void> {
  for (const line of lines) {
    await db.query(
      `insert into statement_lines (tenant_id, statement_id, kind, source_key, order_id, order_no, service_date, prior_period, amount_minor, currency, detail, created_at)
       values ($1, $2, $3, $4, $5, $6, $7::date, $8, $9, $10, $11::jsonb, $12)`,
      [tenantId, statementId, line.kind, line.sourceKey, line.orderId, line.orderNo, line.serviceDate, line.priorPeriod, line.amountMinor, line.currency, JSON.stringify(line.detail), now],
    );
  }
}

export async function insertStatementEvent(db: Db, tenantId: string, statementId: string, event: { action: string; actorType: StatementActorType; actorId: string | null; note: string | null; data: Record<string, unknown>; at: Date }): Promise<void> {
  await db.query(
    "insert into statement_events (tenant_id, statement_id, action, actor_type, actor_id, note, data, at) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)",
    [tenantId, statementId, event.action, event.actorType, event.actorId, event.note, JSON.stringify(event.data), event.at],
  );
}

/** 按编号找账单；`tenantId` 给了就只在这家供应商里找（供应商的请求：来自令牌）。 */
export async function findStatement(db: Db, id: string, options: { tenantId?: string; lock?: boolean } = {}): Promise<Statement | null> {
  const result = await db.query(`select ${COLUMNS} from statements s where s.id = $1 and ($2::uuid is null or s.tenant_id = $2)${options.lock === true ? " for update" : ""}`, [id, options.tenantId ?? null]);
  const row = result.rows[0];
  return row === undefined ? null : toStatement(row);
}

export async function listStatementLines(db: Db, tenantId: string, statementId: string): Promise<StatementLine[]> {
  const result = await db.query(
    `select id, kind, source_key, order_id, order_no, service_date::text as service_date, prior_period, amount_minor, currency, detail, voided_at
       from statement_lines where tenant_id = $1 and statement_id = $2
      order by case kind when 'carry_forward' then 0 when 'order' then 1 when 'no_show' then 2 when 'cancellation' then 3 when 'extra_charge' then 4 when 'deduction' then 5 else 6 end,
               service_date nulls first, order_no nulls first, source_key`,
    [tenantId, statementId],
  );
  return result.rows.map(toLine);
}

export async function listStatementEvents(db: Db, tenantId: string, statementId: string): Promise<StatementEvent[]> {
  const result = await db.query("select seq, action, actor_type, actor_id, note, data, at from statement_events where tenant_id = $1 and statement_id = $2 order by seq", [tenantId, statementId]);
  return result.rows.map((row) => ({ seq: Number(row["seq"]), action: row["action"], actorType: row["actor_type"], actorId: row["actor_id"], note: row["note"], data: row["data"], at: row["at"] }));
}

/** 供应商自己的账单（最近的周期在前）。 */
export async function listTenantStatements(db: Db, tenantId: string, filter: { period: string | null; status: StatementStatus | null }): Promise<Statement[]> {
  const result = await db.query(
    `select ${COLUMNS} from statements s where s.tenant_id = $1 and ($2::text is null or s.period = $2) and ($3::text is null or s.status = $3)
      order by s.period desc, s.created_at desc, s.id limit 200`,
    [tenantId, filter.period, filter.status],
  );
  return result.rows.map(toStatement);
}

export interface PlatformStatementFilter {
  tenantId: string | null;
  period: string | null;
  status: StatementStatus | null;
  payoutBatchId: string | null;
}

/** 运营后台跨供应商的账单列表：按出账时间从新到旧；带供应商名称和总数。 */
export async function listPlatformStatements(db: Db, filter: PlatformStatementFilter, limit: number, after: TimeCursor | null): Promise<Page<Statement & { tenantName: string }> & { total: number }> {
  const where = "($1::uuid is null or s.tenant_id = $1) and ($2::text is null or s.period = $2) and ($3::text is null or s.status = $3) and ($4::uuid is null or s.payout_batch_id = $4)";
  const params = [filter.tenantId, filter.period, filter.status, filter.payoutBatchId];
  const result = await db.query(
    `select ${COLUMNS}, t.name as tenant_name, s.created_at::text as cursor_time from statements s join tenants t on t.id = s.tenant_id
      where ${where} and ($5::timestamptz is null or (s.created_at, s.id) < ($5::timestamptz, $6::uuid))
      order by s.created_at desc, s.id desc limit $7`,
    [...params, after?.t ?? null, after?.id ?? null, limit + 1],
  );
  const total = await db.query<{ n: number }>(`select count(*)::int as n from statements s where ${where}`, params);
  return { ...toPage(result.rows, limit, (row) => ({ ...toStatement(row), tenantName: row["tenant_name"] as string }), (row) => ({ t: row["cursor_time"], id: row["id"] })), total: (total.rows[0] as { n: number }).n };
}

export async function tenantName(db: Db, tenantId: string): Promise<string> {
  return ((await db.query<{ name: string }>("select name from tenants where id = $1", [tenantId])).rows[0] as { name: string }).name;
}

/** 改账单的状态和随之变的列（调用方已锁住这一行并核对过状态）；版本加一。 */
export async function updateStatement(db: Db, tenantId: string, id: string, fields: Partial<Record<"status" | "confirmed_at" | "confirmed_by_type" | "confirmed_by" | "disputed_at" | "dispute_reason" | "confirm_due_at" | "approval_id" | "approved_at" | "payout_batch_id" | "payout_on" | "voided_at" | "voided_by" | "void_reason", unknown>>, now: Date): Promise<void> {
  const entries = Object.entries(fields);
  const sets = entries.map(([column], index) => `${column} = $${index + 3}`);
  await db.query(`update statements set ${[...sets, `updated_at = $${entries.length + 3}`, "version = version + 1"].join(", ")} where tenant_id = $1 and id = $2`, [tenantId, id, ...entries.map(([, value]) => value), now]);
}

/** 作废账单的明细（释放应付，下次出账重新计入）。 */
export async function voidStatementLines(db: Db, tenantId: string, statementId: string, now: Date): Promise<void> {
  await db.query("update statement_lines set voided_at = $3 where tenant_id = $1 and statement_id = $2 and voided_at is null", [tenantId, statementId, now]);
}

/** 这张账单有没有待审核的付款复核。 */
export async function pendingReviewOf(db: Db, statementId: string): Promise<string | null> {
  const result = await db.query<{ id: string }>("select id from approvals where kind = 'statement.payout' and resource_id = $1 and status = 'pending' order by requested_at desc limit 1", [statementId]);
  return result.rows[0]?.id ?? null;
}

/** 确认期满还是「待确认」的账单（跨供应商）。 */
export async function listAutoConfirmDue(db: Db, now: Date, limit: number): Promise<{ tenantId: string; id: string }[]> {
  const result = await db.query<{ tenant_id: string; id: string }>("select tenant_id, id from statements where status = 'issued' and confirm_due_at <= $1 order by confirm_due_at, id limit $2", [now, limit]);
  return result.rows.map((row) => ({ tenantId: row.tenant_id, id: row.id }));
}

/** 供应商现在生效的合同的付款日（没有合同为 null）。 */
export async function contractPaymentDay(db: Db, tenantId: string, today: string): Promise<number | null> {
  const result = await db.query<{ payment_day: number }>("select payment_day from tenant_contracts where tenant_id = $1 and valid_from <= $2::date order by valid_from desc limit 1", [tenantId, today]);
  return result.rows[0]?.payment_day ?? null;
}

export async function tenantStatus(db: Db, tenantId: string): Promise<string> {
  return ((await db.query<{ status: string }>("select status from tenants where id = $1", [tenantId])).rows[0] as { status: string }).status;
}

// ---- 付款批次 ----

const BATCH_COLUMNS = "b.id, b.pay_date::text as pay_date, b.status, b.created_at, b.closed_at, b.closed_by, b.paid_at, b.version";

export async function findBatch(db: Db, id: string, options: { lock?: boolean } = {}): Promise<PayoutBatch | null> {
  const result = await db.query(`select ${BATCH_COLUMNS} from payout_batches b where b.id = $1${options.lock === true ? " for update" : ""}`, [id]);
  const row = result.rows[0];
  return row === undefined ? null : toBatch(row);
}

/** 付款日在 `from` 之后（含）的已经不收账单的批次的付款日。 */
export async function closedBatchDates(db: Db, from: string): Promise<string[]> {
  const result = await db.query<{ pay_date: string }>("select pay_date::text as pay_date from payout_batches where pay_date >= $1::date and status <> 'open'", [from]);
  return result.rows.map((row) => row.pay_date);
}

/** 取这一天的批次（没有就建一个「收账单中」的），锁住它。 */
export async function lockBatchFor(db: Db, payDate: string, now: Date): Promise<PayoutBatch> {
  await db.query("insert into payout_batches (pay_date, status, created_at) values ($1::date, 'open', $2) on conflict (pay_date) do nothing", [payDate, now]);
  const result = await db.query(`select ${BATCH_COLUMNS} from payout_batches b where b.pay_date = $1::date for update`, [payDate]);
  return toBatch(result.rows[0] as Row);
}

export async function closeBatch(db: Db, id: string, closedBy: string, now: Date): Promise<void> {
  await db.query("update payout_batches set status = 'closed', closed_at = $2, closed_by = $3, version = version + 1 where id = $1 and status = 'open'", [id, now, closedBy]);
}

export interface BatchSummary extends PayoutBatch {
  statements: number;
  totals: { currency: string; count: number; totalMinor: number }[];
}

/** 批次列表（付款日从新到旧），带每种币种的张数和合计。 */
export async function listBatches(db: Db, filter: { status: PayoutBatchStatus | null }): Promise<BatchSummary[]> {
  const result = await db.query(`select ${BATCH_COLUMNS} from payout_batches b where ($1::text is null or b.status = $1) order by b.pay_date desc limit 200`, [filter.status]);
  const batches = result.rows.map(toBatch);
  const totals = await db.query<{ payout_batch_id: string; currency: string; n: number; total: string }>(
    "select payout_batch_id, currency, count(*)::int as n, sum(total_minor)::text as total from statements where payout_batch_id = any($1::uuid[]) group by payout_batch_id, currency order by currency",
    [batches.map((batch) => batch.id)],
  );
  return batches.map((batch) => {
    const rows = totals.rows.filter((row) => row.payout_batch_id === batch.id);
    return { ...batch, statements: rows.reduce((sum, row) => sum + row.n, 0), totals: rows.map((row) => ({ currency: row.currency, count: row.n, totalMinor: Number(row.total) })) };
  });
}

/** 批次里的账单（带供应商名称）。 */
export async function listBatchStatements(db: Db, batchId: string): Promise<(Statement & { tenantName: string })[]> {
  const result = await db.query(
    `select ${COLUMNS}, t.name as tenant_name from statements s join tenants t on t.id = s.tenant_id where s.payout_batch_id = $1 order by t.name, s.currency, s.id`,
    [batchId],
  );
  return result.rows.map((row) => ({ ...toStatement(row), tenantName: row["tenant_name"] as string }));
}
