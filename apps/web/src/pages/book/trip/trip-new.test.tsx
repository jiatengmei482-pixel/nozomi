/**
 * 多日行程报价页 `/book/trip`（M9T-09 第一部分，ADR 0101 第十三节）的组件测试：
 * 第 1 步按天填写（加一天 / 删一天、上限、这天不用车、加中间地点）、点「查看报价」前的检查（问题写在各自的字段下面，不发请求）、
 * 建行程单的请求体（标准行程单：机场开头 arrive_flight、只发坐标、过夜点、停留）→ 报价 → 网址 `?trip=…&step=2`、地名存进本标签页；
 * 第 2 步的结果骨架（方案名、推荐、合计、车型、报不出的原因、全部报不出转人工、过期重新报价）；刷新（网址带行程单）只读不报价，回到第 1 步时表单用读回来的行程单填上；
 * 太复杂（422）、太频繁（429）、过期（404）的说法；报价没拿到应答时先读行程单（已报过价就直接显示、不再报价）；重新报价失败后「上一步」仍能填回表单；
 * 第 2 步的变化由常驻播报区告诉读屏；报价中右侧栏画表单里每天的路线；手机底部按钮条。
 * M9T-10 下单出口：单段方案「预订这个方案」→ order-quote（带经停点地名）→ 带着报价进 /book/new 第 3 步（不再询价）；价格变了（409）写明并给「重新报价」；
 * 多段方案「提交预订，客服确认」= 带这个方案 plan_kind 的人工报价。
 * 接口用测试替身（浏览器只连 /site/v1）；真实后端由 e2e/site-trip-quote.spec.ts 覆盖。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { fireEvent, screen, waitFor, within, render } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { App } from "../../../App.tsx";
import type { SiteCity, SiteConfig, SiteQuote, SiteTrip, SiteTripItinerary, SiteTripOrderQuote, SiteTripPlan, SiteTripSegment } from "../../../api/site.ts";
import { type ApiCall, apiError, deferred, json, narrowScreen, resetBrowser, stubApiWith } from "../../../testing/harness.tsx";

const originalMatchMedia = window.matchMedia;
afterEach(() => {
  resetBrowser();
  window.matchMedia = originalMatchMedia;
});

/** 电脑宽度（≥ 1024px）：两栏、按钮在正文末尾 */
function wideScreen(): void {
  window.matchMedia = ((query: string) => ({ matches: query.includes("min-width: 1024px"), media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false })) as typeof window.matchMedia;
}

const SLOW = { timeout: 3000 };
const CITY_ID = "11111111-1111-4111-8111-111111111111";
const AIRPORT_ID = "22222222-2222-4222-8222-222222222222";
const TRIP_ID = "Trip_0123456789-abcdefghijklmnopqrstuvwxyzA";
const city: SiteCity = { id: CITY_ID, code: "CTY-JP-TYO", name: { zh: "东京" }, timezone: "Asia/Tokyo", country_code: "JP", center: { lat: 35.6895, lng: 139.6917 }, categories: ["airport_transfer", "point_to_point", "charter"] };
const config: SiteConfig = { open: true, currency: "JPY", payments: null, support_phone: null, support_whatsapp: null, address_search: true, page_width: "standard", map_tiles: null };
const airportSuggestion = { source: "platform", id: AIRPORT_ID, name: "成田国际机场", address: "", location: { lat: 35.772, lng: 140.3929 }, kind: "airport" } as const;
const hotelSuggestion = { source: "google", id: "ChIJkeio", name: "京王广场酒店", address: "东京都新宿区西新宿 2-2-1", location: null, kind: "other" } as const;
const templeSuggestion = { source: "google", id: "ChIJasakusa", name: "浅草寺", address: "东京都台东区浅草 2-3-1", location: null, kind: "other" } as const;
const HOTEL = { lat: 35.6905, lng: 139.6948 };
const TEMPLE = { lat: 35.7148, lng: 139.7967 };
const HOTEL_NAME = "京王广场酒店（东京都新宿区西新宿 2-2-1）";
const TEMPLE_NAME = "浅草寺（东京都台东区浅草 2-3-1）";

const ITINERARY: SiteTripItinerary = {
  schemaVersion: 1,
  party: { adults: 3, children: 0, luggage: 2 },
  preferences: { vehicleGroupIds: [], addons: [] },
  days: [
    { date: "2030-11-20", items: [{ kind: "arrive_flight", place: { lat: 35.772, lng: 140.3929 }, time: "14:30" }, { kind: "end", place: HOTEL }], nightAt: HOTEL },
    { date: "2030-11-21", items: [{ kind: "start", place: HOTEL, time: "09:00" }, { kind: "stop", place: TEMPLE, stayMinutes: 90 }, { kind: "end", place: HOTEL }] },
  ],
};

function planOf(kind: SiteTripPlan["kind"], amount: string, changes: Partial<SiteTripPlan> = {}): SiteTripPlan {
  return {
    plan_id: kind === "one_car" ? "44444444-4444-4444-8444-444444444441" : "44444444-4444-4444-8444-444444444442",
    kind,
    recommended: false,
    status: "quoted",
    expired: false,
    total: { amount, currency: "JPY" },
    vehicle_group: kind === "one_car" ? { id: "55555555-5555-4555-8555-555555555555", code: "VG-ALPHARD", name: { zh: "豪华七座" }, seats: 7 } : null,
    days: [],
    fees: [],
    warnings: [],
    ...changes,
  };
}

function tripOf(changes: Partial<SiteTrip> = {}): SiteTrip {
  return {
    trip_id: TRIP_ID,
    status: "quoted",
    currency: "JPY",
    readable_until: "2030-12-20T00:00:00.000Z",
    itinerary: ITINERARY,
    quoted_at: "2030-11-01T00:00:00.000Z",
    expires_at: "2030-11-01T00:30:00.000Z",
    plans: [planOf("one_car", "98000", { recommended: true }), planOf("daily_best", "91000")],
    unquoted: [],
    degraded: false,
    manual_quote_suggested: false,
    ...changes,
  };
}

type Route = (call: ApiCall & { url: URL }) => Response | Promise<Response> | null;

function open(options: { at?: string; create?: Route; quote?: Route; read?: Route; orderQuote?: Route; parseStatus?: Route; parse?: Route } = {}): ApiCall[] {
  const calls = stubApiWith((call) => {
    const path = call.url.pathname;
    if (path === "/site/v1/config") return json(200, config);
    if (path === "/site/v1/cities") return json(200, { items: [city] });
    if (path === "/site/v1/places/autocomplete") {
      const q = call.url.searchParams.get("q") ?? "";
      return json(200, { available: true, items: q.includes("成田") ? [airportSuggestion] : q.includes("浅草") ? [templeSuggestion] : [hotelSuggestion] });
    }
    if (path === "/site/v1/places/details") {
      const temple = call.url.searchParams.get("id") === templeSuggestion.id;
      return json(200, { available: true, place: temple ? { id: templeSuggestion.id, address: templeSuggestion.address, location: TEMPLE, kind: "other" } : { id: hotelSuggestion.id, address: hotelSuggestion.address, location: HOTEL, kind: "other" } });
    }
    // 路线图是 <img>；图出不来时页面再问一次原因
    if (path === "/site/v1/itinerary-map") return apiError(503, "ROUTE_MAP_UNAVAILABLE", "x", { reason: "UNAVAILABLE" });
    // AI 一句话（M9T-33）：默认不可用（输入框不显示）
    if (call.method === "GET" && path === "/site/v1/trips/parse-status") return options.parseStatus?.(call) ?? json(200, { available: false, max_chars: 500 });
    if (call.method === "POST" && path === "/site/v1/trips/parse") return options.parse?.(call) ?? null;
    if (call.method === "POST" && path === "/site/v1/trips") return options.create?.(call) ?? json(201, { trip_id: TRIP_ID, status: "draft", currency: "JPY", readable_until: "2030-12-20T00:00:00.000Z" });
    if (call.method === "POST" && path === `/site/v1/trips/${TRIP_ID}/quote`) return options.quote?.(call) ?? json(200, tripOf());
    if (call.method === "GET" && path === `/site/v1/trips/${TRIP_ID}`) return options.read?.(call) ?? json(200, tripOf());
    if (call.method === "POST" && path === "/site/v1/manual-quote-requests") return json(202, { status: "accepted" });
    // 下单出口（M9T-10）和跳进去以后的 /book/new
    if (call.method === "POST" && path.startsWith(`/site/v1/trips/${TRIP_ID}/plans/`) && path.endsWith("/order-quote")) return options.orderQuote?.(call) ?? null;
    if (path === "/site/v1/charter-packages") return json(200, { city: quotedCity, items: [{ hours: 4 }, { hours: 8 }] });
    if (path === "/site/v1/fx/reference") return json(200, { available: false, from: "JPY", to: call.url.searchParams.get("to"), rate: null, as_of: null, reason: "NO_RATE" });
    if (path === "/site/v1/route-map") return apiError(503, "ROUTE_MAP_UNAVAILABLE", "x", { reason: "UNAVAILABLE" });
    return null;
  });
  render(
    <MemoryRouter initialEntries={[options.at ?? "/book/trip"]}>
      <App />
      <Probe />
    </MemoryRouter>,
  );
  return calls;
}

