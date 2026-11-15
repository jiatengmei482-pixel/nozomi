/**
 * 新预订页包车的经停点和按行程计价（M9W-02，ADR 0088；需求 charter-waypoint-surcharge.md 13.5）的组件测试：
 * 没有经停点时询价请求和以前完全一样；经停点增删、上下移动（焦点跟着走、播报）、最多 25 个（M9P-10）；停留时长必填；
 * 有经停点时请求带 itinerary_pricing 和 waypoints、不带 package_hours，包车时长下拉换成「按行程自动选套餐」；
 * 车型卡、右侧栏、核对页的对外价明细（各项之和 = 总价；对不上时不显示明细）、行程时间表和提示；经停点报不出价时指出是哪一个。
 * 接口用测试替身（浏览器只连 /site/v1）；真实后端由 e2e/site-booking-waypoints.spec.ts 覆盖。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../../App.tsx";
import type { SiteCity, SiteConfig, SiteQuote, SiteQuoteResult } from "../../../api/site.ts";
import { type ApiCall, apiError, assertAbsent, assertFocused, json, resetBrowser, stubApiWith } from "../../../testing/harness.tsx";

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
const CITY_ID = "11111111-1111-4111-8111-111111111111";
const city: SiteCity = { id: CITY_ID, code: "CTY-JP-TYO", name: { zh: "东京" }, timezone: "Asia/Tokyo", country_code: "JP", center: { lat: 35.6895, lng: 139.6917 }, categories: ["charter"] };
const config: SiteConfig = { open: true, currency: "JPY", payments: null, support_phone: "+81 3-1234-5678", support_whatsapp: null, address_search: true, page_width: "standard", map_tiles: null };
/** 上车：京王广场酒店，下车：新宿站（链接带上），日期时间也带上 */
const LINK = "/book/new?mode=charter&from=35.6905,139.6948&from_name=%E4%BA%AC%E7%8E%8B%E5%B9%BF%E5%9C%BA%E9%85%92%E5%BA%97&to=35.6896,139.7006&to_name=%E6%96%B0%E5%AE%BF%E7%AB%99&date=2030-11-20&time=09:00";
/** 经停点候选：按输入的字返回一个带坐标的平台地点 */
const SPOTS: Record<string, { lat: number; lng: number }> = { 五合目: { lat: 35.395, lng: 138.733 }, 河口湖: { lat: 35.498, lng: 138.769 }, 忠灵塔: { lat: 35.501, lng: 138.801 } };

function quoteOf(index: number, amount: number, breakdown?: SiteQuote["price_breakdown"]): SiteQuote {
  return {
    quote_id: `QT20301120000000000${index}`,
    expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    service_date: "2030-11-20",
    urgent: false,
    includes_area_surcharge: breakdown !== undefined && breakdown.length > 1,
    vehicle_group: { id: `33333333-3333-4333-8333-33333333330${index}`, code: `VG-T${index}`, name: { zh: `车型${index}` }, grade: "economy", seats: 7, sample_models: ["Toyota Noah"], combos: [{ passengers: 6, luggage: 4 }] },
    package: { hours: 10, km: 200 },
    price: { total: { amount: String(amount), currency: "JPY" }, fx: null },
    ...(breakdown !== undefined ? { price_breakdown: breakdown } : {}),
    free_wait_minutes: 0,
    cancel_policy: { category: "charter", level: "economy", tiers: [{ min_hours_before: 24, fee_bp: 0 }, { min_hours_before: 0, fee_bp: 10000 }] },
    available_addons: [],
    itinerary_warnings: null,
  };
}

const yen = (amount: number) => ({ amount: String(amount), currency: "JPY" });
/** 13.4 算例：10 小时套餐 60,500 + 富士山地区途经 11,000 = 对外 71,500 */
const FUJI_BREAKDOWN: SiteQuote["price_breakdown"] = [
  { kind: "base", amount: yen(60_500), area_name: null, stop_seqs: null },
  { kind: "waypoint", amount: yen(11_000), area_name: { zh: "富士山地区" }, stop_seqs: [1, 2, 3] },
];
const itineraryResult = (breakdown = FUJI_BREAKDOWN, total = 71_500): SiteQuoteResult => ({
  currency: "JPY",
  quotes: [quoteOf(1, total, breakdown)],
  unavailable: [],
  itinerary_route: { legs: [{ minutes: 120, meters: 120_000 }, { minutes: 30, meters: 20_000 }, { minutes: 10, meters: 4_000 }, { minutes: 110, meters: 110_000 }], drive_minutes: 270, stay_minutes: 180, total_minutes: 450, total_meters: 254_000 },
});
const plainResult: SiteQuoteResult = { currency: "JPY", quotes: [quoteOf(1, 77_000, [{ kind: "base", amount: yen(77_000), area_name: null, stop_seqs: null }])], unavailable: [] };

