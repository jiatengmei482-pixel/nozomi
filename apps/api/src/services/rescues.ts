/**
 * 救援改派与违约金（M3-04，ADR 0031）。规则在 @nozomi/domain 的 rescue.ts；这里把触发、候选、救援单、改派、违约金和差价的记账、不可抗力接到数据库和报价引擎上。
 *
 * **触发**（4 种情形，每次都写订单流水、审计，服务日志 `order.rescue_triggered` 通知运营，订单进入「救援改派中」，原供应商不能再操作这一单）：
 * - 供应商声明无法履约（`POST /tenant/v1/orders/{id}/declare-unable`，必须写原因；运营也可以替它登记）；
 * - 用车前 6 小时仍未派车（订单定时任务每分钟自动触发；付款时已不足 6 小时的单从派车截止时间起算）；
 * - 司机未到（到点 15 分钟仍未「已到达」：定时任务记下提醒、客人可以在订单页报告，进运营后台的救援队列，由运营判定「联系不上」后触发）；
 * - 供应商被暂停（运营对暂停中的供应商批量发起，名下的未来订单逐张触发；M4-01 的状态变化也调同一个函数）。
 * 同一张单同时只能有一个没有结论的救援：先锁订单再看状态，数据库的唯一索引兜底——并发触发只建一条。
 *
 * **违约金**在触发时按阶梯定下来（基数是原结算价），记一条「供应商应扣款项」；改派成功时再记救援差价（救援结算价按快照汇率换到原结算币种 − 原结算价，为负记 0）。
 * 现在只记账，实际扣款在 M5 结算时从账单里扣。不可抗力由运营认定（单人，写说明，留审计），这次救援的应扣款项全部免除。
 *
 * **救援单**：按原报价条件（原来的请求、同一个渠道、同一个车型组、现在的用车时间和人数）重新比价，排除这一单以前的供应商和已经发过的，按中标排序。
 * 运营在后台选一家发出（默认第一名）；救援单是唯一要供应商主动接的订单：15 分钟（用车前 2 小时内 5 分钟）不接、拒绝就自动顺延下一家；
 * 都不接（或一家都没有）进入「候选都不接」，运营人工指定（双人复核）或取消订单全额退款。
 *
 * **改派**：原供应商的那一行变成「已转给救援供应商」（只能查看），救援供应商照着它另起一行（同一个订单编号），从「已确认」开始按普通订单履约，
 * 结算价是它这一次的报价；客人付的钱不变（`order_sales` 只换「现在的供应商」）。推送：原供应商 `order.rescued_away`，救援供应商 `order.confirmed`（`data.rescue = true`）。
 */
import {
  type CurrencyCode,
  type FxQuote,
  type OrderStatus,
  type QuoteRequest,
  RESCUE_RULES,
  RESCUE_TRIGGER_NAMES,
  type RescueTrigger,
  type SettlementBreakdown,
  rescueDifference,
  rescueOfferDeadline,
  rescueOfferExpired,
  rescuePenalty,
  rescuePenaltyMinor,
  rescueTriggerRefusal,
  rescuedDispatchDeadline,
} from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { type Db, isUniqueViolation, withPlatformTx, withTenantTx } from "../db/context.ts";
import { AppError } from "../errors.ts";
import type { Approval } from "../repos/approvals.ts";
import { type AuditOrigin, insertAuditLog } from "../repos/audit-logs.ts";
import { type Order, type OrderEventActor, type OrderSale, findOrderForPlatform, findOrdersOfTenants, findSale, insertOrderEvent, releaseSoldInventory, sellInventoryOnDay, updateOrderStatus } from "../repos/orders.ts";
import {
  type Deduction,
  type Rescue,
  type RescueActorType,
  type RescueOffer,
  type RescueQuote,
  type RescueQuoteCandidate,
  type RescueTrip,
  findOpenRescue,
  findRescue,
  findRescueOfOriginal,
  findRescueOfRescuer,
  findTenantOffer,
  insertDeduction,
  insertRescue,
  insertRescueOffer,
  insertRescueQuote,
  insertRescuedOrder,
  listDriverAlerts,
  listExpiredOffers,
  listFutureOrdersOfTenant,
  listOffersOfRescues,
  listOrderRescues,
  listRescueDeductions,
  listRescueOffers,
  listRescueQuotes,
  listRescues,
  listSuspendedTenantsWithFutureOrders,
  listTenantDeductions,
  listTenantOffers,
  markDriverMissingReported,
  markOrderRescued,
  moveSaleToTenant,
  revokeDriverLinksForRescue,
  updateOfferStatus,
  updateRescue,
  waiveDeductions,
} from "../repos/rescues.ts";
import type { OrderRefund } from "../repos/refunds.ts";
import { validationFailed } from "../validation.ts";
import { type ApprovalKind, requestApproval } from "./approvals.ts";
import { consoleOrigin, platformActor, tenantActor } from "./audit.ts";
import { notFound } from "./errors.ts";
import { abandonOpenChange } from "./order-changes.ts";
import { processRefunds } from "./order-money.ts";
import { type OrderLog, SILENT_ORDER_LOG } from "./orders.ts";
import type { PlatformPrincipal } from "./platform-auth.ts";
import { type QuoteLog, previewPlatformQuote } from "./quotes.ts";
import type { StoredQuoteSnapshot } from "./sales-quotes.ts";
import type { TenantPrincipal } from "./tenant-auth.ts";
import { enqueueTenantEvent } from "./tenant-webhooks.ts";

const JOB_BATCH = 50;

/** 谁触发 / 发出 / 接单：审计和流水用。 */
export interface RescueActor {
  type: RescueActorType;
  id: string | null;
  origin: AuditOrigin;
}

function systemOrigin(now: Date): AuditOrigin {
  return { occurredAt: now, actor: { type: "system", id: null, email: null }, ip: null, source: "job" };
}

const SYSTEM = (now: Date): RescueActor => ({ type: "system", id: null, origin: systemOrigin(now) });

function eventActor(type: RescueActorType): OrderEventActor {
  return type === "tenant_user" ? "tenant_user" : type === "platform_user" ? "platform_user" : "system";
}

const TRIGGER_REFUSALS = {
  ORDER_STATE_INVALID: { status: 409, code: "ORDER_STATE_INVALID", message: "订单当前的状态不能进入救援改派（只有已确认、已派车、司机已出发的单可以；派了车就不是「未派车」）" },
  TOO_EARLY: { status: 409, code: "RESCUE_TRIGGER_NOT_MET", message: "还没到这种情形的触发时间（未派车：用车前 6 小时、且过了派车截止时间；司机未到：到点 15 分钟后）" },
  TENANT_NOT_SUSPENDED: { status: 409, code: "RESCUE_TRIGGER_NOT_MET", message: "这家供应商现在没有被暂停" },
  SERVICE_TIME_PASSED: { status: 409, code: "RESCUE_TRIGGER_NOT_MET", message: "用车时间已经到了，不是未来订单" },
} as const;

function rescueAlreadyOpen(rescue: Rescue): AppError {
  return new AppError(409, "RESCUE_ALREADY_OPEN", "这张单已经在救援改派中了", { rescue_id: rescue.id, status: rescue.status });
}

/** 这一行的结算价换到客人支付币种用的汇率：救援供应商的行用它那次救援报价的汇率，否则用下单时的快照。 */
async function settlementFxOf(db: Db, order: Order, sale: OrderSale): Promise<FxQuote | null> {
  if (sale.currency === order.settlementCurrency) return null;
  const via = await findRescueOfRescuer(db, order.tenantId, order.id);
  if (via !== null && via.rescueSettlementCurrency === order.settlementCurrency) return via.rescueFx;
  return sale.fx;
}

