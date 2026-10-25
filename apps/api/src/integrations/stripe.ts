/**
 * Stripe 收款（M3-01，ADR 0026）：`PaymentProvider` 的真实实现，用 Stripe 官方库 `stripe`。
 *
 * - 下单：先建 Customer（姓名、邮箱、电话、订单号），再建 PaymentIntent：金额是最小货币单位整数（日元、韩元就是元，人民币、美元是分，和平台的最小单位一致）、
 *   `setup_future_usage: "off_session"`（付款成功后支付方式保存在这个 Customer 上，服务后加收用，第五轮决策 ⑤）、只收银行卡（事后加收要能离线扣款）。
 *   两次调用都带以订单编号为准的幂等键：重试、重放不会建出第二笔。
 * - 超时：每次请求最多 10 秒；网络错误、超时、409、429、5xx 由官方库自动重试 2 次（带幂等键，安全）。
 * - 错误码：`PAYMENT_PROVIDER_TIMEOUT` / `_UNAVAILABLE` / `_RATE_LIMITED` / `_AUTH_FAILED` / `_REJECTED`。原始异常不往外抛（里面可能有请求原文），
 *   只留 Stripe 的错误代码和请求编号进日志。
 * - Webhook：签名用 stripe-signature.ts 自己的实现校验（与官方库的算法一致，有不连网络的单元测试），再把事件整理成 `PaymentWebhookEvent`。
 * API 版本固定为这一版官方库对应的版本（`Stripe.API_VERSION`），不跟着 Stripe 账户的默认版本走：升级官方库时一起升级、一起测。
 */
import Stripe from "stripe";
import { PAYMENT_INTENT_STATUSES, type PaymentIntentStatus } from "@nozomi/domain";
import type { StripeConfig } from "@nozomi/config";
import { type CreateOrderPaymentInput, type PaymentProvider, PaymentProviderError, type PaymentWebhookEvent, type PaymentWebhookObject, PaymentWebhookPayloadError, type ProviderPayment, type ProviderPaymentError } from "./payments.ts";
import { verifyStripeSignature } from "./stripe-signature.ts";

/** 每次请求最多等多久（毫秒） */
export const STRIPE_TIMEOUT_MS = 10_000;
/** 官方库自动重试几次 */
export const STRIPE_MAX_NETWORK_RETRIES = 2;

export interface StripeProviderOptions {
  timeoutMs?: number;
  maxNetworkRetries?: number;
  /** 只给单元测试用：把请求发到本机的假服务上（不连 Stripe） */
  endpoint?: { host: string; port: number; protocol: "http" | "https" };
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
/** Stripe 的字段可能是编号，也可能是展开后的对象（`expand`）：两种都取出编号。 */
const idOf = (value: unknown): string | null => (typeof value === "string" ? value : isObject(value) ? text(value["id"]) : null);
const integer = (value: unknown, field: string): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new PaymentWebhookPayloadError(`${field} 不是整数`);
  return value;
};

/** PaymentIntent（API 应答或通知里的对象）→ `ProviderPayment`。 */
export function paymentFromIntent(intent: Json): ProviderPayment {
  const id = text(intent["id"]);
  if (id === null || intent["object"] !== "payment_intent") throw new PaymentWebhookPayloadError("不是一个 PaymentIntent");
  const status = intent["status"];
  if (typeof status !== "string" || !(PAYMENT_INTENT_STATUSES as readonly string[]).includes(status)) throw new PaymentWebhookPayloadError(`PaymentIntent 的状态看不懂：${String(status)}`);
  const currency = text(intent["currency"]);
  if (currency === null) throw new PaymentWebhookPayloadError("PaymentIntent 缺币种");
  return {
    intentId: id,
    customerId: idOf(intent["customer"]),
    clientSecret: text(intent["client_secret"]),
    status: status as PaymentIntentStatus,
    amountMinor: integer(intent["amount"], "amount"),
    currency: currency.toUpperCase(),
    paymentMethodId: idOf(intent["payment_method"]),
    livemode: intent["livemode"] === true,
  };
}

function lastErrorOf(intent: Json): ProviderPaymentError | null {
  const error = intent["last_payment_error"];
  if (!isObject(error)) return null;
  return { code: text(error["code"]), declineCode: text(error["decline_code"]), message: text(error["message"]) };
}

/** 通知里的 `data.object` 按事件类型整理。看不懂的类型归为 `other`（照样记下、不处理）。 */
function webhookObject(type: string, object: Json): PaymentWebhookObject {
  if (type.startsWith("payment_intent.")) return { kind: "payment_intent", payment: paymentFromIntent(object), lastError: lastErrorOf(object) };
  if (type.startsWith("charge.dispute.")) {
    const id = text(object["id"]);
    if (id === null) throw new PaymentWebhookPayloadError("争议缺编号");
    return { kind: "dispute", disputeId: id, intentId: idOf(object["payment_intent"]), amountMinor: integer(object["amount"], "amount"), currency: (text(object["currency"]) ?? "").toUpperCase(), reason: text(object["reason"]), status: text(object["status"]) };
  }
  if (type.startsWith("charge.")) {
    const id = text(object["id"]);
    if (id === null) throw new PaymentWebhookPayloadError("扣款缺编号");
    return {
      kind: "charge",
      chargeId: id,
      intentId: idOf(object["payment_intent"]),
      amountMinor: integer(object["amount"], "amount"),
      amountRefundedMinor: integer(object["amount_refunded"] ?? 0, "amount_refunded"),
      currency: (text(object["currency"]) ?? "").toUpperCase(),
      refunded: object["refunded"] === true,
    };
  }
  return { kind: "other", objectId: text(object["id"]) };
}

