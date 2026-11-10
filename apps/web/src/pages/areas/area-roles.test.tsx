/**
 * M8-20（ADR 0075）区域用途的组件测试：新增 / 编辑选用途（三种的说明）、报价区域超出运营区域的提醒（按画面现算）、
 * 两个 409（`AREA_IN_USE` 改成运营区域、`PRICING_AREA_OUTSIDE_OPERATING` 列出受影响的商品和区域）、列表的用途列和筛选、
 * 区域地图的用途样式 / 图例 / 筛选、重叠只在报价区域之间算、超出的部分，运营后台的「未覆盖需求」图层。接口一律是测试替身。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../App.tsx";
import type { AreaMapItem, PlatformAreaMapItem } from "../../api/area-map.ts";
import type { Area, AreaPolygon, AreaSummary, MapTiles } from "../../api/areas.ts";
import type { City } from "../../api/master.ts";
import type { MapSurface, SurfaceEvents } from "../../lib/map-surface.ts";
import { demandMapPoints } from "../../lib/uncovered-demand-display.ts";
import { type ApiCall, apiError, assertAbsent, json, resetBrowser, signIn, stubApiWith } from "../../testing/harness.tsx";
import { AreaOverviewMap, type OverviewArea } from "./AreaOverviewMap.tsx";

afterEach(resetBrowser);

const stamps = { created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-02T03:04:00.000Z" };
const TOKYO_ID = "11111111-1111-4111-8111-111111111111";
const AREA_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OPERATING_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PRODUCT_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const tokyo: City = { id: TOKYO_ID, code: "CTY-JP-TYO", country_code: "JP", name: { zh: "东京" }, timezone: "Asia/Tokyo", center: { lng: 139.7, lat: 35.7 }, boundary: null, status: "active", version: 3, ...stamps };
const areaCity = { id: TOKYO_ID, code: tokyo.code, name: tokyo.name, status: "active" as const, center: tokyo.center, boundary: null };

function square(id: string, west: number, south: number, size: number): AreaPolygon {
  const ring: [number, number][] = [[west, south], [west + size, south], [west + size, south + size], [west, south + size], [west, south]];
  return { id, kind: "operate", seq: 1, label: null, source: "drawn", circle: null, geometry: { type: "Polygon", coordinates: [ring] } };
}

/** 报价区域「东京 23 区」0.2° 见方；运营区域「东京西部」只盖住它西边一半 → 东边一半超出 */
const pricing: Area = { id: AREA_ID, name: { zh: "东京 23 区" }, city_id: TOKYO_ID, city: areaCity, biz_type: "general", role: "pricing", status: "active", operate_polygon_count: 1, forbid_polygon_count: 0, usage: { product_count: 0, published_product_count: 0 }, version: 4, ...stamps, polygons: [square("cccccccc-cccc-4ccc-8ccc-cccccccccccc", 139.6, 35.6, 0.2)], outside_operating_m2: 180_000_000 };
const operating: Area = { ...pricing, id: OPERATING_ID, name: { zh: "东京西部" }, role: "operating", polygons: [square("dddddddd-dddd-4ddd-8ddd-dddddddddddd", 139.5, 35.5, 0.2)], outside_operating_m2: null };
const mapItem = (area: Area): AreaMapItem => ({ ...area, last_editor: null });
const summaryOf = (area: Area): AreaSummary => {
  const { polygons: _polygons, outside_operating_m2: _outside, ...rest } = area;
  return rest;
};

const me = (role: string) => json(200, { user: { id: "u1", email: "user@supplier.example", name: "测试用户", role, status: "active", ...stamps }, tenant: { id: "t1", name: "测试用供应商", status: "active", ...stamps }, permissions: [], must_change_password: false });
const page = <T,>(items: T[]) => json(200, { items, next_cursor: null, total: items.length });

type Route = (call: ApiCall & { url: URL }) => Response | Promise<Response> | null;

function open(path: string, role: string, routes: Route = () => null): ApiCall[] {
  signIn("tenant", "tenant-token");
  const calls = stubApiWith((call) => {
    const custom = routes(call);
    if (custom !== null) return custom;
    if (call.url.pathname === "/tenant/v1/auth/me") return me(role);
    if (call.method === "GET" && call.url.pathname === "/tenant/v1/master/cities") return page([tokyo]);
    if (call.url.pathname === "/tenant/v1/map/config") return json(200, { tiles: null });
    if (call.url.pathname === "/tenant/v1/area-map") return json(200, { items: [mapItem(pricing), mapItem(operating)], truncated: false });
    if (call.method === "GET" && call.path === `/tenant/v1/areas/${AREA_ID}`) return json(200, pricing);
    return null;
  });
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  return calls;
}

