/**
 * QA（M4-08，ADR 0049）：通知中心页面里开发的 notifications.test.tsx 没有覆盖的部分：
 * 筛选的组合和非法参数、分页提示、失败原因都是中文、重试连点和按钮的权限、中断的说明。接口用测试替身。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { NOTIFICATION_ERROR_NAMES } from "@nozomi/domain";
import { App } from "../../App.tsx";
import type { NotificationRow } from "../../api/notifications.ts";
import { notificationErrorText } from "../../lib/notification-display.ts";
import { type ApiCall, apiError, assertAbsent, deferred, json, resetBrowser, signIn, stubApiWith } from "../../testing/harness.tsx";

afterEach(resetBrowser);

const stamps = { created_at: "2026-10-06T00:12:00.000Z", updated_at: "2026-10-08T05:30:00.000Z" };
const ORDER_ID = "0a0a0a0a-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ROW_ID = "f1f1f1f1-ffff-4fff-8fff-ffffffffffff";
const platformMe = (role: string, permissions: string[] = []) => json(200, { user: { id: "p1", email: "staff@platform.example", name: "测试员工", role, status: "active", ...stamps }, permissions, must_change_password: false });
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

const list = (items: NotificationRow[], total = items.length, summary = { mail_configured: true, waiting: 0 }) => json(200, { items, next_cursor: null, total, summary });
const urlOf = (call: ApiCall): URL => new URL(call.path, "http://localhost");

function openPlatform(path: string, role: string, respond: (call: ApiCall & { url: URL }) => Response | Promise<Response> | null, permissions: string[] = []): ApiCall[] {
  signIn("platform");
  const calls = stubApiWith((call) => (call.url.pathname === "/platform/v1/auth/me" ? platformMe(role, permissions) : respond(call)));
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  return calls;
}

function openTenant(path: string, role: string, respond: (call: ApiCall & { url: URL }) => Response | Promise<Response> | null): ApiCall[] {
  signIn("tenant");
  const calls = stubApiWith((call) => (call.url.pathname === "/tenant/v1/auth/me" ? tenantMe(role) : respond(call)));
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  return calls;
}

const listCalls = (calls: ApiCall[]): URL[] => calls.map(urlOf).filter((url) => url.pathname === "/platform/v1/notifications");

test("失败原因都是中文：所有后端可能写下、但 message 为空的错误码都不把英文代码露给运营", () => {
  const LATIN_CODE = /^[A-Z_]+$/;
  for (const code of Object.keys(NOTIFICATION_ERROR_NAMES)) assert.doesNotMatch(notificationErrorText({ code, message: null }) as string, LATIN_CODE, code);
  assert.doesNotMatch(notificationErrorText({ code: "UNEXPECTED", message: null }) as string, LATIN_CODE, "准备内容出错时后台任务写的是 UNEXPECTED + 空 message：页面直接显示 UNEXPECTED");
});

test("失败原因：后端的中文说明优先；OUTCOME_UNKNOWN 说清楚可能已发出；没有错误返回 null", () => {
  assert.equal(notificationErrorText({ code: "TIMEOUT", message: "邮件服务器在时限内没有完成" }), "邮件服务器在时限内没有完成");
  assert.match(notificationErrorText({ code: "OUTCOME_UNKNOWN", message: null }) as string, /可能已发出/);
  assert.equal(notificationErrorText(null), null);
});

test("筛选组合：从 URL 打开时状态、接收方、事件、订单号一起带给接口", async () => {
  const calls = openPlatform("/platform/notifications?status=failed&audience=guest&event=order.confirmed&order_no=NZ1", "operations", (call) => (call.url.pathname === "/platform/v1/notifications" ? list([rowOf()]) : null));
  await screen.findByRole("region", { name: "通知记录" });
  await waitFor(() => assert.ok(listCalls(calls).length > 0));
  const first = listCalls(calls)[0] as URL;
  assert.deepEqual(["status", "audience", "event", "order_no"].map((name) => first.searchParams.get(name)), ["failed", "guest", "order.confirmed", "NZ1"]);
});

test("筛选非法值：URL 里乱写的状态、事件、接收方不发给接口（不会变成 400 错误页）", async () => {
  const calls = openPlatform("/platform/notifications?status=bogus&audience=hacker&event=fx.bad", "operations", (call) => (call.url.pathname === "/platform/v1/notifications" ? list([rowOf()]) : null));
  await screen.findByText("gu***@example.com");
  for (const url of listCalls(calls)) for (const name of ["status", "audience", "event"]) assert.equal(url.searchParams.get(name), null, name);
});

test("筛选清除：选回「全部」后参数从请求里消失；订单号前后的空格去掉", async () => {
  const calls = openPlatform("/platform/notifications", "operations", (call) => (call.url.pathname === "/platform/v1/notifications" ? list([rowOf()]) : null));
  await screen.findByText("gu***@example.com");
  const actor = userEvent.setup();
  await actor.selectOptions(screen.getByLabelText("状态"), "failed");
  await waitFor(() => assert.equal(listCalls(calls).at(-1)?.searchParams.get("status"), "failed"));
  await actor.selectOptions(screen.getByLabelText("状态"), "all");
  await waitFor(() => assert.equal(listCalls(calls).at(-1)?.searchParams.get("status"), null));
  await actor.type(screen.getByLabelText("订单号"), "  NZ20261007ABCDEFGH  ");
  await actor.click(screen.getByRole("button", { name: "查找" }));
  await waitFor(() => assert.equal(listCalls(calls).at(-1)?.searchParams.get("order_no"), "NZ20261007ABCDEFGH"));
});

test("分页提示：运营后台超过一页时说清楚只显示最新的", async () => {
  openPlatform("/platform/notifications", "operations", (call) => (call.url.pathname === "/platform/v1/notifications" ? list([rowOf()], 150) : null));
  await screen.findByText(/共 150 条，这里显示最新的 1 条/);
});

test("缺陷：供应商后台超过一页时也要说清楚只显示最新的（现在静默截断在 100 条）", async () => {
  openTenant("/settings/notifications", "admin", (call) => {
    if (call.url.pathname === "/tenant/v1/notifications") return json(200, { items: [rowOf({ audience: "tenant", recipient: "ad***@market-a.test", retryable: false })], next_cursor: "next", total: 150 });
    if (call.url.pathname === "/tenant/v1/notification-settings") return json(200, { quiet_hours: null, time_zone: "Asia/Tokyo", version: 0 });
    return null;
  });
  await screen.findByText("ad***@market-a.test");
  assert.ok(screen.queryByText(/150/), "总共 150 条却只显示 1 条，页面上没有任何提示，也没有翻页");
});

test("重试连点：请求没回来前再点不会发第二次；回来后状态刷新", async () => {
  const pending = deferred();
  let current = rowOf();
  const calls = openPlatform("/platform/notifications", "operations", (call) => {
    if (call.url.pathname === "/platform/v1/notifications") return list([current]);
    if (call.url.pathname.endsWith("/retry")) return pending.promise;
    return null;
  });
  const button = await screen.findByRole("button", { name: "重试" });
  const actor = userEvent.setup();
  await actor.click(button);
  await actor.click(await screen.findByRole("button", { name: /发送中/ }));
  await actor.click(await screen.findByRole("button", { name: /发送中/ }));
  assert.equal(calls.filter((call) => urlOf(call).pathname.endsWith("/retry")).length, 1);
  current = rowOf({ status: "sent", sent_at: stamps.updated_at, last_error: null, retryable: false, attempts: 7 });
  await act(async () => pending.resolve(json(200, { notification: current })));
  await screen.findByText(/^已发送：邮件服务器已接收$/);
  assert.equal(calls.filter((call) => urlOf(call).pathname.endsWith("/retry")).length, 1);
});

test("重试还是失败：提示里有中文原因，不是错误代码；网络断了也有中文提示", async () => {
  let attempt = 0;
  openPlatform("/platform/notifications", "operations", (call) => {
    if (call.url.pathname === "/platform/v1/notifications") return list([rowOf()]);
    if (call.url.pathname.endsWith("/retry")) {
      attempt += 1;
      return attempt === 1 ? json(200, { notification: rowOf({ last_error: { code: "RECIPIENT_REJECTED", message: "邮件服务器拒绝了收件人地址" } }) }) : apiError(500, "INTERNAL", "boom");
    }
    return null;
  });
  const actor = userEvent.setup();
  await actor.click(await screen.findByRole("button", { name: "重试" }));
  await screen.findByText(/还是没有发出去：邮件服务器拒绝了收件人地址/);
  await actor.click(await screen.findByRole("button", { name: "重试" }));
  await screen.findByText(/系统暂时无法重试/);
  assert.equal(screen.queryByText(/boom|INTERNAL/), null);
});

test("重试按钮的权限：自建角色只有查看权限时没有重试按钮，也没有「操作」列", async () => {
  openPlatform("/platform/notifications", "custom_viewer", (call) => (call.url.pathname === "/platform/v1/notifications" ? list([rowOf()]) : null), ["notification.read"]);
  const table = await screen.findByRole("region", { name: "通知记录" });
  await within(table).findByText("gu***@example.com");
  assertAbsent(within(table).queryByRole("button", { name: "重试" }));
  assertAbsent(within(table).queryByRole("columnheader", { name: "操作" }));
});

test("重试按钮的权限：自建角色有重试权限时看得到按钮", async () => {
  openPlatform("/platform/notifications", "custom_operator", (call) => (call.url.pathname === "/platform/v1/notifications" ? list([rowOf()]) : null), ["notification.read", "notification.retry"]);
  const table = await screen.findByRole("region", { name: "通知记录" });
  assert.ok(await within(table).findByRole("button", { name: "重试" }));
});

test("中断的记录：说明「可能已发出」，能重试；页面任何地方都不说「已送达」", async () => {
  openPlatform("/platform/notifications", "operations", (call) => (call.url.pathname === "/platform/v1/notifications" ? list([rowOf({ attempts: 0, last_error: { code: "OUTCOME_UNKNOWN", message: null } })]) : null));
  await screen.findByText(/可能已发出，重试前请先确认/);
  assert.ok(screen.getByRole("button", { name: "重试" }));
  assert.equal(screen.queryByText(/已送达/), null);
});

test("等待中的说明：免打扰、退避显示下次发送时间；没配置不显示（配好就发，没有固定时间）", async () => {
  openPlatform("/platform/notifications", "operations", (call) =>
    call.url.pathname === "/platform/v1/notifications"
      ? list([
          rowOf({ id: "a1a1a1a1-1111-4111-8111-111111111111", status: "pending", retryable: false, attempts: 0, next_attempt_at: "2026-10-07T22:00:00.000Z", last_error: { code: "QUIET_HOURS", message: null } }),
          rowOf({ id: "b1b1b1b1-1111-4111-8111-111111111111", status: "pending", retryable: false, attempts: 0, next_attempt_at: "2026-10-07T22:00:00.000Z", last_error: { code: "NOT_CONFIGURED", message: null } }),
        ])
      : null,
  );
  await screen.findByText("在免打扰时段里，时段结束后发送");
  await screen.findByText("邮件发送还没有配置，配好后自动发送");
  assert.equal(screen.getAllByText(/^下次发送 /).length, 1);
});

test("邮件和页面用同一套路径：模板里写的后台链接都是前端真实存在的页面", async () => {
  const jobs = await readFile(new URL("../../../../api/src/services/notification-jobs.ts", import.meta.url), "utf8");
  const paths = [...jobs.matchAll(/\$\{(?:ctx\.config\.publicBaseUrl|this\.ctx\.config\.publicBaseUrl|base)\}(\/[a-z/-]*)/g)].map((match) => match[1] as string);
  assert.ok(paths.length >= 5, paths.join());
  const sources = await Promise.all(["../../App.tsx", "../../lib/order-center-display.ts", "../../lib/fx-display.ts", "../../lib/site-display.ts", "../../lib/dispatch-display.ts", "../../lib/order-money-display.ts", "../../components/AppShell.tsx"].map((file) => readFile(new URL(file, import.meta.url), "utf8")));
  const all = sources.join("\n");
  for (const path of paths) {
    const trimmed = path.endsWith("/") && path !== "/" ? path.slice(0, -1) : path;
    if (trimmed === "/") continue;
    assert.ok(all.includes(`"${trimmed}`) || all.includes(`"${trimmed.slice(1)}`) || all.includes(`\`${trimmed}`), `邮件链接 ${path} 在前端找不到`);
  }
});

test("供应商后台：只读角色能看不能改，表单里输入框只读、没有保存按钮；记录里没有重试", async () => {
  openTenant("/settings/notifications", "readonly", (call) => {
    if (call.url.pathname === "/tenant/v1/notifications") return json(200, { items: [rowOf({ audience: "tenant", recipient: "ad***@market-a.test" })], next_cursor: null, total: 1 });
    if (call.url.pathname === "/tenant/v1/notification-settings") return json(200, { quiet_hours: { start: "22:00", end: "07:00" }, time_zone: "Asia/Tokyo", version: 1 });
    return null;
  });
  const start = (await screen.findByLabelText("开始")) as HTMLInputElement;
  assert.equal(start.value, "22:00");
  assert.ok(start.readOnly);
  assertAbsent(screen.queryByRole("button", { name: "保存" }));
  await screen.findByText("ad***@market-a.test");
  assertAbsent(screen.queryByRole("button", { name: "重试" }));
});

test("供应商后台：免打扰保存时别人刚改过，提示刷新；不丢用户填的内容", async () => {
  openTenant("/settings/notifications", "admin", (call) => {
    if (call.url.pathname === "/tenant/v1/notifications") return json(200, { items: [], next_cursor: null, total: 0 });
    if (call.url.pathname === "/tenant/v1/notification-settings") return call.method === "PUT" ? apiError(409, "VERSION_CONFLICT", "版本冲突", { current_version: 4 }) : json(200, { quiet_hours: null, time_zone: "Asia/Tokyo", version: 3 });
    return null;
  });
  const start = (await screen.findByLabelText("开始")) as HTMLInputElement;
  const actor = userEvent.setup();
  await actor.type(start, "22:00");
  await actor.type(screen.getByLabelText("结束"), "07:00");
  await actor.click(screen.getByRole("button", { name: "保存" }));
  await screen.findByText(/别人刚改过/);
  assert.equal(start.value, "22:00");
});
