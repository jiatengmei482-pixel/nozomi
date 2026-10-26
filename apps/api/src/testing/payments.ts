/**
 * 收款服务的替身（集成测试用；测试从不连 Stripe）。在内存里记付款，行为照 Stripe：
 * - 对同一张订单重复建付款得到同一笔（相当于 Stripe 的幂等键）；
 * - 已付、已取消的付款再取消不报错，返回它现在的状态；
 * - 通知用和真实实现**同一套**签名校验（stripe-signature.ts）和事件整理（stripe.ts 的 `normalizeStripeEvent`），
 *   签名密钥是测试里现场生成的，测试用 `signedWebhook` 按 Stripe 的格式生成通知和 `Stripe-Signature` 请求头。
 * 可以让下一次调用失败（`failNext`），模拟超时、连不上。
 * M3-03：离线扣款（同一个收款记录编号重复调用得到同一笔，相当于幂等键）、可以让接下来的离线扣款被拒（`declineNextCharge`）；
 * 退款（同一个退款记录编号重复调用得到同一笔；退款不能超过这笔付款还没退的部分，和 Stripe 一样拒绝；可以让下一笔退款处于 pending / failed）。
 */
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { PaymentIntentStatus } from "@nozomi/domain";
import {
  type CreateOrderPaymentInput,
  type OffSessionChargeInput,
  type OffSessionChargeResult,
  type PaymentProvider,
  PaymentProviderError,
  type PaymentProviderErrorCode,
  type PaymentWebhookEvent,
  PaymentWebhookPayloadError,
  type ProviderPayment,
  type ProviderRefund,
  type RefundInput,
} from "../integrations/payments.ts";
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
  /** 离线扣款的请求（下单的付款为 null） */
  charge: OffSessionChargeInput | null;
  /** 离线扣款的收款记录编号（下单的付款为 null） */
  paymentId: string | null;
  refundedMinor: number;
}

export interface FakeRefund {
  id: string;
  refundRecordId: string;
  intentId: string;
  amountMinor: number;
  currency: string;
  status: ProviderRefund["status"];
  failureReason: string | null;
}

export class FakePaymentProvider implements PaymentProvider {
  readonly name = "stripe" as const;
  readonly publishableKey = `pk_test_fake${randomBytes(6).toString("hex")}`;
  readonly livemode = false;
  readonly webhookSecret = `whsec_${randomBytes(18).toString("hex")}`;
  readonly intents = new Map<string, FakeIntent>();
  /** 每次调用：`create:订单号`、`retrieve:付款编号`、`cancel:付款编号` */
  readonly calls: string[] = [];
  readonly refunds = new Map<string, FakeRefund>();
  private failures: PaymentProviderErrorCode[] = [];
  private declines: { code: string; declineCode: string | null }[] = [];
  private refundOutcomes: { status: ProviderRefund["status"]; failureReason: string | null }[] = [];
  private eventSeq = 0;

  /** 让接下来的几次调用失败（按顺序） */
  failNext(...codes: PaymentProviderErrorCode[]): void {
    this.failures.push(...codes);
  }

  /** 接下来的离线扣款被拒（按顺序）：如 `card_declined` / `insufficient_funds`、`authentication_required` */
  declineNextCharge(code = "card_declined", declineCode: string | null = "insufficient_funds"): void {
    this.declines.push({ code, declineCode });
  }

  /** 接下来的退款不是马上成功，而是这个状态（`pending` 等通知、`failed` 退款失败） */
  nextRefundIs(status: ProviderRefund["status"], failureReason: string | null = null): void {
    this.refundOutcomes.push({ status, failureReason });
  }

  private maybeFail(): void {
    const code = this.failures.shift();
    if (code !== undefined) throw new PaymentProviderError(code, `替身模拟的失败：${code}`);
  }

  private view(intent: FakeIntent): ProviderPayment {
    return { intentId: intent.id, customerId: intent.customerId, clientSecret: intent.clientSecret, status: intent.status, amountMinor: intent.amountMinor, currency: intent.currency, paymentMethodId: intent.paymentMethodId, livemode: false };
  }

  /** 这张单下单时的付款（不含离线扣款） */
  intentOf(orderId: string): FakeIntent | undefined {
    return [...this.intents.values()].find((intent) => intent.orderId === orderId && intent.paymentId === null);
  }

  /** 这张单的离线扣款（改期补差价、事后加收），按建的先后 */
  chargesOf(orderId: string): FakeIntent[] {
    return [...this.intents.values()].filter((intent) => intent.orderId === orderId && intent.paymentId !== null);
  }

  /** 这张单的全部退款 */
  refundsOf(orderId: string): FakeRefund[] {
    const intents = new Set([...this.intents.values()].filter((intent) => intent.orderId === orderId).map((intent) => intent.id));
    return [...this.refunds.values()].filter((refund) => intents.has(refund.intentId));
  }

