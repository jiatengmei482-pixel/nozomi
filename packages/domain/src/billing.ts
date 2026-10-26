/**
 * 供应商应付账单与付款批次的纯规则（M5-01，ADR 0040）。不碰数据库和网络。
 *
 * 需求：《平台运营端与渠道对接》「财务结算」（只有「已完成」「no-show 已审核」「有偿取消」的订单进入账单；服务日期在周期内且已结案；
 * 未结案的金额结案后在下一期补发；租户应付账单：生成 → 租户确认（可提异议）→ 双人复核 → 付款；月结，次月 20 日付上月已结案订单）、
 * 「一单的账务分录」（应付租户：结算价、有偿取消 M% × 结算价、附加费用 + 金额、履约失败 − 违约金）；
 * 《用车报价服务平台》「13. 二期功能 · 对账结算」（按月生成账单：结算价、取消费、附加费用、no-show，租户确认后开票）；
 * 第三轮决策（月结、次月 20 日付款、不收服务费和保证金）、第五轮决策（租户退出：最后一期延后一个周期付款）。
 *
 * 口径：
 * - 金额都是结算币种的最小单位整数；账单只做加减（不换汇、不取整），一张账单只有一种币种。
 * - 一笔应付（订单、加收、应扣款项、免除、上期结转）用「来源键」标识，在一个供应商里同一时刻只能挂在一张有效的账单上：
 *   生成可以反复运行，已出账的不会再计入；账单作废后它的明细释放，下次生成重新计入。
 * - 周期按订单的**服务日期**（`orders.service_date`，城市当地日期）切月；周期结束时还没结案的，结案后进入之后一期（标「往期调整」）。
 */
import { type CurrencyCode, assertMinor } from "./money.ts";
import { instantToLocal } from "./service-time.ts";
import { CONTRACT_TERMS } from "./tenants.ts";

export const BILLING_RULES = {
  /** 「今天」、付款日、自动生成的时机按这个时区的日期（和供应商每日检查同一个，ADR 0028） */
  timeZone: "Asia/Tokyo",
  /** 合同没写时的付款日（次月 20 日；合同的固定条款也是 20 日） */
  paymentDay: CONTRACT_TERMS.paymentDay,
  /** 供应商确认期：出账（或平台答复异议）后这么多天内不确认也不提异议，视为确认（待负责人确认） */
  confirmDays: 7,
  /** 已清退的供应商：最后一期延后几个周期付款（第五轮决策「最后一期延后一个周期付款」） */
  terminatedDelayMonths: 1,
  /** 异议原因、平台答复、作废原因、复核说明的长度上限 */
  noteMaxLength: 500,
} as const;

// ---- 周期（YYYY-MM） ----

const PERIOD_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isBillingPeriod(value: string): boolean {
  const m = PERIOD_PATTERN.exec(value);
  return m !== null && Number(m[1]) >= 2000 && Number(m[1]) <= 9999;
}

function parsePeriod(period: string): { year: number; month: number } {
  const m = PERIOD_PATTERN.exec(period);
  if (m === null) throw new RangeError(`账单周期格式不对（应为 YYYY-MM）：${period}`);
  return { year: Number(m[1]), month: Number(m[2]) };
}

