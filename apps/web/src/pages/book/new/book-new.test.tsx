/**
 * 新预订页 `/book/new`（M8-03，ADR 0069 A3、修正版 v2；规范 site-booking-v2.md）的组件测试：
 * 地址框输入即提示（至少 2 个字、停顿后查、会话令牌、平台地点在前、谷歌候选选中后取坐标）、认出接机后的时间标签和提示（N 取报价）、
 * 「乘客 / 行李」合并栏、车型「显示全部」（电脑 4 个、手机 3 个）、车内示意图的座位和行李个数、编号和文字、链接参数、报不出价的说法、
 * 包车下不写「含所有费用」、任何时候都没有「跟踪航班」、手机分步和底部固定条；
 * M8-04：「怎么联系你」的校验和下单、附加服务改数量重新报价和合计差额、参考价可用 / 不可用、路线有 / 无、手机第 3 步。
 * 接口用测试替身（浏览器只连 /site/v1）；真实后端由 e2e/site-booking-new.spec.ts 覆盖。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../../App.tsx";
import type { MapTiles } from "../../../api/areas.ts";
import type { SiteByPointsResult, SiteCity, SiteConfig, SiteQuote, SiteQuoteResult } from "../../../api/site.ts";
import { type ApiCall, apiError, assertAbsent, assertFocused, currentLocation, json, narrowScreen, resetBrowser, stubApiWith } from "../../../testing/harness.tsx";

const originalMatchMedia = window.matchMedia;
afterEach(() => {
  resetBrowser();
  window.matchMedia = originalMatchMedia;
});

/** 电脑宽度（≥ 1024px）。 */
function wideScreen(): void {
  window.matchMedia = ((query: string) => ({ matches: query.includes("min-width: 1024px"), media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false })) as typeof window.matchMedia;
}

const SLOW = { timeout: 3000 };
const CITY_ID = "11111111-1111-4111-8111-111111111111";
const AIRPORT_ID = "22222222-2222-4222-8222-222222222222";
const city: SiteCity = { id: CITY_ID, code: "CTY-JP-TYO", name: { zh: "东京" }, timezone: "Asia/Tokyo", country_code: "JP", center: { lat: 35.6895, lng: 139.6917 }, categories: ["airport_transfer", "point_to_point", "charter"] };
const configOf = (changes: Partial<SiteConfig> = {}): SiteConfig => ({ open: true, currency: "JPY", payments: null, support_phone: "+81 3-1234-5678", address_search: true, map_tiles: null, ...changes });
const airportSuggestion = { source: "platform", id: AIRPORT_ID, name: "成田国际机场", address: "", location: { lat: 35.772, lng: 140.3929 }, kind: "airport" } as const;
const hotelSuggestion = { source: "google", id: "ChIJkeio", name: "京王广场酒店", address: "东京都新宿区西新宿 2-2-1", location: null, kind: "other" } as const;

function quoteOf(index: number, changes: { passengers?: number; luggage?: number; freeWait?: number | null; amount?: number; package?: SiteQuote["package"]; addons?: SiteQuote["available_addons"]; id?: string } = {}): SiteQuote {
  return {
    quote_id: changes.id ?? `QT2030112000000000${String(index).padStart(2, "0")}`,
    expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    service_date: "2030-11-20",
    urgent: false,
    vehicle_group: {
      id: `33333333-3333-4333-8333-3333333333${String(index).padStart(2, "0")}`,
      code: `VG-T${index}`,
      name: { zh: `车型${index}` },
      grade: "economy",
      seats: 7,
      sample_models: ["Toyota Noah", "Toyota Voxy"],
      combos: [{ passengers: changes.passengers ?? 6, luggage: changes.luggage ?? 4 }],
    },
    package: changes.package ?? null,
    price: { total: { amount: String(changes.amount ?? 18000 + index * 1000), currency: "JPY" }, fx: null },
    free_wait_minutes: changes.freeWait === undefined ? 60 : changes.freeWait,
    cancel_policy: { category: "airport_transfer", level: "economy", tiers: [{ min_hours_before: 24, fee_bp: 0 }, { min_hours_before: 0, fee_bp: 10000 }] },
    available_addons: changes.addons ?? [],
  };
}

function byPoints(changes: Partial<SiteByPointsResult> = {}): SiteByPointsResult {
  return {
    trip_type: "pickup",
    airport: { id: AIRPORT_ID, code: "NRT", name: { zh: "成田国际机场" }, matched_by: "kind", distance_meters: 0 },
    city: { id: CITY_ID, code: "CTY-JP-TYO", name: { zh: "东京" }, timezone: "Asia/Tokyo" },
    currency: "JPY",
    quotes: [quoteOf(1)],
    unavailable: [],
    expires_at: null,
    route: null,
    ...changes,
  };
}

