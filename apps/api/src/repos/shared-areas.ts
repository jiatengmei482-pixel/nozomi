/**
 * 区域共享库的数据访问（M8-31，ADR 0083）。全部在平台事务（withPlatformTx）里调用：共享库跨租户，
 * 迁移 0016 给了 nozomi_platform 读 areas / area_polygons。
 *
 * 共享库 = 各供应商启用中的「原创」区域（不是从库里引用来的副本），测试供应商和已清退供应商的不算。
 * 这里只取名称、城市、图形（种类 + 坐标）和图形版本：不取创建者是谁、备注名、业务类型、用途，也不碰价格和加价。
 * 调用方传 `exceptTenantId`：自己建的区域不出现在自己看到的库里（它已经在「我的区域」里）。
 *
 * 平台把一份标成另一份的重复后（M8-31b，ADR 0083 补充；表 shared_area_duplicates），被标的那份「隐藏」：
 * 不再出现在列表、详情、查相似里（`LISTED`），但它仍「在库里」（`IN_LIBRARY`）——已经从它引用的副本照旧能看到它的新版本、能切换。
 */
import type { AreaPolygonKind, LocalizedText, Ring } from "@nozomi/domain";
import type { Db } from "../db/context.ts";
import { containsPattern } from "./master-data.ts";

export interface SharedArea {
  id: string;
  cityId: string;
  name: LocalizedText;
  nameKeys: string[];
  shapeVersion: number;
  operatePolygonCount: number;
  forbidPolygonCount: number;
  updatedAt: Date;
}

export interface SharedAreaShape {
  kind: AreaPolygonKind;
  /** 不闭合的一圈点，[经度, 纬度] */
  ring: Ring;
}

type Row = Record<string, any>;

/** 共享库的条件（区域表别名 a、租户表别名 t）：已有副本的来源看这个（隐藏了也算）。 */
const IN_LIBRARY = "a.status = 'active' and a.shared_source_area_id is null and not t.is_test_tenant and t.status <> 'terminated'";
/** 被平台标成重复、隐藏中 */
const HIDDEN = "exists (select 1 from shared_area_duplicates d where d.area_id = a.id and d.revoked_at is null)";
/** 共享库里看得到的：在库里，而且没有被隐藏。列表、详情、查相似、以后的引用都看这个。 */
const LISTED = `${IN_LIBRARY} and not ${HIDDEN}`;

const COLUMNS = `a.id, a.city_id, a.name, a.name_keys, a.shape_version, a.updated_at,
  (select count(*)::int from area_polygons p where p.tenant_id = a.tenant_id and p.area_id = a.id and p.kind = 'operate') as operate_count,
  (select count(*)::int from area_polygons p where p.tenant_id = a.tenant_id and p.area_id = a.id and p.kind = 'forbid') as forbid_count`;

function toSharedArea(row: Row): SharedArea {
  return {
    id: row["id"],
    cityId: row["city_id"],
    name: row["name"],
    nameKeys: row["name_keys"],
    shapeVersion: row["shape_version"],
    operatePolygonCount: row["operate_count"],
    forbidPolygonCount: row["forbid_count"],
    updatedAt: row["updated_at"],
  };
}

export interface SharedAreaFilter {
  cityId: string;
  /** 任意一种语言的名称里包含它（不区分大小写） */
  search?: string | undefined;
  exceptTenantId: string;
}

/** 一个城市里的共享区域：按最近修改从新到旧，最多 `limit` 个；`truncated` 为真表示还有更多（请缩小搜索）。 */
export async function listSharedAreas(db: Db, filter: SharedAreaFilter, limit: number): Promise<{ items: SharedArea[]; truncated: boolean }> {
  const params: unknown[] = [filter.cityId, filter.exceptTenantId];
  let search = "";
  if (filter.search !== undefined) {
    params.push(containsPattern(filter.search));
    search = `and exists (select 1 from jsonb_each_text(a.name) as localized(lang, value) where localized.value ilike $${params.length} escape '\\')`;
  }
  params.push(limit + 1);
  const result = await db.query<Row>(
    `select ${COLUMNS}
       from areas a join tenants t on t.id = a.tenant_id
      where ${LISTED} and a.city_id = $1 and a.tenant_id <> $2 ${search}
      order by a.updated_at desc, a.id desc
      limit $${params.length}`,
    params,
  );
  return { items: result.rows.slice(0, limit).map(toSharedArea), truncated: result.rows.length > limit };
}

/**
 * 共享库里的一个区域和它的图形（按加入的先后）。不在库里（停用、删除、是副本、属于测试供应商）时为 null；
 * 被隐藏的也为 null，除非 `includeHidden`（已有副本切换到来源的新版本时用）。
 */
