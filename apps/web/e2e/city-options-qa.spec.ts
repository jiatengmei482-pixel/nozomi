/**
 * 测试角色（M4-13，ADR 0047）端到端：自建角色没有「主数据 · 查看」时的下拉框，真实浏览器 → 真实 API → 真实 PostgreSQL。
 * - 只勾渠道编辑：新建渠道能选城市并建成，授权范围写进去；
 * - 限定了城市的员工：报价试算、新建渠道、订单筛选只看到范围内的城市，报价试算只看到范围内城市的机场；
 * - 限定到没有启用中城市的范围：提示真实原因，不说「平台还没有启用中的城市」；
 * - 渠道详情：没有「待审核」权限时记录全部网络请求，没有被拒的请求、也不请求待审核接口；有权限时才请求（对照）。
 * 数据经接口现建在本次运行的临时 schema 里，城市、渠道名带随机后缀，不依赖其他用例。
 */
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { CENTER, type World, createWorld } from "./catalog.ts";
import { createTestCity, loginAs, newPassword, platformAdminHeaders, uniqueEmail } from "./support.ts";

const PLATFORM_DEFAULT_EMPTY = "平台还没有启用中的城市";

interface Staff {
  email: string;
  password: string;
}

/** 建一个自建角色和用它的员工（邀请 → 设密码）。 */
async function customStaff(request: APIRequestContext, grants: string[], cityIds: string[] | null = null): Promise<Staff> {
  const headers = await platformAdminHeaders(request);
  const role = await request.post("/platform/v1/roles", { headers, data: { name: `QA ${crypto.randomUUID().slice(0, 8)}`, grants, data_scope: { city_ids: cityIds, channel_ids: null } } });
  expect(role.status(), await role.text()).toBe(201);
  const email = uniqueEmail("m413-qa");
  const created = await request.post("/platform/v1/staff", { headers, data: { email, name: "选项测试员", role: ((await role.json()) as { key: string }).key } });
  expect(created.status(), await created.text()).toBe(201);
  const password = newPassword();
  const invite = ((await created.json()) as { invite: { token: string } }).invite.token;
  expect((await request.post("/platform/v1/auth/accept-invite", { data: { token: invite, password } })).ok()).toBe(true);
  return { email, password };
}

/** 一个已停用的城市（没有地点）。 */
async function disabledCity(request: APIRequestContext): Promise<{ id: string; name: string }> {
  const headers = await platformAdminHeaders(request);
  const { id, name } = await createTestCity(request, headers, (tag) => ({ name: { zh: `已停用城市${tag}` }, timezone: "Asia/Tokyo", center: CENTER }));
  expect((await request.post(`/platform/v1/master/cities/${id}/disable`, { headers })).ok()).toBe(true);
  return { id, name };
}

async function createChannel(request: APIRequestContext): Promise<{ id: string; name: string }> {
  const name = `QA 选项渠道 ${crypto.randomUUID().slice(0, 6)}`;
  const created = await request.post("/platform/v1/channels", { headers: await platformAdminHeaders(request), data: { name, type: "own", settle_currency: "JPY" } });
  expect(created.status(), await created.text()).toBe(201);
  return { id: ((await created.json()) as { channel: { id: string } }).channel.id, name };
}

/** 记录登录之后所有打到平台接口的请求（方法、路径、状态码）。 */
function recordApiCalls(page: Page): { method: string; path: string; status: number }[] {
  const calls: { method: string; path: string; status: number }[] = [];
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith("/platform/v1/")) calls.push({ method: response.request().method(), path: url.pathname + url.search, status: response.status() });
  });
  return calls;
}

const rejected = (calls: readonly { status: number }[]) => calls.filter((call) => call.status >= 400);
const masterCalls = (calls: readonly { path: string }[]) => calls.filter((call) => call.path.startsWith("/platform/v1/master/"));

/** 打开下拉框，返回里面的选项文字；`note` 是没有选项时写的话。 */
async function openCombobox(page: Page, name: RegExp | string): Promise<{ options: string[]; note: string }> {
  const box = page.getByRole("combobox", { name });
  await box.click();
  const list = page.getByRole("listbox", { name });
  await expect(list).toBeVisible();
  await expect(list.locator(".combobox__note").filter({ hasText: "加载中" })).toHaveCount(0);
  const options = (await list.getByRole("option").locator(".combobox__option-label").allTextContents()).map((text) => text.trim());
  const note = ((await list.locator(".combobox__note").allTextContents()).join("")).trim();
  await page.keyboard.press("Escape");
  return { options, note };
}

