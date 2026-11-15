/**
 * 标准行程单（P1 子集，ADR 0100 第二节；设计篇 ADR 0094 第二节第 3 小节）：只收结构化输入，不收自由文字。
 * 服务端 zod 和这里共用一组上限（`TRIP_LIMITS`）；这里做跨字段的校验（日期升序且连续、点的先后、每天点数含过夜点、全程不同地点数）。
 */
import { isValidLatLng, type LatLng } from "../geo.ts";
import { QUOTE_RULES } from "../quote.ts";
import { addDays } from "../pricing.ts";
import { isLocalDate } from "../service-time.ts";

export const TRIP_LIMITS = {
  maxDays: 14,
  maxItemsPerDay: 12,
  maxDistinctPlaces: 60,
  maxAddons: 10,
  maxVehicleGroupIds: 20,
  /** 人数、行李沿用单段询价的上限：超过时引擎直接 400（`QUOTE_RULES`） */
  maxPassengers: QUOTE_RULES.maxPassengers,
  maxLuggage: QUOTE_RULES.maxLuggage,
  maxAddonQuantity: QUOTE_RULES.maxAddonQuantity,
  maxStayMinutes: 720,
} as const;

export const TRIP_PLACE_KINDS = ["hotel", "poi", "address"] as const;
export type TripPlaceKind = (typeof TRIP_PLACE_KINDS)[number];

/** 平台地点（机场 / 车站，`placeId`）或坐标 */
export type TripPlace = { placeId: string } | { lat: number; lng: number; kind?: TripPlaceKind };

export const TRIP_ITEM_KINDS = ["arrive_flight", "start", "stop", "end", "depart_flight"] as const;
export type TripItemKind = (typeof TRIP_ITEM_KINDS)[number];

export interface TripItem {
  kind: TripItemKind;
  place: TripPlace;
  /** `HH:MM`，只有当天起点（`arrive_flight` / `start`）带 */
  time?: string;
  /** 停留分钟，只有 `stop` 带（0–720） */
  stayMinutes?: number;
}

export interface TripDay {
  /** `YYYY-MM-DD`，城市当地日期 */
  date: string;
  /** 空 = 空闲日（不用车） */
  items: readonly TripItem[];
  /** 当晚过夜点；没写终点时当天终点 = 它 */
  nightAt?: LatLng | null;
  /** 客人当晚给司机提供住宿（原文 3.1 抵免） */
  driverLodgingProvided?: boolean;
}

export interface TripItinerary {
  schemaVersion: 1;
  party: { adults: number; children: number; luggage: number };
  preferences: { vehicleGroupIds: readonly string[]; addons: readonly { addonId: string; quantity: number }[] };
  days: readonly TripDay[];
}

export type TripIssueReason =
  | "REQUIRED"
  | "OUT_OF_RANGE"
  | "INVALID"
  | "DUPLICATE"
  | "NOT_ASCENDING"
  | "NOT_CONSECUTIVE"
  | "MUST_START_WITH_START"
  | "TIME_REQUIRED"
  | "TIME_NOT_ALLOWED"
  | "STAY_NOT_ALLOWED"
  | "END_NOT_LAST"
  | "TOO_FEW_POINTS"
  | "FIRST_DAY_IDLE"
  | "LAST_DAY_IDLE";

export interface TripIssue {
  path: string;
  reason: TripIssueReason;
}

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** `HH:MM` → 当天零点起的分钟；格式不对为 null */
export function minuteOfDay(time: string): number | null {
  if (!HH_MM.test(time)) return null;
  const [h, m] = time.split(":").map(Number) as [number, number];
  return h * 60 + m;
}

export function isPlaceIdPlace(place: TripPlace): place is { placeId: string } {
  return "placeId" in place;
}

/** 同一地点的键：平台地点按编号，坐标按 6 位小数（约 0.1 米） */
export function tripPlaceKey(place: TripPlace): string {
  return isPlaceIdPlace(place) ? `place:${place.placeId}` : `ll:${place.lat.toFixed(6)},${place.lng.toFixed(6)}`;
}

