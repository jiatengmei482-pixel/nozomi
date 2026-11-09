/**
 * 官网（自营渠道）的接口 `/site/v1`（M3-05，ADR 0032）。不需要登录，也不持有任何渠道密钥：渠道身份在服务端。
 * 客人自己的订单凭查看令牌（`nzo_…`，在订单页地址的 `#` 后面），放进 `Authorization` 请求头。要挂 Stripe 表单时令牌从地址移到这条历史记录的 state 里（ADR 0046），不进其他存储。
 * 类型与 `apps/api/openapi.yaml` 对账（site.contract.test.ts）。
 */
import type { ExtraChargeStatus, ExtraChargeType, LocalizedText, MessagingApp, OrderChangeStatus, OrderStatus } from "@nozomi/domain";
import { apiRequest, apiStatus } from "./client.ts";
import type { MapTiles } from "./areas.ts";
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
  /** 显示地址搜索（谷歌，后端代调；M3-12，ADR 0044）；false 时只有常用地点、地图和手填 */
  address_search: boolean;
  /** 地图底图（和供应商区域页同一份配置）；null 时不显示地图选点 */
  map_tiles: MapTiles | null;
}

/** 官网卖的品类：接送机、点对点、包车（M3-10）。 */
export type SiteCategory = "airport_transfer" | "point_to_point" | "charter";

export interface SiteCity {
  id: string;
  code: string;
  name: LocalizedText;
  timezone: string;
  country_code: string;
  /** 城市中心：地图打开时先看这里 */
  center: { lat: number; lng: number };
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
  /** 客人选的附加服务和数量（M8-02）；不选可以不给 */
  addons?: SiteAddonRequest[];
}

/** 询价时选的一项附加服务（从报价的 `available_addons` 里选）。 */
export interface SiteAddonRequest {
  addon_id: string;
  quantity?: number;
}

/** 这个车型能加的一项附加服务：只有目录信息，没有单价（加了以后重新询价，看合计）。 */
export interface SiteAddonOption {
  id: string;
  code: string;
  name: LocalizedText;
  charge_unit: "per_order" | "per_item" | "per_person" | "per_duration";
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
  /** 包车：这个价里含区域加价（M8-15，ADR 0073）；只说「含区域加价」，不单列金额 */
  includes_area_surcharge?: boolean;
  price: { total: SiteMoney; fx: { rate: string; as_of: string } | null };
  free_wait_minutes: number | null;
  cancel_policy: { category: string; level: string; tiers: CancelTier[] };
  /** 这个车型还能加哪些附加服务（M8-02）；没有为空数组 */
  available_addons: SiteAddonOption[];
}

export type SiteUnavailableReason =
  | "NO_PRODUCT"
  | "OUT_OF_SERVICE_AREA"
  | "DROPOFF_REQUIRED"
  | "LEAD_TIME_TOO_SHORT"
  | "SOLD_OUT"
  | "OUTSIDE_SERVICE_TIME"
  | "SERVICE_TIME_PASSED"
  | "CAPACITY_EXCEEDED"
  | "ADDON_NOT_OFFERED"
  | "DRIVER_LANGUAGE_NOT_OFFERED"
  | "NO_ROUTE"
  | "TEMPORARILY_UNAVAILABLE"
  | "NOT_AVAILABLE";

export interface SiteQuoteResult {
  currency: string;
  quotes: SiteQuote[];
  unavailable: { vehicle_group_id: string | null; reasons: SiteUnavailableReason[] }[];
}

/** 按两个坐标报价的一端（M8-02，ADR 0069 A1）：地址文字（只校验）、坐标、地址搜索给的类型（手填、地图选点的不给）。 */
export interface SiteTripEnd {
  name: string;
  lat: number;
  lng: number;
  kind?: SitePlaceKind;
}

export interface SiteByPointsRequest {
  pickup: SiteTripEnd;
  dropoff: SiteTripEnd;
  /** 当地的用车时间 `YYYY-MM-DDTHH:mm`（接机是航班落地时间） */
  service_local: string;
  passengers: number;
  luggage?: number;
  addons?: SiteAddonRequest[];
}

/** 出发地到目的地的行车路线（谷歌 Routes，只用来给客人看，不影响价格）。 */
export interface SiteRoutePreview {
  minutes: number;
  meters: number;
  /** 路线折线（谷歌的 encoded polyline）；取不到为 null */
  polyline: string | null;
}

