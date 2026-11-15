/**
 * 工时与第二司机（原文 3.4、3.7；ADR 0100 第四节第 3 条）。纯函数：输入每个用车日的首段开始、末段结束、行驶分钟和米数。
 * - 拘束 = 末段结束 − 首段开始（含段间空档）+ 出入库（起点 / 终点在商品①里各 `garageMinutes`，否则 `awayGarageMinutes`）；
 * - 休息 = 次日拘束开始 − 当日拘束结束（两边都已含出入库）；只在同一辆车的相邻用车日之间算；
 * - 超拘束 13 h / 驾驶 9 h / 公里 600 → 当天加第二司机；休息少于 11 h → **次日**加第二司机；
 * - 超拘束 15 h 或休息少于 9 h → 第二司机也不行（`WORK_HOURS_HARD_LIMIT`）；
 * - 加了第二司机之后不再看驾驶和公里（两人轮换），拘束硬上限照看。
 */
import type { WorkHoursRules } from "./rules.ts";

export interface DayWorkInput {
  dayIndex: number;
  /** 行程起始日零点起的分钟（跨天累加），首段开始 / 末段结束 */
  startMinute: number;
  endMinute: number;
  driveMinutes: number;
  meters: number;
  startInBase: boolean;
  endInBase: boolean;
  /** 和前一个用车日是同一辆车（一车到底且没有换车）；false 时不算两天之间的休息 */
  sameVehicleAsPrevious: boolean;
}

export type SecondDriverReason = "BIND_OVER" | "DRIVE_OVER" | "KM_OVER" | "REST_SHORT";
export type WorkHoursStatus = "ok" | "second_driver" | "unquoted";
export type WorkHoursUnquoted = "WORK_HOURS_EXCEEDED" | "WORK_HOURS_HARD_LIMIT";

export interface DayWorkResult {
  dayIndex: number;
  bindMinutes: number;
  /** 和前一个同车用车日之间的休息；不算时为 null */
  restBeforeMinutes: number | null;
  reasons: SecondDriverReason[];
  status: WorkHoursStatus;
  unquoted: WorkHoursUnquoted | null;
}

/** `checkRest: false` = 每天各自最优方案：只按单日检查（每天不是同一辆车） */
export function evaluateWorkHours(days: readonly DayWorkInput[], rules: WorkHoursRules, options: { secondDriverEnabled: boolean; checkRest: boolean }): DayWorkResult[] {
  const garage = (inBase: boolean): number => (inBase ? rules.garageMinutes : rules.awayGarageMinutes);
  const results: DayWorkResult[] = [];
  let previous: { bindEnd: number } | null = null;
  for (const day of days) {
    if (day.endMinute < day.startMinute) throw new RangeError(`第 ${day.dayIndex} 天末段结束早于首段开始`);
    const bindStart = day.startMinute - garage(day.startInBase);
    const bindEnd = day.endMinute + garage(day.endInBase);
    const bindMinutes = bindEnd - bindStart;
    const restBeforeMinutes = options.checkRest && day.sameVehicleAsPrevious && previous !== null ? bindStart - previous.bindEnd : null;
    const reasons: SecondDriverReason[] = [];
    if (bindMinutes > rules.maxBindMinutes) reasons.push("BIND_OVER");
    if (day.driveMinutes > rules.maxDriveMinutes) reasons.push("DRIVE_OVER");
    if (day.meters > rules.maxDailyKm * 1000) reasons.push("KM_OVER");
    if (restBeforeMinutes !== null && restBeforeMinutes < rules.minRestMinutes) reasons.push("REST_SHORT");
    const hard = bindMinutes > rules.hardMaxBindMinutes || (restBeforeMinutes !== null && restBeforeMinutes < rules.absoluteMinRestMinutes);
    let status: WorkHoursStatus = "ok";
    let unquoted: WorkHoursUnquoted | null = null;
    if (hard) {
      status = "unquoted";
      unquoted = "WORK_HOURS_HARD_LIMIT";
    } else if (reasons.length > 0) {
      if (options.secondDriverEnabled) status = "second_driver";
      else {
        status = "unquoted";
        unquoted = "WORK_HOURS_EXCEEDED";
      }
    }
    results.push({ dayIndex: day.dayIndex, bindMinutes, restBeforeMinutes, reasons, status, unquoted });
    previous = { bindEnd };
  }
  return results;
}
