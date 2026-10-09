import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AREA_BIZ_TYPES,
  AREA_BIZ_TYPE_NAMES,
  AREA_LIMITS,
  MAX_SHAPE_TEXT_LENGTH,
  type AreaPolygonShape,
  type Position,
  type Ring,
  ShapeParseError,
  type ShapeParseFailure,
  areaNameKeys,
  areaShapeIssues,
  areaShapeWarnings,
  circleIssues,
  circleToRing,
  isValidRadiusM,
  jsonErrorOffset,
  locatePoint,
  normalizeRing,
  parseGeoJsonShapes,
  parseShapeText,
  parseWktShapes,
  ringIssues,
  ringToGeoJson,
} from "./areas.ts";
import { haversineMeters } from "./geo.ts";

/** 以 (lng, lat) 为左下角、边长 size 度的正方形，逆时针。 */
const square = (lng: number, lat: number, size: number): Ring => [[lng, lat], [lng + size, lat], [lng + size, lat + size], [lng, lat + size]];
const reasons = (ring: Position[]): string[] => ringIssues(ring).map((issue) => issue.reason);

test("常量：业务类型四种都有中文名；上限是规范里的数", () => {
  assert.deepEqual([...AREA_BIZ_TYPES], ["general", "airport_transfer", "point_to_point", "charter"]);
  assert.deepEqual(AREA_BIZ_TYPES.map((type) => AREA_BIZ_TYPE_NAMES[type]), ["通用", "接送机", "点对点", "包车"]);
  assert.deepEqual(
    [AREA_LIMITS.maxPolygons, AREA_LIMITS.maxRingVertices, AREA_LIMITS.maxTotalVertices, AREA_LIMITS.minRingVertices, AREA_LIMITS.minRadiusM, AREA_LIMITS.maxRadiusM, AREA_LIMITS.circleSegments],
    [50, 1000, 5000, 3, 100, 100_000, 64],
  );
});

test("圆 → 多边形：64 个点，都在圆上（误差不到 1 米），6 位小数，逆时针，第一个点在正北", () => {
  const center = { lat: 35.6895, lng: 139.6917 };
  for (const radius of [100, 3_000, 30_000, 100_000]) {
    const ring = circleToRing(center, radius);
    assert.equal(ring.length, 64);
    for (const [lng, lat] of ring) {
      assert.ok(Math.abs(haversineMeters(center, { lat, lng }) - radius) < 1, `半径 ${radius}`);
      assert.equal(Math.round(lng * 1e6) / 1e6, lng);
      assert.equal(Math.round(lat * 1e6) / 1e6, lat);
    }
    assert.deepEqual(ringIssues(ring), [], `半径 ${radius} 的圆是合法的图形`);
    const first = ring[0] as Position;
    assert.ok(Math.abs(first[0] - center.lng) < 1e-6 && first[1] > center.lat, "第一个点在圆心正北");
    assert.ok((ring[1] as Position)[0] < center.lng, "逆时针：第二个点在西边");
  }
  assert.deepEqual(circleToRing(center, 3000), circleToRing(center, 3000), "同样的输入得到同样的多边形");
  // 圆心在多边形里；边的中点比半径近约 0.12%
  const ring = circleToRing(center, 30_000);
  const [a, b] = [ring[0] as Position, ring[1] as Position];
  const mid = haversineMeters(center, { lng: (a[0] + b[0]) / 2, lat: (a[1] + b[1]) / 2 });
  assert.ok(mid > 30_000 * 0.998 && mid < 30_000, String(mid));
  assert.equal(locatePoint([{ id: "c", kind: "operate", ring }], center).result, "operate");
});

