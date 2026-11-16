/**
 * 包车三层区域的价格页模型（lib/charter-layers.ts，M9P-07）：读格子、批量保存（挡住的区域只提交删除、③不带途经加价）、没填的格数、
 * 整商品套餐价的区域换回 null、保存被拒时的区域重叠。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { PriceRuleBody } from "../api/prices.ts";
import { WHOLE_PRODUCT_AREA, blankLayerRow, buildLayerBatch, layerChangeCount, layerOverlapDetails, layerOverlapSentence, layerOverlaps, layerRowFromRule, legacyPackageItems, missingCells, readLayerRow, wholePackageItems, withWholeProductArea } from "./charter-layers.ts";

const TODAY = "2026-11-16";
const stamps = { created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-02T00:00:00.000Z" };
const EMPTY = { direction: null, base_price: null, start_price: null, start_meters: null, start_minutes: null, per_km: null, per_minute: null, min_price: null, package_km: null, package_price: null, overtime_per_hour: null, over_km_per_km: null, valid_to: null, status: "enabled" as const, base: "0", ...stamps };
const updown = (overrides: Partial<PriceRuleBody> = {}): PriceRuleBody => ({ ...EMPTY, id: "u1", area_id: "fuji", vehicle_group_id: "g1", package_hours: null, pricing_model: "charter_area_surcharge", pickup_surcharge: 10000, dropoff_surcharge: 8000, waypoint_surcharge: 5000, valid_from: "2026-11-01", ...overrides });
const itinerary = (overrides: Partial<PriceRuleBody> = {}): PriceRuleBody => ({ ...EMPTY, id: "i1", area_id: "fuji", vehicle_group_id: "g1", package_hours: null, pricing_model: "charter_itinerary_surcharge", itinerary_surcharge: 10000, valid_from: "2026-11-01", ...overrides });
const pkg = (id: string, area: string | null): PriceRuleBody => ({ ...EMPTY, id, area_id: area as string, vehicle_group_id: "g1", package_hours: 10, pricing_model: "charter_package", package_km: 300, package_price: 55000, overtime_per_hour: 5000, over_km_per_km: 300, valid_from: "2026-11-01" });

test("整商品套餐价换成区域记号进价格表，提交时换回 null；旧的按区域套餐价另外列出", () => {
  const items = [pkg("w", null), pkg("old", "tokyo"), updown()];
  assert.deepEqual(wholePackageItems(items).map((item) => [item.id, item.area_id]), [["w", WHOLE_PRODUCT_AREA]]);
  assert.deepEqual(legacyPackageItems(items).map((item) => item.id), ["old"]);
  const input = { ...EMPTY, area_id: WHOLE_PRODUCT_AREA, vehicle_group_id: "g1", package_hours: 10, pricing_model: "charter_package" as const, valid_from: TODAY };
  const batch = withWholeProductArea({ create: [{ ...input, ref: "n1" }], update: [{ ...input, area_id: "tokyo", id: "x" }], delete: ["d"] });
  assert.deepEqual([batch.create[0]?.area_id, batch.update[0]?.area_id, batch.delete], [null, "tokyo", ["d"]]);
});

test("读一行：②一格金额、③上下车两格；空格不提交；③不带途经加价（后端沿用原值）；不分套餐的 package_hours 是 null", () => {
  const blank = blankLayerRow("charter_itinerary_surcharge", "fuji", "g2", TODAY);
  assert.equal(readLayerRow(blank, "JPY").blank, true);
  assert.deepEqual(readLayerRow({ ...blank, amount: "-1" }, "JPY").problems.map((problem) => problem.text), ["行程加价不能是负数"]);
  const filled = readLayerRow({ ...blank, amount: "0" }, "JPY");
  assert.deepEqual([filled.input?.itinerary_surcharge, filled.input?.package_hours, filled.input?.pricing_model], [0, null, "charter_itinerary_surcharge"]);
  const row = layerRowFromRule(updown(), "charter_area_surcharge", "JPY");
  assert.deepEqual([row.pickup, row.dropoff], ["10,000", "8,000"]);
  const missingDropoff = readLayerRow({ ...row, dropoff: "" }, "JPY");
  assert.deepEqual(missingDropoff.problems.map((problem) => problem.text), ["请填下车加价，不加钱请填 0"]);
  const changed = buildLayerBatch([{ ...row, pickup: "12,000" }], "JPY", new Set());
  assert.deepEqual(changed.update.map((entry) => [entry.id, entry.pickup_surcharge, entry.dropoff_surcharge]), [["u1", 12000, 8000]]);
  assert.equal("waypoint_surcharge" in (changed.update[0] ?? {}), false);
  assert.equal(layerChangeCount([row], "JPY", new Set()), 0, "没改的不提交（途经加价不比）");
});

test("挡住的区域（基础价区域上的③）：改动不提交、不算条数，只提交删除；日期重叠和没填的格不算它", () => {
  const onBase = layerRowFromRule(updown({ id: "b1", area_id: "tokyo" }), "charter_area_surcharge", "JPY");
  const other = layerRowFromRule(updown(), "charter_area_surcharge", "JPY");
  const blocked = new Set(["tokyo"]);
  const edited = [{ ...onBase, pickup: "1" }, { ...other, dropoff: "9,000" }];
  const batch = buildLayerBatch(edited, "JPY", blocked);
  assert.deepEqual([batch.create, batch.delete, batch.update.map((entry) => entry.id)], [[], [], ["u1"]]);
  assert.equal(layerChangeCount(edited, "JPY", blocked), 1);
  assert.deepEqual(buildLayerBatch([{ ...onBase, deleted: true }], "JPY", blocked).delete, ["b1"]);
  assert.equal(missingCells([onBase, other], ["tokyo", "fuji"], ["g1", "g2"], "JPY", TODAY, blocked), 1, "富士山 × g2 没填；东京不算");
  const twin = layerRowFromRule(updown({ id: "b2", area_id: "tokyo" }), "charter_area_surcharge", "JPY");
  assert.equal(layerOverlaps([onBase, twin], "JPY", blocked).size, 0);
  assert.equal(layerOverlaps([other, { ...other, key: "u2", id: "u2" }], "JPY", new Set()).size, 2);
});

test("没填的格：只算启用、现在或以后生效的；②和③各算各的", () => {
  const rows = [layerRowFromRule(itinerary(), "charter_itinerary_surcharge", "JPY"), layerRowFromRule(itinerary({ id: "i2", vehicle_group_id: "g2", status: "disabled" }), "charter_itinerary_surcharge", "JPY")];
  assert.equal(missingCells(rows, ["fuji"], ["g1", "g2"], "JPY", TODAY, new Set()), 1);
  assert.equal(missingCells(rows, ["fuji", "hakone"], ["g1", "g2"], "JPY", TODAY, new Set()), 3);
});

test("保存被拒的区域重叠：两个区域名和面积（平方公里）；没有 overlaps 时用顶层那一对", () => {
  const pair = { code: "AREA_LAYER_OVERLAP", layer: "pickup_dropoff", areas: ["千叶", "富士山"], area_ids: ["chiba", "fuji"], overlap_km2: 3.25 };
  const found = layerOverlapDetails({ ...pair, overlaps: [pair, { ...pair, layer: "base_pickup_dropoff", areas: ["东京", "千叶"], area_ids: ["tokyo", "chiba"], overlap_km2: 0.5 }] });
  assert.deepEqual(found.map((entry) => [entry.layer, entry.areaIds, entry.km2]), [["pickup_dropoff", ["chiba", "fuji"], 3.25], ["base_pickup_dropoff", ["tokyo", "chiba"], 0.5]]);
  assert.match(layerOverlapSentence(found[0] as (typeof found)[number]), /^「千叶」和「富士山」重叠约 3\.25 平方公里：同一个商品的上下车加价的区域不能重叠/);
  assert.match(layerOverlapSentence(found[1] as (typeof found)[number]), /^基础价区域「东京」和上下车加价的区域「千叶」重叠约 0\.5 平方公里/);
  assert.deepEqual(layerOverlapDetails(pair).map((entry) => entry.areas), [["千叶", "富士山"]]);
  assert.deepEqual(layerOverlapDetails({}), []);
});
