/**
 * 订单的只读接口（M3-01，ADR 0026）。这里只做鉴权、校验、调用、返回。
 *
 * - `GET /tenant/v1/orders`、`GET /tenant/v1/orders/{id}`：供应商自己的订单（`order.read`）。租户编号只来自登录令牌；只有付过款的单；
 *   **没有渠道、对外价、加价比例、汇率**（规则 4）——应答里只有结算价和明细，序列化函数里根本没有那几项。派车等在 M3-02。
 * - `GET /platform/v1/orders`、`GET /platform/v1/orders/{id}`：运营后台（`order.read`），跨租户跨渠道，含对外价、结算价、加价比例、付款状态、报价快照的全部候选。
 *   完整的订单中心在 M4-02。
 * 共用的序列化函数也给销售端（routes/sales.ts）用：`orderTripJson` 是三边都能看的行程和乘客信息。
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ORDER_STATUSES, isLocalDate } from "@nozomi/domain";
import { bearerToken } from "../auth/token.ts";
import type { AppContext } from "../context.ts";
import { decodeTimeCursor } from "../pagination.ts";
import type { Order, OrderEvent, OrderPayment, OrderSale, PaymentEventRecord } from "../repos/orders.ts";
import { authenticatePlatform } from "../services/platform-auth.ts";
import { getOrderForPlatform, getOrderForTenant, listOrdersForPlatform, listOrdersForTenant } from "../services/order-queries.ts";
import { salesMoney } from "../services/sales-quotes.ts";
import { authenticateTenant } from "../services/tenant-auth.ts";
import { pageQuerySchema, parseInput, resourceId, uuidSchema } from "../validation.ts";

type Json = Record<string, unknown>;

const dateSchema = z.string().refine(isLocalDate, "日期写成 YYYY-MM-DD").optional();

const tenantListSchema = pageQuerySchema.extend({ status: z.enum(ORDER_STATUSES).optional(), from: dateSchema, to: dateSchema });
const platformListSchema = pageQuerySchema.extend({
  status: z.enum(ORDER_STATUSES).optional(),
  tenant_id: uuidSchema.transform((value) => value.toLowerCase()).optional(),
  channel_id: uuidSchema.transform((value) => value.toLowerCase()).optional(),
  q: z.string().trim().min(1).max(64).optional(),
});

/** 行程和乘客：租户、平台、渠道都能看的部分（没有任何金额）。 */
export function orderTripJson(order: Order): Json {
  return {
    id: order.id,
    order_no: order.orderNo,
    status: order.status,
    category: order.category,
    city_id: order.cityId,
    place_id: order.placeId,
    direction: order.direction,
    vehicle_group_id: order.vehicleGroupId,
    package_hours: order.packageHours,
    service_time: order.serviceAt.toISOString(),
    service_local: order.serviceLocal,
    timezone: order.timezone,
    service_date: order.serviceDate,
    urgent: order.urgent,
    passengers: order.passengers,
    luggage: order.luggage,
    pickup: order.pickup,
    dropoff: order.dropoff,
    addons: order.addons.map((addon) => ({ addon_id: addon.addonId, quantity: addon.quantity })),
    driver_language: order.driverLanguage,
    flight_no: order.flightNo,
    passenger: order.passenger,
    messaging: order.messaging,
    notes: order.notes,
    free_wait_minutes: order.freeWaitMinutes,
    created_at: order.createdAt.toISOString(),
    confirmed_at: order.confirmedAt?.toISOString() ?? null,
    cancelled_at: order.cancelledAt?.toISOString() ?? null,
    cancel_reason: order.cancelReason,
  };
}

/** 结算价和明细（租户、平台能看；渠道看不到）。 */
function settlementJson(order: Order): Json {
  const s = order.settlement;
  const money = (minor: number): Json => salesMoney(minor, order.settlementCurrency);
  return {
    total: money(order.settlementMinor),
    base: money(s.baseMinor),
    adjust: money(s.adjustMinor),
    urgent: money(s.urgentMinor),
    night: money(s.nightMinor),
    addons: money(s.addonsMinor),
    driver_language: money(s.driverLanguageMinor),
  };
}

function eventJson(event: OrderEvent): Json {
  return { from_status: event.fromStatus, to_status: event.toStatus, actor: event.actor, reason: event.reason, occurred_at: event.occurredAt.toISOString() };
}

/** 租户看到的订单：行程、乘客、结算价。没有渠道、对外价、加价比例、汇率（规则 4）。 */
function tenantOrderJson(order: Order): Json {
  return { ...orderTripJson(order), product_id: order.productId, product_version: order.productVersion, settlement: settlementJson(order), version: order.version };
}

