/**
 * 司机链接邮件（M4-27，ADR 0058）的纯规则：发送方式、发送前复查、重发限速、发送状态、行程概要。
 * 链接能看到客人信息，所以这里的判断都偏向「不发」：任何一条对不上就不发，复制链接永远是兜底。
 */
export const DRIVER_LINK_DELIVERY_MODES = ["auto", "manual"] as const;
export type DriverLinkDeliveryMode = (typeof DRIVER_LINK_DELIVERY_MODES)[number];
export const DRIVER_LINK_DELIVERY_NAMES: Readonly<Record<DriverLinkDeliveryMode, string>> = { auto: "系统自动发送", manual: "调度员手动发送" };
export const DRIVER_LINK_DELIVERY_DEFAULT: DriverLinkDeliveryMode = "auto";

/** 能发邮件的订单状态：和能重新生成司机链接的状态相同。取消、救援中、已转出都不在内。 */
export const DRIVER_LINK_EMAIL_STATUSES: readonly string[] = ["assigned", "departed", "arrived", "in_service", "completed", "no_show_claimed"];

export const DRIVER_LINK_EMAIL_LIMITS = {
  /** 同一张单两次发起至少隔这么久（连点保护，含自动发的那次） */
  orderCooldownSeconds: 60,
  orderPerHour: 5,
  /** 账号被盗时不能拿重发当群发工具 */
  tenantPerHour: 200,
  /** 发起之后这么久还没有发送记录：发件箱展开出了问题，不能一直显示「等待中」 */
  expandStalledMs: 15 * 60_000,
} as const;

export type DriverLinkSendBlock = "ORDER_STATE_CHANGED" | "DRIVER_LINK_REVOKED" | "DRIVER_LINK_SUPERSEDED" | "DRIVER_LINK_MANUAL" | "DRIVER_EMAIL_MISSING" | "DRIVER_DISABLED";

export interface DriverLinkSendFacts {
  now: Date;
  /** 发起时记下的 */
  request: { id: string; driverId: string; assignmentId: string };
  /** 锁住订单之后读到的 */
  order: { status: string; driverId: string | null };
  /** 发起时调度员手里那条链接现在的样子；没有这一行为 null */
  anchor: { driverId: string; assignmentId: string; revokedAt: Date | null; expiresAt: Date } | null;
  /** 这张单最新的一次发起 */
  latestRequestId: string | null;
  mode: DriverLinkDeliveryMode;
  driver: { email: string | null; status: string } | null;
}

/** 发送前复查：现在还能不能发。能发返回 null。顺序决定记哪个原因：先看订单和司机，再看链接，再看设置和邮箱。 */
export function driverLinkSendBlock(facts: DriverLinkSendFacts): DriverLinkSendBlock | null {
  const { order, request, anchor, driver } = facts;
  if (!DRIVER_LINK_EMAIL_STATUSES.includes(order.status) || order.driverId !== request.driverId) return "ORDER_STATE_CHANGED";
  if (anchor === null || anchor.driverId !== request.driverId || anchor.assignmentId !== request.assignmentId) return "ORDER_STATE_CHANGED";
  if (anchor.revokedAt !== null || anchor.expiresAt.getTime() <= facts.now.getTime()) return "DRIVER_LINK_REVOKED";
  if (facts.latestRequestId !== request.id) return "DRIVER_LINK_SUPERSEDED";
  if (facts.mode !== "auto") return "DRIVER_LINK_MANUAL";
  if (driver === null || driver.status !== "active") return "DRIVER_DISABLED";
  if (driver.email === null || driver.email.trim() === "") return "DRIVER_EMAIL_MISSING";
  return null;
}

export type DriverNoticeBlock = "ORDER_STATE_CHANGED" | "CHANGE_DECIDED" | "DRIVER_LINK_REVOKED" | "DRIVER_LINK_MANUAL" | "DRIVER_EMAIL_MISSING" | "DRIVER_DISABLED";

