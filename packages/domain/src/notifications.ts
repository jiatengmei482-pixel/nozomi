/**
 * 通知中心（M4-08，ADR 0049）的纯规则：事件清单、模板（代码常量）、渲染、发送失败怎么处理、有效期、发送前的过期判断、免打扰、邮箱打码。
 *
 * 模板按「事件 × 接收方 × 语言 × 通道」组织。变量按接收方有白名单：
 * **供应商的白名单里没有对外价、加价比例、客人付款金额、退款金额、汇率**（CLAUDE.md 规则 4），测试扫所有模板。
 */
import { parseTimeOfDay, instantToLocal, MINUTES_PER_DAY } from "./service-time.ts";

export const NOTIFICATION_AUDIENCES = ["guest", "tenant", "staff"] as const;
export type NotificationAudience = (typeof NOTIFICATION_AUDIENCES)[number];

export const NOTIFICATION_AUDIENCE_NAMES: Readonly<Record<NotificationAudience, string>> = { guest: "客人", tenant: "供应商", staff: "平台员工" };

export const NOTIFICATION_EVENTS = [
  "order.confirmed",
  "order.assigned",
  "order.service_reminder",
  "order.driver_arrived",
  "order.changed",
  "order.change_pending",
  "order.change_declined",
  "order.cancelled",
  "extra_charge.submitted",
  "ticket.guest_reply",
  "order.rescue_assigned",
  "order.dispatch_overdue",
  "order.departure_overdue",
  "ticket.reply_requested",
  "tenant.document_expiring",
  "tenant.document_expired",
  "tenant.observation_started",
  "tenant.status_changed",
  "payout_account.submitted",
  "payout_account.approved",
  "payout_account.rejected",
  "exception.opened",
  "fx.alert",
  "site.lookup_ceiling",
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export function isNotificationEvent(value: string): value is NotificationEvent {
  return (NOTIFICATION_EVENTS as readonly string[]).includes(value);
}

export const NOTIFICATION_EVENT_NAMES: Readonly<Record<NotificationEvent, string>> = {
  "order.confirmed": "订单确认",
  "order.assigned": "司机信息",
  "order.service_reminder": "用车提醒",
  "order.driver_arrived": "司机已到达",
  "order.changed": "订单修改",
  "order.change_pending": "改期待确认",
  "order.change_declined": "改期未确认",
  "order.cancelled": "订单取消",
  "extra_charge.submitted": "服务后费用",
  "ticket.guest_reply": "工单回复",
  "order.rescue_assigned": "救援新订单",
  "order.dispatch_overdue": "超时未派车",
  "order.departure_overdue": "司机未出发",
  "ticket.reply_requested": "工单待回复",
  "tenant.document_expiring": "资质快到期",
  "tenant.document_expired": "资质已到期",
  "tenant.observation_started": "进入观察期",
  "tenant.status_changed": "供应商状态变化",
  "payout_account.submitted": "收款账户已提交",
  "payout_account.approved": "收款账户已生效",
  "payout_account.rejected": "收款账户被驳回",
  "exception.opened": "新的异常",
  "fx.alert": "汇率告警",
  "site.lookup_ceiling": "官网找回告警",
};

export const NOTIFICATION_STATUSES = ["pending", "sending", "sent", "failed", "expired"] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

/** 界面上的叫法。「已发送」只表示邮件服务器已接收（ADR 0049「不做」：没有已送达）。 */
export const NOTIFICATION_STATUS_NAMES: Readonly<Record<NotificationStatus, string>> = { pending: "等待发送", sending: "正在发送", sent: "已发送", failed: "失败", expired: "已过期" };

export const NOTIFICATION_LOCALES = ["zh-CN"] as const;
export type NotificationLocale = (typeof NOTIFICATION_LOCALES)[number];
export const NOTIFICATION_CHANNELS = ["email"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** 客人邮件能用的变量。 */
export const GUEST_VARIABLES = ["order_no", "passenger_name", "service_time", "route", "vehicle_group", "paid_amount", "view_url", "driver_name", "driver_phone", "vehicle_plate", "changed_fields", "extra_charge_amount", "extra_charge_type", "dispute_until"] as const;
/** 供应商邮件能用的变量：行程和编号。**不能往这里加对外价、加价比例、客人付的钱**（规则 4）。 */
export const TENANT_VARIABLES = ["order_no", "service_time", "route", "vehicle_group", "passengers", "order_url", "console_url", "dispatch_due_at", "confirm_due_at", "changed_fields", "ticket_no", "document_type", "expires_on", "days_left", "tenant_status", "reasons", "payout_currency", "payout_account", "reject_reason"] as const;
/** 平台员工邮件能用的变量。 */
export const STAFF_VARIABLES = ["order_no", "exception_type", "console_url", "alert_kind", "detail"] as const;

/** 不能出现在供应商邮件里的内容：模板、变量名都不能含这些词（规则 4）。 */
export const TENANT_FORBIDDEN_PATTERN = /对外价|加价|markup|sell|paid|refund|fx_|汇率|客人付|实付/i;

export function audienceVariables(audience: NotificationAudience): readonly string[] {
  return audience === "guest" ? GUEST_VARIABLES : audience === "tenant" ? TENANT_VARIABLES : STAFF_VARIABLES;
}

export interface NotificationTemplate {
  event: NotificationEvent;
  audience: NotificationAudience;
  locale: NotificationLocale;
  channel: NotificationChannel;
  subject: string;
  body: string;
}

const GUEST_FOOTER = "\n\n查看和管理订单：\n{{view_url}}\n这个链接只属于您的这张订单，请不要转发给别人。\n\nNOZOMI 用车";
const TRIP = "订单号：{{order_no}}\n用车时间：{{service_time}}（当地时间）\n行程：{{route}}\n车型：{{vehicle_group}}";
const TENANT_TRIP = "订单号：{{order_no}}\n用车时间：{{service_time}}（当地时间）\n行程：{{route}}\n车型：{{vehicle_group}}\n人数：{{passengers}}";
const TENANT_FOOTER = "\n\n到后台处理：\n{{order_url}}\n\nNOZOMI 平台";
const COMPANY_FOOTER = "\n\n到后台查看：\n{{console_url}}\n\nNOZOMI 平台";

const zhEmail = (event: NotificationEvent, audience: NotificationAudience, subject: string, body: string): NotificationTemplate => ({ event, audience, locale: "zh-CN", channel: "email", subject, body });

/** 全部模板。加语言 = 在这里加常量（ADR 0049「模板」）。 */
export const NOTIFICATION_TEMPLATES: readonly NotificationTemplate[] = [
  zhEmail("order.confirmed", "guest", "预订已确认：{{order_no}}", `{{passenger_name}}，您好：\n\n我们已收到您的付款，订单已确认。\n\n${TRIP}\n已付金额：{{paid_amount}}\n\n派好司机后我们会再发邮件告诉您司机信息。${GUEST_FOOTER}`),
  zhEmail("order.assigned", "guest", "司机信息：{{order_no}}", `{{passenger_name}}，您好：\n\n您的订单已安排司机。如果之前收到过司机信息，请以这一封为准。\n\n${TRIP}\n司机：{{driver_name}}\n电话：{{driver_phone}}\n车牌：{{vehicle_plate}}${GUEST_FOOTER}`),
  zhEmail("order.service_reminder", "guest", "用车提醒：{{service_time}}（{{order_no}}）", `{{passenger_name}}，您好：\n\n您的用车时间快到了，请按时到达上车点。\n\n${TRIP}${GUEST_FOOTER}`),
  zhEmail("order.driver_arrived", "guest", "司机已到达：{{order_no}}", `{{passenger_name}}，您好：\n\n司机已经到达上车点。\n\n司机：{{driver_name}}\n电话：{{driver_phone}}\n车牌：{{vehicle_plate}}${GUEST_FOOTER}`),
  zhEmail("order.changed", "guest", "订单已修改：{{order_no}}", `{{passenger_name}}，您好：\n\n您的订单修改已生效，改动的内容：{{changed_fields}}。\n\n${TRIP}${GUEST_FOOTER}`),
  zhEmail("order.change_declined", "guest", "改期没有成功：{{order_no}}", `{{passenger_name}}，您好：\n\n很抱歉，您申请的改期没有得到确认，订单仍按原时间执行；如果改期时补过差价，会原路退回。您也可以在订单页免费取消。\n\n${TRIP}${GUEST_FOOTER}`),
  zhEmail("order.cancelled", "guest", "订单已取消：{{order_no}}", `{{passenger_name}}，您好：\n\n您的订单已取消。如有退款，会按取消政策原路退回，金额可在订单页查看。\n\n${TRIP}${GUEST_FOOTER}`),
  zhEmail("extra_charge.submitted", "guest", "服务后费用待确认：{{order_no}}", `{{passenger_name}}，您好：\n\n供应商提交了一项服务后费用。\n\n项目：{{extra_charge_type}}\n金额：{{extra_charge_amount}}\n\n如有异议，请在 {{dispute_until}}（东京时间）之前在订单页提出；没有异议的，到时会从您保存的支付方式中扣款。${GUEST_FOOTER}`),
  zhEmail("ticket.guest_reply", "guest", "您的工单有新回复：{{order_no}}", `{{passenger_name}}，您好：\n\n客服回复了您关于订单 {{order_no}} 的问题，请到订单页查看。${GUEST_FOOTER}`),

  zhEmail("order.confirmed", "tenant", "新订单：{{order_no}}", `你有一张新订单，请在派车截止时间前派好司机和车辆。\n\n${TENANT_TRIP}\n派车截止：{{dispatch_due_at}}（东京时间）${TENANT_FOOTER}`),
  zhEmail("order.rescue_assigned", "tenant", "救援新订单：{{order_no}}", `这张救援单已经转给你，请尽快派好司机和车辆。\n\n${TENANT_TRIP}${TENANT_FOOTER}`),
  zhEmail("order.changed", "tenant", "订单已修改：{{order_no}}", `这张订单有修改，已经生效，改动的内容：{{changed_fields}}。如已派车，请确认司机和车辆还合适。\n\n${TENANT_TRIP}${TENANT_FOOTER}`),
  zhEmail("order.change_pending", "tenant", "改期待确认：{{order_no}}", `客人申请改期，请在 {{confirm_due_at}}（东京时间）之前确认或拒绝。超时没有确认的，改期不生效。\n\n${TENANT_TRIP}${TENANT_FOOTER}`),
  zhEmail("order.cancelled", "tenant", "订单已取消：{{order_no}}", `这张订单已取消，不用再安排。如已派车，请通知司机。\n\n${TENANT_TRIP}${TENANT_FOOTER}`),
  zhEmail("order.dispatch_overdue", "tenant", "超时未派车：{{order_no}}", `这张订单已过派车截止时间，还没有派司机和车辆，请马上处理。用车前 6 小时仍未派车会进入救援改派，并按规则扣违约金。\n\n${TENANT_TRIP}\n派车截止：{{dispatch_due_at}}（东京时间）${TENANT_FOOTER}`),
  zhEmail("order.departure_overdue", "tenant", "司机还没有出发：{{order_no}}", `离用车不到 1 小时，司机还没有点「已出发」，请马上确认。\n\n${TENANT_TRIP}${TENANT_FOOTER}`),
  zhEmail("ticket.reply_requested", "tenant", "工单待回复：{{ticket_no}}", `平台在工单 {{ticket_no}} 里征求你的意见，请在 24 小时内回复并上传证据。${COMPANY_FOOTER}`),
  zhEmail("tenant.document_expiring", "tenant", "资质快到期：{{document_type}}", `你的「{{document_type}}」将在 {{expires_on}} 到期（还有 {{days_left}} 天），请尽快上传新的证件。到期后供应商会被自动暂停。${COMPANY_FOOTER}`),
  zhEmail("tenant.document_expired", "tenant", "资质已到期：{{document_type}}", `你的「{{document_type}}」已在 {{expires_on}} 到期，请尽快上传新的证件。${COMPANY_FOOTER}`),
  zhEmail("tenant.observation_started", "tenant", "进入观察期，请整改", `你的账号已进入观察期，原因：{{reasons}}。观察期内排序会受影响，请尽快整改。${COMPANY_FOOTER}`),
  zhEmail("tenant.status_changed", "tenant", "供应商状态变化：{{tenant_status}}", `你的供应商状态已变为「{{tenant_status}}」。${COMPANY_FOOTER}`),

  // 账号只有末 4 位（ADR 0051）。发给供应商的管理员：账号被盗用时，管理员能从这封邮件发现异常提交
  zhEmail("payout_account.submitted", "tenant", "收款账户变更已提交：{{payout_currency}}", `你们提交了新的 {{payout_currency}} 收款账户（账号 {{payout_account}}），平台审核通过后生效，批准之前现在的账户继续有效。\n\n如果不是你们提交的，请马上联系平台，并修改管理员密码。${COMPANY_FOOTER}`),
  zhEmail("payout_account.approved", "tenant", "收款账户已生效：{{payout_currency}}", `你们的 {{payout_currency}} 收款账户（账号 {{payout_account}}）已通过审核，之后的转账付到这个账户。\n\n如果不是你们提交的，请马上联系平台。${COMPANY_FOOTER}`),
  zhEmail("payout_account.rejected", "tenant", "收款账户被驳回：{{payout_currency}}", `你们提交的 {{payout_currency}} 收款账户（账号 {{payout_account}}）没有通过审核，原因：{{reject_reason}}。请核对后重新提交。${COMPANY_FOOTER}`),

  zhEmail("exception.opened", "staff", "新的异常：{{exception_type}}（{{order_no}}）", `异常队列新增一条，请处理。\n\n类型：{{exception_type}}\n订单号：{{order_no}}${COMPANY_FOOTER}`),
  zhEmail("fx.alert", "staff", "汇率告警：{{alert_kind}}", `{{alert_kind}}\n\n{{detail}}${COMPANY_FOOTER}`),
  zhEmail("site.lookup_ceiling", "staff", "官网找回订单告警", `官网找回订单：同一个订单号 24 小时内失败满 100 次，接下来连对上的联系方式也会被挡，请留意是否有人在猜。\n\n{{detail}}${COMPANY_FOOTER}`),
];

export function findNotificationTemplate(event: NotificationEvent, audience: NotificationAudience, locale: NotificationLocale, channel: NotificationChannel): NotificationTemplate | null {
  return NOTIFICATION_TEMPLATES.find((template) => template.event === event && template.audience === audience && template.locale === locale && template.channel === channel) ?? null;
}

/** 这个事件发给哪些接收方（有模板的）。 */
export function notificationAudiences(event: NotificationEvent): NotificationAudience[] {
  return NOTIFICATION_AUDIENCES.filter((audience) => NOTIFICATION_TEMPLATES.some((template) => template.event === event && template.audience === audience));
}

const PLACEHOLDER = /\{\{([a-z_]+)\}\}/g;

export function templatePlaceholders(template: Pick<NotificationTemplate, "subject" | "body">): string[] {
  return [...new Set([...`${template.subject}\n${template.body}`.matchAll(PLACEHOLDER)].map((match) => match[1] as string))];
}

export function templateNeedsViewLink(template: Pick<NotificationTemplate, "subject" | "body">): boolean {
  return templatePlaceholders(template).includes("view_url");
}

export type NotificationVariables = Readonly<Partial<Record<string, string>>>;

// 控制字符写成转义：这是正则要匹配的内容
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001f\\u007f\\u0085\\u2028\\u2029]+", "g");

/** 有没有换行、行分隔符等控制字符。接口层用它拒绝单行字段（姓名、地址），渲染时另有一道规整。 */
export function hasControlChars(text: string): boolean {
  return new RegExp(CONTROL_CHARS.source).test(text);
}

const oneLine = (value: string): string => value.replace(CONTROL_CHARS, " ").trim();


/**
 * 渲染：一次替换（变量值里的 `{{x}}` 不会被再次替换），只认这个接收方白名单里的变量。缺变量返回 null（不发半截邮件）。
 * 主题和正文里的变量都把换行、行分隔符等控制字符规整成空格：主题防邮件头注入，正文防客人填的内容伪造段落（如在发给供应商的邮件里伪造「平台通知」）。
 */
export function renderNotification(template: NotificationTemplate, variables: NotificationVariables): { subject: string; text: string } | null {
  const allowed = audienceVariables(template.audience);
  for (const name of templatePlaceholders(template)) {
    const value = variables[name];
    if (!allowed.includes(name) || value === undefined || oneLine(value) === "") return null;
  }
  const fill = (text: string): string => text.replace(PLACEHOLDER, (_, name: string) => oneLine(variables[name] as string));
  return { subject: fill(template.subject).slice(0, 200), text: fill(template.body) };
}

/** 邮箱打码：`ab***@example.com`。不像邮箱的整个打码。 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "***";
  const local = email.slice(0, at);
  return `${local.slice(0, local.length <= 2 ? 1 : 2)}***${email.slice(at)}`;
}

export const NOTIFICATION_RULES = {
  /** 第一次失败后依次等多少秒；次数用完是最终失败 */
  retryDelaysSeconds: [60, 300, 1800, 7200, 21600],
  /** 邮件服务器明确拒绝（5xx）又不能确定是这个收件人的问题：等待本身解决不了，只留给运营改配置的时间，少试几次（ADR 0049） */
  rejectedRetryDelaysSeconds: [300, 1800],
  /** 配置问题（密码错、证书错）隔多久再试，不算次数 */
  configRetrySeconds: 300,
  arrivedLifetimeMs: 60 * 60_000,
  defaultLifetimeMs: 7 * 24 * 60 * 60_000,
  staffLifetimeMs: 24 * 60 * 60_000,
} as const;

