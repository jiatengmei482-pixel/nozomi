/**
 * 服务后加收（M3-03，ADR 0029；需求「服务后加收费用」，第五轮决策 ⑤）。
 *
 * 1. 供应商提交（`POST /tenant/v1/orders/{id}/extra-charges`，`order.extra_charge`）：只有已完成的单、服务结束 24 小时内；类型限定（包车的超时、超公里、高速、停车，
 *    各品类的付费等待、加停靠点、加附加服务）；高速费、停车费必须附票据照片（先 `POST /tenant/v1/orders/{id}/files?kind=receipt` 上传）；单笔不超过这一单的结算价。
 *    提交即通知客人（邮件在通知中心任务里接；渠道的订单接口里马上看得到），**从提交起 48 小时是异议期**，异议期内不扣款，供应商可以撤回。
 * 2. 客人异议（`POST /sales/v1/orders/{id}/extra-charges/{chargeId}/dispute`）：异议期内（按毫秒，截止那一刻起不能再提）；之后转平台审核。
 * 3. 异议期结束（订单定时任务）：没有要转人工的原因 → 自动扣款；超过对外价 50%、没有凭证 → 待平台审核。
 * 4. 平台审核（`order.manage`）：通过（可以部分通过）→ 扣款；驳回 → 不收。
 * 5. 扣款：用下单时保存的支付方式离线扣（`order_payments` 一条 extra_charge），客人付「金额 × 汇率快照 × (1 + 缓冲) × (1 + 加价比例)」；
 *    卡被拒、要客人验证 → 扣款失败（等财务处理，`payment.manage` 可以重试或驳回）；收款服务出错 → 10 分钟后用同一条收款记录重试（同一个幂等键），5 次后记为失败。
 * 规则 4：供应商看到的是自己报的金额（结算币种）和状态，看不到客人付了多少。
 */
import { createHash } from "node:crypto";
import {
  EVIDENCE_FILE_RULES,
  EXTRA_CHARGE_RULES,
  type ExtraChargeDecision,
  type ExtraChargeReviewReason,
  type ExtraChargeSubmitRefusal,
  type ExtraChargeType,
  afterDisputeWindow,
  approvedExtraChargeAmount,
  detectEvidenceType,
  disputeDeadline,
  disputeOpen,
  extraChargeCustomerMinor,
  extraChargeReviewReasons,
  extraChargeSubmitRefusal,
  extraChargeReviewRefusal,
  extraChargeWithdrawable,
  nextChargeAttemptAt,
} from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { type Db, withPlatformTx, withTenantTx } from "../db/context.ts";
import { AppError } from "../errors.ts";
import { PaymentProviderError } from "../integrations/payments.ts";
import { insertAuditLog } from "../repos/audit-logs.ts";
import { type OrderFile, insertOrderFile, listOrderFiles } from "../repos/dispatch.ts";
import { type ExtraCharge, findExtraCharge, findExtraChargeForPlatform, insertExtraCharge, listDueCharges, listExtraCharges, listWindowClosedCharges, updateExtraCharge, withdrawExtraCharge } from "../repos/extra-charges.ts";
import { type Order, type OrderPayment, type OrderSale, findOrderForPlatform, findOrderPayment, findSale, findTenantOrder, insertOffSessionPayment, insertOrderEvent, listOrderPayments, updateOrderPayment } from "../repos/orders.ts";
import { validationFailed } from "../validation.ts";
import { consoleOrigin, platformActor, tenantActor } from "./audit.ts";
import { notFound } from "./errors.ts";
import { fileTooLarge } from "./driver-trip.ts";
import { assertTenantCanOperate } from "./fulfilment.ts";
import { chargeOffSession, savedPaymentMethod } from "./order-money.ts";
import type { OrderLog } from "./orders.ts";
import type { PlatformPrincipal } from "./platform-auth.ts";
import type { TenantPrincipal } from "./tenant-auth.ts";

const SUBMIT_REFUSALS: Readonly<Record<ExtraChargeSubmitRefusal, { status: number; message: string }>> = {
  ORDER_NOT_COMPLETED: { status: 409, message: "只有已完成的订单才能加收" },
  SUBMIT_WINDOW_CLOSED: { status: 409, message: `服务结束已经超过 ${EXTRA_CHARGE_RULES.submitWithinHours} 小时，不能再提交加收` },
  TYPE_NOT_ALLOWED: { status: 422, message: "这一单的品类不能收这一项（接送机、点对点是一口价，含高速和停车费；超时、超公里只有包车）" },
  RECEIPT_REQUIRED: { status: 422, message: "高速费、停车费要附票据照片" },
  AMOUNT_INVALID: { status: 422, message: "金额要是大于 0 的整数（最小货币单位）" },
  AMOUNT_OVER_LIMIT: { status: 422, message: "单笔加收不能超过这一单的结算价，请核对金额" },
  TOO_MANY_ITEMS: { status: 409, message: `一张单最多 ${EXTRA_CHARGE_RULES.maxItemsPerOrder} 项加收` },
};

