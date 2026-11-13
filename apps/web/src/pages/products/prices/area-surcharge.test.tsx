/**
 * 包车「区域加价」块的组件测试（tenant-prices.md 17.2，M8-12a）：选区域、添加、编辑、删除（= 停用）和恢复、
 * 一次给所有车型组和套餐填、各种校验和被拒的文字、规则 4（不出现对外价、加价比例）、只读角色。
 * 接口用测试替身；真实后端由端到端测试（e2e/charter-surcharge.spec.ts）覆盖。
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
import { type ApiCall, apiError, assertFocused, json, resetBrowser, signIn, stubApiWith } from "../../../testing/harness.tsx";

afterEach(resetBrowser);

const stamps = { created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-02T03:04:00.000Z" };
const PRODUCT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const BASE = `/tenant/v1/products/${PRODUCT_ID}`;
const TODAY = "2026-11-10";
const TOKYO = "11111111-1111-4111-8111-111111111111";
const FUJI = "22222222-2222-4222-8222-222222222222";
const CHIBA = "33333333-3333-4333-8333-333333333333";
const OPERATING = "44444444-4444-4444-8444-444444444444";
const OFF = "55555555-5555-4555-8555-555555555555";
const COMFORT = "66666666-6666-4666-8666-666666666666";
const BUSINESS = "77777777-7777-4777-8777-777777777777";
const SURCHARGE_ID = "88888888-8888-4888-8888-888888888888";

const city = (id: string, name: string) => ({ id, code: `CTY-${id.slice(0, 3)}`, name: { zh: name }, status: "active" as const, center: { lat: 35, lng: 139 }, boundary: null });
const areaOf = (id: string, name: string, overrides: Partial<AreaSummary> = {}): AreaSummary => ({ id, name: { zh: name }, city_id: "c1", city: city("c1", "东京"), biz_type: "general", role: "both", status: "active", operate_polygon_count: 1, forbid_polygon_count: 0, usage: { product_count: 0, published_product_count: 0 }, version: 1, ...stamps, ...overrides });
const AREAS: AreaSummary[] = [
  areaOf(TOKYO, "东京 23 区"),
  areaOf(FUJI, "富士山", { city_id: "c2", city: city("c2", "山梨"), role: "pricing", biz_type: "charter" }),
  areaOf(CHIBA, "千叶"),
  areaOf(OPERATING, "关东运营范围", { role: "operating" }),
  areaOf(OFF, "已停用的区域", { status: "disabled" }),
];

const productOf = (overrides: Partial<Product> = {}): Product =>
  ({
    id: PRODUCT_ID,
    code: "PRD202611100001",
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
    ...overrides,
  }) as unknown as Product;

const EMPTY = { direction: null, base_price: null, start_price: null, start_meters: null, start_minutes: null, per_km: null, per_minute: null, min_price: null, package_km: null, package_price: null, overtime_per_hour: null, over_km_per_km: null, pickup_surcharge: null, dropoff_surcharge: null, valid_to: null, status: "enabled" as const, ...stamps };
const packagePrice = (id: string, group: string, hours: number): PriceRuleBody => ({ ...EMPTY, id, area_id: TOKYO, vehicle_group_id: group, package_hours: hours, pricing_model: "charter_package", package_km: 100, package_price: 60000, overtime_per_hour: 5000, over_km_per_km: 300, valid_from: "2026-11-01", base: "60000" });
const surcharge = (overrides: Partial<PriceRuleBody> = {}): PriceRuleBody => ({ ...EMPTY, id: SURCHARGE_ID, area_id: FUJI, vehicle_group_id: COMFORT, package_hours: 8, pricing_model: "charter_area_surcharge", pickup_surcharge: 1000, dropoff_surcharge: 1000, valid_from: "2026-11-01", base: "0", ...overrides });
const BASE_RULES = [packagePrice("p1", COMFORT, 8), packagePrice("p2", BUSINESS, 8), packagePrice("p3", COMFORT, 10), packagePrice("p4", BUSINESS, 10)];
const pricesOf = (items: PriceRuleBody[], version = 7): PriceRules => ({ version, currency: "JPY", rounding_unit: 1, available_models: ["charter_package"], surcharge_models: ["charter_area_surcharge"], today: TODAY, items, coverage: { total: 4, priced: 4, missing: 0 } });

type Route = (call: ApiCall & { url: URL }) => Response | Promise<Response> | null;
function open(role: string, prices: PriceRules, extra: Route = () => null, areas: AreaSummary[] = AREAS): ApiCall[] {
  signIn("tenant", "tenant-token");
  const calls = stubApiWith((call) => {
    const custom = extra(call);
    if (custom !== null) return custom;
    if (call.method !== "GET") return null;
    const at = call.url.pathname;
    if (at === "/tenant/v1/auth/me") return json(200, { user: { id: "u1", email: "user@supplier.example", name: "测试用户", role, status: "active", ...stamps }, tenant: { id: "t1", name: "测试用供应商", status: "active", ...stamps }, permissions: [], must_change_password: false });
    if (at === BASE) return json(200, productOf());
    if (at === `${BASE}/publish-check`) return json(200, { can_publish: true, items: [] });
    if (at === `${BASE}/price-rules`) return json(200, prices);
    if (at === `${BASE}/adjust-rules`) return json(200, { version: 7, currency: "JPY", rounding_unit: 1, today: TODAY, items: [] });
    if (at === "/tenant/v1/areas") return json(200, { items: areas, next_cursor: null, total: areas.length });
    if (at === "/tenant/v1/brands") return json(200, { items: [{ id: "b1", name: "NOZOMI", currency: "JPY", status: "active", version: 4, ...stamps }] });
    if (at === "/tenant/v1/dashboard/summary") return json(200, { areas: { active: 4, disabled: 1 }, products: { draft: 1, published: 0, unpublished: 0 } });
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
/** 「区域加价」块；等区域的名字也取回来 */
const block = async (): Promise<HTMLElement> => {
  const section = (await screen.findByRole("heading", { level: 3, name: /^区域加价/ })).closest("section") as HTMLElement;
  await waitFor(() => assert.doesNotMatch(section.textContent ?? "", /（区域）/));
  return section;
};
const assertNoRetailWords = (): void => assert.doesNotMatch(document.body.textContent ?? "", /对外价|加价比例|markup|sell_price|surcharge/i);
type Batch = { create: Record<string, unknown>[]; update: Record<string, unknown>[]; delete: string[] };
const batchOf = (call: ApiCall | undefined): Batch => call?.body as Batch;
const save = async (actor: ReturnType<typeof user>): Promise<void> => actor.click(screen.getByRole("button", { name: "保存草稿" }));

