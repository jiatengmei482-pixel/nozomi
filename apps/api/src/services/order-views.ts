/**
 * 订单 → 给供应商看的 JSON（M3-01 / M3-02）。供应商后台的订单接口、推给供应商的 Webhook 用的是同一份，保证两边内容一致。
 *
 * 规则 4：这里没有渠道、对外价、加价比例、汇率——`Order` 里本来就没有这些（在平台表 order_sales），这里也只逐个字段列出订单表里的内容。
 * 每个函数都逐个字段列出，不展开整个对象：新加的内部字段不会不知不觉出现在接口和推送里。
 */
import { type LandingResult, type LocalizedText, NO_SHOW_RULES, departureReminderAt, dispatchEscalationAt, dispatchOverdue, effectiveLanding, landingApplies, orderChangeDecidable, vehicleIsNew, vehicleLabelMailVariables } from "@nozomi/domain";
import type { Driver, Vehicle } from "../repos/fleet.ts";
import type { OrderVehicleGroupRef } from "../repos/master-data.ts";
import type { Order } from "../repos/orders.ts";
import type { OrderChange } from "../repos/order-changes.ts";
import type { ExtraCharge } from "../repos/extra-charges.ts";
import { salesMoney } from "./sales-quotes.ts";

type Json = Record<string, unknown>;

const iso = (date: Date | null): string | null => date?.toISOString() ?? null;

/** 订单详情里的车型组（M7-02，ADR 0068）：车型标识由 `sample_models`、`combos` 得出，是车型组当前的值。没有金额。 */
export function orderVehicleGroupJson(group: OrderVehicleGroupRef | null): Json | null {
  if (group === null) return null;
  return { id: group.id, code: group.code, name: group.name, seats: group.seats, sample_models: group.sampleModels, combos: group.combos.map((combo) => ({ passengers: combo.passengers, luggage: combo.luggage })) };
}

/** 邮件里的车型标识（M7-04，ADR 0068）：车型组当前的代表车型和组合；找不到车型组或没填代表车型时对应的行不出现。没有任何金额。 */
export function vehicleMailVariables(group: OrderVehicleGroupRef | null): ReturnType<typeof vehicleLabelMailVariables> {
  return vehicleLabelMailVariables(group === null ? null : { sample_models: group.sampleModels, combos: group.combos });
}

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
    area_surcharge: settlementAreaSurchargeJson(order),
    // 点对点（M8-11，ADR 0073 第二部分）：用的是线路价时的下车区域；含公里数的一口价在这一单上的情况（结算价）。没有的为 null
    to_area_id: s.toAreaId ?? null,
    distance: distanceMoneyJson(s, order.settlementCurrency),
  };
}

/**
 * 含公里数的一口价在这一单上的情况（结算价，M8-11，ADR 0073 第二部分第 4 节）：报价时锁定的路线距离（米）、超出公里数、超出每公里单价。
 * 超出的钱已经含在 `base` 里。没设含公里数的、M8-11 之前的订单为 null。
 */
/**
 * 计程部分（M8-30，ADR 0080）：订单上锁定的结算价明细（一口价 + 区域外里程费、按计程价时才有）；一口价、M8-30 之前的订单为 null。
 * 只有结算价：供应商和运营都用（规则 4）。
 */
export function mileageMoneyJson(settlement: Pick<Order["settlement"], "mileage">, currency: Order["settlementCurrency"]): Json | null {
  const mileage = settlement.mileage;
  if (mileage === undefined) return null;
  return { route_meters: mileage.routeMeters, included_km: mileage.includedKm, km: mileage.km, start_price: salesMoney(mileage.startMinor, currency), per_km: salesMoney(mileage.perKmMinor, currency), fee: salesMoney(mileage.feeMinor, currency) };
}

export function distanceMoneyJson(settlement: Pick<Order["settlement"], "distance">, currency: Order["settlementCurrency"]): Json | null {
  const distance = settlement.distance ?? null;
  if (distance === null) return null;
  return { included_km: distance.includedKm, route_meters: distance.routeMeters, over_km: distance.overKm, over_km_per_km: salesMoney(distance.overKmPerKmMinor, currency) };
}

/**
 * 包车的区域加价（结算价，M8-15，ADR 0073）：已含在 `base` 里；`package` 是其中的基础定价。
 * 一端的 `area_id` 为 null = 在商品本身的区域里（加 0）。M8-15 之前的订单、没给下车点的包车、别的品类都是 null。
 */
export function settlementAreaSurchargeJson(order: Order): Json | null {
  return areaSurchargeMoneyJson(order.settlement, order.settlementCurrency);
}

/** 同上，给任意一份结算价明细用（救援的候选报价和订单的 `settlement` 同一个格式）。 */
export function areaSurchargeMoneyJson(settlement: Pick<Order["settlement"], "areaSurcharge">, currency: Order["settlementCurrency"]): Json | null {
  const surcharge = settlement.areaSurcharge ?? null;
  if (surcharge === null) return null;
  const money = (minor: number): Json => salesMoney(minor, currency);
  const end = (entry: typeof surcharge.pickup): Json => ({ area_id: entry.areaId, amount: money(entry.amountMinor) });
  return { package: money(surcharge.packageMinor), pickup: end(surcharge.pickup), dropoff: end(surcharge.dropoff) };
}

/**
 * 订单详情里的包车区域加价（M8-15，ADR 0073 第四部分）：上车、下车各在哪个加价区域（现在的名称）、加了多少结算价。
 * 供应商和运营都用；**只有结算价**（规则 4）——运营另外在 `platformAreaSurchargeJson` 里加对外价。没有区域加价的订单为 null。
 */
export function areaSurchargeDetailJson(order: Order, names: ReadonlyMap<string, LocalizedText>): Json | null {
  const surcharge = order.settlement.areaSurcharge ?? null;
  if (surcharge === null) return null;
  const end = (entry: typeof surcharge.pickup): Json => ({ area_id: entry.areaId, area_name: entry.areaId === null ? null : (names.get(entry.areaId) ?? null), settlement: salesMoney(entry.amountMinor, order.settlementCurrency) });
  return { package_settlement: salesMoney(surcharge.packageMinor, order.settlementCurrency), pickup: end(surcharge.pickup), dropoff: end(surcharge.dropoff) };
}

/**
 * 点对点用的价格（M8-13，ADR 0073 第四部分）：`kind` 线路价 `route` / 区域价 `area`；`area` 是上车区域、`to_area` 是线路价的下车区域，
 * 名称是区域现在的名称（区域被删了为 null）；不知道上车区域时 `area` 为 null。没有任何金额，供应商和运营都用。没有为 null。
 */
export function pricingRouteJson(route: { areaId: string | null; toAreaId: string | null; names: ReadonlyMap<string, LocalizedText> } | null): Json | null {
  if (route === null) return null;
  const area = (id: string | null): Json | null => (id === null ? null : { id, name: route.names.get(id) ?? null });
  return { kind: route.toAreaId === null ? "area" : "route", area: area(route.areaId), to_area: area(route.toAreaId) };
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
  /** 有修改申请等处理（M4-29）；只有供应商的列表和详情给 */
  pendingChange?: boolean;
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
    pending_change: facts.pendingChange ?? false,
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
    confirm_due_at: orderChangeDecidable(change.status) ? (change.confirmDueAt?.toISOString() ?? null) : null,
    adjusting_at: iso(change.adjustingAt),
    decided_by_platform: change.decidedByPlatform !== null,
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

