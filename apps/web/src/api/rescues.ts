/**
 * 救援改派与违约金的接口（M3-04，ADR 0031）。字段与 `apps/api/openapi.yaml` 对齐，由 rescues.contract.test.ts 保证。
 * 供应商的接口（救援单、应扣款项、订单里的救援）没有对外价、加价比例、别的供应商是谁（规则 4）；运营后台的有。
 */
import type { DeductionKind, DeductionStatus, OrderStatus, PenaltyTier, RescueOfferStatus, RescueStatus, RescueTrigger, ServiceCategory } from "@nozomi/domain";
import { query, TENANT_BASE } from "./areas.ts";
import { apiRequest } from "./client.ts";
import type { Approval } from "./channels.ts";
import type { Money, OrderPoint } from "./dispatch.ts";
import { PLATFORM_BASE } from "./platform.ts";

export const TENANT_RESCUE_OFFERS_PATH = `${TENANT_BASE}/rescue-offers`;
export const TENANT_DEDUCTIONS_PATH = `${TENANT_BASE}/deductions`;
export const PLATFORM_RESCUES_PATH = `${PLATFORM_BASE}/rescues`;
const TENANT_ORDERS_PATH = `${TENANT_BASE}/orders`;
const PLATFORM_ORDERS_PATH = `${PLATFORM_BASE}/orders`;

/** 怎么算的（原结算币种的最小单位）：违约金有阶梯和比例，救援差价有换算后的金额和相减的结果。 */
export interface DeductionBasis {
  trigger?: RescueTrigger;
  tier?: PenaltyTier;
  bp?: number;
  settlement_minor?: number;
  ms_before_service?: number;
  original_minor?: number;
  rescue_in_original_minor?: number;
  raw_minor?: number;
  same_currency?: boolean;
}

export interface TenantDeduction {
  id: string;
  order_id: string;
  order_no: string;
  service_time: string;
  kind: DeductionKind;
  amount: Money;
  status: DeductionStatus;
  basis: DeductionBasis;
  waived_at: string | null;
  waive_reason: string | null;
  created_at: string;
}

/** 订单详情里这一单和救援的关系（供应商看到的）。 */
export interface TenantOrderRescue {
  role: "original" | "rescuer";
  status: RescueStatus;
  trigger: RescueTrigger | null;
  triggered_at: string | null;
  reason: string | null;
  penalty_bp: number | null;
  penalty_tier: PenaltyTier | null;
  force_majeure: boolean;
  rescued_at: string | null;
  deductions: TenantDeduction[];
}

export interface RescueTrip {
  category: ServiceCategory;
  city_id: string;
  place_id: string | null;
  direction: "pickup" | "dropoff" | null;
  vehicle_group_id: string;
  package_hours: number | null;
  service_time: string;
  service_local: string;
  timezone: string;
  passengers: number;
  luggage: number;
  pickup: OrderPoint | null;
  dropoff: OrderPoint | null;
  addons: { addon_id: string; quantity: number }[];
  driver_language: string | null;
}

export interface OfferSettlement {
  total: Money;
  base: Money;
  adjust: Money;
  urgent: Money;
  night: Money;
  addons: Money;
  driver_language: Money;
}

export interface TenantRescueOffer {
  id: string;
  status: RescueOfferStatus;
  offered_at: string;
  expires_at: string;
  decided_at: string | null;
  decline_reason: string | null;
  trip: RescueTrip;
  product_id: string;
  product_version: number;
  vehicle_group_id: string;
  settlement: OfferSettlement;
  order_id: string | null;
}

export interface TenantRef {
  id: string;
  name: string;
}

export interface PlatformDeduction {
  id: string;
  tenant_id: string;
  kind: DeductionKind;
  amount: Money;
  status: DeductionStatus;
  basis: DeductionBasis;
  waived_at: string | null;
  waive_reason: string | null;
  created_at: string;
}

export interface PlatformRescueOffer {
  id: string;
  tenant: TenantRef;
  product_id: string;
  product_version: number;
  status: RescueOfferStatus;
  offered_by_type: "platform_user" | "system";
  offered_at: string;
  expires_at: string;
  decided_at: string | null;
  decline_reason: string | null;
  settlement: Money;
  sell: Money | null;
  markup_bp: number | null;
  position: number | null;
}

export interface PlatformRescue {
  id: string;
  order: { id: string; order_no: string; category: ServiceCategory; city_id: string; place_id: string | null; vehicle_group_id: string; service_time: string; service_local: string; timezone: string };
  trigger: RescueTrigger;
  triggered_by_type: "tenant_user" | "system" | "platform_user";
  reason: string | null;
  triggered_at: string;
  from_status: OrderStatus;
  original_tenant: TenantRef;
  original_settlement: Money;
  penalty_bp: number;
  penalty_tier: PenaltyTier;
  penalty: Money;
  status: RescueStatus;
  rescue_tenant: TenantRef | null;
  rescue_settlement: Money | null;
  rescued_via: "offer" | "manual" | null;
  rescued_at: string | null;
  force_majeure: { at: string; by: string; note: string } | null;
  closed_at: string | null;
  offers: PlatformRescueOffer[];
  deductions: PlatformDeduction[];
  version: number;
}

export interface RescueAlert {
  order_id: string;
  order_no: string;
  tenant: TenantRef;
  status: OrderStatus;
  service_time: string;
  arrival_overdue_at: string | null;
  driver_missing_reported_at: string | null;
}

export interface RescueQueue {
  items: PlatformRescue[];
  alerts: RescueAlert[];
  suspended_tenants: { tenant: TenantRef; future_orders: number }[];
}