export type NotificationFailureAction = { kind: "retry"; delaySeconds: number } | { kind: "hold"; delaySeconds: number } | { kind: "fail" };

/** 这一次发送失败之后怎么办（ADR 0049「状态和重试」）。`attemptsMade` 包含这一次。 */
export function notificationFailureAction(code: string, attemptsMade: number): NotificationFailureAction {
  if (code === "AUTH_FAILED" || code === "TLS_FAILED" || code === "TARGET_FORBIDDEN") return { kind: "hold", delaySeconds: NOTIFICATION_RULES.configRetrySeconds };
  if (code === "RECIPIENT_REJECTED" || code === "MESSAGE_INVALID" || code === "RENDER_FAILED") return { kind: "fail" };
  const delays: readonly number[] = code === "SENDER_REJECTED" || code === "MESSAGE_REJECTED" ? NOTIFICATION_RULES.rejectedRetryDelaysSeconds : NOTIFICATION_RULES.retryDelaysSeconds;
  const delay = delays[attemptsMade - 1];
  return delay === undefined ? { kind: "fail" } : { kind: "retry", delaySeconds: delay };
}

/** 能不能手动重试：失败的、纯粹过了有效期的。订单情况变了的不能（发了就是错的）。 */
export function notificationRetryable(status: NotificationStatus, errorCode: string | null): boolean {
  return status === "failed" || (status === "expired" && errorCode === "EXPIRED");
}

