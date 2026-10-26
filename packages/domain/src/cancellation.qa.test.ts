/**
 * M3-03 测试角色补充：取消阶梯与退款拆分的金额和时间，与独立实现在随机输入上比对。
 * - 金额：客人扣款 = 对外价 × M% 四舍五入（0.5 远离零）、退款 = 对外价 − 取消费、供应商 = 结算价 × M%；整数、不超过已付；各币种小数位（JPY 0 位、USD 2 位）。
 * - 时间：按毫秒差找档（独立实现），跨午夜、夏令时开始和结束（纽约、伦敦）用当地时刻换算后的真实时差。
 * - 多笔收款拆退款：拆出的每笔不超过那笔剩下的、合计正好等于要退的、从最近的一笔开始。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CANCELLATION_RULES,
  DEFAULT_CANCELLATION_POLICY,
  type CancellationTier,
  allocateRefund,
  cancellationAmounts,
  cancellationNeedsReview,
  cancellationPolicyIssues,
  cancellationRuleFor,
  cancellationTierAt,
  inFreeCancellationWindow,
} from "./cancellation.ts";
import { formatMajor } from "./money.ts";
import { localDateTimeToInstant } from "./service-time.ts";

const HOUR = 3_600_000;

/** 可复现的伪随机数（mulberry32） */
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

/** 独立实现：minor × bp / 10000，四舍五入（0.5 远离零），只用 bigint。 */
function oraclePortion(minor: number, bp: number): number {
  const n = BigInt(minor) * BigInt(bp);
  const q = n / 10_000n;
  const rem = n % 10_000n;
  return Number(rem * 2n >= 10_000n ? q + 1n : q);
}

/** 独立实现：第一档「离用车的毫秒数 ≥ 小时数 × 3600000」；都不满足（用车之后）落在最后一档。 */
function oracleTier(tiers: readonly CancellationTier[], serviceMs: number, cancelMs: number): number {
  const before = serviceMs - cancelMs;
  for (let i = 0; i < tiers.length; i += 1) if (before >= (tiers[i] as CancellationTier).minHoursBefore * HOUR) return i;
  return tiers.length - 1;
}

/** 随机生成一条合规的阶梯（1–5 档，小时严格递减到 0，比例只增不减）。 */
function randomTiers(r: () => number): CancellationTier[] {
  const count = int(r, 1, CANCELLATION_RULES.maxTiers);
  const hours = new Set<number>([0]);
  while (hours.size < count) hours.add(int(r, 1, CANCELLATION_RULES.maxHours));
  const sorted = [...hours].sort((x, y) => y - x);
  let fee = 0;
  return sorted.map((h) => {
    fee = Math.min(10_000, fee + int(r, 0, 4_000));
    return { minHoursBefore: h, feeBp: fee };
  });
}

test("取消金额与独立实现比对（2 万组随机输入）：扣款四舍五入、退款 + 扣款 = 对外价、都是非负整数、退款不超过已付、供应商应得不超过结算价", () => {
  const r = rng(20261026);
  for (let i = 0; i < 20_000; i += 1) {
    const sellMinor = int(r, 0, 1_000_000_000);
    const settlementMinor = int(r, 0, sellMinor);
    // 一半用边界比例（0、5000、10000、恰好落在 0.5 的比例），一半任意
    const feeBp = r() < 0.5 ? ([0, 1, 5_000, 9_999, 10_000, 2_500, 7_500][int(r, 0, 6)] as number) : int(r, 0, 10_000);
    const got = cancellationAmounts({ sellMinor, settlementMinor, feeBp });
    const fee = oraclePortion(sellMinor, feeBp);
    assert.equal(got.customerFeeMinor, fee, `sell=${sellMinor} bp=${feeBp}`);
    assert.equal(got.refundMinor, sellMinor - fee);
    assert.equal(got.tenantShareMinor, oraclePortion(settlementMinor, feeBp), `settlement=${settlementMinor} bp=${feeBp}`);
    for (const value of [got.customerFeeMinor, got.refundMinor, got.tenantShareMinor]) assert.ok(Number.isSafeInteger(value) && value >= 0);
    assert.ok(got.refundMinor <= sellMinor);
    assert.ok(got.tenantShareMinor <= settlementMinor);
  }
});

