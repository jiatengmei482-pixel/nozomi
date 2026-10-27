/**
 * 官网订单页的付款（M3-08，ADR 0046，pages/site-booking.md 5.3）：真实的 Stripe Elements 实现（`createStripePaymentDriver`）+ Stripe.js 的假实现。
 * 覆盖：加载中 → 可付（publishable key、client_secret、中文、外观来自令牌）→ 校验不过 → 页面内确认 → 验证中（3D 验证弹窗期间按钮在忙）→
 * 失败卡（Stripe 的原话，能换卡再付）→ 处理中 → 网络失败 → 付款成功等待确认并轮询到已确认；付款组件没加载出来能重新加载；
 * 刷新时已经付过不再显示表单；从银行验证页回来按付款编号取回令牌（令牌不进 return_url、不进任何请求网址，取回后删掉）；取不回时去查订单；付款已结束。
 * 接口用测试替身；真实后端 + 假 Stripe 由端到端测试 e2e/site-payment.spec.ts 覆盖。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../App.tsx";
import type { SiteConfig, SiteOrder, SiteOrderEnvelope } from "../../api/site.ts";
import { type ConfirmOutcome, PaymentDriverContext, createStripePaymentDriver, outcomeOfError } from "../../lib/payment-driver.ts";
import { PAYMENT_RETURN_MAX_AGE_MS, forgetPaymentReturn, intentIdOf, paymentReturnParams, rememberPaymentReturn, takePaymentReturn } from "../../lib/payment-return.ts";
import { STRIPE_JS_TIMEOUT_MS, loadStripeJs } from "../../lib/stripe-js.ts";
import { type FakeStripeJs, fakeStripeJs, intentOf } from "../../testing/fake-stripe-js.ts";
import { type ApiCall, apiError, assertAbsent, json, resetBrowser, stubApiWith } from "../../testing/harness.tsx";
import { PaymentSection } from "./OrderSections.tsx";

afterEach(resetBrowser);

const TOKEN = `nzo_${"A".repeat(43)}`;
const RETURN_KEY = "nozomi.payment-return";
const CLIENT_SECRET = "pi_1_secret_2";
const config: SiteConfig = { open: true, currency: "JPY", payments: { provider: "stripe", publishable_key: "pk_test_abc" }, support_phone: null, address_search: false, map_tiles: null };

const order = (changes: Partial<SiteOrder> = {}): SiteOrder => ({
  id: "44444444-4444-4444-8444-444444444444",
  order_no: "NZ20261026ABCD2345",
  status: "pending_payment",
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
  confirmed_at: null,
  cancelled_at: null,
  cancel_reason: null,
  quote_id: "QT20261026ABCDEFGHIJ",
  channel_order_no: null,
  price: { total: { amount: "21780", currency: "JPY" }, fx: null },
  payment_status: "requires_payment_method",
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
  ...changes,
});
const envelope = (current: SiteOrder): SiteOrderEnvelope => ({
  order: current,
  timeline: [{ from_status: null, to_status: "pending_payment", reason: null, occurred_at: current.created_at }],
  names: { city: { code: "CTY-JP-TYO", name: { zh: "东京" } }, place: { code: "NRT", name: { zh: "成田机场" }, type: "airport" }, vehicle_group: { code: "VG-BIZ-7", name: { zh: "商务 7 座" }, seats: 7 } },
});

type Route = (call: ApiCall & { url: URL }) => Response | Promise<Response> | null;
const paymentBody = (clientSecret: string | null = CLIENT_SECRET) => ({ payment: { provider: "stripe", status: "requires_payment_method", client_secret: clientSecret, publishable_key: "pk_test_abc" } });

/** 订单页：订单接口按 `status()` 给出当时的状态；付款接口给 client_secret。 */
function openOrderPage(stripe: FakeStripeJs, status: () => SiteOrder["status"] = () => "pending_payment", options: { entry?: string | { pathname: string; search?: string; hash?: string }; route?: Route } = {}): ApiCall[] {
  const calls = stubApiWith((call) => {
    const extra = options.route?.(call);
    if (extra !== undefined && extra !== null) return extra;
    if (call.url.pathname === "/site/v1/config") return json(200, config);
    if (call.url.pathname === "/site/v1/order") {
      const now = status();
      return json(200, envelope(order(now === "pending_payment" ? {} : { status: now, confirmed_at: "2026-10-26T01:05:00.000Z", payment_status: "succeeded" })));
    }
    if (call.url.pathname === "/site/v1/order/payment") return json(200, paymentBody());
    return null;
  });
  render(
    <PaymentDriverContext.Provider value={createStripePaymentDriver(stripe.load)}>
      <MemoryRouter initialEntries={[options.entry ?? { pathname: "/book/order", hash: `#${TOKEN}` }]}>
        <App />
      </MemoryRouter>
    </PaymentDriverContext.Provider>,
  );
  return calls;
}

