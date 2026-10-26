import { type PlatformAction, type TenantAction, isPlatformRole, isTenantRole, platformRoleCan, tenantRoleCan } from "@nozomi/domain";
import { type CurrentAccount, usePortalSession } from "../auth/PortalSession.tsx";

/**
 * 一个平台员工能不能做某个操作：内置角色按 @nozomi/domain 的权限表（和后端同一份）；
 * 自建角色（ADR 0030）按 `auth/me` 给的操作清单。只决定显示什么，真正的检查在后端。
 */
export function platformAccountCan(account: Pick<CurrentAccount, "role" | "permissions">, action: PlatformAction): boolean {
  return isPlatformRole(account.role) ? platformRoleCan(account.role, action) : account.permissions.includes(action);
}

/** 当前登录的平台员工能不能做某个操作。账号信息还没取回来时一律当作不能（按钮晚一点出现，好过先出现再消失）。 */
export function usePlatformCan(action: PlatformAction): boolean {
  const { portal, account } = usePortalSession();
  if (portal.key !== "platform" || account.status !== "ready") return false;
  return platformAccountCan(account.account, action);
}

/** 当前登录的供应商账号能不能做某个操作。账号信息还没取回来时一律当作不能。 */
export function useTenantCan(action: TenantAction): boolean {
  const { portal, account } = usePortalSession();
  if (portal.key !== "tenant" || account.status !== "ready") return false;
  const role = account.account.role;
  return isTenantRole(role) && tenantRoleCan(role, action);
}
