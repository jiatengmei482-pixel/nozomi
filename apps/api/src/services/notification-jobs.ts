/**
 * 通知中心的后台任务（M4-08，ADR 0049）：把发件箱展开成发送记录、到点发送、记结果。
 *
 * 和 Webhook 推送任务同一种写法（ADR 0022「定时任务和多实例」）：跑在 API 进程里，启动后 5 秒第一次，之后每 5 秒一轮（上一轮结束才排下一轮）。
 * 只有服务进程（`buildApp({ jobs: true })`）启动它；测试直接调 `tick()`。
 *
 * 每一轮：展开事件 → 用车提醒（最多每分钟扫一次）→ 过期 → 处理中途断掉的 → 邮件没配置就到此为止（记录保留，配置后发）→ 取走到期的记录逐条发送。
 * 发送在事务之外（最多 15 秒，ADR 0048）；取走时写租约令牌，记结果时核对。
 *
 * 发给司机的邮件（M4-27，ADR 0058；M4-29，ADR 0060）走同一条路，只是发送前的复查和生成链接在租户事务里。
 *
 * 日志只写通知编号、事件、订单编号、错误码：**不写邮箱、令牌、主题、正文**。查看链接的令牌只在内存里（库里只有哈希）。
 */
import {
  EXCEPTION_TYPE_NAMES,
  DOCUMENT_TYPE_INFO,
  EXTRA_CHARGE_TYPE_NAMES,
  type CurrencyCode,
  type DocumentType,
  type ExceptionType,
  type ExtraChargeType,
  type LocalizedText,
  type NotificationAudience,
  type NotificationEvent,
  CHANGE_DECLINE_ADVICE,
  ORDER_CHANGE_FIELD_NAMES,
  OBSERVATION_REASON_NAMES,
  TENANT_DRIVER_NOTICE_EVENTS,
  changeFieldsNeedConfirmation,
  driverNoticeChannel,
  isDriverNoticeEvent,
  orderChangeOpen,
  tenantDriverNoticeText,
  TENANT_RULES,
  TENANT_STATUS_NAMES,
  type TenantStatus,
  findNotificationTemplate,
  formatMajor,
  grantCan,
  instantToLocal,
  isNotificationEvent,
  notificationAudiences,
  notificationExpiresAt,
  notificationFailureAction,
  notificationStale,
  renderNotification,
  resolvePlatformGrant,
  scopeAllowsChannel,
  scopeAllowsCity,
  scopeIsRestricted,
  templateNeedsViewLink,
  NOTIFICATION_SERVICE_BOUND_EVENTS,
  notificationQuietUntil,
  uniqueRecipients,
  type MailMessage,
  type NotificationVariables,
  type PlatformAction,
} from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { type Db, withPlatformTx, withTenantTx } from "../db/context.ts";
import { findExtraChargeForPlatform } from "../repos/extra-charges.ts";
import { findDriver, findVehicle } from "../repos/fleet.ts";
import { findOrderChange } from "../repos/order-changes.ts";
import { PASSENGER_DECRYPT_FAILED, isPassengerDecryptFailure } from "../integrations/passenger-crypto.ts";
import {
  type Notification,
  type NotificationOutcome,
  type StoredNotificationEvent,
  activeStaff,
  beginSending,
  claimDueNotifications,
  claimPendingEvents,
  enqueueNotification,
  expireDue,
  failAbandoned,
  findEvent,
  findNotification,
  findNotificationSettings,
  finishNotification,
  insertNotification,
  listReminderDue,
  markEventExpanded,
  markWaitingForConfig,
  orderHasSiteLink,
  rebaseServiceExpiry,
  recordExpandFailure,
  releaseQuietHeld,
  tenantAdminRecipients,
  tenantRecipients,
  updateDriverRecipient,
  updateRecipient,
} from "../repos/notifications.ts";
import { type Order, type OrderSale, findOrderForPlatform, findOrderOfTenant, findSale } from "../repos/orders.ts";
import { findOrderNames, insertSiteOrderLink } from "../repos/site.ts";
import { prepareDriverLinkEmail, prepareDriverNotice } from "./driver-link-email.ts";
import { customerAmountOf } from "./extra-charges.ts";
import { sendMail } from "./mail.ts";
import type { OrderLog } from "./orders.ts";
import { newSiteLink } from "./site.ts";

