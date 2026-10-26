/**
 * `/site/v1`：官网（自营渠道）的公开接口（M3-05，ADR 0032）。浏览器直接调，不需要登录、也不持有任何渠道密钥。
 * 这里只做限速、校验、调用、返回；渠道身份在服务端（`SITE_CLIENT_ID`），业务流程和 `/sales/v1` 是同一批 service。
 *
 * 接新单（官网暂未开放时 503 `SITE_NOT_OPEN`）：
 * - `GET /site/v1/config`：开没开、币种、Stripe 的 publishable key（只有它）；
 * - `GET /site/v1/cities`、`GET /site/v1/cities/{id}/airports`：能预订接送机的城市和机场；
 * - `POST /site/v1/quotes`：询价（每个地址每分钟 30 次）；
 * - `POST /site/v1/orders`：下单（`Idempotency-Key`，每个地址 10 分钟 10 次），应答里有查看链接的令牌（只这一次）。
 * 客人自己的订单（凭查看链接的令牌 `Authorization: Bearer nzo_…`；一个令牌只对应一张单，路径里没有订单编号）：
 * - `POST /site/v1/orders/lookup`：订单号 + 下单邮箱或手机号找回（每个地址 15 分钟 10 次；每个订单号每小时 10 次失败，对上的不受订单号额度限制）；
 * - `GET /site/v1/order`、`GET …/order/payment`、`GET …/order/cancel-fee`、`POST …/order/cancel`、`PATCH /site/v1/order`、
 *   `POST …/order/landed`（我已落地）、`POST …/order/extra-charges/{chargeId}/dispute`（对加收提异议）。
 * 订单的应答是 `{ order, timeline, names }`：`order` 是 `/sales/v1` 同一份 `salesOrderJson`（没有结算价、加价比例；付款前没有中标供应商），
 * 只去掉落地信息里司机到达屏照片的文件编号（客人用不上）。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { MESSAGING_APPS } from "@nozomi/domain";
import { bearerToken } from "../auth/token.ts";
import type { AppContext } from "../context.ts";
import { notFound } from "../services/errors.ts";
import { cancelForChannel, previewCancellation } from "../services/cancellations.ts";
import { disputeExtraCharge } from "../services/extra-charges.ts";
import { changeForChannel } from "../services/order-changes.ts";
import { type SalesOrderView, getSalesOrderView, orderPaymentForChannel, reportGuestLanding } from "../services/orders.ts";
import { type SiteLink, type SiteQuote, lookupSiteOrder, placeSiteOrder, resolveSiteLink, siteAirports, siteCities, siteConfig, siteOrderExtras, siteQuotes, takeSiteSlot } from "../services/site.ts";
import { salesMoney } from "../services/sales-quotes.ts";
import { idempotencyKey, ifMatchVersion, parseInput, resourceId, uuidSchema } from "../validation.ts";
import { changeSchema, disputeSchema, feeJson, salesCancelSchema, salesFeeQuerySchema, toChangeInput } from "./order-actions.ts";
import { paymentJson, salesOrderJson } from "./sales.ts";

type Json = Record<string, unknown>;

const quoteSchema = z
  .object({
    city_id: uuidSchema,
    airport_id: uuidSchema,
    direction: z.enum(["pickup", "dropoff"]),
    address: z.object({ lng: z.number().min(-180).max(180), lat: z.number().min(-90).max(90) }).strict(),
    service_local: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "写成当地时间 YYYY-MM-DDTHH:mm"),
    passengers: z.number().int().min(1).max(60),
    luggage: z.number().int().min(0).max(60).default(0),
  })
  .strict();

const text = (max: number) => z.string().max(max).nullable().default(null);
const orderSchema = z
  .object({
    quote_id: z.string().regex(/^QT\d{8}[0-9A-Z]{10}$/, "不是报价编号的格式"),
    passenger: z.object({ name: z.string().max(200), phone: z.string().max(40), email: z.string().max(320) }).strict(),
    flight_no: text(20),
    pickup_address: text(1_000),
    dropoff_address: text(1_000),
    messaging: z.object({ app: z.enum(MESSAGING_APPS), handle: z.string().max(200) }).strict().nullable().default(null),
    notes: text(2_000),
    // 客人勾选「同意保存支付方式，用于服务后加收」（第五轮决策 ⑤）；没勾不能下单
    save_payment_method: z.boolean(),
  })
  .strict();

const lookupSchema = z
  .object({
    order_no: z.string().trim().toUpperCase().regex(/^NZ\d{8}[0-9A-Z]{8}$/, "订单号是 NZ 开头的 18 位，如 NZ20261026AB12CD34"),
    contact: z.string().trim().min(3).max(320),
  })
  .strict();

function linkJson(link: SiteLink): Json {
  return { token: link.token, expires_at: link.expiresAt.toISOString() };
}

function quoteJson(quote: SiteQuote): Json {
  const group = quote.vehicleGroup;
  return {
    quote_id: quote.quoteId,
    expires_at: quote.expiresAt,
    service_date: quote.serviceDate,
    urgent: quote.urgent,
    vehicle_group: { id: group.id, code: group.code, name: group.name, grade: group.grade, seats: group.seats, sample_models: group.sampleModels, combos: group.combos },
    price: { total: salesMoney(quote.sellMinor, quote.currency), fx: quote.fx === null ? null : { rate: quote.fx.rate, as_of: quote.fx.asOf } },
    free_wait_minutes: quote.freeWaitMinutes,
    cancel_policy: { category: quote.cancelPolicy.category, level: quote.cancelPolicy.level, tiers: quote.cancelPolicy.tiers.map((tier) => ({ min_hours_before: tier.minHoursBefore, fee_bp: tier.feeBp })) },
  };
}

/** 渠道看到的那一份订单，落地信息去掉司机到达屏照片的文件编号（照片只给平台和供应商核对）。 */
function guestOrderJson(view: SalesOrderView, now: Date): Json {
  const order = salesOrderJson(view, now);
  const landing = order["landing"] as Json | null;
  if (landing === null) return order;
  const { driver_photo_file_id: _photo, ...guestLanding } = landing;
  return { ...order, landing: guestLanding };
}

