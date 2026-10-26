/**
 * 订单的只读接口（M3-01，ADR 0026）。这里只做鉴权、校验、调用、返回。
 *
 * - `GET /tenant/v1/orders`、`GET /tenant/v1/orders/{id}`：供应商自己的订单（`order.read`）。租户编号只来自登录令牌；只有付过款的单；
 *   **没有渠道、对外价、加价比例、汇率**（规则 4）——应答里只有结算价和明细，序列化函数里根本没有那几项。派车等在 M3-02。
 * - `GET /platform/v1/orders`、`GET /platform/v1/orders/{id}`：运营后台（`order.read`），跨租户跨渠道，含对外价、结算价、加价比例、付款状态、报价快照的全部候选。
 *   完整的订单中心在 M4-02。
 * 共用的序列化函数在 services/order-views.ts（推给供应商的 Webhook 用同一份）；`orderTripJson` 是三边都能看的行程和乘客信息。
 * M3-02：订单带上派车（截止时间、超时没有、司机、车辆）、履约时间点、落地时间；详情另有派车记录、司机链接的状态（没有令牌）、照片、联系记录、定位、no-show 申请；
 * 照片原文用 `GET …/orders/{id}/files/{fileId}` 取。运营后台的详情另有推给供应商的全部 Webhook 投递。
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { ORDER_STATUSES, isLocalDate, portionBasisPoints } from "@nozomi/domain";
import { bearerToken } from "../auth/token.ts";
import type { AppContext } from "../context.ts";
import { decodeTimeCursor } from "../pagination.ts";
import type { Order, OrderEvent, OrderPayment, OrderSale, PaymentEventRecord } from "../repos/orders.ts";
import type { DriverLink, OrderFile } from "../repos/dispatch.ts";
import type { WebhookDelivery } from "../repos/webhooks.ts";
import { type DispatchFacts, cancelPolicyJson, changeJson, dispatchJson, extraChargeJson, fulfilmentJson, landingJson, orderTripJson, settlementJson, tenantOrderJson } from "../services/order-views.ts";
import { customerAmountOf } from "../services/extra-charges.ts";
import type { OrderRefund } from "../repos/refunds.ts";
import { authenticatePlatform, platformCredentials } from "../services/platform-auth.ts";
import { type OrderFulfilmentRecords, getOrderFile, getOrderForPlatform, getOrderForTenant, listOrdersForPlatform, listOrdersForTenant } from "../services/order-queries.ts";
import { salesMoney } from "../services/sales-quotes.ts";
import { fxJson } from "./quotes.ts";
import { authenticateTenant } from "../services/tenant-auth.ts";
import { pageQuerySchema, parseInput, resourceId, uuidSchema } from "../validation.ts";
import { platformRescueJson, tenantOrderRescueJson } from "./rescues.ts";

type Json = Record<string, unknown>;

const dateSchema = z.string().refine(isLocalDate, "日期写成 YYYY-MM-DD").optional();

const tenantListSchema = pageQuerySchema.extend({ status: z.enum(ORDER_STATUSES).optional(), from: dateSchema, to: dateSchema, dispatch: z.enum(["unassigned", "overdue"]).optional() });
const platformListSchema = pageQuerySchema.extend({
  status: z.enum(ORDER_STATUSES).optional(),
  tenant_id: uuidSchema.transform((value) => value.toLowerCase()).optional(),
  channel_id: uuidSchema.transform((value) => value.toLowerCase()).optional(),
  q: z.string().trim().min(1).max(64).optional(),
});

function eventJson(event: OrderEvent): Json {
  return { from_status: event.fromStatus, to_status: event.toStatus, actor: event.actor, reason: event.reason, occurred_at: event.occurredAt.toISOString() };
}

function linkJson(link: DriverLink | null, now: Date): Json | null {
  if (link === null) return null;
  return { id: link.id, status: link.expiresAt.getTime() <= now.getTime() ? "expired" : "active", created_at: link.createdAt.toISOString(), expires_at: link.expiresAt.toISOString(), last_used_at: link.lastUsedAt?.toISOString() ?? null };
}

/** 派车记录、司机链接（没有令牌）、照片、联系记录、定位、no-show 申请。 */
export function recordsJson(records: OrderFulfilmentRecords, now: Date): Json {
  return {
    assignments: records.assignments.map((entry) => ({ id: entry.id, driver_id: entry.driverId, vehicle_id: entry.vehicleId, is_change: entry.isChange, conflict_confirmed: entry.conflictConfirmed, assigned_at: entry.assignedAt.toISOString() })),
    driver_link: linkJson(records.link, now),
    files: records.files.map(fileJson),
    contacts: records.contacts.map((contact) => ({ id: contact.id, method: contact.method, note: contact.note, file_id: contact.fileId, occurred_at: contact.occurredAt.toISOString() })),
    locations: records.locations.map((location) => ({ kind: location.kind, lng: location.lng, lat: location.lat, accuracy_m: location.accuracyM, recorded_at: location.recordedAt.toISOString() })),
    no_show_claim:
      records.claim === null
        ? null
        : { status: records.claim.status, submitted_at: records.claim.submittedAt.toISOString(), free_wait_start: records.claim.freeWaitStart.toISOString(), free_wait_end: records.claim.freeWaitEnd.toISOString(), checklist: records.claim.checklist },
  };
}

