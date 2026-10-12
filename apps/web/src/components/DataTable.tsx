/**
 * 表格（docs/design/02-components.md 第 5 节）：真正的 <table>，只在自己的容器里横向滚动，第一列固定在左侧。
 * 加载、出错、空三种状态都画在表格容器里（表头保留）；已有内容再次加载时保留旧内容并变淡。
 */
import type { ReactNode } from "react";
import { Button } from "./Button.tsx";
import { StateBlock } from "./States.tsx";

export interface Column<T> {
  key: string;
  header: string;
  cell(row: T): ReactNode;
  align?: "end";
  /** 允许折成两行的长文字列 */
  wrap?: boolean;
}

export type TableState = "loading" | "error" | "forbidden" | "ready";

export interface DataTableProps<T> {
  label: string;
  columns: readonly Column<T>[];
  rows: readonly T[];
  rowKey(row: T): string;
  state: TableState;
  /** 已有内容，正在重新取 */
  refreshing?: boolean;
  skeletonRows?: number;
  onRetry(): void;
  /** 没有行时显示什么 */
  empty: ReactNode;
}

export function DataTable<T>({ label, columns, rows, rowKey, state, refreshing = false, skeletonRows = 5, onRetry, empty }: DataTableProps<T>) {
  const showRows = state === "ready" || (refreshing && rows.length > 0);
  return (
    <div className="table-wrap" aria-busy={state === "loading" || refreshing || undefined}>
      {refreshing && <div className="table-wrap__progress" aria-hidden="true" />}
      <div className="table-scroll" tabIndex={0} role="region" aria-label={label}>
        <table className={refreshing ? "table table--stale" : "table"}>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key} scope="col" className={column.align === "end" ? "table__cell--end" : undefined}>
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {showRows &&
              rows.map((row) => (
                <tr key={rowKey(row)}>
                  {columns.map((column, index) => {
                    const className = [column.align === "end" ? "table__cell--end" : "", column.wrap ? "table__cell--wrap" : ""].filter(Boolean).join(" ") || undefined;
                    return index === 0 ? (
                      <th key={column.key} scope="row" className={className}>
                        {column.cell(row)}
                      </th>
                    ) : (
                      <td key={column.key} className={className}>
                        {column.cell(row)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            {state === "loading" &&
              !showRows &&
              Array.from({ length: skeletonRows }, (_, index) => (
                <tr key={index} aria-hidden="true">
                  {columns.map((column) => (
                    <td key={column.key}>
                      <span className="table__skeleton" />
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {state === "loading" && !showRows && (
        <span className="visually-hidden" role="status">
          加载中
        </span>
      )}
      {state === "error" && !showRows && (
        <StateBlock
          title="加载失败"
          description="请检查网络后重试。"
          action={
            <Button variant="secondary" onClick={onRetry}>
              重试
            </Button>
          }
        />
      )}
      {state === "forbidden" && <StateBlock tone="neutral" title="你没有权限查看这里" description="需要的话，请联系管理员开通。" />}
      {state === "ready" && rows.length === 0 && empty}
    </div>
  );
}

export const PAGE_SIZES = [20, 50, 100] as const;

export interface CursorPaginationProps {
  total: number | null;
  pageSize: number;
  onPageSizeChange(size: number): void;
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious(): void;
  onNext(): void;
  busy?: boolean;
}

/** 游标分页：只有「上一页」「下一页」，没有页码。 */
export function CursorPagination({ total, pageSize, onPageSizeChange, hasPrevious, hasNext, onPrevious, onNext, busy = false }: CursorPaginationProps) {
  return (
    <nav className="pagination" aria-label="分页">
      <div className="pagination__info">
        {total !== null && <span>{`共 ${new Intl.NumberFormat("zh-Hans").format(total)} 条`}</span>}
        <label className="pagination__size">
          每页
          <select className="input select input--sm" value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}>
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
          条
        </label>
      </div>
      <div className="pagination__buttons">
        <Button size="sm" disabled={!hasPrevious || busy} onClick={onPrevious}>
          上一页
        </Button>
        <Button size="sm" disabled={!hasNext || busy} onClick={onNext}>
          下一页
        </Button>
      </div>
    </nav>
  );
}
