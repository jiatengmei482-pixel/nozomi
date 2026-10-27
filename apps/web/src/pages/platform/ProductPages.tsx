/**
 * 运营后台只读查看供应商的商品（docs/design/pages/platform-products.md，ADR 0021）：列表、详情，以及供应商详情页里的「商品」一栏。
 * 详情的各步骤用的是供应商后台同一组组件的只读模式（ProductSteps + 平台的数据来源），页面上没有任何修改的入口。
 */
import { PRODUCT_CATEGORY_NAMES, PRODUCT_STATUSES, PRODUCT_STATUS_NAMES, type ProductStatus, SERVICE_CATEGORIES, type ServiceCategory } from "@nozomi/domain";
import { type ReactNode, useEffect, useMemo, useRef } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import type { MasterPage } from "../../api/master.ts";
import { listAllTenants } from "../../api/platform.ts";
import { type PlatformProductDetail, type PlatformProductSummary, type ProductTenantRef, getPlatformProduct, listPlatformProducts } from "../../api/platform-products.ts";
import type { Tenant } from "../../api/types.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert } from "../../components/Alert.tsx";
import { AppShell, Page } from "../../components/AppShell.tsx";
import { Attributions, placeSources } from "../../components/Attribution.tsx";
import { Button, LinkButton } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { type Column, CursorPagination, DataTable, PAGE_SIZES, type TableState } from "../../components/DataTable.tsx";
import { FilterBar, SearchBox, useFilterParam } from "../../components/FilterBar.tsx";
import { CopyButton, SelectField } from "../../components/FormFields.tsx";
import { Icon } from "../../components/Icon.tsx";
import { Skeleton, StateBlock } from "../../components/States.tsx";
import { StatusBadge, TENANT_STATUS_BADGES } from "../../components/StatusBadge.tsx";
import { displayName, formatLocalDateTime } from "../../lib/master-display.ts";
import { PRODUCT_STATUS_BADGES, brandLabel, productName } from "../../lib/product-display.ts";
import { PRODUCT_STEP_SLUGS, type ProductStepSlug } from "../../lib/product-paths.ts";
import { PLATFORM_PRODUCT_LIST_PATH, tenantPath } from "../../lib/platform-paths.ts";
import { useDocumentTitle } from "../../lib/use-document-title.ts";
import { useCityOptions } from "../../lib/use-city-options.ts";
import { useLoad } from "../../lib/use-load.ts";
import { usePlatformCan } from "../../lib/use-master-access.ts";
import { type ReturnState, readListPage } from "../master/shared.tsx";
import type { ProductFrame } from "../products/frame.ts";
import { PRODUCT_STEP_TITLES, ProductSteps, checkContextOf } from "../products/ProductSteps.tsx";
import { platformProductSource } from "../products/source.ts";

const DEFAULT_PAGE_SIZE = 50;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOrNull = (value: string | null): string | null => (value !== null && UUID_PATTERN.test(value) ? value : null);
const NO_ACCESS = <StateBlock tone="neutral" title="你没有权限查看这里" description="需要的话，请联系管理员开通。" />;
/** 网址参数里「有没有可用价格」的写法 → 接口的写法。 */
const PRICED: Readonly<Record<string, "true" | "false">> = { yes: "true", no: "false" };

/** 「可用价格」一格：有几条；没有的写「没有价格」，已上架的再写出后果。 */
function PriceCell({ row }: { row: PlatformProductSummary }) {
  if (row.has_active_price) {
    return (
      <span className="readiness readiness--success">
        <Icon name="check" />
        {`有 ${row.active_price_rule_count} 条`}
      </span>
    );
  }
  return (
    <span className="table__names">
      <span className="readiness readiness--warning">
        <Icon name="alert-triangle" />
        没有价格
      </span>
      {row.status === "published" && <span className="table__muted">已上架，客人询价时报不出价</span>}
    </span>
  );
}

function TenantCell({ tenant, canOpen }: { tenant: ProductTenantRef; canOpen: boolean }) {
  return (
    <span className="table__inline">
      {canOpen ? (
        <Link className="link" to={tenantPath(tenant.id)}>
          {tenant.name}
        </Link>
      ) : (
        <span>{tenant.name}</span>
      )}
      {tenant.status === "suspended" && <StatusBadge {...TENANT_STATUS_BADGES.suspended} />}
    </span>
  );
}

