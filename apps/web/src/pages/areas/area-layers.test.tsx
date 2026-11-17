/**
 * M9P-13（规格第四节第 3 小节、ADR 0093 第七节「后续」；#247 审查建议）的组件测试：
 * - 区域详情「在哪些商品里用」：每个商品当哪一层（①②③ / 服务区域）；
 * - 改图形时按画面现算的包车三层重叠提醒（只提醒，可以保存）；保存后接口还说有重叠时留在这一页列出来；
 * - 「从本区域减去另一个区域」：预览切掉多少，确认后换到画面上，保存时提交的是减完的图形；减不了时说原因；
 * - 区域地图按商品和层筛选：只列选中商品选中层的区域、标出层、三层重叠写清楚并标红（画布）。
 * 接口一律是测试替身，不联网。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../App.tsx";
import type { AreaMapItem } from "../../api/area-map.ts";
import type { Area, AreaCharterOverlap, MapTiles, ProductAreaLayers } from "../../api/areas.ts";
import type { MapSurface, SurfaceEvents } from "../../lib/map-surface.ts";
import { type ApiCall, assertAbsent, json, resetBrowser, signIn, stubApiWith } from "../../testing/harness.tsx";
import { AreaOverviewMap, type OverviewArea } from "./AreaOverviewMap.tsx";

afterEach(resetBrowser);

const stamps = { created_at: "2026-11-01T00:00:00.000Z", updated_at: "2026-11-08T05:30:00.000Z" };
const city = { id: "11111111-1111-4111-8111-111111111111", code: "CTY-JP-TYO", name: { zh: "东京" }, status: "active" as const, center: { lng: 139.7, lat: 35.7 }, boundary: null };
const BASE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AREA_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FAR_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CHARTER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const TRANSFER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

function square(west: number, south: number, size: number): { type: "Polygon"; coordinates: [number, number][][] } {
  return { type: "Polygon", coordinates: [[[west, south], [west + size, south], [west + size, south + size], [west, south + size], [west, south]]] };
}

function area(id: string, name: string, west: number, south: number, size = 0.2): AreaMapItem {
  return {
    id,
    name: { zh: name },
    city_id: city.id,
    city,
    biz_type: "charter",
    role: "both",
    status: "active",
    operate_polygon_count: 1,
    forbid_polygon_count: 0,
    usage: { product_count: 1, published_product_count: 0 },
    version: 3,
    shape_version: 1,
    shared_source: null,
    ...stamps,
    polygons: [{ id: `${id.slice(0, 8)}-0000-4000-8000-000000000000`, kind: "operate", seq: 1, label: null, source: "drawn", circle: null, geometry: square(west, south, size) }],
    outside_operating_m2: 0,
    last_editor: null,
  };
}

/** 东京市内（①）139.6–139.8 × 35.6–35.8；横滨（③）139.7–139.9 × 35.5–35.7：重叠 0.1° × 0.1°，约 100 平方公里；远处的箱根（②） */
const BASE = area(BASE_ID, "东京市内", 139.6, 35.6);
const YOKOHAMA = area(AREA_ID, "横滨", 139.7, 35.5);
const FAR = area(FAR_ID, "箱根", 139.0, 35.2, 0.1);
const PRODUCTS: ProductAreaLayers[] = [
  { product_id: CHARTER, code: "CH-001", title: { zh: "东京包车" }, category: "charter", status: "published", charter_layout: "three_layer", base: [BASE_ID], itinerary: [FAR_ID], pickup_dropoff: [AREA_ID] },
  { product_id: TRANSFER, code: "AT-001", title: {}, category: "airport_transfer", status: "draft", charter_layout: null, base: [AREA_ID], itinerary: [], pickup_dropoff: [] },
];

const me = (): Response => json(200, { user: { id: "u1", email: "user@supplier.example", name: "测试用户", role: "admin", status: "active", ...stamps }, tenant: { id: "t1", name: "测试用供应商", status: "active", ...stamps }, permissions: [], must_change_password: false });

type Route = (call: ApiCall & { url: URL }) => Response | Promise<Response> | null;