/** 测试里的地址栏（MemoryRouter 没有地址栏） */
function Probe() {
  const location = useLocation();
  return <div data-testid="probe" data-search={location.search} data-pathname={location.pathname} />;
}

const search = (): string => screen.getByTestId("probe").getAttribute("data-search") ?? "";
const pathname = (): string => screen.getByTestId("probe").getAttribute("data-pathname") ?? "";
const user = () => userEvent.setup();
const posts = (calls: ApiCall[], path: string): ApiCall[] => calls.filter((call) => call.method === "POST" && call.path === path);
/** 第 2 步常驻的播报区 */
const announcer = (): HTMLElement => {
  const found = document.querySelector<HTMLElement>('.trip-new__result > p[role="status"][aria-live="polite"]');
  assert.ok(found, "第 2 步有常驻播报区");
  return found;
};
const daySection = (n: number): HTMLElement => screen.getByRole("region", { name: `第 ${n} 天` });

async function pickPlace(actor: ReturnType<typeof user>, label: string, query: string, option: RegExp): Promise<void> {
  const box = await screen.findByRole("combobox", { name: label });
  await actor.clear(box);
  await actor.type(box, query);
  await actor.click(await screen.findByRole("option", { name: option }, SLOW));
}

/** 第 1 天：2030-11-20 14:30 成田机场 → 京王广场酒店；乘客 3 人 */
/** 日期框出现后页面还会自动填上城市当地的明天：等填好再改，否则自动填的值会和打进去的字拼在一起 */
async function dateField(): Promise<HTMLInputElement> {
  const date = (await screen.findByLabelText("日期（当地）", {}, SLOW)) as HTMLInputElement;
  await waitFor(() => assert.match(date.value, /^\d{4}-\d{2}-\d{2}$/), SLOW);
  return date;
}

async function fillFirstDay(actor: ReturnType<typeof user>): Promise<void> {
  const date = await dateField();
  await actor.clear(date);
  await actor.type(date, "2030-11-20");
  await actor.type(screen.getByLabelText(/第 1 天 上车时间/), "14:30");
  await pickPlace(actor, "第 1 天 上车地点", "成田", /成田国际机场/);
  await pickPlace(actor, "第 1 天 最后下车地点", "京王", /京王广场酒店/);
  await actor.click(screen.getByRole("button", { name: /乘客 \/ 行李/ }));
  await actor.click(screen.getByRole("button", { name: "增加乘客" }));
}

test("第 1 步：标题、两步的步骤条、乘客 / 行李、第 1 天（日期默认明天、时间、上车 / 最后下车地点）、右侧栏路线图的空状态；没有入口链接也能直接打开", async () => {
  wideScreen();
  open();
  assert.ok(await screen.findByRole("heading", { name: "多日行程报价", level: 1 }, SLOW));
  assert.ok(await screen.findByRole("heading", { name: "你的行程", level: 2 }, SLOW));
  const steps = screen.getByRole("list", { name: "行程报价步骤" });
  assert.deepEqual(within(steps).getAllByRole("listitem").map((item) => item.textContent), ["1填写行程", "2报价结果"]);
  assert.ok(within(daySection(1)).getByRole("combobox", { name: "第 1 天 上车地点" }));
  assert.ok(within(daySection(1)).getByRole("combobox", { name: "第 1 天 最后下车地点" }));
  assert.match((await dateField()).value, /^\d{4}-\d{2}-\d{2}$/, "默认填了城市当地的明天");
  assert.equal(within(daySection(1)).queryByRole("checkbox", { name: "这天不用车" }), null, "第一天要用车，不给勾");
  assert.equal(within(daySection(1)).queryByRole("checkbox", { name: "当晚为司机安排住宿" }), null, "只有一天时没有「当晚」");
  const aside = screen.getByRole("complementary", { name: "每天的路线" });
  assert.ok(within(aside).getByText("选好地点后在这里显示每天的路线"));
  assert.ok(screen.getByRole("button", { name: "查看报价" }));
  assert.equal(document.title, "多日行程报价 · NOZOMI 用车");
});

test("加一天 / 删一天：新的一天接着前一天的日期、上车地点接着前一天最后下车的地方；中间的日子可以勾「这天不用车」；最多 14 天", async () => {
  wideScreen();
  open();
  const actor = user();
  const date = await dateField();
  await actor.clear(date);
  await actor.type(date, "2030-11-20");
  await pickPlace(actor, "第 1 天 最后下车地点", "京王", /京王广场酒店/);
  await actor.click(screen.getByRole("button", { name: "加一天" }));
  assert.ok(within(daySection(2)).getByText("日期：2030-11-21（接着前一天）"));
  assert.equal((within(daySection(2)).getByRole("combobox", { name: "第 2 天 上车地点" }) as HTMLInputElement).value, HOTEL_NAME);
  assert.ok(within(daySection(1)).getByRole("checkbox", { name: "当晚为司机安排住宿" }), "不是最后一天：有「当晚」");
  await actor.click(screen.getByRole("button", { name: "加一天" }));
  // 第 2 天在中间：可以不用车，勾了以后地点、时间收起
  const idle = within(daySection(2)).getByRole("checkbox", { name: "这天不用车" });
  await actor.click(idle);
  assert.equal(within(daySection(2)).queryByRole("combobox"), null);
  assert.equal(within(daySection(2)).queryByLabelText(/上车时间/), null);
  assert.equal(within(daySection(3)).queryByRole("checkbox", { name: "这天不用车" }), null, "最后一天要用车");
  // 删掉第 3 天：第 2 天成了最后一天，勾着的「这天不用车」还在，提示要改
  await actor.click(within(daySection(3)).getByRole("button", { name: "删除第 3 天" }));
  assert.equal(screen.queryByRole("region", { name: "第 3 天" }), null);
  assert.ok(await screen.findByText("已删除第 3 天"));
  await actor.click(screen.getByRole("button", { name: "查看报价" }));
  assert.ok(await within(daySection(2)).findByText("最后一天要用车"));
  // 加到 14 天封顶
  for (let index = 0; index < 14; index += 1) {
    const add = screen.getByRole("button", { name: "加一天" }) as HTMLButtonElement;
    if (add.disabled) break;
    await actor.click(add);
  }
  assert.equal(screen.getAllByRole("region", { name: /^第 \d+ 天$/ }).length, 14);
  assert.equal((screen.getByRole("button", { name: "加一天" }) as HTMLButtonElement).disabled, true);
  assert.ok(screen.getByText("最多 14 天，更长的行程请联系客服"));
});

