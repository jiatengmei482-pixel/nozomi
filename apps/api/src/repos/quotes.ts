/**
 * 报价引擎取数（M2-01，ADR 0020）：把一批商品报价要看的全部事实取出来，拼成 domain 的 QuoteProduct。
 * 每一类数据一条查询取回这一批商品的（不逐个商品查）。在租户事务里只看得到本租户的（行级安全），在平台事务里看得到全部供应商的。
 */
import { type AddonChargeUnit, type AreaBizType, type CurrencyCode, type InventoryDay, type Position, type QuoteArea, type QuoteProduct, type ServiceCategory, type ServiceRules, type TenantStatus, areaUsableByCategory, tenantBids } from "@nozomi/domain";
import type { Db } from "../db/context.ts";
import { listDistancePricesOf } from "./distance-prices.ts";
import { ADJUST_COLUMNS, PRICE_COLUMNS, toAdjustRule, toPriceRule } from "./prices.ts";

type Row = Record<string, any>;

/** 一个参加报价的商品：domain 要的事实，外加给人看的编号、名称和版本号。 */
export interface QuoteCandidate {
  product: QuoteProduct;
  code: string;
  version: number;
  tenantName: string;
  /** 供应商的入驻状态（试运营的要另查当天的订单数，ADR 0028） */
  tenantStatus: TenantStatus;
  cityId: string;
  countryCode: string;
  /** 接送机商品的接送点坐标（估路线用） */
  pickupPlaceLocation: { lng: number; lat: number } | null;
}

export interface QuoteCandidateFilter {
  cityId: string;
  category: ServiceCategory;
  /** 接送机：接送点；其他品类 null */
  poiId: string | null;
  /** 只取这一个商品（供应商自己试算） */
  productId?: string;
  /** 只取在卖的（`listing` 那一种状态） */
  publishedOnly: boolean;
  /**
   * `publishedOnly` 时「在卖」指哪一种：默认已上架（普通客人、销售端、平台试算）；`qa_listed` 是测试环境的验收会话（M8-26，ADR 0078），
   * 只取 QA 测试供应商的验收可售商品。两种从不混在一起
   */
  listing?: "published" | "qa_listed";
  /**
   * 把这些供应商启用中的每个区域都当作运营范围（不看用途）：迁移 0290 之前，区域还没有用途这一列，迁移会把它们全部填成「运营 + 报价」——
   * 切换前的只读清单（`pnpm areas:role-preview`）用它按「迁移后的用途」回放。报价、试算都不给
   */
  everyAreaOperating?: boolean;
}

const columns = (prefix: string, list: string): string => list.split(", ").map((column) => `${prefix}.${column}`).join(", ");

/**
 * 找商品（报价引擎第 2 步）：同城市、同品类（接送机还要同一个接送点）；城市、接送点要是启用中的。
 * 供应商参不参与比价（试运营、正式才参与）、子品牌是不是停用、区域和车型组是不是启用，都带在事实里由 domain 判断并给出原因。
 */