  async createOrderPayment(input: CreateOrderPaymentInput): Promise<ProviderPayment> {
    this.calls.push(`create:${input.orderNo}`);
    this.maybeFail();
    const existing = this.intentOf(input.orderId);
    if (existing !== undefined) return this.view(existing);
    const id = `pi_fake_${randomBytes(8).toString("hex")}`;
    const intent: FakeIntent = { id, orderId: input.orderId, customerId: `cus_fake_${randomBytes(6).toString("hex")}`, clientSecret: `${id}_secret_${randomBytes(8).toString("hex")}`, status: "requires_payment_method", amountMinor: input.amountMinor, currency: input.currency, paymentMethodId: null, lastError: null, input, charge: null, paymentId: null, refundedMinor: 0 };
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

  async chargeSavedPaymentMethod(input: OffSessionChargeInput): Promise<OffSessionChargeResult> {
    this.calls.push(`charge:${input.paymentId}`);
    this.maybeFail();
    const existing = [...this.intents.values()].find((intent) => intent.paymentId === input.paymentId);
    const intent: FakeIntent = existing ?? {
      id: `pi_fake_${randomBytes(8).toString("hex")}`,
      orderId: input.orderId,
      customerId: input.customerId,
      clientSecret: `pi_secret_${randomBytes(8).toString("hex")}`,
      status: "requires_payment_method",
      amountMinor: input.amountMinor,
      currency: input.currency,
      paymentMethodId: input.paymentMethodId,
      lastError: null,
      input: { orderId: input.orderId, orderNo: input.orderNo, amountMinor: input.amountMinor, currency: input.currency, customer: { name: "", email: "", phone: "" }, description: input.description },
      charge: input,
      paymentId: input.paymentId,
      refundedMinor: 0,
    };
    if (existing === undefined) {
      this.intents.set(intent.id, intent);
      const decline = this.declines.shift();
      if (decline === undefined) intent.status = "succeeded";
      else intent.lastError = { code: decline.code, decline_code: decline.declineCode, message: "The card was declined." };
    }
    if (intent.status === "succeeded") return { outcome: "succeeded", payment: this.view(intent) };
    const error = intent.lastError as NonNullable<FakeIntent["lastError"]>;
    return { outcome: "declined", intentId: intent.id, error: { code: error.code, declineCode: error.decline_code, message: null } };
  }

  async refundPayment(input: RefundInput): Promise<ProviderRefund> {
    this.calls.push(`refund:${input.refundId}`);
    this.maybeFail();
    const existing = [...this.refunds.values()].find((refund) => refund.refundRecordId === input.refundId);
    if (existing !== undefined) return this.refundView(existing);
    const intent = this.intents.get(input.intentId);
    if (intent === undefined || intent.status !== "succeeded") throw new PaymentProviderError("PAYMENT_PROVIDER_REJECTED", "这笔付款没有付成功，不能退款", "charge_not_refundable");
    if (input.amountMinor <= 0 || input.amountMinor > intent.amountMinor - intent.refundedMinor) throw new PaymentProviderError("PAYMENT_PROVIDER_REJECTED", "退款金额超过了这笔付款还能退的部分", "amount_too_large");
    const outcome = this.refundOutcomes.shift() ?? { status: "succeeded" as const, failureReason: null };
    const refund: FakeRefund = { id: `re_fake_${randomBytes(8).toString("hex")}`, refundRecordId: input.refundId, intentId: intent.id, amountMinor: input.amountMinor, currency: intent.currency, status: outcome.status, failureReason: outcome.failureReason };
    if (refund.status !== "failed" && refund.status !== "canceled") intent.refundedMinor += input.amountMinor;
    this.refunds.set(refund.id, refund);
    return this.refundView(refund);
  }

  private refundView(refund: FakeRefund): ProviderRefund {
    return { refundId: refund.id, intentId: refund.intentId, status: refund.status, amountMinor: refund.amountMinor, currency: refund.currency, failureReason: refund.failureReason };
  }

  /** 这笔退款现在的样子，写成 Stripe 的 Refund 对象（通知用）。 */
  refundObject(refundId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const refund = this.refunds.get(refundId) as FakeRefund;
    return { id: refund.id, object: "refund", amount: refund.amountMinor, currency: refund.currency.toLowerCase(), payment_intent: refund.intentId, status: refund.status, failure_reason: refund.failureReason, ...overrides };
  }

  /** 收款服务那边一笔退款后来有了结果（`pending` 的退款成功或失败） */
  settleRefund(refundId: string, status: "succeeded" | "failed", failureReason: string | null = null): void {
    const refund = this.refunds.get(refundId) as FakeRefund;
    const intent = this.intents.get(refund.intentId) as FakeIntent;
    if (status === "failed" && refund.status !== "failed") intent.refundedMinor -= refund.amountMinor;
    refund.status = status;
    refund.failureReason = failureReason;
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
      metadata: { order_id: intent.orderId, order_no: intent.input.orderNo, ...(intent.paymentId === null ? {} : { payment_id: intent.paymentId }) },
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
