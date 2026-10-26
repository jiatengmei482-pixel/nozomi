/**
 * 路线预估（M2-02，ADR 0042）：里程 + 时长计价要的预估里程（米）和时长（分钟），来自谷歌地图 Routes API。
 * 这里只有不碰网络和数据库的规则：缓存键（坐标取整）、秒换分钟、哪些失败要冷却多久 / 要不要缓存、每日调用上限、给客人看的原因。
 * 调用谷歌在 `apps/api/src/integrations/google-maps.ts`，缓存和计数在 `apps/api/src/services/route-estimates.ts`。
 */
import { type LatLng, isValidLatLng } from "./geo.ts";
import type { RouteEstimate } from "./quote.ts";
import { tenantDate } from "./tenants.ts";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** 路线预估的规则（推荐值，ADR 0042「待负责人确认」）。 */
export const ROUTE_RULES = {
  /** 起终点坐标取整到小数点后几位再查缓存、再调谷歌：3 位 ≈ 纬度方向 111 米、东京一带经度方向约 90 米，点最多挪动约 70 米 */
  coordinateDecimals: 3,
  /** 查到的路线在缓存里保留多久：7 天（不考虑实时路况的路线只随道路变化，7 天内基本不变） */
  cacheTtlMs: 7 * DAY_MS,
  /** 「两点之间没有可行驶的路线」「谷歌认为坐标无效」也缓存，免得同一组点反复花钱：1 天 */
  negativeTtlMs: DAY_MS,
  /** 每天（东京时间）最多调用谷歌几次：默认 1000（配置 `GOOGLE_ROUTES_DAILY_LIMIT`，0 = 不调用） */
  defaultDailyLimit: 1_000,
  /** 谷歌给的里程、时长的合理范围（超出当作看不懂的应答）：5000 公里、7 天 */
  maxMeters: 5_000_000,
  maxSeconds: 7 * 24 * 3_600,
} as const;

/**
 * 取不到路线的原因（询价日志、运营后台试算里给出）。
 * 前几个和运营后台「测试一下」的原因代码同名同义（ADR 0041）；后几个是报价才有的。
 */
export const ROUTE_FAILURE_CODES = [
  /** 谷歌地图的密钥没有配置（运营后台和服务器配置文件都没有） */
  "NOT_CONFIGURED",
  /** 今天调用谷歌的次数到了每日上限（费用控制） */
  "DAILY_LIMIT_REACHED",
  "KEY_INVALID",
  "API_NOT_ENABLED",
  "KEY_RESTRICTED",
  "BILLING_DISABLED",
  "PERMISSION_DENIED",
  /** 谷歌那边的配额用完或限流（429） */
  "QUOTA_EXCEEDED",
  "TIMEOUT",
  "UNREACHABLE",
  "UNAVAILABLE",
  /** 应答看不懂（不是 JSON、超过 64 KB 被截断、里程时长不合理） */
  "UNEXPECTED",
  /** 谷歌认为起终点无效（400 INVALID_ARGUMENT） */
  "INVALID_POINTS",
  /** 两点之间没有可行驶的路线（隔着海、没有路） */
  "NO_ROUTE",
] as const;
export type RouteFailureCode = (typeof ROUTE_FAILURE_CODES)[number];

export const ROUTE_FAILURE_MESSAGES: Readonly<Record<RouteFailureCode, string>> = {
  NOT_CONFIGURED: "谷歌地图的密钥没有配置：请超级管理员在运营后台『系统设置 → 系统状态 → 第三方密钥』填写",
  DAILY_LIMIT_REACHED: "今天调用谷歌地图的次数已到每日上限（费用控制），明天 0 点（东京时间）恢复；需要放宽请调整 GOOGLE_ROUTES_DAILY_LIMIT",
  KEY_INVALID: "谷歌地图的密钥无效：请在运营后台核对或更换",
  API_NOT_ENABLED: "谷歌云项目没有启用 Routes API",
  KEY_RESTRICTED: "谷歌地图的密钥设了限制，不允许这台服务器调用 Routes API",
  BILLING_DISABLED: "谷歌云项目没有绑定付款方式",
  PERMISSION_DENIED: "谷歌拒绝了这次调用（权限不够）",
  QUOTA_EXCEEDED: "谷歌地图的用量超过了上限或被限流，稍后自动重试",
  TIMEOUT: "谷歌地图在时限内没有应答",
  UNREACHABLE: "连不上谷歌地图（网络不通）",
  UNAVAILABLE: "谷歌地图暂时出错",
  UNEXPECTED: "谷歌地图的应答看不懂",
  INVALID_POINTS: "谷歌地图认为起点或终点无效",
  NO_ROUTE: "这两个地点之间没有可行驶的路线",
};

/** 路线从哪里来：缓存、刚调用谷歌、起终点取整后是同一个点（不调用，里程和时长都是 0）。 */
export type RouteSource = "cache" | "google" | "same_point";

export type RouteLookup = { ok: true; route: RouteEstimate; source: RouteSource } | { ok: false; code: RouteFailureCode };

/**
 * 一个坐标值取整到 `decimals` 位小数，四舍五入（离 0 远的方向），写成固定位数的十进制字符串。
 * 先按 9 位小数写出来再在字符串上进位，不用「乘 1000 再取整」——那样 139.7675 会因为二进制误差被舍掉。
 */
