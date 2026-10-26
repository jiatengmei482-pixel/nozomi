import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COMPENSATION_SCENARIOS,
  type CompensationInput,
  DEFAULT_COMPENSATION_TABLE,
  compensationAmounts,
  compensationInputIssues,
  compensationNeedsReview,
  compensationTableIssues,
  complaintDeadline,
  complaintWindowOpen,
  lateScenario,
  minimumCompensationMinor,
  sameCompensationTable,
} from "./compensation.ts";

/** 同币种的一单：对外价 22,000 日元，结算价 19,800 日元，加价 11.1%（快照里的数，这里只用于车型降级的差价）。 */
function input(overrides: Partial<CompensationInput> = {}): CompensationInput {
  return {
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
    ...overrides,
  };
}

function amounts(overrides: Partial<CompensationInput> = {}) {
  const outcome = compensationAmounts(input(overrides));
  assert.ok(outcome.ok, JSON.stringify(outcome));
  return outcome.amounts;
}

test("默认赔付表就是需求原表的数字：迟到 15–29 分钟 10%、≥ 30 分钟 50%、司机未到 100%、降级 20% + 差价、未举牌 10%、没送到 25%、车况态度 10%；最低 ¥500、报销上限 1.5 倍", () => {
  assert.deepEqual(DEFAULT_COMPENSATION_TABLE.customerBp, {
    late_15_29: 1000,
    late_30_plus: 5000,
    driver_no_show: 10_000,
    vehicle_downgrade: 2000,
    no_signboard: 1000,
    not_delivered: 2500,
    service_complaint: 1000,
  });
  assert.equal(DEFAULT_COMPENSATION_TABLE.minimumJpy, 500);
  assert.equal(DEFAULT_COMPENSATION_TABLE.reimbursementCapBp, 15_000);
  assert.equal(DEFAULT_COMPENSATION_TABLE.version, 0);
  assert.deepEqual(compensationTableIssues(DEFAULT_COMPENSATION_TABLE), []);
});

test("每种情形按表算客人赔多少、租户按结算价同比例承担（四舍五入到最小单位）", () => {
  const expected: Record<string, [number, number]> = {
    late_15_29: [2200, 1980],
    late_30_plus: [11_000, 9900],
    no_signboard: [2200, 1980],
    not_delivered: [5500, 4950],
    service_complaint: [2200, 1980],
  };
  for (const [scenario, [customer, tenant]] of Object.entries(expected)) {
    const result = amounts({ scenario: scenario as CompensationInput["scenario"] });
    assert.equal(result.customer.compensationMinor, customer, scenario);
    assert.equal(result.customer.refundMinor, customer, scenario);
    assert.equal(result.customer.manualPayoutMinor, 0, scenario);
    assert.equal(result.tenant.ratioMinor, tenant, scenario);
    assert.equal(result.tenant.totalMinor, tenant, scenario);
  }
  // 奇数的结算价：19,805 × 10% = 1,980.5 → 1,981（0.5 远离零）
  assert.equal(amounts({ settlementMinor: 19_805 }).tenant.ratioMinor, 1981);
});

test("每笔至少等值 ¥500：按比例不够的补到 500，补足的部分由平台承担（租户仍按比例）", () => {
  const cheap = amounts({ sellMinor: 3000, settlementMinor: 2700, refundableMinor: 3000 });
  assert.equal(cheap.customer.ratioMinor, 300);
  assert.equal(cheap.customer.compensationMinor, 500);
  assert.equal(cheap.customer.toppedUp, true);
  assert.equal(cheap.tenant.totalMinor, 270);
  // 正好 500 不算补足
  assert.equal(amounts({ sellMinor: 5000, settlementMinor: 4500 }).customer.toppedUp, false);
});

