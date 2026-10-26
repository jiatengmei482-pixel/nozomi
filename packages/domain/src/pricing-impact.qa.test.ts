/**
 * M3-07 测试角色补充：毛利试算的钱和口径（ADR 0033）。
 *
 * - 对照实现：按 ADR 0033 和第 11 步、第 10 步的文字独立写（只用 BigInt 分数，不调用被测的 sellPrice / rankCandidates / resolveMarkup），
 *   覆盖开发自带的对照没碰到的部分：最低毛利（同币种、跨币种）、对外价向上取整、加价下限、渠道结算币种不是日元（美元，有小数位）、
 *   三种币种的候选、要补最低毛利的计数。
 * - 边界：同价区间正好 3%、观察期 × 1.05 让中标换人；最低毛利「正好够」不算补价；有偿取消按比例每单取整；
 *   删规则、改定价参数、加更具体的规则时差额的方向；快照缺汇率、渠道结算币种改过的报价不计入合计。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type ChannelPricing,
  type CurrencyCode,
  type FxQuote,
  type ImpactCandidate,
  type ImpactOrder,
  type ImpactQuote,
  type MarkupRule,
  type PricingImpactResult,
  type PricingState,
  pricingImpact,
} from "./index.ts";

const TA = "00000000-0000-4000-8000-0000000000a1";
const TB = "00000000-0000-4000-8000-0000000000b2";
const TC = "00000000-0000-4000-8000-0000000000c3";
const TD = "00000000-0000-4000-8000-0000000000d4";
const CITY = "00000000-0000-4000-8000-00000000c171";
const CITY2 = "00000000-0000-4000-8000-00000000c172";
const VG = "00000000-0000-4000-8000-0000000000f1";
const VG2 = "00000000-0000-4000-8000-0000000000f2";

const pricing = (overrides: Partial<ChannelPricing> = {}): ChannelPricing => ({ defaultMarkupBp: 1_000, markupFloorBp: 1_000, bandBp: 300, minMarginMinor: 0, sellRounding: {}, ...overrides });
const fxq = (from: CurrencyCode, to: CurrencyCode, rate: string): FxQuote => ({ from, to, rate, asOf: "2026-10-20T00:00:00.000Z" });
const cand = (tenantId: string, settlementMinor: number, overrides: Partial<ImpactCandidate> = {}): ImpactCandidate => ({
  tenantId,
  productId: `prod-${tenantId.slice(-2)}`,
  settlementMinor,
  settlementCurrency: "JPY",
  fx: null,
  fxBufferBp: 0,
  observation: false,
  scoreCenti: 450,
  completedOrders: 0,
  ...overrides,
});
const quoteOf = (candidates: ImpactCandidate[], overrides: Partial<ImpactQuote> = {}): ImpactQuote => ({ cityId: CITY, category: "airport_transfer", vehicleGroupId: VG, serviceDate: "2026-10-20", currency: "JPY", settleFx: null, candidates, ...overrides });
const orderOf = (q: ImpactQuote, cancelled = false, shareBp = 10_000): ImpactOrder => ({ ...q, cancelled, shareBp });
const ruleOf = (id: string, overrides: Partial<MarkupRule>): MarkupRule => ({ id, tenantId: null, cityId: null, category: null, vehicleGroupId: null, markupBp: 1_200, validFrom: null, validTo: null, ...overrides });

function run(before: PricingState, after: PricingState, quotes: ImpactQuote[], orders: ImpactOrder[] = [], settleCurrency: CurrencyCode = "JPY"): PricingImpactResult {
  return pricingImpact({ before, after, settleCurrency, quotes, orders });
}

/** 合计的自洽：对外价 − 结算价 = 毛利；差额 = 改后 − 改前；都是安全整数 */
function assertConsistent(result: PricingImpactResult, label = ""): void {
  for (const section of [result.quotes, result.orders]) {
    for (const side of [section.before, section.after, section.diff]) {
      for (const value of [side.sellMinor, side.settlementMinor, side.marginMinor]) assert.ok(Number.isSafeInteger(value), `${label} 不是整数：${value}`);
      assert.equal(side.sellMinor - side.settlementMinor, side.marginMinor, `${label} 对外价 − 结算价 ≠ 毛利`);
    }
    assert.equal(section.diff.sellMinor, section.after.sellMinor - section.before.sellMinor, label);
    assert.equal(section.diff.settlementMinor, section.after.settlementMinor - section.before.settlementMinor, label);
    assert.equal(section.diff.marginMinor, section.after.marginMinor - section.before.marginMinor, label);
  }
}

