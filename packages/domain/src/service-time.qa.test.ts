/**
 * M1-03 时间规则的边界（测试工程师补）：以后报价靠这几个函数判断「接不接、加不加急」。
 * 已有的 service-time.test.ts 覆盖了主干；这里补跨午夜 / 全天 / 00:00 与 24:00、时限恰好相等（到毫秒）、
 * 加急阶梯的重叠 / 空档 / 首尾相接、下单有效期的两端、闰日、跨年、以及有夏令时的时区（含半小时夏令时、南半球）。
 * 名字以「【缺陷】」开头的是现在会失败的：复现、期望、实际写在断言的说明里。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type BookingWindowRules,
  MINUTES_PER_DAY,
  checkBookingWindow,
  dailyWindowIssue,
  instantToLocal,
  isLocalDate,
  localDateTimeToInstant,
  overlapMinutes,
  parseTimeOfDay,
  withinDailyWindow,
} from "./service-time.ts";

const minutes = (text: string): number => parseTimeOfDay(text, { allowEndOfDay: true }) as number;
const iso = (local: string, zone: string): string | null => localDateTimeToInstant(local, zone)?.toISOString() ?? null;
const HOUR = 3_600_000;

const rules = (extra: Partial<BookingWindowRules> = {}): BookingWindowRules => ({
  saleFrom: null,
  saleTo: null,
  serviceTime: { start: "00:00", end: "24:00" },
  leadTimeHours: 24,
  urgentTiers: [],
  ...extra,
});
/** 用车时间固定，按「提前多少毫秒下单」去问。 */
const ahead = (aheadMs: number, extra: Partial<BookingWindowRules> = {}, serviceLocal = "2026-10-10T09:00", timeZone = "Asia/Tokyo"): ReturnType<typeof checkBookingWindow> => {
  const service = localDateTimeToInstant(serviceLocal, timeZone) as Date;
  return checkBookingWindow(rules(extra), { now: new Date(service.getTime() - aheadMs), serviceLocal, timeZone });
};

test("时刻的写法：只认两位小时两位分钟的半角写法；24:00 只能当结束", () => {
  for (const bad of ["", " 08:00", "08:00 ", "8:00", "08:0", "08:60", "24:01", "25:00", "08:00:00", "０８:００", "08：00", "-1:00", "0800", "08.00", "ab:cd"]) {
    assert.equal(parseTimeOfDay(bad), null, JSON.stringify(bad));
    assert.equal(parseTimeOfDay(bad, { allowEndOfDay: true }), null, JSON.stringify(bad));
  }
  assert.deepEqual([parseTimeOfDay("00:00"), parseTimeOfDay("23:59"), parseTimeOfDay("24:00"), parseTimeOfDay("24:00", { allowEndOfDay: true })], [0, 1439, null, MINUTES_PER_DAY]);
});

test("时段的写法：00:00 / 24:00 的各种组合——全天只有 00:00–24:00 一种写法，开始不能是 24:00，两头相同是空的", () => {
  const issue = (start: string, end: string): unknown => dailyWindowIssue({ start, end });
  assert.equal(issue("00:00", "24:00"), null, "全天");
  assert.equal(issue("00:00", "00:00"), "EMPTY_WINDOW", "00:00–00:00 不是全天");
  assert.equal(issue("24:00", "24:00"), "INVALID_TIME");
  assert.equal(issue("24:00", "00:00"), "INVALID_TIME");
  assert.equal(issue("23:59", "24:00"), null, "一天的最后一分钟");
  assert.equal(issue("23:59", "00:00"), null);
  assert.equal(issue("00:01", "00:00"), null, "差一分钟就是全天的跨午夜时段");
  assert.equal(issue("12:00", "12:00"), "EMPTY_WINDOW");
  assert.equal(issue("12:00", "11:59"), null);
  assert.equal(issue("08:00", ""), "INVALID_TIME");
  assert.equal(issue("", ""), "INVALID_TIME");
});

