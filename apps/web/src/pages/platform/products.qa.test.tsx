/**
 * M1-12 测试角色补充：运营后台「商品」（只读）和「报价试算」的边界。
 * - 只读详情：从地址直接打开导入页、新建调价规则、价格日历、不认识的调价规则——都没有修改入口、不碰供应商接口、不发写请求；
 *   在每个只读输入框里按回车、点遍每个按钮，也发不出写请求；停用的子品牌、接送点各有提醒；
 * - 列表：网址里写坏的条件不带进请求，关键字超长截到 100 字、特殊字符原样编码；翻到第二页点进商品再回来还在第二页；
 *   「回到列表」不会被网址状态带去站外；
 * - 首页卡片：主数据运营、技术没有卡片、不取数；数字带千分位；
 * - 报价试算：跨币种（USD 两位小数、汇率、缓冲）、下调的合计是负号、观察期标签、车型组名取不到；城市时区写在时间旁边，
 *   跨午夜、夏令时的当地时间原样提交。
 * 接口用测试替身。
 */
import { roleName } from "../../lib/portal.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../App.tsx";
import type { Addon, City, Place, VehicleGroup } from "../../api/master.ts";
import type { PlatformProductDetail, PlatformProductSummary } from "../../api/platform-products.ts";
import type { AdjustRuleBody, PriceRuleBody } from "../../api/prices.ts";
import type { Product, PublishCheckItemBody } from "../../api/products.ts";
import type { PlatformQuotePreview, QuoteCandidate } from "../../api/quotes.ts";
import type { PlatformUser } from "../../api/types.ts";
import { type ApiCall, apiError, assertAbsent, json, resetBrowser, signIn, stubApiWith } from "../../testing/harness.tsx";

afterEach(resetBrowser);

const stamps = { created_at: "2026-10-06T00:12:00.000Z", updated_at: "2026-10-08T05:30:00.000Z" };
const TENANT_ID = "7b1c2d3e-aaaa-4bbb-8ccc-ddddeeeeffff";
const PRODUCT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PRODUCT2_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CITY_ID = "11111111-1111-4111-8111-111111111111";
const LA_ID = "12121212-1212-4121-8121-121212121212";
const POI_ID = "22222222-2222-4222-8222-222222222222";
const BRAND_ID = "33333333-3333-4333-8333-333333333333";
const AREA_ID = "44444444-4444-4444-8444-444444444444";
const GROUP_ID = "55555555-5555-4555-8555-555555555555";
const ADDON_ID = "66666666-6666-4666-8666-666666666666";
const PRICE_ID = "77777777-7777-4777-8777-777777777777";
const RULE_ID = "88888888-8888-4888-8888-888888888888";
const ME_ID = "99999999-9999-4999-8999-999999999999";

