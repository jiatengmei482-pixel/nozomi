/**
 * 区域的数据访问（迁移 0011）。全部在租户事务（withTenantTx）里调用：
 * 每个函数都显式带 tenantId 并写在条件里（ADR 0003 的第一道防线），行级安全是兜底。
 */
import type { AreaBizType, AreaPolygonKind, AreaPolygonSource, AreaStatus, GeoJsonMultiPolygon, GeoJsonPolygon, LocalizedText, MasterDataStatus, Ring } from "@nozomi/domain";
import { ringToGeoJson } from "@nozomi/domain";
import type { Db } from "../db/context.ts";
import { type Page, type TimeCursor, toPage } from "../pagination.ts";
import { containsPattern } from "./master-data.ts";

export interface Area {
  id: string;
  cityId: string;
  name: LocalizedText;
  bizType: AreaBizType;
  status: AreaStatus;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** 列表里的一项：不带图形的坐标，只带块数。 */
export interface AreaListItem extends Area {
  operatePolygonCount: number;
  forbidPolygonCount: number;
}

export interface AreaCircle {
  center: { lat: number; lng: number };
  radiusM: number;
}

export interface AreaPolygon {
  id: string;
  kind: AreaPolygonKind;
  seq: number;
  label: string | null;
  source: AreaPolygonSource;
  circle: AreaCircle | null;
  /** 不闭合的一圈点，[经度, 纬度] */
  ring: Ring;
}

/** 区域所属城市的简要信息：页面要用名字、状态、中心坐标、边界。 */
export interface AreaCity {
  id: string;
  code: string;
  name: LocalizedText;
  status: MasterDataStatus;
  center: { lng: number; lat: number };
  boundary: GeoJsonPolygon | GeoJsonMultiPolygon | null;
}

type Row = Record<string, any>;

const AREA_COLUMNS = "id, city_id, name, biz_type, status, version, created_at, updated_at";

function toArea(row: Row): Area {
  return {
    id: row["id"],
    cityId: row["city_id"],
    name: row["name"],
    bizType: row["biz_type"],
    status: row["status"],
    version: row["version"],
    createdAt: row["created_at"],
    updatedAt: row["updated_at"],
  };
}

export interface AreaValues {
  name: LocalizedText;
  nameKeys: string[];
  bizType: AreaBizType;
}

export async function insertArea(db: Db, tenantId: string, cityId: string, values: AreaValues, now: Date): Promise<Area> {
  const result = await db.query<Row>(
    `insert into areas (tenant_id, city_id, name, name_keys, biz_type, status, created_at, updated_at)
     values ($1, $2, $3::jsonb, $4, $5, 'active', $6, $6)
     returning ${AREA_COLUMNS}`,
    [tenantId, cityId, JSON.stringify(values.name), values.nameKeys, values.bizType, now],
  );
  return toArea(result.rows[0] as Row);
}

/** 修改区域：版本号加一、更新时间改为现在。`values` 为 null 时只改状态（或只是图形变了）。 */
export async function updateArea(db: Db, tenantId: string, id: string, values: AreaValues | null, status: AreaStatus, now: Date): Promise<Area> {
  const result = await db.query<Row>(
    `update areas
        set status = $3, updated_at = $4, version = version + 1,
            name = coalesce($5::jsonb, name), name_keys = coalesce($6::text[], name_keys), biz_type = coalesce($7, biz_type)
      where tenant_id = $1 and id = $2
      returning ${AREA_COLUMNS}`,
    [tenantId, id, status, now, values === null ? null : JSON.stringify(values.name), values?.nameKeys ?? null, values?.bizType ?? null],
  );
  return toArea(result.rows[0] as Row);
}

/** 按编号取本租户的一个区域。`lock` 为真时锁住这一行直到事务结束（修改、删除前用）。 */
export async function findArea(db: Db, tenantId: string, id: string, options: { lock: boolean }): Promise<Area | null> {
  const result = await db.query<Row>(`select ${AREA_COLUMNS} from areas where tenant_id = $1 and id = $2 ${options.lock ? "for update" : ""}`, [tenantId, id]);
  const row = result.rows[0];
  return row ? toArea(row) : null;
}

export async function deleteArea(db: Db, tenantId: string, id: string): Promise<void> {
  await db.query("delete from areas where tenant_id = $1 and id = $2", [tenantId, id]);
}

/**
 * 查重名之前先拿这把锁（事务结束自动释放）：同一个租户、同一个城市里的新增和改名排队进行，
 * 两个请求同时用同一个名字时不会都通过检查。
 */
export async function lockAreaNames(db: Db, tenantId: string, cityId: string): Promise<void> {
  await db.query("select pg_advisory_xact_lock(hashtextextended('areas.name.' || $1 || '.' || $2, 0))", [tenantId, cityId]);
}

/** 本租户在这个城市里有没有别的区域用了这些名称键里的任何一个。 */
export async function areaNameTaken(db: Db, tenantId: string, cityId: string, nameKeys: readonly string[], exceptAreaId: string | null): Promise<boolean> {
  const result = await db.query(
    `select 1 from areas
      where tenant_id = $1 and city_id = $2 and name_keys && $3::text[] and ($4::uuid is null or id <> $4)
      limit 1`,
    [tenantId, cityId, nameKeys, exceptAreaId],
  );
  return result.rows.length > 0;
}

export interface AreaFilter {
  /** 任意一种语言的名称里包含它（不区分大小写） */
  search?: string | undefined;
  cityId?: string | undefined;
  bizType?: AreaBizType | undefined;
  status?: AreaStatus | undefined;
}

/** 本租户的区域列表：按最近修改从新到旧（修改时间相同的按编号，顺序稳定），同时数出符合筛选条件的总数。 */
export async function listAreas(db: Db, tenantId: string, filter: AreaFilter, limit: number, after: TimeCursor | null): Promise<Page<AreaListItem> & { total: number }> {
  const conditions = ["a.tenant_id = $1"];
  const params: unknown[] = [tenantId];
  const where = (sql: string, ...values: unknown[]): void => {
    let used = 0;
    conditions.push(sql.replace(/\?/g, () => `$${params.push(values[used++])}`));
  };
  if (filter.cityId !== undefined) where("a.city_id = ?", filter.cityId);
  if (filter.bizType !== undefined) where("a.biz_type = ?", filter.bizType);
  if (filter.status !== undefined) where("a.status = ?", filter.status);
  if (filter.search !== undefined) {
    where("exists (select 1 from jsonb_each_text(a.name) as localized(lang, value) where localized.value ilike ? escape '\\')", containsPattern(filter.search));
  }
  const total = await db.query<{ n: number }>(`select count(*)::int as n from areas a where ${conditions.join(" and ")}`, [...params]);
  if (after !== null) where("(a.updated_at, a.id) < (?::timestamptz, ?::uuid)", after.t, after.id);
  params.push(limit + 1);
  const result = await db.query<Row & { cursor_time: string }>(
    `select ${AREA_COLUMNS.split(", ").map((column) => `a.${column}`).join(", ")}, a.updated_at::text as cursor_time,
            (select count(*)::int from area_polygons p where p.tenant_id = a.tenant_id and p.area_id = a.id and p.kind = 'operate') as operate_count,
            (select count(*)::int from area_polygons p where p.tenant_id = a.tenant_id and p.area_id = a.id and p.kind = 'forbid') as forbid_count
       from areas a
      where ${conditions.join(" and ")}
      order by a.updated_at desc, a.id desc
      limit $${params.length}`,
    params,
  );
  const page = toPage(
    result.rows,
    limit,
    (row): AreaListItem => ({ ...toArea(row), operatePolygonCount: row["operate_count"], forbidPolygonCount: row["forbid_count"] }),
    (row) => ({ t: row.cursor_time, id: row["id"] as string }),
  );
  return { ...page, total: total.rows[0]?.n ?? 0 };
}

/** 一个区域的全部图形，按加入的先后。 */
export async function listAreaPolygons(db: Db, tenantId: string, areaId: string): Promise<AreaPolygon[]> {
  const result = await db.query<Row>(
    `select id, kind, seq, label, source, circle_center_lng, circle_center_lat, circle_radius_m, geometry
       from area_polygons
      where tenant_id = $1 and area_id = $2
      order by position`,
    [tenantId, areaId],
  );
  return result.rows.map((row) => {
    const closed = (row["geometry"] as GeoJsonPolygon).coordinates[0] ?? [];
    return {
      id: row["id"],
      kind: row["kind"],
      seq: row["seq"],
      label: row["label"],
      source: row["source"],
      circle:
        row["circle_radius_m"] === null
          ? null
          : { center: { lat: Number(row["circle_center_lat"]), lng: Number(row["circle_center_lng"]) }, radiusM: row["circle_radius_m"] },
      ring: closed.slice(0, -1),
    };
  });
}

/** 要保存的一块图形；`id` 为 null 时由数据库生成。 */
export type AreaPolygonDraft = Omit<AreaPolygon, "id"> & { id: string | null };

/** 把区域的图形整体换成这一组（先删后插：编号、序号由调用方定好，保留的图形编号不变）。 */
export async function replaceAreaPolygons(db: Db, tenantId: string, areaId: string, polygons: readonly AreaPolygonDraft[]): Promise<void> {
  await db.query("delete from area_polygons where tenant_id = $1 and area_id = $2", [tenantId, areaId]);
  for (const [position, polygon] of polygons.entries()) {
    const lngs = polygon.ring.map((point) => point[0]);
    const lats = polygon.ring.map((point) => point[1]);
    await db.query(
      `insert into area_polygons
         (tenant_id, id, area_id, kind, seq, label, position, source, circle_center_lng, circle_center_lat, circle_radius_m,
          geometry, vertex_count, min_lng, min_lat, max_lng, max_lat)
       values ($1, coalesce($2::uuid, gen_random_uuid()), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15, $16, $17)`,
      [
        tenantId,
        polygon.id,
        areaId,
        polygon.kind,
        polygon.seq,
        polygon.label,
        position,
        polygon.source,
        polygon.circle?.center.lng ?? null,
        polygon.circle?.center.lat ?? null,
        polygon.circle?.radiusM ?? null,
        JSON.stringify(ringToGeoJson(polygon.ring)),
        polygon.ring.length,
        Math.min(...lngs),
        Math.min(...lats),
        Math.max(...lngs),
        Math.max(...lats),
      ],
    );
  }
}

/** 这些城市的简要信息（区域的应答里带着，读取时现查）。城市是平台主数据，租户角色只读。 */
export async function findAreaCities(db: Db, cityIds: readonly string[]): Promise<Map<string, AreaCity>> {
  if (cityIds.length === 0) return new Map();
  const result = await db.query<Row>("select id, code, name, status, center_lng, center_lat, boundary from cities where id = any($1::uuid[])", [cityIds]);
  return new Map(
    result.rows.map((row) => [
      row["id"] as string,
      { id: row["id"], code: row["code"], name: row["name"], status: row["status"], center: { lng: Number(row["center_lng"]), lat: Number(row["center_lat"]) }, boundary: row["boundary"] },
    ]),
  );
}

/** 本租户的区域数量，按状态（首页用）。 */
export async function countAreasByStatus(db: Db, tenantId: string): Promise<{ active: number; disabled: number }> {
  const result = await db.query<{ status: AreaStatus; n: number }>("select status, count(*)::int as n from areas where tenant_id = $1 group by status", [tenantId]);
  const of = (status: AreaStatus): number => result.rows.find((row) => row.status === status)?.n ?? 0;
  return { active: of("active"), disabled: of("disabled") };
}
