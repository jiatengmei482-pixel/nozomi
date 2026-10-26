/**
 * 平台角色管理（M4-05，ADR 0030）：内置角色是只读模板；超级管理员可以自建角色，勾选「菜单 × 操作」、配置数据范围和 IP 白名单。
 *
 * - 新建：直接生效（新角色还没有人用，不影响任何人的权限；把人改成这个角色是另一件事，见 platform-staff.ts）；
 * - 修改：双人复核（`platform_role.update`）——发起时校验，批准时按那一刻的数据再校验并核对版本；
 * - 删除：只有没有任何账号（含待激活、已停用）指着它时才能删，直接生效；
 * - 内置角色不能改、不能删（409，数据库触发器兜底）。
 * 权限每个请求从数据库现查（鉴权的那一条查询顺带读出角色），改了立即生效，没有缓存要失效。
 */
import { randomBytes } from "node:crypto";
import {
  type PlatformDataScope,
  grantsOfActions,
  isPlatformRole,
  normalizeAllowlist,
  platformPermissions,
  roleGrantIssues,
  scopeAllowsChannel,
} from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { type Db, isForeignKeyViolation, isUniqueViolation, withPlatformTx } from "../db/context.ts";
import { validationFailed } from "../validation.ts";
import type { Approval } from "../repos/approvals.ts";
import { type AuditValues, insertAuditLog } from "../repos/audit-logs.ts";
import {
  type CustomRoleFields,
  type PlatformRoleRecord,
  countRoleStaff,
  deleteCustomRole,
  findPlatformRole,
  insertCustomRole,
  listPlatformRoles,
  missingChannelIds,
  missingCityIds,
  scopeNames,
  updateCustomRole,
} from "../repos/platform-roles.ts";
import { type ApprovalKind, approvalStale, requestApproval } from "./approvals.ts";
import { consoleOrigin, platformActor } from "./audit.ts";
import {
  ipAllowlistInvalid,
  notFound,
  roleBuiltinReadonly,
  roleGrantsInvalid,
  roleInUse,
  roleNameTaken,
  roleScopeInvalid,
} from "./errors.ts";
import type { PlatformPrincipal } from "./platform-auth.ts";

export interface RoleView extends PlatformRoleRecord {
  /** 显示用的勾选：自建角色就是存的勾选；内置角色由代码里的权限表换算 */
  effectiveGrants: string[];
  /** 数据范围里城市、渠道的名字 */
  scopeNames: { cities: Map<string, string>; channels: Map<string, string> };
}

function effectiveGrantsOf(role: PlatformRoleRecord): string[] {
  if (!role.builtin) return role.grants ?? [];
  return isPlatformRole(role.key) ? grantsOfActions(platformPermissions(role.key)) : [];
}

async function view(db: Db, role: PlatformRoleRecord): Promise<RoleView> {
  return { ...role, effectiveGrants: effectiveGrantsOf(role), scopeNames: await scopeNames(db, role.scope) };
}

export function listRoles(ctx: AppContext): Promise<RoleView[]> {
  return withPlatformTx(ctx.pool, async (db) => Promise.all((await listPlatformRoles(db)).map((role) => view(db, role))), { snapshot: true });
}

export function getRole(ctx: AppContext, key: string): Promise<RoleView> {
  return withPlatformTx(ctx.pool, async (db) => {
    const role = await findPlatformRole(db, key);
    if (!role) throw notFound("角色");
    return view(db, role);
  });
}

export interface RoleInput {
  name: string;
  description: string | null;
  grants: readonly string[];
  scope: PlatformDataScope;
  ipAllowlist: readonly string[];
}

/** 校验并规范一个自建角色的内容（新建、发起修改、批准时都走这里）。 */
async function checkedFields(db: Db, input: RoleInput): Promise<CustomRoleFields> {
  const grantIssues = roleGrantIssues(input.grants);
  if (grantIssues.length > 0) throw roleGrantsInvalid(grantIssues);
  const allowlist = normalizeAllowlist(input.ipAllowlist);
  if (allowlist.issues.length > 0) throw ipAllowlistInvalid(allowlist.issues);
  const dedupe = (ids: readonly string[] | null): string[] | null => (ids === null ? null : [...new Set(ids.map((id) => id.toLowerCase()))]);
  const scope = { cityIds: dedupe(input.scope.cityIds), channelIds: dedupe(input.scope.channelIds) };
  const missing = { cityIds: await missingCityIds(db, scope.cityIds ?? []), channelIds: await missingChannelIds(db, scope.channelIds ?? []) };
  if (missing.cityIds.length > 0 || missing.channelIds.length > 0) throw roleScopeInvalid(missing);
  return { name: input.name.trim(), description: input.description?.trim() || null, grants: [...input.grants], scope, ipAllowlist: allowlist.cidrs };
}

export function roleValues(fields: CustomRoleFields): AuditValues {
  return {
    name: fields.name,
    description: fields.description,
    grants: [...fields.grants],
    scope_city_ids: fields.scope.cityIds === null ? null : [...fields.scope.cityIds],
    scope_channel_ids: fields.scope.channelIds === null ? null : [...fields.scope.channelIds],
    ip_allowlist: [...fields.ipAllowlist],
  };
}

function fieldsFromValues(values: AuditValues): RoleInput {
  const list = (key: string): string[] | null => (Array.isArray(values[key]) ? (values[key] as string[]) : null);
  return {
    name: String(values["name"] ?? ""),
    description: typeof values["description"] === "string" ? values["description"] : null,
    grants: list("grants") ?? [],
    scope: { cityIds: list("scope_city_ids"), channelIds: list("scope_channel_ids") },
    ipAllowlist: list("ip_allowlist") ?? [],
  };
}

