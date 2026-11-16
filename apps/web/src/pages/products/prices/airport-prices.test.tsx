/**
 * 价格页第四张表「机场套餐价」（M9P-22，ADR 0098 第三节第 3、8 小节）的组件测试：
 * 迁移过三层区域的包车，行 = 场景 × 机场 × 车型组、列 = 套餐时长；填了的格是单独价，空格灰字显示继承价（普通套餐 + 那一端③加价，机场结束另加下车点行程加价）；
 * 单独价高于继承价的格标黄；格子展开填单价；和价格表一起批量保存（价格方式 charter_airport_package、新行 ref 不超过 100 个字符、清空已保存的 = 删除）；
 * 还没绑定机场时提示先去商品页绑定。接口用测试替身；真实后端由 e2e/charter-airports.spec.ts 覆盖。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../../App.tsx";
import type { CharterAirportBinding } from "../../../api/charter-airports.ts";
import type { PriceRuleBody, PriceRules } from "../../../api/prices.ts";
import type { Product } from "../../../api/products.ts";
import { type ApiCall, json, resetBrowser, signIn, stubApiWith } from "../../../testing/harness.tsx";

afterEach(resetBrowser);

const stamps = { created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-02T03:04:00.000Z" };
const PRODUCT_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const BASE = `/tenant/v1/products/${PRODUCT_ID}`;
const TODAY = "2026-11-16";
const TOKYO = "11111111-1111-4111-8111-111111111111";
const NRT_UPDOWN = "22222222-2222-4222-8222-222222222222";
const NRT_ITINERARY = "33333333-3333-4333-8333-333333333333";
const NRT_AREA = "44444444-4444-4444-8444-444444444444";
const NRT = "55555555-5555-4555-8555-555555555555";
const VAN = "66666666-6666-4666-8666-666666666666";
const START_5H = "77777777-7777-4777-8777-777777777777";
const END_5H = "88888888-8888-4888-8888-888888888888";

const city = { id: "c1", code: "CTY-JP-TYO", name: { zh: "东京" }, status: "active", center: { lat: 35.68, lng: 139.76 }, boundary: null };
/** 一块方形区域（营运 1 个多边形） */
const square = (id: string, name: string, lng: number, lat: number) => ({
  id,
  name: { zh: name },
  city_id: "c1",
  city,
  biz_type: "general",
  role: "both",
  status: "active",
  operate_polygon_count: 1,
  forbid_polygon_count: 0,
  usage: { product_count: 1, published_product_count: 0 },
  version: 1,
  ...stamps,
  polygons: [{ id: `${id}-p`, kind: "operate", seq: 1, label: null, source: "drawn", circle: null, geometry: { type: "Polygon", coordinates: [[[lng - 0.1, lat - 0.1], [lng + 0.1, lat - 0.1], [lng + 0.1, lat + 0.1], [lng - 0.1, lat + 0.1], [lng - 0.1, lat - 0.1]]] } }],
  last_editor: null,
});
const AREA_MAP = [square(TOKYO, "东京 23 区", 139.7, 35.68), square(NRT_UPDOWN, "成田上下车", 140.39, 35.77), square(NRT_ITINERARY, "成田行程", 140.39, 35.77), square(NRT_AREA, "成田航站楼周边", 140.39, 35.77)];
const AREAS = AREA_MAP.map(({ polygons: _polygons, last_editor: _editor, ...summary }) => summary);

const product = {
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
  vehicle_group_count: 1,
  version: 7,
  ...stamps,
  areas: [{ area_id: TOKYO, priority: 0, name: { zh: "东京 23 区" }, biz_type: "general", status: "active" }],
  vehicle_groups: [{ vehicle_group_id: VAN, passengers: 6, luggage: 4, code: "VG-ECO-7", name: { zh: "经济七座" }, grade: "economy", seats: 7, sample_models: [], combos: [{ passengers: 6, luggage: 4 }], status: "active" }],
  dispatchers: [{ name: "山田", phone: "+81 90 1234 5678" }],
} as unknown as Product;