test("最低额换币种：JPY 直接 500；别的币种按判定时的 JPY 汇率向上取整；没有对得上的汇率返回 null；最低额 0 不用换", () => {
  assert.equal(minimumCompensationMinor(DEFAULT_COMPENSATION_TABLE, "JPY", null), 500);
  // 1 JPY = 0.0479 CNY → 500 日元 = 23.95 元 = 2395 分
  assert.equal(minimumCompensationMinor(DEFAULT_COMPENSATION_TABLE, "CNY", { from: "JPY", to: "CNY", rate: "0.0479" }), 2395);
  // 1 JPY = 0.006666666667 USD → 3.3333333335 美元 → 向上取整 334 美分（保证不少于等值）
  assert.equal(minimumCompensationMinor(DEFAULT_COMPENSATION_TABLE, "USD", { from: "JPY", to: "USD", rate: "0.006666666667" }), 334);
  assert.equal(minimumCompensationMinor(DEFAULT_COMPENSATION_TABLE, "USD", null), null);
  assert.equal(minimumCompensationMinor(DEFAULT_COMPENSATION_TABLE, "USD", { from: "USD", to: "JPY", rate: "150" }), null);
  assert.equal(minimumCompensationMinor({ minimumJpy: 0 }, "USD", null), 0);
});

test("车型降级：差价（结算价之差按快照换成客人的价格，加同样的加价比例）+ 订单 20%；租户承担结算价之差 + 结算价 20%", () => {
  // 结算价之差 3,000 日元 × (1 + 11.11%) = 3,333.3 → 3,333
  const result = amounts({ scenario: "vehicle_downgrade", downgradeSettlementDifferenceMinor: 3000 });
  assert.equal(result.customer.downgradeDifferenceMinor, 3333);
  assert.equal(result.customer.ratioMinor, 4400);
  assert.equal(result.customer.compensationMinor, 7733);
  assert.deepEqual([result.tenant.ratioMinor, result.tenant.downgradeDifferenceMinor, result.tenant.totalMinor], [3960, 3000, 6960]);
});

test("跨币种：差价按订单快照的汇率和 1.5% 缓冲换成客人支付的币种；报销按快照汇率反过来换成结算币种", () => {
  // 结算 JPY，客人付 CNY：1 JPY = 0.048 CNY；对外价 1,100.00 元，结算价 20,000 日元
  const fx = { from: "JPY" as const, to: "CNY" as const, rate: "0.048", asOf: "2026-10-01T00:00:00Z" };
  const base = { currency: "CNY" as const, sellMinor: 110_000, settlementMinor: 20_000, settlementCurrency: "JPY" as const, markupBp: 1000, fxBufferBp: 150, fx, minimumMinor: 2400, refundableMinor: 110_000 };
  // 2,000 日元 × 0.048 × 1.015 × 1.1 = 107.184 元 → 10718 分
  const downgrade = amounts({ ...base, scenario: "vehicle_downgrade", downgradeSettlementDifferenceMinor: 2000 });
  assert.equal(downgrade.customer.downgradeDifferenceMinor, 10_718);
  assert.equal(downgrade.tenant.currency, "JPY");
  // 报销 480.00 元 ÷ 0.048 = 10,000 日元
  const noShow = amounts({ ...base, scenario: "driver_no_show", reimbursementClaimedMinor: 48_000 });
  assert.equal(noShow.tenant.reimbursementMinor, 10_000);
  assert.equal(noShow.tenant.ratioMinor, 20_000);
  // 快照里没有汇率（不该发生）：算不出
  const missing = compensationAmounts(input({ ...base, fx: null, scenario: "driver_no_show", reimbursementClaimedMinor: 48_000 }));
  assert.deepEqual(missing, { ok: false, reason: "FX_RATE_UNAVAILABLE" });
});

