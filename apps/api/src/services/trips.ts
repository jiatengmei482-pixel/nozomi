/**
 * AI 行程报价 P1 的编排接口（M9T-03，ADR 0101 第三节）：建行程单、读行程单和最近一次的方案、报价（编排 + 逐段报价 + 跨段费用 + 方案对比）。
 *
 * - 渠道是官网（`requireOpenSite`）：授权城市、品类、供应商名单、验收会话和官网询价完全一样；验收会话建的行程单只报 QA 测试供应商、只有验收会话看得到。
 * - 每一段直接调 `previewPlatformQuote`（试算，不写 `quotes`，P1b 下单前再逐段正式询价）；入参和官网询价逐项一致（渠道结算币种、`driverLanguage: null`、`vehicleGroupIds: []`）。
 * - 包车段的城市用官网的 `charterCityFor`，路线用 `itineraryRoute`（B2：只加了 export，函数体不变）；接送机报不出时照官网回落点对点（M8-33 / M8-35）。
 * - 预算：段报价最多 120 次、路线最多 200 次；超了按日期顺序把后面几天降级为「只报不拆」（`degraded`），连「不拆」都报不完才 422 `TRIP_TOO_COMPLEX`。
 * - 未覆盖需求照官网的条件记（每天各自取最低价的那组段、一个报价都没有、不是验收会话、不只是因为选短了；回落点对点的那次不记）。
 * - 对客应答不含结算价、加价比例、供应商编号。每次编排写一行结构化日志（不含坐标以外的个人信息）。
 */
import { randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  type BuildDay,
  type BuildProduct,
  type BuildSegment,
  type BuiltPlan,
  type ComparisonRefusal,
  type CurrencyCode,
  type LatLng,
  type LocalizedText,
  type PlaceType,
  type RouteUsage,
  type ServiceCategory,
  type SiteAudience,
  type SegmentPoint,
  type SellBreakdownItem,
  type TripFeeType,
  type TripItinerary,
  type TripOffer,
  type TripPlace,
  TRIP_BUDGET,
  addDays,
  budgetSplitOptions,
  buildTripPlans,
  channelScopeRefusal,
  cityBounds,
  dayPoints,
  daySplitOptions,
  effectiveTripRules,
  isPickupPlaceType,
  isPlaceIdPlace,
  minuteOfDay,
  pointTimes,
  pointToPointCityOf,
  quoteExpiresAt,
  rateLimitKeyOf,
  recognizeAirport,
  serviceCityOf,
  sellBreakdown,
  surchargeAreaIds,
  tripItineraryIssues,
} from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { withPlatformTx } from "../db/context.ts";
import { AppError } from "../errors.ts";
import { findQuotePlace } from "../repos/quotes.ts";
import { type AirportCandidateRow, listActiveCities, listAirportsNear } from "../repos/site.ts";
import { type StoredTripPlan, type TripFeeInsert, type TripPlanInsert, type TripRow, type TripSegmentInsert, findReadableTrip, insertTrip, listTripPlans, listTripRuleConfigs, replaceTripPlans } from "../repos/trips.ts";
import { type InputIssue, validationFailed } from "../validation.ts";
import type { BackgroundLog } from "./background.ts";
import { type PlatformQuoteInput, type PlatformQuotePreview, previewPlatformQuote } from "./quotes.ts";
import { type SalesQuoteInput, demandFacts } from "./sales-quotes.ts";
import { type SiteCity, type SiteWaypoint, charterCityFor, itineraryRoute, requireOpenSite, siteCities } from "./site.ts";
import { type DemandFacts, recordUncoveredDemandLater } from "./uncovered-demands.ts";

export const TRIP_RULES_API = {
  /** 行程单可读、可再报价多久（ADR 0101 第二节：建单 + 30 天；之后由 M9T-05 清理） */
  readableMs: 30 * 24 * 3_600_000,
} as const;

export const TRIP_ID = /^[A-Za-z0-9_-]{43}$/;

export const tripNotFound = (): AppError => new AppError(404, "TRIP_NOT_FOUND", "行程单不存在或已过期，请重新填写");
export const tripTooComplex = (): AppError => new AppError(422, "TRIP_TOO_COMPLEX", "行程太复杂，没法在线报价，请联系客服人工报价");

/** 编排日志（请求的日志） */
export interface TripLog extends BackgroundLog {
  info(details: object, message: string): void;
  warn(details: object, message: string): void;
}

export interface TripView {
  trip: TripRow;
  plans: StoredTripPlan[];
  /** 车型组的名称（方案里出现的） */
  vehicleGroups: Map<string, { id: string; code: string; name: LocalizedText; seats: number }>;
  areaNames: Map<string, LocalizedText>;
  degraded: boolean;
}

// ---- 建单、读单 ----

