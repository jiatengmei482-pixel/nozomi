/**
 * 取消（M3-03，ADR 0029）：渠道替客人取消（`POST /sales/v1/orders/{id}/cancel`）、运营代取消（`POST /platform/v1/orders/{id}/cancel`）、退款试算（`…/cancel-fee`）。
 *
 * - 付款前（待支付）：先在收款服务取消这笔付款，再取消订单、释放预占（和超时取消同一个顺序：不会出现「订单取消了，客人却还能付款」）；没有钱要退。
 *   取消付款时发现客人其实已经付了：先按付款成功确认，再按付款后取消。
 * - 付款后（服务开始之前：已确认、已派车、司机已出发、司机已到达、救援改派中）：按下单时这一单的取消阶梯（`orders.cancel_policy`），
 *   用这一刻离用车还有多少毫秒找到那一档；免费的原因（改期没确认、航班取消、不可抗力、供应商原因、平台原因）扣 0。
 *   客人扣「对外价 × M%」，退「实际付了的 − 取消费」；供应商得「结算价 × M%」（需求「扣款按同一比例拆」）。
 *   同一个事务里：订单改为已取消（扣款比例、供应商应得写进订单）、释放已售的库存、没有结论的改单作废、状态流水、推 `order.cancelled` 给供应商、排好退款；
 *   提交之后马上发退款（失败的由定时任务重试）。
 * - 重复取消：已经取消了的单再取消一次，返回那一次的结果（200），什么都不改。
 * - 运营代取消多退了钱（免收取消费、选了免费的原因，退的比按阶梯算的多）：不直接生效，发起双人复核（需求「人工退款超过阈值」，阈值 0），
 *   另一位有 `payment.manage` 的同事批准时在同一个事务里按那一刻的状态取消。
 */
import {
  CANCELLABLE_STATUSES,
  type CancellationTier,
  FREE_CANCEL_REASONS,
  type OrderCancelReason,
  type OrderStatus,
  type VehicleGrade,
  cancellationAmounts,
  cancellationNeedsReview,
  cancellationRuleFor,
  cancellationTierAt,
  freeCancelAfterUnconfirmedChange,
  vehicleLevel,
} from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { type Db, withPlatformTx } from "../db/context.ts";
import { AppError } from "../errors.ts";
import { PaymentProviderError, type ProviderPayment } from "../integrations/payments.ts";
import type { Approval } from "../repos/approvals.ts";
import { type AuditOrigin, insertAuditLog } from "../repos/audit-logs.ts";
import { currentCancellationPolicy } from "../repos/cancellation-policies.ts";
import { findOpenChange, listOrderChanges, updateOrderChange } from "../repos/order-changes.ts";
import { type Order, type OrderCancelPolicy, type OrderEventActor, type OrderSale, findOrderForPlatform, findOrderPayment, findSale, insertOrderEvent, releaseSoldInventory, updateOrderStatus } from "../repos/orders.ts";
import { type OrderRefund, listOrderRefunds, supersedeFailedRefunds } from "../repos/refunds.ts";
import { validationFailed } from "../validation.ts";
import { type ApprovalKind, requestApproval } from "./approvals.ts";
import { consoleOrigin, platformActor } from "./audit.ts";
import { notFound } from "./errors.ts";
import { netPaidMinor, processRefunds, scheduleRefund } from "./order-money.ts";
import { type OrderLog, SILENT_ORDER_LOG, cancelPendingOrder, confirmPaidOrder } from "./orders.ts";
import type { PlatformPrincipal } from "./platform-auth.ts";
import { enqueueTenantEvent } from "./tenant-webhooks.ts";

/** 这一单的取消阶梯：下单时抄进订单的；M3-03 之前下的单按现在的政策（车型级别按车型组现查）。 */
export async function orderCancelPolicy(db: Db, order: Order): Promise<OrderCancelPolicy> {
  if (order.cancelPolicy !== null) return order.cancelPolicy;
  const group = (await db.query<{ grade: VehicleGrade; seats: number }>("select grade, seats from vehicle_groups where id = $1", [order.vehicleGroupId])).rows[0] as { grade: VehicleGrade; seats: number };
  const policy = await currentCancellationPolicy(db);
  const level = vehicleLevel(group.grade, group.seats);
  return { version: policy.version, category: order.category, level, tiers: cancellationRuleFor(policy.rules, order.category, level).tiers };
}

