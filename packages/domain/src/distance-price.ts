/**
 * 计程价（M8-30，ADR 0080）：接送机、点对点商品按车型组设的「起步价 + 每公里单价」，不挂区域。
 *
 * - 两端都不在商品的报价区域里（接送机：非机场一端不在）时，按它报：结算价基础价 = 起步价 + ⌈路线公里⌉ × 每公里单价。
 * - 只有一端在报价区域里（只有点对点）时，它的每公里单价也是「区域外里程费」的单价：一口价 + 区域外公里 × 每公里单价。
 * - 生效日期、启停、「同一车型组生效日期不能重叠」和价格规则同一套口径（`dateRangesOverlap`、`priceRuleCoversDate`）。
 * - 金额都是商品子品牌币种的最小货币单位整数（结算价）；对外价照旧由比价那一步按渠道加价算。
 * 检查函数只返回路径和原因代码，不返回句子（同 pricing.ts）。
 */
import type { FixedPriceLanguage } from "./fixed-price-includes.ts";
import type { ServiceCategory } from "./master-data.ts";
import { type PriceIssue, type PriceRuleStatus, PRICE_LIMITS, dateRangesOverlap, priceRuleCoversDate } from "./pricing.ts";
import { isLocalDate } from "./service-time.ts";

export interface DistancePrice {
  vehicleGroupId: string;
  /** 起步价（可以是 0，但起步价和每公里单价不能都是 0） */
  startMinor: number;
  /** 每公里单价 */
  perKmMinor: number;
  /** `YYYY-MM-DD`，城市当地的用车日期，两端都含；`validTo` 为 null = 一直有效 */
  validFrom: string;
  validTo: string | null;
  status: PriceRuleStatus;
}

/** 这个品类能不能设计程价：接送机、点对点能；包车不用计程兜底（业主 2026-11-11） */
export function distancePriceAllowed(category: ServiceCategory): boolean {
  return category === "airport_transfer" || category === "point_to_point";
}

/** 一条计程价「写得对不对」。车型组是不是这个商品选的，由保存的地方查。 */
export function distancePriceIssues(price: DistancePrice): PriceIssue[] {
  const issues: PriceIssue[] = [];
  const max = PRICE_LIMITS.maxAmountMinor;
  const amount = (path: string, value: number): void => {
    if (!Number.isInteger(value)) issues.push({ path, reason: "NOT_INTEGER" });
    else if (value < 0 || value > max) issues.push({ path, reason: "OUT_OF_RANGE", detail: { min: 0, max } });
  };
  amount("/start_price", price.startMinor);
  amount("/per_km", price.perKmMinor);
  if (price.startMinor === 0 && price.perKmMinor === 0) issues.push({ path: "/per_km", reason: "OUT_OF_RANGE", detail: { min: 1, max } });
  if (!isLocalDate(price.validFrom)) issues.push({ path: "/valid_from", reason: "INVALID_DATE" });
  if (price.validTo !== null && !isLocalDate(price.validTo)) issues.push({ path: "/valid_to", reason: "INVALID_DATE" });
  if (price.validTo !== null && isLocalDate(price.validFrom) && isLocalDate(price.validTo) && price.validTo < price.validFrom) issues.push({ path: "/valid_to", reason: "DATE_RANGE_REVERSED" });
  return issues;
}

/** 和这条冲突的（同一车型组、生效日期重叠；停用的也算，否则一启用就撞上）：返回 `others` 里的下标 */
export function distancePriceConflicts(price: Pick<DistancePrice, "vehicleGroupId" | "validFrom" | "validTo">, others: readonly Pick<DistancePrice, "vehicleGroupId" | "validFrom" | "validTo">[]): number[] {
  return others.flatMap((other, index) => (other.vehicleGroupId === price.vehicleGroupId && dateRangesOverlap(price, other) ? [index] : []));
}

export type DistancePriceChoice<T> = { price: T; reason: null } | { price: null; reason: "NO_RULE" | "NOT_IN_EFFECT" | "RULE_DISABLED" };

/** 这个车型组在这个用车日期用哪条计程价：启用、生效期内的那条；没有时说明原因（口径同 `tripPrice`） */
export function selectDistancePrice<T extends DistancePrice>(prices: readonly T[], query: { vehicleGroupId: string; date: string }): DistancePriceChoice<T> {
  const same = prices.filter((price) => price.vehicleGroupId === query.vehicleGroupId);
  const hit = same.find((price) => price.status === "enabled" && priceRuleCoversDate(price, query.date));
  if (hit !== undefined) return { price: hit, reason: null };
  return { price: null, reason: same.length === 0 ? "NO_RULE" : same.some((price) => priceRuleCoversDate(price, query.date)) ? "RULE_DISABLED" : "NOT_IN_EFFECT" };
}

// ---- 报价用的是哪种算法（给客人、订单页看的标注） ----

/**
 * 一个报价的计价方式（M8-30）：
 * - `one_price`：一口价（区域价 / 线路价 / 含公里数，和以前一样；包车的「含区域加价」另有标注）；
 * - `one_price_outside_km`：一口价 + 区域外里程费（只有一端在报价区域里）；
 * - `distance_only`：按计程价（两端都不在报价区域里）。
 */
export const PRICING_BASES = ["one_price", "one_price_outside_km", "distance_only"] as const;
export type PricingBasis = (typeof PRICING_BASES)[number];

/** 客人看到的标注（业主 2026-11-11 定的说法）；一口价没有标注 */
export const PRICING_BASIS_NOTES: Readonly<Record<PricingBasis, string | null>> = {
  one_price: null,
  one_price_outside_km: "含里程费",
  distance_only: "按里程计价",
};

/** 客人看到的标注：一口价为 null（包车的区域加价另用 `AREA_SURCHARGE_NOTE`） */
export function pricingBasisNote(basis: PricingBasis | null | undefined): string | null {
  return basis === undefined || basis === null ? null : PRICING_BASIS_NOTES[basis];
}

/**
 * 按里程计价（`distance_only`）的单「费用说明」那一句（M6-08，M8-14 验收观察 1）：它不是一口价，不能写「一口价已含所有费用…」，
 * 只说车费里已经含了高速费、停车费（规则和一口价一样，不另收）。一口价、含里程费、旧接口没有这一项都返回 null，
 * 由调用的地方照旧用 `fixedPriceFeeNote`。
 */
export const DISTANCE_ONLY_FEE_NOTES: Readonly<Record<FixedPriceLanguage, string>> = {
  zh: "车费已含高速费、停车费等，无需另付",
  ja: "運賃には高速料金・駐車料金などが含まれており、追加のお支払いはありません",
  en: "The fare includes tolls, parking and other fees — nothing extra to pay",
};

export function pricingBasisFeeNote(basis: PricingBasis | null | undefined, language: FixedPriceLanguage = "zh"): string | null {
  return basis === "distance_only" ? DISTANCE_ONLY_FEE_NOTES[language] : null;
}
