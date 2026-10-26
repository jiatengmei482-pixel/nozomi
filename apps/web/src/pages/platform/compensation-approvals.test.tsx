/**
 * 赔付表（M4-03）和「待审核」里新接的三类复核（改赔付表、工单判定、付款给供应商）的组件测试：
 * 赔付表按基点显示百分比；运营改表提交整张表（百分比换成基点，不用浮点），走复核；没有 `compensation_table.manage` 的没有修改按钮；
 * 复核卡片写出类别名、改了什么、批准后的效果、去对象的链接。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { DEFAULT_CANCELLATION_POLICY } from "@nozomi/domain";
import type { Approval } from "../../api/channels.ts";
import { COLLEAGUE, ME, STATEMENT_ID, TICKET_ID, openApp, stamps } from "../../testing/order-center-fixtures.tsx";
import { assertAbsent, json, resetBrowser } from "../../testing/harness.tsx";

afterEach(resetBrowser);
const user = () => userEvent.setup();

const table = {
  version: 0,
  effective_at: null,
  scenarios: [
    { scenario: "late_15_29", name: "司机迟到 15–29 分钟", customer_bp: 1000, full_refund: false, reimbursement: false, downgrade_difference: false },
    { scenario: "late_30_plus", name: "司机迟到 30 分钟及以上", customer_bp: 5000, full_refund: false, reimbursement: false, downgrade_difference: false },
    { scenario: "driver_no_show", name: "司机未到", customer_bp: 10000, full_refund: true, reimbursement: true, downgrade_difference: false },
    { scenario: "vehicle_downgrade", name: "车型降级", customer_bp: 2000, full_refund: false, reimbursement: false, downgrade_difference: true },
    { scenario: "no_signboard", name: "未举牌（商品含举牌）", customer_bp: 1000, full_refund: false, reimbursement: false, downgrade_difference: false },
    { scenario: "not_delivered", name: "没送到目的地", customer_bp: 2500, full_refund: false, reimbursement: false, downgrade_difference: false },
    { scenario: "service_complaint", name: "车况、司机态度投诉成立", customer_bp: 1000, full_refund: false, reimbursement: false, downgrade_difference: false },
  ],
  minimum_jpy: 500,
  reimbursement_cap_bp: 15000,
  review_at_or_above_sell_bp: 5000,
};
const policy = { version: 0, effective_at: null, rules: DEFAULT_CANCELLATION_POLICY.map((rule) => ({ category: rule.category, level: rule.level, tiers: rule.tiers.map((tier) => ({ min_hours_before: tier.minHoursBefore, fee_bp: tier.feeBp })) })) };

test("赔付表：看得到每种问题赔客人、供应商承担、最低额和复核阈值；运营改表提交整张表（基点），提交后写「已提交复核」", async () => {
  const bodies: unknown[] = [];
  openApp("/platform/compensation-table", "platform", "operations", (call) => {
    if (call.method === "GET" && call.url.pathname === "/platform/v1/compensation-table") return json(200, { compensation_table: table, cancellation_policy: policy });
    if (call.method === "POST" && call.url.pathname === "/platform/v1/compensation-table/changes") {
      bodies.push(call.body);
      return json(202, { approval: { id: "ap1" } });
    }
    return null;
  });
  const u = user();
  const region = await screen.findByRole("region", { name: "赔付表" });
  assert.ok(within(region).getByText("对外价的 25%"));
  assert.ok(within(region).getByText("结算价 × 25%"));
  assert.ok(within(region).getByText(/全额退款 \+ 凭票报销替代交通（上限对外价的 150%）/));
  assert.ok(screen.getByText("JPY 500"));
  await u.click(screen.getByRole("button", { name: "修改赔付表" }));
  const late = screen.getByLabelText("司机迟到 15–29 分钟（赔对外价的 %）");
  await u.clear(late);
  await u.type(late, "12.5");
  const minimum = screen.getByLabelText("每笔至少等值（日元）");
  await u.clear(minimum);
  await u.type(minimum, "abc");
  await u.click(screen.getByRole("button", { name: "提交复核" }));
  await screen.findByText("有 1 处需要修改");
  assert.equal(bodies.length, 0);
  await u.clear(minimum);
  await u.type(minimum, "800");
  await u.click(screen.getByRole("button", { name: "提交复核" }));
  await screen.findByText("已提交复核", { selector: "strong" });
  assert.deepEqual(bodies[0], { customer_bp: { late_15_29: 1250, late_30_plus: 5000, driver_no_show: 10000, vehicle_downgrade: 2000, no_signboard: 1000, not_delivered: 2500, service_complaint: 1000 }, minimum_jpy: 800, reimbursement_cap_bp: 15000, review_at_or_above_sell_bp: 5000, note: null });
});

test("赔付表：客服、财务看得到改不了（没有「修改赔付表」）", async () => {
  for (const role of ["customer_service", "finance"]) {
    openApp("/platform/compensation-table", "platform", role, (call) => (call.method === "GET" && call.url.pathname === "/platform/v1/compensation-table" ? json(200, { compensation_table: table, cancellation_policy: policy }) : null));
    await screen.findByText("你可以查看，但没有修改赔付表的权限。");
    assertAbsent(screen.queryByRole("button", { name: "修改赔付表" }));
    resetBrowser();
  }
});

const person = (id: string, name: string) => ({ id, name, email: `${name}@platform.example` });
const approvalOf = (changes: Partial<Approval>): Approval => ({
  id: "ap1",
  kind: "ticket.decision",
  resource: "ticket",
  resource_id: TICKET_ID,
  summary: "",
  payload: {},
  before: null,
  base_version: 1,
  status: "pending",
  requested_by: person(COLLEAGUE, "佐藤"),
  requested_at: stamps.created_at,
  request_note: null,
  decided_by: null,
  decided_at: null,
  decision_note: null,
  impact: null,
  can: { approve: true, reject: true, withdraw: false },
  ...changes,
});

test("待审核：工单判定、改赔付表、付款给供应商写出类别名、改了什么、去对象的链接；批准的确认框写效果", async () => {
  const approvals = [
    approvalOf({ summary: "工单 TK20261026K3M9Q2 判定成立：赔给客人 10890 JPY（最小单位），达到复核阈值", payload: { ticket_no: "TK20261026K3M9Q2", outcome: "upheld", compensation: { scenario: "late_30_plus", liable_party: "tenant" }, customer_compensation_minor: 10890, customer_refund_minor: 10890, customer_manual_payout_minor: 0, currency: "JPY" }, before: { status: "in_progress" } }),
    approvalOf({ id: "ap2", kind: "compensation_table.update", resource: "compensation_table", resource_id: "platform", summary: "修改客人赔付表：司机迟到 15–29 分钟 10% → 12.5%", payload: { rules: { customer_bp: { ...Object.fromEntries(table.scenarios.map((row) => [row.scenario, row.customer_bp])), late_15_29: 1250 }, minimum_jpy: 500, reimbursement_cap_bp: 15000, review_at_or_above_sell_bp: 5000 } }, before: { version: 0, rules: { customer_bp: Object.fromEntries(table.scenarios.map((row) => [row.scenario, row.customer_bp])), minimum_jpy: 500, reimbursement_cap_bp: 15000, review_at_or_above_sell_bp: 5000 } } }),
    approvalOf({ id: "ap3", kind: "statement.payout", resource: "statement", resource_id: STATEMENT_ID, summary: "付款给供应商「乙车队」", payload: { statement_no: "ST202609ABCDEFGH", period: "2026-09", tenant_name: "乙车队", total_minor: 38600, currency: "JPY", pay_due_on: "2026-10-20" }, requested_by: person(ME, "测试员工"), can: { approve: false, reject: false, withdraw: true } }),
  ];
  openApp("/platform/approvals", "platform", "super_admin", (call) => {
    if (call.method === "GET" && call.url.pathname === "/platform/v1/approvals") return json(200, { items: approvals, next_cursor: null, total: 3 });
    if (call.method === "GET" && call.url.pathname === "/platform/v1/channels") return json(200, { items: [], next_cursor: null, total: 0 });
    return null;
  });
  const u = user();
  const decision = (await screen.findByRole("heading", { name: "工单判定（赔付达到复核阈值）" })).closest("section") as HTMLElement;
  assert.equal(within(decision).getByRole("link", { name: "TK20261026K3M9Q2" }).getAttribute("href"), `/platform/tickets/${TICKET_ID}`);
  assert.ok(within(decision).getAllByText("JPY 10,890", { selector: "strong" }).length > 0);
  assert.ok(within(decision).getByText("司机迟到 30 分钟及以上 · 供应商"));
  const table2 = (screen.getByRole("heading", { name: "修改客人赔付表" })).closest("section") as HTMLElement;
  const row = within(table2).getByText("司机迟到 15–29 分钟（赔对外价）").closest("tr") as HTMLElement;
  assert.ok(within(row).getByText("10%"));
  assert.ok(within(row).getByText("12.5%"));
  assertAbsent(within(table2).queryByText("没送到目的地（赔对外价）"));
  const payout = (screen.getByRole("heading", { name: "付款给供应商" })).closest("section") as HTMLElement;
  assert.equal(within(payout).getByRole("link", { name: "ST202609ABCDEFGH" }).getAttribute("href"), `/platform/finance/statements/${STATEMENT_ID}`);
  assert.ok(within(payout).getByText("这是你发起的，要等另一位有审核权限的同事处理。"));
  await u.click(within(decision).getByRole("button", { name: /^批准/ }));
  const dialog = await screen.findByRole("dialog", { name: "批准：工单判定（赔付达到复核阈值）" });
  await waitFor(() => assert.match(dialog.textContent ?? "", /批准后按发起时的判定执行/));
});
