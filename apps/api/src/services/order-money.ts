/**
 * 订单的退款和离线扣款（M3-03，ADR 0029）：取消、改单、事后加收共用。
 *
 * 退款：
 * - 在业务事务里（取消、改单生效、改期被拒）按「从最近收的那一笔开始退」拆成几笔，每笔一行 `order_refunds`（等着发）；
 * - 事务提交之后马上发一次（`processRefunds`），没发成的由订单定时任务按 1、5、30、120、360 分钟重试，5 次后记为失败、等财务处理（`payment.manage` 可以手动重试）；
 * - 财务手动重试失败的那一笔：新建一笔（新的幂等键），指回失败的那一笔；
 * - 发的时候先在一个短事务里「租下」（正在发，租约 2 分钟），收款服务的调用在事务之外，再一个短事务记结果。
 *   幂等键是退款记录的编号：进程中途退出、租约到期后别的实例再发一次，收款服务返回的是同一笔，不会退两次。
 * - 收款服务说「处理中」（有的支付方式要几天）：保持正在发，等通知（refund.updated）；租约到期时再问一次（同一个幂等键，返回现在的状态）。
 *
 * 离线扣款（改期补差价、事后加收）：先建收款记录（creating）拿它的编号做幂等键，事务之外用保存的支付方式扣，再记结果。
 * 卡被拒、要客人验证是「没扣到」（`declined`，不重试）；收款服务出错可以用同一条收款记录重试（同一个幂等键，不会扣两次）。
 */
import { REFUND_RULES, allocateRefund, nextRefundAttemptAt, refundRetryRefusal, retainedAfterRefundsMinor } from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { type Db, isUniqueViolation, withPlatformTx } from "../db/context.ts";
import { type OffSessionChargeResult, PaymentProviderError } from "../integrations/payments.ts";
import { type Order, type OrderPayment, type OrderSale, findOrderForPlatform, findPaymentById, findSale, listOrderPayments, updateOrderPayment } from "../repos/orders.ts";
import { type OrderRefund, type RefundPurpose, findRefund, insertRefund, listDueRefunds, listOrderRefunds, refundedByPayment, syncPaymentRefunded, updateRefund } from "../repos/refunds.ts";
import type { OrderLog } from "./orders.ts";
import { AppError } from "../errors.ts";
import { insertAuditLog } from "../repos/audit-logs.ts";
import { consoleOrigin, platformActor } from "./audit.ts";
import { notFound } from "./errors.ts";
import type { PlatformPrincipal } from "./platform-auth.ts";

/** 可以退的钱：下单的付款和改期补收的差价（付成功了的），各自扣掉已经退了和正在退的。事后加收不在里面（服务已经完成，没有取消）。 */
export async function refundableCharges(db: Db, orderId: string): Promise<{ payment: OrderPayment; availableMinor: number }[]> {
  const payments = (await listOrderPayments(db, orderId)).filter((payment) => payment.status === "succeeded" && (payment.kind === "order" || payment.kind === "change"));
  const refunded = await refundedByPayment(db, orderId);
  return payments.map((payment) => ({ payment, availableMinor: payment.amountMinor - Math.max(payment.refundedMinor, refunded.get(payment.id) ?? 0) }));
}

/** 客人这一单实际付了多少（还没退的）：下单付款 + 改期补收 − 已退和正在退的。 */
export async function netPaidMinor(db: Db, orderId: string): Promise<number> {
  return (await refundableCharges(db, orderId)).reduce((sum, entry) => sum + Math.max(0, entry.availableMinor), 0);
}

/** 在调用方的事务里排好一笔退款（拆到各笔收款上）。金额为 0 什么都不做。返回建的退款记录。赔付（M4-02）带上工单编号。 */
export async function scheduleRefund(db: Db, order: Pick<Order, "tenantId" | "id">, purpose: RefundPurpose, amountMinor: number, changeId: string | null, now: Date, ticketId: string | null = null): Promise<OrderRefund[]> {
  if (amountMinor <= 0) return [];
  const charges = await refundableCharges(db, order.id);
  const parts = allocateRefund(charges.map((entry) => ({ paymentId: entry.payment.id, amountMinor: entry.payment.amountMinor, refundedMinor: entry.payment.amountMinor - entry.availableMinor })), amountMinor);
  const refunds: OrderRefund[] = [];
  for (const part of parts) {
    const payment = (charges.find((entry) => entry.payment.id === part.paymentId) as { payment: OrderPayment }).payment;
    refunds.push(await insertRefund(db, { orderId: order.id, supplierTenantId: order.tenantId, paymentId: part.paymentId, purpose, changeId, ticketId, amountMinor: part.amountMinor, currency: payment.currency, now }));
  }
  return refunds;
}

