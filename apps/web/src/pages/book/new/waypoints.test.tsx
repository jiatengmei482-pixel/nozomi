/**
 * 新预订页包车的经停点和按行程计价（M9W-02，ADR 0088；需求 charter-waypoint-surcharge.md 13.5）的组件测试：
 * 没有经停点时询价请求和以前完全一样；经停点增删、上下移动（焦点跟着走、播报）、最多 10 个；停留时长必填；
 * 有经停点时请求带 itinerary_pricing 和 waypoints、不带 package_hours，包车时长下拉换成「按行程自动选套餐」；
 * 车型卡、右侧栏、核对页的对外价明细（各项之和 = 总价；对不上时不显示明细）、行程时间表和提示；经停点报不出价时指出是哪一个。
 * 接口用测试替身（浏览器只连 /site/v1）；真实后端由 e2e/site-booking-waypoints.spec.ts 覆盖。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
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
    if (path === `/site/v1/cities/${CITY_ID}/charter-packages`) return json(200, { items: [{ hours: 8 }] });
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

test("没有经停点：询价请求和以前完全一样（字段、顺序都相同，没有 itinerary_pricing、waypoints），包车时长照旧手选，车型卡不显示明细和行程提示", async () => {
  wideScreen();
  const calls = open();
  await screen.findByRole("heading", { name: "车型1" }, SLOW);
  const body = quotes(calls).at(-1) as Record<string, unknown>;
  assert.deepEqual(Object.keys(body), ["category", "city_id", "pickup", "dropoff", "package_hours", "service_local", "passengers", "luggage", "pickup_name", "dropoff_name"].filter((key) => key in body));
  assert.deepEqual(body, { category: "charter", city_id: CITY_ID, pickup: { lat: 35.6905, lng: 139.6948 }, dropoff: { lat: 35.6896, lng: 139.7006 }, package_hours: 8, service_local: "2030-11-20T09:00", passengers: 2, luggage: 2, ...("pickup_name" in body ? { pickup_name: body["pickup_name"] } : {}), ...("dropoff_name" in body ? { dropoff_name: body["dropoff_name"] } : {}) });
  assert.equal("itinerary_pricing" in body, false);
  assert.equal("waypoints" in body, false);
  assertAbsent(screen.queryByLabelText("价格明细"));
  assertAbsent(screen.queryByText(/价格按您填的经停点计算/));
  assertAbsent(screen.queryByText("行程时间表"));
  // M9W-05：不按行程计价的包车，「一口价包含」下面的说法照旧
  const includes = screen.getByRole("heading", { name: "一口价包含" }).closest("section") as HTMLElement;
  assert.ok(within(includes).getByText("超出套餐的时长和公里服务后按实际收取：先通知您，48 小时内可以在订单页提异议。"));
  assert.doesNotMatch(includes.textContent ?? "", /按预计行程/);
});

test("经停点：添加、上下移动（焦点跟着这一行、播报新位置）、删除（焦点到下一行的删除）；第一行上移、最后一行下移禁用；最多 10 个", async () => {
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

  for (let index = 0; index < 8; index += 1) await actor.click(screen.getByRole("button", { name: "添加经停点" }));
  assert.equal(screen.getAllByRole("combobox", { name: /^经停点 \d+$/ }).length, 10);
  assert.equal((screen.getByRole("button", { name: "添加经停点" }) as HTMLButtonElement).disabled, true);
  assert.ok(screen.getByText("最多 10 个"));
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
    ["经停加价（富士山地区，第 1、2、3 个经停点）", "11,000 JPY"],
  ]);
  const schedule = screen.getByRole("list", { name: "行程" });
  assert.deepEqual(
    [...schedule.querySelectorAll("li")].map((item) => item.textContent),
    ["上车京王广场酒店", "行驶约 2 小时经停 1五合目停留 1 小时", "行驶约 30 分钟经停 2河口湖停留 1 小时 30 分", "行驶约 10 分钟经停 3忠灵塔停留 30 分钟", "行驶约 1 小时 50 分下车新宿站"],
  );
  assert.ok(screen.getByText("价格按您填的经停点计算；当天临时去其他区域或超出预计可能会加收。"));
  // M9W-05：按行程计价时超公里、超时已算进价格，「一口价包含」下面不再说「超出套餐服务后按实际收取」
  const includes = screen.getByRole("heading", { name: "一口价包含" }).closest("section") as HTMLElement;
  assert.ok(within(includes).getByText("超公里、超时已按预计行程算进价格，只有当天超出预计的部分服务后按实际收取：先通知您，48 小时内可以在订单页提异议。"));
  assert.doesNotMatch(includes.textContent ?? "", /超出套餐的时长和公里/);

  await actor.click(screen.getByRole("button", { name: "选择 车型1" }));
  const side = screen.getByRole("complementary", { name: "行程摘要" });
  const sideRows = [...within(side).getByLabelText("价格明细").querySelectorAll(".price-breakdown__row")].map((row) => row.textContent);
  assert.deepEqual(sideRows, ["包车套餐 10 小时60,500 JPY", "经停加价（富士山地区，第 1、2、3 个经停点）11,000 JPY", "合计71,500 JPY"]);
  const facts = [...side.querySelectorAll(".site-facts__item")].map((item) => item.querySelector("dt")?.textContent);
  assert.deepEqual(facts.slice(0, 6), ["用车类型", "上车地点", "经停点", "下车地点", "行程时长", "用车时间（当地时间）"]);
  assert.match(side.textContent ?? "", /包车 10 小时（按行程）/);
  assert.match(side.textContent ?? "", /五合目（停留 1 小时）/);

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
  assert.ok(await screen.findByText("第 2 个经停点「河口湖」暂时没有在线报价，请联系客服人工报价，或去掉这个经停点再试。", {}, SLOW));
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

test("按行程计价有一段路线算不出来（422 ITINERARY_ROUTE_UNAVAILABLE）：说清是哪两个点之间，转人工报价", async () => {
  wideScreen();
  open((call) => ((call.body as Record<string, unknown>)["itinerary_pricing"] === true ? apiError(422, "ITINERARY_ROUTE_UNAVAILABLE", "路线取不到", { leg: 2, reason: "NO_ROUTE" }) : json(200, plainResult)));
  const actor = user();
  await screen.findByRole("heading", { name: "车型1" }, SLOW);
  await actor.click(screen.getByRole("button", { name: "上一步" }));
  await addStop(actor, "五合目", "60");
  await actor.click(screen.getByRole("button", { name: "下一步：选择车型" }));
  assert.ok(await screen.findByText("「五合目」到「新宿站」这一段路线暂时算不出来，没有在线报价。请联系客服人工报价，或调整经停点再试。", {}, SLOW));
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
