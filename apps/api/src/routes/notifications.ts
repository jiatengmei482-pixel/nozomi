/**
 * 通知中心（M4-08，ADR 0049）。
 * 运营后台：发送记录（`notification.read`）、手动重试（`notification.retry`，写审计）、只读看模板。
 * 供应商后台：发给自己这家的记录（`notification.read`）、免打扰（改：`notification.manage`）；`tenant_id` 只从登录令牌取。
 */
import { maskOrderValues } from "@nozomi/domain";
import { orderPassengerNames } from "../services/passenger-privacy.ts";
import { NOTIFICATION_AUDIENCES, NOTIFICATION_EVENTS, NOTIFICATION_STATUSES, NOTIFICATION_TEMPLATES, TENANT_RULES, templatePlaceholders } from "@nozomi/domain";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.ts";
import { decodeTimeCursor } from "../pagination.ts";
import { bearerToken } from "../auth/token.ts";
import { leaseNotificationForRetry, listNotificationsForPlatform, listNotificationsForTenant, getNotificationSettings, notificationJson, updateNotificationSettings } from "../services/notifications.ts";
import { authenticatePlatform, platformCredentials } from "../services/platform-auth.ts";
import { authenticateTenant } from "../services/tenant-auth.ts";
import { ifMatchVersion, pageQuerySchema, parseInput, resourceId, uuidSchema } from "../validation.ts";

const orderId = uuidSchema.transform((value) => value.toLowerCase()).optional();

const platformListSchema = pageQuerySchema.extend({
  status: z.enum(NOTIFICATION_STATUSES).optional(),
  event: z.enum(NOTIFICATION_EVENTS).optional(),
  audience: z.enum(NOTIFICATION_AUDIENCES).optional(),
  order_id: orderId,
  order_no: z.string().trim().max(32).transform((value) => value.toUpperCase()).optional(),
});

const tenantListSchema = pageQuerySchema.extend({ status: z.enum(NOTIFICATION_STATUSES).optional(), order_id: orderId });

const settingsSchema = z.object({ quiet_hours: z.object({ start: z.string().max(5), end: z.string().max(5) }).strict().nullable() }).strict();

const settingsJson = (settings: { quietHours: { start: string; end: string } | null; version: number }): Record<string, unknown> => ({ quiet_hours: settings.quietHours, time_zone: TENANT_RULES.timeZone, version: settings.version });

export function registerNotificationRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/platform/v1/notifications", async (request) => {
    const principal = await authenticatePlatform(ctx, platformCredentials(request), { action: "notification.read" });
    const query = parseInput(platformListSchema, request.query, "querystring");
    const page = await listNotificationsForPlatform(
      ctx,
      { tenantId: null, status: query.status ?? null, event: query.event ?? null, audience: query.audience ?? null, orderId: query.order_id ?? null, orderNo: query.order_no === undefined || query.order_no === "" ? null : query.order_no },
      principal.grant.scope,
      query.limit,
      decodeTimeCursor(query.cursor ?? null),
    );
    // 邮件服务器的拒收信息会带地址和姓名（ADR 0055）
    const names = await orderPassengerNames(ctx, page.items.flatMap((row) => row.orderId ?? []));
    return { items: page.items.map((row) => maskOrderValues(notificationJson(row), row.orderId === null ? null : (names.get(row.orderId) ?? null))), next_cursor: page.nextCursor, total: page.total, summary: { mail_configured: page.mailConfigured, waiting: page.waiting, failed_events: page.failedEvents } };
  });

  app.post("/platform/v1/notifications/:id/retry", async (request) => {
    const principal = await authenticatePlatform(ctx, platformCredentials(request), { action: "notification.retry" });
    const leased = await leaseNotificationForRetry(ctx, principal, request.ip, resourceId(request.params, "通知"));
    const delivered = await app.notificationJobs.deliverNow(leased);
    return { notification: maskOrderValues(notificationJson(delivered), delivered.orderId === null ? null : ((await orderPassengerNames(ctx, [delivered.orderId])).get(delivered.orderId) ?? null)) };
  });

  app.get("/platform/v1/notification-templates", async (request) => {
    await authenticatePlatform(ctx, platformCredentials(request), { action: "notification.read" });
    return { items: NOTIFICATION_TEMPLATES.map((template) => ({ event: template.event, audience: template.audience, locale: template.locale, channel: template.channel, subject: template.subject, body: template.body, variables: templatePlaceholders(template) })) };
  });

  app.get("/tenant/v1/notifications", async (request) => {
    const principal = await authenticateTenant(ctx, bearerToken(request.headers.authorization), { action: "notification.read" });
    const query = parseInput(tenantListSchema, request.query, "querystring");
    const page = await listNotificationsForTenant(ctx, principal.tenantId, { status: query.status ?? null, orderId: query.order_id ?? null }, query.limit, decodeTimeCursor(query.cursor ?? null));
    return { items: page.items.map(notificationJson), next_cursor: page.nextCursor, total: page.total };
  });

  app.get("/tenant/v1/notification-settings", async (request) => {
    const principal = await authenticateTenant(ctx, bearerToken(request.headers.authorization), { action: "notification.read" });
    return settingsJson(await getNotificationSettings(ctx, principal.tenantId));
  });

  app.put("/tenant/v1/notification-settings", async (request) => {
    const principal = await authenticateTenant(ctx, bearerToken(request.headers.authorization), { action: "notification.manage" });
    const body = parseInput(settingsSchema, request.body, "body");
    const header = request.headers["if-match"];
    return settingsJson(await updateNotificationSettings(ctx, principal, request.ip, body.quiet_hours, header === undefined ? null : ifMatchVersion(header)));
  });
}
