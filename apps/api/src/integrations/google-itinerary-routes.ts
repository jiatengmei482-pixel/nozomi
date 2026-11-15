/**
 * 外部服务：谷歌 Routes API 的 computeRoutes，取包车行程地图的折线（M9P-20 P1，ADR 0096 第二节第 2 小节）。
 *
 * - 一次调用经过全部点：上车作 `origin`、下车作 `destination`，经停按顺序作 `intermediates`（`via: false`，是停靠点）；
 *   驾车、不考虑实时路况、不要备选路线；字段掩码只要整条和逐段的折线（`ITINERARY_POLYLINE_FIELD_MASK`）。经停 ≤ 10 个按 Essentials 一档计费。
 * - 只用来画线：报价仍用逐段两两的路线预估和它的缓存（`services/route-estimates.ts`），不改报价口径。
 * - 密钥放在请求头 `X-Goog-Api-Key`；不跟随重定向；整次最多 `ITINERARY_POLYLINE_BUDGET_MS`；连不上、超时、5xx 在剩余时间够时再试 1 次。
 *   每次真正发请求之前问一次 `beforeAttempt`（路线的每日调用上限 `GOOGLE_ROUTES_DAILY_LIMIT`），不允许就不发。结果只有折线或原因代码，不带对方的原文。
 *
 * 单元测试和集成测试都用本机的假服务器（`GOOGLE_MAPS_ROUTES_URL`），不联网。
 */
import { type LatLng, type RouteFailureCode, isEncodedPolyline, routeValuesUsable } from "@nozomi/domain";
import { type ComputeRouteOptions, GOOGLE_MAPS_ATTEMPTS, ROUTE_MIN_RETRY_MS, isTimeout, readCapped, routeFailure } from "./google-maps.ts";

/**
 * 字段掩码：整条和逐段的折线（画图），整条和逐段的里程、时长（没有经停、按自选时长报价的包车，页面列表每段写时长和公里只作展示，ADR 0096 第二节第 3 小节）。
 * 都是 Essentials 一档的字段（不要路况、不要备选）。
 */
export const ITINERARY_POLYLINE_FIELD_MASK = "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.legs.distanceMeters,routes.legs.duration,routes.legs.polyline.encodedPolyline";
/** 整次最多花多久（毫秒）：页面在等这张图，但不在询价的路上，可以比路线预估宽一些 */
export const ITINERARY_POLYLINE_BUDGET_MS = 3_000;
export const ITINERARY_POLYLINE_ATTEMPT_TIMEOUT_MS = 2_000;
/** 应答最多读多少字节：11 段的折线加一条整条的，比路线预估的应答大得多 */
export const ITINERARY_POLYLINE_MAX_BYTES = 512 * 1024;

/** 一段的里程（米）和时长（秒）。 */
export interface ItineraryLegMeasure {
  meters: number;
  seconds: number;
}

/**
 * 行程的折线：逐段的（段数 = 点数 − 1 且每段都看得懂时）；否则整条路线的一条；都没有时为空数组（画不了线）。
 * `legs`：逐段的里程和时长（段数对得上、每段都看得懂时；只有一段时也认整条路线的），否则为 null。
 */
export type ComputedItineraryPolyline = { ok: true; polylines: string[]; legs: ItineraryLegMeasure[] | null } | { ok: false; code: RouteFailureCode };

/** computeRoutes 的请求体。`points` 按行程顺序，至少 2 个。 */
export function itineraryPolylineRequestBody(points: readonly LatLng[]): string {
  const at = (point: LatLng) => ({ location: { latLng: { latitude: point.lat, longitude: point.lng } } });
  return JSON.stringify({
    origin: at(points[0] as LatLng),
    destination: at(points[points.length - 1] as LatLng),
    intermediates: points.slice(1, -1).map((point) => ({ ...at(point), via: false })),
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_UNAWARE",
    computeAlternativeRoutes: false,
  });
}

interface LegLike {
  distanceMeters?: unknown;
  duration?: unknown;
  polyline?: { encodedPolyline?: unknown } | null;
}

