/**
 * 选城市改走城市选项接口（M4-13）：自建角色没勾「主数据 · 查看」也能在新建 / 编辑渠道、加价规则、订单和商品的城市筛选、报价试算、角色的数据范围里选城市；
 * 列表为空时说清真实原因（平台没有、数据范围里没有）；已选着却不在选项里的城市写明是停用了还是不在自己的数据范围里。
 * 渠道详情页按「看待审核的改动」权限决定取不取复核记录，不发必然被拒的请求。
 * 接口用测试替身（城市选项接口的形状和后端约定：`GET /platform/v1/city-options` → `{ items: [{ id, code, name, country_code, timezone }] }`）。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { Channel, ChannelDetail, MarkupRule } from "../../api/channels.ts";
import type { SelectableCity } from "../../api/city-options.ts";
import { type Route, openApp, stamps } from "../../testing/order-center-fixtures.tsx";
import { type ApiCall, json, resetBrowser } from "../../testing/harness.tsx";

afterEach(resetBrowser);

const CHANNEL_ID = "c1c1c1c1-aaaa-4bbb-8ccc-ddddeeeeffff";
const RULE_ID = "88888888-8888-4888-8888-888888888888";
const TOKYO: SelectableCity = { id: "31313131-3131-4131-8131-313131313131", code: "CTY-JP-TYO", name: { zh: "东京" }, country_code: "JP", timezone: "Asia/Tokyo" };
const OSAKA: SelectableCity = { id: "32323232-3232-4232-8232-323232323232", code: "CTY-JP-OSA", name: { zh: "大阪" }, country_code: "JP", timezone: "Asia/Tokyo" };
const NAGOYA = { id: "33333333-3333-4333-8333-333333333333", name: "名古屋" };
const SEOUL = { id: "34343434-3434-4434-8434-343434343434", name: "首尔" };

const CHANNEL_EDITOR = ["channel.read", "channel.manage"];
const CUSTOM = "custom_city_picker";

const channelOf = (changes: Partial<Channel> = {}): Channel => ({
  id: CHANNEL_ID,
  name: "测试渠道",
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
  scope: { tenant_scope: "all", tenants: [], cities: null, categories: ["airport_transfer"] },
  pricing: { default_markup_bp: 1000, markup_floor_bp: 1000, band_bp: 300, min_margin: 0, sell_rounding: {} },
  version: 1,
  pricing_version: 1,
  ...stamps,
  ...changes,
});
const ruleOf = (changes: Partial<MarkupRule> = {}): MarkupRule => ({ id: RULE_ID, level: 4, tenant: null, city: { id: NAGOYA.id, name: NAGOYA.name }, category: "airport_transfer", vehicle_group: null, markup_bp: 1500, valid_from: null, valid_to: null, note: null, version: 1, ...stamps, ...changes });

/** 城市选项接口的应答；其余接口按页面需要给空的。主数据接口不登记：请求了就会失败，测试另外断言没有请求。 */
function routes(cities: SelectableCity[], detail: ChannelDetail = { channel: channelOf(), markup_rules: [] }, extra: Route = () => null): Route {
  return (call) => {
    const custom = extra(call);
    if (custom !== null) return custom;
    if (call.method !== "GET") return null;
    const at = call.url.pathname;
    if (at === "/platform/v1/city-options") return json(200, { items: cities });
    if (at === `/platform/v1/channels/${CHANNEL_ID}`) return json(200, detail);
    if (at === `/platform/v1/channels/${CHANNEL_ID}/api-clients`) return json(200, { items: [], next_cursor: null });
    if (at === `/platform/v1/channels/${CHANNEL_ID}/quote-logs`) return json(200, { items: [], next_cursor: null });
    if (at === "/platform/v1/orders" || at === "/platform/v1/products") return json(200, { items: [], next_cursor: null, total: 0 });
    if (at === "/platform/v1/vehicle-group-options") return json(200, { items: [] });
    return null;
  };
}

