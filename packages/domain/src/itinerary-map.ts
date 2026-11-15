/**
 * 包车行程地图（M9P-20 P1，ADR 0096 第二节）：上车 = 1、经停依次、下车 = 最后的编号，和多点静态路线图的参数。
 * 这里只有不碰网络和数据库的规则：
 * - 编号：地图标记和页面列表用同一个函数（`stopNumbers`）；接口和数据里的经停序号（stopSeq，经停里的第几个，从 1 起）不改，
 *   页面展示一律经 `displayStopNumber` 换算（= stopSeq + 1）；
 * - 多点图的缓存键（有序点列，每个点按 `routeCacheKey` 的规则取整）；
 * - 谷歌静态地图的查询参数（**不含密钥**）：品牌色路线，1–9 用谷歌内置的单字符 `label`，10–12 用本站公开路径上的自定义图标
 *   （谷歌限每个请求最多 5 种自定义图标，这里最多 3 种）；网址太长时逐段抽稀折线，标记的点位不动。
 * 调用谷歌、缓存和计数在 `apps/api/src/services/static-maps.ts` 和 `apps/api/src/services/itinerary-polylines.ts`。
 */
import { type LatLng, isValidLatLng } from "./geo.ts";
import { routeCoordinateText } from "./route-estimate.ts";
import { STATIC_MAP_PALETTES, STATIC_MAP_RULES, type StaticMapSize, type StaticMapTheme, decodePolyline, encodePolyline, isStaticMapSize, staticMapStyles } from "./static-map.ts";

const DAY_MS = 24 * 3_600_000;

/** 多点路线图的规则（ADR 0096 第二节第 2 小节）。 */
export const ITINERARY_MAP_RULES = {
  /** 最少、最多几个点：上车 + 最多 10 个经停 + 下车 */
  minPoints: 2,
  maxPoints: 12,
  /** 谷歌内置的标记文字只支持一个字符：1–9 用 `label`，从这个编号起用自定义图标 */
  firstIconNumber: 10,
  /** 一次带中间点取到的折线（经纬度）在库里保留多久：7 天，和路线缓存一样（ADR 0096 第二节第 2 小节第 2 步） */
  polylineCacheTtlMs: 7 * DAY_MS,
  /** 自定义标记图标在官网静态目录里的路径（`/map-markers/10.png`）：谷歌的服务器去取，必须公网可直接访问 */
  markerIconPath: "/map-markers",
} as const;

/** 行程里一个点的类型：上车、经停、下车。 */
export type ItineraryStopKind = "pickup" | "stop" | "dropoff";

/** 编号后的一个点：`number` 从 1 起（上车 = 1）；`stopSeq` 只有经停才有（经停里的第几个，从 1 起，接口和数据里用的序号）。 */
export interface NumberedStop<T> {
  number: number;
  kind: ItineraryStopKind;
  stopSeq: number | null;
  point: T;
}

/**
 * 行程的编号（ADR 0096 第二节第 3 小节）：上车 = 1，经停依次 2…N+1，下车 = N+2。地图标记和列表都用它，编号只来自顺序、不另存。
 * `points` 按行程顺序：第一个是上车；`hasDropoff` 为 true（默认）时最后一个是下车（没有下车点的旧订单传 false，其余都是经停）。
 */
export function stopNumbers<T>(points: readonly T[], options: { hasDropoff?: boolean } = {}): NumberedStop<T>[] {
  const hasDropoff = options.hasDropoff ?? true;
  return points.map((point, index) => {
    const kind: ItineraryStopKind = index === 0 ? "pickup" : hasDropoff && index === points.length - 1 ? "dropoff" : "stop";
    return { number: index + 1, kind, stopSeq: kind === "stop" ? index : null, point };
  });
}

/** 接口里的经停序号（stopSeq，经停里的第几个，从 1 起）→ 页面显示的编号（上车占了 1）：stopSeq + 1。明细、报不出提示都经过它。 */
export function displayStopNumber(stopSeq: number): number {
  if (!Number.isInteger(stopSeq) || stopSeq < 1) throw new RangeError("经停序号从 1 起");
  return stopSeq + 1;
}

/** 第几段（`details.leg`，从 1 起）的起点、终点编号：第 N 段从 N 号点到 N + 1 号点。 */
export function legStopNumbers(leg: number): [number, number] {
  if (!Number.isInteger(leg) || leg < 1) throw new RangeError("段号从 1 起");
  return [leg, leg + 1];
}

export interface ItineraryPointsKey {
  /** `i1:纬度,经度>纬度,经度>…`（每个点取整到 3 位小数，有序） */
  key: string;
  /** 取整后的点：调谷歌也用它们，保证同一个键的折线来自同一组坐标 */
  points: LatLng[];
  /** 取整后所有点都是同一个点：画不了路线 */
  samePoint: boolean;
}

/** 点数在不在范围里、坐标是否都有效。 */
export function isItineraryPointList(points: readonly LatLng[]): boolean {
  return points.length >= ITINERARY_MAP_RULES.minPoints && points.length <= ITINERARY_MAP_RULES.maxPoints && points.every(isValidLatLng);
}

