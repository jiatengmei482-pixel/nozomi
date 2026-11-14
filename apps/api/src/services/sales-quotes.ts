/**
 * 正式询价 `POST /sales/v1/quotes`、`GET /sales/v1/quotes/{quote_id}`（M2-04，ADR 0023）。
 *
 * 一次询价 = 在渠道的授权范围里比价（`previewPlatformQuote` 带渠道、`fresh: false`：候选商品和规则用 30 秒内的缓存，库存、节假日、评分现查）
 * → 每个车型组（包车再按套餐）生成一个 `quote_id`、把快照存进 `quotes`（有效期 30 分钟，下单以它为准）→ 一行询价日志（全部候选和没报出价的原因）。
 *
 * 给渠道的应答只有：quote_id、有效期、车型组、对外价（客人支付的币种）、汇率和取数时间、免费等待。
 * **没有中标租户、结算价、加价比例**（需求「付款前不显示中标租户」「参与比价的租户和它们的报价只在平台内部记录」；规则 4 的精神）。
 * 报不出价的车型组只给面向客人的原因（不在服务范围、提前量不够、售罄……），不给供应商内部的原因（暂停、子品牌停用、缺价格）。
 */
import { randomInt } from "node:crypto";
import { performance } from "node:perf_hooks";
import { PRICE_LIMITS, type AreaSurchargeBreakdown, type CharterSelection, type ComparisonRefusal, type ItineraryBreakdown, type PricingBasis, type QuoteWaypoint, type RouteUsage, type SellBreakdownItem, sellBreakdown, type SiteAudience, guestRouteReason, type CurrencyCode, type DistanceBreakdown, type FxQuote, type LatLng, type MarkupMatch, type QuoteSnapshot, type ServiceCategory, type TripDirection, formatMajor, instantToLocal, isPickupPlaceType, quoteCheckPoints, quoteSnapshotValid } from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { withPlatformTx } from "../db/context.ts";
import { AppError } from "../errors.ts";
import { findQuoteCity, findQuotePlace } from "../repos/quotes.ts";
import { type InputIssue, validationFailed } from "../validation.ts";
import { type PlatformQuotePreview, type QuoteLog, type RouteOutcome, markupKey, previewPlatformQuote } from "./quotes.ts";
import { type DemandFacts, type DemandSource, recordUncoveredDemandLater } from "./uncovered-demands.ts";
import type { SalesPrincipal } from "./sales-auth.ts";

/** 起点 / 终点：坐标，或主数据里的地点（机场、车站、POI）编号——给了地点就用地点的坐标。 */
export type SalesPoint = { placeId: string } | LatLng;

export interface SalesQuoteInput {
  cityId: string;
  category: ServiceCategory;
  placeId: string | null;
  direction: TripDirection | null;
  pickup: SalesPoint | null;
  dropoff: SalesPoint | null;
  /** 带时区的用车时间（ISO 8601）：按城市的时区换成当地时间 */
  serviceTime: Date;
  packageHours: number | null;
  passengers: number;
  luggage: number;
  addons: { addonId: string; quantity: number }[];
  driverLanguage: string | null;
  vehicleGroupIds: string[];
  currency: string;
  /** 包车的经停点（ADR 0088）：只有官网给（`/sales/v1` 不开放）；不给 = 没有 */
  waypoints?: readonly QuoteWaypoint[];
  /** 包车按行程计价（ADR 0088 补充）：只有官网给 */
  routeUsage?: RouteUsage;
  /** 包车怎么定套餐（ADR 0093 第四节）：官网按行程计价 `auto` / `manual`，其余包车新询价 `manual`；进快照和询价日志 */
  charterSelection?: Exclude<CharterSelection, "locked">;
}

