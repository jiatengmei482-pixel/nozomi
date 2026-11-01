/**
 * 履约回传（M3-02，ADR 0027）：出发、到达、接到客人、完成。司机 H5 和供应商的调度系统（`POST /tenant/v1/orders/{id}/events`）走同一套规则。
 *
 * - 状态按顺序走（@nozomi/domain 的 `orderTransitionAllowed`），跳步、重复、在错误的状态下回传都是 409 `ORDER_STATE_INVALID`；
 * - 时间一律用系统收到的时间（不认手机时钟）；已到达记一条评分事件（准时到达率）；带了定位就记一条定位，「已到达」还算出距上车点多少米（no-show 第 1 项）；
 * - 包车完成时必须上报实际时长和里程（超时、超公里的依据，需求「完成时填实际时长和公里」），其他品类选填；
 * - 每次状态变化记一条状态流水，并给供应商排一条 `order.status_changed` 推送。
 * 平台代传（M4-18，ADR 0052）也走这里，多带一个 `ProxyMark`：履约时间和流水用运营填的发生时间，流水和推送标明来源。
 */
import { FULFILMENT_EVENTS, type FulfilmentEventType, type OrderStatus, arrivalOnTime, distanceToPickupMeters, orderOperableByTenant, orderTransitionAllowed } from "@nozomi/domain";
import type { Db } from "../db/context.ts";
import { AppError } from "../errors.ts";
import { type FulfilmentChange, type LocationKind, findPlace, insertOrderLocation, updateFulfilment } from "../repos/dispatch.ts";
import { type Order, type OrderEventActor, insertOrderEvent } from "../repos/orders.ts";
import { validationFailed } from "../validation.ts";
import { enqueueNotification } from "../repos/notifications.ts";
import { recordPerformanceEvent } from "../repos/tenant-onboarding.ts";
import { enqueueTenantEvent } from "./tenant-webhooks.ts";

export { FULFILMENT_EVENTS };
export type { FulfilmentEventType };

const TARGET: Readonly<Record<FulfilmentEventType, OrderStatus>> = { departed: "departed", arrived: "arrived", picked_up: "in_service", completed: "completed" };

export interface ReportedLocation {
  lng: number;
  lat: number;
  accuracyM: number | null;
}

export interface FulfilmentInput {
  type: FulfilmentEventType;
  location: ReportedLocation | null;
  actual: { minutes: number | null; km: number | null } | null;
}

export interface FulfilmentActor {
  type: Extract<OrderEventActor, "tenant_user" | "driver" | "platform_user">;
  /** 租户用户编号、司机链接编号或平台员工编号 */
  id: string;
  linkId: string | null;
}

/** 平台代传的标记（ADR 0052）。 */
export interface ProxyMark {
  /** 运营填的发生时间：写进履约时间和状态流水 */
  occurredAt: Date;
  reason: string;
  /** 代传完成走复核时的批准人和复核编号；其他事件为 null */
  approvedBy: string | null;
  approvalId: string | null;
}

export function orderStateInvalid(status: OrderStatus, action: string): AppError {
  return new AppError(409, "ORDER_STATE_INVALID", "订单当前的状态不允许这个操作", { status, action });
}

/** 供应商的写接口共用：这一行在救援改派中或已转给救援供应商时，原供应商只能查看（409 `ORDER_STATE_INVALID`，ADR 0031）。 */
export function assertTenantCanOperate(order: Pick<Order, "status">, action: string): void {
  if (!orderOperableByTenant(order.status)) throw new AppError(409, "ORDER_STATE_INVALID", "这一单在救援改派中或已转给其他供应商，只能查看", { status: order.status, action });
}

/**
 * 上车点的坐标：接机从机场接人，上车点是机场（主数据里的坐标）；其他情况是客人填的上车点。没有坐标返回 null。
 */
export async function pickupPoint(db: Db, order: Order): Promise<{ lng: number; lat: number } | null> {
  if (order.category === "airport_transfer" && order.direction === "pickup" && order.placeId !== null) {
    const place = await findPlace(db, order.placeId);
    return place === null ? null : { lng: place.lng, lat: place.lat };
  }
  return order.pickup === null ? null : { lng: order.pickup.lng, lat: order.pickup.lat };
}