test("取消金额：0.5 远离零的具体值；各币种小数位（JPY 0 位、USD 2 位）按最小单位整数算，不出现小数", () => {
  // JPY 1,001 × 50% = 500.5 → 501；退 500
  assert.deepEqual(cancellationAmounts({ sellMinor: 1_001, settlementMinor: 901, feeBp: 5_000 }), { feeBp: 5_000, customerFeeMinor: 501, refundMinor: 500, tenantShareMinor: 451 });
  // USD 0.03 × 50% = 1.5 美分 → 2 美分；退 1 美分
  const usd = cancellationAmounts({ sellMinor: 3, settlementMinor: 1, feeBp: 5_000 });
  assert.deepEqual([formatMajor(usd.customerFeeMinor, "USD"), formatMajor(usd.refundMinor, "USD"), formatMajor(usd.tenantShareMinor, "USD")], ["0.02", "0.01", "0.01"]);
  // 1 基点：9,999 × 0.01% = 0.9999 → 1；4,999 × 0.01% = 0.4999 → 0
  assert.equal(cancellationAmounts({ sellMinor: 9_999, settlementMinor: 0, feeBp: 1 }).customerFeeMinor, 1);
  assert.equal(cancellationAmounts({ sellMinor: 4_999, settlementMinor: 0, feeBp: 1 }).customerFeeMinor, 0);
  // 不是整数基点、超出范围的比例拒绝
  for (const feeBp of [-1, 10_001, 0.5, Number.NaN]) assert.throws(() => cancellationAmounts({ sellMinor: 100, settlementMinor: 90, feeBp }), RangeError);
  // 金额不是整数也拒绝（不悄悄用浮点数算钱）
  assert.throws(() => cancellationAmounts({ sellMinor: 100.5, settlementMinor: 90, feeBp: 5_000 }), RangeError);
});

test("找档与独立实现比对（随机政策 × 随机时刻，含每一档边界上下 1 毫秒）", () => {
  const r = rng(7);
  const serviceMs = Date.parse("2026-12-31T15:00:00.000Z");
  for (let i = 0; i < 2_000; i += 1) {
    const tiers = randomTiers(r);
    assert.deepEqual(cancellationPolicyIssues(DEFAULT_CANCELLATION_POLICY.map((rule, at) => (at === 0 ? { ...rule, tiers } : rule))), [], JSON.stringify(tiers));
    const points = [int(r, -48 * HOUR, 800 * HOUR)];
    for (const tier of tiers) points.push(tier.minHoursBefore * HOUR, tier.minHoursBefore * HOUR - 1, tier.minHoursBefore * HOUR + 1);
    for (const before of points) {
      const cancelMs = serviceMs - before;
      const got = cancellationTierAt({ tiers }, new Date(serviceMs), new Date(cancelMs));
      const want = oracleTier(tiers, serviceMs, cancelMs);
      assert.equal(got.index, want, `${JSON.stringify(tiers)} before=${before}`);
      assert.equal(got.feeBp, (tiers[want] as CancellationTier).feeBp);
      assert.equal(got.msBeforeService, before);
      assert.equal(inFreeCancellationWindow({ tiers }, new Date(serviceMs), new Date(cancelMs)), (tiers[want] as CancellationTier).feeBp === 0);
    }
  }
});

test("越晚取消扣得不会更少（单调）：对每条默认阶梯，取消时刻往后推，扣款比例只增不减", () => {
  const serviceMs = Date.parse("2026-11-20T01:00:00.000Z");
  for (const rule of DEFAULT_CANCELLATION_POLICY) {
    let last = -1;
    for (let before = 100 * HOUR; before >= -2 * HOUR; before -= 997_331) {
      const fee = cancellationTierAt(rule, new Date(serviceMs), new Date(serviceMs - before)).feeBp;
      assert.ok(fee >= last, `${rule.category}/${rule.level} before=${before}`);
      last = fee;
    }
    assert.equal(last, 10_000, "用车时间之后按最后一档（全额）");
  }
});

