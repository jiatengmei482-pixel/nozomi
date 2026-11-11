/**
 * 官网（ADR 0032）的数据访问：官网用的 API 客户端和渠道、能预订的城市和机场、订单的查看链接、用订单号找回订单。
 * 全在平台事务里调用（官网是一个渠道，这些都是平台的数据）。
 */
import type { AddonChargeUnit, FlightScope, LocalizedText, ServiceCategory, TenantStatus } from "@nozomi/domain";
import type { PassengerContact } from "@nozomi/domain";
import type { Db } from "../db/context.ts";
import { type OrderVehicleGroupRef, findOrderVehicleGroup } from "./master-data.ts";

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

/**
 * 官网列城市、机场、包车套餐时看哪一种商品（M8-26，ADR 0078）：默认已上架；`qa_listed` 是验收会话，只看 QA 测试供应商的验收可售商品。
 * SQL 里是 `p.status = $listing and ($listing = 'published' or t.is_test_tenant)`：默认时就是原来的「已上架」。
 */
export type SiteListing = "published" | "qa_listed";

/** 启用的城市里有哪些供应商上架了哪些品类的商品（每个城市 × 品类 × 供应商一行）。 */
export async function listBookableCities(db: Db, listing: SiteListing = "published"): Promise<BookableCity[]> {
  const rows = await db.query<{ id: string; code: string; name: LocalizedText; timezone: string; country_code: string; center_lat: string; center_lng: string; category: ServiceCategory; tenant_id: string; tenant_status: TenantStatus }>(
    `select distinct c.id, c.code, c.name, c.timezone, c.country_code, c.center_lat, c.center_lng, p.category, p.tenant_id, t.status as tenant_status
       from cities c
       join products p on p.city_id = c.id and p.status = $1
       join tenants t on t.id = p.tenant_id and ($1 = 'published' or t.is_test_tenant)
      where c.status = 'active'
      order by c.code, p.category`,
    [listing],
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
export async function listBookableCharterPackages(db: Db, cityId: string, today: string, listing: SiteListing = "published"): Promise<BookableCharterPackage[]> {
  const rows = await db.query<{ hours: number; tenant_id: string; tenant_status: TenantStatus }>(
    `select distinct r.package_hours as hours, p.tenant_id, t.status as tenant_status
       from price_rules r
       join products p on p.tenant_id = r.tenant_id and p.id = r.product_id and p.status = $3 and p.category = 'charter' and p.city_id = $1
       join tenants t on t.id = p.tenant_id and ($3 = 'published' or t.is_test_tenant)
      where r.status = 'enabled' and r.pricing_model = 'charter_package' and (r.valid_to is null or r.valid_to >= $2::date)
      order by r.package_hours`,
    [cityId, today, listing],
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

/**
 * 按编码取一个启用的平台地点（新预订页的链接参数 `from=NRT`，M8-04；不调谷歌）。编码不分大小写；
 * 航站楼、出口按所属机场 / 车站的种类返回（页面靠种类认机场一端），坐标用它自己的；城市取它自己的或上级的。
 * `cityIds` 为 null 表示渠道不限城市。
 */
export async function findSitePlaceByCode(db: Db, code: string, cityIds: readonly string[] | null): Promise<SitePlaceRow | null> {
  const rows = await db.query<{ id: string; type: SitePlaceType; code: string; name: LocalizedText; address: string | null; lng: string; lat: string }>(
    `select pl.id, case when pl.type in ('terminal', 'exit') then parent.type else pl.type end as type, pl.code, pl.name, pl.address, pl.lng, pl.lat
       from places pl
       left join places parent on parent.id = pl.parent_id
       join cities c on c.id = coalesce(pl.city_id, parent.city_id) and c.status = 'active'
      where upper(pl.code) = upper($1) and pl.status = 'active'
        and (pl.parent_id is null or parent.status = 'active')
        and (case when pl.type in ('terminal', 'exit') then parent.type else pl.type end) = any($2::text[])
        and ($3::uuid[] is null or c.id = any($3::uuid[]))
      limit 1`,
    [code, SITE_PLACE_TYPES, cityIds],
  );
  const row = rows.rows[0];
  return row === undefined ? null : { id: row.id, type: row.type, code: row.code, name: row.name, address: row.address, lng: Number(row.lng), lat: Number(row.lat) };
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
export async function listBookableAirports(db: Db, cityId: string, listing: SiteListing = "published"): Promise<BookablePlace[]> {
  const rows = await db.query<{ id: string; code: string; name: LocalizedText; lng: string; lat: string; tenant_id: string; tenant_status: TenantStatus }>(
    `select distinct pl.id, pl.code, pl.name, pl.lng, pl.lat, p.tenant_id, t.status as tenant_status
       from places pl
       join products p on p.poi_id = pl.id and p.status = $2 and p.category = 'airport_transfer' and p.city_id = $1
       join tenants t on t.id = p.tenant_id and ($2 = 'published' or t.is_test_tenant)
      where pl.type = 'airport' and pl.status = 'active' and pl.city_id = $1
      order by pl.code`,
    [cityId, listing],
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
  vehicleGroup: OrderVehicleGroupRef | null;
}

export async function findOrderNames(db: Db, ids: { cityId: string; placeId: string | null; vehicleGroupId: string }): Promise<OrderNames> {
  const city = (await db.query<{ code: string; name: LocalizedText }>("select code, name from cities where id = $1", [ids.cityId])).rows[0] ?? null;
  const place = ids.placeId === null ? null : ((await db.query<{ code: string; name: LocalizedText; type: string }>("select code, name, type from places where id = $1", [ids.placeId])).rows[0] ?? null);
  return { city, place, vehicleGroup: await findOrderVehicleGroup(db, ids.vehicleGroupId) };
}

/** `lookup` 是 ADR 0061 之前「查订单直接打开」时发的，之后不再产生；查订单的链接走邮件（`email`）。 */
export async function insertSiteOrderLink(db: Db, link: { orderId: string; tokenHash: string; issuedVia: "order" | "email"; createdAt: Date; expiresAt: Date }): Promise<void> {
  await db.query("insert into site_order_links (order_id, token_hash, issued_via, created_at, expires_at) values ($1, $2, $3, $4, $5)", [link.orderId, link.tokenHash, link.issuedVia, link.createdAt, link.expiresAt]);
}

/**
 * 按令牌的哈希找链接：还在有效期里的才返回（订单编号和它的渠道）。
 * 有效期按订单**现在**的用车时间算（`service_at + afterServiceMs`，至少到发链接后 `minimumMs`），不看发链接时记下的 `expires_at`：
 * 改期以后链接跟着新的用车时间走，不用去改链接（ADR 0032）。脱敏后这单的链接全部作废（ADR 0055）。
 */
export async function findLiveSiteOrderLink(db: Db, tokenHash: string, now: Date, rules: { afterServiceMs: number; minimumMs: number }): Promise<{ orderId: string; channelId: string; expiresAt: Date } | null> {
  const row = (
    await db.query<{ order_id: string; channel_id: string; expires_at: Date }>(
      `select l.order_id, s.channel_id, x.expires_at
         from site_order_links l
         join order_sales s on s.order_id = l.order_id
         join orders o on o.id = l.order_id
         cross join lateral (select greatest(o.service_at + make_interval(secs => $3::double precision / 1000), l.created_at + make_interval(secs => $4::double precision / 1000)) as expires_at) x
        where l.token_hash = $1 and x.expires_at > $2 and o.passenger_anonymized_at is null`,
      [tokenHash, now, rules.afterServiceMs, rules.minimumMs],
    )
  ).rows[0];
  return row === undefined ? null : { orderId: row.order_id, channelId: row.channel_id, expiresAt: row.expires_at };
}

/**
 * 用订单号找这个渠道现在的那一行（救援改派后原供应商的行已转出，不算），带盲索引（核对用，ADR 0057）和用车时间（链接的有效期按它算）。
 * 这里不解密：能比盲索引的不用解开，对不上的单解不开也和不存在一样。
 */
export async function findChannelOrderByNo(db: Db, channelId: string, orderNo: string): Promise<{ orderId: string; tenantId: string; passengerEnc: string | null; passengerPlain: PassengerContact; emailBidx: string | null; phoneBidx: string | null; serviceAt: Date; anonymized: boolean } | null> {
  const row = (
    await db.query<{ id: string; tenant_id: string; passenger: PassengerContact; passenger_enc: string | null; passenger_email_bidx: string | null; passenger_phone_bidx: string | null; service_at: Date; passenger_anonymized_at: Date | null }>(
      "select o.id, o.tenant_id, o.passenger, o.passenger_enc, o.passenger_email_bidx, o.passenger_phone_bidx, o.service_at, o.passenger_anonymized_at from orders o join order_sales s on s.order_id = o.id where o.order_no = $1 and s.channel_id = $2 and o.status <> 'rescued'",
      [orderNo, channelId],
    )
  ).rows[0];
  return row === undefined ? null : { orderId: row.id, tenantId: row.tenant_id, passengerEnc: row.passenger_enc, passengerPlain: row.passenger, emailBidx: row.passenger_email_bidx, phoneBidx: row.passenger_phone_bidx, serviceAt: row.service_at, anonymized: row.passenger_anonymized_at !== null };
}

/** 官网能用的城市的基本信息（M8-02：不带城市的地址搜索、输入即提示、按两个坐标报价）。`ids` 为 null = 全部启用的城市。 */
export interface SiteCityInfo {
  id: string;
  code: string;
  name: LocalizedText;
  timezone: string;
  countryCode: string;
  center: { lat: number; lng: number };
}

export async function listActiveCities(db: Db, ids: readonly string[] | null): Promise<SiteCityInfo[]> {
  const rows = await db.query<{ id: string; code: string; name: LocalizedText; timezone: string; country_code: string; center_lat: string; center_lng: string }>(
    `select id, code, name, timezone, country_code, center_lat, center_lng
       from cities
      where status = 'active' and ($1::uuid[] is null or id = any($1::uuid[]))
      order by code`,
    [ids],
  );
  return rows.rows.map((row) => ({ id: row.id, code: row.code, name: row.name, timezone: row.timezone, countryCode: row.country_code, center: { lat: Number(row.center_lat), lng: Number(row.center_lng) } }));
}

/** 地址搜索、输入即提示排在最前的平台地点（M8-02）：启用的机场、航站楼（所属机场也启用）、车站，所在城市启用并在 `cityIds` 里。最多这么多行。 */
export const SUGGESTION_PLACE_LIMIT = 5_000;

export interface SuggestionPlaceRow {
  id: string;
  type: "airport" | "terminal" | "station";
  code: string;
  name: LocalizedText;
  parentName: LocalizedText | null;
  lat: number;
  lng: number;
}

export async function listSuggestionPlaces(db: Db, cityIds: readonly string[]): Promise<SuggestionPlaceRow[]> {
  if (cityIds.length === 0) return [];
  const rows = await db.query<{ id: string; type: SuggestionPlaceRow["type"]; code: string; name: LocalizedText; parent_name: LocalizedText | null; lat: string; lng: string }>(
    `select pl.id, pl.type, pl.code, pl.name, parent.name as parent_name, pl.lat, pl.lng
       from places pl
       left join places parent on parent.id = pl.parent_id
       join cities c on c.id = coalesce(pl.city_id, parent.city_id) and c.status = 'active'
      where pl.status = 'active' and pl.type in ('airport', 'terminal', 'station')
        and (pl.type <> 'terminal' or parent.status = 'active')
        and c.id = any($1::uuid[])
      order by pl.code
      limit $2`,
    [cityIds, SUGGESTION_PLACE_LIMIT],
  );
  return rows.rows.map((row) => ({ id: row.id, type: row.type, code: row.code, name: row.name, parentName: row.parent_name, lat: Number(row.lat), lng: Number(row.lng) }));
}

/** 按两个坐标报价认机场用的候选（M8-02）：启用的机场，所在城市启用并在 `cityIds` 里，坐标在 `box` 里（先用外接矩形筛一遍）。 */
export interface AirportCandidateRow {
  id: string;
  code: string;
  name: LocalizedText;
  cityId: string;
  lat: number;
  lng: number;
  /** 国际 / 国内 / 都有；没标明为 null（M8-33：还没有报价时，客人页按它显示默认免费等待） */
  flightScope: FlightScope | null;
}

export async function listAirportsNear(db: Db, cityIds: readonly string[], boxes: readonly { low: { lat: number; lng: number }; high: { lat: number; lng: number } }[]): Promise<AirportCandidateRow[]> {
  if (cityIds.length === 0 || boxes.length === 0) return [];
  const rows = await db.query<{ id: string; code: string; name: LocalizedText; city_id: string; lat: string; lng: string; flight_scope: FlightScope | null }>(
    `select pl.id, pl.code, pl.name, pl.city_id, pl.lat, pl.lng, pl.flight_scope
       from places pl
       join cities c on c.id = pl.city_id and c.status = 'active'
       join jsonb_to_recordset($2::jsonb) as box(low_lat float8, low_lng float8, high_lat float8, high_lng float8)
         on pl.lat between box.low_lat and box.high_lat and pl.lng between box.low_lng and box.high_lng
      where pl.type = 'airport' and pl.status = 'active' and c.id = any($1::uuid[])`,
    [cityIds, JSON.stringify(boxes.map((box) => ({ low_lat: box.low.lat, low_lng: box.low.lng, high_lat: box.high.lat, high_lng: box.high.lng })))],
  );
  const seen = new Set<string>();
  return rows.rows.flatMap((row) => {
    if (seen.has(row.id)) return [];
    seen.add(row.id);
    return [{ id: row.id, code: row.code, name: row.name, cityId: row.city_id, lat: Number(row.lat), lng: Number(row.lng), flightScope: row.flight_scope }];
  });
}

/** 报价应答里「这个车型能加哪些附加服务」要的目录信息（M8-02，ADR 0069 B15）：编码、名称（各语言）、计费方式。没有任何单价。 */
export interface SiteAddonInfo {
  id: string;
  code: string;
  name: LocalizedText;
  chargeUnit: AddonChargeUnit;
}

export async function findAddons(db: Db, ids: readonly string[]): Promise<Map<string, SiteAddonInfo>> {
  if (ids.length === 0) return new Map();
  const rows = await db.query<{ id: string; code: string; name: LocalizedText; charge_unit: AddonChargeUnit }>("select id, code, name, charge_unit from addons where id = any($1::uuid[]) and status = 'active'", [ids]);
  return new Map(rows.rows.map((row) => [row.id, { id: row.id, code: row.code, name: row.name, chargeUnit: row.charge_unit }]));
}
