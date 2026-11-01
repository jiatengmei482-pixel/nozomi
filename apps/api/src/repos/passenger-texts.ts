/**
 * 一单的手写内容（M4-21，ADR 0055）：`POST /platform/v1/orders/{id}/passenger/reveal` 用来给原文。平台事务里调用。
 * 这些字段在运营接口里都是打码的；这里只负责找出来，给谁、给多少在 `services/passenger-privacy.ts`。
 */
import { HANDWRITTEN_KEYS, type PassengerContact, isPassengerPlaceholder, scrubContactsInText } from "@nozomi/domain";
import { type Db, passengerCryptoOf } from "../db/context.ts";
import { readChangeValues } from "./order-changes.ts";

export const HANDWRITTEN_SOURCES = [
  "order_cancel_note",
  "contact_note",
  "event_proxy_reason",
  "change_before",
  "change_after",
  "change_decision_note",
  "extra_charge_description",
  "extra_charge_dispute_reason",
  "extra_charge_decision_note",
  "rescue_reason",
  "rescue_force_majeure_note",
  "rescue_decline_reason",
  "exception_resolution",
  "ticket_subject",
  "ticket_description",
  "ticket_decision_note",
  "ticket_close_note",
  "ticket_message",
  "ticket_note",
  "approval_request_note",
  "approval_decision_note",
  "approval_payload",
] as const;
export type HandwrittenSource = (typeof HANDWRITTEN_SOURCES)[number];

export interface HandwrittenText {
  source: HandwrittenSource;
  sourceId: string | null;
  text: string;
}

/** 这几单用过的所有姓名：现在的，加上改单前后值里的旧姓名（手写内容可能写的是旧姓名）。脱敏过的没有。 */
export async function listPassengerNames(db: Db, orderIds: readonly string[]): Promise<Map<string, string[]>> {
  if (orderIds.length === 0) return new Map();
  const crypto = passengerCryptoOf(db);
  const orders = await db.query<{ tenant_id: string; id: string; passenger: PassengerContact; passenger_enc: string | null }>("select tenant_id, id, passenger, passenger_enc from orders where id = any($1::uuid[])", [orderIds]);
  const changes = await db.query<{ tenant_id: string; id: string; order_id: string; values_enc: string | null; before: Record<string, unknown>; after: Record<string, unknown> }>("select tenant_id, id, order_id, values_enc, before, after from order_changes where order_id = any($1::uuid[]) and (before ? 'passenger' or after ? 'passenger')", [orderIds]);
  const found = new Map<string, Set<string>>();
  const add = (orderId: string, name: unknown): void => {
    if (typeof name !== "string" || isPassengerPlaceholder(name)) return;
    found.set(orderId, (found.get(orderId) ?? new Set()).add(name));
  };
  for (const row of orders.rows) add(row.id, crypto.readOrderPassenger(row.tenant_id, row.id, row.passenger_enc, row.passenger).name);
  for (const row of changes.rows) {
    const values = readChangeValues(db, row);
    for (const side of [values.before, values.after]) add(row.order_id, (side["passenger"] as { name?: unknown } | undefined)?.name);
  }
  return new Map([...found].map(([orderId, names]) => [orderId, [...names]]));
}

/**
 * 写手写内容之前调用（ADR 0055）：在同一个事务里给订单加 key share 锁，脱敏事务（for update）提交之前这里会等，等到之后读到的就是脱敏后的状态。
 * 已脱敏的单，返回的函数按规则清掉联系方式再存（供应商、渠道、客人的接口因此也看不到原文）；没脱敏的原样。
 */
export async function textForOrder(db: Db, orderId: string): Promise<(text: string) => string> {
  const rows = await db.query<{ passenger_anonymized_at: Date | null }>("select passenger_anonymized_at from orders where id = $1 for key share", [orderId]);
  return rows.rows.some((row) => row.passenger_anonymized_at !== null) ? (text) => scrubContactsInText(text, []) : (text) => text;
}

/** 改单前后值里的文字：乘客三项连成一行，即时通讯账号带上是哪个软件。 */
function changeTexts(values: Record<string, unknown>): string[] {
  const out: string[] = [];
  const passenger = values["passenger"] as { name?: string; phone?: string; email?: string } | undefined;
  if (passenger !== undefined) out.push([passenger.name, passenger.phone, passenger.email].filter((item) => item !== undefined).join(" · "));
  const messaging = values["messaging"] as { app?: string; handle?: string } | null | undefined;
  if (messaging !== null && messaging !== undefined) out.push(`${messaging.app ?? ""} ${messaging.handle ?? ""}`.trim());
  if (typeof values["notes"] === "string") out.push(values["notes"]);
  return out;
}

function handwrittenValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(handwrittenValues);
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, item]) => (HANDWRITTEN_KEYS.has(key) && typeof item === "string" ? [item] : handwrittenValues(item)));
}

export async function listOrderHandwriting(db: Db, orderId: string, allowed: { tickets: boolean; approvalKinds: readonly string[] }): Promise<HandwrittenText[]> {
  const out: HandwrittenText[] = [];
  const add = (source: HandwrittenSource, sourceId: string | null, text: string | null): void => {
    if (text !== null && text !== "") out.push({ source, sourceId, text });
  };
  for (const row of (await db.query<{ cancel_note: string | null }>("select cancel_note from orders where id = $1", [orderId])).rows) add("order_cancel_note", null, row.cancel_note);
  for (const row of (await db.query<{ id: string; note: string | null }>("select id, note from order_contacts where order_id = $1 order by occurred_at, id", [orderId])).rows) add("contact_note", row.id, row.note);
  for (const row of (await db.query<{ id: string; reason: string | null }>("select id, detail ->> 'proxy_reason' as reason from order_events where order_id = $1 and detail ? 'proxy_reason' order by seq", [orderId])).rows) add("event_proxy_reason", row.id, row.reason);
  for (const row of (await db.query<{ tenant_id: string; id: string; values_enc: string | null; before: Record<string, unknown>; after: Record<string, unknown>; decision_note: string | null }>("select tenant_id, id, values_enc, before, after, decision_note from order_changes where order_id = $1 order by seq", [orderId])).rows) {
    const values = readChangeValues(db, row);
    for (const text of changeTexts(values.before)) add("change_before", row.id, text);
    for (const text of changeTexts(values.after)) add("change_after", row.id, text);
    add("change_decision_note", row.id, row.decision_note);
  }
  for (const row of (await db.query<{ id: string; description: string | null; dispute_reason: string | null; decision_note: string | null }>("select id, description, dispute_reason, decision_note from order_extra_charges where order_id = $1 order by submitted_at, id", [orderId])).rows) {
    add("extra_charge_description", row.id, row.description);
    add("extra_charge_dispute_reason", row.id, row.dispute_reason);
    add("extra_charge_decision_note", row.id, row.decision_note);
  }
  const rescues = (await db.query<{ id: string; reason: string | null; force_majeure_note: string | null }>("select id, reason, force_majeure_note from order_rescues where order_id = $1 order by triggered_at, id", [orderId])).rows;
  for (const row of rescues) {
    add("rescue_reason", row.id, row.reason);
    add("rescue_force_majeure_note", row.id, row.force_majeure_note);
  }
  for (const row of (await db.query<{ id: string; decline_reason: string | null }>("select id, decline_reason from order_rescue_offers where order_id = $1 order by offered_at, id", [orderId])).rows) add("rescue_decline_reason", row.id, row.decline_reason);
  for (const row of (await db.query<{ id: string; resolution: string | null }>("select id, resolution from order_exceptions where order_id = $1 order by opened_at, id", [orderId])).rows) add("exception_resolution", row.id, row.resolution);

  const tickets = (await db.query<{ tenant_id: string; id: string; subject: string; description: string; decision_note: string | null; close_note: string | null }>("select tenant_id, id, subject, description, decision_note, close_note from tickets where order_id = $1 order by created_at, id", [orderId])).rows;
  if (allowed.tickets) {
    for (const row of tickets) {
      add("ticket_subject", row.id, row.subject);
      add("ticket_description", row.id, row.description);
      add("ticket_decision_note", row.id, row.decision_note);
      add("ticket_close_note", row.id, row.close_note);
      for (const message of (await db.query<{ body: string }>("select body from ticket_messages where tenant_id = $1 and ticket_id = $2 order by seq", [row.tenant_id, row.id])).rows) add("ticket_message", row.id, message.body);
      for (const note of (await db.query<{ body: string }>("select body from ticket_notes where ticket_id = $1 order by seq", [row.id])).rows) add("ticket_note", row.id, note.body);
    }
  }
  if (allowed.approvalKinds.length > 0) {
    const approvals = await db.query<{ id: string; request_note: string | null; decision_note: string | null; payload: unknown }>(
      `select id, request_note, decision_note, payload from approvals
        where kind = any($1::text[]) and ((resource = 'order' and resource_id = $2) or (resource = 'ticket' and resource_id = any($3::text[])) or (resource = 'rescue' and resource_id = any($4::text[])))
        order by requested_at, id`,
      [allowed.approvalKinds, orderId, tickets.map((row) => row.id), rescues.map((row) => row.id)],
    );
    for (const row of approvals.rows) {
      add("approval_request_note", row.id, row.request_note);
      add("approval_decision_note", row.id, row.decision_note);
      for (const text of handwrittenValues(row.payload)) add("approval_payload", row.id, text);
    }
  }
  return out;
}
