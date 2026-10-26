/**
 * 平台统一取消政策（M3-03，ADR 0029）：按品类 × 车型级别的阶梯，运营后台可以改，改动走双人复核（它决定客人退多少、供应商拿多少，和加价规则同一类）。
 *
 * - 看：平台每个角色、供应商每个角色都能看（`master_data.read`；供应商后台商品「服务规则」里的取消规则只读展示它）；
 * - 改：`cancellation_policy.manage` 发起，提交的是整份政策（15 条阶梯）；另一位有 `cancellation_policy.review` 的同事批准后存成新的一版；
 *   发起时记下当时的版本，批准时版本变了（中间别的修改先批了）→ `APPROVAL_STALE`；
 * - 只对之后下的单生效：每张单下单时把适用的阶梯抄进订单（`orders.cancel_policy`），之后政策怎么改都不影响已经下了的单（客人下单时看到的是那一版）。
 */
import { type CancellationPolicyIssue, type CancellationRule, VEHICLE_LEVEL_NAMES, cancellationPolicyIssues, sameCancellationPolicy } from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { withPlatformTx, withTenantTx } from "../db/context.ts";
import type { Approval } from "../repos/approvals.ts";
import { type AuditValue, insertAuditLog } from "../repos/audit-logs.ts";
import { type StoredCancellationPolicy, currentCancellationPolicy, insertCancellationPolicy, lockCancellationPolicy } from "../repos/cancellation-policies.ts";
import { type InputIssue, validationFailed } from "../validation.ts";
import { type ApprovalKind, approvalStale, requestApproval } from "./approvals.ts";
import { consoleOrigin, platformActor } from "./audit.ts";
import type { PlatformPrincipal } from "./platform-auth.ts";

const ISSUE_MESSAGES: Readonly<Record<CancellationPolicyIssue["reason"], string>> = {
  MISSING_RULE: "每个「品类 × 车型级别」都要有一条阶梯",
  DUPLICATE_RULE: "同一个「品类 × 车型级别」写了两条",
  UNKNOWN_RULE: "没有这个品类或车型级别",
  TIER_COUNT: "每条阶梯 1 到 5 档",
  HOURS_INVALID: "「距用车多少小时」要是 0 到 720 的整数",
  HOURS_NOT_DESCENDING: "各档的小时数要从大到小",
  LAST_TIER_NOT_ZERO: "最后一档要是 0 小时（到用车时间为止）",
  FEE_INVALID: "扣款比例要在 0% 到 100% 之间（基点 0–10000 的整数）",
  FEE_DECREASING: "越接近用车扣得越多：这一档不能比前一档扣得少",
};

function policyIssues(issues: readonly CancellationPolicyIssue[]): InputIssue[] {
  return issues.map((issue) => ({ path: issue.path, reason: issue.reason, message: ISSUE_MESSAGES[issue.reason] }));
}

export function policyAuditValue(rules: readonly CancellationRule[]): AuditValue {
  return rules.map((rule) => ({ category: rule.category, level: rule.level, tiers: rule.tiers.map((tier) => ({ min_hours_before: tier.minHoursBefore, fee_bp: tier.feeBp })) }));
}

/** 复核记录里存的（接口的写法）→ 领域的写法。 */
function rulesFromPayload(value: unknown): CancellationRule[] {
  return (value as { category: CancellationRule["category"]; level: CancellationRule["level"]; tiers: { min_hours_before: number; fee_bp: number }[] }[]).map((rule) => ({
    category: rule.category,
    level: rule.level,
    tiers: rule.tiers.map((tier) => ({ minHoursBefore: tier.min_hours_before, feeBp: tier.fee_bp })),
  }));
}

export async function getCancellationPolicy(ctx: AppContext, scope: "platform" | { tenantId: string }): Promise<StoredCancellationPolicy> {
  if (scope === "platform") return withPlatformTx(ctx.pool, currentCancellationPolicy, { snapshot: true });
  return withTenantTx(ctx.pool, scope.tenantId, currentCancellationPolicy, { snapshot: true });
}

/** 一句话说明：改了哪几条（给复核队列看）。 */
function summaryOf(before: readonly CancellationRule[], after: readonly CancellationRule[]): string {
  const changed = after.filter((rule) => {
    const old = before.find((entry) => entry.category === rule.category && entry.level === rule.level);
    return old === undefined || !sameCancellationPolicy([old], [rule]);
  });
  const names: Record<string, string> = { airport_transfer: "接送机", point_to_point: "点对点", charter: "包车" };
  const text = changed.map((rule) => `${names[rule.category]} · ${VEHICLE_LEVEL_NAMES[rule.level]}`).join("、");
  return `修改平台取消政策：${text}（共 ${changed.length} 条阶梯）`;
}

export const CANCELLATION_POLICY_UPDATE: ApprovalKind = {
  kind: "cancellation_policy.update",
  resource: "cancellation_policy",
  readAction: "master_data.read",
  requestAction: "cancellation_policy.manage",
  reviewAction: "cancellation_policy.review",
  async apply(db, approval: Approval, origin) {
    await lockCancellationPolicy(db);
    const current = await currentCancellationPolicy(db);
    if (current.version !== approval.baseVersion) throw approvalStale(current.version);
    const rules = rulesFromPayload(approval.payload["rules"]);
    const issues = cancellationPolicyIssues(rules);
    if (issues.length > 0) throw validationFailed("body", policyIssues(issues));
    const version = current.version + 1;
    await insertCancellationPolicy(db, { version, rules, approvalId: approval.id, requestedBy: approval.requestedBy.id, approvedBy: origin.actor.id as string, now: origin.occurredAt });
    await insertAuditLog(db, origin, {
      tenantId: null,
      resource: "cancellation_policy",
      resourceId: String(version),
      action: "update",
      before: { version: current.version, rules: policyAuditValue(current.rules) },
      after: { version, rules: policyAuditValue(rules), approval_id: approval.id, requested_by: approval.requestedBy.email },
    });
  },
};

export const CANCELLATION_POLICY_APPROVAL_KINDS: readonly ApprovalKind[] = [CANCELLATION_POLICY_UPDATE];

/** 发起修改（提交整份政策）。和现在一样、或者不合规则的直接拦，不进复核队列。 */
export async function requestCancellationPolicyChange(ctx: AppContext, principal: PlatformPrincipal, rules: CancellationRule[], note: string | null, ip: string): Promise<Approval> {
  const now = ctx.now();
  const origin = consoleOrigin(platformActor(principal.user), ip, now);
  const issues = cancellationPolicyIssues(rules);
  if (issues.length > 0) throw validationFailed("body", policyIssues(issues));
  return withPlatformTx(ctx.pool, async (db) => {
    const current = await currentCancellationPolicy(db);
    if (sameCancellationPolicy(current.rules, rules)) throw validationFailed("body", [{ path: "/rules", reason: "UNCHANGED", message: "和现在的政策一样，不用发起" }]);
    return requestApproval(db, origin, principal, {
      kind: CANCELLATION_POLICY_UPDATE,
      resourceId: "platform",
      summary: summaryOf(current.rules, rules),
      payload: { rules: policyAuditValue(rules) as AuditValue, base_version: current.version },
      before: { version: current.version, rules: policyAuditValue(current.rules) },
      baseVersion: current.version,
      note,
    });
  });
}
