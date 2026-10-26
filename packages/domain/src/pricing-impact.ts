/**
 * 加价规则 / 渠道定价参数生效前的毛利试算（M3-07，ADR 0033）。纯函数，不碰数据库和网络。
 *
 * 需求：《平台运营端与渠道对接》「加价规则」——「修改加价规则需双人复核，生效前可用「试算」看对近 30 天订单的毛利影响」。
 *
 * 做法：把近 30 天这个渠道的每个报价（询价快照里的全部候选：结算价、结算币种、汇率和缓冲、评分、单量、观察期）
 * 分别按「现在的规则」和「改动后的规则」重新算一遍每个候选的对外价、重新选中标，汇总对外价、结算价、毛利的差。
 * - 中标**重算**：加价比例按租户可以不同，改了某个租户的比例，中标可能换人；客人付的是新中标者的对外价，平台付的是新中标者的结算价。
 * - 汇率一律用**快照里的**（报价那一刻的中央汇率和缓冲），不用现在的汇率；快照里缺了要用的汇率（M3-07 之前的快照）这一条算「没法重算」，不计入。
 * - 毛利 = 对外价 − 结算价，两者都按快照汇率换到渠道的结算币种。**每一单**先换算、按比例（有偿取消的扣款比例）折算、四舍五入到最小单位，再相加——和记账一致（每单入账都是整数），合计里对外价 − 结算价恰好等于毛利。
 * - 这是估算：客人面对新的价格还会不会下单无法知道，这里假定询价和订单都照旧发生。
 */
import type { ChannelPricing, MarkupRule } from "./channels.ts";
import { resolveMarkup } from "./channels.ts";
import type { ServiceCategory } from "./master-data.ts";
import { type CurrencyCode, minorDigits, roundFractionToUnit } from "./money.ts";
import { type ExactAmount, exactFromMinor, scaleExact } from "./pricing.ts";
import { type FxQuote, type RankCandidate, type SellPrice, rankCandidates, rateFraction, sellPrice } from "./quote.ts";

export const PRICING_IMPACT_RULES = {
  /** 看最近多少天的询价和订单（按询价时间、下单时间） */
  windowDays: 30,
  /** 报价最多取多少个（最近的在前）；超过的只算最近的这些，结果里标出 */
  maxQuotes: 100_000,
  /** 订单最多取多少张（同上） */
  maxOrders: 100_000,
} as const;

/** 一个报价里参加过比价的一个候选（快照里的排序依据）。 */
export interface ImpactCandidate {
  tenantId: string;
  productId: string;
  settlementMinor: number;
  settlementCurrency: CurrencyCode;
  /** 结算币种 → 客人支付币种的中央汇率（快照里的）；同币种为 null。跨币种却为 null = 快照里缺汇率 */
  fx: FxQuote | null;
  /** 汇率缓冲（基点）：快照里的 */
  fxBufferBp: number;
  observation: boolean;
  /** 比价用的评分（快照里已经是按单量处理过的口径） */
  scoreCenti: number;
  completedOrders: number;
}

/** 一个报价（一个车型组）：重算加价要用的维度、客人支付的币种、快照汇率、全部候选。 */
export interface ImpactQuote {
  cityId: string;
  category: ServiceCategory;
  vehicleGroupId: string;
  /** 用车日期（城市当地）：加价规则的日期范围按它 */
  serviceDate: string;
  currency: CurrencyCode;
  /** 渠道结算币种 → 客人支付币种的中央汇率（快照里的）；同币种为 null。跨币种却为 null = 快照里缺汇率 */
  settleFx: FxQuote | null;
  candidates: readonly ImpactCandidate[];
}

/** 一张付过款的订单：它的报价，和这一单计入多少（基点）：没取消的 10000；付过款后取消的是扣款比例（免费取消为 0）。 */
export interface ImpactOrder extends ImpactQuote {
  cancelled: boolean;
  shareBp: number;
}

/** 一套定价：渠道的定价参数和加价规则。 */
export interface PricingState {
  pricing: ChannelPricing;
  rules: readonly MarkupRule[];
}

