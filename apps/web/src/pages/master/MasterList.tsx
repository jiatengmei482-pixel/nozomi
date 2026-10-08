/**
 * 四类主数据共用的列表页（docs/design/pages/master-data.md 第 2 节）：
 * 标题行 + 筛选条 + 表格 + 游标分页，行内的停用（要确认）和启用（不用确认）。
 * 各类自己的列、筛选条件、文案由 `ListDefinition` 给出。
 */
import type { MasterDataStatus } from "@nozomi/domain";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { type MasterKind, type MasterKinds, type MasterListQuery, type MasterPage, listMaster } from "../../api/master.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { AppShell, Page } from "../../components/AppShell.tsx";
import { Attributions, type DataSource } from "../../components/Attribution.tsx";
import { Button, LinkButton } from "../../components/Button.tsx";
import { type Column, CursorPagination, DataTable, PAGE_SIZES, type TableState } from "../../components/DataTable.tsx";
import { FilterBar, SearchBox, useFilterParam } from "../../components/FilterBar.tsx";
import { SelectField } from "../../components/FormFields.tsx";
import { Icon } from "../../components/Icon.tsx";
import { StateBlock } from "../../components/States.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { MASTER_STATUS_BADGES, displayName } from "../../lib/master-display.ts";
import { masterEditPath } from "../../lib/master-paths.ts";
import { useDocumentTitle } from "../../lib/use-document-title.ts";
import { useLoad } from "../../lib/use-load.ts";
import { usePlatformCan } from "../../lib/use-master-access.ts";
import { CodeLink, NameCell, type ReturnState, readListPage } from "./shared.tsx";
import { type ToggleNotice, useStatusToggle } from "./useStatusToggle.tsx";

const DEFAULT_PAGE_SIZE = 50;
/** 各个列表离开时的滚动位置（按地址记）。 */
const scrollPositions = new Map<string, number>();

type RecordOf<K extends MasterKind> = MasterKinds[K]["record"];

export interface ListDefinition<K extends MasterKind> {
  kind: K;
  /** 页面标题（模块名） */
  title: string;
  /** 「新增{对象}」「没有符合条件的{对象}」里的对象名 */
  objectName: string;
  /** 停用确认里的说法：「这个城市」「这项附加服务」 */
  objectPhrase: string;
  newPath: string;
  /** 编码、名称之后，状态之前的列 */
  columns: readonly Column<RecordOf<K>>[];
  /** 这个列表另外的筛选条件（除了关键字、状态）：控件、对应的查询参数、网址参数名 */
  filters?: ReactNode;
  query?: MasterListQuery;
  filterParams?: readonly string[];
  /** 切换页签这类不算筛选条件、清空筛选时要保留的网址参数 */
  keepParams?: readonly string[];
  empty: { title: string; description: string };
  /** 标题行下面、筛选条上面的内容（页签、提示条） */
  header?: ReactNode;
  /** 页面底部的数据来源署名 */
  footnotes?: readonly DataSource[];
  /** 这一行还不能启用、要先去别处处理（还没有城市的导入机场）：给出替代「启用」的链接 */
  blockedAction?(row: RecordOf<K>): { label: string; to: string } | null;
  /** 停用被保护规则拒绝时的说明 */
  inUse?(row: RecordOf<K>, activeCount: number): ToggleNotice;
  /** 启用被拒（MASTER_DATA_NOT_READY）时的说明 */
  notReady?(row: RecordOf<K>, reason: string): ToggleNotice | null;
}

const STATUS_OPTIONS = [
  { value: "all", label: "全部" },
  { value: "active", label: "启用" },
  { value: "disabled", label: "已停用" },
] as const;

function StatusFilter() {
  const [status, setStatus] = useFilterParam("status");
  return <SelectField inline label="状态" value={status === "active" || status === "disabled" ? status : "all"} options={STATUS_OPTIONS} onChange={(value) => setStatus(value === "all" ? null : value)} />;
}

