/**
 * 运营看乘客的完整联系方式和手写内容原文（M4-19，ADR 0052；M4-21，ADR 0055；需求《平台运营端》「个人信息保护」：默认打码，点「查看」才显示全文并记日志）。
 * 权限和数据范围由接口层检查（`order.read`、`assertPlatformOrderInScope`）。审计只记看了谁的、哪些字段、几条，不记内容本身。
 * 工单的文字另要 `ticket.read`，复核的文字另要能看那一类复核：`order.read` 不能绕过这两个权限。
 */
import { type PassengerContact, grantCan, isOrderApproval, isOrderAudit, maskContactsInText, maskOrderValues } from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { type Db, withPlatformTx } from "../db/context.ts";
import type { Approval } from "../repos/approvals.ts";
import { type AuditLog, auditOrderId, insertAuditLog } from "../repos/audit-logs.ts";
import { findOrderForPlatform } from "../repos/orders.ts";
import { type HandwrittenText, listOrderHandwriting, listPassengerNames } from "../repos/passenger-texts.ts";
import { APPROVAL_KINDS } from "./approval-kinds.ts";
import { visibleKinds } from "./approvals.ts";
import { consoleOrigin, platformActor } from "./audit.ts";
import { notFound } from "./errors.ts";
import type { PlatformPrincipal } from "./platform-auth.ts";

export interface RevealedPassenger {
  passenger: PassengerContact;
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
    // 只给确实被打了码的：没有联系方式的文字打码前后一样，页面上本来就是全文。改单的前后值另算：里面的即时通讯账号在详情里是打码的，文字规则认不出
    const texts = written.filter((entry: HandwrittenText) => entry.source === "change_before" || entry.source === "change_after" || maskContactsInText(entry.text, name) !== entry.text).map((entry) => ({ source: entry.source, source_id: entry.sourceId, text: entry.text }));
    await insertAuditLog(db, consoleOrigin(platformActor(principal.user), ip, ctx.now()), { tenantId: null, resource: "order", resourceId: orderId, action: "view_passenger", before: null, after: { order_no: order.orderNo, fields: ["name", "phone", "email", "messaging", "notes"], text_count: texts.length, text_sources: [...new Set(texts.map((entry) => entry.source))] } });
    return {
      passenger: { name, phone: order.passenger.phone, email: order.passenger.email },
      messaging: order.messaging,
      notes: order.notes,
      anonymized_at: order.passengerAnonymizedAt?.toISOString() ?? null,
      texts,
    };
  });
}

/** 这几单现在的乘客姓名（手写内容打码用）；脱敏过的没有。 */
export async function orderPassengerNames(ctx: AppContext, orderIds: readonly string[]): Promise<Map<string, string>> {
  if (orderIds.length === 0) return new Map();
  return withPlatformTx(ctx.pool, (db) => listPassengerNames(db, orderIds), { snapshot: true });
}

/** 和订单有关的复核对应的乘客姓名：键是复核编号。 */
export async function approvalPassengerNames(ctx: AppContext, approvals: readonly Approval[]): Promise<Map<string, string>> {
  const related = approvals.filter(isOrderApproval);
  if (related.length === 0) return new Map();
  return withPlatformTx(
    ctx.pool,
    async (db) => {
      const rows = await db.query<{ approval_id: string; name: string }>(
        `select distinct on (v.id) v.id::text as approval_id, o.passenger ->> 'name' as name
           from unnest($1::text[], $2::text[], $3::text[]) as v (id, resource, resource_id)
           join orders o on o.id = (case v.resource
             when 'order' then v.resource_id::uuid
             when 'ticket' then (select t.order_id from tickets t where t.id = v.resource_id::uuid limit 1)
             else (select r.order_id from order_rescues r where r.id = v.resource_id::uuid limit 1) end)
          where o.passenger_anonymized_at is null
          order by v.id`,
        [related.map((item) => item.id), related.map((item) => item.resource), related.map((item) => item.resourceId)],
      );
      return new Map(rows.rows.map((row) => [row.approval_id, row.name]));
    },
    { snapshot: true },
  );
}

/** 审计日志对应的乘客姓名：键是订单编号。工单的审计里有 `order_id`；旧记录打码后查不到姓名的，电话、邮箱照样打码。 */
export async function auditPassengerNames(db: Db, logs: readonly AuditLog[]): Promise<Map<string, string>> {
  const ids = [...new Set(logs.filter(isOrderAudit).flatMap((log) => auditOrderId(log) ?? []))];
  return ids.length === 0 ? new Map() : listPassengerNames(db, ids);
}

/** 接口读取时再打一次码，兜住这个任务之前写入的旧记录（ADR 0055）；新记录写入时已经打过，再打一次结果不变。 */
export function maskedAuditLog(log: AuditLog, names: ReadonlyMap<string, string>): AuditLog {
  if (!isOrderAudit(log)) return log;
  const orderId = auditOrderId(log);
  const name = orderId === null ? null : (names.get(orderId) ?? null);
  return { ...log, before: maskOrderValues(log.before, name), after: maskOrderValues(log.after, name) };
}
