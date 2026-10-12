/**
 * M1-02 区域：几何规则的补充测试（测试工程师）。areas.test.ts 是开发自己写的用例；这里换一个角度：
 * - 「点在区域的哪里」和「边有没有交叉」各另写一份只用整数的对照实现，拿大量随机图形和位置比对；
 * - 边界：边上、顶点上、极小、细长、凹、高纬度、贴着 ±180°、顺逆时针、上限的两侧；
 * - 禁行区与营运区重叠、嵌套、相切，多块营运区；
 * - 圆变多边形的误差和闭合；6 位小数取整以后才出现的重复点和共线；
 * - 粘贴的各种写法和恶意输入。
 * 名字以「【缺陷】」开头的是现在会失败的用例，交回开发处理。不依赖数据库和网络；随机数用固定的种子，结果可重复。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import {
  AREA_LIMITS,
  type AreaPolygonShape,
  type Position,
  type Ring,
  ShapeParseError,
  areaShapeIssues,
  areaShapeWarnings,
  circleToRing,
  isValidRadiusM,
  locatePoint,
  normalizeRing,
  parseGeoJsonShapes,
  parseShapeText,
  ringIssues,
  ringToGeoJson,
} from "./areas.ts";
import { haversineMeters } from "./geo.ts";

// ───────────── 工具 ─────────────

/** 固定种子的随机数（mulberry32）：失败时可以原样重现。 */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Micro = [x: bigint, y: bigint];
const toMicro = (position: Position): Micro => [BigInt(Math.round(position[0] * 1e6)), BigInt(Math.round(position[1] * 1e6))];
const fromMicro = (x: number, y: number): Position => [x / 1e6, y / 1e6];
const cross = (a: Micro, b: Micro, c: Micro): bigint => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const sign = (value: bigint): number => (value > 0n ? 1 : value < 0n ? -1 : 0);
const between = (p: bigint, a: bigint, b: bigint): boolean => (a <= b ? a <= p && p <= b : b <= p && p <= a);
const onSegment = (p: Micro, a: Micro, b: Micro): boolean => cross(a, b, p) === 0n && between(p[0], a[0], b[0]) && between(p[1], a[1], b[1]);

/**
 * 对照实现：点在不在一圈点里（边上、顶点上算在里面）。全部用整数（百万分之一度）算，没有浮点误差。
 * 做法是绕数（winding number），和被测的射线法不是同一种算法。
 */
function referenceInside(point: Position, ring: readonly Position[]): boolean {
  const p = toMicro(point);
  const points = ring.map(toMicro);
  let winding = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i] as Micro;
    const b = points[(i + 1) % points.length] as Micro;
    if (onSegment(p, a, b)) return true;
    if (a[1] <= p[1]) {
      if (b[1] > p[1] && cross(a, b, p) > 0n) winding += 1;
    } else if (b[1] <= p[1] && cross(a, b, p) < 0n) winding -= 1;
  }
  return winding !== 0;
}

function referenceLocate(shapes: readonly AreaPolygonShape[], point: Position): "operate" | "forbid" | "outside" {
  if (shapes.some((shape) => shape.kind === "forbid" && referenceInside(point, shape.ring))) return "forbid";
  return shapes.some((shape) => shape.kind === "operate" && referenceInside(point, shape.ring)) ? "operate" : "outside";
}

/** 对照实现：两条线段有没有公共点。 */
function referenceTouch(a1: Micro, a2: Micro, b1: Micro, b2: Micro): boolean {
  const d1 = sign(cross(b1, b2, a1));
  const d2 = sign(cross(b1, b2, a2));
  const d3 = sign(cross(a1, a2, b1));
  const d4 = sign(cross(a1, a2, b2));
  if (d1 * d2 < 0 && d3 * d4 < 0) return true;
  return onSegment(a1, b1, b2) || onSegment(a2, b1, b2) || onSegment(b1, a1, a2) || onSegment(b2, a1, a2);
}

/** 对照实现：一圈点是不是简单多边形（前提：没有相邻重复点、不全共线、至少 3 个点）。 */
function referenceSimple(ring: readonly Position[]): boolean {
  const points = ring.map(toMicro);
  const n = points.length;
  for (let i = 0; i < n; i += 1) {
    const a1 = points[i] as Micro;
    const a2 = points[(i + 1) % n] as Micro;
    for (let j = i + 1; j < n; j += 1) {
      const b1 = points[j] as Micro;
      const b2 = points[(j + 1) % n] as Micro;
      const adjacentAfter = j === i + 1;
      const adjacentBefore = i === 0 && j === n - 1;
      if (adjacentAfter || adjacentBefore) {
        // 相邻的两条边只能共用那一个顶点：折回去压在另一条边上就不是简单多边形
        const [shared, p, q] = adjacentAfter ? [a2, a1, b2] : [a1, a2, b1];
        if (cross(p, shared, q) === 0n && (p[0] - shared[0]) * (q[0] - shared[0]) + (p[1] - shared[1]) * (q[1] - shared[1]) > 0n) return false;
      } else if (referenceTouch(a1, a2, b1, b2)) return false;
    }
  }
  return true;
}

/** 以 (cx, cy) 为中心的星形多边形（单位：百万分之一度）：按角度排好的点，一定是简单多边形，多半是凹的。 */
function starRing(random: () => number, cx: number, cy: number, radius: number, vertices: number): Ring {
  const ring: Ring = [];
  const seen = new Set<string>();
  for (let i = 0; i < vertices; i += 1) {
    const angle = (2 * Math.PI * (i + 0.15 + 0.7 * random())) / vertices;
    const r = radius * (0.25 + 0.75 * random());
    const x = Math.round(cx + r * Math.cos(angle));
    const y = Math.round(cy + r * Math.sin(angle));
    if (seen.has(`${x},${y}`)) continue;
    seen.add(`${x},${y}`);
    ring.push(fromMicro(x, y));
  }
  return ring;
}

/** 一个位置到一圈点的边线的最近距离（单位：格，即百万分之一度；按平面算）。 */
function microDistanceToRing(point: Position, ring: readonly Position[]): number {
  const [px, py] = toMicro(point).map(Number) as [number, number];
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < ring.length; i += 1) {
    const [ax, ay] = toMicro(ring[i] as Position).map(Number) as [number, number];
    const [bx, by] = toMicro(ring[(i + 1) % ring.length] as Position).map(Number) as [number, number];
    const lengthSquared = (bx - ax) ** 2 + (by - ay) ** 2;
    const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / lengthSquared));
    best = Math.min(best, Math.hypot(px - (ax + t * (bx - ax)), py - (ay + t * (by - ay))));
  }
  return best;
}

const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b));

/** 一圈点的每条边上、正好落在 6 位小数格点上的位置（含顶点）；每条边最多取 `perEdge` 个。 */
function latticePointsOnEdges(ring: readonly Position[], perEdge: number): Position[] {
  const found: Position[] = [];
  for (let i = 0; i < ring.length; i += 1) {
    const a = toMicro(ring[i] as Position).map(Number) as [number, number];
    const b = toMicro(ring[(i + 1) % ring.length] as Position).map(Number) as [number, number];
    const steps = gcd(b[0] - a[0], b[1] - a[1]);
    const stride = Math.max(1, Math.floor(steps / perEdge));
    for (let k = 0; k <= steps; k += stride) found.push(fromMicro(a[0] + ((b[0] - a[0]) / steps) * k, a[1] + ((b[1] - a[1]) / steps) * k));
  }
  return found;
}

