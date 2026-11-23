/**
 * 固定文案清单（M11-02）的分组：每个源文件归到哪个区域、哪个页面。
 *
 * - 前端：路由直接挂的页面文件（下面的 PAGE_ENTRIES，对照 App.tsx、pages/platform/routes.tsx、pages/master/routes.tsx）有固定的页面名；
 *   其他文件顺着 import 往上找是哪些页面在用：只有一个页面用 → 归到那个页面；同一区域的几个页面用 → 归到这个区域；
 *   跨区域用 → 页面目录（pages/、embed/）下的留在目录所属区域，其余归到「前端公共组件和共用文案」，都写上用在哪些页面。
 * - 后端：邮件 / 通知模板单列；接口返回的提示（错误说明等）按文件分组。
 * - domain 包：前后端都用的业务规则里的说法（状态名、原因说明等），按文件分组。
 * 没在 PAGE_ENTRIES 里的新页面文件也能归类：按目录落到对应区域（DIRECTORY_AREAS），页面名取文件开头注释的第一句。
 */
import path from "node:path";
import ts from "typescript";

export const AREAS = [
  { id: "site", title: "官网（客人预订）" },
  { id: "embed", title: "嵌入预订（合作网站上的组件和嵌入页）" },
  { id: "driver", title: "司机页" },
  { id: "account", title: "登录和账号（两个后台共用）" },
  { id: "tenant", title: "供应商后台" },
  { id: "platform", title: "运营后台" },
  { id: "shared", title: "前端公共组件和共用文案" },
  { id: "mail", title: "邮件和通知模板" },
  { id: "api", title: "后端返回的提示（接口错误等）" },
  { id: "domain", title: "前后端共用的业务说法（domain 包）" },
] as const;

export type AreaId = (typeof AREAS)[number]["id"];

export interface PageEntry {
  area: AreaId;
  page: string;
}

const WEB = "apps/web/src/";

