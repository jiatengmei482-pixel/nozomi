/**
 * 供应商后台：价格规则、调价规则、价格日历、价格总览、取整单位、节假日。
 * 类型手写，与 `apps/api/openapi.yaml` 对账（`prices.contract.test.ts`）。
 * 金额是子品牌币种的最小货币单位整数，百分比是基点整数；精确值（没取整的中间结果）是十进制字符串。
 * 这些接口的任何应答里都没有对外价和加价比例。
 */
import type { AdjustCycle, AdjustStep, LocalizedText, PriceDirection, PriceRuleStatus, PricingModel, ProductStatus, ServiceCategory, TripDirection } from "@nozomi/domain";
import { TENANT_BASE, query } from "./areas.ts";
import { apiRequest } from "./client.ts";
import { BRANDS_PATH, type DailyWindowBody, PRODUCTS_PATH } from "./products.ts";

/** 一条价格里这种计价方式不用的数是 null。 */
export interface PriceRuleInput {
  area_id: string;
  vehicle_group_id: string;
  direction: PriceDirection | null;
  package_hours: number | null;
  pricing_model: PricingModel;
  base_price: number | null;
  start_price: number | null;
  start_meters: number | null;
  start_minutes: number | null;
  per_km: number | null;
  per_minute: number | null;
  min_price: number | null;
  package_km: number | null;
  package_price: number | null;
  overtime_per_hour: number | null;
  over_km_per_km: number | null;
  valid_from: string;
  valid_to: string | null;
  status: PriceRuleStatus;
}

export interface PriceRuleBody extends PriceRuleInput {
  id: string;
  /** 这条价格能报出的最低数（十进制字符串，最小货币单位）：试算和日历的基数 */
  base: string;
  created_at: string;
  updated_at: string;
}

export interface PriceRules {
  /** 商品的版本号：价格、调价的每次修改都用它做 If-Match */
  version: number;
  currency: string;
  /** 子品牌的取整单位（最小货币单位）；1 = 不另外取整 */
  rounding_unit: number;
  available_models: PricingModel[];
  /** 商品所在城市当地的今天 */
  today: string;
  items: PriceRuleBody[];
  coverage: { total: number; priced: number; missing: number };
}

export interface PriceRuleBatch {
  create: (PriceRuleInput & { ref: string })[];
  update: (PriceRuleInput & { id: string })[];
  delete: string[];
}

export interface AdjustRuleInput {
  name: string;
  travel_from: string | null;
  travel_to: string | null;
  cycle: AdjustCycle;
  time_slot: DailyWindowBody | null;
  area_ids: string[];
  vehicle_group_ids: string[];
  directions: TripDirection[];
  package_hours: number[];
  steps: AdjustStep[];
  status: PriceRuleStatus;
}

export interface AdjustRuleBody extends AdjustRuleInput {
  id: string;
  /** 出行日期已经全部过去，以后不会再生效 */
  ended: boolean;
  created_at: string;
  updated_at: string;
}

export interface AdjustRules {
  version: number;
  currency: string;
  rounding_unit: number;
  today: string;
  /** 按执行的先后 */
  items: AdjustRuleBody[];
}

export interface Holiday {
  country_code: string;
  date: string;
  name: LocalizedText;
  updated_at: string;
}

export interface Holidays {
  items: Holiday[];
  /** 哪些国家有节假日数据 */
  countries: { country_code: string; count: number; last_date: string }[];
}

export interface CalendarStepBody {
  type: "percent" | "amount";
  value: number;
  delta: string;
  after: string;
}

export interface CalendarSegment {
  from: string;
  /** 不含；最后一段是 24:00 */
  to: string;
  /** 取整后的结算价；报不出价时是 null */
  final: number | null;
  no_price_reason: string | null;
  base: string | null;
  unrounded: string | null;
  adjusts: { rule_id: string; name: string; steps: CalendarStepBody[] }[];
}

export interface CalendarDay {
  date: string;
  weekday: number;
  holiday: { name: LocalizedText } | null;
  price_rule: { id: string; pricing_model: PricingModel; direction: PriceDirection | null; valid_from: string; valid_to: string | null } | null;
  segments: CalendarSegment[];
}

export interface PriceCalendar {
  version: number;
  currency: string;
  rounding_unit: number;
  today: string;
  /** 第一个车型组的日历 */
  days: CalendarDay[];
  /** 每个车型组各一份，顺序和请求里的一样 */
  groups: { vehicle_group_id: string; days: CalendarDay[] }[];
}

