/**
 * M2-04 测试角色补充：渠道详情的 API 密钥、待审核队列（ADR 0023）。
 * - 轮换：新密钥只显示一次；「立即作废」按接口的写法发；关掉、重新打开页面（刷新）后，页面、本地存储、网址、标题里都没有密钥原文；
 * - 新建密钥时同样不进存储、网址、标题；
 * - 待审核：只读只能看；发起人看不到「批准」「驳回」；接口说「发起人不能审核自己发起的」时把原因写出来，记录仍在。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../App.tsx";
import type { ApiClient, Approval, Channel, ChannelDetail } from "../../api/channels.ts";
import type { PlatformUser } from "../../api/types.ts";
import { type ApiCall, apiError, assertAbsent, currentLocation, json, resetBrowser, signIn, stubApiWith } from "../../testing/harness.tsx";

afterEach(resetBrowser);

const stamps = { created_at: "2026-10-06T00:12:00.000Z", updated_at: "2026-10-08T05:30:00.000Z" };
const CHANNEL_ID = "c2c2c2c2-aaaa-4bbb-8ccc-ddddeeeeffff";
const CLIENT_ID = "b1b1b1b1-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const APPROVAL_ID = "a2a2a2a2-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ME_ID = "99999999-9999-4999-8999-999999999999";
const OTHER_ID = "98989898-9898-4898-8898-989898989898";
const ROTATED = "nzs_QA-ROTATED-ONE-TIME-SECRET-zyxwvutsrqpo9876";
const CREATED = "nzs_QA-CREATED-ONE-TIME-SECRET-abcdefghijk01234";

const meOf = (role: string): PlatformUser => ({ id: ME_ID, email: "qa@example.com", name: "测试员", role: role as PlatformUser["role"], status: "active", ...stamps });
const channel: Channel = {
  id: CHANNEL_ID,
  name: "QA 官网",
  type: "own",
  status: "active",
  company: null,
  contact_name: null,
  contact_email: null,
  contact_phone: null,
  contract_ref: null,
  notes: null,
  settle_currency: "JPY",
  payment_mode: "prepaid",
  credit_limit: null,
  show_tenant_after_pay: true,
  scope: { tenant_scope: "all", tenants: [], cities: null, categories: ["airport_transfer", "point_to_point", "charter"] },
  pricing: { default_markup_bp: 1000, markup_floor_bp: 1000, band_bp: 300, min_margin: 0, sell_rounding: {} },
  version: 1,
  pricing_version: 1,
  ...stamps,
};
const clientOf = (changes: Partial<ApiClient> = {}): ApiClient => ({ id: CLIENT_ID, client_id: "nzc_abcdefabcdefabcdefabcdef", name: "官网正式", secret_last4: "wxyz", secret_generation: 1, previous_valid_until: null, status: "active", created_at: stamps.created_at, rotated_at: null, revoked_at: null, last_used_at: null, ...changes });
const detail: ChannelDetail = { channel, markup_rules: [] };
const approvalOf = (changes: Partial<Approval> = {}): Approval => ({
  id: APPROVAL_ID,
  kind: "markup_rule.create",
  resource: "channel",
  resource_id: CHANNEL_ID,
  summary: "「QA 官网」新增加价规则：东京 · 接送机 = 12%",
  payload: { level: 4, markup_bp: 1200 },
  before: null,
  base_version: null,
  status: "pending",
  requested_by: { id: OTHER_ID, name: "佐藤", email: "sato@example.com" },
  requested_at: "2026-10-08T05:30:00.000Z",
  request_note: null,
  decided_by: null,
  decided_at: null,
  decision_note: null,
  impact: null,
  can: { approve: true, reject: true, withdraw: false },
  ...changes,
});
const page = <T,>(items: T[]) => json(200, { items, next_cursor: null, total: items.length });

type Route = (call: ApiCall & { url: URL }) => Response | Promise<Response> | null;
function open(path: string, role: string, routes: Route = () => null): ApiCall[] {
  signIn("platform", "platform-token");
  const calls = stubApiWith((call) => {
    const custom = routes(call);
    if (custom !== null) return custom;
    if (call.method !== "GET") return null;
    const at = call.url.pathname;
    if (at === "/platform/v1/auth/me") return json(200, { user: meOf(role), permissions: [], must_change_password: false });
    if (at === "/platform/v1/dashboard/summary") return json(200, { tenants: null, master_data: null });
    if (at === "/platform/v1/channels") return page([channel]);
    if (at === "/platform/v1/approvals") return page([]);
    if (at === `/platform/v1/channels/${CHANNEL_ID}`) return json(200, detail);
    if (at === `/platform/v1/channels/${CHANNEL_ID}/api-clients`) return page([clientOf()]);
    if (at === `/platform/v1/channels/${CHANNEL_ID}/quote-logs`) return json(200, { items: [], next_cursor: null });
    if (at === "/platform/v1/tenants") return json(200, { items: [], next_cursor: null });
    if (at === "/platform/v1/master/cities" || at === "/platform/v1/master/vehicle-groups") return page([]);
    return null;
  });
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  return calls;
}
const posts = (calls: ApiCall[]): ApiCall[] => calls.filter((call) => call.method !== "GET");

/** 浏览器里能留下东西的地方：页面、两种本地存储、网址、标题 */
function assertNowhere(secret: string): void {
  assert.ok(!document.body.innerHTML.includes(secret), "页面上");
  assert.ok(!document.title.includes(secret), "标题里");
  assert.ok(!(currentLocation()?.path ?? "").includes(secret) && !JSON.stringify(currentLocation()?.state ?? null).includes(secret), "网址 / 路由状态里");
  assert.ok(!window.location.href.includes(secret), "地址栏里");
  for (const store of [localStorage, sessionStorage]) {
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i) as string;
      assert.ok(!key.includes(secret) && !(store.getItem(key) ?? "").includes(secret), `存储 ${key}`);
    }
  }
}

