/**
 * `/sales/v1`：渠道调用的销售端接口（M2-04，ADR 0023）。这里只做鉴权、校验、调用、返回。
 *
 * - `POST /sales/v1/oauth/token`：OAuth 2.0 Client Credentials，换 2 小时的访问令牌（JSON 或表单都行）。
 * - `POST /sales/v1/quotes`：询价。渠道只来自令牌；只比渠道授权的租户、城市、品类；每个渠道每秒 50 次。
 * - `GET /sales/v1/quotes/{quote_id}`：下单前确认报价仍有效（过期 410 `QUOTE_EXPIRED`）；只查得到本渠道的。每个渠道每秒 10 次。
 * - `POST /sales/v1/orders`：用 quote_id 下单（M3-01，ADR 0026），必须带 Idempotency-Key；应答里有给前端确认付款用的 Stripe client_secret。每个渠道每秒 10 次。
 * - `GET /sales/v1/orders/{id}`：查本渠道的订单；付款成功后（渠道设置了展示时）才有中标租户名；派车后有司机和车辆（M3-02）。
 * - `POST /sales/v1/orders/{id}/landed`：客人「我已落地」（M3-02，ADR 0027；官网订单页在 M3-05）。时间用系统收到的时间，提交后不能改。
 * 应答里没有结算价、加价比例；付款前没有中标租户。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { MESSAGING_APPS, PRICE_LIMITS, QUOTE_RULES, SERVICE_CATEGORIES, TRIP_DIRECTIONS } from "@nozomi/domain";
import { bearerToken } from "../auth/token.ts";
import type { AppContext } from "../context.ts";
import { AppError } from "../errors.ts";
import { authenticateSales, issueSalesToken } from "../services/sales-auth.ts";
import { type SalesPoint, type SalesQuote, createSalesQuotes, getSalesQuote, salesMoney } from "../services/sales-quotes.ts";
import { type SalesOrderPayment, type SalesOrderView, createSalesOrder, getSalesOrderView, reportGuestLanding } from "../services/orders.ts";
import { dateTimeSchema, idempotencyKey, parseInput, resourceId, uuidSchema } from "../validation.ts";
import { landingJson, orderTripJson } from "../services/order-views.ts";

const tokenSchema = z.object({ grant_type: z.literal("client_credentials"), client_id: z.string().min(1).max(100), client_secret: z.string().min(1).max(200) }).strict();

const pointSchema = z.union([
  z.object({ place_id: uuidSchema }).strict(),
  z.object({ lng: z.number().min(-180).max(180), lat: z.number().min(-90).max(90) }).strict(),
]);

const quoteSchema = z
  .object({
    city_id: uuidSchema,
    category: z.enum(SERVICE_CATEGORIES),
    place_id: uuidSchema.nullable().default(null),
    direction: z.enum(TRIP_DIRECTIONS).nullable().default(null),
    pickup: pointSchema.nullable().default(null),
    dropoff: pointSchema.nullable().default(null),
    service_time: dateTimeSchema,
    package_hours: z.number().int().min(1).max(PRICE_LIMITS.maxPackageHours).nullable().default(null),
    passengers: z.number().int(),
    luggage: z.number().int().default(0),
    addons: z.array(z.object({ addon_id: uuidSchema, quantity: z.number().int().default(1) }).strict()).max(QUOTE_RULES.maxAddonKinds).default([]),
    driver_language: z.string().max(10).nullable().default(null),
    vehicle_group_ids: z.array(uuidSchema).max(30).default([]),
    currency: z.string().max(3),
  })
  .strict();

const quoteIdSchema = /^QT\d{8}[0-9A-Z]{10}$/;

const text = (max: number) => z.string().max(max).nullable().default(null);
const orderSchema = z
  .object({
    quote_id: z.string().regex(quoteIdSchema, "不是 quote_id 的格式（QT + 日期 + 10 位）"),
    passenger: z.object({ name: z.string().max(200), phone: z.string().max(40), email: z.string().max(320) }).strict(),
    flight_no: text(20),
    pickup_address: text(1_000),
    dropoff_address: text(1_000),
    messaging: z.object({ app: z.enum(MESSAGING_APPS), handle: z.string().max(200) }).strict().nullable().default(null),
    notes: text(2_000),
    channel_order_no: text(200),
    // 客人勾选「同意保存支付方式，用于服务后加收」（第五轮决策 ⑤）；没勾不能下单
    save_payment_method: z.boolean(),
  })
  .strict();

function point(input: z.output<typeof pointSchema> | null): SalesPoint | null {
  if (input === null) return null;
  return "place_id" in input ? { placeId: input.place_id } : { lng: input.lng, lat: input.lat };
}

function quoteJson(quote: SalesQuote): Record<string, unknown> {
  return {
    quote_id: quote.quoteId,
    created_at: quote.createdAt,
    expires_at: quote.expiresAt,
    vehicle_group_id: quote.vehicleGroupId,
    package_hours: quote.packageHours,
    service_date: quote.serviceDate,
    urgent: quote.urgent,
    price: { total: salesMoney(quote.sellMinor, quote.currency), fx: quote.fx === null ? null : { rate: quote.fx.rate, as_of: quote.fx.asOf } },
    free_wait_minutes: quote.freeWaitMinutes,
  };
}

function salesOrderJson(view: SalesOrderView): Record<string, unknown> {
  const { order, sale, payment } = view;
  return {
    ...orderTripJson(order),
    quote_id: sale.quoteId,
    channel_order_no: sale.channelOrderNo,
    price: { total: salesMoney(sale.sellMinor, sale.currency), fx: sale.fx === null ? null : { rate: sale.fx.rate, as_of: sale.fx.asOf } },
    payment_status: payment?.status ?? "creating",
    payment_due_at: order.paymentDueAt.toISOString(),
    winning_tenant: view.winningTenant,
    // 派的司机和车辆（M3-02）：只给客人看得到的——姓名、语言、电话（用车前 24 小时起）、车牌、车型、颜色
    driver: view.driver === null ? null : { name: view.driver.name, languages: view.driver.languages, phone: view.driverPhoneVisible ? view.driver.phone : null },
    vehicle: view.vehicle === null ? null : { plate: view.vehicle.plate, model: view.vehicle.model, color: view.vehicle.color, vehicle_group_id: view.vehicle.vehicleGroupId },
    landing: landingJson(order),
  };
}

function paymentJson(payment: SalesOrderPayment): Record<string, unknown> {
  return { provider: payment.provider, status: payment.status, client_secret: payment.clientSecret, publishable_key: payment.publishableKey };
}

export function registerSalesRoutes(app: FastifyInstance, ctx: AppContext): void {
  const channel = (request: FastifyRequest, scope: "quote" | "other") => authenticateSales(ctx, bearerToken(request.headers.authorization), scope);

  // OAuth 2.0 的令牌接口按规范收表单（application/x-www-form-urlencoded）；只在这一个接口上认表单，别的接口照旧只收 JSON
  app.register(async (scoped) => {
    scoped.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string", bodyLimit: 4_096 }, (_request, body, done) => {
      done(null, Object.fromEntries(new URLSearchParams(body as string)));
    });
    scoped.post("/sales/v1/oauth/token", async (request) => {
      const input = parseInput(tokenSchema, request.body, "body");
      const issued = await issueSalesToken(ctx, { clientId: input.client_id, clientSecret: input.client_secret }, request.ip);
      return { access_token: issued.accessToken, token_type: "Bearer", expires_in: issued.expiresIn, channel_id: issued.channelId };
    });
  });

  app.post("/sales/v1/quotes", async (request) => {
    const principal = await channel(request, "quote");
    const input = parseInput(quoteSchema, request.body, "body");
    const result = await createSalesQuotes(
      ctx,
      principal,
      {
        cityId: input.city_id,
        category: input.category,
        placeId: input.place_id,
        direction: input.direction,
        pickup: point(input.pickup),
        dropoff: point(input.dropoff),
        serviceTime: input.service_time,
        packageHours: input.package_hours,
        passengers: input.passengers,
        luggage: input.luggage,
        addons: input.addons.map((addon) => ({ addonId: addon.addon_id, quantity: addon.quantity })),
        driverLanguage: input.driver_language,
        vehicleGroupIds: input.vehicle_group_ids,
        currency: input.currency,
      },
      { log: request.log, request: { ...input, service_time: input.service_time.toISOString() } },
    );
    return { quotes: result.quotes.map(quoteJson), unavailable: result.unavailable.map((entry) => ({ vehicle_group_id: entry.vehicleGroupId, reasons: entry.reasons })) };
  });

  app.post("/sales/v1/orders", async (request, reply) => {
    const principal = await channel(request, "other");
    const key = idempotencyKey(request.headers["idempotency-key"]);
    const input = parseInput(orderSchema, request.body, "body");
    const created = await createSalesOrder(
      ctx,
      principal,
      {
        quoteId: input.quote_id,
        idempotencyKey: key,
        details: {
          passenger: input.passenger,
          flightNo: input.flight_no,
          pickupAddress: input.pickup_address,
          dropoffAddress: input.dropoff_address,
          messaging: input.messaging,
          notes: input.notes,
          channelOrderNo: input.channel_order_no,
          savePaymentMethodConsent: input.save_payment_method,
        },
      },
      request.log,
    );
    if (created.replayed) reply.header("idempotent-replayed", "true");
    return reply.code(201).send({ order: salesOrderJson(created.view), payment: paymentJson(created.payment) });
  });

  app.get("/sales/v1/orders/:id", async (request) => {
    const principal = await channel(request, "other");
    const view = await getSalesOrderView(ctx, principal.channelId, resourceId(request.params, "订单"));
    if (view === null) throw new AppError(404, "NOT_FOUND", "订单不存在");
    return { order: salesOrderJson(view) };
  });

  app.post("/sales/v1/orders/:id/landed", async (request) => {
    const principal = await channel(request, "other");
    const view = await reportGuestLanding(ctx, principal.channelId, resourceId(request.params, "订单"));
    return { order: salesOrderJson(view) };
  });

  app.get("/sales/v1/quotes/:id", async (request) => {
    const principal = await channel(request, "other");
    const id = (request.params as { id?: unknown }).id;
    if (typeof id !== "string" || !quoteIdSchema.test(id)) throw new AppError(404, "NOT_FOUND", "报价不存在");
    return { quote: quoteJson(await getSalesQuote(ctx, principal, id)) };
  });
}
