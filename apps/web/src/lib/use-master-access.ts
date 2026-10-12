import { type PlatformAction, type TenantAction, isPlatformRole, isTenantRole, platformRoleCan, tenantRoleCan } from "@nozomi/domain";
import { usePortalSession } from "../auth/PortalSession.tsx";

/** 当前登录的平台员工能不能做某个操作。账号信息还没取回来时一律当作不能（按钮晚一点出现，好过先出现再消失）。 */
export function usePlatformCan(action: PlatformAction): boolean {
  const { portal, account } = usePortalSession();
  if (portal.key !== "platform" || account.status !== "ready") return false;
  const role = account.account.role;
  return isPlatformRole(role) && platformRoleCan(role, action);
}

/** 当前登录的供应商账号能不能做某个操作。账号信息还没取回来时一律当作不能。 */
export function useTenantCan(action: TenantAction): boolean {
  const { portal, account } = usePortalSession();
  if (portal.key !== "tenant" || account.status !== "ready") return false;
  const role = account.account.role;
  return isTenantRole(role) && tenantRoleCan(role, action);
}