/** 按一套定价重算一个报价的结果；所有候选都报不出时为 null。 */
export interface RepricedQuote {
  tenantId: string;
  productId: string;
  /** 客人付的对外价（客人支付币种的最小单位） */
  sellMinor: number;
  settlementMinor: number;
  settlementCurrency: CurrencyCode;
  markupBp: number;
  /** 加价部分不足最低毛利、被补到了最低毛利 */
  minMarginRaised: boolean;
  /** 换到渠道结算币种、按比例折算、四舍五入后的对外价和结算价 */
  sellSettleMinor: number;
  settlementSettleMinor: number;
}

export interface ImpactTotals {
  sellMinor: number;
  settlementMinor: number;
  marginMinor: number;
}

export interface ImpactSection {
  /** 计入了的个数（改前或改后至少一边报得出价） */
  count: number;
  before: ImpactTotals;
  after: ImpactTotals;
  /** 改后 − 改前 */
  diff: ImpactTotals;
  /** 中标会换人的个数 */
  winnerChanged: number;
  /** 中标者的加价部分不足最低毛利、要补到最低毛利的个数（引擎不拦这种报价，按最低毛利补价）：改前 / 改后 */
  minMarginRaisedBefore: number;
  minMarginRaisedAfter: number;
  /** 改前报得出、改后报不出（如最低毛利要换币种却缺汇率、对外价超上限） */
  becameUnquotable: number;
  /** 改前报不出、改后报得出 */
  becameQuotable: number;
  /** 快照里缺了要用的汇率，没法重算、没计入的个数 */
  skipped: number;
}

export interface OrderImpactSection extends ImpactSection {
  /** 付过款后有偿取消、按扣款比例计入的单数（含在 count 里） */
  cancelledWithFee: number;
  /** 付过款后免费取消的单数：毛利是 0，改规则不影响，不计入 count */
  cancelledFree: number;
}

export interface PricingImpactResult {
  settleCurrency: CurrencyCode;
  quotes: ImpactSection;
  orders: OrderImpactSection;
}

const FULL_SHARE = 10_000;

/** 金额从一个币种换到渠道结算币种：先按候选的快照汇率换到客人支付币种，再按渠道的快照汇率换到结算币种。缺汇率返回 null。 */
function toSettle(amount: ExactAmount, from: CurrencyCode, fx: FxQuote | null, quote: Pick<ImpactQuote, "currency" | "settleFx">, settleCurrency: CurrencyCode): ExactAmount | null {
  if (from === settleCurrency) return amount;
  let value = amount;
  if (from !== quote.currency) {
    const rate = fx !== null && fx.from === from && fx.to === quote.currency ? rateFraction(fx.rate) : null;
    if (rate === null) return null;
    value = scaleExact(value, rate.numerator * 10n ** BigInt(minorDigits(quote.currency)), rate.denominator * 10n ** BigInt(minorDigits(from)));
  }
  if (quote.currency === settleCurrency) return value;
  const settle = quote.settleFx !== null && quote.settleFx.from === settleCurrency && quote.settleFx.to === quote.currency ? rateFraction(quote.settleFx.rate) : null;
  if (settle === null) return null;
  return scaleExact(value, settle.denominator * 10n ** BigInt(minorDigits(settleCurrency)), settle.numerator * 10n ** BigInt(minorDigits(quote.currency)));
}

/** 快照里有没有重算要用的全部汇率：跨币种的候选要有自己的汇率；客人支付币种和渠道结算币种不同要有渠道的汇率。 */
export function impactQuoteComplete(quote: ImpactQuote, settleCurrency: CurrencyCode): boolean {
  if (quote.candidates.length === 0) return false;
  if (quote.currency !== settleCurrency && (quote.settleFx === null || rateFraction(quote.settleFx.rate) === null || quote.settleFx.from !== settleCurrency || quote.settleFx.to !== quote.currency)) return false;
  return quote.candidates.every((candidate) => candidate.settlementCurrency === quote.currency || (candidate.fx !== null && candidate.fx.from === candidate.settlementCurrency && candidate.fx.to === quote.currency && rateFraction(candidate.fx.rate) !== null));
}

interface Ranked extends RankCandidate {
  source: ImpactCandidate;
  sell: SellPrice;
}

