/**
 * 法律页面（M9E-24，ADR 0107）：三页的地址、链接名，以及キャンセルポリシー的取消费表——按后台当前的取消政策生成，不写死。
 * 页面正文是业主定稿的日文（pages/legal/LegalPages.tsx），这里只放按数据拼出来的部分。
 */
import type { CancelTier, CancellationPolicyRule } from "../api/order-money.ts";

export const LEGAL_PATHS = {
  tokushoho: "/legal/tokushoho",
  cancellation: "/legal/cancellation",
  privacy: "/legal/privacy",
} as const;

export type LegalPageKey = keyof typeof LEGAL_PATHS;

export const LEGAL_TITLES: Readonly<Record<LegalPageKey, string>> = {
  tokushoho: "特定商取引法に基づく表記",
  cancellation: "キャンセルポリシー",
  privacy: "プライバシーポリシー",
};

/** 页脚、嵌入页顶部、核对页的三个链接（顺序固定） */
export const LEGAL_LINKS: readonly { key: LegalPageKey; to: string; label: string }[] = (Object.keys(LEGAL_PATHS) as LegalPageKey[]).map((key) => ({ key, to: LEGAL_PATHS[key], label: LEGAL_TITLES[key] }));

/** 运营后台还没填的项在页面上的写法 */
export const LEGAL_UNSET = "未設定";

const CATEGORY_ORDER = ["airport_transfer", "point_to_point", "charter"] as const;
const LEVEL_ORDER = ["economy", "comfort", "business", "luxury", "minibus"] as const;
const CATEGORY_NAMES: Readonly<Record<string, string>> = { airport_transfer: "空港送迎", point_to_point: "地点間送迎", charter: "貸切（チャーター）" };
const LEVEL_NAMES: Readonly<Record<string, string>> = { economy: "エコノミー", comfort: "コンフォート", business: "ビジネス", luxury: "ラグジュアリー", minibus: "マイクロバス（10 名以上）" };

/** 0 → 無料；5000 → 50%；1250 → 12.5% */
export function legalFeeText(feeBp: number): string {
  if (feeBp === 0) return "無料";
  return `${Number((feeBp / 100).toFixed(2))}%`;
}

const sortedTiers = (tiers: readonly CancelTier[]): CancelTier[] => [...tiers].sort((a, b) => b.min_hours_before - a.min_hours_before);

/** 每一档覆盖的时间段：「24 時間前まで」「24 時間前〜6 時間前」「6 時間前以降」；只有一档为「いつでも」 */
export function legalTierPeriods(tiers: readonly CancelTier[]): string[] {
  const sorted = sortedTiers(tiers);
  return sorted.map((tier, index) => {
    if (sorted.length === 1) return "いつでも";
    if (index === 0) return `${tier.min_hours_before} 時間前まで`;
    const upper = (sorted[index - 1] as CancelTier).min_hours_before;
    if (tier.min_hours_before === 0) return `${upper} 時間前以降`;
    return `${upper} 時間前〜${tier.min_hours_before} 時間前`;
  });
}

export interface LegalCancellationRow {
  service: string;
  vehicles: string;
  /** 各档：时间段和扣的比例（从早到晚） */
  tiers: { period: string; fee: string }[];
}

export interface LegalCancellationTable {
  /**
   * 每一行扣的比例序列都一样时（默认政策就是这样：無料 / 50% / 100%），按定稿的样子以比例作列、单元格写时间段；
   * 不一样时为 null，页面改成一列写出各档。
   */
  feeColumns: string[] | null;
  rows: LegalCancellationRow[];
}

const signature = (tiers: readonly CancelTier[]): string =>
  sortedTiers(tiers)
    .map((tier) => `${tier.min_hours_before}:${tier.fee_bp}`)
    .join("|");

/**
 * 按「品类 × 车型级别」生成取消费表：同一品类里阶梯相同的车型级别合成一格（五种都在写「全車種」），
 * 车型分法和阶梯都相同的品类再合成一行（默认政策下：空港送迎・地点間送迎 两行 + 貸切 一行，和定稿逐字相同）。
 */
export function legalCancellationTable(rules: readonly CancellationPolicyRule[]): LegalCancellationTable {
  // 1. 同一品类里按阶梯分组车型级别
  const perCategory: { category: string; levels: string[]; tiers: CancelTier[] }[] = [];
  for (const category of CATEGORY_ORDER) {
    const groups = new Map<string, { levels: string[]; tiers: CancelTier[] }>();
    for (const level of LEVEL_ORDER) {
      const rule = rules.find((entry) => entry.category === category && entry.level === level);
      if (rule === undefined) continue;
      const key = signature(rule.tiers);
      const group = groups.get(key) ?? { levels: [], tiers: sortedTiers(rule.tiers) };
      group.levels.push(level);
      groups.set(key, group);
    }
    for (const group of groups.values()) perCategory.push({ category, ...group });
  }
  // 2. 车型分法和阶梯都相同的品类合成一行（保持第一次出现的顺序）
  const merged: { categories: string[]; levels: string[]; tiers: CancelTier[] }[] = [];
  for (const entry of perCategory) {
    const same = merged.find((row) => row.levels.join() === entry.levels.join() && signature(row.tiers) === signature(entry.tiers));
    if (same !== undefined) same.categories.push(entry.category);
    else merged.push({ categories: [entry.category], levels: entry.levels, tiers: entry.tiers });
  }
  const rows = merged.map((row): LegalCancellationRow => {
    const periods = legalTierPeriods(row.tiers);
    return {
      service: row.categories.map((category) => CATEGORY_NAMES[category] ?? category).join("・"),
      vehicles: row.levels.length === LEVEL_ORDER.length ? "全車種" : row.levels.map((level) => LEVEL_NAMES[level] ?? level).join("・"),
      tiers: row.tiers.map((tier, index) => ({ period: periods[index] as string, fee: legalFeeText(tier.fee_bp) })),
    };
  });
  const fees = rows.map((row) => row.tiers.map((tier) => tier.fee).join("|"));
  const uniform = rows.length > 0 && fees.every((value) => value === fees[0]);
  return { feeColumns: uniform ? (rows[0] as LegalCancellationRow).tiers.map((tier) => tier.fee) : null, rows };
}

/**
 * 「ちょうど 24 時間前は無料、ちょうど 6 時間前は 50% とします。」——按「空港送迎・エコノミー」那一条的阶梯生成（ADR 0107 第二节）：
 * 正好在两档交界的时刻，算较早（较便宜）的那一档。没有交界（只有一档）或找不到那一条时为 null。
 */
export function legalBoundarySentence(rules: readonly CancellationPolicyRule[]): string | null {
  const rule = rules.find((entry) => entry.category === "airport_transfer" && entry.level === "economy");
  if (rule === undefined) return null;
  const parts = sortedTiers(rule.tiers)
    .filter((tier) => tier.min_hours_before > 0)
    .map((tier) => `ちょうど ${tier.min_hours_before} 時間前は${tier.fee_bp === 0 ? "" : " "}${legalFeeText(tier.fee_bp)}`);
  if (parts.length === 0 || sortedTiers(rule.tiers).length < 2) return null;
  const last = parts[parts.length - 1] as string;
  return `${parts.join("、")}${last.endsWith("%") ? " " : ""}とします。`;
}

/** 2026-12-01 → 2026 年 12 月 1 日 */
export function legalDateText(value: string): string {
  const [year, month, day] = value.split("-");
  return `${Number(year)} 年 ${Number(month)} 月 ${Number(day)} 日`;
}
