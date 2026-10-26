/**
 * 供应商后台工单（M4-03）的组件测试：等你们回复的醒目提示、回复（必填）、对不利判定的申诉（7 天内、一次）、从订单发起失物招领；
 * 规则 4：页面只显示接口给的——没有内部备注、客人那边的赔付金额、对外价；只读没有回复和申诉。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { ORDER_ID, TICKET_ID, openApp, tenantTicketDetailOf, tenantTicketOf } from "../../testing/order-center-fixtures.tsx";
import { apiError, assertAbsent, json, resetBrowser } from "../../testing/harness.tsx";

afterEach(resetBrowser);
const user = () => userEvent.setup();

test("列表：等你们回复的单写「等你们回复」；从订单进来只看这一单的", async () => {
  const calls = openApp(`/tickets?order=${ORDER_ID}&status=all`, "tenant", "dispatch", (call) =>
    call.method === "GET" && call.url.pathname === "/tenant/v1/tickets" ? json(200, { items: [tenantTicketOf()], next_cursor: null, total: 1 }) : null,
  );
  const region = await screen.findByRole("region", { name: "工单" });
  await within(region).findByText("等你们回复");
  const query = new URL(calls.find((call) => call.path.startsWith("/tenant/v1/tickets?"))?.path ?? "", "http://x").searchParams;
  assert.equal(query.get("order_id"), ORDER_ID);
  assert.equal(query.get("status"), null);
  assert.ok(screen.getByText("只看一张订单的"));
});

test("详情：平台的留言写「平台」；回复必填，回复后提交 body；没有内部备注和客人的赔付金额", async () => {
  const bodies: unknown[] = [];
  openApp(`/tickets/${TICKET_ID}`, "tenant", "dispatch", (call) => {
    if (call.method === "GET" && call.url.pathname === `/tenant/v1/tickets/${TICKET_ID}`) return json(200, tenantTicketDetailOf());
    if (call.method === "POST" && call.url.pathname === `/tenant/v1/tickets/${TICKET_ID}/messages`) {
      bodies.push(call.body);
      return json(201, tenantTicketDetailOf(tenantTicketOf({ status: "in_progress", tenant_replied_at: "2026-10-08T06:00:00.000Z" })));
    }
    return null;
  });
  const u = user();
  await screen.findByText("平台在等你们回复");
  assert.ok(screen.getByText("平台"));
  await u.click(screen.getByRole("button", { name: "回复" }));
  await screen.findByText("请写回复的内容");
  assert.equal(bodies.length, 0);
  await u.type(screen.getByLabelText("回复平台"), "司机 10:02 到达，见到达屏照片。");
  await u.click(screen.getByRole("button", { name: "回复" }));
  await waitFor(() => assert.deepEqual(bodies, [{ body: "司机 10:02 到达，见到达屏照片。", file_ids: [] }]));
  await screen.findByText("已回复平台");
  for (const text of [/内部备注/, /对外价/, /赔客人/, /退回原卡/]) assertAbsent(screen.queryByText(text));
});

test("对你们不利的判定：7 天内可以申诉一次，写理由后建「供应商申诉」工单并跳过去；只读看得到判定、没有申诉按钮", async () => {
  const decided = tenantTicketDetailOf(tenantTicketOf({ status: "decided", outcome: "upheld", liable_party: "tenant", decided_at: "2026-10-08T05:30:00.000Z", decision_note: "定位显示 10:35 到达", appeal_until: "2999-01-01T00:00:00.000Z", tenant_replied_at: "2026-10-07T00:00:00.000Z" }), {
    deductions: [{ id: "dd1", kind: "compensation", amount: { amount: "1980", currency: "JPY" }, status: "pending", basis: { ticket_no: "TK20261026K3M9Q2", scenario: "late_15_29", bp: 1000, settlement_minor: 19800, ratio_minor: 1980, downgrade_settlement_difference_minor: 0, table_version: 0 }, waived_at: null, waive_reason: null, created_at: "2026-10-08T05:30:00.000Z" }],
  });
  const APPEAL = "a9a9a9a9-aaaa-4aaa-8aaa-aaaaaaaaaaa9";
  const created: unknown[] = [];
  const route = (call: { method: string; url: URL; body: unknown }) => {
    if (call.method === "GET" && call.url.pathname === `/tenant/v1/tickets/${TICKET_ID}`) return json(200, decided);
    if (call.method === "GET" && call.url.pathname === `/tenant/v1/tickets/${APPEAL}`) return json(200, tenantTicketDetailOf(tenantTicketOf({ id: APPEAL, ticket_no: "TK20261027AAAAAA", type: "tenant_appeal", status: "open", parent_ticket_id: TICKET_ID, subject: "对工单 TK20261026K3M9Q2 的判定申诉" }), { messages: [] }));
    if (call.method === "POST" && call.url.pathname === "/tenant/v1/tickets") {
      created.push(call.body);
      return json(201, tenantTicketDetailOf(tenantTicketOf({ id: APPEAL, ticket_no: "TK20261027AAAAAA", type: "tenant_appeal", status: "open", parent_ticket_id: TICKET_ID })));
    }
    return null;
  };
  openApp(`/tickets/${TICKET_ID}`, "tenant", "finance", route);
  const u = user();
  await screen.findByText("这个判定对你们不利，可以申诉一次");
  assert.ok(screen.getByText("你们"), "责任方写「你们」");
  assert.ok(screen.getByText("客人赔付 JPY 1,980"));
  await u.click(screen.getByRole("button", { name: "申诉" }));
  const dialog = await screen.findByRole("dialog", { name: "对这个判定申诉" });
  await u.click(within(dialog).getByRole("button", { name: "提交申诉" }));
  await within(dialog).findByText(/请写为什么不同意/);
  await u.type(within(dialog).getByLabelText(/为什么不同意/), "司机 10:02 已到达，见到达屏照片。");
  await u.click(within(dialog).getByRole("button", { name: "提交申诉" }));
  await screen.findByRole("heading", { level: 1, name: "工单 TK20261027AAAAAA" });
  assert.deepEqual(created, [{ type: "tenant_appeal", order_id: null, parent_ticket_id: TICKET_ID, subject: "对工单 TK20261026K3M9Q2 的判定申诉", description: "司机 10:02 已到达，见到达屏照片。" }]);
  resetBrowser();
  openApp(`/tickets/${TICKET_ID}`, "tenant", "readonly", route);
  await screen.findByText("定位显示 10:35 到达");
  assertAbsent(screen.queryByRole("button", { name: "申诉" }));
});

test("申诉被拒（已经申诉过）：对话框写后端的原因，只剩「知道了」", async () => {
  openApp(`/tickets/${TICKET_ID}`, "tenant", "admin", (call) => {
    if (call.method === "GET" && call.url.pathname === `/tenant/v1/tickets/${TICKET_ID}`) return json(200, tenantTicketDetailOf(tenantTicketOf({ status: "decided", outcome: "upheld", liable_party: "tenant", decided_at: "2026-10-08T05:30:00.000Z", appeal_until: "2999-01-01T00:00:00.000Z" })));
    if (call.method === "POST" && call.url.pathname === "/tenant/v1/tickets") return apiError(409, "ALREADY_APPEALED", "这张工单的判定已经申诉过了（只能申诉一次）");
    return null;
  });
  const u = user();
  await u.click(await screen.findByRole("button", { name: "申诉" }));
  const dialog = await screen.findByRole("dialog", { name: "对这个判定申诉" });
  await u.type(within(dialog).getByLabelText(/为什么不同意/), "不同意");
  await u.click(within(dialog).getByRole("button", { name: "提交申诉" }));
  await within(dialog).findByText("这张工单的判定已经申诉过了（只能申诉一次）");
  assertAbsent(within(dialog).queryByRole("button", { name: "提交申诉" }));
  assert.ok(within(dialog).getByRole("button", { name: "知道了" }));
});

test("从订单发起失物招领：类型、标题、说明必填；没有订单时告诉人从订单详情发起；只读没有权限", async () => {
  const bodies: unknown[] = [];
  openApp(`/tickets/new?order=${ORDER_ID}`, "tenant", "dispatch", (call) => {
    if (call.method === "POST" && call.url.pathname === "/tenant/v1/tickets") {
      bodies.push(call.body);
      return json(201, tenantTicketDetailOf(tenantTicketOf({ type: "lost_and_found", status: "open" })));
    }
    if (call.method === "GET" && call.url.pathname === `/tenant/v1/tickets/${TICKET_ID}`) return json(200, tenantTicketDetailOf(tenantTicketOf({ type: "lost_and_found", status: "open" })));
    return null;
  });
  const u = user();
  await u.click(await screen.findByRole("button", { name: "发起工单" }));
  await screen.findByText("请选择类型");
  await u.click(screen.getByRole("radio", { name: /失物招领/ }));
  await u.type(screen.getByLabelText("标题"), "客人的黑色背包");
  await u.type(screen.getByLabelText(/说明/), "在后座，已放在营业所。");
  await u.click(screen.getByRole("button", { name: "发起工单" }));
  await waitFor(() => assert.deepEqual(bodies, [{ type: "lost_and_found", order_id: ORDER_ID, parent_ticket_id: null, subject: "客人的黑色背包", description: "在后座，已放在营业所。" }]));
  resetBrowser();
  openApp("/tickets/new", "tenant", "dispatch", () => null);
  await screen.findByText("请从订单详情发起");
  resetBrowser();
  openApp(`/tickets/new?order=${ORDER_ID}`, "tenant", "readonly", () => null);
  await screen.findByText("你没有权限查看这里");
});
