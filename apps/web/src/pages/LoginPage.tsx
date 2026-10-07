/**
 * 登录页（docs/design/pages/login.md 第 2 节）。供应商后台和运营后台是同一个组件、两个入口。
 */
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router";
import { ApiError, NetworkError, fetchMe, login } from "../api/client.ts";
import type { LoginLocationState, LoginReason, ShellLocationState } from "../auth/PortalSession.tsx";
import { isExpired, sessionStore } from "../auth/session-store.ts";
import { AlertSlot, type Notice } from "../components/Alert.tsx";
import { AuthLayout } from "../components/AuthLayout.tsx";
import { Button } from "../components/Button.tsx";
import { Skeleton } from "../components/States.tsx";
import { PasswordField, TextField } from "../components/TextField.tsx";
import { NETWORK_FAILURE_TEXT, isThrottled, isUnauthenticated, throttledText } from "../lib/failure.ts";
import { PORTALS, type Portal, safeReturnPath } from "../lib/portal.ts";
import { useDocumentTitle } from "../lib/use-document-title.ts";
import { validateLoginEmail, validateLoginPassword } from "../lib/validation.ts";

/** 邮箱不存在、密码错误、账号未激活、账号属于另一个后台……一律是这一句，不给任何区分的线索。 */
export const LOGIN_REJECTED_TEXT = "邮箱或密码不正确。";

/**
 * 后端只在「密码正确但账号已停用」时返回这个错误码（ADR 0008），所以它不会泄露邮箱是否存在；
 * 这时显示后端给的说明，让本人知道该去找管理员。后端没带说明时用这句兜底。
 */
const ACCOUNT_DISABLED_CODE = "ACCOUNT_DISABLED";
const ACCOUNT_DISABLED_FALLBACK_TEXT = "账号已停用，请联系管理员。";

const REASON_NOTICES: Readonly<Record<LoginReason, Notice>> = {
  expired: { kind: "info", text: "登录已过期，请重新登录。" },
  "logged-out": { kind: "success", text: "已退出登录。" },
  "password-set": { kind: "success", text: "密码已设置，请登录。" },
  "password-reset": { kind: "success", text: "密码已重设，请用新密码登录。" },
};

/** 自动聚焦只在桌面宽度做（tokens.css 的 --breakpoint-md）；手机上一打开就弹键盘很烦。 */
const AUTOFOCUS_QUERY = "(min-width: 768px)";

function readLocationState(state: unknown): LoginLocationState {
  if (typeof state !== "object" || state === null) return {};
  const { reason, email, from } = state as Record<string, unknown>;
  return {
    ...(typeof reason === "string" && reason in REASON_NOTICES ? { reason: reason as LoginReason } : {}),
    ...(typeof email === "string" ? { email } : {}),
    ...(typeof from === "string" ? { from } : {}),
  };
}

/** 打开登录页时本地已经有令牌：问一下后端它还有没有效。 */
type ExistingSession = "checking" | "valid" | "none";

