/**
 * 平台员工的两步验证（M4-05，ADR 0030）：绑定（含换手机）、登录时输入动态码或恢复码、重新生成恢复码、重置。
 *
 * - 密钥：20 字节随机数，Base32 后用 SecretBox 加密（用途 `platform-totp-secret`，附加数据是员工编号）存在 `platform_users.totp_secret`；
 *   原文只在开始绑定的那一次应答里出现（给验证器 App 扫码 / 手输）。
 * - 绑定要确认：开始绑定只是记下一个待确认的新密钥（15 分钟），输入一次它算出的动态码才生效；换手机时旧的在确认之前照常可用。
 * - 防重放：每次接受的时间窗编号记在账号上，写回的条件是「比上次的晚」，同一时间窗的码只能用一次，并发的两个请求只有一个成功。
 * - 限速：输入动态码 / 恢复码和登录同一套机制（login-guard.ts），单独一组计数（`platform-mfa`）。
 * - 恢复码：一次 10 个，只显示一次，库里只存 SHA-256；用一个少一个；重新生成时整组作废。
 * 每一步都写审计日志；失败的尝试也写（有限速，量有上限）。
 */
import { createHash, createHmac, randomBytes, randomInt } from "node:crypto";
import {
  ENROLLMENT_TTL_MS,
  type HmacSha1,
  TOTP_SECRET_BYTES,
  base32Decode,
  base32Encode,
  checkTotp,
  newRecoveryCodes,
  normalizeRecoveryCode,
  otpauthUri,
} from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { type Db, withPlatformTx } from "../db/context.ts";
import type { Pool } from "../db/pool.ts";
import { SecretBox, SecretBoxError } from "../integrations/secret-box.ts";
import { type AuditAction, type AuditOrigin, type AuditValues, insertAuditLog } from "../repos/audit-logs.ts";
import {
  type MfaMethod,
  type PlatformUser,
  type PlatformUserSecrets,
  activatePendingTotp,
  claimTotpStep,
  clearPlatformTotp,
  countUnusedRecoveryCodes,
  deleteOtherPlatformSessions,
  deletePlatformSessionsOfUser,
  findPlatformSessionUser,
  findPlatformUserByEmail,
  lockPlatformUser,
  markPlatformSessionVerified,
  replaceRecoveryCodes,
  setPendingTotp,
  useRecoveryCode,
} from "../repos/platform-users.ts";
import { AppError } from "../errors.ts";
import { consoleOrigin, platformActor } from "./audit.ts";
import {
  mfaAlreadyEnrolled,
  mfaAlreadyVerified,
  mfaCodeInvalid,
  mfaCodeRequired,
  mfaCodeReused,
  mfaEncryptionNotConfigured,
  mfaEnrollmentNotStarted,
  mfaNotEnrolled,
  mfaSecretUnavailable,
  unauthenticated,
} from "./errors.ts";
import { clearLoginReservation, reserveLogin } from "./login-guard.ts";
import type { PlatformPrincipal } from "./platform-auth.ts";

/** 验证器 App 里显示的发行方 */
export const TOTP_ISSUER = "NOZOMI 运营后台";

const hmacSha1: HmacSha1 = (key, message) => createHmac("sha1", key).update(message).digest();

