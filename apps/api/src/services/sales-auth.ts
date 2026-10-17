/**
 * `/sales/v1` 的渠道鉴权（M2-04，ADR 0023；需求「API 通用约定」：服务对服务用 OAuth 2.0 Client Credentials 换 Bearer Token，有效 2 小时）。
 *
 * - `POST /sales/v1/oauth/token`：client_id + client_secret → 访问令牌。密钥不对、客户端不存在、已吊销，返回同一个 401 `INVALID_CLIENT`；
 *   渠道被暂停返回 403 `CHANNEL_PAUSED`（只在密钥正确时才说）。按来源地址限流。
 * - 每个 `/sales/v1` 请求：验令牌签名，再回数据库核对客户端还在用、渠道没被暂停、令牌的密钥代次还有效（轮换的宽限期过了，旧令牌失效）。
 * 渠道的编号**只来自令牌**：请求里不接受 channel_id（需求「销售端 Token 内含 channel_id，只能看到平台授权给它的租户」）。
 * 渠道的数据是平台表，所以走平台角色（ADR 0010：平台员工登录同样走平台角色）。
 */
import { createHash } from "node:crypto";
import type { AppContext } from "../context.ts";
import { withPlatformTx } from "../db/context.ts";
import { signSalesToken, verifySalesToken } from "../auth/token.ts";
import { AppError } from "../errors.ts";
import { hashClientSecret, sameSecretHash } from "./channel-clients.ts";
import { type SalesRateScope, rateLimited, takeRateSlot } from "./rate-limit.ts";

/** 访问令牌有效期：2 小时 */
export const SALES_TOKEN_TTL_SECONDS = 2 * 60 * 60;

export interface SalesPrincipal {
  /** API 客户端的内部编号 */
  apiClientId: string;
  clientId: string;
  channelId: string;
}

function invalidClient(): AppError {
  return new AppError(401, "INVALID_CLIENT", "client_id 或 client_secret 不正确，或这个客户端已经吊销");
}

function invalidToken(): AppError {
  return new AppError(401, "UNAUTHENTICATED", "访问令牌无效或已过期，请用 client_id 和 client_secret 重新换取");
}

function channelPaused(): AppError {
  return new AppError(403, "CHANNEL_PAUSED", "这个渠道已被平台暂停，现在不能调用销售端接口");
}

interface ClientRow {
  id: string;
  client_id: string;
  channel_id: string;
  secret_hash: string;
  secret_generation: number;
  previous_secret_hash: string | null;
  previous_valid_until: Date | null;
  status: "active" | "revoked";
  channel_status: "testing" | "active" | "paused";
}

const CLIENT_SELECT = `select k.id, k.client_id, k.channel_id, k.secret_hash, k.secret_generation, k.previous_secret_hash, k.previous_valid_until, k.status, c.status as channel_status
  from channel_api_clients k join channels c on c.id = k.channel_id`;

/** 来源地址不进限流表原文（和登录限速一样只存哈希）。 */
const ipBucket = (ip: string): string => createHash("sha256").update(`sales-token:${ip}`, "utf8").digest("hex");

export interface IssuedSalesToken {
  accessToken: string;
  expiresIn: number;
  channelId: string;
}

export async function issueSalesToken(ctx: AppContext, input: { clientId: string; clientSecret: string }, ip: string): Promise<IssuedSalesToken> {
  const now = ctx.now();
  // 限流计数单独一个事务先提交：后面密钥不对抛错回滚时，这一次照样算数
  const decision = await withPlatformTx(ctx.pool, (db) => takeRateSlot(db, ipBucket(ip), "token", now));
  if (!decision.allowed) throw rateLimited(decision.retryAfterSeconds);
  return withPlatformTx(ctx.pool, async (db) => {
    const result = await db.query<ClientRow>(`${CLIENT_SELECT} where k.client_id = $1`, [input.clientId]);
    const row = result.rows[0];
    const hash = hashClientSecret(input.clientSecret);
    if (!row || row.status !== "active") throw invalidClient();
    const current = sameSecretHash(hash, row.secret_hash);
    const previous = !current && row.previous_secret_hash !== null && row.previous_valid_until !== null && row.previous_valid_until.getTime() > now.getTime() && sameSecretHash(hash, row.previous_secret_hash);
    if (!current && !previous) throw invalidClient();
    if (row.channel_status === "paused") throw channelPaused();
    await db.query("update channel_api_clients set last_used_at = $2 where id = $1", [row.id, now]);
    const iat = Math.floor(now.getTime() / 1000);
    const accessToken = signSalesToken(ctx.config.authJwtSecret, { aud: "sales", sub: row.id, cid: row.channel_id, gen: current ? row.secret_generation : row.secret_generation - 1, iat, exp: iat + SALES_TOKEN_TTL_SECONDS });
    return { accessToken, expiresIn: SALES_TOKEN_TTL_SECONDS, channelId: row.channel_id };
  });
}

/**
 * 核对访问令牌并占用一次限流额度（按渠道计）。令牌无效、客户端已吊销、密钥代次已失效：401；渠道暂停：403；超限：429。
 */
export async function authenticateSales(ctx: AppContext, token: string | null, scope: Exclude<SalesRateScope, "token">): Promise<SalesPrincipal> {
  const now = ctx.now();
  const claims = token === null ? null : verifySalesToken(ctx.config.authJwtSecret, token, now);
  if (!claims) throw invalidToken();
  return withPlatformTx(ctx.pool, async (db) => {
    const result = await db.query<ClientRow>(`${CLIENT_SELECT} where k.id = $1`, [claims.sub]);
    const row = result.rows[0];
    if (!row || row.status !== "active" || row.channel_id !== claims.cid) throw invalidToken();
    const generationValid = claims.gen === row.secret_generation || (claims.gen === row.secret_generation - 1 && row.previous_valid_until !== null && row.previous_valid_until.getTime() > now.getTime());
    if (!generationValid) throw invalidToken();
    if (row.channel_status === "paused") throw channelPaused();
    const decision = await takeRateSlot(db, row.channel_id, scope, now);
    if (!decision.allowed) throw rateLimited(decision.retryAfterSeconds);
    return { apiClientId: row.id, clientId: row.client_id, channelId: row.channel_id };
  });
}