function paymentJson(payment: OrderPayment | null): Json | null {
  if (payment === null) return null;
  return {
    provider: payment.provider,
    status: payment.status,
    amount: salesMoney(payment.amountMinor, payment.currency),
    intent_id: payment.intentId,
    customer_id: payment.customerId,
    payment_method_saved: payment.paymentMethodId !== null,
    refunded: salesMoney(payment.refundedMinor, payment.currency),
    disputed: payment.disputed,
    paid_after_cancel: payment.paidAfterCancel,
    last_error: payment.lastError,
    save_consent_at: payment.saveConsentAt.toISOString(),
    succeeded_at: payment.succeededAt?.toISOString() ?? null,
  };
}

function platformOrderJson(entry: { order: Order; sale: OrderSale; payment: OrderPayment | null; tenantName: string; channelName: string }): Json {
  const { order, sale } = entry;
  return {
    ...orderTripJson(order),
    tenant: { id: order.tenantId, name: entry.tenantName },
    channel: { id: sale.channelId, name: entry.channelName },
    quote_id: sale.quoteId,
    channel_order_no: sale.channelOrderNo,
    product_id: order.productId,
    product_version: order.productVersion,
    sell: salesMoney(sale.sellMinor, sale.currency),
    settlement: settlementJson(order),
    markup_bp: sale.markupBp,
    fx: sale.fx === null ? null : { from: sale.fx.from, to: sale.fx.to, rate: sale.fx.rate, as_of: sale.fx.asOf },
    fx_buffer_bp: sale.fxBufferBp,
    payment_due_at: order.paymentDueAt.toISOString(),
    payment: paymentJson(entry.payment),
    version: order.version,
  };
}

function paymentEventJson(event: PaymentEventRecord): Json {
  return { id: event.id, type: event.type, result: event.result, event_created_at: event.eventCreatedAt.toISOString(), received_at: event.receivedAt.toISOString(), detail: event.detail };
}

export function registerOrderRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/tenant/v1/orders", async (request) => {
    const principal = await authenticateTenant(ctx, bearerToken(request.headers.authorization), { action: "order.read" });
    const query = parseInput(tenantListSchema, request.query, "querystring");
    const page = await listOrdersForTenant(ctx, principal.tenantId, { status: query.status ?? null, from: query.from ?? null, to: query.to ?? null }, query.limit, decodeTimeCursor(query.cursor ?? null));
    return { items: page.items.map(tenantOrderJson), next_cursor: page.nextCursor, total: page.total };
  });

  app.get("/tenant/v1/orders/:id", async (request) => {
    const principal = await authenticateTenant(ctx, bearerToken(request.headers.authorization), { action: "order.read" });
    const found = await getOrderForTenant(ctx, principal.tenantId, resourceId(request.params, "订单"));
    return { order: tenantOrderJson(found.order), events: found.events.map(eventJson) };
  });

  app.get("/platform/v1/orders", async (request) => {
    await authenticatePlatform(ctx, bearerToken(request.headers.authorization), { action: "order.read" });
    const query = parseInput(platformListSchema, request.query, "querystring");
    const page = await listOrdersForPlatform(ctx, { status: query.status ?? null, tenantId: query.tenant_id ?? null, channelId: query.channel_id ?? null, q: query.q ?? null }, query.limit, decodeTimeCursor(query.cursor ?? null));
    return { items: page.items.map(platformOrderJson), next_cursor: page.nextCursor, total: page.total };
  });

  app.get("/platform/v1/orders/:id", async (request) => {
    await authenticatePlatform(ctx, bearerToken(request.headers.authorization), { action: "order.read" });
    const found = await getOrderForPlatform(ctx, resourceId(request.params, "订单"));
    return {
      order: platformOrderJson(found),
      events: found.events.map(eventJson),
      payment_events: found.paymentEvents.map(paymentEventJson),
      quote: {
        quote_id: found.quote.quoteId,
        created_at: found.quote.createdAt,
        expires_at: found.quote.expiresAt,
        band_bp: found.quote.bandBp,
        markup: { markup_bp: found.quote.markup.markupBp, level: found.quote.markup.level, rule_id: found.quote.markup.ruleId },
        candidates: found.quote.candidates.map((c) => ({
          tenant_id: c.tenantId,
          product_id: c.productId,
          product_version: c.productVersion,
          settlement: salesMoney(c.settlementMinor, c.settlementCurrency),
          sell: salesMoney(c.sellMinor, found.quote.currency),
          markup_bp: c.markupBp,
          observation: c.observation,
          score_centi: c.scoreCenti,
          completed_orders: c.completedOrders,
          rank_price: c.rankPrice,
          in_band: c.inBand,
          position: c.position,
        })),
      },
    };
  });
}
