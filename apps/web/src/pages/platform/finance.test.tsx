/**
 * 财务结算（M4-03）的组件测试：运营后台的账单列表、手工出账（周期格式、出错的供应商列出来）、详情（按状态给答复、作废、发起付款复核；
 * 待审核时不能再发起）、付款批次锁定；供应商的账单确认和异议（必填、确认期过了的说法）；
 * 权限：只读看得到看不到按钮、限定了数据范围的 403 写清楚、供应商只读没有确认按钮。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { PayoutBatchDetail } from "../../api/billing.ts";
import { BATCH_ID, STATEMENT_ID, openApp, platformStatementDetailOf, platformStatementOf, tenantStatementDetailOf } from "../../testing/order-center-fixtures.tsx";
import { apiError, assertAbsent, json, resetBrowser } from "../../testing/harness.tsx";

afterEach(resetBrowser);
const user = () => userEvent.setup();

test("账单列表：合计带币种和千分位；手工出账的周期要写成 YYYY-MM，结果列出没出成的供应商", async () => {
  const generated: unknown[] = [];
  openApp("/platform/finance/statements", "platform", "finance", (call) => {
    if (call.method === "GET" && call.url.pathname === "/platform/v1/statements") return json(200, { items: [platformStatementOf()], next_cursor: null, total: 1 });
    if (call.method === "POST" && call.url.pathname === "/platform/v1/statements/generate") {
      generated.push(call.body);
      return json(200, { period: "2026-09", created: [platformStatementOf()], failed: [{ tenant: { id: "t9", name: "丙车队" }, code: "STATEMENT_LINES_INCONSISTENT", message: "出账后核对不通过，已回滚" }] });
    }
    return null;
  });
  const u = user();
  const region = await screen.findByRole("region", { name: "账单" });
  await within(region).findByText("JPY 38,600");
  assert.ok(within(region).getByText("2026 年 9 月"));
  await u.click(screen.getByRole("button", { name: "手工出账" }));
  const dialog = await screen.findByRole("dialog", { name: "手工出账" });
  await u.type(within(dialog).getByLabelText(/周期/), "2026/9");
  await u.click(within(dialog).getByRole("button", { name: "出账" }));
  await within(dialog).findByText(/周期写成 YYYY-MM/);
  assert.equal(generated.length, 0);
  await u.clear(within(dialog).getByLabelText(/周期/));
  await u.type(within(dialog).getByLabelText(/周期/), "2026-09");
  await u.click(within(dialog).getByRole("button", { name: "出账" }));
  await within(dialog).findByText("2026 年 9 月：新出了 1 张账单。");
  assert.ok(within(dialog).getByText("丙车队：出账后核对不通过，已回滚"));
  assert.deepEqual(generated, [{ period: "2026-09" }]);
});

test("账单详情（待复核）：财务能发起付款复核，提交后有待审核时不能再发起；作废要写原因", async () => {
  let current = platformStatementDetailOf(platformStatementOf({ status: "confirmed", confirmed_at: "2026-10-09T00:00:00.000Z", confirmed_by_type: "tenant_user" }));
  const posted: { path: string; body: unknown }[] = [];
  openApp(`/platform/finance/statements/${STATEMENT_ID}`, "platform", "finance", (call) => {
    if (call.method === "GET" && call.url.pathname === `/platform/v1/statements/${STATEMENT_ID}`) return json(200, { statement: current });
    if (call.method === "POST" && call.url.pathname.endsWith("/payout-approval")) {
      posted.push({ path: call.url.pathname, body: call.body });
      current = { ...current, pending_approval_id: "ap1" };
      return json(202, { approval: { id: "ap1" } });
    }
    return null;
  });
  const u = user();
  await screen.findByText("JPY 38,600", { selector: "strong" });
  assert.ok(screen.getAllByText("JPY -1,200").length > 0, "扣款是负数，负号在数字前");
  assert.ok(screen.getByText("往期调整"));
  assert.ok(screen.getAllByText("客人赔付").length > 0, "应扣款项的种类");
  await u.click(screen.getByRole("button", { name: "发起付款复核" }));
  const dialog = await screen.findByRole("dialog", { name: "发起付款复核" });
  await u.click(within(dialog).getByRole("button", { name: "提交复核" }));
  await screen.findByText("付款复核待审核");
  assert.deepEqual(posted[0]?.body, { note: null });
  assertAbsent(screen.queryByRole("button", { name: "发起付款复核" }));
  await u.click(screen.getByRole("button", { name: "作废并重出" }));
  const voiding = await screen.findByRole("dialog", { name: "作废这张账单并重出？" });
  await u.click(within(voiding).getByRole("button", { name: "作废并重出" }));
  await within(voiding).findByText("请写作废原因");
});

test("账单详情（有异议）：答复异议；后端拒绝时写清原因只剩「知道了」；只读看得到看不到按钮", async () => {
  const detail = platformStatementDetailOf(platformStatementOf({ status: "disputed", disputed_at: "2026-10-09T00:00:00.000Z", dispute_reason: "停车费没算进来" }));
  const route = (call: { method: string; url: URL }) => {
    if (call.method === "GET" && call.url.pathname === `/platform/v1/statements/${STATEMENT_ID}`) return json(200, { statement: detail });
    if (call.method === "POST" && call.url.pathname.endsWith("/reply")) return apiError(409, "STATEMENT_STATE_INVALID", "账单现在的状态不能做这一步", { status: "confirmed" });
    return null;
  };
  openApp(`/platform/finance/statements/${STATEMENT_ID}`, "platform", "finance", route);
  const u = user();
  await screen.findByText("停车费没算进来");
  await u.click(screen.getByRole("button", { name: "答复异议" }));
  const dialog = await screen.findByRole("dialog", { name: "答复供应商的异议" });
  await u.type(within(dialog).getByLabelText(/答复/), "停车费的票据没有上传，请补传后我们重出。");
  await u.click(within(dialog).getByRole("button", { name: "答复" }));
  await within(dialog).findByText(/账单的状态刚变了/);
  assert.ok(within(dialog).getByRole("button", { name: "知道了" }));
  resetBrowser();
  openApp(`/platform/finance/statements/${STATEMENT_ID}`, "platform", "readonly", route);
  await screen.findByText("你可以查看，但没有处理账单的权限。");
  assertAbsent(screen.queryByRole("button", { name: "答复异议" }));
  assertAbsent(screen.queryByRole("button", { name: "作废并重出" }));
});

test("限定了数据范围的员工：财务结算接口 403，页面说明为什么不能看", async () => {
  openApp("/platform/finance/statements", "platform", "custom_0123456789abcdef", (call) => (call.method === "GET" && call.url.pathname === "/platform/v1/statements" ? apiError(403, "DATA_SCOPE_DENIED", "限定了数据范围") : null), ["statement.read"]);
  await screen.findByText(/财务结算只给不限数据范围的账号用/);
});

test("付款批次：按币种分开写合计；锁定前要确认，锁定后不再显示按钮", async () => {
  const batch: PayoutBatchDetail = { id: BATCH_ID, pay_date: "2026-10-20", status: "open", created_at: "2026-10-09T00:00:00.000Z", closed_at: null, closed_by: null, paid_at: null, statement_count: 2, totals: [{ currency: "CNY", count: 1, total: { amount: "450.50", currency: "CNY" } }, { currency: "JPY", count: 1, total: { amount: "38600", currency: "JPY" } }], version: 1, statements: [platformStatementOf({ status: "in_payout", payout_batch_id: BATCH_ID, payout_on: "2026-10-20" })] };
  let closed = false;
  openApp(`/platform/finance/payout-batches/${BATCH_ID}`, "platform", "finance", (call) => {
    if (call.method === "GET" && call.url.pathname === `/platform/v1/payout-batches/${BATCH_ID}`) return json(200, { batch });
    if (call.method === "POST" && call.url.pathname.endsWith("/close")) {
      closed = true;
      return json(200, { batch: { ...batch, status: "closed", closed_at: "2026-10-10T00:00:00.000Z", closed_by: "22222222-2222-4222-8222-222222222222" } });
    }
    return null;
  });
  const u = user();
  await screen.findByText("CNY 450.50（1 张）");
  assert.ok(screen.getByText("JPY 38,600（1 张）"));
  await u.click(screen.getByRole("button", { name: "锁定批次" }));
  const dialog = await screen.findByRole("dialog", { name: "锁定 2026-10-20 的付款批次？" });
  await u.click(within(dialog).getByRole("button", { name: "锁定" }));
  await screen.findByText("已锁定，待转账");
  assert.equal(closed, true);
  assertAbsent(screen.queryByRole("button", { name: "锁定批次" }));
});

test("供应商：待确认的账单可以确认或提异议；异议原因必填；确认期过了说清楚；只读没有按钮；没有对外价", async () => {
  let current = tenantStatementDetailOf();
  const posted: { path: string; body: unknown }[] = [];
  const route = (call: { method: string; url: URL; body: unknown }) => {
    if (call.method === "GET" && call.url.pathname === `/tenant/v1/statements/${STATEMENT_ID}`) return json(200, { statement: current });
    if (call.method === "POST" && call.url.pathname.endsWith("/dispute")) {
      posted.push({ path: call.url.pathname, body: call.body });
      return apiError(409, "STATEMENT_CONFIRM_PERIOD_OVER", "确认期已过");
    }
    if (call.method === "POST" && call.url.pathname.endsWith("/confirm")) {
      posted.push({ path: call.url.pathname, body: call.body });
      current = tenantStatementDetailOf({ status: "confirmed", confirmed_at: "2026-10-09T00:00:00.000Z", confirmed_by_type: "tenant_user" });
      return json(200, { statement: current });
    }
    return null;
  };
  openApp(`/statements/${STATEMENT_ID}`, "tenant", "finance", route);
  const u = user();
  await screen.findByText("请核对并确认");
  await u.click(screen.getByRole("button", { name: "提异议" }));
  const dialog = await screen.findByRole("dialog", { name: "对这张账单提异议" });
  await u.click(within(dialog).getByRole("button", { name: "提交异议" }));
  await within(dialog).findByText("请写清楚哪一条不对、应该是多少");
  await u.type(within(dialog).getByLabelText(/哪里不对/), "停车费没算进来");
  await u.click(within(dialog).getByRole("button", { name: "提交异议" }));
  await within(dialog).findByText(/确认期已经过了，账单已视为确认/);
  await u.click(within(dialog).getByRole("button", { name: "知道了" }));
  await u.click(screen.getByRole("button", { name: "确认账单" }));
  const confirm = await screen.findByRole("dialog", { name: "确认这张账单？" });
  await u.click(within(confirm).getByRole("button", { name: "确认账单" }));
  await screen.findByText("已确认账单");
  await waitFor(() => assert.deepEqual(posted.map((entry) => entry.path.split("/").pop()), ["dispute", "confirm"]));
  assertAbsent(screen.queryByText(/对外价|加价/));
  resetBrowser();
  current = tenantStatementDetailOf();
  openApp(`/statements/${STATEMENT_ID}`, "tenant", "readonly", route);
  await screen.findByText(/没有确认账单的权限/);
  assertAbsent(screen.queryByRole("button", { name: "确认账单" }));
});