test("司机未到：全额退款（退回还没退的全部）+ 替代交通报销（上限对外价 1.5 倍，超出的不给），报销由财务另付；租户承担结算价 100% + 报销", () => {
  const result = amounts({ scenario: "driver_no_show", reimbursementClaimedMinor: 40_000 });
  assert.equal(result.customer.compensationMinor, 22_000);
  assert.equal(result.customer.refundMinor, 22_000);
  assert.equal(result.customer.reimbursementCapMinor, 33_000);
  assert.equal(result.customer.reimbursementMinor, 33_000);
  assert.equal(result.customer.manualPayoutMinor, 33_000);
  assert.deepEqual([result.tenant.ratioMinor, result.tenant.reimbursementMinor, result.tenant.totalMinor], [19_800, 33_000, 52_800]);
  // 订单已经按取消全额退过了：不再退第二次，只付报销
  const refunded = amounts({ scenario: "driver_no_show", reimbursementClaimedMinor: 5000, refundableMinor: 0 });
  assert.deepEqual([refunded.customer.refundMinor, refunded.customer.manualPayoutMinor], [0, 5000]);
  // 违约金已经按救援（司机未到 100%）记过：租户这里只承担报销
  const deducted = amounts({ scenario: "driver_no_show", reimbursementClaimedMinor: 5000, settlementShareAlreadyDeducted: true });
  assert.deepEqual([deducted.tenant.ratioMinor, deducted.tenant.totalMinor], [0, 5000]);
  // 没有报销
  assert.equal(amounts({ scenario: "driver_no_show", reimbursementClaimedMinor: null }).customer.manualPayoutMinor, 0);
});

test("责任在平台：客人照样按表赔，租户承担 0", () => {
  const result = amounts({ scenario: "late_30_plus", liable: "platform" });
  assert.equal(result.customer.compensationMinor, 11_000);
  assert.deepEqual(result.tenant, { currency: "JPY", ratioMinor: 0, downgradeDifferenceMinor: 0, reimbursementMinor: 0, totalMinor: 0 });
});

test("退不回卡上的部分由财务另付：还能退的不够时，先退能退的，其余另付", () => {
  const result = amounts({ scenario: "late_30_plus", refundableMinor: 4000 });
  assert.deepEqual([result.customer.refundMinor, result.customer.manualPayoutMinor], [4000, 7000]);
  const none = amounts({ scenario: "late_15_29", refundableMinor: -5 });
  assert.deepEqual([none.customer.refundMinor, none.customer.manualPayoutMinor], [0, 2200]);
});

test("输入要对得上情形：降级必须给正的差价、别的情形不能给差价；只有司机未到能报销；金额必须是非负整数", () => {
  assert.deepEqual(compensationInputIssues({ scenario: "vehicle_downgrade", downgradeSettlementDifferenceMinor: null, reimbursementClaimedMinor: null }), ["DOWNGRADE_DIFFERENCE_REQUIRED"]);
  assert.deepEqual(compensationInputIssues({ scenario: "vehicle_downgrade", downgradeSettlementDifferenceMinor: 0, reimbursementClaimedMinor: null }), ["AMOUNT_INVALID"]);
  assert.deepEqual(compensationInputIssues({ scenario: "late_15_29", downgradeSettlementDifferenceMinor: 100, reimbursementClaimedMinor: null }), ["DOWNGRADE_DIFFERENCE_NOT_ALLOWED"]);
  assert.deepEqual(compensationInputIssues({ scenario: "late_15_29", downgradeSettlementDifferenceMinor: null, reimbursementClaimedMinor: 100 }), ["REIMBURSEMENT_NOT_ALLOWED"]);
  assert.deepEqual(compensationInputIssues({ scenario: "driver_no_show", downgradeSettlementDifferenceMinor: null, reimbursementClaimedMinor: 1.5 }), ["AMOUNT_INVALID"]);
  assert.deepEqual(compensationInputIssues({ scenario: "driver_no_show", downgradeSettlementDifferenceMinor: null, reimbursementClaimedMinor: 0 }), []);
  assert.deepEqual(compensationAmounts(input({ scenario: "vehicle_downgrade" })), { ok: false, reason: "DOWNGRADE_DIFFERENCE_REQUIRED" });
});

