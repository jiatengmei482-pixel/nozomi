/** 运营后台「供应商」「资质审核」「商品」「报价试算」「渠道」「待审核」「订单」「救援」「取消政策」「推送记录」和「系统设置」的路由（地址见 lib/platform-paths.ts、lib/channel-display.ts）。 */
import { Route } from "react-router";
import { AUDIT_LOG_PATH, DOCUMENT_QUEUE_PAGE_PATH, INTEGRATIONS_PAGE_PATH, PLATFORM_PRODUCT_LIST_PATH, QUOTE_PREVIEW_PAGE_PATH, STAFF_LIST_PATH, STAFF_NEW_PATH, TENANT_LIST_PATH, TENANT_NEW_PATH } from "../../lib/platform-paths.ts";
import { APPROVALS_PAGE_PATH, CHANNELS_PAGE_PATH, CHANNEL_NEW_PATH } from "../../lib/channel-display.ts";
import { ApprovalsPage } from "./ApprovalsPage.tsx";
import { DocumentQueuePage } from "./DocumentQueuePage.tsx";
import { ChannelDetailPage, ChannelEditPage, ChannelListPage, ChannelNewPage } from "./ChannelPages.tsx";
import { PlatformProductDetailPage, PlatformProductListPage } from "./ProductPages.tsx";
import { QuotePreviewPage } from "./QuotePreviewPage.tsx";
import { AuditLogPage, IntegrationsPage } from "./SettingsPages.tsx";
import { StaffListPage, StaffNewPage } from "./StaffPages.tsx";
import { TenantDetailPage, TenantListPage, TenantNewPage } from "./TenantPages.tsx";
import { PLATFORM_DELIVERIES_PAGE } from "../../lib/dispatch-display.ts";
import { PlatformDeliveriesPage } from "../webhooks/WebhookPages.tsx";
import { PLATFORM_ORDER_LIST_PATH, POLICY_PAGE_PATH } from "../../lib/order-money-display.ts";
import { PlatformOrderDetailPage, PlatformOrderListPage } from "./PlatformOrderPages.tsx";
import { CancellationPolicyPage } from "./CancellationPolicyPage.tsx";
import { RESCUE_QUEUE_PATH } from "../../lib/rescue-display.ts";
import { RescueQueuePage } from "./RescuePages.tsx";

export function platformRoutes() {
  return (
    <>
      <Route path={TENANT_LIST_PATH} element={<TenantListPage />} />
      <Route path={TENANT_NEW_PATH} element={<TenantNewPage />} />
      <Route path={`${TENANT_LIST_PATH}/:id`} element={<TenantDetailPage />} />
      <Route path={DOCUMENT_QUEUE_PAGE_PATH} element={<DocumentQueuePage />} />
      <Route path={PLATFORM_PRODUCT_LIST_PATH} element={<PlatformProductListPage />} />
      <Route path={`${PLATFORM_PRODUCT_LIST_PATH}/:id/*`} element={<PlatformProductDetailPage />} />
      <Route path={QUOTE_PREVIEW_PAGE_PATH} element={<QuotePreviewPage />} />
      <Route path={CHANNELS_PAGE_PATH} element={<ChannelListPage />} />
      <Route path={CHANNEL_NEW_PATH} element={<ChannelNewPage />} />
      <Route path={`${CHANNELS_PAGE_PATH}/:id`} element={<ChannelDetailPage />} />
      <Route path={`${CHANNELS_PAGE_PATH}/:id/edit`} element={<ChannelEditPage />} />
      <Route path={APPROVALS_PAGE_PATH} element={<ApprovalsPage />} />
      <Route path={STAFF_LIST_PATH} element={<StaffListPage />} />
      <Route path={STAFF_NEW_PATH} element={<StaffNewPage />} />
      <Route path={AUDIT_LOG_PATH} element={<AuditLogPage />} />
      <Route path={INTEGRATIONS_PAGE_PATH} element={<IntegrationsPage />} />
      <Route path={PLATFORM_DELIVERIES_PAGE} element={<PlatformDeliveriesPage />} />
      <Route path={PLATFORM_ORDER_LIST_PATH} element={<PlatformOrderListPage />} />
      <Route path={`${PLATFORM_ORDER_LIST_PATH}/:id`} element={<PlatformOrderDetailPage />} />
      <Route path={POLICY_PAGE_PATH} element={<CancellationPolicyPage />} />
      <Route path={RESCUE_QUEUE_PATH} element={<RescueQueuePage />} />
    </>
  );
}
