/**
 * 运营后台只读查看供应商的商品（ADR 0021）：`GET /platform/v1/products`、`GET /platform/v1/products/{id}`；
 * 以及平台的节假日（调价规则里「节假日」周期的日期，只读）。
 * 详情的各部分和供应商自己看到的同结构，所以直接用租户侧的类型；类型与 `apps/api/openapi.yaml` 对账（`platform-products.contract.test.ts`）。
 * 这里只有结算价（平台可以看）；没有对外价和加价比例。
 */
import type { InventoryMode, ProductStatus, ServiceCategory } from "@nozomi/domain";
import { query } from "./areas.ts";
import { apiRequest } from "./client.ts";
import type { MasterPage } from "./master.ts";
import { PLATFORM_BASE } from "./platform.ts";
import type { AdjustRules, Holidays, PriceRules } from "./prices.ts";
import type { Product, ProductContentBody, ProductServiceRules, ProductSummary, PublishCheckResult } from "./products.ts";

export const PLATFORM_PRODUCTS_PATH = `${PLATFORM_BASE}/products`;
export const PLATFORM_HOLIDAYS_PATH = `${PLATFORM_BASE}/holidays`;

/** 商品所属的供应商。 */
export interface ProductTenantRef {
  id: string;
  name: string;
  status: "active" | "suspended";
}

/** 列表的一项：供应商侧的列表项去掉上架检查概况，加上所属供应商和「有没有可以卖的价格」。 */
export interface PlatformProductSummary extends Omit<ProductSummary, "check"> {
  tenant_id: string;
  tenant: ProductTenantRef;
  /** 启用、没过期（城市当地的今天）、区域和车型组都是商品现在选着的价格有没有：和上架检查「价格规则」一项同一个判断 */
  has_active_price: boolean;
  active_price_rule_count: number;
}

export interface PlatformProductDetail {
  tenant: ProductTenantRef;
  product: Product;
  service_rules: ProductServiceRules;
  content: ProductContentBody;
  price_rules: PriceRules;
  adjust_rules: AdjustRules;
  inventory: { mode: InventoryMode; sellable_days_ahead: number };
  publish_check: PublishCheckResult;
}

export interface PlatformProductQuery {
  limit?: number;
  cursor?: string;
  q?: string;
  tenant_id?: string;
  city_id?: string;
  category?: ServiceCategory;
  status?: ProductStatus | "all";
  brand_id?: string;
  has_active_price?: "true" | "false";
}
export const PLATFORM_PRODUCT_QUERY_KEYS = ["limit", "cursor", "q", "tenant_id", "city_id", "category", "status", "brand_id", "has_active_price"] as const satisfies readonly (keyof PlatformProductQuery)[];

export function listPlatformProducts(token: string, values: PlatformProductQuery): Promise<MasterPage<PlatformProductSummary>> {
  return apiRequest("GET", query(PLATFORM_PRODUCTS_PATH, values), { token });
}

export function getPlatformProduct(token: string, id: string): Promise<PlatformProductDetail> {
  return apiRequest("GET", `${PLATFORM_PRODUCTS_PATH}/${encodeURIComponent(id)}`, { token });
}

/** 符合条件的商品有几个（首页卡片用：只要 `total`，取一条就够）。 */
export function countPlatformProducts(token: string, values: Omit<PlatformProductQuery, "limit" | "cursor">): Promise<number> {
  return listPlatformProducts(token, { ...values, limit: 1 }).then((page) => page.total);
}

export function getPlatformHolidays(token: string, values: { country_code?: string; from?: string; to?: string } = {}): Promise<Holidays> {
  return apiRequest("GET", query(PLATFORM_HOLIDAYS_PATH, values), { token });
}

/** 对账用：字段名清单。 */
export const PLATFORM_PRODUCT_SCHEMA_FIELDS = {
  ProductTenantRef: ["id", "name", "status"],
  PlatformProductSummary: ["id", "code", "status", "category", "title", "brand_id", "brand", "city_id", "city", "poi_id", "poi", "area_count", "vehicle_group_count", "version", "published_at", "created_at", "updated_at", "tenant_id", "tenant", "has_active_price", "active_price_rule_count"],
  PlatformProductDetail: ["tenant", "product", "service_rules", "content", "price_rules", "adjust_rules", "inventory", "publish_check"],
  PlatformProductInventory: ["mode", "sellable_days_ahead"],
} as const satisfies {
  ProductTenantRef: readonly (keyof ProductTenantRef)[];
  PlatformProductSummary: readonly (keyof PlatformProductSummary)[];
  PlatformProductDetail: readonly (keyof PlatformProductDetail)[];
  PlatformProductInventory: readonly (keyof PlatformProductDetail["inventory"])[];
};
/** 详情的各部分各对应 openapi 里的哪个结构（和供应商侧同结构）。 */
export const PLATFORM_PRODUCT_DETAIL_PARTS = {
  tenant: "ProductTenantRef",
  product: "Product",
  service_rules: "ProductServiceRules",
  content: "ProductContent",
  price_rules: "PriceRules",
  adjust_rules: "AdjustRules",
  publish_check: "PublishCheck",
} as const;
