/**
 * 行程报价页的下单出口（M9T-10 第二部分，ADR 0101 第十三节第 3 小节）：单段方案 → 普通官网报价 → 现有 `/book/new` 的乘客信息、下单、付款。
 *
 * - 哪些方案能直接在线下单（`tripBookableSegment`）：整个方案只有一段（空闲日也算一段，和后端 `TRIP_PLAN_NOT_SINGLE_SEGMENT` 同一口径）、不是空闲日、
 *   没有挂在某天或按晚的跨段费用；这一天的点都是坐标、最后一个点是终点；包车的中间地点停留时长要是 `/book/new` 经停点能选的档（30 分钟一档、最长 8 小时）——
 *   `/book/new` 显示不了的（例如「不停留」）不给在线下单，改走「提交预订，客服确认」。
 * - 点「预订这个方案」：`POST …/order-quote`（带包车经停点的地名），拿到的普通报价连同两端、经停点放进路由的 state（`TRIP_BOOK_STATE`），
 *   跳到 `/book/new?step=3`；`/book/new` 用它预填行程、直接用这张报价（不再询价）、选好车型，客人接着填乘客信息、下单、付款。不新增付款代码，不写 sessionStorage / localStorage。
 *   注意：路由 state 存在浏览器这条历史记录里（含地名），刷新、前进后退后还在，旧格式也可能回来——`tripBookHandoffOf` 逐项核对，不对就当作没有。
 * - 地名只在行程报价页手里（`trip-labels-store.ts` 只有那个页面读）；这里只收页面传进来的地名。
 */
import type { SiteByPointsResult, SiteCity, SiteQuoteResult, SiteQuotedCity, SiteTrip, SiteTripOrderQuote, SiteTripPlan, SiteTripSegment } from "../api/site.ts";
import type { BookTab, TripPoint } from "./book-new.ts";
import { STAY_OPTIONS } from "./charter-itinerary.ts";
import { tripPlaceName } from "./trip-form.ts";
import type { TripLabels } from "./trip-labels-store.ts";
import { tripCopy } from "./trip-texts.ts";

/** 路由 state 里放下单出口内容的键（`navigate("/book/new?step=3", { state: { [TRIP_BOOK_STATE]: … } })`） */
export const TRIP_BOOK_STATE = "fromTrip";
/** 跳进 `/book/new` 的第几步：第 3 步「乘客信息」（车型和价格已经定了） */
export const TRIP_BOOK_SEARCH = "?step=3";
/** 后端 `waypoint_names` 每个最多 200 个字（按 UTF-16 算） */
const NAME_MAX = 200;

/** 能直接在线下单的单段方案：这一段和它在第几天（行程单 `days[]` 的下标） */
export interface TripBookable {
  segment: SiteTripSegment;
  dayIndex: number;
}

/** 经停点：名称、坐标、停留分钟（同询价请求的 `waypoints[]`） */
export interface TripBookWaypoint {
  name: string;
  lat: number;
  lng: number;
  stay_minutes: number;
}

/** 放进路由 state 带去 `/book/new` 的内容 */
export interface TripBookHandoff {
  order: SiteTripOrderQuote;
  from: TripPoint;
  to: TripPoint;
  waypoints: TripBookWaypoint[];
}

/** 单段、无跨段费用、`/book/new` 表示得了的方案；否则 null（多段方案走「提交预订，客服确认」）。不看是否过期（过期由卡片另外处理） */
export function tripBookableSegment(trip: SiteTrip, plan: SiteTripPlan): TripBookable | null {
  if (plan.fees.length > 0 || plan.days.some((day) => day.fees.length > 0)) return null;
  const all = plan.days.flatMap((day) => day.segments.map((segment) => ({ segment, dayIndex: day.day_index })));
  const only = all.length === 1 ? all[0] : undefined;
  if (only === undefined || only.segment.type === "idle_day") return null;
  const items = trip.itinerary.days[only.dayIndex]?.items ?? [];
  const last = items[items.length - 1];
  if (items.length < 2 || last === undefined || (last.kind !== "end" && last.kind !== "depart_flight")) return null;
  if (items.some((item) => "placeId" in item.place)) return null;
  const middle = items.slice(1, -1);
  if (only.segment.type === "charter") return middle.every((item) => STAY_OPTIONS.includes(item.stayMinutes ?? 0)) ? only : null;
  return middle.length === 0 ? only : null;
}

/** 地名压成一行、按整字截到 200 个字以内；空的写「地图上选的位置」 */
function nameText(name: string): string {
  let out = "";
  for (const char of name.replace(/\s+/gu, " ").trim()) {
    if (out.length + char.length > NAME_MAX) break;
    out += char;
  }
  return out === "" ? tripCopy("manual.unnamedPlace") : out;
}

