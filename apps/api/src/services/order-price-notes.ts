/**
 * 订单上「含公里数」「含区域加价」给客人看的那一面（M8-13，ADR 0073 第四部分）：官网 / 渠道的订单应答、确认邮件、运营订单详情共用。
 *
 * - 数都取**订单上锁定的**结算价明细（改期重算后是改期后的数），不按现在的价格、现在的路线重算。
 * - 超出每公里的对外价 = 这一单结算价明细里的超出每公里单价，按这一单对外价用的汇率、汇率缓冲、加价比例单独换算、单独四舍五入
 *   （和报价时 `sellEquivalentMinor` 同一个口径；不含最低毛利、渠道取整）。已含在总价里，只是说明，和总价可能差一个取整单位以内。
 * - 这里会读对外价（`order_sales`）：**不能用在 `/tenant/v1` 和供应商邮件里**（规则 4）。
 */
import { type IncludedKmFacts, type PricingBasis, type QuoteSnapshot, type SellBreakdownItem, sellBreakdown, sellEquivalentMinor } from "@nozomi/domain";
import type { Order, OrderSale } from "../repos/orders.ts";

/** 含公里数（对外价）；没设含公里数的、M8-11 之前的订单为 null。 */
export function orderSellDistance(order: Pick<Order, "settlement" | "settlementCurrency">, sale: Pick<OrderSale, "currency" | "fx" | "fxBufferBp" | "markupBp">): IncludedKmFacts | null {
  const distance = order.settlement.distance ?? null;
  if (distance === null) return null;
  return {
    includedKm: distance.includedKm,
    routeMeters: distance.routeMeters,
    overKm: distance.overKm,
    overKmPerKmMinor: sellEquivalentMinor(distance.overKmPerKmMinor, order.settlementCurrency, { currency: sale.currency, fx: sale.fx, fxBufferBp: sale.fxBufferBp, markupBp: sale.markupBp }),
    currency: sale.currency,
  };
}

/** 这一单的价格里含区域加价（上车或下车有大于 0 的加价）。M8-15 之前的订单、没有区域加价的订单为 false。 */
export function orderIncludesAreaSurcharge(order: Pick<Order, "settlement">): boolean {
  const surcharge = order.settlement.areaSurcharge ?? null;
  return surcharge !== null && surcharge.pickup.amountMinor + surcharge.dropoff.amountMinor > 0;
}

/** 这一单的计价方式（M8-30，ADR 0080）：一口价 / 一口价 + 区域外里程费 / 按计程价。M8-30 之前的订单都是一口价。 */
export function orderPricingBasis(order: Pick<Order, "settlement">): PricingBasis {
  return order.settlement.pricingBasis ?? "one_price";
}

/**
 * 订单的对外价明细（M9W-04，ADR 0089 第 5 节）：取下单用的那份报价快照里中标的结算价明细和对外价（`winner.offer.settlement`、`winner.sell`），
 * 用报价时同一个函数 `sellBreakdown` 拆开——输入都是锁定的值，结果就是客人下单时看到的那份明细，不按现在的价格重算。
 * 只给包车按行程计价的单（结算价明细里有 `itinerary`；和下单页只在按行程计价时显示明细一致），别的单、旧单为 null。
 * 对不上时也是 null（宁可只显示总价）：快照的对外价、币种和订单现在的不一样（改期重算过价），或倒算出来的套餐价是负数。
 * 救援改派不改客人的对外价，所以仍按原报价的明细给。
 */
export function orderSellBreakdown(snapshot: Pick<QuoteSnapshot, "winner"> | null, sale: Pick<OrderSale, "currency" | "sellMinor">): SellBreakdownItem[] | null {
  if (snapshot === null) return null;
  const { settlement } = snapshot.winner.offer;
  const { sell } = snapshot.winner;
  if (settlement.itinerary === undefined) return null;
  if (sell.currency !== sale.currency || sell.sellMinor !== sale.sellMinor) return null;
  const items = sellBreakdown(settlement, sell);
  if (items.some((item) => item.kind === "base" && item.amountMinor < 0)) return null;
  if (items.reduce((sum, item) => sum + item.amountMinor, 0) !== sale.sellMinor) return null;
  return items;
}
