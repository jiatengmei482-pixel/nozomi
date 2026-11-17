/**
 * 包车经停顺序建议（M9P-20 P2，ADR 0096 第三节）：不碰网络和数据库的规则。
 * - 切段：起终点和固定的经停（P3 的 `arrive_by`）把行程切成几段，每段里的可动经停只在段内重排；某段 ≥ 2 个可动经停才值得问谷歌；
 * - 缓存键：段内可动经停排序后拼接——同一组点不管现在排成什么顺序都命中同一条；
 * - 成不成立：省的米数 ≥ 阈值或省的行驶分钟 ≥ 阈值，另一项变差不超过容差；前后端同一个函数（拖动后页面自己重算）；
 * - 请求键：除经停顺序外的全部询价字段的规范化摘要，前后端同一个函数（「一键采用」时核对）。
 */
import type { LatLng } from "./geo.ts";
import { routeCoordinateText } from "./route-estimate.ts";

const DAY_MS = 24 * 3_600_000;

/** 顺序建议的规则（ADR 0096 第三节、第十节第 2、5、6 条：都按推荐）。 */
export const ORDER_SUGGESTION_RULES = {
  /** 省的米数达到这么多算成立（平台配置 `CHARTER_ORDER_SUGGEST_MIN_METERS`，这里是默认值） */
  defaultMinSavedMeters: 5_000,
  /** 省的行驶分钟达到这么多算成立（平台配置 `CHARTER_ORDER_SUGGEST_MIN_MINUTES`） */
  defaultMinSavedMinutes: 10,
  /** 另一项最多变差多少（米、分钟）：防止「省 10 分钟、多 20 公里」也提示 */
  toleranceMeters: 1_000,
  toleranceMinutes: 3,
  /** 优化调用每天（东京时间）最多几次：默认 150（`GOOGLE_ROUTES_OPTIMIZE_DAILY_LIMIT`，按发给谷歌的调用次数计） */
  defaultDailyLimit: 150,
  /** 建议顺序在库里保留多久：24 小时；没有可行路线的 1 天 */
  cacheTtlMs: DAY_MS,
  negativeTtlMs: DAY_MS,
  /** 至少几个可动经停才问谷歌 */
  minMovable: 2,
} as const;

/** 行程里一个经停：坐标、是否固定（P3 的指定到达时间；固定的不参与重排）。`ref` 是页面给的不透明标识，只在请求和应答之间往返。 */
export interface SuggestionStop {
  ref: string;
  lat: number;
  lng: number;
  fixed?: boolean;
}

/**
 * 询价里的经停 → 切段用的经停（P3，ADR 0096 第三节第 1、6 小节）：带指定到达时间（`arrive_by`）的是固定点，不参与重排；`refs` 和经停一一对应。
 * 额外的字段（比如下标）原样带着。
 */
export function suggestionStopsOf<T extends { lat: number; lng: number; arrive_by?: unknown }>(waypoints: readonly T[], refs: readonly string[]): (SuggestionStop & { index: number })[] {
  return waypoints.map((stop, index) => ({ ref: refs[index] as string, lat: stop.lat, lng: stop.lng, index, ...(stop.arrive_by === undefined || stop.arrive_by === null ? {} : { fixed: true }) }));
}

/** 一段：两端（上车、固定经停、下车）和段内可动经停（按现在的顺序）。 */
export interface SuggestionSegment<T extends SuggestionStop = SuggestionStop> {
  from: LatLng;
  to: LatLng;
  movable: T[];
}

/** 按固定点切段。起点 = 上车，终点 = 下车，中间每个固定经停既是上一段的终点也是下一段的起点。 */
export function suggestionSegments<T extends SuggestionStop>(pickup: LatLng, stops: readonly T[], dropoff: LatLng): SuggestionSegment<T>[] {
  const segments: SuggestionSegment<T>[] = [];
  let from: LatLng = pickup;
  let movable: T[] = [];
  for (const stop of stops) {
    if (stop.fixed === true) {
      segments.push({ from, to: { lat: stop.lat, lng: stop.lng }, movable });
      from = { lat: stop.lat, lng: stop.lng };
      movable = [];
    } else movable.push(stop);
  }
  segments.push({ from, to: dropoff, movable });
  return segments;
}

