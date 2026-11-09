import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EXTRA_CHARGE_STATUSES,
  EXTRA_CHARGE_RULES,
  EXTRA_CHARGE_TYPES,
  type ExtraChargeOrderFacts,
  afterDisputeWindow,
  approvedExtraChargeAmount,
  disputeDeadline,
  disputeOpen,
  extraChargeCustomerMinor,
  extraChargeNeedsReceipt,
  extraChargeReviewReasons,
  extraChargeSubmitDeadline,
  extraChargeSubmitRefusal,
  extraChargeTransitionAllowed,
  extraChargeTypeAllowed,
  extraChargeTypesFor,
  nextChargeAttemptAt,
  extraChargeReviewRefusal,
  extraChargeWithdrawable,
} from "./extra-charges.ts";
import { CHARTER_ALL_INCLUSIVE_FROM, charterAllInclusiveFor } from "./fixed-price-includes.ts";

const completedAt = new Date("2026-11-01T10:00:00.000Z");
const HOUR = 3_600_000;
/** 默认是分界前下的单（旧规则，包车还能收高速、停车）；分界后的单见「包车一口价全含」几条。 */
const placedBefore = new Date("2026-10-30T09:00:00.000Z");
const order = (extra: Partial<ExtraChargeOrderFacts> = {}): ExtraChargeOrderFacts => ({ status: "completed", category: "charter", placedAt: placedBefore, completedAt, settlementMinor: 98_000, existingItems: 0, ...extra });
const BOUNDARY = new Date(CHARTER_ALL_INCLUSIVE_FROM);

test("可加收的类型（分界前下的单）：包车超时、超公里、高速、停车只有包车；付费等待、加停靠点、加附加服务各品类都有", () => {
  for (const type of EXTRA_CHARGE_TYPES) assert.equal(extraChargeTypeAllowed(type, "charter", placedBefore), true, type);
  for (const category of ["airport_transfer", "point_to_point"] as const) {
    assert.deepEqual(EXTRA_CHARGE_TYPES.filter((type) => extraChargeTypeAllowed(type, category, placedBefore)), ["waiting", "extra_stop", "extra_addon"], `${category} 是一口价，含高速和停车费`);
  }
  assert.deepEqual(EXTRA_CHARGE_TYPES.filter(extraChargeNeedsReceipt), ["toll", "parking"]);
});

test("包车一口价全含的分界：东京 2026-11-10 00:00；正好那一刻下的算全含，早 1 毫秒不算", () => {
  assert.equal(BOUNDARY.toISOString(), "2026-11-09T15:00:00.000Z");
  assert.equal(charterAllInclusiveFor(BOUNDARY), true);
  assert.equal(charterAllInclusiveFor(new Date(BOUNDARY.getTime() - 1)), false);
  assert.equal(charterAllInclusiveFor(new Date(BOUNDARY.getTime() + 1)), true);
});

test("包车一口价全含：分界后下的包车单不能收高速、停车；超时、超公里、付费等待、加停靠点、加附加服务不变", () => {
  for (const placedAt of [BOUNDARY, new Date("2027-03-01T00:00:00.000Z")]) {
    assert.deepEqual(extraChargeTypesFor("charter", placedAt), ["charter_overtime", "charter_over_km", "waiting", "extra_stop", "extra_addon"], placedAt.toISOString());
    assert.equal(extraChargeTypeAllowed("toll", "charter", placedAt), false);
    assert.equal(extraChargeTypeAllowed("parking", "charter", placedAt), false);
  }
  assert.deepEqual(extraChargeTypesFor("charter", new Date(BOUNDARY.getTime() - 1)), [...EXTRA_CHARGE_TYPES], "分界前 1 毫秒下的单照旧规则");
  for (const category of ["airport_transfer", "point_to_point"] as const) {
    for (const placedAt of [placedBefore, BOUNDARY]) assert.deepEqual(extraChargeTypesFor(category, placedAt), ["waiting", "extra_stop", "extra_addon"], `${category} ${placedAt.toISOString()}`);
  }
});

