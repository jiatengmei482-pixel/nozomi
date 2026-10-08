/**
 * 区域（M1-02）：一个区域 = 若干块营运区 + 若干块禁行区，挂在一个城市下；每一块是一个不带洞的简单多边形。
 *
 * 来源：docs/requirements/01-tenant-and-quote-engine.md「1. 区域管理」；页面规范 docs/design/pages/tenant-areas.md
 * 第 5、9、16.5 节；落地时定下的事见 ADR 0015。
 *
 * 这里全是纯函数，不依赖 Node 的模块：后端保存和报价时用，浏览器里画图、粘贴、自测时用的是同一份，
 * 所以不会出现「前端放行、后端拒绝」或「自测说在里面、报价说不在」。
 * 检查函数只返回原因代码和位置，不返回句子——句子由界面和接口各自按定稿的文字写。
 *
 * 坐标约定同 geo.ts：一圈点里每个点是 GeoJSON 的顺序 `[经度, 纬度]`；单独的一个位置用 `{ lat, lng }`。
 * 「一圈点」（Ring）是不闭合的写法：最后一个点不重复第一个点。
 */
import { type GeoJsonPolygon, type LatLng, haversineMeters, isValidLatLng, pointInPolygon } from "./geo.ts";
import type { LocalizedText } from "./master-data.ts";

/** 业务类型：通用 / 接送机 / 点对点 / 包车。建商品时只能选到业务类型和商品品类相同的区域，或「通用」的区域。 */
export const AREA_BIZ_TYPES = ["general", "airport_transfer", "point_to_point", "charter"] as const;
export type AreaBizType = (typeof AREA_BIZ_TYPES)[number];

export const AREA_BIZ_TYPE_NAMES: Readonly<Record<AreaBizType, string>> = {
  general: "通用",
  airport_transfer: "接送机",
  point_to_point: "点对点",
  charter: "包车",
};

export const AREA_STATUSES = ["active", "disabled"] as const;
export type AreaStatus = (typeof AREA_STATUSES)[number];

/** 一块图形是营运区还是禁行区。 */
export const AREA_POLYGON_KINDS = ["operate", "forbid"] as const;
export type AreaPolygonKind = (typeof AREA_POLYGON_KINDS)[number];

export const AREA_POLYGON_KIND_NAMES: Readonly<Record<AreaPolygonKind, string>> = { operate: "营运", forbid: "禁行" };

/** 一块图形是怎么来的：画的、粘贴的、圆。只影响之后怎么编辑，不影响判断。 */
export const AREA_POLYGON_SOURCES = ["drawn", "pasted", "circle"] as const;
export type AreaPolygonSource = (typeof AREA_POLYGON_SOURCES)[number];

/** 数量上限（页面规范 5.2）。前端引用这里的常量，不在页面里写死。 */
export const AREA_LIMITS = {
  /** 一个区域的图形块数（营运 + 禁行合计） */
  maxPolygons: 50,
  /** 一个多边形的顶点数 */
  maxRingVertices: 1_000,
  /** 一个区域的顶点总数 */
  maxTotalVertices: 5_000,
  /** 一个多边形最少的顶点数 */
  minRingVertices: 3,
  /** 圆的半径范围（米）：0.1 到 100 公里 */
  minRadiusM: 100,
  maxRadiusM: 100_000,
  /** 圆存成多少条边的正多边形 */
  circleSegments: 64,
  /** 区域名称每种语言最多多少个字 */
  maxNameLength: 100,
  /** 图形备注名最多多少个字 */
  maxLabelLength: 40,
  /** 有点离城市中心超过这么远（公里）就提醒：多半是坐标填错了 */
  farFromCityKm: 300,
} as const;

/** GeoJSON 顺序的一个点：[经度, 纬度]。 */
export type Position = [lng: number, lat: number];
/** 不闭合的一圈点。 */
export type Ring = Position[];

const EARTH_RADIUS_METERS = 6_371_008.8;
const MICRO = 1_000_000;

function round6(value: number): number {
  return Math.round(value * MICRO) / MICRO + 0;
}

/** 坐标换成整数（百万分之一度）：判断交叉、共线、方向时用整数算，不受浮点误差影响。 */
function micro(position: Position): [number, number] {
  return [Math.round(position[0] * MICRO), Math.round(position[1] * MICRO)];
}