export function fileJson(file: OrderFile): Json {
  return { id: file.id, kind: file.kind, content_type: file.contentType, byte_size: file.byteSize, uploaded_at: file.uploadedAt.toISOString() };
}

export function deliveryJson(delivery: WebhookDelivery): Json {
  return {
    id: delivery.id,
    event_id: delivery.eventId,
    event_type: delivery.eventType,
    order_id: delivery.orderId,
    data: delivery.eventData,
    status: delivery.status,
    attempts: delivery.attempts,
    next_attempt_at: delivery.status === "pending" ? (delivery.nextAttemptAt?.toISOString() ?? null) : null,
    last_attempt_at: delivery.lastAttemptAt?.toISOString() ?? null,
    last_status_code: delivery.lastStatusCode,
    last_error_code: delivery.lastErrorCode,
    last_duration_ms: delivery.lastDurationMs,
    succeeded_at: delivery.succeededAt?.toISOString() ?? null,
    failed_at: delivery.failedAt?.toISOString() ?? null,
    created_at: delivery.createdAt.toISOString(),
  };
}

export function paymentJson(payment: OrderPayment | null): Json | null {
  if (payment === null) return null;
  return {
    id: payment.id,
    kind: payment.kind,
    change_id: payment.changeId,
    extra_charge_id: payment.extraChargeId,
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

export function refundJson(refund: OrderRefund): Json {
  return {
    id: refund.id,
    payment_id: refund.paymentId,
    purpose: refund.purpose,
    change_id: refund.changeId,
    amount: salesMoney(refund.amountMinor, refund.currency),
    status: refund.status,
    provider_refund_id: refund.providerRefundId,
    retry_of: refund.retryOf,
    attempts: refund.attempts,
    next_attempt_at: refund.status === "pending" ? (refund.nextAttemptAt?.toISOString() ?? null) : null,
    last_error: refund.lastError,
    succeeded_at: refund.succeededAt?.toISOString() ?? null,
    failed_at: refund.failedAt?.toISOString() ?? null,
    superseded_at: refund.supersededAt?.toISOString() ?? null,
    created_at: refund.createdAt.toISOString(),
  };
}

/** 运营后台看到的取消结果：扣款比例、客人被扣的、供应商应得的、说明。退了多少看 `refunds`。 */
function platformCancellationJson(order: Order, sale: OrderSale): Json | null {
  if (order.status !== "cancelled") return null;
  return {
    reason: order.cancelReason,
    note: order.cancelNote,
    fee_bp: order.cancelFeeBp,
    customer_fee: order.cancelFeeBp === null ? null : salesMoney(portionBasisPoints(sale.sellMinor, order.cancelFeeBp), sale.currency),
    tenant_share: order.cancelTenantShareMinor === null ? null : salesMoney(order.cancelTenantShareMinor, order.settlementCurrency),
  };
}

function platformOrderJson(entry: { order: Order; sale: OrderSale; payment: OrderPayment | null; tenantName: string; channelName: string; facts?: DispatchFacts }, now: Date): Json {
  const { order, sale } = entry;
  return {
    ...orderTripJson(order),
    dispatch: dispatchJson(order, entry.facts ?? { driver: null, vehicle: null }, now),
    fulfilment: fulfilmentJson(order),
    landing: landingJson(order),
    tenant: { id: order.tenantId, name: entry.tenantName },
    channel: { id: sale.channelId, name: entry.channelName },
    quote_id: sale.quoteId,
    channel_order_no: sale.channelOrderNo,
    product_id: order.productId,
    product_version: order.productVersion,
    sell: salesMoney(sale.sellMinor, sale.currency),
    settlement: settlementJson(order),
    markup_bp: sale.markupBp,
    fx: sale.fx === null ? null : fxJson(sale.fx),
    fx_buffer_bp: sale.fxBufferBp,
    payment_due_at: order.paymentDueAt.toISOString(),
    payment: paymentJson(entry.payment),
    cancel_policy: cancelPolicyJson(order),
    cancellation: platformCancellationJson(order, sale),
    version: order.version,
  };
}

function paymentEventJson(event: PaymentEventRecord): Json {
  return { id: event.id, type: event.type, result: event.result, event_created_at: event.eventCreatedAt.toISOString(), received_at: event.receivedAt.toISOString(), detail: event.detail };
}

/** 路径里的照片编号；格式不对的当作不存在。 */
export function fileIdOf(params: unknown): string {
  return resourceId({ id: (params as { fileId?: unknown }).fileId }, "照片");
}

/** 照片原样返回：类型是上传时按字节判断出来的；不让浏览器猜类型、不当作页面打开（防止伪装成图片的内容被执行）。 */
export function sendFile(reply: FastifyReply, file: OrderFile & { data: Buffer }): FastifyReply {
  return reply
    .header("content-type", file.contentType)
    .header("content-disposition", "inline")
    .header("x-content-type-options", "nosniff")
    .header("content-security-policy", "default-src 'none'; sandbox")
    .send(file.data);
}

export function registerOrderRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/tenant/v1/orders", async (request) => {
    const principal = await authenticateTenant(ctx, bearerToken(request.headers.authorization), { action: "order.read" });
    const query = parseInput(tenantListSchema, request.query, "querystring");
    const page = await listOrdersForTenant(ctx, principal.tenantId, { status: query.status ?? null, from: query.from ?? null, to: query.to ?? null, dispatch: query.dispatch ?? null }, query.limit, decodeTimeCursor(query.cursor ?? null));
    const now = ctx.now();
    return { items: page.items.map((item) => tenantOrderJson(item.order, item.facts, now)), next_cursor: page.nextCursor, total: page.total };
  });

  app.get("/tenant/v1/orders/:id", async (request) => {
    const principal = await authenticateTenant(ctx, bearerToken(request.headers.authorization), { action: "order.read" });
    const found = await getOrderForTenant(ctx, principal.tenantId, resourceId(request.params, "订单"));
    const now = ctx.now();
    return {
      order: tenantOrderJson(found.order, found.facts, now),
      events: found.events.map(eventJson),
      records: recordsJson(found.records, now),
      changes: found.changes.map(changeJson),
      extra_charges: found.extraCharges.map(extraChargeJson),
      rescue: tenantOrderRescueJson(found.rescue, found.order),
    };
  });

  app.get("/tenant/v1/orders/:id/files/:fileId", async (request, reply) => {
    const principal = await authenticateTenant(ctx, bearerToken(request.headers.authorization), { action: "order.read" });
    const file = await getOrderFile(ctx, { tenantId: principal.tenantId }, resourceId(request.params, "订单"), fileIdOf(request.params));
    return sendFile(reply, file);
  });

  app.get("/platform/v1/orders/:id/files/:fileId", async (request, reply) => {
    const principal = await authenticatePlatform(ctx, platformCredentials(request), { action: "order.read" });
    const file = await getOrderFile(ctx, { platform: principal.grant.scope }, resourceId(request.params, "订单"), fileIdOf(request.params));
    return sendFile(reply, file);
  });

  app.get("/platform/v1/orders", async (request) => {
    const principal = await authenticatePlatform(ctx, platformCredentials(request), { action: "order.read" });
    const query = parseInput(platformListSchema, request.query, "querystring");
    const scope = principal.grant.scope;
    const page = await listOrdersForPlatform(ctx, { status: query.status ?? null, tenantId: query.tenant_id ?? null, channelId: query.channel_id ?? null, q: query.q ?? null, scopeCityIds: scope.cityIds, scopeChannelIds: scope.channelIds }, query.limit, decodeTimeCursor(query.cursor ?? null));
    const now = ctx.now();
    return { items: page.items.map((item) => platformOrderJson(item, now)), next_cursor: page.nextCursor, total: page.total };
  });

  app.get("/platform/v1/orders/:id", async (request) => {
    const principal = await authenticatePlatform(ctx, platformCredentials(request), { action: "order.read" });
    const found = await getOrderForPlatform(ctx, resourceId(request.params, "订单"), principal.grant.scope);
    const now = ctx.now();
    return {
      order: platformOrderJson(found, now),
      events: found.events.map(eventJson),
      records: recordsJson(found.records, now),
      webhook_deliveries: found.deliveries.map(deliveryJson),
      payment_events: found.paymentEvents.map(paymentEventJson),
      payments: found.payments.map((payment) => paymentJson(payment)),
      refunds: found.refunds.map(refundJson),
      changes: found.changes.map((change) => {
        const sold = found.changeSales.get(change.id) ?? null;
        return { ...changeJson(change), sell_before: sold === null ? null : salesMoney(sold.sellBeforeMinor, sold.currency), sell_after: sold === null ? null : salesMoney(sold.sellAfterMinor, sold.currency) };
      }),
      rescues: found.rescues.map(platformRescueJson),
      extra_charges: found.extraCharges.map((charge) => ({ ...extraChargeJson(charge), customer_amount: salesMoney(customerAmountOf(charge, found.sale), found.sale.currency), last_charge_error: charge.lastChargeError, charge_attempts: charge.chargeAttempts })),
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
