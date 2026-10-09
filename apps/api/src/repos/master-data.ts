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
import { type CodeCursor, type Page, type TimeCursor, toPage } from "../pagination.ts";

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
  source: string | null;
  sourceRef: string | null;
  sourceSyncedAt: Date | null;
  sourceOverridden: boolean;
  /** 数据源给的人口（建议城市时用）；手工录入的为 null */
  population: number | null;
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
  /** 数据源给的「所属 / 服务的城市名」（建议城市时用）；手工录入的为 null */
  municipality: string | null;
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
  columns: [
    "code",
    "country_code",
    "name",
    "timezone",
    "center_lng",
    "center_lat",
    "boundary",
    "source",
    "source_ref",
    "source_synced_at",
    "source_overridden",
    "population",
  ],
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
    source: row["source"],
    sourceRef: row["source_ref"],
    sourceSyncedAt: row["source_synced_at"],
    sourceOverridden: row["source_overridden"],
    population: row["population"],
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
    "municipality",
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
    municipality: row["municipality"],
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

/** 被地点引用的城市或上级地点的简要信息：够在列表里显示，不用再取一次。 */
export interface MasterRef {
  id: string;
  code: string;
  name: LocalizedText;
}

export async function findCityRefs(db: Db, ids: readonly string[]): Promise<MasterRef[]> {
  if (ids.length === 0) return [];
  const result = await db.query<MasterRef>("select id, code, name from cities where id = any($1::uuid[])", [ids]);
  return result.rows;
}

export async function findPlaceRefs(db: Db, ids: readonly string[]): Promise<(MasterRef & { type: PlaceType })[]> {
  if (ids.length === 0) return [];
  const result = await db.query<MasterRef & { type: PlaceType }>("select id, code, name, type from places where id = any($1::uuid[])", [ids]);
  return result.rows;
}

/** 只读出一个地点的上级编号（不加锁）。 */
export async function findPlaceParentId(db: Db, placeId: string): Promise<string | null> {
  const result = await db.query<{ parent_id: string | null }>("select parent_id from places where id = $1", [placeId]);
  return result.rows[0]?.parent_id ?? null;
}

/**
 * 抢某一种导入的锁（事务结束自动释放）：同一个库、同一个 schema 里同一时间只允许一次同类导入。
 * 抢不到立即返回 false，不排队。
 */
async function tryLockImport(db: Db, kind: "import-airports" | "import-cities"): Promise<boolean> {
  const result = await db.query<{ locked: boolean }>(
    "select pg_try_advisory_xact_lock(hashtextextended(current_database() || '.' || current_schema() || '.masterdata.' || $1, 0)) as locked",
    [kind],
  );
  return result.rows[0]?.locked === true;
}

/**
 * 「商品上架」和「平台停用主数据」之间的互斥（ADR 0016）。租户账号对主数据表只有读权限，锁不了行，所以用按主数据编号算出来的事务级 advisory lock：
 * - 上架（或给已上架的商品换上新的引用）这一边，先对它引用的每一条主数据（城市、接送点、车型组、开着的附加服务）取**共享**锁，再去读它们的状态；
 * - 平台停用某一条主数据这一边，先取这一条的**排他**锁，再数「有多少已上架的商品在用」。
 * 两边都是在各自的检查之前先拿锁、事务结束才放，所以不会同时通过各自的检查。
 * 加锁顺序：租户一边是「商品行 → 主数据的共享锁（按编号排序）→ 写入 → 区域行」，平台一边是「这一条的排他锁 → 主数据行」；
 * 平台一边每次只取一把排他锁，而且先于任何行锁，所以两边不会互相等死。
 */
const REFERENCE_LOCK_KEY = "hashtextextended('masterdata.ref.' || $1::uuid::text, 0)";

