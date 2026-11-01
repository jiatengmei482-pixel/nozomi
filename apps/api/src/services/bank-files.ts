/**
 * 银行转账文件的流程（M5-02，ADR 0051）。规则和文件内容在 @nozomi/domain 的 bank-transfer.ts，取数在 repos/bank-files.ts。
 *
 * - 按「付款批次 + 币种」出文件；批次要先锁定。预览列出能进的、有问题的（不静默跳过）、已在文件里的。
 * - 生成走双人复核（`bank_file.generate`）：文件在批准的事务里生成，批准时重新核对账单和账户没变。
 * - 一张账单同时只能在一个未作废的文件里（数据库唯一索引）。
 * - 文件内容不存：下载时从条目快照在内存里生成（只有这时解密账号），第一次记 SHA-256，之后再下载核对。每次下载一条审计，没有账号。
 * - 回填流水号：账单记为已付款、推 `payout.paid`；批次的账单都付完后批次记为已付款。
 */
import { createHash, randomInt, randomUUID } from "node:crypto";
import {
  type BankFileContent,
  type BankFileFormat,
  type BankFileStatus,
  type ChargeBearer,
  type CurrencyCode,
  DEFAULT_BANK_FILE_TEMPLATE,
  ORDER_NO_ALPHABET,
  STATEMENT_FILE_ISSUE_MESSAGES,
  type StatementFileIssue,
  accountLast4,
  accountNumberIssue,
  accountRecentlyChanged,
  bankFileColumnWidths,
  bankFileCsv,
  bankFileIntegrityIssue,
  bankFileName,
  bankFileRows,
  bankFileSummaryRows,
  bankFileTotal,
  formatMajor,
  maskAccount,
  paymentReference,
  statementFileIssue,
} from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { type Db, withPlatformTx } from "../db/context.ts";
import { AppError } from "../errors.ts";
import { SecretBoxError } from "../integrations/secret-box.ts";
import { XLSX_CONTENT_TYPE, writeXlsx } from "../integrations/xlsx.ts";
import type { Approval } from "../repos/approvals.ts";
import { insertAuditLog } from "../repos/audit-logs.ts";
import {
  type BankFile,
  type BankFileItemRow,
  activeItemsOfBatch,
  findBankFile,
  insertBankFile,
  insertBankFileItem,
  listBankFileItems,
  listBankFiles,
  listItemsForDownload,
  markBatchPaidIfDone,
  markItemPaid,
  pendingFileReviewOf,
  updateBankFile,
  voidUnpaidItems,
} from "../repos/bank-files.ts";
import { type PayoutBatch, type Statement, findBatch, findStatement, insertStatementEvent, listBatchStatements, updateStatement } from "../repos/billing.ts";
import { type PayoutAccount, listUsableAccounts, sealedAccountsOf } from "../repos/payout-accounts.ts";
import { type ApprovalKind, approvalStale, requestApproval } from "./approvals.ts";
import { consoleOrigin, platformActor } from "./audit.ts";
import { notFound } from "./errors.ts";
import type { PlatformPrincipal } from "./platform-auth.ts";
import { openAccountNumber, payoutMac } from "./payout-accounts.ts";
import { enqueueTenantEvent } from "./tenant-webhooks.ts";

type BatchStatement = Statement & { tenantName: string };

export interface EligibleStatement {
  statement: BatchStatement;
  account: PayoutAccount;
  recentlyChanged: boolean;
}

export interface ExcludedStatement {
  statement: BatchStatement;
  code: StatementFileIssue;
}

export interface CurrencyGroup {
  currency: string;
  eligible: EligibleStatement[];
  excluded: ExcludedStatement[];
  inFiles: { statement: BatchStatement; fileId: string; fileNo: string; fileStatus: BankFileStatus }[];
  pendingApprovalId: string | null;
}

