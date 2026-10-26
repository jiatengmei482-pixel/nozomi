/**
 * 推送给供应商（租户 Webhook，M3-02，ADR 0027）：订阅的设置、签名密钥、排队、请求体、测试事件、投递记录、手动重推。
 * 真正的投递和失败重试在 services/webhook-jobs.ts；发出请求（防 SSRF）在 integrations/webhook-sender.ts。
 *
 * - 供应商自己设置接收地址和订阅的事件（`webhook.manage`：管理员）。签名密钥由平台生成，**只在生成的那一次应答里出现**；
 *   库里存 AES-256-GCM 加密后的密文（推送时要用原文算签名，不能只存哈希），没配置 `DATA_ENCRYPTION_KEY` 时不能设置（503）。
 * - 事件在改订单的同一个事务里排队（付款确认、派车、履约回传）：事务回滚就不会有推送，事务提交了推送一定在队列里。
 *   供应商没设置、暂停了、没订阅这个事件的，不排队。
 * - 请求体在发送时按订单的**当前内容**现生成（库里不存请求体：里面有乘客的姓名和电话）；`event_id` 不变，接收方用它去重。
 *   请求体就是供应商后台订单接口里的那份订单（services/order-views.ts），没有对外价和加价比例（规则 4）。
 */
import { createHash, randomBytes } from "node:crypto";
import { TENANT_WEBHOOK_EVENTS, type TenantWebhookEvent, WEBHOOK_TEST_EVENT, type WebhookEventType, webhookUrlIssue } from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { type Db, withPlatformTx, withTenantTx } from "../db/context.ts";
import { AppError } from "../errors.ts";
import { SecretBoxError } from "../integrations/secret-box.ts";
import type { WebhookResult } from "../integrations/webhook-sender.ts";
import { webhookSignature } from "../integrations/webhook-signature.ts";
import type { Page, TimeCursor } from "../pagination.ts";
import { type AuditValues, insertAuditLog } from "../repos/audit-logs.ts";
import { findDriversByIds, findVehiclesByIds } from "../repos/fleet.ts";
import { findOrderOfTenant } from "../repos/orders.ts";
import {
  type DeliveryFilter,
  type TenantWebhook,
  type WebhookAttempt,
  type WebhookDelivery,
  deleteTenantWebhook as deleteWebhookRow,
  findDelivery,
  findTenantWebhook,
  finishDeliveryAttempt,
  insertAttempt,
  insertDelivery,
  insertTenantWebhook,
  listAttempts,
  listDeliveries,
  deliveryLeased,
  rescheduleDelivery,
  updateTenantWebhook,
} from "../repos/webhooks.ts";
import { validationFailed } from "../validation.ts";
import { consoleOrigin, platformActor, tenantActor } from "./audit.ts";
import { notFound, versionConflict, versionRequired } from "./errors.ts";
import { tenantOrderJson } from "./order-views.ts";
import type { PlatformPrincipal } from "./platform-auth.ts";
import type { TenantPrincipal } from "./tenant-auth.ts";

export interface WebhookWriter {
  principal: TenantPrincipal;
  ip: string;
}

export function webhookEncryptionNotConfigured(): AppError {
  return new AppError(503, "WEBHOOK_ENCRYPTION_NOT_CONFIGURED", "平台还没有配置数据加密密钥（DATA_ENCRYPTION_KEY），现在不能设置 Webhook。请联系平台");
}

function requireBox(ctx: AppContext): NonNullable<AppContext["secretBox"]> {
  if (ctx.secretBox === null) throw webhookEncryptionNotConfigured();
  return ctx.secretBox;
}

/** 新的签名密钥：`nzwh_` + 32 字节随机数（base64url）。 */
function newSecret(): string {
  return `nzwh_${randomBytes(32).toString("base64url")}`;
}

const URL_MESSAGES: Readonly<Record<NonNullable<ReturnType<typeof webhookUrlIssue>>, string>> = {
  INVALID_URL: "不是合法的网址",
  TOO_LONG: "网址太长了（最多 2048 个字符）",
  NOT_HTTPS: "只接受 https:// 开头的地址",
  HAS_CREDENTIALS: "网址里不能带账号和密码",
  HAS_FRAGMENT: "网址里不能带 #",
  FORBIDDEN_HOST: "不能推送到内网、本机或云服务器的元数据地址，请填公网可以访问的地址",
};

