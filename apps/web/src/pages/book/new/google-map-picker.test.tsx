/**
 * 新预订页的谷歌地图选点（M10-01 第 2 处）：配了浏览器密钥时「在地图上选点」打开同源的地图小页面（iframe），不再用开源地图；
 * 小页面发来的选点照常反查地址；加载不出来（大陆网络、密钥被拒）时收起地图、提示用搜索或直接输入地址；只认同源、这个 iframe 发来的消息。
 * 测试里没有真的谷歌地图：直接以 iframe 的身份发消息。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../../App.tsx";
import type { MapTiles } from "../../../api/areas.ts";
import type { SiteCity, SiteConfig } from "../../../api/site.ts";
import { roundLatLng } from "../../../lib/lat-lng.ts";
import { type ApiCall, json, resetBrowser, stubApiWith } from "../../../testing/harness.tsx";
import { mapsPickerUrl } from "../GoogleMapPicker.tsx";

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
const KEY = `AIzaSy${"k".repeat(33)}`;
const TILES: MapTiles = { url_template: "http://127.0.0.1:1/{z}/{x}/{y}.png", dark_url_template: null, min_zoom: 3, max_zoom: 19, tile_size: 256, referrer_policy: "strict-origin", attribution: [{ text: "© OpenStreetMap", href: "https://www.openstreetmap.org/copyright" }] };
const TOKYO: SiteCity = { id: "22222222-2222-4222-8222-222222222222", code: "CTY-JP-G13NKZ", name: { zh: "东京" }, timezone: "Asia/Tokyo", country_code: "JP", center: { lat: 35.6895, lng: 139.6917 }, categories: ["airport_transfer", "point_to_point", "charter"] };

function open(mapsKey: string | null): ApiCall[] {
  const config: SiteConfig = { open: true, currency: "JPY", payments: null, support_phone: null, support_whatsapp: null, address_search: true, page_width: "standard", maps_browser_key: mapsKey, map_tiles: TILES };
  const calls = stubApiWith((call) => {
    const path = call.url.pathname;
    if (path === "/site/v1/config") return json(200, config);
    if (path === "/site/v1/cities") return json(200, { items: [TOKYO] });
    if (path === "/site/v1/places/reverse") return json(200, { available: true, address: "东京都新宿区西新宿 2-8-1" });
    if (path === "/site/v1/charter-packages") return json(200, { city: { id: TOKYO.id, code: TOKYO.code, name: TOKYO.name, timezone: TOKYO.timezone }, items: [{ hours: 8 }] });
    if (path === "/site/v1/fx/reference") return json(200, { available: false, from: "JPY", to: call.url.searchParams.get("to"), rate: null, as_of: null, reason: "NO_RATE" });
    return null;
  });
  render(
    <MemoryRouter initialEntries={["/book/new"]}>
      <App />
    </MemoryRouter>,
  );
  return calls;
}

async function openMap(label: string): Promise<{ group: HTMLElement; frame: HTMLIFrameElement }> {
  const group = await screen.findByRole("group", { name: `${label}的地图` }, SLOW);
  await userEvent.setup().click(within(group).getByRole("button", { name: "在地图上选点" }));
  const frame = (await waitFor(() => {
    const found = group.querySelector("iframe");
    assert.ok(found);
    return found;
  }, SLOW)) as HTMLIFrameElement;
  return { group, frame };
}

function fromFrame(frame: HTMLIFrameElement, data: unknown, origin = window.location.origin): void {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data, origin, source: frame.contentWindow }));
  });
}

test("配了密钥：打开的是谷歌地图小页面（带密钥和城市中心，不出开源地图）；地图出来前「选地图中间这个位置」不能点；小页面选点后坐标保留 6 位小数、照常反查地址", async () => {
  wideScreen();
  const calls = open(KEY);
  const { group, frame } = await openMap("出发地");
  assert.equal(frame.getAttribute("src"), mapsPickerUrl(KEY, TOKYO.center, null));
  assert.ok(frame.getAttribute("src")?.startsWith("/maps/picker.html?key="));
  assert.equal(group.querySelector(".leaflet-container"), null, "不加载开源地图");
  const center = within(group).getByRole("button", { name: "选地图中间这个位置" }) as HTMLButtonElement;
  assert.equal(center.disabled, true);
  fromFrame(frame, { source: "nozomi-map", type: "ready" });
  await waitFor(() => assert.equal(center.disabled, false));

  fromFrame(frame, { source: "nozomi-map", type: "pick", lat: 35.68961234567, lng: 139.69171234567 });
  const reverse = await waitFor(() => {
    const found = calls.find((call) => call.path.startsWith("/site/v1/places/reverse"));
    assert.ok(found);
    return new URL(found.path, "http://localhost").searchParams;
  }, SLOW);
  assert.deepEqual([reverse.get("city_id"), Number(reverse.get("lat")), Number(reverse.get("lng"))], [TOKYO.id, 35.689612, 139.691712]);
  assert.equal(((await screen.findByDisplayValue("东京都新宿区西新宿 2-8-1", undefined, SLOW)) as HTMLInputElement).value, "东京都新宿区西新宿 2-8-1");
});

test("别的来源、别的窗口、格式不对的消息一概不理", async () => {
  wideScreen();
  const calls = open(KEY);
  const { frame } = await openMap("出发地");
  fromFrame(frame, { source: "nozomi-map", type: "pick", lat: 35.7, lng: 139.7 }, "https://evil.example");
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data: { source: "nozomi-map", type: "pick", lat: 35.7, lng: 139.7 }, origin: window.location.origin, source: window }));
  });
  fromFrame(frame, { type: "pick", lat: 35.7, lng: 139.7 });
  fromFrame(frame, { source: "nozomi-map", type: "pick", lat: "35.7", lng: 139.7 });
  fromFrame(frame, { source: "nozomi-map", type: "pick", lat: Number.NaN, lng: 139.7 });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(calls.filter((call) => call.path.startsWith("/site/v1/places/reverse")).length, 0);
});

test("地图加载不出来（小页面报 failed）：收起地图和按钮，提示用搜索或直接输入地址；不退回开源地图", async () => {
  wideScreen();
  open(KEY);
  const { group, frame } = await openMap("出发地");
  fromFrame(frame, { source: "nozomi-map", type: "failed", reason: "load" });
  await waitFor(() => assert.equal(group.isConnected ? group.querySelector("iframe") : null, null));
  assert.ok(await screen.findByText("地图加载不出来（可能是网络原因）。请用上面的搜索找到地址；门牌、楼层等可以写在下单时的「给司机的备注」里。"));
  assert.equal(screen.queryByRole("button", { name: "在地图上选点" }) !== null && document.querySelector(".leaflet-container") !== null, false);
});

test("没配密钥：照旧用开源地图（过渡期）", async () => {
  wideScreen();
  open(null);
  const group = await screen.findByRole("group", { name: "出发地的地图" }, SLOW);
  await userEvent.setup().click(within(group).getByRole("button", { name: "在地图上选点" }));
  await waitFor(() => assert.ok(group.querySelector(".leaflet-container")), SLOW);
  assert.equal(group.querySelector("iframe"), null);
});

test("坐标保留 6 位小数，经度折回 [-180, 180)", () => {
  assert.deepEqual(roundLatLng({ lat: 35.12345678, lng: 139.98765432 }), { lat: 35.123457, lng: 139.987654 });
  assert.deepEqual(roundLatLng({ lat: 0, lng: 190 }), { lat: 0, lng: -170 });
});