/** 把批次里的账单按币种分成能进文件的、有问题的、已在文件里的（调用方的事务里）。序号按账单号排，每次一样。 */
async function groupBatch(db: Db, batch: PayoutBatch, now: Date): Promise<CurrencyGroup[]> {
  const statements = await listBatchStatements(db, batch.id);
  const accounts = await listUsableAccounts(db, [...new Set(statements.map((statement) => statement.tenantId))]);
  const inFiles = await activeItemsOfBatch(db, batch.id);
  const groups = new Map<string, CurrencyGroup>();
  for (const statement of [...statements].sort((x, y) => (x.statementNo < y.statementNo ? -1 : 1))) {
    let group = groups.get(statement.currency);
    if (group === undefined) {
      group = { currency: statement.currency, eligible: [], excluded: [], inFiles: [], pendingApprovalId: await pendingFileReviewOf(db, batch.id, statement.currency) };
      groups.set(statement.currency, group);
    }
    const file = inFiles.get(statement.id);
    if (file !== undefined) {
      group.inFiles.push({ statement, fileId: file.fileId, fileNo: file.fileNo, fileStatus: file.status });
      continue;
    }
    const ofTenant = accounts.filter((account) => account.tenantId === statement.tenantId && account.currency === statement.currency);
    const active = ofTenant.find((account) => account.status === "active") ?? null;
    const code = statementFileIssue(statement, { active, hasPending: ofTenant.some((account) => account.status === "pending") });
    if (code !== null || active === null) group.excluded.push({ statement, code: code ?? "ACCOUNT_MISSING" });
    else group.eligible.push({ statement, account: active, recentlyChanged: accountRecentlyChanged(active, now) });
  }
  return [...groups.values()].sort((x, y) => (x.currency < y.currency ? -1 : 1));
}

export interface BatchPreview {
  batch: PayoutBatch;
  groups: CurrencyGroup[];
}

/** 预览：不解密账号。 */
export async function previewBatch(ctx: AppContext, batchId: string): Promise<BatchPreview> {
  const now = ctx.now();
  return withPlatformTx(
    ctx.pool,
    async (db) => {
      const batch = await findBatch(db, batchId);
      if (batch === null) throw notFound("付款批次");
      return { batch, groups: await groupBatch(db, batch, now) };
    },
    { snapshot: true },
  );
}

function excludedJson(entry: ExcludedStatement): { statement_id: string; statement_no: string; tenant_id: string; tenant_name: string; code: StatementFileIssue; message: string; amount_minor: number } {
  return { statement_id: entry.statement.id, statement_no: entry.statement.statementNo, tenant_id: entry.statement.tenantId, tenant_name: entry.statement.tenantName, code: entry.code, message: STATEMENT_FILE_ISSUE_MESSAGES[entry.code], amount_minor: entry.statement.totalMinor };
}

/** 账号解得开、还合规则、末 4 位对得上吗（发起生成和批准时都查；解开的账号只在这里用一下）。 */
function numberProblem(ctx: AppContext, entry: EligibleStatement, sealed: string | undefined): StatementFileIssue | null {
  if (sealed === undefined) return "ACCOUNT_UNREADABLE";
  try {
    const number = openAccountNumber(ctx, entry.account.tenantId, entry.account.id, sealed);
    return accountNumberIssue(entry.account.accountKind, number) === null && accountLast4(number) === entry.account.accountLast4 ? null : "ACCOUNT_INVALID";
  } catch (err) {
    if (err instanceof SecretBoxError) return "ACCOUNT_UNREADABLE";
    throw err;
  }
}

export interface GenerateInput {
  currency: string;
  chargeBearer: ChargeBearer;
  allowExclusions: boolean;
  note: string | null;
}

/**
 * 发起生成：批次已锁定；账单有问题的必须明确确认（`allow_exclusions`），否则 409 并列出；确认后名单写进复核内容。
 * 文件在批准时才生成，驳回、撤回不留任何东西。
 */
