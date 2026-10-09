/**
 * 供应商后台「商品」的组件测试：首页卡片、列表、新建和三个步骤、上架检查、各种被拒，以及区域页面里跟商品有关的部分。
 * 接口用测试替身；真实后端由端到端测试覆盖。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../App.tsx";
import type { AreaSummary } from "../../api/areas.ts";
import type { Addon, City, Place, VehicleGroup } from "../../api/master.ts";
import type { Brand, Product, ProductServiceRules, ProductSummary, PublishCheckItemBody, PublishCheckResult, ServiceRulesBody } from "../../api/products.ts";
import { type ApiCall, apiError, assertAbsent, assertFocused, json, resetBrowser, signIn, stubApiWith } from "../../testing/harness.tsx";

afterEach(resetBrowser);

const stamps = { created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-02T03:04:00.000Z" };
const CITY_ID = "11111111-1111-4111-8111-111111111111";
const POI_ID = "22222222-2222-4222-8222-222222222222";
const BRAND_ID = "33333333-3333-4333-8333-333333333333";
const AREA_ID = "44444444-4444-4444-8444-444444444444";
const AREA2_ID = "45454545-4545-4545-8545-454545454545";
const GROUP_ID = "55555555-5555-4555-8555-555555555555";
const ADDON_ID = "66666666-6666-4666-8666-666666666666";
const PRODUCT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BASE = `/tenant/v1/products/${PRODUCT_ID}`;

const tokyo: City = { id: CITY_ID, code: "CTY-JP-TYO", country_code: "JP", name: { zh: "东京" }, timezone: "Asia/Tokyo", center: { lng: 139.7, lat: 35.7 }, boundary: null, status: "active", version: 1, ...stamps };
const haneda: Place = { id: POI_ID, type: "airport", code: "HND", country_code: "JP", city_id: CITY_ID, parent_id: null, city: null, parent: null, name: { zh: "羽田机场" }, location: { lng: 139.78, lat: 35.55 }, category: null, flight_scope: "mixed", address: null, source: null, status: "active", version: 1, ...stamps } as unknown as Place;
const brand: Brand = { id: BRAND_ID, name: "NOZOMI", currency: "JPY", status: "active", version: 1, ...stamps };
const group: VehicleGroup = { id: GROUP_ID, code: "VG-BIZ-7", grade: "business", seats: 7, name: { zh: "商务七座" }, sample_models: ["丰田埃尔法"], power: "fuel", combos: [{ passengers: 6, luggage: 4 }, { passengers: 5, luggage: 5 }], status: "active", version: 1, ...stamps };
const seat: Addon = { id: ADDON_ID, code: "ADD-SEAT", categories: ["airport_transfer", "charter"], charge_unit: "per_item", name: { zh: "儿童座椅" }, description: {}, status: "active", version: 1, ...stamps };
const areaOf = (overrides: Partial<AreaSummary> = {}): AreaSummary => ({ id: AREA_ID, name: { zh: "东京 23 区" }, city_id: CITY_ID, city: { id: CITY_ID, code: tokyo.code, name: tokyo.name, status: "active", center: tokyo.center, boundary: null }, biz_type: "general", status: "active", operate_polygon_count: 1, forbid_polygon_count: 0, usage: { product_count: 0, published_product_count: 0 }, version: 2, ...stamps, ...overrides });
const base = { id: PRODUCT_ID, code: "PRD202610081430050001", status: "draft" as const, category: "airport_transfer" as const, title: { zh: "羽田机场接送" }, brand_id: BRAND_ID, brand: { id: BRAND_ID, name: "NOZOMI", currency: "JPY", status: "active" as const }, city_id: CITY_ID, city: { id: CITY_ID, code: tokyo.code, name: tokyo.name, country_code: "JP", timezone: "Asia/Tokyo", status: "active" as const }, poi_id: POI_ID, poi: { id: POI_ID, code: "HND", name: { zh: "羽田机场" }, type: "airport" as const, flight_scope: "mixed" as const, status: "active" as const }, area_count: 1, vehicle_group_count: 1, version: 7, published_at: null, ...stamps };
const productOf = (overrides: Partial<Product> = {}): Product => ({
  ...base,
  areas: [{ area_id: AREA_ID, priority: 0, name: { zh: "东京 23 区" }, biz_type: "general", status: "active" }],
  vehicle_groups: [{ vehicle_group_id: GROUP_ID, passengers: 6, luggage: 4, code: group.code, name: group.name, grade: "business", seats: 7, sample_models: group.sample_models, combos: group.combos, status: "active" }],
  dispatchers: [{ name: "山田", phone: "+81 90 1234 5678" }],
  ...overrides,
});
const rowOf = (overrides: Partial<ProductSummary> = {}): ProductSummary => ({ ...base, check: { can_publish: false, failed_required: 0, unavailable_required: 1 }, ...overrides });
const emptyRules: ServiceRulesBody = { booking: { sale_from: null, sale_to: null, service_time: null, lead_time_hours: null, note: null }, urgent: { enabled: false, daily_quota: null, tiers: [] }, night: { enabled: false, window: null, amount: null, charge_unit: null }, free_wait: { pickup: null, dropoff: null, general: null }, addons: [], driver_languages: [] };
const rulesOf = (rules: Partial<ServiceRulesBody> = {}, version = 7): ProductServiceRules => ({ version, currency: "JPY", free_wait_minimums: { pickup: 60, dropoff: 15, general: null }, rules: { ...emptyRules, ...rules } });
const item = (key: string, issues: { path: string; reason: string }[] = [], required = true): PublishCheckItemBody => ({ key, required, passed: issues.length === 0, issues: issues.map((issue) => ({ ...issue, message: "说明" })) });
/** 还没有设价格：商品刚建好时的真实情况。库存还没开放，但它不是上架必须的。 */
const NO_PRICE = [{ path: "/", reason: "NO_ACTIVE_PRICE_RULE" }];
const checkOf = (changes: Record<string, { path: string; reason: string }[]> = {}): PublishCheckResult => {
  const items = [item("basic_info", changes["basic_info"]), item("service_rules", changes["service_rules"]), item("price_rules", changes["price_rules"] ?? NO_PRICE), item("content", changes["content"]), item("adjust_rules", [], false), item("inventory", changes["inventory"], false)];
  return { can_publish: items.every((entry) => !entry.required || entry.passed), items };
};

const me = (role: string) => json(200, { user: { id: "u1", email: "user@supplier.example", name: "测试用户", role, status: "active", ...stamps }, tenant: { id: "t1", name: "测试用供应商", status: "active", ...stamps }, permissions: [], must_change_password: false });
const page = <T,>(items: T[], total = items.length) => json(200, { items, next_cursor: null, total });

type Route = (call: ApiCall & { url: URL }) => Response | Promise<Response> | null;

