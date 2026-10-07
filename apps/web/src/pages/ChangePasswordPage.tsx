/**
 * 修改自己的密码：要输入当前密码；成功后这个账号在其他设备上的登录全部退出，当前这次登录保留。
 *
 * 账号正在用临时密码时（ADR 0013）这是唯一能用的页面：顶部说明原因，「当前密码」改叫「临时密码」，
 * 改完直接进首页，不用重新登录。
 */
import { type FormEvent, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { ApiError, changePassword } from "../api/client.ts";
import { type ShellLocationState, usePortalSession } from "../auth/PortalSession.tsx";
import { Alert, AlertSlot, type Notice } from "../components/Alert.tsx";
import { AppShell, Page } from "../components/AppShell.tsx";
import { Button } from "../components/Button.tsx";
import { StateBlock } from "../components/States.tsx";
import { PasswordField } from "../components/TextField.tsx";
import { failureText, weakPasswordMessages } from "../lib/failure.ts";
import { useDocumentTitle } from "../lib/use-document-title.ts";
import { usePressGuard } from "../lib/use-press-guard.ts";
import { PASSWORD_RULES_HINT, validateNewPassword, validatePasswordConfirmation } from "../lib/validation.ts";

export function ChangePasswordPage() {
  const { portal, token, account, reloadAccount, mustChangePassword, passwordChanged, handleAuthFailure } = usePortalSession();
  const navigate = useNavigate();
  /** 「当前密码」这一项在两种情形下的叫法 */
  const currentName = mustChangePassword ? "临时密码" : "当前密码";
  useDocumentTitle(`修改密码 · NOZOMI ${portal.name}`);
  const email = account.status === "ready" ? account.account.email : "";

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [currentChecked, setCurrentChecked] = useState(false);
  const [nextChecked, setNextChecked] = useState(false);
  const [confirmationChecked, setConfirmationChecked] = useState(false);
  const [currentRejected, setCurrentRejected] = useState<string | null>(null);
  const [nextRejected, setNextRejected] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const guard = usePressGuard();
  const currentRef = useRef<HTMLInputElement>(null);
  const nextRef = useRef<HTMLInputElement>(null);
  const confirmationRef = useRef<HTMLInputElement>(null);

  const currentError = currentRejected ?? (currentChecked && current === "" ? `请输入${currentName}` : null);
  const nextErrors = nextRejected.length > 0 ? nextRejected : nextChecked ? validateNewPassword(next, email) : [];
  const confirmationError = confirmationChecked ? validatePasswordConfirmation(next, confirmation) : null;

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (submitting) return;
    setCurrentChecked(true);
    setNextChecked(true);
    setConfirmationChecked(true);
    setCurrentRejected(null);
    setNextRejected([]);
    if (current === "") {
      currentRef.current?.focus();
      return;
    }
    if (validateNewPassword(next, email).length > 0) {
      nextRef.current?.focus();
      return;
    }
    if (validatePasswordConfirmation(next, confirmation) !== null) {
      confirmationRef.current?.focus();
      return;
    }
    setNotice(null);
    setSubmitting(true);
    try {
      await changePassword(portal.key, token, { current_password: current, new_password: next });
      if (mustChangePassword) {
        passwordChanged();
        const state: ShellLocationState = { passwordChanged: true };
        void navigate(portal.paths.home, { replace: true, state });
        return;
      }
      setCurrent("");
      setNext("");
      setConfirmation("");
      setCurrentChecked(false);
      setNextChecked(false);
      setConfirmationChecked(false);
      setNotice({ kind: "success", text: "密码已修改。这个账号在其他设备上的登录已全部退出。" });
    } catch (err) {
      if (handleAuthFailure(err)) return;
      if (err instanceof ApiError && err.code === "CURRENT_PASSWORD_INCORRECT") {
        setCurrentRejected(`${currentName}不正确，请重新输入`);
        currentRef.current?.focus();
      } else if (err instanceof ApiError && err.code === "PASSWORD_UNCHANGED") {
        setNextRejected([`新密码不能和${currentName}相同`]);
        nextRef.current?.focus();
      } else if (err instanceof ApiError && err.code === "WEAK_PASSWORD") {
        const messages = weakPasswordMessages(err);
        setNextRejected(messages.length > 0 ? messages : ["密码不符合要求，请换一个再试。"]);
        nextRef.current?.focus();
      } else {
        setNotice({ kind: "danger", text: failureText(err, "修改密码") });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppShell pageName="修改密码">
      <Page title="修改密码" width="form">
        {mustChangePassword && (
          <div role="alert">
            <Alert kind="warning">你正在使用临时密码，请先设置新密码。设置完成前不能使用其他功能。</Alert>
          </div>
        )}
        {account.status === "error" && (
          <section className="card">
            <StateBlock
              title="加载失败"
              description="请检查网络后重试。"
              action={
                <Button variant="secondary" onClick={reloadAccount}>
                  重试
                </Button>
              }
            />
          </section>
        )}
        <form className="card form" noValidate onSubmit={(event) => void onSubmit(event)}>
          <AlertSlot notice={notice} />
          <input className="visually-hidden" type="email" name="email" autoComplete="username" value={email} readOnly tabIndex={-1} aria-hidden="true" />
          <PasswordField
            ref={currentRef}
            label={currentName}
            name="current-password"
            autoComplete="current-password"
            required
            readOnly={submitting}
              value={current}
            onChange={(event) => {
              setCurrent(event.target.value);
              setCurrentRejected(null);
            }}
            onBlur={() => {
            if (!guard.isPressing()) setCurrentChecked(true);
          }}
            errors={currentError ? [currentError] : []}
          />
          <PasswordField
            ref={nextRef}
            label="新密码"
            name="new-password"
            autoComplete="new-password"
            required
            readOnly={submitting}
              value={next}
            onChange={(event) => {
              setNext(event.target.value);
              setNextRejected([]);
            }}
            onBlur={() => {
            if (!guard.isPressing()) setNextChecked(true);
          }}
            errors={nextErrors}
            hint={PASSWORD_RULES_HINT}
          />
          <PasswordField
            ref={confirmationRef}
            label="再输入一次新密码"
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
          <div className="form__actions form__actions--end">
            <Button type="submit" variant="primary" onPointerDown={guard.onPointerDown} loading={submitting} loadingText="保存中…">
              保存新密码
            </Button>
          </div>
        </form>
      </Page>
    </AppShell>
  );
}