export interface WebhookSettingsInput {
  url: string;
  events: TenantWebhookEvent[];
  status: "active" | "paused";
}

function checkSettings(input: WebhookSettingsInput): WebhookSettingsInput {
  const url = input.url.trim();
  const issue = webhookUrlIssue(url);
  if (issue !== null) throw validationFailed("body", [{ path: "/url", reason: issue, message: URL_MESSAGES[issue] }]);
  const events = TENANT_WEBHOOK_EVENTS.filter((event) => input.events.includes(event));
  return { url, events, status: input.status };
}

function webhookAudit(webhook: Pick<TenantWebhook, "url" | "events" | "status" | "secretHint">): AuditValues {
  return { url: webhook.url, events: webhook.events, status: webhook.status, secret_hint: webhook.secretHint };
}

function audit(db: Db, writer: WebhookWriter, now: Date, action: "create" | "update" | "rotate" | "delete" | "test", before: AuditValues | null, after: AuditValues | null): Promise<void> {
  return insertAuditLog(db, consoleOrigin(tenantActor(writer.principal.user), writer.ip, now), { tenantId: writer.principal.tenantId, resource: "tenant_webhook", resourceId: writer.principal.tenantId, action, before, after });
}

export async function getTenantWebhook(ctx: AppContext, tenantId: string): Promise<TenantWebhook | null> {
  return withTenantTx(ctx.pool, tenantId, (db) => findTenantWebhook(db, tenantId));
}

/**
 * 保存设置：还没有就新建（同时生成签名密钥，原文只在这次返回）；已有就修改（必须带 If-Match 版本号）。
 * 返回设置和新生成的密钥（修改时为 null）。
 */
export async function saveTenantWebhook(ctx: AppContext, writer: WebhookWriter, version: number | null, input: WebhookSettingsInput): Promise<{ webhook: TenantWebhook; secret: string | null; created: boolean }> {
  const box = requireBox(ctx);
  const settings = checkSettings(input);
  const tenantId = writer.principal.tenantId;
  const now = ctx.now();
  return withTenantTx(ctx.pool, tenantId, async (db) => {
    const current = await findTenantWebhook(db, tenantId, { lock: true });
    if (current === null) {
      const secret = newSecret();
      const webhook = await insertTenantWebhook(db, {
        tenantId,
        ...settings,
        secretCiphertext: box.seal("tenant-webhook-secret", tenantId, secret),
        secretHint: secret.slice(-4),
        secretCreatedAt: now,
        createdAt: now,
      });
      await audit(db, writer, now, "create", null, webhookAudit(webhook));
      return { webhook, secret, created: true };
    }
    if (version === null) throw versionRequired();
    if (current.version !== version) throw versionConflict(current.version);
    if (current.url === settings.url && current.status === settings.status && current.events.join(",") === settings.events.join(",")) return { webhook: current, secret: null, created: false };
    const webhook = await updateTenantWebhook(db, tenantId, settings, now);
    await audit(db, writer, now, "update", webhookAudit(current), webhookAudit(webhook));
    return { webhook, secret: null, created: false };
  });
}

/** 换一把新的签名密钥：旧的立即作废（之后的推送都用新的签）。原文只在这次返回。 */
export async function rotateWebhookSecret(ctx: AppContext, writer: WebhookWriter): Promise<{ webhook: TenantWebhook; secret: string }> {
  const box = requireBox(ctx);
  const tenantId = writer.principal.tenantId;
  const now = ctx.now();
  return withTenantTx(ctx.pool, tenantId, async (db) => {
    const current = await findTenantWebhook(db, tenantId, { lock: true });
    if (current === null) throw notFound("Webhook 设置");
    const secret = newSecret();
    const webhook = await updateTenantWebhook(db, tenantId, { url: current.url, events: current.events, status: current.status, secret: { ciphertext: box.seal("tenant-webhook-secret", tenantId, secret), hint: secret.slice(-4), createdAt: now } }, now);
    await audit(db, writer, now, "rotate", webhookAudit(current), webhookAudit(webhook));
    return { webhook, secret };
  });
}