/** 谷歌候选：没有坐标，选中后再调 /site/v1/places/details 取（M9W-08 用它让取坐标变慢） */
const GOOGLE_SPOT = { source: "google", id: "ChIJgogome", name: "富士山五合目園地", address: "山梨県富士吉田市上吉田", location: null, kind: "other" } as const;
let placeDetails: () => Response | Promise<Response> = () => json(200, { available: true, place: { id: GOOGLE_SPOT.id, address: GOOGLE_SPOT.address, location: { lat: 35.395, lng: 138.733 }, kind: "other" } });

/** 这段行程能订的套餐（`GET /site/v1/charter-packages`） */
let packageHours = [8];

function open(charter: (call: ApiCall) => Response = () => json(200, plainResult), order?: () => Response): ApiCall[] {
  const calls = stubApiWith((call) => {
    const path = call.url.pathname;
    if (path === "/site/v1/config") return json(200, config);
    if (path === "/site/v1/cities") return json(200, { items: [city] });
    if (path === "/site/v1/places/autocomplete") {
      const q = call.url.searchParams.get("q") ?? "";
      const name = Object.keys(SPOTS).find((spot) => q.includes(spot));
      if (q.includes(GOOGLE_SPOT.name)) return json(200, { available: true, items: [GOOGLE_SPOT] });
      return json(200, { available: true, items: name === undefined ? [] : [{ source: "platform", id: `spot-${name}`, name, address: "", location: SPOTS[name], kind: "station" }] });
    }
    if (path === "/site/v1/places/details") return placeDetails();
    if (path === "/site/v1/charter-packages") return json(200, { city: { id: CITY_ID, code: city.code, name: city.name, timezone: city.timezone }, items: packageHours.map((hours) => ({ hours })) });
    if (path === "/site/v1/fx/reference") return json(200, { available: false, from: "JPY", to: call.url.searchParams.get("to"), rate: null, as_of: null, reason: "NO_RATE" });
    if (call.method === "POST" && path === "/site/v1/quotes") return charter(call);
    if (call.method === "POST" && path === "/site/v1/orders") return order?.() ?? null;
    if (call.method === "POST" && path === "/site/v1/manual-quote-requests") return json(202, { status: "accepted" });
    return null;
  });
  render(
    <MemoryRouter initialEntries={[LINK]}>
      <App />
    </MemoryRouter>,
  );
  return calls;
}

const user = () => userEvent.setup();
const quotes = (calls: ApiCall[]): Record<string, unknown>[] => calls.filter((call) => call.method === "POST" && call.path === "/site/v1/quotes").map((call) => call.body as Record<string, unknown>);

async function addStop(actor: ReturnType<typeof user>, spot: string, stay: string | null): Promise<void> {
  await actor.click(screen.getByRole("button", { name: "添加经停点" }));
  const boxes = screen.getAllByRole("combobox", { name: /^经停点 \d+$/ });
  const box = boxes.at(-1) as HTMLElement;
  await waitFor(() => assertFocused(box));
  await actor.type(box, spot);
  await actor.click(await screen.findByRole("option", { name: new RegExp(spot) }, SLOW));
  if (stay !== null) {
    const selects = screen.getAllByLabelText(/^经停点 \d+ 停留时长/);
    await actor.selectOptions(selects.at(-1) as HTMLElement, stay);
  }
}

const stopNames = (): string[] => screen.getAllByRole("combobox", { name: /^经停点 \d+$/ }).map((box) => (box as HTMLInputElement).value);

test("没有经停点：询价请求和以前完全一样（字段、顺序都相同，没有 itinerary_pricing、waypoints），包车时长照旧手选；车型卡照样逐项列明细（M9P-04），没有经停点的提示和行程时间表", async () => {
  wideScreen();
  const calls = open();
  await screen.findByRole("heading", { name: "车型1" }, SLOW);
  const body = quotes(calls).at(-1) as Record<string, unknown>;
  assert.deepEqual(Object.keys(body), ["category", "pickup", "dropoff", "package_hours", "service_local", "passengers", "luggage", "pickup_name", "dropoff_name"].filter((key) => key in body));
  assert.deepEqual(body, { category: "charter", pickup: { lat: 35.6905, lng: 139.6948 }, dropoff: { lat: 35.6896, lng: 139.7006 }, package_hours: 8, service_local: "2030-11-20T09:00", passengers: 2, luggage: 2, ...("pickup_name" in body ? { pickup_name: body["pickup_name"] } : {}), ...("dropoff_name" in body ? { dropoff_name: body["dropoff_name"] } : {}) });
  assert.equal("itinerary_pricing" in body, false);
  assert.equal("waypoints" in body, false);
  // M9P-04（P0 验收后续 A）：不填经停点也逐项列明细；只是没有「按您填的经停点计算」的提示
  assert.ok(screen.getAllByLabelText("价格明细").length > 0);
  assertAbsent(screen.queryByText(/价格按您填的经停点计算/));
  assertAbsent(screen.queryByText("行程时间表"));
  // M9W-05：不按行程计价的包车，「一口价包含」下面的说法照旧
  const includes = screen.getByRole("heading", { name: "一口价包含" }).closest("section") as HTMLElement;
  assert.ok(within(includes).getByText("超出套餐的时长和公里服务后按实际收取：先通知您，48 小时内可以在订单页提异议。"));
  assert.doesNotMatch(includes.textContent ?? "", /按预计行程/);
});

