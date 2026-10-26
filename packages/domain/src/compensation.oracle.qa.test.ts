/**
 * M4-02 测试角色：赔付表的独立对照实现（oracle）。
 *
 * 不调用 money.ts / quote.ts 的任何换算函数，只用 BigInt 有理数按需求原文重算一遍，再和 `compensationAmounts` 的每一个字段逐个比对：
 * - 客人：对外价 × 比例（四舍五入，0.5 远离零）+ 车型降级差价（结算价之差 × 快照汇率 ×（1 + 缓冲）×（1 + 加价），只取整一次）；
 *   赔付额 = max(上面两项之和, 最低额)；司机未到全额退款 + 报销（上限对外价 × 1.5，超出的不给）；
 * - 每笔至少等值 ¥500：日元直接 500；其他币种 = 500 × 判定时 JPY 汇率，向上取整到最小单位；
 * - 供应商：按结算价 × 同一比例（责任在平台时 0；司机未到的违约金已按救援记过时比例部分 0）+ 结算价之差 + 报销（按快照汇率反向换成结算币种）；
 * - 主管复核：赔给客人的钱（司机未到不算退回的原价）≥ 对外价 × 阈值（含）。
 * 固定种子的伪随机输入，失败时打印输入，能直接复现。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COMPENSATION_SCENARIOS,
  type CompensationInput,
  type CompensationScenario,
  type CompensationTable,
  DEFAULT_COMPENSATION_TABLE,
  compensationAmounts,
  compensationNeedsReview,
  lateScenario,
  minimumCompensationMinor,
} from "./compensation.ts";
import type { CurrencyCode } from "./money.ts";

// ---- 独立的有理数工具（不依赖 money.ts） ----

const DIGITS: Readonly<Record<CurrencyCode, number>> = { JPY: 0, KRW: 0, CNY: 2, USD: 2, HKD: 2, TWD: 2, THB: 2 };
const pow10 = (n: number): bigint => 10n ** BigInt(n);

/** 十进制字符串 → 分数（不经过浮点）。 */
function decimal(rate: string): [bigint, bigint] {
  const [whole = "0", frac = ""] = rate.split(".");
  return [BigInt(whole + frac), pow10(frac.length)];
}

/** n / d 四舍五入，0.5 远离零（只用于非负数）。 */
function roundHalfUp(n: bigint, d: bigint): bigint {
  assert.ok(n >= 0n && d > 0n);
  return (2n * n + d) / (2n * d);
}

function ceilDiv(n: bigint, d: bigint): bigint {
  return (n + d - 1n) / d;
}

const num = (value: bigint): number => {
  const out = Number(value);
  assert.ok(Number.isSafeInteger(out));
  return out;
};

/** 需求原表（不读 DEFAULT_COMPENSATION_TABLE，自己写一遍）。 */
const SPEC_BP: Readonly<Record<CompensationScenario, number>> = {
  late_15_29: 1000,
  late_30_plus: 5000,
  driver_no_show: 10_000,
  vehicle_downgrade: 2000,
  no_signboard: 1000,
  not_delivered: 2500,
  service_complaint: 1000,
};

interface Expected {
  ratio: number;
  downgrade: number;
  compensation: number;
  toppedUp: boolean;
  cap: number;
  reimbursement: number;
  refund: number;
  manual: number;
  reviewBasis: number;
  needsReview: boolean;
  tenant: { ratio: number; downgrade: number; reimbursement: number; total: number };
}