const shape = (kind: "operate" | "forbid", ring: readonly Position[], id: string = kind): AreaPolygonShape & { id: string } => ({ kind, ring, id });
const where = (shapes: readonly (AreaPolygonShape & { id: string })[], lng: number, lat: number): string => locatePoint(shapes, { lng, lat }).result;
const square = (lng: number, lat: number, size: number): Ring => [
  [lng, lat],
  [lng + size, lat],
  [lng + size, lat + size],
  [lng, lat + size],
];
const reasons = (ring: readonly Position[]): string[] => ringIssues(ring).map((issue) => issue.reason);
const failure = (text: string): unknown => {
  try {
    parseShapeText(text);
  } catch (err) {
    if (err instanceof ShapeParseError) return err.failure;
    throw err;
  }
  return null;
};

// ───────────── 点在区域的哪里：和整数对照实现逐点比对 ─────────────

test("点在区域的哪里：随机的凹多边形 × 随机位置 / 顶点 / 边上的格点，和整数对照实现的结论一致（东京、首尔、高纬度、贴近 ±180° 等六处，城市大小到几米大小）；唯一允许的出入是贴着边线外侧不到一格（约 0.11 米）的位置被算在里面", () => {
  const random = rng(20261008);
  const places: [name: string, lng: number, lat: number][] = [
    ["东京", 139.6917, 35.6895],
    ["首尔", 126.978, 37.5665],
    ["高纬度（北纬 78°）", 15.6, 78.2],
    ["贴近 +180°", 179.5, -16.5],
    ["贴近 -180°", -179.5, 51.8],
    ["南半球西经", -70.6, -33.4],
  ];
  // 半径（百万分之一度）：约 30 公里、约 1 公里、约 20 米、约 1 米
  const radii = [300_000, 10_000, 200, 12];
  let compared = 0;
  let tolerated = 0;
  const mismatches: string[] = [];
  for (const [name, lng, lat] of places) {
    for (const radius of radii) {
      for (let round = 0; round < 12; round += 1) {
        const cx = Math.round(lng * 1e6);
        const cy = Math.round(lat * 1e6);
        const ring = starRing(random, cx, cy, radius, 5 + Math.floor(random() * 20));
        if (ringIssues(ring).length > 0) continue;
        const shapes = [shape("operate", ring)];
        const candidates: Position[] = [...ring, ...latticePointsOnEdges(ring, 6)];
        for (let k = 0; k < 150; k += 1) candidates.push(fromMicro(Math.round(cx + (random() * 2.4 - 1.2) * radius), Math.round(cy + (random() * 2.4 - 1.2) * radius)));
        // 和某个顶点同纬度、同经度的位置：射线正好穿过顶点
        for (const vertex of ring.slice(0, 4)) {
          candidates.push([vertex[0], fromMicro(0, Math.round(cy + (random() * 2 - 1) * radius))[1]]);
          candidates.push([fromMicro(Math.round(cx + (random() * 2 - 1) * radius), 0)[0], vertex[1]]);
        }
        for (const point of candidates) {
          compared += 1;
          const expected = referenceLocate(shapes, point);
          const actual = where(shapes, point[0], point[1]);
          if (actual === expected) continue;
          // geo.ts 判断「压在边线上」用的是固定的容差（叉积 1e-12 度²）：边很短时，边线外侧不到一格的位置也被当成压线。
          // 这种出入不到 0.11 米，远小于定位误差，这里放行并计数；别的任何出入都算错。
          if (actual === "operate" && expected === "outside" && microDistanceToRing(point, ring) < 1) {
            tolerated += 1;
            continue;
          }
          if (mismatches.length < 5) mismatches.push(`${name} 半径 ${radius}：位置 ${JSON.stringify(point)} 应为 ${expected}，实际 ${actual}；图形 ${JSON.stringify(ring)}`);
        }
      }
    }
  }
  assert.ok(compared > 40_000, `比对的位置太少：${compared}`);
  assert.deepEqual(mismatches, []);
  assert.ok(tolerated / compared < 0.01, `贴边的出入应当是极少数：${tolerated} / ${compared}`);
});

test("点在区域的哪里：顺时针和逆时针给出的同一圈点结论相同；从哪个点开始写也相同", () => {
  const random = rng(7);
  for (let round = 0; round < 40; round += 1) {
    const ring = starRing(random, 139_700_000, 35_700_000, 50_000, 9);
    const reversed = [...ring].reverse();
    const rotated = [...ring.slice(3), ...ring.slice(0, 3)];
    for (let k = 0; k < 60; k += 1) {
      const lng = (139_700_000 + Math.round((random() * 2.4 - 1.2) * 50_000)) / 1e6;
      const lat = (35_700_000 + Math.round((random() * 2.4 - 1.2) * 50_000)) / 1e6;
      const answers = [ring, reversed, rotated, normalizeRing(reversed)].map((variant) => where([shape("operate", variant)], lng, lat));
      assert.equal(new Set(answers).size, 1, `${lng},${lat} → ${answers.join(" / ")}`);
    }
  }
});

