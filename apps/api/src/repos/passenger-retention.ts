/**
 * 乘客信息自动脱敏的数据访问（M4-21，ADR 0055）。全在平台事务里调用。
 *
 * 「这单能不能脱敏」只有这里一份 SQL：dry-run 和真正执行用同一份，被挡住的不占每批的名额。
 * 救援改派后同一个订单编号有几行，都按一个单处理：所有行都到了终态、都超过期限，才算到期；任何一行有没结的事都不处理。
 */
import { ANONYMIZED_PASSENGER, ANONYMIZED_TEXT, scrubContactsInText, scrubOrderValues } from "@nozomi/domain";
import type { Db } from "../db/context.ts";

/** 判断依据（ADR 0055「什么时候不脱敏」）：键是 dry-run 里的原因，值是「还有没结的事」的条件，`a.id` 是订单编号。 */
export const RETENTION_BLOCKERS = {
  open_ticket: `exists (select 1 from tickets t where t.order_id = a.id and t.status <> 'closed')
    or exists (select 1 from ticket_compensations c join tickets t on t.id = c.ticket_id where t.order_id = a.id and c.payout_status = 'pending')`,
  open_statement: `exists (select 1 from statement_lines l join statements s on s.tenant_id = l.tenant_id and s.id = l.statement_id
                            where l.order_id = a.id and l.voided_at is null and s.status in ('issued', 'disputed', 'confirmed', 'in_payout'))`,
  unbilled: `exists (select 1 from orders o where o.id = a.id and (o.status in ('completed', 'no_show') or (o.status = 'cancelled' and o.cancel_tenant_share_minor > 0))
                       and not exists (select 1 from statement_lines l where l.tenant_id = o.tenant_id and l.source_key = 'order:' || o.id::text and l.voided_at is null))
    or exists (select 1 from order_extra_charges x where x.order_id = a.id and x.status = 'charged'
                 and not exists (select 1 from statement_lines l where l.tenant_id = x.tenant_id and l.source_key = 'extra_charge:' || x.id::text and l.voided_at is null))
    or exists (select 1 from tenant_deductions d where d.order_id = a.id and d.amount_minor > 0 and d.status = 'pending'
                 and not exists (select 1 from statement_lines l where l.tenant_id = d.tenant_id and l.source_key = 'deduction:' || d.id::text and l.voided_at is null))
    or exists (select 1 from tenant_deductions d where d.order_id = a.id and d.amount_minor > 0 and d.status = 'waived'
                 and exists (select 1 from statement_lines l where l.tenant_id = d.tenant_id and l.source_key = 'deduction:' || d.id::text and l.voided_at is null)
                 and not exists (select 1 from statement_lines l where l.tenant_id = d.tenant_id and l.source_key = 'deduction_waiver:' || d.id::text and l.voided_at is null))`,
  dispute: `exists (select 1 from order_payments p where p.order_id = a.id and (p.disputed or (p.paid_after_cancel and p.refunded_minor < p.amount_minor)))
    or exists (select 1 from order_extra_charges x where x.order_id = a.id and x.status in ('in_window', 'review', 'disputed', 'approved', 'charging', 'charge_failed'))`,
  refund: `exists (select 1 from order_refunds r where r.order_id = a.id
                     and (r.status in ('pending', 'processing') or (r.status = 'failed' and r.superseded_at is null and not exists (select 1 from order_refunds retry where retry.retry_of = r.id))))`,
  open_work: `exists (select 1 from order_exceptions e where e.order_id = a.id and e.status <> 'closed')
    or exists (select 1 from order_changes c where c.order_id = a.id and c.status in ('awaiting_payment', 'pending_confirmation'))
    or exists (select 1 from order_rescues r where r.order_id = a.id and r.status in ('open', 'offering', 'exhausted'))
    or exists (select 1 from approvals v where v.status = 'pending' and (
         (v.resource = 'order' and v.resource_id = a.id::text)
         or (v.resource = 'ticket' and v.resource_id in (select t.id::text from tickets t where t.order_id = a.id))
         or (v.resource = 'rescue' and v.resource_id in (select r.id::text from order_rescues r where r.order_id = a.id))))`,
  sending: `exists (select 1 from notifications n where n.order_id = a.id and n.audience = 'guest' and n.status in ('pending', 'sending'))
    or exists (select 1 from webhook_deliveries w where w.order_id = a.id and w.status = 'pending')`,
} as const;

