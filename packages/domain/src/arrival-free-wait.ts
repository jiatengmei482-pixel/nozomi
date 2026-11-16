/**
 * 接机的免费等待按航班定（M9E-28，ADR 0097；监工替业主 2026-11-15 确认；2026-11-16 业主改为平台统一，M9E-31）。纯函数，不碰数据库和网络。
 *
 * - 国际航班一律 90 分钟、国内航班一律 60 分钟，所有机场一样，**不看商品自己设的分钟数**（商品设得更长、设「不限时」的也按 90 / 60）。
 * - 航班类型判断不出（客人没选、渠道没给）：按国内线 60 锁，订单标「航班类型未确认」（Q2）；对客人的文案写「国际线最长 90 分钟、国内线最长 60 分钟」。
 * - 下单确认时锁定；派单前改航班重新锁定，派单后不变（Q3，见 `relockAllowed`）。已有订单不回头改（Q4）。
 * - 接机：接送机商品的机场接机，以及认出机场、改用点对点商品报价、带了航班号的单（Q5）。接站、送机、其他点对点、包车不按这条。
 * - 航班类型先由客人填航班号时自己选（Q1 方案 B）；按航班号查航班数据另立任务（M9E-29）。
 */
import type { ServiceCategory } from "./master-data.ts";
import type { TripDirection } from "./pricing.ts";
import type { FreeWait } from "./products.ts";

export const FLIGHT_KINDS = ["international", "domestic"] as const;
export type FlightKind = (typeof FLIGHT_KINDS)[number];

/** 各类航班的平台统一分钟数（M9E-31 起不再是「下限」）。判断不出按国内线锁（Q2）。 */
export const ARRIVAL_FREE_WAIT_FLOOR: Readonly<Record<FlightKind, number>> = { international: 90, domestic: 60 };

/** 下单时锁定的依据（存进 `orders.free_wait_basis`，供应商和客服看「为什么是这个数」）。 */
export interface ArrivalFreeWaitBasis {
  /** 按哪种航班取的下限；null = 航班类型未确认（按国内线的下限） */
  flightKind: FlightKind | null;
  /** 商品自己设的免费等待（只留作记录：M9E-31 起机场接机不用它）；商品没设为 null */
  base: FreeWait | null;
  /** 这次取的平台统一分钟数（字段名沿用 M9E-28 的「下限」，存进订单的 JSON 不改名） */
  floorMinutes: number;
}

export interface ArrivalFreeWait {
  /** 最终给的分钟数；null = 不限时 */
  minutes: number | null;
  basis: ArrivalFreeWaitBasis;
}

/** 按航班锁定接机的免费等待：国际 90、国内 60、未确认按国内 60；商品设的分钟数（含「不限时」）只记进 `basis.base`，不参与计算（M9E-31）。 */
export function lockArrivalFreeWait(product: FreeWait | null, flightKind: FlightKind | null): ArrivalFreeWait {
  const floorMinutes = ARRIVAL_FREE_WAIT_FLOOR[flightKind ?? "domestic"];
  return { minutes: floorMinutes, basis: { flightKind, base: product, floorMinutes } };
}

/** 还不知道航班类型时给客人看的两个数（文案「国际线最长 90 分钟、国内线最长 60 分钟」）；和商品设的无关（M9E-31）。 */
export function arrivalFreeWaitRange(): { international: number; domestic: number } {
  return { international: ARRIVAL_FREE_WAIT_FLOOR.international, domestic: ARRIVAL_FREE_WAIT_FLOOR.domestic };
}

/** 这一单是不是按航班定免费等待的接机。 */
export function isFlightArrival(trip: { category: ServiceCategory; direction: TripDirection | null; placeType: string | null; flightNo: string | null }): boolean {
  if (trip.category === "airport_transfer") return trip.direction === "pickup" && trip.placeType === "airport";
  // 认出机场、改用点对点商品报价的接机（M8-33）：点对点单带了航班号就是从机场接人（Q5）
  if (trip.category === "point_to_point") return trip.flightNo !== null && trip.flightNo.trim() !== "";
  return false;
}

/** 下单后改航班号 / 航班类型时，能不能重新锁定免费等待：派单前（已确认、还没派司机）可以，派单后不变（Q3）。 */
export function relockAllowed(order: { status: string; driverId: string | null }): boolean {
  return (order.status === "pending_payment" || order.status === "confirmed") && order.driverId === null;
}