const writes = (calls: ApiCall[]): ApiCall[] => calls.filter((call) => call.method !== "GET");

test("新增：用途有三个选项、各有说明，默认「运营 + 报价」；选「运营区域」后提交带 role", async () => {
  const user = userEvent.setup();
  const calls = open("/areas/new", "admin", (call) => (call.method === "POST" && call.path === "/tenant/v1/areas" ? json(201, { ...operating, id: "ffffffff-ffff-4fff-8fff-ffffffffffff" }) : null));
  const group = await screen.findByRole("group", { name: /用途/ }, { timeout: 5000 });
  const radios = within(group).getAllByRole("radio");
  assert.deepEqual(radios.map((radio) => radio.getAttribute("value")), ["operating", "pricing", "both"]);
  assert.equal((within(group).getByRole("radio", { name: /运营 \+ 报价/ }) as HTMLInputElement).checked, true);
  assert.match(group.textContent ?? "", /只决定这一单能不能接，不带价格/);
  assert.match(group.textContent ?? "", /商品勾选后给它填价格或加价/);
  assert.match(document.querySelector('[data-field="role"]')?.textContent ?? "", /同时在你的某个运营区域里、又在商品勾选的报价区域里/);

  await user.click(await screen.findByRole("combobox", { name: /城市/ }));
  await user.click(await screen.findByRole("option", { name: /东京/ }));
  await user.type(screen.getByRole("textbox", { name: /中文/ }), "东京全域");
  await user.click(within(group).getByRole("radio", { name: /^运营区域/ }));
  await user.click(screen.getByRole("button", { name: /^添加营运区/ }));
  await user.click(screen.getByRole("menuitem", { name: "逐点输入坐标" }));
  for (const [index, point] of [[35.6, 139.6], [35.6, 139.8], [35.8, 139.8]].entries()) {
    await user.type(screen.getByLabelText(`营运 1 第 ${index + 1} 个点的纬度`), String(point[0]));
    await user.type(screen.getByLabelText(`营运 1 第 ${index + 1} 个点的经度`), String(point[1]));
  }
  await user.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() => assert.equal(writes(calls).length, 1));
  assert.equal((writes(calls)[0]?.body as { role?: string }).role, "operating");
});

test("编辑：报价区域有一部分不在运营区域里——按画面现算并提醒（只是提醒，可以保存）；改成「运营 + 报价」后提醒消失", async () => {
  const user = userEvent.setup();
  open(`/areas/${AREA_ID}`, "admin");
  await screen.findByRole("heading", { level: 1, name: "东京 23 区" });
  await screen.findByRole("group", { name: /用途/ }, { timeout: 5000 });
  const warning = await screen.findByText(/这个报价区域有约 302 平方公里不在任何运营区域里，那部分不会报价/, {}, { timeout: 5000 });
  assert.ok(warning.closest('[data-outside-warning]'));
  assert.match(document.querySelector("[data-outside-warning]")?.textContent ?? "", /只是提醒，可以保存/);
  assert.equal((screen.getByRole("radio", { name: /^报价区域/ }) as HTMLInputElement).checked, true);
  await user.click(screen.getByRole("radio", { name: /运营 \+ 报价/ }));
  await waitFor(() => assertAbsent(document.querySelector("[data-outside-warning]")));
});

test("编辑：有商品在用时改成运营区域——当场说明；保存被拒（AREA_IN_USE）说明在用途下面", async () => {
  const user = userEvent.setup();
  const used: Area = { ...pricing, usage: { product_count: 2, published_product_count: 1 } };
  open(`/areas/${AREA_ID}`, "admin", (call) => {
    if (call.method === "GET" && call.path === `/tenant/v1/areas/${AREA_ID}`) return json(200, used);
    if (call.method === "PUT") return apiError(409, "AREA_IN_USE", "in use", { product_count: 2, published_product_count: 1 });
    return null;
  });
  await screen.findByRole("heading", { level: 1, name: "东京 23 区" });
  await screen.findByRole("group", { name: /用途/ }, { timeout: 5000 });
  await user.click(screen.getByRole("radio", { name: /^运营区域/ }));
  assert.match(document.querySelector('[data-field="role"]')?.textContent ?? "", /已有 2 个商品勾选了这个区域。运营区域不带价格/);
  await user.click(screen.getByRole("button", { name: "保存" }));
  await screen.findByText(/有 2 个商品把这个区域当报价区域用着.*不能改成运营区域/);
  assert.doesNotMatch(document.body.textContent ?? "", /AREA_IN_USE/);
});

