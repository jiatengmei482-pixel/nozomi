/**
 * 包车三层区域的价格页（M9P-07，ADR 0093 第一、五、七节；规格第四节）的组件测试：
 * 迁移过的商品（`charter_layout = three_layer`）显示套餐价（车型组 × 套餐一次填）、「行程加价」「上下车加价」两张表、旧的按区域套餐价折叠只读；
 * 空格「空 = 不报价」和「N 格没填」；上下车加价的下拉里基础价区域灰掉（行程加价能选）；基础价区域上的上下车加价行标红、不算未保存、不提交；
 * 保存被拒（区域重叠）写出两个区域名和面积；顶部「迁移差异 N 条」点开看明细。没迁移过的商品照旧（区域加价块）。
 * 接口用测试替身；真实后端由端到端测试（e2e/charter-layers.spec.ts）覆盖。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../../App.tsx";
import type { AreaSummary } from "../../../api/areas.ts";
import type { CharterMigrationDiff, PriceRuleBody, PriceRules } from "../../../api/prices.ts";
import type { Product } from "../../../api/products.ts";
import { LAYER_TEXT } from "../../../lib/charter-layers.ts";
import { type ApiCall, apiError, assertAbsent, json, resetBrowser, signIn, stubApiWith } from "../../../testing/harness.tsx";

afterEach(resetBrowser);

const stamps = { created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-02T03:04:00.000Z" };
const PRODUCT_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const BASE = `/tenant/v1/products/${PRODUCT_ID}`;
const TODAY = "2026-11-16";
const TOKYO = "11111111-1111-4111-8111-111111111111";
const FUJI = "22222222-2222-4222-8222-222222222222";
const CHIBA = "33333333-3333-4333-8333-333333333333";
const COMFORT = "66666666-6666-4666-8666-666666666666";
const BUSINESS = "77777777-7777-4777-8777-777777777777";
const ON_BASE_ID = "88888888-8888-4888-8888-888888888888";
const UPDOWN_ID = "99999999-9999-4999-8999-999999999999";
const ITINERARY_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const LEGACY_ID = "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb";

const city = (id: string, name: string) => ({ id, code: `CTY-${id.slice(0, 3)}`, name: { zh: name }, status: "active" as const, center: { lat: 35, lng: 139 }, boundary: null });
const areaOf = (id: string, name: string, overrides: Partial<AreaSummary> = {}): AreaSummary => ({ id, name: { zh: name }, city_id: "c1", city: city("c1", "东京"), biz_type: "general", role: "both", status: "active", operate_polygon_count: 1, forbid_polygon_count: 0, usage: { product_count: 0, published_product_count: 0 }, version: 1, ...stamps, ...overrides });
const AREAS: AreaSummary[] = [areaOf(TOKYO, "东京 23 区"), areaOf(FUJI, "富士山", { role: "pricing", biz_type: "charter" }), areaOf(CHIBA, "千叶")];

const productOf = (): Product =>
  ({
    id: PRODUCT_ID,
    code: "PRD202611160001",
    status: "draft",
    category: "charter",
    title: { zh: "东京包车" },
    brand_id: "b1",
    brand: { id: "b1", name: "NOZOMI", currency: "JPY", status: "active" },
    city_id: "c1",
    city: { id: "c1", code: "CTY-JP-TYO", name: { zh: "东京" }, country_code: "JP", timezone: "Asia/Tokyo", status: "active" },
    poi_id: null,
    poi: null,
    area_count: 1,
    vehicle_group_count: 2,
    version: 7,
    ...stamps,
    areas: [{ area_id: TOKYO, priority: 0, name: { zh: "东京 23 区" }, biz_type: "general", status: "active" }],
    vehicle_groups: [
      { vehicle_group_id: COMFORT, passengers: 4, luggage: 2, code: "VG-CMF-5", name: { zh: "舒适五座" }, grade: "comfort", seats: 5, sample_models: [], combos: [{ passengers: 4, luggage: 2 }], status: "active" },
      { vehicle_group_id: BUSINESS, passengers: 6, luggage: 4, code: "VG-BIZ-7", name: { zh: "商务七座" }, grade: "business", seats: 7, sample_models: [], combos: [{ passengers: 6, luggage: 4 }], status: "active" },
    ],
    dispatchers: [{ name: "山田", phone: "+81 90 1234 5678" }],
  }) as unknown as Product;

const EMPTY = { direction: null, base_price: null, start_price: null, start_meters: null, start_minutes: null, per_km: null, per_minute: null, min_price: null, package_km: null, package_price: null, overtime_per_hour: null, over_km_per_km: null, valid_to: null, status: "enabled" as const, ...stamps };
/** 整商品套餐价：区域为 null（类型上 area_id 是字符串，接口真实返回 null） */
const wholePackage = (id: string, group: string, hours: number, price = 55000): PriceRuleBody => ({ ...EMPTY, id, area_id: null as unknown as string, vehicle_group_id: group, package_hours: hours, pricing_model: "charter_package", package_km: 300, package_price: price, overtime_per_hour: 5000, over_km_per_km: 300, valid_from: "2026-11-01", base: String(price) });
const legacyPackage = (overrides: Partial<PriceRuleBody> = {}): PriceRuleBody => ({ ...EMPTY, id: LEGACY_ID, area_id: TOKYO, vehicle_group_id: COMFORT, package_hours: 10, pricing_model: "charter_package", package_km: 300, package_price: 65000, overtime_per_hour: 5000, over_km_per_km: 300, valid_from: "2026-11-01", base: "65000", ...overrides });
const itineraryRule = (overrides: Partial<PriceRuleBody> = {}): PriceRuleBody => ({ ...EMPTY, id: ITINERARY_ID, area_id: FUJI, vehicle_group_id: COMFORT, package_hours: null, pricing_model: "charter_itinerary_surcharge", itinerary_surcharge: 10000, valid_from: "2026-11-01", base: "0", ...overrides });
const updownRule = (overrides: Partial<PriceRuleBody> = {}): PriceRuleBody => ({ ...EMPTY, id: UPDOWN_ID, area_id: FUJI, vehicle_group_id: COMFORT, package_hours: null, pricing_model: "charter_area_surcharge", pickup_surcharge: 10000, dropoff_surcharge: 10000, waypoint_surcharge: 10000, valid_from: "2026-11-01", base: "0", ...overrides });
const RULES = [wholePackage("w1", COMFORT, 10), wholePackage("w2", BUSINESS, 10, 60000), legacyPackage(), itineraryRule(), updownRule()];
const pricesOf = (items: PriceRuleBody[], overrides: Partial<PriceRules> = {}): PriceRules => ({
  version: 7,
  currency: "JPY",
  rounding_unit: 1,
  available_models: ["charter_package"],
  surcharge_models: ["charter_area_surcharge", "charter_itinerary_surcharge"],
  charter_layout: "three_layer",
  today: TODAY,
  items,
  coverage: { total: 2, priced: 2, missing: 0 },
  ...overrides,
});
const NO_DIFF: CharterMigrationDiff = { charter_layout: "three_layer", items: [] };