function formatPeriod(year: number, month: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

/** 某个日期（YYYY-MM-DD）所在的周期。 */
export function periodOfDate(date: string): string {
  const m = DATE_PATTERN.exec(date);
  if (m === null) throw new RangeError(`日期格式不对（应为 YYYY-MM-DD）：${date}`);
  return `${m[1]}-${m[2]}`;
}

/** 往后（负数往前）挪几个月。 */
export function shiftPeriod(period: string, months: number): string {
  const { year, month } = parsePeriod(period);
  const index = year * 12 + (month - 1) + months;
  return formatPeriod(Math.floor(index / 12), (index % 12) + 1);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function periodFirstDay(period: string): string {
  return `${period}-01`;
}

export function periodLastDay(period: string): string {
  const { year, month } = parsePeriod(period);
  return `${period}-${String(daysInMonth(year, month)).padStart(2, "0")}`;
}

/** 账单的「今天」（`BILLING_RULES.timeZone` 的当地日期）。 */
export function billingToday(now: Date): string {
  return instantToLocal(now, BILLING_RULES.timeZone).date;
}

/** 现在该出哪一期的账：今天所在月份的上一个月（每月 1 日起出上月的账）。 */
export function periodToGenerate(now: Date): string {
  return shiftPeriod(periodOfDate(billingToday(now)), -1);
}

/** 一期是不是已经结束（最后一天早于今天）：只给结束了的周期出账。 */
export function periodEnded(period: string, today: string): boolean {
  return periodLastDay(period) < today;
}

/**
 * 应付日：周期的下一个月的付款日（默认 20 日）；已清退的供应商再往后延 `terminatedDelayMonths` 个月。
 * 付款日不超过当月天数（合同的付款日是 1–28，本来就不会超）。
 */
export function payDueDate(period: string, paymentDay: number, terminated: boolean): string {
  if (!Number.isInteger(paymentDay) || paymentDay < 1 || paymentDay > 28) throw new RangeError(`付款日必须是 1–28：${paymentDay}`);
  const month = shiftPeriod(period, 1 + (terminated ? BILLING_RULES.terminatedDelayMonths : 0));
  return `${month}-${String(paymentDay).padStart(2, "0")}`;
}

/**
 * 复核通过的账单进哪一天的付款批次：从应付日开始，取第一个「不早于今天、那一天的批次还没关」的付款日；
 * 不行就顺延一个月（同一个日子）。`batchClosed(date)` 告诉这一天的批次是不是已经关了（锁定待转账或已付款）。
 */
export function payoutDateFor(payDue: string, today: string, batchClosed: (date: string) => boolean): string {
  const m = DATE_PATTERN.exec(payDue);
  if (m === null) throw new RangeError(`日期格式不对（应为 YYYY-MM-DD）：${payDue}`);
  const day = m[3] as string;
  let period = `${m[1]}-${m[2]}`;
  // 最多往后找 10 年：每个月的批次都关了只可能是数据出错
  for (let i = 0; i < 120; i += 1) {
    const date = `${period}-${day}`;
    if (date >= today && !batchClosed(date)) return date;
    period = shiftPeriod(period, 1);
  }
  throw new RangeError(`找不到可用的付款日：${payDue}`);
}

// ---- 账单明细 ----

/**
 * 明细的种类（应付给供应商的方向：正数平台付给供应商，负数从供应商的应付里扣）：
 * - `order` 已完成订单的结算价（+）；`no_show` 客人未出现、审核通过（+，全额）；`cancellation` 有偿取消的供应商应得（+，结算价 × 扣款比例）；
 * - `extra_charge` 事后加收、已从客人那里扣到款（+，审核通过的金额）；
 * - `deduction` 应扣款项（−，违约金、救援差价，ADR 0031）；`deduction_waiver` 已出账的应扣款项之后被认定不可抗力免除，退回（+）；
 * - `carry_forward` 上期结转（−，上一期合计为负、复核后转入下一期）。
 */
export const STATEMENT_LINE_KINDS = ["order", "no_show", "cancellation", "extra_charge", "deduction", "deduction_waiver", "carry_forward"] as const;
export type StatementLineKind = (typeof STATEMENT_LINE_KINDS)[number];

export const STATEMENT_LINE_KIND_NAMES: Readonly<Record<StatementLineKind, string>> = {
  order: "已完成订单",
  no_show: "客人未出现",
  cancellation: "有偿取消",
  extra_charge: "事后加收",
  deduction: "违约金与扣款",
  deduction_waiver: "扣款免除",
  carry_forward: "上期结转",
};

/** 订单这一行能不能出账、出多少。只有终态才出：已完成、客人未出现（审核通过）、有偿取消（供应商应得大于 0）。 */
export function orderBillable(order: { status: string; settlementMinor: number; cancelTenantShareMinor: number | null }): { kind: "order" | "no_show" | "cancellation"; amountMinor: number } | null {
  if (order.status === "completed") return { kind: "order", amountMinor: order.settlementMinor };
  if (order.status === "no_show") return { kind: "no_show", amountMinor: order.settlementMinor };
  if (order.status === "cancelled" && order.cancelTenantShareMinor !== null && order.cancelTenantShareMinor > 0) return { kind: "cancellation", amountMinor: order.cancelTenantShareMinor };
  return null;
}

/**
 * 事后加收能不能出账：只有已从客人那里扣到款的（`charged`）；金额是审核通过的（部分通过时比报的少），没审过的是报的金额。
 * 异议期内、待审核、正在扣、扣款失败的还没结案，等结案后在之后一期出；驳回、撤回的不出。
 */
export function extraChargeBillable(charge: { status: string; amountMinor: number; approvedMinor: number | null }): number | null {
  if (charge.status !== "charged") return null;
  return charge.approvedMinor ?? charge.amountMinor;
}

/**
 * 应扣款项（违约金、救援差价）怎么出账：
 * - 待扣的、金额大于 0、这一单在这家供应商那里已经到了终态（救援的：原供应商那一行已转给救援供应商或已取消——救援有了结论；
 *   以后工单记的赔付：订单已完成）、还没出过账 → 扣（`deduction`，负数）；
 * - 已经出过账、之后被免除（不可抗力）、还没退回过 → 退回（`deduction_waiver`，正数）；
 * - 已经免除、扣款那一行所在的账单被作废了、但退回那一行还在别的有效账单上 → 照旧扣（`deduction`）：保持「扣一次、退一次」，净额为 0
 *   （否则重出的账单不扣、退回却还在，供应商多拿一笔；M5-01 测试发现的缺陷）；
 * - 其余不出（0 元的违约金只在供应商的「违约金与扣款」页里看得到）。
 * 不变式：一笔应扣款项的退回行只有在它的扣款行也在有效账单上时才存在（出账、作废重出在同一个事务里核对，repos/billing.ts 的 `unpairedWaivers`）。
 */
export function deductionBillable(deduction: { status: string; amountMinor: number; orderConcluded: boolean; billed: boolean; waiverBilled: boolean }): { kind: "deduction" | "deduction_waiver"; amountMinor: number } | null {
  if (deduction.amountMinor <= 0) return null;
  if (deduction.status === "pending" && deduction.orderConcluded && !deduction.billed) return { kind: "deduction", amountMinor: -deduction.amountMinor };
  if (deduction.status === "waived" && deduction.billed && !deduction.waiverBilled) return { kind: "deduction_waiver", amountMinor: deduction.amountMinor };
  if (deduction.status === "waived" && !deduction.billed && deduction.waiverBilled) return { kind: "deduction", amountMinor: -deduction.amountMinor };
  return null;
}

/** 订单的终态（应扣款项按订单在这家供应商那里到了终态才出账）。 */
export const ORDER_CONCLUDED_STATUSES = ["completed", "no_show", "cancelled", "rescued"] as const;

/** 一笔可以出账的应付（还没挂在任何有效的账单上）。`serviceDate` 为 null 的是上期结转（不属于哪一天）。 */
export interface BillableItem {
  sourceKey: string;
  kind: StatementLineKind;
  currency: CurrencyCode;
  amountMinor: number;
  serviceDate: string | null;
  orderId: string | null;
  orderNo: string | null;
  detail: Record<string, unknown>;
}

export interface StatementDraftLine extends BillableItem {
  /** 服务日期早于这一期（上一期结束时还没结案，或者账单作废后重出）：往期调整 */
  priorPeriod: boolean;
}

export interface StatementDraft {
  currency: CurrencyCode;
  lines: StatementDraftLine[];
  totalMinor: number;
}

/** 一组安全整数相加（最小货币单位）；超出安全整数范围抛 RangeError。 */
export function sumMinor(values: readonly number[]): number {
  let total = 0n;
  for (const value of values) {
    assertMinor(value);
    total += BigInt(value);
  }
  const result = Number(total);
  assertMinor(result);
  return result;
}

const KIND_ORDER: Readonly<Record<StatementLineKind, number>> = { carry_forward: 0, order: 1, no_show: 2, cancellation: 3, extra_charge: 4, deduction: 5, deduction_waiver: 6 };

/**
 * 把一个供应商还没出账的应付组成这一期的账单草稿：服务日期不晚于这一期最后一天的才算（之后的留给以后的期），按币种各出一张；
 * `skipCurrencies` 是这一期已经有有效账单的币种（不重复出；它们的新应付留到下一期）。
 * 只有上期结转、没有别的应付的币种不出账单（结转等下一次有新应付时一起出）。明细按种类、服务日期、订单号排列。
 */
export function draftStatements(period: string, items: readonly BillableItem[], skipCurrencies: readonly string[] = []): StatementDraft[] {
  const first = periodFirstDay(period);
  const last = periodLastDay(period);
  const byCurrency = new Map<CurrencyCode, StatementDraftLine[]>();
  for (const item of items) {
    if (item.serviceDate !== null && item.serviceDate > last) continue;
    if (skipCurrencies.includes(item.currency)) continue;
    const lines = byCurrency.get(item.currency) ?? [];
    lines.push({ ...item, priorPeriod: item.serviceDate === null || item.serviceDate < first });
    byCurrency.set(item.currency, lines);
  }
  const drafts: StatementDraft[] = [];
  for (const [currency, lines] of [...byCurrency.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (!lines.some((line) => line.kind !== "carry_forward")) continue;
    lines.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.serviceDate ?? "").localeCompare(b.serviceDate ?? "") || (a.orderNo ?? "").localeCompare(b.orderNo ?? "") || a.sourceKey.localeCompare(b.sourceKey));
    drafts.push({ currency, lines, totalMinor: sumMinor(lines.map((line) => line.amountMinor)) });
  }
  return drafts;
}

/** 账单按种类的小计（给账单页的汇总区）：每种几条、合计多少；外加总计。 */
export function statementSummary(lines: readonly { kind: StatementLineKind; amountMinor: number }[]): { byKind: Record<StatementLineKind, { count: number; amountMinor: number }>; totalMinor: number } {
  const byKind = Object.fromEntries(STATEMENT_LINE_KINDS.map((kind) => [kind, { count: 0, amountMinor: 0 }])) as Record<StatementLineKind, { count: number; amountMinor: number }>;
  for (const line of lines) {
    const entry = byKind[line.kind];
    entry.count += 1;
    entry.amountMinor = sumMinor([entry.amountMinor, line.amountMinor]);
  }
  return { byKind, totalMinor: sumMinor(lines.map((line) => line.amountMinor)) };
}

// ---- 账单状态 ----

/**
 * `issued` 已出账，待供应商确认；`disputed` 供应商提了异议，待平台答复；`confirmed` 供应商已确认（或确认期满视为确认），待平台双人复核；
 * `in_payout` 复核通过、已进付款批次；`paid` 已付款（M5-02 回填银行流水号时）；
 * `settled` 复核通过、合计为 0，无需付款；`carried` 复核通过、合计为负（扣款多于应付），转入下一期；`void` 已作废（明细释放，重新出账）。
 */
export const STATEMENT_STATUSES = ["issued", "disputed", "confirmed", "in_payout", "paid", "settled", "carried", "void"] as const;
export type StatementStatus = (typeof STATEMENT_STATUSES)[number];

export const STATEMENT_STATUS_NAMES: Readonly<Record<StatementStatus, string>> = {
  issued: "待确认",
  disputed: "有异议",
  confirmed: "待复核",
  in_payout: "待付款",
  paid: "已付款",
  settled: "无需付款",
  carried: "转入下期",
  void: "已作废",
};

/**
 * 对账单的操作：供应商确认、提异议；系统到期视为确认；平台答复异议、作废、发起复核、复核通过（进批次 / 无需付款 / 转入下期）、付款（M5-02）。
 */
export type StatementAction = "confirm" | "auto_confirm" | "dispute" | "reply" | "void" | "request_review" | "approve" | "pay";

const ALLOWED_FROM: Readonly<Record<StatementAction, readonly StatementStatus[]>> = {
  // 提了异议之后供应商想通了也可以直接确认
  confirm: ["issued", "disputed"],
  // 有异议的不自动确认：等平台答复
  auto_confirm: ["issued"],
  dispute: ["issued"],
  reply: ["disputed"],
  // 进了付款批次的不能作废（钱要付了）；已经有结论的（无需付款、转入下期）也不能
  void: ["issued", "disputed", "confirmed"],
  request_review: ["confirmed"],
  approve: ["confirmed"],
  pay: ["in_payout"],
};

export function statementActionAllowed(status: StatementStatus, action: StatementAction): boolean {
  return ALLOWED_FROM[action].includes(status);
}

/** 复核通过后的状态：合计为正进付款批次，为 0 无需付款，为负转入下一期。 */
export function statusAfterApproval(totalMinor: number): "in_payout" | "settled" | "carried" {
  assertMinor(totalMinor);
  if (totalMinor > 0) return "in_payout";
  return totalMinor === 0 ? "settled" : "carried";
}

/** 确认期截止：出账（或平台答复异议）起 `confirmDays` 天，按毫秒。 */
export function confirmDueAt(from: Date): Date {
  return new Date(from.getTime() + BILLING_RULES.confirmDays * 24 * 3_600_000);
}

/** 到了确认期截止（含那一刻）还是「待确认」：系统视为确认。 */
export function autoConfirmDue(statement: { status: StatementStatus; confirmDueAt: Date }, now: Date): boolean {
  return statement.status === "issued" && now.getTime() >= statement.confirmDueAt.getTime();
}

// ---- 付款批次 ----

/** `open` 收账单中；`closed` 已锁定，等银行转账（导出转账文件在 M5-02）；`paid` 已付款（M5-02 回填流水号）。 */
export const PAYOUT_BATCH_STATUSES = ["open", "closed", "paid"] as const;
export type PayoutBatchStatus = (typeof PAYOUT_BATCH_STATUSES)[number];

/** 批次按币种的合计（批次里有多种币种的账单）：每种币种几张、合计多少，按币种代码排列。 */
export function payoutTotals(statements: readonly { currency: string; totalMinor: number }[]): { currency: string; count: number; totalMinor: number }[] {
  const map = new Map<string, { count: number; values: number[] }>();
  for (const statement of statements) {
    const entry = map.get(statement.currency) ?? { count: 0, values: [] };
    entry.count += 1;
    entry.values.push(statement.totalMinor);
    map.set(statement.currency, entry);
  }
  return [...map.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([currency, entry]) => ({ currency, count: entry.count, totalMinor: sumMinor(entry.values) }));
}
