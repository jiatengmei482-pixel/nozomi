/**
 * 登录页（docs/design/pages/login.md 第 2、6 节）。供应商后台和运营后台是同一个组件、两个入口。
 * 密码表单不依赖任何请求就能显示；邮件可用时多一个「改用邮箱验证码」（ADR 0050），问不到可用方式时就只有密码，不会把人挡在外面。
 */
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router";
import { ApiError, NetworkError, fetchLoginMethods, fetchMe, login, requestEmailCode, verifyEmailCode } from "../api/client.ts";
import type { LoginMethods } from "../api/types.ts";
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
import { normalizeEmailCodeInput, validateEmailCode, validateLoginEmail, validateLoginPassword } from "../lib/validation.ts";

/** 邮箱不存在、密码错误、账号未激活、账号属于另一个后台……一律是这一句，不给任何区分的线索。 */
export const LOGIN_REJECTED_TEXT = "邮箱或密码不正确。";

/**
 * 后端只在「密码正确但账号已停用」时返回这个错误码（ADR 0008），所以它不会泄露邮箱是否存在；
 * 这时显示后端给的说明，让本人知道该去找管理员。后端没带说明时用这句兜底。
 */
const ACCOUNT_DISABLED_CODE = "ACCOUNT_DISABLED";
const ACCOUNT_DISABLED_FALLBACK_TEXT = "账号已停用，请联系管理员。";
/** 运营后台的 IP 白名单（ADR 0030）：同样只在密码正确时才返回 */
const IP_NOT_ALLOWED_CODE = "IP_NOT_ALLOWED";
export const IP_NOT_ALLOWED_TEXT = "你现在所在的网络不在这个账号允许的范围内。请连上公司网络（或指定的网络）后再登录；需要调整的话，请联系超级管理员。";

/** 码错、过期、用过、次数用尽、邮箱不存在……一律是这一句（ADR 0050）。 */
export const EMAIL_CODE_REJECTED_TEXT = "验证码不正确或已失效。请重新输入，或重新发送一封。";
const EMAIL_CODE_UNAVAILABLE_CODE = "EMAIL_CODE_UNAVAILABLE";
export const EMAIL_CODE_UNAVAILABLE_TEXT = "现在不能发送邮箱验证码，请用密码登录。";
const PASSWORD_LOGIN_DISABLED_CODE = "PASSWORD_LOGIN_DISABLED";
export const PASSWORD_LOGIN_DISABLED_TEXT = "密码登录已关闭，请用邮箱验证码登录。";

