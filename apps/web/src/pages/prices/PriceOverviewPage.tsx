/**
 * 菜单里的「价格规则」（docs/design/pages/tenant-prices.md 第 8 节）：一张按价格情况列出所有商品的表，点一个就进它的第 ③ 步。
 * 数据一次取完（最多 1,000 个商品），搜索、筛选、分页都在浏览器里做；条件照常写进网址。
 */
import { INVENTORY_MODE_NAMES, PRODUCT_CATEGORY_NAMES, PRODUCT_STATUSES, PRODUCT_STATUS_NAMES, type ProductStatus, type ServiceCategory } from "@nozomi/domain";
import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { type PriceOverview, type PriceOverviewItem, getPriceOverview } from "../../api/prices.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { AppShell, Page } from "../../components/AppShell.tsx";
import { Button, LinkButton } from "../../components/Button.tsx";
import { type Column, CursorPagination, DataTable, PAGE_SIZES, type TableState } from "../../components/DataTable.tsx";
import { Dropdown } from "../../components/Dropdown.tsx";
import { FilterBar, SearchBox, useFilterParam } from "../../components/FilterBar.tsx";
import { SelectField } from "../../components/FormFields.tsx";
import { Icon } from "../../components/Icon.tsx";
import { StateBlock } from "../../components/States.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { displayName, shortName } from "../../lib/master-display.ts";
import { PRODUCT_STATUS_BADGES, productName } from "../../lib/product-display.ts";
import { PRODUCT_NEW_PATH, inventoryPath, pricePath } from "../../lib/product-paths.ts";
import { useDocumentTitle } from "../../lib/use-document-title.ts";
import { useLoad } from "../../lib/use-load.ts";
import { useTenantCan } from "../../lib/use-master-access.ts";

export const PRICE_OVERVIEW_PATH = "/price-rules";
const DEFAULT_PAGE_SIZE = 50;
const OVERVIEW_LIMIT = 1000;
const CATEGORIES: readonly ServiceCategory[] = ["airport_transfer", "point_to_point", "charter"];

/** 「还没有设价格」：没有可用的价格，而且商品不是已下架的（和首页那个数的算法一致）。 */
export function lacksPrice(item: Pick<PriceOverviewItem, "has_active_price" | "status">): boolean {
  return !item.has_active_price && item.status !== "unpublished";
}

function Filters() {
  const [category, setCategory] = useFilterParam("category");
  const [status, setStatus] = useFilterParam("status");
  return (
    <>
      <SelectField
        inline
        label="品类"
        value={(CATEGORIES as readonly string[]).includes(category ?? "") ? (category as ServiceCategory) : "all"}
        options={[{ value: "all", label: "全部" }, ...CATEGORIES.map((value) => ({ value, label: PRODUCT_CATEGORY_NAMES[value] }))]}
        onChange={(value) => setCategory(value === "all" ? null : value)}
      />
      <SelectField
        inline
        label="状态"
        value={(PRODUCT_STATUSES as readonly string[]).includes(status ?? "") ? (status as ProductStatus) : "all"}
        options={[{ value: "all", label: "全部" }, ...PRODUCT_STATUSES.map((value) => ({ value, label: PRODUCT_STATUS_NAMES[value] }))]}
        onChange={(value) => setStatus(value === "all" ? null : value)}
      />
    </>
  );
}

