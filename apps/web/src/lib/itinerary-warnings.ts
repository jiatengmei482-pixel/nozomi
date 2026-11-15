/**
 * 包车行程的超限提醒和经停点上限的说法（M9P-10，规格 charter-pricing-spec-2026-11-14.md 步骤 5；文案来自
 * charter-airport-packages-2026-11-14.md 第四节第 3 条）：显示在「行程时间表」下方，并指出耗时 / 距离最长的一段。
 * 文案按键写在 `ITINERARY_TEXTS` 里，目前只有中文（业主 2026-11-15：翻译放到最后阶段 M11）。
 */
import type { SiteItineraryWarning, SiteQuote } from "../api/site.ts";
import { MAX_WAYPOINTS, type SiteItineraryRoute, durationText } from "./charter-itinerary.ts";

export const ITINERARY_TEXTS = {
  zh: {
    longDuration: "您的行程预计用时 {duration}，已超出司机单日法定工作时长的建议范围。建议适当缩减行程或减少经停点，让旅途更轻松舒适。",
    longDistance: "您的行程全程约 {km} 公里，超出单日包车的建议距离，将产生较多超公里费。建议适当缩减行程或减少经停点，让旅途更轻松舒适。",
    longestByTime: "耗时最长的一段：{from} → {to}，行驶约 {duration}。",
    longestByDistance: "距离最长的一段：{from} → {to}，约 {km} 公里。",
    waypointLimit: "最多 {max} 个经停点（地图路径接口的上限）；更多经停请联系客服定制。",
  },
} as const;

type TextKey = keyof (typeof ITINERARY_TEXTS)["zh"];

function fill(key: TextKey, values: Readonly<Record<string, string | number>>): string {
  return ITINERARY_TEXTS.zh[key].replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ""));
}

/** 全程约多少公里：四舍五入到整数（同「全程约」的口径，M9W-09） */
function kmText(meters: number): string {
  return String(Math.round(meters / 1000));
}

/** 经停点放满时的说明 */
export function waypointLimitText(): string {
  return fill("waypointLimit", { max: MAX_WAYPOINTS });
}

export interface ItineraryWarningLine {
  kind: SiteItineraryWarning;
  text: string;
  /** 耗时 / 距离最长的一段（没有逐段路线时为 null） */
  longest: string | null;
}

/** 逐段里某一项最大的那一段（一样大取前面的）；没有段为 -1 */
function longestLeg(legs: readonly { minutes: number; meters: number }[], by: "minutes" | "meters"): number {
  let best = -1;
  for (const [index, leg] of legs.entries()) if (best === -1 || leg[by] > (legs[best] as { minutes: number; meters: number })[by]) best = index;
  return best;
}

/**
 * 报价带的超限提醒变成页面上的几行：先用时、后距离。`points` 是按顺序的地点名（上车、各经停、下车），用来说最长的一段从哪到哪。
 * 用时取报价的 `estimated_minutes`（含缓冲），全程取路线的 `total_meters`；报价没有提醒（null 或空）时为空数组。
 */
export function itineraryWarningLines(quote: Pick<SiteQuote, "itinerary_warnings" | "estimated_minutes"> | null, route: SiteItineraryRoute | null | undefined, points: readonly string[]): ItineraryWarningLine[] {
  const warnings = quote?.itinerary_warnings ?? [];
  const legs = route?.legs ?? [];
  const segment = (index: number): { from: string; to: string } | null => {
    const from = points[index];
    const to = points[index + 1];
    return index < 0 || from === undefined || to === undefined ? null : { from, to };
  };
  return warnings.flatMap((kind): ItineraryWarningLine[] => {
    if (kind === "LONG_DURATION") {
      const minutes = quote?.estimated_minutes ?? route?.total_minutes ?? null;
      if (minutes === null) return [];
      const index = longestLeg(legs, "minutes");
      const at = segment(index);
      return [{ kind, text: fill("longDuration", { duration: durationText(minutes) }), longest: at === null ? null : fill("longestByTime", { ...at, duration: durationText((legs[index] as { minutes: number }).minutes) }) }];
    }
    if (route === null || route === undefined) return [];
    const index = longestLeg(legs, "meters");
    const at = segment(index);
    return [{ kind, text: fill("longDistance", { km: kmText(route.total_meters) }), longest: at === null ? null : fill("longestByDistance", { ...at, km: kmText((legs[index] as { meters: number }).meters) }) }];
  });
}
