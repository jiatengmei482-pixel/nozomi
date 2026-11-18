/**
 * 新预订页「在地图上选点」还没有地点可参照时从哪个城市打开（M8-43）：
 * 不再是城市列表第一项（测试站是只开了接送机的北京），而是能订当前标签（区间 / 包车）、品类最多的城市，一样多按列表顺序；
 * 另一端选好了时照旧从另一端打开。
 * 直接点「选地图中间这个位置」，看填进去的坐标和反查地址用的城市。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../../App.tsx";
import type { MapTiles } from "../../../api/areas.ts";
import type { SiteCity, SiteConfig } from "../../../api/site.ts";
import { type ApiCall, json, resetBrowser, stubApiWith } from "../../../testing/harness.tsx";

const originalMatchMedia = window.matchMedia;
afterEach(() => {
  cleanup();
  resetBrowser();
  window.matchMedia = originalMatchMedia;
});

function wideScreen(): void {
  window.matchMedia = ((query: string) => ({ matches: query.includes("min-width: 1024px"), media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false })) as typeof window.matchMedia;
}

const SLOW = { timeout: 3000 };
const TILES: MapTiles = { url_template: "http://127.0.0.1:1/{z}/{x}/{y}.png", dark_url_template: null, min_zoom: 3, max_zoom: 19, tile_size: 256, referrer_policy: "strict-origin", attribution: [{ text: "© OpenStreetMap", href: "https://www.openstreetmap.org/copyright" }] };
const config: SiteConfig = { open: true, currency: "JPY", payments: null, support_phone: null, support_whatsapp: null, address_search: true, page_width: "standard", map_tiles: TILES };

const cityOf = (id: string, code: string, zh: string, center: { lat: number; lng: number }, categories: SiteCity["categories"]): SiteCity => ({ id, code, name: { zh }, timezone: "Asia/Tokyo", country_code: code.slice(4, 6), center, categories });
const BEIJING = cityOf("11111111-1111-4111-8111-111111111111", "CTY-CN-BEIJING", "北京", { lat: 39.9042, lng: 116.4074 }, ["airport_transfer"]);
const BEIJING_P2P = { ...BEIJING, categories: ["airport_transfer", "point_to_point"] } satisfies SiteCity;
const TOKYO = cityOf("22222222-2222-4222-8222-222222222222", "CTY-JP-G13NKZ", "东京", { lat: 35.6895, lng: 139.6917 }, ["airport_transfer", "point_to_point", "charter"]);
const KYOTO = cityOf("33333333-3333-4333-8333-333333333333", "CTY-JP-G13TKM", "京都", { lat: 35.0116, lng: 135.7681 }, ["point_to_point", "charter"]);

function open(cities: SiteCity[], at = "/book/new"): ApiCall[] {
  const calls = stubApiWith((call) => {
    const path = call.url.pathname;
    if (path === "/site/v1/config") return json(200, config);
    if (path === "/site/v1/cities") return json(200, { items: cities });
    if (path === "/site/v1/places/reverse") return json(200, { available: true, address: "某个地址" });
    if (path === "/site/v1/charter-packages") {
      const found = cities.find((entry) => entry.categories.includes("charter")) ?? null;
      return json(200, { city: found === null ? null : { id: found.id, code: found.code, name: found.name, timezone: found.timezone }, items: found === null ? [] : [{ hours: 8 }] });
    }
    if (path === "/site/v1/fx/reference") return json(200, { available: false, from: "JPY", to: call.url.searchParams.get("to"), rate: null, as_of: null, reason: "NO_RATE" });
    return null;
  });
  render(
    <MemoryRouter initialEntries={[at]}>
      <App />
    </MemoryRouter>,
  );
  return calls;
}

/** 打开某个地址框的地图、不移动直接选中间：返回反查用的城市和坐标 */
async function pickMapCenter(calls: ApiCall[], label: string): Promise<{ city: string | null; lat: number; lng: number }> {
  const actor = userEvent.setup();
  const group = await screen.findByRole("group", { name: `${label}的地图` }, SLOW);
  await actor.click(within(group).getByRole("button", { name: "在地图上选点" }));
  await actor.click(await within(group).findByRole("button", { name: "选地图中间这个位置" }));
  const reverse = await waitFor(() => {
    const found = calls.find((call) => call.path.startsWith("/site/v1/places/reverse"));
    assert.ok(found, "选点后按位置反查地址");
    return new URL(found.path, "http://localhost").searchParams;
  }, SLOW);
  return { city: reverse.get("city_id"), lat: Number(reverse.get("lat")), lng: Number(reverse.get("lng")) };
}

test("区间、还没选任何地址：地图从能订区间、品类最多的城市（东京）打开，不是列表第一项（只开了接送机的北京）", async () => {
  wideScreen();
  const calls = open([BEIJING, TOKYO]);
  const picked = await pickMapCenter(calls, "出发地");
  assert.deepEqual(picked, { city: TOKYO.id, lat: TOKYO.center.lat, lng: TOKYO.center.lng });
  assert.notEqual(picked.city, BEIJING.id);
});

test("包车、还没选任何地址：只在能订包车的城市里选（列表第一项北京品类一样多也不选），从京都打开", async () => {
  wideScreen();
  const calls = open([BEIJING_P2P, KYOTO], "/book/new?mode=charter");
  const picked = await pickMapCenter(calls, "上车地点");
  assert.deepEqual(picked, { city: KYOTO.id, lat: KYOTO.center.lat, lng: KYOTO.center.lng });
});

test("另一端选好了：照旧从另一端打开（不用默认城市）", async () => {
  wideScreen();
  const calls = open([BEIJING, TOKYO], "/book/new?to=39.91,116.41&to_name=%E5%8C%97%E4%BA%AC%E9%85%92%E5%BA%97");
  const picked = await pickMapCenter(calls, "出发地");
  assert.deepEqual(picked, { city: BEIJING.id, lat: 39.91, lng: 116.41 });
});