function open(path: string, routes: Route = () => null): ApiCall[] {
  signIn("tenant", "tenant-token");
  const calls = stubApiWith((call) => {
    const custom = routes(call);
    if (custom !== null) return custom;
    if (call.url.pathname === "/tenant/v1/auth/me") return me();
    if (call.url.pathname === "/tenant/v1/map/config") return json(200, { tiles: null });
    if (call.url.pathname === "/tenant/v1/area-map") return json(200, { items: [BASE, YOKOHAMA, FAR], truncated: false });
    if (call.url.pathname === "/tenant/v1/area-layers") return json(200, { items: PRODUCTS });
    if (call.method === "GET" && call.path === `/tenant/v1/areas/${AREA_ID}`) return json(200, YOKOHAMA);
    return null;
  });
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  return calls;
}

const usageCard = async (): Promise<HTMLElement> => (await screen.findByRole("heading", { name: "在哪些商品里用" }, { timeout: 5000 })).closest("section") as HTMLElement;

test("区域详情：列出在哪些商品里用、当哪一层（包车 ①②③，接送机是服务区域），包车商品能点到「在地图上看全部」", async () => {
  open(`/areas/${AREA_ID}`);
  const card = await usageCard();
  const list = await within(card).findByRole("list", { name: "用到这个区域的商品" });
  const rows = within(list).getAllByRole("listitem");
  assert.equal(rows.length, 2);
  assert.match(rows[0]?.textContent ?? "", /东京包车（CH-001）.*已上架.*③上下车加价/);
  assert.doesNotMatch(rows[0]?.textContent ?? "", /①基础价|②行程/);
  assert.equal(within(rows[0] as HTMLElement).getByRole("link", { name: "东京包车（CH-001）" }).getAttribute("href"), `/products/${CHARTER}`);
  assert.equal(within(rows[0] as HTMLElement).getByRole("link", { name: /在地图上看「东京包车（CH-001）」的全部区域/ }).getAttribute("href"), `/areas/map?product=${CHARTER}`);
  assert.match(rows[1]?.textContent ?? "", /未命名的接送机商品（AT-001）.*草稿.*服务区域/);
  assertAbsent(within(rows[1] as HTMLElement).queryByRole("link", { name: /在地图上看/ }));
});

test("改图形时现算三层重叠：横滨（③）和东京市内（①）重叠——提醒写明商品、另一个区域、哪两层、面积，只是提醒；减去之后提醒消失、保存提交的是减完的 L 形", async () => {
  const user = userEvent.setup();
  const calls = open(`/areas/${AREA_ID}`, (call) => (call.method === "PUT" ? json(200, { ...YOKOHAMA, version: 4, charter_layer_overlaps: [] }) : null));
  const card = await usageCard();
  const warning = await within(card).findByText(/有 1 处三层区域重叠/, {}, { timeout: 5000 });
  const box = warning.closest(".alert") as HTMLElement;
  assert.match(box.textContent ?? "", /「东京包车（CH-001）」里和「东京市内」① 基础价区域和 ③ 上下车加价区域，重叠约 100\.\d{1,2} 平方公里/);
  assert.match(box.textContent ?? "", /只是提醒，可以保存/);

  await user.click(screen.getByRole("button", { name: "从本区域减去另一个区域" }));
  const dialog = await screen.findByRole("dialog", { name: "从本区域减去另一个区域" });
  assert.equal((within(dialog).getByRole("button", { name: "减去" }) as HTMLButtonElement).disabled, true, "没选区域时不能点");
  await user.click(within(dialog).getByRole("combobox", { name: /要减去的区域/ }));
  assertAbsent(within(dialog).queryByRole("option", { name: /横滨/ }));
  await user.click(within(dialog).getByRole("option", { name: /东京市内/ }));
  const preview = within(dialog).getByText(/会切掉约 100\.\d{1,2} 平方公里；碰到的 1 块营运区换成减完的 1 块/);
  assert.match(preview.textContent ?? "", /保存后才生效；不满意可以撤销/);
  await user.click(within(dialog).getByRole("button", { name: "减去" }));
  await waitFor(() => assertAbsent(screen.queryByRole("dialog", { name: "从本区域减去另一个区域" })));
  await waitFor(() => assertAbsent(screen.queryByText(/有 1 处三层区域重叠/)));
  assert.ok(await screen.findByText(/已从本区域减去「东京市内」，切掉约 100\.\d{1,2} 平方公里。保存后生效/));

  await user.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() => assert.ok(calls.some((call) => call.method === "PUT")));
  const body = calls.find((call) => call.method === "PUT")?.body as { polygons: { kind: string; geometry: { coordinates: number[][][] } }[] };
  assert.equal(body.polygons.length, 1);
  assert.equal(body.polygons[0]?.kind, "operate");
  const ring = (body.polygons[0]?.geometry.coordinates[0] ?? []).slice(0, -1).map(([x, y]) => `${x},${y}`).sort();
  assert.deepEqual(ring, ["139.7,35.5", "139.9,35.5", "139.9,35.7", "139.8,35.7", "139.8,35.6", "139.7,35.6"].sort(), "横滨减去东京市内 = L 形");
});