const FIRST_TICK_MS = 5_000;
const TICK_INTERVAL_MS = 5_000;
const STOP_WAIT_MS = 3_000;
const EXPAND_BATCH = 100;
const SEND_BATCH = 20;
const CONCURRENCY = 4;
const EXPIRE_BATCH = 200;
const REMINDER_BATCH = 100;
const REMINDER_SWEEP_MS = 60_000;
const REMINDER_WINDOW_MS = 24 * 60 * 60_000;
/** 租约：比一次发信的总时限（15 秒）长得多；真正发之前重新计时（`beginSending`），一批排得再长也不会在发送途中过期 */
export const NOTIFICATION_LEASE_MS = 60_000;
/** 一条事件展开出错几次就不再处理 */
const EXPAND_MAX_ATTEMPTS = 3;
const LOCALE = "zh-CN";
const CHANNEL = "email";
const NOT_CONFIGURED_MESSAGE = "邮件发送还没有配置，配好后自动发送";

export interface NotificationSweepResult {
  expanded: number;
  expired: number;
  abandoned: number;
  sent: number;
  retrying: number;
  failed: number;
  /** 邮件没配置，这一轮没有发 */
  notConfigured: boolean;
}

const STAFF_RULES: Partial<Record<NotificationEvent, { action: PlatformAction } | { roles: readonly string[] }>> = {
  "exception.opened": { action: "exception.manage" },
  "fx.alert": { action: "fx.manage" },
  "site.lookup_ceiling": { roles: ["risk", "super_admin"] },
};

interface Target {
  audience: NotificationAudience;
  recipient: string;
  tenantId: string | null;
  orderNo: string | null;
}

type Prepared = { kind: "message"; message: MailMessage } | { kind: "stale"; code?: string } | { kind: "hold"; until: Date } | { kind: "render_failed" };

/** 事件里的时间：坏值当作没有。 */
function dateOf(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
}

const dbCodeOf = (err: unknown): string | null => (typeof err === "object" && err !== null && typeof (err as { code?: unknown }).code === "string" ? (err as { code: string }).code : null);
const nameOf = (name: LocalizedText | null | undefined, fallback: string): string => name?.zh ?? name?.en ?? name?.ja ?? name?.ko ?? fallback;
const clockText = (local: string): string => local.replace("T", " ");
const tokyoText = (at: Date): string => clockText(instantToLocal(at, TENANT_RULES.timeZone).dateTime);
const moneyText = (minor: number, currency: string): string => `${currency} ${formatMajor(minor, currency as CurrencyCode)}`;

async function tripVariables(db: Db, order: Order): Promise<{ service_time: string; route: string; vehicle_group: string }> {
  const names = await findOrderNames(db, { cityId: order.cityId, placeId: order.placeId, vehicleGroupId: order.vehicleGroupId });
  const place = names.place === null ? null : nameOf(names.place.name, names.place.code);
  const pickup = order.pickup?.address ?? null;
  const dropoff = order.dropoff?.address ?? null;
  const ends = order.direction === "pickup" ? [place, dropoff] : order.direction === "dropoff" ? [pickup, place] : [pickup, dropoff];
  const route = ends.filter((end): end is string => end !== null && end !== "").join(" → ");
  const city = names.city === null ? "" : nameOf(names.city.name, names.city.code);
  return {
    service_time: clockText(order.serviceLocal),
    route: [city, route, order.packageHours === null ? "" : `包车 ${order.packageHours} 小时`].filter((part) => part !== "").join("：") || "见订单",
    vehicle_group: names.vehicleGroup === null ? "见订单" : nameOf(names.vehicleGroup.name, names.vehicleGroup.code),
  };
}

const changedFieldsText = (fields: unknown): string => (Array.isArray(fields) && fields.length > 0 ? fields.map((field) => ORDER_CHANGE_FIELD_NAMES[String(field)] ?? String(field)).join("、") : "订单信息");

