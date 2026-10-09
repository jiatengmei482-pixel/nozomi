/**
 * 商品在界面上怎么写：显示名、状态徽标、币种、金额的输入和显示、「人数 / 行李数」、上架检查每条原因的定稿文字。
 * 规则本身（校验、缺项、上架检查）全在 @nozomi/domain，这里只管文字。
 */
import { CURRENCIES, type CurrencyCode, type LocalizedText, MASTER_DATA_LANGUAGES, PRODUCT_CATEGORY_NAMES, PRODUCT_LIMITS, PRODUCT_STATUS_NAMES, PUBLISH_CHECK_NAMES, type ProductStatus, type PublishCheckKey, type ServiceCategory, formatMajor, isCurrencyCode, parseMajor } from "@nozomi/domain";
import type { PublishCheckIssue, PublishCheckItemBody, PublishCheckResult } from "../api/products.ts";
import type { BadgeSpec } from "../components/StatusBadge.tsx";
import { type DisplayText, displayName } from "./master-display.ts";
import type { ProductStepSlug } from "./product-paths.ts";

export const PRODUCT_STATUS_BADGES: Readonly<Record<ProductStatus, BadgeSpec>> = {
  draft: { tone: "neutral", label: PRODUCT_STATUS_NAMES.draft },
  published: { tone: "success", label: PRODUCT_STATUS_NAMES.published },
  unpublished: { tone: "neutral", label: PRODUCT_STATUS_NAMES.unpublished },
};

/** 商品的显示名：详情里的标题；还没填时是「未命名的{品类}商品」。 */
export function productName(product: { title: LocalizedText; category: ServiceCategory }): DisplayText & { unnamed: boolean } {
  const shown = displayName(product.title);
  if (Object.values(product.title).some((value) => (value ?? "").trim() !== "")) return { ...shown, unnamed: false };
  return { text: `未命名的${PRODUCT_CATEGORY_NAMES[product.category]}商品`, lang: "zh-Hans", unnamed: true };
}

export const CURRENCY_NAMES: Readonly<Record<string, string>> = { JPY: "日元", KRW: "韩元", CNY: "人民币", USD: "美元", HKD: "港元", TWD: "新台币", THB: "泰铢" };
export const CURRENCY_OPTIONS = Object.keys(CURRENCIES).map((code) => ({ value: code, label: `${code} ${CURRENCY_NAMES[code] ?? ""}`.trim() }));

export const LANGUAGE_NAMES: Readonly<Record<(typeof MASTER_DATA_LANGUAGES)[number], string>> = { zh: "中文", ja: "日语", en: "英语", ko: "韩语" };
/** 界面上语言的固定顺序：中文、日语、英语、韩语。 */
export const CONTENT_LANGUAGES = ["zh", "ja", "en", "ko"] as const;
export type ContentLanguage = (typeof CONTENT_LANGUAGES)[number];
export const LANGUAGE_TAGS: Readonly<Record<ContentLanguage, string>> = { zh: "zh-Hans", ja: "ja", en: "en", ko: "ko" };

export function comboText(passengers: number, luggage: number): string {
  return `${passengers} 人 ${luggage} 件`;
}

function currencyOf(code: string | null): CurrencyCode | null {
  return code !== null && isCurrencyCode(code) ? code : null;
}

/** 最小货币单位整数 → 输入框里的写法（不带千分位）。 */
export function amountText(minor: number | null, currency: string | null): string {
  const code = currencyOf(currency);
  return minor === null || code === null ? (minor === null ? "" : String(minor)) : formatMajor(minor, code);
}

/** 带币种和千分位的金额，如「JPY 3,000」。 */
export function moneyText(minor: number, currency: string | null): string {
  const text = amountText(minor, currency);
  const [whole = "0", fraction] = text.split(".");
  return `${currency ?? ""} ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${fraction !== undefined ? `.${fraction}` : ""}`.trim();
}

export type AmountResult = { ok: true; minor: number } | { ok: false; message: string };

/** 输入框里的金额 → 最小货币单位整数。认千分位逗号和全角数字；空的由调用方先处理。 */
export function readAmount(text: string, currency: string | null): AmountResult {
  const code = currencyOf(currency);
  const tidy = text
    .trim()
    .replace(/[０-９．，]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(tidy)) return { ok: false, message: "请填金额，只能是数字，不能是负数" };
  const digits = code ? CURRENCIES[code].minorDigits : 0;
  if ((tidy.split(".")[1] ?? "").length > digits) return { ok: false, message: digits === 0 ? `${currency ?? "这种币种"}没有小数，请填整数` : `${currency} 最多 ${digits} 位小数` };
  try {
    const minor = code ? parseMajor(tidy, code) : Number(tidy);
    if (minor > PRODUCT_LIMITS.maxAmountMinor) return { ok: false, message: "金额太大了，请检查是不是多打了几个零" };
    return { ok: true, minor };
  } catch {
    return { ok: false, message: "请填金额，只能是数字，不能是负数" };
  }
}

