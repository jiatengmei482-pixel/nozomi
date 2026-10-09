/**
 * 供应商后台登录后的首页（运营后台的首页是 PlatformHomePage）：标题行是所属供应商的名称与状态（来自 `auth/me`），
 * 下面是各模块的入口卡片（数量来自 dashboard/summary）。当前登录人的姓名、角色、邮箱在顶栏的账号菜单里。没有任何预置内容。
 */
import { type TenantDashboardSummary, fetchTenantSummary } from "../api/areas.ts";
import { usePortalSession } from "../auth/PortalSession.tsx";
import { Alert } from "../components/Alert.tsx";
import { EntryCard, type EntryCounts } from "../components/EntryCard.tsx";
import { AREA_LIST_PATH, AREA_NEW_PATH } from "../lib/area-paths.ts";
import { useLoad } from "../lib/use-load.ts";
import { useTenantCan } from "../lib/use-master-access.ts";
import { AppShell, Page } from "../components/AppShell.tsx";
import { Button } from "../components/Button.tsx";
import { Skeleton, StateBlock } from "../components/States.tsx";
import { StatusBadge, TENANT_STATUS_BADGES } from "../components/StatusBadge.tsx";
import { useDocumentTitle } from "../lib/use-document-title.ts";

export function HomePage() {
  const { portal, account, reloadAccount } = usePortalSession();
  useDocumentTitle(`首页 · NOZOMI ${portal.name}`);
  const canSeeAreas = useTenantCan("area.read");
  const canManageAreas = useTenantCan("area.manage");
  const summary = useLoad<TenantDashboardSummary>("tenant-summary", canSeeAreas ? fetchTenantSummary : null);
  const data = summary.state.data;
  const failed = canSeeAreas && data === null && summary.state.status !== "loading";
  const showAreas = data !== null ? data.areas !== null : canSeeAreas;
  const areas = data?.areas ?? null;
  const areaCounts: EntryCounts = areas ? { status: "ready", counts: [{ value: areas.active, label: "启用" }, { value: areas.disabled, label: "已停用" }] } : failed ? { status: "failed" } : { status: "loading" };

  // 供应商名称和状态在标题行；姓名、角色、邮箱在顶栏的账号菜单里（docs/design/pages/tenant-home.md）
  const tenant = account.status === "ready" ? account.account.tenant : null;

  return (
    <AppShell pageName="首页">
      <Page
        title="首页"
        {...(tenant
          ? {
              meta: (
                <>
                  <span className="tenant-name">{tenant.name}</span>
                  <span className="tenant-status">
                    <StatusBadge {...TENANT_STATUS_BADGES[tenant.status]} />
                  </span>
                </>
              ),
            }
          : {})}
      >
        {failed && (
          <div role="alert">
            <Alert kind="danger">
              <strong className="alert__title">数量没有加载出来</strong>
              <span>入口可以照常使用。请检查网络后重试。</span>
              <Button variant="text" size="sm" onClick={summary.reload}>
                重试
              </Button>
            </Alert>
          </div>
        )}
        {showAreas && (
          <section className="home-section" aria-labelledby="home-catalog">
            <h2 className="home-section__title" id="home-catalog">
              商品配置
            </h2>
            <div className="entry-grid">
              <EntryCard title="区域" to={AREA_LIST_PATH} counts={areaCounts} reminders={areas && areas.active + areas.disabled === 0 && canManageAreas ? [{ text: "还没有区域，先建一个", to: AREA_NEW_PATH }] : []} />
            </div>
          </section>
        )}
        {account.status === "ready" && !showAreas && <StateBlock tone="neutral" title="这里暂时没有你可以使用的模块" description="需要的话，请联系你们的管理员开通。" />}
        {account.status === "loading" && (
          <section className="card">
            <Skeleton lines={["medium", "long", "short"]} />
          </section>
        )}
        {account.status === "error" && (
          <section className="card">
            <StateBlock
              title="加载失败"
              description="请检查网络后重试。"
              action={
                <Button variant="secondary" onClick={reloadAccount}>
                  重试
                </Button>
              }
            />
          </section>
        )}
      </Page>
    </AppShell>
  );
}