type Route = (call: ApiCall & { url: URL }) => Response | Promise<Response> | null;
interface Options {
  config?: SiteConfig;
  quote?: Route;
  charter?: Route;
  autocomplete?: Route;
  fx?: Route;
  order?: Route;
  at?: string;
}

function open(options: Options = {}): ApiCall[] {
  const calls = stubApiWith((call) => {
    const path = call.url.pathname;
    if (path === "/site/v1/config") return json(200, options.config ?? configOf());
    if (path === "/site/v1/cities") return json(200, { items: [city] });
    if (path === "/site/v1/places/autocomplete") {
      const custom = options.autocomplete?.(call);
      if (custom) return custom;
      const q = call.url.searchParams.get("q") ?? "";
      return json(200, { available: true, items: q.includes("成田") || q === "NRT" ? [airportSuggestion, { ...hotelSuggestion, id: "ChIJnrt", name: "成田站" }] : [hotelSuggestion] });
    }
    if (path === "/site/v1/places/details") return json(200, { available: true, place: { id: "ChIJkeio", address: hotelSuggestion.address, location: { lat: 35.6905, lng: 139.6948 }, kind: "other" } });
    if (path === `/site/v1/cities/${CITY_ID}/places`) return json(200, { items: [{ id: "55555555-5555-4555-8555-555555555555", type: "station", code: "STN-NRT", name: { zh: "成田站" }, address: null, location: { lat: 35.776, lng: 140.318 } }, { id: AIRPORT_ID, type: "airport", code: "NRT", name: { zh: "成田国际机场" }, address: null, location: { lat: 35.772, lng: 140.3929 } }] });
    if (path === `/site/v1/cities/${CITY_ID}/charter-packages`) return json(200, { items: [{ hours: 8 }] });
    if (call.method === "POST" && path === "/site/v1/quotes/by-points") return options.quote?.(call) ?? json(200, byPoints());
    if (path === "/site/v1/fx/reference") return options.fx?.(call) ?? json(200, { available: false, from: "JPY", to: call.url.searchParams.get("to"), rate: null, as_of: null, reason: "NO_RATE" });
    if (call.method === "POST" && path === "/site/v1/orders") return options.order?.(call) ?? null;
    if (call.method === "GET" && path === "/site/v1/order") return apiError(503, "SERVICE_UNAVAILABLE", "x");
    if (call.method === "POST" && path === "/site/v1/quotes") return options.charter?.(call) ?? json(200, { currency: "JPY", quotes: [quoteOf(1, { freeWait: 0, package: { hours: 8, km: 150 } })], unavailable: [] } satisfies SiteQuoteResult);
    return null;
  });
  render(
    <MemoryRouter initialEntries={[options.at ?? "/book/new"]}>
      <App />
    </MemoryRouter>,
  );
  return calls;
}

const user = () => userEvent.setup();
const posts = (calls: ApiCall[], path = "/site/v1/quotes/by-points"): ApiCall[] => calls.filter((call) => call.method === "POST" && call.path === path);

async function pickPlace(actor: ReturnType<typeof user>, label: string, query: string, option: RegExp): Promise<void> {
  const box = await screen.findByRole("combobox", { name: label });
  await actor.clear(box);
  await actor.type(box, query);
  await actor.click(await screen.findByRole("option", { name: option }, SLOW));
}

async function fillTrip(actor: ReturnType<typeof user>): Promise<void> {
  await pickPlace(actor, "出发地", "成田", /成田国际机场/);
  await pickPlace(actor, "目的地", "京王", /京王广场酒店/);
  const date = screen.getByLabelText("日期（当地）") as HTMLInputElement;
  await actor.clear(date);
  await actor.type(date, "2030-11-20");
  await actor.type(screen.getByLabelText(/时间（当地）/), "14:30");
}

