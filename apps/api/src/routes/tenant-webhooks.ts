/**
 * 推送给供应商的 Webhook（M3-02，ADR 0027）。这里只做鉴权、校验、调用、返回。
 *
 * 供应商（`/tenant/v1/webhooks…`）：看设置和投递记录 `webhook.read`（管理员、调度、只读）；设置、换签名密钥、删除、发送测试事件、手动重推 `webhook.manage`（管理员）。
 * 签名密钥只在新建设置和换密钥的那一次应答里出现（`secret`），之后只显示末 4 位。
 * 运营后台（`/platform/v1/webhook-deliveries…`）：跨供应商看投递记录（`order.read`），手动重推（`order.resend`：运营、客服）。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { TENANT_WEBHOOK_EVENTS, TENANT_WEBHOOK_EVENT_NAMES, type TenantAction, WEBHOOK_MAX_ATTEMPTS, WEBHOOK_RULES } from "@nozomi/domain";
import { bearerToken } from "../auth/token.ts";
import type { AppContext } from "../context.ts";
import { decodeTimeCursor } from "../pagination.ts";
import type { TenantWebhook, WebhookAttempt } from "../repos/webhooks.ts";
import { authenticatePlatform } from "../services/platform-auth.ts";
import {
  getDeliveryForPlatform,
  getTenantDelivery,
  getTenantWebhook,
  listDeliveriesForPlatform,
  listTenantDeliveries,
  removeTenantWebhook,
  retryDeliveryForPlatform,
  retryTenantDelivery,
  rotateWebhookSecret,
  saveTenantWebhook,
  sendTestEvent,
} from "../services/tenant-webhooks.ts";
import { authenticateTenant } from "../services/tenant-auth.ts";
import { ifMatchVersion, pageQuerySchema, parseInput, resourceId, uuidSchema } from "../validation.ts";
import { deliveryJson } from "./orders.ts";

const settingsSchema = z
  .object({
    url: z.string().max(WEBHOOK_RULES.maxUrlLength + 100),
    events: z.array(z.enum(TENANT_WEBHOOK_EVENTS)).min(1).max(TENANT_WEBHOOK_EVENTS.length),
    status: z.enum(["active", "paused"]).default("active"),
  })
  .strict();

const deliveryListSchema = pageQuerySchema.extend({ status: z.enum(["pending", "succeeded", "failed"]).optional(), order_id: uuidSchema.transform((value) => value.toLowerCase()).optional() });
const platformDeliveryListSchema = deliveryListSchema.extend({ tenant_id: uuidSchema.transform((value) => value.toLowerCase()).optional() });

function webhookJson(webhook: TenantWebhook): Record<string, unknown> {
  return {
    url: webhook.url,
    events: webhook.events,
    status: webhook.status,
    secret_hint: webhook.secretHint,
    secret_created_at: webhook.secretCreatedAt.toISOString(),
    version: webhook.version,
    created_at: webhook.createdAt.toISOString(),
    updated_at: webhook.updatedAt.toISOString(),
  };
}

function attemptJson(attempt: WebhookAttempt): Record<string, unknown> {
  return {
    attempt_no: attempt.attemptNo,
    trigger: attempt.trigger,
    started_at: attempt.startedAt.toISOString(),
    duration_ms: attempt.durationMs,
    status_code: attempt.statusCode,
    error_code: attempt.errorCode,
    target_host: attempt.targetHost,
    request_bytes: attempt.requestBytes,
    request_sha256: attempt.requestSha256,
  };
}

/** 推送的规则（后台页面上说明给供应商看）。 */
const RULES_JSON = {
  timeout_ms: WEBHOOK_RULES.timeoutMs,
  max_attempts: WEBHOOK_MAX_ATTEMPTS,
  retry_delays_seconds: [...WEBHOOK_RULES.retryDelaysSeconds],
  signature_tolerance_seconds: WEBHOOK_RULES.signatureToleranceSeconds,
};

/** 版本号：已经有设置时修改必须带 If-Match；第一次新建不用带。 */
function optionalVersion(header: unknown): number | null {
  return header === undefined ? null : ifMatchVersion(header);
}