export async function requestBankFile(ctx: AppContext, principal: PlatformPrincipal, batchId: string, input: GenerateInput, ip: string): Promise<Approval> {
  const now = ctx.now();
  return withPlatformTx(ctx.pool, async (db) => {
    const batch = await findBatch(db, batchId, { lock: true });
    if (batch === null) throw notFound("付款批次");
    if (batch.status !== "closed") throw new AppError(409, "BATCH_NOT_CLOSED", batch.status === "open" ? "先锁定批次，再生成转账文件" : "这个批次已经付款完成", { status: batch.status });
    const group = (await groupBatch(db, batch, now)).find((entry) => entry.currency === input.currency);
    if (group === undefined) throw new AppError(409, "BANK_FILE_EMPTY", `这个批次里没有 ${input.currency} 的账单`, { currency: input.currency });
    if (group.pendingApprovalId !== null) throw new AppError(409, "BANK_FILE_REVIEW_PENDING", `这个批次的 ${input.currency} 已经有一条待审核的生成复核`, { approval_id: group.pendingApprovalId });

    const sealed = await sealedAccountsOf(db, group.eligible.map((entry) => entry.account));
    const eligible: EligibleStatement[] = [];
    const excluded = [...group.excluded];
    for (const entry of group.eligible) {
      const problem = numberProblem(ctx, entry, sealed.get(entry.account.id));
      if (problem === null) eligible.push(entry);
      else excluded.push({ statement: entry.statement, code: problem });
    }
    const excludedList = excluded.map(excludedJson);
    if (eligible.length === 0) throw new AppError(409, "BANK_FILE_EMPTY", `这个批次的 ${input.currency} 没有能进文件的账单`, { currency: input.currency, excluded: excludedList });
    if (excluded.length > 0 && !input.allowExclusions) throw new AppError(409, "BANK_FILE_EXCLUSIONS", `有 ${excluded.length} 张账单进不了文件，确认后才能继续`, { currency: input.currency, excluded: excludedList });

    const totalMinor = bankFileTotal(eligible.map((entry) => ({ amountMinor: entry.statement.totalMinor })));
    const currency = input.currency as CurrencyCode;
    return requestApproval(db, consoleOrigin(platformActor(principal.user), ip, now), principal, {
      kind: BANK_FILE_GENERATE,
      resourceId: batchId,
      summary: `生成 ${batch.payDate} 付款批次的 ${currency} 转账文件：${eligible.length} 笔，合计 ${currency} ${formatMajor(totalMinor, currency)}，手续费 ${input.chargeBearer}${excluded.length > 0 ? `；排除 ${excluded.length} 张账单` : ""}`,
      payload: {
        batch_id: batchId,
        pay_date: batch.payDate,
        currency,
        charge_bearer: input.chargeBearer,
        total_minor: totalMinor,
        total: formatMajor(totalMinor, currency),
        item_count: eligible.length,
        // 只有末 4 位，没有完整账号
        items: eligible.map((entry) => ({
          statement_id: entry.statement.id,
          statement_no: entry.statement.statementNo,
          statement_version: entry.statement.version,
          tenant_id: entry.statement.tenantId,
          tenant_name: entry.statement.tenantName,
          account_id: entry.account.id,
          beneficiary_name: entry.account.beneficiaryName,
          bank_name: entry.account.bankName,
          swift_bic: entry.account.swiftBic,
          account: maskAccount(entry.account.accountLast4),
          amount: formatMajor(entry.statement.totalMinor, currency),
          recently_changed: entry.recentlyChanged,
        })),
        excluded: excludedList,
      },
      before: null,
      baseVersion: batch.version,
      note: input.note,
    });
  });
}

/**
 * 文件的内容基准（批准时记下、每次下载核对，CSV 和 Excel 共用）：除了账号明文，写进文件的每一项都算在内，账号算的是密文的哈希。
 * 用主密钥派生的 HMAC：改库的人重算不了。
 */
