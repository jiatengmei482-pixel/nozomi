/**
 * `/sales/v1`：渠道调用的销售端接口（M2-04，ADR 0023）。这里只做鉴权、校验、调用、返回。
 *
 * - `POST /sales/v1/oauth/token`：OAuth 2.0 Client Credentials，换 2 小时的访问令牌（JSON 或表单都行）。
 * - `POST /sales/v1/quotes`：询价。渠道只来自令牌；只比渠道授权的租户、城市、品类；每个渠道每秒 50 次。
 * - `GET /sales/v1/quotes/{quote_id}`：下单前确认报价仍有效（过期 410 `QUOTE_EXPIRED`）；只查得到本渠道的。每个渠道每秒 10 次。
 * 应答里没有中标租户、结算价、加价比例。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { PRICE_LIMITS, QUOTE_RULES, SERVICE_CATEGORIES, TRIP_DIRECTIONS } from "@nozomi/domain";
import { bearerToken } from "../auth/token.ts";
import type { AppContext } from "../context.ts";
import { AppError } from "../errors.ts";
import { authenticateSales, issueSalesToken } from "../services/sales-auth.ts";
import { type SalesPoint, type SalesQuote, createSalesQuotes, getSalesQuote, salesMoney } from "../services/sales-quotes.ts";
import { dateTimeSchema, parseInput, uuidSchema } from "../validation.ts";

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

  app.get("/sales/v1/quotes/:id", async (request) => {
    const principal = await channel(request, "other");
    const id = (request.params as { id?: unknown }).id;
    if (typeof id !== "string" || !quoteIdSchema.test(id)) throw new AppError(404, "NOT_FOUND", "报价不存在");
    return { quote: quoteJson(await getSalesQuote(ctx, principal, id)) };
  });
}
