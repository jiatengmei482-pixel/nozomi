import { type PlatformAction, type TenantAction, isPlatformRole, isTenantRole, platformRoleCan, scopeIsRestricted, tenantRoleCan } from "@nozomi/domain";
import { type CurrentAccount, usePortalSession } from "../auth/PortalSession.tsx";

/**
 * 限定了数据范围（城市或渠道任一维度）的员工一律用不了的操作：财务结算（ADR 0040：一张账单含一家供应商在各城市、各渠道的订单，切不开，
 * 接口一律 403 `DATA_SCOPE_DENIED`）。角色勾了也按「没有」处理——菜单、首页卡片、页面按钮都不出现点进去用不了的入口。
 * 其余操作的数据范围是「列表只列范围内的、范围外按编号 404」，页面照常进得去，不在这里。
 */
export const UNSCOPED_ONLY_ACTIONS: readonly PlatformAction[] = ["statement.read", "statement.manage", "statement.review"];

/** 角色本身给没给这个操作，不看数据范围：内置角色按 @nozomi/domain 的权限表（和后端同一份），自建角色（ADR 0030）按 `auth/me` 给的操作清单。 */
export function platformRoleGrants(account: Pick<CurrentAccount, "role" | "permissions">, action: PlatformAction): boolean {
  return isPlatformRole(account.role) ? platformRoleCan(account.role, action) : account.permissions.includes(action);
}

/**
 * 一个平台员工能不能做某个操作：角色给了，且没有被数据范围挡住（`UNSCOPED_ONLY_ACTIONS`）。
 * 菜单、首页卡片、页面都用这一个判断，条件自然一致。只决定显示什么，真正的检查在后端。
 */
export function platformAccountCan(account: Pick<CurrentAccount, "role" | "permissions" | "dataScope">, action: PlatformAction): boolean {
  if (!platformRoleGrants(account, action)) return false;
  return !(UNSCOPED_ONLY_ACTIONS.includes(action) && scopeIsRestricted(account.dataScope));
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

/** 当前登录的供应商账号能不能做某个操作。账号信息还没取回来时一律当作不能。 */
export function useTenantCan(action: TenantAction): boolean {
  const { portal, account } = usePortalSession();
  if (portal.key !== "tenant" || account.status !== "ready") return false;
  const role = account.account.role;
  return isTenantRole(role) && tenantRoleCan(role, action);
}
