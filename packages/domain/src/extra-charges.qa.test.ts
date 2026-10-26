/**
 * M3-03 测试角色补充：事后加收的金额和时间。
 * - 客人付的 = 金额 × 汇率 ×（1 + 缓冲）×（1 + 加价比例），与独立的有理数实现在随机输入上比对（JPY↔USD/CNY/KRW，各币种小数位）；
 * - 上限（单笔不超过结算价，正好等于可以）、转人工（超过对外价 50%，正好 50% 不转）的边界；
 * - 24 小时提交期、48 小时异议期按毫秒，跨午夜、跨月、夏令时不影响（按时刻算）；
 * - 状态机：异议期内不能直接通过；终态不能再变；随机走一遍只走允许的转换。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EXTRA_CHARGE_RULES,
  EXTRA_CHARGE_STATUSES,
  type ExtraChargeStatus,
  approvedExtraChargeAmount,
  disputeDeadline,
  disputeOpen,
  extraChargeCustomerMinor,
  extraChargeReviewReasons,
  extraChargeSubmitDeadline,
  extraChargeSubmitRefusal,
  extraChargeTransitionAllowed,
} from "./extra-charges.ts";
import { type CurrencyCode, minorDigits } from "./money.ts";

const HOUR = 3_600_000;

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const int = (r: () => number, min: number, max: number): number => min + Math.floor(r() * (max - min + 1));

/** 独立实现：全部用 bigint 分数，最后四舍五入（0.5 远离零；金额都是正的）。汇率是十进制字符串。 */
function oracleCustomer(amountMinor: number, from: CurrencyCode, to: CurrencyCode, rate: string | null, bufferBp: number, markupBp: number): number {
  let num = BigInt(amountMinor) * BigInt(10_000 + markupBp);
  let den = 10_000n;
  if (from !== to) {
    const [intPart, frac = ""] = (rate as string).split(".");
    num *= BigInt(`${intPart}${frac}`) * 10n ** BigInt(minorDigits(to)) * BigInt(10_000 + bufferBp);
    den *= 10n ** BigInt(frac.length) * 10n ** BigInt(minorDigits(from)) * 10_000n;
  }
  const q = num / den;
  return Number((num % den) * 2n >= den ? q + 1n : q);
}

test("客人付的金额与独立实现比对（随机金额、加价、缓冲、汇率，同币种和跨币种）", () => {
  const r = rng(424242);
  const pairs: [CurrencyCode, CurrencyCode, () => string][] = [
    ["JPY", "JPY", () => "1"],
    ["JPY", "USD", () => `0.00${int(r, 50, 99)}${int(r, 0, 9999)}`],
    ["JPY", "CNY", () => `0.0${int(r, 40, 60)}${int(r, 0, 999)}`],
    ["JPY", "KRW", () => `${int(r, 8, 10)}.${int(r, 0, 99999)}`],
    ["USD", "JPY", () => `${int(r, 120, 160)}.${int(r, 0, 9999)}`],
    ["CNY", "USD", () => `0.1${int(r, 0, 9999)}`],
  ];
  for (let i = 0; i < 10_000; i += 1) {
    const [from, to, rateOf] = pairs[int(r, 0, pairs.length - 1)] as (typeof pairs)[number];
    const amountMinor = int(r, 1, 50_000_000);
    const markupBp = int(r, 0, 5_000);
    const fxBufferBp = from === to ? 0 : int(r, 0, 300);
    const rate = from === to ? null : rateOf();
    const fx = rate === null ? null : { from, to, rate, asOf: "2026-10-01T00:00:00.000Z" };
    const got = extraChargeCustomerMinor({ amountMinor, settlementCurrency: from, currency: to, markupBp, fxBufferBp, fx });
    assert.equal(got, oracleCustomer(amountMinor, from, to, rate, fxBufferBp, markupBp), `${amountMinor} ${from}->${to} rate=${rate} buf=${fxBufferBp} mk=${markupBp}`);
    assert.ok(Number.isSafeInteger(got) && got >= 0);
  }
});