test("地址框：不到 2 个字不查；停顿后带会话令牌查；平台的机场在前；谷歌候选选中后用同一个会话令牌取坐标，之后换新令牌；报价带名称、坐标和类型", async () => {
  wideScreen();
  const calls = open();
  const actor = user();
  const from = await screen.findByRole("combobox", { name: "出发地" });
  await actor.type(from, "成");
  assert.ok(await screen.findByText("请至少输入 2 个字，如酒店名、地址或机场"));
  assert.equal(calls.filter((call) => call.path.includes("autocomplete")).length, 0);
  await actor.type(from, "田");
  const list = await screen.findByRole("listbox", { name: "出发地的候选" }, SLOW);
  const options = within(list).getAllByRole("option");
  assert.deepEqual(options.map((option) => option.textContent), ["成田国际机场机场", "成田站东京都新宿区西新宿 2-2-1"]);
  const asked = calls.filter((call) => call.path.includes("autocomplete"));
  assert.equal(asked.length, 1, "停顿后只查一次");
  assert.equal(new URL(asked[0]?.path ?? "", "http://x").searchParams.get("q"), "成田");
  assert.equal(from.getAttribute("aria-expanded"), "true");
  // 键盘：↓ 移到第二个，↑ 回到第一个，回车选中
  await actor.keyboard("{ArrowDown}");
  assert.equal(from.getAttribute("aria-activedescendant"), options[1]?.id);
  await actor.keyboard("{ArrowUp}{Enter}");
  assert.equal((from as HTMLInputElement).value, "成田国际机场");
  assert.equal(from.getAttribute("aria-expanded"), "false");

  await pickPlace(actor, "目的地", "京王广场", /京王广场酒店/);
  const session = new URL(calls.filter((call) => call.path.includes("autocomplete")).at(-1)?.path ?? "", "http://x").searchParams.get("session");
  const details = calls.find((call) => call.path.includes("/places/details"));
  assert.ok(session !== null && session.length >= 16);
  assert.equal(new URL(details?.path ?? "", "http://x").searchParams.get("session"), session, "取坐标和输入即提示同一个会话令牌");
  assert.equal((screen.getByRole("combobox", { name: "目的地" }) as HTMLInputElement).value, "京王广场酒店（东京都新宿区西新宿 2-2-1）");
  await pickPlace(actor, "目的地", "京王广场", /京王广场酒店/);
  const sessions = calls.filter((call) => call.path.includes("autocomplete")).map((call) => new URL(call.path, "http://x").searchParams.get("session"));
  assert.notEqual(sessions.at(-1), session, "选中之后换新的会话令牌");

  const date = screen.getByLabelText("日期（当地）") as HTMLInputElement;
  await actor.clear(date);
  await actor.type(date, "2030-11-20");
  await actor.type(screen.getByLabelText(/时间（当地）/), "14:30");
  await screen.findByRole("heading", { name: "车型1" }, SLOW);
  assert.deepEqual(posts(calls).at(-1)?.body, {
    pickup: { name: "成田国际机场", lat: 35.772, lng: 140.3929, kind: "airport" },
    dropoff: { name: "京王广场酒店（东京都新宿区西新宿 2-2-1）", lat: 35.6905, lng: 139.6948, kind: "other" },
    service_local: "2030-11-20T14:30",
    passengers: 2,
    luggage: 2,
  });
  assert.ok(calls.every((call) => !/google/i.test(call.path)), "浏览器不连谷歌");
});

test("地址框：谷歌用不了时只有平台的地点，状态行说明", async () => {
  wideScreen();
  open({ autocomplete: () => json(200, { available: false, items: [airportSuggestion] }) });
  const actor = user();
  await actor.type(await screen.findByRole("combobox", { name: "出发地" }), "成田");
  assert.ok(await screen.findByText(/地址提示暂时用不了，下面只有平台的机场和车站/, {}, SLOW));
  assert.equal(within(screen.getByRole("listbox", { name: "出发地的候选" })).getAllByRole("option").length, 1);
});

test("认出接机：时间标签变「航班落地时间（当地）」，提示「已识别为接机…落地后免费等待 N 分钟」N 取报价；接机才有航班号；送机没有", async () => {
  wideScreen();
  let tripType: SiteByPointsResult["trip_type"] = "pickup";
  open({ quote: () => json(200, byPoints({ trip_type: tripType, quotes: [quoteOf(1, { freeWait: 75 })] })) });
  const actor = user();
  await fillTrip(actor);
  assert.ok(await screen.findByText("已识别为接机：司机按航班落地时间等候，落地后免费等待 75 分钟", {}, SLOW));
  assert.ok(screen.getByLabelText("航班落地时间（当地）"));
  assert.ok(screen.getByText("东京的当地时间"));
  const flight = screen.getByLabelText("航班号");
  await actor.type(flight, "NH");
  await actor.tab();
  assert.ok(screen.getByText("航班号的格式不对，如 NH211、MU523"));
  await actor.type(flight, "211");
  assert.ok(screen.getByText("NH211"), "航班号进了行程摘要");
  assert.ok(screen.getByText("航班落地后免费等待 75 分钟"));

  // 换成送机（目的地是机场）：没有接机提示、没有航班号
  tripType = "dropoff";
  await pickPlace(actor, "出发地", "京王", /京王广场酒店/);
  await pickPlace(actor, "目的地", "成田", /成田国际机场/);
  await screen.findByRole("heading", { name: "车型1" }, SLOW);
  await waitFor(() => assert.ok(screen.getByLabelText("用车时间（当地）")));
  assertAbsent(screen.queryByText(/已识别为接机/));
  assertAbsent(screen.queryByLabelText("航班号"));
  assert.ok(screen.getByText("免费等待 75 分钟"));
});

