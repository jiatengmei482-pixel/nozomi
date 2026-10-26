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
  "tenant.review",
  "tenant.approve",
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
  "order.resend",
  "order.manage",
  "payment.manage",
  "cancellation_policy.manage",
  "cancellation_policy.review",
  "rescue.manage",
  "rescue.review",
] as const;

export type PlatformAction = (typeof PLATFORM_ACTIONS)[number];

export const TENANT_ACTIONS = [
  "user.read",
  "user.manage",
  "audit_log.read",
  "master_data.read",
  "area.read",
  "area.manage",
  "product.read",
  "product.manage",
  "brand.manage",
  "order.read",
  "order.dispatch",
  "order.extra_charge",
  "fleet.read",
  "fleet.manage",
  "webhook.read",
  "webhook.manage",
  "company.read",
  "company.manage",
  "performance.read",
] as const;

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
 * 供应商入驻（M4-01，ADR 0028）：菜单表「租户管理：入驻申请、资质审核、合同、结算条款、评分、停用」归招商和运营。
 * 资质审核、上传合同、发起合同版本（`tenant.review`）：超级管理员、运营、招商。签约、开始试运营、恢复、**发起**暂停和清退仍是 `tenant.change_status`。
 * 审核供应商这几类双人复核（人工暂停、清退、合同版本，`tenant.approve`）：超级管理员、运营、招商——运营和招商可以互审，只有一位时由超级管理员审。
 * 手动重推给供应商的 Webhook（`order.resend`，M3-02，ADR 0027；需求「人工介入：手工重发渠道和租户推送」）：运营、客服（处理订单的人）。
 * 取消、改单、事后加收（M3-03，ADR 0029）：
 * - `order.manage`（代客人取消、改单，审核事后加收，发起「免收取消费」）：运营、客服（需求「订单中心」「工单」归客服、运营）；
 * - `payment.manage`（重试失败的退款和扣款，审核「多退给客人」的代取消——需求「人工退款超过阈值」的双人复核）：财务、运营（「支付异常：财务核实」）；
 * - `cancellation_policy.manage`（发起改平台取消政策）：运营；`cancellation_policy.review`（审核）：运营、财务——两位运营互审，或财务审。
 *   取消政策本身每个角色都能看（和主数据一样用 `master_data.read`）。
 * 救援改派（M3-04，ADR 0031）：救援队列和订单里的救援记录用 `order.read` 看；
 * - `rescue.manage`（按 4 种情形发起救援、给候选供应商发救援单、认定不可抗力、发起人工指定）：运营、客服（需求「人工介入能力」归处理订单的人）；
 * - `rescue.review`（审核人工指定救援供应商，需求「全部候选都不接，运营可人工指定租户（双人复核）」）：运营——两位运营互审，或超级管理员审。
 */
const PLATFORM_PERMISSIONS: Readonly<Record<PlatformRole, readonly PlatformAction[]>> = {
  super_admin: PLATFORM_ACTIONS,
  operations: [
    "tenant.read", "tenant.create", "tenant.change_status", "tenant.review", "tenant.approve", "master_data.read", "quote.preview", "product.read", "channel.read", "approval.read", "order.read", "order.resend",
    "order.manage", "payment.manage", "cancellation_policy.manage", "cancellation_policy.review", "rescue.manage", "rescue.review",
  ],
  tenant_onboarding: ["tenant.read", "tenant.create", "tenant.change_status", "tenant.review", "tenant.approve", "master_data.read", "quote.preview", "product.read", "channel.read", "approval.read"],
  channel_manager: ["tenant.read", "master_data.read", "quote.preview", "product.read", "channel.read", "channel.manage", "channel.review", "approval.read"],
  customer_service: ["master_data.read", "quote.preview", "product.read", "channel.read", "approval.read", "order.read", "order.resend", "order.manage", "rescue.manage"],
  finance: ["master_data.read", "channel.read", "approval.read", "order.read", "payment.manage", "cancellation_policy.review"],
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
 * 企业信息和资质（M4-01，ADR 0028；需求「管理员：全部，包括账号、资质、API 密钥」）：填写、上传、提交审核（`company.manage`）只归管理员；
 * 看（`company.read`：企业信息、资质、合同、状态记录、提醒）给管理员、财务（结算条款、结算账户证明）、只读。
 * 履约评分（`performance.read`，需求「租户可在自己后台看到各项指标」）：每个角色都能看——调度要看按时派车率，商品价格要知道观察期对中标的影响。
 * 派车、改派、司机链接、回传履约状态（`order.dispatch`）和司机、车辆的管理（`fleet.manage`）：管理员、调度（需求「调度：订单、指派、履约回传、司机、车辆」）。
 * 看司机、车辆（`fleet.read`）：管理员、调度、只读。
 * Webhook（M3-02，ADR 0027）：设置地址、签名密钥、手动重推、发送测试事件（`webhook.manage`）只归管理员（需求「管理员：账号、资质、API 密钥」，签名密钥同属密钥）；
 * 看设置和投递记录（`webhook.read`）：管理员、调度（推送失败时要知道）、只读。
 * 事后加收（M3-03，ADR 0029，`order.extra_charge`：提交、撤回、上传票据）：管理员、调度（履约的人知道超时、停车）、财务（对账的人）。
 * 确认 / 拒绝客人的改期用 `order.dispatch`（排不排得出车是调度的判断）。
 * 救援改派（M3-04，ADR 0031）：声明无法履约、接 / 拒救援单用 `order.dispatch`（调度知道排不排得出车）；
 * 看自己的应扣款项（违约金、救援差价）用 `order.read`（财务对账、只读也要看）。
 */
const TENANT_PERMISSIONS: Readonly<Record<TenantRole, readonly TenantAction[]>> = {
  admin: TENANT_ACTIONS,
  pricing: ["master_data.read", "area.read", "area.manage", "product.read", "product.manage", "performance.read"],
  dispatch: ["master_data.read", "order.read", "order.dispatch", "order.extra_charge", "fleet.read", "fleet.manage", "webhook.read", "performance.read"],
  finance: ["master_data.read", "order.read", "order.extra_charge", "company.read", "performance.read"],
  readonly: ["user.read", "master_data.read", "area.read", "product.read", "order.read", "fleet.read", "webhook.read", "company.read", "performance.read"],
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