// ───────────── 边界：同价区间、观察期 ─────────────

test("同价区间正好 3% 算在区间里（评分高的中标）；多 1 日元出区间就换成最低价的——换人计数、毛利按新中标者", () => {
  // 乙 10,000 × 1.1 = 11,000（最低）；甲 10,300 × 1.1 = 11,330 = 11,000 × 1.03 正好在区间里，甲评分高 → 甲中标
  // 改后甲 10.01%：10,300 × 1.1001 = 11,331.03 → 11,331 > 11,330 → 出区间，乙中标
  const q = quoteOf([cand(TA, 10_300, { scoreCenti: 490, completedOrders: 30 }), cand(TB, 10_000)]);
  const before: PricingState = { pricing: pricing(), rules: [] };
  const after: PricingState = { pricing: pricing(), rules: [ruleOf("ta", { tenantId: TA, markupBp: 1_001 })] };
  const result = run(before, after, [q]);
  assert.deepEqual(result.quotes.before, { sellMinor: 11_330, settlementMinor: 10_300, marginMinor: 1_030 });
  assert.deepEqual(result.quotes.after, { sellMinor: 11_000, settlementMinor: 10_000, marginMinor: 1_000 });
  assert.equal(result.quotes.winnerChanged, 1);
  assert.deepEqual(result.quotes.diff, { sellMinor: -330, settlementMinor: -300, marginMinor: -30 });
});

test("观察期 × 1.05 只用于排序：同价区间按 1.05 后的价算；客人付的、毛利按观察期租户自己的对外价", () => {
  // 甲（观察期）10,000 × 1.1 = 11,000 → 排序价 11,550，区间上限 11,550 × 1.03 = 11,896.5
  // 乙 10,814 × 1.1 = 11,895.4 → 11,895 在区间里，乙评分高 → 乙中标。不 × 1.05 时上限只有 11,330，乙不会中标
  // 改后乙 10.02%：10,814 × 1.1002 = 11,897.56 → 11,898 出区间 → 甲中标，客人付 11,000（不是 11,550）
  const q = quoteOf([cand(TA, 10_000, { observation: true }), cand(TB, 10_814, { scoreCenti: 495, completedOrders: 50 })]);
  const result = run({ pricing: pricing(), rules: [] }, { pricing: pricing(), rules: [ruleOf("tb", { tenantId: TB, markupBp: 1_002 })] }, [q]);
  assert.deepEqual(result.quotes.before, { sellMinor: 11_895, settlementMinor: 10_814, marginMinor: 1_081 });
  assert.deepEqual(result.quotes.after, { sellMinor: 11_000, settlementMinor: 10_000, marginMinor: 1_000 });
  assert.equal(result.quotes.winnerChanged, 1);
  // 乙只加到 10.01%：11,896 仍在区间里，不换人
  const stay = run({ pricing: pricing(), rules: [] }, { pricing: pricing(), rules: [ruleOf("tb", { tenantId: TB, markupBp: 1_001 })] }, [q]);
  assert.equal(stay.quotes.winnerChanged, 0);
  assert.deepEqual(stay.quotes.after, { sellMinor: 11_896, settlementMinor: 10_814, marginMinor: 1_082 });
});

test("改价格带：区间从 3% 收到 0%，原来靠评分中标的换成最低价的", () => {
  const q = quoteOf([cand(TA, 10_200, { scoreCenti: 490, completedOrders: 30 }), cand(TB, 10_000)]);
  const result = run({ pricing: pricing(), rules: [] }, { pricing: pricing({ bandBp: 0 }), rules: [] }, [q]);
  assert.equal(result.quotes.winnerChanged, 1);
  assert.deepEqual(result.quotes.diff, { sellMinor: 11_000 - 11_220, settlementMinor: -200, marginMinor: 1_000 - 1_020 });
});

// ───────────── 最低毛利 ─────────────

