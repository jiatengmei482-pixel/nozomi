/**
 * 司机链接自动发邮件（M4-27，ADR 0058）：什么时候发起、重发、发送前复查和生成邮件专用链接、发送状态。规则在 @nozomi/domain 的 driver-link-email.ts。
 *
 * - 发起都在订单锁之内，只写发送请求和发件箱，真正发信在后台任务里（发不出去不影响派车）。
 * - **令牌原文**只在 `prepareDriverLinkEmail` 返回的邮件内容里：不进发件箱、发送记录、日志、审计。
 * - 发送前在租户事务里先锁订单再读链接：和改派、吊销、重新生成排队，排在它们后面就读得到已吊销，不发；排在前面，新链接会被它们一起吊销。
 * - 收件人永远是这一刻司机资料里的邮箱。
 */
import { randomUUID } from "node:crypto";
import {
  DRIVER_LINK_EMAIL_STATUSES,
  type DriverLinkEmailView,
  type DriverLinkSendBlock,
  type LocalizedText,
  type MailMessage,
  driverLinkEmailErrorText,
  driverLinkEmailView,
  driverLinkExpiry,
  driverLinkResendWait,
  driverLinkSendBlock,
  driverTripSummary,
  findNotificationTemplate,
  instantToLocal,
  maskEmail,
  renderNotification,
} from "@nozomi/domain";
import { newDriverToken } from "../auth/driver-token.ts";
import type { AppContext } from "../context.ts";
import { type Db, withTenantTx } from "../db/context.ts";
import { AppError } from "../errors.ts";
import { insertAuditLog } from "../repos/audit-logs.ts";
import { type DriverLink, currentDriverLink, findDriverLinkById, insertDriverLink } from "../repos/dispatch.ts";
import { driverLinkEmailUsage, insertDriverLinkEmail, latestDriverLinkEmailId, latestDriverLinkEmailOfLink } from "../repos/driver-link-emails.ts";
import { type Driver, findDriver } from "../repos/fleet.ts";
import { enqueueNotification, findNotificationSettings } from "../repos/notifications.ts";
import { type Order, findTenantOrder } from "../repos/orders.ts";
import { findOrderNames } from "../repos/site.ts";
import { consoleOrigin, tenantActor } from "./audit.ts";
import { notFound } from "./errors.ts";
import { assertTenantCanOperate, orderStateInvalid } from "./fulfilment.ts";
import { rateLimited } from "./rate-limit.ts";
import type { TenantPrincipal } from "./tenant-auth.ts";

export type DriverLinkEmailOutcome = DriverLinkEmailView;

const HOUR_MS = 3_600_000;
const nameOf = (name: LocalizedText | null | undefined): string | null => name?.zh ?? name?.en ?? name?.ja ?? name?.ko ?? null;
const clockText = (at: Date, timeZone: string): string => instantToLocal(at, timeZone).dateTime.replace("T", " ");

async function requestEmail(db: Db, input: { order: Order; driverId: string; assignmentId: string; linkId: string; trigger: "auto" | "resend"; requestedBy: string | null; now: Date }): Promise<void> {
  const { order, now } = input;
  // 请求的编号就是事件的编号：租户读不了发件箱，发送记录靠它对应回来
  const id = randomUUID();
  await enqueueNotification(db, { id, event: "order.driver_link", tenantId: order.tenantId, orderId: order.id, dedupeKey: `order.driver_link:${id}`, data: { driver_id: input.driverId, assignment_id: input.assignmentId, link_id: input.linkId } }, now);
  await insertDriverLinkEmail(db, order.tenantId, { id, orderId: order.id, assignmentId: input.assignmentId, driverId: input.driverId, linkId: input.linkId, trigger: input.trigger, requestedBy: input.requestedBy, requestedAt: now });
}

/** 这一单现在的发送状态。在调用方的事务里读。 */
export async function driverLinkEmailOutcome(db: Db, order: Order, link: DriverLink | null, now: Date): Promise<DriverLinkEmailOutcome> {
  const { driverLinkDelivery } = await findNotificationSettings(db, order.tenantId);
  const driver = order.dispatch.driverId === null ? null : await findDriver(db, order.tenantId, order.dispatch.driverId);
  return driverLinkEmailView({
    now,
    linkActive: link !== null && link.expiresAt.getTime() > now.getTime(),
    orderSendable: DRIVER_LINK_EMAIL_STATUSES.includes(order.status),
    mode: driverLinkDelivery,
    driverEmail: driver?.email ?? null,
    latest: link === null ? null : await latestDriverLinkEmailOfLink(db, order.tenantId, order.id, link.id),
  });
}