/** 登录成指定角色并渲染；`routes` 没接住的接口里，账号、首页数量、主数据清单、子品牌、区域清单有默认应答。 */
function open(path: string, role: string, routes: Route = () => null): ApiCall[] {
  signIn("tenant", "tenant-token");
  const calls = stubApiWith((call) => {
    const custom = routes(call);
    if (custom !== null) return custom;
    const at = call.url.pathname;
    if (call.method !== "GET") return null;
    if (at === "/tenant/v1/auth/me") return me(role);
    if (at === "/tenant/v1/dashboard/summary") return json(200, { areas: { active: 1, disabled: 0 }, products: { draft: 2, published: 1, unpublished: 0 } });
    if (at === "/tenant/v1/master/cities") return page([tokyo]);
    if (at === "/tenant/v1/master/places") return page([haneda]);
    if (at === "/tenant/v1/master/vehicle-groups") return page([group]);
    if (at === "/tenant/v1/master/addons") return page([seat]);
    if (at === "/tenant/v1/brands") return json(200, { items: [brand] });
    if (at === "/tenant/v1/areas") return page([areaOf(), areaOf({ id: AREA2_ID, name: { zh: "包车专用" }, biz_type: "charter" })]);
    if (at === "/tenant/v1/map/config") return json(200, { tiles: null });
    return null;
  });
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  return calls;
}

/** 一个已有商品的各接口：商品、检查结果、服务规则、商品详情。 */
function productRoutes(state: { product?: Product; check?: PublishCheckResult; rules?: ProductServiceRules; content?: Record<string, unknown> }, extra: Route = () => null): Route {
  return (call) => {
    const custom = extra(call);
    if (custom !== null) return custom;
    if (call.method !== "GET") return null;
    if (call.path === BASE) return json(200, state.product ?? productOf());
    if (call.path === `${BASE}/publish-check`) return json(200, state.check ?? checkOf());
    if (call.path === `${BASE}/service-rules`) return json(200, state.rules ?? rulesOf());
    if (call.path === `${BASE}/content`) return json(200, { version: 7, content: state.content ?? { zh: { title: "羽田机场接送", summary: null, includes: [], excludes: [], itinerary: null, pickup_guide: "2 号出口" } } });
    return null;
  };
}

const writes = (calls: ApiCall[]): ApiCall[] => calls.filter((call) => call.method !== "GET");
const stepText = (name: string): string => [...document.querySelectorAll(".step-nav__item")].find((node) => node.textContent?.includes(name))?.textContent ?? "";
const user = () => userEvent.setup();

// ───────────── 首页和列表 ─────────────

test("首页：商品卡片三组数量（已上架排第一）；有区域、没有商品、能新建时才提醒「先建一个」", async () => {
  open("/", "admin");
  await waitFor(() => assert.match([...document.querySelectorAll(".entry-card")].map((card) => card.textContent).join("|"), /商品已上架1草稿2已下架0/));
  assertAbsent(screen.queryByText("还没有商品，先建一个"));
  assert.ok(within(screen.getByRole("navigation", { name: "主菜单" })).getByRole("link", { name: "商品" }));

  resetBrowser();
  const none = { draft: 0, published: 0, unpublished: 0 };
  open("/", "pricing", (call) => (call.url.pathname === "/tenant/v1/dashboard/summary" ? json(200, { areas: { active: 1, disabled: 0 }, products: none }) : null));
  assert.equal((await screen.findByRole("link", { name: "还没有商品，先建一个" })).getAttribute("href"), "/products/new");

  // 一个启用的区域都没有：只提醒建区域，不同时出现两条「下一步」
  resetBrowser();
  open("/", "admin", (call) => (call.url.pathname === "/tenant/v1/dashboard/summary" ? json(200, { areas: { active: 0, disabled: 0 }, products: none }) : null));
  await screen.findByRole("link", { name: "还没有区域，先建一个" });
  assertAbsent(screen.queryByText("还没有商品，先建一个"));

  resetBrowser();
  open("/", "readonly", (call) => (call.url.pathname === "/tenant/v1/dashboard/summary" ? json(200, { areas: { active: 1, disabled: 0 }, products: none }) : null));
  await waitFor(() => assert.match(document.body.textContent ?? "", /已上架0/));
  assertAbsent(screen.queryByText("还没有商品，先建一个"));
});

test("列表：显示名、编号、品类、城市、接送点、状态；「上架准备」三种写法；筛选条件写进请求；只有一个子品牌时没有子品牌一列", async () => {
  const rows = [rowOf(), rowOf({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", code: "PRD2", title: {}, category: "charter", poi_id: null, poi: null, check: { can_publish: false, failed_required: 2, unavailable_required: 1 } }), rowOf({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", code: "PRD3", title: { en: "Published one" }, status: "published", check: { can_publish: true, failed_required: 0, unavailable_required: 0 } })];
  const calls = open(`/products?status=draft&category=charter&q=PRD&area=${AREA_ID}`, "admin", (call) => (call.method === "GET" && call.url.pathname === "/tenant/v1/products" ? page(rows) : call.path === `/tenant/v1/areas/${AREA_ID}` ? json(200, { ...areaOf(), polygons: [] }) : null));
  const first = (await screen.findByRole("link", { name: "羽田机场接送" })).closest("tr") as HTMLElement;
  for (const text of ["PRD202610081430050001", "接送机", "东京", "羽田机场", "HND", "草稿", "等待开放 1 步"]) assert.ok(first.textContent?.includes(text), `行里应该有「${text}」`);
  assert.equal(within(first).getByRole("link", { name: "羽田机场接送 的上架检查：等待开放 1 步" }).getAttribute("href"), `/products/${PRODUCT_ID}/publish`);
  const unnamed = (screen.getByRole("link", { name: "未命名的包车商品" }).closest("tr") as HTMLElement).textContent ?? "";
  assert.match(unnamed, /还差 2 项/);
  assert.match((screen.getByRole("link", { name: "Published one" }).closest("tr") as HTMLElement).textContent ?? "", /已满足.*已上架|已上架.*已满足/);
  assertAbsent(screen.queryByRole("columnheader", { name: "子品牌" }));
  await screen.findByText("区域：东京 23 区");
  const query = new URL(calls.find((call) => call.path.startsWith("/tenant/v1/products?"))?.path ?? "", "http://localhost").searchParams;
  assert.deepEqual([query.get("status"), query.get("category"), query.get("q"), query.get("area_id")], ["draft", "charter", "PRD", AREA_ID]);
  assert.doesNotMatch(document.body.textContent ?? "", /airport_transfer|draft|published|FEATURE_NOT_AVAILABLE/);
});

