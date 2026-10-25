/**
 * 双人复核记录的数据访问（M2-04，ADR 0023）。平台表，只在 withPlatformTx 里调用。
 */
import type { ApprovalStatus } from "@nozomi/domain";
import type { Db } from "../db/context.ts";
import { type Page, type TimeCursor, toPage } from "../pagination.ts";
import type { AuditValues } from "./audit-logs.ts";

export interface PersonRef {
  id: string;
  name: string;
  email: string;
}

export interface Approval {
  id: string;
  kind: string;
  resource: string;
  resourceId: string;
  summary: string;
  payload: AuditValues;
  before: AuditValues | null;
  baseVersion: number | null;
  status: ApprovalStatus;
  requestedBy: PersonRef;
  requestedAt: Date;
  requestNote: string | null;
  decidedBy: PersonRef | null;
  decidedAt: Date | null;
  decisionNote: string | null;
}

interface ApprovalRow {
  id: string;
  kind: string;
  resource: string;
  resource_id: string;
  summary: string;
  payload: AuditValues;
  before: AuditValues | null;
  base_version: number | null;
  status: ApprovalStatus;
  requested_by: string;
  requester_name: string;
  requester_email: string;
  requested_at: Date;
  request_note: string | null;
  decided_by: string | null;
  decider_name: string | null;
  decider_email: string | null;
  decided_at: Date | null;
  decision_note: string | null;
}

const COLUMNS = `a.id, a.kind, a.resource, a.resource_id, a.summary, a.payload, a.before, a.base_version, a.status,
  a.requested_by, r.name as requester_name, r.email as requester_email, a.requested_at, a.request_note,
  a.decided_by, d.name as decider_name, d.email as decider_email, a.decided_at, a.decision_note`;
const FROM = "approvals a join platform_users r on r.id = a.requested_by left join platform_users d on d.id = a.decided_by";

function toApproval(row: ApprovalRow): Approval {
  return {
    id: row.id,
    kind: row.kind,
    resource: row.resource,
    resourceId: row.resource_id,
    summary: row.summary,
    payload: row.payload,
    before: row.before,
    baseVersion: row.base_version,
    status: row.status,
    requestedBy: { id: row.requested_by, name: row.requester_name, email: row.requester_email },
    requestedAt: row.requested_at,
    requestNote: row.request_note,
    decidedBy: row.decided_by === null ? null : { id: row.decided_by, name: row.decider_name ?? "", email: row.decider_email ?? "" },
    decidedAt: row.decided_at,
    decisionNote: row.decision_note,
  };
}

export interface NewApproval {
  kind: string;
  resource: string;
  resourceId: string;
  summary: string;
  payload: AuditValues;
  before: AuditValues | null;
  baseVersion: number | null;
  requestedBy: string;
  requestNote: string | null;
  now: Date;
}

export async function insertApproval(db: Db, input: NewApproval): Promise<string> {
  const result = await db.query<{ id: string }>(
    `insert into approvals (kind, resource, resource_id, summary, payload, before, base_version, requested_by, requested_at, request_note)
     values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10) returning id`,
    [input.kind, input.resource, input.resourceId, input.summary, JSON.stringify(input.payload), input.before === null ? null : JSON.stringify(input.before), input.baseVersion, input.requestedBy, input.now, input.requestNote],
  );
  return (result.rows[0] as { id: string }).id;
}

export async function findApproval(db: Db, id: string, options: { lock?: boolean } = {}): Promise<Approval | null> {
  if (options.lock) await db.query("select 1 from approvals where id = $1 for update", [id]);
  const result = await db.query<ApprovalRow>(`select ${COLUMNS} from ${FROM} where a.id = $1`, [id]);
  const row = result.rows[0];
  return row ? toApproval(row) : null;
}

export async function setApprovalDecision(db: Db, id: string, decision: { status: ApprovalStatus; decidedBy: string | null; note: string | null; now: Date }): Promise<void> {
  await db.query("update approvals set status = $2, decided_by = $3, decision_note = $4, decided_at = $5 where id = $1 and status = 'pending'", [id, decision.status, decision.decidedBy, decision.note, decision.now]);
}

export interface ApprovalFilter {
  status: ApprovalStatus | null;
  /** 只看这几类（调用方按权限算好） */
  kinds: readonly string[];
  resource: string | null;
  resourceId: string | null;
  /**
   * 数据范围（ADR 0030）：这几类的对象编号（`resource_id`）是渠道编号，只列 `channelIds` 里的；`channelIds` 为 null 不限制。
   */
  channelScopedKinds?: readonly string[];
  channelIds?: readonly string[] | null;
}

/** 按发起时间从新到旧；带 `total`。 */
export async function listApprovals(db: Db, filter: ApprovalFilter, limit: number, after: TimeCursor | null): Promise<Page<Approval> & { total: number }> {
  const where =
    "a.kind = any($1::text[]) and ($2::text is null or a.status = $2) and ($3::text is null or a.resource = $3) and ($4::text is null or a.resource_id = $4)" +
    " and ($6::text[] is null or not (a.kind = any($5::text[])) or a.resource_id = any($6::text[]))";
  const params = [filter.kinds, filter.status, filter.resource, filter.resourceId, filter.channelScopedKinds ?? [], filter.channelIds ?? null];
  const result = await db.query<ApprovalRow & { cursor_time: string }>(
    `select ${COLUMNS}, a.requested_at::text as cursor_time from ${FROM}
      where ${where} and ($7::timestamptz is null or (a.requested_at, a.id) < ($7::timestamptz, $8::uuid))
      order by a.requested_at desc, a.id desc limit $9`,
    [...params, after?.t ?? null, after?.id ?? null, limit + 1],
  );
  const total = await db.query<{ n: number }>(`select count(*)::int as n from approvals a where ${where}`, params);
  return { ...toPage(result.rows, limit, toApproval, (row) => ({ t: row.cursor_time, id: row.id })), total: (total.rows[0] as { n: number }).n };
}