/** 路由直接挂的页面文件（相对 apps/web/src）。一个文件里有几个页面的，写合起来的名字。 */
export const PAGE_ENTRIES: Readonly<Record<string, PageEntry>> = {
  "pages/book/new/BookNewPage.tsx": { area: "site", page: "预订页（/book）" },
  "pages/book/trip/TripNewPage.tsx": { area: "site", page: "多日行程报价页（/book/trip）" },
  "pages/book/OrderPage.tsx": { area: "site", page: "订单页（查订单、管理订单）" },
  "pages/book/LegacyBookingRedirect.tsx": { area: "site", page: "旧预订地址跳转" },
  "pages/book/SiteLayout.tsx": { area: "site", page: "官网外框（页头、页脚、出错页）" },
  "pages/legal/LegalPages.tsx": { area: "site", page: "法律文案（特定商取引法に基づく表記、キャンセルポリシー、プライバシーポリシー）" },
  "pages/embed/EmbedApp.tsx": { area: "embed", page: "嵌入预订页（合作网站里的预订页）" },
  "embed/widget.ts": { area: "embed", page: "嵌入组件脚本（合作网站页面上的询价框）" },
  "pages/driver/DriverTripPage.tsx": { area: "driver", page: "司机任务页" },
  "pages/LoginPage.tsx": { area: "account", page: "登录" },
  "pages/SetPasswordPage.tsx": { area: "account", page: "设置密码（接受邀请、重设密码）" },
  "pages/ChangePasswordPage.tsx": { area: "account", page: "修改密码" },
  "pages/SecondFactorPage.tsx": { area: "account", page: "两步验证" },
  "pages/NotFoundPage.tsx": { area: "account", page: "找不到页面" },
  "pages/HomePage.tsx": { area: "tenant", page: "首页" },
  "pages/areas/AreaListPage.tsx": { area: "tenant", page: "区域列表" },
  "pages/areas/AreaEditorPage.tsx": { area: "tenant", page: "区域编辑" },
  "pages/areas/AreaOverviewPage.tsx": { area: "tenant", page: "区域地图（运营后台也用）" },
  "pages/products/ProductListPage.tsx": { area: "tenant", page: "商品列表" },
  "pages/products/ProductEditorPage.tsx": { area: "tenant", page: "商品编辑" },
  "pages/prices/PriceOverviewPage.tsx": { area: "tenant", page: "价格规则总览" },
  "pages/orders/OrderPages.tsx": { area: "tenant", page: "订单（列表、详情）" },
  "pages/rescues/TenantRescuePages.tsx": { area: "tenant", page: "救援单和扣款" },
  "pages/fleet/FleetPages.tsx": { area: "tenant", page: "司机和车辆" },
  "pages/webhooks/WebhookPages.tsx": { area: "tenant", page: "Webhook 设置（运营后台的推送记录也在这里）" },
  "pages/notifications/NotificationPages.tsx": { area: "tenant", page: "通知（运营后台的通知中心、通知模板也在这里）" },
  "pages/company/CompanyPage.tsx": { area: "tenant", page: "公司" },
  "pages/company/CompanyInfoPage.tsx": { area: "tenant", page: "企业信息" },
  "pages/company/PerformancePage.tsx": { area: "tenant", page: "服务表现" },
  "pages/tickets/TenantTicketPages.tsx": { area: "tenant", page: "工单" },
  "pages/statements/TenantStatementPages.tsx": { area: "tenant", page: "账单" },
  "pages/statements/TenantPayoutAccountsPage.tsx": { area: "tenant", page: "收款账户" },
  "pages/PlatformHomePage.tsx": { area: "platform", page: "首页" },
  "pages/platform/TenantPages.tsx": { area: "platform", page: "供应商（列表、新建、详情）" },
  "pages/platform/DocumentQueuePage.tsx": { area: "platform", page: "资质审核" },
  "pages/platform/ProductPages.tsx": { area: "platform", page: "商品（只读查看）" },
  "pages/platform/QuotePreviewPage.tsx": { area: "platform", page: "报价试算" },
  "pages/platform/UncoveredDemandsPage.tsx": { area: "platform", page: "未覆盖需求" },
  "pages/platform/ChannelPages.tsx": { area: "platform", page: "渠道" },
  "pages/platform/ApprovalsPage.tsx": { area: "platform", page: "待审核" },
  "pages/platform/StaffPages.tsx": { area: "platform", page: "平台员工" },
  "pages/platform/SecurityPages.tsx": { area: "platform", page: "账号安全和角色" },
  "pages/platform/SettingsPages.tsx": { area: "platform", page: "系统设置（审计日志、系统状态）" },
  "pages/platform/PlatformOrderPages.tsx": { area: "platform", page: "订单（列表、详情）" },
  "pages/platform/CancellationPolicyPage.tsx": { area: "platform", page: "取消政策" },
  "pages/platform/RescuePages.tsx": { area: "platform", page: "救援" },
  "pages/platform/ExceptionPages.tsx": { area: "platform", page: "异常队列" },
  "pages/platform/TicketPages.tsx": { area: "platform", page: "工单（列表、新建）" },
  "pages/platform/TicketDetailPage.tsx": { area: "platform", page: "工单详情" },
  "pages/platform/ManualQuotePages.tsx": { area: "platform", page: "人工报价" },
  "pages/platform/SiteSettingsPage.tsx": { area: "platform", page: "官网设置" },
  "pages/platform/EmbedKeysPage.tsx": { area: "platform", page: "嵌入组件" },
  "pages/platform/CompensationTablePage.tsx": { area: "platform", page: "赔付表" },
  "pages/platform/FinancePages.tsx": { area: "platform", page: "财务结算（账单、付款批次）" },
  "pages/platform/BankFilePages.tsx": { area: "platform", page: "收款账户审核和银行文件" },
  "pages/master/lists.tsx": { area: "platform", page: "主数据列表（城市、地点、车型组、附加服务）" },
  "pages/master/MasterForm.tsx": { area: "platform", page: "主数据编辑（共用表单）" },
  "pages/master/CityForm.tsx": { area: "platform", page: "主数据 · 城市" },
  "pages/master/PlaceForm.tsx": { area: "platform", page: "主数据 · 地点" },
  "pages/master/OtherForms.tsx": { area: "platform", page: "主数据 · 车型组和附加服务" },
  "pages/master/PendingAirportsPage.tsx": { area: "platform", page: "处理导入的机场" },
  "pages/master/SharedAreaDuplicatesPage.tsx": { area: "platform", page: "共享区域去重" },
  "pages/fx/FxRatesPage.tsx": { area: "platform", page: "汇率" },
};

/** 只是把页面挂到路由上的文件：往上找到这里就停，不算「用到」 */
const ROUTER_FILES = new Set(["App.tsx", "main.tsx", "pages/platform/routes.tsx", "pages/master/routes.tsx"]);

/** 不在 PAGE_ENTRIES、也没有页面用到时，按目录归区域（先匹配长的） */
const DIRECTORY_AREAS: ReadonlyArray<readonly [string, AreaId]> = [
  ["pages/book/", "site"],
  ["pages/legal/", "site"],
  ["pages/embed/", "embed"],
  ["embed/", "embed"],
  ["pages/driver/", "driver"],
  ["pages/platform/", "platform"],
  ["pages/master/", "platform"],
  ["pages/fx/", "platform"],
  ["pages/", "tenant"],
];

