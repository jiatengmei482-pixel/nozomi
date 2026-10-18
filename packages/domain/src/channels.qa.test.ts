/**
 * M2-04 测试角色补充：加价规则匹配、按渠道算对外价、比价排序，和独立写的对照实现在随机输入上逐个比对；
 * 另补每一级「更具体的和更通用的并存」、促销不压过上级、价格带 δ 和观察期 ×1.05 恰好在边界上的用例。
 * 对照实现只用 BigInt 分数，写法和被测代码不同（不复用被测模块的任何计算函数）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { type MarkupQuery, type MarkupRule, markupRuleIssues, resolveMarkup } from "./channels.ts";
import { type CurrencyCode, minorDigits } from "./money.ts";
import { type FxQuote, type RankCandidate, type SellPrice, rankCandidates, sellPrice } from "./quote.ts";

/** 可重复的伪随机数（mulberry32），失败时按种子复现。 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}
const pick = <T>(random: () => number, items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
const int = (random: () => number, min: number, max: number): number => min + Math.floor(random() * (max - min + 1));

// ---- 加价规则匹配 ----

const TENANTS = ["t1", "t2"];
const CITIES = ["c1", "c2"];
const CATEGORIES = ["airport_transfer", "charter"] as const;
const GROUPS = ["g1", "g2"];
const DAYS = ["2026-10-18", "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22"];

/** 对照：每条规则的级别按「填了哪几个维度」查表；匹配 = 填了的维度都相等、日期在范围里；按（级别、带日期优先、编号）取第一条。 */
function referenceMarkup(defaultMarkupBp: number, rules: readonly MarkupRule[], q: MarkupQuery): { markupBp: number; level: number; ruleId: string | null } {
  const LEVEL_BY_SHAPE: Record<string, number> = { "1111": 1, "1000": 2, "0111": 3, "0110": 4, "0000": 5 };
  const scored = rules.flatMap((rule) => {
    const shape = [rule.tenantId, rule.cityId, rule.category, rule.vehicleGroupId].map((v) => (v === null ? "0" : "1")).join("");
    const level = LEVEL_BY_SHAPE[shape];
    if (level === undefined) return [];
    const fits = (rule.tenantId ?? q.tenantId) === q.tenantId && (rule.cityId ?? q.cityId) === q.cityId && (rule.category ?? q.category) === q.category && (rule.vehicleGroupId ?? q.vehicleGroupId) === q.vehicleGroupId;
    const inRange = (rule.validFrom === null || q.serviceDate >= rule.validFrom) && (rule.validTo === null || q.serviceDate <= rule.validTo);
    if (!fits || !inRange) return [];
    const dated = rule.validFrom !== null || rule.validTo !== null ? 0 : 1;
    return [{ key: `${level}|${dated}|${rule.id}`, level, rule }];
  });
  scored.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const first = scored[0];
  return first === undefined ? { markupBp: defaultMarkupBp, level: 5, ruleId: null } : { markupBp: first.rule.markupBp, level: first.level, ruleId: first.rule.id };
}

function randomRule(random: () => number, id: number): MarkupRule {
  const level = int(random, 1, 5);
  const has = { t: level <= 2, c: level === 1 || level === 3 || level === 4, k: level === 1 || level === 3 || level === 4, v: level === 1 || level === 3 };
  const datedRoll = level === 5 ? 1 : random();
  let validFrom: string | null = null;
  let validTo: string | null = null;
  if (datedRoll > 0.5) {
    const a = int(random, 0, DAYS.length - 1);
    const b = int(random, a, DAYS.length - 1);
    validFrom = random() < 0.2 ? null : (DAYS[a] as string);
    validTo = random() < 0.2 && validFrom !== null ? null : (DAYS[b] as string);
  }
  return {
    id: `r${String(id).padStart(3, "0")}`,
    tenantId: has.t ? pick(random, TENANTS) : null,
    cityId: has.c ? pick(random, CITIES) : null,
    category: has.k ? pick(random, CATEGORIES) : null,
    vehicleGroupId: has.v ? pick(random, GROUPS) : null,
    markupBp: int(random, 1_000, 3_000),
    validFrom,
    validTo,
  };
}