test("时刻在不在时段里：跨午夜时段在午夜两侧、开始和结束那一分钟、它们各自的前后一分钟", () => {
  const within = (start: string, end: string, times: string[]): boolean[] => times.map((time) => withinDailyWindow({ start, end }, minutes(time)));
  assert.deepEqual(within("20:00", "04:00", ["19:59", "20:00", "20:01", "23:59", "00:00", "00:01", "03:59", "04:00", "04:01", "12:00"]), [false, true, true, true, true, true, true, true, false, false]);
  assert.deepEqual(within("23:59", "00:01", ["23:58", "23:59", "00:00", "00:01", "00:02"]), [false, true, true, true, false], "只有三分钟的跨午夜时段");
  assert.deepEqual(within("00:00", "24:00", ["00:00", "00:01", "12:00", "23:59"]), [true, true, true, true]);
  assert.deepEqual(within("00:00", "06:00", ["00:00", "06:00", "06:01", "23:59"]), [true, true, false, false], "从零点开始的不跨午夜时段");
  assert.deepEqual(within("00:01", "00:00", ["00:00", "00:01", "12:00", "23:59"]), [true, true, true, true], "00:01–次日 00:00：两头都含，等于全天");
  assert.deepEqual(within("12:00", "11:59", ["11:59", "12:00", "00:00"]), [true, true, true]);
});

test("【缺陷】服务时间「08:00–24:00」和「08:00–00:00」说的是同一个时段，零点整的用车结论应该一样（两端都含）", () => {
  // 复现：供应商经接口存「08:00–24:00」（接口接受这个写法），客人订零点整的车。
  // 期望：和「08:00–00:00」（界面上「08:00 到 次日 00:00」）一样接——文档写的是「两端都算在内」，24:00 就是次日 00:00。
  // 实际：「08:00–24:00」不接零点整，「08:00–00:00」接；而两种写法算出来的时段长度（overlapMinutes）是一样的。
  const asEndOfDay = { start: "08:00", end: "24:00" };
  const asMidnight = { start: "08:00", end: "00:00" };
  assert.equal(overlapMinutes(asEndOfDay, 0, MINUTES_PER_DAY), overlapMinutes(asMidnight, 0, MINUTES_PER_DAY), "两种写法的时段一样长");
  for (const time of ["07:59", "08:00", "23:59"]) assert.equal(withinDailyWindow(asEndOfDay, minutes(time)), withinDailyWindow(asMidnight, minutes(time)), time);
  assert.equal(
    withinDailyWindow(asEndOfDay, 0),
    withinDailyWindow(asMidnight, 0),
    "零点整：08:00–24:00 判成不在时段里，08:00–00:00 判成在时段里——同一个时段两个结论",
  );
});

test("和时段重叠的分钟数：00:00 / 24:00 两种结束写法等长；全天 = 用车时长；零长度和负数是 0；从 23:59 起的一分钟", () => {
  assert.equal(overlapMinutes({ start: "22:00", end: "24:00" }, minutes("21:00"), 240), 120);
  assert.equal(overlapMinutes({ start: "22:00", end: "00:00" }, minutes("21:00"), 240), 120);
  assert.equal(overlapMinutes({ start: "00:00", end: "24:00" }, minutes("23:59"), 3 * MINUTES_PER_DAY + 2), 3 * MINUTES_PER_DAY + 2, "全天：连着三天多");
  assert.equal(overlapMinutes({ start: "22:00", end: "06:00" }, minutes("23:59"), 1), 1);
  assert.equal(overlapMinutes({ start: "22:00", end: "06:00" }, minutes("06:00"), 1), 0, "06:00 起的那一分钟不算夜间（按「开始算、结束不算」量长度）");
  assert.equal(overlapMinutes({ start: "22:00", end: "06:00" }, minutes("22:00"), 8 * 60), 480, "正好盖住整个夜间时段");
  assert.equal(overlapMinutes({ start: "22:00", end: "06:00" }, minutes("00:00"), 7 * MINUTES_PER_DAY), 7 * 480, "一整周");
  assert.equal(overlapMinutes({ start: "22:00", end: "06:00" }, minutes("12:00"), -5), 0);
  assert.equal(overlapMinutes({ start: "23:00", end: "01:00" }, minutes("23:30"), 60), 60, "整段都在跨午夜的时段里");
});