test("乘客 / 行李合并成一栏「2 人 · 2 件」；展开后分别 − +，到下限时 − 禁用；改了重新报价", async () => {
  wideScreen();
  const calls = open();
  const actor = user();
  await fillTrip(actor);
  await screen.findByRole("heading", { name: "车型1" }, SLOW);
  const toggle = screen.getByRole("button", { name: "乘客 / 行李 2 人 · 2 件" });
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  await actor.click(toggle);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  await actor.click(screen.getByRole("button", { name: "增加乘客" }));
  await actor.click(screen.getByRole("button", { name: "减少行李" }));
  await actor.click(screen.getByRole("button", { name: "减少行李" }));
  assert.ok(screen.getByRole("button", { name: "乘客 / 行李 3 人 · 0 件" }));
  assert.equal((screen.getByRole("button", { name: "减少行李" }) as HTMLButtonElement).disabled, true);
  assert.ok(screen.getByText("行李按 28 寸行李箱计"));
  await waitFor(() => {
    const body = posts(calls).at(-1)?.body as { passengers: number; luggage: number };
    assert.deepEqual([body.passengers, body.luggage], [3, 0]);
  }, SLOW);
});

test("车型：电脑默认 4 个、手机 3 个，下面「显示全部 N 个车型 ▾」；展开后焦点落到第一个新露出来的车型", async () => {
  for (const narrow of [false, true]) {
    if (narrow) narrowScreen();
    else wideScreen();
    open({ at: "/book/new?from=35.772,140.3929&to=35.6905,139.6948&date=2030-11-20&time=14:30", quote: () => json(200, byPoints({ quotes: [1, 2, 3, 4, 5, 6].map((index) => quoteOf(index)) })) });
    const actor = user();
    await screen.findByRole("heading", { name: "车型1" }, SLOW);
    const shown = narrow ? 3 : 4;
    assert.equal(screen.getAllByRole("heading", { level: 3, name: /^车型\d$/ }).length, shown);
    await actor.click(screen.getByRole("button", { name: "显示全部 6 个车型 ▾" }));
    assert.equal(screen.getAllByRole("heading", { level: 3, name: /^车型\d$/ }).length, 6);
    assertFocused(screen.getByRole("button", { name: `选择 车型${shown + 1}` }));
    assertAbsent(screen.queryByRole("button", { name: /显示全部/ }));
    resetBrowser();
    window.matchMedia = originalMatchMedia;
  }
});

test("座位示意图：选中的车型才展开；乘客座位 1–N、行李 1–M 和最多乘客、最多行李一致；文字说明、示意图、28 寸；最多行李旁边也写 28 寸", async () => {
  wideScreen();
  open({ at: "/book/new?from=35.772,140.3929&to=35.6905,139.6948&date=2030-11-20&time=14:30", quote: () => json(200, byPoints({ quotes: [quoteOf(1, { passengers: 6, luggage: 4 }), quoteOf(2, { passengers: 3, luggage: 2 })] })) });
  const actor = user();
  await screen.findByRole("heading", { name: "车型1" }, SLOW);
  assertAbsent(screen.queryByRole("img", { name: /车内示意图/ }));
  await actor.click(screen.getByRole("button", { name: "选择 车型1" }));
  assert.equal(screen.getByRole("button", { name: "已选择 车型1" }).getAttribute("aria-pressed"), "true");
  const image = screen.getByRole("img", { name: "车型1的车内示意图：乘客座位 6 个，行李 4 件（行李按 28 寸行李箱计）" });
  assert.deepEqual([...image.querySelectorAll(".seat-map__seat-number")].map((node) => node.textContent), ["1", "2", "3", "4", "5", "6"]);
  assert.deepEqual([...image.querySelectorAll(".seat-map__bag-number")].map((node) => node.textContent), ["1", "2", "3", "4"]);
  assert.equal(image.querySelectorAll(".seat-map__driver").length, 1);
  const figure = image.closest("figure") as HTMLElement;
  assert.equal(figure.querySelector("figcaption")?.textContent, "乘客座位 6 个 · 行李 4 件（行李按 28 寸行李箱计） · 人数少时空座位也可以放行李示意图");
  assert.ok(screen.getAllByText("4 件（行李按 28 寸行李箱计）").length >= 1, "最多行李旁边写 28 寸");
  assert.ok(image.closest("li")?.textContent?.includes("Toyota Noah, Toyota Voxy or similar"), "M7 车型标识");

  await actor.click(screen.getByRole("button", { name: "选择 车型2" }));
  const second = screen.getByRole("img", { name: /车型2的车内示意图：乘客座位 3 个，行李 2 件/ });
  assert.equal(second.querySelectorAll(".seat-map__seat-number").length, 3);
  assert.equal(screen.getAllByRole("img", { name: /车内示意图/ }).length, 1, "只展开选中的那一个");
  // 右侧栏：所选车型和合计
  const aside = screen.getByRole("complementary", { name: "行程摘要" });
  assert.ok(within(aside).getByText("车型2"));
  assert.ok(within(aside).getByText("20,000"));
});

