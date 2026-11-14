/**
 * 嵌入预订页的四步和 iframe 里的订单页（M9E-17，ADR 0095 第四、六、八、九节）的组件测试：
 * - 复用 /book/new 四步：读草稿带 key、host；对得上时询价带 draft_id，对不上时不带；一直单栏、不提供地图选点（不用 Leaflet）；
 *   每一步的地址都保留 draft、key、lang、host；换步发 step；下单后进 iframe 里的订单页，令牌放 history.state 和 nozomi.embed-order，不进地址、不发给宿主；
 * - 订单页（不在 iframe 里付款，M9E-19 再做）：待付款时给新窗口的主站订单页链接、隔几秒读一次；看到付款完成发 step paid + completed{orderNo, status: submitted} 一次，删掉记录；
 * - 宿主页刷新后续接：存储里有这个草稿的待付款单就进订单页；已付款、读不到的删掉照常预订；
 * - 订单页找不到令牌、顶层打开的说法。接口用替身。
 */
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { BrowserRouter } from "react-router";
import type { SiteByPointsResult, SiteCity, SiteConfig, SiteOrder, SiteOrderEnvelope, SiteQuote } from "../../api/site.ts";
import { EMBED_ORDER_KEY } from "../../embed/embed-order-store.ts";
import { type ApiCall, apiError, json, stubApiWith } from "../../testing/harness.tsx";
import { EmbedApp } from "./EmbedApp.tsx";
import { EMBED_FRAME } from "./EmbedFrame.tsx";
import { ORDER_POLL } from "./EmbedOrderPage.tsx";
import { EMBED_TEXTS } from "./embed-texts.ts";

const SLOW = { timeout: 4000 };
const DRAFT = "D".repeat(43);
const KEY = `nze_${"A".repeat(32)}`;
const HOST = "https://partner.example";
const CH = "0123456789abcdef0123456789abcdef";
const TOKEN = `nzo_${"t".repeat(43)}`;
const ORDER_NO = "NZ20301120ABCD2345";
const CITY_ID = "11111111-1111-4111-8111-111111111111";
const DRAFT_BODY = {
  v: 1,
  tab: "transfer",
  service_local: "2030-11-20T10:00",
  pickup: { name: "京王广场酒店", lat: 35.6905, lng: 139.6948 },
  dropoff: { name: "东京站", lat: 35.6812, lng: 139.7671 },
  waypoints: [],
  package_hours: null,
  passengers: 2,
  luggage: 1,
  lang: "ja",
};
const city: SiteCity = { id: CITY_ID, code: "CTY-JP-TYO", name: { zh: "东京" }, timezone: "Asia/Tokyo", country_code: "JP", center: { lat: 35.6895, lng: 139.6917 }, categories: ["airport_transfer", "point_to_point", "charter"] };
// 配了地图底图：嵌入页也不能用（不提供地图选点、不画 Leaflet 后备图）
const config: SiteConfig = { open: true, currency: "JPY", payments: null, support_phone: null, support_whatsapp: null, address_search: true, page_width: "standard", map_tiles: { url: "https://tiles.example/{z}/{x}/{y}.png", attribution: "© tiles", max_zoom: 18 } as unknown as SiteConfig["map_tiles"] };

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
  cancel_policy: { category: "point_to_point", level: "economy", tiers: [{ min_hours_before: 24, fee_bp: 0 }, { min_hours_before: 0, fee_bp: 10000 }] },
  available_addons: [],
};
const byPoints: SiteByPointsResult = { trip_type: "point_to_point", airport: null, fallback_category: null, city: { id: CITY_ID, code: city.code, name: city.name, timezone: city.timezone }, currency: "JPY", quotes: [quote], unavailable: [], expires_at: null, route: null };

const orderOf = (status: SiteOrder["status"]): SiteOrder =>
  ({
    id: "44444444-4444-4444-8444-444444444444",
    order_no: ORDER_NO,
    status,
    category: "point_to_point",
    city_id: CITY_ID,
    place_id: null,
    direction: null,
    vehicle_group_id: quote.vehicle_group.id,
    package_hours: null,
    service_time: "2030-11-20T01:00:00.000Z",
    service_local: "2030-11-20T10:00",
    timezone: "Asia/Tokyo",
    service_date: "2030-11-20",
    urgent: false,
    passengers: 2,
    luggage: 1,
    pickup: { lng: 139.6948, lat: 35.6905, address: "京王广场酒店" },
    dropoff: { lng: 139.7671, lat: 35.6812, address: "东京站" },
    addons: [],
    driver_language: null,
    flight_no: null,
    passenger: { name: "王小明", phone: "+819012345678", email: "guest@example.com" },
    messaging: null,
    notes: null,
    free_wait_minutes: 15,
    created_at: "2030-11-01T01:00:00.000Z",
    confirmed_at: null,
    cancelled_at: null,
    cancel_reason: null,
    quote_id: quote.quote_id,
    channel_order_no: null,
    price: { total: { amount: "18000", currency: "JPY" }, fx: null },
    payment_status: "requires_payment_method",
    payment_due_at: "2030-11-01T01:30:00.000Z",
    winning_tenant: null,
    driver: null,
    vehicle: null,
    landing: null,
    cancel_policy: null,
    cancellation: null,
    free_cancel_available: false,
    changes: [],
    extra_charges: [],
    version: 1,
  }) as SiteOrder;
