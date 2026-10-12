/**
 * 输入框 + 标签 + 帮助说明 + 出错文字（docs/design/02-components.md 第 2、4 节）。
 * 标签在上方；出错文字在帮助说明上方，帮助说明保留；两者都用 aria-describedby 关联到输入框。
 */
import { type InputHTMLAttributes, type ReactNode, type Ref, useEffect, useId, useState } from "react";
import { Icon } from "./Icon.tsx";

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "id"> {
  label: string;
  /** 出错文字；可以同时有多条（密码规则逐条列出） */
  errors?: readonly string[];
  hint?: string;
  size?: "md" | "lg";
  /** 放在输入框内部右端的控件（显示密码按钮） */
  suffix?: ReactNode;
  ref?: Ref<HTMLInputElement>;
}

export function TextField({ label, errors = [], hint, size = "md", suffix, className, ref, ...rest }: TextFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const invalid = errors.length > 0;
  const describedBy = [invalid ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ");
  return (
    <div className={["field", className ?? ""].filter(Boolean).join(" ")}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <div className="field__control">
        <input
          {...rest}
          ref={ref}
          id={id}
          className={["input", `input--${size}`, suffix ? "input--with-suffix" : ""].filter(Boolean).join(" ")}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy || undefined}
        />
        {suffix}
      </div>
      {invalid && (
        <ul className="field__errors" id={errorId}>
          {errors.map((message) => (
            <li key={message} className="field__error">
              <Icon name="alert-triangle" className="field__error-icon" />
              <span>{message}</span>
            </li>
          ))}
        </ul>
      )}
      {hint && (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      )}
    </div>
  );
}

export interface PasswordFieldProps extends Omit<TextFieldProps, "type" | "suffix"> {
  ref?: Ref<HTMLInputElement>;
}

/**
 * 密码框：右端有「显示密码 / 隐藏密码」按钮，点击后焦点留在密码框。
 * 所在表单每次提交（不管前端校验过没过）都自动切回隐藏。
 */
export function PasswordField({ ref, ...rest }: PasswordFieldProps) {
  const [revealed, setRevealed] = useState(false);
  const [input, setInput] = useState<HTMLInputElement | null>(null);

  useEffect(() => {
    const form = input?.form;
    if (!form) return;
    const conceal = (): void => setRevealed(false);
    form.addEventListener("submit", conceal);
    return () => form.removeEventListener("submit", conceal);
  }, [input]);

  const attach = (node: HTMLInputElement | null): void => {
    setInput(node);
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  };

  return (
    <TextField
      {...rest}
      ref={attach}
      type={revealed ? "text" : "password"}
      suffix={
        <button
          type="button"
          className="input-suffix-button"
          aria-label={revealed ? "隐藏密码" : "显示密码"}
          aria-pressed={revealed}
          onClick={() => {
            setRevealed((current) => !current);
            input?.focus();
          }}
        >
          <Icon name={revealed ? "eye-off" : "eye"} />
          <span className="tooltip tooltip--end" aria-hidden="true">
            {revealed ? "隐藏密码" : "显示密码"}
          </span>
        </button>
      }
    />
  );
}
