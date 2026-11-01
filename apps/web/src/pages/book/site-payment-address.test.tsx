/**
 * 令牌不进 Stripe 读得到的地址（M3-13，ADR 0046）：真实的 `BrowserRouter` + 真实的 `createStripePaymentDriver` + Stripe.js 的假实现。
 * Stripe.js 会把所在页面的完整地址带进自己的 iframe（实测：`referrer=`、`url=`），还会把地址的哈希值发回 Stripe，所以挂表单之前令牌就得离开地址。
 * 覆盖：挂载和确认时读到的地址都没有令牌；刷新、从银行回跳、复制链接、贴别的链接；不挂表单的页面地址不动；付完刷新后地址放回去；最后一道防线。
 */
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { BrowserRouter } from "react-router";
import { App } from "../../App.tsx";
import type { SiteConfig, SiteOrder, SiteOrderEnvelope } from "../../api/site.ts";
import { PaymentDriverContext, PaymentLoadError, createStripePaymentDriver } from "../../lib/payment-driver.ts";
import { rememberPaymentReturn } from "../../lib/payment-return.ts";
import { type FakeStripeJs, fakeStripeJs } from "../../testing/fake-stripe-js.ts";
import { type ApiCall, json, resetBrowser, stubApiWith } from "../../testing/harness.tsx";

const TOKEN = `nzo_${"A".repeat(43)}`;
const OTHER_TOKEN = `nzo_${"B".repeat(43)}`;
const LINK = `/book/order#${TOKEN}`;
const CLIENT_SECRET = "pi_1_secret_2";
const stripeConfig: SiteConfig = { open: true, currency: "JPY", payments: { provider: "stripe", publishable_key: "pk_test_abc" }, support_phone: null, address_search: false, map_tiles: null };

