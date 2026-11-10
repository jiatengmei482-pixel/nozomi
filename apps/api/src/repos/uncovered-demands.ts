/**
 * 「未覆盖需求」的数据访问（M8-20，ADR 0075 第四部分；迁移 0290）。三张都是平台表，只在平台事务里调用；租户角色没有任何权限。
 */
import type { LatLng, LocalizedText, ServiceCategory, TripDirection, UncoveredDemandReason } from "@nozomi/domain";
import type { Db } from "../db/context.ts";
import { type Page, type TimeCursor, toPage } from "../pagination.ts";

type Row = Record<string, any>;

export interface DemandOperatingRef {
  tenantId: string;
  areaId: string;
}

/** 要记的一条（去重前） */
export interface DemandDraft {
  seenOn: string;
  channelKind: "site" | "sales";
  channelId: string;
  category: ServiceCategory;
  direction: TripDirection | null;
  packageHours: number | null;
  cityId: string | null;
  airportId: string | null;
  pickup: LatLng | null;
  dropoff: LatLng | null;
  pickupName: string | null;
  dropoffName: string | null;
  serviceLocal: string;
  serviceDate: string;
  passengers: number;
  luggage: number;
  vehicleGroupId: string | null;
  pickupOperating: DemandOperatingRef[];
  dropoffOperating: DemandOperatingRef[];
  tenantIds: string[];
  reason: UncoveredDemandReason;
  refusalCounts: Record<string, number>;
  fingerprint: string;
}

export interface UncoveredDemand extends Omit<DemandDraft, "seenOn" | "fingerprint"> {
  id: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  repeatCount: number;
}

const refs = (value: DemandOperatingRef[]): string => JSON.stringify(value.map((ref) => ({ tenant_id: ref.tenantId, area_id: ref.areaId })));
const fromRefs = (value: unknown): DemandOperatingRef[] => (value as { tenant_id: string; area_id: string }[]).map((ref) => ({ tenantId: ref.tenant_id, areaId: ref.area_id }));
const point = (lat: unknown, lng: unknown): LatLng | null => (lat === null ? null : { lat: Number(lat), lng: Number(lng) });

/** 同一天同一个指纹已经有一行：次数加一、更新最近出现的时间。有这一行返回 true（不占新增行的额度）。 */
export async function repeatDemand(db: Db, fingerprint: string, seenOn: string, now: Date): Promise<boolean> {
  const result = await db.query("update uncovered_demands set repeat_count = repeat_count + 1, last_seen_at = greatest(last_seen_at, $3) where fingerprint = $1 and seen_on = $2", [fingerprint, seenOn, now]);
  return (result.rowCount ?? 0) > 0;
}

/** 新增一行；并发时同一天同一个指纹已经被别人插进去了，就累加它的次数。 */
export async function insertDemand(db: Db, draft: DemandDraft, now: Date): Promise<void> {
  await db.query(
    `insert into uncovered_demands (first_seen_at, last_seen_at, repeat_count, seen_on, channel_kind, channel_id, category, direction, package_hours, city_id, airport_id,
                                    pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, pickup_name, dropoff_name, service_local, service_date, passengers, luggage, vehicle_group_id,
                                    pickup_operating, dropoff_operating, tenant_ids, reason, refusal_counts, fingerprint)
     values ($1, $1, 1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21::jsonb, $22::jsonb, $23::uuid[], $24, $25::jsonb, $26)
     on conflict (fingerprint, seen_on) do update set repeat_count = uncovered_demands.repeat_count + 1, last_seen_at = greatest(uncovered_demands.last_seen_at, excluded.last_seen_at)`,
    [
      now, draft.seenOn, draft.channelKind, draft.channelId, draft.category, draft.direction, draft.packageHours, draft.cityId, draft.airportId,
      draft.pickup?.lat ?? null, draft.pickup?.lng ?? null, draft.dropoff?.lat ?? null, draft.dropoff?.lng ?? null, draft.pickupName, draft.dropoffName,
      draft.serviceLocal, draft.serviceDate, draft.passengers, draft.luggage, draft.vehicleGroupId,
      refs(draft.pickupOperating), refs(draft.dropoffOperating), draft.tenantIds, draft.reason, JSON.stringify(draft.refusalCounts), draft.fingerprint,
    ],
  );
}

/** 新增行的固定时间窗计数：占一次额度，返回这一次放不放行（同 sales_rate_limits 的做法，「先占用再判断」一条 SQL 原子完成）。 */
export async function takeDemandSlot(db: Db, bucket: string, max: number, windowMs: number, now: Date): Promise<boolean> {
  const result = await db.query<{ attempt_count: number }>(
    `insert into uncovered_demand_limits (bucket, window_started_at, attempt_count) values ($1, $2, 1)
     on conflict (bucket) do update set
       attempt_count = case when uncovered_demand_limits.window_started_at <= $2::timestamptz - make_interval(secs => $3::double precision / 1000) then 1 else uncovered_demand_limits.attempt_count + 1 end,
       window_started_at = case when uncovered_demand_limits.window_started_at <= $2::timestamptz - make_interval(secs => $3::double precision / 1000) then $2 else uncovered_demand_limits.window_started_at end
     returning attempt_count`,
    [bucket, now, windowMs],
  );
  return (result.rows[0]?.attempt_count ?? Infinity) <= max;
}

