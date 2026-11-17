import assert from "node:assert/strict";
import { test } from "node:test";
import { ARRIVE_BY_RULES, arriveByIssue, arriveByMinutesAfterStart, arriveByOf, arrivesLate, clockAfterStart, inferArriveByDayOffset, isArriveByTime, stopArrivalOffsets } from "./arrive-by.ts";
import { segmentsToOptimize, suggestedOrder, suggestionSegments, suggestionStopsOf } from "./order-suggestion.ts";

test("格式：HH:MM 00:00–23:59，day_offset 只能 0 / 1", () => {
  for (const ok of ["00:00", "09:05", "23:59"]) assert.equal(isArriveByTime(ok), true, ok);
  for (const bad of ["24:00", "9:00", "09:60", "0900", "09:00:00", "", null, 900]) assert.equal(isArriveByTime(bad), false, String(bad));
  assert.equal(arriveByIssue("2030-11-20T09:00", { day_offset: 0, time: "25:00" }), "FORMAT");
  assert.equal(arriveByIssue("2030-11-20T09:00", { day_offset: 2 as 0, time: "10:00" }), "FORMAT");
  assert.equal(arriveByIssue("2030-11-20T9:00", { day_offset: 0, time: "10:00" }), "FORMAT", "用车时间写法不对");
});

test("范围：必须晚于用车开始（同一时刻不行），不晚于开始 + 24 小时", () => {
  const start = "2030-11-20T09:00";
  assert.equal(arriveByIssue(start, { day_offset: 0, time: "09:01" }), null);
  assert.equal(arriveByIssue(start, { day_offset: 0, time: "14:00" }), null);
  assert.equal(arriveByIssue(start, { day_offset: 0, time: "09:00" }), "NOT_AFTER_START");
  assert.equal(arriveByIssue(start, { day_offset: 0, time: "08:59" }), "NOT_AFTER_START");
  assert.equal(arriveByIssue(start, { day_offset: 1, time: "09:00" }), null, "正好 24 小时可以");
  assert.equal(arriveByIssue(start, { day_offset: 1, time: "09:01" }), "TOO_LATE");
  assert.equal(arriveByMinutesAfterStart(start, { day_offset: 0, time: "14:00" }), 300);
  assert.equal(arriveByMinutesAfterStart(start, { day_offset: 1, time: "09:00" }), ARRIVE_BY_RULES.maxMinutesAfterStart);
});

test("跨午夜：晚上 20:00 出发、次日 01:00 到合格；当天 01:00 不合格（早于出发）", () => {
  const start = "2030-11-20T20:00";
  assert.equal(arriveByIssue(start, { day_offset: 1, time: "01:00" }), null);
  assert.equal(arriveByMinutesAfterStart(start, { day_offset: 1, time: "01:00" }), 300);
  assert.equal(arriveByIssue(start, { day_offset: 0, time: "01:00" }), "NOT_AFTER_START");
  assert.equal(arriveByIssue(start, { day_offset: 0, time: "23:30" }), null);
  assert.equal(arriveByIssue("2030-11-20T23:59", { day_offset: 1, time: "00:00" }), null);
});

test("推断当天 / 次日：早于（含同一时刻）出发时刻的算次日；推断出来的总是合格的", () => {
  assert.equal(inferArriveByDayOffset("20:00", "01:00"), 1);
  assert.equal(inferArriveByDayOffset("20:00", "22:00"), 0);
  assert.equal(inferArriveByDayOffset("09:00", "09:00"), 1);
  assert.equal(inferArriveByDayOffset("", "10:00"), 0, "还没填出发时刻：按当天");
  for (let start = 0; start < 24 * 60; start += 37) {
    for (let at = 0; at < 24 * 60; at += 41) {
      const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
      const day = inferArriveByDayOffset(hhmm(start), hhmm(at));
      assert.equal(arriveByIssue(`2030-11-20T${hhmm(start)}`, { day_offset: day, time: hhmm(at) }), null, `${hhmm(start)} → ${day} ${hhmm(at)}`);
    }
  }
});

