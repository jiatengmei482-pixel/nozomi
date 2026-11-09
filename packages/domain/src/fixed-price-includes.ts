/**
 * 「一口价包含」清单（M8-03，ADR 0069「修正版 v2」的三语清单和「第二批确认 ①」）：新预订页（以后的确认邮件同一来源）只写这里的条目。
 * - 含所有费用：接送机、点对点写；包车要等「包车不再另收高速费、停车费」的规则切换后才写（`FIXED_PRICE_RULES.charterAllInclusive`）；
 * - 专车不拼车：全部写；
 * - 举牌接机：只有中标商品的「包含」清单里有才写（调用方传进来）；
 * - 免费等待 N 分钟：N 取报价里的值，0 或不限时不写；接机写「航班落地后」。
 * 平台没有自动跟踪航班（B14 决定不做），这里没有、也不能加「跟踪航班」。
 */

export type FixedPriceLanguage = "zh" | "ja" | "en";

export const FIXED_PRICE_RULES = {
  /**
   * 包车页面能不能写「一口价已含所有费用」。现在包车还能事后加收高速费、停车费（`extra-charges.ts` 的 toll、parking，ADR 0029），
   * 页面不能先写「包含所有费用」（ADR 0069 第二批确认 ① 安全方案第 3 条：说法和规则同一天切换）。规则切换的那个 PR 把这里改成 true。
   */
  charterAllInclusive: false,
} as const;

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
}

/** 按顺序排好的条目（键 + 文字）。 */
export function fixedPriceIncludes(input: FixedPriceIncludesInput, language: FixedPriceLanguage = "zh"): { key: FixedPriceItemKey; text: string }[] {
  const texts = FIXED_PRICE_INCLUDES_TEXTS[language];
  const items: { key: FixedPriceItemKey; text: string }[] = [];
  const allInclusive = input.service === "transfer" || (input.charterAllInclusive ?? FIXED_PRICE_RULES.charterAllInclusive);
  if (allInclusive) items.push({ key: "all_inclusive", text: texts.allInclusive });
  items.push({ key: "private_car", text: texts.privateCar });
  if (input.meetAndGreet) items.push({ key: "meet_and_greet", text: texts.meetAndGreet });
  const minutes = input.freeWaitMinutes;
  if (minutes !== null && minutes > 0) items.push({ key: "free_wait", text: input.arrival ? texts.freeWaitAfterLanding(minutes) : texts.freeWait(minutes) });
  return items;
}