function oracle(input: CompensationInput, table: CompensationTable): Expected {
  const bp = BigInt(table.customerBp[input.scenario]);
  const sell = BigInt(input.sellMinor);
  const ratio = roundHalfUp(sell * bp, 10_000n);

  // 车型降级的差价：结算价之差（结算币种最小单位）→ 主单位 × 汇率 →（1 + 缓冲）→（1 + 加价）→ 客人币种最小单位，最后取整一次
  let downgrade = 0n;
  const diff = BigInt(input.downgradeSettlementDifferenceMinor ?? 0);
  const same = input.currency === input.settlementCurrency;
  const [rn, rd] = same ? [1n, 1n] : decimal((input.fx as { rate: string }).rate);
  if (diff > 0n) {
    const buffer = same ? 0n : BigInt(input.fxBufferBp);
    const n = diff * rn * pow10(DIGITS[input.currency]) * (10_000n + buffer) * (10_000n + BigInt(input.markupBp));
    const d = rd * pow10(DIGITS[input.settlementCurrency]) * 10_000n * 10_000n;
    downgrade = roundHalfUp(n, d);
  }
  const byTable = ratio + downgrade;
  const minimum = BigInt(input.minimumMinor);
  const compensation = byTable > minimum ? byTable : minimum;
  const isNoShow = input.scenario === "driver_no_show";
  const cap = isNoShow ? roundHalfUp(sell * BigInt(table.reimbursementCapBp), 10_000n) : 0n;
  const claimed = BigInt(input.reimbursementClaimedMinor ?? 0);
  const reimbursement = claimed < cap ? claimed : cap;
  const refundable = input.refundableMinor > 0 ? BigInt(input.refundableMinor) : 0n;

  let refund: bigint;
  let manual: bigint;
  let reviewBasis: bigint;
  if (isNoShow) {
    refund = refundable;
    const beyond = compensation > sell ? compensation - sell : 0n;
    manual = beyond + reimbursement;
    reviewBasis = beyond + reimbursement;
  } else {
    refund = compensation < refundable ? compensation : refundable;
    manual = compensation - refund;
    reviewBasis = compensation;
  }
  const needsReview = reviewBasis > 0n && reviewBasis * 10_000n >= sell * BigInt(table.reviewAtOrAboveSellBp);

  let tenant = { ratio: 0, downgrade: 0, reimbursement: 0, total: 0 };
  if (input.liable === "tenant") {
    const tRatio = input.settlementShareAlreadyDeducted ? 0n : roundHalfUp(BigInt(input.settlementMinor) * bp, 10_000n);
    // 报销：客人币种 → 结算币种（快照汇率的反方向），取整一次
    const tReimb = reimbursement === 0n ? 0n : same ? reimbursement : roundHalfUp(reimbursement * rd * pow10(DIGITS[input.settlementCurrency]), rn * pow10(DIGITS[input.currency]));
    tenant = { ratio: num(tRatio), downgrade: num(diff), reimbursement: num(tReimb), total: num(tRatio + diff + tReimb) };
  }
  return {
    ratio: num(ratio),
    downgrade: num(downgrade),
    compensation: num(compensation),
    toppedUp: compensation > byTable,
    cap: num(cap),
    reimbursement: num(reimbursement),
    refund: num(refund),
    manual: num(manual),
    reviewBasis: num(reviewBasis),
    needsReview,
    tenant,
  };
}

function oracleMinimum(minimumJpy: number, currency: CurrencyCode, rate: string | null): number {
  if (minimumJpy === 0) return 0;
  if (currency === "JPY") return minimumJpy;
  const [n, d] = decimal(rate as string);
  return num(ceilDiv(BigInt(minimumJpy) * n * pow10(DIGITS[currency]), d));
}

// ---- 伪随机（固定种子，可复现） ----

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

const CURRENCIES: readonly CurrencyCode[] = ["JPY", "KRW", "CNY", "USD", "HKD", "TWD", "THB"];

function randomRate(r: () => number): string {
  const shapes = [() => `0.00${1 + Math.floor(r() * 9)}${Math.floor(r() * 10)}`, () => `0.0${Math.floor(r() * 1000).toString().padStart(3, "0")}1`, () => `${1 + Math.floor(r() * 200)}.${Math.floor(r() * 1000)}`, () => `${Math.floor(r() * 10)}.${Math.floor(r() * 10_000_000) + 1}`];
  const rate = (shapes[Math.floor(r() * shapes.length)] as () => string)();
  return decimal(rate)[0] === 0n ? "0.0067" : rate;
}

