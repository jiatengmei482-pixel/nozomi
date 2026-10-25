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
