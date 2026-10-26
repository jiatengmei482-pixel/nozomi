/**
 * 派车、司机和车辆、订单、推给供应商的 Webhook、司机 H5 的接口（M3-02，ADR 0027）。
 * 字段与 `apps/api/openapi.yaml` 对齐，由 dispatch.contract.test.ts 保证。
 *
 * - 派车 / 重新生成司机链接的应答里有司机链接的令牌、新建 / 换 Webhook 签名密钥的应答里有密钥原文：都只在这一次应答里出现。
 *   这里原样交给页面，不缓存、不打日志、不自动重试。
 * - 供应商的接口里没有对外价和加价比例（规则 4）；司机 H5 的接口里没有任何价格。
 */
import type { DriverStatus, OrderStatus, PlateType, TenantWebhookEvent, VehicleStatus } from "@nozomi/domain";
import { query, TENANT_BASE } from "./areas.ts";
import { apiDownload, apiRequest, apiUpload } from "./client.ts";
import { PLATFORM_BASE } from "./platform.ts";
import type { ExtraCharge, OrderCancelPolicy, OrderChange, TenantCancellation } from "./order-money.ts";

export const ORDERS_PATH = `${TENANT_BASE}/orders`;
export const DRIVERS_PATH = `${TENANT_BASE}/drivers`;
export const VEHICLES_PATH = `${TENANT_BASE}/vehicles`;
export const WEBHOOK_PATH = `${TENANT_BASE}/webhooks`;
export const PLATFORM_DELIVERIES_PATH = `${PLATFORM_BASE}/webhook-deliveries`;
export const DRIVER_TRIP_PATH = "/driver/v1/trip";

export interface ListPage<T> {
  items: T[];
  next_cursor: string | null;
  total: number;
}

export interface Money {
  amount: string;
  currency: string;
}

export type ExpiryState = "valid" | "expiring" | "expired";

