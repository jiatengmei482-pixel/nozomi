/**
 * 区域之间的重叠（M8-18，ADR 0074）：一个供应商的几个区域在地图上哪里叠在一起、叠了多大。
 *
 * **什么算重叠**（定义写在 ADR 0074 和 tenant-areas.md 第 19 节，前后端、页面文案都按这里）：
 * - 一个区域「真正报价的范围」= 它的营运区合起来，减去它自己的禁行区（禁行区只管它所在的区域，tenant-areas.md 第 17 节第 2 条；报价时 M8-36 起点落在商品任何一个报价区域的禁行区里整个商品不报，ADR 0085，这里只算形状上的重叠）；
 * - 两个区域重叠 = 两者真正报价的范围有公共部分，面积不小于 `AREA_OVERLAP_MIN_M2`（手画相邻区域时边上难免有细缝，太小的不提示）；
 * - 只看**启用中**的区域（停用的不参与报价）；
 * - 只看**可能被同一个商品同时选上**的两个区域：业务类型相同，或其中一个是「通用」（商品只能选业务类型和品类相同或通用的区域）。
 * - 所以：区域甲的禁行区压在区域乙的营运区上，不是重叠；只有边挨着边（公共部分面积为 0）也不是重叠。
 *
 * 重叠只是提醒，不拦保存：同一个位置落在几个区域里时报价取最低（需求文档「区域规则」）。
 *
 * **怎么算**：竖条分解（slab decomposition）。把全部相关的边的端点、两两交点的经度排序，相邻两个经度之间是一个竖条；
 * 竖条里的边互不相交，按竖条中线处的纬度排好，从下往上走一遍，每经过一条边，它所在的那块图形就「进 / 出」一次。
 * 两条边之间是一个梯形，梯形里每个区域在不在、在几个区域里都确定，于是重叠部分 = 「在两个以上互相能竞争的区域里」的梯形合起来。
 * 结果是精确的（误差只来自浮点数），不近似成格子；圆早已存成 64 边形（areas.ts 的 circleToRing），这里和多边形一样处理。
 *
 * 平面近似：经度当 x、纬度当 y（和点在区域里的判断 `pointInRing` 一致）；面积按竖条中线的纬度换算成平方米，几十公里的区域误差在千分之几以内。
 * 不支持跨过 180° 经线的图形（区域本来就不允许，areas.ts 的 `CROSSES_ANTIMERIDIAN`）。
 *
 * 规模：边数 n 时，找交点用「按最小经度排序 + 扫描」，竖条按活动边表扫描；几十个区域、几千个点在毫秒级。
 * 极端情况（几百个区域、每个几千个点、彼此大面积交错）会到秒级，所以页面只在数据变化时算一次（ADR 0074「限制」）。
 */
import { AREA_LIMITS, type AreaBizType, type AreaPolygonKind, type AreaRole, type AreaSharing, type Position, areaRoleCanOperate, areaRoleCanPrice, ringIssues } from "./areas.ts";
import type { ServiceCategory } from "./master-data.ts";
import { areaUsableByCategory } from "./products.ts";

/** 公共部分不到这么多平方米的不算重叠（10 米 × 10 米）。 */
export const AREA_OVERLAP_MIN_M2 = 100;

const METERS_PER_DEGREE = 111_320;
const EPSILON = 1e-12;

export interface OverlapAreaInput {
  id: string;
  bizType: AreaBizType;
  /** 用途（ADR 0075）：重叠只在报价区域之间算，`operating` 的不参与；不给按报价区域算 */
  role?: AreaRole;
  /** 停用的区域不参与 */
  active: boolean;
  /** 分类（ADR 0102）：平台共享和供应商独立之间不算重叠；不给按供应商独立 */
  sharing?: AreaSharing;
  polygons: readonly { kind: AreaPolygonKind; ring: readonly Position[] }[];
}

export interface AreaOverlapPair {
  /** 两个区域的编号，`a` 在输入里排在 `b` 前面 */
  a: string;
  b: string;
  /** 公共部分的面积（平方米，取整） */
  areaM2: number;
}

/** 重叠部分的一小块（一个梯形，四个点，不闭合）和它同时属于的区域（至少两个）。 */
export interface AreaOverlapPiece {
  areaIds: string[];
  ring: Position[];
}

export interface AreaOverlapResult {
  pairs: AreaOverlapPair[];
  pieces: AreaOverlapPiece[];
  /** 每个区域和哪些区域重叠（按输入顺序）；没有重叠的区域不在里面 */
  byArea: Map<string, string[]>;
}

/** 两个区域可能被同一个商品同时选上（业务类型相同，或其中一个是通用）。 */
export function areasCanCompete(a: AreaBizType, b: AreaBizType): boolean {
  return a === b || a === "general" || b === "general";
}

/** 两个区域算不算互相重叠：业务类型对得上（`areasCanCompete`），而且是同一分类（平台共享和供应商独立之间不算，ADR 0102） */
function inputsCanCompete(a: Pick<OverlapAreaInput, "bizType" | "sharing">, b: Pick<OverlapAreaInput, "bizType" | "sharing">): boolean {
  return areasCanCompete(a.bizType, b.bizType) && (a.sharing ?? "own") === (b.sharing ?? "own");
}