test("跨午夜和夏令时：用车时刻按城市当地时间换成时刻后再算，按真实经过的毫秒", () => {
  const rule = cancellationRuleFor(DEFAULT_CANCELLATION_POLICY, "airport_transfer", "economy"); // ≥24h 免费，6–24h 50%，<6h 100%
  const at = (local: string, tz: string): Date => localDateTimeToInstant(local, tz) as Date;
  // 东京跨午夜：2026-11-03 00:30 的单，11-02 00:30 取消正好 24 小时（免费），00:30:00.001 之后 50%；11-02 18:30 取消（6 小时）50%，18:30 之后 1 毫秒 100%
  const tokyo = at("2026-11-03T00:30", "Asia/Tokyo");
  assert.equal(cancellationTierAt(rule, tokyo, at("2026-11-02T00:30", "Asia/Tokyo")).feeBp, 0);
  assert.equal(cancellationTierAt(rule, tokyo, new Date(at("2026-11-02T00:30", "Asia/Tokyo").getTime() + 1)).feeBp, 5_000);
  assert.equal(cancellationTierAt(rule, tokyo, at("2026-11-02T18:30", "Asia/Tokyo")).feeBp, 5_000);
  assert.equal(cancellationTierAt(rule, tokyo, new Date(at("2026-11-02T18:30", "Asia/Tokyo").getTime() + 1)).feeBp, 10_000);
  // 纽约夏令时开始（2027-03-14 02:00 拨到 03:00）：当地 03-14 10:00 的单，03-13 10:00 取消，墙上 24 小时、实际 23 小时 → 50%
  const nySpring = at("2027-03-14T10:00", "America/New_York");
  const nySpringCancel = at("2027-03-13T10:00", "America/New_York");
  assert.equal(nySpring.getTime() - nySpringCancel.getTime(), 23 * HOUR);
  assert.equal(cancellationTierAt(rule, nySpring, nySpringCancel).feeBp, 5_000);
  // 同一张单 03-13 09:00 取消：实际正好 24 小时 → 免费
  assert.equal(cancellationTierAt(rule, nySpring, at("2027-03-13T09:00", "America/New_York")).feeBp, 0);
  // 伦敦夏令时结束（2026-10-25 02:00 拨回 01:00）：当地 10-25 07:00 的单，10-25 01:00（BST）取消，墙上 6 小时、实际 7 小时 → 50%；
  // 当地 10-25 01:00（GMT，第二次的 1 点）是 6 小时整，同样 50%；再晚 1 毫秒 100%
  const london = at("2026-10-25T07:00", "Europe/London");
  assert.equal(london.toISOString(), "2026-10-25T07:00:00.000Z");
  assert.equal(cancellationTierAt(rule, london, new Date("2026-10-25T00:00:00.000Z")).feeBp, 5_000, "01:00 BST = 00:00Z，实际 7 小时");
  assert.equal(cancellationTierAt(rule, london, new Date("2026-10-25T01:00:00.000Z")).feeBp, 5_000, "01:00 GMT = 01:00Z，6 小时整");
  assert.equal(cancellationTierAt(rule, london, new Date("2026-10-25T01:00:00.001Z")).feeBp, 10_000);
});

test("多笔收款拆退款（随机）：每笔不超过剩下的、合计正好、从最近一笔开始退，退完一笔才动前一笔；超出可退的抛错", () => {
  const r = rng(99);
  for (let i = 0; i < 5_000; i += 1) {
    const count = int(r, 1, 5);
    const charges = Array.from({ length: count }, (_, at) => {
      const amountMinor = int(r, 1, 200_000);
      return { paymentId: `p${at}`, amountMinor, refundedMinor: r() < 0.3 ? int(r, 0, amountMinor) : 0 };
    });
    const available = charges.reduce((sum, charge) => sum + charge.amountMinor - charge.refundedMinor, 0);
    const amount = int(r, 0, available);
    const parts = allocateRefund(charges, amount);
    assert.equal(parts.reduce((sum, part) => sum + part.amountMinor, 0), amount);
    // 独立实现：从后往前贪心
    let left = amount;
    const want: { paymentId: string; amountMinor: number }[] = [];
    for (let at = charges.length - 1; at >= 0 && left > 0; at -= 1) {
      const charge = charges[at] as (typeof charges)[number];
      const take = Math.min(left, charge.amountMinor - charge.refundedMinor);
      if (take > 0) want.push({ paymentId: charge.paymentId, amountMinor: take });
      left -= take;
    }
    assert.deepEqual(parts, want);
    for (const part of parts) {
      const charge = charges.find((entry) => entry.paymentId === part.paymentId) as (typeof charges)[number];
      assert.ok(part.amountMinor > 0 && part.amountMinor <= charge.amountMinor - charge.refundedMinor);
    }
    assert.throws(() => allocateRefund(charges, available + 1), RangeError);
  }
});

test("代取消要不要复核：多退 1 个最小单位就要；一样或少退不要", () => {
  const r = rng(3);
  for (let i = 0; i < 1_000; i += 1) {
    const policy = int(r, 0, 1_000_000);
    const refund = policy + int(r, -5, 5);
    assert.equal(cancellationNeedsReview(policy, refund), refund > policy);
  }
});