test("五级匹配：随机规则表 × 随机询价，和对照实现逐个一致（500 组 × 20 次询价）", () => {
  for (let seed = 1; seed <= 500; seed += 1) {
    const random = rng(seed);
    const rules = Array.from({ length: int(random, 0, 12) }, (_, i) => randomRule(random, i));
    const defaultMarkupBp = int(random, 1_000, 2_000);
    for (let i = 0; i < 20; i += 1) {
      const query: MarkupQuery = { tenantId: pick(random, TENANTS), cityId: pick(random, CITIES), category: pick(random, CATEGORIES), vehicleGroupId: pick(random, GROUPS), serviceDate: pick(random, DAYS) };
      assert.deepEqual(resolveMarkup({ defaultMarkupBp, rules }, query), referenceMarkup(defaultMarkupBp, rules, query), `种子 ${seed} 第 ${i} 次：${JSON.stringify({ rules, query })}`);
    }
  }
});

const Q: MarkupQuery = { tenantId: "t1", cityId: "c1", category: "airport_transfer", vehicleGroupId: "g1", serviceDate: "2026-10-20" };
const rule = (id: string, dims: Partial<MarkupRule>, markupBp: number, dates: [string | null, string | null] = [null, null]): MarkupRule => ({ id, tenantId: null, cityId: null, category: null, vehicleGroupId: null, ...dims, markupBp, validFrom: dates[0], validTo: dates[1] });

test("每一级都有更具体和更通用的规则并存时，按级别命中第一条；促销（带日期）只在同一级里优先，不压过上一级", () => {
  const L1 = rule("a1", { tenantId: "t1", cityId: "c1", category: "airport_transfer", vehicleGroupId: "g1" }, 1_100);
  const L2 = rule("a2", { tenantId: "t1" }, 1_200);
  const L3 = rule("a3", { cityId: "c1", category: "airport_transfer", vehicleGroupId: "g1" }, 1_300);
  const L4 = rule("a4", { cityId: "c1", category: "airport_transfer" }, 1_400);
  const L5promo = rule("a5", {}, 1_050, ["2026-10-20", "2026-10-20"]);
  const all = [L5promo, L4, L3, L2, L1];
  const at = (rules: MarkupRule[], query: Partial<MarkupQuery> = {}) => resolveMarkup({ defaultMarkupBp: 1_500, rules }, { ...Q, ...query });
  assert.deepEqual(at(all), { markupBp: 1_100, level: 1, ruleId: "a1" });
  assert.deepEqual(at(all, { vehicleGroupId: "g2" }), { markupBp: 1_200, level: 2, ruleId: "a2" }, "第 1 级车型组对不上 → 第 2 级（哪怕第 3、4 级维度更多）");
  assert.deepEqual(at(all, { tenantId: "t2" }), { markupBp: 1_300, level: 3, ruleId: "a3" });
  assert.deepEqual(at(all, { tenantId: "t2", vehicleGroupId: "g2" }), { markupBp: 1_400, level: 4, ruleId: "a4" });
  assert.deepEqual(at(all, { tenantId: "t2", cityId: "c2" }), { markupBp: 1_050, level: 5, ruleId: "a5" }, "只剩全渠道促销");
  assert.deepEqual(at(all, { tenantId: "t2", cityId: "c2", serviceDate: "2026-10-21" }), { markupBp: 1_500, level: 5, ruleId: null }, "促销期外用渠道默认");
  // 同一级：促销期内的带日期规则优先；促销期外回到不带日期的
  const L4promo = rule("b4", { cityId: "c1", category: "airport_transfer" }, 1_010, ["2026-10-19", "2026-10-20"]);
  assert.deepEqual(at([L4, L4promo], { tenantId: "t2" }), { markupBp: 1_010, level: 4, ruleId: "b4" });
  assert.deepEqual(at([L4, L4promo], { tenantId: "t2", serviceDate: "2026-10-21" }), { markupBp: 1_400, level: 4, ruleId: "a4" });
  // 下一级的促销不压过上一级的不带日期规则
  assert.deepEqual(at([L3, L4promo], { tenantId: "t2" }), { markupBp: 1_300, level: 3, ruleId: "a3" });
  // 上一级的促销在期外：不当作命中，接着往下一级找
  const L1promo = rule("b1", { tenantId: "t1", cityId: "c1", category: "airport_transfer", vehicleGroupId: "g1" }, 1_020, ["2026-11-01", null]);
  assert.deepEqual(at([L1promo, L2]), { markupBp: 1_200, level: 2, ruleId: "a2" });
  assert.deepEqual(at([L1promo, L2], { serviceDate: "2026-11-01" }), { markupBp: 1_020, level: 1, ruleId: "b1" }, "开始那天就生效");
});

