/**
 * 官网（自营渠道）的接口 `/site/v1`（M3-05，ADR 0032）。不需要登录，也不持有任何渠道密钥：渠道身份在服务端。
 * 客人自己的订单凭查看令牌（`nzo_…`，在订单页地址的 `#` 后面），放进 `Authorization` 请求头；令牌不进任何存储。
 * 类型与 `apps/api/openapi.yaml` 对账（site.contract.test.ts）。
 */
import type { ExtraChargeStatus, ExtraChargeType, LocalizedText, MessagingApp, OrderChangeStatus, OrderStatus } from "@nozomi/domain";
import { apiRequest } from "./client.ts";
import type { CancelTier, OrderCancelPolicy } from "./order-money.ts";

export const SITE_BASE = "/site/v1";

export interface SiteMoney {
  amount: string;
  currency: string;
}

export interface SiteConfig {
  open: boolean;
  currency: string | null;
  payments: { provider: "stripe"; publishable_key: string } | null;
  /** 客服电话（登记了才有，原样显示）；null 时订单页不显示「需要帮助」区块 */
  support_phone: string | null;
}

/** 官网卖的品类：接送机、点对点、包车（M3-10）。 */
export type SiteCategory = "airport_transfer" | "point_to_point" | "charter";

export interface SiteCity {
  id: string;
  code: string;
  name: LocalizedText;
  timezone: string;
  country_code: string;
  /** 这个城市能在官网预订的品类（顺序固定：接送机、点对点、包车） */
  categories: SiteCategory[];
}

export interface SiteAirport {
  id: string;
  code: string;
  name: LocalizedText;
  location: { lng: number; lat: number };
}

export type SiteDirection = "pickup" | "dropoff";

export interface SitePoint {
  lng: number;
  lat: number;
}

/** 包车能选的套餐时长。 */
export interface SiteCharterPackage {
  hours: number;
}

/** 地址输入辅助：城市里的机场、车站、地标（主数据）。 */
export interface SitePlace {
  id: string;
  type: "airport" | "station" | "poi";
  code: string;
  name: LocalizedText;
  address: string | null;
  location: SitePoint;
}

/**
 * 询价请求。各品类填各自的字段，别的不填（后端对不该填的报 NOT_APPLICABLE）：
 * 接送机 `airport_id` + `direction` + `address`；点对点 `pickup` + `dropoff`；包车 `pickup` + `package_hours`。
 */
export interface SiteQuoteRequest {
  category: SiteCategory;
  city_id: string;
  airport_id?: string;
  direction?: SiteDirection;
  /** 接送机：地址那一端的坐标 */
  address?: SitePoint;
  /** 点对点、包车：上车点 */
  pickup?: SitePoint;
  /** 点对点：下车点 */
  dropoff?: SitePoint;
  /** 包车：套餐时长（小时） */
  package_hours?: number;
  /** 城市当地时间 `YYYY-MM-DDTHH:mm` */
  service_local: string;
  passengers: number;
  luggage: number;
}

export interface SiteVehicleGroup {
  id: string;
  code: string;
  name: LocalizedText;
  grade: string;
  seats: number;
  sample_models: string[];
  combos: { passengers: number; luggage: number }[];
}

export interface SiteQuote {
  quote_id: string;
  expires_at: string;
  service_date: string;
  urgent: boolean;
  vehicle_group: SiteVehicleGroup;
  /** 包车：套餐时长和含的公里数；其他品类 null */
  package: { hours: number; km: number | null } | null;
  price: { total: SiteMoney; fx: { rate: string; as_of: string } | null };
  free_wait_minutes: number | null;
  cancel_policy: { category: string; level: string; tiers: CancelTier[] };
}

export type SiteUnavailableReason =
  | "NO_PRODUCT"
  | "OUT_OF_SERVICE_AREA"
  | "LEAD_TIME_TOO_SHORT"
  | "SOLD_OUT"
  | "OUTSIDE_SERVICE_TIME"
  | "SERVICE_TIME_PASSED"
  | "CAPACITY_EXCEEDED"
  | "ADDON_NOT_OFFERED"
  | "DRIVER_LANGUAGE_NOT_OFFERED"
  | "NOT_AVAILABLE";