/** 客人邮件的变量。这里可以读对外价（客人自己付的钱）。 */
async function guestVariables(db: Db, event: StoredNotificationEvent, order: Order): Promise<NotificationVariables> {
  const sale = (await findSale(db, order.id)) as OrderSale;
  const base: Record<string, string> = { order_no: order.orderNo, passenger_name: order.passenger.name, paid_amount: moneyText(sale.sellMinor, sale.currency), changed_fields: changedFieldsText(event.data["fields"]), ...(await tripVariables(db, order)) };
  if ((event.event === "order.assigned" || event.event === "order.driver_arrived") && order.dispatch.driverId !== null && order.dispatch.vehicleId !== null) {
    const driver = await findDriver(db, order.tenantId, order.dispatch.driverId);
    const vehicle = await findVehicle(db, order.tenantId, order.dispatch.vehicleId);
    if (driver !== null && vehicle !== null) Object.assign(base, { driver_name: driver.name, driver_phone: driver.phone, vehicle_plate: vehicle.plate });
  }
  if (event.event === "order.change_declined") base["change_decline_advice"] = CHANGE_DECLINE_ADVICE[String(event.data["advice"])] ?? (CHANGE_DECLINE_ADVICE["policy"] as string);
  if (event.event === "extra_charge.submitted") {
    const charge = await findExtraChargeForPlatform(db, order.id, String(event.data["charge_id"]));
    if (charge !== null) Object.assign(base, { extra_charge_type: EXTRA_CHARGE_TYPE_NAMES[charge.type as ExtraChargeType], extra_charge_amount: moneyText(customerAmountOf(charge, sale), sale.currency), dispute_until: tokyoText(charge.disputeUntil) });
  }
  return base;
}

/**
 * 供应商邮件的变量。**这里从不读 `order_sales`**：只有行程和编号，没有对外价、加价比例、客人付的钱（规则 4）。
 * 渲染时还有一道白名单（`TENANT_VARIABLES`）。
 */
async function tenantVariables(ctx: AppContext, db: Db, event: StoredNotificationEvent, order: Order | null): Promise<NotificationVariables> {
  const data = event.data;
  const out: Record<string, string> = { console_url: `${ctx.config.publicBaseUrl}/` };
  if (order !== null) {
    Object.assign(out, await tripVariables(db, order), {
      order_no: order.orderNo,
      passengers: String(order.passengers),
      order_url: `${ctx.config.publicBaseUrl}/orders/${order.id}`,
      changed_fields: changedFieldsText(data["fields"]),
      ...(order.dispatch.dueAt === null ? {} : { dispatch_due_at: tokyoText(order.dispatch.dueAt) }),
    });
  }
  if (order !== null && TENANT_DRIVER_NOTICE_EVENTS.includes(event.event)) {
    // 只读司机的名字和邮箱有没有：邮件里只写名字
    const driver = order.dispatch.driverId === null ? null : await findDriver(db, order.tenantId, order.dispatch.driverId);
    const { driverLinkDelivery } = await findNotificationSettings(db, order.tenantId);
    const needsAdjustment = event.event !== "order.changed" || (Array.isArray(data["fields"]) && changeFieldsNeedConfirmation(data["fields"].map(String)));
    out["driver_notice"] = tenantDriverNoticeText(event.event, driver?.name ?? null, driverNoticeChannel(driverLinkDelivery, driver?.email ?? null), needsAdjustment);
  }
  if (typeof data["confirm_due_at"] === "string") out["confirm_due_at"] = tokyoText(new Date(data["confirm_due_at"]));
  if (typeof data["ticket_no"] === "string") out["ticket_no"] = data["ticket_no"];
  if (typeof data["document_type"] === "string") out["document_type"] = DOCUMENT_TYPE_INFO[data["document_type"] as DocumentType]?.name ?? data["document_type"];
  if (typeof data["expires_on"] === "string") out["expires_on"] = data["expires_on"];
  if (typeof data["days_left"] === "number") out["days_left"] = String(data["days_left"]);
  if (typeof data["status"] === "string") out["tenant_status"] = TENANT_STATUS_NAMES[data["status"] as TenantStatus] ?? data["status"];
  if (typeof data["payout_currency"] === "string") out["payout_currency"] = data["payout_currency"];
  if (typeof data["payout_account"] === "string") out["payout_account"] = data["payout_account"];
  if (typeof data["reject_reason"] === "string") out["reject_reason"] = data["reject_reason"];
  if (Array.isArray(data["reasons"])) out["reasons"] = data["reasons"].map((reason) => OBSERVATION_REASON_NAMES[String(reason)] ?? String(reason)).join("、");
  return out;
}