/** 发码之后的提示：不说邮箱存不存在。 */
export function emailCodeSentText(expiresInSeconds: number, portalName: string): string {
  return `如果这个邮箱是${portalName}的账号，验证码已经发过去了，${Math.ceil(expiresInSeconds / 60)} 分钟内有效。没收到的话看看垃圾邮件；运营后台和供应商后台是两个入口，账号不通用。`;
}

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
      (me) => {
        if (typeof me.must_change_password === "boolean") sessionStore.setMustChangePassword(portal, me.must_change_password);
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

/** 问不到时当作只有密码（ADR 0050）：登录页不能因为这个请求失败就用不了。 */
const ONLY_PASSWORD: LoginMethods = { email_code: false, password: true };

function useLoginMethods(portal: Portal, enabled: boolean): [LoginMethods, (methods: LoginMethods) => void] {
  const [methods, setMethods] = useState<LoginMethods>(ONLY_PASSWORD);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetchLoginMethods(portal).then(
      (found) => {
        if (!cancelled && typeof found.email_code === "boolean" && typeof found.password === "boolean") setMethods(found);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [portal, enabled]);
  return [methods, setMethods];
}

/** 重新发送的倒计时：`start(秒)` 之后每秒减一，到 0 停。 */
function useCountdown(): { seconds: number; start: (seconds: number) => void } {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (seconds <= 0) return;
    const timer = setTimeout(() => setSeconds((left) => Math.max(0, left - 1)), 1000);
    return () => clearTimeout(timer);
  }, [seconds]);
  return { seconds, start: setSeconds };
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
  const [methods, setMethods] = useLoginMethods(portal, formShown);
  /** 用户自己选的方式；没选时看后端：密码关了就是验证码 */
  const [chosen, setChosen] = useState<"password" | "email-code" | null>(null);
  const mode = chosen === "password" && methods.password ? "password" : chosen === "email-code" || !methods.password ? "email-code" : "password";
  /** 验证码已经发过的邮箱；null = 还在填邮箱这一步 */
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const resend = useCountdown();
  const codeRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (codeSentTo !== null) codeRef.current?.focus();
  }, [codeSentTo]);
  // 点了「改用…」，那个按钮就没了：焦点回到邮箱框，键盘用户不会丢位置
  useEffect(() => {
    if (chosen !== null) emailRef.current?.focus();
  }, [chosen]);
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
      } else if (err instanceof ApiError && err.status === 403 && err.code === PASSWORD_LOGIN_DISABLED_CODE) {
        // 页面打开之后密码才被关掉：直接换成验证码（和邮箱无关，不泄露什么）
        setPassword("");
        setMethods({ email_code: true, password: false });
        setChosen("email-code");
        setNotice({ kind: "info", text: PASSWORD_LOGIN_DISABLED_TEXT });
      } else if (err instanceof ApiError && err.status === 403 && err.code === ACCOUNT_DISABLED_CODE) {
        rejectWith(err.message !== "" ? err.message : ACCOUNT_DISABLED_FALLBACK_TEXT);
      } else if (err instanceof ApiError && err.status === 403 && err.code === IP_NOT_ALLOWED_CODE) {
        // 只在密码正确时才会说（ADR 0030），不泄露邮箱是否存在
        rejectWith(IP_NOT_ALLOWED_TEXT);
      } else if (err instanceof ApiError && err.status < 500) {
        rejectWith(LOGIN_REJECTED_TEXT);
      } else {
        setNotice({ kind: "danger", text: "系统暂时无法登录，请稍后再试。" });
      }
      return;
    }
    enter(result);
  };

  /** 登录成功之后（密码和验证码一样）。跳转放在 try 外面：登录已经成功，跳转本身出的错不能被当成「系统无法登录」 */
  function enter(result: Awaited<ReturnType<typeof login>>): void {
    sessionStore.set(portal, { accessToken: result.access_token, expiresAt: result.expires_at });
    sessionStore.setMustChangePassword(portal, result.must_change_password);
    // 运营后台：密码或验证码对了还要做两步验证（ADR 0030、0050）。带着提示进去，后台框架先显示两步验证，完成后才是要去的页面
    const status = "second_factor" in result ? result.second_factor?.status : undefined;
    const secondFactor: ShellLocationState = status === "enrollment_required" || status === "verify_required" ? { secondFactor: status } : {};
    if (result.must_change_password) {
      // 临时密码：不管原来想去哪，先去修改密码页（ADR 0013）
      const state: ShellLocationState = { passwordChangeRequired: true, ...secondFactor };
      void navigate(config.paths.changePassword, { replace: true, state });
      return;
    }
    void navigate(destination, { replace: true, state: secondFactor });
  }

  /** 被后端拒绝：显示原因，保留邮箱、清空密码、焦点回到密码框。 */
  function rejectWith(text: string): void {
    setNotice({ kind: "danger", text });
    setPassword("");
    setAttempted(false);
    passwordRef.current?.focus();
  }

  /** 发验证码（第一次和重新发送）。不管账号存不存在应答都一样，文案也不说。 */
  const sendCode = async (): Promise<void> => {
    if (sending) return;
    setAttempted(true);
    if (validateLoginEmail(email) !== null) {
      emailRef.current?.focus();
      return;
    }
    const target = email.trim();
    setNotice(null);
    setSending(true);
    try {
      const sent = await requestEmailCode(portal, target);
      resend.start(sent.resend_after_seconds);
      setCode("");
      setAttempted(false);
      setCodeSentTo(target);
      setNotice({ kind: "info", text: emailCodeSentText(sent.expires_in_seconds, config.name) });
      // 重新发送时按钮马上进入倒计时、被禁用：焦点移到验证码框，键盘用户不丢位置（第一次发码时输入框还没出现，由上面的 effect 聚焦）
      codeRef.current?.focus();
    } catch (err) {
      if (err instanceof NetworkError) setNotice({ kind: "danger", text: NETWORK_FAILURE_TEXT });
      else if (isThrottled(err)) setNotice({ kind: "danger", text: throttledText(err.retryAfterSeconds) });
      else if (err instanceof ApiError && err.status === 503 && err.code === EMAIL_CODE_UNAVAILABLE_CODE) {
        // 邮件配置刚被清空：密码一定可用（ADR 0050 第 1 节），哪怕页面打开时密码是关着的。回到密码表单，别让人卡在这里
        setCodeSentTo(null);
        setMethods(ONLY_PASSWORD);
        setChosen("password");
        setNotice({ kind: "danger", text: EMAIL_CODE_UNAVAILABLE_TEXT });
      } else setNotice({ kind: "danger", text: "系统暂时无法发送验证码，请稍后再试。" });
    } finally {
      setSending(false);
    }
  };

  const onSubmitCode = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (submitting) return;
    if (codeSentTo === null) {
      await sendCode();
      return;
    }
    setAttempted(true);
    if (validateEmailCode(code) !== null) {
      codeRef.current?.focus();
      return;
    }
    setNotice(null);
    setSubmitting(true);
    let result: Awaited<ReturnType<typeof login>>;
    try {
      result = await verifyEmailCode(portal, codeSentTo, code.trim());
    } catch (err) {
      setSubmitting(false);
      if (err instanceof NetworkError) {
        setNotice({ kind: "danger", text: NETWORK_FAILURE_TEXT });
        submitRef.current?.focus();
        return;
      }
      if (err instanceof ApiError && err.status >= 500) {
        setNotice({ kind: "danger", text: "系统暂时无法登录，请稍后再试。" });
        return;
      }
      const text = isThrottled(err)
        ? throttledText(err.retryAfterSeconds)
        : err instanceof ApiError && err.status === 403 && err.code === ACCOUNT_DISABLED_CODE
          ? err.message !== "" ? err.message : ACCOUNT_DISABLED_FALLBACK_TEXT
          : err instanceof ApiError && err.status === 403 && err.code === IP_NOT_ALLOWED_CODE
            ? IP_NOT_ALLOWED_TEXT
            : EMAIL_CODE_REJECTED_TEXT;
      setNotice({ kind: "danger", text });
      setCode("");
      setAttempted(false);
      codeRef.current?.focus();
      return;
    }
    enter(result);
  };

  const backToEmail = (): void => {
    setCodeSentTo(null);
    setCode("");
    setAttempted(false);
    setNotice(null);
  };

  const switchLink = (
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
  );

  return (
    <AuthLayout>
      <h1 className="auth-card__title">{config.name}</h1>
      {existing === "checking" ? (
        <Skeleton lines={["control", "control", "control"]} label="正在确认登录状态" />
      ) : mode === "email-code" ? (
        <form className="form" noValidate onSubmit={(event) => void onSubmitCode(event)}>
          <AlertSlot notice={notice} />
          {codeSentTo === null ? (
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
              readOnly={sending}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              errors={emailError ? [emailError] : []}
            />
          ) : (
            <>
              <p className="auth-card__sent-to">{codeSentTo}</p>
              <TextField
                ref={codeRef}
                label="验证码"
                size="lg"
                type="text"
                name="code"
                autoComplete="one-time-code"
                inputMode="numeric"
                required
                readOnly={submitting}
                value={code}
                onChange={(event) => setCode(normalizeEmailCodeInput(event.target.value))}
                errors={attempted && validateEmailCode(code) !== null ? [validateEmailCode(code) as string] : []}
              />
            </>
          )}
          <div className="form__actions">
            {codeSentTo === null ? (
              <Button ref={submitRef} type="submit" variant="primary" size="lg" block loading={sending} loadingText="正在发送…">
                发送验证码
              </Button>
            ) : (
              <Button ref={submitRef} type="submit" variant="primary" size="lg" block loading={submitting} loadingText="正在登录…">
                登录
              </Button>
            )}
          </div>
          <div className="auth-card__alternatives">
            {codeSentTo !== null && (
              <>
                <Button type="button" variant="secondary" disabled={resend.seconds > 0 || submitting} loading={sending} loadingText="正在发送…" onClick={() => void sendCode()}>
                  {resend.seconds > 0 ? `重新发送（${resend.seconds} 秒）` : "重新发送"}
                </Button>
                <Button type="button" variant="secondary" disabled={submitting} onClick={backToEmail}>
                  换一个邮箱
                </Button>
              </>
            )}
            {methods.password && (
              <Button
                type="button"
                variant="secondary"
                disabled={submitting}
                onClick={() => {
                  backToEmail();
                  setChosen("password");
                }}
              >
                改用密码
              </Button>
            )}
          </div>
          {switchLink}
        </form>
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
          {methods.email_code && (
            <div className="auth-card__alternatives">
              <Button
                type="button"
                variant="secondary"
                disabled={submitting}
                onClick={() => {
                  setPassword("");
                  setAttempted(false);
                  setNotice(null);
                  setChosen("email-code");
                }}
              >
                改用邮箱验证码
              </Button>
            </div>
          )}
          {switchLink}
        </form>
      )}
    </AuthLayout>
  );
}
