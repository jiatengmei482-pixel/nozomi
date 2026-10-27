/**
 * 官网（ADR 0032）的数据访问：官网用的 API 客户端和渠道、能预订的城市和机场、订单的查看链接、用订单号找回订单。
 * 全在平台事务里调用（官网是一个渠道，这些都是平台的数据）。
 */
import type { LocalizedText, ServiceCategory, TenantStatus } from "@nozomi/domain";
import type { Db } from "../db/context.ts";

export interface SiteClientRow {
  /** API 客户端的内部编号 */
  id: string;
  clientId: string;
  channelId: string;
  status: "active" | "revoked";
  channelStatus: "testing" | "active" | "paused";
  lastUsedAt: Date | null;
}

export async function findSiteClient(db: Db, clientId: string): Promise<SiteClientRow | null> {
  const row = (
    await db.query<{ id: string; client_id: string; channel_id: string; status: "active" | "revoked"; channel_status: "testing" | "active" | "paused"; last_used_at: Date | null }>(
      "select k.id, k.client_id, k.channel_id, k.status, c.status as channel_status, k.last_used_at from channel_api_clients k join channels c on c.id = k.channel_id where k.client_id = $1",
      [clientId],
    )
  ).rows[0];
  return row === undefined ? null : { id: row.id, clientId: row.client_id, channelId: row.channel_id, status: row.status, channelStatus: row.channel_status, lastUsedAt: row.last_used_at };
}

/** 一个有已上架商品的城市 / 机场，带上架它的供应商和供应商的状态（按渠道的授权范围过滤在调用方做）。 */
export interface BookableRow {
  tenantId: string;
  tenantStatus: TenantStatus;
}

export interface BookableCity extends BookableRow {
  id: string;
  code: string;
  name: LocalizedText;
  timezone: string;
  countryCode: string;
  /** 城市中心（地图打开时的位置，ADR 0044） */
  center: { lat: number; lng: number };
  category: ServiceCategory;
}

/** 启用的城市里有哪些供应商上架了哪些品类的商品（每个城市 × 品类 × 供应商一行）。 */
export async function listBookableCities(db: Db): Promise<BookableCity[]> {
  const rows = await db.query<{ id: string; code: string; name: LocalizedText; timezone: string; country_code: string; center_lat: string; center_lng: string; category: ServiceCategory; tenant_id: string; tenant_status: TenantStatus }>(
    `select distinct c.id, c.code, c.name, c.timezone, c.country_code, c.center_lat, c.center_lng, p.category, p.tenant_id, t.status as tenant_status
       from cities c
       join products p on p.city_id = c.id and p.status = 'published'
       join tenants t on t.id = p.tenant_id
      where c.status = 'active'
      order by c.code, p.category`,
  );
  return rows.rows.map((row) => ({ id: row.id, code: row.code, name: row.name, timezone: row.timezone, countryCode: row.country_code, center: { lat: Number(row.center_lat), lng: Number(row.center_lng) }, category: row.category, tenantId: row.tenant_id, tenantStatus: row.tenant_status }));
}

/** 地址搜索、反查用的城市信息（ADR 0044）：启用没有、国家、中心坐标。不存在为 null。 */
export async function findSiteCityCenter(db: Db, cityId: string): Promise<{ active: boolean; countryCode: string; center: { lat: number; lng: number } } | null> {
  const row = (await db.query<{ status: string; country_code: string; center_lat: string; center_lng: string }>("select status, country_code, center_lat, center_lng from cities where id = $1", [cityId])).rows[0];
  return row === undefined ? null : { active: row.status === "active", countryCode: row.country_code, center: { lat: Number(row.center_lat), lng: Number(row.center_lng) } };
}

/** 一个包车套餐时长，带报这个时长的供应商（按渠道的授权范围过滤在调用方做）。 */
export interface BookableCharterPackage extends BookableRow {
  hours: number;
}

/**
 * 这个城市里上架的包车商品有哪些套餐时长：启用的、到 `today`（城市当地日期）还没过期的价格规则里出现的（每个时长 × 供应商一行）。
 * 只用来给客人列可选的时长；某个时长那一天到底报不报得出价，询价时由报价引擎判断。
 */
export async function listBookableCharterPackages(db: Db, cityId: string, today: string): Promise<BookableCharterPackage[]> {
  const rows = await db.query<{ hours: number; tenant_id: string; tenant_status: TenantStatus }>(
    `select distinct r.package_hours as hours, p.tenant_id, t.status as tenant_status
       from price_rules r
       join products p on p.tenant_id = r.tenant_id and p.id = r.product_id and p.status = 'published' and p.category = 'charter' and p.city_id = $1
       join tenants t on t.id = p.tenant_id
      where r.status = 'enabled' and r.package_hours is not null and (r.valid_to is null or r.valid_to >= $2::date)
      order by r.package_hours`,
    [cityId, today],
  );
  return rows.rows.map((row) => ({ hours: row.hours, tenantId: row.tenant_id, tenantStatus: row.tenant_status }));
}

