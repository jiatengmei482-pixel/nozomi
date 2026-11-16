/**
 * 包车经停点和按行程计价（M9W-02，ADR 0088；需求 charter-waypoint-surcharge.md 13.5）：页面用的纯逻辑。
 * - 经停点的草稿（地点 + 停留时长）、校验（地点、停留都必填）、询价请求里的 `waypoints`；
 * - 按行程计价时的说法：「按行程预计 X 小时 Y 分，套餐 N 小时」；
 * - 对外价明细（`price_breakdown`）的每一行；各项之和对不上总价时不显示明细（只显示总价，价格不能显示错）；
 * - 行程时间表（上车 → 经停 1…N → 下车，各段行驶分钟、各点停留）；
 * - 经停点报不出价（`WAYPOINT_NOT_PRICED`）时指出是哪个经停点。
 * 编号（M9P-20，ADR 0096 第二节第 3 小节）：上车 = 1、经停依次、下车 = 最后，和行程地图的标记同一个函数（domain 的 `stopNumbers`）；
 * 接口里的经停序号（stopSeq，从 1 起）一律经 `displayStopNumber` 换成显示编号（= stopSeq + 1）。
 */
import { scenarioPackageLabel } from "./charter-airport-copy.ts";
import { CHARTER_ITINERARY_LIMITS, ITINERARY_MAP_RULES, displayStopNumber, isArriveByTime, isCurrencyCode, legStopNumbers, parseMajor, stopNumbers } from "@nozomi/domain";
import type { SiteMoney, SiteOrder, SitePriceBreakdownItem, SiteQuote, SiteQuoteResult } from "../api/site.ts";
import { arriveByDeadlineText, draftArriveBy } from "./arrive-by-display.ts";
import type { TripPoint } from "./book-new.ts";
import { moneyText } from "./dispatch-display.ts";
import { itineraryCopy } from "./itinerary-texts.ts";
import { displayName } from "./master-display.ts";

/** 订单上的一个经停点（M9W-01）：名称、坐标、停留分钟 */
export type OrderWaypoint = NonNullable<SiteOrder["waypoints"]>[number];
/** 包车按行程计价锁定在订单上的量（M9W-01）：全程米数、总时长（行驶 + 停留）、套餐含量、超出量；没有金额 */
export type OrderItinerary = NonNullable<SiteOrder["itinerary"]>;
/** 包车按行程计价时服务器算的路线（M9W-01）：逐段行驶、行驶 / 停留合计、总时长、全程 */
export type SiteItineraryRoute = NonNullable<SiteQuoteResult["itinerary_route"]>;

/** 最多几个经停点：和后端同一个常量（M9P-10，只受路径接口上限，`CHARTER_ITINERARY_LIMITS`） */
export const MAX_WAYPOINTS = CHARTER_ITINERARY_LIMITS.maxWaypoints;
/** 停留时长一档 30 分钟，最长 8 小时 */
export const STAY_STEP_MINUTES = 30;
export const STAY_MAX_MINUTES = 480;
export const STAY_OPTIONS: readonly number[] = Array.from({ length: STAY_MAX_MINUTES / STAY_STEP_MINUTES }, (_, index) => (index + 1) * STAY_STEP_MINUTES);

/** 按行程计价时给客人的提示（车型卡、右侧栏、核对页） */
export const ITINERARY_NOTE = "价格按您填的经停点计算；当天临时去其他区域或超出预计可能会加收。";

/**
 * 页面上的一个经停点：`key` 只在页面里用（排序时跟着走）；`stay` 是下拉的值（分钟数的字符串，没选为空）；
 * `arriveBy` 是「指定到达时间（选填）」的时刻 HH:MM（M9P-20 P3，没填为空或没有），当天还是次日按出发时刻推断
 */
export interface WaypointDraft {
  key: string;
  point: TripPoint | null;
  stay: string;
  arriveBy?: string;
}

let nextKey = 0;
export function newWaypoint(): WaypointDraft {
  nextKey += 1;
  return { key: `wp-${nextKey}`, point: null, stay: "", arriveBy: "" };
}

/** 这一行指定了到达时间（填了合格的时刻）：锁定，不能拖、不参与建议顺序 */
export function waypointLocked(entry: Pick<WaypointDraft, "arriveBy">): boolean {
  return entry.arriveBy !== undefined && isArriveByTime(entry.arriveBy);
}

