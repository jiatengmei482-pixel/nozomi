/**
 * 嵌入预订页的四步和 iframe 里的订单页（M9E-17，ADR 0095 第四、六、八、九节）的组件测试：
 * - 复用 /book 四步：读草稿带 key、host；对得上时询价带 draft_id，对不上时不带；不提供地图选点（不用 Leaflet）；
 * - 分栏和主站一样按 iframe 自己的视口（M9E-27）：< 1024px 单栏、顶部摘要条；≥ 1024px 两栏、主站同一个「行程摘要」右侧栏；宽窄切换不重发 step；
 *   每一步的地址都保留 draft、key、lang、host；换步发 step；下单后进 iframe 里的订单页，令牌放 history.state 和 nozomi.embed-order，不进地址、不发给宿主；
 * - 订单页（不在 iframe 里付款，M9E-19 再做）：待付款时给新窗口的主站订单页链接、隔几秒读一次；看到付款完成发 step paid + completed{orderNo, status: submitted} 一次，删掉记录；
 * - 宿主页刷新后续接：存储里有这个草稿的待付款单就进订单页；已付款、读不到的删掉照常预订；
 * - 订单页找不到令牌、顶层打开的说法。接口用替身。
 */
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { BrowserRouter } from "react-router";
import type { SiteByPointsResult, SiteCity, SiteConfig, SiteOrder, SiteOrderEnvelope, SiteQuote } from "../../api/site.ts";
import { EMBED_ORDER_KEY } from "../../embed/embed-order-store.ts";
import { frameBarShift } from "../../embed/frame-bar.ts";
import { type PaymentDriver, PaymentDriverContext } from "../../lib/payment-driver.ts";
import { type ApiCall, apiError, json, stubApiWith, viewportWidth } from "../../testing/harness.tsx";
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
  itinerary_warnings: null,
};
const byPoints: SiteByPointsResult = { trip_type: "point_to_point", airport: null, fallback_category: null, city: { id: CITY_ID, code: city.code, name: city.name, timezone: city.timezone }, currency: "JPY", quotes: [quote], unavailable: [], expires_at: null, route: null };
const ROUTE = { minutes: 25, meters: 14_200, polyline: null };
const ROUTE_TEXT = "约 25 分钟 · 14.2 公里";

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
let screenWidth: ReturnType<typeof viewportWidth> | null = null;
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
  screenWidth?.restore();
  screenWidth = null;
  EMBED_FRAME.parent = originalParent;
  ORDER_POLL.ms = 5_000;
  sessionStorage.clear();
  history.replaceState(null, "", "/");
});

interface Options {
  sourceMatches?: boolean;
  /** 报价应答里的路线（默认没有） */
  route?: SiteByPointsResult["route"];
  /** 订单接口按调用次数给状态 */
  orderStatus?: (call: number) => SiteOrder["status"] | "gone";
  /** 配了 Stripe（付款进 iframe，M9E-19）：下单应答带 client_secret */
  payments?: boolean;
}

const PK = "pk_test_embed";
const SECRET = "pi_3Embed_secret_abc";
const sitePayment = { provider: "stripe" as const, status: "requires_payment_method", client_secret: SECRET, publishable_key: PK };

interface DriverLog {
  mounts: { publishableKey: string; clientSecret: string; locale?: string }[];
  /** 挂付款表单那一刻的地址（回跳参数必须在这之前去掉） */
  searchAtMount: string[];
  confirms: string[];
  /** 确认付款那一刻宿主已经收到的消息条数（看 modal{open:true} 是不是在确认之前发的） */
  postedAtConfirm: number[];
}
/** 假的付款组件（Stripe 的 Payment Element 由组件测试 site-payment.test.tsx 覆盖）：记下挂载参数和确认时的 return_url */
function fakeDriver(log: DriverLog, options: { awaiting?: boolean } = {}): PaymentDriver {
  return {
    async mount(_container, mountOptions) {
      log.mounts.push(mountOptions);
      log.searchAtMount.push(window.location.search);
      return {
        state: "open",
        lastError: null,
        awaitingPaymentMethod: options.awaiting ?? false,
        validate: async () => ({ ok: true }),
        confirm: async (returnUrl) => {
          log.confirms.push(returnUrl);
          log.postedAtConfirm.push(posted.length);
          return { kind: "succeeded" };
        },
        destroy: () => undefined,
      };
    },
  };
}