/** 建行程单：校验（zod 在路由、跨字段在 domain）、平台地点要存在且是启用的机场 / 车站，存为 draft */
export async function createTrip(ctx: AppContext, itinerary: TripItinerary, audience: SiteAudience): Promise<TripRow> {
  const { principal, channel } = await requireOpenSite(ctx);
  const issues: InputIssue[] = tripItineraryIssues(itinerary).map((issue) => ({ path: issue.path, reason: issue.reason, message: issueMessage(issue.reason) }));
  if (issues.length > 0) throw validationFailed("body", issues);
  const now = ctx.now();
  const row: Omit<TripRow, "status" | "updatedAt"> = {
    id: randomBytes(32).toString("base64url"),
    channelId: principal.channelId,
    itinerary,
    currency: channel.settleCurrency,
    isAcceptance: audience === "acceptance",
    createdAt: now,
    readableUntil: new Date(now.getTime() + TRIP_RULES_API.readableMs),
  };
  await withPlatformTx(ctx.pool, async (db) => {
    const placeIssues: InputIssue[] = [];
    for (const [d, day] of itinerary.days.entries()) {
      for (const [i, item] of day.items.entries()) {
        if (!isPlaceIdPlace(item.place)) continue;
        const place = await findQuotePlace(db, item.place.placeId);
        if (place === null || !place.active || !isPickupPlaceType(place.type as PlaceType)) placeIssues.push({ path: `/days/${d}/items/${i}/place/placeId`, reason: "UNKNOWN_PLACE", message: "地点不存在、已停用，或者不是机场 / 车站" });
      }
    }
    if (placeIssues.length > 0) throw validationFailed("body", placeIssues);
    await insertTrip(db, row);
  });
  return { ...row, status: "draft", updatedAt: now };
}

/** 读行程单和最近一次报价的方案：过期、不存在、别的渠道的、验收会话和普通客人互相看不到，一律 404 */
export async function getTrip(ctx: AppContext, id: string, audience: SiteAudience): Promise<TripView> {
  if (!TRIP_ID.test(id)) throw tripNotFound();
  const { principal } = await requireOpenSite(ctx);
  return withPlatformTx(
    ctx.pool,
    async (db) => {
      const trip = await findReadableTrip(db, id, principal.channelId, ctx.now());
      if (trip === null || trip.isAcceptance !== (audience === "acceptance")) throw tripNotFound();
      const plans = await listTripPlans(db, id);
      const groupIds = [...new Set(plans.flatMap((plan) => [plan.vehicleGroupId, ...plan.segments.map((segment) => segment.vehicleGroupId)]).filter((value): value is string => value !== null))];
      const groups = groupIds.length === 0 ? [] : (await db.query<{ id: string; code: string; name: LocalizedText; seats: number }>("select id, code, name, seats from vehicle_groups where id = any($1::uuid[])", [groupIds])).rows;
      const areaIds = [...new Set(plans.flatMap((plan) => plan.segments.flatMap((segment) => (segment.breakdown?.sell ?? []).flatMap((item) => (item.areaId === null ? [] : [item.areaId])))))];
      const areas = areaIds.length === 0 ? [] : (await db.query<{ id: string; name: LocalizedText }>("select id, name from areas where id = any($1::uuid[])", [areaIds])).rows;
      const degraded = plans.some((plan) => plan.warnings.some((warning) => warning.code === "DEGRADED"));
      return { trip, plans, vehicleGroups: new Map(groups.map((group) => [group.id, group])), areaNames: new Map(areas.map((area) => [area.id, area.name])), degraded };
    },
    { snapshot: true },
  );
}

// ---- 报价（编排） ----

interface ResolvedPoint extends LatLng {
  isAirport: boolean;
  isStation: boolean;
  isHotel: boolean;
  stayMinutes: number;
  /** 认出来的机场（平台地点或按坐标认的） */
  airport: { id: string; cityId: string } | null;
}

/** 一段的报价结果（同一对点、同一时间只报一次） */
interface SegmentQuote {
  offers: TripOffer[];
  reasons: string[];
  category: ServiceCategory | null;
  cityId: string | null;
  /** 报价的明细快照（写进 trip_segments.breakdown / fx），按报价对象查 */
  details: Map<TripOffer, { packageHours: number | null; sell: SellBreakdownItem[]; settlement: unknown; fx: unknown }>;
  /** 报出价的商品（跨段规则要的①区域、价格规则） */
  candidates: PlatformQuotePreview["candidates"];
  /** 第一次尝试（接送机）一个价都没有、该记未覆盖需求时的事实 */
  demand: DemandFacts | null;
}

interface Env {
  ctx: AppContext;
  channel: Awaited<ReturnType<typeof requireOpenSite>>["channel"];
  principal: Awaited<ReturnType<typeof requireOpenSite>>["principal"];
  audience: SiteAudience;
  itinerary: TripItinerary;
  firstDate: string;
  cache: Map<string, Promise<SegmentQuote>>;
  p2pCities: Promise<SiteCity[]> | null;
  segmentQuotes: number;
  routeCalls: number;
  log: TripLog;
}

const passengersOf = (itinerary: TripItinerary): number => itinerary.party.adults + itinerary.party.children;

/** 行程首日零点起的分钟 → 当地时间 `YYYY-MM-DDTHH:mm` */
function localAt(firstDate: string, minute: number): string {
  const day = Math.floor(minute / 1_440);
  const rest = minute - day * 1_440;
  return `${addDays(firstDate, day)}T${String(Math.floor(rest / 60)).padStart(2, "0")}:${String(rest % 60).padStart(2, "0")}`;
}