/** 地址输入辅助能列的地点种类：机场、车站、地标（航站楼、出口挂在上级下面，不单独列）。 */
export const SITE_PLACE_TYPES = ["airport", "station", "poi"] as const;
export type SitePlaceType = (typeof SITE_PLACE_TYPES)[number];
/** 一个城市最多列多少个地点（主数据由平台维护，一个城市远到不了这么多；到了就只列前面的） */
export const SITE_PLACE_LIMIT = 500;

export interface SitePlaceRow {
  id: string;
  type: SitePlaceType;
  code: string;
  name: LocalizedText;
  address: string | null;
  lng: number;
  lat: number;
}

/** 这个城市里启用的机场、车站、地标（主数据，公开）。按种类、编码排。 */
export async function listCityPlaces(db: Db, cityId: string): Promise<SitePlaceRow[]> {
  const rows = await db.query<{ id: string; type: SitePlaceType; code: string; name: LocalizedText; address: string | null; lng: string; lat: string }>(
    `select pl.id, pl.type, pl.code, pl.name, pl.address, pl.lng, pl.lat
       from places pl
       join cities c on c.id = pl.city_id and c.status = 'active'
      where pl.city_id = $1 and pl.status = 'active' and pl.type = any($2::text[])
      order by array_position($2::text[], pl.type), pl.code
      limit $3`,
    [cityId, SITE_PLACE_TYPES, SITE_PLACE_LIMIT],
  );
  return rows.rows.map((row) => ({ id: row.id, type: row.type, code: row.code, name: row.name, address: row.address, lng: Number(row.lng), lat: Number(row.lat) }));
}

/** 包车报价用的价格规则里的套餐公里数（按报价编号）。 */
export async function findQuotePackageKm(db: Db, quoteIds: readonly string[]): Promise<Map<string, number>> {
  if (quoteIds.length === 0) return new Map();
  const rows = await db.query<{ id: string; package_km: number | null }>(
    `select q.id, (r.params->>'packageKm')::int as package_km
       from quotes q
       join price_rules r on r.tenant_id = q.winner_tenant_id and r.id = (q.snapshot->'winner'->'offer'->>'priceRuleId')::uuid
      where q.id = any($1::text[]) and r.pricing_model = 'charter_package'`,
    [quoteIds],
  );
  return new Map(rows.rows.flatMap((row) => (row.package_km === null ? [] : [[row.id, row.package_km] as const])));
}

export interface BookablePlace extends BookableRow {
  id: string;
  code: string;
  name: LocalizedText;
  lng: number;
  lat: number;
}

/** 这个城市里启用的机场，有哪些供应商上架了接送机商品（每个机场 × 供应商一行）。 */
export async function listBookableAirports(db: Db, cityId: string): Promise<BookablePlace[]> {
  const rows = await db.query<{ id: string; code: string; name: LocalizedText; lng: string; lat: string; tenant_id: string; tenant_status: TenantStatus }>(
    `select distinct pl.id, pl.code, pl.name, pl.lng, pl.lat, p.tenant_id, t.status as tenant_status
       from places pl
       join products p on p.poi_id = pl.id and p.status = 'published' and p.category = 'airport_transfer' and p.city_id = $1
       join tenants t on t.id = p.tenant_id
      where pl.type = 'airport' and pl.status = 'active' and pl.city_id = $1
      order by pl.code`,
    [cityId],
  );
  return rows.rows.map((row) => ({ id: row.id, code: row.code, name: row.name, lng: Number(row.lng), lat: Number(row.lat), tenantId: row.tenant_id, tenantStatus: row.tenant_status }));
}

export interface SiteVehicleGroup {
  id: string;
  code: string;
  name: LocalizedText;
  grade: string;
  seats: number;
  sampleModels: string[];
  combos: { passengers: number; luggage: number }[];
}

export async function findVehicleGroups(db: Db, ids: readonly string[]): Promise<Map<string, SiteVehicleGroup>> {
  if (ids.length === 0) return new Map();
  const rows = await db.query<{ id: string; code: string; name: LocalizedText; grade: string; seats: number; sample_models: string[]; combos: { passengers: number; luggage: number }[] }>(
    "select id, code, name, grade, seats, sample_models, combos from vehicle_groups where id = any($1::uuid[])",
    [ids],
  );
  return new Map(rows.rows.map((row) => [row.id, { id: row.id, code: row.code, name: row.name, grade: row.grade, seats: row.seats, sampleModels: row.sample_models, combos: row.combos }]));
}