function Filters({ fixedTenant, tenants, tenantsState, cityOptions, citiesState, citiesEmptyText }: { fixedTenant: boolean; tenants: readonly Tenant[] | null; tenantsState: string | null; cityOptions: { value: string; label: string; detail?: string; keywords?: string }[]; citiesState: string; citiesEmptyText: string }) {
  const [tenant, setTenant] = useFilterParam("tenant");
  const [city, setCity] = useFilterParam("city");
  const [category, setCategory] = useFilterParam("category");
  const [status, setStatus] = useFilterParam("status");
  const [priced, setPriced] = useFilterParam("priced");
  const tenantOptions = useMemo(() => (tenants ?? []).map((entry) => ({ value: entry.id, label: `${entry.name}${entry.status === "suspended" ? "（已暂停）" : ""}`, keywords: entry.name })), [tenants]);
  return (
    <>
      {!fixedTenant && tenantsState !== null && (
        <Combobox inline label="供应商" clearLabel="全部" placeholder="全部" options={tenantOptions} value={uuidOrNull(tenant)} onChange={setTenant} loading={tenants === null && tenantsState === "loading"} loadFailed={tenants === null && tenantsState === "error"} />
      )}
      <Combobox inline label="城市" clearLabel="全部" placeholder="全部" options={cityOptions} value={uuidOrNull(city)} onChange={setCity} loading={cityOptions.length === 0 && citiesState === "loading"} loadFailed={cityOptions.length === 0 && citiesState === "error"} emptyText={citiesEmptyText} />
      <SelectField
        inline
        label="品类"
        value={(SERVICE_CATEGORIES as readonly string[]).includes(category ?? "") ? (category as ServiceCategory) : "all"}
        options={[{ value: "all", label: "全部" }, ...SERVICE_CATEGORIES.map((value) => ({ value, label: PRODUCT_CATEGORY_NAMES[value] }))]}
        onChange={(value) => setCategory(value === "all" ? null : value)}
      />
      <SelectField
        inline
        label="状态"
        value={(PRODUCT_STATUSES as readonly string[]).includes(status ?? "") ? (status as ProductStatus) : "all"}
        options={[{ value: "all", label: "全部" }, ...PRODUCT_STATUSES.map((value) => ({ value, label: PRODUCT_STATUS_NAMES[value] }))]}
        onChange={(value) => setStatus(value === "all" ? null : value)}
      />
      <SelectField
        inline
        label="可用价格"
        value={priced === "yes" || priced === "no" ? priced : "all"}
        options={[
          { value: "all", label: "全部" },
          { value: "yes", label: "有" },
          { value: "no", label: "没有" },
        ]}
        onChange={(value) => setPriced(value === "all" ? null : value)}
      />
    </>
  );
}

/**
 * 商品表：筛选条（条件写进网址）+ 表格 + 翻页。运营后台的「商品」列表和供应商详情页的「商品」一栏共用；
 * 给了 `fixedTenant` 就只看这一家，没有「供应商」这一列和这个筛选条件。
 */