export interface CancellationQuote {
  /** unpaid：还没付款（取消不涉及钱）；paid：付过款 */
  stage: "unpaid" | "paid";
  reason: OrderCancelReason;
  policy: OrderCancelPolicy;
  /** 按阶梯落在哪一档（免费的原因也照样给出阶梯上的那一档，便于对照） */
  tierIndex: number;
  tier: CancellationTier;
  msBeforeService: number;
  /** 实际的扣款比例：免费的原因、免收取消费为 0 */
  feeBp: number;
  /** 按阶梯算的扣款比例（不看原因和免收） */
  policyFeeBp: number;
  currency: OrderSale["currency"];
  settlementCurrency: Order["settlementCurrency"];
  /** 客人实际付了的（还没退的） */
  paidMinor: number;
  customerFeeMinor: number;
  refundMinor: number;
  /** 按阶梯应退的（复核判断「多退了没有」用） */
  policyRefundMinor: number;
  tenantShareMinor: number;
}

/** 这一刻按这个原因取消要扣多少、退多少（不写库）。 */
export async function quoteCancellation(db: Db, order: Order, sale: OrderSale, reason: OrderCancelReason, waiveFee: boolean, now: Date): Promise<CancellationQuote> {
  const policy = await orderCancelPolicy(db, order);
  const match = cancellationTierAt(policy, order.serviceAt, now);
  const free = FREE_CANCEL_REASONS.includes(reason) || waiveFee;
  if (order.status === "pending_payment") {
    return { stage: "unpaid", reason, policy, tierIndex: match.index, tier: match.tier, msBeforeService: match.msBeforeService, feeBp: 0, policyFeeBp: match.feeBp, currency: sale.currency, settlementCurrency: order.settlementCurrency, paidMinor: 0, customerFeeMinor: 0, refundMinor: 0, policyRefundMinor: 0, tenantShareMinor: 0 };
  }
  const paidMinor = await netPaidMinor(db, order.id);
  const actual = cancellationAmounts({ sellMinor: sale.sellMinor, settlementMinor: order.settlementMinor, feeBp: free ? 0 : match.feeBp });
  const byPolicy = cancellationAmounts({ sellMinor: sale.sellMinor, settlementMinor: order.settlementMinor, feeBp: match.feeBp });
  // 退「实际付了的 − 取消费」：改期补收了差价、还在等供应商确认的，那部分差价一起退
  const refund = (fee: number): number => Math.max(0, paidMinor - fee);
  return {
    stage: "paid",
    reason,
    policy,
    tierIndex: match.index,
    tier: match.tier,
    msBeforeService: match.msBeforeService,
    feeBp: actual.feeBp,
    policyFeeBp: match.feeBp,
    currency: sale.currency,
    settlementCurrency: order.settlementCurrency,
    paidMinor,
    customerFeeMinor: actual.customerFeeMinor,
    refundMinor: refund(actual.customerFeeMinor),
    policyRefundMinor: refund(byPolicy.customerFeeMinor),
    tenantShareMinor: actual.tenantShareMinor,
  };
}

function stateInvalid(status: OrderStatus): AppError {
  return new AppError(409, "ORDER_STATE_INVALID", "订单当前的状态不能取消（服务开始后不能取消）", { status, action: "cancel" });
}

/** 免费取消的原因要先满足条件：「改期没确认」要这张单最近一次改期真的被拒或超时。 */
async function assertReasonApplies(db: Db, order: Order, reason: OrderCancelReason): Promise<void> {
  if (reason !== "CHANGE_NOT_CONFIRMED") return;
  const changes = await listOrderChanges(db, order.tenantId, order.id);
  if (!freeCancelAfterUnconfirmedChange(changes)) throw new AppError(409, "FREE_CANCEL_NOT_APPLICABLE", "这张单没有被供应商拒绝或没确认的改期，不能按「改期没确认」免费取消");
}

export interface CancelActor {
  actor: OrderEventActor;
  /** 运营代取消时的审计来源；渠道取消不写审计日志（ADR 0026：状态流水就是完整记录） */
  origin: AuditOrigin | null;
}