test("链接参数：from 编码（只在平台地点里按编码找，不调谷歌）、to 坐标加名称、date、time、pax、bags 打开就报价；不合法的只是不预填", async () => {
  wideScreen();
  const calls = open({ at: "/book/new?from=NRT&to=35.6905,139.6948&to_name=%E4%BA%AC%E7%8E%8B%E5%B9%BF%E5%9C%BA%E9%85%92%E5%BA%97&date=2030-11-20&time=14:30&pax=3&bags=1" });
  await screen.findByRole("heading", { name: "车型1" }, SLOW);
  assert.ok(calls.some((call) => call.path === `/site/v1/cities/${CITY_ID}/places`), "编码在官网能订的城市的平台地点里找");
  assert.equal(calls.filter((call) => call.path.includes("/places/autocomplete") || call.path.includes("/places/search")).length, 0, "不经输入即提示、不调谷歌（M8-03 验收问题 2）");
  assert.deepEqual(posts(calls)[0]?.body, {
    pickup: { name: "成田国际机场", lat: 35.772, lng: 140.3929, kind: "airport" },
    dropoff: { name: "京王广场酒店", lat: 35.6905, lng: 139.6948 },
    service_local: "2030-11-20T14:30",
    passengers: 3,
    luggage: 1,
  });
  assert.equal((screen.getByRole("combobox", { name: "出发地" }) as HTMLInputElement).value, "成田国际机场");
  resetBrowser();

  wideScreen();
  const bad = open({ at: "/book/new?from=999,1&to=%3Cb%3E&date=2030-13-01&time=99:99&pax=0&bags=x" });
  const from = (await screen.findByRole("combobox", { name: "出发地" })) as HTMLInputElement;
  assert.equal(from.value, "");
  assert.notEqual((screen.getByLabelText("日期（当地）") as HTMLInputElement).value, "2030-13-01");
  assert.equal((screen.getByLabelText("用车时间（当地）") as HTMLInputElement).value, "");
  assert.ok(screen.getByRole("button", { name: "乘客 / 行李 2 人 · 2 件" }));
  assertAbsent(screen.queryByRole("alert", { name: /./ }));
  assert.equal(posts(bad).length, 0);
});

test("报不出价：时间太近、人数太多、地址不在服务范围各有说法和客服电话；不显示内部代码", async () => {
  for (const [reason, text] of [
    ["LEAD_TIME_TOO_SHORT", "时间太近，请选更晚的时间或联系客服"],
    ["CAPACITY_EXCEEDED", "人数或行李超过所有车型，可以分两辆车预订或联系客服"],
    ["OUT_OF_SERVICE_AREA", "这个地址暂时没有在线报价，请联系客服"],
  ] as const) {
    wideScreen();
    open({ at: "/book/new?from=35.772,140.3929&to=35.6905,139.6948&date=2030-11-20&time=14:30", quote: () => json(200, byPoints({ quotes: [], unavailable: [{ vehicle_group_id: null, reasons: [reason] }] })) });
    assert.ok(await screen.findByText(text, {}, SLOW));
    assert.ok(screen.getByRole("heading", { name: "没有可预订的车" }));
    assert.equal(screen.getByRole("link", { name: "+81 3-1234-5678" }).getAttribute("href"), "tel:+81312345678");
    assert.doesNotMatch(document.body.textContent ?? "", new RegExp(reason));
    resetBrowser();
  }
});

