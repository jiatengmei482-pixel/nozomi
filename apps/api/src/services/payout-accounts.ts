/**
 * 供应商收款账户的流程（M5-02，ADR 0051）。规则在 @nozomi/domain 的 bank-transfer.ts，取数在 repos/payout-accounts.ts。
 *
 * - 供应商管理员提交：先校验，再核对当前密码（和改密码共用失败限速），账号用 SecretBox 加密后存；只有末 4 位是明文。
 * - 内容不可变：改账户就是提交一条新记录，批准之前旧账户继续有效。同币种同时只有一条待审核；要改先撤回。
 * - 平台财务核对后发起复核（`payout_account.activate`），另一位批准才生效；或者驳回（原因必填）。
 * - 没有任何接口返回完整账号；审计、复核内容、错误信息里只有末 4 位。
 */
import { randomUUID } from "node:crypto";
import { PAYOUT_ACCOUNT_ISSUE_MESSAGES, type PayoutAccountKind, type PayoutAccountStatus, accountLast4, maskAccount, normalizeAccountNumber, normalizeSwiftBic, normalizeSwiftText, payoutAccountIssues } from "@nozomi/domain";
import { verifyPassword, verifyPasswordAgainstNothing } from "../auth/password.ts";
import type { AppContext } from "../context.ts";
import { type Db, isUniqueViolation, withPlatformTx, withTenantTx } from "../db/context.ts";
import { AppError } from "../errors.ts";
import type { Approval } from "../repos/approvals.ts";
import { insertAuditLog } from "../repos/audit-logs.ts";
import { tenantName } from "../repos/billing.ts";
import {
  type PayoutAccount,
  findActiveAccount,
  findPayoutAccount,
  findPendingAccount,
  insertPayoutAccount,
  listPlatformPayoutAccounts,
  listTenantPayoutAccounts,
  pendingAccountReviewOf,
  updatePayoutAccount,
} from "../repos/payout-accounts.ts";
import { enqueueNotification } from "../repos/notifications.ts";
import { findTenantUserSecrets } from "../repos/tenant-users.ts";
import { validationFailed } from "../validation.ts";
import { type ApprovalKind, approvalStale, requestApproval } from "./approvals.ts";
import { consoleOrigin, platformActor, tenantActor } from "./audit.ts";
import { currentPasswordIncorrect, notFound } from "./errors.ts";
import { clearLoginReservation, reserveLogin } from "./login-guard.ts";
import type { PlatformPrincipal } from "./platform-auth.ts";
import type { TenantPrincipal } from "./tenant-auth.ts";

const SEAL_PURPOSE = "payout-account";

/** 密文的归属：搬到别的行解不开。文件条目复制的密文也用账户的这个归属解。 */
export function payoutAccountOwner(tenantId: string, accountId: string): string {
  return `${tenantId}:${accountId}`;
}

/** 内容基准用的指纹（和账号同一个主密钥）。 */
export function payoutMac(ctx: AppContext, text: string): string {
  return requireBox(ctx).mac(SEAL_PURPOSE, text);
}

export function openAccountNumber(ctx: AppContext, tenantId: string, accountId: string, sealed: string): string {
  return requireBox(ctx).open(SEAL_PURPOSE, payoutAccountOwner(tenantId, accountId), sealed);
}

function requireBox(ctx: AppContext): NonNullable<AppContext["secretBox"]> {
  if (ctx.secretBox === null) throw new AppError(503, "PAYOUT_ENCRYPTION_NOT_CONFIGURED", "平台还没有配置数据加密密钥（DATA_ENCRYPTION_KEY），现在不能处理收款账号。请联系平台");
  return ctx.secretBox;
}

export interface PayoutAccountInput {
  currency: string;
  beneficiaryName: string;
  beneficiaryAddress: string;
  bankName: string;
  bankAddress: string;
  swiftBic: string;
  accountKind: PayoutAccountKind;
  accountNumber: string;
  currentPassword: string;
}

function auditView(account: Pick<PayoutAccount, "currency" | "beneficiaryName" | "bankName" | "swiftBic" | "accountKind" | "accountLast4" | "status">): Record<string, string> {
  return { currency: account.currency, beneficiary_name: account.beneficiaryName, bank_name: account.bankName, swift_bic: account.swiftBic, account_kind: account.accountKind, account: maskAccount(account.accountLast4), status: account.status };
}

// ---- 供应商 ----

/** 自己的账户（租户事务：行级安全）。 */
export function listAccountsForTenant(ctx: AppContext, tenantId: string): Promise<PayoutAccount[]> {
  return withTenantTx(ctx.pool, tenantId, (db) => listTenantPayoutAccounts(db, tenantId));
}

