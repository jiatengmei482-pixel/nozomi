/**
 * 新预订页（`/book/new`，M8-03，ADR 0069 A3 和「修正版 v2」；规范 docs/design/pages/site-booking-v2.md）的小规则：
 * 链接参数、报不出价的说法、车型列表默认显示几个、乘客 / 行李栏的写法、车内俯视示意图的排布。
 * 价格、报价、下单逻辑都不在这里：报价走 `POST /site/v1/quotes/by-points`（包车走 `POST /site/v1/quotes`），只负责显示。
 */
import type { SitePlaceKind, SiteUnavailableReason } from "../api/site.ts";
import { UNAVAILABLE_REASON_TEXT } from "./site-display.ts";

export const SITE_NEW_BOOKING_PATH = "/book/new";

/** 乘客、行李的上下限（和询价接口一致）。 */
export const TRAVELLER_LIMITS = { passengers: { min: 1, max: 60 }, luggage: { min: 0, max: 60 } } as const;

/** 车型列表默认显示几个：电脑（≥ 1024px）4 个，手机 3 个，其余点「显示全部」。 */
export const VISIBLE_VEHICLES = { wide: 4, narrow: 3 } as const;

/** 「乘客 / 行李」合并栏里的写法：`2 人 · 2 件`。 */
export function travellersText(passengers: number, luggage: number): string {
  return `${passengers} 人 · ${luggage} 件`;
}

// ---- 链接参数（ADR 0069 A3）：from / to / date / time / pax / bags，打开即报价；不合法的只是不预填 ----

/** 链接里的一端：平台地点的编码，或「纬度,经度」（可带名称）。 */
export type LinkEnd = { kind: "code"; code: string } | { kind: "point"; lat: number; lng: number; name: string | null };

export interface BookingLink {
  from: LinkEnd | null;
  to: LinkEnd | null;
  date: string | null;
  time: string | null;
  passengers: number | null;
  luggage: number | null;
}

const CODE = /^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$/;
const POINT = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

function cleanName(value: string | null): string | null {
  if (value === null) return null;
  const text = value.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/gu, " ").trim();
  return text === "" ? null : [...text].slice(0, 120).join("");
}

function linkEnd(value: string | null, name: string | null): LinkEnd | null {
  if (value === null) return null;
  const point = POINT.exec(value);
  if (point !== null) {
    const lat = Number(point[1]);
    const lng = Number(point[2]);
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { kind: "point", lat, lng, name: cleanName(name) };
  }
  const code = value.trim();
  return CODE.test(code) ? { kind: "code", code } : null;
}

