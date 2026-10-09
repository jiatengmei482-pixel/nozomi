/** 商品列表（docs/design/pages/tenant-products.md 第 2 节）：找一个商品，看它的品类、城市、上没上架、离上架还差什么。 */
import { PRODUCT_CATEGORY_NAMES, PRODUCT_STATUSES, PRODUCT_STATUS_NAMES, type ProductStatus, type ServiceCategory } from "@nozomi/domain";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { type Area, type TenantDashboardSummary, fetchTenantSummary, getArea, listTenantCities } from "../../api/areas.ts";
import type { City, MasterPage } from "../../api/master.ts";
import { type Brand, type ProductSummary, listBrands, listProducts } from "../../api/products.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { AppShell, Page } from "../../components/AppShell.tsx";
import { Button, LinkButton } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { type Column, CursorPagination, DataTable, PAGE_SIZES, type TableState } from "../../components/DataTable.tsx";
import { Dropdown } from "../../components/Dropdown.tsx";
import { FilterBar, SearchBox, useFilterParam } from "../../components/FilterBar.tsx";
import { SelectField } from "../../components/FormFields.tsx";
import { Icon, type IconName } from "../../components/Icon.tsx";
import { StateBlock } from "../../components/States.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { AREA_NEW_PATH } from "../../lib/area-paths.ts";
import { displayName, formatLocalDateTime, shortName } from "../../lib/master-display.ts";
import { PRODUCT_STATUS_BADGES, productName } from "../../lib/product-display.ts";
import { PRODUCT_NEW_PATH, productPath } from "../../lib/product-paths.ts";
import { useDocumentTitle } from "../../lib/use-document-title.ts";
import { useLoad } from "../../lib/use-load.ts";
import { useTenantCan } from "../../lib/use-master-access.ts";
import { type ReturnState, readListPage } from "../master/shared.tsx";
import { ProductMoreItems, useProductActions } from "./useProductActions.tsx";

const DEFAULT_PAGE_SIZE = 50;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CATEGORIES: readonly ServiceCategory[] = ["airport_transfer", "point_to_point", "charter"];
const uuidOrNull = (value: string | null): string | null => (value !== null && UUID_PATTERN.test(value) ? value : null);

function Filters({ cities, citiesState, brands }: { cities: readonly City[] | null; citiesState: string; brands: readonly Brand[] }) {
  const [category, setCategory] = useFilterParam("category");
  const [city, setCity] = useFilterParam("city");
  const [status, setStatus] = useFilterParam("status");
  const [brand, setBrand] = useFilterParam("brand");
  const options = useMemo(() => (cities ?? []).map((entry) => ({ value: entry.id, label: `${displayName(entry.name).text}${entry.status === "disabled" ? "（已停用）" : ""}`, detail: entry.code, keywords: Object.values(entry.name).join(" ") })), [cities]);
  return (
    <>
      <SelectField
        inline
        label="品类"
        value={(CATEGORIES as readonly string[]).includes(category ?? "") ? (category as ServiceCategory) : "all"}
        options={[{ value: "all", label: "全部" }, ...CATEGORIES.map((value) => ({ value, label: PRODUCT_CATEGORY_NAMES[value] }))]}
        onChange={(value) => setCategory(value === "all" ? null : value)}
      />
      <Combobox inline label="城市" clearLabel="全部" placeholder="全部" options={options} value={uuidOrNull(city)} onChange={setCity} loading={cities === null && citiesState === "loading"} loadFailed={cities === null && citiesState === "error"} />
      <SelectField
        inline
        label="状态"
        value={(PRODUCT_STATUSES as readonly string[]).includes(status ?? "") ? (status as ProductStatus) : "all"}
        options={[{ value: "all", label: "全部" }, ...PRODUCT_STATUSES.map((value) => ({ value, label: PRODUCT_STATUS_NAMES[value] }))]}
        onChange={(value) => setStatus(value === "all" ? null : value)}
      />
      {brands.length > 1 && (
        <SelectField
          inline
          label="子品牌"
          value={brands.some((entry) => entry.id === brand) ? (brand as string) : "all"}
          options={[{ value: "all", label: "全部" }, ...brands.map((entry) => ({ value: entry.id, label: `${entry.name}（${entry.currency}）` }))]}
          onChange={(value) => setBrand(value === "all" ? null : value)}
        />
      )}
    </>
  );
}

/** 「上架准备」一格：不点进去就知道卡在哪。 */
function readiness(row: ProductSummary): { icon: IconName; tone: "warning" | "info" | "success"; text: string } {
  if (row.check.failed_required > 0) return { icon: "alert-triangle", tone: "warning", text: `还差 ${row.check.failed_required} 项` };
  if (row.check.unavailable_required > 0) return { icon: "clock", tone: "info", text: `等待开放 ${row.check.unavailable_required} 步` };
  return { icon: "check", tone: "success", text: row.status === "published" ? "已满足" : "可以上架" };
}

