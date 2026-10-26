/**
 * 官网页面的组件测试（M3-05，ADR 0032）：询价（暂未开放、没有城市、出错、校验、结果里没有供应商和结算价、报不出价的原因）→ 下单（校验、请求体、
 * 幂等键重试不变、报价过期）→ 订单页（令牌只在请求头、付款暂未开放 / 付款替身、我已落地、取消先看退多少、改单只给改了的字段、异议、找回、链接失效）。
 * 接口用测试替身；真实后端由集成测试 site.itest.ts 和端到端测试 e2e/site-booking.spec.ts 覆盖。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../App.tsx";
import type { SiteCity, SiteConfig, SiteOrder, SiteOrderEnvelope, SiteQuote } from "../../api/site.ts";
import { type PaymentDriver, PaymentDriverContext } from "../../lib/payment-driver.ts";
import { changeRequestOf } from "./OrderSections.tsx";
import { type ApiCall, apiError, assertAbsent, json, resetBrowser, stubApiWith } from "../../testing/harness.tsx";

afterEach(resetBrowser);

const CITY_ID = "11111111-1111-4111-8111-111111111111";
const AIRPORT_ID = "22222222-2222-4222-8222-222222222222";
const GROUP_ID = "33333333-3333-4333-8333-333333333333";
const ORDER_ID = "44444444-4444-4444-8444-444444444444";
const CHARGE_ID = "55555555-5555-4555-8555-555555555555";
const TOKEN = `nzo_${"A".repeat(43)}`;
const NEW_TOKEN = `nzo_${"B".repeat(43)}`;
const HOUR = 3_600_000;

const openConfig: SiteConfig = { open: true, currency: "JPY", payments: null, support_phone: null };
const city: SiteCity = { id: CITY_ID, code: "CTY-JP-TYO", name: { zh: "东京" }, timezone: "Asia/Tokyo", country_code: "JP", categories: ["airport_transfer"] };
const airport = { id: AIRPORT_ID, code: "NRT", name: { zh: "成田机场" }, location: { lng: 140.3887, lat: 35.7686 } };
const tiers = [{ min_hours_before: 48, fee_bp: 0 }, { min_hours_before: 24, fee_bp: 5000 }, { min_hours_before: 0, fee_bp: 10000 }];
const quote: SiteQuote = {
  quote_id: "QT20261026ABCDEFGHIJ",
  expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
  service_date: "2026-11-20",
  urgent: false,
  vehicle_group: { id: GROUP_ID, code: "VG-BIZ-7", name: { zh: "商务 7 座" }, grade: "business", seats: 7, sample_models: ["丰田埃尔法"], combos: [{ passengers: 6, luggage: 4 }] },
  package: null,
  price: { total: { amount: "21780", currency: "JPY" }, fx: null },
  free_wait_minutes: 90,
  cancel_policy: { category: "airport_transfer", level: "business", tiers },
};

const orderOf = (changes: Partial<SiteOrder> = {}): SiteOrder => ({
  id: ORDER_ID,
  order_no: "NZ20261026ABCD2345",
  status: "confirmed",
  category: "airport_transfer",
  city_id: CITY_ID,
  place_id: AIRPORT_ID,
  direction: "pickup",
  vehicle_group_id: GROUP_ID,
  package_hours: null,
  service_time: "2026-11-20T01:00:00.000Z",
  service_local: "2026-11-20T10:00",
  timezone: "Asia/Tokyo",
  service_date: "2026-11-20",
  urgent: false,
  passengers: 2,
  luggage: 1,
  pickup: null,
  dropoff: { lng: 139.7, lat: 35.6, address: "东京站八重洲口" },
  addons: [],
  driver_language: null,
  flight_no: "NH211",
  passenger: { name: "王小明", phone: "+819012345678", email: "guest@example.com" },
  messaging: null,
  notes: null,
  free_wait_minutes: 90,
  created_at: "2026-10-26T01:00:00.000Z",
  confirmed_at: "2026-10-26T01:05:00.000Z",
  cancelled_at: null,
  cancel_reason: null,
  quote_id: quote.quote_id,
  channel_order_no: null,
  price: { total: { amount: "21780", currency: "JPY" }, fx: null },
  payment_status: "succeeded",
  payment_due_at: "2026-10-26T01:30:00.000Z",
  winning_tenant: null,
  driver: null,
  vehicle: null,
  landing: { scheduled_at: "2026-11-20T01:00:00.000Z", guest_reported_at: null, driver_reported_at: null, landed_at: "2026-11-20T01:00:00.000Z", source: "scheduled", disagreement: false, delay_minutes: 0, within_delay_allowance: true },
  cancel_policy: { version: 0, category: "airport_transfer", level: "business", tiers },
  cancellation: null,
  free_cancel_available: false,
  changes: [],
  extra_charges: [],
  version: 3,
  ...changes,
});
const envelopeOf = (order: SiteOrder = orderOf()): SiteOrderEnvelope => ({
  order,
  timeline: [
    { from_status: null, to_status: "pending_payment", reason: null, occurred_at: order.created_at },
    ...(order.status === "pending_payment" ? [] : [{ from_status: "pending_payment" as const, to_status: "confirmed" as const, reason: "PAYMENT_SUCCEEDED", occurred_at: order.confirmed_at ?? order.created_at }]),
  ],
  names: { city: { code: "CTY-JP-TYO", name: { zh: "东京" } }, place: { code: "NRT", name: { zh: "成田机场" }, type: "airport" }, vehicle_group: { code: "VG-BIZ-7", name: { zh: "商务 7 座" }, seats: 7 } },
});

type Route = (call: ApiCall & { url: URL }) => Response | Promise<Response> | null;
const user = () => userEvent.setup();
const urlOf = (call: ApiCall): URL => new URL(call.path, "http://localhost");

function open(entry: string | { pathname: string; hash?: string; state?: unknown }, route: Route, driver?: PaymentDriver): ApiCall[] {
  const calls = stubApiWith(route);
  const app = (
    <MemoryRouter initialEntries={[entry]}>
      <App />
    </MemoryRouter>
  );
  render(driver === undefined ? app : <PaymentDriverContext.Provider value={driver}>{app}</PaymentDriverContext.Provider>);
  return calls;
}

const bookingRoutes = (extra: Route = () => null): Route => (call) => {
  if (call.method === "GET" && call.url.pathname === "/site/v1/config") return json(200, openConfig);
  if (call.method === "GET" && call.url.pathname === "/site/v1/cities") return json(200, { items: [city] });
  if (call.method === "GET" && call.url.pathname === `/site/v1/cities/${CITY_ID}/airports`) return json(200, { items: [airport] });
  if (call.method === "GET" && call.url.pathname === `/site/v1/cities/${CITY_ID}/places`) return json(200, { items: [] });
  return extra(call);
};

async function fillInquiry(actor: ReturnType<typeof user>): Promise<void> {
  await screen.findByRole("heading", { level: 1, name: "预订用车" });
  await waitFor(() => assert.equal((screen.getByLabelText(/^机场/) as HTMLSelectElement).value, AIRPORT_ID));
  await actor.type(screen.getByLabelText("下车地址或酒店名"), "东京站八重洲口");
  await actor.type(screen.getByLabelText(/^纬度/), "35.6812");
  await actor.type(screen.getByLabelText(/^经度/), "139.7671");
  const date = screen.getByLabelText("航班到达日期（当地）") as HTMLInputElement;
  await actor.clear(date);
  await actor.type(date, "2030-11-20");
  await actor.type(screen.getByLabelText("航班计划到达时间（当地）"), "10:00");
}

test("官网没开：说暂未开放，告诉已下单的客人去「查订单」；配置读不出来：说明并能重试", async () => {
  open("/book", (call) => (call.url.pathname === "/site/v1/config" ? json(200, { open: false, currency: null, payments: null, support_phone: null }) : null));
  assert.ok(await screen.findByRole("heading", { name: "暂未开放预订" }));
  assert.ok(screen.getByText(/查订单/, { selector: "p" }));
  assert.ok(screen.getByText(/GeoNames/));
  resetBrowser();
  let fail = true;
  open("/book", (call) => {
    if (call.url.pathname === "/site/v1/config") return fail ? apiError(500, "INTERNAL", "") : json(200, openConfig);
    if (call.url.pathname === "/site/v1/cities") return json(200, { items: [] });
    return null;
  });
  assert.ok(await screen.findByText("系统暂时无法打开页面，请稍后再试。"));
  fail = false;
  await user().click(screen.getByRole("button", { name: "重试" }));
  assert.ok(await screen.findByRole("heading", { name: "暂时没有可预订的城市" }));
});

test("询价：唯一的城市和机场自动选好；没填的标红；请求体是当地时间和坐标；结果有价格、免费等待、取消政策，没有供应商和结算价；选车带到下单页", async () => {
  const calls = open(
    "/book",
    bookingRoutes((call) => (call.method === "POST" && call.url.pathname === "/site/v1/quotes" ? json(200, { currency: "JPY", quotes: [quote], unavailable: [] }) : null)),
  );
  const actor = user();
  await screen.findByRole("heading", { level: 1, name: "预订用车" });
  await waitFor(() => assert.equal((screen.getByLabelText(/^机场/) as HTMLSelectElement).value, AIRPORT_ID));
  await actor.click(screen.getByRole("button", { name: "查询价格" }));
  assert.ok(await screen.findByText("请填写下车的地址或酒店名"));
  assert.ok(screen.getByText("请输入纬度"));
  assert.ok(screen.getByText("请选择时间"));
  assert.equal(calls.filter((call) => call.method === "POST").length, 0);

  await fillInquiry(actor);
  await actor.click(screen.getByRole("button", { name: "查询价格" }));
  const card = (await screen.findByRole("heading", { name: "商务 7 座" })).closest("li") as HTMLElement;
  assert.deepEqual(calls.find((call) => call.method === "POST")?.body, { category: "airport_transfer", city_id: CITY_ID, service_local: "2030-11-20T10:00", passengers: 2, luggage: 1, airport_id: AIRPORT_ID, direction: "pickup", address: { lat: 35.6812, lng: 139.7671 } });
  assert.ok(within(card).getByText("21,780 JPY"));
  assert.ok(within(card).getByText("90 分钟（从航班落地起算）"));
  assert.ok(within(card).getByText("用车前 48 小时以上取消免费；24–48 小时内取消收 50%；24 小时内取消收全额"));
  assert.doesNotMatch(document.body.textContent ?? "", /结算|加价|供应商/);
  await actor.click(within(card).getByRole("button", { name: "预订商务 7 座" }));
  assert.ok(await screen.findByRole("heading", { level: 1, name: "填写订单" }));
  assert.ok(screen.getByText("成田机场（NRT） → 东京站八重洲口"));
  assert.equal((screen.getByLabelText("下车地址或酒店名") as HTMLInputElement).value, "东京站八重洲口");
});

test("询价：报不出价时说明原因和怎么改；限速时说要等多久", async () => {
  let throttled = false;
  open(
    "/book",
    bookingRoutes((call) => {
      if (call.method !== "POST") return null;
      return throttled ? apiError(429, "RATE_LIMITED", "请求过于频繁", { retry_after_seconds: 40 }, { "retry-after": "40" }) : json(200, { currency: "JPY", quotes: [], unavailable: [{ vehicle_group_id: null, reasons: ["LEAD_TIME_TOO_SHORT", "OUT_OF_SERVICE_AREA"] }] });
    }),
  );
  const actor = user();
  await fillInquiry(actor);
  await actor.click(screen.getByRole("button", { name: "查询价格" }));
  assert.ok(await screen.findByRole("heading", { name: "没有可预订的车" }));
  assert.ok(screen.getByText("离用车时间太近了，请选晚一些的时间。"));
  assert.ok(screen.getByText("这个地址不在服务范围内，请换一个更靠近市区的地址。"));
  throttled = true;
  await actor.click(screen.getByRole("button", { name: "查询价格" }));
  assert.ok(await screen.findByText("操作太频繁了，请 40 秒后再试。"));
});

const checkoutEntry = () => ({ pathname: "/book/checkout", state: { quote, city, airport, draft: { cityId: CITY_ID, category: "airport_transfer", airportId: AIRPORT_ID, direction: "pickup", address: { address: "东京站八重洲口", coordinates: { lat: "35.681200", lng: "139.767100" }, placeId: null }, from: { address: "", coordinates: { lat: "", lng: "" }, placeId: null }, to: { address: "", coordinates: { lat: "", lng: "" }, placeId: null }, packageHours: "", date: "2030-11-20", time: "10:00", passengers: "2", luggage: "1" } } });

async function fillCheckout(actor: ReturnType<typeof user>): Promise<void> {
  await actor.type(screen.getByLabelText("乘车人姓名"), "王小明");
  await actor.type(screen.getByLabelText("手机号（带国家码）"), "+81 90-1234-5678");
  await actor.type(screen.getByLabelText("邮箱"), "guest@example.com");
  await actor.type(screen.getByLabelText("航班号"), "nh 211");
}

test("下单：接机必填航班号、手机号要带国家码、要同意保存支付方式；请求体只有该有的；网络失败再点用同一个幂等键；成功后到订单页，付款暂未开放", async () => {
  let attempts = 0;
  const calls = open(checkoutEntry(), (call) => {
    if (call.method === "POST" && call.url.pathname === "/site/v1/orders") {
      attempts += 1;
      if (attempts === 1) throw new TypeError("network");
      return json(201, { ...envelopeOf(orderOf({ status: "pending_payment", confirmed_at: null, payment_status: "creating", payment_due_at: new Date(Date.now() + 30 * 60_000).toISOString() })), payment: null, link: { token: TOKEN, expires_at: "2026-12-20T01:00:00.000Z" } });
    }
    if (call.method === "GET" && call.url.pathname === "/site/v1/config") return json(200, openConfig);
    if (call.method === "GET" && call.url.pathname === "/site/v1/order") return json(200, envelopeOf(orderOf({ status: "pending_payment", confirmed_at: null, payment_status: "creating", payment_due_at: new Date(Date.now() + 30 * 60_000).toISOString() })));
    return null;
  });
  const actor = user();
  await screen.findByRole("heading", { level: 1, name: "填写订单" });
  await actor.type(screen.getByLabelText("手机号（带国家码）"), "090-1234-5678");
  await actor.click(screen.getByRole("button", { name: /提交订单/ }));
  assert.ok(await screen.findByText("请填写乘车人姓名"));
  assert.ok(screen.getByText(/请填写带国家码的手机号/));
  assert.ok(screen.getByText("接机要填航班号，司机按航班落地时间等候"));
  assert.ok(screen.getByText("需要同意保存支付方式才能下单"));
  await actor.clear(screen.getByLabelText("手机号（带国家码）"));
  await fillCheckout(actor);
  await actor.click(screen.getByRole("checkbox", { name: /同意保存/ }));
  await actor.click(screen.getByRole("button", { name: /提交订单/ }));
  assert.ok(await screen.findByText(/网络连接失败/));
  await actor.click(screen.getByRole("button", { name: /提交订单/ }));
  await screen.findByRole("heading", { level: 1, name: "订单 NZ20261026ABCD2345" });
  const posts = calls.filter((call) => call.method === "POST");
  assert.equal(posts.length, 2);
  assert.equal(posts[0]?.headers["idempotency-key"], posts[1]?.headers["idempotency-key"], "重试用同一个幂等键");
  assert.deepEqual(posts[1]?.body, { quote_id: quote.quote_id, passenger: { name: "王小明", phone: "+81 90-1234-5678", email: "guest@example.com" }, flight_no: "nh 211", pickup_address: null, dropoff_address: "东京站八重洲口", messaging: null, notes: null, save_payment_method: true });
  assert.ok(screen.getByText(/订单已提交/));
  assert.ok(screen.getByText(/付款暂未开放/));
  assert.equal(calls.find((call) => urlOf(call).pathname === "/site/v1/order")?.headers["authorization"], `Bearer ${TOKEN}`);
  assert.equal(localStorage.length + sessionStorage.length, 0, "令牌不进任何存储");
});

test("下单：报价过期时说明并只给「重新查询价格」；直接打开下单页说先选车", async () => {
  open(checkoutEntry(), (call) => (call.method === "POST" ? apiError(410, "QUOTE_EXPIRED", "报价已过有效期，请重新询价") : null));
  const actor = user();
  await screen.findByRole("heading", { level: 1, name: "填写订单" });
  await fillCheckout(actor);
  await actor.click(screen.getByRole("checkbox", { name: /同意保存/ }));
  await actor.click(screen.getByRole("button", { name: /提交订单/ }));
  assert.ok(await screen.findByText("报价已经过了 30 分钟的有效期，请重新查询价格。"));
  assertAbsent(screen.queryByRole("button", { name: /提交订单/ }));
  assert.ok(screen.getByRole("link", { name: "重新查询价格" }));
  resetBrowser();
  open("/book/checkout", () => null);
  assert.ok(await screen.findByRole("heading", { name: "还没有选车" }));
});

test("订单页付款：Stripe 配置了时用付款组件（只拿 publishable key 和 client_secret），付款前页面内确认，付完刷新订单；组件没接入时说明订单保留到什么时候", async () => {
  const mounts: { publishableKey: string; clientSecret: string }[] = [];
  let confirmed = 0;
  const driver: PaymentDriver = {
    mount: async (_container, options) => {
      mounts.push(options);
      return { confirm: async () => ((confirmed += 1), { ok: true }), destroy: () => undefined };
    },
  };
  let paid = false;
  const pending = orderOf({ status: "pending_payment", confirmed_at: null, payment_status: "requires_payment_method", payment_due_at: "2026-10-26T01:30:00.000Z" });
  const calls = open(
    { pathname: "/book/order", hash: `#${TOKEN}` },
    (call) => {
      if (call.url.pathname === "/site/v1/config") return json(200, { ...openConfig, payments: { provider: "stripe", publishable_key: "pk_test_abc" } });
      if (call.url.pathname === "/site/v1/order") return json(200, envelopeOf(paid ? orderOf() : pending));
      if (call.url.pathname === "/site/v1/order/payment") return json(200, { payment: { provider: "stripe", status: "requires_payment_method", client_secret: "pi_1_secret_2", publishable_key: "pk_test_abc" } });
      return null;
    },
    driver,
  );
  const actor = user();
  await actor.click(await screen.findByRole("button", { name: "付款 21,780 JPY" }));
  assert.deepEqual(mounts, [{ publishableKey: "pk_test_abc", clientSecret: "pi_1_secret_2" }]);
  assert.ok(screen.getByText("确认支付 21,780 JPY？"));
  assert.equal(confirmed, 0, "先确认");
  paid = true;
  await actor.click(screen.getByRole("button", { name: "确认支付" }));
  await screen.findByText("付款成功，订单已确认");
  assert.equal(confirmed, 1);
  assert.equal(calls.filter((call) => urlOf(call).pathname === "/site/v1/order").length, 2);

  resetBrowser();
  open({ pathname: "/book/order", hash: `#${TOKEN}` }, (call) => {
    if (call.url.pathname === "/site/v1/config") return json(200, { ...openConfig, payments: { provider: "stripe", publishable_key: "pk_test_abc" } });
    if (call.url.pathname === "/site/v1/order") return json(200, envelopeOf(pending));
    if (call.url.pathname === "/site/v1/order/payment") return json(200, { payment: { provider: "stripe", status: "requires_payment_method", client_secret: "pi_1_secret_2", publishable_key: "pk_test_abc" } });
    return null;
  });
  assert.ok(await screen.findByText(/在线付款还在接入中，订单已为您保留到当地时间 (2026年)?10月26日（周一）10:30/));
});

test("我已落地：离计划到达 3 小时以上不出按钮、写明几点起能点；能点时先确认，提交后显示确认的时间、按钮消失", async () => {
  const later = orderOf({ landing: { ...orderOf().landing!, scheduled_at: new Date(Date.now() + 5 * HOUR).toISOString() } });
  open({ pathname: "/book/order", hash: `#${TOKEN}` }, (call) => (call.url.pathname === "/site/v1/config" ? json(200, openConfig) : call.url.pathname === "/site/v1/order" ? json(200, envelopeOf(later)) : null));
  assert.ok(await screen.findByText(/起可以点/));
  assertAbsent(screen.queryByRole("button", { name: "我已落地" }));

  resetBrowser();
  const scheduled = new Date(Date.now() - 10 * 60_000).toISOString();
  const now = orderOf({ status: "assigned", landing: { ...orderOf().landing!, scheduled_at: scheduled } });
  const reportedAt = new Date().toISOString();
  const calls = open({ pathname: "/book/order", hash: `#${TOKEN}` }, (call) => {
    if (call.url.pathname === "/site/v1/config") return json(200, openConfig);
    if (call.url.pathname === "/site/v1/order") return json(200, envelopeOf(now));
    if (call.method === "POST" && call.url.pathname === "/site/v1/order/landed") return json(200, envelopeOf({ ...now, landing: { ...now.landing!, guest_reported_at: reportedAt, landed_at: reportedAt, source: "guest", delay_minutes: 10 } }));
    return null;
  });
  const actor = user();
  await actor.click(await screen.findByRole("button", { name: "我已落地" }));
  assert.ok(screen.getByText("确认您的航班已经落地？时间按现在记录，提交后不能修改。"));
  assert.equal(calls.filter((call) => call.method === "POST").length, 0);
  await actor.click(screen.getByRole("button", { name: "确认已落地" }));
  assert.ok(await screen.findByText(/您已确认落地：当地时间/));
  assert.ok(screen.getByText("已确认落地，司机会按这个时间开始免费等待。"));
  assertAbsent(screen.queryByRole("button", { name: "我已落地" }));
  assert.equal(calls.find((call) => call.method === "POST")?.headers["authorization"], `Bearer ${TOKEN}`);
});

test("取消：先算按政策退多少、页面内确认后才取消；取消后显示退款；不取消就收起", async () => {
  let cancelled = false;
  const calls = open({ pathname: "/book/order", hash: `#${TOKEN}` }, (call) => {
    if (call.url.pathname === "/site/v1/config") return json(200, openConfig);
    if (call.url.pathname === "/site/v1/order") return json(200, envelopeOf());
    if (call.url.pathname === "/site/v1/order/cancel-fee") return json(200, { cancellable: true, stage: "paid", reason: "GUEST_REQUEST", tier_index: 1, hours_before_service: 30, fee_bp: 5000, paid: { amount: "21780", currency: "JPY" }, fee: { amount: "10890", currency: "JPY" }, refund: { amount: "10890", currency: "JPY" }, policy: orderOf().cancel_policy });
    if (call.method === "POST" && call.url.pathname === "/site/v1/order/cancel") {
      cancelled = true;
      return json(200, { ...envelopeOf(orderOf({ status: "cancelled", cancel_reason: "GUEST_REQUEST", cancelled_at: new Date().toISOString(), cancellation: { reason: "GUEST_REQUEST", fee_bp: 5000, fee: { amount: "10890", currency: "JPY" }, refund: { amount: "10890", currency: "JPY" }, refund_status: "pending" } })), replayed: false });
    }
    return null;
  });
  const actor = user();
  await actor.click(await screen.findByRole("button", { name: "取消订单" }));
  assert.ok(await screen.findByText("按取消政策，现在取消扣 10,890 JPY，退还 10,890 JPY，原路退回银行卡。"));
  await actor.click(screen.getByRole("button", { name: "不取消了" }));
  assert.equal(cancelled, false);
  await actor.click(screen.getByRole("button", { name: "取消订单" }));
  await actor.click(await screen.findByRole("button", { name: "确认取消订单" }));
  assert.ok(await screen.findByText("订单已取消。"));
  assert.ok(screen.getByText("10,890 JPY（退款处理中（几天内到账））"));
  assert.ok(calls.some((call) => urlOf(call).search === "?reason=GUEST_REQUEST"));
  assert.deepEqual(calls.find((call) => call.method === "POST")?.body, { reason: "GUEST_REQUEST" });
});

test("改单：只给改了的字段、带 If-Match；没改就说没有改动；改时间换成带时区的时刻", async () => {
  assert.deepEqual(changeRequestOf(orderOf(), { name: "王小明", phone: "+819012345678", email: "guest@example.com", flightNo: "NH211", pickupAddress: "", dropoffAddress: "东京站八重洲口", notes: "", passengers: "2", luggage: "1", date: "2026-11-20", time: "10:00" }), {});
  assert.deepEqual(changeRequestOf(orderOf(), { name: "王小明", phone: "+819012345678", email: "guest@example.com", flightNo: "NH211", pickupAddress: "", dropoffAddress: "东京站八重洲口", notes: "", passengers: "3", luggage: "1", date: "2026-11-20", time: "11:30" }), { passengers: 3, service_time: "2026-11-20T02:30:00.000Z" });
  const calls = open({ pathname: "/book/order", hash: `#${TOKEN}` }, (call) => {
    if (call.url.pathname === "/site/v1/config") return json(200, openConfig);
    if (call.url.pathname === "/site/v1/order" && call.method === "GET") return json(200, envelopeOf());
    if (call.url.pathname === "/site/v1/order" && call.method === "PATCH") {
      const changed = orderOf({ flight_no: "JL5", version: 4, changes: [{ id: "c1", status: "applied", fields: ["flight_no"], before: { flight_no: "NH211" }, after: { flight_no: "JL5" }, price_difference: null, confirm_due_at: null, requested_at: new Date().toISOString(), decided_at: new Date().toISOString() }] });
      return json(200, { ...envelopeOf(changed), change: changed.changes[0] });
    }
    return null;
  });
  const actor = user();
  await actor.click(await screen.findByRole("button", { name: "修改订单" }));
  await actor.click(screen.getByRole("button", { name: "提交修改" }));
  assert.ok(await screen.findByText("没有改动。"));
  const flight = screen.getAllByLabelText("航班号").at(-1) as HTMLInputElement;
  await actor.clear(flight);
  await actor.type(flight, "JL5");
  await actor.click(screen.getByRole("button", { name: "提交修改" }));
  assert.ok(await screen.findByText("已修改。"));
  const patch = calls.find((call) => call.method === "PATCH");
  assert.deepEqual(patch?.body, { flight_no: "JL5" });
  assert.equal(patch?.headers["if-match"], '"3"');
  assert.ok(screen.getByText("航班号", { selector: ".site-changes__item span" }));
});

test("事后加收：显示客人要付的金额和异议截止时间；异议要写理由；提交后不扣款", async () => {
  const charge = { id: CHARGE_ID, type: "waiting" as const, amount: { amount: "2200", currency: "JPY" }, description: "等了 40 分钟", status: "in_window" as const, submitted_at: new Date().toISOString(), dispute_until: "2026-11-22T01:00:00.000Z", dispute_open: true, disputed_at: null, charged_at: null };
  const completed = orderOf({ status: "completed", extra_charges: [charge] });
  const calls = open({ pathname: "/book/order", hash: `#${TOKEN}` }, (call) => {
    if (call.url.pathname === "/site/v1/config") return json(200, openConfig);
    if (call.url.pathname === "/site/v1/order") return json(200, envelopeOf(completed));
    if (call.method === "POST" && call.url.pathname === `/site/v1/order/extra-charges/${CHARGE_ID}/dispute`) {
      const disputed = { ...charge, status: "disputed" as const, dispute_open: false, disputed_at: new Date().toISOString() };
      return json(200, { ...envelopeOf({ ...completed, extra_charges: [disputed] }), extra_charge: disputed });
    }
    return null;
  });
  const actor = user();
  assert.ok(await screen.findByText("2,200 JPY"));
  assert.ok(screen.getByText(/当地时间 (2026年)?11月22日（周日）10:00 前提出/));
  await actor.click(screen.getByRole("button", { name: "提异议" }));
  await actor.click(screen.getByRole("button", { name: "提交异议" }));
  assert.ok(await screen.findByText("请写一下为什么有异议，如「司机没有等那么久」"));
  await actor.type(screen.getByLabelText("异议的理由"), "司机没有等那么久");
  await actor.click(screen.getByRole("button", { name: "提交异议" }));
  assert.ok(await screen.findByText("已提异议，平台审核中"));
  assert.deepEqual(calls.find((call) => call.method === "POST")?.body, { reason: "司机没有等那么久" });
  assertAbsent(screen.queryByRole("button", { name: "取消订单" }));
});

test("查订单：没有令牌时填订单号和邮箱找回，换成新链接再读订单；链接失效时提示重新查找；找不到时不说是哪一项不对", async () => {
  let found = true;
  const calls = open("/book/order", (call) => {
    if (call.url.pathname === "/site/v1/config") return json(200, openConfig);
    if (call.method === "POST" && call.url.pathname === "/site/v1/orders/lookup") return found ? json(200, { link: { token: NEW_TOKEN, expires_at: "2026-12-20T01:00:00.000Z" } }) : apiError(404, "ORDER_NOT_FOUND", "没有找到");
    if (call.url.pathname === "/site/v1/order") return call.headers["authorization"] === `Bearer ${NEW_TOKEN}` ? json(200, envelopeOf()) : apiError(401, "ORDER_LINK_INVALID", "链接无效");
    return null;
  });
  const actor = user();
  await screen.findByRole("heading", { level: 1, name: "查订单" });
  await actor.click(screen.getByRole("button", { name: "查找订单" }));
  assert.ok(await screen.findByText(/订单号是 NZ 开头的 18 位/));
  await actor.type(screen.getByLabelText("订单号"), "nz20261026abcd2345");
  await actor.type(screen.getByLabelText("下单时的邮箱或手机号"), "guest@example.com");
  found = false;
  await actor.click(screen.getByRole("button", { name: "查找订单" }));
  assert.ok(await screen.findByText("没有找到这张订单：请核对订单号，以及下单时填的邮箱或手机号。"));
  found = true;
  await actor.click(screen.getByRole("button", { name: "查找订单" }));
  await screen.findByRole("heading", { level: 1, name: "订单 NZ20261026ABCD2345" });
  assert.deepEqual(calls.filter((call) => call.method === "POST").at(-1)?.body, { order_no: "NZ20261026ABCD2345", contact: "guest@example.com" });

  resetBrowser();
  open({ pathname: "/book/order", hash: `#${TOKEN}` }, (call) => (call.url.pathname === "/site/v1/config" ? json(200, openConfig) : call.url.pathname === "/site/v1/order" ? apiError(401, "ORDER_LINK_INVALID", "链接无效") : null));
  assert.ok(await screen.findByText("订单链接无效或已过期，请用订单号和下单时的邮箱或手机号重新查找。"));
  assert.ok(screen.getByRole("button", { name: "查找订单" }));
});

test("查订单：链接格式不对（# 后面不是令牌）也提示链接无效或已过期，不去请求订单；只有 # 没有内容时只显示表单", async () => {
  for (const hash of ["#bogus-link-value", `#${TOKEN.slice(0, -1)}`, `#${TOKEN}x`]) {
    resetBrowser();
    const calls = open({ pathname: "/book/order", hash }, (call) => (call.url.pathname === "/site/v1/config" ? json(200, openConfig) : null));
    await screen.findByRole("heading", { level: 1, name: "查订单" });
    assert.ok(screen.getByText("订单链接无效或已过期，请用订单号和下单时的邮箱或手机号重新查找。"), hash);
    assert.equal(calls.filter((call) => urlOf(call).pathname === "/site/v1/order").length, 0, hash);
  }
  for (const hash of ["", "#", "# "]) {
    resetBrowser();
    open({ pathname: "/book/order", hash }, (call) => (call.url.pathname === "/site/v1/config" ? json(200, openConfig) : null));
    await screen.findByRole("heading", { level: 1, name: "查订单" });
    assertAbsent(screen.queryByText(/订单链接无效或已过期/));
  }
});

test("页面规范（M3-09，docs/design/pages/site-booking.md）：格式示例写在帮助文字里、不当占位文字；没勾同意时提示关联到复选框；取消订单的入口是次要按钮，页面内确认时才是危险按钮", async () => {
  open(checkoutEntry(), () => null);
  const actor = user();
  await screen.findByRole("heading", { level: 1, name: "填写订单" });
  const phone = screen.getByLabelText("手机号（带国家码）") as HTMLInputElement;
  const flight = screen.getByLabelText("航班号") as HTMLInputElement;
  assert.equal(phone.placeholder, "");
  assert.equal(flight.placeholder, "");
  assert.match(document.getElementById(phone.getAttribute("aria-describedby") ?? "")?.textContent ?? "", /如 \+81 90-1234-5678/);
  assert.match(document.getElementById(flight.getAttribute("aria-describedby") ?? "")?.textContent ?? "", /如 NH211/);
  assert.ok(screen.getByText("总价（按车计价，已含高速费和停车费）"));
  await actor.click(screen.getByRole("button", { name: /提交订单/ }));
  const consent = screen.getByRole("checkbox", { name: /同意保存/ });
  assert.equal(consent.getAttribute("aria-invalid"), "true");
  assert.equal(document.getElementById((consent.getAttribute("aria-describedby") ?? "").split(" ")[0] ?? "")?.textContent, "需要同意保存支付方式才能下单");

  resetBrowser();
  open("/book/order", (call) => (call.url.pathname === "/site/v1/config" ? json(200, openConfig) : null));
  const orderNo = (await screen.findByLabelText("订单号")) as HTMLInputElement;
  assert.equal(orderNo.placeholder, "");
  assert.match(document.getElementById(orderNo.getAttribute("aria-describedby") ?? "")?.textContent ?? "", /NZ 开头的 18 位/);

  resetBrowser();
  open({ pathname: "/book/order", hash: `#${TOKEN}` }, (call) => {
    if (call.url.pathname === "/site/v1/config") return json(200, openConfig);
    if (call.url.pathname === "/site/v1/order") return json(200, envelopeOf());
    if (call.url.pathname === "/site/v1/order/cancel-fee") return json(200, { cancellable: true, stage: "paid", reason: "GUEST_REQUEST", tier_index: 0, hours_before_service: 60, fee_bp: 0, paid: { amount: "21780", currency: "JPY" }, fee: { amount: "0", currency: "JPY" }, refund: { amount: "21780", currency: "JPY" }, policy: orderOf().cancel_policy });
    return null;
  });
  const entry = await screen.findByRole("button", { name: "取消订单" });
  assert.doesNotMatch(entry.className, /button--danger/);
  await actor.click(entry);
  assert.match((await screen.findByRole("button", { name: "确认取消订单" })).className, /button--danger/);
});
