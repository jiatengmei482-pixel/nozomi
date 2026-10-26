/**
 * 运营后台的账号安全（ADR 0030）：两步验证（登录时、个人页）、员工详情 / 改角色和 IP 白名单 / 重置两步验证、角色管理。
 * 字段与 `apps/api/openapi.yaml` 对齐，由 platform-security.contract.test.ts 保证。
 *
 * 密钥原文和恢复码只在各自那一次应答里出现：这里原样交给页面，不缓存、不打日志、不自动重试。
 */
import type { PlatformAction } from "@nozomi/domain";
import { apiRequest } from "./client.ts";
import type { Approval } from "./channels.ts";
import { PLATFORM_BASE, STAFF_PATH, type StaffMember } from "./platform.ts";
import type { PlatformUser } from "./types.ts";

export const MFA_PATHS = {
  verify: `${PLATFORM_BASE}/auth/mfa/verify`,
  enrollment: `${PLATFORM_BASE}/auth/mfa/enrollment`,
  confirm: `${PLATFORM_BASE}/auth/mfa/enrollment/confirm`,
  recoveryCodes: `${PLATFORM_BASE}/auth/mfa/recovery-codes`,
} as const;
export const ROLES_PATH = `${PLATFORM_BASE}/roles`;

/** 动态码或恢复码（二选一） */
export type Factor = { code: string } | { recovery_code: string };

export interface MfaVerified {
  user: PlatformUser;
  must_change_password: boolean;
  second_factor: { status: "verified"; method: "totp" | "recovery_code" | "enrollment"; recovery_codes_remaining: number };
}

export interface EnrollmentStart {
  secret: string;
  otpauth_uri: string;
  expires_at: string;
}

export function verifySecondFactor(token: string, factor: Factor): Promise<MfaVerified> {
  return apiRequest("POST", MFA_PATHS.verify, { token, body: factor });
}

/** 第一次绑定时不用带因素；换手机时要带现在的动态码或恢复码。 */
export function startEnrollment(token: string, factor: Factor | null): Promise<EnrollmentStart> {
  return apiRequest("POST", MFA_PATHS.enrollment, { token, body: factor ?? {} });
}

export function confirmEnrollment(token: string, code: string): Promise<MfaVerified & { recovery_codes: string[] }> {
  return apiRequest("POST", MFA_PATHS.confirm, { token, body: { code } });
}

export function regenerateRecoveryCodes(token: string, factor: Factor): Promise<{ recovery_codes: string[] }> {
  return apiRequest("POST", MFA_PATHS.recoveryCodes, { token, body: factor });
}

// ───────────── 员工 ─────────────

export interface StaffDetail extends StaffMember {
  role_ip_allowlist: string[];
  recovery_codes_remaining: number | null;
}

export function getStaff(token: string, id: string): Promise<StaffDetail> {
  return apiRequest("GET", `${STAFF_PATH}/${encodeURIComponent(id)}`, { token });
}

export function updateStaff(token: string, id: string, body: { name?: string; role?: string; ip_allowlist?: string[] }): Promise<StaffDetail> {
  return apiRequest("PATCH", `${STAFF_PATH}/${encodeURIComponent(id)}`, { token, body });
}

export function requestStaffMfaReset(token: string, id: string, note: string): Promise<{ approval: Approval }> {
  return apiRequest("POST", `${STAFF_PATH}/${encodeURIComponent(id)}/mfa-reset`, { token, body: note === "" ? {} : { request_note: note } });
}

// ───────────── 角色 ─────────────

export interface NamedRef {
  id: string;
  name: string | null;
}

export interface Role {
  key: string;
  name: string;
  builtin: boolean;
  description: string | null;
  grants: string[];
  permissions: PlatformAction[];
  data_scope: { city_ids: string[] | null; channel_ids: string[] | null; cities: NamedRef[]; channels: NamedRef[] };
  ip_allowlist: string[];
  version: number;
  staff_count: number;
  created_at: string;
  updated_at: string;
}

export interface RoleInput {
  name: string;
  description: string | null;
  grants: string[];
  data_scope: { city_ids: string[] | null; channel_ids: string[] | null };
  ip_allowlist: string[];
}

export function listRoles(token: string): Promise<{ items: Role[] }> {
  return apiRequest("GET", ROLES_PATH, { token });
}

export function getRole(token: string, key: string): Promise<Role> {
  return apiRequest("GET", `${ROLES_PATH}/${encodeURIComponent(key)}`, { token });
}

export function createRole(token: string, body: RoleInput): Promise<Role> {
  return apiRequest("POST", ROLES_PATH, { token, body });
}

export function requestRoleChange(token: string, key: string, body: RoleInput & { request_note?: string }): Promise<{ approval: Approval }> {
  return apiRequest("POST", `${ROLES_PATH}/${encodeURIComponent(key)}/changes`, { token, body });
}

export function deleteRole(token: string, key: string): Promise<void> {
  return apiRequest("DELETE", `${ROLES_PATH}/${encodeURIComponent(key)}`, { token });
}

/** 对账用：每个类型的字段名清单。 */
export const SECURITY_SCHEMA_FIELDS = {
  RoleView: ["key", "name", "builtin", "description", "grants", "permissions", "data_scope", "ip_allowlist", "version", "staff_count", "created_at", "updated_at"],
  RoleInput: ["name", "description", "grants", "data_scope", "ip_allowlist"],
} as const satisfies { RoleView: readonly (keyof Role)[]; RoleInput: readonly (keyof RoleInput)[] };
