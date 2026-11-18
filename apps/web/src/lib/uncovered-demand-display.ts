/**
 * 「未覆盖需求」（M8-20，ADR 0075 第四部分；docs/design/pages/platform-products.md 第 9 节）的说法：原因、用车类型、两端、拒绝原因、
 * 地图上点的大小，和筛选里「最近 N 天」换成东京日期。不依赖浏览器，用 node:test 直接测。
 */
import { PRODUCT_CATEGORY_NAMES } from "@nozomi/domain";
import type { DemandPoint, UncoveredDemand, UncoveredDemandPointItem, UncoveredDemandReason } from "../api/uncovered-demands.ts";

export const DEMAND_REASON_NAMES: Readonly<Record<UncoveredDemandReason, string>> = {
  OUTSIDE_OPERATING: "不在任何运营区域里",
  NO_PRICING_AREA: "在运营区域里，但没有报价区域",
  OTHER: "其他原因",
};

/** 每个原因下一步该做什么（列表上方的说明、详情里用）。 */
export const DEMAND_REASON_HINTS: Readonly<Record<UncoveredDemandReason, string>> = {
  OUTSIDE_OPERATING: "这里没有供应商接单：可以请招商找这一带的供应商，或请现有供应商把运营区域画大一些。",
  NO_PRICING_AREA: "有供应商能来，但商品没有勾选覆盖这里的报价区域：可以联系这些供应商补一个报价区域、设好价格。",
  OTHER: "区域没有问题，是别的原因（提前预订不够、售罄、人数超出、没有价格……），见详情里的拒绝原因。",
};

/** 报价引擎的拒绝原因（详情里的计数）：只列常见的，其余照原样显示代码。 */
const REFUSAL_NAMES: Readonly<Record<string, string>> = {
  OUT_OF_SERVICE_AREA: "不在运营区域或商品区域里",
  IN_FORBIDDEN_AREA: "在禁行区里",
  NO_PRICING_AREA: "在运营区域里，但商品没有勾选覆盖它的报价区域",
  LEAD_TIME_TOO_SHORT: "提前预订时长不够",
  OUTSIDE_SERVICE_TIME: "不在服务时间里",
  OUTSIDE_SALE_PERIOD: "不在下单有效期里",
  SERVICE_TIME_PASSED: "用车时间已经过去",
  SOLD_OUT: "库存不足",
  URGENT_SOLD_OUT: "加急库存用完",
  CAPACITY_EXCEEDED: "人数或行李超出车型",
  VEHICLE_GROUP_NOT_OFFERED: "没有这个车型组",
  NO_PRICE_RULE: "没有价格",
  PRICE_NOT_IN_EFFECT: "价格不在生效期",
  PRICE_RULE_DISABLED: "价格已停用",
  ROUTE_UNAVAILABLE: "取不到路线",
  DROPOFF_REQUIRED: "包车没给下车地点",
  WAYPOINT_NOT_PRICED: "经停点不在任何区域",
  ITINERARY_TOO_LONG: "预计用时超过在线下单上限",
  ADDON_NOT_OFFERED: "附加服务不提供",
  FX_RATE_UNAVAILABLE: "没有可用的汇率",
  TRIAL_DAILY_LIMIT: "试运营每日上限",
};

export function refusalName(code: string): string {
  return REFUSAL_NAMES[code] ?? code;
}

/** 拒绝原因按次数从多到少：「没有价格 × 3、库存不足 × 1」。 */
export function refusalSummary(counts: Readonly<Record<string, number>>): string {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return entries.length === 0 ? "—" : entries.map(([code, count]) => `${refusalName(code)} × ${count}`).join("、");
}

/** 用车类型：接机 / 送机 / 点对点 / 包车 8 小时。 */
export function tripText(demand: Pick<UncoveredDemand, "category" | "direction" | "package_hours">): string {
  if (demand.category === "airport_transfer") return demand.direction === "dropoff" ? "送机" : demand.direction === "pickup" ? "接机" : PRODUCT_CATEGORY_NAMES.airport_transfer;
  if (demand.category === "charter") return demand.package_hours === null ? PRODUCT_CATEGORY_NAMES.charter : `包车 ${demand.package_hours} 小时`;
  return PRODUCT_CATEGORY_NAMES[demand.category];
}

export function pointText(point: DemandPoint | null): string {
  return point === null ? "—" : `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`;
}

/** 一端：有名称写名称，没有写坐标；渠道没给下车点写「没有给」。 */
export function endText(name: string | null, point: DemandPoint | null): string {
  if (point === null) return "没有给";
  return name !== null && name.trim() !== "" ? name : pointText(point);
}

/** 「2026-11-12T09:30」→「2026-11-12 09:30」（用车的当地时间，接口已经是当地时间，不换算）。 */
export function serviceLocalText(local: string): string {
  return local.replace("T", " ");
}

/** 地图上点的大小：按次数分三档（1 次、2–4 次、5 次以上），返回半径（像素）。 */
export function demandDotRadius(repeatCount: number): number {
  if (repeatCount >= 5) return 9;
  if (repeatCount >= 2) return 7;
  return 5;
}

/** 地图上的点：上车点、下车点各一个（没给的那一端不画）。 */
export interface DemandMapPoint {
  key: string;
  demandId: string;
  end: "pickup" | "dropoff";
  point: DemandPoint;
  item: UncoveredDemandPointItem;
}

export function demandMapPoints(items: readonly UncoveredDemandPointItem[]): DemandMapPoint[] {
  return items.flatMap((item) => [
    ...(item.pickup ? [{ key: `${item.id}:p`, demandId: item.id, end: "pickup" as const, point: item.pickup, item }] : []),
    ...(item.dropoff ? [{ key: `${item.id}:d`, demandId: item.id, end: "dropoff" as const, point: item.dropoff, item }] : []),
  ]);
}

/** 东京的「今天」（YYYY-MM-DD）。 */
export function tokyoToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** 东京日期往前推几天。 */
export function shiftDate(date: string, days: number): string {
  const at = new Date(`${date}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 筛选的日期范围有没有问题（和接口同一套：开始不晚于结束、最长 366 天）。没问题为 null。 */
export function dateRangeProblem(from: string, to: string): string | null {
  if (from !== "" && !DATE_PATTERN.test(from)) return "开始日期的写法不对，请写成「年-月-日」。";
  if (to !== "" && !DATE_PATTERN.test(to)) return "结束日期的写法不对，请写成「年-月-日」。";
  if (from !== "" && to !== "") {
    if (from > to) return "开始日期不能晚于结束日期。";
    const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
    if (days > 366) return "日期范围最长 366 天，请缩短。";
  }
  return null;
}
