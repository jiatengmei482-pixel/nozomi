/**
 * 运营后台：核实后重发官网订单链接（M4-30，ADR 0061）。字段和 `apps/api/openapi.yaml` 的 `ViewLinkRequest` 一致（契约测试核对）。
 */
import type { ViewLinkResendRefusal, ViewLinkTarget, ViewLinkVerification } from "@nozomi/domain";
import { apiRequest } from "./client.ts";
import { PLATFORM_ORDERS_PATH } from "./order-money.ts";

export interface ViewLinkRequest {
  id: string;
  target: ViewLinkTarget;
  email_masked: string;
  verification: ViewLinkVerification;
  /** queued：已排进通知中心；pending_review：等另一位同事审核；dismissed：驳回或撤回 */
  status: "queued" | "pending_review" | "dismissed";
  approval_id: string | null;
  requested_by: { id: string; name: string };
  created_at: string;
  decided_at: string | null;
}

export interface ViewLinkStatus {
  available: boolean;
  unavailable_reason: Exclude<ViewLinkResendRefusal, "SAME_AS_ORDER_EMAIL"> | null;
  email_masked: string | null;
  pending_review: ViewLinkRequest | null;
  requests: ViewLinkRequest[];
}

export interface ViewLinkResendBody {
  target: ViewLinkTarget;
  email?: string;
  verification: ViewLinkVerification;
  reason: string;
}

/** 契约测试用 */
export const VIEW_LINK_REQUEST_FIELDS: readonly (keyof ViewLinkRequest)[] = ["id", "target", "email_masked", "verification", "status", "approval_id", "requested_by", "created_at", "decided_at"];

const viewLinkPath = (orderId: string): string => `${PLATFORM_ORDERS_PATH}/${encodeURIComponent(orderId)}/view-link`;

export function getViewLinkStatus(token: string, orderId: string): Promise<ViewLinkStatus> {
  return apiRequest("GET", viewLinkPath(orderId), { token });
}

export function resendViewLink(token: string, orderId: string, body: ViewLinkResendBody): Promise<{ request: ViewLinkRequest; approval: { id: string; status: string } | null }> {
  return apiRequest("POST", `${viewLinkPath(orderId)}/resend`, { token, body });
}