export interface TriggerInput {
  trigger: RescueTrigger;
  reason: string | null;
  actor: RescueActor;
  /** 供应商自己声明时：只认这个供应商现在的单 */
  tenantId?: string;
}

export interface Triggered {
  rescue: Rescue;
  order: Order;
  penaltyMinor: number;
  refunds: OrderRefund[];
}

/**
 * 在调用方的平台事务里触发一次救援（订单要先锁住）：核对情形、定违约金、订单进入救援改派中、作废司机链接、没有结论的改单作废、
 * 记违约金（应扣款项）、流水、推 `order.status_changed` 给原供应商、审计、服务日志通知运营。
 */
export async function triggerRescueInTx(db: Db, order: Order, input: TriggerInput, log: OrderLog, now: Date): Promise<Triggered> {
  const open = await findOpenRescue(db, order.id, { lock: true });
  if (open !== null) throw rescueAlreadyOpen(open);
  const tenant = (await db.query<{ status: string }>("select status from tenants where id = $1", [order.tenantId])).rows[0];
  const refusal = rescueTriggerRefusal(input.trigger, { status: order.status, serviceAt: order.serviceAt, dispatchDueAt: order.dispatch.dueAt, landedAt: order.dispatch.landedAt, tenantSuspended: tenant?.status === "suspended", now });
  if (refusal !== null) {
    const error = TRIGGER_REFUSALS[refusal];
    throw new AppError(error.status, error.code, error.message, { reason: refusal, status: order.status, trigger: input.trigger });
  }
  const sale = (await findSale(db, order.id)) as OrderSale;
  const penalty = rescuePenalty(input.trigger, order.serviceAt, now);
  const penaltyMinor = rescuePenaltyMinor(order.settlementMinor, penalty.bp);
  let rescue: Rescue;
  try {
    rescue = await insertRescue(db, {
      orderId: order.id,
      originalTenantId: order.tenantId,
      trigger: input.trigger,
      triggeredByType: input.actor.type,
      triggeredBy: input.actor.id,
      reason: input.reason,
      triggeredAt: now,
      fromStatus: order.status,
      serviceAt: order.serviceAt,
      originalSettlementMinor: order.settlementMinor,
      originalSettlementCurrency: order.settlementCurrency,
      originalFx: await settlementFxOf(db, order, sale),
      penaltyBp: penalty.bp,
      penaltyTier: penalty.tier,
    });
  } catch (err) {
    if (isUniqueViolation(err, "order_rescues_open_key")) throw new AppError(409, "RESCUE_ALREADY_OPEN", "这张单已经在救援改派中了");
    throw err;
  }
  await updateOrderStatus(db, order, { status: "rescue_pending" }, now);
  await revokeDriverLinksForRescue(db, order, now);
  const refunds = await abandonOpenChange(db, order, now);
  await insertDeduction(db, {
    tenantId: order.tenantId,
    orderId: order.id,
    rescueId: rescue.id,
    kind: "penalty",
    amountMinor: penaltyMinor,
    currency: order.settlementCurrency,
    basis: { trigger: input.trigger, tier: penalty.tier, bp: penalty.bp, settlement_minor: order.settlementMinor, ms_before_service: penalty.msBeforeService },
    waived: null,
    now,
  });
  await insertOrderEvent(db, order, { fromStatus: order.status, toStatus: "rescue_pending", actor: eventActor(input.actor.type), reason: "RESCUE_TRIGGERED", occurredAt: now, detail: { trigger: input.trigger, penalty_bp: penalty.bp } });
  await enqueueTenantEvent(db, { tenantId: order.tenantId, type: "order.status_changed", orderId: order.id, data: { from_status: order.status, to_status: "rescue_pending", trigger: input.trigger } }, now);
  await insertAuditLog(db, input.actor.origin, {
    tenantId: input.actor.type === "tenant_user" ? order.tenantId : null,
    resource: "rescue",
    resourceId: rescue.id,
    action: "trigger",
    before: { order_id: order.id, status: order.status },
    after: { order_id: order.id, order_no: order.orderNo, status: "rescue_pending", trigger: input.trigger, reason: input.reason, penalty_bp: penalty.bp, penalty_minor: penaltyMinor, currency: order.settlementCurrency },
  });
  log.warn(
    { event: "order.rescue_triggered", orderId: order.id, orderNo: order.orderNo, tenantId: order.tenantId, trigger: input.trigger, penaltyBp: penalty.bp, serviceAt: order.serviceAt.toISOString() },
    `订单进入救援改派（${RESCUE_TRIGGER_NAMES[input.trigger]}）：请在运营后台的救援队列处理`,
  );
  return { rescue, order, penaltyMinor, refunds };
}

/** 一次触发（自己开平台事务）。`order` 的租户要对得上时传 `tenantId`（供应商声明：别的供应商的单当作不存在）。 */
async function trigger(ctx: AppContext, orderId: string, input: TriggerInput, log: OrderLog): Promise<Triggered> {
  const result = await withPlatformTx(ctx.pool, async (db) => {
    const order = await findOrderForPlatform(db, orderId, { lock: true });
    if (order === null || order.confirmedAt === null || (input.tenantId !== undefined && order.tenantId !== input.tenantId)) throw notFound("订单");
    return triggerRescueInTx(db, order, input, log, ctx.now());
  });
  await processRefunds(ctx, result.refunds, log);
  return result;
}

/** 供应商声明无法履约（`order.dispatch`）。租户编号只来自令牌；原因必填。 */
export async function declareUnable(ctx: AppContext, principal: TenantPrincipal, orderId: string, reason: string, ip: string, log: OrderLog): Promise<Triggered> {
  const now = ctx.now();
  return trigger(ctx, orderId, { trigger: "tenant_declared", reason, tenantId: principal.tenantId, actor: { type: "tenant_user", id: principal.user.id, origin: consoleOrigin(tenantActor(principal.user), ip, now) } }, log);
}

/** 运营按某种情形发起（`rescue.manage`）：替供应商登记声明、判定司机未到、单张的暂停救援、定时任务还没跑到的未派车。说明必填。 */
export async function triggerForPlatform(ctx: AppContext, principal: PlatformPrincipal, orderId: string, input: { trigger: RescueTrigger; note: string }, ip: string, log: OrderLog): Promise<Triggered> {
  const now = ctx.now();
  return trigger(ctx, orderId, { trigger: input.trigger, reason: input.note, actor: { type: "platform_user", id: principal.user.id, origin: consoleOrigin(platformActor(principal.user), ip, now) } }, log);
}

/**
 * 暂停中的供应商名下的未来订单逐张发起救援（运营批量发起，需求「运营批量发起」；M4-01 的状态变化也可以调这里）。
 * 每张单各自一个事务：一张失败（比如刚被别人处理了）不影响别的。返回触发了的和跳过的。
 */
export async function rescueSuspendedTenant(ctx: AppContext, actor: RescueActor, tenantId: string, note: string | null, log: OrderLog): Promise<{ triggered: string[]; skipped: { orderId: string; code: string }[] }> {
  const status = await withPlatformTx(ctx.pool, async (db) => (await db.query<{ status: string }>("select status from tenants where id = $1", [tenantId])).rows[0]?.status ?? null);
  if (status === null) throw notFound("租户");
  if (status !== "suspended") throw new AppError(409, "RESCUE_TRIGGER_NOT_MET", "这家供应商现在没有被暂停", { reason: "TENANT_NOT_SUSPENDED" });
  const orderIds = await withPlatformTx(ctx.pool, (db) => listFutureOrdersOfTenant(db, tenantId, ctx.now(), 500));
  const triggered: string[] = [];
  const skipped: { orderId: string; code: string }[] = [];
  for (const orderId of orderIds) {
    try {
      await trigger(ctx, orderId, { trigger: "tenant_suspended", reason: note, tenantId, actor }, log);
      triggered.push(orderId);
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      skipped.push({ orderId, code: err.code });
    }
  }
  return { triggered, skipped };
}

