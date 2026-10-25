/**
 * 供应商（租户）的入驻、资质、合同、状态机、履约评分（M4-01，ADR 0028）。纯函数，不碰数据库和网络。
 *
 * 需求：《平台运营端与渠道对接》「租户管理」（状态表、资质审核、合同与结算条款、履约评分、租户详情页）、
 * 「履约保障与服务标准」（救援计 1 次履约失败；30 天内司机未到 2 次观察、3 次暂停；中标排序的准入过滤）；
 * 《用车报价服务平台》「12. 资质认证」。文末决策：第三轮（低于 4.0 观察、低于 3.5 暂停；试运营每日 10 单、30 天 / 20 单转正式）。
 */
import { roundFractionHalfAwayFromZero } from "./money.ts";
import { addDays } from "./pricing.ts";
import { QUOTE_RULES } from "./quote.ts";
import { instantToLocal, localDateTimeToInstant } from "./service-time.ts";

// ---- 常数 ----

export const TENANT_RULES = {
  /**
   * 「今天」按哪个时区算：资质到期、每日评分、试运营的每日订单上限都按它。
   * 平台在日本运营，首批供应商在日本和韩国（同一个时差）；以后有别的时区的供应商时再按供应商所在国家分开（ADR 0028）。
   */
  timeZone: "Asia/Tokyo",
  /** 试运营每日订单上限（「试运营：每日订单上限（默认 10 单）」） */
  trialDailyOrderLimit: 10,
  /** 试运营满 30 天且完成 ≥ 20 单、无重大投诉转正式 */
  trialMinDays: 30,
  trialMinCompletedOrders: 20,
  /** 评分按最近 90 天滚动计算 */
  scoreWindowDays: 90,
  /** 评分低于 4.0 进入观察期，低于 3.5 自动暂停（百分之一分） */
  observationBelowCenti: 400,
  suspendBelowCenti: 350,
  /** 30 天内司机未到 2 次自动进入观察期，3 次自动暂停待复核 */
  noShowWindowDays: 30,
  noShowObservationCount: 2,
  noShowSuspendCount: 3,
  /** 证件到期前 30 天、7 天各提醒一次 */
  expiryReminderDays: [30, 7] as readonly number[],
  /** 资质文件：最大 10 MB；PDF、JPEG、PNG */
  maxFileBytes: 10 * 1024 * 1024,
  /** 一份文件的名字最长多少个字符（只用来显示和下载） */
  maxFileNameLength: 200,
  /** 驳回、要求补充、暂停、清退的原因最长多少个字符 */
  maxReasonLength: 500,
} as const;

/** 评分五项的权重（基点，合计 10,000；需求「履约评分」的建议权重，第三轮决策「五项权重沿用」）。 */
export const SCORE_WEIGHTS_BP = {
  dispatch: 2_500,
  arrival: 2_500,
  rating: 2_000,
  complaint: 2_000,
  failure: 1_000,
} as const;

export type ScoreComponent = keyof typeof SCORE_WEIGHTS_BP;

// ---- 状态 ----

/**
 * 供应商的入驻状态（需求「租户状态」表）。「观察期」不是单独的状态，是试运营 / 正式供应商身上的一个标记（排序价 ×1.05），
 * 它和「暂停」可以同时存在（暂停期间观察的原因照样每天重算，恢复后马上生效）。
 */
export const TENANT_STATUSES = ["applying", "reviewing", "signed", "trial", "active", "suspended", "terminated"] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export const TENANT_STATUS_NAMES: Readonly<Record<TenantStatus, string>> = {
  applying: "申请中",
  reviewing: "审核中",
  signed: "已签约",
  trial: "试运营",
  active: "正常",
  suspended: "暂停",
  terminated: "已清退",
};

export function isTenantStatus(value: string): value is TenantStatus {
  return (TENANT_STATUSES as readonly string[]).includes(value);
}

/** 只有「试运营」和「正式」状态的供应商参与比价（需求「租户管理」）。 */
export function tenantBids(status: TenantStatus): boolean {
  return status === "trial" || status === "active";
}

/** 能上架商品的状态：试运营、正式；暂停的可以照常维护（不参与比价，恢复后马上能卖）。申请中、审核中、已签约、已清退不能上架。 */
export function tenantCanPublish(status: TenantStatus): boolean {
  return status === "trial" || status === "active" || status === "suspended";
}

/** 已清退：「只能查看历史和账单」，所有修改都拒绝。 */
export function tenantReadOnly(status: TenantStatus): boolean {
  return status === "terminated";
}