export interface RescueCandidate {
  tenant: TenantRef;
  product_id: string;
  product_version: number;
  settlement: Money;
  sell: Money;
  markup_bp: number;
  position: number;
  in_band: boolean;
  difference: Money | null;
  urgent: boolean;
}

export interface RescueCandidates {
  rescue_id: string;
  candidates: RescueCandidate[];
  excluded: { tenant: TenantRef; product_id: string | null; reason: string }[];
}

// ---- 供应商 ----

export function declareUnable(token: string, orderId: string, reason: string): Promise<{ rescue: TenantOrderRescue }> {
  return apiRequest("POST", `${TENANT_ORDERS_PATH}/${encodeURIComponent(orderId)}/declare-unable`, { token, body: { reason } });
}

export function listRescueOffers(token: string, pendingOnly: boolean): Promise<{ items: TenantRescueOffer[] }> {
  return apiRequest("GET", query(TENANT_RESCUE_OFFERS_PATH, pendingOnly ? { status: "pending" } : {}), { token });
}

export function acceptRescueOffer(token: string, offerId: string): Promise<{ offer: TenantRescueOffer; order_id: string }> {
  return apiRequest("POST", `${TENANT_RESCUE_OFFERS_PATH}/${encodeURIComponent(offerId)}/accept`, { token });
}

export function declineRescueOffer(token: string, offerId: string, reason: string | null): Promise<{ offer: TenantRescueOffer }> {
  return apiRequest("POST", `${TENANT_RESCUE_OFFERS_PATH}/${encodeURIComponent(offerId)}/decline`, { token, body: { reason } });
}

export function listDeductions(token: string, orderId?: string): Promise<{ items: TenantDeduction[] }> {
  return apiRequest("GET", query(TENANT_DEDUCTIONS_PATH, orderId === undefined ? {} : { order_id: orderId }), { token });
}

// ---- 运营后台 ----

const platformOrder = (id: string): string => `${PLATFORM_ORDERS_PATH}/${encodeURIComponent(id)}`;

export function getRescueQueue(token: string, state: "open" | "closed"): Promise<RescueQueue> {
  return apiRequest("GET", query(PLATFORM_RESCUES_PATH, { state }), { token });
}

export function triggerRescue(token: string, orderId: string, body: { trigger: RescueTrigger; note: string }): Promise<{ rescue: PlatformRescue }> {
  return apiRequest("POST", `${platformOrder(orderId)}/rescue`, { token, body });
}

export function getRescueCandidates(token: string, orderId: string): Promise<RescueCandidates> {
  return apiRequest("GET", `${platformOrder(orderId)}/rescue/candidates`, { token });
}

export function offerRescue(token: string, orderId: string, tenantId: string | null): Promise<{ offer: PlatformRescueOffer }> {
  return apiRequest("POST", `${platformOrder(orderId)}/rescue/offers`, { token, body: { tenant_id: tenantId } });
}

export function requestManualAssign(token: string, orderId: string, body: { tenant_id: string; product_id: string; settlement_amount: number; note: string }): Promise<{ approval: Approval }> {
  return apiRequest("POST", `${platformOrder(orderId)}/rescue/manual-assign`, { token, body });
}

export function markForceMajeure(token: string, orderId: string, note: string): Promise<{ rescue: PlatformRescue; waived: number }> {
  return apiRequest("POST", `${platformOrder(orderId)}/rescue/force-majeure`, { token, body: { note } });
}

export function rescueSuspendedTenant(token: string, tenantId: string, note: string | null): Promise<{ triggered: string[]; skipped: { order_id: string; code: string }[] }> {
  return apiRequest("POST", `${PLATFORM_BASE}/tenants/${encodeURIComponent(tenantId)}/rescue`, { token, body: { note } });
}

/** 合同测试用：前端读的字段（必须和 openapi.yaml 里这几个结构的字段一模一样）。 */
export const RESCUE_SCHEMA_FIELDS = {
  TenantDeduction: ["id", "order_id", "order_no", "service_time", "kind", "amount", "status", "basis", "waived_at", "waive_reason", "created_at"],
  TenantOrderRescue: ["role", "status", "trigger", "triggered_at", "reason", "penalty_bp", "penalty_tier", "force_majeure", "rescued_at", "deductions"],
  RescueTrip: ["category", "city_id", "place_id", "direction", "vehicle_group_id", "package_hours", "service_time", "service_local", "timezone", "passengers", "luggage", "pickup", "dropoff", "addons", "driver_language"],
  TenantRescueOffer: ["id", "status", "offered_at", "expires_at", "decided_at", "decline_reason", "trip", "product_id", "product_version", "vehicle_group_id", "settlement", "order_id"],
  PlatformDeduction: ["id", "tenant_id", "kind", "amount", "status", "basis", "waived_at", "waive_reason", "created_at"],
  PlatformRescueOffer: ["id", "tenant", "product_id", "product_version", "status", "offered_by_type", "offered_at", "expires_at", "decided_at", "decline_reason", "settlement", "sell", "markup_bp", "position"],
  PlatformRescue: ["id", "order", "trigger", "triggered_by_type", "reason", "triggered_at", "from_status", "original_tenant", "original_settlement", "penalty_bp", "penalty_tier", "penalty", "status", "rescue_tenant", "rescue_settlement", "rescued_via", "rescued_at", "force_majeure", "closed_at", "offers", "deductions", "version"],
  RescueCandidate: ["tenant", "product_id", "product_version", "settlement", "sell", "markup_bp", "position", "in_band", "difference", "urgent"],
} as const;