/** 客人修改、取消时发给司机的通知（ADR 0060）。发送前复查：能发返回 null。规则和 `driverLinkSendBlock` 同一个方向：对不上就不发。 */
export function driverNoticeSendBlock(facts: {
  now: Date;
  event: string;
  driverId: string;
  order: { status: string; driverId: string | null };
  /** 等确认的通知：那次申请现在还有没有结论 */
  changeOpen: boolean | null;
  /** 带链接的通知：发起时调度员手里那条链接现在的样子 */
  anchor: { driverId: string; revokedAt: Date | null; expiresAt: Date } | null;
  mode: DriverLinkDeliveryMode;
  driver: { email: string | null; status: string } | null;
}): DriverNoticeBlock | null {
  const { event, order, anchor, driver, now } = facts;
  // 取消：通知的就是当时派的那位，订单已经不在可发链接的状态
  if (event !== "order.driver_cancelled") {
    if (!DRIVER_LINK_EMAIL_STATUSES.includes(order.status) || order.driverId !== facts.driverId) return "ORDER_STATE_CHANGED";
    if (event === "order.driver_change_pending" && facts.changeOpen !== true) return "CHANGE_DECIDED";
  }
  if (event === "order.driver_changed" && (anchor === null || anchor.driverId !== facts.driverId || anchor.revokedAt !== null || anchor.expiresAt.getTime() <= now.getTime())) return "DRIVER_LINK_REVOKED";
  if (facts.mode !== "auto") return "DRIVER_LINK_MANUAL";
  if (driver === null || driver.status !== "active") return "DRIVER_DISABLED";
  if (driver.email === null || driver.email.trim() === "") return "DRIVER_EMAIL_MISSING";
  return null;
}

/** 调度员要不要自己通知司机：`email` 系统发邮件；`manual` 供应商设的手动发送；`no_email` 司机没邮箱。 */
export function driverNoticeChannel(mode: DriverLinkDeliveryMode, driverEmail: string | null): "email" | "manual" | "no_email" {
  if (mode !== "auto") return "manual";
  return driverEmail === null || driverEmail.trim() === "" ? "no_email" : "email";
}

/** 重发限速：还要等多少秒；能发返回 null。`orderRecent` 是这张单最近一小时发起的时间，`tenantCount` 是这家最近一小时的次数。 */
export function driverLinkResendWait(input: { now: Date; orderRecent: readonly Date[]; tenantCount: number; tenantOldest: Date | null }): number | null {
  const { orderCooldownSeconds, orderPerHour, tenantPerHour } = DRIVER_LINK_EMAIL_LIMITS;
  const now = input.now.getTime();
  const hour = 3_600_000;
  const untilSeconds = (at: number): number => Math.max(1, Math.ceil((at - now) / 1000));
  const times = input.orderRecent.map((at) => at.getTime()).sort((a, b) => a - b);
  const latest = times.at(-1);
  if (latest !== undefined && now - latest < orderCooldownSeconds * 1000) return untilSeconds(latest + orderCooldownSeconds * 1000);
  const oldest = times[0];
  if (times.length >= orderPerHour && oldest !== undefined) return untilSeconds(oldest + hour);
  if (input.tenantCount >= tenantPerHour) return untilSeconds((input.tenantOldest?.getTime() ?? now) + hour);
  return null;
}

export const DRIVER_LINK_EMAIL_STATES = ["pending", "sent", "failed", "manual", "no_email", "not_sent", "no_link"] as const;
export type DriverLinkEmailState = (typeof DRIVER_LINK_EMAIL_STATES)[number];

export interface DriverLinkEmailFacts {
  now: Date;
  /** 现在有没有一条有效（没吊销、没过期）的调度员链接 */
  linkActive: boolean;
  /** 订单状态允许发 */
  orderSendable: boolean;
  mode: DriverLinkDeliveryMode;
  driverEmail: string | null;
  /** 司机停用了：发不了，不给重发。不给算在职 */
  driverActive?: boolean;
  /** 现在这条链接上最新的一次发起；发送记录还没展开时 `notification` 为 null */
  latest: {
    requestedAt: Date;
    /** 没有发送记录就结束了：`DRIVER_EMAIL_MISSING`（展开时没有地址），或展开出错的错误码 */
    closedCode?: string | null;
    /** 这一单还有没有有效的邮件链接。不给算有 */
    emailLinkActive?: boolean;
    notification: { status: string; recipient: string; errorCode: string | null; sentAt: Date | null } | null;
  } | null;
}

export interface DriverLinkEmailView {
  state: DriverLinkEmailState;
  /** 打码之前的地址：调用方必须打码后再给出去 */
  recipient: string | null;
  errorCode: string | null;
  requestedAt: Date | null;
  sentAt: Date | null;
  /** 上一封发出之后司机改了邮箱：那封里的链接已作废，要重发 */
  addressChanged: boolean;
  canResend: boolean;
}

