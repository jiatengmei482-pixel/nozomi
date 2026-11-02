/**
 * 运营核实后把官网订单链接发给客人（M4-30，ADR 0061）。官网「查订单」只把链接发到下单邮箱；只留了手机号、邮箱填错的客人联系客服，
 * 客服核实身份后在订单详情里重发：
 * - 发到下单邮箱（`order.view_link_resend`：运营、客服）：直接排进通知中心，收件人是订单上现在的邮箱；
 * - 发到核实后的新邮箱：等于把订单交给另一个人，发起双人复核，另一位同事（`order.view_link_review`：运营）批准时才排进去。
 *   新邮箱不改订单上的邮箱（客人打开链接后自己改，改单的规则照旧），只收这一封。
 * 两种都要填核实方式和原因，全程审计（审计、复核、应答里只有打码后的地址）。链接在发信那一刻新签发，旧链接不受影响。
 * 权限和数据范围由接口层检查（`authenticatePlatform`、`assertPlatformOrderInScope`）。
 */
import { randomUUID } from "node:crypto";
import {
  VIEW_LINK_RESEND_REFUSAL_MESSAGES,
  type ViewLinkResendRefusal,
  type ViewLinkTarget,
  type ViewLinkVerification,
  maskEmail,
  notificationExpiresAt,
  viewLinkResendRefusal,
} from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { type Db, withPlatformTx } from "../db/context.ts";
import { AppError } from "../errors.ts";
import type { Approval } from "../repos/approvals.ts";
import { type AuditOrigin, insertAuditLog } from "../repos/audit-logs.ts";
import { enqueueNotification, insertNotification, markEventExpanded, orderHasSiteLink } from "../repos/notifications.ts";
import { type Order, findOrderForPlatform } from "../repos/orders.ts";
import { type ViewLinkRequest, closeViewLinkRequest, findPendingViewLinkRequest, insertViewLinkRequest, listViewLinkRequests, lockPendingViewLinkRecipient } from "../repos/view-link-requests.ts";
import { type ApprovalKind, requestApproval } from "./approvals.ts";
import { consoleOrigin, platformActor } from "./audit.ts";
import { notFound } from "./errors.ts";
import type { PlatformPrincipal } from "./platform-auth.ts";
import { rateLimited, takeRateSlot } from "./rate-limit.ts";

export const VIEW_LINK_EMAIL_KIND = "order.view_link_email";

const HISTORY_LIMIT = 20;

function refused(refusal: ViewLinkResendRefusal): AppError {
  return new AppError(409, refusal, VIEW_LINK_RESEND_REFUSAL_MESSAGES[refusal]);
}

const maskedOrNull = (email: string): string | null => (email.trim() === "" ? null : maskEmail(email.trim()));

async function refusalOf(db: Db, order: Order, target: ViewLinkTarget, newEmail: string | null): Promise<ViewLinkResendRefusal | null> {
  return viewLinkResendRefusal({ siteOrder: await orderHasSiteLink(db, order.id), anonymized: order.passengerAnonymizedAt !== null, emailOnFile: order.passenger.email, target, newEmail });
}

export interface ViewLinkStatus {
  /** 能不能发到下单邮箱；不能时 `unavailableReason` 说明（不是官网的单、已脱敏、没有下单邮箱） */
  available: boolean;
  unavailableReason: ViewLinkResendRefusal | null;
  emailMasked: string | null;
  pendingReview: ViewLinkRequest | null;
  requests: ViewLinkRequest[];
}

export async function viewLinkStatus(ctx: AppContext, orderId: string): Promise<ViewLinkStatus> {
  return withPlatformTx(
    ctx.pool,
    async (db) => {
      const order = await findOrderForPlatform(db, orderId);
      if (order === null) throw notFound("订单");
      const reason = await refusalOf(db, order, "original", null);
      return { available: reason === null, unavailableReason: reason, emailMasked: order.passengerAnonymizedAt === null ? maskedOrNull(order.passenger.email) : null, pendingReview: await findPendingViewLinkRequest(db, orderId), requests: await listViewLinkRequests(db, orderId, HISTORY_LIMIT) };
    },
    { snapshot: true },
  );
}

export interface ViewLinkResendInput {
  target: ViewLinkTarget;
  /** 发到新邮箱时的地址（已校验格式）；发到原邮箱时 null */
  email: string | null;
  verification: ViewLinkVerification;
  reason: string;
}

async function queueStaffViewLink(db: Db, order: Order, data: Record<string, string>, now: Date): Promise<string> {
  const eventId = randomUUID();
  await enqueueNotification(db, { id: eventId, event: "order.view_link", tenantId: order.tenantId, orderId: order.id, dedupeKey: `order.view_link:staff:${eventId}`, data: { via: "staff", ...data } }, now);
  return eventId;
}

async function auditSent(db: Db, origin: AuditOrigin, order: Order, after: Record<string, string | null>): Promise<void> {
  await insertAuditLog(db, origin, { tenantId: null, resource: "order", resourceId: order.id, action: "send_view_link", before: null, after: { order_no: order.orderNo, ...after } });
}

