/**
 * 「一口价包含」清单（M8-03，ADR 0069「修正版 v2」的三语清单和「第二批确认 ①」）：新预订页（以后的确认邮件同一来源）只写这里的条目。
 * - 含所有费用：全部写（M8-09 起包车也是一口价全含，`FIXED_PRICE_RULES.charterAllInclusive`；ADR 0070）；
 * - 专车不拼车：全部写；
 * - 举牌接机：只有中标商品的「包含」清单里有才写（调用方传进来）；
 * - 免费等待 N 分钟：N 取报价里的值，0 或不限时不写；接机写「航班落地后」。
 * 平台没有自动跟踪航班（B14 决定不做），这里没有、也不能加「跟踪航班」。
 */

import { DISTANCE_ONLY_FEE_NOTES, type PricingBasis } from "./distance-price.ts";

export type FixedPriceLanguage = "zh" | "ja" | "en";

export const FIXED_PRICE_RULES = {
  /**
   * 包车页面能不能写「一口价已含所有费用」。M8-09（ADR 0070）起包车也不再另收高速费、停车费（`extra-charges.ts` 按下单时间判断），说法和规则同一个 PR 切换。
   */
  charterAllInclusive: true,
} as const;

/**
 * 包车一口价全含的分界（ADR 0070）：这一刻（东京 2026-11-10 00:00）及以后下的包车单，服务后不能再加收高速费、停车费；
 * 之前下的包车单报价时是按「高速、停车另收」报的，仍可按旧规则凭票加收（不追溯）。按订单的下单时间判断，只在这里定义。
 */
export const CHARTER_ALL_INCLUSIVE_FROM = "2026-11-10T00:00:00+09:00";
const CHARTER_ALL_INCLUSIVE_FROM_MS = Date.parse(CHARTER_ALL_INCLUSIVE_FROM);

/** 这一张包车单是不是一口价全含（按下单时间；正好在分界那一刻下的算全含）。 */
export function charterAllInclusiveFor(placedAt: Date): boolean {
  return placedAt.getTime() >= CHARTER_ALL_INCLUSIVE_FROM_MS;
}

/** 包车超出套餐的部分（客人侧说法，接在「含所有费用」后面）。 */
export const CHARTER_OVERAGE_TEXTS: Readonly<Record<FixedPriceLanguage, string>> = {
  zh: "超出套餐的时长和公里服务后按实际收取",
  ja: "パッケージを超えた時間・距離はサービス後に実費でご請求します",
  en: "Time and distance beyond the package are charged after the service at actual usage",
};

/** 供应商侧：包车报价须包含高速费、停车费（供应商后台价格规则、服务规则说明，接单邮件）。 */
export const CHARTER_SUPPLIER_PRICE_NOTE = "包车报价须包含高速费、停车费：对客人是一口价全含，服务后不能再另收高速费、停车费；超出套餐的时长和公里仍按商品规则加收。";

export type FixedPriceItemKey = "all_inclusive" | "private_car" | "meet_and_greet" | "free_wait";

export interface FixedPriceIncludesTexts {
  allInclusive: string;
  privateCar: string;
  meetAndGreet: string;
  freeWaitAfterLanding: (minutes: number) => string;
  freeWait: (minutes: number) => string;
}

export const FIXED_PRICE_INCLUDES_TEXTS: Readonly<Record<FixedPriceLanguage, FixedPriceIncludesTexts>> = {
  zh: {
    allInclusive: "一口价已含所有费用（高速费、停车费等），无需另付",
    privateCar: "专车专用，不拼车",
    meetAndGreet: "举牌接机",
    freeWaitAfterLanding: (minutes) => `航班落地后免费等待 ${minutes} 分钟`,
    freeWait: (minutes) => `免费等待 ${minutes} 分钟`,
  },
  ja: {
    allInclusive: "高速料金・駐車料金などすべて込みの定額料金で、追加のお支払いはありません",
    privateCar: "専用車（相乗りなし）",
    meetAndGreet: "ネームボードでお出迎え",
    freeWaitAfterLanding: (minutes) => `着陸後 ${minutes} 分間の無料待機`,
    freeWait: (minutes) => `${minutes} 分間の無料待機`,
  },
  en: {
    allInclusive: "All-inclusive fixed price — tolls, parking and other fees included, nothing extra to pay",
    privateCar: "Private car, no sharing",
    meetAndGreet: "Meet & greet with a name sign",
    freeWaitAfterLanding: (minutes) => `${minutes} minutes of free waiting after landing`,
    freeWait: (minutes) => `${minutes} minutes of free waiting`,
  },
};