/** 两个日期相差几天 */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** 对外的报不出原因（同官网询价的口径，不透露供应商内部原因） */
const REASON_ORDER: readonly [ComparisonRefusal | "ROUTE_UNAVAILABLE", string][] = [
  ["CAPACITY_EXCEEDED", "CAPACITY_EXCEEDED"],
  ["ITINERARY_TOO_LONG", "ITINERARY_TOO_LONG"],
  ["WAYPOINT_NOT_PRICED", "WAYPOINT_NOT_PRICED"],
  ["OUT_OF_SERVICE_AREA", "OUT_OF_SERVICE_AREA"],
  ["IN_FORBIDDEN_AREA", "OUT_OF_SERVICE_AREA"],
  ["NO_PRICING_AREA", "OUT_OF_SERVICE_AREA"],
  ["LEAD_TIME_TOO_SHORT", "LEAD_TIME_TOO_SHORT"],
  ["SERVICE_TIME_PASSED", "SERVICE_TIME_PASSED"],
  ["SOLD_OUT", "SOLD_OUT"],
  ["URGENT_SOLD_OUT", "SOLD_OUT"],
  ["OUTSIDE_SERVICE_TIME", "OUTSIDE_SERVICE_TIME"],
  ["OUTSIDE_SALE_PERIOD", "OUTSIDE_SERVICE_TIME"],
  ["ADDON_NOT_OFFERED", "ADDON_NOT_OFFERED"],
  ["ROUTE_UNAVAILABLE", "ROUTE_UNAVAILABLE"],
];
const PACKAGE_REFUSALS: ReadonlySet<string> = new Set(["BELOW_MIN_PACKAGE", "PACKAGE_TOO_SHORT"]);

function reasonsOf(preview: PlatformQuotePreview): string[] {
  if (preview.candidates.length === 0) return ["NO_PRODUCT"];
  const refused = new Set<string>(preview.comparison.refused.map((entry) => entry.reason));
  const found = REASON_ORDER.filter(([raw]) => refused.has(raw)).map(([, out]) => out);
  return found.length === 0 ? ["NOT_AVAILABLE"] : [...new Set(found)];
}

/** 自动选档的包车没有客人选的时长：未覆盖需求按「行驶 + 停留」向上取整到小时记（1–72），同官网 sales-quotes 的 demandPackageHours */
const demandHours = (minutes: number): number => Math.min(72, Math.max(1, Math.ceil(minutes / 60)));

function emptyQuote(reason: string): SegmentQuote {
  return { offers: [], reasons: [reason], category: null, cityId: null, details: new Map(), candidates: [], demand: null };
}

/** 这一段用时（分钟）：包车 = 引擎的预计用时 T；接送机、点对点 = 免费等待 + 行驶（ADR 0101 第四节第 3 条；等待按引擎为这个方向选的那一项） */
function durationOf(type: BuildSegment["draft"]["type"], settlement: PlatformQuotePreview["comparison"]["groups"][number]["ranked"][number]["candidate"]["offer"]["settlement"], driveMinutes: number): number | null {
  if (type === "charter") return settlement.itinerary?.estimatedMinutes ?? settlement.itinerary?.routeMinutes ?? null;
  const wait = settlement.freeWait.value;
  const minutes = wait === null || wait.mode !== "limited" ? settlement.freeWait.platformMinimumMinutes : wait.minutes;
  return minutes + driveMinutes;
}

/** 比价结果 → 各租户各车型组的报价（`group.ranked[]`，名次 1 是中标）；客人选了车型组时只留那几个 */
function offersOf(preview: PlatformQuotePreview, type: BuildSegment["draft"]["type"], driveMinutes: number, vehicleGroupIds: readonly string[]): Pick<SegmentQuote, "offers" | "details"> {
  const offers: TripOffer[] = [];
  const details: SegmentQuote["details"] = new Map();
  for (const group of preview.comparison.groups) {
    if (vehicleGroupIds.length > 0 && !vehicleGroupIds.includes(group.vehicleGroupId)) continue;
    for (const ranked of group.ranked) {
      const c = ranked.candidate;
      const settlement = c.offer.settlement;
      const surcharge = settlement.areaSurcharge;
      const offer: TripOffer = {
        tenantId: c.tenantId,
        productId: c.productId,
        vehicleGroupId: group.vehicleGroupId,
        sellMinor: c.sellMinor,
        settlementMinor: settlement.totalMinor,
        winner: ranked.position === 1,
        settlementCurrency: settlement.currency,
        markupBp: c.sell.markupBp,
        fxBufferBp: c.sell.fxBufferBp,
        fx: c.sell.fx,
        durationMinutes: durationOf(type, settlement, driveMinutes),
        // 只取③上 / 下车加价（车往返基地的空驶，ADR 0101 第四节第 1 条）；「下车点行程加价」（M9P-01，waypoints 里 fromDropoff）是去那里的行程费，不是空驶，不抵
        surcharge: surcharge === undefined || surcharge === null ? null : { pickupMinor: surcharge.pickup.amountMinor, dropoffMinor: surcharge.dropoff.amountMinor },
        addons: settlement.addons.map((addon) => ({ addonId: addon.addonId, chargeUnit: addon.chargeUnit, amountMinor: addon.amountMinor })),
      };
      offers.push(offer);
      details.set(offer, { packageHours: c.offer.packageHours, sell: sellBreakdown(settlement, c.sell), settlement, fx: c.sell.fx });
    }
  }
  return { offers, details };
}