test("一口价包含：接送写「含所有费用」、专车、免费等待；包车不写「含所有费用」（规则切换前），写现有的包车说明；任何时候都没有「跟踪航班」，也没有举牌（报价里没有商品的包含清单）", async () => {
  wideScreen();
  const calls = open({ at: "/book/new?from=35.772,140.3929&to=35.6905,139.6948&date=2030-11-20&time=14:30" });
  await screen.findByRole("heading", { name: "车型1" }, SLOW);
  const includes = screen.getByRole("region", { name: "一口价包含" });
  assert.deepEqual(within(includes).getAllByRole("listitem").map((item) => item.textContent), ["一口价已含所有费用（高速费、停车费等），无需另付", "专车专用，不拼车", "航班落地后免费等待 60 分钟"]);
  assert.doesNotMatch(document.body.textContent ?? "", /跟踪航班|举牌/);

  const actor = user();
  await actor.click(screen.getByRole("radio", { name: "按小时包车" }));
  await pickPlace(actor, "上车地点", "京王", /京王广场酒店/);
  await screen.findByRole("heading", { name: "车型1" }, SLOW);
  const charter = posts(calls, "/site/v1/quotes").at(-1)?.body as Record<string, unknown>;
  assert.deepEqual([charter["category"], charter["city_id"], charter["package_hours"]], ["charter", CITY_ID, 8]);
  const charterIncludes = screen.getByRole("region", { name: "一口价包含" });
  assert.deepEqual(within(charterIncludes).getAllByRole("listitem").map((item) => item.textContent), ["专车专用，不拼车"]);
  assert.doesNotMatch(document.body.textContent ?? "", /包含所有费用|已含所有费用|跟踪航班/);
  assert.ok(within(charterIncludes).getByText(/高速费、停车费服务后按实际收取/));
  assert.ok(screen.getByText("8 小时，含 150 公里"));
});

test("手机分步：第 1 步「查看车型和价格」没填好时标红；第 2 步行程条可修改、底部固定「车型 · 一口价 [下一步]」；第 3 步顶部是摘要和合计，下面「怎么联系你」，航班号也在这一步", async () => {
  narrowScreen();
  open();
  const actor = user();
  await screen.findByRole("heading", { name: "你的行程" });
  assertAbsent(screen.queryByRole("heading", { name: "选择车型" }));
  assertAbsent(screen.queryByRole("complementary", { name: "行程摘要" }));
  assertAbsent(screen.queryByRole("heading", { name: "怎么联系你" }));
  await actor.click(screen.getByRole("button", { name: "查看车型和价格" }));
  assert.ok(screen.getByText("有几项没有填好，请看标红的地方。"));
  assert.ok(screen.getByText("请从候选里选出发地"));
  assert.equal(screen.getByRole("combobox", { name: "出发地" }).getAttribute("aria-invalid"), "true");

  await fillTrip(actor);
  await actor.click(screen.getByRole("button", { name: "查看车型和价格" }));
  const heading = await screen.findByRole("heading", { name: "选择车型" });
  assertFocused(heading);
  assertAbsent(screen.queryByRole("heading", { name: "你的行程" }));
  await screen.findByRole("heading", { name: "车型1" }, SLOW);
  assert.match(document.querySelector(".book-new__strip-text")?.textContent ?? "", /^接机 成田国际机场 → 京王广场酒店（东京都新宿区西新宿 2-2-1） · 2030年11月20日（周三）14:30 落地 · 2 人 · 2 件$/);
  assertAbsent(screen.queryByRole("button", { name: "下一步" }));
  await actor.click(screen.getByRole("button", { name: "选择 车型1" }));
  assert.ok(screen.getByText(/车型1/, { selector: ".book-bar__text span" }));
  await actor.click(screen.getByRole("button", { name: "下一步" }));
  assertFocused(screen.getByRole("heading", { name: "行程摘要" }));
  assertAbsent(screen.queryByRole("heading", { name: "选择车型" }));
  assert.ok(screen.getByRole("heading", { name: "怎么联系你" }));
  assert.ok(screen.getByLabelText("航班号"), "接机的航班号在第 3 步也能填（和第 1 步是同一个）");
  assert.ok(screen.getByRole("button", { name: "去付款 →" }));
  assertAbsent(screen.queryByRole("button", { name: "下一步" }));

  await actor.click(screen.getByRole("button", { name: "← 返回选车型" }));
  assertFocused(screen.getByRole("heading", { name: "选择车型" }));
  await actor.click(screen.getByRole("button", { name: "修改" }));
  assertFocused(screen.getByRole("heading", { name: "你的行程" }));
});

/** 电脑宽：链接打开就报价，选第一个车型。 */
async function openSelected(options: Options = {}): Promise<{ calls: ApiCall[]; actor: ReturnType<typeof user> }> {
  wideScreen();
  const calls = open({ at: "/book/new?from=35.772,140.3929&from_name=%E6%88%90%E7%94%B0%E5%9B%BD%E9%99%85%E6%9C%BA%E5%9C%BA&to=35.6905,139.6948&to_name=%E4%BA%AC%E7%8E%8B%E5%B9%BF%E5%9C%BA%E9%85%92%E5%BA%97&date=2030-11-20&time=14:30", ...options });
  const actor = user();
  await screen.findByRole("heading", { name: "车型1" }, SLOW);
  await actor.click(screen.getByRole("button", { name: "选择 车型1" }));
  return { calls, actor };
}

