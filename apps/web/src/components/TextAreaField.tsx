/**
 * 多行文本框 + 标签 + 帮助说明 + 出错文字（docs/design/02-components.md 第 2、4 节）：最少 3 行，只能纵向拉伸。
 * 用在要写说明的地方（关闭异常的处理说明、工单的留言和判定说明、账单的异议原因）。
 */
import { type Ref, type TextareaHTMLAttributes, useId } from "react";
import { Icon } from "./Icon.tsx";

export interface TextAreaFieldProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> {
  label: string;
  errors?: readonly string[];
  hint?: string;
  ref?: Ref<HTMLTextAreaElement>;
}

export function TextAreaField({ label, errors = [], hint, required, rows = 3, className, ref, ...rest }: TextAreaFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const invalid = errors.length > 0;
  const describedBy = [invalid ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ");
  return (
    <div className={["field", className ?? ""].filter(Boolean).join(" ")}>
      <label className="field__label" htmlFor={id}>
        {label}
        {required && (
          <span className="field__required" aria-hidden="true">
            {" "}
            *
          </span>
        )}
      </label>
      <textarea {...rest} ref={ref} id={id} rows={rows} required={required} className="input textarea" aria-invalid={invalid || undefined} aria-describedby={describedBy || undefined} />
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
