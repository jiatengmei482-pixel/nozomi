/**
 * 按两个坐标报价（M8-02，ADR 0069 A1）：客人只给出发地、目的地两个坐标（和地址搜索给的类型），这里替他认出机场、判断接机 / 送机 / 点对点、
 * 点对点落在哪个城市。只有不碰数据库和网络的规则；认出来之后由 `apps/api/src/services/site.ts` 组装成现有的询价请求、走现有的报价（价格规则不变）。
 */
import { type LatLng, haversineMeters, isValidLatLng } from "./geo.ts";
import type { PlaceKind } from "./place-search.ts";
import { cityBounds, inBounds } from "./place-search.ts";

export const BY_POINTS_RULES = {
  /** 坐标离某个启用的机场不超过这么远（米）就当作这个机场（业主 2026-11-09 定的 3 公里） */
  airportRadiusMeters: 3_000,
  /**
   * 地址搜索说这一端是机场（`kind: airport`），但离平台的机场坐标超过 3 公里时，最多再放宽到这么远（米）：
   * 谷歌给的机场坐标和平台主数据的机场坐标可以差一两公里（大机场的几个航站楼相隔几公里）。再远就不认（不能把别的小机场当成它）
   */
  airportKindRadiusMeters: 10_000,
} as const;

/** 一端：坐标和地址搜索给的类型（客人手填、地图选点的没有类型，为 null）。 */
export interface TripEnd extends LatLng {
  kind: PlaceKind | null;
}

/** 认机场的候选：平台主数据里启用的机场（调用方只给渠道授权范围里、城市启用的）。 */
export interface AirportCandidate extends LatLng {
  id: string;
}

export interface AirportMatch<T extends AirportCandidate> {
  airport: T;
  /** 这一端离机场坐标多远（米，取整） */
  meters: number;
  /** `distance`：3 公里以内；`kind`：地址搜索说是机场、在放宽的范围以内 */
  matchedBy: "distance" | "kind";
}

/** 离这个点最近的机场：距离一样时按编号的字典序（结果确定、可复算）。 */
function nearest<T extends AirportCandidate>(point: LatLng, airports: readonly T[]): { airport: T; meters: number } | null {
  let best: { airport: T; meters: number } | null = null;
  for (const airport of airports) {
    const meters = haversineMeters(point, airport);
    if (best === null || meters < best.meters || (meters === best.meters && airport.id < best.airport.id)) best = { airport, meters };
  }
  return best;
}

/**
 * 这一端是不是机场：离最近的机场 ≤ 3 公里；或者地址搜索说是机场、离最近的机场 ≤ 10 公里。几个机场都在范围内取最近的。不是机场为 null。
 */
export function recognizeAirport<T extends AirportCandidate>(end: TripEnd, airports: readonly T[]): AirportMatch<T> | null {
  if (!isValidLatLng(end)) throw new RangeError("无效坐标");
  const found = nearest(end, airports);
  if (found === null) return null;
  const meters = Math.round(found.meters);
  if (found.meters <= BY_POINTS_RULES.airportRadiusMeters) return { airport: found.airport, meters, matchedBy: "distance" };
  if (end.kind === "airport" && found.meters <= BY_POINTS_RULES.airportKindRadiusMeters) return { airport: found.airport, meters, matchedBy: "kind" };
  return null;
}

/** 行程类型：`pickup` 接机（机场 → 地址）、`dropoff` 送机（地址 → 机场）、`point_to_point` 点对点。 */
export const POINTS_TRIP_TYPES = ["pickup", "dropoff", "point_to_point"] as const;
export type PointsTripType = (typeof POINTS_TRIP_TYPES)[number];

export type PointsTrip<T extends AirportCandidate> =
  /** 接机：出发地是机场；`address` 是目的地（地址那一端） */
  | { tripType: "pickup"; airport: AirportMatch<T>; address: LatLng }
  /** 送机：目的地是机场；`address` 是出发地 */
  | { tripType: "dropoff"; airport: AirportMatch<T>; address: LatLng }
  | { tripType: "point_to_point"; pickup: LatLng; dropoff: LatLng };

/**
 * 判断方向（ADR 0069 A1）：出发地是机场 → 接机；目的地是机场 → 送机；两端都是机场 → 按出发地算接机（目的地当地址那一端）；两端都不是 → 点对点。
 * 另给两端各自的识别结果（询价日志要记）。
 */
export function classifyPointsTrip<T extends AirportCandidate>(pickup: TripEnd, dropoff: TripEnd, airports: readonly T[]): { trip: PointsTrip<T>; pickupAirport: AirportMatch<T> | null; dropoffAirport: AirportMatch<T> | null } {
  const pickupAirport = recognizeAirport(pickup, airports);
  const dropoffAirport = recognizeAirport(dropoff, airports);
  const point = (end: TripEnd): LatLng => ({ lat: end.lat, lng: end.lng });
  if (pickupAirport !== null) return { trip: { tripType: "pickup", airport: pickupAirport, address: point(dropoff) }, pickupAirport, dropoffAirport };
  if (dropoffAirport !== null) return { trip: { tripType: "dropoff", airport: dropoffAirport, address: point(pickup) }, pickupAirport, dropoffAirport };
  return { trip: { tripType: "point_to_point", pickup: point(pickup), dropoff: point(dropoff) }, pickupAirport, dropoffAirport };
}

/** 选城市的候选：城市编号和中心坐标（调用方只给官网能订点对点的城市）。 */
export interface CityCandidate {
  id: string;
  center: LatLng;
}

/**
 * 点对点按出发地落在哪个城市报价：出发地在城市中心周围的范围里（和地址搜索同一个范围，`cityBounds`）的城市里，中心最近的那个；
 * 距离一样按编号的字典序。都不在为 null（不在服务范围）。区域和商品都挂在城市上，跨城市的行程按出发地的城市（ADR 0069 B8 待核对）；
 * 出发地不在任何城市时改看目的地，见 `pointToPointCityOf`（M8-35）。
 */
export function serviceCityOf<C extends CityCandidate>(point: LatLng, cities: readonly C[]): C | null {
  if (!isValidLatLng(point)) throw new RangeError("无效坐标");
  let best: { city: C; meters: number } | null = null;
  for (const city of cities) {
    if (!inBounds(point, cityBounds(city.center))) continue;
    const meters = haversineMeters(point, city.center);
    if (best === null || meters < best.meters || (meters === best.meters && city.id < best.city.id)) best = { city, meters };
  }
  return best?.city ?? null;
}

/**
 * 点对点按哪个城市报价（M8-35）：出发地落在某个城市的范围里就用它（和以前一模一样，`serviceCityOf`）；
 * 出发地哪个城市都不在、目的地在时用目的地的城市——往返对称：「银座 → 轻井泽」能报，「轻井泽 → 银座」也该能报。
 * 能不能报仍由那个城市里商品的区域决定（两端都要落在商品的区域里，规则不变）。两端都不在为 null。
 */
export function pointToPointCityOf<C extends CityCandidate>(pickup: LatLng, dropoff: LatLng, cities: readonly C[]): C | null {
  return serviceCityOf(pickup, cities) ?? serviceCityOf(dropoff, cities);
}