test("列表的几种空状态：一个区域都没有时先引导建区域；有区域时引导建商品；筛选无结果；只读角色没有新建和操作；不能看商品的角色没有权限", async () => {
  const empty: Route = (call) => (call.method === "GET" && call.url.pathname === "/tenant/v1/products" ? page([]) : call.url.pathname === "/tenant/v1/dashboard/summary" ? json(200, { areas: { active: 0, disabled: 0 }, products: { draft: 0, published: 0, unpublished: 0 } }) : null);
  open("/products", "admin", empty);
  await screen.findByText("先建区域，再建商品");
  assert.equal(screen.getByRole("link", { name: "新增区域" }).getAttribute("href"), "/areas/new");

  resetBrowser();
  open("/products", "admin", (call) => (call.method === "GET" && call.url.pathname === "/tenant/v1/products" ? page([]) : null));
  await screen.findByText("还没有商品");
  resetBrowser();
  open("/products?status=published", "admin", (call) => (call.method === "GET" && call.url.pathname === "/tenant/v1/products" ? page([]) : null));
  await screen.findByText("没有符合条件的商品");

  resetBrowser();
  open("/products", "readonly", (call) => (call.method === "GET" && call.url.pathname === "/tenant/v1/products" ? page([rowOf()]) : null));
  await screen.findByRole("link", { name: "羽田机场接送" });
  assertAbsent(screen.queryByRole("link", { name: "新建商品" }));
  assertAbsent(screen.queryByRole("button", { name: /更多操作/ }));

  resetBrowser();
  const calls = open("/products", "dispatch");
  await screen.findByText("你没有权限查看这里");
  assert.equal(calls.some((call) => call.path.startsWith("/tenant/v1/products")), false);
});

