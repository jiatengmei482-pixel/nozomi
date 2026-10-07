/**
 * 表单里除了普通输入框以外的字段部件（docs/design/02-components.md 第 3、4、16、19 节）：
 * 下拉、单选组、复选框组、只读的一行、多语言输入组、编码字段、坐标输入。
 * 只读时（没有修改权限的角色、创建后不能改的字段）单选和下拉显示成一行文字，不显示成一组灰掉的选项。
 */
import { type ClipboardEvent, type ReactNode, type Ref, useId, useState } from "react";
import type { LocalizedText } from "@nozomi/domain";
import { INPUT_LANGUAGES } from "../lib/master-display.ts";
import { Icon } from "./Icon.tsx";
import { useToast } from "./Toast.tsx";

export function FieldErrors({ id, errors }: { id: string; errors: readonly string[] }) {
  if (errors.length === 0) return null;
  return (
    <ul className="field__errors" id={id}>
      {errors.map((message) => (
        <li key={message} className="field__error">
          <Icon name="alert-triangle" className="field__error-icon" />
          <span>{message}</span>
        </li>
      ))}
    </ul>
  );
}

function Required() {
  return (
    <span className="field__required" aria-hidden="true">
      {" "}
      *
    </span>
  );
}

/** 只读的一行文字（创建后不能改的字段、只读角色看到的字段）。 */
export function StaticField({ label, children, hint, mono = false }: { label: string; children: ReactNode; hint?: string; mono?: boolean }) {
  return (
    <div className="field">
      <span className="field__label">{label}</span>
      <p className={mono ? "field__static field__static--mono" : "field__static"}>{children}</p>
      {hint && <p className="field__hint">{hint}</p>}
    </div>
  );
}

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

export interface SelectFieldProps<T extends string> {
  label: string;
  value: T;
  options: readonly ChoiceOption<T>[];
  onChange(value: T): void;
  /** 标签写在控件内左侧（筛选条里用） */
  inline?: boolean;
}

