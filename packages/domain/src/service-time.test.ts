import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type BookingWindowRules,
  checkBookingWindow,
  dailyWindowIssue,
  instantToLocal,
  isLocalDate,
  localDateTimeToInstant,
  normalizeDailyWindow,
  overlapMinutes,
  parseTimeOfDay,
  withinDailyWindow,
} from "./service-time.ts";

const minutes = (text: string): number => parseTimeOfDay(text, { allowEndOfDay: true }) as number;

test("一天里的时刻：只认 HH:mm；24:00 只在允许时接受", () => {
  assert.deepEqual([parseTimeOfDay("00:00"), parseTimeOfDay("08:30"), parseTimeOfDay("23:59")], [0, 510, 1439]);
  for (const bad of ["24:00", "8:30", "08:60", "25:00", "0830", "08:30:00", "", " 08:30", "ab:cd"]) assert.equal(parseTimeOfDay(bad), null, bad);
  assert.equal(parseTimeOfDay("24:00", { allowEndOfDay: true }), 1440);
  assert.equal(parseTimeOfDay("24:01", { allowEndOfDay: true }), null);
});

test("日期：只认真实存在的 YYYY-MM-DD", () => {
  for (const ok of ["2026-10-08", "2028-02-29", "2026-12-31"]) assert.equal(isLocalDate(ok), true, ok);
  for (const bad of ["2026-02-29", "2026-13-01", "2026-00-10", "2026-10-32", "26-10-08", "2026/10/08", "2026-10-8", "", "2026-10-08T00:00"]) assert.equal(isLocalDate(bad), false, bad);
});

test("每天的时段：写法检查——时刻要合法，开始和结束不能相同；全天写成 00:00–24:00", () => {
  assert.equal(dailyWindowIssue({ start: "08:00", end: "22:00" }), null);
  assert.equal(dailyWindowIssue({ start: "22:00", end: "06:00" }), null);
  assert.equal(dailyWindowIssue({ start: "00:00", end: "24:00" }), null);
  assert.equal(dailyWindowIssue({ start: "08:00", end: "08:00" }), "EMPTY_WINDOW");
  assert.equal(dailyWindowIssue({ start: "24:00", end: "06:00" }), "INVALID_TIME");
  assert.equal(dailyWindowIssue({ start: "8:00", end: "22:00" }), "INVALID_TIME");
});

test("时刻在不在时段里：两头都算在里面；跨午夜的时段包含午夜两侧", () => {
  const day = { start: "08:00", end: "22:00" };
  assert.deepEqual(["07:59", "08:00", "15:00", "22:00", "22:01", "00:00"].map((time) => withinDailyWindow(day, minutes(time))), [false, true, true, true, false, false]);
  const night = { start: "22:00", end: "06:00" };
  assert.deepEqual(["21:59", "22:00", "23:59", "00:00", "03:00", "06:00", "06:01", "12:00"].map((time) => withinDailyWindow(night, minutes(time))), [false, true, true, true, true, true, false, false]);
  const allDay = { start: "00:00", end: "24:00" };
  assert.ok(["00:00", "12:00", "23:59"].every((time) => withinDailyWindow(allDay, minutes(time))));
  // 结束在零点整：22:00–00:00 包含 22:00 到当天结束，以及零点整
  const lateEvening = { start: "22:00", end: "00:00" };
  assert.deepEqual(["21:59", "22:00", "23:59", "00:00", "00:01"].map((time) => withinDailyWindow(lateEvening, minutes(time))), [false, true, true, true, false]);
});

test("和夜间时段重叠的分钟数：不跨天、跨午夜、一头压线、完全不沾、连着好几天", () => {
  const night = { start: "22:00", end: "06:00" };
  assert.equal(overlapMinutes(night, minutes("20:00"), 5 * 60), 180, "20:00 起用 5 小时：22:00–01:00 三小时在夜间");
  assert.equal(overlapMinutes(night, minutes("23:00"), 10 * 60), 420, "23:00 起用 10 小时：23:00–06:00 七小时");
  assert.equal(overlapMinutes(night, minutes("06:00"), 16 * 60), 0, "06:00–22:00 正好不沾");
  assert.equal(overlapMinutes(night, minutes("05:59"), 2), 1);
  assert.equal(overlapMinutes(night, minutes("21:59"), 2), 1);
  assert.equal(overlapMinutes(night, minutes("04:00"), 3 * 60), 120, "凌晨开始：04:00–06:00");
  assert.equal(overlapMinutes(night, minutes("10:00"), 48 * 60), 960, "两整天里有两个完整的夜间时段");
  assert.equal(overlapMinutes(night, minutes("10:00"), 0), 0);
  const evening = { start: "18:00", end: "23:00" };
  assert.equal(overlapMinutes(evening, minutes("17:00"), 3 * 60), 120);
  assert.equal(overlapMinutes(evening, minutes("22:30"), 26 * 60), 30 + 300, "当晚剩下的半小时，加上第二天的整段");
  assert.equal(overlapMinutes({ start: "00:00", end: "24:00" }, minutes("13:20"), 77), 77);
  assert.equal(overlapMinutes({ start: "22:00", end: "00:00" }, minutes("21:00"), 4 * 60), 120);
});

