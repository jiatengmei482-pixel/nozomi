/**
 * AI 一句话行程（ADR 0104，M9T-32）的纯函数：
 * - `scrubPersonalInfo`：发给 Claude 之前，把邮箱、电话、卡号、证件号样式的字符串换成占位符（第九节）；
 * - `buildTripParseDraft`：Claude 按输出模式给的结果（已经过结构校验）→ 表单草稿 + `missing / assumptions / unused / out_of_scope`（第二、三节）。
 *   客人没说的日期、时间、人数、行李一律 null，并列进 `missing`；推算出来的列进 `assumptions`；不在格式里的值丢掉。
 *   地点和停留按监工 11-21 验收意见（ADR 0104 第二节第 3 小节）少让客人补：没说起点用上一天的终点（`START_FROM_PREVIOUS_END`），
 *   没说停留给默认时长（`STAY_DEFAULT`），有途经点没说终点按回到起点（`END_AT_START`），都标「AI 填的，可改」、不进 `missing`；
 *   泛指的地点（「新宿的酒店」）标 `PLACE_TOO_VAGUE`，页面请客人选具体哪一家。
 * 地名换坐标不在这里（要查地址搜索），由服务层按 `places` 去查。
 */
import { addDays } from "../pricing.ts";
import { isLocalDate } from "../service-time.ts";
import { TRIP_LIMITS, minuteOfDay } from "./itinerary.ts";

/** 一句话最多 500 字（按 Unicode 码点数，去掉首尾空白后） */
export const TRIP_PARSE_MAX_CHARS = 500;
/** 一次解析最多查这么多个不同地名，超出的不查（`unresolved`） */
export const TRIP_PARSE_MAX_LOOKUPS = 20;
/** 地名最多 80 字 */
export const TRIP_PARSE_MAX_NAME = 80;
/** 第 1 天最晚可以是今天之后多少天（超出视为没说清，请补填） */
export const TRIP_PARSE_MAX_DAYS_AHEAD = 400;

export const TRIP_PARSE_PLACE_KINDS = ["airport", "station", "hotel", "poi", "address"] as const;
export type TripParsePlaceKind = (typeof TRIP_PARSE_PLACE_KINDS)[number];

export const TRIP_PARSE_DATE_SOURCES = ["stated", "relative", "year_inferred"] as const;
export type TripParseDateSource = (typeof TRIP_PARSE_DATE_SOURCES)[number];

export const TRIP_PARSE_UNUSED_CODES = ["FLIGHT_NUMBER", "CHARTER_HOURS", "VEHICLE_TYPE", "DRIVER_LANGUAGE", "CHILD_SEAT", "OTHER_REQUEST"] as const;
export type TripParseUnusedCode = (typeof TRIP_PARSE_UNUSED_CODES)[number];

export const TRIP_PARSE_SCOPE_CODES = ["BUS", "ACCESSIBLE_VEHICLE", "OVERSEAS", "OTHER"] as const;
export type TripParseScopeCode = (typeof TRIP_PARSE_SCOPE_CODES)[number];

/** Claude 输出模式里的一个地点（字段名与 `TRIP_PARSE_SCHEMA` 一致） */
export interface TripParseModelPlace {
  name: string;
  kind: TripParsePlaceKind;
  /** 有具体名称（「京王广场酒店」），不是泛指（「酒店」「新宿的酒店」） */
  specific: boolean;
  cityHint: string | null;
  /** 客人说了停留多久才有 */
  stayMinutes: number | null;
}

export interface TripParseModelDay {
  /** 相对第 1 天，0 起 */
  dayOffset: number;
  time: string | null;
  start: TripParseModelPlace | null;
  stops: TripParseModelPlace[];
  end: TripParseModelPlace | null;
  lodgingProvided: boolean;
}

export interface TripParseModelOutput {
  firstDate: string | null;
  dateSource: TripParseDateSource | null;
  passengers: number | null;
  luggage: number | null;
  days: TripParseModelDay[];
  unused: { code: TripParseUnusedCode; value: string | null }[];
  outOfScope: TripParseScopeCode[];
}

/** 草稿里的一个地点：地名文字，坐标由服务层查 */
export interface TripParsePlaceDraft {
  query: string;
  kind: TripParsePlaceKind;
  specific: boolean;
  cityHint: string | null;
}

export interface TripParseStopDraft extends TripParsePlaceDraft {
  /** 0–720、30 分钟一档；客人没说或不在档上为 null */
  stayMinutes: number | null;
}

export interface TripParseDayDraft {
  idle: boolean;
  time: string | null;
  start: TripParsePlaceDraft | null;
  stops: TripParseStopDraft[];
  end: TripParsePlaceDraft | null;
  lodgingProvided: boolean;
}