test("点在区域的哪里：边上和顶点上都算在里面——水平边、竖直边、斜边、凹进去的那个顶点、极小的三角形、很细长的多边形", () => {
  const concave: Ring = [
    [139.6, 35.6],
    [139.8, 35.6],
    [139.8, 35.8],
    [139.7, 35.7],
    [139.6, 35.8],
  ];
  const one = [shape("operate", concave)];
  for (const vertex of concave) assert.equal(where(one, vertex[0], vertex[1]), "operate", `顶点 ${vertex.join(",")}`);
  assert.equal(where(one, 139.7, 35.6), "operate", "水平边上");
  assert.equal(where(one, 139.6, 35.7), "operate", "竖直边上");
  assert.equal(where(one, 139.75, 35.75), "operate", "斜边上");
  assert.equal(where(one, 139.65, 35.75), "operate", "另一条斜边上");
  assert.equal(where(one, 139.7, 35.75), "outside", "凹口里面");
  assert.equal(where(one, 139.7, 35.700001), "outside", "凹进去的顶点正上方一格");
  assert.equal(where(one, 139.7, 35.699999), "operate", "凹进去的顶点正下方一格");
  // 和凹顶点同纬度的一条线上：射线穿过顶点时不能数错
  assert.deepEqual([139.59, 139.61, 139.69, 139.71, 139.79, 139.81].map((lng) => where(one, lng, 35.7)), ["outside", "operate", "operate", "operate", "operate", "outside"]);
  // 和上面两个尖同纬度（35.8）：只有两个尖本身在里面
  assert.deepEqual([139.59, 139.6, 139.65, 139.7, 139.75, 139.8, 139.81].map((lng) => where(one, lng, 35.8)), ["outside", "operate", "outside", "outside", "outside", "operate", "outside"]);

  const tiny: Ring = [
    [139.7, 35.7],
    [139.700001, 35.7],
    [139.7, 35.700001],
  ];
  assert.deepEqual(ringIssues(tiny), []);
  const tinyShape = [shape("operate", tiny)];
  assert.deepEqual([where(tinyShape, 139.7, 35.7), where(tinyShape, 139.700001, 35.7), where(tinyShape, 139.7, 35.700001)], ["operate", "operate", "operate"]);
  // 斜边外侧 0.7 格（约 8 厘米）的 (…001, …001) 会被固定容差算成压线，见上一个用例的说明；离开两格的一定在外面
  assert.equal(where(tinyShape, 139.700002, 35.700002), "outside");
  assert.equal(where(tinyShape, 139.699999, 35.7), "outside", "往西一格就在外面");
  assert.equal(where(tinyShape, 139.7, 35.699999), "outside", "往南一格就在外面");

  // 一条 0.5 度长、只有一格宽的「走廊」
  const sliver: Ring = [
    [139.5, 35.5],
    [140, 35.5],
    [140, 35.500001],
    [139.5, 35.500001],
  ];
  assert.deepEqual(ringIssues(sliver), []);
  const sliverShape = [shape("operate", sliver)];
  assert.equal(where(sliverShape, 139.75, 35.5), "operate");
  assert.equal(where(sliverShape, 139.75, 35.5000005), "operate");
  assert.equal(where(sliverShape, 139.75, 35.500001), "operate");
  assert.equal(where(sliverShape, 139.75, 35.500002), "outside");
  assert.equal(where(sliverShape, 139.75, 35.499999), "outside");
  // 斜着的细长条（对角线方向，宽一格）
  const diagonal: Ring = [
    [139.5, 35.5],
    [139.500001, 35.5],
    [139.9, 35.899999],
    [139.9, 35.9],
    [139.899999, 35.9],
    [139.5, 35.500001],
  ];
  assert.deepEqual(ringIssues(diagonal), []);
  const diagonalShape = [shape("operate", diagonal)];
  assert.equal(where(diagonalShape, 139.7, 35.7), "operate", "细长条的中线上");
  assert.equal(where(diagonalShape, 139.700001, 35.7), "operate", "细长条的边上");
  assert.equal(where(diagonalShape, 139.700002, 35.7), "outside");
  assert.equal(where(diagonalShape, 139.7, 35.700002), "outside");
});

test("点在区域的哪里：两块营运区共用一条边（含斜边）时，边上的每个格点至少属于其中一块——交界处不漏", () => {
  const left: Ring = [
    [139.6, 35.6],
    [139.73, 35.6],
    [139.68, 35.8],
    [139.6, 35.8],
  ];
  const right: Ring = [
    [139.73, 35.6],
    [139.9, 35.6],
    [139.9, 35.8],
    [139.68, 35.8],
  ];
  const both = [shape("operate", left, "left"), shape("operate", right, "right")];
  const shared = latticePointsOnEdges([[139.73, 35.6], [139.68, 35.8]], 20_000).filter((point) => point[1] >= 35.6 && point[1] <= 35.8 && referenceInside(point, left) && referenceInside(point, right));
  assert.ok(shared.length > 5_000, `共用边上的格点：${shared.length}`);
  for (const point of shared) {
    const hit = locatePoint(both, { lng: point[0], lat: point[1] });
    assert.deepEqual(hit.operatePolygonIds, ["left", "right"], `共用边上的 ${point.join(",")}`);
  }
});

test("禁行优先：重叠、嵌套、相切（共用一条边、只碰一个角）、多块营运区和多块禁行区；命中的块都列出来", () => {
  const shapes = [
    shape("operate", square(139.6, 35.6, 0.2), "o1"),
    shape("operate", square(139.7, 35.7, 0.2), "o2"), // 和 o1 重叠
    shape("operate", square(140.2, 35.6, 0.1), "o3"), // 孤立的一块
    shape("forbid", square(139.65, 35.65, 0.02), "f-in"), // 完全在 o1 里（嵌套）
    shape("forbid", square(139.78, 35.78, 0.06), "f-over"), // 压在 o1 和 o2 的交界上，一部分伸到 o1 外面
    shape("forbid", square(139.5, 35.6, 0.1), "f-touch"), // 和 o1 共用西边那条边（相切）
    shape("forbid", square(140.3, 35.7, 0.1), "f-corner"), // 只和 o3 碰一个角
    shape("forbid", square(139.655, 35.655, 0.01), "f-in-in"), // 嵌在 f-in 里
  ];
  const at = (lng: number, lat: number): [string, string[], string[]] => {
    const hit = locatePoint(shapes, { lng, lat });
    return [hit.result, hit.operatePolygonIds, hit.forbidPolygonIds];
  };
  assert.deepEqual(at(139.62, 35.62), ["operate", ["o1"], []]);
  assert.deepEqual(at(139.75, 35.75), ["operate", ["o1", "o2"], []], "两块营运区重叠的地方");
  assert.deepEqual(at(139.652, 35.652), ["forbid", ["o1"], ["f-in"]]);
  assert.deepEqual(at(139.66, 35.66), ["forbid", ["o1"], ["f-in", "f-in-in"]], "禁行区里套禁行区");
  assert.deepEqual(at(139.79, 35.79), ["forbid", ["o1", "o2"], ["f-over"]]);
  assert.deepEqual(at(139.83, 35.83), ["forbid", ["o2"], ["f-over"]]);
  assert.deepEqual(at(139.6, 35.65), ["forbid", ["o1"], ["f-touch"]], "相切的那条边：两边都压着，按禁行算");
  assert.deepEqual(at(139.600001, 35.65), ["operate", ["o1"], []], "离开相切的边一格就是营运区");
  assert.deepEqual(at(140.3, 35.7), ["forbid", ["o3"], ["f-corner"]], "只碰一个角：那个角按禁行算");
  assert.deepEqual(at(140.299999, 35.699999), ["operate", ["o3"], []]);
  assert.deepEqual(at(139.55, 35.65), ["forbid", [], ["f-touch"]], "只在禁行区里");
  assert.deepEqual(at(141, 36), ["outside", [], []]);
  assert.deepEqual(locatePoint([], { lng: 139.7, lat: 35.7 }), { result: "outside", operatePolygonIds: [], forbidPolygonIds: [] }, "一块图形都没有");
  assert.deepEqual(locatePoint([shape("forbid", square(139, 35, 1))], { lng: 139.5, lat: 35.5 }).result, "forbid", "只有禁行区");
  assert.throws(() => locatePoint(shapes, { lng: 181, lat: 0 }), RangeError, "不合法的位置不悄悄给出结论");
  assert.throws(() => locatePoint(shapes, { lng: Number.NaN, lat: 0 }), RangeError);
});

test("点在区域的哪里：禁行区只管它所在的那一个区域——同一个位置在甲的禁行区里、在乙的营运区里，乙照常报价", () => {
  const areaA = [shape("operate", square(139.6, 35.6, 0.2), "a-o"), shape("forbid", square(139.65, 35.65, 0.05), "a-f")];
  const areaB = [shape("operate", square(139.6, 35.6, 0.2), "b-o")];
  assert.equal(where(areaA, 139.67, 35.67), "forbid");
  assert.equal(where(areaB, 139.67, 35.67), "operate");
});