export interface SiteQuoteResult {
  currency: string;
  quotes: SiteQuote[];
  unavailable: { vehicle_group_id: string | null; reasons: SiteUnavailableReason[] }[];
}

export interface SiteOrderRequest {
  quote_id: string;
  passenger: { name: string; phone: string; email: string };
  flight_no: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  messaging: { app: MessagingApp; handle: string } | null;
  notes: string | null;
  save_payment_method: boolean;
}

export interface SiteOrderPoint {
  lng: number;
  lat: number;
  address: string;
}

export interface SiteLanding {
  scheduled_at: string;
  guest_reported_at: string | null;
  driver_reported_at: string | null;
  landed_at: string;
  source: "guest" | "driver" | "scheduled";
  disagreement: boolean;
  delay_minutes: number;
  within_delay_allowance: boolean;
}

export interface SiteOrderChange {
  id: string;
  status: OrderChangeStatus;
  fields: string[];
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  price_difference: { kind: "increase" | "decrease" | "none"; amount: SiteMoney } | null;
  confirm_due_at: string | null;
  requested_at: string;
  decided_at: string | null;
}

export interface SiteExtraCharge {
  id: string;
  type: ExtraChargeType;
  amount: SiteMoney;
  description: string | null;
  status: ExtraChargeStatus;
  submitted_at: string;
  dispute_until: string;
  dispute_open: boolean;
  disputed_at: string | null;
  charged_at: string | null;
}

/** 客人看到的订单（就是渠道看到的那一份）：没有结算价、加价比例；付款前没有中标供应商。 */
export interface SiteOrder {
  id: string;
  order_no: string;
  status: OrderStatus;
  category: "airport_transfer" | "point_to_point" | "charter";
  city_id: string;
  place_id: string | null;
  direction: SiteDirection | null;
  vehicle_group_id: string;
  package_hours: number | null;
  service_time: string;
  service_local: string;
  timezone: string;
  service_date: string;
  urgent: boolean;
  passengers: number;
  luggage: number;
  pickup: SiteOrderPoint | null;
  dropoff: SiteOrderPoint | null;
  addons: { addon_id: string; quantity: number }[];
  driver_language: string | null;
  flight_no: string | null;
  passenger: { name: string; phone: string; email: string };
  messaging: { app: MessagingApp; handle: string } | null;
  notes: string | null;
  free_wait_minutes: number | null;
  created_at: string;
  confirmed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  quote_id: string;
  channel_order_no: string | null;
  price: { total: SiteMoney; fx: { rate: string; as_of: string } | null };
  payment_status: string;
  payment_due_at: string;
  winning_tenant: { name: string } | null;
  driver: { name: string; languages: string[]; phone: string | null } | null;
  vehicle: { plate: string; model: string | null; color: string | null; vehicle_group_id: string } | null;
  landing: SiteLanding | null;
  cancel_policy: OrderCancelPolicy | null;
  cancellation: { reason: string | null; fee_bp: number | null; fee: SiteMoney | null; refund: SiteMoney; refund_status: "pending" | "succeeded" | "failed" | null } | null;
  free_cancel_available: boolean;
  changes: SiteOrderChange[];
  extra_charges: SiteExtraCharge[];
  version: number;
}

export interface SiteTimelineEntry {
  from_status: OrderStatus | null;
  to_status: OrderStatus;
  reason: string | null;
  occurred_at: string;
}

export interface SiteOrderNames {
  city: { code: string; name: LocalizedText } | null;
  place: { code: string; name: LocalizedText; type: string } | null;
  vehicle_group: { code: string; name: LocalizedText; seats: number } | null;
}

export interface SiteOrderEnvelope {
  order: SiteOrder;
  timeline: SiteTimelineEntry[];
  names: SiteOrderNames;
}

export interface SitePayment {
  provider: "stripe";
  status: string;
  client_secret: string | null;
  publishable_key: string;
}