test("经停点：添加、上下移动（焦点跟着这一行、播报新位置）、删除（焦点到下一行的删除）；第一行上移、最后一行下移禁用；最多 25 个（M9P-10，路径接口上限），加满后提示联系客服定制", async () => {
  wideScreen();
  open();
  const actor = user();
  await screen.findByRole("heading", { name: "车型1" }, SLOW);
  await actor.click(screen.getByRole("button", { name: "上一步" }));
  await screen.findByRole("button", { name: "添加经停点" });
  await addStop(actor, "五合目", "60");
  await addStop(actor, "河口湖", "90");
  await addStop(actor, "忠灵塔", "30");
  assert.deepEqual(stopNames(), ["五合目", "河口湖", "忠灵塔"]);
  assert.equal((screen.getByRole("button", { name: "把 五合目 上移" }) as HTMLButtonElement).disabled, true);
  assert.equal((screen.getByRole("button", { name: "把 忠灵塔 下移" }) as HTMLButtonElement).disabled, true);

  await actor.click(screen.getByRole("button", { name: "把 河口湖 上移" }));
  assert.deepEqual(stopNames(), ["河口湖", "五合目", "忠灵塔"]);
  assert.ok(screen.getByText("河口湖 现在排第 1，共 3 个"));
  // 到头了「上移」禁用：焦点移到同一行的「下移」
  await waitFor(() => assertFocused(screen.getByRole("button", { name: "把 河口湖 下移" })));
  // 停留时长跟着这一行走
  const stays = screen.getAllByLabelText(/^经停点 \d+ 停留时长/).map((select) => (select as HTMLSelectElement).value);
  assert.deepEqual(stays, ["90", "60", "30"]);
  // Alt + ↓ 也能移动
  await actor.keyboard("{Alt>}{ArrowDown}{/Alt}");
  assert.deepEqual(stopNames(), ["五合目", "河口湖", "忠灵塔"]);

  await actor.click(screen.getByRole("button", { name: "删除 河口湖" }));
  assert.deepEqual(stopNames(), ["五合目", "忠灵塔"]);
  await waitFor(() => assertFocused(screen.getByRole("button", { name: "删除 忠灵塔" })));

  for (let index = 0; index < 22; index += 1) await actor.click(screen.getByRole("button", { name: "添加经停点" }));
  assert.equal(screen.getAllByRole("combobox", { name: /^经停点 \d+$/ }).length, 24);
  assert.equal((screen.getByRole("button", { name: "添加经停点" }) as HTMLButtonElement).disabled, false, "24 个还能加");
  assert.equal(screen.queryByText(/更多请联系客服定制/), null);
  await actor.click(screen.getByRole("button", { name: "添加经停点" }));
  assert.equal(screen.getAllByRole("combobox", { name: /^经停点 \d+$/ }).length, 25);
  assert.equal((screen.getByRole("button", { name: "添加经停点" }) as HTMLButtonElement).disabled, true);
  assert.ok(screen.getByText("最多 25 个经停点，更多请联系客服定制。"));
});

test("停留时长必填：选了地点没选停留时不报价，点「下一步」标红「请选择停留时长」；选好后请求带 itinerary_pricing 和按顺序的 waypoints，不带 package_hours；包车时长下拉换成「按行程自动选套餐」", async () => {
  wideScreen();
  const calls = open((call) => json(200, (call.body as Record<string, unknown>)["itinerary_pricing"] === true ? itineraryResult() : plainResult));
  const actor = user();
  await screen.findByRole("heading", { name: "车型1" }, SLOW);
  await actor.click(screen.getByRole("button", { name: "上一步" }));
  await addStop(actor, "五合目", null);
  assertAbsent(screen.queryByLabelText(/^包车时长/));
  assert.ok(screen.getByText("包车时长：按行程自动选套餐"));
  const before = quotes(calls).length;
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal(quotes(calls).length, before, "停留时长没选不报价");
  await actor.click(screen.getByRole("button", { name: "下一步：选择车型" }));
  assert.ok(screen.getByText("请选择停留时长"));
  assert.equal(screen.getByLabelText(/^经停点 1 停留时长/).getAttribute("aria-invalid"), "true");

  await actor.selectOptions(screen.getByLabelText(/^经停点 1 停留时长/), "60");
  await waitFor(() => assertAbsent(screen.queryByText("请选择停留时长")));
  await addStop(actor, "河口湖", "90");
  await addStop(actor, "忠灵塔", "30");
  await waitFor(() => assert.ok(screen.getByText("按行程预计 7 小时 30 分（行驶 4 小时 30 分 + 停留 3 小时），全程约 254 公里，套餐 10 小时")), SLOW);
  const body = quotes(calls).at(-1) as Record<string, unknown>;
  assert.equal(body["itinerary_pricing"], true);
  assert.equal("package_hours" in body, false);
  assert.deepEqual(body["waypoints"], [
    { name: "五合目", lat: 35.395, lng: 138.733, stay_minutes: 60 },
    { name: "河口湖", lat: 35.498, lng: 138.769, stay_minutes: 90 },
    { name: "忠灵塔", lat: 35.501, lng: 138.801, stay_minutes: 30 },
  ]);
});