const meOf = (role: string): PlatformUser => ({ id: ME_ID, email: "kato@example.com", name: "加藤 美咲", role, role_name: roleName("platform", role) ?? role, status: "active", ...stamps });
const tokyo: City = { id: CITY_ID, code: "CTY-JP-TYO", country_code: "JP", name: { zh: "东京" }, timezone: "Asia/Tokyo", center: { lng: 139.7, lat: 35.7 }, boundary: null, status: "active", version: 1, ...stamps };
const la: City = { id: LA_ID, code: "CTY-US-LAX", country_code: "US", name: { zh: "洛杉矶" }, timezone: "America/Los_Angeles", center: { lng: -118.24, lat: 34.05 }, boundary: null, status: "active", version: 1, ...stamps };
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
      booking: { sale_from: null, sale_to: null, service_time: { start: "06:00", end: "23:00" }, lead_time_hours: 24, note: "提前一天" },
      urgent: { enabled: true, daily_quota: 3, tiers: [{ within_hours: 12, surcharge: 3000 }] },
      night: { enabled: true, window: { start: "22:00", end: "06:00" }, amount: 2000, charge_unit: "per_order" },
      free_wait: { pickup: { mode: "limited", minutes: 60 }, dropoff: { mode: "limited", minutes: 15 }, general: null },
      addons: [{ addon_id: ADDON_ID, enabled: true, unit_price: 1000, first_free: false }],
      driver_languages: [],
    },
  },
  content: { zh: { title: "羽田机场接送", summary: "机场到市区", includes: ["高速费"], excludes: ["停车费"], itinerary: null, pickup_guide: "到达大厅 2 号出口" } },
  price_rules: { version: 12, currency: "JPY", rounding_unit: 100, available_models: ["fixed", "mileage_time"], today: "2026-10-15", items: [priceOf()], coverage: { total: 1, priced: 1, missing: 0 } },
  adjust_rules: { version: 12, currency: "JPY", rounding_unit: 100, today: "2026-10-15", items: [adjustOf(), adjustOf({ id: "89898989-8989-4989-8989-898989898989", name: "周末", cycle: { type: "weekly", weekdays: [6, 7] } })] },
  inventory: { mode: "limited", sellable_days_ahead: 30 },
  publish_check: { can_publish: true, items: [item("basic_info"), item("service_rules"), item("price_rules"), item("content"), item("adjust_rules", [], false), item("inventory", [], false)] },
  ...changes,
});
const page = <T,>(items: T[], total = items.length, nextCursor: string | null = null) => json(200, { items, next_cursor: nextCursor, total });

