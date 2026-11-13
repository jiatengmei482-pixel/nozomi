/**
 * 查订单（M3-01，ADR 0026）：租户看自己的、运营后台看全部。只读。
 *
 * - 租户（`/tenant/v1/orders`）：在租户事务里读（行级安全只放行本租户的行），只看得到付过款的单；
 *   读的只有订单表和状态流水——渠道、对外价、加价比例、汇率在平台表 `order_sales`，租户角色在数据库里就读不到（规则 4）。
 * - 运营后台（`/platform/v1/orders`）：平台事务，跨租户跨渠道；有渠道、对外价、结算价、加价比例、付款状态、报价快照里的全部候选。
 *   完整的订单中心（筛选、异常队列、人工介入）在 M4-02。
 */
import { type PassengerEmailChange, findPendingPassengerEmailChange } from "../repos/passenger-email-changes.ts";
import { type LocalizedText, type OrderStatus, type PlatformDataScope, UNRESTRICTED_SCOPE, nextFulfilmentEvent, proxyEventNeedsReview, scopeAllowsChannel, scopeAllowsCity, scopeIsRestricted } from "@nozomi/domain";
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
import { type OrderVehicleGroupRef, findOrderVehicleGroup } from "../repos/master-data.ts";
import { findAreasForProduct } from "../repos/products.ts";
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
  listOrderPayments,
  listPaymentEvents,
  listPlatformOrders,
  listTenantOrders,
} from "../repos/orders.ts";
import { insertAuditLog } from "../repos/audit-logs.ts";
import { consoleOrigin, platformActor } from "./audit.ts";
import { notFound } from "./errors.ts";
import type { PlatformPrincipal } from "./platform-auth.ts";
import { type OrderChange, listOrderChanges, ordersWithPendingChange } from "../repos/order-changes.ts";
import { type ExtraCharge, listExtraCharges } from "../repos/extra-charges.ts";
import { type ChangeSale, type OrderRefund, listChangeSales, listOrderRefunds } from "../repos/refunds.ts";
import type { StoredQuoteSnapshot } from "./sales-quotes.ts";
import { type PlatformRescueView, type TenantRescueView, orderRescueViews, tenantRescueOf } from "./rescues.ts";
import { type OrderException, countOpenExceptions, listOrderExceptions } from "../repos/exceptions.ts";
import { type Ticket, listOrderTickets } from "../repos/tickets.ts";
import { type Approval, findPendingApproval } from "../repos/approvals.ts";

/** 代传的复核类别（services/proxy-fulfilment.ts 登记）。写在这里：那边依赖 approvals.ts，approvals.ts 依赖这里。 */
export const PROXY_REVIEW_KINDS = { picked_up: "order.proxy_pick_up", completed: "order.proxy_complete" } as const;

export interface TenantOrderListQuery {
  status: OrderStatus | null;
  from: string | null;
  to: string | null;
  dispatch: "unassigned" | "overdue" | null;
  /** 只看有修改申请等处理的（M4-29） */
  change?: "pending" | null;
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
      const pending = await ordersWithPendingChange(db, tenantId, page.items.map((order) => order.id));
      return { items: page.items.map((order) => ({ order, facts: { ...(facts.get(order.id) ?? NO_FACTS), pendingChange: pending.has(order.id) } })), nextCursor: page.nextCursor, total: page.total };
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
  /** 改单、事后加收（M3-03） */
  changes: OrderChange[];
  extraCharges: ExtraCharge[];
  /** 这一单和救援改派的关系（M3-04）：原供应商 / 救援供应商；没有为 null */
  rescue: TenantRescueView | null;
  /** M7-02：车型组当前的名称、代表车型、组合（ADR 0068，不做快照） */
  vehicleGroup: OrderVehicleGroupRef | null;
  /** M8-15：包车区域加价用到的加价区域现在的名称（ADR 0073）；区域被删了的不在里面 */
  surchargeAreaNames: Map<string, LocalizedText>;
  /** M8-13：点对点用的价格（线路价 / 区域价）；没有为 null */
  pricingRoute: PricingRoute | null;
}

/** 这一单的包车区域加价用到的加价区域现在的名称（只查这个供应商自己的区域）。 */
async function surchargeAreaNamesOf(db: Db, order: Order): Promise<Map<string, LocalizedText>> {
  const surcharge = order.settlement.areaSurcharge ?? null;
  const ids = surcharge === null ? [] : [...new Set([surcharge.pickup.areaId, surcharge.dropoff.areaId, ...(surcharge.waypoints ?? []).map((entry) => entry.areaId)].filter((id): id is string => id !== null))];
  const found = await findAreasForProduct(db, order.tenantId, ids);
  return new Map([...found].map(([id, area]) => [id, area.name]));
}

