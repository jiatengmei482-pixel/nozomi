/**
 * 查订单（M3-01，ADR 0026）：租户看自己的、运营后台看全部。只读。
 *
 * - 租户（`/tenant/v1/orders`）：在租户事务里读（行级安全只放行本租户的行），只看得到付过款的单；
 *   读的只有订单表和状态流水——渠道、对外价、加价比例、汇率在平台表 `order_sales`，租户角色在数据库里就读不到（规则 4）。
 * - 运营后台（`/platform/v1/orders`）：平台事务，跨租户跨渠道；有渠道、对外价、结算价、加价比例、付款状态、报价快照里的全部候选。
 *   完整的订单中心（筛选、异常队列、人工介入）在 M4-02。
 */
import { type OrderStatus, type PlatformDataScope, UNRESTRICTED_SCOPE, scopeAllowsChannel, scopeAllowsCity } from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { withPlatformTx, withTenantTx } from "../db/context.ts";
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
}

export async function listOrdersForTenant(ctx: AppContext, tenantId: string, query: TenantOrderListQuery, limit: number, after: TimeCursor | null): Promise<{ items: Order[]; nextCursor: string | null; total: number }> {
  return withTenantTx(ctx.pool, tenantId, (db) => listTenantOrders(db, tenantId, query, limit, after), { snapshot: true });
}

export async function getOrderForTenant(ctx: AppContext, tenantId: string, orderId: string): Promise<{ order: Order; events: OrderEvent[] }> {
  return withTenantTx(
    ctx.pool,
    tenantId,
    async (db) => {
      const order = await findTenantOrder(db, tenantId, orderId);
      if (order === null) throw notFound("订单");
      return { order, events: await listOrderEvents(db, tenantId, orderId) };
    },
    { snapshot: true },
  );
}

export async function listOrdersForPlatform(ctx: AppContext, filter: PlatformOrderFilter, limit: number, after: TimeCursor | null): Promise<{ items: PlatformOrderRow[]; nextCursor: string | null; total: number }> {
  return withPlatformTx(ctx.pool, (db) => listPlatformOrders(db, filter, limit, after), { snapshot: true });
}

export interface PlatformOrderDetail {
  order: Order;
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
