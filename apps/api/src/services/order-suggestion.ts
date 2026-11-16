/**
 * 包车经停顺序建议（M9P-20 P2，ADR 0096 第三节）：`POST /site/v1/charter/order-suggestion` 的业务。
 *
 * 1. 请求必须带一份可核对的当前顺序询价：有效的报价编号（`quote_id`），或当前顺序一家都没报出、至少一家因超长报不出时的询价日志编号（`inquiry_ref`）；
 *    经停点集合、上下车点要和它一致，否则 400 `SUGGESTION_NEEDS_QUOTE`，不调谷歌。
 * 2. 这次上下车点匹配到的商品全关了「经停顺序建议」→ 不调谷歌（`DISABLED`）。
 * 3. 按固定点（上下车点、带指定到达时间 `arrive_by` 的经停，P3）切段；每段 ≥ 2 个可动经停才问谷歌（`NOT_APPLICABLE`）；顺序无关的缓存命中就不调谷歌（`OrderOptimizer`）。
 * 4. 用现有逐段估算（报价同一口径）算两种顺序的行驶米数、分钟，按阈值判断（超长申请的不看阈值）。
 * 5. 成立才多算一次报价（和普通询价同一套，写询价日志）；关了开关的商品的卡片不带建议价。
 * 只存顺序，不存报价：其他字段变了页面重调，服务器按缓存的顺序重算，不再调谷歌优化。
 */
import {
  type LatLng,
  type SuggestionStop,
  charterItineraryOf,
  judgeSuggestion,
  quoteSnapshotValid,
  refsInOrder,
  reorderByRefs,
  sameStopSet,
  segmentsToOptimize,
  suggestedOrder,
  suggestionRequestKey,
  suggestionSegments,
  suggestionStopsOf,
} from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { withPlatformTx } from "../db/context.ts";
import { AppError } from "../errors.ts";
import { type SiteItinerary, type SiteQuoteInput, type SiteQuoteResult, type SiteTrip, charterCityFor, itineraryRoute, requireOpenSite, siteQuotes } from "./site.ts";

type ItineraryTrip = Extract<SiteTrip, { category: "charter_itinerary" }>;

export interface OrderSuggestionInput {
  quote: SiteQuoteInput & { trip: ItineraryTrip };
  /** 每个经停的不透明标识（和 `trip.waypoints` 一一对应）：只在请求、应答之间往返，不进请求键、快照、订单 */
  refs: string[];
  quoteId: string | null;
  inquiryRef: string | null;
  /** 真要调谷歌优化之前占会话、地址的额度；不放行返回 false */
  beforeGoogle: () => Promise<boolean>;
}

export type OrderSuggestionReason = "NOT_APPLICABLE" | "DISABLED" | "UNAVAILABLE" | "RATE_LIMITED" | "NO_ROUTE" | "SAME_ORDER" | "BELOW_THRESHOLD" | "NO_QUOTE";

export interface OrderSuggestion {
  /** 按建议顺序排的经停标识 */
  order: string[];
  /** 和请求时的当前顺序比，省的行驶米数、分钟（负数 = 变差，在容差里） */
  savedMeters: number;
  savedMinutes: number;
  /** 当前顺序、建议顺序的逐段路线（报价同一口径）：页面拖动后按新的当前路线重算省多少 */
  currentItinerary: SiteItinerary;
  itinerary: SiteItinerary;
  /** 除经停顺序外全部询价字段的摘要：「一键采用」时页面核对 */
  requestKey: string;
  /** 阈值（页面拖动后重算用同一个判断） */
  thresholds: { minSavedMeters: number; minSavedMinutes: number };
  /** 当前顺序因超长报不出、用询价日志申请的（不看阈值，页面不写省多少钱） */
  currentTooLong: boolean;
  quoteResult: SiteQuoteResult;
}

export type OrderSuggestionResult = { suggestion: OrderSuggestion } | { suggestion: null; reason: OrderSuggestionReason };

const needsQuote = (message: string): AppError => new AppError(400, "SUGGESTION_NEEDS_QUOTE", message);

/** 询价日志编号多久以内能拿来申请（和报价有效期一样 30 分钟） */
const INQUIRY_REF_TTL_MS = 30 * 60_000;