/** 给渠道看的「为什么没有这个车型组的价」：只有面向客人的几种。 */
/**
 * 给渠道看的「为什么没有这个车型组的价」：只有面向客人的几种。
 * 里程 + 时长的价格取不到路线时（ADR 0042）：`NO_ROUTE`（两点之间没有可行驶的路线）或 `TEMPORARILY_UNAVAILABLE`（路线服务暂时不可用，稍后再试）。
 * 包车没给下车地点、而这个商品设了区域加价（M8-15，ADR 0073）：`DROPOFF_REQUIRED`（给了下车地点再询价就可能报得出；以后下车地点改为必填）。
 * 包车有经停点不在任何区域里（M9W-01，ADR 0088）：`WAYPOINT_NOT_PRICED`（转人工报价）；经停点只有官网能给，渠道接口不会出现。
 * 包车选的时长比商品的最低套餐（或按行程算出的预计用时）短（M9P-03，ADR 0093 第四节第 7 条）：`PACKAGE_TOO_SHORT`，另给 `min_package_hours`（选不短于它的时长再询价就可能报得出）。
 * 包车预计用时超过商品的在线下单上限（默认 13 小时，M9P-03，规格步骤 5）：`ITINERARY_TOO_LONG`（转客服定制）；只有官网按行程计价会出现。
 */
export const SALES_UNAVAILABLE_REASONS = ["NO_PRODUCT", "OUT_OF_SERVICE_AREA", "DROPOFF_REQUIRED", "WAYPOINT_NOT_PRICED", "PACKAGE_TOO_SHORT", "ITINERARY_TOO_LONG", "LEAD_TIME_TOO_SHORT", "SOLD_OUT", "OUTSIDE_SERVICE_TIME", "SERVICE_TIME_PASSED", "CAPACITY_EXCEEDED", "ADDON_NOT_OFFERED", "DRIVER_LANGUAGE_NOT_OFFERED", "NO_ROUTE", "TEMPORARILY_UNAVAILABLE", "NOT_AVAILABLE"] as const;
export type SalesUnavailableReason = (typeof SALES_UNAVAILABLE_REASONS)[number];

function salesReason(reason: ComparisonRefusal, route: RouteOutcome): SalesUnavailableReason {
  switch (reason) {
    case "ROUTE_UNAVAILABLE":
      return route.status === "unavailable" ? guestRouteReason(route.code) : "TEMPORARILY_UNAVAILABLE";
    // 在运营区域里、但商品没勾报价区域（ADR 0075）：只是平台内部的细分，对外仍是不在服务范围（不给渠道加新的枚举值）
    case "OUT_OF_SERVICE_AREA":
    case "IN_FORBIDDEN_AREA":
    case "NO_PRICING_AREA":
      return "OUT_OF_SERVICE_AREA";
    // 包车没给下车地点、而商品设了区域加价（ADR 0073）：渠道补上下车地点就能报
    case "DROPOFF_REQUIRED":
      return "DROPOFF_REQUIRED";
    // 包车有经停点不在任何区域里（ADR 0088）：官网转人工报价，并指出是第几个经停点
    case "WAYPOINT_NOT_PRICED":
      return "WAYPOINT_NOT_PRICED";
    // 选的时长比最低套餐 / 预计用时短（ADR 0093 第四节第 7 条）：客人选长一点就能报，不能落到 NOT_AVAILABLE
    case "BELOW_MIN_PACKAGE":
    case "PACKAGE_TOO_SHORT":
      return "PACKAGE_TOO_SHORT";
    // 行程太长，不在线下单（规格步骤 5）：转客服
    case "ITINERARY_TOO_LONG":
      return "ITINERARY_TOO_LONG";
    case "LEAD_TIME_TOO_SHORT":
      return "LEAD_TIME_TOO_SHORT";
    case "SOLD_OUT":
    case "URGENT_SOLD_OUT":
      return "SOLD_OUT";
    case "OUTSIDE_SERVICE_TIME":
    case "OUTSIDE_SALE_PERIOD":
      return "OUTSIDE_SERVICE_TIME";
    case "SERVICE_TIME_PASSED":
    case "CAPACITY_EXCEEDED":
    case "ADDON_NOT_OFFERED":
    case "DRIVER_LANGUAGE_NOT_OFFERED":
      return reason;
    default:
      // 供应商内部的原因（暂停、子品牌停用、缺价格、汇率……）不告诉渠道
      return "NOT_AVAILABLE";
  }
}

