/**
 * 价格日历的月份、格子和选日期（docs/design/pages/tenant-prices.md 第 6 节）。
 * 每一天的结算价、逐步的数都来自接口（后端用 @nozomi/domain 的 tripPrice 算），这里只挑「用车时间」落在哪一段、把数写成给人看的样子，不重算。
 */
import { type ExactAmount, addDays, compareExact, exactFromMinor, parseTimeOfDay, weekdayOf } from "@nozomi/domain";
import type { CalendarDay, CalendarSegment } from "../api/prices.ts";
import { WEEKDAY_NAMES, exactMoneyText } from "./adjust-form.ts";

/** 月份写成 `YYYY-MM`。 */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function isMonth(text: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(text);
}

export function addMonths(month: string, delta: number): string {
  const index = Number(month.slice(0, 4)) * 12 + (Number(month.slice(5, 7)) - 1) + delta;
  return `${String(Math.floor(index / 12)).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** 能看的月份：过去 12 个月到今后 24 个月。 */
export function monthRange(today: string): { first: string; last: string } {
  return { first: addMonths(monthOf(today), -12), last: addMonths(monthOf(today), 24) };
}

/** 网址里的月份：不合法或超出范围的换成本月。 */
export function clampMonth(text: string | null, today: string): string {
  const range = monthRange(today);
  return text !== null && isMonth(text) && text >= range.first && text <= range.last ? text : monthOf(today);
}

/** 这个月的每一天。 */
export function monthDates(month: string): string[] {
  const dates: string[] = [];
  for (let date = `${month}-01`; monthOf(date) === month; date = addDays(date, 1)) dates.push(date);
  return dates;
}

/** 按周排好（一周从周一开始）；月初月末的空位是 null。 */
export function monthWeeks(month: string): (string | null)[][] {
  const dates = monthDates(month);
  const cells: (string | null)[] = [...Array.from({ length: weekdayOf(dates[0] as string) - 1 }, () => null), ...dates];
  while (cells.length % 7 !== 0) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, week) => cells.slice(week * 7, week * 7 + 7));
}

export function monthTitle(month: string): string {
  return `${Number(month.slice(0, 4))} 年 ${Number(month.slice(5, 7))} 月`;
}

export function weekdayName(date: string): string {
  return WEEKDAY_NAMES[weekdayOf(date) - 1] ?? "";
}

/** 「10 月 1 日周五」。 */
export function spokenDate(date: string): string {
  return `${Number(date.slice(5, 7))} 月 ${Number(date.slice(8, 10))} 日${weekdayName(date)}`;
}

/** 两头都算在内的一段日期，按先后排好。 */
export function orderedRange(a: string, b: string): { from: string; to: string } {
  return a <= b ? { from: a, to: b } : { from: b, to: a };
}

export function daysInRange(from: string, to: string): number {
  let count = 0;
  for (let date = from; date <= to; date = addDays(date, 1)) count += 1;
  return count;
}

/** 键盘在月历里走：返回新的日期；走出这个月返回 null（PageUp / PageDown 由页面换月份）。 */
export function moveDay(date: string, key: string): string | null {
  const weekday = weekdayOf(date);
  const next = key === "ArrowLeft" ? addDays(date, -1) : key === "ArrowRight" ? addDays(date, 1) : key === "ArrowUp" ? addDays(date, -7) : key === "ArrowDown" ? addDays(date, 7) : key === "Home" ? addDays(date, 1 - weekday) : key === "End" ? addDays(date, 7 - weekday) : null;
  if (next === null) return null;
  const month = monthOf(date);
  if (monthOf(next) === month) return next;
  // Home / End 落在月外时停在这个月的第一天 / 最后一天
  if (key === "Home") return `${month}-01`;
  if (key === "End") return monthDates(month).at(-1) ?? null;
  return null;
}

/** 换月份时焦点留在同一个「日」；那个月没有这一天就到月底。 */
export function sameDayIn(month: string, date: string): string {
  const dates = monthDates(month);
  return dates.find((entry) => entry.slice(8) === date.slice(8)) ?? (dates.at(-1) as string);
}

/** 「用车时间」落在这一天的哪一段（段的结束不含）。 */
export function segmentAt(day: CalendarDay, time: string): CalendarSegment | null {
  const minute = parseTimeOfDay(time) ?? 600;
  return day.segments.find((segment) => (parseTimeOfDay(segment.from) ?? 0) <= minute && minute < (parseTimeOfDay(segment.to, { allowEndOfDay: true }) ?? 1440)) ?? day.segments[0] ?? null;
}

/** 接口里的精确值（最小货币单位的十进制字符串）→ 域里的精确值。只是换写法，不做计算。 */
export function exactFromText(text: string): ExactAmount {
  const negative = text.startsWith("-");
  const [whole = "0", fraction = ""] = (negative ? text.slice(1) : text).split(".");
  const numerator = BigInt(`${whole}${fraction}`) * (negative ? -1n : 1n);
  return { numerator, denominator: 10n ** BigInt(fraction.length) };
}

export function exactTextMoney(text: string, currency: string, signed = false): string {
  return exactMoneyText(exactFromText(text), currency, signed);
}

export function isWholeText(text: string): boolean {
  return !text.includes(".");
}

export type Trend = "up" | "down" | "same";

export interface CellView {
  /** 有价 / 没有价格 / 调完不大于 0 */
  kind: "price" | "none" | "bad";
  final: number | null;
  /** 和基础价比：高了、低了、一样；没有调价规则命中是 null */
  trend: Trend | null;
  rules: string[];
  /** 这一天里不同时段的价不一样 */
  split: boolean;
  disabled: boolean;
}

export function cellView(day: CalendarDay, time: string): CellView {
  const segment = segmentAt(day, time);
  const rules = segment?.adjusts.map((adjust) => adjust.name) ?? [];
  const split = day.segments.length > 1;
  if (segment === null || segment.final === null) return { kind: segment?.no_price_reason === "NOT_POSITIVE" || segment?.no_price_reason === "OVER_LIMIT" ? "bad" : "none", final: null, trend: null, rules, split, disabled: segment?.no_price_reason === "RULE_DISABLED" };
  const compared = segment.base === null || rules.length === 0 ? null : compareExact(exactFromMinor(segment.final), exactFromText(segment.base));
  return { kind: "price", final: segment.final, trend: compared === null ? null : compared > 0 ? "up" : compared < 0 ? "down" : "same", rules, split, disabled: false };
}

export const TREND_NAMES: Readonly<Record<Trend, string>> = { up: "上调", down: "下调", same: "调完和基础价一样" };