test("规则比例的下限：渠道下限写得比平台低也按 10% 拦；正好等于渠道下限通过；基点必须是整数", () => {
  const base = { tenantId: "t1", cityId: null, category: null, vehicleGroupId: null, validFrom: null, validTo: null } as const;
  assert.deepEqual(markupRuleIssues({ ...base, markupBp: 999 }, 800).map((i) => i.reason), ["BELOW_FLOOR"]);
  assert.deepEqual(markupRuleIssues({ ...base, markupBp: 1_000 }, 800), []);
  assert.deepEqual(markupRuleIssues({ ...base, markupBp: 1_349 }, 1_350).map((i) => i.reason), ["BELOW_FLOOR"]);
  assert.deepEqual(markupRuleIssues({ ...base, markupBp: 1_350 }, 1_350), []);
  assert.deepEqual(markupRuleIssues({ ...base, markupBp: 1_350.5 }, 1_000).map((i) => i.reason), ["OUT_OF_RANGE"]);
});

// ---- 按渠道算对外价 ----

type Frac = [bigint, bigint];
const frac = (n: bigint, d: bigint = 1n): Frac => [n, d];
const mul = (a: Frac, b: Frac): Frac => [a[0] * b[0], a[1] * b[1]];
const add = (a: Frac, b: Frac): Frac => [a[0] * b[1] + b[0] * a[1], a[1] * b[1]];
const sub = (a: Frac, b: Frac): Frac => [a[0] * b[1] - b[0] * a[1], a[1] * b[1]];
const less = (a: Frac, b: Frac): boolean => a[0] * b[1] < b[0] * a[1];
const decimal = (text: string): Frac => {
  const [whole, part = ""] = text.split(".");
  return [BigInt(`${whole}${part}`), 10n ** BigInt(part.length)];
};
const pow10 = (n: number): bigint => 10n ** BigInt(n);
/** 正分数四舍五入到整数：floor(x + 1/2) */
const roundHalfUp = (x: Frac): bigint => (2n * x[0] + x[1]) / (2n * x[1]);
const ceilTo = (x: Frac, unit: bigint): bigint => ((x[0] + x[1] * unit - 1n) / (x[1] * unit)) * unit;
/** 一个币种的最小单位金额换到另一个币种的最小单位（精确分数） */
const convert = (minor: Frac, from: CurrencyCode, to: CurrencyCode, rate: string): Frac => mul(mul(minor, decimal(rate)), frac(pow10(minorDigits(to)), pow10(minorDigits(from))));

interface SellCase {
  settlementMinor: number;
  settlementCurrency: CurrencyCode;
  currency: CurrencyCode;
  markupBp: number;
  floorBp: number;
  roundingUnit: number;
  minMargin: { minor: number; currency: CurrencyCode } | null;
  rates: Partial<Record<string, string>>;
}

