/**
 * 新预订页 `/book/new`（M8-03，ADR 0069 A3、修正版 v2；规范 site-booking-v2.md）的组件测试：
 * 地址框输入即提示（至少 2 个字、停顿后查、会话令牌、平台地点在前、谷歌候选选中后取坐标）、认出接机后的时间标签和提示（N 取报价）、
 * 「乘客 / 行李」合并栏、车型「显示全部」（电脑 4 个、手机 3 个）、车内示意图的座位和行李个数、编号和文字、链接参数、报不出价的说法、
 * 包车也写「含所有费用」（M8-09，ADR 0070）、任何时候都没有「跟踪航班」、手机分步和底部固定条；
 * M8-04：「怎么联系你」的校验和下单、附加服务改数量重新报价和合计差额、参考价可用 / 不可用、路线有 / 无、手机第 3 步；
 * M8-10：路线小地图用后端出的谷歌静态图（出图、没开通退回底图、其他失败只写字）。
 * M8-27：四步（网址 ?step=N、前进后退、换步不丢内容）、右侧栏逐步累积、手机摘要条、第 3 步乘客信息、第 4 步核对和付款。
 * M8-33：标签只有「区间 / 包车」（不再有接送机 / 点对点和标签不符的提示）、旧链接 mode=airport / p2p 落到区间、接机还没有报价时按机场默认免费等待。
 * 接口用测试替身（浏览器只连 /site/v1）；真实后端由 e2e/site-booking-new.spec.ts 覆盖。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import { App } from "../../../App.tsx";
import { FULL_SCREEN_PICKER_QUERY } from "./full-screen.tsx";
import type { MapTiles } from "../../../api/areas.ts";
import type { BookingDraft, SiteByPointsResult, SiteCity, SiteConfig, SiteQuote, SiteQuoteResult } from "../../../api/site.ts";
import { type ApiCall, apiError, assertAbsent, assertFocused, currentLocation, deferred, json, narrowScreen, resetBrowser, stubApiWith } from "../../../testing/harness.tsx";

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
const quotedCity = { id: CITY_ID, code: city.code, name: city.name, timezone: city.timezone };
const configOf = (changes: Partial<SiteConfig> = {}): SiteConfig => ({ open: true, currency: "JPY", payments: null, support_phone: "+81 3-1234-5678", support_whatsapp: null, address_search: true, page_width: "standard", map_tiles: null, ...changes });
const airportSuggestion = { source: "platform", id: AIRPORT_ID, name: "成田国际机场", address: "", location: { lat: 35.772, lng: 140.3929 }, kind: "airport" } as const;
const hotelSuggestion = { source: "google", id: "ChIJkeio", name: "京王广场酒店", address: "东京都新宿区西新宿 2-2-1", location: null, kind: "other" } as const;

function quoteOf(index: number, changes: { passengers?: number; luggage?: number; freeWait?: number | null; amount?: number; package?: SiteQuote["package"]; addons?: SiteQuote["available_addons"]; id?: string } = {}): SiteQuote {
  return {
    quote_id: changes.id ?? `QT2030112000000000${String(index).padStart(2, "0")}`,
    expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    service_date: "2030-11-20",
    urgent: false,
    includes_area_surcharge: false,
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
    airport: { id: AIRPORT_ID, code: "NRT", name: { zh: "成田国际机场" }, matched_by: "kind", distance_meters: 0, flight_scope: "international" },
    fallback_category: null,
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
  byCode?: Route;
  /** 预订草稿（M9E-01） */
  draft?: Route;
  /** 城市的包车套餐时长（默认只有 8 小时） */
  packages?: number[];
  /** 按上下车点列包车套餐（M9P-02）；不给时匹配到东京、套餐 `packages` */
  charterPackages?: Route;
  /** 路线图的图片没出来以后，前端再问一次原因（M8-10） */
  routeMap?: Route;
  /** 地图选点后按坐标查地址（M8-42） */
  reverse?: Route;
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
    if (path === "/site/v1/places/by-code") {
      const custom = options.byCode?.(call);
      if (custom) return custom;
      return call.url.searchParams.get("code") === "NRT" ? json(200, { id: AIRPORT_ID, type: "airport", code: "NRT", name: { zh: "成田国际机场" }, address: null, location: { lat: 35.772, lng: 140.3929 } }) : apiError(404, "PLACE_NOT_FOUND", "没有这个地点");
    }
    if (path === "/site/v1/places/reverse") return options.reverse?.(call) ?? null;
    if (path.startsWith("/site/v1/booking-drafts/")) return options.draft?.(call) ?? apiError(404, "BOOKING_DRAFT_NOT_FOUND", "链接已过期，请重新填写");
    // 包车按上下车点匹配（M9P-02）：默认匹配到东京
    if (path === "/site/v1/charter-packages") return options.charterPackages?.(call) ?? json(200, { city: quotedCity, items: (options.packages ?? [8]).map((hours) => ({ hours })) });
    if (call.method === "POST" && path === "/site/v1/quotes/by-points") return options.quote?.(call) ?? json(200, byPoints());
    if (path === "/site/v1/fx/reference") return options.fx?.(call) ?? json(200, { available: false, from: "JPY", to: call.url.searchParams.get("to"), rate: null, as_of: null, reason: "NO_RATE" });
    if (call.method === "POST" && path === "/site/v1/orders") return options.order?.(call) ?? null;
    if (call.method === "GET" && path === "/site/v1/route-map") return options.routeMap?.(call) ?? null;
    if (call.method === "GET" && path === "/site/v1/order") return apiError(503, "SERVICE_UNAVAILABLE", "x");
    if (call.method === "POST" && path === "/site/v1/quotes") return options.charter?.(call) ?? json(200, { currency: "JPY", quotes: [quoteOf(1, { freeWait: 0, package: { hours: 8, km: 150 } })], unavailable: [] } satisfies SiteQuoteResult);
    return null;
  });
  render(
    <MemoryRouter initialEntries={[options.at ?? "/book/new"]}>
      <App />
      <History />
    </MemoryRouter>,
  );
  return calls;
}

/** 测试里的浏览器后退、前进和地址（MemoryRouter 没有地址栏）。 */
function History() {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <div data-testid="history" data-search={location.search}>
      <button type="button" onClick={() => void navigate(-1)}>
        测试：后退
      </button>
      <button type="button" onClick={() => void navigate(1)}>
        测试：前进
      </button>
    </div>
  );
}

const search = (): string => screen.getByTestId("history").getAttribute("data-search") ?? "";

const user = () => userEvent.setup();
const posts = (calls: ApiCall[], path = "/site/v1/quotes/by-points"): ApiCall[] => calls.filter((call) => call.method === "POST" && call.path === path);

async function pickPlace(actor: ReturnType<typeof user>, label: string, query: string, option: RegExp): Promise<void> {
  const box = await screen.findByRole("combobox", { name: label });
  await actor.clear(box);
  await actor.type(box, query);
  await actor.click(await screen.findByRole("option", { name: option }, SLOW));
}

const NEXT_VEHICLES = "下一步：选择车型";
const NEXT_CONTACT = "下一步：填写乘客信息";
const NEXT_REVIEW = "下一步：核对订单";
const next = async (actor: ReturnType<typeof user>, name: string): Promise<void> => actor.click(screen.getByRole("button", { name }));
const aside = (): HTMLElement => screen.getByRole("complementary", { name: "行程摘要" });

/** 第 3 步填好乘客信息（接机时带航班号）后到第 4 步。 */
async function toReview(actor: ReturnType<typeof user>, flight: string | null = "NH211"): Promise<void> {
  await next(actor, NEXT_CONTACT);
  await screen.findByRole("heading", { name: "乘客信息", level: 2 });
  await actor.type(screen.getByLabelText("乘车人姓名"), "王小明");
  await actor.type(screen.getByLabelText("邮箱"), "guest@example.com");
  await actor.type(screen.getByLabelText("手机号（含国家区号）"), "+86 138 0000 0000");
  if (flight !== null) await actor.type(screen.getByLabelText("航班号"), flight);
  await next(actor, NEXT_REVIEW);
  await screen.findByRole("heading", { name: "核对订单" });
}

async function fillTrip(actor: ReturnType<typeof user>): Promise<void> {
  await pickPlace(actor, "出发地", "成田", /成田国际机场/);
  await pickPlace(actor, "目的地", "京王", /京王广场酒店/);
  const date = screen.getByLabelText("日期（当地）") as HTMLInputElement;
  await actor.clear(date);
  await actor.type(date, "2030-11-20");
  await actor.type(screen.getByLabelText(/时间（当地）/), "14:30");
}

