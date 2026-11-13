import { test } from "node:test";
import assert from "node:assert/strict";
import { ORDER_ENTRY_SOURCES, itineraryModeOf, simpleOrderItinerary } from "./order-itinerary.ts";

const narita = { name: "成田国際空港", lat: 35.772, lng: 140.3929 };
const tokyo = { name: "東京駅", lat: 35.6812, lng: 139.7671 };

/** 订单行程的所有键（递归），检查有没有金额相关的键 */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)]);
}

test("区间（接送机、点对点）：方式 transfer、地点 2 个、停留为空、上车点计划出发 = 用车时间", () => {
  for (const category of ["airport_transfer", "point_to_point"] as const) {
    const itinerary = simpleOrderItinerary({ category, serviceLocal: "2026-12-01T09:00", packageHours: null, packageKm: null, pickup: narita, dropoff: tokyo });
    assert.deepEqual(itinerary, {
      version: 1,
      mode: "transfer",
      stops: [
        { seq: 1, role: "pickup", ...narita, stay_minutes: null, planned_arrival_local: null, planned_departure_local: "2026-12-01T09:00" },
        { seq: 2, role: "dropoff", ...tokyo, stay_minutes: null, planned_arrival_local: null, planned_departure_local: null },
      ],
      legs: [],
      totals: null,
      package: null,
      estimate: null,
    });
  }
});

test("按时长包车：方式 charter_package、套餐时长和含公里数；没给下车点时只有上车点", () => {
  const itinerary = simpleOrderItinerary({ category: "charter", serviceLocal: "2026-12-01T09:00", packageHours: 8, packageKm: 150, pickup: tokyo, dropoff: narita });
  assert.equal(itinerary.mode, "charter_package");
  assert.deepEqual(itinerary.package, { hours: 8, km: 150 });
  assert.equal(itinerary.stops.length, 2);
  const noDropoff = simpleOrderItinerary({ category: "charter", serviceLocal: "2026-12-01T09:00", packageHours: 4, packageKm: null, pickup: tokyo, dropoff: null });
  assert.deepEqual(noDropoff.stops.map((stop) => stop.role), ["pickup"]);
  assert.deepEqual(noDropoff.package, { hours: 4, km: null });
});

test("订单行程里没有任何金额字段", () => {
  const itinerary = simpleOrderItinerary({ category: "charter", serviceLocal: "2026-12-01T09:00", packageHours: 8, packageKm: 150, pickup: tokyo, dropoff: narita });
  for (const key of keysOf(itinerary)) assert.doesNotMatch(key, /minor|amount|price|sell|markup|fx|currency|settlement/i, key);
});

test("方式与来源的取值", () => {
  assert.equal(itineraryModeOf("charter"), "charter_package");
  assert.equal(itineraryModeOf("point_to_point"), "transfer");
  assert.deepEqual([...ORDER_ENTRY_SOURCES], ["book", "route_template", "embed"]);
});