function stub(options: Options = {}): ApiCall[] {
  let orderReads = 0;
  return stubApiWith((call) => {
    const path = call.url.pathname;
    if (path === `/site/v1/booking-drafts/${DRAFT}`) return json(200, { draft: DRAFT_BODY, expires_at: "2030-11-20T00:00:00Z", source_matches: options.sourceMatches ?? true });
    if (path === "/site/v1/config") return json(200, options.payments === true ? { ...config, payments: { provider: "stripe", publishable_key: PK } } : config);
    if (path === "/site/v1/cities") return json(200, { items: [city] });
    if (call.method === "POST" && path === "/site/v1/quotes/by-points") return json(200, { ...byPoints, route: options.route ?? null });
    if (path === "/site/v1/fx/reference") return json(200, { available: false, from: "JPY", to: "USD", rate: null, as_of: null, reason: "NO_RATE" });
    if (call.method === "POST" && path === "/site/v1/orders") return json(201, { ...envelopeOf("pending_payment"), payment: options.payments === true ? sitePayment : null, link: { token: TOKEN, expires_at: "2030-12-01T00:00:00.000Z" } });
    if (call.method === "GET" && path === "/site/v1/order/payment") return json(200, { payment: sitePayment });
    if (call.method === "GET" && path === "/site/v1/order") {
      orderReads += 1;
      const status = options.orderStatus?.(orderReads) ?? "pending_payment";
      return status === "gone" ? apiError(401, "ORDER_LINK_INVALID", "x") : json(200, envelopeOf(status));
    }
    return null;
  });
}

function open(path: string, driver?: PaymentDriver): void {
  history.replaceState(null, "", path);
  const app = (
    <BrowserRouter>
      <EmbedApp />
    </BrowserRouter>
  );
  render(driver === undefined ? app : <PaymentDriverContext.Provider value={driver}>{app}</PaymentDriverContext.Provider>);
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
  await actor.click(screen.getByRole("button", { name: "下一步：填写乘客信息" }));
  await screen.findByRole("heading", { name: "乘客信息", level: 2 });
  keepsFrameParams();
  await actor.type(screen.getByLabelText("乘车人姓名"), "王小明");
  await actor.type(screen.getByLabelText("邮箱"), "guest@example.com");
  await actor.type(screen.getByLabelText("手机号（含国家区号）"), "+81 90-1234-5678");
  await actor.click(screen.getByRole("button", { name: "下一步：核对订单" }));
  await screen.findByRole("heading", { name: "核对订单" });
  keepsFrameParams();
}