test("按行程计价：车型卡、右侧栏、核对页显示明细（套餐、经停加价带区域名和第几个经停点），各项之和 = 总价；行程时间表有各段行驶和各点停留；提示可能加收；下单只带报价编号", async () => {
  wideScreen();
  const calls = open(
    (call) => json(200, (call.body as Record<string, unknown>)["itinerary_pricing"] === true ? itineraryResult() : plainResult),
    () => json(201, { order: {}, timeline: [], names: {}, payment: null, link: { token: `nzo_${"b".repeat(43)}`, expires_at: "2030-12-01T00:00:00.000Z" } }),
  );
  const actor = user();
  await screen.findByRole("heading", { name: "车型1" }, SLOW);
  await actor.click(screen.getByRole("button", { name: "上一步" }));
  await addStop(actor, "五合目", "60");
  await addStop(actor, "河口湖", "90");
  await addStop(actor, "忠灵塔", "30");
  await actor.click(screen.getByRole("button", { name: "下一步：选择车型" }));
  await waitFor(() => assert.match(screen.getByRole("heading", { name: "车型1" }).closest("li")?.textContent ?? "", /71,500 JPY/), SLOW);
  const card = screen.getByRole("heading", { name: "车型1" }).closest("li") as HTMLElement;
  const rows = [...within(card).getByLabelText("价格明细").querySelectorAll(".price-breakdown__row")].map((row) => [row.querySelector("dt")?.textContent, row.querySelector("dd")?.textContent]);
  assert.deepEqual(rows, [
    ["包车套餐 10 小时", "60,500 JPY"],
    ["行程加价（富士山地区，2、3、4 · 经停）", "11,000 JPY"],
  ]);
  const schedule = screen.getByRole("list", { name: "行程" });
  assert.deepEqual(
    [...schedule.querySelectorAll("li")].map((item) => item.textContent),
    ["1 上车京王广场酒店", "行驶约 2 小时 · 120 公里2 经停五合目停留 1 小时", "行驶约 30 分钟 · 20 公里3 经停河口湖停留 1 小时 30 分", "行驶约 10 分钟 · 4 公里4 经停忠灵塔停留 30 分钟", "行驶约 1 小时 50 分 · 110 公里5 下车新宿站"],
  );
  // 行程地图（M9P-20）：5 个点按顺序，编号和列表一致；alt 写全程
  const mapLoader = document.querySelector<HTMLImageElement>(".itinerary-map__loader") as HTMLImageElement;
  assert.deepEqual(new URL(mapLoader.src, "http://localhost").searchParams.getAll("p"), ["35.690500,139.694800", "35.395000,138.733000", "35.498000,138.769000", "35.501000,138.801000", "35.689600,139.700600"]);
  fireEvent.load(mapLoader);
  await waitFor(() => assert.equal(document.querySelector(".itinerary-map .route-map__image")?.getAttribute("alt"), "路线图：1 京王广场酒店 → 2 五合目 → 3 河口湖 → 4 忠灵塔 → 5 新宿站，约 7 小时 30 分 · 254 公里"));
  assert.ok(screen.getByText("价格按您填的经停点计算；当天临时去其他区域或超出预计可能会加收。"));
  // M9W-05：按行程计价时超公里已算进价格、用时超出套餐另收（M9P-04 改），「一口价包含」下面用按行程计价的那一句，不用不按行程计价的「超出套餐的时长和公里服务后按实际收取」
  const includes = screen.getByRole("heading", { name: "一口价包含" }).closest("section") as HTMLElement;
  assert.ok(within(includes).getByText("超公里已按预计行程算进价格；用时超出套餐、或当天超出预计的部分，服务后按实际收取：先通知您，48 小时内可以在订单页提异议。"));
  assert.doesNotMatch(includes.textContent ?? "", /超出套餐的时长和公里/);

  await actor.click(screen.getByRole("button", { name: "选择 车型1" }));
  const side = screen.getByRole("complementary", { name: "行程摘要" });
  const sideRows = [...within(side).getByLabelText("价格明细").querySelectorAll(".price-breakdown__row")].map((row) => row.textContent);
  assert.deepEqual(sideRows, ["包车套餐 10 小时60,500 JPY", "行程加价（富士山地区，2、3、4 · 经停）11,000 JPY", "合计71,500 JPY"]);
  const facts = [...side.querySelectorAll(".site-facts__item")].map((item) => item.querySelector("dt")?.textContent);
  assert.deepEqual(facts.slice(0, 6), ["用车类型", "上车地点", "经停点", "下车地点", "行程时长", "用车时间（当地时间）"]);
  assert.match(side.textContent ?? "", /包车 10 小时（按行程）/);
  assert.match(side.textContent ?? "", /2 五合目（停留 1 小时）/);

  await actor.click(screen.getByRole("button", { name: "下一步：填写乘客信息" }));
  await screen.findByRole("heading", { name: "乘客信息", level: 2 });
  await actor.type(screen.getByLabelText("乘车人姓名"), "王小明");
  await actor.type(screen.getByLabelText("邮箱"), "guest@example.com");
  await actor.type(screen.getByLabelText("手机号（含国家区号）"), "+86 138 0000 0000");
  await actor.click(screen.getByRole("button", { name: "下一步：核对订单" }));
  const review = await screen.findByRole("region", { name: "核对订单" });
  assert.ok(within(review).getByLabelText("价格明细"));
  assert.ok(within(review).getByText(/价格按您填的经停点计算/));
  await actor.click(screen.getByRole("checkbox", { name: /同意保存这次付款用的银行卡/ }));
  await actor.click(screen.getByRole("button", { name: "去付款 →" }));
  await waitFor(() => assert.equal(calls.filter((call) => call.path === "/site/v1/orders").length, 1));
  const order = calls.find((call) => call.path === "/site/v1/orders")?.body as Record<string, unknown>;
  assert.equal(order["quote_id"], "QT203011200000000001");
});