export function PlatformProductTable({ fixedTenant }: { fixedTenant?: { id: string; name: string } }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const canSeeTenants = usePlatformCan("tenant.read");
  const tenants = useLoad<{ items: Tenant[]; truncated: boolean }>("platform-product-tenants", !fixedTenant && canSeeTenants ? listAllTenants : null);
  const cities = useCityOptions();
  const cityOptions = useMemo(() => (cities.state.data ?? []).map((entry) => ({ value: entry.id, label: displayName(entry.name).text, detail: entry.code, keywords: Object.values(entry.name).join(" ") })), [cities.state.data]);

  const q = (params.get("q") ?? "").trim().slice(0, 100);
  const tenant = fixedTenant?.id ?? uuidOrNull(params.get("tenant"));
  const city = uuidOrNull(params.get("city"));
  const categoryParam = params.get("category");
  const category = (SERVICE_CATEGORIES as readonly string[]).includes(categoryParam ?? "") ? (categoryParam as ServiceCategory) : null;
  const statusParam = params.get("status");
  const status = (PRODUCT_STATUSES as readonly string[]).includes(statusParam ?? "") ? (statusParam as ProductStatus) : null;
  const priced = PRICED[params.get("priced") ?? ""] ?? null;
  const brand = uuidOrNull(params.get("brand"));
  const sizeParam = Number(params.get("size"));
  const pageSize = (PAGE_SIZES as readonly number[]).includes(sizeParam) ? sizeParam : DEFAULT_PAGE_SIZE;
  const filterKey = JSON.stringify(["platform-products", q, tenant, city, category, status, priced, brand, pageSize]);

  const remembered = readListPage(location.state);
  const stack = remembered !== null && remembered.key === filterKey ? remembered.stack : [null];
  const cursor = stack[stack.length - 1] ?? null;
  const here = `${location.pathname}${location.search}`;
  const returnState: ReturnState = { from: here, listPage: { key: filterKey, stack } };
  const goToPage = (next: (string | null)[]): void => {
    const state: ReturnState = { listPage: { key: filterKey, stack: next } };
    void navigate(here, { replace: true, state });
  };
  const { state, reload } = useLoad<MasterPage<PlatformProductSummary>>(`${filterKey}|${cursor ?? ""}`, (token) =>
    listPlatformProducts(token, {
      limit: pageSize,
      ...(q !== "" ? { q } : {}),
      ...(tenant !== null ? { tenant_id: tenant } : {}),
      ...(city !== null ? { city_id: city } : {}),
      ...(category !== null ? { category } : {}),
      ...(status !== null ? { status } : {}),
      ...(priced !== null ? { has_active_price: priced } : {}),
      ...(brand !== null ? { brand_id: brand } : {}),
      ...(cursor !== null ? { cursor } : {}),
    }),
  );

  const filterParams = fixedTenant ? ["q", "city", "category", "status", "priced", "brand"] : ["q", "tenant", "city", "category", "status", "priced", "brand"];
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
  const rows = state.data?.items ?? [];

  // 子品牌没有可选的清单（平台没有列子品牌的接口）：从某一行的子品牌点进来，条件以小标签的样子列在表格上方
  const brandRow = brand === null ? undefined : rows.find((row) => row.brand_id === brand);
  const brandChip = brand === null ? null : brandRow?.brand ? brandLabel(brandRow.brand) : "指定的子品牌";
  const brandFilter = (row: PlatformProductSummary): string => {
    const next = new URLSearchParams(params);
    next.set("brand", row.brand_id);
    return `${location.pathname}?${next.toString()}`;
  };

  // 只看一家供应商时（供应商详情页里）表格窄一些：不要「供应商」「子品牌」「上架时间」这几列
  const tenantColumn: Column<PlatformProductSummary> = { key: "tenant", header: "供应商", wrap: true, cell: (row) => <TenantCell tenant={row.tenant} canOpen={canSeeTenants} /> };
  const brandColumn: Column<PlatformProductSummary> = {
    key: "brand",
    header: "子品牌",
    cell: (row) =>
      row.brand ? (
        <Link className="link" to={brandFilter(row)} replace title={`只看子品牌「${row.brand.name}」的商品`} aria-label={`只看子品牌「${row.brand.name}」的商品`}>
          {brandLabel(row.brand)}
        </Link>
      ) : (
        "—"
      ),
  };
  const publishedColumn: Column<PlatformProductSummary> = { key: "published", header: "上架时间", cell: (row) => <span className="table__muted">{row.published_at === null ? "—" : formatLocalDateTime(row.published_at)}</span> };
  const columns: Column<PlatformProductSummary>[] = [
    {
      key: "product",
      header: "商品",
      wrap: true,
      cell: (row) => {
        const shown = productName(row);
        return (
          <span className="table__names">
            <Link className={shown.unnamed ? "link product-name product-name--unnamed" : "link product-name"} to={`${PLATFORM_PRODUCT_LIST_PATH}/${row.id}`} state={returnState} lang={shown.unnamed ? undefined : shown.lang} title={shown.text}>
              {shown.text}
            </Link>
            <span className="product-code">{row.code}</span>
          </span>
        );
      },
    },
    ...(fixedTenant ? [] : [tenantColumn]),
    ...(fixedTenant ? [] : [brandColumn]),
    {
      key: "city",
      header: "城市",
      cell: (row) => (
        <span className="table__names">
          <span className="table__inline">
            <span>{row.city ? displayName(row.city.name).text : "—"}</span>
            {row.city?.status === "disabled" && <StatusBadge tone="neutral" label="城市已停用" />}
          </span>
          {row.poi && <span className="table__muted">{`${displayName(row.poi.name).text}（${row.poi.code}）`}</span>}
        </span>
      ),
    },
    { key: "category", header: "品类", cell: (row) => <span className="tag">{PRODUCT_CATEGORY_NAMES[row.category]}</span> },
    { key: "status", header: "状态", cell: (row) => <StatusBadge {...PRODUCT_STATUS_BADGES[row.status]} /> },
    { key: "price", header: "可用价格", cell: (row) => <PriceCell row={row} /> },
    ...(fixedTenant ? [] : [publishedColumn]),
    { key: "updated", header: "最近修改", cell: (row) => <span className="table__muted">{formatLocalDateTime(row.updated_at)}</span> },
  ];

  const tableState: TableState = state.status === "ready" ? "ready" : state.status === "forbidden" ? "forbidden" : state.status === "loading" ? "loading" : "error";
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
  ) : fixedTenant ? (
    <StateBlock tone="neutral" title="这家供应商还没有商品" description="它的管理员在供应商后台建好商品后，会出现在这里。运营后台只能查看，不能替供应商建商品。" />
  ) : (
    <StateBlock tone="neutral" title="还没有商品" description="供应商在供应商后台建好商品后，会出现在这里。运营后台只能查看，不能替供应商建商品。" />
  );
  const fixedTenantFilter = !fixedTenant && tenant !== null && !canSeeTenants ? (rows.find((row) => row.tenant_id === tenant)?.tenant.name ?? "指定的供应商") : null;

  return (
    <>
      <FilterBar search={<SearchBox label="按商品名或商品编号搜索" value={q} onSearch={(value) => setParam({ q: value })} />} paramNames={filterParams.filter((key) => key !== "q" && key !== "brand" && !(key === "tenant" && !canSeeTenants))} active={filtered} onClear={clearFilters}>
        <Filters fixedTenant={fixedTenant !== undefined} tenants={tenants.state.data?.items ?? null} tenantsState={!fixedTenant && canSeeTenants ? tenants.state.status : null} cityOptions={cityOptions} citiesState={cities.state.status} citiesEmptyText={cities.emptyText} />
      </FilterBar>
      {(brandChip !== null || fixedTenantFilter !== null) && (
        <p className="filter-chips">
          {fixedTenantFilter !== null && (
            <span className="filter-chip" title={`供应商：${fixedTenantFilter}`}>
              <span className="filter-chip__text">{`供应商：${fixedTenantFilter}`}</span>
              <button type="button" className="filter-chip__remove" aria-label={`去掉条件「供应商：${fixedTenantFilter}」`} onClick={() => setParam({ tenant: null })}>
                <Icon name="x" />
              </button>
            </span>
          )}
          {brandChip !== null && (
            <span className="filter-chip" title={`子品牌：${brandChip}`}>
              <span className="filter-chip__text">{`子品牌：${brandChip}`}</span>
              <button type="button" className="filter-chip__remove" aria-label={`去掉条件「子品牌：${brandChip}」`} onClick={() => setParam({ brand: null })}>
                <Icon name="x" />
              </button>
            </span>
          )}
        </p>
      )}
      <DataTable label={fixedTenant ? `${fixedTenant.name} 的商品` : "商品列表"} columns={columns} rows={rows} rowKey={(row) => row.id} state={tableState} refreshing={state.status === "loading" && state.data !== null} onRetry={reload} empty={empty} />
      <CursorPagination
        total={state.data ? state.data.total : null}
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
      <Attributions sources={placeSources(true)} />
    </>
  );
}

