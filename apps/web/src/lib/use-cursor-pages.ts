import { useLocation, useNavigate } from "react-router";
import { PAGE_SIZES } from "../components/DataTable.tsx";
import { readListPage } from "../pages/master/shared.tsx";

export const DEFAULT_PAGE_SIZE = 20;

/**
 * 游标分页（02-components.md 第 6 节）：走过的每一页的游标记在这条浏览记录的状态里（一个栈）；
 * 筛选条件（`filterKey`）变了栈就作废、回到第一页。游标不写进网址。
 */
export function useCursorPages(filterKey: string): { cursor: string | null; hasPrevious: boolean; previous(): void; next(cursor: string): void } {
  const location = useLocation();
  const navigate = useNavigate();
  const remembered = readListPage(location.state);
  const stack = remembered !== null && remembered.key === filterKey ? remembered.stack : [null];
  const here = `${location.pathname}${location.search}`;
  const go = (next: (string | null)[]): void => {
    void navigate(here, { replace: true, state: { listPage: { key: filterKey, stack: next } } });
  };
  return {
    cursor: stack[stack.length - 1] ?? null,
    hasPrevious: stack.length > 1,
    previous: () => go(stack.slice(0, -1)),
    next: (cursor) => go([...stack, cursor]),
  };
}

/** 网址里的每页条数（20 / 50 / 100），别的值按默认。 */
export function pageSizeOf(value: string | null): number {
  const size = Number(value);
  return (PAGE_SIZES as readonly number[]).includes(size) ? size : DEFAULT_PAGE_SIZE;
}