function useExistingSession(portal: Portal): ExistingSession {
  const [state, setState] = useState<ExistingSession>(() => {
    const stored = sessionStore.get(portal);
    return stored && !isExpired(stored, new Date()) ? "checking" : "none";
  });
  useEffect(() => {
    const stored = sessionStore.get(portal);
    if (!stored) return;
    if (isExpired(stored, new Date())) {
      sessionStore.clear(portal);
      return;
    }
    let cancelled = false;
    fetchMe(portal, stored.accessToken).then(
      () => {
        if (!cancelled) setState("valid");
      },
      (err: unknown) => {
        if (isUnauthenticated(err)) sessionStore.clear(portal);
        if (!cancelled) setState("none");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [portal]);
  return state;
}

export function LoginPage({ portal }: { portal: Portal }) {
  const config = PORTALS[portal];
  useDocumentTitle(`登录 · NOZOMI ${config.name}`);
  const navigate = useNavigate();
  const arrival = readLocationState(useLocation().state);
  const destination = safeReturnPath(portal, arrival.from);
  const existing = useExistingSession(portal);

  const [email, setEmail] = useState(arrival.email ?? "");
  const [password, setPassword] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(arrival.reason ? REASON_NOTICES[arrival.reason] : null);

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);

  const formShown = existing === "none";
  useEffect(() => {
    if (!formShown || !window.matchMedia(AUTOFOCUS_QUERY).matches) return;
    (emailRef.current?.value ? passwordRef.current : emailRef.current)?.focus();
  }, [formShown]);

  if (existing === "valid") return <Navigate to={destination} replace />;

  const emailError = attempted ? validateLoginEmail(email) : null;
  const passwordError = attempted ? validateLoginPassword(password) : null;

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (submitting) return;
    setAttempted(true);
    if (validateLoginEmail(email) !== null) {
      emailRef.current?.focus();
      return;
    }
    if (validateLoginPassword(password) !== null) {
      passwordRef.current?.focus();
      return;
    }
    setNotice(null);
    setSubmitting(true);
    let result: Awaited<ReturnType<typeof login>>;
    try {
      result = await login(portal, { email: email.trim(), password });
    } catch (err) {
      setSubmitting(false);
      if (err instanceof NetworkError) {
        setNotice({ kind: "danger", text: NETWORK_FAILURE_TEXT });
        submitRef.current?.focus();
      } else if (isThrottled(err)) {
        rejectWith(throttledText(err.retryAfterSeconds));
      } else if (err instanceof ApiError && err.status === 403 && err.code === ACCOUNT_DISABLED_CODE) {
        rejectWith(err.message !== "" ? err.message : ACCOUNT_DISABLED_FALLBACK_TEXT);
      } else if (err instanceof ApiError && err.status < 500) {
        rejectWith(LOGIN_REJECTED_TEXT);
      } else {
        setNotice({ kind: "danger", text: "系统暂时无法登录，请稍后再试。" });
      }
      return;
    }
    // 跳转放在 try 外面：登录已经成功，跳转本身出的错不能被当成「系统无法登录」
    sessionStore.set(portal, { accessToken: result.access_token, expiresAt: result.expires_at });
    if (result.must_change_password) {
      // 临时密码：不管原来想去哪，先去修改密码页（ADR 0013）
      const state: ShellLocationState = { passwordChangeRequired: true };
      void navigate(config.paths.changePassword, { replace: true, state });
      return;
    }
    void navigate(destination, { replace: true });
  };

  /** 被后端拒绝：显示原因，保留邮箱、清空密码、焦点回到密码框。 */
  function rejectWith(text: string): void {
    setNotice({ kind: "danger", text });
    setPassword("");
    setAttempted(false);
    passwordRef.current?.focus();
  }

  return (
    <AuthLayout>
      <h1 className="auth-card__title">{config.name}</h1>
      {existing === "checking" ? (
        <Skeleton lines={["control", "control", "control"]} label="正在确认登录状态" />
      ) : (
        <form className="form" noValidate onSubmit={(event) => void onSubmit(event)}>
          <AlertSlot notice={notice} />
          <TextField
            ref={emailRef}
            label="邮箱"
            size="lg"
            type="email"
            name="email"
            autoComplete="username"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            readOnly={submitting}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            errors={emailError ? [emailError] : []}
          />
          <PasswordField
            ref={passwordRef}
            label="密码"
            size="lg"
            name="password"
            autoComplete="current-password"
            required
            readOnly={submitting}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            errors={passwordError ? [passwordError] : []}
          />
          <div className="form__actions">
            <Button ref={submitRef} type="submit" variant="primary" size="lg" block loading={submitting} loadingText="正在登录…">
              登录
            </Button>
          </div>
          <p className="auth-card__switch">
            <Link
              to={PORTALS[config.switchTo.portal].paths.login}
              className="link"
              aria-disabled={submitting || undefined}
              onClick={(event) => {
                if (submitting) event.preventDefault();
              }}
            >
              {config.switchTo.label}
            </Link>
          </p>
        </form>
      )}
    </AuthLayout>
  );
}
