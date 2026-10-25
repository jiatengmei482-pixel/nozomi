/**
 * 一个后台的登录状态：包住该后台所有需要登录的页面。
 *
 * - 没有令牌、令牌已过期：去登录页（过期时带「登录已过期」的原因），登录后回到原来的页面。
 * - 有令牌：从 `auth/me` 取当前账号。任何接口返回 401（会话被退出、账号被停用、令牌过期）都走同一条路回登录页。
 * - 账号正在用临时密码（`must_change_password`，ADR 0013）：本后台的任何页面都带回修改密码页，改完才放行。
 *   以每次 `auth/me` 的结果为准；任何接口返回 403 `PASSWORD_CHANGE_REQUIRED` 也走同一条路。
 * - 运营后台的会话还没完成两步验证（ADR 0030）：本后台的任何页面都先显示两步验证（绑定或输入动态码），完成后回到原来的页面。
 *   以每次 `auth/me` 的结果为准；任何接口返回 403 `MFA_REQUIRED` 也走同一条路。两步验证在前，必须先改密码在后。
 * - 账号资料只放在内存里，不写进浏览器存储。
 */
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { fetchMe, logout } from "../api/client.ts";
import type { SecondFactorStatus, Tenant } from "../api/types.ts";
import { isPasswordChangeRequired, isUnauthenticated, secondFactorRequired } from "../lib/failure.ts";
import { SecondFactorPage } from "../pages/SecondFactorPage.tsx";
import { PORTALS, type Portal, type PortalConfig } from "../lib/portal.ts";
import { clearAllAreaDrafts } from "../lib/area-draft.ts";
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

/** 进入后台页面时可以带的提示。只是提示：真正的状态以 `auth/me` 为准。只能收紧，不能放开。 */
export interface ShellLocationState {
  /** 刚用临时密码登录：`auth/me` 回来之前就按「必须先改密码」显示 */
  passwordChangeRequired?: boolean;
  /** 运营后台刚输完密码：`auth/me` 回来之前就显示两步验证 */
  secondFactor?: "enrollment_required" | "verify_required";
}

export function readShellLocationState(state: unknown): ShellLocationState {
  if (typeof state !== "object" || state === null) return {};
  const record = state as Record<string, unknown>;
  const secondFactor = record["secondFactor"];
  return {
    ...(record["passwordChangeRequired"] === true ? { passwordChangeRequired: true } : {}),
    ...(secondFactor === "enrollment_required" || secondFactor === "verify_required" ? { secondFactor } : {}),
  };
}