test("减不了时说原因：两个区域没有重叠（箱根）→「不用减」，「减去」按钮不能点", async () => {
  const user = userEvent.setup();
  open(`/areas/${AREA_ID}`);
  await usageCard();
  await user.click(screen.getByRole("button", { name: "从本区域减去另一个区域" }));
  const dialog = await screen.findByRole("dialog", { name: "从本区域减去另一个区域" });
  await user.click(within(dialog).getByRole("combobox", { name: /要减去的区域/ }));
  await user.click(within(dialog).getByRole("option", { name: /箱根/ }));
  assert.ok(within(dialog).getByText("这两个区域没有重叠，不用减。"));
  assert.equal((within(dialog).getByRole("button", { name: "减去" }) as HTMLButtonElement).disabled, true);
});

test("保存后接口说用到它的包车商品里有三层重叠：已经保存，留在这一页列出（商品、另一个区域、面积），不再显示「有未保存的修改」", async () => {
  const user = userEvent.setup();
  const overlap: AreaCharterOverlap = { product_id: CHARTER, product_code: "CH-001", product_title: { zh: "东京包车" }, code: "AREA_BASE_SURCHARGE_OVERLAP", layer: "base_pickup_dropoff", other_area_id: BASE_ID, other_area_name: { zh: "东京市内" }, overlap_km2: 100.62 };
  const saved: Area & { charter_layer_overlaps: AreaCharterOverlap[] } = { ...YOKOHAMA, name: { zh: "横滨南" }, version: 4, charter_layer_overlaps: [overlap] };
  open(`/areas/${AREA_ID}`, (call) => (call.method === "PUT" ? json(200, saved) : null));
  await usageCard();
  const nameInput = screen.getByRole("textbox", { name: /中文/ });
  await user.clear(nameInput);
  await user.type(nameInput, "横滨南");
  await user.click(screen.getByRole("button", { name: "保存" }));
  const title = await screen.findByText("已保存。用到这个区域的包车商品里有 1 处三层区域重叠");
  const box = title.closest(".alert") as HTMLElement;
  assert.match(box.querySelector("[data-saved-overlaps]")?.textContent ?? "", /「东京包车（CH-001）」里和「东京市内」① 基础价区域和 ③ 上下车加价区域，重叠约 100\.62 平方公里/);
  assert.match(box.textContent ?? "", /从本区域减去另一个区域/);
  assert.doesNotMatch(document.querySelector(".area-editor__summary")?.textContent ?? "", /有未保存的修改/);
});