/** 只渲染付款区块（轮询间隔可以调短）；`refreshes` 记下区块要求刷新订单的次数。 */
function openSection(stripe: FakeStripeJs, polling = { fastMs: 10, slowMs: 20, slowAfterMs: 60 }): { refreshes: number[] } {
  stubApiWith((call) => (call.url.pathname === "/site/v1/order/payment" ? json(200, paymentBody()) : null));
  const refreshes: number[] = [];
  render(
    <PaymentDriverContext.Provider value={createStripePaymentDriver(stripe.load)}>
      <PaymentSection token={TOKEN} order={order()} configPayments={{ publishable_key: "pk_test_abc" }} initial={null} onRefresh={() => refreshes.push(Date.now())} polling={polling} />
    </PaymentDriverContext.Provider>,
  );
  return { refreshes };
}

const user = () => userEvent.setup();

async function askToPay(actor: ReturnType<typeof user>): Promise<void> {
  await actor.click(await screen.findByRole("button", { name: "付款 21,780 JPY" }));
  await screen.findByRole("group", { name: "确认付款" });
}

test("可付：先显示加载中，再挂上 Stripe 的表单（publishable key、client_secret 来自后端，中文，外观取自设计令牌）；付款前先校验、再页面内确认，确认框写明可能弹出银行验证", async () => {
  const stripe = fakeStripeJs();
  openOrderPage(stripe);
  assert.ok(await screen.findByText("正在加载付款组件"));
  const pay = await screen.findByRole("button", { name: "付款 21,780 JPY" });
  assertAbsent(screen.queryByText("正在加载付款组件"));
  assert.ok(screen.getByText(/付款信息由 Stripe 处理，本站不保存卡号/));
  assert.deepEqual(stripe.calls.stripe, [{ publishableKey: "pk_test_abc", locale: "zh" }]);
  assert.deepEqual(stripe.calls.retrieve, [CLIENT_SECRET]);
  assert.equal(stripe.calls.elements[0]?.clientSecret, CLIENT_SECRET);
  assert.equal(stripe.calls.elements[0]?.locale, "zh");
  assert.ok(["stripe", "night"].includes(stripe.calls.elements[0]?.appearance.theme ?? ""));
  assert.ok(document.querySelector(".site-payment [data-fake-stripe]"), "表单挂在付款区块里");

  // 卡号没填完：Stripe 的校验原话，不出确认框
  stripe.submit = async () => ({ error: { type: "validation_error", message: "您的卡号不完整。" } });
  const actor = user();
  await actor.click(pay);
  assert.ok(await screen.findByText("您的卡号不完整。"));
  assertAbsent(screen.queryByRole("group", { name: "确认付款" }));
  assert.equal(stripe.calls.confirm.length, 0);

  stripe.submit = async () => ({});
  await askToPay(actor);
  assert.ok(screen.getByText("确认支付 21,780 JPY？"));
  assert.ok(screen.getByText(/如果银行要求验证，会弹出银行的验证窗口/));
  await actor.click(screen.getByRole("button", { name: "返回" }));
  assertAbsent(screen.queryByRole("group", { name: "确认付款" }));
  assert.equal(stripe.calls.confirm.length, 0, "返回不付款");
});

