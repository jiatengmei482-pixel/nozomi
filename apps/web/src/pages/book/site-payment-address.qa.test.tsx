/**
 * QA（M3-13，ADR 0046）：会丢失订单入口、把令牌带回地址、把上一张单带到新单的路径。开发的 site-payment-address.test.tsx 没有覆盖的部分。
 * 真实的 `BrowserRouter` + 真实的 `createStripePaymentDriver` + Stripe.js 的假实现；接口是替身，令牌和订单都是测试里构造的虚构值。
 */
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { BrowserRouter } from "react-router";
import { App } from "../../App.tsx";
import type { SiteConfig, SiteOrder, SiteOrderEnvelope } from "../../api/site.ts";
import { PaymentDriverContext, PaymentLoadError, createStripePaymentDriver } from "../../lib/payment-driver.ts";
import { rememberPaymentReturn } from "../../lib/payment-return.ts";
import { type FakeStripeJs, fakeStripeJs } from "../../testing/fake-stripe-js.ts";
import { type ApiCall, apiError, deferred, json, resetBrowser, stubApiWith } from "../../testing/harness.tsx";

const TOKEN_A = `nzo_${"A".repeat(43)}`;
const TOKEN_B = `nzo_${"B".repeat(43)}`;
const TOKEN_DEAD = `nzo_${"D".repeat(43)}`;
const ORDER_A = "NZ20261026AAAA2345";
const ORDER_B = "NZ20261026BBBB6789";
const SECRET_A = "pi_a_secret_a";
const SECRET_B = "pi_b_secret_b";
const PAY_A = "付款 21,780 JPY";
const PAY_B = "付款 33,000 JPY";
const LINK_A = `/book/order#${TOKEN_A}`;
const LINK_B = `/book/order#${TOKEN_B}`;
const stripeConfig: SiteConfig = { open: true, currency: "JPY", payments: { provider: "stripe", publishable_key: "pk_test_abc" }, support_phone: null, address_search: false, map_tiles: null };

type Status = SiteOrder["status"];

const orderOf = (status: Status, orderNo: string, amount: string): SiteOrder =>
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
    dropoff: { lng: 139.7, lat: 35.6, address: "虚构地址一丁目" },
    addons: [],
    driver_language: null,
    flight_no: "NH211",
    passenger: { name: "虚构客人", phone: "+819000000000", email: "guest@example.com" },
    messaging: null,
    notes: null,
    free_wait_minutes: 90,
    created_at: "2026-10-26T01:00:00.000Z",
    confirmed_at: status === "pending_payment" ? null : "2026-10-26T01:05:00.000Z",
    cancelled_at: status === "cancelled" ? "2026-10-26T01:06:00.000Z" : null,
    cancel_reason: status === "cancelled" ? "GUEST_REQUEST" : null,
    quote_id: "QT20261026ABCDEFGHIJ",
    channel_order_no: null,
    price: { total: { amount, currency: "JPY" }, fx: null },
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
  names: { city: { code: "CTY-JP-TYO", name: { zh: "东京" } }, place: { code: "NRT", name: { zh: "成田机场" }, type: "airport" }, vehicle_group: { code: "VG-BIZ-7", name: { zh: "商务 7 座" }, seats: 7, sample_models: [], combos: [{ passengers: 6, luggage: 4 }] } },
});

const bearerOf = (call: ApiCall): string | undefined => call.headers["Authorization"] ?? call.headers["authorization"];
const address = (): string => `${window.location.pathname}${window.location.search}${window.location.hash}`;
const heldToken = (): string | undefined => (window.history.state as { usr?: { orderToken?: string } } | null)?.usr?.orderToken;

interface World {
  statusA: Status;
  statusB: Status;
  /** 不为 null 时，读 B 这张单要等它 */
  holdB: Promise<Response> | null;
  orderFails: boolean;
  configFails: boolean;
  config: SiteConfig;
  calls: ApiCall[];
}

function worldOf(overrides: Partial<World> = {}): World {
  return { statusA: "pending_payment", statusB: "pending_payment", holdB: null, orderFails: false, configFails: false, config: stripeConfig, calls: [], ...overrides };
}