test("区域地图按商品和层筛选：只列这个商品用到的区域并标出层；三层重叠写清楚；去掉 ③ 后横滨不列、重叠提醒消失；不按商品时和以前一样", async () => {
  const user = userEvent.setup();
  open(`/areas/map?product=${CHARTER}`);
  await screen.findByRole("heading", { name: "共 3 个区域" }, { timeout: 5000 });
  const list = screen.getByRole("list", { name: "区域列表" });
  const itemOf = (name: string): HTMLElement => within(list).getByRole("button", { name }).closest("li") as HTMLElement;
  await waitFor(() => assert.match(itemOf("横滨").textContent ?? "", /③上下车加价/));
  assert.match(itemOf("东京市内").textContent ?? "", /①基础价/);
  assert.match(itemOf("箱根").textContent ?? "", /②行程/);
  assert.match(itemOf("横滨").textContent ?? "", /「东京包车（CH-001）」里和「东京市内」① 基础价区域和 ③ 上下车加价区域，重叠约 100\.\d{1,2} 平方公里/);
  assert.equal(list.querySelectorAll("[data-conflict-note]").length, 2, "两个区域各写一条");
  assert.ok(screen.getByRole("checkbox", { name: "只看有三层重叠的（2）" }));

  await user.click(screen.getByRole("checkbox", { name: "③ 上下车加价区域" }));
  await screen.findByRole("heading", { name: "共 3 个区域，显示 2 个" });
  assertAbsent(within(list).queryByRole("button", { name: "横滨" }));
  assert.equal(list.querySelectorAll("[data-conflict-note]").length, 0, "①∩③ 要①和③都选上才算");

  await user.selectOptions(screen.getByRole("combobox", { name: "商品" }), "all");
  await screen.findByRole("heading", { name: "共 3 个区域" });
  assertAbsent(screen.queryByRole("checkbox", { name: "③ 上下车加价区域" }));
  assert.equal(document.querySelectorAll("[data-conflict-note]").length, 0);
  assert.match(itemOf("横滨").textContent ?? "", /与「东京市内」重叠/, "不按商品时照旧按一般的重叠提醒");
});

const TILES: MapTiles = { url_template: "http://127.0.0.1:9/{z}/{x}/{y}.png", dark_url_template: null, min_zoom: 3, max_zoom: 18, tile_size: 256, referrer_policy: "strict-origin", attribution: [{ text: "© 测试底图", href: null }] };
const surface = (_container: HTMLElement, _tiles: MapTiles, _events: SurfaceEvents): MapSurface => ({ project: (point) => ({ x: point.lng * 1000 - 139_000, y: 36_000 - point.lat * 1000 }), size: () => ({ x: 800, y: 600 }), fit() {}, setView() {}, zoomIn() {}, zoomOut() {}, destroy() {} });

test("画布：三层重叠标红（危险色，选中时更深），图例写「三层区域重叠」；不给时不画、不列", async () => {
  const areas: OverviewArea[] = [
    { id: BASE_ID, name: "东京市内", slot: 0, active: true, role: "both", polygons: [{ id: "p1", kind: "operate", ring: [[139.6, 35.6], [139.8, 35.6], [139.8, 35.8], [139.6, 35.8]] }] },
    { id: AREA_ID, name: "横滨", slot: 1, active: true, role: "both", polygons: [{ id: "p2", kind: "operate", ring: [[139.7, 35.5], [139.9, 35.5], [139.9, 35.7], [139.7, 35.7]] }] },
  ];
  const conflict = { areaIds: [BASE_ID, AREA_ID], ring: [[139.7, 35.6], [139.8, 35.6], [139.8, 35.7], [139.7, 35.7]] as [number, number][] };
  const view = (conflicts: (typeof conflict)[] | null, selected: string | null) => <AreaOverviewMap tiles={TILES} areas={areas} selected={selected} onSelect={() => {}} overlaps={[]} showOverlaps={false} focusSignal={0} marker={null} conflicts={conflicts} surfaceFactory={surface} />;
  const { container, rerender } = render(view([conflict], null));
  await waitFor(() => assert.ok(container.querySelector('[data-conflict="all"]')));
  assert.equal(container.querySelector('[data-conflict="all"]')?.getAttribute("class"), "area-conflict");
  assert.equal(container.querySelector('[data-conflict="all"]')?.getAttribute("d"), "M700.0,400.0L800.0,400.0L800.0,300.0L700.0,300.0Z");
  assertAbsent(container.querySelector('[data-conflict="selected"]'));
  assert.ok(within(screen.getByRole("list", { name: "图例" })).getByText("三层区域重叠"));
  rerender(view([conflict], AREA_ID));
  assert.ok(container.querySelector('[data-conflict="selected"].area-conflict--selected'));
  rerender(view(null, null));
  assertAbsent(container.querySelector("[data-conflict]"));
  assertAbsent(within(screen.getByRole("list", { name: "图例" })).queryByText("三层区域重叠"));
});
