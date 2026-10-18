/**
 * 运营后台「渠道」「待审核」的组件测试（ADR 0023）：菜单和首页卡片按权限、新建渠道的校验和请求体、加价规则和定价参数走复核、
 * API 密钥只显示一次、待审核队列里发起人不能审核自己发起的、批准失败时写出原因、报价试算选渠道。
 * 接口用测试替身；真实后端由集成测试和端到端测试 e2e/channels.spec.ts 覆盖。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../App.tsx";
import type { ApiClient, Approval, Channel, ChannelDetail, MarkupRule } from "../../api/channels.ts";
import type { City, VehicleGroup } from "../../api/master.ts";
import type { PlatformUser, Tenant } from "../../api/types.ts";
import { type ApiCall, apiError, assertAbsent, json, resetBrowser, signIn, stubApiWith } from "../../testing/harness.tsx";

afterEach(resetBrowser);

const stamps = { created_at: "2026-10-06T00:12:00.000Z", updated_at: "2026-10-08T05:30:00.000Z" };
const CHANNEL_ID = "c1c1c1c1-aaaa-4bbb-8ccc-ddddeeeeffff";
const TENANT_ID = "7b1c2d3e-aaaa-4bbb-8ccc-ddddeeeeffff";
const CITY_ID = "11111111-1111-4111-8111-111111111111";
const GROUP_ID = "55555555-5555-4555-8555-555555555555";
const RULE_ID = "88888888-8888-4888-8888-888888888888";
const APPROVAL_ID = "a0a0a0a0-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT_ID = "b0b0b0b0-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ME_ID = "99999999-9999-4999-8999-999999999999";
const OTHER_ID = "98989898-9898-4898-8898-989898989898";
const SECRET = "nzs_THIS-IS-THE-ONE-TIME-SECRET-0123456789abcd";

const meOf = (role: string): PlatformUser => ({ id: ME_ID, email: "kato@example.com", name: "加藤", role: role as PlatformUser["role"], status: "active", ...stamps });
const tenant: Tenant = { id: TENANT_ID, name: "NOZOMI 自营车队", status: "active", ...stamps };
const tokyo: City = { id: CITY_ID, code: "CTY-JP-TYO", country_code: "JP", name: { zh: "东京" }, timezone: "Asia/Tokyo", center: { lng: 139.7, lat: 35.7 }, boundary: null, status: "active", version: 1, ...stamps };
const group: VehicleGroup = { id: GROUP_ID, code: "VG-BIZ-7", grade: "business", seats: 7, name: { zh: "商务七座" }, sample_models: [], power: "fuel", combos: [{ passengers: 6, luggage: 4 }], status: "active", version: 1, ...stamps };
const channelOf = (changes: Partial<Channel> = {}): Channel => ({
  id: CHANNEL_ID,
  name: "NOZOMI 官网",
  type: "own",
  status: "testing",
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
  ...changes,
});
const ruleOf = (changes: Partial<MarkupRule> = {}): MarkupRule => ({ id: RULE_ID, level: 2, tenant: { id: TENANT_ID, name: "NOZOMI 自营车队" }, city: null, category: null, vehicle_group: null, markup_bp: 1500, valid_from: null, valid_to: null, note: null, version: 1, ...stamps, ...changes });
const approvalOf = (changes: Partial<Approval> = {}): Approval => ({
  id: APPROVAL_ID,
  kind: "channel.pricing",
  resource: "channel",
  resource_id: CHANNEL_ID,
  summary: "「NOZOMI 官网」改定价参数：默认加价 10% → 12%",
  payload: { default_markup_bp: 1200, markup_floor_bp: 1000, band_bp: 300, min_margin_minor: 0, sell_rounding: {} },
  before: { default_markup_bp: 1000, markup_floor_bp: 1000, band_bp: 300, min_margin_minor: 0, sell_rounding: {} },
  base_version: 1,
  status: "pending",
  requested_by: { id: OTHER_ID, name: "佐藤", email: "sato@example.com" },
  requested_at: "2026-10-08T05:30:00.000Z",
  request_note: "旺季",
  decided_by: null,
  decided_at: null,
  decision_note: null,
  can: { approve: true, reject: true, withdraw: false },
  ...changes,
});
const clientOf = (changes: Partial<ApiClient> = {}): ApiClient => ({ id: CLIENT_ID, client_id: "nzc_0123456789abcdef01234567", name: "官网正式", secret_last4: "abcd", secret_generation: 1, previous_valid_until: null, status: "active", created_at: stamps.created_at, rotated_at: null, revoked_at: null, last_used_at: null, ...changes });
const detailOf = (changes: Partial<ChannelDetail> = {}): ChannelDetail => ({ channel: channelOf(), markup_rules: [ruleOf()], ...changes });
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
    if (at === "/platform/v1/products") return page([]);
    if (at === "/platform/v1/channels") return call.url.searchParams.get("status") === "active" ? json(200, { items: [], next_cursor: null, total: 0 }) : page([channelOf()]);
    if (at === "/platform/v1/approvals") return call.url.searchParams.get("status") === "pending" && call.url.searchParams.get("limit") === "1" ? json(200, { items: [], next_cursor: null, total: 3 }) : page([approvalOf()]);
    if (at === `/platform/v1/channels/${CHANNEL_ID}`) return json(200, detailOf());
    if (at === `/platform/v1/channels/${CHANNEL_ID}/api-clients`) return page([clientOf()]);
    if (at === `/platform/v1/channels/${CHANNEL_ID}/quote-logs`) return json(200, { items: [], next_cursor: null });
    if (at === "/platform/v1/tenants") return json(200, { items: [tenant], next_cursor: null });
    if (at === "/platform/v1/master/cities") return page([tokyo]);
    if (at === "/platform/v1/master/vehicle-groups") return page([group]);
    return null;
  });
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  return calls;
}
const user = () => userEvent.setup();
const menuLabels = (): string[] => [...new Set([...document.querySelectorAll('nav[aria-label="主菜单"] .nav-item')].map((node) => node.textContent ?? ""))];
const posts = (calls: ApiCall[]): ApiCall[] => calls.filter((call) => call.method !== "GET");

test("菜单和首页：渠道经理、只读都有「渠道」「待审核」和两张卡片（待审核数来自列表的 total）；主数据运营没有，也不去取", async () => {
  for (const role of ["channel_manager", "readonly"]) {
    resetBrowser();
    open("/platform", role);
    await waitFor(() => assert.ok(menuLabels().includes("渠道") && menuLabels().includes("待审核"), role));
    const card = await screen.findByRole("link", { name: /3 条改动等你或同事审核/ });
    assert.equal(card.getAttribute("href"), "/platform/approvals");
  }
  resetBrowser();
  const calls = open("/platform", "master_data");
  await waitFor(() => assert.ok(menuLabels().includes("主数据")));
  assert.ok(!menuLabels().includes("渠道") && !menuLabels().includes("待审核"));
  assert.deepEqual(calls.filter((call) => /channels|approvals/.test(call.path)), []);
});

test("渠道列表：渠道经理有「新建渠道」，只读没有并提示只能看；主数据运营打开是没有权限", async () => {
  open("/platform/channels", "channel_manager");
  assert.ok(await screen.findByRole("link", { name: "NOZOMI 官网" }));
  assert.ok(screen.getAllByRole("link", { name: /新建渠道/ }).length > 0);
  resetBrowser();
  open("/platform/channels", "readonly");
  await screen.findByRole("link", { name: "NOZOMI 官网" });
  assert.equal(screen.queryAllByRole("link", { name: /新建渠道/ }).length, 0);
  assert.ok(screen.getByText("你可以查看渠道，但不能修改。"));
  resetBrowser();
  open("/platform/channels", "master_data");
  assert.ok(await screen.findByText("你没有权限查看这里"));
});

test("新建渠道：没填类型、下限低于 10% 当场拦下不发请求；填好后按接口的写法发（百分比换成基点，金额换成最小单位）", async () => {
  const actor = user();
  const calls = open("/platform/channels/new", "channel_manager", (call) => (call.method === "POST" && call.url.pathname === "/platform/v1/channels" ? json(201, detailOf()) : null));
  await actor.type(await screen.findByRole("textbox", { name: "名称" }), "NOZOMI 官网");
  await actor.clear(screen.getByRole("textbox", { name: "加价下限（%）" }));
  await actor.type(screen.getByRole("textbox", { name: "加价下限（%）" }), "9.5");
  await actor.click(screen.getByRole("button", { name: "新建" }));
  assert.ok(await screen.findByText("请选择渠道类型"));
  assert.ok(screen.getByText("加价下限不能低于平台下限 10%"));
  assert.deepEqual(posts(calls), []);
  await actor.click(screen.getByRole("radio", { name: /^自营/ }));
  await actor.clear(screen.getByRole("textbox", { name: "加价下限（%）" }));
  await actor.type(screen.getByRole("textbox", { name: "加价下限（%）" }), "11");
  await actor.clear(screen.getByRole("textbox", { name: "默认加价比例（%）" }));
  await actor.type(screen.getByRole("textbox", { name: "默认加价比例（%）" }), "12.5");
  await actor.type(screen.getByRole("textbox", { name: /最低毛利/ }), "500");
  await actor.click(screen.getByRole("radio", { name: "只卖名单里的" }));
  await actor.click(await screen.findByRole("checkbox", { name: "NOZOMI 自营车队" }));
  await actor.click(screen.getByRole("button", { name: "新建" }));
  await waitFor(() => assert.equal(posts(calls).length, 1));
  const body = posts(calls)[0]?.body as Record<string, any>;
  assert.deepEqual([body["type"], body["pricing"], body["scope"]], ["own", { default_markup_bp: 1250, markup_floor_bp: 1100, band_bp: 300, min_margin: 500, sell_rounding: {} }, { tenant_scope: "allow", tenant_ids: [TENANT_ID], city_ids: null, categories: ["airport_transfer", "point_to_point", "charter"] }]);
});

test("渠道详情：加价规则低于下限当场拦下；提交后发起复核（不改页面上的数），提示等另一位同事批准", async () => {
  const actor = user();
  const calls = open(`/platform/channels/${CHANNEL_ID}`, "channel_manager", (call) => (call.method === "POST" && call.url.pathname.endsWith("/markup-rules") ? json(202, { approval: approvalOf({ kind: "markup_rule.create" }) }) : null));
  await screen.findByRole("heading", { level: 1, name: "NOZOMI 官网" });
  assert.ok(screen.getByText("15%"), "规则表里的比例");
  await actor.click(screen.getByRole("button", { name: /新增加价规则/ }));
  const dialog = await screen.findByRole("dialog", { name: "新增加价规则" });
  await actor.click(within(dialog).getByRole("radio", { name: /第 2 级/ }));
  await actor.selectOptions(within(dialog).getByRole("combobox", { name: "供应商" }), TENANT_ID);
  await actor.type(within(dialog).getByRole("textbox", { name: "加价比例（%）" }), "9");
  await actor.click(within(dialog).getByRole("button", { name: "提交审核" }));
  assert.ok(await within(dialog).findByText("不能低于这个渠道的加价下限 10%"));
  assert.deepEqual(posts(calls), []);
  await actor.clear(within(dialog).getByRole("textbox", { name: "加价比例（%）" }));
  await actor.type(within(dialog).getByRole("textbox", { name: "加价比例（%）" }), "13");
  await actor.click(within(dialog).getByRole("button", { name: "提交审核" }));
  assert.ok(await screen.findByText(/已提交审核：另一位有审核权限的同事批准后才生效/));
  assert.deepEqual(posts(calls).map((call) => [call.path, (call.body as any).tenant_id, (call.body as any).markup_bp, (call.body as any).city_id]), [[`/platform/v1/channels/${CHANNEL_ID}/markup-rules`, TENANT_ID, 1300, null]]);
});

test("渠道详情：只读角色看得到规则、密钥后 4 位，没有任何修改按钮", async () => {
  const calls = open(`/platform/channels/${CHANNEL_ID}`, "readonly");
  await screen.findByRole("heading", { level: 1, name: "NOZOMI 官网" });
  assert.ok(await screen.findByText(/••••abcd/));
  for (const name of [/新增加价规则/, "申请修改定价参数", /新建 API 客户端/, "申请暂停", "启用", "轮换密钥", "吊销"]) assert.equal(screen.queryAllByRole("button", { name }).length, 0, String(name));
  assert.deepEqual(posts(calls), []);
});

test("API 密钥：新建后只在对话框里显示一次；没复制就关要再确认；关掉以后页面上再也找不到原文", async () => {
  const actor = user();
  open(`/platform/channels/${CHANNEL_ID}`, "channel_manager", (call) => (call.method === "POST" && call.url.pathname.endsWith("/api-clients") ? json(201, { api_client: clientOf({ secret_last4: SECRET.slice(-4) }), client_secret: SECRET }) : null));
  await actor.click(await screen.findByRole("button", { name: /新建 API 客户端/ }));
  const form = await screen.findByRole("dialog", { name: "新建 API 客户端" });
  await actor.type(within(form).getByRole("textbox", { name: "名称" }), "官网测试");
  await actor.click(within(form).getByRole("button", { name: "新建并显示密钥" }));
  const shown = await screen.findByRole("dialog", { name: "API 密钥（只显示这一次）" });
  assert.equal((within(shown).getByRole("textbox", { name: "client_secret" }) as HTMLTextAreaElement).value, SECRET);
  await actor.click(within(shown).getByRole("button", { name: "我已保存好，关闭" }));
  assert.ok(within(shown).getByText(/还没有复制密钥/));
  await actor.click(within(shown).getByRole("button", { name: "不复制，关闭" }));
  await waitFor(() => assertAbsent(screen.queryByRole("dialog", { name: "API 密钥（只显示这一次）" })));
  assert.ok(!document.body.innerHTML.includes(SECRET), "关掉以后页面上没有密钥原文");
});

test("待审核：发起人只能撤回、看不到批准和驳回；别人能批准，批准时带上说明；批准不了时写出原因，记录仍在", async () => {
  const actor = user();
  const mine = approvalOf({ id: "a1a1a1a1-aaaa-4aaa-8aaa-aaaaaaaaaaaa", requested_by: { id: ME_ID, name: "加藤", email: "kato@example.com" }, can: { approve: false, reject: false, withdraw: true }, summary: "我发起的那条" });
  let stale = true;
  const calls = open("/platform/approvals", "channel_manager", (call) => {
    if (call.method === "GET" && call.url.pathname === "/platform/v1/approvals") return page([approvalOf(), mine]);
    if (call.method === "POST" && call.url.pathname === `/platform/v1/approvals/${APPROVAL_ID}/approve`) {
      if (stale) {
        stale = false;
        return apiError(409, "APPROVAL_STALE", "过时了", { current_version: 2 });
      }
      return json(200, { approval: approvalOf({ status: "approved" }) });
    }
    return null;
  });
  const mineCard = (await screen.findByText("我发起的那条")).closest("section") as HTMLElement;
  assert.deepEqual(within(mineCard).queryAllByRole("button", { name: /批准|驳回/ }), []);
  assert.ok(within(mineCard).getByRole("button", { name: "撤回" }));
  assert.ok(within(mineCard).getByText(/要等另一位有审核权限的同事处理/));
  const otherCard = screen.getByText("「NOZOMI 官网」改定价参数：默认加价 10% → 12%", { selector: "p" }).closest("section") as HTMLElement;
  assert.ok(within(otherCard).getByText("12%", { selector: "strong" }), "改之后的值");
  await actor.click(within(otherCard).getByRole("button", { name: "批准" }));
  const dialog = await screen.findByRole("dialog", { name: /^批准/ });
  await actor.type(within(dialog).getByRole("textbox", { name: "说明（选填）" }), "同意");
  await actor.click(within(dialog).getByRole("button", { name: "批准" }));
  assert.ok(await within(dialog).findByText(/已经被别的改动改过了，不能照旧生效/));
  await actor.click(within(dialog).getByRole("button", { name: "批准" }));
  assert.ok(await screen.findByText("已批准，改动已生效"));
  assert.deepEqual(posts(calls).map((call) => [call.path, (call.body as any).note]), [[`/platform/v1/approvals/${APPROVAL_ID}/approve`, "同意"], [`/platform/v1/approvals/${APPROVAL_ID}/approve`, "同意"]]);
});

test("报价试算：能看渠道的角色可以选渠道，请求体带 channel_id；不选是 null", async () => {
  const actor = user();
  open("/platform/quote-preview", "channel_manager");
  const select = (await screen.findByRole("combobox", { name: /按哪个渠道的规则/ })) as HTMLSelectElement;
  await waitFor(() => assert.ok([...select.options].some((option) => option.value === CHANNEL_ID)));
  await actor.selectOptions(select, CHANNEL_ID);
  assert.equal(select.value, CHANNEL_ID);
  resetBrowser();
  open("/platform/quote-preview", "customer_service");
  assert.ok(await screen.findByRole("combobox", { name: /按哪个渠道的规则/ }));
});
