/**
 * 运营后台：核实后重发官网订单链接（M4-30，ADR 0061）。
 * - `GET /platform/v1/orders/{id}/view-link`（`order.read`）：能不能发、下单邮箱（打码）、在等审核的那一条、最近的重发记录；
 * - `POST /platform/v1/orders/{id}/view-link/resend`（`order.view_link_resend`）：`target` 是 `original`（发到下单邮箱，直接排进通知中心）
 *   或 `new_email`（发到核实后的新邮箱，发起复核，`order.view_link_review` 的另一位同事批准时才发）。核实方式、原因必填。
 * 应答里只有打码后的地址。数据范围外的单当作不存在。
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { VIEW_LINK_TARGETS, VIEW_LINK_VERIFICATIONS } from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import type { ViewLinkRequest } from "../repos/view-link-requests.ts";
import { assertPlatformOrderInScope } from "../services/order-queries.ts";
import { authenticatePlatform, platformCredentials } from "../services/platform-auth.ts";
import { resendViewLink, viewLinkStatus } from "../services/view-link-resend.ts";
import { emailSchema, parseInput, resourceId, validationFailed, visibleText } from "../validation.ts";

const resendSchema = z
  .object({
    target: z.enum(VIEW_LINK_TARGETS),
    email: emailSchema.optional(),
    verification: z.enum(VIEW_LINK_VERIFICATIONS),
    reason: visibleText(500),
  })
  .strict();

function requestJson(request: ViewLinkRequest): Record<string, unknown> {
  return {
    id: request.id,
    target: request.target,
    email_masked: request.recipientMasked,
    verification: request.verification,
    status: request.status,
    approval_id: request.approvalId,
    requested_by: { id: request.requestedBy.id, name: request.requestedBy.name },
    created_at: request.createdAt.toISOString(),
    decided_at: request.decidedAt?.toISOString() ?? null,
  };
}

export function registerViewLinkRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/platform/v1/orders/:id/view-link", async (request) => {
    const principal = await authenticatePlatform(ctx, platformCredentials(request), { action: "order.read" });
    const orderId = resourceId(request.params, "订单");
    await assertPlatformOrderInScope(ctx, principal.grant.scope, orderId);
    const status = await viewLinkStatus(ctx, orderId);
    return {
      available: status.available,
      unavailable_reason: status.unavailableReason,
      email_masked: status.emailMasked,
      pending_review: status.pendingReview === null ? null : { ...requestJson(status.pendingReview), approval_id: status.pendingReview.approvalId },
      requests: status.requests.map(requestJson),
    };
  });

  app.post("/platform/v1/orders/:id/view-link/resend", async (request, reply) => {
    const principal = await authenticatePlatform(ctx, platformCredentials(request), { action: "order.view_link_resend" });
    const orderId = resourceId(request.params, "订单");
    const input = parseInput(resendSchema, request.body, "body");
    if (input.target === "new_email" && input.email === undefined) throw validationFailed("body", [{ path: "/email", reason: "REQUIRED", message: "请填写核实后的新邮箱" }]);
    if (input.target === "original" && input.email !== undefined) throw validationFailed("body", [{ path: "/email", reason: "NOT_APPLICABLE", message: "发到下单邮箱不用填新邮箱（请删掉）" }]);
    await assertPlatformOrderInScope(ctx, principal.grant.scope, orderId);
    const result = await resendViewLink(ctx, principal, orderId, { target: input.target, email: input.email ?? null, verification: input.verification, reason: input.reason }, request.ip);
    return reply.code(202).send({ request: requestJson(result.request), approval: result.approval === null ? null : { id: result.approval.id, status: result.approval.status } });
  });
}
