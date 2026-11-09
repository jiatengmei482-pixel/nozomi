/**
 * 官网（自营渠道）的业务流程（M3-05，ADR 0032）。
 *
 * 官网是一个普通的渠道：服务端以配置里指定的 API 客户端（`SITE_CLIENT_ID`）的身份，调用和 `/sales/v1` **同一批** service——
 * 询价 `createSalesQuotes`、下单 `createSiteOrder`、查单 `getSalesOrderView`，取消、改单、落地、异议各自的 service 在路由里直接调。
 * 这里只多做三件 `/sales/v1` 没有的事：
 * 1. 认出官网的渠道（没配置、客户端吊销、渠道暂停 → 暂未开放；已经下了的单照样能看能操作）；
 * 2. 客人的查看链接：下单时发一个令牌，库里只存 SHA-256；凭令牌只能看这一张单。链接丢了在「查订单」填订单号 + 下单邮箱，
 *    对上了由通知中心把一条新链接发到下单邮箱（ADR 0061），页面不管对没对上都说同一句话；
 * 3. 按来源地址限速（计数单独一个事务先提交：后面失败了这一次照样算数）。
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  type AirportMatch,
  type LatLng,
  type LocalizedText,
  type PlaceKind,
  type PointsTripType,
  type ServiceCategory,
  type TripEnd,
  type VehicleGrade,
  cancellationRuleFor,
  channelScopeRefusal,
  channelSellsTenant,
  cityBounds,
  classifyPointsTrip,
  cleanPlaceText,
  type CurrencyCode,
  fxQuoteFromTable,
  inAnyCity,
  instantToLocal,
  localDateTimeExists,
  localDateTimeToInstant,
  inBounds,
  platformPlaceDisplayName,
  platformPlaceSuggestions,
  rateLimitKeyOf,
  regionBounds,
  serviceCityOf,
  tenantBids,
  vehicleLevel,
  type PassengerContact,
  contactLookupKey,
  normalizeEmailForIndex,
  normalizePhoneForIndex,
  viewLinkThrottleSteps,
} from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { pendingHeldFetches } from "../repos/fx.ts";
import { type PassengerCrypto, isPassengerDecryptFailure } from "../integrations/passenger-crypto.ts";
import { passengerCryptoOfPool, withPlatformTx } from "../db/context.ts";
import { AppError } from "../errors.ts";
import { currentCancellationPolicy } from "../repos/cancellation-policies.ts";
import { type Channel, findChannel } from "../repos/channels.ts";
import { enqueueNotification } from "../repos/notifications.ts";
import { listOrderEvents } from "../repos/orders.ts";
import { findQuoteCity, findQuotePlace } from "../repos/quotes.ts";
import {
  type BookableRow,
  type OrderNames,
  type SiteVehicleGroup,
  findChannelOrderByNo,
  findSiteCityCenter,
  findLiveSiteOrderLink,
  findOrderNames,
  findSiteClient,
  type SitePlaceType,
  findQuotePackageKm,
  findVehicleGroups,
  insertSiteOrderLink,
  listBookableAirports,
  listBookableCharterPackages,
  listBookableCities,
  listCityPlaces,
  findSitePlaceByCode,
  type AirportCandidateRow,
  type SiteCityInfo,
  listActiveCities,
  listAirportsNear,
  listSuggestionPlaces,
  type SiteAddonInfo,
  findAddons,
} from "../repos/site.ts";
import type { RoutePreview } from "./route-estimates.ts";
import type { RouteMapRequest, RouteMapResult } from "./static-maps.ts";
import { validationFailed } from "../validation.ts";
import { notFound } from "./errors.ts";
import { type SalesOrderInput, type SalesOrderPayment, type SalesOrderView, type OrderLog, SILENT_ORDER_LOG, createSiteOrder } from "./orders.ts";
import { inBackground } from "./background.ts";
import { type SalesRateScope, rateLimited, takeRateSlot } from "./rate-limit.ts";
import { lastUsedIsStale } from "./sales-auth.ts";
import type { SalesPrincipal } from "./sales-auth.ts";
import { type SalesQuote, type SalesUnavailableReason, createSalesQuotes } from "./sales-quotes.ts";

/** 官网卖的品类：接送机（M3-05）、点对点和包车（M3-10，ADR 0035）。和需求的三种品类一致；渠道没授权的品类照样不卖。 */
export const SITE_CATEGORIES: readonly ServiceCategory[] = ["airport_transfer", "point_to_point", "charter"];

export const SITE_LINK_RULES = {
  /** 查看链接在用车时间之后还能用多久：30 天（覆盖加收的提交期和异议期、投诉期） */
  afterServiceMs: 30 * 24 * 3_600_000,
  /** 至少能用多久（用车时间早已过去的单找回时）：1 天 */
  minimumMs: 24 * 3_600_000,
} as const;

const LINK_PREFIX = "nzo_";
const LINK_FORMAT = /^nzo_[A-Za-z0-9_-]{43}$/;

export function siteNotOpen(): AppError {
  return new AppError(503, "SITE_NOT_OPEN", "官网暂未开放预订，请稍后再来");
}

function linkInvalid(): AppError {
  return new AppError(401, "ORDER_LINK_INVALID", "订单链接无效或已过期，请在「查订单」填订单号和下单邮箱，我们会把新链接发到下单邮箱");
}

function orderLinkEmailUnavailable(): AppError {
  return new AppError(503, "ORDER_LINK_EMAIL_UNAVAILABLE", "暂时发不了邮件，请联系客服找回订单");
}

const hashToken = (token: string): string => createHash("sha256").update(token, "utf8").digest("hex");
/** 来源地址、订单号、邮箱不进限流表原文（和登录限速一样只存哈希）。 */
const bucketOf = (kind: "ip" | "order" | "email", value: string): string => createHash("sha256").update(`site-${kind}:${value}`, "utf8").digest("hex");

