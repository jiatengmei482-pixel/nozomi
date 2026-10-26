/**
 * 取消、改单、事后加收、平台取消政策的接口（M3-03，ADR 0029），以及运营后台的订单列表和详情（M3-01 的只读接口，这里第一次有页面）。
 * 字段与 `apps/api/openapi.yaml` 对齐，由 order-money.contract.test.ts 保证。
 * 供应商的接口里没有客人付的金额（对外价、退款、加收的客人金额，规则 4）；运营后台的有。
 */
import type { ExtraChargeStatus, ExtraChargeType, OrderCancelReason, OrderChangeStatus, OrderStatus, PaymentStatus, RefundStatus, ServiceCategory, VehicleLevel } from "@nozomi/domain";
import { query, TENANT_BASE } from "./areas.ts";
import { apiRequest, apiUpload } from "./client.ts";
import type { ListPage, Money, OrderEvent, OrderFile } from "./dispatch.ts";
import type { Approval } from "./channels.ts";
import { PLATFORM_BASE } from "./platform.ts";
import type { PlatformRescue } from "./rescues.ts";

export const TENANT_POLICY_PATH = `${TENANT_BASE}/cancellation-policy`;
export const PLATFORM_POLICY_PATH = `${PLATFORM_BASE}/cancellation-policy`;
export const PLATFORM_ORDERS_PATH = `${PLATFORM_BASE}/orders`;
const TENANT_ORDERS_PATH = `${TENANT_BASE}/orders`;

// ---- 取消政策 ----

export interface CancelTier {
  min_hours_before: number;
  fee_bp: number;
}

export interface CancellationPolicyRule {
  category: ServiceCategory;
  level: VehicleLevel;
  tiers: CancelTier[];
}

export interface CancellationPolicy {
  version: number;
  effective_at: string | null;
  rules: CancellationPolicyRule[];
}

export interface OrderCancelPolicy {
  version: number;
  category: ServiceCategory;
  level: VehicleLevel;
  tiers: CancelTier[];
}

export function getCancellationPolicy(token: string, portal: "tenant" | "platform"): Promise<{ policy: CancellationPolicy }> {
  return apiRequest("GET", portal === "tenant" ? TENANT_POLICY_PATH : PLATFORM_POLICY_PATH, { token });
}

export function requestPolicyChange(token: string, rules: CancellationPolicyRule[], note: string | null): Promise<{ approval: Approval }> {
  return apiRequest("POST", `${PLATFORM_POLICY_PATH}/changes`, { token, body: { rules, note } });
}

// ---- 供应商：改单、加收 ----

export interface OrderChange {
  id: string;
  status: OrderChangeStatus;
  reschedule: boolean;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  settlement_before: Money;
  settlement_after: Money;
  confirm_due_at: string | null;
  requested_by: "channel" | "platform_user";
  requested_at: string;
  decided_at: string | null;
  decision_note: string | null;
  dispatch_conflict: boolean;
}

export interface ExtraCharge {
  id: string;
  type: ExtraChargeType;
  amount: Money;
  approved_amount: Money | null;
  description: string | null;
  file_ids: string[];
  status: ExtraChargeStatus;
  review_reasons: ("OVER_THRESHOLD" | "NO_EVIDENCE" | "DISPUTED")[];
  submitted_at: string;
  dispute_until: string;
  disputed_at: string | null;
  dispute_reason: string | null;
  decided_at: string | null;
  decision_note: string | null;
  charged_at: string | null;
  withdrawn_at: string | null;
  version: number;
}

/** 供应商看到的订单里取消的结果：扣款比例和自己应得的。 */
export interface TenantCancellation {
  fee_bp: number;
  tenant_share: Money;
}

const tenantOrder = (id: string): string => `${TENANT_ORDERS_PATH}/${encodeURIComponent(id)}`;

export function uploadReceipt(token: string, orderId: string, file: Blob): Promise<{ file: OrderFile }> {
  return apiUpload(`${tenantOrder(orderId)}/files?kind=receipt`, file, { token, headers: { "content-type": file.type } });
}

export interface ExtraChargeInput {
  type: ExtraChargeType;
  /** 结算币种的最小货币单位整数 */
  amount: number;
  description: string | null;
  file_ids: string[];
}

