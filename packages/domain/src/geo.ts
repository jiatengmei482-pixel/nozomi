/**
 * 地理计算。区域判断在应用层完成（见 docs/adr/0002-geo-in-application.md）。
 *
 * 坐标约定：
 * - 业务对象一律用 { lat, lng }（WGS84，度）。
 * - GeoJSON 按标准使用 [lng, lat] 顺序，只在 GeoJSON 结构里出现。
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface GeoJsonPolygon {
  type: "Polygon";
  /** 第一个环是外边界，其余是洞；每个环首尾点相同。 */
  coordinates: [number, number][][];
}

export interface GeoJsonMultiPolygon {
  type: "MultiPolygon";
  coordinates: [number, number][][][];
}

export type AreaShape =
  | { kind: "circle"; center: LatLng; radiusMeters: number }
  | { kind: "polygon"; geometry: GeoJsonPolygon | GeoJsonMultiPolygon };

const EARTH_RADIUS_METERS = 6_371_008.8;

export function isValidLatLng(p: LatLng): boolean {
  return (
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    p.lat >= -90 &&
    p.lat <= 90 &&
    p.lng >= -180 &&
    p.lng <= 180
  );
}

export function assertLatLng(p: LatLng): void {
  if (!isValidLatLng(p)) throw new RangeError(`无效坐标：lat=${p.lat}, lng=${p.lng}`);
}

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** 球面大圆距离（米）。用于区域判断和兜底估算，不用于计价（计价里程来自谷歌地图路线）。 */
export function haversineMeters(a: LatLng, b: LatLng): number {
  assertLatLng(a);
  assertLatLng(b);
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 射线法判断点是否在一个环内（不含洞）。边界上的点按「在内」处理，避免区域交界处漏报。 */
function inRing(p: LatLng, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as [number, number];
    const [xj, yj] = ring[j] as [number, number];
    if (onSegment(p, xi, yi, xj, yj)) return true;
    const crosses = yi > p.lat !== yj > p.lat && p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

function onSegment(p: LatLng, x1: number, y1: number, x2: number, y2: number): boolean {
  const eps = 1e-12;
  const cross = (p.lng - x1) * (y2 - y1) - (p.lat - y1) * (x2 - x1);
  if (Math.abs(cross) > eps) return false;
  return (
    p.lng >= Math.min(x1, x2) - eps &&
    p.lng <= Math.max(x1, x2) + eps &&
    p.lat >= Math.min(y1, y2) - eps &&
    p.lat <= Math.max(y1, y2) + eps
  );
}

function inPolygonRings(p: LatLng, rings: [number, number][][]): boolean {
  const [outer, ...holes] = rings;
  if (!outer || !inRing(p, outer)) return false;
  return !holes.some((hole) => inRing(p, hole) && !onAnySegment(p, hole));
}

function onAnySegment(p: LatLng, ring: [number, number][]): boolean {
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as [number, number];
    const [xj, yj] = ring[j] as [number, number];
    if (onSegment(p, xi, yi, xj, yj)) return true;
  }
  return false;
}

export function pointInPolygon(p: LatLng, geometry: GeoJsonPolygon | GeoJsonMultiPolygon): boolean {
  assertLatLng(p);
  if (geometry.type === "Polygon") return inPolygonRings(p, geometry.coordinates);
  return geometry.coordinates.some((poly) => inPolygonRings(p, poly));
}

export function pointInArea(p: LatLng, area: AreaShape): boolean {
  if (area.kind === "circle") return haversineMeters(p, area.center) <= area.radiusMeters;
  return pointInPolygon(p, area.geometry);
}

/** 校验多边形：外环至少 4 个点且首尾闭合，坐标合法。返回问题列表，空数组表示通过。 */
export function validatePolygon(geometry: GeoJsonPolygon | GeoJsonMultiPolygon): string[] {
  const polys = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const issues: string[] = [];
  if (polys.length === 0) issues.push("多边形为空");
  polys.forEach((rings, pi) => {
    if (rings.length === 0) issues.push(`第 ${pi + 1} 个多边形没有外环`);
    rings.forEach((ring, ri) => {
      const name = `第 ${pi + 1} 个多边形的第 ${ri + 1} 个环`;
      if (ring.length < 4) issues.push(`${name}至少需要 4 个点（首尾相同）`);
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (first && last && (first[0] !== last[0] || first[1] !== last[1])) issues.push(`${name}首尾点不一致`);
      if (ring.some(([lng, lat]) => !isValidLatLng({ lat, lng }))) issues.push(`${name}含无效坐标`);
    });
  });
  return issues;
}

/**
 * 离某个点最近的几个候选（球面距离），只要 `maxMeters` 以内的，由近到远，最多 `limit` 个。
 * 距离相同的保持候选原来的先后。坐标不合法的候选被忽略。
 */
export function nearestWithin<T extends LatLng>(origin: LatLng, candidates: readonly T[], maxMeters: number, limit: number): { item: T; meters: number }[] {
  if (!isValidLatLng(origin)) return [];
  return candidates
    .filter(isValidLatLng)
    .map((item) => ({ item, meters: haversineMeters(origin, item) }))
    .filter((entry) => entry.meters <= maxMeters)
    .sort((x, y) => x.meters - y.meters)
    .slice(0, limit);
}