export type RefundOutcome = "succeeded" | "processing" | "failed" | "retry" | "skipped";

/**
 * 发一笔退款。只处理「等着发」和租约到期的「正在发」；别的（别的实例正在发、已经有结果）什么都不做（`skipped`）。
 * `manual`：财务手动重试失败的那一笔（次数重新算）。
 */
export async function processRefund(ctx: AppContext, refundId: string, log: OrderLog): Promise<RefundOutcome> {
  const provider = ctx.payments;
  const now = ctx.now();
  const claimed = await withPlatformTx(ctx.pool, async (db) => {
    const refund = await findRefund(db, refundId, { lock: true });
    if (refund === null) return null;
    const due = refund.status === "pending" || (refund.status === "processing" && refund.nextAttemptAt !== null && refund.nextAttemptAt.getTime() <= now.getTime());
    if (!due) return null;
    const attempts = refund.attempts + 1;
    await updateRefund(db, refund.id, { status: "processing", attempts, nextAttemptAt: new Date(now.getTime() + REFUND_RULES.leaseSeconds * 1_000), failedAt: null }, now);
    const payment = (await findPaymentById(db, refund.paymentId)) as OrderPayment;
    const order = (await findOrderForPlatform(db, refund.orderId)) as Order;
    return { refund: { ...refund, attempts }, payment, orderNo: order.orderNo };
  });
  if (claimed === null) return "skipped";
  const { refund, payment, orderNo } = claimed;
  const fail = async (code: string, message: string, retryable: boolean): Promise<RefundOutcome> => {
    const next = retryable ? nextRefundAttemptAt(refund.attempts, ctx.now()) : null;
    await withPlatformTx(ctx.pool, (db) =>
      updateRefund(db, refund.id, next === null ? { status: "failed", nextAttemptAt: null, lastError: { code, message }, failedAt: ctx.now() } : { status: "pending", nextAttemptAt: next, lastError: { code, message } }, ctx.now()),
    );
    if (next === null) log.error({ event: "refund.failed", refundId: refund.id, orderId: refund.orderId, code }, "退款失败：需要财务核实（支付异常）");
    return next === null ? "failed" : "retry";
  };
  if (provider === null) return fail("PAYMENT_NOT_CONFIGURED", "支付未配置，不能退款", true);
  if (payment.intentId === null) return fail("NO_PAYMENT_INTENT", "这笔收款没有收款服务的付款编号", false);
  try {
    const result = await provider.refundPayment({ refundId: refund.id, intentId: payment.intentId, amountMinor: refund.amountMinor, orderId: refund.orderId, orderNo });
    return await withPlatformTx(ctx.pool, async (db): Promise<RefundOutcome> => {
      const at = ctx.now();
      if (result.status === "succeeded") {
        await updateRefund(db, refund.id, { status: "succeeded", providerRefundId: result.refundId, nextAttemptAt: null, lastError: null, succeededAt: at }, at);
        await syncPaymentRefunded(db, refund.paymentId, at);
        return "succeeded";
      }
      if (result.status === "failed" || result.status === "canceled") {
        await updateRefund(db, refund.id, { status: "failed", providerRefundId: result.refundId, nextAttemptAt: null, lastError: { code: result.failureReason ?? result.status, message: "收款服务说这笔退款失败了" }, failedAt: at }, at);
        log.error({ event: "refund.failed", refundId: refund.id, orderId: refund.orderId, reason: result.failureReason }, "退款失败：需要财务核实（支付异常）");
        return "failed";
      }
      // 处理中：等通知；租约（这里放宽到 6 小时）到期时用同一个幂等键再问一次
      await updateRefund(db, refund.id, { status: "processing", providerRefundId: result.refundId, nextAttemptAt: new Date(at.getTime() + 6 * 3_600_000) }, at);
      return "processing";
    });
  } catch (err) {
    if (err instanceof PaymentProviderError) {
      log.warn({ refundId: refund.id, code: err.code, providerCode: err.providerCode }, "退款时收款服务出错");
      return fail(err.providerCode ?? err.code, err.message, err.retryable);
    }
    throw err;
  }
}