// ───────────── 列表 ─────────────

export function PlatformProductListPage() {
  const { portal, account } = usePortalSession();
  useDocumentTitle(`商品 · NOZOMI ${portal.name}`);
  const canRead = usePlatformCan("product.read");
  const shell = (content: ReactNode): ReactNode => (
    <AppShell pageName="商品">
      <Page title="商品">{content}</Page>
    </AppShell>
  );
  if (account.status !== "ready") return shell(<Skeleton lines={["control", "long", "long"]} />);
  if (!canRead) return shell(NO_ACCESS);
  return shell(
    <>
      <p className="page__lead">所有供应商的商品，运营后台只能查看。「可用价格」是启用、没过期、区域和车型组都还选着的价格：已上架的商品没有可用价格时，客人询价报不出价。</p>
      <PlatformProductTable />
    </>,
  );
}

// ───────────── 详情 ─────────────

/** 从哪里点进来的就回哪里（商品列表、供应商详情）；直接打开地址的回商品列表。 */
function returnTo(state: unknown): string {
  const from = typeof state === "object" && state !== null ? (state as ReturnState).from : undefined;
  if (typeof from !== "string" || from.includes("//")) return PLATFORM_PRODUCT_LIST_PATH;
  return from === PLATFORM_PRODUCT_LIST_PATH || from.startsWith(`${PLATFORM_PRODUCT_LIST_PATH}?`) || /^\/platform\/tenants\/[0-9a-f-]{36}(\?|$)/i.test(from) ? from : PLATFORM_PRODUCT_LIST_PATH;
}

