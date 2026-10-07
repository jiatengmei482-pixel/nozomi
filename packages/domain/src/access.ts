/**
 * 角色与权限（M0-06）。
 *
 * 角色清单是系统定义的常量，来源是需求文档：
 * - 平台角色：《平台运营端与渠道对接》「运营后台菜单与角色」
 * - 租户角色：《用车报价服务平台》「11. 账号、权限与 API 设置」
 * 数据库里的 platform_roles / tenant_roles 两张表由迁移写入同一份清单，集成测试保证两边一致。
 *
 * 权限模型做到「角色 → 允许的操作」，由接口层强制执行。
 * 这里只列已经有接口的操作；以后每加一组接口，就在这里加操作并分配给角色。
 */

export const PLATFORM_ROLES = [
  { key: "super_admin", name: "超级管理员" },
  { key: "operations", name: "运营" },
  { key: "tenant_onboarding", name: "招商" },
  { key: "channel_manager", name: "渠道经理" },
  { key: "customer_service", name: "客服" },
  { key: "finance", name: "财务" },
  { key: "risk", name: "风控" },
  { key: "master_data", name: "主数据运营" },
  { key: "tech", name: "技术" },
  { key: "readonly", name: "只读" },
] as const;

export type PlatformRole = (typeof PLATFORM_ROLES)[number]["key"];

export const TENANT_ROLES = [
  { key: "admin", name: "管理员" },
  { key: "pricing", name: "商品价格" },
  { key: "dispatch", name: "调度" },
  { key: "finance", name: "财务" },
  { key: "readonly", name: "只读" },
] as const;

export type TenantRole = (typeof TENANT_ROLES)[number]["key"];

export const PLATFORM_ACTIONS = [
  "staff.read",
  "staff.manage",
  "tenant.read",
  "tenant.create",
  "tenant.change_status",
  "audit_log.read",
  "integration.read",
] as const;

export type PlatformAction = (typeof PLATFORM_ACTIONS)[number];

export const TENANT_ACTIONS = ["user.read", "user.manage", "audit_log.read"] as const;

export type TenantAction = (typeof TENANT_ACTIONS)[number];

/**
 * 平台角色 → 允许的操作。依据菜单表的「主要使用角色」：
 * 租户管理归招商和运营；系统设置（平台账号、审计日志）只归超级管理员；集成状态归技术。
 * 只读角色能看租户，但看不到系统设置里的内容。
 */
const PLATFORM_PERMISSIONS: Readonly<Record<PlatformRole, readonly PlatformAction[]>> = {
  super_admin: PLATFORM_ACTIONS,
  operations: ["tenant.read", "tenant.create", "tenant.change_status"],
  tenant_onboarding: ["tenant.read", "tenant.create", "tenant.change_status"],
  channel_manager: [],
  customer_service: [],
  finance: [],
  risk: [],
  master_data: [],
  tech: ["integration.read"],
  readonly: ["tenant.read"],
};

/** 租户角色 → 允许的操作。账号管理和操作日志只归管理员；只读角色可以看账号列表。 */
const TENANT_PERMISSIONS: Readonly<Record<TenantRole, readonly TenantAction[]>> = {
  admin: TENANT_ACTIONS,
  pricing: [],
  dispatch: [],
  finance: [],
  readonly: ["user.read"],
};

export function isPlatformRole(value: string): value is PlatformRole {
  return PLATFORM_ROLES.some((role) => role.key === value);
}

export function isTenantRole(value: string): value is TenantRole {
  return TENANT_ROLES.some((role) => role.key === value);
}

export function platformPermissions(role: PlatformRole): readonly PlatformAction[] {
  return PLATFORM_PERMISSIONS[role];
}

export function tenantPermissions(role: TenantRole): readonly TenantAction[] {
  return TENANT_PERMISSIONS[role];
}

export function platformRoleCan(role: PlatformRole, action: PlatformAction): boolean {
  return PLATFORM_PERMISSIONS[role].includes(action);
}

export function tenantRoleCan(role: TenantRole, action: TenantAction): boolean {
  return TENANT_PERMISSIONS[role].includes(action);
}

export type AccountStatus = "invited" | "active" | "disabled";

export interface AccountRoleState<Role extends string> {
  role: Role;
  status: AccountStatus;
}

/**
 * 「至少保留一个」规则（租户的管理员、平台的超级管理员）：
 * 目标账号现在是在用的关键角色，改动后不再是，而且此刻只有它一个，这样的改动不允许。
 *
 * @param activeKeyRoleCount 改动前「状态为在用、角色为关键角色」的账号数量（含目标账号自己）
 */
export function removesLastKeyRoleHolder<Role extends string>(
  keyRole: Role,
  activeKeyRoleCount: number,
  before: AccountRoleState<Role>,
  after: AccountRoleState<Role>,
): boolean {
  const holds = (state: AccountRoleState<Role>): boolean => state.role === keyRole && state.status === "active";
  return holds(before) && !holds(after) && activeKeyRoleCount <= 1;
}

export type StatusChangeError = "STATUS_INVITED_IS_NOT_SETTABLE" | "ACCOUNT_NOT_ACTIVATED";

/**
 * 账号状态能不能这样改：
 * - 「待激活」不能手工设置：它只在发出邀请时产生。
 * - 从未激活过（没有设过密码）的账号不能手工改成「在用」，只能重新邀请、由本人接受邀请来激活。
 * - 其余改动（停用、把激活过的账号重新启用、撤销邀请）都允许。
 *
 * @param activated 账号是否激活过（设过密码）
 */
export function checkStatusChange(
  before: AccountStatus,
  activated: boolean,
  after: AccountStatus,
): StatusChangeError | null {
  if (before === after) return null;
  if (after === "invited") return "STATUS_INVITED_IS_NOT_SETTABLE";
  if (after === "active" && !activated) return "ACCOUNT_NOT_ACTIVATED";
  return null;
}