function staffVariables(ctx: AppContext, notification: Notification, event: StoredNotificationEvent): NotificationVariables {
  const data = event.data;
  const base = ctx.config.publicBaseUrl;
  if (event.event === "exception.opened") {
    return { order_no: notification.orderNo ?? "", exception_type: EXCEPTION_TYPE_NAMES[data["type"] as ExceptionType] ?? "请到异常队列查看", console_url: `${base}/platform/exceptions` };
  }
  if (event.event === "fx.alert") {
    if (data["kind"] === "source_rejected") {
      return { alert_kind: "汇率源缺币种，这批整批拒收，继续用上一批", detail: typeof data["detail"] === "string" ? data["detail"] : "见汇率中心的拉取记录", console_url: `${base}/platform/master/fx-rates` };
    }
    const held = data["kind"] === "held";
    return {
      alert_kind: held ? "汇率变动超过 3%，已挂起，等待人工确认" : "汇率超过 48 小时没有更新，已暂停跨币种报价",
      detail: held ? `涉及币种：${Array.isArray(data["currencies"]) ? data["currencies"].join("、") : "见汇率中心"}` : typeof data["as_of"] === "string" ? `最后一次更新：${data["as_of"]}` : "最后一次更新时间见汇率中心",
      console_url: `${base}/platform/master/fx-rates`,
    };
  }
  return { detail: notification.orderNo === null ? "这个订单号不存在：有人可能在猜订单号。" : `订单号：${notification.orderNo}`, console_url: `${base}/platform/orders` };
}

export class NotificationJobs {
  private readonly ctx: AppContext;
  private readonly log: OrderLog;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private ticking: Promise<unknown> | null = null;
  private stopped = true;
  private lastReminderSweep = 0;

  constructor(ctx: AppContext, log: OrderLog) {
    this.ctx = ctx;
    this.log = log;
  }