function validDate(value: string | null): string | null {
  if (value === null || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const at = new Date(Date.UTC(year, month - 1, day));
  return at.getUTCFullYear() === year && at.getUTCMonth() === month - 1 && at.getUTCDate() === day ? value : null;
}

function validTime(value: string | null): string | null {
  if (value === null) return null;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  return match !== null && Number(match[1]) < 24 && Number(match[2]) < 60 ? value : null;
}

function count(value: string | null, limits: { min: number; max: number }): number | null {
  if (value === null || !/^\d{1,2}$/.test(value)) return null;
  const number = Number(value);
  return number >= limits.min && number <= limits.max ? number : null;
}

/** 读链接参数：每一项单独判断，不合法的那一项为 null（页面不预填，不报错）。 */
export function parseBookingLink(search: string): BookingLink {
  const params = new URLSearchParams(search);
  return {
    from: linkEnd(params.get("from"), params.get("from_name")),
    to: linkEnd(params.get("to"), params.get("to_name")),
    date: validDate(params.get("date")),
    time: validTime(params.get("time")),
    passengers: count(params.get("pax"), TRAVELLER_LIMITS.passengers),
    luggage: count(params.get("bags"), TRAVELLER_LIMITS.luggage),
  };
}

// ---- 一端（出发地、目的地、包车上车点） ----

/** 选好的一个地点：名称（给司机看的地址文字，也是按两个坐标报价的 `name`）、坐标、地址搜索给的类型（手填、地图选点、链接给的坐标为 null）。 */
export interface TripPoint {
  name: string;
  lat: number;
  lng: number;
  kind: SitePlaceKind | null;
}

/** 地图上选的、链接里只有坐标的点没有名称时写什么。 */
export function pointName(lat: number, lng: number): string {
  return `地图上选的位置（${lat.toFixed(5)}, ${lng.toFixed(5)}）`;
}

// ---- 报不出价（ADR 0069 A3）：按原因给说法，不显示内部代码 ----

/** 新预订页的说法：时间太近、人数太多、地址不在服务范围这三种按方案写；没有商品也当作「这个地址暂时没有在线报价」；其余沿用询价页的说法。 */
const NEW_REASON_TEXT: Partial<Record<SiteUnavailableReason, string>> = {
  LEAD_TIME_TOO_SHORT: "时间太近，请选更晚的时间或联系客服",
  CAPACITY_EXCEEDED: "人数或行李超过所有车型，可以分两辆车预订或联系客服",
  OUT_OF_SERVICE_AREA: "这个地址暂时没有在线报价，请联系客服",
  NO_PRODUCT: "这个地址暂时没有在线报价，请联系客服",
};

/** 报不出价的说法（去重，按出现的先后）；有一条提到「联系客服」时 `support` 为 true（页面给出客服电话）。 */
export function rejectionTexts(reasons: readonly SiteUnavailableReason[]): { texts: string[]; support: boolean } {
  const texts = [...new Set((reasons.length > 0 ? reasons : (["NOT_AVAILABLE"] as const)).map((reason) => NEW_REASON_TEXT[reason] ?? UNAVAILABLE_REASON_TEXT[reason]))];
  return { texts, support: texts.some((text) => text.includes("联系客服")) };
}

// ---- 车内俯视示意图（ADR 0069「车内俯视示意图」）：按最多乘客 N、最多行李 M 自动排 ----

export interface SeatBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SeatPlan {
  width: number;
  height: number;
  /** 车身外框 */
  body: SeatBox;
  /** 前挡风玻璃那条线的 y */
  glassY: number;
  driver: SeatBox;
  /** 乘客座位，编号 1–N（前排副驾驶是 1，往后一排一排从左到右） */
  seats: (SeatBox & { number: number })[];
  /** 行李位，编号 1–M（在座位后面的行李区） */
  bags: (SeatBox & { number: number })[];
  /** 座位区和行李区之间的分隔线 y；没有行李为 null */
  trunkY: number | null;
}

export const SEAT_PLAN_SIZES = { seat: 40, bagHeight: 28, gap: 8, padding: 16, hood: 32, trunkGap: 16 } as const;

/** 后排每排几个座位：2 列或 3 列（人多的车 3 列；很大的车 4 列，示意图不至于太长）。 */
function backColumns(rest: number): number {
  if (rest <= 2) return 2;
  if (rest === 3) return 3;
  if (rest === 4) return 2;
  return rest <= 12 ? 3 : 4;
}

/**
 * 排座位：前排是司机（右侧）和 1 号座位，后面 N − 1 个座位按 2 / 3 列一排排往后；行李位在座位后面，和座位同样的列数。
 * 只是示意，不代表实际车型的座位布局（页面上注明「示意图」）。
 */
export function seatPlan(passengers: number, luggage: number): SeatPlan {
  const { seat, bagHeight, gap, padding, hood, trunkGap } = SEAT_PLAN_SIZES;
  const total = Math.max(1, Math.floor(passengers));
  const bagsCount = Math.max(0, Math.floor(luggage));
  const columns = backColumns(total - 1);
  const inner = columns * seat + (columns - 1) * gap;
  const left = padding * 2;
  const top = padding;
  const slotX = (column: number, inRow: number): number => left + (inner - (inRow * seat + (inRow - 1) * gap)) / 2 + column * (seat + gap);
  const glassY = top + hood;
  const frontY = glassY + gap;
  const driver = { x: left + inner - seat, y: frontY, width: seat, height: seat };
  const seats: SeatPlan["seats"] = [{ number: 1, x: left, y: frontY, width: seat, height: seat }];
  let y = frontY + seat + gap * 2;
  let next = 2;
  while (next <= total) {
    const inRow = Math.min(columns, total - next + 1);
    for (let column = 0; column < inRow; column += 1) seats.push({ number: next + column, x: slotX(column, inRow), y, width: seat, height: seat });
    next += inRow;
    y += seat + gap;
  }
  let trunkY: number | null = null;
  const bags: SeatPlan["bags"] = [];
  if (bagsCount > 0) {
    trunkY = y + trunkGap / 2 - gap / 2;
    y = trunkY + trunkGap / 2 + gap / 2;
    let placed = 1;
    while (placed <= bagsCount) {
      const inRow = Math.min(columns, bagsCount - placed + 1);
      for (let column = 0; column < inRow; column += 1) bags.push({ number: placed + column, x: slotX(column, inRow), y, width: seat, height: bagHeight });
      placed += inRow;
      y += bagHeight + gap;
    }
  }
  const body = { x: padding, y: top, width: inner + padding * 2, height: y - gap + padding - top };
  return { width: body.width + padding * 2, height: body.y + body.height + padding, body, glassY, driver, seats, bags, trunkY };
}
