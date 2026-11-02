/**
 * 供应商后台的待办和角标（M4-29，ADR 0060）。租户编号只来自登录令牌。
 * 只有编号、字段名、司机姓名和系统能不能通知到他：没有客人信息和价格（规则 4）。
 */
import { type DriverLinkDeliveryMode, driverNoticeChannel } from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { withPlatformTx, withTenantTx } from "../db/context.ts";
import { AppError } from "../errors.ts";
import { findDriversByIds } from "../repos/fleet.ts";
import { findNotificationSettings } from "../repos/notifications.ts";
import { type OrderTodo, acknowledgeOrderTodo, findOrderTodo, listOpenOrderTodos } from "../repos/order-todos.ts";
import { notFound } from "./errors.ts";

const TODO_LIMIT = 50;

export interface TodoView extends OrderTodo {
  driverName: string | null;
  driverNotice: "email" | "manual" | "no_email" | null;
}

export async function listTodos(ctx: AppContext, tenantId: string): Promise<{ total: number; changeRequests: number; items: TodoView[] }> {
  return withTenantTx(
    ctx.pool,
    tenantId,
    async (db) => {
      const found = await listOpenOrderTodos(db, tenantId, ctx.now(), TODO_LIMIT);
      const ids = found.items.flatMap((item) => (item.driverId === null ? [] : [item.driverId]));
      const drivers = await findDriversByIds(db, tenantId, ids);
      const mode: DriverLinkDeliveryMode = (await findNotificationSettings(db, tenantId)).driverLinkDelivery;
      return {
        total: found.total,
        changeRequests: found.changeRequests,
        items: found.items.map((item) => {
          const driver = item.driverId === null ? null : (drivers.get(item.driverId) ?? null);
          return { ...item, driverName: driver?.name ?? null, driverNotice: driver === null ? null : driverNoticeChannel(mode, driver.email) };
        }),
      };
    },
    { snapshot: true },
  );
}

export function orderTodoJson(item: TodoView): Record<string, unknown> {
  return {
    id: item.id,
    kind: item.kind,
    order_id: item.orderId,
    order_no: item.orderNo,
    order_status: item.orderStatus,
    service_local: item.serviceLocal,
    timezone: item.timezone,
    change_id: item.changeId,
    change_status: item.changeStatus,
    fields: item.fields,
    needs_driver_adjustment: item.needsDriverAdjustment,
    driver_name: item.driverName,
    driver_notice: item.driverNotice,
    confirm_due_at: item.kind === "change_request" ? (item.confirmDueAt?.toISOString() ?? null) : null,
    created_at: item.createdAt.toISOString(),
  };
}

/** 点「知道了」。要决定的那种不能手动关；别家的当作不存在；重复点没关系。 */
export async function acknowledgeTodo(ctx: AppContext, tenantId: string, userId: string, id: string): Promise<void> {
  await withPlatformTx(ctx.pool, async (db) => {
    const todo = await findOrderTodo(db, tenantId, id);
    if (todo === null) throw notFound("待办");
    if (todo.kind === "change_request") throw new AppError(409, "TODO_NEEDS_DECISION", "这条要同意或拒绝，不能只标记知道了");
    if (todo.resolvedAt === null) await acknowledgeOrderTodo(db, tenantId, id, userId, ctx.now());
  });
}
