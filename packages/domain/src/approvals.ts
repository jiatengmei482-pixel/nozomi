/**
 * 敏感操作双人复核（M2-04，ADR 0023）的状态规则。纯函数。
 *
 * 需求：《平台运营端与渠道对接》「敏感操作双人复核：修改渠道加价比例、修改租户结算条款、付款给租户、人工退款超过阈值、停用租户或渠道。
 * 发起人和审核人不能是同一人」；「修改加价规则需双人复核」。
 *
 * 流程：发起（pending）→ 另一个人批准（approved，改动在批准的同一个事务里生效）或驳回（rejected）；发起人可以在审核之前撤回（withdrawn）。
 * 批准、驳回、撤回之后都不能再改。
 */

export const APPROVAL_STATUSES = ["pending", "approved", "rejected", "withdrawn"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export type ApprovalDecision = "approve" | "reject" | "withdraw";

export type ApprovalRefusal =
  /** 已经被批准、驳回或撤回 */
  | "APPROVAL_NOT_PENDING"
  /** 发起人不能审核自己发起的（双人复核） */
  | "APPROVAL_SELF_REVIEW"
  /** 只有发起人自己能撤回 */
  | "APPROVAL_NOT_REQUESTER";

/** 这个人现在能不能对这条复核做这个决定；能的话返回 null。权限（有没有审核这一类的操作）由调用方另外判断。 */
export function approvalDecisionRefusal(approval: { status: ApprovalStatus; requestedBy: string }, actorId: string, decision: ApprovalDecision): ApprovalRefusal | null {
  if (approval.status !== "pending") return "APPROVAL_NOT_PENDING";
  if (decision === "withdraw") return approval.requestedBy === actorId ? null : "APPROVAL_NOT_REQUESTER";
  return approval.requestedBy === actorId ? "APPROVAL_SELF_REVIEW" : null;
}

export function approvalStatusAfter(decision: ApprovalDecision): ApprovalStatus {
  return decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "withdrawn";
}