/** 占用一次官网的限流额度；超限 429。计数单独一个事务先提交，后面出错回滚时这一次照样算数。 */
export async function takeSiteSlot(ctx: AppContext, scope: Extract<SalesRateScope, `site_${string}`>, key: { ip: string }): Promise<void> {
  // 来源地址按限流键计（IPv6 按 /64，ADR 0045）
  const decision = await withPlatformTx(ctx.pool, (db) => takeRateSlot(db, bucketOf("ip", rateLimitKeyOf(key.ip)), scope, ctx.now()));
  if (!decision.allowed) throw rateLimited(decision.retryAfterSeconds);
}

export interface SiteChannel {
  principal: SalesPrincipal;
  channel: Channel;
  /** 能不能接新单：客户端在用、渠道没暂停 */
  open: boolean;
}

/** 官网的渠道。没配置 `SITE_CLIENT_ID`、客户端不存在时为 null。 */
async function loadSiteChannel(ctx: AppContext): Promise<SiteChannel | null> {
  const site = ctx.config.site;
  if (site === null) return null;
  return withPlatformTx(ctx.pool, async (db) => {
    const client = await findSiteClient(db, site.clientId);
    if (client === null) return null;
    const channel = await findChannel(db, client.channelId);
    if (channel === null) return null;
    const open = client.status === "active" && client.channelStatus !== "paused";
    // 「最近使用」和渠道调用同一个口径（ADR 0023 补充）：按分钟节流，只在接单的时候记
    if (open && lastUsedIsStale(client.lastUsedAt, ctx.now())) {
      await db.query("update channel_api_clients set last_used_at = $2 where id = $1 and (last_used_at is null or last_used_at <= $3)", [client.id, ctx.now(), new Date(ctx.now().getTime() - 60_000)]);
    }
    return { principal: { apiClientId: client.id, clientId: client.clientId, channelId: client.channelId }, channel, open };
  });
}

/** 接新单（询价、下单、城市和机场列表）要求官网开着；否则 503。 */
export async function requireOpenSite(ctx: AppContext): Promise<SiteChannel> {
  const site = await loadSiteChannel(ctx);
  if (site === null || !site.open) throw siteNotOpen();
  return site;
}

/**
 * 官网路线小地图（M8-10，ADR 0072）：官网开着才出图（没开不花钱调谷歌），出不了图的原因见 domain 的 `routeMapReason`。
 * 只读路线、只出图，不碰报价。
 */
export async function siteRouteMap(ctx: AppContext, request: RouteMapRequest): Promise<RouteMapResult> {
  const site = await loadSiteChannel(ctx);
  if (site === null || !site.open) return { ok: false, reason: "UNAVAILABLE", failure: { stage: "map", code: "SITE_NOT_OPEN" } };
  return ctx.routeMap.render(request);
}

/** 订单相关的接口只要求配置了官网的客户端：停止接单不能让客人连自己的订单都看不到。 */
async function requireSiteChannelId(ctx: AppContext): Promise<string> {
  const site = await loadSiteChannel(ctx);
  if (site === null) throw siteNotOpen();
  return site.principal.channelId;
}

export interface SiteConfig {
  open: boolean;
  currency: string | null;
  /** Stripe 配置了才有：前端只拿 publishable key */
  payments: { provider: "stripe"; publishableKey: string } | null;
  /** 页面要不要显示地址搜索（ADR 0044）：官网开着、谷歌密钥配置了、每日上限不是 0。到了上限、谷歌出错时照样是 true，搜的时候再说暂时用不了 */
  addressSearch: boolean;
}

export async function siteConfig(ctx: AppContext): Promise<SiteConfig> {
  const site = await loadSiteChannel(ctx);
  const open = site !== null && site.open;
  return { open, currency: open ? site.channel.settleCurrency : null, payments: open && ctx.payments !== null ? { provider: "stripe", publishableKey: ctx.payments.publishableKey } : null, addressSearch: open && ctx.places.enabled };
}

/** 渠道卖不卖这个供应商（授权范围、供应商在不在比价的状态）。 */
function sells(channel: Channel, row: BookableRow): boolean {
  return tenantBids(row.tenantStatus) && channelSellsTenant(channel.scope, row.tenantId);
}

export interface SiteCity {
  id: string;
  code: string;
  name: LocalizedText;
  timezone: string;
  countryCode: string;
  /** 城市中心：官网的地图打开时先看这里（ADR 0044） */
  center: { lat: number; lng: number };
  /** 这个城市能在官网预订的品类（按 `SITE_CATEGORIES` 的顺序） */
  categories: ServiceCategory[];
}

/** 能预订的城市和各自能订的品类：城市启用、城市和品类在渠道授权里、有渠道卖的供应商上架了这个品类的商品。 */
export async function siteCities(ctx: AppContext): Promise<SiteCity[]> {
  const { channel } = await requireOpenSite(ctx);
  const rows = await withPlatformTx(ctx.pool, (db) => listBookableCities(db), { snapshot: true });
  const cities = new Map<string, SiteCity>();
  for (const row of rows) {
    if (!SITE_CATEGORIES.includes(row.category) || !sells(channel, row) || channelScopeRefusal(channel.scope, row.id, row.category) !== null) continue;
    const city = cities.get(row.id) ?? { id: row.id, code: row.code, name: row.name, timezone: row.timezone, countryCode: row.countryCode, center: row.center, categories: [] };
    if (!city.categories.includes(row.category)) city.categories.push(row.category);
    cities.set(row.id, city);
  }
  return [...cities.values()].map((city) => ({ ...city, categories: SITE_CATEGORIES.filter((category) => city.categories.includes(category)) }));
}

export interface SiteAirport {
  id: string;
  code: string;
  name: LocalizedText;
  lng: number;
  lat: number;
}

export async function siteAirports(ctx: AppContext, cityId: string): Promise<SiteAirport[]> {
  const { channel } = await requireOpenSite(ctx);
  if (channelScopeRefusal(channel.scope, cityId, "airport_transfer") !== null) return [];
  const rows = await withPlatformTx(ctx.pool, (db) => listBookableAirports(db, cityId), { snapshot: true });
  const airports = new Map<string, SiteAirport>();
  for (const row of rows) {
    if (airports.has(row.id) || !sells(channel, row)) continue;
    airports.set(row.id, { id: row.id, code: row.code, name: row.name, lng: row.lng, lat: row.lat });
  }
  return [...airports.values()];
}

