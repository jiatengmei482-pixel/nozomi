/**
 * 区域共享库的数据访问（M8-31，ADR 0083）。全部在平台事务（withPlatformTx）里调用：共享库跨租户，
 * 迁移 0016 给了 nozomi_platform 读 areas / area_polygons。
 *
 * 共享库 = 各供应商启用中的「原创」区域（不是从库里引用来的副本），测试供应商和已清退供应商的不算。
 * 这里只取名称、城市、图形（种类 + 坐标）和图形版本：不取创建者是谁、备注名、业务类型、用途，也不碰价格和加价。
 * 调用方传 `exceptTenantId`：自己建的区域不出现在自己看到的库里（它已经在「我的区域」里）。
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

/** 共享库的条件（区域表别名 a、租户表别名 t）。 */
const IN_LIBRARY = "a.status = 'active' and a.shared_source_area_id is null and not t.is_test_tenant and t.status <> 'terminated'";

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
      where ${IN_LIBRARY} and a.city_id = $1 and a.tenant_id <> $2 ${search}
      order by a.updated_at desc, a.id desc
      limit $${params.length}`,
    params,
  );
  return { items: result.rows.slice(0, limit).map(toSharedArea), truncated: result.rows.length > limit };
}

/** 共享库里的一个区域和它的图形（按加入的先后）。不在库里（停用、删除、是副本、属于测试供应商）时为 null。 */
export async function findSharedArea(db: Db, id: string): Promise<{ area: SharedArea; shapes: SharedAreaShape[] } | null> {
  const result = await db.query<Row>(`select ${COLUMNS}, a.tenant_id from areas a join tenants t on t.id = a.tenant_id where ${IN_LIBRARY} and a.id = $1`, [id]);
  const row = result.rows[0];
  if (!row) return null;
  return { area: toSharedArea(row), shapes: await shapesOf(db, row["tenant_id"], id) };
}

async function shapesOf(db: Db, tenantId: string, areaId: string): Promise<SharedAreaShape[]> {
  const result = await db.query<Row>("select kind, geometry from area_polygons where tenant_id = $1 and area_id = $2 order by position", [tenantId, areaId]);
  return result.rows.map((row) => ({ kind: row["kind"], ring: ((row["geometry"] as { coordinates: Ring[] }).coordinates[0] ?? []).slice(0, -1) }));
}

/** 查相似用：一个城市里全部共享区域和它们的图形（自己的除外）。一个城市的区域数有限（每家几十个），一次取完。 */
export async function listSharedAreaShapes(db: Db, cityId: string, exceptTenantId: string): Promise<(SharedArea & { shapes: SharedAreaShape[] })[]> {
  const areas = await db.query<Row>(
    `select ${COLUMNS}, a.tenant_id from areas a join tenants t on t.id = a.tenant_id where ${IN_LIBRARY} and a.city_id = $1 and a.tenant_id <> $2 order by a.updated_at desc, a.id desc limit 500`,
    [cityId, exceptTenantId],
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

/** 这些来源区域现在在共享库里的图形版本；不在库里的不出现在结果里。 */
export async function sharedShapeVersions(db: Db, ids: readonly string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const result = await db.query<Row>(`select a.id, a.shape_version from areas a join tenants t on t.id = a.tenant_id where ${IN_LIBRARY} and a.id = any($1::uuid[])`, [[...ids]]);
  return new Map(result.rows.map((row) => [row["id"] as string, row["shape_version"] as number]));
}