test("验证中：确认付款还没结果时（Stripe 的 3D 验证弹窗开着）按钮在忙、不能返回；令牌临时记在本标签页，return_url 里没有令牌；验证没通过时显示 Stripe 的原话、能再付；成功后等待确认并轮询到已确认", async () => {
  const stripe = fakeStripeJs();
  let finish!: (result: Awaited<ReturnType<FakeStripeJs["confirm"]>>) => void;
  stripe.confirm = () => new Promise((resolve) => (finish = resolve));
  let status: SiteOrder["status"] = "pending_payment";
  const calls = openOrderPage(stripe, () => status);
  const actor = user();
  await askToPay(actor);
  await actor.click(screen.getByRole("button", { name: "确认支付" }));
  await waitFor(() => assert.equal(stripe.calls.confirm.length, 1));
  assert.ok(screen.getByRole("button", { name: /正在付款/ }));
  assert.equal((screen.getByRole("button", { name: "返回" }) as HTMLButtonElement).disabled, true);
  assert.deepEqual(stripe.calls.confirm[0], { return_url: "http://localhost/book/order", redirect: "if_required" });
  assert.deepEqual(JSON.parse(sessionStorage.getItem(RETURN_KEY) ?? "{}").token, TOKEN, "可能被带去银行页面：令牌记在本标签页");
  assert.equal(JSON.parse(sessionStorage.getItem(RETURN_KEY) ?? "{}").intentId, "pi_1");

  finish({ error: { type: "invalid_request_error", code: "payment_intent_authentication_failure", message: "我们无法验证您的支付方式。请选择另一支付方式并重试。" } });
  assert.ok(await screen.findByText("付款没有成功：我们无法验证您的支付方式。请选择另一支付方式并重试。请换一张卡，或检查后再付。"));
  assert.equal(sessionStorage.getItem(RETURN_KEY), null, "有了结果就删掉");
  assert.ok(document.querySelector("[data-fake-stripe]"), "表单还在，可以换卡");

  await askToPay(actor);
  stripe.confirm = async () => ({ paymentIntent: intentOf("succeeded") });
  await actor.click(screen.getByRole("button", { name: "确认支付" }));
  assert.ok(await screen.findByText(/^付款成功，等待确认。/));
  assert.equal(document.querySelector("[data-fake-stripe]"), null, "付完拆掉表单");
  status = "confirmed";
  assert.ok(await screen.findByText("付款成功，订单已确认。派车后这里会显示司机和车辆。", {}, { timeout: 5_000 }));
  assertAbsent(screen.queryByRole("heading", { name: "付款" }));
  for (const call of calls) assert.ok(!call.path.includes(TOKEN), "令牌不进请求网址");
  assert.equal(sessionStorage.getItem(RETURN_KEY), null);
});

test("失败卡：显示 Stripe 给的原因（卡被拒、余额不足），表单留着可以换卡再付；同一页面再付成功", async () => {
  const stripe = fakeStripeJs();
  stripe.confirm = async () => ({ error: { type: "card_error", code: "card_declined", decline_code: "insufficient_funds", message: "您的卡余额不足。" } });
  openOrderPage(stripe);
  const actor = user();
  await askToPay(actor);
  await actor.click(screen.getByRole("button", { name: "确认支付" }));
  const alert = await screen.findByText("付款没有成功：您的卡余额不足。请换一张卡，或检查后再付。");
  assert.ok(alert.closest('[role="alert"]'), "失败用 role=alert 播报");
  assertAbsent(screen.queryByRole("group", { name: "确认付款" }));
  stripe.confirm = async () => ({ paymentIntent: intentOf("succeeded") });
  await askToPay(actor);
  await actor.click(screen.getByRole("button", { name: "确认支付" }));
  assert.ok(await screen.findByText(/^付款成功，等待确认。/));
  assertAbsent(screen.queryByText(/您的卡余额不足/));
});

test("网络失败：没连上 Stripe 时说可能没提交、可以再点且不会扣两次；其实已经付过（再查一次是已成功）时按成功算", async () => {
  const stripe = fakeStripeJs();
  stripe.confirm = async () => {
    throw new TypeError("Failed to fetch");
  };
  openOrderPage(stripe);
  const actor = user();
  await askToPay(actor);
  await actor.click(screen.getByRole("button", { name: "确认支付" }));
  assert.ok(await screen.findByText("没有连上 Stripe，这次付款可能没有提交。请检查网络后再点「付款」；同一张订单不会被扣两次。"));
  assert.ok(screen.getByRole("button", { name: "付款 21,780 JPY" }));

  stripe.confirm = async () => ({ error: { type: "api_connection_error" } });
  stripe.intent = intentOf("succeeded");
  await askToPay(actor);
  await actor.click(screen.getByRole("button", { name: "确认支付" }));
  assert.ok(await screen.findByText(/^付款成功，等待确认。/));
});

