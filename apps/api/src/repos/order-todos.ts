/**
 * 供应商后台的待办（M4-29，ADR 0060）。`order_todos` 是租户表：供应商只读自己的（行级安全），写都在平台事务里（改单、取消、救援本来就在平台事务里）。
 * 没有客人信息，只有编号和字段名。
 */
import { ORDER_TODO_STALE_DAYS, type OrderTodoKind } from "@nozomi/domain";
import type { Db } from "../db/context.ts";

type Row = Record<string, any>;

export interface NewOrderTodo {
  tenantId: string;
  orderId: string;
  kind: OrderTodoKind;
  changeId: string | null;
  fields: readonly string[];
  needsDriverAdjustment: boolean;
}

export async function insertOrderTodo(db: Db, todo: NewOrderTodo, now: Date): Promise<void> {
  await db.query(
    `insert into order_todos (tenant_id, order_id, kind, change_id, fields, needs_driver_adjustment, created_at) values ($1, $2, $3, $4, $5, $6, $7)
     on conflict do nothing`,
    [todo.tenantId, todo.orderId, todo.kind, todo.changeId, todo.fields, todo.needsDriverAdjustment, now],
  );
}

/** 申请有结论了：「要决定」的那条系统关掉。 */
export async function resolveChangeRequestTodo(db: Db, tenantId: string, changeId: string, now: Date): Promise<void> {
  await db.query("update order_todos set resolved_at = $3 where tenant_id = $1 and change_id = $2 and kind = 'change_request' and resolved_at is null", [tenantId, changeId, now]);
}

/** 订单取消或进救援：这一单之前的待办全部关掉（系统关，`resolved_by` 为空）。 */
export async function resolveOpenOrderTodos(db: Db, tenantId: string, orderId: string, now: Date): Promise<void> {
  await db.query("update order_todos set resolved_at = $3 where tenant_id = $1 and order_id = $2 and resolved_at is null", [tenantId, orderId, now]);
}

export interface OrderTodo {
  id: string;
  kind: OrderTodoKind;
  orderId: string;
  orderNo: string;
  orderStatus: string;
  serviceLocal: string;
  timezone: string;
  changeId: string | null;
  fields: string[];
  needsDriverAdjustment: boolean;
  driverId: string | null;
  confirmDueAt: Date | null;
  changeStatus: string | null;
  createdAt: Date;
}

/** 没有处理的待办：要决定的排前面，再按新到旧。用车时间过了 3 天还没点的不再计入（要决定的除外）。 */
const OPEN = `t.tenant_id = $1 and t.resolved_at is null and (t.kind = 'change_request' or o.service_at > $2::timestamptz - make_interval(days => ${ORDER_TODO_STALE_DAYS}))`;

export async function listOpenOrderTodos(db: Db, tenantId: string, now: Date, limit: number): Promise<{ items: OrderTodo[]; total: number; changeRequests: number }> {
  const result = await db.query<Row>(
    `select t.id, t.kind, t.order_id, o.order_no, o.status as order_status, o.service_local, o.timezone, t.change_id, t.fields, t.needs_driver_adjustment, o.driver_id, c.confirm_due_at, c.status as change_status, t.created_at
       from order_todos t join orders o on o.tenant_id = t.tenant_id and o.id = t.order_id
       left join order_changes c on c.tenant_id = t.tenant_id and c.id = t.change_id
      where ${OPEN}
      order by (t.kind = 'change_request') desc, t.seq desc limit $3`,
    [tenantId, now, limit],
  );
  const counts = await db.query<{ total: number; requests: number }>(
    `select count(*)::int as total, count(*) filter (where t.kind = 'change_request')::int as requests from order_todos t join orders o on o.tenant_id = t.tenant_id and o.id = t.order_id where ${OPEN}`,
    [tenantId, now],
  );
  const count = counts.rows[0] as { total: number; requests: number };
  return {
    total: count.total,
    changeRequests: count.requests,
    items: result.rows.map((row) => ({
      id: row["id"],
      kind: row["kind"],
      orderId: row["order_id"],
      orderNo: row["order_no"],
      orderStatus: row["order_status"],
      serviceLocal: row["service_local"],
      timezone: row["timezone"],
      changeId: row["change_id"],
      fields: row["fields"],
      needsDriverAdjustment: row["needs_driver_adjustment"],
      driverId: row["driver_id"],
      confirmDueAt: row["confirm_due_at"],
      changeStatus: row["change_status"],
      createdAt: row["created_at"],
    })),
  };
}

export async function findOrderTodo(db: Db, tenantId: string, id: string): Promise<{ id: string; kind: OrderTodoKind; resolvedAt: Date | null } | null> {
  const row = (await db.query<Row>("select id, kind, resolved_at from order_todos where tenant_id = $1 and id = $2 for update", [tenantId, id])).rows[0];
  return row === undefined ? null : { id: row["id"], kind: row["kind"], resolvedAt: row["resolved_at"] };
}

export async function acknowledgeOrderTodo(db: Db, tenantId: string, id: string, userId: string, now: Date): Promise<void> {
  await db.query("update order_todos set resolved_at = $3, resolved_by = $4 where tenant_id = $1 and id = $2 and resolved_at is null", [tenantId, id, now, userId]);
}