type Route = (call: ApiCall & { url: URL }) => Response | Promise<Response> | null;
function open(prices: PriceRules, extra: Route = () => null, diff: CharterMigrationDiff = NO_DIFF): ApiCall[] {
  signIn("tenant", "tenant-token");
  const calls = stubApiWith((call) => {
    const custom = extra(call);
    if (custom !== null) return custom;
    if (call.method !== "GET") return null;
    const at = call.url.pathname;
    if (at === "/tenant/v1/auth/me") return json(200, { user: { id: "u1", email: "user@supplier.example", name: "测试用户", role: "admin", status: "active", ...stamps }, tenant: { id: "t1", name: "测试用供应商", status: "active", ...stamps }, permissions: [], must_change_password: false });
    if (at === BASE) return json(200, productOf());
    if (at === `${BASE}/publish-check`) return json(200, { can_publish: true, items: [] });
    if (at === `${BASE}/price-rules`) return json(200, prices);
    if (at === `${BASE}/adjust-rules`) return json(200, { version: 7, currency: "JPY", rounding_unit: 1, today: TODAY, items: [] });
    if (at === `${BASE}/charter-migration-diff`) return json(200, diff);
    if (at === "/tenant/v1/areas") return json(200, { items: AREAS, next_cursor: null, total: AREAS.length });
    if (at === "/tenant/v1/brands") return json(200, { items: [{ id: "b1", name: "NOZOMI", currency: "JPY", status: "active", version: 4, ...stamps }] });
    if (at === "/tenant/v1/dashboard/summary") return json(200, { areas: { active: 3, disabled: 0 }, products: { draft: 1, published: 0, unpublished: 0 } });
    if (at === "/tenant/v1/area-map") return json(200, { items: [], truncated: false });
    return null;
  });
  render(
    <MemoryRouter initialEntries={[`/products/${PRODUCT_ID}/prices`]}>
      <App />
    </MemoryRouter>,
  );
  return calls;
}