/** 报一段：按段型组装和官网询价一致的入参，调 `previewPlatformQuote`；城市不在授权里、找不到城市都按报不出算（不让整个行程失败） */
async function quoteSegment(env: Env, type: BuildSegment["draft"]["type"], points: readonly ResolvedPoint[], route: { meters: number; driveMinutes: number; stayMinutes: number; legs: { meters: number; minutes: number }[] }, serviceLocal: string): Promise<SegmentQuote> {
  const { ctx, channel, audience, itinerary } = env;
  const first = points[0] as ResolvedPoint;
  const last = points[points.length - 1] as ResolvedPoint;
  const ll = (p: LatLng): LatLng => ({ lat: p.lat, lng: p.lng });
  const base = {
    currency: channel.settleCurrency,
    channelId: channel.id,
    serviceLocal,
    passengers: passengersOf(itinerary),
    luggage: itinerary.party.luggage,
    addons: itinerary.preferences.addons.map((addon) => ({ addonId: addon.addonId, quantity: addon.quantity })),
    driverLanguage: null,
    vehicleGroupIds: [],
    assumeRoute: null,
  };
  const run = async (input: PlatformQuoteInput): Promise<PlatformQuotePreview | string> => {
    // 引擎调用的硬上限：段数已按预算裁过（最多 120 段），接送机报不出回落点对点时一段最多调两次，所以上限是 2 倍
    if (env.segmentQuotes >= 2 * TRIP_BUDGET.maxSegmentQuotes) {
      env.log.warn({ event: "trip.engine_call_cap", segment_quotes: env.segmentQuotes, category: input.category }, "行程报价的引擎调用到了上限，这一段按报不出处理");
      return "NOT_AVAILABLE";
    }
    env.segmentQuotes += 1;
    try {
      return await previewPlatformQuote(ctx, input, { fresh: false, ...(audience === "acceptance" ? { audience: "acceptance" as const } : {}) });
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      // 一段报不出不让整个行程失败，但要留痕：入参写错（400）等问题否则在日志里看不出来
      env.log.warn({ event: "trip.segment_quote_rejected", code: err.code, status: err.statusCode, segment_type: type, category: input.category }, "行程的一段询价被拒，按报不出处理");
      return err.code === "CHANNEL_SCOPE_DENIED" ? "OUT_OF_SERVICE_AREA" : "NOT_AVAILABLE";
    }
  };
  const settle = (preview: PlatformQuotePreview | string, category: ServiceCategory, cityId: string, demandInput: SalesQuoteInput | null): SegmentQuote => {
    if (typeof preview === "string") return { ...emptyQuote(preview), category, cityId };
    const { offers, details } = offersOf(preview, type, route.driveMinutes, itinerary.preferences.vehicleGroupIds);
    const onlyTooShort = preview.comparison.refused.length > 0 && preview.comparison.refused.every((entry) => PACKAGE_REFUSALS.has(entry.reason));
    const demand = preview.comparison.groups.length === 0 && demandInput !== null && audience === "public" && !onlyTooShort ? demandFacts(env.principal, demandInput, { pickup: demandInput.pickup as LatLng | null, dropoff: demandInput.dropoff as LatLng | null }, serviceLocal, preview) : null;
    return { offers, reasons: offers.length === 0 ? reasonsOf(preview) : [], category, cityId, details, candidates: preview.candidates, demand };
  };
  // 未覆盖需求的事实（同官网 createSalesQuotes 的入参；用车时刻 demandFacts 不用，填当前时刻）
  const salesInput = (input: PlatformQuoteInput): SalesQuoteInput => ({
    cityId: input.cityId,
    category: input.category,
    placeId: input.placeId,
    direction: input.direction,
    pickup: input.pickup,
    dropoff: input.dropoff,
    serviceTime: ctx.now(),
    packageHours: input.packageHours,
    passengers: input.passengers,
    luggage: input.luggage,
    addons: [...input.addons],
    driverLanguage: null,
    vehicleGroupIds: [],
    currency: input.currency,
    ...(input.routeUsage === undefined ? {} : { routeUsage: input.routeUsage }),
  });
  // 一个候选都没有（找不到城市）时照官网记一条城市为空 / 按点所在城市的未覆盖需求（siteQuotes、siteQuotesByPoints 的同一个口子）
  const noCandidate = (category: ServiceCategory, cityId: string | null, from: LatLng, to: LatLng, packageHours: number | null = null): DemandFacts => ({
    channelId: env.principal.channelId,
    category,
    direction: null,
    packageHours,
    cityId,
    airportId: null,
    pickup: from,
    dropoff: to,
    serviceLocal,
    passengers: base.passengers,
    luggage: base.luggage,
    vehicleGroupId: null,
    checked: ["pickup", "dropoff"],
    suppliers: [],
    candidateCount: 0,
    refusals: [],
  });
  const p2p = async (from: LatLng, to: LatLng, recordDemand: boolean): Promise<SegmentQuote> => {
    env.p2pCities ??= siteCities(ctx, audience).then((cities) => cities.filter((city) => city.categories.includes("point_to_point")));
    const city = pointToPointCityOf(from, to, await env.p2pCities);
    if (city === null) return { ...emptyQuote("OUT_OF_SERVICE_AREA"), demand: recordDemand ? noCandidate("point_to_point", null, from, to) : null };
    const input: PlatformQuoteInput = { ...base, cityId: city.id, category: "point_to_point", placeId: null, pickup: from, dropoff: to, direction: null, packageHours: null };
    return settle(await run(input), "point_to_point", city.id, recordDemand ? salesInput(input) : null);
  };

  if (type === "charter") {
    const match = await charterCityFor(ctx, channel, audience, { pickup: ll(first), dropoff: ll(last) }, null);
    if (match.chosen === null) return { ...emptyQuote("OUT_OF_SERVICE_AREA"), demand: noCandidate("charter", serviceCityOf(ll(first), match.cities)?.id ?? null, ll(first), ll(last), demandHours(route.driveMinutes + route.stayMinutes)) };
    const waypoints: SiteWaypoint[] = points.slice(1, -1).map((p) => ({ name: "", lat: p.lat, lng: p.lng, stay_minutes: p.stayMinutes }));
    const routeUsage: RouteUsage = { meters: route.meters, minutes: route.driveMinutes + route.stayMinutes, legs: route.legs, stayMinutes: route.stayMinutes };
    const input: PlatformQuoteInput = { ...base, cityId: match.chosen.cityId, category: "charter", placeId: null, pickup: ll(first), dropoff: ll(last), direction: null, packageHours: null, waypoints, routeUsage, charterSelection: "auto" };
    return settle(await run(input), "charter", match.chosen.cityId, salesInput(input));
  }
  if (type === "p2p") return p2p(ll(first), ll(last), true);
  // 接机 / 送机：机场那一端用平台地点；一个价都报不出时照官网回落点对点（回落的那次不记未覆盖需求）
  const pickup = type === "airport_pickup";
  const airport = (pickup ? first.airport : last.airport) as { id: string; cityId: string };
  const address = ll(pickup ? last : first);
  const input: PlatformQuoteInput = { ...base, cityId: airport.cityId, category: "airport_transfer", placeId: airport.id, pickup: pickup ? null : address, dropoff: pickup ? address : null, direction: pickup ? "pickup" : "dropoff", packageHours: null };
  const primary = settle(await run(input), "airport_transfer", airport.cityId, salesInput(input));
  if (primary.offers.length > 0) return primary;
  const fallback = await p2p(ll(first), ll(last), false);
  return fallback.offers.length > 0 ? { ...fallback, demand: primary.demand } : { ...primary };
}

