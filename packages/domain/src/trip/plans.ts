/**
 * 方案组装与推荐（ADR 0101 第三节第 6 小节；偏离 D1、D2 监工 2026-11-15 同意）。
 * - `daily_best`：每天独立取总价最低的拆法和中标报价（可不同供应商、车型组）；不加住宿、停驻、附加项去重。
 * - `one_car`：同一租户 × 同一车型组贯穿全部用车日；每天取它自己的最低拆法。机场 / 点对点日按三级规则：
 *   1. 同租户同车型组能报（包车段或接送机 / 点对点段都行）→ 算同一辆车；
 *   2. 报不出 → 若这一天只有接送机 / 点对点段，允许用当天的中标报价（按段选车），这一天算**不是同一辆车**；
 *   3. 包车段报不出 → 这个租户 × 车型组不能一车到底。
 * - 推荐：`daily_best` 比 `one_car` 便宜 10% 以上推荐 `daily_best`，否则推荐 `one_car`。
 */
import type { SegmentDraft } from "./segments.ts";

export const TRIP_PLAN_RULES = { recommendGapBp: 1_000 } as const;

export interface SegmentOffer {
  tenantId: string;
  productId: string;
  vehicleGroupId: string;
  sellMinor: number;
  settlementMinor: number;
  /** 比价的中标者（每个车型组一个） */
  winner: boolean;
}

export interface QuotedSegment<O extends SegmentOffer = SegmentOffer> {
  draft: SegmentDraft;
  /** 同一次比价里每个租户每个车型组一个报价（`group.ranked[]`）；报不出为空 */
  offers: readonly O[];
}

export interface QuotedOption<O extends SegmentOffer = SegmentOffer> {
  segments: readonly QuotedSegment<O>[];
}

export interface QuotedDay<O extends SegmentOffer = SegmentOffer> {
  dayIndex: number;
  /** 空闲日为空数组 */
  options: readonly QuotedOption<O>[];
}

export interface ChosenSegment<O extends SegmentOffer = SegmentOffer> {
  draft: SegmentDraft;
  offer: O;
}

export interface ChosenDay<O extends SegmentOffer = SegmentOffer> {
  dayIndex: number;
  optionIndex: number;
  segments: ChosenSegment<O>[];
  /** 一车到底里这一天用了别的供应商（按段选车），住宿 / 停驻 / 工时从这天断开 */
  otherVehicle: boolean;
}

export type DayUnquoted = { dayIndex: number; reason: "NO_OFFER" };

const sum = (segments: readonly ChosenSegment<SegmentOffer>[]): number => segments.reduce((total, s) => total + s.offer.sellMinor, 0);

/** 同一天的几种拆法里取总价最低的（一样时段少的，再一样时下标小的）；没有能报全的拆法为 null */
function cheapest<O extends SegmentOffer>(day: QuotedDay<O>, pickOffer: (segment: QuotedSegment<O>) => O | undefined): { optionIndex: number; segments: ChosenSegment<O>[] } | null {
  let best: { optionIndex: number; segments: ChosenSegment<O>[]; total: number } | null = null;
  for (const [optionIndex, option] of day.options.entries()) {
    const segments: ChosenSegment<O>[] = [];
    let complete = option.segments.length > 0;
    for (const segment of option.segments) {
      const offer = pickOffer(segment);
      if (offer === undefined) {
        complete = false;
        break;
      }
      segments.push({ draft: segment.draft, offer });
    }
    if (!complete) continue;
    const total = sum(segments);
    if (best === null || total < best.total || (total === best.total && segments.length < best.segments.length)) best = { optionIndex, segments, total };
  }
  return best === null ? null : { optionIndex: best.optionIndex, segments: best.segments };
}

const winnerOf = <O extends SegmentOffer>(segment: QuotedSegment<O>): O | undefined => {
  const winners = segment.offers.filter((offer) => offer.winner);
  return winners.reduce<O | undefined>((min, o) => (min === undefined || o.sellMinor < min.sellMinor ? o : min), undefined);
};

export function assembleDailyBest<O extends SegmentOffer>(days: readonly QuotedDay<O>[]): { days: ChosenDay<O>[]; unquoted: DayUnquoted[] } {
  const chosen: ChosenDay<O>[] = [];
  const unquoted: DayUnquoted[] = [];
  for (const day of days) {
    if (day.options.length === 0) continue;
    const best = cheapest(day, winnerOf);
    if (best === null) unquoted.push({ dayIndex: day.dayIndex, reason: "NO_OFFER" });
    else chosen.push({ dayIndex: day.dayIndex, ...best, otherVehicle: false });
  }
  return { days: chosen, unquoted };
}

export interface CarKey {
  tenantId: string;
  vehicleGroupId: string;
}

const keyOf = (k: CarKey): string => `${k.tenantId}\u0000${k.vehicleGroupId}`;

