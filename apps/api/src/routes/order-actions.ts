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
 * - `POST /tenant/v1/orders/{id}/changes/{changeId}/confirm`、`/reject`、`/adjusting`：同意 / 拒绝 / 标记调整中（ADR 0060）；
 * - `GET /tenant/v1/order-todos`、`POST …/{id}/ack`：待办和角标。
 * 运营后台（`/platform/v1`）：
 * - `GET /platform/v1/cancellation-policy`、`POST …/cancellation-policy/changes`（双人复核）；
 * - `GET /platform/v1/orders/{id}/cancel-fee`、`POST …/cancel`（多退了钱的发起双人复核）、`PATCH …/orders/{id}`（代客人改单）；
 * - `POST /platform/v1/orders/{id}/changes/{changeId}/confirm`、`/reject`、`/adjusting`：代供应商处理改单（ADR 0060）；
 * - `POST /platform/v1/orders/{id}/events`：代供应商回传履约（ADR 0052；「已接到客人」「已完成」发起双人复核）；
 * - `POST …/extra-charges/{chargeId}/decide`（审核）、`POST …/extra-charges/{chargeId}/retry`、`POST …/refunds/{refundId}/retry`（财务重试）。
 * 运营后台按订单的接口都先核对数据范围（ADR 0030：订单的城市、渠道），范围外的和不存在一样；取消政策是全平台的，不按范围。
 */
import { orderPassengerNames } from "../services/passenger-privacy.ts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PlatformAction } from "@nozomi/domain";
import { maskOrderValues, VIEW_LINK_VERIFICATIONS, EVIDENCE_FILE_RULES, EXTRA_CHARGE_RULES, EXTRA_CHARGE_TYPES, FULFILMENT_EVENTS, MESSAGING_APPS, ORDER_CANCEL_REASONS, PROXY_FULFILMENT_RULES, SERVICE_CATEGORIES, VEHICLE_LEVELS } from "@nozomi/domain";
import { bearerToken } from "../auth/token.ts";
import type { AppContext } from "../context.ts";
import { AppError } from "../errors.ts";
import { type StoredCancellationPolicy } from "../repos/cancellation-policies.ts";
import type { OrderChange } from "../repos/order-changes.ts";
import { type CancellationQuote, cancelForChannel, cancelForPlatform, previewCancellation } from "../services/cancellations.ts";
import { getCancellationPolicy, requestCancellationPolicyChange } from "../services/cancellation-policy.ts";
import { notFound } from "../services/errors.ts";
import { decideExtraCharge, disputeExtraCharge, retryExtraCharge, submitExtraCharge, uploadReceipt, withdrawExtraChargeForTenant } from "../services/extra-charges.ts";
import { type OrderChangeInput, changeForChannel, decideChange } from "../services/order-changes.ts";
import { changeOrderForPlatform } from "../services/passenger-email-review.ts";
import { passengerEmailReviewJson } from "./serialize.ts";
import { acknowledgeTodo, listTodos, orderTodoJson } from "../services/order-todos.ts";
import { retryRefund } from "../services/order-money.ts";
import { changeJson, extraChargeJson } from "../services/order-views.ts";
import { reportProxyFulfilment } from "../services/proxy-fulfilment.ts";
import { getSalesOrderView } from "../services/orders.ts";
import { authenticatePlatform, platformCredentials } from "../services/platform-auth.ts";
import { assertPlatformOrderInScope } from "../services/order-queries.ts";
import { authenticateSales } from "../services/sales-auth.ts";
import { salesMoney } from "../services/sales-quotes.ts";
import { authenticateTenant } from "../services/tenant-auth.ts";
import { dateTimeSchema, ifMatchVersion, parseInput, passengerInput, passengerPatchInput, resourceId, singleLine, validationFailed, visibleText } from "../validation.ts";
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

// 没有定位：运营不在现场，代传的「已到达」不能成为 no-show 的证据（ADR 0052）
const proxyFulfilmentSchema = z
  .object({
    type: z.enum(FULFILMENT_EVENTS),
    occurred_at: dateTimeSchema,
    reason: visibleText(PROXY_FULFILMENT_RULES.reasonMax),
    actual: z.object({ minutes: z.number().int().min(0).max(10_080).nullable().default(null), km: z.number().int().min(0).max(5_000).nullable().default(null) }).strict().nullable().default(null),
  })
  .strict();