/**
 * 点对点用的价格（M8-13，ADR 0073 第四部分；规范 platform-orders.md 3d「用的价格」）：上车区域（报价快照里中标的区域）和线路价的下车区域，带现在的名称。
 * 只有用了线路价、或设了含公里数的点对点单才有（没有这些数的旧单、区域价没设含公里数的单显示不变）；别的品类为 null。
 * 上车区域取下单用的报价快照：救援转给了别的供应商、改期后命中的线路和快照不一样时不知道是哪个区域，`areaId` 为 null。
 * 区域被删了的不在 `names` 里。只查这个供应商自己的区域；不含任何金额（供应商详情也用）。
 */
export interface PricingRoute {
  areaId: string | null;
  toAreaId: string | null;
  names: Map<string, LocalizedText>;
}

async function pricingRouteOf(db: Db, order: Order): Promise<PricingRoute | null> {
  if (order.category !== "point_to_point") return null;
  const toAreaId = order.settlement.toAreaId ?? null;
  if (toAreaId === null && (order.settlement.distance ?? null) === null) return null;
  const row = (await db.query<{ snapshot: StoredQuoteSnapshot }>("select q.snapshot from order_sales s join quotes q on q.id = s.quote_id where s.order_id = $1", [order.id])).rows[0];
  const winner = row?.snapshot.winner;
  const same = winner !== undefined && winner.tenantId === order.tenantId && winner.productId === order.productId && (winner.offer.settlement.toAreaId ?? null) === toAreaId;
  const areaId = same ? winner.offer.areaId : null;
  const found = await findAreasForProduct(db, order.tenantId, [areaId, toAreaId].filter((id): id is string => id !== null));
  return { areaId, toAreaId, names: new Map([...found].map(([id, area]) => [id, area.name])) };
}

export async function getOrderForTenant(ctx: AppContext, tenantId: string, orderId: string): Promise<TenantOrderDetail> {
  const detail = await withTenantTx(
    ctx.pool,
    tenantId,
    async (db) => {
      const order = await findTenantOrder(db, tenantId, orderId);
      if (order === null) throw notFound("订单");
      const facts = { ...((await dispatchFactsOf(db, [order])).get(order.id) ?? NO_FACTS), pendingChange: (await ordersWithPendingChange(db, tenantId, [order.id])).has(order.id) };
      return {
        order,
        facts,
        events: await listOrderEvents(db, tenantId, orderId),
        records: await fulfilmentRecords(db, order),
        changes: await listOrderChanges(db, tenantId, orderId),
        extraCharges: await listExtraCharges(db, tenantId, orderId),
        vehicleGroup: await findOrderVehicleGroup(db, order.vehicleGroupId),
        surchargeAreaNames: await surchargeAreaNamesOf(db, order),
      };
    },
    { snapshot: true },
  );
  // 救援记录在平台表里（涉及几家供应商）：在平台事务里只取和令牌里这个供应商有关的那一部分
  // 用的价格（M8-13）的上车区域在下单用的报价快照里（平台表）：只取区域编号，名称只查这个供应商自己的区域
  const { rescue, pricingRoute } = await withPlatformTx(ctx.pool, async (db) => ({ rescue: await tenantRescueOf(db, { tenantId, id: orderId }), pricingRoute: await pricingRouteOf(db, detail.order) }), { snapshot: true });
  return { ...detail, rescue, pricingRoute };
}

/**
 * 一张订单的一张照片（供应商后台、运营后台查看证据）。运营后台按数据范围：范围外的订单的照片和不存在一样（ADR 0030）；
 * 每次看到照片记一条审计，和取照片在同一个事务里，记不下来就不给（ADR 0054）。审计只记看了哪张，不记内容。
 */