test("编辑：保存被拒（PRICING_AREA_OUTSIDE_OPERATING）——列出受影响的已上架商品、报价区域和超出的面积，商品可以点进去；画的内容还在", async () => {
  const user = userEvent.setup();
  open(`/areas/${OPERATING_ID}`, "admin", (call) => {
    if (call.method === "GET" && call.path === `/tenant/v1/areas/${OPERATING_ID}`) return json(200, { ...operating, role: "both" });
    if (call.method === "PUT") return apiError(409, "PRICING_AREA_OUTSIDE_OPERATING", "outside", { items: [{ product_id: PRODUCT_ID, product_code: "P-001", area_id: AREA_ID, outside_m2: 3_200_000 }] });
    return null;
  });
  await screen.findByRole("heading", { level: 1, name: "东京西部" });
  await screen.findByRole("group", { name: /用途/ }, { timeout: 5000 });
  await user.click(screen.getByRole("radio", { name: /^报价区域/ }));
  await user.click(screen.getByRole("button", { name: "保存" }));
  const alert = await screen.findByText("现在不能保存：已上架的商品会有地方报不出价。");
  const box = alert.closest(".alert") as HTMLElement;
  const link = await within(box).findByRole("link", { name: "商品 P-001：报价区域「东京 23 区」将有约 3.2 平方公里不在任何运营区域里" });
  assert.equal(link.getAttribute("href"), `/products/${PRODUCT_ID}/basic#areas`);
  assert.match(box.textContent ?? "", /请先补画（或启用）覆盖它们的运营区域，或先把这些商品下架/);
  assert.match(box.textContent ?? "", /你画的图形和填的内容都还在/);
});

test("列表：多一列「用途」；按用途筛选写进请求", async () => {
  const user = userEvent.setup();
  const calls = open("/areas", "admin", (call) => (call.method === "GET" && call.url.pathname === "/tenant/v1/areas" ? page([summaryOf(pricing), summaryOf(operating)]) : null));
  const row = async (name: string): Promise<HTMLElement> => (await screen.findByRole("link", { name }, { timeout: 5000 })).closest("tr") as HTMLElement;
  assert.match((await row("东京西部")).textContent ?? "", /运营区域/);
  assert.match((await row("东京 23 区")).textContent ?? "", /报价区域/);
  assert.ok(screen.getByRole("columnheader", { name: "用途" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "用途" }), "operating");
  await waitFor(() => assert.ok(calls.some((call) => call.path.startsWith("/tenant/v1/areas?") && new URL(call.path, "http://test").searchParams.get("role") === "operating")));
});

test("列表：停用运营区域被拒（PRICING_AREA_OUTSIDE_OPERATING）——对话框里列出受影响的商品和区域名称，不显示错误码", async () => {
  const user = userEvent.setup();
  const calls = open("/areas", "admin", (call) => {
    if (call.method === "GET" && call.url.pathname === "/tenant/v1/areas") return page([summaryOf(operating)]);
    if (call.method === "POST" && call.path === `/tenant/v1/areas/${OPERATING_ID}/disable`) return apiError(409, "PRICING_AREA_OUTSIDE_OPERATING", "outside", { items: [{ product_id: PRODUCT_ID, product_code: "P-001", area_id: AREA_ID, outside_m2: 450 }] });
    return null;
  });
  await user.click(await screen.findByRole("button", { name: "东京西部 的更多操作" }));
  await user.click(screen.getByRole("menuitem", { name: "停用" }));
  const dialog = await screen.findByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: "停用" }));
  await within(dialog).findByText("现在不能停用：已上架的商品会有地方报不出价。");
  await within(dialog).findByRole("link", { name: "商品 P-001：报价区域「东京 23 区」将有约 450 平方米不在任何运营区域里" });
  assert.ok(calls.some((call) => call.path === "/tenant/v1/area-map"), "区域名称从区域地图里取");
  assert.doesNotMatch(dialog.textContent ?? "", /PRICING_AREA_OUTSIDE_OPERATING/);
});

