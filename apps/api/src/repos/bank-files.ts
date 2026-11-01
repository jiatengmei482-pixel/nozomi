/**
 * 银行转账文件的取数（M5-02，ADR 0051）。`bank_files` 是平台表，`bank_file_items` 带 tenant_id，都只在平台事务里读写。
 * 账号密文只有 `listBankFileItems(…, { sealed: true })` 取：下载时解密；别的查询不取。
 */
import type { BankFileStatus, BankFileTemplateKey, ChargeBearer, CurrencyCode } from "@nozomi/domain";
import type { Db } from "../db/context.ts";

export interface BankFile {
  id: string;
  fileNo: string;
  payoutBatchId: string;
  payDate: string;
  currency: CurrencyCode;
  template: BankFileTemplateKey;
  chargeBearer: ChargeBearer;
  status: BankFileStatus;
  itemCount: number;
  totalMinor: number;
  excluded: { statement_id: string; statement_no: string; tenant_name: string; code: string }[];
  approvalId: string;
  requestedBy: string;
  approvedBy: string;
  createdAt: Date;
  firstDownloadedAt: Date | null;
  downloadCount: number;
  contentDigest: string;
  csvSha256: string | null;
  xlsxSha256: string | null;
  paidAt: Date | null;
  voidedAt: Date | null;
  voidedBy: string | null;
  voidReason: string | null;
  version: number;
}

export interface BankFileItemRow {
  tenantId: string;
  tenantName: string;
  id: string;
  fileId: string;
  seq: number;
  statementId: string;
  statementNo: string;
  accountId: string;
  amountMinor: number;
  currency: CurrencyCode;
  beneficiaryName: string;
  beneficiaryAddress: string;
  bankName: string;
  bankAddress: string;
  swiftBic: string;
  accountLast4: string;
  reference: string;
  bankReference: string | null;
  paidAt: Date | null;
  voidedAt: Date | null;
  /** 现在这家这种币种生效的账户已经不是快照里的那个了 */
  accountChanged: boolean;
}

type Row = Record<string, any>;

const FILE_COLUMNS =
  "f.id, f.file_no, f.payout_batch_id, b.pay_date::text as pay_date, f.currency, f.template, f.charge_bearer, f.status, f.item_count, f.total_minor, f.excluded, f.approval_id, f.requested_by, f.approved_by, f.created_at, f.first_downloaded_at, f.download_count, f.content_digest, f.csv_sha256, f.xlsx_sha256, f.paid_at, f.voided_at, f.voided_by, f.void_reason, f.version";

function toFile(row: Row): BankFile {
  return {
    id: row["id"],
    fileNo: row["file_no"],
    payoutBatchId: row["payout_batch_id"],
    payDate: row["pay_date"],
    currency: row["currency"],
    template: row["template"],
    chargeBearer: row["charge_bearer"],
    status: row["status"],
    itemCount: row["item_count"],
    totalMinor: Number(row["total_minor"]),
    excluded: row["excluded"],
    approvalId: row["approval_id"],
    requestedBy: row["requested_by"],
    approvedBy: row["approved_by"],
    createdAt: row["created_at"],
    firstDownloadedAt: row["first_downloaded_at"],
    downloadCount: row["download_count"],
    contentDigest: row["content_digest"],
    csvSha256: row["csv_sha256"],
    xlsxSha256: row["xlsx_sha256"],
    paidAt: row["paid_at"],
    voidedAt: row["voided_at"],
    voidedBy: row["voided_by"],
    voidReason: row["void_reason"],
    version: row["version"],
  };
}

/** 列表最多显示多少条；多取一条用来判断还有没有更多（接口返回 `truncated`，页面提示）。 */
export const BANK_LIST_LIMIT = 200;

export async function findBankFile(db: Db, id: string, options: { lock?: boolean } = {}): Promise<BankFile | null> {
  const result = await db.query(`select ${FILE_COLUMNS} from bank_files f join payout_batches b on b.id = f.payout_batch_id where f.id = $1${options.lock === true ? " for update of f" : ""}`, [id]);
  return result.rows[0] === undefined ? null : toFile(result.rows[0]);
}