const user = () => userEvent.setup();
const writes = (calls: ApiCall[]): ApiCall[] => calls.filter((call) => call.method !== "GET");
type Batch = { create: Record<string, unknown>[]; update: Record<string, unknown>[]; delete: string[] };
const batchOf = (call: ApiCall | undefined): Batch => call?.body as Batch;
const save = async (actor: ReturnType<typeof user>): Promise<void> => actor.click(screen.getByRole("button", { name: "保存草稿" }));
/** 一张加价表（等区域的名字取回来） */
const table = async (title: string): Promise<HTMLElement> => {
  const section = (await screen.findByRole("heading", { level: 3, name: new RegExp(`^${title}`) })).closest("section") as HTMLElement;
  await waitFor(() => assert.doesNotMatch(section.textContent ?? "", /（区域）/));
  return section;
};
const summary = (): string => document.querySelector(".price-summary")?.textContent ?? "";
const savedAs = (items: PriceRuleBody[]) => json(200, { ...pricesOf(items, { version: 8 }), created_ids: [] });

test("迁移过的包车：套餐价按车型组 × 套餐一次填（没有区域列）、行程加价和上下车加价两张表、旧的按区域套餐价折叠只读；空格「空 = 不报价」、表头「N 格没填」；没有途经加价列", async () => {
  const calls = open(pricesOf(RULES));
  const itinerary = await table(LAYER_TEXT.itineraryTitle);
  const updown = await table(LAYER_TEXT.updownTitle);
  assert.ok(screen.getByRole("heading", { level: 3, name: /^套餐价（按车型组 × 套餐填一次/ }));
  assertAbsent(screen.queryByRole("heading", { level: 3, name: /^区域加价/ }));
  assertAbsent(screen.queryByRole("heading", { level: 3, name: "基础定价" }));
  // 套餐价：只有整商品的两行，没有区域列；格子的名字是「车型组 · 套餐」
  const priceTable = document.getElementById("price-table") as HTMLElement;
  assert.equal(priceTable.querySelectorAll("tbody tr").length, 2);
  assert.deepEqual([...priceTable.querySelectorAll("thead th")].map((cell) => cell.textContent).slice(0, 2), ["车型组", "套餐"]);
  assert.equal((screen.getByLabelText("舒适五座 · 10 小时 的套餐价") as HTMLInputElement).value, "55,000");
  assert.equal((screen.getByLabelText("商务七座 · 10 小时 的套餐价") as HTMLInputElement).value, "60,000");
  // 两张表：富士山 × 舒适五座填了，商务七座没填 → 各 1 格没填，空格提示「空 = 不报价」
  assert.match(within(itinerary).getByRole("heading", { level: 3 }).textContent ?? "", /1 格没填/);
  assert.match(within(updown).getByRole("heading", { level: 3 }).textContent ?? "", /1 格没填/);
  assert.equal((within(itinerary).getByLabelText("行程加价 · 富士山 · 舒适五座 的行程加价") as HTMLInputElement).value, "10,000");
  assert.equal((within(itinerary).getByLabelText("行程加价 · 富士山 · 商务七座 的行程加价") as HTMLInputElement).placeholder, LAYER_TEXT.emptyCell);
  assert.equal((within(updown).getByLabelText("上下车加价 · 富士山 · 商务七座 的上车加价") as HTMLInputElement).placeholder, LAYER_TEXT.emptyCell);
  assert.equal((within(updown).getByLabelText("上下车加价 · 富士山 · 舒适五座 的下车加价") as HTMLInputElement).value, "10,000");
  assert.doesNotMatch(updown.textContent ?? "", /途经加价（JPY）/, "迁移过的商品不再有途经加价列");
  assert.match(within(itinerary).getByRole("table").textContent ?? "", /所有套餐/);
  // 旧的按区域套餐价：折叠、只读（没有输入框、没有按钮）
  const legacy = document.querySelector("[data-legacy-packages]") as HTMLDetailsElement;
  assert.equal(legacy.open, false);
  assert.equal(legacy.querySelector("summary")?.textContent, `${LAYER_TEXT.legacyTitle}（1 条）`);
  assert.match(legacy.textContent ?? "", /东京 23 区舒适五座10 小时300JPY 65,000/);
  assert.equal(legacy.querySelectorAll("input, button, select").length, 0);
  // 迁移差异 0 条：不显示；分块导航写三张表
  assertAbsent(document.querySelector("[data-migration-diff]"));
  assert.ok(calls.some((call) => call.path === `${BASE}/charter-migration-diff`));
  assert.match(screen.getByRole("navigation", { name: "本页的分块" }).textContent ?? "", /套餐价·行程加价（1 个区域）·上下车加价（1 个区域）/);
  assert.doesNotMatch(document.body.textContent ?? "", /对外价|加价比例|markup|sell_price/i);
});

