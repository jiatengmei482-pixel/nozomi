/**
 * 运营代改乘客邮箱的复核记录（M4-31，ADR 0065，平台表 `passenger_email_changes`）。
 * 新邮箱和发起时订单上的邮箱只在等审核期间留在这里，按乘客信息加密（ADR 0057）；有结论（批准、驳回、撤回）后清空。
 */
import type { ViewLinkVerification } from "@nozomi/domain";
import { type Db, passengerCryptoOf } from "../db/context.ts";

export type PassengerEmailChangeStatus = "pending_review" | "applied" | "dismissed";

export interface PassengerEmailChange {
  id: string;
  orderId: string;
  sealTenantId: string;
  emailMasked: string;
  previousEmailMasked: string | null;
  verification: ViewLinkVerification;
  approvalId: string;
  status: PassengerEmailChangeStatus;
  changeId: string | null;
  requestedBy: { id: string; name: string };
  createdAt: Date;
  decidedAt: Date | null;
}

type Row = Record<string, any>;

const COLUMNS = "r.id, r.order_id, r.seal_tenant_id, r.email_masked, r.previous_email_masked, r.verification, r.approval_id, r.status, r.change_id, r.requested_by, u.name as requested_by_name, r.created_at, r.decided_at";
const FROM = "passenger_email_changes r join platform_users u on u.id = r.requested_by";

const toChange = (row: Row): PassengerEmailChange => ({
  id: row["id"],
  orderId: row["order_id"],
  sealTenantId: row["seal_tenant_id"],
  emailMasked: row["email_masked"],
  previousEmailMasked: row["previous_email_masked"],
  verification: row["verification"],
  approvalId: row["approval_id"],
  status: row["status"],
  changeId: row["change_id"],
  requestedBy: { id: row["requested_by"], name: row["requested_by_name"] },
  createdAt: row["created_at"],
  decidedAt: row["decided_at"],
});

export interface NewPassengerEmailChange {
  id: string;
  orderId: string;
  sealTenantId: string;
  /** 新邮箱、发起时订单上的邮箱（原文，这里加密） */
  email: string;
  previousEmail: string;
  emailMasked: string;
  previousEmailMasked: string | null;
  verification: ViewLinkVerification;
  approvalId: string;
  requestedBy: string;
  now: Date;
}

// 两个地址是同一行里的两份密文：附加数据带各自的编号，互相换位置解不开
const previousKey = (id: string): string => `${id}:previous`;

export async function insertPassengerEmailChange(db: Db, input: NewPassengerEmailChange): Promise<PassengerEmailChange> {
  const crypto = passengerCryptoOf(db);
  const email = crypto.sealRecipient(input.sealTenantId, input.id, input.email);
  const previous = crypto.sealRecipient(input.sealTenantId, previousKey(input.id), input.previousEmail);
  await db.query(
    `insert into passenger_email_changes (id, order_id, seal_tenant_id, email, email_enc, email_masked, previous_email, previous_email_enc, previous_email_masked, verification, approval_id, status, requested_by, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending_review', $12, $13)`,
    [input.id, input.orderId, input.sealTenantId, email.plain, email.enc, input.emailMasked, previous.plain, previous.enc, input.previousEmailMasked, input.verification, input.approvalId, input.requestedBy, input.now],
  );
  return (await findPendingPassengerEmailChange(db, input.orderId)) as PassengerEmailChange;
}

/** 这一单在等审核的那一条（最多一条，唯一索引保证）。 */
export async function findPendingPassengerEmailChange(db: Db, orderId: string): Promise<PassengerEmailChange | null> {
  const row = (await db.query<Row>(`select ${COLUMNS} from ${FROM} where r.order_id = $1 and r.status = 'pending_review'`, [orderId])).rows[0];
  return row === undefined ? null : toChange(row);
}

/** 审核时：锁住这条，取出两个地址（解密）。不是等审核的状态时 null。 */
export async function lockPendingPassengerEmailChange(db: Db, approvalId: string): Promise<{ change: PassengerEmailChange; email: string; previousEmail: string } | null> {
  const row = (await db.query<Row>(`select ${COLUMNS}, r.email, r.email_enc, r.previous_email, r.previous_email_enc from ${FROM} where r.approval_id = $1 and r.status = 'pending_review' for update of r`, [approvalId])).rows[0];
  if (row === undefined) return null;
  const crypto = passengerCryptoOf(db);
  return {
    change: toChange(row),
    email: crypto.readRecipient(row["seal_tenant_id"], row["id"], row["email_enc"], row["email"]),
    previousEmail: crypto.readRecipient(row["seal_tenant_id"], previousKey(row["id"]), row["previous_email_enc"], row["previous_email"]),
  };
}

/** 审核有结论：已改订单（批准）或作罢（驳回、撤回）。两个地址一并清掉。 */
export async function closePassengerEmailChange(db: Db, approvalId: string, outcome: { status: "applied"; changeId: string } | { status: "dismissed" }, now: Date): Promise<void> {
  await db.query(
    "update passenger_email_changes set status = $2, change_id = $3, email = null, email_enc = null, previous_email = null, previous_email_enc = null, decided_at = $4 where approval_id = $1 and status = 'pending_review'",
    [approvalId, outcome.status, outcome.status === "applied" ? outcome.changeId : null, now],
  );
}
