/**
 * 点对点线路价、含公里数的页面逻辑（M8-12，tenant-prices.md 17.3、17.4、17.7）：
 * 含公里数的读法、读回的例子（和 domain 的 overKm 同一个函数）、带返程的表单展开、复制线路、按格子合、保存被拒的说法、导入预览。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { overKm } from "@nozomi/domain";
import type { PriceRuleBody } from "../api/prices.ts";
import { priceRowText } from "./inventory-form.ts";
import { type PriceContext, type PriceRow, buildBatch, includedKmSentence, lowestText, mergePriceRow, readRow, rowChange, rowFromRule, rowOverlaps, tableCoverage } from "./price-form.ts";
import { applyCopy, copyDraftFor, copyDraftIssues, emptyRouteDraft, planCopy, planRoute, routeDraftIssues, routeIssue, routePlanText, routesIn } from "./route-prices.ts";

const A = "area-a";
const B = "area-b";
const G1 = "group-1";
const G2 = "group-2";
const p2p: PriceContext = { category: "point_to_point", currency: "JPY", today: "2026-11-10", station: false };
const stamps = { created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" };
const NONE = { direction: null, package_hours: null, start_price: null, start_meters: null, start_minutes: null, per_km: null, per_minute: null, min_price: null, package_km: null, package_price: null, overtime_per_hour: null, over_km_per_km: null, included_km: null };
const rule = (id: string, overrides: Partial<PriceRuleBody> = {}): PriceRuleBody => ({ id, area_id: A, to_area_id: B, vehicle_group_id: G1, pricing_model: "fixed", ...NONE, base_price: 18000, included_km: 30, over_km_per_km: 300, valid_from: "2026-11-01", valid_to: null, status: "enabled", base: "18000", ...stamps, ...overrides });
const rowOf = (body: PriceRuleBody): PriceRow => rowFromRule(body, "JPY");

test("含公里数：读回来没有修改；两格要一起填；含公里数 1 到 2,000 的整数；超出每公里可以是 0；只有点对点的一口价", () => {
  const row = rowOf(rule("r1"));
  assert.deepEqual([row.toAreaId, row.values.inclKm, row.values.kmPrice], [B, "30", "300"]);
  assert.equal(rowChange(row, readRow(row, p2p)), "none");
  const reading = readRow(row, p2p);
  assert.deepEqual(reading.rule?.pricing, { model: "fixed", basePriceMinor: 18000, includedKm: 30, overKmPerKmMinor: 300 });
  assert.equal(reading.rule?.toAreaId, B);
  const texts = (values: Partial<PriceRow["values"]>): string[] => readRow({ ...row, values: { ...row.values, ...values } }, p2p).problems.map((problem) => `${problem.field}:${problem.text}`);
  assert.deepEqual(texts({ kmPrice: "" }), ["kmPrice:含公里数和超出每公里要一起填，或者都不填"]);
  assert.deepEqual(texts({ inclKm: "" }), ["inclKm:含公里数和超出每公里要一起填，或者都不填"]);
  for (const bad of ["0", "2001", "12.5", "abc"]) assert.deepEqual(texts({ inclKm: bad }), ["inclKm:含公里数请填 1 到 2,000 之间的整数"], bad);
  assert.deepEqual(texts({ kmPrice: "-1" }), ["kmPrice:超出每公里不能是负数"]);
  assert.deepEqual(texts({ inclKm: "2,000", kmPrice: "0" }), []);
  assert.deepEqual(readRow({ ...row, values: { ...row.values, inclKm: "", kmPrice: "" } }, p2p).input?.included_km, null);
  // 接送机不认这两格（列也不显示）
  const airport: PriceContext = { ...p2p, category: "airport_transfer" };
  const airportRow = rowOf(rule("r2", { to_area_id: null, included_km: null, over_km_per_km: null, direction: "both" }));
  assert.equal(readRow(airportRow, airport).input?.to_area_id, undefined, "非点对点不带下车区域");
});

test("改已有的线路价：update 带着下车区域和含公里数；改了含公里数也算改过", () => {
  const row = rowOf(rule("r1"));
  const changed = { ...row, values: { ...row.values, inclKm: "40" } };
  const batch = buildBatch([changed], p2p);
  assert.deepEqual(batch.update.map((entry) => [entry.id, entry.to_area_id, entry.included_km, entry.over_km_per_km, entry.base_price]), [["r1", B, 40, 300, 18000]]);
});

test("读回的话：例子取含公里数 + 4.2 公里，超出公里数用 domain 的 overKm；0 = 超出不另收；日历和覆盖表写「起」", () => {
  assert.equal(overKm(34_200, 30), 5);
  assert.equal(includedKmSentence({ basePriceMinor: 18000, includedKm: 30, overKmPerKmMinor: 300 }, "JPY"), "每单 JPY 18,000，含 30 公里，超出每公里 JPY 300（不足 1 公里按 1 公里）。按报价时的路线距离算进一口价，客人付的就是这一个价，车开绕路不另收。例：路线 34.2 公里 = JPY 18,000 + 5 公里 × JPY 300 = JPY 19,500。");
  assert.equal(includedKmSentence({ basePriceMinor: 18000, includedKm: 30, overKmPerKmMinor: 0 }, "JPY"), "每单 JPY 18,000，含 30 公里，超出不另收。");
  assert.equal(lowestText({ model: "fixed", basePriceMinor: 18000, includedKm: 30, overKmPerKmMinor: 300 }, "JPY"), "18,000 起");
  assert.equal(lowestText({ model: "fixed", basePriceMinor: 18000 }, "JPY"), "18,000");
});

test("线路价不算「该有的价格」，日期重叠只在同一线路 × 车型组里算（去程返程不算重叠，和区域价也不算）", () => {
  const areaPrice = rowOf(rule("area", { to_area_id: null, included_km: null, over_km_per_km: null }));
  const route = rowOf(rule("route"));
  const back = rowOf(rule("back", { area_id: B, to_area_id: A }));
  const twin = rowOf(rule("twin", { valid_from: "2026-12-01" }));
  const coverage = tableCoverage([route, back], p2p, [A, B], [G1]);
  assert.equal(coverage.priced, 0);
  const overlaps = rowOverlaps([areaPrice, route, back, twin], p2p);
  assert.deepEqual([...overlaps.keys()].sort(), ["route", "twin"]);
});

test("新增线路价带返程：每个车型组一行去程 + 一行返程（下车区域对调，价格用返程价格），含公里数、日期、启用一样；返程价格只有一口价有", () => {
  const draft = { ...emptyRouteDraft({ from: A, to: B }, [G1, G2], "fixed", p2p.today), returnPrice: "17,000" };
  draft.values = { ...draft.values, base: "18000", inclKm: "30", kmPrice: "300" };
  assert.deepEqual(routeDraftIssues(draft, p2p), {});
  const plan = planRoute([], draft, p2p);
  assert.equal(routePlanText(plan), "会建 2 条线路价，返程 2 条，共 4 条。");
  const batch = buildBatch([...plan.outbound, ...plan.inbound], p2p);
  assert.deepEqual(
    batch.create.map((entry) => [entry.area_id, entry.to_area_id, entry.vehicle_group_id, entry.base_price, entry.included_km, entry.over_km_per_km, entry.valid_from]),
    [
      [A, B, G1, 18000, 30, 300, "2026-11-10"],
      [A, B, G2, 18000, 30, 300, "2026-11-10"],
      [B, A, G1, 17000, 30, 300, "2026-11-10"],
      [B, A, G2, 17000, 30, 300, "2026-11-10"],
    ],
  );
  assert.equal(routePlanText(planRoute([], { ...draft, returnPrice: "" }, p2p)), "会建 2 条线路价。");
  assert.equal(planRoute([], { ...draft, model: "mileage_time" }, p2p).inbound.length, 0);
  // 出错的话
  assert.deepEqual(routeDraftIssues({ ...draft, groups: [], returnPrice: "-1" }, p2p), { groups: "至少选一个车型组", returnPrice: "返程价格不能是负数" });
  assert.deepEqual(routeDraftIssues({ ...draft, values: { ...draft.values, base: "" } }, p2p).base, "请填价格");
  // 返程撞上已有的线路价：对话框里先说
  const existing = rowOf(rule("old-back", { area_id: B, to_area_id: A }));
  const withExisting = planRoute([existing], draft, p2p);
  assert.deepEqual([withExisting.overlapOut, withExisting.overlapBack], [0, 1]);
  assert.deepEqual(routesIn([...plan.inbound, ...plan.outbound], [A, B]), [{ from: A, to: B }, { from: B, to: A }]);
});

test("复制线路：默认反方向；只调价格（按比例四舍五入），含公里数原样；目标已有价格时跳过或换掉日期重叠的", () => {
  const source = [rowOf(rule("s1")), rowOf(rule("s2", { vehicle_group_id: G2, base_price: 22000, included_km: null, over_km_per_km: null }))];
  const draft = copyDraftFor(source, { from: A, to: B }, p2p);
  assert.deepEqual([draft.target, draft.groups], [{ from: B, to: A }, [G1, G2]]);
  assert.deepEqual(copyDraftIssues({ ...draft, target: { from: A, to: B } }, "JPY"), { target: "要复制到另一条线路" });
  assert.deepEqual(copyDraftIssues({ ...draft, target: { from: A, to: A } }, "JPY"), { target: "上车区域和下车区域不能相同" });
  assert.deepEqual(copyDraftIssues({ ...draft, groups: [], adjust: "up", amount: "abc" }, "JPY"), { groups: "至少勾一个车型组", amount: "请填 0.01 到 100 之间的百分比，最多 2 位小数" });
  const up = planCopy(source, { ...draft, adjust: "up", by: "percent", amount: "10.5" }, p2p);
  assert.deepEqual(up.added.map((row) => [row.areaId, row.toAreaId, row.vehicleGroupId, row.values.base, row.values.inclKm, row.values.kmPrice]), [
    [B, A, G1, "19,890", "30", "300"],
    [B, A, G2, "24,310", "", ""],
  ]);
  const down = planCopy(source, { ...draft, adjust: "down", by: "amount", amount: "20000" }, p2p);
  assert.deepEqual([down.added.length, down.notPositive], [1, 1]);
  assert.equal(planCopy(source, { ...draft, adjust: "down", by: "amount", amount: "30000" }, p2p).notPositive, 2);
  // 目标已有：跳过 / 换成复制过去的（已保存的标将删除）
  const target = rowOf(rule("t1", { area_id: B, to_area_id: A }));
  const skip = planCopy([...source, target], draft, p2p);
  assert.deepEqual([skip.added.length, skip.skipped], [1, 1]);
  const replace = planCopy([...source, target], { ...draft, existing: "replace" }, p2p);
  assert.deepEqual([replace.added.length, replace.replaced], [2, ["t1"]]);
  const applied = applyCopy([...source, target], replace);
  assert.equal(applied.find((row) => row.key === "t1")?.deleted, true);
  assert.equal(applied.length, 5);
  // 从行的「更多」进来：只复制那一行
  assert.equal(planCopy(source, copyDraftFor(source, { from: A, to: B }, p2p, "s2"), p2p).added.length, 1);
});

test("载入最新内容按格子合：我改的格子留我的，别人改的别的格子换成最新的；同一格两人改得不一样标为冲突", () => {
  const before = rule("r1");
  const mine = { ...rowOf(before), values: { ...rowOf(before).values, base: "19,000" } };
  const latest = rowOf({ ...before, included_km: 40 });
  const merged = mergePriceRow(mine, latest, "JPY");
  assert.deepEqual([merged.row.values.base, merged.row.values.inclKm, merged.conflict], ["19,000", "40", false]);
  const clash = mergePriceRow(mine, rowOf({ ...before, base_price: 20000 }), "JPY");
  assert.deepEqual([clash.row.values.base, clash.conflict], ["19,000", true]);
  assert.equal(mergePriceRow(mine, rowOf({ ...before, base_price: 19000 }), "JPY").conflict, false);
});

test("保存被拒的原因：下车区域、含公里数各说到那一格；认不出的返回 null", () => {
  assert.deepEqual(routeIssue("SAME_AREA", "to_area_id", "成田", "JPY"), { field: "base", text: "上车区域和下车区域相同，同一个区域请用区域价。" });
  assert.deepEqual(routeIssue("AREA_NOT_IN_PRODUCT", "to_area_id", "成田", "JPY"), { field: "base", text: "「成田」已经不在这个商品里，这条线路价保存不了。" });
  assert.match(routeIssue("AREA_ROLE_NOT_PRICING", "to_area_id", "成田", "JPY")?.text ?? "", /^「成田」是运营区域，不能用来定价/);
  assert.deepEqual(routeIssue("REQUIRED", "included_km", "", "JPY"), { field: "inclKm", text: "含公里数和超出每公里要一起填，或者都不填" });
  assert.deepEqual(routeIssue("OUT_OF_RANGE", "included_km", "", "JPY"), { field: "inclKm", text: "含公里数请填 1 到 2,000 之间的整数" });
  assert.deepEqual(routeIssue("NOT_APPLICABLE", "over_km_per_km", "", "JPY"), { field: "kmPrice", text: "只有点对点的一口价能设超出每公里。" });
  assert.equal(routeIssue("SOMETHING_ELSE", "base_price", "", "JPY"), null);
});

test("导入预览：线路价写成「上车区域 → 下车区域」，含公里数、区域加价都写出来（结算价）", () => {
  const content = { area: "东京 23 区", to_area: "成田周边", vehicle_group: "VG-CMF-5", direction: null, package_hours: null, pricing_model: "fixed" as const, main_price: 18000, included_km: 30, over_km_per_km: 300, surcharge: null, valid_from: "2026-11-10", valid_to: null, status: "enabled" as const };
  assert.equal(priceRowText(content, "JPY", false), "东京 23 区 → 成田周边 · VG-CMF-5，JPY 18,000，含 30 公里，超出每公里 JPY 300，2026-11-10 起一直有效");
  assert.equal(priceRowText({ ...content, to_area: null, included_km: null, over_km_per_km: null, pricing_model: "charter_area_surcharge", main_price: null, package_hours: 8, surcharge: { pickup: 1000, dropoff: 0 } }, "JPY", false), "东京 23 区 · VG-CMF-5 · 8 小时，上车加价 JPY 1,000，下车加价 JPY 0，2026-11-10 起一直有效");
});
