/**
 * 通知中心页面的组件测试（M4-08，ADR 0049）：运营后台的记录（筛选、失败原因、重试、权限、邮件没配置时的提示、打码）、模板；供应商后台的免打扰和记录。
 * 接口用测试替身；真实后端由 apps/api/src/notifications.itest.ts 覆盖。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../App.tsx";
import type { NotificationRow } from "../../api/notifications.ts";
import { type ApiCall, apiError, assertAbsent, json, resetBrowser, signIn, stubApiWith } from "../../testing/harness.tsx";

afterEach(resetBrowser);

const stamps = { created_at: "2026-10-06T00:12:00.000Z", updated_at: "2026-10-08T05:30:00.000Z" };
const ORDER_ID = "0a0a0a0a-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ROW_ID = "f1f1f1f1-ffff-4fff-8fff-ffffffffffff";
const platformMe = (role: string) => json(200, { user: { id: "p1", email: "staff@platform.example", name: "测试员工", role, status: "active", ...stamps }, permissions: [], must_change_password: false });
const tenantMe = (role: string) => json(200, { user: { id: "u1", email: "user@supplier.example", name: "测试用户", role, status: "active", ...stamps }, tenant: { id: "t1", name: "测试用供应商", status: "active", ...stamps }, permissions: [], must_change_password: false });

const rowOf = (changes: Partial<NotificationRow> = {}): NotificationRow => ({
  id: ROW_ID,
  event: "order.confirmed",
  audience: "guest",
  locale: "zh-CN",
  channel: "email",
  recipient: "gu***@example.com",
  order: { id: ORDER_ID, order_no: "NZ20261007ABCDEFGH" },
  status: "failed",
  attempts: 6,
  last_error: { code: "UNREACHABLE", message: "连不上邮件服务器" },
  retryable: true,
  next_attempt_at: null,
  expires_at: "2026-10-20T01:00:00.000Z",
  sent_at: null,
  ...stamps,
  ...changes,
});

function openPlatform(path: string, role: string, respond: (call: ApiCall & { url: URL }) => Response | null): ApiCall[] {
  signIn("platform");
  const calls = stubApiWith((call) => (call.url.pathname === "/platform/v1/auth/me" ? platformMe(role) : respond(call)));
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  return calls;
}

function openTenant(path: string, role: string, respond: (call: ApiCall & { url: URL }) => Response | null): ApiCall[] {
  signIn("tenant");
  const calls = stubApiWith((call) => (call.url.pathname === "/tenant/v1/auth/me" ? tenantMe(role) : respond(call)));
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  return calls;
}

const urlOf = (call: ApiCall): URL => new URL(call.path, "http://localhost");

async function tableNamed(name: string): Promise<HTMLElement> {
  return screen.findByRole("region", { name });
}

const list = (items: NotificationRow[], summary = { mail_configured: true, waiting: 0 }) => json(200, { items, next_cursor: null, total: items.length, summary });

test("运营后台：失败原因、打码的收件人、重试成功后刷新；筛选写进请求", async () => {
  let current = rowOf();
  const calls = openPlatform("/platform/notifications", "operations", (call) => {
    if (call.url.pathname === "/platform/v1/notifications") return list([current]);
    if (call.url.pathname === `/platform/v1/notifications/${ROW_ID}/retry`) {
      current = rowOf({ status: "sent", sent_at: stamps.updated_at, last_error: null, retryable: false, attempts: 7 });
      return json(200, { notification: current });
    }
    return null;
  });
  const table = await tableNamed("通知记录");
  assert.ok(await within(table).findByText("gu***@example.com"));
  assert.ok(within(table).getByText("连不上邮件服务器"));
  assert.ok(within(table).getByText("订单确认"));
  const actor = userEvent.setup();
  await actor.click(within(table).getByRole("button", { name: "重试" }));
  await waitFor(() => assert.ok(calls.some((call) => call.method === "POST" && urlOf(call).pathname.endsWith("/retry"))));
  await within(table).findByText(/邮件服务器已接收/);
  assertAbsent(within(table).queryByRole("button", { name: "重试" }));

  await actor.selectOptions(screen.getByLabelText("接收方"), "tenant");
  await waitFor(() => assert.ok(calls.some((call) => urlOf(call).pathname === "/platform/v1/notifications" && urlOf(call).searchParams.get("audience") === "tenant")));
  await actor.type(screen.getByLabelText("订单号"), "NZ20261007ABCDEFGH");
  await actor.click(screen.getByRole("button", { name: "查找" }));
  await waitFor(() => assert.ok(calls.some((call) => urlOf(call).searchParams.get("order_no") === "NZ20261007ABCDEFGH")));
});

test("运营后台：邮件没配置时页面顶上说清楚，等待中的不显示重试，过期时间看得到", async () => {
  openPlatform("/platform/notifications", "operations", (call) => (call.url.pathname === "/platform/v1/notifications" ? list([rowOf({ status: "pending", attempts: 0, retryable: false, next_attempt_at: stamps.updated_at, last_error: { code: "NOT_CONFIGURED", message: null } })], { mail_configured: false, waiting: 3 }) : null));
  await screen.findByText(/3 条通知在等待/);
  const table = await tableNamed("通知记录");
  assert.ok(await within(table).findByText("邮件发送还没有配置，配好后自动发送"));
  assert.ok(within(table).getByText(/不再发送$/));
  assertAbsent(within(table).queryByRole("button", { name: "重试" }));
});

test("运营后台：从订单进来只看这一单；过期且订单情况变了的不能重试", async () => {
  const calls = openPlatform(`/platform/notifications?order=${ORDER_ID}&status=all`, "customer_service", (call) => (call.url.pathname === "/platform/v1/notifications" ? list([rowOf({ status: "expired", attempts: 0, retryable: false, last_error: { code: "ORDER_STATE_CHANGED", message: null } })]) : null));
  const table = await tableNamed("通知记录");
  assert.ok(await within(table).findByText("订单情况变了，再发只会误导，不再发送"));
  assertAbsent(within(table).queryByRole("button", { name: "重试" }));
  assert.equal(calls.find((call) => urlOf(call).pathname === "/platform/v1/notifications")?.path.includes(`order_id=${ORDER_ID}`), true);
  assert.ok(screen.getByText(/只看这一单的通知/));
});

test("运营后台：没有权限的角色页面说没权限，也不去请求接口；菜单里没有", async () => {
  const calls = openPlatform("/platform/notifications", "finance", () => null);
  await screen.findByText("你没有权限查看这里");
  assert.ok(!calls.some((call) => urlOf(call).pathname === "/platform/v1/notifications"));
  assertAbsent(screen.queryByRole("button", { name: "通知中心" }));
});

test("运营后台：重试被拒说清楚原因", async () => {
  openPlatform("/platform/notifications", "operations", (call) => {
    if (call.url.pathname === "/platform/v1/notifications") return list([rowOf()]);
    if (call.url.pathname.endsWith("/retry")) return apiError(409, "MAIL_NOT_CONFIGURED", "邮件发送还没有配置");
    return null;
  });
  const table = await tableNamed("通知记录");
  await userEvent.setup().click(await within(table).findByRole("button", { name: "重试" }));
  await screen.findByText(/邮件发送还没有配置/);
});

test("模板页：只读，看得到事件 × 接收方 × 语言 × 通道", async () => {
  openPlatform("/platform/notification-templates", "operations", (call) => (call.url.pathname === "/platform/v1/notification-templates" ? json(200, { items: [{ event: "order.confirmed", audience: "tenant", locale: "zh-CN", channel: "email", subject: "新订单：{{order_no}}", body: "正文", variables: ["order_no"] }] }) : null));
  const table = await tableNamed("通知模板");
  await within(table).findByText("订单确认");
  for (const text of ["订单确认", "供应商", "简体中文", "邮件", "新订单：{{order_no}}"]) assert.ok(within(table).getByText(text), text);
  assertAbsent(screen.queryByRole("button", { name: "保存" }));
});

const settingsRoute = (version = 0, hours: { start: string; end: string } | null = null) => json(200, { quiet_hours: hours, time_zone: "Asia/Tokyo", version });

test("供应商后台：管理员设免打扰（校验、请求体、版本）；记录不显示接收方列，没有重试", async () => {
  const calls = openTenant("/settings/notifications", "admin", (call) => {
    if (call.url.pathname === "/tenant/v1/notifications") return json(200, { items: [rowOf({ audience: "tenant", recipient: "ad***@market.test", retryable: false })], next_cursor: null, total: 1 });
    if (call.url.pathname === "/tenant/v1/notification-settings") return call.method === "PUT" ? settingsRoute(1, { start: "22:00", end: "07:00" }) : settingsRoute();
    return null;
  });
  const table = await tableNamed("发送记录");
  assert.ok(await within(table).findByText("ad***@market.test"));
  assertAbsent(within(table).queryByRole("columnheader", { name: "接收方" }));
  assertAbsent(within(table).queryByRole("button", { name: "重试" }));
  const actor = userEvent.setup();
  const start = await screen.findByLabelText("开始");
  await actor.type(start, "22:00");
  await actor.click(screen.getByRole("button", { name: "保存" }));
  await screen.findByText(/开始和结束要一起填/);
  await actor.type(screen.getByLabelText("结束"), "22:00");
  await actor.click(screen.getByRole("button", { name: "保存" }));
  await screen.findByText(/不能是同一个时间/);
  const end = screen.getByLabelText("结束") as HTMLInputElement;
  await actor.clear(end);
  await actor.type(end, "07:00");
  await actor.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() => {
    const put = calls.find((call) => call.method === "PUT");
    assert.deepEqual(put?.body, { quiet_hours: { start: "22:00", end: "07:00" } });
  });
});

test("供应商后台：调度只能看免打扰，不能改；商品价格角色没有入口和权限", async () => {
  openTenant("/settings/notifications", "dispatch", (call) => {
    if (call.url.pathname === "/tenant/v1/notifications") return json(200, { items: [], next_cursor: null, total: 0 });
    if (call.url.pathname === "/tenant/v1/notification-settings") return settingsRoute(2, { start: "22:00", end: "07:00" });
    return null;
  });
  await screen.findByText("只有管理员能改。");
  assert.equal((screen.getByLabelText("开始") as HTMLInputElement).value, "22:00");
  assertAbsent(screen.queryByRole("button", { name: "保存" }));
  await screen.findByText("还没有发给你们的通知");
});

test("供应商后台：没有权限的角色页面说没权限", async () => {
  const calls = openTenant("/settings/notifications", "pricing", () => null);
  await screen.findByText("你没有权限查看这里");
  assert.ok(!calls.some((call) => urlOf(call).pathname.startsWith("/tenant/v1/notification")));
});

test("供应商后台：能按状态筛发送记录；运营后台有坏事件时给出提示", async () => {
  const calls = openTenant("/settings/notifications", "admin", (call) => {
    if (call.url.pathname === "/tenant/v1/notifications") return json(200, { items: [], next_cursor: null, total: 0 });
    if (call.url.pathname === "/tenant/v1/notification-settings") return settingsRoute();
    return null;
  });
  await screen.findByText("还没有发给你们的通知");
  await userEvent.setup().selectOptions(screen.getByLabelText("状态"), "failed");
  await waitFor(() => assert.ok(calls.some((call) => urlOf(call).pathname === "/tenant/v1/notifications" && urlOf(call).searchParams.get("status") === "failed")));
});

test("运营后台：有展开失败的事件时红色提示，让运营转给技术", async () => {
  openPlatform("/platform/notifications", "operations", (call) => (call.url.pathname === "/platform/v1/notifications" ? list([], { mail_configured: true, waiting: 0, failed_events: 2 } as never) : null));
  await screen.findByText(/有 2 个通知事件内容有问题/);
});
