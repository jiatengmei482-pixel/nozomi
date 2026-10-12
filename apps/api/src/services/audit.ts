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
