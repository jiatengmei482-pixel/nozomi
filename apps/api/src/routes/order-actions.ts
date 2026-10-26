/**
 * 取消、改单、事后加收、取消政策的接口（M3-03，ADR 0029）。这里只做鉴权、校验、调用、返回；规则在 @nozomi/domain，流程在 services/。
 *
 * 渠道（`/sales/v1`，渠道编号只来自令牌，别的渠道的单当作不存在）：
 * - `GET /sales/v1/orders/{id}/cancel-fee`：退款试算；`POST /sales/v1/orders/{id}/cancel`：取消（重复取消返回那一次的结果）；
 * - `PATCH /sales/v1/orders/{id}`：改单（`If-Match` 带订单版本）；
 * - `POST /sales/v1/orders/{id}/extra-charges/{chargeId}/dispute`：客人对事后加收提异议。
 * 供应商（`/tenant/v1`，租户编号只来自令牌）：
 * - `GET /tenant/v1/cancellation-policy`：平台的取消政策（只读）；
 * - `POST /tenant/v1/orders/{id}/files`：上传票据照片；`POST …/extra-charges`：提交加收；`POST …/extra-charges/{chargeId}/withdraw`：撤回；
 * - `POST /tenant/v1/orders/{id}/changes/{changeId}/confirm`、`/reject`：确认 / 拒绝改期。
 * 运营后台（`/platform/v1`）：
 * - `GET /platform/v1/cancellation-policy`、`POST …/cancellation-policy/changes`（双人复核）；
 * - `GET /platform/v1/orders/{id}/cancel-fee`、`POST …/cancel`（多退了钱的发起双人复核）、`PATCH …/orders/{id}`（代客人改单）；
 * - `POST …/extra-charges/{chargeId}/decide`（审核）、`POST …/extra-charges/{chargeId}/retry`、`POST …/refunds/{refundId}/retry`（财务重试）。
 * 运营后台按订单的接口都先核对数据范围（ADR 0030：订单的城市、渠道），范围外的和不存在一样；取消政策是全平台的，不按范围。
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { EVIDENCE_FILE_RULES, EXTRA_CHARGE_RULES, EXTRA_CHARGE_TYPES, MESSAGING_APPS, ORDER_CANCEL_REASONS, SERVICE_CATEGORIES, VEHICLE_LEVELS } from "@nozomi/domain";
import { bearerToken } from "../auth/token.ts";
import type { AppContext } from "../context.ts";
import { AppError } from "../errors.ts";
import { type StoredCancellationPolicy } from "../repos/cancellation-policies.ts";
import { type CancellationQuote, cancelForChannel, cancelForPlatform, previewCancellation } from "../services/cancellations.ts";
import { getCancellationPolicy, requestCancellationPolicyChange } from "../services/cancellation-policy.ts";
import { notFound } from "../services/errors.ts";
import { decideExtraCharge, disputeExtraCharge, retryExtraCharge, submitExtraCharge, uploadReceipt, withdrawExtraChargeForTenant } from "../services/extra-charges.ts";
import { type OrderChangeInput, changeForChannel, changeForPlatform, decideChangeForTenant } from "../services/order-changes.ts";
import { retryRefund } from "../services/order-money.ts";
import { changeJson, extraChargeJson } from "../services/order-views.ts";
import { getSalesOrderView } from "../services/orders.ts";
import { authenticatePlatform, platformCredentials } from "../services/platform-auth.ts";
import { assertPlatformOrderInScope } from "../services/order-queries.ts";
import { authenticateSales } from "../services/sales-auth.ts";
import { salesMoney } from "../services/sales-quotes.ts";
import { authenticateTenant } from "../services/tenant-auth.ts";
import { dateTimeSchema, ifMatchVersion, parseInput, resourceId } from "../validation.ts";
import { approvalJson } from "./channels.ts";
import { fileJson } from "./orders.ts";
import { salesOrderJson } from "./sales.ts";

type Json = Record<string, unknown>;

const note = (max: number) => z.string().trim().max(max).nullable().default(null);

const tierSchema = z.object({ min_hours_before: z.number().int(), fee_bp: z.number().int() }).strict();
const policySchema = z
  .object({
    rules: z.array(z.object({ category: z.enum(SERVICE_CATEGORIES), level: z.enum(VEHICLE_LEVELS), tiers: z.array(tierSchema).max(10) }).strict()).max(50),
    note: note(500),
  })
  .strict();

export const salesCancelSchema = z.object({ reason: z.enum(["GUEST_REQUEST", "CHANGE_NOT_CONFIRMED"]).default("GUEST_REQUEST") }).strict();
export const salesFeeQuerySchema = z.object({ reason: z.enum(["GUEST_REQUEST", "CHANGE_NOT_CONFIRMED"]).default("GUEST_REQUEST") }).strict();
const platformCancelReasons = ORDER_CANCEL_REASONS.filter((reason) => reason !== "PAYMENT_TIMEOUT" && reason !== "PAYMENT_CANCELED") as [string, ...string[]];
const platformCancelSchema = z.object({ reason: z.enum(platformCancelReasons as ["GUEST_REQUEST"]), waive_fee: z.boolean().default(false), note: z.string().trim().min(1).max(500) }).strict();
const platformFeeQuerySchema = z.object({ reason: z.enum(platformCancelReasons as ["GUEST_REQUEST"]).default("GUEST_REQUEST"), waive_fee: z.enum(["true", "false"]).default("false") }).strict();

export const changeSchema = z
  .object({
    passenger: z.object({ name: z.string().max(200), phone: z.string().max(40), email: z.string().max(320) }).strict().optional(),
    flight_no: z.string().max(20).nullable().optional(),
    messaging: z.object({ app: z.enum(MESSAGING_APPS), handle: z.string().max(200) }).strict().nullable().optional(),
    notes: z.string().max(2_000).nullable().optional(),
    pickup_address: z.string().max(1_000).optional(),
    dropoff_address: z.string().max(1_000).optional(),
    service_time: dateTimeSchema.optional(),
    passengers: z.number().int().min(1).max(60).optional(),
    luggage: z.number().int().min(0).max(60).optional(),
  })
  .strict();

export const disputeSchema = z.object({ reason: z.string().trim().min(1).max(EXTRA_CHARGE_RULES.disputeReasonMax) }).strict();
const extraChargeSchema = z
  .object({
    type: z.enum(EXTRA_CHARGE_TYPES),
    // 最小货币单位的整数（这一单的结算币种），和价格规则的金额一样
    amount: z.number().int(),
    description: z.string().trim().max(EXTRA_CHARGE_RULES.descriptionMax).nullable().default(null),
    file_ids: z.array(z.string().uuid()).max(EXTRA_CHARGE_RULES.maxFilesPerItem).default([]),
  })
  .strict();
const decideSchema = z.object({ decision: z.enum(["approve", "reject"]), approved_amount: z.number().int().nullable().default(null), note: note(500) }).strict();
const changeDecisionSchema = z.object({ note: note(500) }).strict();
const fileQuerySchema = z.object({ kind: z.literal("receipt") }).strict();

export function toChangeInput(body: z.output<typeof changeSchema>): OrderChangeInput {
  const input: OrderChangeInput = {};
  if (body.passenger !== undefined) input.passenger = body.passenger;
  if (body.flight_no !== undefined) input.flightNo = body.flight_no;
  if (body.messaging !== undefined) input.messaging = body.messaging;
  if (body.notes !== undefined) input.notes = body.notes;
  if (body.pickup_address !== undefined) input.pickupAddress = body.pickup_address;
  if (body.dropoff_address !== undefined) input.dropoffAddress = body.dropoff_address;
  if (body.service_time !== undefined) input.serviceTime = body.service_time;
  if (body.passengers !== undefined) input.passengers = body.passengers;
  if (body.luggage !== undefined) input.luggage = body.luggage;
  return input;
}

export function cancellationPolicyJson(policy: StoredCancellationPolicy): Json {
  return {
    version: policy.version,
    effective_at: policy.createdAt?.toISOString() ?? null,
    rules: policy.rules.map((rule) => ({ category: rule.category, level: rule.level, tiers: rule.tiers.map((tier) => ({ min_hours_before: tier.minHoursBefore, fee_bp: tier.feeBp })) })),
  };
}

/** 退款试算：渠道看客人这边的金额；运营后台另有供应商应得和阶梯上本来该扣的。 */
export function feeJson(quote: CancellationQuote | null, scope: "sales" | "platform"): Json {
  if (quote === null) return { cancellable: false };
  const base = {
    cancellable: true,
    stage: quote.stage,
    reason: quote.reason,
    tier_index: quote.tierIndex,
    hours_before_service: Math.floor(quote.msBeforeService / 3_600_000),
    fee_bp: quote.feeBp,
    paid: salesMoney(quote.paidMinor, quote.currency),
    fee: salesMoney(quote.customerFeeMinor, quote.currency),
    refund: salesMoney(quote.refundMinor, quote.currency),
    policy: { version: quote.policy.version, category: quote.policy.category, level: quote.policy.level, tiers: quote.policy.tiers.map((tier) => ({ min_hours_before: tier.minHoursBefore, fee_bp: tier.feeBp })) },
  };
  if (scope === "sales") return base;
  return { ...base, policy_fee_bp: quote.policyFeeBp, policy_refund: salesMoney(quote.policyRefundMinor, quote.currency), tenant_share: salesMoney(quote.tenantShareMinor, quote.settlementCurrency), needs_review: quote.refundMinor > quote.policyRefundMinor };
}

