/**
 * M3-07：加价规则生效前的毛利试算（ADR 0033）。
 * 前半是逐条手算核对的例子；最后一个测试用一份独立写的对照实现（不约分的分数、自己写的五级匹配和比价）随机核对。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type ChannelPricing,
  type FxQuote,
  type ImpactCandidate,
  type ImpactOrder,
  type ImpactQuote,
  type MarkupRule,
  type PricingState,
  impactQuoteComplete,
  pricingImpact,
  pricingImpactAccumulator,
  repricer,
} from "./index.ts";

const TA = "00000000-0000-4000-8000-00000000000a";
const TB = "00000000-0000-4000-8000-00000000000b";
const TC = "00000000-0000-4000-8000-00000000000c";
const CITY = "00000000-0000-4000-8000-0000000000c1";
const VG = "00000000-0000-4000-8000-0000000000f1";

const pricing = (overrides: Partial<ChannelPricing> = {}): ChannelPricing => ({ defaultMarkupBp: 1_000, markupFloorBp: 1_000, bandBp: 300, minMarginMinor: 0, sellRounding: {}, ...overrides });
const state = (overrides: Partial<ChannelPricing> = {}, rules: MarkupRule[] = []): PricingState => ({ pricing: pricing(overrides), rules });
const fx = (from: FxQuote["from"], to: FxQuote["to"], rate: string): FxQuote => ({ from, to, rate, asOf: "2026-10-20T00:00:00.000Z" });

function candidate(tenantId: string, settlementMinor: number, overrides: Partial<ImpactCandidate> = {}): ImpactCandidate {
  return { tenantId, productId: `p-${tenantId.slice(-1)}`, settlementMinor, settlementCurrency: "JPY", fx: null, fxBufferBp: 0, observation: false, scoreCenti: 450, completedOrders: 0, ...overrides };
}

function quote(candidates: ImpactCandidate[], overrides: Partial<ImpactQuote> = {}): ImpactQuote {
  return { cityId: CITY, category: "airport_transfer", vehicleGroupId: VG, serviceDate: "2026-10-20", currency: "JPY", settleFx: null, candidates, ...overrides };
}

const order = (q: ImpactQuote, cancelled = false, shareBp = 10_000): ImpactOrder => ({ ...q, cancelled, shareBp });

const rule = (id: string, overrides: Partial<MarkupRule>): MarkupRule => ({ id, tenantId: null, cityId: null, category: null, vehicleGroupId: null, markupBp: 1_200, validFrom: null, validTo: null, ...overrides });

test("同币种：默认加价 10% → 12%，对外价、结算价、毛利逐项核对", () => {
  const q = quote([candidate(TA, 10_000)]);
  const result = pricingImpact({ before: state(), after: state({ defaultMarkupBp: 1_200 }), settleCurrency: "JPY", quotes: [q, q], orders: [order(q)] });
  assert.deepEqual(result.quotes.before, { sellMinor: 22_000, settlementMinor: 20_000, marginMinor: 2_000 });
  assert.deepEqual(result.quotes.after, { sellMinor: 22_400, settlementMinor: 20_000, marginMinor: 2_400 });
  assert.deepEqual(result.quotes.diff, { sellMinor: 400, settlementMinor: 0, marginMinor: 400 });
  assert.equal(result.quotes.count, 2);
  assert.deepEqual(result.orders.diff, { sellMinor: 200, settlementMinor: 0, marginMinor: 200 });
  assert.equal(result.orders.count, 1);
  assert.equal(result.quotes.winnerChanged, 0);
});

test("中标重算：给 B 单设 15%，B 的对外价出了同价区间，A 中标（换人）", () => {
  // A 10,300 × 1.1 = 11,330；B 10,000 × 1.1 = 11,000（B 最低、中标）。B 改 15% → 11,500 > 11,330 × 1.03? 11,669.9 —— 仍在区间里；
  // 区间里比评分：A 4.80 分 > B 4.50 分 → 改前 A 就中标。换一组：A 评分不高于 B
  const q = quote([candidate(TA, 10_300), candidate(TB, 10_000)]);
  const before = repricer(state(), "JPY")(q);
  assert.equal(before?.tenantId, TB);
  const after = repricer(state({}, [rule("r1", { tenantId: TB, markupBp: 1_500 })]), "JPY")(q);
  // B 11,500 > A 11,330：都在区间里、评分一样、单量一样 → 排序价低者 A
  assert.equal(after?.tenantId, TA);
  assert.equal(after?.sellMinor, 11_330);
  const result = pricingImpact({ before: state(), after: state({}, [rule("r1", { tenantId: TB, markupBp: 1_500 })]), settleCurrency: "JPY", quotes: [q], orders: [order(q)] });
  assert.equal(result.quotes.winnerChanged, 1);
  assert.equal(result.orders.winnerChanged, 1);
  // 改后平台付给 A 的结算价是 10,300：毛利 1,030（改前 B：1,000）
  assert.deepEqual(result.orders.before, { sellMinor: 11_000, settlementMinor: 10_000, marginMinor: 1_000 });
  assert.deepEqual(result.orders.after, { sellMinor: 11_330, settlementMinor: 10_300, marginMinor: 1_030 });
});

test("中标重算：同价区间里评分高的中标；加价把它推出区间后换成最低价的", () => {
  // A 10,250 评分 4.90；B 10,000 评分 4.50。10% 时 A 11,275 ≤ 11,000 × 1.03 = 11,330 → 在区间里，A 评分高中标
  const q = quote([candidate(TA, 10_250, { scoreCenti: 490, completedOrders: 30 }), candidate(TB, 10_000)]);
  assert.equal(repricer(state(), "JPY")(q)?.tenantId, TA);
  // A 改 11%：11,377.5 → 11,378 > 11,330 → 出区间，B 中标
  assert.equal(repricer(state({}, [rule("r1", { tenantId: TA, markupBp: 1_100 })]), "JPY")(q)?.tenantId, TB);
  // 价格带调到 5%：区间上沿 11,550，A 回到区间里
  assert.equal(repricer(state({ bandBp: 500 }, [rule("r1", { tenantId: TA, markupBp: 1_100 })]), "JPY")(q)?.tenantId, TA);
});

test("观察期租户排序时 × 1.05（只用于比较），客人付的仍是它自己的对外价", () => {
  const q = quote([candidate(TA, 9_000, { observation: true }), candidate(TB, 10_000)]);
  // A 9,900 × 1.05 = 10,395 < B 11,000 → A 中标，付 9,900
  const winner = repricer(state(), "JPY")(q);
  assert.equal(winner?.tenantId, TA);
  assert.equal(winner?.sellMinor, 9_900);
});

test("加价规则的日期范围按用车日期：促销期里的报价才按促销比例", () => {
  const promo = rule("r1", { cityId: CITY, category: "airport_transfer", markupBp: 1_500, validFrom: "2026-10-10", validTo: "2026-10-15" });
  const inside = quote([candidate(TA, 10_000)], { serviceDate: "2026-10-15" });
  const outside = quote([candidate(TA, 10_000)], { serviceDate: "2026-10-16" });
  const result = pricingImpact({ before: state(), after: state({}, [promo]), settleCurrency: "JPY", quotes: [inside, outside], orders: [] });
  assert.deepEqual(result.quotes.diff, { sellMinor: 500, settlementMinor: 0, marginMinor: 500 });
});

test("加价比例低于新的下限时按下限算", () => {
  const q = quote([candidate(TA, 10_000)]);
  const result = pricingImpact({ before: state(), after: state({ markupFloorBp: 1_300, defaultMarkupBp: 1_300 }, [rule("r1", { tenantId: TA, markupBp: 1_100 })]), settleCurrency: "JPY", quotes: [q], orders: [] });
  assert.equal(result.quotes.after.sellMinor, 11_300);
});

test("对外价取整：客人付的币种设了取整单位就向上取整", () => {
  const q = quote([candidate(TA, 108_900)]);
  const result = pricingImpact({ before: state(), after: state({ sellRounding: { JPY: 100 } }), settleCurrency: "JPY", quotes: [q], orders: [] });
  assert.equal(result.quotes.before.sellMinor, 119_790);
  assert.equal(result.quotes.after.sellMinor, 119_800);
  assert.equal(result.quotes.diff.marginMinor, 10);
});

test("最低毛利：加价部分不够时补到最低毛利，计数「要补价的」", () => {
  const small = quote([candidate(TA, 3_000)]);
  const large = quote([candidate(TA, 30_000)]);
  const result = pricingImpact({ before: state(), after: state({ minMarginMinor: 500 }), settleCurrency: "JPY", quotes: [small, large], orders: [order(small)] });
  // 3,000 × 10% = 300 < 500 → 3,500；30,000 × 10% = 3,000 ≥ 500 不变
  assert.equal(result.quotes.after.sellMinor, 3_500 + 33_000);
  assert.equal(result.quotes.minMarginRaisedBefore, 0);
  assert.equal(result.quotes.minMarginRaisedAfter, 1);
  assert.equal(result.orders.minMarginRaisedAfter, 1);
  assert.equal(result.orders.diff.marginMinor, 200);
});

test("跨币种：客人付美元、供应商和渠道都是日元——对外价按快照汇率换回日元、每单四舍五入", () => {
  // 1 JPY = 0.0066 USD。结算 10,000 JPY → 66 USD × 1.015 × 1.1 = 73.689 USD → 7,369 美分
  const rate = fx("JPY", "USD", "0.0066");
  const q = quote([candidate(TA, 10_000, { fx: rate, fxBufferBp: 150 })], { currency: "USD", settleFx: rate });
  const winner = repricer(state(), "JPY")(q);
  assert.equal(winner?.sellMinor, 7_369);
  // 73.69 USD ÷ 0.0066 = 11,165.15… → 11,165 JPY；结算价同币种不换
  assert.equal(winner?.sellSettleMinor, 11_165);
  assert.equal(winner?.settlementSettleMinor, 10_000);
  const result = pricingImpact({ before: state(), after: state({ defaultMarkupBp: 1_200 }), settleCurrency: "JPY", quotes: [q], orders: [] });
  // 改后：66 × 1.015 × 1.12 = 75.0288 → 7,503 美分 → 75.03 ÷ 0.0066 = 11,368.18… → 11,368
  assert.deepEqual(result.quotes.after, { sellMinor: 11_368, settlementMinor: 10_000, marginMinor: 1_368 });
  assert.equal(result.quotes.diff.marginMinor, 11_368 - 11_165);
});

test("跨币种：供应商韩元、客人美元、渠道日元——结算价经美元换到日元（都是快照汇率）", () => {
  const krwUsd = fx("KRW", "USD", "0.00072");
  const jpyUsd = fx("JPY", "USD", "0.0066");
  const q = quote([candidate(TA, 100_000, { settlementCurrency: "KRW", fx: krwUsd, fxBufferBp: 150 })], { currency: "USD", settleFx: jpyUsd });
  const winner = repricer(state(), "JPY")(q);
  // 100,000 KRW × 0.00072 = 72 USD × 1.015 × 1.1 = 80.388 → 8,039 美分
  assert.equal(winner?.sellMinor, 8_039);
  // 80.39 ÷ 0.0066 = 12,180.30… → 12,180；结算价 72 USD ÷ 0.0066 = 10,909.09… → 10,909
  assert.equal(winner?.sellSettleMinor, 12_180);
  assert.equal(winner?.settlementSettleMinor, 10_909);
});

test("最低毛利跨币种用渠道的快照汇率换到客人支付的币种", () => {
  const rate = fx("JPY", "USD", "0.0066");
  const q = quote([candidate(TA, 3_000, { fx: rate, fxBufferBp: 150 })], { currency: "USD", settleFx: rate });
  // 3,000 JPY → 19.8 USD × 1.015 = 20.097；加价 10% = 2.0097 USD；最低毛利 500 JPY = 3.3 USD → 23.397 → 2,340 美分
  const winner = repricer(state({ minMarginMinor: 500 }), "JPY")(q);
  assert.equal(winner?.sellMinor, 2_340);
  assert.equal(winner?.minMarginRaised, true);
});

test("快照里缺汇率的报价没法重算：不计入，单独计数", () => {
  const noCandidateFx = quote([candidate(TA, 10_000, { settlementCurrency: "KRW" })], { currency: "USD", settleFx: fx("JPY", "USD", "0.0066") });
  const noSettleFx = quote([candidate(TA, 10_000, { fx: fx("JPY", "USD", "0.0066"), fxBufferBp: 150 })], { currency: "USD" });
  assert.equal(impactQuoteComplete(noCandidateFx, "JPY"), false);
  assert.equal(impactQuoteComplete(noSettleFx, "JPY"), false);
  assert.equal(impactQuoteComplete(quote([candidate(TA, 10_000)]), "JPY"), true);
  const result = pricingImpact({ before: state(), after: state({ defaultMarkupBp: 1_200 }), settleCurrency: "JPY", quotes: [noCandidateFx, noSettleFx, quote([candidate(TA, 10_000)])], orders: [order(noSettleFx)] });
  assert.equal(result.quotes.skipped, 2);
  assert.equal(result.quotes.count, 1);
  assert.equal(result.orders.skipped, 1);
  assert.equal(result.orders.count, 0);
});

test("订单：有偿取消按扣款比例计入，免费取消只计数", () => {
  const q = quote([candidate(TA, 10_001)]);
  const result = pricingImpact({ before: state(), after: state({ defaultMarkupBp: 1_200 }), settleCurrency: "JPY", quotes: [], orders: [order(q), order(q, true, 5_000), order(q, true, 0)] });
  // 改前：11,001 + 5,500.5 → 5,501（每单四舍五入）；结算 10,001 + 5,000.5 → 5,001
  assert.deepEqual(result.orders.before, { sellMinor: 11_001 + 5_501, settlementMinor: 10_001 + 5_001, marginMinor: 1_000 + 500 });
  // 改后：11,201 + 5,600.5 → 5,601
  assert.deepEqual(result.orders.after, { sellMinor: 11_201 + 5_601, settlementMinor: 10_001 + 5_001, marginMinor: 1_200 + 600 });
  assert.equal(result.orders.count, 2);
  assert.equal(result.orders.cancelledWithFee, 1);
  assert.equal(result.orders.cancelledFree, 1);
});

test("订单的计入比例必须是 0–10000 的整数", () => {
  const acc = pricingImpactAccumulator({ before: state(), after: state(), settleCurrency: "JPY" });
  assert.throws(() => acc.addOrder(order(quote([candidate(TA, 1_000)]), true, 10_001)), RangeError);
  assert.throws(() => acc.addOrder(order(quote([candidate(TA, 1_000)]), true, 12.5)), RangeError);
});

test("规则不变时改前改后完全一样，没有换人", () => {
  const qs = [quote([candidate(TA, 10_250, { scoreCenti: 490, completedOrders: 30 }), candidate(TB, 10_000), candidate(TC, 12_000)])];
  const result = pricingImpact({ before: state(), after: state(), settleCurrency: "JPY", quotes: qs, orders: qs.map((q) => order(q)) });
  assert.deepEqual(result.quotes.diff, { sellMinor: 0, settlementMinor: 0, marginMinor: 0 });
  assert.equal(result.quotes.winnerChanged, 0);
});

// ───────────── 对照实现 ─────────────
// 写法故意和 pricing-impact.ts / quote.ts 不同：分数不约分、比较用交叉相乘；五级匹配写成「打分取最高」；
// 比价先算出区间再按 (评分, 单量, 排序价, 编号) 排；四舍五入用「加半个分母再整除」（这里金额都是正数）。

type Q = [bigint, bigint];
const qMul = (a: Q, b: Q): Q => [a[0] * b[0], a[1] * b[1]];
const qCmp = (a: Q, b: Q): number => {
  const l = a[0] * b[1];
  const r = b[0] * a[1];
  return l < r ? -1 : l > r ? 1 : 0;
};
const qRound = (a: Q): bigint => (2n * a[0] + a[1]) / (2n * a[1]);
const decimal = (text: string): Q => {
  const [whole, frac = ""] = text.split(".");
  return [BigInt(`${whole}${frac}`), 10n ** BigInt(frac.length)];
};
const DIGITS: Record<string, number> = { JPY: 0, USD: 2, KRW: 0 };

function oracleMarkup(pricingValue: ChannelPricing, rules: readonly MarkupRule[], tenantId: string, q: ImpactQuote): number {
  // 级别越具体分越高；同级带日期的再加 0.5
  let best: { score: number; bp: number } | null = null;
  for (const r of rules) {
    const fits = (r.tenantId ?? tenantId) === tenantId && (r.cityId ?? q.cityId) === q.cityId && (r.category ?? q.category) === q.category && (r.vehicleGroupId ?? q.vehicleGroupId) === q.vehicleGroupId;
    const inRange = (r.validFrom ?? "0000") <= q.serviceDate && q.serviceDate <= (r.validTo ?? "9999");
    if (!fits || !inRange) continue;
    const level = r.tenantId && r.cityId ? 1 : r.tenantId ? 2 : r.vehicleGroupId ? 3 : r.cityId ? 4 : 5;
    const score = (6 - level) * 2 + (r.validFrom || r.validTo ? 1 : 0);
    if (best === null || score > best.score) best = { score, bp: r.markupBp };
  }
  return best?.bp ?? pricingValue.defaultMarkupBp;
}

function oracleWinner(s: PricingState, q: ImpactQuote): { c: ImpactCandidate; sell: bigint } {
  const offers = q.candidates.map((c) => {
    const bp = BigInt(Math.max(oracleMarkup(s.pricing, s.rules, c.tenantId, q), s.pricing.markupFloorBp));
    let amount: Q = [BigInt(c.settlementMinor), 1n];
    if (c.settlementCurrency !== q.currency) {
      const r = decimal((c.fx as FxQuote).rate);
      amount = qMul(qMul(amount, r), [10n ** BigInt(DIGITS[q.currency] as number), 10n ** BigInt(DIGITS[c.settlementCurrency] as number)]);
      amount = qMul(amount, [10_000n + BigInt(c.fxBufferBp), 10_000n]);
    }
    const sell = qRound(qMul(amount, [10_000n + bp, 10_000n]));
    const rank: Q = [sell * (c.observation ? 10_500n : 10_000n), 10_000n];
    return { c, sell, rank };
  });
  const lowest = offers.reduce((min, o) => (qCmp(o.rank, min) < 0 ? o.rank : min), (offers[0] as { rank: Q }).rank);
  const ceiling = qMul(lowest, [10_000n + BigInt(s.pricing.bandBp), 10_000n]);
  const inBand = offers.filter((o) => qCmp(o.rank, ceiling) <= 0);
  inBand.sort((a, b) => b.c.scoreCenti - a.c.scoreCenti || b.c.completedOrders - a.c.completedOrders || qCmp(a.rank, b.rank) || (`${a.c.tenantId}|${a.c.productId}` < `${b.c.tenantId}|${b.c.productId}` ? -1 : 1));
  const top = inBand[0] as (typeof offers)[number];
  return { c: top.c, sell: top.sell };
}

function oracleToJpy(amount: bigint, currency: string, q: ImpactQuote, c: ImpactCandidate | null): Q {
  let value: Q = [amount, 1n];
  if (currency === "JPY") return value;
  if (currency !== q.currency) {
    const r = decimal((c?.fx as FxQuote).rate);
    value = qMul(qMul(value, r), [10n ** BigInt(DIGITS[q.currency] as number), 10n ** BigInt(DIGITS[currency] as number)]);
  }
  if (q.currency === "JPY") return value;
  const r = decimal((q.settleFx as FxQuote).rate);
  return qMul(qMul(value, [r[1], r[0]]), [1n, 10n ** BigInt(DIGITS[q.currency] as number)]);
}

function rng(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (x + 0x6d2b79f5) >>> 0;
    let t = x;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("与独立的对照实现比对：随机的规则、候选、币种、取消比例（固定种子）", () => {
  const r = rng(20261026);
  const int = (min: number, max: number): number => min + Math.floor(r() * (max - min + 1));
  const tenants = [TA, TB, TC];
  const usd = { JPY: fx("JPY", "USD", "0.0066"), KRW: fx("KRW", "USD", "0.00072") };
  const randomRules = (): MarkupRule[] => {
    const rules: MarkupRule[] = [];
    for (const [i, t] of tenants.entries()) if (r() < 0.5) rules.push(rule(`t${i}`, { tenantId: t, markupBp: int(1_000, 2_000) }));
    if (r() < 0.5) rules.push(rule("c", { cityId: CITY, category: "airport_transfer", markupBp: int(1_000, 2_000) }));
    if (r() < 0.5) rules.push(rule("cv", { cityId: CITY, category: "airport_transfer", vehicleGroupId: VG, markupBp: int(1_000, 2_000) }));
    if (r() < 0.4) rules.push(rule("tcv", { tenantId: tenants[int(0, 2)] as string, cityId: CITY, category: "airport_transfer", vehicleGroupId: VG, markupBp: int(1_000, 2_000) }));
    if (r() < 0.4) rules.push(rule("promo", { markupBp: int(1_000, 1_500), validFrom: "2026-10-05", validTo: "2026-10-12" }));
    if (r() < 0.4) rules.push(rule("tpromo", { tenantId: tenants[int(0, 2)] as string, markupBp: int(1_000, 1_500), validFrom: "2026-10-08", validTo: "2026-10-20" }));
    return rules;
  };
  for (let round = 0; round < 60; round += 1) {
    const before: PricingState = { pricing: pricing({ defaultMarkupBp: int(1_000, 1_500), bandBp: int(0, 500) }), rules: randomRules() };
    const after: PricingState = { pricing: pricing({ defaultMarkupBp: int(1_000, 1_500), bandBp: int(0, 500) }), rules: randomRules() };
    const quotes: ImpactQuote[] = [];
    const orders: ImpactOrder[] = [];
    for (let i = 0; i < 40; i += 1) {
      const currency = r() < 0.6 ? "JPY" : "USD";
      const candidates = tenants.filter(() => r() < 0.8).map((t) => {
        const settlementCurrency = r() < 0.7 ? "JPY" : "KRW";
        const crossing = settlementCurrency !== currency;
        return candidate(t, settlementCurrency === "KRW" ? int(50_000, 200_000) : int(3_000, 30_000), {
          settlementCurrency,
          fx: crossing ? (settlementCurrency === "KRW" ? usd.KRW : usd.JPY) : null,
          fxBufferBp: crossing ? 150 : 0,
          observation: r() < 0.2,
          scoreCenti: int(400, 500),
          completedOrders: int(0, 60),
        });
      });
      if (candidates.length === 0) continue;
      // KRW 的候选、客人付日元：这个组合要 KRW → JPY 的汇率，测试里不造，改成同币种
      const fixed = candidates.map((c) => (currency === "JPY" && c.settlementCurrency === "KRW" ? { ...c, settlementCurrency: "JPY" as const, settlementMinor: Math.round(c.settlementMinor / 10), fx: null, fxBufferBp: 0 } : c));
      const q = quote(fixed, { currency, settleFx: currency === "USD" ? usd.JPY : null, serviceDate: `2026-10-${String(int(1, 28)).padStart(2, "0")}` });
      quotes.push(q);
      if (r() < 0.5) orders.push(order(q, r() < 0.3, r() < 0.5 ? 10_000 : int(0, 10_000)));
    }
    const actual = pricingImpact({ before, after, settleCurrency: "JPY", quotes, orders });

    const expect = (items: readonly (ImpactQuote & { shareBp?: number; cancelled?: boolean })[]) => {
      const sums = { bs: 0n, bt: 0n, as: 0n, at: 0n, changed: 0, count: 0 };
      for (const item of items) {
        if (item.cancelled && item.shareBp === 0) continue;
        const share: Q = [BigInt(item.shareBp ?? 10_000), 10_000n];
        const b = oracleWinner(before, item);
        const a = oracleWinner(after, item);
        sums.count += 1;
        sums.bs += qRound(qMul(oracleToJpy(b.sell, item.currency, item, null), share));
        sums.bt += qRound(qMul(oracleToJpy(BigInt(b.c.settlementMinor), b.c.settlementCurrency, item, b.c), share));
        sums.as += qRound(qMul(oracleToJpy(a.sell, item.currency, item, null), share));
        sums.at += qRound(qMul(oracleToJpy(BigInt(a.c.settlementMinor), a.c.settlementCurrency, item, a.c), share));
        if (a.c.tenantId !== b.c.tenantId) sums.changed += 1;
      }
      return sums;
    };
    for (const [section, items] of [[actual.quotes, quotes], [actual.orders, orders]] as const) {
      const e = expect(items);
      const label = `第 ${round} 轮`;
      assert.equal(section.count, e.count, label);
      assert.equal(section.before.sellMinor, Number(e.bs), label);
      assert.equal(section.before.settlementMinor, Number(e.bt), label);
      assert.equal(section.after.sellMinor, Number(e.as), label);
      assert.equal(section.after.settlementMinor, Number(e.at), label);
      assert.equal(section.before.marginMinor, Number(e.bs - e.bt), label);
      assert.equal(section.diff.marginMinor, Number(e.as - e.at - (e.bs - e.bt)), label);
      assert.equal(section.winnerChanged, e.changed, label);
    }
  }
});
