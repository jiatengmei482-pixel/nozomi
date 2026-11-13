/**
 * 订单行程 v1（需求 03 第 2.2 节、ADR 0087 第三节第 3 小节）：存在 `orders.itinerary`，所有新的官网订单都写；M9-02 之前的订单、`/sales/v1` 渠道订单为 null。
 *
 * - **没有任何金额**：只有地点、停留、计划时间、各段米数和分钟数、套餐时长和含公里数、预计超出的数量。对外金额只在平台侧，结算单价在结算价明细里。
 * - 由服务端从报价快照（和按行程询价时保存的行程，M9-03）算出后写入；客人提交的内容不直接进订单。
 * - 区间（接送机、点对点）是 `transfer`，按时长包车是 `charter_package`：地点就是上车点和下车点，各段、合计、预计超出要等按行程包车（`charter_route`，M9-03）才有。
 *
 * 键名直接是接口里的写法（下划线），存进库和给出去是同一份。
 */
import type { LocalizedText, ServiceCategory } from "./master-data.ts";

export const ORDER_ITINERARY_VERSION = 1;
export const ORDER_ITINERARY_MODES = ["transfer", "charter_package", "charter_route"] as const;
export type OrderItineraryMode = (typeof ORDER_ITINERARY_MODES)[number];
export const ORDER_STOP_ROLES = ["pickup", "via", "dropoff"] as const;
export type OrderStopRole = (typeof ORDER_STOP_ROLES)[number];

/** 订单从哪个入口来（只是记录：不改渠道、不改加价；`embed` 能被非浏览器程序伪造，只用于统计）。 */
export const ORDER_ENTRY_SOURCES = ["book", "route_template", "embed"] as const;
export type OrderEntrySource = (typeof ORDER_ENTRY_SOURCES)[number];

export interface OrderItineraryStop {
  /** 从 1 开始的顺序号 */
  seq: number;
  role: OrderStopRole;
  name: string;
  lat: number;
  lng: number;
  /** 途经点的停留分钟；上车点、下车点为 null */
  stay_minutes: number | null;
  /** 计划到达、计划出发（城市当地 `YYYY-MM-DDTHH:mm`）；算不出来的为 null（上车点没有到达、下车点没有出发） */
  planned_arrival_local: string | null;
  planned_departure_local: string | null;
}

export interface OrderItineraryLeg {
  from_seq: number;
  to_seq: number;
  meters: number;
  minutes: number;
}

export interface OrderItinerary {
  version: 1;
  mode: OrderItineraryMode;
  stops: OrderItineraryStop[];
  /** 各段；区间和按时长包车为空数组 */
  legs: OrderItineraryLeg[];
  /** 合计（分钟、米）；区间和按时长包车为 null */
  totals: { drive_minutes: number; stay_minutes: number; total_minutes: number; total_meters: number } | null;
  /** 包车的套餐时长（小时）和含公里数（不知道为 null）；区间为 null */
  package: { hours: number; km: number | null } | null;
  /** 预计超出的数量（只有按行程包车）：公里数、分钟数 */
  estimate: { over_km: number; overtime_minutes: number } | null;
}

export interface ItineraryEnd {
  name: string;
  lat: number;
  lng: number;
}

/** 机场 / 车站那一端在订单行程里的名称：中文名优先，再日文、英文、韩文，都没有用编码（和官网订单页的地点名称同一个顺序）。 */
export function placeStopName(name: LocalizedText, code: string): string {
  for (const text of [name.zh, name.ja, name.en, name.ko]) if (text !== undefined && text.trim() !== "") return text.trim();
  return code;
}

/** 下单时的行程方式：接送机、点对点是 `transfer`，包车（按时长）是 `charter_package`。 */
export function itineraryModeOf(category: ServiceCategory): OrderItineraryMode {
  return category === "charter" ? "charter_package" : "transfer";
}

/**
 * 区间、按时长包车的订单行程：上车点、下车点两个地点（包车没给下车点时只有上车点），停留为空；上车点的计划出发是用车时间。
 * 没有各段、合计、预计超出（这些只有按行程包车才有）。
 */
export function simpleOrderItinerary(input: { category: ServiceCategory; serviceLocal: string; packageHours: number | null; packageKm: number | null; pickup: ItineraryEnd | null; dropoff: ItineraryEnd | null }): OrderItinerary {
  const mode = itineraryModeOf(input.category);
  const ends: { role: OrderStopRole; end: ItineraryEnd }[] = [];
  if (input.pickup !== null) ends.push({ role: "pickup", end: input.pickup });
  if (input.dropoff !== null) ends.push({ role: "dropoff", end: input.dropoff });
  return {
    version: 1,
    mode,
    stops: ends.map(({ role, end }, index) => ({
      seq: index + 1,
      role,
      name: end.name,
      lat: end.lat,
      lng: end.lng,
      stay_minutes: null,
      planned_arrival_local: null,
      planned_departure_local: role === "pickup" ? input.serviceLocal : null,
    })),
    legs: [],
    totals: null,
    package: mode === "charter_package" && input.packageHours !== null ? { hours: input.packageHours, km: input.packageKm } : null,
    estimate: null,
  };
}
