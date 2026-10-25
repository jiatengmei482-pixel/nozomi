/**
 * 汇率人工锁定（M2-06，ADR 0025）：极端行情时临时锁定某个币种的汇率，双人复核。
 *
 * - 发起锁定 / 解锁（`fx.manage`）写一条待审核的复核（通用机制，ADR 0023）；另一位有 `fx.review` 的同事批准后才生效。
 * - 按币种锁「1 USD = rate」，交叉汇率照常由两边算出；锁定期间报价用锁定值，快照的 `fx.lock` 里记明。
 * - 锁定必须带到期时间（最长 72 小时），到期那一刻起不再用；定时任务把它记为到期并写审计（`FxCenter.expireLocks`）。
 * - 锁定期间数据源新拉到的汇率照常入库、照常做 3% 校验（和数据源上一批比），只是这个币种不用它。
 * - 批准时：这个币种的锁定状态在发起之后变过（别人先批了一条锁定、解锁了、到期了）就是 `APPROVAL_STALE`；
 *   中央汇率变了不算——按那一刻的中央汇率重新核对偏离（超过 3% 要有原因、超过 20% 拦截）。
 */
import {
  type CurrencyCode,
  FX_LOCK_RULES,
  FX_RULES,
  type FxLockIssue,
  fxLockActive,
  fxLockApplyIssues,
  fxLockRequestIssues,
  lockDeviation,
} from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { type Db, withPlatformTx } from "../db/context.ts";
import { AppError } from "../errors.ts";
import type { Approval } from "../repos/approvals.ts";
import { type AuditOrigin, type AuditValues, insertAuditLog } from "../repos/audit-logs.ts";
import { type StoredFxLock, activeFxLockFor, endFxLock, findFxLock, insertFxLock, lockFxLocking } from "../repos/fx-locks.ts";
import { latestRateSet } from "../repos/fx.ts";
import { type InputIssue, validationFailed } from "../validation.ts";
import { type ApprovalKind, requestApproval } from "./approvals.ts";
import { consoleOrigin, platformActor } from "./audit.ts";
import { notFound } from "./errors.ts";
import type { PlatformPrincipal } from "./platform-auth.ts";

const ISSUE_MESSAGES: Readonly<Record<FxLockIssue["reason"], string>> = {
  BASE_CURRENCY: `${FX_RULES.base} 是基准币种（恒等于 1），不能锁定`,
  UNSUPPORTED_CURRENCY: "不是平台支持的币种",
  INVALID_RATE: `锁定值要写成大于 0 的十进制数（如 151.2），不带正负号、千分位、指数；整数、小数各最多 ${FX_LOCK_RULES.maxIntegerDigits} 位`,
  EXPIRES_TOO_SOON: `到期时间离现在至少 ${FX_LOCK_RULES.minMinutes} 分钟`,
  EXPIRES_TOO_LATE: `锁定最长 ${FX_LOCK_RULES.maxHours} 小时`,
  REASON_REQUIRED: `锁定值和现在的中央汇率相差超过 ${FX_LOCK_RULES.reasonAboveBp / 100}%，请写明原因`,
  DEVIATION_TOO_LARGE: `锁定值和现在的中央汇率相差超过 ${FX_LOCK_RULES.maxDeviationBp / 100}%，系统不允许；请核对币种和数量级`,
};

function issuesError(issues: readonly FxLockIssue[]): AppError {
  return validationFailed(
    "body",
    issues.map((issue): InputIssue => ({ path: issue.path, reason: issue.reason, message: issue.reason === "EXPIRES_TOO_SOON" && issue.detail?.["min_minutes"] === 0 ? "到期时间已经过了" : ISSUE_MESSAGES[issue.reason], ...(issue.detail === undefined ? {} : { detail: issue.detail }) })),
  );
}

function noRates(): AppError {
  return new AppError(409, "FX_RATE_UNAVAILABLE", "还没有汇率，无法和中央汇率比对；请先拉取汇率");
}

/** 现在用的那批里这个币种的中央汇率（1 USD = ?）和那批的时间。还没有汇率时 409。 */
async function centralRate(db: Db, currency: CurrencyCode): Promise<{ rate: string; asOf: Date }> {
  const set = await latestRateSet(db);
  if (set === null) throw noRates();
  const rate = currency === FX_RULES.base ? "1" : set.rates[currency];
  if (rate === undefined) throw noRates();
  return { rate, asOf: set.asOf };
}

/** 这个币种上真正还在生效的那一条（状态 active 且没到期）。 */
async function liveLock(db: Db, currency: CurrencyCode, now: Date, lock = false): Promise<StoredFxLock | null> {
  const current = await activeFxLockFor(db, currency, { lock });
  return current !== null && fxLockActive({ expiresAt: current.expiresAt.toISOString() }, now) ? current : null;
}

