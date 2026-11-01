/**
 * 银行转账文件和供应商收款账户的接口（M5-02，ADR 0051）。这里只做鉴权、校验、调用、返回；规则在 @nozomi/domain 的 bank-transfer.ts，流程在 services/。
 *
 * 供应商（`/tenant/v1`，租户编号只来自令牌）：看账户（`company.read`）、提交、撤回（`company.manage`，只有管理员）。
 * 运营后台（`/platform/v1`，`statement.read` / `statement.manage`，批准走通用的复核接口）。限定了数据范围的人一律 403（和财务结算一样）。
 * 任何接口都只返回账号的末 4 位；完整账号只出现在下载的文件里。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  BANK_FILE_FORMATS,
  BANK_FILE_STATUSES,
  BANK_TRANSFER_RULES,
  BILLING_RULES,
  CHARGE_BEARERS,
  CURRENCIES,
  type CurrencyCode,
  PAYOUT_ACCOUNT_KINDS,
  PAYOUT_ACCOUNT_STATUSES,
  type PlatformAction,
  STATEMENT_FILE_ISSUE_MESSAGES,
  accountRecentlyChanged,
  bankFileTotal,
  isBankReference,
  maskAccount,
  scopeIsRestricted,
} from "@nozomi/domain";
import { bearerToken } from "../auth/token.ts";
import type { AppContext } from "../context.ts";
import type { BankFile, BankFileItemRow } from "../repos/bank-files.ts";
import type { PayoutAccount } from "../repos/payout-accounts.ts";
import { type BatchPreview, downloadBankFile, getFileForPlatform, listFilesForPlatform, previewBatch, recordPayments, requestBankFile, voidBankFile } from "../services/bank-files.ts";
import { dataScopeDenied } from "../services/errors.ts";
import { listAccountsForPlatform, listAccountsForTenant, rejectPayoutAccount, requestAccountReview, submitPayoutAccount, withdrawPayoutAccount } from "../services/payout-accounts.ts";
import { type PlatformPrincipal, authenticatePlatform, platformCredentials } from "../services/platform-auth.ts";
import { salesMoney } from "../services/sales-quotes.ts";
import { authenticateTenant } from "../services/tenant-auth.ts";
import { parseInput, resourceId, uuidSchema } from "../validation.ts";
import { approvalJson } from "./channels.ts";

type Json = Record<string, unknown>;

const iso = (date: Date | null): string | null => date?.toISOString() ?? null;
const CURRENCY_CODES = Object.keys(CURRENCIES) as [CurrencyCode, ...CurrencyCode[]];
const requiredNote = z.string().trim().min(1).max(BILLING_RULES.noteMaxLength);
const optionalNote = z.string().trim().max(BILLING_RULES.noteMaxLength).nullable().default(null).transform((value) => (value === "" ? null : value));
const uuid = uuidSchema.transform((value) => value.toLowerCase());
const field = z.string().max(300);

const submitSchema = z
  .object({
    currency: z.enum(CURRENCY_CODES),
    beneficiary_name: field,
    beneficiary_address: field,
    bank_name: field,
    bank_address: field,
    swift_bic: z.string().max(40),
    account_kind: z.enum(PAYOUT_ACCOUNT_KINDS),
    account_number: z.string().max(100),
    current_password: z.string().min(1).max(1024),
  })
  .strict();
const reviewSchema = z.object({ note: optionalNote }).strict();
const rejectSchema = z.object({ reason: requiredNote }).strict();
const accountListSchema = z.object({ status: z.enum(PAYOUT_ACCOUNT_STATUSES).optional(), tenant_id: uuid.optional() }).strict();
const generateSchema = z
  .object({
    currency: z.enum(CURRENCY_CODES),
    charge_bearer: z.enum(CHARGE_BEARERS).default(BANK_TRANSFER_RULES.defaultChargeBearer),
    allow_exclusions: z.boolean().default(false),
    note: optionalNote,
  })
  .strict();
const fileListSchema = z.object({ payout_batch_id: uuid.optional(), status: z.enum(BANK_FILE_STATUSES).optional() }).strict();
const downloadSchema = z.object({ format: z.enum(BANK_FILE_FORMATS) }).strict();
const paymentsSchema = z
  .object({
    payments: z
      .array(z.object({ item_id: uuid, bank_reference: z.string().trim().refine(isBankReference, "流水号是 1–64 位英文字母、数字和 / _ . : -，要以字母或数字开头") }).strict())
      .min(1)
      .max(BANK_TRANSFER_RULES.maxPaymentsPerRequest),
  })
  .strict();
const voidSchema = z.object({ reason: requiredNote }).strict();

function tenantAccountJson(account: PayoutAccount): Json {
  return {
    id: account.id,
    currency: account.currency,
    beneficiary_name: account.beneficiaryName,
    beneficiary_address: account.beneficiaryAddress,
    bank_name: account.bankName,
    bank_address: account.bankAddress,
    swift_bic: account.swiftBic,
    account_kind: account.accountKind,
    account_masked: maskAccount(account.accountLast4),
    status: account.status,
    submitted_at: account.submittedAt.toISOString(),
    activated_at: iso(account.activatedAt),
    superseded_at: iso(account.supersededAt),
    rejected_at: iso(account.rejectedAt),
    reject_reason: account.rejectReason,
    withdrawn_at: iso(account.withdrawnAt),
    version: account.version,
  };
}

function platformAccountJson(account: PayoutAccount & { tenantName: string; pendingApprovalId: string | null }, now: Date): Json {
  return {
    ...tenantAccountJson(account),
    tenant: { id: account.tenantId, name: account.tenantName },
    approval_id: account.approvalId,
    pending_approval_id: account.pendingApprovalId,
    recently_changed: account.status === "active" && accountRecentlyChanged(account, now),
  };
}

function fileJson(file: BankFile): Json {
  return {
    id: file.id,
    file_no: file.fileNo,
    payout_batch_id: file.payoutBatchId,
    pay_date: file.payDate,
    currency: file.currency,
    template: file.template,
    charge_bearer: file.chargeBearer,
    status: file.status,
    item_count: file.itemCount,
    total: salesMoney(file.totalMinor, file.currency),
    excluded: file.excluded,
    approval_id: file.approvalId,
    requested_by: file.requestedBy,
    approved_by: file.approvedBy,
    created_at: file.createdAt.toISOString(),
    first_downloaded_at: iso(file.firstDownloadedAt),
    download_count: file.downloadCount,
    csv_sha256: file.csvSha256,
    xlsx_sha256: file.xlsxSha256,
    paid_at: iso(file.paidAt),
    voided_at: iso(file.voidedAt),
    void_reason: file.voidReason,
    version: file.version,
  };
}

function itemJson(item: BankFileItemRow): Json {
  return {
    id: item.id,
    seq: item.seq,
    statement_id: item.statementId,
    statement_no: item.statementNo,
    tenant: { id: item.tenantId, name: item.tenantName },
    beneficiary_name: item.beneficiaryName,
    bank_name: item.bankName,
    swift_bic: item.swiftBic,
    account_masked: maskAccount(item.accountLast4),
    amount: salesMoney(item.amountMinor, item.currency),
    reference: item.reference,
    bank_reference: item.bankReference,
    paid_at: iso(item.paidAt),
    voided: item.voidedAt !== null,
    account_changed: item.accountChanged,
  };
}

function previewJson(preview: BatchPreview): Json {
  const statementRef = (statement: BatchPreview["groups"][number]["eligible"][number]["statement"]): Json => ({
    statement_id: statement.id,
    statement_no: statement.statementNo,
    tenant: { id: statement.tenantId, name: statement.tenantName },
    amount: salesMoney(statement.totalMinor, statement.currency),
  });
  return {
    batch_id: preview.batch.id,
    pay_date: preview.batch.payDate,
    batch_status: preview.batch.status,
    groups: preview.groups.map((group) => ({
      currency: group.currency,
      pending_approval_id: group.pendingApprovalId,
      total: salesMoney(bankFileTotal(group.eligible.map((entry) => ({ amountMinor: entry.statement.totalMinor }))), group.currency as CurrencyCode),
      eligible: group.eligible.map((entry) => ({
        ...statementRef(entry.statement),
        beneficiary_name: entry.account.beneficiaryName,
        bank_name: entry.account.bankName,
        swift_bic: entry.account.swiftBic,
        account_masked: maskAccount(entry.account.accountLast4),
        recently_changed: entry.recentlyChanged,
      })),
      excluded: group.excluded.map((entry) => ({ ...statementRef(entry.statement), code: entry.code, message: STATEMENT_FILE_ISSUE_MESSAGES[entry.code] })),
      in_files: group.inFiles.map((entry) => ({ ...statementRef(entry.statement), file_id: entry.fileId, file_no: entry.fileNo, file_status: entry.fileStatus })),
    })),
  };
}

export function registerBankFileRoutes(app: FastifyInstance, ctx: AppContext): void {
  const platform = async (request: FastifyRequest, action: PlatformAction): Promise<PlatformPrincipal> => {
    const principal = await authenticatePlatform(ctx, platformCredentials(request), { action });
    if (scopeIsRestricted(principal.grant.scope)) throw dataScopeDenied();
    return principal;
  };

  // ---- 供应商 ----

  app.get("/tenant/v1/payout-accounts", async (request) => {
    const principal = await authenticateTenant(ctx, bearerToken(request.headers.authorization), { action: "company.read" });
    return { items: (await listAccountsForTenant(ctx, principal.tenantId)).map(tenantAccountJson) };
  });

  app.post("/tenant/v1/payout-accounts", async (request, reply) => {
    const principal = await authenticateTenant(ctx, bearerToken(request.headers.authorization), { action: "company.manage" });
    const input = parseInput(submitSchema, request.body, "body");
    const account = await submitPayoutAccount(
      ctx,
      principal,
      {
        currency: input.currency,
        beneficiaryName: input.beneficiary_name,
        beneficiaryAddress: input.beneficiary_address,
        bankName: input.bank_name,
        bankAddress: input.bank_address,
        swiftBic: input.swift_bic,
        accountKind: input.account_kind,
        accountNumber: input.account_number,
        currentPassword: input.current_password,
      },
      request.ip,
    );
    return reply.code(201).send({ account: tenantAccountJson(account) });
  });

  app.post("/tenant/v1/payout-accounts/:id/withdraw", async (request) => {
    const principal = await authenticateTenant(ctx, bearerToken(request.headers.authorization), { action: "company.manage" });
    return { account: tenantAccountJson(await withdrawPayoutAccount(ctx, principal, resourceId(request.params, "收款账户"), request.ip)) };
  });

  // ---- 运营后台：账户 ----

  app.get("/platform/v1/payout-accounts", async (request) => {
    await platform(request, "statement.read");
    const query = parseInput(accountListSchema, request.query, "querystring");
    const now = ctx.now();
    return { items: (await listAccountsForPlatform(ctx, { status: query.status ?? null, tenantId: query.tenant_id ?? null })).map((account) => platformAccountJson(account, now)) };
  });

  app.post("/platform/v1/payout-accounts/:id/approval", async (request, reply) => {
    const principal = await platform(request, "statement.manage");
    const id = resourceId(request.params, "收款账户");
    const input = parseInput(reviewSchema, request.body ?? {}, "body");
    const approval = await requestAccountReview(ctx, principal, id, input.note, request.ip);
    return reply.code(202).send({ approval: approvalJson(approval, principal) });
  });

  app.post("/platform/v1/payout-accounts/:id/reject", async (request) => {
    const principal = await platform(request, "statement.manage");
    const id = resourceId(request.params, "收款账户");
    const input = parseInput(rejectSchema, request.body, "body");
    return { account: platformAccountJson(await rejectPayoutAccount(ctx, principal, id, input.reason, request.ip), ctx.now()) };
  });

  // ---- 运营后台：转账文件 ----

  app.get("/platform/v1/payout-batches/:id/bank-file-preview", async (request) => {
    await platform(request, "statement.read");
    return { preview: previewJson(await previewBatch(ctx, resourceId(request.params, "付款批次"))) };
  });

  app.post("/platform/v1/payout-batches/:id/bank-files", async (request, reply) => {
    const principal = await platform(request, "statement.manage");
    const id = resourceId(request.params, "付款批次");
    const input = parseInput(generateSchema, request.body, "body");
    const approval = await requestBankFile(ctx, principal, id, { currency: input.currency, chargeBearer: input.charge_bearer, allowExclusions: input.allow_exclusions, note: input.note }, request.ip);
    return reply.code(202).send({ approval: approvalJson(approval, principal) });
  });

  app.get("/platform/v1/bank-files", async (request) => {
    await platform(request, "statement.read");
    const query = parseInput(fileListSchema, request.query, "querystring");
    return { items: (await listFilesForPlatform(ctx, { payoutBatchId: query.payout_batch_id ?? null, status: query.status ?? null })).map(fileJson) };
  });

  app.get("/platform/v1/bank-files/:id", async (request) => {
    await platform(request, "statement.read");
    const view = await getFileForPlatform(ctx, resourceId(request.params, "转账文件"));
    return { file: { ...fileJson(view.file), items: view.items.map(itemJson) } };
  });

  app.post("/platform/v1/bank-files/:id/download", async (request, reply) => {
    const principal = await platform(request, "statement.manage");
    const id = resourceId(request.params, "转账文件");
    const input = parseInput(downloadSchema, request.body, "body");
    const file = await downloadBankFile(ctx, principal, id, input.format, request.ip);
    reply.header("content-type", file.contentType);
    reply.header("content-disposition", `attachment; filename="${file.fileName}"`);
    reply.header("pragma", "no-cache");
    reply.header("x-content-type-options", "nosniff");
    return reply.send(file.content);
  });

  app.post("/platform/v1/bank-files/:id/payments", async (request) => {
    const principal = await platform(request, "statement.manage");
    const id = resourceId(request.params, "转账文件");
    const input = parseInput(paymentsSchema, request.body, "body");
    const view = await recordPayments(ctx, principal, id, input.payments.map((payment) => ({ itemId: payment.item_id, bankReference: payment.bank_reference })), request.ip);
    return { file: { ...fileJson(view.file), items: view.items.map(itemJson) } };
  });

  app.post("/platform/v1/bank-files/:id/void", async (request) => {
    const principal = await platform(request, "statement.manage");
    const id = resourceId(request.params, "转账文件");
    const input = parseInput(voidSchema, request.body, "body");
    const view = await voidBankFile(ctx, principal, id, input.reason, request.ip);
    return { file: { ...fileJson(view.file), items: view.items.map(itemJson) } };
  });
}