/** 要问谷歌的段（≥ 2 个可动经停）；一段都没有时不调用（`NOT_APPLICABLE`）。 */
export function segmentsToOptimize<T extends SuggestionStop>(segments: readonly SuggestionSegment<T>[]): SuggestionSegment<T>[] {
  return segments.filter((segment) => segment.movable.length >= ORDER_SUGGESTION_RULES.minMovable);
}

const pointKey = (point: LatLng): string => `${routeCoordinateText(point.lat)},${routeCoordinateText(point.lng)}`;

/**
 * 一段的缓存键：`opt:v1:<起点>|<终点>|<段内可动经停取整后排序拼接>`。同一组点不同顺序同一个键；两端不同（固定点换了位置）键不同。
 * 两个可动经停取整后同一个点时照样各占一个（不去重）。
 */
export function orderSuggestionCacheKey(segment: SuggestionSegment): string {
  const movable = segment.movable.map(pointKey).sort();
  return `opt:v1:${pointKey(segment.from)}|${pointKey(segment.to)}|${movable.join(";")}`;
}

/**
 * 谷歌给的段内顺序（`optimizedIntermediateWaypointIndex`，相对这次请求里可动经停的下标）→ 存进缓存的「按建议顺序排好的取整坐标列表」。
 * 下标不是 0…n−1 的一个排列时为 null（看不懂）。
 */
export function orderedPoints(segment: SuggestionSegment, optimizedIndex: readonly number[]): LatLng[] | null {
  const n = segment.movable.length;
  if (optimizedIndex.length !== n || new Set(optimizedIndex).size !== n || optimizedIndex.some((index) => !Number.isInteger(index) || index < 0 || index >= n)) return null;
  return optimizedIndex.map((index) => {
    const stop = segment.movable[index] as SuggestionStop;
    return { lat: Number(routeCoordinateText(stop.lat)), lng: Number(routeCoordinateText(stop.lng)) };
  });
}

/**
 * 缓存里的坐标列表映射回客人的经停（按 `ref`）：坐标取整后相等的经停按现在的先后依次分配（两个经停同一个点时互换不影响路线）。
 * 对不上（个数不同、有坐标找不到）时为 null。
 */
export function refsInOrder<T extends SuggestionStop>(movable: readonly T[], ordered: readonly LatLng[]): string[] | null {
  if (ordered.length !== movable.length) return null;
  const left = [...movable];
  const refs: string[] = [];
  for (const point of ordered) {
    const index = left.findIndex((stop) => pointKey(stop) === pointKey(point));
    if (index < 0) return null;
    refs.push((left[index] as T).ref);
    left.splice(index, 1);
  }
  return refs;
}

/** 整个行程的建议顺序（全部经停的 `ref`）：固定经停留在原位，每段换成建议的段内顺序；没优化的段照旧。 */
export function suggestedOrder<T extends SuggestionStop>(stops: readonly T[], segmentOrders: ReadonlyMap<number, readonly string[]>): string[] {
  const order: string[] = [];
  let segment = 0;
  let pending: string[] = [];
  const flush = (): void => {
    order.push(...(segmentOrders.get(segment) ?? pending));
    pending = [];
  };
  for (const stop of stops) {
    if (stop.fixed === true) {
      flush();
      order.push(stop.ref);
      segment += 1;
    } else pending.push(stop.ref);
  }
  flush();
  return order;
}