test("只勾渠道编辑、没勾主数据查看：新建渠道选「只卖选中的城市」能选到城市并建成，授权范围写进去；整个过程没有被拒的请求，也不碰主数据接口", async ({ page, request }) => {
  test.setTimeout(120_000);
  const world: World = await createWorld(request);
  const staff = await customStaff(request, ["channels:view", "channels:edit"]);
  await loginAs(page, "platform", staff.email, staff.password);
  const calls = recordApiCalls(page);

  await page.goto("/platform/channels/new");
  const name = `QA 只卖选中 ${crypto.randomUUID().slice(0, 6)}`;
  await page.getByRole("textbox", { name: "名称" }).fill(name);
  await page.getByRole("radio", { name: /^自营/ }).check();
  await page.getByRole("radio", { name: "只卖选中的城市" }).check();
  const cityBox = page.getByRole("combobox", { name: /^城市/ });
  await cityBox.click();
  await cityBox.fill(world.city.code);
  await page.getByRole("option", { name: new RegExp(world.city.name) }).first().click();
  await expect(page.getByRole("list", { name: /已选的城市（1 个）/ })).toContainText(world.city.name);
  await expect(page.getByText(PLATFORM_DEFAULT_EMPTY)).toHaveCount(0);
  await page.getByRole("group", { name: /^可卖的品类/ }).getByRole("checkbox", { name: "接送机" }).check();
  await page.getByRole("button", { name: "新建", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

  const id = /\/platform\/channels\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? "";
  const saved = await request.get(`/platform/v1/channels/${id}`, { headers: await platformAdminHeaders(request) });
  expect(saved.status()).toBe(200);
  expect(await saved.text()).toContain(world.city.id);

  expect(calls.some((call) => call.path === "/platform/v1/city-options" && call.status === 200), JSON.stringify(calls)).toBe(true);
  expect(rejected(calls), "没有被拒的请求").toEqual([]);
  expect(masterCalls(calls), "不碰主数据接口").toEqual([]);
});

test("限定了城市的员工：报价试算、新建渠道、订单筛选的城市框只有范围内的一个城市；报价试算的机场只有这个城市的；请求都带不出范围外的数据", async ({ page, request }) => {
  test.setTimeout(150_000);
  const inside = await createWorld(request);
  const outside = await createWorld(request);
  const staff = await customStaff(request, ["quote_preview:view", "orders:view", "channels:view", "channels:edit"], [inside.city.id]);
  await loginAs(page, "platform", staff.email, staff.password);
  const calls = recordApiCalls(page);

  await page.goto("/platform/quote-preview");
  await expect(page.getByRole("heading", { level: 1, name: "报价试算" })).toBeVisible();
  const quoteCities = await openCombobox(page, /^城市/);
  expect(quoteCities.options).toHaveLength(1);
  expect(quoteCities.options[0]).toContain(inside.city.name);
  const quoteBox = page.getByRole("combobox", { name: /^城市/ });
  await quoteBox.click();
  await quoteBox.fill(outside.city.code);
  await expect(page.getByRole("option", { name: new RegExp(outside.city.name) })).toHaveCount(0);
  await quoteBox.fill(inside.city.code);
  await page.getByRole("option", { name: new RegExp(inside.city.name) }).first().click();
  await page.getByRole("radio", { name: "接送机" }).check();

  const places = await openCombobox(page, /^机场或车站/);
  expect(places.options).toHaveLength(1);
  expect(places.options[0]).toContain(inside.airport.name);

  await page.goto("/platform/channels/new");
  await page.getByRole("radio", { name: "只卖选中的城市" }).check();
  const channelCities = await openCombobox(page, /^城市/);
  expect(channelCities.options).toHaveLength(1);
  expect(channelCities.options[0]).toContain(inside.city.name);

  await page.goto("/platform/orders");
  await expect(page.getByRole("heading", { level: 1, name: "订单" })).toBeVisible();
  const orderCities = await openCombobox(page, "城市");
  expect(orderCities.options, "「全部」是筛选框的清除项，不算城市").toEqual(["全部", expect.stringContaining(inside.city.name)]);

  expect(calls.some((call) => call.path.startsWith("/platform/v1/place-options") && call.path.includes(inside.city.id) && call.status === 200), JSON.stringify(calls)).toBe(true);
  expect(calls.some((call) => call.path.includes(outside.city.id))).toBe(false);
  expect(rejected(calls), "没有被拒的请求").toEqual([]);
  expect(masterCalls(calls), "不碰主数据接口").toEqual([]);
});

test("范围里只有已停用的城市：选城市的框说「你的数据范围里没有启用中的城市」，不说平台没有；订单筛选列出它并标（已停用）", async ({ page, request }) => {
  test.setTimeout(120_000);
  const stopped = await disabledCity(request);
  const staff = await customStaff(request, ["quote_preview:view", "orders:view", "channels:view", "channels:edit"], [stopped.id]);
  await loginAs(page, "platform", staff.email, staff.password);

  await page.goto("/platform/quote-preview");
  await expect(page.getByRole("heading", { level: 1, name: "报价试算" })).toBeVisible();
  const quote = await openCombobox(page, /^城市/);
  expect(quote.options).toEqual([]);
  expect(quote.note).toContain("你的数据范围里没有启用中的城市");
  expect(quote.note).not.toContain(PLATFORM_DEFAULT_EMPTY);

  await page.goto("/platform/channels/new");
  await page.getByRole("radio", { name: "只卖选中的城市" }).check();
  const channel = await openCombobox(page, /^城市/);
  expect(channel.options).toEqual([]);
  expect(channel.note).toContain("你的数据范围里没有启用中的城市");

  await page.goto("/platform/orders");
  await expect(page.getByRole("heading", { level: 1, name: "订单" })).toBeVisible();
  const orders = await openCombobox(page, "城市");
  expect(orders.options, "「全部」是筛选框的清除项，不算城市").toEqual(["全部", `${stopped.name}（已停用）`]);
});

test("范围是空的（一个城市都没有）：报价试算说是数据范围的问题，不说平台没有", async ({ page, request }) => {
  test.setTimeout(120_000);
  const staff = await customStaff(request, ["quote_preview:view"], []);
  await loginAs(page, "platform", staff.email, staff.password);
  await page.goto("/platform/quote-preview");
  await expect(page.getByRole("heading", { level: 1, name: "报价试算" })).toBeVisible();
  const quote = await openCombobox(page, /^城市/);
  expect(quote.options).toEqual([]);
  expect(quote.note).toContain("你的数据范围里没有启用中的城市");
});

/** M4-13：订单和商品列表的城市框带「全部」；数据范围为空时，除了「全部」还要写明「你的数据范围里没有城市…」（Combobox 的 emptyText）。 */
test("范围是空的：订单和商品列表的城市筛选说明是数据范围里没有城市", async ({ page, request }) => {
  test.setTimeout(120_000);
  const staff = await customStaff(request, ["orders:view", "products:view"], []);
  await loginAs(page, "platform", staff.email, staff.password);
  for (const [path, heading] of [["/platform/orders", "订单"], ["/platform/products", "商品"]] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    const filter = await openCombobox(page, "城市");
    expect.soft(filter.note, `${heading}列表的城市筛选`).toContain("你的数据范围里没有城市");
  }
});

test("渠道详情：只有渠道查看和编辑（没有待审核权限）时，打开详情、定价对话框、加价规则对话框都没有被拒的请求，也不请求待审核接口；页面说明看不到复核记录的原因", async ({ page, request }) => {
  test.setTimeout(120_000);
  const channel = await createChannel(request);
  const staff = await customStaff(request, ["channels:view", "channels:edit"]);
  await loginAs(page, "platform", staff.email, staff.password);
  const calls = recordApiCalls(page);

  await page.goto(`/platform/channels/${channel.id}`);
  await expect(page.getByRole("heading", { level: 1, name: channel.name })).toBeVisible();
  await expect(page.getByText("你的角色没有「看待审核的改动」这项权限")).toBeVisible();
  await page.getByRole("button", { name: /新增加价规则/ }).click();
  const ruleDialog = page.getByRole("dialog", { name: "新增加价规则" });
  await expect(ruleDialog).toBeVisible();
  await ruleDialog.getByRole("radio", { name: /第 1 级/ }).check();
  await expect(ruleDialog.getByRole("combobox", { name: /^城市/ })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await ruleDialog.getByRole("button", { name: "取消" }).click();

  await page.getByRole("button", { name: "申请修改定价参数" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.waitForLoadState("networkidle");

  expect(calls.length, "监听确实记录到了请求").toBeGreaterThan(0);
  expect(calls.some((call) => call.path === "/platform/v1/vehicle-group-options" && call.status === 200), JSON.stringify(calls)).toBe(true);
  expect(calls.filter((call) => call.path.startsWith("/platform/v1/approvals")), "不请求待审核接口").toEqual([]);
  expect(rejected(calls), "没有被拒的请求").toEqual([]);
  expect(masterCalls(calls), "不碰主数据接口").toEqual([]);
});

test("渠道详情：只有渠道查看（不能编辑）时没有被拒的请求，不去取城市、车型组选项；有待审核权限的角色才请求待审核接口（对照）", async ({ page, request, browser }) => {
  test.setTimeout(150_000);
  const channel = await createChannel(request);
  const viewer = await customStaff(request, ["channels:view"]);
  await loginAs(page, "platform", viewer.email, viewer.password);
  const calls = recordApiCalls(page);
  await page.goto(`/platform/channels/${channel.id}`);
  await expect(page.getByRole("heading", { level: 1, name: channel.name })).toBeVisible();
  await expect(page.getByText("你的角色没有「看待审核的改动」这项权限")).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(calls.length).toBeGreaterThan(0);
  expect(rejected(calls), "没有被拒的请求").toEqual([]);
  expect(calls.filter((call) => /city-options|vehicle-group-options|approvals/.test(call.path))).toEqual([]);

  const reviewer = await customStaff(request, ["channels:view", "approvals:view"]);
  const context = await browser.newContext();
  const other = await context.newPage();
  await loginAs(other, "platform", reviewer.email, reviewer.password);
  const otherCalls = recordApiCalls(other);
  await other.goto(`/platform/channels/${channel.id}`);
  await expect(other.getByRole("heading", { level: 2, name: /复核记录/ })).toBeVisible();
  await expect(other.getByText("还没有发起过复核。")).toBeVisible();
  expect(otherCalls.some((call) => call.path.startsWith("/platform/v1/approvals") && call.status === 200), JSON.stringify(otherCalls)).toBe(true);
  expect(rejected(otherCalls)).toEqual([]);
  await context.close();
});
