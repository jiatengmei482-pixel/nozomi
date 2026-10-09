/**
 * 按城市时区算时间的规则（M1-03 起）：服务时间、夜间时段、提前预订时限。
 *
 * 需求文档「时区」：服务时间、夜间时段、出行日期、加急小时数都按服务城市当地时间计算；跨天时段（22:00–06:00）要单独处理。
 * 全是纯函数，浏览器里也能用（只依赖 Intl）。当地时间一律写成 `YYYY-MM-DDTHH:mm`，一天里的时刻写成 `HH:mm`。
 */

const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)$/;
const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)$/;
export const MINUTES_PER_DAY = 1440;

/** 一天里的时刻 `HH:mm` → 从零点起的分钟数；写法不对返回 null。`allowEndOfDay` 时接受 `24:00`（只用作时段的结束）。 */
export function parseTimeOfDay(text: string, options: { allowEndOfDay?: boolean } = {}): number | null {
  if (options.allowEndOfDay === true && text === "24:00") return MINUTES_PER_DAY;
  const match = TIME_OF_DAY.exec(text);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** 是不是真实存在的日期 `YYYY-MM-DD`。 */
export function isLocalDate(text: string): boolean {
  const match = LOCAL_DATE.exec(text);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 1 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** 每天重复的一个时段。结束早于开始 = 跨过午夜（22:00–06:00）；`00:00–24:00` = 全天。 */
export interface DailyWindow {
  start: string;
  end: string;
}

export type DailyWindowIssue = "INVALID_TIME" | "EMPTY_WINDOW";

/** 时段写得对不对：两头都是合法的时刻（结束可以是 24:00），而且不是空的（开始和结束相同）。没有问题返回 null。 */
export function dailyWindowIssue(window: DailyWindow): DailyWindowIssue | null {
  const start = parseTimeOfDay(window.start);
  const end = parseTimeOfDay(window.end, { allowEndOfDay: true });
  if (start === null || end === null) return "INVALID_TIME";
  return start === end ? "EMPTY_WINDOW" : null;
}

/** 时段换成一到两段 [开始, 结束) 的分钟区间（跨午夜的拆成两段）。 */
function segments(window: DailyWindow): [number, number][] {
  const start = parseTimeOfDay(window.start) ?? 0;
  const end = parseTimeOfDay(window.end, { allowEndOfDay: true }) ?? 0;
  if (start < end) return [[start, end]];
  return end === 0 ? [[start, MINUTES_PER_DAY]] : [[0, end], [start, MINUTES_PER_DAY]];
}

/**
 * 一个时刻（从零点起的分钟数）在不在时段里。**开始算在里面，结束也算在里面**：
 * 服务时间 08:00–22:00 的商品，22:00 整的用车是接的。跨午夜的时段同理（22:00–06:00 包含 22:00 和 06:00）。
 * 结束写成 `24:00` 和写成 `00:00` 是同一个时刻（次日零点）：08:00–24:00 和 08:00–00:00 都包含零点整。
 */
export function withinDailyWindow(window: DailyWindow, minuteOfDay: number): boolean {
  const start = parseTimeOfDay(window.start) ?? 0;
  const end = (parseTimeOfDay(window.end, { allowEndOfDay: true }) ?? 0) % MINUTES_PER_DAY;
  if (start === end) return start === 0;
  if (start < end) return minuteOfDay >= start && minuteOfDay <= end;
  return minuteOfDay >= start || minuteOfDay <= end;
}

/**
 * 同一个时段只留一种写法（保存时用）：全天是 `00:00–24:00`；其余的结束在午夜一律写成 `00:00`（`08:00–24:00` → `08:00–00:00`）。
 * 写法不对的原样返回，由 `dailyWindowIssue` 去报。
 */
export function normalizeDailyWindow(window: DailyWindow): DailyWindow {
  if (dailyWindowIssue(window) !== null || window.end !== "24:00" || window.start === "00:00") return window;
  return { start: window.start, end: "00:00" };
}

/**
 * 一段用车时间和每天重复的时段重叠了多少分钟（包车的夜间费按重叠的小时数算）。
 * 这里按「开始算、结束不算」的区间算长度：22:00–06:00 的时段长 480 分钟。用车可以跨好几天。
 * @param startMinuteOfDay 用车开始的当地时刻（从零点起的分钟数）
 */
export function overlapMinutes(window: DailyWindow, startMinuteOfDay: number, durationMinutes: number): number {
  if (durationMinutes <= 0) return 0;
  const end = startMinuteOfDay + durationMinutes;
  let total = 0;
  for (let day = 0; day * MINUTES_PER_DAY < end; day += 1) {
    for (const [from, to] of segments(window)) {
      const lo = Math.max(startMinuteOfDay, from + day * MINUTES_PER_DAY);
      const hi = Math.min(end, to + day * MINUTES_PER_DAY);
      if (hi > lo) total += hi - lo;
    }
  }
  return total;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let cached = formatters.get(timeZone);
  if (!cached) {
    cached = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    formatters.set(timeZone, cached);
  }
  return cached;
}

/** 某个时刻在某个时区的当地时间，拆成年月日时分。 */
function wallClock(instant: Date, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number } {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(instant).map((part) => [part.type, part.value]));
  return { year: Number(parts["year"]), month: Number(parts["month"]), day: Number(parts["day"]), hour: Number(parts["hour"]), minute: Number(parts["minute"]) };
}

const pad = (value: number, width = 2): string => String(value).padStart(width, "0");

/** 一个时刻在城市当地是哪一天、几点几分。 */
export function instantToLocal(instant: Date, timeZone: string): { date: string; minuteOfDay: number; dateTime: string } {
  const clock = wallClock(instant, timeZone);
  const date = `${pad(clock.year, 4)}-${pad(clock.month)}-${pad(clock.day)}`;
  return { date, minuteOfDay: clock.hour * 60 + clock.minute, dateTime: `${date}T${pad(clock.hour)}:${pad(clock.minute)}` };
}

/**
 * 城市当地时间 `YYYY-MM-DDTHH:mm` → 时刻。写法不对返回 null。
 * 夏令时的两种特殊情况：当地不存在的时间（拨快的那一小时）按拨快之后算；出现两次的时间（拨回的那一小时）取先到的那一次。
 * （日本、韩国没有夏令时，这是为以后的城市留的。）
 */
export function localDateTimeToInstant(local: string, timeZone: string): Date | null {
  const match = LOCAL_DATE_TIME.exec(local);
  if (!match || !isLocalDate(local.slice(0, 10))) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [number, number, number, number, number];
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  /** 把一个时刻当成 UTC 读出来的当地钟面，和它本身差多少毫秒（= 这个时刻的时区偏移） */
  const offsetAt = (time: number): number => {
    const clock = wallClock(new Date(time), timeZone);
    return Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute) - time;
  };
  // 用目标时刻前后的两个偏移各试一次：平时两个一样；在夏令时切换附近取能对上钟面的、较早的那个
  const candidates = [asUtc - offsetAt(asUtc - 86_400_000), asUtc - offsetAt(asUtc + 86_400_000)].sort((x, y) => x - y);
  for (const candidate of candidates) {
    if (instantToLocal(new Date(candidate), timeZone).dateTime === local) return new Date(candidate);
  }
  // 当地不存在的时间：按切换之前的偏移往后推，落在拨快之后
  return new Date(asUtc - offsetAt(asUtc - 86_400_000));
}

