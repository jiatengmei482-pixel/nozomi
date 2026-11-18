/** 行程报价页的下单出口（M9T-10 第二部分）：哪些方案能直接在线下单、order-quote 的请求体、带去 /book/new 的内容（路由 state 的核对、预填、当作询价结果）。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SiteQuote, SiteTrip, SiteTripItinerary, SiteTripOrderQuote, SiteTripPlan, SiteTripSegment } from "../api/site.ts";
import { TRIP_BOOK_STATE, tripBookHandoff, tripBookHandoffOf, tripBookOutcome, tripBookSeedOf, tripBookableSegment, tripOrderQuoteBody } from "./trip-book.ts";

const HOTEL = { lat: 35.6896, lng: 139.6917 };
const TEMPLE = { lat: 35.7148, lng: 139.7967 };
const NARITA = { lat: 35.772, lng: 140.3929 };
const NOW = Date.parse("2030-11-01T00:00:00.000Z");

function tripOf(days: SiteTripItinerary["days"], plans: SiteTripPlan[] = []): SiteTrip {
  return { trip_id: "T".repeat(43), status: "quoted", currency: "JPY", readable_until: "2030-12-01T00:00:00.000Z", itinerary: { schemaVersion: 1, party: { adults: 2, children: 0, luggage: 1 }, days }, quoted_at: null, expires_at: null, plans, unquoted: [], degraded: false, manual_quote_suggested: false };
}

const segment = (type: SiteTripSegment["type"], id = "s1"): SiteTripSegment => ({ segment_id: id, type, start_local: null, end_local: null, amount: null, package_hours: null, other_vehicle: false, vehicle_group: null, price_breakdown: [], route: null });
const fee = { type: "lodging" as const, label: { zh: "司机住宿" }, amount: { amount: "10000", currency: "JPY" } };

function planOf(days: SiteTripPlan["days"], fees: SiteTripPlan["fees"] = []): SiteTripPlan {
  return { plan_id: "44444444-4444-4444-8444-444444444441", kind: "one_car", recommended: true, status: "quoted", expired: false, total: { amount: "50000", currency: "JPY" }, vehicle_group: null, days, fees, warnings: [] };
}

const charterDay = (stay: number) => ({ date: "2030-11-20", items: [{ kind: "start" as const, place: HOTEL, time: "09:00" }, { kind: "stop" as const, place: TEMPLE, stayMinutes: stay }, { kind: "end" as const, place: HOTEL }] });
const pickupDay = { date: "2030-11-20", items: [{ kind: "arrive_flight" as const, place: NARITA, time: "14:30" }, { kind: "end" as const, place: HOTEL }] };
const labels = { v: 1 as const, days: [["京王广场酒店", "浅草寺", "京王广场酒店"]] };

function quoteOf(expiresAt: string): SiteQuote {
  return {
    quote_id: "QT203011200000000001",
    expires_at: expiresAt,
    service_date: "2030-11-20",
    urgent: false,
    vehicle_group: { id: "33333333-3333-4333-8333-333333333301", code: "VG-T1", name: { zh: "车型1" }, grade: "economy", seats: 7, sample_models: [], combos: [{ passengers: 6, luggage: 4 }] },
    package: null,
    price: { total: { amount: "50000", currency: "JPY" }, fx: null },
    free_wait_minutes: 60,
    cancel_policy: { category: "airport_transfer", level: "economy", tiers: [] },
    available_addons: [],
    itinerary_warnings: null,
  };
}

function orderOf(segmentType: SiteTripOrderQuote["segment_type"], category: "airport_transfer" | "point_to_point" | "charter", expiresAt = "2030-11-01T00:30:00.000Z"): SiteTripOrderQuote {
  return {
    trip_id: "T".repeat(43),
    plan_id: "44444444-4444-4444-8444-444444444441",
    currency: "JPY",
    segment_type: segmentType,
    city: segmentType === "charter" ? { id: "c1", code: "CTY-JP-TYO", name: { zh: "东京" }, timezone: "Asia/Tokyo" } : null,
    quote: quoteOf(expiresAt),
    quote_request: { category, service_local: "2030-11-20T14:30", passengers: 2, luggage: 1 },
    itinerary_route: null,
    expires_at: expiresAt,
  };
}

test("能直接在线下单：整个方案只有一段、没有跨段费用、包车停留在 /book/new 能选的档；多段、空闲日、带费用、「不停留」的经停都不行", () => {
  const charter = tripOf([charterDay(90)]);
  const single = tripBookableSegment(charter, planOf([{ day_index: 0, date: "2030-11-20", segments: [segment("charter")], fees: [] }]));
  assert.equal(single?.dayIndex, 0);
  assert.equal(single?.segment.type, "charter");
  assert.equal(tripBookableSegment(tripOf([charterDay(0)]), planOf([{ day_index: 0, date: "2030-11-20", segments: [segment("charter")], fees: [] }])), null, "不停留 /book/new 选不了");
  assert.equal(tripBookableSegment(charter, planOf([{ day_index: 0, date: "2030-11-20", segments: [segment("charter")], fees: [fee] }])), null, "挂在当天的费用");
  assert.equal(tripBookableSegment(charter, planOf([{ day_index: 0, date: "2030-11-20", segments: [segment("charter")], fees: [] }], [fee])), null, "按晚的费用");
  const two = tripOf([pickupDay, charterDay(90)]);
  assert.equal(tripBookableSegment(two, planOf([{ day_index: 0, date: "2030-11-20", segments: [segment("airport_pickup")], fees: [] }, { day_index: 1, date: "2030-11-21", segments: [segment("charter", "s2")], fees: [] }])), null, "多段");
  assert.equal(tripBookableSegment(two, planOf([{ day_index: 0, date: "2030-11-20", segments: [segment("airport_pickup")], fees: [] }, { day_index: 1, date: "2030-11-21", segments: [segment("idle_day", "s2")], fees: [] }])), null, "空闲日也算一段（同后端）");
  assert.equal(tripBookableSegment(charter, planOf([])), null, "没有段");
  assert.ok(tripBookableSegment(tripOf([pickupDay]), planOf([{ day_index: 0, date: "2030-11-20", segments: [segment("airport_pickup")], fees: [] }])));
});

test("order-quote 请求体：包车带经停点地名（个数和经停点一样多，没存地名写坐标）；接送机不带", () => {
  const charter = tripOf([charterDay(90)]);
  const bookable = { segment: segment("charter"), dayIndex: 0 };
  assert.deepEqual(tripOrderQuoteBody(charter, bookable, labels), { waypoint_names: ["浅草寺"] });
  const names = tripOrderQuoteBody(charter, bookable, null).waypoint_names ?? [];
  assert.equal(names.length, 1);
  assert.match(names[0] ?? "", /35\.71480/);
  assert.deepEqual(tripOrderQuoteBody(tripOf([pickupDay]), { segment: segment("airport_pickup"), dayIndex: 0 }, null), {});
  const long = { v: 1 as const, days: [["酒店", `${"长".repeat(250)}\n寺`, "酒店"]] };
  assert.equal(tripOrderQuoteBody(charter, bookable, long).waypoint_names?.[0]?.length, 200, "截到 200 个字");
});

test("带去 /book/new 的内容：两端（机场标 airport）、经停点；路由 state 核对格式，不对的当作没有", () => {
  const charter = tripOf([charterDay(90)]);
  const handoff = tripBookHandoff(charter, { segment: segment("charter"), dayIndex: 0 }, labels, orderOf("charter", "charter"));
  assert.ok(handoff);
  assert.deepEqual(handoff.from, { name: "京王广场酒店", lat: HOTEL.lat, lng: HOTEL.lng, kind: null });
  assert.deepEqual(handoff.waypoints, [{ name: "浅草寺", lat: TEMPLE.lat, lng: TEMPLE.lng, stay_minutes: 90 }]);
  const pickup = tripBookHandoff(tripOf([pickupDay]), { segment: segment("airport_pickup"), dayIndex: 0 }, null, orderOf("airport_pickup", "airport_transfer"));
  assert.equal(pickup?.from.kind, "airport");

  assert.deepEqual(tripBookHandoffOf({ [TRIP_BOOK_STATE]: handoff }), handoff);
  for (const bad of [null, "x", {}, { [TRIP_BOOK_STATE]: { ...handoff, from: null } }, { [TRIP_BOOK_STATE]: { ...handoff, waypoints: [{ name: "x" }] } }, { [TRIP_BOOK_STATE]: { ...handoff, order: { ...handoff.order, quote_request: { service_local: "明天" } } } }]) {
    assert.equal(tripBookHandoffOf(bad), null, JSON.stringify(bad));
  }
});

test("预填和询价结果：日期时间人数按报价请求、车型按报价；接机认作接机；回落点对点的标出来；报价过期、包车没有城市时不当作结果（照常询价）", () => {
  const pickup = tripBookHandoff(tripOf([pickupDay]), { segment: segment("airport_pickup"), dayIndex: 0 }, null, orderOf("airport_pickup", "airport_transfer"));
  assert.ok(pickup);
  const seed = tripBookSeedOf(pickup);
  assert.equal(seed.tab, "transfer");
  assert.equal(seed.date, "2030-11-20");
  assert.equal(seed.time, "14:30");
  assert.equal(seed.passengers, 2);
  assert.equal(seed.vehicleGroupId, "33333333-3333-4333-8333-333333333301");
  assert.equal(seed.tripType, "pickup");
  assert.deepEqual(seed.waypoints, []);

  const outcome = tripBookOutcome(pickup, NOW);
  assert.equal(outcome?.mode, "transfer");
  assert.equal(outcome?.mode === "transfer" ? outcome.result.fallback_category : "x", null);
  const fallback = tripBookOutcome({ ...pickup, order: orderOf("airport_pickup", "point_to_point") }, NOW);
  assert.equal(fallback?.mode === "transfer" ? fallback.result.fallback_category : "x", "point_to_point");
  assert.equal(tripBookOutcome({ ...pickup, order: orderOf("airport_pickup", "airport_transfer", "2030-10-31T23:59:00.000Z") }, NOW), null, "过期");

  const charter = tripBookHandoff(tripOf([charterDay(90)]), { segment: segment("charter"), dayIndex: 0 }, labels, orderOf("charter", "charter"));
  assert.ok(charter);
  const charterSeed = tripBookSeedOf(charter);
  assert.equal(charterSeed.tab, "charter");
  assert.equal(charterSeed.tripType, null);
  assert.deepEqual(charterSeed.waypoints, [{ point: { name: "浅草寺", lat: TEMPLE.lat, lng: TEMPLE.lng, kind: null }, stay: "90" }]);
  assert.equal(tripBookOutcome(charter, NOW)?.mode, "charter");
  assert.equal(tripBookOutcome({ ...charter, order: { ...charter.order, city: null } }, NOW), null, "包车没有城市");
});