test("明细加起来不等于总价：不显示明细，只显示总价（价格不能显示错）", async () => {
  wideScreen();
  open((call) => json(200, (call.body as Record<string, unknown>)["itinerary_pricing"] === true ? itineraryResult(FUJI_BREAKDOWN, 71_600) : plainResult));
  const actor = user();
  await screen.findByRole("heading", { name: "车型1" }, SLOW);
  await actor.click(screen.getByRole("button", { name: "上一步" }));
  await addStop(actor, "五合目", "60");
  await actor.click(screen.getByRole("button", { name: "下一步：选择车型" }));
  await waitFor(() => assert.match(screen.getByRole("heading", { name: "车型1" }).closest("li")?.textContent ?? "", /71,600 JPY/), SLOW);
  assertAbsent(screen.queryByLabelText("价格明细"));
  assertAbsent(screen.queryByText("60,500 JPY"));
});

test("M8-43：明细里金额为 0 的超公里费 / 超时费不列，不是 0 的照旧列（车型卡、右侧栏）；合计仍是总价", async () => {
  wideScreen();
  // 10 小时套餐 60,500 + 途经 11,000 + 超公里 0 + 超时 3,000 = 74,500
  const breakdown: SiteQuote["price_breakdown"] = [...(FUJI_BREAKDOWN ?? []), { kind: "over_km", amount: yen(0), area_name: null, stop_seqs: null }, { kind: "overtime", amount: yen(3_000), area_name: null, stop_seqs: null }];
  open((call) => json(200, (call.body as Record<string, unknown>)["itinerary_pricing"] === true ? itineraryResult(breakdown, 74_500) : plainResult));
  const actor = user();
  await screen.findByRole("heading", { name: "车型1" }, SLOW);
  await actor.click(screen.getByRole("button", { name: "上一步" }));
  await addStop(actor, "五合目", "60");
  await actor.click(screen.getByRole("button", { name: "下一步：选择车型" }));
  await waitFor(() => assert.match(screen.getByRole("heading", { name: "车型1" }).closest("li")?.textContent ?? "", /74,500 JPY/), SLOW);
  const card = screen.getByRole("heading", { name: "车型1" }).closest("li") as HTMLElement;
  const rows = [...within(card).getByLabelText("价格明细").querySelectorAll(".price-breakdown__row")].map((row) => row.textContent);
  assert.deepEqual(rows, ["包车套餐 10 小时60,500 JPY", "行程加价（富士山地区，2、3、4 · 经停）11,000 JPY", "超时费3,000 JPY"]);
  assertAbsent(within(card).queryByText("超公里费"));

  await actor.click(screen.getByRole("button", { name: "选择 车型1" }));
  const side = screen.getByRole("complementary", { name: "行程摘要" });
  const sideRows = [...within(side).getByLabelText("价格明细").querySelectorAll(".price-breakdown__row")].map((row) => row.textContent);
  assert.deepEqual(sideRows, ["包车套餐 10 小时60,500 JPY", "行程加价（富士山地区，2、3、4 · 经停）11,000 JPY", "超时费3,000 JPY", "合计74,500 JPY"]);
});