/** 一车到底的候选：所有报价里出现过的租户 × 车型组（按出现顺序去重） */
export function oneCarCandidates(days: readonly QuotedDay<SegmentOffer>[]): CarKey[] {
  const seen = new Map<string, CarKey>();
  for (const day of days) for (const option of day.options) for (const segment of option.segments) for (const offer of segment.offers) {
    const key = keyOf(offer);
    if (!seen.has(key)) seen.set(key, { tenantId: offer.tenantId, vehicleGroupId: offer.vehicleGroupId });
  }
  return [...seen.values()];
}

/**
 * 某个租户 × 车型组的一车到底各天组成（三级规则见文件头）。有包车段的一天报不出 → null（这个组合不能一车到底）；
 * 机场 / 点对点日报不出且当天也没有中标报价 → null。全部用车日都「不是同一辆车」也算不成一车到底 → null。
 */
export function oneCarDays<O extends SegmentOffer>(days: readonly QuotedDay<O>[], key: CarKey): ChosenDay<O>[] | null {
  const own = (segment: QuotedSegment<O>): O | undefined => segment.offers.find((offer) => offer.tenantId === key.tenantId && offer.vehicleGroupId === key.vehicleGroupId);
  const chosen: ChosenDay<O>[] = [];
  for (const day of days) {
    if (day.options.length === 0) continue;
    const mine = cheapest(day, own);
    if (mine !== null) {
      chosen.push({ dayIndex: day.dayIndex, ...mine, otherVehicle: false });
      continue;
    }
    const transferOnly = day.options.filter((option) => option.segments.every((segment) => segment.draft.type !== "charter"));
    const fallback = transferOnly.length === 0 ? null : cheapest({ dayIndex: day.dayIndex, options: transferOnly }, winnerOf);
    if (fallback === null) return null;
    const optionIndex = day.options.indexOf(transferOnly[fallback.optionIndex] as QuotedOption<O>);
    chosen.push({ dayIndex: day.dayIndex, optionIndex, segments: fallback.segments, otherVehicle: true });
  }
  if (chosen.length === 0 || chosen.every((day) => day.otherVehicle)) return null;
  return chosen;
}

export interface PlanTotal {
  kind: "one_car" | "daily_best";
  quoted: boolean;
  sellMinor: number;
}

/** 推荐（采纳设计篇第三节第 5 小节，Q6）：`daily_best` 便宜 10% 以上才推荐它，否则推荐 `one_car`；只有一个报出的推荐那个 */
export function recommendPlan(plans: readonly PlanTotal[], gapBp: number = TRIP_PLAN_RULES.recommendGapBp): PlanTotal["kind"] | null {
  const quoted = plans.filter((plan) => plan.quoted);
  const one = quoted.find((plan) => plan.kind === "one_car");
  const daily = quoted.find((plan) => plan.kind === "daily_best");
  if (one === undefined) return daily === undefined ? null : "daily_best";
  if (daily === undefined) return "one_car";
  // daily ≤ one × (1 − gap)，整数比较避免浮点
  return BigInt(daily.sellMinor) * 10_000n <= BigInt(one.sellMinor) * BigInt(10_000 - gapBp) ? "daily_best" : "one_car";
}

/** 段报价预算（ADR 0101 第三节第 5 小节）：按日期顺序，剩余不够下一天全部拆法时，余下各天只报「不拆」 */
export const TRIP_BUDGET = { maxSegmentQuotes: 120, maxRouteCalls: 200 } as const;

/**
 * 每天用几种拆法：`segmentCounts[d][o]` = 第 d 天第 o 种拆法的段数（第 0 种是「不拆」）。
 * 返回每天保留的拆法个数和是否降级；连每天「不拆」都超预算为 null（422 `TRIP_TOO_COMPLEX`）。
 */
export function budgetSplitOptions(segmentCounts: readonly (readonly number[])[], maxQuotes: number = TRIP_BUDGET.maxSegmentQuotes): { keep: number[]; degraded: boolean } | null {
  const minimum = segmentCounts.reduce((total, day) => total + (day.length === 0 ? 0 : (day[0] as number)), 0);
  if (minimum > maxQuotes) return null;
  let used = 0;
  let degraded = false;
  const keep: number[] = [];
  for (const [d, day] of segmentCounts.entries()) {
    if (day.length === 0) {
      keep.push(0);
      continue;
    }
    const restMinimum = segmentCounts.slice(d + 1).reduce((total, later) => total + (later.length === 0 ? 0 : (later[0] as number)), 0);
    const all = day.reduce((total, count) => total + count, 0);
    if (!degraded && used + all + restMinimum <= maxQuotes) {
      keep.push(day.length);
      used += all;
    } else {
      degraded = degraded || day.length > 1;
      keep.push(1);
      used += day[0] as number;
    }
  }
  return { keep, degraded };
}
