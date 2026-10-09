/**
 * 供应商后台登录后的首页（运营后台的首页是 PlatformHomePage）：各模块的入口卡片（数量来自 dashboard/summary），
 * 以及当前登录人、角色、所属供应商的名称与状态（来自 `auth/me`）。没有任何预置内容。
 */
import { type TenantDashboardSummary, fetchTenantSummary } from "../api/areas.ts";
import { usePortalSession } from "../auth/PortalSession.tsx";
import { Alert } from "../components/Alert.tsx";
import { EntryCard, type EntryCounts } from "../components/EntryCard.tsx";
import { AREA_LIST_PATH, AREA_NEW_PATH } from "../lib/area-paths.ts";
import { PRODUCT_LIST_PATH, PRODUCT_NEW_PATH } from "../lib/product-paths.ts";
import { useLoad } from "../lib/use-load.ts";
import { useTenantCan } from "../lib/use-master-access.ts";
import { AppShell, Page } from "../components/AppShell.tsx";
import { Button } from "../components/Button.tsx";
import { Skeleton, StateBlock } from "../components/States.tsx";
import { StatusBadge, TENANT_STATUS_BADGES } from "../components/StatusBadge.tsx";
import { roleName } from "../lib/portal.ts";
import { useDocumentTitle } from "../lib/use-document-title.ts";

export function HomePage() {
  const { portal, account, reloadAccount } = usePortalSession();
  useDocumentTitle(`首页 · NOZOMI ${portal.name}`);
  const canSeeAreas = useTenantCan("area.read");
  const canManageAreas = useTenantCan("area.manage");
  const canSeeProducts = useTenantCan("product.read");
  const canManageProducts = useTenantCan("product.manage");
  const canSeeAny = canSeeAreas || canSeeProducts;
  const summary = useLoad<TenantDashboardSummary>("tenant-summary", canSeeAny ? fetchTenantSummary : null);
  const data = summary.state.data;
  const failed = canSeeAny && data === null && summary.state.status !== "loading";
  const showProducts = data !== null ? data.products !== null : canSeeProducts;
  const products = data?.products ?? null;
  const productCounts: EntryCounts = products
    ? { status: "ready", counts: [{ value: products.published, label: "已上架" }, { value: products.draft, label: "草稿" }, { value: products.unpublished, label: "已下架" }] }
    : failed
      ? { status: "failed" }
      : { status: "loading" };
  // 引导一次只出一条：区域这一步做完了（或看不到区域的数量），才提醒建商品
  const remindProduct = products !== null && products.published + products.draft + products.unpublished === 0 && canManageProducts && (data?.areas == null || data.areas.active > 0);
  const showAreas = data !== null ? data.areas !== null : canSeeAreas;
  const areas = data?.areas ?? null;
  const areaCounts: EntryCounts = areas ? { status: "ready", counts: [{ value: areas.active, label: "启用" }, { value: areas.disabled, label: "已停用" }] } : failed ? { status: "failed" } : { status: "loading" };

  return (
    <AppShell pageName="首页">
      <Page title="首页">
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
        {(showAreas || showProducts) && (
          <section className="home-section" aria-labelledby="home-catalog">
            <h2 className="home-section__title" id="home-catalog">
              商品配置
            </h2>
            <div className="entry-grid">
              {showAreas && <EntryCard title="区域" to={AREA_LIST_PATH} counts={areaCounts} reminders={areas && areas.active + areas.disabled === 0 && canManageAreas ? [{ text: "还没有区域，先建一个", to: AREA_NEW_PATH }] : []} />}
              {showProducts && <EntryCard title="商品" to={PRODUCT_LIST_PATH} counts={productCounts} reminders={remindProduct ? [{ text: "还没有商品，先建一个", to: PRODUCT_NEW_PATH }] : []} />}
            </div>
          </section>
        )}
        {account.status === "ready" && !showAreas && !showProducts && <StateBlock tone="neutral" title="这里暂时没有你可以使用的模块" description="需要的话，请联系你们的管理员开通。" />}
        <section className="card" aria-labelledby="current-account-title">
          <h2 className="card__title" id="current-account-title">
            当前登录
          </h2>
          {account.status === "loading" && <Skeleton lines={["medium", "long", "short"]} />}
          {account.status === "error" && (
            <StateBlock
              title="加载失败"
              description="请检查网络后重试。"
              action={
                <Button variant="secondary" onClick={reloadAccount}>
                  重试
                </Button>
              }
            />
          )}
          {account.status === "ready" && (
            <dl className="details">
              <div className="details__item">
                <dt>姓名</dt>
                <dd>{account.account.name}</dd>
              </div>
              <div className="details__item">
                <dt>邮箱</dt>
                <dd>{account.account.email}</dd>
              </div>
              <div className="details__item">
                <dt>角色</dt>
                <dd>{roleName(portal.key, account.account.role) ?? "—"}</dd>
              </div>
              {account.account.tenant && (
                <>
                  <div className="details__item">
                    <dt>供应商名称</dt>
                    <dd>{account.account.tenant.name}</dd>
                  </div>
                  <div className="details__item">
                    <dt>供应商状态</dt>
                    <dd>
                      <StatusBadge {...TENANT_STATUS_BADGES[account.account.tenant.status]} />
                    </dd>
                  </div>
                </>
              )}
            </dl>
          )}
        </section>
      </Page>
    </AppShell>
  );
}