// ───────────── 上架检查 ─────────────

/** 前端有页面的步骤：上架检查里的项 → 步骤。价格规则、库存上线时在这里接上。 */
export const CHECK_STEP: Readonly<Partial<Record<PublishCheckKey, ProductStepSlug>>> = { basic_info: "basic", service_rules: "service-rules", price_rules: "prices", adjust_rules: "prices", content: "content" };

export function checkItemName(key: string): string {
  return (PUBLISH_CHECK_NAMES as Record<string, string>)[key] ?? "其他检查";
}

export function isUnavailable(item: PublishCheckItemBody): boolean {
  return item.issues.some((issue) => issue.reason === "FEATURE_NOT_AVAILABLE");
}

export type CheckItemState = "passed" | "missing" | "unavailable" | "optional";

/** 一项检查在清单上的状态。先看「功能即将开放」：它在接口里也是没通过，但不能显示成「没满足」。 */
export function checkItemState(item: PublishCheckItemBody): CheckItemState {
  if (isUnavailable(item)) return "unavailable";
  if (!item.required) return "optional";
  return item.passed ? "passed" : "missing";
}

export interface CheckReason {
  text: string;
  /** 「去填」去哪一步的哪个锚点；没有就是这件事不归用户自己补 */
  anchor: string | null;
  /** 不归用户补的原因后面跟的一句 */
  note?: string;
}

export interface CheckContext {
  category: ServiceCategory;
  brandName: string;
  cityName: string;
  placeName: string | null;
  /** 接送点是车站时「接机指引」叫「接站指引」 */
  station: boolean;
}

function one(text: string, anchor: string | null, note?: string): CheckReason {
  return { text, anchor, ...(note ? { note } : {}) };
}

