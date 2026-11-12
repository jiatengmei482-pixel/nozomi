import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Position } from "@nozomi/domain";
import { AREA_ROLE_OPTIONS, computeOutside, operateLegendText, editingOutside, hiddenOperatingText, outsideImpactText, outsideRejectedText, outsideText, pricingCapable, readOutsideImpacts, roleInUseText, roleOf } from "./area-roles.ts";

const square = (west: number, south: number, size: number): Position[] => [[west, south], [west + size, south], [west + size, south + size], [west, south + size]];
const area = (id: string, role: "operating" | "pricing" | "both", ring: Position[], extra: { tenant?: string; active?: boolean; bizType?: "general" | "charter" | "airport_transfer" } = {}) => ({ id, tenant: extra.tenant ?? "t1", role, bizType: extra.bizType ?? "general", active: extra.active ?? true, polygons: [{ kind: "operate" as const, ring }] });

describe("区域用途（M8-20）", () => {
  it("三个选项的顺序和说明；没给用途的按运营 + 报价", () => {
    assert.deepEqual(AREA_ROLE_OPTIONS.map((option) => option.label), ["运营区域", "报价区域", "运营 + 报价"]);
    assert.ok(AREA_ROLE_OPTIONS.every((option) => option.hint.length > 10));
    assert.equal(roleOf({}), "both");
    assert.equal(roleOf({ role: "operating" }), "operating");
  });

  it("编辑页地图图例「营运区」（M6-08）：纯运营区域写能接单、不带价格，不写「可以报价」；报价区域、运营 + 报价照旧", () => {
    assert.equal(operateLegendText("operating"), "能接单的范围，不带价格");
    assert.doesNotMatch(operateLegendText("operating"), /报价/);
    assert.equal(operateLegendText("pricing"), "可以报价");
    assert.equal(operateLegendText("both"), "可以报价");
  });

  it("选区域只列能挂价格的；被藏掉的运营区域写明原因", () => {
    assert.deepEqual(pricingCapable([{ id: "a", role: "operating" as const }, { id: "b", role: "pricing" as const }, { id: "c", role: "both" as const }, { id: "d" }]).map((entry) => entry.id), ["b", "c", "d"]);
    assert.equal(hiddenOperatingText(0), null);
    assert.match(hiddenOperatingText(2) ?? "", /另有 2 个运营区域没有列出.*不带价格/);
  });

  it("超出运营区域：同一个供应商、启用、业务类型相容的运营区域才算；运营 + 报价自己盖住自己；不同供应商分开算", () => {
    const pricingArea = area("p", "pricing", square(0, 0, 0.02));
    const half = area("o", "operating", square(-0.01, 0, 0.02));
    const result = computeOutside([pricingArea, half], (entry) => entry.tenant);
    const m2 = result.byArea.get("p") ?? 0;
    assert.ok(m2 > 2_000_000 && m2 < 2_600_000, `一半超出，约 2.46 平方公里：${m2}`);
    assert.ok(result.pieces.length > 0 && result.pieces.every((piece) => piece.areaIds.includes("p")));
    assert.equal(computeOutside([area("b", "both", square(0, 0, 0.02))]).byArea.size, 0, "运营 + 报价自己就是运营范围");
    assert.equal(computeOutside([pricingArea, area("o", "operating", square(-0.01, 0, 0.04), { tenant: "t2" })], (entry) => entry.tenant).byArea.has("p"), true, "别的供应商的运营区域不算");
    assert.equal(computeOutside([pricingArea, area("o", "operating", square(-0.01, -0.01, 0.04), { active: false })]).byArea.has("p"), true, "停用的运营区域不算");
    assert.equal(computeOutside([area("p", "pricing", square(0, 0, 0.02), { bizType: "charter" }), area("o", "operating", square(-0.01, -0.01, 0.04), { bizType: "airport_transfer" })]).byArea.has("p"), true, "业务类型不相容不算");
    assert.equal(computeOutside([pricingArea, area("o", "operating", square(-0.01, -0.01, 0.04))]).byArea.size, 0, "完全在运营区域里");
  });

  it("编辑页现算：自己是运营区域时不提醒；改成运营 + 报价后不超出", () => {
    const others = [area("o", "operating", square(-0.01, 0, 0.02))];
    const current = area("x", "pricing", square(0, 0, 0.02));
    assert.ok((editingOutside(current, others).byArea.get("x") ?? 0) > 0);
    assert.equal(editingOutside({ ...current, role: "both" }, others).byArea.size, 0);
    assert.equal(editingOutside({ ...current, role: "operating" }, others).byArea.size, 0);
  });

  it("两个 409 的读法和说法：认不出的条目跳过；面积写约多少；不出现错误码", () => {
    const impacts = readOutsideImpacts({ items: [{ product_id: "p1", product_code: "P-001", area_id: "a1", outside_m2: 3_200_000 }, { product_id: 1 }, "x"] });
    assert.deepEqual(impacts, [{ productId: "p1", productCode: "P-001", areaId: "a1", outsideM2: 3_200_000 }]);
    assert.deepEqual(readOutsideImpacts({}), []);
    assert.equal(outsideImpactText(impacts[0] as (typeof impacts)[number], "新宿"), "商品 P-001：报价区域「新宿」将有约 3.2 平方公里不在任何运营区域里");
    assert.equal(outsideImpactText({ productId: "p", productCode: "", areaId: "a", outsideM2: 500 }, null), "一个已上架的商品：报价区域将有约 500 平方米不在任何运营区域里");
    for (const action of ["save", "disable", "delete"] as const) assert.doesNotMatch(JSON.stringify(outsideRejectedText(action)), /[A-Z_]{6,}/);
    assert.match(outsideRejectedText("delete").title, /现在不能删除/);
    assert.match(roleInUseText({ product_count: 3 }), /有 3 个商品把这个区域当报价区域用着/);
    assert.match(roleInUseText({}), /^有商品把这个区域/);
    assert.equal(outsideText(1_500_000), "这个报价区域有约 1.5 平方公里不在任何运营区域里，那部分不会报价");
  });
});
