/**
 * 通知中心（M4-08，ADR 0049）的数据访问：发件箱、发送记录、免打扰设置。
 * `enqueueNotification` 在业务自己的事务里调用（平台事务、租户事务都可以）；其余是后台任务和接口用的。
 */
import { type NotificationAudience, type NotificationEvent, type NotificationStatus, type PlatformDataScope, type QuietHours, UNREADABLE_TEXT, scopeIsRestricted, uniqueRecipients } from "@nozomi/domain";
import { type Db, passengerCryptoOf } from "../db/context.ts";
import { PASSENGER_DECRYPT_FAILED, isPassengerDecryptFailure } from "../integrations/passenger-crypto.ts";
import { type Page, type TimeCursor, toPage } from "../pagination.ts";

type Row = Record<string, any>;

export interface NewNotificationEvent {
  event: NotificationEvent;
  /** 租户事务里必须是当前租户；平台员工的告警为 null */
  tenantId: string | null;
  orderId: string | null;
  /** 同一件事只入箱一次 */
  dedupeKey: string;
  /** 只放编号和枚举，不放邮箱、金额、令牌 */
  data?: Record<string, unknown>;
}

/** 在当前事务里记一件要通知的事。业务回滚它就没有；重复的（同一个键）什么都不做。租户角色没有查询权限，所以不带冲突目标、不要 returning。 */
export async function enqueueNotification(db: Db, event: NewNotificationEvent, now: Date): Promise<void> {
  await db.query("insert into notification_events (tenant_id, event, order_id, dedupe_key, data, occurred_at) values ($1, $2, $3, $4, $5, $6) on conflict do nothing", [event.tenantId, event.event, event.orderId, event.dedupeKey, JSON.stringify(event.data ?? {}), now]);
}

export interface StoredNotificationEvent {
  id: string;
  tenantId: string | null;
  event: NotificationEvent;
  orderId: string | null;
  data: Record<string, unknown>;
  occurredAt: Date;
}

const toEvent = (row: Row): StoredNotificationEvent => ({ id: row["id"], tenantId: row["tenant_id"], event: row["event"], orderId: row["order_id"], data: row["data"], occurredAt: row["occurred_at"] });

export async function claimPendingEvents(db: Db, limit: number): Promise<StoredNotificationEvent[]> {
  const result = await db.query<Row>("select id, tenant_id, event, order_id, data, occurred_at from notification_events where expanded_at is null order by occurred_at, id limit $1 for update skip locked", [limit]);
  return result.rows.map(toEvent);
}

export async function markEventExpanded(db: Db, id: string, now: Date): Promise<void> {
  await db.query("update notification_events set expanded_at = $2 where id = $1", [id, now]);
}

/** 展开出错：记一次；到上限就不再处理（`expand_error` 留着，运营后台看得到数量），后面的事件不受影响。 */
export async function recordExpandFailure(db: Db, id: string, code: string, maxAttempts: number, now: Date): Promise<number> {
  const result = await db.query<{ expand_attempts: number }>(
    "update notification_events set expand_attempts = expand_attempts + 1, expand_error = $2, expanded_at = case when expand_attempts + 1 >= $3 then $4::timestamptz else null end where id = $1 returning expand_attempts",
    [id, code, maxAttempts, now],
  );
  return result.rows[0]?.expand_attempts ?? 0;
}

export async function countFailedEvents(db: Db): Promise<number> {
  return (await db.query<{ n: number }>("select count(*)::int as n from notification_events where expand_error is not null and expanded_at is not null")).rows[0]?.n ?? 0;
}

export async function findEvent(db: Db, id: string): Promise<StoredNotificationEvent | null> {
  const row = (await db.query<Row>("select id, tenant_id, event, order_id, data, occurred_at from notification_events where id = $1", [id])).rows[0];
  return row === undefined ? null : toEvent(row);
}