/** 一项检查里的原因 → 定稿文字（docs/design/pages/tenant-products.md 7.4）。文字相同的合并，带「{N} 个」的按条数。 */
export function checkReasons(item: PublishCheckItemBody, context: CheckContext): CheckReason[] {
  const count = (...reasons: string[]): number => item.issues.filter((issue) => reasons.includes(issue.reason)).length;
  const category = PRODUCT_CATEGORY_NAMES[context.category];
  const guide = context.station ? "接站指引" : "接机指引";
  const out: CheckReason[] = [];
  const known = new Set<PublishCheckIssue>();
  const take = (predicate: (issue: PublishCheckIssue) => boolean): boolean => {
    const found = item.issues.filter(predicate);
    for (const issue of found) known.add(issue);
    return found.length > 0;
  };
  const reason = (...reasons: string[]) => (issue: PublishCheckIssue) => reasons.includes(issue.reason);
  const required = (path: RegExp) => (issue: PublishCheckIssue) => issue.reason === "REQUIRED" && path.test(issue.path);

  if (item.key === "basic_info") {
    if (take(reason("BRAND_DISABLED"))) out.push(one(`子品牌「${context.brandName}」已停用`, null, "请联系你们的管理员"));
    if (take(reason("CITY_DISABLED"))) out.push(one(`城市「${context.cityName}」已被平台停用`, null, "请联系平台运营"));
    if (take(reason("PICKUP_PLACE_MISSING"))) out.push(one("这个商品没有接送点", null, "请联系平台运营"));
    if (take(reason("PICKUP_PLACE_DISABLED"))) out.push(one(`接送点「${context.placeName ?? ""}」已被平台停用`, null, "请联系平台运营"));
    if (take(reason("NO_AREA"))) out.push(one("还没有选服务区域", "areas"));
    const disabled = new Set(item.issues.filter(reason("AREA_DISABLED", "AREA_CITY_DISABLED")).map((issue) => issue.path)).size;
    if (take(reason("AREA_DISABLED", "AREA_CITY_DISABLED"))) out.push(one(`选的服务区域里有 ${disabled} 个已停用，请重新启用或移除`, "areas"));
    if (take(reason("AREA_NOT_USABLE"))) out.push(one(`选的服务区域里有 ${count("AREA_NOT_USABLE")} 个的业务类型不再适用于${category}，请移除`, "areas"));
    if (take(reason("NO_VEHICLE_GROUP"))) out.push(one("还没有选车型组", "vehicle-groups"));
    if (take(reason("VEHICLE_GROUP_DISABLED"))) out.push(one(`选的车型组里有 ${count("VEHICLE_GROUP_DISABLED")} 个已被平台停用，请移除`, "vehicle-groups"));
    if (take(reason("VEHICLE_COMBO_NOT_OFFERED"))) out.push(one(`有 ${count("VEHICLE_COMBO_NOT_OFFERED")} 个车型组选的「人数 / 行李数」平台已经取消，请重新选择`, "vehicle-groups"));
    if (take(reason("NO_DISPATCHER"))) out.push(one("还没有填调度人", "dispatchers"));
  } else if (item.key === "service_rules") {
    if (take(required(/^\/booking\/service_time$/))) out.push(one("还没有填服务时间", "service-time"));
    if (take(required(/^\/booking\/lead_time_hours$/))) out.push(one("还没有填提前预订时长", "lead-time"));
    if (take(required(/^\/urgent\/tiers$/))) out.push(one("加急预订：还没有填加急阶梯", "urgent"));
    if (take(required(/^\/night\//))) out.push(one("夜间加价：时段、计费方式、金额还没有填齐", "night"));
    if (take(required(/^\/free_wait\//))) out.push(one("还没有保存过免费等待（打开服务规则，确认后保存即可）", "free-wait"));
    if (take(reason("ADDON_DISABLED", "ADDON_NOT_APPLICABLE"))) out.push(one(`勾选的附加服务里有 ${count("ADDON_DISABLED", "ADDON_NOT_APPLICABLE")} 项平台已停用或不再适用，请取消勾选`, "addons"));
    if (take(reason("BELOW_PLATFORM_MINIMUM"))) out.push(one("免费等待比平台规定的最少时间短（平台调整过标准），请改长", "free-wait"));
  } else if (item.key === "content") {
    if (take(required(/^\/title$/))) out.push(one("还没有填标题（至少一种语言）", "title"));
    for (const language of CONTENT_LANGUAGES) {
      if (take(required(new RegExp(`^/${language}/pickup_guide$`)))) out.push(one(`${LANGUAGE_NAMES[language]}还没有填${guide}`, `pickup-guide-${language}`));
    }
  } else if (item.key === "price_rules") {
    if (take(reason("NO_ACTIVE_PRICE_RULE"))) out.push(one("还没有设价格（至少要有 1 条启用、没过期的价格）", ""));
    if (take(reason("ALL_PRICE_RULES_DISABLED"))) out.push(one("价格都停用了，至少要启用 1 条", ""));
    if (take(reason("ALL_PRICE_RULES_EXPIRED"))) out.push(one("价格都过期了，请把生效日期延长，或加一段新的", ""));
  } else if (item.key === "adjust_rules") {
    // 接口现在只给第几条，不给规则名：不指到具体哪一条
    if (take(reason("ADJUST_RESULT_NOT_POSITIVE"))) out.push(one(`有 ${count("ADJUST_RESULT_NOT_POSITIVE")} 条调价规则会把价格调到不大于 0，这些价格报不出来`, "adjust"));
  }
  // 没列在上面的：用接口带的中文说明
  const seen = new Set<string>();
  for (const issue of item.issues) {
    if (known.has(issue) || issue.reason === "FEATURE_NOT_AVAILABLE") continue;
    const text = /[一-鿿]/.test(issue.message) ? issue.message : "有一项不符合要求";
    if (seen.has(text)) continue;
    seen.add(text);
    out.push(one(text, ""));
  }
  return out;
}

/** 一项检查「还差几项」：就是清单上列出来的原因条数。 */
export function checkItemGap(item: PublishCheckItemBody, context: CheckContext): number {
  return checkReasons(item, context).length;
}

export interface CheckOverview {
  canPublish: boolean;
  /** 没满足的、已开放的必须项 */
  failed: PublishCheckItemBody[];
  /** 因为功能没开放而没法满足的必须项的名字 */
  unavailable: string[];
}

export function checkOverview(result: PublishCheckResult): CheckOverview {
  const required = result.items.filter((item) => item.required && !item.passed);
  return { canPublish: result.can_publish, failed: required.filter((item) => !isUnavailable(item)), unavailable: required.filter(isUnavailable).map((item) => checkItemName(item.key)) };
}

/** 没开放的步骤名连成「价格规则」「库存」。 */
export function quoteNames(names: readonly string[]): string {
  return names.map((name) => `「${name}」`).join("、");
}