test("最低毛利：加价正好等于最低毛利不算补价；差 1 日元才补；补价计数按中标者", () => {
  // 10,000 × 10% = 1,000。最低毛利 1,000：正好够，不补；1,001：补到 11,001
  const q = quoteOf([cand(TA, 10_000)]);
  const exact = run({ pricing: pricing(), rules: [] }, { pricing: pricing({ minMarginMinor: 1_000 }), rules: [] }, [q]);
  assert.deepEqual([exact.quotes.minMarginRaisedBefore, exact.quotes.minMarginRaisedAfter, exact.quotes.diff.marginMinor], [0, 0, 0]);
  const short = run({ pricing: pricing(), rules: [] }, { pricing: pricing({ minMarginMinor: 1_001 }), rules: [] }, [q, q], [orderOf(q)]);
  assert.deepEqual([short.quotes.minMarginRaisedBefore, short.quotes.minMarginRaisedAfter, short.quotes.diff.marginMinor], [0, 2, 2]);
  assert.deepEqual([short.orders.minMarginRaisedAfter, short.orders.diff.marginMinor], [1, 1]);
  // 改前已经要补、改后不用补（把加价提到 12%）：改前计 1，改后计 0
  const lifted = run({ pricing: pricing({ minMarginMinor: 1_100 }), rules: [] }, { pricing: pricing({ minMarginMinor: 1_100, defaultMarkupBp: 1_200 }), rules: [] }, [q]);
  assert.deepEqual([lifted.quotes.minMarginRaisedBefore, lifted.quotes.minMarginRaisedAfter, lifted.quotes.diff.marginMinor], [1, 0, 100]);
});

test("最低毛利补价会改变中标：都补到同样的加价后价差比例变小，评分高的进了同价区间", () => {
  // 改前：甲 5,000 × 1.1 = 5,500（最低），乙 5,300 × 1.1 = 5,830 > 5,500 × 1.03 = 5,665 → 区间外，甲中标
  // 改后最低毛利 5,000：甲补到 10,000、乙补到 10,300 = 10,000 × 1.03 正好进区间，乙评分高 → 乙中标
  const q = quoteOf([cand(TA, 5_000), cand(TB, 5_300, { scoreCenti: 490, completedOrders: 30 })]);
  const result = run({ pricing: pricing(), rules: [] }, { pricing: pricing({ minMarginMinor: 5_000 }), rules: [] }, [q]);
  assert.deepEqual(result.quotes.before, { sellMinor: 5_500, settlementMinor: 5_000, marginMinor: 500 });
  assert.deepEqual(result.quotes.after, { sellMinor: 10_300, settlementMinor: 5_300, marginMinor: 5_000 });
  assert.deepEqual([result.quotes.winnerChanged, result.quotes.minMarginRaisedBefore, result.quotes.minMarginRaisedAfter], [1, 0, 1]);
});

test("最低毛利跨币种：渠道结算美元、客人付日元——最低毛利按快照的渠道汇率换成日元再补；毛利换回美元（美分）", () => {
  // 渠道结算 USD，最低毛利 US$10.00 = 1,000 美分；快照汇率 1 USD = 150 JPY → 1,500 日元
  // 甲 10,000 日元 × 1.1 = 11,000（加价 1,000 < 1,500）→ 补到 11,500
  // 换回美元：11,500 ÷ 150 = 76.666… → 7,667 美分；结算价 10,000 ÷ 150 = 66.666… → 6,667 美分；毛利 1,000 美分
  const q = quoteOf([cand(TA, 10_000)], { settleFx: fxq("USD", "JPY", "150") });
  const result = run({ pricing: pricing(), rules: [] }, { pricing: pricing({ minMarginMinor: 1_000 }), rules: [] }, [q], [], "USD");
  assert.deepEqual(result.quotes.before, { sellMinor: 7_333, settlementMinor: 6_667, marginMinor: 666 });
  assert.deepEqual(result.quotes.after, { sellMinor: 7_667, settlementMinor: 6_667, marginMinor: 1_000 });
  assert.equal(result.quotes.minMarginRaisedAfter, 1);
});

// ───────────── 取消比例、每单取整 ─────────────

test("有偿取消：对外价、结算价各自按比例四舍五入再相加，合计里对外价 − 结算价 = 毛利；比例 1 基点也计入", () => {
  // 1,001 × 1.1 = 1,101.1 → 1,101；33.33%：1,101 × 0.3333 = 366.96… → 367；1,001 × 0.3333 = 333.63… → 334；毛利 33
  const q = quoteOf([cand(TA, 1_001)]);
  const same: PricingState = { pricing: pricing(), rules: [] };
  const result = run(same, same, [], [orderOf(q, true, 3_333), orderOf(q, true, 1), orderOf(q, true, 0), orderOf(q, true, 10_000)]);
  // 1 基点：1,101 × 0.0001 = 0.1101 → 0；1,001 × 0.0001 = 0.1001 → 0
  assert.deepEqual(result.orders.before, { sellMinor: 367 + 0 + 1_101, settlementMinor: 334 + 0 + 1_001, marginMinor: 33 + 0 + 100 });
  assert.deepEqual([result.orders.count, result.orders.cancelledWithFee, result.orders.cancelledFree], [3, 3, 1]);
  assertConsistent(result);
});