test("当地时间和时刻互换：东京、首尔是 UTC+9；写法不对返回 null", () => {
  assert.equal(localDateTimeToInstant("2026-10-08T09:00", "Asia/Tokyo")?.toISOString(), "2026-10-08T00:00:00.000Z");
  assert.equal(localDateTimeToInstant("2026-10-08T00:30", "Asia/Seoul")?.toISOString(), "2026-10-07T15:30:00.000Z");
  assert.equal(localDateTimeToInstant("2026-01-01T00:00", "Asia/Tokyo")?.toISOString(), "2025-12-31T15:00:00.000Z");
  assert.deepEqual(instantToLocal(new Date("2026-10-07T15:30:00Z"), "Asia/Tokyo"), { date: "2026-10-08", minuteOfDay: 30, dateTime: "2026-10-08T00:30" });
  assert.deepEqual(instantToLocal(new Date("2026-10-07T14:59:59Z"), "Asia/Tokyo").dateTime, "2026-10-07T23:59");
  for (const bad of ["2026-10-08 09:00", "2026-10-08T9:00", "2026-02-30T09:00", "2026-10-08T24:00", "2026-10-08", ""]) {
    assert.equal(localDateTimeToInstant(bad, "Asia/Tokyo"), null, bad);
  }
});

test("当地时间和时刻互换：有夏令时的城市——平时、拨快时不存在的时间、拨回时出现两次的时间", () => {
  // 纽约 2026-03-08 02:00 拨快到 03:00；2026-11-01 02:00 拨回 01:00
  assert.equal(localDateTimeToInstant("2026-03-07T12:00", "America/New_York")?.toISOString(), "2026-03-07T17:00:00.000Z");
  assert.equal(localDateTimeToInstant("2026-03-09T12:00", "America/New_York")?.toISOString(), "2026-03-09T16:00:00.000Z");
  assert.equal(localDateTimeToInstant("2026-03-08T01:59", "America/New_York")?.toISOString(), "2026-03-08T06:59:00.000Z");
  assert.equal(localDateTimeToInstant("2026-03-08T03:00", "America/New_York")?.toISOString(), "2026-03-08T07:00:00.000Z");
  assert.equal(localDateTimeToInstant("2026-03-08T02:30", "America/New_York")?.toISOString(), "2026-03-08T07:30:00.000Z", "不存在的 02:30 按拨快之后算（相当于 03:30）");
  assert.equal(localDateTimeToInstant("2026-11-01T01:30", "America/New_York")?.toISOString(), "2026-11-01T05:30:00.000Z", "出现两次的 01:30 取先到的那一次");
  assert.equal(localDateTimeToInstant("2026-11-01T02:00", "America/New_York")?.toISOString(), "2026-11-01T07:00:00.000Z");
  for (const local of ["2026-03-08T01:59", "2026-03-08T03:00", "2026-07-01T00:00", "2026-11-01T03:00"]) {
    assert.equal(instantToLocal(localDateTimeToInstant(local, "America/New_York") as Date, "America/New_York").dateTime, local);
  }
});

const rules = (extra: Partial<BookingWindowRules> = {}): BookingWindowRules => ({
  saleFrom: null,
  saleTo: null,
  serviceTime: { start: "06:00", end: "23:00" },
  leadTimeHours: 24,
  urgentTiers: [],
  ...extra,
});
const tokyo = (now: string, serviceLocal: string, extra: Partial<BookingWindowRules> = {}): unknown =>
  checkBookingWindow(rules(extra), { now: new Date(now), serviceLocal, timeZone: "Asia/Tokyo" });

test("提前预订时长：按真实经过的时间算；正好等于时限可以，差一分钟不行", () => {
  // 用车：东京 10 月 10 日 09:00 = UTC 10 月 10 日 00:00
  assert.deepEqual(tokyo("2026-10-09T00:00:00Z", "2026-10-10T09:00"), { ok: true, urgentTier: null }, "正好提前 24 小时");
  assert.deepEqual(tokyo("2026-10-08T00:00:00Z", "2026-10-10T09:00"), { ok: true, urgentTier: null });
  assert.deepEqual(tokyo("2026-10-09T00:01:00Z", "2026-10-10T09:00"), { ok: false, reason: "LEAD_TIME_TOO_SHORT" }, "只提前了 23 小时 59 分");
  assert.deepEqual(tokyo("2026-10-10T00:00:00Z", "2026-10-10T09:00"), { ok: false, reason: "SERVICE_TIME_PASSED" }, "用车时间已经到了");
  assert.deepEqual(tokyo("2026-10-11T00:00:00Z", "2026-10-10T09:00"), { ok: false, reason: "SERVICE_TIME_PASSED" });
  assert.deepEqual(tokyo("2026-10-09T23:59:00Z", "2026-10-10T09:00", { leadTimeHours: 0 }), { ok: true, urgentTier: null }, "不要求提前");
  assert.deepEqual(tokyo("2026-10-09T00:00:00Z", "不是时间"), { ok: false, reason: "INVALID_SERVICE_TIME" });
});

