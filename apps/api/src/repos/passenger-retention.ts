/**
 * 乘客信息自动脱敏的数据访问（M4-21，ADR 0055）。全在平台事务里调用。
 *
 * 「这单能不能脱敏」只有这里一份 SQL：dry-run 和真正执行用同一份，被挡住的不占每批的名额。
 * 救援改派后同一个订单编号有几行，都按一个单处理：所有行都到了终态、都超过期限，才算到期；任何一行有没结的事都不处理。
 */
import { ANONYMIZED_PASSENGER, ANONYMIZED_TEXT, scrubContactsInText, scrubOrderValues } from "@nozomi/domain";
import type { Db } from "../db/context.ts";

/**
 * 转入下期的账单结清了没有：顺着 `carry:<账单编号>` 的明细往后找，接到已付（paid）或相抵为零（settled）的账单才算。
 * 后面又转入下期（carried）的继续往后找；作废的不算；还没出下一张的不算。
 */
function carrySettled(statement: string): string {
  return `coalesce((with recursive chain (tenant_id, id, status) as (
      select n.tenant_id, n.id, n.status from statement_lines c join statements n on n.tenant_id = c.tenant_id and n.id = c.statement_id
       where c.tenant_id = ${statement}.tenant_id and c.source_key = 'carry:' || ${statement}.id::text and c.voided_at is null and n.status <> 'void'
      union all
      select n.tenant_id, n.id, n.status from chain h join statement_lines c on c.tenant_id = h.tenant_id and c.source_key = 'carry:' || h.id::text and c.voided_at is null
        join statements n on n.tenant_id = c.tenant_id and n.id = c.statement_id and n.status <> 'void' where h.status = 'carried'
    ) select bool_or(status in ('paid', 'settled')) from chain), false)`;
}

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
  /** 收款还没有结果（Stripe 回来可能要退款、联系客人）：宁可不脱敏，dry-run 列出来让人发现 */
  payment_pending: `exists (select 1 from order_payments p where p.order_id = a.id and p.status in ('creating', 'requires_payment', 'processing'))`,
  /** 明细所在账单转入了下期（carried），接着的账单还没结清 */
  carried_balance: `exists (select 1 from statement_lines l join statements s on s.tenant_id = l.tenant_id and s.id = l.statement_id join tenants tn on tn.id = l.tenant_id
                             where l.order_id = a.id and l.voided_at is null and s.status = 'carried' and tn.status <> 'terminated' and not ${carrySettled("s")})`,
  /** 同上，但供应商已清退，永远结不了：同样不脱敏，dry-run 单列 */
  carried_terminated: `exists (select 1 from statement_lines l join statements s on s.tenant_id = l.tenant_id and s.id = l.statement_id join tenants tn on tn.id = l.tenant_id
                                where l.order_id = a.id and l.voided_at is null and s.status = 'carried' and tn.status = 'terminated' and not ${carrySettled("s")})`,
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
const LIMITS = { contactNote: 200, cancelNote: 500, changeNote: 500, extraDescription: 200, extraDispute: 500, extraDecision: 500, ticketSubject: 200, ticketBody: 4000, ticketDecision: 1000, ticketClose: 1000, resolution: 1000, rescueReason: 500, forceMajeure: 500, declineReason: 500, waiveReason: 500, reviewComment: 2000, approvalNote: 500 } as const;

export interface KnownContacts {
  /** 这单用过的所有姓名（改单前的旧姓名也算） */
  names: readonly string[];
  /** 这单用过的所有电话、邮箱原文 */
  literals: readonly string[];
}

function scrubbed(text: string, known: KnownContacts, limit?: number): string {
  const result = scrubContactsInText(text, known.names, known.literals);
  return limit === undefined ? result : Array.from(result).slice(0, limit).join("");
}

function scrubbedOrNull(text: string | null, known: KnownContacts, limit?: number): string | null {
  return text === null ? null : scrubbed(text, known, limit);
}