export async function listBankFiles(db: Db, filter: { payoutBatchId: string | null; status: BankFileStatus | null }): Promise<BankFile[]> {
  const result = await db.query(
    `select ${FILE_COLUMNS} from bank_files f join payout_batches b on b.id = f.payout_batch_id
      where ($1::uuid is null or f.payout_batch_id = $1) and ($2::text is null or f.status = $2)
      order by f.created_at desc, f.id limit $3`,
    [filter.payoutBatchId, filter.status, BANK_LIST_LIMIT + 1],
  );
  return result.rows.map(toFile);
}

export interface NewBankFile {
  id: string;
  fileNo: string;
  payoutBatchId: string;
  currency: string;
  template: BankFileTemplateKey;
  chargeBearer: ChargeBearer;
  itemCount: number;
  totalMinor: number;
  excluded: unknown[];
  approvalId: string;
  requestedBy: string;
  approvedBy: string;
  contentDigest: string;
  now: Date;
}

export async function insertBankFile(db: Db, file: NewBankFile): Promise<void> {
  await db.query(
    `insert into bank_files (id, file_no, payout_batch_id, currency, template, charge_bearer, status, item_count, total_minor, excluded, approval_id, requested_by, approved_by, content_digest, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, 'generated', $7, $8, $9::jsonb, $10, $11, $12, $13, $14, $14)`,
    [file.id, file.fileNo, file.payoutBatchId, file.currency, file.template, file.chargeBearer, file.itemCount, file.totalMinor, JSON.stringify(file.excluded), file.approvalId, file.requestedBy, file.approvedBy, file.contentDigest, file.now],
  );
}

export async function updateBankFile(
  db: Db,
  id: string,
  fields: Partial<Record<"status" | "first_downloaded_at" | "download_count" | "csv_sha256" | "xlsx_sha256" | "paid_at" | "voided_at" | "voided_by" | "void_reason", unknown>>,
  now: Date,
): Promise<void> {
  const entries = Object.entries(fields);
  const sets = entries.map(([column], index) => `${column} = $${index + 2}`);
  await db.query(`update bank_files set ${[...sets, `updated_at = $${entries.length + 2}`, "version = version + 1"].join(", ")} where id = $1`, [id, ...entries.map(([, value]) => value), now]);
}

export interface NewBankFileItem {
  tenantId: string;
  fileId: string;
  seq: number;
  statementId: string;
  statementNo: string;
  accountId: string;
  amountMinor: number;
  currency: string;
  beneficiaryName: string;
  beneficiaryAddress: string;
  bankName: string;
  bankAddress: string;
  swiftBic: string;
  accountSealed: string;
  accountLast4: string;
  reference: string;
}

