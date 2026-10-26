/**
 * 运营后台「商品」（只读查看）和「报价试算」的组件测试：菜单和首页卡片按权限显示、列表和筛选、详情各步骤只读且没有任何修改的入口、
 * 供应商详情里的「商品」一栏、试算的表单校验、结果和报不出价的原因。
 * 接口用测试替身；真实后端由端到端测试 e2e/platform-products.spec.ts 覆盖。
 */
import { roleName } from "../../lib/portal.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../App.tsx";
import type { Addon, City, Place, VehicleGroup } from "../../api/master.ts";
import type { PlatformProductDetail, PlatformProductSummary } from "../../api/platform-products.ts";
import type { AdjustRuleBody, PriceRuleBody } from "../../api/prices.ts";
import type { Product, PublishCheckItemBody } from "../../api/products.ts";
import type { PlatformQuotePreview, QuoteCandidate } from "../../api/quotes.ts";
import type { PlatformUser, Tenant } from "../../api/types.ts";
import { type ApiCall, apiError, assertAbsent, json, resetBrowser, signIn, stubApiWith, TENANT_EXTRAS } from "../../testing/harness.tsx";

afterEach(resetBrowser);

const stamps = { created_at: "2026-10-06T00:12:00.000Z", updated_at: "2026-10-08T05:30:00.000Z" };
const TENANT_ID = "7b1c2d3e-aaaa-4bbb-8ccc-ddddeeeeffff";
const TENANT2_ID = "8c2d3e4f-aaaa-4bbb-8ccc-ddddeeeeffff";
const PRODUCT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PRODUCT2_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CITY_ID = "11111111-1111-4111-8111-111111111111";
const POI_ID = "22222222-2222-4222-8222-222222222222";
const BRAND_ID = "33333333-3333-4333-8333-333333333333";
const AREA_ID = "44444444-4444-4444-8444-444444444444";
const GROUP_ID = "55555555-5555-4555-8555-555555555555";
const ADDON_ID = "66666666-6666-4666-8666-666666666666";
const PRICE_ID = "77777777-7777-4777-8777-777777777777";
const RULE_ID = "88888888-8888-4888-8888-888888888888";
const ME_ID = "99999999-9999-4999-8999-999999999999";

const meOf = (role: string): PlatformUser => ({ id: ME_ID, email: "kato@example.com", name: "加藤 美咲", role, role_name: roleName("platform", role) ?? role, status: "active", ...stamps });
const tenantOf = (changes: Partial<Tenant> = {}): Tenant => ({ id: TENANT_ID, name: "NOZOMI 自营车队", status: "active", ...TENANT_EXTRAS, ...stamps, ...changes });
const tokyo: City = { id: CITY_ID, code: "CTY-JP-TYO", country_code: "JP", name: { zh: "东京" }, timezone: "Asia/Tokyo", center: { lng: 139.7, lat: 35.7 }, boundary: null, status: "active", version: 1, ...stamps };
const haneda = { id: POI_ID, type: "airport", code: "HND", country_code: "JP", city_id: CITY_ID, parent_id: null, city: null, parent: null, name: { zh: "羽田机场" }, location: { lng: 139.78, lat: 35.55 }, category: null, flight_scope: "mixed", address: null, source: null, status: "active", version: 1, ...stamps } as unknown as Place;
const group: VehicleGroup = { id: GROUP_ID, code: "VG-BIZ-7", grade: "business", seats: 7, name: { zh: "商务七座" }, sample_models: ["丰田埃尔法"], power: "fuel", combos: [{ passengers: 6, luggage: 4 }], status: "active", version: 1, ...stamps };
const seat: Addon = { id: ADDON_ID, code: "ADD-SEAT", categories: ["airport_transfer"], charge_unit: "per_item", name: { zh: "儿童座椅" }, description: {}, status: "active", version: 1, ...stamps };

const base = {
  id: PRODUCT_ID,
  code: "PRD202610081430050001",
  status: "published" as const,
  category: "airport_transfer" as const,
  title: { zh: "羽田机场接送" },
  brand_id: BRAND_ID,
  brand: { id: BRAND_ID, name: "NOZOMI", currency: "JPY", status: "active" as const },
  city_id: CITY_ID,
  city: { id: CITY_ID, code: tokyo.code, name: tokyo.name, country_code: "JP", timezone: "Asia/Tokyo", status: "active" as const },
  poi_id: POI_ID,
  poi: { id: POI_ID, code: "HND", name: { zh: "羽田机场" }, type: "airport" as const, flight_scope: "mixed" as const, status: "active" as const },
  area_count: 1,
  vehicle_group_count: 1,
  version: 12,
  published_at: "2026-10-07T01:00:00.000Z",
  ...stamps,
};
const rowOf = (changes: Partial<PlatformProductSummary> = {}): PlatformProductSummary => ({ ...base, tenant_id: TENANT_ID, tenant: { id: TENANT_ID, name: "NOZOMI 自营车队", status: "active" }, has_active_price: true, active_price_rule_count: 2, ...changes });
const productOf = (changes: Partial<Product> = {}): Product => ({
  ...base,
  areas: [{ area_id: AREA_ID, priority: 0, name: { zh: "东京 23 区" }, biz_type: "general", status: "active" }],
  vehicle_groups: [{ vehicle_group_id: GROUP_ID, passengers: 6, luggage: 4, code: group.code, name: group.name, grade: "business", seats: 7, sample_models: group.sample_models, combos: group.combos, status: "active" }],
  dispatchers: [{ name: "山田", phone: "+81 90 1234 5678" }],
  ...changes,
});
const item = (key: string, issues: { path: string; reason: string }[] = [], required = true): PublishCheckItemBody => ({ key, required, passed: issues.length === 0, issues: issues.map((issue) => ({ ...issue, message: "说明" })) });
const priceOf = (changes: Partial<PriceRuleBody> = {}): PriceRuleBody => ({ id: PRICE_ID, area_id: AREA_ID, vehicle_group_id: GROUP_ID, direction: "both", package_hours: null, pricing_model: "fixed", base_price: 20000, start_price: null, start_meters: null, start_minutes: null, per_km: null, per_minute: null, min_price: null, package_km: null, package_price: null, overtime_per_hour: null, over_km_per_km: null, valid_from: "2026-10-01", valid_to: null, status: "enabled", base: "20000", ...stamps, ...changes });
const adjustOf = (changes: Partial<AdjustRuleBody> = {}): AdjustRuleBody => ({ id: RULE_ID, name: "国庆旺季", travel_from: "2026-10-01", travel_to: "2027-10-07", cycle: { type: "daily" }, time_slot: null, area_ids: [], vehicle_group_ids: [], directions: [], package_hours: [], steps: [{ type: "percent", value: 2000 }], status: "enabled", ended: false, ...stamps, ...changes });
const detailOf = (changes: Partial<PlatformProductDetail> = {}): PlatformProductDetail => ({
  tenant: { id: TENANT_ID, name: "NOZOMI 自营车队", status: "active" },
  product: productOf(),
  service_rules: {
    version: 12,
    currency: "JPY",
    free_wait_minimums: { pickup: 60, dropoff: 15, general: null },
    rules: {
      booking: { sale_from: null, sale_to: null, service_time: { start: "06:00", end: "23:00" }, lead_time_hours: 24, note: null },
      urgent: { enabled: false, daily_quota: null, tiers: [] },
      night: { enabled: false, window: null, amount: null, charge_unit: null },
      free_wait: { pickup: { mode: "limited", minutes: 60 }, dropoff: { mode: "limited", minutes: 15 }, general: null },
      addons: [{ addon_id: ADDON_ID, enabled: true, unit_price: 1000, first_free: false }],
      driver_languages: [],
    },
  },
  content: { zh: { title: "羽田机场接送", summary: "机场到市区", includes: ["高速费"], excludes: [], itinerary: null, pickup_guide: "到达大厅 2 号出口" } },
  price_rules: { version: 12, currency: "JPY", rounding_unit: 100, available_models: ["fixed", "mileage_time"], today: "2026-10-15", items: [priceOf()], coverage: { total: 1, priced: 1, missing: 0 } },
  adjust_rules: { version: 12, currency: "JPY", rounding_unit: 100, today: "2026-10-15", items: [adjustOf()] },
  inventory: { mode: "limited", sellable_days_ahead: 30 },
  publish_check: { can_publish: true, items: [item("basic_info"), item("service_rules"), item("price_rules"), item("content"), item("adjust_rules", [], false), item("inventory", [], false)] },
  ...changes,
});
const page = <T,>(items: T[], total = items.length, nextCursor: string | null = null) => json(200, { items, next_cursor: nextCursor, total });