/**
 * 这个城市能选的包车套餐时长（小时，从短到长）：渠道卖的供应商上架的包车商品里、启用且到城市当地今天还没过期的价格规则的时长。
 * 城市或包车不在渠道授权里时为空。某个时长那一天到底报不报得出价，询价时再看。
 */
export async function siteCharterPackages(ctx: AppContext, cityId: string): Promise<number[]> {
  const { channel } = await requireOpenSite(ctx);
  if (channelScopeRefusal(channel.scope, cityId, "charter") !== null) return [];
  return withPlatformTx(
    ctx.pool,
    async (db) => {
      const city = await findQuoteCity(db, cityId);
      if (city === null || !city.active) return [];
      const rows = await listBookableCharterPackages(db, cityId, instantToLocal(ctx.now(), city.timezone).date);
      return [...new Set(rows.filter((row) => sells(channel, row)).map((row) => row.hours))].sort((a, b) => a - b);
    },
    { snapshot: true },
  );
}

export interface SitePlace {
  id: string;
  type: SitePlaceType;
  code: string;
  name: LocalizedText;
  address: string | null;
  lng: number;
  lat: number;
}

/**
 * 地址输入辅助：这个城市里启用的机场、车站、地标（平台维护的主数据，不调用任何外部地图服务）。
 * 客人选一个，页面把名称和坐标填进地址那一栏；也可以照旧自己写地址和坐标。渠道没授权的城市为空列表（和城市列表一致）。
 */
export async function sitePlaces(ctx: AppContext, cityId: string): Promise<SitePlace[]> {
  const { channel } = await requireOpenSite(ctx);
  // 和城市列表同一个口径：渠道没授权的城市不列它的地点
  if (channel.scope.cityIds !== null && !channel.scope.cityIds.includes(cityId)) return [];
  const rows = await withPlatformTx(ctx.pool, (db) => listCityPlaces(db, cityId), { snapshot: true });
  return rows.map((row) => ({ id: row.id, type: row.type, code: row.code, name: row.name, address: row.address, lng: row.lng, lat: row.lat }));
}

/** 按编码取一个平台地点（M8-04，新预订页链接参数）：只在渠道授权的城市里找启用的；找不到 404。不调谷歌。 */
export async function sitePlaceByCode(ctx: AppContext, code: string): Promise<SitePlace> {
  const { channel } = await requireOpenSite(ctx);
  const row = await withPlatformTx(ctx.pool, (db) => findSitePlaceByCode(db, code, channel.scope.cityIds), { snapshot: true });
  if (row === null) throw notFound("地点");
  return { id: row.id, type: row.type, code: row.code, name: row.name, address: row.address, lng: row.lng, lat: row.lat };
}

/**
 * 地址搜索、反查要的城市（ADR 0044）：官网开着、城市在渠道授权里、启用。否则 400 `UNKNOWN_CITY`（和询价同一种说法）。
 * 授权检查和常用地点同一个口径（只看城市，不看品类）。
 */
async function sitePlaceCity(ctx: AppContext, cityId: string): Promise<{ countryCode: string; center: LatLng }> {
  const { channel } = await requireOpenSite(ctx);
  const unknown = (): AppError => validationFailed("querystring", [{ path: "/city_id", reason: "UNKNOWN_CITY", message: "城市不存在或暂不开放" }]);
  if (channel.scope.cityIds !== null && !channel.scope.cityIds.includes(cityId)) throw unknown();
  const city = await withPlatformTx(ctx.pool, (db) => findSiteCityCenter(db, cityId));
  if (city === null || !city.active) throw unknown();
  return city;
}

/** 地址搜索、输入即提示的一个候选：平台主数据的机场、车站（排在前面）或谷歌给的地点。 */
export interface SitePlaceItem {
  source: "platform" | "google";
  /** 平台地点的编号，或谷歌的地点 ID */
  id: string;
  name: string;
  /** 地址；平台的机场、车站和谷歌没给地址的为空字符串 */
  address: string;
  /** 输入即提示里谷歌的候选还没有坐标（选中后用 `GET /site/v1/places/details` 取），为 null */
  location: LatLng | null;
  kind: PlaceKind;
}

export interface SitePlaceSearchResult {
  /** false：谷歌这次用不了（没配置、到了每日上限、谷歌出错），`items` 只有平台的地点；页面退回常用地点、地图点选和手填 */
  available: boolean;
  items: SitePlaceItem[];
}

/** 官网的授权范围（M8-02）：渠道授权的、启用的城市，和它们的缓存键标识（城市编号排序后的哈希）。 */
interface SiteRegion {
  cities: SiteCityInfo[];
  /** 城市所在的国家（去重、排序） */
  countries: string[];
  /** 缓存键里的范围标识：授权的城市变了，缓存不串 */
  scope: string;
}

async function siteRegion(ctx: AppContext): Promise<SiteRegion> {
  const { channel } = await requireOpenSite(ctx);
  const cities = await withPlatformTx(ctx.pool, (db) => listActiveCities(db, channel.scope.cityIds), { snapshot: true });
  const countries = [...new Set(cities.map((city) => city.countryCode))].sort();
  const scope = createHash("sha256").update(cities.map((city) => city.id).sort().join(","), "utf8").digest("hex").slice(0, 16);
  return { cities, countries, scope };
}

/** 平台地点给客人看的名称最多几个字（航站楼连着机场名，比谷歌的名称长一些） */
const PLATFORM_NAME_MAX_LENGTH = 240;