/** 三点的转向：正 = 逆时针，负 = 顺时针，0 = 共线。用 BigInt：两个坐标差的乘积会超过双精度能精确表示的整数。 */
function orientation(a: readonly [number, number], b: readonly [number, number], c: readonly [number, number]): number {
  const value = BigInt(b[0] - a[0]) * BigInt(c[1] - a[1]) - BigInt(b[1] - a[1]) * BigInt(c[0] - a[0]);
  return value > 0n ? 1 : value < 0n ? -1 : 0;
}

function withinBox(p: readonly [number, number], a: readonly [number, number], b: readonly [number, number]): boolean {
  return p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0]) && p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1]);
}

/** 两条线段有没有公共点（交叉、端点碰到、共线重叠都算）。 */
function segmentsTouch(
  a1: readonly [number, number],
  a2: readonly [number, number],
  b1: readonly [number, number],
  b2: readonly [number, number],
): boolean {
  if (Math.max(a1[0], a2[0]) < Math.min(b1[0], b2[0]) || Math.max(b1[0], b2[0]) < Math.min(a1[0], a2[0])) return false;
  if (Math.max(a1[1], a2[1]) < Math.min(b1[1], b2[1]) || Math.max(b1[1], b2[1]) < Math.min(a1[1], a2[1])) return false;
  const d1 = orientation(b1, b2, a1);
  const d2 = orientation(b1, b2, a2);
  const d3 = orientation(a1, a2, b1);
  const d4 = orientation(a1, a2, b2);
  if (d1 !== d2 && d3 !== d4) return true;
  if (d1 === 0 && withinBox(a1, b1, b2)) return true;
  if (d2 === 0 && withinBox(a2, b1, b2)) return true;
  if (d3 === 0 && withinBox(b1, a1, a2)) return true;
  return d4 === 0 && withinBox(b2, a1, a2);
}

/** 一圈点围成的面积的两倍（带符号，整数）：正 = 逆时针，负 = 顺时针，0 = 所有点在一条线上。 */
function signedDoubleArea(points: readonly (readonly [number, number])[]): bigint {
  let sum = 0n;
  for (let i = 0; i < points.length; i += 1) {
    const [x1, y1] = points[i] as [number, number];
    const [x2, y2] = points[(i + 1) % points.length] as [number, number];
    sum += BigInt(x1) * BigInt(y2) - BigInt(x2) * BigInt(y1);
  }
  return sum;
}

function isPosition(value: unknown): value is Position {
  return Array.isArray(value) && value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number";
}

function validPosition(position: Position): boolean {
  return isValidLatLng({ lng: position[0], lat: position[1] });
}

/**
 * 圆 → 多边形（页面规范 5.3）：从圆心出发，按方位角 0°、5.625°、……每隔 360/64 度，用球面上的
 * 「起点 + 方位角 + 距离 → 终点」求顶点；每个顶点保留 6 位小数。顶点都在圆上，所以这个正多边形比真圆略小（边的中点近约 0.12%）。
 * 前端画预览、后端保存用的都是这个函数：记录的圆和实际判断用的多边形永远对得上。
 */
export function circleToRing(center: LatLng, radiusM: number): Ring {
  const lat1 = (center.lat * Math.PI) / 180;
  const lng1 = (center.lng * Math.PI) / 180;
  const angular = radiusM / EARTH_RADIUS_METERS;
  const ring: Ring = [];
  for (let i = 0; i < AREA_LIMITS.circleSegments; i += 1) {
    const bearing = (2 * Math.PI * i) / AREA_LIMITS.circleSegments;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing));
    const lng2 = lng1 + Math.atan2(Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1), Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2));
    // 经度归到 [-180, 180)：跨过 180° 经线的圆会因此出现「一条边横跨半个地球」，被一圈点的检查认出来并拒绝
    const lngDeg = ((((lng2 * 180) / Math.PI + 540) % 360) + 360) % 360 - 180;
    ring.push([round6(lngDeg), round6((lat2 * 180) / Math.PI)]);
  }
  return orientRing(ring);
}

/** 圆的半径（米）合不合规：整数米，0.1 到 100 公里。 */
export function isValidRadiusM(radiusM: number): boolean {
  return Number.isInteger(radiusM) && radiusM >= AREA_LIMITS.minRadiusM && radiusM <= AREA_LIMITS.maxRadiusM;
}

