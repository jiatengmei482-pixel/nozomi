/**
 * 客人修改、取消时要通知谁（M4-29，ADR 0060）：发给司机的通知、供应商的待办。都在调用方的平台事务里（订单已锁），和业务同生共死。
 * 真正发信在通知中心的后台任务里，发不出去不影响业务。事件里只有编号、字段名：没有邮箱、客人信息、价格。
 */
import { type NotificationEvent, type OrderTodoKind } from "@nozomi/domain";
import type { Db } from "../db/context.ts";
import { currentDriverLink } from "../repos/dispatch.ts";
import { enqueueNotification } from "../repos/notifications.ts";
import { insertOrderTodo } from "../repos/order-todos.ts";
import type { Order } from "../repos/orders.ts";

/** 司机还在这张单上的状态。接到客人之后，修改和取消都不可能了。 */
const DRIVER_ON_TRIP: readonly string[] = ["assigned", "departed", "arrived"];

/** 这张单现在有没有要通知的司机。 */
export function hasActiveDriver(order: Order): boolean {
  return driverOnTrip(order.status, order.dispatch.driverId);
}

export function driverOnTrip(status: string, driverId: string | null): boolean {
  return driverId !== null && DRIVER_ON_TRIP.includes(status);
}

/** 通知司机（没派司机就什么都不写）。`key` 区分同一张单的多次通知；带链接的那种记下现在调度员手里的链接当锚点（ADR 0058）。 */
export async function enqueueDriverNotice(db: Db, order: Order, event: Extract<NotificationEvent, "order.driver_change_pending" | "order.driver_changed" | "order.driver_change_declined" | "order.driver_cancelled">, input: { key: string; changeId?: string; fields?: readonly string[] }, now: Date): Promise<void> {
  const driverId = order.dispatch.driverId;
  if (driverId === null || !hasActiveDriver(order)) return;
  const link = event === "order.driver_changed" ? await currentDriverLink(db, order.tenantId, order.id) : null;
  await enqueueNotification(
    db,
    {
      event,
      tenantId: order.tenantId,
      orderId: order.id,
      dedupeKey: `${event}:${input.key}:${driverId}`,
      data: { driver_id: driverId, change_id: input.changeId ?? null, fields: input.fields ?? [], link_id: link?.id ?? null, assignment_id: link?.assignmentId ?? null },
    },
    now,
  );
}

export async function addOrderTodo(db: Db, order: Order, kind: OrderTodoKind, input: { changeId?: string; fields?: readonly string[]; needsDriverAdjustment?: boolean }, now: Date): Promise<void> {
  await insertOrderTodo(db, { tenantId: order.tenantId, orderId: order.id, kind, changeId: input.changeId ?? null, fields: input.fields ?? [], needsDriverAdjustment: input.needsDriverAdjustment ?? hasActiveDriver(order) }, now);
}