/** 平台的机场、航站楼、车站里名字匹配关键字的（最多 5 个），给地址搜索、输入即提示排在最前（不依赖谷歌也能搜到机场）。 */
async function platformSuggestions(ctx: AppContext, cityIds: readonly string[], query: string): Promise<SitePlaceItem[]> {
  const rows = await withPlatformTx(ctx.pool, (db) => listSuggestionPlaces(db, cityIds), { snapshot: true });
  return platformPlaceSuggestions(rows, query).map((row) => ({
    source: "platform",
    id: row.id,
    name: cleanPlaceText(platformPlaceDisplayName(row), PLATFORM_NAME_MAX_LENGTH) ?? row.code,
    address: "",
    location: { lat: row.lat, lng: row.lng },
    kind: row.type === "station" ? "other" : "airport",
  }));
}

/**
 * 按关键字搜地点（关键字已规范化、长短合格）：平台的机场、车站在前，谷歌的结果在后。谷歌出问题不报错，`available: false`、只有平台的地点。
 * 带城市：城市附近（ADR 0044）；不带城市（M8-02）：渠道授权的几个城市的范围里，授权的只有一个国家时按它做 `regionCode`。
 */
export async function siteSearchPlaces(ctx: AppContext, cityId: string | null, query: string): Promise<SitePlaceSearchResult> {
  const google = (found: { ok: true; value: { id: string; name: string; address: string; location: LatLng; kind: PlaceKind }[] } | { ok: false }): SitePlaceItem[] =>
    found.ok ? found.value.map((item) => ({ source: "google", id: item.id, name: item.name, address: item.address, location: item.location, kind: item.kind })) : [];
  if (cityId !== null) {
    const city = await sitePlaceCity(ctx, cityId);
    const platform = await platformSuggestions(ctx, [cityId], query);
    const found = await ctx.places.search({ cityId, query, bounds: cityBounds(city.center), regionCode: city.countryCode });
    return { available: found.ok, items: [...platform, ...google(found)] };
  }
  const region = await siteRegion(ctx);
  const platform = await platformSuggestions(ctx, region.cities.map((city) => city.id), query);
  const centers = region.cities.map((city) => city.center);
  const bounds = regionBounds(centers);
  if (bounds === null) return { available: ctx.places.enabled, items: platform };
  const found = await ctx.places.search({ cityId: `region-${region.scope}`, query, bounds, regionCode: region.countries.length === 1 ? (region.countries[0] as string) : null, accept: (location) => inAnyCity(location, centers) });
  return { available: found.ok, items: [...platform, ...google(found)] };
}

/**
 * 输入即提示（M8-02，ADR 0069 B1）：平台的机场、车站在前（带坐标），谷歌的候选在后（还没有坐标，选中后取）。
 * 谷歌只给渠道授权的国家、授权城市合起来的范围里的。谷歌出问题不报错，`available: false`、只有平台的地点。
 */
export async function siteAutocomplete(ctx: AppContext, query: string, sessionToken: string): Promise<SitePlaceSearchResult> {
  const region = await siteRegion(ctx);
  const platform = await platformSuggestions(ctx, region.cities.map((city) => city.id), query);
  const bounds = regionBounds(region.cities.map((city) => city.center));
  if (bounds === null) return { available: ctx.places.enabled, items: platform };
  const found = await ctx.places.autocomplete({ scope: region.scope, query, sessionToken, regionCodes: region.countries, bounds });
  const google: SitePlaceItem[] = found.ok ? found.value.map((item) => ({ source: "google", id: item.id, name: item.name, address: item.address, location: null, kind: item.kind })) : [];
  return { available: found.ok, items: [...platform, ...google] };
}

export interface SitePlaceDetailsResult {
  available: boolean;
  /** 选中的谷歌地点的坐标、地址、类型；谷歌用不了时为 null */
  place: { id: string; address: string; location: LatLng; kind: PlaceKind } | null;
}

/** 输入即提示选中的谷歌地点的坐标和类型（同一个会话令牌，谷歌按一次会话计费）。官网要开着；谷歌出问题不报错，`available: false`。 */
export async function sitePlaceDetails(ctx: AppContext, placeId: string, sessionToken: string | null): Promise<SitePlaceDetailsResult> {
  await requireOpenSite(ctx);
  const found = await ctx.places.details({ placeId, sessionToken });
  return found.ok ? { available: true, place: found.value } : { available: false, place: null };
}

export interface SiteReverseResult {
  available: boolean;
  /** 这个位置的地址；查不到（海上、山里）为 null */
  address: string | null;
}

/** 查地图上一个位置的地址。坐标离城市太远 400 `OUT_OF_CITY`（这个代理只为在这个城市用车服务）。谷歌出问题不报错，`available: false`。 */
export async function siteReversePlace(ctx: AppContext, cityId: string, point: LatLng): Promise<SiteReverseResult> {
  const city = await sitePlaceCity(ctx, cityId);
  if (!inBounds(point, cityBounds(city.center))) throw validationFailed("querystring", [{ path: "/lat", reason: "OUT_OF_CITY", message: "这个位置离城市太远，请在城市附近选点" }]);
  const found = await ctx.places.reverse({ point, regionCode: city.countryCode });
  return found.ok ? { available: true, address: found.value } : { available: false, address: null };
}

type Point = { lng: number; lat: number };

/** 官网询价的行程：三种品类各自要的东西。 */
export type SiteTrip =
  /** 接送机：机场、方向（pickup 接机 = 机场 → 地址；dropoff 送机 = 地址 → 机场）、地址那一端的坐标 */
  | { category: "airport_transfer"; airportId: string; direction: "pickup" | "dropoff"; address: Point }
  /** 点对点：上车点、下车点的坐标 */
  | { category: "point_to_point"; pickup: Point; dropoff: Point }
  /** 包车：上车点、下车点的坐标、套餐时长（小时）。下车点暂时可以不给（ADR 0073，M8-13 改为必填）：不给时只报没设区域加价的商品 */
  | { category: "charter"; pickup: Point; dropoff: Point | null; packageHours: number };

export interface SiteQuoteInput {
  cityId: string;
  trip: SiteTrip;
  /** 城市当地的用车时间 `YYYY-MM-DDTHH:mm` */
  serviceLocal: string;
  passengers: number;
  luggage: number;
  /** 客人选的附加服务和数量（M8-02，ADR 0069 B15）：照原样交给报价引擎，没提供的商品不报（`ADDON_NOT_OFFERED`） */
  addons: { addonId: string; quantity: number }[];
}

