/**
 * 改单（M3-03，ADR 0029）：渠道替客人改（`PATCH /sales/v1/orders/{id}`）、运营代客人改（`PATCH /platform/v1/orders/{id}`）、
 * 供应商确认 / 拒绝改期（`POST /tenant/v1/orders/{id}/changes/{changeId}/confirm`、`…/reject`）。
 *
 * 规则（domain 的 order-changes.ts，需求「客人修改订单规则」「改单补充」）：
 * - 航班号、乘客信息、即时通讯、备注、上下车点的地址文字、人数行李（车型容量内）：直接改，推 `order.changed` 给供应商；
 * - 日期或时间：同一个商品按新时间重新报价（不重新比价：别的供应商不参加），新的结算价 = 报价引擎算出的；
 *   对外价 = 新结算价 × 下单时的汇率快照 ×（1 + 缓冲）×（1 + 原加价比例），按渠道的取整单位和最低毛利（下单时的快照）；差价多退少补：
 *   - 多了：先用保存的支付方式把差价扣到（扣不到就不改，402 `CHANGE_PAYMENT_DECLINED`），再生效或去等供应商确认；
 *   - 少了：生效时退差价；
 *   商品现在报不出这个时间的价（下架、服务时间外、提前预订时长不够、这一天订满……）：409 `CHANGE_NOT_SERVICEABLE`，按「取消重下」；
 * - 原来的或新的用车时间离现在不到 24 小时的改期：供应商 30 分钟内确认才生效；拒绝或超时没确认的，补收的差价退回，客人可以免费取消（`CHANGE_NOT_CONFIRMED`）；
 * - 出了免费取消期只能改航班号和乘客信息；车型、品类、城市、坐标、超出容量的：按「取消重下」（接口里没有这些字段，超出容量 422 `CHANGE_REQUIRES_REBOOK`）。
 * 并发：订单行锁 + `If-Match` 版本；一张单同时只能有一个没有结论的改单（数据库唯一约束兜底）。
 * 改期生效时：库存从旧的一天挪到新的一天（新的一天订满就不能改）、派车截止时间按新时间重算、原来派的司机或车辆在新时段有别的单就标出来提示改派。
 */
import {
  type OrderChangeField,
  type OrderChangeRefusal,
  type OrderDetailsIssueReason,
  type OrderStatus,
  type QuoteRequest,
  changeConfirmDeadline,
  changeConfirmOverdue,
  dispatchDeadline,
  inFreeCancellationWindow,
  instantToLocal,
  isFlightNo,
  isInternationalPhone,
  localDateTimeToInstant,
  normalizeFlightNo,
  normalizePhone,
  orderChangeRefusal,
  priceDifference,
  quoteProduct,
  rescheduleNeedsConfirmation,
  sellPrice,
} from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { type Db, isUniqueViolation, withPlatformTx } from "../db/context.ts";
import { AppError } from "../errors.ts";
import { PaymentProviderError } from "../integrations/payments.ts";
import { type AuditOrigin, insertAuditLog } from "../repos/audit-logs.ts";
import { type NewOrderChange, type OrderChange, findOpenChange, findOrderChange, insertOrderChange, listOverdueChanges, listStuckChanges, updateOrderChange } from "../repos/order-changes.ts";
import {
  type Order,
  type OrderPayment,
  type OrderSale,
  findOrderForPlatform,
  findOrderPayment,
  findSale,
  insertOffSessionPayment,
  insertOrderEvent,
  listOrderPayments,
  releaseSoldInventory,
  sellInventoryOnDay,
  updateOrderPayment,
  updateSaleSellMinor,
} from "../repos/orders.ts";
import { loadQuoteCandidates } from "../repos/quotes.ts";
import { type OrderRefund, findChangeSale, insertChangeSale, refundedByPayment } from "../repos/refunds.ts";
import { type InputIssue, validationFailed } from "../validation.ts";
import { consoleOrigin, platformActor, tenantActor } from "./audit.ts";
import { orderCancelPolicy } from "./cancellations.ts";
import { conflictsFor } from "./dispatch.ts";
import { notFound, versionConflict } from "./errors.ts";
import { chargeOffSession, processRefunds, savedPaymentMethod, scheduleRefund } from "./order-money.ts";
import type { OrderLog } from "./orders.ts";
import type { PlatformPrincipal } from "./platform-auth.ts";
import { loadQuoteFacts } from "./quotes.ts";
import type { StoredQuoteSnapshot } from "./sales-quotes.ts";
import type { TenantPrincipal } from "./tenant-auth.ts";
import { enqueueTenantEvent } from "./tenant-webhooks.ts";

/** 渠道 / 运营提交的改动（没给的字段不改）。 */
export interface OrderChangeInput {
  passenger?: { name: string; phone: string; email: string };
  flightNo?: string | null;
  messaging?: { app: "whatsapp" | "line" | "wechat" | "kakaotalk"; handle: string } | null;
  notes?: string | null;
  pickupAddress?: string;
  dropoffAddress?: string;
  serviceTime?: Date;
  passengers?: number;
  luggage?: number;
}