test("包车价格页：基础定价下面多「区域加价」；价格表不再把区域加价当普通行；商品的服务区域写 0；下拉只列能挂价格的启用区域；规则 4", async () => {
  open("admin", pricesOf([...BASE_RULES, surcharge()]));
  const section = await block();
  assert.ok(screen.getByRole("heading", { level: 3, name: "基础定价" }));
  assert.ok(screen.getByRole("navigation", { name: "本页的分块" }).textContent?.includes("区域加价（1 个区域）"));
  // 价格表只有基础定价的行
  const priceTable = document.getElementById("price-table") as HTMLElement;
  assert.doesNotMatch(priceTable.textContent ?? "", /富士山/);
  assert.equal(priceTable.querySelectorAll("tbody tr").length, 4);
  // 列表：商品服务区域 0 / 0，富士山 1,000 / 1,000，城市小字，3 个组合没填
  const table = within(section).getByRole("table", { name: /区域加价/ });
  const own = within(table).getByRole("rowheader", { name: "东京 23 区" }).closest("tr") as HTMLElement;
  assert.match(own.textContent ?? "", /00商品的服务区域，不加价/);
  const fuji = document.getElementById(`surcharge-area-${FUJI}`) as HTMLElement;
  assert.match(fuji.textContent ?? "", /富士山· 山梨/);
  assert.match(fuji.textContent ?? "", /3 个组合没填/);
  assert.equal(fuji.querySelectorAll(".surcharge-sum__value")[0]?.textContent, "1,000");
  assert.match(within(section).getByRole("heading", { level: 3 }).textContent ?? "", /3 个组合没填/);
  // 选择区域：商品的服务区域、已添加的列出但不能选；运营区域、停用的不列，另说一句被藏掉的运营区域
  const select = within(section).getByLabelText("选择要加价的区域") as HTMLSelectElement;
  await waitFor(() => assert.ok(select.options.length > 1));
  const options = [...select.options].map((option) => [option.textContent, option.disabled]);
  assert.deepEqual(options, [["选择区域", false], ["东京 23 区（商品的服务区域，不加价）", true], ["千叶", false], ["富士山（已添加）", true]]);
  assert.equal(select.querySelectorAll("optgroup").length, 2, "按城市分组，商品所在城市排第一组");
  assert.equal(select.querySelector("optgroup")?.getAttribute("label"), "东京");
  assert.match(section.textContent ?? "", /另有 1 个运营区域没有列出/);
  const link = within(section).getByRole("link", { name: /^新增自定义区域\s*（在新标签页打开）$/ });
  assert.equal(link.getAttribute("target"), "_blank");
  assert.match(link.getAttribute("href") ?? "", /^\/areas\/new\?.*role=pricing/);
  assert.ok(within(section).getByRole("button", { name: "在地图上查看" }));
  assertNoRetailWords();
});