interface Edge {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  polygon: number;
}

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function ringBox(ring: readonly Position[]): Box {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const [x, y] of ring) {
    box.minX = Math.min(box.minX, x);
    box.maxX = Math.max(box.maxX, x);
    box.minY = Math.min(box.minY, y);
    box.maxY = Math.max(box.maxY, y);
  }
  return box;
}

function boxesMeet(a: Box, b: Box): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
}

function yAt(edge: Edge, x: number): number {
  return edge.y0 + ((edge.y1 - edge.y0) * (x - edge.x0)) / (edge.x1 - edge.x0);
}

/** 两条线段在内部相交时交点的 x；平行、不相交、只在端点相碰时为 null（端点本来就是竖条的边界）。 */
function crossingX(a: Edge, b: Edge): number | null {
  const dax = a.x1 - a.x0;
  const day = a.y1 - a.y0;
  const dbx = b.x1 - b.x0;
  const dby = b.y1 - b.y0;
  const denominator = dax * dby - day * dbx;
  if (Math.abs(denominator) < EPSILON * EPSILON) return null;
  const t = ((b.x0 - a.x0) * dby - (b.y0 - a.y0) * dbx) / denominator;
  const u = ((b.x0 - a.x0) * day - (b.y0 - a.y0) * dax) / denominator;
  if (t <= 0 || t >= 1 || u <= 0 || u >= 1) return null;
  return a.x0 + t * dax;
}

/** 竖条里相邻两条边之间的一段：这一段里「真正报价」（在营运区里、不在自己的禁行区里）的区域（`used` 里的下标）、上下两条边的位置、面积。 */
interface Span {
  ids: number[];
  xa: number;
  xb: number;
  lowA: number;
  lowB: number;
  highA: number;
  highB: number;
  /** 这一段的面积（平方米）；高度不大于 0 时为 0 */
  m2: number;
}

function liveAreas(areas: readonly OverlapAreaInput[]): OverlapAreaInput[] {
  return areas.filter((area) => area.active && area.polygons.some((polygon) => polygon.kind === "operate" && polygon.ring.length >= 3));
}

/** 一个区域营运区的外框 */
function operateBox(area: OverlapAreaInput): Box {
  const operate = area.polygons.filter((polygon) => polygon.kind === "operate" && polygon.ring.length >= 3).map((polygon) => ringBox(polygon.ring));
  return operate.reduce((all, box) => ({ minX: Math.min(all.minX, box.minX), minY: Math.min(all.minY, box.minY), maxX: Math.max(all.maxX, box.maxX), maxY: Math.max(all.maxY, box.maxY) }));
}

/**
 * 竖条分解（重叠、超出运营区域共用）：把 `used` 的全部图形切成竖条，每个竖条里从下往上逐段交给 `visit`（同一个竖条的各段按从下到上的顺序一次给全）。
 */