function referenceSell(c: SellCase): { sellMinor: number; markupBp: number; minMarginApplied: boolean } | "FX_RATE_UNAVAILABLE" {
  const markupBp = Math.max(c.markupBp, c.floorBp);
  let base: Frac = frac(BigInt(c.settlementMinor));
  if (c.settlementCurrency !== c.currency) {
    const rate = c.rates[`${c.settlementCurrency}>${c.currency}`];
    if (rate === undefined) return "FX_RATE_UNAVAILABLE";
    base = mul(convert(base, c.settlementCurrency, c.currency, rate), frac(10_150n, 10_000n));
  }
  let sell = mul(base, frac(BigInt(10_000 + markupBp), 10_000n));
  let applied = false;
  if (c.minMargin !== null && c.minMargin.minor > 0) {
    let margin: Frac = frac(BigInt(c.minMargin.minor));
    if (c.minMargin.currency !== c.currency) {
      const rate = c.rates[`${c.minMargin.currency}>${c.currency}`];
      if (rate === undefined) return "FX_RATE_UNAVAILABLE";
      margin = convert(margin, c.minMargin.currency, c.currency, rate);
    }
    if (less(sub(sell, base), margin)) {
      sell = add(base, margin);
      applied = true;
    }
  }
  const sellMinor = c.roundingUnit > 1 ? ceilTo(sell, BigInt(c.roundingUnit)) : roundHalfUp(sell);
  return { sellMinor: Number(sellMinor), markupBp, minMarginApplied: applied };
}

const NOW = "2026-10-18T00:00:00.000Z";
const RATE_TEXTS = ["0.0067", "0.048", "149.83", "7.1234", "0.000712", "1", "0.5"];
const CURRENCY_POOL: CurrencyCode[] = ["JPY", "USD", "CNY", "KRW"];

test("对外价（渠道的下限、最低毛利、向上取整、跨币种缓冲）：和对照实现在 5,000 组随机输入上逐个一致", () => {
  const random = rng(20261018);
  for (let i = 0; i < 5_000; i += 1) {
    const settlementCurrency = pick(random, CURRENCY_POOL);
    const currency = random() < 0.4 ? settlementCurrency : pick(random, CURRENCY_POOL);
    const rates: Record<string, string> = {};
    for (const from of CURRENCY_POOL) for (const to of CURRENCY_POOL) if (from !== to && random() < 0.85) rates[`${from}>${to}`] = pick(random, RATE_TEXTS);
    const marginCurrency = pick(random, CURRENCY_POOL);
    const c: SellCase = {
      settlementMinor: int(random, 1, random() < 0.5 ? 50_000 : 5_000_000),
      settlementCurrency,
      currency,
      markupBp: int(random, 0, 5_000),
      floorBp: int(random, 1_000, 2_000),
      roundingUnit: pick(random, [1, 1, 10, 100, 1_000, 7]),
      minMargin: random() < 0.3 ? null : { minor: random() < 0.1 ? 0 : int(random, 1, 100_000), currency: marginCurrency },
      rates,
    };
    const fxFor = (from: CurrencyCode, to: CurrencyCode): FxQuote | null => (rates[`${from}>${to}`] === undefined ? null : { from, to, rate: rates[`${from}>${to}`] as string, asOf: NOW });
    const actual = sellPrice({
      settlementMinor: c.settlementMinor,
      settlementCurrency,
      currency,
      markupBp: c.markupBp,
      markupFloorBp: c.floorBp,
      fx: settlementCurrency === currency ? null : fxFor(settlementCurrency, currency),
      channel: { roundingUnit: c.roundingUnit, minMargin: c.minMargin === null ? null : { ...c.minMargin, fx: c.minMargin.currency === currency ? null : fxFor(c.minMargin.currency, currency) } },
    });
    const expected = referenceSell(c);
    const label = `第 ${i} 组：${JSON.stringify(c)}`;
    if (expected === "FX_RATE_UNAVAILABLE") {
      assert.deepEqual(actual, { failure: "FX_RATE_UNAVAILABLE" }, label);
      continue;
    }
    assert.ok(!("failure" in actual), `${label} → ${JSON.stringify(actual)}`);
    const sold = actual as SellPrice;
    assert.deepEqual([sold.sellMinor, sold.markupBp, sold.channel?.minMarginApplied], [expected.sellMinor, expected.markupBp, expected.minMarginApplied], label);
    // 不变量：实际加价不低于下限；向上取整只会更高；结果是取整单位的整数倍
    if (c.roundingUnit > 1) assert.equal(sold.sellMinor % c.roundingUnit, 0, label);
  }
});