test("点「查看报价」前检查：时间、上车地点、最后下车地点、中间地点和停留时长没填的写在各自下面，焦点到第一个问题，不发请求；改好后问题随改随消失", async () => {
  wideScreen();
  const calls = open();
  const actor = user();
  await screen.findByRole("combobox", { name: "第 1 天 上车地点" }, SLOW);
  await actor.click(within(daySection(1)).getByRole("button", { name: "加一个地点" }));
  assert.ok(within(daySection(1)).getByRole("combobox", { name: "第 1 天 第 2 个地点" }));
  await actor.click(screen.getByRole("button", { name: "查看报价" }));
  assert.ok(await screen.findByText("行程还有没填好的地方，请按提示修改"));
  const day = daySection(1);
  for (const text of ["请填写上车时间", "请选择上车地点", "请选择最后下车地点", "请选择这个地点"]) assert.ok(within(day).getByText(text), text);
  // 停留时长的占位选项也叫「请选择停留时长」：只认字段下面的那条问题
  assert.ok(within(day).getAllByText("请选择停留时长").some((node) => node.closest(".field__errors") !== null), "请选择停留时长");
  await waitFor(() => assert.equal(document.activeElement?.getAttribute("aria-invalid"), "true"));
  assert.equal(posts(calls, "/site/v1/trips").length, 0);
  await actor.click(within(day).getByRole("button", { name: "删除第 1 天 第 2 个地点" }));
  await actor.type(screen.getByLabelText(/第 1 天 上车时间/), "09:00");
  assert.equal(within(day).queryByText("请填写上车时间"), null);
  assert.equal(within(day).queryByText("请选择停留时长"), null);
});

test("建行程单 → 报价：请求体是标准行程单（机场开头 arrive_flight、只发坐标、过夜点、停留分钟），网址带上行程单编号到第 2 步，地名存在本标签页，结果显示两个方案", async () => {
  wideScreen();
  const calls = open();
  const actor = user();
  await fillFirstDay(actor);
  await actor.click(screen.getByRole("button", { name: "加一天" }));
  await actor.type(screen.getByLabelText(/第 2 天 上车时间/), "09:00");
  await actor.click(within(daySection(2)).getByRole("button", { name: "加一个地点" }));
  await pickPlace(actor, "第 2 天 第 2 个地点", "浅草", /浅草寺/);
  await actor.selectOptions(screen.getByLabelText(/第 2 天 第 2 个地点 停留时长/), "90");
  await pickPlace(actor, "第 2 天 最后下车地点", "京王", /京王广场酒店/);
  await actor.click(screen.getByRole("button", { name: "查看报价" }));

  assert.ok(await screen.findByRole("heading", { name: "报价结果", level: 2 }, SLOW));
  assert.equal(search(), `?trip=${TRIP_ID}&step=2`);
  const created = posts(calls, "/site/v1/trips");
  assert.equal(created.length, 1);
  assert.deepEqual(created[0]?.body, {
    schemaVersion: 1,
    party: { adults: 3, children: 0, luggage: 2 },
    days: [
      { date: "2030-11-20", items: [{ kind: "arrive_flight", place: { lat: 35.772, lng: 140.3929 }, time: "14:30" }, { kind: "end", place: HOTEL }], nightAt: HOTEL },
      { date: "2030-11-21", items: [{ kind: "start", place: HOTEL, time: "09:00" }, { kind: "stop", place: TEMPLE, stayMinutes: 90 }, { kind: "end", place: HOTEL }] },
    ],
  });
  assert.doesNotMatch(JSON.stringify(created[0]?.body), /京王|浅草|成田/, "行程单里不发地名");
  await waitFor(() => assert.equal(posts(calls, `/site/v1/trips/${TRIP_ID}/quote`).length, 1));
  assert.ok(calls.findIndex((call) => call.path === "/site/v1/trips") < calls.findIndex((call) => call.path.endsWith("/quote")), "先建行程单再报价");
  assert.equal(calls.filter((call) => call.method === "GET" && call.path === `/site/v1/trips/${TRIP_ID}`).length, 0, "刚建好的不再读一次");
  assert.deepEqual(JSON.parse(sessionStorage.getItem(`nozomi.trip-labels.${TRIP_ID}`) ?? "null"), { v: 1, days: [["成田国际机场", HOTEL_NAME], [HOTEL_NAME, TEMPLE_NAME, HOTEL_NAME]] });

  const oneCar = await screen.findByRole("listitem", { name: "同一辆车跑完全程" }, SLOW);
  assert.ok(within(oneCar).getByText("推荐"));
  assert.ok(within(oneCar).getByText("98,000 JPY"));
  assert.ok(within(oneCar).getByText("车型：豪华七座"));
  const dailyBest = screen.getByRole("listitem", { name: "每天选最划算的车" });
  assert.ok(within(dailyBest).getByText("91,000 JPY"));
  assert.equal(within(dailyBest).queryByText("推荐"), null);
  // 右侧栏：每天一张路线图，下面按编号列地名（地名取存的）
  const aside = screen.getByRole("complementary", { name: "每天的路线" });
  const day2 = within(aside).getByRole("figure", { name: "第 2 天路线图" });
  assert.deepEqual(within(day2).getAllByRole("listitem").map((item) => item.textContent), [`1${HOTEL_NAME}`, `2${TEMPLE_NAME}`, `3${HOTEL_NAME}`]);
});

test("刷新第 2 步（网址带行程单编号）：只读行程单、不重新报价；报不出的原因逐条写；回到第 1 步时表单用读回来的行程单和存的地名填上", async () => {
  wideScreen();
  sessionStorage.setItem(`nozomi.trip-labels.${TRIP_ID}`, JSON.stringify({ v: 1, days: [["成田国际机场", "酒店"], ["酒店", "浅草寺", "酒店"]] }));
  const calls = open({ at: `/book/trip?trip=${TRIP_ID}&step=2`, read: () => json(200, tripOf({ plans: [planOf("daily_best", "91000", { recommended: true })], unquoted: [{ plan_kind: "one_car", day_index: 1, reason: "WORK_HOURS_HARD_LIMIT" }, { plan_kind: "one_car", day_index: null, reason: "SOMETHING_NEW" }] })) });
  const dailyBest = await screen.findByRole("listitem", { name: "每天选最划算的车" }, SLOW);
  assert.ok(within(dailyBest).getByText("91,000 JPY"));
  assert.equal(screen.queryByRole("listitem", { name: "同一辆车跑完全程" }), null);
  const unquoted = screen.getByRole("region", { name: "报不出的方案" });
  assert.deepEqual(within(unquoted).getAllByRole("listitem").map((item) => item.textContent), [
    "同一辆车跑完全程（第 2 天）：这个方案暂时报不出：用车时间太长，请拆成两天或减少地点",
    "同一辆车跑完全程：这个方案暂时报不出：暂时没有合适的车",
  ]);
  assert.equal(calls.filter((call) => call.method === "GET" && call.path === `/site/v1/trips/${TRIP_ID}`).length, 1);
  assert.equal(calls.filter((call) => call.method === "POST").length, 0, "刷新不重新报价");

  await user().click(screen.getByRole("button", { name: "上一步" }));
  assert.ok(await screen.findByRole("heading", { name: "你的行程", level: 2 }));
  assert.equal(search(), "");
  assert.equal((screen.getByLabelText("日期（当地）") as HTMLInputElement).value, "2030-11-20");
  assert.equal((within(daySection(1)).getByRole("combobox", { name: "第 1 天 上车地点" }) as HTMLInputElement).value, "成田国际机场");
  assert.equal((within(daySection(2)).getByRole("combobox", { name: "第 2 天 第 2 个地点" }) as HTMLInputElement).value, "浅草寺");
  assert.equal((screen.getByLabelText(/第 2 天 第 2 个地点 停留时长/) as HTMLSelectElement).value, "90");
  assert.ok(screen.getByRole("button", { name: /3 人 · 2 件/ }));
});

