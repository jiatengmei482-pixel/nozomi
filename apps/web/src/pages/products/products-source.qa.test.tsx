/**
 * M1-12 测试角色补充（回归）：步骤组件改成「经数据来源取数、拼链接」之后，供应商后台的编辑模式没有被改坏。
 * - 各步骤只调 /tenant/v1，不碰 /platform/v1；车型组、附加服务、节假日走供应商自己的目录接口；
 * - 价格规则有「价格日历」页签和「导入 / 导出」；各步骤有能输入的框和保存按钮；
 * - 保存服务规则、商品详情都发到 /tenant/v1，带 If-Match；步骤导航、「去填」的链接指向 /products/…，不是 /platform/products/…。
 * 接口用测试替身。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../App.tsx";
import type { Addon, City, VehicleGroup } from "../../api/master.ts";
import type { Product, PublishCheckItemBody, PublishCheckResult } from "../../api/products.ts";
import { type ApiCall, json, resetBrowser, signIn, stubApiWith } from "../../testing/harness.tsx";

afterEach(resetBrowser);

const stamps = { created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-02T03:04:00.000Z" };
const CITY_ID = "11111111-1111-4111-8111-111111111111";
const BRAND_ID = "33333333-3333-4333-8333-333333333333";
const AREA_ID = "44444444-4444-4444-8444-444444444444";
const GROUP_ID = "55555555-5555-4555-8555-555555555555";
const ADDON_ID = "66666666-6666-4666-8666-666666666666";
const PRODUCT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BASE = `/tenant/v1/products/${PRODUCT_ID}`;

const tokyo: City = { id: CITY_ID, code: "CTY-JP-TYO", country_code: "JP", name: { zh: "东京" }, timezone: "Asia/Tokyo", center: { lng: 139.7, lat: 35.7 }, boundary: null, status: "active", version: 1, ...stamps };
const group: VehicleGroup = { id: GROUP_ID, code: "VG-BIZ-7", grade: "business", seats: 7, name: { zh: "商务七座" }, sample_models: ["丰田埃尔法"], power: "fuel", combos: [{ passengers: 6, luggage: 4 }], status: "active", version: 1, ...stamps };
const seat: Addon = { id: ADDON_ID, code: "ADD-SEAT", categories: ["point_to_point"], charge_unit: "per_item", name: { zh: "儿童座椅" }, description: {}, status: "active", version: 1, ...stamps };
const product: Product = {
  id: PRODUCT_ID,
  code: "PRD202610081430050001",
  status: "draft",
  category: "point_to_point",
  title: { zh: "东京市内点对点" },
  brand_id: BRAND_ID,
  brand: { id: BRAND_ID, name: "NOZOMI", currency: "JPY", status: "active" },
  city_id: CITY_ID,
  city: { id: CITY_ID, code: tokyo.code, name: tokyo.name, country_code: "JP", timezone: "Asia/Tokyo", status: "active" },
  poi_id: null,
  poi: null,
  area_count: 1,
  vehicle_group_count: 1,
  version: 7,
  published_at: null,
  ...stamps,
  areas: [{ area_id: AREA_ID, priority: 0, name: { zh: "东京 23 区" }, biz_type: "general", status: "active" }],
  vehicle_groups: [{ vehicle_group_id: GROUP_ID, passengers: 6, luggage: 4, code: group.code, name: group.name, grade: "business", seats: 7, sample_models: group.sample_models, combos: group.combos, status: "active" }],
  dispatchers: [{ name: "山田", phone: "+81 90 1234 5678" }],
};
const item = (key: string, issues: { path: string; reason: string }[] = [], required = true): PublishCheckItemBody => ({ key, required, passed: issues.length === 0, issues: issues.map((issue) => ({ ...issue, message: "说明" })) });
const check: PublishCheckResult = { can_publish: false, items: [item("basic_info"), item("service_rules"), item("price_rules", [{ path: "/", reason: "NO_ACTIVE_PRICE_RULE" }]), item("content", [{ path: "/zh/summary", reason: "REQUIRED" }]), item("adjust_rules", [], false), item("inventory", [], false)] };
const rules = {
  version: 7,
  currency: "JPY",
  free_wait_minimums: { pickup: null, dropoff: null, general: 15 },
  rules: {
    booking: { sale_from: null, sale_to: null, service_time: { start: "06:00", end: "23:00" }, lead_time_hours: 24, note: null },
    urgent: { enabled: false, daily_quota: null, tiers: [] },
    night: { enabled: false, window: null, amount: null, charge_unit: null },
    free_wait: { pickup: null, dropoff: null, general: { mode: "limited", minutes: 15 } },
    addons: [],
    driver_languages: [],
  },
};

function open(path: string): ApiCall[] {
  signIn("tenant", "tenant-token");
  // 和真实后端一样：任何一步保存后商品的版本号加一
  let version = 7;
  const calls = stubApiWith((call) => {
    const at = call.url.pathname;
    if (call.method === "PUT" && at === `${BASE}/service-rules`) {
      version += 1;
      return json(200, { ...rules, version });
    }
    if (call.method === "PUT" && at === `${BASE}/content`) return json(200, { version: 8, content: call.body });
    if (call.method !== "GET") return null;
    if (at === "/tenant/v1/auth/me") return json(200, { user: { id: "u1", email: "user@supplier.example", name: "测试用户", role: "admin", status: "active", ...stamps }, tenant: { id: "t1", name: "测试用供应商", status: "active", ...stamps }, permissions: [], must_change_password: false });
    if (at === "/tenant/v1/master/cities") return json(200, { items: [tokyo], next_cursor: null, total: 1 });
    if (at === "/tenant/v1/master/places") return json(200, { items: [], next_cursor: null, total: 0 });
    if (at === "/tenant/v1/master/vehicle-groups") return json(200, { items: [group], next_cursor: null, total: 1 });
    if (at === "/tenant/v1/master/addons") return json(200, { items: [seat], next_cursor: null, total: 1 });
    if (at === "/tenant/v1/brands") return json(200, { items: [{ id: BRAND_ID, name: "NOZOMI", currency: "JPY", status: "active", version: 1, ...stamps }] });
    if (at === "/tenant/v1/areas") return json(200, { items: [], next_cursor: null, total: 0 });
    if (at === "/tenant/v1/holidays") return json(200, { items: [], countries: [] });
    if (at === BASE) return json(200, { ...product, version });
    if (at === `${BASE}/publish-check`) return json(200, check);
    if (at === `${BASE}/service-rules`) return json(200, { ...rules, version });
    if (at === `${BASE}/content`) return json(200, { version, content: { zh: { title: "东京市内点对点", summary: null, includes: [], excludes: [], itinerary: null, pickup_guide: null } } });
    if (at === `${BASE}/price-rules`) return json(200, { version: 7, currency: "JPY", rounding_unit: 100, available_models: ["fixed"], today: "2026-10-15", items: [], coverage: { total: 1, priced: 0, missing: 1 } });
    if (at === `${BASE}/adjust-rules`) return json(200, { version: 7, currency: "JPY", rounding_unit: 100, today: "2026-10-15", items: [] });
    if (at === `${BASE}/inventory`) return json(200, { version: 7, mode: "unlimited", today: "2026-10-15", days: [] });
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
const editableInputs = (): Element[] => [...screen.getByRole("main").querySelectorAll("input, textarea")].filter((node) => !(node as HTMLInputElement).readOnly && !(node as HTMLInputElement).disabled);

test("供应商后台的编辑模式（回归）：每一步都能输入、有保存；只调 /tenant/v1；步骤链接在 /products 下；价格规则有「价格日历」和「导入 / 导出」；保存服务规则、商品详情发到供应商接口并带 If-Match", async () => {
  const calls = open(`/products/${PRODUCT_ID}/basic`);
  const steps = await screen.findByRole("navigation", { name: "配置步骤" });
  await screen.findByRole("heading", { level: 2, name: "① 基础信息" });
  await waitFor(() => assert.ok(editableInputs().length > 0, "基础信息有能输入的框"));
  assert.deepEqual(
    within(steps)
      .getAllByRole("link")
      .map((link) => link.getAttribute("href")),
    ["basic", "service-rules", "prices", "inventory", "content", "publish"].map((slug) => `/products/${PRODUCT_ID}/${slug}`),
  );

  await user().click(within(steps).getByRole("link", { name: /服务规则/ }));
  await screen.findByRole("heading", { level: 2, name: "② 服务规则" });
  await waitFor(() => assert.match(document.body.textContent ?? "", /儿童座椅/, "附加服务目录来自供应商自己的接口"));
  const leadTime = screen.getByLabelText(/提前预订时长/) as HTMLInputElement;
  await user().clear(leadTime);
  await user().type(leadTime, "12");
  await user().click(screen.getAllByRole("button", { name: /^保存/ })[0] as HTMLElement);
  await waitFor(() => assert.ok(calls.some((call) => call.method === "PUT" && call.path === `${BASE}/service-rules`)));
  const putRules = calls.find((call) => call.method === "PUT" && call.path === `${BASE}/service-rules`) as ApiCall;
  assert.equal(putRules.headers["if-match"], '"7"');
  assert.equal((putRules.body as { booking: { lead_time_hours: number } }).booking.lead_time_hours, 12);

  await user().click(within(steps).getByRole("link", { name: /价格规则/ }));
  await screen.findByRole("heading", { level: 2, name: "③ 价格规则" });
  assert.deepEqual(
    within(screen.getByRole("navigation", { name: "价格规则的分区" }))
      .getAllByRole("link")
      .map((link) => (link.textContent ?? "").replace(/缺 \d+$/, "")),
    ["价格规则", "调价规则", "价格日历"],
  );
  await waitFor(() => assert.ok(screen.getByRole("button", { name: /导入 \/ 导出/ })));

  await user().click(within(steps).getByRole("link", { name: /商品详情/ }));
  await screen.findByRole("heading", { level: 2, name: "⑤ 商品详情" });
  const summary = (await screen.findAllByLabelText(/简介|一句话介绍|概要/))[0] as HTMLElement;
  await user().type(summary, "市内任意两点");
  await user().click(screen.getByRole("button", { name: "保存草稿" }));
  await waitFor(() => assert.ok(calls.some((call) => call.method === "PUT" && call.path === `${BASE}/content`)));
  assert.equal(calls.find((call) => call.method === "PUT" && call.path === `${BASE}/content`)?.headers["if-match"], '"8"', "上一步保存后版本号跟上");

  await user().click(within(steps).getByRole("link", { name: /上架检查/ }));
  await screen.findByRole("heading", { level: 2, name: "上架检查" });
  for (const link of within(screen.getByRole("main")).getAllByRole("link")) {
    const href = link.getAttribute("href") ?? "";
    assert.doesNotMatch(href, /^\/platform/, `供应商后台的链接不该指向运营后台：${href}`);
  }
  assert.deepEqual(calls.filter((call) => call.path.startsWith("/platform/v1")).map((call) => call.path), [], "供应商后台不调平台接口");
});