/** 已经过了到期时间、定时任务还没来得及记的那一条：先记成到期（审计的操作者是「系统」），再处理新的复核。 */
async function settleOverdue(db: Db, currency: CurrencyCode, origin: AuditOrigin): Promise<void> {
  const current = await activeFxLockFor(db, currency, { lock: true });
  if (current === null || fxLockActive({ expiresAt: current.expiresAt.toISOString() }, origin.occurredAt)) return;
  await endFxLock(db, current.id, { status: "expired", at: origin.occurredAt, approvalId: null, by: null });
  await insertAuditLog(db, { ...origin, actor: { type: "system", id: null, email: null }, ip: null }, { tenantId: null, resource: "fx_lock", resourceId: current.id, action: "expire", before: { status: "active" }, after: { status: "expired", currency: current.currency, rate: current.rate, expires_at: current.expiresAt.toISOString() } });
}

function stale(message: string, currentLockId: string | null): AppError {
  return new AppError(409, "APPROVAL_STALE", message, { current_lock_id: currentLockId });
}

const percentText = (bp: number): string => `${bp > 0 ? "+" : ""}${(bp / 100).toFixed(2)}%`;
const utcText = (date: Date): string => `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;

export function fxLockValues(lock: StoredFxLock): AuditValues {
  return { lock_id: lock.id, currency: lock.currency, rate: lock.rate, expires_at: lock.expiresAt.toISOString(), reason: lock.reason };
}

// ---- 两类复核 ----

export const FX_LOCK_CREATE: ApprovalKind = {
  kind: "fx_lock.create",
  resource: "fx_lock",
  readAction: "master_data.read",
  requestAction: "fx.manage",
  reviewAction: "fx.review",
  async apply(db, approval, origin) {
    await lockFxLocking(db);
    const now = origin.occurredAt;
    const payload = approval.payload;
    const currency = payload["currency"] as CurrencyCode;
    const rate = payload["rate"] as string;
    const expiresAt = new Date(payload["expires_at"] as string);
    const reason = (payload["reason"] as string | null) ?? null;
    const replaces = (payload["replaces_lock_id"] as string | null) ?? null;
    await settleOverdue(db, currency, origin);
    const existing = await liveLock(db, currency, now, true);
    if ((existing?.id ?? null) !== replaces) {
      throw stale(existing === null ? `发起之后 ${currency} 的锁定已经解除或到期了；请驳回，按现在的情况重新发起` : `发起之后 ${currency} 已经有了另一条锁定（可能是别的复核先批准了）；请驳回，按现在的锁定重新发起`, existing?.id ?? null);
    }
    const central = await centralRate(db, currency);
    const issues = fxLockApplyIssues({ currency, rate, expiresAt, reason }, central.rate, now);
    if (issues.length > 0) throw issuesError(issues);
    const deviation = lockDeviation(central.rate, rate);
    const approverId = origin.actor.id as string;
    if (existing !== null) {
      await endFxLock(db, existing.id, { status: "replaced", at: now, approvalId: approval.id, by: approverId });
      await insertAuditLog(db, origin, { tenantId: null, resource: "fx_lock", resourceId: existing.id, action: "unlock", before: { status: "active", ...fxLockValues(existing) }, after: { status: "replaced", approval_id: approval.id, requested_by: approval.requestedBy.email } });
    }
    const id = await insertFxLock(db, { currency, rate, reason, expiresAt, lockedAt: now, centralRate: central.rate, centralAsOf: central.asOf, deviationBp: deviation.changeBp, lockApprovalId: approval.id, requestedBy: approval.requestedBy.id, approvedBy: approverId });
    await insertAuditLog(db, origin, {
      tenantId: null,
      resource: "fx_lock",
      resourceId: id,
      action: "lock",
      before: existing === null ? { central_rate: central.rate } : fxLockValues(existing),
      after: { currency, rate, expires_at: expiresAt.toISOString(), reason, central_rate: central.rate, central_as_of: central.asOf.toISOString(), deviation_bp: deviation.changeBp, approval_id: approval.id, requested_by: approval.requestedBy.email },
    });
  },
  afterApply(ctx) {
    ctx.fx.invalidate();
  },
};

export const FX_LOCK_RELEASE: ApprovalKind = {
  kind: "fx_lock.release",
  resource: "fx_lock",
  readAction: "master_data.read",
  requestAction: "fx.manage",
  reviewAction: "fx.review",
  async apply(db, approval, origin) {
    await lockFxLocking(db);
    const lockId = approval.payload["lock_id"] as string;
    const currency = approval.payload["currency"] as CurrencyCode;
    await settleOverdue(db, currency, origin);
    const current = await liveLock(db, currency, origin.occurredAt, true);
    if (current === null || current.id !== lockId) throw stale("要解除的这条锁定已经到期、解除或被新的锁定取代了；请驳回", current?.id ?? null);
    await endFxLock(db, current.id, { status: "released", at: origin.occurredAt, approvalId: approval.id, by: origin.actor.id as string });
    await insertAuditLog(db, origin, { tenantId: null, resource: "fx_lock", resourceId: current.id, action: "unlock", before: { status: "active", ...fxLockValues(current) }, after: { status: "released", approval_id: approval.id, requested_by: approval.requestedBy.email, reason: approval.requestNote } });
  },
  afterApply(ctx) {
    ctx.fx.invalidate();
  },
};

/** 汇率这一组的复核（登记到 services/approval-kinds.ts）。 */
export const FX_APPROVAL_KINDS: readonly ApprovalKind[] = [FX_LOCK_CREATE, FX_LOCK_RELEASE];

// ---- 发起 ----

export interface FxLockRequest {
  currency: CurrencyCode;
  rate: string;
  expiresAt: Date;
  reason: string | null;
}

/** 发起锁定（或给已锁定的币种换一个锁定值 / 到期时间：批准后新的取代旧的）。 */
export async function requestFxLock(ctx: AppContext, principal: PlatformPrincipal, input: FxLockRequest, ip: string): Promise<Approval> {
  const now = ctx.now();
  const origin = consoleOrigin(platformActor(principal.user), ip, now);
  return withPlatformTx(ctx.pool, async (db) => {
    const central = await centralRate(db, input.currency);
    const check = fxLockRequestIssues(input, central.rate, now);
    if (check.issues.length > 0 || check.rate === null || check.deviation === null) throw issuesError(check.issues);
    const existing = await liveLock(db, input.currency, now);
    if (existing !== null && existing.rate === check.rate && existing.expiresAt.getTime() === input.expiresAt.getTime()) {
      throw validationFailed("body", [{ path: "/", reason: "UNCHANGED", message: "和现在的锁定一样，不用发起" }]);
    }
    const target = `1 ${FX_RULES.base} = ${check.rate} ${input.currency}`;
    const summary =
      existing === null
        ? `锁定 ${input.currency} 汇率：${target}（中央汇率 ${central.rate}，偏离 ${percentText(check.deviation.changeBp)}），到 ${utcText(input.expiresAt)}`
        : `改 ${input.currency} 的锁定：1 ${FX_RULES.base} = ${existing.rate} → ${check.rate} ${input.currency}（中央汇率 ${central.rate}，偏离 ${percentText(check.deviation.changeBp)}），到 ${utcText(input.expiresAt)}`;
    return requestApproval(db, origin, principal, {
      kind: FX_LOCK_CREATE,
      resourceId: input.currency,
      summary,
      payload: {
        currency: input.currency,
        rate: check.rate,
        expires_at: input.expiresAt.toISOString(),
        reason: input.reason,
        central_rate: central.rate,
        central_as_of: central.asOf.toISOString(),
        deviation_bp: check.deviation.changeBp,
        replaces_lock_id: existing?.id ?? null,
      },
      before: existing === null ? { currency: input.currency, rate: null, central_rate: central.rate } : { ...fxLockValues(existing), central_rate: central.rate },
      baseVersion: null,
      note: input.reason,
    });
  });
}

/** 发起解锁：批准后这个币种恢复用数据源的汇率。 */
export async function requestFxUnlock(ctx: AppContext, principal: PlatformPrincipal, lockId: string, reason: string | null, ip: string): Promise<Approval> {
  const now = ctx.now();
  const origin = consoleOrigin(platformActor(principal.user), ip, now);
  return withPlatformTx(ctx.pool, async (db) => {
    const lock = await findFxLock(db, lockId);
    if (lock === null) throw notFound("锁定记录");
    if (lock.status !== "active" || !fxLockActive({ expiresAt: lock.expiresAt.toISOString() }, now)) {
      throw new AppError(409, "FX_LOCK_NOT_ACTIVE", "这条锁定已经结束（到期、解除或被取代），不用再解锁", { status: lock.status === "active" ? "expired" : lock.status });
    }
    const central = await centralRate(db, lock.currency);
    return requestApproval(db, origin, principal, {
      kind: FX_LOCK_RELEASE,
      resourceId: lock.currency,
      summary: `解除 ${lock.currency} 的锁定（1 ${FX_RULES.base} = ${lock.rate} ${lock.currency}，原定到 ${utcText(lock.expiresAt)}），恢复用中央汇率 ${central.rate}`,
      payload: { lock_id: lock.id, currency: lock.currency, rate: null, central_rate: central.rate },
      before: fxLockValues(lock),
      baseVersion: null,
      note: reason,
    });
  });
}