/** 订单页上要显示的名称：城市、机场（或车站）、车型组。 */
export interface OrderNames {
  city: { code: string; name: LocalizedText } | null;
  place: { code: string; name: LocalizedText; type: string } | null;
  vehicleGroup: { code: string; name: LocalizedText; seats: number } | null;
}

export async function findOrderNames(db: Db, ids: { cityId: string; placeId: string | null; vehicleGroupId: string }): Promise<OrderNames> {
  const city = (await db.query<{ code: string; name: LocalizedText }>("select code, name from cities where id = $1", [ids.cityId])).rows[0] ?? null;
  const place = ids.placeId === null ? null : ((await db.query<{ code: string; name: LocalizedText; type: string }>("select code, name, type from places where id = $1", [ids.placeId])).rows[0] ?? null);
  const group = (await db.query<{ code: string; name: LocalizedText; seats: number }>("select code, name, seats from vehicle_groups where id = $1", [ids.vehicleGroupId])).rows[0] ?? null;
  return { city, place, vehicleGroup: group };
}

export async function insertSiteOrderLink(db: Db, link: { orderId: string; tokenHash: string; issuedVia: "order" | "lookup"; createdAt: Date; expiresAt: Date }): Promise<void> {
  await db.query("insert into site_order_links (order_id, token_hash, issued_via, created_at, expires_at) values ($1, $2, $3, $4, $5)", [link.orderId, link.tokenHash, link.issuedVia, link.createdAt, link.expiresAt]);
}

/**
 * 按令牌的哈希找链接：还在有效期里的才返回（订单编号和它的渠道）。
 * 有效期按订单**现在**的用车时间算（`service_at + afterServiceMs`，至少到发链接后 `minimumMs`），不看发链接时记下的 `expires_at`：
 * 改期以后链接跟着新的用车时间走，不用去改链接（ADR 0032）。
 */
export async function findLiveSiteOrderLink(db: Db, tokenHash: string, now: Date, rules: { afterServiceMs: number; minimumMs: number }): Promise<{ orderId: string; channelId: string; expiresAt: Date } | null> {
  const row = (
    await db.query<{ order_id: string; channel_id: string; expires_at: Date }>(
      `select l.order_id, s.channel_id, x.expires_at
         from site_order_links l
         join order_sales s on s.order_id = l.order_id
         join orders o on o.id = l.order_id
         cross join lateral (select greatest(o.service_at + make_interval(secs => $3::double precision / 1000), l.created_at + make_interval(secs => $4::double precision / 1000)) as expires_at) x
        where l.token_hash = $1 and x.expires_at > $2`,
      [tokenHash, now, rules.afterServiceMs, rules.minimumMs],
    )
  ).rows[0];
  return row === undefined ? null : { orderId: row.order_id, channelId: row.channel_id, expiresAt: row.expires_at };
}

/** 用订单号找这个渠道的一张单，带下单时的联系方式（核对用）和用车时间（链接的有效期按它算）。 */
export async function findChannelOrderByNo(db: Db, channelId: string, orderNo: string): Promise<{ orderId: string; email: string; phone: string; serviceAt: Date } | null> {
  const row = (
    await db.query<{ id: string; passenger: { email: string; phone: string }; service_at: Date }>(
      "select o.id, o.passenger, o.service_at from orders o join order_sales s on s.order_id = o.id where o.order_no = $1 and s.channel_id = $2",
      [orderNo, channelId],
    )
  ).rows[0];
  return row === undefined ? null : { orderId: row.id, email: row.passenger.email, phone: row.passenger.phone, serviceAt: row.service_at };
}

/** 这个订单号（哈希）在 `since` 之后各次找回失败的时间。 */
export async function listLookupFailures(db: Db, bucket: string, since: Date): Promise<Date[]> {
  const rows = await db.query<{ failed_at: Date }>("select failed_at from site_lookup_failures where bucket = $1 and failed_at > $2 order by failed_at", [bucket, since]);
  return rows.rows.map((row) => row.failed_at);
}

/** 记一次找回失败；顺手删掉所有超过窗口的旧记录（它们已经不影响任何判断）。 */
export async function insertLookupFailure(db: Db, bucket: string, failedAt: Date, expiredBefore: Date): Promise<void> {
  await db.query("delete from site_lookup_failures where failed_at <= $1", [expiredBefore]);
  await db.query("insert into site_lookup_failures (bucket, failed_at) values ($1, $2)", [bucket, failedAt]);
}