function nameConflict(err: unknown): boolean {
  return isUniqueViolation(err, "platform_roles_name_key");
}

export async function createRole(ctx: AppContext, principal: PlatformPrincipal, input: RoleInput, ip: string): Promise<RoleView> {
  const now = ctx.now();
  const key = `custom_${randomBytes(8).toString("hex")}`;
  try {
    return await withPlatformTx(ctx.pool, async (db) => {
      const fields = await checkedFields(db, input);
      const role = await insertCustomRole(db, key, fields, principal.user.id, now);
      await insertAuditLog(db, consoleOrigin(platformActor(principal.user), ip, now), { tenantId: null, resource: "platform_role", resourceId: key, action: "create", before: null, after: roleValues(fields) });
      return view(db, role);
    });
  } catch (err) {
    if (nameConflict(err)) throw roleNameTaken();
    throw err;
  }
}

async function loadCustomRole(db: Db, key: string, lock = false): Promise<PlatformRoleRecord> {
  const role = await findPlatformRole(db, key, { lock });
  if (!role) throw notFound("角色");
  if (role.builtin) throw roleBuiltinReadonly();
  return role;
}

function currentFields(role: PlatformRoleRecord): CustomRoleFields {
  return { name: role.name, description: role.description, grants: role.grants ?? [], scope: role.scope, ipAllowlist: role.ipAllowlist };
}

export const PLATFORM_ROLE_UPDATE: ApprovalKind = {
  kind: "platform_role.update",
  resource: "platform_role",
  readAction: "role.read",
  requestAction: "role.manage",
  reviewAction: "role.review",
  async apply(db, approval, origin) {
    const role = await loadCustomRole(db, approval.resourceId, true);
    if (approval.baseVersion !== null && role.version !== approval.baseVersion) throw approvalStale(role.version);
    const fields = await checkedFields(db, fieldsFromValues(approval.payload));
    try {
      await updateCustomRole(db, role.key, fields, origin.occurredAt);
    } catch (err) {
      // 整个批准随之回滚，复核仍是待审核
      if (nameConflict(err)) throw roleNameTaken();
      throw err;
    }
    await insertAuditLog(db, origin, { tenantId: null, resource: "platform_role", resourceId: role.key, action: "update", before: roleValues(currentFields(role)), after: { ...roleValues(fields), approval_id: approval.id, requested_by: approval.requestedBy.email } });
  },
};

export const PLATFORM_ROLE_APPROVAL_KINDS: readonly ApprovalKind[] = [PLATFORM_ROLE_UPDATE];

/**
 * 发起修改自建角色：给出改完之后的完整内容（不是增量），和现在一样的不发起。
 * 名字和别的角色重复、勾选或数据范围不对，发起时就拦下。
 */
export async function requestRoleChange(ctx: AppContext, principal: PlatformPrincipal, key: string, input: RoleInput, note: string | null, ip: string): Promise<Approval> {
  const now = ctx.now();
  const origin = consoleOrigin(platformActor(principal.user), ip, now);
  return withPlatformTx(ctx.pool, async (db) => {
    const role = await loadCustomRole(db, key);
    const fields = await checkedFields(db, input);
    const before = roleValues(currentFields(role));
    const after = roleValues(fields);
    if (JSON.stringify(before) === JSON.stringify(after)) throw validationFailed("body", [{ path: "/", reason: "UNCHANGED", message: "和现在的角色一样，不用发起" }]);
    const sameName = (await listPlatformRoles(db)).find((other) => other.key !== key && other.name.trim().toLowerCase() === fields.name.toLowerCase());
    if (sameName) throw roleNameTaken();
    return requestApproval(db, origin, principal, { kind: PLATFORM_ROLE_UPDATE, resourceId: key, summary: `修改角色「${role.name}」${role.name === fields.name ? "" : `（改名为「${fields.name}」）`}`, payload: after, before, baseVersion: role.version, note });
  });
}

export async function removeRole(ctx: AppContext, principal: PlatformPrincipal, key: string, ip: string): Promise<void> {
  const now = ctx.now();
  try {
    await withPlatformTx(ctx.pool, async (db) => {
      const role = await loadCustomRole(db, key, true);
      // 锁住角色这一行之后另发一条语句数人：同时把人改成这个角色的事务（外键检查给角色行加了共享锁）提交之后才轮到这里，
      // 读已提交级别下新的语句看得到它刚写的账号；锁行那条语句里的子查询用的是等锁之前的快照，看不到
      const staffCount = await countRoleStaff(db, key);
      if (staffCount > 0) throw roleInUse(staffCount);
      await deleteCustomRole(db, key);
      await insertAuditLog(db, consoleOrigin(platformActor(principal.user), ip, now), { tenantId: null, resource: "platform_role", resourceId: key, action: "delete", before: roleValues(currentFields(role)), after: null });
    });
  } catch (err) {
    // 兜底：数完人之后仍有账号指了过来（外键 platform_users.role），按「还有人在用」回答
    if (isForeignKeyViolation(err)) throw roleInUse(1);
    throw err;
  }
}

/** 一个渠道在不在这个人的数据范围里（渠道的接口、订单、复核都用）。范围外的和不存在一样。 */
export function assertChannelInScope(principal: PlatformPrincipal, channelId: string): void {
  if (!scopeAllowsChannel(principal.grant.scope, channelId)) throw notFound("渠道");
}
