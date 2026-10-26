/**
 * 救援改派与违约金的接口（M3-04，ADR 0031）。这里只做鉴权、校验、调用、返回；规则在 @nozomi/domain 的 rescue.ts，流程在 services/rescues.ts。
 *
 * 供应商（`/tenant/v1`，租户编号只来自令牌）：
 * - `POST /tenant/v1/orders/{id}/declare-unable`：声明无法履约（`order.dispatch`，原因必填）；
 * - `GET /tenant/v1/rescue-offers`、`GET …/{id}`、`POST …/{id}/accept`、`POST …/{id}/decline`：发给自己的救援单（`order.dispatch`）；
 * - `GET /tenant/v1/deductions`：自己的应扣款项（违约金、救援差价，`order.read`）。
 *   这些应答里没有对外价、加价比例（规则 4），也没有别的供应商是谁。
 * 运营后台（`/platform/v1`）：
 * - `GET /platform/v1/rescues`：救援队列（`order.read`）；
 * - `POST /platform/v1/orders/{id}/rescue`：按 4 种情形之一发起；`GET …/rescue/candidates`：候选；`POST …/rescue/offers`：发救援单；
 *   `POST …/rescue/manual-assign`：人工指定（双人复核）；`POST …/rescue/force-majeure`：不可抗力（都要 `rescue.manage`）；
 * - `POST /platform/v1/tenants/{id}/rescue`：暂停中的供应商名下未来订单批量发起（`rescue.manage`）。
 * 渠道（`/sales/v1`）：`POST /sales/v1/orders/{id}/driver-missing`：客人报告司机没到。
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { RESCUE_RULES, RESCUE_TRIGGERS, type SettlementBreakdown } from "@nozomi/domain";
import { bearerToken } from "../auth/token.ts";
import type { AppContext } from "../context.ts";
import { AppError } from "../errors.ts";
import type { Deduction, RescueOffer } from "../repos/rescues.ts";
import { notFound } from "../services/errors.ts";
import { getSalesOrderView } from "../services/orders.ts";
import { authenticatePlatform } from "../services/platform-auth.ts";
import {
  type PlatformRescueView,
  type TenantRescueView,
  declareUnable,
  decideOfferForTenant,
  getOfferForTenant,
  getOrderRescueViews,
  listDeductionsForTenant,
  listOffersForTenant,
  markForceMajeure,
  offerForPlatform,
  rescueCandidates,
  reportDriverMissing,
  rescueQueue,
  rescueSuspendedTenantForPlatform,
  requestManualAssign,
  triggerForPlatform,
} from "../services/rescues.ts";
import { authenticateSales } from "../services/sales-auth.ts";
import { salesMoney } from "../services/sales-quotes.ts";
import { authenticateTenant } from "../services/tenant-auth.ts";
import { parseInput, resourceId, uuidSchema } from "../validation.ts";
import { approvalJson } from "./channels.ts";
import { REFUSAL_MESSAGES } from "./quotes.ts";
import { salesOrderJson } from "./sales.ts";

type Json = Record<string, unknown>;

const iso = (date: Date | null): string | null => date?.toISOString() ?? null;

/** 没能当候选的原因的中文说明：报价引擎的原因用它的说明，另有救援单自己的几种。 */
const EXCLUDED_MESSAGES: Readonly<Record<string, string>> = {
  OFFER_DECLINED: "这次救援已经拒绝了",
  OFFER_EXPIRED: "这次救援的救援单超时没接",
  OFFER_PENDING: "救援单正在等它接",
  OFFER_CLOSED: "这次救援的救援单已收回",
  CHANNEL_NOT_SELLING: "这一单的渠道不卖这家供应商",
};

function excludedMessage(reason: string): string {
  return EXCLUDED_MESSAGES[reason] ?? (REFUSAL_MESSAGES as Readonly<Record<string, string>>)[reason] ?? reason;
}
const requiredNote = z.string().trim().min(1).max(RESCUE_RULES.noteMaxLength);
const optionalNote = z.string().trim().max(RESCUE_RULES.noteMaxLength).nullable().default(null);

