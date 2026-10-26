/**
 * 工单（M4-02，ADR 0034）：创建、分派、对话和内部备注、征求租户意见、判定（赔付按统一赔付表算、no-show 审核、申诉）、复核、关闭、另付登记。
 *
 * - 工单绑定订单（一个供应商的那一行）。和哪个供应商有关，工单就带它的 tenant_id：供应商在自己的后台看得到、能回复和申诉（租户编号只来自令牌）。
 * - 写入一律在平台事务里；供应商、渠道、客人的写入带着各自令牌里的身份去找工单，找不到（别的供应商的、别的渠道的单）一律 404。
 * - 规则 4：客人那边的赔付金额（对外价 × 比例、退款、另付）只在平台表 `ticket_compensations`；供应商承担的部分（结算币种）记在 `tenant_deductions`。
 * - 每个改动写审计日志（员工、供应商用户）；渠道和客人建工单写在工单本身（来源、建的人）。
 */
import {
  CANCELLABLE_STATUSES,
  COMPENSATION_SCENARIO_RULES,
  type CompensationAmounts,
  type CompensationInputIssue,
  type CompensationScenario,
  type CurrencyCode,
  type FxQuote,
  type LiableParty,
  TICKET_RULES,
  type TicketOutcome,
  type TicketPriority,
  type TicketSource,
  type TicketType,
  appealRefusal,
  compensationAmounts,
  compensationInputIssues,
  complaintWindowOpen,
  defaultTicketPriority,
  firstResponseDueAt,
  fxQuoteFromTable,
  fxTableState,
  minimumCompensationMinor,
  outcomeNeedsCompensation,
  resolutionDueAt,
  serviceEnd,
  tenantReplyDueAt,
  ticketActive,
  ticketCloseRefusal,
  ticketDecisionRefusal,
  ticketTypeAllowed,
} from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { type Db, withPlatformTx, withTenantTx } from "../db/context.ts";
import { AppError } from "../errors.ts";
import type { Approval } from "../repos/approvals.ts";
import { findApproval } from "../repos/approvals.ts";
import { type AuditOrigin, type AuditValues, insertAuditLog } from "../repos/audit-logs.ts";
import { type Order, type OrderSale, findOrderForPlatform, findOrderOfTenant, findSale, updateOrderStatus } from "../repos/orders.ts";
import type { OrderRefund } from "../repos/refunds.ts";
import { listOrderRefunds } from "../repos/refunds.ts";
import { type Deduction, insertDeduction, listTicketDeductions } from "../repos/rescues.ts";
import { recordPerformanceEvent } from "../repos/tenant-onboarding.ts";
import { currentCompensationTable } from "../repos/compensation-tables.ts";
import type { Page, TimeCursor } from "../pagination.ts";
import {
  type NewTicket,
  type Ticket,
  type TicketCompensation,
  type TicketFilter,
  type TicketMessage,
  type TicketNote,
  type TicketRow,
  countOrderFiles,
  deletePerformanceEvent,
  findAppeal,
  findTicket,
  findTicketCompensation,
  insertTicket,
  insertTicketCompensation,
  insertTicketMessage,
  insertTicketNote,
  listNoShowClaimsWithoutTicket,
  listTenantTickets,
  listTicketMessages,
  listTicketNotes,
  listTickets,
  markPayoutPaid,
  updateTicket,
  waiveTicketDeductions,
} from "../repos/tickets.ts";
import { validationFailed } from "../validation.ts";
import { type ApprovalKind, requestApproval } from "./approvals.ts";
import { consoleOrigin, platformActor, tenantActor } from "./audit.ts";
import { cancelPaidOrderInTx } from "./cancellations.ts";
import { notFound } from "./errors.ts";
import { recordStatusChange } from "./fulfilment.ts";
import { netPaidMinor, processRefunds, scheduleRefund } from "./order-money.ts";
import { type OrderLog, SILENT_ORDER_LOG } from "./orders.ts";
import type { PlatformPrincipal } from "./platform-auth.ts";
import type { TenantPrincipal } from "./tenant-auth.ts";

// ---- 共用 ----

function ticketStateInvalid(ticket: Ticket, action: string): AppError {
  return new AppError(409, "TICKET_STATE_INVALID", "工单现在的状态不能做这一步", { status: ticket.status, action });
}

function ticketChanged(): AppError {
  return new AppError(409, "TICKET_CHANGED", "工单刚被别人改过，请刷新后再试");
}

async function mustUpdate(db: Db, ticket: Ticket, change: Parameters<typeof updateTicket>[2], now: Date): Promise<Ticket> {
  const updated = await updateTicket(db, ticket, change, now);
  if (updated === null) throw ticketChanged();
  return updated;
}

function ticketAudit(ticket: Ticket): AuditValues {
  return { ticket_no: ticket.ticketNo, type: ticket.type, status: ticket.status, order_id: ticket.orderId, priority: ticket.priority, assignee_id: ticket.assigneeId, outcome: ticket.outcome, liable_party: ticket.liableParty };
}

async function auditTicket(db: Db, origin: AuditOrigin, ticket: Ticket, action: Parameters<typeof insertAuditLog>[2]["action"], before: AuditValues | null, after: AuditValues | null): Promise<void> {
  // 平台员工的操作记成平台级（tenant_id 为空，和订单、救援一样）；供应商用户的操作记在它自己的租户下
  const tenantId = origin.actor.type === "tenant_user" ? ticket.tenantId : null;
  await insertAuditLog(db, origin, { tenantId, resource: "ticket", resourceId: ticket.id, action, before, after });
}

/** 预计服务结束：完成了的按完成时间，否则按用车时间（包车加套餐时长）。投诉 14 天从它起算。 */
function serviceEndOf(order: Order): Date {
  return order.dispatch.completedAt ?? serviceEnd(order.serviceAt, order.packageHours);
}

function timesFor(type: TicketType, order: Order, priority: TicketPriority | null, now: Date): Pick<NewTicket, "priority" | "firstResponseDueAt" | "resolutionDueAt"> {
  const chosen = priority ?? defaultTicketPriority(type, { serviceDate: order.serviceDate, timeZone: order.timezone }, now);
  return { priority: chosen, firstResponseDueAt: firstResponseDueAt(chosen, now), resolutionDueAt: resolutionDueAt(now) };
}

export interface TicketCreateInput {
  type: TicketType;
  subject: string;
  description: string;
  language: string | null;
  priority: TicketPriority | null;
}