export interface Notification {
  id: string;
  eventId: string;
  tenantId: string | null;
  event: NotificationEvent;
  audience: NotificationAudience;
  locale: string;
  channel: string;
  recipient: string;
  /** 收件地址的密文解不开（ADR 0057）：不发，记失败 */
  recipientUnreadable: boolean;
  orderId: string | null;
  orderNo: string | null;
  status: NotificationStatus;
  attempts: number;
  nextAttemptAt: Date;
  leaseToken: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  sentAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const COLUMNS = "n.id, n.event_id, n.tenant_id, n.event, n.audience, n.locale, n.channel, n.recipient, n.recipient_enc, n.order_id, n.order_no, n.status, n.attempts, n.next_attempt_at, n.lease_token, n.last_error_code, n.last_error_message, n.sent_at, n.expires_at, n.created_at, n.updated_at";

/** 收件地址读出来；解不开时只这一行受影响（ADR 0057）。 */
function readRecipient(db: Db, row: Row): { recipient: string; unreadable: boolean } {
  try {
    return { recipient: passengerCryptoOf(db).readRecipient(row["tenant_id"], row["event_id"], row["recipient_enc"], row["recipient"]), unreadable: false };
  } catch (err) {
    if (isPassengerDecryptFailure(err)) return { recipient: UNREADABLE_TEXT, unreadable: true };
    throw err;
  }
}

function toNotification(db: Db, row: Row): Notification {
  const recipient = readRecipient(db, row);
  return {
    id: row["id"],
    eventId: row["event_id"],
    tenantId: row["tenant_id"],
    event: row["event"],
    audience: row["audience"],
    locale: row["locale"],
    channel: row["channel"],
    recipient: recipient.recipient,
    recipientUnreadable: recipient.unreadable,
    orderId: row["order_id"],
    orderNo: row["order_no"],
    status: row["status"],
    attempts: row["attempts"],
    nextAttemptAt: row["next_attempt_at"],
    leaseToken: row["lease_token"],
    lastErrorCode: row["last_error_code"],
    lastErrorMessage: row["last_error_message"],
    sentAt: row["sent_at"],
    expiresAt: row["expires_at"],
    createdAt: row["created_at"],
    updatedAt: row["updated_at"],
  };
}

export async function insertNotification(
  db: Db,
  input: { eventId: string; tenantId: string | null; event: NotificationEvent; audience: NotificationAudience; locale: string; channel: string; recipient: string; orderId: string | null; orderNo: string | null; expiresAt: Date; now: Date },
): Promise<void> {
  // 只有给客人的地址是乘客信息；发给员工、供应商的不加密（ADR 0057）
  const sealed = input.audience === "guest" && input.tenantId !== null ? passengerCryptoOf(db).sealRecipient(input.tenantId, input.eventId, input.recipient) : { plain: input.recipient, enc: null };
  await db.query(
    `insert into notifications (event_id, tenant_id, event, audience, locale, channel, recipient, order_id, order_no, status, next_attempt_at, expires_at, created_at, updated_at, recipient_enc)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', $10, $11, $10, $10, $12) on conflict (event_id, audience, recipient) do nothing`,
    [input.eventId, input.tenantId, input.event, input.audience, input.locale, input.channel, sealed.plain, input.orderId, input.orderNo, input.now, input.expiresAt, sealed.enc],
  );
}

/** 过了有效期的等待发送记录改为已过期；返回改了多少条。 */
export async function expireDue(db: Db, now: Date, limit: number): Promise<number> {
  const result = await db.query(
    `update notifications n set status = 'expired', last_error_code = 'EXPIRED', last_error_message = null, updated_at = $1, version = n.version + 1
      where n.id in (select id from notifications where status = 'pending' and expires_at <= $1 order by expires_at limit $2 for update skip locked)`,
    [now, limit],
  );
  return result.rowCount ?? 0;
}

/** 租约到期还在「正在发」：进程在发送中途退出了，不知道发出去了没有。不自动重发，记最终失败。 */
export async function failAbandoned(db: Db, now: Date, limit: number): Promise<Notification[]> {
  // 取走了还没开始连邮件服务器的：肯定没发出去，放回去等下一轮，不算次数，也不用人处理
  await db.query(
    `update notifications n set status = 'pending', next_attempt_at = $1, lease_token = null, lease_until = null, prepared_only = false, updated_at = $1
      where n.id in (select id from notifications where status = 'sending' and prepared_only and lease_until <= $1 order by lease_until limit $2 for update skip locked)`,
    [now, limit],
  );
  const result = await db.query<Row>(
    `update notifications n set status = 'failed', last_error_code = 'OUTCOME_UNKNOWN', last_error_message = null, lease_token = null, lease_until = null, updated_at = $1, version = n.version + 1
      where n.id in (select id from notifications where status = 'sending' and lease_until <= $1 order by lease_until limit $2 for update skip locked)
      returning ${COLUMNS}`,
    [now, limit],
  );
  return result.rows.map((row) => toNotification(db, row));
}

/** 邮件没配置：等着的记录写上原因（已经写过的不动）。不取走、不算次数。 */
export async function markWaitingForConfig(db: Db, message: string, now: Date): Promise<number> {
  const result = await db.query("update notifications set last_error_code = 'NOT_CONFIGURED', last_error_message = $1, updated_at = $2 where status = 'pending' and last_error_code is distinct from 'NOT_CONFIGURED'", [message, now]);
  return result.rowCount ?? 0;
}

/** 租下到期的记录：一个短事务，同一条同一时刻只有一个实例在发。 */
export async function claimDueNotifications(db: Db, now: Date, leaseUntil: Date, limit: number, options: { preparing?: boolean } = {}): Promise<Notification[]> {
  const result = await db.query<Row>(
    `update notifications n set status = 'sending', lease_token = gen_random_uuid(), lease_until = $2, prepared_only = $4, updated_at = $1
      where n.id in (select id from notifications where status = 'pending' and next_attempt_at <= $1 and expires_at > $1 order by next_attempt_at, id limit $3 for update skip locked)
      returning ${COLUMNS}`,
    [now, leaseUntil, limit, options.preparing === true],
  );
  const claimed = result.rows.map((row) => toNotification(db, row));
  // 解不开的这一条记失败（运营后台看得到错误码），不回滚这一批，也不再重试：否则每一轮都卡在它身上（ADR 0057）
  const unreadable = claimed.filter((item) => item.recipientUnreadable).map((item) => item.id);
  if (unreadable.length > 0) {
    await db.query("update notifications set status = 'failed', last_error_code = $3, last_error_message = null, lease_token = null, lease_until = null, prepared_only = false, updated_at = $2, version = version + 1 where id = any($1::uuid[])", [unreadable, now, PASSENGER_DECRYPT_FAILED]);
  }
  return claimed.filter((item) => !item.recipientUnreadable);
}

/**
 * 真正连邮件服务器之前的最后一步：核对租约还是自己的，并重新计时（一批里排在后面的不会因为前面的慢而过期）。
 * 返回 false 表示已经被判中断或被别人接手，这一封不能发。从这一刻起进程退出就是「可能已发出」。
 */
export async function beginSending(db: Db, notification: Pick<Notification, "id" | "leaseToken">, leaseUntil: Date): Promise<boolean> {
  const result = await db.query("update notifications set prepared_only = false, lease_until = $3 where id = $1 and lease_token = $2 and status = 'sending'", [notification.id, notification.leaseToken, leaseUntil]);
  return (result.rowCount ?? 0) === 1;
}

/** 收件人改成订单现在的乘客邮箱（客人在等待发送期间改了邮箱）。 */
export async function updateRecipient(db: Db, notification: Pick<Notification, "id" | "tenantId" | "eventId">, recipient: string): Promise<void> {
  const sealed = notification.tenantId === null ? { plain: recipient, enc: null } : passengerCryptoOf(db).sealRecipient(notification.tenantId, notification.eventId, recipient);
  await db.query("update notifications set recipient = $2, recipient_enc = $3 where id = $1", [notification.id, sealed.plain, sealed.enc]);
}

/** 改了用车时间：还在等的、有效期就是用车时间的记录跟着改。 */
export async function rebaseServiceExpiry(db: Db, orderId: string, serviceAt: Date, events: readonly string[]): Promise<void> {
  await db.query("update notifications set expires_at = $2 where order_id = $1 and status = 'pending' and event = any($3::text[])", [orderId, serviceAt, events]);
}

/** 免打扰改过或清掉了：推迟中的记录马上重新判断（还在时段里的会再推迟），不用等到原来算好的时间。 */
export async function releaseQuietHeld(db: Db, now: Date): Promise<void> {
  await db.query(
    `update notifications n set next_attempt_at = $1 from tenant_notification_settings s
      where n.tenant_id = s.tenant_id and n.status = 'pending' and n.last_error_code = 'QUIET_HOURS' and n.next_attempt_at > $1 and s.updated_at > n.updated_at`,
    [now],
  );
}

export type NotificationOutcome =
  | { status: "sent"; messageId: string; attempts: number }
  | { status: "pending"; nextAttemptAt: Date; attempts: number; code: string | null; message: string | null }
  | { status: "failed" | "expired"; attempts: number; code: string; message: string | null };

/** 记结果：只有租约令牌对得上才记（被接手的一方什么都不记）。返回 null 表示租约已不是自己的。 */
export async function finishNotification(db: Db, notification: Pick<Notification, "id" | "leaseToken">, outcome: NotificationOutcome, now: Date): Promise<Notification | null> {
  const sent = outcome.status === "sent";
  const result = await db.query<Row>(
    `update notifications n set status = $3, attempts = $4, next_attempt_at = coalesce($5, n.next_attempt_at), last_error_code = $6, last_error_message = $7, message_id = coalesce($8, n.message_id), sent_at = $9,
            lease_token = null, lease_until = null, prepared_only = false, updated_at = $10, version = n.version + 1
      where n.id = $1 and n.lease_token = $2 and n.status = 'sending' returning ${COLUMNS}`,
    [
      notification.id,
      notification.leaseToken,
      outcome.status,
      outcome.attempts,
      outcome.status === "pending" ? outcome.nextAttemptAt : null,
      sent ? null : outcome.code,
      sent ? null : outcome.message,
      sent ? outcome.messageId : null,
      sent ? now : null,
      now,
    ],
  );
  const row = result.rows[0];
  return row === undefined ? null : toNotification(db, row);
}

export async function findNotification(db: Db, id: string, options: { lock?: boolean } = {}): Promise<Notification | null> {
  const row = (await db.query<Row>(`select ${COLUMNS} from notifications n where n.id = $1 ${options.lock ? "for update" : ""}`, [id])).rows[0];
  return row === undefined ? null : toNotification(db, row);
}

/** 手动重试：直接租下（调用方已确认能重试）。 */
export async function leaseForManualRetry(db: Db, id: string, now: Date, leaseUntil: Date): Promise<Notification> {
  const result = await db.query<Row>(`update notifications n set status = 'sending', lease_token = gen_random_uuid(), lease_until = $3, prepared_only = true, updated_at = $2, version = n.version + 1 where n.id = $1 returning ${COLUMNS}`, [id, now, leaseUntil]);
  return toNotification(db, result.rows[0] as Row);
}

export interface NotificationFilter {
  /** 租户事务里必须是当前租户；平台事务可以不限 */
  tenantId: string | null;
  status: NotificationStatus | null;
  event: NotificationEvent | null;
  audience: NotificationAudience | null;
  orderId: string | null;
  orderNo: string | null;
  /** 只在平台事务里给：范围外的、不属于订单的记录不列（ADR 0030） */
  scope?: PlatformDataScope | null;
}

/** 从新到旧。 */
export async function listNotifications(db: Db, filter: NotificationFilter, limit: number, after: TimeCursor | null): Promise<Page<Notification> & { total: number }> {
  const scope = filter.scope ?? null;
  const restricted = scope !== null && scopeIsRestricted(scope);
  const where =
    "($1::uuid is null or n.tenant_id = $1) and ($2::text is null or n.status = $2) and ($3::text is null or n.event = $3) and ($4::text is null or n.audience = $4) and ($5::uuid is null or n.order_id = $5) and ($6::text is null or n.order_no = $6)" +
    (restricted
      ? " and exists (select 1 from orders o join order_sales s on s.order_id = o.id where o.id = n.order_id and ($7::uuid[] is null or o.city_id = any($7::uuid[])) and ($8::uuid[] is null or s.channel_id = any($8::uuid[])))"
      : " and $7::uuid[] is null and $8::uuid[] is null");
  const params = [filter.tenantId, filter.status, filter.event, filter.audience, filter.orderId, filter.orderNo, restricted ? (scope?.cityIds ?? null) : null, restricted ? (scope?.channelIds ?? null) : null];
  const result = await db.query<Row>(
    `select ${COLUMNS}, n.created_at::text as cursor_time from notifications n where ${where}
        and ($9::timestamptz is null or (n.created_at, n.id) < ($9::timestamptz, $10::uuid))
      order by n.created_at desc, n.id desc limit $11`,
    [...params, after?.t ?? null, after?.id ?? null, limit + 1],
  );
  const total = await db.query<{ n: number }>(`select count(*)::int as n from notifications n where ${where}`, params);
  return { ...toPage(result.rows, limit, (row: Row) => toNotification(db, row), (row) => ({ t: row["cursor_time"], id: row["id"] })), total: (total.rows[0] as { n: number }).n };
}

export async function countWaitingNotifications(db: Db): Promise<number> {
  return (await db.query<{ n: number }>("select count(*)::int as n from notifications where status = 'pending'")).rows[0]?.n ?? 0;
}

// ---- 免打扰 ----

export interface TenantNotificationSettings {
  quietHours: QuietHours | null;
  version: number;
}

export async function findNotificationSettings(db: Db, tenantId: string): Promise<TenantNotificationSettings> {
  const row = (await db.query<Row>("select quiet_start, quiet_end, version from tenant_notification_settings where tenant_id = $1", [tenantId])).rows[0];
  if (row === undefined) return { quietHours: null, version: 0 };
  return { quietHours: row["quiet_start"] === null ? null : { start: row["quiet_start"], end: row["quiet_end"] }, version: row["version"] };
}

/** 写入：`expectedVersion` 对不上返回 null（0 = 还没有设置过）。 */
export async function saveNotificationSettings(db: Db, tenantId: string, quietHours: QuietHours | null, expectedVersion: number, now: Date): Promise<TenantNotificationSettings | null> {
  const start = quietHours?.start ?? null;
  const end = quietHours?.end ?? null;
  const result =
    expectedVersion === 0
      ? await db.query<Row>("insert into tenant_notification_settings (tenant_id, quiet_start, quiet_end, updated_at) values ($1, $2, $3, $4) on conflict (tenant_id) do nothing returning quiet_start, quiet_end, version", [tenantId, start, end, now])
      : await db.query<Row>("update tenant_notification_settings set quiet_start = $2, quiet_end = $3, updated_at = $4, version = version + 1 where tenant_id = $1 and version = $5 returning quiet_start, quiet_end, version", [tenantId, start, end, now, expectedVersion]);
  const row = result.rows[0];
  if (row === undefined) return null;
  return { quietHours: row["quiet_start"] === null ? null : { start: row["quiet_start"], end: row["quiet_end"] }, version: row["version"] };
}

// ---- 接收人 ----

/** 这家在用的管理员和调度；一个都没有时企业信息里的联系邮箱。 */
export async function tenantRecipients(db: Db, tenantId: string): Promise<string[]> {
  const users = await db.query<{ email: string }>("select email from tenant_users where tenant_id = $1 and status = 'active' and role in ('admin', 'dispatch') order by email", [tenantId]);
  if (users.rows.length > 0) return uniqueRecipients(users.rows.map((row) => row.email));
  const profile = await db.query<{ contact_email: string | null }>("select contact_email from tenant_profiles where tenant_id = $1", [tenantId]);
  const contact = profile.rows[0]?.contact_email?.trim() ?? "";
  return contact === "" ? [] : [contact];
}

/** 这家在用的管理员；一个都没有时企业信息里的联系邮箱。收款账户的通知只发给他们（账户只有管理员能提交，ADR 0051）。 */
export async function tenantAdminRecipients(db: Db, tenantId: string): Promise<string[]> {
  const users = await db.query<{ email: string }>("select email from tenant_users where tenant_id = $1 and status = 'active' and role = 'admin' order by email", [tenantId]);
  if (users.rows.length > 0) return uniqueRecipients(users.rows.map((row) => row.email));
  const profile = await db.query<{ contact_email: string | null }>("select contact_email from tenant_profiles where tenant_id = $1", [tenantId]);
  const contact = profile.rows[0]?.contact_email?.trim() ?? "";
  return contact === "" ? [] : [contact];
}

export interface StaffRecipient {
  email: string;
  role: { key: string; builtin: boolean; grants: string[] | null; scope: PlatformDataScope };
}

export async function activeStaff(db: Db): Promise<StaffRecipient[]> {
  const rows = await db.query<Row>(
    "select u.email, r.key, r.builtin, r.grants, r.scope_city_ids, r.scope_channel_ids from platform_users u join platform_roles r on r.key = u.role where u.status = 'active' order by u.email",
  );
  return rows.rows.map((row) => ({ email: row["email"], role: { key: row["key"], builtin: row["builtin"], grants: row["grants"], scope: { cityIds: row["scope_city_ids"], channelIds: row["scope_channel_ids"] } } }));
}

export async function orderHasSiteLink(db: Db, orderId: string): Promise<boolean> {
  return (await db.query("select 1 from site_order_links where order_id = $1 limit 1", [orderId])).rowCount !== 0;
}

/** 该发用车提醒的单：官网的、24 小时内用车、下单时离用车还有 24 小时以上、这个用车时刻还没提醒过。 */
export async function listReminderDue(db: Db, now: Date, windowMs: number, limit: number): Promise<{ tenantId: string; orderId: string; serviceAtMs: number; revision: number }[]> {
  const result = await db.query<Row>(
    `select o.tenant_id, o.id, (extract(epoch from o.service_at) * 1000)::bigint as service_at_ms,
            (select count(*)::int from notification_events e where e.order_id = o.id and e.event = 'order.service_reminder' and (e.data ->> 'service_at_ms')::bigint = (extract(epoch from o.service_at) * 1000)::bigint) as revision
       from orders o
      where o.status in ('confirmed', 'assigned') and o.service_at > $1 and o.service_at <= $1 + make_interval(secs => $2::double precision / 1000)
        and (o.confirmed_at is null or o.confirmed_at <= o.service_at - make_interval(secs => $2::double precision / 1000))
        and exists (select 1 from site_order_links l where l.order_id = o.id)
        -- 这个用车时刻提醒过（或正等着发）就不再排；因为改期被作废的不算：改回原时间要重新提醒
        and not exists (
          select 1 from notification_events e
           where e.order_id = o.id and e.event = 'order.service_reminder' and (e.data ->> 'service_at_ms')::bigint = (extract(epoch from o.service_at) * 1000)::bigint
             and not (e.expanded_at is not null and exists (select 1 from notifications n where n.event_id = e.id and n.status = 'expired' and n.last_error_code = 'ORDER_STATE_CHANGED'))
        )
      order by o.service_at limit $3`,
    [now, windowMs, limit],
  );
  return result.rows.map((row) => ({ tenantId: row["tenant_id"], orderId: row["id"], serviceAtMs: Number(row["service_at_ms"]), revision: row["revision"] }));
}