test("经停点不在任何区域（WAYPOINT_NOT_PRICED）：指出第几个经停点和它的名字，转人工报价，不显示内部代码；人工报价带上经停点、不带之前选的时长（M9W-04）", async () => {
  wideScreen();
  const calls = open((call) =>
    json(200, (call.body as Record<string, unknown>)["itinerary_pricing"] === true ? ({ currency: "JPY", quotes: [], unavailable: [{ vehicle_group_id: null, reasons: ["WAYPOINT_NOT_PRICED"], waypoint_stop_seqs: [2] }] } satisfies SiteQuoteResult) : plainResult),
  );
  const actor = user();
  await screen.findByRole("heading", { name: "车型1" }, SLOW);
  await actor.click(screen.getByRole("button", { name: "上一步" }));
  await addStop(actor, "五合目", "60");
  await addStop(actor, "河口湖", "60");
  await actor.click(screen.getByRole("button", { name: "下一步：选择车型" }));
  assert.ok(await screen.findByText("3 号点「河口湖」暂时没有在线报价，请联系客服人工报价，或去掉这个经停点再试。", {}, SLOW));
  assert.ok(screen.getByRole("heading", { name: "没有可预订的车" }));
  assert.equal(screen.getByRole("link", { name: "+81 3-1234-5678" }).getAttribute("href"), "tel:+81312345678");
  assert.doesNotMatch(document.body.textContent ?? "", /WAYPOINT_NOT_PRICED/);
  const manual = screen.getByRole("region", { name: "请客服人工报价" });
  await actor.type(within(manual).getByLabelText("邮箱"), "guest@example.com");
  await actor.click(within(manual).getByRole("button", { name: "提交" }));
  assert.ok(await screen.findByText(/已收到/, {}, SLOW));
  const sent = calls.filter((call) => call.method === "POST" && call.path === "/site/v1/manual-quote-requests").map((call) => (call.body as { trip: Record<string, unknown> }).trip);
  assert.deepEqual(sent.map((trip) => [trip["category"], trip["package_hours"], trip["waypoints"]]), [
    ["charter", null, [{ name: "五合目", ...SPOTS["五合目"], stay_minutes: 60 }, { name: "河口湖", ...SPOTS["河口湖"], stay_minutes: 60 }]],
  ]);
});

test("M9W-10：经停点所在加价区域没设途经加价（对外同样是 WAYPOINT_NOT_PRICED）、另有商品报 NOT_AVAILABLE：指出是哪个经停点，其余用新的通用说法，不叫客人换时间", async () => {
  wideScreen();
  open((call) =>
    json(200, (call.body as Record<string, unknown>)["itinerary_pricing"] === true ? ({ currency: "JPY", quotes: [], unavailable: [{ vehicle_group_id: null, reasons: ["NOT_AVAILABLE", "WAYPOINT_NOT_PRICED"], waypoint_stop_seqs: [1] }] } satisfies SiteQuoteResult) : plainResult),
  );
  const actor = user();
  await screen.findByRole("heading", { name: "车型1" }, SLOW);
  await actor.click(screen.getByRole("button", { name: "上一步" }));
  await addStop(actor, "五合目", "60");
  await addStop(actor, "河口湖", "60");
  await actor.click(screen.getByRole("button", { name: "下一步：选择车型" }));
  assert.ok(await screen.findByText("2 号点「五合目」暂时没有在线报价，请联系客服人工报价，或去掉这个经停点再试。", {}, SLOW));
  assert.ok(screen.getByText("这个行程暂时无法在线报价，请联系客服人工报价，或调整行程后再试。"));
  assertAbsent(screen.queryByText(/河口湖」暂时没有在线报价/));
  assert.equal(screen.getByRole("link", { name: "+81 3-1234-5678" }).getAttribute("href"), "tel:+81312345678");
  assert.doesNotMatch(document.body.textContent ?? "", /换一个时间|WAYPOINT_NOT_PRICED|NOT_AVAILABLE/);
  assert.ok(screen.getByRole("region", { name: "请客服人工报价" }));
});

test("按行程计价有一段路线算不出来（422 ITINERARY_ROUTE_UNAVAILABLE）：说清是哪两个点之间，转人工报价", async () => {
  wideScreen();
  open((call) => ((call.body as Record<string, unknown>)["itinerary_pricing"] === true ? apiError(422, "ITINERARY_ROUTE_UNAVAILABLE", "路线取不到", { leg: 2, reason: "NO_ROUTE" }) : json(200, plainResult)));
  const actor = user();
  await screen.findByRole("heading", { name: "车型1" }, SLOW);
  await actor.click(screen.getByRole("button", { name: "上一步" }));
  await addStop(actor, "五合目", "60");
  await actor.click(screen.getByRole("button", { name: "下一步：选择车型" }));
  assert.ok(await screen.findByText("第 2 段（2「五合目」→ 3「新宿站」）路线暂时算不出来，没有在线报价。请联系客服人工报价，或调整经停点再试。", {}, SLOW));
  assert.ok(screen.getByRole("heading", { name: "没有在线报价" }));
  assertAbsent(screen.queryByRole("button", { name: "重试" }));
});

