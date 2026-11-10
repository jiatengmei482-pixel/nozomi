/**
 * 测试环境的验收通道（M8-26，ADR 0078）：凭口令解锁一个浏览器会话；会话里的官网询价只看 QA 测试供应商的「验收可售」商品，下的是验收单。
 *
 * 两道关：配置层 production 配了口令就拒绝启动（packages/config）；这里每一处再判断 `appEnv !== "production"`（domain 的 `qaAcceptanceEnabled`）。
 * 没配口令时：解锁接口和不存在一样 404（路由层在解析请求体之前就答），带了会话 Cookie 的请求 401（不会悄悄退回普通客人、把验收单下到真实供应商）。
 *
 * - 口令只来自配置，比较用常量时间（两边先各取 SHA-256 再 `timingSafeEqual`，长度不同也不提前返回）。口令不进日志、审计、应答、报错。
 * - 会话：浏览器里是 32 字节随机数（base64url），库里只存它的 SHA-256；有效期 4 小时；结束记 `ended_at`。
 * - 限速：每个来源地址 15 分钟 10 次、全站每小时 30 次，成功失败都计（计数先提交）。口令错记审计（匿名，只记原因，不记口令）。
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { QA_ACCEPTANCE_RULES, type SiteAudience, qaAcceptanceEnabled, rateLimitKeyOf } from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { withPlatformTx } from "../db/context.ts";
import { AppError } from "../errors.ts";
import { insertAuditLog } from "../repos/audit-logs.ts";
import { ANONYMOUS_ACTOR } from "./audit.ts";
import { rateLimited, takeRateSlot } from "./rate-limit.ts";

const SESSION_FORMAT = /^[A-Za-z0-9_-]{43}$/;

const sha256 = (value: string): Buffer => createHash("sha256").update(value, "utf8").digest();
const sha256Hex = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
const ipBucket = (ip: string): string => sha256Hex(`site-qa-unlock:${rateLimitKeyOf(ip)}`);

/** 这个进程里验收通道开没开（配置了口令、不是 production）。 */
export function qaAcceptanceActive(ctx: Pick<AppContext, "config">): boolean {
  return qaAcceptanceEnabled(ctx.config.appEnv, ctx.config.qaAcceptance !== null);
}

/** 常量时间比较：两边各取 SHA-256（长度固定 32 字节）再比，不因长度不同、前缀相同而提前返回。 */
export function tokenMatches(given: string, expected: string): boolean {
  return timingSafeEqual(sha256(given), sha256(expected));
}

/** 验收会话的 Cookie：只在 `/site/v1` 下发送；HttpOnly、Secure、SameSite=Strict。`value` 为 null 是清掉它。 */
export function sessionCookie(value: string | null): string {
  const { cookieName, cookiePath, sessionMs } = QA_ACCEPTANCE_RULES;
  const life = value === null ? "Max-Age=0" : `Max-Age=${Math.floor(sessionMs / 1000)}`;
  return `${cookieName}=${value ?? ""}; Path=${cookiePath}; ${life}; HttpOnly; Secure; SameSite=Strict`;
}

/** 从 Cookie 请求头里取验收会话；没有（或是空值）为 null。只认第一个同名的。 */
export function sessionFromCookieHeader(header: string | string[] | undefined): string | null {
  const text = Array.isArray(header) ? header.join("; ") : (header ?? "");
  for (const part of text.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() !== QA_ACCEPTANCE_RULES.cookieName) continue;
    const value = part.slice(index + 1).trim();
    // 清掉之后的空值当作没有
    return value === "" ? null : value;
  }
  return null;
}

/** 解锁失败、通道没开：和接口不存在一样（`details` 由路由层按请求填）。 */
export class QaAcceptanceHidden extends Error {
  constructor() {
    super("验收通道没有开，或者口令不对");
    this.name = "QaAcceptanceHidden";
  }
}

function sessionInvalid(): AppError {
  return new AppError(401, "QA_SESSION_INVALID", "验收会话无效或已过期：请重新解锁，或清除这个网站的 Cookie 后按普通客人访问");
}

export interface QaAcceptanceSession {
  /** 浏览器里的 Cookie 值（原文只在这一次应答里） */
  value: string;
  expiresAt: Date;
}

/**
 * 解锁：限速（地址、全站）→ 常量时间比较口令 → 建会话。口令不对抛 `QaAcceptanceHidden`（路由层答 404）并记审计。
 * 通道没开也抛 `QaAcceptanceHidden`（路由层其实在更早就答了 404，这里是第二道关）。
 */