function sweepSpans(used: readonly OverlapAreaInput[], visit: (spans: readonly Span[]) => void, extraXs: readonly number[] = []): void {
  // 全部图形和它们的边（竖直的边不进竖条：它们正好落在竖条的边界上）
  const polygonArea: number[] = [];
  const polygonForbid: boolean[] = [];
  const edges: Edge[] = [];
  const xs: number[] = [];
  used.forEach((area, areaIndex) => {
    for (const polygon of area.polygons) {
      if (polygon.ring.length < 3) continue;
      const index = polygonArea.length;
      polygonArea.push(areaIndex);
      polygonForbid.push(polygon.kind === "forbid");
      polygon.ring.forEach((point, i) => {
        const next = polygon.ring[(i + 1) % polygon.ring.length] as Position;
        xs.push(point[0]);
        if (point[0] === next[0]) return;
        const [left, right] = point[0] < next[0] ? [point, next] : [next, point];
        edges.push({ x0: left[0], y0: left[1], x1: right[0], y1: right[1], polygon: index });
      });
    }
  });
  edges.sort((a, b) => a.x0 - b.x0);
  // 额外的竖条边界（减去区域时竖着切开的位置，见 `subtractAreaRange`）
  xs.push(...extraXs);

  // 交点的经度：按最小经度排好后，每条边只和最小经度落在自己范围里的边比
  for (let i = 0; i < edges.length; i += 1) {
    const a = edges[i] as Edge;
    const aMinY = Math.min(a.y0, a.y1);
    const aMaxY = Math.max(a.y0, a.y1);
    for (let j = i + 1; j < edges.length; j += 1) {
      const b = edges[j] as Edge;
      if (b.x0 >= a.x1) break;
      if (b.polygon === a.polygon) continue;
      if (Math.max(b.y0, b.y1) <= aMinY || Math.min(b.y0, b.y1) >= aMaxY) continue;
      const x = crossingX(a, b);
      if (x !== null) xs.push(x);
    }
  }
  xs.sort((a, b) => a - b);
  const slabs: number[] = [];
  for (const x of xs) if (slabs.length === 0 || x - (slabs[slabs.length - 1] as number) > EPSILON) slabs.push(x);

  const inside = new Array<boolean>(polygonArea.length).fill(false);
  const operateCount = new Array<number>(used.length).fill(0);
  const forbidCount = new Array<number>(used.length).fill(0);
  const scale = METERS_PER_DEGREE * METERS_PER_DEGREE;
  let active: Edge[] = [];
  let next = 0;
  for (let s = 0; s + 1 < slabs.length; s += 1) {
    const xa = slabs[s] as number;
    const xb = slabs[s + 1] as number;
    active = active.filter((edge) => edge.x1 > xa + EPSILON);
    while (next < edges.length && (edges[next] as Edge).x0 <= xa + EPSILON) {
      const edge = edges[next] as Edge;
      if (edge.x1 > xa + EPSILON) active.push(edge);
      next += 1;
    }
    if (active.length < 2) continue;
    const xm = (xa + xb) / 2;
    const ordered = active.map((edge) => ({ edge, ym: yAt(edge, xm), ya: yAt(edge, xa), yb: yAt(edge, xb) })).sort((a, b) => a.ym - b.ym);
    inside.fill(false);
    operateCount.fill(0);
    forbidCount.fill(0);
    const spans: Span[] = [];
    for (let k = 0; k + 1 < ordered.length; k += 1) {
      const current = ordered[k] as (typeof ordered)[number];
      const polygon = current.edge.polygon;
      const areaIndex = polygonArea[polygon] as number;
      const counts = polygonForbid[polygon] ? forbidCount : operateCount;
      inside[polygon] = !inside[polygon];
      counts[areaIndex] = (counts[areaIndex] as number) + (inside[polygon] ? 1 : -1);
      // 这条边和上面一条边之间：哪些区域「真正报价」
      const above = ordered[k + 1] as (typeof ordered)[number];
      const ids: number[] = [];
      for (let a = 0; a < used.length; a += 1) if ((operateCount[a] as number) > 0 && forbidCount[a] === 0) ids.push(a);
      const height = (above.ya - current.ya + (above.yb - current.yb)) / 2;
      const m2 = height > 0 ? (xb - xa) * height * scale * Math.cos((current.ym + above.ym) * (Math.PI / 360)) : 0;
      spans.push({ ids, xa, xb, lowA: current.ya, lowB: current.yb, highA: above.ya, highB: above.yb, m2 });
    }
    visit(spans);
  }
}

/**
 * 一个竖条里的各段按「属于哪组区域」（`keyOf`，空串 = 不要）连成一块块梯形：和下面一段是同一组的接着往上长，不另起一块（地图上少画很多条缝）。
 * 收口用的是下一段的下边：高度为 0 的段被跳过，和它上一段的上边是同一条线。
 */
function mergeSpans(spans: readonly Span[], keyOf: (span: Span) => string, emit: (key: string, ring: Position[]) => void): void {
  let open: { key: string; lowA: number; lowB: number } | undefined;
  let top: Span | undefined;
  for (const span of spans) {
    // 高度为 0 的一段（两条边重合）不改变正在长的那一块：既不让它断开，也不单独成一块（地图上不画一条线）
    if (span.m2 <= 0) continue;
    const key = keyOf(span);
    // 换了一组区域：上一块在这一段的下边收口
    if (open !== undefined && open.key !== key) {
      emit(open.key, [[span.xa, open.lowA], [span.xb, open.lowB], [span.xb, span.lowB], [span.xa, span.lowA]]);
      open = undefined;
    }
    top = span;
    if (key === "") continue;
    open ??= { key, lowA: span.lowA, lowB: span.lowB };
  }
  if (open !== undefined && top !== undefined) emit(open.key, [[top.xa, open.lowA], [top.xb, open.lowB], [top.xb, top.highB], [top.xa, top.highA]]);
}

/**
 * 区域之间的重叠：哪几对重叠、各重叠多少平方米、重叠部分的形状（画在地图上）。
 * 只在**报价区域之间**算（ADR 0075 第五部分）：用途是「运营区域」（`role: "operating"`）的不参与——运营范围合起来用，重叠没有影响；
 * 没给用途的按报价区域算（ADR 0075 之前的口径）。
 */
