/**
 * 一次性密码重置令牌（ADR 0008「密码找回」）：管理员发给已激活的账号，本人凭它设置新密码。
 * 机制与邀请令牌相同：原文只在发出时返回一次，数据库只存 SHA-256，有有效期，用过即作废。
 *
 * 租户用户的重置令牌里带着租户编号（不是秘密），这样兑换时直接进入那个租户的事务去查，不需要跨租户查询。
 */
import { createHash, randomBytes } from "node:crypto";

/** 重置令牌的有效期：24 小时。比邀请短，因为它能改掉一个正在使用的账号的密码。 */
export const RESET_TTL_MS = 24 * 60 * 60 * 1000;

const PREFIX = "nzr_";
const TENANT_TOKEN = /^nzr_([0-9a-f]{32})\.[A-Za-z0-9_-]{43}$/;

export interface NewResetToken {
  /** 令牌原文：只能出现在发出它的那一次响应里 */
  token: string;
  tokenHash: string;
  expiresAt: Date;
}

export function hashResetToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function build(token: string, now: Date): NewResetToken {
  return { token, tokenHash: hashResetToken(token), expiresAt: new Date(now.getTime() + RESET_TTL_MS) };
}

export function newPlatformResetToken(now: Date): NewResetToken {
  return build(`${PREFIX}${randomBytes(32).toString("base64url")}`, now);
}

export function newTenantResetToken(tenantId: string, now: Date): NewResetToken {
  return build(`${PREFIX}${tenantId.replaceAll("-", "").toLowerCase()}.${randomBytes(32).toString("base64url")}`, now);
}

/** 从租户重置令牌里取出租户编号；格式不对（包括平台的重置令牌、邀请令牌）返回 null。 */
export function tenantIdOfResetToken(token: string): string | null {
  const hex = TENANT_TOKEN.exec(token)?.[1];
  if (hex === undefined) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
