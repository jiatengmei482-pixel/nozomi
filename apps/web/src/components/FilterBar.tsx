/**
 * 筛选条（docs/design/02-components.md 第 5 节）：搜索框在最左，然后是各个条件，最右是「清空筛选」。
 * 条件一改就查询；搜索框停止输入 300ms 后查询，按 Enter 立即查询，输入法组字期间不查询。
 */
import { type ReactNode, createContext, useContext, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { Button } from "./Button.tsx";
import { Dialog } from "./Dialog.tsx";
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

/** 一个筛选条件的读写。面板里读写的是草稿，面板外读写的是网址参数。 */
type ParamAccess = { get(name: string): string | null; set(name: string, value: string | null): void };
const DraftContext = createContext<ParamAccess | null>(null);

/**
 * 筛选控件用它读写自己的条件：平时直接读写网址参数（一改就查询，用 replace 不塞满后退记录）；
 * 在手机的筛选面板里读写的是草稿，点「查看结果」才一起写进网址。
 */
export function useFilterParam(name: string): [string | null, (value: string | null) => void] {
  const draft = useContext(DraftContext);
  const [params, setParams] = useSearchParams();
  if (draft) return [draft.get(name), (value) => draft.set(name, value)];
  return [
    params.get(name),
    (value) => {
      const next = new URLSearchParams(params);
      if (value === null || value === "") next.delete(name);
      else next.set(name, value);
      setParams(next, { replace: true });
    },
  ];
}

export interface FilterBarProps {
  search: ReactNode;
  /** 搜索框以外的条件控件（用 useFilterParam 读写自己的条件） */
  children?: ReactNode;
  /** 搜索框以外的条件对应的网址参数名 */
  paramNames: readonly string[];
  /** 有任何条件生效（含关键字）：显示「清空筛选」 */
  active: boolean;
  onClear(): void;
}

/**
 * ≥ 768px：条件直接排在搜索框后面，一改就查询。
 * < 768px：只留搜索框和「筛选」按钮，其余条件进从底部升起的面板；面板里改的是草稿，点「查看结果」才生效并关闭面板。
 */
export function FilterBar({ search, children, paramNames, active, onClear }: FilterBarProps) {
  const [params, setParams] = useSearchParams();
  const [draft, setDraft] = useState<Record<string, string | null> | null>(null);
  const activeCount = paramNames.filter((name) => params.has(name)).length;
  const access: ParamAccess = {
    get: (name) => (draft !== null && name in draft ? (draft[name] ?? null) : params.get(name)),
    set: (name, value) => setDraft({ ...draft, [name]: value === "" ? null : value }),
  };
  const apply = (): void => {
    const next = new URLSearchParams(params);
    for (const [name, value] of Object.entries(draft ?? {})) {
      if (value === null) next.delete(name);
      else next.set(name, value);
    }
    setDraft(null);
    setParams(next, { replace: true });
  };
  return (
    <div className="filter-bar" role="search">
      {search}
      {children && (
        <Button className="filter-bar__toggle" aria-haspopup="dialog" onClick={() => setDraft({})}>
          <Icon name="filter" />
          {activeCount > 0 ? `筛选 · ${activeCount}` : "筛选"}
        </Button>
      )}
      <div className="filter-bar__conditions">{children}</div>
      {active && (
        <Button variant="text" size="sm" className="filter-bar__clear" onClick={onClear}>
          清空筛选
        </Button>
      )}
      <Dialog
        open={draft !== null}
        title="筛选"
        onClose={() => setDraft(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDraft(Object.fromEntries(paramNames.map((name) => [name, null])))}>
              清空
            </Button>
            <Button variant="primary" onClick={apply}>
              查看结果
            </Button>
          </>
        }
      >
        <DraftContext.Provider value={access}>
          <div className="filter-bar__panel">{children}</div>
        </DraftContext.Provider>
      </Dialog>
    </div>
  );
}
