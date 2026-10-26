/**
 * 供应商入驻（M4-01，ADR 0028）在页面上的说法：状态、暂停和观察的原因、资质的现状、状态记录的动作、提醒、评分。
 * 两个后台用同一套，供应商后台不写平台内部的说明。
 */
import type { DocumentRequirement, DocumentStatus, NoticeKind, RequirementState, ScoreComponentKey, StatusTrigger, TenantIssue, TenantNotice, TenantStatusEvent } from "../api/onboarding.ts";
import type { ObservationReason, SuspensionReason, Tenant, TenantStatus } from "../api/types.ts";
import type { BadgeSpec } from "../components/StatusBadge.tsx";

export const TENANT_STATUS_NAMES: Readonly<Record<TenantStatus, string>> = {
  applying: "申请中",
  reviewing: "审核中",
  signed: "已签约",
  trial: "试运营",
  active: "正常",
  suspended: "已暂停",
  terminated: "已清退",
};

/** 每个状态一句话：现在能做什么。 */
export const TENANT_STATUS_HINTS: Readonly<Record<TenantStatus, string>> = {
  applying: "填企业信息、上传资质，交齐后提交审核。",
  reviewing: "资质正在审核。审核通过、合同生效后签约。",
  signed: "可以建区域和商品，还不能上架。完成测试单后开始试运营。",
  trial: "可以上架、参与比价，每天最多接 10 单。满 30 天、完成 20 单且没有重大投诉后自动转正式。",
  active: "正常参与比价，没有每日订单上限。",
  suspended: "商品不参与比价、不能接新订单；已经接下的订单照常履约。",
  terminated: "只能查看历史，不能再修改。",
};

export const SUSPENSION_REASON_NAMES: Readonly<Record<SuspensionReason, string>> = {
  manual: "人工暂停",
  document_expired: "必交资质已到期",
  score_below_red_line: "履约评分低于 3.50",
  driver_no_show: "近 30 天司机未到 3 次",
};

export const OBSERVATION_REASON_NAMES: Readonly<Record<ObservationReason, string>> = {
  score_below_threshold: "履约评分低于 4.00",
  driver_no_show: "近 30 天司机未到 2 次",
};

export function suspensionText(reasons: readonly string[]): string {
  return reasons.map((reason) => SUSPENSION_REASON_NAMES[reason as SuspensionReason] ?? reason).join("、");
}

export function observationText(reasons: readonly string[]): string {
  return reasons.map((reason) => OBSERVATION_REASON_NAMES[reason as ObservationReason] ?? reason).join("、");
}

export const REQUIREMENT_BADGES: Readonly<Record<RequirementState, BadgeSpec>> = {
  missing: { tone: "neutral", label: "未提交" },
  pending: { tone: "info", label: "审核中" },
  rejected: { tone: "danger", label: "已驳回" },
  supplement_requested: { tone: "warning", label: "要求补充" },
  approved: { tone: "success", label: "已通过" },
  expiring: { tone: "warning", label: "快到期" },
  expired: { tone: "danger", label: "已到期" },
};

/**
 * 资质清单「到期日」一列：已通过的那一份的到期日（快到期时带剩几天）；还没有通过的、或换证时新交的一份在审核中，
 * 也写出供应商填的到期日并标「审核中」——审核前就看得到填的是哪天（M4-10）。
 */
export function requirementExpiryText(item: Pick<DocumentRequirement, "expiry" | "approved_document_id" | "expires_on" | "days_left">, latest: { id: string; status: DocumentStatus; expires_on: string | null } | undefined): string {
  const pending = latest !== undefined && latest.status === "pending" && latest.id !== item.approved_document_id && latest.expires_on !== null ? latest.expires_on : null;
  if (item.expires_on === null) {
    if (pending !== null) return `${pending}（审核中）`;
    return item.expiry === "none" ? "无到期日" : "—";
  }
  const current = `${item.expires_on}${item.days_left !== null && item.days_left > 0 ? `（还有 ${item.days_left} 天）` : ""}`;
  return pending !== null && pending !== item.expires_on ? `${current}；新的一份 ${pending}（审核中）` : current;
}

export const DOCUMENT_STATUS_BADGES: Readonly<Record<DocumentStatus, BadgeSpec>> = {
  pending: { tone: "info", label: "审核中" },
  approved: { tone: "success", label: "已通过" },
  rejected: { tone: "danger", label: "已驳回" },
  supplement_requested: { tone: "warning", label: "要求补充" },
  superseded: { tone: "neutral", label: "已被新证件取代" },
};

export const TRIGGER_NAMES: Readonly<Record<StatusTrigger, string>> = {
  submit: "提交审核",
  return: "退回补充",
  sign: "签约",
  start_trial: "开始试运营",
  promote: "转为正式",
  suspend: "暂停",
  resume: "恢复",
  terminate: "清退",
  observation: "观察期变化",
};

export const ACTOR_NAMES: Readonly<Record<TenantStatusEvent["actor"]["type"], string>> = {
  tenant_user: "供应商",
  platform_user: "平台",
  system: "系统（每日检查）",
};

/** 一条状态记录写成一句话：「审核中 → 已签约」「进入观察期：评分低于 4.00」。 */
export function statusEventText(event: TenantStatusEvent): string {
  const parts: string[] = [];
  if (event.from_status !== event.to_status) parts.push(`${TENANT_STATUS_NAMES[event.from_status]} → ${TENANT_STATUS_NAMES[event.to_status]}`);
  const added = event.suspension_after.filter((reason) => !event.suspension_before.includes(reason));
  const removed = event.suspension_before.filter((reason) => !event.suspension_after.includes(reason));
  if (added.length > 0) parts.push(`暂停原因：${suspensionText(added)}`);
  if (removed.length > 0 && event.to_status === "suspended") parts.push(`消除：${suspensionText(removed)}`);
  if (event.observation_before.length === 0 && event.observation_after.length > 0) parts.push(`进入观察期：${observationText(event.observation_after)}`);
  else if (event.observation_before.length > 0 && event.observation_after.length === 0) parts.push("退出观察期");
  else if (event.observation_before.join() !== event.observation_after.join()) parts.push(`观察原因：${observationText(event.observation_after)}`);
  return parts.length === 0 ? TRIGGER_NAMES[event.trigger] : parts.join("；");
}

