/**
 * 行程报价页「转人工报价」带上的内容（M9T-09 第二部分，ADR 0101 第十二节第 2 小节、第十三节第 2 小节；接口见 M9T-08 #316）：
 * - `trip`：现有人工报价申请只收一段，照 ADR 填**第一天**的行程——只有上下车两点是接送机（有一端是机场）或点对点，有中间地点是包车（经停点 = 中间地点，不填时长）；
 * - `trip_id`：行程单编号；`plan_kind`：全部报不出时为 null，客人选了方案提交预订（M9T-10）时是那个方案；
 * - `trip_labels`：每天按点顺序的地名，天数、每天点数和行程单一一对应（后端逐天核对，对不上 400）；没存地名的点写坐标。
 */
import { MANUAL_QUOTE_RULES } from "@nozomi/domain";
import type { SiteTripItinerary, SiteTripPlanKind } from "../api/site.ts";
import type { ManualQuoteTripDraft } from "./manual-quote-form.ts";
import { type TripFormDraft, tripDraftOf, tripPlaceName } from "./trip-form.ts";
import type { TripLabels } from "./trip-labels-store.ts";
import { tripCopy } from "./trip-texts.ts";

export interface TripManualQuoteLink {
  tripId: string;
  planKind: SiteTripPlanKind | null;
  labels: string[][];
}

/** 后端每个地名单行、长度 ≤300（按 UTF-16 算，zod 的 max）、不能空：空白（含换行）压成一个空格，按整字截，不切断 emoji */
export function tripLabelText(name: string): string {
  let out = "";
  for (const char of name.replace(/\s+/gu, " ").trim()) {
    if (out.length + char.length > MANUAL_QUOTE_RULES.maxPlaceName) break;
    out += char;
  }
  return out === "" ? tripCopy("manual.unnamedPlace") : out;
}

/** 每天每个点的地名，和行程单 `days[].items[]` 一一对应（空闲日为空数组） */
export function tripLabelsFor(itinerary: SiteTripItinerary, labels: TripLabels | null): string[][] {
  return itinerary.days.map((day, d) => day.items.map((_, i) => tripLabelText(tripPlaceName(itinerary, labels, d, i))));
}

/** 第一天的行程，填人工报价申请的 `trip`；第一天缺上车点或时间（页面不会这样发）时为 null */
export function tripManualQuoteDraft(itinerary: SiteTripItinerary, labels: TripLabels | null): ManualQuoteTripDraft | null {
  const first = itinerary.days[0];
  // 只认行程单里真写了的终点：没有终点项（只有过夜点）的第一天不拿过夜点当下车点
  const lastKind = first?.items[first.items.length - 1]?.kind;
  const hasEnd = first !== undefined && first.items.length > 1 && (lastKind === "end" || lastKind === "depart_flight");
  const form = tripDraftOf(itinerary, labels);
  const day = form.days[0];
  if (day === undefined || day.idle || day.start === null || day.time === "" || form.date === "") return null;
  const stops = day.stops.flatMap((stop) => (stop.point === null ? [] : [{ name: stop.point.name, lat: stop.point.lat, lng: stop.point.lng, stayMinutes: Number(stop.stay) || 0 }]));
  const place = (point: { name: string; lat: number; lng: number } | null) => (point === null ? null : { name: point.name, lat: point.lat, lng: point.lng });
  const end = hasEnd ? day.end : null;
  const airport = day.start.kind === "airport" || end?.kind === "airport";
  const base = { cityId: null, pickup: place(day.start), dropoff: place(end), serviceLocal: `${form.date}T${day.time}`, passengers: form.passengers, luggage: form.luggage };
  // 没有终点也没有中间地点的包车后端会要时长，页面填不出：当作缺行程（页面不会这样发）
  if (stops.length === 0 && end === null) return null;
  if (stops.length > 0) return { ...base, category: "charter", packageHours: null, waypoints: stops };
  return { ...base, category: airport ? "airport_transfer" : "point_to_point", packageHours: null };
}

/**
 * 还没建行程单时（第 1 步，AI 整理后说有「不在报价范围」的部分，M9T-33）从页面上的表单取第一天，填人工报价申请的 `trip`。
 * 和 `tripManualQuoteDraft` 同一口径（第一天的上车点、最后下车点、中间地点），但可以不齐：缺的留空，由人工报价块提示「请先在上面选好…」。
 */
export function tripFormManualQuoteDraft(form: TripFormDraft): ManualQuoteTripDraft {
  const day = form.days[0];
  const place = (point: { name: string; lat: number; lng: number } | null) => (point === null ? null : { name: point.name, lat: point.lat, lng: point.lng });
  const usable = day !== undefined && !day.idle ? day : null;
  const start = usable?.start ?? null;
  const end = usable?.end ?? null;
  const stops = (usable?.stops ?? []).flatMap((stop) => (stop.point === null ? [] : [{ name: stop.point.name, lat: stop.point.lat, lng: stop.point.lng, stayMinutes: Number(stop.stay) || 0 }]));
  const serviceLocal = form.date !== "" && usable !== null && usable.time !== "" ? `${form.date}T${usable.time}` : null;
  const base = { cityId: null, pickup: place(start), dropoff: place(end), serviceLocal, passengers: form.passengers, luggage: form.luggage };
  if (stops.length > 0) return { ...base, category: "charter", packageHours: null, waypoints: stops };
  return { ...base, category: start?.kind === "airport" || end?.kind === "airport" ? "airport_transfer" : "point_to_point", packageHours: null };
}