const declareSchema = z.object({ reason: requiredNote }).strict();
const offerListSchema = z.object({ status: z.literal("pending").optional() }).strict();
const declineSchema = z.object({ reason: optionalNote }).strict();
const deductionListSchema = z.object({ order_id: uuidSchema.transform((value) => value.toLowerCase()).optional() }).strict();
const queueSchema = z.object({ state: z.enum(["open", "closed"]).default("open") }).strict();
const triggerSchema = z.object({ trigger: z.enum(RESCUE_TRIGGERS), note: requiredNote }).strict();
const offerSchema = z.object({ tenant_id: uuidSchema.transform((value) => value.toLowerCase()).nullable().default(null) }).strict();
const manualSchema = z
  .object({
    tenant_id: uuidSchema.transform((value) => value.toLowerCase()),
    product_id: uuidSchema.transform((value) => value.toLowerCase()),
    // 最小货币单位的整数（这个商品的结算币种），和价格规则的金额一样；上限同报价引擎的结算价上限
    settlement_amount: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    note: requiredNote,
  })
  .strict();
const forceMajeureSchema = z.object({ note: requiredNote }).strict();
const batchSchema = z.object({ note: optionalNote }).strict();

/** 结算价明细（和订单的 `settlement` 同一个格式）。 */
function breakdownJson(settlement: SettlementBreakdown): Json {
  const money = (minor: number): Json => salesMoney(minor, settlement.currency);
  return {
    total: money(settlement.totalMinor),
    base: money(settlement.baseMinor),
    adjust: money(settlement.adjustMinor),
    urgent: money(settlement.urgentMinor),
    night: money(settlement.nightMinor),
    addons: money(settlement.addonsMinor),
    driver_language: money(settlement.driverLanguageMinor),
  };
}

export function tenantDeductionJson(deduction: Deduction & { orderNo: string; serviceAt: Date }): Json {
  return {
    id: deduction.id,
    order_id: deduction.orderId,
    order_no: deduction.orderNo,
    service_time: deduction.serviceAt.toISOString(),
    kind: deduction.kind,
    amount: salesMoney(deduction.amountMinor, deduction.currency),
    status: deduction.status,
    basis: deduction.basis,
    waived_at: iso(deduction.waivedAt),
    waive_reason: deduction.waiveReason,
    created_at: deduction.createdAt.toISOString(),
  };
}

/** 供应商看到的这一单和救援的关系：原供应商有触发和违约金；救援供应商只知道是接来的救援单。 */
export function tenantOrderRescueJson(view: TenantRescueView | null, order: { orderNo: string; serviceAt: Date }): Json | null {
  if (view === null) return null;
  const { rescue } = view;
  const original = view.role === "original";
  return {
    role: view.role,
    status: rescue.status,
    trigger: original ? rescue.trigger : null,
    triggered_at: original ? rescue.triggeredAt.toISOString() : null,
    reason: original ? rescue.reason : null,
    penalty_bp: original ? rescue.penaltyBp : null,
    penalty_tier: original ? rescue.penaltyTier : null,
    force_majeure: original && rescue.forceMajeureAt !== null,
    rescued_at: iso(rescue.rescuedAt),
    deductions: view.deductions.map((deduction) => tenantDeductionJson({ ...deduction, orderNo: order.orderNo, serviceAt: order.serviceAt })),
  };
}

function tenantOfferJson(offer: RescueOffer): Json {
  return {
    id: offer.id,
    status: offer.status,
    offered_at: offer.offeredAt.toISOString(),
    expires_at: offer.expiresAt.toISOString(),
    decided_at: iso(offer.decidedAt),
    decline_reason: offer.declineReason,
    trip: offer.trip,
    product_id: offer.productId,
    product_version: offer.productVersion,
    vehicle_group_id: offer.vehicleGroupId,
    settlement: breakdownJson(offer.settlement),
    order_id: offer.status === "accepted" ? offer.orderId : null,
  };
}

