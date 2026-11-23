/**
 * 官网和嵌入页的三份法律文案（M9E-24，ADR 0107）：特定商取引法に基づく表記、キャンセルポリシー、プライバシーポリシー。纯函数，不碰数据库和网络。
 *
 * - 文案正文是业主 2026-11-23 确认的日文稿（#288），写在前端页面里；稿子里【 】的待补项是这里的 `LEGAL_FIELDS`，由运营后台填写。
 * - 待补项一项不缺才算「填齐」（`legalFieldsComplete`）。正式环境没填齐时官网不开放预订（ADR 0107）；测试站照常，页面上显示「未設定」。
 * - キャンセルポリシー里的取消费表不写死：按平台当前的取消政策实时生成（`cancellationTableRows`），稿子里的数字只是默认值。
 * - 先只有日文（其他语言随 M11）。
 */
import { type CancellationPolicy, type CancellationTier, VEHICLE_LEVELS, type VehicleLevel } from "./cancellation.ts";
import { SERVICE_CATEGORIES, type ServiceCategory } from "./master-data.ts";

// ---- 待补项 ----

export const LEGAL_FIELD_KEYS = [
  "seller_name",
  "japan_contact",
  "contact_email",
  "mail_provider",
  "mail_provider_country",
  "map_provider",
  "map_provider_country",
  "server_provider",
  "server_provider_country",
  "published_on",
] as const;
export type LegalFieldKey = (typeof LEGAL_FIELD_KEYS)[number];

export type LegalFieldFormat = "text" | "multiline" | "email" | "date";

export interface LegalFieldSpec {
  key: LegalFieldKey;
  /** 运营后台的标签（中文） */
  label: string;
  /** 用在哪份文案的哪一处（运营后台的说明） */
  usedIn: string;
  format: LegalFieldFormat;
  maxLength: number;
}

export const LEGAL_FIELDS: readonly LegalFieldSpec[] = [
  { key: "seller_name", label: "販売事業者（销售主体）", usedIn: "特定商取引法表記「販売事業者」、プライバシーポリシー开头", format: "text", maxLength: 200 },
  { key: "japan_contact", label: "日本国内の連絡先", usedIn: "特定商取引法表記「日本国内の連絡先」：日本的地址和电话，或「請求があった場合は遅滞なく開示します」", format: "multiline", maxLength: 500 },
  { key: "contact_email", label: "メールアドレス（联系邮箱）", usedIn: "特定商取引法表記「メールアドレス」、プライバシーポリシー第 7 条", format: "email", maxLength: 254 },
  { key: "mail_provider", label: "メール配信事業者（邮件服务商）", usedIn: "プライバシーポリシー第 4 条的表格", format: "text", maxLength: 200 },
  { key: "mail_provider_country", label: "メール配信事業者の所在国", usedIn: "プライバシーポリシー第 4 条的表格", format: "text", maxLength: 100 },
  { key: "map_provider", label: "地図表示事業者（地图底图服务商）", usedIn: "プライバシーポリシー第 4 条的表格", format: "text", maxLength: 200 },
  { key: "map_provider_country", label: "地図表示事業者の所在国", usedIn: "プライバシーポリシー第 4 条的表格", format: "text", maxLength: 100 },
  { key: "server_provider", label: "サーバー事業者（服务器服务商）", usedIn: "プライバシーポリシー第 4 条的表格", format: "text", maxLength: 200 },
  { key: "server_provider_country", label: "サーバー事業者の所在国", usedIn: "プライバシーポリシー第 4 条的表格", format: "text", maxLength: 100 },
  { key: "published_on", label: "公開日（制定日）", usedIn: "プライバシーポリシー末尾「制定日」", format: "date", maxLength: 10 },
];

export type LegalFields = Readonly<Record<LegalFieldKey, string | null>>;

/** 一项都没填的样子（数据库里还没有那一行时） */
export const EMPTY_LEGAL_FIELDS: LegalFields = Object.fromEntries(LEGAL_FIELD_KEYS.map((key) => [key, null])) as Record<LegalFieldKey, string | null>;

export type LegalFieldIssueReason = "UNKNOWN_FIELD" | "TOO_LONG" | "EMAIL_INVALID" | "DATE_INVALID" | "NOT_TEXT";