test("处理中：银行还在处理时说会自动确认、别重复付款，并一直轮询；确认比平时慢时补一句可以先关掉页面", async () => {
  const stripe = fakeStripeJs();
  stripe.confirm = async () => ({ paymentIntent: intentOf("processing") });
  const { refreshes } = openSection(stripe);
  const actor = user();
  await askToPay(actor);
  await actor.click(screen.getByRole("button", { name: "确认支付" }));
  const text = await screen.findByText(/^银行正在处理这笔付款，处理完订单会自动确认/);
  assert.ok(text.closest('[role="status"]'));
  await waitFor(() => assert.ok(refreshes.length >= 3, `刷新了 ${refreshes.length} 次`));
  assert.ok(await screen.findByText(/确认比平时慢：您可以先关掉页面，稍后再打开这个链接查看/));
});

test("刷新页面时已经付过（Stripe 那边已成功或处理中）：不再显示表单，直接说等待确认", async () => {
  for (const [status, text] of [
    ["succeeded", /^付款成功，等待确认。/],
    ["requires_capture", /^付款成功，等待确认。/],
    ["processing", /^银行正在处理这笔付款/],
  ] as const) {
    const stripe = fakeStripeJs();
    stripe.intent = intentOf(status);
    openSection(stripe, { fastMs: 60_000, slowMs: 60_000, slowAfterMs: 120_000 });
    assert.ok(await screen.findByText(text), status);
    assertAbsent(screen.queryByRole("button", { name: /付款 / }));
    assert.equal(stripe.calls.elements.length, 0, "不挂表单");
    resetBrowser();
  }
});

test("付款组件没加载出来（Stripe.js、表单、查付款）：说检查网络后重新加载，重新加载会真的再试", async () => {
  const stripe = fakeStripeJs();
  stripe.failLoads = 1;
  openSection(stripe);
  assert.ok(await screen.findByText("付款组件没有加载出来，请检查网络后点「重新加载」。"));
  const actor = user();
  await actor.click(screen.getByRole("button", { name: "重新加载" }));
  assert.ok(await screen.findByRole("button", { name: "付款 21,780 JPY" }));
  assertAbsent(screen.queryByText(/没有加载出来/));
  resetBrowser();

  const broken = fakeStripeJs();
  broken.elementLoads = false;
  openSection(broken);
  assert.ok(await screen.findByText("付款组件没有加载出来，请检查网络后点「重新加载」。"));
  assert.equal(broken.calls.destroyed, 1, "没加载出来的表单拆掉");
  resetBrowser();

  const offline = fakeStripeJs();
  offline.intent = null;
  openSection(offline);
  assert.ok(await screen.findByText("付款组件没有加载出来，请检查网络后点「重新加载」。"));
});

test("后端准备付款出错（Stripe 不可用）：说明并能重新加载；付款已经结束（没有 client_secret）：说不能付了并刷新订单", async () => {
  const stripe = fakeStripeJs();
  stubApiWith((call) => (call.url.pathname === "/site/v1/order/payment" ? apiError(503, "PAYMENT_PROVIDER_UNAVAILABLE", "收款服务暂时不可用") : null));
  render(
    <PaymentDriverContext.Provider value={createStripePaymentDriver(stripe.load)}>
      <PaymentSection token={TOKEN} order={order()} configPayments={{ publishable_key: "pk_test_abc" }} initial={null} onRefresh={() => undefined} />
    </PaymentDriverContext.Provider>,
  );
  assert.ok(await screen.findByRole("button", { name: "重新加载" }));
  assert.equal(stripe.calls.stripe.length, 0);
  resetBrowser();

  let refreshed = 0;
  stubApiWith((call) => (call.url.pathname === "/site/v1/order/payment" ? json(200, paymentBody(null)) : null));
  render(
    <PaymentDriverContext.Provider value={createStripePaymentDriver(stripe.load)}>
      <PaymentSection token={TOKEN} order={order()} configPayments={{ publishable_key: "pk_test_abc" }} initial={null} onRefresh={() => (refreshed += 1)} />
    </PaymentDriverContext.Provider>,
  );
  assert.ok(await screen.findByText("这张订单现在不能付款了（可能已超过付款期限），订单状态马上会更新。"));
  assert.equal(refreshed, 1);
  assertAbsent(screen.queryByRole("button", { name: /付款/ }));
});