export interface ExtraChargeInput {
  type: ExtraChargeType;
  amountMinor: number;
  description: string | null;
  fileIds: string[];
}

/** 供应商后台上传票据照片（`order.extra_charge`）：按字节判断格式，和声明的类型不一致、不是认的格式都拒绝（415），最大 5 MB（和司机 H5 一样）。已取消、救援改派中、已转给救援供应商的单不能传。 */
export async function uploadReceipt(ctx: AppContext, principal: TenantPrincipal, orderId: string, declaredType: string | undefined, data: Buffer): Promise<OrderFile> {
  if (data.length === 0) throw validationFailed("body", [{ path: "/", reason: "REQUIRED", message: "没有收到照片" }]);
  if (data.length > EVIDENCE_FILE_RULES.maxBytes) throw fileTooLarge();
  const detected = detectEvidenceType(data);
  const declared = (declaredType ?? "").split(";")[0]?.trim().toLowerCase();
  if (detected === null || detected !== declared) throw new AppError(415, "UNSUPPORTED_MEDIA_TYPE", "只能上传 JPEG、PNG、WebP 或 HEIC 格式的照片，且请求头 Content-Type 要和文件一致", { accepted: [...EVIDENCE_FILE_RULES.contentTypes] });
  const now = ctx.now();
  return withTenantTx(ctx.pool, principal.tenantId, async (db) => {
    const order = await findTenantOrder(db, principal.tenantId, orderId);
    if (order === null) throw notFound("订单");
    assertTenantCanOperate(order, "upload");
    if (order.status === "cancelled") throw new AppError(409, "ORDER_STATE_INVALID", "订单已取消", { status: order.status, action: "upload" });
    return insertOrderFile(db, principal.tenantId, { orderId, kind: "receipt", contentType: detected, data, sha256: createHash("sha256").update(data).digest("hex"), uploadedAt: now, linkId: null, uploadedBy: principal.user.id });
  });
}

/** 客人要付多少（客人支付币种）：按审核通过的金额（没审核的按提交的）。 */
export function customerAmountOf(charge: ExtraCharge, sale: OrderSale): number {
  return extraChargeCustomerMinor({ amountMinor: charge.approvedMinor ?? charge.amountMinor, settlementCurrency: charge.currency, currency: sale.currency, markupBp: sale.markupBp, fxBufferBp: sale.fxBufferBp, fx: sale.fx });
}