test("日期：闰日、整百年、月末、年份位数", () => {
  assert.deepEqual(["2028-02-29", "2024-02-29", "2000-02-29", "2026-12-31", "2026-01-01", "9999-12-31"].map(isLocalDate), [true, true, true, true, true, true]);
  assert.deepEqual(["2026-02-29", "2100-02-29", "2026-04-31", "2026-00-10", "2026-13-01", "2026-01-00", "2026-1-1", "20260101", "0000-01-01", "2026-01-01T00:00", " 2026-01-01"].map(isLocalDate), Array(11).fill(false));
});

test("当地时间和时刻互换（东京、首尔没有夏令时）：闰日、月末、跨年、全年每一天的零点都是 UTC 前一天 15:00，来回一致", () => {
  assert.equal(iso("2028-02-29T23:59", "Asia/Tokyo"), "2028-02-29T14:59:00.000Z");
  assert.equal(iso("2028-03-01T00:00", "Asia/Tokyo"), "2028-02-29T15:00:00.000Z", "闰日结束的那一刻");
  assert.equal(iso("2027-02-29T10:00", "Asia/Tokyo"), null, "平年没有 2 月 29 日");
  assert.equal(iso("2026-12-31T23:59", "Asia/Seoul"), "2026-12-31T14:59:00.000Z");
  assert.equal(iso("2027-01-01T00:00", "Asia/Seoul"), "2026-12-31T15:00:00.000Z");
  assert.deepEqual(instantToLocal(new Date("2026-12-31T15:00:00.000Z"), "Asia/Tokyo"), { date: "2027-01-01", minuteOfDay: 0, dateTime: "2027-01-01T00:00" });
  assert.deepEqual(instantToLocal(new Date("2026-12-31T14:59:59.999Z"), "Asia/Tokyo"), { date: "2026-12-31", minuteOfDay: 1439, dateTime: "2026-12-31T23:59" }, "差一毫秒还是去年");
  assert.deepEqual(instantToLocal(new Date("2028-02-28T15:00:00.000Z"), "Asia/Seoul").date, "2028-02-29");
  for (const zone of ["Asia/Tokyo", "Asia/Seoul"]) {
    for (let day = 0; day < 366; day += 1) {
      const midnightUtc = Date.UTC(2028, 0, 1 + day) - 9 * HOUR;
      const local = instantToLocal(new Date(midnightUtc), zone);
      assert.equal(local.minuteOfDay, 0, `${zone} 第 ${day} 天`);
      assert.equal(localDateTimeToInstant(local.dateTime, zone)?.getTime(), midnightUtc, `${zone} ${local.dateTime}`);
      assert.equal(instantToLocal(new Date(midnightUtc - 1), zone).minuteOfDay, 1439, `${zone} 第 ${day} 天的前一毫秒`);
    }
  }
});

test("当地时间 → 时刻：写法不对、不存在的日期一律是 null，不猜", () => {
  for (const bad of ["2026-10-08T09:00:00", "2026-10-08T09:00Z", "2026-10-08T09:00+09:00", "2026-13-01T09:00", "2026-04-31T09:00", "2026-10-08T24:00", "2026-10-08T23:60", "2026-10-8T09:00", "2026/10/08T09:00", "0000-01-01T00:00", " 2026-10-08T09:00"]) {
    assert.equal(localDateTimeToInstant(bad, "Asia/Tokyo"), null, bad);
  }
});