function serve(world: World): void {
  world.calls = stubApiWith((call) => {
    const bearer = bearerOf(call);
    const path = call.url.pathname;
    if (path === "/site/v1/config") return world.configFails ? apiError(500, "INTERNAL", "出错了") : json(200, world.config);
    if (bearer === `Bearer ${TOKEN_DEAD}`) return apiError(401, "ORDER_TOKEN_INVALID", "链接无效");
    const isB = bearer === `Bearer ${TOKEN_B}`;
    if (path === "/site/v1/order") {
      if (world.orderFails) return apiError(500, "INTERNAL", "出错了");
      if (isB && world.holdB !== null) return world.holdB;
      return json(200, envelope(isB ? orderOf(world.statusB, ORDER_B, "33000") : orderOf(world.statusA, ORDER_A, "21780")));
    }
    if (path === "/site/v1/order/payment") return json(200, { payment: { provider: "stripe", status: "requires_payment_method", client_secret: isB ? SECRET_B : SECRET_A, publishable_key: "pk_test_abc" } });
    if (path === "/site/v1/order/cancel-fee") return json(200, { cancellable: true, fee: { amount: "0", currency: "JPY" }, refund: { amount: "0", currency: "JPY" }, percent_bp: 0, reason: "GUEST_REQUEST" });
    if (path === "/site/v1/order/cancel") {
      world.statusA = "cancelled";
      return json(200, { ...envelope(orderOf("cancelled", ORDER_A, "21780")), replayed: false });
    }
    return null;
  });
}

function open(stripe: FakeStripeJs, at: string | null, world: World): World {
  if (at !== null) window.history.replaceState(null, "", at);
  serve(world);
  render(
    <PaymentDriverContext.Provider value={createStripePaymentDriver(stripe.load)}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </PaymentDriverContext.Provider>,
  );
  return world;
}

/** 客人在地址栏贴一个链接：同一个文档里地址的 `#` 变了，新的一条历史记录，state 是空的。 */
function paste(link: string): void {
  window.history.pushState(null, "", link);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** 按 F5：地址和这条历史记录的 state 留着，Stripe.js 没了。 */
function closeDocument(): void {
  cleanup();
  delete (globalThis as { Stripe?: unknown }).Stripe;
}

const orderHeading = (no: string) => screen.findByRole("heading", { level: 1, name: `订单 ${no}` });
const onPage = (text: string | RegExp): boolean => (document.body.textContent ?? "").match(text) !== null;
const settle = (ms = 200): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => window.history.replaceState(null, "", "/"));
afterEach(() => {
  resetBrowser();
  window.history.replaceState(null, "", "/");
});

// ---- 同一个标签页换另一张单 ----

test("表单在屏时贴 B 的链接、B 还没读回来：页面不能还显示 A 的单（订单号、金额、付款按钮）", async () => {
  const hold = deferred();
  open(fakeStripeJs(), LINK_A, worldOf({ holdB: hold.promise }));
  await screen.findByRole("button", { name: PAY_A });
  paste(LINK_B);
  await settle();
  const stale = onPage(ORDER_A);
  hold.resolve(json(200, envelope(orderOf("pending_payment", ORDER_B, "33000"))));
  await orderHeading(ORDER_B);
  assert.equal(stale, false, "令牌已经是 B，页面还显示 A 的订单号");
});

test("贴 B 的链接、B 还没读回来：不能拿 B 的令牌给 A 的付款区块取付款、挂 B 的表单（客人看着 A 的金额付 B 的钱）", async () => {
  const hold = deferred();
  const stripe = fakeStripeJs();
  const world = open(stripe, LINK_A, worldOf({ holdB: hold.promise }));
  await screen.findByRole("button", { name: PAY_A });
  paste(LINK_B);
  await settle();
  const earlyPayment = world.calls.filter((call) => call.path.includes("/order/payment") && bearerOf(call) === `Bearer ${TOKEN_B}`).length;
  const mountedB = stripe.calls.elements.filter((item) => item.clientSecret === SECRET_B).length;
  hold.resolve(json(200, envelope(orderOf("pending_payment", ORDER_B, "33000"))));
  await orderHeading(ORDER_B);
  assert.deepEqual([earlyPayment, mountedB], [0, 0], "B 的单还没读回来，付款区块已经用 B 的令牌取付款、挂了 B 的 client_secret");
});