/** 「4 小时 12 分钟」「5 小时」「45 分钟」：价格明细里的预计用时（ADR 0091 第一节，不四舍五入到小时） */
export function hoursMinutesText(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} 分钟`;
  return rest === 0 ? `${hours} 小时` : `${hours} 小时 ${rest} 分钟`;
}

/**
 * 套餐那一行下面的预计用时（ADR 0091 第一节、M9P-04）：「预计用时 4 小时 12 分钟（含缓冲）」；没含经停点占用或缓冲时不写「（含缓冲）」。
 * 预计用时比套餐长（只有最长一档可选）时接着说超出部分服务后收（ADR 0091 业主确认第 1 条；接口没有对外的超时单价，先不写单价）。
 * 不是按行程计价的报价（没有 `estimated_minutes`）为 null。
 */
export function estimatedTimeText(quote: Pick<SiteQuote, "estimated_minutes" | "includes_buffer">, packageHours: number | null): string | null {
  const minutes = quote.estimated_minutes;
  if (typeof minutes !== "number") return null;
  const text = `预计用时 ${hoursMinutesText(minutes)}${quote.includes_buffer === true ? "（含缓冲）" : ""}`;
  return packageHours !== null && minutes > packageHours * 60 ? `${text}，超过套餐时长，超出部分服务后按实际收取` : text;
}

/** 「30 分钟」「1 小时」「1 小时 30 分」 */
export function durationText(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} 分钟`;
  return rest === 0 ? `${hours} 小时` : `${hours} 小时 ${rest} 分`;
}

export type WaypointErrors = Record<string, { point?: string; stay?: string; arriveBy?: string }>;

/** 每个经停点：地点要从候选里选，停留时长要选（30 分钟一档）；指定到达时间选填，填了要是 HH:MM。没有问题时是空对象。 */
export function waypointErrors(list: readonly WaypointDraft[]): WaypointErrors {
  const errors: WaypointErrors = {};
  list.forEach((entry, index) => {
    const found: { point?: string; stay?: string; arriveBy?: string } = {};
    if (entry.point === null) found.point = `请选择第 ${index + 1} 个经停点，或删除这一行`;
    if (!STAY_OPTIONS.includes(Number(entry.stay)) || entry.stay === "") found.stay = "请选择停留时长";
    if (entry.arriveBy !== undefined && entry.arriveBy !== "" && !isArriveByTime(entry.arriveBy)) found.arriveBy = itineraryCopy("arriveByFormat");
    if (found.point !== undefined || found.stay !== undefined || found.arriveBy !== undefined) errors[entry.key] = found;
  });
  return errors;
}

/**
 * 询价请求里的 `waypoints`：都填好了才有；有没填好的为 null（不报价）；一个都没有为空数组。
 * 填了指定到达时间的带 `arrive_by`（不晚于出发时刻 `startTime` 的按次日，M9P-20 P3）；没填的不带这个键，请求和以前一样
 */
export function waypointsBody(list: readonly WaypointDraft[], startTime = ""): OrderWaypoint[] | null {
  if (Object.keys(waypointErrors(list)).length > 0) return null;
  return list.map((entry) => {
    const point = entry.point as TripPoint;
    const arriveBy = draftArriveBy(entry.arriveBy, startTime);
    return { name: point.name, lat: point.lat, lng: point.lng, stay_minutes: Number(entry.stay), ...(arriveBy === null ? {} : { arrive_by: arriveBy }) };
  });
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

/** 把第 `from` 个经停点拖到第 `to` 个的位置（拖动排序，M9P-20 P2）；越界或没动时原样返回 */
export function moveWaypointTo<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return [...list];
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as T);
  return next;
}

/** 服务器按行程选的套餐时长：每个报价的 `package.hours`（每个车型组各自选） */
export function itineraryPackageHours(quote: Pick<SiteQuote, "package"> | null): number | null {
  return quote?.package?.hours ?? null;
}

/** 各车型自动选的套餐（车型组编号 → 小时）：报价里的 `auto_package_hours`（客人手动升档时报价照样带着自动会选的档）；旧接口没有这一项的不在里面 */
export function autoPackageHoursByVehicle(quotes: readonly Pick<SiteQuote, "vehicle_group" | "auto_package_hours">[]): Record<string, number> {
  return Object.fromEntries(quotes.flatMap((quote) => (typeof quote.auto_package_hours === "number" ? [[quote.vehicle_group.id, quote.auto_package_hours] as const] : [])));
}

