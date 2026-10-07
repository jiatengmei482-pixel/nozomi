/**
 * 筛选条（docs/design/02-components.md 第 5 节）：搜索框在最左，然后是各个条件，最右是「清空筛选」。
 * 条件一改就查询；搜索框停止输入 300ms 后查询，按 Enter 立即查询，输入法组字期间不查询。
 */
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "./Button.tsx";
import { Icon } from "./Icon.tsx";

const SEARCH_DELAY_MS = 300;
export const SEARCH_MAX_LENGTH = 100;

export function SearchBox({ label, value, onSearch }: { label: string; value: string; onSearch(value: string): void }) {
  const [text, setText] = useState(value);
  const composing = useRef(false);
  const latest = useRef(onSearch);
  latest.current = onSearch;
  const committed = useRef(value);

  // 网址里的条件被别处改了（清空筛选、切页签）时，输入框跟着变
  useEffect(() => {
    committed.current = value;
    setText(value);
  }, [value]);

  const commit = (next: string): void => {
    const trimmed = next.trim();
    if (trimmed === committed.current) return;
    committed.current = trimmed;
    latest.current(trimmed);
  };

  useEffect(() => {
    if (composing.current || text.trim() === committed.current) return;
    const timer = setTimeout(() => commit(text), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text]);

  return (
    <div className="search-box">
      <Icon name="search" className="search-box__icon" />
      <input
        className="input search-box__input"
        type="search"
        aria-label={label}
        placeholder={label}
        maxLength={SEARCH_MAX_LENGTH}
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
            commit(text);
          }
        }}
      />
      {text !== "" && (
        <button
          type="button"
          className="search-box__clear"
          aria-label="清除搜索"
          onClick={() => {
            setText("");
            commit("");
          }}
        >
          <Icon name="x" />
        </button>
      )}
    </div>
  );
}

export function FilterBar({ search, children, active, onClear }: { search: ReactNode; children?: ReactNode; active: boolean; onClear(): void }) {
  return (
    <div className="filter-bar" role="search">
      {search}
      {children}
      {active && (
        <Button variant="text" size="sm" className="filter-bar__clear" onClick={onClear}>
          清空筛选
        </Button>
      )}
    </div>
  );
}
