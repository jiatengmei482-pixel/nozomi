/**
 * 子品牌和商品的数据访问（迁移 0012）。除最后一节外全部在租户事务（withTenantTx）里调用：
 * 每个函数都显式带 tenantId 并写在条件里（ADR 0003 的第一道防线），行级安全是兜底。
 * 最后一节「平台侧」只在平台事务里调用：平台对商品只读，只用来数「有多少已上架的商品在用某条主数据」。
 */
import type {
  AddonChargeUnit,
  AreaBizType,
  AreaStatus,
  CurrencyCode,
  FlightScope,
  LocalizedText,
  MasterDataStatus,
  PlaceType,
  ProductContent,
  ProductStatus,
  ServiceCategory,
  ServiceRules,
  VehicleCombo,
  VehicleGrade,
} from "@nozomi/domain";
import type { Db } from "../db/context.ts";
import { type Page, type TimeCursor, toPage } from "../pagination.ts";
import { containsPattern } from "./master-data.ts";

type Row = Record<string, any>;

// ---- 子品牌 ----

export interface Brand {
  id: string;
  name: string;
  currency: CurrencyCode;
  status: MasterDataStatus;
  /** 取整单位（最小货币单位）：这个子品牌下的结算价最后按它四舍五入；1 = 不另外取整 */
  roundingUnit: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const BRAND_COLUMNS = "id, name, currency, status, rounding_unit, version, created_at, updated_at";
/** 子品牌名称唯一索引的名字：用来认出「同名」 */
export const BRAND_NAME_CONSTRAINT = "brands_name_key";

function toBrand(row: Row): Brand {
  return { id: row["id"], name: row["name"], currency: row["currency"], status: row["status"], roundingUnit: row["rounding_unit"], version: row["version"], createdAt: row["created_at"], updatedAt: row["updated_at"] };
}

export async function insertBrand(db: Db, tenantId: string, name: string, currency: CurrencyCode, now: Date): Promise<Brand> {
  const result = await db.query<Row>(
    `insert into brands (tenant_id, name, currency, status, created_at, updated_at) values ($1, $2, $3, 'active', $4, $4) returning ${BRAND_COLUMNS}`,
    [tenantId, name, currency, now],
  );
  return toBrand(result.rows[0] as Row);
}

export async function renameBrand(db: Db, tenantId: string, id: string, name: string, now: Date): Promise<Brand> {
  const result = await db.query<Row>(
    `update brands set name = $3, updated_at = $4, version = version + 1 where tenant_id = $1 and id = $2 returning ${BRAND_COLUMNS}`,
    [tenantId, id, name, now],
  );
  return toBrand(result.rows[0] as Row);
}

export async function findBrand(db: Db, tenantId: string, id: string, options: { lock: boolean }): Promise<Brand | null> {
  const result = await db.query<Row>(`select ${BRAND_COLUMNS} from brands where tenant_id = $1 and id = $2 ${options.lock ? "for update" : ""}`, [tenantId, id]);
  const row = result.rows[0];
  return row ? toBrand(row) : null;
}

/** 本租户的全部子品牌，按创建的先后。一个供应商的子品牌是个位数，不分页。 */
export async function listBrands(db: Db, tenantId: string): Promise<Brand[]> {
  const result = await db.query<Row>(`select ${BRAND_COLUMNS} from brands where tenant_id = $1 order by created_at, id`, [tenantId]);
  return result.rows.map(toBrand);
}

// ---- 商品 ----

export interface Product {
  id: string;
  code: string;
  brandId: string;
  cityId: string;
  category: ServiceCategory;
  poiId: string | null;
  status: ProductStatus;
  serviceRules: ServiceRules;
  content: ProductContent;
  version: number;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const PRODUCT_COLUMNS = "id, code, brand_id, city_id, category, poi_id, status, service_rules, content, version, published_at, created_at, updated_at";

function toProduct(row: Row): Product {
  return {
    id: row["id"],
    code: row["code"],
    brandId: row["brand_id"],
    cityId: row["city_id"],
    category: row["category"],
    poiId: row["poi_id"],
    status: row["status"],
    serviceRules: row["service_rules"],
    content: row["content"],
    version: row["version"],
    publishedAt: row["published_at"],
    createdAt: row["created_at"],
    updatedAt: row["updated_at"],
  };
}

/** 商品编号：PRD + 创建时间（UTC 的年月日时分秒）+ 全平台共用的流水号（至少 4 位）。 */
export async function nextProductCode(db: Db, now: Date): Promise<string> {
  const result = await db.query<{ n: string }>("select nextval('product_code_seq')::text as n");
  const stamp = now.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return `PRD${stamp}${(result.rows[0]?.n ?? "0").padStart(4, "0")}`;
}

export interface NewProduct {
  code: string;
  brandId: string;
  cityId: string;
  category: ServiceCategory;
  poiId: string | null;
  serviceRules: ServiceRules;
  content: ProductContent;
}

export async function insertProduct(db: Db, tenantId: string, values: NewProduct, now: Date): Promise<Product> {
  const result = await db.query<Row>(
    `insert into products (tenant_id, code, brand_id, city_id, category, poi_id, status, service_rules, content, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, 'draft', $7::jsonb, $8::jsonb, $9, $9)
     returning ${PRODUCT_COLUMNS}`,
    [tenantId, values.code, values.brandId, values.cityId, values.category, values.poiId, JSON.stringify(values.serviceRules), JSON.stringify(values.content), now],
  );
  return toProduct(result.rows[0] as Row);
}

export interface ProductChanges {
  status?: ProductStatus;
  serviceRules?: ServiceRules;
  content?: ProductContent;
  /** 上架时记下时间 */
  publishedAt?: Date;
}

/** 修改商品：版本号加一、更新时间改为现在。商品下面的任何一部分变了（区域、车型组、调度人、服务规则、详情）都算商品变了。 */
export async function updateProduct(db: Db, tenantId: string, id: string, changes: ProductChanges, now: Date): Promise<Product> {
  const result = await db.query<Row>(
    `update products
        set updated_at = $3, version = version + 1,
            status = coalesce($4, status),
            service_rules = coalesce($5::jsonb, service_rules),
            content = coalesce($6::jsonb, content),
            published_at = coalesce($7, published_at)
      where tenant_id = $1 and id = $2
      returning ${PRODUCT_COLUMNS}`,
    [
      tenantId,
      id,
      now,
      changes.status ?? null,
      changes.serviceRules === undefined ? null : JSON.stringify(changes.serviceRules),
      changes.content === undefined ? null : JSON.stringify(changes.content),
      changes.publishedAt ?? null,
    ],
  );
  return toProduct(result.rows[0] as Row);
}

export async function findProduct(db: Db, tenantId: string, id: string, options: { lock: boolean }): Promise<Product | null> {
  const result = await db.query<Row>(`select ${PRODUCT_COLUMNS} from products where tenant_id = $1 and id = $2 ${options.lock ? "for update" : ""}`, [tenantId, id]);
  const row = result.rows[0];
  return row ? toProduct(row) : null;
}

export async function deleteProduct(db: Db, tenantId: string, id: string): Promise<void> {
  await db.query("delete from products where tenant_id = $1 and id = $2", [tenantId, id]);
}

export interface ProductFilter {
  /** 商品编号，或任意一种语言的标题里包含它（不区分大小写） */
  search?: string | undefined;
  status?: ProductStatus | undefined;
  category?: ServiceCategory | undefined;
  cityId?: string | undefined;
  brandId?: string | undefined;
  /** 只看选了这个区域的商品 */
  areaId?: string | undefined;
}

export interface ProductListItem extends Product {
  areaCount: number;
  vehicleGroupCount: number;
}

/** 本租户的商品列表：按最近修改从新到旧（修改时间相同的按编号，顺序稳定），同时数出符合筛选条件的总数。 */
export async function listProducts(db: Db, tenantId: string, filter: ProductFilter, limit: number, after: TimeCursor | null): Promise<Page<ProductListItem> & { total: number }> {
  const conditions = ["p.tenant_id = $1"];
  const params: unknown[] = [tenantId];
  const where = (sql: string, ...values: unknown[]): void => {
    let used = 0;
    conditions.push(sql.replace(/\?/g, () => `$${params.push(values[used++])}`));
  };
  if (filter.status !== undefined) where("p.status = ?", filter.status);
  if (filter.category !== undefined) where("p.category = ?", filter.category);
  if (filter.cityId !== undefined) where("p.city_id = ?", filter.cityId);
  if (filter.brandId !== undefined) where("p.brand_id = ?", filter.brandId);
  if (filter.areaId !== undefined) where("exists (select 1 from product_areas pa where pa.tenant_id = p.tenant_id and pa.product_id = p.id and pa.area_id = ?)", filter.areaId);
  if (filter.search !== undefined) {
    const pattern = containsPattern(filter.search);
    where(
      "(p.code ilike ? escape '\\' or exists (select 1 from jsonb_each(p.content) as localized(lang, value) where localized.value ->> 'title' ilike ? escape '\\'))",
      pattern,
      pattern,
    );
  }
  const total = await db.query<{ n: number }>(`select count(*)::int as n from products p where ${conditions.join(" and ")}`, [...params]);
  if (after !== null) where("(p.updated_at, p.id) < (?::timestamptz, ?::uuid)", after.t, after.id);
  params.push(limit + 1);
  const result = await db.query<Row & { cursor_time: string }>(
    `select ${PRODUCT_COLUMNS.split(", ").map((column) => `p.${column}`).join(", ")}, p.updated_at::text as cursor_time,
            (select count(*)::int from product_areas pa where pa.tenant_id = p.tenant_id and pa.product_id = p.id) as area_count,
            (select count(*)::int from product_vehicle_groups pv where pv.tenant_id = p.tenant_id and pv.product_id = p.id) as vehicle_group_count
       from products p
      where ${conditions.join(" and ")}
      order by p.updated_at desc, p.id desc
      limit $${params.length}`,
    params,
  );
  const page = toPage(
    result.rows,
    limit,
    (row): ProductListItem => ({ ...toProduct(row), areaCount: row["area_count"], vehicleGroupCount: row["vehicle_group_count"] }),
    (row) => ({ t: row.cursor_time, id: row["id"] as string }),
  );
  return { ...page, total: total.rows[0]?.n ?? 0 };
}

/** 本租户的商品数量，按状态（首页用）。 */
export async function countProductsByStatus(db: Db, tenantId: string): Promise<Record<ProductStatus, number>> {
  const result = await db.query<{ status: ProductStatus; n: number }>("select status, count(*)::int as n from products where tenant_id = $1 group by status", [tenantId]);
  const of = (status: ProductStatus): number => result.rows.find((row) => row.status === status)?.n ?? 0;
  return { draft: of("draft"), published: of("published"), unpublished: of("unpublished") };
}

// ---- 商品选的区域、车型组、调度人 ----

/** 商品选的一个区域，连同区域现在的情况（读取时现查）。 */
export interface ProductArea {
  areaId: string;
  priority: number;
  name: LocalizedText;
  bizType: AreaBizType;
  status: AreaStatus;
  cityId: string;
}

export async function listProductAreas(db: Db, tenantId: string, productId: string): Promise<ProductArea[]> {
  const result = await db.query<Row>(
    `select pa.area_id, pa.priority, a.name, a.biz_type, a.status, a.city_id
       from product_areas pa join areas a on a.tenant_id = pa.tenant_id and a.id = pa.area_id
      where pa.tenant_id = $1 and pa.product_id = $2
      order by pa.priority, pa.area_id`,
    [tenantId, productId],
  );
  return result.rows.map((row) => ({ areaId: row["area_id"], priority: row["priority"], name: row["name"], bizType: row["biz_type"], status: row["status"], cityId: row["city_id"] }));
}

/** 把商品选的区域整体换成这一组（顺序就是优先级）。 */
export async function replaceProductAreas(db: Db, tenantId: string, productId: string, areaIds: readonly string[]): Promise<void> {
  await db.query("delete from product_areas where tenant_id = $1 and product_id = $2", [tenantId, productId]);
  for (const [priority, areaId] of areaIds.entries()) {
    await db.query("insert into product_areas (tenant_id, product_id, area_id, priority) values ($1, $2, $3, $4)", [tenantId, productId, areaId, priority]);
  }
}

/** 本租户的这些区域现在的情况（校验商品选的区域用）。别的租户的区域查不到。 */
export async function findAreasForProduct(db: Db, tenantId: string, areaIds: readonly string[]): Promise<Map<string, { id: string; cityId: string; bizType: AreaBizType; status: AreaStatus; name: LocalizedText }>> {
  if (areaIds.length === 0) return new Map();
  const result = await db.query<Row>("select id, city_id, biz_type, status, name from areas where tenant_id = $1 and id = any($2::uuid[])", [tenantId, areaIds]);
  return new Map(result.rows.map((row) => [row["id"] as string, { id: row["id"], cityId: row["city_id"], bizType: row["biz_type"], status: row["status"], name: row["name"] }]));
}

/** 商品选的一个车型组，连同车型组现在的情况。 */
export interface ProductVehicleGroup {
  vehicleGroupId: string;
  passengers: number;
  luggage: number;
  code: string;
  name: LocalizedText;
  grade: VehicleGrade;
  seats: number;
  sampleModels: string[];
  status: MasterDataStatus;
  combos: VehicleCombo[];
}

export async function listProductVehicleGroups(db: Db, tenantId: string, productId: string): Promise<ProductVehicleGroup[]> {
  const result = await db.query<Row>(
    `select pv.vehicle_group_id, pv.passengers, pv.luggage, g.code, g.name, g.grade, g.seats, g.sample_models, g.status, g.combos
       from product_vehicle_groups pv join vehicle_groups g on g.id = pv.vehicle_group_id
      where pv.tenant_id = $1 and pv.product_id = $2
      order by pv.position`,
    [tenantId, productId],
  );
  return result.rows.map((row) => ({
    vehicleGroupId: row["vehicle_group_id"],
    passengers: row["passengers"],
    luggage: row["luggage"],
    code: row["code"],
    name: row["name"],
    grade: row["grade"],
    seats: row["seats"],
    sampleModels: row["sample_models"],
    status: row["status"],
    combos: row["combos"],
  }));
}

export interface VehicleGroupChoice {
  vehicleGroupId: string;
  passengers: number;
  luggage: number;
}

export async function replaceProductVehicleGroups(db: Db, tenantId: string, productId: string, choices: readonly VehicleGroupChoice[]): Promise<void> {
  await db.query("delete from product_vehicle_groups where tenant_id = $1 and product_id = $2", [tenantId, productId]);
  for (const [position, choice] of choices.entries()) {
    await db.query(
      "insert into product_vehicle_groups (tenant_id, product_id, vehicle_group_id, passengers, luggage, position) values ($1, $2, $3, $4, $5, $6)",
      [tenantId, productId, choice.vehicleGroupId, choice.passengers, choice.luggage, position],
    );
  }
}

/** 这些车型组（平台主数据）现在的情况。 */
export async function findVehicleGroupsForProduct(db: Db, ids: readonly string[]): Promise<Map<string, { id: string; status: MasterDataStatus; combos: VehicleCombo[] }>> {
  if (ids.length === 0) return new Map();
  const result = await db.query<Row>("select id, status, combos from vehicle_groups where id = any($1::uuid[])", [ids]);
  return new Map(result.rows.map((row) => [row["id"] as string, { id: row["id"], status: row["status"], combos: row["combos"] }]));
}

export interface Dispatcher {
  name: string;
  phone: string;
}

export async function listProductDispatchers(db: Db, tenantId: string, productId: string): Promise<Dispatcher[]> {
  const result = await db.query<Row>("select name, phone from product_dispatchers where tenant_id = $1 and product_id = $2 order by position", [tenantId, productId]);
  return result.rows.map((row) => ({ name: row["name"], phone: row["phone"] }));
}

export async function replaceProductDispatchers(db: Db, tenantId: string, productId: string, dispatchers: readonly Dispatcher[]): Promise<void> {
  await db.query("delete from product_dispatchers where tenant_id = $1 and product_id = $2", [tenantId, productId]);
  for (const [position, dispatcher] of dispatchers.entries()) {
    await db.query("insert into product_dispatchers (tenant_id, product_id, position, name, phone) values ($1, $2, $3, $4, $5)", [tenantId, productId, position, dispatcher.name, dispatcher.phone]);
  }
}

// ---- 商品引用的平台主数据（租户角色只读） ----

/** 接送点（机场或车站）现在的情况。 */
export interface ProductPlace {
  id: string;
  code: string;
  name: LocalizedText;
  type: PlaceType;
  status: MasterDataStatus;
  cityId: string | null;
  flightScope: FlightScope | null;
}

export async function findPlacesForProduct(db: Db, ids: readonly string[]): Promise<Map<string, ProductPlace>> {
  if (ids.length === 0) return new Map();
  const result = await db.query<Row>("select id, code, name, type, status, city_id, flight_scope from places where id = any($1::uuid[])", [ids]);
  return new Map(
    result.rows.map((row) => [row["id"] as string, { id: row["id"], code: row["code"], name: row["name"], type: row["type"], status: row["status"], cityId: row["city_id"], flightScope: row["flight_scope"] }]),
  );
}

export interface ProductAddon {
  id: string;
  status: MasterDataStatus;
  categories: ServiceCategory[];
  chargeUnit: AddonChargeUnit;
}

export async function findAddonsForProduct(db: Db, ids: readonly string[]): Promise<Map<string, ProductAddon>> {
  if (ids.length === 0) return new Map();
  const result = await db.query<Row>("select id, status, categories, charge_unit from addons where id = any($1::uuid[])", [ids]);
  return new Map(result.rows.map((row) => [row["id"] as string, { id: row["id"], status: row["status"], categories: row["categories"], chargeUnit: row["charge_unit"] }]));
}

export async function findBrands(db: Db, tenantId: string, ids: readonly string[]): Promise<Map<string, Brand>> {
  if (ids.length === 0) return new Map();
  const result = await db.query<Row>(`select ${BRAND_COLUMNS} from brands where tenant_id = $1 and id = any($2::uuid[])`, [tenantId, ids]);
  return new Map(result.rows.map((row) => [row["id"] as string, toBrand(row)]));
}

/**
 * 上架（或修改已上架的商品）时把它选的区域锁住直到事务结束：这期间区域不能被删除、停用。
 * 删除 / 停用区域的那一边先锁区域、再数「有多少已上架的商品在用」，所以两边不会同时通过各自的检查。
 */
export async function lockProductAreas(db: Db, tenantId: string, productId: string): Promise<void> {
  await db.query(
    "select 1 from areas a where a.tenant_id = $1 and a.id in (select area_id from product_areas where tenant_id = $1 and product_id = $2) order by a.id for share of a",
    [tenantId, productId],
  );
}

// ---- 区域被商品使用的情况 ----

export interface AreaUsage {
  productCount: number;
  publishedProductCount: number;
}

/** 这些区域各被多少个商品选了、其中多少个是已上架的。没被选的区域不在返回里。 */
export async function areaUsage(db: Db, tenantId: string, areaIds: readonly string[]): Promise<Map<string, AreaUsage>> {
  if (areaIds.length === 0) return new Map();
  const result = await db.query<{ area_id: string; product_count: number; published_count: number }>(
    `select pa.area_id, count(*)::int as product_count, count(*) filter (where p.status = 'published')::int as published_count
       from product_areas pa join products p on p.tenant_id = pa.tenant_id and p.id = pa.product_id
      where pa.tenant_id = $1 and pa.area_id = any($2::uuid[])
      group by pa.area_id`,
    [tenantId, areaIds],
  );
  return new Map(result.rows.map((row) => [row.area_id, { productCount: row.product_count, publishedProductCount: row.published_count }]));
}

// ---- 平台侧：停用主数据之前数一数有多少已上架的商品在用（只在平台事务里调用，跨租户） ----

export type MasterReference = "city" | "place" | "vehicle_group" | "addon";

export async function countPublishedProductsUsing(db: Db, reference: MasterReference, id: string): Promise<number> {
  const condition: Record<MasterReference, string> = {
    city: "p.city_id = $1",
    place: "p.poi_id = $1",
    vehicle_group: "exists (select 1 from product_vehicle_groups pv where pv.tenant_id = p.tenant_id and pv.product_id = p.id and pv.vehicle_group_id = $1)",
    // 服务规则里选了这个附加服务并且是开着的
    addon: "exists (select 1 from jsonb_array_elements(p.service_rules -> 'addons') as chosen where chosen ->> 'addonId' = $1::text and (chosen ->> 'enabled')::boolean)",
  };
  const result = await db.query<{ n: number }>(`select count(*)::int as n from products p where p.status = 'published' and ${condition[reference]}`, [id]);
  return result.rows[0]?.n ?? 0;
}
