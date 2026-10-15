/** 报价试算页表单的读法：哪个品类要填哪几项、写法怎么整理、错了怎么说。（引用了组件里的坐标校验，所以是 .tsx） */
import { test } from "node:test";
import assert from "node:assert/strict";
import { type QuoteForm, emptyQuoteForm, fieldOfPath, pointsNeeded, readQuoteForm } from "./quote-form.ts";

const CITY = "11111111-1111-4111-8111-111111111111";
const PLACE = "22222222-2222-4222-8222-222222222222";
const filled = (changes: Partial<QuoteForm>): QuoteForm => ({ ...emptyQuoteForm(), cityId: CITY, date: "2026/10/20", time: "930", passengers: "２", currency: "JPY", ...changes });

test("要填哪几个点：接机看下车点、送机看上车点、点对点两端、包车只看上车点（和 @nozomi/domain 同一个规则）", () => {
  assert.deepEqual(pointsNeeded({ category: "airport_transfer", direction: "pickup" }), ["dropoff"]);
  assert.deepEqual(pointsNeeded({ category: "airport_transfer", direction: "dropoff" }), ["pickup"]);
  assert.deepEqual(pointsNeeded({ category: "airport_transfer", direction: null }), [], "方向还没选时先不问坐标");
  assert.deepEqual(pointsNeeded({ category: "point_to_point", direction: null }), ["pickup", "dropoff"]);
  assert.deepEqual(pointsNeeded({ category: "charter", direction: null }), ["pickup"]);
  assert.deepEqual(pointsNeeded({ category: null, direction: null }), []);
});

test("包车：套餐时长必填；日期、时刻整理成城市当地时间的写法；全角数字也认；行李不填是 0；不用的字段都是 null", () => {
  const missing = readQuoteForm(filled({ category: "charter", pickup: { lat: "35.6895", lng: "139.6917" } }));
  assert.equal(missing.body, null);
  assert.equal(missing.errors.packageHours, "套餐时长要填 1 到 72 之间的整数（小时）");
  const reading = readQuoteForm(filled({ category: "charter", pickup: { lat: "35.6895", lng: "139.6917" }, packageHours: "10" }));
  assert.deepEqual(reading.errors, {});
  assert.deepEqual(reading.body, { city_id: CITY, category: "charter", place_id: null, currency: "JPY", pickup: { lat: 35.6895, lng: 139.6917 }, dropoff: null, direction: null, package_hours: 10, service_time: "2026-10-20T09:30", passengers: 2, luggage: 0, assume_route: null });
});

test("接送机：接送点和方向必填；接送点只在接送机时带上", () => {
  const reading = readQuoteForm(filled({ category: "airport_transfer" }));
  assert.equal(reading.errors.place, "请选择机场或车站");
  assert.equal(reading.errors.direction, "请选择方向");
  const ok = readQuoteForm(filled({ category: "airport_transfer", placeId: PLACE, direction: "dropoff", pickup: { lat: "35.6", lng: "139.7" } }));
  assert.equal(ok.body?.place_id, PLACE);
  assert.equal(ok.body?.direction, "dropoff");
  assert.equal(ok.body?.dropoff, null);
  assert.equal(readQuoteForm(filled({ category: "point_to_point", placeId: PLACE, pickup: { lat: "35.6", lng: "139.7" }, dropoff: { lat: "35.7", lng: "139.8" } })).body?.place_id, null);
});

test("写错的说清楚怎么改：坐标、日期、时刻、人数、行李、币种", () => {
  const reading = readQuoteForm(filled({ category: "point_to_point", pickup: { lat: "135", lng: "abc" }, dropoff: { lat: "", lng: "139" }, date: "2026-02-30", time: "25:00", passengers: "0", luggage: "61", currency: "" }));
  assert.equal(reading.body, null);
  assert.deepEqual(reading.errors, {
    "pickup.lat": "纬度必须在 -90 到 90 之间",
    "pickup.lng": "经度要填数字，例如 139.779694",
    "dropoff.lat": "请输入纬度",
    date: "这不是一个日期，请按 2026-10-08 的格式填写",
    time: "请填时间，例如 08:00",
    passengers: "人数要填 1 到 60 之间的整数",
    luggage: "行李数要填 0 到 60 之间的整数，没有行李可以不填",
    currency: "请选择客人支付的币种",
  });
  assert.deepEqual(readQuoteForm(emptyQuoteForm()).errors.city, "请选择城市");
});

test("假定的里程和时长：要么都填要么都不填；公里换成整数米（最多 1 位小数），分钟是整数；有上限", () => {
  const base = filled({ category: "charter", pickup: { lat: "35.6", lng: "139.7" }, packageHours: "5" });
  assert.deepEqual(readQuoteForm({ ...base, routeKm: "12.3", routeMinutes: "45" }).body?.assume_route, { meters: 12_300, minutes: 45 });
  assert.equal(readQuoteForm({ ...base, routeKm: "12.3" }).errors.routeMinutes, "填了里程，也要填时长");
  assert.equal(readQuoteForm({ ...base, routeMinutes: "45" }).errors.routeKm, "填了时长，也要填里程");
  assert.equal(readQuoteForm({ ...base, routeKm: "12.34", routeMinutes: "45" }).errors.routeKm, "里程要填 0 到 5,000 之间的数（公里），最多 1 位小数");
  assert.equal(readQuoteForm({ ...base, routeKm: "5000.1", routeMinutes: "45" }).errors.routeKm, "里程要填 0 到 5,000 之间的数（公里），最多 1 位小数");
  assert.equal(readQuoteForm({ ...base, routeKm: "10", routeMinutes: "10081" }).errors.routeMinutes, "时长要填 0 到 10,080 之间的整数（分钟）");
});

test("后端在 400 里指出的路径落到页面上的哪一项", () => {
  assert.equal(fieldOfPath("/city_id"), "city");
  assert.equal(fieldOfPath("/dropoff"), "dropoff.lat");
  assert.equal(fieldOfPath("/service_time"), "date");
  assert.equal(fieldOfPath("/assume_route"), "routeKm");
  assert.equal(fieldOfPath("/addons/0/addon_id"), null);
});
