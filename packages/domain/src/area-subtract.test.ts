/**
 * M9P-13（规格第四节第 3 小节、ADR 0093 第七节「后续」）：区域编辑器「从本区域减去另一个区域」`subtractAreaRange`，
 * 「在地图上看全部」标红的包车三层重叠 `charterLayerConflictPieces`。
 * 结果按「点在不在」和面积逐项核对（测试自己的射线法和鞋带公式，不依赖被测代码）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { type OverlapAreaInput, type SubtractShape, charterLayerConflictPieces, subtractAreaRange } from "./area-overlap.ts";
import { type Position, circleToRing, ringIssues } from "./areas.ts";
import { emptyServiceRules, publishCheck } from "./products.ts";

const rect = (west: number, south: number, east: number, north: number): Position[] => [[west, south], [east, south], [east, north], [west, north]];
const operate = (ring: Position[]): SubtractShape => ({ kind: "operate", ring });
const forbid = (ring: Position[]): SubtractShape => ({ kind: "forbid", ring });

function inside(point: Position, ring: readonly Position[]): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i] as Position;
    const [xj, yj] = ring[j] as Position;
    if (yi > point[1] !== yj > point[1] && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** 平面面积（平方度），逆时针为正 */
function signedArea(ring: readonly Position[]): number {
  let twice = 0;
  ring.forEach((point, i) => {
    const next = ring[(i + 1) % ring.length] as Position;
    twice += point[0] * next[1] - next[0] * point[1];
  });
  return twice / 2;
}

function ok(result: ReturnType<typeof subtractAreaRange>) {
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("unreachable");
  for (const ring of result.rings) {
    assert.deepEqual(ringIssues(ring), [], "每一块都是合法的多边形");
    assert.ok(signedArea(ring) > 0, "逆时针");
    for (const [x, y] of ring) assert.ok(Math.abs(x * 1e6 - Math.round(x * 1e6)) < 1e-6 && Math.abs(y * 1e6 - Math.round(y * 1e6)) < 1e-6, "六位小数");
  }
  return result;
}

const inAny = (point: Position, rings: readonly Position[][]): boolean => rings.some((ring) => inside(point, ring));

/** 在格子上逐点核对：期望在结果里的点都在，期望不在的都不在（边上的点不看） */
function assertCovers(rings: readonly Position[][], expected: (point: Position) => boolean, box: [number, number, number, number], steps = 37): void {
  const [west, south, east, north] = box;
  for (let i = 1; i < steps; i += 1) {
    for (let j = 1; j < steps; j += 1) {
      const point: Position = [west + ((east - west) * i) / steps, south + ((north - south) * j) / steps];
      assert.equal(inAny(point, rings), expected(point), `点 ${point.join(",")}`);
    }
  }
}

test("部分重叠：东边一半被切掉，剩下西边的矩形；切掉的面积 = 公共部分", () => {
  const result = ok(subtractAreaRange([operate(rect(139.6, 35.6, 139.8, 35.7))], [operate(rect(139.7, 35.5, 139.9, 35.8))]));
  assert.equal(result.rings.length, 1);
  assert.equal(result.split, false);
  assert.deepEqual(result.keptIndexes, []);
  const ring = result.rings[0] as Position[];
  assert.equal(ring.length, 4, "竖条切出来的中间点都去掉了");
  assert.ok(Math.abs(signedArea(ring) - 0.1 * 0.1) < 1e-9);
  // 0.1° × 0.1° 在北纬 35.65° 约 101.4 平方公里
  const expected = 0.1 * 0.1 * 111_320 * 111_320 * Math.cos((35.65 * Math.PI) / 180);
  assert.ok(Math.abs(result.removedM2 - expected) / expected < 0.001, `${result.removedM2} ≈ ${expected}`);
});

test("切掉一个角：剩下 L 形（6 个点），和期望逐点一致", () => {
  const base = rect(0, 0, 0.2, 0.2);
  const cut = rect(0.1, 0.1, 0.3, 0.3);
  const result = ok(subtractAreaRange([operate(base)], [operate(cut)]));
  assert.equal(result.rings.length, 1);
  assert.equal(result.rings[0]?.length, 6);
  assertCovers(result.rings, (point) => inside(point, base) && !inside(point, cut), [-0.05, -0.05, 0.35, 0.35]);
});

test("斜边相交（菱形减三角形）：交点算得准，逐点一致，面积对", () => {
  const diamond: Position[] = [[0.1, 0], [0.2, 0.1], [0.1, 0.2], [0, 0.1]];
  const triangle: Position[] = [[0.05, 0.05], [0.3, 0.02], [0.18, 0.25]];
  const result = ok(subtractAreaRange([operate(diamond)], [operate(triangle)]));
  assertCovers(result.rings, (point) => inside(point, diamond) && !inside(point, triangle), [-0.02, -0.02, 0.32, 0.27], 53);
  const kept = result.rings.reduce((sum, ring) => sum + signedArea(ring), 0);
  assert.ok(kept > 0 && kept < signedArea(diamond));
});

