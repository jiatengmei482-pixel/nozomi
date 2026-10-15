/**
 * 运营后台首页（docs/design/pages/platform-home.md）：各模块的入口、数量和需要处理的提醒。
 * 数量全部来自 `dashboard/summary`；入口不等数量，数量加载失败时入口照常可用。
 */
import { TENANT_LIST_PATH, platformProductListPath } from "../lib/platform-paths.ts";
import { useCallback, useEffect, useRef, useState } from "react";
import { type DashboardSummary, fetchDashboardSummary } from "../api/master.ts";
import { countPlatformProducts } from "../api/platform-products.ts";
import { usePortalSession } from "../auth/PortalSession.tsx";
import { Alert } from "../components/Alert.tsx";
import { AppShell, Page } from "../components/AppShell.tsx";
import { Button } from "../components/Button.tsx";
import { EntryCard, type EntryCounts, type EntryReminder } from "../components/EntryCard.tsx";
import { StateBlock } from "../components/States.tsx";
import { masterListPath, masterNewPath, pendingAirportsPath, placeListPath } from "../lib/master-paths.ts";
import { formatCount } from "../lib/master-display.ts";
import { useDocumentTitle } from "../lib/use-document-title.ts";
import { useLoad } from "../lib/use-load.ts";
import { usePlatformCan } from "../lib/use-master-access.ts";

/** 窗口重新获得焦点时，距上次请求超过这么久才重新取。 */
const REFRESH_AFTER_MS = 60_000;

function statusCounts(counts: { active: number; disabled: number }): EntryCounts {
  return { status: "ready", counts: [{ value: counts.active, label: "启用" }, { value: counts.disabled, label: "已停用" }] };
}

export function PlatformHomePage() {
  const { portal } = usePortalSession();
  useDocumentTitle(`首页 · NOZOMI ${portal.name}`);
  const canSeeMaster = usePlatformCan("master_data.read");
  const canManageMaster = usePlatformCan("master_data.manage");
  const canSeeTenants = usePlatformCan("tenant.read");
  const canSeeProducts = usePlatformCan("product.read");
  const { state, reload: reloadSummary } = useLoad<DashboardSummary>("summary", fetchDashboardSummary);
  // 商品的两个数：已上架的、其中报不出价的（ADR 0021：用列表接口的 total，不在首页数量接口里）
  const products = useLoad<{ published: number; unpriced: number }>(
    "home-products",
    canSeeProducts ? (token) => Promise.all([countPlatformProducts(token, { status: "published" }), countPlatformProducts(token, { status: "published", has_active_price: "false" })]).then(([published, unpriced]) => ({ published, unpriced })) : null,
  );
  const reloadProducts = products.reload;
  const reload = useCallback(() => {
    reloadSummary();
    reloadProducts();
  }, [reloadSummary, reloadProducts]);
  const requestedAt = useRef(Date.now());
  const [announce, setAnnounce] = useState("");

  useEffect(() => {
    if (state.status === "loading") requestedAt.current = Date.now();
    if (state.status === "ready") setAnnounce("数量已更新");
  }, [state.status]);
  useEffect(() => {
    const onFocus = (): void => {
      if (Date.now() - requestedAt.current > REFRESH_AFTER_MS) reload();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [reload]);

  const summary = state.data;
  // 之前成功过、这次失败：保留上一次的数字，不打扰
  const failed = summary === null && (state.status === "error" || state.status === "forbidden" || state.status === "not-found");
  const pending: EntryCounts = failed ? { status: "failed" } : { status: "loading" };
  const productCounts = products.state.data;
  const productsFailed = canSeeProducts && productCounts === null && (products.state.status === "error" || products.state.status === "forbidden" || products.state.status === "not-found");
  const productReminders: EntryReminder[] = productCounts && productCounts.unpriced > 0 ? [{ text: `${formatCount(productCounts.unpriced)} 个已上架的商品报不出价`, to: platformProductListPath({ status: "published", priced: "no" }) }] : [];
  const showMaster = summary !== null ? summary.master_data !== null : canSeeMaster;
  const showTenants = summary !== null ? summary.tenants !== null : canSeeTenants;
  const master = summary?.master_data ?? null;
  const tenants = summary?.tenants ?? null;

  const placeCounts = master && (["airport", "station", "poi"] as const).reduce((sum, type) => ({ active: sum.active + master.places.by_type[type].active, disabled: sum.disabled + master.places.by_type[type].disabled }), { active: 0, disabled: 0 });
  const waiting = master?.places.airports_without_city ?? 0;
  const placeReminders: EntryReminder[] = waiting > 0 ? [{ text: `${formatCount(waiting)} 个机场待指定城市`, to: canManageMaster ? pendingAirportsPath() : placeListPath("airport", { city: "none" }) }] : [];
  const cityReminders: EntryReminder[] = master && master.cities.active === 0 && waiting > 0 && canManageMaster ? [{ text: "先新增城市，才能给机场指定城市", to: masterNewPath("cities") }] : [];

  return (
    <AppShell pageName="首页">
      <Page title="首页">
        <span className="visually-hidden" role="status">
          {announce}
        </span>
        <div role="alert">
          {(failed || productsFailed) && (
            <Alert kind="danger">
              <strong className="alert__title">数量没有加载出来</strong>
              <span>入口可以照常使用。请检查网络后重试。</span>
              <Button variant="text" size="sm" onClick={reload}>
                重试
              </Button>
            </Alert>
          )}
        </div>
        {!showMaster && !showTenants && !canSeeProducts && (state.status === "ready" || state.status === "forbidden") && <StateBlock tone="neutral" title="这里暂时没有你可以使用的模块" description="需要的话，请联系管理员开通。" />}
        {(showTenants || canSeeProducts) && (
          <section className="home-section" aria-labelledby="home-operations">
            <h2 className="home-section__title" id="home-operations">
              运营
            </h2>
            <div className="entry-grid">
              {showTenants && <EntryCard title="供应商" to={TENANT_LIST_PATH} counts={tenants ? { status: "ready", counts: [{ value: tenants.active, label: "正常" }, { value: tenants.suspended, label: "已暂停" }] } : pending} />}
              {canSeeProducts && <EntryCard title="商品" to={platformProductListPath({ status: "published" })} counts={productCounts ? { status: "ready", counts: [{ value: productCounts.published, label: "已上架" }] } : productsFailed ? { status: "failed" } : { status: "loading" }} reminders={productReminders} />}
            </div>
          </section>
        )}
        {showMaster && (
          <section className="home-section" aria-labelledby="home-master">
            <h2 className="home-section__title" id="home-master">
              主数据
            </h2>
            <div className="entry-grid">
              <EntryCard title="城市" to={masterListPath("cities")} counts={master ? statusCounts(master.cities) : pending} reminders={cityReminders} />
              <EntryCard title="地点" to={masterListPath("places")} counts={placeCounts ? statusCounts(placeCounts) : pending} reminders={placeReminders} />
              <EntryCard title="车型组" to={masterListPath("vehicle-groups")} counts={master ? statusCounts(master.vehicle_groups) : pending} />
              <EntryCard title="附加服务" to={masterListPath("addons")} counts={master ? statusCounts(master.addons) : pending} />
            </div>
          </section>
        )}
      </Page>
    </AppShell>
  );
}
