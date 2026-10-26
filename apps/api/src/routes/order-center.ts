/**
 * 订单中心的异常队列、工单、赔付表（M4-02，ADR 0034）。这里只做鉴权、校验、调用、返回；规则在 @nozomi/domain 的 exceptions.ts、tickets.ts、compensation.ts，
 * 流程在 services/exceptions.ts、tickets.ts、compensation-table.ts。
 *
 * 运营后台（`/platform/v1`）：
 * - `GET /exceptions`、`GET /exceptions/{id}`（`order.read`）；`POST /exceptions/{id}/claim`、`…/close`（`exception.manage`）；
 * - `GET /tickets`、`GET /tickets/{id}`（`ticket.read`）；`POST /tickets`、`…/{id}/assign`、`…/messages`、`…/request-reply`、`…/compensation-quote`、`…/decide`、`…/close`（`ticket.manage`）；
 *   `POST /tickets/{id}/payout`（`payment.manage`）；
 * - `GET /compensation-table`（赔付表和取消政策，`master_data.read`）；`POST /compensation-table/changes`（`compensation_table.manage`，双人复核）。
 * 供应商（`/tenant/v1`，租户编号只来自令牌）：`GET /tickets`、`GET /tickets/{id}`（`ticket.read`）；`POST /tickets`、`POST /tickets/{id}/messages`（`ticket.manage`）。
 *   应答里没有内部备注、客人那边的赔付金额、对外价、加价比例（规则 4）。
 * 渠道（`/sales/v1`）：`GET /orders/{id}/tickets`、`POST /orders/{id}/tickets`；官网的客人（`/site/v1`）：`GET /order/tickets`、`POST /order/tickets`。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  COMPENSATION_SCENARIOS,
  COMPENSATION_SCENARIO_NAMES,
  COMPENSATION_SCENARIO_RULES,
  type CompensationAmounts,
  type CurrencyCode,
  EXCEPTION_HANDLING,
  EXCEPTION_STATUSES,
  EXCEPTION_TYPES,
  EXCEPTION_TYPE_NAMES,
  LIABLE_PARTIES,
  TICKET_PRIORITIES,
  TICKET_RULES,
  TICKET_STATUSES,
  TICKET_TYPES,
  appealDeadline,
  decisionAgainstTenant,
  exceptionOverdue,
} from "@nozomi/domain";
import { bearerToken } from "../auth/token.ts";
import type { AppContext } from "../context.ts";
import { decodeTimeCursor } from "../pagination.ts";
import type { ExceptionRow } from "../repos/exceptions.ts";
import type { Deduction } from "../repos/rescues.ts";
import type { Ticket, TicketCompensation, TicketMessage, TicketNote, TicketRow } from "../repos/tickets.ts";
import { getCancellationPolicy } from "../services/cancellation-policy.ts";
import { getCompensationTable, requestCompensationTableChange } from "../services/compensation-table.ts";
import { assertExceptionInScope, claimException, closeException, getException, listExceptionsForPlatform } from "../services/exceptions.ts";
import { assertPlatformOrderInScope } from "../services/order-queries.ts";
import { authenticatePlatform, platformCredentials } from "../services/platform-auth.ts";
import { authenticateSales } from "../services/sales-auth.ts";
import { salesMoney } from "../services/sales-quotes.ts";
import { resolveSiteLink, takeSiteSlot } from "../services/site.ts";
import { authenticateTenant } from "../services/tenant-auth.ts";
import {
  type CompensationRequest,
  addPlatformMessage,
  assertTicketInScope,
  assignTicket,
  closeTicket,
  createTicketForChannel,
  createTicketForPlatform,
  createTicketForTenant,
  decideTicket,
  getTicketForPlatform,
  getTicketForTenant,
  listTicketsForChannel,
  listTicketsForPlatform,
  listTicketsForTenant,
  markCompensationPaid,
  previewCompensation,
  replyAsTenant,
  requestTenantReply,
} from "../services/tickets.ts";
import { pageQuerySchema, parseInput, resourceId, uuidSchema } from "../validation.ts";
import { approvalJson } from "./channels.ts";
import { cancellationPolicyJson } from "./order-actions.ts";

type Json = Record<string, unknown>;

const iso = (date: Date | null): string | null => date?.toISOString() ?? null;
const id = uuidSchema.transform((value) => value.toLowerCase());
const text = (max: number) => z.string().trim().min(1).max(max);

// ---- 异常队列 ----

const exceptionListSchema = pageQuerySchema.extend({
  status: z.enum(["active", ...EXCEPTION_STATUSES]).default("active"),
  type: z.enum(EXCEPTION_TYPES).optional(),
  // `me` = 认领给自己的
  assignee: z.union([z.literal("me"), id]).optional(),
  order_id: id.optional(),
  tenant_id: id.optional(),
  overdue: z.enum(["true", "false"]).optional(),
});
const claimSchema = z.object({ assignee_id: id.nullable().default(null) }).strict();
const closeExceptionSchema = z.object({ resolution: text(1000) }).strict();

function exceptionJson(row: ExceptionRow, now: Date): Json {
  return {
    id: row.id,
    type: row.type,
    type_name: EXCEPTION_TYPE_NAMES[row.type],
    handling: EXCEPTION_HANDLING[row.type],
    order: { id: row.orderId, order_no: row.orderNo, service_time: row.serviceAt.toISOString() },
    tenant: { id: row.tenantId, name: row.tenantName },
    detail: row.detail,
    status: row.status,
    opened_at: row.openedAt.toISOString(),
    due_at: row.dueAt.toISOString(),
    overdue: row.status !== "closed" && exceptionOverdue(row.dueAt, now),
    assignee: row.assigneeId === null ? null : { id: row.assigneeId, name: row.assigneeName },
    claimed_at: iso(row.claimedAt),
    close_kind: row.closeKind,
    closed_at: iso(row.closedAt),
    closed_by: row.closedBy,
    resolution: row.resolution,
    version: row.version,
  };
}

// ---- 工单 ----

const ticketListSchema = pageQuerySchema.extend({
  status: z.enum(["active", ...TICKET_STATUSES]).optional(),
  type: z.enum(TICKET_TYPES).optional(),
  tenant_id: id.optional(),
  order_id: id.optional(),
  assignee: z.union([z.literal("me"), id]).optional(),
  overdue: z.enum(["true", "false"]).optional(),
  q: z.string().trim().min(1).max(64).optional(),
});
const tenantTicketListSchema = pageQuerySchema.extend({ status: z.enum(["active", ...TICKET_STATUSES]).optional(), order_id: id.optional() }).strict();

const ticketBody = {
  subject: text(TICKET_RULES.subjectMax),
  description: text(TICKET_RULES.bodyMax),
  language: z.string().trim().min(2).max(10).nullable().default(null),
};

const platformCreateSchema = z
  .object({
    type: z.enum(["complaint", "fulfilment_failure", "order_change", "lost_and_found", "other"]),
    order_id: id,
    // 救援改派过的单：投诉的是原来的供应商时指定它；不给就是这一单现在的供应商
    tenant_id: id.nullable().default(null),
    // 谁提出的（客服代登记时照实选）
    source: z.enum(["guest", "channel", "tenant", "platform"]).default("platform"),
    priority: z.enum(TICKET_PRIORITIES).nullable().default(null),
    ...ticketBody,
  })
  .strict();
const tenantCreateSchema = z
  .object({
    type: z.enum(["tenant_appeal", "lost_and_found", "other"]),
    order_id: id.nullable().default(null),
    parent_ticket_id: id.nullable().default(null),
    subject: ticketBody.subject,
    description: ticketBody.description,
  })
  .strict();
const externalCreateSchema = z.object({ type: z.enum(["complaint", "order_change", "lost_and_found", "other"]), ...ticketBody }).strict();
const salesCreateSchema = externalCreateSchema.extend({ raised_by: z.enum(["guest", "channel"]).default("guest") }).strict();

const assignSchema = z.object({ assignee_id: id.nullable().default(null) }).strict();
// `to_guest`：给客人的回复（官网订单页、渠道看得到，供应商看不到），和 `internal` 不能同时为真
const platformMessageSchema = z
  .object({ body: text(TICKET_RULES.bodyMax), internal: z.boolean().default(false), to_guest: z.boolean().default(false) })
  .strict()
  .refine((value) => !(value.internal && value.to_guest), { message: "内部备注和给客人的回复只能选一个", path: ["to_guest"] });
const requestReplySchema = z.object({ body: text(TICKET_RULES.bodyMax) }).strict();
const tenantMessageSchema = z.object({ body: text(TICKET_RULES.bodyMax), file_ids: z.array(id).max(TICKET_RULES.maxFilesPerMessage).default([]) }).strict();
const minorSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const compensationSchema = z
  .object({
    scenario: z.enum(COMPENSATION_SCENARIOS),
    liable_party: z.enum(LIABLE_PARTIES),
    // 车型降级：两个车型组的结算价之差（被投诉供应商结算币种的最小单位）
    downgrade_settlement_difference: minorSchema.nullable().default(null),
    // 司机未到：客人凭票申请报销的替代交通（客人支付币种的最小单位）
    reimbursement_amount: minorSchema.nullable().default(null),
    major: z.boolean().default(false),
  })
  .strict();
const decideSchema = z
  .object({
    outcome: z.enum(["upheld", "rejected", "approved", "resolved"]),
    note: text(TICKET_RULES.noteMax),
    compensation: compensationSchema.nullable().default(null),
    driver_absent: z.boolean().default(false),
  })
  .strict();
const closeTicketSchema = z.object({ note: text(TICKET_RULES.noteMax) }).strict();
const payoutSchema = z.object({ reference: text(200) }).strict();

function toCompensationRequest(input: z.output<typeof compensationSchema>): CompensationRequest {
  return { scenario: input.scenario, liableParty: input.liable_party, downgradeSettlementDifferenceMinor: input.downgrade_settlement_difference, reimbursementClaimedMinor: input.reimbursement_amount, major: input.major };
}

/** 判定后还能申诉到什么时候（对租户不利的判定才有）。 */
function appealUntil(ticket: Ticket): string | null {
  return ticket.decidedAt !== null && decisionAgainstTenant(ticket) ? appealDeadline(ticket.decidedAt).toISOString() : null;
}