test("包车一口价全含：提交按下单时间判断，不按提交时间；分界后的单提交高速、停车是 TYPE_NOT_ALLOWED（附了票据也一样），超时照常", () => {
  const after = order({ placedAt: new Date(BOUNDARY.getTime() + HOUR), completedAt: new Date(BOUNDARY.getTime() + 10 * HOUR) });
  const at = new Date(BOUNDARY.getTime() + 11 * HOUR);
  for (const type of ["toll", "parking"] as const) {
    assert.equal(extraChargeSubmitRefusal({ type, amountMinor: 1_000, fileCount: 1 }, after, at), "TYPE_NOT_ALLOWED", type);
    assert.equal(extraChargeSubmitRefusal({ type, amountMinor: 1_000, fileCount: 0 }, after, at), "TYPE_NOT_ALLOWED", `${type} 没附票据也先报不能收`);
  }
  for (const type of ["charter_overtime", "charter_over_km", "waiting", "extra_stop", "extra_addon"] as const) assert.equal(extraChargeSubmitRefusal({ type, amountMinor: 1_000, fileCount: 1 }, after, at), null, type);
  const before = order({ placedAt: new Date(BOUNDARY.getTime() - 1), completedAt: new Date(BOUNDARY.getTime() + 10 * HOUR) });
  assert.equal(extraChargeSubmitRefusal({ type: "toll", amountMinor: 1_000, fileCount: 1 }, before, at), null, "分界前下、分界后服务和提交的单仍按旧规则");
  assert.equal(extraChargeSubmitRefusal({ type: "parking", amountMinor: 1_000, fileCount: 0 }, before, at), "RECEIPT_REQUIRED");
});

test("提交：只有已完成的单、服务结束 24 小时内（正好 24 小时还行，多 1 毫秒不行）", () => {
  const item = { type: "charter_overtime" as const, amountMinor: 5_000, fileCount: 1 };
  assert.equal(extraChargeSubmitDeadline(completedAt).toISOString(), "2026-11-02T10:00:00.000Z");
  assert.equal(extraChargeSubmitRefusal(item, order(), new Date(completedAt.getTime() + 24 * HOUR)), null);
  assert.equal(extraChargeSubmitRefusal(item, order(), new Date(completedAt.getTime() + 24 * HOUR + 1)), "SUBMIT_WINDOW_CLOSED");
  for (const status of ["assigned", "in_service", "cancelled", "no_show"] as const) assert.equal(extraChargeSubmitRefusal(item, order({ status }), completedAt), "ORDER_NOT_COMPLETED", status);
  assert.equal(extraChargeSubmitRefusal(item, order({ completedAt: null }), completedAt), "ORDER_NOT_COMPLETED");
});

test("提交：类型要适用、金额是正整数且不超过结算价、高速停车要附票据、一单最多 10 项", () => {
  const at = new Date(completedAt.getTime() + HOUR);
  assert.equal(extraChargeSubmitRefusal({ type: "toll", amountMinor: 1_000, fileCount: 1 }, order({ category: "airport_transfer" }), at), "TYPE_NOT_ALLOWED");
  assert.equal(extraChargeSubmitRefusal({ type: "waiting", amountMinor: 0, fileCount: 1 }, order(), at), "AMOUNT_INVALID");
  assert.equal(extraChargeSubmitRefusal({ type: "waiting", amountMinor: 1.5, fileCount: 1 }, order(), at), "AMOUNT_INVALID");
  assert.equal(extraChargeSubmitRefusal({ type: "waiting", amountMinor: 98_000, fileCount: 1 }, order(), at), null, "正好等于结算价可以");
  assert.equal(extraChargeSubmitRefusal({ type: "waiting", amountMinor: 98_001, fileCount: 1 }, order(), at), "AMOUNT_OVER_LIMIT");
  assert.equal(extraChargeSubmitRefusal({ type: "parking", amountMinor: 1_200, fileCount: 0 }, order(), at), "RECEIPT_REQUIRED");
  assert.equal(extraChargeSubmitRefusal({ type: "waiting", amountMinor: 1_200, fileCount: 0 }, order(), at), null, "别的类型可以没有凭证（转人工审核）");
  assert.equal(extraChargeSubmitRefusal({ type: "waiting", amountMinor: 1_200, fileCount: 1 }, order({ existingItems: EXTRA_CHARGE_RULES.maxItemsPerOrder }), at), "TOO_MANY_ITEMS");
});

