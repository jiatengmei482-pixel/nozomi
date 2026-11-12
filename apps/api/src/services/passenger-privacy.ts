/**
 * 运营看乘客的完整联系方式和手写内容原文（M4-19，ADR 0052；M4-21，ADR 0055；需求《平台运营端》「个人信息保护」：默认打码，点「查看」才显示全文并记日志）。
 * 权限和数据范围由接口层检查（`order.read`、`assertPlatformOrderInScope`）。审计只记看了谁的、哪些字段、几条，不记内容本身。
 * 工单的文字另要 `ticket.read`，复核的文字另要能看那一类复核：`order.read` 不能绕过这两个权限。
 */
import { type PassengerContact, type RiderJson, grantCan, isOrderApproval, isOrderAudit, maskOrderValues, riderJson } from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { type Db, withPlatformTx } from "../db/context.ts";
import type { Approval } from "../repos/approvals.ts";
import { type AuditLog, auditPassengerNames as namesOfAudit, insertAuditLog } from "../repos/audit-logs.ts";
import { findOrderForPlatform } from "../repos/orders.ts";
import { type HandwrittenText, listOrderHandwriting, listPassengerNames } from "../repos/passenger-texts.ts";
import { APPROVAL_KINDS } from "./approval-kinds.ts";
import { visibleKinds } from "./approvals.ts";
import { consoleOrigin, platformActor } from "./audit.ts";
import { notFound } from "./errors.ts";
import type { PlatformPrincipal } from "./platform-auth.ts";

export interface RevealedPassenger {
  passenger: PassengerContact;
  /** 乘车人和举牌姓名的原文（M8-32）；没有为 null */
  rider: RiderJson | null;
  messaging: { app: string; handle: string } | null;
  notes: string | null;
  anonymized_at: string | null;
  texts: { source: string; source_id: string | null; text: string }[];
}

export async function revealPassenger(ctx: AppContext, principal: PlatformPrincipal, orderId: string, ip: string): Promise<RevealedPassenger> {
  return withPlatformTx(ctx.pool, async (db) => {
    const order = await findOrderForPlatform(db, orderId);
    if (order === null) throw notFound("订单");
    const allowed: { tickets: boolean; approvalKinds: readonly string[] } = { tickets: grantCan(principal.grant, "ticket.read"), approvalKinds: grantCan(principal.grant, "approval.read") ? visibleKinds(APPROVAL_KINDS, principal) : [] };
    const written = await listOrderHandwriting(db, orderId, allowed);
    const name = order.passenger.name;
    const names = (await listPassengerNames(db, [orderId])).get(orderId) ?? [];
    const anonymized = order.passengerAnonymizedAt !== null;
    // 只给确实被打了码的：没有联系方式的文字打码前后一样，页面上本来就是全文。改单的前后值另算：里面的即时通讯账号在详情里是打码的，文字规则认不出。
    // 脱敏后不再给任何原文（ADR 0055）：手写内容已经清过，这里再挡一道
    const texts = (anonymized ? [] : written).filter((entry: HandwrittenText) => entry.source === "change_before" || entry.source === "change_after" || maskOrderValues({ note: entry.text }, names).note !== entry.text).map((entry) => ({ source: entry.source, source_id: entry.sourceId, text: entry.text }));
    await insertAuditLog(db, consoleOrigin(platformActor(principal.user), ip, ctx.now()), { tenantId: null, resource: "order", resourceId: orderId, action: "view_passenger", before: null, after: { order_no: order.orderNo, fields: ["name", "phone", "email", "messaging", "notes", ...(riderJson(order.passenger) === null || anonymized ? [] : ["rider"])], text_count: texts.length, text_sources: [...new Set(texts.map((entry) => entry.source))] } });
    return {
      passenger: { name, phone: order.passenger.phone, email: order.passenger.email },
      rider: anonymized ? null : riderJson(order.passenger),
      messaging: anonymized ? null : order.messaging,
      notes: order.notes,
      anonymized_at: order.passengerAnonymizedAt?.toISOString() ?? null,
      texts,
    };
  });
}