export interface SiteCancelPolicy {
  category: ServiceCategory;
  level: string;
  tiers: { minHoursBefore: number; feeBp: number }[];
}

export interface SiteQuote extends SalesQuote {
  vehicleGroup: SiteVehicleGroup;
  /** 包车：套餐含多少公里（超出的服务后按实际加收）；其他品类 null */
  packageKm: number | null;
  /** 按现在的平台取消政策：这个车型组下单后适用的阶梯（下单时抄进订单） */
  cancelPolicy: SiteCancelPolicy;
  /** 这个车型还能加哪些附加服务（参加比价的供应商里有人提供的；只有目录信息，不带任何单价，M8-02） */
  availableAddons: SiteAddonInfo[];
}

export interface SiteQuoteResult {
  currency: string;
  quotes: SiteQuote[];
  unavailable: { vehicleGroupId: string | null; reasons: SalesUnavailableReason[] }[];
}

/** 询价请求里给渠道询价用的那几项（各品类的起终点、方向、套餐），和询价日志里记的原始请求。 */
function salesTrip(input: SiteQuoteInput): { category: ServiceCategory; placeId: string | null; direction: "pickup" | "dropoff" | null; pickup: Point | null; dropoff: Point | null; packageHours: number | null; request: Record<string, unknown> } {
  const { trip } = input;
  const common = { source: "site", category: trip.category, city_id: input.cityId, service_local: input.serviceLocal, passengers: input.passengers, luggage: input.luggage, addons: input.addons.map((addon) => ({ addon_id: addon.addonId, quantity: addon.quantity })) };
  switch (trip.category) {
    case "airport_transfer":
      return {
        category: trip.category,
        placeId: trip.airportId,
        direction: trip.direction,
        pickup: trip.direction === "dropoff" ? trip.address : null,
        dropoff: trip.direction === "pickup" ? trip.address : null,
        packageHours: null,
        request: { ...common, airport_id: trip.airportId, direction: trip.direction, address: trip.address },
      };
    case "point_to_point":
      return { category: trip.category, placeId: null, direction: null, pickup: trip.pickup, dropoff: trip.dropoff, packageHours: null, request: { ...common, pickup: trip.pickup, dropoff: trip.dropoff } };
    case "charter":
      return { category: trip.category, placeId: null, direction: null, pickup: trip.pickup, dropoff: trip.dropoff, packageHours: trip.packageHours, request: { ...common, pickup: trip.pickup, ...(trip.dropoff === null ? {} : { dropoff: trip.dropoff }), package_hours: trip.packageHours } };
  }
}

/**
 * 官网询价：城市（接送机还有机场）核对过、当地时间换成时刻后，走渠道询价（同一个 `createSalesQuotes`），再补上车型组的名称、取消阶梯和包车的套餐公里。
 * `logExtra` 是询价日志的原始请求里多记的几项（按两个坐标报价记 `mode` 和识别结果，M8-02）；不影响报价。
 */
export async function siteQuotes(ctx: AppContext, input: SiteQuoteInput, logExtra: Record<string, unknown> = {}): Promise<SiteQuoteResult> {
  const { principal, channel } = await requireOpenSite(ctx);
  const { trip } = input;
  const city = await withPlatformTx(ctx.pool, async (db) => {
    const found = await findQuoteCity(db, input.cityId);
    if (found === null || !found.active) throw validationFailed("body", [{ path: "/city_id", reason: "UNKNOWN_CITY", message: "城市不存在或暂不开放" }]);
    if (trip.category === "airport_transfer") {
      const airport = await findQuotePlace(db, trip.airportId);
      if (airport === null || airport.type !== "airport" || airport.cityId !== found.id || !airport.active) throw validationFailed("body", [{ path: "/airport_id", reason: "UNKNOWN_PLACE", message: "机场不存在、已停用，或者不在这个城市" }]);
    }
    return found;
  }, { snapshot: true });
  // 客人填的是当地钟面：夏令时跳过的时间不存在，直接拒绝（不按顺延后的时间报价，ADR 0032「不存在的当地时间 400」）
  const serviceTime = localDateTimeExists(input.serviceLocal, city.timezone) ? localDateTimeToInstant(input.serviceLocal, city.timezone) : null;
  if (serviceTime === null) throw validationFailed("body", [{ path: "/service_local", reason: "INVALID_FORMAT", message: "用车时间写成当地的 YYYY-MM-DDTHH:mm，并且是这个城市里存在的时间" }]);
  const sales = salesTrip(input);
  const result = await createSalesQuotes(
    ctx,
    principal,
    {
      cityId: input.cityId,
      category: sales.category,
      placeId: sales.placeId,
      direction: sales.direction,
      pickup: sales.pickup,
      dropoff: sales.dropoff,
      serviceTime,
      packageHours: sales.packageHours,
      passengers: input.passengers,
      luggage: input.luggage,
      addons: input.addons,
      driverLanguage: null,
      vehicleGroupIds: [],
      currency: channel.settleCurrency,
    },
    { request: { ...sales.request, ...logExtra } },
  );
  const { groups, policy, packageKm, addons } = await withPlatformTx(
    ctx.pool,
    async (db) => ({
      groups: await findVehicleGroups(db, result.quotes.map((quote) => quote.vehicleGroupId)),
      addons: await findAddons(db, [...new Set(result.quotes.flatMap((quote) => quote.offeredAddonIds ?? []))]),
      policy: await currentCancellationPolicy(db),
      packageKm: trip.category === "charter" ? await findQuotePackageKm(db, result.quotes.map((quote) => quote.quoteId)) : new Map<string, number>(),
    }),
    { snapshot: true },
  );
  const quotes = result.quotes.flatMap((quote): SiteQuote[] => {
    const group = groups.get(quote.vehicleGroupId);
    if (group === undefined) return [];
    const level = vehicleLevel(group.grade as VehicleGrade, group.seats);
    const rule = cancellationRuleFor(policy.rules, sales.category, level);
    const availableAddons = (quote.offeredAddonIds ?? []).flatMap((id) => addons.get(id) ?? []);
    return [{ ...quote, vehicleGroup: group, packageKm: packageKm.get(quote.quoteId) ?? null, cancelPolicy: { category: sales.category, level, tiers: rule.tiers.map((tier) => ({ minHoursBefore: tier.minHoursBefore, feeBp: tier.feeBp })) }, availableAddons }];
  });
  // 价低的在前：客人先看到最便宜的
  quotes.sort((a, b) => a.sellMinor - b.sellMinor || a.vehicleGroup.seats - b.vehicleGroup.seats);
  return { currency: channel.settleCurrency, quotes, unavailable: result.unavailable };
}

