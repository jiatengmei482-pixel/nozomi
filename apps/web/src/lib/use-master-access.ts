import { type PlatformAction, type PlatformDataScope, type TenantAction, isPlatformRole, isTenantRole, platformRoleCan, scopeIsRestricted, tenantRoleCan } from "@nozomi/domain";
import { type CurrentAccount, usePortalSession } from "../auth/PortalSession.tsx";

/**
 * 后端对「限定了数据范围」的员工一律 403 `DATA_SCOPE_DENIED` 的操作，和挡住它的维度（`any` = 城市、渠道任一维度限定了就挡）：
 * - `finance`：财务结算的全部接口（ADR 0040：一张账单含一家供应商在各城市、各渠道的订单，切不开）；
 * - `channel.create`：新建渠道（ADR 0030：新渠道不在任何人限定的渠道范围里，建了自己也看不到）——只看渠道维度；
 * - `tenant.rescue`：按供应商批量发起救援（ADR 0030：会动到它名下全部未来订单）。
 * 前端在范围挡住时不显示对应的入口和按钮（菜单、首页卡片、页面按钮），免得点了必然 403。
 * 其余操作的数据范围是「列表只列范围内的、范围外按编号 404」，页面照常进得去，不在这里。
 * 和后端的对应关系由 `use-master-access.test.ts` 扫描后端路由核对：后端新加一处 `dataScopeDenied()`，要在这里登记。
 */
export type ScopeDeniedOperation = "finance" | "channel.create" | "tenant.rescue";

export const SCOPE_DENIED_OPERATIONS: Readonly<Record<ScopeDeniedOperation, "any" | "city" | "channel">> = {
  finance: "any",
  "channel.create": "channel",
  "tenant.rescue": "any",
};

/** 这个数据范围挡不挡这个操作。 */
export function scopeDenies(scope: PlatformDataScope, operation: ScopeDeniedOperation): boolean {
  const dimension = SCOPE_DENIED_OPERATIONS[operation];
  if (dimension === "any") return scopeIsRestricted(scope);
  return dimension === "city" ? scope.cityIds !== null : scope.channelIds !== null;
}

/** 整个菜单都被数据范围挡住的接口操作（角色勾了也按「没有」处理）：财务结算的查看、编辑、审核。 */
export const ACTION_SCOPE_OPERATIONS: Readonly<Partial<Record<PlatformAction, ScopeDeniedOperation>>> = {
  "statement.read": "finance",
  "statement.manage": "finance",
  "statement.review": "finance",
};

/** 角色本身给没给这个操作，不看数据范围：内置角色按 @nozomi/domain 的权限表（和后端同一份），自建角色（ADR 0030）按 `auth/me` 给的操作清单。 */
export function platformRoleGrants(account: Pick<CurrentAccount, "role" | "permissions">, action: PlatformAction): boolean {
  return isPlatformRole(account.role) ? platformRoleCan(account.role, action) : account.permissions.includes(action);
}

/**
 * 一个平台员工能不能做某个操作：角色给了，且没有被数据范围挡住（`ACTION_SCOPE_OPERATIONS`）。
 * 菜单、首页卡片、页面都用这一个判断，条件自然一致。只决定显示什么，真正的检查在后端。
 */
export function platformAccountCan(account: Pick<CurrentAccount, "role" | "permissions" | "dataScope">, action: PlatformAction): boolean {
  if (!platformRoleGrants(account, action)) return false;
  const operation = ACTION_SCOPE_OPERATIONS[action];
  return operation === undefined || !scopeDenies(account.dataScope, operation);
}

/** 当前登录的平台员工能不能做某个操作。账号信息还没取回来时一律当作不能（按钮晚一点出现，好过先出现再消失）。 */
export function usePlatformCan(action: PlatformAction): boolean {
  const { portal, account } = usePortalSession();
  if (portal.key !== "platform" || account.status !== "ready") return false;
  return platformAccountCan(account.account, action);
}

/** 角色给了这个操作、却因为限定了数据范围用不了：页面据此说明「为什么看不了」，而不是笼统的没有权限。 */
export function usePlatformScopeBlocks(action: PlatformAction): boolean {
  const { portal, account } = usePortalSession();
  if (portal.key !== "platform" || account.status !== "ready") return false;
  return platformRoleGrants(account.account, action) && !platformAccountCan(account.account, action);
}

/** 当前登录的平台员工的数据范围挡不挡某个操作（新建渠道、按供应商批量发起救援这类按钮用；账号信息没回来时当作挡住）。 */
export function usePlatformScopeDenies(operation: ScopeDeniedOperation): boolean {
  const { portal, account } = usePortalSession();
  if (portal.key !== "platform" || account.status !== "ready") return true;
  return scopeDenies(account.account.dataScope, operation);
}

/** 当前登录的供应商账号能不能做某个操作。账号信息还没取回来时一律当作不能。 */
export function useTenantCan(action: TenantAction): boolean {
  const { portal, account } = usePortalSession();
  if (portal.key !== "tenant" || account.status !== "ready") return false;
  const role = account.account.role;
  return isTenantRole(role) && tenantRoleCan(role, action);
}