export interface Driver {
  id: string;
  name: string;
  phone: string;
  languages: string[];
  license_expires_on: string;
  license_state: ExpiryState;
  driving_years: number | null;
  gold: boolean;
  status: DriverStatus;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface DriverInput {
  name: string;
  phone: string;
  languages: string[];
  license_expires_on: string;
  driving_years: number | null;
  gold: boolean;
  status: DriverStatus;
}

export interface Vehicle {
  id: string;
  plate: string;
  vehicle_group_id: string;
  model: string;
  color: string;
  seats: number;
  mileage_km: number;
  is_new: boolean;
  plate_type: PlateType;
  insurance_expires_on: string;
  insurance_state: ExpiryState;
  inspection_expires_on: string;
  inspection_state: ExpiryState;
  status: VehicleStatus;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface VehicleInput {
  plate: string;
  vehicle_group_id: string;
  model: string;
  color: string;
  seats: number;
  mileage_km: number;
  plate_type: PlateType;
  insurance_expires_on: string;
  inspection_expires_on: string;
  status: VehicleStatus;
}

export interface OrderPoint {
  lng: number;
  lat: number;
  address: string;
}

export interface OrderDispatch {
  due_at: string | null;
  overdue: boolean;
  overdue_at: string | null;
  escalation_at: string | null;
  departure_due_at: string | null;
  departure_overdue_at: string | null;
  assigned_at: string | null;
  driver: { id: string; name: string; phone: string; languages: string[]; gold: boolean } | null;
  vehicle: { id: string; plate: string; vehicle_group_id: string; model: string; color: string; seats: number; is_new: boolean } | null;
}

export interface OrderFulfilment {
  departed_at: string | null;
  arrived_at: string | null;
  arrival_distance_m: number | null;
  arrival_within_range: boolean | null;
  picked_up_at: string | null;
  completed_at: string | null;
  actual_minutes: number | null;
  actual_km: number | null;
  leave_requested_at: string | null;
}

export type LandingSource = "guest" | "driver" | "scheduled";

export interface OrderLanding {
  scheduled_at: string;
  guest_reported_at: string | null;
  driver_reported_at: string | null;
  driver_photo_file_id: string | null;
  landed_at: string;
  source: LandingSource;
  disagreement: boolean;
  delay_minutes: number;
  within_delay_allowance: boolean;
}

export interface TenantOrder {
  id: string;
  order_no: string;
  status: OrderStatus;
  category: "airport_transfer" | "point_to_point" | "charter";
  city_id: string;
  place_id: string | null;
  direction: "pickup" | "dropoff" | null;
  vehicle_group_id: string;
  package_hours: number | null;
  service_time: string;
  service_local: string;
  timezone: string;
  service_date: string;
  urgent: boolean;
  passengers: number;
  luggage: number;
  pickup: OrderPoint | null;
  dropoff: OrderPoint | null;
  addons: { addon_id: string; quantity: number }[];
  driver_language: string | null;
  flight_no: string | null;
  passenger: { name: string; phone: string; email: string };
  messaging: { app: string; handle: string } | null;
  notes: string | null;
  free_wait_minutes: number | null;
  created_at: string;
  confirmed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  product_id: string;
  product_version: number;
  settlement: { total: Money; base: Money; adjust: Money; urgent: Money; night: Money; addons: Money; driver_language: Money };
  dispatch: OrderDispatch;
  fulfilment: OrderFulfilment;
  landing: OrderLanding | null;
  /** 这一单适用的取消阶梯（下单时的平台政策，M3-03）；之前下的单为 null */
  cancel_policy: OrderCancelPolicy | null;
  /** 取消的结果：扣款比例和你应得的（M3-03）；没取消为 null */
  cancellation: TenantCancellation | null;
  version: number;
}

export interface OrderEvent {
  from_status: OrderStatus | null;
  to_status: OrderStatus;
  actor: string;
  reason: string | null;
  occurred_at: string;
}

export type OrderFileKind = "arrival_screen" | "signboard" | "contact_screenshot" | "receipt";

export interface OrderFile {
  id: string;
  kind: OrderFileKind;
  content_type: string;
  byte_size: number;
  uploaded_at: string;
}

export interface OrderContact {
  id: string;
  method: "phone" | "messaging";
  note: string | null;
  file_id: string | null;
  occurred_at: string;
}

export interface NoShowChecklistItem {
  item: "arrived_on_time_nearby" | "contact_attempts" | "signboard_photo" | "leave_consented" | "submitted_in_time";
  ok: boolean;
  name?: string;
}

export interface OrderRecords {
  assignments: { id: string; driver_id: string; vehicle_id: string; is_change: boolean; conflict_confirmed: boolean; assigned_at: string }[];
  driver_link: { id: string; status: "active" | "expired"; created_at: string; expires_at: string; last_used_at: string | null } | null;
  files: OrderFile[];
  contacts: OrderContact[];
  locations: { kind: string; lng: number; lat: number; accuracy_m: number | null; recorded_at: string }[];
  no_show_claim: { status: "pending_review"; submitted_at: string; free_wait_start: string; free_wait_end: string; checklist: NoShowChecklistItem[] } | null;
}

export interface TenantOrderDetail {
  order: TenantOrder;
  events: OrderEvent[];
  records: OrderRecords;
  /** 改单、事后加收（M3-03） */
  changes: OrderChange[];
  extra_charges: ExtraCharge[];
}

export interface AssignmentIssue {
  code: string;
  message: string;
}

export interface AssignmentConflict {
  resource: "driver" | "vehicle";
  resource_id: string;
  order_id: string;
  order_no: string;
  service_time: string;
}

export interface Assignable {
  order_id: string;
  drivers: { driver: Driver; assignable: boolean; issues: AssignmentIssue[]; conflicts: AssignmentConflict[] }[];
  vehicles: { vehicle: Vehicle; assignable: boolean; issues: AssignmentIssue[]; conflicts: AssignmentConflict[] }[];
}

export interface IssuedDriverLink {
  token: string;
  path: string;
  created_at: string;
  expires_at: string;
}

export interface AssignResult {
  order: TenantOrder;
  change: boolean | null;
  driver_link: IssuedDriverLink | null;
}

export type FulfilmentEventType = "departed" | "arrived" | "picked_up" | "completed";

export interface ReportedLocation {
  lng: number;
  lat: number;
  accuracy_m: number | null;
}

// ---- 订单 ----

export interface OrderListQuery {
  status?: OrderStatus;
  dispatch?: "unassigned" | "overdue";
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
}

const order = (id: string): string => `${ORDERS_PATH}/${encodeURIComponent(id)}`;

export function listOrders(token: string, values: OrderListQuery): Promise<ListPage<TenantOrder>> {
  return apiRequest("GET", query(ORDERS_PATH, values), { token });
}

export function getOrder(token: string, id: string): Promise<TenantOrderDetail> {
  return apiRequest("GET", order(id), { token });
}

export function getAssignable(token: string, id: string): Promise<Assignable> {
  return apiRequest("GET", `${order(id)}/assignable`, { token });
}

export function assignOrder(token: string, id: string, version: number, body: { driver_id: string; vehicle_id: string; confirm_conflicts?: boolean }): Promise<AssignResult> {
  return apiRequest("POST", `${order(id)}/assign`, { token, body, headers: { "if-match": `"${version}"` } });
}

export function reissueDriverLink(token: string, id: string): Promise<{ driver_link: IssuedDriverLink }> {
  return apiRequest("POST", `${order(id)}/driver-link`, { token });
}

export function revokeDriverLink(token: string, id: string): Promise<void> {
  return apiRequest("DELETE", `${order(id)}/driver-link`, { token });
}

export function reportFulfilment(token: string, id: string, body: { type: FulfilmentEventType; location?: ReportedLocation | null; actual?: { minutes: number | null; km: number | null } | null }): Promise<{ order: TenantOrder }> {
  return apiRequest("POST", `${order(id)}/events`, { token, body });
}

/** 订单的一张照片（到达屏、举牌、联系截图）：图片原文，页面用 `URL.createObjectURL` 显示。 */
export async function getOrderFile(token: string, orderId: string, fileId: string, portal: "tenant" | "platform" = "tenant"): Promise<Blob> {
  const base = portal === "tenant" ? ORDERS_PATH : `${PLATFORM_BASE}/orders`;
  return (await apiDownload(`${base}/${encodeURIComponent(orderId)}/files/${encodeURIComponent(fileId)}`, { token, headers: { accept: "image/*, application/json" } })).blob;
}

// ---- 司机、车辆 ----

export interface FleetQuery {
  status?: string;
  q?: string;
  limit?: number;
  cursor?: string;
}

export function listDrivers(token: string, values: FleetQuery): Promise<ListPage<Driver>> {
  return apiRequest("GET", query(DRIVERS_PATH, values), { token });
}

export function createDriver(token: string, body: DriverInput, idempotencyKey: string): Promise<Driver> {
  return apiRequest("POST", DRIVERS_PATH, { token, body, headers: { "idempotency-key": idempotencyKey } });
}

export function updateDriver(token: string, id: string, version: number, body: DriverInput): Promise<Driver> {
  return apiRequest("PUT", `${DRIVERS_PATH}/${encodeURIComponent(id)}`, { token, body, headers: { "if-match": `"${version}"` } });
}

export function disableDriver(token: string, id: string): Promise<Driver> {
  return apiRequest("DELETE", `${DRIVERS_PATH}/${encodeURIComponent(id)}`, { token });
}

export function listVehicles(token: string, values: FleetQuery): Promise<ListPage<Vehicle>> {
  return apiRequest("GET", query(VEHICLES_PATH, values), { token });
}

export function createVehicle(token: string, body: VehicleInput, idempotencyKey: string): Promise<Vehicle> {
  return apiRequest("POST", VEHICLES_PATH, { token, body, headers: { "idempotency-key": idempotencyKey } });
}

export function updateVehicle(token: string, id: string, version: number, body: VehicleInput): Promise<Vehicle> {
  return apiRequest("PUT", `${VEHICLES_PATH}/${encodeURIComponent(id)}`, { token, body, headers: { "if-match": `"${version}"` } });
}

export function disableVehicle(token: string, id: string): Promise<Vehicle> {
  return apiRequest("DELETE", `${VEHICLES_PATH}/${encodeURIComponent(id)}`, { token });
}

// ---- Webhook ----

export interface TenantWebhook {
  url: string;
  events: TenantWebhookEvent[];
  status: "active" | "paused";
  secret_hint: string;
  secret_created_at: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface WebhookSettings {
  webhook: TenantWebhook | null;
  encryption_configured: boolean;
  events: { event: TenantWebhookEvent; name: string }[];
  rules: { timeout_ms: number; max_attempts: number; retry_delays_seconds: number[]; signature_tolerance_seconds: number };
}

export interface WebhookSaved {
  webhook: TenantWebhook;
  /** 签名密钥原文：只在新建和换密钥的这一次应答里有 */
  secret: string | null;
}

export type DeliveryStatus = "pending" | "succeeded" | "failed";

export interface WebhookDelivery {
  id: string;
  event_id: string;
  event_type: string;
  order_id: string | null;
  data: Record<string, unknown>;
  status: DeliveryStatus;
  attempts: number;
  next_attempt_at: string | null;
  last_attempt_at: string | null;
  last_status_code: number | null;
  last_error_code: string | null;
  last_duration_ms: number | null;
  succeeded_at: string | null;
  failed_at: string | null;
  created_at: string;
}

export interface PlatformWebhookDelivery extends WebhookDelivery {
  tenant: { id: string; name: string };
}

export interface WebhookAttempt {
  attempt_no: number;
  trigger: "schedule" | "manual" | "test";
  started_at: string;
  duration_ms: number;
  status_code: number | null;
  error_code: string | null;
  target_host: string;
  request_bytes: number;
  request_sha256: string;
}

export function getWebhookSettings(token: string): Promise<WebhookSettings> {
  return apiRequest("GET", WEBHOOK_PATH, { token });
}

export function saveWebhook(token: string, version: number | null, body: { url: string; events: TenantWebhookEvent[]; status: "active" | "paused" }): Promise<WebhookSaved> {
  return apiRequest("PUT", WEBHOOK_PATH, { token, body, ...(version === null ? {} : { headers: { "if-match": `"${version}"` } }) });
}

export function deleteWebhook(token: string): Promise<void> {
  return apiRequest("DELETE", WEBHOOK_PATH, { token });
}

export function rotateWebhookSecret(token: string): Promise<WebhookSaved> {
  return apiRequest("POST", `${WEBHOOK_PATH}/rotate-secret`, { token });
}

export function sendWebhookTest(token: string): Promise<{ delivery: WebhookDelivery; attempt: WebhookAttempt }> {
  return apiRequest("POST", `${WEBHOOK_PATH}/test`, { token });
}

export function listDeliveries(token: string, values: { status?: DeliveryStatus; order_id?: string; limit?: number; cursor?: string }): Promise<ListPage<WebhookDelivery>> {
  return apiRequest("GET", query(`${WEBHOOK_PATH}/deliveries`, values), { token });
}

/** 手动重推的结果：发了一次 / 推送任务正在发、这次什么都没做 / 设置已删除或暂停、没发。 */
export type WebhookRetryResult = "sent" | "in_flight" | "not_configured";

export function retryDelivery(token: string, id: string): Promise<{ delivery: WebhookDelivery; result: WebhookRetryResult }> {
  return apiRequest("POST", `${WEBHOOK_PATH}/deliveries/${encodeURIComponent(id)}/retry`, { token });
}

export function listPlatformDeliveries(token: string, values: { status?: DeliveryStatus; tenant_id?: string; limit?: number; cursor?: string }): Promise<ListPage<PlatformWebhookDelivery>> {
  return apiRequest("GET", query(PLATFORM_DELIVERIES_PATH, values), { token });
}

export function retryPlatformDelivery(token: string, id: string): Promise<{ delivery: WebhookDelivery; result: WebhookRetryResult }> {
  return apiRequest("POST", `${PLATFORM_DELIVERIES_PATH}/${encodeURIComponent(id)}/retry`, { token });
}

// ---- 司机 H5 ----

export interface DriverTrip {
  order: {
    order_no: string;
    status: OrderStatus;
    status_name: string;
    category: "airport_transfer" | "point_to_point" | "charter";
    direction: "pickup" | "dropoff" | null;
    service_time: string;
    service_local: string;
    timezone: string;
    package_hours: number | null;
    passengers: number;
    luggage: number;
    flight_no: string | null;
    passenger: { name: string; phone: string };
    messaging: { app: string; handle: string } | null;
    notes: string | null;
    place: { name: Record<string, string>; code: string | null; lng: number; lat: number } | null;
    pickup: OrderPoint | null;
    dropoff: OrderPoint | null;
    pickup_point: { lng: number; lat: number } | null;
    addons: { addon_id: string; quantity: number; name: Record<string, string> | null }[];
    driver_language: string | null;
    free_wait_minutes: number | null;
  };
  driver: { name: string } | null;
  vehicle: { plate: string; model: string; color: string } | null;
  dispatchers: { name: string; phone: string }[];
  fulfilment: { departed_at: string | null; arrived_at: string | null; arrival_distance_m: number | null; picked_up_at: string | null; completed_at: string | null; leave_requested_at: string | null };
  landing: OrderLanding | null;
  free_wait: { start: string; end: string | null; ended: boolean };
  contacts: OrderContact[];
  files: OrderFile[];
  no_show: { checklist: NoShowChecklistItem[]; complete: boolean; leave_consent_at: string | null; submitted_at: string | null };
  link: { expires_at: string };
  server_time: string;
}

export function getDriverTrip(token: string): Promise<DriverTrip> {
  return apiRequest("GET", DRIVER_TRIP_PATH, { token });
}

export function driverEvent(token: string, body: { type: FulfilmentEventType; location: ReportedLocation | null; actual?: { minutes: number | null; km: number | null } | null }): Promise<DriverTrip> {
  return apiRequest("POST", `${DRIVER_TRIP_PATH}/events`, { token, body });
}

export function driverPing(token: string, location: ReportedLocation): Promise<void> {
  return apiRequest("POST", `${DRIVER_TRIP_PATH}/locations`, { token, body: { location } });
}

export function driverLanding(token: string, body: { landed_at: string; file_id: string }): Promise<DriverTrip> {
  return apiRequest("POST", `${DRIVER_TRIP_PATH}/landing`, { token, body });
}

export function driverContact(token: string, body: { method: "phone" | "messaging"; note: string | null; file_id: string | null }): Promise<DriverTrip> {
  return apiRequest("POST", `${DRIVER_TRIP_PATH}/contacts`, { token, body });
}

export function driverRequestLeave(token: string, location: ReportedLocation | null): Promise<DriverTrip> {
  return apiRequest("POST", `${DRIVER_TRIP_PATH}/request-leave`, { token, body: { location } });
}

export function driverNoShow(token: string, location: ReportedLocation | null): Promise<DriverTrip> {
  return apiRequest("POST", `${DRIVER_TRIP_PATH}/no-show`, { token, body: { location } });
}

export function uploadDriverFile(token: string, kind: OrderFileKind, file: Blob): Promise<{ file: OrderFile }> {
  return apiUpload(`${DRIVER_TRIP_PATH}/files?kind=${kind}`, file, { token, headers: { "content-type": file.type } });
}

export async function getDriverFile(token: string, fileId: string): Promise<Blob> {
  return (await apiDownload(`${DRIVER_TRIP_PATH}/files/${encodeURIComponent(fileId)}`, { token, headers: { accept: "image/*, application/json" } })).blob;
}

/** 契约测试用：各类型的字段（与 openapi.yaml 对账）。 */
export const DISPATCH_SCHEMA_FIELDS = {
  Driver: ["id", "name", "phone", "languages", "license_expires_on", "license_state", "driving_years", "gold", "status", "version", "created_at", "updated_at"],
  Vehicle: ["id", "plate", "vehicle_group_id", "model", "color", "seats", "mileage_km", "is_new", "plate_type", "insurance_expires_on", "insurance_state", "inspection_expires_on", "inspection_state", "status", "version", "created_at", "updated_at"],
  OrderDispatch: ["due_at", "overdue", "overdue_at", "escalation_at", "departure_due_at", "departure_overdue_at", "assigned_at", "driver", "vehicle"],
  OrderFulfilment: ["departed_at", "arrived_at", "arrival_distance_m", "arrival_within_range", "picked_up_at", "completed_at", "actual_minutes", "actual_km", "leave_requested_at"],
  OrderRecords: ["assignments", "driver_link", "files", "contacts", "locations", "no_show_claim"],
  OrderFile: ["id", "kind", "content_type", "byte_size", "uploaded_at"],
  IssuedDriverLink: ["token", "path", "created_at", "expires_at"],
  TenantWebhook: ["url", "events", "status", "secret_hint", "secret_created_at", "version", "created_at", "updated_at"],
  WebhookDelivery: ["id", "event_id", "event_type", "order_id", "data", "status", "attempts", "next_attempt_at", "last_attempt_at", "last_status_code", "last_error_code", "last_duration_ms", "succeeded_at", "failed_at", "created_at"],
  WebhookAttempt: ["attempt_no", "trigger", "started_at", "duration_ms", "status_code", "error_code", "target_host", "request_bytes", "request_sha256"],
  DriverTrip: ["order", "driver", "vehicle", "dispatchers", "fulfilment", "landing", "free_wait", "contacts", "files", "no_show", "link", "server_time"],
} as const;
