/**
 * 供应商收款账户的取数（M5-02，ADR 0051）。
 * - `PUBLIC_COLUMNS` 不含密文：供应商的查询和所有列表都只取这些。
 * - 密文只有 `sealedAccountsOf` 取（发起生成时核对账号）。写都在平台事务里，内容不可变（数据库触发器把关）。
 */
import type { CurrencyCode, PayoutAccountKind, PayoutAccountStatus } from "@nozomi/domain";
import type { Db } from "../db/context.ts";

export interface PayoutAccount {
  tenantId: string;
  id: string;
  currency: CurrencyCode;
  beneficiaryName: string;
  beneficiaryAddress: string;
  bankName: string;
  bankAddress: string;
  swiftBic: string;
  accountKind: PayoutAccountKind;
  accountLast4: string;
  status: PayoutAccountStatus;
  submittedBy: string;
  submittedAt: Date;
  approvalId: string | null;
  activatedAt: Date | null;
  replacedPrevious: boolean;
  supersededAt: Date | null;
  rejectedAt: Date | null;
  rejectReason: string | null;
  withdrawnAt: Date | null;
  version: number;
  updatedAt: Date;
}

const PUBLIC_COLUMNS =
  "a.tenant_id, a.id, a.currency, a.beneficiary_name, a.beneficiary_address, a.bank_name, a.bank_address, a.swift_bic, a.account_kind, a.account_last4, a.status, a.submitted_by, a.submitted_at, a.approval_id, a.activated_at, a.replaced_previous, a.superseded_at, a.rejected_at, a.reject_reason, a.withdrawn_at, a.version, a.updated_at";

type Row = Record<string, any>;

function toAccount(row: Row): PayoutAccount {
  return {
    tenantId: row["tenant_id"],
    id: row["id"],
    currency: row["currency"],
    beneficiaryName: row["beneficiary_name"],
    beneficiaryAddress: row["beneficiary_address"],
    bankName: row["bank_name"],
    bankAddress: row["bank_address"],
    swiftBic: row["swift_bic"],
    accountKind: row["account_kind"],
    accountLast4: row["account_last4"],
    status: row["status"],
    submittedBy: row["submitted_by"],
    submittedAt: row["submitted_at"],
    approvalId: row["approval_id"],
    activatedAt: row["activated_at"],
    replacedPrevious: row["replaced_previous"],
    supersededAt: row["superseded_at"],
    rejectedAt: row["rejected_at"],
    rejectReason: row["reject_reason"],
    withdrawnAt: row["withdrawn_at"],
    version: row["version"],
    updatedAt: row["updated_at"],
  };
}

export interface NewPayoutAccount {
  tenantId: string;
  id: string;
  currency: string;
  beneficiaryName: string;
  beneficiaryAddress: string;
  bankName: string;
  bankAddress: string;
  swiftBic: string;
  accountKind: PayoutAccountKind;
  accountSealed: string;
  accountLast4: string;
  submittedBy: string;
  now: Date;
}

export async function insertPayoutAccount(db: Db, input: NewPayoutAccount): Promise<void> {
  await db.query(
    `insert into payout_accounts (tenant_id, id, currency, beneficiary_name, beneficiary_address, bank_name, bank_address, swift_bic, account_kind, account_sealed, account_last4, status, submitted_by, submitted_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending', $12, $13, $13)`,
    [input.tenantId, input.id, input.currency, input.beneficiaryName, input.beneficiaryAddress, input.bankName, input.bankAddress, input.swiftBic, input.accountKind, input.accountSealed, input.accountLast4, input.submittedBy, input.now],
  );
}

export async function findPayoutAccount(db: Db, id: string, options: { tenantId?: string; lock?: boolean } = {}): Promise<PayoutAccount | null> {
  const result = await db.query(
    `select ${PUBLIC_COLUMNS} from payout_accounts a where a.id = $1 and ($2::uuid is null or a.tenant_id = $2)${options.lock === true ? " for update" : ""}`,
    [id, options.tenantId ?? null],
  );
  return result.rows[0] === undefined ? null : toAccount(result.rows[0]);
}

