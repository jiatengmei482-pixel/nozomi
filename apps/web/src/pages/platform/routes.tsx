/** 运营后台「供应商」「资质审核」「商品」「区域地图」「报价试算」「未覆盖需求」「渠道」「待审核」「订单」「异常队列」「工单」「人工报价」「救援」「取消政策」「赔付表」「财务结算」「推送记录」「通知中心」「系统设置」（含角色、官网设置）和「账号安全」的路由（地址见 lib/platform-paths.ts、lib/channel-display.ts）。 */
import { Route } from "react-router";
import { PLATFORM_AREA_MAP_PATH } from "../../lib/area-paths.ts";
import { AreaOverviewPage } from "../areas/AreaOverviewPage.tsx";
import { ACCOUNT_SECURITY_PATH, AUDIT_LOG_PATH, DOCUMENT_QUEUE_PAGE_PATH, INTEGRATIONS_PAGE_PATH, PLATFORM_PRODUCT_LIST_PATH, QUOTE_PREVIEW_PAGE_PATH, ROLE_LIST_PATH, UNCOVERED_DEMANDS_PAGE_PATH, ROLE_NEW_PATH, STAFF_LIST_PATH, STAFF_NEW_PATH, TENANT_LIST_PATH, TENANT_NEW_PATH } from "../../lib/platform-paths.ts";
import { AccountSecurityPage, RoleEditorPage, RoleListPage, StaffDetailPage } from "./SecurityPages.tsx";
import { APPROVALS_PAGE_PATH, CHANNELS_PAGE_PATH, CHANNEL_NEW_PATH } from "../../lib/channel-display.ts";
import { ApprovalsPage } from "./ApprovalsPage.tsx";
import { DocumentQueuePage } from "./DocumentQueuePage.tsx";
import { ChannelDetailPage, ChannelEditPage, ChannelListPage, ChannelNewPage } from "./ChannelPages.tsx";
import { PlatformProductDetailPage, PlatformProductListPage } from "./ProductPages.tsx";
import { QuotePreviewPage } from "./QuotePreviewPage.tsx";
import { UncoveredDemandsPage } from "./UncoveredDemandsPage.tsx";
import { AuditLogPage, IntegrationsPage } from "./SettingsPages.tsx";
import { StaffListPage, StaffNewPage } from "./StaffPages.tsx";
import { TenantDetailPage, TenantListPage, TenantNewPage } from "./TenantPages.tsx";
import { PLATFORM_DELIVERIES_PAGE } from "../../lib/dispatch-display.ts";
import { PlatformDeliveriesPage } from "../webhooks/WebhookPages.tsx";
import { PLATFORM_NOTIFICATIONS_PATH, PLATFORM_NOTIFICATION_TEMPLATES_PATH } from "../../lib/notification-display.ts";
import { NotificationTemplatesPage, PlatformNotificationsPage } from "../notifications/NotificationPages.tsx";
import { PLATFORM_ORDER_LIST_PATH, POLICY_PAGE_PATH } from "../../lib/order-money-display.ts";
import { PlatformOrderDetailPage, PlatformOrderListPage } from "./PlatformOrderPages.tsx";
import { CancellationPolicyPage } from "./CancellationPolicyPage.tsx";
import { RESCUE_QUEUE_PATH } from "../../lib/rescue-display.ts";
import { RescueQueuePage } from "./RescuePages.tsx";
import { COMPENSATION_TABLE_PAGE, EXCEPTION_QUEUE_PATH, PLATFORM_TICKETS_PAGE, PLATFORM_TICKET_NEW_PATH } from "../../lib/order-center-display.ts";
import { PAYOUT_BATCHES_PAGE, STATEMENTS_PAGE } from "../../lib/billing-display.ts";
import { ExceptionDetailPage, ExceptionQueuePage } from "./ExceptionPages.tsx";
import { TicketListPage, TicketNewPage } from "./TicketPages.tsx";
import { TicketDetailPage } from "./TicketDetailPage.tsx";
import { CompensationTablePage } from "./CompensationTablePage.tsx";
import { BankFileDetailPage, PayoutAccountQueuePage } from "./BankFilePages.tsx";
import { BANK_FILES_PAGE, PLATFORM_PAYOUT_ACCOUNTS_PAGE } from "../../lib/bank-file-display.ts";
import { MANUAL_QUOTES_PAGE, SITE_SETTINGS_PAGE } from "../../lib/manual-quote-display.ts";
import { ManualQuoteDetailPage, ManualQuoteListPage } from "./ManualQuotePages.tsx";
import { SiteSettingsPage } from "./SiteSettingsPage.tsx";
import { PayoutBatchDetailPage, PayoutBatchListPage, StatementDetailPage, StatementListPage } from "./FinancePages.tsx";