export function findAreaOverlaps(areas: readonly OverlapAreaInput[]): AreaOverlapResult {
  const live = liveAreas(areas.filter((area) => area.role !== "operating"));
  // 每个区域营运区的外框；外框和任何一个能竞争的区域都碰不到的区域不用算
  const boxes = live.map(operateBox);
  const candidate = live.map((area, i) => live.some((other, j) => j !== i && inputsCanCompete(area, other) && boxesMeet(boxes[i] as Box, boxes[j] as Box)));
  const used = live.filter((_, i) => candidate[i]);
  const empty: AreaOverlapResult = { pairs: [], pieces: [], byArea: new Map() };
  if (used.length < 2) return empty;

  const pairArea = new Map<string, number>();
  const rawPieces: { ids: number[]; ring: Position[] }[] = [];
  sweepSpans(used, (spans) => {
    const competingIds = new Map<Span, number[]>();
    for (const span of spans) {
      const { ids } = span;
      const competing: [number, number][] = [];
      for (let i = 0; i < ids.length; i += 1) {
        for (let j = i + 1; j < ids.length; j += 1) {
          if (inputsCanCompete(used[ids[i] as number] as OverlapAreaInput, used[ids[j] as number] as OverlapAreaInput)) competing.push([ids[i] as number, ids[j] as number]);
        }
      }
      if (competing.length === 0) continue;
      competingIds.set(span, ids);
      if (span.m2 > 0) for (const [i, j] of competing) pairArea.set(`${i},${j}`, (pairArea.get(`${i},${j}`) ?? 0) + span.m2);
    }
    mergeSpans(spans, (span) => competingIds.get(span)?.join(",") ?? "", (key, ring) => rawPieces.push({ ids: key.split(",").map(Number), ring }));
  });

  const pairs: AreaOverlapPair[] = [];
  const kept = new Set<string>();
  for (const [pair, m2] of pairArea) {
    if (m2 < AREA_OVERLAP_MIN_M2) continue;
    const [i, j] = pair.split(",").map(Number) as [number, number];
    kept.add(pair);
    pairs.push({ a: (used[i] as OverlapAreaInput).id, b: (used[j] as OverlapAreaInput).id, areaM2: Math.round(m2) });
  }
  const order = new Map(areas.map((area, index) => [area.id, index]));
  pairs.sort((x, y) => (order.get(x.a) as number) - (order.get(y.a) as number) || (order.get(x.b) as number) - (order.get(y.b) as number));
  const byArea = new Map<string, string[]>();
  for (const pair of pairs) {
    byArea.set(pair.a, [...(byArea.get(pair.a) ?? []), pair.b]);
    byArea.set(pair.b, [...(byArea.get(pair.b) ?? []), pair.a]);
  }
  for (const [id, list] of byArea) byArea.set(id, list.sort((x, y) => (order.get(x) as number) - (order.get(y) as number)));
  const pieces: AreaOverlapPiece[] = [];
  for (const piece of rawPieces) {
    const ids = piece.ids.filter((i) => piece.ids.some((j) => j !== i && kept.has(i < j ? `${i},${j}` : `${j},${i}`)));
    if (ids.length >= 2) pieces.push({ areaIds: ids.map((i) => (used[i] as OverlapAreaInput).id), ring: piece.ring });
  }
  return { pairs, pieces, byArea };
}

// ---- 报价区域超出运营区域的部分（ADR 0075 第一部分第 2 节） ----

export interface PricingOutsideResult {
  /** 每个报价区域不在任何运营区域里的面积（平方米，取整）；不到 `AREA_OVERLAP_MIN_M2` 的不在里面 */
  byArea: Map<string, number>;
  /** 超出的部分（梯形，四个点，不闭合）和它属于哪几个报价区域：画在地图上 */
  pieces: AreaOverlapPiece[];
}

/**
 * 报价区域「真正的范围」（营运区减去自己的禁行区）里，不在任何一个运营区域「真正的范围」里的部分（同一个竖条分解）。
 * - `pricing`：要看的报价区域；`operating`：运营范围（调用方已经按用途挑好：运营区域和「运营 + 报价」）。同一个区域可以两边都在（「运营 + 报价」自己盖住自己）。
 * - `covers(报价区域, 运营区域)`：这个运营区域算不算这个报价区域的运营范围；默认按业务类型相容（相同，或其中一个是通用）。
 * - 停用的区域不参与（停用的报价区域不报价，停用的运营区域不算运营范围）。
 */
export function findPricingOutsideOperating(
  pricing: readonly OverlapAreaInput[],
  operating: readonly OverlapAreaInput[],
  covers: (pricingArea: OverlapAreaInput, operatingArea: OverlapAreaInput) => boolean = (a, b) => areasCanCompete(a.bizType, b.bizType),
): PricingOutsideResult {
  const result: PricingOutsideResult = { byArea: new Map(), pieces: [] };
  const priced = liveAreas(pricing);
  if (priced.length === 0) return result;
  const pricedBoxes = priced.map(operateBox);
  const pricedIds = new Set(priced.map((area) => area.id));
  // 只要外框碰得到某个报价区域、又不是报价区域本身的运营区域
  const operated = liveAreas(operating).filter((area) => !pricedIds.has(area.id) && pricedBoxes.some((box) => boxesMeet(box, operateBox(area))));
  const used = [...priced, ...operated];
  const operatingIds = new Set(operating.map((area) => area.id));
  const isPricing = used.map((_, index) => index < priced.length);
  const isOperating = used.map((area) => operatingIds.has(area.id));
  // 每个报价区域能被哪些下标的区域盖住
  const coveredBy = priced.map((area, p) => new Set(used.flatMap((other, o) => (isOperating[o] && (o === p || covers(area, other)) ? [o] : []))));

  const outsideM2 = new Map<number, number>();
  const rawPieces: { ids: number[]; ring: Position[] }[] = [];
  sweepSpans(used, (spans) => {
    const outsideIds = new Map<Span, number[]>();
    for (const span of spans) {
      const outside = span.ids.filter((p) => isPricing[p] && !span.ids.some((o) => (coveredBy[p] as Set<number>).has(o)));
      if (outside.length === 0) continue;
      outsideIds.set(span, outside);
      if (span.m2 > 0) for (const p of outside) outsideM2.set(p, (outsideM2.get(p) ?? 0) + span.m2);
    }
    mergeSpans(spans, (span) => outsideIds.get(span)?.join(",") ?? "", (key, ring) => rawPieces.push({ ids: key.split(",").map(Number), ring }));
  });
  for (const [p, m2] of outsideM2) if (m2 >= AREA_OVERLAP_MIN_M2) result.byArea.set((priced[p] as OverlapAreaInput).id, Math.round(m2));
  for (const piece of rawPieces) {
    const ids = piece.ids.map((p) => (priced[p] as OverlapAreaInput).id).filter((id) => result.byArea.has(id));
    if (ids.length > 0) result.pieces.push({ areaIds: ids, ring: piece.ring });
  }
  return result;
}

