/**
 * M3-08 测试角色补充：官网付款的安全重点（ADR 0046，pages/site-booking.md 5.3）。Stripe.js 用假实现，接口用测试替身，从不连真实的 Stripe。
 * - 令牌：两张单交错时 A 的回跳拿不到 B 的令牌；sessionStorage 被改坏不会注入脚本、不会跳站外；记下的时机和删除的时机；
 * - 回跳：伪造的参数（别人的付款编号、redirect_status=succeeded）不能让页面说已付，也不发任何写操作；
 * - 重复付款：连点只确认一次；网络失败后再点还是同一笔付款；
 * - 轮询：3 秒 / 2 分钟 / 15 秒的切换边界（假时钟），切到后台再回来不多开定时器，区块消失后不再刷新；
 * - 付款已取消：确认时才发现的情况也不再显示表单；
 * - 金额：页面原样显示后端的十进制字符串，不经浮点。
 */
import { afterEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../App.tsx";
import type { SiteConfig, SiteOrder, SiteOrderEnvelope } from "../../api/site.ts";
import { PaymentDriverContext, createStripePaymentDriver } from "../../lib/payment-driver.ts";
import { PAYMENT_RETURN_MAX_AGE_MS, rememberPaymentReturn, takePaymentReturn } from "../../lib/payment-return.ts";
import { type FakeStripeJs, fakeStripeJs, intentOf } from "../../testing/fake-stripe-js.ts";
import { type ApiCall, assertAbsent, json, resetBrowser, stubApiWith } from "../../testing/harness.tsx";
import { PaymentSection } from "./OrderSections.tsx";

afterEach(() => {
  mock.timers.reset();
  resetBrowser();
  sessionStorage.clear();
});

const TOKEN_A = `nzo_${"A".repeat(43)}`;
const TOKEN_B = `nzo_${"B".repeat(43)}`;
const SECRET_A = "pi_AAA_secret_a";
const SECRET_B = "pi_BBB_secret_b";
const RETURN_KEY = "nozomi.payment-return";
const LOST = /付款结果已交给银行处理。这个页面没能自动打开您的订单/;
const config: SiteConfig = { open: true, currency: "JPY", payments: { provider: "stripe", publishable_key: "pk_test_abc" }, support_phone: null, address_search: false, map_tiles: null };

const order = (changes: Partial<SiteOrder> = {}): SiteOrder =>
  ({
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
  }) as SiteOrder;
const envelope = (current: SiteOrder): SiteOrderEnvelope => ({
  order: current,
  timeline: [{ from_status: null, to_status: "pending_payment", reason: null, occurred_at: current.created_at }],
  names: { city: { code: "CTY-JP-TYO", name: { zh: "东京" } }, place: { code: "NRT", name: { zh: "成田机场" }, type: "airport" }, vehicle_group: { code: "VG-BIZ-7", name: { zh: "商务 7 座" }, seats: 7 } },
});
const paymentBody = (clientSecret: string | null) => ({ payment: { provider: "stripe", status: "requires_payment_method", client_secret: clientSecret, publishable_key: "pk_test_abc" } });

const bearerOf = (call: ApiCall): string => call.headers["Authorization"] ?? call.headers["authorization"] ?? "";

/** 整个应用的订单页：令牌 A / B 各对应一笔付款（按请求头分辨），`status()` 决定订单当时的状态。 */
function openApp(stripe: FakeStripeJs, entry: string | { pathname: string; search?: string; hash?: string }, status: () => SiteOrder["status"] = () => "pending_payment", secret: (token: string) => string | null = (token) => (token.includes(TOKEN_B) ? SECRET_B : SECRET_A)): { calls: ApiCall[]; unmount(): void } {
  const calls = stubApiWith((call) => {
    if (call.url.pathname === "/site/v1/config") return json(200, config);
    if (call.url.pathname === "/site/v1/order") return json(200, envelope(order({ status: status() })));
    if (call.url.pathname === "/site/v1/order/payment") return json(200, paymentBody(secret(bearerOf(call))));
    return null;
  });
  const { unmount } = render(
    <PaymentDriverContext.Provider value={createStripePaymentDriver(stripe.load)}>
      <MemoryRouter initialEntries={[entry]}>
        <App />
      </MemoryRouter>
    </PaymentDriverContext.Provider>,
  );
  return { calls, unmount };
}

/** 只渲染付款区块。 */
function openSection(stripe: FakeStripeJs, current: SiteOrder = order()): { refreshes: () => number; calls: ApiCall[] } {
  const calls = stubApiWith((call) => (call.url.pathname === "/site/v1/order/payment" ? json(200, paymentBody(SECRET_A)) : null));
  let refreshes = 0;
  render(
    <PaymentDriverContext.Provider value={createStripePaymentDriver(stripe.load)}>
      <PaymentSection token={TOKEN_A} order={current} configPayments={{ publishable_key: "pk_test_abc" }} initial={null} onRefresh={() => (refreshes += 1)} />
    </PaymentDriverContext.Provider>,
  );
  return { refreshes: () => refreshes, calls };
}

const payName = "付款 21,780 JPY";

async function toConfirm(): Promise<void> {
  await userEvent.setup().click(await screen.findByRole("button", { name: payName }));
  await screen.findByRole("group", { name: "确认付款" });
}

const never = (): Promise<never> => new Promise(() => undefined);
const returnEntry = (intent: string, redirectStatus = "succeeded", secret = `${intent}_secret_x`) => ({ pathname: "/book/order", search: `?payment_intent=${intent}&payment_intent_client_secret=${secret}&redirect_status=${redirectStatus}` });

// ---- 令牌 ----

test("令牌：只有点了「确认支付」才写进本标签页；打开页面、校验、看确认框、点返回都不写；取消确认后也没有留下", async () => {
  const stripe = fakeStripeJs();
  openSection(stripe);
  await screen.findByRole("button", { name: payName });
  assert.equal(sessionStorage.length, 0, "打开页面不写");
  await toConfirm();
  assert.equal(sessionStorage.length, 0, "校验通过、确认框出来还不写");
  await userEvent.setup().click(screen.getByRole("button", { name: "返回" }));
  assert.equal(sessionStorage.length, 0, "点返回不写");
  assert.equal(localStorage.getItem(RETURN_KEY), null, "不写 localStorage");
});

test("令牌：确认付款的每一种结果（成功、处理中、被拒、没连上、抛错、其他错误）都把临时记下的令牌删掉，也不会写进 localStorage", async () => {
  const outcomes: FakeStripeJs["confirm"][] = [
    async () => ({ paymentIntent: intentOf("succeeded") }),
    async () => ({ paymentIntent: intentOf("processing") }),
    async () => ({ error: { type: "card_error", message: "您的卡被拒绝了。" } }),
    async () => ({ error: { type: "api_connection_error" } }),
    async () => {
      throw new TypeError("Failed to fetch");
    },
    async () => ({ error: { type: "api_error", message: "Stripe 出错了" } }),
  ];
  for (const confirm of outcomes) {
    const stripe = fakeStripeJs();
    let written: string | null = null;
    stripe.confirm = () => {
      written = sessionStorage.getItem(RETURN_KEY);
      return confirm();
    };
    openSection(stripe);
    await toConfirm();
    await userEvent.setup().click(screen.getByRole("button", { name: "确认支付" }));
    await waitFor(() => assert.equal(stripe.calls.confirm.length, 1));
    await waitFor(() => assert.equal(sessionStorage.getItem(RETURN_KEY), null));
    assert.deepEqual(JSON.parse(written ?? "{}").token, TOKEN_A, "确认请求发出时令牌已记下");
    assert.equal(JSON.parse(written ?? "{}").intentId, "pi_AAA");
    assert.ok(!stripe.calls.confirm[0]?.return_url.includes(TOKEN_A), "return_url 不带令牌");
    assert.ok(!stripe.calls.confirm[0]?.return_url.includes("#"), "return_url 没有 # 片段");
    assert.equal(localStorage.length, 0);
    resetBrowser();
  }
});

test("令牌：同一标签页两张单交错——A 被带去银行没回来，又去付 B；A 的回跳不会拿到 B 的令牌，也不读任何订单", async () => {
  const stripe = fakeStripeJs();
  stripe.confirm = never;
  const a = openApp(stripe, { pathname: "/book/order", hash: `#${TOKEN_A}` });
  await toConfirm();
  await userEvent.setup().click(screen.getByRole("button", { name: "确认支付" }));
  await waitFor(() => assert.equal(JSON.parse(sessionStorage.getItem(RETURN_KEY) ?? "{}").intentId, "pi_AAA"));
  a.unmount();

  const b = openApp(stripe, { pathname: "/book/order", hash: `#${TOKEN_B}` });
  await toConfirm();
  await userEvent.setup().click(screen.getByRole("button", { name: "确认支付" }));
  await waitFor(() => assert.equal(JSON.parse(sessionStorage.getItem(RETURN_KEY) ?? "{}").intentId, "pi_BBB"));
  b.unmount();

  const back = openApp(fakeStripeJs(), returnEntry("pi_AAA"));
  assert.ok(await screen.findByText(LOST));
  assert.equal(back.calls.filter((call) => call.path.startsWith("/site/v1/order")).length, 0, "不读订单");
  for (const call of back.calls) assert.ok(!bearerOf(call).includes(TOKEN_B), "B 的令牌没有发出去");
  assert.equal(sessionStorage.getItem(RETURN_KEY), null, "对不上也删掉，B 的令牌不再留在存储里");
});

test("令牌：回跳只能用一次——同一个回跳地址再打开一次（刷新、从历史回来）取不回令牌", async () => {
  sessionStorage.setItem(RETURN_KEY, JSON.stringify({ intentId: "pi_AAA", token: TOKEN_A, at: Date.now() }));
  const first = openApp(fakeStripeJs(), returnEntry("pi_AAA"));
  await screen.findByRole("heading", { level: 1, name: /^订单 NZ/ });
  first.unmount();
  resetBrowser();
  openApp(fakeStripeJs(), returnEntry("pi_AAA"));
  assert.ok(await screen.findByText(LOST));
});

test("令牌：1 小时的边界——整 1 小时还能用，多 1 毫秒不能；未来时间 60 秒内容忍（时钟误差），再多不认", () => {
  const now = 1_800_000_000_000;
  const at = (saved: number): string | null => {
    rememberPaymentReturn("pi_AAA", TOKEN_A, saved);
    return takePaymentReturn("pi_AAA", now);
  };
  assert.equal(PAYMENT_RETURN_MAX_AGE_MS, 3_600_000);
  assert.equal(at(now - PAYMENT_RETURN_MAX_AGE_MS), TOKEN_A);
  assert.equal(at(now - PAYMENT_RETURN_MAX_AGE_MS - 1), null);
  assert.equal(at(now + 60_000), TOKEN_A);
  assert.equal(at(now + 60_001), null);
  assert.equal(sessionStorage.length, 0);
});

test("令牌：sessionStorage 被改坏（注入脚本、站外地址、类型不对、原型污染）：一律去「查订单」，不跳站外、不插元素、不发订单请求，键被删掉", async () => {
  const at = Date.now();
  const raws = [
    { intentId: "pi_AAA", token: `${TOKEN_A}"><img src=x onerror=alert(1)>`, at },
    { intentId: "pi_AAA", token: `<script>window.__pwned=1</script>`, at },
    { intentId: "pi_AAA", token: "javascript:window.__pwned=1", at },
    { intentId: "pi_AAA", token: `//evil.example.com/#${TOKEN_A}`, at },
    { intentId: "pi_AAA", token: `https://evil.example.com/book/order#${TOKEN_A}`, at },
    { intentId: "pi_AAA", token: `${TOKEN_A}\n//evil.example.com`, at },
    { intentId: "pi_AAA", token: 42, at },
    { intentId: "pi_AAA", token: [TOKEN_A], at },
    { intentId: ["pi_AAA"], token: TOKEN_A, at },
    { intentId: "pi_AAA", token: TOKEN_A, at: String(at) },
    { intentId: "pi_AAA", token: TOKEN_A },
  ]
    .map((value) => JSON.stringify(value))
    .concat(["null", "[]", "1", `"${TOKEN_A}"`, TOKEN_A, `{"__proto__":{"token":"${TOKEN_A}","at":${at}},"intentId":"pi_AAA"}`]);
  for (const raw of raws) {
    sessionStorage.setItem(RETURN_KEY, raw);
    const { calls } = openApp(fakeStripeJs(), returnEntry("pi_AAA"));
    assert.ok(await screen.findByText(LOST), raw);
    assert.equal(sessionStorage.getItem(RETURN_KEY), null, raw);
    assert.equal(calls.filter((call) => call.path.startsWith("/site/v1/order")).length, 0, raw);
    assert.equal(document.querySelector("img[src='x'], script:not([src])"), null, raw);
    assert.equal((globalThis as { __pwned?: unknown }).__pwned, undefined, raw);
    assert.equal(window.location.origin, "http://localhost", raw);
    resetBrowser();
  }
});

// ---- 回跳 ----

test("回跳：伪造别人的付款编号（本标签页没有记录、或记的是自己的另一笔）：不读订单、不连 Stripe、没有任何写操作，也不说付款成功", async () => {
  for (const saved of [null, { intentId: "pi_AAA", token: TOKEN_A, at: Date.now() }]) {
    if (saved !== null) sessionStorage.setItem(RETURN_KEY, JSON.stringify(saved));
    const stripe = fakeStripeJs();
    const { calls } = openApp(stripe, returnEntry("pi_VICTIM", "succeeded"));
    assert.ok(await screen.findByText(LOST));
    assert.equal(calls.filter((call) => call.method !== "GET").length, 0, "没有写操作");
    assert.equal(calls.filter((call) => call.path.startsWith("/site/v1/order")).length, 0, "不读订单");
    assert.equal(stripe.calls.retrieve.length + stripe.calls.confirm.length, 0, "不连 Stripe");
    assertAbsent(screen.queryByText(/付款成功/));
    resetBrowser();
    sessionStorage.clear();
  }
});

test("回跳：地址上的 redirect_status 不算数——写 succeeded 但 Stripe 说没付成：仍显示表单和原因，不说付款成功、不轮询", async () => {
  sessionStorage.setItem(RETURN_KEY, JSON.stringify({ intentId: "pi_AAA", token: TOKEN_A, at: Date.now() }));
  const stripe = fakeStripeJs();
  stripe.intent = intentOf("requires_payment_method", "Your card was declined.");
  const { calls } = openApp(stripe, returnEntry("pi_AAA", "succeeded"));
  assert.ok(await screen.findByText("上次付款没有成功：您的银行卡被拒绝了。请换一张卡，或联系发卡银行。"));
  assert.ok(screen.getByRole("button", { name: payName }));
  assertAbsent(screen.queryByText(/付款成功/));
  assert.equal(calls.filter((call) => call.method !== "GET").length, 0);
  assert.equal(calls.filter((call) => call.path === "/site/v1/order").length, 1, "没有开始轮询订单");
});

test("回跳：redirect_status=failed / requires_payment_method，Stripe 给了原因时显示中文原因、表单留着；反过来地址说 failed 而 Stripe 说已成功时按 Stripe", async () => {
  for (const redirectStatus of ["failed", "requires_payment_method"]) {
    sessionStorage.setItem(RETURN_KEY, JSON.stringify({ intentId: "pi_AAA", token: TOKEN_A, at: Date.now() }));
    const stripe = fakeStripeJs();
    stripe.intent = intentOf("requires_payment_method", "We are unable to authenticate your payment method.", { code: "payment_intent_authentication_failure" });
    openApp(stripe, returnEntry("pi_AAA", redirectStatus));
    assert.ok(await screen.findByText("上次付款没有成功：银行验证没有通过。请重新付款并完成验证，或换一张卡。"), redirectStatus);
    assert.ok(screen.getByRole("button", { name: payName }));
    resetBrowser();
  }
  sessionStorage.setItem(RETURN_KEY, JSON.stringify({ intentId: "pi_AAA", token: TOKEN_A, at: Date.now() }));
  const paid = fakeStripeJs();
  paid.intent = intentOf("succeeded");
  openApp(paid, returnEntry("pi_AAA", "failed"));
  assert.ok(await screen.findByText(/^付款成功，等待确认。/));
});

test("回跳：redirect_status=failed 而 Stripe 那边没有 last_payment_error（银行页面被客人关掉、Stripe 没写原因）：要告诉客人上次验证没完成，不能若无其事地只显示表单", async () => {
  sessionStorage.setItem(RETURN_KEY, JSON.stringify({ intentId: "pi_AAA", token: TOKEN_A, at: Date.now() }));
  const stripe = fakeStripeJs();
  stripe.intent = intentOf("requires_payment_method");
  openApp(stripe, returnEntry("pi_AAA", "failed"));
  await screen.findByRole("button", { name: payName });
  const alert = document.querySelector('[role="alert"]');
  assert.match(alert?.textContent ?? "", /没有(成功|完成)|没付成|未完成/, "从银行回来、地址说失败时应有提示");
});

// ---- 重复付款 ----

test("重复付款：确认按钮连点（3D 验证弹窗开着、请求还没回来）只确认一次；「付款」按钮校验期间连点只校验一次", async () => {
  const stripe = fakeStripeJs();
  let submits = 0;
  stripe.submit = async () => {
    submits += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return {};
  };
  stripe.confirm = never;
  openSection(stripe);
  const pay = await screen.findByRole("button", { name: payName });
  fireEvent.click(pay);
  fireEvent.click(pay);
  fireEvent.click(pay);
  await screen.findByRole("group", { name: "确认付款" });
  assert.equal(submits, 1);
  const confirm = screen.getByRole("button", { name: "确认支付" });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  await userEvent.setup().dblClick(screen.getByRole("button", { name: /正在付款/ }));
  await waitFor(() => assert.equal(stripe.calls.confirm.length, 1));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(stripe.calls.confirm.length, 1, "只确认一次");
});

test("重复付款：网络失败后再点，还是同一笔付款（不重新取付款、不重建 Stripe 和表单）；两次确认都带同一个 return_url", async () => {
  const stripe = fakeStripeJs();
  stripe.confirm = async () => ({ error: { type: "api_connection_error" } });
  const { calls } = openSection(stripe);
  await toConfirm();
  await userEvent.setup().click(screen.getByRole("button", { name: "确认支付" }));
  await screen.findByText(/没有连上 Stripe，这次付款可能没有提交/);
  assert.equal(stripe.calls.retrieve.length, 2, "没连上时先再查一次");

  stripe.confirm = async () => ({ paymentIntent: intentOf("succeeded") });
  await toConfirm();
  await userEvent.setup().click(screen.getByRole("button", { name: "确认支付" }));
  await screen.findByText(/^付款成功，等待确认。/);
  assert.equal(stripe.calls.confirm.length, 2);
  assert.equal(stripe.calls.confirm[0]?.return_url, stripe.calls.confirm[1]?.return_url);
  assert.equal(stripe.calls.elements.length, 1, "表单只建一次");
  assert.equal(stripe.calls.stripe.length, 1);
  assert.equal(calls.filter((call) => call.path === "/site/v1/order/payment").length, 1, "没有重新要付款凭据");
  for (const secret of stripe.calls.retrieve) assert.equal(secret, SECRET_A);
});

test("重复付款：别的标签页已经付过——确认时 Stripe 回 unexpected_state，再查一次是已成功：按成功算，不让客人再付", async () => {
  const stripe = fakeStripeJs();
  stripe.confirm = async () => {
    stripe.intent = intentOf("succeeded");
    return { error: { type: "invalid_request_error", code: "payment_intent_unexpected_state", message: "这笔付款已经完成。" } };
  };
  openSection(stripe);
  await toConfirm();
  await userEvent.setup().click(screen.getByRole("button", { name: "确认支付" }));
  assert.ok(await screen.findByText(/^付款成功，等待确认。/));
  assertAbsent(screen.queryByRole("button", { name: /^付款 / }));
});

// ---- 付款状态 ----

test("付款已取消：付款期限在页面开着时过了，点确认才发现（Stripe 回 unexpected_state，再查是 canceled）：不再显示表单和付款按钮，说明不能付了，并刷新订单", async () => {
  const stripe = fakeStripeJs();
  stripe.confirm = async () => {
    stripe.intent = intentOf("canceled");
    return { error: { type: "invalid_request_error", code: "payment_intent_unexpected_state", message: "这笔付款已经取消。" } };
  };
  const { refreshes } = openSection(stripe);
  await toConfirm();
  await userEvent.setup().click(screen.getByRole("button", { name: "确认支付" }));
  await waitFor(() => assert.equal(stripe.calls.retrieve.length, 2));
  await waitFor(() => assert.equal(document.querySelector('[role="alert"]')?.textContent === "", false));
  assertAbsent(screen.queryByRole("button", { name: payName }));
  assert.equal(document.querySelector("[data-fake-stripe]"), null, "表单拆掉");
  assert.match(document.querySelector('[role="alert"]')?.textContent ?? "", /不能付款了|已经取消/);
  assert.ok(refreshes() >= 1, "刷新订单");
});

test("付款已取消：打开页面时就是 canceled：不挂表单；订单刷新成已取消后不说「付款成功」", async () => {
  const stripe = fakeStripeJs();
  stripe.intent = intentOf("canceled");
  let status: SiteOrder["status"] = "pending_payment";
  openApp(stripe, { pathname: "/book/order", hash: `#${TOKEN_A}` }, () => {
    const now = status;
    status = "cancelled";
    return now;
  });
  await waitFor(() => assert.equal(stripe.calls.retrieve.length, 1));
  await waitFor(() => assertAbsent(screen.queryByRole("heading", { name: "付款" })));
  assert.equal(stripe.calls.elements.length, 0);
  assertAbsent(screen.queryByRole("heading", { name: "付款" }));
  assertAbsent(screen.queryByText(/付款成功/));
});

test("轮询边界（假时钟，用正式的间隔）：马上一次，之后每 3 秒；差 1 毫秒不刷新；2 分钟那次起补一句并改成 15 秒；切到后台再回来不多开定时器；拆掉后不再刷新", async () => {
  const stripe = fakeStripeJs();
  const stubbed = stubApiWith((call) => (call.url.pathname === "/site/v1/order/payment" ? json(200, paymentBody(SECRET_A)) : null));
  let refreshes = 0;
  const view = render(
    <PaymentDriverContext.Provider value={createStripePaymentDriver(stripe.load)}>
      <PaymentSection token={TOKEN_A} order={order()} configPayments={{ publishable_key: "pk_test_abc" }} initial={null} onRefresh={() => (refreshes += 1)} />
    </PaymentDriverContext.Provider>,
  );
  await toConfirm();
  assert.ok(stubbed.length >= 1);
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.now() });
  fireEvent.click(screen.getByRole("button", { name: "确认支付" }));
  await act(async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  });
  const advance = (ms: number): void => act(() => mock.timers.tick(ms));
  const slowText = (): boolean => document.body.textContent?.includes("确认比平时慢") ?? false;

  assert.equal(refreshes, 1, "马上刷新一次");
  advance(2_999);
  assert.equal(refreshes, 1);
  advance(1);
  assert.equal(refreshes, 2, "第 3 秒");

  document.dispatchEvent(new Event("visibilitychange"));
  advance(3_000);
  assert.equal(refreshes, 3, "切到后台再回来不多开定时器");

  for (let elapsed = 6_000; elapsed < 117_000; elapsed += 3_000) advance(3_000);
  assert.equal(refreshes, 40, "到 117 秒一共 40 次");
  assert.equal(slowText(), false, "2 分钟前不说慢");
  advance(2_999);
  assert.equal(slowText(), false, "差 1 毫秒还不说慢");
  advance(1);
  assert.equal(refreshes, 41);
  assert.equal(slowText(), true, "整 2 分钟那次起说慢");
  advance(14_999);
  assert.equal(refreshes, 41, "放慢后 15 秒内不刷新");
  advance(1);
  assert.equal(refreshes, 42);
  advance(15_000);
  assert.equal(refreshes, 43);

  view.unmount();
  advance(60_000);
  assert.equal(refreshes, 43, "区块消失后定时器停掉");
});

// ---- 金额 ----

test("金额：按钮和确认框原样显示后端的十进制字符串：日元没有小数、美元两位（含 .50、.05、.10），超过浮点精度的数也不变", async () => {
  const cases: [string, string, string][] = [
    ["21780", "JPY", "21,780 JPY"],
    ["1000", "JPY", "1,000 JPY"],
    ["999", "JPY", "999 JPY"],
    ["1234.50", "USD", "1,234.50 USD"],
    ["0.05", "USD", "0.05 USD"],
    ["1000000.10", "USD", "1,000,000.10 USD"],
    ["9007199254740993", "JPY", "9,007,199,254,740,993 JPY"],
  ];
  for (const [amount, currency, text] of cases) {
    openSection(fakeStripeJs(), order({ price: { total: { amount, currency }, fx: null } }));
    await userEvent.setup().click(await screen.findByRole("button", { name: `付款 ${text}` }));
    assert.ok(await screen.findByText(`确认支付 ${text}？`), text);
    resetBrowser();
  }
});
