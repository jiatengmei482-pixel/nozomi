/**
 * 供应商改名称、法定名称、登记号的申请（M4-34，ADR 0071）的取数。
 * 供应商只读自己的（行级安全 + 每条 SQL 带 `tenant_id`）；提交、撤回、驳回、批准都在平台事务里写，申请内容不可变（数据库触发器把关）。
 */
import type { ProfileChangeField, ProfileChangeStatus } from "@nozomi/domain";
import type { Db } from "../db/context.ts";

export type ProfileChangeValues = Partial<Record<ProfileChangeField, string | null>>;

export interface ProfileChange {
  tenantId: string;
  id: string;
  fields: ProfileChangeField[];
  proposed: ProfileChangeValues;
  previous: ProfileChangeValues;
  note: string | null;
  status: ProfileChangeStatus;
  submittedBy: { id: string; name: string | null; email: string | null };
  submittedAt: Date;
  approvalId: string | null;
  decidedAt: Date | null;
  rejectedBy: { id: string; name: string; email: string } | null;
  rejectReason: string | null;
  /** 等平台审核的那条复核（只在平台的查询里有） */
  pendingApprovalId: string | null;
  version: number;
  updatedAt: Date;
}

type Row = Record<string, any>;

const COLUMNS = `c.tenant_id, c.id, c.fields, c.proposed, c.previous, c.note, c.status, c.submitted_by, c.submitted_at, c.approval_id, c.decided_at,
  c.rejected_by, c.reject_reason, c.version, c.updated_at, u.name as submitted_by_name, u.email as submitted_by_email`;

function toChange(row: Row): ProfileChange {
  return {
    tenantId: row["tenant_id"],
    id: row["id"],
    fields: row["fields"],
    proposed: row["proposed"],
    previous: row["previous"],
    note: row["note"],
    status: row["status"],
    submittedBy: { id: row["submitted_by"], name: row["submitted_by_name"] ?? null, email: row["submitted_by_email"] ?? null },
    submittedAt: row["submitted_at"],
    approvalId: row["approval_id"],
    decidedAt: row["decided_at"],
    rejectedBy: row["rejected_by"] === null || row["rejected_by"] === undefined ? null : { id: row["rejected_by"], name: row["rejected_by_name"] ?? "", email: row["rejected_by_email"] ?? "" },
    rejectReason: row["reject_reason"],
    pendingApprovalId: row["pending_approval_id"] ?? null,
    version: row["version"],
    updatedAt: row["updated_at"],
  };
}

/** 供应商自己的（租户事务）：不带平台员工的身份。 */
export async function listOwnProfileChanges(db: Db, tenantId: string, limit: number): Promise<ProfileChange[]> {
  const result = await db.query<Row>(
    `select ${COLUMNS} from tenant_profile_changes c left join tenant_users u on u.tenant_id = c.tenant_id and u.id = c.submitted_by
      where c.tenant_id = $1 order by c.submitted_at desc, c.id limit $2`,
    [tenantId, limit],
  );
  return result.rows.map(toChange);
}

const PLATFORM_COLUMNS = `${COLUMNS}, r.name as rejected_by_name, r.email as rejected_by_email,
  (select a.id from approvals a where a.kind = 'tenant.profile_change' and a.resource_id = c.id::text and a.status = 'pending' order by a.requested_at desc limit 1) as pending_approval_id`;
const PLATFORM_FROM = `tenant_profile_changes c
  left join tenant_users u on u.tenant_id = c.tenant_id and u.id = c.submitted_by
  left join platform_users r on r.id = c.rejected_by`;

/** 平台看一家的（平台事务）：带提交人、驳回人和等审核的复核。 */
export async function listProfileChangesForPlatform(db: Db, tenantId: string, limit: number): Promise<ProfileChange[]> {
  const result = await db.query<Row>(`select ${PLATFORM_COLUMNS} from ${PLATFORM_FROM} where c.tenant_id = $1 order by c.submitted_at desc, c.id limit $2`, [tenantId, limit]);
  return result.rows.map(toChange);
}

/** 平台事务里按编号取一条。`tenantId` 给了就只在这家里找（供应商撤回时用令牌里的租户）。 */
export async function findProfileChange(db: Db, id: string, options: { tenantId?: string; lock?: boolean } = {}): Promise<ProfileChange | null> {
  const result = await db.query<Row>(
    `select ${PLATFORM_COLUMNS} from ${PLATFORM_FROM} where c.id = $1 and ($2::uuid is null or c.tenant_id = $2) ${options.lock === true ? "for update of c" : ""}`,
    [id, options.tenantId ?? null],
  );
  const row = result.rows[0];
  return row ? toChange(row) : null;
}

export async function findPendingProfileChange(db: Db, tenantId: string): Promise<string | null> {
  const result = await db.query<{ id: string }>("select id from tenant_profile_changes where tenant_id = $1 and status = 'pending'", [tenantId]);
  return result.rows[0]?.id ?? null;
}

export async function insertProfileChange(
  db: Db,
  input: { tenantId: string; fields: readonly ProfileChangeField[]; proposed: ProfileChangeValues; previous: ProfileChangeValues; note: string | null; submittedBy: string; now: Date },
): Promise<string> {
  const result = await db.query<{ id: string }>(
    `insert into tenant_profile_changes (tenant_id, fields, proposed, previous, note, status, submitted_by, submitted_at, updated_at)
     values ($1, $2::text[], $3::jsonb, $4::jsonb, $5, 'pending', $6, $7, $7) returning id`,
    [input.tenantId, input.fields, JSON.stringify(input.proposed), JSON.stringify(input.previous), input.note, input.submittedBy, input.now],
  );
  return (result.rows[0] as { id: string }).id;
}

/** 改状态和审核字段（版本加一）。调用方已锁住这一行。 */
export async function decideProfileChange(
  db: Db,
  tenantId: string,
  id: string,
  decision: { status: "approved"; approvalId: string } | { status: "rejected"; rejectedBy: string; reason: string } | { status: "withdrawn" },
  now: Date,
): Promise<void> {
  await db.query(
    `update tenant_profile_changes
        set status = $3, approval_id = $4, rejected_by = $5, reject_reason = $6, decided_at = $7, version = version + 1, updated_at = $7
      where tenant_id = $1 and id = $2`,
    [
      tenantId,
      id,
      decision.status,
      decision.status === "approved" ? decision.approvalId : null,
      decision.status === "rejected" ? decision.rejectedBy : null,
      decision.status === "rejected" ? decision.reason : null,
      now,
    ],
  );
}
