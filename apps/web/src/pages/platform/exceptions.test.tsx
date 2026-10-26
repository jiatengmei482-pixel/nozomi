/**
 * 异常队列（M4-03）的组件测试：列表按网址里的条件查询；详情里认领、被别人抢先认领时的 409 提示、写说明关闭（必填）、转交；
 * 没有 `exception.manage` 的角色（风控、只读）看得到、看不到按钮；自建角色按 `auth/me` 的操作清单。接口用测试替身。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { COLLEAGUE, EXCEPTION_ID, ME, exceptionOf, openApp } from "../../testing/order-center-fixtures.tsx";
import { apiError, assertAbsent, json, resetBrowser } from "../../testing/harness.tsx";

afterEach(resetBrowser);
const user = () => userEvent.setup();

test("列表：默认看没关的；按类型、是否超时筛时带上网址参数；超时的标「已超时」，点进详情", async () => {
  const calls = openApp("/platform/exceptions?type=dispatch_overdue&overdue=true", "platform", "operations", (call) =>
    call.method === "GET" && call.url.pathname === "/platform/v1/exceptions" ? json(200, { items: [exceptionOf()], next_cursor: null, total: 1 }) : null,
  );
  const table = await screen.findByRole("region", { name: "异常队列" });
  await within(table).findByText("超时未派车");
  assert.ok(within(table).getByText("已超时"));
  const query = calls.find((call) => call.path.startsWith("/platform/v1/exceptions?"));
  assert.ok(query, "查询了异常");
  const params = new URL(query.path, "http://x").searchParams;
  assert.equal(params.get("status"), "active");
  assert.equal(params.get("type"), "dispatch_overdue");
  assert.equal(params.get("overdue"), "true");
  assert.equal(within(table).getByRole("link", { name: "超时未派车" }).getAttribute("href"), `/platform/exceptions/${EXCEPTION_ID}`);
});

test("列表：没有异常时是「现在没有要处理的异常」；加载失败有「重试」", async () => {
  let fail = true;
  openApp("/platform/exceptions", "platform", "customer_service", (call) => {
    if (call.method !== "GET" || call.url.pathname !== "/platform/v1/exceptions") return null;
    if (fail) {
      fail = false;
      return apiError(500, "INTERNAL_ERROR", "服务器出错");
    }
    return json(200, { items: [], next_cursor: null, total: 0 });
  });
  await user().click(await screen.findByRole("button", { name: "重试" }));
  await screen.findByText("现在没有要处理的异常");
});

test("详情：认领成功后由「你」处理，能转交和关闭；关闭的处理说明必填，写了才提交", async () => {
  let current = exceptionOf();
  const posted: { path: string; body: unknown }[] = [];
  openApp(`/platform/exceptions/${EXCEPTION_ID}`, "platform", "operations", (call) => {
    if (call.method === "GET" && call.url.pathname === `/platform/v1/exceptions/${EXCEPTION_ID}`) return json(200, { exception: current });
    if (call.method === "POST" && call.url.pathname.endsWith("/claim")) {
      posted.push({ path: call.url.pathname, body: call.body });
      current = exceptionOf({ status: "claimed", assignee: { id: ME, name: "测试员工" }, claimed_at: "2026-10-08T05:30:00.000Z" });
      return json(200, { exception: current });
    }
    if (call.method === "POST" && call.url.pathname.endsWith("/close")) {
      posted.push({ path: call.url.pathname, body: call.body });
      current = exceptionOf({ status: "closed", assignee: { id: ME, name: "测试员工" }, close_kind: "resolved", closed_at: "2026-10-08T06:00:00.000Z", closed_by: ME, resolution: "已电话催供应商，14:20 派车", overdue: false });
      return json(200, { exception: current });
    }
    return null;
  });
  const u = user();
  await screen.findByText("电话催租户；用车前 6 小时仍未派车，自动进入救援改派");
  await u.click(screen.getByRole("button", { name: "认领" }));
  await screen.findByRole("button", { name: "转交给同事" });
  assert.deepEqual(posted[0]?.body, { assignee_id: null });
  assert.ok(screen.getAllByText("你").length > 0);
  await u.click(screen.getByRole("button", { name: "写说明并关闭" }));
  const dialog = await screen.findByRole("dialog", { name: "关闭这条异常？" });
  await u.click(within(dialog).getByRole("button", { name: "关闭异常" }));
  await within(dialog).findByText("请写处理说明：做了什么、结果怎样");
  assert.equal(posted.length, 1, "没写说明不提交");
  await u.type(within(dialog).getByLabelText(/处理说明/), "已电话催供应商，14:20 派车");
  await u.click(within(dialog).getByRole("button", { name: "关闭异常" }));
  await screen.findByText("已关闭，不能再认领或修改。");
  assert.deepEqual(posted[1]?.body, { resolution: "已电话催供应商，14:20 派车" });
  assertAbsent(screen.queryByRole("button", { name: "写说明并关闭" }));
});

test("详情：已被别人认领时再认领，409 提示写明是谁在处理、请他转交，页面刷新成最新的样子", async () => {
  let claimed = false;
  openApp(`/platform/exceptions/${EXCEPTION_ID}`, "platform", "finance", (call) => {
    if (call.method === "GET" && call.url.pathname === `/platform/v1/exceptions/${EXCEPTION_ID}`) return json(200, { exception: claimed ? exceptionOf({ status: "claimed", assignee: { id: COLLEAGUE, name: "佐藤" } }) : exceptionOf({ type: "payment_issue", type_name: "支付异常", detail: { reason: "refund_failed", purpose: "cancellation", amount_minor: 21780, currency: "JPY" } }) });
    if (call.method === "POST" && call.url.pathname.endsWith("/claim")) {
      claimed = true;
      return apiError(409, "EXCEPTION_ALREADY_CLAIMED", "这条异常已经有人在处理；要转交请让现在的处理人操作", { assignee_id: COLLEAGUE });
    }
    return null;
  });
  const u = user();
  await screen.findByText("退款失败");
  assert.ok(screen.getByText("JPY 21,780"), "金额按币种和千分位写");
  await u.click(screen.getByRole("button", { name: "认领" }));
  const alert = await screen.findByText(/这条异常刚被「佐藤」认领了/);
  assert.match(alert.textContent ?? "", /转交给同事/);
  await screen.findByText(/「佐藤」正在处理/);
  assertAbsent(screen.queryByRole("button", { name: "认领" }));
  assertAbsent(screen.queryByRole("button", { name: "转交给同事" }));
});

test("权限：风控、只读能看不能处理（没有认领、关闭按钮）；自建角色勾了「异常队列 · 编辑」就有", async () => {
  const route = (call: { method: string; url: URL }) => (call.method === "GET" && call.url.pathname === `/platform/v1/exceptions/${EXCEPTION_ID}` ? json(200, { exception: exceptionOf() }) : null);
  for (const role of ["risk", "readonly"]) {
    openApp(`/platform/exceptions/${EXCEPTION_ID}`, "platform", role, route);
    await screen.findByText("你可以查看，但没有处理异常的权限。");
    assertAbsent(screen.queryByRole("button", { name: "认领" }));
    assertAbsent(screen.queryByRole("button", { name: "写说明并关闭" }));
    resetBrowser();
  }
  openApp(`/platform/exceptions/${EXCEPTION_ID}`, "platform", "custom_0123456789abcdef", route, ["order.read", "exception.manage"]);
  await screen.findByRole("button", { name: "认领" });
  resetBrowser();
  openApp("/platform/exceptions", "platform", "tenant_onboarding", () => null);
  await screen.findByText("你没有权限查看这里");
});

test("转交：从在用的同事里选，选好才提交；成功后 Toast 写交给了谁", async () => {
  let current = exceptionOf({ status: "claimed", assignee: { id: ME, name: "测试员工" } });
  const bodies: unknown[] = [];
  openApp(`/platform/exceptions/${EXCEPTION_ID}`, "platform", "customer_service", (call) => {
    if (call.method === "GET" && call.url.pathname === `/platform/v1/exceptions/${EXCEPTION_ID}`) return json(200, { exception: current });
    if (call.method === "POST" && call.url.pathname.endsWith("/claim")) {
      bodies.push(call.body);
      current = exceptionOf({ status: "claimed", assignee: { id: COLLEAGUE, name: "佐藤" } });
      return json(200, { exception: current });
    }
    return null;
  });
  const u = user();
  await u.click(await screen.findByRole("button", { name: "转交给同事" }));
  const dialog = await screen.findByRole("dialog", { name: "转交给同事" });
  await u.click(within(dialog).getByRole("button", { name: "转交" }));
  await within(dialog).findByText("请选择交给谁");
  await u.selectOptions(within(dialog).getByLabelText(/交给谁/), COLLEAGUE);
  await u.click(within(dialog).getByRole("button", { name: "转交" }));
  await waitFor(() => assert.deepEqual(bodies, [{ assignee_id: COLLEAGUE }]));
  await screen.findByText("已交给「佐藤」");
});
