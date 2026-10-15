/**
 * 报价试算页的表单（docs/design/pages/platform-products.md 第 5 节）：页面上填的字 → 接口的请求体，以及哪里填得不对。
 * 哪个品类要填哪几项，和后端、@nozomi/domain 的 `quoteCheckPoints` 是同一个规则：接送机只看非机场一端，点对点两端都看，包车只看上车点。
 */
import { PRICE_LIMITS, QUOTE_RULES, type ServiceCategory, isCurrencyCode, quoteCheckPoints } from "@nozomi/domain";
import type { PlatformQuotePreviewRequest } from "../api/quotes.ts";
import { type CoordinateValue, coordinateIssue } from "../components/FormFields.tsx";
import { kmTextToMeters } from "./price-form.ts";
import { tidyDate, tidyTime } from "./time-input.ts";

/** 假定的里程、时长的上限（和接口一致：5000 公里、7 天）。 */
export const ASSUME_ROUTE_LIMITS = { maxMeters: 5_000_000, maxMinutes: 10_080 } as const;

export interface QuoteForm {
  cityId: string | null;
  category: ServiceCategory | null;
  placeId: string | null;
  direction: "pickup" | "dropoff" | null;
  pickup: CoordinateValue;
  dropoff: CoordinateValue;
  packageHours: string;
  date: string;
  time: string;
  passengers: string;
  luggage: string;
  currency: string;
  routeKm: string;
  routeMinutes: string;
}

export type QuoteField = "city" | "category" | "place" | "direction" | "pickup.lat" | "pickup.lng" | "dropoff.lat" | "dropoff.lng" | "packageHours" | "date" | "time" | "passengers" | "luggage" | "currency" | "routeKm" | "routeMinutes";

export const EMPTY_POINT: CoordinateValue = { lat: "", lng: "" };

export function emptyQuoteForm(): QuoteForm {
  return { cityId: null, category: null, placeId: null, direction: null, pickup: EMPTY_POINT, dropoff: EMPTY_POINT, packageHours: "", date: "", time: "", passengers: "", luggage: "", currency: "", routeKm: "", routeMinutes: "" };
}

/** 这个品类、这个方向要填哪几个点。品类还没选时一个都不用。 */
export function pointsNeeded(form: Pick<QuoteForm, "category" | "direction">): ("pickup" | "dropoff")[] {
  if (form.category === null) return [];
  if (form.category === "airport_transfer" && form.direction === null) return [];
  return quoteCheckPoints({ category: form.category, direction: form.category === "airport_transfer" ? form.direction : null });
}

function wholeNumber(text: string): number | null {
  const trimmed = text.trim().replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null;
}

export interface QuoteReading {
  errors: Partial<Record<QuoteField, string>>;
  body: PlatformQuotePreviewRequest | null;
}