// ───────────── 一圈点的检查 ─────────────

test("边交叉：小格子上的随机一圈点，和整数对照实现的结论一致（大量的共线、碰点、折回）", () => {
  const random = rng(99);
  let simple = 0;
  let crossed = 0;
  for (let round = 0; round < 60_000; round += 1) {
    const n = 3 + Math.floor(random() * 5);
    const ring: Ring = Array.from({ length: n }, () => fromMicro(139_700_000 + Math.floor(random() * 5), 35_700_000 + Math.floor(random() * 5)));
    const issues = ringIssues(ring);
    const first = issues[0]?.reason;
    if (first === "DUPLICATE_POINT" || first === "COLLINEAR") continue;
    const expected = referenceSimple(ring);
    assert.equal(issues.length === 0, expected, `${JSON.stringify(ring)} → ${JSON.stringify(issues)}`);
    if (expected) simple += 1;
    else {
      crossed += 1;
      assert.equal(first, "SELF_INTERSECTION");
      // 指出来的那两条边确实有公共点
      const issue = issues[0] as { a: number; b: number };
      const points = ring.map(toMicro);
      const edge = (index: number): [Micro, Micro] => [points[index - 1] as Micro, points[index % n] as Micro];
      const [a1, a2] = edge(issue.a);
      const [b1, b2] = edge(issue.b);
      assert.ok(referenceTouch(a1, a2, b1, b2), `指出的两条边没有公共点：${JSON.stringify(ring)} ${JSON.stringify(issue)}`);
    }
  }
  assert.ok(simple > 1_000 && crossed > 1_000, `两类都要有足够的样本：简单 ${simple}、交叉 ${crossed}`);
});

test("边交叉的各种形态：蝴蝶结、首尾两条边相交、共线重叠、顶点压在别的边上、折回去的尖刺（中间、收尾处）、8 字形共用一个顶点", () => {
  const cases: [string, Ring][] = [
    ["蝴蝶结", [[0, 0], [1, 1], [1, 0], [0, 1]]],
    ["最后一条边和第一条边之后的边相交", [[0, 0], [2, 0], [2, 2], [1, -1]]],
    ["最后一条边和第二条边相交", [[0, 0], [2, 0], [2, 2], [3, 1], [1, 1], [3, 0.5]]],
    ["共线重叠（不相邻的两条边压在同一条线上）", [[0, 0], [4, 0], [4, 1], [3, 0], [1, 0], [0, 1]]],
    ["顶点压在别的边上", [[0, 0], [4, 0], [4, 2], [2, 0], [0, 2]]],
    ["折回去的尖刺（中间）", [[0, 0], [2, 0], [2, 2], [3, 3], [2, 2.5], [2, 2], [0, 2]]],
    ["原路折回", [[0, 0], [2, 0], [2, 2], [2, 0.5], [2, 1], [0, 2]]],
    ["收尾处折回压在第一条边上", [[0, 0], [2, 0], [2, 2], [0, 2], [1, 0]]],
    ["相邻两条边重合（走过去又走回来）", [[0, 0], [2, 0], [1, 0], [1, 1]]],
    ["8 字形：不相邻的两个点在同一个位置", [[0, 0], [1, 1], [2, 0], [2, 2], [1, 1], [0, 2]]],
    ["最后一个点压在第一条边上", [[0, 0], [2, 0], [2, 2], [1, 0]]],
  ];
  for (const [name, ring] of cases) {
    const shifted = ring.map((point): Position => [139 + point[0] / 10, 35 + point[1] / 10]);
    assert.deepEqual(reasons(shifted), ["SELF_INTERSECTION"], name);
    assert.deepEqual(reasons([...shifted].reverse()), ["SELF_INTERSECTION"], `${name}（反过来写）`);
    assert.deepEqual(reasons([...shifted.slice(2), ...shifted.slice(0, 2)]), ["SELF_INTERSECTION"], `${name}（换一个起点）`);
  }
});

test("不该误判的：边上多出来的共线点、凹多边形、锯齿、螺旋、贴着 ±180° 和 ±90° 的、跨过本初子午线和赤道的", () => {
  const fine: [string, Ring][] = [
    ["边上多出来的共线点", [[139, 35], [139.1, 35], [139.2, 35], [139.2, 35.2], [139.1, 35.2], [139, 35.2], [139, 35.1]]],
    ["锯齿", [[139, 35], [139.4, 35], [139.4, 35.2], [139.3, 35.1], [139.2, 35.2], [139.1, 35.1], [139, 35.2]]],
    ["螺旋", [[0, 0], [5, 0], [5, 5], [1, 5], [1, 2], [3, 2], [3, 3], [2, 3], [2, 4], [4, 4], [4, 1], [0, 1]]],
    ["贴着 +180°", square(179.9, 10, 0.1)],
    ["贴着 -180°", square(-180, 10, 0.1)],
    ["贴着北极", [[10, 89.9], [20, 89.9], [15, 90]]],
    ["贴着南极", [[10, -89.9], [15, -90], [20, -89.9]]],
    ["跨过本初子午线和赤道", square(-0.1, -0.1, 0.2)],
    ["正好 180° 宽", [[-90, 0], [90, 0], [0, 10]]],
  ];
  for (const [name, ring] of fine) {
    assert.deepEqual(ringIssues(ring), [], name);
    assert.deepEqual(ringIssues([...ring].reverse()), [], `${name}（顺时针）`);
  }
});

test("6 位小数取整以后才出现的问题：相邻的点合成一个、三个点变成一条线、闭合点差一点点——整理以后都能被认出来", () => {
  const nearDuplicate = normalizeRing([[139, 35], [139.1, 35], [139.1000004, 35.0000004], [139.1, 35.1]]);
  assert.deepEqual(nearDuplicate[1], nearDuplicate[2]);
  assert.deepEqual(reasons(nearDuplicate), ["DUPLICATE_POINT"]);
  // 没有先整理就检查，结论也一样（检查自己按 6 位小数取整）
  assert.deepEqual(reasons([[139, 35], [139.1, 35], [139.1000004, 35.0000004], [139.1, 35.1]]), ["DUPLICATE_POINT"]);
  assert.deepEqual(reasons(normalizeRing([[139, 35], [139.1, 35], [139.05, 35.0000004]])), ["COLLINEAR"]);
  assert.deepEqual(reasons([[139, 35], [139.1, 35], [139.05, 35.0000004]]), ["COLLINEAR"]);
  // 闭合点取整后和第一个点相同：当作闭合点去掉
  assert.deepEqual(normalizeRing([[139, 35], [139.1, 35], [139.1, 35.1], [139.0000001, 35.0000002]]), [[139, 35], [139.1, 35], [139.1, 35.1]]);
  // 取整后才交叉：第四个点原本在边的外侧一点点，取整后落到边上
  assert.deepEqual(reasons(normalizeRing([[139, 35], [139.2, 35], [139.2, 35.2], [139.1, 34.9999996]])), ["SELF_INTERSECTION"]);
  // 取整的方向：正好一半时离零更远还是更近无所谓，但负数和正数要对称地落在格点上
  for (const value of [139.1234565, -139.1234565, 0.0000005, -0.0000005, 35.9999995]) {
    const [rounded] = normalizeRing([[value, 1], [2, 2], [3, 1]])[0] as Position;
    assert.ok(Math.abs(rounded - value) <= 0.0000005 + 1e-12, `${value} → ${rounded}`);
    assert.equal(Math.round(rounded * 1e6) / 1e6, rounded);
    assert.ok(!Object.is(rounded, -0));
  }
});

