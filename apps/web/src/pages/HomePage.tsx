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
import { type TenantNotice, listOwnNotices } from "../api/onboarding.ts";
import { TENANT_STATUS_HINTS, noticeText, scoreText, standingNotice } from "../lib/onboarding-display.ts";
import { COMPANY_PATH } from "./company/CompanyPage.tsx";
import { PERFORMANCE_PATH } from "./company/PerformancePage.tsx";
import { countTenantTickets } from "../api/order-center.ts";
import { type TenantStatement, listTenantStatements } from "../api/billing.ts";
import { TENANT_TICKETS_PAGE } from "../lib/order-center-display.ts";
import { TENANT_STATEMENTS_PAGE } from "../lib/billing-display.ts";

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
  // 已上架、价格却都过期或停用了：还挂着「已上架」，一个价都报不出。这张卡片一次只出一条提醒，它排在「还没有设价格」前面（正在卖的出了问题更急）
  const remindExpired = prices !== null && prices.published_without_price > 0 && canManageProducts;
  const remindPublish = prices !== null && products !== null && products.draft > 0 && products.published === 0 && prices.products_without_price === 0 && canManageProducts;
  const showAreas = data !== null ? data.areas !== null : canSeeAreas;
  const areas = data?.areas ?? null;
  const areaCounts: EntryCounts = areas ? { status: "ready", counts: [{ value: areas.active, label: "启用" }, { value: areas.disabled, label: "已停用" }] } : failed ? { status: "failed" } : { status: "loading" };

  // 供应商名称和状态在标题行；姓名、角色、邮箱在顶栏的账号菜单里（docs/design/pages/tenant-home.md）
  const tenant = account.status === "ready" ? account.account.tenant : null;
  const showCompany = useTenantCan("company.read");
  const showPerformance = useTenantCan("performance.read");
  const notices = useLoad<{ items: TenantNotice[] }>("home-notices", showCompany ? listOwnNotices : null);
  const standing = tenant === null ? null : standingNotice(tenant);
  // 工单、账单（M4-03）
  const showTickets = useTenantCan("ticket.read");
  const showStatements = useTenantCan("statement.read");
  const tickets = useLoad<{ active: number; awaiting: number }>("home-tickets", showTickets ? countTenantTickets : null);
  const statements = useLoad<{ items: TenantStatement[] }>("home-statements", showStatements ? (token) => listTenantStatements(token) : null);
  const countsOf = <T,>(loaded: { state: { status: string; data: T | null } }, counts: (data: T) => EntryCounts): EntryCounts => (loaded.state.data !== null ? counts(loaded.state.data) : loaded.state.status === "loading" ? { status: "loading" } : { status: "failed" });
  const awaiting = tickets.state.data?.awaiting ?? 0;
  const toConfirm = (statements.state.data?.items ?? []).filter((statement) => statement.status === "issued").length;

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
        {standing !== null && (
          <Alert kind={standing.kind}>
            <strong className="alert__title">{standing.title}</strong>
            <span>{standing.text}</span>
          </Alert>
        )}
        {(showAreas || showProducts) && (
          <section className="home-section" aria-labelledby="home-catalog">
            <h2 className="home-section__title" id="home-catalog">
              商品配置
            </h2>
            <div className="entry-grid">
              {showAreas && <EntryCard title="区域" to={AREA_LIST_PATH} counts={areaCounts} reminders={areas && areas.active + areas.disabled === 0 && canManageAreas ? [{ text: "还没有区域，先建一个", to: AREA_NEW_PATH }] : []} />}
              {showProducts && <EntryCard title="商品" to={PRODUCT_LIST_PATH} counts={productCounts} reminders={[...(remindProduct ? [{ text: "还没有商品，先建一个", to: PRODUCT_NEW_PATH }] : remindPublish ? [{ text: `${products?.draft ?? 0} 个商品还没有上架`, to: `${PRODUCT_LIST_PATH}?status=draft` }] : []), ...(remindStock ? [{ text: `${prices?.published_without_inventory ?? 0} 个已上架的商品从今天起没有库存`, to: `${PRICE_OVERVIEW_PATH}?stock=none` }] : [])]} />}
              {showProducts && <EntryCard title="价格规则" to={PRICE_OVERVIEW_PATH} counts={priceCounts} reminders={remindExpired ? [{ text: `${prices?.published_without_price ?? 0} 个已上架的商品已经没有可用的价格`, to: `${PRICE_OVERVIEW_PATH}?priced=lost` }] : remindPrice ? [{ text: `${prices?.products_without_price ?? 0} 个商品还没有设价格`, to: `${PRICE_OVERVIEW_PATH}?priced=no` }] : []} />}
            </div>
          </section>
        )}
        {(showCompany || showPerformance) && (
          <section className="home-section" aria-labelledby="home-company">
            <h2 className="home-section__title" id="home-company">
              入驻和评分
            </h2>
            <div className="entry-grid">
              {showCompany && tenant !== null && (
                <EntryCard
                  title="企业资质"
                  to={COMPANY_PATH}
                  counts={{ status: "text", text: `${TENANT_STATUS_BADGES[tenant.status].label}：${TENANT_STATUS_HINTS[tenant.status]}` }}
                  reminders={[...(tenant.status === "applying" ? [{ text: "填企业信息、上传资质，交齐后提交审核", to: COMPANY_PATH }] : []), ...(notices.state.data?.items ?? []).filter((notice) => notice.kind === "document_expiring" || notice.kind === "document_expired" || notice.kind === "document_reviewed").slice(0, 2).map((notice) => ({ text: noticeText(notice, {}), to: COMPANY_PATH }))]}
                />
              )}
              {showPerformance && tenant !== null && <EntryCard title="履约评分" to={PERFORMANCE_PATH} counts={{ status: "text", text: tenant.score?.score_on ? `比价用的分 ${scoreText(tenant.score.score_centi)}（近 90 天完成 ${tenant.score.completed_orders} 单）` : "还没有评分：完成不足 20 单时按默认 4.50 参与比价" }} />}
            </div>
          </section>
        )}
        {(showTickets || showStatements) && (
          <section className="home-section" aria-labelledby="home-service">
            <h2 className="home-section__title" id="home-service">
              工单和账单
            </h2>
            <div className="entry-grid">
              {showTickets && <EntryCard title="工单" to={TENANT_TICKETS_PAGE} counts={countsOf(tickets, (data) => ({ status: "ready", counts: [{ value: data.active, label: "没有结论" }, { value: data.awaiting, label: "等你们回复" }] }))} reminders={awaiting > 0 ? [{ text: `${awaiting} 张工单等你们回复（24 小时内，超时视为认可）`, to: `${TENANT_TICKETS_PAGE}?status=awaiting_tenant` }] : []} />}
              {showStatements && <EntryCard title="账单" to={TENANT_STATEMENTS_PAGE} counts={countsOf(statements, (data) => ({ status: "ready", counts: [{ value: data.items.filter((statement) => statement.status === "issued").length, label: "待确认" }, { value: data.items.filter((statement) => statement.status === "in_payout").length, label: "待付款" }] }))} reminders={toConfirm > 0 ? [{ text: `${toConfirm} 张账单待你们确认`, to: `${TENANT_STATEMENTS_PAGE}?status=issued` }] : []} />}
            </div>
          </section>
        )}
        {account.status === "ready" && !showAreas && !showProducts && !showCompany && !showPerformance && !showTickets && !showStatements && <StateBlock tone="neutral" title="这里暂时没有你可以使用的模块" description="需要的话，请联系你们的管理员开通。" />}
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
