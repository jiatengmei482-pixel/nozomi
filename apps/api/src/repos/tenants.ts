/**
 * 租户主体的数据访问。
 * - 带 `AcrossTenants` 或以平台视角操作的函数只在 withSystemTx 里调用（平台员工的操作）。
 * - `findOwnTenant` 在 withTenantTx 里调用：行级安全保证只读得到自己这一行。
 */
import type { Db } from "../db/context.ts";
import { type Page, type TimeCursor, toPage } from "../pagination.ts";

export type TenantStatus = "active" | "suspended";

export interface Tenant {
  id: string;
  name: string;
  status: TenantStatus;
  createdAt: Date;
  updatedAt: Date;
}

interface TenantRow {
  id: string;
  name: string;
  status: TenantStatus;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS = "id, name, status, created_at, updated_at";

function toTenant(row: TenantRow): Tenant {
  return { id: row.id, name: row.name, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at };
}

export async function insertTenant(db: Db, name: string, now: Date): Promise<Tenant> {
  const result = await db.query<TenantRow>(
    `insert into tenants (name, status, created_at, updated_at) values ($1, 'active', $2, $2) returning ${COLUMNS}`,
    [name, now],
  );
  return toTenant(result.rows[0] as TenantRow);
}

export async function listTenantsAcrossTenants(db: Db, limit: number, after: TimeCursor | null): Promise<Page<Tenant>> {
  const result = await db.query<TenantRow & { cursor_time: string }>(
    `select ${COLUMNS}, created_at::text as cursor_time
       from tenants
      where $1::timestamptz is null or (created_at, id) > ($1::timestamptz, $2::uuid)
      order by created_at, id
      limit $3`,
    [after?.t ?? null, after?.id ?? null, limit + 1],
  );
  return toPage(result.rows, limit, toTenant, (row) => ({ t: row.cursor_time, id: row.id }));
}

/** 平台按编号取租户。`lock` 为真时锁住这一行直到事务结束（改状态前用）。 */
export async function findTenantForPlatform(db: Db, tenantId: string, options: { lock: boolean }): Promise<Tenant | null> {
  const result = await db.query<TenantRow>(
    `select ${COLUMNS} from tenants where id = $1 ${options.lock ? "for update" : ""}`,
    [tenantId],
  );
  const row = result.rows[0];
  return row ? toTenant(row) : null;
}

export async function setTenantStatus(db: Db, tenantId: string, status: TenantStatus, now: Date): Promise<Tenant> {
  const result = await db.query<TenantRow>(
    `update tenants set status = $2, updated_at = $3 where id = $1 returning ${COLUMNS}`,
    [tenantId, status, now],
  );
  return toTenant(result.rows[0] as TenantRow);
}

/** 租户事务里读自己的租户。 */
export async function findOwnTenant(db: Db, tenantId: string): Promise<Tenant | null> {
  const result = await db.query<TenantRow>(`select ${COLUMNS} from tenants where id = $1`, [tenantId]);
  const row = result.rows[0];
  return row ? toTenant(row) : null;
}
