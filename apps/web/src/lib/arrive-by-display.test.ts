import assert from "node:assert/strict";
import { test } from "node:test";
import { arrivalLateTexts, arriveByClock, arriveByDeadlineText, draftArriveBy, lockedDescription, nextDayHint, scheduleTimes, stopSummaryTimes, suggestedLateTexts } from "./arrive-by-display.ts";
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
  assert.deepEqual(arrivalLateTexts({ serviceLocal: "2030-11-20T09:00", stops, legs, stopOccupancyMinutes: 50 }), [null, "预计 14:20 到，晚于指定的 14:00，请把上车时间提前至少 20 分钟"]);
  assert.deepEqual(arrivalLateTexts({ serviceLocal: "2030-11-20T09:20", stops, legs, stopOccupancyMinutes: null }), [null, null], "09:20 出发 13:50 到：不晚");
  assert.deepEqual(arrivalLateTexts({ serviceLocal: "2030-11-20T09:40", stops, legs, stopOccupancyMinutes: null }), [null, "预计 14:10 到，晚于指定的 14:00，请把上车时间提前至少 10 分钟"], "09:40 出发就晚了");
  assert.deepEqual(arrivalLateTexts({ serviceLocal: "2030-11-20T09:00", stops, legs: legs.slice(0, 2), stopOccupancyMinutes: 0 }), [null, null], "段数对不上");
  assert.deepEqual(arrivalLateTexts({ serviceLocal: "2030-11-20T09:00", stops, legs: null, stopOccupancyMinutes: 0 }), [null, null], "还没有路线");
  // 跨午夜：20:00 出发，次日 01:00 前到，预计次日 01:30
  const night = [{ name: "箱根", stay_minutes: 30, arrive_by: { day_offset: 1 as const, time: "01:00" } }];
  assert.deepEqual(arrivalLateTexts({ serviceLocal: "2030-11-20T20:00", stops: night, legs: [{ minutes: 330 }, { minutes: 60 }], stopOccupancyMinutes: 0 }), ["预计次日 01:30 到，晚于指定的次日 01:00，请把上车时间提前至少 30 分钟"]);
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

test("M9P-20 验收：行程时间表每一行的预计时刻——上车出发、经停到达和出发（停留 + 每站占用）、到达下车点；晚到的那一站标出来", () => {
  // 09:00 出发 →(31) 浅草寺（停 60）→(90) 箱根（12:30 前，停 30）→(60) 新宿；每站占用 10 分钟
  const stops = [
    { name: "浅草寺", stay_minutes: 60 },
    { name: "箱根", stay_minutes: 30, arrive_by: { day_offset: 0 as const, time: "12:30" } },
  ];
  const legs = [{ minutes: 31 }, { minutes: 90 }, { minutes: 60 }];
  const times = scheduleTimes({ serviceLocal: "2030-11-20T09:00", stops, legs, stopOccupancyMinutes: 10, dropoffName: "新宿" });
  assert.deepEqual(times, {
    pickup: { arrive: null, depart: "09:00 出发", late: false },
    "stop-0": { arrive: "09:31 到达浅草寺", depart: "10:41 出发", late: false },
    // 10:41 + 90 = 12:11，不晚于 12:30
    "stop-1": { arrive: "12:11 到达箱根", depart: "12:51 出发", late: false },
    dropoff: { arrive: "13:51 到达新宿", depart: null, late: false },
  });
  // 10:00 出发：箱根预计 13:11，晚于 12:30 → 标红，提示提前 41 分钟
  const late = { serviceLocal: "2030-11-20T10:00", stops, legs, stopOccupancyMinutes: 10 };
  assert.equal(scheduleTimes({ ...late, dropoffName: "新宿" })["stop-1"]?.late, true);
  assert.equal(scheduleTimes({ ...late, dropoffName: "新宿" })["stop-0"]?.late, false);
  assert.deepEqual(arrivalLateTexts(late), [null, "预计 13:11 到，晚于指定的 12:30，请把上车时间提前至少 41 分钟"]);
  assert.deepEqual(stopSummaryTimes(late), ["预计 10:31 到，11:41 出发", "预计 13:11 到，13:51 出发"]);
  // 没有经停：上车出发、到达下车点
  assert.deepEqual(scheduleTimes({ serviceLocal: "2030-11-20T09:00", stops: [], legs: [{ minutes: 45 }], stopOccupancyMinutes: null, dropoffName: "新宿" }), {
    pickup: { arrive: null, depart: "09:00 出发", late: false },
    dropoff: { arrive: "09:45 到达新宿", depart: null, late: false },
  });
  // 算不出来时不显示：没有路线、段数对不上、用车时间不对
  assert.deepEqual(scheduleTimes({ serviceLocal: "2030-11-20T09:00", stops, legs: null, stopOccupancyMinutes: 0, dropoffName: "新宿" }), {});
  assert.deepEqual(scheduleTimes({ serviceLocal: "2030-11-20T09:00", stops, legs: legs.slice(0, 2), stopOccupancyMinutes: 0, dropoffName: "新宿" }), {});
  assert.deepEqual(scheduleTimes({ serviceLocal: "2030-11-20", stops, legs, stopOccupancyMinutes: 0, dropoffName: "新宿" }), {});
  assert.deepEqual(stopSummaryTimes({ serviceLocal: "2030-11-20T09:00", stops, legs: null, stopOccupancyMinutes: 0 }), [null, null]);
});

test("M9P-20 验收：跨午夜的预计时刻写「次日 01:00」「第 3 天 01:00」", () => {
  const stops = [{ name: "箱根", stay_minutes: 60, arrive_by: { day_offset: 1 as const, time: "01:00" } }];
  const times = scheduleTimes({ serviceLocal: "2030-11-20T22:00", stops, legs: [{ minutes: 150 }, { minutes: 1_440 }], stopOccupancyMinutes: 0, dropoffName: "新宿" });
  assert.deepEqual(times["pickup"], { arrive: null, depart: "22:00 出发", late: false });
  assert.deepEqual(times["stop-0"], { arrive: "次日 00:30 到达箱根", depart: "次日 01:30 出发", late: false });
  assert.deepEqual(times["dropoff"], { arrive: "第 3 天 01:30 到达新宿", depart: null, late: false });
  assert.deepEqual(stopSummaryTimes({ serviceLocal: "2030-11-20T22:00", stops, legs: [{ minutes: 150 }, { minutes: 60 }], stopOccupancyMinutes: 0 }), ["预计次日 00:30 到，次日 01:30 出发"]);
});
