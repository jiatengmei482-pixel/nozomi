/** 多日行程报价页的表单（M9T-09，ADR 0101 第二、十三节）：校验、转成标准行程单、地名存取、网址、出错说法、文案表。 */
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { TRIP_LIMITS, tripItineraryIssues, type TripItinerary } from "@nozomi/domain";
import { ApiError } from "../api/client.ts";
import type { TripPoint } from "./book-new.ts";
import {
  MAX_TRIP_DAYS,
  MAX_TRIP_STOPS,
  TRIP_STAY_OPTIONS,
  type TripFormDraft,
  addTripDay,
  hasTripErrors,
  initialTripDraft,
  newTripDay,
  newTripStop,
  removeTripDay,
  tripDayDate,
  tripDraftOf,
  tripFailureOf,
  tripIdOf,
  tripItineraryOf,
  tripLabelsOf,
  tripPlaceName,
  tripSearch,
  tripStepOf,
  validateTripDraft,
} from "./trip-form.ts";
import { loadTripLabels, saveTripLabels } from "./trip-labels-store.ts";
import { TRIP_TEXTS, tripCopy, tripReasonKey } from "./trip-texts.ts";

const airport: TripPoint = { name: "成田国际机场", lat: 35.772, lng: 140.3929, kind: "airport" };
const hotel: TripPoint = { name: "京王广场酒店", lat: 35.6905, lng: 139.6948, kind: "other" };
const temple: TripPoint = { name: "浅草寺", lat: 35.7148, lng: 139.7967, kind: "other" };
const hakone: TripPoint = { name: "箱根汤本", lat: 35.2329, lng: 139.1069, kind: null };

/** 3 天：接机到酒店；不用车；酒店 → 浅草寺（停 90 分钟）→ 机场 */
function threeDays(): TripFormDraft {
  const draft = initialTripDraft();
  const first = { ...(draft.days[0] as TripFormDraft["days"][number]), time: "14:30", start: airport, end: hotel, lodgingProvided: true };
  const idle = { ...newTripDay(first), idle: true };
  const last = { ...newTripDay(first), time: "09:00", stops: [{ ...newTripStop(), point: temple, stay: "90" }], end: airport };
  return { ...draft, date: "2030-03-28", passengers: 4, luggage: 3, days: [first, idle, last] };
}

const memory = new Map<string, string>();
(globalThis as { sessionStorage?: unknown }).sessionStorage ??= {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => void memory.set(key, value),
  removeItem: (key: string) => void memory.delete(key),
  clear: () => memory.clear(),
};
afterEach(() => (globalThis as unknown as { sessionStorage: Storage }).sessionStorage.clear());

test("上限跟服务端同一组常量：最多 14 天、每天最多 10 个中间地点（加上车、下车共 12 个点）；停留 0–720 分钟、30 分钟一档", () => {
  assert.equal(MAX_TRIP_DAYS, TRIP_LIMITS.maxDays);
  assert.equal(MAX_TRIP_STOPS, TRIP_LIMITS.maxItemsPerDay - 2);
  assert.equal(TRIP_STAY_OPTIONS[0], 0);
  assert.equal(TRIP_STAY_OPTIONS.at(-1), TRIP_LIMITS.maxStayMinutes);
  assert.equal(TRIP_STAY_OPTIONS.length, 25);
});

