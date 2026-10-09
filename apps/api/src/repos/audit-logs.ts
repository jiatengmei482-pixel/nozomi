/**
 * 审计日志的读写。只有「写一条」和「查询」，没有修改和删除（数据库触发器也会拦截）。
 *
 * 前后值（before / after）由调用方用白名单字段显式组装，这里不接受整行数据，
 * 所以密码哈希、令牌这类字段进不来。
 */
import type { Db } from "../db/context.ts";
import { type Page, type SequenceCursor, toPage } from "../pagination.ts";

export type AuditActorType = "platform_user" | "tenant_user" | "system" | "anonymous";
export type AuditSource = "console" | "api" | "cli";
export type AuditResource =
  | "platform_user"
  | "tenant"
  | "tenant_user"
  | "integration"
  | "city"
  | "place"
  | "vehicle_group"
  | "addon"
  | "area"
  | "brand"
  | "product";
export type AuditAction =
  | "login"
  | "login_failed"
  | "logout"
  | "create"
  | "invite"
  | "accept_invite"
  | "disable"
  | "enable"
  | "update"
  | "delete"
  | "publish"
  | "unpublish"
  | "change_role"
  | "change_password"
  | "request_password_reset"
  | "reset_password"
  | "suspend"
  | "resume"
  | "view";

/** 能原样存进 jsonb 的值。主数据的多语言名称、坐标、组合列表这类字段在前后值里是嵌套的。 */
export type AuditValue = string | number | boolean | null | AuditValue[] | { [key: string]: AuditValue };
export type AuditValues = Record<string, AuditValue>;

export interface AuditActor {
  type: AuditActorType;
  id: string | null;
  email: string | null;
}

/** 一次请求（或一次命令行操作）里不变的部分：谁、什么时间、从哪来、哪个入口。 */
export interface AuditOrigin {
  occurredAt: Date;
  actor: AuditActor;
  ip: string | null;
  source: AuditSource;
}

export interface AuditEvent {
  /** 记录所属的租户；平台级操作为 null。租户事务里必须等于当前租户，否则数据库拒绝写入 */
  tenantId: string | null;
  resource: AuditResource;
  resourceId: string | null;
  action: AuditAction;
  before: AuditValues | null;
  after: AuditValues | null;
}

export interface AuditLog extends AuditOrigin, AuditEvent {
  id: string;
}

