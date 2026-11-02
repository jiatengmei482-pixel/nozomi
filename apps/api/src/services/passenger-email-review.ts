/**
 * 运营「代客人改单」改乘客邮箱要双人复核（M4-31，ADR 0065）。
 *
 * 订单上的邮箱决定之后带订单管理链接的通知发到哪：改掉它等于把订单交给另一个人，和「把订单链接发到核实后的新邮箱」（ADR 0061）同一类风险。
 * - `PATCH /platform/v1/orders/{id}` 里改了邮箱：这一项拿出来发起复核 `order.passenger_email`，批准前订单上的邮箱不变（之后的通知照旧发到原来的地址）；
 *   同一次提交的其他字段照常（联系信息直接生效、履约字段等供应商确认，ADR 0060），同一个事务；
 * - 发起要写核实方式和原因（和发到新邮箱同一套）；同一张单同时只有一条在等（409 `PASSENGER_EMAIL_REVIEW_PENDING`）；
 * - 另一位有 `order.view_link_review` 的同事（超级管理员、运营）批准时才改订单，按一次直接生效的联系信息改动处理（通知供应商、司机，告诉客人——新地址）；
 *   发起人不能批自己发起的（通用规则）；审核期间订单上的邮箱被客人或渠道改过的不能再批（`APPROVAL_STALE`）；
 * - 等审核期间新邮箱和发起时的邮箱加密存在 `passenger_email_changes`，有结论就清空；审计、复核记录、应答里只有打码地址。
 * 客人自己（官网订单链接）、渠道替客人改不经过这里。权限和数据范围由接口层检查。
 */
import { randomUUID } from "node:crypto";
import {
  PASSENGER_EMAIL_REVIEW_KIND,
  PASSENGER_EMAIL_REVIEW_REFUSAL_MESSAGES,
  type ViewLinkVerification,
  maskEmail,
  orderChangeStillApplicable,
  passengerEmailApprovalRefusal,
} from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { type Db, isUniqueViolation } from "../db/context.ts";
import { AppError } from "../errors.ts";
import type { Approval } from "../repos/approvals.ts";
import type { AuditOrigin } from "../repos/audit-logs.ts";
import { type Order, findOrderForPlatform } from "../repos/orders.ts";
import { type PassengerEmailChange, closePassengerEmailChange, findPendingPassengerEmailChange, insertPassengerEmailChange, lockPendingPassengerEmailChange } from "../repos/passenger-email-changes.ts";
import { type ApprovalKind, requestApproval } from "./approvals.ts";
import { consoleOrigin, platformActor } from "./audit.ts";
import { notFound } from "./errors.ts";
import { type OrderChangeInput, type PlatformChangeOutcome, applyApprovedPassengerEmail, changeForPlatform } from "./order-changes.ts";
import type { OrderLog } from "./orders.ts";
import type { PlatformPrincipal } from "./platform-auth.ts";

export interface PassengerEmailReviewInput {
  verification: ViewLinkVerification;
  reason: string;
}

const maskedOrNull = (email: string): string | null => (email.trim() === "" ? null : maskEmail(email.trim()));

function pendingConflict(pending: PassengerEmailChange | null): AppError {
  return new AppError(409, "PASSENGER_EMAIL_REVIEW_PENDING", "这张单已经有一次改乘客邮箱在等审核，请先处理那一条（批准、驳回或撤回）", { approval_id: pending?.approvalId ?? null });
}

/**
 * 运营代客人改单（`PATCH /platform/v1/orders/{id}`）。改了乘客邮箱时 `review` 必填（没写 400），邮箱这一项发起复核；其余照常。
 */