/** 平台地点 → 坐标和类型；坐标 → 按官网规则认机场（3 公里，或地址说是机场时 10 公里） */
async function resolvePoints(ctx: AppContext, env: Env): Promise<{ days: (ResolvedPoint[] | null)[] }> {
  const { itinerary, channel } = env;
  return withPlatformTx(
    ctx.pool,
    async (db) => {
      const coords = itinerary.days.flatMap((day) => dayPoints(day).flatMap((point) => (isPlaceIdPlace(point.place) ? [] : [point.place])));
      const active = await listActiveCities(db, channel.scope.cityIds);
      const transferCities = active.filter((city) => channelScopeRefusal(channel.scope, city.id, "airport_transfer") === null).map((city) => city.id);
      const airports: AirportCandidateRow[] = coords.length === 0 ? [] : await listAirportsNear(db, transferCities, coords.map((point) => cityBounds(point, 15)));
      const places = new Map<string, Awaited<ReturnType<typeof findQuotePlace>>>();
      const resolve = async (place: TripPlace, stayMinutes: number): Promise<ResolvedPoint> => {
        if (isPlaceIdPlace(place)) {
          if (!places.has(place.placeId)) places.set(place.placeId, await findQuotePlace(db, place.placeId));
          const found = places.get(place.placeId) ?? null;
          if (found === null || !found.active || found.cityId === null) throw validationFailed("body", [{ path: "/days", reason: "UNKNOWN_PLACE", message: "行程里的机场 / 车站已停用，请重新选择" }]);
          return { lat: found.location.lat, lng: found.location.lng, isAirport: found.type === "airport", isStation: found.type === "station", isHotel: false, stayMinutes, airport: found.type === "airport" ? { id: found.id, cityId: found.cityId } : null };
        }
        const match = recognizeAirport({ lat: place.lat, lng: place.lng, kind: null }, airports);
        return { lat: place.lat, lng: place.lng, isAirport: match !== null, isStation: false, isHotel: place.kind === "hotel", stayMinutes, airport: match === null ? null : { id: match.airport.id, cityId: match.airport.cityId } };
      };
      const days: (ResolvedPoint[] | null)[] = [];
      for (const day of itinerary.days) {
        const points = dayPoints(day);
        if (points.length === 0) days.push(null);
        else days.push(await Promise.all(points.map((point) => resolve(point.place, point.stayMinutes))));
      }
      return { days };
    },
    { snapshot: true },
  );
}

/** 跨段规则要的商品信息：报价结果里的候选商品 + 保存的规则配置（`byArea` 再按本商品现有的区域过滤一次） */
async function productsOf(ctx: AppContext, quotes: readonly SegmentQuote[]): Promise<(productId: string) => BuildProduct | null> {
  const candidates = new Map(quotes.flatMap((quote) => quote.candidates.map((candidate) => [candidate.product.productId, candidate] as const)));
  const cityOf = new Map(quotes.flatMap((quote) => quote.candidates.map((candidate) => [candidate.product.productId, quote.cityId] as const)));
  const configs = await withPlatformTx(ctx.pool, (db) => listTripRuleConfigs(db, [...candidates.keys()]), { snapshot: true });
  const cache = new Map<string, BuildProduct>();
  return (productId) => {
    const hit = cache.get(productId);
    if (hit !== undefined) return hit;
    const candidate = candidates.get(productId);
    if (candidate === undefined) return null;
    const { product } = candidate;
    const saved = configs.get(productId);
    const rules = effectiveTripRules(saved?.config ?? null, product.currency);
    const areaIds = new Set([...product.areas.map((area) => area.areaId), ...surchargeAreaIds(product.priceRules)]);
    const built: BuildProduct = { areas: product.areas, surchargeAreas: product.surchargeAreas ?? [], cityId: cityOf.get(productId) ?? null, rules: { ...rules, lodging: { ...rules.lodging, byArea: rules.lodging.byArea.filter((entry) => areaIds.has(entry.areaId)) } }, ruleVersion: saved?.version ?? 0, priceRules: product.priceRules };
    cache.set(productId, built);
    return built;
  };
}