/**
 * 在调用方的平台事务里取消一张付过款的单（订单已锁）。返回排好的退款（提交之后由调用方发出去）。
 */
export async function cancelPaidOrderInTx(db: Db, order: Order, sale: OrderSale, input: { reason: OrderCancelReason; waiveFee: boolean; note: string | null }, who: CancelActor, now: Date): Promise<{ quote: CancellationQuote; refunds: OrderRefund[] }> {
  if (!(CANCELLABLE_STATUSES as readonly string[]).includes(order.status) || order.status === "pending_payment") throw stateInvalid(order.status);
  await assertReasonApplies(db, order, input.reason);
  const quote = await quoteCancellation(db, order, sale, input.reason, input.waiveFee, now);
  await updateOrderStatus(db, order, { status: "cancelled", cancelledAt: now, cancelReason: input.reason, cancelFeeBp: quote.feeBp, cancelTenantShareMinor: quote.tenantShareMinor, cancelNote: input.note }, now);
  if (order.inventoryHeld) await releaseSoldInventory(db, order.tenantId, order.productId, order.serviceDate, now);
  const open = await findOpenChange(db, order.tenantId, order.id, { lock: true });
  if (open !== null) await updateOrderChange(db, open, { status: "cancelled", decidedAt: now });
  await insertOrderEvent(db, order, { fromStatus: order.status, toStatus: "cancelled", actor: who.actor, reason: input.reason, occurredAt: now, detail: { fee_bp: quote.feeBp, waived: input.waiveFee, ...(who.origin === null ? {} : { by: who.origin.actor.email }) } });
  await enqueueTenantEvent(db, { tenantId: order.tenantId, type: "order.cancelled", orderId: order.id, data: { reason: input.reason, from_status: order.status } }, now);
  // 「实际付了的」不扣失败的退款：这次的退款已经包含了它们，作废，不能再重试（否则多退）
  const superseded = await supersedeFailedRefunds(db, order.id, now);
  const refunds = await scheduleRefund(db, order, "cancellation", quote.refundMinor, null, now);
  if (who.origin !== null) {
    await insertAuditLog(db, who.origin, {
      tenantId: null,
      resource: "order",
      resourceId: order.id,
      action: "cancel",
      before: { status: order.status },
      after: { status: "cancelled", reason: input.reason, waive_fee: input.waiveFee, note: input.note, fee_bp: quote.feeBp, refund_minor: quote.refundMinor, currency: quote.currency, tenant_share_minor: quote.tenantShareMinor, superseded_refund_ids: superseded },
    });
  }
  return { quote, refunds };
}

export type CancelResult =
  | { kind: "cancelled"; orderId: string; replayed: boolean }
  /** 运营代取消多退了钱：等另一位同事批准 */
  | { kind: "approval"; approval: Approval };

interface CancelRequest {
  orderId: string;
  /** 渠道取消时：只认本渠道的单 */
  channelId: string | null;
  reason: OrderCancelReason;
  waiveFee: boolean;
  note: string | null;
  who: CancelActor;
  principal: PlatformPrincipal | null;
}

/**
 * 取消一张单（渠道或运营）。待支付的单先在收款服务取消付款；付过款的按阶梯算钱、退款。已经取消的单返回 `replayed`。
 */