export function submitExtraCharge(token: string, orderId: string, body: ExtraChargeInput): Promise<{ extra_charge: ExtraCharge }> {
  return apiRequest("POST", `${tenantOrder(orderId)}/extra-charges`, { token, body });
}

export function withdrawExtraCharge(token: string, orderId: string, chargeId: string): Promise<{ extra_charge: ExtraCharge }> {
  return apiRequest("POST", `${tenantOrder(orderId)}/extra-charges/${encodeURIComponent(chargeId)}/withdraw`, { token });
}

export function decideChange(token: string, orderId: string, changeId: string, decision: "confirm" | "reject", note: string | null): Promise<{ change: OrderChange }> {
  return apiRequest("POST", `${tenantOrder(orderId)}/changes/${encodeURIComponent(changeId)}/${decision}`, { token, body: { note } });
}

// ---- 运营后台：订单 ----

export interface PlatformPayment {
  id: string;
  kind: "order" | "change" | "extra_charge";
  change_id: string | null;
  extra_charge_id: string | null;
  provider: "stripe";
  status: PaymentStatus;
  amount: Money;
  intent_id: string | null;
  customer_id: string | null;
  payment_method_saved: boolean;
  refunded: Money;
  disputed: boolean;
  paid_after_cancel: boolean;
  last_error: { code: string | null; decline_code: string | null; message: string | null } | null;
  save_consent_at: string;
  succeeded_at: string | null;
}

export interface PlatformCancellation {
  reason: OrderCancelReason | null;
  note: string | null;
  fee_bp: number | null;
  customer_fee: Money | null;
  tenant_share: Money | null;
}

export interface PlatformOrder {
  id: string;
  order_no: string;
  status: OrderStatus;
  category: ServiceCategory;
  direction: "pickup" | "dropoff" | null;
  vehicle_group_id: string;
  package_hours: number | null;
  service_time: string;
  service_local: string;
  timezone: string;
  passengers: number;
  luggage: number;
  pickup: { lng: number; lat: number; address: string } | null;
  dropoff: { lng: number; lat: number; address: string } | null;
  flight_no: string | null;
  passenger: { name: string; phone: string; email: string };
  messaging: { app: string; handle: string } | null;
  notes: string | null;
  created_at: string;
  confirmed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: OrderCancelReason | null;
  tenant: { id: string; name: string };
  channel: { id: string; name: string };
  channel_order_no: string | null;
  sell: Money;
  settlement: { total: Money };
  markup_bp: number;
  payment: PlatformPayment | null;
  cancel_policy: OrderCancelPolicy | null;
  cancellation: PlatformCancellation | null;
  version: number;
}

export interface PlatformRefund {
  id: string;
  payment_id: string;
  purpose: "cancellation" | "change";
  change_id: string | null;
  amount: Money;
  status: RefundStatus;
  provider_refund_id: string | null;
  retry_of: string | null;
  attempts: number;
  next_attempt_at: string | null;
  last_error: { code?: string | null; message?: string | null } | null;
  succeeded_at: string | null;
  failed_at: string | null;
  superseded_at: string | null;
  created_at: string;
}

export type PlatformOrderChange = OrderChange & { sell_before: Money | null; sell_after: Money | null };
export type PlatformExtraCharge = ExtraCharge & { customer_amount: Money; last_charge_error: { code?: string | null; decline_code?: string | null } | null; charge_attempts: number };

export interface PlatformOrderDetail {
  order: PlatformOrder;
  events: OrderEvent[];
  payments: PlatformPayment[];
  refunds: PlatformRefund[];
  changes: PlatformOrderChange[];
  extra_charges: PlatformExtraCharge[];
  /** 这一单的全部救援改派（M3-04） */
  rescues: PlatformRescue[];
}

export interface PlatformOrderQuery {
  status?: OrderStatus;
  q?: string;
  limit?: number;
  cursor?: string;
}

const platformOrder = (id: string): string => `${PLATFORM_ORDERS_PATH}/${encodeURIComponent(id)}`;

