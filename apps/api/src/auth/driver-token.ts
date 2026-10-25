/**
 * 司机链接的令牌（M3-02，ADR 0027）：司机不需要账号，派车后供应商把一个链接发给司机，司机凭它在手机上看这一单、回传履约。
 *
 * - 格式 `nzd_<租户编号（32 位十六进制）>.<32 字节随机数的 base64url>`。租户编号不是秘密，带着它是为了直接进入那个租户的事务去查
 *   （和租户的密码重置令牌一样，ADR 0008），整个过程都在行级安全之内，不需要跨租户查询；
 * - 库里只存整个令牌的 SHA-256，原文只出现在派车 / 重新生成的那一次应答里；
 * - 有效期到用车结束后 24 小时；改派、重新生成、手动吊销都让旧链接立即失效。
 * - 链接里令牌放在 `#` 后面（`/driver#<令牌>`）：浏览器不会把 `#` 后面的内容发给服务器，不进访问日志，也不随来源页泄露。
 */
import { createHash, randomBytes } from "node:crypto";

const TOKEN = /^nzd_([0-9a-f]{32})\.[A-Za-z0-9_-]{43}$/;

export function hashDriverToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function newDriverToken(tenantId: string): { token: string; tokenHash: string } {
  const token = `nzd_${tenantId.replaceAll("-", "").toLowerCase()}.${randomBytes(32).toString("base64url")}`;
  return { token, tokenHash: hashDriverToken(token) };
}

/** 从令牌里取出租户编号；格式不对返回 null。 */
export function tenantIdOfDriverToken(token: string): string | null {
  const hex = TOKEN.exec(token)?.[1];
  if (hex === undefined) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