/** 套餐下拉的默认项：`label` 是「自动（N 小时）」，`floor` 是能升到的档要比它长的那一档 */
export interface AutoPackageChoice {
  label: string;
  floor: number;
}

/**
 * 有经停点时套餐下拉的默认项（M9P-04，M9P-03 验收后续）：各车型自动选的档可能不同（同一段行程，经济 7 座 5 小时、别的车型 4 小时），
 * 所以按客人选的车型写它自己的档，只列比它长的；还没选车型时，各车型一样就写这一档，不一样就写「自动（按车型 4–5 小时）」，
 * 只列比最长的那一档还长的（选了哪个都不会短于任何车型的预计用时）。`autoByVehicle` 是这段行程各车型的自动档；一个都不知道时为 null。
 */
export function autoPackageChoice(autoByVehicle: Readonly<Record<string, number>>, selectedId: string | null, shownIds: readonly string[]): AutoPackageChoice | null {
  const own = selectedId === null ? undefined : autoByVehicle[selectedId];
  if (own !== undefined) return { label: `自动（${own} 小时）`, floor: own };
  const known = shownIds.flatMap((id) => (autoByVehicle[id] === undefined ? [] : [autoByVehicle[id] as number]));
  const hours = known.length > 0 ? known : Object.values(autoByVehicle);
  if (hours.length === 0) return null;
  const low = Math.min(...hours);
  const high = Math.max(...hours);
  return { label: low === high ? `自动（${low} 小时）` : `自动（按车型 ${low}–${high} 小时）`, floor: high };
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
  const index = typeof leg === "number" && Number.isInteger(leg) && leg >= 1 ? leg : null;
  const from = index === null ? undefined : points[index - 1];
  const to = index === null ? undefined : points[index];
  const numbers = index === null ? null : legStopNumbers(index);
  const where = from !== undefined && to !== undefined && numbers !== null ? itineraryCopy("legFailure", { leg: index as number, from: numbers[0], fromName: from, to: numbers[1], toName: to }) : "有一段";
  return `${where}路线暂时算不出来，没有在线报价。请联系客服人工报价，或调整经停点再试。`;
}

export interface BreakdownLine {
  key: string;
  label: string;
  amount: string;
  /** 写在这一行下面的小字（套餐那一行的预计用时） */
  note?: string;
}

