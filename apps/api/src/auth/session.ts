/**
 * 登录会话的签发（ADR 0008）：生成会话编号和对应的访问令牌。
 * 会话 8 小时过期（需求文档「平台账号、安全与审计」），平台和租户相同；没有刷新令牌，过期后重新登录。
 */
import { randomUUID } from "node:crypto";
import { type TokenAudience, signAccessToken } from "./token.ts";

export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export interface IssuedSession {
  sessionId: string;
  accessToken: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface SessionSubject {
  audience: TokenAudience;
  userId: string;
  tenantId: string | null;
  role: string;
}

export function issueSession(secret: string, subject: SessionSubject, now: Date): IssuedSession {
  const sessionId = randomUUID();
  const issuedAtSeconds = Math.floor(now.getTime() / 1000);
  const expiresAtSeconds = issuedAtSeconds + SESSION_TTL_MS / 1000;
  const accessToken = signAccessToken(secret, {
    aud: subject.audience,
    sub: subject.userId,
    sid: sessionId,
    tid: subject.tenantId,
    role: subject.role,
    iat: issuedAtSeconds,
    exp: expiresAtSeconds,
  });
  return { sessionId, accessToken, createdAt: now, expiresAt: new Date(expiresAtSeconds * 1000) };
}
