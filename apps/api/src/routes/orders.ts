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
import { type OrderEntrySource, orderEntrySource } from "../services/embed.ts";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { type CurrencyCode, type LocalizedText, maskOrderValues, ORDER_STATUSES, SERVICE_CATEGORIES, isLocalDate, portionBasisPoints } from "@nozomi/domain";
import { bearerToken } from "../auth/token.ts";
import type { AppContext } from "../context.ts";
import { decodeTimeCursor } from "../pagination.ts";
import type { Order, OrderEvent, OrderPayment, OrderSale, PaymentEventRecord } from "../repos/orders.ts";
import type { DriverLink, OrderFile } from "../repos/dispatch.ts";
import { driverLinkEmailJson, getDriverLinkEmail, mailConfigured } from "../services/driver-link-email.ts";
import type { WebhookDelivery } from "../repos/webhooks.ts";
import { type DispatchFacts, areaSurchargeDetailJson, pricingRouteJson, distanceMoneyJson, mileageMoneyJson, cancelPolicyJson, changeJson, dispatchJson, extraChargeJson, fulfilmentJson, landingJson, orderTripJson, orderVehicleGroupJson, settlementJson, tenantOrderJson } from "../services/order-views.ts";
import { customerAmountOf } from "../services/extra-charges.ts";
import type { OrderRefund } from "../repos/refunds.ts";
import { authenticatePlatform, platformCredentials } from "../services/platform-auth.ts";
import { type OrderFulfilmentRecords, assertPlatformOrderInScope, getOrderFile, getOrderForPlatform, getOrderForTenant, listOrdersForPlatform, listOrdersForTenant } from "../services/order-queries.ts";
import { PLATFORM_PROXY_SOURCE } from "../services/fulfilment.ts";
import { orderPassengerNames, revealPassenger } from "../services/passenger-privacy.ts";
import { salesMoney } from "../services/sales-quotes.ts";
import { orderPricingBasis, orderSellDistance } from "../services/order-price-notes.ts";
import { fxJson } from "./quotes.ts";
import { authenticateTenant } from "../services/tenant-auth.ts";
import { dateTimeSchema, pageQuerySchema, parseInput, resourceId, uuidSchema } from "../validation.ts";
import { orderTicketJson } from "./order-center.ts";
import { platformRescueJson, tenantOrderRescueJson } from "./rescues.ts";
import { passengerEmailReviewJson } from "./serialize.ts";

type Json = Record<string, unknown>;

const dateSchema = z.string().refine(isLocalDate, "日期写成 YYYY-MM-DD").optional();

const tenantListSchema = pageQuerySchema.extend({ status: z.enum(ORDER_STATUSES).optional(), from: dateSchema, to: dateSchema, dispatch: z.enum(["unassigned", "overdue"]).optional(), change: z.enum(["pending"]).optional() });
const platformListSchema = pageQuerySchema.extend({
  status: z.enum(ORDER_STATUSES).optional(),
  tenant_id: uuidSchema.transform((value) => value.toLowerCase()).optional(),
  channel_id: uuidSchema.transform((value) => value.toLowerCase()).optional(),
  q: z.string().trim().min(1).max(64).optional(),
  // 订单中心（M4-02）：用车日期（城市当地，两端都含）、下单时间（[from, to)）、城市、品类、是否有没关的异常、乘客姓名或电话
  service_from: dateSchema,
  service_to: dateSchema,
  created_from: dateTimeSchema.optional(),
  created_to: dateTimeSchema.optional(),
  city_id: uuidSchema.transform((value) => value.toLowerCase()).optional(),
  category: z.enum(SERVICE_CATEGORIES).optional(),
  exception: z.enum(["open", "none"]).optional(),
  passenger: z.string().trim().min(2).max(100).optional(),
});

/**
 * 状态流水。平台代传（ADR 0052）的来源和系统收到的时间两边都看得到（防争议）；原因和操作人只给运营后台：
 * 原因是手写的文字，不能保证不含对外价和加价比例（规则 4）。其余 `detail` 不出接口。
 */
