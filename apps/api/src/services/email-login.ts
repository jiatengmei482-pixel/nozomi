/**
 * 邮箱验证码登录的公共部分（M4-06，ADR 0050）：现在哪些登录方式可用、发码、校验码。
 * 校验通过之后的账号检查和建会话在 platform-auth.ts、tenant-auth.ts，和密码登录走同一段代码。
 *
 * 防枚举的做法：发码接口在应答之前只做和账号无关的事（查邮件配置、占限速），查账号、写库、发信都在应答之后的后台任务里；
 * 不存在、停用、待激活的账号同样写一行（哈希是随机值，什么码都对不上），之后校验走的 SQL 和真实账号完全一样。
 * 验证码和完整邮箱不进日志、审计；库里只有 HMAC。
 */
import { createHash, createHmac, hkdfSync, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import {
  EMAIL_CODE_MAX_ATTEMPTS,
  EMAIL_CODE_SEND_COOLDOWN,
  EMAIL_CODE_SEND_LIMITS_PER_EMAIL,
  EMAIL_CODE_SEND_LIMIT_PER_IP,
  EMAIL_CODE_TTL_MS,
  type EmailCodeSendLimit,
  type LoginMethods,
  type LoginPortal,
  emailCodeMail,
  evaluateFixedWindow,
  maskLoginEmail,
  rateLimitKeyOf,
  resolveLoginMethods,
} from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { withPlatformTx, withPreAuthTx, withTenantTx } from "../db/context.ts";
import { type AuditValues, insertAuditLog } from "../repos/audit-logs.ts";
import { consumeEmailCode, replaceEmailCode, takeEmailCodeAttempt } from "../repos/email-login-codes.ts";
import { clearLoginAttempts, deleteStaleLoginThrottles, reserveLoginAttempt } from "../repos/login-throttles.ts";
import { findPlatformUserByEmail } from "../repos/platform-users.ts";
import { findTenantUserSecrets, locateTenantUserByEmailAcrossTenants } from "../repos/tenant-users.ts";
import { ANONYMOUS_ACTOR, consoleOrigin } from "./audit.ts";
import { emailCodeInvalid, emailCodeUnavailable, passwordLoginDisabled, tooManyLoginAttempts } from "./errors.ts";
import { type LoginReservation, clearLoginReservation, reserveLogin } from "./login-guard.ts";
import { sendMail } from "./mail.ts";

export interface EmailLoginLog {
  warn(details: object, message: string): void;
  error(details: object, message: string): void;
}

export interface VerifyEmailCodeInput {
  email: string;
  code: string;
}

export async function currentLoginMethods(ctx: AppContext): Promise<LoginMethods> {
  await ctx.integrations.ensureFresh();
  return resolveLoginMethods({ mailConfigured: ctx.integrations.effective.email.config !== null, passwordLoginDisabled: ctx.config.passwordLoginDisabled });
}

/** 密码登录入口的第一步。没有明确要求关闭时不查别的，密码登录的路径和原来一样。 */
export async function assertPasswordLoginOpen(ctx: AppContext): Promise<void> {
  if (!ctx.config.passwordLoginDisabled) return;
  if (!(await currentLoginMethods(ctx)).password) throw passwordLoginDisabled();
}

const hmacKeys = new Map<string, Buffer>();

function hmacKey(secret: string): Buffer {
  let key = hmacKeys.get(secret);
  if (key === undefined) {
    key = Buffer.from(hkdfSync("sha256", secret, Buffer.alloc(0), "nozomi/email-login-code/v1", 32));
    hmacKeys.set(secret, key);
  }
  return key;
}

function hmacHex(ctx: AppContext, ...parts: string[]): string {
  return createHmac("sha256", hmacKey(ctx.config.authJwtSecret)).update(parts.join("\n"), "utf8").digest("hex");
}

/** 平台和租户各算各的：同一个邮箱两边的码互不相通。 */
const emailKeyOf = (ctx: AppContext, portal: LoginPortal, email: string): string => hmacHex(ctx, "email", portal, email);
const codeHashOf = (ctx: AppContext, portal: LoginPortal, email: string, code: string): string => hmacHex(ctx, "code", portal, email, code);

function sendThrottleKey(portal: LoginPortal, dimension: string, value: string): string {
  return createHash("sha256").update(["email-code-send", portal, dimension, value].join("\n"), "utf8").digest("hex");
}

const perEmailSendKey = (portal: LoginPortal, email: string, limit: EmailCodeSendLimit): string => sendThrottleKey(portal, `email:${limit.windowMs}`, email);

/**
 * 占用一次发码。先看来源地址，再看连发间隔，最后看累计：被前面拦下的不占后面的次数，否则别人连点就能把这个邮箱的累计额度顶满。
 * 不管账号存不存在都一样计数。
 */
async function reserveEmailCodeSend(ctx: AppContext, portal: LoginPortal, email: string, ip: string, now: Date): Promise<void> {
  const steps: { key: string; limit: EmailCodeSendLimit }[] = [
    { key: sendThrottleKey(portal, "ip", rateLimitKeyOf(ip)), limit: EMAIL_CODE_SEND_LIMIT_PER_IP },
    { key: sendThrottleKey(portal, "cooldown", email), limit: EMAIL_CODE_SEND_COOLDOWN },
    ...EMAIL_CODE_SEND_LIMITS_PER_EMAIL.map((limit) => ({ key: perEmailSendKey(portal, email, limit), limit })),
  ];
  const retryAfterSeconds = await withPreAuthTx(ctx.pool, async (db) => {
    await deleteStaleLoginThrottles(db, now);
    for (const { key, limit } of steps) {
      const counter = await reserveLoginAttempt(db, key, now, limit.windowMs);
      const decision = evaluateFixedWindow(counter, limit.maxSends, limit.windowMs, now);
      if (!decision.allowed) return decision.retryAfterSeconds;
    }
    return null;
  });
  if (retryAfterSeconds !== null) throw tooManyLoginAttempts(retryAfterSeconds);
}

/** 正在跑的后台任务：服务关闭时等它们结束。 */
const running = new WeakMap<AppContext, Set<Promise<void>>>();

function inBackground(ctx: AppContext, log: EmailLoginLog, task: () => Promise<void>): void {
  const tasks = running.get(ctx) ?? new Set<Promise<void>>();
  running.set(ctx, tasks);
  const started: Promise<void> = new Promise<void>((resolve) => setImmediate(resolve))
    .then(task)
    .catch((err: unknown) => log.error({ event: "email_code.task_failed", err }, "邮箱验证码的后台任务失败"))
    .finally(() => tasks.delete(started));
  tasks.add(started);
}

export async function emailLoginIdle(ctx: AppContext): Promise<void> {
  const tasks = running.get(ctx);
  while (tasks !== undefined && tasks.size > 0) await Promise.all(tasks);
}

function warnWhenThrottled<T>(log: EmailLoginLog, portal: LoginPortal, stage: "send" | "verify", work: Promise<T>): Promise<T> {
  return work.catch((err: unknown) => {
    if (typeof err === "object" && err !== null && (err as { code?: unknown }).code === "TOO_MANY_LOGIN_ATTEMPTS") {
      log.warn({ event: "email_code.rate_limited", portal, stage }, "邮箱验证码被限速");
    }
    throw err;
  });
}

/** 这个邮箱对应的账号；审计归到哪里、要不要真的发信都看它。 */
interface LocatedAccount {
  id: string;
  tenantId: string | null;
  status: string;
}

async function locateAccount(ctx: AppContext, portal: LoginPortal, email: string): Promise<LocatedAccount | null> {
  if (portal === "platform") {
    const found = await withPlatformTx(ctx.pool, (db) => findPlatformUserByEmail(db, email));
    return found ? { id: found.user.id, tenantId: null, status: found.user.status } : null;
  }
  const locator = await withPreAuthTx(ctx.pool, (db) => locateTenantUserByEmailAcrossTenants(db, email));
  if (!locator) return null;
  const found = await withTenantTx(ctx.pool, locator.tenantId, (db) => findTenantUserSecrets(db, locator.tenantId, locator.userId));
  return found ? { id: found.user.id, tenantId: locator.tenantId, status: found.user.status } : null;
}

/** 匿名审计：租户账号的写进那个租户的事务（租户管理员看得到），定位不到账号的 `tenant_id` 为 null。 */
async function auditAnonymous(ctx: AppContext, portal: LoginPortal, account: LocatedAccount | null, ip: string, now: Date, action: "email_code_request" | "email_code_failed", after: AuditValues): Promise<void> {
  const origin = consoleOrigin(ANONYMOUS_ACTOR, ip, now);
  const entry = { resource: portal === "platform" ? ("platform_user" as const) : ("tenant_user" as const), resourceId: account?.id ?? null, action, before: null, after };
  if (portal === "platform") {
    await withPlatformTx(ctx.pool, (db) => insertAuditLog(db, origin, { ...entry, tenantId: null }));
  } else if (account?.tenantId) {
    const tenantId = account.tenantId;
    await withTenantTx(ctx.pool, tenantId, (db) => insertAuditLog(db, origin, { ...entry, tenantId }));
  } else {
    await withPreAuthTx(ctx.pool, (db) => insertAuditLog(db, origin, { ...entry, tenantId: null }));
  }
}

async function deliverCode(ctx: AppContext, log: EmailLoginLog, portal: LoginPortal, email: string, ip: string, now: Date): Promise<void> {
  const account = await locateAccount(ctx, portal, email);
  const eligible = account?.status === "active";
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await withPreAuthTx(ctx.pool, (db) =>
    replaceEmailCode(db, {
      emailKey: emailKeyOf(ctx, portal, email),
      codeHash: eligible ? codeHashOf(ctx, portal, email, code) : randomBytes(32).toString("hex"),
      createdAt: now,
      expiresAt: new Date(now.getTime() + EMAIL_CODE_TTL_MS),
    }),
  );
  const masked = maskLoginEmail(email);
  if (!eligible) {
    await auditAnonymous(ctx, portal, account, ip, now, "email_code_request", { email: masked, outcome: account ? "not_active" : "no_account" });
    return;
  }
  const result = await sendMail(ctx, { to: email, ...emailCodeMail(portal, code) });
  if (result.ok) {
    await auditAnonymous(ctx, portal, account, ip, now, "email_code_request", { email: masked, outcome: "sent" });
    return;
  }
  log.error({ event: "email_code.send_failed", portal, code: result.code }, "邮箱验证码发送失败");
  await auditAnonymous(ctx, portal, account, ip, now, "email_code_request", { email: masked, outcome: "send_failed", error: result.code });
}

/**
 * 发码。应答和耗时与账号无关：这里只查邮件配置、占限速，其余都在应答之后的后台任务里。
 * 邮件没配置时 503（和邮箱无关）。
 */
export async function requestEmailCode(ctx: AppContext, log: EmailLoginLog, portal: LoginPortal, email: string, ip: string): Promise<void> {
  if (!(await currentLoginMethods(ctx)).emailCode) throw emailCodeUnavailable();
  const now = ctx.now();
  await warnWhenThrottled(log, portal, "send", reserveEmailCodeSend(ctx, portal, email, ip, now));
  inBackground(ctx, log, () => deliverCode(ctx, log, portal, email, ip, now));
}

/**
 * 校验码。通过了返回限速的占用（登录成功后凭它清零）；邮箱不存在、没发过、码错、过期、用过、次数用尽都是同一个 401。
 *
 * 并发：占用一次尝试是一条带行锁的 update，猜码绕不过 5 次；比较是恒定时间的；通过之后 delete 这一行，影响到一行的才算数，
 * 所以同一个码并发提交也只有一个请求成功。失败的审计在后台写（要先查账号才知道归到哪个租户，放在这里耗时就和账号有关了）。
 */
export async function verifyEmailCode(ctx: AppContext, log: EmailLoginLog, portal: LoginPortal, input: VerifyEmailCodeInput, ip: string, now: Date): Promise<LoginReservation> {
  const { email, code } = input;
  const reservation = await warnWhenThrottled(log, portal, "verify", reserveLogin(ctx, `${portal}-email-code`, email, ip, now));
  const emailKey = emailKeyOf(ctx, portal, email);
  const submitted = codeHashOf(ctx, portal, email, code);
  const attempt = await withPreAuthTx(ctx.pool, (db) => takeEmailCodeAttempt(db, emailKey, now));
  const expected = attempt?.codeHash ?? randomBytes(32).toString("hex");
  const matches = timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(submitted, "hex")) && attempt !== null;
  const consumed = matches && (await withPreAuthTx(ctx.pool, (db) => consumeEmailCode(db, emailKey, submitted)));
  if (consumed) return reservation;
  const reason = attempt !== null && !matches && attempt.attemptCount >= EMAIL_CODE_MAX_ATTEMPTS ? "exhausted" : "invalid";
  inBackground(ctx, log, async () => {
    const account = await locateAccount(ctx, portal, email);
    await auditAnonymous(ctx, portal, account, ip, now, "email_code_failed", { email: maskLoginEmail(email), reason });
  });
  throw emailCodeInvalid();
}

/** 登录成功：校验的邮箱维度清零、地址退还；发码的 15 分钟计数清零。24 小时计数不清零，见 domain 的 `resetOnLogin`。 */
export async function settleEmailCodeLogin(ctx: AppContext, portal: LoginPortal, email: string, reservation: LoginReservation): Promise<void> {
  await clearLoginReservation(ctx, reservation);
  await withPreAuthTx(ctx.pool, (db) => clearLoginAttempts(db, EMAIL_CODE_SEND_LIMITS_PER_EMAIL.filter((limit) => limit.resetOnLogin).map((limit) => perEmailSendKey(portal, email, limit))));
}
