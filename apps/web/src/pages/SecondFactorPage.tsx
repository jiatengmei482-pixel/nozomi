/**
 * 运营后台登录的第二步（ADR 0030）：密码对了以后，没绑定过的先绑定（扫码 → 输一次动态码 → 保存恢复码），
 * 绑定过的输入动态码（或一个恢复码）。在完成之前，运营后台的任何地址都显示这一页；完成后回到原来要去的页面。
 * 只有「退出登录」可以离开。
 */
import { type FormEvent, useEffect, useRef, useState } from "react";
import { ApiError } from "../api/client.ts";
import { type EnrollmentStart, confirmEnrollment, startEnrollment, verifySecondFactor } from "../api/platform-security.ts";
import { usePortalSession } from "../auth/PortalSession.tsx";
import { Alert } from "../components/Alert.tsx";
import { AuthLayout } from "../components/AuthLayout.tsx";
import { Button } from "../components/Button.tsx";
import { CodeField, EnrollmentForm, RecoveryCodesBlock } from "../components/MfaParts.tsx";
import { Skeleton } from "../components/States.tsx";
import { TextField } from "../components/TextField.tsx";
import { isUnauthenticated } from "../lib/failure.ts";
import { codeProblem, mfaFailureText, recoveryCodeProblem } from "../lib/mfa-display.ts";
import { useDocumentTitle } from "../lib/use-document-title.ts";

export function SecondFactorPage({ status }: { status: "enrollment_required" | "verify_required" }) {
  const { token, account, signOut, expire, secondFactorDone } = usePortalSession();
  useDocumentTitle(status === "enrollment_required" ? "绑定两步验证 · NOZOMI 运营后台" : "两步验证 · NOZOMI 运营后台");
  const email = account.status === "ready" ? account.account.email : "";
  return (
    <AuthLayout>
      <h1 className="auth-card__title">{status === "enrollment_required" ? "绑定两步验证" : "两步验证"}</h1>
      {status === "enrollment_required" ? (
        <Enroll token={token} email={email} onDone={secondFactorDone} onExpired={expire} />
      ) : (
        <Verify token={token} onDone={secondFactorDone} onExpired={expire} />
      )}
      <p className="auth-card__switch">
        <button type="button" className="link link--button" onClick={() => void signOut()}>
          退出登录
        </button>
      </p>
    </AuthLayout>
  );
}

