/**
 * 组合框的多选（docs/design/02-components.md 第 3 节）：输入文字筛选、Enter 或点击加进来；已选的排在输入框下面，是可以去掉的小标签。
 * 选过的不再出现在下拉里；加进来以后焦点留在输入框，可以接着找下一个。去掉一个后焦点移到下一个标签的「去掉」按钮，没有了回到输入框。
 */
import { useRef, useState } from "react";
import { Combobox, type ComboboxOption } from "./Combobox.tsx";
import { Icon } from "./Icon.tsx";

export interface MultiComboboxProps {
  label: string;
  options: readonly ComboboxOption[];
  value: readonly string[];
  onChange(value: string[]): void;
  placeholder?: string;
  errors?: readonly string[];
  hint?: string;
  emptyText?: string;
  /** 全部选完、下拉里没得选了时的话 */
  allChosenText?: string;
  loading?: boolean;
  loadFailed?: boolean;
  required?: boolean;
  /** 已选的值不在 options 里时（例如已停用）显示的名字 */
  unknownLabel?(value: string): string;
}

export function MultiCombobox({ label, options, value, onChange, placeholder, errors = [], hint, emptyText, allChosenText = "都已经选上了", loading = false, loadFailed = false, required = false, unknownLabel = () => "（已不可选）" }: MultiComboboxProps) {
  const input = useRef<HTMLInputElement>(null);
  const chips = useRef<HTMLUListElement>(null);
  const [announce, setAnnounce] = useState("");
  const nameOf = (entry: string): string => options.find((option) => option.value === entry)?.label ?? unknownLabel(entry);
  const remaining = options.filter((option) => !value.includes(option.value));
  const remove = (entry: string, index: number): void => {
    const next = value.filter((item) => item !== entry);
    onChange(next);
    setAnnounce(`已去掉「${nameOf(entry)}」，还选着 ${next.length} 个`);
    requestAnimationFrame(() => {
      const buttons = chips.current?.querySelectorAll<HTMLButtonElement>("button") ?? [];
      (buttons[Math.min(index, buttons.length - 1)] ?? input.current)?.focus();
    });
  };
  return (
    <div className="multi-combobox">
      <Combobox
        ref={input}
        label={label}
        options={remaining}
        value={null}
        required={required}
        errors={errors}
        loading={loading}
        loadFailed={loadFailed}
        {...(placeholder ? { placeholder } : {})}
        {...(hint ? { hint } : {})}
        emptyText={options.length > 0 ? allChosenText : (emptyText ?? "没有可选的")}
        onChange={(next) => {
          if (next === null || value.includes(next)) return;
          onChange([...value, next]);
          setAnnounce(`已选上「${nameOf(next)}」，共 ${value.length + 1} 个`);
        }}
      />
      {value.length === 0 ? (
        <p className="field__hint">{`还没有选${label}`}</p>
      ) : (
        <ul className="filter-chips multi-combobox__chips" ref={chips} aria-label={`已选的${label}（${value.length} 个）`}>
          {value.map((entry, index) => (
            <li key={entry} className="filter-chip">
              <span className="filter-chip__text">{nameOf(entry)}</span>
              <button type="button" className="filter-chip__remove" aria-label={`去掉 ${nameOf(entry)}`} onClick={() => remove(entry, index)}>
                <Icon name="x" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="visually-hidden" role="status">
        {announce}
      </p>
    </div>
  );
}
