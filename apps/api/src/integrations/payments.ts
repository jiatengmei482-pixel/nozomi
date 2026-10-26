/**
 * 收款服务的接口（M3-01，ADR 0026）。真实实现是 Stripe（integrations/stripe.ts）；单元测试、集成测试用替身（testing/payments.ts）。
 * 业务流程（services/orders.ts、services/payment-webhooks.ts）只认这个接口，不直接碰 Stripe 的库。
 *
 * 约定：
 * - 金额是最小货币单位整数（规则 3），币种是大写的三位代码；和 Stripe 之间的换算（小写币种、零小数币种）在实现里做。
 * - 每个调用自己有超时和重试；失败抛 `PaymentProviderError`，错误码见下，不把原始异常（可能带密钥、请求原文）往外抛。
 * - 支付方式要保存下来用于服务后加收（第五轮决策 ⑤：Stripe PaymentIntent 带 `setup_future_usage: off_session`，挂在一个 Customer 上）。
 * - M3-03（ADR 0029）：用保存的支付方式离线扣款（改期补差价、事后加收），按一笔付款退款（取消、改期的差价）。两者都带以平台记录编号为准的幂等键，重试不会扣两次、退两次。
 */
import type { CurrencyCode, PaymentIntentStatus } from "@nozomi/domain";

/** 支付服务里的一笔付款（Stripe 的 PaymentIntent）。 */
export interface ProviderPayment {
  intentId: string;
  /** 付款挂在哪个客户（Stripe Customer）上：保存下来的支付方式属于它，事后加收用 */
  customerId: string | null;
  /** 给前端确认付款用的一次性凭据（Stripe 的 client_secret）。不存库、不写日志，只在下单的应答里交给渠道 */
  clientSecret: string | null;
  status: PaymentIntentStatus;
  amountMinor: number;
  currency: string;
  /** 付款成功后保存下来的支付方式 */
  paymentMethodId: string | null;
  livemode: boolean;
}

/** 付款失败的原因（Stripe 的 last_payment_error）：只留代码和说明，不留卡号片段这类信息。 */
export interface ProviderPaymentError {
  code: string | null;
  declineCode: string | null;
  message: string | null;
}

/** 收款服务里的一笔退款（Stripe 的 Refund）。`pending` 处理中（有的支付方式要几天）；`requires_action` 要客人提供信息（银行卡退款不会出现，出现了当处理中）。 */
export interface ProviderRefund {
  refundId: string;
  intentId: string | null;
  status: "pending" | "succeeded" | "failed" | "canceled" | "requires_action";
  amountMinor: number;
  currency: string;
  /** 失败的原因（Stripe 的 failure_reason，如 `expired_or_canceled_card`） */
  failureReason: string | null;
}

export type PaymentWebhookObject =
  | { kind: "payment_intent"; payment: ProviderPayment; lastError: ProviderPaymentError | null }
  | { kind: "refund"; refund: ProviderRefund }
  | { kind: "charge"; chargeId: string; intentId: string | null; amountMinor: number; amountRefundedMinor: number; currency: string; refunded: boolean }
  | { kind: "dispute"; disputeId: string; intentId: string | null; amountMinor: number; currency: string; reason: string | null; status: string | null }
  | { kind: "other"; objectId: string | null };

/** 一条已经验过签名的通知。 */
export interface PaymentWebhookEvent {
  id: string;
  type: string;
  livemode: boolean;
  createdAt: Date;
  object: PaymentWebhookObject;
}

export interface CreateOrderPaymentInput {
  orderId: string;
  orderNo: string;
  amountMinor: number;
  currency: CurrencyCode;
  customer: { name: string; email: string; phone: string };
  description: string;
}

/** 用保存的支付方式离线扣一笔（改期补差价、事后加收）。 */
export interface OffSessionChargeInput {
  /** 平台的收款记录编号：幂等键以它为准，同一笔重试不会扣两次 */
  paymentId: string;
  orderId: string;
  orderNo: string;
  customerId: string;
  paymentMethodId: string;
  amountMinor: number;
  currency: CurrencyCode;
  description: string;
  purpose: "change" | "extra_charge";
}

