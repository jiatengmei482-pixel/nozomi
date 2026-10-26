/**
 * 路线预估（谷歌地图 Routes API，ADR 0042）在运营后台的显示：取不到路线的原因、路线从哪里来、每日调用的用量。
 * 只给平台员工看（系统状态、报价试算）；客人看到的说法在 site-display.ts，供应商只看得到「没有路线 / 暂时不可用」。
 */
import { ROUTE_FAILURE_CODES, type RouteFailureCode, type RouteSource, routeFailureCacheable } from "@nozomi/domain";
import type { BadgeSpec } from "../components/StatusBadge.tsx";
import type { RouteUsageStatus } from "../api/platform.ts";

/** 每个原因码：出了什么事 + 怎么办。对账见 platform.contract.test.ts（和 openapi 的 `QuoteRouteFailureCode` 一一对应）。 */
export const ROUTE_FAILURE_TEXT: Readonly<Record<RouteFailureCode, string>> = {
  NOT_CONFIGURED: "谷歌地图的密钥没有配置。请超级管理员在「系统设置 → 系统状态 → 第三方密钥」填写。",
  DAILY_LIMIT_REACHED: "今天调用谷歌地图的次数到了每日上限。今天的里程计价暂停，明天自动恢复；可在服务器配置 GOOGLE_ROUTES_DAILY_LIMIT 调整。",
  KEY_INVALID: "谷歌地图的密钥无效。请在「系统设置 → 系统状态 → 第三方密钥」核对或更换。",
  API_NOT_ENABLED: "谷歌云项目没有启用 Routes API。请在谷歌云控制台给这个项目启用 Routes API。",
  KEY_RESTRICTED: "谷歌地图的密钥设了限制，不允许这台服务器调用 Routes API。请在谷歌云控制台放开这把密钥对 Routes API 和服务器地址的限制。",
  BILLING_DISABLED: "谷歌云项目没有绑定付款方式。请在谷歌云控制台给项目绑定结算账号。",
  PERMISSION_DENIED: "谷歌拒绝了这次调用（权限不够）。请在谷歌云控制台检查这把密钥和项目的权限。",
  QUOTA_EXCEEDED: "谷歌地图的用量超过了谷歌云项目的配额，或被限流。稍后会自动重试；经常出现请在谷歌云控制台调高配额。",
  TIMEOUT: "谷歌地图在时限内没有应答。通常过一会儿自己恢复；一直这样请检查服务器的网络。",
  UNREACHABLE: "服务器连不上谷歌地图（网络不通）。请检查服务器的网络和防火墙。",
  UNAVAILABLE: "谷歌地图暂时出错，或今天的调用次数没有记上。通常过一会儿自己恢复，请稍后再试。",
  UNEXPECTED: "谷歌地图的应答看不懂。偶尔一次可以不管；一直这样请联系技术查看服务器日志。",
  INVALID_POINTS: "谷歌地图认为起点或终点无效。请检查坐标（纬度在前、经度在后）是不是填反了或不在陆地上。",
  NO_ROUTE: "这两个地点之间没有可行驶的路线（例如隔着海）。请换一组地点。",
};

/** 原因码的中文说明；接口以后多出来的码先用接口自己给的说明。 */
export function routeFailureText(code: string, fallback: string | null): string {
  return (ROUTE_FAILURE_TEXT as Readonly<Record<string, string>>)[code] ?? fallback ?? "谷歌地图没有给出路线。请稍后再试。";
}

export const ROUTE_SOURCE_TEXT: Readonly<Record<RouteSource, string>> = {
  cache: "来自缓存，这次没有调用谷歌地图",
  google: "刚调用谷歌地图查到的",
  same_point: "起点和终点几乎重合，按 0 计算，没有调用谷歌地图",
};

/**
 * 地址问题（`NO_ROUTE`、`INVALID_POINTS`）：谷歌地图正常应答了，只是这组起终点没有路线或无效——不是服务故障（M4-12）。
 * 和后端「只跟这组点有关、可以负缓存」的失败是同一组（domain 的 `routeFailureCacheable`，ADR 0042）；不认识的码按服务故障算。
 */
export function isAddressRouteFailure(code: string): boolean {
  return (ROUTE_FAILURE_CODES as readonly string[]).includes(code) && routeFailureCacheable(code as RouteFailureCode);
}

/**
 * 系统状态页「路线预估」卡片的徽标：到了上限最要紧（和顶部的警示提示条一致）；最近一次失败是服务故障、并且比最近一次成功晚时提醒；
 * 地址问题不算失败（谷歌地图应答了，服务是好的），按「正常」；什么都没发生过时中性。
 */
export function routeUsageBadge(routes: RouteUsageStatus): BadgeSpec {
  if (routes.daily_limit_reached) return { tone: "warning", label: "已到每日上限" };
  const failure = routes.last_failure;
  const serviceFailedLast = failure !== null && !isAddressRouteFailure(failure.code) && (routes.last_success_at === null || failure.at > routes.last_success_at);
  if (serviceFailedLast) return { tone: "warning", label: "最近一次失败" };
  if (routes.last_success_at === null && failure === null) return { tone: "neutral", label: "还没有调用过" };
  return { tone: "success", label: "正常" };
}
