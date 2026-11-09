/**
 * 官网路线小地图（M8-10，ADR 0072）：新预订页右侧「行程摘要」的路线图改用谷歌静态地图（Maps Static API），由后端代调，密钥不进浏览器。
 * 这里只有不碰网络和数据库的规则：图的尺寸和倍率、两套灰色调底图（亮色、暗色）和品牌色、请求参数（不含密钥）、
 * 路线折线的解码 / 编码和按网址长度抽稀、缓存键、失败原因和给页面的两类原因。
 * 调用谷歌在 `apps/api/src/integrations/google-static-maps.ts`，缓存、计数和冷却在 `apps/api/src/services/static-maps.ts`。
 */
import type { LatLng } from "./geo.ts";
import { type RouteFailureCode, isEncodedPolyline, routeFailureCooldownMs } from "./route-estimate.ts";

const DAY_MS = 24 * 3_600_000;

export const STATIC_MAP_THEMES = ["light", "dark"] as const;
export type StaticMapTheme = (typeof STATIC_MAP_THEMES)[number];

export const STATIC_MAP_SCALES = [1, 2] as const;
export type StaticMapScale = (typeof STATIC_MAP_SCALES)[number];

/** 静态地图的规则（ADR 0072）。 */
export const STATIC_MAP_RULES = {
  /** 图的宽、高（CSS 像素，谷歌的 `size`）：谷歌免费档最大 640 × 640；太小的图看不清路线 */
  minWidth: 200,
  maxWidth: 640,
  minHeight: 150,
  maxHeight: 640,
  /** 底图样式的版本：改了下面的颜色或样式就加一，旧样式的缓存自然不再命中 */
  styleVersion: 1,
  /** 一张图在库里保留多久：1 天（和浏览器缓存 `max-age=86400` 一样长） */
  cacheTtlMs: DAY_MS,
  /** 浏览器缓存多久（秒）：`Cache-Control: private, max-age=86400` */
  browserMaxAgeSeconds: 86_400,
  /** 一张图最大多少字节：640 × 640 × 2 倍的 8 位 PNG 一般 100–400 KB，超过的当作看不懂、不存库 */
  maxImageBytes: 1024 * 1024,
  /** 每天（东京时间）最多调用谷歌几次：默认 300（配置 `GOOGLE_STATIC_MAPS_DAILY_LIMIT`，0 = 不调用） */
  defaultDailyLimit: 300,
  /** 谷歌静态地图的网址最长 16384 个字符；查询参数（不含密钥）控制在这么长以内，剩下的留给地址和密钥 */
  maxQueryLength: 15_000,
} as const;

/** 一套底图的颜色（不带 #，谷歌要 `0xRRGGBB`），都取自 `docs/design/tokens.css`。 */
export interface StaticMapPalette {
  /** 路线和起终点标记：品牌色 */
  route: string;
  /** 陆地、建筑的底色 */
  base: string;
  /** 普通道路 */
  road: string;
  /** 高速、主干道 */
  highway: string;
  /** 水面 */
  water: string;
  /** 地名文字和文字的描边 */
  label: string;
  labelStroke: string;
}

/**
 * 两套灰色调底图（ADR 0072）：
 * - 亮色：底色 `--color-bg-page` #F4F5F7，道路白色，主干道和水面用边框灰，文字 `--color-text-tertiary`；路线是品牌色 `--color-brand` #1B2A5C。
 * - 暗色：底色 `--color-bg-subtle` #1E232C，道路 `--color-border-default`、主干道 `--color-neutral-border`，水面 `--color-bg-page`；
 *   暗色的品牌色 #141C3D 在深灰上几乎看不见，路线换成同一色系的 #A9BBFF（暗色的 `--color-text-link` / `--color-border-focus`，在 #1E232C 上对比度约 8.4:1）。
 */
export const STATIC_MAP_PALETTES: Readonly<Record<StaticMapTheme, StaticMapPalette>> = {
  light: { route: "1B2A5C", base: "F4F5F7", road: "FFFFFF", highway: "D6DAE1", water: "D6DAE1", label: "5C6574", labelStroke: "FFFFFF" },
  dark: { route: "A9BBFF", base: "1E232C", road: "2D3440", highway: "3A4250", water: "0F1217", label: "929BAA", labelStroke: "171B22" },
};

/** 谷歌静态地图的 `style` 参数：灰色调、去掉兴趣点和公交图标，只留道路、水面和地名。 */
export function staticMapStyles(theme: StaticMapTheme): string[] {
  const p = STATIC_MAP_PALETTES[theme];
  return [
    `element:geometry|color:0x${p.base}`,
    "element:labels.icon|visibility:off",
    `element:labels.text.fill|color:0x${p.label}`,
    `element:labels.text.stroke|color:0x${p.labelStroke}`,
    "feature:poi|visibility:off",
    "feature:transit|visibility:off",
    "feature:administrative.land_parcel|visibility:off",
    `feature:road|element:geometry|color:0x${p.road}`,
    `feature:road.arterial|element:geometry|color:0x${p.road}`,
    `feature:road.highway|element:geometry|color:0x${p.highway}`,
    "feature:road|element:labels.icon|visibility:off",
    `feature:water|element:geometry|color:0x${p.water}`,
    "feature:water|element:labels.text|visibility:off",
  ];
}

