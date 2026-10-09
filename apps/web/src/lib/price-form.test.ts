import { test } from "node:test";
import assert from "node:assert/strict";
import type { PriceRuleBody } from "../api/prices.ts";
import { type PriceContext, type PriceRow, blankRow, buildBatch, kmTextToMeters, lowestText, metersToKmText, pricingSentence, readRow, rowChange, rowFromRule, rowOverlaps, rowState, tableCoverage, validitySentence, withBlankRows } from "./price-form.ts";

const A1 = "area-1";
const A2 = "area-2";
const G1 = "group-1";
const airport: PriceContext = { category: "airport_transfer", currency: "JPY", today: "2026-10-08", station: false };
const charter: PriceContext = { ...airport, category: "charter" };
const stamps = { created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" };
const NONE = { base_price: null, start_price: null, start_meters: null, start_minutes: null, per_km: null, per_minute: null, min_price: null, package_km: null, package_price: null, overtime_per_hour: null, over_km_per_km: null };
const fixed = (id: string, overrides: Partial<PriceRuleBody> = {}): PriceRuleBody => ({ id, area_id: A1, vehicle_group_id: G1, direction: "both", package_hours: null, pricing_model: "fixed", ...NONE, base_price: 20000, valid_from: "2026-10-01", valid_to: null, status: "enabled", base: "20000", ...stamps, ...overrides });
const edit = (row: PriceRow, changes: Omit<Partial<PriceRow>, "values"> & { values?: Partial<PriceRow["values"]> }): PriceRow => ({ ...row, ...changes, values: { ...row.values, ...(changes.values ?? {}) } });

test("公里和米用字符串换算：最多 1 位小数，来回不变", () => {
  for (const [text, meters] of [["0", 0], ["10", 10000], ["10.5", 10500], ["0.1", 100], ["1,000", 1000000], ["１２．５", 12500]] as const) assert.equal(kmTextToMeters(text), meters, text);
  for (const text of ["", "1.25", "abc", "-1", "1."]) assert.equal(kmTextToMeters(text), null, text);
  for (const meters of [0, 100, 900, 1000, 10500, 1000000]) assert.equal(kmTextToMeters(metersToKmText(meters)), meters);
});

test("接口的价格 → 行 → 原样读回来：没有修改，不会多出一次提交", () => {
  const mileage = fixed("m", { pricing_model: "mileage_time", base_price: null, start_price: 8000, start_meters: 10500, start_minutes: 30, per_km: 300, per_minute: 50, min_price: 9000 });
  const rows = [rowFromRule(fixed("f"), "JPY"), rowFromRule(mileage, "JPY")];
  for (const row of rows) assert.equal(rowChange(row, readRow(row, airport)), "none");
  assert.deepEqual(buildBatch(rows, airport), { create: [], update: [], delete: [] });
  assert.equal(rows[1]?.values.startKm, "10.5");
});

test("读一行：空行没有问题；填了一格就要填齐；各种写错的话", () => {
  const blank = blankRow({ areaId: A1, vehicleGroupId: G1, direction: "both", packageHours: null }, "fixed", airport.today);
  assert.deepEqual(readRow(blank, airport), { blank: true, rule: null, input: null, problems: [], notes: [] });
  assert.equal(blank.from, "2026-10-08");
  const texts = (row: PriceRow, context = airport): string[] => readRow(row, context).problems.map((problem) => problem.text);
  assert.deepEqual(texts(edit(blank, { values: { base: "0" } })), ["基础价要大于 0"]);
  assert.deepEqual(texts(edit(blank, { values: { base: "1.5" } })), ["日元金额不能有小数"]);
  assert.deepEqual(texts(edit(blank, { values: { base: "abc" } })), ["请填数字"]);
  assert.deepEqual(texts(edit(blank, { values: { base: "-5" } })), ["基础价不能是负数"]);
  assert.deepEqual(texts(edit(blank, { values: { base: "20000" }, from: "" })), ["请填开始日期"]);
  assert.deepEqual(texts(edit(blank, { values: { base: "20000" }, from: "2026-10-10", to: "2026-10-01" })), ["结束日期不能早于开始日期"]);
  assert.deepEqual(texts(edit(blank, { values: { base: "20000" }, to: "明年" })), ["这不是一个日期，请按 2026-10-08 的格式填写"]);
  const mileage = edit(blank, { model: "mileage_time", values: { base: "0" } });
  assert.deepEqual(texts(mileage), ["请填起步里程", "请填起步时长", "请填超出每公里，不另收请填 0", "请填超出每分钟，不另收请填 0", "起步价是 0 时，请填最低消费"]);
  assert.deepEqual(texts(edit(mileage, { values: { base: "8000", startKm: "1001", startMin: "1.5", perKm: "0", perMin: "0" } })), ["请填 0 到 1000 之间的数，最多 1 位小数", "请填 0 到 1440 之间的整数"]);
  // 两位小数的币种
  const usd = { ...airport, currency: "USD" };
  assert.deepEqual(texts(edit(blank, { values: { base: "46.005" } }), usd), ["USD 最多 2 位小数"]);
  assert.equal(readRow(edit(blank, { values: { base: "4,600.5" } }), usd).input?.base_price, 460050);
  // 全角数字、带币种符号的也认
  assert.equal(readRow(edit(blank, { values: { base: "￥２０，０００" } }), airport).input?.base_price ?? readRow(edit(blank, { values: { base: "２０，０００" } }), airport).input?.base_price, 20000);
});

test("批量保存的请求体：新填的带页面起的记号，改过的带编号，将删除的只给编号；没变的和空行不提交", () => {
  const kept = rowFromRule(fixed("keep"), "JPY");
  const changed = edit(rowFromRule(fixed("change", { direction: "pickup" }), "JPY"), { values: { base: "25,000" }, to: "2027/3/31" });
  const removed = edit(rowFromRule(fixed("remove", { direction: "dropoff" }), "JPY"), { deleted: true });
  const created = edit(blankRow({ areaId: A2, vehicleGroupId: G1, direction: "both", packageHours: null }, "mileage_time", airport.today), { values: { base: "8000", startKm: "10", startMin: "30", perKm: "300", perMin: "50" }, enabled: false });
  const blank = blankRow({ areaId: A2, vehicleGroupId: "group-2", direction: "both", packageHours: null }, "fixed", airport.today);
  const batch = buildBatch([kept, changed, removed, created, blank], airport);
  assert.deepEqual(batch.delete, ["remove"]);
  assert.deepEqual(batch.update.map((entry) => [entry.id, entry.base_price, entry.valid_to]), [["change", 25000, "2027-03-31"]]);
  assert.deepEqual(batch.create, [{ ref: created.key, area_id: A2, vehicle_group_id: G1, direction: "both", package_hours: null, pricing_model: "mileage_time", ...NONE, start_price: 8000, start_meters: 10000, start_minutes: 30, per_km: 300, per_minute: 50, valid_from: "2026-10-08", valid_to: null, status: "disabled" }]);
});

test("日期重叠：同一个组合两头都算；将删除的不算；方向不同不是同一个组合", () => {
  const old = rowFromRule(fixed("old"), "JPY");
  const next = edit(blankRow({ areaId: A1, vehicleGroupId: G1, direction: "both", packageHours: null }, "fixed", airport.today), { values: { base: "22000" }, from: "2027-04-01" });
  const pickup = rowFromRule(fixed("pickup", { direction: "pickup" }), "JPY");
  assert.deepEqual([...rowOverlaps([old, next, pickup], airport).entries()], [["old", [next.key]], [next.key, ["old"]]]);
  assert.equal(rowOverlaps([edit(old, { to: "2027-03-31" }), next, pickup], airport).size, 0);
  assert.equal(rowOverlaps([edit(old, { to: "2027-04-01" }), next], airport).size, 2, "结束那一天和开始那一天是同一天也算重叠");
  assert.equal(rowOverlaps([edit(old, { deleted: true }), next], airport).size, 0);
});

test("该有价格的组合按页面上现在的内容算；空行的方向：两个方向都缺给「接送通用」，只缺一个给那一个", () => {
  const pickupOnly = rowFromRule(fixed("p", { direction: "pickup" }), "JPY");
  const coverage = tableCoverage([pickupOnly], airport, [A1, A2], [G1]);
  assert.deepEqual([coverage.total, coverage.priced, coverage.missing], [4, 1, 3]);
  const rows = withBlankRows([pickupOnly], airport, [A1, A2], [G1], "fixed");
  assert.deepEqual(rows.slice(1).map((row) => [row.areaId, row.direction]), [[A1, "dropoff"], [A2, "both"]]);
  assert.equal(withBlankRows(rows, airport, [A1, A2], [G1], "fixed").length, rows.length, "已经有空行的不重复补");
  // 填上一个空行：缺口立即变小；停用的不算有价格；以后才开始的算
  const filled = rows.map((row) => (row.areaId === A2 ? edit(row, { values: { base: "30000" }, from: "2027-01-01" }) : row));
  const after = tableCoverage(filled, airport, [A1, A2], [G1]);
  assert.equal(after.missing, 1);
  assert.deepEqual(after.combos.filter((combo) => combo.areaId === A2).map((combo) => [combo.state, combo.viaBoth, combo.from]), [["upcoming", true, "2027-01-01"], ["upcoming", true, "2027-01-01"]]);
  assert.equal(tableCoverage(filled.map((row) => (row.areaId === A2 ? { ...row, enabled: false } : row)), airport, [A1, A2], [G1]).missing, 3);
});

test("包车：套餐就是价格里出现过的时长；只有空行的新套餐也算进缺口", () => {
  const ten = rowFromRule(fixed("c", { direction: null, package_hours: 10, pricing_model: "charter_package", base_price: null, package_km: 300, package_price: 98000, overtime_per_hour: 5000, over_km_per_km: 400 }), "JPY");
  const rows = withBlankRows([ten], charter, [A1, A2], [G1], "charter_package", [5]);
  assert.deepEqual(rows.map((row) => [row.areaId, row.packageHours, readRow(row, charter).blank]), [[A1, 10, false], [A1, 5, true], [A2, 10, true], [A2, 5, true]]);
  const coverage = tableCoverage(rows, charter, [A1, A2], [G1]);
  assert.deepEqual([coverage.packages, coverage.total, coverage.missing], [[5, 10], 4, 3]);
});

test("这一行现在怎么样：按城市当地的今天算", () => {
  const state = (rule: PriceRuleBody, changes: Partial<PriceRow> = {}): string => {
    const row = edit(rowFromRule(rule, "JPY"), changes);
    return rowState(row, readRow(row, airport), false, airport, [row]).text;
  };
  assert.equal(state(fixed("a")), "生效中");
  assert.equal(state(fixed("a", { status: "disabled" })), "已停用");
  assert.equal(state(fixed("a", { valid_to: "2026-10-07" })), "已过期");
  assert.equal(state(fixed("a", { valid_from: "2026-11-01" })), "2026-11-01 起生效");
  assert.equal(state(fixed("a", { valid_to: "2026-10-31" })), "2026-10-31 到期，之后没有价格");
  assert.equal(state(fixed("a", { valid_to: "2027-10-31" })), "生效中");
  assert.equal(state(fixed("a"), { deleted: true }), "将删除");
  assert.equal(state(fixed("a"), { values: { base: "1", startKm: "", startMin: "", perKm: "", perMin: "", min: "", pkgKm: "", pkgPrice: "", overHour: "", overKm: "" } }), "改过，未保存");
});

test("读回来的话：三种计价方式；0 写成人话；里程 + 时长的例子用 domain 的 basePrice 算", () => {
  assert.equal(pricingSentence({ model: "fixed", basePriceMinor: 20000 }, null, "JPY"), "每单 JPY 20,000，不看里程和时长。");
  assert.equal(
    pricingSentence({ model: "mileage_time", startPriceMinor: 8000, startMeters: 10000, startMinutes: 30, perKmMinor: 300, perMinuteMinor: 50, minPriceMinor: 9000 }, null, "JPY"),
    "10 公里、30 分钟以内 JPY 8,000；超出的部分每公里 JPY 300（不足 1 公里按比例）、每分钟 JPY 50；最少收 JPY 9,000。按预估的里程和时长报价，不按实际跑的结算。例：预估 20 公里、50 分钟 = JPY 12,000。",
  );
  assert.match(pricingSentence({ model: "mileage_time", startPriceMinor: 8000, startMeters: 10000, startMinutes: 30, perKmMinor: 0, perMinuteMinor: 0, minPriceMinor: null }, null, "JPY"), /超出里程不另收、超出时长不另收。/);
  assert.equal(pricingSentence({ model: "charter_package", packageKm: 300, packagePriceMinor: 98000, overtimePerHourMinor: 5000, overKmPerKmMinor: 0 }, 10, "JPY"), "10 小时、300 公里以内 JPY 98,000；超时每小时 JPY 5,000，超公里不另收（超出的部分服务结束后按实际结算，不足 1 小时、1 公里的按比例算）。");
  assert.equal(validitySentence({ validFrom: "2026-10-10", validTo: null, status: "enabled" }), "2026-10-10 起一直有效。");
  assert.equal(validitySentence({ validFrom: "2026-10-10", validTo: "2027-03-31", status: "disabled" }), "2026-10-10 至 2027-03-31 有效。现在是停用的，不会用来报价。");
  assert.equal(lowestText({ model: "fixed", basePriceMinor: 460050 }, "USD"), "4,600.50");
  assert.equal(lowestText({ model: "mileage_time", startPriceMinor: 8000, startMeters: 0, startMinutes: 0, perKmMinor: 1, perMinuteMinor: 1, minPriceMinor: 9000 }, "JPY", true), "JPY 9,000 起");
});
