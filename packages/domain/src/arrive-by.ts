/**
 * 包车经停的「指定到达时间」（M9P-20 P3，ADR 0096 第三节第 6 小节；业主确认第十节第 3 条：按「最晚到达」理解）：不碰网络和数据库的规则。
 * - 写法 `{ day_offset: 0 | 1, time: "HH:MM" }`：用车当地时间，`day_offset` 相对用车日期（1 = 次日），能跨午夜；
 * - 校验：必须晚于用车开始、不晚于用车开始 + 24 小时（`arriveByIssue`）；
 * - 页面只填时刻，按时刻推断当天还是次日：不晚于用车开始时刻的算次日（`inferArriveByDayOffset`）——在合法范围里两者只有一个成立；
 * - 预计到达：用车开始 + 逐段行驶分钟 + 前面各经停的停留 + 每站占用（`stopArrivalOffsets`），晚于指定时间只提示、不拦截。
 * 只固定这个经停在行程里的位置（顺序建议不重排它），不影响价格、选档；随报价快照进订单，给司机看。
 * 时刻按当地钟面算（日本、韩国没有夏令时）。
 */

/** 指定到达时间：当天 / 次日 + 时刻 */
export interface ArriveBy {
  day_offset: 0 | 1;
  time: string;
}

export const ARRIVE_BY_RULES = {
  /** 最晚可以指定到用车开始后多少分钟（24 小时） */
  maxMinutesAfterStart: 24 * 60,
  /** 能写的 day_offset */
  dayOffsets: [0, 1] as const,
} as const;

const TIME_FORMAT = /^([01]\d|2[0-3]):([0-5]\d)$/;
const LOCAL_FORMAT = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):([0-5]\d)$/;

/** 「HH:MM」（00:00–23:59）是不是合格的时刻 */
export function isArriveByTime(value: unknown): value is string {
  return typeof value === "string" && TIME_FORMAT.test(value);
}

/** 「HH:MM」→ 一天里的第几分钟；不合格为 null */
export function minutesOfDay(time: string): number | null {
  const match = TIME_FORMAT.exec(time);
  return match === null ? null : Number(match[1]) * 60 + Number(match[2]);
}

/** 用车时间 `YYYY-MM-DDTHH:mm` 的时刻部分 → 一天里的第几分钟；不合格为 null */
function startMinutesOf(serviceLocal: string): number | null {
  const match = LOCAL_FORMAT.exec(serviceLocal);
  return match === null ? null : Number(match[1]) * 60 + Number(match[2]);
}

/** 指定到达时间是用车开始后第几分钟（可以是 0 或负数，表示不晚于开始）；格式不对为 null */
export function arriveByMinutesAfterStart(serviceLocal: string, arriveBy: ArriveBy): number | null {
  const start = startMinutesOf(serviceLocal);
  const at = minutesOfDay(arriveBy.time);
  if (start === null || at === null || !(ARRIVE_BY_RULES.dayOffsets as readonly number[]).includes(arriveBy.day_offset)) return null;
  return arriveBy.day_offset * 24 * 60 + at - start;
}

/**
 * 校验（ADR 0096：服务器校验，否则 400 `VALIDATION_FAILED`）：
 * - `FORMAT`：`time` 不是 HH:MM、`day_offset` 不是 0 / 1；
 * - `NOT_AFTER_START`：不晚于用车开始（同一时刻也不行）；
 * - `TOO_LATE`：晚于用车开始 + 24 小时。
 * 合格为 null。
 */
export function arriveByIssue(serviceLocal: string, arriveBy: ArriveBy): "FORMAT" | "NOT_AFTER_START" | "TOO_LATE" | null {
  const minutes = arriveByMinutesAfterStart(serviceLocal, arriveBy);
  if (minutes === null) return "FORMAT";
  if (minutes <= 0) return "NOT_AFTER_START";
  if (minutes > ARRIVE_BY_RULES.maxMinutesAfterStart) return "TOO_LATE";
  return null;
}

/**
 * 页面只填时刻时推断当天还是次日：时刻晚于用车开始的时刻 → 当天（0），不晚于（含同一时刻）→ 次日（1）。
 * 合法范围（开始后 0–24 小时，不含 0）里两者只有一个成立，所以不用客人另选。开始时刻或时刻不合格时按当天。
 */
export function inferArriveByDayOffset(startTime: string, time: string): 0 | 1 {
  const start = minutesOfDay(startTime);
  const at = minutesOfDay(time);
  if (start === null || at === null) return 0;
  return at <= start ? 1 : 0;
}

/**
 * 按当前顺序预计到第 i 个经停（从 0 起）的时刻，用车开始后第几分钟：
 * 前面各段行驶分钟 + 前面各经停的停留分钟 + 前面每个经停的默认占用（商品的「经停点默认占用」，ADR 0091；不知道时传 0）。
 * `legMinutes` 是上车 → 经停 1 → … → 下车逐段的行驶分钟（报价应答的 `itinerary_route.legs`）；段数不够到某个经停时，它和后面的都为 null。
 */
export function stopArrivalOffsets(legMinutes: readonly number[], stayMinutes: readonly number[], stopOccupancyMinutes = 0): (number | null)[] {
  const offsets: (number | null)[] = [];
  let elapsed = 0;
  for (let index = 0; index < stayMinutes.length; index++) {
    const leg = legMinutes[index];
    if (leg === undefined || offsets[index - 1] === null) {
      offsets.push(null);
      continue;
    }
    elapsed += leg;
    offsets.push(elapsed);
    elapsed += (stayMinutes[index] ?? 0) + stopOccupancyMinutes;
  }
  return offsets;
}

/** 用车开始后第几分钟 → 当地时刻（当天 / 次日 / 更晚 + HH:MM）：给「预计 14:20 到」用 */
export function clockAfterStart(startTime: string, minutesAfterStart: number): { dayOffset: number; time: string } | null {
  const start = minutesOfDay(startTime);
  if (start === null || !Number.isFinite(minutesAfterStart)) return null;
  const total = start + Math.trunc(minutesAfterStart);
  const dayOffset = Math.floor(total / (24 * 60));
  const rest = total - dayOffset * 24 * 60;
  return { dayOffset, time: `${String(Math.floor(rest / 60)).padStart(2, "0")}:${String(rest % 60).padStart(2, "0")}` };
}

/**
 * 预计晚到了没有：预计到达（开始后第几分钟）晚于指定时间（开始后第几分钟）。只提示、不拦截（ADR 0096 风险 10）。
 * 任一项算不出来时按不晚（不提示）。
 */
export function arrivesLate(estimatedMinutesAfterStart: number | null, serviceLocal: string, arriveBy: ArriveBy): boolean {
  if (estimatedMinutesAfterStart === null) return false;
  const deadline = arriveByMinutesAfterStart(serviceLocal, arriveBy);
  return deadline !== null && estimatedMinutesAfterStart > deadline;
}

/** 从任意值里取出合格写法的指定到达时间（订单、快照里读出来的 jsonb）；没有或写法不对为 null */
export function arriveByOf(value: unknown): ArriveBy | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const day = record["day_offset"];
  const time = record["time"];
  if ((day !== 0 && day !== 1) || !isArriveByTime(time)) return null;
  return { day_offset: day, time };
}