/** 这一天因为限流没记下来的新需求加一 */
export async function countDroppedDemand(db: Db, day: string): Promise<void> {
  await db.query("insert into uncovered_demand_drops (day, dropped) values ($1, 1) on conflict (day) do update set dropped = uncovered_demand_drops.dropped + 1", [day]);
}

/** 保留期清理：最近一次出现早于分界的行、早于分界的「被限掉」计数、1 天以前的限流窗口。返回删掉的需求行数。 */
export async function purgeUncoveredDemands(db: Db, cutoff: Date, cutoffDay: string, limitsBefore: Date): Promise<number> {
  const deleted = await db.query("delete from uncovered_demands where last_seen_at < $1", [cutoff]);
  await db.query("delete from uncovered_demand_drops where day < $1", [cutoffDay]);
  await db.query("delete from uncovered_demand_limits where window_started_at < $1", [limitsBefore]);
  return deleted.rowCount ?? 0;
}

// ---- 运营后台的列表、计数、地图上的点 ----

export interface DemandFilter {
  /** 最近一次出现在这个时间段里（含开始、不含结束） */
  from: Date;
  to: Date;
  cityId?: string | undefined;
  tenantId?: string | undefined;
  category?: ServiceCategory | undefined;
  reason?: UncoveredDemandReason | undefined;
}

function conditions(filter: DemandFilter): { sql: string; params: unknown[] } {
  const parts = ["d.last_seen_at >= $1", "d.last_seen_at < $2"];
  const params: unknown[] = [filter.from, filter.to];
  const add = (sql: string, value: unknown): void => {
    params.push(value);
    parts.push(sql.replace("?", `$${params.length}`));
  };
  if (filter.cityId !== undefined) add("d.city_id = ?", filter.cityId);
  if (filter.tenantId !== undefined) add("d.tenant_ids @> array[?::uuid]", filter.tenantId);
  if (filter.category !== undefined) add("d.category = ?", filter.category);
  if (filter.reason !== undefined) add("d.reason = ?", filter.reason);
  return { sql: parts.join(" and "), params };
}

const COLUMNS = `d.id, d.first_seen_at, d.last_seen_at, d.repeat_count, d.channel_kind, d.channel_id, d.category, d.direction, d.package_hours, d.city_id, d.airport_id,
  d.pickup_lat, d.pickup_lng, d.dropoff_lat, d.dropoff_lng, d.pickup_name, d.dropoff_name, d.service_local, d.service_date::text as service_date, d.passengers, d.luggage,
  d.vehicle_group_id, d.pickup_operating, d.dropoff_operating, d.tenant_ids, d.reason, d.refusal_counts`;

function toDemand(row: Row): UncoveredDemand {
  return {
    id: row["id"],
    firstSeenAt: row["first_seen_at"],
    lastSeenAt: row["last_seen_at"],
    repeatCount: row["repeat_count"],
    channelKind: row["channel_kind"],
    channelId: row["channel_id"],
    category: row["category"],
    direction: row["direction"],
    packageHours: row["package_hours"],
    cityId: row["city_id"],
    airportId: row["airport_id"],
    pickup: point(row["pickup_lat"], row["pickup_lng"]),
    dropoff: point(row["dropoff_lat"], row["dropoff_lng"]),
    pickupName: row["pickup_name"],
    dropoffName: row["dropoff_name"],
    serviceLocal: row["service_local"],
    serviceDate: row["service_date"],
    passengers: row["passengers"],
    luggage: row["luggage"],
    vehicleGroupId: row["vehicle_group_id"],
    pickupOperating: fromRefs(row["pickup_operating"]),
    dropoffOperating: fromRefs(row["dropoff_operating"]),
    tenantIds: row["tenant_ids"],
    reason: row["reason"],
    refusalCounts: row["refusal_counts"],
  };
}

