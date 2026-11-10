/**
 * 区域之间的重叠（M8-18，ADR 0074）：一个供应商的几个区域在地图上哪里叠在一起、叠了多大。
 *
 * **什么算重叠**（定义写在 ADR 0074 和 tenant-areas.md 第 19 节，前后端、页面文案都按这里）：
 * - 一个区域「真正报价的范围」= 它的营运区合起来，减去它自己的禁行区（禁行区只管它所在的区域，tenant-areas.md 第 17 节第 2 条）；
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
import type { AreaBizType, AreaPolygonKind, Position } from "./areas.ts";

/** 公共部分不到这么多平方米的不算重叠（10 米 × 10 米）。 */
export const AREA_OVERLAP_MIN_M2 = 100;

const METERS_PER_DEGREE = 111_320;
const EPSILON = 1e-12;

export interface OverlapAreaInput {
  id: string;
  bizType: AreaBizType;
  /** 停用的区域不参与 */
  active: boolean;
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

/** 区域之间的重叠：哪几对重叠、各重叠多少平方米、重叠部分的形状（画在地图上）。 */
export function findAreaOverlaps(areas: readonly OverlapAreaInput[]): AreaOverlapResult {
  const live = areas.filter((area) => area.active && area.polygons.some((polygon) => polygon.kind === "operate" && polygon.ring.length >= 3));
  // 每个区域营运区的外框；外框和任何一个能竞争的区域都碰不到的区域不用算
  const boxes = live.map((area) => {
    const operate = area.polygons.filter((polygon) => polygon.kind === "operate" && polygon.ring.length >= 3).map((polygon) => ringBox(polygon.ring));
    return operate.reduce((all, box) => ({ minX: Math.min(all.minX, box.minX), minY: Math.min(all.minY, box.minY), maxX: Math.max(all.maxX, box.maxX), maxY: Math.max(all.maxY, box.maxY) }));
  });
  const candidate = live.map((area, i) => live.some((other, j) => j !== i && areasCanCompete(area.bizType, other.bizType) && boxesMeet(boxes[i] as Box, boxes[j] as Box)));
  const used = live.filter((_, i) => candidate[i]);
  const empty: AreaOverlapResult = { pairs: [], pieces: [], byArea: new Map() };
  if (used.length < 2) return empty;

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

  const pairArea = new Map<string, number>();
  const rawPieces: { key: string; ids: number[]; ring: Position[] }[] = [];
  const inside = new Array<boolean>(polygonArea.length).fill(false);
  const operateCount = new Array<number>(used.length).fill(0);
  const forbidCount = new Array<number>(used.length).fill(0);
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
    const scale = METERS_PER_DEGREE * METERS_PER_DEGREE;
    // 正在往上长的一块：从哪条边开始、属于哪组区域
    let open: { key: string; ids: number[]; lowA: number; lowB: number } | undefined;
    for (let k = 0; k < ordered.length; k += 1) {
      const current = ordered[k] as (typeof ordered)[number];
      const polygon = current.edge.polygon;
      const areaIndex = polygonArea[polygon] as number;
      const counts = polygonForbid[polygon] ? forbidCount : operateCount;
      inside[polygon] = !inside[polygon];
      counts[areaIndex] = (counts[areaIndex] as number) + (inside[polygon] ? 1 : -1);
      // 这条边和上面一条边之间：哪些区域「真正报价」、其中哪几对能竞争
      const above = ordered[k + 1];
      const ids: number[] = [];
      if (above !== undefined) for (let a = 0; a < used.length; a += 1) if ((operateCount[a] as number) > 0 && forbidCount[a] === 0) ids.push(a);
      const competing: [number, number][] = [];
      for (let i = 0; i < ids.length; i += 1) {
        for (let j = i + 1; j < ids.length; j += 1) {
          if (areasCanCompete((used[ids[i] as number] as OverlapAreaInput).bizType, (used[ids[j] as number] as OverlapAreaInput).bizType)) competing.push([ids[i] as number, ids[j] as number]);
        }
      }
      const key = competing.length === 0 ? "" : ids.join(",");
      // 换了一组区域（或到了顶）：上一块在这条边收口
      if (open !== undefined && open.key !== key) {
        rawPieces.push({ key: open.key, ids: open.ids, ring: [[xa, open.lowA], [xb, open.lowB], [xb, current.yb], [xa, current.ya]] });
        open = undefined;
      }
      if (above === undefined || competing.length === 0) continue;
      const height = (above.ya - current.ya + (above.yb - current.yb)) / 2;
      if (height > 0) {
        const m2 = (xb - xa) * height * scale * Math.cos((current.ym + above.ym) * (Math.PI / 360));
        for (const [i, j] of competing) pairArea.set(`${i},${j}`, (pairArea.get(`${i},${j}`) ?? 0) + m2);
      }
      // 和下面一块是同一组区域：接着往上长，不另起一块（地图上少画很多条缝）
      open ??= { key, ids, lowA: current.ya, lowB: current.yb };
    }
  }

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
