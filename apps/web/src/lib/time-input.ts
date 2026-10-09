/**
 * 时刻、日期的输入整理和「读回来的话」（docs/design/02-components.md 第 27 节、tenant-products.md 5.3、5.4）。
 * 判断规则用 @nozomi/domain 的同一批函数；这里只管把用户敲的字整理成标准写法、把规则换成人话。
 */
import { MINUTES_PER_DAY, type UrgentTier, checkBookingWindow, isLocalDate, parseTimeOfDay } from "@nozomi/domain";

const halfWidth = (text: string): string => text.replace(/[０-９：．／－]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));

/** `9`、`09`、`930`、`0930`、`9:30`、`9：30`、`9.30` → `HH:mm`；整理不出来或超出 00:00–23:59 返回 null。 */
export function tidyTime(text: string): string | null {
  const raw = halfWidth(text).trim();
  const match = /^(\d{1,2})[:.](\d{2})$/.exec(raw) ?? /^(\d{1,2})()$/.exec(raw) ?? /^(\d{1,2})(\d{2})$/.exec(raw);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = match[2] === "" ? 0 : Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** `20261008`、`2026/10/8`、`2026.10.08`、`2026-10-8` → `YYYY-MM-DD`；不是真实存在的日期返回 null。 */
export function tidyDate(text: string): string | null {
  const raw = halfWidth(text).trim();
  const match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(raw) ?? /^(\d{4})(\d{2})(\d{2})$/.exec(raw);
  if (!match) return null;
  const date = `${match[1]}-${String(Number(match[2])).padStart(2, "0")}-${String(Number(match[3])).padStart(2, "0")}`;
  return isLocalDate(date) ? date : null;
}

function durationText(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} 小时` : hours === 0 ? `${rest} 分钟` : `${hours} 小时 ${rest} 分钟`;
}

/** 结束早于（或等于零点）开始 = 跨到第二天。 */
export function crossesMidnight(start: string, end: string): boolean {
  const from = parseTimeOfDay(start);
  const to = parseTimeOfDay(end, { allowEndOfDay: true });
  return from !== null && to !== null && to < from;
}

/** 时段读回来的话：「每天 22:00–次日 06:00，共 8 小时（跨午夜）」。两头有一头不合法、或开始结束相同时返回 null。 */
export function windowReadback(start: string, end: string): string | null {
  const from = parseTimeOfDay(start);
  const to = parseTimeOfDay(end, { allowEndOfDay: true });
  if (from === null || to === null || from === to) return null;
  if (from === 0 && to === MINUTES_PER_DAY) return "全天 24 小时";
  if (to > from) return `每天 ${start}–${end}，共 ${durationText(to - from)}`;
  return `每天 ${start}–次日 ${end}，共 ${durationText(MINUTES_PER_DAY - from + to)}${to === 0 ? "" : "（跨午夜）"}`;
}

/** 提前预订时长的换算：不小于 24 小时才写。 */
export function leadTimeReadback(hours: number): string | null {
  if (!Number.isInteger(hours) || hours < 24) return null;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest === 0 ? `= ${days} 天` : `= ${days} 天 ${rest} 小时`;
}

/** 日期范围读回来的话。 */
export function dateRangeReadback(from: string | null, to: string | null): string | null {
  if (from !== null && to !== null) return `${from} 至 ${to}`;
  if (from !== null) return `从 ${from} 起`;
  return to !== null ? `到 ${to} 为止` : null;
}

export interface UrgentSegment {
  /** 提前多少小时下单（下限、上限）；下限 0 = 「提前不足 {上限} 小时」 */
  from: number;
  to: number;
  /** 这一段命中的那一档；null = 不在任何一档里，不接 */
  tier: UrgentTier | null;
}

const PROBE_ZONE = "UTC";
const PROBE_SERVICE = "2030-01-15T12:00";
const PROBE_INSTANT = Date.UTC(2030, 0, 15, 12, 0);

/**
 * 加急阶梯把「提前预订时长以内」分成的几段，每一段怎么收。
 * 每一段的结果直接问 `checkBookingWindow`（取这一段中间的一个时刻去试），不另写一套判断。
 */
export function urgentSegments(leadTimeHours: number, tiers: readonly UrgentTier[]): UrgentSegment[] {
  const bounds = [...new Set([...tiers.map((tier) => tier.withinHours).filter((hours) => hours < leadTimeHours), leadTimeHours])].sort((x, y) => x - y);
  const segments: UrgentSegment[] = [];
  let from = 0;
  for (const to of bounds) {
    const aheadMs = ((from + to) / 2) * 3_600_000;
    const result = checkBookingWindow({ saleFrom: null, saleTo: null, serviceTime: { start: "00:00", end: "24:00" }, leadTimeHours, urgentTiers: tiers }, { now: new Date(PROBE_INSTANT - aheadMs), serviceLocal: PROBE_SERVICE, timeZone: PROBE_ZONE });
    segments.push({ from, to, tier: result.ok ? result.urgentTier : null });
    from = to;
  }
  return segments.reverse();
}