/** 存进 quotes.snapshot 的完整快照：domain 的快照 + quote_id + 渠道 + 加价规则的出处。 */
export interface StoredQuoteSnapshot extends QuoteSnapshot {
  quoteId: string;
  /** `settleFx`：渠道结算币种 → 客人支付币种的中央汇率（同币种、取不到为 null；M3-07 起才有，试算换算毛利用，ADR 0033） */
  channel: { id: string; bandBp: number; markupFloorBp: number; minMarginMinor: number; settleCurrency: CurrencyCode; roundingUnit: number; settleFx?: FxQuote | null };
  markup: MarkupMatch;
  /** 用车日期（城市当地）、是不是走了加急 */
  serviceDate: string;
  urgent: boolean;
}

export interface SalesQuote {
  quoteId: string;
  createdAt: string;
  expiresAt: string;
  vehicleGroupId: string;
  packageHours: number | null;
  serviceDate: string;
  currency: CurrencyCode;
  sellMinor: number;
  fx: { rate: string; asOf: string } | null;
  freeWaitMinutes: number | null;
  urgent: boolean;
  /** 包车：这个价里含区域加价（上车、下车或经停点在加价区域里且加了钱，ADR 0073、0088）；别的都是 false。只说「含」，不给金额 */
  includesAreaSurcharge: boolean;
  /** 对外价的简单明细（ADR 0088 第 4 节，客人支付币种；各项之和等于 `sellMinor`）：只有官网的应答给，渠道接口不给 */
  sellBreakdown: SellBreakdownItem[];
  /**
   * 点对点：中标的价格是设了含公里数的一口价时（M8-11，ADR 0073 第四部分）——含多少公里、报价时锁定的路线距离（米）、超出公里数，
   * 和超出每公里的**对外价**（客人支付币种的最小单位，单独取整，是说明，已含在 `sellMinor` 里）。没设含公里数为 null。不给结算价（对外接口只给对外价）
   */
  distance: { includedKm: number; routeMeters: number; overKm: number; overKmPerKmMinor: number } | null;
  /** 计价方式（M8-30，ADR 0080）：一口价 / 一口价 + 区域外里程费（客人页标「含里程费」）/ 按计程价（「按里程计价」）。只说方式，不给计程的单价和金额 */
  pricingBasis: PricingBasis;
  /**
   * 包车按行程计价（ADR 0091 第一节、0093 第四节第 9 条）：中标商品的预计用时 T（分钟）、它含不含经停点默认占用或整单缓冲（页面写「含缓冲」）、
   * 这个车型组自动选出的档（手动升档时也是自动会选的那一档）。没按行程计价、或部署前的报价没有这一项；只有官网的应答给
   */
  itinerary?: { estimatedMinutes: number; includesBuffer: boolean; autoPackageHours: number | null };
  /**
   * 这个车型组还能加哪些附加服务（M8-02，ADR 0069 B15）：参加了这个车型组比价的候选商品里，有供应商提供（开着、目录里启用、适用这个品类）的附加服务编号，去重排序。
   * 只有编号，不带任何单价；只在刚询价时有（查报价 `getSalesQuote` 不给）
   */
  offeredAddonIds?: string[];
}

export interface SalesQuoteResult {
  quotes: SalesQuote[];
  /**
   * `stopSeqs`：原因里有 `WAYPOINT_NOT_PRICED` 时，哪几个经停点报不出（不在任何区域里，或所在加价区域没有可用的途经规则；从 1 起，ADR 0088、M9W-10）；没有时不给。
   * `minPackageHours`：原因里有 `PACKAGE_TOO_SHORT` 时，这个车型组里各商品能接受的最短档的最小值（小时，ADR 0093 第四节第 7 条）；没有时不给
   */
  unavailable: { vehicleGroupId: string | null; reasons: SalesUnavailableReason[]; stopSeqs?: number[]; minPackageHours?: number }[];
}

