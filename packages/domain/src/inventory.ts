/**
 * 库存（M1-05）。纯函数：页面的库存日历、批量设置的预览，后端保存和上架校验，以后的报价和下单，用的是同一份。
 *
 * 对应需求文档「5. 商品 · ④ 库存」和报价引擎第 9 步：
 * - 模式：无限（默认）/ 有限。有限时按「商品 × 日期」设每日可售单数（按车型组的库存二期开放）。
 * - 日期是商品所在城市当地的用车日期。
 * - 一天的库存分三个数：可售总数 total、已预占 held（下单未支付）、已售 sold（支付确认）。剩余 = total − held − sold。
 * - 有限模式下没有设过的日期不可售（没有库存就是没有，不当成不限量）；设成 0 = 这一天停售。
 */
import { addDays, weekdayOf } from "./pricing.ts";
import { isLocalDate } from "./service-time.ts";

export const INVENTORY_MODES = ["unlimited", "limited"] as const;
export type InventoryMode = (typeof INVENTORY_MODES)[number];
export const INVENTORY_MODE_NAMES: Readonly<Record<InventoryMode, string>> = { unlimited: "不限量", limited: "限量" };

export const INVENTORY_LIMITS = {
  /** 一天最多可售多少单 */
  maxDailyTotal: 9_999,
  /** 批量设置、库存日历、导入一次最多跨多少天 */
  maxRangeDays: 366,
  /** 最远能设到今天之后多少天 */
  maxDaysAhead: 730,
} as const;

/** 一天的库存。 */
export interface InventoryDay {
  /** 这一天一共可售多少单；0 = 停售 */
  total: number;
  /** 已预占（下单未支付） */
  held: number;
  /** 已售（支付确认） */
  sold: number;
}

/**
 * 这一天还剩多少单可售。不限量时为 null。
 * `day` 传 null 表示这一天没有设过：有限模式下就是 0。
 */
export function inventoryRemaining(mode: InventoryMode, day: InventoryDay | null): number | null {
  if (mode === "unlimited") return null;
  return day === null ? 0 : Math.max(0, day.total - day.held - day.sold);
}

/** 某次用车有没有库存（报价引擎第 9 步：有限库存时当日剩余 > 0）。`quantity` 是要占用的单数，默认 1。 */
export function hasInventory(mode: InventoryMode, day: InventoryDay | null, quantity: number = 1): boolean {
  const remaining = inventoryRemaining(mode, day);
  return remaining === null || remaining >= quantity;
}

/**
 * 一天在库存日历上的状态：
 * `unlimited` 不限量；`unset` 限量但这一天没设（不可售）；`closed` 设成了 0（停售）；`sold_out` 设了但已经占满；`open` 还有剩余。
 */
export type InventoryDayStatus = "unlimited" | "unset" | "closed" | "sold_out" | "open";

export function inventoryDayStatus(mode: InventoryMode, day: InventoryDay | null): InventoryDayStatus {
  if (mode === "unlimited") return "unlimited";
  if (day === null) return "unset";
  if (day.total === 0) return "closed";
  return day.total - day.held - day.sold > 0 ? "open" : "sold_out";
}

export type InventoryIssueReason =
  | "INVALID_DATE"
  | "DATE_RANGE_REVERSED"
  /** 开始日期早于城市当地的今天：过去的库存不能改 */
  | "DATE_IN_PAST"
  | "TOO_FAR_AHEAD"
  | "TOO_MANY"
  | "NOT_INTEGER"
  | "OUT_OF_RANGE"
  | "DUPLICATE"
  /** 日期范围里没有一天符合选的星期 */
  | "NO_DAY_SELECTED";

export interface InventoryIssue {
  path: string;
  reason: InventoryIssueReason;
  detail?: Record<string, number>;
}

/** 批量设置：日期范围（两端都含）里选中的星期（空 = 每天），设成 `total` 单；`total` 为 null = 清除（回到没设过）。 */
export interface InventoryBatch {
  from: string;
  to: string;
  /** 1 = 周一 … 7 = 周日；空数组 = 每天 */
  weekdays: number[];
  total: number | null;
}

