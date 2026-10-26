/**
 * 官网（自营渠道）的业务流程（M3-05，ADR 0032）。
 *
 * 官网是一个普通的渠道：服务端以配置里指定的 API 客户端（`SITE_CLIENT_ID`）的身份，调用和 `/sales/v1` **同一批** service——
 * 询价 `createSalesQuotes`、下单 `createSiteOrder`、查单 `getSalesOrderView`，取消、改单、落地、异议各自的 service 在路由里直接调。
 * 这里只多做三件 `/sales/v1` 没有的事：
 * 1. 认出官网的渠道（没配置、客户端吊销、渠道暂停 → 暂未开放；已经下了的单照样能看能操作）；
 * 2. 客人的查看链接：下单或找回时发一个令牌，库里只存 SHA-256；凭令牌只能看这一张单；
 * 3. 按来源地址限速（计数单独一个事务先提交：后面失败了这一次照样算数）。
 */
import { createHash, randomBytes } from "node:crypto";
import {
  type LocalizedText,
  type ServiceCategory,
  type VehicleGrade,
  cancellationRuleFor,
  channelScopeRefusal,
  channelSellsTenant,
  combineThrottleDecisions,
  evaluateRollingWindow,
  instantToLocal,
  localDateTimeToInstant,
  normalizePhone,
  tenantBids,
  vehicleLevel,
} from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { withPlatformTx } from "../db/context.ts";
import { AppError } from "../errors.ts";
import { currentCancellationPolicy } from "../repos/cancellation-policies.ts";
import { type Channel, findChannel } from "../repos/channels.ts";
import { listOrderEvents } from "../repos/orders.ts";
import { findQuoteCity, findQuotePlace } from "../repos/quotes.ts";
import {
  type BookableRow,
  type OrderNames,
  type SiteVehicleGroup,
  findChannelOrderByNo,
  findLiveSiteOrderLink,
  findOrderNames,
  findSiteClient,
  type SitePlaceType,
  findQuotePackageKm,
  findVehicleGroups,
  insertLookupFailure,
  insertSiteOrderLink,
  listBookableAirports,
  listBookableCharterPackages,
  listBookableCities,
  listCityPlaces,
  listLookupFailures,
} from "../repos/site.ts";
import { validationFailed } from "../validation.ts";
import { type SalesOrderInput, type SalesOrderPayment, type SalesOrderView, type OrderLog, SILENT_ORDER_LOG, createSiteOrder } from "./orders.ts";
import { type SalesRateScope, peekRateSlot, rateLimited, takeRateSlot } from "./rate-limit.ts";
import { lastUsedIsStale } from "./sales-auth.ts";
import type { SalesPrincipal } from "./sales-auth.ts";
import { type SalesQuote, type SalesUnavailableReason, createSalesQuotes } from "./sales-quotes.ts";

/** 官网卖的品类：接送机（M3-05）、点对点和包车（M3-10）。和需求的三种品类一致；渠道没授权的品类照样不卖。 */
export const SITE_CATEGORIES: readonly ServiceCategory[] = ["airport_transfer", "point_to_point", "charter"];

export const SITE_LINK_RULES = {
  /** 查看链接在用车时间之后还能用多久：30 天（覆盖加收的提交期和异议期、投诉期） */
  afterServiceMs: 30 * 24 * 3_600_000,
  /** 至少能用多久（用车时间早已过去的单找回时）：1 天 */
  minimumMs: 24 * 3_600_000,
} as const;

/** 找回的硬上限：每个订单号滚动 24 小时里失败满 100 次后，联系方式对上的也挡（ADR 0032「找回按订单号限速」）。 */
export const SITE_LOOKUP_CEILING = { maxFailures: 100, windowMs: 24 * 3_600_000 } as const;

const LINK_PREFIX = "nzo_";
const LINK_FORMAT = /^nzo_[A-Za-z0-9_-]{43}$/;

export function siteNotOpen(): AppError {
  return new AppError(503, "SITE_NOT_OPEN", "官网暂未开放预订，请稍后再来");
}

function linkInvalid(): AppError {
  return new AppError(401, "ORDER_LINK_INVALID", "订单链接无效或已过期，请用订单号和下单时的邮箱或手机号重新查找");
}

function orderNotFound(): AppError {
  return new AppError(404, "ORDER_NOT_FOUND", "没有找到这张订单：请核对订单号，以及下单时填的邮箱或手机号");
}

const hashToken = (token: string): string => createHash("sha256").update(token, "utf8").digest("hex");
/** 来源地址、订单号不进限流表原文（和登录限速一样只存哈希）。 */
const bucketOf = (kind: string, value: string): string => createHash("sha256").update(`site-${kind}:${value}`, "utf8").digest("hex");

/** 占用一次官网的限流额度；超限 429。计数单独一个事务先提交，后面出错回滚时这一次照样算数。 */
export async function takeSiteSlot(ctx: AppContext, scope: Extract<SalesRateScope, `site_${string}`>, key: { ip: string } | { orderNo: string }): Promise<void> {
  const bucket = "ip" in key ? bucketOf("ip", key.ip) : bucketOf("order", key.orderNo);
  const decision = await withPlatformTx(ctx.pool, (db) => takeRateSlot(db, bucket, scope, ctx.now()));
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
}