test("列表的「更多」：草稿可以删除（要确认）；已上架可以下架（要确认）；已下架只有上架检查；删除时它已经不是草稿、已被别人删除各有说明", async () => {
  const actor = user();
  const published = rowOf({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", title: { zh: "在卖的" }, status: "published" });
  const off = rowOf({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", title: { zh: "停卖的" }, status: "unpublished" });
  let deletes = 0;
  const calls = open("/products", "admin", (call) => {
    if (call.method === "GET" && call.url.pathname === "/tenant/v1/products") return page([rowOf(), published, off]);
    if (call.method === "POST" && call.path === `/tenant/v1/products/${published.id}/unpublish`) return json(200, { ...productOf(), id: published.id, title: published.title, status: "unpublished", version: 8 });
    if (call.method === "DELETE") {
      deletes += 1;
      return deletes === 1 ? apiError(409, "PRODUCT_NOT_DRAFT", "no", { status: "published" }) : apiError(404, "NOT_FOUND", "gone");
    }
    return null;
  });
  await actor.click(await screen.findByRole("button", { name: "停卖的 的更多操作" }));
  assert.deepEqual(screen.getAllByRole("menuitem").map((entry) => entry.textContent), ["上架检查"]);
  await actor.keyboard("{Escape}");

  await actor.click(screen.getByRole("button", { name: "在卖的 的更多操作" }));
  await actor.click(screen.getByRole("menuitem", { name: "下架" }));
  const down = await screen.findByRole("dialog", { name: "下架「在卖的」？" });
  assert.match(down.textContent ?? "", /已经接到的订单不受影响，仍然要照常履约。/);
  assert.equal(writes(calls).length, 0);
  await actor.click(within(down).getByRole("button", { name: "下架" }));
  await screen.findByText("已下架「在卖的」");
  await waitFor(() => assert.match((screen.getByRole("link", { name: "在卖的" }).closest("tr") as HTMLElement).textContent ?? "", /已下架/));

  await actor.click(screen.getByRole("button", { name: "羽田机场接送 的更多操作" }));
  await actor.click(screen.getByRole("menuitem", { name: "删除" }));
  const remove = await screen.findByRole("dialog", { name: "删除草稿「羽田机场接送」？" });
  assert.match(remove.textContent ?? "", /接送机 · 东京 · PRD202610081430050001/);
  await actor.click(within(remove).getByRole("button", { name: "删除" }));
  await within(remove).findByText("这个商品已经上过架，不再是草稿。不想卖的话可以下架。");
  assertAbsent(within(remove).queryByRole("button", { name: "删除" }));
  await actor.click(within(remove).getByRole("button", { name: "知道了" }));

  await actor.click(await screen.findByRole("button", { name: "羽田机场接送 的更多操作" }));
  await actor.click(screen.getByRole("menuitem", { name: "删除" }));
  await actor.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "删除" }));
  await screen.findByText("「羽田机场接送」已经被别人删除了。");
  assertAbsent(screen.queryByRole("link", { name: "羽田机场接送" }));
});

// ───────────── 新建 ─────────────

test("新建：没有子品牌时管理员当场建（币种不能改的提醒、重名的说明），商品价格角色请管理员建；建好自动选上", async () => {
  const actor = user();
  let taken = true;
  const calls = open("/products/new", "admin", (call) => {
    if (call.method === "GET" && call.url.pathname === "/tenant/v1/brands") return json(200, { items: [] });
    if (call.method === "POST" && call.path === "/tenant/v1/brands") {
      if (taken) {
        taken = false;
        return apiError(409, "BRAND_NAME_TAKEN", "taken");
      }
      return json(201, { ...brand, name: "新品牌", currency: "USD" });
    }
    return null;
  });
  await screen.findByText("还没有子品牌。");
  assert.equal((screen.getByRole("button", { name: "保存草稿" }) as HTMLButtonElement).disabled, true);
  assert.match(document.querySelector(".step__summary")?.textContent ?? "", /还没有子品牌/);
  await actor.click(screen.getByRole("button", { name: "新建子品牌" }));
  const dialog = await screen.findByRole("dialog", { name: "新建子品牌" });
  assert.match(dialog.textContent ?? "", /币种创建后不能修改。选错了只能另建一个子品牌。/);
  assert.deepEqual(within(dialog).getAllByRole("option").map((option) => option.textContent), ["请选择", "JPY 日元", "KRW 韩元", "CNY 人民币", "USD 美元", "HKD 港元", "TWD 新台币", "THB 泰铢"]);
  await actor.click(within(dialog).getByRole("button", { name: "新建" }));
  await within(dialog).findByText("请填写名称");
  await actor.type(within(dialog).getByLabelText(/名称/), "新品牌");
  await actor.click(within(dialog).getByRole("button", { name: "新建" }));
  await within(dialog).findByText("请选择结算币种");
  await actor.selectOptions(within(dialog).getByLabelText(/结算币种/), "USD");
  await actor.click(within(dialog).getByRole("button", { name: "新建" }));
  await within(dialog).findByText("已经有同名的子品牌，请换一个名字");
  await actor.click(within(dialog).getByRole("button", { name: "新建" }));
  await screen.findByText("已新建子品牌「新品牌」");
  await screen.findByText("新品牌（USD）");
  const posts = writes(calls);
  assert.deepEqual(posts[0]?.body, { name: "新品牌", currency: "USD" });
  assert.equal(posts[0]?.headers["idempotency-key"], posts[1]?.headers["idempotency-key"]);
  assert.equal((screen.getByRole("button", { name: "保存草稿" }) as HTMLButtonElement).disabled, false);

  resetBrowser();
  open("/products/new", "pricing", (call) => (call.method === "GET" && call.url.pathname === "/tenant/v1/brands" ? json(200, { items: [] }) : null));
  await screen.findByText("还没有子品牌，暂时不能新建商品。");
  assertAbsent(screen.queryByRole("button", { name: "新建子品牌" }));
});

async function fillNew(actor: ReturnType<typeof user>): Promise<void> {
  const cityBox = await screen.findByRole("combobox", { name: /城市/ });
  await actor.click(cityBox);
  await actor.click(await screen.findByRole("option", { name: /东京/ }));
  await actor.click(screen.getByRole("radio", { name: /^接送机/ }));
  await actor.click(await screen.findByRole("combobox", { name: /接送点/ }));
  await actor.click(await screen.findByRole("option", { name: /羽田机场/ }));
}

test("新建：创建后不能改的几项按必填报错；区域只列适用于这个品类的；车型组要选组合；提交带 Idempotency-Key，成功后换到编辑页", async () => {
  const actor = user();
  const calls = open("/products/new", "admin", productRoutes({ product: productOf({ title: {} }) }, (call) => (call.method === "POST" && call.path === "/tenant/v1/products" ? json(201, productOf({ title: {} })) : null)));
  await screen.findByText("NOZOMI（JPY）");
  assert.match(stepText("服务规则"), /先保存第 1 步/);
  assert.match(stepText("价格规则"), /先保存第 1 步/);
  assert.match(stepText("库存"), /先保存第 1 步/);
  await screen.findByText("先选城市和品类，这里会列出可以用的区域。");
  await actor.click(screen.getByRole("button", { name: "保存草稿" }));
  const summary = (await screen.findByText("有 2 处需要修改")).closest(".alert") as HTMLElement;
  assert.deepEqual(within(summary).getAllByRole("button").map((button) => button.textContent), ["城市：请选择城市", "品类：请选择品类"]);
  assert.equal(writes(calls).length, 0);

  await fillNew(actor);
  await screen.findByText("这四项创建后不能修改。");
  await actor.click(screen.getByRole("button", { name: "添加区域" }));
  const areas = screen.getByRole("group", { name: "添加区域" });
  assert.deepEqual(within(areas).getAllByRole("checkbox").map((box) => box.closest("label")?.textContent?.includes("东京 23 区")), [true]);
  await actor.click(within(areas).getByRole("checkbox"));
  await actor.click(within(areas).getByRole("button", { name: "完成" }));
  assertFocused(screen.getByRole("button", { name: "添加区域" }));
  await actor.click(screen.getByRole("button", { name: "添加车型组" }));
  await actor.click(within(screen.getByRole("group", { name: "添加车型组" })).getByRole("checkbox"));
  await actor.click(within(screen.getByRole("group", { name: "添加车型组" })).getByRole("button", { name: "完成" }));
  await actor.click(screen.getByRole("button", { name: "保存草稿" }));
  await waitFor(() => assert.ok(screen.getAllByText(/请给「商务七座」选一个「人数 \/ 行李数」组合/).length > 0));
  await actor.selectOptions(screen.getByLabelText("商务七座 的人数 / 行李数"), "5 人 5 件");
  await actor.type(screen.getByLabelText("第 1 个调度人的姓名"), "山田");
  await actor.click(screen.getByRole("button", { name: "保存草稿" }));
  await waitFor(() => assert.ok(screen.getAllByText(/第 1 个调度人请填写电话/).length > 0));
  await actor.type(screen.getByLabelText("第 1 个调度人的电话"), "+81 90 1234 5678");
  await actor.click(screen.getByRole("button", { name: "保存草稿" }));
  await screen.findByText("已创建商品，现在是草稿");
  const created = writes(calls)[0] as ApiCall;
  assert.match(created.headers["idempotency-key"] ?? "", /^[0-9a-f-]{36}$/);
  assert.deepEqual(created.body, { brand_id: BRAND_ID, city_id: CITY_ID, category: "airport_transfer", poi_id: POI_ID, areas: [{ area_id: AREA_ID }], vehicle_groups: [{ vehicle_group_id: GROUP_ID, passengers: 5, luggage: 5 }], dispatchers: [{ name: "山田", phone: "+81 90 1234 5678" }] });
  await screen.findByText(/这个商品还没有名字。/);
  await screen.findByText("这几项创建后不能修改。要换，请新建一个商品。");
});

test("新建被拒：城市被停用、选的区域被停用、网络不通——说明落在对应的地方，已填的内容都在；只读角色打不开新建页", async () => {
  const actor = user();
  const answers = [() => apiError(409, "MASTER_DATA_NOT_READY", "no", { reason: "CITY_DISABLED" }), () => apiError(400, "VALIDATION_FAILED", "bad", { issues: [{ path: "/areas/0/area_id", reason: "AREA_DISABLED", message: "区域已停用" }] }), () => Promise.reject(new TypeError("fetch failed"))];
  open("/products/new", "admin", (call) => (call.method === "POST" && call.path === "/tenant/v1/products" ? (answers.shift() as () => Response)() : null));
  await fillNew(actor);
  await actor.click(screen.getByRole("button", { name: "添加区域" }));
  await actor.click(within(screen.getByRole("group", { name: "添加区域" })).getByRole("checkbox"));
  await actor.click(screen.getByRole("button", { name: "保存草稿" }));
  await waitFor(() => assert.ok(screen.getAllByText(/这个城市已经被平台停用，请换一个。/).length > 0));
  await actor.click(screen.getByRole("button", { name: "保存草稿" }));
  await waitFor(() => assert.ok(screen.getAllByText(/「东京 23 区」已经停用，不能新选。/).length > 0));
  await actor.click(screen.getByRole("button", { name: "保存草稿" }));
  await screen.findByText("网络连接失败，请检查网络后重试。你填写的内容还在。");
  assert.ok(document.querySelector(`[data-area-pick="${AREA_ID}"]`));
  assert.doesNotMatch(document.body.textContent ?? "", /MASTER_DATA_NOT_READY|VALIDATION_FAILED|AREA_DISABLED/);

  resetBrowser();
  open("/products/new", "readonly");
  await screen.findByText("你没有权限查看这里");
});

// ───────────── 框架 ─────────────

test("框架：/products/{id} 换到第一个还没完成的开放步骤；步骤导航按检查结果显示每一步；不认识的步骤、找不到的商品、检查结果取不到各有处理", async () => {
  const check = checkOf({ price_rules: [], service_rules: [{ path: "/booking/service_time", reason: "REQUIRED" }, { path: "/booking/lead_time_hours", reason: "REQUIRED" }, { path: "/free_wait/pickup", reason: "REQUIRED" }, { path: "/free_wait/dropoff", reason: "REQUIRED" }] });
  open(`/products/${PRODUCT_ID}`, "admin", productRoutes({ check }));
  await screen.findByRole("heading", { level: 2, name: "② 服务规则" });
  await screen.findByRole("heading", { level: 1, name: "羽田机场接送" });
  assert.match(stepText("基础信息"), /第 1 步，基础信息，已完成/);
  assert.match(stepText("服务规则"), /还差 3 项/);
  assert.match(stepText("库存"), /已完成/);
  assert.match(stepText("上架检查"), /还差 1 项/);
  assert.ok(screen.getByText("已完成 4 / 5"));
  assert.equal(document.querySelector('.step-nav [aria-current="step"]')?.textContent?.includes("服务规则"), true);
  assert.equal([...document.querySelectorAll(".step-nav a")].length, 6, "五步都开放了，每一步都是链接");
  assert.equal(document.title, "服务规则 · 羽田机场接送 · NOZOMI 供应商后台");

  resetBrowser();
  open(`/products/${PRODUCT_ID}/no-such-step`, "admin", productRoutes({ check: checkOf({ price_rules: [] }) }));
  await screen.findByRole("heading", { level: 2, name: "上架检查" });

  resetBrowser();
  open("/products/not-a-uuid/basic", "admin");
  await screen.findByText("找不到这个商品");
  resetBrowser();
  open(`/products/${PRODUCT_ID}/basic`, "admin", (call) => (call.path === BASE ? apiError(404, "NOT_FOUND", "no") : call.path === `${BASE}/publish-check` ? apiError(404, "NOT_FOUND", "no") : null));
  await screen.findByText("找不到这个商品");

  resetBrowser();
  open(`/products/${PRODUCT_ID}/basic`, "admin", productRoutes({ product: productOf({ city: { ...base.city, status: "disabled" } }) }, (call) => (call.path === `${BASE}/publish-check` ? Promise.reject(new TypeError("fetch failed")) : null)));
  await screen.findByText("配置进度没有加载出来，不影响填写和保存。");
  await screen.findByText("这个商品的城市「东京」已停用。");
  assert.match(stepText("服务规则"), /—/);
  assert.ok(screen.getByRole("button", { name: "保存草稿" }));
});

// ───────────── ① 基础信息 ─────────────

test("基础信息：保存只带区域、车型组、调度人并带 If-Match；什么都没改时不发请求；已停用的区域和车型组有提醒；可以调顺序", async () => {
  const actor = user();
  const product = productOf({ areas: [{ area_id: AREA_ID, priority: 0, name: { zh: "东京 23 区" }, biz_type: "general", status: "disabled" }, { area_id: AREA2_ID, priority: 1, name: { zh: "成田周边" }, biz_type: "airport_transfer", status: "active" }] });
  // 底部的「还差几项」取自上架检查：检查结果和商品的内容摆成一致的（有一个区域已停用）
  const calls = open(`/products/${PRODUCT_ID}/basic`, "admin", productRoutes({ product, check: checkOf({ basic_info: [{ path: "/areas/0", reason: "AREA_DISABLED" }] }) }, (call) => (call.method === "PATCH" && call.path === BASE ? json(200, { ...product, version: 8 }) : null)));
  await screen.findByText(/有 1 个区域已停用。/);
  assert.match(document.querySelector(".step__summary")?.textContent ?? "", /这一步还差 1 项/);
  await actor.click(screen.getByRole("button", { name: "保存草稿" }));
  assert.equal(writes(calls).length, 0);
  await actor.click(screen.getByRole("button", { name: "把 成田周边 上移" }));
  assert.deepEqual([...document.querySelectorAll("[data-area-pick]")].map((row) => row.getAttribute("data-area-pick")), [AREA2_ID, AREA_ID]);
  assertFocused(screen.getByRole("button", { name: "把 成田周边 下移" }));
  await screen.findByText("成田周边 现在排第 1，共 2 个");
  assert.match(document.querySelector(".step__summary")?.textContent ?? "", /有未保存的修改/);
  await actor.click(screen.getByRole("button", { name: "保存草稿" }));
  await screen.findByText("已保存");
  const patch = writes(calls)[0] as ApiCall;
  assert.equal(patch.headers["if-match"], '"7"');
  assert.deepEqual(patch.body, { areas: [{ area_id: AREA2_ID }, { area_id: AREA_ID }], vehicle_groups: [{ vehicle_group_id: GROUP_ID, passengers: 6, luggage: 4 }], dispatchers: [{ name: "山田", phone: "+81 90 1234 5678" }] });
});

test("保存被拒：别人先改了要先载入最新内容；已上架的商品改完不满足上架条件；创建后不能改的字段；没有权限；商品已被删除", async () => {
  const actor = user();
  const cases: [Response, RegExp][] = [
    [apiError(409, "PUBLISH_CHECK_FAILED", "no", { items: checkOf({ basic_info: [{ path: "/dispatchers", reason: "NO_DISPATCHER" }] }).items }), /没有保存。这个商品已上架，改成这样就不满足上架的条件了。.*基础信息：还没有填调度人/],
    [apiError(409, "FIELD_LOCKED", "no", { fields: ["city_id", "category"] }), /城市、品类创建后不能修改。请刷新页面后重试。/],
    [apiError(409, "CONCURRENT_UPDATE", "no"), /同时有其他人在修改相关的数据，这次没有保存成功。请再点一次保存。/],
    [apiError(403, "FORBIDDEN", "no"), /你没有权限修改商品。需要的话，请联系你们的管理员开通。/],
    [apiError(404, "NOT_FOUND", "no"), /找不到这个商品，它可能已被别人删除。/],
    [apiError(500, "INTERNAL", "boom"), /系统暂时无法保存，请稍后再试。你填写的内容还在。/],
  ];
  for (const [answer, text] of cases) {
    open(`/products/${PRODUCT_ID}/basic`, "admin", productRoutes({ product: productOf({ status: "published" }) }, (call) => (call.method === "PATCH" ? answer : null)));
    await actor.clear(await screen.findByLabelText("第 1 个调度人的姓名"));
    await actor.type(screen.getByLabelText("第 1 个调度人的姓名"), "佐藤");
    assert.match(document.querySelector(".step__summary")?.textContent ?? "", /已上架，保存后约 1 分钟生效/);
    await actor.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => assert.match(document.querySelector(".step__alerts")?.textContent ?? "", text));
    assert.equal((screen.getByLabelText("第 1 个调度人的姓名") as HTMLInputElement).value, "佐藤");
    assert.doesNotMatch(document.body.textContent ?? "", /PUBLISH_CHECK_FAILED|FIELD_LOCKED|CONCURRENT_UPDATE|INTERNAL|NO_DISPATCHER/);
    resetBrowser();
  }

  let version = 7;
  const calls = open(`/products/${PRODUCT_ID}/basic`, "admin", (call) => {
    if (call.method === "PATCH") return call.headers["if-match"] === '"7"' ? ((version = 9), apiError(409, "VERSION_CONFLICT", "stale")) : json(200, productOf({ version: 10 }));
    return productRoutes({ product: productOf({ version, dispatchers: [{ name: version === 7 ? "山田" : "别人改的", phone: "+81 90 1234 5678" }] }) })(call);
  });
  await actor.type(await screen.findByLabelText("第 1 个调度人的姓名"), "二");
  await actor.click(screen.getByRole("button", { name: "保存草稿" }));
  await screen.findByText("这个商品刚被别人修改过，你在这一步的修改还没有保存。");
  assert.equal((screen.getByRole("button", { name: "保存草稿" }) as HTMLButtonElement).disabled, true);
  assert.match(document.querySelector(".step__summary")?.textContent ?? "", /请先载入最新内容/);
  await actor.click(screen.getByRole("button", { name: "载入最新内容" }));
  await screen.findByText("已载入最新内容。");
  await waitFor(() => assert.equal((screen.getByLabelText("第 1 个调度人的姓名") as HTMLInputElement).value, "别人改的"));
  await actor.type(screen.getByLabelText("第 1 个调度人的姓名"), "三");
  await actor.click(screen.getByRole("button", { name: "保存草稿" }));
  await waitFor(() => assert.equal(writes(calls).at(-1)?.headers["if-match"], '"9"'));
});