test("添加：没选就点确认添加提示并把焦点放回下拉；选千叶 → 对话框（必填、至少一个车型组）→ 一次填 4 个组合 → 和价格表一起批量保存", async () => {
  const actor = user();
  const saved = { ...pricesOf([...BASE_RULES, surcharge()], 8), created_ids: [] };
  const calls = open("admin", pricesOf([...BASE_RULES, surcharge()]), (call) => (call.method === "POST" && call.url.pathname === `${BASE}/price-rules/batch` ? json(200, saved) : null));
  const section = await block();
  const select = within(section).getByLabelText("选择要加价的区域") as HTMLSelectElement;
  await waitFor(() => assert.ok(select.options.length > 1));
  await actor.click(within(section).getByRole("button", { name: "确认添加" }));
  await within(section).findByText("请先选一个区域");
  assertFocused(select);
  await actor.selectOptions(select, CHIBA);
  await actor.click(within(section).getByRole("button", { name: "确认添加" }));
  const dialog = await screen.findByRole("dialog", { name: "给「千叶」设区域加价" });
  assert.match(dialog.textContent ?? "", /会填 4 个组合。/);
  await actor.click(within(dialog).getByRole("button", { name: "添加" }));
  await within(dialog).findByText("请填上车加价，不加钱请填 0");
  assert.ok(within(dialog).getByText("请填下车加价，不加钱请填 0"));
  await actor.type(within(dialog).getByLabelText(/^上车加价/), "-500");
  await actor.click(within(dialog).getByRole("button", { name: "添加" }));
  await within(dialog).findByText("上车加价不能是负数");
  await actor.clear(within(dialog).getByLabelText(/^上车加价/));
  await actor.type(within(dialog).getByLabelText(/^上车加价/), "500");
  await actor.type(within(dialog).getByLabelText(/^下车加价/), "0");
  await actor.click(within(within(dialog).getByRole("group", { name: "用在哪些车型组" })).getByRole("checkbox", { name: "全部（2 个）" }));
  await actor.click(within(dialog).getByRole("button", { name: "添加" }));
  await within(dialog).findByText("至少选一个车型组");
  await actor.click(within(dialog).getByRole("checkbox", { name: "商务七座" }));
  assert.match(dialog.textContent ?? "", /会填 2 个组合。/);
  await actor.click(within(within(dialog).getByRole("group", { name: "用在哪些车型组" })).getByRole("checkbox", { name: "全部（2 个）" }));
  assert.match(dialog.textContent ?? "", /会填 4 个组合。/);
  await actor.click(within(dialog).getByRole("button", { name: "添加" }));
  await waitFor(() => assert.equal(screen.queryByRole("dialog"), null));
  const row = document.getElementById(`surcharge-area-${CHIBA}`) as HTMLElement;
  assert.match(row.textContent ?? "", /未保存/);
  assert.equal(row.querySelectorAll(".surcharge-sum__value")[0]?.textContent, "500");
  assert.ok(screen.getByText("有 4 条未保存的修改"));
  assert.equal(select.value, "", "添加后下拉清空");
  assert.equal([...select.options].find((option) => option.value === CHIBA)?.textContent, "千叶（已添加）");
  await save(actor);
  await waitFor(() => assert.equal(writes(calls).length, 1));
  const batch = batchOf(writes(calls)[0]);
  assert.deepEqual([batch.create.length, batch.update, batch.delete], [4, [], []]);
  for (const entry of batch.create) assert.deepEqual([entry["area_id"], entry["pricing_model"], entry["pickup_surcharge"], entry["dropoff_surcharge"], entry["valid_from"], entry["package_price"], typeof entry["ref"]], [CHIBA, "charter_area_surcharge", 500, 0, TODAY, null, "string"]);
  assert.deepEqual(batch.create.map((entry) => `${entry["vehicle_group_id"] === COMFORT ? "C" : "B"}${entry["package_hours"]}`).sort(), ["B10", "B8", "C10", "C8"]);
  assert.doesNotMatch(JSON.stringify(batch), /markup|sell/);
});