test("从银行验证页回来（/book/order?payment_intent=…）：按付款编号取回令牌、立刻删掉，用请求头读订单；Stripe 说上次没付成时显示原因，可以再付", async () => {
  sessionStorage.setItem(RETURN_KEY, JSON.stringify({ intentId: "pi_1", token: TOKEN, at: Date.now() }));
  const stripe = fakeStripeJs();
  stripe.intent = intentOf("requires_payment_method", "您的卡被拒绝了。");
  const calls = openOrderPage(stripe, undefined, { entry: { pathname: "/book/order", search: `?payment_intent=pi_1&payment_intent_client_secret=${CLIENT_SECRET}&redirect_status=failed` } });
  assert.ok(await screen.findByText("上次付款没有成功：您的卡被拒绝了。请换一张卡，或检查后再付。"));
  assert.equal(sessionStorage.getItem(RETURN_KEY), null, "取回后删掉");
  const orderCall = calls.find((call) => call.path === "/site/v1/order");
  assert.equal(orderCall?.headers["Authorization"] ?? orderCall?.headers["authorization"], `Bearer ${TOKEN}`);
  for (const call of calls) assert.ok(!call.path.includes(TOKEN) && !call.path.includes("payment_intent"), call.path);
  assert.ok(screen.getByRole("button", { name: "付款 21,780 JPY" }));
});

test("从银行验证页回来却取不回令牌（换了浏览器、记的是另一笔付款、太久以前的）：去「查订单」，说付款结果已交给银行、用订单号查找、别重复付款；不请求订单", async () => {
  for (const saved of [null, { intentId: "pi_other", token: TOKEN, at: Date.now() }, { intentId: "pi_1", token: TOKEN, at: Date.now() - PAYMENT_RETURN_MAX_AGE_MS - 1 }, { intentId: "pi_1", token: "nzo_bad", at: Date.now() }]) {
    if (saved !== null) sessionStorage.setItem(RETURN_KEY, JSON.stringify(saved));
    const stripe = fakeStripeJs();
    const calls = openOrderPage(stripe, undefined, { entry: { pathname: "/book/order", search: "?payment_intent=pi_1&payment_intent_client_secret=pi_1_secret_2&redirect_status=succeeded" } });
    assert.ok(await screen.findByText(/付款结果已交给银行处理。这个页面没能自动打开您的订单，请用订单号和下单时的邮箱或手机号查找订单查看付款结果；请不要重复付款。/));
    assert.ok(screen.getByRole("heading", { level: 1, name: "查订单" }));
    assert.equal(sessionStorage.getItem(RETURN_KEY), null);
    assert.equal(calls.filter((call) => call.path.startsWith("/site/v1/order")).length, 0);
    resetBrowser();
  }
});

test("主题切换时把新主题下的令牌值交给 Stripe 的表单；拆掉表单后不再跟着变", async () => {
  const stripe = fakeStripeJs();
  openSection(stripe);
  await screen.findByRole("button", { name: "付款 21,780 JPY" });
  document.documentElement.dataset["theme"] = "dark";
  await waitFor(() => assert.equal(stripe.calls.appearanceUpdates.at(-1)?.theme, "night"));
  document.documentElement.dataset["theme"] = "light";
  await waitFor(() => assert.equal(stripe.calls.appearanceUpdates.at(-1)?.theme, "stripe"));
  resetBrowser();
  const count = stripe.calls.appearanceUpdates.length;
  document.documentElement.dataset["theme"] = "dark";
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(stripe.calls.appearanceUpdates.length, count);
});