const FEE_LABELS: Record<TripFeeType, (night: number | null, day: number | null) => LocalizedText> = {
  lodging: (n) => ({ zh: `司机住宿费（第 ${(n ?? 0) + 1} 晚）`, en: `Driver lodging (night ${(n ?? 0) + 1})`, ja: `ドライバー宿泊費（${(n ?? 0) + 1}泊目）` }),
  lodging_offset: (n) => ({ zh: `住宿抵扣空驶费（第 ${(n ?? 0) + 1} 晚）`, en: `Deadhead offset (night ${(n ?? 0) + 1})`, ja: `回送料相殺（${(n ?? 0) + 1}泊目）` }),
  idle: (_n, d) => ({ zh: `车辆停驻费（第 ${(d ?? 0) + 1} 天）`, en: `Vehicle standby (day ${(d ?? 0) + 1})`, ja: `車両待機料（${(d ?? 0) + 1}日目）` }),
  second_driver: (_n, d) => ({ zh: `第二司机（第 ${(d ?? 0) + 1} 天）`, en: `Second driver (day ${(d ?? 0) + 1})`, ja: `交代ドライバー（${(d ?? 0) + 1}日目）` }),
  bundle_discount: (_n, d) => ({ zh: `附加服务同车免重复收费（第 ${(d ?? 0) + 1} 天）`, en: `Add-on bundle discount (day ${(d ?? 0) + 1})`, ja: `付帯サービス重複割引（${(d ?? 0) + 1}日目）` }),
  return: () => ({ zh: "长途返程费", en: "Return trip", ja: "長距離回送料" }),
};

/**
 * 报价：编排 + 分段报价 + 跨段费用 + 方案对比，在一个平台事务里重写这一行程的方案。返回和 `GET` 同一份视图（另带 `degraded`）。
 */