function contentDigest(
  ctx: AppContext,
  file: { fileNo: string; payoutBatchId: string; currency: string; template: string; chargeBearer: string; itemCount: number; totalMinor: number; createdAt: Date },
  items: readonly { tenantId: string; seq: number; statementId: string; statementNo: string; accountId: string; amountMinor: number; currency: string; beneficiaryName: string; beneficiaryAddress: string; bankName: string; bankAddress: string; swiftBic: string; accountSealed: string; accountLast4: string; reference: string }[],
): string {
  return payoutMac(
    ctx,
    JSON.stringify({
      file: [file.fileNo, file.payoutBatchId, file.currency, file.template, file.chargeBearer, file.itemCount, file.totalMinor, file.createdAt.toISOString()],
      items: items.map((item) => [item.seq, item.tenantId, item.statementId, item.statementNo, item.accountId, createHash("sha256").update(item.accountSealed).digest("hex"), item.accountLast4, item.amountMinor, item.currency, item.beneficiaryName, item.beneficiaryAddress, item.bankName, item.bankAddress, item.swiftBic, item.reference]),
    }),
  );
}

function fileNo(payDate: string): string {
  let random = "";
  for (let i = 0; i < 8; i += 1) random += ORDER_NO_ALPHABET[randomInt(ORDER_NO_ALPHABET.length)];
  return `BF${payDate.replace(/-/g, "")}${random}`;
}

interface PayloadItem {
  statement_id: string;
  statement_version: number;
  account_id: string;
}

export const BANK_FILE_GENERATE: ApprovalKind = {
  kind: "bank_file.generate",
  resource: "bank_file",
  readAction: "statement.read",
  requestAction: "statement.manage",
  reviewAction: "statement.review",
  unscopedOnly: true,
  async apply(db, approval, origin, ctx) {
    const now = origin.occurredAt;
    const batchId = approval.payload["batch_id"] as string;
    const currency = approval.payload["currency"] as CurrencyCode;
    const batch = await findBatch(db, batchId, { lock: true });
    if (batch === null || batch.status !== "closed" || batch.version !== approval.baseVersion) throw approvalStale(batch?.version ?? 0);
    const group = (await groupBatch(db, batch, now)).find((entry) => entry.currency === currency);
    const eligible = new Map((group?.eligible ?? []).map((entry) => [entry.statement.id, entry]));
    const reviewed = approval.payload["items"] as unknown as PayloadItem[];
    // 审的是这几笔付到这几个账户：账单版本、账户任何一个变了就要重新发起（改账户不会把没审过的账号带进文件）
    const entries = reviewed.map((item) => {
      const entry = eligible.get(item.statement_id);
      if (entry === undefined || entry.statement.version !== item.statement_version || entry.account.id !== item.account_id) throw approvalStale(batch.version);
      return entry;
    });
    const sealed = await sealedAccountsOf(db, entries.map((entry) => entry.account));
    // 解不开的不生成：否则会产生一个永远下载不了的文件。整个批准回滚，复核仍是待审核，审核人看到原因后驳回
    const unreadable = entries.filter((entry) => numberProblem(ctx, entry, sealed.get(entry.account.id)) !== null).map((entry) => entry.statement.statementNo);
    if (unreadable.length > 0) throw new AppError(409, "BANK_FILE_ACCOUNT_UNREADABLE", "有账号解不开或不合规则，没有生成文件。请驳回这条复核，让供应商重新提交账户后再发起", { statement_nos: unreadable });
    const id = randomUUID();
    const no = fileNo(batch.payDate);
    const totalMinor = bankFileTotal(entries.map((entry) => ({ amountMinor: entry.statement.totalMinor })));
    const reviewerId = origin.actor.id as string;
    const chargeBearer = approval.payload["charge_bearer"] as ChargeBearer;
    const newItems = entries.map(({ statement, account }, index) => ({
      tenantId: statement.tenantId,
      fileId: id,
      seq: index + 1,
      statementId: statement.id,
      statementNo: statement.statementNo,
      accountId: account.id,
      amountMinor: statement.totalMinor,
      currency,
      beneficiaryName: account.beneficiaryName,
      beneficiaryAddress: account.beneficiaryAddress,
      bankName: account.bankName,
      bankAddress: account.bankAddress,
      swiftBic: account.swiftBic,
      accountSealed: sealed.get(account.id) as string,
      accountLast4: account.accountLast4,
      reference: paymentReference(statement.statementNo, statement.period),
    }));
    await insertBankFile(db, {
      id,
      fileNo: no,
      payoutBatchId: batchId,
      currency,
      template: DEFAULT_BANK_FILE_TEMPLATE,
      chargeBearer,
      itemCount: entries.length,
      totalMinor,
      excluded: approval.payload["excluded"] as unknown[],
      approvalId: approval.id,
      requestedBy: approval.requestedBy.id,
      approvedBy: reviewerId,
      contentDigest: contentDigest(ctx, { fileNo: no, payoutBatchId: batchId, currency, template: DEFAULT_BANK_FILE_TEMPLATE, chargeBearer, itemCount: entries.length, totalMinor, createdAt: now }, newItems),
      now,
    });
    for (const item of newItems) await insertBankFileItem(db, item);
    await insertAuditLog(db, origin, {
      tenantId: null,
      resource: "bank_file",
      resourceId: id,
      action: "create",
      before: null,
      after: { file_no: no, payout_batch_id: batchId, pay_date: batch.payDate, currency, item_count: entries.length, total_minor: totalMinor, charge_bearer: approval.payload["charge_bearer"] as string, approval_id: approval.id, requested_by: approval.requestedBy.id },
    });
  },
};

