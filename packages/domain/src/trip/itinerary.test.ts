/** 标准行程单校验（ADR 0101 第二节）。 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { type TripDay, type TripItinerary, dayPoints, minuteOfDay, tripItineraryIssues, tripPlaceKey } from "./itinerary.ts";

const hotel = { lat: 35.69, lng: 139.7, kind: "hotel" as const };
const day = (date: string, extra: Partial<TripDay> = {}): TripDay => ({
  date,
  items: [
    { kind: "start", place: hotel, time: "09:00" },
    { kind: "stop", place: { lat: 35.71, lng: 139.79 }, stayMinutes: 90 },
    { kind: "end", place: hotel },
  ],
  ...extra,
});
const trip = (days: TripDay[], extra: Partial<TripItinerary> = {}): TripItinerary => ({ schemaVersion: 1, party: { adults: 2, children: 1, luggage: 3 }, preferences: { vehicleGroupIds: [], addons: [] }, days, ...extra });
const reasons = (it: TripItinerary): string[] => tripItineraryIssues(it).map((i) => `${i.path}:${i.reason}`);

test("合法的两天行程没有问题；中间可以有空闲日", () => {
  assert.deepEqual(tripItineraryIssues(trip([day("2027-03-28"), { date: "2027-03-29", items: [] }, day("2027-03-30")])), []);
});

test("日期必须升序且不重复；首日、末日不能是空闲日", () => {
  assert.deepEqual(reasons(trip([day("2027-03-29"), day("2027-03-28")])), ["/days/1/date:NOT_ASCENDING"]);
  assert.deepEqual(reasons(trip([day("2027-03-28"), day("2027-03-28")])), ["/days/1/date:NOT_ASCENDING"]);
  assert.deepEqual(reasons(trip([{ date: "2027-03-28", items: [] }])), ["/days/0/items:FIRST_DAY_IDLE", "/days/0/items:LAST_DAY_IDLE"]);
  assert.deepEqual(reasons(trip([day("2027-02-30")])), ["/days/0/date:INVALID"]);
});

test("天数 1–14", () => {
  const days = Array.from({ length: 15 }, (_, i) => day(`2027-04-${String(i + 1).padStart(2, "0")}`));
  assert.deepEqual(reasons(trip(days)), ["/days:OUT_OF_RANGE"]);
  assert.deepEqual(reasons(trip([])), ["/days:OUT_OF_RANGE"]);
  assert.deepEqual(tripItineraryIssues(trip(days.slice(0, 14))), []);
});

test("起点必须是 start / arrive_flight 且带时间；end 只能在最后；只有起点时要有过夜点", () => {
  assert.deepEqual(reasons(trip([day("2027-03-28", { items: [{ kind: "stop", place: hotel }, { kind: "end", place: hotel }] })])), ["/days/0/items/0/kind:MUST_START_WITH_START", "/days/0/items/0/time:TIME_REQUIRED"]);
  assert.deepEqual(reasons(trip([day("2027-03-28", { items: [{ kind: "start", place: hotel, time: "24:00" }, { kind: "end", place: hotel }] })])), ["/days/0/items/0/time:TIME_REQUIRED"]);
  assert.deepEqual(reasons(trip([day("2027-03-28", { items: [{ kind: "start", place: hotel, time: "09:00" }, { kind: "end", place: hotel }, { kind: "stop", place: hotel }] })])), ["/days/0/items/1/kind:END_NOT_LAST"]);
  assert.deepEqual(reasons(trip([day("2027-03-28", { items: [{ kind: "start", place: hotel, time: "09:00" }] })])), ["/days/0/items:TOO_FEW_POINTS"]);
  assert.deepEqual(tripItineraryIssues(trip([day("2027-03-28", { items: [{ kind: "arrive_flight", place: { placeId: "nrt" }, time: "14:30" }], nightAt: { lat: 35.69, lng: 139.7 } })])), []);
});

test("停留只有 stop 能带，0–720 分钟；时间只有起点能带", () => {
  assert.deepEqual(reasons(trip([day("2027-03-28", { items: [{ kind: "start", place: hotel, time: "09:00", stayMinutes: 10 }, { kind: "stop", place: hotel, stayMinutes: 721 }, { kind: "end", place: hotel, time: "10:00" }] })])), [
    "/days/0/items/0/stayMinutes:STAY_NOT_ALLOWED",
    "/days/0/items/1/stayMinutes:OUT_OF_RANGE",
    "/days/0/items/2/time:TIME_NOT_ALLOWED",
  ]);
});

test("人数 1–60、行李 0–60（引擎上限）、附加项不重复且 ≤ 10", () => {
  assert.deepEqual(reasons(trip([day("2027-03-28")], { party: { adults: 0, children: 0, luggage: 61 } })), ["/party:OUT_OF_RANGE", "/party/luggage:OUT_OF_RANGE"]);
  assert.deepEqual(reasons(trip([day("2027-03-28")], { party: { adults: 40, children: 21, luggage: 0 } })), ["/party:OUT_OF_RANGE"]);
  const addons = [{ addonId: "seat", quantity: 1 }, { addonId: "seat", quantity: 21 }];
  assert.deepEqual(reasons(trip([day("2027-03-28")], { preferences: { vehicleGroupIds: ["a", "a"], addons } })), ["/preferences/vehicleGroupIds:DUPLICATE", "/preferences/addons/1/addonId:DUPLICATE", "/preferences/addons/1/quantity:OUT_OF_RANGE"]);
});

test("坐标非法、地点编号为空都报", () => {
  assert.deepEqual(reasons(trip([day("2027-03-28", { items: [{ kind: "start", place: { lat: 91, lng: 0 }, time: "09:00" }, { kind: "end", place: { placeId: "" } }] })])), ["/days/0/items/0/place:INVALID", "/days/0/items/1/place/place_id:INVALID"]);
});

test("全程不同地点 ≤ 60", () => {
  const many = (date: string, base: number): TripDay => ({
    date,
    items: [{ kind: "start", place: { lat: 35 + base / 1000, lng: 139 }, time: "08:00" }, ...Array.from({ length: 10 }, (_, i) => ({ kind: "stop" as const, place: { lat: 35 + (base + i + 1) / 1000, lng: 139 }, stayMinutes: 0 })), { kind: "end", place: { lat: 35 + (base + 11) / 1000, lng: 139 } }],
  });
  const days = Array.from({ length: 6 }, (_, d) => many(`2027-05-0${d + 1}`, d * 12));
  assert.deepEqual(reasons(trip(days)), ["/days:OUT_OF_RANGE"]);
  assert.deepEqual(tripItineraryIssues(trip(days.slice(0, 5))), []);
});

test("dayPoints：没写终点时补过夜点；写了终点不补；空闲日为空", () => {
  const night = { lat: 35.2, lng: 139.0 };
  const open = dayPoints({ date: "2027-03-28", items: [{ kind: "start", place: hotel, time: "09:00" }, { kind: "stop", place: { lat: 35.3, lng: 139.1 }, stayMinutes: 30 }], nightAt: night });
  assert.equal(open.length, 3);
  assert.deepEqual(open[2], { place: { ...night, kind: "hotel" }, kind: "end", stayMinutes: 0 });
  assert.equal(open[1]?.stayMinutes, 30);
  assert.equal(dayPoints(day("2027-03-28", { nightAt: night })).length, 3);
  assert.deepEqual(dayPoints({ date: "2027-03-29", items: [] }), []);
});

test("minuteOfDay、tripPlaceKey", () => {
  assert.equal(minuteOfDay("14:30"), 870);
  assert.equal(minuteOfDay("7:30"), null);
  assert.equal(tripPlaceKey({ placeId: "nrt" }), "place:nrt");
  assert.equal(tripPlaceKey({ lat: 35.1234567, lng: 139.1 }), tripPlaceKey({ lat: 35.1234568, lng: 139.1, kind: "poi" }));
});
