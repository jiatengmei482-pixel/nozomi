import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CANCELLATION_RULES,
  DEFAULT_CANCELLATION_POLICY,
  FREE_CANCEL_REASONS,
  ORDER_CANCEL_REASONS,
  type CancellationRule,
  VEHICLE_LEVELS,
  allocateRefund,
  cancellationAmounts,
  cancellationNeedsReview,
  cancellationPolicyIssues,
  cancellationRuleFor,
  cancellationTierAt,
  inFreeCancellationWindow,
  nextRefundAttemptAt,
  refundRetryRefusal,
  refundTransitionAllowed,
  retainedAfterRefundsMinor,
  sameCancellationPolicy,
  vehicleLevel,
} from "./cancellation.ts";
import { SERVICE_CATEGORIES } from "./master-data.ts";

const HOUR = 3_600_000;
const service = new Date("2026-11-01T01:00:00.000Z");
const before = (ms: number): Date => new Date(service.getTime() - ms);

test("车型级别：四个等级照搬，10 座及以上不论等级都是中巴", () => {
  assert.equal(vehicleLevel("economy", 4), "economy");
  assert.equal(vehicleLevel("business", 7), "business");
  assert.equal(vehicleLevel("luxury", 9), "luxury");
  assert.equal(vehicleLevel("business", 10), "minibus");
  assert.equal(vehicleLevel("economy", 29), "minibus");
});

test("默认政策就是需求表：3 个品类 × 5 个车型级别，经济 / 舒适的接送机和点对点 24 / 6 小时，其余 48 / 24 小时", () => {
  assert.equal(DEFAULT_CANCELLATION_POLICY.length, SERVICE_CATEGORIES.length * VEHICLE_LEVELS.length);
  assert.deepEqual(cancellationPolicyIssues(DEFAULT_CANCELLATION_POLICY), []);
  const hours = (category: (typeof SERVICE_CATEGORIES)[number], level: (typeof VEHICLE_LEVELS)[number]) => cancellationRuleFor(DEFAULT_CANCELLATION_POLICY, category, level).tiers.map((t) => [t.minHoursBefore, t.feeBp]);
  assert.deepEqual(hours("airport_transfer", "economy"), [[24, 0], [6, 5000], [0, 10000]]);
  assert.deepEqual(hours("point_to_point", "comfort"), [[24, 0], [6, 5000], [0, 10000]]);
  for (const level of ["business", "luxury", "minibus"] as const) assert.deepEqual(hours("airport_transfer", level), [[48, 0], [24, 5000], [0, 10000]]);
  for (const level of VEHICLE_LEVELS) assert.deepEqual(hours("charter", level), [[48, 0], [24, 5000], [0, 10000]], `包车 ${level}`);
});

test("阶梯边界按毫秒：正好 24 小时免费、少 1 毫秒扣 50%；正好 6 小时扣 50%、少 1 毫秒扣 100%；用车时间之后 100%", () => {
  const rule = cancellationRuleFor(DEFAULT_CANCELLATION_POLICY, "airport_transfer", "economy");
  assert.equal(cancellationTierAt(rule, service, before(24 * HOUR)).feeBp, 0);
  assert.equal(cancellationTierAt(rule, service, before(24 * HOUR - 1)).feeBp, 5000);
  assert.equal(cancellationTierAt(rule, service, before(6 * HOUR)).feeBp, 5000);
  assert.equal(cancellationTierAt(rule, service, before(6 * HOUR - 1)).feeBp, 10000);
  assert.equal(cancellationTierAt(rule, service, before(0)).feeBp, 10000);
  const late = cancellationTierAt(rule, service, before(-10 * 60_000));
  assert.equal(late.feeBp, 10000);
  assert.equal(late.index, 2);
  assert.equal(late.msBeforeService, -600_000);
  assert.equal(cancellationTierAt(rule, service, before(30 * 24 * HOUR)).index, 0);
  assert.equal(inFreeCancellationWindow(rule, service, before(24 * HOUR)), true);
  assert.equal(inFreeCancellationWindow(rule, service, before(24 * HOUR - 1)), false);
});