export const BANK_FILE_APPROVAL_KINDS: readonly ApprovalKind[] = [BANK_FILE_GENERATE];

// ---- 查看 ----

export function listFilesForPlatform(ctx: AppContext, filter: { payoutBatchId: string | null; status: BankFileStatus | null }): Promise<BankFile[]> {
  return withPlatformTx(ctx.pool, (db) => listBankFiles(db, filter), { snapshot: true });
}

export interface BankFileView {
  file: BankFile;
  items: BankFileItemRow[];
}

async function loadFile(db: Db, id: string): Promise<BankFileView> {
  const file = await findBankFile(db, id);
  if (file === null) throw notFound("转账文件");
  return { file, items: await listBankFileItems(db, id) };
}

export function getFileForPlatform(ctx: AppContext, id: string): Promise<BankFileView> {
  return withPlatformTx(ctx.pool, (db) => loadFile(db, id), { snapshot: true });
}

// ---- 下载 ----

export interface DownloadedFile {
  content: Buffer;
  contentType: string;
  fileName: string;
}

const INTEGRITY_MESSAGE = "文件内容和批准时不一致，已拒绝下载。请联系技术核对，不要转账";

/** 下载前的核对没通过：错误码、原因（给审计），不带账号。事务回滚后另开事务留记录。 */
class BankFileRefused extends AppError {
  readonly reason: string;
  constructor(code: "BANK_FILE_INTEGRITY" | "BANK_FILE_ACCOUNT_UNREADABLE", message: string, reason: string, details: Record<string, unknown> = {}) {
    super(409, code, message, details);
    this.reason = reason;
  }
}