/** 按 `ref` 列表重排（页面「采用」、服务器按建议顺序询价都用它）；`ref` 对不上时为 null。 */
export function reorderByRefs<T extends { ref: string }>(stops: readonly T[], order: readonly string[]): T[] | null {
  if (order.length !== stops.length) return null;
  const byRef = new Map(stops.map((stop) => [stop.ref, stop]));
  if (byRef.size !== stops.length) return null;
  const result: T[] = [];
  for (const ref of order) {
    const stop = byRef.get(ref);
    if (stop === undefined) return null;
    result.push(stop);
    byRef.delete(ref);
  }
  return result;
}

export interface RouteTotals {
  meters: number;
  minutes: number;
}

export interface SuggestionThresholds {
  minSavedMeters: number;
  minSavedMinutes: number;
}

export type SuggestionVerdict = { ok: true; savedMeters: number; savedMinutes: number } | { ok: false; savedMeters: number; savedMinutes: number };

/**
 * 成不成立（ADR 0096 第三节第 4 小节第 2 步）：省的米数 ≥ 阈值**或**省的行驶分钟 ≥ 阈值，而且另一项不变差超过 1 公里 / 3 分钟。
 * 停留分钟两种顺序一样，不计——传进来的是**行驶**米数和分钟。前后端同一个函数：拖动后页面用新的当前路线重算。
 */
export function judgeSuggestion(current: RouteTotals, suggested: RouteTotals, thresholds: SuggestionThresholds): SuggestionVerdict {
  const savedMeters = current.meters - suggested.meters;
  const savedMinutes = current.minutes - suggested.minutes;
  const enough = savedMeters >= thresholds.minSavedMeters || savedMinutes >= thresholds.minSavedMinutes;
  const noWorse = savedMeters >= -ORDER_SUGGESTION_RULES.toleranceMeters && savedMinutes >= -ORDER_SUGGESTION_RULES.toleranceMinutes;
  return { ok: enough && noWorse, savedMeters, savedMinutes };
}

/** 请求键要的询价字段（不含经停顺序）。 */
export interface SuggestionRequestFields {
  pickup: LatLng;
  dropoff: LatLng;
  waypoints: readonly { lat: number; lng: number; name: string; stay_minutes: number; arrive_by?: { day_offset: number; time: string } | null }[];
  service_local: string;
  passengers: number;
  luggage: number;
  addons?: readonly { addon_id: string; quantity: number }[];
  package_hours?: number | null;
}

/** 53 位的字符串摘要（cyrb53；不是安全哈希，只用来比对两边是不是同一组字段）。 */
function digest(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * 请求键（ADR 0096 第三节第 5 小节）：上下车点、经停点集合（坐标、名称、停留、到达时间）、日期时间、人数、行李、附加项、升档的规范化摘要，
 * **不含经停顺序**、不含 `ref`。前后端同一个函数：页面「一键采用」前用当前草稿算一遍，和建议应答里的 `request_key` 一致才采用。
 */
export function suggestionRequestKey(fields: SuggestionRequestFields): string {
  const stops = fields.waypoints
    .map((stop) => [pointKey(stop), stop.name, stop.stay_minutes, stop.arrive_by === undefined || stop.arrive_by === null ? null : `${stop.arrive_by.day_offset}+${stop.arrive_by.time}`].join("~"))
    .sort();
  const addons = [...(fields.addons ?? [])].map((addon) => `${addon.addon_id}x${addon.quantity}`).sort();
  const canonical = [pointKey(fields.pickup), pointKey(fields.dropoff), stops.join("|"), fields.service_local, fields.passengers, fields.luggage, addons.join(","), fields.package_hours ?? ""].join("#");
  return `rk1:${digest(canonical)}`;
}

/** 两组经停是不是同一组点（不看顺序；坐标按 3 位小数取整）：申请建议时核对和报价快照、询价日志一致。 */
export function sameStopSet(a: readonly LatLng[], b: readonly LatLng[]): boolean {
  if (a.length !== b.length) return false;
  const left = a.map(pointKey).sort();
  const right = b.map(pointKey).sort();
  return left.every((key, i) => key === right[i]);
}
