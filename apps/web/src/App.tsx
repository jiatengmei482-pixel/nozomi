/**
 * 路由表。供应商后台在根路径下，运营后台在 /platform 下；两边是同一批页面组件，路径取自 lib/portal.ts。
 * 路径不能落在归 API 的前缀下（见 lib/api-prefixes.ts）。
 */
import { Outlet, Route, Routes } from "react-router";
import { PortalSession } from "./auth/PortalSession.tsx";
import { ToastProvider } from "./components/Toast.tsx";
import { AREA_LIST_PATH, AREA_NEW_PATH } from "./lib/area-paths.ts";
import { PRODUCT_LIST_PATH, PRODUCT_NEW_PATH } from "./lib/product-paths.ts";
import { PORTALS, type Portal } from "./lib/portal.ts";
import { ChangePasswordPage } from "./pages/ChangePasswordPage.tsx";
import { HomePage } from "./pages/HomePage.tsx";
import { LoginPage } from "./pages/LoginPage.tsx";
import { AreaEditorPage } from "./pages/areas/AreaEditorPage.tsx";
import { AreaListPage } from "./pages/areas/AreaListPage.tsx";
import { ProductEditorPage } from "./pages/products/ProductEditorPage.tsx";
import { PRICE_OVERVIEW_PATH, PriceOverviewPage } from "./pages/prices/PriceOverviewPage.tsx";
import { COMPANY_PATH, CompanyPage } from "./pages/company/CompanyPage.tsx";
import { PERFORMANCE_PATH, PerformancePage } from "./pages/company/PerformancePage.tsx";
import { ProductListPage } from "./pages/products/ProductListPage.tsx";
import { NotFoundPage } from "./pages/NotFoundPage.tsx";
import { PlatformHomePage } from "./pages/PlatformHomePage.tsx";
import { masterRoutes } from "./pages/master/routes.tsx";
import { platformRoutes } from "./pages/platform/routes.tsx";
import { SetPasswordPage } from "./pages/SetPasswordPage.tsx";
import { DRIVER_LIST_PATH, DRIVER_PAGE_PATH, ORDER_LIST_PATH, VEHICLE_LIST_PATH, WEBHOOK_SETTINGS_PATH } from "./lib/dispatch-display.ts";
import { DriverTripPage } from "./pages/driver/DriverTripPage.tsx";
import { DriverListPage, VehicleListPage } from "./pages/fleet/FleetPages.tsx";
import { OrderDetailPage, OrderListPage } from "./pages/orders/OrderPages.tsx";
import { WebhookSettingsPage } from "./pages/webhooks/WebhookPages.tsx";
import { SITE_CHECKOUT_PATH, SITE_HOME_PATH, SITE_ORDER_PATH } from "./lib/site-display.ts";
import { BookPage } from "./pages/site/BookPage.tsx";
import { CheckoutPage } from "./pages/site/CheckoutPage.tsx";
import { OrderPage } from "./pages/site/OrderPage.tsx";

function portalRoutes(portal: Portal) {
  const { paths } = PORTALS[portal];
  const everythingElse = `${paths.home === "/" ? "" : paths.home}/*`;
  return (
    <>
      <Route path={paths.login} element={<LoginPage key={portal} portal={portal} />} />
      <Route path={paths.acceptInvite} element={<SetPasswordPage key={`${portal}-invite`} portal={portal} kind="invite" />} />
      <Route path={paths.resetPassword} element={<SetPasswordPage key={`${portal}-reset`} portal={portal} kind="reset" />} />
      <Route
        element={
          <PortalSession key={portal} portal={portal}>
            <Outlet />
          </PortalSession>
        }
      >
        <Route path={paths.home} element={portal === "platform" ? <PlatformHomePage /> : <HomePage />} />
        {portal === "platform" && masterRoutes()}
        {portal === "platform" && platformRoutes()}
        {portal === "tenant" && (
          <>
            <Route path={AREA_LIST_PATH} element={<AreaListPage />} />
            <Route path={AREA_NEW_PATH} element={<AreaEditorPage key="new" />} />
            <Route path={`${AREA_LIST_PATH}/:id`} element={<AreaEditorPage />} />
            <Route path={PRODUCT_LIST_PATH} element={<ProductListPage />} />
            <Route path={PRICE_OVERVIEW_PATH} element={<PriceOverviewPage />} />
            <Route path={PRODUCT_NEW_PATH} element={<ProductEditorPage key="new" />} />
            <Route path={`${PRODUCT_LIST_PATH}/:id/*`} element={<ProductEditorPage />} />
            <Route path={ORDER_LIST_PATH} element={<OrderListPage />} />
            <Route path={`${ORDER_LIST_PATH}/:id`} element={<OrderDetailPage />} />
            <Route path={DRIVER_LIST_PATH} element={<DriverListPage />} />
            <Route path={VEHICLE_LIST_PATH} element={<VehicleListPage />} />
            <Route path={WEBHOOK_SETTINGS_PATH} element={<WebhookSettingsPage />} />
            <Route path={COMPANY_PATH} element={<CompanyPage />} />
            <Route path={PERFORMANCE_PATH} element={<PerformancePage />} />
          </>
        )}
        <Route path={paths.changePassword} element={<ChangePasswordPage />} />
        <Route path={everythingElse} element={<NotFoundPage />} />
      </Route>
    </>
  );
}

export function App() {
  return (
    <ToastProvider>
      <Routes>
        {/* 司机 H5：司机没有账号，凭链接里的令牌（# 后面）；不在任何一个后台里 */}
        <Route path={DRIVER_PAGE_PATH} element={<DriverTripPage />} />
        {/* 官网（ADR 0032）：客人不需要账号；订单页凭链接里的令牌（# 后面）。面向客人的独立外观，不在任何一个后台里 */}
        <Route path={SITE_HOME_PATH} element={<BookPage />} />
        <Route path={SITE_CHECKOUT_PATH} element={<CheckoutPage />} />
        <Route path={SITE_ORDER_PATH} element={<OrderPage />} />
        {portalRoutes("platform")}
        {portalRoutes("tenant")}
      </Routes>
    </ToastProvider>
  );
}