export async function rescueSuspendedTenantForPlatform(ctx: AppContext, principal: PlatformPrincipal, tenantId: string, note: string | null, ip: string, log: OrderLog): Promise<{ triggered: string[]; skipped: { orderId: string; code: string }[] }> {
  return rescueSuspendedTenant(ctx, { type: "platform_user", id: principal.user.id, origin: consoleOrigin(platformActor(principal.user), ip, ctx.now()) }, tenantId, note, log);
}

/** 客人在订单页报告「司机没到」（渠道调）：记下时间、写流水、通知运营。只在到点之后、司机还没到达时有效；重复报告不重复记。 */
export async function reportDriverMissing(ctx: AppContext, channelId: string, orderId: string, log: OrderLog): Promise<{ first: boolean }> {
  return withPlatformTx(ctx.pool, async (db) => {
    const sale = await findSale(db, orderId);
    if (sale === null || sale.channelId !== channelId) throw notFound("订单");
    const order = (await findOrderForPlatform(db, orderId, { lock: true })) as Order;
    const now = ctx.now();
    if (!["confirmed", "assigned", "departed"].includes(order.status)) throw new AppError(409, "ORDER_STATE_INVALID", "订单当前的状态不能报告司机没到（司机已到达、服务已开始、订单已取消或正在为您改派）", { status: order.status, action: "driver_missing" });
    if (now.getTime() < order.serviceAt.getTime()) throw new AppError(409, "DRIVER_MISSING_TOO_EARLY", "还没到用车时间", { service_time: order.serviceAt.toISOString() });
    const first = await markDriverMissingReported(db, order, now);
    if (first) {
      await insertOrderEvent(db, order, { fromStatus: order.status, toStatus: order.status, actor: "guest", reason: "DRIVER_MISSING_REPORTED", occurredAt: now });
      log.warn({ event: "order.driver_missing_reported", orderId: order.id, orderNo: order.orderNo, tenantId: order.tenantId }, "客人报告司机没到：请联系司机和供应商，联系不上就在救援队列发起救援");
    }
    return { first };
  });
}

// ---- 候选 ----

export interface RescueCandidate {
  tenantId: string;
  tenantName: string;
  productId: string;
  productVersion: number;
  settlement: SettlementBreakdown;
  sellMinor: number;
  sellCurrency: CurrencyCode;
  markupBp: number;
  fx: FxQuote | null;
  /** 在剩下的候选里的名次（1 起） */
  position: number;
  inBand: boolean;
  /** 改派给它时原供应商要承担的差价（原结算币种）；换不了币种为 null */
  differenceMinor: number | null;
  urgent: boolean;
}

export interface RescueCandidates {
  rescue: Rescue;
  order: Order;
  candidates: RescueCandidate[];
  /** 没能当候选的：已经发过的（拒绝、超时）、报不出价的（原因代码）、渠道不卖的 */
  excluded: { tenantId: string; tenantName: string; productId: string | null; reason: string }[];
}

/** 原报价条件：原来的请求，换成这一单现在的用车时间、人数行李，只比这一单的车型组。 */
function rescueRequest(snapshot: StoredQuoteSnapshot, order: Order): QuoteRequest {
  return { ...snapshot.request, serviceLocal: order.serviceLocal, passengers: order.passengers, luggage: order.luggage, vehicleGroupIds: [order.vehicleGroupId] };
}

/**
 * 按原报价条件重新比价，得出救援候选（按中标排序）。排除这一单以前和现在的供应商、这次救援已经发过的。
 * 走报价引擎的同一条路（`previewPlatformQuote`，同一个渠道的加价和授权范围，现取现算）；外部调用在事务之外。
 */
export async function rescueCandidates(ctx: AppContext, orderId: string, log?: QuoteLog): Promise<RescueCandidates> {
  const loaded = await withPlatformTx(ctx.pool, async (db) => {
    const order = await findOrderForPlatform(db, orderId);
    const sale = order === null ? null : await findSale(db, orderId);
    if (order === null || sale === null) throw notFound("订单");
    const rescue = await findOpenRescue(db, orderId);
    if (rescue === null) throw new AppError(409, "RESCUE_NOT_OPEN", "这张单现在不在救援改派中", { status: order.status });
    const snapshot = ((await db.query<{ snapshot: StoredQuoteSnapshot }>("select snapshot from quotes where id = $1", [sale.quoteId])).rows[0] as { snapshot: StoredQuoteSnapshot }).snapshot;
    const holders = (await db.query<{ tenant_id: string }>("select tenant_id from orders where id = $1", [orderId])).rows.map((row) => row.tenant_id);
    const offers = await listRescueOffers(db, rescue.id);
    return { order, sale, rescue, snapshot, holders, offers };
  });
  const { order, sale, rescue, snapshot, holders, offers } = loaded;
  const request = rescueRequest(snapshot, order);
  const preview = await previewPlatformQuote(
    ctx,
    {
      cityId: order.cityId,
      category: order.category,
      placeId: order.placeId,
      currency: sale.currency,
      channelId: sale.channelId,
      pickup: request.pickup,
      dropoff: request.dropoff,
      direction: request.direction,
      packageHours: request.packageHours,
      serviceLocal: request.serviceLocal,
      passengers: request.passengers,
      luggage: request.luggage,
      addons: [...request.addons],
      driverLanguage: request.driverLanguage,
      vehicleGroupIds: [...request.vehicleGroupIds],
      assumeRoute: order.settlement.usage,
    },
    log === undefined ? {} : { log },
  );
  const offered = new Map(offers.map((offer) => [offer.tenantId, offer.status]));
  const skip = new Set(holders);
  const group = preview.comparison.groups.find((entry) => entry.vehicleGroupId === order.vehicleGroupId && entry.packageHours === order.packageHours);
  const ranked = (group?.ranked ?? []).filter(({ candidate }) => !skip.has(candidate.tenantId) && !offered.has(candidate.tenantId));
  const tenantIds = [...new Set([...(group?.ranked ?? []).map(({ candidate }) => candidate.tenantId), ...preview.comparison.refused.map((entry) => entry.tenantId), ...preview.excluded.map((entry) => entry.product.tenantId)])];
  const names = await withPlatformTx(ctx.pool, async (db) => new Map((await db.query<{ id: string; name: string }>("select id, name from tenants where id = any($1::uuid[])", [tenantIds])).rows.map((row) => [row.id, row.name])));
  const candidates = ranked.map(({ candidate, inBand }, index): RescueCandidate => {
    const settlement = candidate.offer.settlement;
    const diff = rescueDifference({
      originalMinor: rescue.originalSettlementMinor,
      originalCurrency: rescue.originalSettlementCurrency,
      originalFx: rescue.originalFx,
      rescueMinor: settlement.totalMinor,
      rescueCurrency: settlement.currency,
      rescueFx: candidate.sell.fx,
      customerCurrency: sale.currency,
    });
    return {
      tenantId: candidate.tenantId,
      tenantName: names.get(candidate.tenantId) ?? "",
      productId: candidate.productId,
      productVersion: candidate.productVersion,
      settlement,
      sellMinor: candidate.sellMinor,
      sellCurrency: sale.currency,
      markupBp: candidate.sell.markupBp,
      fx: candidate.sell.fx,
      position: index + 1,
      inBand,
      differenceMinor: diff.ok ? diff.minor : null,
      urgent: settlement.urgentTier !== null,
    };
  });
  const excluded: RescueCandidates["excluded"] = [];
  for (const [tenantId, status] of offered) excluded.push({ tenantId, tenantName: names.get(tenantId) ?? "", productId: null, reason: status === "declined" ? "OFFER_DECLINED" : status === "expired" ? "OFFER_EXPIRED" : status === "pending" ? "OFFER_PENDING" : "OFFER_CLOSED" });
  for (const entry of preview.comparison.refused) {
    if (skip.has(entry.tenantId) || offered.has(entry.tenantId)) continue;
    if (entry.vehicleGroupId !== null && entry.vehicleGroupId !== order.vehicleGroupId) continue;
    excluded.push({ tenantId: entry.tenantId, tenantName: names.get(entry.tenantId) ?? "", productId: entry.productId, reason: entry.reason });
  }
  for (const entry of preview.excluded) {
    if (skip.has(entry.product.tenantId)) continue;
    excluded.push({ tenantId: entry.product.tenantId, tenantName: names.get(entry.product.tenantId) ?? "", productId: entry.product.productId, reason: "CHANNEL_NOT_SELLING" });
  }
  return { rescue, order, candidates, excluded };
}