test("圆：跨过 180° 经线的会被图形检查拒绝；半径只认 100 到 100000 的整数米", () => {
  assert.deepEqual(reasons(circleToRing({ lat: -17.7, lng: 179.99 }, 5_000)), ["CROSSES_ANTIMERIDIAN"]);
  assert.deepEqual(reasons(circleToRing({ lat: -17.7, lng: 179.0 }, 5_000)), []);
  for (const ok of [100, 3000, 100_000]) assert.equal(isValidRadiusM(ok), true, String(ok));
  for (const bad of [99, 0, -5, 100_001, 2500.5, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(isValidRadiusM(bad), false, String(bad));
});

test("整理一圈点：6 位小数（负零归零）、去掉首尾重复的点、统一成逆时针且第一个点不变；dedupe 时再去掉相邻重复", () => {
  assert.deepEqual(normalizeRing([[139.12345649, 35.1], [140, 35.00000051], [140, 36], [139.12345649, 35.1]]), [[139.123456, 35.1], [140, 35.000001], [140, 36]]);
  const clockwise: Ring = [[0, 0], [0, 1], [1, 1], [1, 0]];
  assert.deepEqual(normalizeRing(clockwise), [[0, 0], [1, 0], [1, 1], [0, 1]], "顺时针的被翻成逆时针，起点不变");
  assert.deepEqual(normalizeRing(square(0, 0, 1)), square(0, 0, 1), "逆时针的原样");
  assert.deepEqual(normalizeRing(normalizeRing(clockwise)), normalizeRing(clockwise), "整理两次和一次一样");
  assert.ok(Object.is(normalizeRing([[-0.0000001, 0], [1, 0], [1, 1]])[0]?.[0], 0));
  const dup: Ring = [[0, 0], [0, 0], [1, 0], [1, 0], [1, 1], [0, 0]];
  assert.deepEqual(normalizeRing(dup), [[0, 0], [0, 0], [1, 0], [1, 0], [1, 1]], "不 dedupe 时相邻重复的留着，由检查报出来");
  assert.deepEqual(normalizeRing(dup, { dedupe: true }), [[0, 0], [1, 0], [1, 1]]);
  assert.deepEqual(normalizeRing([[0, 0], [200, 0], [1, 1]]), [[0, 0], [200, 0], [1, 1]], "坐标不合法的不动方向，留给检查");
  assert.deepEqual(ringToGeoJson(square(0, 0, 1)), { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] });
});

test("一圈点的检查：合法的各种形状——三角形、凹多边形、极小的、顺时针的、贴着 ±180 / ±90 的", () => {
  assert.deepEqual(ringIssues([[0, 0], [1, 0], [0, 1]]), []);
  assert.deepEqual(ringIssues([[0, 0], [4, 0], [4, 4], [2, 1], [0, 4]]), [], "凹多边形");
  assert.deepEqual(ringIssues([[139.7, 35.6], [139.700001, 35.6], [139.7, 35.600001]]), [], "边长 0.000001 度的三角形");
  assert.deepEqual(ringIssues([[0, 0], [0, 1], [1, 1], [1, 0]]), [], "顺时针也合法（保存时再统一方向）");
  assert.deepEqual(ringIssues([[179, -90], [180, -90], [180, 90], [179, 90]]), []);
  assert.deepEqual(ringIssues([[-180, 10], [-179, 10], [-179, 11], [-180, 11]]), []);
  assert.deepEqual(ringIssues([[-170, 0], [10, 0], [10, 10], [-170, 10]]), [], "经度差正好 180 度的边不算跨线");
});

test("一圈点的检查：坐标不合法、点太少、点太多", () => {
  assert.deepEqual(ringIssues([[0, 0], [181, 0], [0, 91], [Number.NaN, 0]]), [
    { reason: "INVALID_COORDINATE", point: 2 },
    { reason: "INVALID_COORDINATE", point: 3 },
    { reason: "INVALID_COORDINATE", point: 4 },
  ]);
  assert.deepEqual(ringIssues([["1", 0] as unknown as Position, [1, 0], [1, 1]]), [{ reason: "INVALID_COORDINATE", point: 1 }]);
  assert.deepEqual(ringIssues([]), [{ reason: "TOO_FEW_POINTS", count: 0 }]);
  assert.deepEqual(ringIssues([[0, 0], [1, 1]]), [{ reason: "TOO_FEW_POINTS", count: 2 }]);
  const circle = (points: number): Ring => Array.from({ length: points }, (_, i) => [Math.round(Math.cos((2 * Math.PI * i) / points) * 1e6) / 1e6, Math.round(Math.sin((2 * Math.PI * i) / points) * 1e6) / 1e6]);
  assert.deepEqual(ringIssues(circle(1000)), [], "1000 个点正好可以");
  assert.deepEqual(ringIssues(circle(1001)), [{ reason: "TOO_MANY_VERTICES", count: 1001 }]);
});

test("一圈点的检查：相邻的点重合（含最后一个和第一个）", () => {
  assert.deepEqual(ringIssues([[0, 0], [0, 0], [1, 0], [1, 1]]), [{ reason: "DUPLICATE_POINT", a: 1, b: 2 }]);
  assert.deepEqual(ringIssues([[0, 0], [1, 0], [1, 1], [0, 0]]), [{ reason: "DUPLICATE_POINT", a: 4, b: 1 }]);
  assert.deepEqual(ringIssues([[0, 0], [1, 0], [1, 0], [1, 1], [1, 1]]).length, 2);
  assert.deepEqual(reasons([[0, 0], [0.0000004, 0], [1, 0], [1, 1]]), ["DUPLICATE_POINT"], "取整到 6 位小数后重合的也算");
});

test("一圈点的检查：跨过 180° 经线、所有点在一条线上", () => {
  assert.deepEqual(reasons([[179, 0], [-179, 0], [-179, 1], [179, 1]]), ["CROSSES_ANTIMERIDIAN"]);
  assert.deepEqual(reasons([[170, 0], [-170, 5], [170, 10]]), ["CROSSES_ANTIMERIDIAN"]);
  assert.deepEqual(reasons([[0, 0], [1, 1], [2, 2]]), ["COLLINEAR"]);
  assert.deepEqual(reasons([[0, 0], [5, 0], [2, 0], [9, 0]]), ["COLLINEAR"]);
  assert.deepEqual(reasons([[139.7, 35.6], [139.7, 35.7], [139.7, 35.8], [139.7, 35.65]]), ["COLLINEAR"]);
});

test("一圈点的检查：边交叉的各种形态，并指出是哪两条边", () => {
  // 蝴蝶结：第 1–2 条边和第 3–4 条边交叉
  assert.deepEqual(ringIssues([[0, 0], [2, 2], [2, 0], [0, 2]]), [{ reason: "SELF_INTERSECTION", a: 1, b: 3 }]);
  // 不相邻的两个点重合（「8」字形在一个点上碰到）
  assert.deepEqual(reasons([[0, 0], [1, 1], [2, 0], [2, 2], [1, 1], [0, 2]]), ["SELF_INTERSECTION"]);
  // 一个点正好落在不相邻的边上（T 形相碰）
  assert.deepEqual(reasons([[0, 0], [4, 0], [4, 4], [2, 0], [0, 4]]), ["SELF_INTERSECTION"]);
  // 折回去压在上一条边上（尖刺）
  assert.deepEqual(ringIssues([[0, 0], [4, 0], [2, 0], [2, 3]]), [{ reason: "SELF_INTERSECTION", a: 1, b: 2 }]);
  // 两条不相邻的边共线并重叠
  assert.deepEqual(reasons([[0, 0], [4, 0], [4, 2], [3, 0], [1, 0], [0, 2]]), ["SELF_INTERSECTION"]);
  // 最后一条边（回到第 1 个点）和中间的边交叉
  assert.deepEqual(ringIssues([[0, 0], [4, 0], [4, 4], [2, -2]]), [{ reason: "SELF_INTERSECTION", a: 1, b: 3 }]);
  // 差之毫厘：只差 0.000001 度没有碰到的不算
  assert.deepEqual(ringIssues([[0, 0], [4, 0], [4, 4], [2, 0.000001], [0, 4]]), []);
  // 大坐标下也用整数精确判断：两条几乎平行的长边
  assert.deepEqual(ringIssues([[-89.999999, -89.999999], [89.999999, 89.999998], [89.999999, 89.999999], [-89.999999, -89.999998]]), []);
  assert.deepEqual(reasons([[-89.999999, -89.999999], [89.999999, 89.999999], [89.999999, 89.999998], [-89.999999, -89.999998]]), ["SELF_INTERSECTION"]);
});

test("一圈点的检查：1000 个点的多边形在合理时间内查完", () => {
  const ring: Ring = Array.from({ length: 1000 }, (_, i) => {
    const angle = (2 * Math.PI * i) / 1000;
    const r = i % 2 === 0 ? 1 : 0.9;
    return [Math.round((139 + Math.cos(angle) * r) * 1e6) / 1e6, Math.round((35 + Math.sin(angle) * r) * 1e6) / 1e6];
  });
  const started = Date.now();
  assert.deepEqual(ringIssues(ring), []);
  assert.ok(Date.now() - started < 3_000);
});

test("区域的检查：至少一块营运区；块数、顶点总数的上限；每一块的问题带上是第几块", () => {
  const operate: AreaPolygonShape = { kind: "operate", ring: square(0, 0, 1) };
  const forbid: AreaPolygonShape = { kind: "forbid", ring: square(0.2, 0.2, 0.1) };
  assert.deepEqual(areaShapeIssues([operate, forbid]), []);
  assert.deepEqual(areaShapeIssues([]), [{ reason: "NO_OPERATE_POLYGON" }]);
  assert.deepEqual(areaShapeIssues([forbid]), [{ reason: "NO_OPERATE_POLYGON" }]);
  assert.deepEqual(areaShapeIssues(Array.from({ length: 50 }, () => operate)), []);
  assert.deepEqual(areaShapeIssues(Array.from({ length: 51 }, () => operate)), [{ reason: "TOO_MANY_POLYGONS", count: 51 }]);
  const big = (points: number): AreaPolygonShape => ({
    kind: "operate",
    ring: Array.from({ length: points }, (_, i) => [Math.round(Math.cos((2 * Math.PI * i) / points) * 1e6) / 1e6, Math.round(Math.sin((2 * Math.PI * i) / points) * 1e6) / 1e6]),
  });
  assert.deepEqual(areaShapeIssues([big(1000), big(1000), big(1000), big(1000), big(1000)]), [], "5000 个点正好可以");
  assert.deepEqual(areaShapeIssues([big(1000), big(1000), big(1000), big(1000), big(1000), operate]), [{ reason: "TOO_MANY_TOTAL_VERTICES", count: 5004 }]);
  assert.deepEqual(areaShapeIssues([operate, { kind: "forbid", ring: [[0, 0], [2, 2], [2, 0], [0, 2]] }, { kind: "operate", ring: [[0, 0], [1, 1]] }]), [
    { polygon: 1, reason: "SELF_INTERSECTION", a: 1, b: 3 },
    { polygon: 2, reason: "TOO_FEW_POINTS", count: 2 },
  ]);
});

test("提醒：禁行区完全在营运区外面、营运区整个在禁行区里、有点离城市太远；正常的重叠不提醒；有问题的图形先跳过", () => {
  const operate: AreaPolygonShape = { kind: "operate", ring: square(139, 35, 1) };
  const inside: AreaPolygonShape = { kind: "forbid", ring: square(139.4, 35.4, 0.1) };
  const overlapping: AreaPolygonShape = { kind: "forbid", ring: square(139.9, 35.9, 0.3) };
  const touching: AreaPolygonShape = { kind: "forbid", ring: square(140, 35, 0.5) };
  const away: AreaPolygonShape = { kind: "forbid", ring: square(141, 36.5, 0.2) };
  const covering: AreaPolygonShape = { kind: "forbid", ring: square(138, 34, 3) };
  assert.deepEqual(areaShapeWarnings([operate, inside, overlapping, touching]), [], "禁行区在营运区里、部分重叠、边相碰都是正常的");
  assert.deepEqual(areaShapeWarnings([operate, inside, away]), [{ reason: "FORBID_OUTSIDE_OPERATE", polygon: 2 }]);
  assert.deepEqual(areaShapeWarnings([operate, covering]), [{ reason: "OPERATE_INSIDE_FORBID", polygon: 0, forbid: 1 }]);
  assert.deepEqual(areaShapeWarnings([operate, { kind: "operate", ring: square(139.5, 35.5, 1) }]), [], "营运区之间重叠不提醒");
  // 禁行区把营运区整个包住时，禁行区不算「在营运区外面」（营运区的点都在它里面）
  assert.ok(!areaShapeWarnings([operate, covering]).some((warning) => warning.reason === "FORBID_OUTSIDE_OPERATE"));
  // 没有营运区（或营运区都有问题）时，每块禁行区都不起作用
  assert.deepEqual(areaShapeWarnings([inside, { kind: "operate", ring: [[0, 0], [2, 2], [2, 0], [0, 2]] }]), [{ reason: "FORBID_OUTSIDE_OPERATE", polygon: 0 }]);
  // 离城市中心超过 300 公里：经纬度填反了的典型情况
  const tokyo = { lat: 35.6895, lng: 139.6917 };
  assert.deepEqual(areaShapeWarnings([operate], tokyo), []);
  const swapped: AreaPolygonShape = { kind: "operate", ring: [[35.6, 139.6], [35.7, 139.6], [35.7, 139.7]].map(([a, b]) => [a as number, (b as number) - 60]) as Ring };
  assert.deepEqual(areaShapeWarnings([operate, swapped], tokyo), [{ reason: "FAR_FROM_CITY", polygon: 1, count: 3 }]);
  const partly: AreaPolygonShape = { kind: "operate", ring: [[139.5, 35.5], [139.9, 35.5], [143.5, 38.5]] };
  assert.deepEqual(areaShapeWarnings([partly], tokyo), [{ reason: "FAR_FROM_CITY", polygon: 0, count: 1 }]);
});

test("点在区域的哪里：禁行优先；同时在营运区里的也列出来；边上和顶点上算在里面", () => {
  const shapes = [
    { id: "o1", kind: "operate" as const, ring: square(0, 0, 10) },
    { id: "o2", kind: "operate" as const, ring: square(5, 5, 10) },
    { id: "f1", kind: "forbid" as const, ring: square(4, 4, 2) },
    { id: "f2", kind: "forbid" as const, ring: square(20, 20, 1) },
  ];
  assert.deepEqual(locatePoint(shapes, { lng: 1, lat: 1 }), { result: "operate", operatePolygonIds: ["o1"], forbidPolygonIds: [] });
  assert.deepEqual(locatePoint(shapes, { lng: 7, lat: 7 }), { result: "operate", operatePolygonIds: ["o1", "o2"], forbidPolygonIds: [] });
  assert.deepEqual(locatePoint(shapes, { lng: 5.5, lat: 5.5 }), { result: "forbid", operatePolygonIds: ["o1", "o2"], forbidPolygonIds: ["f1"] });
  assert.deepEqual(locatePoint(shapes, { lng: 20.5, lat: 20.5 }), { result: "forbid", operatePolygonIds: [], forbidPolygonIds: ["f2"] });
  assert.deepEqual(locatePoint(shapes, { lng: 30, lat: 30 }), { result: "outside", operatePolygonIds: [], forbidPolygonIds: [] });
  assert.deepEqual(locatePoint([], { lng: 1, lat: 1 }).result, "outside");
  // 边界：营运区的边上、顶点上算在营运区里；禁行区的边上、顶点上算在禁行区里
  assert.equal(locatePoint(shapes, { lng: 0, lat: 3 }).result, "operate");
  assert.equal(locatePoint(shapes, { lng: 0, lat: 0 }).result, "operate");
  assert.equal(locatePoint(shapes, { lng: 10, lat: 10 }).result, "operate");
  assert.equal(locatePoint(shapes, { lng: 4, lat: 5 }).result, "forbid");
  assert.equal(locatePoint(shapes, { lng: 6, lat: 6 }).result, "forbid");
  assert.equal(locatePoint(shapes, { lng: -0.000001, lat: 3 }).result, "outside");
  assert.equal(locatePoint(shapes, { lng: 3.999999, lat: 5 }).result, "operate");
  // 顺时针和逆时针的一圈点结果一样
  const cw = [{ id: "o", kind: "operate" as const, ring: [...square(0, 0, 10)].reverse() }];
  assert.equal(locatePoint(cw, { lng: 5, lat: 5 }).result, "operate");
  assert.throws(() => locatePoint(shapes, { lng: 200, lat: 0 }), RangeError);
});

test("重名的判断键：去掉首尾空白、全角半角算同一个、不分大小写、多种语言各出一个", () => {
  assert.deepEqual(areaNameKeys({ zh: " 东京 23 区 ", en: "Tokyo  23 Wards" }), ["tokyo 23 wards", "东京 23 区"]);
  assert.deepEqual(areaNameKeys({ zh: "东京２３区" }), areaNameKeys({ ja: "东京23区" }), "全角数字和半角数字算同一个，不看是哪种语言");
  assert.deepEqual(areaNameKeys({ en: "NARITA", ja: "narita" }), ["narita"]);
  assert.deepEqual(areaNameKeys({}), []);
});

function failure(run: () => unknown): ShapeParseFailure {
  try {
    run();
  } catch (err) {
    assert.ok(err instanceof ShapeParseError, String(err));
    return err.failure;
  }
  throw new Error("应当解析失败");
}

test("解析 GeoJSON：Polygon、MultiPolygon、Feature、FeatureCollection、GeometryCollection；点和线忽略并计数；洞单独给出", () => {
  const polygon = { type: "Polygon", coordinates: [[[139, 35], [140, 35], [140, 36], [139, 36], [139, 35]]] };
  const expected = [[139, 35], [140, 35], [140, 36], [139, 36]];
  assert.deepEqual(parseShapeText(JSON.stringify(polygon)), { format: "geojson", polygons: [{ outer: expected, holes: [] }], ignored: 0 });
  const withHole = { type: "Polygon", coordinates: [polygon.coordinates[0], [[139.4, 35.4], [139.4, 35.6], [139.6, 35.6], [139.6, 35.4], [139.4, 35.4]]] };
  const parsed = parseShapeText(JSON.stringify(withHole));
  assert.deepEqual(parsed.polygons[0]?.holes, [[[139.4, 35.4], [139.6, 35.4], [139.6, 35.6], [139.4, 35.6]]], "洞也整理成逆时针，起点不变");
  const multi = { type: "MultiPolygon", coordinates: [polygon.coordinates, [[[1, 1], [2, 1], [2, 2], [1, 1]]]] };
  assert.equal(parseGeoJsonShapes(multi).polygons.length, 2);
  const collection = {
    type: "FeatureCollection",
    features: [
      { type: "Feature", properties: { name: "x" }, geometry: polygon },
      { type: "Feature", geometry: { type: "Point", coordinates: [139, 35] } },
      { type: "Feature", geometry: null },
      { type: "Feature", geometry: { type: "GeometryCollection", geometries: [multi, { type: "LineString", coordinates: [[0, 0], [1, 1]] }] } },
    ],
  };
  const all = parseShapeText(JSON.stringify(collection, null, 2));
  assert.deepEqual([all.format, all.polygons.length, all.ignored], ["geojson", 3, 3]);
  // 带高度的坐标：高度丢掉；相邻重复的点、首尾重复的点去掉；多于 6 位小数的取整
  const messy = { type: "Polygon", coordinates: [[[139.12345678, 35, 12], [139.12345678, 35, 12], [140, 35, 0], [140, 36, 0], [139.12345678, 35, 12]]] };
  assert.deepEqual(parseGeoJsonShapes(messy).polygons[0]?.outer, [[139.123457, 35], [140, 35], [140, 36]]);
});

test("解析 GeoJSON：语法错（指出行号）、结构不对、没有多边形、坐标超出范围", () => {
  assert.deepEqual(failure(() => parseShapeText('{"type":"Polygon",\n"coordinates":[[[139,35],\n[140,35')).reason, "GEOJSON_SYNTAX");
  const broken = failure(() => parseShapeText('{\n"type": "Polygon",\n"coordinates": [[[139, 35] [140, 35]]]\n}'));
  assert.deepEqual(broken, { reason: "GEOJSON_SYNTAX", line: 3 });
  for (const bad of [{ type: "Polygon" }, { type: "Polygon", coordinates: [] }, { type: "Polygon", coordinates: [[["139", 35]]] }, { type: "Circle" }, { coordinates: [] }, [1, 2], { type: "FeatureCollection" }]) {
    assert.deepEqual(failure(() => parseGeoJsonShapes(bad)), { reason: "GEOJSON_SYNTAX" }, JSON.stringify(bad));
  }
  assert.deepEqual(failure(() => parseShapeText('{"type":"Point","coordinates":[139,35]}')), { reason: "NO_POLYGON" });
  assert.deepEqual(failure(() => parseShapeText('{"type":"FeatureCollection","features":[]}')), { reason: "NO_POLYGON" });
  const outOfRange = { type: "MultiPolygon", coordinates: [[[[1, 1], [2, 1], [2, 2]]], [[[35, 139], [36, 139], [36, 140]]]] };
  assert.deepEqual(failure(() => parseGeoJsonShapes(outOfRange)), { reason: "COORDINATE_OUT_OF_RANGE", polygon: 2 });
});

test("解析 WKT：POLYGON、MULTIPOLYGON，不分大小写，可带 SRID=4326；带洞的；写错的、别的 SRID、EMPTY", () => {
  const simple = parseShapeText("POLYGON((139.69 35.68, 139.75 35.68, 139.75 35.72, 139.69 35.68))");
  assert.deepEqual(simple, { format: "wkt", polygons: [{ outer: [[139.69, 35.68], [139.75, 35.68], [139.75, 35.72]], holes: [] }], ignored: 0 });
  assert.deepEqual(parseShapeText("srid=4326; polygon ( ( 139.69 35.68 ,139.75 35.68,139.75 35.72,139.69 35.68 ) ) ;").polygons, simple.polygons);
  const holes = parseWktShapes("POLYGON((0 0, 10 0, 10 10, 0 10, 0 0), (2 2, 2 4, 4 4, 4 2, 2 2), (6 6, 6 8, 8 8, 6 6))");
  assert.deepEqual([holes.polygons.length, holes.polygons[0]?.holes.length], [1, 2]);
  const multi = parseWktShapes("MULTIPOLYGON(((0 0, 1 0, 1 1, 0 0)), ((5 5, 6 5, 6 6, 5 5), (5.5 5.2, 5.8 5.2, 5.8 5.6, 5.5 5.2)))");
  assert.deepEqual(multi.polygons.map((polygon) => polygon.holes.length), [0, 1]);
  assert.deepEqual(parseWktShapes("POLYGON((1e1 -5.5, +20 -5.5, 20 .5, 1e1 -5.5))").polygons[0]?.outer, [[10, -5.5], [20, -5.5], [20, 0.5]]);
  for (const bad of ["POLYGON", "POLYGON(139 35, 140 35, 140 36)", "POLYGON((139 35, 140 35, 140 36)", "POLYGON((139,35),(140,35))", "POLYGON((139 35 0, 140 35 0, 140 36 0))", "POLYGON Z ((1 1 1, 2 1 1, 2 2 1))", "POLYGON((1 1, 2 1, 2 2)) trailing", "MULTIPOLYGON((1 1, 2 1, 2 2))"]) {
    assert.deepEqual(failure(() => parseShapeText(bad)), { reason: "WKT_SYNTAX" }, bad);
  }
  assert.deepEqual(failure(() => parseShapeText("SRID=3857;POLYGON((1 1, 2 1, 2 2, 1 1))")), { reason: "UNSUPPORTED_SRID" });
  assert.deepEqual(failure(() => parseShapeText("POLYGON EMPTY")), { reason: "NO_POLYGON" });
  assert.deepEqual(failure(() => parseShapeText("POLYGON((35.68 139.69, 35.68 139.75, 35.72 139.75))")), { reason: "COORDINATE_OUT_OF_RANGE", polygon: 1 });
  assert.deepEqual(failure(() => parseShapeText("LINESTRING(0 0, 1 1)")), { reason: "UNRECOGNIZED" });
});

test("解析坐标行：每行一对「纬度, 经度」，逗号、空格、制表符都行；整段是一个多边形", () => {
  const rows = parseShapeText("35.68, 139.69\n35.68\t139.75\r\n\n35.72 139.75\n  35.72;139.69  \n");
  assert.deepEqual(rows, { format: "rows", polygons: [{ outer: [[139.69, 35.68], [139.75, 35.68], [139.75, 35.72], [139.69, 35.72]], holes: [] }], ignored: 0 });
  assert.deepEqual(failure(() => parseShapeText("139.69, 35.68\n139.75, 35.68\n139.75, 35.72")), { reason: "COORDINATE_OUT_OF_RANGE", polygon: 1 }, "经度写在前面（超出纬度范围）会被认出来");
  for (const bad of ["35.68", "35.68, 139.69, 12", "东京站", "35.68 139.69\nabc def", "0x23, 139"]) assert.deepEqual(failure(() => parseShapeText(bad)), { reason: "UNRECOGNIZED" }, bad);
  for (const empty of ["", "  \n\t", "﻿"]) assert.deepEqual(failure(() => parseShapeText(empty)), { reason: "EMPTY" });
});

test("解析只管读出来：边交叉的也读得出，交给图形检查去报", () => {
  const bowtie = parseShapeText("POLYGON((0 0, 2 2, 2 0, 0 2, 0 0))").polygons[0]?.outer as Ring;
  assert.deepEqual(ringIssues(bowtie).map((issue) => issue.reason), ["SELF_INTERSECTION"]);
});

test("圆能不能保存（前后端同一个函数）：圆心、半径各自报；跨 180° 经线、盖住极点的圆报 CROSSES_ANTIMERIDIAN；正常的没有问题", () => {
  const found = (lat: number, lng: number, radiusM: number): string[] => circleIssues({ lat, lng }, radiusM).map((issue) => issue.reason);
  assert.deepEqual(found(35.68, 139.76, 5_000), []);
  assert.deepEqual(found(35.68, 139.76, AREA_LIMITS.minRadiusM), []);
  assert.deepEqual(found(35.68, 139.76, AREA_LIMITS.maxRadiusM), []);
  assert.deepEqual(found(91, 139.76, 5_000), ["INVALID_COORDINATE"]);
  assert.deepEqual(found(Number.NaN, 139.76, 5_000), ["INVALID_COORDINATE"]);
  assert.deepEqual(found(35.68, 180.5, 5_000), ["INVALID_COORDINATE"]);
  assert.deepEqual(found(35.68, 139.76, 99), ["RADIUS_OUT_OF_RANGE"]);
  assert.deepEqual(found(35.68, 139.76, 100_001), ["RADIUS_OUT_OF_RANGE"]);
  assert.deepEqual(found(35.68, 139.76, 500.5), ["RADIUS_OUT_OF_RANGE"]);
  assert.deepEqual(found(-95, 139.76, 0), ["INVALID_COORDINATE", "RADIUS_OUT_OF_RANGE"], "两样可以同时报");
  // 测试工程师报的三个例子：后端一直是拒绝的，现在前端用同一个函数也能在保存前指出来
  assert.deepEqual(found(-16.5, 179.99, 5_000), ["CROSSES_ANTIMERIDIAN"], "斐济附近、贴着 180° 经线");
  assert.deepEqual(found(0, 180, 500), ["CROSSES_ANTIMERIDIAN"], "圆心在 180° 经线上");
  assert.deepEqual(found(89.9, 20, 50_000), ["CROSSES_ANTIMERIDIAN"], "盖住北极");
  assert.deepEqual(found(-89.9, -70, 50_000), ["CROSSES_ANTIMERIDIAN"], "盖住南极");
  // 离 180° 经线够远就没事；结论和「算出多边形再查」逐个相同
  assert.deepEqual(found(-16.5, 179.9, 5_000), []);
  for (const [lat, lng, radiusM] of [[35.7, 179.99, 5_000], [35.7, -179.999, 300], [60, 179.5, 20_000], [80, 0, 100_000], [0, 0, 100_000]] as const) {
    assert.deepEqual(found(lat, lng, radiusM), ringIssues(circleToRing({ lat, lng }, radiusM)).map((issue) => issue.reason), `${lat},${lng},${radiusM}`);
  }
});

test("GeoJSON 语法错的行号：自己找第一处写错的位置，不靠运行环境的报错——多一个逗号、少一个逗号、没写完、前面有空行都给得出", () => {
  const line = (text: string): number | undefined => (failure(() => parseShapeText(text)) as { line?: number }).line;
  assert.equal(line('{\n"type":"Polygon",\n"coordinates":[[[0,0],[1,0],,[1,1]]]\n}'), 3, "多一个逗号");
  assert.equal(line('{\n"type":"Polygon",\n"coordinates":[[[0,0] [1,0],[1,1]]]\n}'), 3, "少一个逗号");
  assert.equal(line('{\n"type":"Polygon",\n"coordinates":[[[0,0],[1,0],[1,1],]]\n}'), 3, "结尾多一个逗号");
  assert.equal(line('{\n"type":"Polygon"\n"coordinates":[]}'), 3, "两项之间少逗号：指到下一项开头");
  assert.equal(line('{"type":"Polygon",\n"coordinates":[[[139,35],\n[140,35'), 3, "没写完：指到最后");
  assert.equal(line("\n\n  {\n'type': 1}"), 4, "前面的空行也数进去，行号和用户贴的内容对得上");
  assert.equal(line("[1, 2"), 1);
  // 找位置的函数本身：合法的返回 null，结论和 JSON.parse 一致
  for (const text of ['{"a":[1,{"b":null}],"c":-1.5e3,"d":"x\\n\\u00e9"}', " [ ] ", "{}", "0", '"x"', "[1e5,-0,0.5,true,false]"]) {
    assert.equal(jsonErrorOffset(text), null, text);
    assert.doesNotThrow(() => JSON.parse(text), text);
  }
  for (const [text, offset] of [["[1,]", 3], ["{a:1}", 1], ["[01]", 2], ["1 2", 2], ["", 0], ['{"a":1,}', 7], ["[.5]", 1], ['{"a" 1}', 5], ["[1}", 2], ['"\\u12G4"', 0]] as const) {
    assert.equal(jsonErrorOffset(text), offset, text);
    assert.throws(() => JSON.parse(text), text);
  }
  // 嵌套再深也不爆栈，用时和长度成正比
  const started = performance.now();
  assert.equal(jsonErrorOffset("[".repeat(500_000)), 500_000);
  assert.equal(jsonErrorOffset(`${"[".repeat(100_000)}${"]".repeat(100_000)}`), null);
  assert.ok(performance.now() - started < 2_000);
});

test("解析用时和长度成正比：很长的数字、很长的空白、认不出的长行都立刻有结论；超过总长度上限的不解析", () => {
  const digits = "1".repeat(20_000);
  const started = performance.now();
  for (const text of [`${digits} ${digits} ${digits}x`, `${digits}.${digits}e${digits} x`, `1${" ".repeat(200_000)}x`, `1 ,${" ".repeat(200_000)}x`, `${"1 2 ".repeat(50_000)}`]) {
    assert.equal(failure(() => parseShapeText(text)).reason, "UNRECOGNIZED", text.slice(0, 20));
  }
  assert.equal(failure(() => parseShapeText(`POLYGON((${digits} ${digits}x, 1 1, 2 2))`)).reason, "WKT_SYNTAX");
  assert.equal(failure(() => parseShapeText(`POLYGON((${"1 1,".repeat(100_000)} 2 2x))`)).reason, "WKT_SYNTAX");
  // 超长的数字照常读出来，再由坐标范围拒绝
  assert.equal(failure(() => parseShapeText(`POLYGON((${digits} 0, 1 0, 1 1))`)).reason, "COORDINATE_OUT_OF_RANGE");
  assert.ok(performance.now() - started < 3_000, `用了 ${Math.round(performance.now() - started)} 毫秒`);
  assert.equal(MAX_SHAPE_TEXT_LENGTH, 10_000_000);
  assert.equal(failure(() => parseShapeText(" ".repeat(MAX_SHAPE_TEXT_LENGTH + 1))).reason, "UNRECOGNIZED");
  assert.equal(failure(() => parseShapeText(`{"type":"Polygon","coordinates":[]}${" ".repeat(MAX_SHAPE_TEXT_LENGTH)}`)).reason, "UNRECOGNIZED");
  // 坐标行的写法没有变：逗号、分号（两边可有空白）或只有空白；一行只能有一个分隔符
  const rows = parseShapeText(" 35.6 , 139.6 \n35.6;139.8\n35.8\t139.8\r\n35.8   139.6\n+35.7,-.5e1\n1.,2.");
  assert.deepEqual(rows.polygons[0]?.outer.length, 6);
  for (const text of ["35.6,,139.6\n1,2\n3,4", "35.6 , ; 139.6\n1,2\n3,4", "35.6\n1,2\n3,4", "1,2,3\n1,2\n3,4", "1e,2\n1,2\n3,4"]) assert.equal(failure(() => parseShapeText(text)).reason, "UNRECOGNIZED", text);
});