test("区域地图：每项写明用途；报价区域超出运营区域时有提醒；按用途筛选；运营区域和报价区域叠在一起不算重叠", async () => {
  const user = userEvent.setup();
  open("/areas/map", "admin");
  await screen.findByRole("heading", { name: "共 2 个区域" });
  const list = screen.getByRole("list", { name: "区域列表" });
  const itemOf = (name: string): HTMLElement => within(list).getByRole("button", { name }).closest("li") as HTMLElement;
  assert.match(itemOf("东京西部").textContent ?? "", /运营区域/);
  assert.match(itemOf("东京 23 区").textContent ?? "", /报价区域/);
  assert.match(itemOf("东京 23 区").textContent ?? "", /报价区域超出运营区域：这个报价区域有约 180 平方公里不在任何运营区域里/);
  assert.doesNotMatch(list.textContent ?? "", /重叠/, "运营区域和报价区域之间不算重叠");
  await user.selectOptions(screen.getByRole("combobox", { name: "用途" }), "operating");
  await screen.findByRole("heading", { name: "共 2 个区域，显示 1 个" });
  assertAbsent(within(list).queryByRole("button", { name: "东京 23 区" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "用途" }), "pricing");
  await screen.findByRole("heading", { name: "共 2 个区域，显示 1 个" });
  assert.ok(within(screen.getByRole("list", { name: "区域列表" })).getByRole("button", { name: "东京 23 区" }));
});

// ── 画布：假的底图（经度 × 1000 = x，纬度 × −1000 = y） ──

const TILES: MapTiles = { url_template: "http://127.0.0.1:9/{z}/{x}/{y}.png", dark_url_template: null, min_zoom: 3, max_zoom: 18, tile_size: 256, referrer_policy: "strict-origin", attribution: [{ text: "© 测试底图", href: null }] };

function fakeFactory(store: { events: SurfaceEvents | null }) {
  return (_container: HTMLElement, _tiles: MapTiles, events: SurfaceEvents): MapSurface => {
    store.events = events;
    return { project: (point) => ({ x: point.lng * 1000 - 139_000, y: 36_000 - point.lat * 1000 }), size: () => ({ x: 800, y: 600 }), fit() {}, setView() {}, zoomIn() {}, zoomOut() {}, destroy() {} };
  };
}

const ring = (area: Area) => (area.polygons[0]?.geometry.coordinates[0] ?? []).slice(0, -1);

test("画布：运营区域虚线很淡、报价区域实线；超出运营区域的部分画警告色斜线；图例写明；未覆盖需求的点圆 / 方两种，点了显示类型、原因、次数", async () => {
  const store: { events: SurfaceEvents | null } = { events: null };
  const areas: OverviewArea[] = [
    { id: OPERATING_ID, name: "东京西部", slot: 0, active: true, role: "operating", polygons: [{ id: "p1", kind: "operate", ring: ring(operating) }] },
    { id: AREA_ID, name: "东京 23 区", slot: 1, active: true, role: "pricing", polygons: [{ id: "p2", kind: "operate", ring: ring(pricing) }] },
  ];
  const demands = demandMapPoints([{ id: "d1", category: "point_to_point", reason: "NO_PRICING_AREA", repeat_count: 6, pickup: { lat: 35.7, lng: 139.75 }, dropoff: { lat: 35.65, lng: 139.65 } }]);
  const view = (layer: typeof demands | null) => (
    <AreaOverviewMap tiles={TILES} areas={areas} selected={null} onSelect={() => {}} overlaps={[]} showOverlaps focusSignal={0} marker={null} outside={[{ areaIds: [AREA_ID], ring: [[139.7, 35.6], [139.8, 35.6], [139.8, 35.8], [139.7, 35.8]] }]} demands={layer} surfaceFactory={fakeFactory(store)} />
  );
  const { container, rerender } = render(view(null));
  await waitFor(() => assert.ok(container.querySelector("[data-area]")));
  assert.match(container.querySelector(`[data-area="${OPERATING_ID}"]`)?.getAttribute("class") ?? "", /area-overview--operating/);
  assert.doesNotMatch(container.querySelector(`[data-area="${AREA_ID}"]`)?.getAttribute("class") ?? "", /area-overview--operating/);
  assert.ok(container.querySelector('[data-outside="all"] .area-hatch--outside'));
  const legend = within(screen.getByRole("list", { name: "图例" }));
  assert.ok(legend.getByText("运营区域") && legend.getByText("报价区域 / 运营 + 报价") && legend.getByText("超出运营区域"));
  assertAbsent(legend.queryByText("未覆盖需求"));
  assertAbsent(container.querySelector("[data-demand-layer]"));

  rerender(view(demands));
  assert.ok(legend.getByText("未覆盖需求"));
  assert.equal(container.querySelectorAll("circle[data-demand]").length, 1, "上车点是圆");
  assert.equal(container.querySelectorAll("rect[data-demand]").length, 1, "下车点是方");
  assert.equal(container.querySelector("circle[data-demand]")?.getAttribute("r"), "9", "6 次：最大一档");
  store.events?.onClick({ lat: 35.7, lng: 139.75 });
  const popup = await screen.findByRole("region", { name: "未覆盖需求" });
  assert.match(popup.textContent ?? "", /点对点/);
  assert.match(popup.textContent ?? "", /上车点/);
  assert.match(popup.textContent ?? "", /在运营区域里，但没有报价区域/);
  assert.match(popup.textContent ?? "", /6 次/);
  await userEvent.setup().click(within(popup).getByRole("button", { name: "关闭" }));
  assertAbsent(screen.queryByRole("region", { name: "未覆盖需求" }));
});