test("四步（iframe 1023 宽）：读草稿带 key、host，对得上时询价带 draft_id；单栏、没有地图选点；每一步地址都保留 draft / key / lang / host；换步发 step；下单后进 iframe 里的订单页", async () => {
  screenWidth = viewportWidth(1023);
  const calls = stub();
  const actor = userEvent.setup();
  open(bookUrl);
  await toReview(actor);
  assert.equal(posts(calls, "/site/v1/quotes/by-points")[0]?.body && (posts(calls, "/site/v1/quotes/by-points")[0]?.body as Record<string, unknown>)["draft_id"], DRAFT, "询价带草稿编号");
  assert.equal(screen.queryByRole("complementary", { name: "行程摘要" }), null, "没有右侧栏（单栏）");
  assert.ok(screen.getByRole("button", { name: /行程摘要/ }), "顶部摘要条");
  assert.equal(screen.queryByRole("button", { name: /地图上选/ }), null, "没有地图选点");
  assert.equal(document.querySelector(".leaflet-container"), null, "没有 Leaflet 地图");
  assert.ok(screen.getByText(EMBED_TEXTS.ja.seller), "卖方说明一直在");

  await actor.click(screen.getByRole("checkbox", { name: /同意保存这次付款用的银行卡/ }));
  await actor.click(screen.getByRole("button", { name: "去付款 →" }));
  const orderHeading = await screen.findByRole("heading", { name: `${EMBED_TEXTS.ja.orderNo} ${ORDER_NO}` }, SLOW);
  await waitFor(() => assert.equal(document.activeElement, orderHeading, "进订单页时焦点在订单号标题上（「去付款」按钮已经卸载）"));
  assert.equal(window.location.pathname, "/embed/book/order");
  keepsFrameParams();
  assert.equal(new URLSearchParams(window.location.search).has("step"), false);
  assert.doesNotMatch(window.location.href, /nzo_/, "令牌不进地址");
  assert.equal((history.state as { usr?: { orderToken?: string } } | null)?.usr?.orderToken, TOKEN, "令牌在这条历史记录的 state 里");
  assert.equal(JSON.parse(sessionStorage.getItem(EMBED_ORDER_KEY) ?? "{}").token, TOKEN, "也在本标签页的 nozomi.embed-order 里");
  const pay = screen.getByRole("link", { name: new RegExp(EMBED_TEXTS.ja.payInNewWindow) });
  assert.equal(pay.getAttribute("href"), `/book/order#${TOKEN}`);
  assert.equal(pay.getAttribute("target"), "_blank");
  // 付款在 iframe 里（M9E-19）：新窗口的主站订单页只是退路，写在付款区块下面的一句话里
  assert.ok(pay.closest(".embed-book__pay-hint")?.textContent?.startsWith(EMBED_TEXTS.ja.payHint));
  assert.ok(screen.getByRole("heading", { name: "付款" }), "付款区块就在这一页（这里没配 Stripe：付款暂未开放）");

  // 草稿齐了先挂第 1 步、报价后到第 2 步（同主站）
  assert.deepEqual(steps(), ["trip", "vehicle", "passenger", "review", "payment"]);
  assert.deepEqual(messages()[0], { ns: "nozomi-booking", v: 1, ch: CH, type: "ready", lang: "ja" });
  assert.equal(messages().filter((message) => message["type"] === "ready").length, 1, "ready 只发一次");
  assert.ok(posted.every(([, origin]) => origin === HOST));
  assert.doesNotMatch(JSON.stringify(posted), /王小明|guest@example|\+81|nzo_|京王|东京站|18000|D{43}|nze_/, "消息里没有个人信息、地点、价格、令牌、草稿号、嵌入码");
});