test("Stripe 的错误归类：卡和填写的问题给原话；验证没通过给原话；没连上算网络；别的算没完成", () => {
  const cases: [Parameters<typeof outcomeOfError>[0], ConfirmOutcome][] = [
    [{ type: "card_error", message: "您的卡被拒绝了。" }, { kind: "declined", message: "您的卡被拒绝了。" }],
    [{ type: "validation_error", message: "您的卡号不完整。" }, { kind: "declined", message: "您的卡号不完整。" }],
    [{ type: "invalid_request_error", code: "payment_intent_authentication_failure", message: "无法验证。" }, { kind: "declined", message: "无法验证。" }],
    [{ type: "api_connection_error" }, { kind: "network" }],
    [{ type: "invalid_request_error", code: "payment_intent_unexpected_state", message: "状态不对" }, { kind: "failed", message: "状态不对" }],
    [{ type: "card_error" }, { kind: "failed", message: null }],
  ];
  for (const [error, expected] of cases) assert.deepEqual(outcomeOfError(error), expected, JSON.stringify(error));
});

test("付款回跳的令牌：client_secret 取付款编号；地址参数只认 pi_ 开头；记下 → 按编号取回一次就删；过期、未来时间、坏数据都不认", () => {
  assert.equal(intentIdOf("pi_3Abc_secret_XyZ9"), "pi_3Abc");
  assert.equal(intentIdOf("seti_1_secret_2"), null);
  assert.equal(intentIdOf("pi_1_secret_"), null);
  assert.deepEqual(paymentReturnParams("?payment_intent=pi_9&payment_intent_client_secret=pi_9_secret_1&redirect_status=succeeded"), { intentId: "pi_9", redirectStatus: "succeeded" });
  assert.equal(paymentReturnParams("?payment_intent=evil%2F..&redirect_status=x"), null);
  assert.equal(paymentReturnParams(""), null);

  const now = 1_800_000_000_000;
  rememberPaymentReturn("pi_9", TOKEN, now);
  assert.equal(takePaymentReturn("pi_9", now + 1000), TOKEN);
  assert.equal(takePaymentReturn("pi_9", now + 1000), null, "只能取一次");
  rememberPaymentReturn("pi_9", TOKEN, now);
  assert.equal(takePaymentReturn("pi_8", now), null);
  assert.equal(sessionStorage.getItem(RETURN_KEY), null, "对不上也删");
  rememberPaymentReturn("pi_9", TOKEN, now);
  assert.equal(takePaymentReturn("pi_9", now + PAYMENT_RETURN_MAX_AGE_MS + 1), null);
  rememberPaymentReturn("pi_9", TOKEN, now + 120_000);
  assert.equal(takePaymentReturn("pi_9", now), null, "时间在未来的不认");
  sessionStorage.setItem(RETURN_KEY, "{oops");
  assert.equal(takePaymentReturn("pi_9", now), null);
  rememberPaymentReturn("pi_9", TOKEN, now);
  forgetPaymentReturn();
  assert.equal(sessionStorage.length, 0);
});

test("Stripe.js 的加载：只插一次 js.stripe.com/v3 的 <script>；加载失败或超时拿掉这个 <script> 并允许重试；加载完没有 Stripe 也算失败", async () => {
  const host = globalThis as { Stripe?: unknown };
  const appended: HTMLScriptElement[] = [];
  const append = (script: HTMLScriptElement): void => {
    appended.push(script);
  };
  const first = loadStripeJs(append);
  assert.equal(loadStripeJs(append), first, "加载中再要同一个");
  assert.equal(appended.length, 1);
  assert.equal(appended[0]?.src, "https://js.stripe.com/v3/");
  assert.equal(appended[0]?.async, true);
  assert.equal(appended[0]?.integrity, "", "不加 SRI");
  appended[0]?.dispatchEvent(new Event("error"));
  await assert.rejects(first, { name: "StripeJsLoadError" });

  const second = loadStripeJs(append);
  assert.equal(appended.length, 2, "失败后重试会再插一次");
  appended[1]?.dispatchEvent(new Event("load"));
  await assert.rejects(second, { name: "StripeJsLoadError" }, "加载完却没有 window.Stripe");

  const slow = loadStripeJs(append, 5);
  await assert.rejects(slow, { name: "StripeJsLoadError" });
  assert.ok(STRIPE_JS_TIMEOUT_MS >= 10_000);

  const factory = () => ({});
  const third = loadStripeJs(append);
  host.Stripe = factory;
  appended[3]?.dispatchEvent(new Event("load"));
  assert.equal(await third, factory);
  assert.equal(await loadStripeJs(append), factory, "已经加载过就直接用");
  assert.equal(appended.length, 4);
  delete host.Stripe;
});