/** 删除设置：之后的事件不再排队；已经在排队的，推送任务取到时直接记为失败（`WEBHOOK_NOT_CONFIGURED`）。 */
export async function removeTenantWebhook(ctx: AppContext, writer: WebhookWriter): Promise<void> {
  const tenantId = writer.principal.tenantId;
  const now = ctx.now();
  await withTenantTx(ctx.pool, tenantId, async (db) => {
    const current = await findTenantWebhook(db, tenantId, { lock: true });
    if (current === null) throw notFound("Webhook 设置");
    await deleteWebhookRow(db, tenantId);
    await audit(db, writer, now, "delete", webhookAudit(current), null);
  });
}

/** 事件编号：`evt_` + 24 位小写字母和数字。 */
export function newEventId(): string {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  const bytes = randomBytes(24);
  return `evt_${[...bytes].map((byte) => alphabet[byte % alphabet.length]).join("")}`;
}

/**
 * 在当前事务里给供应商排一条推送（付款确认是平台事务，派车、履约回传是租户事务）。没设置、暂停、没订阅的不排。返回有没有排上。
 * `data` 是事件自己的少量信息（改派的 change、状态从什么到什么），不能放乘客信息和金额。
 */
export async function enqueueTenantEvent(db: Db, event: { tenantId: string; type: TenantWebhookEvent; orderId: string | null; data: Record<string, unknown> }, now: Date): Promise<boolean> {
  const webhook = await findTenantWebhook(db, event.tenantId);
  if (webhook === null || webhook.status !== "active" || !webhook.events.includes(event.type)) return false;
  await insertDelivery(db, { tenantId: event.tenantId, eventId: newEventId(), eventType: event.type, orderId: event.orderId, eventData: event.data, status: "pending", nextAttemptAt: now, createdAt: now });
  return true;
}

/** 请求体：事件编号、类型、时间、供应商编号和数据（订单的当前内容 + 事件自己的信息）。 */
export async function deliveryBody(db: Db, delivery: Pick<WebhookDelivery, "tenantId" | "eventId" | "eventType" | "orderId" | "eventData" | "createdAt">, now: Date): Promise<string> {
  let data: Record<string, unknown> = { ...delivery.eventData };
  if (delivery.eventType === WEBHOOK_TEST_EVENT) data = { message: "这是一条测试事件，用来确认接收地址和签名校验是否正常", ...data };
  if (delivery.orderId !== null) {
    // 这个供应商自己的那一行（救援改派后原供应商的行已转出，发给它的「已转给救援供应商」仍带它看到的订单，ADR 0031）
    const order = await findOrderOfTenant(db, delivery.tenantId, delivery.orderId);
    if (order !== null) {
      const driver = order.dispatch.driverId === null ? null : ((await findDriversByIds(db, order.tenantId, [order.dispatch.driverId])).get(order.dispatch.driverId) ?? null);
      const vehicle = order.dispatch.vehicleId === null ? null : ((await findVehiclesByIds(db, order.tenantId, [order.dispatch.vehicleId])).get(order.dispatch.vehicleId) ?? null);
      data = { ...data, order: tenantOrderJson(order, { driver, vehicle }, now) };
    }
  }
  return JSON.stringify({ event_id: delivery.eventId, type: delivery.eventType, created_at: delivery.createdAt.toISOString(), tenant_id: delivery.tenantId, data });
}

export interface SignedRequest {
  url: string;
  body: string;
  headers: Record<string, string>;
}

/** 签好名的请求：`X-Timestamp`、`X-Signature`（v1=HMAC-SHA256(密钥, 时间戳.请求体)）、`X-Event-Id`、`X-Event-Type`、`X-Delivery-Attempt`。密钥解不开抛 `SecretBoxError`。 */
export function signedRequest(ctx: AppContext, webhook: TenantWebhook, delivery: Pick<WebhookDelivery, "eventId" | "eventType">, body: string, attemptNo: number, now: Date): SignedRequest {
  if (ctx.secretBox === null) throw new SecretBoxError();
  const secret = ctx.secretBox.open("tenant-webhook-secret", webhook.tenantId, webhook.secretCiphertext);
  const timestamp = Math.floor(now.getTime() / 1000);
  return {
    url: webhook.url,
    body,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "user-agent": "NOZOMI-Webhook/1.0",
      "x-event-id": delivery.eventId,
      "x-event-type": delivery.eventType,
      "x-timestamp": String(timestamp),
      "x-signature": webhookSignature(secret, timestamp, body),
      "x-delivery-attempt": String(attemptNo),
    },
  };
}