/** 租户一边：对引用的这些主数据取共享锁（事务结束自动释放）。 */
export async function lockMasterReferencesShared(db: Db, ids: readonly string[]): Promise<void> {
  for (const id of [...new Set(ids.map((value) => value.toLowerCase()))].sort()) {
    await db.query(`select pg_advisory_xact_lock_shared(${REFERENCE_LOCK_KEY})`, [id]);
  }
}

/** 平台一边：停用这一条主数据之前取它的排他锁（事务结束自动释放）。 */
export async function lockMasterReferenceExclusive(db: Db, id: string): Promise<void> {
  await db.query(`select pg_advisory_xact_lock(${REFERENCE_LOCK_KEY})`, [id]);
}

export function tryLockAirportImport(db: Db): Promise<boolean> {
  return tryLockImport(db, "import-airports");
}

export function tryLockCityImport(db: Db): Promise<boolean> {
  return tryLockImport(db, "import-cities");
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
  /** 这些列必须为空（如「还没有所属城市」） */
  isNull?: readonly string[] | undefined;
  /** 关键字：编码或任意一种语言的名称里包含它（不区分大小写） */
  search?: string | undefined;
  status?: MasterDataStatus | undefined;
  updatedSince?: Date | undefined;
}

/** 一页主数据，外加符合筛选条件的总数（和翻到第几页无关）。 */
export interface MasterPage<Item> extends Page<Item> {
  total: number;
}

