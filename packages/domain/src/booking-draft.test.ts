import { test } from "node:test";
import assert from "node:assert/strict";
import { BOOKING_DRAFT_RULES, type BookingDraft, bookingDraftBytes, bookingDraftExpiresAt, bookingDraftIssues, isBookingDraftId, parseBookingDraft } from "./booking-draft.ts";

const transfer = (): BookingDraft => ({
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
});

const charter = (): BookingDraft => ({
  ...transfer(),
  tab: "charter",
  pickup: { name: "銀座", lat: 35.6717, lng: 139.765 },
  dropoff: { name: "新宿駅", lat: 35.6896, lng: 139.7006 },
  waypoints: [{ name: "富士山五合目園地", lat: 35.3955, lng: 138.7334, stay_minutes: 60 }],
});

const reasons = (value: unknown) => bookingDraftIssues(value).map((issue) => `${issue.path}:${issue.reason}`);

test("区间、包车带经停点、包车按时长都合格", () => {
  assert.deepEqual(bookingDraftIssues(transfer()), []);
  assert.deepEqual(bookingDraftIssues(charter()), []);
  assert.deepEqual(bookingDraftIssues({ ...charter(), waypoints: [], package_hours: 8 }), []);
  assert.deepEqual(bookingDraftIssues({ ...charter(), waypoints: [], package_hours: null }), [], "包车不填经停点时可以不选时长，到 /book/new 再选");
  assert.deepEqual(parseBookingDraft(transfer()), transfer());
});

test("多一个键就拒，包括个人信息", () => {
  assert.deepEqual(reasons({ ...transfer(), passenger: { name: "陈小红" } }), ["/passenger:UNKNOWN_KEY"]);
  assert.deepEqual(reasons({ ...transfer(), price: 10000 }), ["/price:UNKNOWN_KEY"]);
  assert.deepEqual(reasons({ ...transfer(), pickup: { ...transfer().pickup, phone: "+81" } }), ["/pickup/phone:UNKNOWN_KEY"]);
  assert.deepEqual(reasons({ ...charter(), waypoints: [{ ...charter().waypoints[0], email: "a@b.c" }] }), ["/waypoints/0/email:UNKNOWN_KEY"]);
  assert.equal(parseBookingDraft({ ...transfer(), passenger: {} }), null);
});

test("不是对象、版本不对、缺键", () => {
  assert.deepEqual(reasons(null), [":INVALID"]);
  assert.deepEqual(reasons([transfer()]), [":INVALID"]);
  assert.deepEqual(reasons({ ...transfer(), v: 2 }), ["/v:INVALID"]);
  const { lang: _lang, ...noLang } = transfer();
  assert.deepEqual(reasons(noLang), ["/lang:REQUIRED"]);
  const { pickup: _pickup, ...noPickup } = transfer();
  assert.deepEqual(reasons(noPickup), ["/pickup:REQUIRED"]);
  const { package_hours: _hours, ...noHours } = transfer();
  assert.deepEqual(reasons(noHours), ["/package_hours:REQUIRED"]);
});

test("用车类型、语言、日期时间", () => {
  assert.deepEqual(reasons({ ...transfer(), tab: "airport" }), ["/tab:INVALID"]);
  assert.deepEqual(reasons({ ...transfer(), lang: "ko" }), ["/lang:INVALID"]);
  for (const local of ["2026-12-01 10:00", "2026-12-01T10:00:00", "2026-02-30T10:00", "2026-12-01T24:00", ""]) assert.deepEqual(reasons({ ...transfer(), service_local: local }), ["/service_local:INVALID"], local);
});

test("地点：名称 1–200 字、不带首尾空格，坐标范围", () => {
  const name = "地".repeat(BOOKING_DRAFT_RULES.maxNameLength);
  assert.deepEqual(reasons({ ...transfer(), pickup: { ...transfer().pickup, name } }), []);
  assert.deepEqual(reasons({ ...transfer(), pickup: { ...transfer().pickup, name: `${name}地` } }), ["/pickup/name:OUT_OF_RANGE"]);
  assert.deepEqual(reasons({ ...transfer(), pickup: { ...transfer().pickup, name: " 銀座" } }), ["/pickup/name:OUT_OF_RANGE"]);
  assert.deepEqual(reasons({ ...transfer(), pickup: { ...transfer().pickup, name: "  " } }), ["/pickup/name:REQUIRED"]);
  assert.deepEqual(reasons({ ...transfer(), dropoff: { ...transfer().dropoff, lat: 90.1 } }), ["/dropoff/lat:OUT_OF_RANGE"]);
  assert.deepEqual(reasons({ ...transfer(), dropoff: { ...transfer().dropoff, lng: Number.NaN } }), ["/dropoff/lng:OUT_OF_RANGE"]);
  assert.deepEqual(reasons({ ...transfer(), dropoff: "東京駅" }), ["/dropoff:INVALID"]);
});

