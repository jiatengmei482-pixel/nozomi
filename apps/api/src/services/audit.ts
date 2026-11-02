/** 审计日志里「前后值」的白名单组装：只挑可以公开的字段，密码哈希、令牌永远不在其中。 */
import type { AuditActor, AuditOrigin, AuditValues } from "../repos/audit-logs.ts";
import type { PlatformUser } from "../repos/platform-users.ts";
import type { TenantUser } from "../repos/tenant-users.ts";

export function accountValues(user: PlatformUser | TenantUser): AuditValues {
  return { email: user.email, name: user.name, role: user.role, status: user.status };
}

export function platformActor(user: PlatformUser): AuditActor {
  return { type: "platform_user", id: user.id, email: user.email };
}

export function tenantActor(user: TenantUser): AuditActor {
  return { type: "tenant_user", id: user.id, email: user.email };
}

export const ANONYMOUS_ACTOR: AuditActor = { type: "anonymous", id: null, email: null };

/** 后台请求的来源信息。 */
export function consoleOrigin(actor: AuditActor, ip: string, now: Date): AuditOrigin {
  return { occurredAt: now, actor, ip, source: "console" };
}

export const SYSTEM_ACTOR: AuditActor = { type: "system", id: null, email: null };

/**
 * 命令行以「系统」身份替某个租户写（价格表导入，ADR 0062）：没有登录的用户，也没有会话。
 * 只能在服务端的命令里构造（接口层的租户编号永远来自令牌，不会产生它）；审计记为 system / cli。
 */
export interface SystemTenantPrincipal {
  tenantId: string;
  user: null;
}

/** 租户侧写操作的审计来源：登录用户在后台操作记 tenant_user / console；命令行以系统身份写记 system / cli。 */
export function tenantWriteOrigin(writer: { principal: { user: TenantUser | null }; ip: string }, now: Date): AuditOrigin {
  const user = writer.principal.user;
  return user === null ? { occurredAt: now, actor: SYSTEM_ACTOR, ip: null, source: "cli" } : consoleOrigin(tenantActor(user), writer.ip, now);
}