/** 选档判断的拒绝（ADR 0093 第四节第 7 条）：客人选短了，不是缺供应商——有这种拒绝的询价不记「未覆盖需求」 */
const PACKAGE_REFUSALS: ReadonlySet<ComparisonRefusal> = new Set(["BELOW_MIN_PACKAGE", "PACKAGE_TOO_SHORT"]);

const ID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** `QT` + 日期（UTC）+ 10 位随机的数字和大写字母，如 `QT20261006A8F3K2X9Q1`。 */
export function newQuoteId(now: Date): string {
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  let random = "";
  for (let i = 0; i < 10; i += 1) random += ID_ALPHABET[randomInt(ID_ALPHABET.length)];
  return `QT${date}${random}`;
}

/** 含公里数对外的样子：只有对外价的超出每公里；快照里没有对外价参考（不会发生）时不给这一项。 */
function salesDistance(distance: DistanceBreakdown | null, sellPerKmMinor: number | undefined): SalesQuote["distance"] {
  if (distance === null || sellPerKmMinor === undefined) return null;
  return { includedKm: distance.includedKm, routeMeters: distance.routeMeters, overKm: distance.overKm, overKmPerKmMinor: sellPerKmMinor };
}

/** 区域加价合计（结算价）：上车 + 下车 + 途经 */
function areaSurchargeTotal(surcharge: AreaSurchargeBreakdown | null): number {
  if (surcharge === null) return 0;
  return surcharge.pickup.amountMinor + surcharge.dropoff.amountMinor + (surcharge.waypoints ?? []).reduce((sum, entry) => sum + entry.amountMinor, 0);
}

function toSalesQuote(snapshot: StoredQuoteSnapshot): SalesQuote {
  const { winner } = snapshot;
  const freeWait = winner.offer.settlement.freeWait.value;
  return {
    quoteId: snapshot.quoteId,
    createdAt: snapshot.createdAt,
    expiresAt: snapshot.expiresAt,
    vehicleGroupId: winner.offer.vehicleGroupId,
    packageHours: winner.offer.packageHours,
    serviceDate: snapshot.serviceDate,
    currency: snapshot.currency,
    sellMinor: winner.sell.sellMinor,
    fx: winner.sell.fx === null ? null : { rate: winner.sell.fx.rate, asOf: winner.sell.fx.asOf },
    freeWaitMinutes: freeWait === null ? null : freeWait.mode === "limited" ? freeWait.minutes : null,
    urgent: snapshot.urgent,
    includesAreaSurcharge: areaSurchargeTotal(winner.offer.settlement.areaSurcharge ?? null) > 0,
    sellBreakdown: sellBreakdown(winner.offer.settlement, winner.sell),
    distance: salesDistance(winner.offer.settlement.distance ?? null, winner.sell.overKmPerKmMinor),
    pricingBasis: winner.offer.settlement.pricingBasis ?? "one_price",
    ...itineraryEstimateOf(snapshot),
  };
}

/**
 * 按行程计价的预计用时（ADR 0091 第一节）：明细里有 `estimatedMinutes`（占用或缓冲不为 0）用它，否则就是「行驶 + 停留」；
 * 自动选的档：`auto` 就是中标的档，`manual` 是引擎另记的自动会选的档。只有带 `charterSelection` 的按行程计价报价才有
 */