test("没迁移过的包车照旧：基础定价 + 区域加价（有途经加价列），没有行程加价、上下车加价表，也不取迁移差异", async () => {
  const old = [{ ...wholePackage("p1", COMFORT, 10), area_id: TOKYO }, updownRule({ package_hours: 10 })];
  const calls = open(pricesOf(old, { charter_layout: null }));
  await screen.findByRole("heading", { level: 3, name: /^区域加价/ });
  assert.ok(screen.getByRole("heading", { level: 3, name: "基础定价" }));
  assertAbsent(screen.queryByRole("heading", { level: 3, name: /^行程加价/ }));
  assertAbsent(screen.queryByRole("heading", { level: 3, name: /^上下车加价/ }));
  assertAbsent(document.querySelector("[data-legacy-packages]"));
  assert.ok(screen.getByLabelText("东京 23 区 · 舒适五座 · 10 小时 的套餐价"));
  assert.match(document.querySelector(".surcharge-table")?.textContent ?? "", /途经加价（JPY）/);
  assert.ok(!calls.some((call) => call.path.includes("charter-migration-diff")));
});

test("整商品套餐价：空着的组合填上 → 提交的 area_id 是 null；旧的按区域套餐价不提交", async () => {
  const actor = user();
  const calls = open(pricesOf([wholePackage("w1", COMFORT, 10), legacyPackage()]), (call) => (call.method === "POST" && call.url.pathname === `${BASE}/price-rules/batch` ? savedAs([wholePackage("w1", COMFORT, 10), wholePackage("w2", BUSINESS, 10), legacyPackage()]) : null));
  await table(LAYER_TEXT.itineraryTitle);
  for (const [field, value] of [["套餐公里", "300"], ["套餐价", "60000"], ["超时每小时", "5000"], ["超公里每公里", "300"]] as const) await actor.type(screen.getByLabelText(`商务七座 · 10 小时 的${field}`), value);
  await save(actor);
  await waitFor(() => assert.equal(writes(calls).length, 1));
  const batch = batchOf(writes(calls)[0]);
  assert.deepEqual([batch.create.length, batch.update, batch.delete], [1, [], []]);
  assert.deepEqual([batch.create[0]?.["area_id"], batch.create[0]?.["vehicle_group_id"], batch.create[0]?.["package_hours"], batch.create[0]?.["package_price"], batch.create[0]?.["pricing_model"]], [null, BUSINESS, 10, 60000, "charter_package"]);
});

