/**
 * AI 一句话行程（M9T-33，ADR 0104 第二、三节）：`POST /site/v1/trips/parse` 的应答 → `/book/trip` 的表单草稿 + 给客人看的摘要。
 *
 * 只做转换，不发请求。规则（和 Codespace 开发在 #288 对过的 4 点，前端防守处理）：
 * - 地点：`match.status` 为 `resolved` 才填；`ambiguous` 记下候选（最多 5 个）、`unresolved` 记下 AI 给的地名，这一格留空、进「请补填」。
 *   `point.kind` 只认 `"airport"`（页面的 `TripPoint.kind` 只有机场 / 其他），别的一律当普通地点。
 * - 停留：只收 0–720、每 30 分钟一档（`TRIP_STAY_OPTIONS`）；不在档上的丢掉并进「请确认」；没给的进「请补填」（页面检查要求每个中间地点选停留）。
 * - 空闲日（`idle: true`）：忽略当天的时间和地点；`days` 按应答原样排，前端不自己插天（服务端补好中间的空闲日）。
 * - 人数、行李没给：表单这两格不能空，先按默认值填上，进「请补填」写明按几人 / 几件填的。
 * - 应答里的 `texts` 不用，摘要文案只按代码从 `trip-texts.ts` 拼；`missing` 由这里按草稿自己算（和服务端的一致，不依赖它）。
 * - 超出页面上限（14 天、每天 12 个点）当作「行程较长」，不截断。
 * 页面标记（「AI 填的」「请补填」、候选、没找到）要用的格子编号放在 `marks` 里：`date`、`passengers`、`luggage`、`<天 key>.time|start|end`、`<地点 key>.point|stay`。
 */
import { ApiError } from "../api/client.ts";
import type { SiteTripParsePlace, SiteTripParsePoint, SiteTripParseResult } from "../api/site.ts";
import { addressText } from "./address-text.ts";
import { TRAVELLER_LIMITS, type TripPoint } from "./book-new.ts";
import { MAX_TRIP_DAYS, MAX_TRIP_STOPS, TRIP_STAY_OPTIONS, type TripDayDraft, type TripFormDraft, type TripStopDraft, initialTripDraft, newTripDay, newTripStop } from "./trip-form.ts";
import { type TripTextKey, tripCopy } from "./trip-texts.ts";

/** ADR 0104 第三节：最多 500 字（按 Unicode 码点数，去掉首尾空白后） */
export const TRIP_AI_MAX_CHARS = 500;
/** 有多个候选时最多列几个 */
export const TRIP_AI_MAX_CANDIDATES = 5;

export function tripAiLength(text: string): number {
  return [...text.trim()].length;
}

export interface TripAiCandidate {
  point: TripPoint;
  /** 候选的地址（列表里显示，可能为空） */
  address: string;
}

export interface TripAiMarks {
  /** AI 填了的格子（客人改过后由页面去掉） */
  filled: string[];
  /** 要客人补填的格子 */
  missing: string[];
  /** 有多个候选、等客人选的地点格子 → 候选 */
  candidates: Record<string, TripAiCandidate[]>;
  /** 没找到的地点格子 → AI 给的地名（预先放进搜索框） */
  notFound: Record<string, string>;
}

export interface TripAiSummary {
  /** 请补填 */
  missing: string[];
  /** 请确认（推算出来的） */
  confirm: string[];
  /** 没有用上的信息 */
  unused: string[];
  /** 不在报价范围：有就一句话（建议转人工），没有为 null */
  outOfScope: string | null;
}

export type TripAiFill =
  | { kind: "filled"; draft: TripFormDraft; marks: TripAiMarks; summary: TripAiSummary; headline: string }
  /** 应答里一天都没有 / 超出页面上限：按服务端的 422 处理 */
  | { kind: "failed"; text: string };

const isDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const isTime = (value: unknown): value is string => typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const isCount = (value: unknown, limits: { min: number; max: number }): value is number => typeof value === "number" && Number.isInteger(value) && value >= limits.min && value <= limits.max;
const isCoordinate = (point: SiteTripParsePoint): boolean => Number.isFinite(point.lat) && Number.isFinite(point.lng) && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180;

function pointOf(point: SiteTripParsePoint): TripPoint {
  const name = addressText(point.name, point.address ?? null);
  return { name, lat: point.lat, lng: point.lng, kind: point.kind === "airport" ? "airport" : null, suggestionName: point.name };
}

interface PlaceResult {
  point: TripPoint | null;
  candidates?: TripAiCandidate[];
  notFound?: string;
}

