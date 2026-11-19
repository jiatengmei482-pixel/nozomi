/**
 * 区域分类（ADR 0102）：平台共享 / 供应商独立。
 * - 重叠只在同一分类里算（区域页提示、上架检查、包车三层保存校验共用 findAreaOverlaps / charterLayerOverlaps）；
 * - 报价时同一层里一个点同时落在两类区域，按供应商独立优先（locateInAreas）。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type OverlapAreaInput, charterLayerOverlaps, findAreaOverlaps } from "./area-overlap.ts";
import type { Position } from "./areas.ts";
import { type PriceRule, type Pricing } from "./pricing.ts";
import { emptyServiceRules } from "./products.ts";
import { type QuoteArea, type QuoteProduct, type QuoteRequest, locateInAreas, quoteProduct } from "./quote.ts";

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

describe("报价：独立区域报不出时退回共享区域（ADR 0102 第四节补充）", () => {
  // 点对点：上车点在「东京市」（独立）和「23区·通用」（共享）里，下车点只在「成田·通用」（共享）里
  const narita = square(140.2, 35.7, 140.5, 35.9);
  const fixed = (basePriceMinor: number): Pricing => ({ model: "fixed", basePriceMinor });
  const rule = (areaId: string, vehicleGroupId: string, minor: number, toAreaId: string | null = null): PriceRule & { id: string } => ({ id: `${areaId}-${toAreaId ?? ""}-${vehicleGroupId}`, areaId, toAreaId, vehicleGroupId, direction: null, packageHours: null, pricing: fixed(minor), validFrom: "2026-01-01", validTo: null, status: "enabled" });
  const product = (priceRules: (PriceRule & { id: string })[], areas: QuoteArea[] = [quoteArea("tokyo-own", inner), quoteArea("23ku-shared", big, "shared"), quoteArea("narita-shared", narita, "shared")]): QuoteProduct => ({
    productId: "prd-1",
    tenantId: "tenant-a",
    category: "point_to_point",
    status: "published",
    tenantActive: true,
    brandActive: true,
    currency: "JPY",
    roundingUnit: 1,
    timeZone: "Asia/Tokyo",
    pickupPlace: null,
    areas,
    vehicleGroups: [{ vehicleGroupId: "sedan", passengers: 3, luggage: 2, active: true }, { vehicleGroupId: "van", passengers: 6, luggage: 4, active: true }],
    serviceRules: { ...emptyServiceRules(), booking: { saleFrom: null, saleTo: null, serviceTime: { start: "00:00", end: "24:00" }, leadTimeHours: 24, note: null }, freeWait: { pickup: null, dropoff: null, general: { mode: "limited", minutes: 15 } } },
    addonCatalog: [],
    priceRules,
    adjustRules: [],
    inventoryMode: "unlimited",
  });
  const request = (dropoff = { lat: 35.8, lng: 140.3 }): QuoteRequest => ({ category: "point_to_point", direction: null, pickup: center, dropoff, packageHours: null, serviceLocal: "2026-10-20T10:00", passengers: 2, luggage: 1, addons: [], driverLanguage: null, vehicleGroupIds: ["sedan", "van"] });
  const moment = { now: new Date("2026-10-07T01:00:00Z"), route: null, inventoryDay: null, urgentUsed: 0 };
  const prices = (p: QuoteProduct, r: QuoteRequest = request()): Record<string, unknown> => {
    const quoted = quoteProduct(p, r, moment);
    if (!quoted.ok) return { product: quoted.reason };
    return Object.fromEntries([...quoted.offers.map((offer) => [offer.vehicleGroupId, `${offer.areaId}:${offer.settlement.totalMinor}`]), ...quoted.refused.map((entry) => [entry.vehicleGroupId, entry.reason])]);
  };

  it("独立区域没有这条线路价：这个车型组用共享区域的线路价；独立区域有价的车型组照旧用独立的价（不比高低）", () => {
    const rules = [rule("23ku-shared", "sedan", 20_000, "narita-shared"), rule("23ku-shared", "van", 25_000, "narita-shared"), rule("tokyo-own", "van", 30_000, "narita-shared")];
    assert.deepEqual(prices(product(rules)), { sedan: "23ku-shared:20000", van: "tokyo-own:30000" });
  });
  it("独立区域只有区域价、没有线路价：照旧用独立区域的区域价（报得出就不退）", () => {
    const rules = [rule("23ku-shared", "sedan", 20_000, "narita-shared"), rule("tokyo-own", "sedan", 9_000)];
    assert.deepEqual(prices(product(rules)), { sedan: "tokyo-own:9000", van: "NO_PRICE_RULE" });
  });
  it("退回去也报不出：原因照旧", () => {
    assert.deepEqual(prices(product([rule("tokyo-own", "van", 30_000, "narita-shared")])), { sedan: "NO_PRICE_RULE", van: "tokyo-own:30000" });
  });
  it("独立区域的禁行区盖住上车点：照旧不报，不退回共享区域", () => {
    const areas = [quoteArea("tokyo-own", big, "own", inner), quoteArea("23ku-shared", big, "shared"), quoteArea("narita-shared", narita, "shared")];
    assert.deepEqual(prices(product([rule("23ku-shared", "sedan", 20_000, "narita-shared")], areas)), { product: "IN_FORBIDDEN_AREA" });
  });
  it("只有共享或只有独立区域的商品：和以前一样", () => {
    const owned = [quoteArea("tokyo-own", inner), quoteArea("23ku", big), quoteArea("narita", narita)];
    assert.deepEqual(prices(product([rule("23ku", "sedan", 20_000, "narita"), rule("tokyo-own", "sedan", 25_000, "narita")], owned)), { sedan: "23ku:20000", van: "NO_PRICE_RULE" }, "都是独立：两个都算、取低的");
  });
});