const REFUSAL_ERRORS: Readonly<Record<OrderChangeRefusal, { status: number; code: string; message: string }>> = {
  ORDER_STATE_INVALID: { status: 409, code: "ORDER_STATE_INVALID", message: "订单当前的状态不能这样改（司机出发后不能改时间和人数，服务开始后什么都不能改）" },
  OUTSIDE_FREE_WINDOW: { status: 409, code: "CHANGE_NOT_ALLOWED", message: "已经过了免费取消期，只能改航班号和乘客信息" },
  CAPACITY_EXCEEDED: { status: 422, code: "CHANGE_REQUIRES_REBOOK", message: "人数或行李超出了这个车型的容量，请取消后重新下单" },
  SERVICE_TIME_PASSED: { status: 422, code: "VALIDATION_FAILED", message: "新的用车时间已经过了" },
  NO_CHANGE: { status: 422, code: "NO_CHANGE", message: "没有要改的内容" },
};

const DETAIL_MESSAGES: Readonly<Record<string, string>> = {
  REQUIRED: "必填",
  NOT_APPLICABLE: "这一单不填这一项",
  INVALID_PHONE: "电话要写成带国家码的国际格式，如 +81 90-1234-5678",
  INVALID_FLIGHT_NO: "航班号的格式不对，如 NH211",
  TOO_LONG: "太长了",
  INVALID_FORMAT: "格式不对",
};

interface PlannedChange {
  fields: OrderChangeField[];
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  /** 改后的订单内容（还没写库） */
  next: Pick<Order, "passenger" | "flightNo" | "messaging" | "notes" | "pickup" | "dropoff" | "passengers" | "luggage" | "serviceAt" | "serviceLocal" | "serviceDate">;
}

const blank = (value: string | null | undefined): boolean => value === null || value === undefined || value.trim() === "";

/** 和现在比，哪些字段真的变了；同时校验写法（电话、邮箱、航班号、长度）。 */
function planChange(order: Order, input: OrderChangeInput, placeType: string | null): PlannedChange {
  const issues: InputIssue[] = [];
  const issue = (path: string, reason: OrderDetailsIssueReason): void => void issues.push({ path, reason, message: DETAIL_MESSAGES[reason] ?? reason });
  const next: PlannedChange["next"] = { passenger: order.passenger, flightNo: order.flightNo, messaging: order.messaging, notes: order.notes, pickup: order.pickup, dropoff: order.dropoff, passengers: order.passengers, luggage: order.luggage, serviceAt: order.serviceAt, serviceLocal: order.serviceLocal, serviceDate: order.serviceDate };
  const fields: OrderChangeField[] = [];
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  const record = (field: OrderChangeField, was: unknown, now: unknown): void => {
    if (JSON.stringify(was) === JSON.stringify(now)) return;
    fields.push(field);
    before[field] = was;
    after[field] = now;
  };
  if (input.passenger !== undefined) {
    const passenger = { name: input.passenger.name.trim(), phone: normalizePhone(input.passenger.phone), email: input.passenger.email.trim() };
    if (blank(passenger.name)) issue("/passenger/name", "REQUIRED");
    else if ([...passenger.name].length > 100) issue("/passenger/name", "TOO_LONG");
    if (!isInternationalPhone(passenger.phone)) issue("/passenger/phone", "INVALID_PHONE");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(passenger.email) || passenger.email.length > 254) issue("/passenger/email", "INVALID_FORMAT");
    next.passenger = passenger;
    record("passenger", order.passenger, passenger);
  }
  if (input.flightNo !== undefined) {
    const atAirport = order.category === "airport_transfer" && placeType === "airport";
    const flight = blank(input.flightNo) ? null : normalizeFlightNo(input.flightNo as string);
    if (!atAirport && flight !== null) issue("/flight_no", "NOT_APPLICABLE");
    else if (atAirport && flight === null && order.direction === "pickup") issue("/flight_no", "REQUIRED");
    else if (flight !== null && !isFlightNo(flight)) issue("/flight_no", "INVALID_FLIGHT_NO");
    next.flightNo = flight;
    record("flight_no", order.flightNo, flight);
  }
  if (input.messaging !== undefined) {
    const messaging = input.messaging === null ? null : { app: input.messaging.app, handle: input.messaging.handle.trim() };
    if (messaging !== null && blank(messaging.handle)) issue("/messaging/handle", "REQUIRED");
    else if (messaging !== null && [...messaging.handle].length > 100) issue("/messaging/handle", "TOO_LONG");
    next.messaging = messaging;
    record("messaging", order.messaging, messaging);
  }
  if (input.notes !== undefined) {
    const notes = blank(input.notes) ? null : (input.notes as string).trim();
    if (notes !== null && [...notes].length > 500) issue("/notes", "TOO_LONG");
    next.notes = notes;
    record("notes", order.notes, notes);
  }
  const address = (field: "pickup_address" | "dropoff_address", value: string | undefined, point: Order["pickup"]): Order["pickup"] => {
    if (value === undefined) return point;
    const path = `/${field}`;
    if (point === null) {
      issue(path, "NOT_APPLICABLE");
      return point;
    }
    const text = value.trim();
    if (text === "") issue(path, "REQUIRED");
    else if ([...text].length > 300) issue(path, "TOO_LONG");
    record(field, point.address, text);
    return { ...point, address: text };
  };
  next.pickup = address("pickup_address", input.pickupAddress, order.pickup);
  next.dropoff = address("dropoff_address", input.dropoffAddress, order.dropoff);
  if (input.passengers !== undefined) {
    if (!Number.isInteger(input.passengers) || input.passengers < 1) issue("/passengers", "INVALID_FORMAT");
    next.passengers = input.passengers;
    record("passengers", order.passengers, input.passengers);
  }
  if (input.luggage !== undefined) {
    if (!Number.isInteger(input.luggage) || input.luggage < 0) issue("/luggage", "INVALID_FORMAT");
    next.luggage = input.luggage;
    record("luggage", order.luggage, input.luggage);
  }
  if (input.serviceTime !== undefined) {
    // 用车时间按城市当地的分钟计（和下单一样）：带秒的舍掉
    const local = instantToLocal(input.serviceTime, order.timezone).dateTime;
    const at = localDateTimeToInstant(local, order.timezone) as Date;
    next.serviceAt = at;
    next.serviceLocal = local;
    next.serviceDate = local.slice(0, 10);
    if (at.getTime() !== order.serviceAt.getTime()) {
      fields.push("service_time");
      before["service_time"] = order.serviceAt.toISOString();
      before["service_local"] = order.serviceLocal;
      after["service_time"] = at.toISOString();
      after["service_local"] = local;
    }
  }
  if (issues.length > 0) throw validationFailed("body", issues);
  return { fields, before, after, next };
}

