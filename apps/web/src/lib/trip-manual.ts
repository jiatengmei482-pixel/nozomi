/**
 * 行程报价页「转人工报价」带上的内容（M9T-09 第二部分，ADR 0101 第十二节第 2 小节、第十三节第 2 小节；接口见 M9T-08 #316）：
 * - `trip`：现有人工报价申请只收一段，照 ADR 填**第一天**的行程——只有上下车两点是接送机（有一端是机场）或点对点，有中间地点是包车（经停点 = 中间地点，不填时长）；
 * - `trip_id`：行程单编号；`plan_kind`：全部报不出时为 null，客人选了方案提交预订（M9T-10）时是那个方案；
 * - `trip_labels`：每天按点顺序的地名，天数、每天点数和行程单一一对应（后端逐天核对，对不上 400）；没存地名的点写坐标。
 */
import type { SiteTripItinerary, SiteTripPlanKind } from "../api/site.ts";
import type { ManualQuoteTripDraft } from "./manual-quote-form.ts";
import { tripDraftOf, tripPlaceName } from "./trip-form.ts";
import type { TripLabels } from "./trip-labels-store.ts";

export interface TripManualQuoteLink {
  tripId: string;
  planKind: SiteTripPlanKind | null;
  labels: string[][];
}

/** 每天每个点的地名，和行程单 `days[].items[]` 一一对应（空闲日为空数组） */
export function tripLabelsFor(itinerary: SiteTripItinerary, labels: TripLabels | null): string[][] {
  // 后端每个地名单行、≤300 字、不能空：空白（含换行）压成一个空格，截到 300 字
  const clean = (name: string): string => [...name.replace(/\s+/gu, " ").trim()].slice(0, 300).join("") || "地图上选的位置";
  return itinerary.days.map((day, d) => day.items.map((_, i) => clean(tripPlaceName(itinerary, labels, d, i))));
}

/** 第一天的行程，填人工报价申请的 `trip`；第一天缺上车点或时间（页面不会这样发）时为 null */
export function tripManualQuoteDraft(itinerary: SiteTripItinerary, labels: TripLabels | null): ManualQuoteTripDraft | null {
  const form = tripDraftOf(itinerary, labels);
  const day = form.days[0];
  if (day === undefined || day.idle || day.start === null || day.time === "" || form.date === "") return null;
  const stops = day.stops.flatMap((stop) => (stop.point === null ? [] : [{ name: stop.point.name, lat: stop.point.lat, lng: stop.point.lng, stayMinutes: Number(stop.stay) || 0 }]));
  const place = (point: { name: string; lat: number; lng: number } | null) => (point === null ? null : { name: point.name, lat: point.lat, lng: point.lng });
  const airport = day.start.kind === "airport" || day.end?.kind === "airport";
  const base = { cityId: null, pickup: place(day.start), dropoff: place(day.end), serviceLocal: `${form.date}T${day.time}`, passengers: form.passengers, luggage: form.luggage };
  // 没有终点也没有中间地点的包车后端会要时长，页面填不出：当作缺行程（页面不会这样发）
  if (stops.length === 0 && day.end === null) return null;
  if (stops.length > 0 || day.end === null) return { ...base, category: "charter", packageHours: null, waypoints: stops };
  return { ...base, category: airport ? "airport_transfer" : "point_to_point", packageHours: null };
}