export interface CurrentAccount {
  /** 账号的编号（区分各人自己的草稿用） */
  id: string;
  name: string;
  email: string;
  role: string;
  /** 角色的名字（运营后台的自建角色前端不认识，用后端给的名字；供应商后台为 null） */
  roleName: string | null;
  /** `auth/me` 给的操作清单（运营后台的自建角色按它判断权限） */
  permissions: readonly string[];
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
  /** 账号正在用临时密码：只能改密码和退出，导航不显示，别的页面都带回修改密码页 */
  mustChangePassword: boolean;
  /**
   * 能不能显示导航：只有后端明确说过「不用改密码」才显示。
   * 还不知道（刚刷新、`auth/me` 没回来或给的值不对）时不显示，免得先闪出导航再收起。
   */
  navigationAllowed: boolean;
  /** 修改密码成功后调用：解除上面的限制（后端已清标记，当前令牌继续可用） */
  passwordChanged(): void;
  /** 运营后台这个会话的两步验证状态（ADR 0030）；还不知道为 null，供应商后台总是 null */
  secondFactor: SecondFactorStatus | null;
  /** 两步验证完成后调用：重新取账号，回到原来的页面 */
  secondFactorDone(mustChangePassword: boolean): void;
  /**
   * 需要登录的接口失败时先交给它：401 回登录页，403 `PASSWORD_CHANGE_REQUIRED` 带到修改密码页。
   * 返回 true 表示已经处理，调用方不用再显示错误。
   */
  handleAuthFailure(err: unknown): boolean;
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
  // null = 还不知道（auth/me 没回来）；刚用临时密码登录时登录页会带来提示，先按 true 显示
  const [mustChange, setMustChangeState] = useState<boolean | null>(() =>
    readShellLocationState(location.state).passwordChangeRequired === true ? true : sessionStore.getMustChangePassword(portal),
  );
  const setMustChange = useCallback(
    (value: boolean): void => {
      sessionStore.setMustChangePassword(portal, value);
      setMustChangeState(value);
    },
    [portal],
  );
  const [secondFactor, setSecondFactor] = useState<SecondFactorStatus | null>(() => (portal === "platform" ? (readShellLocationState(location.state).secondFactor ?? null) : null));
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
    // 主动退出：这个标签页里没保存的区域草稿一并清掉（登录过期时不清，见 lib/area-draft.ts）
    clearAllAreaDrafts();
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
        const roleName = "role_name" in me.user && typeof me.user.role_name === "string" ? me.user.role_name : null;
        const permissions = Array.isArray(me.permissions) ? me.permissions : [];
        setAccount({ status: "ready", account: { id: me.user.id, name: me.user.name, email: me.user.email, role: me.user.role, roleName, permissions, tenant } });
        // 只认布尔值；给的不是布尔值时保持原样（未知就继续不显示导航）
        if (typeof me.must_change_password === "boolean") setMustChange(me.must_change_password);
        // 运营后台：两步验证的状态；后端没给（只有旧版本会这样）按已通过处理——真正的拦截在后端
        if (portal === "platform") {
          const status = "second_factor" in me ? me.second_factor?.status : undefined;
          setSecondFactor(status === "enrollment_required" || status === "verify_required" ? status : "verified");
        }
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
  }, [portal, token, attempt, setMustChange]);

  const passwordChanged = useCallback((): void => setMustChange(false), [setMustChange]);
  const secondFactorDone = useCallback(
    (mustChangePassword: boolean): void => {
      setSecondFactor("verified");
      setMustChange(mustChangePassword);
      setAttempt((n) => n + 1);
    },
    [setMustChange],
  );

  const handleAuthFailure = useCallback(
    (err: unknown): boolean => {
      if (isUnauthenticated(err)) {
        expire();
        return true;
      }
      const pending = secondFactorRequired(err);
      if (pending !== null) {
        setSecondFactor(pending);
        return true;
      }
      if (isPasswordChangeRequired(err)) {
        setMustChange(true);
        return true;
      }
      return false;
    },
    [expire, setMustChange],
  );

  const lastShellPath = useRef<string | null>(null);
  const mustChangePassword = mustChange === true;
  const secondFactorPending = secondFactor === "enrollment_required" || secondFactor === "verify_required";
  const value = useMemo<PortalSessionValue>(
    () => ({
      portal: config,
      token,
      account,
      reloadAccount: () => setAttempt((n) => n + 1),
      signOut,
      expire,
      mustChangePassword,
      navigationAllowed: mustChange === false && !secondFactorPending,
      passwordChanged,
      secondFactor,
      secondFactorDone,
      handleAuthFailure,
      lastShellPath,
    }),
    [config, token, account, signOut, expire, mustChange, mustChangePassword, passwordChanged, secondFactor, secondFactorPending, secondFactorDone, handleAuthFailure],
  );
  // 两步验证没完成：不管地址是什么，先显示两步验证（完成后就是原来的页面）
  // 必须先改密码时，本后台的其他页面一律带回修改密码页（地址栏直接输入、后退、刷新、新标签页都一样）
  const redirectToChangePassword = mustChangePassword && location.pathname !== config.paths.changePassword;
  return (
    <PortalSessionContext.Provider value={value}>
      {secondFactorPending ? <SecondFactorPage status={secondFactor} /> : redirectToChangePassword ? <Navigate to={config.paths.changePassword} replace /> : children}
    </PortalSessionContext.Provider>
  );
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