function randomInput(r: () => number): CompensationInput {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(r() * items.length)] as T;
  const scenario = pick(COMPENSATION_SCENARIOS);
  const currency = pick(CURRENCIES);
  const settlementCurrency = r() < 0.5 ? currency : pick(CURRENCIES);
  const fx = currency === settlementCurrency ? null : { from: settlementCurrency, to: currency, rate: randomRate(r), asOf: "2026-10-26T00:00:00Z" };
  const sellMinor = 1 + Math.floor(r() * 3_000_000);
  return {
    scenario,
    liable: r() < 0.75 ? "tenant" : "platform",
    currency,
    sellMinor,
    settlementMinor: 1 + Math.floor(r() * 3_000_000),
    settlementCurrency,
    markupBp: Math.floor(r() * 5000),
    fxBufferBp: Math.floor(r() * 1001),
    fx,
    minimumMinor: Math.floor(r() * 200_000),
    downgradeSettlementDifferenceMinor: scenario === "vehicle_downgrade" ? 1 + Math.floor(r() * 500_000) : null,
    reimbursementClaimedMinor: scenario === "driver_no_show" && r() < 0.8 ? Math.floor(r() * 6_000_000) : null,
    refundableMinor: Math.floor(r() * (sellMinor + 2)) - (r() < 0.05 ? 50 : 0),
    settlementShareAlreadyDeducted: r() < 0.3,
  };
}

function randomTable(r: () => number): CompensationTable {
  if (r() < 0.4) return DEFAULT_COMPENSATION_TABLE;
  const customerBp = Object.fromEntries(COMPENSATION_SCENARIOS.map((s) => [s, s === "driver_no_show" ? 10_000 : Math.floor(r() * 10_001)])) as Record<CompensationScenario, number>;
  return { version: 1 + Math.floor(r() * 20), customerBp, minimumJpy: Math.floor(r() * 100_001), reimbursementCapBp: Math.floor(r() * 50_001), reviewAtOrAboveSellBp: Math.floor(r() * 10_001) };
}

function assertMatchesOracle(input: CompensationInput, table: CompensationTable): void {
  const outcome = compensationAmounts(input, table);
  const where = JSON.stringify({ input, table });
  assert.ok(outcome.ok, `${where} → ${JSON.stringify(outcome)}`);
  const got = outcome.amounts;
  const want = oracle(input, table);
  assert.deepEqual(
    {
      ratio: got.customer.ratioMinor,
      downgrade: got.customer.downgradeDifferenceMinor,
      compensation: got.customer.compensationMinor,
      toppedUp: got.customer.toppedUp,
      cap: got.customer.reimbursementCapMinor,
      reimbursement: got.customer.reimbursementMinor,
      refund: got.customer.refundMinor,
      manual: got.customer.manualPayoutMinor,
      reviewBasis: got.customer.reviewBasisMinor,
      needsReview: got.needsReview,
      tenant: { ratio: got.tenant.ratioMinor, downgrade: got.tenant.downgradeDifferenceMinor, reimbursement: got.tenant.reimbursementMinor, total: got.tenant.totalMinor },
    },
    want,
    where,
  );
  assert.equal(got.tableVersion, table.version, where);
  assert.equal(got.customerBp, table.customerBp[input.scenario], where);
  assert.equal(got.customer.currency, input.currency, where);
  assert.equal(got.tenant.currency, input.settlementCurrency, where);
  assert.equal(got.customer.minimumMinor, input.minimumMinor, where);
  assert.equal(got.customer.reimbursementClaimedMinor, input.reimbursementClaimedMinor ?? 0, where);
  // 金额一律是最小单位的整数（规则 3）
  for (const value of [...Object.values(got.customer), ...Object.values(got.tenant)]) if (typeof value === "number") assert.ok(Number.isSafeInteger(value) && value >= 0, `${where}：${value}`);
}