/** 供应商提交一项加收。客人那边的金额要读平台表（对外价、加价比例、汇率快照），先在平台事务里读出算好要不要转人工，再在租户事务里写入。 */
export async function submitExtraCharge(ctx: AppContext, principal: TenantPrincipal, orderId: string, input: ExtraChargeInput, ip: string): Promise<ExtraCharge> {
  const now = ctx.now();
  const sale = await withPlatformTx(ctx.pool, async (db) => {
    const found = await findSale(db, orderId);
    return found !== null && found.supplierTenantId === principal.tenantId ? found : null;
  });
  return withTenantTx(ctx.pool, principal.tenantId, async (db) => {
    const order = await findTenantOrder(db, principal.tenantId, orderId, { lock: true });
    if (order === null || sale === null) throw notFound("订单");
    assertTenantCanOperate(order, "submit_extra_charge");
    const files = await listOrderFiles(db, principal.tenantId, orderId);
    const unknown = input.fileIds.filter((id) => !files.some((file) => file.id === id && file.kind === "receipt"));
    if (unknown.length > 0 || new Set(input.fileIds).size !== input.fileIds.length) throw validationFailed("body", [{ path: "/file_ids", reason: "UNKNOWN_FILE", message: "凭证要是这一单上传的票据照片（kind=receipt），不能重复" }]);
    const existing = (await listExtraCharges(db, principal.tenantId, orderId)).filter((charge) => charge.status !== "withdrawn" && charge.status !== "rejected");
    const refusal = extraChargeSubmitRefusal({ type: input.type, amountMinor: input.amountMinor, fileCount: input.fileIds.length }, { status: order.status, category: order.category, completedAt: order.dispatch.completedAt, settlementMinor: order.settlementMinor, existingItems: existing.length }, now);
    if (refusal !== null) throw new AppError(SUBMIT_REFUSALS[refusal].status, refusal === "AMOUNT_INVALID" || refusal === "AMOUNT_OVER_LIMIT" || refusal === "RECEIPT_REQUIRED" || refusal === "TYPE_NOT_ALLOWED" ? "EXTRA_CHARGE_INVALID" : "EXTRA_CHARGE_NOT_ALLOWED", SUBMIT_REFUSALS[refusal].message, { reason: refusal });
    const customer = extraChargeCustomerMinor({ amountMinor: input.amountMinor, settlementCurrency: order.settlementCurrency, currency: sale.currency, markupBp: sale.markupBp, fxBufferBp: sale.fxBufferBp, fx: sale.fx });
    const reviewReasons = extraChargeReviewReasons(customer, sale.sellMinor, input.fileIds.length);
    const charge = await insertExtraCharge(db, {
      tenantId: principal.tenantId,
      orderId,
      type: input.type,
      amountMinor: input.amountMinor,
      currency: order.settlementCurrency,
      description: input.description,
      fileIds: input.fileIds,
      reviewReasons,
      submittedAt: now,
      submittedBy: principal.user.id,
      disputeUntil: disputeDeadline(now),
    });
    await insertAuditLog(db, consoleOrigin(tenantActor(principal.user), ip, now), {
      tenantId: principal.tenantId,
      resource: "extra_charge",
      resourceId: charge.id,
      action: "submit",
      before: null,
      after: { order_id: orderId, type: input.type, amount_minor: input.amountMinor, currency: order.settlementCurrency, file_count: input.fileIds.length, review_reasons: reviewReasons, dispute_until: charge.disputeUntil.toISOString() },
    });
    return charge;
  });
}

/** 供应商撤回（异议期内）。 */
export async function withdrawExtraChargeForTenant(ctx: AppContext, principal: TenantPrincipal, orderId: string, chargeId: string, ip: string): Promise<ExtraCharge> {
  const now = ctx.now();
  return withTenantTx(ctx.pool, principal.tenantId, async (db) => {
    const charge = await findExtraCharge(db, principal.tenantId, chargeId, { lock: true });
    if (charge === null || charge.orderId !== orderId) throw notFound("加收");
    assertTenantCanOperate((await findTenantOrder(db, principal.tenantId, orderId)) as Order, "withdraw_extra_charge");
    const refused = (): AppError => new AppError(409, "EXTRA_CHARGE_STATE_INVALID", "只有异议期内的加收能撤回（异议期截止那一刻起不能）", { status: charge.status, action: "withdraw", dispute_until: charge.disputeUntil.toISOString() });
    if (!extraChargeWithdrawable(charge, now)) throw refused();
    if (!(await withdrawExtraCharge(db, principal.tenantId, chargeId, now))) throw refused();
    await insertAuditLog(db, consoleOrigin(tenantActor(principal.user), ip, now), { tenantId: principal.tenantId, resource: "extra_charge", resourceId: chargeId, action: "withdraw", before: { status: "in_window" }, after: { status: "withdrawn", order_id: orderId } });
    return (await findExtraCharge(db, principal.tenantId, chargeId)) as ExtraCharge;
  });
}

/** 客人异议（渠道代提）：只认本渠道的单、异议期内。已经提过的再提一次返回现在的样子。 */
export async function disputeExtraCharge(ctx: AppContext, channelId: string, orderId: string, chargeId: string, reason: string): Promise<ExtraCharge> {
  const now = ctx.now();
  return withPlatformTx(ctx.pool, async (db) => {
    const sale = await findSale(db, orderId);
    const charge = sale === null || sale.channelId !== channelId ? null : await findExtraChargeForPlatform(db, orderId, chargeId, { lock: true });
    if (charge === null) throw notFound("加收");
    if (charge.disputedAt !== null) return charge;
    if (charge.status !== "in_window" || !disputeOpen(charge.disputeUntil, now)) throw new AppError(409, "DISPUTE_WINDOW_CLOSED", `异议期（提交后 ${EXTRA_CHARGE_RULES.disputeHours} 小时）已经过了，或这一项已经有结果了`, { status: charge.status, dispute_until: charge.disputeUntil.toISOString() });
    const order = (await findOrderForPlatform(db, orderId)) as Order;
    await updateExtraCharge(db, charge, { status: "disputed", reviewReasons: [...new Set<ExtraChargeReviewReason>([...charge.reviewReasons, "DISPUTED"])], disputedAt: now, disputeReason: reason }, now);
    await recordEvent(db, order, charge.id, "EXTRA_CHARGE_DISPUTED", "guest", now);
    return (await findExtraChargeForPlatform(db, orderId, chargeId)) as ExtraCharge;
  });
}

