import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BILLING_RULES,
  type BillableItem,
  autoConfirmDue,
  billingToday,
  confirmDueAt,
  deductionBillable,
  draftStatements,
  extraChargeBillable,
  isBillingPeriod,
  orderBillable,
  payDueDate,
  payoutDateFor,
  payoutTotals,
  periodEnded,
  periodFirstDay,
  periodLastDay,
  periodOfDate,
  periodToGenerate,
  shiftPeriod,
  statementActionAllowed,
  statementSummary,
  statusAfterApproval,
  sumMinor,
} from "./billing.ts";

test("周期：格式、所在月、前后挪、首末日（含闰年 2 月）", () => {
  assert.equal(isBillingPeriod("2026-10"), true);
  for (const bad of ["2026-13", "2026-00", "2026-1", "26-10", "2026-10-01", "1999-12"]) assert.equal(isBillingPeriod(bad), false, bad);
  assert.equal(periodOfDate("2026-10-31"), "2026-10");
  assert.equal(shiftPeriod("2026-01", -1), "2025-12");
  assert.equal(shiftPeriod("2026-12", 1), "2027-01");
  assert.equal(shiftPeriod("2026-10", 14), "2027-12");
  assert.equal(periodFirstDay("2026-02"), "2026-02-01");
  assert.equal(periodLastDay("2026-02"), "2026-02-28");
  assert.equal(periodLastDay("2028-02"), "2028-02-29");
  assert.equal(periodLastDay("2026-10"), "2026-10-31");
  assert.throws(() => periodLastDay("2026-13"), RangeError);
  assert.throws(() => periodOfDate("2026/10/01"), RangeError);
});

test("跨时区：「今天」和该出哪一期按东京日期——UTC 还是 10 月 31 日时东京已经是 11 月 1 日", () => {
  assert.equal(BILLING_RULES.timeZone, "Asia/Tokyo");
  // 2026-10-31T15:00Z = 东京 11-01 00:00
  assert.equal(billingToday(new Date("2026-10-31T14:59:59.999Z")), "2026-10-31");
  assert.equal(billingToday(new Date("2026-10-31T15:00:00.000Z")), "2026-11-01");
  assert.equal(periodToGenerate(new Date("2026-10-31T14:59:59.999Z")), "2026-09");
  assert.equal(periodToGenerate(new Date("2026-10-31T15:00:00.000Z")), "2026-10");
  // 跨年
  assert.equal(periodToGenerate(new Date("2027-01-05T00:00:00Z")), "2026-12");
  assert.equal(periodEnded("2026-10", "2026-10-31"), false);
  assert.equal(periodEnded("2026-10", "2026-11-01"), true);
});

test("应付日：次月 20 日；已清退的再延后一个月；跨年", () => {
  assert.equal(payDueDate("2026-10", 20, false), "2026-11-20");
  assert.equal(payDueDate("2026-10", 20, true), "2026-12-20");
  assert.equal(payDueDate("2026-12", 20, false), "2027-01-20");
  assert.equal(payDueDate("2026-12", 20, true), "2027-02-20");
  assert.throws(() => payDueDate("2026-10", 29, false), RangeError);
  assert.throws(() => payDueDate("2026-10", 0, false), RangeError);
});

test("付款日：应付日那天的批次还开着就进它；已过、已关就顺延到下个月同一天", () => {
  const none = (): boolean => false;
  assert.equal(payoutDateFor("2026-11-20", "2026-11-05", none), "2026-11-20");
  // 当天还能进
  assert.equal(payoutDateFor("2026-11-20", "2026-11-20", none), "2026-11-20");
  // 复核得晚，过了 20 日 → 12 月 20 日
  assert.equal(payoutDateFor("2026-11-20", "2026-11-21", none), "2026-12-20");
  // 11 月的批次已经锁定 → 12 月；12 月的也锁了 → 次年 1 月
  assert.equal(payoutDateFor("2026-11-20", "2026-11-10", (date) => date === "2026-11-20"), "2026-12-20");
  assert.equal(payoutDateFor("2026-12-20", "2026-12-01", (date) => date <= "2026-12-20"), "2027-01-20");
  assert.throws(() => payoutDateFor("2026-11-20", "2026-11-10", () => true), RangeError);
});