function platformTicketJson(ticket: TicketRow, now: Date): Json {
  const active = ticket.status !== "decided" && ticket.status !== "closed";
  return {
    id: ticket.id,
    ticket_no: ticket.ticketNo,
    type: ticket.type,
    source: ticket.source,
    created_by_type: ticket.createdByType,
    created_by: ticket.createdBy,
    order: { id: ticket.orderId, order_no: ticket.orderNo },
    tenant: { id: ticket.tenantId, name: ticket.tenantName },
    parent_ticket_id: ticket.parentTicketId,
    priority: ticket.priority,
    subject: ticket.subject,
    description: ticket.description,
    language: ticket.language,
    status: ticket.status,
    assignee_id: ticket.assigneeId,
    assigned_at: iso(ticket.assignedAt),
    first_response_due_at: ticket.firstResponseDueAt.toISOString(),
    first_responded_at: iso(ticket.firstRespondedAt),
    resolution_due_at: ticket.resolutionDueAt.toISOString(),
    overdue: active && ((ticket.firstRespondedAt === null && ticket.firstResponseDueAt < now) || ticket.resolutionDueAt < now),
    tenant_reply_requested_at: iso(ticket.tenantReplyRequestedAt),
    tenant_reply_due_at: iso(ticket.tenantReplyDueAt),
    tenant_replied_at: iso(ticket.tenantRepliedAt),
    outcome: ticket.outcome,
    liable_party: ticket.liableParty,
    decision_note: ticket.decisionNote,
    decided_at: iso(ticket.decidedAt),
    decided_by: ticket.decidedBy,
    approval_id: ticket.approvalId,
    appeal_until: appealUntil(ticket),
    closed_at: iso(ticket.closedAt),
    closed_by: ticket.closedBy,
    close_note: ticket.closeNote,
    version: ticket.version,
    created_at: ticket.createdAt.toISOString(),
    updated_at: ticket.updatedAt.toISOString(),
  };
}