test("贴 B 的链接、B 还没读回来：A 的页面上点「取消订单」不能把请求发给 B", async () => {
  const hold = deferred();
  const world = open(fakeStripeJs(), LINK_A, worldOf({ holdB: hold.promise }));
  await screen.findByRole("button", { name: PAY_A });
  paste(LINK_B);
  await settle();
  const button = screen.queryByRole("button", { name: "取消订单" });
  if (button !== null) {
    await userEvent.setup().click(button);
    await settle();
  }
  const sent = world.calls.filter((call) => call.path.includes("/order/cancel") && bearerOf(call) === `Bearer ${TOKEN_B}`).length;
  hold.resolve(json(200, envelope(orderOf("pending_payment", ORDER_B, "33000"))));
  await orderHeading(ORDER_B);
  assert.equal(sent, 0, "页面显示的是 A，取消费的请求却带着 B 的令牌");
});

test("A 待付款时贴已确认的 B：不能在 B 上显示「付款成功」，这次没有付过款", async () => {
  open(fakeStripeJs(), LINK_A, worldOf({ statusB: "confirmed" }));
  await screen.findByRole("button", { name: PAY_A });
  paste(LINK_B);
  await orderHeading(ORDER_B);
  assert.equal(onPage("付款成功，订单已确认"), false, "只是换了一张单，页面却说付款成功");
});

test("A 付完显示成功后贴 B（同样已确认）：成功提示不带到 B 上", async () => {
  const world = worldOf({ statusB: "confirmed" });
  open(fakeStripeJs(), LINK_A, world);
  const actor = userEvent.setup();
  await actor.click(await screen.findByRole("button", { name: PAY_A }));
  world.statusA = "confirmed";
  await actor.click(await screen.findByRole("button", { name: "确认支付" }));
  await screen.findByText("付款成功，订单已确认。派车后这里会显示司机和车辆。", undefined, { timeout: 5000 });
  paste(LINK_B);
  await orderHeading(ORDER_B);
  assert.equal(onPage("付款成功，订单已确认"), false, "A 的成功提示留在了 B 上");
});

test("A 付完（这个文档加载过 Stripe.js，A 已不用付款）后贴已确认的 B：B 的令牌同样离开地址，不留在 Stripe.js 读得到的地方", async () => {
  const world = worldOf({ statusB: "confirmed" });
  open(fakeStripeJs(), LINK_A, world);
  const actor = userEvent.setup();
  await actor.click(await screen.findByRole("button", { name: PAY_A }));
  world.statusA = "confirmed";
  await actor.click(await screen.findByRole("button", { name: "确认支付" }));
  await screen.findByText("付款成功，订单已确认。派车后这里会显示司机和车辆。", undefined, { timeout: 5000 });
  paste(LINK_B);
  await orderHeading(ORDER_B);
  await waitFor(() => assert.equal(address(), "/book/order"));
  assert.equal(heldToken(), TOKEN_B);
});

test("两张单之间前进后退：每一步内容、请求头、付款 client_secret 都是当前这张的，地址一直没有令牌，Stripe.js 读不到", async () => {
  const stripe = fakeStripeJs();
  const world = open(stripe, LINK_A, worldOf());
  await screen.findByRole("button", { name: PAY_A });
  paste(LINK_B);
  await screen.findByRole("button", { name: PAY_B });
  await waitFor(() => assert.equal(address(), "/book/order"));
  assert.equal(heldToken(), TOKEN_B);

  window.history.back();
  await screen.findByRole("button", { name: PAY_A });
  assert.ok(await orderHeading(ORDER_A));
  assert.equal(heldToken(), TOKEN_A);
  assert.equal(address(), "/book/order");

  window.history.forward();
  await screen.findByRole("button", { name: PAY_B });
  assert.ok(await orderHeading(ORDER_B));
  assert.equal(heldToken(), TOKEN_B);
  assert.equal(address(), "/book/order");

  assert.equal(stripe.calls.elements.at(-1)?.clientSecret, SECRET_B);
  for (const seen of stripe.calls.addresses) assert.ok(!seen.includes("nzo_"), seen);
  for (const call of world.calls) assert.ok(!call.path.includes("nzo_"), call.path);
  assert.equal(onPage("付款成功"), false);
});