export function platformRoutes() {
  return (
    <>
      <Route path={TENANT_LIST_PATH} element={<TenantListPage />} />
      <Route path={TENANT_NEW_PATH} element={<TenantNewPage />} />
      <Route path={`${TENANT_LIST_PATH}/:id`} element={<TenantDetailPage />} />
      <Route path={DOCUMENT_QUEUE_PAGE_PATH} element={<DocumentQueuePage />} />
      <Route path={PLATFORM_PRODUCT_LIST_PATH} element={<PlatformProductListPage />} />
      <Route path={`${PLATFORM_PRODUCT_LIST_PATH}/:id/*`} element={<PlatformProductDetailPage />} />
      <Route path={PLATFORM_AREA_MAP_PATH} element={<AreaOverviewPage />} />
      <Route path={QUOTE_PREVIEW_PAGE_PATH} element={<QuotePreviewPage />} />
      <Route path={UNCOVERED_DEMANDS_PAGE_PATH} element={<UncoveredDemandsPage />} />
      <Route path={CHANNELS_PAGE_PATH} element={<ChannelListPage />} />
      <Route path={CHANNEL_NEW_PATH} element={<ChannelNewPage />} />
      <Route path={`${CHANNELS_PAGE_PATH}/:id`} element={<ChannelDetailPage />} />
      <Route path={`${CHANNELS_PAGE_PATH}/:id/edit`} element={<ChannelEditPage />} />
      <Route path={APPROVALS_PAGE_PATH} element={<ApprovalsPage />} />
      <Route path={STAFF_LIST_PATH} element={<StaffListPage />} />
      <Route path={STAFF_NEW_PATH} element={<StaffNewPage />} />
      <Route path={`${STAFF_LIST_PATH}/:id`} element={<StaffDetailPage />} />
      <Route path={ROLE_LIST_PATH} element={<RoleListPage />} />
      <Route path={ROLE_NEW_PATH} element={<RoleEditorPage key="new" />} />
      <Route path={`${ROLE_LIST_PATH}/:key`} element={<RoleEditorPage />} />
      <Route path={ACCOUNT_SECURITY_PATH} element={<AccountSecurityPage />} />
      <Route path={AUDIT_LOG_PATH} element={<AuditLogPage />} />
      <Route path={INTEGRATIONS_PAGE_PATH} element={<IntegrationsPage />} />
      <Route path={PLATFORM_DELIVERIES_PAGE} element={<PlatformDeliveriesPage />} />
      <Route path={PLATFORM_NOTIFICATIONS_PATH} element={<PlatformNotificationsPage />} />
      <Route path={PLATFORM_NOTIFICATION_TEMPLATES_PATH} element={<NotificationTemplatesPage />} />
      <Route path={PLATFORM_ORDER_LIST_PATH} element={<PlatformOrderListPage />} />
      <Route path={`${PLATFORM_ORDER_LIST_PATH}/:id`} element={<PlatformOrderDetailPage />} />
      <Route path={POLICY_PAGE_PATH} element={<CancellationPolicyPage />} />
      <Route path={RESCUE_QUEUE_PATH} element={<RescueQueuePage />} />
      <Route path={EXCEPTION_QUEUE_PATH} element={<ExceptionQueuePage />} />
      <Route path={`${EXCEPTION_QUEUE_PATH}/:id`} element={<ExceptionDetailPage />} />
      <Route path={PLATFORM_TICKETS_PAGE} element={<TicketListPage />} />
      <Route path={PLATFORM_TICKET_NEW_PATH} element={<TicketNewPage />} />
      <Route path={`${PLATFORM_TICKETS_PAGE}/:id`} element={<TicketDetailPage />} />
      <Route path={MANUAL_QUOTES_PAGE} element={<ManualQuoteListPage />} />
      <Route path={`${MANUAL_QUOTES_PAGE}/:id`} element={<ManualQuoteDetailPage />} />
      <Route path={SITE_SETTINGS_PAGE} element={<SiteSettingsPage />} />
      <Route path={COMPENSATION_TABLE_PAGE} element={<CompensationTablePage />} />
      <Route path={STATEMENTS_PAGE} element={<StatementListPage />} />
      <Route path={`${STATEMENTS_PAGE}/:id`} element={<StatementDetailPage />} />
      <Route path={PAYOUT_BATCHES_PAGE} element={<PayoutBatchListPage />} />
      <Route path={`${PAYOUT_BATCHES_PAGE}/:id`} element={<PayoutBatchDetailPage />} />
      <Route path={PLATFORM_PAYOUT_ACCOUNTS_PAGE} element={<PayoutAccountQueuePage />} />
      <Route path={`${BANK_FILES_PAGE}/:id`} element={<BankFileDetailPage />} />
    </>
  );
}