export function ProductListPage() {
  const { portal, account } = usePortalSession();
  useDocumentTitle(`商品 · NOZOMI ${portal.name}`);
  const canRead = useTenantCan("product.read");
  const canManage = useTenantCan("product.manage");
  const canManageAreas = useTenantCan("area.manage");
  const canReadAreas = useTenantCan("area.read");
  const location = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const cities = useLoad<City[]>("tenant-cities-all", canRead ? (token) => listTenantCities(token, "all") : null);
  const brands = useLoad<Brand[]>("tenant-brands", canRead ? listBrands : null);

  const q = (params.get("q") ?? "").trim().slice(0, 100);
  const statusParam = params.get("status");
  const status = (PRODUCT_STATUSES as readonly string[]).includes(statusParam ?? "") ? (statusParam as ProductStatus) : null;
  const categoryParam = params.get("category");
  const category = (CATEGORIES as readonly string[]).includes(categoryParam ?? "") ? (categoryParam as ServiceCategory) : null;
  const city = uuidOrNull(params.get("city"));
  const brand = uuidOrNull(params.get("brand"));
  const area = uuidOrNull(params.get("area"));
  const sizeParam = Number(params.get("size"));
  const pageSize = (PAGE_SIZES as readonly number[]).includes(sizeParam) ? sizeParam : DEFAULT_PAGE_SIZE;
  const filterKey = JSON.stringify(["products", q, status, category, city, brand, area, pageSize]);

  const remembered = readListPage(location.state);
  const stack = remembered !== null && remembered.key === filterKey ? remembered.stack : [null];
  const cursor = stack[stack.length - 1] ?? null;
  const here = `${location.pathname}${location.search}`;
  const returnState: ReturnState = { from: here, listPage: { key: filterKey, stack } };
  const goToPage = (next: (string | null)[]): void => {
    const state: ReturnState = { listPage: { key: filterKey, stack: next } };
    void navigate(here, { replace: true, state });
  };

  const { state, reload } = useLoad<MasterPage<ProductSummary>>(`${filterKey}|${cursor ?? ""}`, canRead
    ? (token) => listProducts(token, { limit: pageSize, ...(q !== "" ? { q } : {}), ...(status ? { status } : {}), ...(category ? { category } : {}), ...(city ? { city_id: city } : {}), ...(brand ? { brand_id: brand } : {}), ...(area ? { area_id: area } : {}), ...(cursor !== null ? { cursor } : {}) })
    : null);
  const areaFilter = useLoad<Area>(`product-area-filter:${area ?? ""}`, area !== null && canRead ? (token) => getArea(token, area) : null);

  const filterParams = ["q", "category", "city", "status", "brand", "area"];
  const filtered = filterParams.some((key) => params.has(key));
  const noProducts = !filtered && state.status === "ready" && state.data.items.length === 0;
  const summary = useLoad<TenantDashboardSummary>("tenant-summary", noProducts && canReadAreas ? fetchTenantSummary : null);
  const noAreas = summary.state.data?.areas != null && summary.state.data.areas.active + summary.state.data.areas.disabled === 0;

  const [updated, setUpdated] = useState<Record<string, Partial<ProductSummary>>>({});
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const [focusRow, setFocusRow] = useState<string | null>(null);
  const rows = useMemo(() => (state.data?.items ?? []).filter((row) => !removed.has(row.id)).map((row) => ({ ...row, ...updated[row.id] })), [state.data, updated, removed]);
  const actions = useProductActions({
    onUnpublished: (product) => {
      setUpdated((current) => ({ ...current, [product.id]: { status: product.status, version: product.version, updated_at: product.updated_at } }));
      setFocusRow(product.id);
    },
    onDeleted: (product) => {
      const index = rows.findIndex((row) => row.id === product.id);
      setRemoved((current) => new Set([...current, product.id]));
      setFocusRow(rows[index + 1]?.id ?? "");
    },
    onStale: () => {
      setUpdated({});
      reload();
    },
  });
  useEffect(() => {
    if (focusRow === null) return;
    const row = focusRow === "" ? null : document.querySelector<HTMLElement>(`[data-product-row="${focusRow}"]`);
    const target = row === null ? document.querySelector<HTMLElement>(".page__action a") : removed.size > 0 && !updated[focusRow] ? row : (row.closest("tr")?.querySelector<HTMLElement>(".dropdown button") ?? row);
    target?.focus();
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
  const clearFilters = (): void => setParam(Object.fromEntries(filterParams.map((key) => [key, null])));

  const shell = (content: React.ReactNode, action?: React.ReactNode): React.ReactNode => (
    <AppShell pageName="商品" trail={[{ label: "商品配置" }]}>
      <Page title="商品" {...(action ? { action } : {})}>
        {content}
      </Page>
    </AppShell>
  );
  if (account.status === "ready" && !canRead) return shell(<StateBlock tone="neutral" title="你没有权限查看这里" description="需要的话，请联系你们的管理员开通。" />);

  const newButton = (
    <LinkButton variant="primary" to={PRODUCT_NEW_PATH} state={returnState}>
      <Icon name="plus" />
      新建商品
    </LinkButton>
  );
  const multipleBrands = (brands.state.data?.length ?? 0) > 1;
  const columns: Column<ProductSummary>[] = [
    {
      key: "product",
      header: "商品",
      wrap: true,
      cell: (row) => {
        const shown = productName(row);
        return (
          <span className="table__names">
            <Link className={shown.unnamed ? "link product-name product-name--unnamed" : "link product-name"} to={productPath(row.id)} state={returnState} lang={shown.lang} title={shown.text} data-product-row={row.id}>
              {shown.text}
            </Link>
            <span className="product-code">{row.code}</span>
          </span>
        );
      },
    },
    { key: "category", header: "品类", cell: (row) => <span className="tag">{PRODUCT_CATEGORY_NAMES[row.category]}</span> },
    {
      key: "city",
      header: "城市",
      cell: (row) => (
        <span className="table__inline">
          <span>{row.city ? displayName(row.city.name).text : "—"}</span>
          {row.city?.status === "disabled" && <StatusBadge tone="neutral" label="城市已停用" />}
        </span>
      ),
    },
    {
      key: "poi",
      header: "接送点",
      cell: (row) =>
        row.poi ? (
          <span className="table__names">
            <span className="table__inline">
              <span>{displayName(row.poi.name).text}</span>
              {row.poi.status === "disabled" && <StatusBadge tone="neutral" label="已停用" />}
            </span>
            <span className="product-code">{row.poi.code}</span>
          </span>
        ) : (
          "—"
        ),
    },
    ...(multipleBrands ? [{ key: "brand", header: "子品牌", cell: (row: ProductSummary) => (row.brand ? `${row.brand.name}（${row.brand.currency}）` : "—") }] : []),
    { key: "areas", header: "区域", align: "end", cell: (row) => row.area_count },
    { key: "groups", header: "车型组", align: "end", cell: (row) => row.vehicle_group_count },
    {
      key: "ready",
      header: "上架准备",
      cell: (row) => {
        const ready = readiness(row);
        return (
          <Link className={`readiness readiness--${ready.tone}`} to={productPath(row.id, "publish")} state={returnState} aria-label={`${productName(row).text} 的上架检查：${ready.text}`}>
            <Icon name={ready.icon} />
            {ready.text}
          </Link>
        );
      },
    },
    { key: "status", header: "状态", cell: (row) => <StatusBadge {...PRODUCT_STATUS_BADGES[row.status]} /> },
    { key: "updated", header: "最近修改", cell: (row) => <span className="table__muted">{formatLocalDateTime(row.updated_at)}</span> },
  ];
  if (canManage) {
    columns.push({
      key: "actions",
      header: "操作",
      cell: (row) => {
        const name = shortName(productName(row).text);
        return (
          <span className="table__actions">
            <LinkButton variant="text" size="sm" to={productPath(row.id)} state={returnState} aria-label={`编辑 ${name}`}>
              编辑
            </LinkButton>
            <Dropdown buttonClassName="button button--text button--sm" buttonContent="更多" label={`${name} 的更多操作`} align="end">
              <ProductMoreItems product={row} actions={actions} withCheck />
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
      title="没有符合条件的商品"
      description="换个条件试试，或清空筛选。"
      action={
        <Button variant="secondary" onClick={clearFilters}>
          清空筛选
        </Button>
      }
    />
  ) : noAreas ? (
    <StateBlock
      tone="neutral"
      title="先建区域，再建商品"
      description={`商品要选它在哪些区域里接单。你们还没有区域，请先去画一个。${canManageAreas ? "" : "请联系你们的管理员。"}`}
      {...(canManageAreas
        ? {
            action: (
              <LinkButton variant="primary" to={AREA_NEW_PATH}>
                新增区域
              </LinkButton>
            ),
          }
        : {})}
    />
  ) : (
    <StateBlock tone="neutral" title="还没有商品" description="商品就是你在一个城市卖的一类服务，例如「羽田机场接送」「东京包车」。建好商品，再给它设价格。" {...(canManage ? { action: newButton } : {})} />
  );
  const areaLabel = area === null ? null : areaFilter.state.status === "ready" ? displayName(areaFilter.state.data.name).text : areaFilter.state.status === "loading" ? "…" : "已删除的区域";

  return shell(
    <>
      {actions.notice}
      <FilterBar search={<SearchBox label="按标题或商品编号搜索" value={q} onSearch={(value) => setParam({ q: value })} />} paramNames={["category", "city", "status", "brand"]} active={filtered} onClear={clearFilters}>
        <Filters cities={cities.state.data} citiesState={cities.state.status} brands={brands.state.data ?? []} />
      </FilterBar>
      {areaLabel !== null && (
        <p className="filter-chips">
          <span className="filter-chip" title={`区域：${areaLabel}`}>
            <span className="filter-chip__text">{`区域：${areaLabel}`}</span>
            <button type="button" className="filter-chip__remove" aria-label={`去掉条件「区域：${areaLabel}」`} onClick={() => setParam({ area: null })}>
              <Icon name="x" />
            </button>
          </span>
        </p>
      )}
      <DataTable label="商品列表" columns={columns} rows={rows} rowKey={(row) => row.id} state={tableState} refreshing={state.status === "loading" && state.data !== null} onRetry={reload} empty={empty} />
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
    </>,
    canManage ? newButton : undefined,
  );
}