export async function quoteTrip(ctx: AppContext, id: string, options: { audience: SiteAudience; ip: string; log: TripLog }): Promise<TripView> {
  const started = performance.now();
  if (!TRIP_ID.test(id)) throw tripNotFound();
  const { principal, channel } = await requireOpenSite(ctx);
  const trip = await withPlatformTx(ctx.pool, (db) => findReadableTrip(db, id, principal.channelId, ctx.now()), { snapshot: true });
  if (trip === null || trip.isAcceptance !== (options.audience === "acceptance")) throw tripNotFound();
  const itinerary = trip.itinerary;
  const firstDate = (itinerary.days[0] as TripItinerary["days"][number]).date;
  const env: Env = { ctx, channel, principal, audience: options.audience, itinerary, firstDate, cache: new Map(), p2pCities: null, segmentQuotes: 0, routeCalls: 0, log: options.log };
  const resolved = await resolvePoints(ctx, env);

  // 1. 逐天估路线、推算各点时间、列拆法
  interface DayPlan {
    dayIndex: number;
    points: ResolvedPoint[] | null;
    legs: { meters: number; minutes: number }[];
    depart: number[];
    arrive: number[];
    options: ReturnType<typeof daySplitOptions>;
    reason: string | null;
  }
  const dayPlans: DayPlan[] = [];
  for (const [dayIndex, day] of itinerary.days.entries()) {
    const points = resolved.days[dayIndex] ?? null;
    if (points === null) {
      dayPlans.push({ dayIndex, points: null, legs: [], depart: [], arrive: [], options: [], reason: null });
      continue;
    }
    const startMinute = daysBetween(firstDate, day.date) * 1_440 + (minuteOfDay((day.items[0] as { time?: string }).time ?? "00:00") ?? 0);
    if (env.routeCalls + points.length - 1 > TRIP_BUDGET.maxRouteCalls) throw tripTooComplex();
    env.routeCalls += points.length - 1;
    let legs: { meters: number; minutes: number }[];
    try {
      const first = points[0] as ResolvedPoint;
      const last = points[points.length - 1] as ResolvedPoint;
      const route = await itineraryRoute(ctx, { category: "charter_itinerary", pickup: { lat: first.lat, lng: first.lng }, dropoff: { lat: last.lat, lng: last.lng }, waypoints: points.slice(1, -1).map((p) => ({ name: "", lat: p.lat, lng: p.lng, stay_minutes: p.stayMinutes })) });
      legs = route.legs.map((leg) => ({ meters: leg.meters, minutes: leg.minutes }));
    } catch (err) {
      if (err instanceof AppError && err.code === "ITINERARY_ROUTE_UNAVAILABLE") {
        dayPlans.push({ dayIndex, points, legs: [], depart: [], arrive: [], options: [], reason: "ROUTE_UNAVAILABLE" });
        continue;
      }
      throw err;
    }
    const times = pointTimes(startMinute, legs.map((leg) => leg.minutes), points.map((p) => p.stayMinutes));
    const segmentPoints: SegmentPoint[] = points.map((p, i) => ({ isAirport: p.isAirport, isStation: p.isStation, isHotel: p.isHotel, stayMinutes: i === 0 || i === points.length - 1 ? 0 : p.stayMinutes }));
    dayPlans.push({ dayIndex, points, legs, depart: times.depart, arrive: times.arrive, options: daySplitOptions(segmentPoints), reason: null });
  }

  // 2. 预算：按日期顺序，剩余不够时后面几天只报「不拆」
  const budget = budgetSplitOptions(dayPlans.map((plan) => plan.options.map((option) => option.segments.length)));
  if (budget === null) throw tripTooComplex();
  for (const [i, plan] of dayPlans.entries()) plan.options = plan.options.slice(0, budget.keep[i] ?? 1);

  // 3. 逐段报价（同一对点同一时间只报一次）
  const buildDays: BuildDay[] = [];
  const segmentQuotes = new Map<BuildSegment, SegmentQuote>();
  for (const plan of dayPlans) {
    const day = itinerary.days[plan.dayIndex] as TripItinerary["days"][number];
    const nightAt = day.nightAt ?? null;
    const points = plan.points;
    const options = await Promise.all(
      plan.options.map(async (option) => ({
        segments: await Promise.all(
          option.segments.map(async (draft): Promise<BuildSegment> => {
            const pts = (points as ResolvedPoint[]).slice(draft.from, draft.to + 1);
            const legs = plan.legs.slice(draft.from, draft.to);
            const stayMinutes = pts.slice(1, -1).reduce((sum, p) => sum + p.stayMinutes, 0);
            const driveMinutes = legs.reduce((sum, leg) => sum + leg.minutes, 0);
            const meters = legs.reduce((sum, leg) => sum + leg.meters, 0);
            const startMinute = plan.depart[draft.from] as number;
            const serviceLocal = localAt(firstDate, startMinute);
            const key = JSON.stringify([draft.type, pts.map((p) => [p.lat, p.lng, p.stayMinutes]), serviceLocal]);
            let pending = env.cache.get(key);
            if (pending === undefined) {
              pending = quoteSegment(env, draft.type, pts, { meters, driveMinutes, stayMinutes, legs }, serviceLocal);
              env.cache.set(key, pending);
            }
            const quote = await pending;
            const built: BuildSegment = { draft, offers: quote.offers, route: { startMinute, routeMinutes: (plan.arrive[draft.to] as number) - startMinute, driveMinutes, meters }, startPoint: { lat: (pts[0] as ResolvedPoint).lat, lng: (pts[0] as ResolvedPoint).lng }, endPoint: { lat: (pts[pts.length - 1] as ResolvedPoint).lat, lng: (pts[pts.length - 1] as ResolvedPoint).lng }, reasons: quote.reasons };
            segmentQuotes.set(built, quote);
            return built;
          }),
        ),
      })),
    );
    const first = points?.[0] ?? null;
    const last = points?.[points.length - 1] ?? null;
    buildDays.push({
      dayIndex: plan.dayIndex,
      date: day.date,
      options,
      used: points !== null,
      startPoint: first === null ? null : { lat: first.lat, lng: first.lng },
      endPoint: last === null ? null : { lat: last.lat, lng: last.lng },
      nightAt: nightAt === null ? null : { lat: nightAt.lat, lng: nightAt.lng },
      lodgingProvided: day.driverLodgingProvided === true,
      reason: plan.reason,
    });
  }

  // 4. 组方案、算跨段费用
  const product = await productsOf(ctx, [...new Set(segmentQuotes.values())]);
  const result = buildTripPlans({ currency: channel.settleCurrency as CurrencyCode, days: buildDays, product });

  // 5. 未覆盖需求：每天各自取最低价的那组段（报不出的一天看「不拆」）里一个报价都没有的段，每次编排同一段只记一次
  if (options.audience === "public") {
    const recorded = new Set<SegmentQuote>();
    const reference = result.plans.find((plan) => plan.kind === "daily_best") ?? result.plans.find((plan) => plan.kind === "one_car");
    for (const day of buildDays) {
      if (day.options.length === 0) continue;
      const chosen = reference?.days.find((entry) => entry.dayIndex === day.dayIndex);
      const option = day.options[chosen?.optionIndex ?? 0];
      for (const segment of option?.segments ?? []) {
        const quote = segmentQuotes.get(segment);
        if (quote === undefined || quote.demand === null || recorded.has(quote) || (chosen !== undefined && segment.offers.length > 0)) continue;
        recorded.add(quote);
        recordUncoveredDemandLater(ctx, { channelKind: "site", sourceKey: rateLimitKeyOf(options.ip), pickupName: null, dropoffName: null, log: options.log }, quote.demand);
      }
    }
  }

  // 6. 一个事务里重写方案
  const now = ctx.now();
  const expiresAt = quoteExpiresAt(now);
  const inserts: TripPlanInsert[] = result.plans.map((plan, seq) => planInsert(plan, seq, { buildDays, segmentQuotes, firstDate, currency: channel.settleCurrency, expiresAt, degraded: budget.degraded }));
  await withPlatformTx(ctx.pool, async (db) => {
    const locked = await findReadableTrip(db, id, principal.channelId, now, { lock: true });
    if (locked === null) throw tripNotFound();
    await replaceTripPlans(db, id, inserts, now);
  });
  options.log.info(
    {
      event: "trip.quoted",
      trip_id: id,
      days: itinerary.days.length,
      segment_quotes: env.segmentQuotes,
      route_calls: env.routeCalls,
      degraded: budget.degraded,
      duration_ms: Math.round(performance.now() - started),
      plans: result.plans.map((plan) => ({ kind: plan.kind, status: plan.sellMinor === null ? "unquoted" : "quoted", unquoted: plan.unquoted })),
    },
    "行程报价完成",
  );
  return getTrip(ctx, id, options.audience);
}