/** 暂停的原因。可以同时有几个；全部消除才恢复。 */
export const SUSPENSION_REASONS = ["manual", "document_expired", "score_below_red_line", "driver_no_show"] as const;
export type SuspensionReason = (typeof SUSPENSION_REASONS)[number];

/** 进入观察期的原因。每天按最新的数据重算：原因都没有了就自动退出观察期。 */
export const OBSERVATION_REASONS = ["score_below_threshold", "driver_no_show"] as const;
export type ObservationReason = (typeof OBSERVATION_REASONS)[number];

/** 状态的触发动作：谁能做在 `TENANT_TRANSITIONS` 里。 */
export const TENANT_TRIGGERS = ["submit", "return", "sign", "start_trial", "promote", "suspend", "resume", "terminate"] as const;
export type TenantTrigger = (typeof TENANT_TRIGGERS)[number];

export type TenantActorKind = "tenant" | "platform" | "system";

interface TransitionRule {
  from: readonly TenantStatus[];
  /** `previous`：回到暂停之前的状态（试运营或正式） */
  to: TenantStatus | "previous";
  by: readonly TenantActorKind[];
}

/**
 * 状态机（ADR 0028「状态和转换」）：
 * - 提交审核：供应商管理员，申请中 → 审核中（资质齐全）；
 * - 退回：审核中有一份资质被驳回或要求补充 → 申请中（系统随审核动作自动做）；
 * - 签约：运营，审核中 → 已签约（必交资质全部审核通过 + 有一份已生效的合同）；
 * - 开始试运营：运营，已签约 → 试运营（至少 1 个商品通过上架校验 + 完成一次测试单）；
 * - 转正式：系统每天检查，试运营满 30 天且完成 ≥ 20 单、无重大投诉；
 * - 暂停：系统（资质过期、评分低于 3.5、30 天内司机未到 3 次）或运营（人工暂停，双人复核）；已暂停的再加一个原因；
 * - 恢复：运营（人工恢复）；只因资质过期而暂停的，换上新证件审核通过后系统自动恢复；
 * - 清退：运营（双人复核），已有订单全部履约完毕。
 */
export const TENANT_TRANSITIONS: Readonly<Record<TenantTrigger, TransitionRule>> = {
  submit: { from: ["applying"], to: "reviewing", by: ["tenant"] },
  return: { from: ["reviewing"], to: "applying", by: ["platform", "system"] },
  sign: { from: ["reviewing"], to: "signed", by: ["platform"] },
  start_trial: { from: ["signed"], to: "trial", by: ["platform"] },
  promote: { from: ["trial"], to: "active", by: ["system"] },
  suspend: { from: ["trial", "active", "suspended"], to: "suspended", by: ["platform", "system"] },
  resume: { from: ["suspended"], to: "previous", by: ["platform", "system"] },
  terminate: { from: ["applying", "reviewing", "signed", "trial", "active", "suspended"], to: "terminated", by: ["platform"] },
};

export type TransitionRefusal = "TENANT_STATE_INVALID" | "TENANT_TRIGGER_NOT_ALLOWED";

/**
 * 这个动作能不能做、做完是什么状态。`resumeTo` 是暂停之前的状态（试运营或正式），只有恢复用得到。
 * 不能做时返回原因：当前状态不允许（`TENANT_STATE_INVALID`）、这个人不能触发这个动作（`TENANT_TRIGGER_NOT_ALLOWED`）。
 */
export function tenantTransition(status: TenantStatus, trigger: TenantTrigger, by: TenantActorKind, resumeTo: TenantStatus | null = null): { ok: true; to: TenantStatus } | { ok: false; refusal: TransitionRefusal } {
  const rule = TENANT_TRANSITIONS[trigger];
  if (!rule.by.includes(by)) return { ok: false, refusal: "TENANT_TRIGGER_NOT_ALLOWED" };
  if (!rule.from.includes(status)) return { ok: false, refusal: "TENANT_STATE_INVALID" };
  if (rule.to !== "previous") return { ok: true, to: rule.to };
  if (resumeTo !== "trial" && resumeTo !== "active") return { ok: false, refusal: "TENANT_STATE_INVALID" };
  return { ok: true, to: resumeTo };
}

// ---- 资质 ----