// ---- 用例 ----

test("对照实现：5,000 组伪随机输入（7 种情形 × 7 种币种 × 同币种 / 跨币种 × 责任方 × 已记违约金 × 随机赔付表），每个字段和独立重算的一致", () => {
  const r = rng(20261026);
  for (let i = 0; i < 5000; i++) assertMatchesOracle(randomInput(r), randomTable(r));
});

test("对照实现：默认赔付表就是需求原表（逐行比，不读实现里的常量）", () => {
  assert.deepEqual({ ...DEFAULT_COMPENSATION_TABLE.customerBp }, SPEC_BP);
  assert.equal(DEFAULT_COMPENSATION_TABLE.minimumJpy, 500);
  assert.equal(DEFAULT_COMPENSATION_TABLE.reimbursementCapBp, 15_000, "报销上限 1.5 倍");
  assert.equal(DEFAULT_COMPENSATION_TABLE.reviewAtOrAboveSellBp, 5000, "复核阈值：对外价 50%");
});

const JPY_ORDER: CompensationInput = {
  scenario: "late_15_29",
  liable: "tenant",
  currency: "JPY",
  sellMinor: 22_000,
  settlementMinor: 19_800,
  settlementCurrency: "JPY",
  markupBp: 1111,
  fxBufferBp: 0,
  fx: null,
  minimumMinor: 500,
  downgradeSettlementDifferenceMinor: null,
  reimbursementClaimedMinor: null,
  refundableMinor: 22_000,
  settlementShareAlreadyDeducted: false,
};

test("迟到的分钟边界：14 分 59 秒不赔；15 分整、29 分、29 分 59 秒赔 10%；30 分整起赔 50% 并计重大迟到", () => {
  const cases: [number, CompensationScenario | null][] = [
    [0, null],
    [14, null],
    [14 + 59 / 60, null],
    [15, "late_15_29"],
    [16, "late_15_29"],
    [29, "late_15_29"],
    [29 + 59 / 60, "late_15_29"],
    [30, "late_30_plus"],
    [31, "late_30_plus"],
    [24 * 60, "late_30_plus"],
    [-5, null],
    [Number.POSITIVE_INFINITY, null],
  ];
  for (const [minutes, scenario] of cases) assert.equal(lateScenario(minutes), scenario, `${minutes} 分钟`);
  const at = (minutes: number) => {
    const scenario = lateScenario(minutes);
    assert.ok(scenario);
    const outcome = compensationAmounts({ ...JPY_ORDER, scenario });
    assert.ok(outcome.ok);
    return outcome.amounts;
  };
  assert.deepEqual([at(15).customer.compensationMinor, at(29).customer.compensationMinor, at(30).customer.compensationMinor], [2200, 2200, 11_000]);
  assert.deepEqual([at(29).tenant.totalMinor, at(30).tenant.totalMinor], [1980, 9900]);
});

test("四舍五入 0.5 远离零：对外价、结算价 × 比例落在 .5 时进位，落在 .4999… 时舍去（客人和供应商各自取整一次）", () => {
  // 10,005 × 10% = 1,000.5 → 1,001；10,004 × 10% = 1,000.4 → 1,000；25% × 10,002 = 2,500.5 → 2,501
  const one = (overrides: Partial<CompensationInput>) => {
    const outcome = compensationAmounts({ ...JPY_ORDER, ...overrides });
    assert.ok(outcome.ok);
    return outcome.amounts;
  };
  assert.equal(one({ sellMinor: 10_005, refundableMinor: 10_005 }).customer.compensationMinor, 1001);
  assert.equal(one({ sellMinor: 10_004, refundableMinor: 10_004 }).customer.compensationMinor, 1000);
  assert.equal(one({ scenario: "not_delivered", sellMinor: 10_002, refundableMinor: 10_002 }).customer.compensationMinor, 2501);
  assert.equal(one({ settlementMinor: 9_005 }).tenant.ratioMinor, 901);
  assert.equal(one({ settlementMinor: 9_004 }).tenant.ratioMinor, 900);
  // 美分：$123.45 × 10% = $12.345 → 1,235 美分（不是 1,234）
  assert.equal(one({ currency: "USD", settlementCurrency: "USD", sellMinor: 12_345, settlementMinor: 11_111, refundableMinor: 12_345, minimumMinor: 334 }).customer.compensationMinor, 1235);
});

