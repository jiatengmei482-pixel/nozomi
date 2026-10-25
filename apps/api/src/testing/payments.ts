/**
 * 收款服务的替身（集成测试用；测试从不连 Stripe）。在内存里记付款，行为照 Stripe：
 * - 对同一张订单重复建付款得到同一笔（相当于 Stripe 的幂等键）；
 * - 已付、已取消的付款再取消不报错，返回它现在的状态；
 * - 通知用和真实实现**同一套**签名校验（stripe-signature.ts）和事件整理（stripe.ts 的 `normalizeStripeEvent`），
 *   签名密钥是测试里现场生成的，测试用 `signedWebhook` 按 Stripe 的格式生成通知和 `Stripe-Signature` 请求头。
 * 可以让下一次调用失败（`failNext`），模拟超时、连不上。
 */
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { PaymentIntentStatus } from "@nozomi/domain";
import { type CreateOrderPaymentInput, type PaymentProvider, PaymentProviderError, type PaymentProviderErrorCode, type PaymentWebhookEvent, PaymentWebhookPayloadError, type ProviderPayment } from "../integrations/payments.ts";
import { normalizeStripeEvent } from "../integrations/stripe.ts";
import { stripeSignatureHeader, verifyStripeSignature } from "../integrations/stripe-signature.ts";

interface FakeIntent {
  id: string;
  orderId: string;
  customerId: string;
  clientSecret: string;
  status: PaymentIntentStatus;
  amountMinor: number;
  currency: string;
  paymentMethodId: string | null;
  lastError: { code: string; decline_code: string | null; message: string } | null;
  input: CreateOrderPaymentInput;
}

export class FakePaymentProvider implements PaymentProvider {
  readonly name = "stripe" as const;
  readonly publishableKey = `pk_test_fake${randomBytes(6).toString("hex")}`;
  readonly livemode = false;
  readonly webhookSecret = `whsec_${randomBytes(18).toString("hex")}`;
  readonly intents = new Map<string, FakeIntent>();
  /** 每次调用：`create:订单号`、`retrieve:付款编号`、`cancel:付款编号` */
  readonly calls: string[] = [];
  private failures: PaymentProviderErrorCode[] = [];
  private eventSeq = 0;

  /** 让接下来的几次调用失败（按顺序） */
  failNext(...codes: PaymentProviderErrorCode[]): void {
    this.failures.push(...codes);
  }

  private maybeFail(): void {
    const code = this.failures.shift();
    if (code !== undefined) throw new PaymentProviderError(code, `替身模拟的失败：${code}`);
  }

  private view(intent: FakeIntent): ProviderPayment {
    return { intentId: intent.id, customerId: intent.customerId, clientSecret: intent.clientSecret, status: intent.status, amountMinor: intent.amountMinor, currency: intent.currency, paymentMethodId: intent.paymentMethodId, livemode: false };
  }

  intentOf(orderId: string): FakeIntent | undefined {
    return [...this.intents.values()].find((intent) => intent.orderId === orderId);
  }

  async createOrderPayment(input: CreateOrderPaymentInput): Promise<ProviderPayment> {
    this.calls.push(`create:${input.orderNo}`);
    this.maybeFail();
    const existing = this.intentOf(input.orderId);
    if (existing !== undefined) return this.view(existing);
    const id = `pi_fake_${randomBytes(8).toString("hex")}`;
    const intent: FakeIntent = { id, orderId: input.orderId, customerId: `cus_fake_${randomBytes(6).toString("hex")}`, clientSecret: `${id}_secret_${randomBytes(8).toString("hex")}`, status: "requires_payment_method", amountMinor: input.amountMinor, currency: input.currency, paymentMethodId: null, lastError: null, input };
    this.intents.set(id, intent);
    return this.view(intent);
  }

  async retrievePayment(intentId: string): Promise<ProviderPayment> {
    this.calls.push(`retrieve:${intentId}`);
    this.maybeFail();
    const intent = this.intents.get(intentId);
    if (intent === undefined) throw new PaymentProviderError("PAYMENT_PROVIDER_REJECTED", "没有这笔付款", "resource_missing");
    return this.view(intent);
  }

