/**
 * 角色与权限（M0-06）。
 *
 * 角色清单是系统定义的常量，来源是需求文档：
 * - 平台角色：《平台运营端与渠道对接》「运营后台菜单与角色」
 * - 租户角色：《用车报价服务平台》「11. 账号、权限与 API 设置」
 * 数据库里的 platform_roles / tenant_roles 两张表由迁移写入同一份清单，集成测试保证两边一致。
 *
 * 权限模型做到「角色 → 允许的操作」，由接口层强制执行。
 * 这里只列已经有接口的操作；以后每加一组接口，就在这里加操作并分配给角色。
 */

export const PLATFORM_ROLES = [
  { key: "super_admin", name: "超级管理员" },
  { key: "operations", name: "运营" },
  { key: "tenant_onboarding", name: "招商" },
  { key: "channel_manager", name: "渠道经理" },
  { key: "customer_service", name: "客服" },
  { key: "finance", name: "财务" },
  { key: "risk", name: "风控" },
  { key: "master_data", name: "主数据运营" },
  { key: "tech", name: "技术" },
  { key: "readonly", name: "只读" },
] as const;

export type PlatformRole = (typeof PLATFORM_ROLES)[number]["key"];

export const TENANT_ROLES = [
  { key: "admin", name: "管理员" },
  { key: "pricing", name: "商品价格" },
  { key: "dispatch", name: "调度" },
  { key: "finance", name: "财务" },
  { key: "readonly", name: "只读" },
] as const;

export type TenantRole = (typeof TENANT_ROLES)[number]["key"];

export const PLATFORM_ACTIONS = [
  "staff.read",
  "staff.manage",
  "tenant.read",
  "tenant.create",
  "tenant.change_status",
  "audit_log.read",
  "integration.read",
  "master_data.read",
  "master_data.manage",
  "quote.preview",
  "product.read",
  "fx.manage",
  "fx.review",
  "channel.read",
  "channel.manage",
  "channel.review",
  "approval.read",
  "order.read",
  "role.read",
  "role.manage",
  "role.review",
] as const;

export type PlatformAction = (typeof PLATFORM_ACTIONS)[number];

export const TENANT_ACTIONS = ["user.read", "user.manage", "audit_log.read", "master_data.read", "area.read", "area.manage", "product.read", "product.manage", "brand.manage", "order.read"] as const;

export type TenantAction = (typeof TENANT_ACTIONS)[number];