const sameEnds = (a: { pickup: LatLng; dropoff: LatLng }, b: { pickup?: LatLng | null; dropoff?: LatLng | null }): boolean =>
  b.pickup != null && b.dropoff != null && sameStopSet([a.pickup], [b.pickup]) && sameStopSet([a.dropoff], [b.dropoff]);

/** 核对请求带的当前顺序询价；返回当前顺序是不是因超长报不出（用询价日志申请）。 */
async function verifyBasis(ctx: AppContext, channelId: string, acceptance: boolean, input: OrderSuggestionInput): Promise<{ tooLong: boolean }> {
  const trip = input.quote.trip;
  const stops = trip.waypoints.map((stop) => ({ lat: stop.lat, lng: stop.lng }));
  const now = ctx.now();
  if (input.quoteId !== null) {
    const row = (await withPlatformTx(ctx.pool, (db) => db.query<{ snapshot: { expiresAt: string; request: { pickup?: LatLng | null; dropoff?: LatLng | null; waypoints?: LatLng[] } } }>("select snapshot from quotes where id = $1 and channel_id = $2 and is_acceptance = $3", [input.quoteId, channelId, acceptance]))).rows[0];
    if (row === undefined || !quoteSnapshotValid(row.snapshot, now)) throw needsQuote("报价不存在或已过期，请重新询价后再申请建议顺序");
    const request = row.snapshot.request;
    if (!sameEnds(trip, request) || !sameStopSet(stops, request.waypoints ?? [])) throw needsQuote("经停点和报价对不上，请重新询价后再申请建议顺序");
    return { tooLong: false };
  }
  if (input.inquiryRef !== null) {
    const row = (
      await withPlatformTx(ctx.pool, (db) =>
        db.query<{ created_at: Date; quote_count: number; rejects: { reason: string }[]; request: { pickup?: LatLng | null; dropoff?: LatLng | null; waypoints?: LatLng[] } }>(
          "select created_at, quote_count, rejects, request from quote_logs where id = $1 and channel_id = $2 and is_acceptance = $3",
          [input.inquiryRef, channelId, acceptance],
        ),
      )
    ).rows[0];
    const fresh = row !== undefined && now.getTime() - row.created_at.getTime() <= INQUIRY_REF_TTL_MS;
    if (row === undefined || !fresh || row.quote_count !== 0 || !row.rejects.some((reject) => reject.reason === "ITINERARY_TOO_LONG")) throw needsQuote("这次询价不能用来申请建议顺序，请重新询价");
    if (!sameEnds(trip, row.request) || !sameStopSet(stops, row.request.waypoints ?? [])) throw needsQuote("经停点和询价对不上，请重新询价后再申请建议顺序");
    return { tooLong: true };
  }
  throw needsQuote("请先询价，再申请建议顺序");
}

/** 哪些商品开着「经停顺序建议」（没设过的按默认开）。 */
async function enabledProducts(ctx: AppContext, productIds: readonly string[]): Promise<Set<string>> {
  if (productIds.length === 0) return new Set();
  const rows = await withPlatformTx(ctx.pool, (db) => db.query<{ id: string; service_rules: { charterItinerary?: Record<string, unknown> } }>("select id, service_rules from products where id = any($1::uuid[])", [productIds]), { snapshot: true });
  return new Set(rows.rows.filter((row) => charterItineraryOf(row.service_rules as never).suggestStopOrder).map((row) => row.id));
}

/** 报价卡片按中标商品的开关过滤（关了的商品不带建议价）。 */
async function quotesOfEnabled(ctx: AppContext, result: SiteQuoteResult): Promise<SiteQuoteResult> {
  if (result.quotes.length === 0) return result;
  const rows = await withPlatformTx(ctx.pool, (db) => db.query<{ id: string; product_id: string }>("select id, product_id from quotes where id = any($1::text[])", [result.quotes.map((quote) => quote.quoteId)]));
  const productOf = new Map(rows.rows.map((row) => [row.id, row.product_id]));
  const enabled = await enabledProducts(ctx, [...new Set(rows.rows.map((row) => row.product_id))]);
  return { ...result, quotes: result.quotes.filter((quote) => enabled.has(productOf.get(quote.quoteId) ?? "")) };
}

async function routeOrNull(ctx: AppContext, trip: ItineraryTrip): Promise<SiteItinerary | null> {
  try {
    return await itineraryRoute(ctx, trip);
  } catch (err) {
    if (err instanceof AppError && err.code === "ITINERARY_ROUTE_UNAVAILABLE") return null;
    throw err;
  }
}