test("整理一圈点：做两遍和做一遍一样；方向一定是逆时针；第一个点不变；不改变「点在不在里面」", () => {
  const random = rng(5);
  for (let round = 0; round < 200; round += 1) {
    const ring = starRing(random, 139_700_000, 35_700_000, 40_000, 4 + Math.floor(random() * 12));
    const input = random() < 0.5 ? [...ring].reverse() : ring;
    const closed = random() < 0.5 ? [...input, input[0] as Position] : input;
    const once = normalizeRing(closed);
    assert.deepEqual(normalizeRing(once), once);
    assert.deepEqual(normalizeRing(ringToGeoJson(once).coordinates[0] as Position[]), once, "存进去再读出来不变");
    assert.deepEqual(once[0], input[0]);
    assert.equal(once.length, input.length);
    let doubleArea = 0n;
    const points = once.map(toMicro);
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i] as Micro;
      const b = points[(i + 1) % points.length] as Micro;
      doubleArea += a[0] * b[1] - b[0] * a[1];
    }
    assert.ok(doubleArea > 0n, "逆时针");
  }
});

test("上限的两侧：3 个点和 2 个点、1000 个点和 1001 个点；50 块和 51 块；合计 5000 个点和 5001 个点", () => {
  const polygonWith = (count: number, lng = 139, lat = 35): Ring =>
    Array.from({ length: count }, (_, i): Position => [Math.round((lng + 0.1 * Math.cos((2 * Math.PI * i) / count)) * 1e6) / 1e6, Math.round((lat + 0.1 * Math.sin((2 * Math.PI * i) / count)) * 1e6) / 1e6]);
  assert.deepEqual(ringIssues(polygonWith(3)), []);
  assert.deepEqual(ringIssues(polygonWith(3).slice(0, 2)), [{ reason: "TOO_FEW_POINTS", count: 2 }]);
  assert.deepEqual(ringIssues([]), [{ reason: "TOO_FEW_POINTS", count: 0 }]);
  assert.deepEqual(ringIssues(polygonWith(AREA_LIMITS.maxRingVertices)), []);
  assert.deepEqual(ringIssues(polygonWith(AREA_LIMITS.maxRingVertices + 1)), [{ reason: "TOO_MANY_VERTICES", count: 1001 }]);

  const blocks = (count: number): AreaPolygonShape[] => Array.from({ length: count }, (_, i): AreaPolygonShape => ({ kind: i === 0 ? "operate" : "forbid", ring: square(139 + (i % 10) * 0.02, 35 + Math.floor(i / 10) * 0.02, 0.01) }));
  assert.deepEqual(areaShapeIssues(blocks(AREA_LIMITS.maxPolygons)), []);
  assert.deepEqual(areaShapeIssues(blocks(AREA_LIMITS.maxPolygons + 1)), [{ reason: "TOO_MANY_POLYGONS", count: 51 }]);

  const five = Array.from({ length: 5 }, (_, i): AreaPolygonShape => ({ kind: "operate", ring: polygonWith(1000, 139 + i * 0.3) }));
  assert.deepEqual(areaShapeIssues(five), [], "5 × 1000 = 5000 个点");
  assert.deepEqual(areaShapeIssues([...five, { kind: "forbid", ring: polygonWith(3, 141) }]), [{ reason: "TOO_MANY_TOTAL_VERTICES", count: 5003 }]);
  const exact = [...five.slice(0, 4), { kind: "operate" as const, ring: polygonWith(997, 140.2) }, { kind: "forbid" as const, ring: polygonWith(3, 141) }];
  assert.deepEqual(areaShapeIssues(exact), [], "4000 + 997 + 3 = 5000");
  assert.deepEqual(areaShapeIssues([...exact.slice(0, 5), { kind: "forbid", ring: polygonWith(4, 141) }]), [{ reason: "TOO_MANY_TOTAL_VERTICES", count: 5001 }]);
  // 只有禁行区：缺营运区
  assert.deepEqual(areaShapeIssues([{ kind: "forbid", ring: square(139, 35, 0.1) }]), [{ reason: "NO_OPERATE_POLYGON" }]);
  // 营运区自己有问题时，仍然算「有营运区」，只报它自己的问题
  assert.deepEqual(areaShapeIssues([{ kind: "operate", ring: [[139, 35], [139.1, 35]] }]), [{ polygon: 0, reason: "TOO_FEW_POINTS", count: 2 }]);
});

test("50 块 × 100 个点的区域：检查、提醒、判断一个位置加起来在合理的时间内完成（以后报价每次都要算）", () => {
  const shapes = Array.from({ length: 50 }, (_, i): AreaPolygonShape & { id: string } => ({
    id: `p${i}`,
    kind: i % 5 === 4 ? "forbid" : "operate",
    ring: Array.from({ length: 100 }, (_, k): Position => [Math.round((139 + (i % 10) * 0.05 + 0.03 * Math.cos((2 * Math.PI * k) / 100)) * 1e6) / 1e6, Math.round((35 + Math.floor(i / 10) * 0.05 + 0.03 * Math.sin((2 * Math.PI * k) / 100)) * 1e6) / 1e6]),
  }));
  const started = performance.now();
  assert.deepEqual(areaShapeIssues(shapes), []);
  areaShapeWarnings(shapes, { lat: 35.1, lng: 139.2 });
  for (let i = 0; i < 1_000; i += 1) locatePoint(shapes, { lng: 139 + (i % 50) * 0.01, lat: 35 + (i % 30) * 0.01 });
  const elapsed = performance.now() - started;
  // 空闲的开发机上约 0.7 秒（其中判断 1000 个位置约 0.3 秒）；这里只防数量级上的退化，留足余量免得机器忙时误报
  assert.ok(elapsed < 20_000, `用了 ${Math.round(elapsed)} 毫秒`);
});

// ───────────── 圆 ─────────────

