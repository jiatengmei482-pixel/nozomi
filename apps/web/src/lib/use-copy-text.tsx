/**
 * 把一段文字写进剪贴板；浏览器不让写（没有权限、不是安全来源）时不能悄悄失败：
 * 明说「没有复制成功」，并给一个已经全选好的文本框，让人自己按 Ctrl / ⌘ + C。
 */
import { type ReactNode, useRef, useState } from "react";
import { Alert } from "../components/Alert.tsx";
import { Button } from "../components/Button.tsx";
import { Dialog } from "../components/Dialog.tsx";
import { useToast } from "../components/Toast.tsx";

export function useCopyText(): { copy(text: string): void; dialog: ReactNode } {
  const toast = useToast();
  const [manual, setManual] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const copy = (text: string): void => {
    const failed = (): void => setManual(text);
    if (!navigator.clipboard?.writeText) return failed();
    navigator.clipboard.writeText(text).then(() => toast("已复制"), failed);
  };
  const dialog = (
    <Dialog
      open={manual !== null}
      size="form"
      title="没有复制成功"
      onClose={() => setManual(null)}
      footer={
        <Button variant="primary" onClick={() => setManual(null)}>
          我已经复制好了
        </Button>
      }
    >
      <div role="alert">
        <Alert kind="warning">浏览器没有允许自动复制。内容在下面，已经全选好了，请按 Ctrl + C（Mac 上是 ⌘ + C）复制，再粘贴到别处存好。</Alert>
      </div>
      <div className="field">
        <label className="field__label" htmlFor="manual-copy-text">
          要复制的内容
        </label>
        <textarea className="input textarea paste__text" id="manual-copy-text" data-autofocus ref={box} rows={8} readOnly value={manual ?? ""} onFocus={(event) => event.currentTarget.select()} />
      </div>
    </Dialog>
  );
  return { copy, dialog };
}