/** 证件类型。`other`：补充材料，不在任何国家的必交清单里。 */
export const DOCUMENT_TYPES = [
  "commercial_registration",
  "business_license",
  "passenger_transport_license",
  "passenger_liability_insurance",
  "vehicle_insurance",
  "settlement_account",
  "other",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export function isDocumentType(value: string): value is DocumentType {
  return (DOCUMENT_TYPES as readonly string[]).includes(value);
}

/** 每种证件：名称、有没有到期日（`required` 必填、`optional` 可填、`none` 没有）。 */
export const DOCUMENT_TYPE_INFO: Readonly<Record<DocumentType, { name: string; expiry: "required" | "optional" | "none" }>> = {
  commercial_registration: { name: "登记簿謄本（履历事项全部证明书）", expiry: "none" },
  business_license: { name: "营业执照", expiry: "optional" },
  passenger_transport_license: { name: "旅客运输营运许可", expiry: "required" },
  passenger_liability_insurance: { name: "旅客赔偿责任保险", expiry: "required" },
  vehicle_insurance: { name: "营运车辆商业保险", expiry: "required" },
  settlement_account: { name: "结算账户证明", expiry: "none" },
  other: { name: "其他补充材料", expiry: "optional" },
};

/**
 * 按国家的必交资料清单（需求「资质审核」：按国家配置必交资料清单）。
 * 日本：登记簿謄本、一般乘用旅客自动车运送事业许可（绿牌）、旅客赔偿责任保险、结算账户证明；「营运资质为必审项」另要营运车辆商业保险。
 * 其他国家：《用车报价服务平台》「12. 资质认证」的四项——营业执照、旅客运输许可、保险证明、结算账户。当地法规要增补的，按国家加一行。
 */
const REQUIRED_DOCUMENTS: Readonly<Record<string, readonly DocumentType[]>> = {
  JP: ["commercial_registration", "passenger_transport_license", "passenger_liability_insurance", "vehicle_insurance", "settlement_account"],
};
const DEFAULT_REQUIRED_DOCUMENTS: readonly DocumentType[] = ["business_license", "passenger_transport_license", "vehicle_insurance", "settlement_account"];

export function requiredDocumentTypes(countryCode: string | null): readonly DocumentType[] {
  return (countryCode === null ? undefined : REQUIRED_DOCUMENTS[countryCode]) ?? DEFAULT_REQUIRED_DOCUMENTS;
}

export const DOCUMENT_STATUSES = ["pending", "approved", "rejected", "supplement_requested", "superseded"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/** 一份提交上来的证件（判断要用的部分）。日期都是 `YYYY-MM-DD`。 */
export interface DocumentFact {
  id: string;
  type: DocumentType;
  status: DocumentStatus;
  expiresOn: string | null;
  /** 提交的先后（数据库的序号）：同一类型里大的是新的 */
  seq: number;
}

/**
 * 证件到期：需求「到期当天租户自动转暂停」——到期日那一天起就不算有效。没有到期日的一直有效。
 * 返回离到期还有几天（今天到期 = 0、已过期为负）；没有到期日为 null。
 */
export function daysUntilExpiry(expiresOn: string | null, today: string): number | null {
  if (expiresOn === null) return null;
  return Math.round((Date.parse(`${expiresOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

export function documentValidOn(document: Pick<DocumentFact, "expiresOn">, today: string): boolean {
  const left = daysUntilExpiry(document.expiresOn, today);
  return left === null || left > 0;
}

export type RequirementState = "missing" | "pending" | "rejected" | "supplement_requested" | "approved" | "expiring" | "expired";

/** 一项必交（或已交的补充）资质现在的情况。 */
export interface DocumentRequirement {
  type: DocumentType;
  required: boolean;
  state: RequirementState;
  /** 现在生效的那份（审核通过的里面最新的一份），没有为 null */
  approved: DocumentFact | null;
  /** 最近提交的一份（可能就是 approved，也可能是在审核中的换证） */
  latest: DocumentFact | null;
  /** approved 离到期还有几天；没有到期日、或没有通过的为 null */
  daysLeft: number | null;
  /** latest 离到期还有几天；没有到期日为 null */
  latestDaysLeft: number | null;
}

/**
 * 按国家清单逐项看资质：
 * - 生效的那份 = 审核通过的里面最新提交的；它过期了算 `expired`，30 天内到期算 `expiring`；
 * - 没有通过的，看最近一次提交：审核中 / 被驳回 / 要求补充；什么都没交过是 `missing`。
 * 另交了不在清单里的类型（补充材料等），也列出来，`required` 为 false。
 */
export function documentRequirements(countryCode: string | null, documents: readonly DocumentFact[], today: string): DocumentRequirement[] {
  const required = requiredDocumentTypes(countryCode);
  const extra = DOCUMENT_TYPES.filter((type) => !required.includes(type) && documents.some((document) => document.type === type && document.status !== "superseded"));
  return [...required, ...extra].map((type) => {
    const ofType = documents.filter((document) => document.type === type && document.status !== "superseded").sort((a, b) => a.seq - b.seq);
    const approved = ofType.filter((document) => document.status === "approved").at(-1) ?? null;
    const latest = ofType.at(-1) ?? null;
    const daysLeft = approved === null ? null : daysUntilExpiry(approved.expiresOn, today);
    const reminderWindow = TENANT_RULES.expiryReminderDays[0] as number;
    const state: RequirementState =
      approved !== null
        ? daysLeft !== null && daysLeft <= 0
          ? "expired"
          : daysLeft !== null && daysLeft <= reminderWindow
            ? "expiring"
            : "approved"
        : latest === null
          ? "missing"
          : latest.status === "pending"
            ? "pending"
            : latest.status === "rejected"
              ? "rejected"
              : latest.status === "supplement_requested"
                ? "supplement_requested"
                : "missing";
    return { type, required: required.includes(type), state, approved, latest, daysLeft, latestDaysLeft: latest === null ? null : daysUntilExpiry(latest.expiresOn, today) };
  });
}

/**
 * 有没有必交资质**过期了**（审核通过过、到了到期日，还没有换上新的）。自动暂停、恢复看的是这一条——「资质过期」：
 * 从没交过的不算过期（M4-01 之前就在运营的供应商没有资质记录，不会因此被暂停；签约、开始试运营另有「全部有效」的要求）。
 */
export function requiredDocumentsExpired(requirements: readonly DocumentRequirement[]): DocumentType[] {
  return requirements.filter((item) => item.required && item.state === "expired").map((item) => item.type);
}

/** 必交资质是不是都有效（审核通过且没过期）。签约、开始试运营要求这一条。 */
export function requiredDocumentsValid(requirements: readonly DocumentRequirement[]): boolean {
  return requirements.filter((item) => item.required).every((item) => item.state === "approved" || item.state === "expiring");
}

export interface TenantIssue {
  path: string;
  reason: string;
  detail?: Record<string, string | number>;
}

/** 供应商的企业信息（提交审核前要填齐）。 */
export interface CompanyProfile {
  countryCode: string | null;
  legalName: string | null;
  registrationNo: string | null;
  address: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
}

const PROFILE_FIELDS: readonly [keyof CompanyProfile, string][] = [
  ["countryCode", "/country_code"],
  ["legalName", "/legal_name"],
  ["registrationNo", "/registration_no"],
  ["address", "/address"],
  ["contactName", "/contact_name"],
  ["contactPhone", "/contact_phone"],
  ["contactEmail", "/contact_email"],
];

/**
 * 提交审核（申请中 → 审核中）还缺什么：企业信息每一项都要填；每项必交资质都要有一份在审核中或已通过、没过期的（「资质齐全」）。
 * 被驳回、要求补充的那一项要重新交一份。
 */
export function submitIssues(profile: CompanyProfile | null, requirements: readonly DocumentRequirement[]): TenantIssue[] {
  const issues: TenantIssue[] = [];
  for (const [field, path] of PROFILE_FIELDS) {
    const value = profile?.[field] ?? null;
    if (value === null || value.trim() === "") issues.push({ path: `/company${path}`, reason: "REQUIRED" });
  }
  for (const item of requirements.filter((entry) => entry.required)) {
    if (item.state === "approved" || item.state === "expiring") continue;
    if (item.state === "pending") {
      // 在审核中的这份交上来以后已经过了到期日：要换一份
      if (item.latestDaysLeft !== null && item.latestDaysLeft <= 0) issues.push({ path: `/documents/${item.type}`, reason: "DOCUMENT_EXPIRED" });
      continue;
    }
    issues.push({ path: `/documents/${item.type}`, reason: item.state === "expired" ? "DOCUMENT_EXPIRED" : item.state === "missing" ? "DOCUMENT_MISSING" : "DOCUMENT_NEEDS_RESUBMISSION" });
  }
  return issues;
}

/** 签约（审核中 → 已签约）还缺什么：必交资质全部审核通过且有效；有一份已生效的合同。 */
export function signIssues(requirements: readonly DocumentRequirement[], hasEffectiveContract: boolean): TenantIssue[] {
  const issues: TenantIssue[] = [];
  for (const item of requirements.filter((entry) => entry.required)) {
    if (item.state !== "approved" && item.state !== "expiring") issues.push({ path: `/documents/${item.type}`, reason: item.state === "expired" ? "DOCUMENT_EXPIRED" : "DOCUMENT_NOT_APPROVED" });
  }
  if (!hasEffectiveContract) issues.push({ path: "/contract", reason: "CONTRACT_NOT_EFFECTIVE" });
  return issues;
}

/** 开始试运营（已签约 → 试运营）还缺什么：至少 1 个商品通过上架校验；完成一次测试单（运营填写测试单的说明）；资质仍然有效。 */
export function startTrialIssues(input: { publishableProducts: number; testOrderNote: string | null; documentsValid: boolean }): TenantIssue[] {
  const issues: TenantIssue[] = [];
  if (input.publishableProducts < 1) issues.push({ path: "/products", reason: "NO_PUBLISHABLE_PRODUCT" });
  if (input.testOrderNote === null || input.testOrderNote.trim() === "") issues.push({ path: "/test_order_note", reason: "REQUIRED" });
  if (!input.documentsValid) issues.push({ path: "/documents", reason: "DOCUMENTS_INVALID" });
  return issues;
}

/** 到了转正式的条件没有：试运营满 30 天（按时刻算）、试运营以来完成 ≥ 20 单、没有成立的重大投诉。 */
export function trialPromotionDue(input: { trialStartedAt: Date; now: Date; completedSinceTrial: number; majorComplaintsSinceTrial: number }): boolean {
  const days = (input.now.getTime() - input.trialStartedAt.getTime()) / 86_400_000;
  return days >= TENANT_RULES.trialMinDays && input.completedSinceTrial >= TENANT_RULES.trialMinCompletedOrders && input.majorComplaintsSinceTrial === 0;
}

/** 提交一份证件时的检查：类型认识；该有到期日的要有、格式对、不能已经过期（今天到期也算过期）；没有到期日的类型不能填。 */
export function documentInputIssues(input: { type: string; expiresOn: string | null; note: string | null }, today: string): TenantIssue[] {
  const issues: TenantIssue[] = [];
  if (!isDocumentType(input.type)) return [{ path: "/type", reason: "UNKNOWN_DOCUMENT_TYPE" }];
  const rule = DOCUMENT_TYPE_INFO[input.type].expiry;
  if (input.expiresOn === null) {
    if (rule === "required") issues.push({ path: "/expires_on", reason: "REQUIRED" });
  } else if (rule === "none") {
    issues.push({ path: "/expires_on", reason: "NOT_APPLICABLE" });
  } else if (!isCalendarDate(input.expiresOn)) {
    issues.push({ path: "/expires_on", reason: "INVALID_DATE" });
  } else if ((daysUntilExpiry(input.expiresOn, today) as number) <= 0) {
    issues.push({ path: "/expires_on", reason: "ALREADY_EXPIRED", detail: { today } });
  }
  if (input.note !== null && input.note.length > TENANT_RULES.maxReasonLength) issues.push({ path: "/note", reason: "TOO_LONG", detail: { max: TENANT_RULES.maxReasonLength } });
  return issues;
}

/** 真实存在的日历日期（`YYYY-MM-DD`，2000–2099 年）。 */
export function isCalendarDate(value: string): boolean {
  if (!/^20\d\d-\d\d-\d\d$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
}

/** 今天到期提醒该不该发：返回这一次要发的那一档（30 或 7），不该发为 null。已经发过的档在 `sent` 里。 */
export function expiryReminderDue(daysLeft: number | null, sent: readonly number[]): number | null {
  if (daysLeft === null || daysLeft <= 0) return null;
  // 从近到远找：到期前 7 天内只发 7 天那一档（30 天那档错过了也不补发——人已经能看到更急的提醒）
  const tiers = [...TENANT_RULES.expiryReminderDays].sort((a, b) => a - b);
  const tier = tiers.find((days) => daysLeft <= days);
  if (tier === undefined || sent.includes(tier)) return null;
  return tier;
}

// ---- 资质文件 ----

export const DOCUMENT_FILE_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
export type DocumentFileType = (typeof DOCUMENT_FILE_TYPES)[number];

/** 按文件开头的字节判断格式（不信请求里声明的类型）：PDF（`%PDF-`）、JPEG（FF D8 FF）、PNG（89 50 4E 47 0D 0A 1A 0A）。别的都不认。 */
export function detectDocumentFileType(bytes: Uint8Array): DocumentFileType | null {
  const starts = (signature: readonly number[]): boolean => bytes.length >= signature.length && signature.every((byte, index) => bytes[index] === byte);
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  if (starts([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  return null;
}

/** 文件名：去掉路径和控制字符，最长 200 个字符；去掉之后是空的用「文件」。只用来显示和下载时的建议文件名。 */
export function cleanFileName(raw: string | null): string {
  const base = (raw ?? "").split(/[\\/]/).at(-1) ?? "";
  const cleaned = [...base.replace(/[\p{Cc}\p{Cf}"]/gu, "").trim()].slice(0, TENANT_RULES.maxFileNameLength).join("");
  return cleaned === "" ? "文件" : cleaned;
}

// ---- 合同 ----

/** 合同的结算条款里固定的部分（需求「合同与结算条款」，已确认）：月结、次月 20 日付款、平台不收服务费、不收保证金。 */
export const CONTRACT_TERMS = { settleCycle: "monthly", paymentDay: 20, serviceFeeBp: 0, depositMinor: 0 } as const;

/**
 * 新的合同版本：生效日期不早于今天（不追溯修改已经过去的结算条款），并且晚于已有的最后一个版本的生效日期（版本按生效日期排列，一个日期只有一个版本）。
 * 结算币种由调用方核对是不是平台支持的币种。
 */
export function contractIssues(input: { validFrom: string; note: string | null }, context: { today: string; latestValidFrom: string | null }): TenantIssue[] {
  const issues: TenantIssue[] = [];
  if (!isCalendarDate(input.validFrom)) issues.push({ path: "/valid_from", reason: "INVALID_DATE" });
  else if (input.validFrom < context.today) issues.push({ path: "/valid_from", reason: "IN_THE_PAST", detail: { today: context.today } });
  else if (context.latestValidFrom !== null && input.validFrom <= context.latestValidFrom) issues.push({ path: "/valid_from", reason: "NOT_AFTER_LATEST", detail: { latest_valid_from: context.latestValidFrom } });
  if (input.note !== null && input.note.length > TENANT_RULES.maxReasonLength) issues.push({ path: "/note", reason: "TOO_LONG", detail: { max: TENANT_RULES.maxReasonLength } });
  return issues;
}

/** 某一天生效的合同版本：生效日期不晚于这一天的里面最晚的那个。 */
export function effectiveContract<T extends { validFrom: string }>(contracts: readonly T[], today: string): T | null {
  return [...contracts].filter((contract) => contract.validFrom <= today).sort((a, b) => a.validFrom.localeCompare(b.validFrom)).at(-1) ?? null;
}

// ---- 履约评分 ----

/**
 * 算评分要的数（最近 90 天）。来源（ADR 0028「评分的输入」）：
 * - 完成订单数：订单状态流水里变成「已完成」的；
 * - 按时派车 / 准时到达：履约事件（每单一条，派车在截止时间前 / 用车时间前到达上车点）；
 * - 客人评价：评价表（1–5 分）；
 * - 投诉：成立的投诉；履约失败：救援改派、司机未到、重大迟到。
 */
export interface ScoreInput {
  completedOrders: number;
  dispatch: { onTime: number; total: number };
  arrival: { onTime: number; total: number };
  ratings: { sum: number; count: number };
  upheldComplaints: number;
  failures: number;
}

export interface ScoreComponentResult {
  /** 这一项的比率（基点）；评价是均分（百分之一分）。没有数据为 null */
  value: number | null;
  /** 这一项折算成 0–5 分（百分之一分）；没有数据为 null */
  pointsCenti: number | null;
  /** 实际用的权重（没有数据的项不算，其余按比例放大） */
  weightBp: number;
}

export interface ScoreResult {
  /** 按数据算出来的分（百分之一分）；什么数据都没有为 null */
  rawScoreCenti: number | null;
  /** 比价用的分：完成不足 20 单、或没有数据时是默认 4.5 */
  scoreCenti: number;
  isDefault: boolean;
  components: Record<ScoreComponent, ScoreComponentResult>;
}

/** 默认分和「完成不足多少单用默认分」与报价引擎同一处定义（ADR 0020） */
export const DEFAULT_SCORE_CENTI: number = QUOTE_RULES.defaultScoreCenti;
export const MIN_ORDERS_FOR_SCORE: number = QUOTE_RULES.minOrdersForScore;

/**
 * 履约评分（满分 5 分；需求「履约评分」）：
 * - 按时派车率、准时到达率：按时数 / 总数，折成 5 分制（100% = 5 分）；
 * - 客人评价均分：1–5 分的平均；
 * - 投诉率 = 成立的投诉 / 完成订单（超过 1 按 1），得分 = 5 × (1 − 投诉率)；
 * - 履约失败率 = 失败次数 / (完成订单 + 失败次数)，得分 = 5 × (1 − 失败率)；
 * - 加权平均（25 / 25 / 20 / 20 / 10）。某一项没有数据（没有派车记录、没有评价……）就不算这一项，其余项的权重按比例放大；
 *   一项都没有为 null。全程用整数分数精确计算，最后四舍五入到百分之一分一次。
 * - 完成不足 20 单（新供应商前 20 单）用默认 4.5。
 */
export function computeTenantScore(input: ScoreInput): ScoreResult {
  const completed = nonNegative(input.completedOrders);
  const failures = nonNegative(input.failures);
  // 每一项：得分 = 分子 / 分母（5 分制）
  const fractions: Record<ScoreComponent, { numerator: bigint; denominator: bigint } | null> = {
    dispatch: rate(input.dispatch.onTime, input.dispatch.total),
    arrival: rate(input.arrival.onTime, input.arrival.total),
    rating: input.ratings.count > 0 ? { numerator: BigInt(nonNegative(input.ratings.sum)), denominator: BigInt(input.ratings.count) } : null,
    complaint: completed > 0 ? { numerator: 5n * BigInt(completed - Math.min(nonNegative(input.upheldComplaints), completed)), denominator: BigInt(completed) } : null,
    failure: completed + failures > 0 ? { numerator: 5n * BigInt(completed), denominator: BigInt(completed + failures) } : null,
  };
  const keys = Object.keys(SCORE_WEIGHTS_BP) as ScoreComponent[];
  const usedWeight = keys.reduce((sum, key) => sum + (fractions[key] === null ? 0 : SCORE_WEIGHTS_BP[key]), 0);
  // Σ (weight × n / d) / usedWeight，通分到一个分母
  let numerator = 0n;
  let denominator = 1n;
  for (const key of keys) {
    const fraction = fractions[key];
    if (fraction === null) continue;
    numerator = numerator * fraction.denominator + BigInt(SCORE_WEIGHTS_BP[key]) * fraction.numerator * denominator;
    denominator *= fraction.denominator;
  }
  const rawScoreCenti = usedWeight === 0 ? null : clampScore(Number(roundFractionHalfAwayFromZero(numerator * 100n, denominator * BigInt(usedWeight))));
  const components = Object.fromEntries(
    keys.map((key): [ScoreComponent, ScoreComponentResult] => {
      const fraction = fractions[key];
      const weightBp = fraction === null || usedWeight === 0 ? 0 : Number(roundFractionHalfAwayFromZero(BigInt(SCORE_WEIGHTS_BP[key]) * 10_000n, BigInt(usedWeight)));
      const pointsCenti = fraction === null ? null : clampScore(Number(roundFractionHalfAwayFromZero(fraction.numerator * 100n, fraction.denominator)));
      return [key, { value: componentValue(key, input, completed, failures), pointsCenti, weightBp }];
    }),
  ) as Record<ScoreComponent, ScoreComponentResult>;
  const isDefault = rawScoreCenti === null || completed < MIN_ORDERS_FOR_SCORE;
  return { rawScoreCenti, scoreCenti: isDefault ? DEFAULT_SCORE_CENTI : (rawScoreCenti as number), isDefault, components };
}

function nonNegative(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`评分的输入必须是非负整数：${value}`);
  return value;
}

function rate(onTime: number, total: number): { numerator: bigint; denominator: bigint } | null {
  nonNegative(onTime);
  if (nonNegative(total) === 0) return null;
  return { numerator: 5n * BigInt(Math.min(onTime, total)), denominator: BigInt(total) };
}

function clampScore(centi: number): number {
  return Math.min(500, Math.max(0, centi));
}

function bp(numerator: number, denominator: number): number {
  return Number(roundFractionHalfAwayFromZero(BigInt(numerator) * 10_000n, BigInt(denominator)));
}

function componentValue(key: ScoreComponent, input: ScoreInput, completed: number, failures: number): number | null {
  switch (key) {
    case "dispatch":
      return input.dispatch.total === 0 ? null : bp(Math.min(input.dispatch.onTime, input.dispatch.total), input.dispatch.total);
    case "arrival":
      return input.arrival.total === 0 ? null : bp(Math.min(input.arrival.onTime, input.arrival.total), input.arrival.total);
    case "rating":
      return input.ratings.count === 0 ? null : Number(roundFractionHalfAwayFromZero(BigInt(input.ratings.sum) * 100n, BigInt(input.ratings.count)));
    case "complaint":
      return completed === 0 ? null : bp(Math.min(input.upheldComplaints, completed), completed);
    case "failure":
      return completed + failures === 0 ? null : bp(failures, completed + failures);
  }
}

// ---- 每天的自动判断 ----

export interface StandingInput {
  status: TenantStatus;
  suspensionReasons: readonly SuspensionReason[];
  /**
   * 上一次**按数据算出的**分：今天以前最近一天不是默认分（完成满 20 单）的比价用分；从来没有过为 null。
   * 中间是默认分的日子跳过——默认 4.5 不是「回升」（ADR 0028「跌破」口径）。
   */
  previousDataScoreCenti: number | null;
  scoreCenti: number;
  /** 这次的分是不是默认分（完成不足 20 单）：默认分不触发观察、暂停 */
  isDefaultScore: boolean;
  /** 上一次、这一次统计的「近 30 天司机未到次数」 */
  previousNoShows: number | null;
  noShows: number;
  /** 必交资质有没有过期的（`requiredDocumentsExpired` 不为空 = false） */
  documentsValid: boolean;
}

export interface StandingDecision {
  /** 这次算出来的观察原因（空 = 不在观察期） */
  observation: ObservationReason[];
  /** 要加上的暂停原因 */
  suspend: SuspensionReason[];
  /** 资质过期这个暂停原因可以去掉了（换了新证件并审核通过） */
  clearDocumentExpired: boolean;
}

/**
 * 每天按最新的数据判断一次（ADR 0028「自动触发」）：
 * - 观察期：评分（非默认分）低于 4.0，或近 30 天司机未到 ≥ 2 次。原因都没有了自动退出。只看试运营、正式、暂停中的供应商。
 * - 自动暂停：试运营 / 正式（已暂停的再加原因）——
 *   · 必交资质有过期的（到期当天）；
 *   · 评分**跌破** 3.5：上一次按数据算出的分不低于 3.5（或从来没有按数据算过）、这一次低于 3.5；默认分的日子不算「上一次」。运营人工恢复以后分数还没回升，第二天不会马上又被暂停；回升到 3.5 以上再跌破才会；
 *   · 近 30 天司机未到**达到** 3 次：上一次不到 3 次、这一次 ≥ 3 次（同样的道理）。
 * - 只因资质过期而暂停的，资质恢复有效后由调用方自动恢复（`clearDocumentExpired`）。
 */
export function evaluateTenantStanding(input: StandingInput): StandingDecision {
  const watched = input.status === "trial" || input.status === "active" || input.status === "suspended";
  if (!watched) return { observation: [], suspend: [], clearDocumentExpired: false };
  const observation: ObservationReason[] = [];
  if (!input.isDefaultScore && input.scoreCenti < TENANT_RULES.observationBelowCenti) observation.push("score_below_threshold");
  if (input.noShows >= TENANT_RULES.noShowObservationCount) observation.push("driver_no_show");
  const suspend: SuspensionReason[] = [];
  const has = (reason: SuspensionReason): boolean => input.suspensionReasons.includes(reason);
  if (!input.documentsValid && !has("document_expired")) suspend.push("document_expired");
  const crossedScore = !input.isDefaultScore && input.scoreCenti < TENANT_RULES.suspendBelowCenti && (input.previousDataScoreCenti === null || input.previousDataScoreCenti >= TENANT_RULES.suspendBelowCenti);
  if (crossedScore && !has("score_below_red_line")) suspend.push("score_below_red_line");
  const crossedNoShows = input.noShows >= TENANT_RULES.noShowSuspendCount && (input.previousNoShows === null || input.previousNoShows < TENANT_RULES.noShowSuspendCount);
  if (crossedNoShows && !has("driver_no_show")) suspend.push("driver_no_show");
  return { observation, suspend, clearDocumentExpired: input.documentsValid && has("document_expired") };
}

/** 评分窗口的第一天（含）：今天往前 89 天，共 90 天。 */
export function scoreWindowStart(today: string): string {
  return addDays(today, -(TENANT_RULES.scoreWindowDays - 1));
}

/** 司机未到统计窗口的第一天（含）：今天往前 29 天，共 30 天。 */
export function noShowWindowStart(today: string): string {
  return addDays(today, -(TENANT_RULES.noShowWindowDays - 1));
}

// ---- 「今天」 ----

/** 供应商的「今天」（`TENANT_RULES.timeZone` 的当地日期）。 */
export function tenantDate(now: Date): string {
  return instantToLocal(now, TENANT_RULES.timeZone).date;
}

/** 某一天（默认今天）在 `TENANT_RULES.timeZone` 的 0 点是哪个时刻。 */
export function tenantDayStart(now: Date, date: string = tenantDate(now)): Date {
  return localDateTimeToInstant(`${date}T00:00`, TENANT_RULES.timeZone) as Date;
}