/** 一套定价的重算器：加价比例和对外价按输入记下来（同一个商品一个月里多半是同一个价，重复的不再算）。 */
export function repricer(state: PricingState, settleCurrency: CurrencyCode): (quote: ImpactQuote, shareBp?: number) => RepricedQuote | null {
  const markups = new Map<string, number>();
  const sells = new Map<string, SellPrice | null>();
  const markupOf = (quote: ImpactQuote, tenantId: string): number => {
    const key = `${tenantId}|${quote.cityId}|${quote.category}|${quote.vehicleGroupId}|${quote.serviceDate}`;
    let markup = markups.get(key);
    if (markup === undefined) {
      markup = resolveMarkup({ defaultMarkupBp: state.pricing.defaultMarkupBp, rules: state.rules }, { tenantId, cityId: quote.cityId, category: quote.category, vehicleGroupId: quote.vehicleGroupId, serviceDate: quote.serviceDate }).markupBp;
      markups.set(key, markup);
    }
    return markup;
  };
  const sellOf = (quote: ImpactQuote, candidate: ImpactCandidate, markupBp: number): SellPrice | null => {
    const key = `${candidate.settlementMinor}|${candidate.settlementCurrency}|${quote.currency}|${markupBp}|${candidate.fx?.rate ?? ""}|${candidate.fxBufferBp}|${quote.settleFx?.rate ?? ""}`;
    if (sells.has(key)) return sells.get(key) as SellPrice | null;
    const result = sellPrice({
      settlementMinor: candidate.settlementMinor,
      settlementCurrency: candidate.settlementCurrency,
      currency: quote.currency,
      markupBp,
      markupFloorBp: state.pricing.markupFloorBp,
      fxBufferBp: candidate.fxBufferBp,
      fx: candidate.fx,
      channel: {
        roundingUnit: state.pricing.sellRounding[quote.currency] ?? 1,
        minMargin: state.pricing.minMarginMinor === 0 ? null : { minor: state.pricing.minMarginMinor, currency: settleCurrency, fx: quote.settleFx },
      },
    });
    const sell = "failure" in result ? null : result;
    sells.set(key, sell);
    return sell;
  };
  return (quote, shareBp = FULL_SHARE) => {
    const offers: Ranked[] = [];
    for (const candidate of quote.candidates) {
      const sell = sellOf(quote, candidate, markupOf(quote, candidate.tenantId));
      if (sell === null) continue;
      offers.push({ tenantId: candidate.tenantId, sellMinor: sell.sellMinor, observation: candidate.observation, scoreCenti: candidate.scoreCenti, completedOrders: candidate.completedOrders, tieBreak: `${candidate.tenantId}|${candidate.productId}`, source: candidate, sell });
    }
    if (offers.length === 0) return null;
    const winner = (rankCandidates(offers, state.pricing.bandBp)[0] as { candidate: Ranked }).candidate;
    const share = (amount: ExactAmount | null): number | null => (amount === null ? null : roundFractionToUnit(amount.numerator * BigInt(shareBp), amount.denominator * BigInt(FULL_SHARE), 1));
    const sellSettle = share(toSettle(exactFromMinor(winner.sell.sellMinor), quote.currency, null, quote, settleCurrency));
    const settlementSettle = share(toSettle(exactFromMinor(winner.source.settlementMinor), winner.source.settlementCurrency, winner.source.fx, quote, settleCurrency));
    if (sellSettle === null || settlementSettle === null) return null;
    return {
      tenantId: winner.tenantId,
      productId: winner.source.productId,
      sellMinor: winner.sell.sellMinor,
      settlementMinor: winner.source.settlementMinor,
      settlementCurrency: winner.source.settlementCurrency,
      markupBp: winner.sell.markupBp,
      minMarginRaised: winner.sell.channel?.minMarginApplied ?? false,
      sellSettleMinor: sellSettle,
      settlementSettleMinor: settlementSettle,
    };
  };
}

class Section {
  count = 0;
  before = { sell: 0n, settlement: 0n };
  after = { sell: 0n, settlement: 0n };
  winnerChanged = 0;
  minMarginRaisedBefore = 0;
  minMarginRaisedAfter = 0;
  becameUnquotable = 0;
  becameQuotable = 0;
  skipped = 0;