test("编辑：预先填好一样的数；改成新的数、已经填了的组合「改成这次填的」→ 改那一条 + 填空着的；展开后逐条改；明细里单条删除是真的删", async () => {
  const actor = user();
  const calls = open("admin", pricesOf([...BASE_RULES, surcharge()]), (call) => (call.method === "POST" && call.url.pathname === `${BASE}/price-rules/batch` ? json(200, { ...pricesOf([...BASE_RULES, surcharge()], 8), created_ids: [] }) : null));
  const section = await block();
  await actor.click(within(section).getByRole("button", { name: "编辑「富士山」的区域加价" }));
  const dialog = await screen.findByRole("dialog", { name: "改「富士山」的区域加价" });
  assert.equal((within(dialog).getByLabelText(/^上车加价/) as HTMLInputElement).value, "1,000");
  assert.match(dialog.textContent ?? "", /会填 3 个空着的组合，改 1 个已经填了的。/);
  await actor.click(within(dialog).getByRole("radio", { name: "跳过，只填空着的" }));
  assert.match(dialog.textContent ?? "", /会填 3 个空着的组合，改 0 个已经填了的。/);
  await actor.click(within(dialog).getByRole("radio", { name: "改成这次填的" }));
  await actor.clear(within(dialog).getByLabelText(/^上车加价/));
  await actor.type(within(dialog).getByLabelText(/^上车加价/), "1200");
  await actor.click(within(dialog).getByRole("button", { name: "填进去" }));
  await waitFor(() => assert.equal(screen.queryByRole("dialog"), null));
  // 展开着：逐条改一个组合
  const toggle = within(section).getByRole("button", { name: "收起「富士山」的各车型组和套餐" });
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  const cell = screen.getByLabelText("区域加价 · 富士山 · 商务七座 · 10 小时 的下车加价") as HTMLInputElement;
  await actor.clear(cell);
  await actor.type(cell, "800");
  await actor.tab();
  assert.match(document.querySelector(".surcharge .price-meaning")?.textContent ?? "", /上车点在富士山时加 JPY 1,200，下车点在富士山时加 JPY 800，途经景点在富士山的单（没设途经加价）不报价。/);
  await save(actor);
  await waitFor(() => assert.equal(writes(calls).length, 1));
  const batch = batchOf(writes(calls)[0]);
  assert.deepEqual(batch.update.map((entry) => [entry["id"], entry["pickup_surcharge"], entry["dropoff_surcharge"]]), [[SURCHARGE_ID, 1200, 1000]]);
  assert.deepEqual(batch.create.map((entry) => entry["dropoff_surcharge"]).sort(), [1000, 1000, 800]);

  // 单条删除：标将删除，保存时是 delete
  const single = screen.getByRole("button", { name: "删除这一条：区域加价 · 富士山 · 舒适五座 · 8 小时" });
  await actor.click(single);
  assert.ok(screen.getByRole("button", { name: "撤销删除这一条：区域加价 · 富士山 · 舒适五座 · 8 小时" }));
});

