/**
 * 查订单（M3-01，ADR 0026）：租户看自己的、运营后台看全部。只读。
 *
 * - 租户（`/tenant/v1/orders`）：在租户事务里读（行级安全只放行本租户的行），只看得到付过款的单；
 *   读的只有订单表和状态流水——渠道、对外价、加价比例、汇率在平台表 `order_sales`，租户角色在数据库里就读不到（规则 4）。
 * - 运营后台（`/platform/v1/orders`）：平台事务，跨租户跨渠道；有渠道、对外价、结算价、加价比例、付款状态、报价快照里的全部候选。
 *   完整的订单中心（筛选、异常队列、人工介入）在 M4-02。
 */
import { type OrderStatus, type PlatformDataScope, UNRESTRICTED_SCOPE, scopeAllowsChannel, scopeAllowsCity, scopeIsRestricted } from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { type Db, withPlatformTx, withTenantTx } from "../db/context.ts";
import {
  type Assignment,
  type DriverLink,
  type NoShowClaim,
  type OrderContact,
  type OrderFile,
  type OrderLocation,
  currentDriverLink,
  findNoShowClaim,
  findOrderFile,
  listAssignments,
  listOrderContacts,
  listOrderFiles,
  listOrderLocations,
} from "../repos/dispatch.ts";
import { findDriversByIds, findVehiclesByIds } from "../repos/fleet.ts";
import { type WebhookDelivery, listDeliveries } from "../repos/webhooks.ts";
import type { DispatchFacts } from "./order-views.ts";
import type { TimeCursor } from "../pagination.ts";
import {
  type Order,
  type OrderEvent,
  type OrderPayment,
  type OrderSale,
  type PaymentEventRecord,
  type PlatformOrderFilter,
  type PlatformOrderRow,
  findOrderForPlatform,
  findOrderPayment,
  findSale,
  findTenantOrder,
  listOrderEvents,
  listPaymentEvents,
  listPlatformOrders,
  listTenantOrders,
} from "../repos/orders.ts";
import { notFound } from "./errors.ts";
import type { StoredQuoteSnapshot } from "./sales-quotes.ts";

export interface TenantOrderListQuery {
  status: OrderStatus | null;
  from: string | null;
  to: string | null;
  dispatch: "unassigned" | "overdue" | null;
}

/** 一页订单里派了的司机和车辆（各一条查询取回）。 */
async function dispatchFactsOf(db: Db, orders: readonly Order[]): Promise<Map<string, DispatchFacts>> {
  const byTenant = new Map<string, Order[]>();
  for (const order of orders) byTenant.set(order.tenantId, [...(byTenant.get(order.tenantId) ?? []), order]);
  const facts = new Map<string, DispatchFacts>();
  for (const [tenantId, list] of byTenant) {
    const drivers = await findDriversByIds(db, tenantId, list.flatMap((order) => (order.dispatch.driverId === null ? [] : [order.dispatch.driverId])));
    const vehicles = await findVehiclesByIds(db, tenantId, list.flatMap((order) => (order.dispatch.vehicleId === null ? [] : [order.dispatch.vehicleId])));
    for (const order of list) {
      facts.set(order.id, { driver: order.dispatch.driverId === null ? null : (drivers.get(order.dispatch.driverId) ?? null), vehicle: order.dispatch.vehicleId === null ? null : (vehicles.get(order.dispatch.vehicleId) ?? null) });
    }
  }
  return facts;
}

const NO_FACTS: DispatchFacts = { driver: null, vehicle: null };

export async function listOrdersForTenant(ctx: AppContext, tenantId: string, query: TenantOrderListQuery, limit: number, after: TimeCursor | null): Promise<{ items: { order: Order; facts: DispatchFacts }[]; nextCursor: string | null; total: number }> {
  return withTenantTx(
    ctx.pool,
    tenantId,
    async (db) => {
      const page = await listTenantOrders(db, tenantId, { ...query, now: ctx.now() }, limit, after);
      const facts = await dispatchFactsOf(db, page.items);
      return { items: page.items.map((order) => ({ order, facts: facts.get(order.id) ?? NO_FACTS })), nextCursor: page.nextCursor, total: page.total };
    },
    { snapshot: true },
  );
}

/** 一张订单的派车和履约记录：派车 / 改派、当前的司机链接、照片、联系记录、定位、no-show 申请和 5 项证据。 */
export interface OrderFulfilmentRecords {
  assignments: Assignment[];
  link: DriverLink | null;
  files: OrderFile[];
  contacts: OrderContact[];
  locations: OrderLocation[];
  claim: NoShowClaim | null;
}

async function fulfilmentRecords(db: Db, order: Order): Promise<OrderFulfilmentRecords> {
  return {
    assignments: await listAssignments(db, order.tenantId, order.id),
    link: await currentDriverLink(db, order.tenantId, order.id),
    files: await listOrderFiles(db, order.tenantId, order.id),
    contacts: await listOrderContacts(db, order.tenantId, order.id),
    locations: await listOrderLocations(db, order.tenantId, order.id),
    claim: await findNoShowClaim(db, order.tenantId, order.id),
  };
}