const KIND_LABELS: Readonly<Record<string, string>> = {
  pickup: "上车加价",
  dropoff: "下车加价",
  waypoint: "行程加价",
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

/** 明细里的经停（M9P-20）：「3 · 经停」「2、3 · 经停」，编号 = stopSeq + 1，和行程列表、地图一致 */
function seqText(seqs: readonly number[]): string {
  return itineraryCopy("breakdownStops", { numbers: seqs.filter((seq) => Number.isInteger(seq) && seq >= 1).map(displayStopNumber).join("、") });
}

/** 明细的先后（ADR 0093 第二节「明细逐项」）：套餐、上车加价、下车加价、行程加价（按第几个经停，下车点那一条最后）、超公里费、超时费、调价、其他 */
const KIND_ORDER: readonly string[] = ["base", "pickup", "dropoff", "waypoint", "over_km", "overtime", "adjust", "other"];

function displayOrder(items: readonly SitePriceBreakdownItem[]): { item: SitePriceBreakdownItem; index: number }[] {
  const rank = (item: SitePriceBreakdownItem): number => (KIND_ORDER.includes(item.kind) ? KIND_ORDER.indexOf(item.kind) : KIND_ORDER.length);
  const firstStop = (item: SitePriceBreakdownItem): number => (item.from_dropoff === true ? Number.MAX_SAFE_INTEGER : Math.min(...(item.stop_seqs ?? []), Number.MAX_SAFE_INTEGER - 1));
  return items.map((item, index) => ({ item, index })).sort((a, b) => rank(a.item) - rank(b.item) || (a.item.kind === "waypoint" && b.item.kind === "waypoint" ? firstStop(a.item) - firstStop(b.item) : 0) || a.index - b.index);
}

/**
 * 对外价明细的每一行（按 `KIND_ORDER` 排：套餐、上车、下车、行程加价……）。没有明细、币种和总价不一样、某一项读不出来、**各项之和不等于总价**时为 null——
 * 页面这时只显示总价（宁可少显示，不能显示一组加起来对不上的数）。
 * 金额为 0 的超公里费、超时费不列（M8-43：没超出时客人不用看到「超公里费 0 JPY」）；先按全部项目核对总价再去掉，0 不影响各项之和。
 * 其他项目（包括金额为 0 的）照旧列出。
 */
export function breakdownLines(quote: Pick<SiteQuote, "price" | "price_breakdown"> & Partial<Pick<SiteQuote, "estimated_minutes" | "includes_buffer">>, packageHours: number | null): BreakdownLine[] | null {
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
  const estimate = estimatedTimeText({ estimated_minutes: quote.estimated_minutes ?? null, includes_buffer: quote.includes_buffer ?? null }, packageHours);
  const lines: BreakdownLine[] = [];
  for (const { item, index } of displayOrder(items)) {
    if (HIDDEN_WHEN_ZERO.has(item.kind) && minorOf(item.amount) === 0) continue;
    let label: string;
    // 机场开始 / 机场结束（ADR 0098）：套餐行显示场景名，如「成田机场接机 + 5 小时包车」
    if (item.kind === "base") label = packageHours === null ? "基础价" : item.scenario !== undefined ? scenarioPackageLabel(item.scenario, packageHours) : `包车套餐 ${packageHours} 小时`;
    else {
      const name = item.area_name === null ? null : displayName(item.area_name).text;
      const where = item.kind !== "waypoint" ? null : item.from_dropoff === true ? "下车点" : item.stop_seqs !== null && item.stop_seqs.length > 0 ? seqText(item.stop_seqs) : null;
      const detail = [name, where].filter((part): part is string => part !== null);
      label = `${KIND_LABELS[item.kind] ?? "其他费用"}${detail.length > 0 ? `（${detail.join("，")}）` : ""}`;
    }
    lines.push({ key: `${item.kind}-${index}`, label, amount: moneyText(item.amount), ...(item.kind === "base" && estimate !== null ? { note: estimate } : {}) });
  }
  return lines;
}

/**
 * 行程时间表的一行：上车、经停、下车。`number` 是编号（上车 = 1，和地图标记一致），`label` 是「1 上车」「2 经停」「5 下车」；
 * `driveMinutes`、`driveMeters` 是从上一个点开过来的行驶分钟和米数（第一行、没有路线时为 null）。
 */
export interface ScheduleRow {
  key: string;
  kind: "pickup" | "stop" | "dropoff";
  number: number;
  label: string;
  /** 「上车」「经停」「下车」（`label` 去掉编号） */
  kindName: string;
  name: string;
  stayMinutes: number | null;
  driveMinutes: number | null;
  driveMeters: number | null;
  /** 经停的指定到达时间（M9P-20 P3）：「须在 14:00 前到达」；没指定、上车下车为 null */
  deadline: string | null;
}

const KIND_NAMES: Readonly<Record<ScheduleRow["kind"], string>> = { pickup: itineraryCopy("pickup"), stop: itineraryCopy("stop"), dropoff: itineraryCopy("dropoff") };

/**
 * 上车 → 经停 → 下车，编号来自 domain 的 `stopNumbers`（地图标记同一个函数）。
 * `legs` 按顺序是每一段的行驶分钟和米数（报价应答的 `itinerary_route.legs`，有路线时才有；段数对不上时不写）。
 */
export function scheduleRows(pickup: string, dropoff: string | null, stops: readonly { name: string; stay_minutes: number; arrive_by?: unknown }[], legs: readonly { minutes: number; meters?: number }[] | null = null): ScheduleRow[] {
  const usable = legs !== null && legs.length === stops.length + (dropoff === null ? 0 : 1) ? legs : null;
  const points: { name: string; stay: number | null; deadline: string | null }[] = [
    { name: pickup, stay: null, deadline: null },
    ...stops.map((stop) => ({ name: stop.name, stay: stop.stay_minutes, deadline: arriveByDeadlineText(stop.arrive_by) })),
    ...(dropoff === null ? [] : [{ name: dropoff, stay: null, deadline: null }]),
  ];
  return stopNumbers(points, { hasDropoff: dropoff !== null }).map(({ number, kind, stopSeq, point }) => {
    const leg = number === 1 ? undefined : usable?.[number - 2];
    return {
      key: kind === "stop" ? `stop-${(stopSeq as number) - 1}` : kind,
      kind,
      number,
      label: `${number} ${KIND_NAMES[kind]}`,
      kindName: KIND_NAMES[kind],
      name: point.name,
      stayMinutes: point.stay,
      driveMinutes: leg?.minutes ?? null,
      driveMeters: typeof leg?.meters === "number" ? leg.meters : null,
      deadline: point.deadline,
    };
  });
}

/**
 * 行程地图要画的点（上车、经停、下车，按顺序）：最多 `ITINERARY_MAP_RULES.maxPoints`（12）个——标记只有 1–12 号（ADR 0096）。
 * 经停上限放开（M9P-10）以后超过 12 个点时为 null：不画图、只显示列表（列表编号不限个数），页面不报错。
 */
export function itineraryMapPoints(pickup: LatLngLike, stops: readonly LatLngLike[], dropoff: LatLngLike): LatLngLike[] | null {
  const points = [pickup, ...stops, dropoff].map((point) => ({ lat: point.lat, lng: point.lng }));
  return points.length <= ITINERARY_MAP_RULES.maxPoints ? points : null;
}

interface LatLngLike {
  lat: number;
  lng: number;
}

/** 行程地图的替代文字（ADR 0096 第二节第 3 小节）：「路线图：1 新宿 → 2 河口湖 → 3 新宿，约 6 小时 10 分 · 312 公里」；没有路线时只写各点。 */
export function itineraryMapAlt(rows: readonly ScheduleRow[], route: Pick<SiteItineraryRoute, "total_minutes" | "total_meters"> | null | undefined): string {
  const chain = rows.map((row) => `${row.number} ${row.name}`).join(" → ");
  return route === null || route === undefined ? itineraryCopy("mapAlt", { chain }) : itineraryCopy("mapAltTotal", { chain, duration: durationText(route.total_minutes), km: kmText(route.total_meters) });
}

/** 经停点报不出价（`WAYPOINT_NOT_PRICED`）：「第 2 个经停点「河口湖」暂时没有在线报价……」；没有这个原因时空数组 */
export function waypointUnavailableTexts(unavailable: SiteQuoteResult["unavailable"], stops: readonly { name: string }[]): string[] {
  const seqs = [...new Set(unavailable.filter((entry) => entry.reasons.includes("WAYPOINT_NOT_PRICED")).flatMap((entry) => entry.waypoint_stop_seqs ?? []))].sort((a, b) => a - b);
  const named = seqs.filter((seq) => stops[seq - 1] !== undefined).map((seq) => itineraryCopy("unavailableStop", { number: displayStopNumber(seq), name: (stops[seq - 1] as { name: string }).name }));
  if (named.length === 0) return unavailable.some((entry) => entry.reasons.includes("WAYPOINT_NOT_PRICED")) ? ["有经停点暂时没有在线报价，请联系客服人工报价，或去掉这个经停点再试。"] : [];
  return [`${named.join("、")}暂时没有在线报价，请联系客服人工报价，或去掉这个经停点再试。`];
}

/** 所选时长低于某些车型的最低套餐（M9P-04，ADR 0093 第四节第 7 条）：那些车型最短几小时、几个车型 */
export interface MinPackageHint {
  hours: number;
  count: number;
  text: string;
}

/**
 * 不填经停点、客人自选的时长比商品的最低套餐短：报不出的车型原因是 `PACKAGE_TOO_SHORT`，带着 `min_package_hours`。
 * 按最短时长分组，「有一个车型最短 5 小时」/「有 2 个车型最短 5 小时」（ADR 0093 写的「这个车型最短 X 小时」；报不出的车型应答里没有名称，所以写个数），页面配「改选 5 小时」按钮；只列比所选时长长的。没有这种情况时空数组
 */
export function minPackageHints(unavailable: SiteQuoteResult["unavailable"], chosenHours: number | null): MinPackageHint[] {
  const counts = new Map<number, number>();
  for (const entry of unavailable) {
    const hours = entry.min_package_hours;
    if (!entry.reasons.includes("PACKAGE_TOO_SHORT") || typeof hours !== "number" || (chosenHours !== null && hours <= chosenHours)) continue;
    counts.set(hours, (counts.get(hours) ?? 0) + 1);
  }
  return [...counts.entries()].sort(([a], [b]) => a - b).map(([hours, count]) => ({ hours, count, text: `${count === 1 ? "有一个车型" : `有 ${count} 个车型`}最短 ${hours} 小时${chosenHours === null ? "" : `，选 ${chosenHours} 小时订不了`}。` }));
}