const EMPTY = { direction: null, base_price: null, start_price: null, start_meters: null, start_minutes: null, per_km: null, per_minute: null, min_price: null, package_km: null, package_price: null, overtime_per_hour: null, over_km_per_km: null, valid_to: null, status: "enabled" as const, ...stamps };
const wholePackage = (id: string, hours: number, price: number): PriceRuleBody => ({ ...EMPTY, id, area_id: null as unknown as string, vehicle_group_id: VAN, package_hours: hours, pricing_model: "charter_package", package_km: 200, package_price: price, overtime_per_hour: 5000, over_km_per_km: 300, valid_from: "2026-11-01", base: String(price) });
const updown: PriceRuleBody = { ...EMPTY, id: "u1", area_id: NRT_UPDOWN, vehicle_group_id: VAN, package_hours: null, pricing_model: "charter_area_surcharge", pickup_surcharge: 14000, dropoff_surcharge: 14000, valid_from: "2026-11-01", base: "0" };
const itinerary: PriceRuleBody = { ...EMPTY, id: "i1", area_id: NRT_ITINERARY, vehicle_group_id: VAN, package_hours: null, pricing_model: "charter_itinerary_surcharge", itinerary_surcharge: 14000, valid_from: "2026-11-01", base: "0" };
const airportRule = (id: string, direction: "pickup" | "dropoff", hours: number, price: number): PriceRuleBody => ({ ...EMPTY, id, area_id: NRT_AREA, vehicle_group_id: VAN, direction, package_hours: hours, pricing_model: "charter_airport_package", package_price: price, valid_from: "2026-11-01", base: String(price) });
/** ADR 0098 第六节的数：5 小时普通 33,000、10 小时 55,000；成田③上 / 下车 14,000、成田② 14,000。机场开始 5 小时单独 45,000，机场结束 5 小时单独 70,000（高于继承 61,000） */
const RULES = [wholePackage("w5", 5, 33000), wholePackage("w10", 10, 55000), updown, itinerary, airportRule(START_5H, "pickup", 5, 45000), airportRule(END_5H, "dropoff", 5, 70000)];
const pricesOf = (items: PriceRuleBody[], version = 7): PriceRules => ({ version, currency: "JPY", rounding_unit: 1, available_models: ["charter_package"], surcharge_models: ["charter_area_surcharge", "charter_itinerary_surcharge"], charter_layout: "three_layer", today: TODAY, items, coverage: { total: 2, priced: 2, missing: 0 } });
const binding = (scenario: "airport_start" | "airport_end"): CharterAirportBinding => ({ scenario, place_id: NRT, place_code: "NRT", place_name: { zh: "成田国际机场" }, area_id: NRT_AREA, area_name: { zh: "成田航站楼周边" }, short_name_zh: "成田机场", effective: true });
const NARITA_PLACE = { id: NRT, code: "NRT", name: { zh: "成田国际机场" }, status: "active", version: 1, ...stamps, type: "airport", country_code: "JP", city_id: null, parent_id: null, city: null, parent: null, location: { lng: 140.385, lat: 35.772 }, category: null, flight_scope: "mixed", address: null, source: null, charter_coverage: false };