test("怎么联系你：没填好时标红（姓名、手机、邮箱、即时通讯账号、同意保存银行卡，接机的航班号标在行程里）；填好后按现有下单接口下单（同一个幂等键、地址取行程里的名称），然后进订单页", async () => {
  let posted = 0;
  const { calls, actor } = await openSelected({
    order: () => {
      posted += 1;
      return posted === 1 ? apiError(502, "UPSTREAM", "x") : json(201, { order: {}, timeline: [], names: {}, payment: null, link: { token: `nzo_${"a".repeat(43)}`, expires_at: "2030-12-01T00:00:00.000Z" } });
    },
  });
  const pay = screen.getByRole("button", { name: "去付款 →" });
  assert.equal(pay.getAttribute("form"), "book-contact-form", "右侧栏的「去付款」提交左边的表单");
  await actor.selectOptions(screen.getByLabelText("微信 / LINE / WhatsApp（选填）"), "line");
  await actor.click(pay);
  assert.ok(screen.getByText("有几项没有填好，请看标红的地方。"));
  for (const text of ["请填写乘车人姓名", "请填写带国家码的手机号，如 +81 90-1234-5678、+86 138 0000 0000", "请填写正确的邮箱，订单确认和查看链接会发到这里", "选了即时通讯就要填账号", "需要同意保存支付方式才能下单", "接机要填航班号，司机按航班落地时间等候"]) assert.ok(screen.getByText(text), text);
  assert.equal(screen.getByLabelText("航班号").getAttribute("aria-invalid"), "true");
  assert.equal(posts(calls, "/site/v1/orders").length, 0);

  await actor.type(screen.getByLabelText("乘车人姓名"), "王小明");
  await actor.type(screen.getByLabelText("邮箱"), "guest@example.com");
  await actor.type(screen.getByLabelText("手机号（含国家区号）"), "+86 138 0000 0000");
  await actor.type(screen.getByLabelText("即时通讯账号"), "wangxm");
  await actor.type(screen.getByLabelText("给司机的备注（选填）"), "两个大箱子");
  await actor.click(screen.getByRole("checkbox", { name: /同意保存这次付款用的银行卡/ }));
  await actor.type(screen.getByLabelText("航班号"), "nh 211");
  await actor.click(pay);
  assert.ok(await screen.findByText(/再点一次「去付款」不会重复下单/));
  await actor.click(screen.getByRole("button", { name: "去付款 →" }));
  await waitFor(() => assert.match(currentLocation()?.path ?? document.location.pathname, /./));
  const orders = posts(calls, "/site/v1/orders");
  assert.equal(orders.length, 2);
  assert.equal(orders[0]?.headers["idempotency-key"], orders[1]?.headers["idempotency-key"], "重试用同一个幂等键");
  assert.deepEqual(orders[1]?.body, {
    quote_id: "QT203011200000000001",
    passenger: { name: "王小明", phone: "+86 138 0000 0000", email: "guest@example.com" },
    flight_no: "nh 211",
    pickup_address: null,
    dropoff_address: "京王广场酒店",
    messaging: { app: "line", handle: "wangxm" },
    notes: "两个大箱子",
    save_payment_method: true,
  });
  await waitFor(() => assertAbsent(screen.queryByRole("heading", { name: "怎么联系你" })));
});