function placeIssues(place: TripPlace | undefined, path: string): TripIssue[] {
  if (place === undefined || place === null || typeof place !== "object") return [{ path, reason: "REQUIRED" }];
  if (isPlaceIdPlace(place)) return typeof place.placeId === "string" && place.placeId.length > 0 && place.placeId.length <= 64 ? [] : [{ path: `${path}/place_id`, reason: "INVALID" }];
  const issues: TripIssue[] = [];
  if (!isValidLatLng({ lat: place.lat, lng: place.lng })) issues.push({ path, reason: "INVALID" });
  if (place.kind !== undefined && !(TRIP_PLACE_KINDS as readonly string[]).includes(place.kind)) issues.push({ path: `${path}/kind`, reason: "INVALID" });
  return issues;
}

const isInt = (value: unknown, min: number, max: number): boolean => Number.isInteger(value) && (value as number) >= min && (value as number) <= max;

/**
 * 行程单的跨字段校验，返回全部问题（空 = 通过）：
 * - 1–14 天、日期合法且严格升序；首日、末日不能是空闲日；
 * - 每天 0 或 2–12 个点：第一个是 `arrive_flight` / `start` 且带 `time`；中间是 `stop`（停留 0–720 分钟）；`end` / `depart_flight` 只能在最后；
 *   只有一个起点、没有别的点时，当晚过夜点当终点（没写过夜点 → `TOO_FEW_POINTS`）；
 * - 全程不同地点 ≤ 60；人数 1–60、行李 0–60；附加项 ≤ 10 且不重复、个数 1–20；车型组不重复。
 */