test("全部方案报不出（manual_quote_suggested）：不显示方案，点「转人工报价」留邮箱提交，带上行程单编号、第一天行程和每天的地名", async () => {
  wideScreen();
  sessionStorage.setItem(`nozomi.trip-labels.${TRIP_ID}`, JSON.stringify({ v: 1, days: [["成田国际机场", HOTEL_NAME], [HOTEL_NAME, TEMPLE_NAME, HOTEL_NAME]] }));
  const calls = open({ at: `/book/trip?trip=${TRIP_ID}&step=2`, read: () => json(200, tripOf({ plans: [], unquoted: [{ plan_kind: "one_car", day_index: 0, reason: "NO_OFFER" }], manual_quote_suggested: true })) });
  assert.ok(await screen.findByRole("heading", { name: "这个行程需要客服人工报价" }, SLOW));
  assert.ok(screen.getByText("留下邮箱或 WhatsApp，客服按整张行程单报价，不用再填行程"));
  assert.equal(screen.queryByRole("list", { name: "报价结果" }), null);
  assert.equal(screen.queryByRole("list", { name: "两个方案对比" }), null);
  assert.ok(within(screen.getByRole("region", { name: "报不出的方案" })).getByText("这个方案暂时报不出：没有可用的车"));

  const actor = user();
  await actor.click(screen.getByRole("button", { name: "转人工报价" }));
  assert.equal(document.activeElement, screen.getByRole("heading", { name: "这个行程需要客服人工报价" }), "表单出来后焦点在这块的标题");
  await actor.type(screen.getByLabelText("邮箱"), "guest@example.com");
  await actor.click(screen.getByRole("button", { name: "提交" }));
  assert.ok(await screen.findByText(/已收到/, {}, SLOW));
  const sent = posts(calls, "/site/v1/manual-quote-requests");
  assert.equal(sent.length, 1);
  const body = sent[0]?.body as Record<string, unknown>;
  assert.equal(body["trip_id"], TRIP_ID);
  assert.equal(body["plan_kind"], null);
  assert.deepEqual(body["trip_labels"], [["成田国际机场", HOTEL_NAME], [HOTEL_NAME, TEMPLE_NAME, HOTEL_NAME]]);
  assert.deepEqual(body["trip"], {
    category: "airport_transfer",
    city_id: null,
    pickup: { name: "成田国际机场", lat: 35.772, lng: 140.3929 },
    dropoff: { name: HOTEL_NAME, lat: HOTEL.lat, lng: HOTEL.lng },
    service_local: "2030-11-20T14:30",
    passengers: 3,
    luggage: 2,
    package_hours: null,
  });
  assert.equal(body["email"], "guest@example.com");
});

test("没存地名时转人工也能提交：地名写坐标，天数、每天点数和行程单一致", async () => {
  wideScreen();
  const calls = open({ at: `/book/trip?trip=${TRIP_ID}&step=2`, read: () => json(200, tripOf({ plans: [], unquoted: [{ plan_kind: "daily_best", day_index: null, reason: "NO_PRODUCT" }], manual_quote_suggested: true })) });
  const actor = user();
  await actor.click(await screen.findByRole("button", { name: "转人工报价" }, SLOW));
  await actor.type(screen.getByLabelText("WhatsApp"), "+81 90 1234 5678");
  await actor.click(screen.getByRole("button", { name: "提交" }));
  assert.ok(await screen.findByText(/已收到/, {}, SLOW));
  const labels = (posts(calls, "/site/v1/manual-quote-requests")[0]?.body as { trip_labels: string[][] }).trip_labels;
  assert.deepEqual(labels.map((day) => day.length), [2, 3]);
  assert.ok(labels.flat().every((name) => name.trim() !== ""));
});

test("两个方案对比卡片：逐天列出每一段的类型、时间、金额，挂在当天和按晚的费用，以及提示", async () => {
  wideScreen();
  const segment = (id: string, type: "airport_pickup" | "charter", start: string, end: string, amount: string, extra: { package_hours?: number; other_vehicle?: boolean } = {}) => ({
    segment_id: id,
    type,
    start_local: start,
    end_local: end,
    amount: { amount, currency: "JPY" },
    package_hours: extra.package_hours ?? null,
    other_vehicle: extra.other_vehicle ?? false,
    vehicle_group: null,
    price_breakdown: [],
    route: null,
  });
  const days = (otherVehicle: boolean) => [
    { day_index: 0, date: "2030-11-20", segments: [segment("s1", "airport_pickup", "2030-11-20T14:30", "2030-11-20T16:00", "30000")], fees: [] },
    { day_index: 1, date: "2030-11-21", segments: [segment("s2", "charter", "2030-11-21T09:00", "2030-11-21T17:00", "60000", { package_hours: 8, other_vehicle: otherVehicle })], fees: [{ type: "second_driver" as const, label: { zh: "第二司机" }, amount: { amount: "8000", currency: "JPY" } }] },
  ];
  open({
    at: `/book/trip?trip=${TRIP_ID}&step=2`,
    read: () =>
      json(200, tripOf({
        plans: [
          planOf("one_car", "98000", { recommended: true, days: days(false), fees: [{ type: "lodging", label: { zh: "司机住宿（第 1 晚）" }, amount: { amount: "12000", currency: "JPY" }, night_index: 0 }], warnings: [{ code: "SECOND_DRIVER", day_index: 1 }] }),
          planOf("daily_best", "91000", { days: days(true), warnings: [{ code: "SEGMENT_OTHER_VEHICLE", day_index: 1 }] }),
        ],
      })),
  });
  const compare = await screen.findByRole("list", { name: "两个方案对比" }, SLOW);
  const oneCar = within(compare).getByRole("listitem", { name: "同一辆车跑完全程" });
  assert.ok(within(oneCar).getByText("推荐"));
  assert.ok(within(oneCar).getByRole("heading", { name: "第 1 天 · 11月20日" }));
  assert.ok(within(oneCar).getByText("接机"));
  assert.ok(within(oneCar).getByText("14:30–16:00"));
  assert.ok(within(oneCar).getByText("30,000 JPY"));
  assert.ok(within(oneCar).getByText("包车 8 小时"));
  assert.ok(within(oneCar).getByText("第二司机"));
  assert.ok(within(oneCar).getByText("司机住宿（第 1 晚）"));
  assert.ok(within(oneCar).getByText("12,000 JPY"));
  assert.ok(within(oneCar).getByText("第 2 天用车时间较长，已加第二位司机"));
  assert.equal(within(oneCar).queryByText("这一天换了别的车"), null);
  const daily = within(compare).getByRole("listitem", { name: "每天选最划算的车" });
  assert.ok(within(daily).getByText("这一天换了别的车"));
  assert.ok(within(daily).getByText("第 2 天换了别的车"));
  assert.equal(within(daily).queryByText("推荐"), null);
  assert.equal(screen.queryByRole("button", { name: "转人工报价" }), null, "报得出时不给转人工");
});

test("网址里的行程单编号格式不对：回到第 1 步，顶部说「这个行程已过期或不存在」，不发任何行程请求", async () => {
  wideScreen();
  const calls = open({ at: "/book/trip?trip=not-a-trip&step=2" });
  assert.ok(await screen.findByText("这个行程已过期或不存在，请重新填写。", {}, SLOW));
  assert.ok(screen.getByRole("heading", { name: "你的行程", level: 2 }));
  assert.equal(calls.filter((call) => call.path.startsWith("/site/v1/trips") && call.path !== "/site/v1/trips/parse-status").length, 0);
});

test("报出的方案过期了：写「请重新报价」，点「重新报价」再报一次、换成新结果", async () => {
  wideScreen();
  const calls = open({ at: `/book/trip?trip=${TRIP_ID}&step=2`, read: () => json(200, tripOf({ plans: [planOf("one_car", "98000", { recommended: true, expired: true })] })), quote: () => json(200, tripOf({ plans: [planOf("one_car", "99000", { recommended: true })] })) });
  assert.ok(await screen.findByText("报价已过有效期，请重新报价", {}, SLOW));
  await user().click(screen.getByRole("button", { name: "重新报价" }));
  assert.ok(await screen.findByText("99,000 JPY", {}, SLOW));
  assert.equal(screen.queryByText("报价已过有效期，请重新报价"), null);
  assert.equal(posts(calls, `/site/v1/trips/${TRIP_ID}/quote`).length, 1);
});

