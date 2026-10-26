/**
 * M4-10 测试角色：审计日志「操作」筛选（同名动作合并成一项、接口支持逗号分隔多个动作）。
 * - 选「暂停」「启用」发的请求是那一组的全部动作；
 * - 以前的链接只带一个动作（?action=suspend）时，下拉框对上「暂停」那一组——下拉框显示的和真正查的要一致（不能显示「暂停」却只查 suspend）；
 * - 网址里的动作不合法（大写、空项、超过 10 个）时忽略并提示，不把它发给接口。
 * 接口用测试替身。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../App.tsx";
import type { PlatformUser } from "../../api/types.ts";
import { ACTION_FILTER_OPTIONS } from "../../lib/audit-display.ts";
import { roleName } from "../../lib/portal.ts";
import { type ApiCall, json, resetBrowser, signIn, stubApiWith } from "../../testing/harness.tsx";

afterEach(resetBrowser);

const stamps = { created_at: "2026-10-06T00:12:00.000Z", updated_at: "2026-10-08T05:30:00.000Z" };
const me: PlatformUser = { id: "11111111-1111-4111-8111-111111111111", email: "kato@example.com", name: "加藤 美咲", role: "super_admin", role_name: roleName("platform", "super_admin") ?? "super_admin", status: "active", ...stamps };

function open(path: string): ApiCall[] {
  signIn("platform", "platform-token");
  const calls = stubApiWith((call) => {
    if (call.method !== "GET") return null;
    const at = call.url.pathname;
    if (at === "/platform/v1/auth/me") return json(200, { user: me, permissions: [], must_change_password: false });
    if (at === "/platform/v1/tenants") return json(200, { items: [], next_cursor: null });
    if (at === "/platform/v1/staff") return json(200, { items: [me], next_cursor: null });
    if (at === "/platform/v1/audit-logs") return json(200, { items: [], next_cursor: null });
    return null;
  });
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  return calls;
}

const auditRequests = (calls: ApiCall[]): URL[] => calls.filter((call) => call.path.startsWith("/platform/v1/audit-logs")).map((call) => new URL(call.path, "http://localhost"));
const actionSelect = (): HTMLSelectElement => document.getElementById("audit-action") as HTMLSelectElement;
const actionsOf = (value: string | null): string[] => (value ?? "").split(",").filter((part) => part !== "").sort();
const groupOf = (label: string): string => ACTION_FILTER_OPTIONS.find((option) => option.label === label)?.value ?? "";

test("选「暂停」：请求里是这一组的全部动作（suspend、pause），网址里也是", async () => {
  const calls = open("/platform/settings/audit-logs");
  await screen.findByRole("heading", { level: 1, name: "审计日志" });
  await waitFor(() => assert.ok(actionSelect()));
  await userEvent.setup().selectOptions(actionSelect(), groupOf("暂停"));
  await waitFor(() => assert.deepEqual(actionsOf(auditRequests(calls).at(-1)?.searchParams.get("action") ?? null), ["pause", "suspend"]));
});

for (const [legacy, label] of [["suspend", "暂停"], ["pause", "暂停"], ["enable", "启用"], ["activate", "启用"]] as const) {
  test(`以前的链接 ?action=${legacy}：下拉框显示「${label}」，真正查的动作和下拉框选中的那一组一致`, async () => {
    const calls = open(`/platform/settings/audit-logs?action=${legacy}`);
    await screen.findByRole("heading", { level: 1, name: "审计日志" });
    await waitFor(() => assert.ok(auditRequests(calls).length > 0));
    const select = actionSelect();
    const shown = select.options[select.selectedIndex]?.textContent;
    const requested = actionsOf(auditRequests(calls).at(-1)?.searchParams.get("action") ?? null);
    assert.equal(shown, label, "下拉框对上同名的那一组");
    assert.deepEqual(requested, actionsOf(select.value), `下拉框写「${shown}」（${select.value}），请求却只查了 ${requested.join(",")}`);
  });
}

test("网址里的动作不合法（大写、空项、超过 10 个）：忽略这个条件，不发给接口", async () => {
  for (const bad of ["Suspend", "suspend,,pause", Array.from({ length: 11 }, () => "suspend").join(",")]) {
    resetBrowser();
    const calls = open(`/platform/settings/audit-logs?action=${encodeURIComponent(bad)}`);
    await screen.findByRole("heading", { level: 1, name: "审计日志" });
    await waitFor(() => assert.ok(auditRequests(calls).length > 0));
    assert.equal(auditRequests(calls).at(-1)?.searchParams.get("action"), null, bad);
  }
});