/** 一页（按最近出现从新到旧，同一时刻按编号） */
export async function listDemands(db: Db, filter: DemandFilter, limit: number, after: TimeCursor | null): Promise<Page<UncoveredDemand>> {
  const where = conditions(filter);
  const params = [...where.params];
  let cursorSql = "";
  if (after !== null) {
    params.push(after.t, after.id);
    cursorSql = ` and (d.last_seen_at, d.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
  }
  params.push(limit + 1);
  const result = await db.query<Row & { cursor_time: string }>(
    `select ${COLUMNS}, d.last_seen_at::text as cursor_time from uncovered_demands d where ${where.sql}${cursorSql} order by d.last_seen_at desc, d.id desc limit $${params.length}`,
    params,
  );
  return toPage(result.rows, limit, toDemand, (row) => ({ t: row.cursor_time, id: row["id"] as string }));
}

export interface DemandSummary {
  rows: number;
  repeats: number;
  byReason: { reason: UncoveredDemandReason; rows: number; repeats: number }[];
  byCity: { cityId: string | null; rows: number; repeats: number }[];
  byTenant: { tenantId: string; rows: number; repeats: number }[];
  /** 这段时间里每天因为限流没记下来的新需求合计（按东京日期） */
  dropped: number;
}

/** 合计和按原因、城市、供应商的计数（同样的筛选） */
export async function summarizeDemands(db: Db, filter: DemandFilter, fromDay: string, toDay: string): Promise<DemandSummary> {
  const where = conditions(filter);
  const total = await db.query<{ rows: number; repeats: number }>(`select count(*)::int as rows, coalesce(sum(d.repeat_count), 0)::int as repeats from uncovered_demands d where ${where.sql}`, where.params);
  const byReason = await db.query<Row>(`select d.reason, count(*)::int as rows, sum(d.repeat_count)::int as repeats from uncovered_demands d where ${where.sql} group by d.reason order by rows desc, d.reason`, where.params);
  const byCity = await db.query<Row>(`select d.city_id, count(*)::int as rows, sum(d.repeat_count)::int as repeats from uncovered_demands d where ${where.sql} group by d.city_id order by rows desc, d.city_id nulls last limit 100`, where.params);
  const byTenant = await db.query<Row>(
    `select t.tenant_id, count(*)::int as rows, sum(d.repeat_count)::int as repeats
       from uncovered_demands d cross join lateral unnest(d.tenant_ids) as t(tenant_id)
      where ${where.sql} group by t.tenant_id order by rows desc, t.tenant_id limit 100`,
    where.params,
  );
  const dropped = await db.query<{ n: number }>("select coalesce(sum(dropped), 0)::int as n from uncovered_demand_drops where day between $1 and $2", [fromDay, toDay]);
  return {
    rows: total.rows[0]?.rows ?? 0,
    repeats: total.rows[0]?.repeats ?? 0,
    byReason: byReason.rows.map((row) => ({ reason: row["reason"], rows: row["rows"], repeats: row["repeats"] })),
    byCity: byCity.rows.map((row) => ({ cityId: row["city_id"], rows: row["rows"], repeats: row["repeats"] })),
    byTenant: byTenant.rows.map((row) => ({ tenantId: row["tenant_id"], rows: row["rows"], repeats: row["repeats"] })),
    dropped: dropped.rows[0]?.n ?? 0,
  };
}

export interface DemandPoint {
  id: string;
  category: ServiceCategory;
  reason: UncoveredDemandReason;
  repeatCount: number;
  pickup: LatLng | null;
  dropoff: LatLng | null;
}

/** 地图上的点（最近出现从新到旧），最多 `max` 条；多出来的不取，`truncated` 为真 */
export async function listDemandPoints(db: Db, filter: DemandFilter, max: number): Promise<{ items: DemandPoint[]; truncated: boolean }> {
  const where = conditions(filter);
  const result = await db.query<Row>(
    `select d.id, d.category, d.reason, d.repeat_count, d.pickup_lat, d.pickup_lng, d.dropoff_lat, d.dropoff_lng
       from uncovered_demands d where ${where.sql} order by d.last_seen_at desc, d.id desc limit $${where.params.length + 1}`,
    [...where.params, max + 1],
  );
  return {
    items: result.rows.slice(0, max).map((row) => ({ id: row["id"], category: row["category"], reason: row["reason"], repeatCount: row["repeat_count"], pickup: point(row["pickup_lat"], row["pickup_lng"]), dropoff: point(row["dropoff_lat"], row["dropoff_lng"]) })),
    truncated: result.rows.length > max,
  };
}

/** 列表里出现的供应商、城市的名字（页面显示用） */
export async function demandLabels(db: Db, tenantIds: readonly string[], cityIds: readonly string[]): Promise<{ tenants: Map<string, string>; cities: Map<string, LocalizedText> }> {
  const tenants = tenantIds.length === 0 ? { rows: [] as Row[] } : await db.query<Row>("select id, name from tenants where id = any($1::uuid[])", [tenantIds]);
  const cities = cityIds.length === 0 ? { rows: [] as Row[] } : await db.query<Row>("select id, name from cities where id = any($1::uuid[])", [cityIds]);
  return { tenants: new Map(tenants.rows.map((row) => [row["id"] as string, row["name"] as string])), cities: new Map(cities.rows.map((row) => [row["id"] as string, row["name"] as LocalizedText])) };
}

/** 机场的名称和坐标（接送机机场那一端记机场名） */
export async function findDemandAirport(db: Db, placeId: string): Promise<{ name: LocalizedText; location: LatLng } | null> {
  const result = await db.query<Row>("select name, lat, lng from places where id = $1", [placeId]);
  const row = result.rows[0];
  return row === undefined ? null : { name: row["name"], location: { lat: Number(row["lat"]), lng: Number(row["lng"]) } };
}