test("客人付的金额：正好 .5 往上入；同币种不加缓冲（给了缓冲也不加）；汇率方向不对就算不出（不会拿反的汇率去扣钱）", () => {
  // 1,005 × 1.1 = 1,105.5 → 1,106
  assert.equal(extraChargeCustomerMinor({ amountMinor: 1_005, settlementCurrency: "JPY", currency: "JPY", markupBp: 1_000, fxBufferBp: 150, fx: null }), 1_106);
  // 1 日元 × 0.005 = 0.005 美元 = 0.5 美分 → 1 美分
  assert.equal(extraChargeCustomerMinor({ amountMinor: 1, settlementCurrency: "JPY", currency: "USD", markupBp: 0, fxBufferBp: 0, fx: { from: "JPY", to: "USD", rate: "0.005", asOf: "2026-10-01T00:00:00.000Z" } }), 1);
  assert.throws(() => extraChargeCustomerMinor({ amountMinor: 1_000, settlementCurrency: "JPY", currency: "USD", markupBp: 1_000, fxBufferBp: 150, fx: { from: "USD", to: "JPY", rate: "150", asOf: "2026-10-01T00:00:00.000Z" } }), RangeError);
});

const completedAt = new Date("2026-10-31T14:59:59.999Z"); // 东京 10-31 23:59:59.999（跨午夜、跨月的那一刻）
const facts = { status: "completed" as const, category: "charter" as const, completedAt, settlementMinor: 30_000, existingItems: 0 };

test("提交期 24 小时按毫秒（服务在月末午夜前结束）：到截止那一刻还能交，多 1 毫秒不行", () => {
  const deadline = extraChargeSubmitDeadline(completedAt);
  assert.equal(deadline.toISOString(), "2026-11-01T14:59:59.999Z");
  const item = { type: "waiting" as const, amountMinor: 1_000, fileCount: 1 };
  assert.equal(extraChargeSubmitRefusal(item, facts, deadline), null);
  assert.equal(extraChargeSubmitRefusal(item, facts, new Date(deadline.getTime() + 1)), "SUBMIT_WINDOW_CLOSED");
  assert.equal(extraChargeSubmitRefusal(item, { ...facts, completedAt: null }, completedAt), "ORDER_NOT_COMPLETED");
  for (const status of ["confirmed", "assigned", "in_service", "cancelled", "no_show"] as const) assert.equal(extraChargeSubmitRefusal(item, { ...facts, status }, completedAt), "ORDER_NOT_COMPLETED", status);
});

test("金额上限：等于结算价可以，多 1 不行；0、负数、小数、超出安全整数拒绝", () => {
  const ok = { type: "waiting" as const, fileCount: 1 };
  assert.equal(extraChargeSubmitRefusal({ ...ok, amountMinor: 30_000 }, facts, completedAt), null);
  assert.equal(extraChargeSubmitRefusal({ ...ok, amountMinor: 30_001 }, facts, completedAt), "AMOUNT_OVER_LIMIT");
  for (const amountMinor of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN]) assert.equal(extraChargeSubmitRefusal({ ...ok, amountMinor }, facts, completedAt), "AMOUNT_INVALID", String(amountMinor));
  const r = rng(5);
  for (let i = 0; i < 2_000; i += 1) {
    const settlementMinor = int(r, 1, 1_000_000_000);
    const amountMinor = int(r, 1, 2 * settlementMinor);
    const refusal = extraChargeSubmitRefusal({ ...ok, amountMinor }, { ...facts, settlementMinor }, completedAt);
    assert.equal(refusal, amountMinor > settlementMinor ? "AMOUNT_OVER_LIMIT" : null, `${amountMinor} / ${settlementMinor}`);
  }
});