interface Repriced {
  settlement: Order["settlement"];
  sellMinor: number;
}

/** 同一个商品按新的用车时间重新报价（不重新比价）。报不出 → 409 `CHANGE_NOT_SERVICEABLE`。 */
async function reprice(db: Db, order: Order, sale: OrderSale, next: PlannedChange["next"], now: Date): Promise<Repriced> {
  const quote = (await db.query<{ snapshot: StoredQuoteSnapshot }>("select snapshot from quotes where id = $1", [sale.quoteId])).rows[0]?.snapshot as StoredQuoteSnapshot;
  const notServiceable = (reason: string): AppError => new AppError(409, "CHANGE_NOT_SERVICEABLE", "这家供应商在新的时间没法服务（或者已经订满），请取消后重新下单", { reason });
  const candidates = await loadQuoteCandidates(db, { cityId: order.cityId, category: order.category, poiId: order.placeId, productId: order.productId, publishedOnly: true });
  const candidate = candidates[0];
  if (candidate === undefined) throw notServiceable("PRODUCT_UNPUBLISHED");
  const request: QuoteRequest = { ...quote.request, serviceLocal: next.serviceLocal, passengers: next.passengers, luggage: next.luggage, vehicleGroupIds: [order.vehicleGroupId] };
  const facts = await loadQuoteFacts(db, [candidate], request);
  // 同一天：这一单自己占着的库存、加急名额不算「别人用掉的」
  const inventoryDay = facts.inventory.get(order.productId) ?? null;
  const sameDay = next.serviceDate === order.serviceDate;
  const ownDay = sameDay && inventoryDay !== null && order.inventoryHeld ? { ...inventoryDay, sold: Math.max(0, inventoryDay.sold - 1) } : inventoryDay;
  const urgentUsed = Math.max(0, (facts.urgentUsed.get(order.productId) ?? 0) - (sameDay && order.urgent ? 1 : 0));
  const result = quoteProduct(candidate.product, request, { now, holidays: facts.holidays, route: order.settlement.usage, inventoryDay: ownDay, urgentUsed });
  if (!result.ok) throw notServiceable(result.reason);
  const offer = result.offers.find((entry) => entry.vehicleGroupId === order.vehicleGroupId && entry.packageHours === order.packageHours);
  if (offer === undefined) throw notServiceable(result.refused.find((entry) => entry.vehicleGroupId === order.vehicleGroupId)?.reason ?? "NOT_AVAILABLE");
  const channel = quote.winner.sell.channel;
  const sell = sellPrice({
    settlementMinor: offer.settlement.totalMinor,
    settlementCurrency: offer.settlement.currency,
    currency: sale.currency,
    markupBp: sale.markupBp,
    markupFloorBp: 0,
    fxBufferBp: sale.fxBufferBp,
    fx: sale.fx,
    ...(channel === undefined ? {} : { channel: { roundingUnit: channel.roundingUnit, minMargin: channel.minMarginMinor > 0 ? { minor: channel.minMarginMinor, currency: sale.currency, fx: null } : null } }),
  });
  if ("failure" in sell) throw notServiceable(sell.failure);
  return { settlement: offer.settlement, sellMinor: sell.sellMinor };
}