export async function loadQuoteCandidates(db: Db, filter: QuoteCandidateFilter): Promise<QuoteCandidate[]> {
  const products = await db.query<Row>(
    `select p.id, p.tenant_id, p.code, p.category, p.status, p.version, p.service_rules, p.inventory_mode, p.city_id,
            b.currency, b.rounding_unit, b.status as brand_status,
            t.name as tenant_name, t.status as tenant_status, t.is_test_tenant,
            c.timezone, c.country_code,
            pl.type as place_type, pl.flight_scope, pl.lng as place_lng, pl.lat as place_lat
       from products p
       join brands b on b.tenant_id = p.tenant_id and b.id = p.brand_id
       join tenants t on t.id = p.tenant_id
       join cities c on c.id = p.city_id
       left join places pl on pl.id = p.poi_id
      where p.city_id = $1 and p.category = $2 and c.status = 'active'
        and ($3::uuid is null or (p.poi_id = $3 and pl.status = 'active'))
        and ($4::uuid is null or p.id = $4)
        and (not $5::boolean or (p.status = $6 and ($6 = 'published' or t.is_test_tenant)))
      order by p.tenant_id, p.id`,
    [filter.cityId, filter.category, filter.poiId, filter.productId ?? null, filter.publishedOnly, filter.listing ?? "published"],
  );
  const ids = products.rows.map((row) => row["id"] as string);
  if (ids.length === 0) return [];
  // 租户表的索引都以 tenant_id 开头：带上这批商品所属的租户，查询才走得上索引
  const tenantIds = [...new Set(products.rows.map((row) => row["tenant_id"] as string))];

  const group = <T>(rows: readonly Row[], make: (row: Row) => T): Map<string, T[]> => {
    const grouped = new Map<string, T[]>();
    for (const row of rows) grouped.set(row["product_id"], [...(grouped.get(row["product_id"]) ?? []), make(row)]);
    return grouped;
  };
  const areas = await db.query<Row>(
    `select pa.product_id, pa.area_id, a.status
       from product_areas pa join areas a on a.tenant_id = pa.tenant_id and a.id = pa.area_id
      where pa.tenant_id = any($2::uuid[]) and pa.product_id = any($1::uuid[])
      order by pa.product_id, pa.priority, pa.area_id`,
    [ids, tenantIds],
  );
  // 包车的加价区域（ADR 0073）：区域加价规则用到的区域，不在商品的区域列表里；它们的状态和图形一起取
  const surchargeRows = await db.query<Row>(
    `select distinct r.product_id, r.area_id, a.status
       from price_rules r join areas a on a.tenant_id = r.tenant_id and a.id = r.area_id
      where r.tenant_id = any($2::uuid[]) and r.product_id = any($1::uuid[]) and r.pricing_model = 'charter_area_surcharge'
      order by r.product_id, r.area_id`,
    [ids, tenantIds],
  );
  // 运营范围（ADR 0075）：这些供应商启用中的运营区域和「运营 + 报价」区域，不限城市；按商品的品类挑业务类型相容的
  const operatingRows = await db.query<Row>(
    `select tenant_id, id, biz_type, ${filter.everyAreaOperating === true ? "'both' as role" : "role"} from areas where tenant_id = any($1::uuid[]) and status = 'active' ${filter.everyAreaOperating === true ? "" : "and role in ('operating', 'both')"} order by tenant_id, created_at, id`,
    [tenantIds],
  );
  const areaIds = [...new Set([...areas.rows, ...surchargeRows.rows].map((row) => row["area_id"] as string).concat(operatingRows.rows.map((row) => row["id"] as string)))];
  const polygons = areaIds.length === 0 ? { rows: [] as Row[] } : await db.query<Row>("select id, area_id, kind, geometry from area_polygons where tenant_id = any($2::uuid[]) and area_id = any($1::uuid[]) order by area_id, position, id", [areaIds, tenantIds]);
  const shapes = new Map<string, { id: string; kind: "operate" | "forbid"; ring: Position[] }[]>();
  for (const row of polygons.rows) shapes.set(row["area_id"], [...(shapes.get(row["area_id"]) ?? []), { id: row["id"], kind: row["kind"], ring: (row["geometry"] as { coordinates: Position[][] }).coordinates[0] ?? [] }]);
  const areasByProduct = group(areas.rows, (row) => ({ areaId: row["area_id"] as string, active: row["status"] === "active", shapes: shapes.get(row["area_id"]) ?? [] }));
  const surchargeAreasByProduct = group(surchargeRows.rows, (row) => ({ areaId: row["area_id"] as string, active: row["status"] === "active", shapes: shapes.get(row["area_id"]) ?? [] }));
  const operatingByTenant = new Map<string, (QuoteArea & { bizType: AreaBizType })[]>();
  for (const row of operatingRows.rows) {
    operatingByTenant.set(row["tenant_id"], [...(operatingByTenant.get(row["tenant_id"]) ?? []), { areaId: row["id"], active: true, bizType: row["biz_type"], role: row["role"], shapes: shapes.get(row["id"]) ?? [] }]);
  }
  // 用途（M8-36 补充）：用途是「运营」的区域的禁行区挡这家所有商品；迁移前回放（everyAreaOperating）还没有 role 列，按迁移后的 both 算
  const operatingAreas = (tenantId: string, category: ServiceCategory): QuoteArea[] =>
    (operatingByTenant.get(tenantId) ?? []).filter((area) => areaUsableByCategory(category, area.bizType)).map(({ areaId, active, role, shapes: areaShapes }) => ({ areaId, active, ...(role === undefined ? {} : { role }), shapes: areaShapes }));

  const vehicleGroups = await db.query<Row>(
    `select pv.product_id, pv.vehicle_group_id, pv.passengers, pv.luggage, vg.status
       from product_vehicle_groups pv join vehicle_groups vg on vg.id = pv.vehicle_group_id
      where pv.tenant_id = any($2::uuid[]) and pv.product_id = any($1::uuid[])
      order by pv.product_id, pv.position, pv.vehicle_group_id`,
    [ids, tenantIds],
  );
  const groupsByProduct = group(vehicleGroups.rows, (row) => ({ vehicleGroupId: row["vehicle_group_id"] as string, passengers: row["passengers"] as number, luggage: row["luggage"] as number, active: row["status"] === "active" }));

  const prices = await db.query<Row>(`select r.product_id, ${columns("r", PRICE_COLUMNS)} from price_rules r where r.tenant_id = any($2::uuid[]) and r.product_id = any($1::uuid[]) order by r.product_id, r.created_at, r.id`, [ids, tenantIds]);
  const pricesByProduct = group(prices.rows, toPriceRule);
  const adjusts = await db.query<Row>(`select a.product_id, ${columns("a", ADJUST_COLUMNS)} from adjust_rules a where a.tenant_id = any($2::uuid[]) and a.product_id = any($1::uuid[]) order by a.product_id, a.position, a.id`, [ids, tenantIds]);
  const adjustsByProduct = group(adjusts.rows, toAdjustRule);
  // 计程价（M8-30，ADR 0080）：只有接送机、点对点用；没设的商品不带这一项（事实和以前逐字节相同）
  const distanceByProduct = new Map<string, { id: string; vehicleGroupId: string; startMinor: number; perKmMinor: number; validFrom: string; validTo: string | null; status: "enabled" | "disabled" }[]>();
  for (const price of await listDistancePricesOf(db, tenantIds, ids)) {
    const { productId, createdAt: _created, updatedAt: _updated, ...fact } = price;
    distanceByProduct.set(productId, [...(distanceByProduct.get(productId) ?? []), fact]);
  }

  const addonIds = [...new Set(products.rows.flatMap((row) => (row["service_rules"] as ServiceRules).addons.map((addon) => addon.addonId)))];
  const addons = addonIds.length === 0 ? { rows: [] as Row[] } : await db.query<Row>("select id, status, categories, charge_unit from addons where id = any($1::uuid[])", [addonIds]);
  const addonById = new Map(addons.rows.map((row) => [row["id"] as string, row]));

  return products.rows.map((row): QuoteCandidate => {
    const serviceRules = row["service_rules"] as ServiceRules;
    const category = row["category"] as ServiceCategory;
    return {
      code: row["code"],
      version: row["version"],
      tenantName: row["tenant_name"],
      tenantStatus: row["tenant_status"],
      cityId: row["city_id"],
      countryCode: row["country_code"],
      pickupPlaceLocation: row["place_lng"] === null ? null : { lng: Number(row["place_lng"]), lat: Number(row["place_lat"]) },
      product: {
        productId: row["id"],
        tenantId: row["tenant_id"],
        category,
        status: row["status"],
        tenantActive: tenantBids(row["tenant_status"]),
        tenantRefusal: row["tenant_status"] === "suspended" ? "TENANT_SUSPENDED" : "TENANT_NOT_ONBOARDED",
        // 只在是测试供应商时带（别的商品的事实和以前逐字节相同）
        ...(row["is_test_tenant"] === true ? { testTenant: true } : {}),
        brandActive: row["brand_status"] === "active",
        currency: row["currency"] as CurrencyCode,
        roundingUnit: row["rounding_unit"],
        timeZone: row["timezone"],
        pickupPlace: row["place_type"] === null ? null : { type: row["place_type"], flightScope: row["flight_scope"] },
        areas: areasByProduct.get(row["id"]) ?? [],
        surchargeAreas: surchargeAreasByProduct.get(row["id"]) ?? [],
        operatingAreas: operatingAreas(row["tenant_id"], category),
        vehicleGroups: groupsByProduct.get(row["id"]) ?? [],
        serviceRules,
        addonCatalog: serviceRules.addons.flatMap((chosen) => {
          const addon = addonById.get(chosen.addonId);
          return addon === undefined ? [] : [{ addonId: chosen.addonId, chargeUnit: addon["charge_unit"] as AddonChargeUnit, usable: addon["status"] === "active" && (addon["categories"] as string[]).includes(category) }];
        }),
        priceRules: pricesByProduct.get(row["id"]) ?? [],
        adjustRules: adjustsByProduct.get(row["id"]) ?? [],
        ...(category !== "charter" && distanceByProduct.has(row["id"]) ? { distancePrices: distanceByProduct.get(row["id"]) ?? [] } : {}),
        inventoryMode: row["inventory_mode"],
      },
    };
  });
}