/** 按两个坐标报价的一端（M8-02，ADR 0069 A1）：坐标和地址搜索给的类型（手填、地图选点的为 null）。名称只用来校验，不进日志。 */
export interface SiteByPointsInput {
  pickup: TripEnd;
  dropoff: TripEnd;
  /** 当地的用车时间 `YYYY-MM-DDTHH:mm`（接机是航班落地时间） */
  serviceLocal: string;
  passengers: number;
  luggage: number;
  addons: { addonId: string; quantity: number }[];
}

export interface SiteByPointsResult extends SiteQuoteResult {
  tripType: PointsTripType;
  /** 识别到的机场（接机是出发地那一端，送机是目的地那一端）；点对点为 null */
  airport: { id: string; code: string; name: LocalizedText; matchedBy: "distance" | "kind"; meters: number } | null;
  /** 按哪个城市报的价；点对点的出发地不在任何能订的城市范围里时为 null（`unavailable` 是 `OUT_OF_SERVICE_AREA`） */
  city: { id: string; code: string; name: LocalizedText; timezone: string } | null;
  /** 最早到期的报价的有效期；没有报价为 null */
  expiresAt: string | null;
  /** 出发地到目的地的行车时间、距离、路线折线（谷歌 Routes，ADR 0069 B11）；取不到为 null，不影响报价 */
  route: RoutePreview | null;
}

/** 按两个坐标报价时认机场用的范围：每一端周围这么远（公里）以内的机场先从库里取出来，再按 3 / 10 公里的规则认 */
const AIRPORT_LOOKUP_KM = 15;

/** 给客人看的路线最多等多久（毫秒）：和报价并行，不拖慢报价太多；超时、出错都当作取不到 */
const ROUTE_PREVIEW_TIMEOUT_MS = 2_000;