/** 这一单车型组的容量（商品里设的最多人数、行李）。 */
async function capacityOf(db: Db, order: Order): Promise<{ passengers: number; luggage: number }> {
  const row = (await db.query<{ passengers: number; luggage: number }>("select passengers, luggage from product_vehicle_groups where tenant_id = $1 and product_id = $2 and vehicle_group_id = $3", [order.tenantId, order.productId, order.vehicleGroupId])).rows[0];
  return row ?? { passengers: order.passengers, luggage: order.luggage };
}

export interface ChangeActor {
  requestedBy: "channel" | "platform_user";
  requestedById: string | null;
  origin: AuditOrigin | null;
}

/**
 * 让一次改单生效（调用方的平台事务里，订单已锁）：写订单、挪库存、改对外价、退差价、派车冲突、状态流水、推送、审计。返回排好的退款。
 */
async function applyChange(db: Db, order: Order, change: OrderChange, sale: OrderSale, sellAfter: number | null, origin: AuditOrigin | null, now: Date): Promise<OrderRefund[]> {
  const after = change.after;
  const pick = <T>(field: string, current: T): T => (Object.hasOwn(after, field) ? (after[field] as T) : current);
  const serviceAt = change.reschedule ? new Date(after["service_time"] as string) : order.serviceAt;
  const serviceLocal = change.reschedule ? (after["service_local"] as string) : order.serviceLocal;
  const serviceDate = serviceLocal.slice(0, 10);
  if (change.reschedule && serviceDate !== order.serviceDate && order.inventoryHeld) {
    if (!(await sellInventoryOnDay(db, order.tenantId, order.productId, serviceDate, now))) throw new AppError(409, "CHANGE_NOT_SERVICEABLE", "新的那一天已经订满了，请取消后重新下单", { reason: "SOLD_OUT" });
    await releaseSoldInventory(db, order.tenantId, order.productId, order.serviceDate, now);
  }
  const pickup = order.pickup === null ? null : { ...order.pickup, address: pick("pickup_address", order.pickup.address) };
  const dropoff = order.dropoff === null ? null : { ...order.dropoff, address: pick("dropoff_address", order.dropoff.address) };
  const settlement = change.settlementAfter ?? order.settlement;
  const dueAt = change.reschedule && order.confirmedAt !== null ? dispatchDeadline(order.confirmedAt, serviceAt) : order.dispatch.dueAt;
  await db.query(
    `update orders set passenger = $3::jsonb, flight_no = $4, messaging = $5::jsonb, notes = $6, pickup = $7::jsonb, dropoff = $8::jsonb, passengers = $9, luggage = $10,
            service_at = $11, service_local = $12, service_date = $13, settlement_minor = $14, settlement = $15::jsonb, dispatch_due_at = $16,
            dispatch_overdue_at = case when $17::boolean then null else dispatch_overdue_at end, departure_overdue_at = case when $17::boolean then null else departure_overdue_at end,
            version = version + 1, updated_at = $18
      where tenant_id = $1 and id = $2`,
    [
      order.tenantId, order.id, JSON.stringify(pick("passenger", order.passenger)), pick("flight_no", order.flightNo), JSON.stringify(pick("messaging", order.messaging)), pick("notes", order.notes),
      pickup === null ? null : JSON.stringify(pickup), dropoff === null ? null : JSON.stringify(dropoff), pick("passengers", order.passengers), pick("luggage", order.luggage),
      serviceAt, serviceLocal, serviceDate, change.settlementAfterMinor, JSON.stringify(settlement), dueAt, change.reschedule, now,
    ],
  );
  let refunds: OrderRefund[] = [];
  if (change.reschedule && sellAfter !== null) {
    const diff = priceDifference(sale.sellMinor, sellAfter);
    await updateSaleSellMinor(db, order.id, sellAfter);
    if (diff.kind === "refund") refunds = await scheduleRefund(db, order, "change", diff.amountMinor, change.id, now);
  }
  let conflict = false;
  if (change.reschedule && order.dispatch.driverId !== null && order.dispatch.vehicleId !== null) {
    conflict = (await conflictsFor(db, { ...order, serviceAt }, [order.dispatch.driverId], [order.dispatch.vehicleId])).length > 0;
  }
  await updateOrderChange(db, change, { status: "applied", decidedAt: now, dispatchConflict: conflict });
  const fields = Object.keys(after).filter((field) => field !== "service_local");
  await insertOrderEvent(db, order, { fromStatus: order.status, toStatus: order.status, actor: origin?.actor.type === "tenant_user" ? "tenant_user" : change.requestedBy === "channel" ? "channel" : "platform_user", reason: "CHANGED", occurredAt: now, detail: { change_id: change.id, fields, dispatch_conflict: conflict } });
  await enqueueTenantEvent(db, { tenantId: order.tenantId, type: "order.changed", orderId: order.id, data: { change_id: change.id, status: "applied", fields, before: change.before, after: change.after, dispatch_conflict: conflict } }, now);
  if (origin !== null) {
    await insertAuditLog(db, origin, { tenantId: origin.actor.type === "tenant_user" ? order.tenantId : null, resource: "order_change", resourceId: change.id, action: "change", before: { order_id: order.id, ...(change.before as Record<string, never>) }, after: { order_id: order.id, ...(change.after as Record<string, never>), status: "applied" } });
  }
  return refunds;
}