test("加一天：上车地点接着前一个用车日的最后下车地点（机场不接）；到 14 天不再加；只剩一天时不能删", () => {
  let draft = threeDays();
  draft = addTripDay(draft);
  assert.equal(draft.days.length, 4);
  assert.equal(draft.days[3]?.start, null, "前一天坐飞机走了，不接着机场");
  draft = { ...draft, days: draft.days.map((day, index) => (index === 2 ? { ...day, end: hakone } : day)) };
  draft = addTripDay(draft);
  assert.equal(draft.days[4]?.start, null, "前一个用车日是第 4 天（还没选下车地点）");
  const one = { ...initialTripDraft(), days: [{ ...newTripDay(), end: hotel }] };
  assert.deepEqual(addTripDay(one).days[1]?.start, hotel);
  let full = initialTripDraft();
  for (let index = 0; index < 20; index += 1) full = addTripDay(full);
  assert.equal(full.days.length, MAX_TRIP_DAYS);
  const single = initialTripDraft();
  assert.equal(removeTripDay(single, single.days[0]?.key ?? "").days.length, 1);
  assert.deepEqual(removeTripDay(draft, draft.days[1]?.key ?? "").days.map((day) => day.key), draft.days.filter((_, index) => index !== 1).map((day) => day.key));
});

test("日期：只有第 1 天选，之后逐日顺延；没选或不合法时为空", () => {
  assert.equal(tripDayDate({ date: "2030-02-28" }, 1), "2030-03-01");
  assert.equal(tripDayDate({ date: "2030-12-31" }, 1), "2031-01-01");
  assert.equal(tripDayDate({ date: "" }, 0), "");
  assert.equal(tripDayDate({ date: "2030-02-30" }, 0), "");
});

test("校验：日期、时间、上车 / 最后下车地点、中间地点和停留时长、首末日不能是空闲日、不同地点不超过 60 个", () => {
  assert.equal(hasTripErrors(validateTripDraft(threeDays())), false);
  const empty = initialTripDraft();
  const errors = validateTripDraft(empty);
  const key = empty.days[0]?.key ?? "";
  assert.equal(errors.date, "请选择日期");
  assert.deepEqual(errors.days[key], { time: "请填写上车时间", start: "请选择上车地点", end: "请选择最后下车地点" });
  const draft = threeDays();
  const stop = newTripStop();
  const broken: TripFormDraft = {
    ...draft,
    days: [{ ...(draft.days[0] as TripFormDraft["days"][number]), idle: true }, draft.days[1] as TripFormDraft["days"][number], { ...(draft.days[2] as TripFormDraft["days"][number]), time: "25:00", stops: [stop] }],
  };
  const found = validateTripDraft(broken);
  assert.deepEqual(found.days[broken.days[0]?.key ?? ""], { idle: "第一天要用车" });
  assert.deepEqual(found.days[broken.days[2]?.key ?? ""], { time: "请填写上车时间", stops: { [stop.key]: { point: "请选择这个地点", stay: "请选择停留时长" } } });
  const lastIdle = { ...draft, days: [draft.days[0] as TripFormDraft["days"][number], { ...(draft.days[2] as TripFormDraft["days"][number]), idle: true }] };
  assert.deepEqual(validateTripDraft(lastIdle).days[lastIdle.days[1]?.key ?? ""], { idle: "最后一天要用车" });
  // 61 个不同地点
  const many: TripFormDraft = { ...draft, days: Array.from({ length: 6 }, (_, d) => ({ ...newTripDay(), time: "09:00", start: { ...hotel, lat: 35 + d / 100 }, end: { ...hotel, lat: 35.5 + d / 100 }, stops: Array.from({ length: 10 }, (_, s) => ({ ...newTripStop(), point: { ...temple, lng: 139 + d / 10 + s / 1000 }, stay: "0" })) })) };
  assert.equal(validateTripDraft(many).general, "整个行程最多 60 个不同的地点，请减少一些地点，或联系客服", "6 天 × 12 个点，都不相同：72 个");
  const five = { ...many, days: many.days.slice(0, 5) };
  assert.equal(validateTripDraft(five).general, undefined, "5 天 × 12 个点：60 个，正好不超");
});