/** 第 ④ 步：运营后台没有每一天的库存，只看模式和从今天起还有几天有库存。 */
function InventorySummary({ detail, listPath, listState }: { detail: PlatformProductDetail; listPath: string; listState: unknown }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const { mode, sellable_days_ahead: days } = detail.inventory;
  return (
    <div className="step">
      <h2 className="step__title" ref={heading} tabIndex={-1}>
        ④ 库存
      </h2>
      <section className="card">
        <dl className="details">
          <div className="details__item">
            <dt>库存模式</dt>
            <dd>{mode === "unlimited" ? "不限量" : "限量"}</dd>
          </div>
          {mode === "limited" && (
            <div className="details__item">
              <dt>从今天起有库存的日子</dt>
              <dd>
                {days > 0 ? (
                  `${days} 天`
                ) : (
                  <span className="readiness readiness--warning">
                    <Icon name="alert-triangle" />
                    从今天起没有库存，卖不出去
                  </span>
                )}
              </dd>
            </div>
          )}
        </dl>
        <p className="field__hint">{mode === "unlimited" ? "不限量：每天接多少单都可以。" : "限量：按供应商每天设的库存接单。"}每一天设了多少、卖了多少在供应商后台的「库存」里看，运营后台现在只看得到模式和还有几天有库存。</p>
      </section>
      <div>
        <LinkButton to={listPath} state={listState}>
          回到列表
        </LinkButton>
      </div>
    </div>
  );
}

const noop = (): void => undefined;