export const changeSchema = z
  .object({
    passenger: passengerInput().optional(),
    flight_no: z.string().max(20).nullable().optional(),
    messaging: z.object({ app: z.enum(MESSAGING_APPS), handle: z.string().max(200) }).strict().nullable().optional(),
    notes: z.string().max(2_000).nullable().optional(),
    pickup_address: singleLine(1_000).optional(),
    dropoff_address: singleLine(1_000).optional(),
    service_time: dateTimeSchema.optional(),
    passengers: z.number().int().min(1).max(60).optional(),
    luggage: z.number().int().min(0).max(60).optional(),
  })
  .strict();

/**
 * 运营代改（ADR 0065）：乘客信息可以只给要改的那几项（运营后台只看得到打码的）；改了邮箱要写核实方式和原因（`email_review`），
 * 邮箱那一项要另一位同事批准才生效。
 */
const platformChangeSchema = changeSchema
  .extend({
    passenger: passengerPatchInput().optional(),
    email_review: z.object({ verification: z.enum(VIEW_LINK_VERIFICATIONS), reason: visibleText(500) }).strict().optional(),
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
// 拒绝必填原因；运营代处理都必填（说明联系过谁、为什么代处理，ADR 0060）
const changeReasonSchema = z.object({ note: visibleText(500) }).strict();
const fileQuerySchema = z.object({ kind: z.literal("receipt") }).strict();

export function toChangeInput(body: Omit<z.output<typeof changeSchema>, "passenger"> & { passenger?: OrderChangeInput["passenger"] }): OrderChangeInput {
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

/** 谁能读平台取消政策（有任一个即可）：主数据查看（取消政策页）；商品查看（商品「服务规则」里的取消规则，M4-15，ADR 0047 补充）。 */
export const CANCELLATION_POLICY_READ_ACTIONS = ["master_data.read", "product.read"] as const satisfies readonly PlatformAction[];

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

function changeExpired(change: OrderChange): AppError {
  return new AppError(409, "CHANGE_CONFIRMATION_EXPIRED", "已经过了确认期限，这次修改按没确认处理", { change: changeJson(change) });
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

  for (const decision of ["confirm", "reject", "adjusting"] as const) {
    app.post(`/tenant/v1/orders/:id/changes/:changeId/${decision}`, async (request) => {
      const principal = await authenticateTenant(ctx, bearerToken(request.headers.authorization), { action: "order.dispatch" });
      const orderId = resourceId(request.params, "订单");
      const changeId = resourceId({ id: (request.params as { changeId?: unknown }).changeId }, "改单");
      const input = decision === "reject" ? parseInput(changeReasonSchema, request.body ?? {}, "body") : parseInput(changeDecisionSchema, request.body ?? {}, "body");
      const result = await decideChange(ctx, { kind: "tenant", principal }, orderId, changeId, decision, input.note, request.ip, request.log);
      if (result.expired) throw changeExpired(result.change);
      return { change: changeJson(result.change) };
    });
  }

  // 待办和角标（M4-29）：首页卡片和订单菜单用同一个接口
  app.get("/tenant/v1/order-todos", async (request) => {
    const principal = await authenticateTenant(ctx, bearerToken(request.headers.authorization), { action: "order.read" });
    const found = await listTodos(ctx, principal.tenantId);
    return { total: found.total, change_requests: found.changeRequests, items: found.items.map(orderTodoJson) };
  });

  app.post("/tenant/v1/order-todos/:id/ack", async (request) => {
    const principal = await authenticateTenant(ctx, bearerToken(request.headers.authorization), { action: "order.dispatch" });
    await acknowledgeTodo(ctx, principal.tenantId, principal.user.id, resourceId(request.params, "待办"));
    return { ok: true };
  });

  // ---- 运营后台 ----

  app.get("/platform/v1/cancellation-policy", async (request) => {
    await authenticatePlatform(ctx, platformCredentials(request), { anyOf: CANCELLATION_POLICY_READ_ACTIONS });
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
    if (result.kind === "approval") return reply.code(202).send({ approval: maskOrderValues(approvalJson(result.approval, principal), (await orderPassengerNames(ctx, [orderId])).get(orderId) ?? null) });
    return { order_id: result.orderId, replayed: result.replayed };
  });

  app.post("/platform/v1/orders/:id/events", async (request, reply) => {
    const principal = await authenticatePlatform(ctx, platformCredentials(request), { action: "order.proxy_fulfilment" });
    const orderId = resourceId(request.params, "订单");
    await assertPlatformOrderInScope(ctx, principal.grant.scope, orderId);
    const version = ifMatchVersion(request.headers["if-match"]);
    const input = parseInput(proxyFulfilmentSchema, request.body, "body");
    const result = await reportProxyFulfilment(ctx, principal, orderId, version, { type: input.type, occurredAt: input.occurred_at, reason: input.reason, actual: input.actual }, request.ip);
    if (result.kind === "approval") return reply.code(202).send({ approval: maskOrderValues(approvalJson(result.approval, principal), (await orderPassengerNames(ctx, [orderId])).get(orderId) ?? null) });
    return { order_id: orderId, status: result.order.status, version: result.order.version };
  });

  app.patch("/platform/v1/orders/:id", async (request, reply) => {
    const principal = await authenticatePlatform(ctx, platformCredentials(request), { action: "order.manage" });
    const orderId = resourceId(request.params, "订单");
    await assertPlatformOrderInScope(ctx, principal.grant.scope, orderId);
    const version = ifMatchVersion(request.headers["if-match"]);
    const input = parseInput(platformChangeSchema, request.body ?? {}, "body");
    if (input.email_review !== undefined && input.passenger?.email === undefined) throw validationFailed("body", [{ path: "/email_review", reason: "NOT_APPLICABLE", message: "没有改乘客邮箱，不用写核实方式（请删掉）" }]);
    const result = await changeOrderForPlatform(ctx, principal, orderId, version, toChangeInput(input), input.email_review ?? null, request.ip, request.log);
    // 响应里的改前值不能绕过「查看」（ADR 0055）
    const change = result.change === null ? null : maskOrderValues(changeJson(result.change), (await orderPassengerNames(ctx, [orderId])).get(orderId) ?? null);
    // 只改了邮箱：没有立即生效或待确认的改动，只发起了复核
    return reply.code(change === null ? 202 : 200).send({ change, email_review: result.emailReview === null ? null : passengerEmailReviewJson(result.emailReview) });
  });

  // 运营代供应商处理改单（ADR 0060）：有权限、有审计，必填原因；不是双人复核
  for (const decision of ["confirm", "reject", "adjusting"] as const) {
    app.post(`/platform/v1/orders/:id/changes/:changeId/${decision}`, async (request) => {
      const principal = await authenticatePlatform(ctx, platformCredentials(request), { action: "order.change_decide" });
      const orderId = resourceId(request.params, "订单");
      await assertPlatformOrderInScope(ctx, principal.grant.scope, orderId);
      const changeId = resourceId({ id: (request.params as { changeId?: unknown }).changeId }, "改单");
      const input = parseInput(changeReasonSchema, request.body ?? {}, "body");
      const result = await decideChange(ctx, { kind: "platform", principal }, orderId, changeId, decision, input.note, request.ip, request.log);
      if (result.expired) throw changeExpired(result.change);
      return { change: maskOrderValues(changeJson(result.change), (await orderPassengerNames(ctx, [orderId])).get(orderId) ?? null) };
    });
  }

  app.post("/platform/v1/orders/:id/extra-charges/:chargeId/decide", async (request) => {
    const principal = await authenticatePlatform(ctx, platformCredentials(request), { action: "order.manage" });
    const orderId = resourceId(request.params, "订单");
    await assertPlatformOrderInScope(ctx, principal.grant.scope, orderId);
    const chargeId = resourceId({ id: (request.params as { chargeId?: unknown }).chargeId }, "加收");
    const input = parseInput(decideSchema, request.body, "body");
    const charge = await decideExtraCharge(ctx, principal, orderId, chargeId, { decision: input.decision, approvedMinor: input.approved_amount, note: input.note }, request.ip, request.log);
    return { extra_charge: maskOrderValues(extraChargeJson(charge), (await orderPassengerNames(ctx, [orderId])).get(orderId) ?? null) };
  });

  app.post("/platform/v1/orders/:id/extra-charges/:chargeId/retry", async (request) => {
    const principal = await authenticatePlatform(ctx, platformCredentials(request), { action: "payment.manage" });
    const orderId = resourceId(request.params, "订单");
    await assertPlatformOrderInScope(ctx, principal.grant.scope, orderId);
    const chargeId = resourceId({ id: (request.params as { chargeId?: unknown }).chargeId }, "加收");
    const retried = await retryExtraCharge(ctx, principal, orderId, chargeId, request.ip, request.log);
    return { extra_charge: maskOrderValues(extraChargeJson(retried), (await orderPassengerNames(ctx, [orderId])).get(orderId) ?? null) };
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