test("按时刻算、不看当地日期：东京凌晨 0:30 的单，前一天 23:30 取消是 1 小时（跨午夜）；纽约夏令时结束那晚按真实经过的小时数", () => {
  const rule = cancellationRuleFor(DEFAULT_CANCELLATION_POLICY, "point_to_point", "economy");
  // 东京 2026-11-02 00:30 = UTC 2026-11-01 15:30；东京 2026-11-01 23:30 = UTC 14:30
  const tokyoService = new Date("2026-11-01T15:30:00.000Z");
  const match = cancellationTierAt(rule, tokyoService, new Date("2026-11-01T14:30:00.000Z"));
  assert.equal(match.msBeforeService, HOUR);
  assert.equal(match.feeBp, 10000);
  // 东京 2026-11-02 00:30 的单，在 2026-11-01 00:30（当地日期差 1 天）取消：正好 24 小时，免费
  assert.equal(cancellationTierAt(rule, tokyoService, new Date("2026-10-31T15:30:00.000Z")).feeBp, 0);
  // 纽约 2026-11-01 是夏令时结束的那天（凌晨 2:00 拨回 1:00）：当地 2026-11-01 08:00（EST，UTC 13:00）的单，
  // 当地 2026-10-31 08:00（EDT，UTC 12:00）取消，墙上的钟差 24 小时，实际经过 25 小时——按实际的算，免费
  const nyService = new Date("2026-11-01T13:00:00.000Z");
  const ny = cancellationTierAt(rule, nyService, new Date("2026-10-31T12:00:00.000Z"));
  assert.equal(ny.msBeforeService, 25 * HOUR);
  assert.equal(ny.feeBp, 0);
  // 当地 2026-10-31 09:00（EDT，UTC 13:00）取消：墙上差 23 小时，实际 24 小时整——仍免费
  assert.equal(cancellationTierAt(rule, nyService, new Date("2026-10-31T13:00:00.000Z")).feeBp, 0);
});

test("取消的金额按同一比例拆：客人扣对外价 × M%，退款 = 对外价 − 取消费；供应商得结算价 × M%（四舍五入，0.5 远离零）", () => {
  assert.deepEqual(cancellationAmounts({ sellMinor: 22_000, settlementMinor: 19_800, feeBp: 5000 }), { feeBp: 5000, customerFeeMinor: 11_000, refundMinor: 11_000, tenantShareMinor: 9_900 });
  assert.deepEqual(cancellationAmounts({ sellMinor: 22_001, settlementMinor: 19_801, feeBp: 5000 }), { feeBp: 5000, customerFeeMinor: 11_001, refundMinor: 11_000, tenantShareMinor: 9_901 });
  // 美分：12.35 美元 × 50% = 6.175 → 6.18
  assert.deepEqual(cancellationAmounts({ sellMinor: 1_235, settlementMinor: 1_001, feeBp: 5000 }), { feeBp: 5000, customerFeeMinor: 618, refundMinor: 617, tenantShareMinor: 501 });
  assert.deepEqual(cancellationAmounts({ sellMinor: 22_000, settlementMinor: 19_800, feeBp: 0 }), { feeBp: 0, customerFeeMinor: 0, refundMinor: 22_000, tenantShareMinor: 0 });
  assert.deepEqual(cancellationAmounts({ sellMinor: 22_000, settlementMinor: 19_800, feeBp: 10_000 }), { feeBp: 10_000, customerFeeMinor: 22_000, refundMinor: 0, tenantShareMinor: 19_800 });
  for (let sell = 1; sell < 300; sell += 7) {
    const amounts = cancellationAmounts({ sellMinor: sell, settlementMinor: sell, feeBp: 3333 });
    assert.equal(amounts.customerFeeMinor + amounts.refundMinor, sell, "退款加取消费正好是对外价");
  }
  assert.throws(() => cancellationAmounts({ sellMinor: 1, settlementMinor: 1, feeBp: 10_001 }), RangeError);
  assert.throws(() => cancellationAmounts({ sellMinor: 1, settlementMinor: 1, feeBp: 0.5 }), RangeError);
});

test("取消原因：付款前两种 + 客人取消 + 五种免费；免费的里只有「改期没确认」不用运营选", () => {
  assert.deepEqual([...ORDER_CANCEL_REASONS], ["PAYMENT_TIMEOUT", "PAYMENT_CANCELED", "GUEST_REQUEST", "CHANGE_NOT_CONFIRMED", "FLIGHT_CANCELLED", "FORCE_MAJEURE", "SUPPLIER_FAULT", "PLATFORM_FAULT"]);
  assert.ok(!FREE_CANCEL_REASONS.includes("GUEST_REQUEST"));
  assert.ok(FREE_CANCEL_REASONS.includes("CHANGE_NOT_CONFIRMED"));
});