/** 解出账号、核对（账号解得开、末 4 位、笔数、合计、内容基准），都过了才返回文件内容。 */
function verifiedContent(ctx: AppContext, file: BankFile, items: readonly (BankFileItemRow & { accountSealed: string })[]): BankFileContent {
  const unreadable: string[] = [];
  const decrypted = items.map((item) => {
    let accountNumber = "";
    try {
      accountNumber = openAccountNumber(ctx, item.tenantId, item.accountId, item.accountSealed);
    } catch (err) {
      if (!(err instanceof SecretBoxError)) throw err;
      unreadable.push(item.statementNo);
    }
    return { item, accountNumber };
  });
  if (unreadable.length > 0) throw new BankFileRefused("BANK_FILE_ACCOUNT_UNREADABLE", "有账号解不开（数据加密密钥可能换过），没有生成文件。请作废这个文件、让供应商重新提交账户后再生成", "ACCOUNT_UNREADABLE", { statement_nos: unreadable });
  const issue = bankFileIntegrityIssue(file, decrypted.map(({ item, accountNumber }) => ({ amountMinor: item.amountMinor, accountLast4: item.accountLast4, accountNumber })));
  if (issue !== null) throw new BankFileRefused("BANK_FILE_INTEGRITY", INTEGRITY_MESSAGE, issue);
  if (contentDigest(ctx, file, items) !== file.contentDigest) throw new BankFileRefused("BANK_FILE_INTEGRITY", INTEGRITY_MESSAGE, "CONTENT_DIGEST");
  return {
    fileNo: file.fileNo,
    payDate: file.payDate,
    currency: file.currency,
    chargeBearer: file.chargeBearer,
    generatedAt: file.createdAt.toISOString(),
    items: decrypted.map(({ item, accountNumber }) => ({ beneficiaryName: item.beneficiaryName, beneficiaryAddress: item.beneficiaryAddress, bankName: item.bankName, bankAddress: item.bankAddress, swiftBic: item.swiftBic, accountNumber, amountMinor: item.amountMinor, reference: item.reference })),
  };
}

function renderFile(file: BankFile, content: BankFileContent, format: BankFileFormat): Buffer {
  if (format === "csv") return Buffer.from(bankFileCsv(file.template, content), "utf8");
  return writeXlsx([
    { name: "Payments", rows: bankFileRows(file.template, content), header: true, columnWidths: bankFileColumnWidths(file.template) },
    { name: "Summary", rows: bankFileSummaryRows(file.template, content), columnWidths: [18, 44] },
  ]);
}

export interface BankFileLog {
  error(obj: object, msg: string): void;
}

/**
 * 下载（平台事务里，提交之后才把内容交出去）：内容不落盘，从条目快照现生成。每次都核对（`verifiedContent`），不依赖「第一次下载」。
 * 账户在文件生成后换过的（还没付款的条目）：要明确确认（`acknowledgeAccountChanged`），否则 409 `BANK_FILE_ACCOUNT_CHANGED`，审计记下这次是确认后下载的。
 * 审计记谁、格式、哈希、笔数、合计，没有账号。第一次下载把文件记为「已下载」。
 * 核对不通过：事务回滚（不改状态、不计次数），另开事务留一条审计和错误日志。
 */
export async function downloadBankFile(ctx: AppContext, principal: PlatformPrincipal, id: string, format: BankFileFormat, acknowledgeAccountChanged: boolean, ip: string, log: BankFileLog): Promise<DownloadedFile> {
  const now = ctx.now();
  try {
    return await withPlatformTx(ctx.pool, async (db) => {
      const file = await findBankFile(db, id, { lock: true });
      if (file === null) throw notFound("转账文件");
      if (file.status !== "generated" && file.status !== "downloaded") throw new AppError(409, "BANK_FILE_STATE_INVALID", "已付款或已作废的文件不能再下载", { status: file.status });
      const items = await listItemsForDownload(db, id);
      const verified = verifiedContent(ctx, file, items);
      const changed = items.filter((item) => item.accountChanged && item.paidAt === null).map((item) => item.statementNo);
      if (changed.length > 0 && !acknowledgeAccountChanged) throw new AppError(409, "BANK_FILE_ACCOUNT_CHANGED", "文件生成后供应商的收款账户换过，文件里还是批准时的账号。确认这个账号仍然可用再下载", { statement_nos: changed });
      const content = renderFile(file, verified, format);
      const sha256 = createHash("sha256").update(content).digest("hex");
      const known = format === "csv" ? file.csvSha256 : file.xlsxSha256;
      if (known !== null && known !== sha256) throw new BankFileRefused("BANK_FILE_INTEGRITY", INTEGRITY_MESSAGE, "FILE_SHA256");
      const downloadCount = file.downloadCount + 1;
      await updateBankFile(db, id, { status: "downloaded", first_downloaded_at: file.firstDownloadedAt ?? now, download_count: downloadCount, ...(format === "csv" ? { csv_sha256: sha256 } : { xlsx_sha256: sha256 }) }, now);
      await insertAuditLog(db, consoleOrigin(platformActor(principal.user), ip, now), {
        tenantId: null,
        resource: "bank_file",
        resourceId: id,
        action: "download",
        before: { status: file.status },
        after: { status: "downloaded", file_no: file.fileNo, format, sha256, item_count: items.length, total_minor: file.totalMinor, currency: file.currency, download_count: downloadCount, account_changed_acknowledged: changed.length > 0 },
      });
      return { content, contentType: format === "csv" ? "text/csv; charset=utf-8" : XLSX_CONTENT_TYPE, fileName: bankFileName(file, format) };
    });
  } catch (err) {
    if (err instanceof BankFileRefused) await recordRefusal(ctx, principal, id, format, err, ip, now, log);
    throw err;
  }
}