test("报价出错：太复杂（422）写需要人工报价；太频繁（429）写等几秒并可重试；行程单过期（404）只能回去重新填", async () => {
  wideScreen();
  open({ quote: () => apiError(422, "TRIP_TOO_COMPLEX", "行程太复杂") });
  const actor = user();
  await fillFirstDay(actor);
  await actor.click(screen.getByRole("button", { name: "查看报价" }));
  assert.ok(await screen.findByRole("heading", { name: "这个行程需要客服人工报价" }, SLOW));
  assert.ok(screen.getByText(/这个行程太复杂，暂时没法在线报价。客服会按您填的行程人工报价/));

  resetBrowser();
  wideScreen();
  let attempts = 0;
  open({
    at: `/book/trip?trip=${TRIP_ID}&step=2`,
    read: () => json(200, tripOf({ status: "draft", quoted_at: null, expires_at: null, plans: [], unquoted: [] })),
    quote: () => {
      attempts += 1;
      return attempts === 1 ? apiError(429, "RATE_LIMITED", "x", {}, { "retry-after": "30" }) : json(200, tripOf());
    },
  });
  // 上次没报成（只建了行程单）：给「查看报价」
  assert.ok(await screen.findByText("这个行程还没有报价", {}, SLOW));
  await user().click(screen.getByRole("button", { name: "查看报价" }));
  assert.ok(await screen.findByText("操作太频繁了，请 30 秒后再试。", {}, SLOW));
  await user().click(screen.getByRole("button", { name: "重试" }));
  assert.ok(await screen.findByRole("listitem", { name: "同一辆车跑完全程" }, SLOW));

  resetBrowser();
  wideScreen();
  open({ at: `/book/trip?trip=${TRIP_ID}&step=2`, read: () => apiError(404, "TRIP_NOT_FOUND", "x") });
  assert.ok(await screen.findByText("这个行程已过期或不存在，请重新填写。", {}, SLOW));
  await user().click(screen.getByRole("button", { name: "修改行程" }));
  assert.ok(await screen.findByRole("heading", { name: "你的行程", level: 2 }));
});

test("建行程单出错（太频繁）：留在第 1 步，说明写在表单上方，不报价", async () => {
  wideScreen();
  const calls = open({ create: () => apiError(429, "RATE_LIMITED", "x", {}, { "retry-after": "120" }) });
  const actor = user();
  await fillFirstDay(actor);
  await actor.click(screen.getByRole("button", { name: "查看报价" }));
  assert.ok(await screen.findByText("操作太频繁了，请 2 分钟后再试。", {}, SLOW));
  assert.equal(search(), "");
  assert.equal(calls.filter((call) => call.path.endsWith("/quote")).length, 0);
});

test("手机、平板（≤ 1023px）：没有右侧栏，路线图在每天的块里；「查看报价」「上一步」在底部按钮条", async () => {
  narrowScreen();
  open();
  const actor = user();
  await fillFirstDay(actor);
  assert.equal(screen.queryByRole("complementary", { name: "每天的路线" }), null);
  assert.ok(within(daySection(1)).getByRole("figure", { name: "第 1 天路线图" }), "路线图就在这一天的块里");
  const bar = screen.getByRole("group", { name: "本步操作" });
  await actor.click(within(bar).getByRole("button", { name: "查看报价" }));
  assert.ok(await screen.findByRole("listitem", { name: "同一辆车跑完全程" }, SLOW));
  assert.ok(within(screen.getByRole("group", { name: "本步操作" })).getByRole("button", { name: "上一步" }));
  assert.ok(screen.getByRole("region", { name: "每天的行程" }), "第 2 步每天的路线在结果下面");
});

test("报价没拿到应答（断网 / 超时）：先读一次行程单，服务端已报过价就直接显示结果、不再报价，也不给「重试」", async () => {
  wideScreen();
  const calls = open({ quote: () => Promise.reject(new TypeError("Failed to fetch")) });
  const actor = user();
  await fillFirstDay(actor);
  await actor.click(screen.getByRole("button", { name: "查看报价" }));
  assert.ok(await screen.findByRole("listitem", { name: "同一辆车跑完全程" }, SLOW));
  assert.equal(screen.queryByRole("button", { name: "重试" }), null);
  assert.equal(posts(calls, `/site/v1/trips/${TRIP_ID}/quote`).length, 1, "只报了一次");
  assert.equal(calls.filter((call) => call.method === "GET" && call.path === `/site/v1/trips/${TRIP_ID}`).length, 1, "失败后读了一次行程单");
  await waitFor(() => assert.equal(announcer().textContent, "报价已出来，共 2 个方案"), SLOW);
});

test("报价没拿到应答、读回来还没报过价：给「重试」；读屏听到出错；重试成功后显示结果", async () => {
  wideScreen();
  let attempts = 0;
  const calls = open({
    quote: () => {
      attempts += 1;
      return attempts === 1 ? Promise.reject(new TypeError("Failed to fetch")) : json(200, tripOf());
    },
    read: () => json(200, tripOf({ status: "draft", quoted_at: null, expires_at: null, plans: [], unquoted: [] })),
  });
  const actor = user();
  await fillFirstDay(actor);
  await actor.click(screen.getByRole("button", { name: "查看报价" }));
  assert.ok(await screen.findByRole("heading", { name: "报价没有查出来" }, SLOW));
  assert.match(announcer().textContent ?? "", /^报价没有查出来：/);
  await actor.click(screen.getByRole("button", { name: "重试" }));
  assert.ok(await screen.findByRole("listitem", { name: "同一辆车跑完全程" }, SLOW));
  assert.equal(posts(calls, `/site/v1/trips/${TRIP_ID}/quote`).length, 2);
});

test("刷新到第 2 步后重新报价失败：「上一步」仍用失败前读到的行程单填回表单", async () => {
  wideScreen();
  sessionStorage.setItem(`nozomi.trip-labels.${TRIP_ID}`, JSON.stringify({ v: 1, days: [["成田国际机场", "酒店"], ["酒店", "浅草寺", "酒店"]] }));
  open({
    at: `/book/trip?trip=${TRIP_ID}&step=2`,
    read: () => json(200, tripOf({ status: "draft", quoted_at: null, expires_at: null, plans: [], unquoted: [] })),
    quote: () => apiError(429, "RATE_LIMITED", "x", {}, { "retry-after": "30" }),
  });
  assert.ok(await screen.findByText("这个行程还没有报价", {}, SLOW));
  await user().click(screen.getByRole("button", { name: "查看报价" }));
  assert.ok(await screen.findByText("操作太频繁了，请 30 秒后再试。", {}, SLOW));
  await user().click(screen.getByRole("button", { name: "上一步" }));
  assert.ok(await screen.findByRole("heading", { name: "你的行程", level: 2 }));
  assert.equal((screen.getByLabelText("日期（当地）") as HTMLInputElement).value, "2030-11-20");
  assert.equal((within(daySection(2)).getByRole("combobox", { name: "第 2 天 第 2 个地点" }) as HTMLInputElement).value, "浅草寺");
});

test("刚建好的行程单正在报价：右侧栏画表单里每天的路线，不显示空状态", async () => {
  wideScreen();
  const pending = deferred();
  open({ quote: () => pending.promise });
  const actor = user();
  await fillFirstDay(actor);
  await actor.click(screen.getByRole("button", { name: "查看报价" }));
  assert.ok(await screen.findByRole("heading", { name: "报价结果", level: 2 }, SLOW));
  const aside = screen.getByRole("complementary", { name: "每天的路线" });
  assert.ok(within(aside).getByRole("figure", { name: "第 1 天路线图" }));
  assert.equal(within(aside).queryByText("选好地点后在这里显示每天的路线"), null);
  pending.resolve(json(200, tripOf()));
  assert.ok(await screen.findByRole("listitem", { name: "同一辆车跑完全程" }, SLOW));
});

// ---------- 下单出口（M9T-10） ----------

const quotedCity = { id: CITY_ID, code: city.code, name: city.name, timezone: city.timezone };
const ONE_CAR_GROUP = { id: "55555555-5555-4555-8555-555555555555", code: "VG-ALPHARD", name: { zh: "豪华七座" }, grade: "luxury", seats: 7, sample_models: ["Toyota Alphard"], combos: [{ passengers: 6, luggage: 4 }] };
/** 单日包车：酒店 9:00 出发 → 浅草寺停留 90 分钟 → 回酒店 */
const ONE_DAY: SiteTripItinerary = {
  schemaVersion: 1,
  party: { adults: 3, children: 0, luggage: 2 },
  preferences: { vehicleGroupIds: [], addons: [] },
  days: [{ date: "2030-11-20", items: [{ kind: "start", place: HOTEL, time: "09:00" }, { kind: "stop", place: TEMPLE, stayMinutes: 90 }, { kind: "end", place: HOTEL }] }],
};