function placeOf(place: SiteTripParsePlace | null | undefined): PlaceResult {
  if (place === null || place === undefined) return { point: null };
  const { match } = place;
  if (match.status === "resolved" && isCoordinate(match.point)) return { point: pointOf(match.point) };
  if (match.status === "ambiguous") {
    const candidates = match.candidates.filter(isCoordinate).slice(0, TRIP_AI_MAX_CANDIDATES).map((point) => ({ point: pointOf(point), address: point.address ?? "" }));
    if (candidates.length === 1) return { point: (candidates[0] as TripAiCandidate).point };
    if (candidates.length > 1) return { point: null, candidates };
  }
  const query = place.query.trim();
  return query === "" ? { point: null } : { point: null, notFound: query };
}

const FLIGHT = /^[A-Z0-9]{2}\d{1,4}$/;

function unusedText(code: string, value: unknown): string | null {
  if (code === "FLIGHT_NUMBER") return typeof value === "string" && FLIGHT.test(value) ? tripCopy("ai.unused.FLIGHT_NUMBER", { value }) : null;
  if (code === "CHARTER_HOURS") {
    const hours = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
    return Number.isInteger(hours) && hours >= 1 && hours <= 24 ? tripCopy("ai.unused.CHARTER_HOURS", { value: hours }) : null;
  }
  const key = `ai.unused.${code}`;
  return tripCopy((["VEHICLE_TYPE", "DRIVER_LANGUAGE", "CHILD_SEAT", "OTHER_REQUEST"].includes(code) ? key : "ai.unused.other") as TripTextKey);
}

const SCOPE_CODES = ["BUS", "ACCESSIBLE_VEHICLE", "OVERSEAS", "OTHER"];

/** 字段路径（`date`、`days[0].time`、`days[1].stops[0].stay_minutes`）→ 给客人看的说法；认不出为 null */
export function tripAiFieldText(field: string, party: { passengers: number; luggage: number }): string | null {
  if (field === "date") return tripCopy("ai.field.date");
  if (field === "passengers") return tripCopy("ai.field.passengers", { n: party.passengers });
  if (field === "luggage") return tripCopy("ai.field.luggage", { n: party.luggage });
  const day = /^days\[(\d+)\]\.(time|start|end)$/.exec(field);
  if (day !== null) return tripCopy(`ai.field.${day[2] as "time" | "start" | "end"}`, { n: Number(day[1]) + 1 });
  const stop = /^days\[(\d+)\]\.stops\[(\d+)\](\.stay_minutes)?$/.exec(field);
  if (stop !== null) return tripCopy(stop[3] === undefined ? "ai.field.stop" : "ai.field.stay", { n: Number(stop[1]) + 1, m: Number(stop[2]) + 1 });
  return null;
}

/** 2026-11-25 → 11 月 25 日（摘要里「请确认」用） */
function dateText(value: string): string {
  const [, month, day] = value.split("-");
  return `${Number(month)} 月 ${Number(day)} 日`;
}