async function recordRefusal(ctx: AppContext, principal: PlatformPrincipal, id: string, format: BankFileFormat, refusal: BankFileRefused, ip: string, now: Date, log: BankFileLog): Promise<void> {
  log.error({ event: "bank_file.integrity_failed", bankFileId: id, code: refusal.code, reason: refusal.reason }, "转账文件下载前核对不通过，已拒绝");
  try {
    await withPlatformTx(ctx.pool, (db) => insertAuditLog(db, consoleOrigin(platformActor(principal.user), ip, now), { tenantId: null, resource: "bank_file", resourceId: id, action: "integrity_failed", before: null, after: { code: refusal.code, reason: refusal.reason, format } }));
  } catch (err) {
    log.error({ err, bankFileId: id }, "转账文件核对不通过的审计没有写成");
  }
}

// ---- 回填流水号 ----

export interface PaymentInput {
  itemId: string;
  bankReference: string;
}

/**
 * 回填流水号：只有已下载的文件能回填；可以分多次，同一流水号可以用在多笔上。同一笔同一流水号再提交原样返回，不同流水号 409。
 * 每一笔：条目记流水号，账单记为已付款，写账单经过和审计，推 `payout.paid`。全部回填后文件、批次依次收尾。
 */
export async function recordPayments(ctx: AppContext, principal: PlatformPrincipal, id: string, payments: readonly PaymentInput[], ip: string): Promise<BankFileView> {
  const now = ctx.now();
  return withPlatformTx(ctx.pool, async (db) => {
    const file = await findBankFile(db, id, { lock: true });
    if (file === null) throw notFound("转账文件");
    if (file.status !== "downloaded") throw new AppError(409, "BANK_FILE_STATE_INVALID", file.status === "generated" ? "先下载文件、到银行转账，再回填流水号" : "已付款或已作废的文件不能回填", { status: file.status });
    const items = await listBankFileItems(db, id);
    const origin = consoleOrigin(platformActor(principal.user), ip, now);
    for (const payment of payments) {
      const item = items.find((entry) => entry.id === payment.itemId);
      if (item === undefined) throw notFound("文件条目");
      if (item.voidedAt !== null) throw new AppError(409, "BANK_FILE_ITEM_VOID", `账单 ${item.statementNo} 这一笔已作废`, { item_id: item.id });
      if (item.paidAt !== null) {
        if (item.bankReference === payment.bankReference) continue;
        throw new AppError(409, "BANK_FILE_ITEM_ALREADY_PAID", `账单 ${item.statementNo} 这一笔已经回填过别的流水号，不能改`, { item_id: item.id, bank_reference: item.bankReference });
      }
      const statement = await findStatement(db, item.statementId, { tenantId: item.tenantId, lock: true });
      if (statement === null || statement.status !== "in_payout") throw new AppError(409, "STATEMENT_STATE_INVALID", "只有已进付款批次的账单能记为已付款", { status: statement?.status ?? null });
      await markItemPaid(db, item.tenantId, item.id, payment.bankReference, principal.user.id, now);
      await updateStatement(db, item.tenantId, item.statementId, { status: "paid", paid_at: now, bank_reference: payment.bankReference }, now);
      await insertStatementEvent(db, item.tenantId, item.statementId, { action: "pay", actorType: "platform_user", actorId: principal.user.id, note: null, data: { bank_reference: payment.bankReference, bank_file_no: file.fileNo }, at: now });
      await insertAuditLog(db, origin, { tenantId: null, resource: "statement", resourceId: item.statementId, action: "pay", before: { status: statement.status }, after: { status: "paid", bank_reference: payment.bankReference, bank_file_id: id, amount_minor: item.amountMinor, currency: item.currency } });
      await enqueueTenantEvent(db, { tenantId: item.tenantId, type: "payout.paid", orderId: null, data: { statement_id: item.statementId, statement_no: item.statementNo, bank_reference: payment.bankReference, paid_at: now.toISOString() } }, now);
      item.paidAt = now;
      item.bankReference = payment.bankReference;
    }
    if (items.every((entry) => entry.paidAt !== null || entry.voidedAt !== null)) await closeFile(db, file, principal, ip, now, null);
    return loadFile(db, id);
  });
}

