/**
 * 商品页「机场套餐」绑定（M9P-22，ADR 0098 第三节第 2、8 小节）的组件测试：
 * 迁移过三层区域的包车商品显示两组（机场开始 / 机场结束）；加一行选机场、机场区域、填简称，保存整组替换（带 If-Match 版本号）；
 * 页面先查必填，后端的校验问题按 `/bindings/{序号}/{字段}` 落到那一行那一格；解绑还有机场套餐价时写原因；
 * 没迁移过的商品写「迁移三层区域后可用」；只读角色只能看（停用的绑定标红）。接口用测试替身；真实后端由 e2e/charter-airports.spec.ts 覆盖。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../App.tsx";
import type { CharterAirportBinding, CharterAirports } from "../../api/charter-airports.ts";
import type { Product } from "../../api/products.ts";
import { type ApiCall, apiError, assertAbsent, json, resetBrowser, signIn, stubApiWith } from "../../testing/harness.tsx";

afterEach(resetBrowser);

const stamps = { created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-02T03:04:00.000Z" };
const PRODUCT_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const BASE = `/tenant/v1/products/${PRODUCT_ID}`;
const TOKYO = "11111111-1111-4111-8111-111111111111";
const NRT_AREA = "22222222-2222-4222-8222-222222222222";
const HND_AREA = "33333333-3333-4333-8333-333333333333";
const NRT = "44444444-4444-4444-8444-444444444444";
const HND = "55555555-5555-4555-8555-555555555555";
const VAN = "66666666-6666-4666-8666-666666666666";

const cityRef = { id: "c1", code: "CTY-JP-TYO", name: { zh: "东京" }, country_code: "JP", timezone: "Asia/Tokyo", status: "active" as const };
const product = {
  id: PRODUCT_ID,
  code: "PRD202611160001",
  status: "draft",
  category: "charter",
  title: { zh: "东京包车" },
  brand_id: "b1",
  brand: { id: "b1", name: "NOZOMI", currency: "JPY", status: "active" },
  city_id: "c1",
  city: cityRef,
  poi_id: null,
  poi: null,
  area_count: 1,
  vehicle_group_count: 1,
  version: 7,
  published_at: null,
  ...stamps,
  areas: [{ area_id: TOKYO, priority: 0, name: { zh: "东京 23 区" }, biz_type: "general", status: "active" }],
  vehicle_groups: [{ vehicle_group_id: VAN, passengers: 6, luggage: 4, code: "VG-ECO-7", name: { zh: "经济七座" }, grade: "economy", seats: 7, sample_models: [], combos: [{ passengers: 6, luggage: 4 }], status: "active" }],
  dispatchers: [{ name: "山田", phone: "+81 90 1234 5678" }],
} as unknown as Product;

const city = { id: "c1", code: "CTY-JP-TYO", name: { zh: "东京" }, status: "active", center: { lat: 35.68, lng: 139.76 }, boundary: null };
const areaOf = (id: string, name: string, overrides: Record<string, unknown> = {}) => ({ id, name: { zh: name }, city_id: "c1", city, biz_type: "airport_transfer", role: "both", status: "active", operate_polygon_count: 1, forbid_polygon_count: 0, usage: { product_count: 0, published_product_count: 0 }, version: 1, ...stamps, ...overrides });
const AREAS = [areaOf(TOKYO, "东京 23 区", { biz_type: "general" }), areaOf(NRT_AREA, "成田机场"), areaOf(HND_AREA, "羽田机场")];
const placeOf = (id: string, code: string, name: string) => ({ id, code, name: { zh: name }, status: "active", version: 1, ...stamps, type: "airport", country_code: "JP", city_id: null, parent_id: null, city: null, parent: null, location: { lng: 140.39, lat: 35.77 }, category: null, flight_scope: "mixed", address: null, source: null, charter_coverage: false });
const AIRPORTS = [placeOf(NRT, "NRT", "成田国际机场"), placeOf(HND, "HND", "东京国际机场（羽田）")];
const bindingOf = (overrides: Partial<CharterAirportBinding> = {}): CharterAirportBinding => ({ scenario: "airport_start", place_id: NRT, place_code: "NRT", place_name: { zh: "成田国际机场" }, area_id: NRT_AREA, area_name: { zh: "成田机场" }, short_name_zh: "成田机场", effective: true, ...overrides });
const pricesOf = (layout: "three_layer" | null) => ({ version: 7, currency: "JPY", rounding_unit: 1, available_models: ["charter_package"], surcharge_models: [], charter_layout: layout, today: "2026-11-16", items: [], coverage: { total: 0, priced: 0, missing: 0 } });

type Route = (call: ApiCall & { url: URL }) => Response | Promise<Response> | null;
function open(options: { role?: string; layout?: "three_layer" | null; bindings?: CharterAirportBinding[]; extra?: Route } = {}): ApiCall[] {
  signIn("tenant", "tenant-token");
  const calls = stubApiWith((call) => {
    const custom = options.extra?.(call) ?? null;
    if (custom !== null) return custom;
    if (call.method !== "GET") return null;
    const at = call.url.pathname;
    if (at === "/tenant/v1/auth/me") return json(200, { user: { id: "u1", email: "user@supplier.example", name: "测试用户", role: options.role ?? "admin", status: "active", ...stamps }, tenant: { id: "t1", name: "测试用供应商", status: "active", ...stamps }, permissions: [], must_change_password: false });
    if (at === "/tenant/v1/dashboard/summary") return json(200, { areas: { active: 3, disabled: 0 }, products: { draft: 1, published: 0, unpublished: 0 } });
    if (at === BASE) return json(200, product);
    if (at === `${BASE}/publish-check`) return json(200, { can_publish: false, items: [] });
    if (at === `${BASE}/price-rules`) return json(200, pricesOf(options.layout === undefined ? "three_layer" : options.layout));
    if (at === `${BASE}/charter-airports`) return json(200, { version: 7, bindings: options.bindings ?? [bindingOf()] } satisfies CharterAirports);
    if (at === "/tenant/v1/master/places") return json(200, { items: AIRPORTS, next_cursor: null, total: AIRPORTS.length });
    if (at === "/tenant/v1/master/vehicle-groups") return json(200, { items: [], next_cursor: null, total: 0 });
    if (at === "/tenant/v1/areas") return json(200, { items: AREAS, next_cursor: null, total: AREAS.length });
    if (at === "/tenant/v1/brands") return json(200, { items: [{ id: "b1", name: "NOZOMI", currency: "JPY", status: "active", version: 4, ...stamps }] });
    if (at === "/tenant/v1/map/config") return json(200, { tiles: null });
    return null;
  });
  render(
    <MemoryRouter initialEntries={[`/products/${PRODUCT_ID}/basic`]}>
      <App />
    </MemoryRouter>,
  );
  return calls;
}

const user = () => userEvent.setup();
const card = async (): Promise<HTMLElement> => (await screen.findByRole("heading", { level: 2, name: "机场套餐" }, { timeout: 3000 })).closest("section") as HTMLElement;
const group = (section: HTMLElement, name: RegExp): HTMLElement => within(section).getByRole("group", { name }) as HTMLElement;

test("迁移过的包车：两组机场绑定；加一行选机场、机场区域、简称，保存整组替换（机场开始在前），带 If-Match，成功后提示", async () => {
  const calls = open({ extra: (call) => (call.method === "PUT" && call.url.pathname === `${BASE}/charter-airports` ? json(200, { version: 8, bindings: [bindingOf(), bindingOf({ scenario: "airport_end", place_id: HND, place_name: { zh: "东京国际机场（羽田）" }, area_id: HND_AREA, area_name: { zh: "羽田机场" }, short_name_zh: "羽田机场" })] }) : null) });
  const actor = user();
  const section = await card();
  const start = group(section, /^机场开始/);
  await waitFor(() => assert.equal((within(start).getByLabelText("机场开始第 1 个机场的机场") as HTMLSelectElement).value, NRT));
  assert.equal((within(start).getByLabelText("机场开始第 1 个机场的机场区域") as HTMLSelectElement).value, NRT_AREA);
  assert.equal((within(start).getByLabelText("机场开始第 1 个机场的中文简称（选填）") as HTMLInputElement).value, "成田机场");
  const end = group(section, /^机场结束/);
  assert.ok(within(end).getByText("还没有绑定机场"));
  assert.equal((within(section).getByRole("button", { name: "保存机场套餐" }) as HTMLButtonElement).disabled, true, "没改不能保存");

  await actor.click(within(end).getByRole("button", { name: /^添加机场/ }));
  await waitFor(() => assert.ok(within(end).getByLabelText("机场结束第 1 个机场的机场")));
  await actor.selectOptions(within(end).getByLabelText("机场结束第 1 个机场的机场"), HND);
  // 机场区域的选项：本供应商启用中的区域，业务类型不限（接送机类型也能选）
  const areaSelect = within(end).getByLabelText("机场结束第 1 个机场的机场区域") as HTMLSelectElement;
  assert.deepEqual([...areaSelect.options].map((option) => option.textContent), ["选择机场区域", "东京 23 区", "成田机场", "羽田机场"]);
  await actor.selectOptions(areaSelect, HND_AREA);
  await actor.type(within(end).getByLabelText("机场结束第 1 个机场的中文简称（选填）"), "羽田机场");
  assert.ok(within(section).getByText("机场套餐有未保存的修改"));
  await actor.click(within(section).getByRole("button", { name: "保存机场套餐" }));

  const put = calls.find((call) => call.method === "PUT");
  assert.equal(put?.headers["if-match"], '"7"');
  assert.deepEqual(put?.body, {
    bindings: [
      { scenario: "airport_start", place_id: NRT, area_id: NRT_AREA, short_name_zh: "成田机场" },
      { scenario: "airport_end", place_id: HND, area_id: HND_AREA, short_name_zh: "羽田机场" },
    ],
  });
  assert.ok(await within(section).findByText("机场套餐已保存"));
  assertAbsent(within(section).queryByText("机场套餐有未保存的修改"));
});

test("校验：页面先查必填（错误落在那一格、焦点过去）；后端的问题按 /bindings/{序号}/{字段} 落到那一行；解绑还有机场套餐价时写原因", async () => {
  let reply: () => Response = () =>
    apiError(400, "VALIDATION_FAILED", "字段不合规", { issues: [{ path: "/bindings/0/area_id", reason: "AIRPORT_NOT_IN_AREA", message: "机场或航站楼不在这个机场区域里：成田国际机场 第 3 航站楼", detail: { places: "NRT-T3" } }] });
  const calls = open({ extra: (call) => (call.method === "PUT" ? reply() : null) });
  const actor = user();
  const section = await card();
  const end = group(section, /^机场结束/);
  await actor.click(within(end).getByRole("button", { name: /^添加机场/ }));
  await actor.click(within(section).getByRole("button", { name: "保存机场套餐" }));
  const airport = within(end).getByLabelText("机场结束第 1 个机场的机场");
  await waitFor(() => assert.equal(document.activeElement, airport));
  assert.equal(airport.getAttribute("aria-invalid"), "true");
  assert.ok(within(end).getByText("请选择机场"));
  assert.ok(within(end).getByText("请选择机场区域"));
  assert.equal(calls.filter((call) => call.method === "PUT").length, 0, "页面查出问题时不提交");

  // 删掉空行，改成只改简称：后端说机场开始那一行的机场区域不对
  await actor.click(within(end).getByRole("button", { name: "删除机场结束第 1 个机场" }));
  const start = group(section, /^机场开始/);
  const short = within(start).getByLabelText("机场开始第 1 个机场的中文简称（选填）");
  await actor.clear(short);
  await actor.type(short, "成田");
  await actor.click(within(section).getByRole("button", { name: "保存机场套餐" }));
  const area = within(start).getByLabelText("机场开始第 1 个机场的机场区域");
  await waitFor(() => assert.equal(area.getAttribute("aria-invalid"), "true"));
  assert.ok(within(start).getByText("机场或航站楼不在这个机场区域里：成田国际机场 第 3 航站楼"));
  assert.match(within(section).getByRole("alert").textContent ?? "", /没有保存。有 1 处要改/);

  reply = () => apiError(409, "AIRPORT_PRICES_EXIST", "这个机场还有机场套餐价，先在价格页删掉再解绑", { area_ids: [NRT_AREA] });
  await actor.click(within(start).getByRole("button", { name: "删除机场开始第 1 个机场" }));
  await actor.click(within(section).getByRole("button", { name: "保存机场套餐" }));
  assert.ok(await within(section).findByText("解绑的机场还有机场套餐价，请先在价格页删掉这些机场的机场套餐价，再解绑。"));
});

test("没迁移过三层区域的包车：写「迁移三层区域后可用」，不取绑定", async () => {
  const calls = open({ layout: null });
  const section = await card();
  assert.ok(within(section).getByText("迁移三层区域后可用"));
  assert.equal(calls.some((call) => call.path.includes("charter-airports")), false);
});

test("只读角色：一张表，只能看；机场区域或机场停用的绑定标红", async () => {
  open({ role: "readonly", bindings: [bindingOf(), bindingOf({ scenario: "airport_end", place_id: HND, place_name: { zh: "东京国际机场（羽田）" }, area_id: HND_AREA, area_name: { zh: "羽田机场" }, short_name_zh: null, effective: false })] });
  const section = await card();
  await waitFor(() => assert.ok(within(section).getByRole("table")));
  const rows = [...within(section).getByRole("table").querySelectorAll("tbody tr")].map((row) => [...row.children].map((cell) => cell.textContent));
  assert.deepEqual(rows, [
    ["机场开始", "成田国际机场", "成田机场", "成田机场", ""],
    ["机场结束", "东京国际机场（羽田）", "羽田机场", "—", "机场区域或机场已停用，报价时这条不生效"],
  ]);
  assertAbsent(within(section).queryByRole("button", { name: "保存机场套餐" }));
  assertAbsent(within(section).queryByRole("combobox"));
});