test("圆 → 多边形：半径 100 米到 100 公里、赤道到北纬 80°——64 个不重复的点、能通过图形检查、顶点离圆心的距离和半径差不到 0.2 米加万分之一、圆心在里面", () => {
  for (const lat of [0, 35.6895, 37.5665, -33.86, 60, 80]) {
    for (const radius of [AREA_LIMITS.minRadiusM, 101, 500, 3_000, 30_000, AREA_LIMITS.maxRadiusM]) {
      const center = { lat, lng: 139.752799 };
      const ring = circleToRing(center, radius);
      const label = `纬度 ${lat} 半径 ${radius}`;
      assert.equal(ring.length, AREA_LIMITS.circleSegments, label);
      assert.equal(new Set(ring.map((point) => point.join(","))).size, AREA_LIMITS.circleSegments, `${label}：有重复的点`);
      assert.deepEqual(ringIssues(ring), [], label);
      assert.deepEqual(normalizeRing(ring), ring, `${label}：已经是整理过的样子`);
      for (const point of ring) {
        const distance = haversineMeters(center, { lng: point[0], lat: point[1] });
        assert.ok(Math.abs(distance - radius) < 0.2 + radius * 1e-4, `${label}：顶点离圆心 ${distance} 米`);
      }
      const hit = (lng: number, pointLat: number): string => where([shape("operate", ring)], lng, pointLat);
      assert.equal(hit(center.lng, center.lat), "operate", `${label}：圆心`);
      // 64 边形比真圆略小：离圆心 0.99 倍半径的四个方向都在里面，1.01 倍的都在外面
      const north = (factor: number): number => lat + ((radius * factor) / 6_371_008.8) * (180 / Math.PI);
      assert.equal(hit(center.lng, Math.round(north(0.99) * 1e6) / 1e6), "operate", `${label}：正北 0.99 倍半径`);
      assert.equal(hit(center.lng, Math.round(north(1.01) * 1e6) / 1e6 + 0.000002), "outside", `${label}：正北 1.01 倍半径`);
      assert.equal(hit(center.lng, Math.round(north(-0.99) * 1e6) / 1e6), "operate", `${label}：正南 0.99 倍半径`);
    }
  }
});

test("圆：边的中点比半径近约 0.12%（规范写明的误差），不会更多", () => {
  const center = { lat: 35.6895, lng: 139.6917 };
  const radius = 30_000;
  const ring = circleToRing(center, radius);
  let worst = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i] as Position;
    const b = ring[(i + 1) % ring.length] as Position;
    const middle = { lng: (a[0] + b[0]) / 2, lat: (a[1] + b[1]) / 2 };
    worst = Math.max(worst, radius - haversineMeters(center, middle));
  }
  assert.ok(worst > 30 && worst < 40, `半径 30 公里时边的中点最多近 ${worst.toFixed(1)} 米（规范：约 36 米）`);
});

test("圆：半径的合法范围是 100 到 100000 的整数米；跨 180° 经线和盖住极点的圆被图形检查拒绝，不会存成一圈乱掉的点", () => {
  assert.deepEqual([99, 100, 100_000, 100_001, 100.5, 0, -100, Number.NaN, Number.POSITIVE_INFINITY].map(isValidRadiusM), [false, true, true, false, false, false, false, false, false]);
  for (const [name, center, radius] of [
    ["圆心在 180° 经线上", { lat: 0, lng: 180 }, 100],
    ["圆心在 -180° 经线上", { lat: 0, lng: -180 }, 100],
    ["贴着 180° 经线", { lat: 35, lng: 179.9995 }, 100],
    ["盖住北极", { lat: 89.5, lng: 10 }, 100_000],
    ["圆心就在北极", { lat: 90, lng: 0 }, 1_000],
    ["盖住南极", { lat: -89.9, lng: -70 }, 50_000],
  ] as const) {
    const issues = ringIssues(circleToRing(center, radius));
    assert.ok(issues.length > 0, `${name}：应当被拒绝`);
  }
});

// ───────────── 提醒 ─────────────

test("提醒：禁行区盖住整块营运区（嵌套反过来）、几块营运区里只有一块被盖住、禁行区和营运区只碰一个点", () => {
  const operateA = { kind: "operate" as const, ring: square(139.6, 35.6, 0.1) };
  const operateB = { kind: "operate" as const, ring: square(140, 35.6, 0.1) };
  const cover = { kind: "forbid" as const, ring: square(139.5, 35.5, 0.3) };
  assert.deepEqual(areaShapeWarnings([operateA, operateB, cover]), [{ reason: "OPERATE_INSIDE_FORBID", polygon: 0, forbid: 2 }]);
  // 只碰一个角：算有关系（那个角按禁行算），不提醒「完全在外面」
  assert.deepEqual(areaShapeWarnings([operateA, { kind: "forbid", ring: square(139.7, 35.7, 0.1) }]), []);
  // 差一格没碰上：提醒
  assert.deepEqual(areaShapeWarnings([operateA, { kind: "forbid", ring: square(139.700001, 35.7, 0.1) }]), [{ reason: "FORBID_OUTSIDE_OPERATE", polygon: 1 }]);
  // 禁行区完全在一块营运区里，另一块营运区离得很远：不提醒
  assert.deepEqual(areaShapeWarnings([operateA, operateB, { kind: "forbid", ring: square(139.62, 35.62, 0.01) }]), []);
  // 离城市太远：按点数
  assert.deepEqual(areaShapeWarnings([{ kind: "operate", ring: [[139.7, 35.7], [139.8, 35.7], [135.5, 34.7]] }], { lat: 35.69, lng: 139.69 }), [{ reason: "FAR_FROM_CITY", polygon: 0, count: 1 }]);
});

// ───────────── 粘贴：WKT / GeoJSON / 坐标行 ─────────────

test("WKT 的各种写法：大小写、多余的空白和换行、科学计数、正负号、带 SRID=4326、末尾分号、带洞、MULTIPOLYGON 里有带洞的", () => {
  const triangle: Ring = [[139, 35], [139.1, 35], [139.1, 35.1]];
  for (const text of [
    "POLYGON((139 35,139.1 35,139.1 35.1,139 35))",
    "polygon ((139 35, 139.1 35, 139.1 35.1, 139 35))",
    "  PoLyGoN\n(\n  (\n 139   35 ,\n\t139.1 35 ,139.1\t35.1, 139 35\n )\n)\n",
    "POLYGON((1.39e2 3.5E1, 1391e-1 35, 139.1 +35.1, 139. 35.))",
    "SRID=4326;POLYGON((139 35,139.1 35,139.1 35.1,139 35))",
    "srid = 4326 ; POLYGON((139 35,139.1 35,139.1 35.1,139 35));",
    "﻿POLYGON((139 35,139.1 35,139.1 35.1,139 35))",
    "POLYGON((139 35,139.1 35,139.1 35.1))",
    "POLYGON((139 35,139 35,139.1 35,139.1 35,139.1 35.1,139 35))",
  ]) {
    const parsed = parseShapeText(text);
    assert.deepEqual([parsed.format, parsed.polygons, parsed.ignored], ["wkt", [{ outer: triangle, holes: [] }], 0], JSON.stringify(text));
  }
  const west = parseShapeText("POLYGON((-70.6 -33.4, -70.5 -33.4, -70.5 -33.3, -70.6 -33.4))");
  assert.deepEqual(west.polygons[0]?.outer, [[-70.6, -33.4], [-70.5, -33.4], [-70.5, -33.3]]);
  const multi = parseShapeText("MULTIPOLYGON (((0 0,10 0,10 10,0 10,0 0),(2 2,2 4,4 4,4 2,2 2)), ((20 20,30 20,30 30,20 20)))");
  assert.equal(multi.polygons.length, 2);
  assert.deepEqual([multi.polygons[0]?.outer.length, multi.polygons[0]?.holes.length, multi.polygons[1]?.holes.length], [4, 1, 0]);
  // 洞也整理成逆时针、去掉闭合点
  assert.deepEqual(multi.polygons[0]?.holes[0], [[2, 2], [4, 2], [4, 4], [2, 4]]);
});

