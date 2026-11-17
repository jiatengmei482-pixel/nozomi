/**
 * 包车经停的指定到达时间（M9P-20 P3，ADR 0096 第三节第 6、7 小节；按「最晚到达」理解）在页面上的说法和计算：
 * - 客人只填时刻，不晚于出发时刻的按次日（domain 的 `inferArriveByDayOffset`），行内写「次日 01:00」让客人确认；
 * - 锁定的行的可读说明：「河口湖，须在 14:00 前到达，已锁定，不参与建议顺序，只能用上移 / 下移调整」；
 * - 预计晚到的提示：用车时间 + 逐段行驶 + 前面的停留 + 每站占用晚于指定时间时「预计 14:20 到，晚于指定的 14:00」（只提示、不拦截）；
 * - 司机页、订单详情：「须在 14:00 前到达」「须在次日 01:00 前到达」。
 * 文案走键（`itineraryCopy`，M11-01）。
 */
import { arrivesLate, arriveByOf, clockAfterStart, inferArriveByDayOffset, isArriveByTime, stopArrivalOffsets } from "@nozomi/domain";
import type { SiteArriveBy } from "../api/site.ts";
import { itineraryCopy } from "./itinerary-texts.ts";

/** 「须在 次日 01:00」→「须在次日 01:00」：时刻前面那个空格是给数字留的，换成「次日」「第 N 天」时去掉（中文和中文之间不空格） */
const tidy = (text: string): string => text.replace(/ (次日|第 )/g, "$1");

/** 当天的「14:00」、次日的「次日 01:00」、更晚的「第 3 天 01:00」 */
function clockText(dayOffset: number, time: string): string {
  if (dayOffset <= 0) return time;
  return dayOffset === 1 ? itineraryCopy("arriveByNextDay", { time }) : itineraryCopy("arriveByLaterDay", { day: dayOffset + 1, time });
}

/** 指定到达时间写成「14:00」或「次日 01:00」；写法不对为 null */
export function arriveByClock(value: unknown): string | null {
  const arriveBy = arriveByOf(value);
  return arriveBy === null ? null : clockText(arriveBy.day_offset, arriveBy.time);
}

/** 「须在 14:00 前到达」「须在次日 01:00 前到达」（司机页、订单详情、行程列表）；没有为 null */
export function arriveByDeadlineText(value: unknown): string | null {
  const clock = arriveByClock(value);
  return clock === null ? null : tidy(itineraryCopy("arriveByDeadline", { time: clock }));
}

/** 页面上填的时刻 + 出发时刻 → 询价请求里的 `arrive_by`（不晚于出发时刻的按次日）；没填或写法不对为 null */
export function draftArriveBy(time: string | undefined, startTime: string): SiteArriveBy | null {
  if (time === undefined || !isArriveByTime(time)) return null;
  return { day_offset: inferArriveByDayOffset(startTime, time), time };
}

/** 行内要不要写「次日 01:00」：推断成次日时写，当天不写 */
export function nextDayHint(time: string | undefined, startTime: string): string | null {
  const arriveBy = draftArriveBy(time, startTime);
  return arriveBy === null || arriveBy.day_offset === 0 || !isArriveByTime(startTime) ? null : clockText(1, arriveBy.time);
}

/** 锁定的行的可读说明（`aria-describedby` 指向它） */
export function lockedDescription(name: string, arriveBy: SiteArriveBy): string {
  return tidy(itineraryCopy("arriveByLocked", { name, time: clockText(arriveBy.day_offset, arriveBy.time) }));
}

export interface ArrivalInput {
  /** 用车时间 `YYYY-MM-DDTHH:mm` */
  serviceLocal: string;
  /** 按当前顺序的经停（询价请求里的写法） */
  stops: readonly { name: string; stay_minutes: number; arrive_by?: SiteArriveBy | undefined }[];
  /** 逐段行驶分钟（报价应答的 `itinerary_route.legs`）；没有路线时 null */
  legs: readonly { minutes: number }[] | null | undefined;
  /** 每站占用（报价的 `stop_occupancy_minutes`；不知道按 0） */
  stopOccupancyMinutes: number | null | undefined;
}

/** 每个经停晚到的话，预计几点到、指定的是几点（都已写成「14:20」「次日 01:00」）；不晚、没指定、算不出来为 null */
function lateClocks(input: ArrivalInput): ({ eta: string; time: string } | null)[] {
  const { stops, legs } = input;
  const startTime = input.serviceLocal.slice(11, 16);
  // 没有路线、段数对不上时不提示（不拿对不上的数说话）
  if (legs === null || legs === undefined || legs.length !== stops.length + 1) return stops.map(() => null);
  const offsets = stopArrivalOffsets(legs.map((leg) => leg.minutes), stops.map((stop) => stop.stay_minutes), input.stopOccupancyMinutes ?? 0);
  return stops.map((stop, index) => {
    const arriveBy = arriveByOf(stop.arrive_by);
    const eta = offsets[index] ?? null;
    if (arriveBy === null || eta === null || !arrivesLate(eta, input.serviceLocal, arriveBy)) return null;
    const clock = clockAfterStart(startTime, eta);
    return clock === null ? null : { eta: clockText(clock.dayOffset, clock.time), time: clockText(arriveBy.day_offset, arriveBy.time) };
  });
}

/** 每个经停的晚到提示（和 `stops` 一一对应）：指定了到达时间、预计晚于它时为「预计 14:20 到，晚于指定的 14:00」，其余为 null */
export function arrivalLateTexts(input: ArrivalInput): (string | null)[] {
  return lateClocks(input).map((late) => (late === null ? null : tidy(itineraryCopy("arriveByLate", late))));
}

/** 建议顺序那一栏的晚到提示：「横滨：预计 11:20 到，晚于指定的 11:00」；没有晚到的为空数组 */
export function suggestedLateTexts(input: ArrivalInput): string[] {
  return lateClocks(input).flatMap((late, index) => (late === null ? [] : [`${input.stops[index]?.name ?? ""}${tidy(itineraryCopy("arriveByLateStop", { ...late, name: "" }))}`]));
}
