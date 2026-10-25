/**
 * 推送给供应商（租户 Webhook，M3-02，ADR 0027）的数据访问：订阅、投递、每一次尝试。
 * 三张都是租户表：供应商后台在租户事务里读写自己的；推送任务、付款确认时排队、运营后台在平台事务里跨租户读写（查询自己带好条件）。
 */
import type { TenantWebhookEvent, WebhookEventType } from "@nozomi/domain";
import type { Db } from "../db/context.ts";
import { type Page, type TimeCursor, toPage } from "../pagination.ts";

type Row = Record<string, any>;

export interface TenantWebhook {
  tenantId: string;
  url: string;
  events: TenantWebhookEvent[];
  secretCiphertext: string;
  secretHint: string;
  secretCreatedAt: Date;
  status: "active" | "paused";
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const WEBHOOK_COLUMNS = "tenant_id, url, events, secret_ciphertext, secret_hint, secret_created_at, status, version, created_at, updated_at";

function toWebhook(row: Row): TenantWebhook {
  return {
    tenantId: row["tenant_id"],
    url: row["url"],
    events: row["events"],
    secretCiphertext: row["secret_ciphertext"],
    secretHint: row["secret_hint"],
    secretCreatedAt: row["secret_created_at"],
    status: row["status"],
    version: row["version"],
    createdAt: row["created_at"],
    updatedAt: row["updated_at"],
  };
}

export async function findTenantWebhook(db: Db, tenantId: string, options: { lock?: boolean } = {}): Promise<TenantWebhook | null> {
  const result = await db.query<Row>(`select ${WEBHOOK_COLUMNS} from tenant_webhooks where tenant_id = $1 ${options.lock ? "for update" : ""}`, [tenantId]);
  const row = result.rows[0];
  return row === undefined ? null : toWebhook(row);
}

export async function insertTenantWebhook(db: Db, webhook: Omit<TenantWebhook, "version" | "updatedAt">): Promise<TenantWebhook> {
  const result = await db.query<Row>(
    `insert into tenant_webhooks (tenant_id, url, events, secret_ciphertext, secret_hint, secret_created_at, status, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $8) returning ${WEBHOOK_COLUMNS}`,
    [webhook.tenantId, webhook.url, webhook.events, webhook.secretCiphertext, webhook.secretHint, webhook.secretCreatedAt, webhook.status, webhook.createdAt],
  );
  return toWebhook(result.rows[0] as Row);
}

export async function updateTenantWebhook(
  db: Db,
  tenantId: string,
  change: { url: string; events: TenantWebhookEvent[]; status: "active" | "paused"; secret?: { ciphertext: string; hint: string; createdAt: Date } },
  now: Date,
): Promise<TenantWebhook> {
  const result = await db.query<Row>(
    `update tenant_webhooks set url = $2, events = $3, status = $4, secret_ciphertext = coalesce($5, secret_ciphertext), secret_hint = coalesce($6, secret_hint),
            secret_created_at = coalesce($7, secret_created_at), version = version + 1, updated_at = $8
      where tenant_id = $1 returning ${WEBHOOK_COLUMNS}`,
    [tenantId, change.url, change.events, change.status, change.secret?.ciphertext ?? null, change.secret?.hint ?? null, change.secret?.createdAt ?? null, now],
  );
  return toWebhook(result.rows[0] as Row);
}

export async function deleteTenantWebhook(db: Db, tenantId: string): Promise<void> {
  await db.query("delete from tenant_webhooks where tenant_id = $1", [tenantId]);
}

// ---- 投递 ----

export type DeliveryStatus = "pending" | "succeeded" | "failed";

export interface WebhookDelivery {
  tenantId: string;
  id: string;
  seq: number;
  eventId: string;
  eventType: WebhookEventType;
  orderId: string | null;
  eventData: Record<string, unknown>;
  status: DeliveryStatus;
  attempts: number;
  nextAttemptAt: Date | null;
  lastAttemptAt: Date | null;
  lastStatusCode: number | null;
  lastErrorCode: string | null;
  lastDurationMs: number | null;
  succeededAt: Date | null;
  failedAt: Date | null;
  createdAt: Date;
  /** 推送任务租下这一条时写入的租约令牌；没在发的是 null。记结果时核对它。 */
  leaseToken: string | null;
}

const DELIVERY_COLUMNS = `d.tenant_id, d.id, d.seq, d.event_id, d.event_type, d.order_id, d.event_data, d.status, d.attempts, d.next_attempt_at, d.last_attempt_at, d.last_status_code,
  d.last_error_code, d.last_duration_ms, d.succeeded_at, d.failed_at, d.created_at, d.lease_token`;

function toDelivery(row: Row): WebhookDelivery {
  return {
    tenantId: row["tenant_id"],
    id: row["id"],
    seq: Number(row["seq"]),
    eventId: row["event_id"],
    eventType: row["event_type"],
    orderId: row["order_id"],
    eventData: row["event_data"],
    status: row["status"],
    attempts: row["attempts"],
    nextAttemptAt: row["next_attempt_at"],
    lastAttemptAt: row["last_attempt_at"],
    lastStatusCode: row["last_status_code"],
    lastErrorCode: row["last_error_code"],
    lastDurationMs: row["last_duration_ms"],
    succeededAt: row["succeeded_at"],
    failedAt: row["failed_at"],
    createdAt: row["created_at"],
    leaseToken: row["lease_token"],
  };
}

export async function insertDelivery(
  db: Db,
  delivery: { tenantId: string; eventId: string; eventType: WebhookEventType; orderId: string | null; eventData: Record<string, unknown>; status: DeliveryStatus; nextAttemptAt: Date | null; createdAt: Date },
): Promise<WebhookDelivery> {
  const result = await db.query<Row>(
    `insert into webhook_deliveries as d (tenant_id, event_id, event_type, order_id, event_data, status, next_attempt_at, created_at)
     values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8) returning ${DELIVERY_COLUMNS}`,
    [delivery.tenantId, delivery.eventId, delivery.eventType, delivery.orderId, JSON.stringify(delivery.eventData), delivery.status, delivery.nextAttemptAt, delivery.createdAt],
  );
  return toDelivery(result.rows[0] as Row);
}

export async function findDelivery(db: Db, tenantId: string | null, id: string, options: { lock?: boolean } = {}): Promise<WebhookDelivery | null> {
  const result = await db.query<Row>(`select ${DELIVERY_COLUMNS} from webhook_deliveries d where ($1::uuid is null or d.tenant_id = $1) and d.id = $2 ${options.lock ? "for update" : ""}`, [tenantId, id]);
  const row = result.rows[0];
  return row === undefined ? null : toDelivery(row);
}

/** 正在被推送任务发送：还在等待、有租约令牌、租约没到期。 */
export function deliveryLeased(delivery: Pick<WebhookDelivery, "status" | "leaseToken" | "nextAttemptAt">, now: Date): boolean {
  return delivery.status === "pending" && delivery.leaseToken !== null && delivery.nextAttemptAt !== null && delivery.nextAttemptAt.getTime() > now.getTime();
}

/**
 * 平台事务：取到期的投递并「租下」它们（`next_attempt_at` 改成租约到期的时间，写一个新的租约令牌），多个实例同时取时用 `skip locked` 互不重复。
 * 租约到期没记结果（进程中途退出）的，到期后重新取、换一个令牌，原来那一方再记结果时对不上令牌。
 * 同一张订单的事件按排队的先后依次投递：前面还有没投完的，后面的这一轮不取。
 */
export async function claimDueDeliveries(db: Db, now: Date, leaseUntil: Date, limit: number): Promise<WebhookDelivery[]> {
  const result = await db.query<Row>(
    `with due as (
       select d.tenant_id, d.id from webhook_deliveries d
        where d.status = 'pending' and d.next_attempt_at <= $1
          and not exists (select 1 from webhook_deliveries e where e.tenant_id = d.tenant_id and e.order_id = d.order_id and e.status = 'pending' and e.seq < d.seq)
        order by d.next_attempt_at, d.seq
        limit $3
        for update of d skip locked
     )
     update webhook_deliveries d set next_attempt_at = $2, lease_token = gen_random_uuid() from due where d.tenant_id = due.tenant_id and d.id = due.id
     returning ${DELIVERY_COLUMNS}`,
    [now, leaseUntil, limit],
  );
  return result.rows.map(toDelivery).sort((a, b) => a.seq - b.seq);
}

export interface AttemptOutcome {
  statusCode: number | null;
  errorCode: string | null;
  durationMs: number;
  at: Date;
}

/**
 * 记一次尝试的结果并决定下一步：成功 / 排下一次重试 / 最终失败，同时放掉租约。
 * 只有租约令牌还对得上（这一轮确实是自己租下的、没被别人接手）才记得上；对不上返回 null，调用方不记这次尝试。
 */
export async function finishDeliveryAttempt(
  db: Db,
  delivery: Pick<WebhookDelivery, "tenantId" | "id" | "leaseToken">,
  outcome: AttemptOutcome,
  next: { status: DeliveryStatus; nextAttemptAt: Date | null },
): Promise<WebhookDelivery | null> {
  const result = await db.query<Row>(
    `update webhook_deliveries d set status = $3::text, attempts = attempts + 1, next_attempt_at = $4::timestamptz, last_attempt_at = $5::timestamptz, last_status_code = $6, last_error_code = $7,
            last_duration_ms = $8, succeeded_at = case when $3::text = 'succeeded' then $5::timestamptz end, failed_at = case when $3::text = 'failed' then $5::timestamptz end, lease_token = null
      where d.tenant_id = $1 and d.id = $2 and d.status = 'pending' and d.lease_token is not distinct from $9::uuid returning ${DELIVERY_COLUMNS}`,
    [delivery.tenantId, delivery.id, next.status, next.nextAttemptAt, outcome.at, outcome.statusCode, outcome.errorCode, outcome.durationMs, delivery.leaseToken],
  );
  const row = result.rows[0];
  return row === undefined ? null : toDelivery(row);
}

/**
 * 手动重推：最终失败的改回等待、马上投；等待重试中的提前到现在；租约已经到期没记结果的收回租约。已成功的、正在发送（租约中）的不动，调用方先判断。
 */
export async function rescheduleDelivery(db: Db, delivery: Pick<WebhookDelivery, "tenantId" | "id">, now: Date): Promise<WebhookDelivery> {
  const result = await db.query<Row>(
    `update webhook_deliveries d set status = 'pending', next_attempt_at = $3, failed_at = null, lease_token = null where d.tenant_id = $1 and d.id = $2 returning ${DELIVERY_COLUMNS}`,
    [delivery.tenantId, delivery.id, now],
  );
  return toDelivery(result.rows[0] as Row);
}

export interface DeliveryFilter {
  tenantId: string | null;
  status: DeliveryStatus | null;
  orderId: string | null;
}

/** 投递记录：从新到旧。租户事务里 `tenantId` 必须是当前租户；平台事务可以不限。 */
export async function listDeliveries(db: Db, filter: DeliveryFilter, limit: number, after: TimeCursor | null): Promise<Page<WebhookDelivery> & { total: number }> {
  const where = "($1::uuid is null or d.tenant_id = $1) and ($2::text is null or d.status = $2) and ($3::uuid is null or d.order_id = $3)";
  const params = [filter.tenantId, filter.status, filter.orderId];
  const result = await db.query<Row>(
    `select ${DELIVERY_COLUMNS}, d.created_at::text as cursor_time from webhook_deliveries d where ${where}
        and ($4::timestamptz is null or (d.created_at, d.id) < ($4::timestamptz, $5::uuid))
      order by d.created_at desc, d.id desc limit $6`,
    [...params, after?.t ?? null, after?.id ?? null, limit + 1],
  );
  const total = await db.query<{ n: number }>(`select count(*)::int as n from webhook_deliveries d where ${where}`, params);
  return { ...toPage(result.rows, limit, toDelivery, (row) => ({ t: row["cursor_time"], id: row["id"] })), total: (total.rows[0] as { n: number }).n };
}

// ---- 每一次尝试 ----

export interface WebhookAttempt {
  attemptNo: number;
  trigger: "schedule" | "manual" | "test";
  startedAt: Date;
  durationMs: number;
  statusCode: number | null;
  errorCode: string | null;
  targetHost: string;
  requestBytes: number;
  requestSha256: string;
}

export async function insertAttempt(db: Db, tenantId: string, deliveryId: string, attempt: WebhookAttempt): Promise<void> {
  await db.query(
    `insert into webhook_attempts (tenant_id, delivery_id, attempt_no, trigger, started_at, duration_ms, status_code, error_code, target_host, request_bytes, request_sha256)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [tenantId, deliveryId, attempt.attemptNo, attempt.trigger, attempt.startedAt, attempt.durationMs, attempt.statusCode, attempt.errorCode, attempt.targetHost, attempt.requestBytes, attempt.requestSha256],
  );
}

export async function listAttempts(db: Db, tenantId: string, deliveryId: string): Promise<WebhookAttempt[]> {
  const result = await db.query<Row>(
    "select attempt_no, trigger, started_at, duration_ms, status_code, error_code, target_host, request_bytes, request_sha256 from webhook_attempts where tenant_id = $1 and delivery_id = $2 order by attempt_no",
    [tenantId, deliveryId],
  );
  return result.rows.map((row) => ({
    attemptNo: row["attempt_no"],
    trigger: row["trigger"],
    startedAt: row["started_at"],
    durationMs: row["duration_ms"],
    statusCode: row["status_code"],
    errorCode: row["error_code"],
    targetHost: row["target_host"],
    requestBytes: row["request_bytes"],
    requestSha256: row["request_sha256"],
  }));
}

/** 不发了、直接记成最终失败（订阅已删除或暂停）：没有发出请求，不算一次尝试。和记结果一样核对租约令牌，对不上返回 null。 */
export async function abandonDelivery(db: Db, delivery: Pick<WebhookDelivery, "tenantId" | "id" | "leaseToken">, errorCode: string, at: Date): Promise<WebhookDelivery | null> {
  const result = await db.query<Row>(
    `update webhook_deliveries d set status = 'failed', next_attempt_at = null, failed_at = $3, last_error_code = $4, lease_token = null
      where d.tenant_id = $1 and d.id = $2 and d.status = 'pending' and d.lease_token is not distinct from $5::uuid returning ${DELIVERY_COLUMNS}`,
    [delivery.tenantId, delivery.id, at, errorCode, delivery.leaseToken],
  );
  const row = result.rows[0];
  return row === undefined ? null : toDelivery(row);
}
