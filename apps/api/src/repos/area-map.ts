/**
 * 区域地图（M8-18，ADR 0074）的数据访问：一次取出一批区域连同全部图形、每个区域最近一次是谁改的。
 *
 * 两个入口共用：供应商后台（租户事务，`tenantId` 必须给、写在条件里，行级安全兜底）、
 * 运营后台（平台事务，只读，可按供应商、城市筛；`nozomi_platform` 对区域、图形、审计日志只有读的策略）。
 */
import type { AreaStatus } from "@nozomi/domain";
import type { Db } from "../db/context.ts";
import { type AreaListItem, type AreaPolygon, toArea, toAreaPolygon } from "./areas.ts";

type Row = Record<string, any>;

export interface AreaMapFilter {
  /** 租户入口必须给（来自令牌）；平台入口是可选的筛选条件 */
  tenantId?: string | undefined;
  cityId?: string | undefined;
  status?: AreaStatus | undefined;
}

export interface AreaMapRow extends AreaListItem {
  tenantId: string;
}

/** 最近一次改这个区域的是谁（审计日志里这个区域最后一条记录）。 */
export interface AreaLastEditor {
  /** 供应商的账号 / 命令行（以系统身份导入价格表等） */
  type: "tenant_user" | "system" | "platform_user";
  /** 账号现在的名字；账号已经不在了，或者是系统，为 null */
  name: string | null;
  at: Date;
}

/** 一批区域（按最近修改从新到旧），最多 `max` 个；多出来的不取，`truncated` 为真。 */
export async function listAreaMapRows(db: Db, filter: AreaMapFilter, max: number): Promise<{ items: AreaMapRow[]; truncated: boolean }> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  const where = (sql: string, value: unknown): void => {
    params.push(value);
    conditions.push(sql.replace("?", `$${params.length}`));
  };
  if (filter.tenantId !== undefined) where("a.tenant_id = ?", filter.tenantId);
  if (filter.cityId !== undefined) where("a.city_id = ?", filter.cityId);
  if (filter.status !== undefined) where("a.status = ?", filter.status);
  params.push(max + 1);
  const result = await db.query<Row>(
    `select a.tenant_id, a.id, a.city_id, a.name, a.biz_type, a.role, a.status, a.version, a.created_at, a.updated_at,
            (select count(*)::int from area_polygons p where p.tenant_id = a.tenant_id and p.area_id = a.id and p.kind = 'operate') as operate_count,
            (select count(*)::int from area_polygons p where p.tenant_id = a.tenant_id and p.area_id = a.id and p.kind = 'forbid') as forbid_count
       from areas a
      ${conditions.length === 0 ? "" : `where ${conditions.join(" and ")}`}
      order by a.updated_at desc, a.id desc
      limit $${params.length}`,
    params,
  );
  const rows = result.rows.slice(0, max);
  return {
    items: rows.map((row) => ({ ...toArea(row), tenantId: row["tenant_id"], operatePolygonCount: row["operate_count"], forbidPolygonCount: row["forbid_count"] })),
    truncated: result.rows.length > max,
  };
}

/** 这些区域的全部图形，按区域分好，每个区域里按加入的先后。`tenantId` 给了就只取这个租户的（租户入口）。 */
export async function listPolygonsOfAreas(db: Db, areaIds: readonly string[], tenantId: string | null): Promise<Map<string, AreaPolygon[]>> {
  const found = new Map<string, AreaPolygon[]>();
  if (areaIds.length === 0) return found;
  const result = await db.query<Row>(
    `select area_id, id, kind, seq, label, source, circle_center_lng, circle_center_lat, circle_radius_m, geometry
       from area_polygons
      where area_id = any($1::uuid[]) and ($2::uuid is null or tenant_id = $2)
      order by area_id, position`,
    [areaIds, tenantId],
  );
  for (const row of result.rows) found.set(row["area_id"], [...(found.get(row["area_id"]) ?? []), toAreaPolygon(row)]);
  return found;
}

/**
 * 这些区域各自最近一次的修改人（审计日志 resource = 'area' 的最后一条；索引 audit_logs_resource_idx）。
 * 名字取账号现在的名字（和审计日志页一致）；不返回邮箱。`tenantId` 给了就只看这个租户的日志（租户入口）。
 */
export async function lastAreaEditors(db: Db, areaIds: readonly string[], tenantId: string | null): Promise<Map<string, AreaLastEditor>> {
  if (areaIds.length === 0) return new Map();
  const result = await db.query<Row>(
    `select distinct on (l.resource_id) l.resource_id, l.actor_type, l.occurred_at, u.name
       from audit_logs l
       left join tenant_users u on l.actor_type = 'tenant_user' and u.tenant_id = l.tenant_id and u.id = l.actor_id
      where l.resource = 'area' and l.resource_id = any($1::text[]) and ($2::uuid is null or l.tenant_id = $2)
      order by l.resource_id, l.id desc`,
    [areaIds, tenantId],
  );
  return new Map(
    result.rows.map((row) => [
      row["resource_id"] as string,
      { type: row["actor_type"] === "tenant_user" || row["actor_type"] === "platform_user" ? row["actor_type"] : "system", name: row["name"] ?? null, at: row["occurred_at"] },
    ]),
  );
}