export interface TripParseDraft {
  date: string | null;
  passengers: number | null;
  luggage: number | null;
  days: TripParseDayDraft[];
}

export const TRIP_PARSE_ASSUMPTION_CODES = ["DATE_FROM_RELATIVE", "DATE_YEAR_INFERRED", "STAY_OFF_GRID", "STAY_DEFAULT", "START_FROM_PREVIOUS_END", "END_AT_START", "PLACE_PICKED", "PLACE_TOO_VAGUE"] as const;
export type TripParseAssumptionCode = (typeof TRIP_PARSE_ASSUMPTION_CODES)[number];

export interface TripParseAssumption {
  code: TripParseAssumptionCode;
  field: string;
  value: string | number;
}

export interface TripParseResult {
  draft: TripParseDraft;
  /** 请补填的字段路径：`date`、`passengers`、`luggage`、`days[0].time`、`days[0].start` */
  missing: { field: string }[];
  assumptions: TripParseAssumption[];
  unused: { code: TripParseUnusedCode; value: string | null }[];
  outOfScope: { code: TripParseScopeCode }[];
}

export type TripParseOutcome = { ok: true; result: TripParseResult } | { ok: false; code: "NOT_A_TRIP" | "TRIP_TOO_LONG" | "INVALID_OUTPUT" };

const FLIGHT_NUMBER = /^[A-Z0-9]{2}\d{1,4}$/;
const isInt = (value: unknown, min: number, max: number): value is number => Number.isInteger(value) && (value as number) >= min && (value as number) <= max;

/** 客人没说停留多久时先填的时长（分钟，在 30 分钟档上）：景点、地址 1 小时；酒店、车站、机场 30 分钟（放行李、接人） */
export function tripParseDefaultStay(kind: TripParsePlaceKind): number {
  return kind === "poi" || kind === "address" ? 60 : 30;
}

/** 停留分钟是否在表单的档上（0–720，每 30 分钟一档） */
export function isTripStayOption(minutes: number): boolean {
  return isInt(minutes, 0, TRIP_LIMITS.maxStayMinutes) && minutes % 30 === 0;
}

function placeDraft(place: TripParseModelPlace | null): TripParsePlaceDraft | null {
  if (place === null) return null;
  const query = place.name.trim().slice(0, TRIP_PARSE_MAX_NAME);
  if (query === "") return null;
  const cityHint = place.cityHint?.trim().slice(0, TRIP_PARSE_MAX_NAME) || null;
  return { query, kind: place.kind, specific: place.specific, cityHint };
}

/** 照抄一个地点（上一天终点当起点、起点当终点）：各天的格子互不影响 */
const copyPlace = (place: TripParsePlaceDraft): TripParsePlaceDraft => ({ ...place });

/** 一天里的点数（起点 + 途经 + 终点） */
const pointCount = (day: TripParseModelDay): number => (day.start === null ? 0 : 1) + day.stops.length + (day.end === null ? 0 : 1);

/** `unused` 的值按各自格式过滤：航班号、包车小时数留值，其余不收值（不让自由文字流到页面） */
function unusedValue(code: TripParseUnusedCode, value: string | null): { keep: boolean; value: string | null } {
  if (code === "FLIGHT_NUMBER") {
    const flight = (value ?? "").replace(/\s+/g, "").toUpperCase();
    return FLIGHT_NUMBER.test(flight) ? { keep: true, value: flight } : { keep: false, value: null };
  }
  if (code === "CHARTER_HOURS") {
    const hours = Number(value);
    return value !== null && /^\d{1,2}$/.test(value.trim()) && isInt(hours, 1, 24) ? { keep: true, value: String(hours) } : { keep: false, value: null };
  }
  return { keep: true, value: null };
}

/**
 * Claude 的结果 → 表单草稿。`today` 是日本时间的今天（`YYYY-MM-DD`）。
 * - 一天行程（有地点的一天）都没有 → `NOT_A_TRIP`；
 * - `dayOffset` 重复 → `INVALID_OUTPUT`（服务层按「结构不合格」再调一次）；
 * - 跨度超 14 天、某天点数超 12、全程不同地名超 60 → `TRIP_TOO_LONG`；
 * - 中间没提到的天补成空闲日；首日、末日不会是空闲日（只按有地点的天算跨度）。
 */