test("0.5 远离零：按比例折算后正好半个最小单位的进位", () => {
  // 1,100 × 1.1 = 1,210；50%：605；结算价 1,100 × 0.5 = 550。比例 5,005：1,210 × 0.5005 = 605.605 → 606；1,100 × 0.5005 = 550.55 → 551
  // 结算价 1,001、比例 5,000：500.5 → 501；对外价 1,101.1 → 1,101 × 0.5 = 550.5 → 551
  const same: PricingState = { pricing: pricing(), rules: [] };
  const result = run(same, same, [], [orderOf(quoteOf([cand(TA, 1_001)]), true, 5_000)]);
  assert.deepEqual(result.orders.before, { sellMinor: 551, settlementMinor: 501, marginMinor: 50 });
});

test("跨币种每单取整再相加（不是合计后再换）：三个美元报价各自换回日元四舍五入", () => {
  // 客人付美元、渠道结算日元。1 JPY = 0.0066 USD，缓冲 1.5%。结算价 1,000 日元：1,000 × 0.0066 × 1.015 × 1.1 = 7.3689 → 737 美分
  // 换回日元：7.37 ÷ 0.0066 = 1,116.666… → 1,117；三个合计 3,351（先合计 22.11 ÷ 0.0066 = 3,350 会差 1）
  const q = quoteOf([cand(TA, 1_000, { fx: fxq("JPY", "USD", "0.0066"), fxBufferBp: 150 })], { currency: "USD", settleFx: fxq("JPY", "USD", "0.0066") });
  const same: PricingState = { pricing: pricing(), rules: [] };
  const result = run(same, same, [q, q, q]);
  assert.deepEqual(result.quotes.before, { sellMinor: 3 * 1_117, settlementMinor: 3_000, marginMinor: 351 });
});

// ───────────── 改动的方向 ─────────────

test("删除一条高于默认的租户规则：命中它的报价毛利下降，没命中的不变；换人计数", () => {
  const rules = [ruleOf("tb15", { tenantId: TB, markupBp: 1_500 })];
  const onlyB = quoteOf([cand(TB, 10_000)]);
  const onlyA = quoteOf([cand(TA, 10_000)]);
  const result = run({ pricing: pricing(), rules }, { pricing: pricing(), rules: [] }, [onlyB, onlyA]);
  assert.deepEqual(result.quotes.diff, { sellMinor: -500, settlementMinor: 0, marginMinor: -500 });
  assert.ok(result.quotes.diff.marginMinor < 0);
});

test("加一条更具体的规则（第 1 级）压过第 2 级的租户规则：只影响那个城市 × 品类 × 车型组", () => {
  const level2 = ruleOf("tb15", { tenantId: TB, markupBp: 1_500 });
  const level1 = ruleOf("tb-city", { tenantId: TB, cityId: CITY, category: "airport_transfer", vehicleGroupId: VG, markupBp: 1_100 });
  const hit = quoteOf([cand(TB, 10_000)]);
  const otherCity = quoteOf([cand(TB, 10_000)], { cityId: CITY2 });
  const otherVg = quoteOf([cand(TB, 10_000)], { vehicleGroupId: VG2 });
  const otherCategory = quoteOf([cand(TB, 10_000)], { category: "point_to_point" });
  const result = run({ pricing: pricing(), rules: [level2] }, { pricing: pricing(), rules: [level2, level1] }, [hit, otherCity, otherVg, otherCategory]);
  // 只有 hit 从 15% 变成 11%
  assert.deepEqual(result.quotes.diff, { sellMinor: -400, settlementMinor: 0, marginMinor: -400 });
  assert.deepEqual(result.quotes.after, { sellMinor: 11_100 + 3 * 11_500, settlementMinor: 40_000, marginMinor: 1_100 + 3 * 1_500 });
});

