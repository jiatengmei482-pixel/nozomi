import { test } from "node:test";
import assert from "node:assert/strict";
import type { BookingDraft } from "../api/site.ts";
import { draftReadyToQuote, draftTrip } from "./booking-draft.ts";

const transfer: BookingDraft = {
  v: 1,
  tab: "transfer",
  service_local: "2026-12-01T10:00",
  pickup: { name: "成田国際空港", lat: 35.772, lng: 140.3929 },
  dropoff: { name: "東京駅", lat: 35.6812, lng: 139.7671 },
  waypoints: [],
  package_hours: null,
  passengers: 2,
  luggage: 2,
  lang: "ja",
};

test("区间：两端按链接给的坐标（类型为空），日期时间拆开，人数行李照抄；不带经停点和时长", () => {
  const trip = draftTrip(transfer);
  assert.deepEqual({ ...trip, waypoints: trip.waypoints.length }, {
    tab: "transfer",
    from: { name: "成田国際空港", lat: 35.772, lng: 140.3929, kind: null },
    to: { name: "東京駅", lat: 35.6812, lng: 139.7671, kind: null },
    date: "2026-12-01",
    time: "10:00",
    passengers: 2,
    luggage: 2,
    packageHours: "",
    waypoints: 0,
  });
  assert.equal(draftReadyToQuote(trip), true);
});

test("包车带经停点：经停点逐个带名称、坐标、停留，按行程计价不带时长", () => {
  const trip = draftTrip({ ...transfer, tab: "charter", waypoints: [{ name: "浅草寺", lat: 35.7148, lng: 139.7967, stay_minutes: 60 }, { name: "上野", lat: 35.71, lng: 139.77, stay_minutes: 480 }] });
  assert.deepEqual(trip.waypoints.map((stop) => [stop.point, stop.stay]), [
    [{ name: "浅草寺", lat: 35.7148, lng: 139.7967, kind: null }, "60"],
    [{ name: "上野", lat: 35.71, lng: 139.77, kind: null }, "480"],
  ]);
  assert.notEqual(trip.waypoints[0]?.key, trip.waypoints[1]?.key, "每个经停点有自己的键（排序时跟着走）");
  assert.equal(trip.packageHours, "");
  assert.equal(draftReadyToQuote(trip), true);
});

test("包车按时长：有时长直接报价；没时长留在第 1 步选", () => {
  const withHours = draftTrip({ ...transfer, tab: "charter", package_hours: 8 });
  assert.equal(withHours.packageHours, "8");
  assert.equal(draftReadyToQuote(withHours), true);
  const noHours = draftTrip({ ...transfer, tab: "charter" });
  assert.equal(noHours.packageHours, "");
  assert.equal(draftReadyToQuote(noHours), false);
});

test("不在页面选项里的停留留空让客人重选；区间就算带了时长也不用", () => {
  assert.equal(draftTrip({ ...transfer, tab: "charter", waypoints: [{ name: "x", lat: 35, lng: 139, stay_minutes: 45 }] }).waypoints[0]?.stay, "");
  assert.equal(draftTrip({ ...transfer, package_hours: 8 }).packageHours, "");
});
