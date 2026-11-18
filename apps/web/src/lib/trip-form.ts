/**
 * 多日行程报价页 `/book/trip`（M9T-09，ADR 0101 第二、十三节）的表单：页面上填的内容 ⇄ 标准行程单（`TripItinerary`，schemaVersion 1）。
 *
 * 页面上每天一块：上车时间、上车地点、按顺序的中间地点（各带停留时长）、最后下车地点；或者勾「这天不用车」（空闲日）。
 * 只有第 1 天选日期，之后每天顺延一天（服务端要求日期逐日连续，不用车的那天写成空闲日）。转成行程单时：
 * - 第一个点：机场是 `arrive_flight`，否则 `start`，带 `time`；中间是 `stop`（`stayMinutes` 0–720）；最后：机场是 `depart_flight`，否则 `end`；
 * - 地点只发坐标（服务端按坐标认机场、车站），不发名称——行程单里不存地名；
 * - 不是最后一天时，当晚过夜点 `nightAt` = 当天最后下车地点（机场除外：客人坐飞机走了）；空闲日沿用前一晚的过夜点；
 * - 「当晚为司机安排住宿」→ `driverLodgingProvided: true`（最后一天没有「当晚」，不发）。
 * 地名只在浏览器里：建好行程单后按行程单编号存起来（`trip-labels-store.ts`；第 2 步和以后的转人工报价要显示 / 带上地名），存不了时只是显示不了地名。
 */
import { TRIP_LIMITS, addDays } from "@nozomi/domain";
import { ApiError } from "../api/client.ts";
import type { SiteTripDay, SiteTripItem, SiteTripItinerary, SiteTripPlace } from "../api/site.ts";
import { type TripPoint, pointName } from "./book-new.ts";
import { failureText } from "./failure.ts";
import type { TripLabels } from "./trip-labels-store.ts";
import { tripCopy } from "./trip-texts.ts";

export type TripStep = 1 | 2;

/** 每天最多几个中间地点：上车 + 中间 + 最后下车 ≤ 每天 12 个点 */
export const MAX_TRIP_STOPS = TRIP_LIMITS.maxItemsPerDay - 2;
export const MAX_TRIP_DAYS = TRIP_LIMITS.maxDays;
/** 停留时长的选项（分钟）：0（只路过）到 720，30 分钟一档 */
export const TRIP_STAY_OPTIONS: readonly number[] = Array.from({ length: TRIP_LIMITS.maxStayMinutes / 30 + 1 }, (_, index) => index * 30);

export interface TripStopDraft {
  /** 只在页面里用（React 的 key、错误按它挂） */
  key: string;
  point: TripPoint | null;
  /** 停留分钟数的字符串（下拉的值）；没选为 "" */
  stay: string;
}

export interface TripDayDraft {
  key: string;
  /** 这天不用车（空闲日） */
  idle: boolean;
  /** 上车时间 HH:MM */
  time: string;
  start: TripPoint | null;
  stops: TripStopDraft[];
  end: TripPoint | null;
  /** 当晚客人为司机安排住宿 */
  lodgingProvided: boolean;
}

export interface TripFormDraft {
  /** 第 1 天的日期 YYYY-MM-DD；之后每天顺延 */
  date: string;
  passengers: number;
  luggage: number;
  days: TripDayDraft[];
}

let nextKey = 0;
const newKey = (prefix: string): string => {
  nextKey += 1;
  return `${prefix}-${nextKey}`;
};

export function newTripStop(): TripStopDraft {
  return { key: newKey("stop"), point: null, stay: "" };
}

/** 新的一天：上车地点默认接着前一天最后下车的地方（多半是住的酒店），客人可以改 */
export function newTripDay(previous: TripDayDraft | null = null): TripDayDraft {
  const start = previous !== null && !previous.idle && previous.end !== null && previous.end.kind !== "airport" ? previous.end : null;
  return { key: newKey("day"), idle: false, time: "", start, stops: [], end: null, lodgingProvided: false };
}

export function initialTripDraft(): TripFormDraft {
  return { date: "", passengers: 2, luggage: 2, days: [newTripDay()] };
}

/** 加一天（到上限时原样返回） */
export function addTripDay(draft: TripFormDraft): TripFormDraft {
  if (draft.days.length >= MAX_TRIP_DAYS) return draft;
  const previous = [...draft.days].reverse().find((day) => !day.idle) ?? null;
  return { ...draft, days: [...draft.days, newTripDay(previous)] };
}

/** 删掉一天（只剩一天时不删） */
export function removeTripDay(draft: TripFormDraft, key: string): TripFormDraft {
  if (draft.days.length <= 1) return draft;
  return { ...draft, days: draft.days.filter((day) => day.key !== key) };
}

const isDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const isTime = (value: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

/** 第 index 天（从 0 起）的日期；第 1 天还没选日期时为 "" */
export function tripDayDate(draft: Pick<TripFormDraft, "date">, index: number): string {
  return isDate(draft.date) ? addDays(draft.date, index) : "";
}

/** 这一天已经选了的点（上车、中间、最后下车，按顺序，没选的跳过）：地图和地名用 */
export function chosenPoints(day: TripDayDraft): TripPoint[] {
  if (day.idle) return [];
  return [day.start, ...day.stops.map((stop) => stop.point), day.end].filter((point): point is TripPoint => point !== null);
}

export interface TripDayErrors {
  idle?: string;
  time?: string;
  start?: string;
  end?: string;
  stops?: Record<string, { point?: string; stay?: string }>;
}

export interface TripFormErrors {
  date?: string;
  /** 按天的 `key` */
  days: Record<string, TripDayErrors>;
  /** 整个行程的问题（不同地点太多等） */
  general?: string;
}

const placeKey = (point: TripPoint): string => `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`;

/** 点「查看报价」前的检查（和服务端 `tripItineraryIssues` 同一套规则里客人能填错的那些）；没问题时 `days` 为空对象、没有别的键 */
export function validateTripDraft(draft: TripFormDraft): TripFormErrors {
  const errors: TripFormErrors = { days: {} };
  if (!isDate(draft.date)) errors.date = tripCopy("error.date");
  const places = new Set<string>();
  draft.days.forEach((day, index) => {
    const found: TripDayErrors = {};
    if (day.idle) {
      if (index === 0) found.idle = tripCopy("error.firstDayIdle");
      else if (index === draft.days.length - 1) found.idle = tripCopy("error.lastDayIdle");
    } else {
      if (!isTime(day.time)) found.time = tripCopy("error.time");
      if (day.start === null) found.start = tripCopy("error.start");
      if (day.end === null) found.end = tripCopy("error.end");
      const stops: Record<string, { point?: string; stay?: string }> = {};
      for (const stop of day.stops) {
        const problem: { point?: string; stay?: string } = {};
        if (stop.point === null) problem.point = tripCopy("error.stopPlace");
        if (stop.stay === "" || !TRIP_STAY_OPTIONS.includes(Number(stop.stay))) problem.stay = tripCopy("error.stay");
        if (problem.point !== undefined || problem.stay !== undefined) stops[stop.key] = problem;
      }
      if (Object.keys(stops).length > 0) found.stops = stops;
      for (const point of chosenPoints(day)) places.add(placeKey(point));
    }
    if (Object.keys(found).length > 0) errors.days[day.key] = found;
  });
  if (places.size > TRIP_LIMITS.maxDistinctPlaces) errors.general = tripCopy("error.tooManyPlaces", { max: TRIP_LIMITS.maxDistinctPlaces });
  return errors;
}

export function hasTripErrors(errors: TripFormErrors): boolean {
  return errors.date !== undefined || errors.general !== undefined || Object.keys(errors.days).length > 0;
}

const placeOf = (point: TripPoint): SiteTripPlace => ({ lat: point.lat, lng: point.lng });

/** 页面上填的内容 → 建行程单的请求体。只在 `validateTripDraft` 没有问题时调用 */
export function tripItineraryOf(draft: TripFormDraft): SiteTripItinerary {
  let night: { lat: number; lng: number } | null = null;
  const days = draft.days.map((day, index): SiteTripDay => {
    const date = tripDayDate(draft, index);
    const last = index === draft.days.length - 1;
    const lodging = !last && day.lodgingProvided ? { driverLodgingProvided: true } : {};
    if (day.idle) return { date, items: [], ...(night === null ? {} : { nightAt: night }), ...lodging };
    const start = day.start as TripPoint;
    const end = day.end as TripPoint;
    const items: SiteTripItem[] = [
      { kind: start.kind === "airport" ? "arrive_flight" : "start", place: placeOf(start), time: day.time },
      ...day.stops.map((stop): SiteTripItem => ({ kind: "stop", place: placeOf(stop.point as TripPoint), stayMinutes: Number(stop.stay) })),
      { kind: end.kind === "airport" ? "depart_flight" : "end", place: placeOf(end) },
    ];
    // 坐飞机走的那天（最后一个点是机场）没有过夜点
    night = !last && end.kind !== "airport" ? { lat: end.lat, lng: end.lng } : null;
    return { date, items, ...(night === null ? {} : { nightAt: night }), ...lodging };
  });
  return { schemaVersion: 1, party: { adults: draft.passengers, children: 0, luggage: draft.luggage }, days };
}

// ---------- 地名：按行程单编号存在 sessionStorage ----------

export function tripLabelsOf(draft: TripFormDraft): TripLabels {
  return { v: 1, days: draft.days.map((day) => chosenPoints(day).map((point) => point.name)) };
}

/** 行程单里第 day 天第 item 个点的显示名：有存的地名用地名，否则写坐标 */
export function tripPlaceName(itinerary: SiteTripItinerary, labels: TripLabels | null, day: number, item: number): string {
  const saved = labels?.days[day]?.[item];
  if (saved !== undefined && saved !== "") return saved;
  const place = itinerary.days[day]?.items[item]?.place;
  if (place === undefined || "placeId" in place) return tripCopy("stop", { n: day + 1, m: item + 1 });
  return pointName(place.lat, place.lng);
}

/**
 * 读回来的行程单 → 页面上的表单（刷新到第 2 步后点「修改行程」时用）：地名取存的，没有时写坐标；平台地点编号（页面不会发）还原不了，那一格留空。
 */
export function tripDraftOf(itinerary: SiteTripItinerary, labels: TripLabels | null): TripFormDraft {
  const pointAt = (day: number, index: number, airport: boolean): TripPoint | null => {
    const place = itinerary.days[day]?.items[index]?.place;
    if (place === undefined || "placeId" in place) return null;
    return { name: tripPlaceName(itinerary, labels, day, index), lat: place.lat, lng: place.lng, kind: airport ? "airport" : null };
  };
  const days = itinerary.days.map((day, d): TripDayDraft => {
    const lodgingProvided = day.driverLodgingProvided === true;
    if (day.items.length === 0) return { ...newTripDay(), idle: true, lodgingProvided };
    const first = day.items[0] as SiteTripItem;
    const lastIndex = day.items.length - 1;
    const lastItem = day.items[lastIndex] as SiteTripItem;
    const hasEnd = lastIndex > 0 && (lastItem.kind === "end" || lastItem.kind === "depart_flight");
    const middle = day.items.slice(1, hasEnd ? lastIndex : undefined);
    const end = hasEnd ? pointAt(d, lastIndex, lastItem.kind === "depart_flight") : day.nightAt === undefined || day.nightAt === null ? null : { name: pointName(day.nightAt.lat, day.nightAt.lng), lat: day.nightAt.lat, lng: day.nightAt.lng, kind: null };
    return {
      ...newTripDay(),
      time: first.time ?? "",
      start: pointAt(d, 0, first.kind === "arrive_flight"),
      stops: middle.map((item, i) => ({ ...newTripStop(), point: pointAt(d, i + 1, false), stay: String(item.stayMinutes ?? 0) })),
      end,
      lodgingProvided,
    };
  });
  return { date: itinerary.days[0]?.date ?? "", passengers: itinerary.party.adults + (itinerary.party.children ?? 0), luggage: itinerary.party.luggage ?? 0, days };
}

// ---------- 网址：?trip=<编号>&step=2 ----------

const TRIP_ID = /^[A-Za-z0-9_-]{43}$/;

export function tripStepOf(search: string): TripStep {
  return new URLSearchParams(search).get("step") === "2" ? 2 : 1;
}

/** 网址里的行程单编号（43 个 base64url 字符；格式不对当作没有） */
export function tripIdOf(search: string): string | null {
  const value = new URLSearchParams(search).get("trip");
  return value !== null && TRIP_ID.test(value) ? value : null;
}

/** 网址带了 `trip` 但格式不对（抄错、截断、旧链接）：页面回到第 1 步，并说一句行程单找不到 */
export function tripParamMalformed(search: string): boolean {
  const value = new URLSearchParams(search).get("trip");
  return value !== null && !TRIP_ID.test(value);
}

/** 第 2 步带行程单编号；第 1 步不带参数 */
export function tripSearch(tripId: string | null, step: TripStep): string {
  if (step === 1 || tripId === null) return "";
  return `?${new URLSearchParams({ trip: tripId, step: "2" }).toString()}`;
}

// ---------- 出错 ----------

export interface TripFailure {
  /** StateBlock 的说明 */
  text: string;
  /** 太复杂（422 TRIP_TOO_COMPLEX）：给转人工的提示 */
  manual: boolean;
  /** 行程单过期、不存在（404 TRIP_NOT_FOUND）：只能回第 1 步重新填 */
  gone: boolean;
}

const ACTION_KEYS = { create: "action.create", quote: "action.quote", read: "action.read", book: "action.book" } as const;

/** 建行程单、报价、读行程单、预订（下单出口，M9T-10）出错时的说法：太复杂、找不到、太频繁单独说，其余同官网 */
export function tripFailureOf(err: unknown, action: "create" | "quote" | "read" | "book"): TripFailure {
  if (err instanceof ApiError) {
    if (err.code === "TRIP_TOO_COMPLEX") return { text: tripCopy("failure.tooComplex"), manual: true, gone: false };
    if (err.code === "TRIP_NOT_FOUND") return { text: tripCopy("failure.notFound"), manual: false, gone: true };
    if (err.code === "SITE_NOT_OPEN") return { text: tripCopy("notOpenText"), manual: false, gone: false };
    if (err.status === 429) {
      const seconds = err.retryAfterSeconds;
      const text = seconds === null || seconds <= 0 ? tripCopy("failure.rateLimited") : seconds < 60 ? tripCopy("failure.rateLimitedSeconds", { n: seconds }) : tripCopy("failure.rateLimitedMinutes", { n: Math.ceil(seconds / 60) });
      return { text, manual: false, gone: false };
    }
    if (err.code === "VALIDATION_FAILED") return { text: tripCopy("error.invalid"), manual: false, gone: false };
  }
  return { text: failureText(err, tripCopy(ACTION_KEYS[action])), manual: false, gone: false };
}