export interface PriceOverviewItem {
  product_id: string;
  code: string;
  status: ProductStatus;
  category: ServiceCategory;
  title: LocalizedText;
  city: { id: string; name: LocalizedText };
  /** 该有价格的组合有几个、其中几个没有价格（算法同 price-coverage） */
  coverage: { total: number; missing: number };
  price_rule_count: number;
  has_active_price: boolean;
  active_price_rule_count: number;
  enabled_adjust_rule_count: number;
}

export interface PriceOverview {
  products_with_price: number;
  products_without_price: number;
  /** 带 `summary=1` 取的时候没有 */
  items?: PriceOverviewItem[];
}

const product = (id: string): string => `${PRODUCTS_PATH}/${encodeURIComponent(id)}`;
const ifMatch = (version: number): Record<string, string> => ({ "if-match": `"${version}"` });

export function getPriceRules(token: string, productId: string): Promise<PriceRules> {
  return apiRequest("GET", `${product(productId)}/price-rules`, { token });
}

/** 批量保存：新增、修改、删除一起提交，要么全部成功，要么一条都不保存。成功后返回保存之后的全部价格。 */
export function savePriceRules(token: string, productId: string, version: number, batch: PriceRuleBatch, idempotencyKey: string): Promise<PriceRules & { created_ids: string[] }> {
  return apiRequest("POST", `${product(productId)}/price-rules/batch`, { token, body: batch, headers: { ...ifMatch(version), "idempotency-key": idempotencyKey } });
}

export function getAdjustRules(token: string, productId: string): Promise<AdjustRules> {
  return apiRequest("GET", `${product(productId)}/adjust-rules`, { token });
}

export function createAdjustRule(token: string, productId: string, version: number, body: AdjustRuleInput, idempotencyKey: string): Promise<{ version: number; adjust_rule: AdjustRuleBody }> {
  return apiRequest("POST", `${product(productId)}/adjust-rules`, { token, body, headers: { ...ifMatch(version), "idempotency-key": idempotencyKey } });
}

export function updateAdjustRule(token: string, productId: string, ruleId: string, version: number, body: AdjustRuleInput): Promise<{ version: number; adjust_rule: AdjustRuleBody }> {
  return apiRequest("PUT", `${product(productId)}/adjust-rules/${encodeURIComponent(ruleId)}`, { token, body, headers: ifMatch(version) });
}

export function deleteAdjustRule(token: string, productId: string, ruleId: string, version: number): Promise<{ version: number }> {
  return apiRequest("DELETE", `${product(productId)}/adjust-rules/${encodeURIComponent(ruleId)}`, { token, headers: ifMatch(version) });
}

/** 启用 / 停用一条调价规则：不带版本号，应答里有商品的新版本号。 */
export function setAdjustRuleStatus(token: string, productId: string, ruleId: string, action: "enable" | "disable"): Promise<{ version: number; adjust_rule: AdjustRuleBody }> {
  return apiRequest("POST", `${product(productId)}/adjust-rules/${encodeURIComponent(ruleId)}/${action}`, { token });
}

/** 保存顺序：`ids` 必须正好是全部规则。应答是重排之后的全部规则。 */
export function saveAdjustRuleOrder(token: string, productId: string, version: number, ids: string[]): Promise<AdjustRules> {
  return apiRequest("PUT", `${product(productId)}/adjust-rules/order`, { token, body: { ids }, headers: ifMatch(version) });
}

export interface CalendarQuery {
  area_id: string;
  vehicle_group_id: string;
  direction?: TripDirection;
  package_hours?: number;
  from: string;
  to: string;
}
export const CALENDAR_QUERY_KEYS = ["area_id", "vehicle_group_id", "direction", "package_hours", "from", "to"] as const satisfies readonly (keyof CalendarQuery)[];

export function getPriceCalendar(token: string, productId: string, values: CalendarQuery): Promise<PriceCalendar> {
  return apiRequest("GET", query(`${product(productId)}/price-calendar`, values), { token });
}

export function getPriceOverview(token: string): Promise<PriceOverview & { items: PriceOverviewItem[] }> {
  return apiRequest("GET", `${TENANT_BASE}/price-overview`, { token });
}

