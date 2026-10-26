/**
 * 改单的数据访问（M3-03，ADR 0029）。`order_changes` 是租户表：供应商在租户事务里只读得到自己的（行级安全），
 * 平台事务里写（渠道、运营改单，供应商确认改期也在平台事务里生效——要改用车时间和结算价）。
 */
import type { CurrencyCode, OrderChangeStatus, SettlementBreakdown } from "@nozomi/domain";
import type { Db } from "../db/context.ts";

type Row = Record<string, any>;

export interface OrderChange {
  tenantId: string;
  id: string;
  orderId: string;
  status: OrderChangeStatus;
  reschedule: boolean;
  /** 改了的字段改之前、改之后的值（接口里的字段名） */
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  settlementBeforeMinor: number;
  settlementAfterMinor: number;
  settlementAfter: SettlementBreakdown | null;
  settlementCurrency: CurrencyCode;
  confirmDueAt: Date | null;
  requestedBy: "channel" | "platform_user";
  requestedById: string | null;
  requestedAt: Date;
  dispatchConflict: boolean;
  decidedAt: Date | null;
  decidedBy: string | null;
  decisionNote: string | null;
}

const COLUMNS = `c.tenant_id, c.id, c.order_id, c.status, c.reschedule, c.before, c.after, c.settlement_before_minor, c.settlement_after_minor, c.settlement_after, o.settlement_currency,
  c.confirm_due_at, c.requested_by, c.requested_by_id, c.requested_at, c.dispatch_conflict, c.decided_at, c.decided_by, c.decision_note`;

function toChange(row: Row): OrderChange {
  return {
    tenantId: row["tenant_id"],
    id: row["id"],
    orderId: row["order_id"],
    status: row["status"],
    reschedule: row["reschedule"],
    before: row["before"],
    after: row["after"],
    settlementBeforeMinor: Number(row["settlement_before_minor"]),
    settlementAfterMinor: Number(row["settlement_after_minor"]),
    settlementAfter: row["settlement_after"],
    settlementCurrency: row["settlement_currency"],
    confirmDueAt: row["confirm_due_at"],
    requestedBy: row["requested_by"],
    requestedById: row["requested_by_id"],
    requestedAt: row["requested_at"],
    dispatchConflict: row["dispatch_conflict"],
    decidedAt: row["decided_at"],
    decidedBy: row["decided_by"],
    decisionNote: row["decision_note"],
  };
}

export interface NewOrderChange {
  tenantId: string;
  orderId: string;
  status: OrderChangeStatus;
  reschedule: boolean;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  settlementBeforeMinor: number;
  settlementAfterMinor: number;
  settlementAfter: SettlementBreakdown | null;
  confirmDueAt: Date | null;
  requestedBy: "channel" | "platform_user";
  requestedById: string | null;
  requestedAt: Date;
  /** 不等确认、马上生效的单：生效时间 */
  decidedAt: Date | null;
}

export async function insertOrderChange(db: Db, change: NewOrderChange): Promise<string> {
  const result = await db.query<{ id: string }>(
    `insert into order_changes (tenant_id, order_id, status, reschedule, before, after, settlement_before_minor, settlement_after_minor, settlement_after, confirm_due_at, requested_by, requested_by_id, requested_at, decided_at)
     values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9::jsonb, $10, $11, $12, $13, $14) returning id`,
    [
      change.tenantId, change.orderId, change.status, change.reschedule, JSON.stringify(change.before), JSON.stringify(change.after), change.settlementBeforeMinor, change.settlementAfterMinor,
      change.settlementAfter === null ? null : JSON.stringify(change.settlementAfter), change.confirmDueAt, change.requestedBy, change.requestedById, change.requestedAt, change.decidedAt,
    ],
  );
  return (result.rows[0] as { id: string }).id;
}

export async function findOrderChange(db: Db, tenantId: string, changeId: string, options: { lock?: boolean } = {}): Promise<OrderChange | null> {
  const result = await db.query<Row>(`select ${COLUMNS} from order_changes c join orders o on o.tenant_id = c.tenant_id and o.id = c.order_id where c.tenant_id = $1 and c.id = $2 ${options.lock ? "for update of c" : ""}`, [tenantId, changeId]);
  const row = result.rows[0];
  return row === undefined ? null : toChange(row);
}

export async function listOrderChanges(db: Db, tenantId: string, orderId: string): Promise<OrderChange[]> {
  const result = await db.query<Row>(`select ${COLUMNS} from order_changes c join orders o on o.tenant_id = c.tenant_id and o.id = c.order_id where c.tenant_id = $1 and c.order_id = $2 order by c.seq`, [tenantId, orderId]);
  return result.rows.map(toChange);
}

/** 这张单现在没有结论的改单（最多一个）。 */
export async function findOpenChange(db: Db, tenantId: string, orderId: string, options: { lock?: boolean } = {}): Promise<OrderChange | null> {
  const result = await db.query<Row>(
    `select ${COLUMNS} from order_changes c join orders o on o.tenant_id = c.tenant_id and o.id = c.order_id
      where c.tenant_id = $1 and c.order_id = $2 and c.status in ('awaiting_payment', 'pending_confirmation') ${options.lock ? "for update of c" : ""}`,
    [tenantId, orderId],
  );
  const row = result.rows[0];
  return row === undefined ? null : toChange(row);
}

export async function updateOrderChange(db: Db, change: Pick<OrderChange, "tenantId" | "id">, update: { status: OrderChangeStatus; decidedAt?: Date | null; decidedBy?: string | null; decisionNote?: string | null; confirmDueAt?: Date | null; dispatchConflict?: boolean }): Promise<void> {
  await db.query(
    `update order_changes set status = $3, decided_at = coalesce($4, decided_at), decided_by = coalesce($5, decided_by), decision_note = coalesce($6, decision_note),
            confirm_due_at = coalesce($7, confirm_due_at), dispatch_conflict = coalesce($8, dispatch_conflict)
      where tenant_id = $1 and id = $2`,
    [change.tenantId, change.id, update.status, update.decidedAt ?? null, update.decidedBy ?? null, update.decisionNote ?? null, update.confirmDueAt ?? null, update.dispatchConflict ?? null],
  );
}

/** 30 分钟没确认的改期（跨租户，定时任务）。 */
export async function listOverdueChanges(db: Db, now: Date, limit: number): Promise<{ tenantId: string; id: string }[]> {
  const result = await db.query<Row>("select tenant_id, id from order_changes where status = 'pending_confirmation' and confirm_due_at <= $1 order by confirm_due_at, id limit $2", [now, limit]);
  return result.rows.map((row) => ({ tenantId: row["tenant_id"], id: row["id"] }));
}

/** 补差价扣到一半就没了下文的改单（扣款的请求出错、进程中途退出）：提出超过 `olderThan` 还在 awaiting_payment 的。 */
export async function listStuckChanges(db: Db, olderThan: Date, limit: number): Promise<{ tenantId: string; id: string }[]> {
  const result = await db.query<Row>("select tenant_id, id from order_changes where status = 'awaiting_payment' and requested_at <= $1 order by requested_at, id limit $2", [olderThan, limit]);
  return result.rows.map((row) => ({ tenantId: row["tenant_id"], id: row["id"] }));
}