export function routeCoordinateText(value: number, decimals: number = ROUTE_RULES.coordinateDecimals): string {
  if (!Number.isFinite(value)) throw new RangeError("坐标必须是有限的数");
  const negative = value < 0;
  const [whole, fraction = ""] = Math.abs(value).toFixed(9).split(".") as [string, string?];
  const digits = BigInt(whole + fraction.slice(0, decimals));
  const rounded = digits + (Number(fraction[decimals] ?? "0") >= 5 ? 1n : 0n);
  const text = rounded.toString().padStart(decimals + 1, "0");
  const body = decimals === 0 ? text : `${text.slice(0, -decimals)}.${text.slice(-decimals)}`;
  return negative && rounded !== 0n ? `-${body}` : body;
}

export interface RouteCacheKey {
  /** 缓存表的主键：`v1:起点纬度,起点经度>终点纬度,终点经度`（取整后） */
  key: string;
  /** 取整后的起终点：调谷歌也用它们，保证同一个键的结果来自同一组坐标 */
  from: LatLng;
  to: LatLng;
  /** 取整后起终点是同一个点：不调用谷歌，里程和时长按 0 */
  samePoint: boolean;
}

/**
 * 缓存键：起终点各自取整（`ROUTE_RULES.coordinateDecimals`）。有方向（A → B 和 B → A 是两条：单行道、高速出入口不同）。
 * 只用不考虑实时路况的路线，所以键里没有时段（ADR 0042「为什么不按时段」）。
 */
export function routeCacheKey(from: LatLng, to: LatLng): RouteCacheKey {
  if (!isValidLatLng(from) || !isValidLatLng(to)) throw new RangeError("无效坐标");
  const parts = [routeCoordinateText(from.lat), routeCoordinateText(from.lng), routeCoordinateText(to.lat), routeCoordinateText(to.lng)] as [string, string, string, string];
  return {
    key: `v1:${parts[0]},${parts[1]}>${parts[2]},${parts[3]}`,
    from: { lat: Number(parts[0]), lng: Number(parts[1]) },
    to: { lat: Number(parts[2]), lng: Number(parts[3]) },
    samePoint: parts[0] === parts[2] && parts[1] === parts[3],
  };
}

/** 谷歌给的时长（秒）换成计价用的整分钟：四舍五入（30 秒进一分钟）。 */
export function routeMinutesFromSeconds(seconds: number): number {
  if (!Number.isInteger(seconds) || seconds < 0) throw new RangeError("时长必须是非负整数秒");
  return Math.floor((seconds + 30) / 60);
}

/** 谷歌给的里程（米）、时长（秒）在不在合理范围里。 */
export function routeValuesUsable(meters: number, seconds: number): boolean {
  return Number.isInteger(meters) && Number.isInteger(seconds) && meters >= 0 && seconds >= 0 && meters <= ROUTE_RULES.maxMeters && seconds <= ROUTE_RULES.maxSeconds;
}

/**
 * 一次失败之后，同一把密钥多久之内不再调用谷歌（直接按同样的原因降级）——谷歌出问题时询价不必每次都等满时限，也不把配额越打越紧。
 * - 密钥、项目配置的问题（无效、没启用、受限、没绑卡、没权限）：60 秒。换了密钥立即重试（冷却按密钥记）。
 * - 配额用完 / 限流、到了每日上限：60 秒。
 * - 超时、连不上、对方出错、看不懂：15 秒。
 * - 坐标无效、没有路线：只跟这一组起终点有关，不冷却（改用缓存挡住重复调用）。
 */
export function routeFailureCooldownMs(code: RouteFailureCode): number {
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
    case "INVALID_POINTS":
    case "NO_ROUTE":
      return 0;
  }
}

/** 只跟这一组起终点有关的失败：写进缓存（`ROUTE_RULES.negativeTtlMs`），同一组点一天内不再花钱问。 */
export function routeFailureCacheable(code: RouteFailureCode): boolean {
  return code === "INVALID_POINTS" || code === "NO_ROUTE";
}

/** 每日调用计数按哪一天算：东京时间的日期（和供应商的「今天」同一个时区）。 */
export function routeUsageDay(now: Date): string {
  return tenantDate(now);
}

/** 今天已经调用了 `used` 次，还能不能再调一次。上限 0 = 不调用。 */
export function routeCallAllowed(used: number, dailyLimit: number): boolean {
  return used < dailyLimit;
}

/** 给客人 / 渠道看的原因：没有路线（换个地点），或暂时无法报价（稍后再试）。密钥、配额这些平台内部的原因不往外说。 */
export type GuestRouteReason = "NO_ROUTE" | "TEMPORARILY_UNAVAILABLE";

export function guestRouteReason(code: RouteFailureCode): GuestRouteReason {
  return code === "NO_ROUTE" || code === "INVALID_POINTS" ? "NO_ROUTE" : "TEMPORARILY_UNAVAILABLE";
}

/** 缓存的一行什么时候过期：成功的 7 天，只跟这组点有关的失败 1 天。 */
export function routeCacheExpiry(now: Date, ok: boolean): Date {
  return new Date(now.getTime() + (ok ? ROUTE_RULES.cacheTtlMs : ROUTE_RULES.negativeTtlMs));
}
