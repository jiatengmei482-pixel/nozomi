/**
 * 包车经停点和按行程计价（M9W-02，ADR 0088；需求 charter-waypoint-surcharge.md 13.5）：页面用的纯逻辑。
 * - 经停点的草稿（地点 + 停留时长）、校验（地点、停留都必填）、询价请求里的 `waypoints`；
 * - 按行程计价时的说法：「按行程预计 X 小时 Y 分，套餐 N 小时」；
 * - 对外价明细（`price_breakdown`）的每一行；各项之和对不上总价时不显示明细（只显示总价，价格不能显示错）；
 * - 行程时间表（上车 → 经停 1…N → 下车，各段行驶分钟、各点停留）；
 * - 经停点报不出价（`WAYPOINT_NOT_PRICED`）时指出是哪个经停点。
 */
import { isCurrencyCode, parseMajor } from "@nozomi/domain";
import type { SiteMoney, SiteOrder, SitePriceBreakdownItem, SiteQuote, SiteQuoteResult } from "../api/site.ts";
import type { TripPoint } from "./book-new.ts";
import { moneyText } from "./dispatch-display.ts";
import { displayName } from "./master-display.ts";

/** 订单上的一个经停点（M9W-01）：名称、坐标、停留分钟 */
export type OrderWaypoint = NonNullable<SiteOrder["waypoints"]>[number];
/** 包车按行程计价锁定在订单上的量（M9W-01）：全程米数、总时长（行驶 + 停留）、套餐含量、超出量；没有金额 */
export type OrderItinerary = NonNullable<SiteOrder["itinerary"]>;
/** 包车按行程计价时服务器算的路线（M9W-01）：逐段行驶、行驶 / 停留合计、总时长、全程 */
export type SiteItineraryRoute = NonNullable<SiteQuoteResult["itinerary_route"]>;

/** 最多几个经停点（和后端 `maxItems` 一致） */
export const MAX_WAYPOINTS = 10;
/** 停留时长一档 30 分钟，最长 8 小时 */
export const STAY_STEP_MINUTES = 30;
export const STAY_MAX_MINUTES = 480;
export const STAY_OPTIONS: readonly number[] = Array.from({ length: STAY_MAX_MINUTES / STAY_STEP_MINUTES }, (_, index) => (index + 1) * STAY_STEP_MINUTES);

/** 按行程计价时给客人的提示（车型卡、右侧栏、核对页） */
export const ITINERARY_NOTE = "价格按您填的经停点计算；当天临时去其他区域或超出预计可能会加收。";

/** 页面上的一个经停点：`key` 只在页面里用（排序时跟着走）；`stay` 是下拉的值（分钟数的字符串，没选为空） */
export interface WaypointDraft {
  key: string;
  point: TripPoint | null;
  stay: string;
}

let nextKey = 0;
export function newWaypoint(): WaypointDraft {
  nextKey += 1;
  return { key: `wp-${nextKey}`, point: null, stay: "" };
}

