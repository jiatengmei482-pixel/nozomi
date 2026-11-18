import assert from "node:assert/strict";
import { test } from "node:test";
import { arrivalLateTexts, arriveByClock, arriveByDeadlineText, draftArriveBy, lockedDescription, nextDayHint, stopTimeTexts, suggestedLateTexts } from "./arrive-by-display.ts";
import { scheduleRows, waypointErrors, waypointLocked, waypointsBody } from "./charter-itinerary.ts";

const point = (name: string, lat: number) => ({ name, lat, lng: 139.6, kind: null, source: "google" as const, id: name });

test("当天 / 次日：只填时刻，不晚于出发时刻的按次日；行内只在次日时写「次日 01:00」", () => {
  assert.deepEqual(draftArriveBy("14:00", "09:00"), { day_offset: 0, time: "14:00" });
  assert.deepEqual(draftArriveBy("01:00", "20:00"), { day_offset: 1, time: "01:00" });
  assert.deepEqual(draftArriveBy("20:00", "20:00"), { day_offset: 1, time: "20:00" }, "同一时刻按次日（当天不合格）");
  assert.equal(draftArriveBy("", "09:00"), null);
  assert.equal(draftArriveBy(undefined, "09:00"), null);
  assert.equal(draftArriveBy("25:00", "09:00"), null);
  assert.equal(nextDayHint("01:00", "20:00"), "次日 01:00");
  assert.equal(nextDayHint("22:00", "20:00"), null);
  assert.equal(nextDayHint("01:00", ""), null, "还没填出发时刻：不写");
});

test("说法：「14:00」「次日 01:00」；司机页「须在 14:00 前到达」；锁定行的可读说明", () => {
  assert.equal(arriveByClock({ day_offset: 0, time: "14:00" }), "14:00");
  assert.equal(arriveByClock({ day_offset: 1, time: "01:00" }), "次日 01:00");
  assert.equal(arriveByClock(undefined), null);
  assert.equal(arriveByDeadlineText({ day_offset: 0, time: "14:00" }), "须在 14:00 前到达");
  assert.equal(arriveByDeadlineText({ day_offset: 1, time: "01:00" }), "须在次日 01:00 前到达");
  assert.equal(arriveByDeadlineText({ day_offset: 3, time: "01:00" }), null, "写法不对不显示");
  assert.equal(lockedDescription("河口湖", { day_offset: 0, time: "14:00" }), "河口湖，须在 14:00 前到达，已锁定，不参与建议顺序，只能用上移 / 下移调整");
});

test("预计晚到：用车时间 + 前面各段行驶 + 前面的停留 + 每站占用，晚于指定时间才提示；正好到不提示；段数对不上不提示", () => {
  // 09:00 出发 →(120) 河口湖（停 60）→(90) 箱根（14:00 前）→(60) 下车：预计 09:00 + 120 + 60 + 90 = 13:30
  const stops = [
    { name: "河口湖", stay_minutes: 60 },
    { name: "箱根", stay_minutes: 60, arrive_by: { day_offset: 0 as const, time: "14:00" } },
  ];
  const legs = [{ minutes: 120 }, { minutes: 90 }, { minutes: 60 }];
  assert.deepEqual(arrivalLateTexts({ serviceLocal: "2030-11-20T09:00", stops, legs, stopOccupancyMinutes: 0 }), [null, null]);
  assert.deepEqual(arrivalLateTexts({ serviceLocal: "2030-11-20T09:00", stops, legs, stopOccupancyMinutes: 30 }), [null, null], "加 30 分钟占用正好 14:00，不算晚");
  assert.deepEqual(arrivalLateTexts({ serviceLocal: "2030-11-20T09:00", stops, legs, stopOccupancyMinutes: 50 }), [null, "预计 14:20 到，晚于指定的 14:00，来不及。请把上车时间提前到 08:40 或更早，或减少前面的经停、缩短停留"]);
  assert.deepEqual(arrivalLateTexts({ serviceLocal: "2030-11-20T09:20", stops, legs, stopOccupancyMinutes: null }), [null, null], "09:20 出发 13:50 到：不晚");
  assert.deepEqual(arrivalLateTexts({ serviceLocal: "2030-11-20T09:40", stops, legs, stopOccupancyMinutes: null }), [null, "预计 14:10 到，晚于指定的 14:00，来不及。请把上车时间提前到 09:30 或更早，或减少前面的经停、缩短停留"], "09:40 出发就晚了，提示提前到 09:30");
  assert.deepEqual(arrivalLateTexts({ serviceLocal: "2030-11-20T09:00", stops, legs: legs.slice(0, 2), stopOccupancyMinutes: 0 }), [null, null], "段数对不上");
  assert.deepEqual(arrivalLateTexts({ serviceLocal: "2030-11-20T09:00", stops, legs: null, stopOccupancyMinutes: 0 }), [null, null], "还没有路线");
  // 跨午夜：20:00 出发，次日 01:00 前到，预计次日 01:30
  const night = [{ name: "箱根", stay_minutes: 30, arrive_by: { day_offset: 1 as const, time: "01:00" } }];
  assert.deepEqual(arrivalLateTexts({ serviceLocal: "2030-11-20T20:00", stops: night, legs: [{ minutes: 330 }, { minutes: 60 }], stopOccupancyMinutes: 0 }), ["预计次日 01:30 到，晚于指定的次日 01:00，来不及。请把上车时间提前到 19:30 或更早，或减少前面的经停、缩短停留"]);
  // 提前后的上车时间到了前一天：只写前半句
  assert.deepEqual(arrivalLateTexts({ serviceLocal: "2030-11-20T00:30", stops: [{ name: "箱根", stay_minutes: 0, arrive_by: { day_offset: 0 as const, time: "01:00" } }], legs: [{ minutes: 120 }, { minutes: 10 }], stopOccupancyMinutes: 0 }), ["预计 02:30 到，晚于指定的 01:00"]);
  assert.deepEqual(suggestedLateTexts({ serviceLocal: "2030-11-20T09:00", stops, legs, stopOccupancyMinutes: 50 }), ["箱根：预计 14:20 到，晚于指定的 14:00"]);
  assert.deepEqual(suggestedLateTexts({ serviceLocal: "2030-11-20T09:00", stops, legs, stopOccupancyMinutes: 0 }), []);
});

