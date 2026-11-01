/** 通知中心页面上的显示（M4-08，ADR 0049）。「已发送」只表示邮件服务器已接收：没有「已送达」，页面上说清楚。 */
import { NOTIFICATION_AUDIENCE_NAMES, NOTIFICATION_ERROR_NAMES, NOTIFICATION_EVENT_NAMES, type NotificationAudience, type NotificationEvent } from "@nozomi/domain";

export const PLATFORM_NOTIFICATIONS_PATH = "/platform/notifications";
export const PLATFORM_NOTIFICATION_TEMPLATES_PATH = "/platform/notification-templates";
export const TENANT_NOTIFICATIONS_PATH = "/settings/notifications";

export function platformOrderNotificationsPath(orderId: string): string {
  return `${PLATFORM_NOTIFICATIONS_PATH}?order=${encodeURIComponent(orderId)}&status=all`;
}

export function tenantOrderNotificationsPath(orderId: string): string {
  return `${TENANT_NOTIFICATIONS_PATH}?order=${encodeURIComponent(orderId)}`;
}

export function notificationEventName(event: NotificationEvent): string {
  return NOTIFICATION_EVENT_NAMES[event] ?? event;
}

export function notificationAudienceName(audience: NotificationAudience): string {
  return NOTIFICATION_AUDIENCE_NAMES[audience];
}

/** 失败原因：后端的那句话优先（发信失败的说明），没有时按代码说；都没有就显示代码。 */
export function notificationErrorText(error: { code: string; message: string | null } | null): string | null {
  if (error === null) return null;
  return error.message ?? NOTIFICATION_ERROR_NAMES[error.code] ?? error.code;
}