test("夏令时（伦敦、悉尼、半小时夏令时的豪勋爵岛）：不存在的本地时间按拨快后算，出现两次的取先到的那一次；切换前后一天不受影响", () => {
  // 伦敦 2026-03-29 01:00 → 02:00；2026-10-25 02:00 → 01:00
  assert.equal(iso("2026-03-29T00:59", "Europe/London"), "2026-03-29T00:59:00.000Z");
  assert.equal(iso("2026-03-29T01:30", "Europe/London"), "2026-03-29T01:30:00.000Z", "不存在的 01:30 = 拨快后的 02:30（UTC 01:30）");
  assert.equal(iso("2026-03-29T02:00", "Europe/London"), "2026-03-29T01:00:00.000Z");
  assert.equal(iso("2026-10-25T01:30", "Europe/London"), "2026-10-25T00:30:00.000Z", "第一次的 01:30（还是夏令时）");
  assert.equal(iso("2026-10-25T00:59", "Europe/London"), "2026-10-24T23:59:00.000Z");
  assert.equal(iso("2026-10-25T02:00", "Europe/London"), "2026-10-25T02:00:00.000Z");
  // 悉尼（南半球）：2026-10-04 02:00 → 03:00；2026-04-05 03:00 → 02:00
  assert.equal(iso("2026-10-04T02:30", "Australia/Sydney"), "2026-10-03T16:30:00.000Z", "不存在的 02:30 = 拨快后的 03:30");
  assert.equal(iso("2026-04-05T02:30", "Australia/Sydney"), "2026-04-04T15:30:00.000Z", "第一次的 02:30（UTC+11）");
  assert.equal(iso("2026-04-05T03:00", "Australia/Sydney"), "2026-04-04T17:00:00.000Z");
  // 豪勋爵岛：夏令时只拨半小时。2026-10-04 02:00 → 02:30；2026-04-05 02:00 → 01:30
  assert.equal(iso("2026-10-04T02:15", "Australia/Lord_Howe"), "2026-10-03T15:45:00.000Z", "不存在的 02:15 = 拨快后的 02:45");
  assert.equal(iso("2026-04-05T01:45", "Australia/Lord_Howe"), "2026-04-04T14:45:00.000Z", "第一次的 01:45（UTC+11）");
  // 切换当天以外：来回一致
  for (const [zone, locals] of [
    ["Europe/London", ["2026-03-28T01:30", "2026-03-30T01:30", "2026-10-24T01:30", "2026-10-26T01:30"]],
    ["Australia/Sydney", ["2026-10-03T02:30", "2026-10-05T02:30", "2026-04-04T02:30", "2026-04-06T02:30"]],
    ["America/New_York", ["2026-03-07T02:30", "2026-03-09T02:30", "2026-10-31T01:30", "2026-11-02T01:30", "2026-03-08T23:59", "2026-11-01T23:59"]],
  ] as const) {
    for (const local of locals) assert.equal(instantToLocal(localDateTimeToInstant(local, zone) as Date, zone).dateTime, local, `${zone} ${local}`);
  }
});

test("夏令时：一年里每个整点和半点（纽约）——存在的本地时间来回一致；时刻 → 本地 → 时刻只在「出现两次」的那一小时回到第一次", () => {
  const zone = "America/New_York";
  let ambiguous = 0;
  for (let time = Date.UTC(2026, 0, 1); time < Date.UTC(2027, 0, 1); time += HOUR / 2) {
    const local = instantToLocal(new Date(time), zone).dateTime;
    const back = (localDateTimeToInstant(local, zone) as Date).getTime();
    if (back !== time) {
      ambiguous += 1;
      assert.equal(time - back, HOUR, `${local}：只应差在拨回的那一小时`);
      assert.match(local, /^2026-11-01T01:/);
    }
  }
  assert.equal(ambiguous, 2, "全年只有 11 月 1 日 01:00、01:30 的第二次回不到自己");
});

test("提前预订时限恰好相等：正好等于可以，差一毫秒不行；0 小时 = 用车时间之前随时可以；上限 720 小时", () => {
  assert.deepEqual(ahead(24 * HOUR), { ok: true, urgentTier: null });
  assert.deepEqual(ahead(24 * HOUR - 1), { ok: false, reason: "LEAD_TIME_TOO_SHORT" }, "差一毫秒");
  assert.deepEqual(ahead(24 * HOUR + 1), { ok: true, urgentTier: null });
  assert.deepEqual(ahead(1, { leadTimeHours: 0 }), { ok: true, urgentTier: null }, "提前 0 小时：差一毫秒也能订");
  assert.deepEqual(ahead(0, { leadTimeHours: 0 }), { ok: false, reason: "SERVICE_TIME_PASSED" }, "用车时间正好到了就不能订了");
  assert.deepEqual(ahead(-1, { leadTimeHours: 0 }), { ok: false, reason: "SERVICE_TIME_PASSED" });
  assert.deepEqual(ahead(720 * HOUR, { leadTimeHours: 720 }), { ok: true, urgentTier: null });
  assert.deepEqual(ahead(720 * HOUR - 1, { leadTimeHours: 720 }), { ok: false, reason: "LEAD_TIME_TOO_SHORT" });
});