async function recordEvent(db: Db, order: Order, chargeId: string, reason: string, actor: "guest" | "platform_user" | "system", now: Date): Promise<void> {
  await insertOrderEvent(db, order, { fromStatus: order.status, toStatus: order.status, actor, reason, occurredAt: now, detail: { extra_charge_id: chargeId } });
}

/**
 * 平台审核（`order.manage`）：待审核、有异议的通过或驳回；扣款失败的也可以驳回（不收了）。通过后马上扣款。
 * 只能审「待审核 / 有异议 / 扣款失败」的（`extraChargeReviewRefusal`）：正在扣、已扣的 409——收款服务出错后的重新排队走 `chargeExtra` 自己的入口；
 * 通过要等异议期结束（有异议的也一样）。两人同时审：行锁 + 状态条件更新，只有一个成功。
 */
export async function decideExtraCharge(ctx: AppContext, principal: PlatformPrincipal, orderId: string, chargeId: string, input: { decision: ExtraChargeDecision; approvedMinor: number | null; note: string | null }, ip: string, log: OrderLog): Promise<ExtraCharge> {
  const now = ctx.now();
  const origin = consoleOrigin(platformActor(principal.user), ip, now);
  const decided = await withPlatformTx(ctx.pool, async (db) => {
    const charge = await findExtraChargeForPlatform(db, orderId, chargeId, { lock: true });
    if (charge === null) throw notFound("加收");
    const to = input.decision === "approve" ? "approved" : "rejected";
    const refused = (): AppError => new AppError(409, "EXTRA_CHARGE_STATE_INVALID", "这一项现在不能这样审核（异议期内的要等异议期结束才能通过；正在扣款、已经扣款或已经审过的不能再审）", { status: charge.status, action: input.decision, dispute_until: charge.disputeUntil.toISOString() });
    if (extraChargeReviewRefusal(charge, input.decision, now) !== null) throw refused();
    const approved = to === "approved" ? approvedExtraChargeAmount(charge.amountMinor, input.approvedMinor) : null;
    if (to === "approved" && approved === null) throw validationFailed("body", [{ path: "/approved_amount", reason: "OUT_OF_RANGE", message: "部分通过的金额要在 1 和提交的金额之间" }]);
    if (!(await updateExtraCharge(db, charge, { status: to, decidedAt: now, decidedBy: principal.user.id, decisionNote: input.note, ...(approved === null ? {} : { approvedMinor: approved, nextChargeAt: now }) }, now, charge.status))) throw refused();
    await insertAuditLog(db, origin, { tenantId: null, resource: "extra_charge", resourceId: chargeId, action: "decide", before: { status: charge.status }, after: { status: to, order_id: orderId, approved_minor: approved, amount_minor: charge.amountMinor, currency: charge.currency, note: input.note } });
    return charge;
  });
  if (input.decision === "approve") await chargeExtra(ctx, decided.tenantId, chargeId, log);
  return withPlatformTx(ctx.pool, async (db) => (await findExtraChargeForPlatform(db, orderId, chargeId)) as ExtraCharge);
}

/** 财务重试扣款失败的那一项（`payment.manage`）：用一条新的收款记录（上一次的已经明确失败了）。 */
export async function retryExtraCharge(ctx: AppContext, principal: PlatformPrincipal, orderId: string, chargeId: string, ip: string, log: OrderLog): Promise<ExtraCharge> {
  const now = ctx.now();
  const charge = await withPlatformTx(ctx.pool, async (db) => {
    const found = await findExtraChargeForPlatform(db, orderId, chargeId, { lock: true });
    if (found === null) throw notFound("加收");
    if (found.status !== "charge_failed") throw new AppError(409, "EXTRA_CHARGE_STATE_INVALID", "只有扣款失败的能重试", { status: found.status, action: "retry" });
    await updateExtraCharge(db, found, { status: "approved", chargeAttempts: 0, nextChargeAt: now }, now);
    await insertAuditLog(db, consoleOrigin(platformActor(principal.user), ip, now), { tenantId: null, resource: "extra_charge", resourceId: chargeId, action: "retry", before: { status: "charge_failed", last_error: found.lastChargeError }, after: { status: "approved", order_id: orderId } });
    return found;
  });
  await chargeExtra(ctx, charge.tenantId, chargeId, log);
  return withPlatformTx(ctx.pool, async (db) => (await findExtraChargeForPlatform(db, orderId, chargeId)) as ExtraCharge);
}

