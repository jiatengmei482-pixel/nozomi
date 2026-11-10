/**
 * 区域地图（M8-18）的组件测试：供应商后台的列表、重叠、筛选、四种状态、导出、导入（交给编辑器的「粘贴坐标」），
 * 运营后台的只读和筛选；地图画布用一个假的底图（`MapSurface` 的测试替身：经纬度直接线性换成像素），测「点地图选中」和「选中后移过去」；
 * 「在地图上查看」对话框。接口一律是测试替身，不联网。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../App.tsx";
import type { AreaMapItem, PlatformAreaMapItem } from "../../api/area-map.ts";
import type { MapTiles } from "../../api/areas.ts";
import type { LatLngBox, MapSurface, SurfaceEvents } from "../../lib/map-surface.ts";
import { type ApiCall, deferred, json, resetBrowser, signIn, stubApiWith } from "../../testing/harness.tsx";
import { PortalSession } from "../../auth/PortalSession.tsx";
import { AreaMapButton, AreaMapDialog } from "./AreaMapDialog.tsx";
import { AreaOverviewMap, type OverviewArea, areasAt } from "./AreaOverviewMap.tsx";

afterEach(resetBrowser);

const stamps = { created_at: "2026-11-01T00:00:00.000Z", updated_at: "2026-11-08T05:30:00.000Z" };
const city = { id: "11111111-1111-4111-8111-111111111111", code: "CTY-JP-TYO", name: { zh: "东京" }, status: "active" as const, center: { lng: 139.7, lat: 35.7 }, boundary: null };
const ID = { a: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", b: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", c: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" };

function square(lng: number, lat: number, size: number): { type: "Polygon"; coordinates: [number, number][][] } {
  return { type: "Polygon", coordinates: [[[lng, lat], [lng + size, lat], [lng + size, lat + size], [lng, lat + size], [lng, lat]]] };
}

function area(id: string, name: string, lng: number, lat: number, extra: Partial<AreaMapItem> = {}): AreaMapItem {
  return {
    id,
    name: { zh: name },
    city_id: city.id,
    city,
    biz_type: "general",
    status: "active",
    operate_polygon_count: 1,
    forbid_polygon_count: 0,
    usage: { product_count: 0, published_product_count: 0 },
    version: 1,
    ...stamps,
    polygons: [{ id: `${id.slice(0, 8)}-0000-4000-8000-000000000000`, kind: "operate", seq: 1, label: null, source: "drawn", circle: null, geometry: square(lng, lat, 0.02) }],
    last_editor: { type: "tenant_user", name: "佐藤", at: stamps.updated_at },
    ...extra,
  };
}

// 甲、乙重叠；丙在远处
const AREAS = [area(ID.a, "东京 23 区", 139.6, 35.6), area(ID.b, "新宿周边", 139.61, 35.61), area(ID.c, "成田机场", 140.3, 35.7)];

const tenantMe = (role: string) => json(200, { user: { id: "u1", email: "user@supplier.example", name: "测试用户", role, status: "active", ...stamps }, tenant: { id: "t1", name: "测试用供应商", status: "active", ...stamps }, permissions: [], must_change_password: false });

type Route = (call: ApiCall & { url: URL }) => Response | Promise<Response> | null;

function openTenant(path: string, role: string, routes: Route = () => null): ApiCall[] {
  signIn("tenant", "tenant-token");
  const calls = stubApiWith((call) => {
    const custom = routes(call);
    if (custom !== null) return custom;
    if (call.url.pathname === "/tenant/v1/auth/me") return tenantMe(role);
    if (call.url.pathname === "/tenant/v1/area-map") return json(200, { items: AREAS, truncated: false });
    if (call.url.pathname === "/tenant/v1/map/config") return json(200, { tiles: null });
    if (call.url.pathname === "/tenant/v1/master/cities") return json(200, { items: [], next_cursor: null, total: 0 });
    return null;
  });
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  return calls;
}

const list = (): HTMLElement => screen.getByRole("list", { name: "区域列表" });

test("供应商后台：列出全部区域、形状、最近修改人；重叠的两个各自写明和谁重叠，不重叠的没有", async () => {
  openTenant("/areas/map", "admin");
  assert.ok(await screen.findByRole("heading", { level: 1, name: "区域地图" }));
  assert.ok(await screen.findByRole("heading", { name: "共 3 个区域" }));
  const items = within(list()).getAllByRole("listitem");
  assert.equal(items.length, 3);
  assert.match(items[0]?.textContent ?? "", /多边形 · 4 个点/);
  assert.match(items[0]?.textContent ?? "", /佐藤 · 最近修改/);
  assert.match(items[0]?.textContent ?? "", /与「新宿周边」重叠/);
  assert.match(items[1]?.textContent ?? "", /与「东京 23 区」重叠/);
  assert.doesNotMatch(items[2]?.textContent ?? "", /重叠/);
  // 底图没有配置：地图的位置是一句说明，列表照常
  assert.ok(screen.getByText(/这个环境没有配置地图底图。/));
  assert.ok(screen.getByRole("link", { name: /添加区域/ }));
  assert.ok(screen.getByRole("button", { name: /拖放 .geojson 文件到这里，或点击导入/ }));
});

test("筛选：只看有重叠的、按名称搜索；选中后出现「编辑」「导出这个区域」「更多」", async () => {
  const user = userEvent.setup();
  openTenant("/areas/map", "admin");
  await screen.findByRole("heading", { name: "共 3 个区域" });
  await user.click(screen.getByRole("checkbox", { name: /只看有重叠的（2）/ }));
  assert.equal(within(list()).getAllByRole("listitem").length, 2);
  assert.ok(screen.getByRole("heading", { name: "共 3 个区域，显示 2 个" }));
  await user.click(screen.getByRole("checkbox", { name: /只看有重叠的/ }));
  await user.type(screen.getByRole("searchbox", { name: "按名称搜索" }), "成田");
  assert.equal(within(list()).getAllByRole("listitem").length, 1);
  await user.click(within(list()).getByRole("button", { name: "成田机场" }));
  assert.equal(within(list()).getByRole("button", { name: "成田机场" }).getAttribute("aria-pressed"), "true");
  const edit = within(list()).getByRole("link", { name: "编辑 成田机场" });
  assert.equal(edit.getAttribute("href"), `/areas/${ID.c}`);
  assert.ok(within(list()).getByRole("button", { name: "导出这个区域" }));
  assert.ok(within(list()).getByRole("button", { name: "成田机场 的更多操作" }));
  await user.clear(screen.getByRole("searchbox", { name: "按名称搜索" }));
  await user.type(screen.getByRole("searchbox", { name: "按名称搜索" }), "没有这个");
  assert.ok(screen.getByText("没有符合条件的区域"));
});

test("四种状态：加载中、出错（重试）、还没有区域（能改的人有「添加区域」）", async () => {
  const user = userEvent.setup();
  const pending = deferred();
  let failing = true;
  openTenant("/areas/map", "admin", (call) => {
    if (call.url.pathname !== "/tenant/v1/area-map") return null;
    if (failing) {
      failing = false;
      return pending.promise;
    }
    return json(200, { items: [], truncated: false });
  });
  assert.ok(await screen.findByText("区域加载中"));
  pending.resolve(json(500, { error: { code: "INTERNAL", message: "x" } }));
  assert.ok(await screen.findByText("加载失败"));
  await user.click(screen.getByRole("button", { name: "重试" }));
  assert.ok(await screen.findByText("还没有区域"));
  assert.equal(screen.getAllByRole("link", { name: /添加区域/ }).length, 2);
  assert.equal((screen.getByRole("button", { name: "导出 GeoJSON" }) as HTMLButtonElement).disabled, true);
});

test("只读角色：能看、能导出；没有「添加区域」、没有导入，选中后是「查看」；调度看不了", async () => {
  const user = userEvent.setup();
  openTenant("/areas/map", "readonly");
  await screen.findByRole("heading", { name: "共 3 个区域" });
  assert.equal(screen.queryByRole("link", { name: /添加区域/ }), null);
  assert.equal(screen.queryByRole("button", { name: /拖放/ }), null);
  await user.click(within(list()).getByRole("button", { name: "东京 23 区" }));
  assert.ok(within(list()).getByRole("link", { name: "查看 东京 23 区" }));
  assert.equal(within(list()).queryByRole("button", { name: /更多操作/ }), null);
  resetBrowser();
  openTenant("/areas/map", "dispatch");
  assert.ok(await screen.findByText("你没有权限查看这里"));
});

test("导出 GeoJSON：全部显示中的区域，一块图形一个要素；文件名按日期", async () => {
  const user = userEvent.setup();
  const saved: { blob: Blob; name: string }[] = [];
  const created = URL.createObjectURL;
  let lastBlob: Blob | null = null;
  URL.createObjectURL = (blob: Blob) => {
    lastBlob = blob;
    return "blob:test";
  };
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    if (lastBlob) saved.push({ blob: lastBlob, name: this.download });
  };
  try {
    openTenant("/areas/map", "admin");
    await screen.findByRole("heading", { name: "共 3 个区域" });
    await user.click(screen.getByRole("button", { name: "导出 GeoJSON" }));
    assert.equal(saved.length, 1);
    assert.match(saved[0]?.name ?? "", /^区域地图-\d{4}-\d{2}-\d{2}\.geojson$/);
    const parsed = JSON.parse(await (saved[0] as { blob: Blob }).blob.text());
    assert.equal(parsed.features.length, 3);
    assert.deepEqual(parsed.features.map((feature: { properties: { area_name: string } }) => feature.properties.area_name), ["东京 23 区", "新宿周边", "成田机场"]);
    assert.ok(await screen.findByText(/已导出 3 个区域/));
  } finally {
    URL.createObjectURL = created;
    HTMLAnchorElement.prototype.click = click;
  }
});

test("导入：不是 .geojson、一个文件几个区域时就地说明；合格的文件进新增区域页，内容已经在「粘贴坐标」里", async () => {
  const user = userEvent.setup({ applyAccept: false });
  openTenant("/areas/map", "admin");
  await screen.findByRole("heading", { name: "共 3 个区域" });
  const input = document.querySelector<HTMLInputElement>('input[type="file"]') as HTMLInputElement;
  await user.upload(input, new File(["<kml/>"], "区域.kml", { type: "application/xml" }));
  assert.ok(await screen.findByText("只能导入 .geojson 或 .json 文件。"));
  const two = JSON.stringify({ type: "FeatureCollection", features: [ID.a, ID.b].map((id) => ({ type: "Feature", properties: { area_id: id, kind: "operate" }, geometry: square(139.6, 35.6, 0.01) })) });
  await user.upload(input, new File([two], "两个.geojson", { type: "application/geo+json" }));
  assert.ok(await screen.findByText(/这个文件里有 2 个区域/));
  const one = JSON.stringify({ type: "Feature", properties: {}, geometry: square(139.6, 35.6, 0.01) });
  // 拖放和点击走同一条路：这里用拖放
  fireEvent.drop(screen.getByRole("button", { name: /拖放 .geojson 文件到这里/ }), { dataTransfer: { files: [new File([one], "一个.geojson")] } });
  const dialog = await screen.findByRole("dialog", { name: "粘贴坐标" });
  assert.ok(await screen.findByRole("heading", { level: 1, name: "新增区域" }));
  assert.equal((within(dialog).getByRole("textbox") as HTMLTextAreaElement).value, one);
  assert.ok(await within(dialog).findByText(/识别为 GeoJSON：1 个多边形/));
});

test("运营后台：全部供应商、只读（没有添加、导入、编辑），按供应商筛选时带 tenant_id", async () => {
  const user = userEvent.setup();
  signIn("platform", "platform-token");
  const platformItems: PlatformAreaMapItem[] = AREAS.map((item, index) => ({ ...item, tenant_id: index === 2 ? "t2" : "t1", tenant: { id: index === 2 ? "t2" : "t1", name: index === 2 ? "乙车队" : "甲车队", status: "active" } }));
  const calls = stubApiWith((call) => {
    const at = call.url.pathname;
    if (at === "/platform/v1/auth/me") return json(200, { user: { id: "p1", email: "ops@example.com", name: "运营", role: "super_admin", role_name: "超级管理员", status: "active", ...stamps }, permissions: [], must_change_password: false });
    if (at === "/platform/v1/area-map") return json(200, { items: call.url.searchParams.get("tenant_id") === "t2" ? platformItems.slice(2) : platformItems, truncated: false });
    if (at === "/platform/v1/map/config") return json(200, { tiles: null });
    if (at === "/platform/v1/tenants") return json(200, { items: [{ id: "t1", name: "甲车队", status: "active" }, { id: "t2", name: "乙车队", status: "active" }], next_cursor: null });
    if (at === "/platform/v1/city-options") return json(200, { items: [{ ...city, country_code: "JP", timezone: "Asia/Tokyo", status: "active" }] });
    return null;
  });
  render(
    <MemoryRouter initialEntries={["/platform/areas/map"]}>
      <App />
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { name: "共 3 个区域" });
  assert.ok(screen.getByText("这里只能查看。区域由供应商在自己的后台维护。"));
  assert.match(within(list()).getAllByRole("listitem")[2]?.textContent ?? "", /乙车队/);
  assert.equal(screen.queryByRole("link", { name: /添加区域/ }), null);
  assert.equal(screen.queryByRole("button", { name: /拖放/ }), null);
  await user.click(within(list()).getByRole("button", { name: "东京 23 区" }));
  assert.equal(within(list()).queryByRole("link", { name: /编辑/ }), null);
  assert.ok(screen.getByRole("link", { name: "区域地图" }), "菜单里有「区域地图」");
  await user.click(screen.getByRole("combobox", { name: /供应商/ }));
  await user.click(await screen.findByRole("option", { name: /乙车队/ }));
  await waitFor(() => assert.ok(calls.some((call) => call.path.endsWith("/platform/v1/area-map?tenant_id=t2"))));
  assert.ok(await screen.findByRole("heading", { name: "共 1 个区域" }));
});

test("定位：输入坐标放一个标记；按名称查平台的地点", async () => {
  const user = userEvent.setup();
  const calls = openTenant("/areas/map", "admin", (call) => (call.url.pathname === "/tenant/v1/master/places" ? json(200, { items: [{ id: "p1", code: "NRT", name: { zh: "成田国际机场" }, location: { lat: 35.77, lng: 140.39 } }], next_cursor: null, total: 1 }) : null));
  await screen.findByRole("heading", { name: "共 3 个区域" });
  const box = screen.getByRole("searchbox", { name: "搜索机场、车站、地标，或输入坐标" });
  await user.type(box, "成田");
  await user.click(screen.getByRole("button", { name: "定位" }));
  assert.ok(await screen.findByRole("button", { name: "成田国际机场（NRT）" }));
  assert.ok(calls.some((call) => call.path.includes("/tenant/v1/master/places?") && call.path.includes("q=%E6%88%90%E7%94%B0")));
  await user.clear(box);
  await user.type(box, "不存在的地方");
  await user.click(screen.getByRole("button", { name: "定位" }));
  await waitFor(() => assert.ok(screen.queryByRole("button", { name: "成田国际机场（NRT）" }) !== null || screen.queryByText(/没有匹配的地点/) !== null));
});

// ── 画布：假的底图（经度 × 1000 = x，纬度 × −1000 = y） ──

interface FakeSurface extends MapSurface {
  events: SurfaceEvents;
  fits: LatLngBox[];
}

function fakeFactory(store: { surface: FakeSurface | null }) {
  return (_container: HTMLElement, _tiles: MapTiles, events: SurfaceEvents): MapSurface => {
    const surface: FakeSurface = {
      events,
      fits: [],
      project: (point) => ({ x: point.lng * 1000, y: -point.lat * 1000 }),
      size: () => ({ x: 800, y: 600 }),
      fit(box) {
        surface.fits.push(box);
      },
      setView() {},
      zoomIn() {},
      zoomOut() {},
      destroy() {},
    };
    store.surface = surface;
    return surface;
  };
}

const TILES: MapTiles = { url_template: "http://127.0.0.1:9/{z}/{x}/{y}.png", dark_url_template: null, min_zoom: 3, max_zoom: 18, tile_size: 256, referrer_policy: "strict-origin", attribution: [{ text: "© 测试底图", href: null }] };

function overviewAreas(): OverviewArea[] {
  return AREAS.map((item, index) => ({ id: item.id, name: item.name.zh ?? "", slot: index, active: true, polygons: item.polygons.map((polygon) => ({ id: polygon.id, kind: polygon.kind, ring: (polygon.geometry.coordinates[0] ?? []).slice(0, -1) })) }));
}

test("画布：点在区域里 = 选中它；叠在一起的地方先选小的、再点轮到下一个；点空白取消选中；选中后视野移过去", async () => {
  const store: { surface: FakeSurface | null } = { surface: null };
  const picked: (string | null)[] = [];
  const factory = fakeFactory(store);
  const view = (selected: string | null, focusSignal: number) => (
    <AreaOverviewMap tiles={TILES} areas={overviewAreas()} selected={selected} onSelect={(id) => picked.push(id)} overlaps={[{ areaIds: [ID.a, ID.b], ring: [[139.61, 35.61], [139.62, 35.61], [139.62, 35.62], [139.61, 35.62]] }]} showOverlaps focusSignal={focusSignal} marker={null} surfaceFactory={factory} />
  );
  const { rerender, container } = render(view(null, 0));
  await waitFor(() => assert.ok(container.querySelector("path.area-overlap")));
  assert.equal(store.surface?.fits.length, 1, "打开时把全部区域放进视野");
  store.surface?.events.onClick({ lat: 35.605, lng: 139.605 });
  assert.deepEqual(picked, [ID.a]);
  rerender(view(ID.a, 0));
  store.surface?.events.onClick({ lat: 35.615, lng: 139.615 });
  assert.equal(picked.at(-1), ID.b, "重叠处：甲已选中，再点轮到乙");
  store.surface?.events.onClick({ lat: 10, lng: 10 });
  assert.equal(picked.at(-1), null);
  rerender(view(ID.c, 1));
  const box = store.surface?.fits.at(-1);
  assert.deepEqual(box?.flat().map((value) => Math.round(value * 1e6) / 1e6), [35.7, 140.3, 35.72, 140.32], "选中丙后视野移到丙");
  assert.ok(container.querySelector('path[data-overlap="selected"]') === null, "丙没有重叠：不加深");
  rerender(view(ID.a, 2));
  assert.ok(container.querySelector('path[data-overlap="selected"]'), "选中甲：它的重叠部分加深");
  assert.ok(within(container).getByRole("list", { name: "图例" }).textContent?.includes("重叠的地方"));
  assert.deepEqual(areasAt(overviewAreas(), { lat: 35.615, lng: 139.615 }), [ID.a, ID.b]);
});

test("「在地图上查看」对话框：只画选中的区域，写明重叠；删掉了的不显示；底图取不到时只列区域", async () => {
  const user = userEvent.setup();
  signIn("tenant", "tenant-token");
  let tiles: MapTiles | null | "fail" = null;
  stubApiWith((call) => {
    if (call.url.pathname === "/tenant/v1/auth/me") return tenantMe("pricing");
    if (call.url.pathname === "/tenant/v1/area-map") return json(200, { items: AREAS, truncated: false });
    if (call.url.pathname === "/tenant/v1/map/config") return tiles === "fail" ? Promise.reject(new TypeError("fetch failed")) : json(200, { tiles });
    return null;
  });
  const store: { surface: FakeSurface | null } = { surface: null };
  const factory = fakeFactory(store);
  const closed: boolean[] = [];
  const view = (ids: readonly string[]) => (
    <PortalSession portal="tenant">
      <AreaMapDialog open areaIds={ids} onClose={() => closed.push(true)} surfaceFactory={factory} />
    </PortalSession>
  );
  const { unmount } = render(<MemoryRouter>{view([ID.a, ID.b, "dddddddd-dddd-4ddd-8ddd-dddddddddddd"])}</MemoryRouter>);
  const dialog = await screen.findByRole("dialog", { name: "在地图上查看" });
  const items = await within(dialog).findAllByRole("listitem");
  assert.equal(items.length, 2);
  assert.match(items[0]?.textContent ?? "", /与「新宿周边」重叠/);
  assert.ok(within(dialog).getByText("另有 1 个区域已经被删除，不显示。"));
  assert.ok(within(dialog).getByText(/这个环境没有配置地图底图。/));
  await user.click(within(dialog).getByRole("button", { name: "关闭" }));
  assert.deepEqual(closed, [true]);
  unmount();

  tiles = TILES;
  const second = render(<MemoryRouter>{view([ID.c])}</MemoryRouter>);
  await waitFor(() => assert.ok(second.baseElement.querySelector('[data-area="' + ID.c + '"]')));
  assert.equal(second.baseElement.querySelectorAll("[data-area]").length, 1, "只画选中的那一个");
  second.rerender(<MemoryRouter>{view([])}</MemoryRouter>);
  assert.ok(await screen.findByText("还没有选区域。"));
  second.unmount();

  tiles = "fail";
  render(<MemoryRouter>{view([ID.a])}</MemoryRouter>);
  assert.ok(await screen.findByText(/地图没有加载出来。区域和重叠照常列在上面。/));
});

test("「在地图上查看」按钮：没有区域时不可点；点了打开对话框，打开时才取区域", async () => {
  const user = userEvent.setup();
  signIn("tenant", "tenant-token");
  const calls = stubApiWith((call) => {
    if (call.url.pathname === "/tenant/v1/auth/me") return tenantMe("admin");
    if (call.url.pathname === "/tenant/v1/area-map") return json(200, { items: AREAS, truncated: false });
    if (call.url.pathname === "/tenant/v1/map/config") return json(200, { tiles: null });
    return null;
  });
  const { rerender } = render(
    <MemoryRouter>
      <PortalSession portal="tenant">
        <AreaMapButton areaIds={[]} />
      </PortalSession>
    </MemoryRouter>,
  );
  assert.equal((screen.getByRole("button", { name: "在地图上查看" }) as HTMLButtonElement).disabled, true);
  rerender(
    <MemoryRouter>
      <PortalSession portal="tenant">
        <AreaMapButton areaIds={[ID.a]} />
      </PortalSession>
    </MemoryRouter>,
  );
  assert.ok(!calls.some((call) => call.path.startsWith("/tenant/v1/area-map")), "没打开前不取");
  await user.click(screen.getByRole("button", { name: "在地图上查看" }));
  const dialog = await screen.findByRole("dialog", { name: "在地图上查看" });
  assert.ok(await within(dialog).findByText("东京 23 区"));
});
