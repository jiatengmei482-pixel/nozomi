/**
 * 运营代供应商回传履约（M4-18，ADR 0052）：供应商系统故障时，运营代传出发、到达、接到客人、完成。
 * 需求《平台运营端》「人工介入能力」、接口 `POST /orders/{id}/events（代回传）`。
 *
 * - 规则和供应商、司机同一份（`applyFulfilmentEvent`）：先锁订单这一行再判断，和他们同时到的请求排队，不能跳步、不能重复；
 * - 不接受定位：代传的「已到达」没有距离，no-show 第 1 项不满足，代传不能给 no-show 提供证据；
 * - `completed` 不直接生效，发起双人复核（已完成的单进供应商账单、是终态）；批准时按当时的数据再校验一遍。
 * 权限和数据范围由接口层检查（`order.proxy_fulfilment`、`assertPlatformOrderInScope`）。
 */
import { type FulfilmentEventType, FULFILMENT_EVENT_NAMES, PROXY_TIME_ISSUE_MESSAGES, nextFulfilmentEvent, orderOperableByTenant, instantToLocal, proxyEffectiveOccurredAt, proxyEventNeedsReview, proxyFulfilmentTimeIssue } from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { type Db, withPlatformTx } from "../db/context.ts";
import { AppError } from "../errors.ts";
import { type Approval, findPendingApproval } from "../repos/approvals.ts";
import { type AuditOrigin, insertAuditLog } from "../repos/audit-logs.ts";
import { type Order, findOrderForPlatform } from "../repos/orders.ts";
import { validationFailed } from "../validation.ts";
import { type ApprovalKind, requestApproval } from "./approvals.ts";
import { consoleOrigin, platformActor } from "./audit.ts";
import { notFound, versionConflict } from "./errors.ts";
import { type ProxyMark, applyFulfilmentEvent, assertCompletionActual, orderStateInvalid } from "./fulfilment.ts";
import { PROXY_COMPLETE_KIND } from "./order-queries.ts";
import type { PlatformPrincipal } from "./platform-auth.ts";

export interface ProxyFulfilmentInput {
  type: FulfilmentEventType;
  occurredAt: Date;
  reason: string;
  actual: { minutes: number | null; km: number | null } | null;
}

export type ProxyFulfilmentResult = { kind: "applied"; order: Order } | { kind: "approval"; approval: Approval };

/** 上一个履约节点的时间：报的时间不能比它早，流水的时间不倒退。 */
function previousMilestone(order: Order): Date | null {
  const { dispatch } = order;
  if (order.status === "assigned") return dispatch.assignedAt;
  if (order.status === "departed") return dispatch.departedAt;
  if (order.status === "arrived") return dispatch.arrivedAt;
  if (order.status === "in_service") return dispatch.pickedUpAt;
  return null;
}

/** 未付款、已取消、救援中的单先单独说清楚；其余（跳步、重复、待派车、no-show 审核中）由状态机判断。 */
function assertOrderProxyable(order: Order, type: FulfilmentEventType): void {
  if (order.confirmedAt === null || order.status === "pending_payment") throw new AppError(409, "ORDER_STATE_INVALID", "这一单还没付款，不能代传履约", { status: order.status, action: type });
  if (order.status === "cancelled") throw new AppError(409, "ORDER_STATE_INVALID", "这一单已取消，不能代传履约", { status: order.status, action: type });
  if (!orderOperableByTenant(order.status)) throw new AppError(409, "ORDER_STATE_INVALID", "这一单在救援改派中或已转给其他供应商，不能代传履约", { status: order.status, action: type });
}

function assertTimeAllowed(order: Order, occurredAt: Date, now: Date): void {
  const issue = proxyFulfilmentTimeIssue({ occurredAt, previousAt: previousMilestone(order), serviceAt: order.serviceAt, now });
  if (issue !== null) throw validationFailed("body", [{ path: "/occurred_at", reason: issue, message: PROXY_TIME_ISSUE_MESSAGES[issue] }]);
}

async function applyProxy(db: Db, order: Order, input: Omit<ProxyFulfilmentInput, "occurredAt" | "reason">, mark: ProxyMark, requestedBy: string, origin: AuditOrigin): Promise<Order> {
  await applyFulfilmentEvent(db, order, { type: input.type, location: null, actual: input.actual }, { type: "platform_user", id: requestedBy, linkId: null }, origin.occurredAt, mark);
  const saved = (await findOrderForPlatform(db, order.id)) as Order;
  await insertAuditLog(db, origin, {
    tenantId: null,
    resource: "order",
    resourceId: order.id,
    action: "update",
    before: { status: order.status },
    after: { status: saved.status, event: input.type, source: "platform_proxy", occurred_at: mark.occurredAt.toISOString(), reason: mark.reason, requested_by: requestedBy, approval_id: mark.approvalId },
  });
  return saved;
}

