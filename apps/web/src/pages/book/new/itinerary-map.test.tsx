/**
 * 包车行程地图组件（M9P-20 P1，ADR 0096 第二节）的组件测试：
 * - 图的地址是本站 `/site/v1/itinerary-map`，`p` 按行程顺序；新图先在看不见的地方加载，好了才换上；alt 是全程摘要；
 * - 换顺序：顺序停下来（`ITINERARY_MAP_SETTLE`）之后才要新图，等新图时旧图上盖「路线更新中」；
 * - 出不来（任何原因）整张图收起，**不用 Leaflet 后备底图**、不另外请求；换下一组点时再试；
 * - 页面：包车有经停时列表编号 1–5、每段时长和公里，地图请求带 5 个点；没有经停时 2 个点、列表「1 上车」「2 下车」。
 * 真实后端和浏览器由 e2e/site-booking-itinerary-map.spec.ts 覆盖。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { App } from "../../../App.tsx";
import type { SiteCity, SiteConfig, SiteQuote, SiteQuoteResult } from "../../../api/site.ts";
import { assertAbsent, json, resetBrowser, stubApiWith } from "../../../testing/harness.tsx";
import { ITINERARY_MAP_SETTLE, ItineraryMap } from "./ItineraryMap.tsx";

const settle = ITINERARY_MAP_SETTLE.ms;
afterEach(() => {
  cleanup();
  resetBrowser();
  ITINERARY_MAP_SETTLE.ms = settle;
});

const SLOW = { timeout: 3000 };
const A = { lat: 35.6905, lng: 139.6948 };
const B = { lat: 35.395, lng: 138.733 };
const C = { lat: 35.498, lng: 138.769 };
const D = { lat: 35.6896, lng: 139.7006 };

const loader = (): HTMLImageElement | null => document.querySelector<HTMLImageElement>(".itinerary-map__loader");
const shown = (): HTMLImageElement | null => document.querySelector<HTMLImageElement>(".itinerary-map .route-map__image");
const pointsOf = (src: string): string[] => new URL(src, "http://localhost").searchParams.getAll("p");

test("出图：本站 /site/v1/itinerary-map，p 按行程顺序；新图加载好才换上，alt 是全程摘要；不用 Leaflet", async () => {
  render(<ItineraryMap points={[A, B, D]} alt="路线图：1 京王 → 2 五合目 → 3 新宿" />);
  const first = loader();
  assert.ok(first !== null);
  const url = new URL(first.src, "http://localhost");
  assert.equal(url.pathname, "/site/v1/itinerary-map");
  assert.deepEqual(url.searchParams.getAll("p"), ["35.690500,139.694800", "35.395000,138.733000", "35.689600,139.700600"]);
  assert.equal(url.searchParams.get("theme"), "light");
  assert.ok(Number(url.searchParams.get("width")) >= 200);
  assertAbsent(shown());
  assert.ok(document.querySelector(".itinerary-map__canvas")?.classList.contains("route-map__canvas--loading"), "加载中是骨架");
  fireEvent.load(first);
  await waitFor(() => assert.ok(shown() !== null));
  assert.equal(shown()?.getAttribute("alt"), "路线图：1 京王 → 2 五合目 → 3 新宿");
  assert.equal(new URL(shown()?.src ?? "", "http://localhost").pathname, "/site/v1/itinerary-map");
  assertAbsent(loader());
  assertAbsent(screen.queryByText("路线更新中"));
  assertAbsent(document.querySelector(".leaflet-container"));
});

test("换顺序：顺序停下来之后才要新图，等新图时旧图上盖「路线更新中」；新图好了再换上", async () => {
  ITINERARY_MAP_SETTLE.ms = 60;
  const view = render(<ItineraryMap points={[A, B, C, D]} alt="旧" />);
  fireEvent.load(loader() as HTMLImageElement);
  await waitFor(() => assert.ok(shown() !== null));
  const oldSrc = shown()?.src ?? "";

  view.rerender(<ItineraryMap points={[A, C, B, D]} alt="新" />);
  // 还没停下来：不要新图，旧图还在，盖着「路线更新中」
  assert.ok(screen.getByText("路线更新中"));
  assertAbsent(loader());
  assert.equal(shown()?.src, oldSrc);
  assert.equal(shown()?.getAttribute("alt"), "旧", "旧图的 alt 还是旧图的");
  // 停下来之前又换了一次：只要最后那一组
  view.rerender(<ItineraryMap points={[A, C, B, D]} alt="新" />);
  await waitFor(() => assert.ok(loader() !== null), SLOW);
  assert.deepEqual(pointsOf(loader()?.src ?? ""), ["35.690500,139.694800", "35.498000,138.769000", "35.395000,138.733000", "35.689600,139.700600"]);
  assert.ok(screen.getByText("路线更新中"));
  fireEvent.load(loader() as HTMLImageElement);
  await waitFor(() => assertAbsent(screen.queryByText("路线更新中")));
  assert.notEqual(shown()?.src, oldSrc);
  assert.equal(shown()?.getAttribute("alt"), "新");
});

test("出不来：整张图收起，只留页面上的列表；不加载 Leaflet；换下一组点时再试一次", async () => {
  ITINERARY_MAP_SETTLE.ms = 20;
  const view = render(<ItineraryMap points={[A, B, D]} alt="路线图" />);
  fireEvent.error(loader() as HTMLImageElement);
  await waitFor(() => assertAbsent(document.querySelector(".itinerary-map")));
  assertAbsent(document.querySelector(".leaflet-container"));
  view.rerender(<ItineraryMap points={[A, C, D]} alt="路线图" />);
  await waitFor(() => assert.ok(loader() !== null), SLOW);
  assert.deepEqual(pointsOf(loader()?.src ?? ""), ["35.690500,139.694800", "35.498000,138.769000", "35.689600,139.700600"]);
});

test("显示中的图出不来（换顺序后新图失败）：整张图收起，不留旧编号的图", async () => {
  ITINERARY_MAP_SETTLE.ms = 20;
  const view = render(<ItineraryMap points={[A, B, C, D]} alt="旧" />);
  fireEvent.load(loader() as HTMLImageElement);
  await waitFor(() => assert.ok(shown() !== null));
  view.rerender(<ItineraryMap points={[A, C, B, D]} alt="新" />);
  await waitFor(() => assert.ok(loader() !== null), SLOW);
  fireEvent.error(loader() as HTMLImageElement);
  await waitFor(() => assertAbsent(document.querySelector(".itinerary-map")));
});

// ---- 页面：新预订页的包车 ----

const CITY_ID = "11111111-1111-4111-8111-111111111111";
const city: SiteCity = { id: CITY_ID, code: "CTY-JP-TYO", name: { zh: "东京" }, timezone: "Asia/Tokyo", country_code: "JP", center: { lat: 35.6895, lng: 139.6917 }, categories: ["charter"] };
const config: SiteConfig = { open: true, currency: "JPY", payments: null, support_phone: "+81 3-1234-5678", support_whatsapp: null, address_search: true, page_width: "standard", map_tiles: null };
const LINK = "/book/new?mode=charter&from=35.6905,139.6948&from_name=%E4%BA%AC%E7%8E%8B%E5%B9%BF%E5%9C%BA%E9%85%92%E5%BA%97&to=35.6896,139.7006&to_name=%E6%96%B0%E5%AE%BF%E7%AB%99&date=2030-11-20&time=09:00&pax=2&bags=2&hours=8";
const quote: SiteQuote = {
  quote_id: "QT203011200000000001",
  expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
  service_date: "2030-11-20",
  urgent: false,
  includes_area_surcharge: false,
  vehicle_group: { id: "33333333-3333-4333-8333-333333333301", code: "VG-T1", name: { zh: "车型1" }, grade: "economy", seats: 7, sample_models: ["Toyota Noah"], combos: [{ passengers: 6, luggage: 4 }] },
  package: { hours: 8, km: 200 },
  price: { total: { amount: "77000", currency: "JPY" }, fx: null },
  free_wait_minutes: 0,
  cancel_policy: { category: "charter", level: "economy", tiers: [{ min_hours_before: 24, fee_bp: 0 }, { min_hours_before: 0, fee_bp: 10000 }] },
  available_addons: [],
};

test("页面：没有经停的包车也显示行程地图（2 个点）和「1 上车」「2 下车」两行；不请求两点路线小地图", async () => {
  const result: SiteQuoteResult = { currency: "JPY", quotes: [quote], unavailable: [] };
  const calls = stubApiWith((call) => {
    const path = call.url.pathname;
    if (path === "/site/v1/config") return json(200, config);
    if (path === "/site/v1/cities") return json(200, { items: [city] });
    if (path === "/site/v1/charter-packages") return json(200, { city: { id: CITY_ID, code: city.code, name: city.name, timezone: city.timezone }, items: [{ hours: 8 }] });
    if (path === "/site/v1/fx/reference") return json(200, { available: false, from: "JPY", to: call.url.searchParams.get("to"), rate: null, as_of: null, reason: "NO_RATE" });
    if (call.method === "POST" && path === "/site/v1/quotes") return json(200, result);
    return null;
  });
  render(
    <MemoryRouter initialEntries={[LINK]}>
      <App />
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { name: "车型1" }, SLOW);
  assert.ok(screen.getByRole("heading", { name: "行程路线" }));
  const list = screen.getByRole("list", { name: "行程" });
  assert.deepEqual([...list.querySelectorAll("li")].map((item) => item.textContent), ["1 上车京王广场酒店", "2 下车新宿站"]);
  await waitFor(() => assert.ok(loader() !== null), SLOW);
  assert.deepEqual(pointsOf(loader()?.src ?? ""), ["35.690500,139.694800", "35.689600,139.700600"]);
  fireEvent.load(loader() as HTMLImageElement);
  await waitFor(() => assert.equal(shown()?.getAttribute("alt"), "路线图：1 京王广场酒店 → 2 新宿站"));
  assert.equal(calls.filter((call) => call.path.startsWith("/site/v1/route-map")).length, 0);
});
