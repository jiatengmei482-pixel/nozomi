/** 运营后台「供应商」和「系统设置」各页面的地址（docs/design/pages/platform-tenants.md、platform-settings.md 第 1 节）。 */
export const TENANT_LIST_PATH = "/platform/tenants";
export const TENANT_NEW_PATH = `${TENANT_LIST_PATH}/new`;
export function tenantPath(id: string): string {
  return `${TENANT_LIST_PATH}/${encodeURIComponent(id)}`;
}

export const SETTINGS_ROOT = "/platform/settings";
export const STAFF_LIST_PATH = `${SETTINGS_ROOT}/staff`;
export const STAFF_NEW_PATH = `${STAFF_LIST_PATH}/new`;
export const AUDIT_LOG_PATH = `${SETTINGS_ROOT}/audit-logs`;
export const INTEGRATIONS_PAGE_PATH = `${SETTINGS_ROOT}/integrations`;

/** 去审计日志并带着筛选条件：某家供应商、某个操作人、某一个对象。 */
export function auditLogPath(filter: { tenant?: string; actor?: string; resource?: string; rid?: string } = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) if (value !== undefined && value !== "") params.set(key, value);
  const search = params.toString();
  return search === "" ? AUDIT_LOG_PATH : `${AUDIT_LOG_PATH}?${search}`;
}

/** 运营后台只读查看供应商的商品（docs/design/pages/platform-products.md）。 */
export const PLATFORM_PRODUCT_LIST_PATH = "/platform/products";
export const QUOTE_PREVIEW_PAGE_PATH = "/platform/quote-preview";

/** 商品列表并带着筛选条件（网址参数名见 platform-products.md 2.2）。 */
export function platformProductListPath(filter: { tenant?: string; status?: string; priced?: "yes" | "no"; city?: string; category?: string; brand?: string } = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) if (value !== undefined && value !== "") params.set(key, value);
  const search = params.toString();
  return search === "" ? PLATFORM_PRODUCT_LIST_PATH : `${PLATFORM_PRODUCT_LIST_PATH}?${search}`;
}