test("区域下拉：上下车加价里基础价区域灰掉并写明；行程加价里基础价区域能选 → 按车型组填一个金额，不分套餐", async () => {
  const actor = user();
  const calls = open(pricesOf(RULES), (call) => (call.method === "POST" && call.url.pathname === `${BASE}/price-rules/batch` ? savedAs(RULES) : null));
  const updown = await table(LAYER_TEXT.updownTitle);
  const itinerary = await table(LAYER_TEXT.itineraryTitle);
  const updownSelect = within(updown).getByLabelText("选择要设上下车加价的区域") as HTMLSelectElement;
  await waitFor(() => assert.ok(updownSelect.options.length > 1));
  assert.deepEqual([...updownSelect.options].map((option) => [option.textContent, option.disabled]), [["选择区域", false], [`东京 23 区（${LAYER_TEXT.baseAreaOption}）`, true], ["富士山（已添加）", true], ["千叶", false]]);
  const itinerarySelect = within(itinerary).getByLabelText("选择要设行程加价的区域") as HTMLSelectElement;
  assert.deepEqual([...itinerarySelect.options].map((option) => [option.textContent, option.disabled]), [["选择区域", false], ["东京 23 区", false], ["富士山（已添加）", true], ["千叶", false]]);
  await actor.selectOptions(itinerarySelect, TOKYO);
  await actor.click(within(itinerary).getByRole("button", { name: "确认添加" }));
  const cell = await within(itinerary).findByLabelText("行程加价 · 东京 23 区 · 舒适五座 的行程加价");
  assert.match(within(itinerary).getByRole("heading", { level: 3 }).textContent ?? "", /3 格没填/);
  await actor.type(cell, "0");
  await actor.tab();
  assert.match(within(itinerary).getByRole("heading", { level: 3 }).textContent ?? "", /2 格没填/);
  assert.match(summary(), /有 1 条未保存的修改/);
  await save(actor);
  await waitFor(() => assert.equal(writes(calls).length, 1));
  const batch = batchOf(writes(calls)[0]);
  assert.deepEqual(batch.create.map((entry) => [entry["area_id"], entry["vehicle_group_id"], entry["pricing_model"], entry["itinerary_surcharge"], entry["package_hours"], entry["valid_from"]]), [[TOKYO, COMFORT, "charter_itinerary_surcharge", 0, null, TODAY]]);
  assert.ok(!("waypoint_surcharge" in (batch.create[0] ?? {})));
});

test("基础价区域上的上下车加价：标红、写明原因、可以「删除这一行」；不算未保存，批量保存不提交它，其余行照常保存；删除时才提交删除", async () => {
  const actor = user();
  const onBase = updownRule({ id: ON_BASE_ID, area_id: TOKYO, waypoint_surcharge: null });
  const items = [...RULES, onBase];
  const calls = open(pricesOf(items), (call) => (call.method === "POST" && call.url.pathname === `${BASE}/price-rules/batch` ? savedAs(items) : null));
  const updown = await table(LAYER_TEXT.updownTitle);
  const red = updown.querySelector("[data-base-area]") as HTMLElement;
  assert.match(red.className, /price-table__row--error/);
  assert.match(red.textContent ?? "", new RegExp(LAYER_TEXT.baseAreaRow));
  assert.equal(red.querySelectorAll("input").length, 0, "标红的行不能改金额");
  assert.match(within(updown).getByRole("heading", { level: 3 }).textContent ?? "", /1 格没填/, "基础价区域不算没填的格");
  assert.doesNotMatch(summary(), /未保存/);
  // 改富士山的一格：只算 1 条未保存；保存只提交这一条，标红的那条不提交
  const cell = within(updown).getByLabelText("上下车加价 · 富士山 · 舒适五座 的上车加价");
  await actor.clear(cell);
  await actor.type(cell, "12000");
  await actor.tab();
  assert.match(summary(), /有 1 条未保存的修改/);
  await save(actor);
  await waitFor(() => assert.equal(writes(calls).length, 1));
  const first = batchOf(writes(calls)[0]);
  assert.deepEqual([first.create, first.delete, first.update.map((entry) => [entry["id"], entry["pickup_surcharge"], entry["dropoff_surcharge"], entry["package_hours"]])], [[], [], [[UPDOWN_ID, 12000, 10000, null]]]);
  assert.ok(!("waypoint_surcharge" in (first.update[0] ?? {})), "迁移前的途经加价不带（后端沿用原值）");
  assert.doesNotMatch(JSON.stringify(first), new RegExp(ON_BASE_ID));
  // 删除这一行：标将删除，算 1 条修改；保存时是 delete
  await waitFor(() => assert.doesNotMatch(summary(), /未保存/));
  await actor.click(within(updown).getByRole("button", { name: `${LAYER_TEXT.deleteRow}：上下车加价 · 东京 23 区 · 舒适五座` }));
  assert.match(summary(), /有 1 条未保存的修改/);
  await save(actor);
  await waitFor(() => assert.equal(writes(calls).length, 2));
  const second = batchOf(writes(calls)[1]);
  assert.deepEqual([second.create, second.update, second.delete], [[], [], [ON_BASE_ID]]);
});