function segmentOf(id: string, type: SiteTripSegment["type"], amount: string, start = "2030-11-20T09:00", end = "2030-11-20T13:00"): SiteTripSegment {
  return { segment_id: id, type, start_local: start, end_local: end, amount: { amount, currency: "JPY" }, package_hours: type === "charter" ? 4 : null, other_vehicle: false, vehicle_group: null, price_breakdown: [], route: null };
}

const singlePlan = (): SiteTripPlan => planOf("one_car", "52000", { recommended: true, days: [{ day_index: 0, date: "2030-11-20", segments: [segmentOf("s1", "charter", "52000")], fees: [] }] });
const singleTrip = (): SiteTrip => tripOf({ itinerary: ONE_DAY, plans: [singlePlan()] });

function charterQuote(): SiteQuote {
  return {
    quote_id: "QT203011200000000099",
    expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    service_date: "2030-11-20",
    urgent: false,
    vehicle_group: ONE_CAR_GROUP,
    package: { hours: 4, km: null },
    price: { total: { amount: "52000", currency: "JPY" }, fx: null },
    free_wait_minutes: 0,
    cancel_policy: { category: "charter", level: "luxury", tiers: [{ min_hours_before: 24, fee_bp: 0 }, { min_hours_before: 0, fee_bp: 10000 }] },
    available_addons: [],
    estimated_minutes: 150,
    includes_buffer: false,
    auto_package_hours: 4,
    itinerary_warnings: [],
  };
}

function orderQuoteOf(): SiteTripOrderQuote {
  return {
    trip_id: TRIP_ID,
    plan_id: singlePlan().plan_id,
    currency: "JPY",
    segment_type: "charter",
    city: quotedCity,
    quote: charterQuote(),
    quote_request: { category: "charter", itinerary_pricing: true, pickup: HOTEL, dropoff: HOTEL, waypoints: [{ name: TEMPLE_NAME, lat: TEMPLE.lat, lng: TEMPLE.lng, stay_minutes: 90 }], service_local: "2030-11-20T09:00", passengers: 3, luggage: 2, addons: [] },
    itinerary_route: { legs: [{ minutes: 30, meters: 12000 }, { minutes: 30, meters: 12000 }], drive_minutes: 60, stay_minutes: 90, total_minutes: 150, total_meters: 24000 },
    expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
  };
}

const orderQuotePath = `/site/v1/trips/${TRIP_ID}/plans/${singlePlan().plan_id}/order-quote`;

test("单段方案：卡片上是「预订这个方案」；点了按经停点地名转成普通报价，带着它进 /book/new 第 3 步（乘客信息），不再询价、车型已选好", async () => {
  wideScreen();
  sessionStorage.setItem(`nozomi.trip-labels.${TRIP_ID}`, JSON.stringify({ v: 1, days: [[HOTEL_NAME, TEMPLE_NAME, HOTEL_NAME]] }));
  const calls = open({ at: `/book/trip?trip=${TRIP_ID}&step=2`, read: () => json(200, singleTrip()), orderQuote: () => json(200, orderQuoteOf()) });
  const card = await screen.findByRole("listitem", { name: "同一辆车跑完全程" }, SLOW);
  assert.equal(within(card).queryByRole("button", { name: "提交预订，客服确认" }), null, "单段方案不走客服确认");
  await user().click(within(card).getByRole("button", { name: "预订这个方案" }));

  assert.ok(await screen.findByRole("heading", { name: "乘客信息", level: 2 }, SLOW));
  assert.equal(pathname(), "/book/new");
  assert.equal(search(), "?step=3");
  const sent = posts(calls, orderQuotePath);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0]?.body, { waypoint_names: [TEMPLE_NAME] });
  assert.ok(screen.getAllByText("豪华七座").length >= 1, "车型已选好（右侧栏）");
  assert.equal(posts(calls, "/site/v1/quotes").length, 0, "直接用转好的报价，不再询价");
  assert.equal(posts(calls, "/site/v1/quotes/by-points").length, 0);
  assert.ok(screen.getByLabelText("乘车人姓名"), "接着填乘客信息");
});

test("单段方案价格变了（409 TRIP_PRICE_CHANGED）：留在方案对比，写「价格有变化，请重新报价」并给「重新报价」；这一车型报不出时另给「转人工报价」", async () => {
  wideScreen();
  let reason = "PRICE_CHANGED";
  const calls = open({
    at: `/book/trip?trip=${TRIP_ID}&step=2`,
    read: () => json(200, singleTrip()),
    quote: () => json(200, singleTrip()),
    orderQuote: () => apiError(409, "TRIP_PRICE_CHANGED", "价格有变化，请重新报价", { plan_total: { amount: "52000", currency: "JPY" }, quote_total: null, reason }),
  });
  const actor = user();
  let card = await screen.findByRole("listitem", { name: "同一辆车跑完全程" }, SLOW);
  await actor.click(within(card).getByRole("button", { name: "预订这个方案" }));
  assert.ok(await within(card).findByText("价格有变化，请重新报价", {}, SLOW));
  assert.equal(within(card).queryByRole("button", { name: "转人工报价" }), null);
  assert.equal(pathname(), "/book/trip");
  await actor.click(within(card).getByRole("button", { name: "重新报价" }));
  await waitFor(() => assert.equal(posts(calls, `/site/v1/trips/${TRIP_ID}/quote`).length, 1), SLOW);
  // 新结果到了：上次的说明收起
  await waitFor(() => assert.equal(screen.queryByText("价格有变化，请重新报价"), null), SLOW);

  reason = "NO_OFFER";
  card = await screen.findByRole("listitem", { name: "同一辆车跑完全程" }, SLOW);
  await actor.click(within(card).getByRole("button", { name: "预订这个方案" }));
  assert.ok(await within(card).findByText("价格有变化，请重新报价；也可以转人工报价，由客服按这个方案核对", {}, SLOW));
  assert.ok(within(card).getByRole("button", { name: "重新报价" }));
  assert.ok(within(card).getByRole("button", { name: "转人工报价" }));
});

test("多段方案：卡片上是「提交预订，客服确认」；留邮箱提交的是带行程单编号和这个方案 plan_kind 的人工报价", async () => {
  wideScreen();
  const days = [
    { day_index: 0, date: "2030-11-20", segments: [segmentOf("s1", "airport_pickup", "30000", "2030-11-20T14:30", "2030-11-20T16:00")], fees: [] },
    { day_index: 1, date: "2030-11-21", segments: [segmentOf("s2", "charter", "60000", "2030-11-21T09:00", "2030-11-21T13:00")], fees: [] },
  ];
  const calls = open({ at: `/book/trip?trip=${TRIP_ID}&step=2`, read: () => json(200, tripOf({ plans: [planOf("one_car", "98000", { recommended: true, days }), planOf("daily_best", "91000", { days })] })) });
  const compare = await screen.findByRole("list", { name: "两个方案对比" }, SLOW);
  const daily = within(compare).getByRole("listitem", { name: "每天选最划算的车" });
  assert.equal(within(compare).queryByRole("button", { name: "预订这个方案" }), null, "多段方案不能直接在线下单");
  const actor = user();
  await actor.click(within(daily).getByRole("button", { name: "提交预订，客服确认" }));
  assert.equal(document.activeElement, within(daily).getByLabelText("邮箱"), "表单出来后焦点在第一个框");
  await actor.type(within(daily).getByLabelText("邮箱"), "guest@example.com");
  await actor.click(within(daily).getByRole("button", { name: "提交" }));
  assert.ok(await within(daily).findByText(/已收到/, {}, SLOW));
  const sent = posts(calls, "/site/v1/manual-quote-requests");
  assert.equal(sent.length, 1);
  const body = sent[0]?.body as Record<string, unknown>;
  assert.equal(body["trip_id"], TRIP_ID);
  assert.equal(body["plan_kind"], "daily_best");
  assert.deepEqual((body["trip_labels"] as string[][]).map((day) => day.length), [2, 3]);
  assert.equal((body["trip"] as { category: string }).category, "airport_transfer", "trip 填第一天的行程");
  assert.equal(posts(calls, orderQuotePath).length, 0);
});