/** 统一成逆时针方向（GeoJSON 外圈的方向），第一个点保持是第一个点。所有点在一条线上的原样返回。 */
function orientRing(ring: Ring): Ring {
  if (ring.length < 3 || signedDoubleArea(ring.map(micro)) >= 0n) return ring;
  const [first, ...rest] = ring;
  return [first as Position, ...rest.reverse()];
}

/**
 * 把一圈点整理成保存用的样子：每个坐标保留 6 位小数；首尾重复的那个点去掉；方向统一成逆时针（第一个点不变）。
 * `dedupe` 为真时还去掉相邻重复的点（粘贴进来的内容这样处理；手工逐点输入的不去，由检查报出来）。
 * 不合法的坐标原样留着，由 `ringIssues` 报出来。
 */
export function normalizeRing(points: readonly Position[], options: { dedupe?: boolean } = {}): Ring {
  let ring: Ring = points.map((point) => [round6(point[0]), round6(point[1])]);
  const same = (a: Position | undefined, b: Position | undefined): boolean => a !== undefined && b !== undefined && a[0] === b[0] && a[1] === b[1];
  if (ring.length > 1 && same(ring[0], ring[ring.length - 1])) ring = ring.slice(0, -1);
  if (options.dedupe === true) {
    ring = ring.filter((point, index) => index === 0 || !same(point, ring[index - 1]));
    if (ring.length > 1 && same(ring[0], ring[ring.length - 1])) ring = ring.slice(0, -1);
  }
  return ring.every(validPosition) ? orientRing(ring) : ring;
}

/** 一圈点 → GeoJSON 的 Polygon（只有一圈、首尾闭合）。 */
export function ringToGeoJson(ring: Ring): GeoJsonPolygon {
  const first = ring[0];
  return { type: "Polygon", coordinates: [first === undefined ? [] : [...ring, [first[0], first[1]]]] };
}

export type RingIssue =
  /** 第 `point` 个点（从 1 数）的坐标不合法 */
  | { reason: "INVALID_COORDINATE"; point: number }
  | { reason: "TOO_FEW_POINTS"; count: number }
  | { reason: "TOO_MANY_VERTICES"; count: number }
  /** 第 `a` 个点和第 `b` 个点（相邻）在同一个位置 */
  | { reason: "DUPLICATE_POINT"; a: number; b: number }
  | { reason: "CROSSES_ANTIMERIDIAN" }
  | { reason: "COLLINEAR" }
  /** 第 `a`–`a+1` 个点之间的边，和第 `b`–`b+1` 个点之间的边交叉了（最后一个点的下一个是第 1 个） */
  | { reason: "SELF_INTERSECTION"; a: number; b: number };

/**
 * 一圈点能不能围成一块合法的图形（页面规范 5.4）。没有问题返回空数组。
 * 前面的问题会让后面的检查没有意义，所以按顺序查、查到一类就返回：坐标 → 点数 → 相邻重复 → 跨 180° 经线 → 共线 → 边交叉。
 * 边交叉只报最先找到的一处（修好一处再查下一处）；不相邻的两个点重合也算交叉。
 */
export function ringIssues(ring: readonly Position[]): RingIssue[] {
  const invalid = ring.flatMap((point, index) => (isPosition(point) && validPosition(point) ? [] : [{ reason: "INVALID_COORDINATE" as const, point: index + 1 }]));
  if (invalid.length > 0) return invalid;
  if (ring.length < AREA_LIMITS.minRingVertices) return [{ reason: "TOO_FEW_POINTS", count: ring.length }];
  if (ring.length > AREA_LIMITS.maxRingVertices) return [{ reason: "TOO_MANY_VERTICES", count: ring.length }];
  const points = ring.map(micro);
  const n = points.length;
  const next = (index: number): number => (index + 1) % n;
  const duplicates: RingIssue[] = [];
  for (let i = 0; i < n; i += 1) {
    const a = points[i] as [number, number];
    const b = points[next(i)] as [number, number];
    if (a[0] === b[0] && a[1] === b[1]) duplicates.push({ reason: "DUPLICATE_POINT", a: i + 1, b: next(i) + 1 });
  }
  if (duplicates.length > 0) return duplicates;
  // 一条边的两端经度差超过 180°：只可能是跨过了 180° 经线（两个点分别在它的两侧）
  for (let i = 0; i < n; i += 1) {
    if (Math.abs((points[i] as [number, number])[0] - (points[next(i)] as [number, number])[0]) > 180 * MICRO) return [{ reason: "CROSSES_ANTIMERIDIAN" }];
  }
  // 所有点在一条线上：每个点都和头两个点共线。（不能用「面积为 0」判断：对称的蝴蝶结面积也是 0，那是边交叉。）
  if (points.every((point) => orientation(points[0] as [number, number], points[1] as [number, number], point) === 0)) return [{ reason: "COLLINEAR" }];
  for (let i = 0; i < n; i += 1) {
    const a1 = points[i] as [number, number];
    const a2 = points[next(i)] as [number, number];
    // 相邻的两条边本来就共用一个点：只有「折回去压在上一条边上」才算交叉
    const b2 = points[next(next(i))] as [number, number];
    if (orientation(a1, a2, b2) === 0 && (a1[0] - a2[0]) * (b2[0] - a2[0]) + (a1[1] - a2[1]) * (b2[1] - a2[1]) > 0) {
      return [{ reason: "SELF_INTERSECTION", a: i + 1, b: next(i) + 1 }];
    }
    for (let j = i + 2; j < n; j += 1) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsTouch(a1, a2, points[j] as [number, number], points[next(j)] as [number, number])) {
        return [{ reason: "SELF_INTERSECTION", a: i + 1, b: j + 1 }];
      }
    }
  }
  return [];
}