test("另一个区域在本区域中间：不能留洞，竖着切成两块；洞里的点不在、其余的都在", () => {
  const base = rect(0, 0, 0.3, 0.3);
  const hole = rect(0.1, 0.1, 0.2, 0.2);
  const result = ok(subtractAreaRange([operate(base)], [operate(hole)]));
  assert.equal(result.split, true);
  assert.equal(result.rings.length, 2);
  assertCovers(result.rings, (point) => inside(point, base) && !inside(point, hole), [-0.05, -0.05, 0.35, 0.35]);
  const total = result.rings.reduce((sum, ring) => sum + signedArea(ring), 0);
  assert.ok(Math.abs(total - (0.09 - 0.01)) < 1e-9);
});

test("一条带横穿本区域：切成上下两块，不算「切开洞」", () => {
  const result = ok(subtractAreaRange([operate(rect(0, 0, 0.3, 0.3))], [operate(rect(-0.1, 0.1, 0.4, 0.2))]));
  assert.equal(result.split, false);
  assert.equal(result.rings.length, 2);
});

test("另一个区域的禁行区不算它的范围：压在禁行区上的部分留在本区域", () => {
  const base = rect(0, 0, 0.2, 0.2);
  const other = rect(0.1, -0.1, 0.3, 0.3);
  const otherForbid = rect(0.1, 0.05, 0.15, 0.1);
  const result = ok(subtractAreaRange([operate(base)], [operate(other), forbid(otherForbid)]));
  assertCovers(result.rings, (point) => inside(point, base) && (!inside(point, other) || inside(point, otherForbid)), [-0.05, -0.05, 0.35, 0.35]);
});

test("碰不到的营运区块（圆）原样保留，本区域的禁行区不动；只减碰到的几块", () => {
  const circle = circleToRing({ lat: 35, lng: 139.5 }, 2_000);
  const touchedA = rect(139.6, 35, 139.7, 35.1);
  const touchedB = rect(139.65, 35.05, 139.75, 35.15);
  const result = ok(subtractAreaRange([operate(circle), forbid(rect(139.61, 35.01, 139.62, 35.02)), operate(touchedA), operate(touchedB)], [operate(rect(139.68, 34.9, 139.9, 35.2))]));
  assert.deepEqual(result.keptIndexes, [0], "圆没碰到");
  assertCovers(result.rings, (point) => (inside(point, touchedA) || inside(point, touchedB)) && point[0] < 139.68, [139.55, 34.95, 139.8, 35.2]);
});

test("没有重叠、只碰边：NO_OVERLAP；本区域整个在另一个区域里：NOTHING_LEFT", () => {
  assert.deepEqual(subtractAreaRange([operate(rect(0, 0, 0.1, 0.1))], [operate(rect(0.2, 0, 0.3, 0.1))]), { ok: false, reason: "NO_OVERLAP" });
  assert.deepEqual(subtractAreaRange([operate(rect(0, 0, 0.1, 0.1))], [operate(rect(0.1, 0, 0.3, 0.1))]), { ok: false, reason: "NO_OVERLAP" });
  assert.deepEqual(subtractAreaRange([operate(rect(0.1, 0.1, 0.2, 0.2))], [operate(rect(0, 0, 0.3, 0.3))]), { ok: false, reason: "NOTHING_LEFT" });
  // 有别的块没碰到：不算什么都不剩
  const partly = subtractAreaRange([operate(rect(0.1, 0.1, 0.2, 0.2)), operate(rect(1, 1, 1.1, 1.1))], [operate(rect(0, 0, 0.3, 0.3))]);
  assert.equal(partly.ok, true);
  assert.deepEqual(partly.ok ? [partly.rings.length, partly.keptIndexes] : null, [0, [1]]);
  // 本区域只有禁行区压在另一个区域上：没有可以减的
  assert.deepEqual(subtractAreaRange([operate(rect(0, 0, 0.1, 0.1)), forbid(rect(0.5, 0.5, 0.6, 0.6))], [operate(rect(0.4, 0.4, 0.7, 0.7))]), { ok: false, reason: "NO_OVERLAP" });
});

test("圆减圆（64 边形）：结果是合法多边形，逐点一致", () => {
  const a = circleToRing({ lat: 35.6, lng: 139.7 }, 10_000);
  const b = circleToRing({ lat: 35.65, lng: 139.78 }, 8_000);
  const result = ok(subtractAreaRange([operate(a)], [operate(b)]));
  assert.equal(result.rings.length, 1);
  assertCovers(result.rings, (point) => inside(point, a) && !inside(point, b), [139.58, 35.48, 139.9, 35.75], 61);
});

