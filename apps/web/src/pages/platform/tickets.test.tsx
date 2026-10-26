/**
 * 运营后台工单（M4-03）的组件测试：列表、新建（关联订单、必填校验）、详情（对话和内部备注分开、留言、征求意见、
 * 判定：成立要先试算、达到复核阈值时提交复核（202）、关闭的说明必填、财务登记另付）；权限：只读没有按钮、没有 `payment.manage` 看不到登记另付。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { PlatformOrder, PlatformOrderDetail } from "../../api/order-money.ts";
import { COLLEAGUE, ME, ORDER_ID, TENANT_ID, TICKET_ID, compensationOf, openApp, platformTicketDetailOf, platformTicketOf } from "../../testing/order-center-fixtures.tsx";
import { apiError, assertAbsent, json, resetBrowser } from "../../testing/harness.tsx";

afterEach(resetBrowser);
const user = () => userEvent.setup();
const money = (amount: string) => ({ amount, currency: "JPY" });

test("列表：默认看没有结论的；处理人写名字；超时、紧急的另标徽标；只读没有「新建工单」", async () => {
  const route = (call: { method: string; url: URL }) =>
    call.method === "GET" && call.url.pathname === "/platform/v1/tickets"
      ? json(200, { items: [platformTicketOf({ assignee_id: COLLEAGUE, overdue: true, priority: "urgent" })], next_cursor: null, total: 1 })
      : null;
  const calls = openApp("/platform/tickets", "platform", "customer_service", route);
  const region = await screen.findByRole("region", { name: "工单" });
  await within(region).findByText("TK20261026K3M9Q2");
  assert.ok(within(region).getByText("佐藤"));
  assert.ok(within(region).getByText("已超时"));
  assert.ok(within(region).getByText("紧急"));
  assert.equal(new URL(calls.find((call) => call.path.startsWith("/platform/v1/tickets?"))?.path ?? "", "http://x").searchParams.get("status"), "active");
  assert.ok(screen.getByRole("link", { name: "新建工单" }));
  resetBrowser();
  openApp("/platform/tickets", "platform", "readonly", route);
  await screen.findByText("你可以查看工单，但不能处理。");
  assertAbsent(screen.queryByRole("link", { name: "新建工单" }));
});

const orderOf = (changes: Record<string, unknown> = {}): PlatformOrder =>
  ({
    id: ORDER_ID,
    order_no: "NZ20261007ABCDEFGH",
    status: "completed",
    category: "airport_transfer",
    service_local: "2026-10-20T10:00",
    service_time: "2026-10-20T01:00:00.000Z",
    timezone: "Asia/Tokyo",
    tenant: { id: TENANT_ID, name: "乙车队" },
    channel: { id: "ch1", name: "官网" },
    sell: money("21780"),
    settlement: { total: money("19800") },
    ...changes,
  }) as unknown as PlatformOrder;
const orderDetail = (): PlatformOrderDetail => ({ order: orderOf(), events: [], payments: [], refunds: [], changes: [], extra_charges: [], rescues: [], exceptions: [], tickets: [] });

test("新建：从订单进来带着订单；类型、标题、经过必填；提交后去工单详情", async () => {
  const bodies: unknown[] = [];
  openApp(`/platform/tickets/new?order=${ORDER_ID}`, "platform", "customer_service", (call) => {
    if (call.method === "GET" && call.url.pathname === `/platform/v1/orders/${ORDER_ID}`) return json(200, orderDetail());
    if (call.method === "POST" && call.url.pathname === "/platform/v1/tickets") {
      bodies.push(call.body);
      return json(201, platformTicketDetailOf());
    }
    if (call.method === "GET" && call.url.pathname === `/platform/v1/tickets/${TICKET_ID}`) return json(200, platformTicketDetailOf());
    return null;
  });
  const u = user();
  await screen.findByRole("link", { name: "NZ20261007ABCDEFGH" });
  await u.click(screen.getByRole("button", { name: "新建工单" }));
  await screen.findByText("请选择工单类型");
  assert.ok(screen.getByText("请写标题"));
  assert.equal(bodies.length, 0);
  await u.click(screen.getByRole("radio", { name: /客人投诉/ }));
  await u.selectOptions(screen.getByLabelText("谁提出的"), "guest");
  await u.type(screen.getByLabelText("标题"), "司机迟到 25 分钟");
  await u.type(screen.getByLabelText(/经过/), "客人来电说司机 10:25 才到。");
  await u.click(screen.getByRole("button", { name: "新建工单" }));
  await waitFor(() => assert.equal(bodies.length, 1, document.querySelector("[role=alert]")?.textContent ?? "没有提交"));
  await screen.findByRole("heading", { level: 1, name: "工单 TK20261026K3M9Q2" });
  assert.deepEqual(bodies[0], { type: "complaint", order_id: ORDER_ID, tenant_id: null, source: "guest", priority: null, subject: "司机迟到 25 分钟", description: "客人来电说司机 10:25 才到。", language: null });
});

test("新建：还没付款的订单——按订单号查找时就说付款完成后才能建工单；带着订单进来也一样，没有表单", async () => {
  const unpaid = orderOf({ status: "pending_payment", confirmed_at: null });
  openApp("/platform/tickets/new", "platform", "customer_service", (call) => (call.method === "GET" && call.url.pathname === "/platform/v1/orders" ? json(200, { items: [{ ...unpaid, open_exceptions: 0 }], next_cursor: null }) : null));
  const u = user();
  await u.type(await screen.findByLabelText("订单号"), "NZ20261007ABCDEFGH");
  await u.click(screen.getByRole("button", { name: "查找" }));
  assert.ok(await screen.findByText("这张订单还没付款，付款完成后才能建工单。"));
  assertAbsent(screen.queryByLabelText("标题"));

  resetBrowser();
  openApp(`/platform/tickets/new?order=${ORDER_ID}`, "platform", "customer_service", (call) => (call.method === "GET" && call.url.pathname === `/platform/v1/orders/${ORDER_ID}` ? json(200, { ...orderDetail(), order: orderOf({ status: "cancelled", confirmed_at: null }) }) : null));
  assert.ok(await screen.findByText("这张订单没有付过款就取消了，不能建工单。"));
  assertAbsent(screen.queryByRole("button", { name: "新建工单" }));
  assert.equal(screen.getByRole("link", { name: "回到订单" }).getAttribute("href"), `/platform/orders/${ORDER_ID}`);
});

test("详情：对话（供应商看得到）和内部备注分开；留言、加备注发给不同的 internal；征求意见要写内容", async () => {
  const bodies: { path: string; body: unknown }[] = [];
  openApp(`/platform/tickets/${TICKET_ID}`, "platform", "operations", (call) => {
    if (call.method === "GET" && call.url.pathname === `/platform/v1/tickets/${TICKET_ID}`) return json(200, platformTicketDetailOf());
    if (call.method === "POST") {
      bodies.push({ path: call.url.pathname, body: call.body });
      return json(call.url.pathname.endsWith("/messages") ? 201 : 200, platformTicketDetailOf(platformTicketOf({ status: call.url.pathname.endsWith("/request-reply") ? "awaiting_tenant" : "in_progress", tenant_reply_due_at: "2999-01-01T00:00:00.000Z" })));
    }
    return null;
  });
  const u = user();
  const messages = await screen.findByRole("region", { name: "和供应商的对话" }).catch(() => screen.getByText("和供应商的对话").closest("section") as HTMLElement);
  assert.ok(within(messages).getByText("司机 10:02 已到达。"));
  assertAbsent(within(messages).queryByText("客人第二次投诉，留意语气。"));
  const notes = screen.getByText("内部备注", { selector: "h2" }).closest("section") as HTMLElement;
  assert.ok(within(notes).getByText("客人第二次投诉，留意语气。"));
  await u.type(within(messages).getByLabelText("发给供应商的话"), "我们正在核实。");
  await u.click(within(messages).getByRole("button", { name: "发给供应商" }));
  await u.type(within(notes).getByLabelText("内部备注"), "已打电话给调度。");
  await u.click(within(notes).getByRole("button", { name: "加备注" }));
  await waitFor(() => assert.equal(bodies.length, 2));
  assert.deepEqual(bodies.map((entry) => entry.body), [{ body: "我们正在核实。", internal: false }, { body: "已打电话给调度。", internal: true }]);
  await u.click(screen.getByRole("button", { name: "征求供应商意见" }));
  const dialog = await screen.findByRole("dialog", { name: "征求供应商意见" });
  await u.click(within(dialog).getByRole("button", { name: "发给供应商" }));
  await within(dialog).findByText("请写问供应商什么");
  await u.type(within(dialog).getByLabelText(/问供应商什么/), "请提供司机到达的定位截图");
  await u.click(within(dialog).getByRole("button", { name: "发给供应商" }));
  await waitFor(() => assert.equal(bodies.at(-1)?.path, `/platform/v1/tickets/${TICKET_ID}/request-reply`));
  await screen.findByText(/在等供应商回复/);
});

test("判定：成立要选情形和责任方并先试算；赔付达到复核阈值时按钮写「提交复核」，提交后工单是「判定待复核」", async () => {
  let current = platformTicketDetailOf();
  const decided: unknown[] = [];
  openApp(`/platform/tickets/${TICKET_ID}`, "platform", "customer_service", (call) => {
    if (call.method === "GET" && call.url.pathname === `/platform/v1/tickets/${TICKET_ID}`) return json(200, current);
    if (call.method === "GET" && call.url.pathname === `/platform/v1/orders/${ORDER_ID}`) return json(200, orderDetail());
    if (call.method === "POST" && call.url.pathname.endsWith("/compensation-quote")) {
      return json(200, {
        quote: {
          scenario: "late_30_plus",
          scenario_name: "司机迟到 30 分钟及以上",
          liable_party: "tenant",
          table_version: 0,
          customer_bp: 5000,
          customer: { ratio_amount: money("10890"), downgrade_difference: money("0"), minimum: money("500"), topped_up: false, compensation: money("10890"), reimbursement_cap: money("0"), reimbursement: money("0"), refund: money("10890"), manual_payout: money("0") },
          tenant: { ratio_amount: money("9900"), downgrade_difference: money("0"), reimbursement: money("0"), total: money("9900") },
          order_will_be_cancelled: false,
          needs_review: true,
        },
      });
    }
    if (call.method === "POST" && call.url.pathname.endsWith("/decide")) {
      decided.push(call.body);
      current = platformTicketDetailOf(platformTicketOf({ status: "pending_review", approval_id: "a1" }));
      return json(202, current);
    }
    return null;
  });
  const u = user();
  await u.click(await screen.findByRole("button", { name: "判定" }));
  const dialog = await screen.findByRole("dialog", { name: "判定：客人投诉" });
  await u.click(within(dialog).getByRole("radio", { name: "成立" }));
  await u.click(within(dialog).getByRole("button", { name: "确认判定" }));
  await within(dialog).findByText("请选择是哪种问题");
  assert.equal(decided.length, 0);
  await u.selectOptions(within(dialog).getByLabelText(/是哪种问题/), "late_30_plus");
  await u.click(within(dialog).getByRole("radio", { name: /供应商（乙车队）/ }));
  await u.type(within(dialog).getByLabelText(/判定说明/), "司机定位显示 10:35 到达。");
  await u.click(within(dialog).getByRole("button", { name: "确认判定" }));
  await within(dialog).findByText("成立的要先点「试算」，看过赔多少再提交");
  await u.click(within(dialog).getByRole("button", { name: "试算" }));
  await waitFor(() => assert.ok(within(dialog).getAllByText("JPY 10,890").length > 0));
  assert.ok(within(dialog).getByText(/达到了复核阈值/));
  await u.click(within(dialog).getByRole("button", { name: "提交复核" }));
  await screen.findByText("判定已提交复核：另一位同事批准后才执行");
  assert.deepEqual(decided[0], { outcome: "upheld", note: "司机定位显示 10:35 到达。", compensation: { scenario: "late_30_plus", liable_party: "tenant", downgrade_settlement_difference: null, reimbursement_amount: null, major: false }, driver_absent: false });
  await screen.findByText("判定待复核", { selector: "strong" });
});

test("判定被规则拒绝（还在等供应商回复）：对话框写原因，去掉确认按钮，「取消」改成「知道了」", async () => {
  openApp(`/platform/tickets/${TICKET_ID}`, "platform", "operations", (call) => {
    if (call.method === "GET" && call.url.pathname === `/platform/v1/tickets/${TICKET_ID}`) return json(200, platformTicketDetailOf(platformTicketOf({ type: "order_change" })));
    if (call.method === "POST" && call.url.pathname.endsWith("/decide")) return apiError(409, "TENANT_REPLY_PENDING", "还在等供应商回复");
    return null;
  });
  const u = user();
  await u.click(await screen.findByRole("button", { name: "判定" }));
  const dialog = await screen.findByRole("dialog", { name: "判定：修改订单" });
  await u.type(within(dialog).getByLabelText(/判定说明/), "已改好航班号。");
  await u.click(within(dialog).getByRole("button", { name: "确认判定" }));
  await within(dialog).findByText(/还在等供应商回复（24 小时内）/);
  assertAbsent(within(dialog).queryByRole("button", { name: "确认判定" }));
  assert.ok(within(dialog).getByRole("button", { name: "知道了" }));
});

test("赔付：运营后台看得到客人那边的金额；待另付的只有 `payment.manage`（财务、运营）能登记，凭证号必填", async () => {
  const detail = platformTicketDetailOf(platformTicketOf({ status: "decided", outcome: "upheld", liable_party: "tenant", decided_by: COLLEAGUE, decided_at: "2026-10-08T05:30:00.000Z", decision_note: "成立", appeal_until: "2999-01-01T00:00:00.000Z" }), {
    compensation: { ...compensationOf(), manual_payout: money("3000"), payout_status: "pending" },
    deductions: [{ id: "dd1", kind: "compensation", amount: money("1980"), status: "pending", basis: { ticket_no: "TK20261026K3M9Q2", scenario: "late_15_29", bp: 1000, settlement_minor: 19800, ratio_minor: 1980, downgrade_settlement_difference_minor: 0, table_version: 0 }, waived_at: null, waive_reason: null, created_at: "2026-10-08T05:30:00.000Z" }],
  });
  const paid: unknown[] = [];
  const route = (call: { method: string; url: URL; body: unknown }) => {
    if (call.method === "GET" && call.url.pathname === `/platform/v1/tickets/${TICKET_ID}`) return json(200, detail);
    if (call.method === "POST" && call.url.pathname.endsWith("/payout")) {
      paid.push(call.body);
      return json(200, { ...detail, compensation: { ...compensationOf(), manual_payout: money("3000"), payout_status: "paid", payout_reference: "BANK-001" } });
    }
    return null;
  };
  openApp(`/platform/tickets/${TICKET_ID}`, "platform", "finance", route);
  const u = user();
  await screen.findByText("赔客人合计");
  assert.ok(screen.getAllByText("JPY 2,178").length > 0);
  assert.ok(screen.getByText(/客人赔付 JPY 1,980/));
  assert.ok(screen.getByText(/结算价 19,800 JPY × 10%/), "供应商承担的依据");
  assert.ok(screen.getAllByText("佐藤").length > 0, "判定人写名字");
  assertAbsent(screen.queryByRole("button", { name: "判定" }));
  await u.click(screen.getByRole("button", { name: "登记另付已付" }));
  const dialog = await screen.findByRole("dialog", { name: "登记另付已付" });
  await u.click(within(dialog).getByRole("button", { name: "登记" }));
  await within(dialog).findByText("请填银行转账的凭证号或流水号");
  await u.type(within(dialog).getByLabelText(/转账凭证号/), "BANK-001");
  await u.click(within(dialog).getByRole("button", { name: "登记" }));
  await screen.findByText(/已另付（凭证 BANK-001）/);
  assert.deepEqual(paid, [{ reference: "BANK-001" }]);
  resetBrowser();
  openApp(`/platform/tickets/${TICKET_ID}`, "platform", "customer_service", route);
  await screen.findByText("赔客人合计");
  assertAbsent(screen.queryByRole("button", { name: "登记另付已付" }));
  assert.ok(screen.getByRole("button", { name: "关闭工单" }));
  resetBrowser();
  openApp(`/platform/tickets/${TICKET_ID}`, "platform", "readonly", route);
  await screen.findByText("你可以查看，但没有处理工单的权限。");
  assertAbsent(screen.queryByRole("button", { name: "关闭工单" }));
  assertAbsent(screen.queryByRole("textbox", { name: "内部备注" }));
  void ME;
});

test("回复客人（M4-03）：客人、渠道提的工单有「回复客人」，发出去带 to_guest；客人的回复和内部备注分开列；客服自己建的工单没有这一块", async () => {
  const bodies: unknown[] = [];
  const withReply = platformTicketDetailOf(platformTicketOf({ source: "guest" }), {
    notes: [
      { id: "n1", author: { id: COLLEAGUE, name: "佐藤" }, body: "客人第二次投诉，留意语气。", to_guest: false, created_at: "2026-10-08T05:30:00.000Z" },
      { id: "n2", author: { id: COLLEAGUE, name: "佐藤" }, body: "我们正在核实，24 小时内答复您。", to_guest: true, created_at: "2026-10-08T05:40:00.000Z" },
    ],
  });
  openApp(`/platform/tickets/${TICKET_ID}`, "platform", "customer_service", (call) => {
    if (call.method === "GET" && call.url.pathname === `/platform/v1/tickets/${TICKET_ID}`) return json(200, withReply);
    if (call.method === "POST" && call.url.pathname.endsWith("/messages")) {
      bodies.push(call.body);
      return json(201, withReply);
    }
    return null;
  });
  const u = user();
  const section = (await screen.findByRole("heading", { name: "回复客人" })).closest("section") as HTMLElement;
  assert.ok(within(section).getByText("我们正在核实，24 小时内答复您。"));
  assertAbsent(within(section).queryByText("客人第二次投诉，留意语气。"));
  const notes = screen.getByText("内部备注", { selector: "h2" }).closest("section") as HTMLElement;
  assertAbsent(within(notes).queryByText("我们正在核实，24 小时内答复您。"));
  await u.type(within(section).getByLabelText("给客人的回复"), "已核实司机迟到，补偿会退回您的银行卡。");
  await u.click(within(section).getByRole("button", { name: "回复客人" }));
  await waitFor(() => assert.deepEqual(bodies, [{ body: "已核实司机迟到，补偿会退回您的银行卡。", internal: false, to_guest: true }]));
  resetBrowser();
  openApp(`/platform/tickets/${TICKET_ID}`, "platform", "customer_service", (call) => (call.method === "GET" && call.url.pathname === `/platform/v1/tickets/${TICKET_ID}` ? json(200, platformTicketDetailOf(platformTicketOf({ source: "platform" }))) : null));
  await screen.findByText("内部备注", { selector: "h2" });
  assertAbsent(screen.queryByRole("heading", { name: "回复客人" }));
});
