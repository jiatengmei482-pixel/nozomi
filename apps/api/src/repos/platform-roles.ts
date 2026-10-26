/**
 * 平台角色（M4-05，ADR 0030）：内置角色（迁移 0001 写入，只读模板，权限以代码为准）和自建角色（勾选、数据范围、IP 白名单）。
 * 只在 withPlatformTx 里调用。内置角色不可改、不可删由数据库触发器兜底。
 */
import type { PlatformDataScope } from "@nozomi/domain";
import type { Db } from "../db/context.ts";

export interface PlatformRoleRecord {
  key: string;
  name: string;
  builtin: boolean;
  description: string | null;
  /** 自建角色的勾选（「菜单:操作」）；内置角色为 null */
  grants: string[] | null;
  scope: PlatformDataScope;
  ipAllowlist: string[];
  version: number;
  sortOrder: number | null;
  /** 指着这个角色的账号数（含待激活、已停用） */
  staffCount: number;
  createdAt: Date;
  updatedAt: Date;
}

interface RoleRow {
  key: string;
  name: string;
  builtin: boolean;
  description: string | null;
  grants: string[] | null;
  scope_city_ids: string[] | null;
  scope_channel_ids: string[] | null;
  ip_allowlist: string[];
  version: number;
  sort_order: number | null;
  staff_count: number;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS = `key, name, builtin, description, grants, scope_city_ids, scope_channel_ids, ip_allowlist, version, sort_order, created_at, updated_at,
  (select count(*)::int from platform_users u where u.role = platform_roles.key) as staff_count`;

function toRole(row: RoleRow): PlatformRoleRecord {
  return {
    key: row.key,
    name: row.name,
    builtin: row.builtin,
    description: row.description,
    grants: row.grants,
    scope: { cityIds: row.scope_city_ids, channelIds: row.scope_channel_ids },
    ipAllowlist: row.ip_allowlist,
    version: row.version,
    sortOrder: row.sort_order,
    staffCount: row.staff_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 全部角色：内置角色按需求文档的顺序在前，自建角色按建立时间在后。角色最多几十个，不分页。 */
export async function listPlatformRoles(db: Db): Promise<PlatformRoleRecord[]> {
  const result = await db.query<RoleRow>(`select ${COLUMNS} from platform_roles order by builtin desc, sort_order, created_at, key`);
  return result.rows.map(toRole);
}

/**
 * `lock`：`true` / `"update"` 锁住这一行（改、删角色）；`"share"` 共享锁（把人改成这个角色时：和删除排好先后）。
 * 注意 `staffCount` 是同一条语句里的子查询，等锁之后看不到等锁期间别的事务刚提交的账号；要准确的人数在锁住之后用 `countRoleStaff` 另查。
 */
export async function findPlatformRole(db: Db, key: string, options: { lock?: boolean | "update" | "share" } = {}): Promise<PlatformRoleRecord | null> {
  const lock = options.lock === true || options.lock === "update" ? "for update" : options.lock === "share" ? "for share" : "";
  const result = await db.query<RoleRow>(`select ${COLUMNS} from platform_roles where key = $1 ${lock}`, [key]);
  const row = result.rows[0];
  return row ? toRole(row) : null;
}

export interface CustomRoleFields {
  name: string;
  description: string | null;
  grants: readonly string[];
  scope: PlatformDataScope;
  ipAllowlist: readonly string[];
}

export async function insertCustomRole(db: Db, key: string, fields: CustomRoleFields, createdBy: string, now: Date): Promise<PlatformRoleRecord> {
  const result = await db.query<RoleRow>(
    `insert into platform_roles (key, name, builtin, description, grants, scope_city_ids, scope_channel_ids, ip_allowlist, created_by, created_at, updated_at)
     values ($1, $2, false, $3, $4, $5, $6, $7, $8, $9, $9)
     returning ${COLUMNS}`,
    [key, fields.name, fields.description, fields.grants, fields.scope.cityIds, fields.scope.channelIds, fields.ipAllowlist, createdBy, now],
  );
  return toRole(result.rows[0] as RoleRow);
}

/** 改自建角色（复核通过时），版本加一。 */
export async function updateCustomRole(db: Db, key: string, fields: CustomRoleFields, now: Date): Promise<void> {
  await db.query(
    `update platform_roles
        set name = $2, description = $3, grants = $4, scope_city_ids = $5, scope_channel_ids = $6, ip_allowlist = $7, version = version + 1, updated_at = $8
      where key = $1 and not builtin`,
    [key, fields.name, fields.description, fields.grants, fields.scope.cityIds, fields.scope.channelIds, fields.ipAllowlist, now],
  );
}

/** 有多少账号（含待激活、已停用）指着这个角色。单独一条语句：读已提交级别下看得到等锁期间别的事务刚提交的账号。 */
export async function countRoleStaff(db: Db, key: string): Promise<number> {
  const result = await db.query<{ n: number }>("select count(*)::int as n from platform_users where role = $1", [key]);
  return (result.rows[0] as { n: number }).n;
}

export async function deleteCustomRole(db: Db, key: string): Promise<void> {
  await db.query("delete from platform_roles where key = $1 and not builtin", [key]);
}

/** 不存在的城市编号（数据范围保存前核对）。 */
export async function missingCityIds(db: Db, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const result = await db.query<{ id: string }>("select x.id from unnest($1::uuid[]) as x(id) where not exists (select 1 from cities c where c.id = x.id)", [ids]);
  return result.rows.map((row) => row.id);
}

/** 不存在的渠道编号。 */
export async function missingChannelIds(db: Db, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const result = await db.query<{ id: string }>("select x.id from unnest($1::uuid[]) as x(id) where not exists (select 1 from channels c where c.id = x.id)", [ids]);
  return result.rows.map((row) => row.id);
}

/** 数据范围里的城市、渠道的名字（角色页显示用）。 */
export async function scopeNames(db: Db, scope: PlatformDataScope): Promise<{ cities: Map<string, string>; channels: Map<string, string> }> {
  const cities = scope.cityIds === null || scope.cityIds.length === 0 ? [] : (await db.query<{ id: string; name: string }>("select id, coalesce(name->>'zh', name->>'en', code) as name from cities where id = any($1::uuid[])", [scope.cityIds])).rows;
  const channels = scope.channelIds === null || scope.channelIds.length === 0 ? [] : (await db.query<{ id: string; name: string }>("select id, name from channels where id = any($1::uuid[])", [scope.channelIds])).rows;
  return { cities: new Map(cities.map((row) => [row.id, row.name])), channels: new Map(channels.map((row) => [row.id, row.name])) };
}