export function listPlatformOrders(token: string, values: PlatformOrderQuery): Promise<ListPage<PlatformOrder>> {
  return apiRequest("GET", query(PLATFORM_ORDERS_PATH, values), { token });
}

export function getPlatformOrder(token: string, id: string): Promise<PlatformOrderDetail> {
  return apiRequest("GET", platformOrder(id), { token });
}

export interface CancelFee {
  cancellable: boolean;
  stage?: "unpaid" | "paid";
  reason?: OrderCancelReason;
  tier_index?: number;
  hours_before_service?: number;
  fee_bp?: number;
  paid?: Money;
  fee?: Money;
  refund?: Money;
  policy?: OrderCancelPolicy | null;
  policy_fee_bp?: number;
  policy_refund?: Money;
  tenant_share?: Money;
  needs_review?: boolean;
}

export function getCancelFee(token: string, id: string, reason: OrderCancelReason, waiveFee: boolean): Promise<CancelFee> {
  return apiRequest("GET", query(`${platformOrder(id)}/cancel-fee`, { reason, waive_fee: waiveFee ? "true" : "false" }), { token });
}

export type CancelResult = { order_id: string; replayed: boolean } | { approval: Approval };

export function cancelPlatformOrder(token: string, id: string, body: { reason: OrderCancelReason; waive_fee: boolean; note: string }): Promise<CancelResult> {
  return apiRequest("POST", `${platformOrder(id)}/cancel`, { token, body });
}

export interface OrderChangeRequest {
  passenger?: { name: string; phone: string; email: string };
  flight_no?: string | null;
  notes?: string | null;
  service_time?: string;
  passengers?: number;
  luggage?: number;
}

export function changePlatformOrder(token: string, id: string, version: number, body: OrderChangeRequest): Promise<{ change: OrderChange }> {
  return apiRequest("PATCH", platformOrder(id), { token, body, headers: { "if-match": `"${version}"` } });
}

export function decideExtraCharge(token: string, orderId: string, chargeId: string, body: { decision: "approve" | "reject"; approved_amount: number | null; note: string | null }): Promise<{ extra_charge: ExtraCharge }> {
  return apiRequest("POST", `${platformOrder(orderId)}/extra-charges/${encodeURIComponent(chargeId)}/decide`, { token, body });
}

export function retryExtraCharge(token: string, orderId: string, chargeId: string): Promise<{ extra_charge: ExtraCharge }> {
  return apiRequest("POST", `${platformOrder(orderId)}/extra-charges/${encodeURIComponent(chargeId)}/retry`, { token });
}

export function retryRefund(token: string, orderId: string, refundId: string): Promise<{ outcome: string; refund: { id: string; status: RefundStatus; amount: Money } }> {
  return apiRequest("POST", `${platformOrder(orderId)}/refunds/${encodeURIComponent(refundId)}/retry`, { token });
}

/** 合同测试用：前端读的字段（必须和 openapi.yaml 里这几个结构的字段一模一样）。 */
export const ORDER_MONEY_SCHEMA_FIELDS = {
  CancellationPolicy: ["version", "effective_at", "rules"],
  CancellationPolicyRule: ["category", "level", "tiers"],
  CancelTier: ["min_hours_before", "fee_bp"],
  OrderChange: ["id", "status", "reschedule", "before", "after", "settlement_before", "settlement_after", "confirm_due_at", "requested_by", "requested_at", "decided_at", "decision_note", "dispatch_conflict"],
  ExtraCharge: ["id", "type", "amount", "approved_amount", "description", "file_ids", "status", "review_reasons", "submitted_at", "dispute_until", "disputed_at", "dispute_reason", "decided_at", "decision_note", "charged_at", "withdrawn_at", "version"],
  OrderRefund: ["id", "payment_id", "purpose", "change_id", "amount", "status", "provider_refund_id", "retry_of", "attempts", "next_attempt_at", "last_error", "succeeded_at", "failed_at", "superseded_at", "created_at"],
  PlatformOrderPayment: ["id", "kind", "change_id", "extra_charge_id", "provider", "status", "amount", "intent_id", "customer_id", "payment_method_saved", "refunded", "disputed", "paid_after_cancel", "last_error", "save_consent_at", "succeeded_at"],
} as const;
