/**
 * 运营后台「共享区域去重」（M8-31b）的组件测试：菜单、先选城市、列表（状态、疑似重复、副本数）、标为重复（选保留的那份、写原因、请求体）、
 * 撤销、被拒绝时说明原因、只读角色没有按钮、没有权限。接口一律是测试替身。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../App.tsx";
import type { PlatformSharedArea } from "../../api/shared-area-duplicates.ts";
import { type ApiCall, assertAbsent, json, resetBrowser, signIn, stubApiWith } from "../../testing/harness.tsx";

afterEach(resetBrowser);

const stamps = { created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-02T03:04:00.000Z" };
const CITY = "11111111-1111-4111-8111-111111111111";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const area = (id: string, name: string, extra: Partial<PlatformSharedArea> = {}): PlatformSharedArea => ({
  id,
  city_id: CITY,
  name: { zh: name },
  shape_version: 2,
  operate_polygon_count: 1,
  forbid_polygon_count: 0,
  updated_at: "2026-11-12T01:00:00.000Z",
  copy_count: 0,
  duplicate: null,
  similar: [],
  ...extra,
});

const items = (): PlatformSharedArea[] => [
  area(A, "银座一带", { copy_count: 3, similar: [{ id: B, reasons: ["name", "overlap"] }] }),
  area(B, "银座一带", { similar: [{ id: A, reasons: ["name", "overlap"] }] }),
  area(C, "上野", {
    duplicate: { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", keep_area_id: A, keep_area_name: { zh: "银座一带" }, keep_area_listed: true, reason: "画重了", marked_by: { id: "p2", name: "主数据小王" }, marked_at: "2026-11-12T02:00:00.000Z" },
  }),
];

type Route = (call: ApiCall & { url: URL }) => Response | Promise<Response> | null;

function open(path: string, role: string, routes: Route = () => null): ApiCall[] {
  signIn("platform", "platform-token");
  const calls = stubApiWith((call) => {
    const custom = routes(call);
    if (custom !== null) return custom;
    const at = call.url.pathname;
    if (at === "/platform/v1/auth/me") return json(200, { user: { id: "p1", email: "md@example.com", name: "主数据", role, role_name: role, status: "active", ...stamps }, permissions: [], must_change_password: false });
    if (at === "/platform/v1/city-options") return json(200, { items: [{ id: CITY, code: "CTY-JP-TYO", country_code: "JP", name: { zh: "东京" }, timezone: "Asia/Tokyo", status: "active" }] });
    if (at === "/platform/v1/shared-areas" && call.method === "GET") return json(200, { items: items(), truncated: false });
    return null;
  });
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  return calls;
}

test("菜单：主数据下有「共享区域」；没选城市时先让选城市、不取列表", async () => {
  const calls = open("/platform/master/shared-areas", "readonly");
  await screen.findByText("先选一个城市", {}, { timeout: 5000 });
  const menu = await screen.findByRole("navigation", { name: "主菜单" }, { timeout: 5000 });
  assert.ok(within(menu).getByRole("link", { name: "共享区域" }));
  assert.ok(!calls.some((call) => call.path.startsWith("/platform/v1/shared-areas")));
});

test("列表：在库里 / 已隐藏（指向哪份、谁为什么）、疑似重复和理由、被引用份数；只读角色没有操作按钮", async () => {
  const calls = open(`/platform/master/shared-areas?city=${CITY}`, "readonly");
  const hidden = (await screen.findByText("上野", {}, { timeout: 5000 })).closest("tr") as HTMLElement;
  assert.match(hidden.textContent ?? "", /已隐藏/);
  assert.match(hidden.textContent ?? "", /以后的引用指向「银座一带」/);
  assert.match(hidden.textContent ?? "", /主数据小王 .*画重了/);
  const rows = screen.getAllByText("银座一带").map((node) => node.closest("tr") as HTMLElement).filter((row, index, list) => list.indexOf(row) === index);
  const first = rows[0] as HTMLElement;
  assert.match(first.textContent ?? "", /在库里/);
  assert.match(first.textContent ?? "", /3 份/);
  assert.match(first.textContent ?? "", /「银座一带」（同名、营运区重叠）/);
  assertAbsent(screen.queryByRole("button", { name: /^标为重复/ }));
  assertAbsent(screen.queryByRole("button", { name: /^撤销/ }));
  assert.ok(calls.some((call) => call.path === `/platform/v1/shared-areas?city_id=${CITY}`));
});

test("标为重复：默认选疑似重复的那份，写原因后提交，请求体正确，提示后刷新列表；原因不写不提交", async () => {
  const user = userEvent.setup();
  const sent: unknown[] = [];
  const calls = open(`/platform/master/shared-areas?city=${CITY}`, "master_data", (call) => {
    if (call.method === "POST" && call.url.pathname === `/platform/v1/shared-areas/${B}/mark-duplicate`) {
      sent.push(call.body);
      return json(200, { id: "m1", area_id: B, keep_area_id: A, reason: "乙画的和甲一样", marked_by: { id: "p1", name: "主数据" }, marked_at: "2026-11-13T00:00:00.000Z", revoked_by: null, revoked_at: null, revoke_reason: null });
    }
    return null;
  });
  await screen.findByText("上野", {}, { timeout: 5000 });
  const buttons = screen.getAllByRole("button", { name: "标为重复：银座一带" });
  await user.click(buttons[1] as HTMLElement);
  const dialog = await screen.findByRole("dialog", { name: "把「银座一带」标为重复" });
  assert.match(dialog.textContent ?? "", /已经引用它的副本和所有报价都不变/);
  const select = within(dialog).getByLabelText(/保留哪一份/) as HTMLSelectElement;
  assert.equal(select.value, A, "默认选疑似重复的那份");
  assert.match(select.options[0]?.textContent ?? "", /银座一带（同名、营运区重叠；营运区 1 块，被引用 3 份）/);
  await user.click(within(dialog).getByRole("button", { name: "标为重复" }));
  await within(dialog).findByText("请写原因");
  assert.equal(sent.length, 0);
  await user.type(within(dialog).getByLabelText(/^原因/), "乙画的和甲一样");
  const before = calls.filter((call) => call.method === "GET" && call.path.startsWith("/platform/v1/shared-areas?")).length;
  await user.click(within(dialog).getByRole("button", { name: "标为重复" }));
  await screen.findByText("已把「银座一带」标为重复，以后的引用指向「银座一带」");
  assert.deepEqual(sent, [{ keep_area_id: A, reason: "乙画的和甲一样" }]);
  await waitFor(() => assert.ok(calls.filter((call) => call.method === "GET" && call.path.startsWith("/platform/v1/shared-areas?")).length > before, "刷新了列表"));
});

test("被拒绝：对话框里说明原因（例如保留的那份刚被隐藏）", async () => {
  const user = userEvent.setup();
  open(`/platform/master/shared-areas?city=${CITY}`, "master_data", (call) =>
    call.method === "POST" && call.url.pathname.endsWith("/mark-duplicate") ? json(409, { error: { code: "DUPLICATE_KEEP_UNAVAILABLE", message: "保留的那份不在共享库里", details: {} } }) : null,
  );
  await user.click((await screen.findAllByRole("button", { name: "标为重复：银座一带" }, { timeout: 5000 }))[0] as HTMLElement);
  const dialog = await screen.findByRole("dialog");
  await user.type(within(dialog).getByLabelText(/^原因/), "重复");
  await user.click(within(dialog).getByRole("button", { name: "标为重复" }));
  await within(dialog).findByText("选的那份已经不在共享库里，或者刚被标为重复。刷新列表后换一份。");
  assert.ok(within(dialog).getByRole("button", { name: "知道了" }));
});

test("撤销：原因可以不写；请求体带 null", async () => {
  const user = userEvent.setup();
  const sent: unknown[] = [];
  open(`/platform/master/shared-areas?city=${CITY}`, "super_admin", (call) => {
    if (call.method === "POST" && call.url.pathname === `/platform/v1/shared-areas/${C}/unmark-duplicate`) {
      sent.push(call.body);
      return json(200, { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", area_id: C, keep_area_id: A, reason: "画重了", marked_by: { id: "p2", name: "主数据小王" }, marked_at: "2026-11-12T02:00:00.000Z", revoked_by: { id: "p1", name: "主数据" }, revoked_at: "2026-11-13T00:00:00.000Z", revoke_reason: null });
    }
    return null;
  });
  await user.click(await screen.findByRole("button", { name: "撤销：上野" }, { timeout: 5000 }));
  const dialog = await screen.findByRole("dialog", { name: "撤销「上野」的重复标记" });
  await user.click(within(dialog).getByRole("button", { name: "撤销" }));
  await screen.findByText("已撤销，「上野」重新出现在共享库里");
  assert.deepEqual(sent, [{ reason: null }]);
});

test("同城没有别的可保留的：不给「标为重复」；城市里没有区域时说明", async () => {
  open(`/platform/master/shared-areas?city=${CITY}`, "master_data", (call) => (call.method === "GET" && call.url.pathname === "/platform/v1/shared-areas" ? json(200, { items: [area(A, "孤零零")], truncated: false }) : null));
  await screen.findByText("同城没有别的区域", {}, { timeout: 5000 });
  assertAbsent(screen.queryByRole("button", { name: /^标为重复/ }));
  resetBrowser();
  open(`/platform/master/shared-areas?city=${CITY}`, "master_data", (call) => (call.method === "GET" && call.url.pathname === "/platform/v1/shared-areas" ? json(200, { items: [], truncated: false }) : null));
  await screen.findByText("这个城市的共享库里还没有区域", {}, { timeout: 5000 });
});

test("没有「主数据 · 查看」的自建角色：显示没有权限、不取数据", async () => {
  signIn("platform", "platform-token");
  const calls = stubApiWith((call) => {
    if (call.url.pathname === "/platform/v1/auth/me") return json(200, { user: { id: "p1", email: "x@example.com", name: "x", role: "custom_x", role_name: "自建", status: "active", ...stamps }, permissions: ["order.read"], must_change_password: false });
    return null;
  });
  render(
    <MemoryRouter initialEntries={[`/platform/master/shared-areas?city=${CITY}`]}>
      <App />
    </MemoryRouter>,
  );
  await screen.findByText("你没有权限查看这里", {}, { timeout: 5000 });
  assert.ok(!calls.some((call) => call.path.startsWith("/platform/v1/shared-areas")));
});