// ---- 救援单 ----

function tripOf(order: Order): RescueTrip {
  return {
    category: order.category,
    city_id: order.cityId,
    place_id: order.placeId,
    direction: order.direction,
    vehicle_group_id: order.vehicleGroupId,
    package_hours: order.packageHours,
    service_time: order.serviceAt.toISOString(),
    service_local: order.serviceLocal,
    timezone: order.timezone,
    passengers: order.passengers,
    luggage: order.luggage,
    pickup: order.pickup,
    dropoff: order.dropoff,
    addons: order.addons.map((addon) => ({ addon_id: addon.addonId, quantity: addon.quantity })),
    driver_language: order.driverLanguage,
  };
}

function quoteCandidatesOf(candidates: readonly RescueCandidate[]): RescueQuoteCandidate[] {
  return candidates.map((entry) => ({ tenantId: entry.tenantId, productId: entry.productId, productVersion: entry.productVersion, settlementMinor: entry.settlement.totalMinor, settlementCurrency: entry.settlement.currency, sellMinor: entry.sellMinor, markupBp: entry.markupBp, position: entry.position }));
}

/**
 * 在调用方的平台事务里发一张救援单（订单、救援已锁）：写救援单和它的平台一侧、救援进入「救援单待接」、推 `rescue.offered` 给这家、审计。
 * 推送里只有行程、它的结算价和接单期限——没有乘客的联系方式（接了单在订单里看）。
 */
async function offerInTx(db: Db, order: Order, rescue: Rescue, candidate: RescueCandidate, all: readonly RescueCandidate[], actor: RescueActor, now: Date): Promise<RescueOffer> {
  const offer = await insertRescueOffer(db, {
    tenantId: candidate.tenantId,
    rescueId: rescue.id,
    orderId: order.id,
    productId: candidate.productId,
    productVersion: candidate.productVersion,
    vehicleGroupId: order.vehicleGroupId,
    trip: tripOf(order),
    settlementMinor: candidate.settlement.totalMinor,
    settlementCurrency: candidate.settlement.currency,
    settlement: candidate.settlement,
    offeredByType: actor.type === "platform_user" ? "platform_user" : "system",
    offeredBy: actor.type === "platform_user" ? actor.id : null,
    offeredAt: now,
    expiresAt: rescueOfferDeadline(now, order.serviceAt),
  });
  const quote: RescueQuote = { offerId: offer.id, supplierTenantId: candidate.tenantId, rescueId: rescue.id, currency: candidate.sellCurrency, sellMinor: candidate.sellMinor, markupBp: candidate.markupBp, fx: candidate.fx, position: candidate.position, candidates: quoteCandidatesOf(all), quotedAt: now };
  await insertRescueQuote(db, quote);
  if (rescue.status !== "offering") await updateRescue(db, rescue.id, { status: "offering" }, now);
  await enqueueTenantEvent(
    db,
    { tenantId: candidate.tenantId, type: "rescue.offered", orderId: null, data: { offer_id: offer.id, expires_at: offer.expiresAt.toISOString(), trip: offer.trip, settlement: { amount_minor: offer.settlementMinor, currency: offer.settlementCurrency } } },
    now,
  );
  await insertAuditLog(db, actor.origin, { tenantId: null, resource: "rescue", resourceId: rescue.id, action: "offer", before: null, after: { order_id: order.id, offer_id: offer.id, tenant_id: candidate.tenantId, product_id: candidate.productId, position: candidate.position, expires_at: offer.expiresAt.toISOString() } });
  return offer;
}

/** 运营给一家候选发救援单（`rescue.manage`）：不指定就发第一名。这家要在候选里（同城、同品类、能接这个车型组、没被暂停、报得出价）。 */
export async function offerForPlatform(ctx: AppContext, principal: PlatformPrincipal, orderId: string, tenantId: string | null, ip: string, log?: QuoteLog): Promise<RescueOffer> {
  const found = await rescueCandidates(ctx, orderId, log);
  const candidate = tenantId === null ? found.candidates[0] : found.candidates.find((entry) => entry.tenantId === tenantId);
  if (candidate === undefined) {
    throw new AppError(409, "RESCUE_CANDIDATE_UNAVAILABLE", tenantId === null ? "现在没有能接这一单的候选供应商；可以人工指定（双人复核）或取消订单全额退款" : "这家供应商现在不是这一单的候选（报不出价、已经拒绝或超时、或以前接过这一单）", {
      tenant_id: tenantId,
    });
  }
  const now = ctx.now();
  const actor: RescueActor = { type: "platform_user", id: principal.user.id, origin: consoleOrigin(platformActor(principal.user), ip, now) };
  try {
    return await withPlatformTx(ctx.pool, async (db) => {
      const order = await findOrderForPlatform(db, orderId, { lock: true });
      const rescue = await findOpenRescue(db, orderId, { lock: true });
      if (order === null || rescue === null || rescue.id !== found.rescue.id || order.status !== "rescue_pending") throw new AppError(409, "RESCUE_NOT_OPEN", "这张单现在不在救援改派中（可能刚被别人处理了）");
      const offers = await listRescueOffers(db, rescue.id, { lock: true });
      const pending = offers.find((offer) => offer.status === "pending");
      if (pending !== undefined) throw new AppError(409, "RESCUE_OFFER_PENDING", "已经有一张救援单在等供应商接单，等它有结果（接、拒或超时）再发下一张", { offer_id: pending.id, expires_at: pending.expiresAt.toISOString() });
      if (offers.some((offer) => offer.tenantId === candidate.tenantId)) throw new AppError(409, "RESCUE_CANDIDATE_UNAVAILABLE", "这次救援已经给这家发过救援单了", { tenant_id: candidate.tenantId });
      return offerInTx(db, order, rescue, candidate, found.candidates, actor, now);
    });
  } catch (err) {
    if (isUniqueViolation(err, "order_rescue_offers_pending_key") || isUniqueViolation(err, "order_rescue_offers_rescue_tenant_key")) throw new AppError(409, "RESCUE_OFFER_PENDING", "刚有人给这一单发了救援单，请刷新");
    throw err;
  }
}

/**
 * 上一家不接（拒绝、超时）之后顺延下一家：重新比价，发给剩下的第一名；一家都没有了 → 「候选都不接」，服务日志通知运营。
 * 比价在事务之外；发之前锁住订单和救援再看一遍（期间可能有人已经发了、或订单取消了）。
 */