/** 判断用的一块图形：哪一类，和它的一圈点。 */
export interface AreaPolygonShape {
  kind: AreaPolygonKind;
  ring: readonly Position[];
}

export type AreaShapeIssue =
  | { reason: "NO_OPERATE_POLYGON" }
  | { reason: "TOO_MANY_POLYGONS"; count: number }
  | { reason: "TOO_MANY_TOTAL_VERTICES"; count: number }
  /** 第 `polygon` 块图形（从 0 数，和传入的顺序一致）的问题 */
  | ({ polygon: number } & RingIssue);

/** 整个区域的图形能不能保存（页面规范 5.4）：至少一块营运区、各项上限、每一块自己的问题。没有问题返回空数组。 */
export function areaShapeIssues(shapes: readonly AreaPolygonShape[]): AreaShapeIssue[] {
  const issues: AreaShapeIssue[] = [];
  if (!shapes.some((shape) => shape.kind === "operate")) issues.push({ reason: "NO_OPERATE_POLYGON" });
  if (shapes.length > AREA_LIMITS.maxPolygons) issues.push({ reason: "TOO_MANY_POLYGONS", count: shapes.length });
  const total = shapes.reduce((sum, shape) => sum + shape.ring.length, 0);
  if (total > AREA_LIMITS.maxTotalVertices) issues.push({ reason: "TOO_MANY_TOTAL_VERTICES", count: total });
  for (const [index, shape] of shapes.entries()) {
    for (const issue of ringIssues(shape.ring)) issues.push({ polygon: index, ...issue });
  }
  return issues;
}

function closed(ring: readonly Position[]): GeoJsonPolygon {
  return ringToGeoJson(ring as Ring);
}

function pointInRing(point: Position, ring: readonly Position[]): boolean {
  return pointInPolygon({ lng: point[0], lat: point[1] }, closed(ring));
}

function edgesTouch(a: readonly Position[], b: readonly Position[]): boolean {
  const pa = a.map(micro);
  const pb = b.map(micro);
  for (let i = 0; i < pa.length; i += 1) {
    const a1 = pa[i] as [number, number];
    const a2 = pa[(i + 1) % pa.length] as [number, number];
    for (let j = 0; j < pb.length; j += 1) {
      if (segmentsTouch(a1, a2, pb[j] as [number, number], pb[(j + 1) % pb.length] as [number, number])) return true;
    }
  }
  return false;
}

/** 两块图形的关系：不相干、a 整个在 b 里、b 整个在 a 里、部分重叠（边相交或相碰）。两块都要是合法的图形。 */
function relation(a: readonly Position[], b: readonly Position[]): "disjoint" | "a_in_b" | "b_in_a" | "overlap" {
  if (edgesTouch(a, b)) return "overlap";
  if (pointInRing(a[0] as Position, b)) return "a_in_b";
  if (pointInRing(b[0] as Position, a)) return "b_in_a";
  return "disjoint";
}

