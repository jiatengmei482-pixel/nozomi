/**
 * 筛选条里的日期和文字条件（02-components.md 第 5 节）：标签写在控件左侧，条件对应一个网址参数，用 `useFilterParam` 读写
 * （手机的筛选面板里改的是草稿）。文字条件停止输入 300ms 后生效，按 Enter 立即生效，输入法组字时不生效。
 */
import { useEffect, useId, useRef, useState } from "react";
import { useFilterParam } from "./FilterBar.tsx";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 一个日期条件（`<input type="date">`，值是 YYYY-MM-DD）。 */
export function DateFilter({ name, label }: { name: string; label: string }) {
  const id = useId();
  const [value, setValue] = useFilterParam(name);
  return (
    <div className="field field--inline">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <input id={id} className="input input--sm" type="date" value={value !== null && DATE.test(value) ? value : ""} onChange={(event) => setValue(DATE.test(event.target.value) ? event.target.value : null)} />
    </div>
  );
}

/** 一个文字条件：至少 `minLength` 个字才生效（更短的当作没填）。 */
export function TextFilter({ name, label, minLength = 1, maxLength = 100 }: { name: string; label: string; minLength?: number; maxLength?: number }) {
  const id = useId();
  const [value, setValue] = useFilterParam(name);
  const [text, setText] = useState(value ?? "");
  const composing = useRef(false);
  const latest = useRef(setValue);
  latest.current = setValue;
  useEffect(() => setText(value ?? ""), [value]);
  useEffect(() => {
    if (composing.current) return;
    const trimmed = text.trim();
    const next = trimmed.length >= minLength ? trimmed : null;
    if (next === (value ?? null)) return;
    const timer = setTimeout(() => latest.current(next), 300);
    return () => clearTimeout(timer);
  }, [text, value, minLength]);
  return (
    <div className="field field--inline">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="input input--sm"
        type="search"
        autoComplete="off"
        maxLength={maxLength}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={(event) => {
          composing.current = false;
          setText(event.currentTarget.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !composing.current) {
            event.preventDefault();
            const trimmed = text.trim();
            latest.current(trimmed.length >= minLength ? trimmed : null);
          }
        }}
      />
    </div>
  );
}