export async function advanceRescue(ctx: AppContext, orderId: string, log: OrderLog): Promise<"offered" | "exhausted" | "skipped"> {
  let found: RescueCandidates;
  try {
    found = await rescueCandidates(ctx, orderId);
  } catch (err) {
    if (err instanceof AppError && (err.code === "RESCUE_NOT_OPEN" || err.statusCode === 404)) return "skipped";
    if (!(err instanceof AppError)) throw err;
    // 比不了价（城市被停用等）：当作没有候选，交给运营
    found = await withPlatformTx(ctx.pool, async (db) => ({ rescue: (await findOpenRescue(db, orderId)) as Rescue, order: (await findOrderForPlatform(db, orderId)) as Order, candidates: [], excluded: [] }));
    if (found.rescue === null) return "skipped";
  }
  const now = ctx.now();
  return withPlatformTx(ctx.pool, async (db) => {
    const order = await findOrderForPlatform(db, orderId, { lock: true });
    const rescue = await findOpenRescue(db, orderId, { lock: true });
    if (order === null || rescue === null || order.status !== "rescue_pending") return "skipped";
    const offers = await listRescueOffers(db, rescue.id, { lock: true });
    if (offers.some((offer) => offer.status === "pending")) return "skipped";
    const next = found.candidates.find((entry) => !offers.some((offer) => offer.tenantId === entry.tenantId));
    if (next === undefined) {
      if (rescue.status !== "exhausted") await updateRescue(db, rescue.id, { status: "exhausted" }, now);
      log.warn({ event: "order.rescue_exhausted", orderId: order.id, orderNo: order.orderNo, rescueId: rescue.id }, "救援候选都不接（或没有候选）：请人工指定救援供应商（双人复核）或取消订单全额退款");
      return "exhausted";
    }
    await offerInTx(db, order, rescue, next, found.candidates, SYSTEM(now), now);
    return "offered";
  });
}

export interface OfferDecision {
  offer: RescueOffer;
  /** 接单成功时：救援供应商那一行的订单编号（同一个） */
  orderId: string | null;
  expired: boolean;
}

/**
 * 供应商接 / 拒救援单（`order.dispatch`）。租户编号只来自令牌：别的供应商的救援单当作不存在。
 * 在平台事务里做（改派要改订单、销售端一侧这些只有平台能改的），加锁顺序：订单 → 救援 → 救援单（和发救援单、取消、超时一样）。
 * 过了期限：记为超时（409 `RESCUE_OFFER_EXPIRED`），自动顺延下一家。
 */
export async function decideOfferForTenant(ctx: AppContext, principal: TenantPrincipal, offerId: string, decision: "accept" | "decline", reason: string | null, ip: string, log: OrderLog): Promise<OfferDecision> {
  const now = ctx.now();
  const actor: RescueActor = { type: "tenant_user", id: principal.user.id, origin: consoleOrigin(tenantActor(principal.user), ip, now) };
  const result = await withPlatformTx(ctx.pool, async (db): Promise<OfferDecision & { advance: boolean }> => {
    const peek = await findTenantOffer(db, principal.tenantId, offerId);
    if (peek === null) throw notFound("救援单");
    const order = await findOrderForPlatform(db, peek.orderId, { lock: true });
    const rescue = await findOpenRescue(db, peek.orderId, { lock: true });
    const offer = (await findTenantOffer(db, principal.tenantId, offerId, { lock: true })) as RescueOffer;
    if (offer.status !== "pending" || order === null || rescue === null || rescue.id !== offer.rescueId) {
      throw new AppError(409, "RESCUE_OFFER_CLOSED", "这张救援单已经有结果了（接了、拒了、超时或被收回）", { status: offer.status });
    }
    if (rescueOfferExpired(offer.expiresAt, now)) {
      await updateOfferStatus(db, offer, { status: "expired", decidedAt: now });
      return { offer: (await findTenantOffer(db, principal.tenantId, offerId)) as RescueOffer, orderId: null, expired: true, advance: true };
    }
    if (decision === "decline") {
      await updateOfferStatus(db, offer, { status: "declined", decidedAt: now, decidedBy: principal.user.id, declineReason: reason });
      await insertAuditLog(db, actor.origin, { tenantId: principal.tenantId, resource: "rescue_offer", resourceId: offer.id, action: "reject", before: { status: "pending" }, after: { status: "declined", reason } });
      return { offer: (await findTenantOffer(db, principal.tenantId, offerId)) as RescueOffer, orderId: null, expired: false, advance: true };
    }
    const quotes = await listRescueQuotes(db, rescue.id);
    await completeRescueInTx(db, order, rescue, { tenantId: offer.tenantId, productId: offer.productId, productVersion: offer.productVersion, settlement: offer.settlement, fx: quotes.get(offer.id)?.fx ?? null, via: "offer", offer }, actor, now);
    return { offer: (await findTenantOffer(db, principal.tenantId, offerId)) as RescueOffer, orderId: order.id, expired: false, advance: false };
  });
  if (result.advance) await advanceRescue(ctx, result.offer.orderId, log);
  return { offer: result.offer, orderId: result.orderId, expired: result.expired };
}

export interface RescueAssignment {
  tenantId: string;
  productId: string;
  productVersion: number;
  settlement: SettlementBreakdown;
  /** 救援供应商的结算币种 → 客人支付币种（救援报价的快照）；同币种为 null */
  fx: FxQuote | null;
  via: "offer" | "manual";
  offer?: RescueOffer;
}

/**
 * 改派（调用方的平台事务里，订单、救援已锁）：原供应商的那一行转出、释放它的库存；救援供应商照着另起一行（占它的库存）；销售端一侧换供应商；
 * 救援记为已改派；记救援差价（应扣款项；认定过不可抗力的直接免除）；流水、推送、审计。客人付的钱不变。
 */