export async function unlockQaAcceptance(ctx: AppContext, input: { token: string; ip: string }): Promise<QaAcceptanceSession> {
  const config = ctx.config.qaAcceptance;
  if (config === null || !qaAcceptanceActive(ctx)) throw new QaAcceptanceHidden();
  const now = ctx.now();
  // 计数单独提交：后面口令不对、出错，这一次照样算数
  const decision = await withPlatformTx(ctx.pool, async (db) => {
    const perIp = await takeRateSlot(db, ipBucket(input.ip), "site_qa_unlock", now);
    const global = await takeRateSlot(db, "all", "site_qa_unlock_all", now);
    return !perIp.allowed ? perIp : global;
  });
  if (!decision.allowed) throw rateLimited(decision.retryAfterSeconds);
  const origin = { occurredAt: now, actor: ANONYMOUS_ACTOR, ip: input.ip, source: "api" as const };
  if (!tokenMatches(input.token, config.token)) {
    await withPlatformTx(ctx.pool, (db) => insertAuditLog(db, origin, { tenantId: null, resource: "qa_acceptance_session", resourceId: null, action: "login_failed", before: null, after: { reason: "WRONG_TOKEN" } }));
    throw new QaAcceptanceHidden();
  }
  const value = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + QA_ACCEPTANCE_RULES.sessionMs);
  await withPlatformTx(ctx.pool, async (db) => {
    const created = await db.query<{ id: string }>("insert into qa_acceptance_sessions (token_hash, created_at, expires_at) values ($1, $2, $3) returning id", [sha256Hex(value), now, expiresAt]);
    await insertAuditLog(db, origin, { tenantId: null, resource: "qa_acceptance_session", resourceId: (created.rows[0] as { id: string }).id, action: "unlock", before: null, after: { expires_at: expiresAt.toISOString() } });
  });
  return { value, expiresAt };
}

/** 现在有效的会话（没结束、没过期）；没有为 null。 */
async function findLiveSession(ctx: AppContext, value: string): Promise<{ id: string; expiresAt: Date } | null> {
  if (!SESSION_FORMAT.test(value)) return null;
  const row = await withPlatformTx(ctx.pool, async (db) => (await db.query<{ id: string; expires_at: Date }>("select id, expires_at from qa_acceptance_sessions where token_hash = $1 and ended_at is null and expires_at > $2", [sha256Hex(value), ctx.now()])).rows[0]);
  return row === undefined ? null : { id: row.id, expiresAt: row.expires_at };
}

/** 查看这个浏览器的验收会话（让验收确认自己解锁成功了）：通道没开 `QaAcceptanceHidden`，会话无效 401。 */
export async function currentQaAcceptance(ctx: AppContext, cookieHeader: string | string[] | undefined): Promise<{ expiresAt: Date }> {
  if (!qaAcceptanceActive(ctx)) throw new QaAcceptanceHidden();
  const value = sessionFromCookieHeader(cookieHeader);
  const live = value === null ? null : await findLiveSession(ctx, value);
  if (live === null) throw sessionInvalid();
  return { expiresAt: live.expiresAt };
}

/** 结束会话：记 `ended_at`、审计。会话本来就无效也照样答应（浏览器的 Cookie 由路由层清掉）。通道没开 `QaAcceptanceHidden`。 */
export async function endQaAcceptance(ctx: AppContext, input: { cookieHeader: string | string[] | undefined; ip: string }): Promise<void> {
  if (!qaAcceptanceActive(ctx)) throw new QaAcceptanceHidden();
  const value = sessionFromCookieHeader(input.cookieHeader);
  if (value === null || !SESSION_FORMAT.test(value)) return;
  const now = ctx.now();
  await withPlatformTx(ctx.pool, async (db) => {
    const ended = await db.query<{ id: string }>("update qa_acceptance_sessions set ended_at = $2 where token_hash = $1 and ended_at is null returning id", [sha256Hex(value), now]);
    const id = ended.rows[0]?.id;
    if (id !== undefined) await insertAuditLog(db, { occurredAt: now, actor: ANONYMOUS_ACTOR, ip: input.ip, source: "api" }, { tenantId: null, resource: "qa_acceptance_session", resourceId: id, action: "close", before: null, after: null });
  });
}

/**
 * 官网这次请求看哪一类商品（询价、城市、机场、包车套餐、下单）：
 * - production：一律普通客人，Cookie 不看（第二道关）；
 * - 没带验收会话的 Cookie：普通客人（和以前完全一样）；
 * - 带了：通道开着、会话有效 → 验收；否则 401 `QA_SESSION_INVALID`（不悄悄退回普通客人：那样验收单会下到真实供应商）。
 */
export async function siteAudienceOf(ctx: AppContext, cookieHeader: string | string[] | undefined): Promise<SiteAudience> {
  if (ctx.config.appEnv === "production") return "public";
  const value = sessionFromCookieHeader(cookieHeader);
  if (value === null) return "public";
  if (!qaAcceptanceActive(ctx)) throw sessionInvalid();
  if ((await findLiveSession(ctx, value)) === null) throw sessionInvalid();
  return "acceptance";
}