function itineraryEstimateOf(snapshot: StoredQuoteSnapshot): Pick<SalesQuote, "itinerary"> {
  const offer = snapshot.winner.offer;
  const itinerary: ItineraryBreakdown | undefined = offer.settlement.itinerary;
  const selection = snapshot.request.charterSelection;
  if (itinerary === undefined || selection === undefined) return {};
  const autoPackageHours = selection === "auto" ? offer.packageHours : (offer.autoPackageHours ?? null);
  return { itinerary: { estimatedMinutes: itinerary.estimatedMinutes ?? itinerary.routeMinutes, includesBuffer: (itinerary.stopOccupancyMinutes ?? 0) > 0 || (itinerary.bufferMinutes ?? 0) > 0, autoPackageHours } };
}

/** 起点 / 终点里的地点编号换成坐标；地点要存在、启用、在这个城市。 */
async function resolvePoints(ctx: AppContext, input: SalesQuoteInput): Promise<{ timezone: string; pickup: LatLng | null; dropoff: LatLng | null }> {
  return withPlatformTx(
    ctx.pool,
    async (db) => {
      const city = await findQuoteCity(db, input.cityId);
      if (!city) throw validationFailed("body", [{ path: "/city_id", reason: "UNKNOWN_CITY", message: "城市不存在" }]);
      const issues: InputIssue[] = [];
      const resolve = async (point: SalesPoint | null, path: string): Promise<LatLng | null> => {
        if (point === null || !("placeId" in point)) return point;
        const place = await findQuotePlace(db, point.placeId);
        if (!place || place.cityId !== city.id || !place.active) {
          issues.push({ path, reason: "UNKNOWN_PLACE", message: "地点不存在、已停用，或者不在这个城市" });
          return null;
        }
        if (input.category === "airport_transfer" && isPickupPlaceType(place.type as never) && place.id === input.placeId) {
          issues.push({ path, reason: "NOT_APPLICABLE", message: "接送机的机场 / 车站那一端用 place_id，这里填另一端" });
        }
        return place.location;
      };
      const pickup = await resolve(input.pickup, "/pickup/place_id");
      const dropoff = await resolve(input.dropoff, "/dropoff/place_id");
      if (issues.length > 0) throw validationFailed("body", issues);
      return { timezone: city.timezone, pickup, dropoff };
    },
    { snapshot: true },
  );
}

/**
 * 询价：比价、生成 quote_id、存快照和询价日志。
 * 一个价都报不出、又给了 `demand`（官网、渠道的正式询价）时，应答之后另记一条「未覆盖需求」（M8-20，ADR 0075 第四部分），不影响应答。
 */