export async function changeOrderForPlatform(ctx: AppContext, principal: PlatformPrincipal, orderId: string, version: number, input: OrderChangeInput, review: PassengerEmailReviewInput | null, ip: string, log: OrderLog): Promise<PlatformChangeOutcome> {
  const hold = async (db: Db, order: Order, email: string, now: Date): Promise<PassengerEmailChange> => {
    const pending = await findPendingPassengerEmailChange(db, order.id);
    if (pending !== null) throw pendingConflict(pending);
    if (order.passengerAnonymizedAt !== null) throw new AppError(409, "PASSENGER_ANONYMIZED", PASSENGER_EMAIL_REVIEW_REFUSAL_MESSAGES.PASSENGER_ANONYMIZED);
    const given = review as PassengerEmailReviewInput;
    const emailMasked = maskEmail(email);
    const previousMasked = maskedOrNull(order.passenger.email);
    const origin = consoleOrigin(platformActor(principal.user), ip, now);
    const approval = await requestApproval(db, origin, principal, {
      kind: PASSENGER_EMAIL_KIND,
      resourceId: order.id,
      summary: `把订单 ${order.orderNo} 的乘客邮箱改成 ${emailMasked}`,
      payload: { order_id: order.id, order_no: order.orderNo, email_masked: emailMasked, order_email_masked: previousMasked, verification: given.verification },
      before: null,
      baseVersion: null,
      note: given.reason,
    });
    return insertPassengerEmailChange(db, {
      id: randomUUID(),
      orderId: order.id,
      sealTenantId: order.tenantId,
      email,
      previousEmail: order.passenger.email,
      emailMasked,
      previousEmailMasked: previousMasked,
      verification: given.verification,
      approvalId: approval.id,
      requestedBy: principal.user.id,
      now,
    });
  };
  try {
    return await changeForPlatform(ctx, principal, orderId, version, input, ip, log, { hold, reviewed: review !== null });
  } catch (err) {
    // 两个请求同时发起：订单行锁让后到的先看到前一条；这里兜住唯一索引
    if (isUniqueViolation(err, "passenger_email_changes_pending_key")) throw pendingConflict(null);
    throw err;
  }
}

/** 订单详情里显示的「等审核的改邮箱」（只有打码地址）。 */
export function pendingPassengerEmailChange(db: Db, orderId: string): Promise<PassengerEmailChange | null> {
  return findPendingPassengerEmailChange(db, orderId);
}

function stale(message: string, reason: string): AppError {
  return new AppError(409, "APPROVAL_STALE", `${message}；请驳回`, { reason });
}

/**
 * 批准：订单还能改乘客信息（服务没开始、没脱敏）、订单上的邮箱还是发起时的那个，才改成新邮箱。地址从 `passenger_email_changes` 清掉。
 * 驳回、撤回：同样清掉，订单不动。
 */
const PASSENGER_EMAIL_KIND: ApprovalKind = {
  kind: PASSENGER_EMAIL_REVIEW_KIND,
  resource: "order",
  readAction: "order.read",
  requestAction: "order.manage",
  reviewAction: "order.view_link_review",
  orderScoped: true,
  async apply(db, approval: Approval, origin: AuditOrigin) {
    const now = origin.occurredAt;
    const orderId = approval.payload["order_id"];
    // 先锁订单、后锁这条（和改单、取消同一个顺序）
    const order = typeof orderId === "string" ? await findOrderForPlatform(db, orderId, { lock: true }) : null;
    if (order === null) throw notFound("订单");
    const pending = await lockPendingPassengerEmailChange(db, approval.id);
    if (pending === null) throw stale("这次改邮箱已经有结论了", "NOT_PENDING");
    if (!orderChangeStillApplicable(order.status, ["passenger"])) throw stale("订单现在的状态已经不能改乘客信息了", "ORDER_STATE_INVALID");
    const refusal = passengerEmailApprovalRefusal({ anonymized: order.passengerAnonymizedAt !== null, emailOnFile: order.passenger.email, emailAtRequest: pending.previousEmail });
    if (refusal !== null) throw stale(PASSENGER_EMAIL_REVIEW_REFUSAL_MESSAGES[refusal], refusal);
    const changeId = await applyApprovedPassengerEmail(db, order, pending.email, pending.change.requestedBy.id, origin, now);
    await closePassengerEmailChange(db, approval.id, { status: "applied", changeId }, now);
  },
  async onDismiss(db, approval, now) {
    await closePassengerEmailChange(db, approval.id, { status: "dismissed" }, now);
  },
};

export const PASSENGER_EMAIL_APPROVAL_KINDS: readonly ApprovalKind[] = [PASSENGER_EMAIL_KIND];
