/**
 * 事后加收的数据访问（M3-03，ADR 0029）。`order_extra_charges` 是租户表：供应商在租户事务里提交、撤回（触发器只许这两样），
 * 平台事务里改状态（客人异议、平台审核、扣款、定时任务）。客人付的金额不在这张表里（在平台表 order_payments，规则 4）。
 */
import type { CurrencyCode, ExtraChargeReviewReason, ExtraChargeStatus, ExtraChargeType } from "@nozomi/domain";
import type { Db } from "../db/context.ts";

type Row = Record<string, any>;

export interface ExtraCharge {
  tenantId: string;
  id: string;
  orderId: string;
  type: ExtraChargeType;
  amountMinor: number;
  currency: CurrencyCode;
  description: string | null;
  fileIds: string[];
  status: ExtraChargeStatus;
  reviewReasons: ExtraChargeReviewReason[];
  submittedAt: Date;
  submittedBy: string;
  disputeUntil: Date;
  disputedAt: Date | null;
  disputeReason: string | null;
  decidedAt: Date | null;
  decidedBy: string | null;
  approvedMinor: number | null;
  decisionNote: string | null;
  chargeAttempts: number;
  nextChargeAt: Date | null;
  lastChargeError: { code: string | null; decline_code: string | null; message: string | null } | null;
  chargedAt: Date | null;
  withdrawnAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const COLUMNS = `tenant_id, id, order_id, type, amount_minor, currency, description, file_ids, status, review_reasons, submitted_at, submitted_by, dispute_until, disputed_at, dispute_reason,
  decided_at, decided_by, approved_minor, decision_note, charge_attempts, next_charge_at, last_charge_error, charged_at, withdrawn_at, version, created_at, updated_at`;

function toCharge(row: Row): ExtraCharge {
  return {
    tenantId: row["tenant_id"],
    id: row["id"],
    orderId: row["order_id"],
    type: row["type"],
    amountMinor: Number(row["amount_minor"]),
    currency: row["currency"],
    description: row["description"],
    fileIds: row["file_ids"],
    status: row["status"],
    reviewReasons: row["review_reasons"],
    submittedAt: row["submitted_at"],
    submittedBy: row["submitted_by"],
    disputeUntil: row["dispute_until"],
    disputedAt: row["disputed_at"],
    disputeReason: row["dispute_reason"],
    decidedAt: row["decided_at"],
    decidedBy: row["decided_by"],
    approvedMinor: row["approved_minor"] === null ? null : Number(row["approved_minor"]),
    decisionNote: row["decision_note"],
    chargeAttempts: row["charge_attempts"],
    nextChargeAt: row["next_charge_at"],
    lastChargeError: row["last_charge_error"],
    chargedAt: row["charged_at"],
    withdrawnAt: row["withdrawn_at"],
    version: row["version"],
    createdAt: row["created_at"],
    updatedAt: row["updated_at"],
  };
}

export interface NewExtraCharge {
  tenantId: string;
  orderId: string;
  type: ExtraChargeType;
  amountMinor: number;
  currency: CurrencyCode;
  description: string | null;
  fileIds: string[];
  reviewReasons: ExtraChargeReviewReason[];
  submittedAt: Date;
  submittedBy: string;
  disputeUntil: Date;
}

export async function insertExtraCharge(db: Db, charge: NewExtraCharge): Promise<ExtraCharge> {
  const result = await db.query<Row>(
    `insert into order_extra_charges (tenant_id, order_id, type, amount_minor, currency, description, file_ids, status, review_reasons, submitted_at, submitted_by, dispute_until, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7::uuid[], 'in_window', $8::text[], $9, $10, $11, $9, $9) returning ${COLUMNS}`,
    [charge.tenantId, charge.orderId, charge.type, charge.amountMinor, charge.currency, charge.description, charge.fileIds, charge.reviewReasons, charge.submittedAt, charge.submittedBy, charge.disputeUntil],
  );
  return toCharge(result.rows[0] as Row);
}

export async function listExtraCharges(db: Db, tenantId: string, orderId: string): Promise<ExtraCharge[]> {
  const result = await db.query<Row>(`select ${COLUMNS} from order_extra_charges where tenant_id = $1 and order_id = $2 order by seq`, [tenantId, orderId]);
  return result.rows.map(toCharge);
}

export async function findExtraCharge(db: Db, tenantId: string, chargeId: string, options: { lock?: boolean } = {}): Promise<ExtraCharge | null> {
  const result = await db.query<Row>(`select ${COLUMNS} from order_extra_charges where tenant_id = $1 and id = $2 ${options.lock ? "for update" : ""}`, [tenantId, chargeId]);
  const row = result.rows[0];
  return row === undefined ? null : toCharge(row);
}

/** 平台事务：按编号找（客人异议、运营审核时只知道订单和加收的编号）。 */
export async function findExtraChargeForPlatform(db: Db, orderId: string, chargeId: string, options: { lock?: boolean } = {}): Promise<ExtraCharge | null> {
  const result = await db.query<Row>(`select ${COLUMNS} from order_extra_charges where order_id = $1 and id = $2 ${options.lock ? "for update" : ""}`, [orderId, chargeId]);
  const row = result.rows[0];
  return row === undefined ? null : toCharge(row);
}

export interface ExtraChargeUpdate {
  status: ExtraChargeStatus;
  reviewReasons?: ExtraChargeReviewReason[];
  disputedAt?: Date;
  disputeReason?: string;
  decidedAt?: Date;
  decidedBy?: string;
  approvedMinor?: number;
  decisionNote?: string | null;
  chargeAttempts?: number;
  nextChargeAt?: Date | null;
  lastChargeError?: ExtraCharge["lastChargeError"];
  chargedAt?: Date;
  withdrawnAt?: Date;
}

/** 改状态和随之变的列（只改给了的；`nextChargeAt` 给了 null 就清掉）。版本加一。 */
/** 改一项加收。给了 `expectStatus` 时只在状态还是它的时候改（状态条件更新），返回改没改成。 */
export async function updateExtraCharge(db: Db, charge: Pick<ExtraCharge, "tenantId" | "id">, update: ExtraChargeUpdate, now: Date, expectStatus?: ExtraChargeStatus): Promise<boolean> {
  const result = await db.query(
    `update order_extra_charges set status = $3, review_reasons = coalesce($4::text[], review_reasons), disputed_at = coalesce($5, disputed_at), dispute_reason = coalesce($6, dispute_reason),
            decided_at = coalesce($7, decided_at), decided_by = coalesce($8, decided_by), approved_minor = coalesce($9, approved_minor), decision_note = coalesce($10, decision_note),
            charge_attempts = coalesce($11, charge_attempts), next_charge_at = case when $12::boolean then $13::timestamptz else next_charge_at end,
            last_charge_error = case when $14::boolean then $15::jsonb else last_charge_error end, charged_at = coalesce($16, charged_at), withdrawn_at = coalesce($17, withdrawn_at),
            version = version + 1, updated_at = $18
      where tenant_id = $1 and id = $2 and ($19::text is null or status = $19)`,
    [
      charge.tenantId, charge.id, update.status, update.reviewReasons ?? null, update.disputedAt ?? null, update.disputeReason ?? null, update.decidedAt ?? null, update.decidedBy ?? null,
      update.approvedMinor ?? null, update.decisionNote ?? null, update.chargeAttempts ?? null, update.nextChargeAt !== undefined, update.nextChargeAt ?? null,
      update.lastChargeError !== undefined, update.lastChargeError === undefined || update.lastChargeError === null ? null : JSON.stringify(update.lastChargeError), update.chargedAt ?? null, update.withdrawnAt ?? null, now, expectStatus ?? null,
    ],
  );
  return result.rowCount === 1;
}

/** 异议期到了的（跨租户，定时任务）。 */
export async function listWindowClosedCharges(db: Db, now: Date, limit: number): Promise<{ tenantId: string; id: string }[]> {
  const result = await db.query<Row>("select tenant_id, id from order_extra_charges where status = 'in_window' and dispute_until <= $1 order by dispute_until, id limit $2", [now, limit]);
  return result.rows.map((row) => ({ tenantId: row["tenant_id"], id: row["id"] }));
}

/** 该扣款的：审核通过的（含收款服务出错后等重试的）、正在扣但租约到期了的（进程中途退出）。 */
export async function listDueCharges(db: Db, now: Date, limit: number): Promise<{ tenantId: string; id: string }[]> {
  const result = await db.query<Row>("select tenant_id, id from order_extra_charges where status in ('approved', 'charging') and next_charge_at <= $1 order by next_charge_at, id limit $2", [now, limit]);
  return result.rows.map((row) => ({ tenantId: row["tenant_id"], id: row["id"] }));
}

/** 供应商撤回（租户事务）：只改状态、撤回时间、版本（别的列出现在语句里会被触发器拒绝）。返回是否撤回了（不在异议期内的不动）。 */
export async function withdrawExtraCharge(db: Db, tenantId: string, chargeId: string, now: Date): Promise<boolean> {
  const result = await db.query("update order_extra_charges set status = 'withdrawn', withdrawn_at = $3, version = version + 1, updated_at = $3 where tenant_id = $1 and id = $2 and status = 'in_window' and dispute_until > $3", [tenantId, chargeId, now]);
  return result.rowCount === 1;
}