test("运营代取消多退了钱（免收取消费、免费的原因）就要双人复核；退得和阶梯一样不用", () => {
  assert.equal(cancellationNeedsReview(11_000, 11_000), false);
  assert.equal(cancellationNeedsReview(11_000, 11_001), true);
  assert.equal(cancellationNeedsReview(22_000, 22_000), false);
});

const rule = (tiers: [number, number][]): CancellationRule => ({ category: "charter", level: "economy", tiers: tiers.map(([minHoursBefore, feeBp]) => ({ minHoursBefore, feeBp })) });
const withRule = (replacement: CancellationRule): CancellationRule[] => DEFAULT_CANCELLATION_POLICY.map((entry) => (entry.category === replacement.category && entry.level === replacement.level ? replacement : entry));

test("政策校验：每个品类 × 车型级别正好一条；小时数从大到小、最后一档 0；扣款比例只增不减、在 0–100% 之间；最多 5 档", () => {
  const reasons = (policy: CancellationRule[]) => cancellationPolicyIssues(policy).map((issue) => issue.reason);
  assert.deepEqual(reasons(withRule(rule([[72, 0], [48, 2000], [24, 5000], [2, 8000], [0, 10000]]))), []);
  assert.deepEqual(reasons(withRule(rule([[0, 10000]]))), [], "一档：任何时候取消都扣 100% 也是合法的");
  assert.deepEqual(reasons(withRule(rule([[48, 0], [24, 5000], [12, 7000], [6, 8000], [2, 9000], [0, 10000]]))), ["TIER_COUNT"]);
  assert.deepEqual(reasons(withRule(rule([]))), ["TIER_COUNT"]);
  assert.deepEqual(reasons(withRule(rule([[24, 0], [24, 5000], [0, 10000]]))), ["HOURS_NOT_DESCENDING"]);
  assert.deepEqual(reasons(withRule(rule([[24, 0], [6, 5000]]))), ["LAST_TIER_NOT_ZERO"]);
  assert.deepEqual(reasons(withRule(rule([[24, 5000], [6, 0], [0, 10000]]))), ["FEE_DECREASING"]);
  assert.deepEqual(reasons(withRule(rule([[24, -1], [0, 10000]]))), ["FEE_INVALID"]);
  assert.deepEqual(reasons(withRule(rule([[CANCELLATION_RULES.maxHours + 1, 0], [0, 10000]]))), ["HOURS_INVALID"]);
  assert.deepEqual(reasons(withRule(rule([[24.5, 0], [0, 10000]]))), ["HOURS_INVALID"]);
  assert.deepEqual(reasons(DEFAULT_CANCELLATION_POLICY.slice(1)), ["MISSING_RULE"]);
  assert.deepEqual(reasons([...DEFAULT_CANCELLATION_POLICY, DEFAULT_CANCELLATION_POLICY[0] as CancellationRule]), ["DUPLICATE_RULE"]);
  assert.deepEqual(reasons([...DEFAULT_CANCELLATION_POLICY, { category: "bus" as never, level: "economy", tiers: [{ minHoursBefore: 0, feeBp: 0 }] }]), ["UNKNOWN_RULE"]);
});

test("两份政策一样不一样：顺序无关，档数和每档的数都要一样", () => {
  assert.equal(sameCancellationPolicy(DEFAULT_CANCELLATION_POLICY, [...DEFAULT_CANCELLATION_POLICY].reverse()), true);
  assert.equal(sameCancellationPolicy(DEFAULT_CANCELLATION_POLICY, withRule(rule([[48, 0], [24, 5000], [0, 10000]]))), true);
  assert.equal(sameCancellationPolicy(DEFAULT_CANCELLATION_POLICY, withRule(rule([[48, 0], [24, 6000], [0, 10000]]))), false);
  assert.equal(sameCancellationPolicy(DEFAULT_CANCELLATION_POLICY, DEFAULT_CANCELLATION_POLICY.slice(1)), false);
});

