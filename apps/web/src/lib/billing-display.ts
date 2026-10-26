/**
 * 账单和付款批次在页面上的说法（M4-03，ADR 0040）。状态和明细种类的名字取自 @nozomi/domain 的 billing.ts。
 */
import { DEDUCTION_KIND_NAMES, type DeductionKind, type PayoutBatchStatus, STATEMENT_LINE_KIND_NAMES, STATEMENT_STATUS_NAMES, type StatementLineKind, type StatementStatus, statementActionAllowed } from "@nozomi/domain";
import type { StatementEventAction, StatementLine } from "../api/billing.ts";
import type { BadgeSpec } from "../components/StatusBadge.tsx";
import { cancelReasonName, extraTypeName } from "./order-money-display.ts";
import { minorLabel, percentLabel } from "./order-center-display.ts";

export const STATEMENTS_PAGE = "/platform/finance/statements";
export const PAYOUT_BATCHES_PAGE = "/platform/finance/payout-batches";
export const TENANT_STATEMENTS_PAGE = "/statements";

export function statementPath(id: string): string {
  return `${STATEMENTS_PAGE}/${encodeURIComponent(id)}`;
}

export function payoutBatchPath(id: string): string {
  return `${PAYOUT_BATCHES_PAGE}/${encodeURIComponent(id)}`;
}

export function tenantStatementPath(id: string): string {
  return `${TENANT_STATEMENTS_PAGE}/${encodeURIComponent(id)}`;
}

/** 账单状态：等别人做事的（待确认、待付款）信息色；要平台处理的（有异议、待复核）警告色；有结论的成功 / 中性。 */
export const STATEMENT_STATUS_BADGES: Readonly<Record<StatementStatus, BadgeSpec>> = {
  issued: { tone: "info", label: STATEMENT_STATUS_NAMES.issued },
  disputed: { tone: "warning", label: STATEMENT_STATUS_NAMES.disputed },
  confirmed: { tone: "warning", label: STATEMENT_STATUS_NAMES.confirmed },
  in_payout: { tone: "info", label: STATEMENT_STATUS_NAMES.in_payout },
  paid: { tone: "success", label: STATEMENT_STATUS_NAMES.paid },
  settled: { tone: "success", label: STATEMENT_STATUS_NAMES.settled },
  carried: { tone: "neutral", label: STATEMENT_STATUS_NAMES.carried },
  void: { tone: "neutral", label: STATEMENT_STATUS_NAMES.void },
};

export const BATCH_STATUS_BADGES: Readonly<Record<PayoutBatchStatus, BadgeSpec>> = {
  open: { tone: "info", label: "收账单中" },
  closed: { tone: "warning", label: "已锁定，待转账" },
  paid: { tone: "success", label: "已付款" },
};

export function lineKindName(kind: StatementLineKind): string {
  return STATEMENT_LINE_KIND_NAMES[kind];
}

/** 账单经过的每一步。供应商看到的「已提交复核」「复核通过」没有说明。 */
export const EVENT_NAMES: Readonly<Record<StatementEventAction, string>> = {
  issue: "出账",
  confirm: "供应商确认",
  auto_confirm: "确认期满，视为确认",
  dispute: "供应商提出异议",
  reply: "平台答复异议",
  void: "作废",
  request_review: "已提交付款复核",
  approve: "付款复核通过",
  pay: "已付款",
};

export const ACTOR_NAMES: Readonly<Record<"tenant_user" | "platform_user" | "system", string>> = { tenant_user: "供应商", platform_user: "平台", system: "系统" };

/** 一行明细是怎么来的（只有结算价一侧的数）。 */
export function lineDetailText(line: Pick<StatementLine, "kind" | "detail" | "amount">): string {
  const d = line.detail;
  const currency = line.amount.currency;
  switch (line.kind) {
    case "order":
    case "no_show":
      return typeof d["settlement_minor"] === "number" ? `结算价 ${minorLabel(d["settlement_minor"], currency)}` : "";
    case "cancellation":
      return `结算价 ${minorLabel(d["settlement_minor"], currency)} × 扣款 ${typeof d["cancel_fee_bp"] === "number" ? percentLabel(d["cancel_fee_bp"]) : "—"}${typeof d["cancel_reason"] === "string" ? `（${cancelReasonName(d["cancel_reason"])}）` : ""}`;
    case "extra_charge":
      return `${typeof d["type"] === "string" ? extraTypeName(d["type"] as Parameters<typeof extraTypeName>[0]) : "事后加收"}${typeof d["submitted_minor"] === "number" ? `，报的 ${minorLabel(d["submitted_minor"], currency)}` : ""}`;
    case "deduction":
      return typeof d["deduction_kind"] === "string" ? (DEDUCTION_KIND_NAMES[d["deduction_kind"] as DeductionKind] ?? d["deduction_kind"]) : "";
    case "deduction_waiver":
      return `${typeof d["deduction_kind"] === "string" ? (DEDUCTION_KIND_NAMES[d["deduction_kind"] as DeductionKind] ?? d["deduction_kind"]) : "扣款"}免除${typeof d["waive_reason"] === "string" ? `：${d["waive_reason"]}` : ""}`;
    case "carry_forward":
      return typeof d["statement_no"] === "string" ? `上期账单 ${d["statement_no"]}（${typeof d["period"] === "string" ? d["period"] : "—"}）` : "";
  }
}

/** 「2026-09」→「2026 年 9 月」 */
export function periodText(period: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  return match ? `${match[1]} 年 ${Number(match[2])} 月` : period;
}

/** 平台这边对一张账单现在能做什么（和后端同一份规则）。 */
export function statementActions(status: StatementStatus): { reply: boolean; void: boolean; requestReview: boolean } {
  return { reply: statementActionAllowed(status, "reply"), void: statementActionAllowed(status, "void"), requestReview: statementActionAllowed(status, "request_review") };
}

/** 供应商这边能不能确认、提异议。 */
export function tenantStatementActions(status: StatementStatus): { confirm: boolean; dispute: boolean } {
  return { confirm: statementActionAllowed(status, "confirm"), dispute: statementActionAllowed(status, "dispute") };
}