/**
 * 一个商品勾选的报价区域（`pricingAreaIds`：商品区域、启用的包车区域加价的区域）各有多少平方米不在这个供应商的运营范围里（ADR 0075）：
 * 运营范围按商品的品类取（用途是运营或运营 + 报价、业务类型和品类相容、启用中），和报价时的运营判断一样。不到 100 平方米的不在结果里。
 * `areas` 是这个供应商的全部区域（没给用途的按运营 + 报价算）。
 */
export function productPricingOutsideOperating(areas: readonly OverlapAreaInput[], pricingAreaIds: readonly string[], category: ServiceCategory): Map<string, number> {
  const pricing = areas.filter((area) => pricingAreaIds.includes(area.id) && areaRoleCanPrice(area.role ?? "both"));
  const operating = areas.filter((area) => areaRoleCanOperate(area.role ?? "both") && areaUsableByCategory(category, area.bizType));
  return findPricingOutsideOperating(pricing, operating, () => true).byArea;
}

// ---- 包车三层区域的保存校验（M9P-06，ADR 0093 第七节第 1、2 条；规格第四节第 2 小节）----

/** 只有边界接触不算重叠：小于 0.01 平方公里（ADR 0093 第七节第 1 条） */
export const CHARTER_LAYER_OVERLAP_MIN_M2 = 10_000;

export interface CharterLayerOverlap {
  /** 同层重叠（①①、②②、③③）是 `AREA_LAYER_OVERLAP`；①和③重叠是 `AREA_BASE_SURCHARGE_OVERLAP` */
  code: "AREA_LAYER_OVERLAP" | "AREA_BASE_SURCHARGE_OVERLAP";
  layer: "base" | "itinerary" | "pickup_dropoff" | "base_pickup_dropoff";
  a: string;
  b: string;
  areaM2: number;
}

/**
 * 一个包车商品的三层区域里，这次新加的区域碰出来的重叠：同一层（①基础价、②行程、③上下车加价）两两不能重叠，①和③不能重叠；①②、②③可以。
 * `layers` 是保存之后各层的区域编号；`added` 是这次新加进各层的（已有的重叠不回头拦，ADR 0093 第七节第 6 条：那些列进迁移报告，由运营处理）。
 * 同一个区域既在①又在③由 `AREA_IS_PRODUCT_AREA` 管，这里不算。不看区域的用途和业务类型（同一个商品里的区域都会被同时用到）；停用的区域不算。
 */
export function charterLayerOverlaps(
  shapes: readonly OverlapAreaInput[],
  layers: { base: readonly string[]; itinerary: readonly string[]; updown: readonly string[] },
  added: { base?: readonly string[]; itinerary?: readonly string[]; updown?: readonly string[] },
): CharterLayerOverlap[] {
  const inputs = (ids: readonly string[]): OverlapAreaInput[] => shapes.filter((shape) => ids.includes(shape.id)).map((shape) => ({ ...shape, role: "pricing" as const, bizType: "charter" as const }));
  const pairsOf = (ids: readonly string[]) => (ids.length < 2 ? [] : findAreaOverlaps(inputs([...new Set(ids)])).pairs.filter((pair) => pair.areaM2 >= CHARTER_LAYER_OVERLAP_MIN_M2));
  const result: CharterLayerOverlap[] = [];
  const same = [
    ["base", layers.base, added.base ?? []],
    ["itinerary", layers.itinerary, added.itinerary ?? []],
    ["pickup_dropoff", layers.updown, added.updown ?? []],
  ] as const;
  for (const [layer, ids, fresh] of same) {
    if (fresh.length === 0) continue;
    for (const pair of pairsOf(ids)) if (fresh.includes(pair.a) || fresh.includes(pair.b)) result.push({ code: "AREA_LAYER_OVERLAP", layer, a: pair.a, b: pair.b, areaM2: pair.areaM2 });
  }
  const freshBase = added.base ?? [];
  const freshUpdown = added.updown ?? [];
  if (freshBase.length + freshUpdown.length > 0) {
    for (const pair of pairsOf([...layers.base, ...layers.updown])) {
      const [base, updown] = layers.base.includes(pair.a) && layers.updown.includes(pair.b) && !layers.base.includes(pair.b) ? [pair.a, pair.b] : layers.base.includes(pair.b) && layers.updown.includes(pair.a) && !layers.base.includes(pair.a) ? [pair.b, pair.a] : [null, null];
      if (base === null || updown === null) continue;
      if (freshBase.includes(base) || freshUpdown.includes(updown)) result.push({ code: "AREA_BASE_SURCHARGE_OVERLAP", layer: "base_pickup_dropoff", a: base, b: updown, areaM2: pair.areaM2 });
    }
  }
  return result;
}

