/**
 * 运营核实后重发官网订单链接的记录（M4-30，ADR 0061，平台表 `view_link_requests`）。
 * 新邮箱只在等审核期间留在这里，按乘客信息加密（ADR 0057）；有结论（批准、驳回、撤回）后清空。
 */
import type { ViewLinkTarget, ViewLinkVerification } from "@nozomi/domain";
import { type Db, passengerCryptoOf } from "../db/context.ts";

export type ViewLinkRequestStatus = "queued" | "pending_review" | "dismissed";

export interface ViewLinkRequest {
  id: string;
  orderId: string;
  sealTenantId: string;
  target: ViewLinkTarget;
  recipientMasked: string;
  verification: ViewLinkVerification;
  approvalId: string | null;
  status: ViewLinkRequestStatus;
  requestedBy: { id: string; name: string };
  createdAt: Date;
  decidedAt: Date | null;
}

type Row = Record<string, any>;

const COLUMNS = "r.id, r.order_id, r.seal_tenant_id, r.target, r.recipient_masked, r.verification, r.approval_id, r.status, r.requested_by, u.name as requested_by_name, r.created_at, r.decided_at";
const FROM = "view_link_requests r join platform_users u on u.id = r.requested_by";

const toRequest = (row: Row): ViewLinkRequest => ({
  id: row["id"],
  orderId: row["order_id"],
  sealTenantId: row["seal_tenant_id"],
  target: row["target"],
  recipientMasked: row["recipient_masked"],
  verification: row["verification"],
  approvalId: row["approval_id"],
  status: row["status"],
  requestedBy: { id: row["requested_by"], name: row["requested_by_name"] },
  createdAt: row["created_at"],
  decidedAt: row["decided_at"],
});

export interface NewViewLinkRequest {
  id: string;
  orderId: string;
  sealTenantId: string;
  target: ViewLinkTarget;
  /** 发到新邮箱时的地址（原文，这里加密）；发到原邮箱时 null */
  recipient: string | null;
  recipientMasked: string;
  verification: ViewLinkVerification;
  approvalId: string | null;
  notificationEventId: string | null;
  requestedBy: string;
  now: Date;
}

export async function insertViewLinkRequest(db: Db, input: NewViewLinkRequest): Promise<ViewLinkRequest> {
  const sealed = input.recipient === null ? { plain: null, enc: null } : passengerCryptoOf(db).sealRecipient(input.sealTenantId, input.id, input.recipient);
  await db.query(
    `insert into view_link_requests (id, order_id, seal_tenant_id, target, recipient, recipient_enc, recipient_masked, verification, approval_id, status, notification_event_id, requested_by, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [input.id, input.orderId, input.sealTenantId, input.target, sealed.plain, sealed.enc, input.recipientMasked, input.verification, input.approvalId, input.notificationEventId === null ? "pending_review" : "queued", input.notificationEventId, input.requestedBy, input.now],
  );
  return (await findViewLinkRequest(db, input.id)) as ViewLinkRequest;
}

export async function findViewLinkRequest(db: Db, id: string): Promise<ViewLinkRequest | null> {
  const row = (await db.query<Row>(`select ${COLUMNS} from ${FROM} where r.id = $1`, [id])).rows[0];
  return row === undefined ? null : toRequest(row);
}

/** 这一单在等审核的那一条（最多一条，唯一索引保证）。 */
export async function findPendingViewLinkRequest(db: Db, orderId: string): Promise<ViewLinkRequest | null> {
  const row = (await db.query<Row>(`select ${COLUMNS} from ${FROM} where r.order_id = $1 and r.status = 'pending_review'`, [orderId])).rows[0];
  return row === undefined ? null : toRequest(row);
}

export async function listViewLinkRequests(db: Db, orderId: string, limit: number): Promise<ViewLinkRequest[]> {
  return (await db.query<Row>(`select ${COLUMNS} from ${FROM} where r.order_id = $1 order by r.created_at desc, r.id limit $2`, [orderId, limit])).rows.map(toRequest);
}

/** 审核时：锁住这条，取出新邮箱（解密）。不是等审核的状态时 null。 */
export async function lockPendingViewLinkRecipient(db: Db, approvalId: string): Promise<{ request: ViewLinkRequest; recipient: string } | null> {
  const row = (await db.query<Row>(`select ${COLUMNS}, r.recipient, r.recipient_enc from ${FROM} where r.approval_id = $1 and r.status = 'pending_review' for update of r`, [approvalId])).rows[0];
  if (row === undefined) return null;
  return { request: toRequest(row), recipient: passengerCryptoOf(db).readRecipient(row["seal_tenant_id"], row["id"], row["recipient_enc"], row["recipient"]) };
}

/** 审核有结论：排进了通知中心（批准）或作罢（驳回、撤回）。新邮箱一并清掉。 */
export async function closeViewLinkRequest(db: Db, approvalId: string, outcome: { status: "queued"; notificationEventId: string } | { status: "dismissed" }, now: Date): Promise<void> {
  await db.query("update view_link_requests set status = $2, notification_event_id = $3, recipient = null, recipient_enc = null, decided_at = $4 where approval_id = $1 and status = 'pending_review'", [approvalId, outcome.status, outcome.status === "queued" ? outcome.notificationEventId : null, now]);
}