async function createInTx(db: Db, order: Order, input: TicketCreateInput & { source: TicketSource; createdByType: NewTicket["createdByType"]; createdBy: string | null; parentTicketId: string | null }, now: Date): Promise<Ticket> {
  if (!ticketTypeAllowed(input.source, input.type)) throw new AppError(422, "TICKET_TYPE_NOT_ALLOWED", "这一类工单不能由这个来源建", { source: input.source, type: input.type });
  if (order.confirmedAt === null) throw notFound("订单");
  // 投诉时限：服务后 14 天内（客人、渠道提的；客服代登记的同样按这条）
  if (input.type === "complaint" && !complaintWindowOpen(serviceEndOf(order), now)) {
    throw new AppError(409, "COMPLAINT_WINDOW_CLOSED", "已经超过投诉时限（服务后 14 天内）", { service_end: serviceEndOf(order).toISOString() });
  }
  return insertTicket(
    db,
    {
      tenantId: order.tenantId,
      type: input.type,
      source: input.source,
      createdByType: input.createdByType,
      createdBy: input.createdBy,
      orderId: order.id,
      parentTicketId: input.parentTicketId,
      subject: input.subject,
      description: input.description,
      language: input.language,
      ...timesFor(input.type, order, input.priority, now),
    },
    now,
  );
}

// ---- 创建 ----

/**
 * 客服建工单（`ticket.manage`）：代客人、渠道、供应商登记，或客服自己发起（来源照实选）。
 * 工单的供应商默认是这一单现在的供应商；救援改派过的单可以指定原来的供应商（投诉的是它）。
 */
export async function createTicketForPlatform(ctx: AppContext, principal: PlatformPrincipal, input: TicketCreateInput & { orderId: string; tenantId: string | null; source: Exclude<TicketSource, "system"> }, ip: string): Promise<Ticket> {
  const now = ctx.now();
  const origin = consoleOrigin(platformActor(principal.user), ip, now);
  return withPlatformTx(ctx.pool, async (db) => {
    const current = await findOrderForPlatform(db, input.orderId);
    if (current === null) throw notFound("订单");
    const order = input.tenantId === null || input.tenantId === current.tenantId ? current : await findOrderOfTenant(db, input.tenantId, input.orderId);
    if (order === null) throw new AppError(422, "TICKET_TENANT_INVALID", "这个供应商没有接过这一单", { tenant_id: input.tenantId });
    // 客服代供应商登记申诉不在这里（申诉由供应商在自己的后台提），来源是供应商的只能登记失物和其他
    const ticket = await createInTx(db, order, { ...input, createdByType: "platform_user", createdBy: principal.user.id, parentTicketId: null }, now);
    await auditTicket(db, origin, ticket, "create", null, { ...ticketAudit(ticket), source: ticket.source, subject: ticket.subject });
    return ticket;
  });
}

/** 渠道（或官网上的客人）建工单：只能是这个渠道的单（渠道编号只来自令牌），工单的供应商是这一单现在的供应商。 */
export async function createTicketForChannel(ctx: AppContext, channelId: string, orderId: string, input: TicketCreateInput & { source: "guest" | "channel" }): Promise<Ticket> {
  const now = ctx.now();
  return withPlatformTx(ctx.pool, async (db) => {
    const sale = await findSale(db, orderId);
    const order = sale === null || sale.channelId !== channelId ? null : await findOrderForPlatform(db, orderId);
    if (order === null) throw notFound("订单");
    const count = await db.query<{ n: number }>("select count(*)::int as n from tickets where order_id = $1 and source in ('guest', 'channel')", [orderId]);
    if ((count.rows[0] as { n: number }).n >= TICKET_RULES.maxExternalTicketsPerOrder) throw new AppError(409, "TICKET_LIMIT_REACHED", "这一单的工单已经很多了，请直接联系客服", { limit: TICKET_RULES.maxExternalTicketsPerOrder });
    return createInTx(db, order, { ...input, priority: null, createdByType: input.source, createdBy: null, parentTicketId: null }, now);
  });
}

/** 渠道看到的这一单的工单（只有类型、状态、结论；没有内部备注和供应商的对话）。 */
export async function listTicketsForChannel(ctx: AppContext, channelId: string, orderId: string): Promise<{ ticket: Ticket; compensation: TicketCompensation | null }[]> {
  return withPlatformTx(
    ctx.pool,
    async (db) => {
      const sale = await findSale(db, orderId);
      if (sale === null || sale.channelId !== channelId) throw notFound("订单");
      const tickets = (await db.query<{ id: string }>("select id from tickets where order_id = $1 and source in ('guest', 'channel') order by created_at, id", [orderId])).rows;
      const result: { ticket: Ticket; compensation: TicketCompensation | null }[] = [];
      for (const row of tickets) {
        const ticket = (await findTicket(db, row.id)) as Ticket;
        result.push({ ticket, compensation: await findTicketCompensation(db, ticket.id) });
      }
      return result;
    },
    { snapshot: true },
  );
}

/**
 * 供应商建工单（`ticket.manage`）：申诉（对一张判定，7 天内、一次）、失物招领、其他。租户编号只来自令牌：
 * 申诉的工单、登记的订单都必须是它自己的，别的供应商的一律 404。
 */
export async function createTicketForTenant(
  ctx: AppContext,
  principal: TenantPrincipal,
  input: Omit<TicketCreateInput, "priority"> & { orderId: string | null; parentTicketId: string | null },
  ip: string,
): Promise<Ticket> {
  const now = ctx.now();
  const origin = { occurredAt: now, actor: tenantActor(principal.user), ip, source: "console" as const };
  return withPlatformTx(ctx.pool, async (db) => {
    let order: Order | null;
    if (input.type === "tenant_appeal") {
      if (input.parentTicketId === null) throw validationFailed("body", [{ path: "/parent_ticket_id", message: "申诉要指明是对哪一张工单的判定" }]);
      const parent = await findTicket(db, input.parentTicketId, { tenantId: principal.tenantId, lock: true });
      if (parent === null) throw notFound("工单");
      const refusal = appealRefusal(parent, now);
      if (refusal === "NOT_APPEALABLE") throw new AppError(409, "NOT_APPEALABLE", "这张工单的判定对你没有不利（或还没判定），不能申诉");
      if (refusal === "APPEAL_WINDOW_CLOSED") throw new AppError(409, "APPEAL_WINDOW_CLOSED", "已经超过申诉期限（判定后 7 天内）", { decided_at: (parent.decidedAt as Date).toISOString() });
      if ((await findAppeal(db, principal.tenantId, parent.id)) !== null) throw new AppError(409, "ALREADY_APPEALED", "这张工单的判定已经申诉过了（只能申诉一次）");
      order = await findOrderOfTenant(db, principal.tenantId, parent.orderId);
    } else {
      if (input.parentTicketId !== null) throw validationFailed("body", [{ path: "/parent_ticket_id", message: "只有申诉要指明工单" }]);
      if (input.orderId === null) throw validationFailed("body", [{ path: "/order_id", message: "必填" }]);
      order = await findOrderOfTenant(db, principal.tenantId, input.orderId);
    }
    if (order === null) throw notFound("订单");
    const ticket = await createInTx(db, order, { ...input, priority: null, source: "tenant", createdByType: "tenant_user", createdBy: principal.user.id }, now);
    await auditTicket(db, origin, ticket, "create", null, { ...ticketAudit(ticket), parent_ticket_id: ticket.parentTicketId, subject: ticket.subject });
    return ticket;
  });
}