/** 提交一个账户（待审核）。旧账户在批准之前继续有效。 */
export async function submitPayoutAccount(ctx: AppContext, principal: TenantPrincipal, input: PayoutAccountInput, ip: string): Promise<PayoutAccount> {
  const now = ctx.now();
  const box = requireBox(ctx);
  const { tenantId, user } = principal;
  const fields = {
    currency: input.currency,
    beneficiaryName: normalizeSwiftText(input.beneficiaryName),
    beneficiaryAddress: normalizeSwiftText(input.beneficiaryAddress),
    bankName: normalizeSwiftText(input.bankName),
    bankAddress: normalizeSwiftText(input.bankAddress),
    swiftBic: normalizeSwiftBic(input.swiftBic),
    accountKind: input.accountKind,
  };
  const accountNumber = normalizeAccountNumber(input.accountNumber);
  const issues = payoutAccountIssues({ ...fields, accountNumber });
  if (issues.length > 0) throw validationFailed("body", issues.map((issue) => ({ path: issue.path, message: PAYOUT_ACCOUNT_ISSUE_MESSAGES[issue.reason], reason: issue.reason })));

  // 身份确认：重新输入当前密码（需求要两步验证，供应商账号现在还没有，ADR 0051 待确认 1）
  const reservation = await reserveLogin(ctx, "tenant-change-password", user.email, ip, now);
  const secrets = await withTenantTx(ctx.pool, tenantId, (db) => findTenantUserSecrets(db, tenantId, user.id));
  const matches = secrets?.passwordHash ? await verifyPassword(input.currentPassword, secrets.passwordHash) : await verifyPasswordAgainstNothing(input.currentPassword);
  if (!matches) throw currentPasswordIncorrect();
  await clearLoginReservation(ctx, reservation);

  const id = randomUUID();
  const sealed = box.seal(SEAL_PURPOSE, payoutAccountOwner(tenantId, id), accountNumber);
  const last4 = accountLast4(accountNumber);
  try {
    return await withPlatformTx(ctx.pool, async (db) => {
      if ((await findPendingAccount(db, tenantId, fields.currency)) !== null) throw pendingExists(fields.currency);
      await insertPayoutAccount(db, { tenantId, id, ...fields, accountSealed: sealed, accountLast4: last4, submittedBy: user.id, now });
      const account = (await findPayoutAccount(db, id, { tenantId })) as PayoutAccount;
      await insertAuditLog(db, consoleOrigin(tenantActor(user), ip, now), { tenantId, resource: "payout_account", resourceId: id, action: "submit", before: null, after: auditView(account) });
      await notifyAccount(db, "payout_account.submitted", account, null, now);
      return account;
    });
  } catch (err) {
    if (isUniqueViolation(err, "payout_accounts_pending_key")) throw pendingExists(fields.currency);
    throw err;
  }
}

/** 发邮件给这家供应商的管理员（通知中心）：账号只有末 4 位。同一个账户同一件事只发一次。 */
function notifyAccount(db: Db, event: "payout_account.submitted" | "payout_account.approved" | "payout_account.rejected", account: Pick<PayoutAccount, "tenantId" | "id" | "currency" | "accountLast4">, reason: string | null, now: Date): Promise<void> {
  return enqueueNotification(
    db,
    { event, tenantId: account.tenantId, orderId: null, dedupeKey: `${event}:${account.id}`, data: { payout_currency: account.currency, payout_account: maskAccount(account.accountLast4), ...(reason === null ? {} : { reject_reason: normalizeSwiftText(reason) }) } },
    now,
  );
}

function pendingExists(currency: string): AppError {
  return new AppError(409, "PAYOUT_ACCOUNT_PENDING_EXISTS", `${currency} 已经有一个待审核的收款账户，先撤回它再提交`, { currency });
}

/** 撤回自己待审核的账户（只在令牌里的租户里找，别的供应商的 404）。已经发起的复核会过期（批准时 `APPROVAL_STALE`）。 */
export async function withdrawPayoutAccount(ctx: AppContext, principal: TenantPrincipal, id: string, ip: string): Promise<PayoutAccount> {
  const now = ctx.now();
  return withPlatformTx(ctx.pool, async (db) => {
    const account = await findPayoutAccount(db, id, { tenantId: principal.tenantId, lock: true });
    if (account === null) throw notFound("收款账户");
    if (account.status !== "pending") throw stateInvalid(account, "只有待审核的账户能撤回");
    await updatePayoutAccount(db, account.tenantId, id, { status: "withdrawn", withdrawn_at: now }, now);
    await insertAuditLog(db, consoleOrigin(tenantActor(principal.user), ip, now), { tenantId: principal.tenantId, resource: "payout_account", resourceId: id, action: "withdraw", before: { status: account.status }, after: { status: "withdrawn" } });
    return (await findPayoutAccount(db, id, { tenantId: principal.tenantId })) as PayoutAccount;
  });
}

function stateInvalid(account: PayoutAccount, message: string): AppError {
  return new AppError(409, "PAYOUT_ACCOUNT_STATE_INVALID", message, { status: account.status });
}

// ---- 平台 ----

