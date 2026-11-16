/**
 * 价格页第四张表「机场套餐价」的纯逻辑（M9P-22，ADR 0098 第三节第 3、4 小节，第六节第 2–4 条的数）：
 * 继承价（普通套餐 + 那一端③加价，机场结束另加下车点行程加价；在①里 = 普通价）、标黄、读格子、批量保存、新行 ref 长度、每格编辑哪一条。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { PriceRule } from "@nozomi/domain";
import type { PriceRuleBody } from "../api/prices.ts";
import {
  type AirportCell,
  type AreaShapes,
  airportCellFromRule,
  airportCellWarn,
  airportCellsOf,
  airportChangeCount,
  airportEndLocation,
  airportHoursColumns,
  airportOverlaps,
  blankAirportCell,
  blankAirportKey,
  buildAirportBatch,
  inheritPlaceholder,
  inheritText,
  inheritedAirportPrice,
  readAirportCell,
} from "./charter-airport-prices.ts";

const TODAY = "2026-11-16";
const NARITA_AREA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NARITA_UPDOWN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NARITA_ITINERARY = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const VAN = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const RULE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const updown = (overrides: Partial<PriceRule> = {}): PriceRule => ({ areaId: NARITA_UPDOWN, vehicleGroupId: VAN, direction: null, packageHours: null, pricing: { model: "charter_area_surcharge", pickupSurchargeMinor: 14000, dropoffSurchargeMinor: 14000 }, validFrom: "2026-11-01", validTo: null, status: "enabled", ...overrides });
const itinerary: PriceRule = { areaId: NARITA_ITINERARY, vehicleGroupId: VAN, direction: null, packageHours: null, pricing: { model: "charter_itinerary_surcharge", surchargeMinor: 14000 }, validFrom: "2026-11-01", validTo: null, status: "enabled" };
const AT_NARITA = { inProductArea: false, updownAreaIds: [NARITA_UPDOWN], itineraryAreaIds: [NARITA_ITINERARY] };
const query = { normalMinor: 33000, rules: [updown(), itinerary], vehicleGroupId: VAN, packageHours: 5, date: TODAY };

test("继承价：成田上车 = 普通 33,000 + 上车加价 14,000 = 47,000；成田下车另加下车点行程加价 = 61,000（ADR 0098 第六节第 2、3 条）", () => {
  const start = inheritedAirportPrice({ ...query, scenario: "airport_start", location: AT_NARITA });
  assert.deepEqual(start, { ok: true, totalMinor: 47000, normalMinor: 33000, end: "pickup", endMinor: 14000, itineraryMinor: 0 });
  assert.equal(inheritText(start, "JPY"), "继承：普通 33,000 + 上车加价 14,000");
  assert.equal(inheritPlaceholder(start, "JPY"), "继承 47,000");
  const end = inheritedAirportPrice({ ...query, scenario: "airport_end", location: AT_NARITA });
  assert.equal(end.ok && end.totalMinor, 61000);
  assert.equal(inheritText(end, "JPY"), "继承：普通 33,000 + 下车加价 14,000 + 下车点行程加价 14,000");
  // 商品关了「下车点行程加价」：只加下车加价
  const off = inheritedAirportPrice({ ...query, scenario: "airport_end", location: AT_NARITA, dropoffItinerary: false });
  assert.equal(off.ok && off.totalMinor, 47000);
});

test("继承价：机场在①基础价区域里（羽田）= 普通价，没有加价；③按套餐的那条优先于「所有套餐」那条；几个③重叠取最高", () => {
  const haneda = inheritedAirportPrice({ ...query, scenario: "airport_end", location: { inProductArea: true, updownAreaIds: [NARITA_UPDOWN], itineraryAreaIds: [NARITA_ITINERARY] } });
  assert.deepEqual(haneda, { ok: true, totalMinor: 33000, normalMinor: 33000, end: "dropoff", endMinor: 0, itineraryMinor: 0 });
  assert.equal(inheritText(haneda, "JPY"), "继承：普通 33,000");
  const perPackage = updown({ packageHours: 5, pricing: { model: "charter_area_surcharge", pickupSurchargeMinor: 9000, dropoffSurchargeMinor: 9000 } });
  const picked = inheritedAirportPrice({ ...query, rules: [updown(), perPackage], scenario: "airport_start", location: AT_NARITA });
  assert.equal(picked.ok && picked.endMinor, 9000);
  const other = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  const higher = inheritedAirportPrice({ ...query, rules: [updown(), updown({ areaId: other, pricing: { model: "charter_area_surcharge", pickupSurchargeMinor: 12000, dropoffSurchargeMinor: 12000 } })], scenario: "airport_start", location: { ...AT_NARITA, updownAreaIds: [other, NARITA_UPDOWN] } });
  assert.equal(higher.ok && higher.endMinor, 14000);
});

test("继承价算不出：没有普通套餐价、机场位置没取到、那一端没有能用的③加价（停用的不算）；算不出时写原因、不标黄", () => {
  const noNormal = inheritedAirportPrice({ ...query, normalMinor: null, scenario: "airport_start", location: AT_NARITA });
  assert.deepEqual(noNormal, { ok: false, reason: "noNormal" });
  assert.equal(inheritText(noNormal, "JPY"), "继承：这个时长没有普通套餐价，空着报不出");
  assert.equal(inheritPlaceholder(noNormal, "JPY"), "");
  assert.deepEqual(inheritedAirportPrice({ ...query, scenario: "airport_start", location: null }), { ok: false, reason: "noLocation" });
  assert.deepEqual(inheritedAirportPrice({ ...query, rules: [updown({ status: "disabled" })], scenario: "airport_start", location: AT_NARITA }), { ok: false, reason: "noSurcharge" });
  assert.deepEqual(inheritedAirportPrice({ ...query, scenario: "airport_start", location: { inProductArea: false, updownAreaIds: [], itineraryAreaIds: [] } }), { ok: false, reason: "noSurcharge" });
  assert.equal(airportCellWarn(99999, noNormal), false);
});

test("标黄：单独价高于继承价才标（等于、低于、空格都不标）", () => {
  const inherited = inheritedAirportPrice({ ...query, scenario: "airport_start", location: AT_NARITA });
  assert.equal(airportCellWarn(45000, inherited), false);
  assert.equal(airportCellWarn(47000, inherited), false);
  assert.equal(airportCellWarn(47001, inherited), true);
  assert.equal(airportCellWarn(null, inherited), false);
});

test("机场那一端落在哪：按区域图形判断①、③、②（停用的区域不算）", () => {
  const square = (id: string, lng: number, lat: number, active = true): AreaShapes => ({ areaId: id, active, shapes: [{ id: `${id}-1`, kind: "operate", ring: [[lng - 0.1, lat - 0.1], [lng + 0.1, lat - 0.1], [lng + 0.1, lat + 0.1], [lng - 0.1, lat + 0.1], [lng - 0.1, lat - 0.1]] }] });
  const narita = { lat: 35.77, lng: 140.39 };
  const located = airportEndLocation(narita, { product: [square("tokyo", 139.7, 35.68)], updown: [square(NARITA_UPDOWN, 140.39, 35.77), square("off", 140.39, 35.77, false)], itinerary: [square(NARITA_ITINERARY, 140.4, 35.78)] });
  assert.deepEqual(located, { inProductArea: false, updownAreaIds: [NARITA_UPDOWN], itineraryAreaIds: [NARITA_ITINERARY] });
  assert.equal(airportEndLocation({ lat: 35.68, lng: 139.7 }, { product: [square("tokyo", 139.7, 35.68)], updown: [], itinerary: [] }).inProductArea, true);
});

test("新格的 ref 不超过 100 个字符（两个编号各 36 个字符，前缀要短，#281）；场景分得开", () => {
  const start = blankAirportKey("airport_start", NARITA_AREA, VAN, 12);
  assert.ok(start.length <= 100, `${start.length}`);
  assert.notEqual(start, blankAirportKey("airport_end", NARITA_AREA, VAN, 12));
});

test("读一格：全空 = 继承；填了单价就要填单独价；含公里要整数；读出来的是 charter_airport_package，方向按场景，单价不填为 null", () => {
  const cell = (change: Partial<AirportCell>): AirportCell => ({ ...blankAirportCell("airport_end", NARITA_AREA, VAN, 5, TODAY), ...change });
  assert.equal(readAirportCell(cell({}), "JPY").blank, true);
  assert.deepEqual(readAirportCell(cell({ km: "100" }), "JPY").problems.map((problem) => problem.field), ["price"]);
  assert.deepEqual(readAirportCell(cell({ price: "45,000", km: "1.5" }), "JPY").problems.map((problem) => problem.field), ["km"]);
  assert.deepEqual(readAirportCell(cell({ price: "-1" }), "JPY").problems.map((problem) => problem.field), ["price"]);
  const reading = readAirportCell(cell({ price: "45,000", overtime: "6,000" }), "JPY");
  assert.equal(reading.priceMinor, 45000);
  assert.deepEqual(
    { model: reading.input?.pricing_model, direction: reading.input?.direction, hours: reading.input?.package_hours, price: reading.input?.package_price, km: reading.input?.package_km, overKm: reading.input?.over_km_per_km, overtime: reading.input?.overtime_per_hour, from: reading.input?.valid_from, to: reading.input?.valid_to },
    { model: "charter_airport_package", direction: "dropoff", hours: 5, price: 45000, km: null, overKm: null, overtime: 6000, from: TODAY, to: null },
  );
});

const saved = (overrides: Partial<PriceRuleBody> = {}): PriceRuleBody => ({
  id: RULE_ID,
  area_id: NARITA_AREA,
  vehicle_group_id: VAN,
  direction: "pickup",
  package_hours: 5,
  pricing_model: "charter_airport_package",
  base_price: null,
  start_price: null,
  start_meters: null,
  start_minutes: null,
  per_km: null,
  per_minute: null,
  min_price: null,
  package_km: null,
  package_price: 45000,
  overtime_per_hour: null,
  over_km_per_km: null,
  valid_from: "2026-11-01",
  valid_to: null,
  status: "enabled",
  base: "45000",
  created_at: "2026-11-01T00:00:00.000Z",
  updated_at: "2026-11-01T00:00:00.000Z",
  ...overrides,
});

test("批量保存：新填 → create（带 ref）；改了 → update（日期不变）；清空已保存的 → delete（改回继承）；没改 → 不提交", () => {
  const fresh = { ...blankAirportCell("airport_start", NARITA_AREA, VAN, 10, TODAY), price: "80,000" };
  const unchanged = airportCellFromRule(saved(), "JPY");
  assert.equal(unchanged.price, "45,000");
  assert.equal(unchanged.scenario, "airport_start");
  assert.equal(airportChangeCount([unchanged], "JPY"), 0);
  const batch = buildAirportBatch([fresh, { ...unchanged, price: "46,000" }], "JPY");
  assert.equal(batch.create.length, 1);
  assert.equal(batch.create[0]?.ref, fresh.key);
  assert.equal(batch.create[0]?.package_price, 80000);
  assert.deepEqual([batch.update[0]?.id, batch.update[0]?.package_price, batch.update[0]?.valid_from], [RULE_ID, 46000, "2026-11-01"]);
  assert.deepEqual(buildAirportBatch([{ ...unchanged, price: "" }], "JPY"), { create: [], update: [], delete: [RULE_ID] });
});

test("每格编辑哪一条：今天生效的；同一格别的日期段只计数；时长列 = 整商品套餐价的 ∪ 机场套餐价的", () => {
  const past = saved({ id: "past", valid_from: "2026-01-01", valid_to: "2026-10-31", package_price: 40000 });
  const current = saved();
  const other = saved({ id: "other", direction: "dropoff", package_hours: 6 });
  const { cells, others } = airportCellsOf([past, current, other], "JPY", TODAY);
  assert.deepEqual(cells.map((cell) => [cell.id, cell.scenario, cell.packageHours]), [["eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", "airport_start", 5], ["other", "airport_end", 6]]);
  assert.equal(others.get(blankAirportKey("airport_start", NARITA_AREA, VAN, 5)), 1);
  const whole = { pricing_model: "charter_package" as const, area_id: null as unknown as string, package_hours: 10 };
  const legacy = { pricing_model: "charter_package" as const, area_id: "x", package_hours: 3 };
  assert.deepEqual(airportHoursColumns([whole, legacy, current, other]), [5, 6, 10]);
});

test("日期重叠：新格从今天起一直有效，同一格以后才生效的段会和它重叠", () => {
  const future = saved({ id: "future", valid_from: "2026-12-01" });
  const fresh = { ...blankAirportCell("airport_start", NARITA_AREA, VAN, 5, TODAY), price: "50,000" };
  assert.deepEqual([...airportOverlaps([fresh], [future], "JPY")], [fresh.key]);
  assert.deepEqual([...airportOverlaps([{ ...fresh, to: "2026-11-30" }], [future], "JPY")], []);
});