/** 系统：给还没有审核工单的 no-show 申请建工单（异常队列的定时任务调，「no-show 待审核：转工单审核」）。返回建了几张。 */
export async function createNoShowReviewTickets(db: Db, now: Date): Promise<number> {
  const pending = await listNoShowClaimsWithoutTicket(db, 50);
  for (const claim of pending) {
    const order = (await findOrderOfTenant(db, claim.tenantId, claim.orderId)) as Order;
    await createInTx(db, order, { type: "no_show_review", subject: `no-show 审核：订单 ${order.orderNo}`, description: "司机提交了客人未出现（no-show），5 项证据已在提交时核对，请审核。", language: null, priority: null, source: "system", createdByType: "system", createdBy: null, parentTicketId: null }, now);
  }
  return pending.length;
}

// ---- 查看 ----

export async function listTicketsForPlatform(ctx: AppContext, filter: TicketFilter, limit: number, after: TimeCursor | null): Promise<Page<TicketRow> & { total: number }> {
  return withPlatformTx(ctx.pool, (db) => listTickets(db, filter, limit, after), { snapshot: true });
}

export interface PlatformTicketDetail {
  ticket: Ticket;
  orderNo: string;
  tenantName: string;
  messages: TicketMessage[];
  notes: TicketNote[];
  compensation: TicketCompensation | null;
  deductions: Deduction[];
  refunds: OrderRefund[];
  appeal: Ticket | null;
  parent: Ticket | null;
  approval: Approval | null;
}

export async function getTicketForPlatform(ctx: AppContext, id: string): Promise<PlatformTicketDetail> {
  return withPlatformTx(
    ctx.pool,
    async (db) => {
      const ticket = await findTicket(db, id);
      if (ticket === null) throw notFound("工单");
      const names = (await db.query<{ order_no: string; tenant_name: string }>("select o.order_no, t.name as tenant_name from orders o join tenants t on t.id = o.tenant_id where o.tenant_id = $1 and o.id = $2", [ticket.tenantId, ticket.orderId])).rows[0] as { order_no: string; tenant_name: string };
      return {
        ticket,
        orderNo: names.order_no,
        tenantName: names.tenant_name,
        messages: await listTicketMessages(db, ticket.tenantId, ticket.id),
        notes: await listTicketNotes(db, ticket.id),
        compensation: await findTicketCompensation(db, ticket.id),
        deductions: await listTicketDeductions(db, ticket.tenantId, ticket.id),
        refunds: (await listOrderRefunds(db, ticket.orderId)).filter((refund) => refund.ticketId === ticket.id),
        appeal: await findAppeal(db, ticket.tenantId, ticket.id),
        parent: ticket.parentTicketId === null ? null : await findTicket(db, ticket.parentTicketId),
        approval: ticket.approvalId === null ? null : await findApproval(db, ticket.approvalId),
      };
    },
    { snapshot: true },
  );
}

export async function listTicketsForTenant(ctx: AppContext, tenantId: string, filter: { status: TicketFilter["status"]; orderId: string | null }, limit: number, after: TimeCursor | null): Promise<Page<TicketRow> & { total: number }> {
  return withTenantTx(ctx.pool, tenantId, (db) => listTenantTickets(db, tenantId, filter, limit, after), { snapshot: true });
}

export interface TenantTicketDetail {
  ticket: TicketRow;
  messages: TicketMessage[];
  deductions: Deduction[];
  /** 对它的申诉（没有为 null） */
  appeal: Ticket | null;
}

/** 供应商看一张工单（租户事务，行级安全：别的供应商的查不到）。没有内部备注、客人那边的赔付金额。 */
export async function getTicketForTenant(ctx: AppContext, tenantId: string, id: string): Promise<TenantTicketDetail> {
  return withTenantTx(
    ctx.pool,
    tenantId,
    async (db) => {
      if ((await findTicket(db, id, { tenantId })) === null) throw notFound("工单");
      const ticket = await tenantTicketRow(db, tenantId, id);
      const appeal = (await db.query<{ id: string }>("select id from tickets where tenant_id = $1 and parent_ticket_id = $2", [tenantId, id])).rows[0];
      return {
        ticket,
        messages: await listTicketMessages(db, tenantId, id),
        deductions: await listTicketDeductions(db, tenantId, id),
        appeal: appeal === undefined ? null : await tenantTicketRow(db, tenantId, appeal.id),
      };
    },
    { snapshot: true },
  );
}

async function tenantTicketRow(db: Db, tenantId: string, id: string): Promise<TicketRow> {
  const ticket = (await findTicket(db, id, { tenantId })) as Ticket;
  const order = (await db.query<{ order_no: string; name: string }>("select o.order_no, t.name from orders o join tenants t on t.id = o.tenant_id where o.tenant_id = $1 and o.id = $2", [tenantId, ticket.orderId])).rows[0] as { order_no: string; name: string };
  return { ...ticket, orderNo: order.order_no, tenantName: order.name };
}

// ---- 分派、对话、征求租户意见 ----

async function lockTicket(db: Db, id: string, tenantId?: string): Promise<Ticket> {
  const ticket = await findTicket(db, id, { lock: true, ...(tenantId === undefined ? {} : { tenantId }) });
  if (ticket === null) throw notFound("工单");
  return ticket;
}

/** 认领（不给人就是自己）或转给别人（`ticket.manage`）。待处理的变成处理中；算首次响应。 */
export async function assignTicket(ctx: AppContext, principal: PlatformPrincipal, id: string, assigneeId: string | null, ip: string): Promise<Ticket> {
  const now = ctx.now();
  const origin = consoleOrigin(platformActor(principal.user), ip, now);
  return withPlatformTx(ctx.pool, async (db) => {
    const ticket = await lockTicket(db, id);
    if (!ticketActive(ticket.status)) throw ticketStateInvalid(ticket, "assign");
    const target = assigneeId ?? principal.user.id;
    const staff = (await db.query<{ status: string }>("select status from platform_users where id = $1", [target])).rows[0];
    if (staff === undefined || staff.status !== "active") throw new AppError(422, "ASSIGNEE_INVALID", "指定的人不存在或没有在用", { assignee_id: target });
    const updated = await mustUpdate(db, ticket, { assigneeId: target, assignedAt: now, status: ticket.status === "open" ? "in_progress" : ticket.status, firstRespondedAt: ticket.firstRespondedAt ?? now }, now);
    await auditTicket(db, origin, updated, "assign", ticketAudit(ticket), ticketAudit(updated));
    return updated;
  });
}

/**
 * 客服留言（`ticket.manage`）：`internal` 是内部备注（只有平台看得到），否则是给供应商看的对话。待处理的变成处理中；算首次响应。
 * 判定之后、关闭之前还能写内部备注（执行、另付的跟进）；给供应商的对话只在判定之前。
 */
