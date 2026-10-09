/**
 * 供应商后台登录后的首页（运营后台的首页是 PlatformHomePage）：标题行是所属供应商的名称与状态（来自 `auth/me`），
 * 下面是各模块的入口卡片（数量来自 dashboard/summary）。当前登录人的姓名、角色、邮箱在顶栏的账号菜单里。没有任何预置内容。
 */
import { type TenantDashboardSummary, fetchTenantSummary } from "../api/areas.ts";
import { type PriceOverview, getPriceOverviewSummary } from "../api/prices.ts";
import { usePortalSession } from "../auth/PortalSession.tsx";
import { Alert } from "../components/Alert.tsx";
import { EntryCard, type EntryCounts } from "../components/EntryCard.tsx";
import { AREA_LIST_PATH, AREA_NEW_PATH } from "../lib/area-paths.ts";
import { PRODUCT_LIST_PATH, PRODUCT_NEW_PATH } from "../lib/product-paths.ts";
import { useLoad } from "../lib/use-load.ts";
import { PRICE_OVERVIEW_PATH } from "./prices/PriceOverviewPage.tsx";
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
  // 引导一次只出一条，顺序是 区域 → 商品 → 价格规则 → 上架：区域这一步做完了（或看不到区域的数量），才提醒建商品
  const remindProduct = products !== null && products.published + products.draft + products.unpublished === 0 && canManageProducts && (data?.areas == null || data.areas.active > 0);
  // 价格规则的两个数是另一次请求；取不到时卡片上写「—」，两条提醒都不显示
  const priced = useLoad<Omit<PriceOverview, "items">>("tenant-price-summary", products !== null ? getPriceOverviewSummary : null);
  const prices = priced.state.data;
  const priceCounts: EntryCounts = prices ? { status: "ready", counts: [{ value: prices.products_with_price, label: "已设价格" }, { value: prices.products_without_price, label: "还没有设" }] } : products !== null && priced.state.status === "loading" ? { status: "loading" } : { status: products === null && !failed ? "loading" : "failed" };
  const selling = products !== null ? products.draft + products.published : 0;
  const remindPrice = prices !== null && selling > 0 && prices.products_without_price > 0 && canManageProducts;
  // 已经在卖的出了问题：不属于「下一步」的引导，可以和引导同时出现
  const remindStock = prices !== null && prices.published_without_inventory > 0 && canManageProducts;
  // 已上架、价格却都过期或停用了：还挂着「已上架」，一个价都报不出
  const remindExpired = prices !== null && prices.published_without_price > 0 && canManageProducts;
  const remindPublish = prices !== null && products !== null && products.draft > 0 && products.published === 0 && prices.products_without_price === 0 && canManageProducts;
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
        {(showAreas || showProducts) && (
          <section className="home-section" aria-labelledby="home-catalog">
            <h2 className="home-section__title" id="home-catalog">
              商品配置
            </h2>
            <div className="entry-grid">
              {showAreas && <EntryCard title="区域" to={AREA_LIST_PATH} counts={areaCounts} reminders={areas && areas.active + areas.disabled === 0 && canManageAreas ? [{ text: "还没有区域，先建一个", to: AREA_NEW_PATH }] : []} />}
              {showProducts && <EntryCard title="商品" to={PRODUCT_LIST_PATH} counts={productCounts} reminders={[...(remindProduct ? [{ text: "还没有商品，先建一个", to: PRODUCT_NEW_PATH }] : remindPublish ? [{ text: `${products?.draft ?? 0} 个商品还没有上架`, to: `${PRODUCT_LIST_PATH}?status=draft` }] : []), ...(remindStock ? [{ text: `${prices?.published_without_inventory ?? 0} 个已上架的商品从今天起没有库存`, to: `${PRICE_OVERVIEW_PATH}?stock=none` }] : [])]} />}
              {showProducts && <EntryCard title="价格规则" to={PRICE_OVERVIEW_PATH} counts={priceCounts} reminders={[...(remindPrice ? [{ text: `${prices?.products_without_price ?? 0} 个商品还没有设价格`, to: `${PRICE_OVERVIEW_PATH}?priced=no` }] : []), ...(remindExpired ? [{ text: `${prices?.published_without_price ?? 0} 个已上架的商品已经没有可用的价格`, to: `${PRICE_OVERVIEW_PATH}?priced=no&status=published` }] : [])]} />}
            </div>
          </section>
        )}
        {account.status === "ready" && !showAreas && !showProducts && <StateBlock tone="neutral" title="这里暂时没有你可以使用的模块" description="需要的话，请联系你们的管理员开通。" />}
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