function platformDeductionJson(deduction: Deduction): Json {
  return {
    id: deduction.id,
    tenant_id: deduction.tenantId,
    kind: deduction.kind,
    amount: salesMoney(deduction.amountMinor, deduction.currency),
    status: deduction.status,
    basis: deduction.basis,
    waived_at: iso(deduction.waivedAt),
    waive_reason: deduction.waiveReason,
    created_at: deduction.createdAt.toISOString(),
  };
}

export function platformRescueJson(view: PlatformRescueView): Json {
  const { rescue, order } = view;
  return {
    id: rescue.id,
    order: { id: order.id, order_no: order.orderNo, category: order.category, city_id: order.cityId, place_id: order.placeId, vehicle_group_id: order.vehicleGroupId, service_time: order.serviceAt.toISOString(), service_local: order.serviceLocal, timezone: order.timezone },
    trigger: rescue.trigger,
    triggered_by_type: rescue.triggeredByType,
    reason: rescue.reason,
    triggered_at: rescue.triggeredAt.toISOString(),
    from_status: rescue.fromStatus,
    original_tenant: { id: rescue.originalTenantId, name: view.originalTenantName },
    original_settlement: salesMoney(rescue.originalSettlementMinor, rescue.originalSettlementCurrency),
    penalty_bp: rescue.penaltyBp,
    penalty_tier: rescue.penaltyTier,
    penalty: salesMoney(view.deductions.find((entry) => entry.kind === "penalty")?.amountMinor ?? 0, rescue.originalSettlementCurrency),
    status: rescue.status,
    rescue_tenant: rescue.rescueTenantId === null ? null : { id: rescue.rescueTenantId, name: view.rescueTenantName ?? "" },
    rescue_settlement: rescue.rescueSettlementMinor === null || rescue.rescueSettlementCurrency === null ? null : salesMoney(rescue.rescueSettlementMinor, rescue.rescueSettlementCurrency),
    rescued_via: rescue.rescuedVia,
    rescued_at: iso(rescue.rescuedAt),
    force_majeure: rescue.forceMajeureAt === null ? null : { at: rescue.forceMajeureAt.toISOString(), by: rescue.forceMajeureBy, note: rescue.forceMajeureNote },
    closed_at: iso(rescue.closedAt),
    offers: view.offers.map(({ offer, tenantName, quote }) => ({
      id: offer.id,
      tenant: { id: offer.tenantId, name: tenantName },
      product_id: offer.productId,
      product_version: offer.productVersion,
      status: offer.status,
      offered_by_type: offer.offeredByType,
      offered_at: offer.offeredAt.toISOString(),
      expires_at: offer.expiresAt.toISOString(),
      decided_at: iso(offer.decidedAt),
      decline_reason: offer.declineReason,
      settlement: salesMoney(offer.settlementMinor, offer.settlementCurrency),
      sell: quote === null ? null : salesMoney(quote.sellMinor, quote.currency),
      markup_bp: quote?.markupBp ?? null,
      position: quote?.position ?? null,
    })),
    deductions: view.deductions.map(platformDeductionJson),
    version: rescue.version,
  };
}