export async function addPlatformMessage(ctx: AppContext, principal: PlatformPrincipal, id: string, input: { body: string; internal: boolean }, ip: string): Promise<Ticket> {
  const now = ctx.now();
  const origin = consoleOrigin(platformActor(principal.user), ip, now);
  return withPlatformTx(ctx.pool, async (db) => {
    const ticket = await lockTicket(db, id);
    if (ticket.status === "closed" || (!input.internal && !ticketActive(ticket.status))) throw ticketStateInvalid(ticket, input.internal ? "note" : "message");
    if (input.internal) await insertTicketNote(db, ticket.id, principal.user.id, input.body, now);
    else await insertTicketMessage(db, ticket, { authorType: "platform_user", authorId: principal.user.id, body: input.body, fileIds: [] }, now);
    const updated = await mustUpdate(db, ticket, { status: ticket.status === "open" ? "in_progress" : ticket.status, firstRespondedAt: ticket.firstRespondedAt ?? now }, now);
    await auditTicket(db, origin, updated, input.internal ? "note" : "reply", null, { ticket_no: ticket.ticketNo, internal: input.internal, body: input.body });
    return updated;
  });
}

/** 征求租户意见（`ticket.manage`）：给供应商留一条问题，等它 24 小时内回复（超时视为认可）。 */
export async function requestTenantReply(ctx: AppContext, principal: PlatformPrincipal, id: string, body: string, ip: string): Promise<Ticket> {
  const now = ctx.now();
  const origin = consoleOrigin(platformActor(principal.user), ip, now);
  return withPlatformTx(ctx.pool, async (db) => {
    const ticket = await lockTicket(db, id);
    if (ticket.status !== "open" && ticket.status !== "in_progress") throw ticketStateInvalid(ticket, "request_reply");
    await insertTicketMessage(db, ticket, { authorType: "platform_user", authorId: principal.user.id, body, fileIds: [] }, now);
    const due = tenantReplyDueAt(now);
    const updated = await mustUpdate(db, ticket, { status: "awaiting_tenant", tenantReplyRequestedAt: now, tenantReplyDueAt: due, tenantRepliedAt: null, firstRespondedAt: ticket.firstRespondedAt ?? now }, now);
    await auditTicket(db, origin, updated, "request_reply", ticketAudit(ticket), { ...ticketAudit(updated), tenant_reply_due_at: due.toISOString(), body });
    return updated;
  });
}

/**
 * 供应商回复（`ticket.manage`）：对话加一条（可以引用这一单的照片作证据）；在等它回复的变成处理中、记下回复时间。
 * 租户编号只来自令牌：别的供应商的工单 404。判定之后不能再回复（有异议走申诉）。
 */
export async function replyAsTenant(ctx: AppContext, principal: TenantPrincipal, id: string, input: { body: string; fileIds: string[] }, ip: string): Promise<Ticket> {
  const now = ctx.now();
  const origin = { occurredAt: now, actor: tenantActor(principal.user), ip, source: "console" as const };
  return withPlatformTx(ctx.pool, async (db) => {
    const ticket = await lockTicket(db, id, principal.tenantId);
    if (!ticketActive(ticket.status)) throw ticketStateInvalid(ticket, "reply");
    const fileIds = [...new Set(input.fileIds)];
    if ((await countOrderFiles(db, ticket.tenantId, ticket.orderId, fileIds)) !== fileIds.length) {
      throw validationFailed("body", [{ path: "/file_ids", reason: "FILE_NOT_FOUND", message: "只能引用这一单的照片" }]);
    }
    await insertTicketMessage(db, ticket, { authorType: "tenant_user", authorId: principal.user.id, body: input.body, fileIds }, now);
    const waiting = ticket.status === "awaiting_tenant";
    const updated = await mustUpdate(db, ticket, waiting ? { status: "in_progress", tenantRepliedAt: now } : {}, now);
    await auditTicket(db, origin, updated, "reply", null, { ticket_no: ticket.ticketNo, body: input.body, file_ids: fileIds, answered_request: waiting });
    return updated;
  });
}

// ---- 判定 ----

export interface CompensationRequest {
  scenario: CompensationScenario;
  liableParty: LiableParty;
  /** 车型降级：两个车型组的结算价之差（被投诉供应商的结算币种的最小单位） */
  downgradeSettlementDifferenceMinor: number | null;
  /** 司机未到：客人凭票申请报销的替代交通（客人支付币种的最小单位） */
  reimbursementClaimedMinor: number | null;
  /** 投诉成立时是不是重大投诉（影响转正式，ADR 0028） */
  major: boolean;
}

export interface DecisionInput {
  outcome: TicketOutcome;
  note: string;
  compensation: CompensationRequest | null;
  /** no-show 驳回：证据显示司机根本没到场，按「司机未到」计入履约失败 */
  driverAbsent: boolean;
}

/** 判定时客人那边要用的汇率：客人付的不是日元时，「至少等值 ¥500」要用汇率中心现在的 JPY 汇率（记进赔付记录）。 */
async function minimumFxFor(ctx: AppContext, currency: CurrencyCode): Promise<FxQuote | null> {
  if (currency === "JPY") return null;
  const table = await ctx.fx.currentTable();
  if (table === null || fxTableState(table.asOf, ctx.now()) !== "fresh") return null;
  return fxQuoteFromTable(table, "JPY", currency);
}

interface CompensationContext {
  order: Order;
  current: Order;
  sale: OrderSale;
  fx: FxQuote | null;
  alreadyDeducted: boolean;
}

/** 被投诉供应商那一行、这一单现在那一行、对外价、它结算币种到客人币种的快照汇率、违约金有没有按救援记过。 */
async function compensationContext(db: Db, ticket: Ticket, lock: boolean): Promise<CompensationContext> {
  const current = await findOrderForPlatform(db, ticket.orderId, { lock });
  const sale = await findSale(db, ticket.orderId);
  const order = current !== null && current.tenantId === ticket.tenantId ? current : await findOrderOfTenant(db, ticket.tenantId, ticket.orderId, { lock });
  if (current === null || sale === null || order === null) throw notFound("订单");
  let fx: FxQuote | null = sale.supplierTenantId === order.tenantId ? sale.fx : null;
  if (sale.supplierTenantId !== order.tenantId) {
    const rescue = (await db.query<{ original_fx: FxQuote | null }>("select original_fx from order_rescues where order_id = $1 and original_tenant_id = $2 order by triggered_at desc limit 1", [order.id, order.tenantId])).rows[0];
    fx = rescue?.original_fx ?? null;
  }
  const penalty = await db.query("select 1 from tenant_deductions where tenant_id = $1 and order_id = $2 and kind = 'penalty'", [order.tenantId, order.id]);
  return { order, current, sale, fx, alreadyDeducted: (penalty.rowCount ?? 0) > 0 };
}