/** 只要两个数（首页的卡片）。 */
export function getPriceOverviewSummary(token: string): Promise<Pick<PriceOverview, "products_with_price" | "products_without_price">> {
  return apiRequest("GET", `${TENANT_BASE}/price-overview?summary=1`, { token });
}

export function saveRoundingUnit(token: string, brandId: string, version: number, roundingUnit: number): Promise<{ id: string; rounding_unit: number; version: number }> {
  return apiRequest("PUT", `${BRANDS_PATH}/${encodeURIComponent(brandId)}/rounding-unit`, { token, body: { rounding_unit: roundingUnit }, headers: ifMatch(version) });
}

/** 节假日的查询参数；`country_code` 可以是逗号分隔的几个国家。 */
export const HOLIDAY_QUERY_KEYS = ["country_code", "from", "to"] as const;

export function getHolidays(token: string, values: { country_code?: string; from?: string; to?: string } = {}): Promise<Holidays> {
  return apiRequest("GET", query(`${TENANT_BASE}/holidays`, values), { token });
}

/** 对账用：每个类型的字段名清单。 */
const PRICE_INPUT = ["area_id", "vehicle_group_id", "direction", "package_hours", "pricing_model", "base_price", "start_price", "start_meters", "start_minutes", "per_km", "per_minute", "min_price", "package_km", "package_price", "overtime_per_hour", "over_km_per_km", "valid_from", "valid_to", "status"] as const;
const ADJUST_INPUT = ["name", "travel_from", "travel_to", "cycle", "time_slot", "area_ids", "vehicle_group_ids", "directions", "package_hours", "steps", "status"] as const;
export const PRICE_SCHEMA_FIELDS = {
  PriceRule: ["id", ...PRICE_INPUT, "base", "created_at", "updated_at"],
  PriceCalendar: ["version", "currency", "rounding_unit", "today", "days", "groups"],
  PriceCalendarDay: ["date", "weekday", "holiday", "price_rule", "segments"],
  PriceRules: ["version", "currency", "rounding_unit", "available_models", "today", "items", "coverage"],
  AdjustRule: ["id", ...ADJUST_INPUT, "ended", "created_at", "updated_at"],
  AdjustRules: ["version", "currency", "rounding_unit", "today", "items"],
  Holiday: ["country_code", "date", "name", "updated_at"],
  Holidays: ["items", "countries"],
} as const satisfies {
  PriceRule: readonly (keyof PriceRuleBody)[];
  PriceCalendar: readonly (keyof PriceCalendar)[];
  PriceCalendarDay: readonly (keyof CalendarDay)[];
  PriceRules: readonly (keyof PriceRules)[];
  AdjustRule: readonly (keyof AdjustRuleBody)[];
  AdjustRules: readonly (keyof AdjustRules)[];
  Holiday: readonly (keyof Holiday)[];
  Holidays: readonly (keyof Holidays)[];
};
/** 价格总览里每个商品的字段（schema 是内嵌的，对账时单独比）。 */
export const PRICE_OVERVIEW_ITEM_FIELDS = ["product_id", "code", "status", "category", "title", "city", "coverage", "price_rule_count", "has_active_price", "active_price_rule_count", "enabled_adjust_rule_count"] as const satisfies readonly (keyof PriceOverviewItem)[];
export const NO_PRICE_REASONS = ["NO_RULE", "NOT_IN_EFFECT", "RULE_DISABLED", "NOT_POSITIVE"] as const;
export const PRICE_WRITE_FIELDS = { PriceRuleInput: PRICE_INPUT, AdjustRuleInput: ADJUST_INPUT, PriceRuleBatch: ["create", "update", "delete"], AdjustRuleOrder: ["ids"] } as const;
/** 页面专门处理的错误码和原因。 */
export const PRICE_ERROR_CODES = ["PRICE_RULE_CONFLICT", "VERSION_CONFLICT", "PUBLISH_CHECK_FAILED", "CONCURRENT_UPDATE", "IDEMPOTENCY_KEY_REUSED", "AREA_NOT_IN_PRODUCT", "VEHICLE_GROUP_NOT_IN_PRODUCT", "UNKNOWN_PRICE_RULE", "TOO_MANY", "ADJUST_RESULT_NOT_POSITIVE", "IDS_MISMATCH", "NO_ACTIVE_PRICE_RULE", "ALL_PRICE_RULES_DISABLED", "ALL_PRICE_RULES_EXPIRED"] as const;
