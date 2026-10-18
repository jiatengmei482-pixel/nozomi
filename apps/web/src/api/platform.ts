/**
 * 运营后台「供应商、平台员工、审计日志、系统状态」的接口（`/platform/v1/tenants*`、`/staff*`、`/audit-logs`、`/integrations`）。
 * 字段与 `apps/api/openapi.yaml` 对齐，由 platform.contract.test.ts 保证。
 *
 * 五个发令牌的接口（新建供应商、邀请管理员、给管理员发密码重置、新增员工、给员工发密码重置）：
 * 令牌只在这一次应答里出现。这里只把应答原样交给调用的页面，不缓存、不打日志、不自动重试（重试一次就多发一个令牌、让上一个作废）。
 */
import type { FxFetchStatus, FxTableState, PlatformRole } from "@nozomi/domain";
import { query } from "./areas.ts";
import { ApiError, apiRequest } from "./client.ts";
import type { PlatformUser, Tenant, TenantUser } from "./types.ts";

export const PLATFORM_BASE = "/platform/v1";
export const TENANTS_PATH = `${PLATFORM_BASE}/tenants`;
export const STAFF_PATH = `${PLATFORM_BASE}/staff`;
export const AUDIT_LOGS_PATH = `${PLATFORM_BASE}/audit-logs`;
export const INTEGRATIONS_PATH = `${PLATFORM_BASE}/integrations`;

/** 一次性的令牌和它的有效期（邀请、密码重置的应答里都是这个样子）。 */
export interface OneTimeToken {
  token: string;
  expires_at: string;
}

export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

/**
 * 发令牌的接口应答成功、却没有带令牌：按「不知道有没有成功」处理（和服务器出错同一类），
 * 页面不会把一条用不了的链接交出去。
 */
async function withToken<T, K extends keyof T>(request: Promise<T>, field: K): Promise<T> {
  const result = await request;
  const issued = (result as { [key in K]?: { token?: unknown } | null })?.[field];
  if (typeof issued?.token !== "string" || issued.token === "") throw new ApiError(502, "UNKNOWN", "", {}, null);
  return result;
}

const one = (base: string, id: string): string => `${base}/${encodeURIComponent(id)}`;
/** 列表接口一次最多取多少条。 */
export const PAGE_LIMIT = 200;

/** 把一个只能翻页的列表全部取完（供应商、平台员工：人少，筛选和搜索在浏览器里做）。取到 `max` 条还没完就停下，`truncated` 为真。 */
async function listAll<T>(token: string, path: string, max: number): Promise<{ items: T[]; truncated: boolean }> {
  const items: T[] = [];
  let cursor: string | null = null;
  do {
    const page: Page<T> = await apiRequest("GET", query(path, { limit: PAGE_LIMIT, ...(cursor !== null ? { cursor } : {}) }), { token });
    items.push(...page.items);
    cursor = page.next_cursor;
  } while (cursor !== null && items.length < max);
  return { items, truncated: cursor !== null };
}

// ───────────── 供应商 ─────────────

/** 供应商最多载入多少家（再多就要接口支持筛选了）。 */
export const TENANT_LOAD_MAX = 2000;

export function listAllTenants(token: string): Promise<{ items: Tenant[]; truncated: boolean }> {
  return listAll<Tenant>(token, TENANTS_PATH, TENANT_LOAD_MAX);
}

export function getTenant(token: string, id: string): Promise<Tenant> {
  return apiRequest("GET", one(TENANTS_PATH, id), { token });
}

export interface TenantCreate {
  name: string;
  admin: { email: string; name: string };
}

export function createTenant(token: string, body: TenantCreate): Promise<{ tenant: Tenant; admin_user: TenantUser; invite: OneTimeToken }> {
  return withToken(apiRequest("POST", TENANTS_PATH, { token, body }), "invite");
}

export function suspendTenant(token: string, id: string, reason: string): Promise<Tenant> {
  return apiRequest("POST", `${one(TENANTS_PATH, id)}/suspend`, { token, body: { reason } });
}

export function resumeTenant(token: string, id: string): Promise<Tenant> {
  return apiRequest("POST", `${one(TENANTS_PATH, id)}/resume`, { token });
}

export function inviteTenantAdmin(token: string, id: string, body: { email: string; name: string }): Promise<{ user: TenantUser; invite: OneTimeToken }> {
  return withToken(apiRequest("POST", `${one(TENANTS_PATH, id)}/admin-invites`, { token, body }), "invite");
}

export function issueTenantAdminReset(token: string, id: string, email: string): Promise<{ user: TenantUser; reset: OneTimeToken }> {
  return withToken(apiRequest("POST", `${one(TENANTS_PATH, id)}/admin-password-resets`, { token, body: { email } }), "reset");
}

