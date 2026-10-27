/**
 * 运营后台下拉框用的主数据选项（M4-13，ADR 0046）：只取下拉需要的几列，不分页，按编码排序。
 * 城市范围（数据范围限定了城市时）在 SQL 里过滤：`cityIds` 为 null 不限，数组为只要这几个城市的（空数组一个都没有）。
 */
import type { AddonChargeUnit, LocalizedText, MasterDataStatus, PlaceType, ServiceCategory } from "@nozomi/domain";
import type { Db } from "../db/context.ts";

export interface CityOption {
  id: string;
  code: string;
  name: LocalizedText;
  countryCode: string;
  timezone: string;
  status: MasterDataStatus;
}

export interface VehicleGroupOption {
  id: string;
  code: string;
  name: LocalizedText;
}

export interface PlaceOption {
  id: string;
  code: string;
  type: PlaceType;
  name: LocalizedText;
}

export interface AddonOption {
  id: string;
  code: string;
  name: LocalizedText;
  description: LocalizedText;
  categories: ServiceCategory[];
  chargeUnit: AddonChargeUnit;
  status: MasterDataStatus;
}

export async function selectCityOptions(db: Db, filter: { includeDisabled: boolean; cityIds: readonly string[] | null }): Promise<CityOption[]> {
  const result = await db.query<{ id: string; code: string; name: LocalizedText; country_code: string; timezone: string; status: MasterDataStatus }>(
    `select id, code, name, country_code, timezone, status
       from cities
      where ($1 or status = 'active')
        and ($2::uuid[] is null or id = any($2::uuid[]))
      order by code, id`,
    [filter.includeDisabled, filter.cityIds],
  );
  return result.rows.map((row) => ({ id: row.id, code: row.code, name: row.name, countryCode: row.country_code, timezone: row.timezone, status: row.status }));
}

export async function selectVehicleGroupOptions(db: Db): Promise<VehicleGroupOption[]> {
  const result = await db.query<VehicleGroupOption>(`select id, code, name from vehicle_groups where status = 'active' order by code, id`);
  return result.rows.map((row) => ({ id: row.id, code: row.code, name: row.name }));
}

/** 某个城市里启用中的地点；城市本身停用了也照样列（地点是否可用看地点自己的状态）。 */
export async function selectPlaceOptions(db: Db, filter: { cityId: string; types: readonly PlaceType[]; cityIds: readonly string[] | null }): Promise<PlaceOption[]> {
  const result = await db.query<PlaceOption>(
    `select id, code, type, name
       from places
      where status = 'active'
        and city_id = $1
        and type = any($2::text[])
        and ($3::uuid[] is null or city_id = any($3::uuid[]))
      order by code, id`,
    [filter.cityId, filter.types, filter.cityIds],
  );
  return result.rows.map((row) => ({ id: row.id, code: row.code, type: row.type, name: row.name }));
}

export async function selectAddonOptions(db: Db, filter: { includeDisabled: boolean }): Promise<AddonOption[]> {
  const result = await db.query<{ id: string; code: string; name: LocalizedText; description: LocalizedText; categories: ServiceCategory[]; charge_unit: AddonChargeUnit; status: MasterDataStatus }>(
    `select id, code, name, description, categories, charge_unit, status
       from addons
      where ($1 or status = 'active')
      order by code, id`,
    [filter.includeDisabled],
  );
  return result.rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    categories: row.categories,
    chargeUnit: row.charge_unit,
    status: row.status,
  }));
}