test("客人付的 = 金额 × 汇率 × (1 + 缓冲) × (1 + 加价比例)，四舍五入；同币种没有汇率和缓冲", () => {
  assert.equal(extraChargeCustomerMinor({ amountMinor: 5_000, settlementCurrency: "JPY", currency: "JPY", markupBp: 1_000, fxBufferBp: 0, fx: null }), 5_500);
  assert.equal(extraChargeCustomerMinor({ amountMinor: 5_005, settlementCurrency: "JPY", currency: "JPY", markupBp: 1_000, fxBufferBp: 0, fx: null }), 5_506, "5505.5 → 5506");
  // 5,000 日元 × 0.0066（1 日元 = 0.0066 美元）= 33 美元 × 1.015 × 1.12 = 37.5144 → 3,751 美分
  const fx = { from: "JPY" as const, to: "USD" as const, rate: "0.0066", asOf: "2026-10-01T00:00:00.000Z" };
  assert.equal(extraChargeCustomerMinor({ amountMinor: 5_000, settlementCurrency: "JPY", currency: "USD", markupBp: 1_200, fxBufferBp: 150, fx }), 3_751);
  assert.throws(() => extraChargeCustomerMinor({ amountMinor: 5_000, settlementCurrency: "JPY", currency: "USD", markupBp: 1_200, fxBufferBp: 150, fx: null }), RangeError);
});

test("转人工：超过对外价 50%（正好 50% 不转）、没有凭证", () => {
  assert.deepEqual(extraChargeReviewReasons(11_000, 22_000, 1), []);
  assert.deepEqual(extraChargeReviewReasons(11_001, 22_000, 1), ["OVER_THRESHOLD"]);
  assert.deepEqual(extraChargeReviewReasons(500, 22_000, 0), ["NO_EVIDENCE"]);
  assert.deepEqual(extraChargeReviewReasons(20_000, 22_000, 0), ["OVER_THRESHOLD", "NO_EVIDENCE"]);
  assert.equal(afterDisputeWindow([]), "charging");
  assert.equal(afterDisputeWindow(["NO_EVIDENCE"]), "review");
});

test("48 小时异议期按毫秒：从提交起算，截止前 1 毫秒还能提，截止那一刻起不能", () => {
  const submittedAt = new Date("2026-11-01T11:22:33.444Z");
  const until = disputeDeadline(submittedAt);
  assert.equal(until.toISOString(), "2026-11-03T11:22:33.444Z");
  assert.equal(disputeOpen(until, new Date(until.getTime() - 1)), true);
  assert.equal(disputeOpen(until, until), false);
  assert.equal(disputeOpen(until, new Date(until.getTime() + 1)), false);
  assert.equal(disputeOpen(until, submittedAt), true);
});