const INPUT_PATHS: Readonly<Record<CompensationInputIssue, string>> = {
  DOWNGRADE_DIFFERENCE_REQUIRED: "/compensation/downgrade_settlement_difference",
  DOWNGRADE_DIFFERENCE_NOT_ALLOWED: "/compensation/downgrade_settlement_difference",
  REIMBURSEMENT_NOT_ALLOWED: "/compensation/reimbursement_amount",
  AMOUNT_INVALID: "/compensation",
};
const INPUT_MESSAGES: Readonly<Record<CompensationInputIssue, string>> = {
  DOWNGRADE_DIFFERENCE_REQUIRED: "车型降级要填两个车型组的结算价之差（大于 0）",
  DOWNGRADE_DIFFERENCE_NOT_ALLOWED: "只有车型降级要填差价",
  REIMBURSEMENT_NOT_ALLOWED: "只有司机未到可以报销替代交通",
  AMOUNT_INVALID: "金额要是最小货币单位的非负整数",
};

function compensationInputInvalid(issue: CompensationInputIssue): AppError {
  return validationFailed("body", [{ path: INPUT_PATHS[issue], reason: issue, message: INPUT_MESSAGES[issue] }]);
}

function notApplicable(reason: string, message: string, status: string): AppError {
  return new AppError(409, "COMPENSATION_NOT_APPLICABLE", message, { reason, status });
}

/**
 * 按赔付表算这一笔（不写任何东西）。司机未到：这一单还没服务、能取消（或已经取消了）才适用；其余情形：被投诉的就是这一单现在的供应商，
 * 而且已经开始服务（服务中、已完成）。
 */
async function computeCompensation(db: Db, ticket: Ticket, request: CompensationRequest, minimumFx: FxQuote | null, lock = true): Promise<{ amounts: CompensationAmounts; context: CompensationContext; minimumFx: FxQuote | null; willCancel: boolean }> {
  // 先看填的对不对得上情形（400），再看这一单适不适用（409）
  const inputIssues = compensationInputIssues({ scenario: request.scenario, downgradeSettlementDifferenceMinor: request.downgradeSettlementDifferenceMinor, reimbursementClaimedMinor: request.reimbursementClaimedMinor });
  if (inputIssues.length > 0) throw compensationInputInvalid(inputIssues[0] as CompensationInputIssue);
  const context = await compensationContext(db, ticket, lock);
  const { order, current, sale } = context;
  const rules = COMPENSATION_SCENARIO_RULES[request.scenario];
  let willCancel = false;
  if (rules.fullRefund) {
    const cancellable = (CANCELLABLE_STATUSES as readonly string[]).includes(current.status) && current.status !== "pending_payment";
    if (current.status !== "cancelled" && !(cancellable && current.tenantId === ticket.tenantId)) {
      throw notApplicable("ORDER_SERVED", "这一单已经开始服务或改派给别的供应商服务了，不适用「司机未到」", current.status);
    }
    willCancel = current.status !== "cancelled";
  } else {
    if (current.tenantId !== ticket.tenantId) throw notApplicable("NOT_CURRENT_SUPPLIER", "这一单已经改派给别的供应商，只能按「司机未到」投诉原来的供应商", current.status);
    if (current.status !== "in_service" && current.status !== "completed") throw notApplicable("NOT_SERVED", "这一单还没有开始服务，不适用这一项赔付", current.status);
  }
  const table = await currentCompensationTable(db);
  const minimumMinor = minimumCompensationMinor(table, sale.currency, minimumFx);
  if (minimumMinor === null) throw new AppError(409, "FX_RATE_UNAVAILABLE", "客人付的不是日元，换算「每笔至少等值 ¥500」需要汇率中心有 48 小时内的汇率", { currency: sale.currency });
  // 司机未到要先按「供应商原因」取消：取消会把这一单还没退的全部退回，赔付这里就不再退
  const refundable = willCancel ? 0 : await netPaidMinor(db, order.id);
  const outcome = compensationAmounts(
    {
      scenario: request.scenario,
      liable: request.liableParty,
      currency: sale.currency,
      sellMinor: sale.sellMinor,
      settlementMinor: order.settlementMinor,
      settlementCurrency: order.settlementCurrency,
      markupBp: sale.markupBp,
      fxBufferBp: sale.fxBufferBp,
      fx: context.fx,
      minimumMinor,
      downgradeSettlementDifferenceMinor: request.downgradeSettlementDifferenceMinor,
      reimbursementClaimedMinor: request.reimbursementClaimedMinor,
      refundableMinor: refundable,
      settlementShareAlreadyDeducted: rules.fullRefund && context.alreadyDeducted,
    },
    table,
  );
  if (!outcome.ok) {
    if (outcome.reason === "FX_RATE_UNAVAILABLE") throw new AppError(409, "FX_RATE_UNAVAILABLE", "这一单的报价快照里没有对得上的汇率，算不出客人那边的金额", {});
    throw compensationInputInvalid(outcome.reason);
  }
  return { amounts: outcome.amounts, context, minimumFx, willCancel };
}

/** 试算（`ticket.manage`）：按赔付表带出这一笔的金额，不写任何东西（「投诉成立时自动带出金额」）。 */
export async function previewCompensation(ctx: AppContext, id: string, request: CompensationRequest): Promise<{ amounts: CompensationAmounts; willCancel: boolean; minimumFx: FxQuote | null }> {
  const currency = await withPlatformTx(ctx.pool, async (db) => {
    const ticket = await findTicket(db, id);
    if (ticket === null) throw notFound("工单");
    return (await findSale(db, ticket.orderId))?.currency ?? "JPY";
  });
  const minimumFx = await minimumFxFor(ctx, currency);
  return withPlatformTx(
    ctx.pool,
    async (db) => {
      const ticket = (await findTicket(db, id)) as Ticket;
      if (ticket.type !== "complaint" && ticket.type !== "fulfilment_failure") throw new AppError(409, "COMPENSATION_NOT_APPLICABLE", "只有投诉、履约失败有赔付", { reason: "TICKET_TYPE", status: ticket.status });
      const computed = await computeCompensation(db, ticket, request, minimumFx, false);
      return { amounts: computed.amounts, willCancel: computed.willCancel, minimumFx: computed.minimumFx };
    },
    { snapshot: true },
  );
}

/** 复核记录里存的判定（接口的写法），批准时按它执行。 */
function decisionPayload(ticket: Ticket, input: DecisionInput, minimumFx: FxQuote | null, amounts: CompensationAmounts | null): AuditValues {
  const c = input.compensation;
  return {
    ticket_id: ticket.id,
    ticket_no: ticket.ticketNo,
    tenant_id: ticket.tenantId,
    outcome: input.outcome,
    note: input.note,
    driver_absent: input.driverAbsent,
    compensation:
      c === null
        ? null
        : { scenario: c.scenario, liable_party: c.liableParty, downgrade_settlement_difference_minor: c.downgradeSettlementDifferenceMinor, reimbursement_claimed_minor: c.reimbursementClaimedMinor, major: c.major },
    minimum_fx: minimumFx === null ? null : { from: minimumFx.from, to: minimumFx.to, rate: minimumFx.rate, as_of: minimumFx.asOf },
    customer_compensation_minor: amounts?.customer.compensationMinor ?? null,
    customer_refund_minor: amounts?.customer.refundMinor ?? null,
    customer_manual_payout_minor: amounts?.customer.manualPayoutMinor ?? null,
    currency: amounts?.customer.currency ?? null,
    table_version: amounts?.tableVersion ?? null,
  };
}