export interface LegalFieldIssue {
  key: string;
  reason: LegalFieldIssueReason;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function validDate(text: string): boolean {
  const match = DATE.exec(text);
  if (match === null) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** 去掉首尾空白；空字符串当作没填（null）。多行的统一换行符。 */
export function normalizeLegalValue(value: string | null): string | null {
  if (value === null) return null;
  const text = value.replace(/\r\n?/g, "\n").trim();
  return text === "" ? null : text;
}

/** 运营提交的待补项对不对（空数组 = 对）：只认 `LEGAL_FIELD_KEYS`；值是字符串或 null，长度、邮箱、日期（YYYY-MM-DD）格式。没填不算错。 */
export function legalFieldIssues(input: Readonly<Record<string, unknown>>): LegalFieldIssue[] {
  const issues: LegalFieldIssue[] = [];
  for (const [key, raw] of Object.entries(input)) {
    const spec = LEGAL_FIELDS.find((field) => field.key === key);
    if (spec === undefined) {
      issues.push({ key, reason: "UNKNOWN_FIELD" });
      continue;
    }
    if (raw !== null && typeof raw !== "string") {
      issues.push({ key, reason: "NOT_TEXT" });
      continue;
    }
    const value = normalizeLegalValue(raw);
    if (value === null) continue;
    if ([...value].length > spec.maxLength) issues.push({ key, reason: "TOO_LONG" });
    else if (spec.format === "email" && !EMAIL.test(value)) issues.push({ key, reason: "EMAIL_INVALID" });
    else if (spec.format === "date" && !validDate(value)) issues.push({ key, reason: "DATE_INVALID" });
  }
  return issues;
}

/** 把存着的（可能缺项、可能有旧键）整理成完整的一份：缺的为 null，不认识的键丢掉。 */
export function legalFieldsOf(stored: Readonly<Record<string, unknown>> | null): LegalFields {
  const result: Record<string, string | null> = {};
  for (const key of LEGAL_FIELD_KEYS) {
    const raw = stored?.[key];
    result[key] = typeof raw === "string" ? normalizeLegalValue(raw) : null;
  }
  return result as Record<LegalFieldKey, string | null>;
}

/** 还没填的待补项（按 `LEGAL_FIELDS` 的顺序）。 */
export function missingLegalFields(fields: LegalFields): LegalFieldKey[] {
  return LEGAL_FIELD_KEYS.filter((key) => fields[key] === null);
}

export function legalFieldsComplete(fields: LegalFields): boolean {
  return missingLegalFields(fields).length === 0;
}

/** 页面上没填的待补项显示的字 */
export const LEGAL_UNSET_TEXT = "未設定";

/** 「YYYY-MM-DD」→「YYYY年M月D日」（制定日）。格式不对原样返回。 */
export function legalDateJa(value: string): string {
  const match = DATE.exec(value);
  if (match === null) return value;
  return `${Number(match[1])}年${Number(match[2])}月${Number(match[3])}日`;
}

// ---- 取消费表（キャンセルポリシー第 2 条）----

export const LEGAL_CATEGORY_NAMES_JA: Readonly<Record<ServiceCategory, string>> = {
  airport_transfer: "空港送迎",
  point_to_point: "地点間送迎",
  charter: "貸切（チャーター）",
};

export const LEGAL_LEVEL_NAMES_JA: Readonly<Record<VehicleLevel, string>> = {
  economy: "エコノミー",
  comfort: "コンフォート",
  business: "ビジネス",
  luxury: "ラグジュアリー",
  minibus: "マイクロバス（10 名以上）",
};

/** 一行：哪几个品类、哪几个车型级别，阶梯一样 */
export interface CancellationTableRow {
  categories: ServiceCategory[];
  levels: VehicleLevel[];
  tiers: CancellationTier[];
  /** 「空港送迎・地点間送迎」 */
  serviceLabel: string;
  /** 「エコノミー・コンフォート」；五个级别都在一行时是「全車種」 */
  vehicleLabel: string;
  /** 每一列（`cancellationTableColumns` 的顺序）这一行的时间段；这一行没有这一档为 null */
  cells: (string | null)[];
  /** 「ちょうど 24 時間前は無料、ちょうど 6 時間前は 50% とします」（业主稿的原句写法；只有一档时为 null） */
  boundaryNote: string | null;
}

const tierKey = (tiers: readonly CancellationTier[]): string => tiers.map((tier) => `${tier.minHoursBefore}:${tier.feeBp}`).join("|");

/** 扣款比例的列名：0 是「無料」，其余是百分比（基点 → 百分比，最多两位小数，不用浮点相除）。 */
export function feeLabelJa(feeBp: number): string {
  if (feeBp === 0) return "無料";
  const whole = Math.trunc(feeBp / 100);
  const rest = feeBp % 100;
  if (rest === 0) return `${whole}%`;
  const decimals = String(rest).padStart(2, "0").replace(/0$/, "");
  return `${whole}.${decimals}%`;
}

/** 一档的时间段：第一档「N 時間前まで」，中间「A 時間前〜B 時間前」，最后（0 小时）「A 時間前以降」；只有一档为「ご利用時間にかかわらず」。 */
export function tierRangeJa(tiers: readonly CancellationTier[], index: number): string {
  const tier = tiers[index] as CancellationTier;
  if (tiers.length === 1) return "ご利用時間にかかわらず";
  if (index === 0) return `${tier.minHoursBefore} 時間前まで`;
  const upper = (tiers[index - 1] as CancellationTier).minHoursBefore;
  if (tier.minHoursBefore === 0) return `${upper} 時間前以降`;
  return `${upper} 時間前〜${tier.minHoursBefore} 時間前`;
}

/** 表的列：政策里出现过的扣款比例，从小到大。 */
export function cancellationTableColumns(policy: CancellationPolicy): number[] {
  const fees = new Set<number>();
  for (const rule of policy) for (const tier of rule.tiers) fees.add(tier.feeBp);
  return [...fees].sort((a, b) => a - b);
}

/**
 * 按政策生成表的行：同一品类里阶梯一样的车型级别并成一行，再把各级别分组完全一样的品类并成一组（默认政策正好是稿子里的三行）。
 * 顺序按 `SERVICE_CATEGORIES`、`VEHICLE_LEVELS`。同一行里同一个扣款比例出现在两档时（政策允许相邻两档比例相同），两段时间用「、」连起来。
 */
export function cancellationTableRows(policy: CancellationPolicy): CancellationTableRow[] {
  const columns = cancellationTableColumns(policy);
  const groupsOf = (category: ServiceCategory): { levels: VehicleLevel[]; tiers: CancellationTier[] }[] => {
    const groups: { levels: VehicleLevel[]; tiers: CancellationTier[] }[] = [];
    for (const level of VEHICLE_LEVELS) {
      const rule = policy.find((entry) => entry.category === category && entry.level === level);
      if (rule === undefined) continue;
      const found = groups.find((group) => tierKey(group.tiers) === tierKey(rule.tiers));
      if (found === undefined) groups.push({ levels: [level], tiers: [...rule.tiers] });
      else found.levels.push(level);
    }
    return groups;
  };
  const signature = (groups: { levels: VehicleLevel[]; tiers: CancellationTier[] }[]): string => groups.map((group) => `${group.levels.join(",")}=${tierKey(group.tiers)}`).join(";");
  const merged: { categories: ServiceCategory[]; groups: { levels: VehicleLevel[]; tiers: CancellationTier[] }[] }[] = [];
  for (const category of SERVICE_CATEGORIES) {
    const groups = groupsOf(category);
    if (groups.length === 0) continue;
    const found = merged.find((entry) => signature(entry.groups) === signature(groups));
    if (found === undefined) merged.push({ categories: [category], groups });
    else found.categories.push(category);
  }
  return merged.flatMap((entry) =>
    entry.groups.map((group): CancellationTableRow => {
      const cells = columns.map((fee) => {
        const ranges = group.tiers.flatMap((tier, index) => (tier.feeBp === fee ? [tierRangeJa(group.tiers, index)] : []));
        return ranges.length === 0 ? null : ranges.join("、");
      });
      // 业主稿的写法：「は無料」不空格，百分比两边空格（「は 50% とします」）
      const boundaries = group.tiers.filter((tier) => tier.minHoursBefore > 0).map((tier) => `ちょうど ${tier.minHoursBefore} 時間前は${tier.feeBp === 0 ? feeLabelJa(0) : ` ${feeLabelJa(tier.feeBp)} `}`);
      return {
        categories: entry.categories,
        levels: group.levels,
        tiers: group.tiers,
        serviceLabel: entry.categories.map((category) => LEGAL_CATEGORY_NAMES_JA[category]).join("・"),
        vehicleLabel: group.levels.length === VEHICLE_LEVELS.length ? "全車種" : group.levels.map((level) => LEGAL_LEVEL_NAMES_JA[level]).join("・"),
        cells,
        boundaryNote: group.tiers.length > 1 && boundaries.length > 0 ? `${boundaries.map((text) => text.trimEnd()).join("、")}${boundaries[boundaries.length - 1]?.endsWith(" ") === true ? " " : ""}とします` : null,
      };
    }),
  );
}