/**
 * 平台角色 → 允许的操作。依据菜单表的「主要使用角色」：
 * 租户管理归招商和运营；系统设置（平台账号、审计日志）只归超级管理员；集成状态归技术。
 * 只读角色能看租户，但看不到系统设置里的内容。
 * 主数据（城市、地点、车型组、附加服务）是所有岗位都要查的公共资料，每个角色都能看；只有主数据运营（和超级管理员）能改。
 * 报价试算（看各供应商的结算价、对外价和报不出价的原因，M2-01）：运营、招商（看哪里缺运力）、渠道经理、客服用得到；
 * 财务、风控、主数据运营、技术、只读用不到——里面有各供应商的结算价和加价比例。
 * 汇率中心（M2-03）是主数据的一部分：每个角色都能看（`master_data.read`）；「立即拉取」、确认 / 放弃挂起的汇率（`fx.manage`）只归主数据运营和超级管理员。
 * 查看供应商的商品（只读，M1-12，ADR 0021）：运营、招商（租户详情页的「商品和价格概览」）、渠道经理（决定渠道卖哪些供应商）、
 * 客服（处理订单时查服务规则、调度人）、风控（价格异常）、只读。里面有结算价，没有对外价和加价比例。
 * 财务、主数据运营、技术用不到（财务看账单，主数据运营停用主数据时只需要「几个已上架商品在用」的数量，已经有了）。
 * 渠道（M2-04，ADR 0023）：菜单表的「渠道管理」归渠道经理。看（`channel.read`）：除主数据运营外每个角色——运营、招商看渠道卖哪些供应商，
 * 客服处理订单要知道是哪个渠道，财务对账，风控看价格，技术管连接器和接口日志，只读能看。里面有加价比例，但这是平台内部的配置（规则 4 只限制 `/tenant/v1`）。
 * 改（`channel.manage`：新建、改基本配置和授权范围、发 API 密钥、**发起**加价和停用的复核）和审核（`channel.review`）：渠道经理和超级管理员。
 * 渠道经理另有 `tenant.read`（只读）：设置渠道卖哪些供应商、按供应商设加价规则，要看得到供应商名单。
 * 待审核队列（`approval.read`）：能看到的只是自己看得到的那几类（渠道的给有 `channel.read` 的角色）。
 * 汇率人工锁定（M2-06，ADR 0025）：发起锁定 / 解锁沿用 `fx.manage`；审核（`fx.review`）给主数据运营和超级管理员——两位主数据运营互审，只有一位时由超级管理员审；
 * 发起人不能审自己发起的（复核机制本身保证）。锁定的复核每个能看汇率的角色都能在队列里看到（和汇率页一样，`master_data.read`），
 * 所以主数据运营也有了 `approval.read`。
 * 订单（只读，M3-01，ADR 0026）：运营（每天处理订单和异常）、客服（处理订单、工单）、财务（对账）、风控（看下单风险）、只读。
 * 里面有乘客的姓名、电话、邮箱：招商、渠道经理、主数据运营、技术用不到，不给。
 * 角色管理（M4-05，ADR 0030）：看（`role.read`）、新建和发起修改（`role.manage`）、审核修改（`role.review`）属于「系统设置」，只归超级管理员。
 */
const PLATFORM_PERMISSIONS: Readonly<Record<PlatformRole, readonly PlatformAction[]>> = {
  super_admin: PLATFORM_ACTIONS,
  operations: ["tenant.read", "tenant.create", "tenant.change_status", "master_data.read", "quote.preview", "product.read", "channel.read", "approval.read", "order.read"],
  tenant_onboarding: ["tenant.read", "tenant.create", "tenant.change_status", "master_data.read", "quote.preview", "product.read", "channel.read", "approval.read"],
  channel_manager: ["tenant.read", "master_data.read", "quote.preview", "product.read", "channel.read", "channel.manage", "channel.review", "approval.read"],
  customer_service: ["master_data.read", "quote.preview", "product.read", "channel.read", "approval.read", "order.read"],
  finance: ["master_data.read", "channel.read", "approval.read", "order.read"],
  risk: ["master_data.read", "product.read", "channel.read", "approval.read", "order.read"],
  master_data: ["master_data.read", "master_data.manage", "fx.manage", "fx.review", "approval.read"],
  tech: ["integration.read", "master_data.read", "channel.read", "approval.read"],
  readonly: ["tenant.read", "master_data.read", "product.read", "channel.read", "approval.read", "order.read"],
};

/**
 * 租户角色 → 允许的操作。账号管理和操作日志只归管理员；只读角色可以看账号列表。
 * 平台主数据每个角色都能看（配置区域和商品、派车、对账都要引用它），谁都不能改。
 * 区域、商品（需求文档「11. 账号、权限与 API 设置」）：管理员和商品价格能改；只读角色能看；调度、财务用不到。
 * 子品牌决定商品的币种，新建和改名只归管理员；能看商品的角色都能看子品牌（`product.read`）。
 * 订单（只读，M3-01，ADR 0026）：管理员、调度（派车要看订单）、财务（对账）、只读；商品价格用不到。
 */
const TENANT_PERMISSIONS: Readonly<Record<TenantRole, readonly TenantAction[]>> = {
  admin: TENANT_ACTIONS,
  pricing: ["master_data.read", "area.read", "area.manage", "product.read", "product.manage"],
  dispatch: ["master_data.read", "order.read"],
  finance: ["master_data.read", "order.read"],
  readonly: ["user.read", "master_data.read", "area.read", "product.read", "order.read"],
};