test("WKT 写错了、不支持的：经纬度写反（纬度超范围）、别的 SRID、别的几何类型、括号不配对、多余的内容、带高度的、EMPTY——都给出原因，不抛别的错", () => {
  const cases: [string, string][] = [
    ["POLYGON((35.6 139.6, 35.6 139.8, 35.8 139.8, 35.6 139.6))", "COORDINATE_OUT_OF_RANGE"],
    ["POLYGON((139 35, 139.1 35, 181 35.1, 139 35))", "COORDINATE_OUT_OF_RANGE"],
    ["POLYGON((1e999 0, 1 0, 1 1, 1e999 0))", "COORDINATE_OUT_OF_RANGE"],
    [`POLYGON((${"9".repeat(400)} 0, 1 0, 1 1))`, "COORDINATE_OUT_OF_RANGE"],
    ["SRID=3857;POLYGON((0 0,1 0,1 1,0 0))", "UNSUPPORTED_SRID"],
    ["SRID=4326POLYGON((0 0,1 0,1 1,0 0))", "UNRECOGNIZED"],
    ["POINT(139 35)", "UNRECOGNIZED"],
    ["LINESTRING(139 35, 140 36)", "UNRECOGNIZED"],
    ["GEOMETRYCOLLECTION(POLYGON((0 0,1 0,1 1,0 0)))", "UNRECOGNIZED"],
    ["POLYGON((0 0,1 0,1 1,0 0)", "WKT_SYNTAX"],
    ["POLYGON(0 0,1 0,1 1,0 0)", "WKT_SYNTAX"],
    ["POLYGON((0 0,1 0,1 1,0 0)) POLYGON((0 0,1 0,1 1,0 0))", "WKT_SYNTAX"],
    ["POLYGON((0 0,1 0,1 1,0 0)) trailing", "WKT_SYNTAX"],
    ["POLYGON((0 0 5,1 0 5,1 1 5,0 0 5))", "WKT_SYNTAX"],
    ["POLYGON((0,0),(1,0),(1,1))", "WKT_SYNTAX"],
    ["POLYGON((a b, c d, e f))", "WKT_SYNTAX"],
    ["POLYGON(())", "WKT_SYNTAX"],
    ["POLYGON EMPTY", "NO_POLYGON"],
    ["MULTIPOLYGON EMPTY;", "NO_POLYGON"],
    ["POLYGON", "WKT_SYNTAX"],
    ["   \n\t ", "EMPTY"],
    ["﻿", "EMPTY"],
    ["你好", "UNRECOGNIZED"],
  ];
  for (const [text, reason] of cases) assert.equal((failure(text) as { reason: string } | null)?.reason, reason, text.slice(0, 60));
});

test("GeoJSON 的各种包法：Feature 套 GeometryCollection、FeatureCollection 里混着点和线和空要素、带高度的坐标、带 bbox / id / properties / crs 的、MultiPolygon 里有带洞的", () => {
  const polygon = { type: "Polygon", coordinates: [[[139, 35], [139.1, 35], [139.1, 35.1], [139, 35]]] };
  const parsed = parseShapeText(
    JSON.stringify({
      type: "FeatureCollection",
      bbox: [139, 35, 140, 36],
      features: [
        { type: "Feature", id: 7, properties: { name: "<b>x</b>" }, geometry: polygon },
        { type: "Feature", properties: null, geometry: null },
        { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [139, 35] } },
        { type: "Feature", properties: {}, geometry: { type: "GeometryCollection", geometries: [{ type: "LineString", coordinates: [[0, 0], [1, 1]] }, { type: "MultiPolygon", coordinates: [[[[0, 0, 12.5], [10, 0, 12.5], [10, 10, 12.5], [0, 0, 12.5]], [[6, 2], [8, 2], [8, 5], [6, 2]]]] }] } },
      ],
    }),
  );
  assert.deepEqual([parsed.format, parsed.polygons.length, parsed.ignored], ["geojson", 2, 3]);
  assert.deepEqual(parsed.polygons[1], { outer: [[0, 0], [10, 0], [10, 10]], holes: [[[6, 2], [8, 2], [8, 5]]] });
  // 前后的空白、换行、BOM
  assert.equal(parseShapeText(`﻿\n\n  ${JSON.stringify(polygon, null, 4)}\n\n`).polygons.length, 1);
  // 解析出来的图形不带原文里的任何别的内容（名字里的 HTML 不会被带进来）
  assert.deepEqual(Object.keys(parsed.polygons[0] as object).sort(), ["holes", "outer"]);
});