test("加一条带日期的促销（第 5 级）：只影响用车日期在范围里（两端都含）的报价；租户规则命中的不受影响", () => {
  const promo = ruleOf("promo", { markupBp: 1_300, validFrom: "2026-10-10", validTo: "2026-10-12" });
  const dates = ["2026-10-09", "2026-10-10", "2026-10-12", "2026-10-13"];
  const quotes = dates.map((serviceDate) => quoteOf([cand(TA, 10_000)], { serviceDate }));
  const tenantRuled = quoteOf([cand(TB, 10_000)], { serviceDate: "2026-10-11" });
  const tb = ruleOf("tb", { tenantId: TB, markupBp: 1_200 });
  const result = run({ pricing: pricing(), rules: [tb] }, { pricing: pricing(), rules: [tb, promo] }, [...quotes, tenantRuled]);
  assert.deepEqual(result.quotes.diff, { sellMinor: 2 * 300, settlementMinor: 0, marginMinor: 2 * 300 });
});

test("改默认加价：被规则命中的报价不受影响；调高下限时低于新下限的规则按下限算", () => {
  const ta = ruleOf("ta", { tenantId: TA, markupBp: 1_100 });
  const qa = quoteOf([cand(TA, 10_000)]);
  const qb = quoteOf([cand(TB, 10_000)]);
  const markup = run({ pricing: pricing(), rules: [ta] }, { pricing: pricing({ defaultMarkupBp: 1_400 }), rules: [ta] }, [qa, qb]);
  assert.deepEqual(markup.quotes.diff, { sellMinor: 400, settlementMinor: 0, marginMinor: 400 });
  const floor = run({ pricing: pricing(), rules: [ta] }, { pricing: pricing({ markupFloorBp: 1_200, defaultMarkupBp: 1_200 }), rules: [ta] }, [qa, qb]);
  assert.deepEqual(floor.quotes.diff, { sellMinor: 100 + 200, settlementMinor: 0, marginMinor: 300 });
});

test("改对外价取整：客人付的币种设了单位才向上取整，别的币种不受影响", () => {
  // 10,001 × 1.1 = 11,001.1 → 取整 100 → 11,100；美元的报价不受日元取整影响
  const jpy = quoteOf([cand(TA, 10_001)]);
  const usd = quoteOf([cand(TA, 10_001, { fx: fxq("JPY", "USD", "0.0066"), fxBufferBp: 150 })], { currency: "USD", settleFx: fxq("JPY", "USD", "0.0066") });
  const result = run({ pricing: pricing(), rules: [] }, { pricing: pricing({ sellRounding: { JPY: 100 } }), rules: [] }, [jpy, usd]);
  assert.deepEqual(result.quotes.diff, { sellMinor: 99, settlementMinor: 0, marginMinor: 99 });
});

// ───────────── 没法重算的 ─────────────

test("快照缺汇率、渠道汇率方向对不上（渠道结算币种改过）：不计入合计、单独计数；订单同样", () => {
  const good = quoteOf([cand(TA, 10_000)]);
  const noCandFx = quoteOf([cand(TA, 10_000, { fx: null, fxBufferBp: 150 })], { currency: "USD", settleFx: fxq("JPY", "USD", "0.0066") });
  // 渠道原来结算美元、记的是 USD → JPY；现在渠道结算改成了日元、客人付美元：要 JPY → USD
  const changedSettle = quoteOf([cand(TA, 10_000, { fx: fxq("JPY", "USD", "0.0066"), fxBufferBp: 150 })], { currency: "USD", settleFx: fxq("USD", "JPY", "150") });
  const badRate = quoteOf([cand(TA, 10_000, { fx: fxq("JPY", "USD", "abc"), fxBufferBp: 150 })], { currency: "USD", settleFx: fxq("JPY", "USD", "0.0066") });
  const empty = quoteOf([]);
  const before: PricingState = { pricing: pricing(), rules: [] };
  const after: PricingState = { pricing: pricing({ defaultMarkupBp: 1_200 }), rules: [] };
  const result = run(before, after, [good, noCandFx, changedSettle, badRate, empty], [orderOf(good), orderOf(noCandFx), orderOf(changedSettle, true, 5_000)]);
  assert.deepEqual([result.quotes.count, result.quotes.skipped], [1, 4]);
  assert.deepEqual(result.quotes.before, { sellMinor: 11_000, settlementMinor: 10_000, marginMinor: 1_000 });
  assert.deepEqual([result.orders.count, result.orders.skipped, result.orders.cancelledWithFee], [1, 2, 0]);
  assert.deepEqual(result.orders.diff, { sellMinor: 200, settlementMinor: 0, marginMinor: 200 });
});