test("M9W-08：选了谷歌候选、坐标还没取回来时先选停留时长——坐标回来后停留时长不被清掉，询价带上这个点和停留", async () => {
  wideScreen();
  let release: (() => void) | undefined;
  const slow = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fast = placeDetails;
  placeDetails = async () => {
    await slow;
    return fast();
  };
  try {
    const calls = open((call) => json(200, (call.body as Record<string, unknown>)["itinerary_pricing"] === true ? itineraryResult() : plainResult));
    const actor = user();
    await screen.findByRole("heading", { name: "车型1" }, SLOW);
    await actor.click(screen.getByRole("button", { name: "上一步" }));
    await actor.click(screen.getByRole("button", { name: "添加经停点" }));
    const box = screen.getByRole("combobox", { name: "经停点 1" });
    await actor.type(box, GOOGLE_SPOT.name);
    await actor.click(await screen.findByRole("option", { name: new RegExp(GOOGLE_SPOT.name) }, SLOW));
    await waitFor(() => assert.ok(calls.some((call) => call.path.includes("/places/details"))));
    await actor.selectOptions(screen.getByLabelText(/^经停点 1 停留时长/), "120");
    release?.();
    await waitFor(() => assert.ok(quotes(calls).some((body) => Array.isArray(body["waypoints"]))), SLOW);
    assert.equal((screen.getByLabelText(/^经停点 1 停留时长/) as HTMLSelectElement).value, "120");
    assert.deepEqual((quotes(calls).at(-1) as Record<string, unknown>)["waypoints"], [{ name: `${GOOGLE_SPOT.name}（${GOOGLE_SPOT.address}）`, lat: 35.395, lng: 138.733, stay_minutes: 120 }]);
  } finally {
    placeDetails = fast;
  }
});

test("M9P-03：有经停点时也能手动升到更长的套餐——下拉默认「自动（5 小时）」，只列比自动选的档长的（没有 4 小时）；选 10 小时重新报价，请求带 itinerary_pricing + package_hours；改经停点回到自动", async () => {
  wideScreen();
  packageHours = [4, 5, 8, 10];
  // 自动选 5 小时（预计用时 4 小时 30 分）；手动选的档按那一档报价，报价里照样带自动选的档
  const answer = (body: Record<string, unknown>): SiteQuoteResult => {
    const hours = typeof body["package_hours"] === "number" ? body["package_hours"] : 5;
    const total = hours === 10 ? 66_000 : 47_300;
    return { ...itineraryResult([{ kind: "base", amount: yen(total), area_name: null, stop_seqs: null }], total), quotes: [{ ...quoteOf(1, total, [{ kind: "base", amount: yen(total), area_name: null, stop_seqs: null }]), package: { hours, km: 200 }, estimated_minutes: 270, includes_buffer: false, auto_package_hours: 5 }] };
  };
  try {
    const calls = open((call) => json(200, answer(call.body as Record<string, unknown>)));
    const actor = user();
    await screen.findByRole("button", { name: "添加经停点" }, SLOW);
    await addStop(actor, "五合目", "120");
    const select = (await screen.findByLabelText(/^包车时长/, {}, SLOW)) as HTMLSelectElement;
    assert.deepEqual([...select.options].map((option) => [option.value, option.textContent]), [["", "自动（5 小时）"], ["8", "8 小时"], ["10", "10 小时"]]);
    assertAbsent(within(select).queryByRole("option", { name: "4 小时" }));
    assert.equal(select.value, "");
    assert.equal("package_hours" in (quotes(calls).at(-1) as Record<string, unknown>), false, "自动选档时不带 package_hours");

    await actor.selectOptions(select, "10");
    await waitFor(() => assert.equal((quotes(calls).at(-1) as Record<string, unknown>)["package_hours"], 10), SLOW);
    const body = quotes(calls).at(-1) as Record<string, unknown>;
    assert.deepEqual([body["itinerary_pricing"], Array.isArray(body["waypoints"])], [true, true]);
    await actor.click(screen.getByRole("button", { name: "下一步：选择车型" }));
    await waitFor(() => assert.match(screen.getByRole("heading", { name: "车型1" }).closest("li")?.textContent ?? "", /66,000 JPY/), SLOW);
    assert.ok(screen.getAllByText(/套餐 10 小时/).length > 0);

    // 改了经停点（行程变了）：回到自动选档
    await actor.click(screen.getByRole("button", { name: "上一步" }));
    await addStop(actor, "河口湖", "60");
    await waitFor(() => assert.equal("package_hours" in (quotes(calls).at(-1) as Record<string, unknown>), false), SLOW);
    assert.equal(((await screen.findByLabelText(/^包车时长/, {}, SLOW)) as HTMLSelectElement).value, "");
  } finally {
    packageHours = [8];
  }
});