test("加急：不足提前时长时取最小的、仍然够用的一档；比所有档都早但不足提前时长的不行", () => {
  const urgentTiers = [{ withinHours: 12, surchargeMinor: 2000 }, { withinHours: 6, surchargeMinor: 5000 }, { withinHours: 2, surchargeMinor: 9000 }];
  const at = (hoursAhead: number): unknown => tokyo(new Date(Date.parse("2026-10-10T00:00:00Z") - hoursAhead * 3_600_000).toISOString(), "2026-10-10T09:00", { urgentTiers });
  assert.deepEqual(at(30), { ok: true, urgentTier: null });
  assert.deepEqual(at(24), { ok: true, urgentTier: null });
  assert.deepEqual(at(18), { ok: false, reason: "LEAD_TIME_TOO_SHORT" }, "不足 24 小时，又不在任何一档以内");
  assert.deepEqual(at(12), { ok: true, urgentTier: urgentTiers[0] }, "正好 12 小时：命中「12 小时内」");
  assert.deepEqual(at(11.99), { ok: true, urgentTier: urgentTiers[0] });
  assert.deepEqual(at(6), { ok: true, urgentTier: urgentTiers[1] }, "同时在 12 和 6 小时内：取最小的一档");
  assert.deepEqual(at(5), { ok: true, urgentTier: urgentTiers[1] });
  assert.deepEqual(at(2), { ok: true, urgentTier: urgentTiers[2] });
  assert.deepEqual(at(0.1), { ok: true, urgentTier: urgentTiers[2] }, "比最小的一档还急，仍然算最小的一档");
  assert.deepEqual(at(0), { ok: false, reason: "SERVICE_TIME_PASSED" });
  // 传进来的顺序不影响结果
  assert.deepEqual(tokyo("2026-10-09T19:00:00Z", "2026-10-10T09:00", { urgentTiers: [...urgentTiers].reverse() }), { ok: true, urgentTier: urgentTiers[1] });
});

test("服务时间：看用车的当地时刻；跨午夜的服务时间", () => {
  assert.deepEqual(tokyo("2026-10-01T00:00:00Z", "2026-10-10T06:00"), { ok: true, urgentTier: null });
  assert.deepEqual(tokyo("2026-10-01T00:00:00Z", "2026-10-10T23:00"), { ok: true, urgentTier: null });
  assert.deepEqual(tokyo("2026-10-01T00:00:00Z", "2026-10-10T05:59"), { ok: false, reason: "OUTSIDE_SERVICE_TIME" });
  assert.deepEqual(tokyo("2026-10-01T00:00:00Z", "2026-10-10T23:01"), { ok: false, reason: "OUTSIDE_SERVICE_TIME" });
  const overnight = { serviceTime: { start: "20:00", end: "04:00" } };
  assert.deepEqual(tokyo("2026-10-01T00:00:00Z", "2026-10-10T02:30", overnight), { ok: true, urgentTier: null });
  assert.deepEqual(tokyo("2026-10-01T00:00:00Z", "2026-10-10T12:00", overnight), { ok: false, reason: "OUTSIDE_SERVICE_TIME" });
  // 同一个时刻，换一个城市的时区就是另一个当地时间：按用车城市的当地时间判断，不按服务器的
  const seoulMorning = checkBookingWindow(rules(), { now: new Date("2026-10-01T00:00:00Z"), serviceLocal: "2026-10-10T06:00", timeZone: "Asia/Seoul" });
  assert.deepEqual(seoulMorning, { ok: true, urgentTier: null });
});