test("草稿：填了合格时刻的行锁定、请求里带 arrive_by（按出发时刻推断当天 / 次日）；没填的不带这个键；时刻不对要改", () => {
  const base = [
    { key: "a", point: point("河口湖", 35.5), stay: "60", arriveBy: "" },
    { key: "b", point: point("箱根", 35.23), stay: "60", arriveBy: "01:00" },
    { key: "c", point: point("横滨", 35.45), stay: "30" },
  ];
  assert.deepEqual(base.map(waypointLocked), [false, true, false]);
  const body = waypointsBody(base, "20:00");
  assert.ok(body !== null);
  assert.equal("arrive_by" in (body[0] as object), false);
  assert.deepEqual(body[1]?.arrive_by, { day_offset: 1, time: "01:00" });
  assert.equal("arrive_by" in (body[2] as object), false, "旧草稿没有这一项：照旧");
  assert.deepEqual(waypointsBody(base, "00:30")?.[1]?.arrive_by, { day_offset: 0, time: "01:00" });
  assert.deepEqual(waypointErrors([{ ...base[0]!, arriveBy: "1:00" }]), { a: { arriveBy: "请按 HH:MM 填写到达时间，或清空" } });
  assert.equal(waypointsBody([{ ...base[0]!, arriveBy: "1:00" }], "09:00"), null, "时刻不对不报价");
  // 行程列表：指定了的经停写「须在……前到达」
  assert.deepEqual(scheduleRows("新宿", "新宿", body).map((row) => row.deadline), [null, null, "须在次日 01:00 前到达", null, null]);
});

test("行程时间表每站的时刻（业主 2026-11-17）：上车「出发」、经停「到 · 出发」（出发 = 到 + 停留 + 每站占用）、下车「到」；跨午夜写次日；没有路线只写上车", () => {
  const stops = [
    { name: "河口湖", stay_minutes: 60 },
    { name: "箱根", stay_minutes: 60 },
  ];
  const legs = [{ minutes: 120 }, { minutes: 90 }, { minutes: 60 }];
  assert.deepEqual(stopTimeTexts({ serviceLocal: "2030-11-20T09:00", stops, legs, stopOccupancyMinutes: 10 }), {
    pickup: "09:00 出发",
    "stop-0": "预计 11:00 到 · 12:10 出发",
    "stop-1": "预计 13:40 到 · 14:50 出发",
    dropoff: "预计 15:50 到",
  });
  assert.deepEqual(stopTimeTexts({ serviceLocal: "2030-11-20T22:00", stops: [], legs: [{ minutes: 150 }], stopOccupancyMinutes: 0 }), { pickup: "22:00 出发", dropoff: "预计次日 00:30 到" });
  assert.deepEqual(stopTimeTexts({ serviceLocal: "2030-11-20T09:00", stops, legs: null, stopOccupancyMinutes: 0 }), { pickup: "09:00 出发" });
  assert.deepEqual(stopTimeTexts({ serviceLocal: "2030-11-20T09:00", stops, legs: legs.slice(0, 2), stopOccupancyMinutes: 0 }), { pickup: "09:00 出发" }, "段数对不上");
});
