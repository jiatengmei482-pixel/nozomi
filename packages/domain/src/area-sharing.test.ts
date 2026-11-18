/**
 * 区域分类（ADR 0102）：平台共享 / 供应商独立。
 * - 重叠只在同一分类里算（区域页提示、上架检查、包车三层保存校验共用 findAreaOverlaps / charterLayerOverlaps）；
 * - 报价时同一层里一个点同时落在两类区域，按供应商独立优先（locateInAreas）。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type OverlapAreaInput, charterLayerOverlaps, findAreaOverlaps } from "./area-overlap.ts";
import type { Position } from "./areas.ts";
import { type QuoteArea, locateInAreas } from "./quote.ts";

const square = (west: number, south: number, east: number, north: number): Position[] => [
  [west, south],
  [east, south],
  [east, north],
  [west, north],
];
const big = square(139.6, 35.6, 139.8, 35.8);
const inner = square(139.65, 35.65, 139.75, 35.75);
const input = (id: string, ring: Position[], sharing?: "shared" | "own"): OverlapAreaInput => ({ id, bizType: "charter", role: "pricing", active: true, ...(sharing === undefined ? {} : { sharing }), polygons: [{ kind: "operate", ring }] });
const quoteArea = (areaId: string, ring: Position[], sharing?: "shared" | "own", forbid?: Position[]): QuoteArea => ({
  areaId,
  active: true,
  ...(sharing === undefined ? {} : { sharing }),
  shapes: [{ id: `${areaId}-o`, kind: "operate", ring }, ...(forbid === undefined ? [] : [{ id: `${areaId}-f`, kind: "forbid" as const, ring: forbid }])],
});
const center = { lat: 35.7, lng: 139.7 };

describe("重叠只在同一分类里算", () => {
  it("两个独立（或都没标）重叠照报；两个共享重叠照报；共享和独立重叠不报", () => {
    assert.equal(findAreaOverlaps([input("a", big), input("b", inner)]).pairs.length, 1);
    assert.equal(findAreaOverlaps([input("a", big, "own"), input("b", inner)]).pairs.length, 1, "没标的按独立");
    assert.equal(findAreaOverlaps([input("a", big, "shared"), input("b", inner, "shared")]).pairs.length, 1);
    assert.equal(findAreaOverlaps([input("a", big, "shared"), input("b", inner, "own")]).pairs.length, 0);
  });
  it("包车三层：同层共享 + 独立不报，同层两个独立照报；①③也一样", () => {
    const shapes = [input("base", big, "shared"), input("base2", inner, "own"), input("up", inner, "own")];
    assert.deepEqual(charterLayerOverlaps(shapes, { base: ["base", "base2"], itinerary: [], updown: [] }, { base: ["base2"] }), []);
    assert.deepEqual(charterLayerOverlaps(shapes, { base: ["base"], itinerary: [], updown: ["up"] }, { updown: ["up"] }), []);
    const owned = [input("x", big, "own"), input("y", inner, "own")];
    assert.equal(charterLayerOverlaps(owned, { base: ["x", "y"], itinerary: [], updown: [] }, { base: ["y"] }).length, 1);
  });
});

describe("报价：同一层里供应商独立优先", () => {
  it("点同时在共享和独立区域里：只算独立的；只在共享里：照算共享的", () => {
    assert.deepEqual(locateInAreas([quoteArea("shared", big, "shared"), quoteArea("own", inner)], center), { operating: ["own"], forbidden: [] });
    assert.deepEqual(locateInAreas([quoteArea("shared", big, "shared"), quoteArea("own", inner)], { lat: 35.62, lng: 139.62 }), { operating: ["shared"], forbidden: [] });
    assert.deepEqual(locateInAreas([quoteArea("a", big), quoteArea("b", inner)], center), { operating: ["a", "b"], forbidden: [] }, "都是独立：和以前一样都算");
  });
  it("独立区域的禁行区盖住共享区域：不报（独立优先也包括禁行）；共享区域的禁行区挡不住独立区域", () => {
    assert.deepEqual(locateInAreas([quoteArea("shared", big, "shared"), quoteArea("own", big, "own", inner)], center), { operating: [], forbidden: ["own"] });
    assert.deepEqual(locateInAreas([quoteArea("shared", big, "shared", inner), quoteArea("own", inner, "own")], center), { operating: ["own"], forbidden: [] });
  });
  it("停用的独立区域不算，点照算共享的", () => {
    assert.deepEqual(locateInAreas([quoteArea("shared", big, "shared"), { ...quoteArea("own", inner), active: false }], center), { operating: ["shared"], forbidden: [] });
  });
});