/** 一段（或整条）的里程和时长：谷歌省略 0 米；时长是「123s」；看不懂或超出合理范围为 null。 */
function measureOf(leg: LegLike | null): ItineraryLegMeasure | null {
  if (leg === null) return null;
  const meters = leg.distanceMeters === undefined ? 0 : leg.distanceMeters;
  const duration = typeof leg.duration === "string" ? /^(\d{1,9})(?:\.\d{1,9})?s$/.exec(leg.duration) : null;
  if (typeof meters !== "number" || duration === null) return null;
  const seconds = Number(duration[1]);
  return routeValuesUsable(meters, seconds) ? { meters, seconds } : null;
}

/** 读成功的应答：`{ routes: [{ polyline: { encodedPolyline }, legs: [{ polyline: { encodedPolyline } }…] }] }`；没有 `routes` 是没有路线。 */
export function parseItineraryPolyline(text: string, legCount: number): ComputedItineraryPolyline {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, code: "UNEXPECTED" };
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, code: "UNEXPECTED" };
  const routes = (body as { routes?: unknown }).routes;
  if (routes === undefined || (Array.isArray(routes) && routes.length === 0)) return { ok: false, code: "NO_ROUTE" };
  if (!Array.isArray(routes)) return { ok: false, code: "UNEXPECTED" };
  const first = routes[0] as (LegLike & { legs?: unknown }) | null;
  if (typeof first !== "object" || first === null) return { ok: false, code: "UNEXPECTED" };
  const rawLegs: (LegLike | null)[] = Array.isArray(first.legs) ? first.legs.map((leg: unknown) => (typeof leg === "object" && leg !== null ? (leg as LegLike) : null)) : [];
  const legPolylines = rawLegs.map((leg) => leg?.polyline?.encodedPolyline);
  const whole = first.polyline?.encodedPolyline;
  const polylines = legPolylines.length === legCount && legPolylines.every(isEncodedPolyline) ? legPolylines : isEncodedPolyline(whole) ? [whole] : [];
  const measured = rawLegs.map(measureOf);
  // 只有一段（没有经停）而谷歌没给逐段的：整条路线就是这一段
  const single = legCount === 1 && rawLegs.length === 0 ? measureOf(first) : null;
  const legs = measured.length === legCount && measured.every((leg) => leg !== null) ? (measured as ItineraryLegMeasure[]) : single === null ? null : [single];
  return { ok: true, polylines, legs };
}

/** 按顺序经过全部点的一条驾车路线的折线（一次调用）。永远不抛异常：结果就是折线，或取不到的原因。 */
export async function computeItineraryPolyline(apiKey: string, points: readonly LatLng[], options: ComputeRouteOptions): Promise<ComputedItineraryPolyline> {
  const doFetch = options.fetch ?? fetch;
  const deadline = performance.now() + (options.budgetMs ?? ITINERARY_POLYLINE_BUDGET_MS);
  const attemptTimeout = options.attemptTimeoutMs ?? ITINERARY_POLYLINE_ATTEMPT_TIMEOUT_MS;
  const body = itineraryPolylineRequestBody(points);
  let last: ComputedItineraryPolyline = { ok: false, code: "UNREACHABLE" };
  for (let attempt = 1; attempt <= GOOGLE_MAPS_ATTEMPTS; attempt++) {
    const remaining = deadline - performance.now();
    if (attempt > 1 && remaining < ROUTE_MIN_RETRY_MS) break;
    if (options.beforeAttempt !== undefined && !(await options.beforeAttempt())) return attempt === 1 ? { ok: false, code: "DAILY_LIMIT_REACHED" } : last;
    try {
      const res = await doFetch(options.url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey, "x-goog-fieldmask": ITINERARY_POLYLINE_FIELD_MASK },
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(Math.max(1, Math.floor(Math.min(attemptTimeout, deadline - performance.now())))),
      });
      const text = await readCapped(res, ITINERARY_POLYLINE_MAX_BYTES);
      if (res.status === 200) return parseItineraryPolyline(text, points.length - 1);
      last = { ok: false, code: routeFailure(res.status, text) };
      if (res.status < 500) return last;
    } catch (err) {
      last = { ok: false, code: isTimeout(err) ? "TIMEOUT" : "UNREACHABLE" };
    }
  }
  return last;
}
