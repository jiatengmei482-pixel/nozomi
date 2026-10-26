/**
 * 退款的数据访问（M3-03，ADR 0029）。`order_refunds` 是平台表：客人那边的金额，租户角色碰不到（规则 4）。
 * 每一行是发给收款服务的一笔退款（对着一笔已收的钱）。状态：等着发 → 正在发（租约）→ 退好了 / 失败。
 */
import type { CurrencyCode, RefundStatus } from "@nozomi/domain";
import type { Db } from "../db/context.ts";

type Row = Record<string, any>;

export type RefundPurpose = "cancellation" | "change";

export interface OrderRefund {
  id: string;
  orderId: string;
  supplierTenantId: string;
  paymentId: string;
  purpose: RefundPurpose;
  changeId: string | null;
  amountMinor: number;
  currency: CurrencyCode;
  status: RefundStatus;
  providerRefundId: string | null;
  /** 手动重试时：重试的是哪一笔失败的退款 */
  retryOf: string | null;
  attempts: number;
  nextAttemptAt: Date | null;
  lastError: { code: string | null; message: string | null } | null;
  succeededAt: Date | null;
  failedAt: Date | null;
  /** 作废：订单取消时的退款已经把这一笔失败的包含进去了（不能再重试） */
  supersededAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const COLUMNS = "id, order_id, supplier_tenant_id, payment_id, purpose, change_id, amount_minor, currency, status, provider_refund_id, retry_of, attempts, next_attempt_at, last_error, succeeded_at, failed_at, superseded_at, created_at, updated_at";

function toRefund(row: Row): OrderRefund {
  return {
    id: row["id"],
    orderId: row["order_id"],
    supplierTenantId: row["supplier_tenant_id"],
    paymentId: row["payment_id"],
    purpose: row["purpose"],
    changeId: row["change_id"],
    amountMinor: Number(row["amount_minor"]),
    currency: row["currency"],
    status: row["status"],
    providerRefundId: row["provider_refund_id"],
    retryOf: row["retry_of"],
    attempts: row["attempts"],
    nextAttemptAt: row["next_attempt_at"],
    lastError: row["last_error"],
    succeededAt: row["succeeded_at"],
    failedAt: row["failed_at"],
    supersededAt: row["superseded_at"],
    createdAt: row["created_at"],
    updatedAt: row["updated_at"],
  };
}

export async function insertRefund(db: Db, refund: { orderId: string; supplierTenantId: string; paymentId: string; purpose: RefundPurpose; changeId: string | null; amountMinor: number; currency: CurrencyCode; now: Date; retryOf?: string }): Promise<OrderRefund> {
  const result = await db.query<Row>(
    `insert into order_refunds (order_id, supplier_tenant_id, payment_id, purpose, change_id, amount_minor, currency, status, next_attempt_at, created_at, updated_at, retry_of)
     values ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $8, $8, $9) returning ${COLUMNS}`,
    [refund.orderId, refund.supplierTenantId, refund.paymentId, refund.purpose, refund.changeId, refund.amountMinor, refund.currency, refund.now, refund.retryOf ?? null],
  );
  return toRefund(result.rows[0] as Row);
}

export async function listOrderRefunds(db: Db, orderId: string): Promise<OrderRefund[]> {
  const result = await db.query<Row>(`select ${COLUMNS} from order_refunds where order_id = $1 order by created_at, id`, [orderId]);
  return result.rows.map(toRefund);
}

export async function findRefund(db: Db, refundId: string, options: { lock?: boolean } = {}): Promise<OrderRefund | null> {
  const result = await db.query<Row>(`select ${COLUMNS} from order_refunds where id = $1 ${options.lock ? "for update" : ""}`, [refundId]);
  const row = result.rows[0];
  return row === undefined ? null : toRefund(row);
}

export async function findRefundByProviderId(db: Db, providerRefundId: string, options: { lock?: boolean } = {}): Promise<OrderRefund | null> {
  const result = await db.query<Row>(`select ${COLUMNS} from order_refunds where provider_refund_id = $1 ${options.lock ? "for update" : ""}`, [providerRefundId]);
  const row = result.rows[0];
  return row === undefined ? null : toRefund(row);
}

/**
 * 每一笔收款里已经退了的和正在退的（失败的不算——含作废的）：再退时不能超过剩下的。
 * 失败的不算已退，所以取消时「实际付了的」包含失败的那几笔；取消时把它们作废（`supersedeFailedRefunds`），不会再被重试。
 */
export async function refundedByPayment(db: Db, orderId: string): Promise<Map<string, number>> {
  const result = await db.query<Row>("select payment_id, sum(amount_minor)::bigint as total from order_refunds where order_id = $1 and status <> 'failed' group by payment_id", [orderId]);
  return new Map(result.rows.map((row) => [row["payment_id"] as string, Number(row["total"])]));
}

/** 订单取消时：还没重试过、也没作废的失败退款记为作废（取消的退款按「实际付了的」算，已经包含了它们）。返回作废的编号。 */
export async function supersedeFailedRefunds(db: Db, orderId: string, now: Date): Promise<string[]> {
  const result = await db.query<Row>(
    `update order_refunds r set superseded_at = $2, updated_at = $2
      where r.order_id = $1 and r.status = 'failed' and r.superseded_at is null and not exists (select 1 from order_refunds retry where retry.retry_of = r.id)
      returning r.id`,
    [orderId, now],
  );
  return result.rows.map((row) => row["id"] as string);
}

export interface RefundChange {
  status: RefundStatus;
  providerRefundId?: string | null;
  attempts?: number;
  nextAttemptAt: Date | null;
  lastError?: OrderRefund["lastError"];
  succeededAt?: Date | null;
  failedAt?: Date | null;
}

export async function updateRefund(db: Db, refundId: string, change: RefundChange, now: Date): Promise<void> {
  await db.query(
    `update order_refunds set status = $2, provider_refund_id = coalesce($3, provider_refund_id), attempts = coalesce($4, attempts), next_attempt_at = $5,
            last_error = case when $6::boolean then $7::jsonb else last_error end, succeeded_at = $8, failed_at = $9, updated_at = $10
      where id = $1`,
    [
      refundId, change.status, change.providerRefundId ?? null, change.attempts ?? null, change.nextAttemptAt, change.lastError !== undefined, change.lastError === undefined || change.lastError === null ? null : JSON.stringify(change.lastError),
      change.succeededAt ?? null, change.failedAt ?? null, now,
    ],
  );
}

/** 到时候该发的退款（等着发的，和租约到期的「正在发」），最早的在前。跨租户（定时任务）。 */
export async function listDueRefunds(db: Db, now: Date, limit: number): Promise<string[]> {
  const result = await db.query<Row>("select id from order_refunds where status in ('pending', 'processing') and next_attempt_at <= $1 order by next_attempt_at, id limit $2", [now, limit]);
  return result.rows.map((row) => row["id"] as string);
}

/** 一笔收款退好了以后：已退金额 = 收款服务通知的、和平台记的退好了的合计，取大的（两边谁先到都不会多记或少记）。 */
export async function syncPaymentRefunded(db: Db, paymentId: string, now: Date): Promise<void> {
  await db.query(
    `update order_payments p set refunded_minor = least(p.amount_minor, greatest(p.refunded_minor, coalesce((select sum(r.amount_minor) from order_refunds r where r.payment_id = p.id and r.status = 'succeeded'), 0))), updated_at = $2
      where p.id = $1`,
    [paymentId, now],
  );
}

// ---- 改期的对外价（平台表） ----

export interface ChangeSale {
  changeId: string;
  currency: CurrencyCode;
  sellBeforeMinor: number;
  sellAfterMinor: number;
}

export async function insertChangeSale(db: Db, sale: ChangeSale & { orderId: string; supplierTenantId: string }): Promise<void> {
  await db.query("insert into order_change_sales (change_id, order_id, supplier_tenant_id, currency, sell_before_minor, sell_after_minor) values ($1, $2, $3, $4, $5, $6)", [
    sale.changeId, sale.orderId, sale.supplierTenantId, sale.currency, sale.sellBeforeMinor, sale.sellAfterMinor,
  ]);
}

export async function listChangeSales(db: Db, orderId: string): Promise<Map<string, ChangeSale>> {
  const result = await db.query<Row>("select change_id, currency, sell_before_minor, sell_after_minor from order_change_sales where order_id = $1", [orderId]);
  return new Map(result.rows.map((row) => [row["change_id"] as string, { changeId: row["change_id"], currency: row["currency"], sellBeforeMinor: Number(row["sell_before_minor"]), sellAfterMinor: Number(row["sell_after_minor"]) }]));
}

export async function findChangeSale(db: Db, changeId: string): Promise<ChangeSale | null> {
  const row = (await db.query<Row>("select change_id, currency, sell_before_minor, sell_after_minor from order_change_sales where change_id = $1", [changeId])).rows[0];
  return row === undefined ? null : { changeId: row["change_id"], currency: row["currency"], sellBeforeMinor: Number(row["sell_before_minor"]), sellAfterMinor: Number(row["sell_after_minor"]) };
}