export function registerTenantWebhookRoutes(app: FastifyInstance, ctx: AppContext): void {
  const tenant = (request: FastifyRequest, action: TenantAction) => authenticateTenant(ctx, bearerToken(request.headers.authorization), { action });

  app.get("/tenant/v1/webhooks", async (request) => {
    const principal = await tenant(request, "webhook.read");
    const webhook = await getTenantWebhook(ctx, principal.tenantId);
    return {
      webhook: webhook === null ? null : webhookJson(webhook),
      encryption_configured: ctx.secretBox !== null,
      events: TENANT_WEBHOOK_EVENTS.map((event) => ({ event, name: TENANT_WEBHOOK_EVENT_NAMES[event] })),
      rules: RULES_JSON,
    };
  });

  app.put("/tenant/v1/webhooks", async (request, reply) => {
    const principal = await tenant(request, "webhook.manage");
    const input = parseInput(settingsSchema, request.body, "body");
    const saved = await saveTenantWebhook(ctx, { principal, ip: request.ip }, optionalVersion(request.headers["if-match"]), input);
    return reply.code(saved.created ? 201 : 200).send({ webhook: webhookJson(saved.webhook), secret: saved.secret });
  });

  app.delete("/tenant/v1/webhooks", async (request, reply) => {
    const principal = await tenant(request, "webhook.manage");
    await removeTenantWebhook(ctx, { principal, ip: request.ip });
    return reply.code(204).send();
  });

  app.post("/tenant/v1/webhooks/rotate-secret", async (request) => {
    const principal = await tenant(request, "webhook.manage");
    const rotated = await rotateWebhookSecret(ctx, { principal, ip: request.ip });
    return { webhook: webhookJson(rotated.webhook), secret: rotated.secret };
  });

  app.post("/tenant/v1/webhooks/test", async (request) => {
    const principal = await tenant(request, "webhook.manage");
    const sent = await sendTestEvent(ctx, { principal, ip: request.ip });
    return { delivery: deliveryJson(sent.delivery), attempt: attemptJson(sent.attempt) };
  });

  app.get("/tenant/v1/webhooks/deliveries", async (request) => {
    const principal = await tenant(request, "webhook.read");
    const query = parseInput(deliveryListSchema, request.query, "querystring");
    const page = await listTenantDeliveries(ctx, principal.tenantId, { status: query.status ?? null, orderId: query.order_id ?? null }, query.limit, decodeTimeCursor(query.cursor ?? null));
    return { items: page.items.map(deliveryJson), next_cursor: page.nextCursor, total: page.total };
  });

  app.get("/tenant/v1/webhooks/deliveries/:id", async (request) => {
    const principal = await tenant(request, "webhook.read");
    const found = await getTenantDelivery(ctx, principal.tenantId, resourceId(request.params, "投递记录"));
    return { delivery: deliveryJson(found.delivery), attempts: found.attempts.map(attemptJson) };
  });

  app.post("/tenant/v1/webhooks/deliveries/:id/retry", async (request) => {
    const principal = await tenant(request, "webhook.manage");
    const rescheduled = await retryTenantDelivery(ctx, { principal, ip: request.ip }, resourceId(request.params, "投递记录"));
    return { delivery: deliveryJson(await app.webhookJobs.deliverNow(rescheduled.tenantId, rescheduled.id)) };
  });

  app.get("/platform/v1/webhook-deliveries", async (request) => {
    await authenticatePlatform(ctx, bearerToken(request.headers.authorization), { action: "order.read" });
    const query = parseInput(platformDeliveryListSchema, request.query, "querystring");
    const page = await listDeliveriesForPlatform(ctx, { tenantId: query.tenant_id ?? null, status: query.status ?? null, orderId: query.order_id ?? null }, query.limit, decodeTimeCursor(query.cursor ?? null));
    return { items: page.items.map((item) => ({ ...deliveryJson(item), tenant: { id: item.tenantId, name: item.tenantName } })), next_cursor: page.nextCursor, total: page.total };
  });

  app.get("/platform/v1/webhook-deliveries/:id", async (request) => {
    await authenticatePlatform(ctx, bearerToken(request.headers.authorization), { action: "order.read" });
    const found = await getDeliveryForPlatform(ctx, resourceId(request.params, "投递记录"));
    return { delivery: { ...deliveryJson(found.delivery), tenant_id: found.delivery.tenantId }, attempts: found.attempts.map(attemptJson) };
  });

  app.post("/platform/v1/webhook-deliveries/:id/retry", async (request) => {
    const principal = await authenticatePlatform(ctx, bearerToken(request.headers.authorization), { action: "order.resend" });
    const rescheduled = await retryDeliveryForPlatform(ctx, principal, request.ip, resourceId(request.params, "投递记录"));
    return { delivery: deliveryJson(await app.webhookJobs.deliverNow(rescheduled.tenantId, rescheduled.id)) };
  });
}
