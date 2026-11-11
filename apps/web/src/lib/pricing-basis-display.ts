/**
 * 后台（运营、供应商）看的计价方式和计程明细（M8-30b，ADR 0080 第二、三部分）：报价试算、订单详情共用。
 * - 一口价（`one_price`）、没有这一项的旧数据：不出这一项（返回 null），页面和以前一样；
 * - 一口价 + 区域外里程费：「区域外 5 公里 × JPY 300 = JPY 1,500」+ 路线和含公里数；
 * - 按计程价：「起步价 JPY 2,000 + 12 公里 × JPY 300 = JPY 5,600」+ 路线。
 * 金额都是结算价（规则 4：供应商只看结算价；运营的对外价另在「对外价」那一项）。钱已含在基础价里，这里是说明，不和总价做加减。
 */
import type { PricingBasis } from "@nozomi/domain";
import { kmText } from "./distance.ts";

/** 后台对计价方式的叫法 */
export const PRICING_BASIS_NAMES: Readonly<Record<PricingBasis, string>> = {
  one_price: "一口价",
  one_price_outside_km: "一口价 + 区域外里程费",
  distance_only: "计程价（起步价 + 每公里）",
};

/** 计程部分（金额已经按币种写好的字符串；数是报价时锁定的） */
export interface MileageFacts {
  route_meters: number;
  included_km: number;
  km: number;
  start_price: string;
  per_km: string;
  fee: string;
}

/** 「计价方式」那一项的几行；一口价、没有计程明细时返回 null（不出现）。 */
export function pricingBasisLines(basis: PricingBasis | null | undefined, mileage: MileageFacts | null | undefined): string[] | null {
  if (basis === undefined || basis === null || basis === "one_price") return null;
  const lines = [PRICING_BASIS_NAMES[basis]];
  if (mileage === null || mileage === undefined) return lines;
  const route = `路线约 ${kmText(mileage.route_meters)} 公里（报价时）`;
  if (basis === "one_price_outside_km") {
    lines.push(`区域外 ${mileage.km} 公里 × ${mileage.per_km} = ${mileage.fee}（已含在基础价里）`);
    lines.push(`${route}${mileage.included_km > 0 ? `，扣掉一口价含的 ${mileage.included_km} 公里` : ""}；不足 1 公里按 1 公里`);
  } else {
    lines.push(`起步价 ${mileage.start_price} + ${mileage.km} 公里 × ${mileage.per_km} = ${mileage.fee}（已含在基础价里）`);
    lines.push(`${route}；不足 1 公里按 1 公里`);
  }
  return lines;
}