test("有未保存的修改时换步骤：先问；「不保存」直接走，「保存并继续」存完再走，「继续编辑」留下", async () => {
  const actor = user();
  const calls = open(`/products/${PRODUCT_ID}/basic`, "admin", productRoutes({}, (call) => (call.method === "PATCH" ? json(200, productOf({ version: 8, dispatchers: [{ name: "山田二", phone: "+81 90 1234 5678" }] })) : null)));
  await actor.type(await screen.findByLabelText("第 1 个调度人的姓名"), "二");
  await actor.click(within(screen.getByRole("navigation", { name: "配置步骤" })).getByRole("link", { name: /商品详情/ }));
  const dialog = await screen.findByRole("dialog", { name: "这一步有未保存的修改" });
  assert.deepEqual(within(dialog).getAllByRole("button").map((button) => button.textContent).filter((text) => text !== ""), ["继续编辑", "不保存", "保存并继续"]);
  await actor.click(within(dialog).getByRole("button", { name: "继续编辑" }));
  assert.ok(screen.getByRole("heading", { level: 2, name: "① 基础信息" }));
  await actor.click(within(screen.getByRole("navigation", { name: "配置步骤" })).getByRole("link", { name: /商品详情/ }));
  await actor.click(within(await screen.findByRole("dialog", { name: "这一步有未保存的修改" })).getByRole("button", { name: "保存并继续" }));
  await screen.findByRole("heading", { level: 2, name: "⑤ 商品详情" });
  assert.equal(writes(calls).length, 1);
  assert.equal(writes(calls)[0]?.method, "PATCH");
});

