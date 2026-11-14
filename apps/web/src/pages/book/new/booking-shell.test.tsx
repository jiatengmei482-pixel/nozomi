/**
 * 新预订页抽出 BookingShell 以后（M9E-17，ADR 0095 第四节第 1 小节「怎么保证主站不变」）：主站模式下读草稿、询价、下单的请求和下单后的去处
 * 与重构前逐字相同（M9E-12 之后的版本：询价带 draft_id）；默认外壳就是主站的行为。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { App } from "../../../App.tsx";
import type { SiteByPointsResult, SiteCity, SiteConfig, SiteQuote } from "../../../api/site.ts";
import { type ApiCall, json, resetBrowser, stubApiWith } from "../../../testing/harness.tsx";
import { MAIN_BOOKING_SHELL } from "./booking-shell.tsx";

afterEach(() => resetBrowser());

const SLOW = { timeout: 4000 };
const DRAFT = "aZ09_-".repeat(7) + "x";
const TOKEN = `nzo_${"a".repeat(43)}`;
const CITY_ID = "11111111-1111-4111-8111-111111111111";
const city: SiteCity = { id: CITY_ID, code: "CTY-JP-TYO", name: { zh: "东京" }, timezone: "Asia/Tokyo", country_code: "JP", center: { lat: 35.6895, lng: 139.6917 }, categories: ["airport_transfer", "point_to_point", "charter"] };
const config: SiteConfig = { open: true, currency: "JPY", payments: null, support_phone: null, support_whatsapp: null, address_search: true, page_width: "standard", map_tiles: null };
const quote: SiteQuote = {
  quote_id: "QT20301120000000000001",
  expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
  service_date: "2030-11-20",
  urgent: false,
  includes_area_surcharge: false,
  vehicle_group: { id: "33333333-3333-4333-8333-333333333301", code: "VG-T1", name: { zh: "车型1" }, grade: "economy", seats: 7, sample_models: [], combos: [{ passengers: 6, luggage: 4 }] },
  package: null,
  price: { total: { amount: "18000", currency: "JPY" }, fx: null },
  free_wait_minutes: 15,
  cancel_policy: { category: "point_to_point", level: "economy", tiers: [{ min_hours_before: 24, fee_bp: 0 }] },
  available_addons: [],
};
const byPoints: SiteByPointsResult = { trip_type: "point_to_point", airport: null, fallback_category: null, city: { id: CITY_ID, code: city.code, name: city.name, timezone: city.timezone }, currency: "JPY", quotes: [quote], unavailable: [], expires_at: null, route: null };
const draft = { v: 1, tab: "transfer", service_local: "2030-11-20T10:00", pickup: { name: "京王广场酒店", lat: 35.6905, lng: 139.6948 }, dropoff: { name: "东京站", lat: 35.6812, lng: 139.7671 }, waypoints: [], package_hours: null, passengers: 2, luggage: 1, lang: "ja" };

function Where() {
  const location = useLocation();
  return <div data-testid="where" data-path={`${location.pathname}${location.hash}`} />;
}

test("默认外壳就是主站：两栏、地图底图原样、换步不做别的", () => {
  assert.equal(MAIN_BOOKING_SHELL.narrow, false);
  const tiles = { url: "x" } as never;
  assert.equal(MAIN_BOOKING_SHELL.tiles(tiles), tiles);
  assert.equal(MAIN_BOOKING_SHELL.title, "预订用车 · NOZOMI 用车");
  assert.equal(MAIN_BOOKING_SHELL.stepShown(2), undefined);
});

test("主站模式的请求与重构前逐字相同：读草稿不带 key / host，询价体（带 draft_id）、下单体一字不差，下单后进 /book/order#<令牌>", async () => {
  window.matchMedia = ((query: string) => ({ matches: query.includes("min-width: 1024px"), media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false })) as typeof window.matchMedia;
  const calls: ApiCall[] = stubApiWith((call) => {
    const path = call.url.pathname;
    if (path === `/site/v1/booking-drafts/${DRAFT}`) return json(200, { draft, expires_at: "2030-11-20T00:00:00Z" });
    if (path === "/site/v1/config") return json(200, config);
    if (path === "/site/v1/cities") return json(200, { items: [city] });
    if (call.method === "POST" && path === "/site/v1/quotes/by-points") return json(200, byPoints);
    if (path === "/site/v1/fx/reference") return json(200, { available: false, from: "JPY", to: "USD", rate: null, as_of: null, reason: "NO_RATE" });
    if (call.method === "POST" && path === "/site/v1/orders") return json(201, { order: {}, timeline: [], names: {}, payment: null, link: { token: TOKEN, expires_at: "2030-12-01T00:00:00.000Z" } });
    if (call.method === "GET" && path === "/site/v1/order") return json(503, { error: { code: "SERVICE_UNAVAILABLE", message: "x" } });
    return null;
  });
  render(
    <MemoryRouter initialEntries={[`/book/new?draft=${DRAFT}`]}>
      <App />
      <Where />
    </MemoryRouter>,
  );
  const actor = userEvent.setup();
  await screen.findByRole("heading", { name: "车型1" }, SLOW);
  assert.ok(screen.getByRole("heading", { name: "预订接送车", level: 1 }), "主站外壳和标题");
  assert.ok(screen.getByRole("complementary", { name: "行程摘要" }), "电脑上仍是两栏");
  assert.deepEqual(calls.filter((call) => call.path.startsWith("/site/v1/booking-drafts/")).map((call) => call.path), [`/site/v1/booking-drafts/${DRAFT}`]);
  assert.deepEqual(calls.find((call) => call.method === "POST" && call.path === "/site/v1/quotes/by-points")?.body, {
    pickup: { name: "京王广场酒店", lat: 35.6905, lng: 139.6948 },
    dropoff: { name: "东京站", lat: 35.6812, lng: 139.7671 },
    service_local: "2030-11-20T10:00",
    passengers: 2,
    luggage: 1,
    draft_id: DRAFT,
  });
  await actor.click(screen.getByRole("button", { name: "选择 车型1" }));
  await actor.click(screen.getByRole("button", { name: "下一步：填写乘客信息" }));
  await actor.type(screen.getByLabelText("乘车人姓名"), "王小明");
  await actor.type(screen.getByLabelText("邮箱"), "guest@example.com");
  await actor.type(screen.getByLabelText("手机号（含国家区号）"), "+81 90-1234-5678");
  await actor.click(screen.getByRole("button", { name: "下一步：核对订单" }));
  await actor.click(await screen.findByRole("checkbox", { name: /同意保存这次付款用的银行卡/ }));
  await actor.click(screen.getByRole("button", { name: "去付款 →" }));
  await waitFor(() => assert.equal(screen.getByTestId("where").getAttribute("data-path"), `/book/order#${TOKEN}`));
  const order = calls.find((call) => call.method === "POST" && call.path === "/site/v1/orders");
  assert.deepEqual(order?.body, {
    quote_id: quote.quote_id,
    passenger: { name: "王小明", phone: "+81 90-1234-5678", email: "guest@example.com" },
    flight_no: null,
    pickup_address: "京王广场酒店",
    dropoff_address: "东京站",
    messaging: null,
    notes: null,
    save_payment_method: true,
    sign_name: null,
    passenger_name: null,
    passenger_phone: null,
  });
});