/**
 * 客人看到的订单：`order` 就是渠道看到的那一份（没有结算价、加价比例，付款前没有中标供应商），
 * 另加状态时间线（不含操作人和派车细节）和城市、机场、车型组的名称。
 */
async function siteOrderJson(ctx: AppContext, view: SalesOrderView): Promise<Json> {
  const extras = await siteOrderExtras(ctx, view);
  return {
    order: guestOrderJson(view, ctx.now()),
    timeline: extras.events.map((event) => ({ from_status: event.fromStatus, to_status: event.toStatus, reason: event.reason, occurred_at: event.occurredAt.toISOString() })),
    names: { city: extras.names.city, place: extras.names.place, vehicle_group: extras.names.vehicleGroup },
  };
}

export function registerSiteRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** 凭查看链接：限速（按地址）后找到这一张单。 */
  const guest = async (request: FastifyRequest): Promise<{ orderId: string; channelId: string }> => {
    await takeSiteSlot(ctx, "site_read", { ip: request.ip });
    return resolveSiteLink(ctx, bearerToken(request.headers.authorization));
  };
  const orderView = async (who: { orderId: string; channelId: string }): Promise<Json> => {
    const view = await getSalesOrderView(ctx, who.channelId, who.orderId);
    if (view === null) throw notFound("订单");
    return siteOrderJson(ctx, view);
  };

  app.get("/site/v1/config", async (request) => {
    await takeSiteSlot(ctx, "site_read", { ip: request.ip });
    const config = await siteConfig(ctx);
    return { open: config.open, currency: config.currency, payments: config.payments === null ? null : { provider: config.payments.provider, publishable_key: config.payments.publishableKey } };
  });

  app.get("/site/v1/cities", async (request) => {
    await takeSiteSlot(ctx, "site_read", { ip: request.ip });
    const cities = await siteCities(ctx);
    return { items: cities.map((city) => ({ id: city.id, code: city.code, name: city.name, timezone: city.timezone, country_code: city.countryCode })) };
  });

  app.get("/site/v1/cities/:id/airports", async (request) => {
    await takeSiteSlot(ctx, "site_read", { ip: request.ip });
    const airports = await siteAirports(ctx, resourceId(request.params, "城市"));
    return { items: airports.map((airport) => ({ id: airport.id, code: airport.code, name: airport.name, location: { lng: airport.lng, lat: airport.lat } })) };
  });

  app.post("/site/v1/quotes", async (request) => {
    await takeSiteSlot(ctx, "site_quote", { ip: request.ip });
    const input = parseInput(quoteSchema, request.body, "body");
    const result = await siteQuotes(ctx, { cityId: input.city_id, airportId: input.airport_id, direction: input.direction, address: input.address, serviceLocal: input.service_local, passengers: input.passengers, luggage: input.luggage });
    return { currency: result.currency, quotes: result.quotes.map(quoteJson), unavailable: result.unavailable.map((entry) => ({ vehicle_group_id: entry.vehicleGroupId, reasons: entry.reasons })) };
  });

  app.post("/site/v1/orders", async (request, reply) => {
    await takeSiteSlot(ctx, "site_order", { ip: request.ip });
    const key = idempotencyKey(request.headers["idempotency-key"]);
    const input = parseInput(orderSchema, request.body, "body");
    const created = await placeSiteOrder(
      ctx,
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
          channelOrderNo: null,
          savePaymentMethodConsent: input.save_payment_method,
        },
      },
      request.log,
    );
    if (created.replayed) reply.header("idempotent-replayed", "true");
    return reply.code(201).send({ ...(await siteOrderJson(ctx, created.view)), payment: created.payment === null ? null : paymentJson(created.payment), link: linkJson(created.link) });
  });

  app.post("/site/v1/orders/lookup", async (request) => {
    await takeSiteSlot(ctx, "site_lookup", { ip: request.ip });
    const input = parseInput(lookupSchema, request.body, "body");
    return { link: linkJson(await lookupSiteOrder(ctx, input.order_no, input.contact, request.log)) };
  });

  app.get("/site/v1/order", async (request) => orderView(await guest(request)));

  app.get("/site/v1/order/payment", async (request) => {
    const who = await guest(request);
    return { payment: paymentJson(await orderPaymentForChannel(ctx, who.channelId, who.orderId, request.log)) };
  });

  app.get("/site/v1/order/cancel-fee", async (request) => {
    const who = await guest(request);
    const query = parseInput(salesFeeQuerySchema, request.query, "querystring");
    return feeJson((await previewCancellation(ctx, { channelId: who.channelId }, who.orderId, query.reason, false)).quote, "sales");
  });

  app.post("/site/v1/order/cancel", async (request) => {
    const who = await guest(request);
    const input = parseInput(salesCancelSchema, request.body ?? {}, "body");
    const result = await cancelForChannel(ctx, who.channelId, who.orderId, input.reason, request.log);
    return { ...(await orderView(who)), replayed: result.kind === "cancelled" && result.replayed };
  });

  app.patch("/site/v1/order", async (request) => {
    const who = await guest(request);
    const version = ifMatchVersion(request.headers["if-match"]);
    const input = parseInput(changeSchema, request.body ?? {}, "body");
    const result = await changeForChannel(ctx, who.channelId, who.orderId, version, toChangeInput(input), request.log);
    const view = await orderView(who);
    return { ...view, change: ((view["order"] as Json)["changes"] as Json[]).find((change) => change["id"] === result.change.id) ?? null };
  });

  app.post("/site/v1/order/landed", async (request) => {
    const who = await guest(request);
    await reportGuestLanding(ctx, who.channelId, who.orderId);
    return orderView(who);
  });

  app.post("/site/v1/order/extra-charges/:chargeId/dispute", async (request) => {
    const who = await guest(request);
    const chargeId = resourceId({ id: (request.params as { chargeId?: unknown }).chargeId }, "加收");
    const input = parseInput(disputeSchema, request.body, "body");
    await disputeExtraCharge(ctx, who.channelId, who.orderId, chargeId, input.reason);
    const view = await orderView(who);
    return { ...view, extra_charge: ((view["order"] as Json)["extra_charges"] as Json[]).find((charge) => charge["id"] === chargeId) ?? null };
  });
}