// ───────────── ② 服务规则 ─────────────

test("服务规则：时区和币种的说明；免费等待预先填好、没动过也能点保存存下来；填的内容整理后带 If-Match 提交；读回来的话", async () => {
  const actor = user();
  let saved: ServiceRulesBody | null = null;
  // 底部的「还差几项」取自上架检查：一条都没存过时，检查说服务时间、提前预订时长、两项免费等待都没有；保存以后检查通过
  const unsaved = checkOf({ service_rules: [{ path: "/booking/service_time", reason: "REQUIRED" }, { path: "/booking/lead_time_hours", reason: "REQUIRED" }, { path: "/free_wait/pickup", reason: "REQUIRED" }, { path: "/free_wait/dropoff", reason: "REQUIRED" }] });
  const calls = open(`/products/${PRODUCT_ID}/service-rules`, "admin", productRoutes({}, (call) => {
    if (call.method === "PUT" && call.path === `${BASE}/service-rules`) {
      saved = call.body as ServiceRulesBody;
      return json(200, rulesOf(saved, 8));
    }
    if (call.method === "GET" && call.path === `${BASE}/publish-check`) return json(200, saved === null ? unsaved : checkOf());
    return null;
  }));
  await screen.findByText(/Asia\/Tokyo（UTC\+9）/);
  assert.match(document.querySelector(".step .alert--info")?.textContent ?? "", /东京当地时间.*币种 JPY/);
  assert.equal((screen.getByLabelText("接机免费等待的分钟数") as HTMLInputElement).value, "60");
  assert.equal((screen.getByLabelText("送机免费等待的分钟数") as HTMLInputElement).value, "15");
  assert.match(document.body.textContent ?? "", /国际航班平台规定最少 90 分钟/);
  assert.doesNotMatch(document.querySelector(".step__summary")?.textContent ?? "", /有未保存的修改/);
  assert.match(document.querySelector(".step__summary")?.textContent ?? "", /这一步还差 3 项/, "和步骤导航说的一样：免费等待是页面替你填好的建议值，还没存过，也算一项");
  assert.match(stepText("服务规则"), /还差 3 项/);

  await actor.type(screen.getByLabelText("服务时间从"), "22");
  await actor.type(screen.getByLabelText("服务时间到"), "600");
  await actor.tab();
  assert.equal((screen.getByLabelText("服务时间到") as HTMLInputElement).value, "06:00");
  await screen.findByText("每天 22:00–次日 06:00，共 8 小时（跨午夜）");
  await actor.type(screen.getByLabelText("提前预订时长（小时）"), "48");
  await screen.findByText("= 2 天");
  await actor.click(screen.getByRole("checkbox", { name: "允许加急预订" }));
  await actor.type(screen.getByLabelText("第 1 档：提前不足多少小时"), "12");
  await actor.type(screen.getByLabelText("第 1 档：加收的金额"), "3000");
  await screen.findByText("提前不足 12 小时下单：加收 JPY 3,000");
  assert.match(document.querySelector(".readback__gap")?.textContent ?? "", /提前 12 到 48 小时下单：不接（不在任何一档里）。要接这一段，请加一档「提前不足 48 小时」/);
  await actor.click(screen.getByRole("checkbox", { name: /儿童座椅/ }));
  await actor.click(screen.getByRole("button", { name: "保存草稿" }));
  await waitFor(() => assert.ok(screen.getAllByText(/请填单价，免费提供请填 0/).length > 0));
  await actor.type(screen.getByLabelText("儿童座椅的单价"), "0");
  await screen.findByText("免费提供");
  assert.equal((screen.getByRole("checkbox", { name: /第一个免费/ }) as HTMLInputElement).disabled, true);
  await actor.click(screen.getByRole("button", { name: "保存草稿" }));
  await screen.findByText("已保存");
  const put = writes(calls)[0] as ApiCall;
  assert.equal(put.headers["if-match"], '"7"');
  assert.deepEqual(saved, {
    booking: { sale_from: null, sale_to: null, service_time: { start: "22:00", end: "06:00" }, lead_time_hours: 48, note: null },
    urgent: { enabled: true, daily_quota: null, tiers: [{ within_hours: 12, surcharge: 3000 }] },
    night: { enabled: false, window: null, amount: null, charge_unit: null },
    free_wait: { pickup: { mode: "limited", minutes: 60 }, dropoff: { mode: "limited", minutes: 15 }, general: null },
    addons: [{ addon_id: ADDON_ID, enabled: true, unit_price: 0, first_free: false }],
    driver_languages: [],
  });
  assert.match(document.querySelector(".step__summary")?.textContent ?? "", /这一步已完成/);

  // 什么都没动的新商品：点保存也会把替用户填好的免费等待存下来
  resetBrowser();
  const second = open(`/products/${PRODUCT_ID}/service-rules`, "admin", productRoutes({}, (call) => (call.method === "PUT" ? json(200, rulesOf(call.body as ServiceRulesBody, 8)) : null)));
  await screen.findByText(/下面是按平台规定的最少时间替你填好的/);
  await actor.click(screen.getByRole("button", { name: "保存草稿" }));
  await screen.findByText("已保存");
  assert.deepEqual((writes(second)[0]?.body as ServiceRulesBody).free_wait, { pickup: { mode: "limited", minutes: 60 }, dropoff: { mode: "limited", minutes: 15 }, general: null });
});