/** 代传一步：出发、到达、接到客人立即生效；完成发起复核。`version` 是订单的 If-Match 版本号。 */
export async function reportProxyFulfilment(ctx: AppContext, principal: PlatformPrincipal, orderId: string, version: number, input: ProxyFulfilmentInput, ip: string): Promise<ProxyFulfilmentResult> {
  const now = ctx.now();
  const origin = consoleOrigin(platformActor(principal.user), ip, now);
  return withPlatformTx(ctx.pool, async (db): Promise<ProxyFulfilmentResult> => {
    const order = await findOrderForPlatform(db, orderId, { lock: true });
    if (order === null) throw notFound("订单");
    assertOrderProxyable(order, input.type);
    // 发起复核之前就要拦下跳步；生效时 applyFulfilmentEvent 还会按状态机再判断一次
    if (nextFulfilmentEvent(order.status) !== input.type) throw orderStateInvalid(order.status, input.type);
    if (order.version !== version) throw versionConflict(order.version);
    assertTimeAllowed(order, input.occurredAt, now);
    assertCompletionActual(order, input);
    if (!proxyEventNeedsReview(input.type)) {
      const mark: ProxyMark = { occurredAt: proxyEffectiveOccurredAt(input.occurredAt, previousMilestone(order)), reason: input.reason, approvedBy: null, approvalId: null };
      return { kind: "applied", order: await applyProxy(db, order, input, mark, principal.user.id, origin) };
    }
    const pending = await findPendingApproval(db, PROXY_COMPLETE_KIND, orderId);
    if (pending !== null) throw new AppError(409, "PROXY_COMPLETION_PENDING", "这一单已经有一条代传完成在等复核，请先处理那一条", { approval_id: pending.id });
    const approval = await requestApproval(db, origin, principal, {
      kind: ORDER_PROXY_COMPLETE,
      resourceId: orderId,
      summary: `代供应商回传「${FULFILMENT_EVENT_NAMES[input.type]}」：订单 ${order.orderNo}，发生时间 ${instantToLocal(input.occurredAt, order.timezone).dateTime.replace("T", " ")}（当地）`,
      payload: { order_id: orderId, order_no: order.orderNo, occurred_at: input.occurredAt.toISOString(), reason: input.reason, actual_minutes: input.actual?.minutes ?? null, actual_km: input.actual?.km ?? null, settlement_minor: order.settlementMinor, settlement_currency: order.settlementCurrency, timezone: order.timezone },
      before: { status: order.status },
      baseVersion: null,
      note: input.reason,
    });
    return { kind: "approval", approval };
  });
}

/** 代传「已完成」：批准时才完成，判定时这一单必须还在服务中（供应商或司机恢复后自己回传了的，只能驳回）。 */
export const ORDER_PROXY_COMPLETE: ApprovalKind = {
  kind: PROXY_COMPLETE_KIND,
  resource: "order",
  readAction: "order.read",
  requestAction: "order.proxy_fulfilment",
  reviewAction: "payment.manage",
  orderScoped: true,
  async apply(db, approval, origin) {
    const { payload } = approval;
    const order = await findOrderForPlatform(db, payload["order_id"] as string, { lock: true });
    if (order === null) throw notFound("订单");
    if (order.status !== "in_service") throw new AppError(409, "APPROVAL_STALE", "这一单已经不在服务中了（可能供应商或司机已经自己回传）；请驳回", { status: order.status });
    const occurredAt = new Date(payload["occurred_at"] as string);
    assertTimeAllowed(order, occurredAt, origin.occurredAt);
    const actual = { minutes: (payload["actual_minutes"] as number | null) ?? null, km: (payload["actual_km"] as number | null) ?? null };
    await applyProxy(db, order, { type: "completed", actual }, { occurredAt: proxyEffectiveOccurredAt(occurredAt, previousMilestone(order)), reason: payload["reason"] as string, approvedBy: origin.actor.id, approvalId: approval.id }, approval.requestedBy.id, origin);
  },
};

export const PROXY_FULFILMENT_APPROVAL_KINDS: readonly ApprovalKind[] = [ORDER_PROXY_COMPLETE];