test("提前预订时限跨月、跨年、跨闰日：按真实经过的小时数", () => {
  // 用车 2027-01-01 00:00（东京），提前 24 小时 = 2026-12-31 00:00（东京）= 12-30T15:00Z
  const newYear = (now: string): unknown => checkBookingWindow(rules(), { now: new Date(now), serviceLocal: "2027-01-01T00:00", timeZone: "Asia/Tokyo" });
  assert.deepEqual(newYear("2026-12-30T15:00:00.000Z"), { ok: true, urgentTier: null });
  assert.deepEqual(newYear("2026-12-30T15:00:00.001Z"), { ok: false, reason: "LEAD_TIME_TOO_SHORT" });
  // 用车 2028-03-01 08:00（东京），提前 48 小时：闰年里是 2 月 28 日 08:00，不是 2 月 27 日
  const leap = (now: string): unknown => checkBookingWindow(rules({ leadTimeHours: 48 }), { now: new Date(now), serviceLocal: "2028-03-01T08:00", timeZone: "Asia/Tokyo" });
  assert.deepEqual(leap("2028-02-27T23:00:00.000Z"), { ok: true, urgentTier: null }, "东京 2 月 28 日 08:00 下单：正好 48 小时");
  assert.deepEqual(leap("2028-02-27T23:00:01.000Z"), { ok: false, reason: "LEAD_TIME_TOO_SHORT" });
  // 首尔和东京同一个钟面时间是同一个时刻
  assert.equal(iso("2028-03-01T08:00", "Asia/Seoul"), iso("2028-03-01T08:00", "Asia/Tokyo"));
});

test("加急阶梯——首尾相接（最大一档 = 提前预订时长）：提前时长以内的每一刻都落在某一档里，档与档的分界归小的那一档", () => {
  const urgentTiers = [{ withinHours: 24, surchargeMinor: 1000 }, { withinHours: 12, surchargeMinor: 2000 }, { withinHours: 6, surchargeMinor: 5000 }];
  const tier = (aheadMs: number): unknown => {
    const result = ahead(aheadMs, { urgentTiers });
    return result.ok ? (result.urgentTier?.withinHours ?? "normal") : result.reason;
  };
  assert.equal(tier(24 * HOUR), "normal", "正好等于提前预订时长：算正常预订，不加收");
  assert.equal(tier(24 * HOUR - 1), 24);
  assert.equal(tier(12 * HOUR + 1), 24);
  assert.equal(tier(12 * HOUR), 12, "分界归小的那一档");
  assert.equal(tier(6 * HOUR + 1), 12);
  assert.equal(tier(6 * HOUR), 6);
  assert.equal(tier(1), 6, "比最小的一档还急：仍是最小的一档");
  assert.equal(tier(0), "SERVICE_TIME_PASSED");
  for (let step = 1; step < 24 * 60; step += 7) assert.notEqual(tier(step * 60_000), "LEAD_TIME_TOO_SHORT", `提前 ${step} 分钟`);
});

test("加急阶梯——有空档（最大一档小于提前预订时长）：空档里不接，空档两侧的那一毫秒各归各的", () => {
  const urgentTiers = [{ withinHours: 6, surchargeMinor: 5000 }];
  assert.deepEqual(ahead(24 * HOUR, { urgentTiers }), { ok: true, urgentTier: null });
  assert.deepEqual(ahead(24 * HOUR - 1, { urgentTiers }), { ok: false, reason: "LEAD_TIME_TOO_SHORT" }, "空档的上沿");
  assert.deepEqual(ahead(6 * HOUR + 1, { urgentTiers }), { ok: false, reason: "LEAD_TIME_TOO_SHORT" }, "空档的下沿");
  assert.deepEqual(ahead(6 * HOUR, { urgentTiers }), { ok: true, urgentTier: urgentTiers[0] });
});