export interface TenantOrderDetail {
  order: Order;
  facts: DispatchFacts;
  events: OrderEvent[];
  records: OrderFulfilmentRecords;
}

export async function getOrderForTenant(ctx: AppContext, tenantId: string, orderId: string): Promise<TenantOrderDetail> {
  return withTenantTx(
    ctx.pool,
    tenantId,
    async (db) => {
      const order = await findTenantOrder(db, tenantId, orderId);
      if (order === null) throw notFound("订单");
      const facts = (await dispatchFactsOf(db, [order])).get(order.id) ?? NO_FACTS;
      return { order, facts, events: await listOrderEvents(db, tenantId, orderId), records: await fulfilmentRecords(db, order) };
    },
    { snapshot: true },
  );
}

/** 一张订单的一张照片（供应商后台、运营后台查看证据）。运营后台按数据范围：范围外的订单的照片和不存在一样（ADR 0030）。 */
export async function getOrderFile(ctx: AppContext, scope: { tenantId: string } | { platform: PlatformDataScope }, orderId: string, fileId: string): Promise<OrderFile & { data: Buffer }> {
  const read = async (db: Db, tenantId: string): Promise<OrderFile & { data: Buffer }> => {
    const file = await findOrderFile(db, tenantId, orderId, fileId);
    if (file === null) throw notFound("照片");
    return file;
  };
  if ("platform" in scope) {
    return withPlatformTx(ctx.pool, async (db) => {
      const order = await findOrderForPlatform(db, orderId);
      if (order === null || !(await orderInScope(db, order, scope.platform))) throw notFound("照片");
      return read(db, order.tenantId);
    });
  }
  return withTenantTx(ctx.pool, scope.tenantId, async (db) => {
    if ((await findTenantOrder(db, scope.tenantId, orderId)) === null) throw notFound("照片");
    return read(db, scope.tenantId);
  });
}

/** 订单在不在数据范围里（城市看订单，渠道看销售记录）。不限范围时不多查。 */
export async function orderInScope(db: Db, order: Pick<Order, "id" | "cityId">, scope: PlatformDataScope): Promise<boolean> {
  if (!scopeIsRestricted(scope)) return true;
  if (!scopeAllowsCity(scope, order.cityId)) return false;
  if (scope.channelIds === null) return true;
  const sale = await findSale(db, order.id);
  return sale !== null && scopeAllowsChannel(scope, sale.channelId);
}

export async function listOrdersForPlatform(ctx: AppContext, filter: PlatformOrderFilter, limit: number, after: TimeCursor | null): Promise<{ items: PlatformOrderRow[]; nextCursor: string | null; total: number }> {
  return withPlatformTx(ctx.pool, (db) => listPlatformOrders(db, filter, limit, after), { snapshot: true });
}

export interface PlatformOrderDetail {
  order: Order;
  facts: DispatchFacts;
  records: OrderFulfilmentRecords;
  deliveries: WebhookDelivery[];
  sale: OrderSale;
  payment: OrderPayment | null;
  tenantName: string;
  channelName: string;
  events: OrderEvent[];
  paymentEvents: PaymentEventRecord[];
  /** 下单用的报价快照：全部参与比价的租户和它们的排序依据（《平台运营端》订单详情「报价快照（含全部参与比价的租户和价格、汇率）」） */
  quote: StoredQuoteSnapshot;
}

/** 数据范围外的订单和不存在一样（ADR 0030）。不给范围 = 不限制。 */
export async function getOrderForPlatform(ctx: AppContext, orderId: string, scope: PlatformDataScope = UNRESTRICTED_SCOPE): Promise<PlatformOrderDetail> {
  return withPlatformTx(
    ctx.pool,
    async (db) => {
      const order = await findOrderForPlatform(db, orderId);
      const sale = order === null ? null : await findSale(db, orderId);
      if (order === null || sale === null || !scopeAllowsCity(scope, order.cityId) || !scopeAllowsChannel(scope, sale.channelId)) throw notFound("订单");
      const names = (await db.query<{ tenant: string; channel: string }>("select t.name as tenant, c.name as channel from tenants t, channels c where t.id = $1 and c.id = $2", [order.tenantId, sale.channelId])).rows[0];
      const quote = (await db.query<{ snapshot: StoredQuoteSnapshot }>("select snapshot from quotes where id = $1", [sale.quoteId])).rows[0] as { snapshot: StoredQuoteSnapshot };
      return {
        order,
        facts: (await dispatchFactsOf(db, [order])).get(order.id) ?? NO_FACTS,
        records: await fulfilmentRecords(db, order),
        deliveries: (await listDeliveries(db, { tenantId: order.tenantId, status: null, orderId }, 200, null)).items,
        sale,
        payment: await findOrderPayment(db, orderId),
        tenantName: names?.tenant ?? "",
        channelName: names?.channel ?? "",
        events: await listOrderEvents(db, order.tenantId, orderId),
        paymentEvents: await listPaymentEvents(db, orderId),
        quote: quote.snapshot,
      };
    },
    { snapshot: true },
  );
}