test("GeoJSON 写错了、恶意的：语法错（带行号）、不是对象、类型名大小写不对、坐标是字符串 / null / 嵌套不对、超出范围、超深嵌套、超长数字、__proto__——都给出原因，不抛别的错、不卡住", () => {
  const ring = "[[0,0],[1,0],[1,1],[0,0]]";
  const cases: [string, string][] = [
    ['{"type":"Polygon","coordinates":[[[0,0],[1,0],', "GEOJSON_SYNTAX"],
    ["{type:'Polygon'}", "GEOJSON_SYNTAX"],
    ["[]", "GEOJSON_SYNTAX"],
    [`[${ring}]`, "GEOJSON_SYNTAX"],
    [`[{"type":"Polygon","coordinates":[${ring}]}]`, "GEOJSON_SYNTAX"],
    [`{"type":"polygon","coordinates":[${ring}]}`, "GEOJSON_SYNTAX"],
    [`{"coordinates":[${ring}]}`, "GEOJSON_SYNTAX"],
    ['{"type":"Polygon"}', "GEOJSON_SYNTAX"],
    ['{"type":"Polygon","coordinates":[]}', "GEOJSON_SYNTAX"],
    ['{"type":"Polygon","coordinates":"x"}', "GEOJSON_SYNTAX"],
    ['{"type":"Polygon","coordinates":[[["0","0"],[1,0],[1,1]]]}', "GEOJSON_SYNTAX"],
    ['{"type":"Polygon","coordinates":[[[0,null],[1,0],[1,1]]]}', "GEOJSON_SYNTAX"],
    ['{"type":"Polygon","coordinates":[[0,0],[1,0],[1,1]]}', "GEOJSON_SYNTAX"],
    ['{"type":"Polygon","coordinates":[[[0],[1,0],[1,1]]]}', "GEOJSON_SYNTAX"],
    [`{"type":"MultiPolygon","coordinates":[${ring}]}`, "GEOJSON_SYNTAX"],
    ['{"type":"FeatureCollection"}', "GEOJSON_SYNTAX"],
    ['{"type":"FeatureCollection","features":[null]}', "GEOJSON_SYNTAX"],
    ['{"type":"Topology","objects":{}}', "GEOJSON_SYNTAX"],
    ['{"type":"Polygon","coordinates":[[[35.6,139.6],[35.6,139.8],[35.8,139.8]]]}', "COORDINATE_OUT_OF_RANGE"],
    ['{"type":"Polygon","coordinates":[[[1e400,0],[1,0],[1,1]]]}', "COORDINATE_OUT_OF_RANGE"],
    [`{"type":"Polygon","coordinates":[[[${"9".repeat(500)},0],[1,0],[1,1]]]}`, "COORDINATE_OUT_OF_RANGE"],
    ['{"type":"FeatureCollection","features":[]}', "NO_POLYGON"],
    ['{"type":"Feature","geometry":null}', "NO_POLYGON"],
    ['{"type":"MultiPoint","coordinates":[[0,0]]}', "NO_POLYGON"],
    [`{"__proto__":{"type":"Polygon"},"coordinates":[${ring}]}`, "GEOJSON_SYNTAX"],
    ["[".repeat(200_000), "GEOJSON_SYNTAX"],
    ['{"type":"GeometryCollection","geometries":['.repeat(50_000), "GEOJSON_SYNTAX"],
  ];
  for (const [text, reason] of cases) assert.equal((failure(text) as { reason: string } | null)?.reason, reason, text.slice(0, 70));
  // 行号：运行环境的报错里带位置时才有（缺一个逗号这类有；多一个逗号这类没有），有的话必须是对的
  assert.deepEqual(failure('{\n"type":"Polygon",\n"coordinates":[[[0,0] [1,0],[1,1]]]\n}'), { reason: "GEOJSON_SYNTAX", line: 3 });
  const noPosition = failure('{\n"type":"Polygon",\n"coordinates":[[[0,0],[1,0],,[1,1]]]\n}') as { reason: string; line?: number };
  assert.equal(noPosition.reason, "GEOJSON_SYNTAX");
  assert.ok(noPosition.line === undefined || noPosition.line === 3);
  // 合法但嵌得很深（20 层 GeometryCollection）：拒绝，而不是一直往里走
  let nested: unknown = { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
  for (let i = 0; i < 20; i += 1) nested = { type: "GeometryCollection", geometries: [nested] };
  assert.deepEqual(failure(JSON.stringify(nested)), { reason: "GEOJSON_SYNTAX" });
  assert.throws(() => parseGeoJsonShapes(nested), ShapeParseError);
  // 解析以后 Object.prototype 没有被污染
  assert.equal(({} as Record<string, unknown>)["type"], undefined);
});

test("坐标行：纬度在前；逗号、分号、空格、制表符；Windows 换行、空行；经纬度写反时报超出范围；一行不是两个数时认不出", () => {
  const expected: Ring = [[139.6, 35.6], [139.8, 35.6], [139.8, 35.8]];
  for (const text of ["35.6,139.6\n35.6,139.8\n35.8,139.8", "35.6, 139.6\r\n35.6 139.8\r\n\r\n35.8\t139.8\r\n", " 35.6 ; 139.6 \n35.6;139.8\n35.8 ,139.8\n35.6,139.6", "+35.6 139.6\n3.56e1 1.398e2\n35.8 139.8"]) {
    assert.deepEqual(parseShapeText(text).polygons, [{ outer: expected, holes: [] }], JSON.stringify(text));
  }
  assert.deepEqual(failure("139.6, 35.6\n139.8, 35.6\n139.8, 35.8"), { reason: "COORDINATE_OUT_OF_RANGE", polygon: 1 });
  for (const text of ["35.6, 139.6, 12\n35.6, 139.8, 12\n35.8, 139.8, 12", "35.6\n139.6", "35.6N, 139.6E\n35.6, 139.8\n35.8, 139.8", "lat,lng\n35.6,139.6\n35.6,139.8\n35.8,139.8", "35,6 139,6\n35,6 139,8\n35,8 139,8"]) {
    assert.deepEqual(failure(text), { reason: "UNRECOGNIZED" }, JSON.stringify(text));
  }
});

test("超大的输入：20 万个点的 WKT 和 GeoJSON 读得完（超过 1000 个点由界面拒绝），用时和长度成正比、不卡死", () => {
  const points = Array.from({ length: 200_000 }, (_, i) => [Math.round((139 + (i % 1000) * 0.0001) * 1e6) / 1e6, Math.round((35 + Math.floor(i / 1000) * 0.0001) * 1e6) / 1e6]);
  const started = performance.now();
  const wkt = parseShapeText(`POLYGON((${points.map((point) => point.join(" ")).join(",")}))`);
  const geojson = parseShapeText(JSON.stringify({ type: "Polygon", coordinates: [points] }));
  const elapsed = performance.now() - started;
  assert.equal(wkt.polygons[0]?.outer.length, 200_000);
  assert.equal(geojson.polygons[0]?.outer.length, 200_000);
  assert.ok(elapsed < 30_000, `用了 ${Math.round(elapsed)} 毫秒`);
});

/** 在另一个线程里解析一段文字，超过时限就掐掉：被测的正则卡死时测试本身不跟着卡死。返回用掉的毫秒数，超时返回 null。 */
function parseElapsed(text: string, timeoutMs: number): Promise<number | null> {
  const source = `
    const { parentPort, workerData } = require("node:worker_threads");
    import(workerData.module).then(({ parseShapeText }) => {
      const started = performance.now();
      try { parseShapeText(workerData.text); } catch {}
      parentPort.postMessage(performance.now() - started);
    });`;
  return new Promise((resolve) => {
    const worker = new Worker(source, { eval: true, workerData: { module: new URL("./areas.ts", import.meta.url).href, text } });
    const timer = setTimeout(() => {
      void worker.terminate();
      resolve(null);
    }, timeoutMs);
    worker.once("message", (elapsed: number) => {
      clearTimeout(timer);
      void worker.terminate();
      resolve(elapsed);
    });
    worker.once("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
}

test("【缺陷】粘贴一段认不出的内容（9 KB：一行里有三串各 3000 位的数字）应当立刻报「认不出」，实际卡住一分钟以上——坐标行的正则在不匹配时回溯的次数随长度的三次方增长", async () => {
  // 2 MB 以内的文件都允许读进粘贴框（PasteDialog 的上限）。这里只有 9 KB。
  // 例子：一行「数字 数字 数字x」。WKT_NUMBER 里 `\d+\.?\d*` 对一串数字有很多种拆法，行尾不匹配时全部试一遍。
  // 实测（空闲的开发机）：每串 600 位约 1.4 秒，1200 位约 13 秒，3000 位超过 40 秒；一串 2 万位的单行约 3 秒。
  // 现在只有浏览器里用这个函数（卡住的是用户自己的页面）；以后做批量导入接口（/areas:import）在服务端用它之前必须先修。
  const digits = "1".repeat(3_000);
  const elapsed = await parseElapsed(`${digits} ${digits} ${digits}x`, 5_000);
  assert.ok(elapsed !== null, "5 秒内没有解析完（浏览器里表现为粘贴后整个页面卡死）");
  assert.ok(elapsed < 1_000, `用了 ${Math.round(elapsed)} 毫秒`);
});
