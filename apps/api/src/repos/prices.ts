/**
 * 价格规则、调价规则、节假日日历、子品牌取整单位的读写（M1-04）。
 * 价格规则和调价规则是租户表：只在租户事务里调用，每条语句仍然显式带 tenant_id，行级安全再兜一层。
 * 节假日是平台主数据：平台事务里写，租户事务里只读。
 */
import type { AdjustCycle, AdjustRule, AdjustStep, DailyWindow, LocalizedText, PriceRule, Pricing, ServiceCategory, TripDirection } from "@nozomi/domain";
import type { Db } from "../db/context.ts";

type Row = Record<string, any>;

// ---- 价格规则 ----

export interface StoredPriceRule extends PriceRule {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

// 日期按文字取：驱动会把 date 换成带时区的时刻，再换回来可能差一天
const PRICE_COLUMNS = "id, area_id, vehicle_group_id, direction, package_hours, pricing_model, params, valid_from::text as valid_from, valid_to::text as valid_to, status, created_at, updated_at";

function toPriceRule(row: Row): StoredPriceRule {
  return {
    id: row["id"],
    areaId: row["area_id"],
    vehicleGroupId: row["vehicle_group_id"],
    direction: row["direction"],
    packageHours: row["package_hours"],
    pricing: { model: row["pricing_model"], ...row["params"] } as Pricing,
    validFrom: row["valid_from"],
    validTo: row["valid_to"],
    status: row["status"],
    createdAt: row["created_at"],
    updatedAt: row["updated_at"],
  };
}

function priceValues(rule: PriceRule): unknown[] {
  const { model, ...params } = rule.pricing;
  return [rule.areaId, rule.vehicleGroupId, rule.direction, rule.packageHours, model, JSON.stringify(params), rule.validFrom, rule.validTo, rule.status];
}

/** 一个商品的全部价格规则，按创建的先后。 */
export async function listPriceRules(db: Db, tenantId: string, productId: string): Promise<StoredPriceRule[]> {
  const result = await db.query<Row>(`select ${PRICE_COLUMNS} from price_rules where tenant_id = $1 and product_id = $2 order by created_at, id`, [tenantId, productId]);
  return result.rows.map(toPriceRule);
}

export async function insertPriceRule(db: Db, tenantId: string, productId: string, rule: PriceRule, now: Date): Promise<StoredPriceRule> {
  const result = await db.query<Row>(
    `insert into price_rules (tenant_id, product_id, area_id, vehicle_group_id, direction, package_hours, pricing_model, params, valid_from, valid_to, status, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $12)
     returning ${PRICE_COLUMNS}`,
    [tenantId, productId, ...priceValues(rule), now],
  );
  return toPriceRule(result.rows[0] as Row);
}

export async function updatePriceRule(db: Db, tenantId: string, productId: string, id: string, rule: PriceRule, now: Date): Promise<StoredPriceRule> {
  const result = await db.query<Row>(
    `update price_rules
        set area_id = $4, vehicle_group_id = $5, direction = $6, package_hours = $7, pricing_model = $8, params = $9::jsonb,
            valid_from = $10, valid_to = $11, status = $12, updated_at = $13
      where tenant_id = $1 and product_id = $2 and id = $3
      returning ${PRICE_COLUMNS}`,
    [tenantId, productId, id, ...priceValues(rule), now],
  );
  return toPriceRule(result.rows[0] as Row);
}

export async function deletePriceRules(db: Db, tenantId: string, productId: string, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.query("delete from price_rules where tenant_id = $1 and product_id = $2 and id = any($3::uuid[])", [tenantId, productId, ids]);
}

// ---- 调价规则 ----

export interface StoredAdjustRule extends AdjustRule {
  id: string;
  position: number;
  createdAt: Date;
  updatedAt: Date;
}

const ADJUST_COLUMNS =
  "id, name, travel_from::text as travel_from, travel_to::text as travel_to, cycle, time_slot, area_ids, vehicle_group_ids, directions, package_hours, steps, position, status, created_at, updated_at";

function toAdjustRule(row: Row): StoredAdjustRule {
  return {
    id: row["id"],
    name: row["name"],
    travelFrom: row["travel_from"],
    travelTo: row["travel_to"],
    cycle: row["cycle"] as AdjustCycle,
    timeSlot: row["time_slot"] as DailyWindow | null,
    areaIds: row["area_ids"],
    vehicleGroupIds: row["vehicle_group_ids"],
    directions: row["directions"] as TripDirection[],
    packageHours: row["package_hours"],
    steps: row["steps"] as AdjustStep[],
    position: row["position"],
    status: row["status"],
    createdAt: row["created_at"],
    updatedAt: row["updated_at"],
  };
}

function adjustValues(rule: AdjustRule): unknown[] {
  return [
    rule.name,
    rule.travelFrom,
    rule.travelTo,
    JSON.stringify(rule.cycle),
    rule.timeSlot === null ? null : JSON.stringify(rule.timeSlot),
    rule.areaIds,
    rule.vehicleGroupIds,
    rule.directions,
    rule.packageHours,
    JSON.stringify(rule.steps),
    rule.status,
  ];
}

/** 一个商品的全部调价规则，按执行的先后（顺序即优先级）。 */
export async function listAdjustRules(db: Db, tenantId: string, productId: string): Promise<StoredAdjustRule[]> {
  const result = await db.query<Row>(`select ${ADJUST_COLUMNS} from adjust_rules where tenant_id = $1 and product_id = $2 order by position, created_at, id`, [tenantId, productId]);
  return result.rows.map(toAdjustRule);
}

export async function insertAdjustRule(db: Db, tenantId: string, productId: string, rule: AdjustRule, position: number, now: Date): Promise<StoredAdjustRule> {
  const result = await db.query<Row>(
    `insert into adjust_rules (tenant_id, product_id, name, travel_from, travel_to, cycle, time_slot, area_ids, vehicle_group_ids, directions, package_hours, steps, status, position, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::uuid[], $9::uuid[], $10::text[], $11::int[], $12::jsonb, $13, $14, $15, $15)
     returning ${ADJUST_COLUMNS}`,
    [tenantId, productId, ...adjustValues(rule), position, now],
  );
  return toAdjustRule(result.rows[0] as Row);
}

export async function updateAdjustRule(db: Db, tenantId: string, productId: string, id: string, rule: AdjustRule, now: Date): Promise<StoredAdjustRule> {
  const result = await db.query<Row>(
    `update adjust_rules
        set name = $4, travel_from = $5, travel_to = $6, cycle = $7::jsonb, time_slot = $8::jsonb, area_ids = $9::uuid[], vehicle_group_ids = $10::uuid[],
            directions = $11::text[], package_hours = $12::int[], steps = $13::jsonb, status = $14, updated_at = $15
      where tenant_id = $1 and product_id = $2 and id = $3
      returning ${ADJUST_COLUMNS}`,
    [tenantId, productId, id, ...adjustValues(rule), now],
  );
  return toAdjustRule(result.rows[0] as Row);
}

export async function deleteAdjustRule(db: Db, tenantId: string, productId: string, id: string): Promise<void> {
  await db.query("delete from adjust_rules where tenant_id = $1 and product_id = $2 and id = $3", [tenantId, productId, id]);
}

/** 按给定的先后重排：第 i 个编号的 position = i。 */
export async function setAdjustRuleOrder(db: Db, tenantId: string, productId: string, ids: readonly string[]): Promise<void> {
  await db.query(
    `update adjust_rules a set position = o.position - 1
       from unnest($3::uuid[]) with ordinality as o(id, position)
      where a.tenant_id = $1 and a.product_id = $2 and a.id = o.id`,
    [tenantId, productId, ids],
  );
}

// ---- 子品牌的取整单位 ----

export async function setBrandRoundingUnit(db: Db, tenantId: string, brandId: string, roundingUnit: number, now: Date): Promise<number> {
  const result = await db.query<{ version: number }>(
    "update brands set rounding_unit = $3, updated_at = $4, version = version + 1 where tenant_id = $1 and id = $2 returning version",
    [tenantId, brandId, roundingUnit, now],
  );
  return (result.rows[0] as { version: number }).version;
}

/** 一个子品牌下每个商品「可以卖的价格」（口径同 `sellablePriceRules`）：改取整单位之前用来看哪些价格会受影响。 */
export async function listBrandSellablePrices(db: Db, tenantId: string, brandId: string, now: Date): Promise<{ productId: string; code: string; status: string; rule: StoredPriceRule }[]> {
  const result = await db.query<Row>(
    `select p.id as product_id, p.code, p.status as product_status, ${PRICE_COLUMNS.split(", ").map((column) => `r.${column}`).join(", ")}
       from price_rules r
       join products p on p.tenant_id = r.tenant_id and p.id = r.product_id
       join cities c on c.id = p.city_id
      where r.tenant_id = $1 and p.brand_id = $2 and r.status = 'enabled'
        and (r.valid_to is null or r.valid_to >= ($3::timestamptz at time zone c.timezone)::date)
        and exists (select 1 from product_areas pa where pa.tenant_id = p.tenant_id and pa.product_id = p.id and pa.area_id = r.area_id)
        and exists (select 1 from product_vehicle_groups pv where pv.tenant_id = p.tenant_id and pv.product_id = p.id and pv.vehicle_group_id = r.vehicle_group_id)
      order by p.code, r.created_at, r.id`,
    [tenantId, brandId, now],
  );
  return result.rows.map((row) => ({ productId: row["product_id"], code: row["code"], status: row["product_status"], rule: toPriceRule(row) }));
}

/** 这个区域下的全部价格（跨商品）：删除区域之前取，给连带删除的价格各记一条日志。 */
export async function listPriceRulesInArea(db: Db, tenantId: string, areaId: string): Promise<{ productId: string; rule: StoredPriceRule }[]> {
  const result = await db.query<Row>(`select product_id, ${PRICE_COLUMNS} from price_rules where tenant_id = $1 and area_id = $2 order by product_id, created_at, id`, [tenantId, areaId]);
  return result.rows.map((row) => ({ productId: row["product_id"], rule: toPriceRule(row) }));
}

/** 适用范围里写着这个区域的调价规则（跨商品）。 */
export async function listAdjustRulesWithArea(db: Db, tenantId: string, areaId: string): Promise<{ productId: string; rule: StoredAdjustRule }[]> {
  const result = await db.query<Row>(`select product_id, ${ADJUST_COLUMNS} from adjust_rules where tenant_id = $1 and $2::uuid = any(area_ids) order by product_id, position, id`, [tenantId, areaId]);
  return result.rows.map((row) => ({ productId: row["product_id"], rule: toAdjustRule(row) }));
}

// ---- 各商品的价格概况 ----

export interface ProductPriceOverview {
  productId: string;
  code: string;
  status: string;
  category: ServiceCategory;
  title: LocalizedText;
  city: { id: string; name: LocalizedText };
  /** 商品所在城市当地的今天 */
  today: string;
  inventoryMode: "unlimited" | "limited";
  /** 限量、而从城市当地的今天起没有一天还有可售库存（客人询价时报不出价）。不限量时恒为假 */
  noInventoryAhead: boolean;
  priceRuleCount: number;
  /**
   * 「可以卖的价格」条数：启用、没过期（按商品所在城市当地的今天），而且区域和车型组都是商品现在选着的
   * （和上架校验用的 domain `sellablePriceRules` 是同一个口径）
   */
  activePriceRuleCount: number;
  enabledAdjustRuleCount: number;
}

/** 本租户每个商品的价格概况，按最近修改从新到旧。「今天」按每个商品所在城市的时区各自算。 */
export async function listProductPriceOverview(db: Db, tenantId: string, now: Date, limit: number): Promise<ProductPriceOverview[]> {
  const result = await db.query<Row>(
    `select p.id, p.code, p.status, p.category, p.content, c.id as city_id, c.name as city_name,
            ($2::timestamptz at time zone c.timezone)::date::text as today,
            p.inventory_mode,
            (p.inventory_mode = 'limited' and not exists (
               select 1 from inventory_days d
                where d.tenant_id = p.tenant_id and d.product_id = p.id and d.vehicle_group_id is null
                  and d.day >= ($2::timestamptz at time zone c.timezone)::date and d.total - d.held - d.sold > 0)) as no_inventory_ahead,
            (select count(*)::int from price_rules r where r.tenant_id = p.tenant_id and r.product_id = p.id) as price_rule_count,
            (select count(*)::int from price_rules r
              where r.tenant_id = p.tenant_id and r.product_id = p.id and r.status = 'enabled'
                and (r.valid_to is null or r.valid_to >= ($2::timestamptz at time zone c.timezone)::date)
                and exists (select 1 from product_areas pa where pa.tenant_id = p.tenant_id and pa.product_id = p.id and pa.area_id = r.area_id)
                and exists (select 1 from product_vehicle_groups pv where pv.tenant_id = p.tenant_id and pv.product_id = p.id and pv.vehicle_group_id = r.vehicle_group_id)) as active_price_rule_count,
            (select count(*)::int from adjust_rules a where a.tenant_id = p.tenant_id and a.product_id = p.id and a.status = 'enabled') as enabled_adjust_rule_count
       from products p join cities c on c.id = p.city_id
      where p.tenant_id = $1
      order by p.updated_at desc, p.id desc
      limit $3`,
    [tenantId, now, limit],
  );
  return result.rows.map((row) => ({
    productId: row["id"],
    code: row["code"],
    status: row["status"],
    category: row["category"],
    title: Object.fromEntries(Object.entries(row["content"] as Record<string, { title: string | null }>).flatMap(([language, text]) => (text.title === null ? [] : [[language, text.title]]))),
    city: { id: row["city_id"], name: row["city_name"] },
    today: row["today"],
    inventoryMode: row["inventory_mode"],
    noInventoryAhead: row["no_inventory_ahead"],
    priceRuleCount: row["price_rule_count"],
    activePriceRuleCount: row["active_price_rule_count"],
    enabledAdjustRuleCount: row["enabled_adjust_rule_count"],
  }));
}

/**
 * 整个供应商每个商品算缺价概况要用的东西：选的区域、车型组（按商品里的先后）和全部价格规则。
 * 三条查询取回全部，不按商品一个一个查。
 */
export async function listPriceCoverageInputs(db: Db, tenantId: string): Promise<Map<string, { areaIds: string[]; vehicleGroupIds: string[]; rules: StoredPriceRule[] }>> {
  const shapes = new Map<string, { areaIds: string[]; vehicleGroupIds: string[]; rules: StoredPriceRule[] }>();
  const shape = (productId: string) => {
    const found = shapes.get(productId) ?? { areaIds: [], vehicleGroupIds: [], rules: [] };
    shapes.set(productId, found);
    return found;
  };
  for (const row of (await db.query<Row>("select product_id, area_id from product_areas where tenant_id = $1 order by product_id, priority", [tenantId])).rows) shape(row["product_id"]).areaIds.push(row["area_id"]);
  for (const row of (await db.query<Row>("select product_id, vehicle_group_id from product_vehicle_groups where tenant_id = $1 order by product_id, position", [tenantId])).rows) shape(row["product_id"]).vehicleGroupIds.push(row["vehicle_group_id"]);
  for (const row of (await db.query<Row>(`select product_id, ${PRICE_COLUMNS} from price_rules where tenant_id = $1 order by created_at, id`, [tenantId])).rows) shape(row["product_id"]).rules.push(toPriceRule(row));
  return shapes;
}

// ---- 节假日日历 ----

export interface Holiday {
  countryCode: string;
  date: string;
  name: LocalizedText;
  updatedAt: Date;
}

const HOLIDAY_COLUMNS = "country_code, holiday_date::text as holiday_date, name, updated_at";

function toHoliday(row: Row): Holiday {
  return { countryCode: row["country_code"], date: row["holiday_date"], name: row["name"], updatedAt: row["updated_at"] };
}

/** 一段日期里（两端都含）这些国家的节假日；`countryCodes` 为 null = 全部国家。按日期、国家排。 */
export async function listHolidays(db: Db, filter: { countryCodes: readonly string[] | null; from: string; to: string }, limit: number): Promise<Holiday[]> {
  const result = await db.query<Row>(
    `select ${HOLIDAY_COLUMNS} from holidays
      where holiday_date between $1 and $2 and ($3::text[] is null or country_code = any($3::text[]))
      order by holiday_date, country_code
      limit $4`,
    [filter.from, filter.to, filter.countryCodes, limit],
  );
  return result.rows.map(toHoliday);
}

export async function findHoliday(db: Db, countryCode: string, date: string): Promise<Holiday | null> {
  const result = await db.query<Row>(`select ${HOLIDAY_COLUMNS} from holidays where country_code = $1 and holiday_date = $2 for update`, [countryCode, date]);
  const row = result.rows[0];
  return row ? toHoliday(row) : null;
}

export async function upsertHoliday(db: Db, countryCode: string, date: string, name: LocalizedText, now: Date): Promise<Holiday> {
  const result = await db.query<Row>(
    `insert into holidays (country_code, holiday_date, name, created_at, updated_at) values ($1, $2, $3::jsonb, $4, $4)
     on conflict (country_code, holiday_date) do update set name = excluded.name, updated_at = excluded.updated_at
     returning ${HOLIDAY_COLUMNS}`,
    [countryCode, date, JSON.stringify(name), now],
  );
  return toHoliday(result.rows[0] as Row);
}

export async function deleteHoliday(db: Db, countryCode: string, date: string): Promise<void> {
  await db.query("delete from holidays where country_code = $1 and holiday_date = $2", [countryCode, date]);
}

/** 有节假日数据的国家，和各自的条数、最晚的一天。 */
export async function listHolidayCountries(db: Db): Promise<{ countryCode: string; count: number; lastDate: string }[]> {
  const result = await db.query<Row>("select country_code, count(*)::int as n, max(holiday_date)::text as last_date from holidays group by country_code order by country_code");
  return result.rows.map((row) => ({ countryCode: row["country_code"], count: row["n"], lastDate: row["last_date"] }));
}

/** 这些车型组的编码和名称（导出价格表时，商品已经去掉的车型组也要写得出编码）。 */
export async function findVehicleGroupLabels(db: Db, ids: readonly string[]): Promise<Map<string, { code: string; name: LocalizedText }>> {
  if (ids.length === 0) return new Map();
  const result = await db.query<Row>("select id, code, name from vehicle_groups where id = any($1::uuid[])", [ids]);
  return new Map(result.rows.map((row) => [row["id"] as string, { code: row["code"] as string, name: row["name"] as LocalizedText }]));
}
