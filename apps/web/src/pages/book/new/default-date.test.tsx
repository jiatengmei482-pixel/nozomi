/**
 * 新预订页的默认日期按哪个城市的时区算（M8-44，来源 PR #211 审查）：
 * 以前按城市列表第一项（测试站是北京）算「当地的明天」；东京时间 00:00–01:00 之间「北京的明天」就是「东京的今天」。
 * 现在按上车点所在城市；还没选上车点时按地图默认打开的城市（`defaultMapCity`）；客人定过的日期（自己改过、链接或预订草稿带了）不再改，换标签也不改。
 * 还没报出价时右侧栏「用车时间（当地时间）」按同一个城市解读（是不是今年）。
 * 假时钟固定在东京 2030-11-20 00:30（北京 2030-11-19 23:30）；跨年的用例固定在东京 2031-01-01 00:30（北京 2030-12-31 23:30）。
 */
import { afterEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../../App.tsx";
import type { BookingDraft, SiteCity, SiteConfig } from "../../../api/site.ts";
import { apiError, json, resetBrowser, stubApiWith } from "../../../testing/harness.tsx";

const originalMatchMedia = window.matchMedia;
afterEach(() => {
  cleanup();
  mock.timers.reset();
  resetBrowser();
  window.matchMedia = originalMatchMedia;
});

function wideScreen(): void {
  window.matchMedia = ((query: string) => ({ matches: query.includes("min-width: 1024px"), media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false })) as typeof window.matchMedia;
}

const SLOW = { timeout: 3000 };
/** 东京 2030-11-20 00:30 = 北京 2030-11-19 23:30 */
const NOW = Date.parse("2030-11-19T15:30:00Z");
const TOKYO_TOMORROW = "2030-11-21";
const BEIJING_TOMORROW = "2030-11-20";

const config: SiteConfig = { open: true, currency: "JPY", payments: null, support_phone: null, support_whatsapp: null, address_search: true, page_width: "standard", map_tiles: null };
// 和测试站同样的形状：列表第一项是只开了接送机的北京（Asia/Shanghai），东京（Asia/Tokyo）服务最全
const BEIJING: SiteCity = { id: "11111111-1111-4111-8111-111111111111", code: "CTY-CN-BEIJING", name: { zh: "北京" }, timezone: "Asia/Shanghai", country_code: "CN", center: { lat: 39.9042, lng: 116.4074 }, categories: ["airport_transfer"] };
const TOKYO: SiteCity = { id: "22222222-2222-4222-8222-222222222222", code: "CTY-JP-G13NKZ", name: { zh: "东京" }, timezone: "Asia/Tokyo", country_code: "JP", center: { lat: 35.6895, lng: 139.6917 }, categories: ["airport_transfer", "point_to_point", "charter"] };
const BEIJING_STATION = { source: "platform", id: "44444444-4444-4444-8444-444444444441", name: "北京站", address: "", location: { lat: 39.9029, lng: 116.4271 }, kind: "station" } as const;
const TOKYO_STATION = { source: "platform", id: "44444444-4444-4444-8444-444444444442", name: "东京站", address: "", location: { lat: 35.6812, lng: 139.7671 }, kind: "station" } as const;
const SHINJUKU_STATION = { source: "platform", id: "44444444-4444-4444-8444-444444444443", name: "新宿站", address: "", location: { lat: 35.6896, lng: 139.7006 }, kind: "station" } as const;

const DRAFT_ID = "aZ09_-".repeat(7) + "x";

function open(at = "/book/new", draft: BookingDraft | null = null, cities: SiteCity[] = [BEIJING, TOKYO]): void {
  stubApiWith((call) => {
    const path = call.url.pathname;
    if (draft !== null && path === `/site/v1/booking-drafts/${DRAFT_ID}`) return json(200, { draft, expires_at: "2030-11-21T00:00:00.000Z" });
    if (path === "/site/v1/config") return json(200, config);
    if (path === "/site/v1/cities") return json(200, { items: cities });
    if (path === "/site/v1/places/autocomplete") {
      const q = call.url.searchParams.get("q") ?? "";
      return json(200, { available: true, items: q.includes("北京") ? [BEIJING_STATION] : q.includes("东京") ? [TOKYO_STATION] : q.includes("新宿") ? [SHINJUKU_STATION] : [] });
    }
    // 报价一律报不出（503）：第 2 步右侧栏的时间只能按页面自己选的城市解读
    if (call.method === "POST" && path === "/site/v1/quotes/by-points") return apiError(503, "SERVICE_UNAVAILABLE", "暂时不可用");
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
}

const user = () => userEvent.setup();
const dateBox = (): HTMLInputElement => screen.getByLabelText("日期（当地）") as HTMLInputElement;

async function pickFrom(actor: ReturnType<typeof user>, query: string, option: RegExp): Promise<void> {
  const box = await screen.findByRole("combobox", { name: "出发地" });
  await actor.clear(box);
  await actor.type(box, query);
  await actor.click(await screen.findByRole("option", { name: option }, SLOW));
}

test("东京 00:30（北京前一天 23:30）、还没选上车点：默认日期是东京的明天，不是北京的明天（= 东京的今天）", async () => {
  mock.timers.enable({ apis: ["Date"], now: NOW });
  wideScreen();
  open();
  await screen.findByRole("combobox", { name: "出发地" }, SLOW);
  await waitFor(() => assert.equal(dateBox().value, TOKYO_TOMORROW), SLOW);
  assert.notEqual(dateBox().value, BEIJING_TOMORROW);
});

test("包车标签：同样按地图默认城市（东京）的明天", async () => {
  mock.timers.enable({ apis: ["Date"], now: NOW });
  wideScreen();
  open("/book/new?mode=charter");
  await screen.findByRole("combobox", { name: "上车地点" }, SLOW);
  await waitFor(() => assert.equal(dateBox().value, TOKYO_TOMORROW), SLOW);
});

test("选了别的时区城市里的上车点：按那个城市（北京）的明天；再换回东京的上车点又按东京", async () => {
  mock.timers.enable({ apis: ["Date"], now: NOW });
  wideScreen();
  open();
  const actor = user();
  await screen.findByRole("combobox", { name: "出发地" }, SLOW);
  await waitFor(() => assert.equal(dateBox().value, TOKYO_TOMORROW), SLOW);
  await pickFrom(actor, "北京", /北京站/);
  await waitFor(() => assert.equal(dateBox().value, BEIJING_TOMORROW), SLOW);
  await pickFrom(actor, "东京", /东京站/);
  await waitFor(() => assert.equal(dateBox().value, TOKYO_TOMORROW), SLOW);
});

test("链接给的上车点在北京：一打开就按北京的明天", async () => {
  mock.timers.enable({ apis: ["Date"], now: NOW });
  wideScreen();
  open("/book/new?from=39.91,116.41&from_name=%E5%8C%97%E4%BA%AC%E9%85%92%E5%BA%97");
  await screen.findByRole("combobox", { name: "出发地" }, SLOW);
  await waitFor(() => assert.equal(dateBox().value, BEIJING_TOMORROW), SLOW);
});

test("客人改过日期：再换上车点（换到别的时区）不覆盖", async () => {
  mock.timers.enable({ apis: ["Date"], now: NOW });
  wideScreen();
  open();
  const actor = user();
  await screen.findByRole("combobox", { name: "出发地" }, SLOW);
  await waitFor(() => assert.equal(dateBox().value, TOKYO_TOMORROW), SLOW);
  await actor.clear(dateBox());
  await actor.type(dateBox(), "2030-12-01");
  assert.equal(dateBox().value, "2030-12-01");
  await pickFrom(actor, "北京", /北京站/);
  await screen.findByDisplayValue("北京站", undefined, SLOW);
  assert.equal(dateBox().value, "2030-12-01", "换到北京的上车点不改客人选的日期");
  await pickFrom(actor, "东京", /东京站/);
  await screen.findByDisplayValue("东京站", undefined, SLOW);
  assert.equal(dateBox().value, "2030-12-01");
});

test("链接带了日期：不管上车点在哪都不改", async () => {
  mock.timers.enable({ apis: ["Date"], now: NOW });
  wideScreen();
  open("/book/new?date=2030-12-05&from=39.91,116.41&from_name=%E5%8C%97%E4%BA%AC%E9%85%92%E5%BA%97");
  await screen.findByDisplayValue("北京酒店", undefined, SLOW);
  assert.equal(dateBox().value, "2030-12-05");
});

test("预订草稿带了日期（上车点在北京、日期 2030-12-05）：日期保持草稿里的，不按北京或东京的明天改写", async () => {
  mock.timers.enable({ apis: ["Date"], now: NOW });
  wideScreen();
  const draft: BookingDraft = { v: 1, tab: "transfer", service_local: "2030-12-05T14:30", pickup: { name: "北京酒店", lat: 39.91, lng: 116.41 }, dropoff: { name: "北京站", lat: 39.9029, lng: 116.4271 }, waypoints: [], package_hours: null, passengers: 2, luggage: 2, lang: "zh" };
  open(`/book/new?draft=${DRAFT_ID}&step=1`, draft);
  await screen.findByDisplayValue("北京酒店", undefined, SLOW);
  assert.equal(dateBox().value, "2030-12-05");
  // 等默认日期的副作用跑完（上车点换成北京后会重算一次）再看一遍
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(dateBox().value, "2030-12-05", "草稿里客人定的日期不被改成北京的明天");
});

// 换标签会换默认城市的城市表：区间只有北京能订（默认北京），包车只有东京能订（默认东京）
const BEIJING_TRANSFER: SiteCity = { ...BEIJING, categories: ["airport_transfer", "point_to_point"] };
const TOKYO_CHARTER: SiteCity = { ...TOKYO, categories: ["charter"] };

test("没改过日期、还没选上车点时换标签：默认城市跟着标签换，日期跟着换（区间北京的明天 → 包车东京的明天）", async () => {
  mock.timers.enable({ apis: ["Date"], now: NOW });
  wideScreen();
  open("/book/new", null, [BEIJING_TRANSFER, TOKYO_CHARTER]);
  const actor = user();
  await screen.findByRole("combobox", { name: "出发地" }, SLOW);
  await waitFor(() => assert.equal(dateBox().value, BEIJING_TOMORROW), SLOW);
  await actor.click(screen.getByRole("radio", { name: "包车" }));
  await waitFor(() => assert.equal(dateBox().value, TOKYO_TOMORROW), SLOW);
});

test("客人改过日期后换标签（区间 → 包车，默认城市从北京换成东京）：日期不变", async () => {
  mock.timers.enable({ apis: ["Date"], now: NOW });
  wideScreen();
  open("/book/new", null, [BEIJING_TRANSFER, TOKYO_CHARTER]);
  const actor = user();
  await screen.findByRole("combobox", { name: "出发地" }, SLOW);
  await waitFor(() => assert.equal(dateBox().value, BEIJING_TOMORROW), SLOW);
  await actor.clear(dateBox());
  await actor.type(dateBox(), "2030-12-01");
  await actor.click(screen.getByRole("radio", { name: "包车" }));
  await screen.findByRole("combobox", { name: "上车地点" }, SLOW);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(dateBox().value, "2030-12-01");
});

/** 右侧栏「用车时间（当地时间）」那一项的文字（第 2 步起才有） */
function summaryWhen(): string {
  const aside = screen.getByRole("complementary", { name: "行程摘要" });
  return within(aside).getByText("用车时间（当地时间）").nextElementSibling?.textContent ?? "";
}

test("还没报出价时右侧栏的用车时间按上车点所在城市（东京）解读：东京已是 2031 年，2031-01-02 不写年份（按列表第一项北京会写「2031年」）", async () => {
  mock.timers.enable({ apis: ["Date"], now: Date.parse("2030-12-31T15:30:00Z") });
  wideScreen();
  open();
  const actor = user();
  await pickFrom(actor, "东京", /东京站/);
  await waitFor(() => assert.equal(dateBox().value, "2031-01-02"), SLOW);
  const to = screen.getByRole("combobox", { name: "目的地" });
  await actor.type(to, "新宿");
  await actor.click(await screen.findByRole("option", { name: /新宿站/ }, SLOW));
  await actor.type(screen.getByLabelText(/时间（当地）/), "14:30");
  await actor.click(screen.getByRole("button", { name: "下一步：选择车型" }));
  await waitFor(() => assert.equal(summaryWhen(), "1月2日（周四）14:30"), SLOW);
});
