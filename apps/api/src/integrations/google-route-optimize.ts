/**
 * 外部服务：谷歌 Routes API 的 computeRoutes + `optimizeWaypointOrder`（包车经停顺序建议，M9P-20 P2，ADR 0096 第三节第 2 小节）。
 *
 * - 一段一次调用：`origin`、`destination` = 段的两端，`intermediates` = 段内可动经停（不能有 `via` 点），`optimizeWaypointOrder: true`；
 *   驾车、`TRAFFIC_UNAWARE`（和报价同口径）、不要备选路线；字段掩码只要 `routes.optimizedIntermediateWaypointIndex`。
 * - 这种请求按 **Compute Routes Pro** 计费（$10 / 千次）；每日上限 `GOOGLE_ROUTES_OPTIMIZE_DAILY_LIMIT` 单独计（`beforeAttempt`）。
 * - 密钥放在请求头；不跟随重定向；整次最多 `OPTIMIZE_BUDGET_MS`；连不上、超时、5xx 在剩余时间够时再试 1 次。结果只有段内顺序或原因代码，不带对方原文。
 *
 * 单元测试和集成测试都用本机的假服务器（`GOOGLE_MAPS_ROUTES_URL`），不联网。
 */
import type { LatLng, RouteFailureCode } from "@nozomi/domain";
import { type ComputeRouteOptions, GOOGLE_MAPS_ATTEMPTS, ROUTE_MIN_RETRY_MS, isTimeout, readCapped, routeFailure } from "./google-maps.ts";

export const OPTIMIZE_FIELD_MASK = "routes.optimizedIntermediateWaypointIndex";
/** 整次最多花多久（毫秒）：不在询价的路上（页面另外请求），可以宽一些 */
export const OPTIMIZE_BUDGET_MS = 4_000;
export const OPTIMIZE_ATTEMPT_TIMEOUT_MS = 2_500;

/** 段内顺序：`order[i]` 是建议顺序第 i 个对应请求里第几个中间点（从 0 起）。 */
export type ComputedOptimizedOrder = { ok: true; order: number[] } | { ok: false; code: RouteFailureCode };

export function optimizeRequestBody(from: LatLng, to: LatLng, movable: readonly LatLng[]): string {
  const at = (point: LatLng) => ({ location: { latLng: { latitude: point.lat, longitude: point.lng } } });
  return JSON.stringify({
    origin: at(from),
    destination: at(to),
    intermediates: movable.map(at),
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_UNAWARE",
    computeAlternativeRoutes: false,
    optimizeWaypointOrder: true,
  });
}

/** 读成功的应答：`{ routes: [{ optimizedIntermediateWaypointIndex: [2, 0, 1] }] }`；没有 routes 是没有路线；下标不是一个排列是看不懂。 */
export function parseOptimizedOrder(text: string, count: number): ComputedOptimizedOrder {
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
  const index = (routes[0] as { optimizedIntermediateWaypointIndex?: unknown } | null)?.optimizedIntermediateWaypointIndex;
  if (!Array.isArray(index) || index.length !== count || index.some((i) => !Number.isInteger(i) || i < 0 || i >= count) || new Set(index).size !== count) return { ok: false, code: "UNEXPECTED" };
  return { ok: true, order: index as number[] };
}

/** 一段的建议顺序（一次 Pro 调用）。永远不抛异常。 */
export async function computeOptimizedOrder(apiKey: string, from: LatLng, to: LatLng, movable: readonly LatLng[], options: ComputeRouteOptions): Promise<ComputedOptimizedOrder> {
  const doFetch = options.fetch ?? fetch;
  const deadline = performance.now() + (options.budgetMs ?? OPTIMIZE_BUDGET_MS);
  const attemptTimeout = options.attemptTimeoutMs ?? OPTIMIZE_ATTEMPT_TIMEOUT_MS;
  const body = optimizeRequestBody(from, to, movable);
  let last: ComputedOptimizedOrder = { ok: false, code: "UNREACHABLE" };
  for (let attempt = 1; attempt <= GOOGLE_MAPS_ATTEMPTS; attempt++) {
    const remaining = deadline - performance.now();
    if (attempt > 1 && remaining < ROUTE_MIN_RETRY_MS) break;
    if (options.beforeAttempt !== undefined && !(await options.beforeAttempt())) return attempt === 1 ? { ok: false, code: "DAILY_LIMIT_REACHED" } : last;
    try {
      const res = await doFetch(options.url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey, "x-goog-fieldmask": OPTIMIZE_FIELD_MASK },
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(Math.max(1, Math.floor(Math.min(attemptTimeout, deadline - performance.now())))),
      });
      const text = await readCapped(res);
      if (res.status === 200) return parseOptimizedOrder(text, movable.length);
      last = { ok: false, code: routeFailure(res.status, text) };
      if (res.status < 500) return last;
    } catch (err) {
      last = { ok: false, code: isTimeout(err) ? "TIMEOUT" : "UNREACHABLE" };
    }
  }
  return last;
}