test("删除加价区域 = 停用：页面内确认（写明停用、可恢复、客人看到什么）→ 将删除 + 撤销 → 保存时改成不启用、不发删除；保存后在「已删除的加价区域」里能恢复", async () => {
  const actor = user();
  const disabled = pricesOf([...BASE_RULES, surcharge({ status: "disabled" })], 8);
  const calls = open("admin", pricesOf([...BASE_RULES, surcharge()]), (call) => (call.method === "POST" && call.url.pathname === `${BASE}/price-rules/batch` ? json(200, { ...disabled, created_ids: [] }) : null));
  const section = await block();
  await actor.click(within(section).getByRole("button", { name: "删除加价区域「富士山」" }));
  const confirm = await screen.findByRole("dialog", { name: "删除加价区域「富士山」？" });
  assert.match(confirm.textContent ?? "", /这个区域的 1 条区域加价会停用，记录保留，以后可以在「已删除的加价区域」里恢复。/);
  assert.match(confirm.textContent ?? "", /客人会看到「这个地址暂时没有在线报价，请联系客服」/);
  await actor.click(within(confirm).getByRole("button", { name: "取消" }));
  assert.equal(writes(calls).length, 0);
  await actor.click(within(section).getByRole("button", { name: "删除加价区域「富士山」" }));
  await actor.click(within(await screen.findByRole("dialog", { name: "删除加价区域「富士山」？" })).getByRole("button", { name: "删除" }));
  const row = document.getElementById(`surcharge-area-${FUJI}`) as HTMLElement;
  assert.match(row.textContent ?? "", /将删除/);
  await actor.click(within(row).getByRole("button", { name: "撤销删除「富士山」" }));
  assert.doesNotMatch(row.textContent ?? "", /将删除/);
  await actor.click(within(section).getByRole("button", { name: "删除加价区域「富士山」" }));
  await actor.click(within(await screen.findByRole("dialog", { name: "删除加价区域「富士山」？" })).getByRole("button", { name: "删除" }));
  await save(actor);
  await waitFor(() => assert.equal(writes(calls).length, 1));
  const batch = batchOf(writes(calls)[0]);
  assert.deepEqual([batch.create, batch.delete, batch.update.map((entry) => [entry["id"], entry["status"], entry["pickup_surcharge"]])], [[], [], [[SURCHARGE_ID, "disabled", 1000]]]);
  // 保存后：富士山不在列表里，在「已删除的加价区域」里；下拉里可以选（会恢复）
  await waitFor(() => assert.equal(document.getElementById(`surcharge-area-${FUJI}`), null));
  const deleted = within(section).getByText("已删除的加价区域（1）").closest("details") as HTMLElement;
  assert.match(deleted.textContent ?? "", /删除前：上车加价 1,000 · 下车加价 1,000 · 途经加价 没设（JPY）/);
  const select = within(section).getByLabelText("选择要加价的区域") as HTMLSelectElement;
  assert.equal([...select.options].find((option) => option.value === FUJI)?.textContent, "富士山（已删除，选了会恢复原来的加价）");
  await actor.click(within(deleted).getByRole("button", { name: "恢复加价区域「富士山」" }));
  const restored = document.getElementById(`surcharge-area-${FUJI}`) as HTMLElement;
  assert.match(restored.textContent ?? "", /将恢复/);
  assert.ok(screen.getByText("有 1 条未保存的修改"));
});

test("还没有加价区域：信息提示条说清后果；没有可选的区域时下拉禁用并说先去画；还没有套餐时整块换成一句", async () => {
  open("admin", pricesOf(BASE_RULES), () => null, [AREAS[0] as AreaSummary]);
  const section = await block();
  assert.match(section.textContent ?? "", /包车现在要看下车地点。.*东京 23 区.*这个商品还没有加价区域，所以下车地点在服务区域以外的包车单现在都不报价。/);
  const select = within(section).getByLabelText("选择要加价的区域") as HTMLSelectElement;
  await waitFor(() => assert.ok(select.disabled));
  assert.match(section.textContent ?? "", /没有其他区域可选。先到区域页面画出要加价的区域/);
  resetBrowser();
  open("admin", pricesOf([]));
  const empty = await block();
  assert.match(empty.textContent ?? "", /先在上面「基础定价」里加一个套餐，再设区域加价。/);
});