test("保存被拒：上下车加价的区域重叠（AREA_LAYER_OVERLAP）→ 写出两个区域名和重叠面积，显示在上下车加价表里和页面顶部", async () => {
  const actor = user();
  const overlap = { code: "AREA_LAYER_OVERLAP", layer: "pickup_dropoff", areas: ["千叶", "富士山"], area_ids: [CHIBA, FUJI], overlap_km2: 3.25 };
  const calls = open(pricesOf(RULES), (call) => (call.method === "POST" && call.url.pathname === `${BASE}/price-rules/batch` ? apiError(400, "AREA_LAYER_OVERLAP", "overlap", { ...overlap, overlaps: [overlap] }) : null));
  const updown = await table(LAYER_TEXT.updownTitle);
  await actor.selectOptions(within(updown).getByLabelText("选择要设上下车加价的区域"), CHIBA);
  await actor.click(within(updown).getByRole("button", { name: "确认添加" }));
  await actor.type(await within(updown).findByLabelText("上下车加价 · 千叶 · 舒适五座 的上车加价"), "3000");
  await actor.type(within(updown).getByLabelText("上下车加价 · 千叶 · 舒适五座 的下车加价"), "3000");
  await save(actor);
  await waitFor(() => assert.equal(writes(calls).length, 1));
  const sentence = "「千叶」和「富士山」重叠约 3.25 平方公里";
  await waitFor(() => assert.match(updown.textContent ?? "", new RegExp(sentence)));
  assert.match((document.getElementById("price-rejection") as HTMLElement).textContent ?? "", new RegExp(`没有保存。.*${sentence}`));
  assert.match((document.getElementById(`layer-area-charter_area_surcharge-${CHIBA}`) as HTMLElement).textContent ?? "", /和别的区域重叠/);
  const itinerary = await table(LAYER_TEXT.itineraryTitle);
  assert.doesNotMatch(itinerary.textContent ?? "", /平方公里/, "只显示在出问题的那张表");
  assert.equal((within(updown).getByLabelText("上下车加价 · 千叶 · 舒适五座 的上车加价") as HTMLInputElement).value, "3,000", "被拒以后填的还在");
});

test("迁移差异 N 条：按当前后台取接口，点开看逐条明细（区域、车型组、套餐、旧值、整商品值）", async () => {
  const actor = user();
  const terms = (price: number) => ({ package_price: price, package_km: 300, overtime_per_hour: 5000, over_km_per_km: 300, valid_to: null, status: "enabled" as const });
  const diff: CharterMigrationDiff = {
    charter_layout: "three_layer",
    items: [
      { old_price_rule_id: LEGACY_ID, area_id: TOKYO, vehicle_group_id: COMFORT, package_hours: 10, valid_from: "2026-11-01", old: terms(65000), product_price_rule_id: "w1", product: terms(55000) },
      { old_price_rule_id: "legacy-2", area_id: TOKYO, vehicle_group_id: BUSINESS, package_hours: 8, valid_from: "2026-11-01", old: terms(50000), product_price_rule_id: null, product: null },
    ],
  };
  const calls = open(pricesOf(RULES), () => null, diff);
  const banner = await waitFor(() => {
    const found = document.querySelector<HTMLElement>("[data-migration-diff]");
    assert.ok(found, "迁移差异还没显示");
    return found;
  });
  assert.match(banner.textContent ?? "", /迁移差异 2 条/);
  assert.ok(calls.some((call) => call.path === `/tenant/v1/products/${PRODUCT_ID}/charter-migration-diff`));
  const toggle = within(banner).getByRole("button", { name: "看明细" });
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assertAbsent(within(banner).queryByRole("table"));
  await actor.click(toggle);
  assert.equal(within(banner).getByRole("button", { name: "收起明细" }).getAttribute("aria-expanded"), "true");
  const rows = [...within(banner).getByRole("table").querySelectorAll("tbody tr")].map((row) => row.textContent ?? "");
  assert.equal(rows.length, 2);
  assert.match(rows[0] ?? "", /^东京 23 区舒适五座10 小时JPY 65,000 · 300 公里.*（2026-11-01 起）JPY 55,000 · 300 公里/);
  assert.match(rows[1] ?? "", /^东京 23 区商务七座8 小时JPY 50,000.*没有整商品套餐价$/);
  assert.deepEqual([...within(banner).getByRole("table").querySelectorAll("thead th")].map((cell) => cell.textContent), ["区域", "车型组", "套餐", "旧值", "整商品值"]);
});