export async function createSalesQuotes(ctx: AppContext, principal: SalesPrincipal, input: SalesQuoteInput, options: { log?: QuoteLog; request: Record<string, unknown>; demand?: DemandSource; audience?: SiteAudience }): Promise<SalesQuoteResult> {
  const started = performance.now();
  // 官网的验收会话（M8-26，ADR 0078）：报价和询价日志标成验收的，只能下成验收单；不记「未覆盖需求」（那是给运营看的真实需求）
  const acceptance = options.audience === "acceptance";
  const points = await resolvePoints(ctx, input);
  const serviceLocal = instantToLocal(input.serviceTime, points.timezone).dateTime;
  const preview = await previewPlatformQuote(
    ctx,
    {
      cityId: input.cityId,
      category: input.category,
      placeId: input.placeId,
      currency: input.currency,
      channelId: principal.channelId,
      pickup: points.pickup,
      dropoff: points.dropoff,
      direction: input.direction,
      packageHours: input.packageHours,
      serviceLocal,
      passengers: input.passengers,
      luggage: input.luggage,
      addons: input.addons,
      driverLanguage: input.driverLanguage,
      vehicleGroupIds: input.vehicleGroupIds,
      assumeRoute: null,
      ...(input.waypoints === undefined ? {} : { waypoints: input.waypoints }),
      ...(input.routeUsage === undefined ? {} : { routeUsage: input.routeUsage }),
      ...(input.charterSelection === undefined ? {} : { charterSelection: input.charterSelection }),
    },
    { fresh: false, ...(options.log === undefined ? {} : { log: options.log }), ...(acceptance ? { audience: "acceptance" as const } : {}) },
  );
  const now = ctx.now();
  const snapshots = storedSnapshots(preview, now);
  const result: SalesQuoteResult = { quotes: snapshots.map((snapshot) => ({ ...toSalesQuote(snapshot), offeredAddonIds: offeredAddonIds(preview, snapshot) })), unavailable: unavailable(preview, input.vehicleGroupIds) };
  const durationMs = Math.round(performance.now() - started);
  await withPlatformTx(ctx.pool, async (db) => {
    const log = await db.query<{ id: string }>(
      `insert into quote_logs (channel_id, api_client_id, created_at, request, currency, city_id, category, candidate_count, quote_count, bids, rejects, duration_ms, route, is_acceptance)
       values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12, $13::jsonb, $14) returning id`,
      [
        principal.channelId,
        principal.apiClientId,
        now,
        JSON.stringify(options.request),
        preview.currency,
        input.cityId,
        input.category,
        preview.candidates.length,
        snapshots.length,
        JSON.stringify(snapshots.map((snapshot) => ({ quote_id: snapshot.quoteId, vehicle_group_id: snapshot.winner.offer.vehicleGroupId, package_hours: snapshot.winner.offer.packageHours, winner_tenant_id: snapshot.winner.tenantId, winner_product_id: snapshot.winner.productId, markup: snapshot.markup, candidates: snapshot.candidates }))),
        JSON.stringify([
          ...preview.comparison.refused.map((entry) => ({ tenant_id: entry.tenantId, product_id: entry.productId, vehicle_group_id: entry.vehicleGroupId, reason: entry.reason })),
          ...preview.excluded.map((candidate) => ({ tenant_id: candidate.product.tenantId, product_id: candidate.product.productId, vehicle_group_id: null, reason: "NOT_IN_CHANNEL_SCOPE" })),
        ]),
        durationMs,
        JSON.stringify(routeLogJson(preview.routeOutcome)),
        acceptance,
      ],
    );
    const logId = (log.rows[0] as { id: string }).id;
    for (const snapshot of snapshots) {
      const { winner } = snapshot;
      await db.query(
        `insert into quotes (id, channel_id, quote_log_id, vehicle_group_id, package_hours, winner_tenant_id, product_id, product_version, currency, sell_minor, settlement_minor, settlement_currency,
                             markup_bp, markup_rule_id, markup_level, snapshot, created_at, expires_at, is_acceptance)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, $17, $18, $19)`,
        [
          snapshot.quoteId, principal.channelId, logId, winner.offer.vehicleGroupId, winner.offer.packageHours, winner.tenantId, winner.productId, winner.productVersion, snapshot.currency,
          winner.sell.sellMinor, winner.offer.settlement.totalMinor, winner.offer.settlement.currency, winner.sell.markupBp, snapshot.markup.ruleId, snapshot.markup.level,
          JSON.stringify(snapshot), snapshot.createdAt, snapshot.expiresAt, acceptance,
        ],
      );
    }
  });
  // 只因选短了（最低套餐 / 预计用时）报不出的不记：选长一点就有供应商能接（ADR 0093 第四节第 7 条）
  if (snapshots.length === 0 && options.demand !== undefined && !acceptance && !preview.comparison.refused.some((entry) => PACKAGE_REFUSALS.has(entry.reason))) recordUncoveredDemandLater(ctx, options.demand, demandFacts(principal, input, points, serviceLocal, preview));
  return result;
}

