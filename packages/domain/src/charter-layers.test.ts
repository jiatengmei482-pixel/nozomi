/**
 * M9P-06（ADR 0093 第七节第 1、2 条）：包车三层区域的保存校验 `charterLayerOverlaps`。
 * 同层（①①、②②、③③）不重叠，①③不重叠，①②、②③可以；只看这次新加的区域；只碰边（小于 0.01 平方公里）不算。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { type OverlapAreaInput, charterLayerOverlaps } from "./area-overlap.ts";
import type { Position } from "./areas.ts";

const square = (west: number, south: number, east: number, north: number): Position[] => [[west, south], [east, south], [east, north], [west, north]];
const area = (id: string, ring: Position[], extra: Partial<OverlapAreaInput> = {}): OverlapAreaInput => ({ id, bizType: "general", role: "both", active: true, polygons: [{ kind: "operate", ring }], ...extra });

const SHAPES = [
  area("tokyo", square(139.55, 35.52, 139.95, 35.85)),
  // 和东京市内重叠（羽田那种）
  area("yokohama", square(139.5, 35.3, 139.8, 35.6)),
  area("fuji", square(138.6, 35.4, 138.95, 35.6)),
  // 和富士山重叠
  area("fuji-north", square(138.7, 35.55, 138.95, 35.7)),
  // 只和东京市内碰边
  area("chiba", square(139.95, 35.6, 140.2, 35.8)),
  // 用途是「运营」、业务类型是接送机的也算（同一个商品里的区域都会被同时用到）
  area("lake", square(138.74, 35.48, 138.8, 35.52), { role: "operating", bizType: "airport_transfer" }),
];

test("同层重叠：新加的③和已有的③重叠 → AREA_LAYER_OVERLAP；②②同样；①②、②③可以", () => {
  const found = charterLayerOverlaps(SHAPES, { base: ["tokyo"], itinerary: [], updown: ["fuji", "fuji-north"] }, { updown: ["fuji-north"] });
  assert.deepEqual(found.map((entry) => [entry.code, entry.layer, entry.a, entry.b]), [["AREA_LAYER_OVERLAP", "pickup_dropoff", "fuji", "fuji-north"]]);
  assert.ok((found[0]?.areaM2 ?? 0) > 1_000_000);
  assert.deepEqual(charterLayerOverlaps(SHAPES, { base: ["tokyo"], itinerary: ["fuji", "lake"], updown: [] }, { itinerary: ["lake"] }).map((entry) => [entry.code, entry.layer]), [["AREA_LAYER_OVERLAP", "itinerary"]], "用途、业务类型不影响");
  assert.deepEqual(charterLayerOverlaps(SHAPES, { base: ["tokyo"], itinerary: ["yokohama"], updown: ["fuji"] }, { itinerary: ["yokohama"] }), [], "①②可以重叠");
  assert.deepEqual(charterLayerOverlaps(SHAPES, { base: ["tokyo"], itinerary: ["fuji-north"], updown: ["fuji"] }, { itinerary: ["fuji-north"] }), [], "②③可以重叠");
});

test("①③重叠 → AREA_BASE_SURCHARGE_OVERLAP（a 是①、b 是③）；新加的①和已有的①重叠 → 同层；只碰边不算；已有的重叠不回头拦", () => {
  assert.deepEqual(charterLayerOverlaps(SHAPES, { base: ["tokyo"], itinerary: [], updown: ["yokohama"] }, { updown: ["yokohama"] }).map((entry) => [entry.code, entry.a, entry.b]), [["AREA_BASE_SURCHARGE_OVERLAP", "tokyo", "yokohama"]]);
  assert.deepEqual(charterLayerOverlaps(SHAPES, { base: ["yokohama", "tokyo"], itinerary: [], updown: [] }, { base: ["yokohama"] }).map((entry) => [entry.code, entry.layer]), [["AREA_LAYER_OVERLAP", "base"]]);
  assert.deepEqual(charterLayerOverlaps(SHAPES, { base: ["tokyo"], itinerary: [], updown: ["chiba"] }, { updown: ["chiba"] }), [], "只碰边");
  // 横滨的③是以前就有的：这次只新加了富士山，不拦
  assert.deepEqual(charterLayerOverlaps(SHAPES, { base: ["tokyo"], itinerary: [], updown: ["yokohama", "fuji"] }, { updown: ["fuji"] }), []);
  // 停用的区域不算
  assert.deepEqual(charterLayerOverlaps(SHAPES.map((shape) => (shape.id === "yokohama" ? { ...shape, active: false } : shape)), { base: ["tokyo"], itinerary: [], updown: ["yokohama"] }, { updown: ["yokohama"] }), []);
});

test("阈值 0.01 平方公里（ADR 0093 第七节第 1 条）：约 0.005 平方公里的重叠不拦，约 0.02 平方公里的拦；区域地图标红的 100 平方米阈值不用在这里", () => {
  // 东京市内东边界 139.95；纬度 35.6 附近 0.0007° × 0.0007° ≈ 63 米 × 78 米 ≈ 0.005 平方公里，0.0015° × 0.0015° ≈ 0.022 平方公里
  const small = area("small", square(139.9493, 35.7, 140.1, 35.7007));
  const large = area("large", square(139.9485, 35.7, 140.1, 35.7015));
  const shapes = [...SHAPES, small, large];
  assert.deepEqual(charterLayerOverlaps(shapes, { base: ["tokyo"], itinerary: [], updown: ["small"] }, { updown: ["small"] }), []);
  const found = charterLayerOverlaps(shapes, { base: ["tokyo"], itinerary: [], updown: ["large"] }, { updown: ["large"] });
  assert.deepEqual(found.map((entry) => entry.code), ["AREA_BASE_SURCHARGE_OVERLAP"]);
  assert.ok((found[0]?.areaM2 ?? 0) > 10_000 && (found[0]?.areaM2 ?? 0) < 40_000, String(found[0]?.areaM2));
});