export type AreaShapeWarning =
  /** 第 `polygon` 块禁行区和任何一块营运区都不重叠：它不起作用 */
  | { reason: "FORBID_OUTSIDE_OPERATE"; polygon: number }
  /** 第 `polygon` 块营运区整个落在第 `forbid` 块禁行区里：它实际上不会报价 */
  | { reason: "OPERATE_INSIDE_FORBID"; polygon: number; forbid: number }
  /** 第 `polygon` 块图形有 `count` 个点离城市中心超过 300 公里：多半是坐标填错了 */
  | { reason: "FAR_FROM_CITY"; polygon: number; count: number };

/**
 * 值得提醒、但可以保存的情况（页面规范 5.5）。只对合法的图形判断：有问题的那几块先被跳过。
 * 营运区和禁行区重叠、营运区之间重叠都是正常用法，不提醒。
 * @param cityCenter 城市的中心坐标；不给就不查「离城市太远」
 */
export function areaShapeWarnings(shapes: readonly AreaPolygonShape[], cityCenter?: LatLng): AreaShapeWarning[] {
  const warnings: AreaShapeWarning[] = [];
  const sound = shapes.map((shape) => ringIssues(shape.ring).length === 0);
  const indexes = (kind: AreaPolygonKind): number[] => shapes.flatMap((shape, index) => (shape.kind === kind && sound[index] ? [index] : []));
  const operate = indexes("operate");
  const forbid = indexes("forbid");
  for (const f of forbid) {
    const ring = (shapes[f] as AreaPolygonShape).ring;
    if (operate.every((o) => relation(ring, (shapes[o] as AreaPolygonShape).ring) === "disjoint")) warnings.push({ reason: "FORBID_OUTSIDE_OPERATE", polygon: f });
  }
  for (const o of operate) {
    const ring = (shapes[o] as AreaPolygonShape).ring;
    const inside = forbid.find((f) => relation(ring, (shapes[f] as AreaPolygonShape).ring) === "a_in_b");
    if (inside !== undefined) warnings.push({ reason: "OPERATE_INSIDE_FORBID", polygon: o, forbid: inside });
  }
  if (cityCenter !== undefined && isValidLatLng(cityCenter)) {
    for (const [index, shape] of shapes.entries()) {
      const far = shape.ring.filter(
        (point) => isPosition(point) && validPosition(point) && haversineMeters(cityCenter, { lng: point[0], lat: point[1] }) > AREA_LIMITS.farFromCityKm * 1000,
      ).length;
      if (far > 0) warnings.push({ reason: "FAR_FROM_CITY", polygon: index, count: far });
    }
  }
  return warnings;
}

export type PointLocationResult = "operate" | "forbid" | "outside";

export interface PointLocation {
  /** operate：在营运区里且不在禁行区里；forbid：在任何一块禁行区里；outside：都不在 */
  result: PointLocationResult;
  /** 这个位置落在其中的全部营运区（result 是 forbid 时也列出来） */
  operatePolygonIds: string[];
  forbidPolygonIds: string[];
}

/**
 * 一个位置在区域的哪里：禁行优先。自测接口和以后的报价用的都是它。
 * 正好压在边线上的位置算在里面（geo.ts 的规则）。只看这一个区域自己的图形：禁行区只管它所在的区域。
 */
export function locatePoint(shapes: readonly (AreaPolygonShape & { id: string })[], point: LatLng): PointLocation {
  const position: Position = [point.lng, point.lat];
  const hit = (kind: AreaPolygonKind): string[] => shapes.filter((shape) => shape.kind === kind && pointInRing(position, shape.ring)).map((shape) => shape.id);
  const operatePolygonIds = hit("operate");
  const forbidPolygonIds = hit("forbid");
  return { result: forbidPolygonIds.length > 0 ? "forbid" : operatePolygonIds.length > 0 ? "operate" : "outside", operatePolygonIds, forbidPolygonIds };
}

/**
 * 判断同一个城市里两个区域是不是重名用的键：每种语言的名称去掉首尾空白、按兼容形式归一（全角半角算同一个）、不分大小写。
 * 两个区域只要有任意一个键相同就算重名——不要求是同一种语言：「东京 23 区」写在中文名里和写在日文名里，列表上看起来一样。
 */
export function areaNameKeys(name: LocalizedText): string[] {
  return [...new Set(Object.values(name).map((text) => text.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase()))].filter((key) => key !== "").sort();
}

// ---- 解析粘贴进来的坐标：GeoJSON、WKT、坐标行（页面规范 7.4） ----

export type ShapeTextFormat = "geojson" | "wkt" | "rows";

