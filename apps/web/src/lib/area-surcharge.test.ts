/**
 * 包车「区域加价」的表格模型（lib/area-surcharge.ts，M8-12a）：读格子、批量保存的请求、删除 = 停用、汇总、一次填所有组合。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { PriceRuleBody } from "../api/prices.ts";
import { applyFill, areaSummary, blankSurchargeRow, buildSurchargeBatch, commonAmount, mergeSurchargeRow, planFill, rangeText, readSurchargeRow, surchargeChangeCount, surchargeOverlaps, surchargeRowFromRule, surchargeSentence } from "./area-surcharge.ts";

const TODAY = "2026-11-10";
const stamps = { created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-02T00:00:00.000Z" };
const rule = (overrides: Partial<PriceRuleBody> = {}): PriceRuleBody => ({
  id: "r1",
  area_id: "fuji",
  vehicle_group_id: "g1",
  direction: null,
  package_hours: 8,
  pricing_model: "charter_area_surcharge",
  base_price: null,
  start_price: null,
  start_meters: null,
  start_minutes: null,
  per_km: null,
  per_minute: null,
  min_price: null,
  package_km: null,
  package_price: null,
  overtime_per_hour: null,
  over_km_per_km: null,
  pickup_surcharge: 1000,
  dropoff_surcharge: 1500,
  valid_from: "2026-11-01",
  valid_to: null,
  status: "enabled",
  base: "0",
  ...stamps,
  ...overrides,
});
const none = new Set<string>();

test("读一行：两个金额都要填（0 可以），不能是负数、不能有小数；填好了是一条区域加价规则", () => {
  const row = { ...blankSurchargeRow("fuji", "g1", 8, TODAY), pickup: "1,000", dropoff: "0" };
  const reading = readSurchargeRow(row, "JPY");
  assert.deepEqual(reading.problems, []);
  assert.deepEqual(reading.rule?.pricing, { model: "charter_area_surcharge", pickupSurchargeMinor: 1000, dropoffSurchargeMinor: 0 });
  assert.equal(reading.input?.pickup_surcharge, 1000);
  assert.equal(reading.input?.dropoff_surcharge, 0);
  assert.equal(reading.input?.package_price, null);
  assert.deepEqual(readSurchargeRow({ ...row, dropoff: "" }, "JPY").problems, [{ field: "dropoff", text: "请填下车加价，不加钱请填 0" }]);
  assert.deepEqual(readSurchargeRow({ ...row, pickup: "-5" }, "JPY").problems, [{ field: "pickup", text: "上车加价不能是负数" }]);
  assert.match(readSurchargeRow({ ...row, pickup: "10.5" }, "JPY").problems[0]?.text ?? "", /小数/);
  assert.match(readSurchargeRow({ ...row, pickup: "abc" }, "JPY").problems[0]?.text ?? "", /数字/);
  assert.match(readSurchargeRow({ ...row, pickup: "2000000000" }, "JPY").problems[0]?.text ?? "", /最多/);
  assert.deepEqual(readSurchargeRow({ ...row, to: "2026-10-01" }, "JPY").problems, [{ field: "to", text: "结束日期不能早于开始日期" }]);
  assert.equal(readSurchargeRow(blankSurchargeRow("fuji", "g1", 8, TODAY), "JPY").blank, true);
});

test("批量保存：新的是 create（带 ref），改过的是 update，明细里单条删除是 delete，没改的不提交", () => {
  const saved = surchargeRowFromRule(rule(), "JPY");
  const created = { ...blankSurchargeRow("fuji", "g1", 10, TODAY), key: "sc-new-x", pickup: "800", dropoff: "800" };
  const batch = buildSurchargeBatch([saved, created], "JPY", none);
  assert.deepEqual([batch.create.map((entry) => [entry.ref, entry.pickup_surcharge, entry.package_hours]), batch.update, batch.delete], [[["sc-new-x", 800, 10]], [], []]);
  const changed = buildSurchargeBatch([{ ...saved, pickup: "1,200" }], "JPY", none);
  assert.deepEqual(changed.update.map((entry) => [entry.id, entry.pickup_surcharge, entry.status]), [["r1", 1200, "enabled"]]);
  assert.deepEqual(buildSurchargeBatch([{ ...saved, deleted: true }], "JPY", none).delete, ["r1"]);
  assert.equal(surchargeChangeCount([saved], "JPY", none), 0);
});

test("删除加价区域 = 停用：启用中的已保存行改成不启用（不发删除），没保存的不提交，已经停用的不动", () => {
  const rows = [surchargeRowFromRule(rule(), "JPY"), surchargeRowFromRule(rule({ id: "r2", package_hours: 10, status: "disabled" }), "JPY"), { ...blankSurchargeRow("fuji", "g2", 8, TODAY), key: "sc-new-y", pickup: "1", dropoff: "1" }];
  const batch = buildSurchargeBatch(rows, "JPY", new Set(["fuji"]));
  assert.deepEqual([batch.create, batch.delete], [[], []]);
  assert.deepEqual(batch.update.map((entry) => [entry.id, entry.status, entry.pickup_surcharge, entry.dropoff_surcharge]), [["r1", "disabled", 1000, 1500]]);
});

test("汇总：一样写一个数，不一样写最小–最大；没填的组合数出来；已过期、停用的不算", () => {
  const rows = [
    surchargeRowFromRule(rule(), "JPY"),
    surchargeRowFromRule(rule({ id: "r2", vehicle_group_id: "g2", pickup_surcharge: 500 }), "JPY"),
    surchargeRowFromRule(rule({ id: "r3", package_hours: 10, valid_to: "2026-11-01" }), "JPY"),
    surchargeRowFromRule(rule({ id: "r4", vehicle_group_id: "g2", package_hours: 10, status: "disabled" }), "JPY"),
  ];
  const summary = areaSummary(rows, "fuji", ["g1", "g2"], [8, 10], "JPY", TODAY);
  assert.deepEqual(summary, { pickup: { min: 500, max: 1000 }, dropoff: { min: 1500, max: 1500 }, missing: 2, total: 4 });
  assert.equal(rangeText(summary.pickup, "JPY"), "500–1,000");
  assert.equal(rangeText(summary.dropoff, "JPY"), "1,500");
  assert.equal(commonAmount(rows, "fuji", "dropoff", "JPY", TODAY), "1,500");
  assert.equal(commonAmount(rows, "fuji", "pickup", "JPY", TODAY), "");
});

test("一次给所有车型组和套餐填：空组合新填（空行就地填上），已经填了的按选择改最后一段或跳过", () => {
  const saved = surchargeRowFromRule(rule(), "JPY");
  const blank = { ...blankSurchargeRow("fuji", "g2", 8, TODAY) };
  const rows = [saved, blank];
  const request = { areaId: "fuji", groupIds: ["g1", "g2"], packages: [8, 10], pickup: "2000", dropoff: "0", from: TODAY, to: "" };
  assert.deepEqual(planFill(rows, { ...request, existing: "overwrite" }, TODAY), { fill: 3, overwrite: 1, multiSegment: 0 });
  assert.deepEqual(planFill(rows, { ...request, existing: "skip" }, TODAY), { fill: 3, overwrite: 0, multiSegment: 0 });
  const skipped = applyFill(rows, { ...request, existing: "skip" }, "JPY");
  assert.equal(skipped.count, 3);
  assert.equal(skipped.rows.length, 4);
  assert.equal(skipped.rows.find((row) => row.key === blank.key)?.pickup, "2,000");
  assert.equal(skipped.rows.find((row) => row.key === "r1")?.pickup, "1,000");
  const batch = buildSurchargeBatch(skipped.rows, "JPY", none);
  assert.deepEqual(batch.create.map((entry) => [entry.vehicle_group_id, entry.package_hours, entry.pickup_surcharge, entry.dropoff_surcharge]).sort(), [["g1", 10, 2000, 0], ["g2", 10, 2000, 0], ["g2", 8, 2000, 0]]);
  const overwritten = applyFill(rows, { ...request, pickup: "", existing: "overwrite" }, "JPY");
  assert.deepEqual([overwritten.rows.find((row) => row.key === "r1")?.pickup, overwritten.rows.find((row) => row.key === "r1")?.dropoff], ["1,000", "0"]);
});

test("日期重叠用 domain 的规则：同一个加价区域 × 车型组 × 套餐才算；标了将删除的区域不算", () => {
  const rows = [surchargeRowFromRule(rule(), "JPY"), { ...blankSurchargeRow("fuji", "g1", 8, TODAY), key: "sc-new-z", pickup: "1", dropoff: "1" }, { ...blankSurchargeRow("fuji", "g1", 10, TODAY), key: "sc-new-w", pickup: "1", dropoff: "1" }];
  assert.deepEqual([...surchargeOverlaps(rows, "JPY", none).keys()].sort(), ["r1", "sc-new-z"]);
  assert.equal(surchargeOverlaps(rows, "JPY", new Set(["fuji"])).size, 0);
});

test("读回：填 0 写成不加钱，金额带币种", () => {
  assert.equal(surchargeSentence("富士山", 0, 1000, "JPY"), "上车点在富士山时不加钱，下车点在富士山时加 JPY 1,000。");
});

test("载入最新内容时按格子合：我改的留我的，我没动的换成最新的；同一格两人改得不一样标为冲突", () => {
  const mine = { ...surchargeRowFromRule(rule(), "JPY"), pickup: "1,200" };
  const theirs = surchargeRowFromRule(rule({ dropoff_surcharge: 2000 }), "JPY");
  assert.deepEqual([mergeSurchargeRow(mine, theirs, "JPY").row.pickup, mergeSurchargeRow(mine, theirs, "JPY").row.dropoff, mergeSurchargeRow(mine, theirs, "JPY").conflict], ["1,200", "2,000", false]);
  const same = surchargeRowFromRule(rule({ pickup_surcharge: 1500 }), "JPY");
  assert.equal(mergeSurchargeRow(mine, same, "JPY").conflict, true);
  assert.equal(mergeSurchargeRow(mine, surchargeRowFromRule(rule({ pickup_surcharge: 1200 }), "JPY"), "JPY").conflict, false);
});