  async tick(): Promise<NotificationSweepResult> {
    const now = this.ctx.now();
    const expanded = await this.expandEvents(now);
    if (now.getTime() - this.lastReminderSweep >= REMINDER_SWEEP_MS) {
      this.lastReminderSweep = now.getTime();
      await this.sweepReminders();
    }
    await withPlatformTx(this.ctx.pool, (db) => releaseQuietHeld(db, now));
    const expired = await withPlatformTx(this.ctx.pool, (db) => expireDue(db, now, EXPIRE_BATCH));
    if (expired > 0) this.log.warn({ event: "notification.expired", count: expired }, "有通知过了有效期，不再发送");
    const abandoned = await withPlatformTx(this.ctx.pool, (db) => failAbandoned(db, now, EXPIRE_BATCH));
    for (const row of abandoned) this.log.error({ event: "notification.outcome_unknown", notificationId: row.id, eventType: row.event, orderId: row.orderId }, "发送途中服务中断，不知道这封发出去了没有：不自动重发，可在后台手动重试");
    const result: NotificationSweepResult = { expanded, expired, abandoned: abandoned.length, sent: 0, retrying: 0, failed: 0, notConfigured: false };
    await this.ctx.integrations.ensureFresh();
    if (this.ctx.integrations.effective.email.config === null) {
      result.notConfigured = true;
      const marked = await withPlatformTx(this.ctx.pool, (db) => markWaitingForConfig(db, NOT_CONFIGURED_MESSAGE, now));
      if (marked > 0) this.log.warn({ event: "notification.not_configured", count: marked }, "邮件发送还没有配置，这些通知先留着，配好后自动发送");
      return result;
    }
    const due = await withPlatformTx(this.ctx.pool, (db) => claimDueNotifications(db, now, new Date(now.getTime() + NOTIFICATION_LEASE_MS), SEND_BATCH, { preparing: true }));
    const queue = [...due];
    const worker = async (): Promise<void> => {
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
        const done = await this.deliver(next, false);
        if (done?.status === "sent") result.sent += 1;
        else if (done?.status === "failed") result.failed += 1;
        else if (done?.status === "pending") result.retrying += 1;
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    return result;
  }

  /** 发件箱 → 发送记录。一条事件一个短事务；一条出错只影响它自己（记下来，到上限就不再处理、运营后台看得到），不卡后面的。 */
  async expandEvents(now: Date): Promise<number> {
    let expanded = 0;
    for (let index = 0; index < EXPAND_BATCH; index += 1) {
      let current: StoredNotificationEvent | undefined;
      let did = false;
      try {
        did = await withPlatformTx(this.ctx.pool, async (db) => {
          const [event] = await claimPendingEvents(db, 1);
          if (event === undefined) return false;
          current = event;
          await this.expandOne(db, event, now);
          await markEventExpanded(db, event.id, now);
          return true;
        });
      } catch (err) {
        if (current === undefined) throw err;
        const failed = current;
        const code = dbCodeOf(err) ?? "EXPAND_FAILED";
        const attempts = await withPlatformTx(this.ctx.pool, (db) => recordExpandFailure(db, failed.id, code, EXPAND_MAX_ATTEMPTS, now));
        this.log.error({ event: "notification.expand_failed", eventId: failed.id, eventType: failed.event, orderId: failed.orderId, errorCode: code, attempts }, "这个通知事件展开时出错；出错次数到上限后不再处理，运营后台能看到数量");
        continue;
      }
      if (!did) break;
      expanded += 1;
    }
    return expanded;
  }

  private async expandOne(db: Db, event: StoredNotificationEvent, now: Date): Promise<void> {
    if (!isNotificationEvent(event.event)) return;
    const order = event.orderId === null ? null : event.tenantId === null ? await findOrderForPlatform(db, event.orderId) : await findOrderOfTenant(db, event.tenantId, event.orderId);
    const targets: Target[] = [];
    for (const audience of notificationAudiences(event.event)) targets.push(...(await this.targetsOf(db, event, audience, order)));
    // 改了用车时间：还在等的记录（确认、派车、提醒……）有效期跟着改（ADR 0049「有效期」）
    if (event.event === "order.changed" && order !== null && event.orderId !== null && Array.isArray(event.data["fields"]) && event.data["fields"].includes("service_time")) {
      await rebaseServiceExpiry(db, event.orderId, order.serviceAt, NOTIFICATION_SERVICE_BOUND_EVENTS);
    }
    if (targets.length === 0) this.log.warn({ event: "notification.no_recipient", eventType: event.event, orderId: event.orderId, tenantId: event.tenantId }, "这个事件没有可以通知的人");
    if (typeof event.data["dispute_until"] === "string" && dateOf(event.data["dispute_until"]) === null) throw new Error("事件的 dispute_until 不是时间");
    const expiresAt = notificationExpiresAt(event.event, { occurredAt: event.occurredAt, serviceAt: order?.serviceAt ?? null, disputeUntil: dateOf(event.data["dispute_until"]), confirmDueAt: dateOf(event.data["confirm_due_at"]) });
    for (const target of targets) {
      await insertNotification(db, { eventId: event.id, tenantId: target.tenantId, event: event.event, audience: target.audience, locale: LOCALE, channel: CHANNEL, recipient: target.recipient, orderId: event.orderId, orderNo: target.orderNo, expiresAt, now });
    }
  }

  private async targetsOf(db: Db, event: StoredNotificationEvent, audience: NotificationAudience, order: Order | null): Promise<Target[]> {
    switch (audience) {
      case "guest": {
        // 需求「客人：由渠道发；自有官网由平台发邮件」：官网的单才发。这一行可能已转给救援供应商，客人的那张看现在的行
        if (event.orderId === null) return [];
        const current = await findOrderForPlatform(db, event.orderId);
        if (current === null || !(await orderHasSiteLink(db, event.orderId))) return [];
        // 脱敏后没有地址可发（ADR 0055）
        if (current.passengerAnonymizedAt !== null) return [];
        const email = current.passenger.email.trim();
        // tenant_id 记事件那一家（数据库保证发送记录和事件是同一家）；救援后这单换了供应商，发送时看的是现在的行
        return email === "" || event.tenantId === null ? [] : [{ audience, recipient: email, tenantId: event.tenantId, orderNo: current.orderNo }];
      }
      case "tenant": {
        if (event.tenantId === null) return [];
        const emails = event.event.startsWith("payout_account.") ? await tenantAdminRecipients(db, event.tenantId) : await tenantRecipients(db, event.tenantId);
        return emails.map((recipient) => ({ audience, recipient, tenantId: event.tenantId, orderNo: order?.orderNo ?? null }));
      }
      case "staff":
        return this.staffTargets(db, event, order);
      case "driver": {
        // 只有编号在事件里；地址现取。没有邮箱（刚被删了）就没有发送记录，发送状态显示「没有邮箱」
        const driverId = event.data["driver_id"];
        if (event.tenantId === null || typeof driverId !== "string") return [];
        const email = (await findDriver(db, event.tenantId, driverId))?.email?.trim() ?? "";
        return email === "" ? [] : [{ audience, recipient: email, tenantId: event.tenantId, orderNo: order?.orderNo ?? null }];
      }
    }
  }

  private async staffTargets(db: Db, event: StoredNotificationEvent, order: Order | null): Promise<Target[]> {
    const rule = STAFF_RULES[event.event];
    if (rule === undefined) return [];
    const sale = order === null ? null : await findSale(db, order.id);
    const recipients = (await activeStaff(db))
      .filter(({ role }) => {
        const grant = resolvePlatformGrant(role);
        if ("roles" in rule ? !rule.roles.includes(role.key) : !grantCan(grant, rule.action)) return false;
        if (!scopeIsRestricted(grant.scope)) return true;
        // 限定了数据范围的人（ADR 0030）：只收范围内订单的通知，收不到不属于订单的
        return order !== null && scopeAllowsCity(grant.scope, order.cityId) && (sale === null || scopeAllowsChannel(grant.scope, sale.channelId));
      })
      .map(({ email }) => email);
    return uniqueRecipients(recipients).map((recipient) => ({ audience: "staff" as const, recipient, tenantId: null, orderNo: order?.orderNo ?? null }));
  }

  /** 用车前 24 小时的提醒：扫出该提醒的单，入发件箱（同一个用车时刻只有一条）。 */
  async sweepReminders(): Promise<number> {
    const now = this.ctx.now();
    return withPlatformTx(this.ctx.pool, async (db) => {
      const due = await listReminderDue(db, now, REMINDER_WINDOW_MS, REMINDER_BATCH);
      for (const row of due) {
        await enqueueNotification(db, { event: "order.service_reminder", tenantId: row.tenantId, orderId: row.orderId, dedupeKey: `order.service_reminder:${row.orderId}:${row.serviceAtMs}:${row.revision}`, data: { service_at_ms: row.serviceAtMs } }, now);
      }
      return due.length;
    });
  }

  /** 发一次并记结果。`manual`：手动重试，不看免打扰，失败就是失败、不再排重试。 */
  async deliver(notification: Notification, manual: boolean): Promise<Notification | null> {
    const attemptNo = notification.attempts + 1;
    let prepared: Prepared;
    try {
      prepared = notification.audience === "driver" ? await this.prepareForDriver(notification) : await withPlatformTx(this.ctx.pool, (db) => this.prepare(db, notification, manual));
    } catch (err) {
      // 这单解不开：重试也没用，记失败（错误码，不带内容），不占队列（ADR 0057）
      if (isPassengerDecryptFailure(err)) return this.finish(notification, { status: "failed", attempts: attemptNo, code: PASSENGER_DECRYPT_FAILED, message: null });
      // 不记错误对象本身：数据库错误的详情里可能带着行内容（收件人）
      this.log.warn({ event: "notification.prepare_failed", notificationId: notification.id, dbCode: dbCodeOf(err) }, "准备邮件内容时出错，稍后再试");
      return this.finish(notification, this.afterFailure(notification, "UNEXPECTED", null, attemptNo, manual));
    }
    if (prepared.kind === "stale") return this.finish(notification, { status: "expired", attempts: notification.attempts, code: prepared.code ?? "ORDER_STATE_CHANGED", message: null });
    if (prepared.kind === "hold") return this.finish(notification, { status: "pending", attempts: notification.attempts, nextAttemptAt: prepared.until, code: "QUIET_HOURS", message: null });
    if (prepared.kind === "render_failed") {
      this.log.error({ event: "notification.failed", notificationId: notification.id, eventType: notification.event, orderId: notification.orderId, errorCode: "RENDER_FAILED" }, "通知的内容生成失败：缺变量或没有模板");
      return this.finish(notification, { status: "failed", attempts: attemptNo, code: "RENDER_FAILED", message: null });
    }
    // 最后一道：租约还是自己的才发（可能已被判中断、被别人接手）。从这里起进程退出才算「可能已发出」
    const mine = await withPlatformTx(this.ctx.pool, (db) => beginSending(db, notification, new Date(this.ctx.now().getTime() + NOTIFICATION_LEASE_MS)));
    if (!mine) {
      this.log.warn({ event: "notification.lease_lost", notificationId: notification.id }, "这条通知的租约已被接手，这一封不发");
      return null;
    }
    const result = await sendMail(this.ctx, prepared.message);
    if (result.ok) return this.finish(notification, { status: "sent", attempts: attemptNo, messageId: result.messageId });
    return this.finish(notification, this.afterFailure(notification, result.code, result.message, attemptNo, manual));
  }

  private afterFailure(notification: Notification, code: string, message: string | null, attemptNo: number, manual: boolean): NotificationOutcome {
    const logged = { notificationId: notification.id, eventType: notification.event, orderId: notification.orderId, errorCode: code };
    if (manual) return { status: "failed", attempts: attemptNo, code, message };
    const later = (ms: number): Date => new Date(this.ctx.now().getTime() + ms);
    if (code === "NOT_CONFIGURED") return { status: "pending", attempts: notification.attempts, nextAttemptAt: later(0), code, message };
    const action = notificationFailureAction(code, attemptNo);
    if (action.kind === "hold") {
      this.log.warn({ event: "notification.config_problem", ...logged }, "邮件配置有问题，这封不算次数，稍后再试");
      return { status: "pending", attempts: notification.attempts, nextAttemptAt: later(action.delaySeconds * 1000), code, message };
    }
    if (action.kind === "retry") {
      this.log.warn({ event: "notification.retry", attempts: attemptNo, ...logged }, "发信失败，稍后重试");
      return { status: "pending", attempts: attemptNo, nextAttemptAt: later(action.delaySeconds * 1000), code, message };
    }
    this.log.error({ event: "notification.failed", attempts: attemptNo, ...logged }, "通知最终发送失败，需要人工处理（可在后台手动重试）");
    return { status: "failed", attempts: attemptNo, code, message };
  }

  private async finish(notification: Notification, outcome: NotificationOutcome): Promise<Notification | null> {
    const saved = await withPlatformTx(this.ctx.pool, (db) => finishNotification(db, notification, outcome, this.ctx.now()));
    if (saved === null) this.log.warn({ event: "notification.lease_lost", notificationId: notification.id }, "这条通知的租约已被接手，本次结果不记");
    return saved;
  }

  /** 按现在的订单现取现渲染。查看链接在这里新生成（库里只有哈希），原文只在返回的邮件内容里。 */
  private async prepare(db: Db, notification: Notification, manual: boolean): Promise<Prepared> {
    const event = await findEvent(db, notification.eventId);
    if (event === null) return { kind: "render_failed" };
    let order: Order | null = null;
    if (notification.orderId !== null) {
      order = notification.audience === "tenant" && notification.tenantId !== null ? await findOrderOfTenant(db, notification.tenantId, notification.orderId) : await findOrderForPlatform(db, notification.orderId);
      const facts = order === null ? null : { status: order.status, serviceAtMs: order.serviceAt.getTime(), driverId: order.dispatch.driverId, vehicleId: order.dispatch.vehicleId };
      if (notificationStale(notification.event, event.data, facts, { now: this.ctx.now(), audience: notification.audience })) return { kind: "stale" };
    }
    // 等处理的通知：申请已经有结论了，再发就是让人去处理一件已经结束的事
    if (notification.event === "order.change_pending" && notification.tenantId !== null && typeof event.data["change_id"] === "string") {
      const change = await findOrderChange(db, notification.tenantId, event.data["change_id"]);
      if (change === null || !orderChangeOpen(change.status)) return { kind: "stale", code: "CHANGE_DECIDED" };
    }
    const now = this.ctx.now();
    if (!manual && notification.audience === "tenant" && notification.tenantId !== null) {
      const { quietHours } = await findNotificationSettings(db, notification.tenantId);
      if (quietHours !== null) {
        const until = notificationQuietUntil({ event: notification.event, quietHours, now, timeZone: TENANT_RULES.timeZone, serviceAt: order?.serviceAt ?? null, serviceDate: order?.serviceDate ?? null, serviceTimeZone: order?.timezone ?? null, expiresAt: notification.expiresAt, confirmDueAt: dateOf(event.data["confirm_due_at"]) });
        if (until !== null) return { kind: "hold", until };
      }
    }
    const template = findNotificationTemplate(notification.event, notification.audience, notification.locale as "zh-CN", notification.channel as "email");
    if (template === null) return { kind: "render_failed" };
    const variables: Record<string, string | undefined> = { ...(await this.variablesOf(db, notification, event, order)) };
    if (templateNeedsViewLink(template)) {
      if (order === null) return { kind: "render_failed" };
      const link = newSiteLink(order.serviceAt, now);
      await insertSiteOrderLink(db, { orderId: order.id, tokenHash: link.tokenHash, issuedVia: "email", createdAt: now, expiresAt: link.expiresAt });
      variables["view_url"] = `${this.ctx.config.publicBaseUrl}/book/order#${link.token}`;
    }
    const rendered = renderNotification(template, variables);
    if (rendered === null) return { kind: "render_failed" };
    // 客人的地址按订单现在的乘客邮箱：等待发送期间改了邮箱，旧地址不能再收到查看链接
    if (notification.audience === "guest" && order !== null && order.passengerAnonymizedAt !== null) return { kind: "render_failed" };
    const to = notification.audience === "guest" && order !== null ? order.passenger.email.trim() : notification.recipient;
    if (to !== notification.recipient) await updateRecipient(db, notification, to);
    return { kind: "message", message: { to, subject: rendered.subject, text: rendered.text } };
  }

  /**
   * 发给司机的（ADR 0058）：在租户事务里锁住订单、复查、现生成邮件专用链接，原文只在返回的邮件内容里。免打扰不适用：司机不是供应商员工。
   * 收件人按司机现在的邮箱，记录跟着改。
   */
  private async prepareForDriver(notification: Notification): Promise<Prepared> {
    const event = await withPlatformTx(this.ctx.pool, (db) => findEvent(db, notification.eventId));
    if (event === null || notification.tenantId === null || notification.orderId === null) return { kind: "render_failed" };
    const tenantId = notification.tenantId;
    const orderId = notification.orderId;
    const prepared = await withTenantTx(this.ctx.pool, tenantId, (db) => (isDriverNoticeEvent(notification.event) ? prepareDriverNotice(db, this.ctx, { event: notification.event, tenantId, orderId, data: event.data }) : prepareDriverLinkEmail(db, this.ctx, { requestId: event.id, tenantId, orderId, data: event.data })));
    if (prepared.kind === "blocked") return { kind: "stale", code: prepared.code };
    if (prepared.kind === "render_failed") return prepared;
    if (prepared.message.to !== notification.recipient) await withPlatformTx(this.ctx.pool, (db) => updateDriverRecipient(db, notification.id, prepared.message.to));
    return { kind: "message", message: prepared.message };
  }

  private async variablesOf(db: Db, notification: Notification, event: StoredNotificationEvent, order: Order | null): Promise<NotificationVariables> {
    switch (notification.audience) {
      case "guest":
        return order === null ? {} : guestVariables(db, event, order);
      case "tenant":
        return tenantVariables(this.ctx, db, event, order);
      case "staff":
        return staffVariables(this.ctx, notification, event);
      case "driver":
        return {};
    }
  }

  /** 手动重试：在调用方把它租下之后马上发一次。 */
  async deliverNow(leased: Notification): Promise<Notification> {
    const done = await this.deliver(leased, true);
    return done ?? ((await withPlatformTx(this.ctx.pool, (db) => findNotification(db, leased.id))) as Notification);
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    const run = (): void => {
      this.ticking = this.tick()
        .catch((err: unknown) => this.log.warn({ event: "notification.tick_failed", dbCode: dbCodeOf(err) }, "通知任务这一轮出错，下一轮再试"))
        .finally(() => {
          this.ticking = null;
          if (!this.stopped) this.schedule(run, TICK_INTERVAL_MS);
        });
    };
    this.schedule(run, FIRST_TICK_MS);
  }

  private schedule(run: () => void, delayMs: number): void {
    this.timer = setTimeout(run, delayMs);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (this.ticking !== null) await Promise.race([this.ticking, new Promise((resolve) => setTimeout(resolve, STOP_WAIT_MS).unref())]);
  }
}