test("每笔至少等值 ¥500：日元直接 500；跨币种按判定时汇率向上取整（差一点点也进一）；正好整除不多进", () => {
  const cases: [CurrencyCode, string, number][] = [
    ["USD", "0.0067", 335], // 3.35 美元整
    ["USD", "0.00670001", 336], // 3.350005 → 向上 336
    ["USD", "0.006666666667", 334],
    ["CNY", "0.0479", 2395],
    ["KRW", "9.6", 4800],
    ["KRW", "9.6001", 4801], // 4,800.05 韩元 → 4,801
    ["THB", "0.2333", 11_665],
    ["TWD", "0.21", 10_500],
  ];
  for (const [currency, rate, expected] of cases) {
    assert.equal(oracleMinimum(500, currency, rate), expected, `对照实现自查 ${currency} ${rate}`);
    assert.equal(minimumCompensationMinor(DEFAULT_COMPENSATION_TABLE, currency, { from: "JPY", to: currency, rate }), expected, `${currency} ${rate}`);
  }
  assert.equal(minimumCompensationMinor(DEFAULT_COMPENSATION_TABLE, "JPY", null), 500);
  // 随机：和对照实现一致，而且换回日元后不少于 500
  const r = rng(7);
  for (let i = 0; i < 2000; i++) {
    const currency = CURRENCIES[1 + Math.floor(r() * (CURRENCIES.length - 1))] as CurrencyCode;
    const rate = randomRate(r);
    const minimumJpy = Math.floor(r() * 100_001);
    const got = minimumCompensationMinor({ minimumJpy }, currency, { from: "JPY", to: currency, rate });
    assert.equal(got, oracleMinimum(minimumJpy, currency, rate), `${minimumJpy} JPY → ${currency} @ ${rate}`);
    const [n, d] = decimal(rate);
    // got（最小单位）÷ 10^digits ÷ 汇率 ≥ minimumJpy；少 1 个最小单位就不够
    if (minimumJpy > 0) {
      assert.ok(BigInt(got as number) * d >= BigInt(minimumJpy) * n * pow10(DIGITS[currency]));
      assert.ok(BigInt((got as number) - 1) * d < BigInt(minimumJpy) * n * pow10(DIGITS[currency]));
    }
  }
  // 汇率方向不对、币种不对、汇率不是正数：算不出（判定时报 FX_RATE_UNAVAILABLE）
  assert.equal(minimumCompensationMinor(DEFAULT_COMPENSATION_TABLE, "USD", { from: "JPY", to: "CNY", rate: "0.0479" }), null);
  assert.equal(minimumCompensationMinor(DEFAULT_COMPENSATION_TABLE, "USD", { from: "JPY", to: "USD", rate: "0" }), null);
  assert.equal(minimumCompensationMinor(DEFAULT_COMPENSATION_TABLE, "USD", { from: "JPY", to: "USD", rate: "-0.0067" }), null);
});

test("补足最低额的部分由平台承担：客人拿到最低额，供应商仍只按结算价 × 比例；按比例正好等于最低额不算补足", () => {
  const cheap = compensationAmounts({ ...JPY_ORDER, sellMinor: 4999, settlementMinor: 4500, refundableMinor: 4999 });
  assert.ok(cheap.ok);
  assert.deepEqual([cheap.amounts.customer.ratioMinor, cheap.amounts.customer.compensationMinor, cheap.amounts.customer.toppedUp, cheap.amounts.tenant.totalMinor], [500, 500, false, 450]);
  const cheaper = compensationAmounts({ ...JPY_ORDER, sellMinor: 4994, settlementMinor: 4500, refundableMinor: 4994 });
  assert.ok(cheaper.ok);
  assert.deepEqual([cheaper.amounts.customer.ratioMinor, cheaper.amounts.customer.compensationMinor, cheaper.amounts.customer.toppedUp, cheaper.amounts.tenant.totalMinor], [499, 500, true, 450]);
});