test("服务规则：后端指出的问题落在对应的输入框上；平台停用的附加服务有提醒；只读角色不能改也没有保存", async () => {
  const actor = user();
  const rules = rulesOf({ booking: { sale_from: null, sale_to: null, service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 0, note: null }, free_wait: { pickup: { mode: "limited", minutes: 60 }, dropoff: { mode: "unlimited" }, general: null }, addons: [{ addon_id: ADDON_ID, enabled: true, unit_price: 1000, first_free: true }] });
  const routes = productRoutes({ rules }, (call) => {
    if (call.method === "GET" && call.url.pathname === "/tenant/v1/master/addons") return page([{ ...seat, status: "disabled" }]);
    if (call.method === "PUT") return apiError(400, "VALIDATION_FAILED", "bad", { issues: [{ path: "/free_wait/pickup/minutes", reason: "BELOW_PLATFORM_MINIMUM", message: "太短", detail: { min: 90 } }] });
    return null;
  });
  open(`/products/${PRODUCT_ID}/service-rules`, "admin", routes);
  await screen.findByText("平台已停用");
  await screen.findByText("上架前请取消勾选。");
  assert.equal((screen.getByRole("checkbox", { name: "全天 24 小时" }) as HTMLInputElement).checked, true);
  assert.equal((screen.getByLabelText("服务时间到") as HTMLInputElement).value, "24:00");
  await screen.findByText("提前预订时长是 0，客人随时可以订，用不到加急预订。");
  assert.deepEqual([...document.querySelectorAll<HTMLInputElement>('input[name="wait-dropoff"]')].map((radio) => radio.checked), [false, true], "送机存的是「不限时」");
  await actor.clear(screen.getByLabelText("接机免费等待的分钟数"));
  await actor.type(screen.getByLabelText("接机免费等待的分钟数"), "70");
  await actor.click(screen.getByRole("button", { name: "保存草稿" }));
  await waitFor(() => assert.ok(screen.getAllByText("不能少于平台规定的 90 分钟").length > 0));
  assertFocused(screen.getByLabelText("接机免费等待的分钟数"));

  resetBrowser();
  open(`/products/${PRODUCT_ID}/service-rules`, "readonly", productRoutes({ rules }));
  await screen.findByText("你可以查看商品，但不能修改。需要修改的话，请联系你们的管理员开通。");
  await waitFor(() => assert.equal((screen.getByLabelText("接机免费等待的分钟数") as HTMLInputElement).readOnly, true));
  assertAbsent(screen.queryByRole("button", { name: /保存/ }));
  assert.ok(screen.getByRole("link", { name: "回到列表" }));
});

// ───────────── ⑤ 商品详情 ─────────────

test("商品详情：四种语言各一张卡片，没填的收起；接送机缺接机指引算一项；只提交填了的语言；清空一种语言要确认", async () => {
  const actor = user();
  const calls = open(`/products/${PRODUCT_ID}/content`, "admin", productRoutes({ check: checkOf({ content: [{ path: "/zh/pickup_guide", reason: "REQUIRED" }] }), content: { zh: { title: "羽田机场接送", summary: null, includes: ["高速费"], excludes: [], itinerary: null, pickup_guide: null } } }, (call) => (call.method === "PUT" ? json(200, { version: 8, content: call.body }) : null)));
  await screen.findByDisplayValue("羽田机场接送");
  assert.deepEqual([...document.querySelectorAll(".content__status")].map((node) => node.textContent), ["还差接机指引", "没有填", "没有填", "没有填"]);
  assert.match(document.querySelector(".step__summary")?.textContent ?? "", /这一步还差 1 项/);
  assertAbsent(screen.queryByLabelText(/行程路线/));
  await actor.type(screen.getByLabelText(/接机指引/), "2 号出口");
  await actor.click(screen.getByRole("button", { name: "填写英语" }));
  assertFocused(document.getElementById("title-en"));
  await actor.type(document.getElementById("title-en") as HTMLElement, "x".repeat(101));
  await actor.click(screen.getByRole("button", { name: "保存草稿" }));
  await waitFor(() => assert.ok(screen.getAllByText("英语的标题最多 100 个字").length > 0));
  await actor.click(screen.getByRole("button", { name: "清空英语" }));
  await actor.click(within(await screen.findByRole("dialog", { name: "清空英语的全部内容？" })).getByRole("button", { name: "清空" }));
  await actor.click(screen.getByRole("button", { name: "保存草稿" }));
  await screen.findByText("已保存");
  const put = writes(calls)[0] as ApiCall;
  assert.equal(put.headers["if-match"], '"7"');
  assert.deepEqual(put.body, { zh: { title: "羽田机场接送", summary: null, includes: ["高速费"], excludes: [], itinerary: null, pickup_guide: "2 号出口" } });
});

// ───────────── 上架检查 ─────────────

test("上架检查：还有自己要补的——逐条列出原因和「去填」；已上架的显示下架；只读角色只有「去查看」；检查结果取不到给重试", async () => {
  const check = checkOf({ price_rules: [], basic_info: [{ path: "/areas/0", reason: "AREA_DISABLED" }, { path: "/areas/1", reason: "AREA_DISABLED" }, { path: "/dispatchers", reason: "NO_DISPATCHER" }, { path: "/city_id", reason: "CITY_DISABLED" }], content: [{ path: "/zh/pickup_guide", reason: "REQUIRED" }], service_rules: [{ path: "/night/window", reason: "REQUIRED" }, { path: "/night/amount", reason: "REQUIRED" }, { path: "/x", reason: "SOMETHING_NEW" }] });
  open(`/products/${PRODUCT_ID}/publish`, "admin", productRoutes({ check }));
  await screen.findByText("还不能上架：还有 3 项要补");
  const basic = document.querySelector('[data-check="basic_info"]') as HTMLElement;
  assert.deepEqual([...basic.querySelectorAll(".checklist__reasons > li > span:first-child")].map((node) => node.textContent), ["城市「东京」已被平台停用", "选的服务区域里有 2 个已停用，请重新启用或移除", "还没有填调度人"]);
  assert.match(basic.textContent ?? "", /还差 3 项/);
  assert.match(basic.textContent ?? "", /请联系平台运营/);
  assert.equal(within(basic).getByRole("link", { name: "去填：还没有填调度人" }).getAttribute("href"), `/products/${PRODUCT_ID}/basic#dispatchers`);
  assert.equal(within(basic).getByRole("link", { name: "去修改：基础信息" }).getAttribute("href"), `/products/${PRODUCT_ID}/basic`);
  assert.equal(screen.getByRole("link", { name: "去填：中文还没有填接机指引" }).getAttribute("href"), `/products/${PRODUCT_ID}/content#pickup-guide-zh`);
  const rules = document.querySelector('[data-check="service_rules"]') as HTMLElement;
  assert.deepEqual([...rules.querySelectorAll(".checklist__reasons > li > span:first-child")].map((node) => node.textContent), ["夜间加价：时段、计费方式、金额还没有填齐", "说明"]);
  assert.equal(document.getElementById("publish-note")?.textContent, "还不能上架：还有 3 项要补。");

  resetBrowser();
  open(`/products/${PRODUCT_ID}/publish`, "readonly", productRoutes({ check }));
  await screen.findByText("还不能上架：还有 3 项要补");
  assertAbsent(screen.queryByRole("button", { name: "上架" }));
  assert.ok(screen.getByRole("link", { name: "去查看：还没有填调度人" }));

  resetBrowser();
  open(`/products/${PRODUCT_ID}/publish`, "admin", productRoutes({ product: productOf({ status: "published" }), check: checkOf({ price_rules: [] }) }));
  await screen.findByText("这个商品正在参与报价和接单。修改任何一步，保存后大约 1 分钟生效。");
  assert.ok(screen.getByRole("button", { name: "下架" }));
  assert.match(stepText("上架检查"), /已上架/);

  resetBrowser();
  let attempts = 0;
  const actor = user();
  open(`/products/${PRODUCT_ID}/publish`, "admin", productRoutes({}, (call) => (call.path === `${BASE}/publish-check` && (attempts += 1) <= 2 ? Promise.reject(new TypeError("fetch failed")) : null)));
  await screen.findByText("检查结果没有加载出来");
  assertAbsent(screen.queryByRole("button", { name: "上架" }));
  await actor.click(within(document.querySelector(".checklist-card, .step .card") as HTMLElement).getByRole("button", { name: "重试" }));
  await screen.findByText("还不能上架：还有 1 项要补", { exact: true });
});

