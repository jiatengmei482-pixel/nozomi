/**
 * M9P-13：区域在商品里当哪一层、编辑时的三层重叠、区域地图按商品和层筛选、「从本区域减去另一个区域」的纯函数。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { OverlapAreaInput, Position } from "@nozomi/domain";
import type { ProductAreaLayers } from "../api/areas.ts";
import { EMPTY_EDITOR, editorReducer, subtractFromEditor } from "./area-editor.ts";
import { ALL_LAYERS, areaUses, editingOverlaps, km2Text, layerConflicts, layerMembership, overlapLine, subtractFailureText, subtractPreviewText, useLayerText } from "./area-layers.ts";

const rect = (west: number, south: number, east: number, north: number): Position[] => [[west, south], [east, south], [east, north], [west, north]];
const shape = (id: string, ring: Position[]): OverlapAreaInput => ({ id, bizType: "charter", role: "both", active: true, polygons: [{ kind: "operate", ring }] });
const SHAPES = [shape("tokyo", rect(139.6, 35.6, 139.8, 35.8)), shape("yokohama", rect(139.7, 35.5, 139.9, 35.7)), shape("hakone", rect(139.0, 35.2, 139.1, 35.3)), shape("hakone-2", rect(139.05, 35.25, 139.15, 35.35))];
const product = (id: string, extra: Partial<ProductAreaLayers>): ProductAreaLayers => ({ product_id: id, code: id.toUpperCase(), title: { zh: id }, category: "charter", status: "published", charter_layout: "three_layer", base: [], itinerary: [], pickup_dropoff: [], ...extra });
const PRODUCTS = [product("c1", { base: ["tokyo"], itinerary: ["hakone", "hakone-2"], pickup_dropoff: ["yokohama"] }), product("c2", { base: ["yokohama"] }), product("t1", { category: "airport_transfer", charter_layout: null, base: ["tokyo", "yokohama"] })];

test("区域在哪些商品里当哪一层：包车写 ①②③，接送机、点对点写服务区域；没用到的不列", () => {
  const uses = areaUses("yokohama", PRODUCTS);
  assert.deepEqual(uses.map((use) => [use.product.product_id, use.layers]), [["c1", ["pickup_dropoff"]], ["c2", ["base"]], ["t1", ["base"]]]);
  assert.deepEqual(uses.map(useLayerText), ["③ 上下车加价区域", "① 基础价区域", "服务区域"]);
  assert.deepEqual(areaUses("nowhere", PRODUCTS), []);
});

test("编辑时的三层重叠：只看用到这个区域的包车商品；按画面上的图形算（改小了就没有了）；同一对在别的商品里不同层不算", () => {
  const found = editingOverlaps(shape("yokohama", rect(139.7, 35.5, 139.9, 35.7)), SHAPES, PRODUCTS);
  assert.deepEqual(found.map((entry) => [entry.product.product_id, entry.otherAreaId, entry.layer]), [["c1", "tokyo", "base_pickup_dropoff"]], "c2 里横滨只是①，东京市内不在 c2；t1 不是包车");
  assert.ok(Math.abs(found[0]!.areaM2 - 0.1 * 0.1 * 111_320 ** 2 * Math.cos((35.65 * Math.PI) / 180)) / found[0]!.areaM2 < 0.002);
  assert.deepEqual(editingOverlaps(shape("yokohama", rect(139.8, 35.5, 139.9, 35.7)), SHAPES, PRODUCTS), [], "改小到只碰边");
  assert.deepEqual(editingOverlaps(shape("hakone", rect(139.0, 35.2, 139.1, 35.3)), SHAPES, PRODUCTS).map((entry) => [entry.otherAreaId, entry.layer]), [["hakone-2", "itinerary"]], "②②");
});

test("区域地图按商品和层：不按商品时不筛；按一个商品只列选中层的区域；全部包车商品合起来；重叠按商品分开算、①∩③ 要两层都选上", () => {
  assert.equal(layerMembership(PRODUCTS, "all", ALL_LAYERS), null);
  const c1 = layerMembership(PRODUCTS, "c1", ALL_LAYERS) as Map<string, Set<string>>;
  assert.deepEqual([...c1.keys()].sort(), ["hakone", "hakone-2", "tokyo", "yokohama"]);
  assert.deepEqual([...(layerMembership(PRODUCTS, "c1", { ...ALL_LAYERS, base: false }) as Map<string, Set<string>>).keys()].sort(), ["hakone", "hakone-2", "yokohama"]);
  const charter = layerMembership(PRODUCTS, "charter", ALL_LAYERS) as Map<string, Set<string>>;
  assert.deepEqual([...(charter.get("yokohama") ?? [])].sort(), ["base", "pickup_dropoff"], "c1 里是③，c2 里是①");
  assert.equal(layerMembership(PRODUCTS, "charter", ALL_LAYERS)?.has("nowhere"), false);

  const all = layerConflicts(PRODUCTS, "charter", ALL_LAYERS, SHAPES);
  assert.deepEqual(all.pairs.map((pair) => [pair.productId, pair.layer, pair.a, pair.b]), [["c1", "itinerary", "hakone", "hakone-2"], ["c1", "base_pickup_dropoff", "tokyo", "yokohama"]], "c2 只有一个区域；t1 不是包车");
  assert.ok(all.pieces.some((piece) => piece.layer === "base_pickup_dropoff" && piece.productId === "c1"));
  assert.deepEqual(layerConflicts(PRODUCTS, "c1", { ...ALL_LAYERS, pickup_dropoff: false }, SHAPES).pairs.map((pair) => pair.layer), ["itinerary"]);
  assert.deepEqual(layerConflicts(PRODUCTS, "all", ALL_LAYERS, SHAPES), { pieces: [], pairs: [] });
});

test("说法：面积、重叠一句话、减不了的原因、减之前的预览", () => {
  assert.equal(km2Text(1_234_567), "约 1.23 平方公里");
  assert.equal(km2Text(40), "不到 0.01 平方公里");
  assert.equal(overlapLine({ productLabel: "东京包车（C1）", otherName: "横滨", layer: "pickup_dropoff", areaM2: 5_000_000 }), "「东京包车（C1）」里和「横滨」同为 ③ 上下车加价区域，重叠约 5 平方公里");
  assert.match(subtractFailureText("NOTHING_LEFT"), /减完什么都不剩/);
  assert.match(subtractFailureText("SHAPE_PROBLEMS"), /先改好/);
  assert.equal(subtractPreviewText({ removedM2: 2_000_000, rings: [[], []], removeKeys: [1], split: true }), "会切掉约 2 平方公里；碰到的 1 块营运区换成减完的 2 块；那个区域在本区域中间，区域的图形不能带洞，所以竖着切成了几块。确认后图形换到画面上，保存后才生效；不满意可以撤销。");
});

test("编辑器里的减法：碰到的营运区块换成减完的多边形，没碰到的、禁行区不动；一步撤销回到原样；图形还有问题时不算", () => {
  let state = editorReducer(EMPTY_EDITOR, { type: "addPolygon", kind: "operate", ring: rect(139.7, 35.5, 139.9, 35.7) });
  state = editorReducer(state, { type: "addCircle", kind: "operate", circle: { lat: 35.0, lng: 139.0, radiusM: 1_000 } });
  state = editorReducer(state, { type: "addPolygon", kind: "forbid", ring: rect(139.85, 35.52, 139.88, 35.55) });
  const result = subtractFromEditor(state.shapes, [{ kind: "operate", ring: rect(139.6, 35.6, 139.8, 35.8) }]);
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.deepEqual(result.removeKeys, ["s1"]);
  assert.equal(result.rings.length, 1);
  const next = editorReducer(state, { type: "subtract", removeKeys: result.removeKeys, rings: result.rings });
  assert.deepEqual(next.shapes.map((entry) => [entry.key, entry.kind, entry.seq, entry.source, entry.circle === null ? entry.ring.length : "circle"]), [["s2", "operate", 2, "circle", "circle"], ["s3", "forbid", 1, "drawn", 4], ["s4", "operate", 3, "pasted", 6]]);
  assert.deepEqual(editorReducer(next, { type: "undo" }).shapes, state.shapes, "一步撤销");
  const broken = editorReducer(state, { type: "addPolygon", kind: "operate", ring: [[139, 35], [139.1, 35.1], [139, 35.1], [139.1, 35]] });
  assert.deepEqual(subtractFromEditor(broken.shapes, [{ kind: "operate", ring: rect(139.6, 35.6, 139.8, 35.8) }]), { ok: false, reason: "SHAPE_PROBLEMS" });
});
