/**
 * 官网的行程报价接口（M9T-03，ADR 0100 第三节）：
 * - `POST /site/v1/trips`：校验标准行程单、存为 draft，返回编号（每个地址每分钟 10 次，`site_trip`）；
 * - `GET /site/v1/trips/{id}`：行程单和最近一次报价的方案（过期的方案标 `expired`）；凭编号访问，过期、不存在、格式不对同一个 404（占 `site_read`）；
 * - `POST /site/v1/trips/{id}/quote`：编排 + 分段报价 + 跨段费用 + 方案对比（每个地址每分钟 5 次、每天 50 次，两个都放行才报；不和 `site_quote` 共用）。
 * 请求体用 ADR 0100 第二节的标准行程单（camelCase）；应答字段是 snake_case，金额同官网询价（`{ amount, currency }`，主单位十进制字符串）。
 * 对客应答没有结算价、加价比例、供应商编号。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { type CurrencyCode, type LocalizedText, TRIP_ITEM_KINDS, TRIP_LIMITS, TRIP_PLACE_KINDS, type TripItinerary } from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { siteAudienceOf } from "../services/qa-acceptance.ts";
import { salesMoney } from "../services/sales-quotes.ts";
import { takeSiteSlot } from "../services/site.ts";
import { type TripView, createTrip, getTrip, quoteTrip } from "../services/trips.ts";
import { parseInput, uuidSchema } from "../validation.ts";

type Json = Record<string, unknown>;

const latLng = { lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) };
const placeSchema = z.union([z.object({ placeId: uuidSchema }).strict(), z.object({ ...latLng, kind: z.enum(TRIP_PLACE_KINDS).optional() }).strict()]);
const itemSchema = z
  .object({
    kind: z.enum(TRIP_ITEM_KINDS),
    place: placeSchema,
    time: z.string().regex(/^\d{2}:\d{2}$/, "写成 HH:MM").optional(),
    stayMinutes: z.number().int().min(0).max(TRIP_LIMITS.maxStayMinutes).optional(),
  })
  .strict();
const daySchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "写成 YYYY-MM-DD"),
    items: z.array(itemSchema).max(TRIP_LIMITS.maxItemsPerDay),
    nightAt: z.object(latLng).strict().nullable().optional(),
    driverLodgingProvided: z.boolean().optional(),
  })
  .strict();

/** 标准行程单（P1 子集）：不收自由文字、航班号、备注、司机语言 */
export const tripItinerarySchema = z
  .object({
    schemaVersion: z.literal(1),
    party: z.object({ adults: z.number().int().min(0).max(TRIP_LIMITS.maxPassengers), children: z.number().int().min(0).max(TRIP_LIMITS.maxPassengers).default(0), luggage: z.number().int().min(0).max(TRIP_LIMITS.maxLuggage).default(0) }).strict(),
    preferences: z
      .object({
        vehicleGroupIds: z.array(uuidSchema).max(TRIP_LIMITS.maxVehicleGroupIds).default([]),
        addons: z.array(z.object({ addonId: uuidSchema, quantity: z.number().int().min(1).max(TRIP_LIMITS.maxAddonQuantity).default(1) }).strict()).max(TRIP_LIMITS.maxAddons).default([]),
      })
      .strict()
      .default({ vehicleGroupIds: [], addons: [] }),
    days: z.array(daySchema).min(1).max(TRIP_LIMITS.maxDays),
  })
  .strict();

const name = (names: ReadonlyMap<string, LocalizedText>, id: string | null): LocalizedText | null => (id === null ? null : (names.get(id) ?? null));