/** 派车、改派时（调用方持有订单锁、在同一个事务里）：自动模式且司机有邮箱就发起。手动模式、没邮箱什么都不写，只返回状态。 */
export async function requestDriverLinkEmailOnAssign(db: Db, input: { order: Order; driver: Driver; assignmentId: string; link: DriverLink; now: Date }): Promise<DriverLinkEmailOutcome> {
  const { order, driver, link, now } = input;
  const { driverLinkDelivery } = await findNotificationSettings(db, order.tenantId);
  if (driverLinkDelivery === "auto" && driver.email !== null) await requestEmail(db, { order, driverId: driver.id, assignmentId: input.assignmentId, linkId: link.id, trigger: "auto", requestedBy: null, now });
  return driverLinkEmailOutcome(db, order, link, now);
}

export async function getDriverLinkEmail(ctx: AppContext, tenantId: string, orderId: string): Promise<DriverLinkEmailOutcome> {
  const now = ctx.now();
  return withTenantTx(
    ctx.pool,
    tenantId,
    async (db) => {
      const order = await findTenantOrder(db, tenantId, orderId);
      if (order === null) throw notFound("订单");
      return driverLinkEmailOutcome(db, order, await currentDriverLink(db, tenantId, orderId), now);
    },
    { snapshot: true },
  );
}

/** 重发（`order.dispatch`）：只是发邮件，不动现有的链接。判断都在订单锁之内：同时点两下只有一下成功，和改派同时到的排在它前面或后面都不会发错人。 */
export async function resendDriverLinkEmail(ctx: AppContext, writer: { principal: TenantPrincipal; ip: string }, orderId: string): Promise<DriverLinkEmailOutcome> {
  const tenantId = writer.principal.tenantId;
  const now = ctx.now();
  return withTenantTx(ctx.pool, tenantId, async (db) => {
    const order = await findTenantOrder(db, tenantId, orderId, { lock: true });
    if (order === null) throw notFound("订单");
    assertTenantCanOperate(order, "resend_driver_link_email");
    if (!DRIVER_LINK_EMAIL_STATUSES.includes(order.status) || order.dispatch.driverId === null) throw orderStateInvalid(order.status, "resend_driver_link_email");
    const link = await currentDriverLink(db, tenantId, orderId);
    if (link === null) throw new AppError(409, "DRIVER_LINK_NOT_ACTIVE", "这一单现在没有有效的司机链接，请先重新生成");
    if (link.expiresAt.getTime() <= now.getTime()) throw new AppError(409, "DRIVER_LINK_EXPIRED", "用车结束已超过 24 小时，不能再发司机链接");
    const { driverLinkDelivery } = await findNotificationSettings(db, tenantId);
    if (driverLinkDelivery !== "auto") throw new AppError(409, "DRIVER_LINK_EMAIL_MANUAL", "当前设置是调度员手动发送，系统不发邮件。请复制链接发给司机");
    const driver = await findDriver(db, tenantId, order.dispatch.driverId);
    if (driver === null || driver.email === null) throw new AppError(409, "DRIVER_EMAIL_MISSING", "这位司机没有邮箱，请到车队里补上，或复制链接手动发");
    const usage = await driverLinkEmailUsage(db, tenantId, orderId, new Date(now.getTime() - HOUR_MS));
    const wait = driverLinkResendWait({ now, ...usage });
    if (wait !== null) throw rateLimited(wait);
    await requestEmail(db, { order, driverId: driver.id, assignmentId: link.assignmentId, linkId: link.id, trigger: "resend", requestedBy: writer.principal.user.id, now });
    await insertAuditLog(db, consoleOrigin(tenantActor(writer.principal.user), writer.ip, now), { tenantId, resource: "driver_link", resourceId: link.id, action: "retry", before: null, after: { order_id: orderId, recipient: maskEmail(driver.email) } });
    return driverLinkEmailOutcome(db, order, link, now);
  });
}

export type PreparedDriverEmail = { kind: "message"; message: MailMessage } | { kind: "blocked"; code: DriverLinkSendBlock } | { kind: "render_failed" };

