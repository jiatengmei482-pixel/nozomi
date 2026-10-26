/**
 * 订单 → 给供应商看的 JSON（M3-01 / M3-02）。供应商后台的订单接口、推给供应商的 Webhook 用的是同一份，保证两边内容一致。
 *
 * 规则 4：这里没有渠道、对外价、加价比例、汇率——`Order` 里本来就没有这些（在平台表 order_sales），这里也只逐个字段列出订单表里的内容。
 * 每个函数都逐个字段列出，不展开整个对象：新加的内部字段不会不知不觉出现在接口和推送里。
 */
import { type LandingResult, NO_SHOW_RULES, departureReminderAt, dispatchEscalationAt, dispatchOverdue, effectiveLanding, landingApplies, vehicleIsNew } from "@nozomi/domain";
import type { Driver, Vehicle } from "../repos/fleet.ts";
import type { Order } from "../repos/orders.ts";
import type { OrderChange } from "../repos/order-changes.ts";
import type { ExtraCharge } from "../repos/extra-charges.ts";
import { salesMoney } from "./sales-quotes.ts";

type Json = Record<string, unknown>;

const iso = (date: Date | null): string | null => date?.toISOString() ?? null;

/** 行程和乘客：租户、平台、渠道都能看的部分（没有任何金额）。 */
export function orderTripJson(order: Order): Json {
  return {
    id: order.id,
    order_no: order.orderNo,
    status: order.status,
    category: order.category,
    city_id: order.cityId,
    place_id: order.placeId,
    direction: order.direction,
    vehicle_group_id: order.vehicleGroupId,
    package_hours: order.packageHours,
    service_time: order.serviceAt.toISOString(),
    service_local: order.serviceLocal,
    timezone: order.timezone,
    service_date: order.serviceDate,
    urgent: order.urgent,
    passengers: order.passengers,
    luggage: order.luggage,
    pickup: order.pickup,
    dropoff: order.dropoff,
    addons: order.addons.map((addon) => ({ addon_id: addon.addonId, quantity: addon.quantity })),
    driver_language: order.driverLanguage,
    flight_no: order.flightNo,
    passenger: order.passenger,
    messaging: order.messaging,
    notes: order.notes,
    free_wait_minutes: order.freeWaitMinutes,
    created_at: order.createdAt.toISOString(),
    confirmed_at: iso(order.confirmedAt),
    cancelled_at: iso(order.cancelledAt),
    cancel_reason: order.cancelReason,
  };
}

/** 结算价和明细（租户、平台能看；渠道看不到）。 */
export function settlementJson(order: Order): Json {
  const s = order.settlement;
  const money = (minor: number): Json => salesMoney(minor, order.settlementCurrency);
  return {
    total: money(order.settlementMinor),
    base: money(s.baseMinor),
    adjust: money(s.adjustMinor),
    urgent: money(s.urgentMinor),
    night: money(s.nightMinor),
    addons: money(s.addonsMinor),
    driver_language: money(s.driverLanguageMinor),
  };
}

/**
 * 这一单要不要记落地时间：接机（从机场接人）。下单时机场接机必须填航班号、车站接送不能填（ADR 0026 的下单校验），
 * 所以「接送机 + 接机方向 + 有航班号」就是从机场接人，不用再查地点的类型。
 */
export function orderLandingApplies(order: Pick<Order, "category" | "direction" | "flightNo">): boolean {
  return landingApplies({ category: order.category, direction: order.direction, placeType: order.category === "airport_transfer" && order.flightNo !== null ? "airport" : null });
}

/** 实际落地时间（按 @nozomi/domain 的取证规则，由客人确认、司机填写现算；和订单上存的结果一致）。不是接机单为 null。 */
export function orderLanding(order: Order): LandingResult | null {
  if (!orderLandingApplies(order)) return null;
  const { dispatch } = order;
  return effectiveLanding({
    scheduledAt: order.serviceAt,
    guestReportedAt: dispatch.guestLandedAt,
    driver: dispatch.driverLandedAt === null ? null : { landedAt: dispatch.driverLandedAt, arrivalScreenPhoto: dispatch.driverLandedFileId !== null },
  });
}

export function landingJson(order: Order): Json | null {
  const landing = orderLanding(order);
  if (landing === null) return null;
  return {
    scheduled_at: order.serviceAt.toISOString(),
    guest_reported_at: iso(order.dispatch.guestLandedAt),
    driver_reported_at: iso(order.dispatch.driverLandedAt),
    driver_photo_file_id: order.dispatch.driverLandedFileId,
    landed_at: landing.landedAt.toISOString(),
    source: landing.source,
    disagreement: landing.disagreement,
    delay_minutes: landing.delayMinutes,
    within_delay_allowance: landing.withinDelayAllowance,
  };
}

export interface DispatchFacts {
  driver: Driver | null;
  vehicle: Vehicle | null;
}

export function driverJson(driver: Driver): Json {
  return { id: driver.id, name: driver.name, phone: driver.phone, languages: driver.languages, gold: driver.gold };
}

export function vehicleSummaryJson(vehicle: Vehicle): Json {
  return { id: vehicle.id, plate: vehicle.plate, vehicle_group_id: vehicle.vehicleGroupId, model: vehicle.model, color: vehicle.color, seats: vehicle.seats, is_new: vehicleIsNew(vehicle.mileageKm) };
}

