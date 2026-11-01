/**
 * 供应商收款账户和银行转账文件（M5-02，ADR 0051）。字段与 `apps/api/openapi.yaml` 对齐，由 bank-files.contract.test.ts 保证。
 * 接口只返回账号的末 4 位（`account_masked`）；完整账号只在下载的文件里。提交账户时账号和当前密码只走请求体，页面不保存。
 */
import type { BankFileFormat, BankFileStatus, ChargeBearer, PayoutAccountKind, PayoutAccountStatus, PayoutBatchStatus, StatementFileIssue } from "@nozomi/domain";
import { TENANT_BASE, query } from "./areas.ts";
import type { Approval } from "./channels.ts";
import { type DownloadedFile, apiPostDownload, apiRequest } from "./client.ts";
import type { Money } from "./dispatch.ts";
import { PLATFORM_BASE } from "./platform.ts";
import { PAYOUT_BATCHES_PATH } from "./billing.ts";

export const PLATFORM_PAYOUT_ACCOUNTS_PATH = `${PLATFORM_BASE}/payout-accounts`;
export const BANK_FILES_PATH = `${PLATFORM_BASE}/bank-files`;
export const TENANT_PAYOUT_ACCOUNTS_PATH = `${TENANT_BASE}/payout-accounts`;

export interface TenantPayoutAccount {
  id: string;
  currency: string;
  beneficiary_name: string;
  beneficiary_address: string;
  bank_name: string;
  bank_address: string;
  swift_bic: string;
  account_kind: PayoutAccountKind;
  account_masked: string;
  status: PayoutAccountStatus;
  submitted_at: string;
  activated_at: string | null;
  superseded_at: string | null;
  rejected_at: string | null;
  reject_reason: string | null;
  withdrawn_at: string | null;
  version: number;
}

export interface TenantRef {
  id: string;
  name: string;
}

export interface PlatformPayoutAccount extends TenantPayoutAccount {
  tenant: TenantRef;
  approval_id: string | null;
  pending_approval_id: string | null;
  recently_changed: boolean;
}

export interface PayoutAccountInput {
  currency: string;
  beneficiary_name: string;
  beneficiary_address: string;
  bank_name: string;
  bank_address: string;
  swift_bic: string;
  account_kind: PayoutAccountKind;
  account_number: string;
  current_password: string;
}

export interface BankFileExcluded {
  statement_id: string;
  statement_no: string;
  tenant_id: string;
  tenant_name: string;
  code: StatementFileIssue;
  message: string;
  amount_minor: number;
}

export interface BankFile {
  id: string;
  file_no: string;
  payout_batch_id: string;
  pay_date: string;
  currency: string;
  template: string;
  charge_bearer: ChargeBearer;
  status: BankFileStatus;
  item_count: number;
  total: Money;
  excluded: BankFileExcluded[];
  approval_id: string;
  requested_by: string;
  approved_by: string;
  created_at: string;
  first_downloaded_at: string | null;
  download_count: number;
  csv_sha256: string | null;
  xlsx_sha256: string | null;
  paid_at: string | null;
  voided_at: string | null;
  void_reason: string | null;
  version: number;
}

export interface BankFileItem {
  id: string;
  seq: number;
  statement_id: string;
  statement_no: string;
  tenant: TenantRef;
  beneficiary_name: string;
  bank_name: string;
  swift_bic: string;
  account_masked: string;
  amount: Money;
  reference: string;
  bank_reference: string | null;
  paid_at: string | null;
  voided: boolean;
  account_changed: boolean;
}

export interface BankFileDetail extends BankFile {
  items: BankFileItem[];
}

export interface PreviewStatement {
  statement_id: string;
  statement_no: string;
  tenant: TenantRef;
  amount: Money;
}

export interface PreviewEligible extends PreviewStatement {
  beneficiary_name: string;
  bank_name: string;
  swift_bic: string;
  account_masked: string;
  recently_changed: boolean;
}

export interface PreviewExcluded extends PreviewStatement {
  code: StatementFileIssue;
  message: string;
}

export interface PreviewInFile extends PreviewStatement {
  file_id: string;
  file_no: string;
  file_status: BankFileStatus;
}

export interface BankFilePreviewGroup {
  currency: string;
  pending_approval_id: string | null;
  total: Money;
  eligible: PreviewEligible[];
  excluded: PreviewExcluded[];
  in_files: PreviewInFile[];
}

export interface BankFilePreview {
  batch_id: string;
  pay_date: string;
  batch_status: PayoutBatchStatus;
  groups: BankFilePreviewGroup[];
}

// ---- 供应商 ----

export function listTenantPayoutAccounts(token: string): Promise<{ items: TenantPayoutAccount[] }> {
  return apiRequest("GET", TENANT_PAYOUT_ACCOUNTS_PATH, { token });
}