export interface FixedPriceIncludesInput {
  /** 接送机、点对点是 transfer；包车是 charter */
  service: "transfer" | "charter";
  /** 是不是接机（免费等待从航班落地起算） */
  arrival: boolean;
  /** 报价里的免费等待分钟数；null 是不限时 */
  freeWaitMinutes: number | null;
  /** 中标商品的「包含」清单里有举牌接机 */
  meetAndGreet: boolean;
  /** 默认取 `FIXED_PRICE_RULES.charterAllInclusive` */
  charterAllInclusive?: boolean;
  /**
   * 报价的计价方式（M8-40，ADR 0080）：按里程计价（`distance_only`）不是一口价，「含所有费用」那一条换成
   * `DISTANCE_ONLY_FEE_NOTES`（和 `pricingBasisFeeNote` 同一句）；不传、一口价、含里程费照旧。
   */
  pricingBasis?: PricingBasis | null | undefined;
}

/** 清单的小标题（M8-40）：按里程计价的不写「一口价」。 */
export const FIXED_PRICE_INCLUDES_TITLES: Readonly<Record<FixedPriceLanguage, { fixedPrice: string; distanceOnly: string }>> = {
  zh: { fixedPrice: "一口价包含", distanceOnly: "车费包含" },
  ja: { fixedPrice: "定額料金に含まれるもの", distanceOnly: "運賃に含まれるもの" },
  en: { fixedPrice: "Your fixed price includes", distanceOnly: "Your fare includes" },
};

export function fixedPriceIncludesTitle(basis: PricingBasis | null | undefined, language: FixedPriceLanguage = "zh"): string {
  const titles = FIXED_PRICE_INCLUDES_TITLES[language];
  return basis === "distance_only" ? titles.distanceOnly : titles.fixedPrice;
}

/** 按顺序排好的条目（键 + 文字）。 */
export function fixedPriceIncludes(input: FixedPriceIncludesInput, language: FixedPriceLanguage = "zh"): { key: FixedPriceItemKey; text: string }[] {
  const texts = FIXED_PRICE_INCLUDES_TEXTS[language];
  const items: { key: FixedPriceItemKey; text: string }[] = [];
  const allInclusive = input.service === "transfer" || (input.charterAllInclusive ?? FIXED_PRICE_RULES.charterAllInclusive);
  if (allInclusive) items.push({ key: "all_inclusive", text: input.pricingBasis === "distance_only" ? DISTANCE_ONLY_FEE_NOTES[language] : texts.allInclusive });
  items.push({ key: "private_car", text: texts.privateCar });
  if (input.meetAndGreet) items.push({ key: "meet_and_greet", text: texts.meetAndGreet });
  const minutes = input.freeWaitMinutes;
  if (minutes !== null && minutes > 0) items.push({ key: "free_wait", text: input.arrival ? texts.freeWaitAfterLanding(minutes) : texts.freeWait(minutes) });
  return items;
}

/**
 * 客人看到的「费用说明」一句（订单确认邮件、官网说明同一来源）：
 * 接送机、点对点只写「含所有费用」；包车再接一句超出套餐的时长和公里另收。
 */
export function fixedPriceFeeNote(service: "transfer" | "charter", language: FixedPriceLanguage = "zh"): string {
  const texts = FIXED_PRICE_INCLUDES_TEXTS[language];
  if (service === "transfer") return texts.allInclusive;
  return `${texts.allInclusive}${language === "en" ? "; " : "；"}${CHARTER_OVERAGE_TEXTS[language]}`;
}
