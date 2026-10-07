/**
 * 平台主数据的数据访问：城市、地点、车型组、附加服务（迁移 0007）。
 *
 * 四张表的读写方式完全一样（按编号取、按创建时间翻页、新增、修改时版本号加一），所以共用一套函数，
 * 每张表用一份 `MasterTable` 说明自己有哪些列、怎么把一行变成对象。
 *
 * 这些表不带 tenant_id：平台事务（withPlatformTx）里可以读写，租户事务（withTenantTx）里只能读——
 * 租户角色在数据库里没有写权限。没有删除：主数据只停用。
 */
import type {
  AddonChargeUnit,
  FlightScope,
  GeoJsonMultiPolygon,
  GeoJsonPolygon,
  LocalizedText,
  MasterDataStatus,
  PlaceCategory,
  PlaceType,
  ServiceCategory,
  VehicleCombo,
  VehicleGrade,
  VehiclePower,
} from "@nozomi/domain";
import type { Db } from "../db/context.ts";
import { type Page, type TimeCursor, toPage } from "../pagination.ts";

interface Versioned {
  id: string;
  code: string;
  status: MasterDataStatus;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface City extends Versioned {
  countryCode: string;
  name: LocalizedText;
  timezone: string;
  centerLng: number;
  centerLat: number;
  boundary: GeoJsonPolygon | GeoJsonMultiPolygon | null;
}

export interface Place extends Versioned {
  type: PlaceType;
  countryCode: string;
  cityId: string | null;
  parentId: string | null;
  name: LocalizedText;
  lng: number;
  lat: number;
  category: PlaceCategory | null;
  flightScope: FlightScope | null;
  address: string | null;
  source: string | null;
  sourceRef: string | null;
  sourceSyncedAt: Date | null;
  sourceOverridden: boolean;
}

export interface VehicleGroup extends Versioned {
  grade: VehicleGrade;
  seats: number;
  name: LocalizedText;
  sampleModels: string[];
  power: VehiclePower;
  combos: VehicleCombo[];
}

export interface Addon extends Versioned {
  categories: ServiceCategory[];
  chargeUnit: AddonChargeUnit;
  name: LocalizedText;
  description: LocalizedText;
}

/** 数据库里的一行：列名 → 值。numeric 列由驱动以字符串给出。 */
type Row = Record<string, any>;

export interface MasterTable<Item extends Versioned> {
  table: string;
  /** 除 id、status、version、created_at、updated_at 之外的列 */
  columns: readonly string[];
  /** 类型是 jsonb 的列：写入时要先转成 JSON 文本（驱动会把数组当成 PostgreSQL 数组） */
  jsonColumns: readonly string[];
  /** 编码唯一索引的名字：用来认出「编码已被使用」 */
  codeConstraint: string;
  toItem(row: Row): Item;
}

function versioned(row: Row): Versioned {
  return {
    id: row["id"],
    code: row["code"],
    status: row["status"],
    version: row["version"],
    createdAt: row["created_at"],
    updatedAt: row["updated_at"],
  };
}

export const CITIES: MasterTable<City> = {
  table: "cities",
  columns: ["code", "country_code", "name", "timezone", "center_lng", "center_lat", "boundary"],
  jsonColumns: ["name", "boundary"],
  codeConstraint: "cities_code_key",
  toItem: (row) => ({
    ...versioned(row),
    countryCode: row["country_code"],
    name: row["name"],
    timezone: row["timezone"],
    centerLng: Number(row["center_lng"]),
    centerLat: Number(row["center_lat"]),
    boundary: row["boundary"],
  }),
};

export const PLACES: MasterTable<Place> = {
  table: "places",
  columns: [
    "type",
    "code",
    "country_code",
    "city_id",
    "parent_id",
    "name",
    "lng",
    "lat",
    "category",
    "flight_scope",
    "address",
    "source",
    "source_ref",
    "source_synced_at",
    "source_overridden",
  ],
  jsonColumns: ["name"],
  codeConstraint: "places_code_key",
  toItem: (row) => ({
    ...versioned(row),
    type: row["type"],
    countryCode: row["country_code"],
    cityId: row["city_id"],
    parentId: row["parent_id"],
    name: row["name"],
    lng: Number(row["lng"]),
    lat: Number(row["lat"]),
    category: row["category"],
    flightScope: row["flight_scope"],
    address: row["address"],
    source: row["source"],
    sourceRef: row["source_ref"],
    sourceSyncedAt: row["source_synced_at"],
    sourceOverridden: row["source_overridden"],
  }),
};

export const VEHICLE_GROUPS: MasterTable<VehicleGroup> = {
  table: "vehicle_groups",
  columns: ["code", "grade", "seats", "name", "sample_models", "power", "combos"],
  jsonColumns: ["name", "sample_models", "combos"],
  codeConstraint: "vehicle_groups_code_key",
  toItem: (row) => ({
    ...versioned(row),
    grade: row["grade"],
    seats: row["seats"],
    name: row["name"],
    sampleModels: row["sample_models"],
    power: row["power"],
    combos: row["combos"],
  }),
};

export const ADDONS: MasterTable<Addon> = {
  table: "addons",
  columns: ["code", "categories", "charge_unit", "name", "description"],
  jsonColumns: ["name", "description"],
  codeConstraint: "addons_code_key",
  toItem: (row) => ({
    ...versioned(row),
    categories: row["categories"],
    chargeUnit: row["charge_unit"],
    name: row["name"],
    description: row["description"],
  }),
};

/** 要写入的列 → 值。只能出现这张表说明里列出的列。 */
export type ColumnValues = Readonly<Record<string, unknown>>;

function selectList(spec: MasterTable<any>): string {
  return ["id", ...spec.columns, "status", "version", "created_at", "updated_at"].join(", ");
}

/** 把一组列值变成 SQL 的占位符和参数；jsonb 列转成 JSON 文本并显式转换类型。 */
function bind(spec: MasterTable<any>, values: ColumnValues, offset: number): { columns: string[]; placeholders: string[]; params: unknown[] } {
  const columns: string[] = [];
  const placeholders: string[] = [];
  const params: unknown[] = [];
  for (const [column, value] of Object.entries(values)) {
    if (!spec.columns.includes(column)) throw new Error(`${spec.table} 没有可写的列 ${column}`);
    columns.push(column);
    params.push(spec.jsonColumns.includes(column) && value !== null ? JSON.stringify(value) : value);
    placeholders.push(`$${offset + params.length}${spec.jsonColumns.includes(column) ? "::jsonb" : ""}`);
  }
  return { columns, placeholders, params };
}

export async function insertMasterRow<Item extends Versioned>(
  db: Db,
  spec: MasterTable<Item>,
  values: ColumnValues,
  status: MasterDataStatus,
  now: Date,
): Promise<Item> {
  const bound = bind(spec, values, 2);
  const result = await db.query<Row>(
    `insert into ${spec.table} (status, created_at, updated_at, ${bound.columns.join(", ")})
     values ($1, $2, $2, ${bound.placeholders.join(", ")})
     returning ${selectList(spec)}`,
    [status, now, ...bound.params],
  );
  return spec.toItem(result.rows[0] as Row);
}

/** 修改一行：版本号加一、更新时间改为现在。`values` 可以为空（只改状态时）。 */
export async function updateMasterRow<Item extends Versioned>(
  db: Db,
  spec: MasterTable<Item>,
  id: string,
  values: ColumnValues,
  status: MasterDataStatus,
  now: Date,
): Promise<Item> {
  const updated = await updateMasterRowAtVersion(db, spec, id, null, values, status, now);
  if (!updated) throw new Error(`${spec.table} 里没有要修改的那一行`);
  return updated;
}

/**
 * 只在这一行还是 `expectedVersion` 这个版本时才修改（null = 不核对，调用方已经锁住这一行）。
 * 版本对不上（别人在这期间改过）时什么都不改，返回 null。
 */
export async function updateMasterRowAtVersion<Item extends Versioned>(
  db: Db,
  spec: MasterTable<Item>,
  id: string,
  expectedVersion: number | null,
  values: ColumnValues,
  status: MasterDataStatus,
  now: Date,
): Promise<Item | null> {
  const bound = bind(spec, values, 4);
  const assignments = bound.columns.map((column, index) => `, ${column} = ${bound.placeholders[index]}`).join("");
  const result = await db.query<Row>(
    `update ${spec.table}
        set status = $2, updated_at = $3, version = version + 1${assignments}
      where id = $1 and ($4::integer is null or version = $4)
      returning ${selectList(spec)}`,
    [id, status, now, expectedVersion, ...bound.params],
  );
  const row = result.rows[0];
  return row ? spec.toItem(row) : null;
}

/** 只读出一个地点的上级编号（不加锁）。 */
export async function findPlaceParentId(db: Db, placeId: string): Promise<string | null> {
  const result = await db.query<{ parent_id: string | null }>("select parent_id from places where id = $1", [placeId]);
  return result.rows[0]?.parent_id ?? null;
}

/**
 * 抢「机场导入」这把锁（事务结束自动释放）：同一个库、同一个 schema 里同一时间只允许一次导入。
 * 抢不到立即返回 false，不排队。
 */
export async function tryLockAirportImport(db: Db): Promise<boolean> {
  const result = await db.query<{ locked: boolean }>(
    "select pg_try_advisory_xact_lock(hashtextextended(current_database() || '.' || current_schema() || '.masterdata.import-airports', 0)) as locked",
  );
  return result.rows[0]?.locked === true;
}

/** 按编号取一行。`lock` 为真时锁住这一行直到事务结束（修改前用；租户事务没有这个权限，只能传 false）。 */
export async function findMasterRow<Item extends Versioned>(
  db: Db,
  spec: MasterTable<Item>,
  id: string,
  options: { lock: boolean },
): Promise<Item | null> {
  const result = await db.query<Row>(
    `select ${selectList(spec)} from ${spec.table} where id = $1 ${options.lock ? "for update" : ""}`,
    [id],
  );
  const row = result.rows[0];
  return row ? spec.toItem(row) : null;
}

/** 列表的筛选条件：列名 → 值（相等），外加状态和「这个时间之后改过的」。 */
export interface MasterFilter {
  equals?: ColumnValues;
  status?: MasterDataStatus | undefined;
  updatedSince?: Date | undefined;
}

/** 按创建时间从早到晚翻页。 */
export async function listMasterRows<Item extends Versioned>(
  db: Db,
  spec: MasterTable<Item>,
  filter: MasterFilter,
  limit: number,
  after: TimeCursor | null,
): Promise<Page<Item>> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  /** `sql` 里的每个 `?` 依次对应 `values` 里的一个值 */
  const where = (sql: string, ...values: unknown[]): void => {
    let used = 0;
    conditions.push(sql.replace(/\?/g, () => `$${params.push(values[used++])}`));
  };
  for (const [column, value] of Object.entries(filter.equals ?? {})) {
    if (!spec.columns.includes(column)) throw new Error(`${spec.table} 没有可筛选的列 ${column}`);
    where(`${column} = ?`, value);
  }
  if (filter.status !== undefined) where("status = ?", filter.status);
  if (filter.updatedSince !== undefined) where("updated_at >= ?", filter.updatedSince);
  if (after !== null) where("(created_at, id) > (?::timestamptz, ?::uuid)", after.t, after.id);
  params.push(limit + 1);
  const result = await db.query<Row & { cursor_time: string }>(
    `select ${selectList(spec)}, created_at::text as cursor_time
       from ${spec.table}
      ${conditions.length > 0 ? `where ${conditions.join(" and ")}` : ""}
      order by created_at, id
      limit $${params.length}`,
    params,
  );
  return toPage(result.rows, limit, spec.toItem, (row) => ({ t: row.cursor_time, id: row["id"] as string }));
}