export function submitPayoutAccount(token: string, input: PayoutAccountInput): Promise<{ account: TenantPayoutAccount }> {
  return apiRequest("POST", TENANT_PAYOUT_ACCOUNTS_PATH, { token, body: input });
}

export function withdrawPayoutAccount(token: string, id: string): Promise<{ account: TenantPayoutAccount }> {
  return apiRequest("POST", `${TENANT_PAYOUT_ACCOUNTS_PATH}/${encodeURIComponent(id)}/withdraw`, { token });
}

// ---- 运营后台 ----

export function listPlatformPayoutAccounts(token: string, values: { status?: PayoutAccountStatus } = {}): Promise<{ items: PlatformPayoutAccount[] }> {
  return apiRequest("GET", query(PLATFORM_PAYOUT_ACCOUNTS_PATH, values), { token });
}

export function requestPayoutAccountReview(token: string, id: string, note: string | null): Promise<{ approval: Approval }> {
  return apiRequest("POST", `${PLATFORM_PAYOUT_ACCOUNTS_PATH}/${encodeURIComponent(id)}/approval`, { token, body: { note } });
}

export function rejectPayoutAccount(token: string, id: string, reason: string): Promise<{ account: PlatformPayoutAccount }> {
  return apiRequest("POST", `${PLATFORM_PAYOUT_ACCOUNTS_PATH}/${encodeURIComponent(id)}/reject`, { token, body: { reason } });
}

export function getBankFilePreview(token: string, batchId: string): Promise<{ preview: BankFilePreview }> {
  return apiRequest("GET", `${PAYOUT_BATCHES_PATH}/${encodeURIComponent(batchId)}/bank-file-preview`, { token });
}

export function requestBankFile(token: string, batchId: string, body: { currency: string; charge_bearer: ChargeBearer; allow_exclusions: boolean; note: string | null }): Promise<{ approval: Approval }> {
  return apiRequest("POST", `${PAYOUT_BATCHES_PATH}/${encodeURIComponent(batchId)}/bank-files`, { token, body });
}

export function listBankFiles(token: string, values: { payout_batch_id?: string } = {}): Promise<{ items: BankFile[] }> {
  return apiRequest("GET", query(BANK_FILES_PATH, values), { token });
}

export function getBankFile(token: string, id: string): Promise<{ file: BankFileDetail }> {
  return apiRequest("GET", `${BANK_FILES_PATH}/${encodeURIComponent(id)}`, { token });
}

export function downloadBankFile(token: string, id: string, format: BankFileFormat): Promise<DownloadedFile> {
  return apiPostDownload(`${BANK_FILES_PATH}/${encodeURIComponent(id)}/download`, { format }, format === "csv" ? { token, accept: "text/csv" } : { token });
}

export function recordBankFilePayments(token: string, id: string, payments: { item_id: string; bank_reference: string }[]): Promise<{ file: BankFileDetail }> {
  return apiRequest("POST", `${BANK_FILES_PATH}/${encodeURIComponent(id)}/payments`, { token, body: { payments } });
}

export function voidBankFile(token: string, id: string, reason: string): Promise<{ file: BankFileDetail }> {
  return apiRequest("POST", `${BANK_FILES_PATH}/${encodeURIComponent(id)}/void`, { token, body: { reason } });
}

/** 合同测试用：前端读的字段（必须和 openapi.yaml 里这几个结构的字段一模一样）。 */
export const BANK_FILE_SCHEMA_FIELDS = {
  TenantPayoutAccount: ["id", "currency", "beneficiary_name", "beneficiary_address", "bank_name", "bank_address", "swift_bic", "account_kind", "account_masked", "status", "submitted_at", "activated_at", "superseded_at", "rejected_at", "reject_reason", "withdrawn_at", "version"],
  PlatformPayoutAccount: ["id", "currency", "beneficiary_name", "beneficiary_address", "bank_name", "bank_address", "swift_bic", "account_kind", "account_masked", "status", "submitted_at", "activated_at", "superseded_at", "rejected_at", "reject_reason", "withdrawn_at", "version", "tenant", "approval_id", "pending_approval_id", "recently_changed"],
  BankFile: ["id", "file_no", "payout_batch_id", "pay_date", "currency", "template", "charge_bearer", "status", "item_count", "total", "excluded", "approval_id", "requested_by", "approved_by", "created_at", "first_downloaded_at", "download_count", "csv_sha256", "xlsx_sha256", "paid_at", "voided_at", "void_reason", "version"],
  BankFileItem: ["id", "seq", "statement_id", "statement_no", "tenant", "beneficiary_name", "bank_name", "swift_bic", "account_masked", "amount", "reference", "bank_reference", "paid_at", "voided", "account_changed"],
} as const satisfies {
  TenantPayoutAccount: readonly (keyof TenantPayoutAccount)[];
  PlatformPayoutAccount: readonly (keyof PlatformPayoutAccount)[];
  BankFile: readonly (keyof BankFile)[];
  BankFileItem: readonly (keyof BankFileItem)[];
};