async function cancelOrder(ctx: AppContext, request: CancelRequest, log: OrderLog): Promise<CancelResult> {
  const step = await withPlatformTx(ctx.pool, async (db): Promise<CancelResult | { refunds: OrderRefund[] } | { intentId: string } | { approve: { quote: CancellationQuote; order: Order } }> => {
    const sale = await findSale(db, request.orderId);
    if (sale === null || (request.channelId !== null && sale.channelId !== request.channelId)) throw notFound("订单");
    const order = (await findOrderForPlatform(db, request.orderId, { lock: true })) as Order;
    if (order.status === "cancelled") return { kind: "cancelled", orderId: order.id, replayed: true };
    if (!(CANCELLABLE_STATUSES as readonly string[]).includes(order.status)) throw stateInvalid(order.status);
    if (order.status === "pending_payment") {
      const payment = await findOrderPayment(db, order.id, { lock: true });
      if (payment === null || payment.intentId === null || ctx.payments === null) {
        await cancelPendingOrder(db, order.id, request.reason === "GUEST_REQUEST" ? "GUEST_REQUEST" : request.reason, request.who.actor, ctx.now());
        await auditUnpaid(db, request, order);
        return { kind: "cancelled", orderId: order.id, replayed: false };
      }
      return { intentId: payment.intentId };
    }
    if (request.principal !== null) {
      await assertReasonApplies(db, order, request.reason);
      const quote = await quoteCancellation(db, order, sale, request.reason, request.waiveFee, ctx.now());
      if (cancellationNeedsReview(quote.policyRefundMinor, quote.refundMinor)) return { approve: { quote, order } };
    }
    return { refunds: (await cancelPaidOrderInTx(db, order, sale, request, request.who, ctx.now())).refunds };
  });
  if ("kind" in step) return step;
  if ("approve" in step) return { kind: "approval", approval: await requestWaiver(ctx, request, step.approve.order, step.approve.quote) };
  if ("refunds" in step) {
    await processRefunds(ctx, step.refunds, log);
    return { kind: "cancelled", orderId: request.orderId, replayed: false };
  }
  // 待支付、已经建好付款：先在收款服务取消（事务之外）
  let paid: ProviderPayment;
  try {
    paid = await (ctx.payments as NonNullable<AppContext["payments"]>).cancelPayment(step.intentId);
  } catch (err) {
    if (err instanceof PaymentProviderError) throw new AppError(err.code === "PAYMENT_PROVIDER_TIMEOUT" ? 504 : 502, err.code, "收款服务出错，没能取消这笔付款，请稍后重试", { retryable: err.retryable });
    throw err;
  }
  if (paid.status === "processing" || paid.status === "requires_capture") throw new AppError(409, "PAYMENT_PROCESSING", "客人的付款正在处理中，稍后再取消");
  const after = await withPlatformTx(ctx.pool, async (db): Promise<OrderRefund[] | null> => {
    const now = ctx.now();
    if (paid.status === "succeeded") {
      // 客人在最后一刻付了款：先确认，再按付款后的规则取消
      const record = await findOrderPayment(db, request.orderId, { lock: true });
      if (record !== null) await confirmPaidOrder(db, record, paid, "payment", now, log);
      const order = (await findOrderForPlatform(db, request.orderId, { lock: true })) as Order;
      if (order.status === "cancelled") return [];
      const sale = (await findSale(db, request.orderId)) as OrderSale;
      return (await cancelPaidOrderInTx(db, order, sale, request, request.who, now)).refunds;
    }
    const order = (await findOrderForPlatform(db, request.orderId, { lock: true })) as Order;
    if (await cancelPendingOrder(db, request.orderId, request.reason, request.who.actor, now)) await auditUnpaid(db, request, order);
    return null;
  });
  if (after !== null) await processRefunds(ctx, after, log);
  return { kind: "cancelled", orderId: request.orderId, replayed: false };
}

async function auditUnpaid(db: Db, request: CancelRequest, order: Order): Promise<void> {
  if (request.who.origin === null) return;
  await insertAuditLog(db, request.who.origin, { tenantId: null, resource: "order", resourceId: order.id, action: "cancel", before: { status: order.status }, after: { status: "cancelled", reason: request.reason, note: request.note, paid: false } });
}

/** 渠道替客人取消。原因只有「客人取消」（按阶梯）和「改期没确认」（免费，要满足条件）。 */
export async function cancelForChannel(ctx: AppContext, channelId: string, orderId: string, reason: "GUEST_REQUEST" | "CHANGE_NOT_CONFIRMED", log: OrderLog = SILENT_ORDER_LOG): Promise<CancelResult> {
  return cancelOrder(ctx, { orderId, channelId, reason, waiveFee: false, note: null, who: { actor: "channel", origin: null }, principal: null }, log);
}