export interface SiteLink {
  token: string;
  expires_at: string;
}

export interface SiteCancelFee {
  cancellable: boolean;
  stage?: "unpaid" | "paid";
  reason?: string;
  tier_index?: number;
  hours_before_service?: number;
  fee_bp?: number;
  paid?: SiteMoney;
  fee?: SiteMoney;
  refund?: SiteMoney;
  policy?: OrderCancelPolicy;
}

export type SiteCancelReason = "GUEST_REQUEST" | "CHANGE_NOT_CONFIRMED";

/** 客人能改的字段（ADR 0029）：只给要改的。 */
export interface SiteChangeRequest {
  passenger?: { name: string; phone: string; email: string };
  flight_no?: string | null;
  notes?: string | null;
  pickup_address?: string;
  dropoff_address?: string;
  service_time?: string;
  passengers?: number;
  luggage?: number;
}

/** 契约测试用：这些类型的字段要和 openapi.yaml 里的定义完全一致。 */
export const SITE_SCHEMA_FIELDS = {
  SiteConfig: ["open", "currency", "payments", "support_phone"],
  SiteCity: ["id", "code", "name", "timezone", "country_code", "categories"],
  SiteAirport: ["id", "code", "name", "location"],
  SiteCharterPackage: ["hours"],
  SitePlace: ["id", "type", "code", "name", "address", "location"],
  SiteQuote: ["quote_id", "expires_at", "service_date", "urgent", "vehicle_group", "package", "price", "free_wait_minutes", "cancel_policy"],
  SiteOrderLink: ["token", "expires_at"],
  SiteOrderEnvelope: ["order", "timeline", "names"],
  SiteOrderNames: ["city", "place", "vehicle_group"],
} as const;

export const SITE_ORDER_FIELDS: readonly (keyof SiteOrder)[] = [
  "id", "order_no", "status", "category", "city_id", "place_id", "direction", "vehicle_group_id", "package_hours", "service_time", "service_local", "timezone", "service_date", "urgent",
  "passengers", "luggage", "pickup", "dropoff", "addons", "driver_language", "flight_no", "passenger", "messaging", "notes", "free_wait_minutes", "created_at", "confirmed_at", "cancelled_at",
  "cancel_reason", "quote_id", "channel_order_no", "price", "payment_status", "payment_due_at", "winning_tenant", "driver", "vehicle", "landing", "cancel_policy", "cancellation",
  "free_cancel_available", "changes", "extra_charges", "version",
];

export const SITE_QUOTE_REQUEST_FIELDS: readonly (keyof SiteQuoteRequest)[] = ["category", "city_id", "airport_id", "direction", "address", "pickup", "dropoff", "package_hours", "service_local", "passengers", "luggage"];
export const SITE_ORDER_REQUEST_FIELDS: readonly (keyof SiteOrderRequest)[] = ["quote_id", "passenger", "flight_no", "pickup_address", "dropoff_address", "messaging", "notes", "save_payment_method"];

const guest = (token: string) => ({ token });

export function getSiteConfig(): Promise<SiteConfig> {
  return apiRequest("GET", `${SITE_BASE}/config`);
}

export function listSiteCities(): Promise<{ items: SiteCity[] }> {
  return apiRequest("GET", `${SITE_BASE}/cities`);
}

export function listSiteAirports(cityId: string): Promise<{ items: SiteAirport[] }> {
  return apiRequest("GET", `${SITE_BASE}/cities/${encodeURIComponent(cityId)}/airports`);
}

export function listSiteCharterPackages(cityId: string): Promise<{ items: SiteCharterPackage[] }> {
  return apiRequest("GET", `${SITE_BASE}/cities/${encodeURIComponent(cityId)}/charter-packages`);
}

export function listSitePlaces(cityId: string): Promise<{ items: SitePlace[] }> {
  return apiRequest("GET", `${SITE_BASE}/cities/${encodeURIComponent(cityId)}/places`);
}