/** 调度员看到的发送状态。派车应答、重新生成应答、订单详情都用它。 */
export function driverLinkEmailView(facts: DriverLinkEmailFacts): DriverLinkEmailView {
  const empty = { recipient: null, errorCode: null, requestedAt: null, sentAt: null, addressChanged: false };
  const email = facts.driverEmail === null || facts.driverEmail.trim() === "" ? null : facts.driverEmail;
  if (!facts.linkActive) return { ...empty, state: "no_link", canResend: false };
  if (facts.mode === "manual") return { ...empty, state: "manual", canResend: false };
  if (email === null) return { ...empty, state: "no_email", canResend: false };
  const canResend = facts.orderSendable && facts.driverActive !== false;
  const { latest } = facts;
  if (latest === null) return { ...empty, recipient: email, state: "not_sent", canResend };
  const notification = latest.notification;
  const base = { requestedAt: latest.requestedAt, canResend };
  if (notification === null) {
    if (latest.closedCode === "DRIVER_EMAIL_MISSING") return { ...base, state: "not_sent", recipient: email, errorCode: null, sentAt: null, addressChanged: false };
    if (latest.closedCode !== null && latest.closedCode !== undefined) return { ...base, state: "failed", recipient: email, errorCode: latest.closedCode, sentAt: null, addressChanged: false };
    const stalled = facts.now.getTime() - latest.requestedAt.getTime() > DRIVER_LINK_EMAIL_LIMITS.expandStalledMs;
    return { ...base, state: stalled ? "failed" : "pending", recipient: email, errorCode: stalled ? "UNEXPECTED" : null, sentAt: null, addressChanged: false };
  }
  if (notification.status === "sent") {
    // 邮件里的链接都作废了（改过邮箱，改回原地址也一样）：不能再说「已发送」，否则调度员不会点重发
    if (latest.emailLinkActive === false || notification.recipient.toLowerCase() !== email.toLowerCase()) return { ...base, state: "not_sent", recipient: email, errorCode: null, sentAt: null, addressChanged: true };
    return { ...base, state: "sent", recipient: notification.recipient, errorCode: null, sentAt: notification.sentAt, addressChanged: false };
  }
  if (notification.status === "pending" || notification.status === "sending") return { ...base, state: "pending", recipient: email, errorCode: notification.errorCode, sentAt: null, addressChanged: false };
  return { ...base, state: "failed", recipient: notification.recipient, errorCode: notification.errorCode, sentAt: null, addressChanged: false };
}

const ERROR_TEXTS: Readonly<Record<string, string>> = {
  NOT_CONFIGURED: "平台的邮件发送还没有配置好，请先复制链接手动发给司机",
  RECIPIENT_REJECTED: "对方邮件服务器拒收了这个地址，请核对司机邮箱，或复制链接手动发",
  MESSAGE_INVALID: "司机邮箱的写法有问题，请核对后重发，或复制链接手动发",
  OUTCOME_UNKNOWN: "发送途中服务中断，不知道发出去了没有，请和司机确认，或复制链接手动发",
  ORDER_STATE_CHANGED: "订单情况变了（取消、改派或救援），这封不再发送",
  DRIVER_LINK_REVOKED: "排队期间链接已被作废，这封不再发送",
  DRIVER_LINK_SUPERSEDED: "后来又发起了一次发送，这封不再发送",
  DRIVER_LINK_MANUAL: "已改成手动发送，这封不再发送",
  DRIVER_EMAIL_MISSING: "司机已经没有邮箱，这封不再发送",
  DRIVER_DISABLED: "司机已停用，这封不再发送",
  EXPIRED: "过了有效期没有发出去，请重发或复制链接手动发",
};

/**
 * 给调度员看的中文原因。只有我们自己写的话：邮件服务器的配置类问题（密码、发件人）调度员处理不了，统一说「发送失败」。
 */
export function driverLinkEmailErrorText(code: string | null): string | null {
  if (code === null) return null;
  return ERROR_TEXTS[code] ?? "邮件发送失败，请稍后重发，或复制链接手动发给司机";
}

/**
 * 邮件里的行程概要：城市、方向、机场或车站。**不用客人填的详细地址**（ADR 0058「邮件内容」）：司机邮箱不受我们控制、邮件长期留存，地址打开链接能看到。
 */
export function driverTripSummary(input: { city: string | null; category: string; direction: string | null; place: string | null; packageHours: number | null }): string {
  const kind = input.packageHours !== null ? `包车 ${input.packageHours} 小时` : input.category === "airport_transfer" ? (input.direction === "pickup" ? "接机" : input.direction === "dropoff" ? "送机" : "接送机") : "点对点";
  const parts = [kind, input.place].filter((part): part is string => part !== null && part !== "").join(" · ");
  return input.city === null || input.city === "" ? parts : `${input.city}：${parts}`;
}