const envelopeOf = (status: SiteOrder["status"]): SiteOrderEnvelope => ({
  order: orderOf(status),
  timeline: [{ from_status: null, to_status: "pending_payment", reason: null, occurred_at: "2030-11-01T01:00:00.000Z" }],
  names: { city: { code: city.code, name: city.name }, place: null, vehicle_group: { code: "VG-T1", name: { zh: "车型1" }, seats: 7, sample_models: [], combos: [{ passengers: 6, luggage: 4 }] } },
});

let posted: [unknown, string][] = [];
const parent = { postMessage: (message: unknown, targetOrigin: string) => posted.push([message, targetOrigin]) } as unknown as Window;
const originalParent = EMBED_FRAME.parent;
const messages = () => posted.map(([message]) => message as Record<string, unknown>);
const steps = () => messages().filter((message) => message["type"] === "step").map((message) => message["step"]);

beforeEach(() => {
  posted = [];
  EMBED_FRAME.parent = () => parent;
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  EMBED_FRAME.parent = originalParent;
  ORDER_POLL.ms = 5_000;
  sessionStorage.clear();
  history.replaceState(null, "", "/");
});

interface Options {
  sourceMatches?: boolean;
  /** 订单接口按调用次数给状态 */
  orderStatus?: (call: number) => SiteOrder["status"] | "gone";
}

function stub(options: Options = {}): ApiCall[] {
  let orderReads = 0;
  return stubApiWith((call) => {
    const path = call.url.pathname;
    if (path === `/site/v1/booking-drafts/${DRAFT}`) return json(200, { draft: DRAFT_BODY, expires_at: "2030-11-20T00:00:00Z", source_matches: options.sourceMatches ?? true });
    if (path === "/site/v1/config") return json(200, config);
    if (path === "/site/v1/cities") return json(200, { items: [city] });
    if (call.method === "POST" && path === "/site/v1/quotes/by-points") return json(200, byPoints);
    if (path === "/site/v1/fx/reference") return json(200, { available: false, from: "JPY", to: "USD", rate: null, as_of: null, reason: "NO_RATE" });
    if (call.method === "POST" && path === "/site/v1/orders") return json(201, { ...envelopeOf("pending_payment"), payment: null, link: { token: TOKEN, expires_at: "2030-12-01T00:00:00.000Z" } });
    if (call.method === "GET" && path === "/site/v1/order") {
      orderReads += 1;
      const status = options.orderStatus?.(orderReads) ?? "pending_payment";
      return status === "gone" ? apiError(401, "ORDER_LINK_INVALID", "x") : json(200, envelopeOf(status));
    }
    return null;
  });
}

function open(path: string): void {
  history.replaceState(null, "", path);
  render(
    <BrowserRouter>
      <EmbedApp />
    </BrowserRouter>,
  );
}
const query = `?draft=${DRAFT}&key=${KEY}&lang=ja&host=${encodeURIComponent(HOST)}`;
const bookUrl = `/embed/book${query}#ch=${CH}`;
const posts = (calls: ApiCall[], path: string): ApiCall[] => calls.filter((call) => call.method === "POST" && call.path === path);
const keepsFrameParams = (): void => {
  const params = new URLSearchParams(window.location.search);
  for (const [name, value] of [["draft", DRAFT], ["key", KEY], ["lang", "ja"], ["host", HOST]] as const) assert.equal(params.get(name), value, `${window.location.pathname}${window.location.search} 少了 ${name}`);
};