function planInsert(plan: BuiltPlan, seq: number, ctx: { buildDays: readonly BuildDay[]; segmentQuotes: ReadonlyMap<BuildSegment, SegmentQuote>; firstDate: string; currency: string; expiresAt: Date; degraded: boolean }): TripPlanInsert {
  const quoted = plan.sellMinor !== null;
  const segments: TripSegmentInsert[] = [];
  const byIndex = new Map(ctx.buildDays.map((day) => [day.dayIndex, day]));
  const usedIndexes = plan.days.map((day) => day.dayIndex);
  const firstUsed = Math.min(...usedIndexes);
  const lastUsed = Math.max(...usedIndexes);
  for (const day of ctx.buildDays) {
    const chosen = plan.days.find((entry) => entry.dayIndex === day.dayIndex);
    if (chosen === undefined) {
      // 一车到底里两个用车日之间的空闲日（车停在当地或回基地）
      if (plan.kind === "one_car" && plan.days.length > 0 && !day.used && day.dayIndex > firstUsed && day.dayIndex < lastUsed) {
        segments.push({ dayIndex: day.dayIndex, serviceDate: day.date, segmentType: "idle_day", startLocal: null, endLocal: null, points: [], category: null, cityId: null, productId: null, supplierTenantId: null, vehicleGroupId: null, packageHours: null, settlementMinor: null, settlementCurrency: null, sellMinor: null, markupBp: null, fx: null, breakdown: null, route: null, otherVehicle: false });
      }
      continue;
    }
    const option = (byIndex.get(day.dayIndex) as BuildDay).options[chosen.optionIndex] as { segments: readonly BuildSegment[] };
    for (const [i, segment] of chosen.segments.entries()) {
      const built = option.segments[i] as BuildSegment;
      const quote = ctx.segmentQuotes.get(built) as SegmentQuote;
      const detail = quote.details.get(segment.offer);
      const end = built.route.startMinute + (segment.offer.durationMinutes ?? built.route.routeMinutes);
      const startLocal = localAt(ctx.firstDate, built.route.startMinute);
      segments.push({
        dayIndex: day.dayIndex,
        // 用车日期按这一段的开始时刻（前一段跨过零点时是次日）
        serviceDate: startLocal.slice(0, 10),
        segmentType: segment.draft.type,
        startLocal,
        endLocal: localAt(ctx.firstDate, end),
        points: [built.startPoint, built.endPoint],
        category: quote.category,
        cityId: quote.cityId,
        productId: segment.offer.productId,
        supplierTenantId: segment.offer.tenantId,
        vehicleGroupId: segment.offer.vehicleGroupId,
        packageHours: detail?.packageHours ?? null,
        settlementMinor: segment.offer.settlementMinor,
        settlementCurrency: segment.offer.settlementCurrency,
        sellMinor: segment.offer.sellMinor,
        markupBp: segment.offer.markupBp,
        fx: detail?.fx ?? null,
        breakdown: detail === undefined ? null : { sell: detail.sell, settlement: detail.settlement },
        route: { meters: built.route.meters, minutes: built.route.routeMinutes, drive_minutes: built.route.driveMinutes, stay_minutes: built.route.routeMinutes - built.route.driveMinutes },
        otherVehicle: chosen.otherVehicle,
      });
    }
  }
  const fees: TripFeeInsert[] = plan.fees.map((fee) => ({
    feeType: fee.type,
    supplierTenantId: fee.tenantId,
    productId: fee.productId,
    ruleVersion: fee.ruleVersion,
    settlementMinor: fee.settlementMinor,
    settlementCurrency: fee.settlementCurrency,
    sellMinor: fee.sellMinor,
    nightIndex: fee.nightIndex,
    dayIndex: fee.dayIndex,
    areaId: fee.areaId,
    label: FEE_LABELS[fee.type](fee.nightIndex, fee.dayIndex),
    calc: fee.calc,
  }));
  return {
    seq,
    kind: plan.kind,
    recommended: plan.recommended,
    supplierTenantId: plan.tenantId,
    vehicleGroupId: plan.vehicleGroupId,
    status: quoted ? "quoted" : "unquoted",
    sellMinor: plan.sellMinor,
    settlementMinor: plan.settlementMinor,
    currency: ctx.currency,
    unquoted: plan.unquoted.map((entry) => ({ day_index: entry.dayIndex, reason: entry.reason })),
    warnings: [...plan.warnings.map((warning) => ({ code: warning.code, day_index: warning.dayIndex as number | null })), ...(ctx.degraded ? [{ code: "DEGRADED", day_index: null }] : [])],
    expiresAt: quoted ? ctx.expiresAt : null,
    segments: quoted ? segments : [],
    fees: quoted ? fees : [],
  };
}

function issueMessage(reason: string): string {
  switch (reason) {
    case "REQUIRED":
      return "必填";
    case "OUT_OF_RANGE":
      return "超出范围";
    case "NOT_ASCENDING":
      return "日期要按先后排、不能重复";
    case "NOT_CONSECUTIVE":
      return "日期要连续，不用车的那天写成空闲日（items 为空）";
    case "FIRST_DAY_IDLE":
    case "LAST_DAY_IDLE":
      return "第一天和最后一天要用车";
    case "MUST_START_WITH_START":
      return "每天第一个点是出发点（start 或 arrive_flight）";
    case "TIME_REQUIRED":
      return "出发点要写时间 HH:MM";
    case "TIME_NOT_ALLOWED":
      return "只有出发点写时间，后面各点的时间由服务器按路线推算";
    case "END_NOT_LAST":
      return "终点只能是最后一个点";
    case "STAY_NOT_ALLOWED":
      return "只有经停点能写停留分钟";
    case "TOO_FEW_POINTS":
      return "一天至少要两个点（或写当晚过夜点）";
    case "DUPLICATE":
      return "重复";
    default:
      return "格式不对";
  }
}
