/**
 * 多选面板（docs/design/02-components.md 第 26 节的「添加」）：一个按钮，点开是搜索框 + 一列复选框。
 * 已选的是勾着的，取消勾选 = 移除。面板在按钮下方原地展开（不是浮层），Esc 或「完成」收起，焦点回到按钮。
 */
import { type ReactNode, useId, useRef, useState } from "react";
import { Button } from "./Button.tsx";
import { Icon } from "./Icon.tsx";

export interface PickerOption {
  value: string;
  label: string;
  /** 名称后面的补充信息（标签、编码等） */
  detail?: ReactNode;
  /** 名称下面的一行小字 */
  note?: string;
  /** 另外可以用来筛出这个选项的词 */
  keywords?: string;
}

export interface PickerPanelProps {
  buttonLabel: string;
  searchLabel: string;
  options: readonly PickerOption[];
  selected: readonly string[];
  onToggle(value: string, checked: boolean): void;
  /** 达到上限：没勾的不能再勾 */
  full?: boolean;
  fullText?: string;
  disabled?: boolean;
  emptyText: string;
  footer?: ReactNode;
  buttonId?: string;
}

export function PickerPanel({ buttonLabel, searchLabel, options, selected, onToggle, full = false, fullText, disabled = false, emptyText, footer, buttonId }: PickerPanelProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const button = useRef<HTMLButtonElement>(null);
  const needle = query.trim().toLowerCase();
  const shown = needle === "" ? options : options.filter((option) => `${option.label} ${option.keywords ?? ""}`.toLowerCase().includes(needle));
  const close = (): void => {
    setOpen(false);
    setQuery("");
    button.current?.focus();
  };
  return (
    <div className="picker">
      <div className="picker__bar">
        <Button ref={button} id={buttonId} size="sm" aria-expanded={open} aria-controls={id} disabled={disabled} onClick={() => (open ? close() : setOpen(true))}>
          <Icon name="plus" />
          {buttonLabel}
        </Button>
        {full && fullText && <span className="field__hint">{fullText}</span>}
      </div>
      {open && (
        <div
          className="picker__panel"
          id={id}
          role="group"
          aria-label={buttonLabel}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              close();
            }
          }}
        >
          <input className="input" type="search" aria-label={searchLabel} placeholder={searchLabel} autoComplete="off" autoFocus value={query} onChange={(event) => setQuery(event.target.value)} />
          {shown.length === 0 ? (
            <p className="field__hint">{options.length === 0 ? emptyText : "没有匹配的选项"}</p>
          ) : (
            <ul className="picker__list">
              {shown.map((option) => {
                const checked = selected.includes(option.value);
                return (
                  <li key={option.value}>
                    <label className="picker__option">
                      <input type="checkbox" checked={checked} disabled={!checked && full} onChange={(event) => onToggle(option.value, event.target.checked)} />
                      <span className="picker__text">
                        <span className="picker__label">
                          <span className="picker__name">{option.label}</span>
                          {option.detail}
                        </span>
                        {option.note && <span className="picker__note">{option.note}</span>}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="picker__footer">
            {footer}
            <Button size="sm" variant="primary" onClick={close}>
              完成
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