test("轮换密钥：勾「立即作废」时请求体是 { immediate: true }；新密钥只在对话框里出现一次，关掉、刷新后哪里都找不到", async () => {
  const actor = userEvent.setup();
  const calls = open(`/platform/channels/${CHANNEL_ID}`, "channel_manager", (call) =>
    call.method === "POST" && call.url.pathname.endsWith("/rotate") ? json(200, { api_client: clientOf({ secret_last4: ROTATED.slice(-4), secret_generation: 2 }), client_secret: ROTATED }) : null,
  );
  await actor.click(await screen.findByRole("button", { name: "轮换密钥" }));
  const dialog = await screen.findByRole("dialog", { name: /轮换「官网正式」的密钥/ });
  await actor.click(within(dialog).getByRole("checkbox", { name: /旧密钥立即作废/ }));
  await actor.click(within(dialog).getByRole("button", { name: "轮换并显示新密钥" }));
  const shown = await screen.findByRole("dialog", { name: "API 密钥（只显示这一次）" });
  assert.equal((within(shown).getByRole("textbox", { name: "client_secret" }) as HTMLTextAreaElement).value, ROTATED);
  assert.deepEqual(posts(calls).map((call) => [call.path, call.body]), [[`/platform/v1/channels/${CHANNEL_ID}/api-clients/${CLIENT_ID}/rotate`, { immediate: true }]]);
  // 显示中也不进存储、网址、标题
  assert.ok(!document.title.includes(ROTATED) && !window.location.href.includes(ROTATED));
  assert.equal(JSON.stringify({ ...localStorage }).includes(ROTATED) || JSON.stringify({ ...sessionStorage }).includes(ROTATED), false);
  await actor.click(within(shown).getByRole("button", { name: "我已保存好，关闭" }));
  await actor.click(within(shown).getByRole("button", { name: "不复制，关闭" }));
  await waitFor(() => assertAbsent(screen.queryByRole("dialog", { name: "API 密钥（只显示这一次）" })));
  assertNowhere(ROTATED);
  // 「刷新」：卸载后按同一个网址重新打开
  resetBrowser();
  open(`/platform/channels/${CHANNEL_ID}`, "channel_manager");
  assert.ok(await screen.findByText(/••••wxyz/));
  assertNowhere(ROTATED);
});