function Verify({ token, onDone, onExpired }: { token: string; onDone(mustChangePassword: boolean): void; onExpired(): void }) {
  const [useRecovery, setUseRecovery] = useState(false);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [lowCodes, setLowCodes] = useState<{ remaining: number; mustChange: boolean } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), [useRecovery]);

  const error = !attempted ? null : useRecovery ? recoveryCodeProblem(recovery) : codeProblem(code);
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setAttempted(true);
    if ((useRecovery ? recoveryCodeProblem(recovery) : codeProblem(code)) !== null || working) return;
    setWorking(true);
    setProblem(null);
    try {
      const result = await verifySecondFactor(token, useRecovery ? { recovery_code: recovery.trim() } : { code });
      // 用恢复码登录、而且剩得不多了：提醒一下再进去
      if (result.second_factor.method === "recovery_code" && result.second_factor.recovery_codes_remaining <= 3) {
        setLowCodes({ remaining: result.second_factor.recovery_codes_remaining, mustChange: result.must_change_password });
        return;
      }
      onDone(result.must_change_password);
    } catch (err) {
      if (isUnauthenticated(err)) return onExpired();
      if (err instanceof ApiError && err.code === "MFA_ALREADY_VERIFIED") return onDone(false);
      setProblem(mfaFailureText(err));
      setCode("");
      input.current?.focus();
    } finally {
      setWorking(false);
    }
  };

  if (lowCodes !== null) {
    return (
      <div className="form">
        <Alert kind="warning">
          <strong className="alert__title">{lowCodes.remaining === 0 ? "恢复码已经用完了。" : `恢复码只剩 ${lowCodes.remaining} 个了。`}</strong>
          <span>进去以后请在右上角账号菜单的「账号安全」里重新生成一组，或者换上新手机的验证器。</span>
        </Alert>
        <div className="form__actions">
          <Button variant="primary" size="lg" block onClick={() => onDone(lowCodes.mustChange)}>
            知道了，继续
          </Button>
        </div>
      </div>
    );
  }
  return (
    <form className="form" noValidate onSubmit={(event) => void submit(event)}>
      <p className="auth-card__intro">{useRecovery ? "输入你保存的恢复码中的一个。用过的恢复码就作废了。" : "为了保护平台数据，运营后台每次登录都要输入验证器上的动态码。"}</p>
      <div role="alert">{problem !== null && <Alert kind="danger">{problem}</Alert>}</div>
      {useRecovery ? (
        <TextField
          ref={input}
          label="恢复码"
          size="lg"
          name="recovery-code"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          readOnly={working}
          value={recovery}
          onChange={(event) => setRecovery(event.target.value)}
          errors={error ? [error] : []}
        />
      ) : (
        <CodeField ref={input} value={code} onChange={setCode} errors={error ? [error] : []} disabled={working} />
      )}
      <div className="form__actions">
        <Button type="submit" variant="primary" size="lg" block loading={working} loadingText="正在验证…">
          验证
        </Button>
      </div>
      <p className="auth-card__switch">
        <button
          type="button"
          className="link link--button"
          disabled={working}
          onClick={() => {
            setUseRecovery(!useRecovery);
            setAttempted(false);
            setProblem(null);
          }}
        >
          {useRecovery ? "用验证器的动态码" : "手机不在身边？用恢复码"}
        </button>
      </p>
      {useRecovery && <p className="auth-card__intro">恢复码也找不到了：请另一位超级管理员在「平台员工」里重置你的两步验证。</p>}
    </form>
  );
}

function Enroll({ token, email, onDone, onExpired }: { token: string; email: string; onDone(mustChangePassword: boolean): void; onExpired(): void }) {
  const [started, setStarted] = useState<EnrollmentStart | null>(null);
  const [loadProblem, setLoadProblem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<{ codes: string[]; mustChange: boolean; at: Date } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadProblem(null);
    startEnrollment(token, null).then(
      (result) => !cancelled && setStarted(result),
      (err: unknown) => {
        if (cancelled) return;
        if (isUnauthenticated(err)) onExpired();
        else setLoadProblem(mfaFailureText(err));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [token, attempt, onExpired]);

  const confirm = async (code: string): Promise<void> => {
    setWorking(true);
    setProblem(null);
    try {
      const result = await confirmEnrollment(token, code);
      setDone({ codes: result.recovery_codes, mustChange: result.must_change_password, at: new Date() });
    } catch (err) {
      if (isUnauthenticated(err)) return onExpired();
      if (err instanceof ApiError && err.code === "MFA_ENROLLMENT_NOT_STARTED") {
        setStarted(null);
        setAttempt((n) => n + 1);
      }
      setProblem(mfaFailureText(err));
    } finally {
      setWorking(false);
    }
  };

  if (done !== null) return <RecoveryCodesBlock email={email} codes={done.codes} issuedAt={done.at} onDone={() => onDone(done.mustChange)} />;
  if (loadProblem !== null) {
    return (
      <div className="form">
        <div role="alert">
          <Alert kind="danger">{loadProblem}</Alert>
        </div>
        <Button variant="secondary" block onClick={() => setAttempt((n) => n + 1)}>
          重试
        </Button>
      </div>
    );
  }
  if (started === null) return <Skeleton lines={["control", "control", "control"]} label="正在生成二维码" />;
  return (
    <>
      <p className="auth-card__intro">运营后台必须开启两步验证：以后每次登录，除了密码，还要输入手机验证器上的 6 位动态码。只需要设置这一次。</p>
      <EnrollmentForm started={started} working={working} problem={problem} onConfirm={(code) => void confirm(code)} />
    </>
  );
}