export async function completeRescueInTx(db: Db, order: Order, rescue: Rescue, assignment: RescueAssignment, actor: RescueActor, now: Date): Promise<void> {
  const tenant = (await db.query<{ status: string }>("select status from tenants where id = $1", [assignment.tenantId])).rows[0];
  if (tenant === undefined) throw notFound("租户");
  if (tenant.status === "suspended") throw new AppError(409, "RESCUE_TENANT_SUSPENDED", "这家供应商现在被暂停了，不能接救援单");
  const product = (await db.query<{ inventory_mode: string }>("select inventory_mode from products where tenant_id = $1 and id = $2", [assignment.tenantId, assignment.productId])).rows[0];
  if (product === undefined) throw notFound("商品");
  const limited = product.inventory_mode === "limited";
  if (limited && !(await sellInventoryOnDay(db, assignment.tenantId, assignment.productId, order.serviceDate, now))) {
    throw new AppError(409, "RESCUE_SOLD_OUT", "这个商品在用车那一天已经订满了，接不了这一单");
  }
  if (order.inventoryHeld) await releaseSoldInventory(db, order.tenantId, order.productId, order.serviceDate, now);
  // 救援供应商之前收到的、还没结论的其它救援单（人工指定时）一并收回
  for (const offer of await listRescueOffers(db, rescue.id, { lock: true })) {
    if (offer.status !== "pending") continue;
    if (assignment.offer !== undefined && offer.id === assignment.offer.id) await updateOfferStatus(db, offer, { status: "accepted", decidedAt: now, decidedBy: actor.type === "tenant_user" ? actor.id : null });
    else await updateOfferStatus(db, offer, { status: "withdrawn", decidedAt: now });
  }
  await markOrderRescued(db, order, now);
  await insertRescuedOrder(db, {
    original: order,
    tenantId: assignment.tenantId,
    productId: assignment.productId,
    productVersion: assignment.productVersion,
    settlementMinor: assignment.settlement.totalMinor,
    settlementCurrency: assignment.settlement.currency,
    settlement: assignment.settlement,
    urgent: assignment.settlement.urgentTier !== null,
    inventoryHeld: limited,
    dispatchDueAt: rescuedDispatchDeadline(now, order.serviceAt),
    now,
  });
  await moveSaleToTenant(db, order.id, assignment.tenantId);
  const sale = (await findSale(db, order.id)) as OrderSale;
  const diff = rescueDifference({
    originalMinor: rescue.originalSettlementMinor,
    originalCurrency: rescue.originalSettlementCurrency,
    originalFx: rescue.originalFx,
    rescueMinor: assignment.settlement.totalMinor,
    rescueCurrency: assignment.settlement.currency,
    rescueFx: assignment.fx,
    customerCurrency: sale.currency,
  });
  if (!diff.ok) throw new AppError(409, "FX_RATE_UNAVAILABLE", "换算救援差价要的汇率取不到（两家的结算币种不同）", { reason: diff.reason });
  await updateRescue(
    db,
    rescue.id,
    { status: "rescued", rescueTenantId: assignment.tenantId, rescueSettlementMinor: assignment.settlement.totalMinor, rescueSettlementCurrency: assignment.settlement.currency, rescueFx: assignment.fx, rescuedVia: assignment.via, rescuedAt: now, closedAt: now },
    now,
  );
  await insertDeduction(db, {
    tenantId: rescue.originalTenantId,
    orderId: order.id,
    rescueId: rescue.id,
    kind: "rescue_difference",
    amountMinor: diff.minor,
    currency: rescue.originalSettlementCurrency,
    basis: { original_minor: rescue.originalSettlementMinor, rescue_in_original_minor: diff.rescueInOriginalMinor, raw_minor: diff.rawMinor, same_currency: assignment.settlement.currency === rescue.originalSettlementCurrency },
    waived: rescue.forceMajeureAt === null ? null : { at: now, reason: rescue.forceMajeureNote as string },
    now,
  });
  await insertOrderEvent(db, order, { fromStatus: "rescue_pending", toStatus: "rescued", actor: eventActor(actor.type), reason: "RESCUED", occurredAt: now, detail: { via: assignment.via } });
  const rescued = { tenantId: assignment.tenantId, id: order.id };
  await insertOrderEvent(db, rescued, { fromStatus: null, toStatus: "confirmed", actor: eventActor(actor.type), reason: "RESCUE_ASSIGNED", occurredAt: now, detail: { via: assignment.via } });
  await enqueueTenantEvent(db, { tenantId: order.tenantId, type: "order.rescued_away", orderId: order.id, data: { trigger: rescue.trigger } }, now);
  await enqueueTenantEvent(db, { tenantId: assignment.tenantId, type: "order.confirmed", orderId: order.id, data: { rescue: true } }, now);
  await insertAuditLog(db, actor.origin, {
    tenantId: actor.type === "tenant_user" ? assignment.tenantId : null,
    resource: "rescue",
    resourceId: rescue.id,
    action: assignment.via === "offer" ? "accept" : "assign",
    before: { order_id: order.id, tenant_id: order.tenantId, status: "rescue_pending" },
    after: { order_id: order.id, tenant_id: assignment.tenantId, product_id: assignment.productId, settlement_minor: assignment.settlement.totalMinor, currency: assignment.settlement.currency, difference_minor: diff.minor },
  });
}

/**
 * 订单取消时（无人可接全额退款、客人自己取消、不可抗力）：没有结论的救援记为「已取消订单」，待接的救援单收回。在取消的事务里（订单已锁）。
 * 违约金照样记着（原供应商没有履约）；不可抗力另由运营认定免除。
 */
export async function closeRescueOnCancel(db: Db, order: Order, now: Date): Promise<void> {
  const rescue = await findOpenRescue(db, order.id, { lock: true });
  if (rescue === null) return;
  for (const offer of await listRescueOffers(db, rescue.id, { lock: true })) if (offer.status === "pending") await updateOfferStatus(db, offer, { status: "withdrawn", decidedAt: now });
  await updateRescue(db, rescue.id, { status: "cancelled", closedAt: now }, now);
}

/**
 * 不可抗力（`rescue.manage`，大雪封路、机场关闭、政府管制）：运营认定后这次救援的应扣款项（违约金、救援差价）全部免除，之后才记的差价也直接免除。
 * 单人认定、必须写说明、留审计（ADR 0031：需求只把「人工指定救援供应商」列为双人复核；客人全额退款走取消，多退了钱的照 ADR 0029 复核）。
 * 只认这一单最近的一次救援；同一次救援只能认定一次。
 */
export async function markForceMajeure(ctx: AppContext, principal: PlatformPrincipal, orderId: string, note: string, ip: string): Promise<{ rescue: Rescue; waived: number }> {
  const now = ctx.now();
  return withPlatformTx(ctx.pool, async (db) => {
    const latest = (await db.query<{ id: string }>("select id from order_rescues where order_id = $1 order by triggered_at desc, id desc limit 1", [orderId])).rows[0];
    if (latest === undefined) throw new AppError(409, "RESCUE_NOT_FOUND", "这张单没有救援记录：不可抗力免违约金只用于救援改派的单（取消订单请选「不可抗力」原因）");
    const rescue = (await findRescue(db, latest.id, { lock: true })) as Rescue;
    if (rescue.forceMajeureAt !== null) throw new AppError(409, "FORCE_MAJEURE_ALREADY", "这次救援已经认定过不可抗力了");
    await updateRescue(db, rescue.id, { forceMajeure: { at: now, by: principal.user.id, note } }, now);
    const waived = await waiveDeductions(db, rescue.id, note, now);
    await insertAuditLog(db, consoleOrigin(platformActor(principal.user), ip, now), { tenantId: null, resource: "rescue", resourceId: rescue.id, action: "waive", before: { force_majeure: false }, after: { order_id: orderId, force_majeure: true, note, waived_deductions: waived } });
    return { rescue: (await findRescue(db, rescue.id)) as Rescue, waived };
  });
}

// ---- 人工指定（双人复核） ----

export interface ManualAssignInput {
  tenantId: string;
  productId: string;
  /** 和这家谈好的结算价（这个商品的结算币种，最小货币单位） */
  settlementMinor: number;
  note: string;
}

/** 人工指定的结算价明细：只有基础价一项（电话谈好的一口价），其余为 0；免费等待沿用原来的。 */
function manualSettlement(currency: CurrencyCode, amountMinor: number, order: Order): SettlementBreakdown {
  const text = String(amountMinor);
  return {
    currency,
    roundingUnit: 1,
    totalMinor: amountMinor,
    baseMinor: amountMinor,
    adjustMinor: 0,
    urgentMinor: 0,
    nightMinor: 0,
    addonsMinor: 0,
    driverLanguageMinor: 0,
    exact: { base: text, adjusted: text, night: "0", addons: "0", total: text },
    adjusts: [],
    urgentTier: null,
    night: null,
    addons: [],
    driverLanguage: order.driverLanguage,
    usage: null,
    freeWait: order.settlement.freeWait,
  };
}

/**
 * 发起人工指定救援供应商（`rescue.manage`，需求「全部候选都不接，运营可人工指定租户（双人复核）」）：校验后发起一条复核，另一位有 `rescue.review` 的同事批准时才改派。
 * 只能在没有待接的救援单时发起；这家不能是以前接过这一单的、不能是暂停中的；商品要是它的、同城同品类（接送机同一个接送点）、有这个车型组。
 * 结算币种和客人支付币种不同时，在发起时取一次汇率记进复核内容（之后按它换算救援差价，「按快照汇率」）。
 */