test("地址框：不到 2 个字不查；停顿后带会话令牌查；平台的机场在前；谷歌候选选中后用同一个会话令牌取坐标，之后换新令牌；报价带名称、坐标和类型，另带选中候选的名称（M8-20）", async () => {
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
  await next(actor, NEXT_VEHICLES);
  await screen.findByRole("heading", { name: "车型1" }, SLOW);
  assert.deepEqual(posts(calls).at(-1)?.body, {
    pickup: { name: "成田国际机场", lat: 35.772, lng: 140.3929, kind: "airport" },
    dropoff: { name: "京王广场酒店（东京都新宿区西新宿 2-2-1）", lat: 35.6905, lng: 139.6948, kind: "other" },
    service_local: "2030-11-20T14:30",
    passengers: 2,
    luggage: 2,
    // M8-20：地址联想里选中的那一项的名称（只有名称，不带地址），给平台记「未覆盖需求」用
    pickup_name: "成田国际机场",
    dropoff_name: "京王广场酒店",
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

test("地址框（M8-45）：这个地址今天的额度用完了（unavailable_reason IP_DAILY_LIMIT）说「今天的地址提示次数用完了」，平台的地点照常；每分钟限流（429）仍说「输入太快了」；谷歌出错的说法不变", async () => {
  wideScreen();
  let reply = (): Response => json(200, { available: false, unavailable_reason: "IP_DAILY_LIMIT", items: [airportSuggestion] });
  open({ config: configOf({ map_tiles: ROUTE_TILES }), autocomplete: () => reply() });
  const actor = user();
  const from = await screen.findByRole("combobox", { name: "出发地" });
  await actor.type(from, "成田");
  assert.ok(await screen.findByText("今天的地址提示次数用完了，下面只有平台的机场和车站；也可以在地图上选点。", {}, SLOW));
  assert.equal(within(screen.getByRole("listbox", { name: "出发地的候选" })).getAllByRole("option").length, 1, "平台的机场照常可选");
  assertAbsent(screen.queryByText(/输入太快了/));

  reply = () => json(200, { available: false, unavailable_reason: "IP_DAILY_LIMIT", items: [] });
  await actor.clear(from);
  await actor.type(from, "京王广场");
  assert.ok(await screen.findByText("今天的地址提示次数用完了。请在地图上选点，或输入机场、车站的名称。", {}, SLOW));

  reply = () => apiError(429, "RATE_LIMITED", "太频繁", { retry_after_seconds: 30 }, { "retry-after": "30" });
  await actor.clear(from);
  await actor.type(from, "新宿");
  assert.ok(await screen.findByText("输入太快了，请稍等几秒再输入。也可以在地图上选点。", {}, SLOW));
  assertAbsent(screen.queryByText(/今天的地址提示次数用完了/));

  reply = () => json(200, { available: false, items: [airportSuggestion] });
  await actor.clear(from);
  await actor.type(from, "成田机场");
  assert.ok(await screen.findByText("地址提示暂时用不了，下面只有平台的机场和车站。也可以在地图上选点。", {}, SLOW), "谷歌出错、全站上限的说法不变");
});

test("手机全屏选择页（M8-45）：额度用完的说法和电脑上一样", async () => {
  window.matchMedia = ((query: string) => ({ matches: query === FULL_SCREEN_PICKER_QUERY || query === "(pointer: coarse)", media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false })) as typeof window.matchMedia;
  open({ config: configOf({ map_tiles: ROUTE_TILES }), autocomplete: () => json(200, { available: false, unavailable_reason: "IP_DAILY_LIMIT", items: [airportSuggestion] }) });
  const actor = user();
  await actor.click(await screen.findByRole("button", { name: /^出发地/ }));
  const sheet = await screen.findByRole("dialog", { name: "出发地" });
  await actor.type(within(sheet).getByRole("combobox", { name: "出发地" }), "成田");
  assert.ok(await within(sheet).findByText("今天的地址提示次数用完了，下面只有平台的机场和车站；也可以在地图上选点。", {}, SLOW));
});

test("地址框（M8-37）：候选开着时 Tab 走到同一块里的「在地图上选点」，候选收起（不盖住获得焦点的按钮）；点页面别处也收起", async () => {
  wideScreen();
  open({ config: configOf({ map_tiles: ROUTE_TILES }) });
  const actor = user();
  const from = await screen.findByRole("combobox", { name: "出发地" });
  await actor.type(from, "成田");
  await screen.findByRole("listbox", { name: "出发地的候选" }, SLOW);
  assert.equal(from.getAttribute("aria-expanded"), "true");
  await actor.tab();
  assert.equal(document.activeElement, within(screen.getByRole("group", { name: "出发地的地图" })).getByRole("button", { name: "在地图上选点" }));
  assert.equal(from.getAttribute("aria-expanded"), "false");
  assertAbsent(screen.queryByRole("listbox", { name: "出发地的候选" }));

  await actor.type(from, "机场");
  await screen.findByRole("listbox", { name: "出发地的候选" }, SLOW);
  await actor.click(screen.getByRole("heading", { level: 1 }));
  assert.equal(from.getAttribute("aria-expanded"), "false");
});

test("地址框（M8-37）：手指操作时输入框失焦却没有新的焦点（点候选时手机浏览器会这样），候选不收、点得中；鼠标操作时照旧收起", async () => {
  const coarse = { value: true };
  window.matchMedia = ((query: string) => ({ matches: query.includes("min-width: 1024px") || (query === "(pointer: coarse)" && coarse.value), media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false })) as typeof window.matchMedia;
  open();
  const actor = user();
  const from = await screen.findByRole("combobox", { name: "出发地" });
  await actor.type(from, "成田");
  await screen.findByRole("listbox", { name: "出发地的候选" }, SLOW);
  fireEvent.blur(from, { relatedTarget: null });
  assert.equal(from.getAttribute("aria-expanded"), "true", "手指操作：失焦没有新焦点时不收");
  fireEvent.click(screen.getByRole("option", { name: /成田国际机场/ }));
  await waitFor(() => assert.equal((from as HTMLInputElement).value, "成田国际机场"));
  assert.equal(from.getAttribute("aria-expanded"), "false");

  coarse.value = false;
  await actor.clear(from);
  await actor.type(from, "成田");
  await screen.findByRole("listbox", { name: "出发地的候选" }, SLOW);
  fireEvent.blur(from, { relatedTarget: null });
  assert.equal(from.getAttribute("aria-expanded"), "false", "鼠标操作：失焦就收起（和以前一样）");
});

test("手机触屏（M8-37）：地址、日期、时间都是全屏选择页——点那一格打开，选中候选 / 确定后回到页面、焦点回到那一格；取消不改原来的值；页面上没有直接打字的地址框", async () => {
  window.matchMedia = ((query: string) => ({ matches: query === FULL_SCREEN_PICKER_QUERY || query === "(pointer: coarse)", media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false })) as typeof window.matchMedia;
  open();
  const actor = user();
  const fromCell = await screen.findByRole("button", { name: /^出发地/ });
  assertAbsent(screen.queryByRole("combobox", { name: "出发地" }));
  assert.equal(fromCell.getAttribute("aria-haspopup"), "dialog");
  assert.match(fromCell.textContent ?? "", /点按输入地址/);

  await actor.click(fromCell);
  const sheet = await screen.findByRole("dialog", { name: "出发地" });
  const input = within(sheet).getByRole("combobox", { name: "出发地" });
  assert.equal(document.activeElement, input, "打开后焦点在输入框");
  await actor.type(input, "成田");
  await within(sheet).findByRole("listbox", { name: "出发地的候选" }, SLOW);
  await actor.click(within(sheet).getByRole("option", { name: /成田国际机场/ }));
  await waitFor(() => assertAbsent(screen.queryByRole("dialog", { name: "出发地" })));
  assert.match(fromCell.textContent ?? "", /成田国际机场/);
  assert.equal(document.activeElement, fromCell, "回到页面后焦点在那一格");
  // 地址那一格整行宽、长地址折行显示全（M8-37b）；日期、时间仍单行
  assert.ok(fromCell.classList.contains("picker-trigger--wrap"), "地址那一格折行显示全");
  assert.ok(screen.getByRole("button", { name: /^目的地/ }).classList.contains("picker-trigger--wrap"));
  assert.ok(!screen.getByRole("button", { name: /^日期（当地）/ }).classList.contains("picker-trigger--wrap"), "日期仍单行");

  // 取消：选择页里打的字不改原来的值
  await actor.click(fromCell);
  const again = await screen.findByRole("dialog", { name: "出发地" });
  await actor.clear(within(again).getByRole("combobox", { name: "出发地" }));
  await actor.type(within(again).getByRole("combobox", { name: "出发地" }), "京王");
  await actor.click(within(again).getByRole("button", { name: "取消" }));
  await waitFor(() => assertAbsent(screen.queryByRole("dialog", { name: "出发地" })));
  assert.match(fromCell.textContent ?? "", /成田国际机场/);

  // 日期：确定后回到页面；取消不改
  const dateCell = screen.getByRole("button", { name: /^日期（当地）/ });
  await actor.click(dateCell);
  const dateSheet = await screen.findByRole("dialog", { name: "日期（当地）" });
  fireEvent.change(within(dateSheet).getByLabelText("日期（当地）"), { target: { value: "2030-11-20" } });
  await actor.click(within(dateSheet).getByRole("button", { name: "确定" }));
  await waitFor(() => assertAbsent(screen.queryByRole("dialog", { name: "日期（当地）" })));
  assert.match(dateCell.textContent ?? "", /2030-11-20/);
  await actor.click(dateCell);
  const dateAgain = await screen.findByRole("dialog", { name: "日期（当地）" });
  fireEvent.change(within(dateAgain).getByLabelText("日期（当地）"), { target: { value: "2030-12-01" } });
  await actor.click(within(dateAgain).getByRole("button", { name: "取消" }));
  await waitFor(() => assertAbsent(screen.queryByRole("dialog", { name: "日期（当地）" })));
  assert.match(dateCell.textContent ?? "", /2030-11-20/);
});

/** 手机全屏选择页：打开出发地的选择页，在地图上按「选地图中间这个位置」（从城市中心开始），选择页关上。 */
async function pickFromOnMapInSheet(actor: ReturnType<typeof user>): Promise<HTMLElement> {
  window.matchMedia = ((query: string) => ({ matches: query === FULL_SCREEN_PICKER_QUERY || query === "(pointer: coarse)", media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false })) as typeof window.matchMedia;
  const fromCell = await screen.findByRole("button", { name: /^出发地/ });
  await actor.click(fromCell);
  const sheet = await screen.findByRole("dialog", { name: "出发地" });
  await actor.click(within(within(sheet).getByRole("group", { name: "出发地的地图" })).getByRole("button", { name: "在地图上选点" }));
  await actor.click(within(sheet).getByRole("button", { name: "选地图中间这个位置" }));
  await waitFor(() => assertAbsent(screen.queryByRole("dialog", { name: "出发地" })));
  assert.match(fromCell.textContent ?? "", /地图上选的位置（/);
  return fromCell;
}

test("手机地图选点（M8-42）：反查还没回来时又打开选择页打字、再点「取消」，反查回来后出发地仍换成地址（取消不改值，也不作废反查）", async () => {
  const pending = deferred();
  const calls = open({ config: configOf({ map_tiles: ROUTE_TILES }), reverse: () => pending.promise });
  const actor = user();
  const fromCell = await pickFromOnMapInSheet(actor);
  await waitFor(() => assert.equal(calls.filter((call) => call.path.includes("/places/reverse")).length, 1));

  await actor.click(fromCell);
  const again = await screen.findByRole("dialog", { name: "出发地" });
  await actor.clear(within(again).getByRole("combobox", { name: "出发地" }));
  await actor.type(within(again).getByRole("combobox", { name: "出发地" }), "京王");
  await actor.click(within(again).getByRole("button", { name: "取消" }));
  await waitFor(() => assertAbsent(screen.queryByRole("dialog", { name: "出发地" })));
  assert.match(fromCell.textContent ?? "", /地图上选的位置（/, "取消不改原来的值");

  pending.resolve(json(200, { available: true, address: "日本、〒160-0023 東京都新宿区西新宿２丁目８−１" }));
  await waitFor(() => assert.match(fromCell.textContent ?? "", /東京都新宿区西新宿２丁目８−１/));
  assert.doesNotMatch(fromCell.textContent ?? "", /地图上选的位置/);
});

test("手机地图选点（M8-42）：选择页开着、客人正在打字时反查回来，输入框里还是客人打的字，页面那一格已换成地址；再点「取消」出发地是地址", async () => {
  const pending = deferred();
  const calls = open({ config: configOf({ map_tiles: ROUTE_TILES }), reverse: () => pending.promise });
  const actor = user();
  const fromCell = await pickFromOnMapInSheet(actor);
  await waitFor(() => assert.equal(calls.filter((call) => call.path.includes("/places/reverse")).length, 1));

  await actor.click(fromCell);
  const again = await screen.findByRole("dialog", { name: "出发地" });
  const input = within(again).getByRole("combobox", { name: "出发地" });
  await actor.clear(input);
  await actor.type(input, "京王");
  pending.resolve(json(200, { available: true, address: "日本、〒160-0023 東京都新宿区西新宿２丁目８−１" }));
  await waitFor(() => assert.match(fromCell.textContent ?? "", /東京都新宿区西新宿２丁目８−１/), SLOW);
  // 页面那一格换成地址后，输入框的同步要等 effect 引起的那次渲染提交：先把待提交的更新全部冲刷掉再读（不靠固定等待）
  await act(async () => {});
  assert.equal((input as HTMLInputElement).value, "京王", "选择页里客人打的字不被反查结果盖掉");

  await actor.click(within(again).getByRole("button", { name: "取消" }));
  await waitFor(() => assertAbsent(screen.queryByRole("dialog", { name: "出发地" })));
  assert.match(fromCell.textContent ?? "", /東京都新宿区西新宿２丁目８−１/);
  assert.doesNotMatch(fromCell.textContent ?? "", /地图上选的位置|京王/);
});

test("手机地图选点（M8-42）：反查还没回来时切换到「包车」（地址框换成新的），在新框里改选了候选，旧框的反查回来后不覆盖", async () => {
  const pending = deferred();
  const calls = open({ config: configOf({ map_tiles: ROUTE_TILES }), reverse: () => pending.promise });
  const actor = user();
  await pickFromOnMapInSheet(actor);
  await waitFor(() => assert.equal(calls.filter((call) => call.path.includes("/places/reverse")).length, 1));

  await actor.click(screen.getByRole("radio", { name: "包车" }));
  const pickupCell = await screen.findByRole("button", { name: /^上车地点/ });
  assert.match(pickupCell.textContent ?? "", /地图上选的位置（/, "切换后上车地点沿用地图选的点");
  await actor.click(pickupCell);
  const sheet = await screen.findByRole("dialog", { name: "上车地点" });
  await actor.clear(within(sheet).getByRole("combobox", { name: "上车地点" }));
  await actor.type(within(sheet).getByRole("combobox", { name: "上车地点" }), "成田");
  await within(sheet).findByRole("listbox", { name: "上车地点的候选" }, SLOW);
  await actor.click(within(sheet).getByRole("option", { name: /成田国际机场/ }));
  await waitFor(() => assertAbsent(screen.queryByRole("dialog", { name: "上车地点" })));
  assert.match(pickupCell.textContent ?? "", /成田国际机场/);

  pending.resolve(json(200, { available: true, address: "日本、〒160-0023 東京都新宿区西新宿２丁目８−１" }));
  await act(async () => {
    await new Promise((done) => setTimeout(done, 50));
  });
  assert.match(screen.getByRole("button", { name: /^上车地点/ }).textContent ?? "", /成田国际机场/);
  assert.doesNotMatch(screen.getByRole("button", { name: /^上车地点/ }).textContent ?? "", /西新宿|地图上选的位置/);
});

test("手机地图选点（M8-42）：反查还没回来时客人改选了别的候选，反查回来后不覆盖新选的地点", async () => {
  const pending = deferred();
  open({ config: configOf({ map_tiles: ROUTE_TILES }), reverse: () => pending.promise });
  const actor = user();
  const fromCell = await pickFromOnMapInSheet(actor);

  await actor.click(fromCell);
  const again = await screen.findByRole("dialog", { name: "出发地" });
  await actor.clear(within(again).getByRole("combobox", { name: "出发地" }));
  await actor.type(within(again).getByRole("combobox", { name: "出发地" }), "成田");
  await within(again).findByRole("listbox", { name: "出发地的候选" }, SLOW);
  await actor.click(within(again).getByRole("option", { name: /成田国际机场/ }));
  await waitFor(() => assertAbsent(screen.queryByRole("dialog", { name: "出发地" })));
  assert.match(fromCell.textContent ?? "", /成田国际机场/);

  pending.resolve(json(200, { available: true, address: "日本、〒160-0023 東京都新宿区西新宿２丁目８−１" }));
  await act(async () => {
    await new Promise((done) => setTimeout(done, 50));
  });
  assert.match(fromCell.textContent ?? "", /成田国际机场/);
  assert.doesNotMatch(fromCell.textContent ?? "", /西新宿|地图上选的位置/);
});

test("手机触屏（M8-37 审查）：选择页开着时转屏换成页面输入框——选择页关掉、打了一半的字不留在输入框里冒充已选地址、转回来不自己弹出；浏览器自己关掉选择页（返回键）后还能再打开", async () => {
  let full = true;
  const listeners = new Set<() => void>();
  window.matchMedia = ((query: string) => ({
    get matches() {
      return query === FULL_SCREEN_PICKER_QUERY ? full : query === "(pointer: coarse)";
    },
    media: query,
    onchange: null,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  const flip = (next: boolean): void => {
    full = next;
    act(() => {
      for (const listener of [...listeners]) listener();
    });
  };
  open();
  const actor = user();
  await actor.click(await screen.findByRole("button", { name: /^出发地/ }));
  const sheet = await screen.findByRole("dialog", { name: "出发地" });
  await actor.type(within(sheet).getByRole("combobox", { name: "出发地" }), "成田");
  await within(sheet).findByRole("listbox", { name: "出发地的候选" }, SLOW);

  flip(false);
  await waitFor(() => assertAbsent(screen.queryByRole("dialog", { name: "出发地" })));
  const input = (await screen.findByRole("combobox", { name: "出发地" })) as HTMLInputElement;
  assert.equal(input.value, "", "选择页里打了一半的「成田」不留在页面输入框里");
  assert.equal(input.getAttribute("aria-expanded"), "false");

  flip(true);
  const cell = await screen.findByRole("button", { name: /^出发地/ });
  assertAbsent(screen.queryByRole("dialog", { name: "出发地" }));

  // 浏览器自己关掉 dialog（安卓返回键的 cancel 不可取消时）：React 跟着关，下次点还能打开
  await actor.click(cell);
  const native = (await screen.findByRole("dialog", { name: "出发地" })) as HTMLDialogElement;
  act(() => {
    native.close();
    native.dispatchEvent(new Event("close"));
  });
  await waitFor(() => assertAbsent(screen.queryByRole("dialog", { name: "出发地" })));
  await actor.click(screen.getByRole("button", { name: /^出发地/ }));
  assert.ok(await screen.findByRole("dialog", { name: "出发地" }), "还能再打开");
});

test("认出接机：时间标签变「航班落地时间（当地）」，提示「已识别为接机…落地后免费等待 N 分钟」N 取报价；第 3 步接机才有航班号（必填、查格式）和举牌姓名；送机没有", async () => {
  wideScreen();
  let tripType: SiteByPointsResult["trip_type"] = "pickup";
  open({ quote: () => json(200, byPoints({ trip_type: tripType, quotes: [quoteOf(1, { freeWait: 75 })] })) });
  const actor = user();
  await fillTrip(actor);
  assert.ok(await screen.findByText("已识别为接机：司机按航班落地时间等候，落地后免费等待 75 分钟", {}, SLOW));
  assert.ok(screen.getByLabelText("航班落地时间（当地）"));
  assert.ok(screen.getByText("东京的当地时间"));
  assertAbsent(screen.queryByLabelText("航班号"));
  await next(actor, NEXT_VEHICLES);
  await screen.findByRole("heading", { name: "车型1" }, SLOW);
  assert.ok(screen.getByText("航班落地后免费等待 75 分钟"));
  await actor.click(screen.getByRole("button", { name: "选择 车型1" }));
  await next(actor, NEXT_CONTACT);
  const flight = screen.getByLabelText("航班号");
  await next(actor, NEXT_REVIEW);
  assert.ok(screen.getByText("接机要填航班号，司机按航班落地时间等候"));
  await actor.type(flight, "NH");
  await next(actor, NEXT_REVIEW);
  assert.ok(screen.getByText("航班号的格式不对，如 NH211、MU523"));
  await actor.type(flight, "211");
  await actor.type(screen.getByLabelText("举牌姓名（选填）"), "ZHANG SAN");
  await actor.type(screen.getByLabelText("乘车人姓名"), "王小明");
  await actor.type(screen.getByLabelText("邮箱"), "guest@example.com");
  await actor.type(screen.getByLabelText("手机号（含国家区号）"), "+86 138 0000 0000");
  await next(actor, NEXT_REVIEW);
  await screen.findByRole("heading", { name: "核对订单" });
  assert.ok(within(aside()).getByText("NH211"), "航班号进了右侧栏的乘客信息");
  assert.ok(within(aside()).getByText("ZHANG SAN"));

  // 回第 1 步换成送机（目的地是机场）：没有接机提示；第 3 步没有航班号、举牌姓名
  tripType = "dropoff";
  await actor.click(screen.getByRole("button", { name: "修改行程" }));
  await pickPlace(actor, "出发地", "京王", /京王广场酒店/);
  await pickPlace(actor, "目的地", "成田", /成田国际机场/);
  await waitFor(() => assert.ok(screen.getByLabelText("用车时间（当地）")), SLOW);
  assertAbsent(screen.queryByText(/已识别为接机/));
  await next(actor, NEXT_VEHICLES);
  await screen.findByRole("heading", { name: "车型1" }, SLOW);
  assert.ok(screen.getByText("免费等待 75 分钟"));
  await next(actor, NEXT_CONTACT);
  assert.equal((screen.getByLabelText("乘车人姓名") as HTMLInputElement).value, "王小明", "换步不丢已填的内容");
  assertAbsent(screen.queryByLabelText("航班号"));
  assertAbsent(screen.queryByLabelText("举牌姓名（选填）"));
});

test("乘客 / 行李合并成一栏「2 人 · 2 件」；展开后分别 − +，到下限时 − 禁用；改了重新报价", async () => {
  wideScreen();
  const calls = open();
  const actor = user();
  await fillTrip(actor);
  await waitFor(() => assert.equal(posts(calls).length, 1), SLOW);
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

test("链接参数：from 编码（按编码取一次平台地点，不调谷歌、不逐城市扫描）、to 坐标加名称、date、time、pax、bags 打开就报价；不合法的只是不预填；链接带来的地点不算地址联想，不带 pickup_name / dropoff_name（M8-20）", async () => {
  wideScreen();
  const calls = open({ at: "/book/new?from=NRT&to=35.6905,139.6948&to_name=%E4%BA%AC%E7%8E%8B%E5%B9%BF%E5%9C%BA%E9%85%92%E5%BA%97&date=2030-11-20&time=14:30&pax=3&bags=1" });
  await screen.findByRole("heading", { name: "车型1" }, SLOW);
  assert.deepEqual(calls.filter((call) => call.path.startsWith("/site/v1/places/by-code")).map((call) => call.path), ["/site/v1/places/by-code?code=NRT"], "每个编码只按编码取一次");
  assert.equal(calls.filter((call) => /\/site\/v1\/cities\/[^/]+\/places/.test(call.path)).length, 0, "不逐城市扫描");
  assert.equal(calls.filter((call) => call.path.includes("/places/autocomplete") || call.path.includes("/places/search")).length, 0, "不经输入即提示、不调谷歌（M8-03 验收问题 2）");
  assert.deepEqual(posts(calls)[0]?.body, {
    pickup: { name: "成田国际机场", lat: 35.772, lng: 140.3929, kind: "airport" },
    dropoff: { name: "京王广场酒店", lat: 35.6905, lng: 139.6948 },
    service_local: "2030-11-20T14:30",
    passengers: 3,
    luggage: 1,
  });
  assert.equal(search().includes("step=2"), true, "齐了直接到第 2 步");
  assert.ok(within(aside()).getByText("成田国际机场"));
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

const DRAFT_ID = "aZ09_-".repeat(7) + "x";
const draftOf = (changes: Partial<BookingDraft> = {}): BookingDraft => ({
  v: 1,
  tab: "transfer",
  service_local: "2030-11-20T14:30",
  pickup: { name: "成田国际机场", lat: 35.772, lng: 140.3929 },
  dropoff: { name: "京王广场酒店", lat: 35.6905, lng: 139.6948 },
  waypoints: [],
  package_hours: null,
  passengers: 3,
  luggage: 1,
  lang: "ja",
  ...changes,
});

test("预订草稿（M9E-01）：区间按草稿整份预填，直接到第 2 步按两个坐标报价；只读一次草稿，其余链接参数不看", async () => {
  wideScreen();
  const calls = open({ at: `/book/new?draft=${DRAFT_ID}&from=HND&pax=9`, draft: () => json(200, { draft: draftOf(), expires_at: "2030-11-19T02:00:00.000Z" }) });
  await screen.findByRole("heading", { name: "车型1" }, SLOW);
  assert.deepEqual(calls.filter((call) => call.path.startsWith("/site/v1/booking-drafts/")).map((call) => call.path), [`/site/v1/booking-drafts/${DRAFT_ID}`]);
  assert.equal(calls.filter((call) => call.path.startsWith("/site/v1/places/by-code")).length, 0, "带草稿时不看 from");
  assert.deepEqual(posts(calls)[0]?.body, {
    pickup: { name: "成田国际机场", lat: 35.772, lng: 140.3929 },
    dropoff: { name: "京王广场酒店", lat: 35.6905, lng: 139.6948 },
    service_local: "2030-11-20T14:30",
    passengers: 3,
    luggage: 1,
  });
  assert.equal(search().includes("step=2"), true);
  assert.ok(within(aside()).getByText("成田国际机场"));
});

test("预订草稿（M9E-01）：包车带经停点按行程询价（带 itinerary_pricing 和 waypoints、不带时长）", async () => {
  wideScreen();
  const draft = draftOf({ tab: "charter", pickup: { name: "银座", lat: 35.6717, lng: 139.765 }, dropoff: { name: "新宿站", lat: 35.6896, lng: 139.7006 }, waypoints: [{ name: "浅草寺", lat: 35.7148, lng: 139.7967, stay_minutes: 60 }] });
  const calls = open({ at: `/book/new?draft=${DRAFT_ID}`, draft: () => json(200, { draft, expires_at: "2030-11-19T02:00:00.000Z" }) });
  await waitFor(() => assert.equal(posts(calls, "/site/v1/quotes").length > 0, true), SLOW);
  const body = posts(calls, "/site/v1/quotes")[0]?.body as Record<string, unknown>;
  assert.equal(body.category, "charter");
  assert.equal(body.itinerary_pricing, true);
  assert.deepEqual(body.waypoints, [{ name: "浅草寺", lat: 35.7148, lng: 139.7967, stay_minutes: 60 }]);
  assert.equal("package_hours" in body, false);
  assert.deepEqual([body.service_local, body.passengers, body.luggage], ["2030-11-20T14:30", 3, 1]);
});

test("预订草稿（M9E-01）：包车按时长，时长在城市套餐里——预填后到第 2 步按这个时长询价", async () => {
  wideScreen();
  const draft = draftOf({ tab: "charter", pickup: { name: "银座", lat: 35.6717, lng: 139.765 }, dropoff: { name: "新宿站", lat: 35.6896, lng: 139.7006 }, package_hours: 8 });
  const calls = open({ at: `/book/new?draft=${DRAFT_ID}`, packages: [4, 8], draft: () => json(200, { draft, expires_at: "2030-11-19T02:00:00.000Z" }) });
  await waitFor(() => assert.equal(posts(calls, "/site/v1/quotes").length > 0, true), SLOW);
  const body = posts(calls, "/site/v1/quotes")[0]?.body as Record<string, unknown>;
  assert.deepEqual([body.category, body.package_hours, "itinerary_pricing" in body], ["charter", 8, false]);
  await waitFor(() => assert.equal(search().includes("step=2"), true));
});

test("预订草稿（M9E-01）：包车按时长，时长不在城市套餐里——清空时长、停在第 1 步、不询价", async () => {
  wideScreen();
  const draft = draftOf({ tab: "charter", pickup: { name: "银座", lat: 35.6717, lng: 139.765 }, dropoff: { name: "新宿站", lat: 35.6896, lng: 139.7006 }, package_hours: 5 });
  const calls = open({ at: `/book/new?draft=${DRAFT_ID}`, packages: [4, 8], draft: () => json(200, { draft, expires_at: "2030-11-19T02:00:00.000Z" }) });
  await waitFor(() => assert.ok(calls.some((call) => call.path.startsWith("/site/v1/charter-packages?"))), SLOW);
  await waitFor(() => assert.equal((screen.getByRole("combobox", { name: "上车地点" }) as HTMLInputElement).value, "银座"));
  await new Promise((resolve) => setTimeout(resolve, 800));
  assert.equal(posts(calls, "/site/v1/quotes").length, 0, "时长不在套餐里不询价");
  assert.equal(search().includes("step=2"), false);
  const hours = screen.getByLabelText(/^包车时长/) as HTMLSelectElement;
  assert.equal(hours.value, "", "时长清空，等客人重选");
});

test("预订草稿（M9E-03）：嵌入组件的包车、没填经停点（不带时长）——停在第 1 步，客人在预订页选时长后报价", async () => {
  wideScreen();
  const draft = draftOf({ tab: "charter", pickup: { name: "银座", lat: 35.6717, lng: 139.765 }, dropoff: { name: "新宿站", lat: 35.6896, lng: 139.7006 }, package_hours: null });
  const calls = open({ at: `/book/new?draft=${DRAFT_ID}`, packages: [4, 8], draft: () => json(200, { draft, expires_at: "2030-11-19T02:00:00.000Z" }) });
  const hours = (await screen.findByLabelText(/^包车时长/, {}, SLOW)) as HTMLSelectElement;
  await waitFor(() => assert.equal((screen.getByRole("combobox", { name: "上车地点" }) as HTMLInputElement).value, "银座"));
  await waitFor(() => assert.ok([...hours.options].some((option) => option.value === "8")));
  assert.equal(hours.value, "");
  assert.equal(posts(calls, "/site/v1/quotes").length, 0);
  assert.equal(search().includes("step=2"), false);
  await user().selectOptions(hours, "8");
  await waitFor(() => assert.equal(posts(calls, "/site/v1/quotes").length > 0, true), SLOW);
  assert.equal((posts(calls, "/site/v1/quotes")[0]?.body as Record<string, unknown>).package_hours, 8);
});

test("预订草稿（M9E-01）：过期或不存在时说「链接已过期」并留空白表单；读不出来（限速、网络）另一种说法；都不报价", async () => {
  wideScreen();
  const calls = open({ at: `/book/new?draft=${DRAFT_ID}` });
  assert.ok(await screen.findByText("链接已过期，请重新填写。", {}, SLOW));
  assert.equal(screen.getAllByText("只填地点，不要填姓名、电话。").length, 2, "出发地、目的地框都提示只填地点（ADR 0090）");
  assert.equal((screen.getByRole("combobox", { name: "出发地" }) as HTMLInputElement).value, "");
  assert.equal((screen.getByRole("combobox", { name: "目的地" }) as HTMLInputElement).value, "");
  assert.equal(posts(calls).length, 0);
  assert.equal(search().includes("step=2"), false);
  resetBrowser();

  wideScreen();
  open({ at: `/book/new?draft=${DRAFT_ID}`, draft: () => apiError(429, "RATE_LIMITED", "太频繁", {}, { "retry-after": "30" }) });
  assert.ok(await screen.findByText("没能读取预订信息，请重新填写，或稍后刷新页面。", {}, SLOW));
});

test("报不出价：时间太近、人数太多、地址不在服务范围各有说法和客服电话；不显示内部代码", async () => {
  for (const [reason, text] of [
    ["LEAD_TIME_TOO_SHORT", "时间太近，请选更晚的时间或联系客服"],
    ["CAPACITY_EXCEEDED", "人数或行李超过所有车型，可以分两辆车预订或联系客服"],
    ["OUT_OF_SERVICE_AREA", "这个地址暂时没有在线报价，请联系客服"],
    // M9W-10：其他原因不让客人「换一个时间」，请客服人工报价
    ["NOT_AVAILABLE", "这个行程暂时无法在线报价，请联系客服人工报价，或调整行程后再试。"],
  ] as const) {
    wideScreen();
    open({ at: "/book/new?from=35.772,140.3929&to=35.6905,139.6948&date=2030-11-20&time=14:30", quote: () => json(200, byPoints({ quotes: [], unavailable: [{ vehicle_group_id: null, reasons: [reason] }] })) });
    assert.ok(await screen.findByText(text, {}, SLOW));
    assert.ok(screen.getByRole("heading", { name: "没有可预订的车" }));
    assert.equal(screen.getByRole("link", { name: "+81 3-1234-5678" }).getAttribute("href"), "tel:+81312345678");
    assert.doesNotMatch(document.body.textContent ?? "", new RegExp(reason));
    assert.doesNotMatch(document.body.textContent ?? "", /换一个时间/);
    resetBrowser();
  }
});

test("一口价包含：接送写「含所有费用」、专车、免费等待；包车也写「含所有费用」（M8-09），下面只说超出套餐的时长和公里另收；任何时候都没有「跟踪航班」，也没有举牌（报价里没有商品的包含清单）", async () => {
  wideScreen();
  const calls = open({ at: "/book/new?from=35.772,140.3929&to=35.6905,139.6948&date=2030-11-20&time=14:30" });
  await screen.findByRole("heading", { name: "车型1" }, SLOW);
  const includes = screen.getByRole("region", { name: "一口价包含" });
  assert.deepEqual(within(includes).getAllByRole("listitem").map((item) => item.textContent), ["一口价已含所有费用（高速费、停车费等），无需另付", "专车专用，不拼车", "航班落地后免费等待 60 分钟"]);
  assert.doesNotMatch(document.body.textContent ?? "", /跟踪航班|举牌/);
  void calls;

  const actor = user();
  await actor.click(screen.getByRole("button", { name: "上一步" }));
  await actor.click(screen.getByRole("radio", { name: "包车" }));
  await pickPlace(actor, "上车地点", "京王", /京王广场酒店/);
  await screen.findByLabelText(/包车时长/);
  await next(actor, NEXT_VEHICLES);
  await screen.findByRole("heading", { name: "车型1" }, SLOW);
  const charter = posts(calls, "/site/v1/quotes").at(-1)?.body as Record<string, unknown>;
  // 不带城市（M9P-02）：服务器按上下车点找
  assert.deepEqual([charter["category"], "city_id" in charter, charter["package_hours"]], ["charter", false, 8]);
  const charterIncludes = screen.getByRole("region", { name: "一口价包含" });
  assert.deepEqual(within(charterIncludes).getAllByRole("listitem").map((item) => item.textContent), ["一口价已含所有费用（高速费、停车费等），无需另付", "专车专用，不拼车"]);
  assert.doesNotMatch(document.body.textContent ?? "", /跟踪航班|高速费、停车费服务后/);
  assert.ok(within(charterIncludes).getByText("超出套餐的时长和公里服务后按实际收取：先通知您，48 小时内可以在订单页提异议。"));
  assert.ok(screen.getByText("8 小时，含 150 公里"));
});

test("手机分步：每步一屏、步骤条；第 1 步没填好时标红；第 2 步底部固定「车型 · 一口价 [下一步]」；右侧栏变成顶部可展开的摘要条，按步骤累积；「上一步」回去焦点到标题", async () => {
  narrowScreen();
  open();
  const actor = user();
  await screen.findByRole("heading", { name: "你的行程" });
  assertAbsent(screen.queryByRole("heading", { name: "选择车型" }));
  assertAbsent(screen.queryByRole("complementary", { name: "行程摘要" }));
  const steps = screen.getByRole("list", { name: "预订步骤" });
  assert.equal(within(steps).getAllByRole("listitem").length, 4);
  assert.equal(within(steps).getAllByRole("listitem")[0]?.getAttribute("aria-current"), "step");
  const bar = screen.getByRole("button", { name: /^行程摘要/ });
  assert.equal(bar.getAttribute("aria-expanded"), "false");
  await next(actor, NEXT_VEHICLES);
  assert.ok(screen.getByText("有几项没有填好，请看标红的地方。"));
  assert.ok(screen.getByText("请从候选里选出发地"));
  assert.equal(screen.getByRole("combobox", { name: "出发地" }).getAttribute("aria-invalid"), "true");

  await fillTrip(actor);
  await next(actor, NEXT_VEHICLES);
  const heading = await screen.findByRole("heading", { name: "选择车型" });
  assertFocused(heading);
  assert.equal(search(), "?step=2");
  assertAbsent(screen.queryByRole("heading", { name: "你的行程" }));
  await screen.findByRole("heading", { name: "车型1" }, SLOW);
  assert.match(document.querySelector(".book-summary-bar__text")?.textContent ?? "", /^接机 · 成田国际机场 → 京王广场酒店/);
  assertAbsent(screen.queryByRole("button", { name: "下一步" }));
  await actor.click(screen.getByRole("button", { name: "选择 车型1" }));
  assert.ok(screen.getByText(/车型1/, { selector: ".book-bar__text span" }));
  await actor.click(screen.getByRole("button", { name: "下一步" }));
  assertFocused(screen.getByRole("heading", { name: "乘客信息", level: 2 }));
  assert.equal(search(), "?step=3");
  assert.ok(screen.getByLabelText("航班号"), "接机的航班号在第 3 步");
  assertAbsent(screen.queryByRole("button", { name: "下一步" }));

  // 摘要条展开：路线以外是第 1、2 步确认过的内容
  await actor.click(screen.getByRole("button", { name: /^行程摘要/ }));
  assert.equal(screen.getByRole("button", { name: /^行程摘要/ }).getAttribute("aria-expanded"), "true");
  const panel = document.getElementById("book-summary-panel") as HTMLElement;
  assert.ok(within(panel).getByText("成田国际机场"));
  assert.ok(within(panel).getByText("车型1"));
  assertAbsent(within(panel).queryByRole("heading", { name: "乘客信息" }));

  await actor.click(screen.getByRole("button", { name: "上一步" }));
  assertFocused(screen.getByRole("heading", { name: "选择车型" }));
  await actor.click(screen.getByRole("button", { name: "第 1 步：行程（已完成，回到这一步）" }));
  assertFocused(screen.getByRole("heading", { name: "你的行程" }));
  assert.equal((screen.getByRole("combobox", { name: "出发地" }) as HTMLInputElement).value, "成田国际机场", "回到第 1 步内容还在");
});

/** 电脑宽：链接打开就报价、直接到第 2 步，选第一个车型。 */
async function openSelected(options: Options = {}): Promise<{ calls: ApiCall[]; actor: ReturnType<typeof user> }> {
  wideScreen();
  const calls = open({ at: "/book/new?from=35.772,140.3929&from_name=%E6%88%90%E7%94%B0%E5%9B%BD%E9%99%85%E6%9C%BA%E5%9C%BA&to=35.6905,139.6948&to_name=%E4%BA%AC%E7%8E%8B%E5%B9%BF%E5%9C%BA%E9%85%92%E5%BA%97&date=2030-11-20&time=14:30", ...options });
  const actor = user();
  await screen.findByRole("heading", { name: "车型1" }, SLOW);
  await actor.click(screen.getByRole("button", { name: "选择 车型1" }));
  return { calls, actor };
}

test("乘客信息和付款：第 3 步没填好时标红（姓名、手机、邮箱、即时通讯账号、接机的航班号）不往下走；第 4 步核对、修改回到对应步骤；没勾同意保存银行卡不下单；按现有下单接口下单（同一个幂等键、地址取行程里的名称、举牌姓名单独提交），然后进订单页", async () => {
  let posted = 0;
  const { calls, actor } = await openSelected({
    order: () => {
      posted += 1;
      return posted === 1 ? apiError(502, "UPSTREAM", "x") : json(201, { order: {}, timeline: [], names: {}, payment: null, link: { token: `nzo_${"a".repeat(43)}`, expires_at: "2030-12-01T00:00:00.000Z" } });
    },
  });
  await next(actor, NEXT_CONTACT);
  await actor.selectOptions(screen.getByLabelText("微信 / LINE / WhatsApp（选填）"), "line");
  await next(actor, NEXT_REVIEW);
  assert.ok(screen.getByText("有几项没有填好，请看标红的地方。"));
  for (const text of ["请填写乘车人姓名", "请填写带国家码的手机号，如 +81 90-1234-5678、+86 138 0000 0000", "请填写正确的邮箱，订单确认和查看链接会发到这里", "选了即时通讯就要填账号", "接机要填航班号，司机按航班落地时间等候"]) assert.ok(screen.getByText(text), text);
  assertAbsent(screen.queryByText("需要同意保存支付方式才能下单"));
  assert.equal(screen.getByLabelText("航班号").getAttribute("aria-invalid"), "true");
  assertAbsent(screen.queryByRole("heading", { name: "核对订单" }));

  await actor.type(screen.getByLabelText("乘车人姓名"), "王小明");
  await actor.type(screen.getByLabelText("邮箱"), "guest@example.com");
  await actor.type(screen.getByLabelText("手机号（含国家区号）"), "+86 138 0000 0000");
  await actor.type(screen.getByLabelText("即时通讯账号"), "wangxm");
  await actor.type(screen.getByLabelText("给司机的备注（选填）"), "两个大箱子");
  await actor.type(screen.getByLabelText("航班号"), "nh 211");
  assert.equal((screen.getByLabelText("举牌姓名（选填）") as HTMLInputElement).value, "王小明", "为自己预订：举牌姓名默认是乘车人的名字");
  await actor.clear(screen.getByLabelText("举牌姓名（选填）"));
  await actor.type(screen.getByLabelText("举牌姓名（选填）"), "WANG XIAOMING");
  await next(actor, NEXT_REVIEW);
  const review = screen.getByRole("region", { name: "核对订单" });
  assertFocused(screen.getByRole("heading", { name: "核对订单" }));
  for (const text of ["接机", "京王广场酒店", "车型1", "王小明", "guest@example.com", "NH 211", "WANG XIAOMING", "wangxm", "两个大箱子", "用车前 24 小时以上取消免费；24 小时内取消收全额"]) assert.ok(within(review).getAllByText(text).length >= 1, text);
  assert.ok(within(aside()).getByRole("heading", { name: "乘客信息" }), "右侧栏到第 4 步追加乘客信息");

  // 「修改」回到对应步骤，内容还在；再回来
  await actor.click(within(review).getByRole("button", { name: "修改乘客信息" }));
  assertFocused(screen.getByRole("heading", { name: "乘客信息", level: 2 }));
  assert.equal((screen.getByLabelText("举牌姓名（选填）") as HTMLInputElement).value, "WANG XIAOMING");
  await next(actor, NEXT_REVIEW);

  const pay = screen.getByRole("button", { name: "去付款 →" });
  assert.equal(pay.getAttribute("form"), "book-contact-form");
  await actor.click(pay);
  assert.ok(screen.getByText("需要同意保存支付方式才能下单"));
  assert.equal(posts(calls, "/site/v1/orders").length, 0);
  await actor.click(screen.getByRole("checkbox", { name: /同意保存这次付款用的银行卡/ }));
  await actor.click(pay);
  assert.ok(await screen.findByText(/再点一次「去付款」不会重复下单/));
  await actor.click(screen.getByRole("button", { name: "去付款 →" }));
  await waitFor(() => assert.equal(posts(calls, "/site/v1/orders").length, 2));
  const orders = posts(calls, "/site/v1/orders");
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
    sign_name: "WANG XIAOMING",
    passenger_name: null,
    passenger_phone: null,
  });
  await waitFor(() => assertAbsent(screen.queryByRole("heading", { name: "核对订单" })));
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
  await waitFor(() => assert.ok(within(aside()).getByText("26,500")), SLOW);
  const withAddons = posts(calls).filter((call) => (call.body as { addons?: unknown }).addons !== undefined);
  assert.deepEqual((withAddons.at(-1)?.body as { addons: unknown }).addons, [
    { addon_id: seat.id, quantity: 2 },
    { addon_id: sign.id, quantity: 1 },
  ]);
  assert.equal(screen.getAllByRole("heading", { level: 3, name: /^车型\d$/ }).length, 2, "车型列表还是不带附加服务的那一次");

  // 第 4 步：车费不变、附加服务一行是合计差额、合计用新报价，不显示单价
  await toReview(actor);
  const review = screen.getByRole("region", { name: "核对订单" });
  assert.ok(within(review).getByText("+4,500 JPY"));
  assert.ok(within(review).getByText("22,000 JPY"), "车费不变");
  assert.ok(within(review).getByText("26,500"), "合计用新报价");
  assert.doesNotMatch(review.textContent ?? "", /1,500/, "不显示单价");

  await actor.click(within(review).getByRole("button", { name: "修改车型和价格" }));
  const again = screen.getByRole("region", { name: "附加服务（选填）" });
  offered = false;
  await actor.click(within(again).getByRole("button", { name: "减少儿童座椅" }));
  assert.ok(await within(aside()).findByText("这个车型现在加不了所选的附加服务，请减少附加服务或换一个车型。", {}, SLOW));
  offered = true;
  await actor.click(within(again).getByRole("button", { name: "减少儿童座椅" }));
  await actor.click(within(again).getByRole("button", { name: "减少举牌" }));
  await actor.click(within(again).getByRole("button", { name: "减少儿童座椅" }));
  await waitFor(() => assert.ok(within(aside()).getByText("22,000")), SLOW);
});

test("参考价：按浏览器语言推断币种、可以手动换；可用时「≈ 金额」和小字；不可用时不显示", async () => {
  const { calls, actor } = await openSelected({
    fx: (call) => {
      const to = call.url.searchParams.get("to");
      return to === "CNY" ? json(200, { available: true, from: "JPY", to, rate: "0.047351", as_of: "2030-11-19T00:00:00.000Z", reason: null }) : json(200, { available: false, from: "JPY", to, rate: null, as_of: null, reason: "STALE" });
    },
  });
  await toReview(actor);
  const review = screen.getByRole("region", { name: "核对订单" });
  await waitFor(() => assert.ok(calls.some((call) => call.path.startsWith("/site/v1/fx/reference"))));
  assertAbsent(within(review).queryByText(/≈/));
  await actor.selectOptions(within(review).getByLabelText("参考币种"), "CNY");
  await waitFor(() => assert.match(review.textContent ?? "", /≈ 899.67 CNY/));
  assert.ok(within(review).getByText("按当前汇率换算，仅供参考，实际以支付金额为准"));
  await actor.selectOptions(within(review).getByLabelText("参考币种"), "KRW");
  await waitFor(() => assertAbsent(within(review).queryByText(/≈/)));
});

const ROUTE_TILES: MapTiles = { url_template: "http://127.0.0.1:1/{z}/{x}/{y}.png", dark_url_template: null, min_zoom: 3, max_zoom: 19, tile_size: 256, referrer_policy: "strict-origin", attribution: [{ text: "© OpenStreetMap", href: "https://www.openstreetmap.org/copyright" }] };
const ROUTE_LABEL = "路线图：成田国际机场 → 京王广场酒店，约 52 分钟 · 63.4 公里";
const withRoute = (): Route => () => json(200, byPoints({ route: { minutes: 52, meters: 63_420, polyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@" } }));
const png = (): Response => new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { status: 200, headers: { "content-type": "image/png" } });

/** 右侧栏里路线图的那张静态图（加载中整框对读屏隐藏，所以直接按类名找）。 */
function staticMap(): HTMLImageElement {
  const image = document.querySelector<HTMLImageElement>(".route-map__image");
  assert.ok(image, "有路线静态图");
  return image;
}

test("路线（M8-10）：按框的大小、倍率、亮暗要谷歌静态图；加载中是同样大小的骨架；出图后是带文字说明的图（不叠底图署名）；切到暗色换一张暗色的图", async () => {
  const { calls } = await openSelected({ config: configOf({ map_tiles: ROUTE_TILES }), quote: withRoute() });
  const image = staticMap();
  const url = new URL(image.getAttribute("src") ?? "", "http://localhost");
  assert.equal(url.pathname, "/site/v1/route-map");
  assert.deepEqual(Object.fromEntries(url.searchParams), { from_lat: "35.772000", from_lng: "140.392900", to_lat: "35.690500", to_lng: "139.694800", theme: "light", width: "200", height: "150", scale: "1" });
  assert.equal(image.getAttribute("alt"), ROUTE_LABEL);
  const frame = image.closest(".route-map__canvas");
  assert.ok(frame?.classList.contains("route-map__canvas--loading"), "加载中用骨架");
  assert.equal(frame?.getAttribute("aria-hidden"), "true");
  assert.ok(screen.getByText("约 52 分钟 · 63.4 公里"));

  fireEvent.load(image);
  assert.ok(screen.getByRole("img", { name: ROUTE_LABEL }));
  assert.equal(frame?.classList.contains("route-map__canvas--loading"), false);
  assertAbsent(screen.queryByRole("link", { name: "© OpenStreetMap" }));
  assertAbsent(document.querySelector(".leaflet-container"));
  assert.deepEqual(screen.queryAllByRole("alert").map((alert) => alert.textContent), screen.queryAllByRole("alert").map(() => ""), "没有报错");
  assert.equal(calls.filter((call) => call.path.startsWith("/site/v1/route-map")).length, 0, "图正常出来时不再另外请求");

  document.documentElement.dataset["theme"] = "dark";
  await waitFor(() => assert.equal(new URL(staticMap().getAttribute("src") ?? "", "http://localhost").searchParams.get("theme"), "dark"));
  assert.ok(staticMap().closest(".route-map__canvas--loading"), "换图时先是骨架");
  fireEvent.load(staticMap());
  assert.ok(screen.getByRole("img", { name: ROUTE_LABEL }));
});

test("路线（M8-10）：高清屏要 2 倍的图", async () => {
  const original = window.devicePixelRatio;
  Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 3 });
  try {
    await openSelected({ config: configOf({ map_tiles: ROUTE_TILES }), quote: withRoute() });
    assert.equal(new URL(staticMap().getAttribute("src") ?? "", "http://localhost").searchParams.get("scale"), "2");
  } finally {
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: original });
  }
});

test("路线（M8-10）：平台还没开通静态地图（503 NOT_ENABLED）时退回现有底图画折线，带底图署名；没有底图时只写字", async () => {
  const notEnabled = (): Response => apiError(503, "ROUTE_MAP_UNAVAILABLE", "路线图暂不可用", { reason: "NOT_ENABLED" });
  await openSelected({ config: configOf({ map_tiles: ROUTE_TILES }), quote: withRoute(), routeMap: notEnabled });
  fireEvent.error(staticMap());
  assert.ok(await screen.findByRole("img", { name: ROUTE_LABEL }, SLOW));
  // 静态图坏了以后要再问一次接口才知道是 NOT_ENABLED，退回的底图在那之后才挂上：等底图本身出现，不能在找到图片角色后立刻查（PR #171 CI run 43306861619 偶发 null）
  await waitFor(() => assert.ok(document.querySelector(".leaflet-container"), "现有底图"), SLOW);
  assertAbsent(document.querySelector(".route-map__image"));
  assert.ok(screen.getByRole("link", { name: "© OpenStreetMap" }));
  assert.ok(screen.getByText("约 52 分钟 · 63.4 公里"));
  resetBrowser();

  await openSelected({ config: configOf({ map_tiles: null }), quote: withRoute(), routeMap: notEnabled });
  fireEvent.error(staticMap());
  await waitFor(() => assertAbsent(document.querySelector(".route-map")), SLOW);
  assert.ok(screen.getByText("约 52 分钟 · 63.4 公里"));
});

test("路线（M8-29）：知道静态地图没开通以后切换亮暗主题，还是同一张现有底图（当场压暗、不重建），不再按新主题要静态图", async () => {
  const notEnabled = (): Response => apiError(503, "ROUTE_MAP_UNAVAILABLE", "路线图暂不可用", { reason: "NOT_ENABLED" });
  const { calls } = await openSelected({ config: configOf({ map_tiles: ROUTE_TILES }), quote: withRoute(), routeMap: notEnabled });
  fireEvent.error(staticMap());
  await waitFor(() => assert.ok(document.querySelector(".route-map__canvas.leaflet-container"), "现有底图"), SLOW);
  const canvas = document.querySelector(".route-map__canvas") as HTMLElement;
  const tilePane = canvas.querySelector(".leaflet-tile-pane");
  const line = canvas.querySelector(".route-map__line");
  const asked = (): number => calls.filter((call) => call.path.startsWith("/site/v1/route-map")).length;
  assert.equal(asked(), 1, "图坏了以后问过一次原因");

  for (const theme of ["dark", "light", "dark"] as const) {
    document.documentElement.dataset["theme"] = theme;
    await waitFor(() => assert.equal(canvas.classList.contains("area-map__canvas--dimmed"), theme === "dark", theme));
    assert.equal(document.querySelector(".route-map__canvas"), canvas, `${theme}：还是同一个地图容器`);
    assert.equal(canvas.querySelector(".leaflet-tile-pane"), tilePane, `${theme}：瓦片层没有重建`);
    assert.equal(canvas.querySelector(".route-map__line"), line, `${theme}：路线没有重画`);
    assertAbsent(document.querySelector(".route-map__image"));
    assertAbsent(document.querySelector(".route-map__canvas--loading"));
    assert.equal(asked(), 1, `${theme}：不再请求静态图`);
  }
});

test("路线（M8-10）：静态图暂时不可用、网络不通、图片坏了或不是图片时不显示地图（也不留空框），只写「约 X 分钟 · Y 公里」，不报错", async () => {
  const failures: [string, Route][] = [
    ["503 UNAVAILABLE", () => apiError(503, "ROUTE_MAP_UNAVAILABLE", "路线图暂不可用", { reason: "UNAVAILABLE" })],
    ["429 太频繁", () => apiError(429, "RATE_LIMITED", "太频繁", { retry_after_seconds: 30 }, { "retry-after": "30" })],
    ["网络错误", () => Promise.reject(new TypeError("Failed to fetch"))],
    ["图片坏了（再问一次是 200 图片）", png],
    ["不是图片", () => json(200, { ok: true })],
    ["别的错误", () => apiError(500, "INTERNAL", "x")],
  ];
  for (const [what, routeMap] of failures) {
    const { calls } = await openSelected({ config: configOf({ map_tiles: ROUTE_TILES }), quote: withRoute(), routeMap });
    fireEvent.error(staticMap());
    await waitFor(() => assertAbsent(document.querySelector(".route-map")), SLOW);
    assert.equal(calls.filter((call) => call.path.startsWith("/site/v1/route-map")).length, 1, what);
    assertAbsent(document.querySelector(".leaflet-container"));
    assertAbsent(screen.queryByRole("img", { name: /路线图/ }));
    assert.ok(screen.getByText("约 52 分钟 · 63.4 公里"), what);
    assert.deepEqual(screen.queryAllByRole("alert").map((alert) => alert.textContent), screen.queryAllByRole("alert").map(() => ""), "没有报错");
    resetBrowser();
  }
});

test("路线：取不到路线时这一块不出现，不要静态图", async () => {
  const { calls, actor } = await openSelected({ config: configOf({ map_tiles: ROUTE_TILES }) });
  assertAbsent(document.querySelector(".route-map"));
  assertAbsent(screen.queryByText(/约 \d+ 分钟/));
  assert.equal(calls.filter((call) => call.path.startsWith("/site/v1/route-map")).length, 0);
  await toReview(actor);
  assert.ok(screen.getByRole("button", { name: "去付款 →" }));
  assert.ok(screen.getByText("银行卡"));
  assert.ok(screen.getByText("用车前 24 小时以上取消免费；24 小时内取消收全额"));
});

test("链接参数：编码找不到、或被限速读不出来时，页面说一句（不静默），其余照常预填，不自动报价", async () => {
  wideScreen();
  const calls = open({ at: "/book/new?from=ZZZ&to=35.6905,139.6948&to_name=%E4%BA%AC%E7%8E%8B&date=2030-11-20&time=14:30" });
  assert.ok(await screen.findByText("链接里的地点「ZZZ」没有找到，请在下面重新选择出发地。", {}, SLOW));
  await waitFor(() => assert.equal((screen.getByRole("combobox", { name: "目的地" }) as HTMLInputElement).value, "京王"));
  assert.equal((screen.getByRole("combobox", { name: "出发地" }) as HTMLInputElement).value, "");
  assert.equal(posts(calls).length, 0);
  resetBrowser();

  wideScreen();
  open({ at: "/book/new?from=NRT&to=HND", byCode: () => apiError(429, "RATE_LIMITED", "太频繁", {}, { "retry-after": "30" }) });
  assert.ok(await screen.findByText("链接里的地点「NRT」、「HND」暂时没有读出来，请稍后刷新页面，或在下面直接选择。", {}, SLOW));
});

test("附加服务报不出价时点「去付款」：说这个车型现在加不了（和合计处同一句），不说价格还在计算", async () => {
  const seat = { id: "a1a1a1a1-aaaa-4aaa-8aaa-aaaaaaaaaaa1", code: "ADD-SEAT", name: { zh: "儿童座椅" }, charge_unit: "per_item" } as const;
  const { actor } = await openSelected({
    quote: (call) =>
      (call.body as { addons?: unknown }).addons === undefined
        ? json(200, byPoints({ quotes: [quoteOf(1, { addons: [seat] })] }))
        : json(200, byPoints({ quotes: [], unavailable: [{ vehicle_group_id: null, reasons: ["ADDON_NOT_OFFERED"] }] })),
  });
  await actor.click(within(screen.getByRole("region", { name: "附加服务（选填）" })).getByRole("button", { name: "增加儿童座椅" }));
  await screen.findByText("这个车型现在加不了所选的附加服务，请减少附加服务或换一个车型。", {}, SLOW);
  await toReview(actor);
  await actor.click(screen.getByRole("checkbox", { name: /同意保存这次付款用的银行卡/ }));
  await actor.click(screen.getByRole("button", { name: "去付款 →" }));
  const review = screen.getByRole("region", { name: "核对订单" });
  assert.equal(within(review).getAllByText("这个车型现在加不了所选的附加服务，请减少附加服务或换一个车型。").length, 2, "合计处和「去付款」后的说法一致");
  assertAbsent(screen.queryByText(/价格还在计算/));
});

// ---- M8-19：包车的下车地点（必填）、含区域加价（规范 site-booking-v2.md 10.1、10.2、10.4） ----

const CHARTER_LINK = "/book/new?mode=charter&from=35.6905,139.6948&from_name=%E4%BA%AC%E7%8E%8B%E5%B9%BF%E5%9C%BA%E9%85%92%E5%BA%97&date=2030-11-20&time=09:00";
const charterQuotes = (surcharge: boolean): SiteQuoteResult => ({ currency: "JPY", quotes: [{ ...quoteOf(1, { freeWait: 0, amount: 78650, package: { hours: 8, km: 150 } }), includes_area_surcharge: surcharge }], unavailable: [] });

test("包车：字段顺序 服务 → 上车地点 → 下车地点 → 包车时长 → 日期时间；下车地点是同一个地址框，帮助文字；没选下车地点不报价，选了以后询价带 dropoff 坐标", async () => {
  wideScreen();
  const calls = open({ at: "/book/new?mode=charter", charter: () => json(200, charterQuotes(false)) });
  const actor = user();
  await screen.findByRole("heading", { name: "你的行程" });
  await pickPlace(actor, "上车地点", "京王", /京王广场酒店/);
  await screen.findByLabelText(/包车时长/);
  const labels = [...document.querySelectorAll(".book-new__trip label")].map((label) => label.textContent?.replace("*", "").trim()).filter((text) => text !== "");
  assert.deepEqual(labels.slice(0, 6), ["区间", "包车", "上车地点", "下车地点", "包车时长", "日期（当地）"]);
  assert.equal((screen.getByRole("radio", { name: "包车" }) as HTMLInputElement).checked, true);
  const dropoff = screen.getByRole("combobox", { name: "下车地点" });
  assert.equal(dropoff.getAttribute("aria-required"), "true");
  assert.match(dropoff.getAttribute("aria-describedby") ?? "", /hint/);
  assert.ok(screen.getByText("包车结束时在哪里下车，价格按上车和下车地点算。"));
  const date = screen.getByLabelText("日期（当地）") as HTMLInputElement;
  await actor.clear(date);
  await actor.type(date, "2030-11-20");
  fireEvent.change(screen.getByLabelText("上车时间（当地）"), { target: { value: "09:00" } });
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal(posts(calls, "/site/v1/quotes").length, 0, "没选下车地点不报价");

  await pickPlace(actor, "下车地点", "成田", /成田国际机场/);
  await next(actor, NEXT_VEHICLES);
  await screen.findByRole("heading", { name: "车型1" }, SLOW);
  const body = posts(calls, "/site/v1/quotes").at(-1)?.body as Record<string, unknown>;
  assert.deepEqual([body["category"], body["pickup"], body["dropoff"], body["package_hours"], body["service_local"]], ["charter", { lat: 35.6905, lng: 139.6948 }, { lat: 35.772, lng: 140.3929 }, 8, "2030-11-20T09:00"]);
  assertAbsent(screen.queryByText("含区域加价，已算在这个价格里"));
});

test("包车含区域加价：车型卡价格下面、右侧栏车费下面写「含区域加价，已算在这个价格里」，只有一个总价、不写加价金额；行程摘要有下车地点；下单带 dropoff_address", async () => {
  wideScreen();
  const calls = open({
    at: `${CHARTER_LINK}&to=35.772,140.3929&to_name=${encodeURIComponent("成田国际机场")}`,
    charter: () => json(200, charterQuotes(true)),
    order: () => json(201, { order: {}, timeline: [], names: {}, payment: null, link: { token: `nzo_${"b".repeat(43)}`, expires_at: "2030-12-01T00:00:00.000Z" } }),
  });
  const actor = user();
  const card = (await screen.findByRole("heading", { name: "车型1" }, SLOW)).closest("li") as HTMLElement;
  assert.ok(within(card).getByText("含区域加价，已算在这个价格里"));
  assert.match(card.textContent ?? "", /78,650 JPY/);
  await actor.click(screen.getByRole("button", { name: "选择 车型1" }));
  const side = aside();
  assert.ok(within(side).getByText("含区域加价，已算在这个价格里"));
  const facts = [...side.querySelectorAll(".site-facts__item")].map((item) => [item.querySelector("dt")?.textContent, item.querySelector("dd")?.textContent]);
  assert.deepEqual(facts.slice(0, 3), [["用车类型", "包车 8 小时"], ["上车地点", "京王广场酒店"], ["下车地点", "成田国际机场"]]);
  const amounts = (document.body.textContent ?? "").replaceAll("车型1", " ").match(/[\d,]+ JPY/g) ?? [];
  assert.deepEqual([...new Set(amounts)], ["78,650 JPY"], "只有一个价格，没有单列的加价金额");

  await toReview(actor, null);
  assert.ok(within(screen.getByRole("region", { name: "核对订单" })).getByText("含区域加价，已算在这个价格里"));
  await actor.click(screen.getByRole("checkbox", { name: /同意保存这次付款用的银行卡/ }));
  await actor.click(screen.getByRole("button", { name: "去付款 →" }));
  await waitFor(() => assert.equal(posts(calls, "/site/v1/orders").length, 1));
  const order = posts(calls, "/site/v1/orders")[0]?.body as Record<string, unknown>;
  assert.deepEqual([order["pickup_address"], order["dropoff_address"], order["flight_no"]], ["京王广场酒店", "成田国际机场", null]);
});

// ---- M8-30b：计价方式的标注（ADR 0080 第三部分）----

for (const [basis, note] of [["one_price_outside_km", "含里程费"], ["distance_only", "按里程计价"]] as const) {
  test(`点对点 ${basis}：车型卡、右侧栏、核对页写「${note}」，只有一个总价，不写计程的单价和金额`, async () => {
    wideScreen();
    open({ at: "/book/new?from=35.6905,139.6948&to=35.6581,139.7017&date=2030-11-20&time=14:30", quote: () => json(200, byPoints({ trip_type: "point_to_point", airport: null, quotes: [{ ...quoteOf(1, { amount: 23400 }), pricing_basis: basis }] })) });
    const actor = user();
    const card = (await screen.findByRole("heading", { name: "车型1" }, SLOW)).closest("li") as HTMLElement;
    assert.ok(within(card).getByText(note));
    await actor.click(screen.getByRole("button", { name: "选择 车型1" }));
    assert.ok(within(aside()).getByText(note));
    const amounts = (document.body.textContent ?? "").replaceAll("车型1", " ").match(/[\d,]+ JPY/g) ?? [];
    assert.deepEqual([...new Set(amounts)], ["23,400 JPY"], "只有一个价格");
    assert.doesNotMatch(document.body.textContent ?? "", /每公里|起步价|加价/);
    await toReview(actor, null);
    assert.ok(within(screen.getByRole("region", { name: "核对订单" })).getByText(note));
  });
}

test("一口价（one_price）和旧接口没有 pricing_basis：不出任何计价标注", async () => {
  wideScreen();
  open({ at: "/book/new?from=35.772,140.3929&to=35.6905,139.6948&date=2030-11-20&time=14:30", quote: () => json(200, byPoints({ quotes: [{ ...quoteOf(1), pricing_basis: "one_price" }, quoteOf(2)] })) });
  await screen.findByRole("heading", { name: "车型1" }, SLOW);
  assertAbsent(screen.queryByText("含里程费"));
  assertAbsent(screen.queryByText("按里程计价"));
});

// ---- M8-40：按里程计价的「一口价包含」换说法（标题和第一条都不出现「一口价」）----

const ONE_PRICE_INCLUDES = ["一口价已含所有费用（高速费、停车费等），无需另付", "专车专用，不拼车"];
const DISTANCE_INCLUDES = ["车费已含高速费、停车费等，无需另付", "专车专用，不拼车"];

for (const [basis, title, items] of [
  ["one_price", "一口价包含", ONE_PRICE_INCLUDES],
  ["one_price_outside_km", "一口价包含", ONE_PRICE_INCLUDES],
  ["distance_only", "车费包含", DISTANCE_INCLUDES],
] as const) {
  test(`点对点 ${basis}：清单标题「${title}」，第一条「${items[0]}」`, async () => {
    wideScreen();
    open({ at: "/book/new?from=35.6905,139.6948&to=35.6581,139.7017&date=2030-11-20&time=14:30", quote: () => json(200, byPoints({ trip_type: "point_to_point", airport: null, quotes: [{ ...quoteOf(1), pricing_basis: basis }] })) });
    await screen.findByRole("heading", { name: "车型1" }, SLOW);
    const includes = screen.getByRole("region", { name: title });
    assert.deepEqual(within(includes).getAllByRole("listitem").map((item) => item.textContent).slice(0, 2), items);
    if (basis === "distance_only") assert.doesNotMatch(includes.textContent ?? "", /一口价/);
  });
}

test("列表里一口价和按里程计价都有：没选车时用按里程计价的说法；选了一口价的车换回「一口价包含」，选了按里程计价的又换回来；旧接口没有 pricing_basis 照旧；手机底部条「一口价」/「车费」跟着换", async () => {
  wideScreen();
  open({ at: "/book/new?from=35.6905,139.6948&to=35.6581,139.7017&date=2030-11-20&time=14:30", quote: () => json(200, byPoints({ trip_type: "point_to_point", airport: null, quotes: [quoteOf(1), { ...quoteOf(2), pricing_basis: "distance_only" }] })) });
  const actor = user();
  await screen.findByRole("heading", { name: "车型1" }, SLOW);
  const items = (title: string): string[] => within(screen.getByRole("region", { name: title })).getAllByRole("listitem").map((item) => item.textContent ?? "").slice(0, 2);
  assert.deepEqual(items("车费包含"), DISTANCE_INCLUDES);
  await actor.click(screen.getByRole("button", { name: "选择 车型1" }));
  assert.deepEqual(items("一口价包含"), ONE_PRICE_INCLUDES);
  await actor.click(screen.getByRole("button", { name: "选择 车型2" }));
  assert.deepEqual(items("车费包含"), DISTANCE_INCLUDES);

  // 手机第 2 步底部条：选了按里程计价的车写「车型 · 车费 价格」，选了一口价的写「车型 · 一口价 价格」
  resetBrowser();
  narrowScreen();
  open({ at: "/book/new?from=35.6905,139.6948&to=35.6581,139.7017&date=2030-11-20&time=14:30", quote: () => json(200, byPoints({ trip_type: "point_to_point", airport: null, quotes: [quoteOf(1), { ...quoteOf(2), pricing_basis: "distance_only" }] })) });
  await screen.findByRole("heading", { name: "车型1" }, SLOW);
  const bar = (): string => document.querySelector(".book-bar__text")?.textContent ?? "";
  await actor.click(screen.getByRole("button", { name: "选择 车型2" }));
  assert.match(bar(), /^车型2 · 车费 /);
  assert.doesNotMatch(bar(), /一口价/);
  await actor.click(screen.getByRole("button", { name: "选择 车型1" }));
  assert.match(bar(), /^车型1 · 一口价 /);
});

test("包车手机：没选下车地点点「下一步」时下车地点标红「请选择下车地点」、焦点移过去；摘要条「包车 8 小时 · 上车 → 下车」", async () => {
  narrowScreen();
  open({ at: CHARTER_LINK, charter: () => json(200, charterQuotes(false)) });
  const actor = user();
  const dropoff = await screen.findByRole("combobox", { name: "下车地点" });
  await waitFor(() => assert.equal((screen.getByRole("combobox", { name: "上车地点" }) as HTMLInputElement).value, "京王广场酒店"));
  await next(actor, NEXT_VEHICLES);
  assert.ok(screen.getByText("请选择下车地点"));
  assert.equal(dropoff.getAttribute("aria-invalid"), "true");
  await waitFor(() => assertFocused(screen.getByRole("combobox", { name: "下车地点" })));

  await pickPlace(actor, "下车地点", "成田", /成田国际机场/);
  await next(actor, NEXT_VEHICLES);
  await screen.findByRole("heading", { name: "车型1" }, SLOW);
  assert.match(document.querySelector(".book-summary-bar__text")?.textContent ?? "", /^包车 8 小时 · 京王广场酒店 → 成田国际机场/);
  // 手机上两端各占一行（M8-37b）：上车、下车各自一块，读屏名里两端都完整
  const ends = [...document.querySelectorAll(".book-summary-bar__text > .book-summary-bar__end")].map((end) => end.textContent);
  assert.deepEqual(ends, ["包车 8 小时 · 京王广场酒店", " → 成田国际机场"]);
  assert.match(screen.getByRole("button", { name: /^行程摘要/ }).textContent ?? "", /京王广场酒店 → 成田国际机场/);
});

test("旧包车链接只有上车地点：预填上车地点，下车地点空着，框下面信息提示「请选择下车地点，包车现在按上车和下车地点报价。」（不报错、不报价）；选了以后提示收起", async () => {
  wideScreen();
  const calls = open({ at: CHARTER_LINK, charter: () => json(200, charterQuotes(false)) });
  const actor = user();
  assert.ok(await screen.findByText("请选择下车地点，包车现在按上车和下车地点报价。", {}, SLOW));
  await waitFor(() => assert.equal((screen.getByRole("combobox", { name: "上车地点" }) as HTMLInputElement).value, "京王广场酒店"));
  assert.equal((screen.getByRole("combobox", { name: "下车地点" }) as HTMLInputElement).value, "");
  assertAbsent(screen.queryByText("有几项没有填好，请看标红的地方。"));
  assert.equal(posts(calls, "/site/v1/quotes").length, 0);
  await pickPlace(actor, "下车地点", "成田", /成田国际机场/);
  assertAbsent(screen.queryByText("请选择下车地点，包车现在按上车和下车地点报价。"));
  await next(actor, NEXT_VEHICLES);
  await screen.findByRole("heading", { name: "车型1" }, SLOW);
});

test("包车上车或下车地点不在任何区域（OUT_OF_SERVICE_AREA）：沿用「这个地址暂时没有在线报价，请联系客服」+ 客服电话，不显示内部代码", async () => {
  wideScreen();
  open({ at: `${CHARTER_LINK}&to=37.0,141.5`, charter: () => json(200, { currency: "JPY", quotes: [], unavailable: [{ vehicle_group_id: null, reasons: ["OUT_OF_SERVICE_AREA"] }] } satisfies SiteQuoteResult) });
  assert.ok(await screen.findByText("这个地址暂时没有在线报价，请联系客服", {}, SLOW));
  assert.ok(screen.getByRole("heading", { name: "没有可预订的车" }));
  assert.equal(screen.getByRole("link", { name: "+81 3-1234-5678" }).getAttribute("href"), "tel:+81312345678");
  assert.doesNotMatch(document.body.textContent ?? "", /OUT_OF_SERVICE_AREA|含区域加价/);
});

test("M9P-02：河口湖上车（离东京中心约 85 公里，不在任何城市范围里）也去按上下车点查套餐；匹配到东京就照常报价，询价不带城市", async () => {
  wideScreen();
  const calls = open({ at: "/book/new?mode=charter&from=35.5106,138.7637&from_name=%E6%B2%B3%E5%8F%A3%E6%B9%96&to=35.6905,139.6948&to_name=%E6%96%B0%E5%AE%BF&date=2030-11-20&time=09:00", packages: [10], charter: () => json(200, { city: quotedCity, ...charterQuotes(true) }) });
  await waitFor(() => assert.ok(calls.some((call) => call.path.startsWith("/site/v1/charter-packages?"))), SLOW);
  const asked = new URLSearchParams(calls.find((call) => call.path.startsWith("/site/v1/charter-packages?"))?.path.split("?")[1] ?? "");
  assert.deepEqual([asked.get("pickup"), asked.get("dropoff")], ["35.5106,138.7637", "35.6905,139.6948"]);
  assertAbsent(screen.queryByText("这个地址暂时没有在线报价，请联系客服"));
  // 只有一种时长时替客人选上；链接带齐了两端和时间，直接到第 2 步报价
  await screen.findByRole("heading", { name: "车型1" }, SLOW);
  const body = posts(calls, "/site/v1/quotes").at(-1)?.body as Record<string, unknown>;
  assert.deepEqual([body["category"], "city_id" in body, body["pickup"], body["package_hours"]], ["charter", false, { lat: 35.5106, lng: 138.7637 }, 10]);
});

test("M9P-02：上下车点不在任何包车商品的区域里（如甲府）：不询价，说「这个地址暂时没有在线报价，请联系客服」，给人工报价", async () => {
  wideScreen();
  const calls = open({ at: "/book/new?mode=charter&from=35.6622,138.5683&from_name=%E7%94%B2%E5%BA%9C&to=35.6905,139.6948&to_name=%E6%96%B0%E5%AE%BF&date=2030-11-20&time=09:00", charterPackages: () => json(200, { city: null, items: [] }) });
  assert.ok(await screen.findByText("这个地址暂时没有在线报价，请联系客服", {}, SLOW));
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal(posts(calls, "/site/v1/quotes").length, 0);
  assert.ok(screen.getByRole("heading", { name: "请客服人工报价" }));
});

// ---- M8-13：含公里数那一行（规范 site-booking-v2.md 10.3） ----

const KM_NOTE = "含 30 公里，本次路线约 63.5 公里，超出 34 公里 × 330 JPY（已含在一口价里）";
const withKm = (): Route => () =>
  json(200, byPoints({ trip_type: "point_to_point", airport: null, route: { minutes: 52, meters: 63_420, polyline: null }, quotes: [{ ...quoteOf(1, { amount: 30_000 }), distance: { included_km: 30, route_meters: 63_420, over_km: 34, over_km_per_km: { amount: "330", currency: "JPY" } } }, quoteOf(2)] }));

test("含公里数（M8-13）：车型卡车型标识下面「公里数」一句；选了以后右侧栏车费下面同一句；路线一行的公里数和这句的 D 一样（向上取整到 0.1 公里）；只有一个总价、不写成算式", async () => {
  const { actor } = await openSelected({ quote: withKm() });
  const card = screen.getByRole("heading", { name: "车型1" }).closest("li") as HTMLElement;
  const fact = [...card.querySelectorAll(".site-facts__item")].find((item) => item.querySelector("dt")?.textContent === "公里数");
  assert.equal(fact?.querySelector("dd")?.textContent, KM_NOTE);
  const other = screen.getByRole("heading", { name: "车型2" }).closest("li") as HTMLElement;
  assert.doesNotMatch(other.textContent ?? "", /公里数|含 \d+ 公里/, "没设含公里数的车型不写");
  const side = aside();
  assert.ok(within(side).getByText(KM_NOTE));
  assert.ok(within(side).getByText("约 52 分钟 · 63.5 公里"), "路线一行用同一个 D（63,420 米向上取整 63.5，不是四舍五入的 63.4）");
  assert.doesNotMatch(side.textContent ?? "", /[=＝]|基础价/);
  const amounts = new Set((side.textContent ?? "").replaceAll("车型1", " ").match(/[\d,]+ JPY/g) ?? []);
  assert.deepEqual([...amounts].sort(), ["30,000 JPY", "330 JPY"].sort(), "总价一个数，每公里单价只在说明里");
  await actor.click(screen.getByRole("button", { name: "选择 车型2" }));
  await waitFor(() => assertAbsent(within(side).queryByText(KM_NOTE)));
  assert.ok(within(side).getByText("约 52 分钟 · 63.4 公里"), "选了没设含公里数的车型：路线一行照旧");
});

test("含公里数（M8-13）：没超出写「在含的公里数以内」；超出单价是 0 写「超出的公里不另收」", async () => {
  const quoteWith = (distance: NonNullable<SiteQuote["distance"]>): Route => () => json(200, byPoints({ trip_type: "point_to_point", airport: null, quotes: [{ ...quoteOf(1), distance }] }));
  await openSelected({ quote: quoteWith({ included_km: 30, route_meters: 30_000, over_km: 0, over_km_per_km: { amount: "330", currency: "JPY" } }) });
  assert.ok(screen.getAllByText("含 30 公里，本次路线约 30 公里，在含的公里数以内").length >= 1);
  resetBrowser();
  await openSelected({ quote: quoteWith({ included_km: 30, route_meters: 34_200, over_km: 5, over_km_per_km: { amount: "0", currency: "JPY" } }) });
  assert.ok(screen.getAllByText("含 30 公里，本次路线约 34.2 公里，超出的公里不另收").length >= 1);
});

// ---- M8-27：四步、标签、右侧栏累积、网址和前进后退 ----

test("标签只有「区间 / 包车」（M8-33）：客人不选接送机还是点对点，两端是酒店、有一端是机场都不出提示和切换按钮；系统按报价认出的行程处理（有机场 → 航班落地时间）", async () => {
  wideScreen();
  let tripType: SiteByPointsResult["trip_type"] = "point_to_point";
  open({ quote: () => json(200, byPoints(tripType === "point_to_point" ? { trip_type: tripType, airport: null } : { trip_type: tripType })) });
  const actor = user();
  await screen.findByRole("heading", { name: "你的行程" });
  assert.deepEqual(screen.getAllByRole("radio").map((radio) => radio.closest("label")?.textContent), ["区间", "包车"]);
  assert.equal((screen.getByRole("radio", { name: "区间" }) as HTMLInputElement).checked, true);
  assertAbsent(screen.queryByRole("radio", { name: "接送机" }));
  assertAbsent(screen.queryByRole("radio", { name: "点对点" }));
  await pickPlace(actor, "出发地", "京王", /京王广场酒店/);
  await pickPlace(actor, "目的地", "京王", /京王广场酒店/);
  assertAbsent(screen.queryByText(/这是点对点行程/));
  assertAbsent(screen.queryByRole("button", { name: /改选/ }));
  tripType = "pickup";
  await pickPlace(actor, "出发地", "成田", /成田国际机场/);
  const date = screen.getByLabelText("日期（当地）") as HTMLInputElement;
  await actor.clear(date);
  await actor.type(date, "2030-11-20");
  await actor.type(screen.getByLabelText(/时间（当地）/), "14:30");
  assert.ok(await screen.findByLabelText("航班落地时间（当地）", {}, SLOW), "有机场：按接送机处理");
  assertAbsent(screen.queryByText(/这是接送机行程/));
  assertAbsent(screen.queryByRole("button", { name: /改选/ }));
});

test("旧链接 mode=airport / mode=p2p / mode=transfer 都落到「区间」；mode=charter 是包车（M8-33）", async () => {
  for (const [mode, checked] of [["airport", "区间"], ["p2p", "区间"], ["transfer", "区间"], ["charter", "包车"]] as const) {
    cleanup();
    resetBrowser();
    open({ at: `/book/new?mode=${mode}` });
    await screen.findByRole("heading", { name: "你的行程" });
    assert.equal((screen.getByRole("radio", { name: checked }) as HTMLInputElement).checked, true, `mode=${mode}`);
  }
});

test("接机还没有报价时，免费等待按机场默认：国际线 90 分钟、国内线 60 分钟；有报价按所选商品自己设的（M8-33）", async () => {
  for (const [scope, minutes] of [["international", 90], ["domestic", 60], [null, 60]] as const) {
    cleanup();
    resetBrowser();
    wideScreen();
    open({ quote: () => json(200, byPoints({ airport: { id: AIRPORT_ID, code: "NRT", name: { zh: "成田国际机场" }, matched_by: "kind", distance_meters: 0, flight_scope: scope }, quotes: [], unavailable: [{ vehicle_group_id: null, reasons: ["NO_PRODUCT"] }] })) });
    await fillTrip(user());
    assert.ok(await screen.findByText(`已识别为接机：司机按航班落地时间等候，落地后免费等待 ${minutes} 分钟`, {}, SLOW), `flight_scope=${scope}`);
  }
});

test("右侧栏四步一直在：第 1 步只有路线图和一句说明；之后逐步追加 行程 → 车型和一个价格 → 乘客信息；网址 ?step=N，浏览器后退前进换步，内容不丢；没走到的步骤从网址打开停在能到的那一步", async () => {
  wideScreen();
  open({ at: "/book/new?step=3", config: configOf({ map_tiles: ROUTE_TILES }), quote: withRoute() });
  const actor = user();
  await screen.findByRole("heading", { name: "你的行程" });
  assert.ok(within(aside()).getByText("每确认一步，这里会加上那一步的内容。"), "网址要第 3 步但行程还没填：停在第 1 步");
  await waitFor(() => assert.equal(search(), ""), SLOW);
  await fillTrip(actor);
  await waitFor(() => assert.ok(document.querySelector(".route-map__image")), SLOW);
  assertAbsent(within(aside()).queryByRole("heading", { name: "行程" }));
  await next(actor, NEXT_VEHICLES);
  await screen.findByRole("heading", { name: "车型1" }, SLOW);
  assert.ok(within(aside()).getByRole("heading", { name: "行程" }));
  assertAbsent(within(aside()).queryByRole("heading", { name: "车型和价格" }));
  await actor.click(screen.getByRole("button", { name: "选择 车型1" }));
  assert.ok(within(aside()).getByRole("heading", { name: "车型和价格" }));
  assert.ok(within(aside()).getByText("19,000"));
  await toReview(actor);
  assert.equal(new URLSearchParams(search()).get("step"), "4");
  assert.ok(within(aside()).getByRole("heading", { name: "乘客信息" }));
  assert.ok(document.querySelector(".book-new__aside .route-map"), "路线图一直在最上面");

  await actor.click(screen.getByRole("button", { name: "测试：后退" }));
  assert.ok(await screen.findByRole("heading", { name: "乘客信息", level: 2 }));
  assert.equal((screen.getByLabelText("乘车人姓名") as HTMLInputElement).value, "王小明");
  await actor.click(screen.getByRole("button", { name: "测试：后退" }));
  assert.ok(await screen.findByRole("button", { name: "已选择 车型1" }));
  await actor.click(screen.getByRole("button", { name: "测试：前进" }));
  await actor.click(screen.getByRole("button", { name: "测试：前进" }));
  assert.ok(await screen.findByRole("heading", { name: "核对订单" }));
});

test("接机改用点对点商品报的价（M8-33，fallback_category point_to_point）：页面照样要航班号、显示接机；下单按点对点——两端地址都提交，航班号写进备注最前面、不单独提交 flight_no", async () => {
  const { calls, actor } = await openSelected({
    quote: () => json(200, byPoints({ fallback_category: "point_to_point" })),
    order: () => json(201, { order: {}, timeline: [], names: {}, payment: null, link: { token: `nzo_${"d".repeat(43)}`, expires_at: "2030-12-01T00:00:00.000Z" } }),
  });
  await next(actor, NEXT_CONTACT);
  await actor.type(screen.getByLabelText("乘车人姓名"), "王小明");
  await actor.type(screen.getByLabelText("邮箱"), "guest@example.com");
  await actor.type(screen.getByLabelText("手机号（含国家区号）"), "+86 138 0000 0000");
  await next(actor, NEXT_REVIEW);
  assert.ok(screen.getByText("接机要填航班号，司机按航班落地时间等候"), "仍按接机要航班号");
  await actor.type(screen.getByLabelText("航班号"), "NH211");
  await next(actor, NEXT_REVIEW);
  await actor.click(screen.getByRole("checkbox", { name: /同意保存这次付款用的银行卡/ }));
  await actor.click(screen.getByRole("button", { name: "去付款 →" }));
  await waitFor(() => assert.equal(posts(calls, "/site/v1/orders").length, 1));
  const body = posts(calls, "/site/v1/orders")[0]?.body as { flight_no: unknown; pickup_address: unknown; dropoff_address: unknown; notes: string; sign_name: unknown };
  assert.deepEqual([body.flight_no, body.pickup_address, body.dropoff_address, body.sign_name], [null, "成田国际机场", "京王广场酒店", "王小明"]);
  assert.equal(body.notes, "航班号：NH211", "航班号写进备注；举牌姓名是正式字段（M8-32）");
});

test("页面宽度（M8-28）：/site/v1/config 的 page_width 写到官网外壳的 data-width 上；没有这一项时按标准", async () => {
  for (const [width, expected] of [["full", "full"], ["wide", "wide"], [undefined, "standard"]] as const) {
    wideScreen();
    open({ config: configOf(width === undefined ? {} : { page_width: width }) });
    await screen.findByRole("heading", { name: "你的行程" });
    await waitFor(() => assert.equal(document.querySelector(".site")?.getAttribute("data-width"), expected));
    resetBrowser();
  }
});

test("为他人预订：多出乘车人姓名和电话 / WhatsApp（必填），举牌姓名默认跟乘车人、可以改；核对和右侧栏有预订人、乘车人、举牌姓名；下单时联系人仍是预订人，三项作为正式字段提交（M8-32）", async () => {
  const { calls, actor } = await openSelected({ order: () => json(201, { order: {}, timeline: [], names: {}, payment: null, link: { token: `nzo_${"c".repeat(43)}`, expires_at: "2030-12-01T00:00:00.000Z" } }) });
  await next(actor, NEXT_CONTACT);
  assert.equal((screen.getByRole("radio", { name: "为自己预订" }) as HTMLInputElement).checked, true, "默认为自己");
  assertAbsent(screen.queryByLabelText("乘车人电话/WhatsApp"));
  await actor.click(screen.getByRole("radio", { name: "为他人预订" }));
  await actor.type(screen.getByLabelText("预订人姓名"), "王小明");
  await actor.type(screen.getByLabelText("邮箱"), "booker@example.com");
  await actor.type(screen.getByLabelText("手机号（含国家区号）"), "+86 138 0000 0000");
  await actor.type(screen.getByLabelText("航班号"), "NH211");
  await next(actor, NEXT_REVIEW);
  assert.ok(screen.getByText("请填写乘车人姓名"));
  assert.ok(screen.getByText(/请填写乘车人的电话或 WhatsApp 号码/));
  assertAbsent(screen.queryByRole("heading", { name: "核对订单" }));
  await actor.type(screen.getByLabelText("乘车人姓名"), "李华");
  // 本地号码（没有 + 和国家码）在这一步就拦下，和后端规则一致，不要到付款时才被退回
  await actor.type(screen.getByLabelText("乘车人电话/WhatsApp"), "090-5555-6666");
  await next(actor, NEXT_REVIEW);
  assert.ok(screen.getByText(/请填写乘车人的电话或 WhatsApp 号码，以 \+ 和国家码开头/));
  assertAbsent(screen.queryByRole("heading", { name: "核对订单" }));
  await actor.clear(screen.getByLabelText("乘车人电话/WhatsApp"));
  await actor.type(screen.getByLabelText("乘车人电话/WhatsApp"), "+81 90-5555-6666");
  assert.equal((screen.getByLabelText("举牌姓名（选填）") as HTMLInputElement).value, "李华", "举牌姓名默认跟乘车人");
  await next(actor, NEXT_REVIEW);
  const review = screen.getByRole("region", { name: "核对订单" });
  for (const text of ["王小明", "李华", "+81 90-5555-6666"]) assert.ok(within(review).getAllByText(text).length >= 1, text);
  assert.ok(within(aside()).getByText("+81 90-5555-6666"));
  assert.equal(within(aside()).getAllByText("李华").length, 2, "右侧栏的乘车人和举牌姓名");
  await actor.click(screen.getByRole("checkbox", { name: /同意保存这次付款用的银行卡/ }));
  await actor.click(screen.getByRole("button", { name: "去付款 →" }));
  await waitFor(() => assert.equal(posts(calls, "/site/v1/orders").length, 1));
  const body = posts(calls, "/site/v1/orders")[0]?.body as { passenger: unknown; notes: unknown; sign_name: unknown; passenger_name: unknown; passenger_phone: unknown };
  assert.deepEqual(body.passenger, { name: "王小明", phone: "+86 138 0000 0000", email: "booker@example.com" }, "确认邮件仍发给预订人");
  assert.deepEqual([body.sign_name, body.passenger_name, body.passenger_phone, body.notes], ["李华", "李华", "+81 90-5555-6666", null], "三项是正式字段，不再写进备注（M8-32）");
});
