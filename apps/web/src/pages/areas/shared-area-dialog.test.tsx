/**
 * 「从共享库引用」对话框（M8-31，M8-46 补地图预览）的组件测试：城市组合框（显示名同其他选城市的地方，任意语言的名称都能搜到）、
 * 列表里名称和块数分开、「看形状」展开地图（一次一个）、选定后确认步骤也画形状、引用；预览的加载失败 / 已不在库里 / 没有底图。
 * 接口一律是测试替身；地图画布用假的底图（经纬度直接线性换成像素），不联网。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import type { Area, MapTiles, SharedArea, SharedAreaDetail } from "../../api/areas.ts";
import type { City } from "../../api/master.ts";
import { PortalSession } from "../../auth/PortalSession.tsx";
import type { MapSurface, SurfaceEvents } from "../../lib/map-surface.ts";
import { type ApiCall, apiError, json, resetBrowser, signIn, stubApiWith } from "../../testing/harness.tsx";
import { SharedAreaDialog } from "./SharedAreaDialog.tsx";
import { sharedAreaPieces } from "./SharedAreaPreview.tsx";

afterEach(resetBrowser);

const stamps = { created_at: "2026-11-01T00:00:00.000Z", updated_at: "2026-11-08T05:30:00.000Z" };
const TOKYO = "11111111-1111-4111-8111-111111111111";
const YAMAGUCHI = "22222222-2222-4222-8222-222222222222";
const ID = { a: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", b: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };

const city = (id: string, code: string, name: City["name"], status: City["status"] = "active"): City => ({ id, code, country_code: "JP", name, timezone: "Asia/Tokyo", center: { lng: 139.7, lat: 35.7 }, boundary: null, status, version: 1, ...stamps });
const CITIES: City[] = [
  city(TOKYO, "CTY-JP-TYO", { zh: "东京", ja: "東京都", en: "Tokyo" }),
  city(YAMAGUCHI, "CTY-JP-YGC", { en: "Yamaguchi", ja: "山口市" }),
  city("33333333-3333-4333-8333-333333333333", "CTY-JP-OLD", { zh: "停用的城市" }, "disabled"),
];

const shared = (id: string, name: string, forbid = 0): SharedArea => ({ id, city_id: TOKYO, name: { zh: name }, shape_version: 1, operate_polygon_count: 1, forbid_polygon_count: forbid, updated_at: stamps.updated_at });
const ring = (lng: number, lat: number, size: number): [number, number][] => [[lng, lat], [lng + size, lat], [lng + size, lat + size], [lng, lat + size], [lng, lat]];
const detailOf = (item: SharedArea): SharedAreaDetail => ({
  ...item,
  polygons: [
    { kind: "operate", geometry: { type: "Polygon", coordinates: [ring(139.6, 35.6, 0.1)] } },
    ...(item.forbid_polygon_count > 0 ? [{ kind: "forbid" as const, geometry: { type: "Polygon" as const, coordinates: [ring(139.62, 35.62, 0.02)] } }] : []),
  ],
});
const KAMAKURA = shared(ID.a, "镰仓·通用", 1);
const GINZA = shared(ID.b, "银座一带");

const TILES: MapTiles = { url_template: "http://127.0.0.1:9/{z}/{x}/{y}.png", dark_url_template: null, min_zoom: 3, max_zoom: 18, tile_size: 256, referrer_policy: "strict-origin", attribution: [{ text: "© 测试底图", href: null }] };

function fakeFactory(fits: unknown[]) {
  return (_container: HTMLElement, _tiles: MapTiles, _events: SurfaceEvents): MapSurface => ({
    project: (point) => ({ x: point.lng * 1000, y: -point.lat * 1000 }),
    size: () => ({ x: 800, y: 600 }),
    fit(box) {
      fits.push(box);
    },
    setView() {},
    zoomIn() {},
    zoomOut() {},
    destroy() {},
  });
}

type Route = (call: ApiCall & { url: URL }) => Response | Promise<Response> | null;

function setup(options: { tiles?: MapTiles | null; routes?: Route; cities?: City[] | null; citiesFailed?: boolean; initial?: { cityId: string; picked?: SharedArea | null } } = {}) {
  signIn("tenant", "tenant-token");
  const calls = stubApiWith((call) => {
    const custom = options.routes?.(call) ?? null;
    if (custom !== null) return custom;
    if (call.url.pathname === "/tenant/v1/map/config") return json(200, { tiles: options.tiles === undefined ? TILES : options.tiles });
    if (call.url.pathname === "/tenant/v1/shared-areas") return json(200, { items: [KAMAKURA, GINZA], truncated: false });
    const detail = /^\/tenant\/v1\/shared-areas\/([0-9a-f-]+)$/.exec(call.url.pathname);
    if (detail) {
      const found = [KAMAKURA, GINZA].find((item) => item.id === detail[1]);
      return found ? json(200, detailOf(found)) : apiError(404, "NOT_FOUND", "共享区域不存在");
    }
    return null;
  });
  const fits: unknown[] = [];
  const created: Area[] = [];
  render(
    <MemoryRouter>
      <PortalSession portal="tenant">
        <SharedAreaDialog open cities={options.cities === undefined ? CITIES : options.cities} citiesFailed={options.citiesFailed ?? false} {...(options.initial ? { initial: options.initial } : {})} onClose={() => undefined} onCreated={(area) => created.push(area)} surfaceFactory={fakeFactory(fits)} />
      </PortalSession>
    </MemoryRouter>,
  );
  return { calls, fits, created, dialog: screen.getByRole("dialog", { name: "从共享库引用区域" }) };
}

async function searchTokyo(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement): Promise<HTMLElement> {
  await user.click(within(dialog).getByRole("combobox", { name: /城市/ }));
  await user.click(await screen.findByRole("option", { name: /东京/ }));
  await user.click(within(dialog).getByRole("button", { name: "查询共享库" }));
  return within(dialog).findByRole("list", { name: "共享区域" });
}

test("城市：组合框，只有启用中的城市；显示名同其他选城市的地方（中文 → 英语 → 日语），用日文名也能搜到", async () => {
  const user = userEvent.setup();
  const { dialog } = setup();
  const box = within(dialog).getByRole("combobox", { name: /城市/ });
  await user.click(box);
  const options = await screen.findAllByRole("option");
  assert.deepEqual(
    options.map((option) => option.textContent),
    ["东京CTY-JP-TYO", "YamaguchiCTY-JP-YGC"],
  );
  await user.type(box, "山口");
  const filtered = await screen.findAllByRole("option");
  assert.equal(filtered.length, 1);
  assert.match(filtered[0]?.textContent ?? "", /Yamaguchi/);
  assert.equal(document.querySelector("select"), null, "没有原生下拉");
});

test("城市没有取回来：城市框说加载失败，不一直转圈", async () => {
  const user = userEvent.setup();
  const { dialog } = setup({ cities: null, citiesFailed: true });
  await user.click(within(dialog).getByRole("combobox", { name: /城市/ }));
  assert.ok(await within(dialog).findByText(/加载失败/));
});

test("列表：名称和块数分开两行；「看形状」展开地图（一次一个），画出营运区和禁行区，视野放到这个区域", async () => {
  const user = userEvent.setup();
  const { dialog, calls, fits } = setup();
  const list = await searchTokyo(user, dialog);
  const items = within(list).getAllByRole("listitem");
  assert.equal(items.length, 2);
  const first = items[0] as HTMLElement;
  assert.equal(first.querySelector(".shared-area__name")?.textContent, "镰仓·通用");
  assert.equal(first.querySelector(".shared-area__pieces")?.textContent, "营运区 1 块 · 禁行区 1 块");
  assert.equal((items[1] as HTMLElement).querySelector(".shared-area__pieces")?.textContent, "营运区 1 块");

  const look = within(first).getByRole("button", { name: "看「镰仓·通用」的形状" });
  assert.equal(look.getAttribute("aria-expanded"), "false");
  await user.click(look);
  const collapse = within(first).getByRole("button", { name: "收起「镰仓·通用」的形状" });
  assert.equal(collapse.getAttribute("aria-expanded"), "true");
  const panel = document.getElementById(collapse.getAttribute("aria-controls") ?? "");
  assert.ok(panel && first.contains(panel), "地图在这一项下面");
  await waitFor(() => assert.ok(panel.querySelector(`[data-area="${ID.a}"]`)));
  assert.ok(calls.some((call) => call.method === "GET" && call.path === `/tenant/v1/shared-areas/${ID.a}`));
  assert.equal(panel.querySelectorAll("[data-area] .area-stroke--forbid").length, 1, "禁行区照编辑页的画法");
  assert.ok(within(panel).getByRole("application", { name: /「镰仓·通用」的形状/ }));
  assert.equal(fits.length, 1, "打开时把这个区域放进视野");

  await user.click(within(items[1] as HTMLElement).getByRole("button", { name: "看「银座一带」的形状" }));
  await waitFor(() => assert.ok(document.querySelector(`[data-area="${ID.b}"]`)));
  assert.equal(document.querySelector(`[data-area="${ID.a}"]`), null, "一次只展开一个");
  assert.equal(within(first).getByRole("button", { name: "看「镰仓·通用」的形状" }).getAttribute("aria-expanded"), "false");
  await user.click(within(items[1] as HTMLElement).getByRole("button", { name: "收起「银座一带」的形状" }));
  assert.equal(document.querySelector("[data-area]"), null);
});

test("选定后：确认步骤画出形状；引用提交 from-shared，名称不改时不传名称", async () => {
  const user = userEvent.setup();
  const copy = { ...detailOf(KAMAKURA), id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", shared_source: { shared_area_id: ID.a, shape_version: 1, latest_shape_version: 1 } } as unknown as Area;
  const { dialog, calls, created } = setup({ routes: (call) => (call.method === "POST" && call.path === "/tenant/v1/areas/from-shared" ? json(201, copy) : null) });
  const list = await searchTokyo(user, dialog);
  await user.click(within(list).getByRole("button", { name: "引用「镰仓·通用」" }));
  assert.match(dialog.textContent ?? "", /引用「镰仓·通用」（营运区 1 块 · 禁行区 1 块）/);
  await waitFor(() => assert.ok(dialog.querySelector(`[data-area="${ID.a}"]`), "确认前看得到形状"));
  await user.click(within(dialog).getByRole("button", { name: "引用到我的区域" }));
  await waitFor(() => assert.equal(created.length, 1));
  const post = calls.find((call) => call.method === "POST");
  assert.deepEqual(post?.body, { shared_area_id: ID.a, name: null, biz_type: "general", role: "both" });
});

test("从新建页的相似提示进来：直接到确认步骤，形状照样画出来", async () => {
  const { dialog } = setup({ initial: { cityId: TOKYO, picked: GINZA } });
  await waitFor(() => assert.ok(dialog.querySelector(`[data-area="${ID.b}"]`)));
  assert.ok(within(dialog).getByRole("button", { name: "换一个" }));
});

test("预览：没有配置底图时说明看不到形状、写出块数；形状取不到时可以重试；已不在库里时说换一个", async () => {
  const user = userEvent.setup();
  let failDetail = true;
  const { dialog } = setup({
    tiles: null,
    routes: (call) => {
      if (call.url.pathname === `/tenant/v1/shared-areas/${ID.b}` && failDetail) return Promise.reject(new TypeError("fetch failed"));
      if (call.url.pathname === `/tenant/v1/shared-areas/${ID.a}`) return apiError(404, "NOT_FOUND", "共享区域不存在");
      return null;
    },
  });
  const list = await searchTokyo(user, dialog);
  await user.click(within(list).getByRole("button", { name: "看「镰仓·通用」的形状" }));
  assert.ok(await within(list).findByText("这个区域已经不在共享库里了（可能被停用），请换一个。"));

  await user.click(within(list).getByRole("button", { name: "看「银座一带」的形状" }));
  assert.ok(await within(list).findByText("「银座一带」的形状没有加载出来。请检查网络后重试。"));
  failDetail = false;
  await user.click(within(list).getByRole("button", { name: "重试" }));
  assert.ok(await within(list).findByText(/这个环境没有配置地图底图，看不到形状。「银座一带」：营运区 1 块。/));
  assert.equal(document.querySelector("[data-area]"), null, "没有底图不画地图");
});

test("块数的写法：没有禁行区时不写禁行区", () => {
  assert.equal(sharedAreaPieces({ operate_polygon_count: 2, forbid_polygon_count: 0 }), "营运区 2 块");
  assert.equal(sharedAreaPieces({ operate_polygon_count: 1, forbid_polygon_count: 3 }), "营运区 1 块 · 禁行区 3 块");
});