/** 原生下拉。选项 ≤ 10 个、不需要搜索时用。 */
export function SelectField<T extends string>({ label, value, options, onChange, inline = false }: SelectFieldProps<T>) {
  const id = useId();
  return (
    <div className={inline ? "field field--inline" : "field"}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <select id={id} className="input select" value={value} onChange={(event) => onChange(event.target.value as T)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export interface ChoiceGroupProps<T extends string> {
  legend: string;
  name: string;
  options: readonly ChoiceOption<T>[];
  errors?: readonly string[];
  hint?: string;
  required?: boolean;
  readOnly?: boolean;
  disabled?: boolean;
  onBlur?(): void;
}

function ChoiceGroupShell({ legend, errors = [], hint, required, children }: { legend: string; errors?: readonly string[]; hint?: string | undefined; required?: boolean | undefined; children: ReactNode }) {
  const id = useId();
  const describedBy = [errors.length > 0 ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(" ");
  return (
    <fieldset className="field fieldset" aria-describedby={describedBy || undefined} aria-invalid={errors.length > 0 || undefined}>
      <legend className="field__label">
        {legend}
        {required && <Required />}
      </legend>
      {children}
      <FieldErrors id={`${id}-error`} errors={errors} />
      {hint && (
        <p className="field__hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
    </fieldset>
  );
}

/** 单选组。`value` 为 null 表示还没选。 */
export function RadioGroup<T extends string>({ legend, name, options, value, onChange, errors, hint, required, readOnly, disabled, onBlur }: ChoiceGroupProps<T> & { value: T | null; onChange(value: T): void }) {
  if (readOnly) return <StaticField label={legend} {...(hint ? { hint } : {})}>{options.find((option) => option.value === value)?.label ?? "—"}</StaticField>;
  return (
    <ChoiceGroupShell legend={legend} errors={errors ?? []} hint={hint} required={required}>
      <div className="choices">
        {options.map((option) => (
          <label key={option.value} className="choice">
            <input type="radio" name={name} value={option.value} checked={option.value === value} disabled={disabled} onChange={() => onChange(option.value)} onBlur={onBlur} />
            <span className="choice__text">
              {option.label}
              {option.hint && <span className="choice__hint">{option.hint}</span>}
            </span>
          </label>
        ))}
      </div>
    </ChoiceGroupShell>
  );
}

/** 复选框组。 */
export function CheckboxGroup<T extends string>({ legend, name, options, value, onChange, errors, hint, required, readOnly, disabled, onBlur }: ChoiceGroupProps<T> & { value: readonly T[]; onChange(value: T[]): void }) {
  if (readOnly) {
    const chosen = options.filter((option) => value.includes(option.value)).map((option) => option.label);
    return <StaticField label={legend} {...(hint ? { hint } : {})}>{chosen.length > 0 ? chosen.join("、") : "—"}</StaticField>;
  }
  return (
    <ChoiceGroupShell legend={legend} errors={errors ?? []} hint={hint} required={required}>
      <div className="choices">
        {options.map((option) => (
          <label key={option.value} className="choice">
            <input
              type="checkbox"
              name={name}
              value={option.value}
              checked={value.includes(option.value)}
              disabled={disabled}
              onChange={(event) => onChange(options.map((entry) => entry.value).filter((entry) => (entry === option.value ? event.target.checked : value.includes(entry))))}
              onBlur={onBlur}
            />
            <span className="choice__text">{option.label}</span>
          </label>
        ))}
      </div>
    </ChoiceGroupShell>
  );
}

export interface LocalizedInputProps {
  legend: string;
  value: LocalizedText;
  onChange(value: LocalizedText): void;
  /** 属于整组的错误（「至少填一种语言」） */
  errors?: readonly string[];
  /** 只属于某一种语言的错误 */
  languageErrors?: Readonly<Partial<Record<string, string>>>;
  /** 某一种语言那一行下方的说明（导入来源的提示） */
  languageNotes?: Readonly<Partial<Record<string, ReactNode>>>;
  hint?: string;
  required?: boolean;
  readOnly?: boolean;
  /** 提交中：输入框只读 */
  busy?: boolean;
  multiline?: boolean;
  maxLength?: number;
  onBlur?(): void;
  firstInputRef?: Ref<HTMLInputElement>;
}

/** 多语言输入组：四种语言各一个输入框，全部同时可见。 */
export function LocalizedInput({ legend, value, onChange, errors = [], languageErrors = {}, languageNotes = {}, hint, required, readOnly, busy, multiline, maxLength, onBlur, firstInputRef }: LocalizedInputProps) {
  const id = useId();
  if (readOnly) {
    const filled = INPUT_LANGUAGES.filter(({ key }) => (value[key] ?? "").trim() !== "");
    return (
      <div className="field">
        <span className="field__label">{legend}</span>
        {filled.length === 0 && <p className="field__static">—</p>}
        {filled.map(({ key, label, lang }) => (
          <p key={key} className="field__static localized__static">
            <span className="localized__language">{label}</span>
            <span lang={lang}>{value[key]}</span>
          </p>
        ))}
        {hint && <p className="field__hint">{hint}</p>}
      </div>
    );
  }
  const groupInvalid = errors.length > 0;
  const describedBy = [groupInvalid ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(" ");
  return (
    <fieldset className="field fieldset" aria-describedby={describedBy || undefined}>
      <legend className="field__label">
        {legend}
        {required && <Required />}
      </legend>
      <div className={multiline ? "localized localized--multiline" : "localized"}>
        {INPUT_LANGUAGES.map(({ key, label, lang }, index) => {
          const rowError = languageErrors[key];
          const text = value[key] ?? "";
          const shared = {
            id: `${id}-${key}`,
            lang,
            "aria-label": `${legend.replace(/（.*）$/, "")} ${label}`,
            "aria-invalid": groupInvalid || rowError !== undefined || undefined,
            "aria-describedby": rowError !== undefined ? `${id}-${key}-error` : undefined,
            readOnly: busy,
            value: text,
            onBlur,
          };
          const update = (next: string): void => onChange({ ...value, [key]: next });
          return (
            <div key={key} className="localized__row">
              <label className="localized__language" htmlFor={`${id}-${key}`}>
                {label}
              </label>
              <div className="localized__input">
                {multiline ? (
                  <>
                    <textarea {...shared} className="input textarea" rows={3} onChange={(event) => update(event.target.value)} />
                    {maxLength !== undefined && <span className={[...text].length > maxLength ? "localized__count localized__count--over" : "localized__count"}>{`${[...text].length} / ${maxLength}`}</span>}
                  </>
                ) : (
                  <input {...shared} ref={index === 0 ? firstInputRef : undefined} className="input" type="text" autoComplete="off" onChange={(event) => update(event.target.value)} />
                )}
                {rowError !== undefined && <FieldErrors id={`${id}-${key}-error`} errors={[rowError]} />}
                {languageNotes[key]}
              </div>
            </div>
          );
        })}
      </div>
      <FieldErrors id={`${id}-error`} errors={errors} />
      {hint && (
        <p className="field__hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
    </fieldset>
  );
}

/** 「复制」图标按钮：复制后发 Toast「已复制」。 */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const toast = useToast();
  return (
    <button
      type="button"
      className="icon-button copy-button"
      aria-label={label}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(
          () => toast("已复制"),
          () => undefined,
        );
      }}
    >
      <Icon name="copy" />
      <span className="tooltip tooltip--end" aria-hidden="true">
        {label}
      </span>
    </button>
  );
}

export interface CodeFieldProps {
  value: string;
  onChange(value: string): void;
  /** 编辑时：只读，可以复制 */
  locked: boolean;
  placeholder?: string;
  hint?: string;
  errors?: readonly string[];
  maxLength?: number;
  busy?: boolean;
  onBlur?(): void;
  ref?: Ref<HTMLInputElement>;
}

/** 编码字段：创建时填一次、以后不能改。输入时小写自动转大写。 */
export function CodeField({ value, onChange, locked, placeholder, hint, errors = [], maxLength, busy, onBlur, ref }: CodeFieldProps) {
  const id = useId();
  const invalid = errors.length > 0;
  const describedBy = [invalid ? `${id}-error` : null, `${id}-hint`].filter(Boolean).join(" ");
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        编码
        {!locked && <Required />}
      </label>
      <div className="field__control">
        <input
          ref={ref}
          id={id}
          className={locked ? "input input--mono input--with-suffix" : "input input--mono"}
          type="text"
          name="code"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          placeholder={locked ? undefined : placeholder}
          maxLength={maxLength}
          readOnly={locked || busy}
          required={!locked}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          value={value}
          onChange={(event) => {
            const input = event.target;
            const position = input.selectionStart;
            onChange(input.value.toUpperCase().trim());
            requestAnimationFrame(() => {
              if (position !== null && document.activeElement === input) input.setSelectionRange(position, position);
            });
          }}
          onBlur={onBlur}
        />
        {locked && <CopyButton text={value} label="复制编码" />}
      </div>
      <FieldErrors id={`${id}-error`} errors={errors} />
      <p className="field__hint" id={`${id}-hint`}>
        {locked ? "编码创建后不能修改。" : hint}
      </p>
    </div>
  );
}

export interface CoordinateValue {
  lat: string;
  lng: string;
}

/** 把一段文字拆成一对坐标；不是一对数字时返回 null。第一个数明显是经度时对调。 */
export function parseCoordinatePair(text: string): { value: CoordinateValue; swapped: boolean } | null {
  const parts = text.trim().split(/[\s,，\t]+/).filter((part) => part !== "");
  if (parts.length !== 2) return null;
  const [first, second] = parts.map(Number) as [number, number];
  if (!Number.isFinite(first) || !Number.isFinite(second)) return null;
  const swapped = Math.abs(first) > 90 && Math.abs(second) <= 90;
  const [lat, lng] = swapped ? [second, first] : [first, second];
  return { value: { lat: lat.toFixed(6), lng: lng.toFixed(6) }, swapped };
}

/** 失去焦点时整理成 6 位小数的写法；不是数字的原样留着。 */
export function tidyCoordinate(text: string): string {
  const trimmed = text.trim();
  if (trimmed === "" || !/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed;
  return Number(trimmed).toFixed(6);
}

export function coordinateIssue(kind: "lat" | "lng", text: string): string | null {
  const name = kind === "lat" ? "纬度" : "经度";
  const trimmed = text.trim();
  if (trimmed === "") return `请输入${name}`;
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return `${name}要填数字，例如 ${kind === "lat" ? "35.552258" : "139.779694"}`;
  const limit = kind === "lat" ? 90 : 180;
  return Math.abs(Number(trimmed)) > limit ? `${name}必须在 -${limit} 到 ${limit} 之间` : null;
}

export interface CoordinateInputProps {
  legend: string;
  value: CoordinateValue;
  onChange(value: CoordinateValue): void;
  errors?: { lat?: string | null; lng?: string | null };
  hint?: string;
  note?: ReactNode;
  readOnly?: boolean;
  busy?: boolean;
  onBlur?(): void;
}

/** 坐标输入：纬度在左、经度在右；可以粘贴「纬度, 经度」。 */
export function CoordinateInput({ legend, value, onChange, errors = {}, hint, note, readOnly, busy, onBlur }: CoordinateInputProps) {
  const id = useId();
  const [swapped, setSwapped] = useState(false);
  if (readOnly) return <StaticField label={legend} mono {...(hint ? { hint } : {})}>{`${value.lat}, ${value.lng}`}</StaticField>;
  const onPaste = (event: ClipboardEvent<HTMLInputElement>): void => {
    const parsed = parseCoordinatePair(event.clipboardData.getData("text"));
    if (!parsed) return;
    event.preventDefault();
    onChange(parsed.value);
    setSwapped(parsed.swapped);
  };
  const cell = (kind: "lat" | "lng", label: string): ReactNode => {
    const error = errors[kind] ?? null;
    return (
      <div className="field">
        <label className="field__label" htmlFor={`${id}-${kind}`}>
          {label}
          <Required />
        </label>
        <input
          id={`${id}-${kind}`}
          className="input input--mono"
          type="text"
          inputMode="text"
          autoComplete="off"
          required
          readOnly={busy}
          aria-invalid={error !== null || undefined}
          aria-describedby={error !== null ? `${id}-${kind}-error` : undefined}
          value={value[kind]}
          onChange={(event) => onChange({ ...value, [kind]: event.target.value })}
          onPaste={onPaste}
          onBlur={() => {
            onChange({ ...value, [kind]: tidyCoordinate(value[kind]) });
            onBlur?.();
          }}
        />
        <FieldErrors id={`${id}-${kind}-error`} errors={error !== null ? [error] : []} />
      </div>
    );
  };
  return (
    <fieldset className="field fieldset" aria-describedby={hint ? `${id}-hint` : undefined}>
      <legend className="field__label">{legend}</legend>
      <div className="coordinates">
        {cell("lat", "纬度")}
        {cell("lng", "经度")}
      </div>
      {swapped && <p className="field__hint field__hint--info">看起来是经度在前，已自动对调。请核对。</p>}
      {note}
      {hint && (
        <p className="field__hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
    </fieldset>
  );
}
