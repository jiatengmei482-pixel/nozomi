/**
 * 客人赔付表（M4-02，ADR 0034；需求「第五轮新增接口」`GET /platform/v1/compensation-table`：赔付表和取消政策，可配置）。
 *
 * - 看：平台每个角色（`master_data.read`，和取消政策一样）；
 * - 改：`compensation_table.manage` 发起，提交整张表；另一位有 `compensation_table.review` 的同事批准后存成新的一版；
 *   发起时记下当时的版本，批准时版本变了 → `APPROVAL_STALE`。
 * - 判定时用那一刻的版本算，赔付记录里记下版本号；之后改表不影响已经判定的工单。
 */
import { COMPENSATION_SCENARIO_NAMES, COMPENSATION_SCENARIOS, type CompensationTable, type CompensationTableIssue, compensationTableIssues, sameCompensationTable } from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { withPlatformTx } from "../db/context.ts";
import type { Approval } from "../repos/approvals.ts";
import { type AuditValue, insertAuditLog } from "../repos/audit-logs.ts";
import { type CompensationRulesJson, type StoredCompensationTable, currentCompensationTable, insertCompensationTable, lockCompensationTable, rulesFromJson, rulesJson } from "../repos/compensation-tables.ts";
import { type InputIssue, validationFailed } from "../validation.ts";
import { type ApprovalKind, approvalStale, requestApproval } from "./approvals.ts";
import { consoleOrigin, platformActor } from "./audit.ts";
import type { PlatformPrincipal } from "./platform-auth.ts";

const ISSUE_MESSAGES: Readonly<Record<CompensationTableIssue["reason"], string>> = {
  OUT_OF_RANGE: "超出了允许的范围",
  FIXED: "司机未到是全额退款，比例固定 100%，不能改",
};

function tableIssues(issues: readonly CompensationTableIssue[]): InputIssue[] {
  return issues.map((issue) => ({ path: issue.path, reason: issue.reason, message: ISSUE_MESSAGES[issue.reason] }));
}

export async function getCompensationTable(ctx: AppContext): Promise<StoredCompensationTable> {
  return withPlatformTx(ctx.pool, currentCompensationTable, { snapshot: true });
}

function summaryOf(before: CompensationTable, after: Omit<CompensationTable, "version">): string {
  const parts = COMPENSATION_SCENARIOS.filter((scenario) => before.customerBp[scenario] !== after.customerBp[scenario]).map(
    (scenario) => `${COMPENSATION_SCENARIO_NAMES[scenario]} ${before.customerBp[scenario] / 100}% → ${after.customerBp[scenario] / 100}%`,
  );
  if (before.minimumJpy !== after.minimumJpy) parts.push(`每笔最低 ¥${before.minimumJpy} → ¥${after.minimumJpy}`);
  if (before.reimbursementCapBp !== after.reimbursementCapBp) parts.push(`报销上限 ${before.reimbursementCapBp / 10_000} 倍 → ${after.reimbursementCapBp / 10_000} 倍`);
  if (before.reviewAtOrAboveSellBp !== after.reviewAtOrAboveSellBp) parts.push(`复核阈值 ${before.reviewAtOrAboveSellBp / 100}% → ${after.reviewAtOrAboveSellBp / 100}%`);
  return `修改客人赔付表：${parts.join("；")}`;
}

export const COMPENSATION_TABLE_UPDATE: ApprovalKind = {
  kind: "compensation_table.update",
  resource: "compensation_table",
  readAction: "master_data.read",
  requestAction: "compensation_table.manage",
  reviewAction: "compensation_table.review",
  async apply(db, approval: Approval, origin) {
    await lockCompensationTable(db);
    const current = await currentCompensationTable(db);
    if (current.version !== approval.baseVersion) throw approvalStale(current.version);
    const rules = approval.payload["rules"] as unknown as CompensationRulesJson;
    const table = rulesFromJson(current.version + 1, rules);
    const issues = compensationTableIssues(table);
    if (issues.length > 0) throw validationFailed("body", tableIssues(issues));
    await insertCompensationTable(db, { version: table.version, rules, approvalId: approval.id, requestedBy: approval.requestedBy.id, approvedBy: origin.actor.id as string, now: origin.occurredAt });
    await insertAuditLog(db, origin, {
      tenantId: null,
      resource: "compensation_table",
      resourceId: String(table.version),
      action: "update",
      before: { version: current.version, rules: rulesJson(current) as unknown as AuditValue },
      after: { version: table.version, rules: rules as unknown as AuditValue, approval_id: approval.id, requested_by: approval.requestedBy.email },
    });
  },
};

/** 发起修改（提交整张表）。和现在一样、或者不合规则的直接拦，不进复核队列。 */
export async function requestCompensationTableChange(ctx: AppContext, principal: PlatformPrincipal, table: Omit<CompensationTable, "version">, note: string | null, ip: string): Promise<Approval> {
  const origin = consoleOrigin(platformActor(principal.user), ip, ctx.now());
  const issues = compensationTableIssues(table);
  if (issues.length > 0) throw validationFailed("body", tableIssues(issues));
  return withPlatformTx(ctx.pool, async (db) => {
    const current = await currentCompensationTable(db);
    if (sameCompensationTable(current, table)) throw validationFailed("body", [{ path: "/", reason: "UNCHANGED", message: "和现在的赔付表一样，不用发起" }]);
    return requestApproval(db, origin, principal, {
      kind: COMPENSATION_TABLE_UPDATE,
      resourceId: "platform",
      summary: summaryOf(current, table),
      payload: { rules: rulesJson(table) as unknown as AuditValue, base_version: current.version },
      before: { version: current.version, rules: rulesJson(current) as unknown as AuditValue },
      baseVersion: current.version,
      note,
    });
  });
}
