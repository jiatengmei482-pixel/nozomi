/**
 * Stripe 收款模块（M3-01，ADR 0026）。不连 Stripe：官方库的请求发到本机的假服务上，核对官方库真正发出去的请求
 * （金额是最小货币单位整数、币种小写、保存支付方式 off_session、挂在 Customer 上、带幂等键），以及超时、重试、错误码。
 * 密钥是测试里现场拼的假值（不是任何真实账号的密钥）。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import { PaymentProviderError, PaymentWebhookPayloadError } from "./payments.ts";
import { StripePaymentProvider, normalizeStripeEvent, paymentFromIntent } from "./stripe.ts";
import { StripeSignatureError, stripeSignatureHeader } from "./stripe-signature.ts";

interface Seen {
  method: string;
  path: string;
  headers: IncomingMessage["headers"];
  form: URLSearchParams;
}

type Handler = (seen: Seen) => { status: number; body: unknown; delayMs?: number };

let server: Server;
let port = 0;
let handler: Handler = () => ({ status: 500, body: {} });
const seen: Seen[] = [];

before(async () => {
  server = createServer((request: IncomingMessage, response: ServerResponse) => {
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => (raw += chunk));
    request.on("end", () => {
      const entry: Seen = { method: request.method ?? "", path: request.url ?? "", headers: request.headers, form: new URLSearchParams(raw) };
      seen.push(entry);
      const reply = handler(entry);
      const send = (): void => {
        if (response.destroyed) return;
        response.writeHead(reply.status, { "content-type": "application/json", "request-id": "req_test" });
        response.end(JSON.stringify(reply.body));
      };
      if (reply.delayMs) setTimeout(send, reply.delayMs).unref();
      else send();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  port = typeof address === "object" && address !== null ? address.port : 0;
});
after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const webhookSecret = `whsec_${randomBytes(16).toString("hex")}`;
const secretKey = `sk_test_${randomBytes(12).toString("hex")}`;
const provider = (options: { timeoutMs?: number; retries?: number } = {}): StripePaymentProvider =>
  new StripePaymentProvider(
    { secretKey, publishableKey: `pk_test_${randomBytes(12).toString("hex")}`, webhookSecret, mode: "test" },
    { endpoint: { host: "127.0.0.1", port, protocol: "http" }, timeoutMs: options.timeoutMs ?? 2_000, maxNetworkRetries: options.retries ?? 0 },
  );

const intent = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({ id: "pi_test_1", object: "payment_intent", amount: 21_978, currency: "jpy", status: "requires_payment_method", client_secret: "pi_test_1_secret_abc", customer: "cus_test_1", payment_method: null, livemode: false, ...extra });

const orderInput = { orderId: "6f1c2a9e-0b7d-4c1e-9a55-2f0d1e7b8c34", orderNo: "NZ20261007K3M9Q2XA", amountMinor: 21_978, currency: "JPY" as const, customer: { name: "王小明", email: "guest@example.com", phone: "+819012345678" }, description: "NOZOMI 订单 NZ20261007K3M9Q2XA" };

test("下单建付款：先建 Customer，再建 PaymentIntent（最小单位整数、币种小写、off_session 保存支付方式、只收卡），两次都带以订单为准的幂等键", async () => {
  seen.length = 0;
  handler = (request) => (request.path.startsWith("/v1/customers") ? { status: 200, body: { id: "cus_test_1", object: "customer" } } : { status: 200, body: intent() });
  const payment = await provider().createOrderPayment(orderInput);
  assert.deepEqual(payment, { intentId: "pi_test_1", customerId: "cus_test_1", clientSecret: "pi_test_1_secret_abc", status: "requires_payment_method", amountMinor: 21_978, currency: "JPY", paymentMethodId: null, livemode: false });
  assert.deepEqual(seen.map((s) => `${s.method} ${s.path}`), ["POST /v1/customers", "POST /v1/payment_intents"]);
  const [customer, created] = seen as [Seen, Seen];
  assert.equal(customer.headers["authorization"], `Bearer ${secretKey}`);
  assert.equal(customer.headers["idempotency-key"], `nozomi-order-${orderInput.orderId}-customer`);
  assert.deepEqual([customer.form.get("name"), customer.form.get("email"), customer.form.get("phone"), customer.form.get("metadata[order_no]")], ["王小明", "guest@example.com", "+819012345678", orderInput.orderNo]);
  assert.equal(created.headers["idempotency-key"], `nozomi-order-${orderInput.orderId}-payment`);
  assert.ok(typeof created.headers["stripe-version"] === "string" && created.headers["stripe-version"] !== "", "API 版本固定");
  assert.deepEqual(
    [created.form.get("amount"), created.form.get("currency"), created.form.get("customer"), created.form.get("setup_future_usage"), created.form.get("allowed_payment_method_types[0]"), created.form.get("metadata[order_id]")],
    ["21978", "jpy", "cus_test_1", "off_session", "card", orderInput.orderId],
  );
});

test("错误码：401 → PAYMENT_PROVIDER_AUTH_FAILED（不重试）；400 → PAYMENT_PROVIDER_REJECTED；429 → RATE_LIMITED；5xx 重试后 → UNAVAILABLE；异常里没有密钥", async () => {
  const failWith = async (status: number, body: unknown, retries = 0): Promise<PaymentProviderError> => {
    handler = () => ({ status, body });
    try {
      await provider({ retries }).retrievePayment("pi_test_1");
    } catch (err) {
      assert.ok(err instanceof PaymentProviderError, String(err));
      assert.ok(!JSON.stringify({ message: err.message, stack: err.stack }).includes(secretKey), "异常里不能有密钥");
      return err;
    }
    assert.fail("应当失败");
  };
  assert.equal((await failWith(401, { error: { type: "invalid_request_error", message: "Invalid API Key" } })).code, "PAYMENT_PROVIDER_AUTH_FAILED");
  const rejected = await failWith(400, { error: { type: "invalid_request_error", code: "amount_too_small", message: "x" } });
  assert.deepEqual([rejected.code, rejected.providerCode, rejected.retryable], ["PAYMENT_PROVIDER_REJECTED", "amount_too_small", false]);
  assert.equal((await failWith(429, { error: { type: "invalid_request_error", code: "rate_limit" } })).code, "PAYMENT_PROVIDER_RATE_LIMITED");
  seen.length = 0;
  const unavailable = await failWith(500, { error: { type: "api_error" } }, 1);
  assert.deepEqual([unavailable.code, unavailable.retryable], ["PAYMENT_PROVIDER_UNAVAILABLE", true]);
  assert.equal(seen.length, 2, "5xx 由官方库自动重试");
});

test("超时：超过设定的时限没有应答 → PAYMENT_PROVIDER_TIMEOUT", async () => {
  handler = () => ({ status: 200, body: intent(), delayMs: 1_500 });
  await assert.rejects(provider({ timeoutMs: 200 }).retrievePayment("pi_test_1"), (err: unknown) => err instanceof PaymentProviderError && err.code === "PAYMENT_PROVIDER_TIMEOUT" && err.retryable);
});

test("取消付款：能取消的返回已取消；已经付了的（Stripe 说状态不允许）不报错，查出它现在的状态", async () => {
  handler = (request) => (request.path.endsWith("/cancel") ? { status: 200, body: intent({ status: "canceled" }) } : { status: 500, body: {} });
  assert.equal((await provider().cancelPayment("pi_test_1")).status, "canceled");
  seen.length = 0;
  handler = (request) =>
    request.path.endsWith("/cancel")
      ? { status: 400, body: { error: { type: "invalid_request_error", code: "payment_intent_unexpected_state", message: "already succeeded" } } }
      : { status: 200, body: intent({ status: "succeeded", payment_method: "pm_test_1" }) };
  const paid = await provider().cancelPayment("pi_test_1");
  assert.deepEqual([paid.status, paid.paymentMethodId], ["succeeded", "pm_test_1"]);
  assert.deepEqual(seen.map((s) => `${s.method} ${s.path.split("?")[0]}`), ["POST /v1/payment_intents/pi_test_1/cancel", "GET /v1/payment_intents/pi_test_1"]);
  assert.equal(seen[0]?.form.get("cancellation_reason"), "abandoned");
});

const event = (type: string, object: Record<string, unknown>, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ id: "evt_test_1", object: "event", type, created: 1_791_334_800, livemode: false, data: { object }, ...extra });

test("通知整理：PaymentIntent（含失败原因）、退款、争议、看不懂的类型", () => {
  const succeeded = normalizeStripeEvent(event("payment_intent.succeeded", intent({ status: "succeeded", payment_method: { id: "pm_test_1", object: "payment_method" }, customer: { id: "cus_test_1" } })));
  assert.equal(succeeded.createdAt.toISOString(), "2026-10-07T01:00:00.000Z");
  assert.deepEqual(succeeded.object, { kind: "payment_intent", payment: { intentId: "pi_test_1", customerId: "cus_test_1", clientSecret: "pi_test_1_secret_abc", status: "succeeded", amountMinor: 21_978, currency: "JPY", paymentMethodId: "pm_test_1", livemode: false }, lastError: null });
  const failed = normalizeStripeEvent(event("payment_intent.payment_failed", intent({ last_payment_error: { code: "card_declined", decline_code: "insufficient_funds", message: "Your card has insufficient funds.", payment_method: { card: { last4: "9995" } } } })));
  assert.deepEqual(failed.object.kind === "payment_intent" ? failed.object.lastError : null, { code: "card_declined", declineCode: "insufficient_funds", message: "Your card has insufficient funds." });
  const refunded = normalizeStripeEvent(event("charge.refunded", { id: "ch_1", object: "charge", payment_intent: "pi_test_1", amount: 21_978, amount_refunded: 10_000, currency: "jpy", refunded: false }));
  assert.deepEqual(refunded.object, { kind: "charge", chargeId: "ch_1", intentId: "pi_test_1", amountMinor: 21_978, amountRefundedMinor: 10_000, currency: "JPY", refunded: false });
  const dispute = normalizeStripeEvent(event("charge.dispute.created", { id: "dp_1", object: "dispute", payment_intent: "pi_test_1", amount: 21_978, currency: "jpy", reason: "fraudulent", status: "needs_response" }));
  assert.deepEqual(dispute.object, { kind: "dispute", disputeId: "dp_1", intentId: "pi_test_1", amountMinor: 21_978, currency: "JPY", reason: "fraudulent", status: "needs_response" });
  assert.deepEqual(normalizeStripeEvent(event("customer.created", { id: "cus_1", object: "customer" })).object, { kind: "other", objectId: "cus_1" });
  for (const bad of [null, { object: "event" }, event("payment_intent.succeeded", { id: "x", object: "charge" }), event("payment_intent.succeeded", intent({ amount: 1.5 })), event("payment_intent.succeeded", intent({ status: "weird" })), { ...event("x", {}), created: "yesterday" }]) {
    assert.throws(() => normalizeStripeEvent(bad), PaymentWebhookPayloadError, JSON.stringify(bad));
  }
  assert.throws(() => paymentFromIntent({ id: "pi_1", object: "payment_intent", amount: 1, status: "succeeded" }), PaymentWebhookPayloadError, "缺币种");
});

test("parseWebhook：用配置的 whsec 密钥校验签名再整理；签名不对、内容不是 JSON 各有各的异常", () => {
  const now = new Date("2026-10-07T01:00:10.000Z");
  const body = Buffer.from(JSON.stringify(event("payment_intent.succeeded", intent({ status: "succeeded" }))));
  const header = stripeSignatureHeader(body, webhookSecret, Math.floor(now.getTime() / 1000));
  assert.equal(provider().parseWebhook(body, header, now).type, "payment_intent.succeeded");
  assert.throws(() => provider().parseWebhook(body, stripeSignatureHeader(body, `whsec_${randomBytes(16).toString("hex")}`, Math.floor(now.getTime() / 1000)), now), StripeSignatureError);
  assert.throws(() => provider().parseWebhook(body, undefined, now), StripeSignatureError);
  const notJson = Buffer.from("{not json");
  assert.throws(() => provider().parseWebhook(notJson, stripeSignatureHeader(notJson, webhookSecret, Math.floor(now.getTime() / 1000)), now), PaymentWebhookPayloadError);
});

// ---- M3-03：离线扣款、退款 ----

const chargeInput = { paymentId: "11111111-2222-4333-8444-555555555555", orderId: orderInput.orderId, orderNo: orderInput.orderNo, customerId: "cus_test_1", paymentMethodId: "pm_test_1", amountMinor: 2_200, currency: "JPY" as const, description: "NOZOMI 服务后加收", purpose: "extra_charge" as const };

test("离线扣款：PaymentIntent 挂在下单时的 Customer 上、用保存的 PaymentMethod、off_session + confirm，幂等键以收款记录为准；成功、处理中照实返回", async () => {
  seen.length = 0;
  handler = () => ({ status: 200, body: intent({ id: "pi_extra_1", amount: 2_200, status: "succeeded", payment_method: "pm_test_1" }) });
  const result = await provider().chargeSavedPaymentMethod(chargeInput);
  assert.equal(result.outcome, "succeeded");
  const [created] = seen as [Seen];
  assert.equal(`${created.method} ${created.path}`, "POST /v1/payment_intents");
  assert.equal(created.headers["idempotency-key"], `nozomi-charge-${chargeInput.paymentId}`);
  assert.deepEqual(
    [created.form.get("amount"), created.form.get("currency"), created.form.get("customer"), created.form.get("payment_method"), created.form.get("off_session"), created.form.get("confirm"), created.form.get("metadata[purpose]"), created.form.get("metadata[payment_id]")],
    ["2200", "jpy", "cus_test_1", "pm_test_1", "true", "true", "extra_charge", chargeInput.paymentId],
  );
  handler = () => ({ status: 200, body: intent({ id: "pi_extra_2", status: "processing" }) });
  assert.equal((await provider().chargeSavedPaymentMethod(chargeInput)).outcome, "processing");
});

test("离线扣款被拒：卡被拒、要客人验证（Stripe 的 card_error）返回 declined 和拒绝代码，不当作收款服务出错；别的错误照样是 PaymentProviderError", async () => {
  handler = () => ({ status: 402, body: { error: { type: "card_error", code: "card_declined", decline_code: "insufficient_funds", message: "Your card has insufficient funds.", payment_intent: { id: "pi_declined_1", object: "payment_intent" } } } });
  const declined = await provider().chargeSavedPaymentMethod(chargeInput);
  assert.deepEqual(declined, { outcome: "declined", intentId: "pi_declined_1", error: { code: "card_declined", declineCode: "insufficient_funds", message: null } });
  handler = () => ({ status: 402, body: { error: { type: "card_error", code: "authentication_required", message: "This payment requires authentication." } } });
  const auth = await provider().chargeSavedPaymentMethod(chargeInput);
  assert.deepEqual(auth, { outcome: "declined", intentId: null, error: { code: "authentication_required", declineCode: null, message: null } });
  handler = () => ({ status: 200, body: intent({ id: "pi_action", status: "requires_action" }) });
  assert.deepEqual(await provider().chargeSavedPaymentMethod(chargeInput), { outcome: "declined", intentId: "pi_action", error: { code: "authentication_required", declineCode: null, message: null } });
  handler = () => ({ status: 500, body: { error: { type: "api_error" } } });
  await assert.rejects(provider().chargeSavedPaymentMethod(chargeInput), (err: unknown) => err instanceof PaymentProviderError && err.code === "PAYMENT_PROVIDER_UNAVAILABLE");
});

test("退款：对着一笔 PaymentIntent、指定金额，幂等键以退款记录为准；返回的状态照实整理；看不懂的状态拒绝", async () => {
  seen.length = 0;
  handler = () => ({ status: 200, body: { id: "re_1", object: "refund", amount: 10_890, currency: "jpy", payment_intent: "pi_test_1", status: "succeeded", failure_reason: null } });
  const refund = await provider().refundPayment({ refundId: "99999999-2222-4333-8444-555555555555", intentId: "pi_test_1", amountMinor: 10_890, orderId: orderInput.orderId, orderNo: orderInput.orderNo });
  assert.deepEqual(refund, { refundId: "re_1", intentId: "pi_test_1", status: "succeeded", amountMinor: 10_890, currency: "JPY", failureReason: null });
  const [created] = seen as [Seen];
  assert.equal(`${created.method} ${created.path}`, "POST /v1/refunds");
  assert.equal(created.headers["idempotency-key"], "nozomi-refund-99999999-2222-4333-8444-555555555555");
  assert.deepEqual([created.form.get("payment_intent"), created.form.get("amount"), created.form.get("reason"), created.form.get("metadata[order_no]")], ["pi_test_1", "10890", "requested_by_customer", orderInput.orderNo]);
  handler = () => ({ status: 400, body: { error: { type: "invalid_request_error", code: "charge_already_refunded", message: "x" } } });
  await assert.rejects(provider().refundPayment({ refundId: "x", intentId: "pi_test_1", amountMinor: 1, orderId: orderInput.orderId, orderNo: orderInput.orderNo }), (err: unknown) => err instanceof PaymentProviderError && err.code === "PAYMENT_PROVIDER_REJECTED" && err.providerCode === "charge_already_refunded");
});

test("退款的通知（refund.updated / refund.failed / charge.refund.updated）整理成 refund；状态看不懂的拒绝", () => {
  const object = { id: "re_2", object: "refund", amount: 500, currency: "usd", payment_intent: { id: "pi_x" }, status: "failed", failure_reason: "expired_or_canceled_card" };
  for (const type of ["refund.updated", "refund.failed", "charge.refund.updated"]) {
    assert.deepEqual(normalizeStripeEvent(event(type, object)).object, { kind: "refund", refund: { refundId: "re_2", intentId: "pi_x", status: "failed", amountMinor: 500, currency: "USD", failureReason: "expired_or_canceled_card" } });
  }
  assert.throws(() => normalizeStripeEvent(event("refund.updated", { ...object, status: "weird" })), PaymentWebhookPayloadError);
  assert.throws(() => normalizeStripeEvent(event("refund.updated", { ...object, object: "charge" })), PaymentWebhookPayloadError);
});
