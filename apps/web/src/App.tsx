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
import { ProductListPage } from "./pages/products/ProductListPage.tsx";
import { NotFoundPage } from "./pages/NotFoundPage.tsx";
import { PlatformHomePage } from "./pages/PlatformHomePage.tsx";
import { masterRoutes } from "./pages/master/routes.tsx";
import { SetPasswordPage } from "./pages/SetPasswordPage.tsx";

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
        {portal === "tenant" && (
          <>
            <Route path={AREA_LIST_PATH} element={<AreaListPage />} />
            <Route path={AREA_NEW_PATH} element={<AreaEditorPage key="new" />} />
            <Route path={`${AREA_LIST_PATH}/:id`} element={<AreaEditorPage />} />
            <Route path={PRODUCT_LIST_PATH} element={<ProductListPage />} />
            <Route path={PRODUCT_NEW_PATH} element={<ProductEditorPage key="new" />} />
            <Route path={`${PRODUCT_LIST_PATH}/:id`} element={<ProductEditorPage />} />
            <Route path={`${PRODUCT_LIST_PATH}/:id/:step`} element={<ProductEditorPage />} />
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
        {portalRoutes("platform")}
        {portalRoutes("tenant")}
      </Routes>
    </ToastProvider>
  );
}