/** 报不出价的这次询价整理成「未覆盖需求」要的事实（不含任何客人个人信息）。 */
function demandFacts(principal: SalesPrincipal, input: SalesQuoteInput, points: { pickup: LatLng | null; dropoff: LatLng | null }, serviceLocal: string, preview: PlatformQuotePreview): DemandFacts {
  const requested = [...new Set(input.vehicleGroupIds)];
  const checked: ("pickup" | "dropoff")[] = input.category === "charter" ? (points.dropoff === null ? ["pickup"] : ["pickup", "dropoff"]) : quoteCheckPoints({ category: input.category, direction: input.direction });
  return {
    channelId: principal.channelId,
    category: input.category,
    direction: input.direction,
    packageHours: input.packageHours ?? demandPackageHours(input.routeUsage),
    cityId: input.cityId,
    airportId: input.category === "airport_transfer" ? input.placeId : null,
    pickup: points.pickup,
    dropoff: points.dropoff,
    serviceLocal,
    passengers: input.passengers,
    luggage: input.luggage,
    vehicleGroupId: requested.length === 1 ? (requested[0] as string) : null,
    checked,
    suppliers: preview.candidates.map((candidate) => ({ tenantId: candidate.product.tenantId, operatingAreas: candidate.product.operatingAreas ?? [] })),
    candidateCount: preview.candidates.length,
    refusals: preview.comparison.refused.map((entry) => entry.reason),
  };
}

/**
 * 自动选档（M9P-03，`charterSelection: "auto"`）的询价没有客人选的套餐时长：未覆盖需求按行程的「行驶 + 停留」向上取整到小时记（1–72），
 * 运营看到的是「客人要多长的包车」（以前逐档询价时记的是最先试的那一档）。没有行程时为 null（不会发生：自动选档一定带行程）
 */
function demandPackageHours(routeUsage: RouteUsage | undefined): number | null {
  if (routeUsage === undefined) return null;
  return Math.min(PRICE_LIMITS.maxPackageHours, Math.max(1, Math.ceil(routeUsage.minutes / 60)));
}

/** 参加了这个车型组比价的候选商品提供的附加服务（开着、目录里启用、适用这个品类）。 */
function offeredAddonIds(preview: PlatformQuotePreview, snapshot: StoredQuoteSnapshot): string[] {
  const ids = new Set<string>();
  for (const bidder of snapshot.candidates) {
    const product = preview.candidates.find((candidate) => candidate.product.productId === bidder.productId)?.product;
    if (product === undefined) continue;
    for (const addon of product.serviceRules.addons) {
      if (addon.enabled && product.addonCatalog.some((entry) => entry.addonId === addon.addonId && entry.usable)) ids.add(addon.addonId);
    }
  }
  return [...ids].sort();
}

/** 询价日志里的路线（ADR 0042）：用没用到、来源和里程时长，或取不到的原因代码（降级原因）。 */
export function routeLogJson(outcome: RouteOutcome): Record<string, unknown> {
  switch (outcome.status) {
    case "not_needed":
      return { status: outcome.status };
    case "assumed":
      return { status: outcome.status, meters: outcome.route.meters, minutes: outcome.route.minutes };
    case "ok":
      return { status: outcome.status, source: outcome.source, meters: outcome.route.meters, minutes: outcome.route.minutes };
    case "unavailable":
      return { status: outcome.status, code: outcome.code };
  }
}

function storedSnapshots(preview: PlatformQuotePreview, now: Date): StoredQuoteSnapshot[] {
  const channel = preview.channel;
  if (channel === null) throw new Error("正式询价必须带渠道");
  return preview.comparison.groups.map((group) => {
    const winner = group.snapshot.winner;
    const markup = preview.markups.get(markupKey(winner.productId, winner.offer.vehicleGroupId)) ?? { markupBp: winner.sell.markupBp, level: 5, ruleId: null };
    return {
      ...group.snapshot,
      quoteId: newQuoteId(now),
      channel: { id: channel.id, bandBp: preview.bandBp, markupFloorBp: preview.markupFloorBp, minMarginMinor: channel.pricing.minMarginMinor, settleCurrency: channel.settleCurrency, roundingUnit: channel.pricing.sellRounding[preview.currency] ?? 1, settleFx: preview.settleFx },
      markup,
      serviceDate: group.snapshot.request.serviceLocal.slice(0, 10),
      urgent: winner.offer.settlement.urgentTier !== null,
    };
  });
}