/** 解析应答 → 表单草稿、标记、摘要 */
export function tripAiFillOf(result: SiteTripParseResult): TripAiFill {
  const source = result.draft;
  const days = Array.isArray(source.days) ? source.days : [];
  if (days.length === 0 || days.every((day) => day.idle)) return { kind: "failed", text: tripCopy("ai.notATrip") };
  if (days.length > MAX_TRIP_DAYS || days.some((day) => !day.idle && (day.stops?.length ?? 0) > MAX_TRIP_STOPS)) return { kind: "failed", text: tripCopy("ai.tooLong") };

  const defaults = initialTripDraft();
  const marks: TripAiMarks = { filled: [], missing: [], candidates: {}, notFound: {} };
  const missing: string[] = [];
  const confirm: string[] = [];

  const date = isDate(source.date) ? source.date : "";
  const passengers = isCount(source.passengers, TRAVELLER_LIMITS.passengers) ? source.passengers : defaults.passengers;
  const luggage = isCount(source.luggage, TRAVELLER_LIMITS.luggage) ? source.luggage : defaults.luggage;
  const party = { passengers, luggage };
  const note = (cell: string, filled: boolean, field: string): void => {
    if (filled) {
      marks.filled.push(cell);
      return;
    }
    marks.missing.push(cell);
    const text = tripAiFieldText(field, party);
    if (text !== null) missing.push(text);
  };
  note("date", date !== "", "date");
  note("passengers", passengers === source.passengers, "passengers");
  note("luggage", luggage === source.luggage, "luggage");

  const place = (cell: string, field: string, found: PlaceResult): TripPoint | null => {
    note(cell, found.point !== null, field);
    if (found.candidates !== undefined) marks.candidates[cell] = found.candidates;
    if (found.notFound !== undefined) marks.notFound[cell] = found.notFound;
    return found.point;
  };

  const formDays = days.map((day, d): TripDayDraft => {
    const base = newTripDay();
    const lodgingProvided = day.lodging_provided === true;
    if (day.idle) return { ...base, idle: true, lodgingProvided };
    const time = isTime(day.time) ? day.time : "";
    note(`${base.key}.time`, time !== "", `days[${d}].time`);
    const start = place(`${base.key}.start`, `days[${d}].start`, placeOf(day.start));
    const stops = (day.stops ?? []).map((stop, s): TripStopDraft => {
      const draft = newTripStop();
      const point = place(`${draft.key}.point`, `days[${d}].stops[${s}]`, placeOf(stop));
      const minutes = stop.stay_minutes;
      const onGrid = typeof minutes === "number" && TRIP_STAY_OPTIONS.includes(minutes);
      if (onGrid) marks.filled.push(`${draft.key}.stay`);
      else {
        marks.missing.push(`${draft.key}.stay`);
        // 给了但不在档上：丢掉，请客人自己选；没给：请补填
        if (typeof minutes === "number") confirm.push(tripCopy("ai.assume.stay", { n: d + 1, m: s + 1 }));
        else missing.push(tripCopy("ai.field.stay", { n: d + 1, m: s + 1 }));
      }
      return { ...draft, point, stay: onGrid ? String(minutes) : "" };
    });
    const end = place(`${base.key}.end`, `days[${d}].end`, placeOf(day.end));
    return { ...base, time, start, stops, end, lodgingProvided };
  });

  for (const assumption of result.assumptions ?? []) {
    if (assumption.code === "DATE_FROM_RELATIVE" && isDate(assumption.value) && assumption.value === date) {
      confirm.push(tripCopy("ai.assume.DATE_FROM_RELATIVE", { value: dateText(assumption.value) }));
      continue;
    }
    const field = assumption.field === undefined ? null : tripAiFieldText(assumption.field, party);
    confirm.push(tripCopy("ai.assume.other", { field: field ?? tripCopy("ai.field.other") }));
  }

  const unused: string[] = [];
  for (const item of result.unused ?? []) {
    const text = unusedText(item.code, item.value);
    if (text !== null && !unused.includes(text)) unused.push(text);
  }

  const scopes = [...new Set((result.out_of_scope ?? []).map((item) => (SCOPE_CODES.includes(item.code) ? item.code : "OTHER")))];
  const outOfScope = scopes.length === 0 ? null : tripCopy("ai.outOfScope", { what: scopes.map((code) => tripCopy(`ai.scope.${code}` as TripTextKey)).join("、") });

  return {
    kind: "filled",
    draft: { date, passengers, luggage, days: formDays },
    marks,
    summary: { missing: [...new Set(missing)], confirm: [...new Set(confirm)], unused, outOfScope },
    headline: tripCopy("ai.summary", { days: formDays.length }),
  };
}

/** 表单还没填任何行程内容（只有页面自动填的日期、默认人数）：AI 结果直接填，不用问「替换吗」 */
export function tripDraftBlank(draft: TripFormDraft): boolean {
  if (draft.days.length !== 1) return false;
  const day = draft.days[0] as TripDayDraft;
  return !day.idle && day.time === "" && day.start === null && day.end === null && day.stops.length === 0 && !day.lodgingProvided;
}

export interface TripAiFailure {
  text: string;
  /** 没配密钥 / 功能关了：输入框整块不显示 */
  hide: boolean;
}

/** 解析失败时的说法（ADR 0104 第三节失败表）；表单都不动，客人照常手填 */
export function tripAiFailureOf(err: unknown): TripAiFailure {
  if (err instanceof ApiError) {
    if (err.code === "AI_NOT_CONFIGURED") return { text: tripCopy("ai.failed"), hide: true };
    if (err.code === "AI_DAILY_LIMIT") return { text: tripCopy("ai.dailyLimit"), hide: false };
    if (err.code === "NOT_A_TRIP") return { text: tripCopy("ai.notATrip"), hide: false };
    if (err.code === "TRIP_TOO_LONG") return { text: tripCopy("ai.tooLong"), hide: false };
    if (err.code === "VALIDATION_FAILED") return { text: tripCopy("ai.tooManyChars", { max: TRIP_AI_MAX_CHARS }), hide: false };
    if (err.status === 429) {
      const seconds = err.retryAfterSeconds;
      const text = seconds === null || seconds <= 0 ? tripCopy("ai.rateLimited") : seconds < 60 ? tripCopy("ai.rateLimitedSeconds", { n: seconds }) : tripCopy("ai.rateLimitedMinutes", { n: Math.ceil(seconds / 60) });
      return { text, hide: false };
    }
  }
  return { text: tripCopy("ai.failed"), hide: false };
}