/** 事务提交之后马上把刚排好的几笔退款发出去（失败的交给定时任务）。 */
export async function processRefunds(ctx: AppContext, refunds: readonly OrderRefund[], log: OrderLog): Promise<void> {
  for (const refund of refunds) {
    try {
      await processRefund(ctx, refund.id, log);
    } catch (err) {
      log.warn({ err, refundId: refund.id }, "退款这一次没发出去，定时任务会再试");
    }
  }
}

/**
 * 财务手动重试一笔失败的退款（`payment.manage`）：新建一笔同样金额的退款（新的幂等键——收款服务对同一个幂等键只会返回那笔失败的），马上发一次。
 * 一笔失败的只能重试一次（数据库唯一约束 `retry_of`）；再失败的，重试新的那一笔。订单取消时已经包含进退款里的（作废）不能重试；
 * 重试前在订单行锁里核对「实际付了的 − 这一笔 ≥ 应留下的」（`refundRetryRefusal`）。写审计日志。
 */
export async function retryRefund(ctx: AppContext, principal: PlatformPrincipal, orderId: string, refundId: string, ip: string, log: OrderLog): Promise<{ outcome: RefundOutcome; refund: OrderRefund }> {
  const now = ctx.now();
  let created: OrderRefund;
  try {
    created = await withPlatformTx(ctx.pool, async (db) => {
      // 加锁顺序和取消一样：先订单、后退款记录——取消（会把失败的退款作废）和重试排成先后，不会各按旧的数算
      const order = await findOrderForPlatform(db, orderId, { lock: true });
      const refund = order === null ? null : await findRefund(db, refundId, { lock: true });
      if (order === null || refund === null || refund.orderId !== orderId) throw notFound("退款");
      if (refund.status !== "failed") throw new AppError(409, "REFUND_STATE_INVALID", "只有失败的退款能重试", { status: refund.status });
      if ((await listOrderRefunds(db, orderId)).some((entry) => entry.retryOf === refund.id)) throw alreadyRetried();
      // 重试前按这一刻的钱再核对一遍：取消时已经包含进去的不能再退；退了之后客人留下的不能少于应留下的（没取消：对外价；取消了：取消费）
      const sale = (await findSale(db, orderId)) as OrderSale;
      const charges = await refundableCharges(db, orderId);
      const refusal = refundRetryRefusal({
        superseded: refund.supersededAt !== null,
        amountMinor: refund.amountMinor,
        netPaidMinor: charges.reduce((sum, entry) => sum + Math.max(0, entry.availableMinor), 0),
        paymentAvailableMinor: charges.find((entry) => entry.payment.id === refund.paymentId)?.availableMinor ?? 0,
        retainedMinor: retainedAfterRefundsMinor({ cancelled: order.status === "cancelled", sellMinor: sale.sellMinor, cancelFeeBp: order.cancelFeeBp, compensatedMinor: await compensationRefundMinor(db, orderId) }),
      });
      if (refusal === "SUPERSEDED") throw new AppError(409, "REFUND_SUPERSEDED", "订单取消时的退款已经包含了这一笔，不能再重试（再退就多退了）", { status: refund.status, superseded_at: (refund.supersededAt as Date).toISOString() });
      if (refusal === "EXCEEDS_PAID") throw new AppError(409, "REFUND_EXCEEDS_PAID", "再退这一笔，客人留下的会少于应付的（对外价或取消费），请核对这一单的收款和退款", { amount_minor: refund.amountMinor });
      const retry = await insertRefund(db, { orderId, supplierTenantId: refund.supplierTenantId, paymentId: refund.paymentId, purpose: refund.purpose, changeId: refund.changeId, ticketId: refund.ticketId, amountMinor: refund.amountMinor, currency: refund.currency, now, retryOf: refund.id });
      await insertAuditLog(db, consoleOrigin(platformActor(principal.user), ip, now), { tenantId: null, resource: "refund", resourceId: refund.id, action: "retry", before: { status: "failed", last_error: refund.lastError }, after: { order_id: orderId, retry_refund_id: retry.id, amount_minor: refund.amountMinor, currency: refund.currency } });
      return retry;
    });
  } catch (err) {
    if (isUniqueViolation(err, "order_refunds_retry_of_key")) throw alreadyRetried();
    throw err;
  }
  const outcome = await processRefund(ctx, created.id, log);
  return { outcome, refund: (await withPlatformTx(ctx.pool, (db) => findRefund(db, created.id))) as OrderRefund };
}