function unavailable(preview: PlatformQuotePreview, requested: readonly string[]): SalesQuoteResult["unavailable"] {
  const quoted = new Set(preview.comparison.groups.map((group) => group.vehicleGroupId));
  const refusedFor = (vehicleGroupId: string | null) => preview.comparison.refused.filter((entry) => entry.vehicleGroupId === null || entry.vehicleGroupId === vehicleGroupId || vehicleGroupId === null);
  const reasonsFor = (vehicleGroupId: string | null): SalesUnavailableReason[] => {
    if (preview.candidates.length === 0) return ["NO_PRODUCT"];
    // 带经停点的拒绝（经停点哪个区域都不在，或经停点所在的加价区域没有可用的途经规则）对外一律是 WAYPOINT_NOT_PRICED（M9W-10，ADR 0088 补充）；
    // 询价日志、未覆盖需求里仍是原始原因码
    const reasons = refusedFor(vehicleGroupId).map((entry) => (entry.stopSeq === undefined ? salesReason(entry.reason, preview.routeOutcome) : "WAYPOINT_NOT_PRICED"));
    const distinct = [...new Set(reasons)].sort();
    return distinct.length === 0 ? ["NOT_AVAILABLE"] : distinct;
  };
  // 经停点不在区域里的是第几个（几个商品各报各的，合在一起）；没有这种原因时不带这个键
  // 选短了（ADR 0093 第四节第 7 条）：各商品能接受的最短档里最小的那个；没有这种原因时不带这个键
  const entry = (vehicleGroupId: string | null): SalesQuoteResult["unavailable"][number] => {
    const refusals = refusedFor(vehicleGroupId);
    const stopSeqs = [...new Set(refusals.flatMap((refusal) => (refusal.stopSeq === undefined ? [] : [refusal.stopSeq])))].sort((a, b) => a - b);
    const shortest = refusals.flatMap((refusal) => (PACKAGE_REFUSALS.has(refusal.reason) && refusal.minPackageHours !== undefined ? [refusal.minPackageHours] : []));
    return { vehicleGroupId, reasons: reasonsFor(vehicleGroupId), ...(stopSeqs.length === 0 ? {} : { stopSeqs }), ...(shortest.length === 0 ? {} : { minPackageHours: Math.min(...shortest) }) };
  };
  if (requested.length === 0) return quoted.size === 0 ? [entry(null)] : [];
  return [...new Set(requested)].filter((id) => !quoted.has(id)).map(entry);
}

export class QuoteExpired extends AppError {
  constructor(expiresAt: string) {
    super(410, "QUOTE_EXPIRED", "报价已过有效期，请重新询价", { expires_at: expiresAt });
  }
}

/** 查一个报价：只查得到本渠道的（别的渠道的、官网验收会话的和不存在一样 404）；过了有效期 410 `QUOTE_EXPIRED`。 */
export async function getSalesQuote(ctx: AppContext, principal: SalesPrincipal, quoteId: string): Promise<SalesQuote> {
  const row = await withPlatformTx(ctx.pool, async (db) => {
    const result = await db.query<{ snapshot: StoredQuoteSnapshot }>("select snapshot from quotes where id = $1 and channel_id = $2 and not is_acceptance", [quoteId, principal.channelId]);
    return result.rows[0] ?? null;
  });
  if (!row) throw new AppError(404, "NOT_FOUND", "报价不存在");
  if (!quoteSnapshotValid(row.snapshot, ctx.now())) throw new QuoteExpired(row.snapshot.expiresAt);
  return toSalesQuote(row.snapshot);
}

/** 应答里的金额：`{ amount: "119800", currency: "JPY" }`（主单位的十进制字符串，需求「API 通用约定」）。 */
export function salesMoney(minor: number, currency: CurrencyCode): { amount: string; currency: CurrencyCode } {
  return { amount: formatMajor(minor, currency), currency };
}