export function PlatformProductDetailPage() {
  const params = useParams();
  const id = params["id"] ?? "";
  const [step, ...rest] = (params["*"] ?? "").split("/").filter((part) => part !== "") as [string | undefined, ...string[]];
  const location = useLocation();
  const { portal, account } = usePortalSession();
  const canRead = usePlatformCan("product.read");
  const canSeeTenants = usePlatformCan("tenant.read");
  const valid = UUID_PATTERN.test(id);
  const loaded = useLoad<PlatformProductDetail>(`platform-product:${id}`, canRead && valid ? (token) => getPlatformProduct(token, id) : null);
  const detail = loaded.state.data;
  const product = detail?.product ?? null;
  const shown = product ? productName(product) : null;
  const slug = (PRODUCT_STEP_SLUGS as readonly string[]).includes(step ?? "") ? (step as ProductStepSlug) : null;
  useDocumentTitle(shown && slug ? `${PRODUCT_STEP_TITLES[slug]} · ${shown.text} · NOZOMI ${portal.name}` : `商品 · NOZOMI ${portal.name}`);

  const listPath = returnTo(location.state);
  const listPage = readListPage(location.state);
  const listState = useMemo(() => (listPage ? { listPage } : undefined), [listPage?.key, listPage?.stack.length]);
  const source = useMemo(
    () => (detail ? platformProductSource(PLATFORM_PRODUCT_LIST_PATH, { serviceRules: detail.service_rules, content: { version: detail.product.version, content: detail.content }, priceRules: detail.price_rules, adjustRules: detail.adjust_rules }) : null),
    [detail],
  );

  const pageTitle = shown?.text ?? "商品";
  const shell = (content: ReactNode, meta?: ReactNode): ReactNode => (
    <AppShell pageName={pageTitle} trail={[{ label: "商品", to: PLATFORM_PRODUCT_LIST_PATH }]}>
      <Page title={pageTitle} {...(shown && !shown.unnamed ? { titleLang: shown.lang } : {})} {...(meta ? { meta } : {})}>
        {content}
      </Page>
    </AppShell>
  );
  if (account.status === "ready" && !canRead) return shell(NO_ACCESS);
  if (!valid || loaded.state.status === "not-found") {
    return shell(
      <StateBlock
        tone="neutral"
        title="找不到这个商品"
        description="它可能已被供应商删除，或链接有误。"
        action={
          <LinkButton variant="primary" to={PLATFORM_PRODUCT_LIST_PATH}>
            回到商品列表
          </LinkButton>
        }
      />,
    );
  }
  if (loaded.state.status === "forbidden") return shell(NO_ACCESS);
  if (detail === null || product === null || source === null) {
    return shell(
      loaded.state.status === "error" ? (
        <section className="card">
          <StateBlock
            title="加载失败"
            description="请检查网络后重试。"
            action={
              <Button variant="secondary" onClick={loaded.reload}>
                重试
              </Button>
            }
          />
        </section>
      ) : (
        <section className="card">
          <Skeleton lines={["medium", "control", "control", "long"]} />
        </section>
      ),
    );
  }
  // 地址里没有步骤、或步骤不认识：看基础信息
  if (slug === null) return <Navigate to={source.paths.step(product.id, "basic")} replace state={location.state} />;

  const frame: ProductFrame = {
    product,
    version: product.version,
    readOnly: true,
    source,
    check: detail.publish_check,
    checkContext: checkContextOf(product),
    inventoryMode: detail.inventory.mode,
    setInventoryMode: noop,
    saved: loaded.reload,
    syncVersion: noop,
    refresh: loaded.reload,
    listPath,
    listState,
  };
  const disabledRefs = [
    ...(product.city?.status === "disabled" ? [{ kind: "城市", name: displayName(product.city.name).text }] : []),
    ...(product.poi?.status === "disabled" ? [{ kind: "接送点", name: displayName(product.poi.name).text }] : []),
    ...(product.brand?.status === "disabled" ? [{ kind: "子品牌", name: product.brand.name }] : []),
  ];
  const meta = (
    <>
      <StatusBadge {...PRODUCT_STATUS_BADGES[product.status]} />
      <span className="product-meta__code">
        <span className="product-code">{product.code}</span>
        <CopyButton text={product.code} label="复制商品编号" />
      </span>
      <span>{[PRODUCT_CATEGORY_NAMES[product.category], product.city ? displayName(product.city.name).text : null, product.poi ? `${displayName(product.poi.name).text}（${product.poi.code}）` : null].filter((part) => part !== null).join(" · ")}</span>
      <span className="product-meta__tenant">
        供应商{" "}
        {canSeeTenants ? (
          <Link className="link" to={tenantPath(detail.tenant.id)}>
            {detail.tenant.name}
          </Link>
        ) : (
          detail.tenant.name
        )}
      </span>
      {product.brand && <span className="product-meta__brand">{`子品牌 ${brandLabel(product.brand)}`}</span>}
      <span>{`版本 ${product.version}`}</span>
      {product.published_at !== null && <span>{`上架时间 ${formatLocalDateTime(product.published_at)}`}</span>}
      <span>{`最近修改 ${formatLocalDateTime(product.updated_at)}`}</span>
    </>
  );

  return shell(
    <div className="steps">
      <Alert kind="info">{`这是供应商「${detail.tenant.name}」的商品，运营后台只能查看，不能修改。要改的话，请联系供应商在供应商后台修改。`}</Alert>
      {detail.tenant.status === "suspended" && (
        <Alert kind="warning">
          <strong className="alert__title">这家供应商已暂停。</strong>
          <span>暂停期间它的商品不参与比价、不接新订单。</span>
        </Alert>
      )}
      {disabledRefs.map((entry) => (
        <Alert key={entry.kind} kind="warning">
          <strong className="alert__title">{`这个商品的${entry.kind}「${entry.name}」已停用。`}</strong>
          <span>商品不能上架、不会参与报价。</span>
        </Alert>
      ))}
      <ProductSteps frame={frame} current={slug} rest={rest} checkStatus={loaded.state.status} onReloadCheck={loaded.reload} inventory={<InventorySummary detail={detail} listPath={listPath} listState={listState} />} />
      {slug !== "basic" && <Attributions sources={placeSources(product.category === "airport_transfer")} />}
    </div>,
    meta,
  );
}