function inputFromPayload(payload: AuditValues): { input: DecisionInput; minimumFx: FxQuote | null } {
  const c = payload["compensation"] as Record<string, unknown> | null;
  const fx = payload["minimum_fx"] as Record<string, string> | null;
  return {
    input: {
      outcome: payload["outcome"] as TicketOutcome,
      note: payload["note"] as string,
      driverAbsent: payload["driver_absent"] === true,
      compensation:
        c === null
          ? null
          : {
              scenario: c["scenario"] as CompensationScenario,
              liableParty: c["liable_party"] as LiableParty,
              downgradeSettlementDifferenceMinor: (c["downgrade_settlement_difference_minor"] as number | null) ?? null,
              reimbursementClaimedMinor: (c["reimbursement_claimed_minor"] as number | null) ?? null,
              major: c["major"] === true,
            },
    },
    minimumFx: fx === null ? null : { from: fx["from"] as CurrencyCode, to: fx["to"] as CurrencyCode, rate: fx["rate"] as string, asOf: fx["as_of"] as string },
  };
}

/** 执行赔付：（司机未到）按供应商原因取消订单；从收款里退；记赔付记录、供应商应扣款项、履约事件。返回排好的退款和记下的事件。 */
async function executeCompensation(db: Db, ticket: Ticket, input: DecisionInput, computed: Awaited<ReturnType<typeof computeCompensation>>, origin: AuditOrigin, now: Date): Promise<{ refunds: OrderRefund[]; events: string[] }> {
  const request = input.compensation as CompensationRequest;
  const { amounts, context } = computed;
  const refunds: OrderRefund[] = [];
  if (computed.willCancel) {
    const cancelled = await cancelPaidOrderInTx(db, context.current, context.sale, { reason: "SUPPLIER_FAULT", waiveFee: false, note: `工单 ${ticket.ticketNo}：司机未到` }, { actor: "platform_user", origin }, now);
    refunds.push(...cancelled.refunds);
  }
  if (amounts.customer.refundMinor > 0) {
    refunds.push(...(await scheduleRefund(db, context.current, "compensation", amounts.customer.refundMinor, null, now, ticket.id)));
  }
  await insertTicketCompensation(
    db,
    {
      ticketId: ticket.id,
      orderId: ticket.orderId,
      supplierTenantId: ticket.tenantId,
      scenario: amounts.scenario,
      liableParty: amounts.liable,
      tableVersion: amounts.tableVersion,
      customerBp: amounts.customerBp,
      currency: amounts.customer.currency,
      sellMinor: context.sale.sellMinor,
      ratioMinor: amounts.customer.ratioMinor,
      downgradeDifferenceMinor: amounts.customer.downgradeDifferenceMinor,
      minimumMinor: amounts.customer.minimumMinor,
      minimumFx: computed.minimumFx === null ? null : { from: computed.minimumFx.from, to: computed.minimumFx.to, rate: computed.minimumFx.rate, as_of: computed.minimumFx.asOf },
      toppedUp: amounts.customer.toppedUp,
      compensationMinor: amounts.customer.compensationMinor,
      reimbursementClaimedMinor: amounts.customer.reimbursementClaimedMinor,
      reimbursementCapMinor: amounts.customer.reimbursementCapMinor,
      reimbursementMinor: amounts.customer.reimbursementMinor,
      refundMinor: amounts.customer.refundMinor,
      manualPayoutMinor: amounts.customer.manualPayoutMinor,
      orderCancelled: computed.willCancel,
      tenantCurrency: amounts.tenant.currency,
      tenantTotalMinor: amounts.tenant.totalMinor,
    },
    now,
  );
  // 供应商承担的（结算币种）：结算价 × 同一比例 + 车型降级的差价，记一条「赔付」；报销记一条「报销」。依据里只有结算币种的数（规则 4）
  const share = amounts.tenant.ratioMinor + amounts.tenant.downgradeDifferenceMinor;
  if (amounts.liable === "tenant" && share > 0) {
    await insertDeduction(db, {
      tenantId: ticket.tenantId,
      orderId: ticket.orderId,
      rescueId: null,
      ticketId: ticket.id,
      kind: "compensation",
      amountMinor: share,
      currency: amounts.tenant.currency,
      basis: { ticket_no: ticket.ticketNo, scenario: amounts.scenario, bp: amounts.customerBp, settlement_minor: context.order.settlementMinor, ratio_minor: amounts.tenant.ratioMinor, downgrade_settlement_difference_minor: amounts.tenant.downgradeDifferenceMinor, table_version: amounts.tableVersion },
      waived: null,
      now,
    });
  }
  if (amounts.liable === "tenant" && amounts.tenant.reimbursementMinor > 0) {
    await insertDeduction(db, {
      tenantId: ticket.tenantId,
      orderId: ticket.orderId,
      rescueId: null,
      ticketId: ticket.id,
      kind: "reimbursement",
      amountMinor: amounts.tenant.reimbursementMinor,
      currency: amounts.tenant.currency,
      basis: { ticket_no: ticket.ticketNo, scenario: amounts.scenario, same_currency: amounts.customer.currency === amounts.tenant.currency },
      waived: null,
      now,
    });
  }
  // 评分输入：投诉成立（重大与否）、司机未到 / 重大迟到计一次履约失败——只在责任在供应商时
  const events: string[] = [];
  if (amounts.liable === "tenant") {
    const occurredAt = context.order.serviceAt;
    if (ticket.type === "complaint" && (await recordPerformanceEvent(db, { tenantId: ticket.tenantId, orderId: ticket.orderId, kind: "complaint", major: request.major, occurredAt, now }))) events.push("complaint");
    const failureType = COMPENSATION_SCENARIO_RULES[amounts.scenario].failureType;
    if (failureType !== null && (await recordPerformanceEvent(db, { tenantId: ticket.tenantId, orderId: ticket.orderId, kind: "failure", failureType, occurredAt, now }))) events.push(`failure:${failureType}`);
  }
  return { refunds, events };
}

/**
 * no-show 审核：通过 → 订单「客人未出现」，客人全额付费、供应商拿 100% 结算价（钱已经收了，不动）；
 * 驳回 → 按未履约：订单取消、客人全额退款、供应商拿 0（「供应商原因」），计一次履约失败（证据显示司机没到场的按「司机未到」）。
 */