async function closeFile(db: Db, file: BankFile, principal: PlatformPrincipal, ip: string, now: Date, reason: string | null): Promise<void> {
  await updateBankFile(db, file.id, { status: "paid", paid_at: now, ...(reason === null ? {} : { void_reason: reason }) }, now);
  const origin = consoleOrigin(platformActor(principal.user), ip, now);
  await insertAuditLog(db, origin, { tenantId: null, resource: "bank_file", resourceId: file.id, action: "pay", before: { status: file.status }, after: { status: "paid", file_no: file.fileNo, ...(reason === null ? {} : { reason }) } });
  await lockAndFinishBatch(db, file.payoutBatchId, origin, now);
}

async function lockAndFinishBatch(db: Db, batchId: string, origin: ReturnType<typeof consoleOrigin>, now: Date): Promise<void> {
  const batch = await findBatch(db, batchId, { lock: true });
  if (batch === null) return;
  if (await markBatchPaidIfDone(db, batchId, now)) await insertAuditLog(db, origin, { tenantId: null, resource: "payout_batch", resourceId: batchId, action: "pay", before: { status: batch.status }, after: { status: "paid", pay_date: batch.payDate } });
}

// ---- 作废 ----

/**
 * 作废：未付款的条目作废，账单释放，可以进新文件。全部未付款的文件记为作废；已经回填过部分的文件记为已付款（已付的不退回，ADR 0051「部分退汇」）。
 * 文件如果已经交给银行，要先到银行撤销（页面提醒），否则重新生成会重复付款。
 */
export async function voidBankFile(ctx: AppContext, principal: PlatformPrincipal, id: string, reason: string, ip: string): Promise<BankFileView> {
  const now = ctx.now();
  return withPlatformTx(ctx.pool, async (db) => {
    const file = await findBankFile(db, id, { lock: true });
    if (file === null) throw notFound("转账文件");
    if (file.status !== "generated" && file.status !== "downloaded") throw new AppError(409, "BANK_FILE_STATE_INVALID", "已付款或已作废的文件不能作废", { status: file.status });
    const released = await voidUnpaidItems(db, id, now);
    const hasPaid = (await listBankFileItems(db, id)).some((item) => item.paidAt !== null);
    if (hasPaid) {
      await closeFile(db, file, principal, ip, now, reason);
    } else {
      await updateBankFile(db, id, { status: "void", voided_at: now, voided_by: principal.user.id, void_reason: reason }, now);
      await insertAuditLog(db, consoleOrigin(platformActor(principal.user), ip, now), { tenantId: null, resource: "bank_file", resourceId: id, action: "void", before: { status: file.status }, after: { status: "void", file_no: file.fileNo, reason, released } });
    }
    return loadFile(db, id);
  });
}

