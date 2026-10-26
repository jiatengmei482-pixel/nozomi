/** 运营后台「供应商、平台员工」各页面共用的文字和校验（docs/design/pages/platform-tenants.md、platform-settings.md）。 */
import { type AccountStatus, type PlatformAction, type PlatformRole, platformPermissions } from "@nozomi/domain";
import { ApiError, NetworkError } from "../api/client.ts";
import type { BadgeSpec } from "../components/StatusBadge.tsx";

export const NAME_MAX = 100;
export const REASON_MAX = 500;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function emailProblem(value: string): string | null {
  const email = value.trim();
  if (email === "") return "请填写邮箱";
  return EMAIL_PATTERN.test(email) && email.length <= 254 ? null : "这不是一个邮箱地址";
}

/** 名称 / 姓名：只有空格的等于没填。`what` 是「名称」「姓名」。 */
export function nameProblem(value: string, what: string): string | null {
  const name = value.trim();
  if (name === "") return `请填写${what}`;
  return name.length > NAME_MAX ? `${what}最多 ${NAME_MAX} 个字` : null;
}

export function reasonProblem(value: string): string | null {
  if (value.trim() === "") return "请填写暂停原因";
  return value.trim().length > REASON_MAX ? `原因最多 ${REASON_MAX} 个字` : null;
}

/** 账号的三种状态（docs/design/04-data-display.md 第 11 节）。 */
export const ACCOUNT_STATUS_BADGES: Readonly<Record<AccountStatus, BadgeSpec>> = {
  invited: { tone: "info", label: "待激活" },
  active: { tone: "success", label: "在用" },
  disabled: { tone: "neutral", label: "已停用" },
};

/** 每个角色固定的一句「负责什么」。 */
export const ROLE_DUTIES: Readonly<Record<PlatformRole, string>> = {
  super_admin: "什么都能做，包括管理平台员工、看审计日志。人数越少越好，但至少要有两个人，免得一个人忘了密码就没人能处理。",
  operations: "日常运营：管理供应商，处理订单和异常。",
  tenant_onboarding: "负责供应商入驻：新建供应商、邀请管理员、暂停和恢复。",
  channel_manager: "负责销售渠道和加价规则。",
  customer_service: "处理订单、工单和投诉。",
  finance: "负责对账、结算和付款。",
  risk: "负责价格和下单的风险规则。",
  master_data: "维护城市、机场、车站、车型组、附加服务。",
  tech: "负责连接器和系统配置，可以看系统状态。",
  readonly: "只能看，不能改。",
};

/**
 * 每个操作在「现在能做的」里怎么说。键是 @nozomi/domain 的全部 PlatformAction：
 * 以后加了新操作，这里不写说法就编译不过，说明不会再和实际权限脱节。
 */
export const PLATFORM_ACTION_PHRASES: Readonly<Record<PlatformAction, string>> = {
  "tenant.read": "看供应商",
  "tenant.create": "新建供应商、邀请管理员",
  "tenant.change_status": "暂停和恢复供应商",
  "product.read": "查看供应商的商品和价格",
  "quote.preview": "报价试算",
  "master_data.read": "看主数据",
  "master_data.manage": "维护主数据",
  "fx.manage": "管理汇率（立即拉取、确认或放弃变动过大的汇率，发起人工锁定和解锁）",
  "fx.review": "审核汇率的人工锁定和解锁",
  "channel.read": "看渠道",
  "channel.manage": "管理渠道和加价规则（改加价、停用渠道要另一位同事审核）",
  "channel.review": "审核渠道的改动",
  "approval.read": "看待审核的改动",
  "order.read": "看订单",
  "order.resend": "手动重推给供应商的 Webhook",
  "staff.read": "看平台员工",
  "staff.manage": "管理平台员工",
  "audit_log.read": "看审计日志",
  "integration.read": "看系统状态",
  "role.read": "看角色",
  "role.manage": "新建角色、发起角色的修改（要另一位超级管理员审核）",
  "role.review": "审核角色的修改",
};

/**
 * 有了前者就不用再说后者（能管理当然能看）。
 * 「审核渠道的改动」「审核汇率的锁定」不包含「看待审核的改动」：后者是整个「待审核」队列和历史，单说审核哪一类读不出来（M1-18，主数据运营的说明漏了这一句）。
 */
const SUPERSEDES: Readonly<Partial<Record<PlatformAction, readonly PlatformAction[]>>> = {
  "staff.manage": ["staff.read"],
  "role.manage": ["role.read"],
  "master_data.manage": ["master_data.read"],
  "tenant.create": ["tenant.read"],
  "tenant.change_status": ["tenant.read"],
  "channel.manage": ["channel.read"],
};

const TENANT_MANAGE_PHRASE = "管理供应商（新建、邀请管理员、暂停和恢复）";

/**
 * 「现在能做的」：按 @nozomi/domain 的 platformPermissions 现算出来，换成人话，顺序同上面这张表。
 * 每一项权限都会说到（或被「能管理」的那一项包含），不会漏。
 */
export function roleAbilities(role: PlatformRole): string[] {
  const can = new Set<PlatformAction>(platformPermissions(role));
  const covered = new Set<PlatformAction>([...can].flatMap((action) => SUPERSEDES[action] ?? []));
  const managesTenants = can.has("tenant.create") && can.has("tenant.change_status");
  const out: string[] = [];
  for (const action of Object.keys(PLATFORM_ACTION_PHRASES) as PlatformAction[]) {
    if (!can.has(action) || covered.has(action)) continue;
    if (managesTenants && (action === "tenant.create" || action === "tenant.change_status")) {
      if (!out.includes(TENANT_MANAGE_PHRASE)) out.push(TENANT_MANAGE_PHRASE);
      continue;
    }
    out.push(PLATFORM_ACTION_PHRASES[action]);
  }
  return out;
}

/** 这个角色负责的模块还没有上线：现在登录后只能看主数据。 */
export function roleNotLiveYet(role: PlatformRole): boolean {
  const actions = platformPermissions(role);
  return actions.length === 1 && actions[0] === "master_data.read";
}

/** 发起以后不知道有没有成功（网络不通、超时、服务器出错）。 */
export function isUnsure(err: unknown): boolean {
  return err instanceof NetworkError || (err instanceof ApiError && (err.status >= 500 || err.code === "UNKNOWN"));
}

/** 页面的邮箱格式检查比后端松（「山田@example.com」「a@b.c」这里放过、后端不认）：后端 400 点名邮箱这一项时，出错落在邮箱字段下面。 */
export const EMAIL_REFUSED_TEXT = "系统不接受这个邮箱地址。请核对有没有写错：@ 前面只能是英文字母、数字和常见符号，@ 后面要是完整的域名（如 example.com）。";

export function emailRefused(err: unknown): boolean {
  if (!(err instanceof ApiError) || err.code !== "VALIDATION_FAILED") return false;
  const issues = err.details["issues"];
  return Array.isArray(issues) && issues.some((issue: unknown) => typeof issue === "object" && issue !== null && /(^|\/)email$/.test(String((issue as { path?: unknown }).path ?? "")));
}