const pointAt = (trip: SiteTrip, labels: TripLabels | null, day: number, index: number): TripPoint | null => {
  const item = trip.itinerary.days[day]?.items[index];
  if (item === undefined) return null;
  const place = item.place;
  if ("placeId" in place) return null;
  const airport = item.kind === "arrive_flight" || item.kind === "depart_flight";
  return { name: nameText(tripPlaceName(trip.itinerary, labels, day, index)), lat: place.lat, lng: place.lng, kind: airport ? "airport" : null };
};

/** 包车这一段的经停点（这一天的中间地点）；接送机、点对点为空数组 */
export function tripBookWaypoints(trip: SiteTrip, bookable: TripBookable, labels: TripLabels | null): TripBookWaypoint[] {
  if (bookable.segment.type !== "charter") return [];
  const items = trip.itinerary.days[bookable.dayIndex]?.items ?? [];
  return items.slice(1, -1).flatMap((item, i) => {
    const point = pointAt(trip, labels, bookable.dayIndex, i + 1);
    return point === null ? [] : [{ name: point.name, lat: point.lat, lng: point.lng, stay_minutes: item.stayMinutes ?? 0 }];
  });
}

/** `POST …/order-quote` 的请求体：包车带经停点的地名（个数和经停点一样多），别的段型不带 */
export function tripOrderQuoteBody(trip: SiteTrip, bookable: TripBookable, labels: TripLabels | null): { waypoint_names?: string[] } {
  if (bookable.segment.type !== "charter") return {};
  return { waypoint_names: tripBookWaypoints(trip, bookable, labels).map((stop) => stop.name) };
}

/** 拿到普通报价后带去 `/book/new` 的内容；这一天缺上下车点（页面不会这样发）时为 null */
export function tripBookHandoff(trip: SiteTrip, bookable: TripBookable, labels: TripLabels | null, order: SiteTripOrderQuote): TripBookHandoff | null {
  const count = trip.itinerary.days[bookable.dayIndex]?.items.length ?? 0;
  const from = pointAt(trip, labels, bookable.dayIndex, 0);
  const to = pointAt(trip, labels, bookable.dayIndex, count - 1);
  if (from === null || to === null || count < 2) return null;
  return { order, from, to, waypoints: tripBookWaypoints(trip, bookable, labels) };
}

// ---------- `/book/new` 一侧 ----------

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const isPoint = (value: unknown): value is TripPoint => isObject(value) && typeof value["name"] === "string" && typeof value["lat"] === "number" && typeof value["lng"] === "number";
const isWaypoint = (value: unknown): value is TripBookWaypoint => isObject(value) && typeof value["name"] === "string" && typeof value["lat"] === "number" && typeof value["lng"] === "number" && typeof value["stay_minutes"] === "number";

const SEGMENT_TYPES: readonly string[] = ["airport_pickup", "airport_dropoff", "p2p", "charter"] as const;
const isCount = (value: unknown, min: number): boolean => typeof value === "number" && Number.isInteger(value) && value >= min;
const isText = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";
const isCity = (value: unknown): boolean => isObject(value) && isText(value["id"]) && isText(value["timezone"]) && isObject(value["name"]);

/**
 * 路由 state → 下单出口的内容；没有、格式不对时为 null（`/book/new` 照常从空白表单开始，不会因为旧格式出错）。
 * 核对：两端和经停点、段型、报价编号 / 有效期 / 车型 / 金额和币种、报价请求的用车时间和人数行李、城市（有就要有时区；包车必须有）。
 */
export function tripBookHandoffOf(state: unknown): TripBookHandoff | null {
  if (!isObject(state)) return null;
  const found = state[TRIP_BOOK_STATE];
  if (!isObject(found)) return null;
  const waypoints = found["waypoints"];
  if (!isPoint(found["from"]) || !isPoint(found["to"]) || !Array.isArray(waypoints) || !waypoints.every(isWaypoint)) return null;
  const order = found["order"];
  if (!isObject(order) || typeof order["segment_type"] !== "string" || !SEGMENT_TYPES.includes(order["segment_type"]) || !isText(order["currency"])) return null;
  const charter = order["segment_type"] === "charter";
  const city = order["city"];
  if (charter ? !isCity(city) : city !== null && !isCity(city)) return null;
  if (!charter && waypoints.length > 0) return null;
  const quote = order["quote"];
  const request = order["quote_request"];
  if (!isObject(quote) || !isObject(request) || !isText(quote["quote_id"]) || !isText(quote["expires_at"])) return null;
  const group = quote["vehicle_group"];
  if (!isObject(group) || !isText(group["id"]) || !isObject(group["name"])) return null;
  const price = quote["price"];
  const total = isObject(price) ? price["total"] : null;
  if (!isObject(total) || typeof total["amount"] !== "string" || !/^\d+(\.\d+)?$/.test(total["amount"]) || !isText(total["currency"])) return null;
  const serviceLocal = request["service_local"];
  if (typeof serviceLocal !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(serviceLocal)) return null;
  if (!isCount(request["passengers"], 1) || !isCount(request["luggage"], 0)) return null;
  return found as unknown as TripBookHandoff;
}