const ISSUE_TEXT: Readonly<Record<string, string>> = {
  DOCUMENT_MISSING: "还没有提交",
  DOCUMENT_NEEDS_RESUBMISSION: "被驳回或要求补充，要重新提交一份",
  DOCUMENT_EXPIRED: "已到期，要换一份在有效期内的",
  DOCUMENT_NOT_APPROVED: "还没有审核通过",
  CONTRACT_NOT_EFFECTIVE: "还没有已生效的合同",
  NO_PUBLISHABLE_PRODUCT: "还没有通过上架校验的商品",
  DOCUMENTS_INVALID: "必交资质不全或已到期",
  REQUIRED: "必填",
};

const PROFILE_FIELD_NAMES: Readonly<Record<string, string>> = {
  country_code: "所在国家",
  legal_name: "法定名称",
  registration_no: "登记号",
  address: "地址",
  contact_name: "联系人",
  contact_phone: "联系电话",
  contact_email: "联系邮箱",
};

/** 「下一步还缺什么」的一条：资质用证件名，企业信息用字段名。 */
export function issueText(issue: TenantIssue, typeNames: Readonly<Record<string, string>>): string {
  const [, scope, key] = issue.path.split("/");
  const what = scope === "documents" ? (typeNames[key ?? ""] ?? key ?? "") : scope === "company" ? (PROFILE_FIELD_NAMES[key ?? ""] ?? key ?? "") : scope === "contract" ? "合同" : scope === "products" ? "商品" : scope === "test_order_note" ? "测试单说明" : "资质";
  const reason = ISSUE_TEXT[issue.reason] ?? issue.reason;
  return scope === "contract" || scope === "products" || (scope === "documents" && issue.reason === "DOCUMENTS_INVALID") ? reason : `${what}：${reason}`;
}

export const SCORE_COMPONENT_NAMES: Readonly<Record<ScoreComponentKey, string>> = {
  dispatch: "按时派车率",
  arrival: "准时到达率",
  rating: "客人评价均分",
  complaint: "投诉率",
  failure: "履约失败率",
};

/** 百分之一分 → 「4.50」。 */
export function scoreText(centi: number | null): string {
  return centi === null ? "—" : (centi / 100).toFixed(2);
}

/** 基点 → 「95.0%」。 */
export function rateText(bp: number | null): string {
  return bp === null ? "没有数据" : `${(bp / 100).toFixed(1)}%`;
}

/** 一项指标的值：评价是均分，其余是比率。 */
export function componentValueText(key: ScoreComponentKey, value: number | null): string {
  if (value === null) return "没有数据";
  return key === "rating" ? `${scoreText(value)} 分` : rateText(value);
}

/** 供应商主体上现在要提醒的事：暂停的原因、观察期。没有为 null。 */
export function standingNotice(tenant: Pick<Tenant, "status" | "suspension_reasons" | "observation_reasons">): { kind: "warning" | "info"; title: string; text: string } | null {
  if (tenant.status === "suspended") return { kind: "warning", title: "已暂停。", text: `原因：${suspensionText(tenant.suspension_reasons ?? [])}。${TENANT_STATUS_HINTS.suspended}` };
  if ((tenant.observation_reasons ?? []).length > 0) return { kind: "info", title: "在观察期。", text: `原因：${observationText(tenant.observation_reasons)}。观察期里比价时排序价按对外价 ×1.05 计算，更难中标；原因消除后自动退出。` };
  return null;
}

const NOTICE_TEXT: Readonly<Record<NoticeKind, (data: Record<string, unknown>, typeNames: Readonly<Record<string, string>>) => string>> = {
  document_expiring: (data, names) => `${names[String(data["type"])] ?? "资质"}将在 ${String(data["expires_on"])} 到期（还有 ${String(data["days_left"])} 天），请尽快上传新的证件。`,
  document_expired: (data, names) => `${names[String(data["type"])] ?? "资质"}已于 ${String(data["expires_on"])} 到期。${data["required"] === true ? "这是必交资质，供应商已被暂停，换上新证件审核通过后自动恢复。" : ""}`,
  document_reviewed: (data, names) => `${names[String(data["type"])] ?? "资质"}${data["status"] === "approved" ? "已审核通过" : data["status"] === "rejected" ? `被驳回：${String(data["reason"] ?? "")}` : `需要补充：${String(data["reason"] ?? "")}`}`,
  status_changed: (data) => `状态变为「${TENANT_STATUS_NAMES[data["to"] as TenantStatus] ?? String(data["to"])}」${data["to"] === "suspended" && Array.isArray(data["suspension_reasons"]) ? `（${suspensionText(data["suspension_reasons"] as string[])}）` : ""}`,
  observation_started: (data) => `进入观察期：${observationText(Array.isArray(data["reasons"]) ? (data["reasons"] as string[]) : [])}。请尽快整改。`,
  observation_ended: () => "已退出观察期。",
};

export function noticeText(notice: TenantNotice, typeNames: Readonly<Record<string, string>>): string {
  return NOTICE_TEXT[notice.kind](notice.data, typeNames);
}

/** 文件大小：「1.2 MB」「320 KB」。 */
export function fileSizeText(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_FILE_TYPES = "application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png";
