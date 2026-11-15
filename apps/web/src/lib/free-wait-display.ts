/**
 * 免费等待按航班定（M9E-28，ADR 0097）的显示：供应商审批改单前看到同意后免费等待怎么变（2026-11-15 按推荐，审查建议 1）；
 * 客人订单页派单后写「按派单时的 X 航班锁定 N 分钟」（建议 6）。规则和服务端同一份领域函数。
 */
import { type FlightKind, type FreeWait, isFlightArrival, lockArrivalFreeWait, relockAllowed } from "@nozomi/domain";
import type { FreeWaitBasis } from "../api/dispatch.ts";

/**
 * 这一块新加的页面文字，按键集中在这里（业主 2026-11-15，M11-01：新功能先只做中文，文字走键、不写死在组件里）。
 * 等 M11-01 的多语言框架上线后整张表搬过去；日文、英文以后再补。
 */
export const FREE_WAIT_TEXTS = {
  minutes: (minutes: number | null): string => (minutes === null ? "不限时" : `${minutes} 分钟`),
  previewDispatched: (current: string): string => `已派车：同意后免费等待不变（${current}）`,
  previewUnchanged: (current: string): string => `同意后免费等待不变（${current}）`,
  previewChange: (from: string, to: string): string => `同意后免费等待 ${from} → ${to}`,
  dispatchedNote: (kind: string, minutes: number): string => `按派单时${kind}锁定 ${minutes} 分钟`,
  dispatchedKind: { international: "的国际航班", domestic: "的国内航班", unconfirmed: "航班类型未确认（按国内线）" },
  basisKind: { international: "国际航班", domestic: "国内航班", unconfirmed: "航班类型未确认，按国内线" },
  basisRaised: (base: string, minutes: number): string => `；${base}，按平台规定补到 ${minutes} 分钟`,
  baseNotSet: "商品没设",
  baseSet: (minutes: number): string => `商品设 ${minutes} 分钟`,
  flightKindLegend: "航班类型",
  flightKindHint: "按航班定免费等待：国际航班等得更久",
  flightKindDispatched: "已派车，免费等待不再变化",
  flightKindOption: (minutes: number): string => `落地后免费等待 ${minutes} 分钟`,
  p2pFlightHint: "如 NH211。清空表示不是从机场接人，免费等待回到商品的设置",
} as const;

interface ArrivalOrderShape {
  status: string;
  category: "airport_transfer" | "point_to_point" | "charter";
  direction: "pickup" | "dropoff" | null;
  flight_no: string | null;
  flight_kind?: FlightKind | null;
  free_wait_minutes: number | null;
  free_wait_basis?: FreeWaitBasis | null;
}

/** 商品自己设的免费等待：下单时锁定的依据里有；以前的单没有依据，这一单的分钟数就是商品设的值。 */
export function productFreeWait(order: Pick<ArrivalOrderShape, "free_wait_minutes" | "free_wait_basis">): FreeWait | null {
  if (order.free_wait_basis !== null && order.free_wait_basis !== undefined) return order.free_wait_basis.base;
  return order.free_wait_minutes === null ? { mode: "unlimited" } : { mode: "limited", minutes: order.free_wait_minutes };
}

/** 这一单是不是机场接机（送机、接站、包车不按航班定；点对点看有没有航班号）。前端拿不到接送点类型：接送机按「有依据或有航班号」认。 */
function arrivalOf(order: ArrivalOrderShape, flightNo: string | null): boolean {
  if (order.category === "airport_transfer") return order.direction === "pickup" && ((order.free_wait_basis ?? null) !== null || order.flight_no !== null);
  return isFlightArrival({ category: order.category, direction: order.direction, placeType: null, flightNo });
}

const minutesText = FREE_WAIT_TEXTS.minutes;

/**
 * 供应商审批一条改单时的提示（ADR 0097 Q3：以供应商同意、改单生效的这一刻为准）：改了航班号 / 航班类型的接机，
 * 还没派司机写「同意后免费等待 60 → 90 分钟」或「同意后免费等待不变」，已派司机写「已派车：同意后免费等待不变」。其他改单为 null。
 */
export function changeFreeWaitPreview(order: ArrivalOrderShape & { dispatch: { driver: unknown } }, after: Record<string, unknown>): string | null {
  const touchesFlight = Object.hasOwn(after, "flight_no") || Object.hasOwn(after, "flight_kind");
  if (!touchesFlight) return null;
  const flightNo = Object.hasOwn(after, "flight_no") ? ((after["flight_no"] as string | null) ?? null) : order.flight_no;
  const arrivalNow = arrivalOf(order, order.flight_no);
  const arrivalAfter = arrivalOf(order, flightNo);
  if (!arrivalNow && !arrivalAfter) return null;
  if (!relockAllowed({ status: order.status, driverId: order.dispatch.driver === null ? null : "assigned" })) return FREE_WAIT_TEXTS.previewDispatched(minutesText(order.free_wait_minutes));
  const product = productFreeWait(order);
  const kind = Object.hasOwn(after, "flight_kind") ? ((after["flight_kind"] as FlightKind | null) ?? null) : (order.flight_kind ?? null);
  const next = arrivalAfter ? lockArrivalFreeWait(product, kind).minutes : product !== null && product.mode === "limited" ? product.minutes : null;
  if (next === order.free_wait_minutes) return FREE_WAIT_TEXTS.previewUnchanged(minutesText(next));
  return typeof next === "number" && typeof order.free_wait_minutes === "number" ? FREE_WAIT_TEXTS.previewChange(String(order.free_wait_minutes), minutesText(next)) : FREE_WAIT_TEXTS.previewChange(minutesText(order.free_wait_minutes), minutesText(next));
}

/**
 * 客人订单页派单后的免费等待说明（2026-11-15 按推荐，审查建议 6）：「按派单时的国际航班锁定 90 分钟」；
 * 航班类型未确认写「按派单时航班类型未确认（按国内线）锁定 60 分钟」。没派单、没按航班锁定、不限时的为 null。
 */
export function dispatchedFreeWaitNote(order: Pick<ArrivalOrderShape, "free_wait_minutes" | "free_wait_basis"> & { dispatched: boolean }): string | null {
  const basis = order.free_wait_basis ?? null;
  if (!order.dispatched || basis === null || order.free_wait_minutes === null) return null;
  return FREE_WAIT_TEXTS.dispatchedNote(FREE_WAIT_TEXTS.dispatchedKind[basis.flight_kind ?? "unconfirmed"], order.free_wait_minutes);
}