export type RetentionBlocker = keyof typeof RETENTION_BLOCKERS;
const BLOCKER_KEYS = Object.keys(RETENTION_BLOCKERS) as RetentionBlocker[];
const NONE_BLOCKED = BLOCKER_KEYS.map((key) => `not (${RETENTION_BLOCKERS[key]})`).join("\n and ");

/**
 * 到期的单：$1 是截止时刻。结束时间取所有行的用车时间、完成、取消、转出和状态流水里最晚的（ADR 0055「什么算超过期限」）。
 * 先用部分索引按用车时间筛，再把同一个订单编号的所有行都带上。
 */
const AGED = `aged as (
  select o.id, max(greatest(o.service_at, o.completed_at, o.completed_recorded_at, o.cancelled_at, o.rescued_at, last_event.at)) as ended_at
    from orders o
    left join lateral (select max(e.occurred_at) as at from order_events e where e.tenant_id = o.tenant_id and e.order_id = o.id) last_event on true
   where o.id in (select c.id from orders c where c.service_at < $1 and c.passenger_anonymized_at is null and c.status in ('completed', 'no_show', 'cancelled', 'rescued'))
   group by o.id
  having bool_and(o.status in ('completed', 'no_show', 'cancelled', 'rescued')) and bool_and(o.passenger_anonymized_at is null)
     and max(greatest(o.service_at, o.completed_at, o.completed_recorded_at, o.cancelled_at, o.rescued_at, last_event.at)) < $1
)`;

export interface RetentionCandidate {
  orderId: string;
  endedAt: Date;
}

/** 这一批可以处理的单，结束得早的在前。`except`：这一轮已经出过错的，不再选。 */
export async function listRetentionCandidates(db: Db, cutoff: Date, limit: number, except: readonly string[] = []): Promise<RetentionCandidate[]> {
  const rows = await db.query<{ id: string; ended_at: Date }>(
    `with ${AGED} select a.id, a.ended_at from aged a where a.id <> all($3::uuid[]) and ${NONE_BLOCKED} order by a.ended_at, a.id limit $2`,
    [cutoff, limit, except],
  );
  return rows.rows.map((row) => ({ orderId: row.id, endedAt: row.ended_at }));
}

export interface RetentionSummary {
  /** 超过期限、还没脱敏的单 */
  aged: number;
  /** 其中现在就能处理的 */
  ready: number;
  /** 被挡住的，按原因（一单可能有几个原因） */
  blocked: Record<RetentionBlocker, number>;
  earliestEndedAt: Date | null;
  latestEndedAt: Date | null;
}

/** dry-run 看的数量：只有数量和时间范围，没有订单编号和内容。 */
export async function summarizeRetention(db: Db, cutoff: Date): Promise<RetentionSummary> {
  const columns = BLOCKER_KEYS.map((key) => `count(*) filter (where ${RETENTION_BLOCKERS[key]})::int as ${key}`).join(",\n");
  const row = (
    await db.query<Record<string, unknown>>(
      `with ${AGED}
       select count(*)::int as aged, count(*) filter (where ${NONE_BLOCKED})::int as ready,
              min(a.ended_at) filter (where ${NONE_BLOCKED}) as earliest, max(a.ended_at) filter (where ${NONE_BLOCKED}) as latest,
              ${columns}
         from aged a`,
      [cutoff],
    )
  ).rows[0] as Record<string, unknown>;
  const blocked = Object.fromEntries(BLOCKER_KEYS.map((key) => [key, row[key] as number])) as Record<RetentionBlocker, number>;
  return { aged: row["aged"] as number, ready: row["ready"] as number, blocked, earliestEndedAt: row["earliest"] as Date | null, latestEndedAt: row["latest"] as Date | null };
}