function rowLabel(row: { code: string; name: Parameters<typeof displayName>[0] }): string {
  return `${row.code} ${displayName(row.name).text}`;
}

export function MasterList<K extends MasterKind>({ definition }: { definition: ListDefinition<K> }) {
  const { kind, title, objectName } = definition;
  const { portal } = usePortalSession();
  useDocumentTitle(`${title} · NOZOMI ${portal.name}`);
  const canManage = usePlatformCan("master_data.manage");
  const location = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const q = (params.get("q") ?? "").trim().slice(0, 100);
  const statusParam = params.get("status");
  const status: MasterDataStatus | "all" = statusParam === "active" || statusParam === "disabled" ? statusParam : "all";
  const sizeParam = Number(params.get("size"));
  const pageSize = (PAGE_SIZES as readonly number[]).includes(sizeParam) ? sizeParam : DEFAULT_PAGE_SIZE;
  const extraQuery = definition.query ?? {};
  const filterKey = JSON.stringify([kind, q, status, pageSize, extraQuery]);

  // 走过的每一页的游标：最后一个是当前页，第一页是 null。记在这条浏览记录的状态里，
  // 从编辑页回来（取消、保存、浏览器后退）时回到离开时的那一页；游标不进网址，刷新回第一页。
  const remembered = readListPage(location.state);
  const stack = remembered !== null && remembered.key === filterKey ? remembered.stack : [null];
  const cursor = stack[stack.length - 1] ?? null;
  const here = `${location.pathname}${location.search}`;
  const returnState: ReturnState = { from: here, listPage: { key: filterKey, stack } };
  const goToPage = (next: (string | null)[]): void => {
    const state: ReturnState = { listPage: { key: filterKey, stack: next } };
    void navigate(here, { replace: true, state });
  };

  // 滚动位置：离开列表时记下（只在内存里），带着翻页位置回来时恢复
  const restoreScroll = useRef(remembered !== null);
  useEffect(() => {
    const main = document.getElementById("main");
    return () => {
      if (main) scrollPositions.set(here, main.scrollTop);
    };
  }, [here]);

  const { state, reload } = useLoad<MasterPage<RecordOf<K>>>(`${filterKey}|${cursor ?? ""}`, (authToken) =>
    listMaster(kind, authToken, { ...extraQuery, status, sort: "code", limit: pageSize, ...(q !== "" ? { q } : {}), ...(cursor !== null ? { cursor } : {}) }),
  );

  // 行内操作成功后的最新内容：这一行留在原地，只换状态
  const [updated, setUpdated] = useState<Record<string, RecordOf<K>>>({});
  const rows = useMemo(() => (state.data?.items ?? []).map((row) => updated[row.id] ?? row), [state.data, updated]);
  const ready = state.status === "ready";
  useEffect(() => {
    if (!ready || !restoreScroll.current) return;
    restoreScroll.current = false;
    const main = document.getElementById("main");
    const saved = scrollPositions.get(here);
    if (main && saved !== undefined) main.scrollTop = saved;
  }, [ready, here]);
  const [focusRow, setFocusRow] = useState<string | null>(null);
  const toggle = useStatusToggle<K>({
    kind,
    objectName: () => objectName,
    objectPhrase: () => definition.objectPhrase,
    onChanged: (row) => {
      setUpdated((current) => ({ ...current, [row.id]: row }));
      setFocusRow(row.id);
    },
    ...(definition.inUse ? { inUse: definition.inUse } : {}),
    ...(definition.notReady ? { notReady: definition.notReady } : {}),
  });

  useEffect(() => {
    if (focusRow === null) return;
    document.querySelector<HTMLElement>(`[data-toggle-for="${focusRow}"]`)?.focus();
    setFocusRow(null);
  }, [focusRow, rows]);

  const setParam = (changes: Record<string, string | null>): void => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    setParams(next, { replace: true });
  };
  const filterParams = ["q", "status", ...(definition.filterParams ?? [])];
  const filtered = filterParams.some((key) => params.has(key));
  const clearFilters = (): void => setParam(Object.fromEntries(filterParams.map((key) => [key, null])));

  const columns: Column<RecordOf<K>>[] = [
    { key: "code", header: "编码", cell: (row) => <CodeLink kind={kind} id={row.id} code={row.code} state={returnState} /> },
    { key: "name", header: "名称", wrap: true, cell: (row) => <NameCell name={row.name} /> },
    ...definition.columns,
    { key: "status", header: "状态", cell: (row) => <StatusBadge {...MASTER_STATUS_BADGES[row.status]} /> },
  ];
  if (canManage) {
    columns.push({
      key: "actions",
      header: "操作",
      cell: (row) => {
        const label = rowLabel(row);
        const blocked = row.status === "disabled" ? (definition.blockedAction?.(row) ?? null) : null;
        const edit = (
          <LinkButton variant="text" size="sm" to={masterEditPath(kind, row.id)} state={returnState} aria-label={`编辑 ${label}`}>
            编辑
          </LinkButton>
        );
        return (
          <span className="table__actions">
            {blocked ? (
              <LinkButton variant="text" size="sm" to={blocked.to} aria-label={`${blocked.label} ${label}`} data-toggle-for={row.id}>
                {blocked.label}
              </LinkButton>
            ) : null}
            {edit}
            {!blocked && row.status === "active" && (
              <Button variant="text" size="sm" className="button--danger-text" aria-label={`停用 ${label}`} data-toggle-for={row.id} onClick={() => toggle.requestDisable(row)}>
                停用
              </Button>
            )}
            {!blocked && row.status === "disabled" && (
              <Button variant="text" size="sm" aria-label={`启用 ${label}`} data-toggle-for={row.id} loading={toggle.enablingId === row.id} loadingText="启用中…" onClick={() => void toggle.enable(row)}>
                启用
              </Button>
            )}
          </span>
        );
      },
    });
  }

  const tableState: TableState = state.status === "ready" ? "ready" : state.status === "forbidden" ? "forbidden" : state.status === "loading" ? "loading" : "error";
  const newButton = (
    <LinkButton variant="primary" to={definition.newPath} state={returnState}>
      <Icon name="plus" />
      {`新增${objectName}`}
    </LinkButton>
  );
  const empty = filtered ? (
    <StateBlock
      tone="neutral"
      title={`没有符合条件的${objectName}`}
      description="换个条件试试，或清空筛选。"
      action={
        <Button variant="secondary" onClick={clearFilters}>
          清空筛选
        </Button>
      }
    />
  ) : (
    <StateBlock tone="neutral" title={definition.empty.title} description={definition.empty.description} {...(canManage ? { action: newButton } : {})} />
  );

  return (
    <AppShell pageName={title} trail={[{ label: "主数据" }]}>
      <Page title={title} {...(canManage ? { action: newButton } : {})}>
        {definition.header}
        <FilterBar search={<SearchBox label="按编码或名称搜索" value={q} onSearch={(value) => setParam({ q: value })} />} paramNames={["status", ...(definition.filterParams ?? [])]} active={filtered} onClear={clearFilters}>
          <StatusFilter />
          {definition.filters}
        </FilterBar>
        {toggle.notice}
        <DataTable label={`${title}列表`} columns={columns} rows={rows} rowKey={(row) => row.id} state={tableState} refreshing={state.status === "loading" && state.data !== null} onRetry={reload} empty={empty} />
        <CursorPagination
          total={state.data?.total ?? null}
          pageSize={pageSize}
          onPageSizeChange={(size) => setParam({ size: size === DEFAULT_PAGE_SIZE ? null : String(size) })}
          hasPrevious={stack.length > 1}
          hasNext={state.status === "ready" && state.data.next_cursor !== null}
          busy={state.status === "loading"}
          onPrevious={() => goToPage(stack.slice(0, -1))}
          onNext={() => {
            const next = state.data?.next_cursor;
            if (next) goToPage([...stack, next]);
          }}
        />
        <Attributions sources={definition.footnotes ?? []} />
        {toggle.dialog}
      </Page>
    </AppShell>
  );
}