// ───────────── 对照实现 ─────────────

type F = { n: bigint; d: bigint };
const f = (n: bigint, d = 1n): F => ({ n, d });
const mul = (a: F, b: F): F => f(a.n * b.n, a.d * b.d);
const add = (a: F, b: F): F => f(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a: F, b: F): F => f(a.n * b.d - b.n * a.d, a.d * b.d);
const lt = (a: F, b: F): boolean => a.n * b.d < b.n * a.d;
const le = (a: F, b: F): boolean => a.n * b.d <= b.n * a.d;
/** 正数四舍五入（0.5 进位） */
const roundPos = (a: F): bigint => {
  const q = a.n / a.d;
  return (a.n - q * a.d) * 2n >= a.d ? q + 1n : q;
};
const ceilPos = (a: F): bigint => (a.n + a.d - 1n) / a.d;
const dec = (text: string): F => {
  const dot = text.indexOf(".");
  return dot < 0 ? f(BigInt(text)) : f(BigInt(text.replace(".", "")), 10n ** BigInt(text.length - dot - 1));
};
const DIG: Record<string, bigint> = { JPY: 0n, KRW: 0n, USD: 2n };
const scaleCur = (from: string, to: string): F => f(10n ** (DIG[to] as bigint), 10n ** (DIG[from] as bigint));

function oracleRate(rules: readonly MarkupRule[], defaultBp: number, tenantId: string, q: ImpactQuote): number {
  // 具体程度：第 1 级 → 第 5 级；同级里带日期（且在范围里）的优先
  const levelOf = (r: MarkupRule): number => (r.tenantId !== null ? (r.cityId !== null ? 1 : 2) : r.vehicleGroupId !== null ? 3 : r.cityId !== null ? 4 : 5);
  const candidates = rules.filter(
    (r) =>
      [r.tenantId === null || r.tenantId === tenantId, r.cityId === null || r.cityId === q.cityId, r.category === null || r.category === q.category, r.vehicleGroupId === null || r.vehicleGroupId === q.vehicleGroupId].every(Boolean) &&
      (r.validFrom === null || r.validFrom <= q.serviceDate) &&
      (r.validTo === null || q.serviceDate <= r.validTo),
  );
  candidates.sort((a, b) => levelOf(a) - levelOf(b) || Number(b.validFrom !== null || b.validTo !== null) - Number(a.validFrom !== null || a.validTo !== null));
  return candidates[0]?.markupBp ?? defaultBp;
}

interface OracleOffer {
  c: ImpactCandidate;
  sell: bigint;
  raised: boolean;
}

function oracleOffer(s: PricingState, settle: string, q: ImpactQuote, c: ImpactCandidate): OracleOffer {
  let base = f(BigInt(c.settlementMinor));
  if (c.settlementCurrency !== q.currency) base = mul(mul(mul(base, dec((c.fx as FxQuote).rate)), scaleCur(c.settlementCurrency, q.currency)), f(BigInt(10_000 + c.fxBufferBp), 10_000n));
  const bp = Math.max(oracleRate(s.rules, s.pricing.defaultMarkupBp, c.tenantId, q), s.pricing.markupFloorBp);
  let amount = mul(base, f(BigInt(10_000 + bp), 10_000n));
  let raised = false;
  if (s.pricing.minMarginMinor > 0) {
    let margin = f(BigInt(s.pricing.minMarginMinor));
    if (settle !== q.currency) margin = mul(mul(margin, dec((q.settleFx as FxQuote).rate)), scaleCur(settle, q.currency));
    if (lt(sub(amount, base), margin)) {
      amount = add(base, margin);
      raised = true;
    }
  }
  const unit = BigInt(s.pricing.sellRounding[q.currency] ?? 1);
  const sell = unit > 1n ? ceilPos(mul(amount, f(1n, unit))) * unit : roundPos(amount);
  return { c, sell, raised };
}