export function buildTripParseDraft(output: TripParseModelOutput, today: string): TripParseOutcome {
  const days = output.days.filter((day) => pointCount(day) > 0);
  if (days.length === 0) return { ok: false, code: "NOT_A_TRIP" };
  if (days.some((day) => !isInt(day.dayOffset, 0, 10_000))) return { ok: false, code: "INVALID_OUTPUT" };
  const offsets = days.map((day) => day.dayOffset);
  if (new Set(offsets).size !== offsets.length) return { ok: false, code: "INVALID_OUTPUT" };
  const first = Math.min(...offsets);
  const span = Math.max(...offsets) - first + 1;
  if (span > TRIP_LIMITS.maxDays) return { ok: false, code: "TRIP_TOO_LONG" };
  if (days.some((day) => pointCount(day) > TRIP_LIMITS.maxItemsPerDay)) return { ok: false, code: "TRIP_TOO_LONG" };
  const names = new Set(days.flatMap((day) => [day.start, ...day.stops, day.end]).flatMap((place) => (place === null ? [] : [place.name.trim()])));
  if (names.size > TRIP_LIMITS.maxDistinctPlaces) return { ok: false, code: "TRIP_TOO_LONG" };

  const missing: { field: string }[] = [];
  const assumptions: TripParseAssumption[] = [];

  // 日期：格式不对、早于今天、太远的都当没说（请补填），不猜
  let date: string | null = null;
  if (output.firstDate !== null && isLocalDate(output.firstDate) && output.firstDate >= today && output.firstDate <= addDays(today, TRIP_PARSE_MAX_DAYS_AHEAD)) {
    // 客人说的第 1 天如果是空的（模型从第 2 天才排上点），顺延到第一个有地点的那天
    date = addDays(output.firstDate, first);
    if (output.dateSource === "relative") assumptions.push({ code: "DATE_FROM_RELATIVE", field: "date", value: date });
    else if (output.dateSource === "year_inferred") assumptions.push({ code: "DATE_YEAR_INFERRED", field: "date", value: date });
  }
  if (date === null) missing.push({ field: "date" });

  const passengers = isInt(output.passengers, 1, TRIP_LIMITS.maxPassengers) ? output.passengers : null;
  if (passengers === null) missing.push({ field: "passengers" });
  const luggage = isInt(output.luggage, 0, TRIP_LIMITS.maxLuggage) ? output.luggage : null;
  if (luggage === null) missing.push({ field: "luggage" });

  const byOffset = new Map(days.map((day) => [day.dayOffset - first, day]));
  const draftDays: TripParseDayDraft[] = [];
  // 上一个用车日最后到的地方（终点，没有终点就是最后一个途经点）；中间隔着不用车的日子也算（人还在那里）
  let previousEnd: TripParsePlaceDraft | null = null;
  for (let index = 0; index < span; index++) {
    const day = byOffset.get(index);
    if (day === undefined) {
      draftDays.push({ idle: true, time: null, start: null, stops: [], end: null, lodgingProvided: false });
      continue;
    }
    const time = day.time !== null && minuteOfDay(day.time) !== null ? day.time : null;
    if (time === null) missing.push({ field: `days[${index}].time` });
    // 客人没说从哪出发（「第二天去日光」）：用上一天的终点；第 1 天没说才请补填。不拿本天的途经点顶替
    let start: TripParsePlaceDraft | null = placeDraft(day.start);
    if (start === null && previousEnd !== null) {
      start = copyPlace(previousEnd);
      assumptions.push({ code: "START_FROM_PREVIOUS_END", field: `days[${index}].start`, value: start.query });
    }
    if (start === null) missing.push({ field: `days[${index}].start` });
    // 有途经点、没说回哪（「包车 8 小时去日光」）：先按回到当天起点填（可改），不进请补填
    let end: TripParsePlaceDraft | null = placeDraft(day.end);
    if (end === null && start !== null && day.stops.length > 0) {
      end = copyPlace(start);
      assumptions.push({ code: "END_AT_START", field: `days[${index}].end`, value: end.query });
    }
    const stops: TripParseStopDraft[] = [];
    // 紧挨着重复的同一个地点（「…→ トヨタ博物館 → トヨタ博物館」，M9T-34 评估里 Sonnet 出过一次）只留一个：连续去同一处没有意义，留着表单会多一行。
    // 先去重再编号，`STAY_OFF_GRID` 指的途经点下标和表单一致
    const sameAs = (a: TripParsePlaceDraft | null, b: TripParsePlaceDraft | null): boolean => a !== null && b !== null && a.query.normalize("NFKC").toLowerCase() === b.query.normalize("NFKC").toLowerCase();
    const kept: { model: TripParseModelPlace; place: TripParsePlaceDraft }[] = [];
    for (const stop of day.stops) {
      const place = placeDraft(stop);
      if (place !== null && !sameAs(kept.at(-1)?.place ?? start, place)) kept.push({ model: stop, place });
    }
    while (kept.length > 0 && sameAs((kept.at(-1) as { place: TripParsePlaceDraft }).place, end)) kept.pop();
    for (const { model: stop, place } of kept) {
      let stayMinutes: number | null = null;
      const field = `days[${index}].stops[${stops.length}].stay_minutes`;
      if (stop.stayMinutes === null) {
        // 没说停留多久：先按常见时长填上（可改），不让客人每个点都补一次
        stayMinutes = tripParseDefaultStay(place.kind);
        assumptions.push({ code: "STAY_DEFAULT", field, value: stayMinutes });
      } else if (isTripStayOption(stop.stayMinutes)) stayMinutes = stop.stayMinutes;
      // 说了但不在档上（「停 45 分钟」）：不替客人取整，请他自己选
      else if (isInt(stop.stayMinutes, 1, 24 * 60)) assumptions.push({ code: "STAY_OFF_GRID", field, value: stop.stayMinutes });
      stops.push({ ...place, stayMinutes });
    }
    draftDays.push({ idle: false, time, start, stops, end, lodgingProvided: day.lodgingProvided });
    previousEnd = end ?? stops.at(-1) ?? previousEnd;
  }

  // 没说是哪一家（「新宿的酒店」）：不查，页面说「没说是哪一家，请搜索选一家」，和「搜不到」分开
  draftDays.forEach((draftDay, d) => {
    const vague = (place: TripParsePlaceDraft | null, field: string): void => {
      if (place !== null && !place.specific) assumptions.push({ code: "PLACE_TOO_VAGUE", field, value: place.query });
    };
    vague(draftDay.start, `days[${d}].start`);
    draftDay.stops.forEach((stop, s) => vague(stop, `days[${d}].stops[${s}]`));
    vague(draftDay.end, `days[${d}].end`);
  });

  const unused: { code: TripParseUnusedCode; value: string | null }[] = [];
  for (const item of output.unused) {
    const checked = unusedValue(item.code, item.value);
    if (checked.keep && !unused.some((seen) => seen.code === item.code && seen.value === checked.value)) unused.push({ code: item.code, value: checked.value });
  }
  const outOfScope = [...new Set(output.outOfScope)].map((code) => ({ code }));

  return { ok: true, result: { draft: { date, passengers, luggage, days: draftDays }, missing, assumptions, unused, outOfScope } };
}