export interface StaticMapSize {
  theme: StaticMapTheme;
  width: number;
  height: number;
  scale: StaticMapScale;
}

/** 尺寸和倍率在不在允许的范围里。 */
export function isStaticMapSize(size: StaticMapSize): boolean {
  const { width, height, scale, theme } = size;
  return (
    STATIC_MAP_THEMES.includes(theme) &&
    STATIC_MAP_SCALES.includes(scale) &&
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width >= STATIC_MAP_RULES.minWidth &&
    width <= STATIC_MAP_RULES.maxWidth &&
    height >= STATIC_MAP_RULES.minHeight &&
    height <= STATIC_MAP_RULES.maxHeight
  );
}

/**
 * 图的缓存键：样式版本 + 主题 + 尺寸 + 倍率 + 路线缓存键（domain 的 `routeCacheKey`，起终点取整到 3 位小数）。
 * 例：`s1:light:320x200@2|v1:35.681,139.767>35.659,139.745`。
 */
export function staticMapCacheKey(routeKey: string, size: StaticMapSize): string {
  if (!isStaticMapSize(size)) throw new RangeError("静态地图的尺寸或倍率不在范围里");
  return `s${STATIC_MAP_RULES.styleVersion}:${size.theme}:${size.width}x${size.height}@${size.scale}|${routeKey}`;
}

// ---- 路线折线（谷歌的 encoded polyline，精度 5 位小数） ----

