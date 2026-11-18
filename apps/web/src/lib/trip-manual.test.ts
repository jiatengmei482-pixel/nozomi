/** 行程报价页转人工报价带上的内容（M9T-09 第二部分）：第一天 → `trip`、每天地名 → `trip_labels`、地名清洗截断。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { manualQuoteTripIssues } from "@nozomi/domain";
import type { SiteTripItinerary } from "../api/site.ts";
import { manualQuoteRequestOf } from "./manual-quote-form.ts";
import { tripLabelText, tripLabelsFor, tripManualQuoteDraft } from "./trip-manual.ts";

const HOTEL = { lat: 35.6896, lng: 139.6917 };
const TEMPLE = { lat: 35.7148, lng: 139.7967 };
const NARITA = { lat: 35.772, lng: 140.3929 };
const contact = { email: "guest@example.com", whatsapp: "", website: "" };

function itinerary(days: SiteTripItinerary["days"]): SiteTripItinerary {
  return { schemaVersion: 1, party: { adults: 2, children: 1, luggage: 3 }, days };
}

/** 后端同一份校验能过（domain 的 manualQuoteTripIssues，字段换成 domain 的写法） */
function backendIssues(body: NonNullable<ReturnType<typeof manualQuoteRequestOf>>) {
  const t = body.trip;
  return manualQuoteTripIssues({ category: t.category, cityId: t.city_id, pickup: t.pickup, dropoff: t.dropoff, serviceLocal: t.service_local, passengers: t.passengers, luggage: t.luggage, packageHours: t.package_hours, waypoints: (t.waypoints ?? []).map((w) => ({ ...w, stayMinutes: w.stay_minutes })) } as Parameters<typeof manualQuoteTripIssues>[0]);
}

test("第一天有中间地点：包车，经停点 = 中间地点（带停留分钟），不填时长，后端校验能过", () => {
  const it = itinerary([{ date: "2030-11-21", items: [{ kind: "start", place: HOTEL, time: "09:00" }, { kind: "stop", place: TEMPLE, stayMinutes: 90 }, { kind: "end", place: HOTEL }] }]);
  const labels = { v: 1 as const, days: [["酒店", "浅草寺", "酒店"]] };
  const draft = tripManualQuoteDraft(it, labels);
  assert.ok(draft);
  assert.equal(draft.category, "charter");
  assert.equal(draft.packageHours, null);
  assert.deepEqual(draft.waypoints, [{ name: "浅草寺", lat: TEMPLE.lat, lng: TEMPLE.lng, stayMinutes: 90 }]);
  assert.equal(draft.serviceLocal, "2030-11-21T09:00");
  assert.equal(draft.passengers, 3);
  const body = manualQuoteRequestOf(contact, draft);
  assert.ok(body);
  assert.deepEqual(backendIssues(body), []);
});

test("第一天只有两点：有机场是接送机，否则点对点；后端校验能过", () => {
  const airport = tripManualQuoteDraft(itinerary([{ date: "2030-11-20", items: [{ kind: "arrive_flight", place: NARITA, time: "14:30" }, { kind: "end", place: HOTEL }] }]), null);
  assert.equal(airport?.category, "airport_transfer");
  const p2p = tripManualQuoteDraft(itinerary([{ date: "2030-11-20", items: [{ kind: "start", place: HOTEL, time: "10:00" }, { kind: "end", place: TEMPLE }] }]), null);
  assert.equal(p2p?.category, "point_to_point");
  for (const draft of [airport, p2p]) {
    const body = draft && manualQuoteRequestOf(contact, draft);
    assert.ok(body);
    assert.deepEqual(backendIssues(body), []);
  }
});

test("第一天没有终点项（只有过夜点）也没有中间地点：填不出，返回 null；不拿过夜点当下车点", () => {
  assert.equal(tripManualQuoteDraft(itinerary([{ date: "2030-11-20", items: [{ kind: "start", place: HOTEL, time: "10:00" }], nightAt: TEMPLE }]), null), null);
});

test("每天地名和行程单一一对应：空闲日是空数组，没存的写坐标", () => {
  const it = itinerary([
    { date: "2030-11-20", items: [{ kind: "start", place: HOTEL, time: "10:00" }, { kind: "end", place: TEMPLE }] },
    { date: "2030-11-21", items: [] },
    { date: "2030-11-22", items: [{ kind: "start", place: TEMPLE, time: "10:00" }, { kind: "end", place: HOTEL }] },
  ]);
  const labels = tripLabelsFor(it, { v: 1, days: [["酒店", ""], []] });
  assert.deepEqual(labels.map((day) => day.length), [2, 0, 2]);
  assert.equal(labels[0]?.[0], "酒店");
  assert.ok(labels.flat().every((name) => name !== "" && !name.includes("\n")));
});

test("地名清洗：空白压成一个空格；按 UTF-16 长度截到 300，不切断 emoji；空的写「地图上选的位置」", () => {
  assert.equal(tripLabelText("  东京\n  站 "), "东京 站");
  const long = tripLabelText("😀".repeat(200));
  assert.ok(long.length <= 300);
  assert.equal(long, "😀".repeat(150));
  assert.equal(tripLabelText("a".repeat(301)).length, 300);
  assert.equal(tripLabelText("   "), "地图上选的位置");
});