async function executeNoShow(db: Db, ticket: Ticket, input: DecisionInput, origin: AuditOrigin, now: Date): Promise<{ refunds: OrderRefund[]; events: string[] }> {
  const order = await findOrderOfTenant(db, ticket.tenantId, ticket.orderId, { lock: true });
  if (order === null) throw notFound("订单");
  if (order.status !== "no_show_claimed") throw new AppError(409, "ORDER_STATE_INVALID", "这一单不在「客人未出现（待审核）」", { status: order.status, action: "no_show_review" });
  await db.query("update order_no_show_claims set status = $3, decided_at = $4, decided_by = $5 where tenant_id = $1 and order_id = $2 and status = 'pending_review'", [
    order.tenantId, order.id, input.outcome === "approved" ? "approved" : "rejected", now, origin.actor.id,
  ]);
  if (input.outcome === "approved") {
    await updateOrderStatus(db, order, { status: "no_show" }, now);
    await recordStatusChange(db, order, "no_show", { type: "platform_user", detail: { ticket_no: ticket.ticketNo, by: origin.actor.email } }, "NO_SHOW_APPROVED", now);
    return { refunds: [], events: [] };
  }
  const sale = await findSale(db, order.id);
  if (sale === null) throw notFound("订单");
  const cancelled = await cancelPaidOrderInTx(db, order, sale, { reason: "SUPPLIER_FAULT", waiveFee: false, note: `工单 ${ticket.ticketNo}：no-show 审核驳回` }, { actor: "platform_user", origin }, now, { fromNoShowReview: true });
  const failureType = input.driverAbsent ? "driver_no_show" : "no_show_rejected";
  const recorded = await recordPerformanceEvent(db, { tenantId: order.tenantId, orderId: order.id, kind: "failure", failureType, occurredAt: order.serviceAt, now });
  return { refunds: cancelled.refunds, events: recorded ? [`failure:${failureType}`] : [] };
}

/**
 * 申诉：由另一人复核（判定原工单的人、复核过原工单的人都不能判它的申诉）。成立 → 撤销处罚：原工单记下的应扣款项全部免除、记下的履约事件撤销；
 * 已经退给客人的钱不收回（客人不受影响），供应商因此少拿的（如 no-show 被驳回）在结算时按工单手工调账（财务任务）。
 */
async function executeAppeal(db: Db, ticket: Ticket, input: DecisionInput, origin: AuditOrigin, now: Date): Promise<{ refunds: OrderRefund[]; events: string[] }> {
  const parent = await findTicket(db, ticket.parentTicketId as string, { lock: true });
  if (parent === null) throw notFound("工单");
  const reviewers = new Set([parent.decidedBy]);
  if (parent.approvalId !== null) {
    const approval = await findApproval(db, parent.approvalId);
    if (approval?.decidedBy) reviewers.add(approval.decidedBy.id);
  }
  if (reviewers.has(origin.actor.id)) throw new AppError(409, "APPEAL_SAME_REVIEWER", "申诉要由另一人复核：判定或复核过原工单的人不能判它的申诉");
  if (input.outcome !== "upheld") return { refunds: [], events: [] };
  const reason = `申诉成立（工单 ${ticket.ticketNo}）`;
  await waiveTicketDeductions(db, parent.tenantId, parent.id, reason, now);
  for (const event of parent.recordedEvents) {
    const [kind, failureType] = event.split(":") as ["complaint" | "failure", string | undefined];
    await deletePerformanceEvent(db, parent.tenantId, parent.orderId, kind, failureType ?? null);
  }
  await mustUpdate(db, parent, { recordedEvents: [] }, now);
  return { refunds: [], events: [] };
}

export type DecideResult = { kind: "decided"; ticket: Ticket } | { kind: "pending_review"; ticket: Ticket; approval: Approval };

/** 判定的执行（在调用方的事务里，工单已锁）：赔付 / no-show / 申诉 / 其他，写工单的结论和审计。 */
async function applyDecision(db: Db, ticket: Ticket, input: DecisionInput, computed: Awaited<ReturnType<typeof computeCompensation>> | null, origin: AuditOrigin, decidedBy: string, now: Date): Promise<{ ticket: Ticket; refunds: OrderRefund[] }> {
  let result: { refunds: OrderRefund[]; events: string[] } = { refunds: [], events: [] };
  if (computed !== null) result = await executeCompensation(db, ticket, input, computed, origin, now);
  else if (ticket.type === "no_show_review") result = await executeNoShow(db, ticket, input, origin, now);
  else if (ticket.type === "tenant_appeal") result = await executeAppeal(db, ticket, input, origin, now);
  const updated = await mustUpdate(
    db,
    ticket,
    {
      status: "decided",
      outcome: input.outcome,
      liableParty: input.compensation?.liableParty ?? null,
      decisionNote: input.note,
      decidedAt: now,
      decidedBy,
      recordedEvents: result.events,
      firstRespondedAt: ticket.firstRespondedAt ?? now,
    },
    now,
  );
  await auditTicket(db, origin, updated, "decide", ticketAudit(ticket), {
    ...ticketAudit(updated),
    note: input.note,
    scenario: computed?.amounts.scenario ?? null,
    customer_compensation_minor: computed?.amounts.customer.compensationMinor ?? null,
    customer_refund_minor: computed?.amounts.customer.refundMinor ?? null,
    customer_manual_payout_minor: computed?.amounts.customer.manualPayoutMinor ?? null,
    tenant_total_minor: computed?.amounts.tenant.totalMinor ?? null,
    refund_ids: result.refunds.map((refund) => refund.id),
    recorded_events: result.events,
  });
  return { ticket: updated, refunds: result.refunds };
}

/**
 * 判定（`ticket.manage`）。投诉 / 履约失败成立要带赔付（按赔付表自动算出金额）；赔给客人的钱达到阈值的，进双人复核（`ticket.review`），
 * 工单变成「判定待复核」，批准时按发起时的内容执行（金额和发起时算的不一样了就 `APPROVAL_STALE`）。
 */