/** 各手写列的长度上限：占位可能比原文长，不能因此违反长度约束、让这单永远处理不了。 */
const LIMITS = { contactNote: 200, cancelNote: 500, changeNote: 500, extraDescription: 200, extraDispute: 500, extraDecision: 500, ticketSubject: 200, ticketBody: 4000, ticketDecision: 1000, ticketClose: 1000, resolution: 1000 } as const;

function scrubbed(text: string, names: readonly string[], limit?: number): string {
  const result = scrubContactsInText(text, names);
  return limit === undefined ? result : Array.from(result).slice(0, limit).join("");
}

function scrubbedOrNull(text: string | null, names: readonly string[], limit?: number): string | null {
  return text === null ? null : scrubbed(text, names, limit);
}

/**
 * 锁住这单的所有行并在锁内重新判断。别的实例（或别的操作）正锁着、或者已经不满足条件时返回 false，什么都不做。
 */
export async function lockRetentionOrder(db: Db, orderId: string, cutoff: Date): Promise<boolean> {
  const total = (await db.query<{ total: number }>("select count(*)::int as total from orders where id = $1", [orderId])).rows[0]?.total ?? 0;
  const locked = await db.query("select 1 from orders where id = $1 for update skip locked", [orderId]);
  if (total === 0 || locked.rows.length !== total) return false;
  const still = await db.query(`with ${AGED} select 1 from aged a where a.id = $2 and ${NONE_BLOCKED}`, [cutoff, orderId]);
  return still.rows.length === 1;
}

/**
 * 把一单的乘客姓名、电话、邮箱和它们的副本换成占位（调用方已经 `lockRetentionOrder`）。
 * 金额、订单号、时间、状态、流水、即时通讯账号、地址、航班号都不动（ADR 0055）；不改 `version`、`updated_at`：脱敏不是一次业务上的修改。
 */