test("保存被拒：区域的四种 400 原因写成怎么办；别人的 / 已删除的区域 404；日期重叠 409 指回那一行（先展开区域）", async () => {
  const actor = user();
  const reasons: [string, RegExp][] = [
    ["AREA_IS_PRODUCT_AREA", /「千叶」是商品的服务区域，上车、下车在那里都不加价/],
    ["AREA_NOT_USABLE", /「千叶」的业务类型不是包车或通用，不能做包车的加价区域/],
    ["AREA_DISABLED", /「千叶」已经停用，不能新加区域加价。请先到区域页面启用它/],
    ["AREA_ROLE_NOT_PRICING", /「千叶」是运营区域，不能做加价区域：运营区域只决定能不能接单，不带价格。请换一个报价区域/],
  ];
  let answer: (body: Batch) => Response = () => json(500, {});
  const calls = open("admin", pricesOf([...BASE_RULES, surcharge()]), (call) => (call.method === "POST" && call.url.pathname === `${BASE}/price-rules/batch` ? answer(call.body as Batch) : null));
  const section = await block();
  const select = within(section).getByLabelText("选择要加价的区域") as HTMLSelectElement;
  await waitFor(() => assert.ok(select.options.length > 1));
  await actor.selectOptions(select, CHIBA);
  await actor.click(within(section).getByRole("button", { name: "确认添加" }));
  const dialog = await screen.findByRole("dialog", { name: "给「千叶」设区域加价" });
  await actor.type(within(dialog).getByLabelText(/^上车加价/), "500");
  await actor.type(within(dialog).getByLabelText(/^下车加价/), "500");
  await actor.click(within(dialog).getByRole("button", { name: "添加" }));
  await waitFor(() => assert.equal(screen.queryByRole("dialog"), null));
  for (const [reason, text] of reasons) {
    answer = (body) => apiError(400, "VALIDATION_FAILED", "invalid", { issues: [{ path: "/create/0/area_id", reason, message: "后端的说明", detail: { ref: body.create[0]?.["ref"] } }] });
    await save(actor);
    await waitFor(() => assert.match(document.body.textContent ?? "", text, reason));
  }
  answer = () => apiError(404, "NOT_FOUND", "区域不存在");
  await save(actor);
  await screen.findByText(/有 1 条价格用到的区域已经不在了（可能刚被删除）。请点「重新读取价格」后再保存。/);
  assert.ok(screen.getByRole("button", { name: "重新读取价格" }));
  answer = (body) => apiError(409, "PRICE_RULE_CONFLICT", "overlap", { conflicts: [{ ref: body.create[0]?.["ref"], valid_from: TODAY, valid_to: null, with: [{ id: "someone-else", valid_from: "2026-11-01", valid_to: null }] }] });
  await save(actor);
  await screen.findByText(/有 1 条价格的生效日期和已有的价格重叠，所以这一批都没有保存。/);
  const pointer = screen.getByRole("button", { name: /^区域加价 · 千叶 · .* 小时：2026-11-10 起一直有效 ↔ 2026-11-01 起一直有效（别人刚加的）$/ });
  await actor.click(pointer);
  assert.match(document.activeElement?.getAttribute("aria-label") ?? "", /^区域加价 · 千叶 · .* 的生效日期从$/);
  assert.ok(writes(calls).length >= 6);
});

test("页面上填错：负数、空着一个金额、日期写错，保存前拦下并指到那一格", async () => {
  const actor = user();
  const calls = open("admin", pricesOf([...BASE_RULES, surcharge()]));
  const section = await block();
  await actor.click(within(section).getByRole("button", { name: "展开「富士山」的各车型组和套餐" }));
  const cell = screen.getByLabelText("区域加价 · 富士山 · 舒适五座 · 8 小时 的上车加价") as HTMLInputElement;
  await actor.clear(cell);
  await actor.type(cell, "-1");
  const blank = screen.getByLabelText("区域加价 · 富士山 · 商务七座 · 8 小时 的上车加价") as HTMLInputElement;
  await actor.type(blank, "300");
  await save(actor);
  await screen.findByText("有 2 处需要修改");
  assert.ok(screen.getByRole("button", { name: "区域加价 · 富士山 · 舒适五座 · 8 小时：上车加价不能是负数" }));
  assert.ok(screen.getByRole("button", { name: "区域加价 · 富士山 · 商务七座 · 8 小时：请填下车加价，不加钱请填 0" }));
  assert.equal(writes(calls).length, 0);
});

