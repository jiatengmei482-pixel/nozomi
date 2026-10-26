/**
 * 测试角色补充（M1-13）：审计日志的日期校验。`platform.test.tsx` 已有「不存在的日期」「从晚于到」「对调」「面板里填反」；
 * 这里补几种组合：填错一格后又改了另一格、填错后点快捷范围、2 月 29 日、面板里填错后关闭再打开、面板里对调后再查。
 * 原则：输入框里显示的文字、它旁边的提示、实际拿去查的日期，三者任何时候都要说得通——不能显示一个没生效的日期却没有提示，
 * 也不能在一个合法的日期下面说「这不是一个日期」。
 * 下面两条曾经是缺陷（M1-13 测试时发现、已修复），复现步骤就是测试本身：
 * - 「从」填错后改「到」：页面在「从」「到」变化时把两格文字重置成网址里的值，但没收起「从」的错误提示，
 *   于是「从」显示一个合法的旧日期，下面却写着「这不是一个日期」；用户填的那个错日期也被悄悄换掉了。
 * - 「从」填错后点一个和当前范围相同的快捷范围：网址没变，两格文字不重置，提示却被收起，
 *   于是「从」显示一个没生效的错日期、没有任何提示，实际查的是快捷范围。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../App.tsx";
import type { AuditLog } from "../../api/platform.ts";
import type { PlatformUser } from "../../api/types.ts";
import { assertAbsent, json, resetBrowser, signIn, stubApiWith } from "../../testing/harness.tsx";

afterEach(resetBrowser);

const stamps = { created_at: "2026-10-06T00:12:00.000Z", updated_at: "2026-10-08T05:30:00.000Z" };
const ME_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "7b1c2d3e-aaaa-4bbb-8ccc-ddddeeeeffff";
const me: PlatformUser = { id: ME_ID, email: "kato@example.com", name: "加藤 美咲", role: "super_admin", role_name: "超级管理员", status: "active", ...stamps };
const log: AuditLog = {
  id: "7",
  occurred_at: "2026-10-09T02:02:37.000Z",
  tenant_id: TENANT_ID,
  actor: { type: "platform_user", id: ME_ID, email: "kato@example.com" },
  ip: "203.0.113.9",
  source: "console",
  resource: "tenant",
  resource_id: TENANT_ID,
  action: "suspend",
  before: { status: "active" },
  after: { status: "suspended" },
};

const NOT_A_DATE = "这不是一个日期，请按 2026-10-08 的格式填写";
const REVERSED = "结束日期不能早于开始日期，请改一下「从」或「到」";

function open(path: string): () => URL[] {
  signIn("platform", "platform-token");
  const calls = stubApiWith((call) => {
    if (call.method !== "GET") return null;
    const at = call.url.pathname;
    if (at === "/platform/v1/auth/me") return json(200, { user: me, permissions: [], must_change_password: false });
    if (at === "/platform/v1/tenants") return json(200, { items: [{ id: TENANT_ID, name: "车队", status: "active", ...stamps }], next_cursor: null });
    if (at === "/platform/v1/staff") return json(200, { items: [me], next_cursor: null });
    if (at === "/platform/v1/audit-logs") return json(200, { items: [log], next_cursor: null });
    return null;
  });
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  return () => calls.filter((call) => call.path.startsWith("/platform/v1/audit-logs")).map((call) => new URL(call.path, "http://localhost"));
}

const input = (id: string): HTMLInputElement => document.getElementById(id) as HTMLInputElement;
const errorOf = (field: HTMLInputElement): string | null => {
  if (field.getAttribute("aria-invalid") !== "true") return null;
  return document.getElementById(field.getAttribute("aria-describedby") ?? "")?.textContent ?? "";
};
const pad = (n: number): string => String(n).padStart(2, "0");
const localDate = (at: Date): string => `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
const startOf = (date: string): string => {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toISOString();
};

/** 「从」这一格：要么显示的就是实际查询用的日期且没有提示；要么显示的不是查询用的日期，那就必须有提示。 */
function assertFromConsistent(lastRequest: URL | undefined): void {
  const from = input("audit-from");
  const used = lastRequest?.searchParams.get("from") ?? null;
  const shownMatchesQuery = from.value === "" ? used === null : used === startOf(from.value);
  const error = errorOf(from);
  if (shownMatchesQuery) assert.equal(error, null, `「从」显示 ${from.value}，正是查询用的日期，却提示「${error}」`);
  else assert.ok(error !== null, `「从」显示 ${JSON.stringify(from.value)}，查询用的却是 ${used}，而且没有任何提示`);
}

test("2 月 29 日：闰年的认、平年的说「不是日期」", async () => {
  const actor = userEvent.setup();
  const requests = open("/platform/settings/audit-logs");
  await screen.findByText("本页 1 条");
  const from = input("audit-from");
  await actor.type(from, "2027-02-29{Enter}");
  assert.equal(errorOf(from), NOT_A_DATE);
  await actor.clear(from);
  await actor.type(from, "2028-02-29{Enter}");
  await waitFor(() => assert.equal(requests().at(-1)?.searchParams.get("from"), new Date(2028, 1, 29).toISOString()));
  assert.equal(errorOf(from), null);
});