/** 加急的一档：在提前预订时长以内、离用车不到 `withinHours` 小时下单，加收 `surchargeMinor`。 */
export interface UrgentTier {
  withinHours: number;
  surchargeMinor: number;
}

export interface BookingWindowRules {
  /** 下单有效期（当地日期，含两端）；null = 不限 */
  saleFrom: string | null;
  saleTo: string | null;
  /** 每天的服务时间：用车时间必须在里面 */
  serviceTime: DailyWindow;
  /** 提前预订时长（小时）：离用车不到这么久就不能下单，除非开了加急 */
  leadTimeHours: number;
  /** 开了加急时的阶梯；没开传空数组 */
  urgentTiers: readonly UrgentTier[];
}

export type BookingWindowResult =
  /** 可以下单；`urgentTier` 不为 null 表示走的是加急，命中的是这一档 */
  | { ok: true; urgentTier: UrgentTier | null }
  | { ok: false; reason: "INVALID_SERVICE_TIME" | "OUTSIDE_SALE_PERIOD" | "OUTSIDE_SERVICE_TIME" | "SERVICE_TIME_PASSED" | "LEAD_TIME_TOO_SHORT" };

/**
 * 现在下单、在某个当地时间用车，按预订规则行不行。全部按城市时区算：
 * - 下单有效期看的是**下单这一刻**在城市当地是哪一天；
 * - 服务时间看的是用车那一刻在当地的钟面（当地不存在的时间按拨快之后的钟面）；
 * - 提前预订时长按真实经过的时间算（跨时区、跨夏令时都对）：正好等于提前时长的可以下单；
 * - 不足提前时长时，开了加急就取**最小的、仍然够用的那一档**（离用车 5 小时，有「12 小时内」「6 小时内」两档时命中「6 小时内」）；
 *   离用车的时间比最小的一档还短也算命中最小的一档——加急没有下限，只要用车时间还没过。
 */
export function checkBookingWindow(rules: BookingWindowRules, booking: { now: Date; serviceLocal: string; timeZone: string }): BookingWindowResult {
  const service = localDateTimeToInstant(booking.serviceLocal, booking.timeZone);
  if (service === null) return { ok: false, reason: "INVALID_SERVICE_TIME" };
  const today = instantToLocal(booking.now, booking.timeZone).date;
  if ((rules.saleFrom !== null && today < rules.saleFrom) || (rules.saleTo !== null && today > rules.saleTo)) return { ok: false, reason: "OUTSIDE_SALE_PERIOD" };
  // 用实际发生的那一刻的钟面去比（夏令时里不存在的时间已经按拨快之后算了），和下面算提前时长用的是同一个时刻
  const minuteOfDay = instantToLocal(service, booking.timeZone).minuteOfDay;
  if (!withinDailyWindow(rules.serviceTime, minuteOfDay)) return { ok: false, reason: "OUTSIDE_SERVICE_TIME" };
  const aheadMs = service.getTime() - booking.now.getTime();
  if (aheadMs <= 0) return { ok: false, reason: "SERVICE_TIME_PASSED" };
  const aheadHours = aheadMs / 3_600_000;
  if (aheadHours >= rules.leadTimeHours) return { ok: true, urgentTier: null };
  const tiers = [...rules.urgentTiers].sort((x, y) => x.withinHours - y.withinHours);
  const tier = tiers.find((candidate) => aheadHours <= candidate.withinHours);
  return tier ? { ok: true, urgentTier: tier } : { ok: false, reason: "LEAD_TIME_TOO_SHORT" };
}
