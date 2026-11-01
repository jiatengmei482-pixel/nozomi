/** 通知中心的接口（M4-08，ADR 0049）。收件人是打码后的；没有正文和令牌。 */
import type { NotificationAudience, NotificationEvent, NotificationStatus, QuietHours } from "@nozomi/domain";
import { apiRequest } from "./client.ts";
import type { ListPage } from "./dispatch.ts";

export interface NotificationRow {
  id: string;
  event: NotificationEvent;
  audience: NotificationAudience;
  locale: string;
  channel: "email";
  recipient: string;
  order: { id: string; order_no: string | null } | null;
  status: NotificationStatus;
  attempts: number;
  last_error: { code: string; message: string | null } | null;
  retryable: boolean;
  next_attempt_at: string | null;
  expires_at: string;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlatformNotificationPage extends ListPage<NotificationRow> {
  summary: { mail_configured: boolean; waiting: number; failed_events?: number };
}

export interface NotificationTemplateRow {
  event: NotificationEvent;
  audience: NotificationAudience;
  locale: string;
  channel: "email";
  subject: string;
  body: string;
  variables: string[];
}

export interface NotificationSettings {
  quiet_hours: QuietHours | null;
  time_zone: string;
  version: number;
}

function withQuery(path: string, values: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== "") params.set(key, String(value));
  const text = params.toString();
  return text === "" ? path : `${path}?${text}`;
}

export function listPlatformNotifications(token: string, values: { status?: NotificationStatus; event?: NotificationEvent; audience?: NotificationAudience; order_id?: string; order_no?: string; limit?: number }): Promise<PlatformNotificationPage> {
  return apiRequest("GET", withQuery("/platform/v1/notifications", values), { token });
}

export function retryNotification(token: string, id: string): Promise<{ notification: NotificationRow }> {
  return apiRequest("POST", `/platform/v1/notifications/${encodeURIComponent(id)}/retry`, { token });
}

export function listNotificationTemplates(token: string): Promise<{ items: NotificationTemplateRow[] }> {
  return apiRequest("GET", "/platform/v1/notification-templates", { token });
}

export function listTenantNotifications(token: string, values: { status?: NotificationStatus; order_id?: string; limit?: number }): Promise<ListPage<NotificationRow>> {
  return apiRequest("GET", withQuery("/tenant/v1/notifications", values), { token });
}

export function getNotificationSettings(token: string): Promise<NotificationSettings> {
  return apiRequest("GET", "/tenant/v1/notification-settings", { token });
}

export function saveNotificationSettings(token: string, version: number, quietHours: QuietHours | null): Promise<NotificationSettings> {
  return apiRequest("PUT", "/tenant/v1/notification-settings", { token, body: { quiet_hours: quietHours }, ...(version === 0 ? {} : { headers: { "if-match": `"${version}"` } }) });
}
