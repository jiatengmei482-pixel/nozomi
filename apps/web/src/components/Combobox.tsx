/**
 * 组合框（docs/design/02-components.md 第 3 节）：输入框 + 下拉面板，输入文字即筛选，只能从选项里选。
 * 键盘：↓ 打开；↑↓ 移动高亮；Enter 选中；Esc 关闭并把焦点留在输入框。面板关着的时候 Enter 不拦截（提交表单）。
 * 输入文字后第一个匹配项是「暂定」的高亮：直接 Enter 选它；这时按 ↓ 是确认落在它上面（不跳到第二个），再按才往下走。
 * 所以「输入 → ↓ → Enter」和「输入 → Enter」选中的都是第一个匹配项。
 * 重新输入了和已选项一模一样的文字时（值没变，不会有变更通知）面板也照常打开。
 */
import { type KeyboardEvent, type Ref, useEffect, useId, useMemo, useRef, useState } from "react";
import { Icon } from "./Icon.tsx";

export interface ComboboxOption {
  value: string;
  label: string;
  /** 选项右侧的次要文字（编码等） */
  detail?: string;
  /** 另外可以用来筛出这个选项的词 */
  keywords?: string;
  /** 分组小标题（相同的排在一起由调用方保证） */
  group?: string;
}

export interface ComboboxProps {
  label: string;
  options: readonly ComboboxOption[];
  value: string | null;
  onChange(value: string | null): void;
  placeholder?: string;
  errors?: readonly string[];
  hint?: string;
  /** 一个选项都没有时面板里的话 */
  emptyText?: string;
  loading?: boolean;
  loadFailed?: boolean;
  required?: boolean;
  /** 只读：显示成一行文字 */
  readOnly?: boolean;
  /** 标签写在控件内左侧（筛选条里用） */
  inline?: boolean;
  /** 可以清空（筛选条里的「全部」） */
  clearLabel?: string;
  onBlur?(): void;
  ref?: Ref<HTMLInputElement>;
}

function matches(option: ComboboxOption, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  return `${option.label} ${option.detail ?? ""} ${option.keywords ?? ""}`.toLowerCase().includes(needle);
}

export function Combobox({ label, options, value, onChange, placeholder, errors = [], hint, emptyText = "没有匹配的选项", loading = false, loadFailed = false, required = false, readOnly = false, inline = false, clearLabel, onBlur, ref }: ComboboxProps) {
  const id = useId();
  const listId = `${id}-list`;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const selected = options.find((option) => option.value === value) ?? null;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  // 高亮的是第几项；-1 = 还没有高亮
  const [active, setActive] = useState(-1);
  // 高亮是输入文字后自动给的，还没被方向键确认过
  const tentative = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const attach = (node: HTMLInputElement | null): void => {
    inputRef.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  };

  // 值被别处填进来（例如按建议预填）而焦点正好在输入框里：把文字全选，接着打字是替换，不是接在后面
  useEffect(() => {
    const input = inputRef.current;
    if (input && value !== null && document.activeElement === input) input.select();
  }, [value]);
  const visible = useMemo(() => {
    const filtered = options.filter((option) => matches(option, query ?? ""));
    return clearLabel !== undefined && (query ?? "") === "" ? [{ value: "", label: clearLabel }, ...filtered] : filtered;
  }, [options, query, clearLabel]);

  useEffect(() => {
    if (!open) return;
    const close = (event: Event): void => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setOpen(false);
        setQuery(null);
        setActive(-1);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const invalid = errors.length > 0;
  const describedBy = [invalid ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ");
  const inputText = query ?? (selected ? selected.label : "");

  if (readOnly) {
    return (
      <div className="field">
        <span className="field__label">{label}</span>
        <p className="field__static">{selected ? `${selected.label}${selected.detail ? ` ${selected.detail}` : ""}` : "—"}</p>
        {hint && <p className="field__hint">{hint}</p>}
      </div>
    );
  }

  const choose = (option: ComboboxOption): void => {
    onChange(option.value === "" ? null : option.value);
    setOpen(false);
    setQuery(null);
    setActive(-1);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        tentative.current = false;
        setOpen(true);
        setActive(0);
        return;
      }
      const step = event.key === "ArrowDown" ? 1 : -1;
      const wasTentative = tentative.current;
      tentative.current = false;
      setActive((current) => {
        if (visible.length === 0) return -1;
        if (current < 0 || wasTentative) return step === 1 ? 0 : visible.length - 1;
        return (current + step + visible.length) % visible.length;
      });
    } else if (event.key === "Enter" && open) {
      event.preventDefault();
      // 没有高亮（点开后什么都没输入）时只是关上面板
      const option = active >= 0 ? visible[active] : undefined;
      if (option) choose(option);
      else {
        setOpen(false);
        setQuery(null);
        setActive(-1);
      }
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
      setQuery(null);
    }
  };

  let lastGroup: string | undefined;
  return (
    <div className={inline ? "field field--inline" : "field"} ref={rootRef}>
      <label className="field__label" htmlFor={id}>
        {label}
        {required && (
          <span className="field__required" aria-hidden="true">
            {" "}
            *
          </span>
        )}
      </label>
      <div className="field__control combobox">
        <input
          ref={attach}
          id={id}
          className="input input--with-suffix"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 && visible[active] ? `${id}-option-${active}` : undefined}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy || undefined}
          aria-required={required || undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          value={inputText}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            tentative.current = event.target.value.trim() !== "";
            setActive(tentative.current ? 0 : -1);
            if (event.target.value === "" && value !== null) onChange(null);
          }}
          onInput={() => setOpen(true)}
          onFocus={(event) => event.target.select()}
          onClick={() => {
            if (!open) {
              tentative.current = false;
              setActive(-1);
            }
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => {
            setOpen(false);
            setQuery(null);
            setActive(-1);
            onBlur?.();
          }}
        />
        <span className="combobox__arrow" aria-hidden="true">
          <Icon name="chevron-down" />
        </span>
        <ul id={listId} role="listbox" aria-label={label} className="combobox__panel" hidden={!open} onPointerDown={(event) => event.preventDefault()}>
          {loading && <li className="combobox__note">加载中…</li>}
          {loadFailed && <li className="combobox__note">加载失败</li>}
          {!loading && !loadFailed && visible.length === 0 && <li className="combobox__note">{options.length === 0 ? emptyText : "没有匹配的选项"}</li>}
          {!loading &&
            visible.map((option, index) => {
              const heading = option.group !== undefined && option.group !== lastGroup ? option.group : null;
              lastGroup = option.group;
              return (
                <li key={`${option.value}-${index}`} role="presentation">
                  {heading && <span className="combobox__group">{heading}</span>}
                  <div
                    id={`${id}-option-${index}`}
                    role="option"
                    aria-selected={option.value === (value ?? "")}
                    className={index === active ? "combobox__option combobox__option--active" : "combobox__option"}
                    onPointerMove={() => setActive(index)}
                    onClick={() => choose(option)}
                  >
                    <span className="combobox__option-label">{option.label}</span>
                    {option.detail && <span className="combobox__option-detail">{option.detail}</span>}
                    {option.value === (value ?? "") && <Icon name="check" className="combobox__option-check" />}
                  </div>
                </li>
              );
            })}
        </ul>
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