/** 供应商看到的工单：没有处理人、判定人、复核编号（平台内部的分工）。 */
function tenantTicketJson(ticket: TicketRow): Json {
  return {
    id: ticket.id,
    ticket_no: ticket.ticketNo,
    type: ticket.type,
    source: ticket.source,
    order: { id: ticket.orderId, order_no: ticket.orderNo },
    parent_ticket_id: ticket.parentTicketId,
    priority: ticket.priority,
    subject: ticket.subject,
    description: ticket.description,
    status: ticket.status,
    tenant_reply_requested_at: iso(ticket.tenantReplyRequestedAt),
    tenant_reply_due_at: iso(ticket.tenantReplyDueAt),
    tenant_replied_at: iso(ticket.tenantRepliedAt),
    outcome: ticket.outcome,
    liable_party: ticket.liableParty,
    decision_note: ticket.decisionNote,
    decided_at: iso(ticket.decidedAt),
    appeal_until: appealUntil(ticket),
    closed_at: iso(ticket.closedAt),
    created_at: ticket.createdAt.toISOString(),
    updated_at: ticket.updatedAt.toISOString(),
  };
}

function messageJson(message: TicketMessage, scope: "platform" | "tenant"): Json {
  return {
    id: message.id,
    author_type: message.authorType,
    // 供应商看不到是哪位客服写的（只看到「平台」）
    author_id: scope === "platform" || message.authorType === "tenant_user" ? message.authorId : null,
    body: message.body,
    file_ids: message.fileIds,
    created_at: message.createdAt.toISOString(),
  };
}

