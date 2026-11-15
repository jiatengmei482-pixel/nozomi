/**
 * 免费等待按航班定（M9E-28，ADR 0097）的显示：供应商审批改单前看到同意后免费等待怎么变（2026-11-15 按推荐，审查建议 1）；
 * 客人订单页派单后写「按派单时的 X 航班锁定 N 分钟」（建议 6）。规则和服务端同一份领域函数。
 */
import { type FlightKind, type FreeWait, isFlightArrival, lockArrivalFreeWait, relockAllowed } from "@nozomi/domain";
import type { FreeWaitBasis } from "../api/dispatch.ts";
import { t } from "../i18n/index.ts";

/** 依据里的航班类型：国际航班 / 国内航班 / 航班类型未确认，按国内线（文案见 i18n/messages/free-wait.ts） */
export function basisKindText(kind: FlightKind | null): string {
  return t(kind === "international" ? "freeWait.basisKindInternational" : kind === "domestic" ? "freeWait.basisKindDomestic" : "freeWait.basisKindUnconfirmed");
}

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

const minutesText = (minutes: number | null): string => (minutes === null ? t("freeWait.unlimited") : t("freeWait.minutes", { minutes }));

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
  if (!relockAllowed({ status: order.status, driverId: order.dispatch.driver === null ? null : "assigned" })) return t("freeWait.previewDispatched", { current: minutesText(order.free_wait_minutes) });
  const product = productFreeWait(order);
  const kind = Object.hasOwn(after, "flight_kind") ? ((after["flight_kind"] as FlightKind | null) ?? null) : (order.flight_kind ?? null);
  const next = arrivalAfter ? lockArrivalFreeWait(product, kind).minutes : product !== null && product.mode === "limited" ? product.minutes : null;
  if (next === order.free_wait_minutes) return t("freeWait.previewUnchanged", { current: minutesText(next) });
  return typeof next === "number" && typeof order.free_wait_minutes === "number" ? t("freeWait.previewChange", { from: order.free_wait_minutes, to: minutesText(next) }) : t("freeWait.previewChange", { from: minutesText(order.free_wait_minutes), to: minutesText(next) });
}

/**
 * 客人订单页派单后的免费等待说明（2026-11-15 按推荐，审查建议 6）：「按派单时的国际航班锁定 90 分钟」；
 * 航班类型未确认写「按派单时航班类型未确认（按国内线）锁定 60 分钟」。没派单、没按航班锁定、不限时的为 null。
 */
export function dispatchedFreeWaitNote(order: Pick<ArrivalOrderShape, "free_wait_minutes" | "free_wait_basis"> & { dispatched: boolean }): string | null {
  const basis = order.free_wait_basis ?? null;
  if (!order.dispatched || basis === null || order.free_wait_minutes === null) return null;
  const kind = t(basis.flight_kind === "international" ? "freeWait.dispatchedKindInternational" : basis.flight_kind === "domestic" ? "freeWait.dispatchedKindDomestic" : "freeWait.dispatchedKindUnconfirmed");
  return t("freeWait.dispatchedNote", { kind, minutes: order.free_wait_minutes });
}