/** 这些商品在某一天的库存（商品级的那一行；按车型组的库存二期才开放）。没设过的商品不在返回里。 */
export async function loadInventoryOnDay(db: Db, entries: readonly { tenantId: string; productId: string; date: string }[]): Promise<Map<string, InventoryDay>> {
  if (entries.length === 0) return new Map();
  const result = await db.query<Row>(
    `select d.product_id, d.total, d.held, d.sold
       from inventory_days d
       join unnest($1::uuid[], $2::date[]) as wanted(product_id, day) on wanted.product_id = d.product_id and wanted.day = d.day
      where d.tenant_id = any($3::uuid[]) and d.vehicle_group_id is null`,
    [entries.map((entry) => entry.productId), entries.map((entry) => entry.date), [...new Set(entries.map((entry) => entry.tenantId))]],
  );
  return new Map(result.rows.map((row) => [row["product_id"] as string, { total: row["total"], held: row["held"], sold: row["sold"] }]));
}

/** 城市的时区、国家、状态；接送点的类型、所属城市、坐标、状态（找商品之前核对请求用）。 */
export async function findQuoteCity(db: Db, cityId: string): Promise<{ id: string; timezone: string; countryCode: string; active: boolean } | null> {
  const result = await db.query<Row>("select id, timezone, country_code, status from cities where id = $1", [cityId]);
  const row = result.rows[0];
  return row === undefined ? null : { id: row["id"], timezone: row["timezone"], countryCode: row["country_code"], active: row["status"] === "active" };
}

export async function findQuotePlace(db: Db, placeId: string): Promise<{ id: string; type: string; cityId: string | null; active: boolean; location: { lng: number; lat: number } } | null> {
  const result = await db.query<Row>("select id, type, city_id, status, lng, lat from places where id = $1", [placeId]);
  const row = result.rows[0];
  return row === undefined ? null : { id: row["id"], type: row["type"], cityId: row["city_id"], active: row["status"] === "active", location: { lng: Number(row["lng"]), lat: Number(row["lat"]) } };
}