test("向上取整之后的实际加价比例永远不低于下限（同币种，随机 2,000 组）", () => {
  const random = rng(7);
  for (let i = 0; i < 2_000; i += 1) {
    const settlementMinor = int(random, 1, 3_000_000);
    const floorBp = int(random, 1_000, 2_500);
    const roundingUnit = pick(random, [10, 100, 1_000]);
    const sold = sellPrice({ settlementMinor, settlementCurrency: "JPY", currency: "JPY", markupBp: int(random, 0, floorBp), markupFloorBp: floorBp, fx: null, channel: { roundingUnit, minMargin: null } }) as SellPrice;
    // sell / settlement - 1 ≥ floor  ⇔  sell × 10000 ≥ settlement × (10000 + floor)
    assert.ok(BigInt(sold.sellMinor) * 10_000n >= BigInt(settlementMinor) * BigInt(10_000 + floorBp), JSON.stringify({ settlementMinor, floorBp, roundingUnit, sold }));
  }
});

// ---- 比价：价格带 δ 与观察期 ----

const cand = (tenantId: string, sellMinor: number, observation: boolean, scoreCenti = 450, completedOrders = 0): RankCandidate => ({ tenantId, sellMinor, observation, scoreCenti, completedOrders, tieBreak: tenantId });

test("价格带 δ 与观察期 ×1.05 恰好在边界上：排序价正好等于基准 × (1 + δ) 算在区间里，多 1 个最小单位就不在", () => {
  // 甲 10,000（不在观察期，基准 10,000）；乙在观察期、评分高：10,000 × 1.05 = 10,500
  const winnerAt = (bandBp: number, bSell: number) => rankCandidates([cand("A", 10_000, false), cand("B", bSell, true, 490, 50)], bandBp)[0]?.candidate.tenantId;
  assert.equal(winnerAt(500, 10_000), "B", "10,500 = 10,000 × 1.05：在区间里，按评分乙中标");
  assert.equal(winnerAt(499, 10_000), "A", "δ 4.99%：区间上限 10,499，乙在外");
  assert.equal(winnerAt(500, 10_001), "A", "乙 10,001 × 1.05 = 10,501.05 > 10,500");
  assert.equal(winnerAt(0, 9_524), "A", "δ 0：乙 9,524 × 1.05 = 10,000.2 > 甲 10,000，乙不在区间");
  assert.equal(winnerAt(0, 9_523), "B", "δ 0：乙 9,523 × 1.05 = 9,999.15 < 10,000，乙是基准");
  // δ = 0 时区间里只有排序价最低的；观察期的排序价更低时仍然是它
  const zero = rankCandidates([cand("A", 10_000, false), cand("B", 9_000, true, 490, 50)], 0);
  assert.deepEqual(zero.map((r) => [r.candidate.tenantId, r.rankPrice, r.inBand]), [["B", "9450", true], ["A", "10000", false]]);
  // 价格带超出 0–5% 直接报错，不静默截断
  assert.throws(() => rankCandidates([cand("A", 1, false)], 501), RangeError);
  assert.throws(() => rankCandidates([cand("A", 1, false)], -1), RangeError);
});