  add(before: RepricedQuote | null, after: RepricedQuote | null): boolean {
    if (before === null && after === null) return false;
    this.count += 1;
    if (before !== null) {
      this.before.sell += BigInt(before.sellSettleMinor);
      this.before.settlement += BigInt(before.settlementSettleMinor);
      if (before.minMarginRaised) this.minMarginRaisedBefore += 1;
    }
    if (after !== null) {
      this.after.sell += BigInt(after.sellSettleMinor);
      this.after.settlement += BigInt(after.settlementSettleMinor);
      if (after.minMarginRaised) this.minMarginRaisedAfter += 1;
    }
    if (before !== null && after === null) this.becameUnquotable += 1;
    else if (before === null && after !== null) this.becameQuotable += 1;
    else if (before !== null && after !== null && before.tenantId !== after.tenantId) this.winnerChanged += 1;
    return true;
  }

  result(): ImpactSection {
    const totals = (side: { sell: bigint; settlement: bigint }): ImpactTotals => ({ sellMinor: safe(side.sell), settlementMinor: safe(side.settlement), marginMinor: safe(side.sell - side.settlement) });
    const before = totals(this.before);
    const after = totals(this.after);
    return {
      count: this.count,
      before,
      after,
      diff: { sellMinor: after.sellMinor - before.sellMinor, settlementMinor: after.settlementMinor - before.settlementMinor, marginMinor: after.marginMinor - before.marginMinor },
      winnerChanged: this.winnerChanged,
      minMarginRaisedBefore: this.minMarginRaisedBefore,
      minMarginRaisedAfter: this.minMarginRaisedAfter,
      becameUnquotable: this.becameUnquotable,
      becameQuotable: this.becameQuotable,
      skipped: this.skipped,
    };
  }
}

function safe(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) throw new RangeError(`试算的合计超出了安全整数范围：${value}`);
  return Number(value);
}

/** 试算的累加器：报价和订单可以分批加进来（数据量大时不必一次全取到内存里），最后取结果。 */
export interface PricingImpactAccumulator {
  addQuote(quote: ImpactQuote): void;
  addOrder(order: ImpactOrder): void;
  result(): PricingImpactResult;
}

export function pricingImpactAccumulator(input: { before: PricingState; after: PricingState; settleCurrency: CurrencyCode }): PricingImpactAccumulator {
  const { settleCurrency } = input;
  const before = repricer(input.before, settleCurrency);
  const after = repricer(input.after, settleCurrency);
  const quotes = new Section();
  const orders = new Section();
  let cancelledWithFee = 0;
  let cancelledFree = 0;
  return {
    addQuote(quote) {
      if (!impactQuoteComplete(quote, settleCurrency)) {
        quotes.skipped += 1;
        return;
      }
      quotes.add(before(quote), after(quote));
    },
    addOrder(order) {
      if (!Number.isInteger(order.shareBp) || order.shareBp < 0 || order.shareBp > FULL_SHARE) throw new RangeError(`订单的计入比例必须是 0 到 10000 的整数基点：${order.shareBp}`);
      if (order.cancelled && order.shareBp === 0) {
        cancelledFree += 1;
        return;
      }
      if (!impactQuoteComplete(order, settleCurrency)) {
        orders.skipped += 1;
        return;
      }
      if (orders.add(before(order, order.shareBp), after(order, order.shareBp)) && order.cancelled) cancelledWithFee += 1;
    },
    result() {
      return { settleCurrency, quotes: quotes.result(), orders: { ...orders.result(), cancelledWithFee, cancelledFree } };
    },
  };
}

/** 一次算完（测试和数据量小的时候用）。 */
export function pricingImpact(input: { before: PricingState; after: PricingState; settleCurrency: CurrencyCode; quotes: readonly ImpactQuote[]; orders: readonly ImpactOrder[] }): PricingImpactResult {
  const acc = pricingImpactAccumulator(input);
  for (const quote of input.quotes) acc.addQuote(quote);
  for (const order of input.orders) acc.addOrder(order);
  return acc.result();
}