test("订单出账：已完成、客人未出现按结算价，有偿取消按供应商应得；其余不出", () => {
  assert.deepEqual(orderBillable({ status: "completed", settlementMinor: 20_000, cancelTenantShareMinor: null }), { kind: "order", amountMinor: 20_000 });
  assert.deepEqual(orderBillable({ status: "no_show", settlementMinor: 20_000, cancelTenantShareMinor: null }), { kind: "no_show", amountMinor: 20_000 });
  assert.deepEqual(orderBillable({ status: "cancelled", settlementMinor: 20_000, cancelTenantShareMinor: 10_000 }), { kind: "cancellation", amountMinor: 10_000 });
  assert.equal(orderBillable({ status: "cancelled", settlementMinor: 20_000, cancelTenantShareMinor: 0 }), null);
  assert.equal(orderBillable({ status: "cancelled", settlementMinor: 20_000, cancelTenantShareMinor: null }), null);
  for (const status of ["pending_payment", "confirmed", "assigned", "departed", "arrived", "in_service", "no_show_claimed", "rescue_pending", "rescued"]) {
    assert.equal(orderBillable({ status, settlementMinor: 20_000, cancelTenantShareMinor: null }), null, status);
  }
});

test("事后加收出账：只有已扣到款的；部分通过按通过的金额", () => {
  assert.equal(extraChargeBillable({ status: "charged", amountMinor: 3_000, approvedMinor: null }), 3_000);
  assert.equal(extraChargeBillable({ status: "charged", amountMinor: 3_000, approvedMinor: 2_000 }), 2_000);
  for (const status of ["in_window", "review", "disputed", "approved", "charging", "charge_failed", "rejected", "withdrawn"]) {
    assert.equal(extraChargeBillable({ status, amountMinor: 3_000, approvedMinor: null }), null, status);
  }
});

test("应扣款项出账：救援有结论才扣；0 元不出；出过账后免除的退回一次", () => {
  const base = { status: "pending", amountMinor: 6_000, orderConcluded: true, billed: false, waiverBilled: false };
  assert.deepEqual(deductionBillable(base), { kind: "deduction", amountMinor: -6_000 });
  assert.equal(deductionBillable({ ...base, orderConcluded: false }), null);
  assert.equal(deductionBillable({ ...base, billed: true }), null);
  assert.equal(deductionBillable({ ...base, amountMinor: 0 }), null);
  // 没出过账就免除了：什么都不出
  assert.equal(deductionBillable({ ...base, status: "waived" }), null);
  assert.deepEqual(deductionBillable({ ...base, status: "waived", billed: true }), { kind: "deduction_waiver", amountMinor: 6_000 });
  assert.equal(deductionBillable({ ...base, status: "waived", billed: true, waiverBilled: true }), null);
});

function item(over: Partial<BillableItem> & Pick<BillableItem, "sourceKey">): BillableItem {
  return { kind: "order", currency: "JPY", amountMinor: 20_000, serviceDate: "2026-10-15", orderId: null, orderNo: null, detail: {}, ...over };
}

test("草稿：按服务日期切月，之后的留给以后；往期的标「往期调整」；按币种各一张；合计", () => {
  const items = [
    item({ sourceKey: "order:a", serviceDate: "2026-10-01", orderNo: "NZ2" }),
    item({ sourceKey: "order:b", serviceDate: "2026-10-31", orderNo: "NZ1" }),
    item({ sourceKey: "order:c", serviceDate: "2026-11-01" }),
    item({ sourceKey: "order:d", serviceDate: "2026-09-30", orderNo: "NZ0" }),
    item({ sourceKey: "deduction:e", kind: "deduction", amountMinor: -6_000, serviceDate: "2026-10-20" }),
    item({ sourceKey: "order:f", currency: "USD", amountMinor: 12_345, serviceDate: "2026-10-02" }),
  ];
  const drafts = draftStatements("2026-10", items);
  assert.deepEqual(drafts.map((draft) => draft.currency), ["JPY", "USD"]);
  const jpy = drafts[0];
  assert.ok(jpy);
  assert.deepEqual(jpy.lines.map((line) => line.sourceKey), ["order:d", "order:a", "order:b", "deduction:e"]);
  assert.deepEqual(jpy.lines.map((line) => line.priorPeriod), [true, false, false, false]);
  assert.equal(jpy.totalMinor, 20_000 * 3 - 6_000);
  assert.equal(drafts[1]?.totalMinor, 12_345);
});

test("草稿：跨月边界——城市当地日期的 10 月 31 日属于 10 月，11 月 1 日不属于（服务日期已经是当地日期，不再换算）", () => {
  const drafts = draftStatements("2026-10", [item({ sourceKey: "order:last", serviceDate: "2026-10-31" }), item({ sourceKey: "order:next", serviceDate: "2026-11-01" })]);
  assert.deepEqual(drafts[0]?.lines.map((line) => line.sourceKey), ["order:last"]);
  assert.deepEqual(draftStatements("2026-09", [item({ sourceKey: "order:last", serviceDate: "2026-10-31" })]), []);
});