export function registerOrderActionRoutes(app: FastifyInstance, ctx: AppContext): void {
  const channel = (authorization: string | undefined) => authenticateSales(ctx, bearerToken(authorization), "other");
  const salesView = async (channelId: string, orderId: string): Promise<Json> => {
    const view = await getSalesOrderView(ctx, channelId, orderId);
    if (view === null) throw notFound("订单");
    return salesOrderJson(view, ctx.now());
  };

  // ---- 渠道 ----

  app.get("/sales/v1/orders/:id/cancel-fee", async (request) => {
    const principal = await channel(request.headers.authorization);
    const orderId = resourceId(request.params, "订单");
    const query = parseInput(salesFeeQuerySchema, request.query, "querystring");
    const found = await previewCancellation(ctx, { channelId: principal.channelId }, orderId, query.reason, false);
    return feeJson(found.quote, "sales");
  });

  app.post("/sales/v1/orders/:id/cancel", async (request) => {
    const principal = await channel(request.headers.authorization);
    const orderId = resourceId(request.params, "订单");
    const input = parseInput(salesCancelSchema, request.body ?? {}, "body");
    const result = await cancelForChannel(ctx, principal.channelId, orderId, input.reason, request.log);
    return { order: await salesView(principal.channelId, orderId), replayed: result.kind === "cancelled" && result.replayed };
  });

  app.patch("/sales/v1/orders/:id", async (request) => {
    const principal = await channel(request.headers.authorization);
    const orderId = resourceId(request.params, "订单");
    const version = ifMatchVersion(request.headers["if-match"]);
    const input = parseInput(changeSchema, request.body ?? {}, "body");
    const result = await changeForChannel(ctx, principal.channelId, orderId, version, toChangeInput(input), request.log);
    const order = await salesView(principal.channelId, orderId);
    return { order, change: (order["changes"] as Json[]).find((change) => change["id"] === result.change.id) ?? null };
  });

  app.post("/sales/v1/orders/:id/extra-charges/:chargeId/dispute", async (request) => {
    const principal = await channel(request.headers.authorization);
    const orderId = resourceId(request.params, "订单");
    const chargeId = resourceId({ id: (request.params as { chargeId?: unknown }).chargeId }, "加收");
    const input = parseInput(disputeSchema, request.body, "body");
    await disputeExtraCharge(ctx, principal.channelId, orderId, chargeId, input.reason);
    const order = await salesView(principal.channelId, orderId);
    return { order, extra_charge: (order["extra_charges"] as Json[]).find((charge) => charge["id"] === chargeId) ?? null };
  });

  // ---- 供应商 ----

  app.get("/tenant/v1/cancellation-policy", async (request) => {
    const principal = await authenticateTenant(ctx, bearerToken(request.headers.authorization), { action: "master_data.read" });
    return { policy: cancellationPolicyJson(await getCancellationPolicy(ctx, { tenantId: principal.tenantId })) };
  });

  // 票据照片按原始字节上传：只在这一个接口上认图片类型，上限 5 MB（和司机 H5 一样）
  app.register(async (scoped) => {
    for (const type of EVIDENCE_FILE_RULES.contentTypes) scoped.addContentTypeParser(type, { parseAs: "buffer", bodyLimit: EVIDENCE_FILE_RULES.maxBytes }, (_request, body, done) => done(null, body));
    scoped.post("/tenant/v1/orders/:id/files", async (request, reply) => {
      const principal = await authenticateTenant(ctx, bearerToken(request.headers.authorization), { action: "order.extra_charge" });
      const orderId = resourceId(request.params, "订单");
      parseInput(fileQuerySchema, request.query, "querystring");
      const body = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
      const file = await uploadReceipt(ctx, principal, orderId, request.headers["content-type"], body);
      return reply.code(201).send({ file: fileJson(file) });
    });
  });

  app.post("/tenant/v1/orders/:id/extra-charges", async (request, reply) => {
    const principal = await authenticateTenant(ctx, bearerToken(request.headers.authorization), { action: "order.extra_charge" });
    const orderId = resourceId(request.params, "订单");
    const input = parseInput(extraChargeSchema, request.body, "body");
    const charge = await submitExtraCharge(ctx, principal, orderId, { type: input.type, amountMinor: input.amount, description: input.description, fileIds: input.file_ids.map((id) => id.toLowerCase()) }, request.ip);
    return reply.code(201).send({ extra_charge: extraChargeJson(charge) });
  });

  app.post("/tenant/v1/orders/:id/extra-charges/:chargeId/withdraw", async (request) => {
    const principal = await authenticateTenant(ctx, bearerToken(request.headers.authorization), { action: "order.extra_charge" });
    const orderId = resourceId(request.params, "订单");
    const chargeId = resourceId({ id: (request.params as { chargeId?: unknown }).chargeId }, "加收");
    return { extra_charge: extraChargeJson(await withdrawExtraChargeForTenant(ctx, principal, orderId, chargeId, request.ip)) };
  });

  for (const decision of ["confirm", "reject"] as const) {
    app.post(`/tenant/v1/orders/:id/changes/:changeId/${decision}`, async (request) => {
      const principal = await authenticateTenant(ctx, bearerToken(request.headers.authorization), { action: "order.dispatch" });
      const orderId = resourceId(request.params, "订单");
      const changeId = resourceId({ id: (request.params as { changeId?: unknown }).changeId }, "改单");
      const input = parseInput(changeDecisionSchema, request.body ?? {}, "body");
      const result = await decideChangeForTenant(ctx, principal, orderId, changeId, decision, input.note, request.ip, request.log);
      if (result.expired) throw new AppError(409, "CHANGE_CONFIRMATION_EXPIRED", "已经过了 30 分钟的确认时间，这次改期按没确认处理（客人可以免费取消）", { change: changeJson(result.change) });
      return { change: changeJson(result.change) };
    });
  }

  // ---- 运营后台 ----

  app.get("/platform/v1/cancellation-policy", async (request) => {
    await authenticatePlatform(ctx, platformCredentials(request), { action: "master_data.read" });
    return { policy: cancellationPolicyJson(await getCancellationPolicy(ctx, "platform")) };
  });

  app.post("/platform/v1/cancellation-policy/changes", async (request, reply) => {
    const principal = await authenticatePlatform(ctx, platformCredentials(request), { action: "cancellation_policy.manage" });
    const input = parseInput(policySchema, request.body, "body");
    const approval = await requestCancellationPolicyChange(ctx, principal, input.rules.map((rule) => ({ category: rule.category, level: rule.level, tiers: rule.tiers.map((tier) => ({ minHoursBefore: tier.min_hours_before, feeBp: tier.fee_bp })) })), input.note, request.ip);
    return reply.code(202).send({ approval: approvalJson(approval, principal) });
  });

  app.get("/platform/v1/orders/:id/cancel-fee", async (request) => {
    const principal = await authenticatePlatform(ctx, platformCredentials(request), { action: "order.read" });
    const orderId = resourceId(request.params, "订单");
    await assertPlatformOrderInScope(ctx, principal.grant.scope, orderId);
    const query = parseInput(platformFeeQuerySchema, request.query, "querystring");
    const found = await previewCancellation(ctx, "platform", orderId, query.reason, query.waive_fee === "true");
    return feeJson(found.quote, "platform");
  });

  app.post("/platform/v1/orders/:id/cancel", async (request, reply) => {
    const principal = await authenticatePlatform(ctx, platformCredentials(request), { action: "order.manage" });
    const orderId = resourceId(request.params, "订单");
    await assertPlatformOrderInScope(ctx, principal.grant.scope, orderId);
    const input = parseInput(platformCancelSchema, request.body, "body");
    const result = await cancelForPlatform(ctx, principal, orderId, { reason: input.reason, waiveFee: input.waive_fee, note: input.note }, request.ip, request.log);
    if (result.kind === "approval") return reply.code(202).send({ approval: approvalJson(result.approval, principal) });
    return { order_id: result.orderId, replayed: result.replayed };
  });

  app.patch("/platform/v1/orders/:id", async (request) => {
    const principal = await authenticatePlatform(ctx, platformCredentials(request), { action: "order.manage" });
    const orderId = resourceId(request.params, "订单");
    await assertPlatformOrderInScope(ctx, principal.grant.scope, orderId);
    const version = ifMatchVersion(request.headers["if-match"]);
    const input = parseInput(changeSchema, request.body ?? {}, "body");
    const result = await changeForPlatform(ctx, principal, orderId, version, toChangeInput(input), request.ip, request.log);
    return { change: changeJson(result.change) };
  });

  app.post("/platform/v1/orders/:id/extra-charges/:chargeId/decide", async (request) => {
    const principal = await authenticatePlatform(ctx, platformCredentials(request), { action: "order.manage" });
    const orderId = resourceId(request.params, "订单");
    await assertPlatformOrderInScope(ctx, principal.grant.scope, orderId);
    const chargeId = resourceId({ id: (request.params as { chargeId?: unknown }).chargeId }, "加收");
    const input = parseInput(decideSchema, request.body, "body");
    const charge = await decideExtraCharge(ctx, principal, orderId, chargeId, { decision: input.decision, approvedMinor: input.approved_amount, note: input.note }, request.ip, request.log);
    return { extra_charge: extraChargeJson(charge) };
  });

  app.post("/platform/v1/orders/:id/extra-charges/:chargeId/retry", async (request) => {
    const principal = await authenticatePlatform(ctx, platformCredentials(request), { action: "payment.manage" });
    const orderId = resourceId(request.params, "订单");
    await assertPlatformOrderInScope(ctx, principal.grant.scope, orderId);
    const chargeId = resourceId({ id: (request.params as { chargeId?: unknown }).chargeId }, "加收");
    return { extra_charge: extraChargeJson(await retryExtraCharge(ctx, principal, orderId, chargeId, request.ip, request.log)) };
  });

  app.post("/platform/v1/orders/:id/refunds/:refundId/retry", async (request) => {
    const principal = await authenticatePlatform(ctx, platformCredentials(request), { action: "payment.manage" });
    const orderId = resourceId(request.params, "订单");
    await assertPlatformOrderInScope(ctx, principal.grant.scope, orderId);
    const refundId = resourceId({ id: (request.params as { refundId?: unknown }).refundId }, "退款");
    const { outcome, refund } = await retryRefund(ctx, principal, orderId, refundId, request.ip, request.log);
    return { outcome, refund: refund === null ? null : { id: refund.id, status: refund.status, amount: salesMoney(refund.amountMinor, refund.currency), last_error: refund.lastError } };
  });
}