/** 解码谷歌的 encoded polyline；格式不对（字符不对、最后一段没写完、坐标超出范围）为 null。 */
export function decodePolyline(encoded: string): LatLng[] | null {
  if (!isEncodedPolyline(encoded)) return null;
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const next = (): number | null => {
    let result = 0;
    let shift = 0;
    for (;;) {
      if (index >= encoded.length || shift > 30) return null;
      const byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
      if (byte < 0x20) break;
    }
    return result & 1 ? ~(result >>> 1) : result >>> 1;
  };
  while (index < encoded.length) {
    const dLat = next();
    const dLng = next();
    if (dLat === null || dLng === null) return null;
    lat += dLat;
    lng += dLng;
    if (Math.abs(lat) > 90e5 || Math.abs(lng) > 180e5) return null;
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

function encodeValue(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let out = "";
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>>= 5;
  }
  return out + String.fromCharCode(v + 63);
}

/** 编码成谷歌的 encoded polyline（精度 5 位小数）。 */
export function encodePolyline(points: readonly LatLng[]): string {
  let lastLat = 0;
  let lastLng = 0;
  let out = "";
  for (const point of points) {
    const lat = Math.round(point.lat * 1e5);
    const lng = Math.round(point.lng * 1e5);
    out += encodeValue(lat - lastLat) + encodeValue(lng - lastLng);
    lastLat = lat;
    lastLng = lng;
  }
  return out;
}

/** 每隔 `stride` 个点留一个，第一个和最后一个一定留下。 */
function thin(points: readonly LatLng[], stride: number): LatLng[] {
  if (stride <= 1) return [...points];
  const kept = points.filter((_, i) => i % stride === 0);
  const last = points[points.length - 1] as LatLng;
  if (kept[kept.length - 1] !== last) kept.push(last);
  return kept;
}

const coordinate = (point: LatLng): string => `${point.lat.toFixed(5)},${point.lng.toFixed(5)}`;

/**
 * 谷歌静态地图的查询参数（**不含密钥**，密钥由调用谷歌的那一层接在最后）：尺寸、倍率、PNG、中文地名、灰色调样式、
 * 品牌色的路线（`path=…|enc:折线`）和起点 A、终点 B 两个标记（取折线的第一个点和最后一个点，和路线对得上）。
 * 折线太长、网址超过 `STATIC_MAP_RULES.maxQueryLength` 时按间隔抽稀（起终点不动），直到放得下。
 * 折线看不懂、少于 2 个点时为 null（画不了路线）。
 */
export function staticMapQuery(polyline: string, size: StaticMapSize): string | null {
  if (!isStaticMapSize(size)) return null;
  const points = decodePolyline(polyline);
  if (points === null || points.length < 2) return null;
  const palette = STATIC_MAP_PALETTES[size.theme];
  const first = points[0] as LatLng;
  const last = points[points.length - 1] as LatLng;
  const build = (encoded: string): string => {
    const params = new URLSearchParams();
    params.append("size", `${size.width}x${size.height}`);
    params.append("scale", String(size.scale));
    params.append("format", "png");
    params.append("maptype", "roadmap");
    params.append("language", "zh-CN");
    for (const style of staticMapStyles(size.theme)) params.append("style", style);
    params.append("path", `color:0x${palette.route}ff|weight:5|enc:${encoded}`);
    params.append("markers", `size:mid|color:0x${palette.route}|label:A|${coordinate(first)}`);
    params.append("markers", `size:mid|color:0x${palette.route}|label:B|${coordinate(last)}`);
    return params.toString();
  };
  let query = build(polyline);
  for (let stride = 2; query.length > STATIC_MAP_RULES.maxQueryLength; stride *= 2) {
    query = build(encodePolyline(thin(points, stride)));
    if (stride > points.length) break;
  }
  return query.length <= STATIC_MAP_RULES.maxQueryLength ? query : null;
}

// ---- 失败原因 ----

/**
 * 调谷歌静态地图失败的原因（运营后台系统状态里看）。和路线预估同名同义（ADR 0042），没有「没有路线 / 坐标无效」；
 * 多一个 `IMAGE_TOO_LARGE`（图超过 `STATIC_MAP_RULES.maxImageBytes`）。
 */
export const STATIC_MAP_FAILURE_CODES = [
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
  "UNEXPECTED",
  "IMAGE_TOO_LARGE",
] as const;
export type StaticMapFailureCode = (typeof STATIC_MAP_FAILURE_CODES)[number];

export const STATIC_MAP_FAILURE_MESSAGES: Readonly<Record<StaticMapFailureCode, string>> = {
  NOT_CONFIGURED: "谷歌地图的密钥没有配置：官网路线图用原来的地图显示",
  DAILY_LIMIT_REACHED: "今天调用谷歌静态地图的次数已到每日上限（费用控制），明天 0 点（东京时间）恢复；需要放宽请调整 GOOGLE_STATIC_MAPS_DAILY_LIMIT",
  KEY_INVALID: "谷歌地图的密钥无效：请在运营后台核对或更换",
  API_NOT_ENABLED: "谷歌云项目没有启用 Maps Static API：官网路线图用原来的地图显示，需要时请在谷歌云后台开通",
  KEY_RESTRICTED: "谷歌地图的密钥设了限制（如只允许某些网站或 API），不允许这台服务器调用 Maps Static API",
  BILLING_DISABLED: "谷歌云项目没有绑定付款方式",
  PERMISSION_DENIED: "谷歌拒绝了这次调用（权限不够）",
  QUOTA_EXCEEDED: "谷歌静态地图的用量超过了上限或被限流，稍后自动重试",
  TIMEOUT: "谷歌静态地图在时限内没有应答",
  UNREACHABLE: "连不上谷歌静态地图（网络不通）",
  UNAVAILABLE: "谷歌静态地图暂时出错",
  UNEXPECTED: "谷歌静态地图的应答看不懂（不是图片或跳转到了别处）",
  IMAGE_TOO_LARGE: "谷歌静态地图给的图太大，没有使用",
};

/** 冷却（同一把密钥，进程内）：和路线预估同一套时长（ADR 0042）；图太大只跟这一次的尺寸有关，不冷却。 */
export function staticMapFailureCooldownMs(code: StaticMapFailureCode): number {
  return code === "IMAGE_TOO_LARGE" ? 0 : routeFailureCooldownMs(code);
}

/** 出不了图的原因：调静态地图失败、取不到路线（路线预估的原因，ADR 0042），或这张图本身画不了。 */
export type RouteMapFailure =
  | { stage: "static_map"; code: StaticMapFailureCode }
  | { stage: "route"; code: RouteFailureCode }
  /** NO_POLYLINE：有路线但没有折线或折线看不懂；SAME_POINT：起终点取整后是同一个点；SITE_NOT_OPEN：官网没开 */
  | { stage: "map"; code: "NO_POLYLINE" | "SAME_POINT" | "SITE_NOT_OPEN" };

/**
 * 给页面的两类原因（ADR 0072）：
 * - `NOT_ENABLED`：没配谷歌密钥，或谷歌说静态地图服务没开通 / 密钥不允许 / 密钥无效 / 没绑卡——页面继续用原来的地图（后备）；
 * - `UNAVAILABLE`：其余一切（每日上限、冷却、超时、取不到路线、官网没开……）——页面只显示「约 X 分钟 · Y 公里」。
 * 路线预估（Routes API）自己的「没开通」不算：那是路线取不到，原来的地图也画不出路线。
 */
export type RouteMapReason = "NOT_ENABLED" | "UNAVAILABLE";

export function routeMapReason(failure: RouteMapFailure): RouteMapReason {
  if (failure.code === "NOT_CONFIGURED") return "NOT_ENABLED";
  if (failure.stage !== "static_map") return "UNAVAILABLE";
  switch (failure.code) {
    case "KEY_INVALID":
    case "API_NOT_ENABLED":
    case "KEY_RESTRICTED":
    case "BILLING_DISABLED":
    case "PERMISSION_DENIED":
      return "NOT_ENABLED";
    default:
      return "UNAVAILABLE";
  }
}
