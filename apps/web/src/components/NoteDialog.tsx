/**
 * 「写一段说明再提交」的对话框（02-components.md 第 4、9 节）：关闭异常、关闭工单、答复异议、作废账单、提异议……
 * - 说明必填时，没写就点提交：字段下方报错，焦点回到输入框；
 * - 提交中：按钮加载态，Esc、点遮罩、关闭都不起作用；
 * - 被业务规则拒绝（4xx）：对话框不关，正文上方一条危险提示条写明原因，去掉提交按钮，「取消」改成「知道了」；
 * - 网络不通或服务器出错：提示条写「…请稍后重试」，提交按钮恢复可点，写的内容还在。
 * 有表单，点遮罩不关闭。
 */
import { type ReactNode, useRef, useState } from "react";
import { ApiError, NetworkError } from "../api/client.ts";
import { usePortalSession } from "../auth/PortalSession.tsx";
import { failureText } from "../lib/failure.ts";
import { Alert } from "./Alert.tsx";
import { Button } from "./Button.tsx";
import { Dialog } from "./Dialog.tsx";
import { TextAreaField } from "./TextAreaField.tsx";
import { TextField } from "./TextField.tsx";

export interface NoteDialogProps {
  title: string;
  /** 正文：写清楚这一步会怎样（后果、能不能恢复） */
  intro?: ReactNode;
  label: string;
  hint?: string;
  required?: boolean;
  /** 必填没写时的出错文字 */
  missing?: string;
  maxLength?: number;
  confirmText: string;
  busyText: string;
  /** 不可恢复的操作：确认按钮用危险按钮，默认焦点落在「取消」上 */
  danger?: boolean;
  /** 「…失败」里的动作名（「关闭」「答复」） */
  action: string;
  /** 后端拒绝时给用户看的话；不给就用后端的中文说明 */
  describe?(err: ApiError): string | null;
  onClose(): void;
  onSubmit(note: string): Promise<void>;
  /** 一行就够的（凭证号）：用单行输入框 */
  singleLine?: boolean;
  children?: ReactNode;
}

export function NoteDialog({ title, intro, label, hint, required = true, missing, maxLength = 1000, confirmText, busyText, danger = false, action, describe, onClose, onSubmit, singleLine = false, children }: NoteDialogProps) {
  const { handleAuthFailure } = usePortalSession();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ text: string; final: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const line = useRef<HTMLInputElement>(null);
  const submit = async (): Promise<void> => {
    if (required && note.trim() === "") {
      setError(missing ?? `请写${label}`);
      (singleLine ? line.current : field.current)?.focus();
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await onSubmit(note.trim());
    } catch (err) {
      if (handleAuthFailure(err)) return;
      const final = err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 429;
      setProblem({ text: (err instanceof ApiError ? describe?.(err) : null) ?? (err instanceof NetworkError || !final ? `${failureText(err, action)}你写的内容还在。` : failureText(err, action)), final });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      title={title}
      size="form"
      busy={busy}
      dismissOnBackdrop={false}
      onClose={onClose}
      footer={
        <>
          <Button variant="text" data-autofocus={danger || problem?.final ? true : undefined} disabled={busy} onClick={onClose}>
            {problem?.final ? "知道了" : "取消"}
          </Button>
          {!problem?.final && (
            <Button variant={danger ? "danger" : "primary"} loading={busy} loadingText={busyText} onClick={() => void submit()}>
              {confirmText}
            </Button>
          )}
        </>
      }
    >
      <div role="alert">{problem !== null && <Alert kind="danger">{problem.text}</Alert>}</div>
      {intro !== undefined && <div className="dialog__intro">{intro}</div>}
      {children}
      {!problem?.final && singleLine && (
        <TextField
          ref={line}
          label={label}
          required={required}
          maxLength={maxLength}
          autoComplete="off"
          value={note}
          readOnly={busy}
          errors={error === null ? [] : [error]}
          {...(hint === undefined ? {} : { hint })}
          onChange={(event) => {
            setNote(event.target.value);
            if (error !== null && event.target.value.trim() !== "") setError(null);
          }}
        />
      )}
      {!problem?.final && !singleLine && (
        <TextAreaField
          ref={field}
          label={label}
          required={required}
          maxLength={maxLength}
          value={note}
          readOnly={busy}
          errors={error === null ? [] : [error]}
          {...(hint === undefined ? {} : { hint })}
          onChange={(event) => {
            setNote(event.target.value);
            if (error !== null && event.target.value.trim() !== "") setError(null);
          }}
        />
      )}
    </Dialog>
  );
}