function deductionJson(deduction: Deduction): Json {
  return {
    id: deduction.id,
    kind: deduction.kind,
    amount: salesMoney(deduction.amountMinor, deduction.currency),
    status: deduction.status,
    basis: deduction.basis,
    waived_at: iso(deduction.waivedAt),
    waive_reason: deduction.waiveReason,
    created_at: deduction.createdAt.toISOString(),
  };
}

const money = (minor: number, currency: CurrencyCode): Json => salesMoney(minor, currency);

/** 运营后台看到的一笔赔付：客人那边的全部金额和付法、供应商承担的合计。 */
function compensationJson(c: TicketCompensation): Json {
  return {
    scenario: c.scenario,
    scenario_name: COMPENSATION_SCENARIO_NAMES[c.scenario],
    liable_party: c.liableParty,
    table_version: c.tableVersion,
    customer_bp: c.customerBp,
    sell: money(c.sellMinor, c.currency),
    ratio_amount: money(c.ratioMinor, c.currency),
    downgrade_difference: money(c.downgradeDifferenceMinor, c.currency),
    minimum: money(c.minimumMinor, c.currency),
    minimum_fx: c.minimumFx,
    topped_up: c.toppedUp,
    compensation: money(c.compensationMinor, c.currency),
    reimbursement_claimed: money(c.reimbursementClaimedMinor, c.currency),
    reimbursement_cap: money(c.reimbursementCapMinor, c.currency),
    reimbursement: money(c.reimbursementMinor, c.currency),
    refund: money(c.refundMinor, c.currency),
    manual_payout: money(c.manualPayoutMinor, c.currency),
    order_cancelled: c.orderCancelled,
    payout_status: c.payoutStatus,
    payout_reference: c.payoutReference,
    paid_at: iso(c.paidAt),
    paid_by: c.paidBy,
    tenant_total: money(c.tenantTotalMinor, c.tenantCurrency),
    created_at: c.createdAt.toISOString(),
  };
}

/** 试算的结果（还没判定）。 */
function amountsJson(amounts: CompensationAmounts, willCancel: boolean): Json {
  const c = amounts.customer;
  const t = amounts.tenant;
  return {
    scenario: amounts.scenario,
    scenario_name: COMPENSATION_SCENARIO_NAMES[amounts.scenario],
    liable_party: amounts.liable,
    table_version: amounts.tableVersion,
    customer_bp: amounts.customerBp,
    customer: {
      ratio_amount: money(c.ratioMinor, c.currency),
      downgrade_difference: money(c.downgradeDifferenceMinor, c.currency),
      minimum: money(c.minimumMinor, c.currency),
      topped_up: c.toppedUp,
      compensation: money(c.compensationMinor, c.currency),
      reimbursement_cap: money(c.reimbursementCapMinor, c.currency),
      reimbursement: money(c.reimbursementMinor, c.currency),
      refund: money(c.refundMinor, c.currency),
      manual_payout: money(c.manualPayoutMinor, c.currency),
    },
    tenant: {
      ratio_amount: money(t.ratioMinor, t.currency),
      downgrade_difference: money(t.downgradeDifferenceMinor, t.currency),
      reimbursement: money(t.reimbursementMinor, t.currency),
      total: money(t.totalMinor, t.currency),
    },
    order_will_be_cancelled: willCancel,
    needs_review: amounts.needsReview,
  };
}

