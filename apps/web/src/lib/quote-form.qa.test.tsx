/** M1-12 测试角色补充：报价试算表单的边界（上限、下限恰好可以、超一点不行；跨午夜、闰日、全角）。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { type QuoteForm, emptyQuoteForm, readQuoteForm } from "./quote-form.ts";

const CITY = "11111111-1111-4111-8111-111111111111";
const charter = (changes: Partial<QuoteForm>): QuoteForm => ({ ...emptyQuoteForm(), cityId: CITY, category: "charter", pickup: { lat: "35.6", lng: "139.7" }, packageHours: "4", date: "2026-10-20", time: "09:30", passengers: "1", currency: "JPY", ...changes });

test("假定的里程和时长：0 公里 0 分钟、5000 公里、10080 分钟恰好可以；负数、超一点不行；全角数字也认", () => {
  assert.deepEqual(readQuoteForm(charter({ routeKm: "0", routeMinutes: "0" })).body?.assume_route, { meters: 0, minutes: 0 });
  assert.deepEqual(readQuoteForm(charter({ routeKm: "5000", routeMinutes: "10080" })).body?.assume_route, { meters: 5_000_000, minutes: 10_080 });
  assert.deepEqual(readQuoteForm(charter({ routeKm: "０.５", routeMinutes: "４５" })).body?.assume_route, { meters: 500, minutes: 45 });
  assert.ok(readQuoteForm(charter({ routeKm: "-1", routeMinutes: "10" })).errors.routeKm);
  assert.ok(readQuoteForm(charter({ routeKm: "1", routeMinutes: "-10" })).errors.routeMinutes);
  assert.ok(readQuoteForm(charter({ routeKm: "1", routeMinutes: "10.5" })).errors.routeMinutes, "分钟只能是整数");
  assert.ok(readQuoteForm(charter({ routeKm: "5000.1", routeMinutes: "10" })).errors.routeKm);
  assert.ok(readQuoteForm(charter({ routeKm: "1", routeMinutes: "10081" })).errors.routeMinutes);
  assert.equal(readQuoteForm(charter({ routeKm: "  ", routeMinutes: "  " })).body?.assume_route, null, "只有空格当没填");
});

test("套餐时长 1 和 72 小时可以，0 和 73 不行；人数 1 到 60、行李 0 到 60 恰好可以", () => {
  assert.equal(readQuoteForm(charter({ packageHours: "1" })).body?.package_hours, 1);
  assert.equal(readQuoteForm(charter({ packageHours: "72" })).body?.package_hours, 72);
  for (const hours of ["0", "73", "4.5", "-4", "四"]) assert.ok(readQuoteForm(charter({ packageHours: hours })).errors.packageHours, hours);
  assert.equal(readQuoteForm(charter({ passengers: "60", luggage: "60" })).body?.passengers, 60);
  assert.ok(readQuoteForm(charter({ passengers: "61" })).errors.passengers);
  assert.ok(readQuoteForm(charter({ luggage: "-1" })).errors.luggage);
});

test("用车时间：0:00 整理成 00:00、23:59 可以、24:00 不行；闰年 2-29 可以、平年不行；跨年的 12-31 23:59", () => {
  assert.equal(readQuoteForm(charter({ time: "0:00" })).body?.service_time, "2026-10-20T00:00");
  assert.equal(readQuoteForm(charter({ time: "2359" })).body?.service_time, "2026-10-20T23:59");
  assert.ok(readQuoteForm(charter({ time: "24:00" })).errors.time);
  assert.ok(readQuoteForm(charter({ time: "12:60" })).errors.time);
  assert.equal(readQuoteForm(charter({ date: "2028-02-29" })).body?.service_time, "2028-02-29T09:30");
  assert.ok(readQuoteForm(charter({ date: "2027-02-29" })).errors.date);
  assert.equal(readQuoteForm(charter({ date: "2026/12/31", time: "23:59" })).body?.service_time, "2026-12-31T23:59");
  assert.equal(readQuoteForm(charter({ date: "２０２６－１０－２０", time: "０９：３０" })).body?.service_time, "2026-10-20T09:30", "全角日期、时刻");
});

test("坐标：±90、±180 恰好可以，超一点不行；前后空格去掉", () => {
  const point = (lat: string, lng: string) => readQuoteForm(charter({ pickup: { lat, lng } }));
  assert.deepEqual(point("90", "180").body?.pickup, { lat: 90, lng: 180 });
  assert.deepEqual(point("-90", "-180").body?.pickup, { lat: -90, lng: -180 });
  assert.deepEqual(point(" 35.6895 ", " 139.6917 ").body?.pickup, { lat: 35.6895, lng: 139.6917 });
  assert.ok(point("90.0001", "0").errors["pickup.lat"]);
  assert.ok(point("0", "-180.0001").errors["pickup.lng"]);
  assert.ok(point("NaN", "Infinity").errors["pickup.lat"]);
});