export function isPlatformRole(value: string): value is PlatformRole {
  return PLATFORM_ROLES.some((role) => role.key === value);
}

export function isTenantRole(value: string): value is TenantRole {
  return TENANT_ROLES.some((role) => role.key === value);
}

export function platformPermissions(role: PlatformRole): readonly PlatformAction[] {
  return PLATFORM_PERMISSIONS[role];
}

export function tenantPermissions(role: TenantRole): readonly TenantAction[] {
  return TENANT_PERMISSIONS[role];
}

export function platformRoleCan(role: PlatformRole, action: PlatformAction): boolean {
  return PLATFORM_PERMISSIONS[role].includes(action);
}

export function tenantRoleCan(role: TenantRole, action: TenantAction): boolean {
  return TENANT_PERMISSIONS[role].includes(action);
}

export type AccountStatus = "invited" | "active" | "disabled";

export interface AccountRoleState<Role extends string> {
  role: Role;
  status: AccountStatus;
}

/**
 * 「至少保留一个」规则（租户的管理员、平台的超级管理员）：
 * 目标账号现在是在用的关键角色，改动后不再是，而且此刻只有它一个，这样的改动不允许。
 *
 * @param activeKeyRoleCount 改动前「状态为在用、角色为关键角色」的账号数量（含目标账号自己）
 */
export function removesLastKeyRoleHolder<Role extends string>(
  keyRole: Role,
  activeKeyRoleCount: number,
  before: AccountRoleState<Role>,
  after: AccountRoleState<Role>,
): boolean {
  const holds = (state: AccountRoleState<Role>): boolean => state.role === keyRole && state.status === "active";
  return holds(before) && !holds(after) && activeKeyRoleCount <= 1;
}

export type StatusChangeError = "STATUS_INVITED_IS_NOT_SETTABLE" | "ACCOUNT_NOT_ACTIVATED";

/**
 * 账号状态能不能这样改：
 * - 「待激活」不能手工设置：它只在发出邀请时产生。
 * - 从未激活过（没有设过密码）的账号不能手工改成「在用」，只能重新邀请、由本人接受邀请来激活。
 * - 其余改动（停用、把激活过的账号重新启用、撤销邀请）都允许。
 *
 * @param activated 账号是否激活过（设过密码）
 */
export function checkStatusChange(
  before: AccountStatus,
  activated: boolean,
  after: AccountStatus,
): StatusChangeError | null {
  if (before === after) return null;
  if (after === "invited") return "STATUS_INVITED_IS_NOT_SETTABLE";
  if (after === "active" && !activated) return "ACCOUNT_NOT_ACTIVATED";
  return null;
}

// ---- 菜单 × 操作、自建角色、数据范围（M4-05，ADR 0030） ----

/**
 * 需求文档「运营后台菜单与角色」：权限按「菜单 × 操作（查看 / 编辑 / 审核 / 导出）」配置，可自建角色。
 * 自建角色存的是勾选了哪些「菜单:操作」，每个请求按下表换成接口检查用的操作（`PlatformAction`）。
 * 内置角色仍以上面的 `PLATFORM_PERMISSIONS` 为准（只读模板），在角色页上按下表显示成同样的勾选表。
 * 只列已经有接口的菜单和操作：订单中心的「编辑」、各处的「导出」等以后有了接口再加（加的时候只改这张表）。
 */
export const MENU_OPERATIONS = [
  { key: "view", name: "查看" },
  { key: "edit", name: "编辑" },
  { key: "review", name: "审核" },
  { key: "export", name: "导出" },
] as const;

export type MenuOperation = (typeof MENU_OPERATIONS)[number]["key"];

export interface PlatformMenu {
  key: string;
  name: string;
  /** 每个操作对应哪些接口操作；没列出的操作这个菜单没有 */
  operations: Partial<Readonly<Record<MenuOperation, readonly PlatformAction[]>>>;
}