export type ChangeOutcome = { orderId: string; change: OrderChange };

/** 提出改单：校验、（改期时）重新报价、（贵了时）先扣差价，然后生效或等供应商确认。 */
async function requestChange(ctx: AppContext, scope: { channelId: string } | "platform", orderId: string, expectedVersion: number, input: OrderChangeInput, who: ChangeActor, log: OrderLog): Promise<ChangeOutcome> {
  const now = ctx.now();
  type Step = { done: OrderChange; refunds: OrderRefund[] } | { charge: { change: OrderChange; payment: OrderPayment; orderNo: string } };
  let step: Step;
  try {
    step = await withPlatformTx(ctx.pool, async (db): Promise<Step> => {
      const sale = await findSale(db, orderId);
      if (sale === null || (scope !== "platform" && sale.channelId !== scope.channelId)) throw notFound("订单");
      const order = (await findOrderForPlatform(db, orderId, { lock: true })) as Order;
      if (order.version !== expectedVersion) throw versionConflict(order.version);
      if ((await findOpenChange(db, order.tenantId, order.id)) !== null) throw changeInProgress();
      const placeType = order.placeId === null ? null : ((await db.query<{ type: string }>("select type from places where id = $1", [order.placeId])).rows[0]?.type ?? null);
      const plan = planChange(order, input, placeType);
      const policy = await orderCancelPolicy(db, order);
      const refusal = orderChangeRefusal({
        status: order.status,
        fields: plan.fields,
        inFreeWindow: inFreeCancellationWindow(policy, order.serviceAt, now),
        passengers: plan.next.passengers,
        luggage: plan.next.luggage,
        capacity: await capacityOf(db, order),
        newServiceAt: plan.fields.includes("service_time") ? plan.next.serviceAt : null,
        now,
      });
      if (refusal !== null) {
        const error = REFUSAL_ERRORS[refusal.reason];
        throw new AppError(error.status, error.code, error.message, { reason: refusal.reason, fields: refusal.fields ?? [], status: order.status });
      }
      const reschedule = plan.fields.includes("service_time");
      const repriced = reschedule ? await reprice(db, order, sale, plan.next, now) : null;
      const needsConfirm = reschedule && rescheduleNeedsConfirmation(order.serviceAt, plan.next.serviceAt, now);
      const diff = priceDifference(sale.sellMinor, repriced?.sellMinor ?? sale.sellMinor);
      const base: NewOrderChange = {
        tenantId: order.tenantId,
        orderId: order.id,
        status: diff.kind === "charge" ? "awaiting_payment" : needsConfirm ? "pending_confirmation" : "applied",
        reschedule,
        before: plan.before,
        after: plan.after,
        settlementBeforeMinor: order.settlementMinor,
        settlementAfterMinor: repriced?.settlement.totalMinor ?? order.settlementMinor,
        settlementAfter: repriced?.settlement ?? null,
        confirmDueAt: needsConfirm ? changeConfirmDeadline(now) : null,
        requestedBy: who.requestedBy,
        requestedById: who.requestedById,
        requestedAt: now,
        decidedAt: null,
      };
      // 马上生效的改单：生效时间就是现在（applyChange 里再记一次同一个时间）
      if (base.status === "applied") base.decidedAt = now;
      let saved: ReturnType<typeof savedPaymentMethod> = null;
      if (diff.kind === "charge") {
        saved = savedPaymentMethod(await findOrderPayment(db, order.id));
        if (saved === null) throw new AppError(409, "NO_SAVED_PAYMENT_METHOD", "这一单没有保存下来的支付方式，补不了差价；请取消后重新下单");
      }
      const id = await insertOrderChange(db, base);
      const change = (await findOrderChange(db, order.tenantId, id, { lock: true })) as OrderChange;
      if (reschedule && repriced !== null) await insertChangeSale(db, { changeId: id, orderId: order.id, supplierTenantId: order.tenantId, currency: sale.currency, sellBeforeMinor: sale.sellMinor, sellAfterMinor: repriced.sellMinor });
      if (diff.kind === "charge" && saved !== null) {
        const payment = await insertOffSessionPayment(db, { orderId: order.id, supplierTenantId: order.tenantId, kind: "change", changeId: id, extraChargeId: null, customerId: saved.customerId, paymentMethodId: saved.paymentMethodId, amountMinor: diff.amountMinor, currency: sale.currency, saveConsentAt: saved.saveConsentAt, now });
        return { charge: { change, payment, orderNo: order.orderNo } };
      }
      if (base.status === "pending_confirmation") {
        await pendingConfirmation(db, order, change, now);
        return { done: (await findOrderChange(db, order.tenantId, id)) as OrderChange, refunds: [] };
      }
      const refunds = await applyChange(db, order, change, sale, repriced?.sellMinor ?? null, who.origin, now);
      return { done: (await findOrderChange(db, order.tenantId, id)) as OrderChange, refunds };
    });
  } catch (err) {
    if (isUniqueViolation(err, "order_changes_open_key")) throw changeInProgress();
    throw err;
  }
  if ("done" in step) {
    await processRefunds(ctx, step.refunds, log);
    return { orderId, change: step.done };
  }
  return { orderId, change: await chargeAndSettle(ctx, step.charge.change, step.charge.payment, step.charge.orderNo, who.origin, log, true) };
}