export function attemptRecord(result: { statusCode: number | null; errorCode: string | null; durationMs: number; targetHost: string }, request: SignedRequest | null, attemptNo: number, trigger: WebhookAttempt["trigger"], startedAt: Date): WebhookAttempt {
  const body = request?.body ?? "";
  return {
    attemptNo,
    trigger,
    startedAt,
    durationMs: result.durationMs,
    statusCode: result.statusCode,
    errorCode: result.errorCode,
    targetHost: result.targetHost,
    requestBytes: Buffer.byteLength(body, "utf8"),
    requestSha256: createHash("sha256").update(body, "utf8").digest("hex"),
  };
}

/**
 * 发送测试事件（`POST /webhooks/test`）：马上发一条 `webhook.test`，结果直接返回，并记一条投递（不重试）。
 * 用来确认地址通不通、签名对不对。
 */
export async function sendTestEvent(ctx: AppContext, writer: WebhookWriter): Promise<{ delivery: WebhookDelivery; attempt: WebhookAttempt }> {
  requireBox(ctx);
  const tenantId = writer.principal.tenantId;
  const now = ctx.now();
  const prepared = await withTenantTx(ctx.pool, tenantId, async (db) => {
    const webhook = await findTenantWebhook(db, tenantId);
    if (webhook === null) throw notFound("Webhook 设置");
    const draft = { tenantId, eventId: newEventId(), eventType: WEBHOOK_TEST_EVENT as WebhookEventType, orderId: null, eventData: {}, createdAt: now };
    return { webhook, draft, body: await deliveryBody(db, draft, now) };
  });
  let request: SignedRequest | null = null;
  let result: WebhookResult;
  try {
    request = signedRequest(ctx, prepared.webhook, prepared.draft, prepared.body, 1, now);
    result = await ctx.webhookSender.send(request);
  } catch (err) {
    if (!(err instanceof SecretBoxError)) throw err;
    result = { statusCode: null, errorCode: null, durationMs: 0, targetHost: new URL(prepared.webhook.url).host };
  }
  const secretUnavailable = request === null;
  const finishedAt = ctx.now();
  return withTenantTx(ctx.pool, tenantId, async (db) => {
    const ok = !secretUnavailable && result.errorCode === null;
    // 先以「等待」插入（同一个事务里，推送任务看不到），记完这次的结果再定成成功 / 失败：不进重试队列
    const delivery = await insertDelivery(db, { ...prepared.draft, status: "pending", nextAttemptAt: now });
    const outcome = { ...result, errorCode: secretUnavailable ? "WEBHOOK_SECRET_UNAVAILABLE" : result.errorCode };
    const attempt = attemptRecord(outcome, request, 1, "test", now);
    await insertAttempt(db, tenantId, delivery.id, attempt);
    const finished = await finishDeliveryAttempt(db, delivery, { statusCode: outcome.statusCode, errorCode: outcome.errorCode, durationMs: outcome.durationMs, at: finishedAt }, { status: ok ? "succeeded" : "failed", nextAttemptAt: null });
    await audit(db, writer, finishedAt, "test", null, { event_id: delivery.eventId, status_code: outcome.statusCode, error_code: outcome.errorCode });
    // 刚插入的这一条没有租约令牌，同一个事务里别人碰不到，一定记得上
    if (finished === null) throw new Error("测试事件的投递记录没有记上结果");
    return { delivery: finished, attempt };
  });
}

export async function listTenantDeliveries(ctx: AppContext, tenantId: string, filter: Omit<DeliveryFilter, "tenantId">, limit: number, after: TimeCursor | null): Promise<Page<WebhookDelivery> & { total: number }> {
  return withTenantTx(ctx.pool, tenantId, (db) => listDeliveries(db, { ...filter, tenantId }, limit, after), { snapshot: true });
}

export async function getTenantDelivery(ctx: AppContext, tenantId: string, id: string): Promise<{ delivery: WebhookDelivery; attempts: WebhookAttempt[] }> {
  return withTenantTx(
    ctx.pool,
    tenantId,
    async (db) => {
      const delivery = await findDelivery(db, tenantId, id);
      if (delivery === null) throw notFound("投递记录");
      return { delivery, attempts: await listAttempts(db, tenantId, id) };
    },
    { snapshot: true },
  );
}

export function deliveryAlreadySucceeded(): AppError {
  return new AppError(409, "WEBHOOK_DELIVERY_SUCCEEDED", "这条推送已经成功，不需要重推");
}