test("轮换默认不勾「立即作废」：请求体是 { immediate: false }", async () => {
  const actor = userEvent.setup();
  const calls = open(`/platform/channels/${CHANNEL_ID}`, "channel_manager", (call) =>
    call.method === "POST" && call.url.pathname.endsWith("/rotate") ? json(200, { api_client: clientOf({ secret_generation: 2 }), client_secret: ROTATED }) : null,
  );
  await actor.click(await screen.findByRole("button", { name: "轮换密钥" }));
  const dialog = await screen.findByRole("dialog", { name: /轮换「官网正式」的密钥/ });
  await actor.click(within(dialog).getByRole("button", { name: "轮换并显示新密钥" }));
  await screen.findByRole("dialog", { name: "API 密钥（只显示这一次）" });
  assert.deepEqual(posts(calls).map((call) => call.body), [{ immediate: false }]);
});

test("新建密钥：显示时、关掉后都不在存储、网址、标题里；离开再回到详情页也没有", async () => {
  const actor = userEvent.setup();
  open(`/platform/channels/${CHANNEL_ID}`, "channel_manager", (call) => (call.method === "POST" && call.url.pathname.endsWith("/api-clients") ? json(201, { api_client: clientOf({ secret_last4: CREATED.slice(-4) }), client_secret: CREATED }) : null));
  await actor.click(await screen.findByRole("button", { name: /新建 API 客户端/ }));
  const form = await screen.findByRole("dialog", { name: "新建 API 客户端" });
  await actor.type(within(form).getByRole("textbox", { name: "名称" }), "QA");
  await actor.click(within(form).getByRole("button", { name: "新建并显示密钥" }));
  await screen.findByRole("dialog", { name: "API 密钥（只显示这一次）" });
  assert.ok(!document.title.includes(CREATED) && !window.location.href.includes(CREATED));
  await actor.click(screen.getByRole("button", { name: "我已保存好，关闭" }));
  await actor.click(screen.getByRole("button", { name: "不复制，关闭" }));
  await waitFor(() => assertAbsent(screen.queryByRole("dialog", { name: "API 密钥（只显示这一次）" })));
  // 离开到渠道列表，再点回来
  const nav = document.querySelector('nav[aria-label="主菜单"]') as HTMLElement;
  await actor.click(within(nav).getAllByRole("link", { name: "渠道" })[0] as HTMLElement);
  await actor.click(await screen.findByRole("link", { name: "QA 官网" }));
  await screen.findByRole("heading", { level: 1, name: "QA 官网" });
  assertNowhere(CREATED);
});

test("待审核：只读能看到改动，但没有批准、驳回、撤回按钮，写明没有审核权限", async () => {
  open("/platform/approvals", "readonly", (call) => (call.method === "GET" && call.url.pathname === "/platform/v1/approvals" ? page([approvalOf({ can: { approve: false, reject: false, withdraw: false } })]) : null));
  const card = (await screen.findByText("「QA 官网」新增加价规则：东京 · 接送机 = 12%", { selector: "p" })).closest("section") as HTMLElement;
  assert.deepEqual(within(card).queryAllByRole("button", { name: /批准|驳回|撤回/ }), []);
  assert.ok(within(card).getByText(/没有审核这一类改动的权限/));
});

test("待审核：接口拒绝「发起人审核自己发起的」时写出原因，记录仍在队列里", async () => {
  const actor = userEvent.setup();
  open("/platform/approvals", "channel_manager", (call) => {
    if (call.method === "GET" && call.url.pathname === "/platform/v1/approvals") return page([approvalOf()]);
    if (call.method === "POST" && call.url.pathname === `/platform/v1/approvals/${APPROVAL_ID}/reject`) return apiError(409, "APPROVAL_SELF_REVIEW", "发起人不能审核");
    return null;
  });
  const card = (await screen.findByText("「QA 官网」新增加价规则：东京 · 接送机 = 12%", { selector: "p" })).closest("section") as HTMLElement;
  await actor.click(within(card).getByRole("button", { name: /^驳回：/ }));
  const dialog = await screen.findByRole("dialog", { name: /^驳回/ });
  await actor.click(within(dialog).getByRole("button", { name: "驳回" }));
  assert.ok(await within(dialog).findByText(/发起人不能审核自己发起的改动/));
  await actor.click(within(dialog).getByRole("button", { name: "取消" }));
  await waitFor(() => assertAbsent(screen.queryByRole("dialog", { name: /^驳回/ })));
  assert.ok(screen.getByText("「QA 官网」新增加价规则：东京 · 接送机 = 12%", { selector: "p" }), "记录仍在队列里");
});