/** 可售单数写得对不对（null = 清除，合法）。 */
export function inventoryTotalIssue(total: number | null): InventoryIssueReason | null {
  if (total === null) return null;
  if (!Number.isInteger(total)) return "NOT_INTEGER";
  return total < 0 || total > INVENTORY_LIMITS.maxDailyTotal ? "OUT_OF_RANGE" : null;
}

/** 一个日期能不能设库存：合法、不早于今天、不超过最远的那一天。 */
export function inventoryDateIssue(date: string, today: string): InventoryIssueReason | null {
  if (!isLocalDate(date)) return "INVALID_DATE";
  if (date < today) return "DATE_IN_PAST";
  return date > addDays(today, INVENTORY_LIMITS.maxDaysAhead) ? "TOO_FAR_AHEAD" : null;
}

/** 批量设置「写得对不对」。`today` 是城市当地的今天。 */
export function inventoryBatchIssues(batch: InventoryBatch, today: string): InventoryIssue[] {
  const issues: InventoryIssue[] = [];
  const fromIssue = inventoryDateIssue(batch.from, today);
  const toIssue = inventoryDateIssue(batch.to, today);
  if (fromIssue !== null) issues.push({ path: "/from", reason: fromIssue });
  if (toIssue !== null && toIssue !== "DATE_IN_PAST") issues.push({ path: "/to", reason: toIssue });
  const datesOk = isLocalDate(batch.from) && isLocalDate(batch.to);
  if (datesOk && batch.to < batch.from) issues.push({ path: "/to", reason: "DATE_RANGE_REVERSED" });
  else if (datesOk && addDays(batch.from, INVENTORY_LIMITS.maxRangeDays - 1) < batch.to) issues.push({ path: "/to", reason: "TOO_MANY", detail: { max: INVENTORY_LIMITS.maxRangeDays } });
  const seen = new Set<number>();
  for (const [index, day] of batch.weekdays.entries()) {
    if (!Number.isInteger(day)) issues.push({ path: `/weekdays/${index}`, reason: "NOT_INTEGER" });
    else if (day < 1 || day > 7) issues.push({ path: `/weekdays/${index}`, reason: "OUT_OF_RANGE", detail: { min: 1, max: 7 } });
    else if (seen.has(day)) issues.push({ path: `/weekdays/${index}`, reason: "DUPLICATE" });
    seen.add(day);
  }
  const totalIssue = inventoryTotalIssue(batch.total);
  if (totalIssue !== null) issues.push({ path: "/total", reason: totalIssue, ...(totalIssue === "OUT_OF_RANGE" ? { detail: { min: 0, max: INVENTORY_LIMITS.maxDailyTotal } } : {}) });
  if (issues.length === 0 && inventoryBatchDates(batch).length === 0) issues.push({ path: "/weekdays", reason: "NO_DAY_SELECTED" });
  return issues;
}

/** 批量设置选中的日期，从早到晚。范围不合法时返回空数组。 */
export function inventoryBatchDates(batch: Pick<InventoryBatch, "from" | "to" | "weekdays">): string[] {
  if (!isLocalDate(batch.from) || !isLocalDate(batch.to) || batch.to < batch.from) return [];
  const dates: string[] = [];
  for (let date = batch.from, count = 0; date <= batch.to && count < INVENTORY_LIMITS.maxRangeDays; date = addDays(date, 1), count += 1) {
    if (batch.weekdays.length === 0 || batch.weekdays.includes(weekdayOf(date))) dates.push(date);
  }
  return dates;
}

/**
 * 把一天改成 `total`（null = 清除）行不行：已经预占、已售的单不能被改没——可售总数不能小于 held + sold，有占用的日子不能清除。
 * 不行时返回这一天已经占用了多少单；行返回 null。
 */
export function inventoryOccupiedBlocking(current: InventoryDay | null, total: number | null): number | null {
  const occupied = current === null ? 0 : current.held + current.sold;
  return occupied > 0 && (total === null || total < occupied) ? occupied : null;
}