test("表单在屏时贴失效的链接：报链接失效，不显示 A 的内容；地址和 Stripe.js 都没有令牌；后退回到 A", async () => {
  const stripe = fakeStripeJs();
  open(stripe, LINK_A, worldOf());
  await screen.findByRole("button", { name: PAY_A });
  paste(`/book/order#${TOKEN_DEAD}`);
  await screen.findByText(/订单链接无效或已过期/);
  assert.equal(onPage(ORDER_A), false);
  assert.equal(address(), "/book/order", "这个文档加载过 Stripe.js，失效的令牌也不能留在地址");
  window.history.back();
  assert.ok(await orderHeading(ORDER_A));
  await screen.findByRole("button", { name: PAY_A });
});

test("表单在屏时点导航的「查订单」：是空白的查订单，看不到 A；后退回到 A，令牌还在", async () => {
  open(fakeStripeJs(), LINK_A, worldOf());
  await screen.findByRole("button", { name: PAY_A });
  await userEvent.setup().click(screen.getByRole("link", { name: "查订单" }));
  assert.ok(await screen.findByRole("heading", { level: 1, name: "查订单" }));
  assert.equal(onPage(ORDER_A), false);
  assert.equal(onPage("订单链接无效或已过期"), false);
  assert.equal(heldToken(), undefined);
  window.history.back();
  assert.ok(await orderHeading(ORDER_A));
  assert.equal(heldToken(), TOKEN_A);
});

test("链接失效的提示之后点导航的「查订单」：这是新打开的查订单，不再说链接失效", async () => {
  open(fakeStripeJs(), `/book/order#${TOKEN_DEAD}`, worldOf());
  await screen.findByText(/订单链接无效或已过期/);
  await userEvent.setup().click(screen.getByRole("link", { name: "查订单" }));
  await waitFor(() => assert.equal(address(), "/book/order"));
  await settle();
  assert.equal(onPage("订单链接无效或已过期"), false, "这一次没有打开任何链接，还提示链接失效");
});

// ---- 刷新、恢复、订单状态 ----

for (const status of ["confirmed", "assigned", "completed", "cancelled"] as const) {
  test(`地址带令牌的单已经是 ${status}：地址不动，不加载 Stripe.js，也没有「复制订单链接」`, async () => {
    const stripe = fakeStripeJs();
    open(stripe, LINK_A, worldOf({ statusA: status }));
    assert.ok(await orderHeading(ORDER_A));
    await settle();
    assert.equal(address(), LINK_A);
    assert.equal(stripe.calls.addresses.length, 0);
    assert.equal(screen.queryByRole("button", { name: "复制订单链接" }), null);
  });
}

test("地址带失效令牌（过期、作废）：显示查订单和失效提示，不加载 Stripe.js", async () => {
  const stripe = fakeStripeJs();
  open(stripe, `/book/order#${TOKEN_DEAD}`, worldOf());
  await screen.findByText(/订单链接无效或已过期/);
  assert.equal(stripe.calls.addresses.length, 0);
});

test("令牌已在 state 里，刷新时令牌已失效：显示查订单和失效提示，不是空白、不崩，不加载 Stripe.js", async () => {
  window.history.replaceState({ usr: { orderToken: TOKEN_DEAD }, key: "qa", idx: 0 }, "", "/book/order");
  const stripe = fakeStripeJs();
  open(stripe, null, worldOf());
  await screen.findByText(/订单链接无效或已过期/);
  assert.equal(stripe.calls.addresses.length, 0);
});

test("令牌在 state 里，刷新时单已取消：令牌放回地址（这个文档没加载 Stripe.js），区块显示已取消", async () => {
  const stripe = fakeStripeJs();
  const world = open(stripe, LINK_A, worldOf());
  await screen.findByRole("button", { name: PAY_A });
  closeDocument();
  world.statusA = "cancelled";
  const again = fakeStripeJs();
  open(again, null, world);
  assert.ok(await orderHeading(ORDER_A));
  await waitFor(() => assert.equal(address(), LINK_A));
  assert.equal(again.calls.addresses.length, 0);
});

test("令牌在 state 里，刷新时平台关了 Stripe：令牌放回地址，显示付款暂未开放", async () => {
  const world = open(fakeStripeJs(), LINK_A, worldOf());
  await screen.findByRole("button", { name: PAY_A });
  closeDocument();
  world.config = { ...stripeConfig, payments: null };
  const again = fakeStripeJs();
  open(again, null, world);
  await screen.findByText(/付款暂未开放/);
  await waitFor(() => assert.equal(address(), LINK_A));
  assert.equal(again.calls.addresses.length, 0);
});

