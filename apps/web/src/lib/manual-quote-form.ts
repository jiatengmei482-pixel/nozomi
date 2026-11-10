/**
 * 官网报不出价时「留下联系方式、人工报价」（M8-21，ADR 0076；规范 docs/design/pages/site-booking-v2.md 第 11 节）。
 *
 * - 只收两项：邮箱、WhatsApp（以 + 开头的国际格式），至少一项；格式规则和接口同一份（@nozomi/domain 的 manualQuoteEmail、whatsappDigits）。
 * - 行程由页面自动带上；缺了哪一项（日期、时间、包车时长）就请客人先在上面补上。
 * - 「通过 WhatsApp 联系我们」：号码来自官网配置 `support_whatsapp`，预先写好的一句话只有行程要点（manualQuoteWhatsappText）。
 */
import { type ManualQuoteTrip, isRealLocalDateTime, manualQuoteEmail, manualQuoteWhatsappText, whatsappDigits } from "@nozomi/domain";
import { ApiError } from "../api/client.ts";
import type { SiteCategory, SiteManualQuoteRequest } from "../api/site.ts";

export interface ManualQuotePlaceDraft {
  name: string;
  lat: number;
  lng: number;
}

/** 页面当时的行程（缺的项为 null）。 */
export interface ManualQuoteTripDraft {
  category: SiteCategory;
  cityId: string | null;
  pickup: ManualQuotePlaceDraft | null;
  dropoff: ManualQuotePlaceDraft | null;
  /** 当地时间 YYYY-MM-DDTHH:mm；日期或时间没选时为 null */
  serviceLocal: string | null;
  passengers: number;
  luggage: number;
  packageHours: number | null;
}

export interface ManualQuoteContact {
  email: string;
  whatsapp: string;
  /** 陷阱字段：页面上看不到，人不会填 */
  website: string;
}

export const emptyManualQuoteContact = (): ManualQuoteContact => ({ email: "", whatsapp: "", website: "" });

export type ManualQuoteErrors = Partial<Record<"email" | "whatsapp", string>>;

export const MANUAL_QUOTE_TEXTS = {
  required: "请至少填一项：邮箱或 WhatsApp",
  email: "邮箱的格式不对，请写完整，如 name@example.com",
  whatsapp: "WhatsApp 号码请以 + 和国家码开头（如日本 +81、中国 +86），共 8 到 15 位数字",
  whatsappHint: "以 + 和国家码开头，如日本 +81、中国 +86；可以有空格",
  consent: "提交即同意客服通过您留下的方式联系您",
  success: "已收到。客服会通过您留下的邮箱或 WhatsApp 联系您报价，请留意消息。",
} as const;

/** 行程还缺什么（客人要先在上面补上的），按页面上的顺序；齐了返回空数组。 */
export function missingTripParts(trip: ManualQuoteTripDraft): string[] {
  const missing: string[] = [];
  if (trip.pickup === null) missing.push(trip.category === "charter" ? "上车地点" : "出发地");
  if (trip.category !== "charter" && trip.dropoff === null) missing.push("目的地");
  if (trip.category === "charter" && trip.packageHours === null) missing.push("包车时长");
  if (trip.serviceLocal === null || !isRealLocalDateTime(trip.serviceLocal)) missing.push("日期和时间");
  return missing;
}

/** 两项联系方式的校验：至少一项；填了的要合格式。 */
export function validateManualQuoteContact(contact: ManualQuoteContact): ManualQuoteErrors {
  const email = contact.email.trim();
  const whatsapp = contact.whatsapp.trim();
  if (email === "" && whatsapp === "") return { email: MANUAL_QUOTE_TEXTS.required };
  const errors: ManualQuoteErrors = {};
  if (email !== "" && manualQuoteEmail(email) === null) errors.email = MANUAL_QUOTE_TEXTS.email;
  if (whatsapp !== "" && whatsappDigits(whatsapp, { requirePlus: true }) === null) errors.whatsapp = MANUAL_QUOTE_TEXTS.whatsapp;
  return errors;
}

/** 提交的请求体；行程不齐时为 null（先请客人补上）。 */
export function manualQuoteRequestOf(contact: ManualQuoteContact, trip: ManualQuoteTripDraft): SiteManualQuoteRequest | null {
  if (missingTripParts(trip).length > 0 || trip.pickup === null || trip.serviceLocal === null) return null;
  const place = (point: ManualQuotePlaceDraft) => ({ name: point.name.replace(/\s+/gu, " ").trim().slice(0, 300) || "地图上选的位置", lat: point.lat, lng: point.lng });
  const email = contact.email.trim();
  const whatsapp = contact.whatsapp.trim();
  return {
    email: email === "" ? null : email,
    whatsapp: whatsapp === "" ? null : whatsapp,
    consent: true,
    trip: {
      category: trip.category,
      city_id: trip.cityId,
      pickup: place(trip.pickup),
      dropoff: trip.dropoff === null ? null : place(trip.dropoff),
      service_local: trip.serviceLocal,
      passengers: trip.passengers,
      luggage: trip.luggage,
      package_hours: trip.category === "charter" ? trip.packageHours : null,
    },
    website: contact.website,
  };
}

/** 后端 400 点名的那一项落在对应的框下面；没点名联系方式的返回 null。 */
export function manualQuoteFieldErrors(err: unknown): ManualQuoteErrors | null {
  if (!(err instanceof ApiError) || err.code !== "VALIDATION_FAILED") return null;
  const issues = err.details["issues"];
  if (!Array.isArray(issues)) return null;
  const errors: ManualQuoteErrors = {};
  for (const issue of issues) {
    const path = String((issue as { path?: unknown } | null)?.path ?? "");
    const reason = String((issue as { reason?: unknown } | null)?.reason ?? "");
    if (path === "/email") errors.email = reason === "REQUIRED" ? MANUAL_QUOTE_TEXTS.required : MANUAL_QUOTE_TEXTS.email;
    if (path === "/whatsapp") errors.whatsapp = MANUAL_QUOTE_TEXTS.whatsapp;
  }
  return Object.keys(errors).length > 0 ? errors : null;
}

/** 「通过 WhatsApp 联系我们」预先写好的一句话（链接由 WhatsappLink 用 domain 的 whatsappChatUrl 拼）。行程不齐时只说想咨询报价。 */
export function supportWhatsappMessage(trip: ManualQuoteTripDraft): string {
  if (trip.pickup === null || trip.serviceLocal === null || !isRealLocalDateTime(trip.serviceLocal)) return "您好，我想咨询用车报价。";
  const text: Parameters<typeof manualQuoteWhatsappText>[0] = {
    category: trip.category,
    pickup: { name: trip.pickup.name },
    dropoff: trip.dropoff === null ? null : { name: trip.dropoff.name },
    serviceLocal: trip.serviceLocal,
    passengers: trip.passengers,
    packageHours: trip.category === "charter" ? trip.packageHours : null,
  } satisfies Pick<ManualQuoteTrip, "category" | "serviceLocal" | "passengers" | "packageHours"> & { pickup: { name: string }; dropoff: { name: string } | null };
  return manualQuoteWhatsappText(text);
}

/** 包车报不出价（地址不在任何能订包车的城市、城市没有套餐）时给客人选的大概时长：1–12 小时，客服报价时再确认。 */
export const MANUAL_QUOTE_CHARTER_HOURS: readonly number[] = Array.from({ length: 12 }, (_, index) => index + 1);