/** 状态流水 `detail.source` 的取值：这一步是平台代供应商回传的。 */
export const PLATFORM_PROXY_SOURCE = "platform_proxy";

/** 记一条状态变化：状态流水 + 供应商的推送。 */
export async function recordStatusChange(db: Db, order: Order, to: OrderStatus, actor: { type: OrderEventActor; detail: Record<string, unknown> }, reason: string, now: Date, proxy: ProxyMark | null = null): Promise<void> {
  const occurredAt = proxy?.occurredAt ?? now;
  const proxyDetail = proxy === null ? {} : { source: PLATFORM_PROXY_SOURCE, recorded_at: now.toISOString(), proxy_reason: proxy.reason, approved_by: proxy.approvedBy, approval_id: proxy.approvalId };
  await insertOrderEvent(db, order, { fromStatus: order.status, toStatus: to, actor: actor.type, reason, occurredAt, detail: { ...actor.detail, ...proxyDetail } });
  await enqueueTenantEvent(db, { tenantId: order.tenantId, type: "order.status_changed", orderId: order.id, data: { from_status: order.status, to_status: to, ...(proxy === null ? {} : { source: PLATFORM_PROXY_SOURCE, occurred_at: occurredAt.toISOString() }) } }, now);
}

/** 包车完成必须上报实际时长和里程（代传发起复核之前也用它先校验）。 */
export function assertCompletionActual(order: Pick<Order, "category">, input: Pick<FulfilmentInput, "type" | "actual">): void {
  if (input.type !== "completed" || order.category !== "charter") return;
  const minutes = input.actual?.minutes ?? null;
  const km = input.actual?.km ?? null;
  if (minutes !== null && km !== null) return;
  throw validationFailed("body", [
    ...(minutes === null ? [{ path: "/actual/minutes", reason: "REQUIRED", message: "包车完成时要填实际用了多少分钟" }] : []),
    ...(km === null ? [{ path: "/actual/km", reason: "REQUIRED", message: "包车完成时要填实际跑了多少公里" }] : []),
  ]);
}

/** 回传一个履约状态。`order` 已在本事务里锁住。`proxy` 只有平台代传才有。 */
export async function applyFulfilmentEvent(db: Db, order: Order, input: FulfilmentInput, actor: FulfilmentActor, now: Date, proxy: ProxyMark | null = null): Promise<void> {
  const to = TARGET[input.type];
  if (!orderTransitionAllowed(order.status, to)) throw orderStateInvalid(order.status, input.type);
  const at = proxy?.occurredAt ?? now;
  const change: FulfilmentChange = { status: to };
  if (input.type === "departed") change.departedAt = at;
  if (input.type === "arrived") {
    change.arrivedAt = at;
    const pickup = input.location === null ? null : await pickupPoint(db, order);
    change.arrivalDistanceM = input.location === null || pickup === null ? null : distanceToPickupMeters(input.location, pickup);
  }
  if (input.type === "picked_up") change.pickedUpAt = at;
  if (input.type === "completed") {
    assertCompletionActual(order, input);
    change.completedAt = at;
    change.completedRecordedAt = now;
    change.actualMinutes = input.actual?.minutes ?? null;
    change.actualKm = input.actual?.km ?? null;
  }
  await updateFulfilment(db, order.tenantId, order.id, change, now);
  if (input.location !== null) await insertOrderLocation(db, order.tenantId, order.id, { kind: input.type as LocationKind, ...input.location, recordedAt: now }, actor.linkId);
  await recordStatusChange(db, order, to, { type: actor.type, detail: actor.type === "driver" ? { link_id: actor.id } : { user_id: actor.id } }, input.type.toUpperCase(), now, proxy);
  // 准时到达率（ADR 0028）：供应商和司机自己回传才算；代传的时间是运营填的，不计入，避免被刷（ADR 0052）
  if (input.type === "arrived" && proxy === null) await recordPerformanceEvent(db, { tenantId: order.tenantId, orderId: order.id, kind: "arrival", onTime: arrivalOnTime(now, order.serviceAt), occurredAt: now, now });
  if (input.type === "arrived") await enqueueNotification(db, { event: "order.driver_arrived", tenantId: order.tenantId, orderId: order.id, dedupeKey: `order.driver_arrived:${order.id}:${order.dispatch.assignedAt?.getTime() ?? 0}` }, now);
}
