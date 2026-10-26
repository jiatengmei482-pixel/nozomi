/**
 * 官网的地址搜索和坐标反查（M3-12，ADR 0044）：客人按关键字找地点、在地图上点一个位置后查它的地址。
 * 后端代客人调谷歌地图（Places API (New) Text Search、Geocoding API 反查），密钥不进浏览器。
 * 这里只有不碰网络和数据库的规则：关键字的规范化和长短、缓存键（城市 + 关键字、坐标取整）、城市附近的范围、
 * 哪些失败冷却多久、给客人看的文字怎么清理。调用谷歌在 `apps/api/src/integrations/google-places.ts`，缓存、计数在 `apps/api/src/services/place-search.ts`。
 */
import { type LatLng, isValidLatLng } from "./geo.ts";
import { routeCoordinateText } from "./route-estimate.ts";

const MINUTE_MS = 60_000;

/** 地址搜索和反查的规则（推荐值，ADR 0044「待负责人确认」）。 */
export const PLACE_SEARCH_RULES = {
  /** 关键字至少几个字（规范化后，按字符数）：一个字（「站」「の」）搜不出有用的结果，白花一次钱 */
  queryMinLength: 2,
  /** 关键字最多几个字 */
  queryMaxLength: 100,
  /** 一次最多给几个候选：手机一屏放得下，谷歌按条计费的档次和条数无关 */
  maxResults: 5,
  /** 搜索只在城市中心周围这么远（公里，正方形的半边长）以内：成田机场离东京站约 60 公里 */
  cityReachKm: 80,
  /** 反查前坐标取整到小数点后几位：4 位 ≈ 11 米，同一栋楼的几次点选共用一次查询 */
  reverseDecimals: 4,
  /** 进程内短时缓存保留多久：10 分钟（谷歌的条款只明确允许缓存地点 ID 和坐标，名称、地址文字不做持久缓存，见 ADR 0044） */
  cacheTtlMs: 10 * MINUTE_MS,
  /** 进程内短时缓存最多留几条（先进先出） */
  cacheMaxEntries: 500,
  /** 每天（东京时间）最多调用谷歌几次（搜索和反查合计）：默认 500（配置 `GOOGLE_PLACES_DAILY_LIMIT`，0 = 不调用） */
  defaultDailyLimit: 500,
  /** 给客人看的名称、地址最多几个字（超出截短；下单的地址栏上限是 300） */
  nameMaxLength: 120,
  addressMaxLength: 240,
} as const;

/**
 * 取不到结果的原因（只在日志和平台内部用；客人只看到「暂时用不了」）。
 * 前几个和路线预估、「测试一下」同名同义（ADR 0041、0042）。
 */
export const PLACE_FAILURE_CODES = [
  "NOT_CONFIGURED",
  "DAILY_LIMIT_REACHED",
  "KEY_INVALID",
  "API_NOT_ENABLED",
  "KEY_RESTRICTED",
  "BILLING_DISABLED",
  "PERMISSION_DENIED",
  "QUOTA_EXCEEDED",
  "TIMEOUT",
  "UNREACHABLE",
  "UNAVAILABLE",
  /** 应答看不懂（不是 JSON、超过 64 KB 被截断、字段不对） */
  "UNEXPECTED",
  /** 谷歌认为请求无效（400 INVALID_ARGUMENT）：只跟这一次的关键字或坐标有关 */
  "INVALID_REQUEST",
] as const;
export type PlaceFailureCode = (typeof PLACE_FAILURE_CODES)[number];

/** 一个候选地点：名称、地址、坐标。`id` 是谷歌的地点 ID（只用来区分候选）。 */
export interface PlaceCandidate {
  id: string;
  name: string;
  address: string;
  location: LatLng;
}