test("退款状态机：等着发 → 正在发 → 退好了 / 失败 / 回到等着发；失败可以手动重试；退好了是终态", () => {
  assert.equal(refundTransitionAllowed("pending", "processing"), true);
  assert.equal(refundTransitionAllowed("pending", "succeeded"), false, "没发给收款服务不能算退好");
  assert.equal(refundTransitionAllowed("processing", "succeeded"), true);
  assert.equal(refundTransitionAllowed("processing", "pending"), true);
  assert.equal(refundTransitionAllowed("failed", "processing"), true);
  assert.equal(refundTransitionAllowed("succeeded", "processing"), false);
  assert.equal(refundTransitionAllowed("succeeded", "failed"), false);
});

test("退款重试的间隔 1、5、30、120、360 分钟，5 次后不再自动重试", () => {
  const now = new Date("2026-11-01T00:00:00.000Z");
  assert.equal(nextRefundAttemptAt(1, now)?.toISOString(), "2026-11-01T00:01:00.000Z");
  assert.equal(nextRefundAttemptAt(2, now)?.toISOString(), "2026-11-01T00:05:00.000Z");
  assert.equal(nextRefundAttemptAt(4, now)?.toISOString(), "2026-11-01T02:00:00.000Z");
  assert.equal(nextRefundAttemptAt(5, now), null);
});

test("退款从最近收的那一笔开始退；可退的不够抛错；已退的不再退", () => {
  const charges = [
    { paymentId: "order", amountMinor: 20_000, refundedMinor: 0 },
    { paymentId: "change", amountMinor: 2_000, refundedMinor: 0 },
  ];
  assert.deepEqual(allocateRefund(charges, 22_000), [{ paymentId: "change", amountMinor: 2_000 }, { paymentId: "order", amountMinor: 20_000 }]);
  assert.deepEqual(allocateRefund(charges, 1_500), [{ paymentId: "change", amountMinor: 1_500 }]);
  assert.deepEqual(allocateRefund([{ paymentId: "order", amountMinor: 20_000, refundedMinor: 5_000 }, { paymentId: "change", amountMinor: 2_000, refundedMinor: 2_000 }], 15_000), [{ paymentId: "order", amountMinor: 15_000 }]);
  assert.deepEqual(allocateRefund(charges, 0), []);
  assert.throws(() => allocateRefund(charges, 22_001), RangeError);
  assert.throws(() => allocateRefund(charges, -1), RangeError);
});

test("退款之后客人至少留下多少：没取消的是对外价，取消了的是取消费（四舍五入），没有扣款比例的按 0", () => {
  assert.equal(retainedAfterRefundsMinor({ cancelled: false, sellMinor: 21_780, cancelFeeBp: null }), 21_780);
  assert.equal(retainedAfterRefundsMinor({ cancelled: true, sellMinor: 21_781, cancelFeeBp: 5_000 }), 10_891);
  assert.equal(retainedAfterRefundsMinor({ cancelled: true, sellMinor: 21_780, cancelFeeBp: 0 }), 0);
  assert.equal(retainedAfterRefundsMinor({ cancelled: true, sellMinor: 21_780, cancelFeeBp: null }), 0);
});

test("手动重试失败的退款前的核对：作废的不能重试；退了之后少于应留下的、或超过这一笔收款还能退的，不能重试；正好等于可以", () => {
  const base = { superseded: false, amountMinor: 4_356, netPaidMinor: 26_136, paymentAvailableMinor: 26_136, retainedMinor: 21_780 };
  assert.equal(refundRetryRefusal(base), null, "改期退差价失败、订单没取消：退了之后正好是新的对外价");
  assert.equal(refundRetryRefusal({ ...base, superseded: true }), "SUPERSEDED");
  assert.equal(refundRetryRefusal({ ...base, retainedMinor: 21_781 }), "EXCEEDS_PAID", "少 1 也不行");
  assert.equal(refundRetryRefusal({ ...base, paymentAvailableMinor: 4_355 }), "EXCEEDS_PAID", "超过这一笔收款还能退的");
  // 取消时已经按「实际付了的」退完（只剩取消费）：即便没标作废，金额核对也拦得住
  assert.equal(refundRetryRefusal({ ...base, netPaidMinor: 10_890, paymentAvailableMinor: 10_890, retainedMinor: 10_890 }), "EXCEEDS_PAID");
  assert.equal(refundRetryRefusal({ ...base, amountMinor: 10_890, netPaidMinor: 21_780, paymentAvailableMinor: 21_780, retainedMinor: 10_890 }), null, "取消的退款失败：重试它正好留下取消费");
});