export const PLATFORM_MENUS = [
  { key: "tenants", name: "供应商", operations: { view: ["tenant.read"], edit: ["tenant.create", "tenant.change_status"] } },
  { key: "products", name: "供应商商品", operations: { view: ["product.read"] } },
  { key: "quote_preview", name: "报价试算", operations: { view: ["quote.preview"] } },
  { key: "channels", name: "渠道", operations: { view: ["channel.read"], edit: ["channel.manage"], review: ["channel.review"] } },
  { key: "orders", name: "订单", operations: { view: ["order.read"] } },
  { key: "approvals", name: "待审核", operations: { view: ["approval.read"] } },
  // 需求文档里汇率中心是主数据菜单的一部分：看汇率就是看主数据；拉取、确认、发起锁定算编辑，审核锁定算审核
  { key: "master_data", name: "主数据与汇率", operations: { view: ["master_data.read"], edit: ["master_data.manage", "fx.manage"], review: ["fx.review"] } },
  { key: "staff", name: "平台账号", operations: { view: ["staff.read"], edit: ["staff.manage"] } },
  { key: "roles", name: "角色", operations: { view: ["role.read"], edit: ["role.manage"], review: ["role.review"] } },
  { key: "audit_logs", name: "审计日志", operations: { view: ["audit_log.read"] } },
  { key: "integrations", name: "集成状态", operations: { view: ["integration.read"] } },
] as const satisfies readonly PlatformMenu[];

export type PlatformMenuKey = (typeof PLATFORM_MENUS)[number]["key"];

/** 一项勾选：「菜单:操作」，如 `channels:edit` */
export type MenuGrant = `${PlatformMenuKey}:${MenuOperation}`;

/**
 * 只有超级管理员（内置角色）才有、自建角色勾不了的几项：管平台账号、建改角色、审核角色修改。
 * 否则有「改角色」权限的人可以给自己的角色加上任何权限，有「管账号」权限的人可以把自己改成超级管理员——双人复核也挡不住两个人合谋。
 * 系统设置里的「查看」（账号列表、角色、审计日志、集成状态）可以给自建角色。
 */
export const SUPER_ADMIN_ONLY_GRANTS: readonly MenuGrant[] = ["staff:edit", "roles:edit", "roles:review"];

function menuOperationActions(menuKey: string, operation: string): readonly PlatformAction[] | null {
  const menu = PLATFORM_MENUS.find((entry) => entry.key === menuKey) as PlatformMenu | undefined;
  const actions = menu?.operations[operation as MenuOperation];
  return actions ?? null;
}

/** 全部可以勾的「菜单:操作」，按菜单表和操作的顺序。 */
export function allMenuGrants(): MenuGrant[] {
  const out: MenuGrant[] = [];
  for (const menu of PLATFORM_MENUS as readonly PlatformMenu[]) {
    for (const { key } of MENU_OPERATIONS) if (menu.operations[key] !== undefined) out.push(`${menu.key}:${key}` as MenuGrant);
  }
  return out;
}

export function isMenuGrant(value: string): value is MenuGrant {
  const [menu, operation, extra] = value.split(":");
  return extra === undefined && menu !== undefined && operation !== undefined && menuOperationActions(menu, operation) !== null;
}

/** 一组勾选换成接口操作（去重，按 `PLATFORM_ACTIONS` 的顺序）。不认识的、只归超级管理员的勾选忽略（保存时已经拦下，这里是兜底）。 */
export function actionsOfGrants(grants: readonly string[]): PlatformAction[] {
  const set = new Set<PlatformAction>();
  for (const grant of grants) {
    if (!isMenuGrant(grant) || SUPER_ADMIN_ONLY_GRANTS.includes(grant)) continue;
    const [menu, operation] = grant.split(":") as [string, string];
    for (const action of menuOperationActions(menu, operation) ?? []) set.add(action);
  }
  return PLATFORM_ACTIONS.filter((action) => set.has(action));
}