export async function siteConfig(ctx: AppContext): Promise<SiteConfig> {
  const site = await loadSiteChannel(ctx);
  const open = site !== null && site.open;
  return { open, currency: open ? site.channel.settleCurrency : null, payments: open && ctx.payments !== null ? { provider: "stripe", publishableKey: ctx.payments.publishableKey } : null };
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
    const city = cities.get(row.id) ?? { id: row.id, code: row.code, name: row.name, timezone: row.timezone, countryCode: row.countryCode, categories: [] };
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
 * 客人选一个，页面把名称和坐标填进地址那一栏；也可以照旧自己写地址和坐标。
 */
export async function sitePlaces(ctx: AppContext, cityId: string): Promise<SitePlace[]> {
  await requireOpenSite(ctx);
  const rows = await withPlatformTx(ctx.pool, (db) => listCityPlaces(db, cityId), { snapshot: true });
  return rows.map((row) => ({ id: row.id, type: row.type, code: row.code, name: row.name, address: row.address, lng: row.lng, lat: row.lat }));
}

type Point = { lng: number; lat: number };

/** 官网询价的行程：三种品类各自要的东西。 */
export type SiteTrip =
  /** 接送机：机场、方向（pickup 接机 = 机场 → 地址；dropoff 送机 = 地址 → 机场）、地址那一端的坐标 */
  | { category: "airport_transfer"; airportId: string; direction: "pickup" | "dropoff"; address: Point }
  /** 点对点：上车点、下车点的坐标 */
  | { category: "point_to_point"; pickup: Point; dropoff: Point }
  /** 包车：上车点的坐标、套餐时长（小时） */
  | { category: "charter"; pickup: Point; packageHours: number };

export interface SiteQuoteInput {
  cityId: string;
  trip: SiteTrip;
  /** 城市当地的用车时间 `YYYY-MM-DDTHH:mm` */
  serviceLocal: string;
  passengers: number;
  luggage: number;
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
}

export interface SiteQuoteResult {
  currency: string;
  quotes: SiteQuote[];
  unavailable: { vehicleGroupId: string | null; reasons: SalesUnavailableReason[] }[];
}

/** 询价请求里给渠道询价用的那几项（各品类的起终点、方向、套餐），和询价日志里记的原始请求。 */
function salesTrip(input: SiteQuoteInput): { category: ServiceCategory; placeId: string | null; direction: "pickup" | "dropoff" | null; pickup: Point | null; dropoff: Point | null; packageHours: number | null; request: Record<string, unknown> } {
  const { trip } = input;
  const common = { source: "site", category: trip.category, city_id: input.cityId, service_local: input.serviceLocal, passengers: input.passengers, luggage: input.luggage };
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
      return { category: trip.category, placeId: null, direction: null, pickup: trip.pickup, dropoff: null, packageHours: trip.packageHours, request: { ...common, pickup: trip.pickup, package_hours: trip.packageHours } };
  }
}

/** 官网询价：城市（接送机还有机场）核对过、当地时间换成时刻后，走渠道询价（同一个 `createSalesQuotes`），再补上车型组的名称、取消阶梯和包车的套餐公里。 */
export async function siteQuotes(ctx: AppContext, input: SiteQuoteInput): Promise<SiteQuoteResult> {
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
  const serviceTime = localDateTimeToInstant(input.serviceLocal, city.timezone);
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
      addons: [],
      driverLanguage: null,
      vehicleGroupIds: [],
      currency: channel.settleCurrency,
    },
    { request: sales.request },
  );
  const { groups, policy, packageKm } = await withPlatformTx(
    ctx.pool,
    async (db) => ({
      groups: await findVehicleGroups(db, result.quotes.map((quote) => quote.vehicleGroupId)),
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
    return [{ ...quote, vehicleGroup: group, packageKm: packageKm.get(quote.quoteId) ?? null, cancelPolicy: { category: sales.category, level, tiers: rule.tiers.map((tier) => ({ minHoursBefore: tier.minHoursBefore, feeBp: tier.feeBp })) } }];
  });
  // 价低的在前：客人先看到最便宜的
  quotes.sort((a, b) => a.sellMinor - b.sellMinor || a.vehicleGroup.seats - b.vehicleGroup.seats);
  return { currency: channel.settleCurrency, quotes, unavailable: result.unavailable };
}

export interface SiteLink {
  token: string;
  expiresAt: Date;
}

function linkExpiry(serviceAt: Date, now: Date): Date {
  return new Date(Math.max(serviceAt.getTime() + SITE_LINK_RULES.afterServiceMs, now.getTime() + SITE_LINK_RULES.minimumMs));
}

