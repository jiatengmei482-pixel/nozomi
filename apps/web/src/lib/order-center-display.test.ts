import { test } from "node:test";
import assert from "node:assert/strict";
import { DEDUCTION_KINDS, EXCEPTION_TYPES, STATEMENT_LINE_KINDS, STATEMENT_STATUSES, TICKET_STATUSES, TICKET_TYPES } from "@nozomi/domain";
import { EVENT_NAMES, STATEMENT_STATUS_BADGES, lineDetailText, periodText, statementActions, tenantStatementActions } from "./billing-display.ts";
import { TICKET_STATUS_BADGES, assigneeText, authorText, colleagueName, exceptionDetailLines, isZero, moneyLabel, outcomeName, ticketTypeName } from "./order-center-display.ts";
import { deductionBasisText, deductionKindName } from "./rescue-display.ts";

test("金额：币种在前、千分位、负号在数字前，小数位照接口给的（不用浮点）", () => {
  assert.equal(moneyLabel({ amount: "21780", currency: "JPY" }), "JPY 21,780");
  assert.equal(moneyLabel({ amount: "-1200", currency: "JPY" }), "JPY -1,200");
  assert.equal(moneyLabel({ amount: "4600.50", currency: "CNY" }), "CNY 4,600.50");
  assert.equal(moneyLabel({ amount: "0.00", currency: "CNY" }), "CNY 0.00");
  assert.equal(isZero({ amount: "0.00", currency: "CNY" }), true);
  assert.equal(isZero({ amount: "-0", currency: "JPY" }), true);
  assert.equal(isZero({ amount: "1", currency: "JPY" }), false);
});

test("工单：每种类型、状态都有说法；「租户」在界面上叫「供应商」；结论按工单类型说", () => {
  for (const type of TICKET_TYPES) assert.ok(ticketTypeName(type) !== "" && !ticketTypeName(type).includes("租户"), type);
  for (const status of TICKET_STATUSES) assert.ok(!TICKET_STATUS_BADGES[status].label.includes("租户"), status);
  assert.equal(ticketTypeName("tenant_appeal"), "供应商申诉");
  assert.equal(outcomeName("complaint", "upheld"), "成立");
  assert.equal(outcomeName("no_show_review", "rejected"), "驳回（按未履约处理）");
  assert.equal(outcomeName("other", null), "—");
});

test("谁写的、谁在处理：自己写「你」；供应商后台看不到是哪位平台员工", () => {
  const names = new Map([["a", "佐藤"]]);
  assert.equal(authorText({ author_type: "platform_user", author_id: "a" }, names, "platform"), "佐藤");
  assert.equal(authorText({ author_type: "platform_user", author_id: null }, names, "tenant"), "平台");
  assert.equal(authorText({ author_type: "tenant_user", author_id: "u" }, names, "tenant"), "你们");
  assert.equal(colleagueName("a", names, "a"), "你");
  assert.equal(colleagueName("zzz", names, "a"), "（同事）");
  assert.equal(assigneeText({ id: "b", name: null }, "a"), "（已停用的同事）");
  assert.equal(assigneeText(null, "a"), "—");
});

test("异常的情况：每种类型都能写；支付异常写原因和金额；认不出来的字段不显示", () => {
  for (const type of EXCEPTION_TYPES) assert.doesNotThrow(() => exceptionDetailLines({ type, detail: {} }), type);
  assert.deepEqual(exceptionDetailLines({ type: "payment_issue", detail: { reason: "chargeback", kind: "order", amount_minor: 21780, currency: "JPY", unknown: 1 } }), [
    { label: "原因", value: "客人拒付" },
    { label: "收款", value: "下单付款" },
    { label: "金额", value: "JPY 21,780" },
  ]);
  assert.deepEqual(exceptionDetailLines({ type: "push_failed", detail: { event_type: "order.assigned", last_status_code: 502 } }).map((line) => line.value), ["order.assigned", "HTTP 502"]);
});

test("应扣款项：赔付、报销写出工单号和情形、怎么算的（M4-02 加的两种）", () => {
  for (const kind of DEDUCTION_KINDS) assert.ok(deductionKindName(kind) !== "", kind);
  assert.equal(deductionKindName("compensation"), "客人赔付");
  assert.equal(deductionKindName("reimbursement"), "替代交通报销");
  assert.equal(deductionBasisText("compensation", { ticket_no: "TK20261026K3M9Q2", scenario: "vehicle_downgrade", bp: 2000, settlement_minor: 19800, downgrade_settlement_difference_minor: 3000 }, "JPY"), "工单 TK20261026K3M9Q2 · 车型降级：结算价 19,800 JPY × 20% + 车型差价 3,000 JPY");
  assert.match(deductionBasisText("reimbursement", { ticket_no: "TK20261026K3M9Q2", scenario: "driver_no_show", same_currency: false }, "JPY"), /司机未到：客人凭票报销的替代交通，全部由供应商承担（按订单报价时的汇率换成结算币种）/);
  assert.match(deductionBasisText("penalty", { trigger: "tenant_declared", bp: 3000, settlement_minor: 19800 }, "JPY"), /× 30%$/);
});

test("账单：每种状态、明细、经过都有说法；明细写出怎么来的；能做什么和后端同一份规则", () => {
  for (const status of STATEMENT_STATUSES) assert.ok(STATEMENT_STATUS_BADGES[status].label !== "", status);
  for (const kind of STATEMENT_LINE_KINDS) assert.doesNotThrow(() => lineDetailText({ kind, detail: {}, amount: { amount: "0", currency: "JPY" } }), kind);
  assert.equal(Object.keys(EVENT_NAMES).length, 9);
  assert.equal(lineDetailText({ kind: "cancellation", detail: { settlement_minor: 19800, cancel_fee_bp: 5000, cancel_reason: "GUEST_REQUEST" }, amount: { amount: "9900", currency: "JPY" } }), "结算价 JPY 19,800 × 扣款 50%（客人取消（按取消政策扣款））");
  assert.equal(lineDetailText({ kind: "deduction_waiver", detail: { deduction_kind: "penalty", waive_reason: "台风" }, amount: { amount: "5940", currency: "JPY" } }), "违约金免除：台风");
  assert.equal(lineDetailText({ kind: "carry_forward", detail: { statement_no: "ST202608AAAAAAAA", period: "2026-08" }, amount: { amount: "-100", currency: "JPY" } }), "上期账单 ST202608AAAAAAAA（2026-08）");
  assert.equal(periodText("2026-09"), "2026 年 9 月");
  assert.deepEqual(statementActions("disputed"), { reply: true, void: true, requestReview: false });
  assert.deepEqual(statementActions("confirmed"), { reply: false, void: true, requestReview: true });
  assert.deepEqual(statementActions("in_payout"), { reply: false, void: false, requestReview: false });
  assert.deepEqual(tenantStatementActions("issued"), { confirm: true, dispute: true });
  assert.deepEqual(tenantStatementActions("disputed"), { confirm: true, dispute: false });
  assert.deepEqual(tenantStatementActions("confirmed"), { confirm: false, dispute: false });
});
