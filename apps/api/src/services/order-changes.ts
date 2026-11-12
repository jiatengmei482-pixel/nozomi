/**
 * 改单（M3-03，ADR 0029；M4-29，ADR 0060）：渠道替客人改（`PATCH /sales/v1/orders/{id}`）、运营代客人改（`PATCH /platform/v1/orders/{id}`）、
 * 供应商同意 / 拒绝 / 标记调整中（`POST /tenant/v1/orders/{id}/changes/{changeId}/confirm`、`…/reject`、`…/adjusting`）、运营代供应商处理（`/platform/v1/…` 同名）。
 *
 * 规则（domain 的 order-changes.ts，需求「客人修改订单规则」「改单补充」，业主 M4-29）：
 * - 乘客信息、即时通讯、备注：直接改，通知供应商和已派的司机；
 * - 用车时间、上下车地址、航班号、人数行李（车型容量内）：生成修改申请，确认前原预约有效；同意才生效。一次提交里两类都有就拆成两行；
 * - 日期或时间：同一个商品按新时间重新报价（不重新比价：别的供应商不参加），新的结算价 = 报价引擎算出的；
 *   对外价 = 新结算价 × 下单时的汇率快照 ×（1 + 缓冲）×（1 + 原加价比例），按渠道的取整单位和最低毛利（下单时的快照）；差价多退少补：
 *   - 多了：先用保存的支付方式把差价扣到（扣不到就不改，402 `CHANGE_PAYMENT_DECLINED`），再去等供应商确认；
 *   - 少了：同意生效时退差价；
 *   商品现在报不出这个时间的价（下架、服务时间外、提前预订时长不够、这一天订满……）：409 `CHANGE_NOT_SERVICEABLE`，按「取消重下」；
 * - 进入最早用车前 24 小时后 30 分钟内没结论的申请失效；拒绝或超时的，补收的差价退回，客人可以免费取消（`CHANGE_NOT_CONFIRMED`，只改航班号的除外）；
 * - 出了免费取消期只能改航班号和乘客信息；车型、品类、城市、坐标、超出容量的：按「取消重下」（接口里没有这些字段，超出容量 422 `CHANGE_REQUIRES_REBOOK`）。
 * 并发：订单行锁 + `If-Match` 版本；一张单同时只能有一个没有结论的改单（数据库唯一约束兜底）。
 * 改期生效时：库存从旧的一天挪到新的一天（新的一天订满就不能改，申请留着）、派车截止时间按新时间重算、司机链接有效期跟着改、原来派的司机或车辆在新时段有别的单就标出来提示改派。
 */
import {
  type OrderChangeField,
  type OrderChangeRefusal,
  type OrderDetailsIssueReason,
  type OrderStatus,
  type QuoteRequest,
  CONTACT_FIELDS,
  changeAdjustingDeadline,
  changeConfirmDeadline,
  changeConfirmOverdue,
  changeFieldsNeedConfirmation,
  changeDeclineAdvice,
  dispatchDeadline,
  driverLinkExpiry,
  earliestServiceAt,
  inFreeCancellationWindow,
  instantToLocal,
  isFlightNo,
  isInternationalPhone,
  localDateTimeToInstant,
  normalizeFlightNo,
  normalizePhone,
  orderChangeDecidable,
  orderChangeRefusal,
  orderChangeStillApplicable,
  passengerEmailNeedsReview,
  priceDifference,
  quoteProduct,
  isSurchargeRule,
  sellPrice,
  contactOnly,
  type PassengerContact,
} from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { type Db, isUniqueViolation, passengerCryptoOf, withPlatformTx } from "../db/context.ts";
import { AppError } from "../errors.ts";
import { PaymentProviderError } from "../integrations/payments.ts";
import { type AuditOrigin, insertAuditLog } from "../repos/audit-logs.ts";
import { recalculateDriverLinkExpiry } from "../repos/dispatch.ts";
import { type NewOrderChange, type OrderChange, findOpenChange, findOrderChange, insertOrderChange, listOutdatedChanges, listOverdueChanges, listStuckChanges, updateOrderChange } from "../repos/order-changes.ts";
import { resolveChangeRequestTodo } from "../repos/order-todos.ts";
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
import { assertTenantCanOperate } from "./fulfilment.ts";
import { notFound, versionConflict } from "./errors.ts";
import { addOrderTodo, enqueueDriverNotice, hasActiveDriver } from "./order-notices.ts";
import { chargeOffSession, processRefunds, savedPaymentMethod, scheduleRefund } from "./order-money.ts";
import type { OrderLog } from "./orders.ts";
import type { PlatformPrincipal } from "./platform-auth.ts";
import { loadQuoteFacts } from "./quotes.ts";
import type { StoredQuoteSnapshot } from "./sales-quotes.ts";
import type { TenantPrincipal } from "./tenant-auth.ts";
import { enqueueNotification } from "../repos/notifications.ts";
import type { PassengerEmailChange } from "../repos/passenger-email-changes.ts";
import { enqueueTenantEvent } from "./tenant-webhooks.ts";