test("车型降级：差价 + 订单 20%；同币种不加缓冲；跨币种按快照汇率 × (1 + 缓冲) × (1 + 加价) 只取整一次", () => {
  const same = compensationAmounts({ ...JPY_ORDER, scenario: "vehicle_downgrade", downgradeSettlementDifferenceMinor: 3000, fxBufferBp: 150 });
  assert.ok(same.ok);
  // 同币种：缓冲不适用（3,000 × 1.1111 = 3,333.3 → 3,333）
  assert.equal(same.amounts.customer.downgradeDifferenceMinor, 3333);
  assert.equal(same.amounts.customer.compensationMinor, 3333 + 4400);
  assert.deepEqual([same.amounts.tenant.ratioMinor, same.amounts.tenant.downgradeDifferenceMinor, same.amounts.tenant.totalMinor], [3960, 3000, 6960]);
  // 跨币种：2,000 日元 × 0.0067 × 1.015 × 1.1 = 14.96111 美元 → 1,496 美分（分步取整会得到 1,497）
  const cross = compensationAmounts({ ...JPY_ORDER, scenario: "vehicle_downgrade", currency: "USD", sellMinor: 14_800, refundableMinor: 14_800, minimumMinor: 335, markupBp: 1000, fxBufferBp: 150, fx: { from: "JPY", to: "USD", rate: "0.0067", asOf: "2026-10-26T00:00:00Z" }, downgradeSettlementDifferenceMinor: 2000 });
  assert.ok(cross.ok);
  assert.equal(cross.amounts.customer.downgradeDifferenceMinor, 1496);
  assert.equal(cross.amounts.customer.compensationMinor, 1496 + 2960);
});

test("司机未到：全额退款（不是按比例），报销上限对外价 × 1.5（正好等于上限全给，多 1 不给）；最低额对全额退款同样适用", () => {
  const run = (overrides: Partial<CompensationInput>) => {
    const outcome = compensationAmounts({ ...JPY_ORDER, scenario: "driver_no_show", ...overrides });
    assert.ok(outcome.ok);
    return outcome.amounts;
  };
  assert.deepEqual([run({ reimbursementClaimedMinor: 33_000 }).customer.reimbursementMinor, run({ reimbursementClaimedMinor: 33_001 }).customer.reimbursementMinor, run({ reimbursementClaimedMinor: 32_999 }).customer.reimbursementMinor], [33_000, 33_000, 32_999]);
  // 对外价 21,999：上限 = 32,998.5 → 32,999
  assert.equal(run({ sellMinor: 21_999, refundableMinor: 21_999, reimbursementClaimedMinor: 40_000 }).customer.reimbursementCapMinor, 32_999);
  // 对外价低于最低额（300 日元）：全额退 300，另付补足的 200
  const tiny = run({ sellMinor: 300, settlementMinor: 270, refundableMinor: 300 });
  assert.deepEqual([tiny.customer.compensationMinor, tiny.customer.refundMinor, tiny.customer.manualPayoutMinor, tiny.customer.toppedUp, tiny.customer.reviewBasisMinor], [500, 300, 200, true, 200]);
  // 租户：结算价 100% + 报销；责任在平台：0
  assert.equal(run({ reimbursementClaimedMinor: 1000 }).tenant.totalMinor, 19_800 + 1000);
  assert.equal(run({ reimbursementClaimedMinor: 1000, liable: "platform" }).tenant.totalMinor, 0);
});

