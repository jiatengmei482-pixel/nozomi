/**
 * 内部对象 → 接口返回的 JSON（字段名 snake_case，时间为带时区的 ISO 8601）。
 * 每个函数都逐个字段列出，不展开整个对象：新加的内部字段不会不知不觉出现在接口里。
 * 「必须先修改密码」的标记有意不在账号对象里：它只在本人的登录应答和 `auth/me` 的顶层给出（ADR 0013）。
 */
import { EMAIL_CODE_RESEND_INTERVAL_MS, EMAIL_CODE_TTL_MS, type LoginMethods } from "@nozomi/domain";
import type { AuditLog } from "../repos/audit-logs.ts";
import type { PassengerEmailChange } from "../repos/passenger-email-changes.ts";
import type { PlatformUser } from "../repos/platform-users.ts";
import type { TenantUser } from "../repos/tenant-users.ts";
import type { Tenant } from "../repos/tenants.ts";
import type { IssuedInvite } from "../services/platform-staff.ts";

export function platformUserJson(user: PlatformUser): Record<string, unknown> {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    role_name: user.roleName,
    status: user.status,
    created_at: user.createdAt.toISOString(),
    updated_at: user.updatedAt.toISOString(),
  };
}

/** 平台账号列表和详情里的员工：多了两步验证是否已绑定、员工自己的 IP 白名单（ADR 0030）。 */
export function staffJson(user: PlatformUser): Record<string, unknown> {
  return {
    ...platformUserJson(user),
    mfa_enabled: user.totpEnabledAt !== null,
    mfa_enabled_at: user.totpEnabledAt?.toISOString() ?? null,
    ip_allowlist: user.ipAllowlist,
  };
}

/**
 * 供应商主体。运营后台和供应商自己看到的是同一份：状态、暂停和观察的原因、入驻各阶段的时间、最近一次每日评分（需求「租户可在自己后台看到各项指标」）。
 * 里面没有对外价、加价比例（规则 4）。
 */
export function tenantJson(tenant: Tenant): Record<string, unknown> {
  const iso = (value: Date | null): string | null => (value === null ? null : value.toISOString());
  return {
    id: tenant.id,
    name: tenant.name,
    status: tenant.status,
    suspended_from: tenant.suspendedFrom,
    suspension_reasons: tenant.suspensionReasons,
    suspended_at: iso(tenant.suspendedAt),
    observation_reasons: tenant.observationReasons,
    observation_since: iso(tenant.observationSince),
    signed_at: iso(tenant.signedAt),
    trial_started_at: iso(tenant.trialStartedAt),
    activated_at: iso(tenant.activatedAt),
    terminated_at: iso(tenant.terminatedAt),
    score: {
      score_centi: tenant.score.scoreCenti,
      raw_score_centi: tenant.score.rawScoreCenti,
      completed_orders: tenant.score.completedOrders,
      no_shows: tenant.score.noShows,
      score_on: tenant.score.scoreOn,
    },
    version: tenant.version,
    created_at: tenant.createdAt.toISOString(),
    updated_at: tenant.updatedAt.toISOString(),
  };
}

export function tenantUserJson(user: TenantUser): Record<string, unknown> {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    created_at: user.createdAt.toISOString(),
    updated_at: user.updatedAt.toISOString(),
  };
}

export function inviteJson(invite: IssuedInvite): Record<string, unknown> {
  return { token: invite.token, expires_at: invite.expiresAt.toISOString() };
}

export function auditLogJson(log: AuditLog): Record<string, unknown> {
  return {
    id: log.id,
    occurred_at: log.occurredAt.toISOString(),
    tenant_id: log.tenantId,
    actor: { type: log.actor.type, id: log.actor.id, email: log.actor.email },
    ip: log.ip,
    source: log.source,
    resource: log.resource,
    resource_id: log.resourceId,
    action: log.action,
    before: log.before,
    after: log.after,
  };
}

/** 租户看到的操作日志：不带 tenant_id（就是自己）。 */
export function tenantAuditLogJson(log: AuditLog): Record<string, unknown> {
  return {
    id: log.id,
    occurred_at: log.occurredAt.toISOString(),
    actor: { type: log.actor.type, id: log.actor.id, email: log.actor.email },
    ip: log.ip,
    source: log.source,
    resource: log.resource,
    resource_id: log.resourceId,
    action: log.action,
    before: log.before,
    after: log.after,
  };
}

export function pageJson<Item>(
  page: { items: Item[]; nextCursor: string | null },
  toJson: (item: Item) => Record<string, unknown>,
): Record<string, unknown> {
  return { items: page.items.map(toJson), next_cursor: page.nextCursor };
}

export function loginMethodsJson(methods: LoginMethods): Record<string, boolean> {
  return { email_code: methods.emailCode, password: methods.password };
}

/** 发码请求的应答：不管账号存不存在都是这一份（ADR 0050）。 */
export function emailCodeSentJson(): Record<string, number> {
  return { expires_in_seconds: EMAIL_CODE_TTL_MS / 1000, resend_after_seconds: EMAIL_CODE_RESEND_INTERVAL_MS / 1000 };
}

/** 运营代改乘客邮箱的复核（ADR 0065）：只有打码后的地址。 */
export function passengerEmailReviewJson(change: PassengerEmailChange): Record<string, unknown> {
  return {
    id: change.id,
    approval_id: change.approvalId,
    status: change.status,
    email_masked: change.emailMasked,
    previous_email_masked: change.previousEmailMasked,
    verification: change.verification,
    requested_by: { id: change.requestedBy.id, name: change.requestedBy.name },
    created_at: change.createdAt.toISOString(),
  };
}