export type ChargeOutcome = "charged" | "processing" | "failed" | "retry" | "skipped";

/**
 * 扣一项加收：先「租下」（正在扣，租约 2 分钟，次数加一），取这一项还在 creating 的收款记录（收款服务出错后重试用同一条）或新建一条，
 * 事务之外扣款，再记结果。只扣「审核通过 / 等重试」的和「异议期结束、不用审核」的（后者由 `closeWindow` 转过来）。
 */
export async function chargeExtra(ctx: AppContext, tenantId: string, chargeId: string, log: OrderLog): Promise<ChargeOutcome> {
  const now = ctx.now();
  const claimed = await withPlatformTx(ctx.pool, async (db) => {
    const charge = await findExtraCharge(db, tenantId, chargeId, { lock: true });
    if (charge === null) return null;
    const leaseExpired = charge.status === "charging" && charge.nextChargeAt !== null && charge.nextChargeAt.getTime() <= now.getTime();
    if (!(charge.status === "approved" || leaseExpired)) return null;
    const order = (await findOrderForPlatform(db, charge.orderId)) as Order;
    const sale = (await findSale(db, charge.orderId)) as OrderSale;
    const saved = savedPaymentMethod(await findOrderPayment(db, charge.orderId));
    if (saved === null) {
      await updateExtraCharge(db, charge, { status: "charge_failed", nextChargeAt: null, lastChargeError: { code: "NO_SAVED_PAYMENT_METHOD", decline_code: null, message: "这一单没有保存下来的支付方式" } }, now);
      return { failed: true as const };
    }
    const amount = customerAmountOf(charge, sale);
    let payment = (await listOrderPayments(db, charge.orderId)).find((item) => item.kind === "extra_charge" && item.extraChargeId === charge.id && (item.status === "creating" || item.status === "processing"));
    if (payment === undefined) {
      payment = await insertOffSessionPayment(db, { orderId: charge.orderId, supplierTenantId: tenantId, kind: "extra_charge", changeId: null, extraChargeId: charge.id, customerId: saved.customerId, paymentMethodId: saved.paymentMethodId, amountMinor: amount, currency: sale.currency, saveConsentAt: saved.saveConsentAt, now });
    }
    await updateExtraCharge(db, charge, { status: "charging", chargeAttempts: charge.chargeAttempts + 1, nextChargeAt: new Date(now.getTime() + 120_000) }, now);
    return { charge: { ...charge, chargeAttempts: charge.chargeAttempts + 1 }, payment, orderNo: order.orderNo };
  });
  if (claimed === null) return "skipped";
  if ("failed" in claimed) return "failed";
  const { charge, payment, orderNo } = claimed;
  if (payment.status === "processing") return settleFromPayment(ctx, charge, payment, log);
  try {
    const outcome = await chargeOffSession(ctx, payment, { orderNo, description: `NOZOMI ${orderNo} 服务后加收` });
    const declined = outcome.outcome === "declined" ? outcome.error : { code: null, declineCode: null, message: null };
    return await withPlatformTx(ctx.pool, async (db): Promise<ChargeOutcome> => {
      const at = ctx.now();
      if (outcome.outcome === "succeeded") {
        await updateExtraCharge(db, charge, { status: "charged", chargedAt: at, nextChargeAt: null, lastChargeError: null }, at);
        return "charged";
      }
      if (outcome.outcome === "processing") {
        // 处理中：等通知（或租约到期后再查一次）
        await updateExtraCharge(db, charge, { status: "charging", nextChargeAt: new Date(at.getTime() + 30 * 60_000) }, at);
        return "processing";
      }
      await updateExtraCharge(db, charge, { status: "charge_failed", nextChargeAt: null, lastChargeError: { code: declined.code, decline_code: declined.declineCode, message: declined.message } }, at);
      log.error({ event: "extra_charge.charge_failed", orderId: charge.orderId, chargeId: charge.id, code: declined.code, declineCode: declined.declineCode }, "事后加收扣款失败：需要财务核实（支付异常）");
      return "failed";
    });
  } catch (err) {
    if (!(err instanceof PaymentProviderError)) throw err;
    const next = err.retryable ? nextChargeAttemptAt(charge.chargeAttempts, ctx.now()) : null;
    await withPlatformTx(ctx.pool, (db) =>
      updateExtraCharge(db, charge, next === null ? { status: "charge_failed", nextChargeAt: null, lastChargeError: { code: err.code, decline_code: null, message: err.message } } : { status: "approved", nextChargeAt: next, lastChargeError: { code: err.code, decline_code: null, message: err.message } }, ctx.now()),
    );
    if (next === null) log.error({ event: "extra_charge.charge_failed", orderId: charge.orderId, chargeId: charge.id, code: err.code }, "事后加收扣款失败：需要财务核实（支付异常）");
    return next === null ? "failed" : "retry";
  }
}