/** 运营代取消：要写原因说明；多退了钱的发起双人复核。 */
export async function cancelForPlatform(ctx: AppContext, principal: PlatformPrincipal, orderId: string, input: { reason: OrderCancelReason; waiveFee: boolean; note: string }, ip: string, log: OrderLog = SILENT_ORDER_LOG): Promise<CancelResult> {
  if (input.reason === "PAYMENT_TIMEOUT" || input.reason === "PAYMENT_CANCELED") throw validationFailed("body", [{ path: "/reason", reason: "NOT_APPLICABLE", message: "这两种原因只由系统使用" }]);
  if (input.waiveFee && input.reason !== "GUEST_REQUEST") throw validationFailed("body", [{ path: "/waive_fee", reason: "NOT_APPLICABLE", message: "免费的原因本来就不扣取消费" }]);
  const origin = consoleOrigin(platformActor(principal.user), ip, ctx.now());
  return cancelOrder(ctx, { orderId, channelId: null, reason: input.reason, waiveFee: input.waiveFee, note: input.note, who: { actor: "platform_user", origin }, principal }, log);
}

/** 退款试算（渠道、运营）：按这一刻、这个原因。 */
export async function previewCancellation(ctx: AppContext, scope: { channelId: string } | "platform", orderId: string, reason: OrderCancelReason, waiveFee: boolean): Promise<{ order: Order; quote: CancellationQuote | null }> {
  return withPlatformTx(
    ctx.pool,
    async (db) => {
      const sale = await findSale(db, orderId);
      if (sale === null || (scope !== "platform" && sale.channelId !== scope.channelId)) throw notFound("订单");
      const order = (await findOrderForPlatform(db, orderId)) as Order;
      if (!(CANCELLABLE_STATUSES as readonly string[]).includes(order.status)) return { order, quote: null };
      return { order, quote: await quoteCancellation(db, order, sale, reason, waiveFee, ctx.now()) };
    },
    { snapshot: true },
  );
}

// ---- 多退给客人的代取消：双人复核 ----

const money = (minor: number, currency: string): string => `${minor} ${currency}`;

async function requestWaiver(ctx: AppContext, request: CancelRequest, order: Order, quote: CancellationQuote): Promise<Approval> {
  const principal = request.principal as PlatformPrincipal;
  const origin = request.who.origin as AuditOrigin;
  return withPlatformTx(ctx.pool, (db) =>
    requestApproval(db, origin, principal, {
      kind: ORDER_CANCEL_REFUND,
      resourceId: order.id,
      summary: `代取消订单 ${order.orderNo}（${request.reason}${request.waiveFee ? "，免收取消费" : ""}）：退给客人 ${money(quote.refundMinor, quote.currency)}，按取消政策应退 ${money(quote.policyRefundMinor, quote.currency)}`,
      payload: { order_id: order.id, order_no: order.orderNo, reason: request.reason, waive_fee: request.waiveFee, note: request.note, refund_minor: quote.refundMinor, policy_refund_minor: quote.policyRefundMinor, currency: quote.currency },
      before: { status: order.status, policy_fee_bp: quote.policyFeeBp },
      baseVersion: null,
      note: request.note,
    }),
  );
}

export const ORDER_CANCEL_REFUND: ApprovalKind = {
  kind: "order.cancel_refund",
  resource: "order",
  readAction: "order.read",
  requestAction: "order.manage",
  reviewAction: "payment.manage",
  // 对象是订单：限定了数据范围的人只看得到、审得了范围内订单的（ADR 0030）
  orderScoped: true,
  async apply(db, approval, origin) {
    const payload = approval.payload;
    const orderId = payload["order_id"] as string;
    const order = await findOrderForPlatform(db, orderId, { lock: true });
    const sale = await findSale(db, orderId);
    if (order === null || sale === null) throw notFound("订单");
    if (order.status === "cancelled") throw new AppError(409, "APPROVAL_STALE", "这张单已经取消了（可能是客人自己取消的）；请驳回");
    await cancelPaidOrderInTx(db, order, sale, { reason: payload["reason"] as OrderCancelReason, waiveFee: payload["waive_fee"] === true, note: (payload["note"] as string | null) ?? null }, { actor: "platform_user", origin }, origin.occurredAt);
  },
  async afterApply(ctx, approval) {
    const orderId = approval.payload["order_id"] as string;
    const refunds = await withPlatformTx(ctx.pool, (db) => listOrderRefunds(db, orderId));
    await processRefunds(ctx, refunds.filter((refund) => refund.status === "pending"), SILENT_ORDER_LOG);
  },
};

export const CANCELLATION_APPROVAL_KINDS: readonly ApprovalKind[] = [ORDER_CANCEL_REFUND];