/** 一组接口操作显示成勾选表：这一格的操作全都有才算勾上（内置角色在角色页上的显示、「从内置角色复制」）。 */
export function grantsOfActions(actions: readonly PlatformAction[]): MenuGrant[] {
  return allMenuGrants().filter((grant) => {
    const [menu, operation] = grant.split(":") as [string, string];
    return (menuOperationActions(menu, operation) ?? []).every((action) => actions.includes(action));
  });
}

export type RoleGrantIssue = "UNKNOWN_GRANT" | "SUPER_ADMIN_ONLY" | "VIEW_REQUIRED" | "DUPLICATE";

/**
 * 自建角色的勾选能不能保存：认识的「菜单:操作」、不含只归超级管理员的几项、不重复；
 * 勾了编辑 / 审核 / 导出就必须也勾查看（看不到列表的人没法编辑和审核）。空的也可以（先建好再慢慢勾）。
 */
export function roleGrantIssues(grants: readonly string[]): { grant: string; reason: RoleGrantIssue }[] {
  const issues: { grant: string; reason: RoleGrantIssue }[] = [];
  const seen = new Set<string>();
  for (const grant of grants) {
    if (seen.has(grant)) {
      issues.push({ grant, reason: "DUPLICATE" });
      continue;
    }
    seen.add(grant);
    if (!isMenuGrant(grant)) issues.push({ grant, reason: "UNKNOWN_GRANT" });
    else if (SUPER_ADMIN_ONLY_GRANTS.includes(grant)) issues.push({ grant, reason: "SUPER_ADMIN_ONLY" });
    else if (!grant.endsWith(":view") && !grants.includes(`${grant.split(":")[0]}:view`)) issues.push({ grant, reason: "VIEW_REQUIRED" });
  }
  return issues;
}

/**
 * 数据范围（需求文档「平台账号、安全与审计」：可加数据范围，如只看某几个城市、某几个渠道）。
 * `null` = 不限制；数组 = 只看这几个（空数组 = 一个都看不到）。各维度同时生效（且）。
 * 现在落地的两个维度和它们管到的地方见 ADR 0030：城市管订单；渠道管渠道（列表、详情和下面的一切）、订单、渠道类的复核、按渠道的报价试算。
 */
export interface PlatformDataScope {
  cityIds: readonly string[] | null;
  channelIds: readonly string[] | null;
}

export const UNRESTRICTED_SCOPE: PlatformDataScope = { cityIds: null, channelIds: null };

export function scopeAllowsCity(scope: PlatformDataScope, cityId: string): boolean {
  return scope.cityIds === null || scope.cityIds.includes(cityId);
}

export function scopeAllowsChannel(scope: PlatformDataScope, channelId: string): boolean {
  return scope.channelIds === null || scope.channelIds.includes(channelId);
}

export function scopeIsRestricted(scope: PlatformDataScope): boolean {
  return scope.cityIds !== null || scope.channelIds !== null;
}

/** 一个平台员工此刻能做什么：角色给的接口操作和数据范围。每个请求从数据库现查（ADR 0030「不缓存」）。 */
export interface PlatformGrant {
  roleKey: string;
  builtin: boolean;
  actions: ReadonlySet<PlatformAction>;
  scope: PlatformDataScope;
}

/**
 * 从角色这一行算出权限：内置角色以代码里的表为准（库里没有存勾选）；自建角色按勾选换算。
 * 角色键既不是内置角色、又没有勾选时一个权限都没有（不会因为数据异常放大权限）。
 */
export function resolvePlatformGrant(role: { key: string; builtin: boolean; grants: readonly string[] | null; scope: PlatformDataScope }): PlatformGrant {
  if (role.builtin) {
    return { roleKey: role.key, builtin: true, actions: new Set(isPlatformRole(role.key) ? PLATFORM_PERMISSIONS[role.key] : []), scope: UNRESTRICTED_SCOPE };
  }
  return { roleKey: role.key, builtin: false, actions: new Set(actionsOfGrants(role.grants ?? [])), scope: role.scope };
}

export function grantCan(grant: PlatformGrant, action: PlatformAction): boolean {
  return grant.actions.has(action);
}