export interface SiteByPointsResult extends SiteQuoteResult {
  /** pickup 接机 / dropoff 送机 / point_to_point 点对点 */
  trip_type: "pickup" | "dropoff" | "point_to_point";
  airport: { id: string; code: string; name: LocalizedText; matched_by: "distance" | "kind"; distance_meters: number } | null;
  /** 按哪个城市报的价；点对点的出发地不在任何能订的城市里时为 null */
  city: { id: string; code: string; name: LocalizedText; timezone: string } | null;
  /** 最早到期的报价的有效期；没有报价为 null */
  expires_at: string | null;
  /** 取不到为 null，不影响报价 */
  route: SiteRoutePreview | null;
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
  price_difference: { kind: "charge" | "refund" | "none"; amount: SiteMoney } | null;
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
  /** 车型组当前的值；`sample_models`、`combos` 是车型标识的来源（M7-02，ADR 0068），用 `@nozomi/domain` 的 `vehicleLabel` 显示 */
  vehicle_group: { code: string; name: LocalizedText; seats: number; sample_models: string[]; combos: { passengers: number; luggage: number }[] } | null;
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
  SiteConfig: ["open", "currency", "payments", "support_phone", "address_search", "map_tiles"],
  SiteCity: ["id", "code", "name", "timezone", "country_code", "center", "categories"],
  SitePlaceCandidate: ["source", "id", "name", "address", "location", "kind"],
  SitePlaceSuggestion: ["source", "id", "name", "address", "location", "kind"],
  SiteRoutePreview: ["minutes", "meters", "polyline"],
  SiteAirport: ["id", "code", "name", "location"],
  SiteCharterPackage: ["hours"],
  SitePlace: ["id", "type", "code", "name", "address", "location"],
  SiteQuote: ["quote_id", "expires_at", "service_date", "urgent", "vehicle_group", "package", "includes_area_surcharge", "price", "free_wait_minutes", "cancel_policy", "available_addons"],
  SiteAddonOption: ["id", "code", "name", "charge_unit"],
  SiteOrderLink: ["token", "expires_at"],
  SiteOrderEnvelope: ["order", "timeline", "names"],
  SiteOrderNames: ["city", "place", "vehicle_group"],
} as const;

/** 契约测试用：订单页的车型组（`SiteOrderNames.vehicle_group`）的字段。 */
export const SITE_ORDER_VEHICLE_GROUP_FIELDS: readonly (keyof NonNullable<SiteOrderNames["vehicle_group"]>)[] = ["code", "name", "seats", "sample_models", "combos"];

export const SITE_ORDER_FIELDS: readonly (keyof SiteOrder)[] = [
  "id", "order_no", "status", "category", "city_id", "place_id", "direction", "vehicle_group_id", "package_hours", "service_time", "service_local", "timezone", "service_date", "urgent",
  "passengers", "luggage", "pickup", "dropoff", "addons", "driver_language", "flight_no", "passenger", "messaging", "notes", "free_wait_minutes", "created_at", "confirmed_at", "cancelled_at",
  "cancel_reason", "quote_id", "channel_order_no", "price", "payment_status", "payment_due_at", "winning_tenant", "driver", "vehicle", "landing", "cancel_policy", "cancellation",
  "free_cancel_available", "changes", "extra_charges", "version",
];

export const SITE_BY_POINTS_REQUEST_FIELDS: readonly (keyof SiteByPointsRequest)[] = ["pickup", "dropoff", "service_local", "passengers", "luggage", "addons"];
export const SITE_TRIP_END_FIELDS: readonly (keyof SiteTripEnd)[] = ["name", "lat", "lng", "kind"];
export const SITE_BY_POINTS_RESULT_FIELDS: readonly (keyof SiteByPointsResult)[] = ["trip_type", "airport", "city", "currency", "quotes", "unavailable", "expires_at", "route"];
export const SITE_QUOTE_REQUEST_FIELDS: readonly (keyof SiteQuoteRequest)[] = ["category", "city_id", "airport_id", "direction", "address", "pickup", "dropoff", "package_hours", "service_local", "passengers", "luggage", "addons"];
export const SITE_FX_REFERENCE_FIELDS: readonly (keyof SiteFxReference)[] = ["available", "from", "to", "rate", "as_of", "reason"];
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

