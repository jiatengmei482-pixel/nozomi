/**
 * 收款服务（Stripe）的通知 `POST /webhooks/stripe`（M3-01，ADR 0026）。
 *
 * - 先验签（Stripe-Signature：t / v1、HMAC-SHA256、5 分钟容差），不通过 400，什么都不做；
 * - 同一个事件编号只处理一次：登记和处理在同一个事务里，处理失败整体回滚（Stripe 收到 500 会按它的节奏重发，那时再处理）；
 *   同一个事件同时来两次，后到的在登记时等前一个事务结束，然后看到已登记、直接回 200；
 * - 测试模式 / 正式模式和本环境的密钥对不上的不处理（`livemode_mismatch`）；
 * - 处理的事件：
 *   - `payment_intent.succeeded`：核对金额和币种 → 待支付的单自动确认（第一轮决策：支付后自动确认、租户不能拒单），库存预占转已售，记下保存的支付方式；
 *   - `payment_intent.payment_failed`：记下失败原因，订单留在待支付（付款期限内客人可以换一张卡再付）；
 *   - `payment_intent.processing`、`payment_intent.requires_action`：更新付款状态；
 *   - `payment_intent.canceled`：待支付的单取消、释放库存；
 *   - `charge.refunded`：记下已退金额（退款流程在 M3-03）；
 *   - `charge.dispute.created`：标记拒付（支付异常，异常队列在 M4-02）；
 *   - 其余类型：记一条「不处理」，回 200。对不上平台付款的（别的系统在同一个 Stripe 账户上建的付款）：记「对不上」，回 200。
 * 付款状态只往前走：先到的「成功」不会被晚到的「失败」「处理中」改回去。
 */
import type { AppContext } from "../context.ts";
import { withPlatformTx } from "../db/context.ts";
import { AppError } from "../errors.ts";
import { type PaymentWebhookEvent, PaymentWebhookPayloadError } from "../integrations/payments.ts";
import { StripeSignatureError } from "../integrations/stripe-signature.ts";
import { type OrderPayment, type PaymentEventResult, claimPaymentEvent, findOrderForPlatform, findOrderPayment, findPaymentByIntent, finishPaymentEvent, updateOrderPayment } from "../repos/orders.ts";
import { type OrderLog, cancelPendingOrder, confirmPaidOrder, requirePayments } from "./orders.ts";

export interface WebhookOutcome {
  eventId: string;
  type: string;
  duplicate: boolean;
  result: Exclude<PaymentEventResult, "processing"> | null;
}

/** 已经是最后结果的付款状态：晚到的通知不能把它改回去。 */
const settled = (payment: OrderPayment): boolean => payment.status === "succeeded" || payment.status === "canceled";