/** 包车三层区域里不允许的重叠（同层、①和③）的一小块：形状（画在地图上标红）和是哪种。 */
export interface CharterLayerConflictPiece extends AreaOverlapPiece {
  layer: CharterLayerOverlap["layer"];
}

/**
 * 一个包车商品三层区域里**全部**不允许的重叠部分（M9P-13「在地图上看全部」标红）：同层（①①、②②、③③）和①∩③，和保存校验同一个口径
 * （`charterLayerOverlaps`：不看用途和业务类型、停用的不算、小于 0.01 平方公里的不算），只是不分新旧——已有的重叠也画出来。
 * 同一个区域既在①又在③的（`AREA_IS_PRODUCT_AREA` 管）不算①∩③。
 */
export function charterLayerConflictPieces(shapes: readonly OverlapAreaInput[], layers: { base: readonly string[]; itinerary: readonly string[]; updown: readonly string[] }): CharterLayerConflictPiece[] {
  const inputs = (ids: readonly string[]): OverlapAreaInput[] => shapes.filter((shape) => ids.includes(shape.id)).map((shape) => ({ ...shape, role: "pricing" as const, bizType: "charter" as const }));
  const overlapsOf = (ids: readonly string[]) => {
    const found = findAreaOverlaps(inputs([...new Set(ids)]));
    const big = new Set(found.pairs.filter((pair) => pair.areaM2 >= CHARTER_LAYER_OVERLAP_MIN_M2).map((pair) => `${pair.a}|${pair.b}`));
    return { pieces: found.pieces, has: (a: string, b: string): boolean => big.has(`${a}|${b}`) || big.has(`${b}|${a}`) };
  };
  const result: CharterLayerConflictPiece[] = [];
  for (const [layer, ids] of [["base", layers.base], ["itinerary", layers.itinerary], ["pickup_dropoff", layers.updown]] as const) {
    if (ids.length < 2) continue;
    const { pieces, has } = overlapsOf(ids);
    for (const piece of pieces) {
      const involved = piece.areaIds.filter((id) => piece.areaIds.some((other) => other !== id && has(id, other)));
      if (involved.length >= 2) result.push({ layer, areaIds: involved, ring: piece.ring });
    }
  }
  if (layers.base.length > 0 && layers.updown.length > 0) {
    const { pieces, has } = overlapsOf([...layers.base, ...layers.updown]);
    const isBase = (id: string): boolean => layers.base.includes(id);
    const isUpdown = (id: string): boolean => layers.updown.includes(id) && !layers.base.includes(id);
    const clash = (a: string, b: string): boolean => ((isBase(a) && isUpdown(b)) || (isUpdown(a) && isBase(b))) && has(a, b);
    for (const piece of pieces) {
      const involved = piece.areaIds.filter((id) => piece.areaIds.some((other) => other !== id && clash(id, other)));
      if (involved.length >= 2) result.push({ layer: "base_pickup_dropoff", areaIds: involved, ring: piece.ring });
    }
  }
  return result;
}

// ---- 从本区域减去另一个区域（M9P-13，规格第四节第 3 小节；ADR 0093 第七节「后续」）----

/** 参与减法的一块图形（区域的营运区、禁行区）。 */
export interface SubtractShape {
  kind: AreaPolygonKind;
  ring: readonly Position[];
}

export type AreaSubtractResult =
  | {
      ok: true;
      /** 碰到另一个区域的营运区块合起来减掉之后的新多边形（逆时针、不闭合、六位小数） */
      rings: Position[][];
      /** 没碰到另一个区域的营运区块（输入里的下标）：原样保留（圆还是圆）；禁行区一律原样保留 */
      keptIndexes: number[];
      /** 切掉了多少平方米（本区域营运区和另一个区域真正报价范围的公共部分） */
      removedM2: number;
      /** 另一个区域在本区域中间、减完会留下洞（区域的图形不能带洞）：已在洞的位置竖着切开，所以多出了几块 */
      split: boolean;
    }
  /**
   * `NO_OVERLAP`：两个区域没有重叠（不到 100 平方米）；`NOTHING_LEFT`：本区域的营运区整个在另一个区域里，减完什么都不剩；
   * `TOO_COMPLEX`：减完的图形超出区域的上限（块数、点数），或成不了合法的多边形（极细的缝）——请手工处理
   */
  | { ok: false; reason: "NO_OVERLAP" | "NOTHING_LEFT" | "TOO_COMPLEX" };

/** 坐标精度：和保存时一样，六位小数（areas.ts 的 round6） */
const SUBTRACT_MICRO = 1_000_000;
/** 竖着切开带洞的图形最多试几轮（每轮把每个洞从中间切开；切开不会产生新的洞，一轮就够，多两轮是保险） */
const SUBTRACT_MAX_ROUNDS = 3;

type MicroPoint = [number, number];
type DirectedEdge = { from: MicroPoint; to: MicroPoint };