/** 地点的类型：airport 机场（谷歌的类型是机场，或平台的机场、航站楼）/ other 其他。按两个坐标报价时用它认机场（M8-02）。 */
export type SitePlaceKind = "airport" | "other";

/** 地址搜索的一个候选：平台的机场、车站（排在前面）或谷歌给的地点（名称、地址、坐标、类型）。 */
export interface SitePlaceCandidate {
  source: "platform" | "google";
  id: string;
  name: string;
  address: string;
  location: { lat: number; lng: number };
  kind: SitePlaceKind;
}

/** `available` 为 false：谷歌这次用不了（没配置、到了每日上限、谷歌出错），`items` 只有平台的地点；页面退回常用地点、地图和手填。 */
export interface SitePlaceSearchResult {
  available: boolean;
  items: SitePlaceCandidate[];
}

/** 输入即提示的一个候选（M8-02）：谷歌的还没有坐标（`location` 为 null），选中后用 `getSitePlaceDetails` 取。 */
export interface SitePlaceSuggestion {
  source: "platform" | "google";
  id: string;
  name: string;
  address: string;
  location: { lat: number; lng: number } | null;
  kind: SitePlaceKind;
}

export interface SitePlaceSuggestionResult {
  available: boolean;
  items: SitePlaceSuggestion[];
}

export interface SitePlaceDetailsResult {
  available: boolean;
  place: { id: string; address: string; location: { lat: number; lng: number }; kind: SitePlaceKind } | null;
}

export interface SiteReverseResult {
  available: boolean;
  /** 这个位置的地址；查不到为 null */
  address: string | null;
}

/** `cityId` 为 null 时在官网渠道授权的全部城市里搜（M8-02）。 */
export function searchSitePlaces(cityId: string | null, query: string): Promise<SitePlaceSearchResult> {
  return apiRequest("GET", `${SITE_BASE}/places/search?${cityId === null ? "" : `city_id=${encodeURIComponent(cityId)}&`}q=${encodeURIComponent(query)}`);
}

/**
 * 按编码取一个平台地点（M8-04，新预订页的链接参数 `from=NRT`）：只在渠道授权的城市里找、只给启用的，不调谷歌；找不到 404。
 * 和后端约定的接口 `GET /site/v1/places/by-code?code=`，应答就是一个 `SitePlace`（M8-04 验收问题 1）。
 */
export function getSitePlaceByCode(code: string): Promise<SitePlace> {
  return apiRequest("GET", `${SITE_BASE}/places/by-code?code=${encodeURIComponent(code)}`);
}

/** 输入即提示：一次「输入 → 选中」用同一个 `session`（如 `crypto.randomUUID()`）。 */
export function autocompleteSitePlaces(query: string, session: string): Promise<SitePlaceSuggestionResult> {
  return apiRequest("GET", `${SITE_BASE}/places/autocomplete?q=${encodeURIComponent(query)}&session=${encodeURIComponent(session)}`);
}

/** 输入即提示选中的谷歌地点的坐标和类型（同一个 `session`）。 */
export function getSitePlaceDetails(id: string, session: string): Promise<SitePlaceDetailsResult> {
  return apiRequest("GET", `${SITE_BASE}/places/details?id=${encodeURIComponent(id)}&session=${encodeURIComponent(session)}`);
}

export function reverseSitePlace(cityId: string, point: { lat: number; lng: number }): Promise<SiteReverseResult> {
  return apiRequest("GET", `${SITE_BASE}/places/reverse?city_id=${encodeURIComponent(cityId)}&lat=${point.lat}&lng=${point.lng}`);
}

export function createSiteQuotes(body: SiteQuoteRequest): Promise<SiteQuoteResult> {
  return apiRequest("POST", `${SITE_BASE}/quotes`, { body });
}

/** 参考汇率（M8-02）：订单币种 → 客人币种，只用于显示「≈ 金额」，实际按订单币种收款。 */
export interface SiteFxReference {
  available: boolean;
  from: string;
  to: string;
  /** 1 个订单币种 ≈ 多少个客人币种（十进制字符串）；不可用为 null */
  rate: string | null;
  as_of: string | null;
  /** NO_RATE 没有汇率 / STALE 超过 48 小时没更新 / PENDING_REVIEW 有一批挂起待确认；可用为 null */
  reason: "NO_RATE" | "STALE" | "PENDING_REVIEW" | null;
}

