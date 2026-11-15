/**
 * 包车行程的经停点数量上限和超限提醒（M9P-10，规格 charter-pricing-spec-2026-11-14.md 步骤 2、步骤 5；ADR 0099）。
 * - 经停点数量不设业务上限，只受路径接口的技术上限：Routes API `computeRoutes` 一次最多 25 个中间点（`intermediates`），
 *   行程地图的折线（ADR 0096）、顺序建议（`optimizeWaypointOrder`）都是一次带全部经停，所以统一取 25。
 *   报价、草稿、人工报价、页面「添加经停点」都只读这里的常量，不各写各的。
 * - 超限提醒：预计用时 T 超过商品的提醒线、或全程 D 超过商品的提醒公里数时提醒，仍可下单（超过在线下单上限的拦截在报价引擎里，M9P-03）。
 * 这个文件不依赖别的模块（报价引擎、草稿、商品配置都引用它，不能形成循环）。
 */

export const CHARTER_ITINERARY_LIMITS = {
  /** 一单最多几个经停点：路径接口一次最多 25 个中间点 */
  maxWaypoints: 25,
} as const;

/** 超限提醒的种类：预计用时超过提醒线 / 全程超过提醒公里数 */
export type ItineraryWarning = "LONG_DURATION" | "LONG_DISTANCE";

/** 商品级的两条提醒线（`service_rules.charterItinerary.warnMinutes`、`warnKm`） */
export interface ItineraryWarningThresholds {
  warnMinutes: number;
  warnKm: number;
}

/**
 * 这一单要不要提醒：T（含经停点默认占用和整单缓冲）**大于**提醒线、全程米数**大于**提醒公里数 × 1000 时各提醒一种（规格「T > 12 小时或 D > 360 公里」）。
 * 顺序固定：先用时、后距离。都没超为空数组。
 */
export function itineraryWarnings(thresholds: ItineraryWarningThresholds, usage: { estimatedMinutes: number; routeMeters: number }): ItineraryWarning[] {
  const warnings: ItineraryWarning[] = [];
  if (usage.estimatedMinutes > thresholds.warnMinutes) warnings.push("LONG_DURATION");
  if (usage.routeMeters > thresholds.warnKm * 1000) warnings.push("LONG_DISTANCE");
  return warnings;
}
