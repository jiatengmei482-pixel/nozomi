/**
 * 派车、司机 H5、Webhook 页面上的显示（M3-02）：用车时间按服务城市的时区（docs/design/04-data-display.md 第 4 节）、枚举的中文、错误码的说明。
 */
import { LANDING_SOURCE_NAMES, NO_SHOW_ITEM_NAMES, type NoShowItem, TENANT_WEBHOOK_EVENT_NAMES, type TenantWebhookEvent } from "@nozomi/domain";
import type { LandingSource, TenantOrder } from "../api/dispatch.ts";

export const ORDER_LIST_PATH = "/orders";
export const DRIVER_LIST_PATH = "/fleet/drivers";
export const VEHICLE_LIST_PATH = "/fleet/vehicles";
export const WEBHOOK_SETTINGS_PATH = "/settings/webhook";
export const PLATFORM_DELIVERIES_PAGE = "/platform/webhook-deliveries";
/** 司机 H5：令牌放在 # 后面（不会发给服务器、不进访问日志） */
export const DRIVER_PAGE_PATH = "/driver";

export function orderPath(id: string): string {
  return `${ORDER_LIST_PATH}/${encodeURIComponent(id)}`;
}

/** 某个时刻在某个时区的 `YYYY-MM-DD HH:mm`。时区换算只用 Intl（规范第 4 节）。 */
export function formatInZone(iso: string | null, timeZone: string): string {
  if (iso === null) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return `${parts["year"]}-${parts["month"]}-${parts["day"]} ${parts["hour"]}:${parts["minute"]}`;
}

/** 用车时间：`service_local` 就是城市当地时间，`YYYY-MM-DDTHH:mm` 写成 `YYYY-MM-DD HH:mm`。 */
export function serviceLocalText(order: Pick<TenantOrder, "service_local">): string {
  return order.service_local.replace("T", " ");
}

/** 路线：接机「机场 → 地址」、送机「地址 → 机场」、其他「上车点 → 下车点」。机场的名字页面另外查，这里用「机场」。 */
export function routeText(order: Pick<TenantOrder, "category" | "direction" | "pickup" | "dropoff">, placeName = "机场"): string {
  const from = order.pickup?.address ?? placeName;
  const to = order.dropoff?.address ?? (order.category === "charter" ? "—" : placeName);
  return `${from} → ${to}`;
}

export const CATEGORY_NAMES: Readonly<Record<TenantOrder["category"], string>> = { airport_transfer: "接送机", point_to_point: "点对点", charter: "包车" };

export function directionName(order: Pick<TenantOrder, "category" | "direction">): string {
  if (order.category !== "airport_transfer") return CATEGORY_NAMES[order.category];
  return order.direction === "pickup" ? "接机" : "送机";
}

export function landingSourceName(source: LandingSource): string {
  return LANDING_SOURCE_NAMES[source];
}

export function noShowItemName(item: NoShowItem): string {
  return NO_SHOW_ITEM_NAMES[item];
}

export function webhookEventName(event: string): string {
  if (event === "webhook.test") return "测试事件";
  return TENANT_WEBHOOK_EVENT_NAMES[event as TenantWebhookEvent] ?? event;
}

/** 推送失败的原因（错误码 → 人话）。 */
const WEBHOOK_ERRORS: Readonly<Record<string, string>> = {
  WEBHOOK_TIMEOUT: "5 秒内没有应答",
  WEBHOOK_HTTP_STATUS: "对方返回的不是 2xx",
  WEBHOOK_REDIRECT_NOT_FOLLOWED: "对方返回了重定向（不跟随）",
  WEBHOOK_CONNECT_FAILED: "连不上对方",
  WEBHOOK_TLS_FAILED: "HTTPS 证书有问题",
  WEBHOOK_DNS_FAILED: "域名解析不了",
  WEBHOOK_TARGET_FORBIDDEN: "地址指向内网或本机，不允许推送",
  WEBHOOK_URL_INVALID: "接收地址不正确",
  WEBHOOK_SECRET_UNAVAILABLE: "签名密钥读不出来，请换一把新的",
  WEBHOOK_NOT_CONFIGURED: "Webhook 已删除或暂停",
};

export function webhookErrorText(code: string | null, statusCode: number | null): string {
  if (code === null) return statusCode === null ? "—" : `HTTP ${statusCode}`;
  const text = WEBHOOK_ERRORS[code] ?? code;
  return statusCode === null ? text : `${text}（HTTP ${statusCode}）`;
}

/** 秒数写成「1 分钟」「2 小时」「1 天」（重试间隔的说明用）。 */
export function durationText(seconds: number): string {
  if (seconds % 86_400 === 0) return `${seconds / 86_400} 天`;
  if (seconds % 3_600 === 0) return `${seconds / 3_600} 小时`;
  if (seconds % 60 === 0) return `${seconds / 60} 分钟`;
  return `${seconds} 秒`;
}

/** 金额：`{amount: "20000", currency: "JPY"}` → `20,000 JPY`（规范第 2 节：千分位、币种代码在后）。 */
export function moneyText(money: { amount: string; currency: string }): string {
  const negative = money.amount.startsWith("-");
  const [whole = "", fraction] = (negative ? money.amount.slice(1) : money.amount).split(".");
  return `${negative ? "-" : ""}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${fraction === undefined ? "" : `.${fraction}`} ${money.currency}`;
}

/** 司机链接的完整地址（本站域名 + `/driver#令牌`）。 */
export function driverLinkUrl(origin: string, path: string): string {
  return `${origin}${path}`;
}

/** 手动重推之后的提示。推送任务正在发这一条时重推什么都不做，提示稍后看结果。 */
export function retryResultText(response: { delivery: { status: string }; result: "sent" | "in_flight" | "not_configured" }): string {
  if (response.result === "in_flight") return "这条推送正在发送，稍后刷新查看结果";
  if (response.result === "not_configured") return "供应商的 Webhook 设置已删除或暂停，没有发送";
  return response.delivery.status === "succeeded" ? "已重推成功" : "重推了，对方还是没收到";
}