export function getSiteFxReference(to: string): Promise<SiteFxReference> {
  return apiRequest("GET", `${SITE_BASE}/fx/reference?to=${encodeURIComponent(to)}`);
}

/** 按两个坐标报价（M8-02）：服务端认出机场和接机 / 送机 / 点对点，走同一个询价。 */
export function createSiteQuotesByPoints(body: SiteByPointsRequest): Promise<SiteByPointsResult> {
  return apiRequest("POST", `${SITE_BASE}/quotes/by-points`, { body });
}

/** 下单。`idempotencyKey` 每次「提交」生成一个；网络失败重试用同一个，不会下出两张单。 */
export function createSiteOrder(body: SiteOrderRequest, idempotencyKey: string): Promise<SiteOrderEnvelope & { payment: SitePayment | null; link: SiteLink }> {
  return apiRequest("POST", `${SITE_BASE}/orders`, { body, headers: { "idempotency-key": idempotencyKey } });
}

/**
 * 查订单（ADR 0061）：订单号 + 下单邮箱。对上了后端把新链接发到下单邮箱；应答一律 202 `{ status: "accepted" }`，
 * 不说明订单存不存在。限速 429，邮件或官网没配置 503。
 */
export function requestSiteOrderLink(orderNo: string, email: string): Promise<{ status: "accepted" }> {
  return apiRequest("POST", `${SITE_BASE}/orders/lookup`, { body: { order_no: orderNo, email } });
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

// ───────────── 路线小地图（M8-10）：后端代调谷歌静态地图，浏览器不放谷歌密钥 ─────────────

/** 路线图的尺寸范围（CSS 像素，和接口一致）；倍率 1 或 2。 */
export const SITE_ROUTE_MAP_LIMITS = { minWidth: 200, maxWidth: 640, minHeight: 150, maxHeight: 640 } as const;

export interface SiteRouteMapRequest {
  from: SitePoint;
  to: SitePoint;
  theme: "light" | "dark";
  width: number;
  height: number;
  scale: 1 | 2;
}

/**
 * 路线图的地址：`GET /site/v1/route-map`，成功是一张 PNG（灰色底图、品牌色路线和起终点），直接给 `<img>` 用
 * （同源，内容安全策略 img-src 'self' 已放行；不转成 blob: 地址）。
 */
export function siteRouteMapUrl(request: SiteRouteMapRequest): string {
  const query = new URLSearchParams({
    from_lat: request.from.lat.toFixed(6),
    from_lng: request.from.lng.toFixed(6),
    to_lat: request.to.lat.toFixed(6),
    to_lng: request.to.lng.toFixed(6),
    theme: request.theme,
    width: String(request.width),
    height: String(request.height),
    scale: String(request.scale),
  });
  return `${SITE_BASE}/route-map?${query.toString()}`;
}

/**
 * 应答是不是「平台还没开通谷歌静态地图」：503 + 全站统一错误格式 `{ error: { code: "ROUTE_MAP_UNAVAILABLE", details: { reason: "NOT_ENABLED" } } }`（ADR 0072）。
 * 其他一切（reason 为 UNAVAILABLE、429 太频繁、400、500、不是 JSON）都不算。
 */
export function isRouteMapNotEnabled(status: number, body: unknown): boolean {
  if (status !== 503 || typeof body !== "object" || body === null) return false;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return false;
  const { code, details } = error as { code?: unknown; details?: unknown };
  return code === "ROUTE_MAP_UNAVAILABLE" && typeof details === "object" && details !== null && (details as { reason?: unknown }).reason === "NOT_ENABLED";
}

/** 图片没出来以后再问一次原因：只有「还没开通」返回 true（这时用现有底图画路线）；其他任何情况（暂时不可用、太频繁、网络、不是 503）返回 false。 */
export async function siteRouteMapNotEnabled(url: string): Promise<boolean> {
  try {
    const { status, body } = await apiStatus(url);
    return isRouteMapNotEnabled(status, body);
  } catch {
    return false;
  }
}