test("加急阶梯——重叠、乱序、只有一档、没有档、提前时长为 0：都取「够用的最小一档」，没有档就不接", () => {
  const big = { withinHours: 12, surchargeMinor: 100 };
  const small = { withinHours: 3, surchargeMinor: 900 };
  const middle = { withinHours: 6, surchargeMinor: 500 };
  for (const order of [[big, middle, small], [small, big, middle], [middle, small, big]]) {
    assert.deepEqual(ahead(2 * HOUR, { urgentTiers: order }), { ok: true, urgentTier: small }, "三档都盖住：取最小的");
    assert.deepEqual(ahead(4 * HOUR, { urgentTiers: order }), { ok: true, urgentTier: middle });
    assert.deepEqual(ahead(7 * HOUR, { urgentTiers: order }), { ok: true, urgentTier: big });
  }
  assert.deepEqual(ahead(2 * HOUR, { urgentTiers: [] }), { ok: false, reason: "LEAD_TIME_TOO_SHORT" }, "没开加急");
  assert.deepEqual(ahead(2 * HOUR, { leadTimeHours: 0, urgentTiers: [small] }), { ok: true, urgentTier: null }, "提前时长是 0：用不到加急");
  assert.deepEqual(ahead(48 * HOUR, { urgentTiers: [big] }), { ok: true, urgentTier: null }, "够提前时长：不走加急");
  // 传进来的阶梯不能被改动（调用方还要用它显示）
  const frozen = Object.freeze([big, small, middle]);
  assert.deepEqual(ahead(2 * HOUR, { urgentTiers: frozen }), { ok: true, urgentTier: small });
  assert.deepEqual(frozen, [big, small, middle]);
});

test("下单有效期：只有一天的有效期、只有一头、当天的第一毫秒和最后一毫秒；看的是下单那天，不是用车那天", () => {
  const order = (now: string, extra: Partial<BookingWindowRules>, serviceLocal = "2027-06-01T10:00"): unknown => checkBookingWindow(rules(extra), { now: new Date(now), serviceLocal, timeZone: "Asia/Tokyo" });
  const oneDay = { saleFrom: "2026-12-31", saleTo: "2026-12-31" };
  assert.deepEqual(order("2026-12-30T14:59:59.999Z", oneDay), { ok: false, reason: "OUTSIDE_SALE_PERIOD" }, "东京 12 月 30 日的最后一毫秒");
  assert.deepEqual(order("2026-12-30T15:00:00.000Z", oneDay), { ok: true, urgentTier: null }, "东京 12 月 31 日的第一毫秒");
  assert.deepEqual(order("2026-12-31T14:59:59.999Z", oneDay), { ok: true, urgentTier: null }, "东京 12 月 31 日的最后一毫秒");
  assert.deepEqual(order("2026-12-31T15:00:00.000Z", oneDay), { ok: false, reason: "OUTSIDE_SALE_PERIOD" }, "东京已经是元旦");
  assert.deepEqual(order("2028-02-28T15:00:00.000Z", { saleFrom: "2028-02-29", saleTo: "2028-02-29" }, "2028-06-01T10:00"), { ok: true, urgentTier: null }, "闰日当天");
  assert.deepEqual(order("2028-02-29T15:00:00.000Z", { saleFrom: "2028-02-29", saleTo: "2028-02-29" }, "2028-06-01T10:00"), { ok: false, reason: "OUTSIDE_SALE_PERIOD" });
  assert.deepEqual(order("2020-01-01T00:00:00.000Z", { saleFrom: null, saleTo: "2026-12-31" }), { ok: true, urgentTier: null }, "只有结束");
  assert.deepEqual(order("2026-12-31T15:00:00.000Z", { saleFrom: "2027-01-01", saleTo: null }), { ok: true, urgentTier: null }, "只有开始");
  // 用车日期在有效期之外没关系：有效期只管下单那天
  assert.deepEqual(order("2026-12-31T00:00:00.000Z", oneDay, "2027-06-01T10:00"), { ok: true, urgentTier: null });
  // 同一个时刻在首尔和东京是同一天；换成纽约就还是前一天
  const sameInstant = { now: new Date("2026-12-30T15:00:00.000Z"), serviceLocal: "2027-06-01T10:00" };
  assert.deepEqual(checkBookingWindow(rules(oneDay), { ...sameInstant, timeZone: "Asia/Seoul" }), { ok: true, urgentTier: null });
  assert.deepEqual(checkBookingWindow(rules(oneDay), { ...sameInstant, timeZone: "America/New_York" }), { ok: false, reason: "OUTSIDE_SALE_PERIOD" });
});

