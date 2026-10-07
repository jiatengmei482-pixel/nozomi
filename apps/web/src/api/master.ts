/**
 * 运营后台主数据（城市、地点、车型组、附加服务）和首页统计的接口。
 * 类型手写，与 `apps/api/openapi.yaml` 对账（`master.contract.test.ts`）。
 * 四类主数据的接口形状相同：列表（游标分页 + 总数）、单条、新增、修改（If-Match 带版本号）、停用、启用。
 */
import type {
  AddonChargeUnit,
  FlightScope,
  LocalizedText,
  MasterDataStatus,
  PlaceCategory,
  PlaceType,
  ServiceCategory,
  VehicleCombo,
  VehicleGrade,
  VehiclePower,
} from "@nozomi/domain";
import { apiRequest } from "./client.ts";

export interface Point {
  lng: number;
  lat: number;
}

interface MasterRecord {
  id: string;
  code: string;
  name: LocalizedText;
  status: MasterDataStatus;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface City extends MasterRecord {
  country_code: string;
  timezone: string;
  center: Point;
  /** GeoJSON 边界；本期界面只看有没有，不编辑、不提交 */
  boundary: unknown | null;
}

export interface MasterRef {
  id: string;
  code: string;
  name: LocalizedText;
}

export interface PlaceParentRef extends MasterRef {
  type: PlaceType;
}

export interface PlaceSource {
  name: "ourairports";
  ref: string;
  synced_at: string;
  overridden: boolean;
}

export interface Place extends MasterRecord {
  type: PlaceType;
  country_code: string;
  city_id: string | null;
  parent_id: string | null;
  city: MasterRef | null;
  parent: PlaceParentRef | null;
  location: Point;
  category: PlaceCategory | null;
  flight_scope: FlightScope | null;
  address: string | null;
  source: PlaceSource | null;
}

export interface VehicleGroup extends MasterRecord {
  grade: VehicleGrade;
  seats: number;
  sample_models: string[];
  power: VehiclePower;
  combos: VehicleCombo[];
}

export interface Addon extends MasterRecord {
  categories: ServiceCategory[];
  charge_unit: AddonChargeUnit;
  description: LocalizedText;
}

export interface CityCreate {
  code: string;
  country_code: string;
  name: LocalizedText;
  timezone: string;
  center: Point;
}
export type CityPatch = Partial<Pick<CityCreate, "name" | "timezone" | "center">>;

export interface PlaceCreate {
  type: PlaceType;
  code: string;
  city_id?: string;
  parent_id?: string;
  name: LocalizedText;
  location: Point;
  category?: PlaceCategory;
  flight_scope?: FlightScope | null;
  address?: string | null;
}
export interface PlacePatch {
  city_id?: string;
  name?: LocalizedText;
  location?: Point;
  category?: PlaceCategory;
  flight_scope?: FlightScope | null;
  address?: string | null;
}

export interface VehicleGroupCreate {
  code: string;
  grade: VehicleGrade;
  seats: number;
  name: LocalizedText;
  sample_models: string[];
  power: VehiclePower;
  combos: VehicleCombo[];
}
export type VehicleGroupPatch = Partial<Pick<VehicleGroupCreate, "name" | "sample_models" | "power" | "combos">>;

export interface AddonCreate {
  code: string;
  categories: ServiceCategory[];
  charge_unit: AddonChargeUnit;
  name: LocalizedText;
  description: LocalizedText;
}
export type AddonPatch = Partial<Pick<AddonCreate, "categories" | "charge_unit" | "name" | "description">>;

export interface StatusCounts {
  total: number;
  active: number;
  disabled: number;
}

export interface DashboardSummary {
  /** 当前角色不能看供应商时为 null */
  tenants: { total: number; active: number; suspended: number } | null;
  /** 当前角色不能看主数据时为 null */
  master_data: {
    cities: StatusCounts;
    places: StatusCounts & { by_type: Record<PlaceType, StatusCounts>; airports_without_city: number };
    vehicle_groups: StatusCounts;
    addons: StatusCounts;
  } | null;
}

/** 四类主数据各自的类型。 */
export interface MasterKinds {
  cities: { record: City; create: CityCreate; patch: CityPatch };
  places: { record: Place; create: PlaceCreate; patch: PlacePatch };
  "vehicle-groups": { record: VehicleGroup; create: VehicleGroupCreate; patch: VehicleGroupPatch };
  addons: { record: Addon; create: AddonCreate; patch: AddonPatch };
}
export type MasterKind = keyof MasterKinds;
export const MASTER_KINDS = ["cities", "places", "vehicle-groups", "addons"] as const satisfies readonly MasterKind[];

export const MASTER_BASE = "/platform/v1/master";
export const DASHBOARD_SUMMARY_PATH = "/platform/v1/dashboard/summary";

/** 列表接口认的查询参数（名字与 openapi.yaml 一致）。 */
export interface MasterListQuery {
  limit?: number;
  cursor?: string;
  status?: MasterDataStatus | "all";
  q?: string;
  country_code?: string;
  type?: PlaceType;
  /** 城市编号；`none` = 还没有所属城市 */
  city_id?: string;
  parent_id?: string;
  grade?: VehicleGrade;
  /** `code`：按编码升序；不给是按创建时间。游标和排序绑定，翻页时要带同一个 */
  sort?: "created" | "code";
}
export const MASTER_LIST_QUERY_KEYS = ["limit", "cursor", "status", "q", "country_code", "type", "city_id", "parent_id", "grade", "sort"] as const satisfies readonly (keyof MasterListQuery)[];

export interface MasterPage<T> {
  items: T[];
  next_cursor: string | null;
  total: number;
}

function withQuery(path: string, query: MasterListQuery): string {
  const params = new URLSearchParams();
  for (const key of MASTER_LIST_QUERY_KEYS) {
    const value = query[key];
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const text = params.toString();
  return text === "" ? path : `${path}?${text}`;
}

export function listMaster<K extends MasterKind>(kind: K, token: string, query: MasterListQuery): Promise<MasterPage<MasterKinds[K]["record"]>> {
  return apiRequest("GET", withQuery(`${MASTER_BASE}/${kind}`, query), { token });
}

/** 把符合条件的记录按游标全部取回来（每次 200 条）。只用在数量有限的清单上（城市、某个机场的航站楼）。 */
export async function listAllMaster<K extends MasterKind>(kind: K, token: string, query: MasterListQuery): Promise<MasterKinds[K]["record"][]> {
  const all: MasterKinds[K]["record"][] = [];
  let cursor: string | undefined;
  do {
    const page = await listMaster(kind, token, { ...query, limit: 200, ...(cursor !== undefined ? { cursor } : {}) });
    all.push(...page.items);
    cursor = page.next_cursor ?? undefined;
  } while (cursor !== undefined);
  return all;
}

export function getMaster<K extends MasterKind>(kind: K, token: string, id: string): Promise<MasterKinds[K]["record"]> {
  return apiRequest("GET", `${MASTER_BASE}/${kind}/${encodeURIComponent(id)}`, { token });
}

export function createMaster<K extends MasterKind>(kind: K, token: string, body: MasterKinds[K]["create"]): Promise<MasterKinds[K]["record"]> {
  return apiRequest("POST", `${MASTER_BASE}/${kind}`, { token, body });
}

/** 修改：只带改过的字段；`version` 是打开页面时拿到的版本号，放在 If-Match 里。 */
export function patchMaster<K extends MasterKind>(kind: K, token: string, id: string, version: number, body: MasterKinds[K]["patch"]): Promise<MasterKinds[K]["record"]> {
  return apiRequest("PATCH", `${MASTER_BASE}/${kind}/${encodeURIComponent(id)}`, { token, body, headers: { "if-match": `"${version}"` } });
}

export function disableMaster<K extends MasterKind>(kind: K, token: string, id: string): Promise<MasterKinds[K]["record"]> {
  return apiRequest("POST", `${MASTER_BASE}/${kind}/${encodeURIComponent(id)}/disable`, { token });
}

/** 启用。地点可以同时指定城市（只对还没有城市的地点有效），两件事在后端是一个事务。 */
export function enableMaster<K extends MasterKind>(kind: K, token: string, id: string, cityId?: string): Promise<MasterKinds[K]["record"]> {
  return apiRequest("POST", `${MASTER_BASE}/${kind}/${encodeURIComponent(id)}/enable`, { token, ...(cityId !== undefined ? { body: { city_id: cityId } } : {}) });
}

export function fetchDashboardSummary(token: string): Promise<DashboardSummary> {
  return apiRequest("GET", DASHBOARD_SUMMARY_PATH, { token });
}

/** 对账用：每个类型的字段名清单（`satisfies` 保证清单里没有类型上不存在的字段）。 */
const RECORD = ["id", "code", "name", "status", "version", "created_at", "updated_at"] as const;
export const MASTER_SCHEMA_FIELDS = {
  City: [...RECORD, "country_code", "timezone", "center", "boundary"],
  Place: [...RECORD, "type", "country_code", "city_id", "parent_id", "city", "parent", "location", "category", "flight_scope", "address", "source"],
  VehicleGroup: [...RECORD, "grade", "seats", "sample_models", "power", "combos"],
  Addon: [...RECORD, "categories", "charge_unit", "description"],
  MasterRef: ["id", "code", "name"],
  PlaceParentRef: ["id", "code", "name", "type"],
  StatusCounts: ["total", "active", "disabled"],
  Point: ["lng", "lat"],
} as const satisfies {
  City: readonly (keyof City)[];
  Place: readonly (keyof Place)[];
  VehicleGroup: readonly (keyof VehicleGroup)[];
  Addon: readonly (keyof Addon)[];
  MasterRef: readonly (keyof MasterRef)[];
  PlaceParentRef: readonly (keyof PlaceParentRef)[];
  StatusCounts: readonly (keyof StatusCounts)[];
  Point: readonly (keyof Point)[];
};

/** 对账用：前端会提交的字段（新增、修改）。必须是 openapi 里对应请求体字段的子集。 */
export const MASTER_WRITE_FIELDS = {
  CityCreate: ["code", "country_code", "name", "timezone", "center"],
  CityPatch: ["name", "timezone", "center"],
  PlaceCreate: ["type", "code", "city_id", "parent_id", "name", "location", "category", "flight_scope", "address"],
  PlacePatch: ["city_id", "name", "location", "category", "flight_scope", "address"],
  VehicleGroupCreate: ["code", "grade", "seats", "name", "sample_models", "power", "combos"],
  VehicleGroupPatch: ["name", "sample_models", "power", "combos"],
  AddonCreate: ["code", "categories", "charge_unit", "name", "description"],
  AddonPatch: ["categories", "charge_unit", "name", "description"],
} as const satisfies {
  CityCreate: readonly (keyof CityCreate)[];
  CityPatch: readonly (keyof CityPatch)[];
  PlaceCreate: readonly (keyof PlaceCreate)[];
  PlacePatch: readonly (keyof PlacePatch)[];
  VehicleGroupCreate: readonly (keyof VehicleGroupCreate)[];
  VehicleGroupPatch: readonly (keyof VehicleGroupPatch)[];
  AddonCreate: readonly (keyof AddonCreate)[];
  AddonPatch: readonly (keyof AddonPatch)[];
};

/** 前端按错误码分别处理的主数据错误。 */
export const MASTER_ERROR_CODES = [
  "VERSION_CONFLICT",
  "CODE_TAKEN",
  "FIELD_LOCKED",
  "MASTER_DATA_IN_USE",
  "MASTER_DATA_NOT_READY",
  "CONCURRENT_UPDATE",
  "PRECONDITION_REQUIRED",
] as const;