type Route = (call: ApiCall & { url: URL }) => Response | Promise<Response> | null;
function open(path: string | { pathname: string; search?: string; state?: unknown }, role: string, routes: Route = () => null): ApiCall[] {
  signIn("platform", "platform-token");
  const calls = stubApiWith((call) => {
    const custom = routes(call);
    if (custom !== null) return custom;
    if (call.method !== "GET") return null;
    const at = call.url.pathname;
    if (at === "/platform/v1/auth/me") return json(200, { user: meOf(role), permissions: [], must_change_password: false });
    if (at === "/platform/v1/dashboard/summary") return json(200, { tenants: { active: 2, suspended: 0 }, master_data: null });
    if (at === "/platform/v1/tenants") return json(200, { items: [{ id: TENANT_ID, name: "NOZOMI 自营车队", status: "active", ...stamps }], next_cursor: null });
    if (at === "/platform/v1/city-options") return json(200, { items: [tokyo, la].map(({ id, code, name, country_code, timezone }) => ({ id, code, name, country_code, timezone })) });
    if (at === "/platform/v1/place-options") return json(200, { items: [haneda].map(({ id, code, type, name }) => ({ id, code, type, name })) });
    if (at === "/platform/v1/vehicle-group-options") return json(200, { items: [group].map(({ id, code, name }) => ({ id, code, name })) });
    if (at === "/platform/v1/addon-options") return json(200, { items: [seat].map(({ id, code, name, description, categories, charge_unit, status }) => ({ id, code, name, description, categories, charge_unit, status })) });
    if (at === "/platform/v1/holidays") return json(200, { items: [], countries: [] });
    if (at === "/platform/v1/products") return page([rowOf()], 1);
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
const productCalls = (calls: ApiCall[]): URLSearchParams[] => calls.filter((call) => call.method === "GET" && call.path.startsWith("/platform/v1/products?")).map((call) => new URL(call.path, "http://localhost").searchParams);
const writesOrTenant = (calls: ApiCall[]): string[] => calls.filter((call) => call.method !== "GET" || call.path.startsWith("/tenant/v1")).map((call) => `${call.method} ${call.path}`);

/** 主区域里没有修改的按钮、链接，没有能输入的框（只改「怎么看」的控件除外）。 */
function assertNoEditEntry(what: string): void {
  const main = screen.getByRole("main");
  const editWords = /^(保存|保存草稿|保存并下一步|保存并看上架检查|上架|下架|删除|新建|编辑|修改|添加.*|新建调价规则|批量设置|导入.*|导出.*|下载.*|上传.*|选择文件|载入最新内容.*|复制一条|去填|去修改|去改|去设|更多|启用|停用|设置取整单位.*)$/;
  const actions = within(main)
    .queryAllByRole("button")
    .concat(within(main).queryAllByRole("link"))
    .map((node) => (node.textContent ?? "").trim())
    .filter((text) => editWords.test(text));
  assert.deepEqual(actions, [], `${what}：不能有修改的入口`);
  const editable = [...main.querySelectorAll("input, textarea, select")].filter(
    (node) => !(node as HTMLInputElement).readOnly && !(node as HTMLInputElement).disabled && !node.closest(".price-filters, .adjust-list__ended, .filter-bar, .adjust-trial__pick") && node.getAttribute("name") !== "coverage-view",
  );
  assert.deepEqual(editable.map((node) => node.getAttribute("aria-label") ?? node.getAttribute("id") ?? node.outerHTML.slice(0, 120)), [], `${what}：不能有能输入的框`);
  assert.equal(main.querySelectorAll('input[type="file"]').length, 0, `${what}：没有上传文件的控件`);
}

// ───────────── 只读详情：从地址直接打开编辑才有的分区 ─────────────

test("只读详情：从地址直接打开「导入价格」「导入库存」「新建调价规则」「价格日历」、不存在的调价规则、不认识的分区——都没有修改入口，不碰供应商接口、不发写请求", async () => {
  const deepLinks: [string, RegExp][] = [
    ["prices/import", /导入|没有权限/],
    ["inventory/import", /④ 库存/],
    ["prices/adjust/new", /没有权限|调价规则/],
    ["prices/calendar", /③ 价格规则/],
    ["prices/adjust/12345678-1234-4234-8234-123456789012", /调价规则/],
    ["prices/whatever", /③ 价格规则/],
    ["service-rules/extra/segments", /② 服务规则/],
  ];
  for (const [rest, expected] of deepLinks) {
    const calls = open(`/platform/products/${PRODUCT_ID}/${rest}`, "operations");
    await screen.findByRole("navigation", { name: "配置步骤" });
    await waitFor(() => assert.match(screen.getByRole("main").textContent ?? "", expected, rest));
    await new Promise((done) => setTimeout(done, 30));
    assertNoEditEntry(rest);
    assert.deepEqual(writesOrTenant(calls), [], `${rest}：不能有写请求、不能调供应商接口`);
    if (rest === "prices/calendar") assertAbsent(screen.queryByRole("link", { name: "价格日历" }));
    resetBrowser();
  }
});

test("只读详情里从地址打开「导入价格」「新建调价规则」时，说明是运营后台只能查看，而不是「需要修改商品的权限，请联系你们的管理员开通」（运营后台谁也开通不了）", async () => {
  for (const rest of ["prices/import", "prices/adjust/new"]) {
    open(`/platform/products/${PRODUCT_ID}/${rest}`, "super_admin");
    await screen.findByRole("navigation", { name: "配置步骤" });
    await waitFor(() => assert.ok(screen.getByRole("main").querySelector(".state-block, .card")));
    const text = screen.getByRole("main").textContent ?? "";
    assert.doesNotMatch(text, /请联系你们的管理员开通/, `${rest}：超级管理员看到「联系你们的管理员开通」，开通了也改不了`);
    resetBrowser();
  }
});

test("只读详情的键盘：在每一步的每个只读框里按回车、把主区域里每个按钮都按一遍，都发不出写请求，也不碰供应商接口；调价规则按 Alt+↑ 不会调顺序", async () => {
  const calls = open(`/platform/products/${PRODUCT_ID}/basic`, "super_admin");
  const steps = await screen.findByRole("navigation", { name: "配置步骤" });
  for (const [name, heading] of [
    [/基础信息/, "① 基础信息"],
    [/服务规则/, "② 服务规则"],
    [/价格规则/, "③ 价格规则"],
    [/商品详情/, "⑤ 商品详情"],
    [/上架检查/, "上架检查"],
  ] as const) {
    await user().click(within(steps).getByRole("link", { name }));
    await screen.findByRole("heading", { level: 2, name: heading });
    await new Promise((done) => setTimeout(done, 30));
    const main = screen.getByRole("main");
    for (const field of [...main.querySelectorAll<HTMLElement>("input, textarea")]) {
      field.focus();
      fireEvent.keyDown(field, { key: "Enter", code: "Enter" });
      fireEvent.keyDown(field, { key: "s", code: "KeyS", ctrlKey: true });
      fireEvent.keyDown(field, { key: "s", code: "KeyS", metaKey: true });
      const form = field.closest("form");
      if (form) fireEvent.submit(form);
    }
    for (const button of within(main).queryAllByRole("button")) {
      if (button.closest("nav")) continue;
      if (/重新检查|回到|收起|展开|看明细|复制/.test(button.textContent ?? "")) continue;
      fireEvent.click(button);
    }
    assert.deepEqual(writesOrTenant(calls), [], `${heading}：键盘和按钮都发不出写请求`);
  }
  await user().click(within(steps).getByRole("link", { name: /价格规则/ }));
  await user().click(await screen.findByRole("link", { name: /^调价规则/ }));
  await screen.findByText("周末");
  const names = (): string[] => [...document.querySelectorAll(".adjust-list__name, .adjust-rule__name")].map((node) => node.textContent ?? "");
  const before = names();
  const firstRow = screen.getByText("国庆旺季").closest("li, tr") as HTMLElement | null;
  if (firstRow) {
    firstRow.focus();
    fireEvent.keyDown(firstRow, { key: "ArrowDown", altKey: true });
    fireEvent.keyDown(firstRow, { key: "ArrowUp", altKey: true });
  }
  assert.deepEqual(names(), before, "顺序不变");
  assertAbsent(screen.queryByText("顺序有未保存的修改"));
  assert.deepEqual(writesOrTenant(calls), []);
});

test("只读详情的提醒：子品牌、接送点被停用各有一条；供应商正常时没有「已暂停」", async () => {
  const detail = detailOf({ product: productOf({ brand: { ...base.brand, status: "disabled" }, poi: { ...base.poi, status: "disabled" } }) });
  open(`/platform/products/${PRODUCT_ID}/basic`, "readonly", (call) => (call.method === "GET" && call.url.pathname === `/platform/v1/products/${PRODUCT_ID}` ? json(200, detail) : null));
  await screen.findByRole("heading", { level: 2, name: "① 基础信息" });
  assert.ok(screen.getByText("这个商品的子品牌「NOZOMI」已停用。"));
  assert.ok(screen.getByText("这个商品的接送点「羽田机场」已停用。"));
  assertAbsent(screen.queryByText("这家供应商已暂停。"));
  // 只读角色没有 tenant.read 吗？有：供应商是链接
  assert.ok(document.querySelector(".page__meta a[href^='/platform/tenants/']"));
});

test("只读详情：没有 tenant.read 的角色（客服）看到的供应商名不是链接；不限量时不写「有库存的日子」", async () => {
  const detail = detailOf({ inventory: { mode: "unlimited", sellable_days_ahead: 0 } });
  open(`/platform/products/${PRODUCT_ID}/inventory`, "customer_service", (call) => (call.method === "GET" && call.url.pathname === `/platform/v1/products/${PRODUCT_ID}` ? json(200, detail) : null));
  await screen.findByRole("heading", { level: 2, name: "④ 库存" });
  assert.match(document.body.textContent ?? "", /库存模式不限量/);
  assert.doesNotMatch(document.body.textContent ?? "", /有库存的日子|卖不出去/);
});

// ───────────── 列表 ─────────────

test("列表：网址里写坏的条件（供应商、城市、子品牌不是编号，品类、状态、可用价格、每页条数不认识）不带进请求；关键字去掉前后空格、超过 100 字截断、% _ ' \" 原样编码", async () => {
  const long = `${"长".repeat(120)}`;
  const calls = open(`/platform/products?tenant=abc&city=1&brand=x&category=bus&status=archived&priced=maybe&size=999&q=${encodeURIComponent(`  ${long}  `)}`, "operations");
  await screen.findByRole("link", { name: "羽田机场接送" });
  const sent = Object.fromEntries(productCalls(calls).at(-1) ?? []);
  assert.deepEqual(sent, { limit: "50", q: "长".repeat(100) });

  resetBrowser();
  const calls2 = open(`/platform/products?q=${encodeURIComponent("100%_O'Hare \"VIP\" & a=b")}`, "operations");
  await screen.findByRole("link", { name: "羽田机场接送" });
  assert.equal(productCalls(calls2).at(-1)?.get("q"), "100%_O'Hare \"VIP\" & a=b");
  assert.equal(productCalls(calls2).at(-1)?.get("a"), null, "& 不会被拆成另一个参数");
});

test("列表翻到第二页，点进商品，再「回到列表」：还在第二页（带着同一个游标请求）", async () => {
  const calls = open("/platform/products?status=published", "operations", (call) => {
    if (call.method !== "GET" || call.url.pathname !== "/platform/v1/products") return null;
    return call.url.searchParams.get("cursor") === "C2" ? page([rowOf({ id: PRODUCT_ID, title: { zh: "第二页的商品" } })], 2) : page([rowOf({ id: PRODUCT2_ID, title: { zh: "第一页的商品" } })], 2, "C2");
  });
  await screen.findByRole("link", { name: "第一页的商品" });
  await user().click(screen.getByRole("button", { name: "下一页" }));
  await user().click(await screen.findByRole("link", { name: "第二页的商品" }));
  await screen.findByRole("heading", { level: 2, name: "① 基础信息" });
  await user().click(screen.getByRole("link", { name: "回到列表" }));
  await screen.findByRole("link", { name: "第二页的商品" });
  const last = productCalls(calls).at(-1);
  assert.deepEqual([last?.get("cursor"), last?.get("status")], ["C2", "published"]);
});

test("「回到列表」只回站内的商品列表或供应商详情：网址状态里写着站外地址、别的页面时回商品列表", async () => {
  for (const from of ["//evil.example/platform/products", "https://evil.example/", "/platform/staff", "/platform/products/../staff", "javascript:alert(1)"]) {
    open({ pathname: `/platform/products/${PRODUCT_ID}/basic`, state: { from } }, "operations");
    await screen.findByRole("heading", { level: 2, name: "① 基础信息" });
    assert.equal(screen.getByRole("link", { name: "回到列表" }).getAttribute("href"), "/platform/products", from);
    resetBrowser();
  }
  open({ pathname: `/platform/products/${PRODUCT_ID}/basic`, state: { from: `/platform/tenants/${TENANT_ID}` } }, "operations");
  await screen.findByRole("heading", { level: 2, name: "① 基础信息" });
  assert.equal(screen.getByRole("link", { name: "回到列表" }).getAttribute("href"), `/platform/tenants/${TENANT_ID}`);
});

test("列表里供应商名、商品名特别长时整段都在（不截掉字），完整名字也在 title 里", async () => {
  const longName = "株式会社".repeat(30);
  const longTitle = "羽田机场到东京都内任意地点的专车接送服务".repeat(5);
  open("/platform/products", "operations", (call) => (call.method === "GET" && call.url.pathname === "/platform/v1/products" ? page([rowOf({ title: { zh: longTitle }, tenant: { id: TENANT_ID, name: longName, status: "active" } })]) : null));
  const link = await screen.findByRole("link", { name: longTitle });
  assert.equal(link.getAttribute("title"), longTitle);
  assert.ok(screen.getByRole("link", { name: longName }));
});

// ───────────── 首页卡片 ─────────────

test("首页：主数据运营、技术没有商品卡片，也不去取商品的数；数量带千分位", async () => {
  for (const role of ["master_data_ops", "tech"]) {
    const calls = open("/platform", role, (call) => (call.method === "GET" && call.url.pathname === "/platform/v1/dashboard/summary" ? json(200, { tenants: null, master_data: null }) : null));
    await screen.findByRole("heading", { level: 1, name: "首页" });
    await new Promise((done) => setTimeout(done, 30));
    assertAbsent(document.querySelector(".entry-card a[href^='/platform/products']"));
    assert.equal(productCalls(calls).length, 0, role);
    resetBrowser();
  }
  open("/platform", "operations", (call) => (call.method === "GET" && call.url.pathname === "/platform/v1/products" ? page([], call.url.searchParams.get("has_active_price") === "false" ? 1234 : 12345) : null));
  await waitFor(() => assert.match(document.querySelector(".entry-card:has(a[href^='/platform/products'])")?.textContent ?? "", /已上架\s*12,345/));
  assert.ok(screen.getByRole("link", { name: "1,234 个已上架的商品报不出价" }));
});

test("首页：报不出价的数没取到（第二个请求失败）时，卡片不能显示成「没有报不出价的」——要么写「—」要么提示重试", async () => {
  open("/platform", "operations", (call) => {
    if (call.method !== "GET" || call.url.pathname !== "/platform/v1/products") return null;
    return call.url.searchParams.get("has_active_price") === "false" ? apiError(500, "INTERNAL", "boom") : page([], 7);
  });
  await screen.findByRole("heading", { level: 1, name: "首页" });
  await waitFor(() => assert.ok(screen.queryByText("数量没有加载出来", { selector: ".alert__title" }) || /—/.test(document.querySelector(".entry-card:has(a[href^='/platform/products'])")?.textContent ?? "")));
});

// ───────────── 报价试算 ─────────────

const settlementOf = (total: number, currency = "JPY", adjust = 0) => ({
  currency,
  rounding_unit: currency === "JPY" ? 100 : 1,
  total,
  base: total - adjust,
  adjust,
  urgent: 0,
  night: 0,
  addons: 0,
  driver_language: 0,
  exact: { base: String(total - adjust), adjusted: String(total), night: "0", addons: "0", total: String(total) },
  adjusts: adjust === 0 ? [] : [{ rule_id: RULE_ID, name: "淡季", steps: [{ type: "percent" as const, value: -1000, delta: String(adjust), after: String(total) }] }],
  urgent_tier: null,
  night_detail: null,
  addon_items: [],
  driver_language_code: null,
  usage: null,
  free_wait: { item: "pickup" as const, mode: "limited" as const, minutes: 60, platform_minimum_minutes: 60 },
});
const candidateOf = (position: number, changes: Partial<QuoteCandidate> = {}): QuoteCandidate => ({
  position,
  in_band: true,
  rank_price: "15249.6",
  tenant_id: TENANT_ID,
  tenant_name: "NOZOMI 自营车队",
  product_id: PRODUCT_ID,
  product_code: "PRD-A",
  product_version: 3,
  observation: false,
  score_centi: 450,
  completed_orders: 0,
  sell: 14523,
  sell_exact: "14523.4",
  markup_bp: 1000,
  markup_level: null,
  markup_rule_id: null,
  min_margin_applied: false,
  fx_buffer_bp: 150,
  fx: { from: "JPY", to: "USD", rate: "0.0067", as_of: "2026-10-15T00:00:00.000Z", lock: null },
  offer: { vehicle_group_id: GROUP_ID, package_hours: null, area_id: AREA_ID, price_rule_id: PRICE_ID, settlement: settlementOf(18000, "JPY", -2000) },
  ...changes,
});
const usdPreview = (changes: Partial<PlatformQuotePreview> = {}): PlatformQuotePreview => ({
  currency: "USD",
  band_bp: 300,
  channel: null,
  excluded: [],
  markup_floor_bp: 1000,
  route: { meters: 12_300, minutes: 45 },
  route_status: { status: "assumed", source: null, code: null, message: null },
  candidate_count: 2,
  groups: [
    {
      vehicle_group_id: GROUP_ID,
      package_hours: null,
      created_at: "2026-10-15T01:00:00.000Z",
      expires_at: "2026-10-15T01:30:00.000Z",
      winner: { tenant_id: TENANT_ID, tenant_name: "NOZOMI 自营车队", product_id: PRODUCT_ID, product_code: "PRD-A", sell: 14523, settlement: 18000, settlement_currency: "JPY" },
      candidates: [candidateOf(1), candidateOf(2, { tenant_name: "观察期车队", product_id: PRODUCT2_ID, product_code: "PRD-B", observation: true, sell: 15000, sell_exact: "15000", rank_price: "15750", in_band: false, fx: null, fx_buffer_bp: 0, offer: { vehicle_group_id: GROUP_ID, package_hours: null, area_id: AREA_ID, price_rule_id: PRICE_ID, settlement: settlementOf(15000, "USD") } })],
    },
    {
      vehicle_group_id: "56565656-5656-4565-8565-565656565656",
      package_hours: null,
      created_at: "2026-10-15T01:00:00.000Z",
      expires_at: "2026-10-15T01:30:00.000Z",
      winner: { tenant_id: TENANT_ID, tenant_name: null, product_id: PRODUCT_ID, product_code: null, sell: 100, settlement: 100, settlement_currency: "USD" },
      candidates: [candidateOf(1, { tenant_name: null, product_code: null, sell: 100, sell_exact: "100", rank_price: "100", fx: null, fx_buffer_bp: 0, offer: { vehicle_group_id: "56565656-5656-4565-8565-565656565656", package_hours: null, area_id: AREA_ID, price_rule_id: PRICE_ID, settlement: settlementOf(100, "USD") } })],
    },
  ],
  refused: [{ tenant_id: TENANT_ID, tenant_name: "远方车队", product_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", product_code: "PRD-C", vehicle_group_id: null, reason: "FX_RATE_UNAVAILABLE", message: "没有可用的汇率（或汇率超过 48 小时没更新），不能换算成客人支付的币种" }],
  ...changes,
});

async function fillPointToPoint(cityName: RegExp, date: string, time: string, currency: string): Promise<void> {
  const box = await screen.findByRole("combobox", { name: /城市/ });
  await user().click(box);
  await user().click(await screen.findByRole("option", { name: cityName }));
  await user().click(screen.getByRole("radio", { name: "点对点" }));
  for (const [which, lat, lng] of [["上车点", "34.05", "-118.24"], ["下车点", "33.94", "-118.40"]] as const) {
    const point = screen.getByRole("group", { name: which });
    await user().type(within(point).getByRole("textbox", { name: /纬度/ }), lat);
    await user().type(within(point).getByRole("textbox", { name: /经度/ }), lng);
  }
  await user().type(screen.getByRole("textbox", { name: "日期" }), date);
  await user().type(screen.getByRole("textbox", { name: "时刻" }), time);
  await user().type(screen.getByRole("textbox", { name: "人数" }), "1");
  await user().selectOptions(screen.getByRole("combobox", { name: "客人支付的币种" }), currency);
}

test("试算结果跨币种：对外价按 USD 两位小数、结算价按 JPY 不带小数；表头写客人支付的币种；明细写汇率、缓冲、下调的合计是负号；观察期有标签；名称没取到的有兜底", async () => {
  open("/platform/quote-preview", "operations", (call) => (call.method === "POST" && call.url.pathname === "/platform/v1/quotes/preview" ? json(200, usdPreview()) : null));
  await fillPointToPoint(/洛杉矶/, "2026-10-20", "0930", "USD");
  await user().click(screen.getByRole("button", { name: "试算" }));
  const card = (await screen.findByRole("heading", { level: 3, name: "商务七座" })).closest("section") as HTMLElement;
  assert.match(card.textContent ?? "", /中标：NOZOMI 自营车队（PRD-A） · 对外价 USD 145\.23 · 结算价 JPY 18,000/);
  assert.ok([...card.querySelectorAll("thead th")].some((node) => node.textContent === "对外价（USD）"));
  const rows = within(card).getAllByRole("row").filter((row) => !row.hidden && row.querySelector("td"));
  assert.match(rows[0]?.textContent ?? "", /JPY 18,000.*USD 145\.23.*10%.*USD 152\.496?/);
  assert.match(rows[1]?.textContent ?? "", /观察期（排序价按对外价加 5%）/);
  assert.match(rows[1]?.textContent ?? "", /USD 150\.00.*USD 150\.00.*USD 157\.50.*不在/);
  await user().click(within(card).getByRole("button", { name: "看 NOZOMI 自营车队 的结算价明细" }));
  const detail = card.querySelector(".quote-detail")?.textContent ?? "";
  for (const part of ["1 JPY = 0.0067 USD", "汇率缓冲 1.5%", "合计 −JPY 2,000", "对外价USD 145.23", "取整前 USD 145.234"]) assert.ok(detail.includes(part), `明细应有「${part}」：${detail}`);
  const other = screen.getByRole("heading", { level: 3, name: "车型组（名称没有加载出来）" }).closest("section") as HTMLElement;
  assert.match(other.textContent ?? "", /（供应商名称没有取到）/);
  assert.match(other.textContent ?? "", /USD 1\.00/);
  assert.match(document.body.textContent ?? "", /用的路程：12\.3 公里/);
  const refused = (screen.getByRole("heading", { level: 3, name: "没报出价的（1）" }).closest("section") as HTMLElement).textContent ?? "";
  assert.match(refused, /远方车队PRD-C整个商品没有可用的汇率/);
});

test("试算的时间按城市当地时间：时间旁写着时区；跨午夜（00:00、23:59）、夏令时切换那天的 01:30 原样提交；24:00 当场指出", async () => {
  const calls = open("/platform/quote-preview", "operations", (call) => (call.method === "POST" && call.url.pathname === "/platform/v1/quotes/preview" ? json(200, usdPreview({ groups: [], refused: [], candidate_count: 0 })) : null));
  await fillPointToPoint(/洛杉矶/, "2026-11-01", "2400", "USD");
  assert.match(document.body.textContent ?? "", /洛杉矶当地时间（America\/Los_Angeles）/);
  await user().click(screen.getByRole("button", { name: "试算" }));
  await screen.findByText("请填时间，例如 08:00");
  assert.equal(calls.filter((call) => call.method === "POST").length, 0);
  const sent: string[] = [];
  for (const [time, expected] of [["0130", "2026-11-01T01:30"], ["0000", "2026-11-01T00:00"], ["23:59", "2026-11-01T23:59"]] as const) {
    const box = screen.getByRole("textbox", { name: "时刻" });
    await user().clear(box);
    await user().type(box, time);
    await user().click(screen.getByRole("button", { name: "试算" }));
    await waitFor(() => assert.equal(calls.filter((call) => call.method === "POST").length, sent.length + 1));
    sent.push((calls.filter((call) => call.method === "POST").at(-1)?.body as { service_time: string }).service_time);
    assert.equal(sent.at(-1), expected);
  }
});