function eventJson(event: OrderEvent, scope: "tenant" | "platform"): Json {
  const base = { from_status: event.fromStatus, to_status: event.toStatus, actor: event.actor, reason: event.reason, occurred_at: event.occurredAt.toISOString() };
  const detail = event.detail ?? {};
  if (detail["source"] !== PLATFORM_PROXY_SOURCE) return { ...base, source: null, recorded_at: null };
  const proxied = { ...base, source: PLATFORM_PROXY_SOURCE, recorded_at: detail["recorded_at"] };
  if (scope === "tenant") return proxied;
  return { ...proxied, proxy: { reason: detail["proxy_reason"] ?? null, requested_by: detail["user_id"] ?? null, approved_by: detail["approved_by"] ?? null, approval_id: detail["approval_id"] ?? null } };
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

/**
 * 运营看到的包车区域加价（ADR 0073 第四部分）：结算价（同供应商看到的）加上对外价参考——报价快照里按这一单的汇率、缓冲、加价比例
 * 单独换算、单独取整的数（已含在对外价里，和总价可能差一个取整单位以内）。快照里没有（M8-15 之前的报价）时对外价为 null。
 */
function platformAreaSurchargeJson(found: { order: Order; surchargeAreaNames: ReadonlyMap<string, LocalizedText>; quote: { currency: CurrencyCode; winner: { sell: { areaSurcharge?: { pickupMinor: number; dropoffMinor: number } } } } }): Json | null {
  const detail = areaSurchargeDetailJson(found.order, found.surchargeAreaNames);
  if (detail === null) return null;
  const sell = found.quote.winner.sell.areaSurcharge ?? null;
  const money = (minor: number | undefined): Json | null => (sell === null || minor === undefined ? null : salesMoney(minor, found.quote.currency));
  return { ...detail, pickup: { ...(detail["pickup"] as Json), sell: money(sell?.pickupMinor) }, dropoff: { ...(detail["dropoff"] as Json), sell: money(sell?.dropoffMinor) } };
}

/**
 * 运营看到的含公里数（ADR 0073 第四部分）：结算价（同供应商看到的）加上超出每公里的对外价参考——订单上锁定的结算单价按这一单对外价用的汇率、缓冲、
 * 加价比例单独换算、单独取整（和官网订单页、确认邮件同一个数，M8-13）。没设含公里数的订单为 null。
 */
function platformDistanceJson(found: { order: Order; sale: OrderSale }): Json | null {
  const detail = distanceMoneyJson(found.order.settlement, found.order.settlementCurrency);
  const sell = orderSellDistance(found.order, found.sale);
  if (detail === null || sell === null) return null;
  return { ...detail, over_km_per_km_sell: salesMoney(sell.overKmPerKmMinor, sell.currency) };
}

/** 推送内容里的乘客也打码（运营详情一页看全，不能从这里绕过「查看」）。 */
export function maskedDeliveryData(data: Record<string, unknown>, names: readonly string[] | null = null): Record<string, unknown> {
  return maskOrderValues(data, names);
}

function platformOrderJson(entry: { order: Order; sale: OrderSale; payment: OrderPayment | null; tenantName: string; channelName: string; facts?: DispatchFacts }, now: Date, names: readonly string[]): Json {
  const { order, sale } = entry;
  const known = [order.passenger.name, ...names];
  return maskOrderValues({
    ...orderTripJson(order),
    // 运营后台默认打码，点「查看」走 `POST …/passenger/reveal` 并记审计（ADR 0052）。乘客、即时通讯账号、备注、取消说明都在下面统一打码
    notes_masked: order.notes !== null && maskOrderValues({ notes: order.notes }, known).notes !== order.notes,
    passenger_anonymized_at: order.passengerAnonymizedAt?.toISOString() ?? null,
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
    // 测试环境验收通道下的验收单（M8-26，ADR 0078）：后台标「验收」；不进结算
    is_acceptance: order.isAcceptance,
    version: order.version,
  }, known);
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
    const page = await listOrdersForTenant(ctx, principal.tenantId, { status: query.status ?? null, from: query.from ?? null, to: query.to ?? null, dispatch: query.dispatch ?? null, change: query.change ?? null }, query.limit, decodeTimeCursor(query.cursor ?? null));
    const now = ctx.now();
    return { items: page.items.map((item) => tenantOrderJson(item.order, item.facts, now)), next_cursor: page.nextCursor, total: page.total };
  });

  app.get("/tenant/v1/orders/:id", async (request) => {
    const principal = await authenticateTenant(ctx, bearerToken(request.headers.authorization), { action: "order.read" });
    const found = await getOrderForTenant(ctx, principal.tenantId, resourceId(request.params, "订单"));
    const now = ctx.now();
    return {
      order: tenantOrderJson(found.order, found.facts, now),
      events: found.events.map((event) => eventJson(event, "tenant")),
      records: recordsJson(found.records, now),
      changes: found.changes.map(changeJson),
      extra_charges: found.extraCharges.map(extraChargeJson),
      rescue: tenantOrderRescueJson(found.rescue, found.order),
      driver_link_email: driverLinkEmailJson(await getDriverLinkEmail(ctx, principal.tenantId, found.order.id), await mailConfigured(ctx)),
      vehicle_group: orderVehicleGroupJson(found.vehicleGroup),
      // 包车区域加价（ADR 0073）：只有结算价（规则 4）
      area_surcharge: areaSurchargeDetailJson(found.order, found.surchargeAreaNames),
      // 点对点用的价格（M8-13）：线路价 / 区域价和区域名称，没有金额
      pricing_route: pricingRouteJson(found.pricingRoute),
      // 计价方式和计程明细（M8-30，ADR 0080）：只有结算价（规则 4）
      pricing_basis: orderPricingBasis(found.order),
      mileage: mileageMoneyJson(found.order.settlement, found.order.settlementCurrency),
    };
  });

  app.get("/tenant/v1/orders/:id/files/:fileId", async (request, reply) => {
    const principal = await authenticateTenant(ctx, bearerToken(request.headers.authorization), { action: "order.read" });
    const file = await getOrderFile(ctx, { tenantId: principal.tenantId }, resourceId(request.params, "订单"), fileIdOf(request.params));
    return sendFile(reply, file);
  });

  app.get("/platform/v1/orders/:id/files/:fileId", async (request, reply) => {
    const principal = await authenticatePlatform(ctx, platformCredentials(request), { action: "order.read" });
    const file = await getOrderFile(ctx, { platform: principal, ip: request.ip }, resourceId(request.params, "订单"), fileIdOf(request.params));
    return sendFile(reply, file);
  });

  app.get("/platform/v1/orders", async (request) => {
    const principal = await authenticatePlatform(ctx, platformCredentials(request), { action: "order.read" });
    const query = parseInput(platformListSchema, request.query, "querystring");
    const scope = principal.grant.scope;
    const page = await listOrdersForPlatform(
      ctx,
      {
        status: query.status ?? null,
        tenantId: query.tenant_id ?? null,
        channelId: query.channel_id ?? null,
        q: query.q ?? null,
        serviceFrom: query.service_from ?? null,
        serviceTo: query.service_to ?? null,
        createdFrom: query.created_from ?? null,
        createdTo: query.created_to ?? null,
        cityId: query.city_id ?? null,
        category: query.category ?? null,
        exception: query.exception ?? null,
        passenger: query.passenger ?? null,
        scopeCityIds: scope.cityIds,
        scopeChannelIds: scope.channelIds,
      },
      query.limit,
      decodeTimeCursor(query.cursor ?? null),
    );
    const now = ctx.now();
    const names = await orderPassengerNames(ctx, page.items.map((item) => item.order.id));
    return { items: page.items.map((item) => ({ ...platformOrderJson(item, now, names.get(item.order.id) ?? []), open_exceptions: page.openExceptions.get(item.order.id) ?? 0 })), next_cursor: page.nextCursor, total: page.total };
  });

  app.post("/platform/v1/orders/:id/passenger/reveal", async (request) => {
    const principal = await authenticatePlatform(ctx, platformCredentials(request), { action: "order.read" });
    const orderId = resourceId(request.params, "订单");
    await assertPlatformOrderInScope(ctx, principal.grant.scope, orderId);
    return await revealPassenger(ctx, principal, orderId, request.ip);
  });

  app.get("/platform/v1/orders/:id", async (request) => {
    const principal = await authenticatePlatform(ctx, platformCredentials(request), { action: "order.read" });
    const found = await getOrderForPlatform(ctx, resourceId(request.params, "订单"), principal.grant.scope);
    const now = ctx.now();
    const names = (await orderPassengerNames(ctx, [found.order.id])).get(found.order.id) ?? [];
    return {
      // 改单的前后值、手写的说明、工单、异常、救援都打码（ADR 0055），看原文走 reveal；键的白名单见 `HANDWRITTEN_KEYS`。
      ...maskOrderValues({
      order: platformOrderJson(found, now, names),
      events: found.events.map((event) => eventJson(event, "platform")),
      pending_proxy_review: found.pendingProxyReview === null ? null : { approval_id: found.pendingProxyReview.approval.id, event: found.pendingProxyReview.event, requested_at: found.pendingProxyReview.approval.requestedAt.toISOString() },
      // 代改的乘客邮箱在等审核（ADR 0065）：只有打码地址
      pending_email_review: found.pendingEmailReview === null ? null : passengerEmailReviewJson(found.pendingEmailReview),
      // 司机手写的联系备注可能抄了客人的联系方式：运营这边同样打码（ADR 0054）
      records: recordsJson(found.records, now),
      webhook_deliveries: found.deliveries.map((delivery) => ({ ...deliveryJson(delivery), data: delivery.eventData })),
      payment_events: found.paymentEvents.map(paymentEventJson),
      payments: found.payments.map((payment) => paymentJson(payment)),
      refunds: found.refunds.map(refundJson),
      changes: found.changes.map((change) => {
        const sold = found.changeSales.get(change.id) ?? null;
        return { ...changeJson(change), sell_before: sold === null ? null : salesMoney(sold.sellBeforeMinor, sold.currency), sell_after: sold === null ? null : salesMoney(sold.sellAfterMinor, sold.currency) };
      }),
      rescues: found.rescues.map(platformRescueJson),
      exceptions: found.exceptions.map((exception) => ({
        id: exception.id,
        type: exception.type,
        tenant_id: exception.tenantId,
        status: exception.status,
        opened_at: exception.openedAt.toISOString(),
        due_at: exception.dueAt.toISOString(),
        assignee_id: exception.assigneeId,
        close_kind: exception.closeKind,
        closed_at: exception.closedAt?.toISOString() ?? null,
      })),
      tickets: found.tickets.map(orderTicketJson),
      extra_charges: found.extraCharges.map((charge) => ({ ...extraChargeJson(charge), customer_amount: salesMoney(customerAmountOf(charge, found.sale), found.sale.currency), last_charge_error: charge.lastChargeError, charge_attempts: charge.chargeAttempts })),
      }, names),
      vehicle_group: orderVehicleGroupJson(found.vehicleGroup),
      area_surcharge: platformAreaSurchargeJson(found),
      // 点对点含公里数（M8-11）：结算价 + 超出每公里的对外价参考（只有运营看得到）
      distance: platformDistanceJson(found),
      pricing_route: pricingRouteJson(found.pricingRoute),
      // 计价方式和计程明细（M8-30，ADR 0080）：结算价
      pricing_basis: orderPricingBasis(found.order),
      mileage: mileageMoneyJson(found.order.settlement, found.order.settlementCurrency),
      // 来源（M9E-02，ADR 0090）：只做统计；只有运营后台有，供应商接口没有
      entry_source: entrySourceJson(await orderEntrySource(ctx, found.order.id)),
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

function entrySourceJson(source: OrderEntrySource): Record<string, unknown> {
  return source.kind === "embed"
    ? { kind: "embed", embed_key_id: source.embedKeyId, embed_key_name: source.embedKeyName, embed_origin: source.embedOrigin, delivery: source.delivery }
    : { kind: "book", embed_key_id: null, embed_key_name: null, embed_origin: null, delivery: null };
}