test("过期的方案：不给预订按钮，只给「重新报价」", async () => {
  wideScreen();
  open({ at: `/book/trip?trip=${TRIP_ID}&step=2`, read: () => json(200, tripOf({ itinerary: ONE_DAY, plans: [{ ...singlePlan(), expired: true }] })) });
  const card = await screen.findByRole("listitem", { name: "同一辆车跑完全程" }, SLOW);
  assert.equal(within(card).queryByRole("button", { name: "预订这个方案" }), null);
  assert.equal(within(card).queryByRole("button", { name: "提交预订，客服确认" }), null);
  assert.ok(screen.getByRole("button", { name: "重新报价" }));
});

test("单段方案后端说不是单段（409 TRIP_PLAN_NOT_SINGLE_SEGMENT）：退回「提交预订，客服确认」，焦点移到说明上（不掉到页面开头）", async () => {
  wideScreen();
  open({ at: `/book/trip?trip=${TRIP_ID}&step=2`, read: () => json(200, singleTrip()), orderQuote: () => apiError(409, "TRIP_PLAN_NOT_SINGLE_SEGMENT", "x", { reason: "MULTI_SEGMENT", segment_count: 2 }) });
  const card = await screen.findByRole("listitem", { name: "同一辆车跑完全程" }, SLOW);
  await user().click(within(card).getByRole("button", { name: "预订这个方案" }));
  const message = await within(card).findByText("这个方案不能直接在线下单，请提交预订，由客服确认", {}, SLOW);
  assert.equal(within(card).queryByRole("button", { name: "预订这个方案" }), null);
  assert.ok(within(card).getByRole("button", { name: "提交预订，客服确认" }));
  const alert = message.closest('[role="alert"]');
  assert.ok(alert);
  await waitFor(() => assert.equal(document.activeElement, alert));
});

test("预订时行程单已过期（404 TRIP_NOT_FOUND）：写明并给「修改行程」，点了回第 1 步", async () => {
  wideScreen();
  open({ at: `/book/trip?trip=${TRIP_ID}&step=2`, read: () => json(200, singleTrip()), orderQuote: () => apiError(404, "TRIP_NOT_FOUND", "x") });
  const card = await screen.findByRole("listitem", { name: "同一辆车跑完全程" }, SLOW);
  const actor = user();
  await actor.click(within(card).getByRole("button", { name: "预订这个方案" }));
  assert.ok(await within(card).findByText("预订没有打开：这个行程已过期或不存在，请重新填写。", {}, SLOW));
  await actor.click(within(card).getByRole("button", { name: "修改行程" }));
  assert.ok(await screen.findByRole("heading", { name: "你的行程", level: 2 }, SLOW));
});

// ---------- AI 一句话（M9T-33，ADR 0104） ----------

const AI_ON: Route = () => json(200, { available: true, max_chars: 500 });
const SENTENCE = "11月20日成田接机 NH211 去京王广场酒店，第二天9点从酒店出发去浅草寺玩一个半小时再回酒店，包车8小时，3个人2件行李";
const naritaPoint = { name: "成田国际机场", lat: 35.772, lng: 140.3929, kind: "airport" };
const hotelPoint = { name: "京王广场酒店", address: "东京都新宿区西新宿 2-2-1", ...HOTEL, kind: "hotel" };
const templePoint = { name: "浅草寺", address: "东京都台东区浅草 2-3-1", ...TEMPLE, kind: "poi" };
const resolved = (query: string, point: object) => ({ query, match: { status: "resolved", point } });

/** 两天都齐全的解析结果（和「建行程单 → 报价」那条测试同一个行程） */
const PARSED = {
  draft: {
    date: "2030-11-20",
    passengers: 3,
    luggage: 2,
    days: [
      { idle: false, time: "14:30", start: { ...resolved("成田机场", naritaPoint), kind: "airport" }, stops: [], end: { ...resolved("京王广场酒店", hotelPoint), kind: "hotel" }, lodging_provided: false },
      { idle: false, time: "09:00", start: resolved("酒店", hotelPoint), stops: [{ ...resolved("浅草寺", templePoint), kind: "poi", stay_minutes: 90 }], end: resolved("酒店", hotelPoint), lodging_provided: false },
    ],
  },
  missing: [],
  assumptions: [{ code: "DATE_FROM_RELATIVE", field: "date", value: "2030-11-20" }],
  unused: [
    { code: "FLIGHT_NUMBER", value: "NH211" },
    { code: "CHARTER_HOURS", value: "8" },
  ],
  out_of_scope: [],
  texts: { summary: "服务端拼的文案（页面不用）" },
};

// 每条限时 30 秒：卡住时只挂这一条、日志里看得出是哪条，不拖住整个组件测试
test("AI 一句话：parse-status 说不可用或问不到时不显示输入框", { timeout: 30_000 }, async () => {
  wideScreen();
  open({ parseStatus: () => apiError(404, "NOT_FOUND", "x") });
  assert.ok(await screen.findByRole("heading", { name: "你的行程", level: 2 }, SLOW));
  await dateField();
  assert.equal(screen.queryByRole("heading", { name: "一句话描述你的行程" }), null);
  assert.equal(screen.queryByLabelText("行程描述"), null);
});

test("AI 一句话：可用时表单上方有输入框、字数、「帮我填好」和一行小字", { timeout: 30_000 }, async () => {
  wideScreen();
  open({ parseStatus: AI_ON });
  assert.ok(await screen.findByRole("heading", { name: "一句话描述你的行程", level: 2 }, SLOW));
  assert.ok(screen.getByText("0 / 500 字"));
  assert.ok(screen.getByRole("button", { name: "帮我填好" }));
  assert.ok(screen.getByText("由 AI 整理，价格由系统按规则计算；请勿填写姓名、电话等个人信息"));
});

/** 打开页面、等输入框出来；返回输入框 */
async function aiBox(parse?: Route): Promise<{ box: HTMLTextAreaElement; calls: ApiCall[] }> {
  const calls = open({ parseStatus: AI_ON, ...(parse === undefined ? {} : { parse }) });
  await screen.findByRole("heading", { name: "一句话描述你的行程", level: 2 }, SLOW);
  return { box: screen.getByLabelText("行程描述") as HTMLTextAreaElement, calls };
}

/** AI 整理后的摘要框（不用按角色 + 名称在整页里找：整页的按名称查询太慢） */
async function aiSummary(): Promise<HTMLElement> {
  await waitFor(() => assert.ok(document.querySelector(".trip-ai-summary")), SLOW);
  return document.querySelector(".trip-ai-summary") as HTMLElement;
}

const writeBox = (box: HTMLTextAreaElement, text: string): void => {
  fireEvent.change(box, { target: { value: text } });
};

test("AI 一句话：没写时点「帮我填好」提示先写一句，不发请求", { timeout: 30_000 }, async () => {
  wideScreen();
  const { calls } = await aiBox();
  fireEvent.click(screen.getByRole("button", { name: "帮我填好" }));
  assert.ok(await screen.findByText("请先写一句行程"));
  assert.equal(posts(calls, "/site/v1/trips/parse").length, 0);
});

test("AI 一句话：超过 500 字时字数提示、点了说最多 500 字，不发请求", { timeout: 30_000 }, async () => {
  wideScreen();
  const { box, calls } = await aiBox();
  writeBox(box, "长".repeat(501));
  assert.ok(await screen.findByText("501 / 500 字"));
  fireEvent.click(screen.getByRole("button", { name: "帮我填好" }));
  assert.ok(await screen.findByText("最多 500 字，请删短一些"));
  assert.equal(posts(calls, "/site/v1/trips/parse").length, 0);
});

test("AI 一句话：没看出行程、太频繁、额度用完：输入框下面一句话，表单不动", { timeout: 30_000 }, async () => {
  wideScreen();
  let answer: Route = () => apiError(422, "NOT_A_TRIP", "x");
  const { box, calls } = await aiBox((call) => answer(call));
  writeBox(box, "你好");
  fireEvent.click(screen.getByRole("button", { name: "帮我填好" }));
  assert.ok(await screen.findByText("没看出行程，请写上日期、地点，或直接在下面填写", {}, SLOW));
  assert.deepEqual(posts(calls, "/site/v1/trips/parse")[0]?.body, { text: "你好", lang: "zh" });
  assert.equal(document.querySelector(".trip-ai-summary"), null);

  answer = () => apiError(429, "RATE_LIMITED", "x", {}, { "retry-after": "30" });
  fireEvent.click(screen.getByRole("button", { name: "帮我填好" }));
  assert.ok(await screen.findByText("请 30 秒后再试", {}, SLOW));

  answer = () => apiError(503, "AI_DAILY_LIMIT", "x");
  fireEvent.click(screen.getByRole("button", { name: "帮我填好" }));
  assert.ok(await screen.findByText("今天的自动整理次数已满，请直接填写", {}, SLOW));
});