// ───────────── 平台员工 ─────────────

export function listAllStaff(token: string): Promise<{ items: PlatformUser[]; truncated: boolean }> {
  return listAll<PlatformUser>(token, STAFF_PATH, TENANT_LOAD_MAX);
}

export interface StaffCreate {
  email: string;
  name: string;
  role: PlatformRole;
}

export function createStaff(token: string, body: StaffCreate): Promise<{ user: PlatformUser; invite: OneTimeToken }> {
  return withToken(apiRequest("POST", STAFF_PATH, { token, body }), "invite");
}

export function setStaffEnabled(token: string, id: string, action: "enable" | "disable"): Promise<PlatformUser> {
  return apiRequest("POST", `${one(STAFF_PATH, id)}/${action}`, { token });
}

export function issueStaffReset(token: string, id: string): Promise<{ user: PlatformUser; reset: OneTimeToken }> {
  return withToken(apiRequest("POST", `${one(STAFF_PATH, id)}/password-reset`, { token }), "reset");
}

// ───────────── 审计日志 ─────────────

export type AuditActorType = "platform_user" | "tenant_user" | "system" | "anonymous";
export type AuditSource = "console" | "api" | "cli" | "job";

export interface AuditLog {
  id: string;
  occurred_at: string;
  tenant_id: string | null;
  actor: { type: AuditActorType; id: string | null; email: string | null };
  ip: string | null;
  source: AuditSource;
  resource: string;
  resource_id: string | null;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export interface AuditLogQuery {
  actor_id?: string;
  tenant_id?: string;
  resource?: string;
  resource_id?: string;
  action?: string;
  /** 含 */
  from?: string;
  /** 不含 */
  to?: string;
  limit?: number;
  cursor?: string;
}
export const AUDIT_QUERY_KEYS = ["actor_id", "tenant_id", "resource", "resource_id", "action", "from", "to", "limit", "cursor"] as const satisfies readonly (keyof AuditLogQuery)[];

export function listAuditLogs(token: string, values: AuditLogQuery): Promise<Page<AuditLog>> {
  return apiRequest("GET", query(AUDIT_LOGS_PATH, values), { token });
}

// ───────────── 系统状态 ─────────────

export interface IntegrationStatus {
  key: string;
  label: string;
  state: "configured" | "missing";
  /** 打过码的说明；永远不含密钥原文 */
  detail: string;
}

/** 汇率数据源的运行状态（`GET /integrations` 的 `fx_center`，ADR 0022）：`stale` = 超过 48 小时没更新，跨币种报价已暂停。 */
export interface FxCenterStatus {
  state: FxTableState;
  /** 现在这批汇率的时间（数据源给的，不是拉到的时间）；还没有汇率是 null */
  as_of: string | null;
  auto_fetch: boolean;
  last_attempt_status: FxFetchStatus | null;
  last_attempt_at: string | null;
  last_error_code: string | null;
}

export function listIntegrations(token: string): Promise<{ items: IntegrationStatus[]; fx_center: FxCenterStatus }> {
  return apiRequest("GET", INTEGRATIONS_PATH, { token });
}

/** 对账用：每个类型的字段名清单。 */
export const PLATFORM_SCHEMA_FIELDS = {
  Tenant: ["id", "name", "status", "created_at", "updated_at"],
  TenantUser: ["id", "email", "name", "role", "status", "created_at", "updated_at"],
  PlatformUser: ["id", "email", "name", "role", "status", "created_at", "updated_at"],
  Invite: ["token", "expires_at"],
  ResetToken: ["token", "expires_at"],
  AuditLog: ["id", "occurred_at", "tenant_id", "actor", "ip", "source", "resource", "resource_id", "action", "before", "after"],
  IntegrationStatusDetail: ["key", "label", "state", "detail"],
} as const satisfies {
  Tenant: readonly (keyof Tenant)[];
  TenantUser: readonly (keyof TenantUser)[];
  PlatformUser: readonly (keyof PlatformUser)[];
  Invite: readonly (keyof OneTimeToken)[];
  ResetToken: readonly (keyof OneTimeToken)[];
  AuditLog: readonly (keyof AuditLog)[];
  IntegrationStatusDetail: readonly (keyof IntegrationStatus)[];
};
/** 页面专门处理的错误码。 */
export const PLATFORM_ERROR_CODES = ["EMAIL_TAKEN", "LAST_ADMIN_REQUIRED", "ACCOUNT_NOT_ACTIVATED", "ACCOUNT_NOT_ACTIVE"] as const;