export async function findSharedArea(db: Db, id: string, options: { includeHidden?: boolean } = {}): Promise<{ area: SharedArea; shapes: SharedAreaShape[] } | null> {
  const result = await db.query<Row>(`select ${COLUMNS}, a.tenant_id from areas a join tenants t on t.id = a.tenant_id where ${options.includeHidden ? IN_LIBRARY : LISTED} and a.id = $1`, [id]);
  const row = result.rows[0];
  if (!row) return null;
  return { area: toSharedArea(row), shapes: await shapesOf(db, row["tenant_id"], id) };
}

async function shapesOf(db: Db, tenantId: string, areaId: string): Promise<SharedAreaShape[]> {
  const result = await db.query<Row>("select kind, geometry from area_polygons where tenant_id = $1 and area_id = $2 order by position", [tenantId, areaId]);
  return result.rows.map((row) => ({ kind: row["kind"], ring: ((row["geometry"] as { coordinates: Ring[] }).coordinates[0] ?? []).slice(0, -1) }));
}

/** 一个城市最多取这么多个共享区域（查相似、平台的去重列表）。 */
export const SHARED_AREAS_PER_CITY = 500;

/**
 * 查相似用：一个城市里全部共享区域和它们的图形（`exceptTenantId` 的除外；平台看全部时传 null）。一个城市的区域数有限（每家几十个），一次取完。
 * 被隐藏的不算，除非 `includeHidden`（平台的去重列表要看到隐藏的，才能撤销）。
 */
export async function listSharedAreaShapes(db: Db, cityId: string, exceptTenantId: string | null, options: { includeHidden?: boolean; limit?: number } = {}): Promise<(SharedArea & { shapes: SharedAreaShape[] })[]> {
  const areas = await db.query<Row>(
    `select ${COLUMNS}, a.tenant_id from areas a join tenants t on t.id = a.tenant_id
      where ${options.includeHidden ? IN_LIBRARY : LISTED} and a.city_id = $1 and ($2::uuid is null or a.tenant_id <> $2)
      order by a.updated_at desc, a.id desc limit $3`,
    [cityId, exceptTenantId, options.limit ?? SHARED_AREAS_PER_CITY],
  );
  if (areas.rows.length === 0) return [];
  const polygons = await db.query<Row>(
    "select area_id, kind, geometry from area_polygons where (tenant_id, area_id) in (select * from unnest($1::uuid[], $2::uuid[])) order by area_id, position",
    [areas.rows.map((row) => row["tenant_id"]), areas.rows.map((row) => row["id"])],
  );
  const byArea = new Map<string, SharedAreaShape[]>();
  for (const row of polygons.rows) {
    const list = byArea.get(row["area_id"]) ?? [];
    list.push({ kind: row["kind"], ring: ((row["geometry"] as { coordinates: Ring[] }).coordinates[0] ?? []).slice(0, -1) });
    byArea.set(row["area_id"], list);
  }
  return areas.rows.map((row) => ({ ...toSharedArea(row), shapes: byArea.get(row["id"]) ?? [] }));
}

/** 这些来源区域现在在共享库里的图形版本；不在库里的不出现在结果里。被隐藏的照常给（已有副本的来源不变，ADR 0083 补充）。 */
export async function sharedShapeVersions(db: Db, ids: readonly string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const result = await db.query<Row>(`select a.id, a.shape_version from areas a join tenants t on t.id = a.tenant_id where ${IN_LIBRARY} and a.id = any($1::uuid[])`, [[...ids]]);
  return new Map(result.rows.map((row) => [row["id"] as string, row["shape_version"] as number]));
}

// ---- 平台去重（M8-31b）：标记、撤销、查标记 ----

export interface SharedAreaDuplicate {
  id: string;
  areaId: string;
  keepAreaId: string;
  reason: string;
  markedBy: { id: string; name: string };
  markedAt: Date;
  revokedBy: { id: string; name: string } | null;
  revokedAt: Date | null;
  revokeReason: string | null;
}

const DUPLICATE_COLUMNS = `d.id, d.area_id, d.keep_area_id, d.reason, d.marked_at, d.revoked_at, d.revoke_reason,
  d.marked_by, mu.name as marked_by_name, d.revoked_by, ru.name as revoked_by_name`;
const DUPLICATE_FROM = "shared_area_duplicates d join platform_users mu on mu.id = d.marked_by left join platform_users ru on ru.id = d.revoked_by";