/** 后端的邮件 / 通知模板 */
export const MAIL_TEMPLATE_FILES = new Set(["packages/domain/src/notifications.ts", "packages/domain/src/email-login.ts", "packages/domain/src/mail-html.ts", "packages/domain/src/driver-link-email.ts"]);

export interface SourceFile {
  /** 相对仓库根目录，用 / 分隔 */
  path: string;
  text: string;
}

export interface Placement {
  area: AreaId;
  page: string;
  /** 前端共用的文件：用在哪些页面（「区域 · 页面」） */
  usedIn: string[];
}

/** 前端文件之间的 import 关系：被谁 import（只看相对路径的 import，含 `import()`） */
export function importedBy(files: readonly SourceFile[]): Map<string, Set<string>> {
  const known = new Set(files.map((file) => file.path));
  const reverse = new Map<string, Set<string>>();
  for (const file of files) {
    const info = ts.preProcessFile(file.text, true, true);
    for (const imported of info.importedFiles) {
      if (!imported.fileName.startsWith(".")) continue;
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file.path), imported.fileName));
      const target = [resolved, `${resolved}.ts`, `${resolved}.tsx`].find((candidate) => known.has(candidate));
      if (target === undefined) continue;
      const set = reverse.get(target) ?? new Set<string>();
      set.add(file.path);
      reverse.set(target, set);
    }
  }
  return reverse;
}

/** 顺着 import 往上找到的页面文件（不穿过页面文件和路由文件） */
export function reachingEntries(file: string, reverse: ReadonlyMap<string, ReadonlySet<string>>): string[] {
  const found = new Set<string>();
  const seen = new Set<string>([file]);
  const queue = [file];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const importer of reverse.get(current) ?? []) {
      if (seen.has(importer)) continue;
      seen.add(importer);
      const rel = importer.slice(WEB.length);
      if (importer.startsWith(WEB) && PAGE_ENTRIES[rel] !== undefined) found.add(rel);
      else if (!(importer.startsWith(WEB) && ROUTER_FILES.has(rel))) queue.push(importer);
    }
  }
  return [...found].sort();
}

export function areaTitle(id: AreaId): string {
  return AREAS.find((area) => area.id === id)?.title ?? id;
}

const baseName = (file: string): string => file.split("/").pop() ?? file;

/** 按文件名和开头注释给出的「页面」名 */
export function fileLabel(file: string, header: string | null): string {
  return header === null ? baseName(file) : `${header}（${baseName(file)}）`;
}

export function placeFile(file: string, header: string | null, reverse: ReadonlyMap<string, ReadonlySet<string>>): Placement {
  if (MAIL_TEMPLATE_FILES.has(file)) return { area: "mail", page: fileLabel(file, header), usedIn: [] };
  if (file.startsWith("packages/domain/")) return { area: "domain", page: fileLabel(file, header), usedIn: [] };
  if (file.startsWith("apps/api/")) return { area: "api", page: fileLabel(file, header), usedIn: [] };
  const rel = file.startsWith(WEB) ? file.slice(WEB.length) : file;
  const own = PAGE_ENTRIES[rel];
  if (own !== undefined) return { area: own.area, page: own.page, usedIn: [] };
  const entries = reachingEntries(file, reverse).map((entry) => PAGE_ENTRIES[entry] as PageEntry);
  const usedIn = [...new Set(entries.map((entry) => `${areaTitle(entry.area)} · ${entry.page}`))].sort();
  const pages = new Set(entries.map((entry) => `${entry.area}\u0000${entry.page}`));
  const first = entries[0];
  if (pages.size === 1 && first !== undefined) return { area: first.area, page: first.page, usedIn: [] };
  const areas = new Set(entries.map((entry) => entry.area));
  if (areas.size === 1 && first !== undefined) return { area: first.area, page: `多个页面共用：${fileLabel(file, header)}`, usedIn };
  const byDirectory = DIRECTORY_AREAS.find(([prefix]) => rel.startsWith(prefix));
  if (areas.size === 0 && byDirectory !== undefined) return { area: byDirectory[1], page: fileLabel(file, header), usedIn: [] };
  // 页面目录里的文件被几个区域用（如商品编辑的各步，供应商后台和运营后台都挂）：留在目录所属的区域，写明共用
  if (byDirectory !== undefined) return { area: byDirectory[1], page: `多个页面共用：${fileLabel(file, header)}`, usedIn };
  return { area: "shared", page: fileLabel(file, header), usedIn };
}