export async function siteOrderSuggestion(ctx: AppContext, input: OrderSuggestionInput): Promise<OrderSuggestionResult> {
  const { principal, channel } = await requireOpenSite(ctx);
  const trip = input.quote.trip;
  const audience = input.quote.audience ?? "public";
  if (input.refs.length !== trip.waypoints.length || new Set(input.refs).size !== input.refs.length) throw new AppError(400, "VALIDATION_FAILED", "每个经停点要有一个不重复的标识", { location: "body", issues: [{ path: "/refs", message: "个数和经停点一样、不重复" }] });
  const { tooLong } = await verifyBasis(ctx, principal.channelId, audience === "acceptance", input);

  const match = await charterCityFor(ctx, channel, audience, { pickup: trip.pickup, dropoff: trip.dropoff }, input.quote.cityId);
  if (match.productIds.length > 0 && (await enabledProducts(ctx, match.productIds)).size === 0) return { suggestion: null, reason: "DISABLED" };

  // 带指定到达时间（arrive_by，P3）的经停是固定点：不参与重排，把行程切成几段，每段的可动经停只在段内重排
  const stops: (SuggestionStop & { index: number })[] = suggestionStopsOf(trip.waypoints, input.refs);
  const segments = suggestionSegments(trip.pickup, stops, trip.dropoff);
  const toOptimize = segmentsToOptimize(segments);
  if (toOptimize.length === 0) return { suggestion: null, reason: "NOT_APPLICABLE" };
  const outcome = await ctx.orderOptimizer.optimize(toOptimize, { beforeGoogle: input.beforeGoogle });
  if (!outcome.ok) return { suggestion: null, reason: outcome.reason };

  const segmentOrders = new Map<number, string[]>();
  for (const [position, segment] of toOptimize.entries()) {
    const refs = refsInOrder(segment.movable, outcome.orders[position] ?? []);
    if (refs === null) return { suggestion: null, reason: "UNAVAILABLE" };
    segmentOrders.set(segments.indexOf(segment), refs);
  }
  const order = suggestedOrder(stops, segmentOrders);
  if (order.every((ref, index) => ref === input.refs[index])) return { suggestion: null, reason: "SAME_ORDER" };
  const reordered = reorderByRefs(stops, order);
  if (reordered === null) return { suggestion: null, reason: "UNAVAILABLE" };
  const suggestedTrip: ItineraryTrip = { ...trip, waypoints: reordered.map((stop) => trip.waypoints[stop.index] as ItineraryTrip["waypoints"][number]) };

  const [current, suggested] = await Promise.all([routeOrNull(ctx, trip), routeOrNull(ctx, suggestedTrip)]);
  if (current === null || suggested === null) return { suggestion: null, reason: "UNAVAILABLE" };
  const thresholds = { minSavedMeters: ctx.config.orderSuggestion.minSavedMeters, minSavedMinutes: ctx.config.orderSuggestion.minSavedMinutes };
  const verdict = judgeSuggestion({ meters: current.totalMeters, minutes: current.driveMinutes }, { meters: suggested.totalMeters, minutes: suggested.driveMinutes }, thresholds);
  if (!tooLong && !verdict.ok) return { suggestion: null, reason: "BELOW_THRESHOLD" };

  const { demand: _demand, ...quoteInput } = input.quote;
  const quoteResult = await quotesOfEnabled(ctx, await siteQuotes(ctx, { ...quoteInput, trip: suggestedTrip }, { order_suggestion: true }));
  if (quoteResult.quotes.length === 0) return { suggestion: null, reason: "NO_QUOTE" };
  const requestKey = suggestionRequestKey({
    pickup: trip.pickup,
    dropoff: trip.dropoff,
    waypoints: trip.waypoints,
    service_local: input.quote.serviceLocal,
    passengers: input.quote.passengers,
    luggage: input.quote.luggage,
    addons: input.quote.addons.map((addon) => ({ addon_id: addon.addonId, quantity: addon.quantity })),
    package_hours: trip.packageHours ?? null,
  });
  return { suggestion: { order, savedMeters: verdict.savedMeters, savedMinutes: verdict.savedMinutes, currentItinerary: current, itinerary: suggested, requestKey, thresholds, currentTooLong: tooLong, quoteResult } };
}