const orderOf = (status: SiteOrder["status"], orderNo: string): SiteOrder =>
  ({
    id: `44444444-4444-4444-8444-${orderNo.slice(-12).padStart(12, "0")}`,
    order_no: orderNo,
    status,
    category: "airport_transfer",
    city_id: "11111111-1111-4111-8111-111111111111",
    place_id: "22222222-2222-4222-8222-222222222222",
    direction: "pickup",
    vehicle_group_id: "33333333-3333-4333-8333-333333333333",
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
    confirmed_at: status === "pending_payment" ? null : "2026-10-26T01:05:00.000Z",
    cancelled_at: null,
    cancel_reason: null,
    quote_id: "QT20261026ABCDEFGHIJ",
    channel_order_no: null,
    price: { total: { amount: "21780", currency: "JPY" }, fx: null },
    payment_status: status === "pending_payment" ? "requires_payment_method" : "succeeded",
    payment_due_at: "2026-10-26T01:30:00.000Z",
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

const envelope = (order: SiteOrder): SiteOrderEnvelope => ({
  order,
  timeline: [{ from_status: null, to_status: "pending_payment", reason: null, occurred_at: order.created_at }],
  names: { city: { code: "CTY-JP-TYO", name: { zh: "东京" } }, place: { code: "NRT", name: { zh: "成田机场" }, type: "airport" }, vehicle_group: { code: "VG-BIZ-7", name: { zh: "商务 7 座" }, seats: 7 } },
});

const ORDER_A = "NZ20261026ABCD2345";
const ORDER_B = "NZ20261026WXYZ6789";

beforeEach(() => window.history.replaceState(null, "", "/"));
afterEach(() => {
  resetBrowser();
  window.history.replaceState(null, "", "/");
});

const bearerOf = (call: ApiCall): string | undefined => call.headers["Authorization"] ?? call.headers["authorization"];

/** 打开真实的地址（`BrowserRouter` 读 `window.location`）。`status` 决定订单当时的状态，`payments` 决定配没配 Stripe。 */
function open(stripe: FakeStripeJs, address: string | null, options: { status?: () => SiteOrder["status"]; config?: SiteConfig } = {}): ApiCall[] {
  if (address !== null) window.history.replaceState(null, "", address);
  const calls = stubApiWith((call) => {
    if (call.url.pathname === "/site/v1/config") return json(200, options.config ?? stripeConfig);
    if (call.url.pathname === "/site/v1/order") {
      if (bearerOf(call) === `Bearer ${OTHER_TOKEN}`) return json(200, envelope(orderOf("pending_payment", ORDER_B)));
      return json(200, envelope(orderOf(options.status?.() ?? "pending_payment", ORDER_A)));
    }
    if (call.url.pathname === "/site/v1/order/payment") return json(200, { payment: { provider: "stripe", status: "requires_payment_method", client_secret: CLIENT_SECRET, publishable_key: "pk_test_abc" } });
    return null;
  });
  render(
    <PaymentDriverContext.Provider value={createStripePaymentDriver(stripe.load)}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </PaymentDriverContext.Provider>,
  );
  return calls;
}

/** 按 F5：页面重新开始，地址和这条历史记录的 state 留着，Stripe.js 没了（新文档）。 */
function closeDocument(): void {
  cleanup();
  delete (globalThis as { Stripe?: unknown }).Stripe;
}

const assertClean = (stripe: FakeStripeJs): void => {
  assert.ok(stripe.calls.addresses.length >= 3, "加载、建实例、挂表单都记下了地址");
  for (const address of stripe.calls.addresses) assert.ok(!address.includes(TOKEN) && !address.includes("nzo_"), `Stripe.js 读到了令牌：${address}`);
};
const address = (): string => `${window.location.pathname}${window.location.search}${window.location.hash}`;

test("带令牌的链接打开待付款的单：挂表单之前地址就没有令牌，Stripe.js 每一步（加载、建实例、挂表单、确认付款）都读不到；令牌只在请求头和这条历史记录里", async () => {
  const stripe = fakeStripeJs();
  const calls = open(stripe, LINK);
  const pay = await screen.findByRole("button", { name: "付款 21,780 JPY" });
  assert.equal(address(), "/book/order");
  assertClean(stripe);
  assert.equal(stripe.calls.mounted, 1);
  assert.equal((window.history.state as { usr: { orderToken: string } }).usr.orderToken, TOKEN);
  assert.equal(bearerOf(calls.find((call) => call.path.includes("/site/v1/order/payment")) as ApiCall), `Bearer ${TOKEN}`);

  const actor = userEvent.setup();
  await actor.click(pay);
  await actor.click(await screen.findByRole("button", { name: "确认支付" }));
  await screen.findByText(/付款成功，等待确认/);
  assertClean(stripe);
  assert.equal(stripe.calls.confirm[0]?.return_url, "http://localhost/book/order");
});

test("表单在屏时刷新：地址上一直没有令牌，订单和表单照常出来，不掉到「查订单」", async () => {
  const first = fakeStripeJs();
  open(first, LINK);
  await screen.findByRole("button", { name: "付款 21,780 JPY" });
  closeDocument();

  const again = fakeStripeJs();
  const calls = open(again, null);
  await screen.findByRole("button", { name: "付款 21,780 JPY" });
  assert.equal(address(), "/book/order");
  assertClean(again);
  assert.equal(bearerOf(calls.find((call) => call.path.includes("/site/v1/order")) as ApiCall), `Bearer ${TOKEN}`);
});

test("地址栏没有令牌时：页面说明情况，「复制订单链接」复制的是带令牌的完整链接；只复制地址栏的人打开是「查订单」，不报链接失效", async () => {
  const stripe = fakeStripeJs();
  open(stripe, LINK);
  await screen.findByRole("button", { name: "付款 21,780 JPY" });
  assert.ok(screen.getByText(/付款时地址栏不显示订单链接/));
  const actor = userEvent.setup();
  const written: string[] = [];
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => void written.push(text) } });
  await actor.click(screen.getByRole("button", { name: "复制订单链接" }));
  assert.deepEqual(written, [`http://localhost${LINK}`]);

  closeDocument();
  window.history.replaceState(null, "", "/book/order");
  open(fakeStripeJs(), null);
  assert.ok(await screen.findByRole("heading", { level: 1, name: "查订单" }));
  assert.equal(screen.queryByText(/订单链接无效或已过期/), null);
});

