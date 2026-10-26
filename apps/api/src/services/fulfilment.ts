/**
 * 履约回传（M3-02，ADR 0027）：出发、到达、接到客人、完成。司机 H5 和供应商的调度系统（`POST /tenant/v1/orders/{id}/events`）走同一套规则。
 *
 * - 状态按顺序走（@nozomi/domain 的 `orderTransitionAllowed`），跳步、重复、在错误的状态下回传都是 409 `ORDER_STATE_INVALID`；
 * - 时间一律用系统收到的时间（不认手机时钟）；带了定位就记一条定位，「已到达」还算出距上车点多少米（no-show 第 1 项）；
 * - 包车完成时必须上报实际时长和里程（超时、超公里的依据，需求「完成时填实际时长和公里」），其他品类选填；
 * - 每次状态变化记一条状态流水，并给供应商排一条 `order.status_changed` 推送。
 */
import { type OrderStatus, distanceToPickupMeters, orderOperableByTenant, orderTransitionAllowed } from "@nozomi/domain";
import type { Db } from "../db/context.ts";
import { AppError } from "../errors.ts";
import { type FulfilmentChange, type LocationKind, findPlace, insertOrderLocation, updateFulfilment } from "../repos/dispatch.ts";
import { type Order, type OrderEventActor, insertOrderEvent } from "../repos/orders.ts";
import { validationFailed } from "../validation.ts";
import { enqueueTenantEvent } from "./tenant-webhooks.ts";

export const FULFILMENT_EVENTS = ["departed", "arrived", "picked_up", "completed"] as const;
export type FulfilmentEventType = (typeof FULFILMENT_EVENTS)[number];

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
  type: Extract<OrderEventActor, "tenant_user" | "driver">;
  /** 租户用户编号或司机链接编号 */
  id: string;
  linkId: string | null;
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

/** 记一条状态变化：状态流水 + 供应商的推送。 */
export async function recordStatusChange(db: Db, order: Order, to: OrderStatus, actor: { type: OrderEventActor; detail: Record<string, unknown> }, reason: string, now: Date): Promise<void> {
  await insertOrderEvent(db, order, { fromStatus: order.status, toStatus: to, actor: actor.type, reason, occurredAt: now, detail: actor.detail });
  await enqueueTenantEvent(db, { tenantId: order.tenantId, type: "order.status_changed", orderId: order.id, data: { from_status: order.status, to_status: to } }, now);
}

/** 回传一个履约状态。`order` 已在本事务里锁住。 */
export async function applyFulfilmentEvent(db: Db, order: Order, input: FulfilmentInput, actor: FulfilmentActor, now: Date): Promise<void> {
  const to = TARGET[input.type];
  if (!orderTransitionAllowed(order.status, to)) throw orderStateInvalid(order.status, input.type);
  const change: FulfilmentChange = { status: to };
  if (input.type === "departed") change.departedAt = now;
  if (input.type === "arrived") {
    change.arrivedAt = now;
    const pickup = input.location === null ? null : await pickupPoint(db, order);
    change.arrivalDistanceM = input.location === null || pickup === null ? null : distanceToPickupMeters(input.location, pickup);
  }
  if (input.type === "picked_up") change.pickedUpAt = now;
  if (input.type === "completed") {
    const minutes = input.actual?.minutes ?? null;
    const km = input.actual?.km ?? null;
    if (order.category === "charter" && (minutes === null || km === null)) {
      throw validationFailed("body", [
        ...(minutes === null ? [{ path: "/actual/minutes", reason: "REQUIRED", message: "包车完成时要填实际用了多少分钟" }] : []),
        ...(km === null ? [{ path: "/actual/km", reason: "REQUIRED", message: "包车完成时要填实际跑了多少公里" }] : []),
      ]);
    }
    change.completedAt = now;
    change.actualMinutes = minutes;
    change.actualKm = km;
  }
  await updateFulfilment(db, order.tenantId, order.id, change, now);
  if (input.location !== null) await insertOrderLocation(db, order.tenantId, order.id, { kind: input.type as LocationKind, ...input.location, recordedAt: now }, actor.linkId);
  await recordStatusChange(db, order, to, { type: actor.type, detail: actor.type === "driver" ? { link_id: actor.id } : { user_id: actor.id } }, input.type.toUpperCase(), now);
}