test("转成标准行程单：机场开头是 arrive_flight、结尾是 depart_flight；只发坐标；过夜点 = 当天最后下车地点（最后一天、坐飞机走的那天没有）；空闲日沿用前一晚；司机住宿；服务端校验通过", () => {
  const body = tripItineraryOf(threeDays());
  assert.deepEqual(body, {
    schemaVersion: 1,
    party: { adults: 4, children: 0, luggage: 3 },
    days: [
      { date: "2030-03-28", items: [{ kind: "arrive_flight", place: { lat: airport.lat, lng: airport.lng }, time: "14:30" }, { kind: "end", place: { lat: hotel.lat, lng: hotel.lng } }], nightAt: { lat: hotel.lat, lng: hotel.lng }, driverLodgingProvided: true },
      { date: "2030-03-29", items: [], nightAt: { lat: hotel.lat, lng: hotel.lng } },
      { date: "2030-03-30", items: [{ kind: "start", place: { lat: hotel.lat, lng: hotel.lng }, time: "09:00" }, { kind: "stop", place: { lat: temple.lat, lng: temple.lng }, stayMinutes: 90 }, { kind: "depart_flight", place: { lat: airport.lat, lng: airport.lng } }] },
    ],
  });
  assert.doesNotMatch(JSON.stringify(body), /京王|浅草|成田/, "行程单里不存地名");
  assert.deepEqual(tripItineraryIssues(body as unknown as TripItinerary), []);
  // 最后一天勾了司机住宿也不发（没有「当晚」）
  const draft = threeDays();
  const lastLodging = { ...draft, days: draft.days.map((day, index) => (index === 2 ? { ...day, lodgingProvided: true } : day)) };
  assert.equal("driverLodgingProvided" in (tripItineraryOf(lastLodging).days[2] ?? {}), false);
});

test("地名按行程单编号存进 sessionStorage，读回来和行程单的点一一对应；没有、坏了时为 null，显示名退回坐标", () => {
  const draft = threeDays();
  const labels = tripLabelsOf(draft);
  assert.deepEqual(labels, { v: 1, days: [["成田国际机场", "京王广场酒店"], [], ["京王广场酒店", "浅草寺", "成田国际机场"]] });
  const id = "a".repeat(43);
  assert.equal(loadTripLabels(id), null);
  saveTripLabels(id, labels);
  assert.deepEqual(loadTripLabels(id), labels);
  sessionStorage.setItem(`nozomi.trip-labels.${"b".repeat(43)}`, "{not json");
  assert.equal(loadTripLabels("b".repeat(43)), null);
  sessionStorage.setItem(`nozomi.trip-labels.${"c".repeat(43)}`, JSON.stringify({ v: 1, days: [[1]] }));
  assert.equal(loadTripLabels("c".repeat(43)), null);
  const body = tripItineraryOf(draft);
  assert.equal(tripPlaceName(body, labels, 2, 1), "浅草寺");
  assert.match(tripPlaceName(body, null, 2, 1), /^地图上选的位置（35\.71480, 139\.79670）$/);
});

test("存不了地名（浏览器不让存）时不出错", () => {
  const original = sessionStorage.setItem;
  sessionStorage.setItem = () => {
    throw new Error("QuotaExceededError");
  };
  try {
    assert.doesNotThrow(() => saveTripLabels("d".repeat(43), { v: 1, days: [] }));
  } finally {
    sessionStorage.setItem = original;
  }
});

test("读回来的行程单还原成表单：日期、人数、每天的点（地名取存的）、停留、空闲日、司机住宿", () => {
  const draft = threeDays();
  const restored = tripDraftOf(tripItineraryOf(draft), tripLabelsOf(draft));
  assert.equal(restored.date, "2030-03-28");
  assert.equal(restored.passengers, 4);
  assert.equal(restored.luggage, 3);
  assert.deepEqual(restored.days.map((day) => [day.idle, day.time, day.start?.name ?? null, day.stops.map((stop) => [stop.point?.name, stop.stay]), day.end?.name ?? null, day.lodgingProvided]), [
    [false, "14:30", "成田国际机场", [], "京王广场酒店", true],
    [true, "", null, [], null, false],
    [false, "09:00", "京王广场酒店", [["浅草寺", "90"]], "成田国际机场", false],
  ]);
  assert.equal(restored.days[0]?.start?.kind, "airport");
  assert.deepEqual(tripItineraryOf(restored), tripItineraryOf(draft), "还原后再转回去一样");
});