test("运营后台区域地图：有 demand.read 才有「显示未覆盖需求」；勾上后按最近 30 天（东京日期）取点，取不到时说怎么办；从列表带坐标过来时图层开着", async () => {
  const user = userEvent.setup();
  signIn("platform", "platform-token");
  const items: PlatformAreaMapItem[] = [pricing, operating].map((area) => ({ ...mapItem(area), tenant_id: "t1", tenant: { id: "t1", name: "甲车队", status: "active" } }));
  let fail = true;
  const meOf = (role: string) => json(200, { user: { id: "p1", email: "ops@example.com", name: "运营", role, role_name: role, status: "active", ...stamps }, permissions: [], must_change_password: false });
  const calls = stubApiWith((call) => {
    const at = call.url.pathname;
    if (at === "/platform/v1/auth/me") return meOf("operations");
    if (at === "/platform/v1/area-map") return json(200, { items, truncated: false });
    if (at === "/platform/v1/map/config") return json(200, { tiles: null });
    if (at === "/platform/v1/tenants") return json(200, { items: [], next_cursor: null });
    if (at === "/platform/v1/city-options") return json(200, { items: [] });
    if (at === "/platform/v1/uncovered-demands/points") {
      if (fail) {
        fail = false;
        return Promise.reject(new TypeError("fetch failed"));
      }
      return json(200, { from: "2026-10-12", to: "2026-11-10", items: [{ id: "d1", category: "charter", reason: "OUTSIDE_OPERATING", repeat_count: 1, pickup: { lat: 35.7, lng: 139.7 }, dropoff: null }], truncated: false });
    }
    return null;
  });
  const { unmount } = render(
    <MemoryRouter initialEntries={["/platform/areas/map"]}>
      <App />
    </MemoryRouter>,
  );
  const toggle = await screen.findByRole("checkbox", { name: "显示未覆盖需求" });
  assert.equal((toggle as HTMLInputElement).checked, false, "默认关");
  assert.ok(!calls.some((call) => call.path.includes("/points")), "关着时不取");
  await user.click(toggle);
  await screen.findByText("未覆盖需求没有加载出来，请检查网络后再勾选一次。");
  await user.click(toggle);
  await user.click(toggle);
  await screen.findByText(/1 条需求。点地图上的点看详情/);
  const pointsQuery = (): URLSearchParams => new URL(calls.filter((call) => call.path.includes("/points")).at(-1)?.path ?? "/", "http://test").searchParams;
  const from = pointsQuery().get("from") ?? "";
  const to = pointsQuery().get("to") ?? "";
  assert.equal((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000, 29, "最近 30 天（含今天）");
  await user.selectOptions(screen.getByRole("combobox", { name: "原因" }), "NO_PRICING_AREA");
  await waitFor(() => assert.equal(pointsQuery().get("reason"), "NO_PRICING_AREA"));
  unmount();

  // 从未覆盖需求列表的「在区域地图上查看」过来：图层开着
  render(
    <MemoryRouter initialEntries={["/platform/areas/map?demands=1&lat=35.7&lng=139.7"]}>
      <App />
    </MemoryRouter>,
  );
  assert.equal(((await screen.findByRole("checkbox", { name: "显示未覆盖需求" })) as HTMLInputElement).checked, true);
  unmount();

  // 没有 demand.read（风控能看区域地图、不能看未覆盖需求）：没有这个开关
  resetBrowser();
  signIn("platform", "platform-token");
  stubApiWith((call) => (call.url.pathname === "/platform/v1/auth/me" ? meOf("risk") : call.url.pathname === "/platform/v1/area-map" ? json(200, { items, truncated: false }) : call.url.pathname === "/platform/v1/map/config" ? json(200, { tiles: null }) : null));
  render(
    <MemoryRouter initialEntries={["/platform/areas/map"]}>
      <App />
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { level: 1, name: "区域地图" });
  await screen.findByRole("heading", { name: "共 2 个区域" });
  assertAbsent(screen.queryByRole("checkbox", { name: "显示未覆盖需求" }));
});
