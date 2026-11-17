/**
 * 包车经停的指定到达时间（M9P-20 P3，ADR 0096 第三节第 6、7 小节；按「最晚到达」理解）在页面上的说法和计算：
 * - 客人只填时刻，不晚于出发时刻的按次日（domain 的 `inferArriveByDayOffset`），行内写「次日 01:00」让客人确认；
 * - 锁定的行的可读说明：「河口湖，须在 14:00 前到达，已锁定，不参与建议顺序，只能用上移 / 下移调整」；
 * - 预计晚到的提示：用车时间 + 逐段行驶 + 前面的停留 + 每站占用晚于指定时间时「预计 14:20 到，晚于指定的 14:00，请把上车时间提前至少 20 分钟」（只提示、不拦截）；
 * - 行程时间表的预计时刻（M9P-20 验收，ADR 0096 补记 2026-11-17）：上车「09:00 出发」，经停「09:31 到达浅草寺」「10:31 出发」，下车「13:20 到达新宿」；
 *   跨午夜写「次日 01:00」；指定了到达时间又预计晚到的那一行标红（除了颜色还有图标和文字）；
 * - 司机页、订单详情：「须在 14:00 前到达」「须在次日 01:00 前到达」。
 * 文案走键（`itineraryCopy`，M11-01）。
 */
import { arriveByMinutesAfterStart, arrivesLate, arriveByOf, clockAfterStart, inferArriveByDayOffset, isArriveByTime, stopArrivalOffsets } from "@nozomi/domain";
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

/** 按当前顺序到每个经停的时刻（用车开始后第几分钟）；没有路线、段数对不上（上车 → 各经停 → 下车）时为 null——不拿对不上的数说话 */
function arrivalOffsets(input: ArrivalInput): (number | null)[] | null {
  const { stops, legs } = input;
  if (legs === null || legs === undefined || legs.length !== stops.length + 1) return null;
  return stopArrivalOffsets(legs.map((leg) => leg.minutes), stops.map((stop) => stop.stay_minutes), input.stopOccupancyMinutes ?? 0);
}

/** 每个经停晚到的话，预计几点到、指定的是几点（都已写成「14:20」「次日 01:00」）、晚了几分钟；不晚、没指定、算不出来为 null */
function lateClocks(input: ArrivalInput): ({ eta: string; time: string; minutes: number } | null)[] {
  const { stops } = input;
  const startTime = input.serviceLocal.slice(11, 16);
  const offsets = arrivalOffsets(input);
  if (offsets === null) return stops.map(() => null);
  return stops.map((stop, index) => {
    const arriveBy = arriveByOf(stop.arrive_by);
    const eta = offsets[index] ?? null;
    if (arriveBy === null || eta === null || !arrivesLate(eta, input.serviceLocal, arriveBy)) return null;
    const clock = clockAfterStart(startTime, eta);
    const deadline = arriveByMinutesAfterStart(input.serviceLocal, arriveBy);
    return clock === null || deadline === null ? null : { eta: clockText(clock.dayOffset, clock.time), time: clockText(arriveBy.day_offset, arriveBy.time), minutes: eta - deadline };
  });
}

/**
 * 每个经停的晚到提示（和 `stops` 一一对应）：指定了到达时间、预计晚于它时为「预计 14:20 到，晚于指定的 14:00，请把上车时间提前至少 20 分钟」，其余为 null。
 * 提前的分钟数 = 预计到达 − 指定时间（上车提前多少，后面每一站就早到多少）。
 */
export function arrivalLateTexts(input: ArrivalInput): (string | null)[] {
  return lateClocks(input).map((late) => (late === null ? null : tidy(itineraryCopy("arriveByLate", late))));
}

/** 建议顺序那一栏的晚到提示：「横滨：预计 11:20 到，晚于指定的 11:00」；没有晚到的为空数组 */
export function suggestedLateTexts(input: ArrivalInput): string[] {
  return lateClocks(input).flatMap((late, index) => (late === null ? [] : [`${input.stops[index]?.name ?? ""}${tidy(itineraryCopy("arriveByLateStop", { ...late, name: "" }))}`]));
}

/**
 * 按当前顺序的时间线（用车开始后第几分钟）：每个经停的到达、离开（到达 + 停留 + 每站占用，和下一站的预计到达同一套算法），到下车点的时刻；
 * `at` 把分钟写成「09:31」「次日 01:00」。用车时间不对、没有路线、段数对不上时为 null。
 */
function stopTimeline(input: ArrivalInput): { at: (minutes: number) => string; stops: { arrive: number; depart: number }[]; end: number } | null {
  const startTime = input.serviceLocal.slice(11, 16);
  const offsets = arrivalOffsets(input);
  const lastLeg = input.legs?.[input.stops.length];
  if (offsets === null || lastLeg === undefined || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input.serviceLocal) || !isArriveByTime(startTime)) return null;
  const occupancy = input.stopOccupancyMinutes ?? 0;
  const stops = input.stops.map((stop, index) => {
    const arrive = offsets[index] ?? 0;
    return { arrive, depart: arrive + stop.stay_minutes + occupancy };
  });
  const at = (minutes: number): string => {
    const clock = clockAfterStart(startTime, minutes);
    return clock === null ? startTime : clockText(clock.dayOffset, clock.time);
  };
  return { at, stops, end: (stops[stops.length - 1]?.depart ?? 0) + lastLeg.minutes };
}

/** 行程时间表一行的预计时刻（M9P-20 验收）：都已写成「09:31 到达浅草寺」「10:31 出发」；`late` = 这一站指定了到达时间、预计晚到（标红） */
export interface RowTimes {
  arrive: string | null;
  depart: string | null;
  late: boolean;
}

/**
 * 行程时间表每一行的预计时刻，按行的 `key`（和 `scheduleRows` 的一致：`pickup`、`stop-0`…、`dropoff`）：
 * 上车「09:00 出发」；经停「09:31 到达浅草寺」，离开 = 到达 + 停留 + 每站占用（和下一站的预计到达同一套算法）「10:31 出发」；下车「13:20 到达新宿」。
 * 用车时间不对、没有路线、段数对不上时为空对象（不显示时刻）。跨午夜写「次日 01:00」。
 */
export function scheduleTimes(input: ArrivalInput & { dropoffName: string }): Record<string, RowTimes> {
  const timeline = stopTimeline(input);
  if (timeline === null) return {};
  const late = lateClocks(input);
  const times: Record<string, RowTimes> = { pickup: { arrive: null, depart: itineraryCopy("etaDepart", { time: timeline.at(0) }), late: false } };
  timeline.stops.forEach((stop, index) => {
    times[`stop-${index}`] = { arrive: itineraryCopy("etaArrive", { time: timeline.at(stop.arrive), name: input.stops[index]?.name ?? "" }), depart: itineraryCopy("etaDepart", { time: timeline.at(stop.depart) }), late: late[index] !== null };
  });
  times["dropoff"] = { arrive: itineraryCopy("etaArrive", { time: timeline.at(timeline.end), name: input.dropoffName }), depart: null, late: false };
  return times;
}

/** 右侧摘要里经停的一句（和 `stops` 一一对应）：「预计 09:31 到，10:31 出发」；算不出来为 null */
export function stopSummaryTimes(input: ArrivalInput): (string | null)[] {
  const timeline = stopTimeline(input);
  return input.stops.map((_, index) => {
    const stop = timeline?.stops[index];
    return timeline === null || stop === undefined ? null : tidy(itineraryCopy("etaSummary", { arrive: timeline.at(stop.arrive), depart: timeline.at(stop.depart) }));
  });
}