test("几条规则同时不满足时报哪一条：写法不对 → 不在有效期 → 不在服务时间 → 用车时间已过 → 提前不够", () => {
  const everythingWrong = rules({ saleFrom: "2030-01-01", saleTo: null, serviceTime: { start: "08:00", end: "09:00" }, leadTimeHours: 720 });
  const check = (serviceLocal: string, now: string, book: BookingWindowRules = everythingWrong): unknown => checkBookingWindow(book, { now: new Date(now), serviceLocal, timeZone: "Asia/Tokyo" });
  assert.deepEqual(check("2026-02-30T12:00", "2026-10-01T00:00:00Z"), { ok: false, reason: "INVALID_SERVICE_TIME" });
  assert.deepEqual(check("2026-10-02T12:00", "2026-10-03T00:00:00Z"), { ok: false, reason: "OUTSIDE_SALE_PERIOD" });
  assert.deepEqual(check("2026-10-02T12:00", "2026-10-03T00:00:00Z", { ...everythingWrong, saleFrom: null }), { ok: false, reason: "OUTSIDE_SERVICE_TIME" });
  assert.deepEqual(check("2026-10-02T08:30", "2026-10-03T00:00:00Z", { ...everythingWrong, saleFrom: null }), { ok: false, reason: "SERVICE_TIME_PASSED" });
  assert.deepEqual(check("2026-10-04T08:30", "2026-10-03T00:00:00Z", { ...everythingWrong, saleFrom: null }), { ok: false, reason: "LEAD_TIME_TOO_SHORT" });
});

test("服务时间跨午夜 + 用车在次日凌晨：凌晨那一段按用车当天的钟面判断，提前时长照常按真实时间算", () => {
  const overnight = { serviceTime: { start: "20:00", end: "04:00" }, leadTimeHours: 6 };
  const check = (serviceLocal: string, now: string): unknown => checkBookingWindow(rules(overnight), { now: new Date(now), serviceLocal, timeZone: "Asia/Tokyo" });
  // 用车 10 月 11 日 00:00（东京）= 10-10T15:00Z；提前 6 小时 = 10-10T09:00Z
  assert.deepEqual(check("2026-10-11T00:00", "2026-10-10T09:00:00.000Z"), { ok: true, urgentTier: null });
  assert.deepEqual(check("2026-10-11T00:00", "2026-10-10T09:00:00.001Z"), { ok: false, reason: "LEAD_TIME_TOO_SHORT" });
  assert.deepEqual(check("2026-10-11T04:00", "2026-10-01T00:00:00Z"), { ok: true, urgentTier: null });
  assert.deepEqual(check("2026-10-11T04:01", "2026-10-01T00:00:00Z"), { ok: false, reason: "OUTSIDE_SERVICE_TIME" });
  assert.deepEqual(check("2026-10-10T19:59", "2026-10-01T00:00:00Z"), { ok: false, reason: "OUTSIDE_SERVICE_TIME" });
  assert.deepEqual(check("2026-12-31T23:59", "2026-10-01T00:00:00Z"), { ok: true, urgentTier: null }, "跨年夜");
  assert.deepEqual(check("2027-01-01T00:00", "2026-10-01T00:00:00Z"), { ok: true, urgentTier: null });
});

