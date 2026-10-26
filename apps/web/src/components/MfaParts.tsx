/**
 * 两步验证的几块界面（ADR 0030），登录时和个人页共用：
 * - `EnrollmentForm`：二维码 + 密钥原文 + 输入一次动态码确认；
 * - `RecoveryCodesBlock`：一次性显示恢复码，复制 / 存成文件，勾选「已保存」后才能继续；
 * - `CodeField`：6 位动态码的输入框（只留数字，手机上弹数字键盘，浏览器可以自动填一次性码）。
 */
import { type FormEvent, type Ref, useState } from "react";
import type { EnrollmentStart } from "../api/platform-security.ts";
import { cleanCodeInput, codeProblem, recoveryCodesText } from "../lib/mfa-display.ts";
import { useCopyText } from "../lib/use-copy-text.tsx";
import { Alert } from "./Alert.tsx";
import { Button } from "./Button.tsx";
import { QrCode } from "./QrCode.tsx";
import { TextField } from "./TextField.tsx";

export function CodeField({ value, onChange, errors, disabled, ref, label = "动态码" }: { value: string; onChange(value: string): void; errors: readonly string[]; disabled?: boolean | undefined; ref?: Ref<HTMLInputElement> | undefined; label?: string | undefined }) {
  return (
    <TextField
      {...(ref === undefined ? {} : { ref })}
      label={label}
      size="lg"
      name="one-time-code"
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9]*"
      maxLength={6}
      spellCheck={false}
      readOnly={disabled === true}
      value={value}
      onChange={(event) => onChange(cleanCodeInput(event.target.value))}
      errors={errors}
      hint="打开手机上的验证器 App，输入「NOZOMI 运营后台」这一项现在显示的 6 位数字。"
    />
  );
}

/** 密钥原文按 4 个一组显示，方便手输。 */
function grouped(secret: string): string {
  return secret.match(/.{1,4}/g)?.join(" ") ?? secret;
}

export function EnrollmentForm({ started, working, problem, onConfirm }: { started: EnrollmentStart; working: boolean; problem: string | null; onConfirm(code: string): void }) {
  const [code, setCode] = useState("");
  const [attempted, setAttempted] = useState(false);
  const error = attempted ? codeProblem(code) : null;
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    setAttempted(true);
    if (codeProblem(code) !== null || working) return;
    onConfirm(code);
  };
  return (
    <form className="form" noValidate onSubmit={submit}>
      <div role="alert">{problem !== null && <Alert kind="danger">{problem}</Alert>}</div>
      <ol className="mfa-steps">
        <li>在手机上装一个验证器 App（如 Google Authenticator、Microsoft Authenticator，或你在用的密码管理器）。</li>
        <li>
          用它扫下面的二维码。扫不了的话，选「手动输入」，把下面的密钥输进去。
          <div className="mfa-qr">
            <QrCode text={started.otpauth_uri} label="绑定两步验证的二维码" />
          </div>
          <p className="mfa-secret">
            <span className="mfa-secret__label">密钥</span>
            <code className="mfa-secret__value">{grouped(started.secret)}</code>
          </p>
        </li>
        <li>输入 App 里显示的 6 位数字，完成绑定。</li>
      </ol>
      <CodeField value={code} onChange={setCode} errors={error ? [error] : []} disabled={working} />
      <div className="form__actions">
        <Button type="submit" variant="primary" size="lg" block loading={working} loadingText="正在绑定…">
          完成绑定
        </Button>
      </div>
    </form>
  );
}

export function RecoveryCodesBlock({ email, codes, issuedAt, onDone, doneLabel = "继续" }: { email: string; codes: readonly string[]; issuedAt: Date; onDone(): void; doneLabel?: string }) {
  const { copy, dialog } = useCopyText();
  const [saved, setSaved] = useState(false);
  const text = recoveryCodesText(email, codes, issuedAt);
  const download = (): void => {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "nozomi-recovery-codes.txt";
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };
  return (
    <div className="form">
      <Alert kind="warning">
        <strong className="alert__title">这些恢复码只显示这一次。</strong>
        <span>手机丢了或验证器打不开时，登录时可以用其中一个代替动态码，每个只能用一次。请现在就存在只有你自己能打开的地方。</span>
      </Alert>
      <ul className="recovery-codes" aria-label="恢复码">
        {codes.map((code) => (
          <li key={code}>
            <code>{code}</code>
          </li>
        ))}
      </ul>
      <div className="recovery-codes__actions">
        <Button variant="secondary" onClick={() => copy(codes.join("\n"))}>
          复制
        </Button>
        <Button variant="secondary" onClick={download}>
          存成文件
        </Button>
      </div>
      <label className="choice">
        <input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} />
        <span className="choice__text">我已经把恢复码存好了</span>
      </label>
      <div className="form__actions">
        <Button variant="primary" size="lg" block disabled={!saved} onClick={onDone}>
          {doneLabel}
        </Button>
      </div>
      {dialog}
    </div>
  );
}