test("从银行回跳：按付款编号取回令牌后同样先离开地址，Stripe 加的参数不留；Stripe.js 读不到令牌也读不到 client_secret", async () => {
  rememberPaymentReturn("pi_1", TOKEN);
  const stripe = fakeStripeJs();
  open(stripe, `/book/order?payment_intent=pi_1&payment_intent_client_secret=${CLIENT_SECRET}&redirect_status=succeeded`);
  await screen.findByRole("button", { name: "付款 21,780 JPY" });
  assert.equal(address(), "/book/order");
  assertClean(stripe);
  for (const seen of stripe.calls.addresses) assert.ok(!seen.includes("client_secret"), seen);
  assert.equal(sessionStorage.getItem("nozomi.payment-return"), null);
});

test("不挂表单的页面地址不动：已确认的单、没配 Stripe 的待付款单，地址还是 #令牌，也不加载 Stripe.js", async () => {
  const paid = fakeStripeJs();
  open(paid, LINK, { status: () => "confirmed" });
  assert.ok(await screen.findByRole("heading", { level: 1, name: `订单 ${ORDER_A}` }));
  assert.equal(address(), LINK);
  assert.equal(paid.calls.mounted, 0);
  assert.equal(screen.queryByRole("button", { name: "复制订单链接" }), null);
  closeDocument();

  const closed = fakeStripeJs();
  open(closed, LINK, { config: { ...stripeConfig, payments: null } });
  assert.ok(await screen.findByText(/付款暂未开放/));
  assert.equal(address(), LINK);
  assert.equal(closed.calls.addresses.length, 0);
});

test("付完：这个文档里 Stripe.js 还在，地址不放回令牌；刷新后是新文档、订单不用再付，令牌放回地址，地址栏又能复制", async () => {
  let status: SiteOrder["status"] = "pending_payment";
  const stripe = fakeStripeJs();
  open(stripe, LINK, { status: () => status });
  const actor = userEvent.setup();
  await actor.click(await screen.findByRole("button", { name: "付款 21,780 JPY" }));
  status = "confirmed";
  await actor.click(await screen.findByRole("button", { name: "确认支付" }));
  await screen.findByText("付款成功，订单已确认。派车后这里会显示司机和车辆。", undefined, { timeout: 5000 });
  assert.equal(address(), "/book/order");
  assert.ok(screen.getByRole("button", { name: "复制订单链接" }));
  closeDocument();

  open(fakeStripeJs(), null, { status: () => "confirmed" });
  assert.ok(await screen.findByRole("heading", { level: 1, name: `订单 ${ORDER_A}` }));
  await waitFor(() => assert.equal(address(), LINK));
  assert.equal((window.history.state as { usr: { orderToken?: string } }).usr.orderToken, undefined);
  await waitFor(() => assert.ok(screen.queryByText("复制订单链接") === null));
});

test("表单在屏时贴了别的单的链接：认地址上的新令牌，新令牌同样离开地址，Stripe.js 读不到", async () => {
  const stripe = fakeStripeJs();
  open(stripe, LINK);
  await screen.findByRole("button", { name: "付款 21,780 JPY" });
  window.history.pushState(null, "", `/book/order#${OTHER_TOKEN}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
  assert.ok(await screen.findByRole("heading", { level: 1, name: `订单 ${ORDER_B}` }));
  await waitFor(() => assert.equal(address(), "/book/order"));
  assert.equal((window.history.state as { usr: { orderToken: string } }).usr.orderToken, OTHER_TOKEN);
  await screen.findByRole("button", { name: "付款 21,780 JPY" });
  assertClean(stripe);
});

test("最后一道防线：万一地址里还有令牌，付款组件直接报加载失败，Stripe.js 不加载", async () => {
  window.history.replaceState(null, "", LINK);
  const stripe = fakeStripeJs();
  await assert.rejects(createStripePaymentDriver(stripe.load).mount(document.createElement("div"), { publishableKey: "pk_test_abc", clientSecret: CLIENT_SECRET }), PaymentLoadError);
  assert.equal(stripe.calls.addresses.length, 0);
  assert.equal(stripe.calls.stripe.length, 0);
});