/** 发起一次重发。发到原邮箱：直接排进通知中心；发到新邮箱：发起复核。同一张单每小时最多 5 次。 */
export async function resendViewLink(ctx: AppContext, principal: PlatformPrincipal, orderId: string, input: ViewLinkResendInput, ip: string): Promise<{ request: ViewLinkRequest; approval: Approval | null }> {
  const now = ctx.now();
  const origin = consoleOrigin(platformActor(principal.user), ip, now);
  return withPlatformTx(ctx.pool, async (db) => {
    const order = await findOrderForPlatform(db, orderId, { lock: true });
    if (order === null) throw notFound("订单");
    const refusal = await refusalOf(db, order, input.target, input.email);
    if (refusal !== null) throw refused(refusal);
    const pending = input.target === "new_email" ? await findPendingViewLinkRequest(db, orderId) : null;
    if (pending !== null) throw new AppError(409, "VIEW_LINK_REVIEW_PENDING", "这张单已经有一条「发到新邮箱」在等审核，请先处理那一条", { approval_id: pending.approvalId });
    const slot = await takeRateSlot(db, orderId, "staff_view_link", now);
    if (!slot.allowed) throw rateLimited(slot.retryAfterSeconds);
    const requestId = randomUUID();
    const common = { id: requestId, orderId, sealTenantId: order.tenantId, verification: input.verification, requestedBy: principal.user.id, now };
    if (input.target === "original") {
      const emailMasked = maskEmail(order.passenger.email.trim());
      const eventId = await queueStaffViewLink(db, order, { target: "original", request_id: requestId }, now);
      const request = await insertViewLinkRequest(db, { ...common, target: "original", recipient: null, recipientMasked: emailMasked, approvalId: null, notificationEventId: eventId });
      await auditSent(db, origin, order, { target: "original", email_masked: emailMasked, verification: input.verification, reason: input.reason, request_id: requestId });
      return { request, approval: null };
    }
    const email = input.email as string;
    const emailMasked = maskEmail(email);
    const approval = await requestApproval(db, origin, principal, {
      kind: VIEW_LINK_EMAIL_KIND_DEF,
      resourceId: orderId,
      summary: `把订单 ${order.orderNo} 的链接发到核实后的新邮箱 ${emailMasked}`,
      payload: { order_id: orderId, order_no: order.orderNo, request_id: requestId, email_masked: emailMasked, order_email_masked: maskedOrNull(order.passenger.email), verification: input.verification },
      before: null,
      baseVersion: null,
      note: input.reason,
    });
    const request = await insertViewLinkRequest(db, { ...common, target: "new_email", recipient: email, recipientMasked: emailMasked, approvalId: approval.id, notificationEventId: null });
    return { request, approval };
  });
}

/**
 * 「发到核实后的新邮箱」的复核：批准时这张单还要是官网的、没脱敏；把这一封直接写进通知中心（事件已展开，收件人就是这个地址），
 * 新邮箱从 `view_link_requests` 清掉。驳回、撤回时同样清掉。发起人不能批自己发起的（通用规则）。
 */
const VIEW_LINK_EMAIL_KIND_DEF: ApprovalKind = {
  kind: VIEW_LINK_EMAIL_KIND,
  resource: "order",
  readAction: "order.read",
  requestAction: "order.view_link_resend",
  reviewAction: "order.view_link_review",
  orderScoped: true,
  async apply(db, approval: Approval, origin: AuditOrigin) {
    const now = origin.occurredAt;
    const pending = await lockPendingViewLinkRecipient(db, approval.id);
    if (pending === null) throw new AppError(409, "APPROVAL_STALE", "这条重发已经有结论了；请驳回");
    const order = await findOrderForPlatform(db, pending.request.orderId, { lock: true });
    if (order === null) throw notFound("订单");
    const refusal = await refusalOf(db, order, "new_email", pending.recipient);
    if (refusal !== null) throw new AppError(409, "APPROVAL_STALE", `${VIEW_LINK_RESEND_REFUSAL_MESSAGES[refusal]}；请驳回`, { reason: refusal });
    const eventId = await queueStaffViewLink(db, order, { target: "new_email", request_id: pending.request.id }, now);
    await markEventExpanded(db, eventId, now);
    await insertNotification(db, { eventId, tenantId: order.tenantId, event: "order.view_link", audience: "guest", locale: "zh-CN", channel: "email", recipient: pending.recipient, orderId: order.id, orderNo: order.orderNo, expiresAt: notificationExpiresAt("order.view_link", { occurredAt: now, serviceAt: order.serviceAt, disputeUntil: null }), now });
    await closeViewLinkRequest(db, approval.id, { status: "queued", notificationEventId: eventId }, now);
    await auditSent(db, origin, order, { target: "new_email", email_masked: pending.request.recipientMasked, verification: pending.request.verification, approval_id: approval.id, request_id: pending.request.id, requested_by: pending.request.requestedBy.id });
  },
  async onDismiss(db, approval, now) {
    await closeViewLinkRequest(db, approval.id, { status: "dismissed" }, now);
  },
};

export const VIEW_LINK_APPROVAL_KINDS: readonly ApprovalKind[] = [VIEW_LINK_EMAIL_KIND_DEF];
