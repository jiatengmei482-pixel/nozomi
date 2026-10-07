/**
 * 路由表。供应商后台在根路径下，运营后台在 /platform 下；两边是同一批页面组件，路径取自 lib/portal.ts。
 * 路径不能落在归 API 的前缀下（见 lib/api-prefixes.ts）。
 */
import { Outlet, Route, Routes } from "react-router";
import { PortalSession } from "./auth/PortalSession.tsx";
import { PORTALS, type Portal } from "./lib/portal.ts";
import { ChangePasswordPage } from "./pages/ChangePasswordPage.tsx";
import { HomePage } from "./pages/HomePage.tsx";
import { LoginPage } from "./pages/LoginPage.tsx";
import { NotFoundPage } from "./pages/NotFoundPage.tsx";
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
        <Route path={paths.home} element={<HomePage />} />
        <Route path={paths.changePassword} element={<ChangePasswordPage />} />
        <Route path={everythingElse} element={<NotFoundPage />} />
      </Route>
    </>
  );
}

export function App() {
  return (
    <Routes>
      {portalRoutes("platform")}
      {portalRoutes("tenant")}
    </Routes>
  );
}