async function routePreviewOrNull(ctx: AppContext, from: LatLng, to: LatLng): Promise<RoutePreview | null> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), ROUTE_PREVIEW_TIMEOUT_MS);
      timer.unref();
    });
    const found = await Promise.race([ctx.routePreview.preview({ from, to }).then((lookup) => (lookup.ok ? lookup.route : null)), timeout]);
    return found;
  } catch {
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** 一端的识别结果（询价日志里记，ADR 0069 A1「询价日志多记识别结果」）：类型、认到的机场、距离、怎么认的。不记名称和坐标以外的东西。 */
function endLog(end: TripEnd, match: AirportMatch<AirportCandidateRow> | null): Record<string, unknown> {
  return { lat: end.lat, lng: end.lng, kind: end.kind, airport_id: match?.airport.id ?? null, meters: match?.meters ?? null, matched_by: match?.matchedBy ?? null };
}

/**
 * 按两个坐标报价（M8-02，ADR 0069 A1）：认出机场（渠道授权、能卖接送机的城市里启用的机场；3 公里以内，或地址搜索说是机场时 10 公里以内，取最近）、
 * 判断接机 / 送机 / 点对点，点对点按出发地选城市，然后组装成现有的询价请求、走 `siteQuotes`（和 `POST /site/v1/quotes` 同一条路：价格规则、区域、比价、快照、日志都不变）。
 * 路线（时间、距离、折线）和报价并行取，取不到为 null。
 */
export async function siteQuotesByPoints(ctx: AppContext, input: SiteByPointsInput): Promise<SiteByPointsResult> {
  const { channel } = await requireOpenSite(ctx);
  const { airports, cities } = await withPlatformTx(
    ctx.pool,
    async (db) => {
      const active = await listActiveCities(db, channel.scope.cityIds);
      const transferCities = active.filter((city) => channelScopeRefusal(channel.scope, city.id, "airport_transfer") === null).map((city) => city.id);
      const boxes = [input.pickup, input.dropoff].map((end) => cityBounds(end, AIRPORT_LOOKUP_KM));
      return { airports: await listAirportsNear(db, transferCities, boxes), cities: active };
    },
    { snapshot: true },
  );
  const recognized = classifyPointsTrip(input.pickup, input.dropoff, airports);
  const { trip } = recognized;
  const cityOf = (id: string): SiteCityInfo | null => cities.find((city) => city.id === id) ?? null;
  let city: SiteCityInfo | null;
  let siteTrip: SiteTrip | null = null;
  if (trip.tripType === "point_to_point") {
    // 点对点只在官网能订点对点的城市里找（城市和品类在渠道授权里、有渠道卖的供应商上架了点对点商品）
    const bookable = (await siteCities(ctx)).filter((candidate) => candidate.categories.includes("point_to_point"));
    const found = serviceCityOf(trip.pickup, bookable);
    city = found === null ? null : cityOf(found.id);
    if (city !== null) siteTrip = { category: "point_to_point", pickup: trip.pickup, dropoff: trip.dropoff };
  } else {
    city = cityOf(trip.airport.airport.cityId);
    siteTrip = { category: "airport_transfer", airportId: trip.airport.airport.id, direction: trip.tripType, address: trip.address };
  }
  const airport = trip.tripType === "point_to_point" ? null : { id: trip.airport.airport.id, code: trip.airport.airport.code, name: trip.airport.airport.name, matchedBy: trip.airport.matchedBy, meters: trip.airport.meters };
  const cityJson = city === null ? null : { id: city.id, code: city.code, name: city.name, timezone: city.timezone };
  if (city === null || siteTrip === null) {
    return { tripType: trip.tripType, airport, city: null, currency: channel.settleCurrency, quotes: [], unavailable: [{ vehicleGroupId: null, reasons: ["OUT_OF_SERVICE_AREA"] }], expiresAt: null, route: null };
  }
  const logExtra = {
    mode: "by_points",
    recognition: { trip_type: trip.tripType, airport_id: airport?.id ?? null, pickup: endLog(input.pickup, recognized.pickupAirport), dropoff: endLog(input.dropoff, recognized.dropoffAirport) },
  };
  const [result, route] = await Promise.all([
    siteQuotes(ctx, { cityId: city.id, trip: siteTrip, serviceLocal: input.serviceLocal, passengers: input.passengers, luggage: input.luggage, addons: input.addons }, logExtra),
    routePreviewOrNull(ctx, { lat: input.pickup.lat, lng: input.pickup.lng }, { lat: input.dropoff.lat, lng: input.dropoff.lng }),
  ]);
  const expiresAt = result.quotes.reduce<string | null>((earliest, quote) => (earliest === null || quote.expiresAt < earliest ? quote.expiresAt : earliest), null);
  return { ...result, tripType: trip.tripType, airport, city: cityJson, expiresAt, route };
}

/**
 * 参考汇率不可用的原因（M8-02，ADR 0069 B16）：`NO_RATE` 汇率中心没有这两种币种的汇率；`STALE` 超过 48 小时没更新（跨币种报价也停了）；
 * `PENDING_REVIEW` 有一批涨跌超过阈值的汇率挂起、等人工确认（这时不给客人看参考价）。
 */
export type SiteFxUnavailable = "NO_RATE" | "STALE" | "PENDING_REVIEW";

export interface SiteFxReference {
  available: boolean;
  /** 订单币种（官网渠道的结算币种） */
  from: string;
  to: CurrencyCode;
  /** 1 个订单币种的主单位 ≈ 多少个客人币种的主单位（十进制字符串）；不可用为 null */
  rate: string | null;
  /** 这个汇率是哪一批的（数据源的时间）；同币种、不可用为 null */
  asOf: string | null;
  reason: SiteFxUnavailable | null;
}

/**
 * 按客人币种显示的参考价用的汇率（M8-02，ADR 0069 B16）：只读汇率中心「现在生效」的汇率（和报价引擎同一个 `ctx.fx.rates`，含人工锁定），不拉任何外部服务。
 * 只用于显示，不进报价、不影响收款。
 */
export async function siteFxReference(ctx: AppContext, to: CurrencyCode): Promise<SiteFxReference> {
  const { channel } = await requireOpenSite(ctx);
  const from = channel.settleCurrency as CurrencyCode;
  if (from === to) return { available: true, from, to, rate: "1", asOf: null, reason: null };
  const unavailable = (reason: SiteFxUnavailable): SiteFxReference => ({ available: false, from, to, rate: null, asOf: null, reason });
  const table = await ctx.fx.currentTable();
  if (table === null || fxQuoteFromTable(table, from, to) === null) return unavailable("NO_RATE");
  const held = await withPlatformTx(ctx.pool, (db) => pendingHeldFetches(db, new Date(table.asOf)), { snapshot: true });
  if (held.length > 0) return unavailable("PENDING_REVIEW");
  const quote = await ctx.fx.rates.quote(from, to, ctx.now());
  if (quote === null) return unavailable("STALE");
  return { available: true, from, to, rate: quote.rate, asOf: quote.asOf, reason: null };
}

export interface SiteLink {
  token: string;
  expiresAt: Date;
}

function linkExpiry(serviceAt: Date, now: Date): Date {
  return new Date(Math.max(serviceAt.getTime() + SITE_LINK_RULES.afterServiceMs, now.getTime() + SITE_LINK_RULES.minimumMs));
}

/** 生成一个查看令牌：原文只给调用方这一次，库里只存哈希（下单、找回、邮件都从这里来，ADR 0032）。 */
export function newSiteLink(serviceAt: Date, now: Date): SiteLink & { tokenHash: string } {
  const token = `${LINK_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { token, tokenHash: hashToken(token), expiresAt: linkExpiry(serviceAt, now) };
}

async function issueLink(ctx: AppContext, orderId: string, serviceAt: Date): Promise<SiteLink> {
  const now = ctx.now();
  const { token, tokenHash, expiresAt } = newSiteLink(serviceAt, now);
  await withPlatformTx(ctx.pool, (db) => insertSiteOrderLink(db, { orderId, tokenHash, issuedVia: "order", createdAt: now, expiresAt }));
  return { token, expiresAt };
}

/** 官网下单：同一个下单流程（没配 Stripe 时照样建单、待支付），成功后发一个查看链接。重复提交（同一个幂等键）得到同一张单和一个新链接。 */
export async function placeSiteOrder(ctx: AppContext, input: SalesOrderInput, log: OrderLog = SILENT_ORDER_LOG): Promise<{ view: SalesOrderView; payment: SalesOrderPayment | null; replayed: boolean; link: SiteLink }> {
  const { principal } = await requireOpenSite(ctx);
  const created = await createSiteOrder(ctx, principal, input, log);
  return { ...created, link: await issueLink(ctx, created.view.order.id, created.view.order.serviceAt) };
}

/**
 * 先做 NFKC 规范化（全角的数字、字母、`＠`、`＋`、`－`、全角空格转成半角：日文 / 中文输入法常见），再比较：
 * 邮箱不分大小写、去掉首尾空白；电话去掉空格、括号、连字符、点。像邮箱的（有 @）按邮箱比，其余按电话比。
 */
export function contactMatches(contact: string, passenger: { email: string; phone: string }): boolean {
  const key = contactLookupKey(contact);
  if (key === null) return false;
  return key.kind === "email" ? key.value === normalizeEmailForIndex(passenger.email) : key.value === normalizePhoneForIndex(passenger.phone);
}

/** 盲索引的结论：这一行有当前密钥算的盲索引就有结论，不用解密；没回填、密钥换过、读明文模式时是 null。 */
function indexVerdict(crypto: PassengerCrypto, contact: string, found: { tenantId: string; emailBidx: string | null; phoneBidx: string | null }): boolean | null {
  const key = contactLookupKey(contact);
  if (key === null) return false;
  const stored = key.kind === "email" ? found.emailBidx : found.phoneBidx;
  return crypto.readsCiphertext && crypto.isCurrent(stored) ? crypto.index(found.tenantId, key.kind, key.value) === stored : null;
}

/** 核对这张单（ADR 0057）：有盲索引比盲索引，否则按内容比，规则相同。 */
export function contactMatchesOrder(crypto: PassengerCrypto, contact: string, found: { tenantId: string; email: string; phone: string; emailBidx: string | null; phoneBidx: string | null }): boolean {
  return indexVerdict(crypto, contact, found) ?? contactMatches(contact, found);
}

/**
 * 查订单时的核对：先比盲索引再解密（ADR 0057）。对不上的不解密；对得上却解不开的抛出（后台任务记日志，客人收不到信，和对不上一样）。
 * 没有盲索引又解不开的，分不出对没对，按对不上算。
 */
function lookupMatches(crypto: PassengerCrypto, contact: string, found: { orderId: string; tenantId: string; passengerEnc: string | null; passengerPlain: PassengerContact; emailBidx: string | null; phoneBidx: string | null }): boolean {
  const verdict = indexVerdict(crypto, contact, found);
  if (verdict === false) return false;
  try {
    const passenger = crypto.readOrderPassenger(found.tenantId, found.orderId, found.passengerEnc, found.passengerPlain);
    return verdict ?? contactMatches(contact, passenger);
  } catch (err) {
    if (verdict === null && isPassengerDecryptFailure(err)) return false;
    throw err;
  }
}

export interface SiteLinkLog {
  error(details: object, message: string): void;
}

/**
 * 查订单（ADR 0061）：订单号 + 下单邮箱（已规整，见 domain 的 `viewLinkLookupEmail`）。**应答前只做和订单无关的事**：
 * 官网配没配置、邮件能不能发、按订单号 → 邮箱占限速（不管订单存不存在都计；被前面拦下的不占后面的；来源地址的额度接口层在校验前已占）。
 * 查单、核对、排进通知中心都在应答之后的后台任务里，所以对上、对不上、订单号不存在、别的渠道的单、已脱敏，应答和耗时都一样。
 * 发信由通知中心做（事件 `order.view_link`，收件人是订单上现在的邮箱；链接在发送那一刻新签发，旧链接不受影响）。
 */
export async function requestSiteOrderLink(ctx: AppContext, log: SiteLinkLog, input: { orderNo: string; email: string }): Promise<void> {
  const channelId = await requireSiteChannelId(ctx);
  await ctx.integrations.ensureFresh();
  if (ctx.integrations.effective.email.config === null) throw orderLinkEmailUnavailable();
  const now = ctx.now();
  for (const step of viewLinkThrottleSteps()) {
    // 订单号、邮箱不进限流表原文
    const value = step.dimension === "order" ? input.orderNo : input.email;
    const decision = await withPlatformTx(ctx.pool, (db) => takeRateSlot(db, bucketOf(step.dimension, value), step.scope, now));
    if (!decision.allowed) throw rateLimited(decision.retryAfterSeconds);
  }
  inBackground(ctx, log, "site.view_link_failed", () => queueSiteOrderLink(ctx, channelId, input.orderNo, input.email, now));
}

/** 后台任务：这个渠道的这张单、没脱敏、下单邮箱对得上，才排一封信。对不上什么也不做（不记失败：应答里本来就没有可猜的结论）。 */
async function queueSiteOrderLink(ctx: AppContext, channelId: string, orderNo: string, email: string, now: Date): Promise<void> {
  const found = await withPlatformTx(ctx.pool, (db) => findChannelOrderByNo(db, channelId, orderNo), { snapshot: true });
  if (found === null || found.anonymized || !lookupMatches(passengerCryptoOfPool(ctx.pool), email, found)) return;
  await withPlatformTx(ctx.pool, (db) => enqueueNotification(db, { event: "order.view_link", tenantId: found.tenantId, orderId: found.orderId, dedupeKey: `order.view_link:lookup:${found.orderId}:${randomUUID()}`, data: { via: "lookup" } }, now));
}

/** 凭查看链接找到它对应的订单编号和渠道；令牌格式不对、不存在、过期、不是官网的单一律 401。 */
export async function resolveSiteLink(ctx: AppContext, token: string | null): Promise<{ orderId: string; channelId: string }> {
  if (token === null || !LINK_FORMAT.test(token)) throw linkInvalid();
  const channelId = await requireSiteChannelId(ctx);
  const link = await withPlatformTx(ctx.pool, (db) => findLiveSiteOrderLink(db, hashToken(token), ctx.now(), SITE_LINK_RULES), { snapshot: true });
  if (link === null || link.channelId !== channelId) throw linkInvalid();
  return { orderId: link.orderId, channelId };
}

export interface SiteOrderExtras {
  /** 状态时间线：从什么到什么、原因、时间。不给操作人和派车细节 */
  events: { fromStatus: string | null; toStatus: string; reason: string | null; occurredAt: Date }[];
  names: OrderNames;
}

export async function siteOrderExtras(ctx: AppContext, view: SalesOrderView): Promise<SiteOrderExtras> {
  const { order } = view;
  return withPlatformTx(
    ctx.pool,
    async (db) => ({
      events: (await listOrderEvents(db, order.tenantId, order.id)).map((event) => ({ fromStatus: event.fromStatus, toStatus: event.toStatus, reason: event.reason, occurredAt: event.occurredAt })),
      names: await findOrderNames(db, { cityId: order.cityId, placeId: order.placeId, vehicleGroupId: order.vehicleGroupId }),
    }),
    { snapshot: true },
  );
}