export async function handlePaymentWebhook(ctx: AppContext, rawBody: Buffer, signature: string | undefined, log: OrderLog): Promise<WebhookOutcome> {
  const provider = requirePayments(ctx);
  const now = ctx.now();
  let event: PaymentWebhookEvent;
  try {
    event = provider.parseWebhook(rawBody, signature, now);
  } catch (err) {
    if (err instanceof StripeSignatureError) {
      log.warn({ reason: err.failure }, "Stripe 通知的签名校验没有通过，已拒绝");
      throw new AppError(400, "WEBHOOK_SIGNATURE_INVALID", "通知的签名校验没有通过", { reason: err.failure });
    }
    if (err instanceof PaymentWebhookPayloadError) throw new AppError(400, "WEBHOOK_PAYLOAD_INVALID", "通知的内容看不懂", { reason: err.message });
    throw err;
  }

  const outcome = await withPlatformTx(ctx.pool, async (db): Promise<WebhookOutcome> => {
    const objectId = event.object.kind === "payment_intent" ? event.object.payment.intentId : event.object.kind === "charge" ? event.object.chargeId : event.object.kind === "dispute" ? event.object.disputeId : event.object.objectId;
    const claimed = await claimPaymentEvent(db, { id: event.id, type: event.type, livemode: event.livemode, objectId, createdAt: event.createdAt, receivedAt: now });
    if (!claimed) return { eventId: event.id, type: event.type, duplicate: true, result: null };
    const finish = async (result: Exclude<PaymentEventResult, "processing">, orderId: string | null, detail: Record<string, unknown> | null = null): Promise<WebhookOutcome> => {
      await finishPaymentEvent(db, event.id, result, orderId, detail);
      return { eventId: event.id, type: event.type, duplicate: false, result };
    };
    if (event.livemode !== provider.livemode) return finish("livemode_mismatch", null);

    const object = event.object;
    const intentId = object.kind === "payment_intent" ? object.payment.intentId : object.kind === "charge" || object.kind === "dispute" ? object.intentId : null;
    const handled = ["payment_intent.succeeded", "payment_intent.payment_failed", "payment_intent.processing", "payment_intent.requires_action", "payment_intent.canceled", "charge.refunded", "charge.dispute.created"];
    if (!handled.includes(event.type) || object.kind === "other") return finish("ignored", null);
    const found = intentId === null ? null : await findPaymentByIntent(db, intentId);
    if (found === null) return finish("unmatched", null, { intent_id: intentId });
    // 加锁的顺序和超时取消一样：先订单、后收款记录（两边同时处理同一张单时不会死锁）
    await findOrderForPlatform(db, found.orderId, { lock: true });
    const payment = (await findOrderPayment(db, found.orderId, { lock: true })) as OrderPayment;

    if (object.kind === "payment_intent") {
      const paid = object.payment;
      switch (event.type) {
        case "payment_intent.succeeded": {
          const result = await confirmPaidOrder(db, payment, paid, "payment", now, log);
          return finish(result === "mismatch" ? "mismatch" : "applied", payment.orderId, { outcome: result });
        }
        case "payment_intent.payment_failed": {
          if (!settled(payment)) {
            await updateOrderPayment(db, payment.id, { status: "requires_payment", lastError: object.lastError === null ? null : { code: object.lastError.code, decline_code: object.lastError.declineCode, message: object.lastError.message } }, now);
          }
          return finish("applied", payment.orderId, { code: object.lastError?.code ?? null, decline_code: object.lastError?.declineCode ?? null });
        }
        case "payment_intent.canceled": {
          const cancelled = await cancelPendingOrder(db, payment.orderId, "PAYMENT_CANCELED", "payment", now);
          if (!cancelled && payment.status !== "succeeded") await updateOrderPayment(db, payment.id, { status: "canceled" }, now);
          return finish("applied", payment.orderId, { order_cancelled: cancelled });
        }
        default: {
          // processing / requires_action
          if (!settled(payment)) await updateOrderPayment(db, payment.id, { status: event.type === "payment_intent.processing" ? "processing" : "requires_payment" }, now);
          return finish("applied", payment.orderId);
        }
      }
    }
    if (object.kind === "charge") {
      // 已退金额只增不减：同一笔的几次退款通知先后乱了也不会少记
      await updateOrderPayment(db, payment.id, { refundedMinor: Math.min(payment.amountMinor, Math.max(payment.refundedMinor, object.amountRefundedMinor)) }, now);
      return finish("applied", payment.orderId, { amount_refunded: object.amountRefundedMinor, currency: object.currency });
    }
    await updateOrderPayment(db, payment.id, { disputed: true }, now);
    log.error({ orderId: payment.orderId, disputeId: object.disputeId, reason: object.reason }, "客人对这笔付款提出了拒付：需要财务处理");
    return finish("applied", payment.orderId, { dispute_id: object.disputeId, reason: object.reason });
  });
  if (outcome.result === "ignored" || outcome.result === "unmatched" || outcome.result === "livemode_mismatch") log.info({ eventId: outcome.eventId, type: outcome.type, result: outcome.result }, "Stripe 通知已记录，不处理");
  return outcome;
}