test("iframe ≥ 1024 宽（M9E-27）：和主站一样两栏，右边是同一个「行程摘要」右侧栏（路线时长公里数、车型、出发地、目的地、时间、乘客 / 行李）；没有主站顶栏页脚；宽窄切换随时换栏、不重发 step", async () => {
  screenWidth = viewportWidth(1024);
  stub({ route: ROUTE });
  const actor = userEvent.setup();
  open(bookUrl);
  await screen.findByRole("heading", { name: "车型1" }, SLOW);
  const aside = screen.getByRole("complementary", { name: "行程摘要" });
  assert.equal(screen.queryAllByRole("button", { name: /行程摘要/ }).length, 0, "两栏时没有顶部摘要条");
  assert.ok(within(aside).getByText(ROUTE_TEXT), "右侧栏最上面是路线：约 X 分钟 · Y 公里");
  assert.ok(document.querySelector(".book-new > .book-new__aside") === aside, "右侧栏是主站 /book 的那一栏");
  assert.equal(document.querySelectorAll(".leaflet-container").length, 0, "没有 Leaflet 地图");
  // 主站外壳 SiteLayout 的顶栏、导航、页脚（.site__*）一样都不在；页面上的 <nav>、<footer> 也没有
  assert.deepEqual([...document.querySelectorAll(".site, .site__header, .site__nav, .site__footer, nav, footer")].map((node) => node.className), [], "没有主站顶栏、导航、页脚");
  assert.equal(screen.queryAllByRole("heading", { name: "预订接送车", level: 1 }).length, 0, "没有主站的页面标题");
  assert.ok(screen.getByText(EMBED_TEXTS.ja.seller), "卖方说明照旧在");

  await actor.click(screen.getByRole("button", { name: "选择 车型1" }));
  await actor.click(screen.getByRole("button", { name: "下一步：填写乘客信息" }));
  await screen.findByRole("heading", { name: "乘客信息", level: 2 });
  const facts = within(screen.getByRole("complementary", { name: "行程摘要" }));
  for (const [term, value] of [["出发地", "京王广场酒店"], ["目的地", "东京站"], ["乘客 / 行李", "2 人 · 1 件"]] as const) {
    assert.equal(facts.getByText(term).nextElementSibling?.textContent, value, term);
  }
  assert.ok(facts.getByText("用车时间（当地时间）"));
  assert.ok(facts.getByText("车型1"), "选好的车型");
  assert.ok(facts.getByText(ROUTE_TEXT));

  // iframe 变窄（宿主把预订区缩到 1024 以下）：当场换成单栏和顶部摘要条，再变宽换回来；换栏不算换步
  const stepsBefore = steps();
  screenWidth.resize(1023);
  // 只比个数：断言失败时 node:assert 要展开 DOM 节点，在 happy-dom 里会卡住
  await waitFor(() => assert.equal(screen.queryAllByRole("complementary", { name: "行程摘要" }).length, 0));
  assert.ok(screen.getByRole("button", { name: /行程摘要/ }));
  screenWidth.resize(1440);
  await waitFor(() => assert.ok(screen.getByRole("complementary", { name: "行程摘要" })));
  assert.equal(screen.getByRole("heading", { name: "乘客信息", level: 2 }).tagName, "H2", "还在第 3 步");
  assert.deepEqual(steps(), stepsBefore, "换栏不发 step");
  assert.deepEqual(stepsBefore, ["trip", "vehicle", "passenger"]);
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

test("订单页：标签页在后台（客人在新窗口付款）时不轮询；回到这个标签页马上读一次", async () => {
  ORDER_POLL.ms = 20;
  const original = Object.getOwnPropertyDescriptor(document, "visibilityState");
  let state: DocumentVisibilityState = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  try {
    const calls = stub();
    sessionStorage.setItem(EMBED_ORDER_KEY, JSON.stringify({ draft: DRAFT, token: TOKEN, at: Date.now() }));
    open(`/embed/book/order${query}#ch=${CH}`);
    await screen.findByRole("heading", { name: `${EMBED_TEXTS.ja.orderNo} ${ORDER_NO}` }, SLOW);
    const reads = () => calls.filter((call) => call.path === "/site/v1/order").length;
    await waitFor(() => assert.ok(reads() >= 2, "在前台时照常轮询"));
    state = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    await new Promise((resolve) => setTimeout(resolve, 60));
    const hidden = reads();
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(reads(), hidden, "在后台时不再读订单");
    state = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => assert.ok(reads() > hidden, "回到前台马上读一次"));
  } finally {
    if (original === undefined) delete (document as unknown as Record<string, unknown>)["visibilityState"];
    else Object.defineProperty(document, "visibilityState", original);
  }
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

test("包车行程地图（M9P-20）：嵌入页和主站同一个组件——地图请求本站 /site/v1/itinerary-map（上车、经停、下车按顺序），列表编号 1–3；图出不来只留列表，不用 Leaflet", async () => {
  const charterDraft = { ...DRAFT_BODY, tab: "charter", waypoints: [{ name: "河口湖", lat: 35.498, lng: 138.769, stay_minutes: 60 }] };
  const charterQuote: SiteQuote = { ...quote, package: { hours: 8, km: 200 }, cancel_policy: { ...quote.cancel_policy, category: "charter" } };
  const legs = [
    { minutes: 100, meters: 98_000 },
    { minutes: 110, meters: 101_000 },
  ];
  const calls = stubApiWith((call) => {
    const path = call.url.pathname;
    if (path === `/site/v1/booking-drafts/${DRAFT}`) return json(200, { draft: charterDraft, expires_at: "2030-11-20T00:00:00Z", source_matches: true });
    if (path === "/site/v1/config") return json(200, config);
    if (path === "/site/v1/cities") return json(200, { items: [city] });
    if (path === "/site/v1/charter-packages") return json(200, { city: { id: CITY_ID, code: city.code, name: city.name, timezone: city.timezone }, items: [{ hours: 8 }] });
    if (path === "/site/v1/fx/reference") return json(200, { available: false, from: "JPY", to: "USD", rate: null, as_of: null, reason: "NO_RATE" });
    if (call.method === "POST" && path === "/site/v1/quotes") return json(200, { currency: "JPY", quotes: [charterQuote], unavailable: [], itinerary_route: { legs, drive_minutes: 210, stay_minutes: 60, total_minutes: 270, total_meters: 199_000 } });
    return null;
  });
  open(bookUrl);
  await screen.findByRole("heading", { name: "车型1" }, SLOW);
  const list = screen.getByRole("list", { name: "行程" });
  assert.deepEqual([...list.querySelectorAll("li")].map((item) => item.textContent), ["1 上车京王广场酒店10:00 出发", "行驶约 1 小时 40 分 · 98 公里2 经停河口湖预计 11:40 到 · 12:40 出发停留 1 小时", "行驶约 1 小时 50 分 · 101 公里3 下车东京站预计 14:30 到"]);
  const loader = await waitFor(() => document.querySelector<HTMLImageElement>(".itinerary-map__loader") ?? assert.fail("没有要行程地图"), SLOW);
  const url = new URL(loader.src, window.location.origin);
  assert.equal(url.origin, window.location.origin, "图片地址是本站");
  assert.equal(url.pathname, "/site/v1/itinerary-map");
  assert.deepEqual(url.searchParams.getAll("p"), ["35.690500,139.694800", "35.498000,138.769000", "35.681200,139.767100"]);
  fireEvent.error(loader);
  await waitFor(() => assert.equal(document.querySelector(".itinerary-map"), null));
  assert.ok(screen.getByRole("list", { name: "行程" }), "图出不来列表还在");
  assert.equal(document.querySelector(".leaflet-container"), null, "不用 Leaflet 后备图");
  assert.equal(calls.filter((call) => call.path.startsWith("/site/v1/route-map")).length, 0);
});

test("经停超过 10 个（13 个点以上，ADR 0099）：不请求行程地图，只显示列表和「经停较多，仅显示列表」；列表编号照常", async () => {
  const stops = Array.from({ length: 11 }, (_, i) => ({ name: `点${i + 1}`, lat: 35.4 + i / 100, lng: 138.8, stay_minutes: 30 }));
  const charterDraft = { ...DRAFT_BODY, tab: "charter", waypoints: stops };
  const charterQuote: SiteQuote = { ...quote, package: { hours: 12, km: 300 }, cancel_policy: { ...quote.cancel_policy, category: "charter" } };
  const calls = stubApiWith((call) => {
    const path = call.url.pathname;
    if (path === `/site/v1/booking-drafts/${DRAFT}`) return json(200, { draft: charterDraft, expires_at: "2030-11-20T00:00:00Z", source_matches: true });
    if (path === "/site/v1/config") return json(200, config);
    if (path === "/site/v1/cities") return json(200, { items: [city] });
    if (path === "/site/v1/charter-packages") return json(200, { city: { id: CITY_ID, code: city.code, name: city.name, timezone: city.timezone }, items: [{ hours: 12 }] });
    if (path === "/site/v1/fx/reference") return json(200, { available: false, from: "JPY", to: "USD", rate: null, as_of: null, reason: "NO_RATE" });
    if (call.method === "POST" && path === "/site/v1/quotes") return json(200, { currency: "JPY", quotes: [charterQuote], unavailable: [] });
    return null;
  });
  open(bookUrl);
  await screen.findByRole("heading", { name: "车型1" }, SLOW);
  const items = [...screen.getByRole("list", { name: "行程" }).querySelectorAll(".trip-stops__number")].map((node) => node.textContent);
  assert.deepEqual(items, Array.from({ length: 13 }, (_, i) => String(i + 1)));
  assert.ok(screen.getByText("经停较多，仅显示列表"));
  assert.equal(document.querySelector(".itinerary-map"), null);
  assert.equal(calls.filter((call) => call.path.startsWith("/site/v1/itinerary-map")).length, 0, "不请求地图");
});

test("iframe 390 宽（M9E-32，ADR 0100）：每一步的按钮在底部按钮条里、条留在文档流里；没收到带 top 的 viewport 时 sticky 贴底，收到后按宿主屏幕的下沿往上挪、不低于原位置；旧版组件脚本只发 height 时退回 sticky；换步后新条马上按最近的位置摆；不给 <html> 加底部空白", async () => {
  screenWidth = viewportWidth(390);
  stub();
  const actor = userEvent.setup();
  open(bookUrl);
  await screen.findByRole("heading", { name: "车型1" }, SLOW);
  const bar = (): HTMLElement => screen.getByRole("group", { name: "本步操作" });
  const slot = (): HTMLElement => bar().parentElement as HTMLElement;
  const shift = (): string => bar().style.getPropertyValue("--book-actionbar-shift");
  const viewport = (fields: Record<string, unknown>) =>
    act(() => void window.dispatchEvent(new MessageEvent("message", { data: { ns: "nozomi-booking", v: 1, ch: CH, type: "viewport", ...fields }, origin: HOST, source: parent as unknown as MessageEventSource })));
  const rect = (top: number, height: number) => () => ({ top, bottom: top + height, left: 0, right: 390, width: 390, height, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;

  assert.ok(slot().classList.contains("step-bar-slot--frame"), "嵌入页：不用 fixed");
  assert.equal(slot().hasAttribute("data-tracked"), false, "还没收到 viewport：sticky 贴底");
  assert.equal(document.documentElement.hasAttribute("data-book-actionbar"), false, "不给宿主看不到的 <html> 留底部空白");
  assert.equal(document.documentElement.hasAttribute("data-viewport-fit"), false, "iframe 里不改 viewport");
  const next = within(bar()).getByRole("button", { name: "下一步：填写乘客信息" }) as HTMLButtonElement;
  assert.equal(next.disabled, true);
  assert.equal(document.getElementById(next.getAttribute("aria-describedby") ?? "")?.textContent, "请先选择车型");

  slot().getBoundingClientRect = rect(2900, 80);
  bar().getBoundingClientRect = rect(2900, 80);
  await viewport({ height: 800, top: 300 });
  assert.equal(slot().hasAttribute("data-tracked"), true);
  const expected = frameBarShift({ frameTop: 300, hostHeight: 800, frameHeight: window.innerHeight, slotTop: 2900, barHeight: 80 });
  assert.ok(expected < 0);
  assert.equal(shift(), `${expected}px`, "条的下沿对齐 iframe 露在宿主屏幕上的那一截的底边");
  slot().getBoundingClientRect = rect(100, 80);
  await viewport({ height: 800, top: -2000 });
  assert.equal(shift(), "0px", "原位置已经在屏幕里：不往下挪");
  await viewport({ height: 800 });
  assert.equal(slot().hasAttribute("data-tracked"), false, "旧版组件脚本（不带 top）：退回 sticky");
  assert.equal(shift(), "");
  assert.equal(document.querySelector("main")?.getAttribute("data-host-viewport"), "800");

  await viewport({ height: 700, top: 50 });
  await actor.click(screen.getByRole("button", { name: "选择 车型1" }));
  await actor.click(within(bar()).getByRole("button", { name: "下一步：填写乘客信息" }));
  await screen.findByRole("heading", { name: "乘客信息", level: 2 });
  assert.ok(within(bar()).getByRole("button", { name: "下一步：核对订单" }).closest("form"), "第 3 步的条在表单里");
  assert.equal(slot().hasAttribute("data-tracked"), true, "换步后新条马上按最近收到的位置摆");
  assert.match(shift(), /^-?\d+px$/);
});

test("付款进 iframe（M9E-19）：下单后同一页直接挂付款表单（不再点按钮、不开新窗口），Stripe 表单用嵌入页语言；确认前发 modal{open:true}、确认后 modal{open:false}；return_url 回到嵌入订单页、带 key / host / 频道号、不带令牌；付完发 completed", async () => {
  screenWidth = viewportWidth(1023);
  let paid = false;
  const calls = stub({ payments: true, orderStatus: () => (paid ? "confirmed" : "pending_payment") });
  ORDER_POLL.ms = 50;
  const log: DriverLog = { mounts: [], confirms: [], postedAtConfirm: [], searchAtMount: [] };
  const actor = userEvent.setup();
  open(bookUrl, fakeDriver(log));
  await toReview(actor);
  await actor.click(screen.getByRole("checkbox", { name: /同意保存这次付款用的银行卡/ }));
  await actor.click(screen.getByRole("button", { name: "去付款 →" }));
  await screen.findByRole("heading", { name: `${EMBED_TEXTS.ja.orderNo} ${ORDER_NO}` }, SLOW);
  const payButton = await screen.findByRole("button", { name: "付款 18,000 JPY" }, SLOW);
  assert.equal(window.location.hash, `#ch=${CH}`, "订单页地址带频道号（# 后，不发给服务器），iframe 刷新后照样带得上");
  assert.deepEqual(log.mounts, [{ publishableKey: PK, clientSecret: SECRET, locale: "ja" }], "用下单应答里的 client_secret 直接挂（不再读一次），语言跟嵌入页");
  assert.equal(calls.filter((call) => call.path === "/site/v1/order/payment").length, 0);
  assert.ok(screen.getByRole("link", { name: new RegExp(`^${EMBED_TEXTS.ja.payInNewWindow}`) }).closest(".embed-book__pay-hint"), "新窗口只是退路");

  await actor.click(payButton);
  await actor.click(await screen.findByRole("button", { name: "确认支付" }));
  await waitFor(() => assert.equal(log.confirms.length, 1));
  const back = new URL(log.confirms[0] as string);
  assert.equal(back.origin + back.pathname, `${window.location.origin}/embed/book/order`);
  assert.deepEqual(Object.fromEntries(back.searchParams), { draft: DRAFT, key: KEY, lang: "ja", host: HOST, ch: CH });
  assert.doesNotMatch(log.confirms[0] as string, /nzo_/, "令牌不进 return_url");
  const modal = messages().filter((message) => message["type"] === "modal").map((message) => message["open"]);
  assert.deepEqual(modal, [true, false]);
  const openIndex = messages().findIndex((message) => message["type"] === "modal" && message["open"] === true);
  assert.ok(openIndex < (log.postedAtConfirm[0] ?? 0), "modal{open:true} 在确认付款之前发");
  assert.ok(await screen.findByText(/付款成功，等待确认/));

  paid = true;
  await waitFor(() => assert.equal(messages().filter((message) => message["type"] === "completed").length, 1), SLOW);
  assert.deepEqual(messages().find((message) => message["type"] === "completed"), { ns: "nozomi-booking", v: 1, ch: CH, type: "completed", orderNo: ORDER_NO, status: "submitted" });
  assert.equal(screen.queryByRole("heading", { name: "付款" }), null, "付完付款区块收起");
  assert.equal(sessionStorage.getItem(EMBED_ORDER_KEY), null);
  assert.doesNotMatch(JSON.stringify(posted), /nzo_|pi_3Embed|secret/, "消息里没有令牌、付款编号");
});

test("银行整页回跳回到嵌入订单页（M9E-19）：令牌从 nozomi.payment-return 按付款编号取回，地址里的 payment_intent / client_secret / 频道号马上去掉；回跳后发给宿主的消息仍带频道号；Stripe 说还在等付款时提示重新付", async () => {
  screenWidth = viewportWidth(390);
  let paid = false;
  stub({ payments: true, orderStatus: () => (paid ? "confirmed" : "pending_payment") });
  ORDER_POLL.ms = 50;
  sessionStorage.setItem("nozomi.payment-return", JSON.stringify({ intentId: "pi_3Embed", token: TOKEN, at: Date.now() }));
  const log: DriverLog = { mounts: [], confirms: [], postedAtConfirm: [], searchAtMount: [] };
  open(`/embed/book/order${query}&ch=${CH}&payment_intent=pi_3Embed&payment_intent_client_secret=${SECRET}&redirect_status=failed`, fakeDriver(log, { awaiting: true }));
  await screen.findByRole("heading", { name: `${EMBED_TEXTS.ja.orderNo} ${ORDER_NO}` }, SLOW);
  keepsFrameParams();
  for (const name of ["payment_intent", "payment_intent_client_secret", "redirect_status", "ch"]) assert.equal(new URLSearchParams(window.location.search).has(name), false, `地址里还有 ${name}`);
  assert.equal(sessionStorage.getItem("nozomi.payment-return"), null, "取回后立刻删掉");
  assert.ok(await screen.findByText("上次付款没有完成，请重新付款。", {}, SLOW));
  assert.deepEqual(log.mounts.map((mount) => mount.clientSecret), [SECRET]);
  assert.doesNotMatch(log.searchAtMount[0] ?? "", /payment_intent|redirect_status|ch=/, "挂 Stripe 之前地址里的回跳参数已经去掉");
  assert.equal(window.location.hash, `#ch=${CH}`, "频道号移到 # 后（iframe 再刷新也带得上）");
  assert.deepEqual(messages()[0], { ns: "nozomi-booking", v: 1, ch: CH, type: "modal", open: false }, "回跳回来先告诉宿主验证窗口已关（整页跳走时没发出去）");
  assert.ok(messages().length > 0);
  assert.ok(messages().every((message) => message["ch"] === CH), "回跳后的 ready / step 带得上频道号");
  paid = true;
  await waitFor(() => assert.equal(messages().filter((message) => message["type"] === "completed").length, 1), SLOW);
});