/**
 * 接送报价没带城市时（后端只给包车的城市）：按报价请求的 `city_id` 在 `/book/new` 已读到的城市列表里找，
 * 当地时间、城市名、人工报价的城市都按它；找不到为 null
 */
export function tripBookCity(handoff: TripBookHandoff, cities: readonly SiteCity[]): SiteQuotedCity | null {
  const id = handoff.order.quote_request.city_id;
  const found = id === undefined ? undefined : cities.find((entry) => entry.id === id);
  return found === undefined ? null : { id: found.id, code: found.code, name: found.name, timezone: found.timezone };
}

/** `/book/new` 第 1 步要预填的内容（页面按它拼自己的表单） */
export interface TripBookSeed {
  tab: BookTab;
  from: TripPoint;
  to: TripPoint;
  date: string;
  time: string;
  passengers: number;
  luggage: number;
  /** 没有经停点的包车（行程报价页不会这样发）才用：报价里的套餐时长 */
  packageHours: string;
  /** 有经停点、报价请求里带了手动升的套餐（`itinerary_pricing` + `package_hours`）：恢复成 /book/new 的升档；没有为 "" */
  upgradeHours: string;
  waypoints: { point: TripPoint; stay: string }[];
  /** 预先选好的车型 = 这张报价的车型 */
  vehicleGroupId: string;
  /** 接送：按段型认好的行程类型（接机 / 送机 / 点对点）；包车为 null */
  tripType: SiteByPointsResult["trip_type"] | null;
}

export function tripBookSeedOf(handoff: TripBookHandoff): TripBookSeed {
  const { order } = handoff;
  const request = order.quote_request;
  const charter = order.segment_type === "charter";
  const hours = order.quote.package?.hours ?? request.package_hours ?? null;
  const point = (p: TripPoint): TripPoint => ({ name: p.name, lat: p.lat, lng: p.lng, kind: p.kind === "airport" ? "airport" : null });
  return {
    tab: charter ? "charter" : "transfer",
    from: point(handoff.from),
    to: point(handoff.to),
    date: request.service_local.slice(0, 10),
    time: request.service_local.slice(11, 16),
    passengers: request.passengers,
    luggage: request.luggage,
    packageHours: charter && handoff.waypoints.length === 0 && hours !== null ? String(hours) : "",
    upgradeHours: charter && handoff.waypoints.length > 0 && request.itinerary_pricing === true && request.package_hours !== undefined ? String(request.package_hours) : "",
    waypoints: charter ? handoff.waypoints.map((stop) => ({ point: { name: stop.name, lat: stop.lat, lng: stop.lng, kind: null }, stay: String(stop.stay_minutes) })) : [],
    vehicleGroupId: order.quote.vehicle_group.id,
    tripType: charter ? null : order.segment_type === "airport_pickup" ? "pickup" : order.segment_type === "airport_dropoff" ? "dropoff" : "point_to_point",
  };
}

/** 和 `/book/new` 的询价结果同形：接送按两个坐标报价的结果，包车带按哪个城市报的价 */
export type TripBookOutcome = { mode: "transfer"; result: SiteByPointsResult } | { mode: "charter"; result: SiteQuoteResult; city: SiteQuotedCity };

/**
 * 把这张报价当作 `/book/new` 这次询价的结果（不再询价一次）。报价已过期、包车没有城市时为 null：`/book/new` 照常按预填的行程重新询价。
 * 接送：接机 / 送机报不出时回落点对点的（报价请求是点对点、段型是接机 / 送机）标 `fallback_category`，页面照样按接送机、下单按点对点；机场的名称没有，为 null。
 */
export function tripBookOutcome(handoff: TripBookHandoff, now: number): TripBookOutcome | null {
  const { order } = handoff;
  const expires = Date.parse(order.quote.expires_at);
  if (!Number.isFinite(expires) || expires <= now) return null;
  if (order.segment_type === "charter") {
    if (order.city === null) return null;
    const result: SiteQuoteResult = { currency: order.currency, city: order.city, quotes: [order.quote], unavailable: [], ...(order.itinerary_route === null ? {} : { itinerary_route: order.itinerary_route }) };
    return { mode: "charter", result, city: order.city };
  }
  const tripType: SiteByPointsResult["trip_type"] = order.segment_type === "airport_pickup" ? "pickup" : order.segment_type === "airport_dropoff" ? "dropoff" : "point_to_point";
  const fallback = tripType !== "point_to_point" && order.quote_request.category === "point_to_point";
  return {
    mode: "transfer",
    result: { trip_type: tripType, airport: null, fallback_category: fallback ? "point_to_point" : null, city: order.city, currency: order.currency, quotes: [order.quote], unavailable: [], expires_at: order.expires_at, route: null },
  };
}