/** 草稿里要查坐标的不同地名（泛指的不查，超过上限的不查），按出现顺序 */
export function tripParseLookups(draft: TripParseDraft): TripParsePlaceDraft[] {
  const seen = new Map<string, TripParsePlaceDraft>();
  for (const day of draft.days) {
    for (const place of [day.start, ...day.stops, day.end]) {
      if (place === null || !place.specific) continue;
      const key = tripParseLookupKey(place);
      if (!seen.has(key) && seen.size < TRIP_PARSE_MAX_LOOKUPS) seen.set(key, place);
    }
  }
  return [...seen.values()];
}

/** 同一句话里同一个地名只查一次 */
export function tripParseLookupKey(place: TripParsePlaceDraft): string {
  return `${place.query.normalize("NFKC").toLowerCase()}|${(place.cityHint ?? "").normalize("NFKC").toLowerCase()}`;
}

/** 一句话的长度（按 Unicode 码点数） */
export function tripParseTextLength(text: string): number {
  return [...text].length;
}

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu;
/** 证件号：护照（日本 TK1234567、中国 E12345678）等「1–2 个字母 + 7–8 位数字」 */
const ID_NUMBER = /(?<![\p{L}\p{N}])[A-Za-z]{1,2}\d{7,8}(?![\p{L}\p{N}])/gu;
/** 一串数字（中间可以有单个空格、连字符、点、括号），前面可以有 + */
const DIGIT_RUN = /(?<![\p{L}\p{N}])\+?\(?\d(?:[\s\-.()]?\d)+(?![\p{L}\p{N}])/gu;
/** 日期、时间开头的数字串不动（2026-11-25、2026/11/25 10） */
const DATE_LIKE = /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/;

/**
 * 发给 Claude 之前替换个人信息样式的字符串（ADR 0104 第九节）。宁可多换：被换掉的只是电话、卡号这类本来就不用于报价的内容。
 * - 邮箱 → `[EMAIL]`；证件号 → `[ID]`；
 * - 数字串：13–19 位且不以 + 开头 → `[CARD]`；9 位以上（或以 + 开头的 8 位以上）→ `[PHONE]`；日期样式的不动。
 */
export function scrubPersonalInfo(text: string): string {
  return text
    .replace(EMAIL, "[EMAIL]")
    .replace(ID_NUMBER, "[ID]")
    .replace(DIGIT_RUN, (run) => {
      if (DATE_LIKE.test(run)) return run;
      const digits = run.replace(/\D/g, "").length;
      if (!run.startsWith("+") && digits >= 13 && digits <= 19) return "[CARD]";
      if (digits >= 9 || (run.startsWith("+") && digits >= 8)) return "[PHONE]";
      return run;
    });
}