export async function anonymizeOrderPassenger(db: Db, orderId: string, now: Date): Promise<void> {
  const orders = (await db.query<{ tenant_id: string; passenger: { name?: string }; notes: string | null; cancel_note: string | null }>("select tenant_id, passenger, notes, cancel_note from orders where id = $1", [orderId])).rows;
  const changes = (await db.query<{ tenant_id: string; id: string; before: Record<string, unknown>; after: Record<string, unknown>; decision_note: string | null }>("select tenant_id, id, before, after, decision_note from order_changes where order_id = $1", [orderId])).rows;
  const nameOf = (values: { passenger?: { name?: unknown } }): string[] => (typeof values.passenger?.name === "string" ? [values.passenger.name] : []);
  const names = [...new Set([...orders.flatMap((row) => nameOf(row)), ...changes.flatMap((row) => [...nameOf(row.before), ...nameOf(row.after)])])].filter((name) => name !== ANONYMIZED_TEXT);

  // 先标记：手写内容的触发器要看到这单已经脱敏
  for (const row of orders) {
    await db.query("update orders set passenger = $3::jsonb, notes = $4, cancel_note = $5, passenger_anonymized_at = $6 where tenant_id = $1 and id = $2", [
      row.tenant_id,
      orderId,
      JSON.stringify(ANONYMIZED_PASSENGER),
      scrubbedOrNull(row.notes, names),
      scrubbedOrNull(row.cancel_note, names, LIMITS.cancelNote),
      now,
    ]);
  }
  for (const row of changes) {
    await db.query("update order_changes set before = $3::jsonb, after = $4::jsonb, decision_note = $5 where tenant_id = $1 and id = $2", [row.tenant_id, row.id, JSON.stringify(scrubOrderValues(row.before, names)), JSON.stringify(scrubOrderValues(row.after, names)), scrubbedOrNull(row.decision_note, names, LIMITS.changeNote)]);
  }
  const deliveries = (await db.query<{ id: string; event_data: Record<string, unknown> }>("select id, event_data from webhook_deliveries where order_id = $1", [orderId])).rows;
  for (const row of deliveries) await db.query("update webhook_deliveries set event_data = $2::jsonb where id = $1", [row.id, JSON.stringify(scrubOrderValues(row.event_data, names))]);

  const notifications = (await db.query<{ id: string; last_error_message: string | null }>("select id, last_error_message from notifications where order_id = $1 and audience = 'guest'", [orderId])).rows;
  for (const row of notifications) await db.query("update notifications set recipient = $2, last_error_message = $3 where id = $1", [row.id, ANONYMIZED_TEXT, scrubbedOrNull(row.last_error_message, names)]);

  const contacts = (await db.query<{ tenant_id: string; id: string; note: string }>("select tenant_id, id, note from order_contacts where order_id = $1 and note is not null", [orderId])).rows;
  for (const row of contacts) await updateIfChanged(db, "update order_contacts set note = $3 where tenant_id = $1 and id = $2", [row.tenant_id, row.id], row.note, scrubbed(row.note, names, LIMITS.contactNote));

  const charges = (await db.query<{ tenant_id: string; id: string; description: string | null; dispute_reason: string | null; decision_note: string | null }>("select tenant_id, id, description, dispute_reason, decision_note from order_extra_charges where order_id = $1", [orderId])).rows;
  for (const row of charges) {
    await db.query("update order_extra_charges set description = $3, dispute_reason = $4, decision_note = $5 where tenant_id = $1 and id = $2", [row.tenant_id, row.id, scrubbedOrNull(row.description, names, LIMITS.extraDescription), scrubbedOrNull(row.dispute_reason, names, LIMITS.extraDispute), scrubbedOrNull(row.decision_note, names, LIMITS.extraDecision)]);
  }
  const exceptions = (await db.query<{ id: string; resolution: string }>("select id, resolution from order_exceptions where order_id = $1 and resolution is not null", [orderId])).rows;
  for (const row of exceptions) await db.query("update order_exceptions set resolution = $2 where id = $1", [row.id, scrubbed(row.resolution, names, LIMITS.resolution)]);

  const rescues = (await db.query<{ id: string; reason: string | null; force_majeure_note: string | null }>("select id, reason, force_majeure_note from order_rescues where order_id = $1", [orderId])).rows;
  for (const row of rescues) await db.query("update order_rescues set reason = $2, force_majeure_note = $3 where id = $1", [row.id, scrubbedOrNull(row.reason, names), scrubbedOrNull(row.force_majeure_note, names)]);

  const tickets = (await db.query<{ tenant_id: string; id: string; subject: string; description: string; decision_note: string | null; close_note: string | null }>("select tenant_id, id, subject, description, decision_note, close_note from tickets where order_id = $1", [orderId])).rows;
  for (const row of tickets) {
    await db.query("update tickets set subject = $3, description = $4, decision_note = $5, close_note = $6 where tenant_id = $1 and id = $2", [row.tenant_id, row.id, scrubbed(row.subject, names, LIMITS.ticketSubject), scrubbed(row.description, names, LIMITS.ticketBody), scrubbedOrNull(row.decision_note, names, LIMITS.ticketDecision), scrubbedOrNull(row.close_note, names, LIMITS.ticketClose)]);
    const messages = (await db.query<{ id: string; body: string }>("select id, body from ticket_messages where tenant_id = $1 and ticket_id = $2", [row.tenant_id, row.id])).rows;
    for (const message of messages) await updateIfChanged(db, "update ticket_messages set body = $3 where tenant_id = $1 and id = $2", [row.tenant_id, message.id], message.body, scrubbed(message.body, names, LIMITS.ticketBody));
    const notes = (await db.query<{ id: string; body: string }>("select id, body from ticket_notes where ticket_id = $1", [row.id])).rows;
    for (const note of notes) await updateIfChanged(db, "update ticket_notes set body = $2 where id = $1", [note.id], note.body, scrubbed(note.body, names, LIMITS.ticketBody));
  }
}

async function updateIfChanged(db: Db, sql: string, keys: readonly unknown[], was: string, now: string): Promise<void> {
  if (was !== now) await db.query(sql, [...keys, now]);
}
