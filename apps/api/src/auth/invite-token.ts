/**
 * 一次性邀请令牌：新账号凭它设置密码并激活。
 * 原文只在创建时返回一次；数据库只存它的 SHA-256，所以拿到数据库也还原不出令牌。
 */
import { createHash, randomBytes } from "node:crypto";

/** 邀请的有效期：7 天。过期后由邀请人重新发起邀请。 */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const PREFIX = "nzi_";

export interface NewInvite {
  /** 令牌原文：只能出现在创建接口的那一次响应里 */
  token: string;
  tokenHash: string;
  expiresAt: Date;
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function newInvite(now: Date): NewInvite {
  const token = `${PREFIX}${randomBytes(32).toString("base64url")}`;
  return { token, tokenHash: hashInviteToken(token), expiresAt: new Date(now.getTime() + INVITE_TTL_MS) };
}