async function toReview(actor: ReturnType<typeof userEvent.setup>): Promise<void> {
  await screen.findByRole("heading", { name: "车型1" }, SLOW);
  keepsFrameParams();
  await actor.click(screen.getByRole("button", { name: "选择 车型1" }));
  await actor.click(screen.getByRole("button", { name: "下一步" }));
  await screen.findByRole("heading", { name: "乘客信息", level: 2 });
  keepsFrameParams();
  await actor.type(screen.getByLabelText("乘车人姓名"), "王小明");
  await actor.type(screen.getByLabelText("邮箱"), "guest@example.com");
  await actor.type(screen.getByLabelText("手机号（含国家区号）"), "+81 90-1234-5678");
  await actor.click(screen.getByRole("button", { name: "下一步：核对订单" }));
  await screen.findByRole("heading", { name: "核对订单" });
  keepsFrameParams();
}

test("四步：读草稿带 key、host，对得上时询价带 draft_id；一直单栏、没有地图选点；每一步地址都保留 draft / key / lang / host；换步发 step；下单后进 iframe 里的订单页", async () => {
  const calls = stub();
  const actor = userEvent.setup();
  open(bookUrl);
  await toReview(actor);
  assert.equal(posts(calls, "/site/v1/quotes/by-points")[0]?.body && (posts(calls, "/site/v1/quotes/by-points")[0]?.body as Record<string, unknown>)["draft_id"], DRAFT, "询价带草稿编号");
  assert.equal(screen.queryByRole("complementary", { name: "行程摘要" }), null, "没有右侧栏（单栏）");
  assert.equal(screen.queryByRole("button", { name: /地图上选/ }), null, "没有地图选点");
  assert.equal(document.querySelector(".leaflet-container"), null, "没有 Leaflet 地图");
  assert.ok(screen.getByText(EMBED_TEXTS.ja.seller), "卖方说明一直在");

  await actor.click(screen.getByRole("checkbox", { name: /同意保存这次付款用的银行卡/ }));
  await actor.click(screen.getByRole("button", { name: "去付款 →" }));
  await screen.findByRole("heading", { name: `${EMBED_TEXTS.ja.orderNo} ${ORDER_NO}` }, SLOW);
  assert.equal(window.location.pathname, "/embed/book/order");
  keepsFrameParams();
  assert.equal(new URLSearchParams(window.location.search).has("step"), false);
  assert.doesNotMatch(window.location.href, /nzo_/, "令牌不进地址");
  assert.equal((history.state as { usr?: { orderToken?: string } } | null)?.usr?.orderToken, TOKEN, "令牌在这条历史记录的 state 里");
  assert.equal(JSON.parse(sessionStorage.getItem(EMBED_ORDER_KEY) ?? "{}").token, TOKEN, "也在本标签页的 nozomi.embed-order 里");
  const pay = screen.getByRole("link", { name: new RegExp(EMBED_TEXTS.ja.payInNewWindow) });
  assert.equal(pay.getAttribute("href"), `/book/order#${TOKEN}`);
  assert.equal(pay.getAttribute("target"), "_blank");

  // 草稿齐了先挂第 1 步、报价后到第 2 步（同主站）
  assert.deepEqual(steps(), ["trip", "vehicle", "passenger", "review", "payment"]);
  assert.deepEqual(messages()[0], { ns: "nozomi-booking", v: 1, ch: CH, type: "ready", lang: "ja" });
  assert.equal(messages().filter((message) => message["type"] === "ready").length, 1, "ready 只发一次");
  assert.ok(posted.every(([, origin]) => origin === HOST));
  assert.doesNotMatch(JSON.stringify(posted), /王小明|guest@example|\+81|nzo_|京王|东京站|18000|D{43}|nze_/, "消息里没有个人信息、地点、价格、令牌、草稿号、嵌入码");
});

test("草稿上记的嵌入码、宿主和这次对不上（source_matches=false）：照常预填和报价，但询价不带 draft_id（来源按主站记）", async () => {
  const calls = stub({ sourceMatches: false });
  open(bookUrl);
  await screen.findByRole("heading", { name: "车型1" }, SLOW);
  const body = posts(calls, "/site/v1/quotes/by-points")[0]?.body as Record<string, unknown>;
  assert.equal(body["service_local"], "2030-11-20T10:00");
  assert.equal("draft_id" in body, false);
});