  async cancelPayment(intentId: string): Promise<ProviderPayment> {
    this.calls.push(`cancel:${intentId}`);
    this.maybeFail();
    const intent = this.intents.get(intentId);
    if (intent === undefined) throw new PaymentProviderError("PAYMENT_PROVIDER_REJECTED", "没有这笔付款", "resource_missing");
    if (intent.status !== "succeeded" && intent.status !== "canceled" && intent.status !== "processing") intent.status = "canceled";
    return this.view(intent);
  }

  parseWebhook(rawBody: Buffer, signature: string | undefined, now: Date): PaymentWebhookEvent {
    verifyStripeSignature(rawBody, signature, this.webhookSecret, now);
    let raw: unknown;
    try {
      raw = JSON.parse(rawBody.toString("utf8"));
    } catch {
      throw new PaymentWebhookPayloadError("通知的内容不是 JSON");
    }
    return normalizeStripeEvent(raw);
  }

  // ---- 测试用：模拟客人付款，生成 Stripe 格式的通知 ----

  /** 客人用卡付款成功（4242 卡）：付款变成已成功、保存了支付方式。 */
  pay(intentId: string): void {
    const intent = this.intents.get(intentId) as FakeIntent;
    intent.status = "succeeded";
    intent.paymentMethodId = `pm_fake_${randomBytes(6).toString("hex")}`;
    intent.lastError = null;
  }

  /** 卡被拒（如 4000 0000 0000 9995 余额不足）：付款回到「等客人付款」，带失败原因。 */
  decline(intentId: string, declineCode = "insufficient_funds"): void {
    const intent = this.intents.get(intentId) as FakeIntent;
    intent.status = "requires_payment_method";
    intent.lastError = { code: "card_declined", decline_code: declineCode, message: "Your card was declined." };
  }

  /** 这笔付款现在的样子，写成 Stripe 的 PaymentIntent 对象。 */
  intentObject(intentId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const intent = this.intents.get(intentId) as FakeIntent;
    return {
      id: intent.id,
      object: "payment_intent",
      amount: intent.amountMinor,
      currency: intent.currency.toLowerCase(),
      status: intent.status,
      client_secret: intent.clientSecret,
      customer: intent.customerId,
      payment_method: intent.paymentMethodId,
      setup_future_usage: "off_session",
      last_payment_error: intent.lastError,
      livemode: false,
      metadata: { order_id: intent.orderId, order_no: intent.input.orderNo },
      ...overrides,
    };
  }

  /** 一条 Stripe 格式的事件（JSON 原文）。不给 `id` 时每次生成一个新的事件编号。 */
  event(type: string, object: Record<string, unknown>, options: { id?: string; created?: Date; livemode?: boolean } = {}): string {
    this.eventSeq += 1;
    return JSON.stringify({
      id: options.id ?? `evt_fake_${this.eventSeq}_${randomBytes(4).toString("hex")}`,
      object: "event",
      api_version: "2026-09-30",
      created: Math.floor((options.created ?? new Date()).getTime() / 1000),
      livemode: options.livemode ?? false,
      type,
      data: { object },
    });
  }

  /** 给一条通知按 Stripe 的算法签名（用这个替身的 whsec 密钥），返回 `Stripe-Signature` 请求头。 */
  sign(body: string, at: Date, secret: string = this.webhookSecret): string {
    return stripeSignatureHeader(body, secret, Math.floor(at.getTime() / 1000));
  }
}

/** 把一条通知发给 `POST /webhooks/stripe`（原始请求体 + 签名头），返回状态码和应答。 */
export async function deliverWebhook(app: FastifyInstance, body: string, signature: string | undefined): Promise<{ status: number; body: any }> {
  const res = await app.inject({ method: "POST", url: "/webhooks/stripe", headers: { "content-type": "application/json", ...(signature === undefined ? {} : { "stripe-signature": signature }) }, payload: body });
  let parsed: unknown = null;
  try {
    parsed = res.json();
  } catch {
    parsed = null;
  }
  return { status: res.statusCode, body: parsed };
}