export function tripItineraryIssues(itinerary: TripItinerary): TripIssue[] {
  const issues: TripIssue[] = [];
  if (itinerary.schemaVersion !== 1) issues.push({ path: "/schemaVersion", reason: "INVALID" });
  const { party, preferences, days } = itinerary;
  if (!isInt(party?.adults, 0, TRIP_LIMITS.maxPassengers)) issues.push({ path: "/party/adults", reason: "OUT_OF_RANGE" });
  if (!isInt(party?.children, 0, TRIP_LIMITS.maxPassengers)) issues.push({ path: "/party/children", reason: "OUT_OF_RANGE" });
  if (isInt(party?.adults, 0, TRIP_LIMITS.maxPassengers) && isInt(party?.children, 0, TRIP_LIMITS.maxPassengers)) {
    const total = party.adults + party.children;
    if (total < 1 || total > TRIP_LIMITS.maxPassengers) issues.push({ path: "/party", reason: "OUT_OF_RANGE" });
  }
  if (!isInt(party?.luggage, 0, TRIP_LIMITS.maxLuggage)) issues.push({ path: "/party/luggage", reason: "OUT_OF_RANGE" });
  const groups = preferences?.vehicleGroupIds ?? [];
  if (groups.length > TRIP_LIMITS.maxVehicleGroupIds) issues.push({ path: "/preferences/vehicleGroupIds", reason: "OUT_OF_RANGE" });
  if (new Set(groups).size !== groups.length) issues.push({ path: "/preferences/vehicleGroupIds", reason: "DUPLICATE" });
  const addons = preferences?.addons ?? [];
  if (addons.length > TRIP_LIMITS.maxAddons) issues.push({ path: "/preferences/addons", reason: "OUT_OF_RANGE" });
  const seenAddons = new Set<string>();
  for (const [index, addon] of addons.entries()) {
    if (seenAddons.has(addon.addonId)) issues.push({ path: `/preferences/addons/${index}/addonId`, reason: "DUPLICATE" });
    seenAddons.add(addon.addonId);
    if (!isInt(addon.quantity, 1, TRIP_LIMITS.maxAddonQuantity)) issues.push({ path: `/preferences/addons/${index}/quantity`, reason: "OUT_OF_RANGE" });
  }
  if (!Array.isArray(days) || days.length < 1 || days.length > TRIP_LIMITS.maxDays) {
    issues.push({ path: "/days", reason: "OUT_OF_RANGE" });
    return issues;
  }
  const places = new Set<string>();
  let previousDate: string | null = null;
  for (const [d, day] of days.entries()) {
    const base = `/days/${d}`;
    if (typeof day.date !== "string" || !isLocalDate(day.date)) issues.push({ path: `${base}/date`, reason: "INVALID" });
    else {
      // 日期要连续（不用车的那天写成空闲日）：跨段费用按「相邻两天」算住宿、停驻，跳过的日子会少收，也绕得过 14 天上限
      if (previousDate !== null && day.date <= previousDate) issues.push({ path: `${base}/date`, reason: "NOT_ASCENDING" });
      else if (previousDate !== null && day.date !== addDays(previousDate, 1)) issues.push({ path: `${base}/date`, reason: "NOT_CONSECUTIVE" });
      previousDate = day.date;
    }
    if (day.nightAt !== undefined && day.nightAt !== null) {
      if (!isValidLatLng(day.nightAt)) issues.push({ path: `${base}/nightAt`, reason: "INVALID" });
      else places.add(tripPlaceKey(day.nightAt));
    }
    const items = day.items ?? [];
    if (items.length === 0) {
      if (d === 0) issues.push({ path: `${base}/items`, reason: "FIRST_DAY_IDLE" });
      if (d === days.length - 1) issues.push({ path: `${base}/items`, reason: "LAST_DAY_IDLE" });
      continue;
    }
    // 没写终点时当晚过夜点补成最后一个点，也算进每天 12 个点（否则 1 个起点 + 11 个经停 + 过夜点 = 11 个经停，超过引擎的经停上限）
    const lastKind = items[items.length - 1]?.kind;
    const appendsNight = !(items.length > 1 && (lastKind === "end" || lastKind === "depart_flight")) && day.nightAt !== undefined && day.nightAt !== null;
    if (items.length + (appendsNight ? 1 : 0) > TRIP_LIMITS.maxItemsPerDay) issues.push({ path: `${base}/items`, reason: "OUT_OF_RANGE" });
    for (const [i, item] of items.entries()) {
      const path = `${base}/items/${i}`;
      issues.push(...placeIssues(item.place, `${path}/place`));
      if (item.place !== undefined && item.place !== null && placeIssues(item.place, path).length === 0) places.add(tripPlaceKey(item.place));
      const first = i === 0;
      const last = i === items.length - 1;
      if (first) {
        if (item.kind !== "arrive_flight" && item.kind !== "start") issues.push({ path: `${path}/kind`, reason: "MUST_START_WITH_START" });
        if (item.time === undefined || minuteOfDay(item.time) === null) issues.push({ path: `${path}/time`, reason: "TIME_REQUIRED" });
      } else {
        if (item.time !== undefined) issues.push({ path: `${path}/time`, reason: "TIME_NOT_ALLOWED" });
        if (item.kind === "arrive_flight" || item.kind === "start") issues.push({ path: `${path}/kind`, reason: "INVALID" });
        if ((item.kind === "end" || item.kind === "depart_flight") && !last) issues.push({ path: `${path}/kind`, reason: "END_NOT_LAST" });
      }
      if (item.kind === "stop") {
        if (!isInt(item.stayMinutes ?? 0, 0, TRIP_LIMITS.maxStayMinutes)) issues.push({ path: `${path}/stayMinutes`, reason: "OUT_OF_RANGE" });
      } else if (item.stayMinutes !== undefined) issues.push({ path: `${path}/stayMinutes`, reason: "STAY_NOT_ALLOWED" });
    }
    if (items.length === 1 && (day.nightAt === undefined || day.nightAt === null)) issues.push({ path: `${base}/items`, reason: "TOO_FEW_POINTS" });
  }
  if (places.size > TRIP_LIMITS.maxDistinctPlaces) issues.push({ path: "/days", reason: "OUT_OF_RANGE" });
  return issues;
}

/** 当天的点序列 P0…Pn（没写终点时补当晚过夜点）；空闲日为空数组 */
export function dayPoints(day: TripDay): { place: TripPlace; kind: TripItemKind; stayMinutes: number }[] {
  const points = day.items.map((item) => ({ place: item.place, kind: item.kind, stayMinutes: item.kind === "stop" ? (item.stayMinutes ?? 0) : 0 }));
  if (points.length === 0) return points;
  const last = points[points.length - 1] as (typeof points)[number];
  const hasEnd = points.length > 1 && (last.kind === "end" || last.kind === "depart_flight");
  if (!hasEnd && day.nightAt !== undefined && day.nightAt !== null) points.push({ place: { lat: day.nightAt.lat, lng: day.nightAt.lng, kind: "hotel" }, kind: "end", stayMinutes: 0 });
  return points;
}
