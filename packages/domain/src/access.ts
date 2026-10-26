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
  "integration.manage",
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
  "exception.manage",
  "ticket.read",
  "ticket.manage",
  "ticket.review",
  "compensation_table.manage",
  "compensation_table.review",
  "role.read",
  "role.manage",
  "role.review",
  "statement.read",
  "statement.manage",
  "statement.review",
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
  "ticket.read",
  "ticket.manage",
  "statement.read",
  "statement.confirm",
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
 * 第三方密钥（M4-09，ADR 0041）：在运营后台填写、更换、清空、测试谷歌地图和 Stripe 的密钥（`integration.manage`）只归超级管理员——
 * 拿到它就能把收款换成别人的 Stripe 账户；技术（`integration.read`）只看得到「已配置 / 未配置」和来源。
 * 角色管理（M4-05，ADR 0030）：看（`role.read`）、新建和发起修改（`role.manage`）、审核修改（`role.review`）属于「系统设置」，只归超级管理员。
 * 取消、改单、事后加收（M3-03，ADR 0029）：
 * - `order.manage`（代客人取消、改单，审核事后加收，发起「免收取消费」）：运营、客服（需求「订单中心」「工单」归客服、运营）；
 * - `payment.manage`（重试失败的退款和扣款，审核「多退给客人」的代取消——需求「人工退款超过阈值」的双人复核）：财务、运营（「支付异常：财务核实」）；
 * - `cancellation_policy.manage`（发起改平台取消政策）：运营；`cancellation_policy.review`（审核）：运营、财务——两位运营互审，或财务审。
 *   取消政策本身每个角色都能看（和主数据一样用 `master_data.read`）。
 * 救援改派（M3-04，ADR 0031）：救援队列和订单里的救援记录用 `order.read` 看；
 * - `rescue.manage`（按 4 种情形发起救援、给候选供应商发救援单、认定不可抗力、发起人工指定）：运营、客服（需求「人工介入能力」归处理订单的人）；
 * - `rescue.review`（审核人工指定救援供应商，需求「全部候选都不接，运营可人工指定租户（双人复核）」）：运营——两位运营互审，或超级管理员审。
 * 订单中心、异常队列、工单、赔付表（M4-02，ADR 0034；需求菜单表「订单中心：客服、运营」「工单：客服」「财务结算」）：
 * - 异常队列用 `order.read` 看；`exception.manage`（认领、关闭）：运营、客服、财务（支付异常由财务核实）；
 * - `ticket.read`（看工单）：和订单一样——运营、客服、财务、风控、只读；
 * - `ticket.manage`（建工单、认领、留言、征求租户意见、判定、关闭）：运营、客服（需求「判定：客服给出结论和赔付方案」）；
 * - `ticket.review`（赔给客人的钱超过阈值时复核判定，需求「金额超过阈值需主管复核」）：运营——客服判定、运营复核；两位运营互审，或超级管理员审；
 * - `compensation_table.manage`（发起改赔付表）：运营；`compensation_table.review`（审核）：运营、财务——和取消政策同一种分工；
 *   赔付表本身每个角色都能看（和取消政策一样用 `master_data.read`）；
 * - 赔付里退不回卡上、要另付的钱（报销）登记已付：`payment.manage`（财务、运营）。
 * 供应商应付账单与付款批次（M5-01，ADR 0040；菜单表「财务结算：应收应付、账单、发票、付款、对账差异」归财务）：
 * - `statement.read`（看账单、明细、付款批次）：财务、只读（看得到每家供应商的结算价，没有对外价）；
 * - `statement.manage`（手动出账、答复异议、作废重出、发起付款复核、锁定付款批次）：财务；
 * - `statement.review`（审核「付款给租户」，需求「敏感操作双人复核：付款给租户」）：财务——两位财务互审，或超级管理员审。
 */