/** 渠道 / 运营提交的改动（没给的字段不改）。乘客信息：渠道、官网三项都给；运营可以只给要改的那几项（运营后台只看得到打码的，ADR 0055）。 */
export interface OrderChangeInput {
  passenger?: { name?: string | undefined; phone?: string | undefined; email?: string | undefined };
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

const CONTACT_NOTICE_WINDOW_MS = 10 * 60_000;

const blank = (value: string | null | undefined): boolean => value === null || value === undefined || value.trim() === "";

/**
 * 运营代改时改了乘客邮箱（ADR 0065）：这一项不在这次生效，另走双人复核。`email` 是请求里的新邮箱（只校验写法）；
 * `reviewed` = 请求里写了核实方式和原因。
 */
interface HeldEmail {
  email: string;
  reviewed: boolean;
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * 和现在比，哪些字段真的变了；同时校验写法（电话、邮箱、航班号、长度）。只校验请求里给了的。`held` 的邮箱不进这次的改动；
 * `keepEmail`：给的邮箱和订单上的是同一个收件箱（只是大小写、空白、全角不同），保留订单上原来的写法（ADR 0065）。
 */
function planChange(order: Order, input: OrderChangeInput, placeType: string | null, held: HeldEmail | null = null, keepEmail = false): PlannedChange {
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
    const given = input.passenger;
    const passenger = { name: given.name?.trim() ?? order.passenger.name, phone: given.phone === undefined ? order.passenger.phone : normalizePhone(given.phone), email: held !== null || keepEmail ? order.passenger.email : (given.email?.trim() ?? order.passenger.email) };
    if (given.name !== undefined && blank(passenger.name)) issue("/passenger/name", "REQUIRED");
    else if (given.name !== undefined && [...passenger.name].length > 100) issue("/passenger/name", "TOO_LONG");
    if (given.phone !== undefined && !isInternationalPhone(passenger.phone)) issue("/passenger/phone", "INVALID_PHONE");
    const email = held?.email ?? given.email?.trim() ?? passenger.email;
    if (given.email !== undefined && (!EMAIL_SHAPE.test(email) || email.length > 254)) issue("/passenger/email", "INVALID_FORMAT");
    if (held !== null && !held.reviewed) issues.push({ path: "/email_review", reason: "REQUIRED", message: "改乘客邮箱要另一位同事批准：请写明怎么核实的客人身份（核实方式、原因）" });
    next.passenger = passenger;
    // 改单记录只记联系人三项；乘车人（M8-32）不在改单范围，生效时原样保留（见 applyChange）
    record("passenger", contactOnly(order.passenger), passenger);
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
  // 试运营的每日上限（M4-01）不看：改期不多接一单，下面的报价也不传 trialLimitReached
  const facts = await loadQuoteFacts(db, [candidate], request, now);
  // 同一天：这一单自己占着的库存、加急名额不算「别人用掉的」
  const inventoryDay = facts.inventory.get(order.productId) ?? null;
  const sameDay = next.serviceDate === order.serviceDate;
  const ownDay = sameDay && inventoryDay !== null && order.inventoryHeld ? { ...inventoryDay, sold: Math.max(0, inventoryDay.sold - 1) } : inventoryDay;
  const urgentUsed = Math.max(0, (facts.urgentUsed.get(order.productId) ?? 0) - (sameDay && order.urgent ? 1 : 0));
  // M8-15 之前下的包车单没有下车点（ADR 0073「已下的订单不改」）：改期照以前的算法，只看上车点、不算区域加价——商品后来设了区域加价也一样
  const product = request.category === "charter" && request.dropoff === null ? { ...candidate.product, priceRules: candidate.product.priceRules.filter((rule) => !isSurchargeRule(rule)) } : candidate.product;
  const result = quoteProduct(product, request, { now, holidays: facts.holidays, route: order.settlement.usage, inventoryDay: ownDay, urgentUsed });
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
  const fields = Object.keys(after).filter((field) => field !== "service_local");
  // 改了乘客才重新加密；没改的不碰这几列（明文列可能只是占位，不能把解密后的内容写回去，ADR 0057）
  // 改单只改联系人三项；这一单的乘车人和举牌姓名（M8-32）原样带上，不随改单丢失
  const passengerAfter: PassengerContact = { ...pick<PassengerContact>("passenger", order.passenger), ...(order.passenger.rider === undefined ? {} : { rider: order.passenger.rider }) };
  const sealed = "passenger" in change.after ? passengerCryptoOf(db).sealOrderPassenger(order.tenantId, order.id, passengerAfter) : null;
  await db.query(
    `update orders set passenger = coalesce($3::jsonb, passenger), passenger_enc = case when $19::boolean then $20 else passenger_enc end, passenger_email_bidx = case when $19::boolean then $21 else passenger_email_bidx end,
            passenger_phone_bidx = case when $19::boolean then $22 else passenger_phone_bidx end, passenger_name_bidx = case when $19::boolean then $23 else passenger_name_bidx end, flight_no = $4, messaging = $5::jsonb, notes = $6, pickup = $7::jsonb, dropoff = $8::jsonb, passengers = $9, luggage = $10,
            service_at = $11, service_local = $12, service_date = $13, settlement_minor = $14, settlement = $15::jsonb, dispatch_due_at = $16,
            dispatch_overdue_at = case when $17::boolean then null else dispatch_overdue_at end, departure_overdue_at = case when $17::boolean then null else departure_overdue_at end,
            version = version + 1, updated_at = $18
      where tenant_id = $1 and id = $2`,
    [
      order.tenantId, order.id, sealed === null ? null : JSON.stringify(sealed.plain), pick("flight_no", order.flightNo), JSON.stringify(pick("messaging", order.messaging)), pick("notes", order.notes),
      pickup === null ? null : JSON.stringify(pickup), dropoff === null ? null : JSON.stringify(dropoff), pick("passengers", order.passengers), pick("luggage", order.luggage),
      serviceAt, serviceLocal, serviceDate, change.settlementAfterMinor, JSON.stringify(settlement), dueAt, change.reschedule, now,
      sealed !== null, sealed?.enc ?? null, sealed?.emailBidx ?? null, sealed?.phoneBidx ?? null, sealed?.nameBidx ?? null,
    ],
  );
  let refunds: OrderRefund[] = [];
  // 司机链接的有效期跟随当前用车时间（ADR 0060）：同意生效才算，待确认期间按原时间
  if (change.reschedule) await recalculateDriverLinkExpiry(db, order.tenantId, order.id, driverLinkExpiry(serviceAt, order.packageHours), now);
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
  const actor = origin?.actor.type === "tenant_user" ? "tenant_user" : origin?.actor.type === "platform_user" ? "platform_user" : change.requestedBy === "channel" ? "channel" : "platform_user";
  await insertOrderEvent(db, order, { fromStatus: order.status, toStatus: order.status, actor, reason: "CHANGED", occurredAt: now, detail: { change_id: change.id, fields, dispatch_conflict: conflict } });
  await enqueueTenantEvent(db, { tenantId: order.tenantId, type: "order.changed", orderId: order.id, data: { change_id: change.id, status: "applied", fields, before: change.before, after: change.after, dispatch_conflict: conflict } }, now);
  await enqueueNotification(db, { event: "order.changed", tenantId: order.tenantId, orderId: order.id, dedupeKey: `order.changed:${change.id}`, data: { change_id: change.id, fields } }, now);
  const contactOnly = !changeFieldsNeedConfirmation(fields);
  // 联系信息频繁改时，同一位司机 10 分钟内只发一封（链接打开看到的永远是最新的；不然改一次发一封、多一条有效链接，ADR 0060）
  await enqueueDriverNotice(db, order, "order.driver_changed", { key: contactOnly ? `contact:${Math.floor(now.getTime() / CONTACT_NOTICE_WINDOW_MS)}` : change.id, changeId: change.id, fields }, now);
  if (contactOnly) await addOrderTodo(db, order, "contact_changed", { changeId: change.id, fields, needsDriverAdjustment: false }, now);
  else {
    await resolveChangeRequestTodo(db, order.tenantId, change.id, now);
    // 供应商自己同意、又不用动司机的不用再提醒；运营代同意的、要调整司机的留一条
    if (origin?.actor.type !== "tenant_user" || hasActiveDriver(order) || conflict) await addOrderTodo(db, order, "change_applied", { changeId: change.id, fields }, now);
  }
  if (origin !== null) {
    await insertAuditLog(db, origin, { tenantId: origin.actor.type === "tenant_user" ? order.tenantId : null, resource: "order_change", resourceId: change.id, action: "change", before: { order_id: order.id, ...(change.before as Record<string, never>) }, after: { order_id: order.id, ...(change.after as Record<string, never>), status: "applied" } });
  }
  return refunds;
}

export type ChangeOutcome = { orderId: string; change: OrderChange };

/**
 * 运营代改时改了乘客邮箱（ADR 0065）：在改单的同一个事务里（订单已锁）发起复核，返回那条复核记录。
 * 由 `services/passenger-email-review.ts` 提供；这里只负责把邮箱从这次的改动里拿出来。
 */
export type PassengerEmailHold = (db: Db, order: Order, email: string, now: Date) => Promise<PassengerEmailChange>;

/** 运营代改的结果：`change` 是这次生效或待确认的改单（只改了邮箱时没有），`emailReview` 是等审核的改邮箱。 */
export type PlatformChangeOutcome = { orderId: string; change: OrderChange | null; emailReview: PassengerEmailChange | null };

/** 从一次提交里挑出这几个字段的改前改后。改时间连带当地时间。 */
function pickValues(values: Record<string, unknown>, fields: readonly OrderChangeField[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([key]) => (fields as readonly string[]).includes(key) || (key === "service_local" && fields.includes("service_time"))));
}

/**
 * 提出改单：校验；联系信息直接生效；其余生成申请：（改期时）重新报价、（贵了时）先扣差价，然后等供应商处理。
 * 运营代改（`emailHold`）时改了乘客邮箱：邮箱这一项拿出来发起复核，其余照常；三件事在同一个事务里，任一失败整个回滚。
 */
async function requestChange(
  ctx: AppContext,
  scope: { channelId: string } | "platform",
  orderId: string,
  expectedVersion: number,
  input: OrderChangeInput,
  who: ChangeActor,
  log: OrderLog,
  emailHold: { hold: PassengerEmailHold; reviewed: boolean } | null = null,
): Promise<PlatformChangeOutcome> {
  const now = ctx.now();
  type Step = { done: OrderChange | null; refunds: OrderRefund[] } | { charge: { change: OrderChange; payment: OrderPayment; orderNo: string } };
  let step: Step;
  let emailReview: PassengerEmailChange | null = null;
  try {
    step = await withPlatformTx(ctx.pool, async (db): Promise<Step> => {
      const sale = await findSale(db, orderId);
      if (sale === null || (scope !== "platform" && sale.channelId !== scope.channelId)) throw notFound("订单");
      const order = (await findOrderForPlatform(db, orderId, { lock: true })) as Order;
      if (order.version !== expectedVersion) throw versionConflict(order.version);
      const placeType = order.placeId === null ? null : ((await db.query<{ type: string }>("select type from places where id = $1", [order.placeId])).rows[0]?.type ?? null);
      const requestedEmail = input.passenger?.email;
      const held: HeldEmail | null = emailHold !== null && requestedEmail !== undefined && passengerEmailNeedsReview(order.passenger.email, requestedEmail) ? { email: requestedEmail.trim(), reviewed: emailHold.reviewed } : null;
      // 运营代改时同一个收件箱的不同写法：不算改，保留原来的写法（全角之类的写法写进订单，以后的信可能被拒）；这时写了核实方式是多余的，400
      const sameMailbox = emailHold !== null && requestedEmail !== undefined && held === null;
      if (sameMailbox && emailHold.reviewed) throw validationFailed("body", [{ path: "/email_review", reason: "NOT_APPLICABLE", message: "新邮箱和订单上的是同一个地址（只是写法不同），不算改邮箱，不用写核实方式（请删掉）" }]);
      const plan = planChange(order, input, placeType, held, sameMailbox);
      const policy = await orderCancelPolicy(db, order);
      const refusal = orderChangeRefusal({
        status: order.status,
        // 等复核的邮箱也按「改乘客信息」检查状态：服务开始后什么都不能改
        fields: held !== null && !plan.fields.includes("passenger") ? [...plan.fields, "passenger"] : plan.fields,
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
      const contact = plan.fields.filter((field) => CONTACT_FIELDS.includes(field));
      const trip = plan.fields.filter((field) => !CONTACT_FIELDS.includes(field));
      const common = { tenantId: order.tenantId, orderId: order.id, settlementBeforeMinor: order.settlementMinor, requestedBy: who.requestedBy, requestedById: who.requestedById, requestedAt: now };
      // 没结论的申请只挡履约字段：客人的电话变了不能等
      if (trip.length > 0 && (await findOpenChange(db, order.tenantId, order.id)) !== null) throw changeInProgress();
      if (held !== null && emailHold !== null) emailReview = await emailHold.hold(db, order, held.email, now);
      const reschedule = trip.includes("service_time");
      const repriced = reschedule ? await reprice(db, order, sale, plan.next, now) : null;
      let refunds: OrderRefund[] = [];
      let applied: OrderChange | null = null;
      let current = order;
      if (contact.length > 0) {
        const id = await insertOrderChange(db, { ...common, status: "applied", reschedule: false, before: pickValues(plan.before, contact), after: pickValues(plan.after, contact), settlementAfterMinor: order.settlementMinor, settlementAfter: null, confirmDueAt: null, earliestServiceAt: null, decidedAt: now });
        applied = (await findOrderChange(db, order.tenantId, id, { lock: true })) as OrderChange;
        refunds = await applyChange(db, order, applied, sale, null, who.origin, now);
        applied = (await findOrderChange(db, order.tenantId, id)) as OrderChange;
        current = (await findOrderForPlatform(db, orderId, { lock: true })) as Order;
      }
      if (trip.length === 0) return { done: applied, refunds };
      const diff = priceDifference(sale.sellMinor, repriced?.sellMinor ?? sale.sellMinor);
      const newServiceAt = reschedule ? plan.next.serviceAt : null;
      const earliest = earliestServiceAt(order.serviceAt, newServiceAt);
      const base: NewOrderChange = {
        ...common,
        status: diff.kind === "charge" ? "awaiting_payment" : "pending_confirmation",
        reschedule,
        before: pickValues(plan.before, trip),
        after: pickValues(plan.after, trip),
        settlementAfterMinor: repriced?.settlement.totalMinor ?? order.settlementMinor,
        settlementAfter: repriced?.settlement ?? null,
        confirmDueAt: changeConfirmDeadline(now, earliest, newServiceAt),
        earliestServiceAt: earliest,
        decidedAt: null,
      };
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
      await pendingConfirmation(db, current, change, who.origin, now);
      return { done: (await findOrderChange(db, order.tenantId, id)) as OrderChange, refunds };
    });
  } catch (err) {
    if (isUniqueViolation(err, "order_changes_open_key")) throw changeInProgress();
    throw err;
  }
  if ("done" in step) {
    await processRefunds(ctx, step.refunds, log);
    return { orderId, change: step.done, emailReview };
  }
  // 补差价被拒（402）时联系信息已经生效、邮箱的复核已经发起（同 ADR 0060：和差价无关的不跟着卡被拒回滚）
  return { orderId, change: await chargeAndSettle(ctx, step.charge.change, step.charge.payment, step.charge.orderNo, who.origin, log, true), emailReview };
}

function changeInProgress(): AppError {
  return new AppError(409, "CHANGE_IN_PROGRESS", "这张单还有一个修改申请没有结论（在等供应商确认或在补差价），请等它有结果再改；姓名、电话、邮箱随时可以直接改，备注在免费取消期内可以改");
}

/** 申请进入「等供应商处理」：立即通知供应商（邮件、待办、推送）和已派的司机；留流水，运营代提的写审计。 */
async function pendingConfirmation(db: Db, order: Order, change: OrderChange, origin: AuditOrigin | null, now: Date): Promise<void> {
  const fields = Object.keys(change.after).filter((field) => field !== "service_local");
  const dueAt = change.confirmDueAt?.toISOString() ?? null;
  await insertOrderEvent(db, order, { fromStatus: order.status, toStatus: order.status, actor: change.requestedBy, reason: "CHANGE_REQUESTED", occurredAt: now, detail: { change_id: change.id, fields, confirm_due_at: dueAt } });
  await enqueueTenantEvent(db, { tenantId: order.tenantId, type: "order.changed", orderId: order.id, data: { change_id: change.id, status: "pending_confirmation", fields, before: change.before, after: change.after, confirm_due_at: dueAt } }, now);
  await enqueueNotification(db, { event: "order.change_pending", tenantId: order.tenantId, orderId: order.id, dedupeKey: `order.change_pending:${change.id}`, data: { change_id: change.id, fields, confirm_due_at: dueAt } }, now);
  await enqueueDriverNotice(db, order, "order.driver_change_pending", { key: change.id, changeId: change.id, fields }, now);
  await addOrderTodo(db, order, "change_request", { changeId: change.id, fields }, now);
  if (origin !== null) await insertAuditLog(db, origin, { tenantId: null, resource: "order_change", resourceId: change.id, action: "request", before: { order_id: order.id, ...(change.before as Record<string, never>) }, after: { order_id: order.id, ...(change.after as Record<string, never>), status: "pending_confirmation" } });
}

/**
 * 扣差价，再按结果往下走：扣到了 → 等供应商处理（订单这时已经不能改了 → 改单作废、差价退回）；卡被拒 → 改单失败（`throwOnDecline` 时抛 402）；
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
    // 扣差价的时候订单被取消了（改单随之作废）：取消时这笔还没扣到、没算进退款，现在扣到了就退回去
    if (current.status === "cancelled" && outcome === "succeeded") return { change: current, refunds: await scheduleRefund(db, order, "change", await collectedFor(db, order.id, change.id), change.id, now) };
    if (current.status !== "awaiting_payment") return { change: current, refunds: [] };
    if (outcome === "declined") {
      await updateOrderChange(db, current, { status: "failed", decidedAt: now });
      // 后台重试被拒：客人已经离开页面，要告诉他结果（当场被拒的 402 已经告诉了）
      if (!throwOnDecline) await enqueueNotification(db, { event: "order.change_declined", tenantId: order.tenantId, orderId: order.id, dedupeKey: `order.change_declined:${current.id}`, data: { change_id: current.id, fields: Object.keys(current.after).filter((field) => field !== "service_local"), advice: "payment_failed" } }, now);
      return { change: (await findOrderChange(db, change.tenantId, change.id)) as OrderChange, refunds: [] };
    }
    let refunds: OrderRefund[] = [];
    if (!orderChangeStillApplicable(order.status, Object.keys(current.after))) {
      // 扣差价的这几秒里订单变了（取消、司机出发）：改单作废，刚扣的差价退回
      await updateOrderChange(db, current, { status: "cancelled", decidedAt: now });
      refunds = await scheduleRefund(db, order, "change", await collectedFor(db, order.id, change.id), change.id, now);
    } else {
      // 期限从扣到钱起算（M4-29 之前卡在这一步的单没有 earliest，这里补上）
      const newServiceAt = current.reschedule ? new Date(current.after["service_time"] as string) : null;
      await updateOrderChange(db, current, { status: "pending_confirmation", confirmDueAt: changeConfirmDeadline(now, current.earliestServiceAt ?? earliestServiceAt(order.serviceAt, newServiceAt), newServiceAt) });
      await pendingConfirmation(db, order, (await findOrderChange(db, change.tenantId, change.id)) as OrderChange, origin, now);
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

/**
 * 订单进入救援改派（M3-04，ADR 0031）：没有结论的改单作废——原供应商已经不再服务这一单，等它确认改期没有意义。
 * 已经补收的差价退回（还在扣的，扣到之后 `settleChangeCharge` 看到已作废会退回）。告诉客人和司机这次修改作废了。在调用方的平台事务里（订单已锁），返回排好的退款。
 */
export async function abandonOpenChange(db: Db, order: Order, now: Date): Promise<OrderRefund[]> {
  const open = await findOpenChange(db, order.tenantId, order.id, { lock: true });
  if (open === null) return [];
  await updateOrderChange(db, open, { status: "cancelled", decidedAt: now });
  await resolveChangeRequestTodo(db, order.tenantId, open.id, now);
  if (orderChangeDecidable(open.status)) await enqueueNotification(db, { event: "order.change_declined", tenantId: order.tenantId, orderId: order.id, dedupeKey: `order.change_declined:${open.id}`, data: { change_id: open.id, fields: Object.keys(open.after).filter((field) => field !== "service_local"), advice: "rescue" } }, now);
  return scheduleRefund(db, order, "change", await collectedFor(db, order.id, open.id), open.id, now);
}

export async function changeForChannel(ctx: AppContext, channelId: string, orderId: string, version: number, input: OrderChangeInput, log: OrderLog): Promise<ChangeOutcome> {
  const outcome = await requestChange(ctx, { channelId }, orderId, version, input, { requestedBy: "channel", requestedById: null, origin: null }, log);
  // 渠道（客人）改邮箱直接生效，没有复核：一定有改单记录（什么都没变是 422 NO_CHANGE）
  return { orderId: outcome.orderId, change: outcome.change as OrderChange };
}

/**
 * 运营代客人改单。改了乘客邮箱的那一项交给 `hold` 发起复核（ADR 0065），`reviewed` = 请求里写了核实方式和原因（没写 400）；
 * 只改了邮箱时没有改单记录（`change` 为 null）。
 */
export async function changeForPlatform(ctx: AppContext, principal: PlatformPrincipal, orderId: string, version: number, input: OrderChangeInput, ip: string, log: OrderLog, emailHold: { hold: PassengerEmailHold; reviewed: boolean }): Promise<PlatformChangeOutcome> {
  return requestChange(ctx, "platform", orderId, version, input, { requestedBy: "platform_user", requestedById: principal.user.id, origin: consoleOrigin(platformActor(principal.user), ip, ctx.now()) }, log, emailHold);
}

/**
 * 改邮箱的复核批准时（ADR 0065，审核人的事务里，订单已锁）：记一次直接生效的联系信息改动（发起人是代改的那位员工），和平时一样
 * 写订单、通知供应商和司机、告诉客人（新地址）、写审计。返回这次改单的编号。能不能改由调用方先检查。
 */
export async function applyApprovedPassengerEmail(db: Db, order: Order, email: string, requestedById: string, origin: AuditOrigin, now: Date): Promise<string> {
  const sale = (await findSale(db, order.id)) as OrderSale;
  const passenger = { ...order.passenger, email };
  const id = await insertOrderChange(db, {
    tenantId: order.tenantId,
    orderId: order.id,
    settlementBeforeMinor: order.settlementMinor,
    requestedBy: "platform_user",
    requestedById,
    requestedAt: now,
    status: "applied",
    reschedule: false,
    // 改单记录只记联系人；乘车人和举牌姓名（M8-32）随订单原样带上，不进改单记录
    before: { passenger: contactOnly(order.passenger) },
    after: { passenger: contactOnly(passenger) },
    settlementAfterMinor: order.settlementMinor,
    settlementAfter: null,
    confirmDueAt: null,
    earliestServiceAt: null,
    decidedAt: now,
  });
  const change = (await findOrderChange(db, order.tenantId, id, { lock: true })) as OrderChange;
  await applyChange(db, order, change, sale, null, origin, now);
  return id;
}

/** 处理这次申请的人：供应商的人（只有令牌里的租户）或代处理的平台员工。 */
export type ChangeDecider = { kind: "tenant"; principal: TenantPrincipal } | { kind: "platform"; principal: PlatformPrincipal };
export type ChangeDecision = "confirm" | "reject" | "adjusting";

interface Decided {
  by: string | null;
  byPlatform: string | null;
  note: string | null;
}

/** 拒绝 / 超时：补收的差价退回；告诉客人结果、告诉司机按原任务（申请没结论时才派的司机没听说过这次申请，不发）。 */
async function closeUnconfirmed(db: Db, order: Order, change: OrderChange, status: "rejected" | "expired", decided: Decided, now: Date): Promise<OrderRefund[]> {
  const fields = Object.keys(change.after).filter((field) => field !== "service_local");
  await updateOrderChange(db, change, { status, decidedAt: now, decidedBy: decided.by, decidedByPlatform: decided.byPlatform, decisionNote: decided.note });
  await insertOrderEvent(db, order, { fromStatus: order.status, toStatus: order.status, actor: decided.byPlatform !== null ? "platform_user" : status === "rejected" ? "tenant_user" : "system", reason: status === "rejected" ? "CHANGE_REJECTED" : "CHANGE_EXPIRED", occurredAt: now, detail: { change_id: change.id, fields, ...(decided.note === null ? {} : { note: decided.note }) } });
  await enqueueNotification(db, { event: "order.change_declined", tenantId: order.tenantId, orderId: order.id, dedupeKey: `order.change_declined:${change.id}`, data: { change_id: change.id, fields, advice: changeDeclineAdvice(order.status, { ...change, status }) } }, now);
  if (order.dispatch.assignedAt !== null && order.dispatch.assignedAt.getTime() <= change.requestedAt.getTime()) await enqueueDriverNotice(db, order, "order.driver_change_declined", { key: change.id, changeId: change.id, fields }, now);
  await resolveChangeRequestTodo(db, order.tenantId, change.id, now);
  // 不是供应商自己拒绝的（超时、运营代拒绝）：留一条让它知道
  if (status === "expired" || decided.byPlatform !== null) await addOrderTodo(db, order, "change_expired", { changeId: change.id, fields, needsDriverAdjustment: false }, now);
  return scheduleRefund(db, order, "change", await collectedFor(db, order.id, change.id), change.id, now);
}

/**
 * 处理一次修改申请：同意（生效）、拒绝（必填原因，调用方校验）、标记调整中（只能一次）。
 * 供应商（`order.dispatch`）：租户编号只来自登录令牌，别的供应商的单当作不存在。运营代处理（`order.change_decide`）：写审计，这不是双人复核。
 * 生效要改用车时间和结算价（只有平台能改这些列），所以都在平台事务里做。先锁订单、后锁改单，和取消、改派、再改同一个顺序：同时到的只有一个成功，后到的 409。
 * 过了期限：记为超时没确认（409 `CHANGE_CONFIRMATION_EXPIRED`），差价退回。
 */
export async function decideChange(ctx: AppContext, decider: ChangeDecider, orderId: string, changeId: string, decision: ChangeDecision, note: string | null, ip: string, log: OrderLog): Promise<{ change: OrderChange; expired: boolean }> {
  const now = ctx.now();
  const origin = decider.kind === "tenant" ? consoleOrigin(tenantActor(decider.principal.user), ip, now) : consoleOrigin(platformActor(decider.principal.user), ip, now);
  const decidedBy = decider.kind === "tenant" ? { by: decider.principal.user.id, byPlatform: null } : { by: null, byPlatform: decider.principal.user.id };
  const result = await withPlatformTx(ctx.pool, async (db): Promise<{ change: OrderChange; expired: boolean; refunds: OrderRefund[] }> => {
    const order = await findOrderForPlatform(db, orderId, { lock: true });
    const tenantId = decider.kind === "tenant" ? decider.principal.tenantId : (order?.tenantId ?? null);
    if (order === null || tenantId === null || order.tenantId !== tenantId || order.confirmedAt === null) throw notFound("改单");
    const current = await findOrderChange(db, tenantId, changeId, { lock: true });
    if (current === null || current.orderId !== orderId) throw notFound("改单");
    if (decider.kind === "tenant") assertTenantCanOperate(order, `${decision}_change`);
    const reread = (): Promise<OrderChange> => findOrderChange(db, tenantId, changeId) as Promise<OrderChange>;
    if (!orderChangeDecidable(current.status)) throw new AppError(409, "CHANGE_NOT_PENDING", "这次修改不在等处理（已经有结论了）", { status: current.status });
    if (changeConfirmOverdue(current.confirmDueAt as Date, now)) {
      const refunds = await closeUnconfirmed(db, order, current, "expired", { by: null, byPlatform: null, note: null }, now);
      return { change: await reread(), expired: true, refunds };
    }
    const auditTenant = decider.kind === "tenant" ? tenantId : null;
    const proxied = decider.kind === "platform" ? { by_platform: true, tenant_id: tenantId } : {};
    if (decision === "reject") {
      const refunds = await closeUnconfirmed(db, order, current, "rejected", { by: decidedBy.by, byPlatform: decidedBy.byPlatform, note }, now);
      await insertAuditLog(db, origin, { tenantId: auditTenant, resource: "order_change", resourceId: changeId, action: "reject", before: { status: current.status }, after: { status: "rejected", order_id: orderId, note, ...proxied } });
      return { change: await reread(), expired: false, refunds };
    }
    if (!orderChangeStillApplicable(order.status, Object.keys(current.after))) throw new AppError(409, "ORDER_STATE_INVALID", "订单当前的状态已经不能这样改了", { status: order.status as OrderStatus, action: `${decision}_change` });
    if (decision === "adjusting") {
      if (current.status === "adjusting") throw new AppError(409, "CHANGE_NOT_PENDING", "已经标记过调整中了，只能标一次；请同意或拒绝", { status: current.status });
      const confirmDueAt = changeAdjustingDeadline(now, current.confirmDueAt as Date, current.earliestServiceAt ?? order.serviceAt);
      await updateOrderChange(db, current, { status: "adjusting", confirmDueAt, adjustingAt: now, ...(decider.kind === "tenant" ? { adjustingBy: decider.principal.user.id } : { adjustingByPlatform: decider.principal.user.id }), decisionNote: note });
      await insertOrderEvent(db, order, { fromStatus: order.status, toStatus: order.status, actor: decider.kind === "tenant" ? "tenant_user" : "platform_user", reason: "CHANGE_ADJUSTING", occurredAt: now, detail: { change_id: changeId, confirm_due_at: confirmDueAt.toISOString(), ...(note === null ? {} : { note }) } });
      await insertAuditLog(db, origin, { tenantId: auditTenant, resource: "order_change", resourceId: changeId, action: "mark_adjusting", before: { status: current.status }, after: { status: "adjusting", order_id: orderId, note, confirm_due_at: confirmDueAt.toISOString(), ...proxied } });
      return { change: await reread(), expired: false, refunds: [] };
    }
    const sale = (await findSale(db, orderId)) as OrderSale;
    const sellAfter = await findChangeSale(db, changeId);
    await updateOrderChange(db, current, { status: current.status, decidedBy: decidedBy.by, decidedByPlatform: decidedBy.byPlatform, decisionNote: note });
    const refunds = await applyChange(db, order, current, sale, sellAfter?.sellAfterMinor ?? null, origin, now);
    return { change: await reread(), expired: false, refunds };
  });
  await processRefunds(ctx, result.refunds, log);
  return { change: result.change, expired: result.expired };
}

/** 定时任务：到了期限没结论的记为超时（差价退回），已经不适用的也一样，补差价卡住的接着扣。 */
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
      if (!orderChangeDecidable(current.status) || !changeConfirmOverdue(current.confirmDueAt as Date, ctx.now())) return null;
      log.warn({ event: "order.change_expired", orderId: order.id, changeId: current.id }, "修改申请到了期限没有结论，记为没确认");
      return closeUnconfirmed(db, order, current, "expired", { by: null, byPlatform: null, note: null }, ctx.now());
    });
    if (refunds !== null) {
      expired += 1;
      await processRefunds(ctx, refunds, log);
    }
  }
  // 订单已经走到这次修改不再适用（司机出发了还在等改时间、服务开始了）：不用等到期限
  const outdated = await withPlatformTx(ctx.pool, (db) => listOutdatedChanges(db, limit));
  for (const entry of outdated) {
    const refunds = await withPlatformTx(ctx.pool, async (db): Promise<OrderRefund[] | null> => {
      const change = await findOrderChange(db, entry.tenantId, entry.id);
      if (change === null) return null;
      const order = (await findOrderForPlatform(db, change.orderId, { lock: true })) as Order;
      const current = (await findOrderChange(db, entry.tenantId, entry.id, { lock: true })) as OrderChange;
      if (!orderChangeDecidable(current.status) || orderChangeStillApplicable(order.status, Object.keys(current.after))) return null;
      log.warn({ event: "order.change_outdated", orderId: order.id, changeId: current.id, status: order.status }, "订单已经走到这次修改不再适用：记为没确认");
      return closeUnconfirmed(db, order, current, "expired", { by: null, byPlatform: null, note: null }, ctx.now());
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
