/**
 * 访问令牌（ADR 0008）：HS256 签名的 JWT，密钥来自配置里的登录签名密钥。
 *
 * - 令牌分两类受众：平台员工（platform）和租户用户（tenant）。两类令牌用各自派生出的密钥签名，
 *   所以平台令牌拿到租户接口上连验签都过不了，反过来也一样；验签之后还会再核对一次受众。
 * - 令牌只是「会话的凭证」：里面带会话编号，每个请求都会回数据库核对会话、账号和租户的状态，
 *   所以停用账号、退出登录、重置密码之后，旧令牌立即失效。
 * - 令牌里的角色只供前端显示；接口层判断权限用的是数据库里的当前角色。
 */
import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

export type TokenAudience = "platform" | "tenant";
/** 签名密钥按受众派生；`sales` 是渠道调用 `/sales/v1` 的令牌（M2-04，ADR 0023），内容和会话令牌不同，见 `SalesTokenClaims` */
type SigningAudience = TokenAudience | "sales";

export interface AccessTokenClaims {
  /** 受众：平台令牌还是租户令牌 */
  aud: TokenAudience;
  /** 用户编号 */
  sub: string;
  /** 会话编号 */
  sid: string;
  /** 租户编号；平台令牌为 null */
  tid: string | null;
  role: string;
  /** 签发时间和过期时间（Unix 秒） */
  iat: number;
  exp: number;
}

const HEADER = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
const MAX_TOKEN_LENGTH = 2_048;

function signingKey(secret: string, audience: SigningAudience): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, Buffer.alloc(0), `nozomi/access-token/${audience}/v1`, 32));
}

function signature(secret: string, audience: SigningAudience, signingInput: string): Buffer {
  return createHmac("sha256", signingKey(secret, audience)).update(signingInput).digest();
}

function sign(secret: string, audience: SigningAudience, claims: object): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signingInput = `${HEADER}.${payload}`;
  return `${signingInput}.${signature(secret, audience, signingInput).toString("base64url")}`;
}

export function signAccessToken(secret: string, claims: AccessTokenClaims): string {
  return sign(secret, claims.aud, claims);
}

function isClaims(value: unknown): value is AccessTokenClaims {
  if (typeof value !== "object" || value === null) return false;
  const claims = value as Record<string, unknown>;
  return (
    (claims["aud"] === "platform" || claims["aud"] === "tenant") &&
    typeof claims["sub"] === "string" &&
    typeof claims["sid"] === "string" &&
    (claims["tid"] === null || typeof claims["tid"] === "string") &&
    typeof claims["role"] === "string" &&
    Number.isInteger(claims["iat"]) &&
    Number.isInteger(claims["exp"])
  );
}

/**
 * 验证令牌：签名、受众、有效期、字段齐全。任何一项不对都返回 null（不区分原因，不抛错）。
 * 只接受本模块签发的固定头部（HS256），不读令牌头里声明的算法。
 */
export function verifyAccessToken(
  secret: string,
  audience: TokenAudience,
  token: string,
  now: Date,
): AccessTokenClaims | null {
  const claims = verifySigned(secret, audience, token);
  if (!isClaims(claims) || claims.aud !== audience) return null;
  if (audience === "tenant" ? claims.tid === null : claims.tid !== null) return null;
  if (claims.exp * 1000 <= now.getTime()) return null;
  return claims;
}

/** 验签并取出内容；签名不对、写法不规范、内容不是 JSON 都返回 null。 */
function verifySigned(secret: string, audience: SigningAudience, token: string): unknown {
  if (token.length > MAX_TOKEN_LENGTH) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signatureText] = parts as [string, string, string];
  if (header !== HEADER) return null;
  const expected = signature(secret, audience, `${header}.${payload}`);
  const actual = Buffer.from(signatureText, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  // 只接受签发时的那一种写法：宽松的解码会让「加补位、换字母表、改末位无效比特」的变体也通过，
  // 那样同一个会话就有多个合法的令牌串了
  if (actual.toString("base64url") !== signatureText) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

/**
 * 渠道的访问令牌（OAuth 2.0 Client Credentials 换来的 Bearer Token，有效 2 小时；ADR 0023）。
 * 只是凭证：每个请求都回数据库核对客户端没被吊销、渠道没被暂停、令牌的密钥代次还有效。
 */
export interface SalesTokenClaims {
  aud: "sales";
  /** API 客户端的内部编号 */
  sub: string;
  /** 渠道编号 */
  cid: string;
  /** 换令牌时用的是第几代密钥 */
  gen: number;
  iat: number;
  exp: number;
}

function isSalesClaims(value: unknown): value is SalesTokenClaims {
  if (typeof value !== "object" || value === null) return false;
  const claims = value as Record<string, unknown>;
  return claims["aud"] === "sales" && typeof claims["sub"] === "string" && typeof claims["cid"] === "string" && Number.isInteger(claims["gen"]) && Number.isInteger(claims["iat"]) && Number.isInteger(claims["exp"]);
}

export function signSalesToken(secret: string, claims: SalesTokenClaims): string {
  return sign(secret, "sales", claims);
}

export function verifySalesToken(secret: string, token: string, now: Date): SalesTokenClaims | null {
  const claims = verifySigned(secret, "sales", token);
  if (!isSalesClaims(claims)) return null;
  if (claims.exp * 1000 <= now.getTime()) return null;
  return claims;
}

/** 从 `Authorization: Bearer <令牌>` 取出令牌；格式不对返回 null。 */
export function bearerToken(authorization: string | undefined): string | null {
  if (authorization === undefined) return null;
  const match = /^Bearer ([A-Za-z0-9._~+/=-]+)$/.exec(authorization);
  return match ? (match[1] as string) : null;
}