const pointKey = (point: MicroPoint): string => `${point[0]},${point[1]}`;

/**
 * 互不重叠的一组竖条梯形（逆时针四个点）合起来的边界：竖边按全部端点拆成小段、向上向下相互抵消，横边方向相反的相互抵消；
 * 剩下的有向边连成一圈圈（逆时针 = 外圈，顺时针 = 洞）。一个点上有几条出边时（两块只碰一个角）取最往左拐的那条，一圈只围一块。
 */
function traceTrapezoids(trapezoids: readonly MicroPoint[][]): MicroPoint[][] {
  const segments = new Map<string, DirectedEdge & { count: number }>();
  const add = (from: MicroPoint, to: MicroPoint): void => {
    if (from[0] === to[0] && from[1] === to[1]) return;
    const reverse = segments.get(`${pointKey(to)}>${pointKey(from)}`);
    if (reverse !== undefined) {
      reverse.count -= 1;
      if (reverse.count === 0) segments.delete(`${pointKey(to)}>${pointKey(from)}`);
      return;
    }
    const key = `${pointKey(from)}>${pointKey(to)}`;
    const entry = segments.get(key);
    if (entry === undefined) segments.set(key, { from, to, count: 1 });
    else entry.count += 1;
  };
  const verticals = new Map<number, { low: number; high: number; up: boolean }[]>();
  const vertical = (x: number, low: number, high: number, up: boolean): void => {
    if (high > low) verticals.set(x, [...(verticals.get(x) ?? []), { low, high, up }]);
  };
  for (const ring of trapezoids) {
    const [bottomLeft, bottomRight, topRight, topLeft] = ring as [MicroPoint, MicroPoint, MicroPoint, MicroPoint];
    if (bottomLeft[0] === bottomRight[0]) continue;
    add(bottomLeft, bottomRight);
    add(topRight, topLeft);
    vertical(bottomRight[0], bottomRight[1], topRight[1], true);
    vertical(bottomLeft[0], bottomLeft[1], topLeft[1], false);
  }
  for (const [x, list] of verticals) {
    const ys = [...new Set(list.flatMap((entry) => [entry.low, entry.high]))].sort((a, b) => a - b);
    for (let i = 0; i + 1 < ys.length; i += 1) {
      const y0 = ys[i] as number;
      const y1 = ys[i + 1] as number;
      let net = 0;
      for (const entry of list) if (entry.low <= y0 && entry.high >= y1) net += entry.up ? 1 : -1;
      for (let k = 0; k < Math.abs(net); k += 1) add(net > 0 ? [x, y0] : [x, y1], net > 0 ? [x, y1] : [x, y0]);
    }
  }
  const outgoing = new Map<string, DirectedEdge[]>();
  for (const { from, to, count } of segments.values()) {
    for (let k = 0; k < count; k += 1) outgoing.set(pointKey(from), [...(outgoing.get(pointKey(from)) ?? []), { from, to }]);
  }
  const rings: MicroPoint[][] = [];
  let budget = [...outgoing.values()].reduce((sum, list) => sum + list.length, 0) + 1;
  for (const start of outgoing.keys()) {
    while ((outgoing.get(start)?.length ?? 0) > 0) {
      const first = (outgoing.get(start) as DirectedEdge[]).shift() as DirectedEdge;
      const ring: MicroPoint[] = [first.from];
      let current = first;
      while (!(current.to[0] === first.from[0] && current.to[1] === first.from[1]) && budget > 0) {
        budget -= 1;
        ring.push(current.to);
        const options = outgoing.get(pointKey(current.to)) ?? [];
        if (options.length === 0) break;
        const dx = current.to[0] - current.from[0];
        const dy = current.to[1] - current.from[1];
        let best = 0;
        let bestTurn = -Infinity;
        options.forEach((option, index) => {
          const ox = option.to[0] - option.from[0];
          const oy = option.to[1] - option.from[1];
          const turn = Math.atan2(dx * oy - dy * ox, dx * ox + dy * oy);
          if (turn > bestTurn) {
            bestTurn = turn;
            best = index;
          }
        });
        current = options.splice(best, 1)[0] as DirectedEdge;
      }
      rings.push(ring);
    }
  }
  return rings;
}

/** 去掉重复的点，和离前后两点连线不到一个最小单位（约 0.1 米）的点：竖条切出来的中间点、取整带来的细小折线 */
function cleanRing(ring: readonly MicroPoint[]): MicroPoint[] {
  let points = [...ring];
  let changed = true;
  while (changed && points.length >= 3) {
    changed = false;
    const kept: MicroPoint[] = [];
    for (let i = 0; i < points.length; i += 1) {
      const before = kept.length > 0 ? (kept[kept.length - 1] as MicroPoint) : (points[points.length - 1] as MicroPoint);
      const point = points[i] as MicroPoint;
      const after = points[(i + 1) % points.length] as MicroPoint;
      const cross = (point[0] - before[0]) * (after[1] - before[1]) - (point[1] - before[1]) * (after[0] - before[0]);
      if ((point[0] === before[0] && point[1] === before[1]) || Math.abs(cross) <= Math.hypot(after[0] - before[0], after[1] - before[1])) {
        changed = true;
        continue;
      }
      kept.push(point);
    }
    points = kept;
  }
  return points;
}