export async function getOrderFile(ctx: AppContext, scope: { tenantId: string } | { platform: PlatformPrincipal; ip: string }, orderId: string, fileId: string): Promise<OrderFile & { data: Buffer }> {
  const read = async (db: Db, tenantId: string): Promise<OrderFile & { data: Buffer }> => {
    const file = await findOrderFile(db, tenantId, orderId, fileId);
    if (file === null) throw notFound("照片");
    return file;
  };
  if ("platform" in scope) {
    return withPlatformTx(ctx.pool, async (db) => {
      const order = await findOrderForPlatform(db, orderId);
      if (order === null || !(await orderInScope(db, order, scope.platform.grant.scope))) throw notFound("照片");
      const file = await read(db, order.tenantId);
      await insertAuditLog(db, consoleOrigin(platformActor(scope.platform.user), scope.ip, ctx.now()), { tenantId: null, resource: "order", resourceId: orderId, action: "view_evidence_file", before: null, after: { order_no: order.orderNo, file_id: file.id, kind: file.kind } });
      return file;
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

/**
 * 运营后台按订单编号操作之前（取消、改单、加收、退款的接口）：订单不在这个人的数据范围里时和不存在一样（404，ADR 0030）。
 * 不限范围时不查。
 */
export async function assertPlatformOrderInScope(ctx: AppContext, scope: PlatformDataScope, orderId: string): Promise<void> {
  if (!scopeIsRestricted(scope)) return;
  const visible = await withPlatformTx(ctx.pool, async (db) => {
    const order = await findOrderForPlatform(db, orderId);
    return order !== null && (await orderInScope(db, order, scope));
  });
  if (!visible) throw notFound("订单");
}

export async function listOrdersForPlatform(ctx: AppContext, filter: PlatformOrderFilter, limit: number, after: TimeCursor | null): Promise<{ items: PlatformOrderRow[]; nextCursor: string | null; total: number; openExceptions: Map<string, number> }> {
  return withPlatformTx(
    ctx.pool,
    async (db) => {
      const page = await listPlatformOrders(db, filter, limit, after);
      return { ...page, openExceptions: await countOpenExceptions(db, page.items.map((item) => item.order.id)) };
    },
    { snapshot: true },
  );
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
  /** M3-03：全部收款（下单、改期补差价、事后加收）、退款、改单（和改期的对外价）、事后加收 */
  payments: OrderPayment[];
  refunds: OrderRefund[];
  changes: OrderChange[];
  changeSales: Map<string, ChangeSale>;
  extraCharges: ExtraCharge[];
  /** M3-04：这一单的全部救援改派 */
  rescues: PlatformRescueView[];
  /** M4-02：这一单的异常（含已关闭的）、工单（各家供应商的） */
  exceptions: OrderException[];
  tickets: Ticket[];
  /** M4-18：这一单下一步的代传在等复核（ADR 0052） */
  pendingProxyReview: { event: keyof typeof PROXY_REVIEW_KINDS; approval: Approval } | null;
  /** M4-31：代改的乘客邮箱在等审核（ADR 0065），只有打码地址 */
  pendingEmailReview: PassengerEmailChange | null;
  /** M7-02：车型组当前的名称、代表车型、组合（ADR 0068，不做快照） */
  vehicleGroup: OrderVehicleGroupRef | null;
  /** M8-15：包车区域加价用到的加价区域现在的名称（ADR 0073） */
  surchargeAreaNames: Map<string, LocalizedText>;
  /** M8-13：点对点用的价格（线路价 / 区域价）；没有为 null */
  pricingRoute: PricingRoute | null;
}

/** 只看下一步：别人已经把这一步回传了的旧复核（批准只会得到「已过时」）不算在等。 */
async function pendingProxyReviewOf(db: Db, order: Order): Promise<PlatformOrderDetail["pendingProxyReview"]> {
  const event = nextFulfilmentEvent(order.status);
  if (event === null || !proxyEventNeedsReview(event)) return null;
  const approval = await findPendingApproval(db, PROXY_REVIEW_KINDS[event], order.id);
  return approval === null ? null : { event, approval };
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
        payments: await listOrderPayments(db, orderId),
        refunds: await listOrderRefunds(db, orderId),
        changes: await listOrderChanges(db, order.tenantId, orderId),
        changeSales: await listChangeSales(db, orderId),
        extraCharges: await listExtraCharges(db, order.tenantId, orderId),
        rescues: await orderRescueViews(db, orderId),
        exceptions: await listOrderExceptions(db, orderId),
        tickets: await listOrderTickets(db, orderId),
        pendingProxyReview: await pendingProxyReviewOf(db, order as Order),
        pendingEmailReview: await findPendingPassengerEmailChange(db, orderId),
        vehicleGroup: await findOrderVehicleGroup(db, order.vehicleGroupId),
        surchargeAreaNames: await surchargeAreaNamesOf(db, order as Order),
        pricingRoute: await pricingRouteOf(db, order as Order),
      };
    },
    { snapshot: true },
  );
}