/**
 * 发送前（后台任务，租户事务，事件里的租户编号）：先锁订单，再读链接、司机、设置，复查都过了才生成邮件专用链接。
 * 令牌原文只在返回的邮件内容里。失败的尝试留下的链接没有人拿得到原文，到期自然失效。
 */
export async function prepareDriverLinkEmail(db: Db, ctx: AppContext, input: { requestId: string; tenantId: string; orderId: string; data: Readonly<Record<string, unknown>> }): Promise<PreparedDriverEmail> {
  const { tenantId, orderId, data } = input;
  const driverId = data["driver_id"];
  const assignmentId = data["assignment_id"];
  const linkId = data["link_id"];
  if (typeof driverId !== "string" || typeof assignmentId !== "string" || typeof linkId !== "string") return { kind: "render_failed" };
  const now = ctx.now();
  const order = await findTenantOrder(db, tenantId, orderId, { lock: true });
  if (order === null) return { kind: "blocked", code: "ORDER_STATE_CHANGED" };
  const anchor = await findDriverLinkById(db, tenantId, linkId);
  const latestRequestId = await latestDriverLinkEmailId(db, tenantId, orderId);
  const { driverLinkDelivery } = await findNotificationSettings(db, tenantId);
  const driver = await findDriver(db, tenantId, driverId);
  const block = driverLinkSendBlock({
    now,
    request: { id: input.requestId, driverId, assignmentId },
    order: { status: order.status, driverId: order.dispatch.driverId },
    anchor,
    latestRequestId,
    mode: driverLinkDelivery,
    driver,
  });
  if (block !== null) return { kind: "blocked", code: block };
  // 用车时间可能改过：邮件链接按现在的时间算，已经过了的不再生成
  const expiresAt = driverLinkExpiry(order.serviceAt, order.packageHours);
  if (expiresAt.getTime() <= now.getTime()) return { kind: "blocked", code: "DRIVER_LINK_REVOKED" };
  const template = findNotificationTemplate("order.driver_link", "driver", "zh-CN", "email");
  if (template === null || driver === null || driver.email === null) return { kind: "render_failed" };
  const names = await findOrderNames(db, { cityId: order.cityId, placeId: order.placeId, vehicleGroupId: order.vehicleGroupId });
  const { token, tokenHash } = newDriverToken(tenantId);
  const rendered = renderNotification(template, {
    driver_name: driver.name,
    order_no: order.orderNo,
    service_time: order.serviceLocal.replace("T", " "),
    trip_summary: driverTripSummary({ city: nameOf(names.city?.name), category: order.category, direction: order.direction, place: nameOf(names.place?.name), packageHours: order.packageHours }),
    vehicle_group: nameOf(names.vehicleGroup?.name) ?? "见任务详情",
    driver_link_url: `${ctx.config.publicBaseUrl}/driver#${token}`,
    link_expires_at: clockText(expiresAt, order.timezone),
  });
  if (rendered === null) return { kind: "render_failed" };
  await insertDriverLink(db, tenantId, { purpose: "email", orderId, assignmentId, driverId, tokenHash, createdAt: now, expiresAt });
  return { kind: "message", message: { to: driver.email, subject: rendered.subject, text: rendered.text } };
}

/** 邮件有没有配置。只影响一句提示：取不到不能让已经成功的派车变成失败（ADR 0058「不阻塞派车」）。 */
export async function mailConfigured(ctx: AppContext): Promise<boolean> {
  try {
    await ctx.integrations.ensureFresh();
    return ctx.integrations.effective.email.config !== null;
  } catch {
    return true;
  }
}

/** 接口里的发送状态：地址一律打码；没有令牌。等待中且邮件没配置时带 `NOT_CONFIGURED`，页面提示调度员手动发；已经配好了就不再带（记录上的旧原因要等发出去才清）。 */
export function driverLinkEmailJson(view: DriverLinkEmailOutcome, configured: boolean): Record<string, unknown> {
  const errorCode = view.state !== "pending" ? view.errorCode : !configured ? "NOT_CONFIGURED" : view.errorCode === "NOT_CONFIGURED" ? null : view.errorCode;
  return {
    state: view.state,
    recipient_masked: view.recipient === null ? null : maskEmail(view.recipient),
    error_code: errorCode,
    error_message: driverLinkEmailErrorText(errorCode),
    requested_at: view.requestedAt?.toISOString() ?? null,
    sent_at: view.sentAt?.toISOString() ?? null,
    address_changed: view.addressChanged,
    can_resend: view.canResend,
  };
}