test("预计到达：开始 + 前面各段行驶 + 前面各经停的停留 + 每站占用；段数不够的为 null", () => {
  // 上车 →(60) 经停 1（停 60）→(30) 经停 2（停 90）→(45) 经停 3 →(20) 下车
  assert.deepEqual(stopArrivalOffsets([60, 30, 45, 20], [60, 90, 30]), [60, 150, 285]);
  assert.deepEqual(stopArrivalOffsets([60, 30, 45, 20], [60, 90, 30], 15), [60, 165, 315], "每站占用加在前面每个经停上");
  assert.deepEqual(stopArrivalOffsets([60], [60, 90]), [60, null]);
  assert.deepEqual(stopArrivalOffsets([], [60]), [null]);
  assert.deepEqual(clockAfterStart("09:00", 320), { dayOffset: 0, time: "14:20" });
  assert.deepEqual(clockAfterStart("20:00", 300), { dayOffset: 1, time: "01:00" });
  assert.equal(clockAfterStart("bad", 10), null);
});

test("晚到：预计晚于指定时间才算；正好到不算；算不出来不提示", () => {
  const start = "2030-11-20T09:00";
  assert.equal(arrivesLate(320, start, { day_offset: 0, time: "14:00" }), true);
  assert.equal(arrivesLate(300, start, { day_offset: 0, time: "14:00" }), false);
  assert.equal(arrivesLate(null, start, { day_offset: 0, time: "14:00" }), false);
  assert.equal(arrivesLate(900, "2030-11-20T20:00", { day_offset: 1, time: "01:00" }), true);
});

test("从 jsonb 读：合格写法才认", () => {
  assert.deepEqual(arriveByOf({ day_offset: 1, time: "01:00" }), { day_offset: 1, time: "01:00" });
  assert.equal(arriveByOf({ day_offset: 2, time: "01:00" }), null);
  assert.equal(arriveByOf({ day_offset: 0, time: "1:00" }), null);
  assert.equal(arriveByOf(undefined), null);
  assert.equal(arriveByOf("01:00"), null);
});

test("带指定到达时间的经停是固定点：只在固定点切出的段里重排，不跨固定点", () => {
  const P = { lat: 35.69, lng: 139.7 };
  const at = (name: string, i: number, arrive = false) => ({ name, lat: 35.3 + i / 10, lng: 139 + i / 10, stay_minutes: 60, ...(arrive ? { arrive_by: { day_offset: 0 as const, time: "11:00" } } : {}) });
  const waypoints = [at("a", 1), at("b", 2), at("横滨", 3, true), at("c", 4), at("d", 5)];
  const stops = suggestionStopsOf(waypoints, ["a", "b", "y", "c", "d"]);
  assert.deepEqual(stops.map((stop) => stop.fixed === true), [false, false, true, false, false]);
  assert.deepEqual(stops.map((stop) => stop.index), [0, 1, 2, 3, 4]);
  const segments = suggestionSegments(P, stops, P);
  assert.deepEqual(segments.map((segment) => segment.movable.map((stop) => stop.ref)), [["a", "b"], ["c", "d"]]);
  assert.equal(segmentsToOptimize(segments).length, 2, "两段各问一次");
  // 每段内部倒过来：固定点留在原位
  const order = suggestedOrder(stops, new Map([[0, ["b", "a"]], [1, ["d", "c"]]]));
  assert.deepEqual(order, ["b", "a", "y", "d", "c"]);
  // 固定点两边各只有 1 个可动经停：不调用
  assert.equal(segmentsToOptimize(suggestionSegments(P, suggestionStopsOf([at("a", 1), at("横滨", 3, true), at("c", 4)], ["a", "y", "c"]), P)).length, 0);
  // arrive_by 为 null 的不算固定
  assert.equal(suggestionStopsOf([{ lat: 1, lng: 2, arrive_by: null }], ["x"])[0]?.fixed, undefined);
});