const SERVICE_BOUND: readonly NotificationEvent[] = ["order.confirmed", "order.assigned", "order.service_reminder", "order.rescue_assigned", "order.change_pending", "order.dispatch_overdue", "order.departure_overdue"];

/** 有效期就是用车时间的事件：改期后要跟着改（改期待确认另有确认期限，不在内）。 */
export const NOTIFICATION_SERVICE_BOUND_EVENTS: readonly NotificationEvent[] = SERVICE_BOUND.filter((event) => event !== "order.change_pending");

/** 这条通知最晚什么时候还值得发。过了就记 `expired`，不会在配好邮件后把陈旧的通知砸给收件人。 */
export function notificationExpiresAt(event: NotificationEvent, input: { occurredAt: Date; serviceAt: Date | null; disputeUntil: Date | null; confirmDueAt?: Date | null }): Date {
  const after = (ms: number): Date => new Date(input.occurredAt.getTime() + ms);
  if (event === "order.change_pending" && input.confirmDueAt !== undefined && input.confirmDueAt !== null) return input.serviceAt !== null && input.serviceAt < input.confirmDueAt ? input.serviceAt : input.confirmDueAt;
  if (SERVICE_BOUND.includes(event) && input.serviceAt !== null) return input.serviceAt;
  if (event === "order.driver_arrived") return after(NOTIFICATION_RULES.arrivedLifetimeMs);
  if (event === "extra_charge.submitted" && input.disputeUntil !== null) return input.disputeUntil;
  if (event === "exception.opened" || event === "fx.alert" || event === "site.lookup_ceiling") return after(NOTIFICATION_RULES.staffLifetimeMs);
  return after(NOTIFICATION_RULES.defaultLifetimeMs);
}