const masterCityCalls = (calls: ApiCall[]): string[] => calls.map((call) => call.path).filter((path) => path.startsWith("/platform/v1/master/cities"));
const approvalCalls = (calls: ApiCall[]): string[] => calls.map((call) => call.path).filter((path) => path.startsWith("/platform/v1/approvals"));
const optionNames = (listbox: HTMLElement): string[] => within(listbox).queryAllByRole("option").map((option) => option.querySelector(".combobox__option-label")?.textContent ?? "");

test("自建角色只有渠道查看和编辑（没有主数据查看）：新建渠道「只卖选中的城市」能列出城市并选上，不请求主数据的城市列表", async () => {
  const actor = userEvent.setup();
  const calls = openApp("/platform/channels/new", "platform", CUSTOM, routes([TOKYO, OSAKA]), CHANNEL_EDITOR);
  await actor.click(await screen.findByRole("radio", { name: "只卖选中的城市" }));
  const box = await screen.findByRole("combobox", { name: /城市/ });
  await actor.click(box);
  await waitFor(() => assert.deepEqual(optionNames(screen.getByRole("listbox", { name: "城市" })), ["大阪", "东京"]));
  await actor.type(box, "东京{Enter}");
  assert.deepEqual(within(screen.getByRole("list", { name: "已选的城市（1 个）" })).getAllByRole("listitem").map((item) => item.textContent), ["东京"]);
  assert.deepEqual(masterCityCalls(calls), []);
  assert.doesNotMatch(document.body.textContent ?? "", /平台还没有启用中的城市/);
});

test("数据范围限定了城市、范围里没有启用中的城市：城市框写「你的数据范围里没有启用中的城市」，不说平台没有", async () => {
  const actor = userEvent.setup();
  openApp("/platform/channels/new", "platform", CUSTOM, routes([]), CHANNEL_EDITOR, { city_ids: [NAGOYA.id], channel_ids: null });
  await actor.click(await screen.findByRole("radio", { name: "只卖选中的城市" }));
  await actor.click(await screen.findByRole("combobox", { name: /城市/ }));
  assert.ok(await screen.findByText("你的数据范围里没有启用中的城市。需要的话，请联系管理员调整你的角色的数据范围。"));
  assert.doesNotMatch(document.body.textContent ?? "", /平台还没有启用中的城市/);
});

test("不限数据范围、平台确实没有启用中的城市：写「平台还没有启用中的城市」", async () => {
  const actor = userEvent.setup();
  openApp("/platform/channels/new", "platform", "channel_manager", routes([]));
  await actor.click(await screen.findByRole("radio", { name: "只卖选中的城市" }));
  await actor.click(await screen.findByRole("combobox", { name: /城市/ }));
  assert.ok(await screen.findByText("平台还没有启用中的城市"));
});

test("编辑渠道：原来授权的城市里，停用的、不在自己数据范围里的不在选项里，标签上写明原因；不动就照原样保存", async () => {
  const actor = userEvent.setup();
  const detail: ChannelDetail = { channel: channelOf({ scope: { ...channelOf().scope, cities: [{ id: TOKYO.id, name: "东京" }, NAGOYA, SEOUL] } }), markup_rules: [] };
  const calls = openApp(
    `/platform/channels/${CHANNEL_ID}/edit`,
    "platform",
    CUSTOM,
    routes([TOKYO], detail, (call) => (call.method === "PATCH" && call.url.pathname === `/platform/v1/channels/${CHANNEL_ID}` ? json(200, detail) : null)),
    CHANNEL_EDITOR,
    { city_ids: [TOKYO.id, NAGOYA.id], channel_ids: null },
  );
  const chips = await screen.findByRole("list", { name: "已选的城市（3 个）" });
  await waitFor(() => assert.deepEqual(within(chips).getAllByRole("listitem").map((item) => item.textContent), ["东京", "名古屋（已停用）", "首尔（不在你的数据范围里）"]));
  await actor.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() => assert.equal(calls.filter((call) => call.method === "PATCH").length, 1));
  const body = calls.find((call) => call.method === "PATCH")?.body as { scope: { city_ids: string[] } };
  assert.deepEqual(body.scope.city_ids, [TOKYO.id, NAGOYA.id, SEOUL.id]);
  assert.deepEqual(masterCityCalls(calls), []);
});