test("读配置失败：不知道配没配 Stripe，付款区块不挂表单，订单还能看，令牌不丢", async () => {
  const stripe = fakeStripeJs();
  open(stripe, LINK_A, worldOf({ configFails: true }));
  assert.ok(await orderHeading(ORDER_A));
  await settle();
  assert.equal(stripe.calls.addresses.length, 0);
  assert.ok(address() === LINK_A || heldToken() === TOKEN_A, "令牌既不在地址也不在 state");
});

test("读订单出错（不是令牌失效）：显示重试，不掉到查订单，令牌还在；不加载 Stripe.js；恢复后重试能付款且地址干净", async () => {
  const stripe = fakeStripeJs();
  const world = open(stripe, LINK_A, worldOf({ orderFails: true }));
  await screen.findByText("订单没有读出来");
  assert.equal(address(), LINK_A);
  assert.equal(stripe.calls.addresses.length, 0);
  world.orderFails = false;
  await userEvent.setup().click(screen.getByRole("button", { name: "重试" }));
  await screen.findByRole("button", { name: PAY_A });
  assert.equal(address(), "/book/order");
  for (const seen of stripe.calls.addresses) assert.ok(!seen.includes("nzo_"), seen);
});

test("sessionStorage 被清空、从历史恢复这条记录（state 还在）：订单和表单照常，令牌不依赖 sessionStorage", async () => {
  const world = open(fakeStripeJs(), LINK_A, worldOf());
  await screen.findByRole("button", { name: PAY_A });
  closeDocument();
  sessionStorage.clear();
  open(fakeStripeJs(), null, world);
  await screen.findByRole("button", { name: PAY_A });
  assert.equal(address(), "/book/order");
});

// ---- 银行回跳 ----

test("银行回跳说失败、令牌取回、单还待付款：提示重新付款（从 hash 移进 state 时这个标记不能丢），地址干净", async () => {
  rememberPaymentReturn("pi_a", TOKEN_A);
  const stripe = fakeStripeJs();
  open(stripe, `/book/order?payment_intent=pi_a&payment_intent_client_secret=${SECRET_A}&redirect_status=failed`, worldOf());
  await screen.findByText("上次付款没有完成，请重新付款。");
  assert.equal(address(), "/book/order");
  for (const seen of stripe.calls.addresses) assert.ok(!seen.includes("nzo_") && !seen.includes("client_secret"), seen);
});

test("银行回跳、单已付款（不挂表单）：令牌回到地址，Stripe 的参数不留，不加载 Stripe.js", async () => {
  rememberPaymentReturn("pi_a", TOKEN_A);
  const stripe = fakeStripeJs();
  open(stripe, `/book/order?payment_intent=pi_a&payment_intent_client_secret=${SECRET_A}&redirect_status=succeeded`, worldOf({ statusA: "confirmed" }));
  assert.ok(await orderHeading(ORDER_A));
  await waitFor(() => assert.equal(address(), LINK_A));
  assert.equal(stripe.calls.addresses.length, 0);
});

test("银行回跳、sessionStorage 没了、也没有 state：到查订单，说明情况；Stripe 的参数不留", async () => {
  const stripe = fakeStripeJs();
  open(stripe, `/book/order?payment_intent=pi_a&payment_intent_client_secret=${SECRET_A}&redirect_status=succeeded`, worldOf());
  await screen.findByText(/付款结果已交给银行处理/);
  assert.equal(address(), "/book/order");
  assert.equal(stripe.calls.addresses.length, 0);
});

test("银行回跳、sessionStorage 里是别的付款：不用别的令牌，到查订单，存的那条被删掉", async () => {
  rememberPaymentReturn("pi_other", TOKEN_B);
  const world = open(fakeStripeJs(), `/book/order?payment_intent=pi_a&redirect_status=succeeded`, worldOf());
  await screen.findByText(/付款结果已交给银行处理/);
  assert.equal(world.calls.filter((call) => bearerOf(call) === `Bearer ${TOKEN_B}`).length, 0);
  assert.equal(sessionStorage.getItem("nozomi.payment-return"), null);
});