function changeInProgress(): AppError {
  return new AppError(409, "CHANGE_IN_PROGRESS", "这张单还有一个改单没有结论（在等供应商确认或在补差价），请等它有结果再改");
}

/** 改期进入「等供应商确认」：推 `order.changed`（状态 pending_confirmation）给供应商。 */
async function pendingConfirmation(db: Db, order: Order, change: OrderChange, now: Date): Promise<void> {
  await enqueueTenantEvent(db, { tenantId: order.tenantId, type: "order.changed", orderId: order.id, data: { change_id: change.id, status: "pending_confirmation", fields: Object.keys(change.after).filter((field) => field !== "service_local"), before: change.before, after: change.after, confirm_due_at: change.confirmDueAt?.toISOString() ?? null } }, now);
}

/**
 * 扣差价，再按结果往下走：扣到了 → 生效或等确认（订单这时已经不能改了 → 改单作废、差价退回）；卡被拒 → 改单失败（`throwOnDecline` 时抛 402）；
 * 收款服务出错 → 改单留在「补差价」，定时任务用同一条收款记录再试（同一个幂等键，不会扣两次）。
 */
async function chargeAndSettle(ctx: AppContext, change: OrderChange, payment: OrderPayment, orderNo: string, origin: AuditOrigin | null, log: OrderLog, throwOnDecline: boolean): Promise<OrderChange> {
  let outcome: Awaited<ReturnType<typeof chargeOffSession>>;
  try {
    outcome = await chargeOffSession(ctx, payment, { orderNo, description: `NOZOMI ${orderNo} 改期差价` });
  } catch (err) {
    if (err instanceof PaymentProviderError) {
      log.warn({ changeId: change.id, code: err.code }, "改期补差价时收款服务出错，定时任务会再试");
      if (throwOnDecline) throw new AppError(err.code === "PAYMENT_PROVIDER_TIMEOUT" ? 504 : 502, err.code, "收款服务出错，差价还没有扣到；这次改单会在几分钟内自动重试，请稍后查看订单", { retryable: err.retryable, change_id: change.id });
      return change;
    }
    throw err;
  }
  return settleChangeCharge(ctx, change, outcome.outcome === "declined" ? "declined" : outcome.outcome, origin, log, throwOnDecline, outcome.outcome === "declined" ? outcome.error : null);
}