test("下单有效期：看下单这一刻在城市当地是哪一天，含两端；跨午夜的那一分钟按当地日期算", () => {
  const period = { saleFrom: "2026-10-05", saleTo: "2026-10-07" };
  // 东京 10 月 5 日 00:00 = UTC 10 月 4 日 15:00
  assert.deepEqual(tokyo("2026-10-04T14:59:00Z", "2026-11-10T09:00", period), { ok: false, reason: "OUTSIDE_SALE_PERIOD" }, "东京还是 10 月 4 日 23:59");
  assert.deepEqual(tokyo("2026-10-04T15:00:00Z", "2026-11-10T09:00", period), { ok: true, urgentTier: null }, "东京 10 月 5 日 00:00");
  assert.deepEqual(tokyo("2026-10-07T14:59:00Z", "2026-11-10T09:00", period), { ok: true, urgentTier: null }, "东京 10 月 7 日 23:59");
  assert.deepEqual(tokyo("2026-10-07T15:00:00Z", "2026-11-10T09:00", period), { ok: false, reason: "OUTSIDE_SALE_PERIOD" }, "东京已经是 10 月 8 日");
  assert.deepEqual(tokyo("2026-10-06T00:00:00Z", "2026-11-10T09:00", { saleFrom: "2026-10-06", saleTo: null }), { ok: true, urgentTier: null });
  assert.deepEqual(tokyo("2026-10-06T00:00:00Z", "2026-11-10T09:00", { saleFrom: null, saleTo: "2026-10-05" }), { ok: false, reason: "OUTSIDE_SALE_PERIOD" });
});

test("提前预订时长跨夏令时：按真实经过的小时数，不按钟面差", () => {
  // 纽约 2026-03-08 凌晨拨快一小时：3 月 7 日 12:00 到 3 月 8 日 12:00 钟面差 24 小时，实际只过了 23 小时
  const check = (now: string): unknown => checkBookingWindow(rules(), { now: new Date(now), serviceLocal: "2026-03-08T12:00", timeZone: "America/New_York" });
  assert.deepEqual(check("2026-03-07T17:00:00Z"), { ok: false, reason: "LEAD_TIME_TOO_SHORT" }, "纽约 3 月 7 日 12:00 下单：只提前了 23 小时");
  assert.deepEqual(check("2026-03-07T16:00:00Z"), { ok: true, urgentTier: null }, "纽约 3 月 7 日 11:00 下单：正好 24 小时");
});

test("结束在午夜的两种写法是同一个时段：24:00 和 00:00 判断一致（零点整算在里面），保存时统一成 00:00；全天只有 00:00–24:00", () => {
  for (const start of ["08:00", "22:00", "23:59", "00:01"]) {
    const [asEnd, asMidnight] = [{ start, end: "24:00" }, { start, end: "00:00" }];
    for (let minute = 0; minute < 1440; minute += 1) assert.equal(withinDailyWindow(asEnd, minute), withinDailyWindow(asMidnight, minute), `${start} @${minute}`);
    assert.equal(withinDailyWindow(asEnd, 0), true, "零点整是时段的结束，算在里面");
    assert.equal(withinDailyWindow(asEnd, 1), start === "00:01", "零点过一分只在 00:01 开始的时段里");
    assert.deepEqual(normalizeDailyWindow(asEnd), asMidnight);
    assert.deepEqual(normalizeDailyWindow(asMidnight), asMidnight);
  }
  const allDay = { start: "00:00", end: "24:00" };
  assert.deepEqual(normalizeDailyWindow(allDay), allDay);
  for (const minute of [0, 1, 720, 1439]) assert.equal(withinDailyWindow(allDay, minute), true);
  // 别的时段、写错的时段原样返回
  assert.deepEqual(normalizeDailyWindow({ start: "22:00", end: "06:00" }), { start: "22:00", end: "06:00" });
  assert.deepEqual(normalizeDailyWindow({ start: "24:00", end: "24:00" }), { start: "24:00", end: "24:00" });
  assert.deepEqual(normalizeDailyWindow({ start: "8点", end: "24:00" }), { start: "8点", end: "24:00" });
});

test("夏令时里不存在的用车时间：服务时间和提前时长用同一个时刻（拨快之后的钟面）", () => {
  const zone = "America/New_York";
  const book = (serviceTime: { start: string; end: string }, serviceLocal: string): unknown =>
    checkBookingWindow({ saleFrom: null, saleTo: null, serviceTime, leadTimeHours: 0, urgentTiers: [] }, { now: new Date("2026-03-01T00:00:00Z"), serviceLocal, timeZone: zone });
  // 2026-03-08 02:00 拨快到 03:00：02:30 不存在，按 03:30 算
  assert.deepEqual(book({ start: "03:00", end: "10:00" }, "2026-03-08T02:30"), { ok: true, urgentTier: null });
  assert.deepEqual(book({ start: "00:00", end: "02:45" }, "2026-03-08T02:30"), { ok: false, reason: "OUTSIDE_SERVICE_TIME" });
  // 存在的时间不受影响（前一天的 02:30 就是 02:30；拨回那天出现两次的 01:30 钟面还是 01:30）
  assert.deepEqual(book({ start: "00:00", end: "02:45" }, "2026-03-07T02:30"), { ok: true, urgentTier: null });
  assert.deepEqual(book({ start: "01:00", end: "01:45" }, "2026-11-01T01:30"), { ok: true, urgentTier: null });
});
