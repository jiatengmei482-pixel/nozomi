/**
 * 渠道的 API 客户端与密钥（M2-04，ADR 0023）：渠道调用 `/sales/v1` 的凭据（client_id + client_secret，换 2 小时的访问令牌）。
 *
 * - 密钥原文只在新建、轮换的那一次应答里出现；库里只存 SHA-256（密钥是 32 字节随机数，不需要慢哈希），后台只显示后 4 位（需求「密钥管理」）。
 * - 轮换：发一个新密钥；被换下的那一代默认还能用 24 小时（宽限期，让渠道有时间换上），也可以选择立即作废（密钥泄露时，所有旧代一起作废）。
 *   宽限期里再轮换一次，之前那几代各自的 24 小时照旧算（每一代从它被换下的时刻起算），最多同时保留 5 代；宽限期过后，用旧密钥换来的令牌也失效。
 * - 吊销：这个客户端和它换来的令牌立即失效，不能恢复（要用就新建一个）。
 * - 审计日志里只有 client_id、名称和后 4 位，没有密钥原文和哈希（规则 5）。
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { AppContext } from "../context.ts";
import { type Db, withPlatformTx } from "../db/context.ts";
import { AppError } from "../errors.ts";
import { insertAuditLog } from "../repos/audit-logs.ts";
import { findChannel } from "../repos/channels.ts";
import { consoleOrigin, platformActor } from "./audit.ts";
import { notFound } from "./errors.ts";
import type { PlatformPrincipal } from "./platform-auth.ts";

/** 轮换后旧密钥还能用多久：24 小时 */
export const SECRET_ROTATION_GRACE_MS = 24 * 60 * 60 * 1000;
/** 同时在宽限期里的旧密钥最多几代（再多就把最早的那一代作废）：防止反复轮换攒下一串都能用的旧密钥 */
export const MAX_RETIRED_SECRETS = 5;

/** 被换下、还在宽限期里的一代密钥（只有哈希）。 */
export interface RetiredSecret {
  generation: number;
  hash: string;
  /** ISO 时刻：到这一刻起失效 */
  valid_until: string;
}

/** 还能用的旧代（宽限期没过）。 */
export function usableRetired(list: readonly RetiredSecret[], now: Date): RetiredSecret[] {
  return list.filter((entry) => new Date(entry.valid_until).getTime() > now.getTime());
}

/**
 * 轮换后的旧代清单：立即作废时清空；否则去掉已过期的，把刚换下的这一代加进去（24 小时），超过 5 代时去掉最早的。
 */
export function retireSecret(list: readonly RetiredSecret[], current: { generation: number; hash: string }, now: Date, immediate: boolean): RetiredSecret[] {
  if (immediate) return [];
  const kept = [...usableRetired(list, now), { generation: current.generation, hash: current.hash, valid_until: new Date(now.getTime() + SECRET_ROTATION_GRACE_MS).toISOString() }];
  return kept.slice(-MAX_RETIRED_SECRETS);
}

const SECRET_PREFIX = "nzs_";
const CLIENT_PREFIX = "nzc_";