/**
 * 把一条推送改回「马上投」：最终失败的、等待重试的都可以；已成功的不行；测试事件不能重推（再发一次测试就行）。
 * 推送任务正在发（租约中）的什么都不做（`inFlight`）：不改时间、不收回租约、不记审计，发完的结果在推送记录里。
 */
async function reschedule(db: Db, tenantId: string, id: string, now: Date): Promise<{ before: WebhookDelivery; after: WebhookDelivery; inFlight: boolean }> {
  const delivery = await findDelivery(db, tenantId, id, { lock: true });
  if (delivery === null) throw notFound("投递记录");
  if (delivery.status === "succeeded") throw deliveryAlreadySucceeded();
  if (delivery.eventType === WEBHOOK_TEST_EVENT) throw new AppError(409, "WEBHOOK_TEST_NOT_RETRIABLE", "测试事件不能重推，请重新发送测试事件");
  if (deliveryLeased(delivery, now)) return { before: delivery, after: delivery, inFlight: true };
  return { before: delivery, after: await rescheduleDelivery(db, delivery, now), inFlight: false };
}

const retryAudit = (before: WebhookDelivery): AuditValues => ({ event_id: before.eventId, event_type: before.eventType, status: before.status, attempts: before.attempts, last_error_code: before.lastErrorCode });

/** 手动重推改回「马上投」之后的结果：`inFlight` 时推送任务正在发，调用方不再投。 */
export interface RetryScheduled {
  delivery: WebhookDelivery;
  inFlight: boolean;
}

/** 供应商手动重推（`webhook.manage`）。改回「马上投」后由调用方立即投递一次。 */
export async function retryTenantDelivery(ctx: AppContext, writer: WebhookWriter, id: string): Promise<RetryScheduled> {
  const tenantId = writer.principal.tenantId;
  const now = ctx.now();
  return withTenantTx(ctx.pool, tenantId, async (db) => {
    const { before, after, inFlight } = await reschedule(db, tenantId, id, now);
    if (inFlight) return { delivery: after, inFlight };
    await insertAuditLog(db, consoleOrigin(tenantActor(writer.principal.user), writer.ip, now), { tenantId, resource: "webhook_delivery", resourceId: id, action: "retry", before: retryAudit(before), after: null });
    return { delivery: after, inFlight };
  });
}

/** 运营后台手动重推（`order.resend`）：跨租户找到这条投递。和供应商的重推同一条路径。 */
export async function retryDeliveryForPlatform(ctx: AppContext, principal: PlatformPrincipal, ip: string, id: string): Promise<RetryScheduled> {
  const now = ctx.now();
  return withPlatformTx(ctx.pool, async (db) => {
    const found = await findDelivery(db, null, id);
    if (found === null) throw notFound("投递记录");
    const { before, after, inFlight } = await reschedule(db, found.tenantId, id, now);
    if (inFlight) return { delivery: after, inFlight };
    await insertAuditLog(db, consoleOrigin(platformActor(principal.user), ip, now), { tenantId: found.tenantId, resource: "webhook_delivery", resourceId: id, action: "retry", before: retryAudit(before), after: null });
    return { delivery: after, inFlight };
  });
}

export async function listDeliveriesForPlatform(ctx: AppContext, filter: DeliveryFilter, limit: number, after: TimeCursor | null): Promise<Page<WebhookDelivery & { tenantName: string }> & { total: number }> {
  return withPlatformTx(
    ctx.pool,
    async (db) => {
      const page = await listDeliveries(db, filter, limit, after);
      const names = new Map((await db.query<{ id: string; name: string }>("select id, name from tenants where id = any($1::uuid[])", [[...new Set(page.items.map((item) => item.tenantId))]])).rows.map((row) => [row.id, row.name]));
      return { ...page, items: page.items.map((item) => ({ ...item, tenantName: names.get(item.tenantId) ?? "" })) };
    },
    { snapshot: true },
  );
}

export async function getDeliveryForPlatform(ctx: AppContext, id: string): Promise<{ delivery: WebhookDelivery; attempts: WebhookAttempt[] }> {
  return withPlatformTx(
    ctx.pool,
    async (db) => {
      const delivery = await findDelivery(db, null, id);
      if (delivery === null) throw notFound("投递记录");
      return { delivery, attempts: await listAttempts(db, delivery.tenantId, id) };
    },
    { snapshot: true },
  );
}