/** 派车：截止时间、超时没有、派的司机和车辆、履约的时间点。 */
export function dispatchJson(order: Order, facts: DispatchFacts, now: Date): Json {
  const { dispatch } = order;
  const due = dispatch.dueAt;
  return {
    due_at: iso(due),
    overdue: order.status === "confirmed" && due !== null && dispatchOverdue(due, now),
    overdue_at: iso(dispatch.overdueAt),
    escalation_at: order.confirmedAt === null ? null : dispatchEscalationAt(order.serviceAt).toISOString(),
    departure_due_at: order.confirmedAt === null ? null : departureReminderAt(order.serviceAt).toISOString(),
    departure_overdue_at: iso(dispatch.departureOverdueAt),
    assigned_at: iso(dispatch.assignedAt),
    driver: facts.driver === null ? null : driverJson(facts.driver),
    vehicle: facts.vehicle === null ? null : vehicleSummaryJson(facts.vehicle),
  };
}

export function fulfilmentJson(order: Order): Json {
  const { dispatch } = order;
  return {
    departed_at: iso(dispatch.departedAt),
    arrived_at: iso(dispatch.arrivedAt),
    arrival_distance_m: dispatch.arrivalDistanceM,
    arrival_within_range: dispatch.arrivalDistanceM === null ? null : dispatch.arrivalDistanceM <= NO_SHOW_RULES.maxArrivalDistanceMeters,
    picked_up_at: iso(dispatch.pickedUpAt),
    completed_at: iso(dispatch.completedAt),
    actual_minutes: dispatch.actualMinutes,
    actual_km: dispatch.actualKm,
    leave_requested_at: iso(dispatch.leaveRequestedAt),
  };
}

/** 这一单适用的取消阶梯（下单时的平台政策；M3-03 之前下的单为 null）。没有金额，三边都能看。 */
export function cancelPolicyJson(order: Order): Json | null {
  const policy = order.cancelPolicy;
  if (policy === null) return null;
  return { version: policy.version, category: policy.category, level: policy.level, tiers: policy.tiers.map((tier) => ({ min_hours_before: tier.minHoursBefore, fee_bp: tier.feeBp })) };
}

/** 供应商看到的取消结果：扣款比例和自己应得的（结算币种）。客人被扣多少、退多少不给（规则 4：只给与它结算相关的部分）。 */
export function tenantCancellationJson(order: Order): Json | null {
  if (order.cancelFeeBp === null || order.cancelTenantShareMinor === null) return null;
  return { fee_bp: order.cancelFeeBp, tenant_share: salesMoney(order.cancelTenantShareMinor, order.settlementCurrency) };
}

/** 供应商看到的订单：行程、乘客、结算价、派车、履约、落地时间。没有渠道、对外价、加价比例、汇率（规则 4）。 */
export function tenantOrderJson(order: Order, facts: DispatchFacts, now: Date): Json {
  return {
    ...orderTripJson(order),
    product_id: order.productId,
    product_version: order.productVersion,
    settlement: settlementJson(order),
    dispatch: dispatchJson(order, facts, now),
    fulfilment: fulfilmentJson(order),
    landing: landingJson(order),
    cancel_policy: cancelPolicyJson(order),
    cancellation: tenantCancellationJson(order),
    version: order.version,
  };
}

/** 一次改单（供应商、平台都看的部分）：改了什么、结算价改前改后、要不要确认。没有对外价。 */
export function changeJson(change: OrderChange): Json {
  return {
    id: change.id,
    status: change.status,
    reschedule: change.reschedule,
    before: change.before,
    after: change.after,
    settlement_before: salesMoney(change.settlementBeforeMinor, change.settlementCurrency),
    settlement_after: salesMoney(change.settlementAfterMinor, change.settlementCurrency),
    confirm_due_at: change.status === "pending_confirmation" ? (change.confirmDueAt?.toISOString() ?? null) : null,
    requested_by: change.requestedBy,
    requested_at: change.requestedAt.toISOString(),
    decided_at: iso(change.decidedAt),
    decision_note: change.decisionNote,
    dispatch_conflict: change.dispatchConflict,
  };
}

/** 一项事后加收（供应商、平台都看的部分）：供应商报的金额（结算币种）、审核通过的金额、状态、异议期。客人付的金额不在这里（规则 4）。 */
export function extraChargeJson(charge: ExtraCharge): Json {
  return {
    id: charge.id,
    type: charge.type,
    amount: salesMoney(charge.amountMinor, charge.currency),
    approved_amount: charge.approvedMinor === null ? null : salesMoney(charge.approvedMinor, charge.currency),
    description: charge.description,
    file_ids: charge.fileIds,
    status: charge.status,
    review_reasons: charge.reviewReasons,
    submitted_at: charge.submittedAt.toISOString(),
    dispute_until: charge.disputeUntil.toISOString(),
    disputed_at: iso(charge.disputedAt),
    dispute_reason: charge.disputeReason,
    decided_at: iso(charge.decidedAt),
    decision_note: charge.decisionNote,
    charged_at: iso(charge.chargedAt),
    withdrawn_at: iso(charge.withdrawnAt),
    version: charge.version,
  };
}