test("复核：赔给客人的钱 ≥ 对外价 50%（含）要第二个人复核；司机未到退回的原价不算，只算报销和补足；阈值 0 时每笔都复核", () => {
  assert.equal(amounts({ scenario: "late_30_plus" }).needsReview, true);
  assert.equal(amounts({ scenario: "not_delivered" }).needsReview, false);
  assert.equal(compensationNeedsReview(10_999, 22_000, DEFAULT_COMPENSATION_TABLE), false);
  assert.equal(compensationNeedsReview(11_000, 22_000, DEFAULT_COMPENSATION_TABLE), true);
  assert.equal(amounts({ scenario: "driver_no_show", reimbursementClaimedMinor: null }).needsReview, false);
  assert.equal(amounts({ scenario: "driver_no_show", reimbursementClaimedMinor: 11_000 }).needsReview, true);
  assert.equal(compensationNeedsReview(1, 22_000, { reviewAtOrAboveSellBp: 0 }), true);
  assert.equal(compensationNeedsReview(0, 22_000, { reviewAtOrAboveSellBp: 0 }), false);
});

test("配置的赔付表：用哪一版的比例算；记下版本号", () => {
  const table = { ...DEFAULT_COMPENSATION_TABLE, version: 3, customerBp: { ...DEFAULT_COMPENSATION_TABLE.customerBp, late_15_29: 1500 }, minimumJpy: 1000 };
  const outcome = compensationAmounts(input({ minimumMinor: 1000 }), table);
  assert.ok(outcome.ok);
  assert.equal(outcome.amounts.customer.compensationMinor, 3300);
  assert.equal(outcome.amounts.tenant.ratioMinor, 2970);
  assert.equal(outcome.amounts.tableVersion, 3);
  assert.equal(outcome.amounts.customerBp, 1500);
});

test("赔付表的校验：比例 0–100%，司机未到固定 100%；最低额、报销上限、复核阈值有范围；内容一样的判断不看版本", () => {
  const bad = compensationTableIssues({
    customerBp: { ...DEFAULT_COMPENSATION_TABLE.customerBp, late_15_29: 10_001, driver_no_show: 5000, not_delivered: -1 },
    minimumJpy: 100_001,
    reimbursementCapBp: 50_001,
    reviewAtOrAboveSellBp: 1.5,
  });
  assert.deepEqual(bad.map((issue) => `${issue.path}:${issue.reason}`), [
    "/customer_bp/late_15_29:OUT_OF_RANGE",
    "/customer_bp/driver_no_show:FIXED",
    "/customer_bp/not_delivered:OUT_OF_RANGE",
    "/minimum_jpy:OUT_OF_RANGE",
    "/reimbursement_cap_bp:OUT_OF_RANGE",
    "/review_at_or_above_sell_bp:OUT_OF_RANGE",
  ]);
  assert.equal(sameCompensationTable(DEFAULT_COMPENSATION_TABLE, { ...DEFAULT_COMPENSATION_TABLE, version: 9 }), true);
  assert.equal(sameCompensationTable(DEFAULT_COMPENSATION_TABLE, { ...DEFAULT_COMPENSATION_TABLE, minimumJpy: 501 }), false);
  assert.equal(COMPENSATION_SCENARIOS.length, 7);
});

test("迟到按分钟选情形：不到 15 分钟不赔，15–29、30 及以上（边界含）", () => {
  assert.equal(lateScenario(14.9), null);
  assert.equal(lateScenario(15), "late_15_29");
  assert.equal(lateScenario(29.99), "late_15_29");
  assert.equal(lateScenario(30), "late_30_plus");
  assert.equal(lateScenario(Number.NaN), null);
});

test("投诉时限：服务结束后 14 天内，正好 14 天还能投诉，多 1 毫秒不能", () => {
  const end = new Date("2026-10-20T03:00:00Z");
  assert.equal(complaintDeadline(end).toISOString(), "2026-11-03T03:00:00.000Z");
  assert.equal(complaintWindowOpen(end, new Date("2026-11-03T03:00:00.000Z")), true);
  assert.equal(complaintWindowOpen(end, new Date("2026-11-03T03:00:00.001Z")), false);
});