test("「从」填错（提示还在）以后去改「到」：「从」不会变回旧值却还挂着「不是日期」的提示，显示、提示和实际查询保持一致", async () => {
  const actor = userEvent.setup();
  const requests = open("/platform/settings/audit-logs?from=2026-10-01");
  await screen.findByText("本页 1 条");
  const from = input("audit-from");
  await actor.clear(from);
  await actor.type(from, "2026-02-30{Enter}");
  assert.equal(errorOf(from), NOT_A_DATE);
  assertFromConsistent(requests().at(-1));
  const before = requests().length;
  await actor.type(input("audit-to"), "2026-10-20{Enter}");
  await waitFor(() => assert.equal(requests().length, before + 1));
  await screen.findByText("本页 1 条");
  assertFromConsistent(requests().at(-1));
});

test("「从」填错（提示还在）以后点和当前范围相同的快捷范围：不会留下一个没生效、也没提示的日期", async () => {
  const actor = userEvent.setup();
  const today = new Date();
  const weekAgo = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6);
  const requests = open(`/platform/settings/audit-logs?from=${localDate(weekAgo)}&to=${localDate(today)}`);
  await screen.findByText("本页 1 条");
  const from = input("audit-from");
  await actor.clear(from);
  await actor.type(from, "2026-13-40{Enter}");
  assert.equal(errorOf(from), NOT_A_DATE);
  await actor.click(screen.getByRole("button", { name: "最近 7 天" }));
  await screen.findByText("本页 1 条");
  assertFromConsistent(requests().at(-1));
});

test("「从」填错以后点不同的快捷范围：输入框换成快捷范围的日期，提示收起", async () => {
  const actor = userEvent.setup();
  const requests = open("/platform/settings/audit-logs");
  await screen.findByText("本页 1 条");
  const from = input("audit-from");
  await actor.type(from, "2026-13-40{Enter}");
  assert.equal(errorOf(from), NOT_A_DATE);
  await actor.click(screen.getByRole("button", { name: "今天" }));
  await waitFor(() => assert.equal(from.value, localDate(new Date())));
  assert.equal(errorOf(from), null);
  assertFromConsistent(requests().at(-1));
});

test("网址里填反了，「到」先填错一个不存在的日期：说的是「不是日期」，改成合法但仍早于「从」的日期又说填反了；不发请求", async () => {
  const actor = userEvent.setup();
  const requests = open("/platform/settings/audit-logs?from=2026-10-09&to=2026-10-01");
  await screen.findByText("日期填反了");
  const to = input("audit-to");
  assert.equal(errorOf(to), REVERSED);
  await actor.clear(to);
  await actor.type(to, "2026-10-32{Enter}");
  assert.equal(errorOf(to), NOT_A_DATE);
  await actor.clear(to);
  await actor.type(to, "2026-10-05{Enter}");
  await waitFor(() => assert.equal(errorOf(to), REVERSED));
  assert.ok(screen.getByText("日期填反了"));
  assert.equal(requests().length, 0, "填反期间一次也不查");
  await actor.click(screen.getByRole("button", { name: "对调两个日期" }));
  await waitFor(() => assert.equal(requests().length, 1));
  assert.equal(requests()[0]?.searchParams.get("from"), new Date(2026, 9, 5).toISOString());
  assert.equal(input("audit-from").value, "2026-10-05");
  assert.equal(to.value, "2026-10-09");
  assert.equal(errorOf(to), null);
});

test("「筛选」面板：填了不存在的日期被拦下后点取消，再打开面板时不残留上次的错误提示", async () => {
  const actor = userEvent.setup();
  open("/platform/settings/audit-logs");
  await screen.findByText("本页 1 条");
  await actor.click(screen.getByRole("button", { name: "筛选" }));
  let panel = screen.getByRole("dialog", { name: "筛选" });
  await actor.type(panel.querySelector("#audit-panel-from") as HTMLInputElement, "2026-02-30");
  await actor.click(within(panel).getByRole("button", { name: "查看结果" }));
  assert.ok(within(panel).getByText(NOT_A_DATE));
  await actor.click(within(panel).getByRole("button", { name: "关闭" }));
  await waitFor(() => assertAbsent(screen.queryByRole("dialog", { name: "筛选" })));
  await actor.click(screen.getByRole("button", { name: "筛选" }));
  panel = screen.getByRole("dialog", { name: "筛选" });
  assertAbsent(within(panel).queryByText(NOT_A_DATE));
  assert.equal((panel.querySelector("#audit-panel-from") as HTMLInputElement).value, "");
});

test("网址里填反了，打开「筛选」面板直接点「查看结果」：面板不关，标红「到」说填反了，不发请求", async () => {
  const actor = userEvent.setup();
  const requests = open("/platform/settings/audit-logs?from=2026-10-09&to=2026-10-01");
  await screen.findByText("日期填反了");
  await actor.click(screen.getByRole("button", { name: /^筛选/ }));
  const panel = screen.getByRole("dialog", { name: "筛选" });
  await actor.click(within(panel).getByRole("button", { name: "查看结果" }));
  assert.equal(errorOf(panel.querySelector("#audit-panel-to") as HTMLInputElement), REVERSED);
  assert.ok(screen.getByRole("dialog", { name: "筛选" }));
  assert.equal(requests().length, 0);
});