/** 关键字的规范化：全角半角统一（NFKC）、去掉控制字符、首尾空白去掉、中间连续的空白并成一个。 */
export function normalizePlaceQuery(query: string): string {
  return query
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export type PlaceQueryIssue = "TOO_SHORT" | "TOO_LONG";

/** 规范化之后的关键字能不能拿去搜；按字符（不是 UTF-16 单元）数。 */
export function placeQueryIssue(normalized: string): PlaceQueryIssue | null {
  const length = [...normalized].length;
  if (length < PLACE_SEARCH_RULES.queryMinLength) return "TOO_SHORT";
  if (length > PLACE_SEARCH_RULES.queryMaxLength) return "TOO_LONG";
  return null;
}

/** 搜索的缓存键：城市 + 规范化后的关键字（不分大小写）。 */
export function placeSearchCacheKey(cityId: string, normalizedQuery: string): string {
  return `search:${cityId}:${normalizedQuery.toLowerCase()}`;
}

/** 反查的缓存键和调谷歌用的坐标：都取整到 `PLACE_SEARCH_RULES.reverseDecimals` 位，同一个键的结果一定来自同一组坐标。 */
export function placeReverseKey(point: LatLng): { key: string; point: LatLng } {
  if (!isValidLatLng(point)) throw new RangeError("无效坐标");
  const lat = routeCoordinateText(point.lat, PLACE_SEARCH_RULES.reverseDecimals);
  const lng = routeCoordinateText(point.lng, PLACE_SEARCH_RULES.reverseDecimals);
  return { key: `reverse:${lat},${lng}`, point: { lat: Number(lat), lng: Number(lng) } };
}

export interface LatLngBounds {
  low: LatLng;
  high: LatLng;
}

/**
 * 城市中心周围的正方形范围（半边长 `km` 公里）：搜索只要这个范围里的结果，反查只接受这个范围里的坐标——
 * 我们的代理只为在这个城市用车服务，不当成全球通用的地址查询。纬度夹在 ±85 以内，经度夹在 ±180 以内（不跨日界线）。
 */
export function cityBounds(center: LatLng, km: number = PLACE_SEARCH_RULES.cityReachKm): LatLngBounds {
  const dLat = km / 111.32;
  const cos = Math.max(0.01, Math.cos((center.lat * Math.PI) / 180));
  const dLng = km / (111.32 * cos);
  const clampLat = (value: number): number => Math.max(-85, Math.min(85, value));
  const clampLng = (value: number): number => Math.max(-180, Math.min(180, value));
  return {
    low: { lat: clampLat(center.lat - dLat), lng: clampLng(center.lng - dLng) },
    high: { lat: clampLat(center.lat + dLat), lng: clampLng(center.lng + dLng) },
  };
}

export function inBounds(point: LatLng, bounds: LatLngBounds): boolean {
  return point.lat >= bounds.low.lat && point.lat <= bounds.high.lat && point.lng >= bounds.low.lng && point.lng <= bounds.high.lng;
}

/**
 * 一次失败之后，同一把密钥多久之内不再调用（直接按同样的原因降级），和路线预估同一套（ADR 0042）：
 * 密钥、项目配置、配额、每日上限 60 秒；超时、连不上、对方出错、看不懂 15 秒；只跟这一次有关的（请求无效）和没配置不冷却。
 */
export function placeFailureCooldownMs(code: PlaceFailureCode): number {
  switch (code) {
    case "KEY_INVALID":
    case "API_NOT_ENABLED":
    case "KEY_RESTRICTED":
    case "BILLING_DISABLED":
    case "PERMISSION_DENIED":
    case "QUOTA_EXCEEDED":
    case "DAILY_LIMIT_REACHED":
      return MINUTE_MS;
    case "TIMEOUT":
    case "UNREACHABLE":
    case "UNAVAILABLE":
    case "UNEXPECTED":
      return 15_000;
    case "NOT_CONFIGURED":
    case "INVALID_REQUEST":
      return 0;
  }
}

/** 谷歌给的名称、地址在给客人之前清理一下：去掉控制字符、空白并成一个、超长截短（末尾「…」）。清理后是空的为 null。 */
export function cleanPlaceText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/gu, " ").trim();
  if (text === "") return null;
  const chars = [...text];
  return chars.length <= maxLength ? text : `${chars.slice(0, maxLength - 1).join("")}…`;
}