/** 收款记录在处理中：去收款服务查现在的状态，按结果记。 */
async function settleFromPayment(ctx: AppContext, charge: ExtraCharge, payment: OrderPayment, log: OrderLog): Promise<ChargeOutcome> {
  if (payment.intentId === null || ctx.payments === null) return "processing";
  let status: string;
  try {
    status = (await ctx.payments.retrievePayment(payment.intentId)).status;
  } catch (err) {
    log.warn({ err, chargeId: charge.id }, "查加收的付款状态时收款服务出错，下一轮再试");
    return "processing";
  }
  return withPlatformTx(ctx.pool, async (db): Promise<ChargeOutcome> => {
    const at = ctx.now();
    if (status === "succeeded") {
      await updateOrderPayment(db, payment.id, { status: "succeeded", succeededAt: at }, at);
      await updateExtraCharge(db, charge, { status: "charged", chargedAt: at, nextChargeAt: null }, at);
      return "charged";
    }
    if (status === "processing") {
      await updateExtraCharge(db, charge, { status: "charging", nextChargeAt: new Date(at.getTime() + 30 * 60_000) }, at);
      return "processing";
    }
    await updateOrderPayment(db, payment.id, { status: "failed" }, at);
    await updateExtraCharge(db, charge, { status: "charge_failed", nextChargeAt: null, lastChargeError: { code: "card_declined", decline_code: null, message: null } }, at);
    return "failed";
  });
}

/** 收款服务的通知说一笔加收的离线扣款有了结果（处理中的那种）。在通知的事务里调用。 */
export async function settleExtraChargeFromWebhook(db: Db, payment: OrderPayment, succeeded: boolean, now: Date): Promise<void> {
  if (payment.extraChargeId === null) return;
  const charge = await findExtraCharge(db, payment.supplierTenantId, payment.extraChargeId, { lock: true });
  if (charge === null || charge.status !== "charging") return;
  await updateExtraCharge(db, charge, succeeded ? { status: "charged", chargedAt: now, nextChargeAt: null } : { status: "charge_failed", nextChargeAt: null, lastChargeError: { code: "card_declined", decline_code: null, message: null } }, now);
}

/** 定时任务：异议期到了的去扣款或去待审核；该扣款的扣款。 */
export async function sweepExtraCharges(ctx: AppContext, log: OrderLog, limit = 50): Promise<{ toReview: number; charged: number; failed: number }> {
  const now = ctx.now();
  const result = { toReview: 0, charged: 0, failed: 0 };
  const closed = await withPlatformTx(ctx.pool, (db) => listWindowClosedCharges(db, now, limit));
  for (const entry of closed) {
    const next = await withPlatformTx(ctx.pool, async (db) => {
      const charge = await findExtraCharge(db, entry.tenantId, entry.id, { lock: true });
      if (charge === null || charge.status !== "in_window" || disputeOpen(charge.disputeUntil, ctx.now())) return null;
      const to = afterDisputeWindow(charge.reviewReasons);
      // 不用审核的直接进「正在扣」（租约设成现在：下面这一轮马上扣）
      await updateExtraCharge(db, charge, to === "review" ? { status: "review" } : { status: "charging", nextChargeAt: ctx.now() }, ctx.now());
      return to;
    });
    if (next === "review") result.toReview += 1;
  }
  const due = await withPlatformTx(ctx.pool, (db) => listDueCharges(db, ctx.now(), limit));
  for (const entry of due) {
    const outcome = await chargeExtra(ctx, entry.tenantId, entry.id, log);
    if (outcome === "charged") result.charged += 1;
    if (outcome === "failed") result.failed += 1;
  }
  return result;
}