test("加收状态机：异议期内不扣款（只能异议、撤回、或到期后去扣款 / 待审核）；审核后才扣；扣款失败可以重试或不收了", () => {
  assert.equal(extraChargeTransitionAllowed("in_window", "charging"), true);
  assert.equal(extraChargeTransitionAllowed("in_window", "review"), true);
  assert.equal(extraChargeTransitionAllowed("in_window", "disputed"), true);
  assert.equal(extraChargeTransitionAllowed("in_window", "withdrawn"), true);
  assert.equal(extraChargeTransitionAllowed("in_window", "charged"), false);
  assert.equal(extraChargeTransitionAllowed("in_window", "approved"), false, "异议期内平台不能先批准扣款");
  assert.equal(extraChargeTransitionAllowed("disputed", "approved"), true);
  assert.equal(extraChargeTransitionAllowed("disputed", "charging"), false, "有异议的必须先审核");
  assert.equal(extraChargeTransitionAllowed("review", "withdrawn"), false);
  assert.equal(extraChargeTransitionAllowed("approved", "charging"), true);
  assert.equal(extraChargeTransitionAllowed("charging", "charged"), true);
  assert.equal(extraChargeTransitionAllowed("charging", "approved"), true);
  assert.equal(extraChargeTransitionAllowed("charge_failed", "charging"), true);
  assert.equal(extraChargeTransitionAllowed("charge_failed", "rejected"), true);
  for (const final of ["charged", "rejected", "withdrawn"] as const) assert.equal(extraChargeTransitionAllowed(final, "charging"), false);
});

test("审核通过的金额：不填 = 全额；部分通过在 1 和提交的金额之间", () => {
  assert.equal(approvedExtraChargeAmount(5_000, null), 5_000);
  assert.equal(approvedExtraChargeAmount(5_000, 3_000), 3_000);
  assert.equal(approvedExtraChargeAmount(5_000, 5_000), 5_000);
  assert.equal(approvedExtraChargeAmount(5_000, 5_001), null);
  assert.equal(approvedExtraChargeAmount(5_000, 0), null);
  assert.equal(approvedExtraChargeAmount(5_000, 2.5), null);
});

test("收款服务出错后 10 分钟再扣，5 次后不再自动重试", () => {
  const now = new Date("2026-11-01T00:00:00.000Z");
  assert.equal(nextChargeAttemptAt(1, now)?.toISOString(), "2026-11-01T00:10:00.000Z");
  assert.equal(nextChargeAttemptAt(EXTRA_CHARGE_RULES.maxChargeAttempts, now), null);
});

test("平台人工审核只能在待审核 / 有异议（驳回还可以是扣款失败）时；通过要等异议期结束——有异议的也一样，截止那一刻起可以", () => {
  const until = new Date("2026-10-28T00:00:00.000Z");
  const before = new Date(until.getTime() - 1);
  for (const status of EXTRA_CHARGE_STATUSES) {
    const approve = extraChargeReviewRefusal({ status, disputeUntil: until }, "approve", until);
    const reject = extraChargeReviewRefusal({ status, disputeUntil: until }, "reject", until);
    assert.equal(approve, status === "review" || status === "disputed" ? null : "STATE_INVALID", `通过 ${status}`);
    assert.equal(reject, status === "review" || status === "disputed" || status === "charge_failed" ? null : "STATE_INVALID", `驳回 ${status}`);
  }
  assert.equal(extraChargeReviewRefusal({ status: "disputed", disputeUntil: until }, "approve", before), "DISPUTE_WINDOW_OPEN", "异议期内平台不能先批准");
  assert.equal(extraChargeReviewRefusal({ status: "disputed", disputeUntil: until }, "reject", before), null, "驳回对客人有利，异议期内也可以");
  assert.equal(extraChargeReviewRefusal({ status: "charging", disputeUntil: until }, "approve", until), "STATE_INVALID", "正在扣款时不能再审（收款服务出错的重新排队不走这里）");
});

test("供应商撤回：异议期内（截止前 1 毫秒可以，截止那一刻起不行）、还没有别的结果", () => {
  const until = new Date("2026-10-28T00:00:00.000Z");
  assert.equal(extraChargeWithdrawable({ status: "in_window", disputeUntil: until }, new Date(until.getTime() - 1)), true);
  assert.equal(extraChargeWithdrawable({ status: "in_window", disputeUntil: until }, until), false);
  assert.equal(extraChargeWithdrawable({ status: "disputed", disputeUntil: until }, new Date(until.getTime() - 1)), false);
});