test("只读角色：看得到区域加价，没有选择区域、编辑、删除，明细是文字", async () => {
  const actor = user();
  open("readonly", pricesOf([...BASE_RULES, surcharge()]));
  const section = await block();
  assert.equal(within(section).queryByLabelText("选择要加价的区域"), null);
  assert.equal(within(section).queryByRole("button", { name: /编辑|删除/ }), null);
  assert.equal(within(section).queryByRole("link", { name: /新增自定义区域/ }), null);
  await actor.click(within(section).getByRole("button", { name: "展开「富士山」的各车型组和套餐" }));
  assert.equal(within(section).queryByLabelText(/的上车加价$/), null);
  assert.match(section.textContent ?? "", /1,000/);
  assertNoRetailWords();
});

test("别人先改了（409）→「载入最新内容，保留我的修改」按格子合：我只改了上车加价，别人改的下车加价不被我的旧值盖回；同一格两人都改了的标出来请核对", async () => {
  const actor = user();
  let latest = pricesOf([...BASE_RULES, surcharge(), surcharge({ id: "s2", vehicle_group_id: BUSINESS })]);
  let answer: Response = apiError(409, "VERSION_CONFLICT", "stale");
  const calls = open("admin", pricesOf([...BASE_RULES, surcharge(), surcharge({ id: "s2", vehicle_group_id: BUSINESS })]), (call) => {
    if (call.method === "POST" && call.url.pathname === `${BASE}/price-rules/batch`) return answer;
    if (call.method === "GET" && call.url.pathname === `${BASE}/price-rules`) return json(200, latest);
    return null;
  });
  const section = await block();
  await actor.click(within(section).getByRole("button", { name: "展开「富士山」的各车型组和套餐" }));
  const mine = screen.getByLabelText("区域加价 · 富士山 · 舒适五座 · 8 小时 的上车加价") as HTMLInputElement;
  await actor.clear(mine);
  await actor.type(mine, "1200");
  const both = screen.getByLabelText("区域加价 · 富士山 · 商务七座 · 8 小时 的上车加价") as HTMLInputElement;
  await actor.clear(both);
  await actor.type(both, "1300");
  await actor.tab();
  // 别人同时：舒适五座改了下车加价；商务七座改了上车加价（和我改的是同一格）
  latest = pricesOf([...BASE_RULES, surcharge({ dropoff_surcharge: 2000 }), surcharge({ id: "s2", vehicle_group_id: BUSINESS, pickup_surcharge: 1500 })], 8);
  await save(actor);
  await actor.click(await screen.findByRole("button", { name: "载入最新内容，保留我的修改" }));
  await waitFor(() => assert.equal((screen.getByLabelText("区域加价 · 富士山 · 舒适五座 · 8 小时 的下车加价") as HTMLInputElement).value, "2,000"));
  assert.equal((screen.getByLabelText("区域加价 · 富士山 · 舒适五座 · 8 小时 的上车加价") as HTMLInputElement).value, "1,200");
  assert.equal((screen.getByLabelText("区域加价 · 富士山 · 商务七座 · 8 小时 的上车加价") as HTMLInputElement).value, "1,300");
  assert.match(section.textContent ?? "", /有 1 条区域加价别人也改过同一项。/);
  const flagged = document.getElementById("surcharge-row-s2") as HTMLElement;
  assert.match(flagged.textContent ?? "", /别人也改过这一条，请核对/);
  assert.doesNotMatch((document.getElementById(`surcharge-row-${SURCHARGE_ID}`) as HTMLElement).textContent ?? "", /请核对/);
  answer = json(200, { ...pricesOf([...BASE_RULES, surcharge({ pickup_surcharge: 1200, dropoff_surcharge: 2000 }), surcharge({ id: "s2", vehicle_group_id: BUSINESS, pickup_surcharge: 1300 })], 9), created_ids: [] });
  await save(actor);
  await waitFor(() => assert.equal(writes(calls).length, 2));
  const batch = batchOf(writes(calls)[1]);
  assert.deepEqual(batch.update.map((entry) => [entry["id"], entry["pickup_surcharge"], entry["dropoff_surcharge"]]).sort(), [["s2", 1300, 1000], [SURCHARGE_ID, 1200, 2000]].sort());
});