const LIVE_STATUSES: readonly string[] = ["confirmed", "assigned", "departed", "arrived", "in_service"];

export interface NotificationOrderFacts {
  status: string;
  serviceAtMs: number;
  driverId: string | null;
  vehicleId: string | null;
}

/**
 * 发送前再看一眼订单：情况已经变了、再发只会误导的返回 true（记 `expired` + `ORDER_STATE_CHANGED`）。
 * `order` 为 null（这一行不存在了）一律不发。修改、取消、费用、工单这些「已经发生的事」不过期。
 * 救援改派中（`rescue_pending`）：客人的单还有效（平台在找别的供应商），确认和提醒照发，不能因为正好在救援就永远丢了确认邮件；
 * 供应商的那一行已经不归它了，新订单不发。
 */
export function notificationStale(event: NotificationEvent, data: Readonly<Record<string, unknown>>, order: NotificationOrderFacts | null, context: { now?: Date; audience?: NotificationAudience } = {}): boolean {
  if (order === null) return true;
  const guestRescue = context.audience === "guest" && order.status === "rescue_pending";
  switch (event) {
    case "order.confirmed":
      return !guestRescue && !LIVE_STATUSES.includes(order.status);
    case "order.rescue_assigned":
      return !LIVE_STATUSES.includes(order.status);
    case "order.assigned":
      return !["assigned", "departed", "arrived"].includes(order.status) || data["driver_id"] !== order.driverId || data["vehicle_id"] !== order.vehicleId;
    case "order.service_reminder":
      return (!guestRescue && !["confirmed", "assigned", "departed", "arrived"].includes(order.status)) || data["service_at_ms"] !== order.serviceAtMs;
    case "order.driver_arrived":
      return order.status !== "arrived";
    case "order.dispatch_overdue":
      return order.status !== "confirmed";
    case "order.departure_overdue":
      return order.status !== "assigned";
    case "order.change_pending": {
      if (!LIVE_STATUSES.includes(order.status)) return true;
      // 过了确认期限：发了就是让人去确认一件已经结束的事
      const due = typeof data["confirm_due_at"] === "string" ? new Date(data["confirm_due_at"]).getTime() : Number.NaN;
      return context.now !== undefined && !Number.isNaN(due) && due <= context.now.getTime();
    }
    default:
      return false;
  }
}