async function issueLink(ctx: AppContext, orderId: string, serviceAt: Date, via: "order" | "lookup"): Promise<SiteLink> {
  const now = ctx.now();
  const token = `${LINK_PREFIX}${randomBytes(32).toString("base64url")}`;
  const expiresAt = linkExpiry(serviceAt, now);
  await withPlatformTx(ctx.pool, (db) => insertSiteOrderLink(db, { orderId, tokenHash: hashToken(token), issuedVia: via, createdAt: now, expiresAt }));
  return { token, expiresAt };
}

/** 官网下单：同一个下单流程（没配 Stripe 时照样建单、待支付），成功后发一个查看链接。重复提交（同一个幂等键）得到同一张单和一个新链接。 */
export async function placeSiteOrder(ctx: AppContext, input: SalesOrderInput, log: OrderLog = SILENT_ORDER_LOG): Promise<{ view: SalesOrderView; payment: SalesOrderPayment | null; replayed: boolean; link: SiteLink }> {
  const { principal } = await requireOpenSite(ctx);
  const created = await createSiteOrder(ctx, principal, input, log);
  return { ...created, link: await issueLink(ctx, created.view.order.id, created.view.order.serviceAt, "order") };
}

/**
 * 先做 NFKC 规范化（全角的数字、字母、`＠`、`＋`、`－`、全角空格转成半角：日文 / 中文输入法常见），再比较：
 * 邮箱不分大小写、去掉首尾空白；电话去掉空格、括号、连字符、点。像邮箱的（有 @）按邮箱比，其余按电话比。
 */
export function contactMatches(contact: string, passenger: { email: string; phone: string }): boolean {
  const given = contact.normalize("NFKC").trim();
  if (given === "") return false;
  if (given.includes("@")) return given.toLowerCase() === passenger.email.normalize("NFKC").trim().toLowerCase();
  const phone = normalizePhone(given);
  return phone.length >= 6 && phone === normalizePhone(passenger.phone.normalize("NFKC"));
}

/**
 * 用订单号 + 下单时的邮箱或电话找回订单：对上了发一个新链接；订单号不存在、联系方式不对、不是官网的单一律同一个 404。
 * 按订单号有两层额度（ADR 0032「找回按订单号限速」）：
 * - 每小时 10 次**失败**（方案 A）：别人用错的联系方式刷满了，真客人对上的那次照样放行；
 * - 硬上限：滚动 24 小时失败满 100 次后，对上的也挡（否则刷满后「429 = 猜错、200 = 猜对」，等于不限猜测次数）。
 * 失败的一次先记下（单独提交）再决定 429 还是 404；被挡时不论对没对上，应答（含 Retry-After）都按「这一次如果算失败」计算，
 * 不存在的订单号和对不上的走同一条路，借应答分不出订单号存不存在、联系方式对没对。
 */
export async function lookupSiteOrder(ctx: AppContext, orderNo: string, contact: string, log: OrderLog = SILENT_ORDER_LOG): Promise<SiteLink> {
  const channelId = await requireSiteChannelId(ctx);
  const now = ctx.now();
  const bucket = bucketOf("order", orderNo);
  const since = new Date(now.getTime() - SITE_LOOKUP_CEILING.windowMs);
  const ceilingOf = (times: readonly Date[]) => evaluateRollingWindow(times, SITE_LOOKUP_CEILING.maxFailures, SITE_LOOKUP_CEILING.windowMs, now);
  const found = await withPlatformTx(ctx.pool, (db) => findChannelOrderByNo(db, channelId, orderNo), { snapshot: true });
  if (found !== null && contactMatches(contact, found)) {
    const blocked = await withPlatformTx(ctx.pool, async (db) => {
      const ceiling = ceilingOf(await listLookupFailures(db, bucket, since));
      if (ceiling.allowed) return null;
      return combineThrottleDecisions([ceiling, await peekRateSlot(db, bucket, "site_lookup_order", now)]);
    });
    if (blocked !== null) throw rateLimited(blocked.retryAfterSeconds);
    return issueLink(ctx, found.orderId, found.serviceAt, "lookup");
  }
  const decision = await withPlatformTx(ctx.pool, async (db) => {
    const hourly = await takeRateSlot(db, bucket, "site_lookup_order", now);
    const before = await listLookupFailures(db, bucket, since);
    const ceiling = ceilingOf(before);
    // 硬上限已满时不再记（每个订单号最多留 100 行）；这一次正好记满时留一条服务日志给运营
    if (ceiling.allowed) {
      await insertLookupFailure(db, bucket, now, since);
      if (before.length + 1 === SITE_LOOKUP_CEILING.maxFailures) {
        log.warn({ event: "site_lookup_ceiling_reached", order_id: found?.orderId ?? null, order_bucket: bucket.slice(0, 16), failures: SITE_LOOKUP_CEILING.maxFailures, window_hours: 24 }, "官网找回：这个订单号 24 小时内失败满 100 次，接下来连对上的联系方式也会被挡，请留意是否有人在猜");
      }
    }
    return combineThrottleDecisions([hourly, ceiling]);
  });
  if (!decision.allowed) throw rateLimited(decision.retryAfterSeconds);
  throw orderNotFound();
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