/** 渠道和客人看到的工单：类型、状态、结论和客人这边的赔付（没有对话、内部备注、供应商承担的部分）。 */
function channelTicketJson(ticket: Ticket, compensation: TicketCompensation | null, replies: readonly TicketNote[]): Json {
  return {
    id: ticket.id,
    ticket_no: ticket.ticketNo,
    type: ticket.type,
    source: ticket.source,
    subject: ticket.subject,
    status: ticket.status,
    outcome: ticket.outcome,
    decided_at: iso(ticket.decidedAt),
    created_at: ticket.createdAt.toISOString(),
    // 平台写给客人的回复（不带是哪位员工）
    replies: replies.map((reply) => ({ body: reply.body, created_at: reply.createdAt.toISOString() })),
    compensation:
      compensation === null
        ? null
        : {
            scenario: compensation.scenario,
            compensation: money(compensation.compensationMinor, compensation.currency),
            reimbursement: money(compensation.reimbursementMinor, compensation.currency),
            refund: money(compensation.refundMinor, compensation.currency),
            other_payout: money(compensation.manualPayoutMinor, compensation.currency),
            payout_status: compensation.payoutStatus,
          },
  };
}

export function registerOrderCenterRoutes(app: FastifyInstance, ctx: AppContext): void {
  // ---- 异常队列 ----

  app.get("/platform/v1/exceptions", async (request) => {
    const principal = await authenticatePlatform(ctx, platformCredentials(request), { action: "order.read" });
    const query = parseInput(exceptionListSchema, request.query, "querystring");
    const now = ctx.now();
    const page = await listExceptionsForPlatform(
      ctx,
      { status: query.status, type: query.type ?? null, assigneeId: query.assignee === "me" ? principal.user.id : (query.assignee ?? null), orderId: query.order_id ?? null, tenantId: query.tenant_id ?? null, overdue: query.overdue === "true", now, scopeCityIds: principal.grant.scope.cityIds, scopeChannelIds: principal.grant.scope.channelIds },
      query.limit,
      decodeTimeCursor(query.cursor ?? null),
    );
    return { items: page.items.map((row) => exceptionJson(row, now)), next_cursor: page.nextCursor, total: page.total };
  });

  app.get("/platform/v1/exceptions/:id", async (request) => {
    const principal = await authenticatePlatform(ctx, platformCredentials(request), { action: "order.read" });
    await assertExceptionInScope(ctx, principal.grant.scope, resourceId(request.params, "异常"));
    return { exception: exceptionJson(await getException(ctx, resourceId(request.params, "异常")), ctx.now()) };
  });

  app.post("/platform/v1/exceptions/:id/claim", async (request) => {
    const principal = await authenticatePlatform(ctx, platformCredentials(request), { action: "exception.manage" });
    await assertExceptionInScope(ctx, principal.grant.scope, resourceId(request.params, "异常"));
    const exceptionId = resourceId(request.params, "异常");
    const input = parseInput(claimSchema, request.body ?? {}, "body");
    return { exception: exceptionJson(await claimException(ctx, principal, exceptionId, input.assignee_id, request.ip), ctx.now()) };
  });

  app.post("/platform/v1/exceptions/:id/close", async (request) => {
    const principal = await authenticatePlatform(ctx, platformCredentials(request), { action: "exception.manage" });
    await assertExceptionInScope(ctx, principal.grant.scope, resourceId(request.params, "异常"));
    const exceptionId = resourceId(request.params, "异常");
    const input = parseInput(closeExceptionSchema, request.body, "body");
    return { exception: exceptionJson(await closeException(ctx, principal, exceptionId, input.resolution, request.ip), ctx.now()) };
  });

  // ---- 赔付表 ----

  app.get("/platform/v1/compensation-table", async (request) => {
    await authenticatePlatform(ctx, platformCredentials(request), { action: "master_data.read" });
    const table = await getCompensationTable(ctx);
    return {
      compensation_table: {
        version: table.version,
        effective_at: iso(table.createdAt),
        scenarios: COMPENSATION_SCENARIOS.map((scenario) => ({
          scenario,
          name: COMPENSATION_SCENARIO_NAMES[scenario],
          customer_bp: table.customerBp[scenario],
          full_refund: COMPENSATION_SCENARIO_RULES[scenario].fullRefund,
          reimbursement: COMPENSATION_SCENARIO_RULES[scenario].reimbursement,
          downgrade_difference: COMPENSATION_SCENARIO_RULES[scenario].downgradeDifference,
        })),
        minimum_jpy: table.minimumJpy,
        reimbursement_cap_bp: table.reimbursementCapBp,
        review_at_or_above_sell_bp: table.reviewAtOrAboveSellBp,
      },
      cancellation_policy: cancellationPolicyJson(await getCancellationPolicy(ctx, "platform")),
    };
  });

  const tableChangeSchema = z
    .object({
      customer_bp: z.object(Object.fromEntries(COMPENSATION_SCENARIOS.map((scenario) => [scenario, z.number().int()])) as Record<(typeof COMPENSATION_SCENARIOS)[number], z.ZodNumber>).strict(),
      minimum_jpy: z.number().int(),
      reimbursement_cap_bp: z.number().int(),
      review_at_or_above_sell_bp: z.number().int(),
      note: z.string().trim().max(500).nullable().default(null),
    })
    .strict();

  app.post("/platform/v1/compensation-table/changes", async (request, reply) => {
    const principal = await authenticatePlatform(ctx, platformCredentials(request), { action: "compensation_table.manage" });
    const input = parseInput(tableChangeSchema, request.body, "body");
    const approval = await requestCompensationTableChange(
      ctx,
      principal,
      { customerBp: input.customer_bp, minimumJpy: input.minimum_jpy, reimbursementCapBp: input.reimbursement_cap_bp, reviewAtOrAboveSellBp: input.review_at_or_above_sell_bp },
      input.note,
      request.ip,
    );
    return reply.code(202).send({ approval: approvalJson(approval, principal) });
  });

  // ---- 工单（运营后台） ----

  app.get("/platform/v1/tickets", async (request) => {
    const principal = await authenticatePlatform(ctx, platformCredentials(request), { action: "ticket.read" });
    const query = parseInput(ticketListSchema, request.query, "querystring");
    const now = ctx.now();
    const page = await listTicketsForPlatform(
      ctx,
      {
        status: query.status ?? null,
        type: query.type ?? null,
        tenantId: query.tenant_id ?? null,
        orderId: query.order_id ?? null,
        assigneeId: query.assignee === "me" ? principal.user.id : (query.assignee ?? null),
        overdue: query.overdue === "true",
        q: query.q ?? null,
        now,
        scopeCityIds: principal.grant.scope.cityIds,
        scopeChannelIds: principal.grant.scope.channelIds,
      },
      query.limit,
      decodeTimeCursor(query.cursor ?? null),
    );
    return { items: page.items.map((row) => platformTicketJson(row, now)), next_cursor: page.nextCursor, total: page.total };
  });

  const platformDetail = async (ticketId: string, principal: Awaited<ReturnType<typeof authenticatePlatform>>): Promise<Json> => {
    const found = await getTicketForPlatform(ctx, ticketId);
    const now = ctx.now();
    const row = { ...found.ticket, orderNo: found.orderNo, tenantName: found.tenantName };
    return {
      ticket: platformTicketJson(row, now),
      messages: found.messages.map((message) => messageJson(message, "platform")),
      notes: found.notes.map((note) => ({ id: note.id, author: { id: note.authorId, name: note.authorName }, body: note.body, to_guest: note.toGuest, created_at: note.createdAt.toISOString() })),
      compensation: found.compensation === null ? null : compensationJson(found.compensation),
      deductions: found.deductions.map(deductionJson),
      refund_ids: found.refunds.map((refund) => refund.id),
      parent: found.parent === null ? null : { id: found.parent.id, ticket_no: found.parent.ticketNo, type: found.parent.type, outcome: found.parent.outcome, decided_by: found.parent.decidedBy },
      appeal: found.appeal === null ? null : { id: found.appeal.id, ticket_no: found.appeal.ticketNo, status: found.appeal.status, outcome: found.appeal.outcome },
      approval: found.approval === null ? null : approvalJson(found.approval, principal),
    };
  };

  app.post("/platform/v1/tickets", async (request, reply) => {
    const principal = await authenticatePlatform(ctx, platformCredentials(request), { action: "ticket.manage" });
    const input = parseInput(platformCreateSchema, request.body, "body");
    await assertPlatformOrderInScope(ctx, principal.grant.scope, input.order_id);
    const ticket = await createTicketForPlatform(ctx, principal, { type: input.type, orderId: input.order_id, tenantId: input.tenant_id, source: input.source, priority: input.priority, subject: input.subject, description: input.description, language: input.language }, request.ip);
    return reply.code(201).send(await platformDetail(ticket.id, principal));
  });

  app.get("/platform/v1/tickets/:id", async (request) => {
    const principal = await authenticatePlatform(ctx, platformCredentials(request), { action: "ticket.read" });
    await assertTicketInScope(ctx, principal.grant.scope, resourceId(request.params, "工单"));
    return platformDetail(resourceId(request.params, "工单"), principal);
  });

  app.post("/platform/v1/tickets/:id/assign", async (request) => {
    const principal = await authenticatePlatform(ctx, platformCredentials(request), { action: "ticket.manage" });
    await assertTicketInScope(ctx, principal.grant.scope, resourceId(request.params, "工单"));
    const ticketId = resourceId(request.params, "工单");
    const input = parseInput(assignSchema, request.body ?? {}, "body");
    await assignTicket(ctx, principal, ticketId, input.assignee_id, request.ip);
    return platformDetail(ticketId, principal);
  });

  app.post("/platform/v1/tickets/:id/messages", async (request, reply) => {
    const principal = await authenticatePlatform(ctx, platformCredentials(request), { action: "ticket.manage" });
    await assertTicketInScope(ctx, principal.grant.scope, resourceId(request.params, "工单"));
    const ticketId = resourceId(request.params, "工单");
    const input = parseInput(platformMessageSchema, request.body, "body");
    await addPlatformMessage(ctx, principal, ticketId, { body: input.body, internal: input.internal, toGuest: input.to_guest }, request.ip);
    return reply.code(201).send(await platformDetail(ticketId, principal));
  });

  app.post("/platform/v1/tickets/:id/request-reply", async (request) => {
    const principal = await authenticatePlatform(ctx, platformCredentials(request), { action: "ticket.manage" });
    await assertTicketInScope(ctx, principal.grant.scope, resourceId(request.params, "工单"));
    const ticketId = resourceId(request.params, "工单");
    const input = parseInput(requestReplySchema, request.body, "body");
    await requestTenantReply(ctx, principal, ticketId, input.body, request.ip);
    return platformDetail(ticketId, principal);
  });

  app.post("/platform/v1/tickets/:id/compensation-quote", async (request) => {
    const principal = await authenticatePlatform(ctx, platformCredentials(request), { action: "ticket.manage" });
    await assertTicketInScope(ctx, principal.grant.scope, resourceId(request.params, "工单"));
    const ticketId = resourceId(request.params, "工单");
    const input = parseInput(compensationSchema, request.body, "body");
    const preview = await previewCompensation(ctx, ticketId, toCompensationRequest(input));
    return { quote: amountsJson(preview.amounts, preview.willCancel) };
  });

  app.post("/platform/v1/tickets/:id/decide", async (request, reply) => {
    const principal = await authenticatePlatform(ctx, platformCredentials(request), { action: "ticket.manage" });
    await assertTicketInScope(ctx, principal.grant.scope, resourceId(request.params, "工单"));
    const ticketId = resourceId(request.params, "工单");
    const input = parseInput(decideSchema, request.body, "body");
    const result = await decideTicket(ctx, principal, ticketId, { outcome: input.outcome, note: input.note, compensation: input.compensation === null ? null : toCompensationRequest(input.compensation), driverAbsent: input.driver_absent }, request.ip, request.log);
    const detail = await platformDetail(ticketId, principal);
    return result.kind === "pending_review" ? reply.code(202).send(detail) : detail;
  });

  app.post("/platform/v1/tickets/:id/close", async (request) => {
    const principal = await authenticatePlatform(ctx, platformCredentials(request), { action: "ticket.manage" });
    await assertTicketInScope(ctx, principal.grant.scope, resourceId(request.params, "工单"));
    const ticketId = resourceId(request.params, "工单");
    const input = parseInput(closeTicketSchema, request.body, "body");
    await closeTicket(ctx, principal, ticketId, input.note, request.ip);
    return platformDetail(ticketId, principal);
  });

  app.post("/platform/v1/tickets/:id/payout", async (request) => {
    const principal = await authenticatePlatform(ctx, platformCredentials(request), { action: "payment.manage" });
    await assertTicketInScope(ctx, principal.grant.scope, resourceId(request.params, "工单"));
    const ticketId = resourceId(request.params, "工单");
    const input = parseInput(payoutSchema, request.body, "body");
    await markCompensationPaid(ctx, principal, ticketId, input.reference, request.ip);
    return platformDetail(ticketId, principal);
  });

  // ---- 工单（供应商） ----

  const tenantDetail = async (tenantId: string, ticketId: string): Promise<Json> => {
    const found = await getTicketForTenant(ctx, tenantId, ticketId);
    return {
      ticket: tenantTicketJson(found.ticket),
      messages: found.messages.map((message) => messageJson(message, "tenant")),
      deductions: found.deductions.map(deductionJson),
      appeal: found.appeal === null ? null : { id: found.appeal.id, ticket_no: found.appeal.ticketNo, status: found.appeal.status, outcome: found.appeal.outcome },
    };
  };

  app.get("/tenant/v1/tickets", async (request) => {
    const principal = await authenticateTenant(ctx, bearerToken(request.headers.authorization), { action: "ticket.read" });
    const query = parseInput(tenantTicketListSchema, request.query, "querystring");
    const page = await listTicketsForTenant(ctx, principal.tenantId, { status: query.status ?? null, orderId: query.order_id ?? null }, query.limit, decodeTimeCursor(query.cursor ?? null));
    return { items: page.items.map(tenantTicketJson), next_cursor: page.nextCursor, total: page.total };
  });

  app.get("/tenant/v1/tickets/:id", async (request) => {
    const principal = await authenticateTenant(ctx, bearerToken(request.headers.authorization), { action: "ticket.read" });
    return tenantDetail(principal.tenantId, resourceId(request.params, "工单"));
  });

  app.post("/tenant/v1/tickets", async (request, reply) => {
    const principal = await authenticateTenant(ctx, bearerToken(request.headers.authorization), { action: "ticket.manage" });
    const input = parseInput(tenantCreateSchema, request.body, "body");
    const ticket = await createTicketForTenant(ctx, principal, { type: input.type, orderId: input.order_id, parentTicketId: input.parent_ticket_id, subject: input.subject, description: input.description, language: null }, request.ip);
    return reply.code(201).send(await tenantDetail(principal.tenantId, ticket.id));
  });

  app.post("/tenant/v1/tickets/:id/messages", async (request, reply) => {
    const principal = await authenticateTenant(ctx, bearerToken(request.headers.authorization), { action: "ticket.manage" });
    const ticketId = resourceId(request.params, "工单");
    const input = parseInput(tenantMessageSchema, request.body, "body");
    await replyAsTenant(ctx, principal, ticketId, { body: input.body, fileIds: input.file_ids }, request.ip);
    return reply.code(201).send(await tenantDetail(principal.tenantId, ticketId));
  });

  // ---- 工单（渠道、官网的客人） ----

  const channelList = async (channelId: string, orderId: string): Promise<Json> => ({ items: (await listTicketsForChannel(ctx, channelId, orderId)).map((entry) => channelTicketJson(entry.ticket, entry.compensation, entry.replies)) });

  app.get("/sales/v1/orders/:id/tickets", async (request) => {
    const principal = await authenticateSales(ctx, bearerToken(request.headers.authorization), "other");
    return channelList(principal.channelId, resourceId(request.params, "订单"));
  });

  app.post("/sales/v1/orders/:id/tickets", async (request, reply) => {
    const principal = await authenticateSales(ctx, bearerToken(request.headers.authorization), "other");
    const orderId = resourceId(request.params, "订单");
    const input = parseInput(salesCreateSchema, request.body, "body");
    const ticket = await createTicketForChannel(ctx, principal.channelId, orderId, { type: input.type, subject: input.subject, description: input.description, language: input.language, priority: null, source: input.raised_by });
    return reply.code(201).send({ ticket: channelTicketJson(ticket, null, []) });
  });

  const guest = async (request: FastifyRequest): Promise<{ orderId: string; channelId: string }> => {
    await takeSiteSlot(ctx, "site_read", { ip: request.ip });
    return resolveSiteLink(ctx, bearerToken(request.headers.authorization));
  };

  app.get("/site/v1/order/tickets", async (request) => {
    const who = await guest(request);
    return channelList(who.channelId, who.orderId);
  });

  app.post("/site/v1/order/tickets", async (request, reply) => {
    const who = await guest(request);
    const input = parseInput(externalCreateSchema, request.body, "body");
    const ticket = await createTicketForChannel(ctx, who.channelId, who.orderId, { type: input.type, subject: input.subject, description: input.description, language: input.language, priority: null, source: "guest" });
    return reply.code(201).send({ ticket: channelTicketJson(ticket, null, []) });
  });
}

/** 运营后台订单详情里的工单（摘要）。 */
export function orderTicketJson(ticket: Ticket): Json {
  return { id: ticket.id, ticket_no: ticket.ticketNo, type: ticket.type, tenant_id: ticket.tenantId, status: ticket.status, priority: ticket.priority, subject: ticket.subject, outcome: ticket.outcome, created_at: ticket.createdAt.toISOString() };
}