test("渠道详情：角色没有「看待审核的改动」时不请求待审核（复核记录、加价规则对话框里的提醒都不取），复核记录一栏写明原因", async () => {
  const actor = userEvent.setup();
  const detail: ChannelDetail = { channel: channelOf(), markup_rules: [ruleOf()] };
  const calls = openApp(`/platform/channels/${CHANNEL_ID}`, "platform", CUSTOM, routes([TOKYO, OSAKA], detail), CHANNEL_EDITOR);
  await screen.findByRole("heading", { level: 1, name: "测试渠道" });
  assert.ok(await screen.findByText("你的角色没有「看待审核的改动」这项权限，看不到这个渠道的复核记录。需要的话，请联系管理员调整角色。"));
  assert.equal(screen.queryByRole("link", { name: /去待审核/ }), null);
  await actor.click(screen.getByRole("button", { name: /新增加价规则/ }));
  const dialog = await screen.findByRole("dialog", { name: "新增加价规则" });
  await actor.click(within(dialog).getByRole("combobox", { name: /城市/ }));
  await waitFor(() => assert.deepEqual(optionNames(within(dialog).getByRole("listbox", { name: "城市" })), ["大阪", "东京"]));
  assert.deepEqual(approvalCalls(calls), []);
  assert.deepEqual(masterCityCalls(calls), []);
});

test("渠道详情：有「看待审核的改动」的角色照常取复核记录", async () => {
  const calls = openApp(`/platform/channels/${CHANNEL_ID}`, "platform", CUSTOM, routes([TOKYO], undefined, (call) => (call.method === "GET" && call.url.pathname === "/platform/v1/approvals" ? json(200, { items: [], next_cursor: null, total: 0 }) : null)), [...CHANNEL_EDITOR, "approval.read"]);
  assert.ok(await screen.findByText("还没有发起过复核。"));
  assert.ok(approvalCalls(calls).length > 0);
});

test("修改加价规则：原来的城市已停用（不在选项里），仍留着并写明「已停用」", async () => {
  const actor = userEvent.setup();
  openApp(`/platform/channels/${CHANNEL_ID}`, "platform", CUSTOM, routes([TOKYO], { channel: channelOf(), markup_rules: [ruleOf()] }), CHANNEL_EDITOR);
  await actor.click(await screen.findByRole("button", { name: /^修改 / }));
  const dialog = await screen.findByRole("dialog", { name: "修改加价规则" });
  const city = within(dialog).getByRole("combobox", { name: /城市/ }) as HTMLInputElement;
  await waitFor(() => assert.equal(city.value, "名古屋（已停用）"));
});

test("自建角色只有订单查看：订单列表的城市筛选列出城市选项，不请求主数据；限定了城市只列范围里的（由后端给）", async () => {
  const actor = userEvent.setup();
  const calls = openApp("/platform/orders", "platform", CUSTOM, routes([OSAKA]), ["order.read"], { city_ids: [OSAKA.id], channel_ids: null });
  const box = await screen.findByRole("combobox", { name: "城市" });
  await actor.click(box);
  await waitFor(() => assert.deepEqual(optionNames(screen.getByRole("listbox", { name: "城市" })), ["全部", "大阪"]));
  assert.ok(calls.some((call) => call.path === "/platform/v1/city-options?include_disabled=true"), "列表筛选连已停用的城市也要");
  assert.deepEqual(masterCityCalls(calls), []);
});