export function listAccountsForPlatform(ctx: AppContext, filter: { status: PayoutAccountStatus | null; tenantId: string | null }): ReturnType<typeof listPlatformPayoutAccounts> {
  return withPlatformTx(ctx.pool, (db) => listPlatformPayoutAccounts(db, filter), { snapshot: true });
}

/** 发起复核：只有待审核的；同一个账户同时只有一条待审核的复核。批准时核对账户版本。 */
export async function requestAccountReview(ctx: AppContext, principal: PlatformPrincipal, id: string, note: string | null, ip: string): Promise<Approval> {
  const now = ctx.now();
  return withPlatformTx(ctx.pool, async (db) => {
    const account = await findPayoutAccount(db, id, { lock: true });
    if (account === null) throw notFound("收款账户");
    if (account.status !== "pending") throw stateInvalid(account, "只有待审核的账户能发起复核");
    const pending = await pendingAccountReviewOf(db, id);
    if (pending !== null) throw new AppError(409, "PAYOUT_ACCOUNT_REVIEW_PENDING", "这个账户已经有一条待审核的复核", { approval_id: pending });
    const name = await tenantName(db, account.tenantId);
    const current = await findActiveAccount(db, account.tenantId, account.currency);
    return requestApproval(db, consoleOrigin(platformActor(principal.user), ip, now), principal, {
      kind: PAYOUT_ACCOUNT_ACTIVATE,
      resourceId: id,
      summary: `启用供应商「${name}」的 ${account.currency} 收款账户：${account.beneficiaryName}，${account.bankName}，${account.swiftBic}，账号 ${maskAccount(account.accountLast4)}${current === null ? "" : `（替换现在的 ${maskAccount(current.accountLast4)}）`}`,
      payload: { account_id: id, tenant_id: account.tenantId, tenant_name: name, ...auditView(account), beneficiary_address: account.beneficiaryAddress, bank_address: account.bankAddress, replaces: current === null ? null : maskAccount(current.accountLast4) },
      before: current === null ? null : auditView(current),
      baseVersion: account.version,
      note,
    });
  });
}

/** 驳回（原因必填，供应商看得到）。有待审核的复核时先把复核处理掉。 */
export async function rejectPayoutAccount(ctx: AppContext, principal: PlatformPrincipal, id: string, reason: string, ip: string): Promise<PayoutAccount & { tenantName: string; pendingApprovalId: string | null }> {
  const now = ctx.now();
  return withPlatformTx(ctx.pool, async (db) => {
    const account = await findPayoutAccount(db, id, { lock: true });
    if (account === null) throw notFound("收款账户");
    if (account.status !== "pending") throw stateInvalid(account, "只有待审核的账户能驳回");
    const pending = await pendingAccountReviewOf(db, id);
    if (pending !== null) throw new AppError(409, "PAYOUT_ACCOUNT_REVIEW_PENDING", "这个账户有一条待审核的复核，先驳回或撤回那条复核", { approval_id: pending });
    await updatePayoutAccount(db, account.tenantId, id, { status: "rejected", rejected_at: now, rejected_by: principal.user.id, reject_reason: reason }, now);
    await insertAuditLog(db, consoleOrigin(platformActor(principal.user), ip, now), { tenantId: null, resource: "payout_account", resourceId: id, action: "reject", before: { status: account.status }, after: { status: "rejected", reason } });
    await notifyAccount(db, "payout_account.rejected", account, reason, now);
    return { ...((await findPayoutAccount(db, id)) as PayoutAccount), tenantName: await tenantName(db, account.tenantId), pendingApprovalId: null };
  });
}

export const PAYOUT_ACCOUNT_ACTIVATE: ApprovalKind = {
  kind: "payout_account.activate",
  resource: "payout_account",
  readAction: "statement.read",
  requestAction: "statement.manage",
  reviewAction: "statement.review",
  unscopedOnly: true,
  async apply(db, approval, origin) {
    const id = approval.payload["account_id"] as string;
    const account = await findPayoutAccount(db, id, { lock: true });
    if (account === null || account.status !== "pending" || account.version !== approval.baseVersion) throw approvalStale(account?.version ?? 0);
    const now = origin.occurredAt;
    const current = await findActiveAccount(db, account.tenantId, account.currency, { lock: true });
    if (current !== null) await updatePayoutAccount(db, current.tenantId, current.id, { status: "superseded", superseded_at: now }, now);
    await updatePayoutAccount(db, account.tenantId, id, { status: "active", approval_id: approval.id, activated_at: now, replaced_previous: current !== null }, now);
    await insertAuditLog(db, origin, {
      tenantId: null,
      resource: "payout_account",
      resourceId: id,
      action: "approve",
      before: current === null ? null : auditView(current),
      after: { ...auditView({ ...account, status: "active" }), approval_id: approval.id, requested_by: approval.requestedBy.id },
    });
    await notifyAccount(db, "payout_account.approved", account, null, now);
  },
};

export const PAYOUT_ACCOUNT_APPROVAL_KINDS: readonly ApprovalKind[] = [PAYOUT_ACCOUNT_ACTIVATE];