/** 行程单和方案的对外视图（POST 报价和 GET 同一份） */
export function tripJson(view: TripView, now: Date): Json {
  const { trip } = view;
  const currency = trip.currency as CurrencyCode;
  const money = (minor: number): Json => salesMoney(minor, currency);
  const quoted = view.plans.filter((plan) => plan.status === "quoted");
  const expiresAt = quoted.reduce<Date | null>((min, plan) => (plan.expiresAt !== null && (min === null || plan.expiresAt < min) ? plan.expiresAt : min), null);
  const groupNames = new Map([...view.vehicleGroups].map(([id, group]) => [id, group.name]));
  return {
    trip_id: trip.id,
    status: trip.status,
    currency,
    readable_until: trip.readableUntil.toISOString(),
    itinerary: trip.itinerary,
    quoted_at: view.plans[0]?.quotedAt.toISOString() ?? null,
    expires_at: expiresAt?.toISOString() ?? null,
    plans: quoted.map((plan) => {
      const dayIndexes = [...new Set([...plan.segments.map((segment) => segment.dayIndex), ...plan.fees.flatMap((fee) => (fee.dayIndex === null ? [] : [fee.dayIndex]))])].sort((a, b) => a - b);
      const group = plan.vehicleGroupId === null ? null : view.vehicleGroups.get(plan.vehicleGroupId);
      return {
        plan_id: plan.id,
        kind: plan.kind,
        recommended: plan.recommended,
        status: plan.status,
        // 报价有效期 30 分钟（同官网询价）；过了要重新报价才能下单（P1b）
        expired: plan.expiresAt === null || plan.expiresAt.getTime() <= now.getTime(),
        total: money(plan.sellMinor as number),
        vehicle_group: group === undefined || group === null ? null : { id: group.id, code: group.code, name: group.name, seats: group.seats },
        days: dayIndexes.map((dayIndex) => ({
          day_index: dayIndex,
          date: (trip.itinerary.days[dayIndex] as TripItinerary["days"][number]).date,
          segments: plan.segments
            .filter((segment) => segment.dayIndex === dayIndex)
            .map((segment) => ({
              segment_id: segment.id,
              type: segment.segmentType,
              start_local: segment.startLocal,
              end_local: segment.endLocal,
              amount: segment.sellMinor === null ? null : money(segment.sellMinor),
              package_hours: segment.packageHours,
              other_vehicle: segment.otherVehicle,
              vehicle_group: segment.vehicleGroupId === null ? null : { id: segment.vehicleGroupId, name: name(groupNames, segment.vehicleGroupId) },
              price_breakdown: (segment.breakdown?.sell ?? []).map((item) => ({ kind: item.kind, amount: money(item.amountMinor), area_name: name(view.areaNames, item.areaId), stop_seqs: item.stopSeqs ?? null, ...(item.fromDropoff === true ? { from_dropoff: true } : {}) })),
              route: segment.route === null ? null : { meters: segment.route.meters, minutes: segment.route.minutes },
            })),
          fees: plan.fees.filter((fee) => fee.dayIndex === dayIndex).map((fee) => ({ type: fee.feeType, label: fee.label, amount: money(fee.sellMinor) })),
        })),
        // 按晚算的（住宿、住宿抵扣）不挂在某一天
        fees: plan.fees.filter((fee) => fee.dayIndex === null).map((fee) => ({ type: fee.feeType, label: fee.label, night_index: fee.nightIndex, amount: money(fee.sellMinor) })),
        warnings: plan.warnings.filter((warning) => warning.code !== "DEGRADED"),
      };
    }),
    unquoted: view.plans.flatMap((plan) => plan.unquoted.map((entry) => ({ plan_kind: plan.kind, day_index: entry.day_index, reason: entry.reason }))),
    degraded: view.degraded,
  };
}

export function registerSiteTripRoutes(app: FastifyInstance, ctx: AppContext): void {
  const audience = (request: FastifyRequest) => siteAudienceOf(ctx, request.headers.cookie);

  app.post("/site/v1/trips", { bodyLimit: 128 * 1024 }, async (request, reply) => {
    await takeSiteSlot(ctx, "site_trip", { ip: request.ip });
    const input = parseInput(tripItinerarySchema, request.body, "body") as TripItinerary;
    const trip = await createTrip(ctx, input, await audience(request));
    return reply.code(201).send({ trip_id: trip.id, status: trip.status, currency: trip.currency, readable_until: trip.readableUntil.toISOString() });
  });

  app.get("/site/v1/trips/:id", async (request) => {
    await takeSiteSlot(ctx, "site_read", { ip: request.ip });
    const { id } = request.params as { id: string };
    return tripJson(await getTrip(ctx, id, await audience(request)), ctx.now());
  });

  app.post("/site/v1/trips/:id/quote", async (request) => {
    // 一个限频键只有一个时间窗：每分钟、每天各一个键，两个都放行才报
    await takeSiteSlot(ctx, "site_trip_quote", { ip: request.ip });
    await takeSiteSlot(ctx, "site_trip_quote_day", { ip: request.ip });
    const { id } = request.params as { id: string };
    const view = await quoteTrip(ctx, id, { audience: await audience(request), ip: request.ip, log: request.log });
    return tripJson(view, ctx.now());
  });
}
