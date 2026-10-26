/**
 * 报价测试里路线预估的替身（ADR 0042）：给一条路线就是「取到了」（来源算谷歌），给 null 就是「取不到」（默认原因是对方暂时出错）。
 */
import type { RouteEstimate, RouteFailureCode, RouteLookup } from "@nozomi/domain";

export function routeLookup(route: RouteEstimate | null, failure: RouteFailureCode = "UNAVAILABLE"): RouteLookup {
  return route === null ? { ok: false, code: failure } : { ok: true, route, source: "google" };
}
