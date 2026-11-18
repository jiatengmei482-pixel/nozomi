/**
 * 多日行程报价页 `/book/trip`（M9T-09 第一部分，ADR 0101 第十三节）的组件测试：
 * 第 1 步按天填写（加一天 / 删一天、上限、这天不用车、加中间地点）、点「查看报价」前的检查（问题写在各自的字段下面，不发请求）、
 * 建行程单的请求体（标准行程单：机场开头 arrive_flight、只发坐标、过夜点、停留）→ 报价 → 网址 `?trip=…&step=2`、地名存进本标签页；
 * 第 2 步的结果骨架（方案名、推荐、合计、车型、报不出的原因、全部报不出转人工、过期重新报价）；刷新（网址带行程单）只读不报价，回到第 1 步时表单用读回来的行程单填上；
 * 太复杂（422）、太频繁（429）、过期（404）的说法；报价没拿到应答时先读行程单（已报过价就直接显示、不再报价）；重新报价失败后「上一步」仍能填回表单；
 * 第 2 步的变化由常驻播报区告诉读屏；报价中右侧栏画表单里每天的路线；手机底部按钮条。
 * 接口用测试替身（浏览器只连 /site/v1）；真实后端由 e2e/site-trip-quote.spec.ts 覆盖。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { screen, waitFor, within, render } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { App } from "../../../App.tsx";
import type { SiteCity, SiteConfig, SiteTrip, SiteTripItinerary, SiteTripPlan } from "../../../api/site.ts";
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

function open(options: { at?: string; create?: Route; quote?: Route; read?: Route } = {}): ApiCall[] {
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
    if (call.method === "POST" && path === "/site/v1/trips") return options.create?.(call) ?? json(201, { trip_id: TRIP_ID, status: "draft", currency: "JPY", readable_until: "2030-12-20T00:00:00.000Z" });
    if (call.method === "POST" && path === `/site/v1/trips/${TRIP_ID}/quote`) return options.quote?.(call) ?? json(200, tripOf());
    if (call.method === "GET" && path === `/site/v1/trips/${TRIP_ID}`) return options.read?.(call) ?? json(200, tripOf());
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
  return <div data-testid="probe" data-search={location.search} />;
}

const search = (): string => screen.getByTestId("probe").getAttribute("data-search") ?? "";
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

test("全部方案报不出（manual_quote_suggested）：不显示方案，写「这个行程需要客服人工报价」", async () => {
  wideScreen();
  open({ at: `/book/trip?trip=${TRIP_ID}&step=2`, read: () => json(200, tripOf({ plans: [], unquoted: [{ plan_kind: "one_car", day_index: 0, reason: "NO_OFFER" }], manual_quote_suggested: true })) });
  assert.ok(await screen.findByRole("heading", { name: "这个行程需要客服人工报价" }, SLOW));
  assert.ok(screen.getByText("客服会按您填的行程人工报价"));
  assert.equal(screen.queryByRole("list", { name: "报价结果" }), null);
  assert.ok(within(screen.getByRole("region", { name: "报不出的方案" })).getByText("这个方案暂时报不出：没有可用的车"));
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