function toDuplicate(row: Row): SharedAreaDuplicate {
  return {
    id: row["id"],
    areaId: row["area_id"],
    keepAreaId: row["keep_area_id"],
    reason: row["reason"],
    markedBy: { id: row["marked_by"], name: row["marked_by_name"] },
    markedAt: row["marked_at"],
    revokedBy: row["revoked_by"] === null ? null : { id: row["revoked_by"], name: row["revoked_by_name"] },
    revokedAt: row["revoked_at"],
    revokeReason: row["revoke_reason"],
  };
}

/** 这些区域生效中的重复标记（被隐藏的那份 → 标记）。 */
export async function activeDuplicates(db: Db, areaIds: readonly string[]): Promise<Map<string, SharedAreaDuplicate>> {
  if (areaIds.length === 0) return new Map();
  const result = await db.query<Row>(`select ${DUPLICATE_COLUMNS} from ${DUPLICATE_FROM} where d.revoked_at is null and d.area_id = any($1::uuid[])`, [[...areaIds]]);
  return new Map(result.rows.map((row) => [row["area_id"] as string, toDuplicate(row)]));
}

/** 被隐藏的区域现在指向哪一份（没有隐藏为 null）。以后的引用按它转。 */
export async function keepAreaOf(db: Db, areaId: string): Promise<string | null> {
  const result = await db.query<{ keep_area_id: string }>("select keep_area_id from shared_area_duplicates where area_id = $1 and revoked_at is null", [areaId]);
  return result.rows[0]?.keep_area_id ?? null;
}

/** 标记前检查用：区域的城市、在不在库里、是否隐藏中、有几份指向它。区域不存在为 null。 */
export async function duplicateCandidate(db: Db, id: string): Promise<{ id: string; cityId: string; inLibrary: boolean; hidden: boolean; keptFor: number } | null> {
  const result = await db.query<Row>(
    `select a.id, a.city_id, (${IN_LIBRARY}) as in_library, ${HIDDEN} as hidden,
            (select count(*)::int from shared_area_duplicates k where k.keep_area_id = a.id and k.revoked_at is null) as kept_for
       from areas a join tenants t on t.id = a.tenant_id where a.id = $1`,
    [id],
  );
  const row = result.rows[0];
  return row ? { id: row["id"], cityId: row["city_id"], inLibrary: row["in_library"], hidden: row["hidden"], keptFor: row["kept_for"] } : null;
}

export async function insertDuplicate(db: Db, values: { areaId: string; keepAreaId: string; reason: string; markedBy: string; now: Date }): Promise<SharedAreaDuplicate> {
  const inserted = await db.query<{ id: string }>(
    "insert into shared_area_duplicates (area_id, keep_area_id, reason, marked_by, marked_at) values ($1, $2, $3, $4, $5) returning id",
    [values.areaId, values.keepAreaId, values.reason, values.markedBy, values.now],
  );
  return (await duplicateById(db, (inserted.rows[0] as { id: string }).id)) as SharedAreaDuplicate;
}

/** 撤销生效中的标记；没有生效中的标记时为 null。 */
export async function revokeDuplicate(db: Db, areaId: string, values: { revokedBy: string; reason: string | null; now: Date }): Promise<SharedAreaDuplicate | null> {
  const updated = await db.query<{ id: string }>(
    "update shared_area_duplicates set revoked_by = $2, revoked_at = $3, revoke_reason = $4 where area_id = $1 and revoked_at is null returning id",
    [areaId, values.revokedBy, values.now, values.reason],
  );
  const id = updated.rows[0]?.id;
  return id === undefined ? null : duplicateById(db, id);
}

async function duplicateById(db: Db, id: string): Promise<SharedAreaDuplicate | null> {
  const result = await db.query<Row>(`select ${DUPLICATE_COLUMNS} from ${DUPLICATE_FROM} where d.id = $1`, [id]);
  return result.rows[0] ? toDuplicate(result.rows[0]) : null;
}

/** 每个来源区域有几份引用来的副本（各供应商合计，不论副本现在的状态）：平台决定留哪份时参考。 */
export async function sharedCopyCounts(db: Db, ids: readonly string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const result = await db.query<Row>("select shared_source_area_id as id, count(*)::int as n from areas where shared_source_area_id = any($1::uuid[]) group by shared_source_area_id", [[...ids]]);
  return new Map(result.rows.map((row) => [row["id"] as string, row["n"] as number]));
}

/** 区域属于哪个供应商（不存在为 null）。引用前判断「要复制的是不是自己的区域」用；结果不出现在任何应答里。 */
export async function areaTenantOf(db: Db, areaId: string): Promise<string | null> {
  const result = await db.query<{ tenant_id: string }>("select tenant_id from areas where id = $1", [areaId]);
  return result.rows[0]?.tenant_id ?? null;
}