export function hashClientSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/** 两个十六进制哈希是否相同（等时比较）。 */
export function sameSecretHash(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

function newSecret(): { secret: string; hash: string; last4: string } {
  const secret = `${SECRET_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { secret, hash: hashClientSecret(secret), last4: secret.slice(-4) };
}

export interface ApiClient {
  id: string;
  channelId: string;
  clientId: string;
  name: string;
  secretLast4: string;
  secretGeneration: number;
  previousValidUntil: Date | null;
  status: "active" | "revoked";
  createdAt: Date;
  rotatedAt: Date | null;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
}

interface ApiClientRow {
  id: string;
  channel_id: string;
  client_id: string;
  name: string;
  secret_last4: string;
  secret_generation: number;
  retired_secrets: RetiredSecret[];
  secret_hash: string;
  status: "active" | "revoked";
  created_at: Date;
  rotated_at: Date | null;
  revoked_at: Date | null;
  last_used_at: Date | null;
}

const COLUMNS = "id, channel_id, client_id, name, secret_last4, secret_generation, retired_secrets, secret_hash, status, created_at, rotated_at, revoked_at, last_used_at";

/** 还在宽限期里的旧代里最晚的那个失效时刻（给后台显示）；没有为 null。 */
function latestGrace(list: readonly RetiredSecret[], now: Date): Date | null {
  const times = usableRetired(list, now).map((entry) => new Date(entry.valid_until).getTime());
  return times.length === 0 ? null : new Date(Math.max(...times));
}

function toClient(row: ApiClientRow, now: Date): ApiClient {
  return {
    id: row.id,
    channelId: row.channel_id,
    clientId: row.client_id,
    name: row.name,
    secretLast4: row.secret_last4,
    secretGeneration: row.secret_generation,
    previousValidUntil: latestGrace(row.retired_secrets, now),
    status: row.status,
    createdAt: row.created_at,
    rotatedAt: row.rotated_at,
    revokedAt: row.revoked_at,
    lastUsedAt: row.last_used_at,
  };
}

export interface IssuedSecret {
  client: ApiClient;
  /** 原文：只能出现在这一次应答里 */
  secret: string;
}

async function requireChannel(db: Db, channelId: string): Promise<void> {
  if (!(await findChannel(db, channelId))) throw notFound("渠道");
}

async function loadClientRow(db: Db, channelId: string, id: string, lock: boolean): Promise<ApiClientRow> {
  const result = await db.query<ApiClientRow>(`select ${COLUMNS} from channel_api_clients where channel_id = $1 and id = $2 ${lock ? "for update" : ""}`, [channelId, id]);
  const row = result.rows[0];
  if (!row) throw notFound("API 客户端");
  return row;
}

export function listApiClients(ctx: AppContext, channelId: string): Promise<ApiClient[]> {
  const now = ctx.now();
  return withPlatformTx(ctx.pool, async (db) => {
    await requireChannel(db, channelId);
    const result = await db.query<ApiClientRow>(`select ${COLUMNS} from channel_api_clients where channel_id = $1 order by created_at desc, id`, [channelId]);
    return result.rows.map((row) => toClient(row, now));
  });
}

const auditView = (client: ApiClient): Record<string, string | number | null> => ({ client_id: client.clientId, name: client.name, secret_last4: client.secretLast4, secret_generation: client.secretGeneration, status: client.status });

export async function createApiClient(ctx: AppContext, principal: PlatformPrincipal, channelId: string, name: string, ip: string): Promise<IssuedSecret> {
  const now = ctx.now();
  const origin = consoleOrigin(platformActor(principal.user), ip, now);
  const fresh = newSecret();
  const clientId = `${CLIENT_PREFIX}${randomBytes(12).toString("hex")}`;
  return withPlatformTx(ctx.pool, async (db) => {
    await requireChannel(db, channelId);
    const result = await db.query<ApiClientRow>(
      `insert into channel_api_clients (channel_id, client_id, name, secret_hash, secret_last4, created_by, created_at) values ($1, $2, $3, $4, $5, $6, $7) returning ${COLUMNS}`,
      [channelId, clientId, name, fresh.hash, fresh.last4, principal.user.id, now],
    );
    const client = toClient(result.rows[0] as ApiClientRow, now);
    await insertAuditLog(db, origin, { tenantId: null, resource: "api_client", resourceId: client.id, action: "create", before: null, after: { channel_id: channelId, ...auditView(client) } });
    return { client, secret: fresh.secret };
  });
}

export async function rotateApiClient(ctx: AppContext, principal: PlatformPrincipal, channelId: string, id: string, immediate: boolean, ip: string): Promise<IssuedSecret> {
  const now = ctx.now();
  const origin = consoleOrigin(platformActor(principal.user), ip, now);
  const fresh = newSecret();
  return withPlatformTx(ctx.pool, async (db) => {
    const row = await loadClientRow(db, channelId, id, true);
    const current = toClient(row, now);
    if (current.status === "revoked") throw new AppError(409, "API_CLIENT_REVOKED", "这个 API 客户端已经吊销，不能轮换；请新建一个");
    const retired = retireSecret(row.retired_secrets, { generation: row.secret_generation, hash: row.secret_hash }, now, immediate);
    const result = await db.query<ApiClientRow>(
      `update channel_api_clients
          set retired_secrets = $3::jsonb, secret_hash = $4, secret_last4 = $5, secret_generation = secret_generation + 1, rotated_at = $6
        where channel_id = $1 and id = $2 returning ${COLUMNS}`,
      [channelId, id, JSON.stringify(retired), fresh.hash, fresh.last4, now],
    );
    const client = toClient(result.rows[0] as ApiClientRow, now);
    await insertAuditLog(db, origin, {
      tenantId: null,
      resource: "api_client",
      resourceId: id,
      action: "rotate",
      before: auditView(current),
      after: { ...auditView(client), immediate, retired_generations: retired.map((entry) => ({ generation: entry.generation, valid_until: entry.valid_until })) },
    });
    return { client, secret: fresh.secret };
  });
}

export async function revokeApiClient(ctx: AppContext, principal: PlatformPrincipal, channelId: string, id: string, ip: string): Promise<ApiClient> {
  const now = ctx.now();
  const origin = consoleOrigin(platformActor(principal.user), ip, now);
  return withPlatformTx(ctx.pool, async (db) => {
    const current = toClient(await loadClientRow(db, channelId, id, true), now);
    if (current.status === "revoked") throw new AppError(409, "API_CLIENT_REVOKED", "这个 API 客户端已经吊销了");
    const result = await db.query<ApiClientRow>(
      `update channel_api_clients set status = 'revoked', revoked_at = $3, revoked_by = $4, retired_secrets = '[]'::jsonb
        where channel_id = $1 and id = $2 returning ${COLUMNS}`,
      [channelId, id, now, principal.user.id],
    );
    const client = toClient(result.rows[0] as ApiClientRow, now);
    await insertAuditLog(db, origin, { tenantId: null, resource: "api_client", resourceId: id, action: "revoke", before: auditView(current), after: auditView(client) });
    return client;
  });
}