/**
 * 离线扣款的结果：
 * - `succeeded` 扣到了；`processing` 收款服务还在处理（结果等通知）；
 * - `declined` 没扣到：卡被拒、余额不足、要客人自己验证（3DS，离线时做不了）。这不是收款服务出错，重试也没用，要人处理。
 * 收款服务本身出错（超时、连不上、限流）照样抛 `PaymentProviderError`，可以稍后重试。
 */
export type OffSessionChargeResult =
  | { outcome: "succeeded" | "processing"; payment: ProviderPayment }
  | { outcome: "declined"; intentId: string | null; error: ProviderPaymentError };

export interface RefundInput {
  /** 平台的退款记录编号：幂等键以它为准 */
  refundId: string;
  intentId: string;
  amountMinor: number;
  orderId: string;
  orderNo: string;
}

export interface PaymentProvider {
  readonly name: "stripe";
  /** 前端用的公开密钥（Stripe publishable key，本来就要发给浏览器） */
  readonly publishableKey: string;
  /** 正式模式（live）还是测试模式；通知的 livemode 对不上的不处理 */
  readonly livemode: boolean;
  /**
   * 为一张订单建付款：先建客户（Customer），再建 PaymentIntent（保存支付方式用于事后加收）。
   * 对同一张订单重复调用得到同一笔付款（实现里用以订单编号为准的幂等键）。
   */
  createOrderPayment(input: CreateOrderPaymentInput): Promise<ProviderPayment>;
  retrievePayment(intentId: string): Promise<ProviderPayment>;
  /** 取消一笔还没付的付款。已经付了（或者已经取消了）不报错，返回它现在的状态，由调用方决定怎么办。 */
  cancelPayment(intentId: string): Promise<ProviderPayment>;
  /** 用保存的支付方式离线扣款（M3-03）。 */
  chargeSavedPaymentMethod(input: OffSessionChargeInput): Promise<OffSessionChargeResult>;
  /** 对一笔已付的付款退一部分或全部（M3-03）。 */
  refundPayment(input: RefundInput): Promise<ProviderRefund>;
  /** 校验通知的签名并解析；签名不对抛 `StripeSignatureError`，内容不是一条通知抛 `PaymentWebhookPayloadError`。 */
  parseWebhook(rawBody: Buffer, signature: string | undefined, now: Date): PaymentWebhookEvent;
}

export type PaymentProviderErrorCode =
  /** 等了太久没有结果（已按超时重试过） */
  | "PAYMENT_PROVIDER_TIMEOUT"
  /** 连不上、对方出错（5xx），已重试过 */
  | "PAYMENT_PROVIDER_UNAVAILABLE"
  /** 对方限流（429），已重试过 */
  | "PAYMENT_PROVIDER_RATE_LIMITED"
  /** 密钥不对或权限不够：配置的问题，重试没有用 */
  | "PAYMENT_PROVIDER_AUTH_FAILED"
  /** 对方拒绝了这个请求（参数不对、状态不允许）：重试没有用 */
  | "PAYMENT_PROVIDER_REJECTED";

export class PaymentProviderError extends Error {
  readonly code: PaymentProviderErrorCode;
  /** 支付服务自己的错误代码（如 Stripe 的 `amount_too_small`），只用于日志和排查 */
  readonly providerCode: string | null;
  constructor(code: PaymentProviderErrorCode, message: string, providerCode: string | null = null) {
    super(message);
    this.name = "PaymentProviderError";
    this.code = code;
    this.providerCode = providerCode;
  }

  /** 稍后再试可能就好了（超时、连不上、限流）；密钥不对、请求被拒绝重试也没用 */
  get retryable(): boolean {
    return this.code === "PAYMENT_PROVIDER_TIMEOUT" || this.code === "PAYMENT_PROVIDER_UNAVAILABLE" || this.code === "PAYMENT_PROVIDER_RATE_LIMITED";
  }
}

/** 通知的内容不是一条看得懂的事件（签名是对的，但 JSON 坏了、缺字段）。 */
export class PaymentWebhookPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentWebhookPayloadError";
  }
}