test("M9P-04：两个车型自动档不同（用例 10：车型1 5 小时、车型2 4 小时）——没选车型时写范围、只列比最长的长的；选了车型按它自己的档；车型卡套餐下面写预计用时（含缓冲）", async () => {
  wideScreen();
  packageHours = [4, 5, 6, 8];
  const kamakura = (base: number) => [
    { kind: "base" as const, amount: yen(base), area_name: null, stop_seqs: null },
    { kind: "waypoint" as const, amount: yen(8_000), area_name: { zh: "镰仓" }, stop_seqs: [1] },
  ];
  const answer = (body: Record<string, unknown>): SiteQuoteResult => {
    const hours = typeof body["package_hours"] === "number" ? body["package_hours"] : null;
    return {
      ...itineraryResult(),
      quotes: [
        { ...quoteOf(1, 41_000, kamakura(33_000)), package: { hours: hours ?? 5, km: 150 }, estimated_minutes: 252, includes_buffer: true, auto_package_hours: 5 },
        { ...quoteOf(2, 44_000, kamakura(36_000)), package: { hours: hours ?? 4, km: 120 }, estimated_minutes: 240, includes_buffer: true, auto_package_hours: 4 },
      ],
    };
  };
  try {
    const calls = open((call) => json(200, answer(call.body as Record<string, unknown>)));
    const actor = user();
    await screen.findByRole("button", { name: "添加经停点" }, SLOW);
    await addStop(actor, "五合目", "30");
    const options = async (): Promise<string[][]> => [...((await screen.findByLabelText(/^包车时长/, {}, SLOW)) as HTMLSelectElement).options].map((option) => [option.value, option.textContent ?? ""]);
    await waitFor(async () => assert.deepEqual(await options(), [["", "自动（按车型 4–5 小时）"], ["6", "6 小时"], ["8", "8 小时"]]), SLOW);

    await actor.click(screen.getByRole("button", { name: "下一步：选择车型" }));
    const card = async (name: string): Promise<HTMLElement> => (await screen.findByRole("heading", { name }, SLOW)).closest("li") as HTMLElement;
    // 车型卡：套餐那一行下面是这个车型自己的预计用时
    assert.match((await card("车型1")).textContent ?? "", /包车套餐 5 小时预计用时 4 小时 12 分钟（含缓冲）33,000 JPY/);
    assert.match((await card("车型1")).textContent ?? "", /行程加价（镰仓，2 · 经停）8,000 JPY/);
    assert.match((await card("车型2")).textContent ?? "", /包车套餐 4 小时预计用时 4 小时（含缓冲）36,000 JPY/);

    // 选车型1：下拉按它的 5 小时，不列 4、5 小时；只是显示变了，请求体不变（不带 package_hours）
    await actor.click(within(await card("车型1")).getByRole("button", { pressed: false }));
    await actor.click(screen.getByRole("button", { name: "上一步" }));
    await waitFor(async () => assert.deepEqual(await options(), [["", "自动（5 小时）"], ["6", "6 小时"], ["8", "8 小时"]]), SLOW);
    assert.equal("package_hours" in (quotes(calls).at(-1) as Record<string, unknown>), false);

    // 换成车型2：按它的 4 小时，5 小时也能选
    await actor.click(screen.getByRole("button", { name: "下一步：选择车型" }));
    await actor.click(within(await card("车型2")).getByRole("button", { pressed: false }));
    await actor.click(screen.getByRole("button", { name: "上一步" }));
    await waitFor(async () => assert.deepEqual(await options(), [["", "自动（4 小时）"], ["5", "5 小时"], ["6", "6 小时"], ["8", "8 小时"]]), SLOW);
  } finally {
    packageHours = [8];
  }
});

test("M9P-04：不填经停点、选的时长低于另一车型的最低套餐——写「有一个车型最短 10 小时」并给「改选 10 小时」，点了按 10 小时重新询价", async () => {
  wideScreen();
  packageHours = [8, 10];
  const answer = (body: Record<string, unknown>): SiteQuoteResult =>
    body["package_hours"] === 10
      ? { currency: "JPY", quotes: [quoteOf(1, 99_000, [{ kind: "base", amount: yen(99_000), area_name: null, stop_seqs: null }]), quoteOf(2, 110_000, [{ kind: "base", amount: yen(110_000), area_name: null, stop_seqs: null }])], unavailable: [] }
      : { ...plainResult, unavailable: [{ vehicle_group_id: "33333333-3333-4333-8333-333333333302", reasons: ["PACKAGE_TOO_SHORT"], min_package_hours: 10 }] };
  try {
    const calls = open((call) => json(200, answer(call.body as Record<string, unknown>)));
    const actor = user();
    await waitFor(() => assert.ok([...(screen.getByLabelText(/^包车时长/) as HTMLSelectElement).options].some((option) => option.value === "8")), SLOW);
    await waitFor(async () => {
      await actor.selectOptions(screen.getByLabelText(/^包车时长/), "8");
      assert.equal((quotes(calls).at(-1) as Record<string, unknown> | undefined)?.["package_hours"], 8);
    }, SLOW);
    const next = screen.queryByRole("button", { name: "下一步：选择车型" });
    if (next !== null) await actor.click(next);
    await waitFor(() => assert.match(document.querySelector("main")?.textContent ?? "", /有一个车型最短 10 小时，选 8 小时订不了。/), SLOW);
    assert.equal((quotes(calls).at(-1) as Record<string, unknown>)["package_hours"], 8);
    await actor.click(screen.getByRole("button", { name: "改选 10 小时" }));
    await waitFor(() => assert.equal((quotes(calls).at(-1) as Record<string, unknown>)["package_hours"], 10), SLOW);
    await waitFor(() => assert.match(document.querySelector("main")?.textContent ?? "", /110,000 JPY/), SLOW);
    assertAbsent(screen.queryByText(/最短 10 小时/));
  } finally {
    packageHours = [8];
  }
});