/** 「30 分钟」「1 小时」「1 小时 30 分」 */
export function durationText(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} 分钟`;
  return rest === 0 ? `${hours} 小时` : `${hours} 小时 ${rest} 分`;
}

export type WaypointErrors = Record<string, { point?: string; stay?: string }>;

/** 每个经停点：地点要从候选里选，停留时长要选（30 分钟一档）。没有问题时是空对象。 */
export function waypointErrors(list: readonly WaypointDraft[]): WaypointErrors {
  const errors: WaypointErrors = {};
  list.forEach((entry, index) => {
    const found: { point?: string; stay?: string } = {};
    if (entry.point === null) found.point = `请选择第 ${index + 1} 个经停点，或删除这一行`;
    if (!STAY_OPTIONS.includes(Number(entry.stay)) || entry.stay === "") found.stay = "请选择停留时长";
    if (found.point !== undefined || found.stay !== undefined) errors[entry.key] = found;
  });
  return errors;
}

/** 询价请求里的 `waypoints`：都填好了才有；有没填好的为 null（不报价）；一个都没有为空数组 */
export function waypointsBody(list: readonly WaypointDraft[]): OrderWaypoint[] | null {
  if (Object.keys(waypointErrors(list)).length > 0) return null;
  return list.map((entry) => ({ name: (entry.point as TripPoint).name, lat: (entry.point as TripPoint).lat, lng: (entry.point as TripPoint).lng, stay_minutes: Number(entry.stay) }));
}

/** 把第 `index` 个经停点移动 `delta` 位；到头了原样返回 */
export function moveWaypoint<T>(list: readonly T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta;
  if (target < 0 || target >= list.length) return [...list];
  const next = [...list];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved as T);
  return next;
}

/** 服务器按行程选的套餐时长：每个报价的 `package.hours`（每个车型组各自选） */
export function itineraryPackageHours(quote: Pick<SiteQuote, "package"> | null): number | null {
  return quote?.package?.hours ?? null;
}

/**
 * 按行程计价时自动选的套餐（M9P-03，ADR 0093 第四节第 9 条）：各车型报价的 `auto_package_hours` 里最短的（客人手动升档时报价照样带着自动会选的档）。
 * 没有报价、或旧接口没有这一项时为 null。
 */
export function autoPackageHoursOf(quotes: readonly Pick<SiteQuote, "auto_package_hours">[]): number | null {
  const hours = quotes.flatMap((quote) => (typeof quote.auto_package_hours === "number" ? [quote.auto_package_hours] : []));
  return hours.length === 0 ? null : Math.min(...hours);
}

/**
 * 有经停点时客人能手动升到的套餐（规格步骤 3「客人可以手动改成更长的套餐，不能改成短于 T 的」）：这段行程能订的套餐里比自动选的档长的，从短到长。
 * 自动选的档（从 T 起的那一档）本身是下拉的默认项「自动（N 小时）」，比它短的一律不列。
 */
export function upgradePackageHours(available: readonly number[], autoHours: number | null): number[] {
  if (autoHours === null) return [];
  return [...new Set(available)].filter((hours) => hours > autoHours).sort((a, b) => a - b);
}

/** 米 → 「54.3 公里」（向上取整到 0.1 公里，整数不带 .0） */
export function kmText(meters: number): string {
  const tenths = Math.ceil(meters / 100);
  return `${tenths % 10 === 0 ? String(tenths / 10) : (tenths / 10).toFixed(1)} 公里`;
}

/** 「按行程预计 7 小时 30 分（行驶 4 小时 + 停留 3 小时 30 分），全程约 254 公里，套餐 8 小时」；没有路线时 null。时长、全程只用服务器算的数 */
export function itineraryText(route: SiteItineraryRoute | null | undefined, packageHours: number | null): string | null {
  if (route === null || route === undefined) return null;
  const parts = route.stay_minutes > 0 ? `（行驶 ${durationText(route.drive_minutes)} + 停留 ${durationText(route.stay_minutes)}）` : "";
  return `按行程预计 ${durationText(route.total_minutes)}${parts}，全程约 ${kmText(route.total_meters)}${packageHours === null ? "" : `，套餐 ${packageHours} 小时`}`;
}

/** 订单上锁定的量（M9W-01）：「全程约 254 公里，预计 7 小时 30 分（含停留）」；没有为 null */
export function orderItineraryText(itinerary: OrderItinerary | null | undefined): string | null {
  if (itinerary === null || itinerary === undefined) return null;
  return `全程约 ${kmText(itinerary.route_meters)}，预计 ${durationText(itinerary.route_minutes)}（含停留）`;
}

/**
 * 按行程计价有一段路线算不出来（422 `ITINERARY_ROUTE_UNAVAILABLE`，`details.leg` 从 1 起）：说清是哪两个点之间，请客人联系客服或调整经停点。
 * `points` 是上车、经停 1…N、下车的名称。
 */
export function itineraryRouteFailureText(leg: unknown, points: readonly string[]): string {
  const index = typeof leg === "number" && Number.isInteger(leg) ? leg : null;
  const from = index === null ? undefined : points[index - 1];
  const to = index === null ? undefined : points[index];
  const where = from !== undefined && to !== undefined ? `「${from}」到「${to}」这一段` : "有一段";
  return `${where}路线暂时算不出来，没有在线报价。请联系客服人工报价，或调整经停点再试。`;
}

export interface BreakdownLine {
  key: string;
  label: string;
  amount: string;
}

const KIND_LABELS: Readonly<Record<string, string>> = {
  pickup: "上车加价",
  dropoff: "下车加价",
  waypoint: "经停加价",
  over_km: "超公里费",
  overtime: "超时费",
  adjust: "调价",
  other: "其他费用（加急、夜间、附加服务等）",
};

/** 没超出（金额为 0）时不列的项目：超公里费、超时费（M8-43） */
const HIDDEN_WHEN_ZERO: ReadonlySet<string> = new Set(["over_km", "overtime"]);

function minorOf(money: SiteMoney): number | null {
  if (!isCurrencyCode(money.currency)) return null;
  try {
    return parseMajor(money.amount, money.currency);
  } catch {
    return null;
  }
}

function seqText(seqs: readonly number[]): string {
  return `第 ${seqs.join("、")} 个经停点`;
}

/**
 * 对外价明细的每一行（按接口给的顺序）。没有明细、币种和总价不一样、某一项读不出来、**各项之和不等于总价**时为 null——
 * 页面这时只显示总价（宁可少显示，不能显示一组加起来对不上的数）。
 * 金额为 0 的超公里费、超时费不列（M8-43：没超出时客人不用看到「超公里费 0 JPY」）；先按全部项目核对总价再去掉，0 不影响各项之和。
 * 其他项目（包括金额为 0 的）照旧列出。
 */
export function breakdownLines(quote: Pick<SiteQuote, "price" | "price_breakdown">, packageHours: number | null): BreakdownLine[] | null {
  const items: readonly SitePriceBreakdownItem[] | undefined = quote.price_breakdown;
  if (items === undefined || items.length === 0) return null;
  const total = minorOf(quote.price.total);
  if (total === null) return null;
  let sum = 0;
  for (const item of items) {
    if (item.amount.currency !== quote.price.total.currency) return null;
    const minor = minorOf(item.amount);
    if (minor === null) return null;
    sum += minor;
  }
  if (sum !== total) return null;
  const lines: BreakdownLine[] = [];
  items.forEach((item, index) => {
    if (HIDDEN_WHEN_ZERO.has(item.kind) && minorOf(item.amount) === 0) return;
    let label: string;
    if (item.kind === "base") label = packageHours === null ? "基础价" : `包车套餐 ${packageHours} 小时`;
    else {
      const name = item.area_name === null ? null : displayName(item.area_name).text;
      const detail = [name, item.kind === "waypoint" && item.stop_seqs !== null && item.stop_seqs.length > 0 ? seqText(item.stop_seqs) : null].filter((part): part is string => part !== null);
      label = `${KIND_LABELS[item.kind] ?? "其他费用"}${detail.length > 0 ? `（${detail.join("，")}）` : ""}`;
    }
    lines.push({ key: `${item.kind}-${index}`, label, amount: moneyText(item.amount) });
  });
  return lines;
}

/** 行程时间表的一行：上车、经停、下车；`driveMinutes` 是从上一个点开过来的行驶分钟（第一行、没有路线时为 null） */
export interface ScheduleRow {
  key: string;
  kind: "pickup" | "stop" | "dropoff";
  label: string;
  name: string;
  stayMinutes: number | null;
  driveMinutes: number | null;
}

/** 上车 → 经停 1…N → 下车。`legs` 按顺序是每一段的行驶分钟（有路线时才有；段数对不上时不写行驶分钟）。 */
export function scheduleRows(pickup: string, dropoff: string | null, stops: readonly { name: string; stay_minutes: number }[], legs: readonly { minutes: number }[] | null = null): ScheduleRow[] {
  const usable = legs !== null && legs.length === stops.length + (dropoff === null ? 0 : 1) ? legs : null;
  const rows: ScheduleRow[] = [{ key: "pickup", kind: "pickup", label: "上车", name: pickup, stayMinutes: null, driveMinutes: null }];
  stops.forEach((stop, index) => rows.push({ key: `stop-${index}`, kind: "stop", label: `经停 ${index + 1}`, name: stop.name, stayMinutes: stop.stay_minutes, driveMinutes: usable?.[index]?.minutes ?? null }));
  if (dropoff !== null) rows.push({ key: "dropoff", kind: "dropoff", label: "下车", name: dropoff, stayMinutes: null, driveMinutes: usable?.[stops.length]?.minutes ?? null });
  return rows;
}

/** 经停点报不出价（`WAYPOINT_NOT_PRICED`）：「第 2 个经停点「河口湖」暂时没有在线报价……」；没有这个原因时空数组 */
export function waypointUnavailableTexts(unavailable: SiteQuoteResult["unavailable"], stops: readonly { name: string }[]): string[] {
  const seqs = [...new Set(unavailable.filter((entry) => entry.reasons.includes("WAYPOINT_NOT_PRICED")).flatMap((entry) => entry.waypoint_stop_seqs ?? []))].sort((a, b) => a - b);
  const named = seqs.filter((seq) => stops[seq - 1] !== undefined).map((seq) => `第 ${seq} 个经停点「${(stops[seq - 1] as { name: string }).name}」`);
  if (named.length === 0) return unavailable.some((entry) => entry.reasons.includes("WAYPOINT_NOT_PRICED")) ? ["有经停点暂时没有在线报价，请联系客服人工报价，或去掉这个经停点再试。"] : [];
  return [`${named.join("、")}暂时没有在线报价，请联系客服人工报价，或去掉这个经停点再试。`];
}
