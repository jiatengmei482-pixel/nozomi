/**
 * 通知中心的接口层业务（M4-08，ADR 0049）：运营后台的发送记录、手动重试；供应商后台的记录、免打扰。
 * 收件人一律打码返回；没有正文，令牌也不落库。
 */
import { type DriverLinkDeliveryMode, type PlatformDataScope, type QuietHours, maskEmail, notificationRetryable, quietHoursIssue, scopeIsRestricted } from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { withPlatformTx, withTenantTx } from "../db/context.ts";
import { AppError } from "../errors.ts";
import { insertAuditLog } from "../repos/audit-logs.ts";
import { type Notification, type NotificationFilter, type TenantNotificationSettings, countFailedEvents, countWaitingNotifications, findNotification, findNotificationSettings, leaseForManualRetry, listNotifications, saveNotificationSettings } from "../repos/notifications.ts";
import { findOrderForPlatform } from "../repos/orders.ts";
import type { Page, TimeCursor } from "../pagination.ts";
import { validationFailed } from "../validation.ts";
import { consoleOrigin, platformActor, tenantActor } from "./audit.ts";
import { notFound, versionConflict } from "./errors.ts";
import { NOTIFICATION_LEASE_MS } from "./notification-jobs.ts";
import { orderInScope } from "./order-queries.ts";
import type { PlatformPrincipal } from "./platform-auth.ts";
import type { TenantPrincipal } from "./tenant-auth.ts";

export function notificationJson(row: Notification): Record<string, unknown> {
  return {
    id: row.id,
    event: row.event,
    audience: row.audience,
    locale: row.locale,
    channel: row.channel,
    recipient: row.recipientUnreadable ? row.recipient : maskEmail(row.recipient),
    order: row.orderId === null ? null : { id: row.orderId, order_no: row.orderNo },
    status: row.status,
    attempts: row.attempts,
    last_error: row.lastErrorCode === null ? null : { code: row.lastErrorCode, message: row.lastErrorMessage },
    retryable: notificationRetryable(row.status, row.lastErrorCode),
    next_attempt_at: row.status === "pending" ? row.nextAttemptAt.toISOString() : null,
    expires_at: row.expiresAt.toISOString(),
    sent_at: row.sentAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

export async function listNotificationsForPlatform(ctx: AppContext, filter: Omit<NotificationFilter, "scope">, scope: PlatformDataScope, limit: number, after: TimeCursor | null): Promise<Page<Notification> & { total: number; waiting: number; failedEvents: number; mailConfigured: boolean }> {
  await ctx.integrations.ensureFresh();
  const mailConfigured = ctx.integrations.effective.email.config !== null;
  return withPlatformTx(
    ctx.pool,
    async (db) => ({ ...(await listNotifications(db, { ...filter, scope }, limit, after)), waiting: scopeIsRestricted(scope) ? 0 : await countWaitingNotifications(db), failedEvents: scopeIsRestricted(scope) ? 0 : await countFailedEvents(db), mailConfigured }),
    { snapshot: true },
  );
}

export async function listNotificationsForTenant(ctx: AppContext, tenantId: string, filter: Pick<NotificationFilter, "status" | "orderId">, limit: number, after: TimeCursor | null): Promise<Page<Notification> & { total: number }> {
  return withTenantTx(ctx.pool, tenantId, (db) => listNotifications(db, { tenantId, audience: "tenant", event: null, orderNo: null, ...filter }, limit, after), { snapshot: true });
}

/** 把一条能重试的记录租下来（调用方马上发一次）。写审计：只有事件、状态、错误码，没有收件人。 */
export async function leaseNotificationForRetry(ctx: AppContext, principal: PlatformPrincipal, ip: string, id: string): Promise<Notification> {
  await ctx.integrations.ensureFresh();
  if (ctx.integrations.effective.email.config === null) throw new AppError(409, "MAIL_NOT_CONFIGURED", "邮件发送还没有配置，请超级管理员在「系统设置 → 系统状态」填写；配好后等待中的通知会自动发送");
  const now = ctx.now();
  return withPlatformTx(ctx.pool, async (db) => {
    const found = await findNotification(db, id, { lock: true });
    if (found === null) throw notFound("通知");
    if (scopeIsRestricted(principal.grant.scope)) {
      const order = found.orderId === null ? null : await findOrderForPlatform(db, found.orderId);
      if (order === null || !(await orderInScope(db, order, principal.grant.scope))) throw notFound("通知");
    }
    if (!notificationRetryable(found.status, found.lastErrorCode)) throw new AppError(409, "NOTIFICATION_NOT_RETRYABLE", "这条通知现在不能重试：只有失败的、过了有效期的可以", { status: found.status, code: found.lastErrorCode });
    await insertAuditLog(db, consoleOrigin(platformActor(principal.user), ip, now), {
      tenantId: null,
      resource: "notification",
      resourceId: id,
      action: "retry",
      before: { event: found.event, audience: found.audience, status: found.status, attempts: found.attempts, last_error_code: found.lastErrorCode, order_id: found.orderId },
      after: null,
    });
    return leaseForManualRetry(db, id, now, new Date(now.getTime() + NOTIFICATION_LEASE_MS));
  });
}

export async function getNotificationSettings(ctx: AppContext, tenantId: string): Promise<TenantNotificationSettings> {
  return withTenantTx(ctx.pool, tenantId, (db) => findNotificationSettings(db, tenantId), { snapshot: true });
}

/** 改免打扰和司机链接发送方式（不给 = 不改）。第一次新建不用带版本（0）；之后带 `If-Match`。 */
export async function updateNotificationSettings(ctx: AppContext, principal: TenantPrincipal, ip: string, quietHours: QuietHours | null, driverLinkDelivery: DriverLinkDeliveryMode | undefined, version: number | null): Promise<TenantNotificationSettings> {
  if (quietHours !== null) {
    const issue = quietHoursIssue(quietHours);
    if (issue !== null) throw validationFailed("body", [{ path: "/quiet_hours", reason: issue, message: issue === "SAME_TIME" ? "开始和结束不能是同一个时间" : "时间要写成 HH:mm" }]);
  }
  const { tenantId } = principal;
  const now = ctx.now();
  return withTenantTx(ctx.pool, tenantId, async (db) => {
    const before = await findNotificationSettings(db, tenantId);
    if ((version ?? 0) !== before.version) throw versionConflict(before.version);
    const saved = await saveNotificationSettings(db, tenantId, quietHours, driverLinkDelivery ?? before.driverLinkDelivery, before.version, now);
    if (saved === null) throw versionConflict(before.version);
    await insertAuditLog(db, consoleOrigin(tenantActor(principal.user), ip, now), { tenantId, resource: "notification_settings", resourceId: tenantId, action: "update", before: { quiet_hours: before.quietHours as never, driver_link_delivery: before.driverLinkDelivery }, after: { quiet_hours: saved.quietHours as never, driver_link_delivery: saved.driverLinkDelivery } });
    return saved;
  });
}
