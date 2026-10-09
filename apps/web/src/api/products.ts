/**
 * 供应商后台：子品牌、商品（基础信息、服务规则、商品详情）、上架检查、上下架。
 * 类型手写，与 `apps/api/openapi.yaml` 对账（`products.contract.test.ts`）。金额都是子品牌币种的最小货币单位整数。
 */
import type { AreaBizType, FlightScope, LocalizedText, MasterDataStatus, NightChargeUnit, PlaceType, ProductStatus, ServiceCategory, VehicleCombo, VehicleGrade } from "@nozomi/domain";
import { AREAS_PATH, type AreaSummary, TENANT_BASE, listAll, query } from "./areas.ts";
import { apiRequest } from "./client.ts";
import type { Addon, MasterPage, Place, VehicleGroup } from "./master.ts";

export const BRANDS_PATH = `${TENANT_BASE}/brands`;
export const PRODUCTS_PATH = `${TENANT_BASE}/products`;

export interface Brand {
  id: string;
  name: string;
  currency: string;
  status: MasterDataStatus;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface ProductBrandRef {
  id: string;
  name: string;
  currency: string;
  status: MasterDataStatus;
}

export interface ProductCityRef {
  id: string;
  code: string;
  name: LocalizedText;
  country_code: string;
  timezone: string;
  status: MasterDataStatus;
}

export interface ProductPlaceRef {
  id: string;
  code: string;
  name: LocalizedText;
  type: PlaceType;
  flight_scope: FlightScope | null;
  status: MasterDataStatus;
}

/** 列表项里的上架检查概况。 */
export interface ProductCheckSummary {
  can_publish: boolean;
  failed_required: number;
  unavailable_required: number;
}

interface ProductBase {
  id: string;
  code: string;
  status: ProductStatus;
  category: ServiceCategory;
  /** 各语言的标题（来自商品详情）；还没填时是空对象 */
  title: LocalizedText;
  brand_id: string;
  brand: ProductBrandRef | null;
  city_id: string;
  city: ProductCityRef | null;
  poi_id: string | null;
  poi: ProductPlaceRef | null;
  area_count: number;
  vehicle_group_count: number;
  /** 整个商品只有一个版本号：任何一步保存、上下架都会变 */
  version: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProductSummary extends ProductBase {
  check: ProductCheckSummary;
}

export interface ProductArea {
  area_id: string;
  priority: number;
  name: LocalizedText;
  biz_type: AreaBizType;
  status: MasterDataStatus;
}

export interface ProductVehicleGroup {
  vehicle_group_id: string;
  passengers: number;
  luggage: number;
  code: string;
  name: LocalizedText;
  grade: VehicleGrade;
  seats: number;
  sample_models: string[];
  combos: VehicleCombo[];
  status: MasterDataStatus;
}

export interface Dispatcher {
  name: string;
  phone: string;
}

export interface Product extends ProductBase {
  areas: ProductArea[];
  vehicle_groups: ProductVehicleGroup[];
  dispatchers: Dispatcher[];
}

export interface ProductPatch {
  areas?: { area_id: string }[];
  vehicle_groups?: { vehicle_group_id: string; passengers: number; luggage: number }[];
  dispatchers?: Dispatcher[];
}

export interface ProductCreate extends ProductPatch {
  brand_id: string;
  city_id: string;
  category: ServiceCategory;
  poi_id?: string | null;
}

export interface DailyWindowBody {
  start: string;
  end: string;
}

export type FreeWaitBody = { mode: "unlimited" } | { mode: "limited"; minutes: number };

/** 服务规则（接口里的写法）。读回来时每一项都有；提交时整体替换。 */
export interface ServiceRulesBody {
  booking: { sale_from: string | null; sale_to: string | null; service_time: DailyWindowBody | null; lead_time_hours: number | null; note: string | null };
  urgent: { enabled: boolean; daily_quota: number | null; tiers: { within_hours: number; surcharge: number }[] };
  night: { enabled: boolean; window: DailyWindowBody | null; amount: number | null; charge_unit: NightChargeUnit | null };
  free_wait: { pickup: FreeWaitBody | null; dropoff: FreeWaitBody | null; general: FreeWaitBody | null };
  addons: { addon_id: string; enabled: boolean; unit_price: number; first_free: boolean }[];
  driver_languages: { language: string; unit_price: number }[];
}

export interface ProductServiceRules {
  version: number;
  currency: string | null;
  /** 平台规定的各项免费等待最少分钟数；这个品类不填的项是 null */
  free_wait_minimums: { pickup: number | null; dropoff: number | null; general: number | null };
  rules: ServiceRulesBody;
}

export interface ProductContentTextBody {
  title: string | null;
  summary: string | null;
  includes: string[];
  excludes: string[];
  itinerary: string | null;
  pickup_guide: string | null;
}

export type ProductContentBody = Partial<Record<"zh" | "ja" | "en" | "ko", ProductContentTextBody>>;

export interface ProductContentResponse {
  version: number;
  content: ProductContentBody;
}

export interface PublishCheckIssue {
  path: string;
  reason: string;
  message: string;
  detail?: Record<string, number>;
}

export interface PublishCheckItemBody {
  key: string;
  required: boolean;
  passed: boolean;
  issues: PublishCheckIssue[];
}

export interface PublishCheckResult {
  can_publish: boolean;
  items: PublishCheckItemBody[];
}

export interface ProductListQuery {
  limit?: number;
  cursor?: string;
  q?: string;
  status?: ProductStatus | "all";
  category?: ServiceCategory;
  city_id?: string;
  brand_id?: string;
  area_id?: string;
}
export const PRODUCT_LIST_QUERY_KEYS = ["limit", "cursor", "q", "status", "category", "city_id", "brand_id", "area_id"] as const satisfies readonly (keyof ProductListQuery)[];

const one = (id: string): string => `${PRODUCTS_PATH}/${encodeURIComponent(id)}`;
const ifMatch = (version: number): Record<string, string> => ({ "if-match": `"${version}"` });

export function listBrands(token: string): Promise<Brand[]> {
  return apiRequest<{ items: Brand[] }>("GET", BRANDS_PATH, { token }).then((page) => page.items);
}

export function createBrand(token: string, body: { name: string; currency: string }, idempotencyKey: string): Promise<Brand> {
  return apiRequest("POST", BRANDS_PATH, { token, body, headers: { "idempotency-key": idempotencyKey } });
}

export function listProducts(token: string, values: ProductListQuery): Promise<MasterPage<ProductSummary>> {
  return apiRequest("GET", query(PRODUCTS_PATH, values), { token });
}

export function getProduct(token: string, id: string): Promise<Product> {
  return apiRequest("GET", one(id), { token });
}

/** 新建。`idempotencyKey` 进入新建页时生成一个，创建成功前不换。 */
export function createProduct(token: string, body: ProductCreate, idempotencyKey: string): Promise<Product> {
  return apiRequest("POST", PRODUCTS_PATH, { token, body, headers: { "idempotency-key": idempotencyKey } });
}

export function patchProduct(token: string, id: string, version: number, body: ProductPatch): Promise<Product> {
  return apiRequest("PATCH", one(id), { token, body, headers: ifMatch(version) });
}

export function deleteProduct(token: string, id: string): Promise<void> {
  return apiRequest("DELETE", one(id), { token });
}

export function getServiceRules(token: string, id: string): Promise<ProductServiceRules> {
  return apiRequest("GET", `${one(id)}/service-rules`, { token });
}

export function putServiceRules(token: string, id: string, version: number, body: ServiceRulesBody): Promise<ProductServiceRules> {
  return apiRequest("PUT", `${one(id)}/service-rules`, { token, body, headers: ifMatch(version) });
}

export function getProductContent(token: string, id: string): Promise<ProductContentResponse> {
  return apiRequest("GET", `${one(id)}/content`, { token });
}

export function putProductContent(token: string, id: string, version: number, body: ProductContentBody): Promise<ProductContentResponse> {
  return apiRequest("PUT", `${one(id)}/content`, { token, body, headers: ifMatch(version) });
}

export function getPublishCheck(token: string, id: string): Promise<PublishCheckResult> {
  return apiRequest("GET", `${one(id)}/publish-check`, { token });
}

export function setProductPublished(token: string, id: string, action: "publish" | "unpublish"): Promise<Product> {
  return apiRequest("POST", `${one(id)}/${action}`, { token });
}

/** 一个城市下本供应商的全部区域（不按状态筛；选区域和「没有可选区域」的几种情况都靠它）。不给城市就是全部。 */
export function listAllAreas(token: string, cityId?: string): Promise<AreaSummary[]> {
  return listAll(AREAS_PATH, token, { status: "all", ...(cityId ? { city_id: cityId } : {}) });
}

/** 一个城市下平台启用中的机场和车站（接送点的选项）。 */
export function listPickupPlaces(token: string, cityId: string): Promise<Place[]> {
  return listAll(`${TENANT_BASE}/master/places`, token, { city_id: cityId, type: "airport,station", sort: "code" });
}

/** 平台的车型组；`all` 连已停用的一起（已选的车型组后来被停用时要对得上）。 */
export function listTenantVehicleGroups(token: string): Promise<VehicleGroup[]> {
  return listAll(`${TENANT_BASE}/master/vehicle-groups`, token, { status: "all", sort: "code" });
}

/** 平台的附加服务目录，连已停用的一起（已勾选的后来被停用时要标出来）。 */
export function listTenantAddons(token: string): Promise<Addon[]> {
  return listAll(`${TENANT_BASE}/master/addons`, token, { status: "all", sort: "code" });
}

/** 对账用：每个类型的字段名清单。 */
const BASE = ["id", "code", "status", "category", "title", "brand_id", "brand", "city_id", "city", "poi_id", "poi", "area_count", "vehicle_group_count", "version", "published_at", "created_at", "updated_at"] as const;
export const PRODUCT_SCHEMA_FIELDS = {
  Brand: ["id", "name", "currency", "status", "version", "created_at", "updated_at"],
  ProductBrandRef: ["id", "name", "currency", "status"],
  ProductCityRef: ["id", "code", "name", "country_code", "timezone", "status"],
  ProductPlaceRef: ["id", "code", "name", "type", "flight_scope", "status"],
  ProductSummary: [...BASE, "check"],
  Product: [...BASE, "areas", "vehicle_groups", "dispatchers"],
  Dispatcher: ["name", "phone"],
  ProductServiceRules: ["version", "currency", "free_wait_minimums", "rules"],
  ProductContentText: ["title", "summary", "includes", "excludes", "itinerary", "pickup_guide"],
  ProductContentResponse: ["version", "content"],
  PublishCheck: ["can_publish", "items"],
} as const satisfies {
  Brand: readonly (keyof Brand)[];
  ProductBrandRef: readonly (keyof ProductBrandRef)[];
  ProductCityRef: readonly (keyof ProductCityRef)[];
  ProductPlaceRef: readonly (keyof ProductPlaceRef)[];
  ProductSummary: readonly (keyof ProductSummary)[];
  Product: readonly (keyof Product)[];
  Dispatcher: readonly (keyof Dispatcher)[];
  ProductServiceRules: readonly (keyof ProductServiceRules)[];
  ProductContentText: readonly (keyof ProductContentTextBody)[];
  ProductContentResponse: readonly (keyof ProductContentResponse)[];
  PublishCheck: readonly (keyof PublishCheckResult)[];
};
export const PRODUCT_WRITE_FIELDS = {
  BrandCreate: ["name", "currency"],
  ProductCreate: ["brand_id", "city_id", "category", "poi_id", "areas", "vehicle_groups", "dispatchers"],
  ProductPatch: ["areas", "vehicle_groups", "dispatchers"],
  ServiceRules: ["booking", "urgent", "night", "free_wait", "addons", "driver_languages"],
} as const;
/** 页面专门处理的错误码（其余按状态码归类）。 */
export const PRODUCT_ERROR_CODES = ["VALIDATION_FAILED", "VERSION_CONFLICT", "FIELD_LOCKED", "PUBLISH_CHECK_FAILED", "MASTER_DATA_NOT_READY", "CONCURRENT_UPDATE", "IDEMPOTENCY_KEY_REUSED", "BRAND_NAME_TAKEN", "PRODUCT_NOT_DRAFT", "PRODUCT_STATE_INVALID", "AREA_IN_USE"] as const;