/** 只写真的变了的列：后面重扫时大多数行不用动，这几张表也不必为没变的内容过触发器。 */
async function rewrite(db: Db, table: string, keys: Record<string, unknown>, was: Record<string, unknown>, now: Record<string, unknown>): Promise<void> {
  const changed = Object.keys(now).filter((column) => JSON.stringify(was[column]) !== JSON.stringify(now[column]));
  if (changed.length === 0) return;
  const values: unknown[] = [];
  const param = (value: unknown): string => {
    const json = typeof value === "object" && value !== null;
    values.push(json ? JSON.stringify(value) : value);
    return `$${values.length}${json ? "::jsonb" : ""}`;
  };
  const sets = changed.map((column) => `${column} = ${param(now[column])}`).join(", ");
  const where = Object.entries(keys).map(([column, value]) => `${column} = ${param(value)}`).join(" and ");
  await db.query(`update ${table} set ${sets} where ${where}`, values);
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

type Passengerish = { passenger?: { name?: unknown; phone?: unknown; email?: unknown } | null };

function contactsOf(values: readonly Passengerish[]): KnownContacts {
  const pick = (key: "name" | "phone" | "email"): string[] => [...new Set(values.flatMap((value) => {
    const item = value.passenger?.[key];
    return typeof item === "string" && item !== ANONYMIZED_TEXT && item !== "" ? [item] : [];
  }))];
  return { names: pick("name"), literals: [...pick("phone"), ...pick("email")] };
}

/**
 * 把一单的乘客姓名、电话、邮箱和它们的副本换成占位（调用方已经 `lockRetentionOrder`）。
 * 金额、订单号、时间、状态、即时通讯账号、地址、航班号都不动（ADR 0055）；不改 `version`、`updated_at`：脱敏不是一次业务上的修改。
 */
export async function anonymizeOrderPassenger(db: Db, orderId: string, now: Date): Promise<void> {
  const orders = (await db.query<{ tenant_id: string; passenger: { name?: string; phone?: string; email?: string } }>("select tenant_id, passenger from orders where id = $1", [orderId])).rows;
  const changes = (await db.query<{ before: Passengerish; after: Passengerish }>("select before, after from order_changes where order_id = $1", [orderId])).rows;
  const known = contactsOf([...orders.map((row) => ({ passenger: row.passenger })), ...changes.flatMap((row) => [row.before, row.after])]);
  // 先标记：手写内容的触发器要看到这单已经脱敏
  for (const row of orders) {
    await db.query("update orders set passenger = $3::jsonb, passenger_anonymized_at = $4 where tenant_id = $1 and id = $2", [row.tenant_id, orderId, JSON.stringify(ANONYMIZED_PASSENGER), now]);
  }
  await scrubOrderTexts(db, orderId, known);
}

/**
 * 清一单所有手写内容和带乘客信息的副本（只改变了的行）。脱敏时用这单所有已知的联系方式；之后补扫时已经不知道姓名，电话、邮箱仍按规则清。幂等。
 * 全库文本列的盘点结果和不清的理由见 ADR 0055「改什么」。
 */
export async function scrubOrderTexts(db: Db, orderId: string, known: KnownContacts): Promise<void> {
  const text = (value: string | null, limit?: number): string | null => scrubbedOrNull(value, known, limit);
  const json = <T>(value: T): T => (value === null ? value : scrubOrderValues(value, known.names, known.literals));
  const rows = async (sql: string): Promise<Record<string, any>[]> => (await db.query<Record<string, any>>(sql, [orderId])).rows;

  for (const row of await rows("select tenant_id, notes, cancel_note from orders where id = $1")) {
    await rewrite(db, "orders", { tenant_id: row["tenant_id"], id: orderId }, row, { notes: text(row["notes"]), cancel_note: text(row["cancel_note"], LIMITS.cancelNote) });
  }
  for (const row of await rows("select tenant_id, id, before, after, decision_note from order_changes where order_id = $1")) {
    await db.query("update order_changes set before = $3::jsonb, after = $4::jsonb, decision_note = $5 where tenant_id = $1 and id = $2", [row["tenant_id"], row["id"], JSON.stringify(json(row["before"])), JSON.stringify(json(row["after"])), text(row["decision_note"], LIMITS.changeNote)]);
  }
  for (const row of await rows("select id, event_data from webhook_deliveries where order_id = $1")) await rewrite(db, "webhook_deliveries", { id: row["id"] }, row, { event_data: json(row["event_data"]) });
  for (const row of await rows("select id, recipient, last_error_message from notifications where order_id = $1 and audience = 'guest'")) {
    await rewrite(db, "notifications", { id: row["id"] }, row, { recipient: ANONYMIZED_TEXT, last_error_message: text(row["last_error_message"]) });
  }
  for (const row of await rows("select id, expand_error from notification_events where order_id = $1 and expand_error is not null")) await rewrite(db, "notification_events", { id: row["id"] }, row, { expand_error: text(row["expand_error"]) });
  for (const row of await rows("select tenant_id, id, note from order_contacts where order_id = $1 and note is not null")) await rewrite(db, "order_contacts", { tenant_id: row["tenant_id"], id: row["id"] }, row, { note: text(row["note"], LIMITS.contactNote) });
  for (const row of await rows("select tenant_id, id, detail from order_events where order_id = $1 and detail is not null")) await rewrite(db, "order_events", { tenant_id: row["tenant_id"], id: row["id"] }, row, { detail: json(row["detail"]) });
  for (const row of await rows("select tenant_id, order_id, comment from order_reviews where order_id = $1 and comment is not null")) await rewrite(db, "order_reviews", { tenant_id: row["tenant_id"], order_id: orderId }, row, { comment: text(row["comment"], LIMITS.reviewComment) });
  for (const row of await rows("select tenant_id, id, description, dispute_reason, decision_note, last_charge_error from order_extra_charges where order_id = $1")) {
    await rewrite(db, "order_extra_charges", { tenant_id: row["tenant_id"], id: row["id"] }, row, { description: text(row["description"], LIMITS.extraDescription), dispute_reason: text(row["dispute_reason"], LIMITS.extraDispute), decision_note: text(row["decision_note"], LIMITS.extraDecision), last_charge_error: json(row["last_charge_error"]) });
  }
  for (const row of await rows("select id, last_error from order_payments where order_id = $1 and last_error is not null")) await rewrite(db, "order_payments", { id: row["id"] }, row, { last_error: json(row["last_error"]) });
  for (const row of await rows("select id, last_error from order_refunds where order_id = $1 and last_error is not null")) await rewrite(db, "order_refunds", { id: row["id"] }, row, { last_error: json(row["last_error"]) });
  const rescues = await rows("select id, reason, force_majeure_note from order_rescues where order_id = $1");
  for (const row of rescues) await rewrite(db, "order_rescues", { id: row["id"] }, row, { reason: text(row["reason"], LIMITS.rescueReason), force_majeure_note: text(row["force_majeure_note"], LIMITS.forceMajeure) });
  for (const row of await rows("select tenant_id, id, decline_reason from order_rescue_offers where order_id = $1 and decline_reason is not null")) await rewrite(db, "order_rescue_offers", { tenant_id: row["tenant_id"], id: row["id"] }, row, { decline_reason: text(row["decline_reason"], LIMITS.declineReason) });
  for (const row of await rows("select tenant_id, id, waive_reason from tenant_deductions where order_id = $1 and waive_reason is not null")) await rewrite(db, "tenant_deductions", { tenant_id: row["tenant_id"], id: row["id"] }, row, { waive_reason: text(row["waive_reason"], LIMITS.waiveReason) });
  for (const row of await rows("select id, detail, resolution from order_exceptions where order_id = $1")) await rewrite(db, "order_exceptions", { id: row["id"] }, row, { detail: json(row["detail"]), resolution: text(row["resolution"], LIMITS.resolution) });
  for (const row of await rows("select id, detail from payment_events where order_id = $1 and detail is not null")) await rewrite(db, "payment_events", { id: row["id"] }, row, { detail: json(row["detail"]) });

  const tickets = await rows("select tenant_id, id, subject, description, decision_note, close_note from tickets where order_id = $1");
  for (const row of tickets) {
    await rewrite(db, "tickets", { tenant_id: row["tenant_id"], id: row["id"] }, row, { subject: text(row["subject"], LIMITS.ticketSubject), description: text(row["description"], LIMITS.ticketBody), decision_note: text(row["decision_note"], LIMITS.ticketDecision), close_note: text(row["close_note"], LIMITS.ticketClose) });
    for (const message of (await db.query<Record<string, any>>("select id, body from ticket_messages where tenant_id = $1 and ticket_id = $2", [row["tenant_id"], row["id"]])).rows) await rewrite(db, "ticket_messages", { tenant_id: row["tenant_id"], id: message["id"] }, message, { body: text(message["body"], LIMITS.ticketBody) });
    for (const note of (await db.query<Record<string, any>>("select id, body from ticket_notes where ticket_id = $1", [row["id"]])).rows) await rewrite(db, "ticket_notes", { id: note["id"] }, note, { body: text(note["body"], LIMITS.ticketBody) });
  }
  const approvals = await db.query<Record<string, any>>(
    `select id, request_note, decision_note, payload, before from approvals
      where (resource = 'order' and resource_id = $1) or (resource = 'ticket' and resource_id = any($2::text[])) or (resource = 'rescue' and resource_id = any($3::text[]))`,
    [orderId, tickets.map((row) => String(row["id"])), rescues.map((row) => String(row["id"]))],
  );
  for (const row of approvals.rows) await rewrite(db, "approvals", { id: row["id"] }, row, { request_note: text(row["request_note"], LIMITS.approvalNote), decision_note: text(row["decision_note"], LIMITS.approvalNote), payload: json(row["payload"]), before: json(row["before"]) });
}

/** 脱敏之后又写进手写内容的单（`since` 之后写的）：并发窗口的兜底，定时任务再扫一次（ADR 0055）。 */
export async function listOrdersWithLateTexts(db: Db, since: Date, limit: number): Promise<string[]> {
  const late = (from: string, at: string): string => `select o.id from ${from} join orders o on o.id = x.order_id where o.passenger_anonymized_at is not null and x.${at} >= $1 and x.${at} >= o.passenger_anonymized_at`;
  const rows = await db.query<{ id: string }>(
    `select distinct id from (
       ${late("tickets x", "updated_at")}
       union all ${late("order_contacts x", "occurred_at")}
       union all ${late("order_exceptions x", "updated_at")}
       union all ${late("order_extra_charges x", "updated_at")}
       union all select o.id from ticket_messages m join tickets x on x.tenant_id = m.tenant_id and x.id = m.ticket_id join orders o on o.id = x.order_id where o.passenger_anonymized_at is not null and m.created_at >= $1 and m.created_at >= o.passenger_anonymized_at
       union all select o.id from ticket_notes n join tickets x on x.id = n.ticket_id join orders o on o.id = x.order_id where o.passenger_anonymized_at is not null and n.created_at >= $1 and n.created_at >= o.passenger_anonymized_at
     ) late limit $2`,
    [since, limit],
  );
  return rows.rows.map((row) => row.id);
}