export async function requestManualAssign(ctx: AppContext, principal: PlatformPrincipal, orderId: string, input: ManualAssignInput, ip: string): Promise<Approval> {
  const now = ctx.now();
  const prepared = await withPlatformTx(ctx.pool, async (db) => {
    const order = await findOrderForPlatform(db, orderId);
    const sale = order === null ? null : await findSale(db, orderId);
    if (order === null || sale === null) throw notFound("订单");
    const rescue = await findOpenRescue(db, orderId);
    if (rescue === null || order.status !== "rescue_pending") throw new AppError(409, "RESCUE_NOT_OPEN", "这张单现在不在救援改派中", { status: order.status });
    const pending = (await listRescueOffers(db, rescue.id)).find((offer) => offer.status === "pending");
    if (pending !== undefined) throw new AppError(409, "RESCUE_OFFER_PENDING", "还有一张救援单在等供应商接单，等它有结果再人工指定", { offer_id: pending.id });
    const holders = (await db.query<{ tenant_id: string }>("select tenant_id from orders where id = $1", [orderId])).rows.map((row) => row.tenant_id);
    if (holders.includes(input.tenantId)) throw validationFailed("body", [{ path: "/tenant_id", reason: "PREVIOUS_SUPPLIER", message: "这家以前接过这一单（原供应商），不能再指定给它" }]);
    const tenant = (await db.query<{ name: string; status: string }>("select name, status from tenants where id = $1", [input.tenantId])).rows[0];
    if (tenant === undefined) throw validationFailed("body", [{ path: "/tenant_id", reason: "UNKNOWN_TENANT", message: "供应商不存在" }]);
    if (tenant.status === "suspended") throw validationFailed("body", [{ path: "/tenant_id", reason: "TENANT_SUSPENDED", message: "这家供应商现在被暂停了" }]);
    const product = (
      await db.query<{ city_id: string; category: string; poi_id: string | null; version: number; currency: CurrencyCode; has_group: boolean }>(
        `select p.city_id, p.category, p.poi_id, p.version, b.currency,
                exists (select 1 from product_vehicle_groups g where g.tenant_id = p.tenant_id and g.product_id = p.id and g.vehicle_group_id = $3) as has_group
           from products p join brands b on b.tenant_id = p.tenant_id and b.id = p.brand_id where p.tenant_id = $1 and p.id = $2`,
        [input.tenantId, input.productId, order.vehicleGroupId],
      )
    ).rows[0];
    if (product === undefined) throw validationFailed("body", [{ path: "/product_id", reason: "UNKNOWN_PRODUCT", message: "这家供应商没有这个商品" }]);
    if (product.city_id !== order.cityId || product.category !== order.category || product.poi_id !== order.placeId || !product.has_group) {
      throw validationFailed("body", [{ path: "/product_id", reason: "PRODUCT_MISMATCH", message: "商品要和这一单同城市、同品类（接送机同一个接送点），并且有这一单的车型组" }]);
    }
    return { order, sale, rescue, tenantName: tenant.name, product };
  });
  const { order, sale, rescue, tenantName, product } = prepared;
  let fx: FxQuote | null = null;
  if (product.currency !== sale.currency) {
    fx = await ctx.quote.fx.quote(product.currency, sale.currency, now);
    if (fx === null) throw new AppError(409, "FX_RATE_UNAVAILABLE", `取不到 ${product.currency} → ${sale.currency} 的汇率，换算不了救援差价`);
  }
  const origin = consoleOrigin(platformActor(principal.user), ip, now);
  return withPlatformTx(ctx.pool, (db) =>
    requestApproval(db, origin, principal, {
      kind: RESCUE_MANUAL_ASSIGN,
      resourceId: rescue.id,
      summary: `订单 ${order.orderNo} 救援改派人工指定给「${tenantName}」：结算价 ${input.settlementMinor} ${product.currency}（原结算价 ${rescue.originalSettlementMinor} ${rescue.originalSettlementCurrency}）`,
      payload: {
        order_id: order.id,
        order_no: order.orderNo,
        rescue_id: rescue.id,
        tenant_id: input.tenantId,
        tenant_name: tenantName,
        product_id: input.productId,
        product_version: product.version,
        settlement_minor: input.settlementMinor,
        currency: product.currency,
        fx: fx === null ? null : { from: fx.from, to: fx.to, rate: fx.rate, as_of: fx.asOf },
        note: input.note,
      },
      before: { status: rescue.status },
      baseVersion: rescue.version,
      note: input.note,
    }),
  );
}

export const RESCUE_MANUAL_ASSIGN: ApprovalKind = {
  kind: "rescue.manual_assign",
  resource: "rescue",
  readAction: "order.read",
  requestAction: "rescue.manage",
  reviewAction: "rescue.review",
  async apply(db, approval, origin) {
    const payload = approval.payload;
    const orderId = payload["order_id"] as string;
    const order = await findOrderForPlatform(db, orderId, { lock: true });
    const rescue = await findOpenRescue(db, orderId, { lock: true });
    if (order === null || rescue === null || rescue.id !== payload["rescue_id"] || order.status !== "rescue_pending") throw new AppError(409, "APPROVAL_STALE", "这张单已经不在这次救援改派中了（可能已经被接走或取消）；请驳回");
    const raw = payload["fx"] as { from: CurrencyCode; to: CurrencyCode; rate: string; as_of: string } | null;
    const fx: FxQuote | null = raw === null ? null : { from: raw.from, to: raw.to, rate: raw.rate, asOf: raw.as_of };
    const actor: RescueActor = { type: "platform_user", id: origin.actor.id, origin };
    await completeRescueInTx(
      db,
      order,
      rescue,
      { tenantId: payload["tenant_id"] as string, productId: payload["product_id"] as string, productVersion: payload["product_version"] as number, settlement: manualSettlement(payload["currency"] as CurrencyCode, payload["settlement_minor"] as number, order), fx, via: "manual" },
      actor,
      origin.occurredAt,
    );
  },
};

export const RESCUE_APPROVAL_KINDS: readonly ApprovalKind[] = [RESCUE_MANUAL_ASSIGN];

// ---- 定时任务 ----

export interface RescueSweepResult {
  /** 用车前 6 小时仍未派车，自动触发了几张 */
  dispatchOverdue: number;
  /** 到点 15 分钟仍未到达，记下了几张提醒 */
  driverLate: number;
  /** 超时没接的救援单 */
  offersExpired: number;
}

/**
 * 订单定时任务每一轮做的救援的事：
 * 1. 用车前 6 小时（且过了派车截止时间）仍未派车的单自动进入救援（每张一个事务，先锁订单再判断；并发的声明、别的实例只会让它建一次）；
 * 2. 到点 15 分钟仍未到达的单记下提醒（一条条件更新「找出来 + 记下」，多实例也只记一次），服务日志 `order.driver_late`；
 * 3. 过了期限还没接的救援单记为超时，顺延下一家。
 */