/** 这一单按工单判定该退给客人的赔付合计（不管退成功没有）：退款之后客人应留下的钱要扣掉它（M4-02）。 */
async function compensationRefundMinor(db: Db, orderId: string): Promise<number> {
  const result = await db.query<{ total: string | null }>("select sum(refund_minor)::bigint as total from ticket_compensations where order_id = $1", [orderId]);
  return Number(result.rows[0]?.total ?? 0);
}

function alreadyRetried(): AppError {
  return new AppError(409, "REFUND_STATE_INVALID", "这一笔已经重试过了，请看重试的那一笔", { status: "failed" });
}

/** 定时任务：到时候该发的退款。 */
export async function processDueRefunds(ctx: AppContext, log: OrderLog, limit = 50): Promise<Record<RefundOutcome, number>> {
  const due = await withPlatformTx(ctx.pool, (db) => listDueRefunds(db, ctx.now(), limit));
  const result: Record<RefundOutcome, number> = { succeeded: 0, processing: 0, failed: 0, retry: 0, skipped: 0 };
  for (const id of due) result[await processRefund(ctx, id, log)] += 1;
  return result;
}

/**
 * 用保存的支付方式扣一笔（事务之外调收款服务，再在一个短事务里记下收款记录的结果）。收款记录是调用方事先建好的（creating）。
 * 收款服务出错不改收款记录（还是 creating，下次用同一条重试，同一个幂等键），把错误抛给调用方。
 */
export async function chargeOffSession(ctx: AppContext, payment: OrderPayment, input: { orderNo: string; description: string }): Promise<OffSessionChargeResult> {
  const provider = ctx.payments;
  if (provider === null) throw new PaymentProviderError("PAYMENT_PROVIDER_UNAVAILABLE", "支付未配置");
  const result = await provider.chargeSavedPaymentMethod({
    paymentId: payment.id,
    orderId: payment.orderId,
    orderNo: input.orderNo,
    customerId: payment.customerId as string,
    paymentMethodId: payment.paymentMethodId as string,
    amountMinor: payment.amountMinor,
    currency: payment.currency,
    description: input.description,
    purpose: payment.kind === "change" ? "change" : "extra_charge",
  });
  await withPlatformTx(ctx.pool, async (db) => {
    const now = ctx.now();
    if (result.outcome === "declined") {
      await updateOrderPayment(db, payment.id, { ...(result.intentId === null ? {} : { intentId: result.intentId }), status: "failed", lastError: { code: result.error.code, decline_code: result.error.declineCode, message: result.error.message } }, now);
      return;
    }
    await updateOrderPayment(db, payment.id, { intentId: result.payment.intentId, status: result.outcome === "succeeded" ? "succeeded" : "processing", ...(result.outcome === "succeeded" ? { succeededAt: now } : {}) }, now);
  });
  return result;
}

/** 这一单下单付款时保存下来的支付方式（离线扣款用）；没有（还没付、或者付款时没保存下来）为 null。 */
export function savedPaymentMethod(orderPayment: OrderPayment | null): { customerId: string; paymentMethodId: string; saveConsentAt: Date } | null {
  if (orderPayment === null || orderPayment.status !== "succeeded" || orderPayment.customerId === null || orderPayment.paymentMethodId === null) return null;
  return { customerId: orderPayment.customerId, paymentMethodId: orderPayment.paymentMethodId, saveConsentAt: orderPayment.saveConsentAt };
}