test("途经加价（M9W-01）：列表多「途经加价」一列（没设写「没设」）；批量设置弹窗可填途经加价（选填）→ 保存时带 waypoint_surcharge；这一行的意思说清途经规则", async () => {
  const actor = user();
  const rules = [...BASE_RULES, surcharge(), surcharge({ id: "s-way", vehicle_group_id: BUSINESS, waypoint_surcharge: 10000 })];
  const saved = { ...pricesOf(rules, 8), created_ids: [] };
  const calls = open("admin", pricesOf(rules), (call) => (call.method === "POST" && call.url.pathname === `${BASE}/price-rules/batch` ? json(200, saved) : null));
  const section = await block();
  const table = within(section).getByRole("table", { name: /区域加价/ });
  assert.ok(within(table).getByRole("columnheader", { name: "途经加价（JPY）" }));
  const fuji = document.getElementById(`surcharge-area-${FUJI}`) as HTMLElement;
  assert.equal(fuji.querySelectorAll(".surcharge-sum__value")[2]?.textContent, "10,000");
  assert.match(fuji.textContent ?? "", /1 个组合没设/);
  assert.match(section.textContent ?? "", /途经加价同一区域一单只加一次/);
  const select = within(section).getByLabelText("选择要加价的区域") as HTMLSelectElement;
  await waitFor(() => assert.ok(select.options.length > 1));
  await actor.selectOptions(select, CHIBA);
  await actor.click(within(section).getByRole("button", { name: "确认添加" }));
  const dialog = await screen.findByRole("dialog", { name: "给「千叶」设区域加价" });
  assert.match(dialog.textContent ?? "", /选填：留空 = 途经景点落在这里时不报价，不加钱填 0/);
  await actor.type(within(dialog).getByLabelText(/^上车加价/), "500");
  await actor.type(within(dialog).getByLabelText(/^下车加价/), "500");
  await actor.type(within(dialog).getByLabelText(/^途经加价/), "-1");
  await actor.click(within(dialog).getByRole("button", { name: "添加" }));
  await within(dialog).findByText("途经加价不能是负数");
  await actor.clear(within(dialog).getByLabelText(/^途经加价/));
  await actor.type(within(dialog).getByLabelText(/^途经加价/), "6000");
  await actor.click(within(dialog).getByRole("button", { name: "添加" }));
  await waitFor(() => assert.equal(screen.queryByRole("dialog"), null));
  const chiba = document.getElementById(`surcharge-area-${CHIBA}`) as HTMLElement;
  assert.equal(chiba.querySelectorAll(".surcharge-sum__value")[2]?.textContent, "6,000");
  await save(actor);
  await waitFor(() => assert.equal(writes(calls).length, 1));
  const batch = batchOf(writes(calls)[0]);
  assert.deepEqual([...new Set(batch.create.map((entry) => entry["waypoint_surcharge"]))], [6000]);
  // 展开富士山，点有途经加价的那一行：「这一行的意思」写出途经规则
  await actor.click(within(section).getByRole("button", { name: "展开「富士山」的各车型组和套餐" }));
  const cell = await screen.findByLabelText("区域加价 · 富士山 · 商务七座 · 8 小时 的途经加价");
  assert.equal((cell as HTMLInputElement).value, "10,000");
  cell.focus();
  await waitFor(() => assert.match(section.textContent ?? "", /途经景点在富士山时加 JPY 10,000（几个景点都在这里只加一次/));
  assertNoRetailWords();
});