/** 把关键字变成 LIKE 的「包含」模式：关键字里的 %、_、\ 按字面匹配。 */
export function containsPattern(keyword: string): string {
  return `%${keyword.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/**
 * 列表的排序和翻到哪了。两种排序各用各的游标，不能混用：
 * - created：按创建时间从早到晚，创建时间相同的按编号（同一次导入的机场创建时间相同，彼此之间没有有意义的先后）。
 * - code：按编码逐字节升序（和数据库的语言环境无关），再按编号。
 */
export type MasterOrder = { by: "created"; after: TimeCursor | null } | { by: "code"; after: CodeCursor | null };

/**
 * 翻页读一页，同时数出符合筛选条件的总数。两条查询要在同一个快照里（调用方用 `snapshot` 事务），总数和这一页才对得上。
 */
export async function listMasterRows<Item extends Versioned>(
  db: Db,
  spec: MasterTable<Item>,
  filter: MasterFilter,
  limit: number,
  order: MasterOrder,
): Promise<MasterPage<Item>> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  /** `sql` 里的每个 `?` 依次对应 `values` 里的一个值 */
  const where = (sql: string, ...values: unknown[]): void => {
    let used = 0;
    conditions.push(sql.replace(/\?/g, () => `$${params.push(values[used++])}`));
  };
  for (const [column, value] of Object.entries(filter.equals ?? {})) {
    if (!spec.columns.includes(column)) throw new Error(`${spec.table} 没有可筛选的列 ${column}`);
    if (Array.isArray(value)) where(`${column} = any(?::text[])`, value);
    else where(`${column} = ?`, value);
  }
  for (const column of filter.isNull ?? []) {
    if (!spec.columns.includes(column)) throw new Error(`${spec.table} 没有可筛选的列 ${column}`);
    where(`${column} is null`);
  }
  if (filter.status !== undefined) where("status = ?", filter.status);
  if (filter.updatedSince !== undefined) where("updated_at >= ?", filter.updatedSince);
  if (filter.search !== undefined) {
    const pattern = containsPattern(filter.search);
    where(
      "(code ilike ? escape '\\' or exists (select 1 from jsonb_each_text(name) as localized(lang, value) where localized.value ilike ? escape '\\'))",
      pattern,
      pattern,
    );
  }
  const total = await db.query<{ n: number }>(
    `select count(*)::int as n from ${spec.table} ${conditions.length > 0 ? `where ${conditions.join(" and ")}` : ""}`,
    [...params],
  );
  if (order.by === "created" && order.after !== null) where("(created_at, id) > (?::timestamptz, ?::uuid)", order.after.t, order.after.id);
  if (order.by === "code" && order.after !== null) where('(code collate "C", id) > (? collate "C", ?::uuid)', order.after.c, order.after.id);
  params.push(limit + 1);
  const result = await db.query<Row & { cursor_time: string }>(
    `select ${selectList(spec)}, created_at::text as cursor_time
       from ${spec.table}
      ${conditions.length > 0 ? `where ${conditions.join(" and ")}` : ""}
      order by ${order.by === "code" ? 'code collate "C", id' : "created_at, id"}
      limit $${params.length}`,
    params,
  );
  return {
    ...toPage(result.rows, limit, spec.toItem, (row) =>
      order.by === "code" ? { c: row["code"] as string, id: row["id"] as string } : { t: row.cursor_time, id: row["id"] as string },
    ),
    total: total.rows[0]?.n ?? 0,
  };
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

/** 全部城市（手工录入的和导入的都算），给城市导入命令做比较用。 */
export async function listAllCities(db: Db): Promise<City[]> {
  const result = await db.query<Row>(`select ${selectList(CITIES)} from cities order by code`);
  return result.rows.map(CITIES.toItem);
}

/** 记下这些导入的城市刚刚和数据源核对过。不算一次修改：版本号和更新时间不变。 */
export async function markCitiesSynced(db: Db, source: string, sourceRefs: readonly string[], now: Date): Promise<void> {
  await db.query("update cities set source_synced_at = $3 where source = $1 and source_ref = any($2::text[])", [source, sourceRefs, now]);
}

/**
 * 把数据源给的「机场所属的城市名」写到这些导入的机场上（按数据源编号对应）。和核对时间一样不算一次修改：
 * 版本号、更新时间、「平台改过」的标记都不变。返回实际改了几条。
 */
export async function setAirportMunicipalities(db: Db, source: string, entries: readonly { sourceRef: string; municipality: string | null }[]): Promise<number> {
  if (entries.length === 0) return 0;
  const result = await db.query(
    `update places p set municipality = v.municipality
       from unnest($2::text[], $3::text[]) as v(source_ref, municipality)
      where p.source = $1 and p.source_ref = v.source_ref and p.municipality is distinct from v.municipality`,
    [source, entries.map((entry) => entry.sourceRef), entries.map((entry) => entry.municipality)],
  );
  return result.rowCount ?? 0;
}

/** 把数据源给的人口写到这些导入的城市上。同样不算一次修改。返回实际改了几条。 */
export async function setCityPopulations(db: Db, source: string, entries: readonly { sourceRef: string; population: number }[]): Promise<number> {
  if (entries.length === 0) return 0;
  const result = await db.query(
    `update cities c set population = v.population
       from unnest($2::text[], $3::int[]) as v(source_ref, population)
      where c.source = $1 and c.source_ref = v.source_ref and c.population is distinct from v.population`,
    [source, entries.map((entry) => entry.sourceRef), entries.map((entry) => entry.population)],
  );
  return result.rowCount ?? 0;
}

/** 建议城市时的候选：城市的编码、名称、中心坐标和人口。 */
export interface CityCandidate extends MasterRef {
  population: number | null;
  countryCode: string;
  lng: number;
  lat: number;
}

/** 这些国家里启用中的城市（给还没有城市的机场找最近的城市用）。 */
export async function listActiveCityCandidates(db: Db, countryCodes: readonly string[]): Promise<CityCandidate[]> {
  if (countryCodes.length === 0) return [];
  const result = await db.query<Row>(
    `select id, code, name, country_code, center_lng, center_lat, population
       from cities
      where status = 'active' and country_code = any($1::text[])
      order by code collate "C"`,
    [countryCodes],
  );
  return result.rows.map((row) => ({
    id: row["id"],
    code: row["code"],
    name: row["name"],
    countryCode: row["country_code"],
    population: row["population"],
    lng: Number(row["center_lng"]),
    lat: Number(row["center_lat"]),
  }));
}
