/**
 * 现在登记了的全部双人复核类别（ADR 0023）。以后新增一类（结算条款、退款……）就加到这里。
 */
import { type ApprovalKinds, approvalKinds } from "./approvals.ts";
import { CHANNEL_APPROVAL_KINDS } from "./channels.ts";
import { FX_APPROVAL_KINDS } from "./fx-locks.ts";
import { CANCELLATION_POLICY_APPROVAL_KINDS } from "./cancellation-policy.ts";
import { CANCELLATION_APPROVAL_KINDS } from "./cancellations.ts";
import { TENANT_APPROVAL_KINDS } from "./tenant-onboarding.ts";

export const APPROVAL_KINDS: ApprovalKinds = approvalKinds([...CHANNEL_APPROVAL_KINDS, ...FX_APPROVAL_KINDS, ...TENANT_APPROVAL_KINDS, ...CANCELLATION_POLICY_APPROVAL_KINDS, ...CANCELLATION_APPROVAL_KINDS]);