test("地址同时有银行参数和 state 里的令牌（浏览器正常走不到这种组合）：认 state 的令牌，订单照常，地址里没有令牌", async () => {
  window.history.replaceState({ usr: { orderToken: TOKEN_A }, key: "qa", idx: 0 }, "", `/book/order?payment_intent=pi_a&redirect_status=succeeded`);
  const stripe = fakeStripeJs();
  const world = open(stripe, null, worldOf());
  await screen.findByRole("button", { name: PAY_A });
  assert.equal(world.calls.filter((call) => bearerOf(call) === `Bearer ${TOKEN_A}`).length >= 2, true);
  for (const seen of stripe.calls.addresses) assert.ok(!seen.includes("nzo_"), seen);
});

// ---- 付款、复制链接 ----

test("付款成功：确认后 sessionStorage 不留令牌，轮询用 state 里的令牌走请求头，地址不放回令牌", async () => {
  const world = worldOf();
  const stripe = fakeStripeJs();
  open(stripe, LINK_A, world);
  const actor = userEvent.setup();
  await actor.click(await screen.findByRole("button", { name: PAY_A }));
  world.statusA = "confirmed";
  await actor.click(await screen.findByRole("button", { name: "确认支付" }));
  await screen.findByText("付款成功，订单已确认。派车后这里会显示司机和车辆。", undefined, { timeout: 5000 });
  assert.equal(sessionStorage.getItem("nozomi.payment-return"), null);
  assert.equal(address(), "/book/order");
  const reads = world.calls.filter((call) => new URL(call.path, "http://localhost").pathname === "/site/v1/order");
  assert.ok(reads.length >= 2);
  for (const call of reads) assert.equal(bearerOf(call), `Bearer ${TOKEN_A}`);
});

test("「复制订单链接」写不进剪贴板：明确提示失败，给带令牌的完整链接手动复制", async () => {
  open(fakeStripeJs(), LINK_A, worldOf());
  await screen.findByRole("button", { name: PAY_A });
  const actor = userEvent.setup();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => Promise.reject(new Error("denied")) } });
  await actor.click(screen.getByRole("button", { name: "复制订单链接" }));
  await screen.findByText(/浏览器没有允许自动复制/);
  const box = screen.getByLabelText("要复制的内容") as HTMLTextAreaElement;
  assert.equal(box.value, `http://localhost${LINK_A}`);
});

test("浏览器没有剪贴板接口（非安全来源）：同样给手动复制", async () => {
  open(fakeStripeJs(), LINK_A, worldOf());
  await screen.findByRole("button", { name: PAY_A });
  const actor = userEvent.setup();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  await actor.click(screen.getByRole("button", { name: "复制订单链接" }));
  const box = (await screen.findByLabelText("要复制的内容")) as HTMLTextAreaElement;
  assert.equal(box.value, `http://localhost${LINK_A}`);
});

test("贴了 B 之后「复制订单链接」复制的是 B 的链接", async () => {
  open(fakeStripeJs(), LINK_A, worldOf());
  await screen.findByRole("button", { name: PAY_A });
  paste(LINK_B);
  await screen.findByRole("button", { name: PAY_B });
  const written: string[] = [];
  const actor = userEvent.setup();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => void written.push(text) } });
  await actor.click(screen.getByRole("button", { name: "复制订单链接" }));
  assert.deepEqual(written, [`http://localhost${LINK_B}`]);
});

// ---- 令牌在 state 里时其他请求 ----

test("令牌在 state 里：查取消费、取消都带令牌走请求头，不进网址；取消后这个文档地址不放回令牌，页面显示已取消", async () => {
  const stripe = fakeStripeJs();
  const world = open(stripe, LINK_A, worldOf());
  await screen.findByRole("button", { name: PAY_A });
  const actor = userEvent.setup();
  await actor.click(screen.getByRole("button", { name: "取消订单" }));
  await actor.click(await screen.findByRole("button", { name: "确认取消订单" }));
  await screen.findByText("取消原因");
  const cancels = world.calls.filter((call) => call.path.includes("/order/cancel"));
  assert.equal(cancels.length, 2);
  for (const call of cancels) {
    assert.equal(bearerOf(call), `Bearer ${TOKEN_A}`);
    assert.ok(!call.path.includes("nzo_"));
  }
  assert.equal(address(), "/book/order");
  assert.equal(heldToken(), TOKEN_A);
});

// ---- 令牌不进日志、错误信息、页面标题 ----

