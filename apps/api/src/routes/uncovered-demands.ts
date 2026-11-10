/**
 * 运营后台「未覆盖需求」（M8-20，ADR 0075 第四部分第 5 节）：只读，`demand.read`（超级管理员、运营、招商、渠道经理）。
 * - `GET /platform/v1/uncovered-demands`：按城市、供应商、最近出现的日期范围（东京日期，默认最近 30 天）、品类、原因筛选；游标分页；
 *   带合计（行数、次数之和）和按原因、按城市、按供应商的计数，以及这段时间里因为限流没记下来的条数。
 * - `GET /platform/v1/uncovered-demands/points`：同样的筛选，给区域地图图层用的点（每条的上车、下车坐标、原因、次数），最多 2000 条。
 * 不认识的查询参数一律 400。里面没有任何客人个人信息；`/tenant/v1` 没有读它的接口。
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { SERVICE_CATEGORIES, UNCOVERED_DEMAND_REASONS, addDays } from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import type { DemandOperatingRef, UncoveredDemand } from "../repos/uncovered-demands.ts";
import { authenticatePlatform, platformCredentials } from "../services/platform-auth.ts";
import { type DemandQuery, listUncoveredDemands, uncoveredDemandPoints } from "../services/uncovered-demands.ts";
import { pageQuerySchema, parseInput, uuidSchema, validationFailed } from "../validation.ts";

type Json = Record<string, unknown>;

/** 日期范围最长一年（和保留期一样长） */
const MAX_RANGE_DAYS = 366;

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期写成 YYYY-MM-DD").refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value), "不是真实存在的日期");

const filterSchema = z.object({
  city_id: uuidSchema.optional(),
  tenant_id: uuidSchema.optional(),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  category: z.enum(SERVICE_CATEGORIES).optional(),
  reason: z.enum(UNCOVERED_DEMAND_REASONS).optional(),
});
const listQuerySchema = pageQuerySchema.merge(filterSchema).strict();
const pointsQuerySchema = filterSchema.strict();

function demandQuery(input: z.output<typeof filterSchema>): DemandQuery {
  const from = input.from ?? null;
  const to = input.to ?? null;
  if (from !== null && to !== null && (from > to || addDays(from, MAX_RANGE_DAYS) <= to)) {
    throw validationFailed("querystring", [{ path: "/from", reason: "OUT_OF_RANGE", message: `开始日期不能晚于结束日期，范围最长 ${MAX_RANGE_DAYS} 天` }]);
  }
  return { from, to, cityId: input.city_id?.toLowerCase(), tenantId: input.tenant_id?.toLowerCase(), category: input.category, reason: input.reason };
}

const refsJson = (refs: DemandOperatingRef[]): Json[] => refs.map((ref) => ({ tenant_id: ref.tenantId, area_id: ref.areaId }));
const pointJson = (point: { lat: number; lng: number } | null): Json | null => (point === null ? null : { lat: point.lat, lng: point.lng });

export function uncoveredDemandJson(item: UncoveredDemand): Json {
  return {
    id: item.id,
    first_seen_at: item.firstSeenAt.toISOString(),
    last_seen_at: item.lastSeenAt.toISOString(),
    repeat_count: item.repeatCount,
    channel_kind: item.channelKind,
    channel_id: item.channelId,
    category: item.category,
    direction: item.direction,
    package_hours: item.packageHours,
    city_id: item.cityId,
    airport_id: item.airportId,
    pickup: pointJson(item.pickup),
    dropoff: pointJson(item.dropoff),
    pickup_name: item.pickupName,
    dropoff_name: item.dropoffName,
    service_local: item.serviceLocal,
    service_date: item.serviceDate,
    passengers: item.passengers,
    luggage: item.luggage,
    vehicle_group_id: item.vehicleGroupId,
    pickup_operating: refsJson(item.pickupOperating),
    dropoff_operating: refsJson(item.dropoffOperating),
    tenant_ids: item.tenantIds,
    reason: item.reason,
    refusal_counts: item.refusalCounts,
  };
}

export function registerUncoveredDemandRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/platform/v1/uncovered-demands", async (request) => {
    await authenticatePlatform(ctx, platformCredentials(request), { action: "demand.read" });
    const query = parseInput(listQuerySchema, request.query, "querystring");
    const found = await listUncoveredDemands(ctx, demandQuery(query), query.limit, query.cursor ?? null);
    const { summary } = found;
    return {
      from: found.from,
      to: found.to,
      items: found.items.map(uncoveredDemandJson),
      next_cursor: found.nextCursor,
      summary: {
        rows: summary.rows,
        repeats: summary.repeats,
        dropped: summary.dropped,
        by_reason: summary.byReason.map((entry) => ({ reason: entry.reason, rows: entry.rows, repeats: entry.repeats })),
        by_city: summary.byCity.map((entry) => ({ city_id: entry.cityId, rows: entry.rows, repeats: entry.repeats })),
        by_tenant: summary.byTenant.map((entry) => ({ tenant_id: entry.tenantId, rows: entry.rows, repeats: entry.repeats })),
      },
      tenants: [...found.tenants].map(([id, name]) => ({ id, name })),
      cities: [...found.cities].map(([id, name]) => ({ id, name })),
    };
  });

  app.get("/platform/v1/uncovered-demands/points", async (request) => {
    await authenticatePlatform(ctx, platformCredentials(request), { action: "demand.read" });
    const query = parseInput(pointsQuerySchema, request.query, "querystring");
    const found = await uncoveredDemandPoints(ctx, demandQuery(query));
    return {
      from: found.from,
      to: found.to,
      items: found.items.map((item) => ({ id: item.id, category: item.category, reason: item.reason, repeat_count: item.repeatCount, pickup: pointJson(item.pickup), dropoff: pointJson(item.dropoff), service_local: item.serviceLocal, last_seen_at: item.lastSeenAt.toISOString() })),
      truncated: found.truncated,
    };
  });
}
