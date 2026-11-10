/**
 * 运营后台「未覆盖需求」（M8-20，ADR 0075 第四部分；docs/design/pages/platform-products.md 第 9 节）：
 * 客人询价一家都报不出价时平台自动记的一条（不含任何客人个人信息）。按城市、供应商、日期、用车类型、原因筛；上面是计数，下面是列表（游标翻页）；
 * 每条可以看详情（两端坐标和名称、落在哪些供应商的哪些运营区域、全部拒绝原因），并「在区域地图上查看」。
 * 看要 `demand.read`（超级管理员、运营、招商、渠道经理）；去区域地图要能看区域地图（`product.read`）。
 */
import { PRODUCT_CATEGORY_NAMES, SERVICE_CATEGORIES, type ServiceCategory } from "@nozomi/domain";
import { type ReactNode, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { fetchPlatformAreaMap } from "../../api/area-map.ts";
import { type FilterableCity, listFilterCityOptions } from "../../api/city-options.ts";
import { listAllTenants } from "../../api/platform.ts";
import type { Tenant } from "../../api/types.ts";
import { UNCOVERED_DEMAND_REASONS, type UncoveredDemand, type UncoveredDemandPage, type UncoveredDemandReason, listUncoveredDemands } from "../../api/uncovered-demands.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert } from "../../components/Alert.tsx";
import { AppShell, Page } from "../../components/AppShell.tsx";
import { Button, LinkButton } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { type Column, CursorPagination, DataTable, PAGE_SIZES, type TableState } from "../../components/DataTable.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { FilterBar, useFilterParam } from "../../components/FilterBar.tsx";
import { DateFilter } from "../../components/FilterFields.tsx";
import { SelectField } from "../../components/FormFields.tsx";
import { StateBlock } from "../../components/States.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { PLATFORM_AREA_MAP_PATH } from "../../lib/area-paths.ts";
import { displayName, formatLocalDateTime } from "../../lib/master-display.ts";
import { DEMAND_REASON_HINTS, DEMAND_REASON_NAMES, dateRangeProblem, endText, pointText, refusalSummary, serviceLocalText, tripText } from "../../lib/uncovered-demand-display.ts";
import { useDocumentTitle } from "../../lib/use-document-title.ts";
import { useLoad } from "../../lib/use-load.ts";
import { usePlatformCan } from "../../lib/use-master-access.ts";
import { readListPage } from "../master/shared.tsx";

const PAGE_SIZE = 50;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const FILTERS = ["city", "tenant", "from", "to", "category", "reason"] as const;
/** 计数里按城市、供应商各列前几个 */
const TOP = 5;

const REASON_TONES: Readonly<Record<UncoveredDemandReason, "danger" | "warning" | "neutral">> = { OUTSIDE_OPERATING: "danger", NO_PRICING_AREA: "warning", OTHER: "neutral" };

/** 一条需求「在区域地图上查看」的地址：图层打开，标记放在上车点（没有时下车点）。 */
export function demandMapLink(demand: Pick<UncoveredDemand, "pickup" | "dropoff">): string | null {
  const point = demand.pickup ?? demand.dropoff;
  return point === null ? null : `${PLATFORM_AREA_MAP_PATH}?demands=1&lat=${point.lat}&lng=${point.lng}`;
}

function Filters({ cities, tenants, canSeeTenants }: { cities: { data: FilterableCity[] | null; status: string }; tenants: { data: Tenant[] | null; status: string }; canSeeTenants: boolean }) {
  const [city, setCity] = useFilterParam("city");
  const [tenant, setTenant] = useFilterParam("tenant");
  const [category, setCategory] = useFilterParam("category");
  const [reason, setReason] = useFilterParam("reason");
  const cityOptions = useMemo(() => (cities.data ?? []).map((entry) => ({ value: entry.id, label: `${displayName(entry.name).text}${entry.status === "disabled" ? "（已停用）" : ""}`, detail: entry.code, keywords: Object.values(entry.name).join(" ") })), [cities.data]);
  return (
    <>
      <Combobox inline label="城市" clearLabel="全部" placeholder="全部" options={cityOptions} value={city !== null && UUID_PATTERN.test(city) ? city : null} onChange={setCity} loading={cities.data === null && cities.status === "loading"} loadFailed={cities.data === null && cities.status === "error"} />
      {canSeeTenants && (
        <Combobox
          inline
          label="供应商"
          clearLabel="全部"
          placeholder="全部"
          options={(tenants.data ?? []).map((entry) => ({ value: entry.id, label: entry.name }))}
          value={tenant !== null && UUID_PATTERN.test(tenant) ? tenant : null}
          onChange={setTenant}
          loading={tenants.data === null && tenants.status === "loading"}
          loadFailed={tenants.data === null && tenants.status === "error"}
        />
      )}
      <DateFilter name="from" label="从" />
      <DateFilter name="to" label="到" />
      <SelectField
        inline
        label="用车类型"
        value={(SERVICE_CATEGORIES as readonly string[]).includes(category ?? "") ? (category as ServiceCategory) : "all"}
        options={[{ value: "all", label: "全部" }, ...SERVICE_CATEGORIES.map((value) => ({ value, label: PRODUCT_CATEGORY_NAMES[value] }))]}
        onChange={(value) => setCategory(value === "all" ? null : value)}
      />
      <SelectField
        inline
        label="原因"
        value={(UNCOVERED_DEMAND_REASONS as readonly string[]).includes(reason ?? "") ? (reason as UncoveredDemandReason) : "all"}
        options={[{ value: "all", label: "全部" }, ...UNCOVERED_DEMAND_REASONS.map((value) => ({ value, label: DEMAND_REASON_NAMES[value] }))]}
        onChange={(value) => setReason(value === "all" ? null : value)}
      />
    </>
  );
}

export function UncoveredDemandsPage() {
  const { portal, account } = usePortalSession();
  useDocumentTitle(`未覆盖需求 · NOZOMI ${portal.name}`);
  const canRead = usePlatformCan("demand.read");
  const canSeeTenants = usePlatformCan("tenant.read");
  const canSeeMap = usePlatformCan("product.read");
  const location = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const pick = (name: string, valid: (value: string) => boolean): string | null => {
    const value = params.get(name);
    return value !== null && valid(value) ? value : null;
  };
  const city = pick("city", (value) => UUID_PATTERN.test(value));
  const tenant = pick("tenant", (value) => UUID_PATTERN.test(value));
  const from = pick("from", (value) => DATE_PATTERN.test(value));
  const to = pick("to", (value) => DATE_PATTERN.test(value));
  const category = pick("category", (value) => (SERVICE_CATEGORIES as readonly string[]).includes(value)) as ServiceCategory | null;
  const reason = pick("reason", (value) => (UNCOVERED_DEMAND_REASONS as readonly string[]).includes(value)) as UncoveredDemandReason | null;
  const rangeProblem = dateRangeProblem(from ?? "", to ?? "");
  const sizeParam = Number(params.get("size"));
  const pageSize = (PAGE_SIZES as readonly number[]).includes(sizeParam) ? sizeParam : PAGE_SIZE;
  const filterKey = JSON.stringify(["uncovered-demands", city, tenant, from, to, category, reason, pageSize]);
  const remembered = readListPage(location.state);
  const stack = remembered !== null && remembered.key === filterKey ? remembered.stack : [null];
  const cursor = stack[stack.length - 1] ?? null;
  const here = `${location.pathname}${location.search}`;
  const goToPage = (next: (string | null)[]): void => void navigate(here, { replace: true, state: { listPage: { key: filterKey, stack: next } } });

  const cities = useLoad<{ items: FilterableCity[] }>("uncovered-demand-cities", canRead ? listFilterCityOptions : null);
  const tenants = useLoad<{ items: Tenant[]; truncated: boolean }>("uncovered-demand-tenants", canRead && canSeeTenants ? listAllTenants : null);
  const { state, reload } = useLoad<UncoveredDemandPage>(
    `${filterKey}|${cursor ?? ""}`,
    canRead && rangeProblem === null
      ? (token) => listUncoveredDemands(token, { limit: pageSize, ...(cursor !== null ? { cursor } : {}), ...(city ? { city_id: city } : {}), ...(tenant ? { tenant_id: tenant } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}), ...(category ? { category } : {}), ...(reason ? { reason } : {}) })
      : null,
  );
  const [detail, setDetail] = useState<UncoveredDemand | null>(null);

  const filtered = FILTERS.some((name) => params.has(name));
  const clearFilters = (): void => {
    const next = new URLSearchParams(params);
    for (const name of FILTERS) next.delete(name);
    setParams(next, { replace: true });
  };
  const shell = (content: ReactNode): ReactNode => (
    <AppShell pageName="未覆盖需求" trail={[{ label: "商品" }]}>
      <Page title="未覆盖需求">{content}</Page>
    </AppShell>
  );
  if (account.status === "ready" && !canRead) return shell(<StateBlock tone="neutral" title="你没有权限查看这里" description="需要的话，请联系管理员开通「未覆盖需求 · 查看」。" />);

  const page = state.data;
  const tenantName = (id: string): string => page?.tenants.find((entry) => entry.id === id)?.name ?? tenants.state.data?.items.find((entry) => entry.id === id)?.name ?? "（供应商已不存在）";
  const cityName = (id: string | null): string => (id === null ? "不在任何能订的城市" : (() => {
    const found = page?.cities.find((entry) => entry.id === id)?.name ?? cities.state.data?.items.find((entry) => entry.id === id)?.name;
    return found ? displayName(found).text : "（城市已不存在）";
  })());

  const columns: Column<UncoveredDemand>[] = [
    { key: "seen", header: "最近出现", cardLabel: true, cell: (row) => <span className="table__muted">{formatLocalDateTime(row.last_seen_at)}</span> },
    {
      key: "trip",
      header: "用车",
      wrap: true,
      cell: (row) => (
        <span className="table__names">
          <span>{tripText(row)}</span>
          <span className="table__other-names">{`${serviceLocalText(row.service_local)} · ${cityName(row.city_id)}`}</span>
          <span className="table__other-names">{`${row.passengers} 人 ${row.luggage} 件行李`}</span>
        </span>
      ),
    },
    {
      key: "ends",
      header: "上车 → 下车",
      wrap: true,
      cell: (row) => (
        <span className="table__names">
          <span>{endText(row.pickup_name, row.pickup)}</span>
          <span className="table__other-names">{`→ ${endText(row.dropoff_name, row.dropoff)}`}</span>
        </span>
      ),
    },
    { key: "reason", header: "原因", cell: (row) => <StatusBadge tone={REASON_TONES[row.reason]} label={DEMAND_REASON_NAMES[row.reason]} /> },
    { key: "count", header: "次数", align: "end", cell: (row) => row.repeat_count },
    {
      key: "tenants",
      header: "涉及的供应商",
      wrap: true,
      cell: (row) => (row.tenant_ids.length === 0 ? <span className="table__muted">没有</span> : row.tenant_ids.slice(0, 3).map(tenantName).join("、") + (row.tenant_ids.length > 3 ? ` 等 ${row.tenant_ids.length} 家` : "")),
    },
    {
      key: "actions",
      header: "操作",
      cell: (row) => {
        const map = canSeeMap ? demandMapLink(row) : null;
        return (
          <span className="table__actions">
            <Button variant="text" size="sm" onClick={() => setDetail(row)} aria-label={`详情：${tripText(row)} ${serviceLocalText(row.service_local)}`}>
              详情
            </Button>
            {map !== null && (
              <LinkButton variant="text" size="sm" to={map}>
                在区域地图上查看
              </LinkButton>
            )}
          </span>
        );
      },
    },
  ];

  const tableState: TableState = rangeProblem !== null ? "ready" : state.status === "ready" ? "ready" : state.status === "forbidden" ? "forbidden" : state.status === "loading" ? "loading" : "error";
  const empty = filtered ? (
    <StateBlock
      tone="neutral"
      title="没有符合条件的未覆盖需求"
      description={rangeProblem !== null ? "日期范围不对，改好后再查（见上面的说明）。" : "换个条件试试，或清空筛选。"}
      action={
        <Button variant="secondary" onClick={clearFilters}>
          清空筛选
        </Button>
      }
    />
  ) : (
    <StateBlock tone="neutral" title="最近 30 天没有未覆盖需求" description="客人询价时只要有一家报得出价，就不会记在这里。" />
  );
  const summary = page?.summary;

  return shell(
    <>
      <p className="page-intro">客人询价时一家供应商都报不出价，平台会自动记一条（不含客人的姓名、电话、邮箱等任何个人信息，坐标只到约 10 米）。同一天、同一个需求只记一行，再来只加次数。日期按东京时间，默认最近 30 天。</p>
      <FilterBar search={null} paramNames={FILTERS} active={filtered} onClear={clearFilters}>
        <Filters cities={{ data: cities.state.data?.items ?? null, status: cities.state.status }} tenants={{ data: tenants.state.data?.items ?? null, status: tenants.state.status }} canSeeTenants={canSeeTenants} />
      </FilterBar>
      {rangeProblem !== null && (
        <div role="alert">
          <Alert kind="danger">{rangeProblem}</Alert>
        </div>
      )}
      {rangeProblem === null && summary && page && (
        <section className="card demand-summary" aria-labelledby="demand-summary-title">
          <h2 className="card__title" id="demand-summary-title">
            {`${page.from} 至 ${page.to}：${summary.rows} 条需求，合计 ${summary.repeats} 次`}
          </h2>
          {summary.by_reason.length > 0 && (
            <ul className="demand-summary__reasons" aria-label="按原因">
              {summary.by_reason.map((entry) => (
                <li key={entry.reason}>
                  <StatusBadge tone={REASON_TONES[entry.reason]} label={DEMAND_REASON_NAMES[entry.reason]} />
                  <span>{`${entry.rows} 条 · ${entry.repeats} 次`}</span>
                  <span className="field__hint">{DEMAND_REASON_HINTS[entry.reason]}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="demand-summary__tops">
            {summary.by_city.length > 0 && (
              <p>
                <strong>按城市：</strong>
                {summary.by_city.slice(0, TOP).map((entry) => `${cityName(entry.city_id)} ${entry.rows} 条`).join("、")}
                {summary.by_city.length > TOP ? ` 等 ${summary.by_city.length} 个` : ""}
              </p>
            )}
            {summary.by_tenant.length > 0 && (
              <p>
                <strong>按运营区域涉及的供应商：</strong>
                {summary.by_tenant.slice(0, TOP).map((entry) => `${tenantName(entry.tenant_id)} ${entry.rows} 条`).join("、")}
                {summary.by_tenant.length > TOP ? ` 等 ${summary.by_tenant.length} 家` : ""}
              </p>
            )}
          </div>
          {summary.dropped > 0 && <p className="field__hint field__hint--warning">{`另有 ${summary.dropped} 条新需求因为防刷限流没有记下来（每个来源每小时最多 30 条、全站每天最多 5000 条），不分城市和供应商。`}</p>}
        </section>
      )}
      <div className="card-table">
        <DataTable label="未覆盖需求" columns={columns} rows={rangeProblem !== null ? [] : (page?.items ?? [])} rowKey={(row) => row.id} state={tableState} refreshing={state.status === "loading" && state.data !== null} onRetry={reload} empty={empty} />
      </div>
      <CursorPagination
        total={rangeProblem !== null ? 0 : (summary?.rows ?? null)}
        pageSize={pageSize}
        onPageSizeChange={(size) => {
          const next = new URLSearchParams(params);
          if (size === PAGE_SIZE) next.delete("size");
          else next.set("size", String(size));
          setParams(next, { replace: true });
        }}
        hasPrevious={stack.length > 1}
        hasNext={rangeProblem === null && state.status === "ready" && state.data.next_cursor !== null}
        busy={state.status === "loading"}
        onPrevious={() => goToPage(stack.slice(0, -1))}
        onNext={() => {
          const next = state.data?.next_cursor;
          if (next) goToPage([...stack, next]);
        }}
      />
      <DemandDetail demand={detail} onClose={() => setDetail(null)} tenantName={tenantName} cityName={cityName} canSeeMap={canSeeMap} />
    </>,
  );
}

/** 一条需求的详情：两端坐标和名称、落在哪些供应商的哪些运营区域（区域名字从区域地图取，看不了时写编号）、全部拒绝原因。 */
function DemandDetail({ demand, onClose, tenantName, cityName, canSeeMap }: { demand: UncoveredDemand | null; onClose(): void; tenantName(id: string): string; cityName(id: string | null): string; canSeeMap: boolean }) {
  const tenantIds = demand?.tenant_ids ?? [];
  const areas = useLoad(`demand-detail-areas:${tenantIds.join(",")}`, demand !== null && canSeeMap && tenantIds.length > 0 ? async (token) => (await Promise.all(tenantIds.slice(0, 5).map((id) => fetchPlatformAreaMap(token, { tenant_id: id, status: "all" })))).flatMap((page) => page.items) : null);
  const areaName = (id: string): string => {
    const found = areas.state.data?.find((item) => item.id === id);
    return found ? `「${displayName(found.name).text}」` : `区域 ${id.slice(0, 8)}`;
  };
  const refs = (list: UncoveredDemand["pickup_operating"]): string => (list.length === 0 ? "不在任何供应商的运营区域里" : list.map((ref) => `${tenantName(ref.tenant_id)} ${areaName(ref.area_id)}`).join("；"));
  const map = demand && canSeeMap ? demandMapLink(demand) : null;
  return (
    <Dialog
      open={demand !== null}
      title="未覆盖需求的详情"
      size="form"
      onClose={onClose}
      footer={
        <>
          {map !== null && <LinkButton to={map}>在区域地图上查看</LinkButton>}
          <Button variant="secondary" data-autofocus onClick={onClose}>
            关闭
          </Button>
        </>
      }
    >
      {demand && (
        <dl className="details">
          <div>
            <dt>用车</dt>
            <dd>{`${tripText(demand)} · ${serviceLocalText(demand.service_local)}（当地时间） · ${demand.passengers} 人 ${demand.luggage} 件行李${demand.vehicle_group_id !== null ? " · 指定了车型组" : ""}`}</dd>
          </div>
          <div>
            <dt>城市</dt>
            <dd>{cityName(demand.city_id)}</dd>
          </div>
          <div>
            <dt>上车</dt>
            <dd>{`${demand.pickup_name ?? "（没有地点名称）"} · ${pointText(demand.pickup)}`}</dd>
          </div>
          <div>
            <dt>上车点在哪些运营区域里</dt>
            <dd>{refs(demand.pickup_operating)}</dd>
          </div>
          <div>
            <dt>下车</dt>
            <dd>{demand.dropoff === null ? "渠道没有给下车地点" : `${demand.dropoff_name ?? "（没有地点名称）"} · ${pointText(demand.dropoff)}`}</dd>
          </div>
          <div>
            <dt>下车点在哪些运营区域里</dt>
            <dd>{demand.dropoff === null ? "—" : refs(demand.dropoff_operating)}</dd>
          </div>
          <div>
            <dt>原因</dt>
            <dd>{`${DEMAND_REASON_NAMES[demand.reason]}。${DEMAND_REASON_HINTS[demand.reason]}`}</dd>
          </div>
          <div>
            <dt>各商品报不出的原因</dt>
            <dd>{refusalSummary(demand.refusal_counts)}</dd>
          </div>
          <div>
            <dt>来源</dt>
            <dd>{demand.channel_kind === "site" ? "官网" : "渠道接口"}</dd>
          </div>
          <div>
            <dt>出现</dt>
            <dd>{`${demand.repeat_count} 次，第一次 ${formatLocalDateTime(demand.first_seen_at)}，最近 ${formatLocalDateTime(demand.last_seen_at)}`}</dd>
          </div>
        </dl>
      )}
      {areas.state.status === "error" && <p className="field__hint">区域名称没有加载出来，先显示编号。</p>}
    </Dialog>
  );
}