export async function sweepRescues(ctx: AppContext, log: OrderLog = SILENT_ORDER_LOG): Promise<RescueSweepResult> {
  const now = ctx.now();
  const sixHours = new Date(now.getTime() + 6 * 3_600_000);
  const due = await withPlatformTx(ctx.pool, async (db) =>
    (
      await db.query<{ id: string }>(
        `select id from orders where status = 'confirmed' and dispatch_due_at is not null and service_at <= $2 and dispatch_due_at <= $1
          order by service_at, id limit $3`,
        [now, sixHours, JOB_BATCH],
      )
    ).rows.map((row) => row.id),
  );
  let dispatchOverdue = 0;
  for (const orderId of due) {
    try {
      await trigger(ctx, orderId, { trigger: "dispatch_overdue", reason: null, actor: SYSTEM(ctx.now()) }, log);
      dispatchOverdue += 1;
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
    }
  }
  const late = await withPlatformTx(ctx.pool, async (db) =>
    (
      await db.query<{ id: string; tenant_id: string; order_no: string; status: OrderStatus }>(
        `update orders set arrival_overdue_at = $1 where (tenant_id, id) in (
           select tenant_id, id from orders
            where status in ('confirmed', 'assigned', 'departed') and arrival_overdue_at is null and service_at <= $2
              and greatest(service_at, coalesce(landed_at, service_at)) + make_interval(mins => $3) <= $1
            order by service_at limit $4 for update skip locked)
         returning id, tenant_id, order_no, status`,
        [now, new Date(now.getTime() - RESCUE_RULES.driverLateMinutes * 60_000), RESCUE_RULES.driverLateMinutes, JOB_BATCH],
      )
    ).rows,
  );
  for (const row of late) log.warn({ event: "order.driver_late", orderId: row.id, tenantId: row.tenant_id, orderNo: row.order_no, status: row.status }, "到点 15 分钟司机仍未到达：请联系司机和客人，联系不上就在救援队列发起救援（司机未到）");
  const expired = await withPlatformTx(ctx.pool, (db) => listExpiredOffers(db, ctx.now(), JOB_BATCH));
  let offersExpired = 0;
  for (const entry of expired) {
    const closed = await withPlatformTx(ctx.pool, async (db) => {
      await findOrderForPlatform(db, entry.orderId, { lock: true });
      const offer = await findTenantOffer(db, entry.tenantId, entry.id, { lock: true });
      if (offer === null || offer.status !== "pending" || !rescueOfferExpired(offer.expiresAt, ctx.now())) return false;
      await updateOfferStatus(db, offer, { status: "expired", decidedAt: ctx.now() });
      return true;
    });
    if (!closed) continue;
    offersExpired += 1;
    await advanceRescue(ctx, entry.orderId, log);
  }
  return { dispatchOverdue, driverLate: late.length, offersExpired };
}

// ---- 查 ----

export interface TenantRescueView {
  role: "original" | "rescuer";
  rescue: Rescue;
  deductions: Deduction[];
}

/** 供应商自己的救援单（租户事务，行级安全）。 */
export async function listOffersForTenant(ctx: AppContext, tenantId: string, pendingOnly: boolean): Promise<RescueOffer[]> {
  return withTenantTx(ctx.pool, tenantId, (db) => listTenantOffers(db, tenantId, { pendingOnly, limit: 100 }), { snapshot: true });
}

export async function getOfferForTenant(ctx: AppContext, tenantId: string, offerId: string): Promise<RescueOffer> {
  const offer = await withTenantTx(ctx.pool, tenantId, (db) => findTenantOffer(db, tenantId, offerId), { snapshot: true });
  if (offer === null) throw notFound("救援单");
  return offer;
}

/** 供应商自己的应扣款项（租户事务，行级安全）。 */
export async function listDeductionsForTenant(ctx: AppContext, tenantId: string, orderId: string | null): Promise<(Deduction & { orderNo: string; serviceAt: Date })[]> {
  return withTenantTx(ctx.pool, tenantId, (db) => listTenantDeductions(db, tenantId, { orderId, limit: 200 }), { snapshot: true });
}

/** 某个供应商的这一行订单相关的救援：原供应商看到触发、违约金、自己的应扣款项；救援供应商只知道这是接来的救援单。 */
export async function tenantRescueOf(db: Db, order: Pick<Order, "tenantId" | "id">): Promise<TenantRescueView | null> {
  const original = await findRescueOfOriginal(db, order.tenantId, order.id);
  if (original !== null) return { role: "original", rescue: original, deductions: (await listRescueDeductions(db, [original.id])).filter((entry) => entry.tenantId === order.tenantId) };
  const rescuer = await findRescueOfRescuer(db, order.tenantId, order.id);
  return rescuer === null ? null : { role: "rescuer", rescue: rescuer, deductions: [] };
}

export interface PlatformRescueView {
  rescue: Rescue;
  order: Order;
  originalTenantName: string;
  rescueTenantName: string | null;
  offers: { offer: RescueOffer; tenantName: string; quote: RescueQuote | null }[];
  deductions: Deduction[];
}

/** 运营后台看的救援（含救援单、它们的对外价和名次、应扣款项、各家的名字）。每类数据一条查询。 */
export async function platformRescueViews(db: Db, rescues: readonly Rescue[]): Promise<PlatformRescueView[]> {
  if (rescues.length === 0) return [];
  const ids = rescues.map((rescue) => rescue.id);
  const offers = await listOffersOfRescues(db, ids);
  const quotes = await listRescueQuotes(db, ids);
  const orders = await findOrdersOfTenants(db, rescues.map((rescue) => ({ tenantId: rescue.originalTenantId, orderId: rescue.orderId })));
  const tenantIds = [...new Set([...rescues.flatMap((rescue) => [rescue.originalTenantId, ...(rescue.rescueTenantId === null ? [] : [rescue.rescueTenantId])]), ...offers.map((offer) => offer.tenantId)])];
  const names = new Map((await db.query<{ id: string; name: string }>("select id, name from tenants where id = any($1::uuid[])", [tenantIds])).rows.map((row) => [row.id, row.name]));
  const deductions = await listRescueDeductions(db, ids);
  const views: PlatformRescueView[] = [];
  for (const rescue of rescues) {
    const order = orders.get(`${rescue.originalTenantId}|${rescue.orderId}`) as Order;
    views.push({
      rescue,
      order,
      originalTenantName: names.get(rescue.originalTenantId) ?? "",
      rescueTenantName: rescue.rescueTenantId === null ? null : (names.get(rescue.rescueTenantId) ?? ""),
      offers: offers.filter((offer) => offer.rescueId === rescue.id).map((offer) => ({ offer, tenantName: names.get(offer.tenantId) ?? "", quote: quotes.get(offer.id) ?? null })),
      deductions: deductions.filter((entry) => entry.rescueId === rescue.id),
    });
  }
  return views;
}

export interface RescueQueue {
  items: PlatformRescueView[];
  alerts: { tenantId: string; tenantName: string; id: string; orderNo: string; status: OrderStatus; serviceAt: Date; arrivalOverdueAt: Date | null; driverMissingReportedAt: Date | null }[];
  suspendedTenants: { tenantId: string; name: string; orders: number }[];
}

/** 运营后台的救援队列：没有结论的救援（或最近有结论的）、司机未到的提醒、暂停中还有未来订单的供应商。 */
export async function rescueQueue(ctx: AppContext, state: "open" | "closed"): Promise<RescueQueue> {
  return withPlatformTx(
    ctx.pool,
    async (db) => {
      const rescues = await listRescues(db, { state, limit: 200 });
      const alerts = state === "open" ? await listDriverAlerts(db, 200) : [];
      const names = new Map((await db.query<{ id: string; name: string }>("select id, name from tenants where id = any($1::uuid[])", [[...new Set(alerts.map((alert) => alert.tenantId))]])).rows.map((row) => [row.id, row.name]));
      return {
        items: await platformRescueViews(db, rescues),
        alerts: alerts.map((alert) => ({ ...alert, tenantName: names.get(alert.tenantId) ?? "" })),
        suspendedTenants: state === "open" ? await listSuspendedTenantsWithFutureOrders(db, ctx.now()) : [],
      };
    },
    { snapshot: true },
  );
}

/** 一张单的全部救援（自己开只读事务）。 */
export async function getOrderRescueViews(ctx: AppContext, orderId: string): Promise<PlatformRescueView[]> {
  return withPlatformTx(ctx.pool, (db) => orderRescueViews(db, orderId), { snapshot: true });
}

/** 一张单的全部救援（运营后台订单详情）。 */
export async function orderRescueViews(db: Db, orderId: string): Promise<PlatformRescueView[]> {
  return platformRescueViews(db, await listOrderRescues(db, orderId));
}