test("没有订单查看的人打开订单列表：不请求城市选项", async () => {
  const calls = openApp("/platform/orders", "platform", CUSTOM, routes([TOKYO]), ["channel.read"]);
  assert.ok(await screen.findByText(/你没有权限查看这里/));
  assert.ok(!calls.some((call) => call.path.startsWith("/platform/v1/city-options")));
  assert.ok(calls.some((call) => call.path === "/platform/v1/auth/me"));
});

test("自建角色只有角色查看和编辑：编辑角色的数据范围时城市选项来自城市选项接口；角色原来选的、已停用的城市写明「已停用」", async () => {
  const actor = userEvent.setup();
  const role = {
    key: "custom_observer",
    name: "渠道观察员",
    builtin: false,
    description: null,
    grants: ["orders:view"],
    permissions: ["order.read"],
    data_scope: { city_ids: [TOKYO.id, NAGOYA.id], channel_ids: null, cities: [{ id: TOKYO.id, name: "东京" }, NAGOYA], channels: [] },
    ip_allowlist: [],
    version: 1,
    staff_count: 0,
    ...stamps,
  };
  const calls = openApp("/platform/settings/roles/custom_observer", "platform", CUSTOM, routes([TOKYO, OSAKA], undefined, (call) => (call.method === "GET" && call.url.pathname === "/platform/v1/roles/custom_observer" ? json(200, role) : null)), ["role.read", "role.manage"]);
  const chips = await screen.findByRole("list", { name: "已选的城市（2 个）" });
  await waitFor(() => assert.deepEqual(within(chips).getAllByRole("listitem").map((item) => item.textContent), ["东京", "名古屋（已停用）"]));
  await actor.click(screen.getByRole("combobox", { name: /城市/ }));
  await waitFor(() => assert.deepEqual(optionNames(screen.getByRole("listbox", { name: "城市" })), ["大阪"]));
  assert.deepEqual(masterCityCalls(calls), []);
});

test("修改加价规则：原来的车型组已停用（车型组选项里没有），仍选着并写明「已停用」；车型组来自车型组选项、不请求主数据", async () => {
  const actor = userEvent.setup();
  const LUX = { id: "35353535-3535-4535-8535-353535353535", name: "豪华四座" };
  const calls = openApp(`/platform/channels/${CHANNEL_ID}`, "platform", CUSTOM, routes([TOKYO], { channel: channelOf(), markup_rules: [ruleOf({ level: 3, city: { id: TOKYO.id, name: "东京" }, vehicle_group: LUX })] }), CHANNEL_EDITOR);
  await actor.click(await screen.findByRole("button", { name: /^修改 / }));
  const dialog = await screen.findByRole("dialog", { name: "修改加价规则" });
  const select = within(dialog).getByRole("combobox", { name: /车型组/ }) as HTMLSelectElement;
  await waitFor(() => assert.equal(select.selectedOptions[0]?.textContent, "豪华四座（已停用）"));
  assert.ok(calls.some((call) => call.path === "/platform/v1/vehicle-group-options"));
  assert.ok(!calls.some((call) => call.path.startsWith("/platform/v1/master/")));
});

test("订单列表的城市筛选：连已停用的城市也列出（筛历史订单），名字后面标「（已停用）」", async () => {
  const actor = userEvent.setup();
  const nagoya = { id: NAGOYA.id, code: "CTY-JP-NGO", name: { zh: "名古屋" }, country_code: "JP", timezone: "Asia/Tokyo", status: "disabled" as const };
  openApp("/platform/orders", "platform", CUSTOM, routes([{ ...TOKYO, status: "active" } as SelectableCity, nagoya]), ["order.read"]);
  await actor.click(await screen.findByRole("combobox", { name: "城市" }));
  await waitFor(() => assert.deepEqual(optionNames(screen.getByRole("listbox", { name: "城市" })), ["全部", "东京", "名古屋（已停用）"]));
});
