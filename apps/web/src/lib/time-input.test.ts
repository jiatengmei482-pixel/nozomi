import { test } from "node:test";
import assert from "node:assert/strict";
import { crossesMidnight, dateRangeReadback, leadTimeReadback, tidyDate, tidyTime, urgentSegments, windowReadback } from "./time-input.ts";

test("时刻：各种写法都整理成 HH:mm；超出范围和认不出来的返回 null", () => {
  for (const [input, expected] of [["9", "09:00"], ["09", "09:00"], ["900", "09:00"], ["0900", "09:00"], ["9:00", "09:00"], ["9：00", "09:00"], ["9.30", "09:30"], ["930", "09:30"], ["23:59", "23:59"], [" 0 ", "00:00"], ["２２：００", "22:00"]] as const) {
    assert.equal(tidyTime(input), expected, input);
  }
  for (const input of ["", "24:00", "24", "9:60", "abc", "9:5", "12345", "-1"]) assert.equal(tidyTime(input), null, input);
});

test("日期：几种分隔写法都认；不存在的日期返回 null", () => {
  for (const input of ["20261008", "2026/10/8", "2026.10.08", "2026-10-8", "2026-10-08"]) assert.equal(tidyDate(input), "2026-10-08", input);
  for (const input of ["2026-02-30", "2026-13-01", "10/8/2026", "明天", ""]) assert.equal(tidyDate(input), null, input);
  assert.equal(tidyDate("2028-02-29"), "2028-02-29");
});

test("时段读回来的话：同一天、跨午夜、到零点、全天；写不成时段的不读", () => {
  assert.equal(windowReadback("08:00", "22:00"), "每天 08:00–22:00，共 14 小时");
  assert.equal(windowReadback("22:00", "06:00"), "每天 22:00–次日 06:00，共 8 小时（跨午夜）");
  assert.equal(windowReadback("18:00", "00:00"), "每天 18:00–次日 00:00，共 6 小时");
  assert.equal(windowReadback("00:00", "24:00"), "全天 24 小时");
  assert.equal(windowReadback("08:30", "09:15"), "每天 08:30–09:15，共 45 分钟");
  assert.equal(windowReadback("08:00", "08:00"), null);
  assert.equal(windowReadback("8", "22:00"), null);
  assert.equal(crossesMidnight("22:00", "06:00"), true);
  assert.equal(crossesMidnight("08:00", "22:00"), false);
});

test("提前预订时长的换算和日期范围的读法", () => {
  assert.equal(leadTimeReadback(23), null);
  assert.equal(leadTimeReadback(24), "= 1 天");
  assert.equal(leadTimeReadback(50), "= 2 天 2 小时");
  assert.equal(dateRangeReadback("2026-03-01", "2026-03-31"), "2026-03-01 至 2026-03-31");
  assert.equal(dateRangeReadback("2026-03-01", null), "从 2026-03-01 起");
  assert.equal(dateRangeReadback(null, "2026-03-31"), "到 2026-03-31 为止");
  assert.equal(dateRangeReadback(null, null), null);
});

test("加急阶梯分段：命中够用的最小一档；比最大一档还早、又不到提前时长的那一段不接", () => {
  const six = { withinHours: 6, surchargeMinor: 5000 };
  const twelve = { withinHours: 12, surchargeMinor: 3000 };
  assert.deepEqual(urgentSegments(24, [twelve, six]), [
    { from: 12, to: 24, tier: null },
    { from: 6, to: 12, tier: twelve },
    { from: 0, to: 6, tier: six },
  ]);
  // 最大一档正好等于提前预订时长：没有空档
  const full = { withinHours: 24, surchargeMinor: 1000 };
  assert.deepEqual(urgentSegments(24, [six, full]), [
    { from: 6, to: 24, tier: full },
    { from: 0, to: 6, tier: six },
  ]);
  assert.deepEqual(urgentSegments(24, []), [{ from: 0, to: 24, tier: null }]);
});

test("某个时区现在的日期：跨日界线时按那个时区算；认不出的时区返回 null", async () => {
  const { localToday } = await import("./time-input.ts");
  const instant = new Date("2026-10-08T16:30:00Z");
  assert.equal(localToday("Asia/Tokyo", instant), "2026-10-09");
  assert.equal(localToday("America/Los_Angeles", instant), "2026-10-08");
  assert.equal(localToday("Nowhere/Land", instant), null);
});