export async function insertAuditLog(db: Db, origin: AuditOrigin, event: AuditEvent): Promise<void> {
  await db.query(
    `insert into audit_logs
       (occurred_at, tenant_id, actor_type, actor_id, actor_email, ip, source, resource, resource_id, action, before, after)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      origin.occurredAt,
      event.tenantId,
      origin.actor.type,
      origin.actor.id,
      origin.actor.email,
      origin.ip,
      origin.source,
      event.resource,
      event.resourceId,
      event.action,
      event.before === null ? null : JSON.stringify(event.before),
      event.after === null ? null : JSON.stringify(event.after),
    ],
  );
}

interface AuditLogRow {
  id: string;
  occurred_at: Date;
  tenant_id: string | null;
  actor_type: AuditActorType;
  actor_id: string | null;
  actor_email: string | null;
  ip: string | null;
  source: AuditSource;
  resource: AuditResource;
  resource_id: string | null;
  action: AuditAction;
  before: AuditValues | null;
  after: AuditValues | null;
}

function toAuditLog(row: AuditLogRow): AuditLog {
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    tenantId: row.tenant_id,
    actor: { type: row.actor_type, id: row.actor_id, email: row.actor_email },
    ip: row.ip,
    source: row.source,
    resource: row.resource,
    resourceId: row.resource_id,
    action: row.action,
    before: row.before,
    after: row.after,
  };
}

export interface AuditLogFilter {
  actorId?: string | undefined;
  tenantId?: string | undefined;
  resource?: string | undefined;
  resourceId?: string | undefined;
  action?: string | undefined;
  /** 起始时间（含） */
  from?: Date | undefined;
  /** 结束时间（不含） */
  to?: Date | undefined;
}

/** 平台侧跨租户查询审计日志（只在 withPlatformTx 里调用），从新到旧。 */
export async function listAuditLogsAcrossTenants(
  db: Db,
  filter: AuditLogFilter,
  limit: number,
  after: SequenceCursor | null,
): Promise<Page<AuditLog>> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  const add = (sql: string, value: unknown): void => {
    values.push(value);
    conditions.push(sql.replace("?", `$${values.length}`));
  };
  if (filter.actorId !== undefined) add("actor_id = ?", filter.actorId);
  if (filter.tenantId !== undefined) add("tenant_id = ?", filter.tenantId);
  if (filter.resource !== undefined) add("resource = ?", filter.resource);
  if (filter.resourceId !== undefined) add("resource_id = ?", filter.resourceId);
  if (filter.action !== undefined) add("action = ?", filter.action);
  if (filter.from !== undefined) add("occurred_at >= ?", filter.from);
  if (filter.to !== undefined) add("occurred_at < ?", filter.to);
  if (after !== null) add("id < ?", after.id);
  values.push(limit + 1);
  const result = await db.query<AuditLogRow>(
    `select id, occurred_at, tenant_id, actor_type, actor_id, actor_email, ip, source,
            resource, resource_id, action, before, after
       from audit_logs
      ${conditions.length > 0 ? `where ${conditions.join(" and ")}` : ""}
      order by id desc
      limit $${values.length}`,
    values,
  );
  return toPage(result.rows, limit, toAuditLog, (row) => ({ id: row.id }));
}

/** 租户能看到的操作人类型：本租户的用户，以及未登录的访问者（登录失败）。平台员工和系统的操作不给租户看。 */
const TENANT_VISIBLE_ACTOR_TYPES: readonly AuditActorType[] = ["tenant_user", "anonymous"];

export type TenantAuditLogFilter = Omit<AuditLogFilter, "tenantId">;

/**
 * 租户查自己的操作日志（在 withTenantTx 里调用），从新到旧。
 * 只返回本租户名下、由本租户用户（或登录失败的访问者）产生的记录；
 * 平台员工对这个租户做的操作（创建、暂停及原因、代发邀请）属于平台内部记录，不在其中。
 */
export async function listTenantAuditLogs(
  db: Db,
  tenantId: string,
  filter: TenantAuditLogFilter,
  limit: number,
  after: SequenceCursor | null,
): Promise<Page<AuditLog>> {
  const conditions: string[] = ["tenant_id = $1", "actor_type = any($2::text[])"];
  const values: unknown[] = [tenantId, TENANT_VISIBLE_ACTOR_TYPES];
  const add = (sql: string, value: unknown): void => {
    values.push(value);
    conditions.push(sql.replace("?", `$${values.length}`));
  };
  if (filter.actorId !== undefined) add("actor_id = ?", filter.actorId);
  if (filter.resource !== undefined) add("resource = ?", filter.resource);
  if (filter.resourceId !== undefined) add("resource_id = ?", filter.resourceId);
  if (filter.action !== undefined) add("action = ?", filter.action);
  if (filter.from !== undefined) add("occurred_at >= ?", filter.from);
  if (filter.to !== undefined) add("occurred_at < ?", filter.to);
  if (after !== null) add("id < ?", after.id);
  values.push(limit + 1);
  const result = await db.query<AuditLogRow>(
    `select id, occurred_at, tenant_id, actor_type, actor_id, actor_email, ip, source,
            resource, resource_id, action, before, after
       from audit_logs
      where ${conditions.join(" and ")}
      order by id desc
      limit $${values.length}`,
    values,
  );
  return toPage(result.rows, limit, toAuditLog, (row) => ({ id: row.id }));
}