test("转人工：客人付的超过对外价 50%（按整数比较，正好一半不转、多 1 转）；没有凭证转", () => {
  const r = rng(11);
  for (let i = 0; i < 2_000; i += 1) {
    const sell = int(r, 1, 1_000_000_000);
    const customer = int(r, 1, sell);
    const reasons = extraChargeReviewReasons(customer, sell, 1);
    assert.equal(reasons.includes("OVER_THRESHOLD"), 2 * customer > sell, `${customer} / ${sell}`);
  }
  assert.deepEqual(extraChargeReviewReasons(5_000, 10_000, 1), []);
  assert.deepEqual(extraChargeReviewReasons(5_001, 10_000, 0), ["OVER_THRESHOLD", "NO_EVIDENCE"]);
  // 奇数对外价：11,001 的一半是 5,500.5，5,500 不转、5,501 转
  assert.deepEqual([extraChargeReviewReasons(5_500, 11_001, 1), extraChargeReviewReasons(5_501, 11_001, 1)], [[], ["OVER_THRESHOLD"]]);
});

test("48 小时异议期按时刻：跨月、跨夏令时（伦敦 10-25）都是 48 × 3600000 毫秒；截止前 1 毫秒能提，到点那一刻起不能", () => {
  for (const submitted of ["2026-10-30T15:00:00.000Z", "2026-10-24T00:30:00.000Z", "2026-12-31T23:59:59.999Z", "2027-02-27T12:00:00.000Z"]) {
    const at = new Date(submitted);
    const until = disputeDeadline(at);
    assert.equal(until.getTime() - at.getTime(), EXTRA_CHARGE_RULES.disputeHours * HOUR);
    assert.equal(disputeOpen(until, new Date(until.getTime() - 1)), true);
    assert.equal(disputeOpen(until, until), false);
    assert.equal(disputeOpen(until, new Date(until.getTime() + 1)), false);
    assert.equal(disputeOpen(until, at), true, "提交的那一刻就能提异议");
  }
  assert.equal(disputeDeadline(new Date("2027-02-27T12:00:00.000Z")).toISOString(), "2027-03-01T12:00:00.000Z", "平年 2 月跨月");
});

test("状态机：异议期内平台不能直接通过 / 驳回、不能直接记扣到；终态不能再变；不能回到异议期；只有正在扣的能记为已扣", () => {
  assert.equal(extraChargeTransitionAllowed("in_window", "approved"), false);
  assert.equal(extraChargeTransitionAllowed("in_window", "rejected"), false);
  assert.equal(extraChargeTransitionAllowed("in_window", "charged"), false);
  assert.equal(extraChargeTransitionAllowed("disputed", "charging"), false, "有异议的不能不审就扣");
  assert.equal(extraChargeTransitionAllowed("review", "charging"), false, "待审核的不能不审就扣");
  assert.equal(extraChargeTransitionAllowed("withdrawn", "in_window"), false);
  const terminal: ExtraChargeStatus[] = ["charged", "rejected", "withdrawn"];
  for (const from of terminal) for (const to of EXTRA_CHARGE_STATUSES) assert.equal(extraChargeTransitionAllowed(from, to), false, `${from} → ${to}`);
  // 不能从别的状态回到异议期
  for (const from of EXTRA_CHARGE_STATUSES) assert.equal(extraChargeTransitionAllowed(from, "in_window"), false, from);
  // charged 只能从 charging 来（不经过「正在扣」就记扣到 = 没有收款记录）
  for (const from of EXTRA_CHARGE_STATUSES) assert.equal(extraChargeTransitionAllowed(from, "charged"), from === "charging", from);
});

test("部分通过的金额：1 到提交的金额之间的整数；0、超过、小数不行", () => {
  assert.equal(approvedExtraChargeAmount(5_000, null), 5_000);
  assert.equal(approvedExtraChargeAmount(5_000, 1), 1);
  assert.equal(approvedExtraChargeAmount(5_000, 5_000), 5_000);
  for (const bad of [0, -1, 5_001, 2.5]) assert.equal(approvedExtraChargeAmount(5_000, bad), null, String(bad));
});