test("网址：?trip=<43 位编号>&step=2；格式不对的编号当作没有；第 1 步不带参数", () => {
  const id = "A1_-".repeat(10) + "abc";
  assert.equal(tripSearch(id, 2), `?trip=${id}&step=2`);
  assert.equal(tripSearch(id, 1), "");
  assert.equal(tripSearch(null, 2), "");
  assert.equal(tripIdOf(`?trip=${id}&step=2`), id);
  assert.equal(tripIdOf("?trip=short&step=2"), null);
  assert.equal(tripStepOf(`?trip=${id}&step=2`), 2);
  assert.equal(tripStepOf("?step=3"), 1);
});

test("出错说法：太复杂给转人工、过期回第 1 步、太频繁按秒 / 分钟、其他同官网", () => {
  assert.deepEqual(tripFailureOf(new ApiError(422, "TRIP_TOO_COMPLEX", "x", {}, null), "quote"), { text: "这个行程太复杂，暂时没法在线报价。", manual: true, gone: false });
  assert.deepEqual(tripFailureOf(new ApiError(404, "TRIP_NOT_FOUND", "x", {}, null), "read"), { text: "这个行程已过期或不存在，请重新填写。", manual: false, gone: true });
  assert.equal(tripFailureOf(new ApiError(429, "RATE_LIMITED", "x", {}, 30), "quote").text, "操作太频繁了，请 30 秒后再试。");
  assert.equal(tripFailureOf(new ApiError(429, "RATE_LIMITED", "x", {}, 90), "quote").text, "操作太频繁了，请 2 分钟后再试。");
  assert.equal(tripFailureOf(new ApiError(429, "RATE_LIMITED", "x", {}, null), "create").text, "操作太频繁了，请稍后再试。");
  assert.equal(tripFailureOf(new ApiError(500, "INTERNAL", "", {}, null), "quote").text, "系统暂时无法报价，请稍后再试。");
});

test("文案表：ADR 0101 第十三节的键按表原文；日文、英文没译时退回中文；原因码没列的用通用说法", () => {
  const adr: Record<string, string> = {
    title: "多日行程报价",
    day: "第 {n} 天",
    addDay: "加一天",
    addStop: "加一个地点",
    quote: "查看报价",
    "plan.one_car": "同一辆车跑完全程",
    "plan.daily_best": "每天选最划算的车",
    recommended: "推荐",
    unquoted: "这个方案暂时报不出：{reason}",
    "manual.title": "这个行程需要客服人工报价",
    "manual.cta": "转人工报价",
    book: "预订这个方案",
    bookManual: "提交预订，客服确认",
  };
  for (const [key, text] of Object.entries(adr)) assert.equal(TRIP_TEXTS.zh[key as keyof typeof TRIP_TEXTS.zh], text, key);
  for (const key of Object.keys(TRIP_TEXTS.zh) as (keyof typeof TRIP_TEXTS.zh)[]) {
    assert.ok((TRIP_TEXTS.zh[key] ?? "").length > 0, key);
    assert.equal(tripCopy(key, {}, "ja"), tripCopy(key), key);
    assert.equal(tripCopy(key, {}, "en"), tripCopy(key), key);
  }
  assert.equal(tripCopy("day", { n: 3 }), "第 3 天");
  assert.equal(tripCopy("unquoted", { reason: tripCopy(tripReasonKey("WORK_HOURS_HARD_LIMIT")) }), "这个方案暂时报不出：这一天用车时间太长，可以拆成两天或改坐新干线");
  assert.equal(tripReasonKey("SOMETHING_NEW"), "reason.other");
  assert.equal(tripReasonKey("toString"), "reason.other", "原型链上的名字不算");
});