export function createSiteQuotes(body: SiteQuoteRequest): Promise<SiteQuoteResult> {
  return apiRequest("POST", `${SITE_BASE}/quotes`, { body });
}

/** 下单。`idempotencyKey` 每次「提交」生成一个；网络失败重试用同一个，不会下出两张单。 */
export function createSiteOrder(body: SiteOrderRequest, idempotencyKey: string): Promise<SiteOrderEnvelope & { payment: SitePayment | null; link: SiteLink }> {
  return apiRequest("POST", `${SITE_BASE}/orders`, { body, headers: { "idempotency-key": idempotencyKey } });
}

export function lookupSiteOrder(orderNo: string, contact: string): Promise<{ link: SiteLink }> {
  return apiRequest("POST", `${SITE_BASE}/orders/lookup`, { body: { order_no: orderNo, contact } });
}

export function getSiteOrder(token: string): Promise<SiteOrderEnvelope> {
  return apiRequest("GET", `${SITE_BASE}/order`, guest(token));
}

export function getSiteOrderPayment(token: string): Promise<{ payment: SitePayment }> {
  return apiRequest("GET", `${SITE_BASE}/order/payment`, guest(token));
}

export function getSiteCancelFee(token: string, reason: SiteCancelReason): Promise<SiteCancelFee> {
  return apiRequest("GET", `${SITE_BASE}/order/cancel-fee?reason=${reason}`, guest(token));
}

export function cancelSiteOrder(token: string, reason: SiteCancelReason): Promise<SiteOrderEnvelope & { replayed: boolean }> {
  return apiRequest("POST", `${SITE_BASE}/order/cancel`, { ...guest(token), body: { reason } });
}

export function changeSiteOrder(token: string, version: number, body: SiteChangeRequest): Promise<SiteOrderEnvelope & { change: SiteOrderChange | null }> {
  return apiRequest("PATCH", `${SITE_BASE}/order`, { ...guest(token), body, headers: { "if-match": `"${version}"` } });
}

export function reportSiteLanded(token: string): Promise<SiteOrderEnvelope> {
  return apiRequest("POST", `${SITE_BASE}/order/landed`, guest(token));
}

export function disputeSiteExtraCharge(token: string, chargeId: string, reason: string): Promise<SiteOrderEnvelope & { extra_charge: SiteExtraCharge | null }> {
  return apiRequest("POST", `${SITE_BASE}/order/extra-charges/${encodeURIComponent(chargeId)}/dispute`, { ...guest(token), body: { reason } });
}

// ---- 投诉和反馈（M4-03，ADR 0034）：客人凭订单链接提工单、看结论和平台的回复 ----

/** 客人能提的工单类型（接口 `/site/v1/order/tickets` 只认这四种）。 */
export const SITE_TICKET_TYPES = ["complaint", "order_change", "lost_and_found", "other"] as const;
export type SiteTicketType = (typeof SITE_TICKET_TYPES)[number];

export interface SiteTicket {
  id: string;
  ticket_no: string;
  type: string;
  source: "guest" | "channel";
  subject: string;
  status: string;
  outcome: string | null;
  decided_at: string | null;
  created_at: string;
  /** 平台写给客人的回复，按时间先后 */
  replies: { body: string; created_at: string }[];
  compensation: { scenario: string; compensation: SiteMoney; reimbursement: SiteMoney; refund: SiteMoney; other_payout: SiteMoney; payout_status: "none" | "pending" | "paid" } | null;
}

export const SITE_TICKET_FIELDS: readonly (keyof SiteTicket)[] = ["id", "ticket_no", "type", "source", "subject", "status", "outcome", "decided_at", "created_at", "replies", "compensation"];

export function listSiteTickets(token: string): Promise<{ items: SiteTicket[] }> {
  return apiRequest("GET", `${SITE_BASE}/order/tickets`, guest(token));
}

export function createSiteTicket(token: string, body: { type: SiteTicketType; subject: string; description: string; language: string | null }): Promise<{ ticket: SiteTicket }> {
  return apiRequest("POST", `${SITE_BASE}/order/tickets`, { ...guest(token), body });
}