test("草稿：已有账单的币种跳过；只有上期结转的币种不出账单", () => {
  const items = [
    item({ sourceKey: "order:a" }),
    item({ sourceKey: "carry:s1", kind: "carry_forward", amountMinor: -5_000, serviceDate: null, currency: "USD" }),
    item({ sourceKey: "carry:s2", kind: "carry_forward", amountMinor: -1_000, serviceDate: null }),
  ];
  const drafts = draftStatements("2026-10", items);
  assert.deepEqual(drafts.map((draft) => draft.currency), ["JPY"]);
  // 结转排在最前、算往期
  assert.deepEqual(drafts[0]?.lines.map((line) => [line.sourceKey, line.priorPeriod]), [["carry:s2", true], ["order:a", false]]);
  assert.equal(drafts[0]?.totalMinor, 19_000);
  assert.deepEqual(draftStatements("2026-10", items, ["JPY"]), []);
});

test("合计：整数相加，超出安全整数范围抛错（不会悄悄丢精度）", () => {
  assert.equal(sumMinor([]), 0);
  assert.equal(sumMinor([1, -2, 3]), 2);
  assert.throws(() => sumMinor([Number.MAX_SAFE_INTEGER, 1]), RangeError);
  assert.throws(() => sumMinor([0.5]), RangeError);
});

test("小计：按种类几条、多少；总计", () => {
  const summary = statementSummary([
    { kind: "order", amountMinor: 20_000 },
    { kind: "order", amountMinor: 19_800 },
    { kind: "cancellation", amountMinor: 10_000 },
    { kind: "deduction", amountMinor: -6_000 },
  ]);
  assert.deepEqual(summary.byKind.order, { count: 2, amountMinor: 39_800 });
  assert.deepEqual(summary.byKind.extra_charge, { count: 0, amountMinor: 0 });
  assert.equal(summary.totalMinor, 43_800);
});

test("状态：谁能在什么时候做什么", () => {
  assert.equal(statementActionAllowed("issued", "confirm"), true);
  assert.equal(statementActionAllowed("disputed", "confirm"), true);
  assert.equal(statementActionAllowed("confirmed", "confirm"), false);
  assert.equal(statementActionAllowed("issued", "dispute"), true);
  assert.equal(statementActionAllowed("disputed", "dispute"), false);
  assert.equal(statementActionAllowed("disputed", "auto_confirm"), false);
  assert.equal(statementActionAllowed("disputed", "reply"), true);
  assert.equal(statementActionAllowed("issued", "request_review"), false);
  assert.equal(statementActionAllowed("confirmed", "request_review"), true);
  assert.equal(statementActionAllowed("in_payout", "void"), false);
  assert.equal(statementActionAllowed("carried", "void"), false);
  assert.equal(statementActionAllowed("confirmed", "void"), true);
  assert.equal(statementActionAllowed("in_payout", "pay"), true);
  for (const action of ["confirm", "dispute", "reply", "void", "request_review", "approve", "pay"] as const) assert.equal(statementActionAllowed("void", action), false);
});

test("复核通过后：正数进批次、0 无需付款、负数转入下期", () => {
  assert.equal(statusAfterApproval(1), "in_payout");
  assert.equal(statusAfterApproval(0), "settled");
  assert.equal(statusAfterApproval(-1), "carried");
});

test("确认期：7 天，按毫秒；到点那一刻起视为确认；有异议的不自动确认", () => {
  const issued = new Date("2026-11-01T00:00:00Z");
  const due = confirmDueAt(issued);
  assert.equal(due.toISOString(), "2026-11-08T00:00:00.000Z");
  assert.equal(autoConfirmDue({ status: "issued", confirmDueAt: due }, new Date(due.getTime() - 1)), false);
  assert.equal(autoConfirmDue({ status: "issued", confirmDueAt: due }, due), true);
  assert.equal(autoConfirmDue({ status: "disputed", confirmDueAt: due }, due), false);
});

test("批次合计：按币种分开", () => {
  assert.deepEqual(
    payoutTotals([
      { currency: "USD", totalMinor: 100 },
      { currency: "JPY", totalMinor: 20_000 },
      { currency: "JPY", totalMinor: 5_000 },
    ]),
    [
      { currency: "JPY", count: 2, totalMinor: 25_000 },
      { currency: "USD", count: 1, totalMinor: 100 },
    ],
  );
});