/** 读表单：有错时 `body` 为 null；按页面上从上到下的顺序给出错。 */
export function readQuoteForm(form: QuoteForm): QuoteReading {
  const errors: Partial<Record<QuoteField, string>> = {};
  if (form.cityId === null) errors.city = "请选择城市";
  if (form.category === null) errors.category = "请选择品类";
  const transfer = form.category === "airport_transfer";
  if (transfer && form.placeId === null) errors.place = "请选择机场或车站";
  if (transfer && form.direction === null) errors.direction = "请选择方向";

  const points: Partial<Record<"pickup" | "dropoff", { lat: number; lng: number }>> = {};
  for (const which of pointsNeeded(form)) {
    const value = form[which];
    const lat = coordinateIssue("lat", value.lat);
    const lng = coordinateIssue("lng", value.lng);
    if (lat !== null) errors[`${which}.lat`] = lat;
    if (lng !== null) errors[`${which}.lng`] = lng;
    if (lat === null && lng === null) points[which] = { lat: Number(value.lat.trim()), lng: Number(value.lng.trim()) };
  }

  const packageHours = wholeNumber(form.packageHours);
  if (form.category === "charter" && (packageHours === null || packageHours < 1 || packageHours > PRICE_LIMITS.maxPackageHours)) errors.packageHours = `套餐时长要填 1 到 ${PRICE_LIMITS.maxPackageHours} 之间的整数（小时）`;

  const date = tidyDate(form.date);
  if (form.date.trim() === "") errors.date = "请填用车日期";
  else if (date === null) errors.date = "这不是一个日期，请按 2026-10-08 的格式填写";
  const time = tidyTime(form.time);
  if (form.time.trim() === "") errors.time = "请填用车时间";
  else if (time === null) errors.time = "请填时间，例如 08:00";

  const passengers = wholeNumber(form.passengers);
  if (passengers === null || passengers < 1 || passengers > QUOTE_RULES.maxPassengers) errors.passengers = `人数要填 1 到 ${QUOTE_RULES.maxPassengers} 之间的整数`;
  const luggage = form.luggage.trim() === "" ? 0 : wholeNumber(form.luggage);
  if (luggage === null || luggage > QUOTE_RULES.maxLuggage) errors.luggage = `行李数要填 0 到 ${QUOTE_RULES.maxLuggage} 之间的整数，没有行李可以不填`;
  if (!isCurrencyCode(form.currency)) errors.currency = "请选择客人支付的币种";

  // 假定的里程和时长：要么都填，要么都不填
  const kmBlank = form.routeKm.trim() === "";
  const minutesBlank = form.routeMinutes.trim() === "";
  const meters = kmBlank ? null : kmTextToMeters(form.routeKm);
  const minutes = minutesBlank ? null : wholeNumber(form.routeMinutes);
  if (!kmBlank && (meters === null || meters > ASSUME_ROUTE_LIMITS.maxMeters)) errors.routeKm = "里程要填 0 到 5,000 之间的数（公里），最多 1 位小数";
  else if (kmBlank && !minutesBlank) errors.routeKm = "填了时长，也要填里程";
  if (!minutesBlank && (minutes === null || minutes > ASSUME_ROUTE_LIMITS.maxMinutes)) errors.routeMinutes = "时长要填 0 到 10,080 之间的整数（分钟）";
  else if (minutesBlank && !kmBlank) errors.routeMinutes = "填了里程，也要填时长";

  if (Object.keys(errors).length > 0 || form.cityId === null || form.category === null || date === null || time === null || passengers === null || luggage === null) return { errors, body: null };
  return {
    errors,
    body: {
      city_id: form.cityId,
      category: form.category,
      place_id: transfer ? form.placeId : null,
      currency: form.currency,
      pickup: points.pickup ?? null,
      dropoff: points.dropoff ?? null,
      direction: transfer ? form.direction : null,
      package_hours: form.category === "charter" ? packageHours : null,
      service_time: `${date}T${time}`,
      passengers,
      luggage,
      assume_route: meters !== null && minutes !== null ? { meters, minutes } : null,
    },
  };
}

/** 后端在 400 里指出的路径 → 页面上的哪一项。对不上的返回 null。 */
export function fieldOfPath(path: string): QuoteField | null {
  const map: Readonly<Record<string, QuoteField>> = {
    "/city_id": "city",
    "/category": "category",
    "/place_id": "place",
    "/direction": "direction",
    "/pickup": "pickup.lat",
    "/pickup/lat": "pickup.lat",
    "/pickup/lng": "pickup.lng",
    "/dropoff": "dropoff.lat",
    "/dropoff/lat": "dropoff.lat",
    "/dropoff/lng": "dropoff.lng",
    "/package_hours": "packageHours",
    "/service_time": "date",
    "/passengers": "passengers",
    "/luggage": "luggage",
    "/currency": "currency",
    "/assume_route": "routeKm",
    "/assume_route/meters": "routeKm",
    "/assume_route/minutes": "routeMinutes",
  };
  return map[path] ?? null;
}
