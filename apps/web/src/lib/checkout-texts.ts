/**
 * 第 4 步「核对并付款」和下单后进付款（业主验收意见 2026-11-16）新增的固定文案，按键取。
 * 写法同 `itinerary-texts.ts`：中文必填；日文、英文暂时留空，取不到时退回中文，以后补译（M11-04）只改这里。
 * `{名字}` 是占位，由 `checkoutCopy` 按参数替换。
 */
export type CheckoutLang = "zh" | "ja" | "en";

export type CheckoutTextKey =
  | "tripTitle"
  | "vehicle"
  | "passengerTitle"
  | "priceTitle"
  | "termsTitle"
  | "payDueNote"
  | "cardNote"
  | "payTitle"
  | "back";

const ZH: Readonly<Record<CheckoutTextKey, string>> = {
  tripTitle: "行程",
  vehicle: "车型",
  passengerTitle: "乘客信息",
  priceTitle: "价格和总价",
  termsTitle: "取消政策和注意事项",
  payDueNote: "点「去付款」后订单即提交，请在 30 分钟内完成付款，超时订单会自动取消。",
  cardNote: "付款信息由 Stripe 处理，本站不保存卡号。",
  payTitle: "付款",
  back: "上一步",
};

export const CHECKOUT_TEXTS: Readonly<Record<CheckoutLang, Partial<Record<CheckoutTextKey, string>>>> = { zh: ZH, ja: {}, en: {} };

export function checkoutCopy(key: CheckoutTextKey, params: Readonly<Record<string, string | number>> = {}, lang: CheckoutLang = "zh"): string {
  const template = CHECKOUT_TEXTS[lang][key] ?? ZH[key];
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}