/**
 * 数据库认不认识这个时区名（逐字比较，区分大小写）。数据库的时区名单就是 IANA 的名单，含别名（如 Asia/Kolkata）。
 */
export async function isKnownTimeZone(db: Db, name: string): Promise<boolean> {
  const result = await db.query<{ known: boolean }>("select exists (select 1 from pg_timezone_names where name = $1) as known", [name]);
  return result.rows[0]?.known === true;
}

/** 某个城市下启用中的地点数量（停用城市前检查）。 */
export async function countActivePlacesInCity(db: Db, cityId: string): Promise<number> {
  const result = await db.query<{ n: number }>("select count(*)::int as n from places where city_id = $1 and status = 'active'", [cityId]);
  return result.rows[0]?.n ?? 0;
}

/** 某个地点下启用中的航站楼 / 出口数量（停用机场、车站前检查）。 */
export async function countActiveChildPlaces(db: Db, parentId: string): Promise<number> {
  const result = await db.query<{ n: number }>("select count(*)::int as n from places where parent_id = $1 and status = 'active'", [parentId]);
  return result.rows[0]?.n ?? 0;
}

/** 机场、车站换了城市时，它下面的航站楼、出口跟着换。返回跟着改了的数量。 */
export async function moveChildPlacesToCity(db: Db, parentId: string, cityId: string, now: Date): Promise<number> {
  const result = await db.query(
    "update places set city_id = $2, updated_at = $3, version = version + 1 where parent_id = $1 and city_id is distinct from $2",
    [parentId, cityId, now],
  );
  return result.rowCount ?? 0;
}

/** 全部机场（手工录入的和导入的都算），给导入命令做比较用。 */
export async function listAllAirports(db: Db): Promise<Place[]> {
  const result = await db.query<Row>(`select ${selectList(PLACES)} from places where type = 'airport' order by code`);
  return result.rows.map(PLACES.toItem);
}

/** 记下这些导入的机场刚刚和数据源核对过。不算一次修改：版本号和更新时间不变。 */
export async function markAirportsSynced(db: Db, source: string, sourceRefs: readonly string[], now: Date): Promise<void> {
  await db.query("update places set source_synced_at = $3 where source = $1 and source_ref = any($2::text[])", [source, sourceRefs, now]);
}
