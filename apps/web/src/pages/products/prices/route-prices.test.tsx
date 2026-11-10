/**
 * 点对点「线路价」、返程价格、含公里数、复制的组件测试（tenant-prices.md 17.3、17.4、17.6、17.7，M8-12）。
 * 接口用测试替身；真实后端由端到端测试（e2e/route-prices.spec.ts）覆盖。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../../App.tsx";
import type { AreaSummary } from "../../../api/areas.ts";
import type { PriceRuleBody, PriceRules } from "../../../api/prices.ts";
import type { Product } from "../../../api/products.ts";
import { type ApiCall, apiError, json, resetBrowser, signIn, stubApiWith } from "../../../testing/harness.tsx";

afterEach(resetBrowser);

const stamps = { created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-02T03:04:00.000Z" };
const PRODUCT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const BASE = `/tenant/v1/products/${PRODUCT_ID}`;
const TODAY = "2026-11-10";
const TOKYO = "11111111-1111-4111-8111-111111111111";
const NARITA = "22222222-2222-4222-8222-222222222222";
const YOKOHAMA = "33333333-3333-4333-8333-333333333333";
const COMFORT = "66666666-6666-4666-8666-666666666666";
const BUSINESS = "77777777-7777-4777-8777-777777777777";
const ROUTE_ID = "88888888-8888-4888-8888-888888888888";

const city = { id: "c1", code: "CTY-JP-TYO", name: { zh: "东京" }, status: "active" as const, center: { lat: 35, lng: 139 }, boundary: null };
const areaOf = (id: string, name: string, overrides: Partial<AreaSummary> = {}): AreaSummary => ({ id, name: { zh: name }, city_id: "c1", city, biz_type: "general", role: "both", status: "active", operate_polygon_count: 1, forbid_polygon_count: 0, usage: { product_count: 1, published_product_count: 0 }, version: 1, ...stamps, ...overrides });
const AREAS: AreaSummary[] = [areaOf(TOKYO, "东京 23 区"), areaOf(NARITA, "成田周边", { role: "pricing" }), areaOf(YOKOHAMA, "横滨")];
const productArea = (id: string, name: string, priority: number) => ({ area_id: id, priority, name: { zh: name }, biz_type: "general", status: "active" });

const productOf = (areas = [productArea(TOKYO, "东京 23 区", 0), productArea(NARITA, "成田周边", 1), productArea(YOKOHAMA, "横滨", 2)]): Product =>
  ({
    id: PRODUCT_ID,
    code: "PRD202611100002",
    status: "draft",
    category: "point_to_point",
    title: { zh: "东京点对点" },
    brand_id: "b1",
    brand: { id: "b1", name: "NOZOMI", currency: "JPY", status: "active" },
    city_id: "c1",
    city: { id: "c1", code: "CTY-JP-TYO", name: { zh: "东京" }, country_code: "JP", timezone: "Asia/Tokyo", status: "active" },
    poi_id: null,
    poi: null,
    area_count: areas.length,
    vehicle_group_count: 2,
    version: 7,
    ...stamps,
    areas,
    vehicle_groups: [
      { vehicle_group_id: COMFORT, passengers: 4, luggage: 2, code: "VG-CMF-5", name: { zh: "舒适五座" }, grade: "comfort", seats: 5, sample_models: [], combos: [{ passengers: 4, luggage: 2 }], status: "active" },
      { vehicle_group_id: BUSINESS, passengers: 6, luggage: 4, code: "VG-BIZ-7", name: { zh: "商务七座" }, grade: "business", seats: 7, sample_models: [], combos: [{ passengers: 6, luggage: 4 }], status: "active" },
    ],
    dispatchers: [{ name: "山田", phone: "+81 90 1234 5678" }],
  }) as unknown as Product;

const EMPTY = { direction: null, package_hours: null, base_price: null, included_km: null, start_price: null, start_meters: null, start_minutes: null, per_km: null, per_minute: null, min_price: null, package_km: null, package_price: null, overtime_per_hour: null, over_km_per_km: null, pickup_surcharge: null, dropoff_surcharge: null, valid_to: null, status: "enabled" as const, ...stamps };
const areaPrice = (id: string, area: string, group: string): PriceRuleBody => ({ ...EMPTY, id, area_id: area, to_area_id: null, vehicle_group_id: group, pricing_model: "fixed", base_price: 9000, valid_from: "2026-11-01", base: "9000" });
const routePrice = (overrides: Partial<PriceRuleBody> = {}): PriceRuleBody => ({ ...EMPTY, id: ROUTE_ID, area_id: TOKYO, to_area_id: NARITA, vehicle_group_id: COMFORT, pricing_model: "fixed", base_price: 18000, included_km: 60, over_km_per_km: 250, valid_from: "2026-11-01", base: "18000", ...overrides });
const AREA_RULES = [TOKYO, NARITA, YOKOHAMA].flatMap((area, index) => [areaPrice(`a${index}c`, area, COMFORT), areaPrice(`a${index}b`, area, BUSINESS)]);
const pricesOf = (items: PriceRuleBody[], version = 7): PriceRules => ({ version, currency: "JPY", rounding_unit: 1, available_models: ["fixed"], surcharge_models: [], today: TODAY, items, coverage: { total: 6, priced: 6, missing: 0 } });

type Handler = (call: ApiCall & { url: URL }) => Response | Promise<Response> | null;
function open(role: string, prices: PriceRules, extra: Handler = () => null, product: Product = productOf(), areas: AreaSummary[] = AREAS): ApiCall[] {
  signIn("tenant", "tenant-token");
  const calls = stubApiWith((call) => {
    const custom = extra(call);
    if (custom !== null) return custom;
    if (call.method !== "GET") return null;
    const at = call.url.pathname;
    if (at === "/tenant/v1/auth/me") return json(200, { user: { id: "u1", email: "user@supplier.example", name: "测试用户", role, status: "active", ...stamps }, tenant: { id: "t1", name: "测试用供应商", status: "active", ...stamps }, permissions: [], must_change_password: false });
    if (at === BASE) return json(200, product);
    if (at === `${BASE}/publish-check`) return json(200, { can_publish: true, items: [] });
    if (at === `${BASE}/price-rules`) return json(200, prices);
    if (at === `${BASE}/adjust-rules`) return json(200, { version: 7, currency: "JPY", rounding_unit: 1, today: TODAY, items: [] });
    if (at === "/tenant/v1/areas") return json(200, { items: areas, next_cursor: null, total: areas.length });
    if (at === "/tenant/v1/brands") return json(200, { items: [{ id: "b1", name: "NOZOMI", currency: "JPY", status: "active", version: 4, ...stamps }] });
    if (at === "/tenant/v1/dashboard/summary") return json(200, { areas: { active: 3, disabled: 0 }, products: { draft: 1, published: 0, unpublished: 0 } });
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
const block = async (): Promise<HTMLElement> => (await screen.findByRole("heading", { level: 3, name: "线路价" })).closest("section") as HTMLElement;
const assertNoRetailWords = (): void => assert.doesNotMatch(document.body.textContent ?? "", /对外价|加价比例|markup|sell_price|to_area_id|includedKm|overKmPerKm/i);
const pickRoute = async (actor: ReturnType<typeof user>, section: HTMLElement, from: string, to: string): Promise<HTMLElement> => {
  await actor.selectOptions(within(section).getByLabelText("上车区域"), from);
  await actor.selectOptions(within(section).getByLabelText("下车区域"), to);
  await actor.click(within(section).getByRole("button", { name: "确认添加" }));
  return screen.findByRole("dialog", { name: /^新增线路价：/ });
};

test("点对点价格页：线路价另成一块，按线路分组，不混进区域价的表；含公里数两列；下拉只列能挂价格的服务区域；规则 4", async () => {
  const actor = user();
  open("admin", pricesOf([...AREA_RULES, routePrice()]), () => null, productOf(), [...AREAS.slice(0, 2), areaOf(YOKOHAMA, "横滨", { role: "operating" })]);
  const section = await block();
  // 区域价的表没有线路价那一行
  const areaTable = document.getElementById("price-table") as HTMLElement;
  assert.equal(areaTable.querySelectorAll("tbody tr").length, 6);
  assert.doesNotMatch(areaTable.textContent ?? "", /→/);
  // 区域价的表多两列：含公里数、超出每公里
  const heads = within(areaTable).getAllByRole("columnheader").map((cell) => cell.textContent);
  assert.ok(heads.includes("含公里数（公里）") && heads.includes("超出每公里（JPY / 公里）"), heads.join("|"));
  // 线路价表：组标题「东京 23 区 → 成田周边」、返程没有 + 建返程、复制
  const table = within(section).getByRole("table", { name: /线路价/ });
  const group = document.getElementById(`route-${TOKYO}>${NARITA}`) as HTMLElement;
  assert.match(group.textContent ?? "", /东京 23 区 → 成田周边返程：没有建返程复制/);
  assert.equal((within(table).getByLabelText("东京 23 区 → 成田周边 · 舒适五座 的含公里数") as HTMLInputElement).value, "60");
  assert.equal((within(table).getByLabelText("东京 23 区 → 成田周边 · 舒适五座 的超出每公里") as HTMLInputElement).value, "250");
  // 读回：方向、含公里数（不足 1 公里按 1 公里）、例子用 domain 的函数算、拿不到路线不报价、反方向用区域价
  await actor.click(within(table).getByLabelText("东京 23 区 → 成田周边 · 舒适五座 的基础价"));
  const meaning = section.querySelector(".price-meaning") as HTMLElement;
  assert.match(meaning.textContent ?? "", /只管在东京 23 区上车、在成田周边下车的单，反方向不算。每单 JPY 18,000，含 60 公里，超出每公里 JPY 250（不足 1 公里按 1 公里）。/);
  assert.match(meaning.textContent ?? "", /例：路线 64\.2 公里 = JPY 18,000 \+ 5 公里 × JPY 250 = JPY 19,250。/);
  assert.match(meaning.textContent ?? "", /这条线路有了线路价，就不再用区域价，即使区域价更低。/);
  assert.match(meaning.textContent ?? "", /拿不到路线距离时（地图服务暂时不可用），这条价格不报价/);
  assert.match(meaning.textContent ?? "", /反方向（成田周边 → 东京 23 区）还没有线路价，用的是区域价。/);
  // 上车区域下拉：横滨在区域页面是运营区域（不带价格），不列
  const from = within(section).getByLabelText("上车区域") as HTMLSelectElement;
  await waitFor(() => assert.deepEqual([...from.options].map((option) => option.textContent), ["选择区域", "东京 23 区", "成田周边"]));
  await actor.selectOptions(from, TOKYO);
  const to = within(section).getByLabelText("下车区域") as HTMLSelectElement;
  assert.deepEqual([...to.options].map((option) => [option.textContent, option.disabled]), [["选择区域", false], ["东京 23 区（同一个区域用区域价）", true], ["成田周边", false]]);
  assert.ok(within(section).getByRole("link", { name: /^新增自定义区域\s*（在新标签页打开）$/ }));
  assert.ok(within(section).getByRole("button", { name: "在地图上查看" }));
  assertNoRetailWords();
});

test("新增线路价带返程价格：一次批量保存里两条 create（去程 A→B、返程 B→A），车型组、含公里数、日期一样", async () => {
  const actor = user();
  const calls = open("admin", pricesOf(AREA_RULES), (call) => (call.method === "POST" && call.url.pathname === `${BASE}/price-rules/batch` ? json(200, { ...pricesOf([...AREA_RULES, routePrice()], 8), created_ids: [] }) : null));
  const section = await block();
  assert.match(section.textContent ?? "", /还没有线路价，每条线路都用上面的区域价。/);
  // 没选全
  await actor.click(within(section).getByRole("button", { name: "确认添加" }));
  assert.match(section.textContent ?? "", /请选上车区域和下车区域/);
  const dialog = await pickRoute(actor, section, TOKYO, NARITA);
  assert.match(within(dialog).getByRole("heading").textContent ?? "", /东京 23 区 → 成田周边/);
  await actor.click(within(dialog).getByRole("checkbox", { name: "商务七座" }));
  await actor.type(within(dialog).getByLabelText(/^价格/), "18000");
  await actor.type(within(dialog).getByLabelText(/^返程价格（成田周边 → 东京 23 区）/), "17000");
  await actor.type(within(dialog).getByLabelText(/^含公里数/), "30");
  await actor.type(within(dialog).getByLabelText(/^超出每公里/), "300");
  assert.equal(within(dialog).getByRole("status").textContent, "会建 1 条线路价，返程 1 条，共 2 条。");
  await actor.click(within(dialog).getByRole("button", { name: "添加到表里" }));
  await waitFor(() => assert.equal(screen.queryByRole("dialog"), null));
  // 两组都在表里，焦点在去程的价格
  assert.ok(document.getElementById(`route-${TOKYO}>${NARITA}`));
  assert.ok(document.getElementById(`route-${NARITA}>${TOKYO}`));
  await waitFor(() => assert.equal(document.activeElement?.getAttribute("aria-label"), "东京 23 区 → 成田周边 · 舒适五座 的基础价"));
  await save(actor);
  await waitFor(() => assert.equal(writes(calls).length, 1));
  const batch = batchOf(writes(calls)[0]);
  assert.equal(batch.create.length, 2);
  const [out, back] = batch.create;
  assert.deepEqual([out?.["area_id"], out?.["to_area_id"], out?.["base_price"], out?.["included_km"], out?.["over_km_per_km"], out?.["vehicle_group_id"], out?.["valid_from"]], [TOKYO, NARITA, 18000, 30, 300, COMFORT, TODAY]);
  assert.deepEqual([back?.["area_id"], back?.["to_area_id"], back?.["base_price"], back?.["included_km"], back?.["over_km_per_km"], back?.["vehicle_group_id"], back?.["valid_from"]], [NARITA, TOKYO, 17000, 30, 300, COMFORT, TODAY]);
  assert.equal(batch.update.length + batch.delete.length, 0);
});

test("含公里数：两格要一起填，含公里数 1 到 2,000 的整数；对话框和表里同样的话，保存前拦下", async () => {
  const actor = user();
  const calls = open("admin", pricesOf([...AREA_RULES, routePrice()]));
  const section = await block();
  const dialog = await pickRoute(actor, section, NARITA, YOKOHAMA);
  await actor.type(within(dialog).getByLabelText(/^价格/), "9000");
  await actor.type(within(dialog).getByLabelText(/^含公里数/), "30");
  await actor.click(within(dialog).getByRole("button", { name: "添加到表里" }));
  assert.match(dialog.textContent ?? "", /含公里数和超出每公里要一起填，或者都不填/);
  await actor.clear(within(dialog).getByLabelText(/^含公里数/));
  await actor.type(within(dialog).getByLabelText(/^含公里数/), "2001");
  await actor.type(within(dialog).getByLabelText(/^超出每公里/), "100");
  assert.match(dialog.textContent ?? "", /含公里数请填 1 到 2,000 之间的整数/);
  await actor.click(within(dialog).getByRole("button", { name: "取消" }));
  // 表里：区域价只填了含公里数
  const cell = screen.getByLabelText("东京 23 区 · 舒适五座 的含公里数") as HTMLInputElement;
  await actor.type(cell, "12.5");
  await save(actor);
  await screen.findByText(/处需要修改/);
  assert.ok(screen.getByRole("button", { name: "东京 23 区 · 舒适五座：含公里数请填 1 到 2,000 之间的整数" }));
  assert.ok(screen.getByRole("button", { name: "东京 23 区 · 舒适五座：含公里数和超出每公里要一起填，或者都不填" }));
  assert.equal(writes(calls).length, 0);
});

test("复制成反方向（建返程）：默认选好反方向；按比例上调只调价格，含公里数原样；保存时下车区域对调", async () => {
  const actor = user();
  const calls = open("admin", pricesOf([...AREA_RULES, routePrice()]), (call) => (call.method === "POST" && call.url.pathname === `${BASE}/price-rules/batch` ? json(200, { ...pricesOf([...AREA_RULES, routePrice()], 8), created_ids: [] }) : null));
  await block();
  await actor.click(screen.getByRole("button", { name: "给「东京 23 区 → 成田周边」建返程" }));
  const dialog = await screen.findByRole("dialog", { name: "复制线路：东京 23 区 → 成田周边" });
  assert.equal((within(dialog).getByLabelText("上车区域") as HTMLSelectElement).value, NARITA);
  assert.equal((within(dialog).getByLabelText("下车区域") as HTMLSelectElement).value, TOKYO);
  assert.equal(within(dialog).getByRole("status").textContent, "会填 1 条。");
  // 复制回原线路：说清楚
  await actor.selectOptions(within(dialog).getByLabelText("上车区域"), TOKYO);
  await actor.selectOptions(within(dialog).getByLabelText("下车区域"), NARITA);
  assert.match(dialog.textContent ?? "", /要复制到另一条线路/);
  await actor.click(within(dialog).getByRole("button", { name: "换成反方向" }));
  await actor.click(within(dialog).getByRole("radio", { name: "复制时上调" }));
  await actor.type(within(dialog).getByLabelText("调整的百分比"), "10");
  await actor.click(within(dialog).getByRole("button", { name: "复制" }));
  await waitFor(() => assert.equal(screen.queryByRole("dialog"), null));
  assert.match((document.getElementById(`route-${TOKYO}>${NARITA}`) as HTMLElement).textContent ?? "", /返程：有/);
  await save(actor);
  await waitFor(() => assert.equal(writes(calls).length, 1));
  const created = batchOf(writes(calls)[0]).create;
  assert.equal(created.length, 1);
  assert.deepEqual([created[0]?.["area_id"], created[0]?.["to_area_id"], created[0]?.["base_price"], created[0]?.["included_km"], created[0]?.["over_km_per_km"]], [NARITA, TOKYO, 19800, 60, 250]);
});

test("改一条已有的线路价：update 带着下车区域和含公里数（不会被当成区域价）", async () => {
  const actor = user();
  const calls = open("admin", pricesOf([...AREA_RULES, routePrice()]), (call) => (call.method === "POST" && call.url.pathname === `${BASE}/price-rules/batch` ? json(200, { ...pricesOf([...AREA_RULES, routePrice({ base_price: 19000 })], 8), created_ids: [] }) : null));
  await block();
  const price = screen.getByLabelText("东京 23 区 → 成田周边 · 舒适五座 的基础价") as HTMLInputElement;
  await actor.clear(price);
  await actor.type(price, "19000");
  await save(actor);
  await waitFor(() => assert.equal(writes(calls).length, 1));
  const batch = batchOf(writes(calls)[0]);
  assert.equal(batch.create.length, 0);
  assert.deepEqual([batch.update[0]?.["id"], batch.update[0]?.["to_area_id"], batch.update[0]?.["base_price"], batch.update[0]?.["included_km"], batch.update[0]?.["over_km_per_km"]], [ROUTE_ID, NARITA, 19000, 60, 250]);
});

test("保存被拒：线路两端、含公里数的原因说清楚是哪一格；返程撞上已有的线路价（409）整批没保存，去程返程都列出来", async () => {
  const actor = user();
  let answer: (body: Batch) => Response = () => json(500, {});
  open("admin", pricesOf(AREA_RULES), (call) => (call.method === "POST" && call.url.pathname === `${BASE}/price-rules/batch` ? answer(call.body as Batch) : null));
  const section = await block();
  const dialog = await pickRoute(actor, section, TOKYO, NARITA);
  await actor.click(within(dialog).getByRole("checkbox", { name: "商务七座" }));
  await actor.type(within(dialog).getByLabelText(/^价格/), "18000");
  await actor.type(within(dialog).getByLabelText(/^返程价格/), "17000");
  await actor.type(within(dialog).getByLabelText(/^含公里数/), "30");
  await actor.type(within(dialog).getByLabelText(/^超出每公里/), "300");
  await actor.click(within(dialog).getByRole("button", { name: "添加到表里" }));
  await waitFor(() => assert.equal(screen.queryByRole("dialog"), null));
  const reasons: [string, string, RegExp][] = [
    ["to_area_id", "SAME_AREA", /东京 23 区 → 成田周边 · 舒适五座：上车区域和下车区域相同，同一个区域请用区域价。/],
    ["to_area_id", "AREA_NOT_IN_PRODUCT", /东京 23 区 → 成田周边 · 舒适五座：「成田周边」已经不在这个商品里，这条线路价保存不了。/],
    ["to_area_id", "AREA_ROLE_NOT_PRICING", /「成田周边」是运营区域，不能用来定价：运营区域只决定能不能接单，不带价格。/],
    ["included_km", "REQUIRED", /东京 23 区 → 成田周边 · 舒适五座：含公里数和超出每公里要一起填，或者都不填/],
    ["included_km", "OUT_OF_RANGE", /东京 23 区 → 成田周边 · 舒适五座：含公里数请填 1 到 2,000 之间的整数/],
    ["included_km", "NOT_APPLICABLE", /只有点对点的一口价能设含公里数。/],
    ["over_km_per_km", "REQUIRED", /含公里数和超出每公里要一起填，或者都不填/],
    ["over_km_per_km", "OUT_OF_RANGE", /超出每公里最多 JPY/],
    ["over_km_per_km", "NOT_APPLICABLE", /只有点对点的一口价能设超出每公里。/],
  ];
  for (const [field, reason, text] of reasons) {
    answer = (body) => apiError(400, "VALIDATION_FAILED", "invalid", { issues: [{ path: `/create/0/${field}`, reason, message: "后端的说明", detail: { ref: body.create[0]?.["ref"] } }] });
    await save(actor);
    await waitFor(() => assert.match(document.body.textContent ?? "", text, `${field} ${reason}`));
  }
  // 点出错的那条，焦点到那一格
  answer = (body) => apiError(400, "VALIDATION_FAILED", "invalid", { issues: [{ path: "/create/0/included_km", reason: "OUT_OF_RANGE", message: "后端的说明", detail: { ref: body.create[0]?.["ref"] } }] });
  await save(actor);
  await actor.click(await screen.findByRole("button", { name: "东京 23 区 → 成田周边 · 舒适五座：含公里数请填 1 到 2,000 之间的整数" }));
  assert.equal(document.activeElement?.getAttribute("aria-label"), "东京 23 区 → 成田周边 · 舒适五座 的含公里数");
  answer = (body) =>
    apiError(409, "PRICE_RULE_CONFLICT", "overlap", {
      conflicts: [
        { ref: body.create[0]?.["ref"], valid_from: TODAY, valid_to: null, with: [{ id: "someone-else-1", valid_from: "2026-11-01", valid_to: null }] },
        { ref: body.create[1]?.["ref"], valid_from: TODAY, valid_to: null, with: [{ id: "someone-else-2", valid_from: "2026-11-05", valid_to: "2026-12-31" }] },
      ],
    });
  await save(actor);
  await screen.findByText(/有 2 条价格的生效日期和已有的价格重叠，所以这一批都没有保存。/);
  assert.ok(screen.getByRole("button", { name: "东京 23 区 → 成田周边 · 舒适五座：2026-11-10 起一直有效 ↔ 2026-11-01 起一直有效（别人刚加的）" }));
  assert.ok(screen.getByRole("button", { name: "成田周边 → 东京 23 区 · 舒适五座：2026-11-10 起一直有效 ↔ 2026-11-05 至 2026-12-31（别人刚加的）" }));
  // 两组的行都还在，不用重填
  assert.ok(document.getElementById(`route-${TOKYO}>${NARITA}`));
  assert.ok(document.getElementById(`route-${NARITA}>${TOKYO}`));
  answer = () => apiError(404, "NOT_FOUND", "区域不存在");
  await save(actor);
  await screen.findByText(/有 \d+ 条价格用到的区域已经不在了（可能刚被删除）。请点「重新读取价格」后再保存。/);
});

test("商品只有一个服务区域：没有跨区域的线路，指到第 ① 步", async () => {
  open("admin", pricesOf([areaPrice("a0c", TOKYO, COMFORT), areaPrice("a0b", TOKYO, BUSINESS)]), () => null, productOf([productArea(TOKYO, "东京 23 区", 0)]));
  const section = await block();
  assert.match(section.textContent ?? "", /这个商品只有一个服务区域，没有跨区域的线路。要设线路价，先在第 ① 步多选一个服务区域。/);
  assert.ok(within(section).getByRole("link", { name: "去第 ① 步选" }));
  assert.equal(within(section).queryByLabelText("上车区域"), null);
});

test("只读角色看得到线路价、不能添加和复制", async () => {
  open("readonly", pricesOf([...AREA_RULES, routePrice()]));
  const readonly = await block();
  assert.equal(within(readonly).queryByLabelText("上车区域"), null);
  assert.equal(within(readonly).queryByRole("button", { name: /复制|建返程/ }), null);
  assert.match(readonly.textContent ?? "", /东京 23 区 → 成田周边/);
  assertNoRetailWords();
});