const charter = (id: string, ring: Position[], extra: Partial<OverlapAreaInput> = {}): OverlapAreaInput => ({ id, bizType: "general", role: "both", active: true, polygons: [{ kind: "operate", ring }], ...extra });
const SHAPES = [
  charter("tokyo", rect(139.55, 35.52, 139.95, 35.85)),
  charter("yokohama", rect(139.5, 35.3, 139.8, 35.6)),
  charter("fuji", rect(138.6, 35.4, 138.95, 35.6)),
  charter("fuji-north", rect(138.7, 35.55, 138.95, 35.7)),
  charter("chiba", rect(139.95, 35.6, 140.2, 35.8)),
];

test("包车三层的重叠部分：同层、①∩③ 画出来，①②、②③ 和只碰边的不画；同一个区域既是①又是③不算①∩③", () => {
  const layered = (layers: { base?: string[]; itinerary?: string[]; updown?: string[] }) => charterLayerConflictPieces(SHAPES, { base: layers.base ?? [], itinerary: layers.itinerary ?? [], updown: layers.updown ?? [] });
  const same = layered({ updown: ["fuji", "fuji-north"] });
  assert.ok(same.length > 0 && same.every((piece) => piece.layer === "pickup_dropoff" && piece.areaIds.join() === "fuji,fuji-north"));
  // 重叠部分：138.7–138.95 × 35.55–35.6
  for (const piece of same) for (const [x, y] of piece.ring) assert.ok(x >= 138.7 - 1e-9 && x <= 138.95 + 1e-9 && y >= 35.55 - 1e-9 && y <= 35.6 + 1e-9);
  const baseUpdown = layered({ base: ["tokyo"], updown: ["yokohama"] });
  assert.ok(baseUpdown.length > 0 && baseUpdown.every((piece) => piece.layer === "base_pickup_dropoff" && piece.areaIds.join() === "tokyo,yokohama"));
  assert.deepEqual(layered({ base: ["tokyo"], itinerary: ["yokohama"] }), [], "①②可以重叠");
  assert.deepEqual(layered({ itinerary: ["fuji"], updown: ["fuji-north"] }), [], "②③可以重叠");
  assert.deepEqual(layered({ base: ["tokyo"], updown: ["chiba"] }), [], "只碰边");
  assert.deepEqual(layered({ base: ["tokyo"], updown: ["tokyo"] }), [], "同一个区域既是①又是③由 AREA_IS_PRODUCT_AREA 管");
  assert.deepEqual(layered({ itinerary: ["tokyo", "yokohama"] }).map((piece) => piece.layer), ["itinerary"], "②②");
  assert.deepEqual([...new Set(layered({ base: ["tokyo", "yokohama"], updown: ["fuji"] }).map((piece) => piece.layer))], ["base"], "①① 不算成 ①∩③");
  assert.deepEqual(charterLayerConflictPieces(SHAPES.map((shape) => (shape.id === "yokohama" ? { ...shape, active: false } : shape)), { base: ["tokyo"], itinerary: [], updown: ["yokohama"] }), [], "停用的不算");
});

test("上架检查：包车三层区域有重叠时多一项提醒 charter_layer_overlap（不拦上架），没有时不出现", () => {
  const facts = {
    category: "charter" as const,
    brandActive: true,
    cityActive: true,
    pickupPlace: null,
    areas: [{ status: "active" as const, bizType: "charter" as const, cityActive: true }],
    vehicleGroups: [{ active: true, comboOffered: true }],
    dispatcherCount: 1,
    serviceRules: emptyServiceRules(),
    addons: [],
    content: {},
    activePriceRuleCount: 3,
  };
  const items = publishCheck({ ...facts, charterLayerOverlaps: [{ layer: "base_pickup_dropoff", a: "tokyo", b: "yokohama", areaM2: 123_456 }, { layer: "pickup_dropoff", a: "fuji", b: "fuji-north", areaM2: 50_000 }] });
  assert.deepEqual(
    items.find((entry) => entry.key === "charter_layer_overlap"),
    {
      key: "charter_layer_overlap",
      required: false,
      passed: false,
      issues: [
        { path: "/base_pickup_dropoff/tokyo/yokohama", reason: "CHARTER_LAYER_OVERLAP", detail: { overlap_m2: 123_456 } },
        { path: "/pickup_dropoff/fuji/fuji-north", reason: "CHARTER_LAYER_OVERLAP", detail: { overlap_m2: 50_000 } },
      ],
    },
  );
  assert.equal(publishCheck({ ...facts, charterLayerOverlaps: [] }).some((entry) => entry.key === "charter_layer_overlap"), false);
  assert.equal(publishCheck(facts).some((entry) => entry.key === "charter_layer_overlap"), false);
});
