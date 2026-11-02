/**
 * M4-21 QA 共用的搭建（只给 passenger-*.qa.itest.ts 用，本文件没有用例）：把测试里构造的订单摆成「结束了 N 天」，以及各种「还没结的事」的记录。
 * 数据全部虚构，只在测试 schema 里，api.close() 时连同 schema 删除。
 */
import { randomUUID } from "node:crypto";
import { ANONYMIZED_TEXT } from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { RETENTION_BLOCKERS, type RetentionBlocker } from "../repos/passenger-retention.ts";
import type { TestApi } from "./api.ts";
import { seedOrder } from "./dispatch.ts";
import type { Market } from "./market.ts";

export const DAY = 86_400_000;
export type Seeded = { id: string; orderNo: string; tenantId: string };

export const retentionCtx = (api: TestApi): AppContext => ({ pool: api.db.pool, now: api.clock.now, config: { passengerRetention: { enabled: true, days: 180 } } }) as unknown as AppContext;

/** 东京今天往前 `days` 天那一天的某个时刻（`at` 是东京当地时间）。 */
export function tokyoDaysAgo(api: TestApi, days: number, at = "12:00:00"): Date {
  const tokyoToday = new Date(api.clock.now().getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
  return new Date(new Date(`${tokyoToday}T${at}+09:00`).getTime() - days * DAY);
}

/** 让一张单变成「在这个时刻免费取消」：所有时间都推到那时，没有别的挡着的事。 */
export async function endAt(api: TestApi, orderId: string, ended: Date): Promise<void> {
  const owner = api.db.owner;
  await owner.query(
    "update orders set status = 'cancelled', cancelled_at = $2, cancel_reason = 'GUEST_REQUEST', service_at = $2, created_at = $3::timestamptz, confirmed_at = case when confirmed_at is null then null else $3::timestamptz end, payment_due_at = $2, updated_at = $2, cancel_tenant_share_minor = null, completed_at = null, completed_recorded_at = null where id = $1",
    [orderId, ended, new Date(ended.getTime() - 3_600_000)],
  );
  await owner.query("update order_events set occurred_at = $2 where order_id = $1", [orderId, ended]);
  // 和真实的取消一样：没付成的收款作废（services/orders.ts）。否则官网没付款的单会被「收款没有结果」挡住
  await owner.query("update order_payments set disputed = false, paid_after_cancel = false, status = case when status in ('creating', 'requires_payment', 'processing') then 'canceled' else status end where order_id = $1", [orderId]);
  await owner.query("update webhook_deliveries set status = 'succeeded', next_attempt_at = null, lease_token = null, succeeded_at = $2 where order_id = $1 and status = 'pending'", [orderId, ended]);
  await owner.query("update notifications set status = 'sent', sent_at = $2, lease_token = null, lease_until = null where order_id = $1 and status in ('pending', 'sending')", [orderId, ended]);
  await owner.query("update order_exceptions set status = 'closed', close_kind = 'cleared', closed_at = $2 where order_id = $1 and status <> 'closed'", [orderId, ended]);
}

export async function aged(api: TestApi, m: Market, days: number, side: "a" | "b" = "a"): Promise<Seeded> {
  const ended = tokyoDaysAgo(api, days);
  const order = await seedOrder(api, m, side, { serviceAt: ended, confirmedAt: new Date(ended.getTime() - 3_600_000) });
  await endAt(api, order.id, ended);
  return order;
}

export const passengerOf = async (api: TestApi, orderId: string): Promise<{ name: string; phone: string; email: string }> => (await api.db.owner.query("select passenger from orders where id = $1 limit 1", [orderId])).rows[0].passenger;
export const isDone = async (api: TestApi, orderId: string): Promise<boolean> => (await passengerOf(api, orderId)).name === ANONYMIZED_TEXT;

/** 这一条判断依据是否命中这张单（精确到单，不受同库其他单影响）。 */
export async function blockedBy(api: TestApi, orderId: string, reason: RetentionBlocker): Promise<boolean> {
  const row = (await api.db.owner.query(`select (${RETENTION_BLOCKERS[reason]}) as hit from (select $1::uuid as id) a`, [orderId])).rows[0];
  return row.hit === true;
}

export const staffIds = async (api: TestApi): Promise<[string, string]> => {
  const rows = (await api.db.owner.query("select id from platform_users order by id limit 2")).rows;
  return [rows[0].id, rows[1].id];
};

const NO_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const randomNo = (length: number): string => Array.from({ length }, () => NO_ALPHABET[Math.floor(Math.random() * NO_ALPHABET.length)]).join("");

export async function insertTicket(api: TestApi, order: Seeded, status: string, texts: { subject?: string; description?: string; closeNote?: string; decisionNote?: string } = {}): Promise<string> {
  const [staff, other] = await staffIds(api);
  const now = api.clock.now();
  const closed = status === "closed";
  const decided = status === "decided" || status === "pending_review";
  let approval: string | null = null;
  if (status === "pending_review") approval = await insertApproval(api, "ticket.compensation", "ticket", randomUUID(), { requester: other, status: "withdrawn" });
  const rows = await api.db.owner.query(
    `insert into tickets (tenant_id, ticket_no, type, source, created_by_type, order_id, priority, subject, description, status, first_response_due_at, resolution_due_at,
                          tenant_reply_requested_at, tenant_reply_due_at, outcome, decided_at, decided_by, decision_note, approval_id, closed_at, closed_by, close_note, created_at, updated_at)
     values ($1, $2, 'other', 'system', 'system', $3, 'normal', $4, $5, $6, $7, $7, $8, $8, $9, $10, $11, $12, $13, $14, $15, $16, $7, $7) returning id`,
    [
      order.tenantId, `TK20260101${randomNo(6)}`, order.id, texts.subject ?? "工单", texts.description ?? "说明", status, now,
      status === "awaiting_tenant" ? now : null,
      decided ? "resolved" : null, decided ? now : null, decided ? staff : null, texts.decisionNote ?? null, approval,
      closed ? now : null, closed ? staff : null, texts.closeNote ?? null,
    ],
  );
  return rows.rows[0].id;
}

export async function closeTicket(api: TestApi, ticketId: string): Promise<void> {
  const [staff] = await staffIds(api);
  await api.db.owner.query("update tickets set status = 'closed', closed_at = $2, closed_by = $3 where id = $1", [ticketId, api.clock.now(), staff]);
}

export async function insertApproval(api: TestApi, kind: string, resource: string, resourceId: string, options: { requester?: string; status?: string; note?: string; payload?: unknown } = {}): Promise<string> {
  const [staff] = await staffIds(api);
  const status = options.status ?? "pending";
  const rows = await api.db.owner.query(
    `insert into approvals (kind, resource, resource_id, summary, payload, status, requested_by, requested_at, request_note, decided_at)
     values ($1, $2, $3, '系统写的说明', $4::jsonb, $5, $6, $7, $8, $9) returning id`,
    [kind, resource, resourceId, JSON.stringify(options.payload ?? {}), status, options.requester ?? staff, api.clock.now(), options.note ?? null, status === "pending" ? null : api.clock.now()],
  );
  return rows.rows[0].id;
}

export async function insertPayment(api: TestApi, order: Seeded, options: { status?: string; kind?: string; extraChargeId?: string; changeId?: string; disputed?: boolean; paidAfterCancel?: boolean; refunded?: number } = {}): Promise<string> {
  const now = api.clock.now();
  const status = options.status ?? "succeeded";
  const rows = await api.db.owner.query(
    `insert into order_payments (order_id, supplier_tenant_id, kind, provider, intent_id, amount_minor, currency, status, refunded_minor, disputed, paid_after_cancel, save_consent_at, succeeded_at, created_at, updated_at, extra_charge_id, change_id)
     values ($1, $2, $3, 'stripe', $4, 20000, 'JPY', $5, $6, $7, $8, $9, $10, $9, $9, $11, $12) returning id`,
    [order.id, order.tenantId, options.kind ?? "order", status === "creating" ? null : `pi_${randomUUID().replaceAll("-", "")}`, status, options.refunded ?? 0, options.disputed ?? false, options.paidAfterCancel ?? false, now, status === "succeeded" ? now : null, options.extraChargeId ?? null, options.changeId ?? null],
  );
  return rows.rows[0].id;
}

export async function insertRefund(api: TestApi, order: Seeded, paymentId: string, status: string): Promise<string> {
  const now = api.clock.now();
  const rows = await api.db.owner.query(
    `insert into order_refunds (order_id, supplier_tenant_id, payment_id, purpose, amount_minor, currency, status, next_attempt_at, succeeded_at, failed_at, created_at, updated_at)
     values ($1, $2, $3, 'cancellation', 1000, 'JPY', $4, $5, $6, $7, $8, $8) returning id`,
    [order.id, order.tenantId, paymentId, status, status === "pending" || status === "processing" ? now : null, status === "succeeded" ? now : null, status === "failed" ? now : null, now],
  );
  return rows.rows[0].id;
}

export async function insertException(api: TestApi, order: Seeded, status: "open" | "claimed" | "closed", options: { detail?: unknown; resolution?: string; type?: string } = {}): Promise<string> {
  const [staff] = await staffIds(api);
  const now = api.clock.now();
  const resolved = status === "closed" && options.resolution !== undefined;
  const rows = await api.db.owner.query(
    `insert into order_exceptions (type, source_key, order_id, supplier_tenant_id, detail, status, opened_at, due_at, assignee_id, claimed_at, close_kind, closed_at, closed_by, resolution, created_at, updated_at)
     values ($1, $2, $3, $4, $5::jsonb, $6, $7, $7, $8, $9, $10, $11, $12, $13, $7, $7) returning id`,
    [
      options.type ?? "payment_issue", `qa:${randomUUID()}`, order.id, order.tenantId, JSON.stringify(options.detail ?? {}), status, now,
      status === "claimed" ? staff : null, status === "claimed" ? now : null,
      status === "closed" ? (resolved ? "resolved" : "cleared") : null, status === "closed" ? now : null, resolved ? staff : null, options.resolution ?? null,
    ],
  );
  return rows.rows[0].id;
}

export async function insertChange(api: TestApi, order: Seeded, status: string, options: { before?: unknown; after?: unknown; decisionNote?: string } = {}): Promise<string> {
  const now = api.clock.now();
  const decided = ["applied", "rejected", "expired", "failed", "cancelled"].includes(status);
  const rows = await api.db.owner.query(
    `insert into order_changes (tenant_id, order_id, status, reschedule, before, after, settlement_before_minor, settlement_after_minor, confirm_due_at, requested_by, requested_at, decided_at, decision_note, adjusting_at)
     values ($1, $2, $3, false, $4::jsonb, $5::jsonb, 20000, 20000, $6, 'channel', $7, $8, $9, $10) returning id`,
    [order.tenantId, order.id, status, JSON.stringify(options.before ?? {}), JSON.stringify(options.after ?? {}), status === "pending_confirmation" || status === "adjusting" ? now : null, now, decided ? now : null, options.decisionNote ?? null, status === "adjusting" ? now : null],
  );
  return rows.rows[0].id;
}

export async function insertRescue(api: TestApi, order: Seeded, status: string, options: { reason?: string; forceMajeureNote?: string } = {}): Promise<string> {
  const [staff] = await staffIds(api);
  const now = api.clock.now();
  const closed = status === "cancelled";
  const rows = await api.db.owner.query(
    `insert into order_rescues (order_id, original_tenant_id, trigger, triggered_by_type, triggered_by, reason, triggered_at, from_status, service_at, original_settlement_minor, original_settlement_currency, penalty_bp, penalty_tier, status, closed_at, force_majeure_at, force_majeure_by, force_majeure_note, created_at, updated_at)
     values ($1, $2, 'tenant_declared', 'platform_user', $3, $4, $5, 'confirmed', $5, 20000, 'JPY', 0, 'none', $6, $7, $8, $9, $10, $5, $5) returning id`,
    [order.id, order.tenantId, staff, options.reason ?? "车坏了", now, status, closed ? now : null, options.forceMajeureNote === undefined ? null : now, options.forceMajeureNote === undefined ? null : staff, options.forceMajeureNote ?? null],
  );
  return rows.rows[0].id;
}

export async function insertExtraCharge(api: TestApi, order: Seeded, status: string, options: { description?: string; disputeReason?: string; decisionNote?: string } = {}): Promise<string> {
  const now = api.clock.now();
  const [staff] = await staffIds(api);
  const tenantUser = (await api.db.owner.query("select id from tenant_users where tenant_id = $1 limit 1", [order.tenantId])).rows[0].id;
  const submitted = new Date(now.getTime() - 3 * DAY);
  const disputed = status === "disputed" || options.disputeReason !== undefined;
  const reviewing = status === "review" || status === "disputed";
  const decided = status === "rejected" || options.decisionNote !== undefined;
  const rows = await api.db.owner.query(
    `insert into order_extra_charges (tenant_id, order_id, type, amount_minor, currency, description, status, review_reasons, submitted_at, submitted_by, dispute_until, disputed_at, dispute_reason, decided_at, decided_by, decision_note, charged_at, withdrawn_at, created_at, updated_at)
     values ($1, $2, 'toll', 500, 'JPY', $3, $4, $5::text[], $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $6, $6) returning id`,
    [
      order.tenantId, order.id, options.description ?? null, status, reviewing ? (disputed ? ["DISPUTED"] : ["NO_EVIDENCE"]) : [], submitted, tenantUser, new Date(submitted.getTime() + 2 * DAY),
      disputed ? new Date(submitted.getTime() + 3_600_000) : null, disputed ? (options.disputeReason ?? "有异议") : null, decided ? now : null, decided ? staff : null, options.decisionNote ?? null,
      status === "charged" ? now : null, status === "withdrawn" ? new Date(submitted.getTime() + 60_000) : null,
    ],
  );
  return rows.rows[0].id;
}

export async function insertDeduction(api: TestApi, order: Seeded, ticketId: string, status: "pending" | "waived"): Promise<string> {
  const now = api.clock.now();
  const rows = await api.db.owner.query(
    `insert into tenant_deductions (tenant_id, order_id, ticket_id, kind, amount_minor, currency, basis, status, waived_at, waive_reason, created_at, updated_at)
     values ($1, $2, $3, 'compensation', 500, 'JPY', '{}'::jsonb, $4, $5, $6, $7, $7) returning id`,
    [order.tenantId, order.id, ticketId, status, status === "waived" ? now : null, status === "waived" ? "免除" : null, now],
  );
  return rows.rows[0].id;
}

/** 一张账单，带一行明细。默认 issued；其他状态的列由 setStatementStatus 补。 */
let statementPeriodSeq = 0;

export async function insertStatement(api: TestApi, tenantId: string, line: { kind: string; sourceKey: string; orderId: string | null; orderNo: string | null; amount?: number }, total = 20000): Promise<string> {
  const now = api.clock.now();
  const statementNo = `ST202601${randomNo(8)}`;
  // 一个供应商、一种币种、一期只能有一张有效账单：按顺序发，随机会偶发撞号
  statementPeriodSeq += 1;
  const period = `${2100 + Math.floor(statementPeriodSeq / 12)}-${String(1 + (statementPeriodSeq % 12)).padStart(2, "0")}`;
  const rows = await api.db.owner.query(
    `insert into statements (tenant_id, statement_no, period, currency, status, total_minor, line_count, pay_due_on, confirm_due_at, issued_at, created_at, updated_at)
     values ($1, $2, $3, 'JPY', 'issued', $4, 1, '2030-01-20', $5, $5, $5, $5) returning id`,
    [tenantId, statementNo, period, total, now],
  );
  await api.db.owner.query(
    `insert into statement_lines (tenant_id, statement_id, kind, source_key, order_id, order_no, service_date, prior_period, amount_minor, currency, detail, created_at)
     values ($1, $2, $3, $4, $5, $6, $9::date, false, $7, 'JPY', '{}'::jsonb, $8)`,
    [tenantId, rows.rows[0].id, line.kind, line.sourceKey, line.orderId, line.orderNo, line.amount ?? total, now, line.orderId === null ? null : "2026-01-01"],
  );
  return rows.rows[0].id;
}

export async function setStatementStatus(api: TestApi, statementId: string, status: string): Promise<void> {
  const now = api.clock.now();
  const [one, two] = await staffIds(api);
  const q = api.db.owner;
  const approval = async (): Promise<string> => insertApproval(api, "statement.qa", "statement", statementId, { requester: one, status: "withdrawn" });
  const batch = async (): Promise<string> => (await q.query("insert into payout_batches (pay_date, status, created_at) values ('2030-01-20', 'open', $1) on conflict (pay_date) do update set pay_date = excluded.pay_date returning id", [now])).rows[0].id;
  if (status === "disputed") await q.query("update statements set status = 'disputed', disputed_at = $2, dispute_reason = '金额不对' where id = $1", [statementId, now]);
  else if (status === "confirmed") await q.query("update statements set status = 'confirmed', confirmed_at = $2, confirmed_by_type = 'system', dispute_reason = null, disputed_at = null where id = $1", [statementId, now]);
  else if (status === "in_payout") await q.query("update statements set status = 'in_payout', confirmed_at = $2, confirmed_by_type = 'system', approval_id = $3, approved_at = $2, payout_batch_id = $4, payout_on = '2030-01-20' where id = $1", [statementId, now, await approval(), await batch()]);
  else if (status === "paid") await q.query("update statements set status = 'paid', confirmed_at = $2, confirmed_by_type = 'system', approval_id = coalesce(approval_id, $3), approved_at = $2, payout_batch_id = coalesce(payout_batch_id, $4), payout_on = '2030-01-20', paid_at = $2, bank_reference = 'QA-REF' where id = $1", [statementId, now, await approval(), await batch()]);
  else if (status === "void") await q.query("update statements set status = 'void', voided_at = $2, voided_by = $3, void_reason = '测试', approval_id = null, approved_at = null, payout_batch_id = null, payout_on = null, confirmed_at = null, confirmed_by_type = null where id = $1", [statementId, now, two]);
  else throw new Error(`没摆过这个状态：${status}`);
}

export async function insertGuestNotification(api: TestApi, order: Seeded, status: "pending" | "sending" | "sent" | "failed", options: { recipient?: string; lastError?: string } = {}): Promise<string> {
  const now = api.clock.now();
  const event = (await api.db.owner.query("insert into notification_events (tenant_id, event, order_id, dedupe_key, data, occurred_at, expanded_at) values ($1, 'order.changed', $2, $3, '{}'::jsonb, $4, $4) returning id", [order.tenantId, order.id, `qa:${randomUUID()}`, now])).rows[0].id;
  const rows = await api.db.owner.query(
    `insert into notifications (event_id, tenant_id, event, audience, locale, channel, recipient, order_id, order_no, status, next_attempt_at, lease_token, lease_until, expires_at, sent_at, last_error_code, last_error_message, created_at, updated_at)
     values ($1, $2, 'order.changed', 'guest', 'zh', 'email', $3, $4, $5, $6, $7, $8, $9, $9, $10, $11, $12, $7, $7) returning id`,
    [event, order.tenantId, options.recipient ?? "guest@example.com", order.id, order.orderNo, status, now, status === "sending" ? randomUUID() : null, new Date(now.getTime() + DAY), status === "sent" ? now : null, options.lastError === undefined ? null : "SMTP", options.lastError ?? null],
  );
  return rows.rows[0].id;
}

export async function insertWebhookDelivery(api: TestApi, order: Seeded, status: "pending" | "succeeded" | "failed", data: unknown = {}): Promise<string> {
  const now = api.clock.now();
  const eventId = `evt_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
  const rows = await api.db.owner.query(
    `insert into webhook_deliveries (tenant_id, event_id, event_type, order_id, event_data, status, next_attempt_at, succeeded_at, failed_at, created_at)
     values ($1, $2, 'order.changed', $3, $4::jsonb, $5, $6, $7, $8, $9) returning id`,
    [order.tenantId, eventId, order.id, JSON.stringify(data), status, status === "pending" ? now : null, status === "succeeded" ? now : null, status === "failed" ? now : null, now],
  );
  return rows.rows[0].id;
}
