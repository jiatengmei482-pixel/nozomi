/**
 * 区域列表（docs/design/pages/tenant-areas.md 第 2 节）：找和管；看形状进编辑页，这里不放地图。
 */
import { AREA_BIZ_TYPES, AREA_BIZ_TYPE_NAMES, type AreaBizType, type MasterDataStatus } from "@nozomi/domain";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { type AreaSummary, listAreas, listTenantCities } from "../../api/areas.ts";
import type { City, MasterPage } from "../../api/master.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { AppShell, Page } from "../../components/AppShell.tsx";
import { Button, LinkButton } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { type Column, CursorPagination, DataTable, PAGE_SIZES, type TableState } from "../../components/DataTable.tsx";
import { Dropdown } from "../../components/Dropdown.tsx";
import { FilterBar, SearchBox, useFilterParam } from "../../components/FilterBar.tsx";
import { SelectField } from "../../components/FormFields.tsx";
import { Icon } from "../../components/Icon.tsx";
import { StateBlock } from "../../components/States.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { AREA_NEW_PATH, areaEditPath } from "../../lib/area-paths.ts";
import { MASTER_STATUS_BADGES, displayName, formatLocalDateTime, otherNames } from "../../lib/master-display.ts";
import { useDocumentTitle } from "../../lib/use-document-title.ts";
import { useLoad } from "../../lib/use-load.ts";
import { useTenantCan } from "../../lib/use-master-access.ts";
import { type ReturnState, readListPage } from "../master/shared.tsx";
import { AreaMoreItems, useAreaActions } from "./useAreaActions.tsx";

const DEFAULT_PAGE_SIZE = 50;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cityLabel(city: City): string {
  return `${displayName(city.name).text}${city.status === "disabled" ? "（已停用）" : ""}`;
}

function Filters({ cities, citiesState }: { cities: readonly City[] | null; citiesState: string }) {
  const [city, setCity] = useFilterParam("city");
  const [biz, setBiz] = useFilterParam("biz");
  const [status, setStatus] = useFilterParam("status");
  const options = useMemo(() => (cities ?? []).map((entry) => ({ value: entry.id, label: cityLabel(entry), detail: entry.code, keywords: Object.values(entry.name).join(" ") })), [cities]);
  return (
    <>
      <Combobox inline label="城市" clearLabel="全部" placeholder="全部" options={options} value={city !== null && UUID_PATTERN.test(city) ? city : null} onChange={setCity} loading={cities === null && citiesState === "loading"} loadFailed={cities === null && citiesState === "error"} />
      <SelectField
        inline
        label="业务类型"
        value={(AREA_BIZ_TYPES as readonly string[]).includes(biz ?? "") ? (biz as AreaBizType) : "all"}
        options={[{ value: "all", label: "全部" }, ...AREA_BIZ_TYPES.map((value) => ({ value, label: AREA_BIZ_TYPE_NAMES[value] }))]}
        onChange={(value) => setBiz(value === "all" ? null : value)}
      />
      <SelectField
        inline
        label="状态"
        value={status === "active" || status === "disabled" ? status : "all"}
        options={[
          { value: "all", label: "全部" },
          { value: "active", label: "启用" },
          { value: "disabled", label: "已停用" },
        ]}
        onChange={(value) => setStatus(value === "all" ? null : value)}
      />
    </>
  );
}

