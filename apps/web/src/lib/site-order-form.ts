/**
 * 官网下单表单的规则（M3-05 起在 `pages/book/CheckoutPage.tsx`；M8-04 抽出来，新预订页「怎么联系你」同一套）：
 * 字段、前端校验、后端校验结果对回字段、拼 `POST /site/v1/orders` 的请求体、下单失败的说法。规则本身没有改。
 */
import { type MessagingApp, isFlightNo, isInternationalPhone } from "@nozomi/domain";
import { ApiError } from "../api/client.ts";
import type { SiteOrderRequest } from "../api/site.ts";

export const MESSAGING_NAMES: Readonly<Record<MessagingApp, string>> = { whatsapp: "WhatsApp", line: "LINE", wechat: "微信", kakaotalk: "KakaoTalk" };

export interface OrderForm {
  name: string;
  phone: string;
  email: string;
  flightNo: string;
  pickupAddress: string;
  dropoffAddress: string;
  messagingApp: MessagingApp | "";
  messagingHandle: string;
  notes: string;
  consent: boolean;
}

export type OrderField = "name" | "phone" | "email" | "flightNo" | "pickupAddress" | "dropoffAddress" | "messagingHandle" | "notes" | "consent";
export type OrderErrors = Partial<Record<OrderField, string>>;

/** 这一单的行程形状：是不是接送机、是不是接机、哪几端要写地址。 */
export interface OrderTrip {
  transfer: boolean;
  arrival: boolean;
  ends: ("pickup" | "dropoff")[];
  /**
   * 认出机场、但报价用的是点对点商品时（M8-33，ADR 0081）：订单是点对点品类，后端不收 `flight_no`，
   * 航班号由调用方写进给司机的备注（`notesWithExtras`），这里不再单独提交
   */
  flightInNotes?: boolean;
}

export const SERVER_PATHS: Readonly<Record<string, OrderField>> = {
  "/passenger/name": "name",
  "/passenger/phone": "phone",
  "/passenger/email": "email",
  "/flight_no": "flightNo",
  "/pickup_address": "pickupAddress",
  "/dropoff_address": "dropoffAddress",
  "/messaging/handle": "messagingHandle",
  "/notes": "notes",
  "/save_payment_method": "consent",
};

export const ADDRESS_FIELDS = { pickup: "pickupAddress", dropoff: "dropoffAddress" } as const;

/** 同意保存银行卡的那一句和说明（第五轮决策 ⑤）。 */
export const CONSENT_TEXT = "同意保存这次付款用的银行卡，用于服务后产生的费用（如超时等候）";
export const CONSENT_HELP = "服务后的费用会先通知您，48 小时内可以在订单页提异议；没有异议才会扣款。";

export const FIELD_HINTS = {
  phone: "以 + 和国家码开头，如 +81 90-1234-5678。司机和客服用它联系您",
  email: "订单链接会发到这个邮箱；链接丢了，可以在「查订单」用订单号和这个邮箱重新发",
  arrivalFlight: "如 NH211。航班延误时司机按实际落地时间等候",
} as const;

export function validateOrderForm(form: OrderForm, trip: OrderTrip): OrderErrors {
  const errors: OrderErrors = {};
  if (form.name.trim() === "") errors.name = "请填写乘车人姓名";
  if (!isInternationalPhone(form.phone.trim())) errors.phone = "请填写带国家码的手机号，如 +81 90-1234-5678、+86 138 0000 0000";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errors.email = "请填写正确的邮箱，订单确认和查看链接会发到这里";
  if (trip.arrival && form.flightNo.trim() === "") errors.flightNo = "接机要填航班号，司机按航班落地时间等候";
  if (trip.transfer && form.flightNo.trim() !== "" && !isFlightNo(form.flightNo)) errors.flightNo = "航班号的格式不对，如 NH211、MU523";
  for (const end of trip.ends) if (form[ADDRESS_FIELDS[end]].trim() === "") errors[ADDRESS_FIELDS[end]] = end === "pickup" ? "请填写上车的地址或酒店名" : "请填写下车的地址或酒店名";
  if (form.messagingApp !== "" && form.messagingHandle.trim() === "") errors.messagingHandle = "选了即时通讯就要填账号";
  if (!form.consent) errors.consent = "需要同意保存支付方式才能下单";
  return errors;
}

export function orderRequestOf(quoteId: string, form: OrderForm, trip: OrderTrip): SiteOrderRequest {
  return {
    quote_id: quoteId,
    passenger: { name: form.name.trim(), phone: form.phone.trim(), email: form.email.trim() },
    flight_no: !trip.transfer || trip.flightInNotes === true || form.flightNo.trim() === "" ? null : form.flightNo.trim(),
    pickup_address: trip.ends.includes("pickup") ? form.pickupAddress.trim() : null,
    dropoff_address: trip.ends.includes("dropoff") ? form.dropoffAddress.trim() : null,
    messaging: form.messagingApp === "" ? null : { app: form.messagingApp, handle: form.messagingHandle.trim() },
    notes: form.notes.trim() === "" ? null : form.notes.trim(),
    save_payment_method: form.consent,
  };
}

/** 下单失败怎么说：报价不能用了（要重新查价）、字段没过后端校验（对回字段）、其他。 */
export type OrderFailure = { kind: "expired"; text: string } | { kind: "fields"; errors: OrderErrors; text: string } | { kind: "other"; retrySafe: boolean };

export function orderFailureOf(err: unknown): OrderFailure {
  if (err instanceof ApiError && (err.code === "QUOTE_EXPIRED" || err.code === "QUOTE_ALREADY_ORDERED" || err.code === "QUOTE_NO_LONGER_AVAILABLE" || err.code === "SOLD_OUT")) {
    return { kind: "expired", text: err.code === "QUOTE_EXPIRED" ? "报价已经过了 30 分钟的有效期，请重新查询价格。" : err.code === "QUOTE_ALREADY_ORDERED" ? "这个报价已经下过单了。要再订一辆，请重新查询价格。" : "这辆车刚刚被订完或暂停预订了，请重新查询价格。" };
  }
  if (err instanceof ApiError && err.code === "VALIDATION_FAILED") {
    const issues = Array.isArray(err.details["issues"]) ? (err.details["issues"] as { path?: string; message?: string }[]) : [];
    const mapped: OrderErrors = {};
    for (const issue of issues) {
      const field = SERVER_PATHS[issue.path ?? ""];
      if (field !== undefined && issue.message) mapped[field] = issue.message;
    }
    return { kind: "fields", errors: mapped, text: Object.keys(mapped).length > 0 ? "有几项没有通过检查，请看标红的地方。" : "提交的内容不符合要求，请检查后重试。" };
  }
  return { kind: "other", retrySafe: err instanceof ApiError && err.status >= 500 };
}