test("夏令时下的预订：出现两次的用车时间按第一次算提前时长；拨回那天多出来的一小时算进提前时长", () => {
  const zone = "America/New_York";
  // 2026-11-01 01:30 第一次 = 05:30Z（第二次是 06:30Z）
  const fold = (now: string): unknown => checkBookingWindow(rules({ leadTimeHours: 2 }), { now: new Date(now), serviceLocal: "2026-11-01T01:30", timeZone: zone });
  assert.deepEqual(fold("2026-11-01T03:30:00.000Z"), { ok: true, urgentTier: null }, "离第一次的 01:30 正好 2 小时");
  assert.deepEqual(fold("2026-11-01T03:30:00.001Z"), { ok: false, reason: "LEAD_TIME_TOO_SHORT" }, "离第二次的 01:30 还有 3 小时，但按第一次算");
  assert.deepEqual(fold("2026-11-01T05:30:00.000Z"), { ok: false, reason: "SERVICE_TIME_PASSED" }, "第一次的 01:30 已经到了");
  // 11 月 1 日 12:00（EST）往前 24 个真实小时 = 10 月 31 日 13:00（EDT）= 17:00Z
  const longDay = (now: string): unknown => checkBookingWindow(rules(), { now: new Date(now), serviceLocal: "2026-11-01T12:00", timeZone: zone });
  assert.deepEqual(longDay("2026-10-31T17:00:00.000Z"), { ok: true, urgentTier: null });
  assert.deepEqual(longDay("2026-10-31T17:00:00.001Z"), { ok: false, reason: "LEAD_TIME_TOO_SHORT" }, "钟面上是提前了 24 小时差一点，真实只差一毫秒");
  // 下单有效期的那一天在拨回当天有 25 小时：最后一毫秒仍然算当天
  const sale = (now: string): unknown => checkBookingWindow(rules({ saleFrom: "2026-11-01", saleTo: "2026-11-01" }), { now: new Date(now), serviceLocal: "2027-01-10T12:00", timeZone: zone });
  assert.deepEqual(sale("2026-11-01T04:00:00.000Z"), { ok: true, urgentTier: null }, "纽约 11 月 1 日 00:00（EDT）");
  assert.deepEqual(sale("2026-11-01T03:59:59.999Z"), { ok: false, reason: "OUTSIDE_SALE_PERIOD" });
  assert.deepEqual(sale("2026-11-02T04:59:59.999Z"), { ok: true, urgentTier: null }, "纽约 11 月 1 日 23:59:59（EST）——这一天有 25 小时");
  assert.deepEqual(sale("2026-11-02T05:00:00.000Z"), { ok: false, reason: "OUTSIDE_SALE_PERIOD" });
});

test("【缺陷】夏令时：不存在的用车时间「按拨快之后算」，服务时间的判断也应该按拨快之后的钟面", () => {
  // 复现：纽约 2026-03-08 02:00 拨快到 03:00，客人订 02:30 的车（这个钟面时间不存在）。
  // 期望：ADR 0016「本地时间不存在的按拨快后算」——实际发生在 03:30，所以服务时间 03:00–10:00 的商品应该接、00:00–02:45 的不该接；
  //       和算提前时长时用的时刻（03:30）是同一个时间。
  // 实际：提前时长按 03:30 算，服务时间却按写的 02:30 算——03:00–10:00 的判成不在服务时间，00:00–02:45 的判成可以订。
  // 影响：日本、韩国没有夏令时，现在不受影响；以后开有夏令时的城市才会遇到。
  const zone = "America/New_York";
  assert.equal(instantToLocal(localDateTimeToInstant("2026-03-08T02:30", zone) as Date, zone).dateTime, "2026-03-08T03:30", "前提：这个时间按 03:30 算");
  const book = (serviceTime: { start: string; end: string }): unknown => checkBookingWindow(rules({ serviceTime, leadTimeHours: 0 }), { now: new Date("2026-03-01T00:00:00Z"), serviceLocal: "2026-03-08T02:30", timeZone: zone });
  assert.deepEqual(
    [book({ start: "03:00", end: "10:00" }), book({ start: "00:00", end: "02:45" })],
    [{ ok: true, urgentTier: null }, { ok: false, reason: "OUTSIDE_SERVICE_TIME" }],
    "实际发生在 03:30 的用车：03:00–10:00 应该接，00:00–02:45 不该接",
  );
});