test("附加服务：只列这个车型能加的；改数量后带 addons 重新报价，合计用新报价、附加服务一行是合计差额，不另算单价；下单用新报价；车型不提供时说明", async () => {
  const seat = { id: "a1a1a1a1-aaaa-4aaa-8aaa-aaaaaaaaaaa1", code: "ADD-SEAT", name: { zh: "儿童座椅" }, charge_unit: "per_item" } as const;
  const sign = { id: "a2a2a2a2-aaaa-4aaa-8aaa-aaaaaaaaaaa2", code: "ADD-SIGN", name: { zh: "举牌" }, charge_unit: "per_order" } as const;
  let offered = true;
  const { calls, actor } = await openSelected({
    quote: (call) => {
      const addons = (call.body as { addons?: { addon_id: string; quantity: number }[] }).addons;
      if (addons === undefined) return json(200, byPoints({ quotes: [quoteOf(1, { amount: 22000, addons: [seat, sign] }), quoteOf(2)] }));
      const extra = addons.reduce((sum, item) => sum + item.quantity * 1500, 0);
      return json(200, byPoints({ quotes: offered ? [quoteOf(1, { amount: 22000 + extra, id: "QT20301120ADDONS0001", addons: [seat, sign] })] : [], unavailable: offered ? [] : [{ vehicle_group_id: null, reasons: ["ADDON_NOT_OFFERED"] }] }));
    },
  });
  const addons = screen.getByRole("region", { name: "附加服务（选填）" });
  assert.equal((within(addons).getByRole("button", { name: "减少儿童座椅" }) as HTMLButtonElement).disabled, true);
  await actor.click(within(addons).getByRole("button", { name: "增加儿童座椅" }));
  await actor.click(within(addons).getByRole("button", { name: "增加儿童座椅" }));
  await actor.click(within(addons).getByRole("button", { name: "增加举牌" }));
  assert.equal((within(addons).getByRole("button", { name: "增加举牌" }) as HTMLButtonElement).disabled, true, "按单计的最多 1 个");
  await screen.findByText("+4,500 JPY", {}, SLOW);
  const aside = screen.getByRole("complementary", { name: "行程摘要" });
  assert.ok(within(aside).getByText("22,000 JPY"), "车费不变");
  assert.ok(within(aside).getByText("26,500"), "合计用新报价");
  assert.ok(within(aside).getByText("附加服务（合计差额）"));
  assert.doesNotMatch(aside.textContent ?? "", /1,500/, "不显示单价");
  const withAddons = posts(calls).filter((call) => (call.body as { addons?: unknown }).addons !== undefined);
  assert.deepEqual((withAddons.at(-1)?.body as { addons: unknown }).addons, [
    { addon_id: seat.id, quantity: 2 },
    { addon_id: sign.id, quantity: 1 },
  ]);
  assert.equal(screen.getAllByRole("heading", { level: 3, name: /^车型\d$/ }).length, 2, "车型列表还是不带附加服务的那一次");

  offered = false;
  await actor.click(within(addons).getByRole("button", { name: "减少儿童座椅" }));
  assert.ok(await screen.findByText("这个车型现在加不了所选的附加服务，请减少附加服务或换一个车型。", {}, SLOW));
  offered = true;
  await actor.click(within(addons).getByRole("button", { name: "减少儿童座椅" }));
  await actor.click(within(addons).getByRole("button", { name: "减少举牌" }));
  await actor.click(within(addons).getByRole("button", { name: "减少儿童座椅" }));
  await waitFor(() => assertAbsent(screen.queryByText("附加服务（合计差额）")));
  assert.ok(within(aside).getByText("22,000"));
});

test("参考价：按浏览器语言推断币种、可以手动换；可用时「≈ 金额」和小字；不可用时不显示", async () => {
  const { calls, actor } = await openSelected({
    fx: (call) => {
      const to = call.url.searchParams.get("to");
      return to === "CNY" ? json(200, { available: true, from: "JPY", to, rate: "0.047351", as_of: "2030-11-19T00:00:00.000Z", reason: null }) : json(200, { available: false, from: "JPY", to, rate: null, as_of: null, reason: "STALE" });
    },
  });
  const aside = screen.getByRole("complementary", { name: "行程摘要" });
  await waitFor(() => assert.ok(calls.some((call) => call.path.startsWith("/site/v1/fx/reference"))));
  assertAbsent(within(aside).queryByText(/≈/));
  await actor.selectOptions(within(aside).getByLabelText("参考币种"), "CNY");
  await waitFor(() => assert.match(aside.textContent ?? "", /≈ 899.67 CNY/));
  assert.ok(within(aside).getByText("按当前汇率换算，仅供参考，实际以支付金额为准"));
  await actor.selectOptions(within(aside).getByLabelText("参考币种"), "KRW");
  await waitFor(() => assertAbsent(within(aside).queryByText(/≈/)));
});

test("路线：有折线和底图时画路线图并写「约 X 分钟 · Y 公里」；取不到路线时这一块不出现", async () => {
  const tiles: MapTiles = { url_template: "http://127.0.0.1:1/{z}/{x}/{y}.png", dark_url_template: null, min_zoom: 3, max_zoom: 19, tile_size: 256, referrer_policy: "strict-origin", attribution: [{ text: "© OpenStreetMap", href: "https://www.openstreetmap.org/copyright" }] };
  await openSelected({ config: configOf({ map_tiles: tiles }), quote: () => json(200, byPoints({ route: { minutes: 52, meters: 63_420, polyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@" } })) });
  assert.ok(screen.getByRole("img", { name: "路线图：成田国际机场 → 京王广场酒店，约 52 分钟 · 63.4 公里" }));
  assert.ok(screen.getByText("约 52 分钟 · 63.4 公里"));
  assert.ok(screen.getByRole("link", { name: "© OpenStreetMap" }));
  resetBrowser();

  await openSelected({ config: configOf({ map_tiles: tiles }) });
  assertAbsent(screen.queryByRole("img", { name: /路线图/ }));
  assertAbsent(screen.queryByText(/约 \d+ 分钟/));
  assert.ok(screen.getByRole("button", { name: "去付款 →" }));
  assert.ok(screen.getByText("银行卡"));
  assert.ok(screen.getByText("用车前 24 小时以上取消免费；24 小时内取消收全额"));
});