export function hashRecoveryCode(normalized: string): string {
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

function requireBox(ctx: { secretBox: SecretBox | null }): SecretBox {
  if (ctx.secretBox === null) throw mfaEncryptionNotConfigured();
  return ctx.secretBox;
}

function openSecret(box: SecretBox, userId: string, sealed: string): Uint8Array {
  try {
    const key = base32Decode(box.open("platform-totp-secret", userId, sealed));
    if (key === null) throw new SecretBoxError();
    return key;
  } catch (err) {
    if (err instanceof SecretBoxError) throw mfaSecretUnavailable();
    throw err;
  }
}

export interface FactorInput {
  /** 验证器上的 6 位动态码 */
  code?: string | undefined;
  /** 一次性恢复码 */
  recoveryCode?: string | undefined;
}

type FactorFailure = "INVALID" | "REUSED";

/**
 * 核对一个因素（动态码或恢复码）并把它「用掉」：动态码写回时间窗，恢复码记使用时间。都在调用方的事务里。
 * `secrets` 是刚读到的账号（含加密的密钥）；写回时核对密钥没换过。
 */
async function consumeFactor(db: Db, box: SecretBox, secrets: PlatformUserSecrets, input: FactorInput, now: Date): Promise<{ ok: true; method: "totp" | "recovery_code" } | { ok: false; reason: FactorFailure }> {
  const userId = secrets.user.id;
  if (input.recoveryCode !== undefined) {
    const normalized = normalizeRecoveryCode(input.recoveryCode);
    if (normalized === null) return { ok: false, reason: "INVALID" };
    return (await useRecoveryCode(db, userId, hashRecoveryCode(normalized), now)) ? { ok: true, method: "recovery_code" } : { ok: false, reason: "INVALID" };
  }
  if (secrets.totpSecret === null || input.code === undefined) return { ok: false, reason: "INVALID" };
  const checked = checkTotp(hmacSha1, openSecret(box, userId, secrets.totpSecret), input.code, now.getTime(), secrets.totpLastStep);
  if (!checked.ok) return checked;
  // 两个请求同时用同一个码：只有先写回的那个成功，后一个按重放处理
  if (!(await claimTotpStep(db, userId, secrets.totpSecret, checked.step))) return { ok: false, reason: "REUSED" };
  return { ok: true, method: "totp" };
}

function factorError(reason: FactorFailure): AppError {
  return reason === "REUSED" ? mfaCodeReused() : mfaCodeInvalid();
}

async function auditMfa(db: Db, origin: AuditOrigin, userId: string, action: AuditAction, after: AuditValues | null): Promise<void> {
  await insertAuditLog(db, origin, { tenantId: null, resource: "platform_user", resourceId: userId, action, before: null, after });
}

/** 失败的尝试单独写一条审计（在自己的事务里：核对失败时业务事务要回滚，审计不能跟着没了）。 */
async function auditFailure(ctx: AppContext, principal: PlatformPrincipal, ip: string, step: string, reason: FactorFailure): Promise<void> {
  await withPlatformTx(ctx.pool, (db) => auditMfa(db, consoleOrigin(platformActor(principal.user), ip, ctx.now()), principal.user.id, "mfa_failed", { step, reason }));
}

/**
 * 登录的第二步：这个会话还是「待验证」的、账号绑定过验证器，输入动态码或恢复码。
 * 通过后会话延长到令牌的过期时间（登录起 8 小时），同一个令牌恢复正常。
 */
export async function verifyPlatformSecondFactor(ctx: AppContext, principal: PlatformPrincipal, input: FactorInput, ip: string): Promise<{ user: PlatformUser; method: MfaMethod; recoveryCodesRemaining: number }> {
  if (principal.secondFactor === "verified") throw mfaAlreadyVerified();
  if (principal.secondFactor === "enrollment_required") throw mfaNotEnrolled();
  const box = requireBox(ctx);
  const now = ctx.now();
  const reservation = await reserveLogin(ctx, "platform-mfa", principal.user.email, ip, now);
  const result = await withPlatformTx(ctx.pool, async (db) => {
    const locked = await lockPlatformUser(db, principal.user.id);
    if (!locked || locked.user.status !== "active") throw unauthenticated();
    if (locked.totpSecret === null) throw mfaNotEnrolled();
    const consumed = await consumeFactor(db, box, locked, input, now);
    if (!consumed.ok) return consumed;
    if (!(await markPlatformSessionVerified(db, principal.sessionId, consumed.method, principal.tokenExpiresAt, now))) {
      // 会话在这期间被作废（退出、改密、被停用）或已经验证过：这次核对不算数
      throw (await findPlatformSessionUser(db, principal.sessionId, principal.user.id, now)) ? mfaAlreadyVerified() : unauthenticated();
    }
    const remaining = await countUnusedRecoveryCodes(db, principal.user.id);
    await auditMfa(db, consoleOrigin(platformActor(locked.user), ip, now), locked.user.id, "mfa_verify", { method: consumed.method, ...(consumed.method === "recovery_code" ? { recovery_codes_remaining: remaining } : {}) });
    return { ok: true as const, user: locked.user, method: consumed.method, remaining };
  });
  if (!result.ok) {
    await auditFailure(ctx, principal, ip, "verify", result.reason);
    throw factorError(result.reason);
  }
  await clearLoginReservation(ctx, reservation);
  return { user: result.user, method: result.method, recoveryCodesRemaining: result.remaining };
}

export interface EnrollmentStart {
  /** Base32 的密钥原文：只在这一次应答里出现 */
  secret: string;
  otpauthUri: string;
  expiresAt: Date;
}

/**
 * 开始绑定：生成一个新密钥，等本人输入一次它算出的动态码确认（`confirmPlatformEnrollment`）。
 * - 第一次绑定（会话待验证、账号没绑定过）：直接开始；
 * - 换手机（会话已验证）：要先输入现在的动态码或一个恢复码，确认是本人——拿着别人没锁屏的电脑不能把验证器换成自己的；
 * - 会话待验证、账号已经绑定过：不行，先输入动态码登录（只知道密码的人不能借「重新绑定」绕过两步验证）。
 * 再次开始会覆盖之前没确认的那个。
 */
export async function startPlatformEnrollment(ctx: AppContext, principal: PlatformPrincipal, input: FactorInput, ip: string): Promise<EnrollmentStart> {
  if (principal.secondFactor === "verify_required") throw mfaAlreadyEnrolled();
  const rebind = principal.secondFactor === "verified";
  if (rebind && input.code === undefined && input.recoveryCode === undefined) throw mfaCodeRequired();
  const box = requireBox(ctx);
  const now = ctx.now();
  const secret = base32Encode(randomBytes(TOTP_SECRET_BYTES));
  const sealed = box.seal("platform-totp-secret", principal.user.id, secret);
  const expiresAt = new Date(now.getTime() + ENROLLMENT_TTL_MS);
  const reservation = rebind ? await reserveLogin(ctx, "platform-mfa", principal.user.email, ip, now) : null;
  const failure = await withPlatformTx(ctx.pool, async (db) => {
    const locked = await lockPlatformUser(db, principal.user.id);
    if (!locked || locked.user.status !== "active") throw unauthenticated();
    if (!rebind && locked.totpSecret !== null) throw mfaAlreadyEnrolled();
    if (rebind) {
      const consumed = await consumeFactor(db, box, locked, input, now);
      if (!consumed.ok) return consumed.reason;
    }
    await setPendingTotp(db, locked.user.id, sealed, expiresAt);
    await auditMfa(db, consoleOrigin(platformActor(locked.user), ip, now), locked.user.id, "mfa_enroll_start", { rebind });
    return null;
  });
  if (failure !== null) {
    await auditFailure(ctx, principal, ip, "enroll_start", failure);
    throw factorError(failure);
  }
  if (reservation) await clearLoginReservation(ctx, reservation);
  return { secret, otpauthUri: otpauthUri({ issuer: TOTP_ISSUER, account: principal.user.email, secretBase32: secret }), expiresAt };
}

/**
 * 确认绑定：输入新密钥算出的动态码。通过后新密钥生效（换手机时旧的同时作废），生成一组新的恢复码（原文只在这一次应答里），
 * 这个会话算完成了两步验证；这个账号的其他会话全部失效（换手机多半是因为旧手机丢了）。
 */
export async function confirmPlatformEnrollment(ctx: AppContext, principal: PlatformPrincipal, code: string, ip: string): Promise<{ user: PlatformUser; recoveryCodes: string[] }> {
  if (principal.secondFactor === "verify_required") throw mfaAlreadyEnrolled();
  const box = requireBox(ctx);
  const now = ctx.now();
  const reservation = await reserveLogin(ctx, "platform-mfa", principal.user.email, ip, now);
  const recoveryCodes = newRecoveryCodes(randomInt);
  const result = await withPlatformTx(ctx.pool, async (db) => {
    const locked = await lockPlatformUser(db, principal.user.id);
    if (!locked || locked.user.status !== "active") throw unauthenticated();
    const rebind = principal.secondFactor === "verified";
    if (!rebind && locked.totpSecret !== null) throw mfaAlreadyEnrolled();
    if (locked.totpPendingSecret === null || locked.totpPendingExpiresAt === null || locked.totpPendingExpiresAt.getTime() <= now.getTime()) throw mfaEnrollmentNotStarted();
    const checked = checkTotp(hmacSha1, openSecret(box, locked.user.id, locked.totpPendingSecret), code, now.getTime(), null);
    if (!checked.ok) return { ok: false as const, reason: checked.reason };
    await activatePendingTotp(db, locked.user.id, locked.totpPendingSecret, checked.step, now);
    await replaceRecoveryCodes(db, locked.user.id, recoveryCodes.map((c) => hashRecoveryCode(normalizeRecoveryCode(c) as string)), now);
    if (!rebind && !(await markPlatformSessionVerified(db, principal.sessionId, "enrollment", principal.tokenExpiresAt, now))) throw unauthenticated();
    if (rebind && !(await findPlatformSessionUser(db, principal.sessionId, locked.user.id, now))) throw unauthenticated();
    await deleteOtherPlatformSessions(db, locked.user.id, principal.sessionId);
    await auditMfa(db, consoleOrigin(platformActor(locked.user), ip, now), locked.user.id, "mfa_enroll", { rebind, recovery_codes: recoveryCodes.length });
    return { ok: true as const, user: (await lockPlatformUser(db, locked.user.id))?.user ?? locked.user };
  });
  if (!result.ok) {
    await auditFailure(ctx, principal, ip, "enroll_confirm", result.reason);
    throw factorError(result.reason);
  }
  await clearLoginReservation(ctx, reservation);
  return { user: result.user, recoveryCodes };
}

/** 重新生成恢复码：要输入现在的动态码（或一个恢复码）；旧的整组作废，新的只显示这一次。 */
export async function regeneratePlatformRecoveryCodes(ctx: AppContext, principal: PlatformPrincipal, input: FactorInput, ip: string): Promise<string[]> {
  if (input.code === undefined && input.recoveryCode === undefined) throw mfaCodeRequired();
  const box = requireBox(ctx);
  const now = ctx.now();
  const reservation = await reserveLogin(ctx, "platform-mfa", principal.user.email, ip, now);
  const recoveryCodes = newRecoveryCodes(randomInt);
  const failure = await withPlatformTx(ctx.pool, async (db) => {
    const locked = await lockPlatformUser(db, principal.user.id);
    if (!locked || locked.user.status !== "active") throw unauthenticated();
    if (locked.totpSecret === null) throw mfaNotEnrolled();
    const consumed = await consumeFactor(db, box, locked, input, now);
    if (!consumed.ok) return consumed.reason;
    await replaceRecoveryCodes(db, locked.user.id, recoveryCodes.map((c) => hashRecoveryCode(normalizeRecoveryCode(c) as string)), now);
    await auditMfa(db, consoleOrigin(platformActor(locked.user), ip, now), locked.user.id, "mfa_recovery_codes", { count: recoveryCodes.length });
    return null;
  });
  if (failure !== null) {
    await auditFailure(ctx, principal, ip, "recovery_codes", failure);
    throw factorError(failure);
  }
  await clearLoginReservation(ctx, reservation);
  return recoveryCodes;
}

export async function recoveryCodesRemaining(ctx: AppContext, userId: string): Promise<number> {
  return withPlatformTx(ctx.pool, (db) => countUnusedRecoveryCodes(db, userId));
}

/**
 * 清掉一个员工的两步验证（在调用方的事务里）：密钥、恢复码都作废，全部会话失效；下次登录要重新绑定。
 * 后台的「重置两步验证」（双人复核批准时）和命令行 `admin:reset-2fa` 都用它。
 */
export async function clearStaffMfa(db: Db, userId: string, origin: AuditOrigin, after: AuditValues | null, now: Date): Promise<void> {
  await clearPlatformTotp(db, userId, now);
  await deletePlatformSessionsOfUser(db, userId);
  await insertAuditLog(db, origin, { tenantId: null, resource: "platform_user", resourceId: userId, action: "mfa_reset", before: null, after });
}

/**
 * 命令行 `pnpm admin:reset-2fa --email …`：紧急情况（手机和恢复码都丢了，又没有第二位超级管理员能在后台审核）。
 * 对任何在用的平台员工有效；审计记为「系统 / 命令行」。
 */
export async function resetStaffMfaFromCli(pool: Pool, email: string, now: Date): Promise<PlatformUser> {
  return withPlatformTx(pool, async (db) => {
    const found = await findPlatformUserByEmail(db, email, { lock: true });
    if (!found || found.user.status !== "active") throw new AppError(404, "NOT_FOUND", "没有这个邮箱的在用平台员工");
    await clearStaffMfa(db, found.user.id, { occurredAt: now, actor: { type: "system", id: null, email: null }, ip: null, source: "cli" }, { was_enrolled: found.totpSecret !== null }, now);
    return found.user;
  });
}