/** 有序点列的缓存键（折线和图都用它）：顺序不同就是不同的键（编号跟着顺序走）。 */
export function itineraryPointsKey(points: readonly LatLng[]): ItineraryPointsKey {
  if (!isItineraryPointList(points)) throw new RangeError("行程点数不在 2–12 个之间或坐标无效");
  const texts = points.map((point) => [routeCoordinateText(point.lat), routeCoordinateText(point.lng)] as const);
  const first = texts[0] as readonly [string, string];
  return {
    key: `i1:${texts.map(([lat, lng]) => `${lat},${lng}`).join(">")}`,
    points: texts.map(([lat, lng]) => ({ lat: Number(lat), lng: Number(lng) })),
    samePoint: texts.every(([lat, lng]) => lat === first[0] && lng === first[1]),
  };
}

/**
 * 编号标记的颜色（不带 #）：和页面行程列表的编号同一个令牌 `--color-text-link`（亮色 #2A45B0、暗色 #A9BBFF），两边亮暗都对得上
 * （M9P-20 审查：暗色时列表和标记深浅不能反过来）。上车、下车是谷歌默认大小的标记（列表里是实心圆），经停是中号标记（列表里是空心圆）：
 * 除了颜色还有大小 / 填充的区别，旁边列表有文字。亮色 #2A45B0 在灰底 #F4F5F7 上、暗色 #A9BBFF 在 #1E232C 上都清楚；标记里的数字由谷歌画。
 */
export const ITINERARY_MARKER_COLORS: Readonly<Record<StaticMapTheme, string>> = { light: "2A45B0", dark: "A9BBFF" };

/** 第 `number` 号点的自定义图标网址（10–12）：`<官网地址>/map-markers/10.png`。 */
export function markerIconUrl(siteBaseUrl: string, number: number): string {
  return `${siteBaseUrl.replace(/\/+$/, "")}${ITINERARY_MAP_RULES.markerIconPath}/${number}.png`;
}

const coordinate = (point: LatLng): string => `${point.lat.toFixed(5)},${point.lng.toFixed(5)}`;

/** 每个点的 `markers` 参数（编号来自 `stopNumbers`）：1–9 用 `label`，10 起用自定义图标（居中对齐）。 */
export function itineraryMarkers(points: readonly LatLng[], theme: StaticMapTheme, siteBaseUrl: string): string[] {
  const color = ITINERARY_MARKER_COLORS[theme];
  return stopNumbers(points).map(({ number, kind, point }) => {
    if (number >= ITINERARY_MAP_RULES.firstIconNumber) return `anchor:center|icon:${markerIconUrl(siteBaseUrl, number)}|${coordinate(point)}`;
    const style = kind === "stop" ? `size:mid|color:0x${color}` : `color:0x${color}`;
    return `${style}|label:${number}|${coordinate(point)}`;
  });
}

/** 每隔 `stride` 个点留一个，第一个和最后一个一定留下。 */
function thin(points: readonly LatLng[], stride: number): LatLng[] {
  if (stride <= 1) return [...points];
  const kept = points.filter((_, i) => i % stride === 0);
  const last = points[points.length - 1] as LatLng;
  if (kept[kept.length - 1] !== last) kept.push(last);
  return kept;
}

/**
 * 多点路线图的查询参数（**不含密钥**）：尺寸、倍率、PNG、中文地名、灰色调样式、品牌色路线和编号标记。
 * `polylines` 是逐段的折线（谷歌 `routes.legs[].polyline`），也可以只有一条整条路线的折线；每段各自抽稀（每段的头尾不动），拼成一条 `path`。
 * 网址超过 `STATIC_MAP_RULES.maxQueryLength` 时加倍抽稀直到放得下；标记的点位一直是行程点本身，不随折线移动。
 * 尺寸不对、点数不对、折线看不懂或少于 2 个点、怎么抽稀都放不下时为 null。
 */
export function itineraryMapQuery(polylines: readonly string[], points: readonly LatLng[], size: StaticMapSize, siteBaseUrl: string): string | null {
  if (!isStaticMapSize(size) || !isItineraryPointList(points) || polylines.length === 0) return null;
  const legs: LatLng[][] = [];
  for (const encoded of polylines) {
    const decoded = decodePolyline(encoded);
    if (decoded === null || decoded.length < 2) return null;
    legs.push(decoded);
  }
  const palette = STATIC_MAP_PALETTES[size.theme];
  const markers = itineraryMarkers(points, size.theme, siteBaseUrl);
  const longest = Math.max(...legs.map((leg) => leg.length));
  const build = (stride: number): string => {
    const path: LatLng[] = [];
    for (const leg of legs) path.push(...thin(leg, stride).slice(path.length === 0 ? 0 : 1));
    const params = new URLSearchParams();
    params.append("size", `${size.width}x${size.height}`);
    params.append("scale", String(size.scale));
    params.append("format", "png");
    params.append("maptype", "roadmap");
    params.append("language", "zh-CN");
    for (const style of staticMapStyles(size.theme)) params.append("style", style);
    params.append("path", `color:0x${palette.route}ff|weight:5|enc:${encodePolyline(path)}`);
    for (const marker of markers) params.append("markers", marker);
    return params.toString();
  };
  let query = build(1);
  for (let stride = 2; query.length > STATIC_MAP_RULES.maxQueryLength && stride <= longest * 2; stride *= 2) query = build(stride);
  return query.length <= STATIC_MAP_RULES.maxQueryLength ? query : null;
}
