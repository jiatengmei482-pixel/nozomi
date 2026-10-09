import { test } from "node:test";
import assert from "node:assert/strict";
import type { CalendarDay, CalendarSegment } from "../api/prices.ts";
import { addMonths, cellView, clampMonth, daysInRange, exactFromText, exactTextMoney, monthDates, monthRange, monthTitle, monthWeeks, moveDay, orderedRange, sameDayIn, segmentAt, spokenDate } from "./price-calendar.ts";

const segment = (changes: Partial<CalendarSegment> = {}): CalendarSegment => ({ from: "00:00", to: "24:00", final: 20000, no_price_reason: null, base: "20000", unrounded: "20000", adjusts: [], ...changes });
const day = (segments: CalendarSegment[]): CalendarDay => ({ date: "2027-10-01", weekday: 5, holiday: null, price_rule: null, segments });
const up = { rule_id: "r1", name: "国庆旺季", steps: [{ type: "percent" as const, value: 2000, delta: "4000", after: "24000" }] };

test("月份：加减、范围、标题；网址里不合法或超出范围的换成本月", () => {
  assert.equal(addMonths("2026-10", 3), "2027-01");
  assert.equal(addMonths("2026-01", -1), "2025-12");
  assert.deepEqual(monthRange("2026-10-08"), { first: "2025-10", last: "2028-10" });
  assert.equal(clampMonth("2027-02", "2026-10-08"), "2027-02");
  for (const bad of [null, "2027-13", "abc", "2020-01", "2030-01"]) assert.equal(clampMonth(bad, "2026-10-08"), "2026-10");
  assert.equal(monthTitle("2027-03"), "2027 年 3 月");
  assert.equal(monthDates("2028-02").length, 29);
});

test("月历按周排，一周从周一开始，只有这个月的日子", () => {
  const weeks = monthWeeks("2027-10");
  assert.deepEqual(weeks[0], [null, null, null, null, "2027-10-01", "2027-10-02", "2027-10-03"]);
  assert.equal(weeks.length, 5);
  assert.deepEqual(weeks.at(-1), ["2027-10-25", "2027-10-26", "2027-10-27", "2027-10-28", "2027-10-29", "2027-10-30", "2027-10-31"]);
  assert.equal(spokenDate("2027-10-01"), "10 月 1 日周五");
});

test("键盘在月历里走：前后一天、前后一周、到周一 / 周日；走出这个月不动；换月份留在同一个日", () => {
  assert.equal(moveDay("2027-10-06", "ArrowLeft"), "2027-10-05");
  assert.equal(moveDay("2027-10-06", "ArrowDown"), "2027-10-13");
  assert.equal(moveDay("2027-10-06", "Home"), "2027-10-04");
  assert.equal(moveDay("2027-10-06", "End"), "2027-10-10");
  assert.equal(moveDay("2027-10-02", "Home"), "2027-10-01");
  assert.equal(moveDay("2027-10-01", "ArrowLeft"), null);
  assert.equal(moveDay("2027-10-28", "ArrowDown"), null);
  assert.equal(moveDay("2027-10-06", "a"), null);
  assert.equal(sameDayIn("2027-11", "2027-10-06"), "2027-11-06");
  assert.equal(sameDayIn("2027-02", "2027-01-31"), "2027-02-28");
  assert.deepEqual(orderedRange("2027-10-07", "2027-10-01"), { from: "2027-10-01", to: "2027-10-07" });
  assert.equal(daysInRange("2027-10-01", "2027-10-07"), 7);
});

test("「用车时间」落在哪一段：结束那一刻不算在内", () => {
  const split = day([segment({ to: "22:00" }), segment({ from: "22:00", final: 26400, adjusts: [up] })]);
  assert.equal(segmentAt(split, "10:00")?.final, 20000);
  assert.equal(segmentAt(split, "21:59")?.final, 20000);
  assert.equal(segmentAt(split, "22:00")?.final, 26400);
  assert.equal(segmentAt(split, "乱写")?.final, 20000);
});

test("格子：有价、调高调低、没有价格、停用、算不出价、分时段", () => {
  assert.deepEqual(cellView(day([segment()]), "10:00"), { kind: "price", final: 20000, trend: null, rules: [], split: false, disabled: false });
  assert.deepEqual(cellView(day([segment({ final: 24000, adjusts: [up] })]), "10:00"), { kind: "price", final: 24000, trend: "up", rules: ["国庆旺季"], split: false, disabled: false });
  assert.equal(cellView(day([segment({ final: 18000, adjusts: [up] })]), "10:00").trend, "down");
  assert.equal(cellView(day([segment({ final: 20000, adjusts: [up] })]), "10:00").trend, "same");
  assert.deepEqual(cellView(day([segment({ final: null, base: null, unrounded: null, no_price_reason: "NO_RULE" })]), "10:00"), { kind: "none", final: null, trend: null, rules: [], split: false, disabled: false });
  assert.equal(cellView(day([segment({ final: null, no_price_reason: "RULE_DISABLED" })]), "10:00").disabled, true);
  assert.equal(cellView(day([segment({ final: null, no_price_reason: "NOT_POSITIVE", adjusts: [up] })]), "10:00").kind, "bad");
  assert.equal(cellView(day([segment({ to: "22:00" }), segment({ from: "22:00" })]), "10:00").split, true);
});

test("接口里的精确值只换写法：整数、小数、负数，按币种写成金额", () => {
  assert.deepEqual(exactFromText("16072.9815"), { numerator: 160729815n, denominator: 10000n });
  assert.deepEqual(exactFromText("-1000"), { numerator: -1000n, denominator: 1n });
  assert.equal(exactTextMoney("16072.9815", "JPY"), "JPY 16,072.9815");
  assert.equal(exactTextMoney("4000", "JPY", true), "+JPY 4,000");
  assert.equal(exactTextMoney("-1000", "JPY", true), "−JPY 1,000");
  assert.equal(exactTextMoney("460050.5", "USD"), "USD 4,600.505");
});