export async function decideTicket(ctx: AppContext, principal: PlatformPrincipal, id: string, input: DecisionInput, ip: string, log: OrderLog = SILENT_ORDER_LOG): Promise<DecideResult> {
  const now = ctx.now();
  const origin = consoleOrigin(platformActor(principal.user), ip, now);
  // 汇率中心的汇率在事务之外取（有缓存）；只有赔付要用
  const peek = await withPlatformTx(ctx.pool, async (db) => {
    const ticket = await findTicket(db, id);
    if (ticket === null) throw notFound("工单");
    const sale = await findSale(db, ticket.orderId);
    return sale?.currency ?? "JPY";
  });
  const minimumFx = input.compensation === null ? null : await minimumFxFor(ctx, peek);
  const outcome = await withPlatformTx(ctx.pool, async (db): Promise<{ result: DecideResult; refunds: OrderRefund[] }> => {
    const ticket = await lockTicket(db, id);
    const refusal = ticketDecisionRefusal(ticket, input.outcome, now);
    if (refusal === "TICKET_STATE_INVALID") throw ticketStateInvalid(ticket, "decide");
    if (refusal === "OUTCOME_NOT_ALLOWED") throw validationFailed("body", [{ path: "/outcome", reason: refusal, message: "这一类工单不能选这个结论" }]);
    if (refusal === "TENANT_REPLY_PENDING") throw new AppError(409, "TENANT_REPLY_PENDING", "还在等供应商回复（24 小时内），到期没回复视为认可后再判定", { tenant_reply_due_at: (ticket.tenantReplyDueAt as Date).toISOString() });
    const needsCompensation = outcomeNeedsCompensation(ticket.type, input.outcome);
    if (needsCompensation !== (input.compensation !== null)) {
      throw validationFailed("body", [{ path: "/compensation", reason: needsCompensation ? "REQUIRED" : "NOT_ALLOWED", message: needsCompensation ? "投诉、履约失败成立要选赔付情形和责任方" : "只有投诉、履约失败成立时才有赔付" }]);
    }
    if (ticket.type !== "no_show_review" && input.driverAbsent) throw validationFailed("body", [{ path: "/driver_absent", message: "只有 no-show 驳回时可以选" }]);
    const computed = input.compensation === null ? null : await computeCompensation(db, ticket, input.compensation, minimumFx);
    if (computed !== null && computed.amounts.needsReview) {
      const approval = await requestApproval(db, origin, principal, {
        kind: TICKET_DECISION,
        resourceId: ticket.id,
        summary: `工单 ${ticket.ticketNo} 判定成立：赔给客人 ${computed.amounts.customer.compensationMinor + computed.amounts.customer.reimbursementMinor} ${computed.amounts.customer.currency}（最小单位），达到复核阈值`,
        payload: decisionPayload(ticket, input, computed.minimumFx, computed.amounts),
        before: ticketAudit(ticket),
        baseVersion: ticket.version + 1,
        note: input.note,
      });
      const pending = await mustUpdate(db, ticket, { status: "pending_review", approvalId: approval.id, firstRespondedAt: ticket.firstRespondedAt ?? now }, now);
      return { result: { kind: "pending_review", ticket: pending, approval }, refunds: [] };
    }
    const applied = await applyDecision(db, ticket, input, computed, origin, principal.user.id, now);
    return { result: { kind: "decided", ticket: applied.ticket }, refunds: applied.refunds };
  });
  await processRefunds(ctx, outcome.refunds, log);
  return outcome.result;
}

/** 判定的双人复核：批准时在批准的事务里按发起时的内容执行；工单之后被改过、算出来的金额和发起时不一样 → `APPROVAL_STALE`。驳回 → 工单退回处理中。 */
export const TICKET_DECISION: ApprovalKind = {
  kind: "ticket.decision",
  resource: "ticket",
  readAction: "ticket.read",
  requestAction: "ticket.manage",
  reviewAction: "ticket.review",
  async apply(db, approval, origin) {
    const ticket = await lockTicket(db, approval.resourceId);
    if (ticket.status !== "pending_review" || ticket.approvalId !== approval.id || ticket.version !== approval.baseVersion) {
      throw new AppError(409, "APPROVAL_STALE", "发起这条复核之后工单已经变了；请驳回，再按现在的情况重新判定", { status: ticket.status });
    }
    const { input, minimumFx } = inputFromPayload(approval.payload);
    const computed = input.compensation === null ? null : await computeCompensation(db, ticket, input.compensation, minimumFx);
    if (computed !== null && (computed.amounts.customer.compensationMinor !== approval.payload["customer_compensation_minor"] || computed.amounts.customer.refundMinor !== approval.payload["customer_refund_minor"])) {
      throw new AppError(409, "APPROVAL_STALE", "按现在的数据算出来的赔付和发起时不一样（这一单的收款或退款变了）；请驳回后重新判定");
    }
    await applyDecision(db, ticket, input, computed, origin, approval.requestedBy.id, origin.occurredAt);
  },
  async afterApply(ctx, approval) {
    const ticket = await withPlatformTx(ctx.pool, (db) => findTicket(db, approval.resourceId));
    if (ticket === null) return;
    const refunds = await withPlatformTx(ctx.pool, (db) => listOrderRefunds(db, ticket.orderId));
    await processRefunds(ctx, refunds.filter((refund) => refund.status === "pending" && (refund.ticketId === ticket.id || refund.purpose === "cancellation")), SILENT_ORDER_LOG);
  },
  /** 复核被驳回、撤回：工单退回处理中，可以重新判定。 */
  async onDismiss(db, approval, now) {
    const ticket = await findTicket(db, approval.resourceId, { lock: true });
    if (ticket === null || ticket.status !== "pending_review" || ticket.approvalId !== approval.id) return;
    await mustUpdate(db, ticket, { status: "in_progress", approvalId: null }, now);
  },
};

export const TICKET_APPROVAL_KINDS: readonly ApprovalKind[] = [TICKET_DECISION];

// ---- 关闭、另付 ----

/** 关闭（`ticket.manage`）：判定过的；或没判定的直接关（重复、撤回，说明必填），no-show 审核除外。 */
export async function closeTicket(ctx: AppContext, principal: PlatformPrincipal, id: string, note: string, ip: string): Promise<Ticket> {
  const now = ctx.now();
  const origin = consoleOrigin(platformActor(principal.user), ip, now);
  return withPlatformTx(ctx.pool, async (db) => {
    const ticket = await lockTicket(db, id);
    const refusal = ticketCloseRefusal(ticket);
    if (refusal === "TICKET_STATE_INVALID") throw ticketStateInvalid(ticket, "close");
    if (refusal === "DECISION_REQUIRED") throw new AppError(409, "DECISION_REQUIRED", "no-show 审核要先判定（通过或驳回），订单才不会一直卡在待审核");
    const updated = await mustUpdate(db, ticket, { status: "closed", closedAt: now, closedBy: principal.user.id, closeNote: note }, now);
    await auditTicket(db, origin, updated, "close", ticketAudit(ticket), { ...ticketAudit(updated), note });
    return updated;
  });
}

/** 登记另付已付（`payment.manage`）：赔付里退不回卡上的部分（报销、超过还能退的），财务付完后登记凭证号。 */
export async function markCompensationPaid(ctx: AppContext, principal: PlatformPrincipal, id: string, reference: string, ip: string): Promise<TicketCompensation> {
  const now = ctx.now();
  const origin = consoleOrigin(platformActor(principal.user), ip, now);
  return withPlatformTx(ctx.pool, async (db) => {
    const ticket = await lockTicket(db, id);
    const before = await findTicketCompensation(db, ticket.id, { lock: true });
    if (before === null) throw notFound("赔付");
    if (before.payoutStatus !== "pending") throw new AppError(409, "PAYOUT_STATE_INVALID", before.payoutStatus === "paid" ? "已经登记过了" : "这一笔赔付全部从收款里退，不用另付", { payout_status: before.payoutStatus });
    const paid = (await markPayoutPaid(db, ticket.id, { reference, paidBy: principal.user.id, now })) as TicketCompensation;
    await auditTicket(db, origin, ticket, "pay", { payout_status: before.payoutStatus }, { payout_status: "paid", reference, amount_minor: paid.manualPayoutMinor, currency: paid.currency });
    return paid;
  });
}