test("订单页：待付款时隔几秒读一次；客人在新窗口付完（订单不再待付款）——显示付款已提交，发 step paid 和 completed{orderNo, status: submitted} 各一次，删掉 nozomi.embed-order", async () => {
  ORDER_POLL.ms = 20;
  stub({ orderStatus: (call) => (call < 3 ? "pending_payment" : "confirmed") });
  sessionStorage.setItem(EMBED_ORDER_KEY, JSON.stringify({ draft: DRAFT, token: TOKEN, at: Date.now() }));
  open(`/embed/book/order${query}#ch=${CH}`);
  await screen.findByText(EMBED_TEXTS.ja.paid, {}, SLOW);
  await waitFor(() => assert.equal(sessionStorage.getItem(EMBED_ORDER_KEY), null));
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.deepEqual(
    messages().map((message) => message["type"]),
    ["ready", "step", "step", "completed"],
  );
  assert.deepEqual(steps(), ["payment", "paid"]);
  assert.deepEqual(messages()[3], { ns: "nozomi-booking", v: 1, ch: CH, type: "completed", orderNo: ORDER_NO, status: "submitted" });
  assert.equal(screen.getByRole("link", { name: new RegExp(EMBED_TEXTS.ja.openOrder) }).getAttribute("target"), "_blank");
  assert.equal(screen.queryByRole("button", { name: /取消/ }), null, "iframe 里不放取消按钮");
});

test("订单页：令牌失效（401）删掉记录、说找不到；没有令牌（没有 state、存储里也没有）直接说找不到，给主站查订单（新标签页）", async () => {
  stub({ orderStatus: () => "gone" });
  sessionStorage.setItem(EMBED_ORDER_KEY, JSON.stringify({ draft: DRAFT, token: TOKEN, at: Date.now() }));
  open(`/embed/book/order${query}#ch=${CH}`);
  await screen.findByText(EMBED_TEXTS.ja.orderMissing, {}, SLOW);
  assert.equal(sessionStorage.getItem(EMBED_ORDER_KEY), null);
  cleanup();
  posted = [];
  const calls = stub();
  open(`/embed/book/order${query}#ch=${CH}`);
  await screen.findByText(EMBED_TEXTS.ja.orderMissing);
  assert.equal(calls.length, 0);
  const lookup = screen.getByRole("link", { name: new RegExp(EMBED_TEXTS.ja.lookup) });
  assert.equal(lookup.getAttribute("href"), "/book/order");
  assert.equal(lookup.getAttribute("target"), "_blank");
  await waitFor(() => assert.equal(messages()[0]?.["type"], "ready"));
});

test("宿主页刷新后续接：本标签页有这个草稿的待付款单，直接进订单页（不读草稿）", async () => {
  const calls = stub();
  sessionStorage.setItem(EMBED_ORDER_KEY, JSON.stringify({ draft: DRAFT, token: TOKEN, at: Date.now() }));
  open(bookUrl);
  await screen.findByRole("heading", { name: `${EMBED_TEXTS.ja.orderNo} ${ORDER_NO}` }, SLOW);
  assert.equal(window.location.pathname, "/embed/book/order");
  keepsFrameParams();
  assert.equal(calls.filter((call) => call.path.startsWith("/site/v1/booking-drafts/")).length, 0);
  await waitFor(() => assert.deepEqual(steps(), ["payment"]));
});

test("宿主页刷新后续接：存着的单已付款或读不到——删掉记录，照常显示预订流程；别的草稿的记录不用", async () => {
  for (const status of ["confirmed", "cancelled", "gone"] as const) {
    stub({ orderStatus: () => status });
    sessionStorage.setItem(EMBED_ORDER_KEY, JSON.stringify({ draft: DRAFT, token: TOKEN, at: Date.now() }));
    open(bookUrl);
    await screen.findByRole("heading", { name: "车型1" }, SLOW);
    assert.equal(sessionStorage.getItem(EMBED_ORDER_KEY), null, status);
    assert.equal(window.location.pathname, "/embed/book", status);
    cleanup();
  }
  const calls = stub();
  sessionStorage.setItem(EMBED_ORDER_KEY, JSON.stringify({ draft: "E".repeat(43), token: TOKEN, at: Date.now() }));
  open(bookUrl);
  await screen.findByRole("heading", { name: "车型1" }, SLOW);
  assert.equal(calls.filter((call) => call.path === "/site/v1/order").length, 0, "别的草稿的单不去读");
});

test("订单页顶层打开（没被嵌）：不读订单、不显示订单内容，只说请在合作网站上预订", async () => {
  EMBED_FRAME.parent = () => null;
  const calls = stub();
  history.replaceState({ usr: { orderToken: TOKEN }, key: "x", idx: 0 }, "", `/embed/book/order${query}`);
  render(
    <BrowserRouter>
      <EmbedApp />
    </BrowserRouter>,
  );
  await screen.findByText(EMBED_TEXTS.ja.topLevel);
  assert.equal(calls.length, 0);
  assert.equal(within(document.body).queryByText(ORDER_NO, { exact: false }), null);
});