export function AreaListPage() {
  const { portal, account } = usePortalSession();
  useDocumentTitle(`区域 · NOZOMI ${portal.name}`);
  const canRead = useTenantCan("area.read");
  const canManage = useTenantCan("area.manage");
  const location = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const cities = useLoad<City[]>("tenant-cities-all", canRead ? (token) => listTenantCities(token, "all") : null);

  const q = (params.get("q") ?? "").trim().slice(0, 100);
  const statusParam = params.get("status");
  const status: MasterDataStatus | "all" = statusParam === "active" || statusParam === "disabled" ? statusParam : "all";
  const cityParam = params.get("city");
  const city = cityParam !== null && UUID_PATTERN.test(cityParam) ? cityParam : null;
  const bizParam = params.get("biz");
  const biz = (AREA_BIZ_TYPES as readonly string[]).includes(bizParam ?? "") ? (bizParam as AreaBizType) : null;
  const sizeParam = Number(params.get("size"));
  const pageSize = (PAGE_SIZES as readonly number[]).includes(sizeParam) ? sizeParam : DEFAULT_PAGE_SIZE;
  const filterKey = JSON.stringify(["areas", q, status, city, biz, pageSize]);

  const remembered = readListPage(location.state);
  const stack = remembered !== null && remembered.key === filterKey ? remembered.stack : [null];
  const cursor = stack[stack.length - 1] ?? null;
  const here = `${location.pathname}${location.search}`;
  const returnState: ReturnState = { from: here, listPage: { key: filterKey, stack } };
  const goToPage = (next: (string | null)[]): void => {
    const state: ReturnState = { listPage: { key: filterKey, stack: next } };
    void navigate(here, { replace: true, state });
  };

  const { state, reload } = useLoad<MasterPage<AreaSummary>>(`${filterKey}|${cursor ?? ""}`, canRead
    ? (token) => listAreas(token, { status, limit: pageSize, ...(q !== "" ? { q } : {}), ...(city ? { city_id: city } : {}), ...(biz ? { biz_type: biz } : {}), ...(cursor !== null ? { cursor } : {}) })
    : null);

  const [updated, setUpdated] = useState<Record<string, AreaSummary>>({});
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const [focusRow, setFocusRow] = useState<string | null>(null);
  const rows = useMemo(() => (state.data?.items ?? []).filter((row) => !removed.has(row.id)).map((row) => updated[row.id] ?? row), [state.data, updated, removed]);
  const actions = useAreaActions({
    onChanged: (area) => {
      setUpdated((current) => ({ ...current, [area.id]: area }));
      setFocusRow(area.id);
    },
    onDeleted: (area) => {
      const index = rows.findIndex((row) => row.id === area.id);
      setRemoved((current) => new Set([...current, area.id]));
      setFocusRow(rows[index + 1]?.id ?? rows[index - 1]?.id ?? "");
    },
  });
  useEffect(() => {
    if (focusRow === null) return;
    const target = focusRow === "" ? document.querySelector<HTMLElement>(".page__action a") : (document.querySelector<HTMLElement>(`[data-area-row="${focusRow}"] .dropdown button`) ?? document.querySelector<HTMLElement>(`[data-area-row="${focusRow}"]`));
    target?.focus();
    setFocusRow(null);
  }, [focusRow, rows]);

  const filterParams = ["q", "status", "city", "biz"];
  const filtered = filterParams.some((key) => params.has(key));
  const setParam = (changes: Record<string, string | null>): void => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    setParams(next, { replace: true });
  };
  const clearFilters = (): void => setParam(Object.fromEntries(filterParams.map((key) => [key, null])));

  const newButton = (
    <LinkButton variant="primary" to={AREA_NEW_PATH} state={returnState}>
      <Icon name="plus" />
      新增区域
    </LinkButton>
  );

  if (account.status === "ready" && !canRead) {
    return (
      <AppShell pageName="区域" trail={[{ label: "商品配置" }]}>
        <Page title="区域">
          <StateBlock tone="neutral" title="你没有权限查看这里" description="需要的话，请联系你们的管理员开通。" />
        </Page>
      </AppShell>
    );
  }

  const cityStatus = (id: string): string | undefined => cities.state.data?.find((entry) => entry.id === id)?.status;
  const columns: Column<AreaSummary>[] = [
    {
      key: "name",
      header: "名称",
      wrap: true,
      cell: (row) => {
        const shown = displayName(row.name);
        const others = otherNames(row.name);
        return (
          <span className="table__names">
            <Link className="link" to={areaEditPath(row.id)} state={returnState} lang={shown.lang} data-area-row={row.id}>
              {shown.text}
            </Link>
            {others.length > 0 && <span className="table__other-names">{others.map((other) => other.text).join(" / ")}</span>}
          </span>
        );
      },
    },
    {
      key: "city",
      header: "城市",
      cell: (row) => (
        <span className="table__inline">
          <span lang={displayName(row.city.name).lang}>{displayName(row.city.name).text}</span>
          {(row.city.status === "disabled" || cityStatus(row.city_id) === "disabled") && <StatusBadge tone="neutral" label="城市已停用" />}
        </span>
      ),
    },
    { key: "biz", header: "业务类型", cell: (row) => <span className="tag">{AREA_BIZ_TYPE_NAMES[row.biz_type]}</span> },
    { key: "operate", header: "营运区", align: "end", cell: (row) => row.operate_polygon_count },
    { key: "forbid", header: "禁行区", align: "end", cell: (row) => row.forbid_polygon_count },
    { key: "status", header: "状态", cell: (row) => <StatusBadge {...MASTER_STATUS_BADGES[row.status]} /> },
    { key: "updated", header: "最近修改", cell: (row) => <span className="table__muted">{formatLocalDateTime(row.updated_at)}</span> },
  ];
  if (canManage) {
    columns.push({
      key: "actions",
      header: "操作",
      cell: (row) => {
        const name = displayName(row.name).text;
        return (
          <span className="table__actions" data-area-row={row.id}>
            <LinkButton variant="text" size="sm" to={areaEditPath(row.id)} state={returnState} aria-label={`编辑 ${name}`}>
              编辑
            </LinkButton>
            <Dropdown buttonClassName="button button--text button--sm" buttonContent="更多" label={`${name} 的更多操作`} align="end">
              <AreaMoreItems area={row} actions={actions} />
            </Dropdown>
          </span>
        );
      },
    });
  }

  const tableState: TableState = !canRead ? "loading" : state.status === "ready" ? "ready" : state.status === "forbidden" ? "forbidden" : state.status === "loading" ? "loading" : "error";
  const empty = filtered ? (
    <StateBlock
      tone="neutral"
      title="没有符合条件的区域"
      description="换个条件试试，或清空筛选。"
      action={
        <Button variant="secondary" onClick={clearFilters}>
          清空筛选
        </Button>
      }
    />
  ) : (
    <StateBlock tone="neutral" title="还没有区域" description="区域就是你提供服务的范围：在地图上画出去的地方（营运区）和不去的地方（禁行区）。有了区域，才能建商品、设价格。" {...(canManage ? { action: newButton } : {})} />
  );

  return (
    <AppShell pageName="区域" trail={[{ label: "商品配置" }]}>
      <Page title="区域" {...(canManage ? { action: newButton } : {})}>
        <FilterBar search={<SearchBox label="按名称搜索" value={q} onSearch={(value) => setParam({ q: value })} />} paramNames={["city", "biz", "status"]} active={filtered} onClear={clearFilters}>
          <Filters cities={cities.state.data} citiesState={cities.state.status} />
        </FilterBar>
        {actions.notice}
        <DataTable label="区域列表" columns={columns} rows={rows} rowKey={(row) => row.id} state={tableState} refreshing={state.status === "loading" && state.data !== null} onRetry={reload} empty={empty} />
        <CursorPagination
          total={state.data ? Math.max(0, state.data.total - removed.size) : null}
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
        {actions.dialog}
      </Page>
    </AppShell>
  );
}