/** 一家供应商的全部账户（租户事务里按行级安全读）：先生效的、再新的。 */
export async function listTenantPayoutAccounts(db: Db, tenantId: string): Promise<PayoutAccount[]> {
  const result = await db.query(`select ${PUBLIC_COLUMNS} from payout_accounts a where a.tenant_id = $1 order by a.submitted_at desc, a.id limit 200`, [tenantId]);
  return result.rows.map(toAccount);
}

export async function listPlatformPayoutAccounts(db: Db, filter: { status: PayoutAccountStatus | null; tenantId: string | null }): Promise<(PayoutAccount & { tenantName: string; pendingApprovalId: string | null })[]> {
  const result = await db.query(
    `select ${PUBLIC_COLUMNS}, t.name as tenant_name,
            (select r.id from approvals r where r.kind = 'payout_account.activate' and r.resource_id = a.id::text and r.status = 'pending' limit 1) as pending_approval_id
       from payout_accounts a join tenants t on t.id = a.tenant_id
      where ($1::text is null or a.status = $1) and ($2::uuid is null or a.tenant_id = $2)
      order by a.submitted_at desc, a.id limit 200`,
    [filter.status, filter.tenantId],
  );
  return result.rows.map((row) => ({ ...toAccount(row), tenantName: row["tenant_name"], pendingApprovalId: row["pending_approval_id"] }));
}

export async function findPendingAccount(db: Db, tenantId: string, currency: string): Promise<string | null> {
  const result = await db.query<{ id: string }>("select id from payout_accounts where tenant_id = $1 and currency = $2 and status = 'pending'", [tenantId, currency]);
  return result.rows[0]?.id ?? null;
}

export async function findActiveAccount(db: Db, tenantId: string, currency: string, options: { lock?: boolean } = {}): Promise<PayoutAccount | null> {
  const result = await db.query(`select ${PUBLIC_COLUMNS} from payout_accounts a where a.tenant_id = $1 and a.currency = $2 and a.status = 'active'${options.lock === true ? " for update" : ""}`, [tenantId, currency]);
  return result.rows[0] === undefined ? null : toAccount(result.rows[0]);
}

export async function updatePayoutAccount(
  db: Db,
  tenantId: string,
  id: string,
  fields: Partial<Record<"status" | "approval_id" | "activated_at" | "replaced_previous" | "superseded_at" | "rejected_at" | "rejected_by" | "reject_reason" | "withdrawn_at", unknown>>,
  now: Date,
): Promise<void> {
  const entries = Object.entries(fields);
  const sets = entries.map(([column], index) => `${column} = $${index + 3}`);
  await db.query(`update payout_accounts set ${[...sets, `updated_at = $${entries.length + 3}`, "version = version + 1"].join(", ")} where tenant_id = $1 and id = $2`, [tenantId, id, ...entries.map(([, value]) => value), now]);
}

export async function pendingAccountReviewOf(db: Db, accountId: string): Promise<string | null> {
  const result = await db.query<{ id: string }>("select id from approvals where kind = 'payout_account.activate' and resource_id = $1 and status = 'pending' order by requested_at desc limit 1", [accountId]);
  return result.rows[0]?.id ?? null;
}

/** 这些供应商的生效、待审核账户（生成文件时分组用；不含密文）。 */
export async function listUsableAccounts(db: Db, tenantIds: readonly string[]): Promise<PayoutAccount[]> {
  if (tenantIds.length === 0) return [];
  const result = await db.query(`select ${PUBLIC_COLUMNS} from payout_accounts a where a.tenant_id = any($1::uuid[]) and a.status in ('active', 'pending')`, [tenantIds]);
  return result.rows.map(toAccount);
}

/** 账户的密文（编号 → 密文）。只有发起生成（核对账号）和生成文件条目时用。 */
export async function sealedAccountsOf(db: Db, keys: readonly { tenantId: string; id: string }[]): Promise<Map<string, string>> {
  if (keys.length === 0) return new Map();
  const result = await db.query<{ id: string; account_sealed: string }>("select id, account_sealed from payout_accounts where id = any($1::uuid[])", [keys.map((key) => key.id)]);
  return new Map(result.rows.map((row) => [row.id, row.account_sealed]));
}
