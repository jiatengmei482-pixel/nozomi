/**
 * 运营后台首页（docs/design/pages/platform-home.md）：各模块的入口、数量和需要处理的提醒。
 * 数量全部来自 `dashboard/summary`；入口不等数量，数量加载失败时入口照常可用。
 * 汇率超过 48 小时没更新（跨币种报价已暂停）时，页面顶部一条危险提示条（M2-03）。
 */
import { TENANT_LIST_PATH, platformProductListPath } from "../lib/platform-paths.ts";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { type DashboardSummary, fetchDashboardSummary } from "../api/master.ts";
import { countChannels, countPendingApprovals } from "../api/channels.ts";
import { countPlatformProducts } from "../api/platform-products.ts";
import { usePortalSession } from "../auth/PortalSession.tsx";
import { Alert } from "../components/Alert.tsx";
import { AppShell, Page } from "../components/AppShell.tsx";
import { Button } from "../components/Button.tsx";
import { EntryCard, type EntryCounts, type EntryReminder } from "../components/EntryCard.tsx";
import { StateBlock } from "../components/States.tsx";
import { masterListPath, masterNewPath, pendingAirportsPath, placeListPath } from "../lib/master-paths.ts";
import { formatCount, formatLocalDateTime } from "../lib/master-display.ts";
import { useDocumentTitle } from "../lib/use-document-title.ts";
import { FX_PATH } from "../lib/fx-display.ts";
import { APPROVALS_PAGE_PATH, CHANNELS_PAGE_PATH } from "../lib/channel-display.ts";
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
  const canSeeChannels = usePlatformCan("channel.read");
  const canSeeApprovals = usePlatformCan("approval.read");
  const { state, reload: reloadSummary } = useLoad<DashboardSummary>("summary", fetchDashboardSummary);
  // 商品的两个数：已上架的、其中报不出价的（ADR 0021：用列表接口的 total，不在首页数量接口里）
  const products = useLoad<{ published: number; unpriced: number }>(
    "home-products",
    canSeeProducts ? (token) => Promise.all([countPlatformProducts(token, { status: "published" }), countPlatformProducts(token, { status: "published", has_active_price: "false" })]).then(([published, unpriced]) => ({ published, unpriced })) : null,
  );
  const reloadProducts = products.reload;
  // 渠道和待审核（ADR 0023）：同样用列表接口的 total；没取到只影响这两张卡片
  const channels = useLoad<{ total: number; active: number }>("home-channels", canSeeChannels ? countChannels : null);
  const approvals = useLoad<number>("home-approvals", canSeeApprovals ? countPendingApprovals : null);
  const reloadChannels = channels.reload;
  const reloadApprovals = approvals.reload;
  const reload = useCallback(() => {
    reloadSummary();
    reloadProducts();
    reloadChannels();
    reloadApprovals();
  }, [reloadSummary, reloadProducts, reloadChannels, reloadApprovals]);
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
  const cardCounts = <T,>(loaded: { state: { status: string; data: T | null } }, counts: (data: T) => EntryCounts): EntryCounts => (loaded.state.data !== null ? counts(loaded.state.data) : loaded.state.status === "loading" ? { status: "loading" } : { status: "failed" });
  const channelCounts = cardCounts(channels, (data) => ({ status: "ready", counts: [{ value: data.total, label: "全部" }, { value: data.active, label: "启用" }] }));
  const approvalCounts = cardCounts(approvals, (pendingCount) => ({ status: "ready", counts: [{ value: pendingCount, label: "待审核" }] }));
  const approvalReminders: EntryReminder[] = (approvals.state.data ?? 0) > 0 ? [{ text: `${formatCount(approvals.state.data ?? 0)} 条改动等你或同事审核`, to: APPROVALS_PAGE_PATH }] : [];
  const showMaster = summary !== null ? summary.master_data !== null : canSeeMaster;
  const showTenants = summary !== null ? summary.tenants !== null : canSeeTenants;
  const master = summary?.master_data ?? null;
  const tenants = summary?.tenants ?? null;

  const placeCounts = master && (["airport", "station", "poi"] as const).reduce((sum, type) => ({ active: sum.active + master.places.by_type[type].active, disabled: sum.disabled + master.places.by_type[type].disabled }), { active: 0, disabled: 0 });
  const waiting = master?.places.airports_without_city ?? 0;
  const placeReminders: EntryReminder[] = waiting > 0 ? [{ text: `${formatCount(waiting)} 个机场待指定城市`, to: canManageMaster ? pendingAirportsPath() : placeListPath("airport", { city: "none" }) }] : [];
  const cityReminders: EntryReminder[] = master && master.cities.active === 0 && waiting > 0 && canManageMaster ? [{ text: "先新增城市，才能给机场指定城市", to: masterNewPath("cities") }] : [];
  // 汇率（M2-03）：过期是故障，页面顶部醒目提醒；没有汇率、挂起待确认写在卡片的提醒行上
  const fx = summary?.fx ?? null;
  const fxCounts: EntryCounts = fx === null ? pending : { status: "text", text: fx.as_of === null ? "还没有汇率" : `更新于 ${formatLocalDateTime(fx.as_of)}` };
  const fxReminders: EntryReminder[] = [
    ...(fx?.state === "none" ? [{ text: "还没有汇率，跨币种报价都报不出", to: FX_PATH }] : []),
    ...(fx?.held ? [{ text: "有一批汇率变动超过 3%，待确认", to: FX_PATH }] : []),
    // 人工锁定（M2-06）：哪些币种锁定到什么时候
    ...(fx !== null && fx.locks.length > 0 ? [{ text: `人工锁定中：${fx.locks.map((lock) => `${lock.currency}（到 ${formatLocalDateTime(lock.expires_at)}）`).join("、")}`, to: FX_PATH }] : []),
  ];

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
        {fx?.state === "stale" && (
          <Alert kind="danger">
            <strong className="alert__title">汇率超过 48 小时没有更新，跨币种报价已暂停</strong>
            <span>
              现在这批汇率是 {fx.as_of === null ? "—" : formatLocalDateTime(fx.as_of)} 的。
              {fx.locks.length > 0 ? `人工锁定的币种（${fx.locks.map((lock) => lock.currency).join("、")}）和美元之间照常报价。` : ""}
            </span>
            <Link to={FX_PATH}>去汇率页处理</Link>
          </Alert>
        )}
        {!showMaster && !showTenants && !canSeeProducts && !canSeeChannels && !canSeeApprovals && (state.status === "ready" || state.status === "forbidden") && <StateBlock tone="neutral" title="这里暂时没有你可以使用的模块" description="需要的话，请联系管理员开通。" />}
        {(showTenants || canSeeProducts || canSeeChannels || canSeeApprovals) && (
          <section className="home-section" aria-labelledby="home-operations">
            <h2 className="home-section__title" id="home-operations">
              运营
            </h2>
            <div className="entry-grid">
              {showTenants && <EntryCard title="供应商" to={TENANT_LIST_PATH} counts={tenants ? { status: "ready", counts: [{ value: tenants.active, label: "正常" }, { value: tenants.suspended, label: "已暂停" }] } : pending} />}
              {canSeeProducts && <EntryCard title="商品" to={platformProductListPath({ status: "published" })} counts={productCounts ? { status: "ready", counts: [{ value: productCounts.published, label: "已上架" }] } : productsFailed ? { status: "failed" } : { status: "loading" }} reminders={productReminders} />}
              {canSeeChannels && <EntryCard title="渠道" to={CHANNELS_PAGE_PATH} counts={channelCounts} />}
              {canSeeApprovals && <EntryCard title="待审核" to={APPROVALS_PAGE_PATH} counts={approvalCounts} reminders={approvalReminders} />}
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
              <EntryCard title="汇率" to={FX_PATH} counts={fxCounts} reminders={fxReminders} />
            </div>
          </section>
        )}
      </Page>
    </AppShell>
  );
}