/** 一条 Stripe 事件（已验签的原始 JSON）→ `PaymentWebhookEvent`。 */
export function normalizeStripeEvent(raw: unknown): PaymentWebhookEvent {
  if (!isObject(raw) || raw["object"] !== "event") throw new PaymentWebhookPayloadError("不是一条 Stripe 事件");
  const id = text(raw["id"]);
  const type = text(raw["type"]);
  const data = raw["data"];
  if (id === null || type === null || !isObject(data) || !isObject(data["object"])) throw new PaymentWebhookPayloadError("事件缺编号、类型或内容");
  const created = integer(raw["created"], "created");
  return { id, type, livemode: raw["livemode"] === true, createdAt: new Date(created * 1000), object: webhookObject(type, data["object"]) };
}

/** 官方库的异常 → `PaymentProviderError`。只留错误类型、Stripe 的错误代码；说明是我们自己写的，不带请求原文。 */
export function toProviderError(err: unknown): PaymentProviderError {
  if (err instanceof PaymentProviderError) return err;
  if (err instanceof Stripe.errors.StripeError) {
    const code = err.code ?? null;
    switch (err.type) {
      case "StripeConnectionError": {
        const detail = (err as { detail?: { code?: unknown } }).detail;
        return detail?.code === "ETIMEDOUT" ? new PaymentProviderError("PAYMENT_PROVIDER_TIMEOUT", "Stripe 超时没有应答（已重试）", code) : new PaymentProviderError("PAYMENT_PROVIDER_UNAVAILABLE", "连不上 Stripe（已重试）", code);
      }
      case "StripeAPIError":
        return new PaymentProviderError("PAYMENT_PROVIDER_UNAVAILABLE", "Stripe 服务出错（已重试）", code);
      case "StripeRateLimitError":
        return new PaymentProviderError("PAYMENT_PROVIDER_RATE_LIMITED", "Stripe 限流（已重试）", code);
      case "StripeAuthenticationError":
      case "StripePermissionError":
        return new PaymentProviderError("PAYMENT_PROVIDER_AUTH_FAILED", "Stripe 密钥不对或权限不够，请检查 STRIPE_SECRET_KEY", code);
      default:
        return new PaymentProviderError("PAYMENT_PROVIDER_REJECTED", "Stripe 拒绝了这个请求", code);
    }
  }
  return new PaymentProviderError("PAYMENT_PROVIDER_UNAVAILABLE", "调用 Stripe 时出错");
}

export class StripePaymentProvider implements PaymentProvider {
  readonly name = "stripe" as const;
  readonly publishableKey: string;
  readonly livemode: boolean;
  readonly #client: Stripe;
  readonly #webhookSecret: string;

  constructor(config: StripeConfig, options: StripeProviderOptions = {}) {
    this.publishableKey = config.publishableKey;
    this.livemode = config.mode === "live";
    this.#webhookSecret = config.webhookSecret;
    this.#client = new Stripe(config.secretKey, {
      apiVersion: Stripe.API_VERSION,
      timeout: options.timeoutMs ?? STRIPE_TIMEOUT_MS,
      maxNetworkRetries: options.maxNetworkRetries ?? STRIPE_MAX_NETWORK_RETRIES,
      telemetry: false,
      appInfo: { name: "nozomi-platform" },
      ...(options.endpoint === undefined ? {} : { host: options.endpoint.host, port: options.endpoint.port, protocol: options.endpoint.protocol }),
    });
  }

  async #call<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err) {
      throw toProviderError(err);
    }
  }

  async createOrderPayment(input: CreateOrderPaymentInput): Promise<ProviderPayment> {
    const metadata = { order_id: input.orderId, order_no: input.orderNo };
    const customer = await this.#call(() =>
      this.#client.customers.create({ name: input.customer.name, email: input.customer.email, phone: input.customer.phone, metadata }, { idempotencyKey: `nozomi-order-${input.orderId}-customer` }),
    );
    const intent = await this.#call(() =>
      this.#client.paymentIntents.create(
        {
          amount: input.amountMinor,
          currency: input.currency.toLowerCase(),
          customer: customer.id,
          setup_future_usage: "off_session",
          allowed_payment_method_types: ["card"],
          description: input.description,
          metadata,
        },
        { idempotencyKey: `nozomi-order-${input.orderId}-payment` },
      ),
    );
    return paymentFromIntent(intent as unknown as Json);
  }

  async retrievePayment(intentId: string): Promise<ProviderPayment> {
    const intent = await this.#call(() => this.#client.paymentIntents.retrieve(intentId));
    return paymentFromIntent(intent as unknown as Json);
  }

  async cancelPayment(intentId: string): Promise<ProviderPayment> {
    try {
      const intent = await this.#client.paymentIntents.cancel(intentId, { cancellation_reason: "abandoned" });
      return paymentFromIntent(intent as unknown as Json);
    } catch (err) {
      // 已经付了或已经取消了：Stripe 说状态不允许取消。这不算错，查一下它现在的状态交给调用方
      if (err instanceof Stripe.errors.StripeError && err.code === "payment_intent_unexpected_state") return this.retrievePayment(intentId);
      throw toProviderError(err);
    }
  }

  parseWebhook(rawBody: Buffer, signature: string | undefined, now: Date): PaymentWebhookEvent {
    verifyStripeSignature(rawBody, signature, this.#webhookSecret, now);
    let raw: unknown;
    try {
      raw = JSON.parse(rawBody.toString("utf8"));
    } catch {
      throw new PaymentWebhookPayloadError("通知的内容不是 JSON");
    }
    return normalizeStripeEvent(raw);
  }
}
