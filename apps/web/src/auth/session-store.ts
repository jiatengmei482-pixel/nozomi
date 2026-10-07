/**
 * 访问令牌的存放（ADR 0011）：内存 + sessionStorage。
 *
 * - 关掉标签页即失效；不进 localStorage，不跨标签页共享。
 * - 两个后台各存各的，互不覆盖：同一个浏览器标签页可以先后登录两个后台。
 * - 只存令牌和过期时间。账号资料每次从 `auth/me` 取，不落在浏览器里。
 */
import type { Portal } from "../lib/portal.ts";

export interface StoredSession {
  accessToken: string;
  /** ISO 8601；后端给的令牌过期时间 */
  expiresAt: string;
}

type SessionStorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const STORAGE_KEYS: Readonly<Record<Portal, string>> = {
  tenant: "nozomi.session.tenant",
  platform: "nozomi.session.platform",
};

export interface SessionStore {
  get(portal: Portal): StoredSession | null;
  set(portal: Portal, session: StoredSession): void;
  clear(portal: Portal): void;
}

function parseStored(raw: string | null): StoredSession | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const { accessToken, expiresAt } = value as Record<string, unknown>;
    if (typeof accessToken !== "string" || accessToken === "") return null;
    if (typeof expiresAt !== "string" || Number.isNaN(Date.parse(expiresAt))) return null;
    return { accessToken, expiresAt };
  } catch {
    return null;
  }
}

/** `storage` 为 null（浏览器禁用了存储）时只放在内存里：刷新页面后需要重新登录。 */
export function createSessionStore(storage: SessionStorageLike | null): SessionStore {
  const memory = new Map<Portal, StoredSession>();

  const read = (portal: Portal): StoredSession | null => {
    try {
      return parseStored(storage?.getItem(STORAGE_KEYS[portal]) ?? null);
    } catch {
      return null;
    }
  };

  return {
    get(portal) {
      const cached = memory.get(portal);
      if (cached) return cached;
      const stored = read(portal);
      if (stored) memory.set(portal, stored);
      return stored;
    },
    set(portal, session) {
      memory.set(portal, session);
      try {
        storage?.setItem(STORAGE_KEYS[portal], JSON.stringify(session));
      } catch {
        // 存储写不进去（已满或被禁用）时令牌仍在内存里，本次打开期间可用
      }
    },
    clear(portal) {
      memory.delete(portal);
      try {
        storage?.removeItem(STORAGE_KEYS[portal]);
      } catch {
        // 存储不可用时没有东西可删
      }
    },
  };
}

export function isExpired(session: StoredSession, now: Date): boolean {
  return Date.parse(session.expiresAt) <= now.getTime();
}

function browserSessionStorage(): SessionStorageLike | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export const sessionStore: SessionStore = createSessionStore(browserSessionStorage());