export type ShapeParseFailure =
  | { reason: "EMPTY" }
  | { reason: "UNRECOGNIZED" }
  /** `line` 是出错位置附近的行号（从 1 数），取不到时没有 */
  | { reason: "GEOJSON_SYNTAX"; line?: number }
  | { reason: "WKT_SYNTAX" }
  | { reason: "NO_POLYGON" }
  /** 第 `polygon` 个多边形（从 1 数）里有超出范围的坐标 */
  | { reason: "COORDINATE_OUT_OF_RANGE"; polygon: number }
  | { reason: "UNSUPPORTED_SRID" };

export class ShapeParseError extends Error {
  readonly failure: ShapeParseFailure;
  constructor(failure: ShapeParseFailure) {
    super(failure.reason);
    this.name = "ShapeParseError";
    this.failure = failure;
  }
}

/** 解析出来的一个多边形：外圈和洞（洞在加为营运区时各变成一块禁行区，由界面决定）。圈已经整理过（6 位小数、去掉重复点）。 */
export interface ParsedPolygon {
  outer: Ring;
  holes: Ring[];
}

export interface ParsedShapes {
  format: ShapeTextFormat;
  polygons: ParsedPolygon[];
  /** 不是多边形而被忽略的要素个数（点、线等） */
  ignored: number;
}

function parsedPolygon(rings: unknown, polygonNumber: number, syntax: ShapeParseFailure): ParsedPolygon {
  if (!Array.isArray(rings) || rings.length === 0) throw new ShapeParseError(syntax);
  const cleaned = rings.map((ring) => {
    if (!Array.isArray(ring) || !ring.every(isPosition)) throw new ShapeParseError(syntax);
    const positions = (ring as Position[]).map((point): Position => [point[0], point[1]]);
    if (!positions.every(validPosition)) throw new ShapeParseError({ reason: "COORDINATE_OUT_OF_RANGE", polygon: polygonNumber });
    return normalizeRing(positions, { dedupe: true });
  });
  return { outer: cleaned[0] as Ring, holes: cleaned.slice(1) };
}

/**
 * 从 GeoJSON 对象里取出全部多边形：`Polygon`、`MultiPolygon`，或包着它们的 `Feature`、`FeatureCollection`、`GeometryCollection`。
 * 别的几何类型（点、线）忽略并计数。坐标是 [经度, 纬度]，多出来的高度被丢掉。
 */
export function parseGeoJsonShapes(value: unknown): ParsedShapes {
  const syntax: ShapeParseFailure = { reason: "GEOJSON_SYNTAX" };
  const polygons: ParsedPolygon[] = [];
  let ignored = 0;
  const visit = (node: unknown, depth: number): void => {
    if (typeof node !== "object" || node === null || Array.isArray(node) || depth > 8) throw new ShapeParseError(syntax);
    const record = node as Record<string, unknown>;
    switch (record["type"]) {
      case "Polygon":
        polygons.push(parsedPolygon(record["coordinates"], polygons.length + 1, syntax));
        return;
      case "MultiPolygon":
        if (!Array.isArray(record["coordinates"])) throw new ShapeParseError(syntax);
        for (const rings of record["coordinates"]) polygons.push(parsedPolygon(rings, polygons.length + 1, syntax));
        return;
      case "Feature":
        if (record["geometry"] === null || record["geometry"] === undefined) ignored += 1;
        else visit(record["geometry"], depth + 1);
        return;
      case "FeatureCollection":
        if (!Array.isArray(record["features"])) throw new ShapeParseError(syntax);
        for (const feature of record["features"]) visit(feature, depth + 1);
        return;
      case "GeometryCollection":
        if (!Array.isArray(record["geometries"])) throw new ShapeParseError(syntax);
        for (const geometry of record["geometries"]) visit(geometry, depth + 1);
        return;
      case "Point":
      case "MultiPoint":
      case "LineString":
      case "MultiLineString":
        ignored += 1;
        return;
      default:
        throw new ShapeParseError(syntax);
    }
  };
  visit(value, 0);
  if (polygons.length === 0) throw new ShapeParseError({ reason: "NO_POLYGON" });
  return { format: "geojson", polygons, ignored };
}

const WKT_NUMBER = String.raw`[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?`;
const WKT_RING = new RegExp(String.raw`^\(\s*(${WKT_NUMBER}\s+${WKT_NUMBER}(?:\s*,\s*${WKT_NUMBER}\s+${WKT_NUMBER})*)\s*\)`);