async function settleChangeCharge(ctx: AppContext, change: OrderChange, outcome: "succeeded" | "processing" | "declined", origin: AuditOrigin | null, log: OrderLog, throwOnDecline: boolean, decline: { code: string | null; declineCode: string | null } | null): Promise<OrderChange> {
  if (outcome === "processing") return change;
  const result = await withPlatformTx(ctx.pool, async (db): Promise<{ change: OrderChange; refunds: OrderRefund[] }> => {
    const now = ctx.now();
    const order = (await findOrderForPlatform(db, change.orderId, { lock: true })) as Order;
    const current = (await findOrderChange(db, change.tenantId, change.id, { lock: true })) as OrderChange;
    if (current.status !== "awaiting_payment") return { change: current, refunds: [] };
    if (outcome === "declined") {
      await updateOrderChange(db, current, { status: "failed", decidedAt: now });
      return { change: (await findOrderChange(db, change.tenantId, change.id)) as OrderChange, refunds: [] };
    }
    const sale = (await findSale(db, order.id)) as OrderSale;
    const sellAfter = await findChangeSale(db, change.id);
    const stillChangeable = ["confirmed", "assigned"].includes(order.status);
    let refunds: OrderRefund[] = [];
    if (!stillChangeable) {
      // 扣差价的这几秒里订单变了（取消、司机出发）：改单作废，刚扣的差价退回
      await updateOrderChange(db, current, { status: "cancelled", decidedAt: now });
      refunds = await scheduleRefund(db, order, "change", await collectedFor(db, order.id, change.id), change.id, now);
    } else if (current.confirmDueAt !== null) {
      await updateOrderChange(db, current, { status: "pending_confirmation", confirmDueAt: changeConfirmDeadline(now) });
      await pendingConfirmation(db, order, (await findOrderChange(db, change.tenantId, change.id)) as OrderChange, now);
    } else {
      refunds = await applyChange(db, order, current, sale, sellAfter?.sellAfterMinor ?? null, origin, now);
    }
    return { change: (await findOrderChange(db, change.tenantId, change.id)) as OrderChange, refunds };
  });
  await processRefunds(ctx, result.refunds, log);
  if (outcome === "declined" && throwOnDecline) {
    throw new AppError(402, "CHANGE_PAYMENT_DECLINED", "用保存的支付方式扣差价没有成功（卡被拒或需要客人验证），这次没有改；可以取消后重新下单", { code: decline?.code ?? null, decline_code: decline?.declineCode ?? null, change_id: change.id });
  }
  return result.change;
}

/** 这次改单补收的、还没退的差价。 */
async function collectedFor(db: Db, orderId: string, changeId: string): Promise<number> {
  const payments = (await listOrderPayments(db, orderId)).filter((payment) => payment.kind === "change" && payment.changeId === changeId && payment.status === "succeeded");
  const refunded = await refundedByPayment(db, orderId);
  return payments.reduce((sum, payment) => sum + payment.amountMinor - Math.max(payment.refundedMinor, refunded.get(payment.id) ?? 0), 0);
}

export async function changeForChannel(ctx: AppContext, channelId: string, orderId: string, version: number, input: OrderChangeInput, log: OrderLog): Promise<ChangeOutcome> {
  return requestChange(ctx, { channelId }, orderId, version, input, { requestedBy: "channel", requestedById: null, origin: null }, log);
}

export async function changeForPlatform(ctx: AppContext, principal: PlatformPrincipal, orderId: string, version: number, input: OrderChangeInput, ip: string, log: OrderLog): Promise<ChangeOutcome> {
  return requestChange(ctx, "platform", orderId, version, input, { requestedBy: "platform_user", requestedById: principal.user.id, origin: consoleOrigin(platformActor(principal.user), ip, ctx.now()) }, log);
}

/** 拒绝 / 超时：补收的差价退回；客人之后可以免费取消。 */
async function closeUnconfirmed(db: Db, order: Order, change: OrderChange, status: "rejected" | "expired", decided: { by: string | null; note: string | null }, now: Date): Promise<OrderRefund[]> {
  await updateOrderChange(db, change, { status, decidedAt: now, decidedBy: decided.by, decisionNote: decided.note });
  await insertOrderEvent(db, order, { fromStatus: order.status, toStatus: order.status, actor: status === "rejected" ? "tenant_user" : "system", reason: status === "rejected" ? "CHANGE_REJECTED" : "CHANGE_EXPIRED", occurredAt: now, detail: { change_id: change.id } });
  return scheduleRefund(db, order, "change", await collectedFor(db, order.id, change.id), change.id, now);
}

/**
 * 供应商确认 / 拒绝改期（`order.dispatch`）。租户编号只来自登录令牌：别的供应商的单当作不存在。
 * 生效要改用车时间和结算价（只有平台能改这些列），所以在平台事务里做，查询都带着令牌里的租户编号。
 * 过了 30 分钟：记为超时没确认（409 `CHANGE_CONFIRMATION_EXPIRED`），差价退回。
 */