function oracleWin(s: PricingState, settle: string, q: ImpactQuote): OracleOffer {
  const offers = q.candidates.map((c) => ({ ...oracleOffer(s, settle, q, c), rank: f(oracleOffer(s, settle, q, c).sell * (c.observation ? 105n : 100n), 100n) }));
  let lowest = (offers[0] as { rank: F }).rank;
  for (const o of offers) if (lt(o.rank, lowest)) lowest = o.rank;
  const ceiling = mul(lowest, f(BigInt(10_000 + s.pricing.bandBp), 10_000n));
  const band = offers.filter((o) => le(o.rank, ceiling));
  band.sort((a, b) => {
    if (a.c.scoreCenti !== b.c.scoreCenti) return b.c.scoreCenti - a.c.scoreCenti;
    if (a.c.completedOrders !== b.c.completedOrders) return b.c.completedOrders - a.c.completedOrders;
    if (lt(a.rank, b.rank)) return -1;
    if (lt(b.rank, a.rank)) return 1;
    return `${a.c.tenantId}|${a.c.productId}` < `${b.c.tenantId}|${b.c.productId}` ? -1 : 1;
  });
  return band[0] as OracleOffer;
}

/** 金额换到渠道结算币种（精确值） */
function oracleSettle(amount: bigint, from: string, settle: string, q: ImpactQuote, c: ImpactCandidate | null): F {
  let value = f(amount);
  if (from === settle) return value;
  if (from !== q.currency) value = mul(mul(value, dec((c?.fx as FxQuote).rate)), scaleCur(from, q.currency));
  if (q.currency === settle) return value;
  const r = dec((q.settleFx as FxQuote).rate);
  return mul(mul(value, f(r.d, r.n)), scaleCur(q.currency, settle));
}

function rand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1_664_525) + 1_013_904_223) >>> 0;
    return s / 4_294_967_296;
  };
}