/**
 * 解析 WKT：`POLYGON((…))`、`MULTIPOLYGON(((…)))`，不分大小写，前面可以带 `SRID=4326;`（别的 SRID 报错）。坐标是「经度 纬度」。
 */
export function parseWktShapes(text: string): ParsedShapes {
  const syntax: ShapeParseFailure = { reason: "WKT_SYNTAX" };
  let rest = text.trim();
  const srid = /^SRID\s*=\s*(\d+)\s*;/i.exec(rest);
  if (srid) {
    if (srid[1] !== "4326") throw new ShapeParseError({ reason: "UNSUPPORTED_SRID" });
    rest = rest.slice(srid[0].length).trim();
  }
  const head = /^(MULTIPOLYGON|POLYGON)\s*/i.exec(rest);
  if (!head) throw new ShapeParseError(syntax);
  const multi = (head[1] as string).toUpperCase() === "MULTIPOLYGON";
  rest = rest.slice(head[0].length);
  if (/^EMPTY\s*;?$/i.test(rest)) throw new ShapeParseError({ reason: "NO_POLYGON" });
  const eat = (token: string): boolean => {
    if (!rest.startsWith(token)) return false;
    rest = rest.slice(token.length).trimStart();
    return true;
  };
  const expect = (token: string): void => {
    if (!eat(token)) throw new ShapeParseError(syntax);
  };
  const readRings = (): Position[][] => {
    const rings: Position[][] = [];
    expect("(");
    do {
      const match = WKT_RING.exec(rest);
      if (!match) throw new ShapeParseError(syntax);
      rings.push((match[1] as string).split(",").map((pair): Position => {
        const [lng, lat] = pair.trim().split(/\s+/).map(Number);
        return [lng as number, lat as number];
      }));
      rest = rest.slice(match[0].length).trimStart();
    } while (eat(","));
    expect(")");
    return rings;
  };
  const raw: Position[][][] = [];
  if (multi) {
    expect("(");
    do raw.push(readRings());
    while (eat(","));
    expect(")");
  } else raw.push(readRings());
  if (rest.replace(/;$/, "").trim() !== "") throw new ShapeParseError(syntax);
  return { format: "wkt", polygons: raw.map((rings, index) => parsedPolygon(rings, index + 1, syntax)), ignored: 0 };
}

const ROW = new RegExp(String.raw`^\s*(${WKT_NUMBER})\s*[,;\t ]\s*(${WKT_NUMBER})\s*$`);

/**
 * 解析粘贴进来的一段文字，自动认三种写法：GeoJSON、WKT、或每行一对「纬度, 经度」（整段是一个多边形）。
 * 认不出、写错了、里面没有多边形时抛 `ShapeParseError`，里面是原因代码。
 * 解析只管读出来：每一块是否合法（边交叉等）、数量上限，交给 `ringIssues` / `areaShapeIssues`。
 */
export function parseShapeText(text: string): ParsedShapes {
  const trimmed = text.replace(/^﻿/, "").trim();
  if (trimmed === "") throw new ShapeParseError({ reason: "EMPTY" });
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    let value: unknown;
    try {
      value = JSON.parse(trimmed);
    } catch (err) {
      const position = err instanceof Error ? /position (\d+)/.exec(err.message) : null;
      const line = position ? trimmed.slice(0, Number(position[1])).split("\n").length : undefined;
      throw new ShapeParseError(line === undefined ? { reason: "GEOJSON_SYNTAX" } : { reason: "GEOJSON_SYNTAX", line });
    }
    return parseGeoJsonShapes(value);
  }
  if (/^(SRID\s*=\s*\d+\s*;\s*)?(MULTI)?POLYGON/i.test(trimmed)) return parseWktShapes(trimmed);
  const rows = trimmed.split(/\r?\n/).filter((row) => row.trim() !== "");
  const pairs = rows.map((row) => ROW.exec(row));
  if (pairs.some((pair) => pair === null)) throw new ShapeParseError({ reason: "UNRECOGNIZED" });
  const positions = pairs.map((pair): Position => [Number((pair as RegExpExecArray)[2]), Number((pair as RegExpExecArray)[1])]);
  return { format: "rows", polygons: [parsedPolygon([positions], 1, { reason: "UNRECOGNIZED" })], ignored: 0 };
}