test("上架：检查都通过时要确认（说明不能拒单）；成功后变成已上架；被拒（内容又变了）时用应答里的最新结果更新清单并说明", async () => {
  const actor = user();
  const ready = checkOf({ price_rules: [] });
  let product = productOf();
  const calls = open(`/products/${PRODUCT_ID}/publish`, "admin", (call) => {
    if (call.method === "POST" && call.path === `${BASE}/publish`) return json(200, (product = productOf({ status: "published", version: 8 })));
    return productRoutes({ check: ready })(call) && call.path === BASE ? json(200, product) : productRoutes({ check: ready })(call);
  });
  await screen.findByText("可以上架了");
  assert.match(stepText("上架检查"), /可以上架/);
  await actor.click(screen.getByRole("button", { name: "上架" }));
  const dialog = await screen.findByRole("dialog", { name: "上架「羽田机场接送」？" });
  assert.match(dialog.textContent ?? "", /订单直接派给你们，不能拒单/);
  assert.equal(writes(calls).length, 0);
  await actor.click(within(dialog).getByRole("button", { name: "上架" }));
  await screen.findByText("已上架「羽田机场接送」");
  await screen.findByRole("button", { name: "下架" });

  resetBrowser();
  const latest = checkOf({ price_rules: [], basic_info: [{ path: "/vehicle_groups/0", reason: "VEHICLE_GROUP_DISABLED" }] });
  open(`/products/${PRODUCT_ID}/publish`, "admin", productRoutes({ check: ready }, (call) => (call.method === "POST" ? apiError(409, "PUBLISH_CHECK_FAILED", "no", { items: latest.items }) : null)));
  await screen.findByText("可以上架了");
  await actor.click(screen.getByRole("button", { name: "上架" }));
  await actor.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "上架" }));
  await screen.findByText("没有上架。");
  await screen.findByText("检查结果和刚才不一样了，请看下面最新的结果。");
  assertAbsent(screen.queryByRole("dialog"));
  assert.match(document.querySelector('[data-check="basic_info"]')?.textContent ?? "", /选的车型组里有 1 个已被平台停用，请移除/);
  assert.equal(screen.getByRole("button", { name: "上架" }).getAttribute("aria-disabled"), "true");
  assert.doesNotMatch(document.body.textContent ?? "", /PUBLISH_CHECK_FAILED|VEHICLE_GROUP_DISABLED/);
});

// ───────────── 区域页面里跟商品有关的 ─────────────

test("区域：列表显示被几个商品使用；停用被拒（有已上架的商品在用）给出去看这些商品的链接；删除时说明没上架的商品会少掉这个区域；被商品使用时业务类型不能改", async () => {
  const actor = user();
  const used = areaOf({ usage: { product_count: 3, published_product_count: 1 } });
  open("/areas", "admin", (call) => {
    if (call.method === "GET" && call.url.pathname === "/tenant/v1/areas") return page([used, areaOf({ id: AREA2_ID, name: { zh: "没人用的" } })]);
    if (call.method === "POST" && call.path === `/tenant/v1/areas/${AREA_ID}/disable`) return apiError(409, "AREA_IN_USE", "in use", { published_product_count: 1 });
    return null;
  });
  const row = (await screen.findByRole("link", { name: "东京 23 区" })).closest("tr") as HTMLElement;
  assert.equal(within(row).getByRole("link", { name: "查看使用 东京 23 区 的 3 个商品" }).getAttribute("href"), `/products?area=${AREA_ID}`);
  assert.match(row.textContent ?? "", /1 个已上架/);
  assert.match((screen.getByRole("link", { name: "没人用的" }).closest("tr") as HTMLElement).textContent ?? "", /—/);
  await actor.click(screen.getByRole("button", { name: "东京 23 区 的更多操作" }));
  await actor.click(screen.getByRole("menuitem", { name: "停用" }));
  let dialog = await screen.findByRole("dialog");
  await actor.click(within(dialog).getByRole("button", { name: "停用" }));
  await within(dialog).findByText(/有 1 个已上架的商品在用这个区域。/);
  assert.equal(within(dialog).getByRole("link", { name: "查看这些商品" }).getAttribute("href"), `/products?area=${AREA_ID}&status=published`);
  await actor.click(within(dialog).getByRole("button", { name: "知道了" }));
  await actor.click(screen.getByRole("button", { name: "东京 23 区 的更多操作" }));
  await actor.click(screen.getByRole("menuitem", { name: "删除" }));
  dialog = await screen.findByRole("dialog");
  assert.match(dialog.textContent ?? "", /有 2 个没上架的商品选了这个区域，删除后它们会少掉这个区域。/);

  resetBrowser();
  open(`/areas/${AREA_ID}`, "admin", (call) => (call.method === "GET" && call.path === `/tenant/v1/areas/${AREA_ID}` ? json(200, { ...used, polygons: [{ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", kind: "operate", seq: 1, label: null, source: "drawn", circle: null, geometry: { type: "Polygon", coordinates: [[[139.6, 35.6], [139.8, 35.6], [139.8, 35.8], [139.6, 35.6]]] } }] }) : null));
  await screen.findByText(/已有 3 个商品在用这个区域，不能改业务类型。/);
  assertAbsent(screen.queryByRole("radio", { name: /^包车/ }));
  assert.equal(screen.getByRole("link", { name: "查看这些商品" }).getAttribute("href"), `/products?area=${AREA_ID}`);
});