test("各种失败路径：令牌不进控制台、页面标题、页面文字、Web 存储、请求地址", async () => {
  const printed: string[] = [];
  const methods = ["log", "info", "warn", "error", "debug"] as const;
  const originals = methods.map((name) => console[name]);
  for (const name of methods) console[name] = (...args: unknown[]) => void printed.push(args.map(String).join(" "));
  try {
    const stripe = fakeStripeJs();
    stripe.failLoads = 1;
    const world = open(stripe, LINK_A, worldOf());
    await screen.findByRole("button", { name: "重新加载" });
    assert.ok(!(document.body.textContent ?? "").includes("nzo_"));
    assert.ok(!document.title.includes("nzo_"));
    assert.equal(JSON.stringify({ ...localStorage }).includes("nzo_"), false);
    assert.equal(JSON.stringify({ ...sessionStorage }).includes("nzo_"), false);
    paste(`/book/order#${TOKEN_DEAD}`);
    await screen.findByText(/订单链接无效或已过期/);
    assert.ok(!(document.body.textContent ?? "").includes("nzo_"));
    for (const call of world.calls) assert.ok(!call.path.includes("nzo_"), call.path);
  } finally {
    methods.forEach((name, index) => {
      console[name] = originals[index] as typeof console.log;
    });
  }
  assert.ok(!printed.join("\n").includes("nzo_"), printed.join("\n"));
});

test("Referrer-Policy：页面和反向代理都是 no-referrer；前端代码里没有错误上报和埋点", async () => {
  const html = await readFile(new URL("../../../index.html", import.meta.url), "utf8");
  assert.match(html, /<meta name="referrer" content="no-referrer"\s*\/?>/);
  const edge = await readFile(new URL("../../../../../deploy/Caddyfile", import.meta.url), "utf8");
  assert.match(edge, /Referrer-Policy "no-referrer"/);
  const pkg = await readFile(new URL("../../../package.json", import.meta.url), "utf8");
  assert.doesNotMatch(pkg, /sentry|bugsnag|datadog|rollbar|posthog|gtag|mixpanel|amplitude|logrocket/i);
});

// ---- 最后一道防线 ----

const guarded = async (at: string): Promise<{ rejected: boolean; loads: number }> => {
  window.history.replaceState(null, "", at);
  const stripe = fakeStripeJs();
  let rejected = false;
  try {
    const mount = await createStripePaymentDriver(stripe.load).mount(document.createElement("div"), { publishableKey: "pk_test_abc", clientSecret: "pi_1_secret_2" });
    mount.destroy();
  } catch (err) {
    rejected = err instanceof PaymentLoadError;
  }
  return { rejected, loads: stripe.calls.addresses.length };
};

test("防线：令牌在查询串里，不加载 Stripe.js", async () => {
  assert.deepEqual(await guarded(`/book/order?t=${TOKEN_A}`), { rejected: true, loads: 0 });
});

test("防线：令牌大写（NZO_…）在地址里，不加载 Stripe.js", async () => {
  assert.deepEqual(await guarded(`/book/order#NZO_${"A".repeat(43)}`), { rejected: true, loads: 0 });
});

test("防线：下划线被编码（nzo%5F…，聊天软件、邮件转发常见）在查询串或 # 后，不加载 Stripe.js", async () => {
  assert.deepEqual(await guarded(`/book/order?t=nzo%5F${"A".repeat(43)}`), { rejected: true, loads: 0 });
  assert.deepEqual(await guarded(`/book/order#nzo%5F${"A".repeat(43)}`), { rejected: true, loads: 0 });
});

test("防线：开头字母被编码（%6Ezo_…），不加载 Stripe.js", async () => {
  assert.deepEqual(await guarded(`/book/order?t=%6Ezo_${"A".repeat(43)}`), { rejected: true, loads: 0 });
});

test("防线不误拦：地址干净、其他查询串都能挂表单", async () => {
  for (const at of ["/book/order", "/book/order?utm_source=mail"]) {
    const { rejected, loads } = await guarded(at);
    assert.equal(rejected, false, at);
    assert.ok(loads > 0, at);
  }
});

test("不误拦：带令牌的链接后面跟着含 nzo_ 字样的无关参数（?ref=gonzo_tours）：令牌离开地址时参数一起去掉，表单照常", async () => {
  const stripe = fakeStripeJs();
  open(stripe, `/book/order?ref=gonzo_tours#${TOKEN_A}`, worldOf());
  await screen.findByRole("button", { name: PAY_A });
  assert.equal(address(), "/book/order");
  assert.equal(stripe.calls.mounted, 1);
});
