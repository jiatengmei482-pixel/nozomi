/** 运营后台「供应商」和「系统设置」的路由（地址见 lib/platform-paths.ts）。 */
import { Route } from "react-router";
import { AUDIT_LOG_PATH, INTEGRATIONS_PAGE_PATH, STAFF_LIST_PATH, STAFF_NEW_PATH, TENANT_LIST_PATH, TENANT_NEW_PATH } from "../../lib/platform-paths.ts";
import { AuditLogPage, IntegrationsPage } from "./SettingsPages.tsx";
import { StaffListPage, StaffNewPage } from "./StaffPages.tsx";
import { TenantDetailPage, TenantListPage, TenantNewPage } from "./TenantPages.tsx";

export function platformRoutes() {
  return (
    <>
      <Route path={TENANT_LIST_PATH} element={<TenantListPage />} />
      <Route path={TENANT_NEW_PATH} element={<TenantNewPage />} />
      <Route path={`${TENANT_LIST_PATH}/:id`} element={<TenantDetailPage />} />
      <Route path={STAFF_LIST_PATH} element={<StaffListPage />} />
      <Route path={STAFF_NEW_PATH} element={<StaffNewPage />} />
      <Route path={AUDIT_LOG_PATH} element={<AuditLogPage />} />
      <Route path={INTEGRATIONS_PAGE_PATH} element={<IntegrationsPage />} />
    </>
  );
}