export interface QuietHours {
  /** 东京时间 HH:mm */
  start: string;
  end: string;
}

export type QuietHoursIssue = "INVALID_TIME" | "SAME_TIME";

export function quietHoursIssue(hours: QuietHours): QuietHoursIssue | null {
  const start = parseTimeOfDay(hours.start);
  const end = parseTimeOfDay(hours.end);
  if (start === null || end === null) return "INVALID_TIME";
  return start === end ? "SAME_TIME" : null;
}

/** 现在在免打扰时段里的话，什么时候结束；不在时段里返回 null。可以跨午夜。 */
export function quietHoursResumeAt(hours: QuietHours, now: Date, timeZone: string): Date | null {
  const start = parseTimeOfDay(hours.start);
  const end = parseTimeOfDay(hours.end);
  if (start === null || end === null || start === end) return null;
  const minute = instantToLocal(now, timeZone).minuteOfDay;
  const inside = start < end ? minute >= start && minute < end : minute >= start || minute < end;
  if (!inside) return null;
  const wait = (end - minute + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return new Date(now.getTime() + wait * 60_000);
}

/** 紧急类（用车当天）不受免打扰限制（需求「紧急类（用车当天）不受限」）。日期按订单城市当地算；已经过了用车日的也算紧急。 */
export function notificationUrgent(serviceDate: string | null, now: Date, timeZone: string | null): boolean {
  if (serviceDate === null || timeZone === null) return false;
  return serviceDate <= instantToLocal(now, timeZone).date;
}

export const ORDER_CHANGE_FIELD_NAMES: Readonly<Record<string, string>> = {
  passenger: "乘客信息",
  flight_no: "航班号",
  messaging: "即时通讯",
  notes: "备注",
  pickup_address: "上车地址",
  dropoff_address: "下车地址",
  service_time: "用车时间",
  passengers: "人数",
  luggage: "行李数",
};

export const OBSERVATION_REASON_NAMES: Readonly<Record<string, string>> = { score_below_threshold: "评分低于观察线", driver_no_show: "司机未到" };

/** 用车前这么久之内，这些事件不受免打扰限制：晚发就来不及安排（新订单、救援、未出发、超时未派车、取消、改期待确认）。 */
export const NOTIFICATION_CRITICAL_WINDOW_MS = 24 * 60 * 60_000;
const TIME_CRITICAL: readonly NotificationEvent[] = ["order.confirmed", "order.rescue_assigned", "order.departure_overdue", "order.dispatch_overdue", "order.cancelled", "order.change_pending"];

export interface QuietHoldInput {
  event: NotificationEvent;
  quietHours: QuietHours;
  now: Date;
  /** 免打扰时段的时区 */
  timeZone: string;
  serviceAt: Date | null;
  serviceDate: string | null;
  serviceTimeZone: string | null;
  expiresAt: Date;
  confirmDueAt: Date | null;
}

/**
 * 要不要因为免打扰推迟，推迟到什么时候；null = 现在就发。
 * 不只看「是不是用车当天」：跨午夜的时段里，第二天凌晨用车的单还不算当天，推迟到时段结束就已经晚了。所以这几种都马上发：
 * 用车当天；时段结束时已经过了有效期、确认期限或用车时间；要紧的事件且 24 小时内用车。
 */
export function notificationQuietUntil(input: QuietHoldInput): Date | null {
  const resume = quietHoursResumeAt(input.quietHours, input.now, input.timeZone);
  if (resume === null) return null;
  if (notificationUrgent(input.serviceDate, input.now, input.serviceTimeZone)) return null;
  const deadlines = [input.expiresAt, input.serviceAt, input.confirmDueAt].filter((deadline): deadline is Date => deadline !== null);
  if (deadlines.some((deadline) => deadline.getTime() <= resume.getTime())) return null;
  if (TIME_CRITICAL.includes(input.event) && input.serviceAt !== null && input.serviceAt.getTime() - input.now.getTime() <= NOTIFICATION_CRITICAL_WINDOW_MS) return null;
  return resume;
}

/** 收件人去重：同一个地址只大小写不同算一个人（保留第一个的写法）。 */
export function uniqueRecipients(emails: readonly string[]): string[] {
  const seen = new Map<string, string>();
  for (const email of emails) if (!seen.has(email.toLowerCase())) seen.set(email.toLowerCase(), email);
  return [...seen.values()];
}

/** 失败代码的界面说法。 */
export const NOTIFICATION_ERROR_NAMES: Readonly<Record<string, string>> = {
  NOT_CONFIGURED: "邮件发送还没有配置，配好后自动发送",
  QUIET_HOURS: "在免打扰时段里，时段结束后发送",
  EXPIRED: "过了有效期，不再发送",
  ORDER_STATE_CHANGED: "订单情况变了，再发只会误导，不再发送",
  OUTCOME_UNKNOWN: "发送途中服务中断，不知道发出去了没有；可能已发出，重试前请先确认",
  RENDER_FAILED: "邮件内容生成失败（程序问题）",
  MESSAGE_INVALID: "收件人地址或邮件内容不合格",
  UNEXPECTED: "准备或发送邮件时出错，系统会自动重试；一直不好请联系技术",
};
