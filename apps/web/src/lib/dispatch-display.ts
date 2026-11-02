/**
 * 派车、司机 H5、Webhook 页面上的显示（M3-02）：用车时间按服务城市的时区（docs/design/04-data-display.md 第 4 节）、枚举的中文、错误码的说明。
 */
import { LANDING_SOURCE_NAMES, NO_SHOW_ITEM_NAMES, type NoShowItem, TENANT_WEBHOOK_EVENT_NAMES, type TenantWebhookEvent } from "@nozomi/domain";
import type { DriverLinkEmail, LandingSource, TenantOrder } from "../api/dispatch.ts";

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
export interface DriverLinkEmailNotice {
  kind: "info" | "warning" | "danger" | "success";
  text: string;
}

/**
 * 司机链接邮件的发送状态的说法（ADR 0058）。只有「邮件服务器已接收」，不能写「司机已收到」：SMTP 不知道这件事。
 */
export function driverLinkEmailNotice(email: Pick<DriverLinkEmail, "state" | "recipient_masked" | "error_code" | "error_message" | "address_changed">): DriverLinkEmailNotice {
  const to = email.recipient_masked ?? "司机的邮箱";
  switch (email.state) {
    case "sent":
      return { kind: "success", text: `已自动发到 ${to}（邮件服务器已接收）。司机没有回应的话，请再联系他。` };
    case "pending":
      if (email.error_code === "NOT_CONFIGURED") return { kind: "warning", text: `${email.error_message ?? "邮件发送还没有配置好，请先复制链接手动发给司机"}。配置好后系统会发到 ${to}。` };
      if (email.error_code !== null) return { kind: "warning", text: `暂时没发出去，系统会自动重试（发到 ${to}）。着急的话请复制链接手动发。` };
      return { kind: "info", text: `正在自动发到 ${to}，等待邮件服务器接收。` };
    case "failed":
      return { kind: "danger", text: `发送失败：${email.error_message ?? "请复制链接手动发给司机"}` };
    case "manual":
      return { kind: "info", text: "当前设置是手动发送，请复制链接发给司机。" };
    case "no_email":
      return { kind: "warning", text: "这位司机没有邮箱，请复制链接手动发。需要自动发的话，到「车队 → 司机」补上邮箱。" };
    case "not_sent":
      if (email.address_changed) return { kind: "warning", text: `司机的邮箱改过了，之前那封邮件里的链接已作废。请点「重发邮件」发到 ${to}，或复制链接手动发。` };
      return { kind: "info", text: `这条链接还没有发邮件。可以点「重发邮件」发到 ${to}，或复制链接手动发。` };
    case "no_link":
      return { kind: "info", text: "现在没有有效的司机链接，要先重新生成才能发。" };
  }
}

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
/**
 * 行程按品类写：接送机、点对点「起点 → 终点」（接送机缺的一头是机场）；
 * 包车没有终点，写「包车 8 小时 · 上车：地址」（有终点时照写「起点 → 终点」）。
 */
export function routeText(order: Pick<TenantOrder, "category" | "direction" | "pickup" | "dropoff"> & { package_hours?: number | null }, placeName = "机场"): string {
  if (order.category === "charter") {
    const head = order.package_hours ? `包车 ${order.package_hours} 小时` : "包车";
    const from = order.pickup?.address ?? "—";
    return order.dropoff ? `${head} · ${from} → ${order.dropoff.address}` : `${head} · 上车：${from}`;
  }
  const from = order.pickup?.address ?? placeName;
  const to = order.dropoff?.address ?? placeName;
  return `${from} → ${to}`;
}

export const CATEGORY_NAMES: Readonly<Record<TenantOrder["category"], string>> = { airport_transfer: "接送机", point_to_point: "点对点", charter: "包车" };

export function directionName(order: Pick<TenantOrder, "category" | "direction">): string {
  if (order.category !== "airport_transfer") return CATEGORY_NAMES[order.category];
  return order.direction === "pickup" ? "接机" : "送机";
}

/** 订单详情的品类一行：接送机写「接送机 · 接机」，其余品类方向名和品类名相同，只写一次。 */
export function orderCategoryText(order: Pick<TenantOrder, "category" | "direction" | "package_hours">): string {
  const parts = [...new Set([CATEGORY_NAMES[order.category], directionName(order)])];
  if (order.package_hours) parts.push(`${order.package_hours} 小时`);
  return parts.join(" · ");
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
  PASSENGER_DECRYPT_FAILED: "乘客信息解不开，没有发送，请联系平台",
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