export function PriceOverviewPage() {
  const { portal, account } = usePortalSession();
  useDocumentTitle(`价格规则 · NOZOMI ${portal.name}`);
  const canRead = useTenantCan("product.read");
  const canManage = useTenantCan("product.manage");
  const [params, setParams] = useSearchParams();
  const loaded = useLoad<PriceOverview & { items: PriceOverviewItem[] }>("price-overview", canRead ? getPriceOverview : null);

  const q = (params.get("q") ?? "").trim().slice(0, 100);
  const statusParam = params.get("status");
  const status = (PRODUCT_STATUSES as readonly string[]).includes(statusParam ?? "") ? (statusParam as ProductStatus) : null;
  const categoryParam = params.get("category");
  const category = (CATEGORIES as readonly string[]).includes(categoryParam ?? "") ? (categoryParam as ServiceCategory) : null;
  const unpricedOnly = params.get("priced") === "no";
  const noStockOnly = params.get("stock") === "none";
  const sizeParam = Number(params.get("size"));
  const pageSize = (PAGE_SIZES as readonly number[]).includes(sizeParam) ? sizeParam : DEFAULT_PAGE_SIZE;
  const setParam = (changes: Record<string, string | null>): void => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    // 条件变了回到第一页
    if (!("page" in changes)) next.delete("page");
    setParams(next, { replace: true });
  };

  const shell = (content: ReactNode): ReactNode => (
    <AppShell pageName="价格规则" trail={[{ label: "商品配置" }]}>
      <Page title="价格规则">
        <p className="page-intro">价格是按商品设的。选一个商品，进去设它的价格、调价规则，或看价格日历。</p>
        {content}
      </Page>
    </AppShell>
  );
  if (account.status === "ready" && !canRead) return shell(<StateBlock tone="neutral" title="你没有权限查看这里" description="需要的话，请联系你们的管理员开通。" />);

  const all = loaded.state.data?.items ?? [];
  const needle = q.toLowerCase();
  const matched = all.filter(
    (item) =>
      (status === null || item.status === status) &&
      (category === null || item.category === category) &&
      (!unpricedOnly || lacksPrice(item)) &&
      (!noStockOnly || (item.no_inventory_ahead && item.status === "published")) &&
      (needle === "" ||
        item.code.toLowerCase().includes(needle) ||
        Object.values(item.title).some((text) => typeof text === "string" && text.toLowerCase().includes(needle))),
  );
  const pages = Math.max(1, Math.ceil(matched.length / pageSize));
  const pageParam = Number(params.get("page"));
  const page = Number.isInteger(pageParam) && pageParam >= 1 && pageParam <= pages ? pageParam : 1;
  const rows = matched.slice((page - 1) * pageSize, page * pageSize);
  const filtered = q !== "" || status !== null || category !== null || unpricedOnly || noStockOnly;
  const onlyUnpriced = unpricedOnly && !noStockOnly && q === "" && status === null && category === null;

  const columns: Column<PriceOverviewItem>[] = [
    {
      key: "product",
      header: "商品",
      wrap: true,
      cell: (row) => {
        const shown = productName(row);
        return (
          <span className="table__names">
            <Link className={shown.unnamed ? "link product-name product-name--unnamed" : "link product-name"} to={pricePath(row.product_id)} lang={shown.lang} title={shown.text}>
              {shown.text}
            </Link>
            <span className="product-code">{row.code}</span>
          </span>
        );
      },
    },
    { key: "category", header: "品类", cell: (row) => <span className="tag">{PRODUCT_CATEGORY_NAMES[row.category]}</span> },
    { key: "city", header: "城市", cell: (row) => displayName(row.city.name).text },
    { key: "status", header: "状态", cell: (row) => <StatusBadge {...PRODUCT_STATUS_BADGES[row.status]} /> },
    {
      key: "price",
      header: "价格",
      wrap: true,
      cell: (row) => {
        const name = shortName(productName(row).text);
        const view =
          !row.has_active_price && row.price_rule_count === 0
            ? { tone: "warning", icon: "alert-triangle" as const, text: "还没有设价格", note: null }
            : !row.has_active_price
              ? { tone: "plain", icon: "alert-triangle" as const, text: "没有可用的价格", note: `有 ${row.price_rule_count} 条，都停用或过期了` }
              : row.coverage.missing > 0
                ? { tone: "warning", icon: "alert-triangle" as const, text: `${row.coverage.total} 个组合里 ${row.coverage.missing} 个没有价格`, note: null }
                : { tone: "success", icon: "check" as const, text: `${row.active_price_rule_count} 条生效中的价格`, note: null };
        return (
          <Link className={`price-overview__price price-overview__price--${view.tone}`} to={pricePath(row.product_id)} aria-label={`${name} 的价格：${view.text}${view.note ? `，${view.note}` : ""}`}>
            <Icon name={view.icon} />
            <span>
              {view.text}
              {view.note && <span className="price-overview__note">{view.note}</span>}
            </span>
          </Link>
        );
      },
    },
    {
      key: "stock",
      header: "库存",
      wrap: true,
      cell: (row) =>
        row.no_inventory_ahead ? (
          <Link className="price-overview__price price-overview__price--warning" to={inventoryPath(row.product_id)} aria-label={`${shortName(productName(row).text)} 的库存：限量，从今天起没有库存`}>
            <Icon name="alert-triangle" />
            <span>从今天起没有库存</span>
          </Link>
        ) : (
          INVENTORY_MODE_NAMES[row.inventory_mode]
        ),
    },
    { key: "adjust", header: "调价规则", cell: (row) => (row.enabled_adjust_rule_count === 0 ? "—" : <span className="price-overview__count">{`${row.enabled_adjust_rule_count} 条启用`}</span>) },
    {
      key: "actions",
      header: "操作",
      cell: (row) => {
        const name = shortName(productName(row).text);
        return (
          <span className="table__actions">
            <LinkButton variant="text" size="sm" to={pricePath(row.product_id)} aria-label={`${canManage ? "设价格" : "看价格"}：${name}`}>
              {canManage ? "设价格" : "看价格"}
            </LinkButton>
            <Dropdown buttonClassName="button button--text button--sm" buttonContent="更多" label={`${name} 的更多操作`} align="end">
              <Link role="menuitem" className="menu-item" to={pricePath(row.product_id, "adjust")}>
                <span className="menu-item__text">调价规则</span>
              </Link>
              <Link role="menuitem" className="menu-item" to={pricePath(row.product_id, "calendar")}>
                <span className="menu-item__text">价格日历</span>
              </Link>
              <Link role="menuitem" className="menu-item" to={inventoryPath(row.product_id)}>
                <span className="menu-item__text">库存</span>
              </Link>
            </Dropdown>
          </span>
        );
      },
    },
  ];

  const state = loaded.state;
  const tableState: TableState = !canRead ? "loading" : state.status === "ready" ? "ready" : state.status === "forbidden" ? "forbidden" : state.status === "loading" ? "loading" : "error";
  const clearFilters = (): void => setParam({ q: null, status: null, category: null, priced: null, stock: null });
  const empty = onlyUnpriced && all.length > 0 ? (
    <StateBlock
      tone="neutral"
      title="所有商品都设了价格"
      action={
        <Button variant="secondary" onClick={() => setParam({ priced: null })}>
          看全部商品
        </Button>
      }
    />
  ) : filtered ? (
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
  ) : (
    <StateBlock
      tone="neutral"
      title="先建商品，再设价格"
      description="价格是按商品设的。你们还没有商品，请先建一个。"
      {...(canManage
        ? {
            action: (
              <LinkButton variant="primary" to={PRODUCT_NEW_PATH}>
                新建商品
              </LinkButton>
            ),
          }
        : {})}
    />
  );

  return shell(
    <>
      <FilterBar search={<SearchBox label="按标题或商品编号搜索" value={q} onSearch={(value) => setParam({ q: value })} />} paramNames={["category", "status"]} active={filtered} onClear={clearFilters}>
        <Filters />
      </FilterBar>
      <label className="choice price-overview__only">
        <input type="checkbox" checked={unpricedOnly} onChange={(event) => setParam({ priced: event.target.checked ? "no" : null })} />
        <span className="choice__text">只看还没有设价格的</span>
      </label>
      {noStockOnly && (
        <p className="filter-chips">
          <span className="filter-chip" title="已上架、从今天起没有库存">
            <span className="filter-chip__text">已上架、从今天起没有库存</span>
            <button type="button" className="filter-chip__remove" aria-label="去掉条件「已上架、从今天起没有库存」" onClick={() => setParam({ stock: null })}>
              <Icon name="x" />
            </button>
          </span>
        </p>
      )}
      <div className="price-overview">
        <DataTable label="各商品的价格情况" columns={columns} rows={rows} rowKey={(row) => row.product_id} state={tableState} refreshing={state.status === "loading" && state.data !== null} onRetry={loaded.reload} empty={empty} />
      </div>
      <CursorPagination
        total={state.data ? matched.length : null}
        pageSize={pageSize}
        onPageSizeChange={(size) => setParam({ size: size === DEFAULT_PAGE_SIZE ? null : String(size) })}
        hasPrevious={page > 1}
        hasNext={page < pages}
        onPrevious={() => setParam({ page: page - 1 === 1 ? null : String(page - 1) })}
        onNext={() => setParam({ page: String(page + 1) })}
      />
      {all.length >= OVERVIEW_LIMIT && <p className="page-intro">只列出最近改过的 1,000 个商品。</p>}
    </>,
  );
}