test("经停点：只有包车能有、最多 10 个、停留 30 分钟一档 30–480", () => {
  assert.deepEqual(reasons({ ...transfer(), waypoints: charter().waypoints }), ["/waypoints:NOT_APPLICABLE"]);
  const stop = charter().waypoints[0] as BookingDraft["waypoints"][number];
  assert.deepEqual(reasons({ ...charter(), waypoints: Array.from({ length: 10 }, () => stop) }), []);
  assert.deepEqual(reasons({ ...charter(), waypoints: Array.from({ length: 11 }, () => stop) }), ["/waypoints:OUT_OF_RANGE"]);
  for (const stay of [30, 480]) assert.deepEqual(reasons({ ...charter(), waypoints: [{ ...stop, stay_minutes: stay }] }), [], String(stay));
  for (const stay of [0, 45, 510, 60.5]) assert.deepEqual(reasons({ ...charter(), waypoints: [{ ...stop, stay_minutes: stay }] }), ["/waypoints/0/stay_minutes:OUT_OF_RANGE"], String(stay));
  const { stay_minutes: _stay, ...noStay } = stop;
  assert.deepEqual(reasons({ ...charter(), waypoints: [noStay] }), ["/waypoints/0/stay_minutes:REQUIRED"]);
  assert.deepEqual(reasons({ ...charter(), waypoints: null }), ["/waypoints:INVALID"]);
});

test("包车时长：只有包车且没有经停点时可以给，1–72", () => {
  assert.deepEqual(reasons({ ...transfer(), package_hours: 8 }), ["/package_hours:NOT_APPLICABLE"]);
  assert.deepEqual(reasons({ ...charter(), package_hours: 8 }), ["/package_hours:NOT_APPLICABLE"], "有经停点时按行程计价，自动选套餐");
  assert.deepEqual(reasons({ ...charter(), waypoints: [], package_hours: 0 }), ["/package_hours:OUT_OF_RANGE"]);
  assert.deepEqual(reasons({ ...charter(), waypoints: [], package_hours: 73 }), ["/package_hours:OUT_OF_RANGE"]);
});

test("人数、行李", () => {
  assert.deepEqual(reasons({ ...transfer(), passengers: 0, luggage: -1 }), ["/passengers:OUT_OF_RANGE", "/luggage:OUT_OF_RANGE"]);
  assert.deepEqual(reasons({ ...transfer(), passengers: 61, luggage: 61 }), ["/passengers:OUT_OF_RANGE", "/luggage:OUT_OF_RANGE"]);
  assert.deepEqual(reasons({ ...transfer(), passengers: "2" }), ["/passengers:OUT_OF_RANGE"]);
});

test("10 个经停点、每个名称 200 字远小于 16 KB；超过 16 KB 整份拒", () => {
  const long = (index: number) => ({ name: `経由地${index}`.padEnd(BOOKING_DRAFT_RULES.maxNameLength, "あ"), lat: 35.123456, lng: 139.123456, stay_minutes: 480 });
  const full = { ...charter(), pickup: { ...charter().pickup, name: "あ".repeat(200) }, dropoff: { ...charter().dropoff, name: "あ".repeat(200) }, waypoints: Array.from({ length: 10 }, (_, index) => long(index)) };
  assert.deepEqual(bookingDraftIssues(full), []);
  assert.ok(bookingDraftBytes(full) < BOOKING_DRAFT_RULES.maxBytes);
  const huge = { ...transfer(), padding: "x".repeat(BOOKING_DRAFT_RULES.maxBytes) };
  assert.deepEqual(reasons(huge), [":TOO_LARGE"]);
});

test("编号写法、到期时刻", () => {
  assert.equal(isBookingDraftId("A".repeat(43)), true);
  assert.equal(isBookingDraftId("aZ09_-".repeat(7) + "x"), true);
  assert.equal(isBookingDraftId("A".repeat(42)), false);
  assert.equal(isBookingDraftId("A".repeat(44)), false);
  assert.equal(isBookingDraftId(`${"A".repeat(42)}=`), false);
  assert.equal(isBookingDraftId(`${"A".repeat(42)}/`), false);
  assert.equal(bookingDraftExpiresAt(new Date("2026-12-01T00:00:00Z")).toISOString(), "2026-12-01T02:00:00.000Z");
});

test("名称按 UTF-16 单元数算（和 /site/v1/quotes 一样）：100 个 emoji 正好 200，101 个超；坐标最多 7 位小数，1e-300 这类写法拒", () => {
  const emoji = (count: number) => "🚕".repeat(count);
  assert.deepEqual(reasons({ ...transfer(), pickup: { ...transfer().pickup, name: emoji(100) } }), []);
  assert.deepEqual(reasons({ ...transfer(), pickup: { ...transfer().pickup, name: emoji(101) } }), ["/pickup/name:OUT_OF_RANGE"]);
  assert.deepEqual(reasons({ ...transfer(), pickup: { ...transfer().pickup, lat: 35.6812345, lng: 139.7671234 } }), [], "7 位小数");
  assert.deepEqual(reasons({ ...transfer(), pickup: { ...transfer().pickup, lat: 35.68123456 } }), ["/pickup/lat:OUT_OF_RANGE"], "8 位小数");
  assert.deepEqual(reasons({ ...transfer(), pickup: { ...transfer().pickup, lat: 1e-300, lng: 5e-324 } }), ["/pickup/lat:OUT_OF_RANGE", "/pickup/lng:OUT_OF_RANGE"]);
  assert.deepEqual(reasons({ ...transfer(), pickup: { ...transfer().pickup, lat: 0, lng: -0 } }), []);
});