/** 有向面积的两倍（逆时针为正，单位：最小单位的平方） */
function twiceArea(ring: readonly MicroPoint[]): number {
  let sum = 0;
  ring.forEach((point, i) => {
    const next = ring[(i + 1) % ring.length] as MicroPoint;
    sum += point[0] * next[1] - next[0] * point[1];
  });
  return sum;
}

function microRingM2(ring: readonly MicroPoint[]): number {
  const lat = ring.reduce((sum, point) => sum + point[1], 0) / ring.length / SUBTRACT_MICRO;
  return (Math.abs(twiceArea(ring)) / 2 / (SUBTRACT_MICRO * SUBTRACT_MICRO)) * METERS_PER_DEGREE * METERS_PER_DEGREE * Math.cos((lat * Math.PI) / 180);
}

/**
 * 从本区域减去另一个区域（M9P-13）：本区域的营运区减去另一个区域「真正报价的范围」（它的营运区减去它自己的禁行区）。
 * - 本区域的禁行区不动；营运区里碰不到另一个区域的块原样保留（`keptIndexes`），碰到的几块合起来减掉、换成新的多边形（`rings`）；
 * - 和重叠用同一个竖条分解，结果精确（误差只来自浮点数），坐标取六位小数（和保存时一样）；
 * - 区域的图形不能带洞：减完会留下洞时，在每个洞的位置竖着切开（`split`）。
 * 纯计算：页面拿结果换掉编辑器里的图形，用户照常保存（保存时照常校验）。
 */
export function subtractAreaRange(base: readonly SubtractShape[], cutter: readonly SubtractShape[]): AreaSubtractResult {
  const cutterInput: OverlapAreaInput = { id: "cut", bizType: "general", active: true, polygons: cutter.filter((shape) => shape.ring.length >= 3) };
  const operate = base.flatMap((shape, index) => (shape.kind === "operate" && shape.ring.length >= 3 ? [{ shape, index }] : []));
  const touched = operate.filter(({ shape }) => findAreaOverlaps([{ id: "base", bizType: "general", active: true, polygons: [{ kind: "operate", ring: shape.ring }] }, cutterInput]).pairs.length > 0);
  if (touched.length === 0) return { ok: false, reason: "NO_OVERLAP" };
  const keptIndexes = operate.filter(({ index }) => !touched.some((entry) => entry.index === index)).map(({ index }) => index);
  const baseInput: OverlapAreaInput = { id: "base", bizType: "general", active: true, polygons: touched.map(({ shape }) => ({ kind: "operate" as const, ring: shape.ring })) };
  const snap = (value: number): number => Math.round(value * SUBTRACT_MICRO);

  const cuts: number[] = [];
  for (let round = 0; round < SUBTRACT_MAX_ROUNDS; round += 1) {
    let removed = 0;
    // 按切开的位置分组：同一组的梯形连成边界，组与组之间的竖边不抵消（就是切开的缝）
    const bands = new Map<number, MicroPoint[][]>();
    sweepSpans(
      [baseInput, cutterInput],
      (spans) => {
        for (const span of spans) if (span.ids.includes(0) && span.ids.includes(1)) removed += span.m2;
        const band = cuts.filter((cut) => cut <= (spans[0]?.xa ?? 0) + EPSILON).length;
        mergeSpans(
          spans,
          (span) => (span.ids.includes(0) && !span.ids.includes(1) ? "kept" : ""),
          (_key, ring) => bands.set(band, [...(bands.get(band) ?? []), ring.map(([x, y]) => [snap(x), snap(y)] as MicroPoint)]),
        );
      },
      cuts,
    );
    const outer: MicroPoint[][] = [];
    const holes: MicroPoint[][] = [];
    for (const group of bands.values()) {
      for (const raw of traceTrapezoids(group)) {
        const ring = cleanRing(raw);
        if (ring.length < 3 || microRingM2(ring) < AREA_OVERLAP_MIN_M2) continue;
        (twiceArea(ring) > 0 ? outer : holes).push(ring);
      }
    }
    if (holes.length > 0) {
      for (const hole of holes) {
        const xs = hole.map((point) => point[0]);
        cuts.push((Math.min(...xs) + Math.max(...xs)) / 2 / SUBTRACT_MICRO);
      }
      continue;
    }
    if (outer.length === 0 && keptIndexes.length === 0) return { ok: false, reason: "NOTHING_LEFT" };
    const rings = outer.map((ring) => ring.map(([x, y]) => [x / SUBTRACT_MICRO, y / SUBTRACT_MICRO] as Position));
    const blocks = rings.length + keptIndexes.length + base.filter((shape) => shape.kind === "forbid").length;
    if (blocks > AREA_LIMITS.maxPolygons || rings.some((ring) => ringIssues(ring).length > 0)) return { ok: false, reason: "TOO_COMPLEX" };
    return { ok: true, rings, keptIndexes, removedM2: Math.round(removed), split: cuts.length > 0 };
  }
  return { ok: false, reason: "TOO_COMPLEX" };
}