test("AI 一句话：整理中按钮变「正在整理…」、输入框只读；没配密钥整块收起，表单照常", { timeout: 30_000 }, async () => {
  wideScreen();
  const slow = deferred();
  const { box } = await aiBox(() => slow.promise);
  writeBox(box, "成田接机");
  const button = screen.getByRole("button", { name: "帮我填好" });
  fireEvent.click(button);
  await waitFor(() => assert.equal(button.getAttribute("aria-busy"), "true"), SLOW);
  assert.match(button.textContent ?? "", /正在整理…/);
  assert.equal(box.readOnly, true);
  slow.resolve(apiError(503, "AI_NOT_CONFIGURED", "x"));
  await waitFor(() => assert.equal(document.querySelector(".trip-ai"), null), SLOW);
  assert.ok(screen.getByRole("heading", { name: "你的行程", level: 2 }));
});

test("AI 一句话：表单已经填了东西时先问「替换吗」，取消不动、替换才换；缺的写进「请补填」（人数按默认填了的写明），不在档上的停留进「请确认」，多个候选的地点留空", { timeout: 30_000 }, async () => {
  wideScreen();
  const partial = {
    ...PARSED,
    draft: {
      date: "2030-11-20",
      passengers: null,
      luggage: 2,
      days: [
        {
          idle: false,
          time: null,
          start: resolved("成田机场", naritaPoint),
          stops: [{ ...resolved("浅草寺", templePoint), stay_minutes: 45 }],
          end: { query: "新宿的酒店", kind: "hotel", match: { status: "ambiguous", candidates: [hotelPoint, { ...hotelPoint, name: "新宿华盛顿酒店", lat: 35.6889 }] } },
        },
      ],
    },
    assumptions: [],
    unused: [],
    out_of_scope: [{ code: "BUS" }],
  };
  const calls = open({ parseStatus: AI_ON, parse: () => json(200, partial) });
  const actor = user();
  await dateField();
  await pickPlace(actor, "第 1 天 最后下车地点", "京王", /京王广场酒店/);
  writeBox((await screen.findByLabelText("行程描述", {}, SLOW)) as HTMLTextAreaElement, "成田接机去浅草寺再去新宿的酒店，坐大巴");
  await actor.click(screen.getByRole("button", { name: "帮我填好" }));

  assert.ok(await screen.findByText("用 AI 整理的结果替换现在填的内容吗？", {}, SLOW));
  await waitFor(() => assert.equal(document.activeElement, screen.getByText("替换").closest("button")));
  await actor.click(screen.getByText("取消").closest("button") as HTMLElement);
  assert.equal(screen.queryByText("用 AI 整理的结果替换现在填的内容吗？"), null);
  assert.equal((within(daySection(1)).getByRole("combobox", { name: "第 1 天 最后下车地点" }) as HTMLInputElement).value, HOTEL_NAME, "取消后表单不动");

  await actor.click(screen.getByRole("button", { name: "帮我填好" }));
  await actor.click((await screen.findByText("替换", {}, SLOW)).closest("button") as HTMLElement);
  const summary = await aiSummary();
  assert.match(summary.textContent ?? "", /已按你的描述填好 1 天行程/);
  assert.equal(posts(calls, "/site/v1/trips/parse").length, 2);
  const missing = within(summary).getByRole("heading", { name: "请补填" }).nextElementSibling as HTMLElement;
  assert.deepEqual(within(missing).getAllByRole("listitem").map((item) => item.textContent), ["人数（先按 2 人填了）", "第 1 天的上车时间", "第 1 天的最后下车地点"]);
  assert.ok(within(summary).getByText("第 1 天第 1 个中间地点的停留时长没有对应的选项，请自己选"));
  assert.ok(within(summary).getByText("行程里有暂时报不了价的部分（大巴），可以转人工报价"));
  assert.equal((within(daySection(1)).getByRole("combobox", { name: "第 1 天 最后下车地点" }) as HTMLInputElement).value, "", "两个候选：留空等客人选");
  assert.equal((screen.getByLabelText(/第 1 天 第 2 个地点 停留时长/) as HTMLSelectElement).value, "");
  assert.equal(posts(calls, "/site/v1/trips").length, 0, "AI 不建单");
});

test("AI 一句话：可用时表单上方有输入框；整理好的结果直接填进空表单，顶部摘要写请确认 / 没有用上的信息（不用服务端的 texts），之后「查看报价」建的行程单和手填的一样", { timeout: 30_000 }, async () => {
  wideScreen();
  const calls = open({ parseStatus: AI_ON, parse: () => json(200, PARSED) });
  const actor = user();
  assert.ok(await screen.findByRole("heading", { name: "一句话描述你的行程", level: 2 }, SLOW));
  assert.ok(screen.getByText("由 AI 整理，价格由系统按规则计算；请勿填写姓名、电话等个人信息"));
  const box = screen.getByLabelText("行程描述") as HTMLTextAreaElement;
  await dateField();
  writeBox(box, SENTENCE);
  assert.ok(await screen.findByText(`${[...SENTENCE].length} / 500 字`));
  await actor.click(screen.getByRole("button", { name: "帮我填好" }));

  const summary = await aiSummary();
  assert.ok(within(summary).getByText("已按你的描述填好 2 天行程。标黄的地方请补填或确认，然后点「查看报价」"));
  assert.deepEqual(posts(calls, "/site/v1/trips/parse")[0]?.body, { text: SENTENCE, lang: "zh" });
  assert.equal(within(summary).queryByRole("heading", { name: "请补填" }), null, "都齐了，没有请补填");
  assert.ok(within(summary).getByText("第 1 天的日期按 11 月 20 日填"));
  assert.ok(within(summary).getByText("航班号 NH211：行程报价暂不用航班号，下单时可以填在备注里"));
  assert.ok(within(summary).getByText("你说的「包车 8 小时」会按实际路线自动选套餐，报价里能看到"));
  assert.equal(screen.queryByText("服务端拼的文案（页面不用）"), null);
  await waitFor(() => assert.equal(document.activeElement, summary), SLOW);

  assert.equal((screen.getByLabelText("日期（当地）") as HTMLInputElement).value, "2030-11-20");
  assert.equal((within(daySection(1)).getByRole("combobox", { name: "第 1 天 上车地点" }) as HTMLInputElement).value, "成田国际机场");
  assert.equal((within(daySection(2)).getByRole("combobox", { name: "第 2 天 第 2 个地点" }) as HTMLInputElement).value, TEMPLE_NAME);
  assert.equal((screen.getByLabelText(/第 2 天 第 2 个地点 停留时长/) as HTMLSelectElement).value, "90");

  await actor.click(screen.getByRole("button", { name: "查看报价" }));
  assert.ok(await screen.findByRole("heading", { name: "报价结果", level: 2 }, SLOW));
  assert.deepEqual(posts(calls, "/site/v1/trips")[0]?.body, {
    schemaVersion: 1,
    party: { adults: 3, children: 0, luggage: 2 },
    days: [
      { date: "2030-11-20", items: [{ kind: "arrive_flight", place: { lat: 35.772, lng: 140.3929 }, time: "14:30" }, { kind: "end", place: HOTEL }], nightAt: HOTEL },
      { date: "2030-11-21", items: [{ kind: "start", place: HOTEL, time: "09:00" }, { kind: "stop", place: TEMPLE, stayMinutes: 90 }, { kind: "end", place: HOTEL }] },
    ],
  });
  assert.deepEqual(JSON.parse(sessionStorage.getItem(`nozomi.trip-labels.${TRIP_ID}`) ?? "null"), { v: 1, days: [["成田国际机场", HOTEL_NAME], [HOTEL_NAME, TEMPLE_NAME, HOTEL_NAME]] });
});