const PLATFORM_PERMISSIONS: Readonly<Record<PlatformRole, readonly PlatformAction[]>> = {
  super_admin: PLATFORM_ACTIONS,
  operations: [
    "tenant.read", "tenant.create", "tenant.change_status", "tenant.review", "tenant.approve", "master_data.read", "quote.preview", "product.read", "channel.read", "approval.read", "order.read", "order.resend",
    "order.manage", "payment.manage", "cancellation_policy.manage", "cancellation_policy.review", "rescue.manage", "rescue.review",
    "exception.manage", "ticket.read", "ticket.manage", "ticket.review", "compensation_table.manage", "compensation_table.review",
  ],
  tenant_onboarding: ["tenant.read", "tenant.create", "tenant.change_status", "tenant.review", "tenant.approve", "master_data.read", "quote.preview", "product.read", "channel.read", "approval.read"],
  channel_manager: ["tenant.read", "master_data.read", "quote.preview", "product.read", "channel.read", "channel.manage", "channel.review", "approval.read"],
  customer_service: ["master_data.read", "quote.preview", "product.read", "channel.read", "approval.read", "order.read", "order.resend", "order.manage", "rescue.manage", "exception.manage", "ticket.read", "ticket.manage"],
  finance: ["master_data.read", "channel.read", "approval.read", "order.read", "payment.manage", "cancellation_policy.review", "exception.manage", "ticket.read", "compensation_table.review", "statement.read", "statement.manage", "statement.review"],
  risk: ["master_data.read", "product.read", "channel.read", "approval.read", "order.read", "ticket.read"],
  master_data: ["master_data.read", "master_data.manage", "fx.manage", "fx.review", "approval.read"],
  tech: ["integration.read", "master_data.read", "channel.read", "approval.read"],
  readonly: ["tenant.read", "master_data.read", "product.read", "channel.read", "approval.read", "order.read", "ticket.read", "statement.read"],
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
 * 工单（M4-02，ADR 0034；需求「征求租户意见：租户须在 24 小时内回复并上传证据」「租户可在 7 天内申诉一次」）：
 * 看和自己有关的工单（`ticket.read`）：管理员、调度、财务、只读；回复、申诉、登记失物（`ticket.manage`）：管理员、调度（履约的人知道现场情况）、财务（对扣款申诉）。
 * 账单（M5-01，ADR 0040；需求「财务：订单（只读）、对账、发票」）：看（`statement.read`）给管理员、财务、只读；确认、提异议（`statement.confirm`）给管理员、财务。
 */
const TENANT_PERMISSIONS: Readonly<Record<TenantRole, readonly TenantAction[]>> = {
  admin: TENANT_ACTIONS,
  pricing: ["master_data.read", "area.read", "area.manage", "product.read", "product.manage", "performance.read"],
  dispatch: ["master_data.read", "order.read", "order.dispatch", "order.extra_charge", "fleet.read", "fleet.manage", "webhook.read", "performance.read", "ticket.read", "ticket.manage"],
  finance: ["master_data.read", "order.read", "order.extra_charge", "company.read", "performance.read", "ticket.read", "ticket.manage", "statement.read", "statement.confirm"],
  readonly: ["user.read", "master_data.read", "area.read", "product.read", "order.read", "fleet.read", "webhook.read", "company.read", "performance.read", "ticket.read", "statement.read"],
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
 * 只列已经有接口的菜单和操作：各处的「导出」等以后有了接口再加（加的时候只改这张表）。
 * 运营后台的「推送记录」页属于订单菜单（看是 `order.read`）。「取消政策」的查看和主数据的查看是同一个接口操作（`master_data.read`）、「救援」的查看和订单的查看是同一个（`order.read`），勾哪一格都能看到两处。
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
  // 入驻（M4-01）：资质审核、合同上传和发起合同版本（`tenant.review`）算编辑；人工暂停、清退、合同版本的复核（`tenant.approve`）算审核
  { key: "tenants", name: "供应商", operations: { view: ["tenant.read"], edit: ["tenant.create", "tenant.change_status", "tenant.review"], review: ["tenant.approve"] } },
  { key: "products", name: "供应商商品", operations: { view: ["product.read"] } },
  { key: "quote_preview", name: "报价试算", operations: { view: ["quote.preview"] } },
  { key: "channels", name: "渠道", operations: { view: ["channel.read"], edit: ["channel.manage"], review: ["channel.review"] } },
  // 订单中心（M3-02、M3-03）：手动重推、代客人取消、改单、审核事后加收、发起免收取消费算编辑；
  // 重试失败的退款和扣款、审核「多退给客人」的代取消（`payment.manage`，需求「人工退款超过阈值」的复核）算审核
  { key: "orders", name: "订单", operations: { view: ["order.read"], edit: ["order.resend", "order.manage"], review: ["payment.manage"] } },
  // 异常队列（M4-02，ADR 0034）：看和看订单是同一个操作（和救援一样），认领和关闭算编辑——单独一格，财务处理支付异常不用拿到代取消、改单
  { key: "exceptions", name: "异常队列", operations: { view: ["order.read"], edit: ["exception.manage"] } },
  // 救援改派（M3-04）：救援队列就是订单的一部分，看和看订单是同一个操作；发起救援、发救援单、不可抗力、发起人工指定算编辑，审核人工指定算审核
  { key: "rescues", name: "救援", operations: { view: ["order.read"], edit: ["rescue.manage"], review: ["rescue.review"] } },
  // 平台取消政策（M3-03）：看政策和看主数据是同一个操作（每个角色都能看）；发起修改算编辑，审核修改算审核
  { key: "cancellation_policy", name: "取消政策", operations: { view: ["master_data.read"], edit: ["cancellation_policy.manage"], review: ["cancellation_policy.review"] } },
  // 工单（M4-02，ADR 0034）：建、处理、判定算编辑，复核超过阈值的判定算审核
  { key: "tickets", name: "工单", operations: { view: ["ticket.read"], edit: ["ticket.manage"], review: ["ticket.review"] } },
  // 客人赔付表（M4-02）：和取消政策一样，看是主数据的查看；发起修改算编辑，审核修改算审核
  { key: "compensation_table", name: "赔付表", operations: { view: ["master_data.read"], edit: ["compensation_table.manage"], review: ["compensation_table.review"] } },
  { key: "approvals", name: "待审核", operations: { view: ["approval.read"] } },
  // 财务结算（M5-01）：看账单和付款批次；出账、答复异议、作废重出、发起付款复核、锁定批次算编辑；审核「付款给租户」算审核
  { key: "finance", name: "财务结算", operations: { view: ["statement.read"], edit: ["statement.manage"], review: ["statement.review"] } },
  // 需求文档里汇率中心是主数据菜单的一部分：看汇率就是看主数据；拉取、确认、发起锁定算编辑，审核锁定算审核
  { key: "master_data", name: "主数据与汇率", operations: { view: ["master_data.read"], edit: ["master_data.manage", "fx.manage"], review: ["fx.review"] } },
  { key: "staff", name: "平台账号", operations: { view: ["staff.read"], edit: ["staff.manage"] } },
  { key: "roles", name: "角色", operations: { view: ["role.read"], edit: ["role.manage"], review: ["role.review"] } },
  { key: "audit_logs", name: "审计日志", operations: { view: ["audit_log.read"] } },
  // 第三方密钥（M4-09，ADR 0041）：填写、更换、清空、测试算编辑，只归超级管理员
  { key: "integrations", name: "集成状态", operations: { view: ["integration.read"], edit: ["integration.manage"] } },
] as const satisfies readonly PlatformMenu[];

export type PlatformMenuKey = (typeof PLATFORM_MENUS)[number]["key"];

/** 一项勾选：「菜单:操作」，如 `channels:edit` */
export type MenuGrant = `${PlatformMenuKey}:${MenuOperation}`;

/**
 * 只有超级管理员（内置角色）才有、自建角色勾不了的几项：管平台账号、建改角色、审核角色修改、填写第三方密钥（M4-09，ADR 0041）。
 * 否则有「改角色」权限的人可以给自己的角色加上任何权限，有「管账号」权限的人可以把自己改成超级管理员——双人复核也挡不住两个人合谋；
 * 能填第三方密钥的人能把收款换成别人的 Stripe 账户。
 * 系统设置里的「查看」（账号列表、角色、审计日志、集成状态）可以给自建角色。
 */
export const SUPER_ADMIN_ONLY_GRANTS: readonly MenuGrant[] = ["staff:edit", "roles:edit", "roles:review", "integrations:edit"];

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

/**
 * 编号是 UUID，大小写不同是同一个（数据库的 uuid 类型就这样认）；范围里存的是数据库读出的小写写法，所以比较前把传入的转成小写。
 * 请求里的编号（路径、请求体）不用各自记得先规范写法。
 */
export function scopeAllowsCity(scope: PlatformDataScope, cityId: string): boolean {
  return scope.cityIds === null || scope.cityIds.includes(cityId.toLowerCase());
}

export function scopeAllowsChannel(scope: PlatformDataScope, channelId: string): boolean {
  return scope.channelIds === null || scope.channelIds.includes(channelId.toLowerCase());
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