test("主管复核阈值（对外价 50%）：赔给客人的钱正好等于对外价一半要复核，差 1 个最小单位不用；对外价是奇数时按精确值比较", () => {
  for (const sell of [22_000, 22_001, 1, 2, 3, 999_999, 1_000_000]) {
    // 恰好达到：2 × basis ≥ sell 的最小 basis
    const atThreshold = Math.ceil(sell / 2);
    assert.equal(compensationNeedsReview(atThreshold, sell, DEFAULT_COMPENSATION_TABLE), true, `${sell} / ${atThreshold}`);
    assert.equal(compensationNeedsReview(atThreshold - 1, sell, DEFAULT_COMPENSATION_TABLE), false, `${sell} / ${atThreshold - 1}`);
  }
  // 经司机未到的报销走一遍：对外价 22,000，报销 11,000 复核，10,999 不复核（退回的原价不算）
  const noShow = (claimed: number) => compensationAmounts({ ...JPY_ORDER, scenario: "driver_no_show", reimbursementClaimedMinor: claimed });
  const at = noShow(11_000);
  const below = noShow(10_999);
  assert.ok(at.ok && below.ok);
  assert.deepEqual([at.amounts.needsReview, below.amounts.needsReview], [true, false]);
  // 普通情形：迟到 30 分钟以上（50%）在奇数对外价时四舍五入后仍然达到
  const odd = compensationAmounts({ ...JPY_ORDER, scenario: "late_30_plus", sellMinor: 22_001, refundableMinor: 22_001 });
  assert.ok(odd.ok);
  assert.deepEqual([odd.amounts.customer.compensationMinor, odd.amounts.needsReview], [11_001, true]);
  // 阈值改成 25.01%：没送到（25%）不复核；改成 25%：复核
  const table = (bp: number): CompensationTable => ({ ...DEFAULT_COMPENSATION_TABLE, version: 2, reviewAtOrAboveSellBp: bp });
  const notDelivered = (bp: number) => {
    const outcome = compensationAmounts({ ...JPY_ORDER, scenario: "not_delivered" }, table(bp));
    assert.ok(outcome.ok);
    return outcome.amounts.needsReview;
  };
  assert.deepEqual([notDelivered(2500), notDelivered(2501)], [true, false]);
});

test("责任在平台：客人按表照赔，供应商各项都是 0（包括车型降级的结算价之差和报销）", () => {
  for (const scenario of COMPENSATION_SCENARIOS) {
    const outcome = compensationAmounts({
      ...JPY_ORDER,
      scenario,
      liable: "platform",
      downgradeSettlementDifferenceMinor: scenario === "vehicle_downgrade" ? 3000 : null,
      reimbursementClaimedMinor: scenario === "driver_no_show" ? 5000 : null,
    });
    assert.ok(outcome.ok, scenario);
    assert.deepEqual(outcome.amounts.tenant, { currency: "JPY", ratioMinor: 0, downgradeDifferenceMinor: 0, reimbursementMinor: 0, totalMinor: 0 }, scenario);
    assert.ok(outcome.amounts.customer.compensationMinor >= 500, scenario);
  }
});

test("退款 + 另付 = 赔付额（非司机未到）；司机未到时 另付 = 补足部分 + 报销：钱不多不少", () => {
  const r = rng(99);
  for (let i = 0; i < 2000; i++) {
    const input = randomInput(r);
    const outcome = compensationAmounts(input);
    assert.ok(outcome.ok);
    const c = outcome.amounts.customer;
    if (input.scenario === "driver_no_show") {
      assert.equal(c.manualPayoutMinor, Math.max(0, c.compensationMinor - input.sellMinor) + c.reimbursementMinor, JSON.stringify(input));
    } else {
      assert.equal(c.refundMinor + c.manualPayoutMinor, c.compensationMinor, JSON.stringify(input));
      assert.ok(c.refundMinor <= Math.max(0, input.refundableMinor), "退款不超过还能退的");
    }
  }
});
