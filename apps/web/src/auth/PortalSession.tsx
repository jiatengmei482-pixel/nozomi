/**
 * 一个后台的登录状态：包住该后台所有需要登录的页面。
 *
 * - 没有令牌、令牌已过期：去登录页（过期时带「登录已过期」的原因），登录后回到原来的页面。
 * - 有令牌：从 `auth/me` 取当前账号。任何接口返回 401（会话被退出、账号被停用、令牌过期）都走同一条路回登录页。
 * - 账号资料只放在内存里，不写进浏览器存储。
 */
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { fetchMe, logout } from "../api/client.ts";
import type { Tenant } from "../api/types.ts";
import { isUnauthenticated } from "../lib/failure.ts";
import { PORTALS, type Portal, type PortalConfig } from "../lib/portal.ts";
import { isExpired, sessionStore } from "./session-store.ts";

/** 带给登录页的「为什么来到这里」。 */
export type LoginReason = "expired" | "logged-out" | "password-set" | "password-reset";

export interface LoginLocationState {
  reason?: LoginReason;
  /** 预填的邮箱 */
  email?: string;
  /** 登录后回到哪里 */
  from?: string;
}

export interface CurrentAccount {
  name: string;
  email: string;
  role: string;
  /** 只有供应商后台有 */
  tenant: Tenant | null;
}

export type AccountState = { status: "loading" } | { status: "error" } | { status: "ready"; account: CurrentAccount };

export interface PortalSessionValue {
  portal: PortalConfig;
  token: string;
  account: AccountState;
  reloadAccount(): void;
  /** 退出登录：通知后端作废会话，清掉本地令牌，回登录页 */
  signOut(): Promise<void>;
  /** 某个接口返回了 401：清掉本地令牌，带着「登录已过期」回登录页 */
  expire(): void;
  /**
   * 后台框架上一次显示的是哪个地址（还没显示过为 null）。框架随页面一起重新挂载，
   * 「是不是换页」只能记在比它活得久的这里。
   */
  lastShellPath: { current: string | null };
}

const PortalSessionContext = createContext<PortalSessionValue | null>(null);

export function usePortalSession(): PortalSessionValue {
  const value = useContext(PortalSessionContext);
  if (!value) throw new Error("usePortalSession 只能用在 <PortalSession> 里面");
  return value;
}

function RedirectToLogin({ portal, expired }: { portal: Portal; expired: boolean }) {
  const location = useLocation();
  useEffect(() => {
    if (expired) sessionStore.clear(portal);
  }, [expired, portal]);
  const state: LoginLocationState = {
    from: `${location.pathname}${location.search}`,
    ...(expired ? { reason: "expired" } : {}),
  };
  return <Navigate to={PORTALS[portal].paths.login} replace state={state} />;
}

function ActiveSession({ portal, token, children }: { portal: Portal; token: string; children: ReactNode }) {
  const config = PORTALS[portal];
  const navigate = useNavigate();
  const location = useLocation();
  const [account, setAccount] = useState<AccountState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const here = `${location.pathname}${location.search}`;

  const expire = useCallback((): void => {
    sessionStore.clear(portal);
    const state: LoginLocationState = { reason: "expired", from: here };
    void navigate(config.paths.login, { replace: true, state });
  }, [portal, config, navigate, here]);

  const signOut = useCallback(async (): Promise<void> => {
    try {
      await logout(portal, token);
    } catch {
      // 后端没收到也照样清掉本地令牌：这个浏览器不再持有它；服务端的会话最迟 8 小时后过期
    }
    sessionStore.clear(portal);
    const state: LoginLocationState = { reason: "logged-out" };
    void navigate(config.paths.login, { replace: true, state });
  }, [portal, token, config, navigate]);

  // navigate 和当前地址每次跳转都会变；取账号的请求不应该因此重发，所以经由 ref 拿到最新的 expire
  const expireRef = useRef(expire);
  useEffect(() => {
    expireRef.current = expire;
  }, [expire]);

  useEffect(() => {
    let cancelled = false;
    setAccount({ status: "loading" });
    fetchMe(portal, token).then(
      (me) => {
        if (cancelled) return;
        const tenant = "tenant" in me ? me.tenant : null;
        setAccount({ status: "ready", account: { name: me.user.name, email: me.user.email, role: me.user.role, tenant } });
      },
      (err: unknown) => {
        if (cancelled) return;
        if (isUnauthenticated(err)) expireRef.current();
        else setAccount({ status: "error" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [portal, token, attempt]);

  const lastShellPath = useRef<string | null>(null);
  const value = useMemo<PortalSessionValue>(
    () => ({ portal: config, token, account, reloadAccount: () => setAttempt((n) => n + 1), signOut, expire, lastShellPath }),
    [config, token, account, signOut, expire],
  );
  return <PortalSessionContext.Provider value={value}>{children}</PortalSessionContext.Provider>;
}

export function PortalSession({ portal, children }: { portal: Portal; children: ReactNode }) {
  const stored = sessionStore.get(portal);
  if (!stored) return <RedirectToLogin portal={portal} expired={false} />;
  if (isExpired(stored, new Date())) return <RedirectToLogin portal={portal} expired />;
  return (
    <ActiveSession portal={portal} token={stored.accessToken}>
      {children}
    </ActiveSession>
  );
}
