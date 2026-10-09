/**
 * M1-03（测试工程师补）：页面上「读回来的话」和后端 / 报价用的 @nozomi/domain 对同一份输入结论一致。
 * 页面的文字是给供应商确认「系统理解的是不是我想的」用的——它说的和以后报价时算的不一样，比不显示更糟。
 * 这里把页面的整理、读回、分段和 domain 的 withinDailyWindow / overlapMinutes / checkBookingWindow / serviceRuleIssues 成对地对一遍。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MINUTES_PER_DAY, type UrgentTier, checkBookingWindow, dailyWindowIssue, overlapMinutes, parseTimeOfDay, serviceRuleIssues, withinDailyWindow } from "@nozomi/domain";
import type { ServiceRulesBody } from "../api/products.ts";
import { amountText, moneyText, readAmount } from "./product-display.ts";
import { type RulesForm, type RulesFormContext, formFromRules, readRulesForm } from "./service-rules-form.ts";
import { crossesMidnight, tidyDate, tidyTime, urgentSegments, windowReadback } from "./time-input.ts";

const EMPTY: ServiceRulesBody = {
  booking: { sale_from: null, sale_to: null, service_time: null, lead_time_hours: null, note: null },
  urgent: { enabled: false, daily_quota: null, tiers: [] },
  night: { enabled: false, window: null, amount: null, charge_unit: null },
  free_wait: { pickup: null, dropoff: null, general: null },
  addons: [],
  driver_languages: [],
};
const airport: RulesFormContext = { category: "airport_transfer", pickupPlace: { type: "airport", flightScope: "mixed" }, currency: "JPY", minimums: { pickup: 60, dropoff: 15, general: null }, addonNames: { a1: "儿童座椅" } };
const fresh = (changes: Partial<RulesForm> = {}, context = airport): RulesForm => ({ ...formFromRules(EMPTY, context), ...changes });
const hhmm = (minute: number): string => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const HOUR = 3_600_000;

test("时段读回来的话和 domain 一致：每一对「从 / 到」（半小时一格，外加 00:01、23:59）——读得出来 ⇔ domain 认为写法没问题；时长 = domain 量出来的重叠分钟数；写「次日」⇔ domain 把零点后的时刻算在时段里", () => {
  const marks = [...Array.from({ length: 48 }, (_, index) => index * 30), 1, 1439];
  let pairs = 0;
  for (const from of marks) {
    for (const to of marks) {
      const [start, end] = [hhmm(from), hhmm(to)];
      const readback = windowReadback(start, end);
      assert.equal(readback === null, dailyWindowIssue({ start, end }) !== null, `${start}–${end}：读不读得出来`);
      if (readback === null) continue;
      pairs += 1;
      const length = overlapMinutes({ start, end }, 0, MINUTES_PER_DAY);
      const hours = Math.floor(length / 60);
      const rest = length % 60;
      const duration = rest === 0 ? `${hours} 小时` : hours === 0 ? `${rest} 分钟` : `${hours} 小时 ${rest} 分钟`;
      assert.ok(readback.endsWith(`共 ${duration}`) || readback.endsWith(`共 ${duration}（跨午夜）`), `${start}–${end}：页面读成「${readback}」，domain 量出来是 ${duration}`);
      assert.equal(readback.includes("次日"), crossesMidnight(start, end), `${start}–${end}`);
      // 跨到第二天的时段：零点整、结束那一分钟都在里面；开始前一分钟不在
      if (crossesMidnight(start, end)) {
        assert.equal(withinDailyWindow({ start, end }, 0), true, `${start}–次日 ${end} 包含零点`);
        assert.equal(withinDailyWindow({ start, end }, to), true, `${start}–次日 ${end} 包含结束那一分钟`);
        if (from - 1 > to) assert.equal(withinDailyWindow({ start, end }, from - 1), false, `${start}–次日 ${end} 不包含开始前一分钟`);
      } else {
        assert.equal(withinDailyWindow({ start, end }, from), true);
        assert.equal(withinDailyWindow({ start, end }, to), true, "两端都算在内");
        if (to + 1 < MINUTES_PER_DAY) assert.equal(withinDailyWindow({ start, end }, to + 1), false);
      }
    }
  }
  assert.ok(pairs > 2000);
  assert.equal(windowReadback("00:00", "24:00"), "全天 24 小时");
  assert.equal(overlapMinutes({ start: "00:00", end: "24:00" }, 0, MINUTES_PER_DAY), MINUTES_PER_DAY);
});

test("时刻的整理和 domain 的写法一致：页面整理出来的每一个结果 domain 都认；domain 认的写法页面原样保留；24:00 手填不认（只有「全天」由页面填）", () => {
  const typed = ["0", "9", "09", "900", "0900", "9:00", "9：00", "9.00", "23", "2359", "23:59", "０９００", "9:5", "24", "2400", "24:00", "25:00", "9:60", "960", "abc", "", " 8 ", "8点", "-1", "12:345", "1:2:3"];
  for (const text of typed) {
    const tidy = tidyTime(text);
    if (tidy !== null) assert.notEqual(parseTimeOfDay(tidy), null, `${JSON.stringify(text)} → ${tidy}`);
  }
  for (let minute = 0; minute < MINUTES_PER_DAY; minute += 7) assert.equal(tidyTime(hhmm(minute)), hhmm(minute));
  assert.deepEqual(["24", "2400", "24:00", "25:00", "9:60", "960", "abc", "", "8点", "-1", "12:345", "1:2:3", "9:5"].map(tidyTime), Array(13).fill(null));
  assert.deepEqual(["0", "9", "900", "0900", "9:00", "9：00", "9.00", "０９００", " 8 "].map(tidyTime), ["00:00", "09:00", "09:00", "09:00", "09:00", "09:00", "09:00", "09:00", "08:00"]);
  assert.deepEqual(["2028-02-29", "2028/2/29", "20280229", "2028.02.29", "２０２８－０２－２９"].map(tidyDate), Array(5).fill("2028-02-29"));
  assert.deepEqual(["2027-02-29", "2026-13-01", "2026-04-31", "26-01-01", "2026-1", ""].map(tidyDate), Array(6).fill(null));
});

test("加急阶梯读回来的分段和 domain 逐分钟一致：提前预订时长 1–72 小时、各种阶梯（首尾相接、有空档、重叠、乱序、只有一档）——段内每一刻 checkBookingWindow 的结论都是这一段写的那样", () => {
  const sets: number[][] = [[], [1], [6], [6, 12], [12, 6, 2], [24, 12, 6], [3, 4, 5], [1, 71], [48], [72], [5, 10, 15, 20, 25, 30, 35, 40, 45, 50]];
  let checked = 0;
  for (const lead of [1, 2, 6, 12, 24, 36, 48, 72]) {
    for (const set of sets) {
      const tiers: UrgentTier[] = set.filter((hours) => hours <= lead).map((hours) => ({ withinHours: hours, surchargeMinor: hours * 100 }));
      const segments = urgentSegments(lead, tiers);
      // 分段首尾相接、盖满 0 到提前预订时长、从大到小排
      assert.equal(segments[0]?.to, lead, `${lead}/${set}`);
      assert.equal(segments.at(-1)?.from, 0);
      for (let index = 1; index < segments.length; index += 1) assert.equal(segments[index]?.to, segments[index - 1]?.from, `${lead}/${set}：第 ${index} 段和上一段相接`);
      const service = Date.UTC(2030, 5, 15, 3, 0);
      for (let minutes = 1; minutes < lead * 60; minutes += lead > 24 ? 13 : 1) {
        const result = checkBookingWindow({ saleFrom: null, saleTo: null, serviceTime: { start: "00:00", end: "24:00" }, leadTimeHours: lead, urgentTiers: tiers }, { now: new Date(service - minutes * 60_000), serviceLocal: "2030-06-15T12:00", timeZone: "Asia/Tokyo" });
        const segment = segments.find((entry) => minutes > entry.from * 60 && minutes <= entry.to * 60);
        assert.ok(segment, `${lead}/${set}：提前 ${minutes} 分钟不在任何一段里`);
        assert.deepEqual(result.ok ? result.urgentTier : null, segment.tier, `${lead}/${set}：提前 ${minutes} 分钟，页面写的是 ${JSON.stringify(segment)}`);
        if (segment.tier === null) assert.deepEqual(result, { ok: false, reason: "LEAD_TIME_TOO_SHORT" }, "页面写「不接」的那一段，domain 也不接");
        checked += 1;
      }
      // 正好等于提前预订时长：正常预订，不在任何一段里
      const exact = checkBookingWindow({ saleFrom: null, saleTo: null, serviceTime: { start: "00:00", end: "24:00" }, leadTimeHours: lead, urgentTiers: tiers }, { now: new Date(service - lead * HOUR), serviceLocal: "2030-06-15T12:00", timeZone: "Asia/Tokyo" });
      assert.deepEqual(exact, { ok: true, urgentTier: null });
      // 有没有空档：最大的一档小于提前预订时长 ⇔ 第一段是「不接」
      const largest = Math.max(0, ...tiers.map((tier) => tier.withinHours));
      assert.equal(segments[0]?.tier === null, largest < lead, `${lead}/${set}：空档`);
      assert.equal(segments.filter((entry) => entry.tier === null).length, largest < lead ? 1 : 0, "空档只会在最上面一段");
    }
  }
  assert.ok(checked > 5000);
});

test("表单读出来没有「写错了的」⇒ 提交的内容 domain 也挑不出毛病；读出来的内容再放回表单、再读一遍不变（保存后重新打开不会凭空变成「有未保存的修改」）", () => {
  const forms: Partial<RulesForm>[] = [
    {},
    { allDay: true, leadTime: "0" },
    { serviceStart: "22", serviceEnd: "600", leadTime: "２４", note: "  节假日提前联系  " },
    { serviceStart: "0:00", serviceEnd: "23:59", leadTime: "720" },
    { serviceStart: "18:00", serviceEnd: "0", leadTime: "48", urgent: true, quota: "1,000", tiers: [{ hours: "6", amount: "5,000" }, { hours: "48", amount: "0" }, { hours: "", amount: "" }, { hours: "12", amount: "２０００" }] },
    { saleMode: "range", saleFrom: "2026/10/1", saleTo: "20270331" },
    { saleMode: "range", saleFrom: "", saleTo: "2028-02-29" },
    { saleMode: "range", saleFrom: "2026-12-31", saleTo: "2026-12-31" },
    { night: true, nightStart: "22:00", nightEnd: "5", nightUnit: "per_hour", nightAmount: "1000000000" },
    { night: true, nightStart: "2359", nightEnd: "0", nightUnit: "per_order", nightAmount: "0" },
    { wait: { pickup: { mode: "limited", minutes: "1440" }, dropoff: { mode: "unlimited", minutes: "" }, general: { mode: "limited", minutes: "" } } },
    { addons: { a1: { enabled: true, price: "0", firstFree: true } }, languages: [{ language: "zh", price: "0" }, { language: "", price: "" }, { language: "ko", price: "3,000" }] },
  ];
  for (const [index, changes] of forms.entries()) {
    const reading = readRulesForm(fresh(changes), airport);
    assert.deepEqual(reading.problems, [], `第 ${index} 份表单`);
    assert.deepEqual(serviceRuleIssues(reading.rules, airport), [], `第 ${index} 份表单：domain 的结论`);
    const again = readRulesForm(formFromRules(reading.body, airport), airport);
    assert.deepEqual(again.problems, [], `第 ${index} 份：放回表单再读`);
    assert.deepEqual(again.body, reading.body, `第 ${index} 份：放回表单再读不变`);
  }
  // 包车、点对点
  for (const [category, general] of [["charter", 0], ["point_to_point", 15]] as const) {
    const context: RulesFormContext = { ...airport, category, pickupPlace: null, minimums: { pickup: null, dropoff: null, general } };
    const reading = readRulesForm(fresh({ allDay: true, leadTime: "3" }, context), context);
    assert.deepEqual([reading.problems, serviceRuleIssues(reading.rules, context)], [[], []]);
    assert.deepEqual(reading.body.free_wait, { pickup: null, dropoff: null, general: { mode: "limited", minutes: general } });
  }
});

test("页面拦下的写法 domain 也不认（页面没有比 domain 更宽）：把页面拦下的值硬塞给 domain，同一处也有问题", () => {
  const cases: [Partial<RulesForm>, string, (reading: ReturnType<typeof readRulesForm>["rules"]) => void, string][] = [
    [{ serviceStart: "08:00", serviceEnd: "08:00" }, "service-time-end", (rules) => void (rules.booking.serviceTime = { start: "08:00", end: "08:00" }), "/booking/service_time"],
    [{ leadTime: "721" }, "lead-time-input", (rules) => void (rules.booking.leadTimeHours = 721), "/booking/lead_time_hours"],
    [{ leadTime: "1.5" }, "lead-time-input", (rules) => void (rules.booking.leadTimeHours = 1.5), "/booking/lead_time_hours"],
    [{ leadTime: "6", urgent: true, tiers: [{ hours: "12", amount: "0" }] }, "tier-0-hours", (rules) => void (rules.urgent.tiers = [{ withinHours: 12, surchargeMinor: 0 }]), "/urgent/tiers/0/within_hours"],
    [{ leadTime: "24", urgent: true, tiers: [{ hours: "6", amount: "0" }, { hours: "6", amount: "1" }] }, "tier-1-hours", (rules) => void (rules.urgent.tiers = [{ withinHours: 6, surchargeMinor: 0 }, { withinHours: 6, surchargeMinor: 1 }]), "/urgent/tiers/1/within_hours"],
    [{ night: true, nightStart: "22:00", nightEnd: "06:00", nightAmount: "1000000001" }, "night-amount", (rules) => void (rules.night.amountMinor = 1_000_000_001), "/night/amount"],
    [{ night: true, nightStart: "22:00", nightEnd: "06:00", nightAmount: "1.5" }, "night-amount", (rules) => void (rules.night.amountMinor = 1.5), "/night/amount"],
    [{ wait: { ...fresh().wait, pickup: { mode: "limited", minutes: "59" } } }, "wait-pickup-minutes", (rules) => void (rules.freeWait.pickup = { mode: "limited", minutes: 59 }), "/free_wait/pickup/minutes"],
    [{ wait: { ...fresh().wait, dropoff: { mode: "limited", minutes: "1441" } } }, "wait-dropoff-minutes", (rules) => void (rules.freeWait.dropoff = { mode: "limited", minutes: 1441 }), "/free_wait/dropoff/minutes"],
    [{ saleMode: "range", saleFrom: "2027-01-02", saleTo: "2027-01-01" }, "sale-to", (rules) => { rules.booking.saleFrom = "2027-01-02"; rules.booking.saleTo = "2027-01-01"; }, "/booking/sale_to"],
  ];
  for (const [changes, target, force, path] of cases) {
    const reading = readRulesForm(fresh(changes), airport);
    assert.ok(reading.problems.some((problem) => problem.target === target), `页面应该在 ${target} 拦下：${JSON.stringify(reading.problems)}`);
    force(reading.rules);
    assert.ok(serviceRuleIssues(reading.rules, airport).some((issue) => issue.path === path), `domain 应该在 ${path} 也有问题`);
  }
});

test("金额：页面按币种把输入换成最小货币单位整数，和显示来回一致；日元、韩元没有小数；带两位小数的币种不会因为浮点数差一分钱", () => {
  for (const currency of ["JPY", "KRW"]) {
    assert.deepEqual(readAmount("3,000", currency), { ok: true, minor: 3000 });
    assert.deepEqual(readAmount("３０００", currency), { ok: true, minor: 3000 });
    assert.equal(readAmount("0.5", currency).ok, false, `${currency} 没有小数`);
    assert.equal(readAmount("1000000001", currency).ok, false, "超过上限");
    assert.deepEqual(readAmount("1000000000", currency), { ok: true, minor: 1_000_000_000 });
    assert.equal(amountText(3000, currency), "3000");
    assert.equal(moneyText(1234567, currency), `${currency} 1,234,567`);
  }
  for (const bad of ["-1", "1e3", "abc", "", "1.2.3", "１２a", "+5", "0x10", " "]) assert.equal(readAmount(bad, "JPY").ok, false, JSON.stringify(bad));
  // 两位小数的币种：每一分钱都来回一致（0.29、0.57、1.15、19.99 这些是浮点数乘 100 会出错的典型值）
  for (const currency of ["USD", "CNY", "HKD", "THB"]) {
    for (const cents of [0, 1, 29, 57, 58, 115, 1999, 2995, 100_001, 999_999_999, 1_000_000_000]) {
      const text = amountText(cents, currency);
      assert.deepEqual(readAmount(text, currency), { ok: true, minor: cents }, `${currency} ${text}`);
    }
    assert.deepEqual(readAmount("19.99", currency), { ok: true, minor: 1999 });
    assert.deepEqual(readAmount("0.29", currency), { ok: true, minor: 29 });
    assert.deepEqual(readAmount("1.1", currency), { ok: true, minor: 110 });
    assert.equal(readAmount("1.999", currency).ok, false, "多于两位小数不悄悄四舍五入");
    assert.equal(readAmount("10000000.01", currency).ok, false, "超过上限");
  }
});