type Route = (call: ApiCall & { url: URL }) => Response | Promise<Response> | null;
function open(items: PriceRuleBody[], bindings: CharterAirportBinding[] = [binding("airport_start"), binding("airport_end")], extra: Route = () => null): ApiCall[] {
  signIn("tenant", "tenant-token");
  const calls = stubApiWith((call) => {
    const custom = extra(call);
    if (custom !== null) return custom;
    if (call.method !== "GET") return null;
    const at = call.url.pathname;
    if (at === "/tenant/v1/auth/me") return json(200, { user: { id: "u1", email: "user@supplier.example", name: "测试用户", role: "admin", status: "active", ...stamps }, tenant: { id: "t1", name: "测试用供应商", status: "active", ...stamps }, permissions: [], must_change_password: false });
    if (at === BASE) return json(200, product);
    if (at === `${BASE}/publish-check`) return json(200, { can_publish: true, items: [] });
    if (at === `${BASE}/price-rules`) return json(200, pricesOf(items));
    if (at === `${BASE}/adjust-rules`) return json(200, { version: 7, currency: "JPY", rounding_unit: 1, today: TODAY, items: [] });
    if (at === `${BASE}/charter-migration-diff`) return json(200, { charter_layout: "three_layer", items: [] });
    if (at === `${BASE}/charter-airports`) return json(200, { version: 7, bindings });
    if (at === `${BASE}/service-rules`) return json(200, { version: 7, currency: "JPY", free_wait_minimums: { pickup: null, dropoff: null, general: 0 }, rules: { charter_itinerary: { dropoff_itinerary_surcharge: true } } });
    if (at === `/tenant/v1/master/places/${NRT}`) return json(200, NARITA_PLACE);
    if (at === "/tenant/v1/areas") return json(200, { items: AREAS, next_cursor: null, total: AREAS.length });
    if (at === "/tenant/v1/area-map") return json(200, { items: AREA_MAP, truncated: false });
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
const SLOW = { timeout: 3000 };
const airportTable = async (): Promise<HTMLElement> => {
  const section = (await screen.findByRole("heading", { level: 3, name: "机场套餐价" }, SLOW)).closest("section") as HTMLElement;
  // 标题先出来，机场和区域还在加载时只有「…」；等加载完再看表
  await waitFor(() => assert.equal([...section.querySelectorAll("p.field__hint")].some((hint) => hint.textContent === "…"), false), SLOW);
  return section;
};
const cell = (section: HTMLElement, scenario: "机场开始" | "机场结束", hours: number): HTMLInputElement => within(section).getByLabelText(`${scenario} · 成田机场 · 经济七座 · ${hours} 小时 的单独价`) as HTMLInputElement;
const td = (input: HTMLElement): HTMLElement => input.closest("td") as HTMLElement;
type Batch = { create: Record<string, unknown>[]; update: Record<string, unknown>[]; delete: string[] };

test("第四张表：行 = 场景 × 机场 × 车型组、列 = 套餐时长；空格灰字显示继承价（机场结束另加下车点行程加价），单独价高于继承价的格标黄；放在三张表之后", async () => {
  open(RULES);
  const section = await airportTable();
  // 放在「上下车加价」之后；分块导航多一项
  const updownSection = screen.getByRole("heading", { level: 3, name: /^上下车加价/ }).closest("section") as HTMLElement;
  assert.ok(updownSection.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING);
  assert.match(screen.getByRole("navigation", { name: "本页的分块" }).textContent ?? "", /上下车加价（1 个区域）·机场套餐价/);
  assert.deepEqual([...section.querySelectorAll("thead th")].map((th) => th.textContent), ["车型组", "5 小时（JPY）", "10 小时（JPY）"]);
  assert.deepEqual([...section.querySelectorAll(".price-table__group")].map((row) => row.textContent?.trim()), ["机场开始 · 成田机场（机场区域：成田航站楼周边）", "机场结束 · 成田机场（机场区域：成田航站楼周边）"]);

  // 单独价：机场开始 5 小时 45,000 不高于继承 47,000，不标黄；机场结束 5 小时 70,000 高于继承 61,000，标黄
  assert.equal(cell(section, "机场开始", 5).value, "45,000");
  assert.equal(td(cell(section, "机场开始", 5)).dataset["warn"], undefined);
  await waitFor(() => assert.equal(td(cell(section, "机场结束", 5)).dataset["warn"], "true"), SLOW);
  assert.match(td(cell(section, "机场结束", 5)).textContent ?? "", /高于继承价 61,000/);
  // 空格：灰字写继承价的组成，输入框里的灰字是继承后的价
  assert.equal(cell(section, "机场开始", 10).placeholder, "继承 69,000");
  assert.match(td(cell(section, "机场开始", 10)).textContent ?? "", /继承：普通 55,000 \+ 上车加价 14,000/);
  assert.equal(cell(section, "机场结束", 10).placeholder, "继承 83,000");
  assert.match(td(cell(section, "机场结束", 10)).textContent ?? "", /继承：普通 55,000 \+ 下车加价 14,000 \+ 下车点行程加价 14,000/);
  // 金额都是结算价：没有对外价、加价比例
  assert.doesNotMatch(section.textContent ?? "", /对外价|加价比例/);
});

test("填和清空：新填的格提交 charter_airport_package（方向按场景、ref 不超过 100 个字符），填得比继承价高马上标黄；展开单价填超时；清空已保存的格 = 删除（改回继承）", async () => {
  const actor = user();
  const calls = open(RULES, undefined, (call) => (call.method === "POST" && call.url.pathname === `${BASE}/price-rules/batch` ? json(200, { ...pricesOf(RULES, 8), created_ids: [] }) : null));
  const section = await airportTable();
  const fresh = cell(section, "机场开始", 10);
  await waitFor(() => assert.equal(fresh.placeholder, "继承 69,000"), SLOW);
  await actor.type(fresh, "80000");
  await waitFor(() => assert.equal(td(fresh).dataset["warn"], "true"));
  await actor.clear(fresh);
  await actor.type(fresh, "60000");
  assert.equal(td(fresh).dataset["warn"], undefined);
  await actor.click(within(td(fresh)).getByRole("button", { name: /^展开单价/ }));
  await actor.type(within(td(fresh)).getByLabelText("机场开始 · 成田机场 · 经济七座 · 10 小时 的超时每小时"), "6000");
  await actor.clear(cell(section, "机场结束", 5));
  await actor.click(screen.getByRole("button", { name: "保存草稿" }));

  await waitFor(() => assert.equal(calls.filter((call) => call.method === "POST").length, 1));
  const batch = calls.find((call) => call.method === "POST")?.body as Batch;
  assert.deepEqual(batch.delete, [END_5H]);
  assert.equal(batch.update.length, 0);
  assert.equal(batch.create.length, 1);
  const created = batch.create[0] as Record<string, unknown>;
  assert.deepEqual(
    [created["pricing_model"], created["area_id"], created["direction"], created["vehicle_group_id"], created["package_hours"], created["package_price"], created["overtime_per_hour"], created["package_km"], created["over_km_per_km"], created["valid_from"], created["valid_to"]],
    ["charter_airport_package", NRT_AREA, "pickup", VAN, 10, 60000, 6000, null, null, TODAY, null],
  );
  assert.ok(String(created["ref"]).length <= 100, `ref 长 ${String(created["ref"]).length}`);
});

test("写错了：填了单价没填单独价 → 不提交，错误落在那一格", async () => {
  const actor = user();
  const calls = open(RULES);
  const section = await airportTable();
  const fresh = cell(section, "机场开始", 10);
  await actor.click(within(td(fresh)).getByRole("button", { name: /^展开单价/ }));
  await actor.type(within(td(fresh)).getByLabelText("机场开始 · 成田机场 · 经济七座 · 10 小时 的含公里"), "250");
  await actor.click(screen.getByRole("button", { name: "保存草稿" }));
  await waitFor(() => assert.equal(fresh.getAttribute("aria-invalid"), "true"));
  assert.match(td(fresh).textContent ?? "", /填了单价就要填单独价/);
  assert.equal(calls.filter((call) => call.method === "POST").length, 0);
});

test("还没绑定机场：第四张表提示先去商品页「机场套餐」绑定", async () => {
  open(RULES.filter((rule) => rule.pricing_model !== "charter_airport_package"), []);
  const section = await airportTable();
  await waitFor(() => assert.match(section.textContent ?? "", /还没有绑定机场。先在「① 基础信息」的「机场套餐」里绑定机场/));
  assert.equal(section.querySelector("table"), null);
});