test("与按 ADR 文字独立写的对照实现比对：最低毛利、向上取整、加价下限、三种币种、渠道结算美元 / 日元、取消比例（固定种子 80 轮）", () => {
  const r = rand(3070726);
  const int = (lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1));
  const pick = <T>(items: readonly T[]): T => items[Math.floor(r() * items.length)] as T;
  // 快照汇率：每个方向一个（不要求三角一致——快照里本来就是各自取的）
  const RATES: Record<string, string> = { "JPY>USD": "0.0066", "KRW>USD": "0.00072", "USD>JPY": "151.37", "KRW>JPY": "0.1093", "JPY>KRW": "9.149", "USD>KRW": "1388.5" };
  const tenants = [TA, TB, TC, TD];
  const randomRules = (): MarkupRule[] => {
    const rules: MarkupRule[] = [];
    // 每个槽位最多一条：同一组维度上不带日期的一条、带日期的一条（不重叠），和保存时的约束一致
    for (const [i, t] of tenants.entries()) {
      if (r() < 0.4) rules.push(ruleOf(`t${i}`, { tenantId: t, markupBp: int(800, 2_500) }));
      if (r() < 0.2) rules.push(ruleOf(`t${i}d`, { tenantId: t, markupBp: int(800, 2_500), validFrom: "2026-10-05", validTo: "2026-10-15" }));
      if (r() < 0.2) rules.push(ruleOf(`t${i}cv`, { tenantId: t, cityId: CITY, category: "airport_transfer", vehicleGroupId: pick([VG, VG2]), markupBp: int(800, 2_500) }));
    }
    if (r() < 0.4) rules.push(ruleOf("cv", { cityId: pick([CITY, CITY2]), category: "airport_transfer", vehicleGroupId: VG, markupBp: int(800, 2_500) }));
    if (r() < 0.4) rules.push(ruleOf("c", { cityId: CITY, category: pick(["airport_transfer", "point_to_point"] as const), markupBp: int(800, 2_500) }));
    if (r() < 0.3) rules.push(ruleOf("promo", { markupBp: int(800, 2_000), validFrom: "2026-10-10", validTo: "2026-10-20" }));
    return rules;
  };
  const randomPricing = (settle: CurrencyCode): ChannelPricing => ({
    defaultMarkupBp: int(1_000, 2_000),
    markupFloorBp: pick([1_000, 1_000, 1_200, 1_500]),
    bandBp: int(0, 500),
    minMarginMinor: r() < 0.4 ? 0 : settle === "USD" ? int(100, 3_000) : int(100, 4_000),
    sellRounding: { ...(r() < 0.4 ? { JPY: pick([10, 100, 500]) } : {}), ...(r() < 0.3 ? { USD: pick([50, 100]) } : {}), ...(r() < 0.3 ? { KRW: pick([100, 1_000]) } : {}) },
  });
  for (let round = 0; round < 80; round += 1) {
    const settle: CurrencyCode = r() < 0.5 ? "JPY" : "USD";
    const before: PricingState = { pricing: randomPricing(settle), rules: randomRules() };
    const after: PricingState = { pricing: randomPricing(settle), rules: randomRules() };
    const quotes: ImpactQuote[] = [];
    const orders: ImpactOrder[] = [];
    for (let i = 0; i < 30; i += 1) {
      const currency = pick(["JPY", "USD", "KRW"] as const);
      const candidates = tenants
        .filter(() => r() < 0.7)
        .map((t) => {
          const sc = pick(["JPY", "JPY", "KRW", "USD"] as const);
          const amount = sc === "KRW" ? int(30_000, 400_000) : sc === "USD" ? int(2_000, 30_000) : int(2_000, 40_000);
          return cand(t, amount, {
            settlementCurrency: sc,
            fx: sc === currency ? null : fxq(sc, currency, RATES[`${sc}>${currency}`] as string),
            fxBufferBp: sc === currency ? 0 : pick([150, 150, 0, 300]),
            observation: r() < 0.25,
            scoreCenti: int(420, 500),
            completedOrders: int(0, 40),
          });
        });
      if (candidates.length === 0) continue;
      const q = quoteOf(candidates, {
        currency,
        settleFx: currency === settle ? null : fxq(settle, currency, RATES[`${settle}>${currency}`] as string),
        cityId: pick([CITY, CITY2]),
        vehicleGroupId: pick([VG, VG2]),
        category: pick(["airport_transfer", "point_to_point"] as const),
        serviceDate: `2026-10-${String(int(1, 28)).padStart(2, "0")}`,
      });
      quotes.push(q);
      if (r() < 0.6) {
        const cancelled = r() < 0.4;
        orders.push(orderOf(q, cancelled, cancelled ? pick([0, 0, 1, 2_500, 3_333, 5_000, 9_999, 10_000, int(1, 9_999)]) : 10_000));
      }
    }
    const actual = run(before, after, quotes, orders, settle);
    const label = `第 ${round} 轮（结算 ${settle}）`;
    assertConsistent(actual, label);
    for (const [section, items] of [[actual.quotes, quotes], [actual.orders, orders]] as const) {
      const e = { bs: 0n, bt: 0n, as: 0n, at: 0n, changed: 0, count: 0, raisedB: 0, raisedA: 0, free: 0, fee: 0 };
      for (const item of items as readonly (ImpactQuote & Partial<ImpactOrder>)[]) {
        if (item.cancelled === true && item.shareBp === 0) {
          e.free += 1;
          continue;
        }
        const share = f(BigInt(item.shareBp ?? 10_000), 10_000n);
        const b = oracleWin(before, settle, item);
        const a = oracleWin(after, settle, item);
        e.count += 1;
        if (item.cancelled === true) e.fee += 1;
        e.bs += roundPos(mul(oracleSettle(b.sell, item.currency, settle, item, null), share));
        e.bt += roundPos(mul(oracleSettle(BigInt(b.c.settlementMinor), b.c.settlementCurrency, settle, item, b.c), share));
        e.as += roundPos(mul(oracleSettle(a.sell, item.currency, settle, item, null), share));
        e.at += roundPos(mul(oracleSettle(BigInt(a.c.settlementMinor), a.c.settlementCurrency, settle, item, a.c), share));
        if (a.c.tenantId !== b.c.tenantId) e.changed += 1;
        if (b.raised) e.raisedB += 1;
        if (a.raised) e.raisedA += 1;
      }
      assert.equal(section.count, e.count, label);
      assert.equal(section.skipped, 0, label);
      assert.deepEqual(section.before, { sellMinor: Number(e.bs), settlementMinor: Number(e.bt), marginMinor: Number(e.bs - e.bt) }, label);
      assert.deepEqual(section.after, { sellMinor: Number(e.as), settlementMinor: Number(e.at), marginMinor: Number(e.as - e.at) }, label);
      assert.equal(section.winnerChanged, e.changed, label);
      assert.deepEqual([section.minMarginRaisedBefore, section.minMarginRaisedAfter], [e.raisedB, e.raisedA], label);
      if (section === actual.orders) assert.deepEqual([actual.orders.cancelledFree, actual.orders.cancelledWithFee], [e.free, e.fee], label);
    }
  }
});