export async function insertBankFileItem(db: Db, item: NewBankFileItem): Promise<void> {
  await db.query(
    `insert into bank_file_items (tenant_id, file_id, seq, statement_id, statement_no, account_id, amount_minor, currency, beneficiary_name, beneficiary_address, bank_name, bank_address, swift_bic, account_sealed, account_last4, reference)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
    [item.tenantId, item.fileId, item.seq, item.statementId, item.statementNo, item.accountId, item.amountMinor, item.currency, item.beneficiaryName, item.beneficiaryAddress, item.bankName, item.bankAddress, item.swiftBic, item.accountSealed, item.accountLast4, item.reference],
  );
}

const ITEM_COLUMNS =
  "i.tenant_id, t.name as tenant_name, i.id, i.file_id, i.seq, i.statement_id, i.statement_no, i.account_id, i.amount_minor, i.currency, i.beneficiary_name, i.beneficiary_address, i.bank_name, i.bank_address, i.swift_bic, i.account_last4, i.reference, i.bank_reference, i.paid_at, i.voided_at";

function toItem(row: Row): BankFileItemRow {
  return {
    tenantId: row["tenant_id"],
    tenantName: row["tenant_name"],
    id: row["id"],
    fileId: row["file_id"],
    seq: row["seq"],
    statementId: row["statement_id"],
    statementNo: row["statement_no"],
    accountId: row["account_id"],
    amountMinor: Number(row["amount_minor"]),
    currency: row["currency"],
    beneficiaryName: row["beneficiary_name"],
    beneficiaryAddress: row["beneficiary_address"],
    bankName: row["bank_name"],
    bankAddress: row["bank_address"],
    swiftBic: row["swift_bic"],
    accountLast4: row["account_last4"],
    reference: row["reference"],
    bankReference: row["bank_reference"],
    paidAt: row["paid_at"],
    voidedAt: row["voided_at"],
    accountChanged: row["account_changed"] === true,
  };
}

export async function listBankFileItems(db: Db, fileId: string): Promise<BankFileItemRow[]> {
  const result = await db.query(
    `select ${ITEM_COLUMNS},
            exists (select 1 from payout_accounts a where a.tenant_id = i.tenant_id and a.currency = i.currency and a.status = 'active' and a.id <> i.account_id) as account_changed
       from bank_file_items i join tenants t on t.id = i.tenant_id where i.file_id = $1 order by i.seq`,
    [fileId],
  );
  return result.rows.map(toItem);
}

/** 下载时用：每一笔和账号密文。只有这里取条目的密文。 */
export async function listItemsForDownload(db: Db, fileId: string): Promise<(BankFileItemRow & { accountSealed: string })[]> {
  const result = await db.query(
    `select ${ITEM_COLUMNS}, i.account_sealed,
            exists (select 1 from payout_accounts a where a.tenant_id = i.tenant_id and a.currency = i.currency and a.status = 'active' and a.id <> i.account_id) as account_changed
       from bank_file_items i join tenants t on t.id = i.tenant_id where i.file_id = $1 and i.voided_at is null order by i.seq`,
    [fileId],
  );
  return result.rows.map((row) => ({ ...toItem(row), accountSealed: row["account_sealed"] as string }));
}

/** 这个批次里已经在未作废文件里的账单（账单编号 → 文件）。 */
export async function activeItemsOfBatch(db: Db, batchId: string): Promise<Map<string, { fileId: string; fileNo: string; status: BankFileStatus }>> {
  const result = await db.query<{ statement_id: string; file_id: string; file_no: string; status: BankFileStatus }>(
    `select i.statement_id, f.id as file_id, f.file_no, f.status
       from bank_file_items i join bank_files f on f.id = i.file_id
      where f.payout_batch_id = $1 and i.voided_at is null`,
    [batchId],
  );
  return new Map(result.rows.map((row) => [row.statement_id, { fileId: row.file_id, fileNo: row.file_no, status: row.status }]));
}

export async function pendingFileReviewOf(db: Db, batchId: string, currency: string): Promise<string | null> {
  const result = await db.query<{ id: string }>("select id from approvals where kind = 'bank_file.generate' and resource_id = $1 and status = 'pending' and payload ->> 'currency' = $2 order by requested_at desc limit 1", [batchId, currency]);
  return result.rows[0]?.id ?? null;
}

export async function markItemPaid(db: Db, tenantId: string, itemId: string, bankReference: string, paidBy: string, now: Date): Promise<void> {
  await db.query("update bank_file_items set bank_reference = $3, paid_at = $4, paid_by = $5 where tenant_id = $1 and id = $2", [tenantId, itemId, bankReference, now, paidBy]);
}

/** 作废文件里还没付款的条目：账单释放。返回作废了几条。 */
export async function voidUnpaidItems(db: Db, fileId: string, now: Date): Promise<number> {
  const result = await db.query("update bank_file_items set voided_at = $2 where file_id = $1 and voided_at is null and paid_at is null", [fileId, now]);
  return result.rowCount ?? 0;
}

/** 批次里所有账单都已付款后记为已付款。返回是否刚刚记上。 */
export async function markBatchPaidIfDone(db: Db, batchId: string, now: Date): Promise<boolean> {
  const result = await db.query(
    `update payout_batches b set status = 'paid', paid_at = $2, version = version + 1
      where b.id = $1 and b.status = 'closed'
        and exists (select 1 from statements s where s.payout_batch_id = b.id)
        and not exists (select 1 from statements s where s.payout_batch_id = b.id and s.status <> 'paid')`,
    [batchId, now],
  );
  return (result.rowCount ?? 0) > 0;
}
