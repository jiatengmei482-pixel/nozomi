/**
 * 凭一次性令牌给自己的账号设置密码：接受邀请、凭重置令牌重设密码共用这一页
 * （docs/design/pages/login.md 第 3 节）。
 *
 * 令牌放在网址的 # 后面（/accept-invite#token=…）：# 后面的内容不会发给服务器，
 * 不进访问日志，也不会随 Referer 带出去。
 *
 * 后端没有「只核对令牌、不设置密码」的接口，所以进页面时不知道是哪个邮箱、令牌是否还有效；
 * 令牌失效要到提交时才知道。
 */
import { type FormEvent, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { ApiError, acceptInvite, resetPassword } from "../api/client.ts";
import type { LoginLocationState } from "../auth/PortalSession.tsx";
import { AlertSlot, type Notice } from "../components/Alert.tsx";
import { AuthLayout } from "../components/AuthLayout.tsx";
import { Button, LinkButton } from "../components/Button.tsx";
import { StateBlock } from "../components/States.tsx";
import { PasswordField } from "../components/TextField.tsx";
import { failureText, weakPasswordMessages } from "../lib/failure.ts";
import { PORTALS, type Portal } from "../lib/portal.ts";
import { useDocumentTitle } from "../lib/use-document-title.ts";
import { usePressGuard } from "../lib/use-press-guard.ts";
import { PASSWORD_RULES_HINT, validateNewPassword, validatePasswordConfirmation } from "../lib/validation.ts";

export type SetPasswordKind = "invite" | "reset";

const COPY = {
  invite: {
    title: "设置密码",
    intro: "为你的账号设置登录密码。设置后用收到邀请的邮箱登录。",
    submit: "设置密码并继续",
    invalidTitle: "邀请链接已失效",
    invalidDescription: "链接可能已过期或已经使用过。请联系邀请你的管理员重新发送。",
    invalidCode: "INVITE_INVALID",
    reason: "password-set",
  },
  reset: {
    title: "重设密码",
    intro: "为你的账号设置一个新密码。设置后，这个账号在所有设备上的登录都会退出。",
    submit: "设置新密码并继续",
    invalidTitle: "重置链接已失效",
    invalidDescription: "链接可能已过期或已经使用过。请联系管理员重新发送。",
    invalidCode: "RESET_TOKEN_INVALID",
    reason: "password-reset",
  },
} as const;

/** 后端接受的令牌长度上限；超过的一定不是我们发出的令牌。 */
const TOKEN_MAX_LENGTH = 200;

export function tokenFromHash(hash: string): string | null {
  const token = new URLSearchParams(hash.replace(/^#/, "")).get("token");
  return token !== null && token !== "" && token.length <= TOKEN_MAX_LENGTH ? token : null;
}

export function SetPasswordPage({ portal, kind }: { portal: Portal; kind: SetPasswordKind }) {
  const config = PORTALS[portal];
  const copy = COPY[kind];
  useDocumentTitle(`${copy.title} · NOZOMI`);
  const navigate = useNavigate();
  const token = tokenFromHash(useLocation().hash);

  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [passwordChecked, setPasswordChecked] = useState(false);
  const [confirmationChecked, setConfirmationChecked] = useState(false);
  const [serverIssues, setServerIssues] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [rejected, setRejected] = useState(false);

  const guard = usePressGuard();
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmationRef = useRef<HTMLInputElement>(null);

  if (token === null || rejected) {
    return (
      <AuthLayout>
        <StateBlock
          headingLevel="h1"
          title={copy.invalidTitle}
          description={copy.invalidDescription}
          action={
            <LinkButton to={config.paths.login} variant="secondary" size="lg">
              去登录
            </LinkButton>
          }
        />
      </AuthLayout>
    );
  }

  const passwordErrors = serverIssues.length > 0 ? serverIssues : passwordChecked ? validateNewPassword(password, "") : [];
  const confirmationError = confirmationChecked ? validatePasswordConfirmation(password, confirmation) : null;

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (submitting) return;
    setPasswordChecked(true);
    setConfirmationChecked(true);
    setServerIssues([]);
    if (validateNewPassword(password, "").length > 0) {
      passwordRef.current?.focus();
      return;
    }
    if (validatePasswordConfirmation(password, confirmation) !== null) {
      confirmationRef.current?.focus();
      return;
    }
    setNotice(null);
    setSubmitting(true);
    try {
      const request = { token, password };
      const { user } = kind === "invite" ? await acceptInvite(portal, request) : await resetPassword(portal, request);
      const state: LoginLocationState = { reason: copy.reason, email: user.email };
      void navigate(config.paths.login, { replace: true, state });
      return;
    } catch (err) {
      setSubmitting(false);
      if (err instanceof ApiError && err.code === copy.invalidCode) {
        setRejected(true);
      } else if (err instanceof ApiError && err.code === "WEAK_PASSWORD") {
        const messages = weakPasswordMessages(err);
        setServerIssues(messages.length > 0 ? messages : ["密码不符合要求，请换一个再试。"]);
        passwordRef.current?.focus();
      } else {
        setNotice({ kind: "danger", text: failureText(err, "设置密码") });
      }
    }
  };

  return (
    <AuthLayout>
      <h1 className="auth-card__title">{copy.title}</h1>
      <form className="form" noValidate onSubmit={(event) => void onSubmit(event)}>
        <p className="auth-card__intro">{copy.intro}</p>
        <AlertSlot notice={notice} />
        <PasswordField
          ref={passwordRef}
          label="新密码"
          size="lg"
          name="new-password"
          autoComplete="new-password"
          required
          readOnly={submitting}
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            setServerIssues([]);
          }}
          onBlur={() => {
            if (!guard.isPressing()) setPasswordChecked(true);
          }}
          errors={passwordErrors}
          hint={PASSWORD_RULES_HINT}
        />
        <PasswordField
          ref={confirmationRef}
          label="再输入一次"
          size="lg"
          name="confirm-password"
          autoComplete="new-password"
          required
          readOnly={submitting}
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          onBlur={() => {
            if (!guard.isPressing()) setConfirmationChecked(true);
          }}
          errors={confirmationError ? [confirmationError] : []}
        />
        <div className="form__actions">
          <Button type="submit" variant="primary" onPointerDown={guard.onPointerDown} size="lg" block loading={submitting} loadingText="正在设置…">
            {copy.submit}
          </Button>
        </div>
      </form>
    </AuthLayout>
  );
}