export function registerRescueRoutes(app: FastifyInstance, ctx: AppContext): void {
  const latestRescueJson = async (orderId: string): Promise<Json> => {
    const views = await getOrderRescueViews(ctx, orderId);
    const latest = views[views.length - 1];
    if (latest === undefined) throw notFound("救援");
    return platformRescueJson(latest);
  };

  // ---- 供应商 ----

  app.post("/tenant/v1/orders/:id/declare-unable", async (request) => {
    const principal = await authenticateTenant(ctx, bearerToken(request.headers.authorization), { action: "order.dispatch" });
    const orderId = resourceId(request.params, "订单");
    const input = parseInput(declareSchema, request.body, "body");
    const triggered = await declareUnable(ctx, principal, orderId, input.reason, request.ip, request.log);
    const deductions = (await listDeductionsForTenant(ctx, principal.tenantId, orderId)).filter((entry) => entry.rescueId === triggered.rescue.id);
    return { rescue: tenantOrderRescueJson({ role: "original", rescue: triggered.rescue, deductions }, triggered.order) };
  });

  app.get("/tenant/v1/rescue-offers", async (request) => {
    const principal = await authenticateTenant(ctx, bearerToken(request.headers.authorization), { action: "order.dispatch" });
    const query = parseInput(offerListSchema, request.query, "querystring");
    return { items: (await listOffersForTenant(ctx, principal.tenantId, query.status === "pending")).map(tenantOfferJson) };
  });

  app.get("/tenant/v1/rescue-offers/:id", async (request) => {
    const principal = await authenticateTenant(ctx, bearerToken(request.headers.authorization), { action: "order.dispatch" });
    return { offer: tenantOfferJson(await getOfferForTenant(ctx, principal.tenantId, resourceId(request.params, "救援单"))) };
  });

  app.post("/tenant/v1/rescue-offers/:id/accept", async (request) => {
    const principal = await authenticateTenant(ctx, bearerToken(request.headers.authorization), { action: "order.dispatch" });
    const result = await decideOfferForTenant(ctx, principal, resourceId(request.params, "救援单"), "accept", null, request.ip, request.log);
    if (result.expired) throw new AppError(409, "RESCUE_OFFER_EXPIRED", "已经过了接单期限，这张救援单记为超时，平台已顺延给下一家", { offer: tenantOfferJson(result.offer) });
    return { offer: tenantOfferJson(result.offer), order_id: result.orderId };
  });

  app.post("/tenant/v1/rescue-offers/:id/decline", async (request) => {
    const principal = await authenticateTenant(ctx, bearerToken(request.headers.authorization), { action: "order.dispatch" });
    const offerId = resourceId(request.params, "救援单");
    const input = parseInput(declineSchema, request.body ?? {}, "body");
    const result = await decideOfferForTenant(ctx, principal, offerId, "decline", input.reason, request.ip, request.log);
    if (result.expired) throw new AppError(409, "RESCUE_OFFER_EXPIRED", "已经过了接单期限，这张救援单记为超时", { offer: tenantOfferJson(result.offer) });
    return { offer: tenantOfferJson(result.offer) };
  });

  app.get("/tenant/v1/deductions", async (request) => {
    const principal = await authenticateTenant(ctx, bearerToken(request.headers.authorization), { action: "order.read" });
    const query = parseInput(deductionListSchema, request.query, "querystring");
    return { items: (await listDeductionsForTenant(ctx, principal.tenantId, query.order_id ?? null)).map(tenantDeductionJson) };
  });

  // ---- 运营后台 ----

  app.get("/platform/v1/rescues", async (request) => {
    await authenticatePlatform(ctx, bearerToken(request.headers.authorization), { action: "order.read" });
    const query = parseInput(queueSchema, request.query, "querystring");
    const queue = await rescueQueue(ctx, query.state);
    return {
      items: queue.items.map(platformRescueJson),
      alerts: queue.alerts.map((alert) => ({
        order_id: alert.id,
        order_no: alert.orderNo,
        tenant: { id: alert.tenantId, name: alert.tenantName },
        status: alert.status,
        service_time: alert.serviceAt.toISOString(),
        arrival_overdue_at: iso(alert.arrivalOverdueAt),
        driver_missing_reported_at: iso(alert.driverMissingReportedAt),
      })),
      suspended_tenants: queue.suspendedTenants.map((entry) => ({ tenant: { id: entry.tenantId, name: entry.name }, future_orders: entry.orders })),
    };
  });

  app.post("/platform/v1/orders/:id/rescue", async (request, reply) => {
    const principal = await authenticatePlatform(ctx, bearerToken(request.headers.authorization), { action: "rescue.manage" });
    const orderId = resourceId(request.params, "订单");
    const input = parseInput(triggerSchema, request.body, "body");
    await triggerForPlatform(ctx, principal, orderId, input, request.ip, request.log);
    return reply.code(201).send({ rescue: await latestRescueJson(orderId) });
  });

  app.get("/platform/v1/orders/:id/rescue/candidates", async (request) => {
    await authenticatePlatform(ctx, bearerToken(request.headers.authorization), { action: "rescue.manage" });
    const found = await rescueCandidates(ctx, resourceId(request.params, "订单"), request.log);
    return {
      rescue_id: found.rescue.id,
      candidates: found.candidates.map((entry) => ({
        tenant: { id: entry.tenantId, name: entry.tenantName },
        product_id: entry.productId,
        product_version: entry.productVersion,
        settlement: salesMoney(entry.settlement.totalMinor, entry.settlement.currency),
        sell: salesMoney(entry.sellMinor, entry.sellCurrency),
        markup_bp: entry.markupBp,
        position: entry.position,
        in_band: entry.inBand,
        difference: entry.differenceMinor === null ? null : salesMoney(entry.differenceMinor, found.rescue.originalSettlementCurrency),
        urgent: entry.urgent,
      })),
      excluded: found.excluded.map((entry) => ({ tenant: { id: entry.tenantId, name: entry.tenantName }, product_id: entry.productId, reason: entry.reason, message: excludedMessage(entry.reason) })),
    };
  });

  app.post("/platform/v1/orders/:id/rescue/offers", async (request, reply) => {
    const principal = await authenticatePlatform(ctx, bearerToken(request.headers.authorization), { action: "rescue.manage" });
    const orderId = resourceId(request.params, "订单");
    const input = parseInput(offerSchema, request.body ?? {}, "body");
    const offer = await offerForPlatform(ctx, principal, orderId, input.tenant_id, request.ip, request.log);
    const rescue = await latestRescueJson(orderId);
    return reply.code(201).send({ offer: (rescue["offers"] as Json[]).find((entry) => entry["id"] === offer.id) });
  });

  app.post("/platform/v1/orders/:id/rescue/manual-assign", async (request, reply) => {
    const principal = await authenticatePlatform(ctx, bearerToken(request.headers.authorization), { action: "rescue.manage" });
    // 先认路径里的编号（不像编号的统一 404），再校验请求体——和其他带 {id} 的接口一致
    const orderId = resourceId(request.params, "订单");
    const input = parseInput(manualSchema, request.body, "body");
    const approval = await requestManualAssign(ctx, principal, orderId, { tenantId: input.tenant_id, productId: input.product_id, settlementMinor: input.settlement_amount, note: input.note }, request.ip);
    return reply.code(202).send({ approval: approvalJson(approval, principal) });
  });

  app.post("/platform/v1/orders/:id/rescue/force-majeure", async (request) => {
    const principal = await authenticatePlatform(ctx, bearerToken(request.headers.authorization), { action: "rescue.manage" });
    const orderId = resourceId(request.params, "订单");
    const input = parseInput(forceMajeureSchema, request.body, "body");
    const result = await markForceMajeure(ctx, principal, orderId, input.note, request.ip);
    const views = await getOrderRescueViews(ctx, orderId);
    return { rescue: platformRescueJson(views.find((view) => view.rescue.id === result.rescue.id) as PlatformRescueView), waived: result.waived };
  });

  app.post("/platform/v1/tenants/:id/rescue", async (request) => {
    const principal = await authenticatePlatform(ctx, bearerToken(request.headers.authorization), { action: "rescue.manage" });
    const tenantId = resourceId(request.params, "租户");
    const input = parseInput(batchSchema, request.body ?? {}, "body");
    const result = await rescueSuspendedTenantForPlatform(ctx, principal, tenantId, input.note, request.ip, request.log);
    return { triggered: result.triggered, skipped: result.skipped.map((entry) => ({ order_id: entry.orderId, code: entry.code })) };
  });

  // ---- 渠道 ----

  app.post("/sales/v1/orders/:id/driver-missing", async (request) => {
    const principal = await authenticateSales(ctx, bearerToken(request.headers.authorization), "other");
    const orderId = resourceId(request.params, "订单");
    const { first } = await reportDriverMissing(ctx, principal.channelId, orderId, request.log);
    const view = await getSalesOrderView(ctx, principal.channelId, orderId);
    if (view === null) throw notFound("订单");
    return { order: salesOrderJson(view, ctx.now()), first_report: first };
  });
}
