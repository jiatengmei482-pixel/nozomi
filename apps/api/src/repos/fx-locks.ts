/**
 * 汇率人工锁定的读写（M2-06，ADR 0025）。平台表，只在平台事务（withPlatformTx）里调用；租户角色对它没有任何权限。
 * 锁定值在库里是 numeric，取出来一律 `::text`——十进制原值，不经过浮点数。
 */
import type { CurrencyCode } from "@nozomi/domain";
import type { Db } from "../db/context.ts";

export type FxLockStatus = "active" | "released" | "replaced" | "expired";

export interface StaffRef {
  id: string;
  name: string;
  email: string;
}

export interface StoredFxLock {
  id: string;
  currency: CurrencyCode;
  rate: string;
  reason: string | null;
  expiresAt: Date;
  lockedAt: Date;
  centralRate: string;
  centralAsOf: Date;
  deviationBp: number;
  lockApprovalId: string;
  requestedBy: StaffRef;
  approvedBy: StaffRef;
  status: FxLockStatus;
  endedAt: Date | null;
  endApprovalId: string | null;
  endedBy: StaffRef | null;
}

interface FxLockRow {
  id: string;
  currency: CurrencyCode;
  rate: string;
  reason: string | null;
  expires_at: Date;
  locked_at: Date;
  central_rate: string;
  central_as_of: Date;
  deviation_bp: number;
  lock_approval_id: string;
  requested_by: string;
  requester_name: string;
  requester_email: string;
  approved_by: string;
  approver_name: string;
  approver_email: string;
  status: FxLockStatus;
  ended_at: Date | null;
  end_approval_id: string | null;
  ended_by: string | null;
  ender_name: string | null;
  ender_email: string | null;
}

const COLUMNS = `l.id, l.currency, l.rate::text as rate, l.reason, l.expires_at, l.locked_at, l.central_rate::text as central_rate, l.central_as_of, l.deviation_bp,
  l.lock_approval_id, l.requested_by, r.name as requester_name, r.email as requester_email, l.approved_by, a.name as approver_name, a.email as approver_email,
  l.status, l.ended_at, l.end_approval_id, l.ended_by, e.name as ender_name, e.email as ender_email`;
const FROM = "fx_locks l join platform_users r on r.id = l.requested_by join platform_users a on a.id = l.approved_by left join platform_users e on e.id = l.ended_by";

function toLock(row: FxLockRow): StoredFxLock {
  return {
    id: row.id,
    currency: row.currency,
    rate: row.rate,
    reason: row.reason,
    expiresAt: row.expires_at,
    lockedAt: row.locked_at,
    centralRate: row.central_rate,
    centralAsOf: row.central_as_of,
    deviationBp: row.deviation_bp,
    lockApprovalId: row.lock_approval_id,
    requestedBy: { id: row.requested_by, name: row.requester_name, email: row.requester_email },
    approvedBy: { id: row.approved_by, name: row.approver_name, email: row.approver_email },
    status: row.status,
    endedAt: row.ended_at,
    endApprovalId: row.end_approval_id,
    endedBy: row.ended_by === null ? null : { id: row.ended_by, name: row.ender_name ?? "", email: row.ender_email ?? "" },
  };
}

/**
 * 锁定的排他锁（事务级咨询锁）：批准锁定 / 解锁、定时任务处理到期，都先拿这把锁再看「这个币种现在有没有生效中的锁定」，
 * 两条复核同时批准时第二条看得到第一条的结果（从而按 APPROVAL_STALE 拒绝），不会撞上唯一索引。锁名带上当前 schema（集成测试各用各的）。
 */
export async function lockFxLocking(db: Db): Promise<void> {
  await db.query("select pg_advisory_xact_lock(hashtext(current_schema() || ':nozomi.fx_lock'))");
}

/** 生效中的锁定：状态是 active 且 `now` 时还没到期（到期但定时任务还没来得及改状态的，不算）。按币种排。 */
export async function activeFxLocks(db: Db, now: Date): Promise<StoredFxLock[]> {
  const result = await db.query<FxLockRow>(`select ${COLUMNS} from ${FROM} where l.status = 'active' and l.expires_at > $1 order by l.currency`, [now]);
  return result.rows.map(toLock);
}

/** 某个币种上状态还是 active 的那一条（不管到没到期），锁住它。 */
export async function activeFxLockFor(db: Db, currency: CurrencyCode, options: { lock?: boolean } = {}): Promise<StoredFxLock | null> {
  if (options.lock) await db.query("select id from fx_locks where currency = $1 and status = 'active' for update", [currency]);
  const result = await db.query<FxLockRow>(`select ${COLUMNS} from ${FROM} where l.currency = $1 and l.status = 'active'`, [currency]);
  return result.rows[0] === undefined ? null : toLock(result.rows[0]);
}

export async function findFxLock(db: Db, id: string): Promise<StoredFxLock | null> {
  const result = await db.query<FxLockRow>(`select ${COLUMNS} from ${FROM} where l.id = $1`, [id]);
  return result.rows[0] === undefined ? null : toLock(result.rows[0]);
}

/** 最近的锁定记录（含已结束的），新的在前。 */
export async function listFxLocks(db: Db, limit: number): Promise<StoredFxLock[]> {
  const result = await db.query<FxLockRow>(`select ${COLUMNS} from ${FROM} order by l.locked_at desc, l.id desc limit $1`, [limit]);
  return result.rows.map(toLock);
}

export interface NewFxLock {
  currency: CurrencyCode;
  rate: string;
  reason: string | null;
  expiresAt: Date;
  lockedAt: Date;
  centralRate: string;
  centralAsOf: Date;
  deviationBp: number;
  lockApprovalId: string;
  requestedBy: string;
  approvedBy: string;
}

export async function insertFxLock(db: Db, input: NewFxLock): Promise<string> {
  const result = await db.query<{ id: string }>(
    `insert into fx_locks (currency, rate, reason, expires_at, locked_at, central_rate, central_as_of, deviation_bp, lock_approval_id, requested_by, approved_by)
     values ($1, $2::numeric, $3, $4, $5, $6::numeric, $7, $8, $9, $10, $11) returning id`,
    [input.currency, input.rate, input.reason, input.expiresAt, input.lockedAt, input.centralRate, input.centralAsOf, input.deviationBp, input.lockApprovalId, input.requestedBy, input.approvedBy],
  );
  return (result.rows[0] as { id: string }).id;
}

/** 结束一条生效中的锁定：解锁（released）、被取代（replaced）要带复核和批准人；到期（expired）不带。只改还是 active 的。返回是否改上了。 */
export async function endFxLock(db: Db, id: string, end: { status: Exclude<FxLockStatus, "active">; at: Date; approvalId: string | null; by: string | null }): Promise<boolean> {
  const result = await db.query("update fx_locks set status = $2, ended_at = $3, end_approval_id = $4, ended_by = $5 where id = $1 and status = 'active'", [id, end.status, end.at, end.approvalId, end.by]);
  return (result.rowCount ?? 0) > 0;
}

/** 已经到期、状态还是 active 的锁定，锁住它们（定时任务把它们改成 expired）。 */
export async function overdueFxLocks(db: Db, now: Date): Promise<StoredFxLock[]> {
  const ids = await db.query<{ id: string }>("select id from fx_locks where status = 'active' and expires_at <= $1 order by currency for update", [now]);
  if (ids.rows.length === 0) return [];
  const result = await db.query<FxLockRow>(`select ${COLUMNS} from ${FROM} where l.id = any($1::uuid[]) order by l.currency`, [ids.rows.map((row) => row.id)]);
  return result.rows.map(toLock);
}