export async function decideChangeForTenant(ctx: AppContext, principal: TenantPrincipal, orderId: string, changeId: string, decision: "confirm" | "reject", note: string | null, ip: string, log: OrderLog): Promise<{ change: OrderChange; expired: boolean }> {
  const now = ctx.now();
  const origin = consoleOrigin(tenantActor(principal.user), ip, now);
  const result = await withPlatformTx(ctx.pool, async (db): Promise<{ change: OrderChange; expired: boolean; refunds: OrderRefund[] }> => {
    const change = await findOrderChange(db, principal.tenantId, changeId);
    const order = change === null || change.orderId !== orderId ? null : await findOrderForPlatform(db, orderId, { lock: true });
    if (change === null || order === null || order.tenantId !== principal.tenantId || order.confirmedAt === null) throw notFound("改单");
    const current = (await findOrderChange(db, principal.tenantId, changeId, { lock: true })) as OrderChange;
    if (current.status !== "pending_confirmation") throw new AppError(409, "CHANGE_NOT_PENDING", "这次改单不在等确认（已经有结论了）", { status: current.status });
    if (changeConfirmOverdue(current.confirmDueAt as Date, now)) {
      const refunds = await closeUnconfirmed(db, order, current, "expired", { by: null, note: null }, now);
      return { change: (await findOrderChange(db, principal.tenantId, changeId)) as OrderChange, expired: true, refunds };
    }
    let refunds: OrderRefund[];
    if (decision === "reject") {
      refunds = await closeUnconfirmed(db, order, current, "rejected", { by: principal.user.id, note }, now);
      await insertAuditLog(db, origin, { tenantId: principal.tenantId, resource: "order_change", resourceId: changeId, action: "reject", before: { status: "pending_confirmation" }, after: { status: "rejected", order_id: orderId, note } });
    } else {
      if (!["confirmed", "assigned"].includes(order.status)) throw new AppError(409, "ORDER_STATE_INVALID", "订单当前的状态不能再改期", { status: order.status as OrderStatus, action: "confirm_change" });
      const sale = (await findSale(db, orderId)) as OrderSale;
      const sellAfter = await findChangeSale(db, changeId);
      await updateOrderChange(db, current, { status: "pending_confirmation", decidedBy: principal.user.id, decisionNote: note });
      refunds = await applyChange(db, order, current, sale, sellAfter?.sellAfterMinor ?? null, origin, now);
    }
    return { change: (await findOrderChange(db, principal.tenantId, changeId)) as OrderChange, expired: false, refunds };
  });
  await processRefunds(ctx, result.refunds, log);
  return { change: result.change, expired: result.expired };
}

/** 定时任务：30 分钟没确认的改期记为超时（差价退回），补差价卡住的接着扣。 */
export async function sweepOrderChanges(ctx: AppContext, log: OrderLog, limit = 50): Promise<{ expired: number; resumed: number }> {
  const now = ctx.now();
  const overdue = await withPlatformTx(ctx.pool, (db) => listOverdueChanges(db, now, limit));
  let expired = 0;
  for (const entry of overdue) {
    const refunds = await withPlatformTx(ctx.pool, async (db): Promise<OrderRefund[] | null> => {
      const change = await findOrderChange(db, entry.tenantId, entry.id);
      if (change === null) return null;
      const order = (await findOrderForPlatform(db, change.orderId, { lock: true })) as Order;
      const current = (await findOrderChange(db, entry.tenantId, entry.id, { lock: true })) as OrderChange;
      if (current.status !== "pending_confirmation" || !changeConfirmOverdue(current.confirmDueAt as Date, ctx.now())) return null;
      log.warn({ event: "order.change_expired", orderId: order.id, changeId: current.id }, "供应商 30 分钟内没有确认改期：客人可以免费取消");
      return closeUnconfirmed(db, order, current, "expired", { by: null, note: null }, ctx.now());
    });
    if (refunds !== null) {
      expired += 1;
      await processRefunds(ctx, refunds, log);
    }
  }
  const stuck = await withPlatformTx(ctx.pool, (db) => listStuckChanges(db, new Date(now.getTime() - 2 * 60_000), limit));
  let resumed = 0;
  for (const entry of stuck) {
    const loaded = await withPlatformTx(ctx.pool, async (db) => {
      const change = await findOrderChange(db, entry.tenantId, entry.id);
      if (change === null || change.status !== "awaiting_payment") return null;
      const payment = (await listOrderPayments(db, change.orderId)).find((item) => item.kind === "change" && item.changeId === change.id);
      const order = (await findOrderForPlatform(db, change.orderId)) as Order;
      return payment === undefined ? null : { change, payment, orderNo: order.orderNo };
    });
    if (loaded === null) continue;
    resumed += 1;
    const { change, payment, orderNo } = loaded;
    if (payment.status === "creating") {
      await chargeAndSettle(ctx, change, payment, orderNo, null, log, false);
      continue;
    }
    // 已经有结果（或处理中：去收款服务查现在的状态）
    let status = payment.status;
    if (status === "processing" && payment.intentId !== null && ctx.payments !== null) {
      try {
        const current = await ctx.payments.retrievePayment(payment.intentId);
        status = current.status === "succeeded" ? "succeeded" : current.status === "processing" ? "processing" : "failed";
        if (status !== "processing") await withPlatformTx(ctx.pool, (db) => updateOrderPayment(db, payment.id, { status, ...(status === "succeeded" ? { succeededAt: ctx.now() } : {}) }, ctx.now()));
      } catch (err) {
        log.warn({ err, changeId: change.id }, "查补差价的付款状态时收款服务出错，下一轮再试");
        continue;
      }
    }
    await settleChangeCharge(ctx, change, status === "succeeded" ? "succeeded" : status === "processing" ? "processing" : "declined", null, log, false, null);
  }
  return { expired, resumed };
}