type Route = (call: ApiCall & { url: URL }) => Response | Promise<Response> | null;
/** 登录成指定角色并渲染；没接住的接口里，账号、首页数量、主数据、供应商、商品有默认应答。 */
function open(path: string, role: string, routes: Route = () => null): ApiCall[] {
  signIn("platform", "platform-token");
  const calls = stubApiWith((call) => {
    const custom = routes(call);
    if (custom !== null) return custom;
    if (call.method !== "GET") return null;
    const at = call.url.pathname;
    if (at === "/platform/v1/auth/me") return json(200, { user: meOf(role), permissions: [], must_change_password: false });
    if (at === "/platform/v1/dashboard/summary") return json(200, { tenants: { active: 2, suspended: 0 }, master_data: null });
    if (at === "/platform/v1/tenants") return json(200, { items: [tenantOf(), tenantOf({ id: TENANT2_ID, name: "Relaxcar" })], next_cursor: null });
    if (at === `/platform/v1/tenants/${TENANT_ID}`) return json(200, tenantOf());
    if (at === "/platform/v1/master/cities") return page([tokyo]);
    if (at === "/platform/v1/master/places") return page([haneda]);
    if (at === "/platform/v1/master/vehicle-groups") return page([group]);
    if (at === "/platform/v1/master/addons") return page([seat]);
    if (at === "/platform/v1/holidays") return json(200, { items: [], countries: [] });
    if (at === "/platform/v1/products") return page([rowOf(), rowOf({ id: PRODUCT2_ID, code: "PRD202610091200000002", title: {}, category: "charter", poi: null, poi_id: null, status: "draft", published_at: null, tenant_id: TENANT2_ID, tenant: { id: TENANT2_ID, name: "Relaxcar", status: "suspended" }, has_active_price: false, active_price_rule_count: 0 })], 2);
    if (at === `/platform/v1/products/${PRODUCT_ID}`) return json(200, detailOf());
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
const productCalls = (calls: ApiCall[]): URLSearchParams[] => calls.filter((call) => call.method === "GET" && call.path.startsWith("/platform/v1/products?")).map((call) => new URL(call.path, "http://localhost").searchParams);

/** 页面上没有任何修改的入口：没有这些按钮、链接，没有能输入的框，也没有发出任何写请求、没有碰供应商的接口。 */
function assertNoEditing(calls: ApiCall[], what: string): void {
  const main = screen.getByRole("main");
  const editWords = /^(保存|保存草稿|保存并下一步|保存并看上架检查|上架|下架|删除|新建|编辑|修改|添加.*|新建调价规则|批量设置|导入.*|载入最新内容.*|复制一条|去填|去修改|去改|去设|更多)$/;
  const actions = within(main)
    .queryAllByRole("button")
    .concat(within(main).queryAllByRole("link"))
    .map((node) => (node.textContent ?? "").trim())
    .filter((text) => editWords.test(text));
  assert.deepEqual(actions, [], `${what}：不能有修改的入口`);
  // 只改「怎么看」的控件（价格表的筛选、覆盖表的看法、显示已结束的、调价规则拿哪个价来试算）不算修改的入口
  const editable = [...main.querySelectorAll("input, textarea, select")].filter((node) => !(node as HTMLInputElement).readOnly && !(node as HTMLInputElement).disabled && !node.closest(".price-filters, .adjust-list__ended, .filter-bar, .adjust-trial__pick") && node.getAttribute("name") !== "coverage-view");
  assert.deepEqual(
    editable.map((node) => node.getAttribute("aria-label") ?? node.getAttribute("id") ?? node.outerHTML.slice(0, 160)),
    [],
    `${what}：不能有能输入的框`,
  );
  assert.deepEqual(calls.filter((call) => call.method !== "GET").map((call) => `${call.method} ${call.path}`), [], `${what}：不能有写请求`);
  assert.deepEqual(calls.filter((call) => call.path.startsWith("/tenant/v1")).map((call) => call.path), [], `${what}：不能调供应商后台的接口`);
}

// ───────────── 菜单、首页 ─────────────

test("菜单和首页按权限：超级管理员有「商品」「报价试算」，首页商品卡片是已上架数、报不出价的提醒去筛好的列表；只读角色有商品没有试算；财务两个都没有", async () => {
  const calls = open("/platform", "super_admin", (call) => (call.method === "GET" && call.url.pathname === "/platform/v1/products" ? page([], call.url.searchParams.get("has_active_price") === "false" ? 2 : 7) : null));
  const card = (await screen.findByRole("link", { name: "商品", description: /已上架/ })) as HTMLAnchorElement;
  assert.equal(card.getAttribute("href"), "/platform/products?status=published");
  await waitFor(() => assert.match(card.closest(".entry-card")?.textContent ?? "", /已上架7/));
  const reminder = screen.getByRole("link", { name: "2 个已上架的商品报不出价" });
  assert.equal(reminder.getAttribute("href"), "/platform/products?status=published&priced=no");
  assert.deepEqual(
    productCalls(calls).map((params) => Object.fromEntries(params)),
    [
      { status: "published", limit: "1" },
      { status: "published", has_active_price: "false", limit: "1" },
    ],
  );
  assert.deepEqual(menuLabels().slice(0, 5), ["首页", "供应商", "资质审核", "商品", "报价试算"]);

  // 一个都没有报不出价的：没有提醒行
  resetBrowser();
  open("/platform", "operations", (call) => (call.method === "GET" && call.url.pathname === "/platform/v1/products" ? page([], call.url.searchParams.get("has_active_price") === "false" ? 0 : 3) : null));
  await waitFor(() => assert.match(document.querySelector(".entry-card:has(a[href^='/platform/products'])")?.textContent ?? "", /已上架3/));
  assertAbsent(screen.queryByText(/报不出价/));

  resetBrowser();
  open("/platform", "readonly");
  await screen.findByRole("link", { name: "商品", description: /已上架/ });
  assert.ok(menuLabels().includes("商品"));
  assert.ok(!menuLabels().includes("报价试算"), "只读角色看不到报价试算");

  resetBrowser();
  const financeCalls = open("/platform", "finance", (call) => (call.method === "GET" && call.url.pathname === "/platform/v1/dashboard/summary" ? json(200, { tenants: null, master_data: null }) : null));
  await screen.findByRole("heading", { level: 1, name: "首页" });
  await waitFor(() => assert.ok(menuLabels().includes("首页")));
  assert.ok(!menuLabels().includes("商品") && !menuLabels().includes("报价试算"), "财务看不到商品和报价试算");
  assertAbsent(screen.queryByRole("link", { name: "商品" }));
  assert.equal(productCalls(financeCalls).length, 0, "没有权限的角色不去取商品的数");
});

test("首页商品的数没取到：卡片写「—」，页面上方提示可以重试；重试后显示数量", async () => {
  let fail = true;
  open("/platform", "operations", (call) => (call.method === "GET" && call.url.pathname === "/platform/v1/products" ? (fail ? apiError(500, "INTERNAL", "boom") : page([], 4)) : null));
  await screen.findByText("数量没有加载出来", { selector: ".alert__title" });
  assert.match(document.querySelector(".entry-card:has(a[href^='/platform/products'])")?.textContent ?? "", /—/);
  fail = false;
  await user().click(screen.getByRole("button", { name: "重试" }));
  await waitFor(() => assert.match(document.querySelector(".entry-card:has(a[href^='/platform/products'])")?.textContent ?? "", /已上架4/));
});

// ───────────── 列表 ─────────────

test("商品列表：每行有商品名和编号、供应商、子品牌、城市和接送点、品类、状态、可用价格、上架时间、最近修改；没起名的显示「未命名」；暂停的供应商有标记", async () => {
  open("/platform/products", "super_admin");
  const first = (await screen.findByRole("link", { name: "羽田机场接送" })).closest("tr") as HTMLElement;
  assert.deepEqual(
    [...document.querySelectorAll(".table thead th")].map((node) => node.textContent),
    ["商品", "供应商", "子品牌", "城市", "品类", "状态", "可用价格", "上架时间", "最近修改"],
  );
  const text = first.textContent ?? "";
  for (const part of ["PRD202610081430050001", "NOZOMI 自营车队", "NOZOMI（JPY）", "东京", "羽田机场（HND）", "接送机", "已上架", "有 2 条"]) assert.ok(text.includes(part), `第一行应有「${part}」：${text}`);
  assert.equal(within(first).getByRole("link", { name: "NOZOMI 自营车队" }).getAttribute("href"), `/platform/tenants/${TENANT_ID}`);
  assert.equal(within(first).getByRole("link", { name: "羽田机场接送" }).getAttribute("href"), `/platform/products/${PRODUCT_ID}`);
  const second = screen.getByRole("link", { name: "未命名的包车商品" }).closest("tr") as HTMLElement;
  assert.match(second.textContent ?? "", /Relaxcar.*已暂停/);
  assert.match(second.textContent ?? "", /没有价格/);
  assert.doesNotMatch(second.textContent ?? "", /报不出价/, "草稿没有价格不写后果");
  assert.match(screen.getByRole("navigation", { name: "分页" }).textContent ?? "", /共 2 条/);
});

test("筛选写进网址并带进请求：状态、可用价格、品类、供应商、关键字；已上架却没有价格的写出后果；清空筛选回到全部", async () => {
  const calls = open("/platform/products?status=published&priced=no", "operations", (call) =>
    call.method === "GET" && call.url.pathname === "/platform/v1/products" ? page([rowOf({ has_active_price: false, active_price_rule_count: 0 })], 1) : null,
  );
  const row = (await screen.findByRole("link", { name: "羽田机场接送" })).closest("tr") as HTMLElement;
  assert.match(row.textContent ?? "", /没有价格.*已上架，客人询价时报不出价/);
  assert.deepEqual(Object.fromEntries(productCalls(calls).at(-1) ?? []), { limit: "50", status: "published", has_active_price: "false" });

  await user().selectOptions(screen.getByRole("combobox", { name: "品类" }), "接送机");
  await waitFor(() => assert.equal(productCalls(calls).at(-1)?.get("category"), "airport_transfer"));
  const tenantBox = screen.getByRole("combobox", { name: "供应商" });
  await user().click(tenantBox);
  await user().click(await screen.findByRole("option", { name: /Relaxcar/ }));
  await waitFor(() => assert.equal(productCalls(calls).at(-1)?.get("tenant_id"), TENANT2_ID));
  await user().type(screen.getByRole("searchbox", { name: "按商品名或商品编号搜索" }), "PRD2026{Enter}");
  await waitFor(() => assert.equal(productCalls(calls).at(-1)?.get("q"), "PRD2026"));

  await user().click(screen.getByRole("button", { name: "清空筛选" }));
  await waitFor(() => assert.deepEqual(Object.fromEntries(productCalls(calls).at(-1) ?? []), { limit: "50" }));
});

test("从一行的子品牌点进来只看这个子品牌：条件以小标签列在表格上方，可以去掉", async () => {
  const calls = open("/platform/products", "super_admin");
  await user().click((await screen.findAllByRole("link", { name: "只看子品牌「NOZOMI」的商品" }))[0] as HTMLElement);
  await waitFor(() => assert.equal(productCalls(calls).at(-1)?.get("brand_id"), BRAND_ID));
  await screen.findByText("子品牌：NOZOMI（JPY）");
  await user().click(screen.getByRole("button", { name: "去掉条件「子品牌：NOZOMI（JPY）」" }));
  await waitFor(() => assert.equal(productCalls(calls).at(-1)?.get("brand_id"), null));
});

test("列表的状态：还没有商品、筛选后没有、加载失败可以重试；不能看商品的角色显示没有权限", async () => {
  open("/platform/products", "operations", (call) => (call.method === "GET" && call.url.pathname === "/platform/v1/products" ? page([]) : null));
  await screen.findByText("还没有商品");
  assert.match(document.body.textContent ?? "", /运营后台只能查看，不能替供应商建商品/);

  resetBrowser();
  open("/platform/products?status=draft", "operations", (call) => (call.method === "GET" && call.url.pathname === "/platform/v1/products" ? page([]) : null));
  await screen.findByText("没有符合条件的商品");

  resetBrowser();
  let fail = true;
  open("/platform/products", "operations", (call) => (call.method === "GET" && call.url.pathname === "/platform/v1/products" ? (fail ? apiError(500, "INTERNAL", "boom") : page([rowOf()])) : null));
  await screen.findByText("加载失败");
  fail = false;
  await user().click(screen.getByRole("button", { name: "重试" }));
  await screen.findByRole("link", { name: "羽田机场接送" });

  resetBrowser();
  const calls = open("/platform/products", "finance");
  await screen.findByText("你没有权限查看这里");
  assert.equal(productCalls(calls).length, 0);
  resetBrowser();
  open(`/platform/products/${PRODUCT_ID}`, "tech");
  await screen.findByText("你没有权限查看这里");
});

// ───────────── 详情 ─────────────

test("商品详情：标题行有供应商、版本、上架时间；每一步都是只读的，没有任何修改的入口，不发写请求、不碰供应商后台的接口", async () => {
  const calls = open(`/platform/products/${PRODUCT_ID}`, "customer_service");
  await screen.findByRole("heading", { level: 2, name: "① 基础信息" });
  assert.match(screen.getByRole("heading", { level: 1 }).textContent ?? "", /羽田机场接送/);
  const meta = document.querySelector(".page__meta")?.textContent ?? "";
  for (const part of ["已上架", "PRD202610081430050001", "接送机 · 东京 · 羽田机场（HND）", "供应商 NOZOMI 自营车队", "子品牌 NOZOMI（JPY）", "版本 12", "上架时间"]) assert.ok(meta.includes(part), `标题行应有「${part}」：${meta}`);
  assert.ok(screen.getByText(/运营后台只能查看，不能修改/));
  assert.match(document.body.textContent ?? "", /山田/);
  assert.match(document.body.textContent ?? "", /东京 23 区/);
  assertNoEditing(calls, "基础信息");

  const steps = screen.getByRole("navigation", { name: "配置步骤" });
  assert.deepEqual(
    within(steps)
      .getAllByRole("link")
      .map((link) => link.getAttribute("href")),
    ["basic", "service-rules", "prices", "inventory", "content", "publish"].map((slug) => `/platform/products/${PRODUCT_ID}/${slug}`),
  );
  await user().click(within(steps).getByRole("link", { name: /服务规则/ }));
  await screen.findByRole("heading", { level: 2, name: "② 服务规则" });
  await waitFor(() => assert.match(document.body.textContent ?? "", /儿童座椅/));
  assertNoEditing(calls, "服务规则");

  await user().click(within(steps).getByRole("link", { name: /价格规则/ }));
  await screen.findByRole("heading", { level: 2, name: "③ 价格规则" });
  assert.deepEqual(
    within(screen.getByRole("navigation", { name: "价格规则的分区" }))
      .getAllByRole("link")
      .map((link) => link.textContent),
    ["价格规则", "调价规则1"],
    "运营后台没有价格日历这个页签",
  );
  await waitFor(() => assert.ok([...document.querySelectorAll<HTMLInputElement>(".price-table input")].some((node) => node.value === "20,000"), "价格表里有这条一口价"));
  assertAbsent(screen.queryByRole("button", { name: /导入 \/ 导出/ }));
  assertNoEditing(calls, "价格规则");

  await user().click(screen.getByRole("link", { name: /^调价规则/ }));
  await screen.findByText("国庆旺季");
  assertNoEditing(calls, "调价规则");
  await user().click(screen.getByRole("link", { name: "查看 国庆旺季" }));
  await waitFor(() => assert.match(document.body.textContent ?? "", /上调 20%/));
  assertNoEditing(calls, "一条调价规则");

  await user().click(within(steps).getByRole("link", { name: /库存/ }));
  await screen.findByRole("heading", { level: 2, name: "④ 库存" });
  assert.match(document.body.textContent ?? "", /库存模式限量/);
  assert.match(document.body.textContent ?? "", /从今天起有库存的日子30 天/);
  assertNoEditing(calls, "库存");

  await user().click(within(steps).getByRole("link", { name: /商品详情/ }));
  await screen.findByRole("heading", { level: 2, name: "⑤ 商品详情" });
  await waitFor(() => assert.ok([...document.querySelectorAll("input, textarea")].some((node) => (node as HTMLInputElement).value === "到达大厅 2 号出口")));
  assertNoEditing(calls, "商品详情");

  await user().click(within(steps).getByRole("link", { name: /上架检查/ }));
  await screen.findByRole("heading", { level: 2, name: "上架检查" });
  assert.match(document.body.textContent ?? "", /已上架/);
  assertNoEditing(calls, "上架检查");
  assert.equal(calls.filter((call) => call.path === `/platform/v1/products/${PRODUCT_ID}`).length >= 1, true);
});

test("商品详情的提醒：供应商已暂停、城市被停用、限量却从今天起没有库存；回到列表回到来的地方", async () => {
  const detail = detailOf({ tenant: { id: TENANT_ID, name: "NOZOMI 自营车队", status: "suspended" }, product: productOf({ city: { ...base.city, status: "disabled" } }), inventory: { mode: "limited", sellable_days_ahead: 0 } });
  open(`/platform/products/${PRODUCT_ID}/inventory`, "super_admin", (call) => (call.method === "GET" && call.url.pathname === `/platform/v1/products/${PRODUCT_ID}` ? json(200, detail) : null));
  await screen.findByRole("heading", { level: 2, name: "④ 库存" });
  assert.ok(screen.getByText("这家供应商已暂停。"));
  assert.ok(screen.getByText("这个商品的城市「东京」已停用。"));
  assert.match(document.body.textContent ?? "", /从今天起没有库存，卖不出去/);
  assert.equal(screen.getByRole("link", { name: "回到列表" }).getAttribute("href"), "/platform/products");
});

test("商品详情的状态：不存在（含编号格式不对）、加载失败可以重试", async () => {
  open(`/platform/products/${PRODUCT_ID}`, "super_admin", (call) => (call.method === "GET" && call.url.pathname === `/platform/v1/products/${PRODUCT_ID}` ? apiError(404, "NOT_FOUND", "没有") : null));
  await screen.findByText("找不到这个商品");
  assert.equal(screen.getByRole("link", { name: "回到商品列表" }).getAttribute("href"), "/platform/products");

  resetBrowser();
  open("/platform/products/not-a-uuid", "super_admin");
  await screen.findByText("找不到这个商品");

  resetBrowser();
  let fail = true;
  open(`/platform/products/${PRODUCT_ID}/content`, "super_admin", (call) => (call.method === "GET" && call.url.pathname === `/platform/v1/products/${PRODUCT_ID}` ? (fail ? apiError(503, "UNAVAILABLE", "x") : json(200, detailOf())) : null));
  await screen.findByText("加载失败");
  fail = false;
  await user().click(screen.getByRole("button", { name: "重试" }));
  await screen.findByRole("heading", { level: 2, name: "⑤ 商品详情" });
});

test("供应商详情页的「商品」一栏：只看这一家（请求带 tenant_id），没有供应商这一列；点进商品，回到列表回到供应商详情", async () => {
  const calls = open(`/platform/tenants/${TENANT_ID}`, "operations");
  const section = (await screen.findByRole("heading", { level: 2, name: "商品" })).closest("section") as HTMLElement;
  await within(section).findByRole("link", { name: "羽田机场接送" });
  assert.equal(productCalls(calls).at(-1)?.get("tenant_id"), TENANT_ID);
  assert.deepEqual(
    [...section.querySelectorAll("thead th")].map((node) => node.textContent),
    ["商品", "城市", "品类", "状态", "可用价格", "最近修改"],
  );
  assertAbsent(within(section).queryByRole("combobox", { name: "供应商" }));
  assert.equal(within(section).getByRole("link", { name: /在商品列表里看/ }).getAttribute("href"), `/platform/products?tenant=${TENANT_ID}`);
  await user().click(within(section).getByRole("link", { name: "羽田机场接送" }));
  await screen.findByRole("heading", { level: 2, name: "① 基础信息" });
  assert.equal(screen.getByRole("link", { name: "回到列表" }).getAttribute("href"), `/platform/tenants/${TENANT_ID}`);

  // 供应商没有商品
  resetBrowser();
  open(`/platform/tenants/${TENANT_ID}`, "operations", (call) => (call.method === "GET" && call.url.pathname === "/platform/v1/products" ? page([]) : null));
  await screen.findByText("这家供应商还没有商品");
});

// ───────────── 报价试算 ─────────────

const settlementOf = (total: number) => ({
  currency: "JPY",
  rounding_unit: 100,
  total,
  base: 20000,
  adjust: total - 20000,
  urgent: 0,
  night: 0,
  addons: 0,
  driver_language: 0,
  exact: { base: "20000", adjusted: String(total), night: "0", addons: "0", total: String(total) },
  adjusts: total === 20000 ? [] : [{ rule_id: RULE_ID, name: "国庆旺季", steps: [{ type: "percent" as const, value: 2000, delta: "4000", after: "24000" }] }],
  urgent_tier: null,
  night_detail: null,
  addon_items: [],
  driver_language_code: null,
  usage: null,
  free_wait: { item: "pickup" as const, mode: "limited" as const, minutes: 60, platform_minimum_minutes: 60 },
});
const candidateOf = (position: number, tenantName: string, code: string, total: number, changes: Partial<QuoteCandidate> = {}): QuoteCandidate => ({
  position,
  in_band: true,
  rank_price: String(total + total / 10),
  tenant_id: TENANT_ID,
  tenant_name: tenantName,
  product_id: position === 1 ? PRODUCT_ID : PRODUCT2_ID,
  product_code: code,
  product_version: 3,
  observation: false,
  score_centi: 450,
  completed_orders: 0,
  sell: total + total / 10,
  sell_exact: String(total + total / 10),
  markup_bp: 1000,
  markup_level: null,
  markup_rule_id: null,
  min_margin_applied: false,
  fx_buffer_bp: 0,
  fx: null,
  offer: { vehicle_group_id: GROUP_ID, package_hours: null, area_id: AREA_ID, price_rule_id: PRICE_ID, settlement: settlementOf(total) },
  ...changes,
});
const previewOf = (changes: Partial<PlatformQuotePreview> = {}): PlatformQuotePreview => ({
  currency: "JPY",
  band_bp: 300,
  channel: null,
  excluded: [],
  markup_floor_bp: 1000,
  route: null,
  candidate_count: 3,
  groups: [
    {
      vehicle_group_id: GROUP_ID,
      package_hours: null,
      created_at: "2026-10-15T01:00:00.000Z",
      expires_at: "2026-10-15T01:30:00.000Z",
      winner: { tenant_id: TENANT_ID, tenant_name: "NOZOMI 自营车队", product_id: PRODUCT_ID, product_code: "PRD-A", sell: 22000, settlement: 20000, settlement_currency: "JPY" },
      candidates: [candidateOf(1, "NOZOMI 自营车队", "PRD-A", 20000), candidateOf(2, "Relaxcar", "PRD-B", 24000, { in_band: false })],
    },
  ],
  refused: [
    { tenant_id: TENANT2_ID, tenant_name: "远方车队", product_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", product_code: "PRD-C", vehicle_group_id: null, reason: "OUT_OF_SERVICE_AREA", message: "地址不在这个商品任何一个区域的营运区里" },
    { tenant_id: TENANT2_ID, tenant_name: "Relaxcar", product_id: PRODUCT2_ID, product_code: "PRD-B", vehicle_group_id: GROUP_ID, reason: "ROUTE_UNAVAILABLE", message: "价格是「里程 + 时长」，需要路线预估，而现在取不到" },
  ],
  ...changes,
});

async function fillTransfer(): Promise<void> {
  const box = await screen.findByRole("combobox", { name: /城市/ });
  await user().click(box);
  await user().click(await screen.findByRole("option", { name: /东京/ }));
  await user().click(screen.getByRole("radio", { name: "接送机" }));
  const place = screen.getByRole("combobox", { name: /机场或车站/ });
  await user().click(place);
  await user().click(await screen.findByRole("option", { name: /羽田机场/ }));
  await user().click(screen.getByRole("radio", { name: /^接机/ }));
  const dropoff = screen.getByRole("group", { name: "下车点" });
  await user().type(within(dropoff).getByRole("textbox", { name: /纬度/ }), "35.6895");
  await user().type(within(dropoff).getByRole("textbox", { name: /经度/ }), "139.6917");
  await user().type(screen.getByRole("textbox", { name: "日期" }), "2026-10-20");
  await user().type(screen.getByRole("textbox", { name: "时刻" }), "930");
  await user().type(screen.getByRole("textbox", { name: "人数" }), "2");
  await user().selectOptions(screen.getByRole("combobox", { name: "客人支付的币种" }), "JPY");
}

test("报价试算：没填的当场指出，焦点到第一处；接机只要下车点；填好后请求体按接口的写法（城市当地时间、坐标经度纬度对好）", async () => {
  const calls = open("/platform/quote-preview", "operations", (call) => (call.method === "POST" && call.url.pathname === "/platform/v1/quotes/preview" ? json(200, previewOf()) : null));
  await screen.findByRole("heading", { level: 2, name: "用车请求" });
  await user().click(screen.getByRole("button", { name: "试算" }));
  await screen.findByText(/有 \d+ 处需要修改/);
  assert.ok(screen.getByText("请选择城市"));
  assert.ok(screen.getByText("请选择品类"));
  await waitFor(() => assert.equal(document.activeElement, screen.getByRole("combobox", { name: /城市/ })));
  assert.equal(calls.filter((call) => call.method === "POST").length, 0);

  await fillTransfer();
  assertAbsent(screen.queryByRole("group", { name: "上车点" }));
  await user().click(screen.getByRole("button", { name: "试算" }));
  await screen.findByRole("heading", { level: 2, name: "试算结果" });
  const posted = calls.find((call) => call.method === "POST");
  assert.deepEqual(posted?.body, {
    city_id: CITY_ID,
    category: "airport_transfer",
    place_id: POI_ID,
    currency: "JPY",
    pickup: null,
    dropoff: { lat: 35.6895, lng: 139.6917 },
    direction: "pickup",
    package_hours: null,
    service_time: "2026-10-20T09:30",
    passengers: 2,
    luggage: 0,
    assume_route: null,
    channel_id: null,
  });
});

test("试算结果：每个车型组的中标、全部候选（结算价、对外价、加价比例、排序价、同价区间、名次）、结算价明细可展开、报不出价的商品和中文原因", async () => {
  open("/platform/quote-preview", "super_admin", (call) => (call.method === "POST" && call.url.pathname === "/platform/v1/quotes/preview" ? json(200, previewOf()) : null));
  await fillTransfer();
  await user().click(screen.getByRole("button", { name: "试算" }));
  const groupCard = (await screen.findByRole("heading", { level: 3, name: "商务七座" })).closest("section") as HTMLElement;
  assert.match(groupCard.textContent ?? "", /中标：NOZOMI 自营车队（PRD-A） · 对外价 JPY 22,000 · 结算价 JPY 20,000/);
  const rows = within(groupCard).getAllByRole("row").filter((row) => !row.hidden && row.querySelector("td"));
  const first = rows[0]?.textContent ?? "";
  for (const part of ["1", "中标", "NOZOMI 自营车队", "PRD-A", "JPY 20,000", "JPY 22,000", "10%", "在"]) assert.ok(first.includes(part), `第一名应有「${part}」：${first}`);
  assert.match(rows[1]?.textContent ?? "", /2Relaxcar.*JPY 24,000.*JPY 26,400.*不在/);

  const toggle = within(groupCard).getByRole("button", { name: "看 Relaxcar 的结算价明细" });
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  await user().click(toggle);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  const detail = groupCard.querySelector(".quote-detail")?.textContent ?? "";
  for (const part of ["基础价JPY 20,000", "「国庆旺季」上调 20%（+JPY 4,000）", "取整取整到 JPY 100", "结算价JPY 24,000", "同币种（JPY），不用换算", "免费等待60 分钟"]) assert.ok(detail.includes(part), `明细应有「${part}」：${detail}`);

  const refused = (screen.getByRole("heading", { level: 3, name: "没报出价的（2）" }).closest("section") as HTMLElement).textContent ?? "";
  assert.match(refused, /远方车队PRD-C整个商品地址不在这个商品任何一个区域的营运区里/);
  assert.match(refused, /RelaxcarPRD-B商务七座价格是「里程 \+ 时长」，需要路线预估，而现在取不到/);
  assert.match(document.body.textContent ?? "", /找到 3 个已上架的商品，1 个车型组报出了价。2 个商品有没报出价的，原因见最下面。/);
});

test("试算：没有可以比价的商品时引导去商品列表；城市被停用（409）落在城市下面；后端指出的字段落在对应的地方；网络不通保留已填的内容", async () => {
  let answer: () => Response = () => json(200, previewOf({ candidate_count: 0, groups: [], refused: [] }));
  open("/platform/quote-preview", "channel_manager", (call) => (call.method === "POST" && call.url.pathname === "/platform/v1/quotes/preview" ? answer() : null));
  await fillTransfer();
  await user().click(screen.getByRole("button", { name: "试算" }));
  await screen.findByText("没有可以比价的商品");
  assert.equal(screen.getByRole("link", { name: "去商品列表看看" }).getAttribute("href"), `/platform/products?city=${CITY_ID}&category=airport_transfer&status=published`);

  answer = () => apiError(409, "MASTER_DATA_NOT_READY", "城市已停用", { reason: "CITY_DISABLED" });
  await user().click(screen.getByRole("button", { name: "试算" }));
  await screen.findByText(/这个城市已被平台停用，现在不报价/);

  answer = () => apiError(400, "VALIDATION_FAILED", "不对", { issues: [{ path: "/dropoff", reason: "REQUIRED", message: "要给下车点" }] });
  await user().click(screen.getByRole("button", { name: "试算" }));
  await screen.findByText("要给下车点");

  answer = () => {
    throw new TypeError("network down");
  };
  await user().click(screen.getByRole("button", { name: "试算" }));
  await screen.findByText(/试算没有成功。网络连接失败，请检查网络后重试。你填写的内容还在。/);
  assert.equal((screen.getByRole("textbox", { name: "人数" }) as HTMLInputElement).value, "2");
});

test("报价试算的权限：只读、风控没有 quote.preview——直接打开地址显示没有权限，不取任何数据", async () => {
  for (const role of ["readonly", "risk"]) {
    const calls = open("/platform/quote-preview", role);
    await screen.findByText("你没有权限查看这里");
    assert.deepEqual(calls.filter((call) => call.path.startsWith("/platform/v1/master/vehicle-groups") || call.method === "POST"), []);
    resetBrowser();
  }
});

// ───────────── 验收发现的界面小问题（M1-13） ─────────────

test("商品详情的基础信息：不出现只对供应商有意义的话（「要换，请新建一个商品」），改说是供应商创建时选定的", async () => {
  open(`/platform/products/${PRODUCT_ID}`, "customer_service");
  await screen.findByRole("heading", { level: 2, name: "① 基础信息" });
  assert.ok(screen.getByText("这几项是供应商创建商品时选定的，创建后不能修改。"));
  assert.doesNotMatch(document.body.textContent ?? "", /新建一个商品/);
});

test("只读的价格表：方向、计价方式显示成文字，不是灰掉的下拉框（禁用态的字对比度不够）；服务规则里的司机语言同样", async () => {
  const detail = detailOf();
  const withLanguage = detailOf({
    service_rules: { ...detail.service_rules, rules: { ...detail.service_rules.rules, driver_languages: [{ language: "ja", unit_price: 0 }] } },
    price_rules: { ...detail.price_rules, items: [priceOf(), priceOf({ id: "99999999-9999-4999-8999-999999999999", direction: "pickup", pricing_model: "mileage_time", base_price: null, start_price: 3000, start_meters: 2000, start_minutes: 10, per_km: 400, per_minute: 50, min_price: 5000, base: "3000" })] },
  });
  open(`/platform/products/${PRODUCT_ID}/prices`, "customer_service", (call) => (call.method === "GET" && call.url.pathname === `/platform/v1/products/${PRODUCT_ID}` ? json(200, withLanguage) : null));
  await screen.findByRole("heading", { level: 2, name: "③ 价格规则" });
  await waitFor(() => assert.ok(document.querySelectorAll(".price-table tbody tr").length >= 2));
  assert.equal(document.querySelectorAll(".price-table select").length, 0, "价格表里没有下拉框");
  assert.equal(document.querySelectorAll(".price-table [disabled]").length, 0, "价格表里没有禁用的控件");
  const text = document.querySelector(".price-table")?.textContent ?? "";
  for (const word of ["接送通用", "接机", "一口价", "里程 + 时长"]) assert.ok(text.includes(word), `价格表里应有「${word}」：${text}`);

  await user().click(within(screen.getByRole("navigation", { name: "配置步骤" })).getByRole("link", { name: /服务规则/ }));
  await screen.findByRole("heading", { level: 2, name: "② 服务规则" });
  const languages = (await screen.findByText("司机语言")).closest("fieldset") as HTMLElement;
  assert.equal(languages.querySelectorAll("select").length, 0);
  assert.match(languages.textContent ?? "", /日语/);
});

test("只读详情的每一步、每个页签：说明文字不对供应商说「你 / 你们」，不教怎么填、怎么改（如「上下移动可以调整顺序」「填上价格、点保存」）；上架检查里「不归用户补」的那句换成运营该看的", async () => {
  const detail = detailOf();
  const rich = detailOf({
    service_rules: {
      ...detail.service_rules,
      rules: {
        ...detail.service_rules.rules,
        driver_languages: [{ language: "ja", unit_price: 0 }],
        urgent: { enabled: true, daily_quota: 3, tiers: [{ within_hours: 12, surcharge: 1000 }] },
        night: { enabled: true, window: { start: "22:00", end: "06:00" }, amount: 1000, charge_unit: "per_order" },
      } as typeof detail.service_rules.rules,
    },
    price_rules: { ...detail.price_rules, items: [], coverage: { total: 1, priced: 0, missing: 1 } },
    adjust_rules: { ...detail.adjust_rules, items: [] },
    publish_check: { can_publish: false, items: [item("basic_info", [{ path: "/brand_id", reason: "BRAND_DISABLED" }, { path: "/city_id", reason: "CITY_DISABLED" }]), item("service_rules"), item("price_rules", [{ path: "/price_rules", reason: "NO_ACTIVE_PRICE_RULE" }]), item("content"), item("adjust_rules", [], false), item("inventory", [], false)] },
  });
  open(`/platform/products/${PRODUCT_ID}`, "super_admin", (call) => (call.method === "GET" && call.url.pathname === `/platform/v1/products/${PRODUCT_ID}` ? json(200, rich) : null));
  const EDITING = /上下移动|填上价格|点保存|一条写一项|这里不用设置|不勾 = 不收|你可以|你们|你设|你能|留空 =|例如填|请加一档|再来建|修改任何一步|请联系平台运营|请联系你们的管理员|填写和计算/;
  const seen: string[] = [];
  const check = async (what: string, ready: () => Promise<unknown>): Promise<void> => {
    await ready();
    await waitFor(() => assert.ok(!screen.queryByText("加载中")));
    const main = screen.getByRole("main");
    // 页面顶部那句「运营后台只能查看…请联系供应商」是写给运营的，不算
    const text = [...main.querySelectorAll("p, li, .field__hint, .step__intro, .state-block__description, .checklist__note, .alert")]
      .filter((node) => !node.closest(".product-readonly-note") && !(node.textContent ?? "").startsWith("这是供应商"))
      .map((node) => node.textContent ?? "")
      .join("\n");
    seen.push(text);
    const hit = EDITING.exec(text);
    assert.equal(hit, null, `${what}：出现了写给供应商的编辑说明「${hit?.[0]}」\n${text}`);
  };
  const steps = (): HTMLElement => screen.getByRole("navigation", { name: "配置步骤" });
  await check("基础信息", () => screen.findByRole("heading", { level: 2, name: "① 基础信息" }));
  await user().click(within(steps()).getByRole("link", { name: /服务规则/ }));
  await check("服务规则", () => screen.findByRole("heading", { level: 2, name: "② 服务规则" }));
  await user().click(within(steps()).getByRole("link", { name: /价格规则/ }));
  await check("价格规则", () => screen.findByText("供应商还没有给任何组合设价格。"));
  await user().click(screen.getByRole("link", { name: /^调价规则/ }));
  await check("调价规则", () => screen.findByText("这个商品没有调价规则，每天都按价格规则里的基础价报价。"));
  await user().click(within(steps()).getByRole("link", { name: /库存/ }));
  await check("库存", () => screen.findByRole("heading", { level: 2, name: "④ 库存" }));
  await user().click(within(steps()).getByRole("link", { name: /商品详情/ }));
  await check("商品详情", () => screen.findByRole("heading", { level: 2, name: "⑤ 商品详情" }));
  await user().click(within(steps()).getByRole("link", { name: /上架检查/ }));
  await check("上架检查", () => screen.findByText("供应商的管理员可以在供应商后台重新启用"));
  assert.ok(screen.getByText("需要平台在主数据里处理"));
  const all = seen.join("\n");
  for (const expected of ["供应商给这个商品选的区域，排在前面的优先。", "平台规定了最少要等多久，供应商可以设得更长，不能更短。", "由供应商在服务结束后", "商品的名字，客人和后台列表里看到的都是它。"]) {
    assert.ok(all.includes(expected), `应有「${expected}」`);
  }
});

test("数据来源署名（M1-18）：商品列表、商品详情的每一步、报价试算都展示城市和机场名称，都注明 OurAirports 和 GeoNames", async () => {
  const lines = (): string[] => [...document.querySelectorAll(".page__attribution")].map((node) => (node.textContent ?? "").replace(/（在新标签页打开）/g, ""));
  const both = ["机场数据来自 OurAirports（ourairports.com），公有领域", "城市数据和机场的中文、日文名称来自 GeoNames（geonames.org），CC BY 4.0"];
  open("/platform/products", "super_admin");
  await screen.findByRole("link", { name: "羽田机场接送" });
  assert.deepEqual(lines(), both);
  resetBrowser();

  for (const slug of ["basic", "service-rules"]) {
    open(`/platform/products/${PRODUCT_ID}/${slug}`, "customer_service");
    await screen.findByRole("heading", { level: 2, name: slug === "basic" ? "① 基础信息" : "② 服务规则" });
    await waitFor(() => assert.deepEqual(lines(), both, `「${slug}」这一步只有一份署名`));
    resetBrowser();
  }

  open("/platform/quote-preview", "operations");
  await screen.findByRole("heading", { level: 2, name: "用车请求" });
  assert.deepEqual(lines(), both);
});

test("子品牌名自己带了币种时不重复（M1-18）：列表的子品牌列、筛选标签、详情标题行都只有一个「（JPY）」", async () => {
  const named = { id: BRAND_ID, name: "测试（JPY）", currency: "JPY", status: "active" as const };
  open(`/platform/products?brand=${BRAND_ID}`, "super_admin", (call) => {
    if (call.method !== "GET") return null;
    if (call.url.pathname === "/platform/v1/products") return page([rowOf({ brand: named })]);
    if (call.url.pathname === `/platform/v1/products/${PRODUCT_ID}`) return json(200, { ...detailOf(), product: { ...detailOf().product, brand: named } });
    return null;
  });
  const row = (await screen.findByRole("link", { name: "羽田机场接送" })).closest("tr") as HTMLElement;
  assert.ok(within(row).getByRole("link", { name: "只看子品牌「测试（JPY）」的商品" }));
  assert.match(row.textContent ?? "", /测试（JPY）/);
  assert.doesNotMatch(document.body.textContent ?? "", /（JPY）（JPY）/);
  assert.ok(screen.getByText("子品牌：测试（JPY）"));
  resetBrowser();

  open(`/platform/products/${PRODUCT_ID}/basic`, "customer_service", (call) => (call.method === "GET" && call.url.pathname === `/platform/v1/products/${PRODUCT_ID}` ? json(200, { ...detailOf(), product: { ...detailOf().product, brand: named } }) : null));
  await screen.findByRole("heading", { level: 2, name: "① 基础信息" });
  assert.match(document.querySelector(".page__meta")?.textContent ?? "", /子品牌 测试（JPY）/);
  await waitFor(() => assert.match(document.body.textContent ?? "", /测试（JPY）/));
  assert.doesNotMatch(document.body.textContent ?? "", /（JPY）（JPY）/);
});