/** 工单详情打码要用的：这单用过的姓名、脱敏了没有。脱敏过的单不再给任何原文，页面上也就没有「查看原文」（ADR 0055、0056）。 */
export async function orderMaskingInput(ctx: AppContext, orderId: string): Promise<{ names: string[]; anonymized: boolean }> {
  return withPlatformTx(
    ctx.pool,
    async (db) => {
      const order = await findOrderForPlatform(db, orderId);
      return { names: (await listPassengerNames(db, [orderId])).get(orderId) ?? [], anonymized: order?.passengerAnonymizedAt != null };
    },
    { snapshot: true },
  );
}

/**
 * 看一张工单被打码的文字（ADR 0056）：只给这些文字，不给联系方式；审计写明看的是工单文字。
 * 没有打码内容的（页面过期、直接调接口）什么都不给，也不记审计。
 */
export async function revealTicketTexts(ctx: AppContext, principal: PlatformPrincipal, ticket: { id: string; ticketNo: string; orderId: string; orderNo: string }, texts: readonly { source: string; text: string }[], ip: string): Promise<{ texts: { source: string; source_id: string; text: string }[] }> {
  if (texts.length === 0) return { texts: [] };
  return withPlatformTx(ctx.pool, async (db) => {
    const order = await findOrderForPlatform(db, ticket.orderId);
    if (order === null || order.passengerAnonymizedAt !== null) return { texts: [] };
    await insertAuditLog(db, consoleOrigin(platformActor(principal.user), ip, ctx.now()), { tenantId: null, resource: "order", resourceId: ticket.orderId, action: "view_ticket_text", before: null, after: { order_no: ticket.orderNo, ticket_id: ticket.id, ticket_no: ticket.ticketNo, viewed: "ticket_text", text_count: texts.length, text_sources: [...new Set(texts.map((entry) => entry.source))] } });
    return { texts: texts.map((entry) => ({ source: entry.source, source_id: ticket.id, text: entry.text })) };
  });
}

/** 这几单用过的乘客姓名（手写内容打码用，改单前的旧姓名也算）；脱敏过的没有。 */
export async function orderPassengerNames(ctx: AppContext, orderIds: readonly string[]): Promise<Map<string, string[]>> {
  if (orderIds.length === 0) return new Map();
  return withPlatformTx(ctx.pool, (db) => listPassengerNames(db, [...new Set(orderIds)]), { snapshot: true });
}

/** 和订单有关的复核对应的乘客姓名：键是复核编号。 */
export async function approvalPassengerNames(ctx: AppContext, approvals: readonly Approval[]): Promise<Map<string, string[]>> {
  const related = approvals.filter(isOrderApproval);
  if (related.length === 0) return new Map();
  return withPlatformTx(
    ctx.pool,
    async (db) => {
      const rows = await db.query<{ approval_id: string; order_id: string }>(
        `select v.id as approval_id, case v.resource
             when 'order' then v.resource_id::uuid
             when 'ticket' then (select t.order_id from tickets t where t.id = v.resource_id::uuid limit 1)
             else (select r.order_id from order_rescues r where r.id = v.resource_id::uuid limit 1) end as order_id
           from unnest($1::text[], $2::text[], $3::text[]) as v (id, resource, resource_id)`,
        [related.map((item) => item.id), related.map((item) => item.resource), related.map((item) => item.resourceId)],
      );
      const names = await listPassengerNames(db, rows.rows.flatMap((row) => row.order_id ?? []));
      return new Map(rows.rows.map((row) => [row.approval_id, names.get(row.order_id) ?? []]));
    },
    { snapshot: true },
  );
}

/** 审计日志对应的乘客姓名：键是审计的编号。旧记录查不到姓名的，电话、邮箱照样打码。 */
export async function auditPassengerNames(db: Db, logs: readonly AuditLog[]): Promise<Map<string, string[]>> {
  const names = new Map<string, string[]>();
  for (const log of logs.filter(isOrderAudit)) names.set(log.id, await namesOfAudit(db, log));
  return names;
}

/** 接口读取时再打一次码，兜住这个任务之前写入的旧记录（ADR 0055）；新记录写入时已经打过，再打一次结果不变。 */
export function maskedAuditLog(log: AuditLog, names: ReadonlyMap<string, readonly string[]>): AuditLog {
  if (!isOrderAudit(log)) return log;
  return { ...log, ...maskOrderValues({ before: log.before, after: log.after }, names.get(log.id) ?? null) };
}
