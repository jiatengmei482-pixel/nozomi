/**
 * 司机链接邮件的发送请求（M4-27，ADR 0058）。租户表，只能追加；主键就是发件箱事件的编号。
 * 表里没有邮箱和令牌。发送状态从发送记录（`notifications`，只有 `audience = 'driver'` 的）读。
 */
import type { Db } from "../db/context.ts";

type Row = Record<string, any>;

export interface NewDriverLinkEmail {
  id: string;
  orderId: string;
  assignmentId: string;
  driverId: string;
  linkId: string;
  trigger: "auto" | "resend";
  requestedBy: string | null;
  requestedAt: Date;
}

export async function insertDriverLinkEmail(db: Db, tenantId: string, request: NewDriverLinkEmail): Promise<void> {
  await db.query("insert into driver_link_emails (tenant_id, id, order_id, assignment_id, driver_id, link_id, trigger, requested_by, requested_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)", [
    tenantId, request.id, request.orderId, request.assignmentId, request.driverId, request.linkId, request.trigger, request.requestedBy, request.requestedAt,
  ]);
}

/** 这张单最新的一次发起。 */
export async function latestDriverLinkEmailId(db: Db, tenantId: string, orderId: string): Promise<string | null> {
  const result = await db.query<Row>("select id from driver_link_emails where tenant_id = $1 and order_id = $2 order by seq desc limit 1", [tenantId, orderId]);
  return (result.rows[0]?.["id"] as string | undefined) ?? null;
}

export interface LatestDriverLinkEmail {
  requestedAt: Date;
  notification: { status: string; recipient: string; errorCode: string | null; sentAt: Date | null } | null;
}

/** 这条调度员链接上最新的一次发起和它的发送记录（还没展开时没有）。 */
export async function latestDriverLinkEmailOfLink(db: Db, tenantId: string, orderId: string, linkId: string): Promise<LatestDriverLinkEmail | null> {
  const result = await db.query<Row>(
    `select r.requested_at, n.status, n.recipient, n.last_error_code, n.sent_at
       from driver_link_emails r left join notifications n on n.event_id = r.id and n.tenant_id = r.tenant_id and n.audience = 'driver'
      where r.tenant_id = $1 and r.order_id = $2 and r.link_id = $3 order by r.seq desc limit 1`,
    [tenantId, orderId, linkId],
  );
  const row = result.rows[0];
  if (row === undefined) return null;
  return { requestedAt: row["requested_at"], notification: row["status"] === null ? null : { status: row["status"], recipient: row["recipient"], errorCode: row["last_error_code"], sentAt: row["sent_at"] } };
}

/** 限速用：这张单最近的发起时间、这家最近的次数和最早一次。 */
export async function driverLinkEmailUsage(db: Db, tenantId: string, orderId: string, since: Date): Promise<{ orderRecent: Date[]; tenantCount: number; tenantOldest: Date | null }> {
  const order = await db.query<Row>("select requested_at from driver_link_emails where tenant_id = $1 and order_id = $2 and requested_at > $3", [tenantId, orderId, since]);
  const tenant = await db.query<Row>("select count(*)::int as n, min(requested_at) as oldest from driver_link_emails where tenant_id = $1 and requested_at > $2", [tenantId, since]);
  return { orderRecent: order.rows.map((row) => row["requested_at"] as Date), tenantCount: tenant.rows[0]?.["n"] ?? 0, tenantOldest: tenant.rows[0]?.["oldest"] ?? null };
}
