/**
 * 调价规则的表单模型和读回的话（docs/design/pages/tenant-prices.md 第 5 节）。
 * 页面上用「上调 / 下调」和不带正负号的数，接口里是带正负号的基点整数 / 最小货币单位整数；换算只用字符串和整数。
 * 「写得对不对」问 @nozomi/domain 的 adjustRuleIssues；逐步计算和取整用 applyAdjustRules，这里不做任何乘除。
 */
import { type AdjustRule, type AdjustStep, CURRENCIES, type ExactAmount, PRICE_LIMITS, type PriceRule, type ServiceCategory, type TripDirection, addDays, adjustRuleCoversPrice, adjustRuleIssues, formatExact, formatExactMajor, hasVisibleText, priceDirectionNames, isCurrencyCode, parseTimeOfDay, weekdayOf } from "@nozomi/domain";
import type { AdjustRuleBody, AdjustRuleInput } from "../api/prices.ts";
import { countryName } from "./master-display.ts";
import { amountText, moneyText, readAmount } from "./product-display.ts";
import { crossesMidnight, tidyDate, tidyTime, windowReadback } from "./time-input.ts";

export type CycleType = "daily" | "weekly" | "dates" | "holidays";

export interface StepForm {
  up: boolean;
  type: "percent" | "amount";
  value: string;
}

export interface AdjustForm {
  name: string;
  enabled: boolean;
  from: string;
  to: string;
  cycle: CycleType;
  weekdays: number[];
  dates: string[];
  countries: string[];
  slotMode: "all" | "slot";
  slotStart: string;
  slotEnd: string;
  areaMode: "all" | "some";
  areaIds: string[];
  groupMode: "all" | "some";
  groupIds: string[];
  /** 接送机：客人这一单是接还是送 */
  direction: "both" | TripDirection;
  packageMode: "all" | "some";
  packages: number[];
  steps: StepForm[];
}

export interface AdjustContext {
  category: ServiceCategory;
  currency: string;
}

export const WEEKDAY_NAMES = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"] as const;

/** 基点 → 百分比的写法（最多两位小数，不带百分号）：2000 → "20"，1250 → "12.5"。 */
export function basisPointsText(bp: number): string {
  const abs = Math.abs(bp);
  const fraction = String(abs % 100).padStart(2, "0").replace(/0+$/, "");
  return `${Math.trunc(abs / 100)}${fraction === "" ? "" : `.${fraction}`}`;
}

/** 百分比的写法 → 基点（不带正负号）；最多两位小数，认不出来返回 null。 */
export function percentTextToBasisPoints(text: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text.trim().replace(/[０-９．]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0)).replace(/%$/, ""));
  return match ? Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0")) : null;
}

export function emptyAdjustForm(today: string): AdjustForm {
  return { name: "", enabled: true, from: today, to: "", cycle: "daily", weekdays: [], dates: [], countries: [], slotMode: "all", slotStart: "", slotEnd: "", areaMode: "all", areaIds: [], groupMode: "all", groupIds: [], direction: "both", packageMode: "all", packages: [], steps: [{ up: true, type: "percent", value: "" }] };
}

export function formFromAdjustRule(rule: AdjustRuleInput, currency: string): AdjustForm {
  const cycle = rule.cycle;
  return {
    name: rule.name,
    enabled: rule.status === "enabled",
    from: rule.travel_from ?? "",
    to: rule.travel_to ?? "",
    cycle: cycle.type,
    weekdays: cycle.type === "weekly" ? [...cycle.weekdays] : [],
    dates: cycle.type === "dates" ? [...cycle.dates].sort() : [],
    countries: cycle.type === "holidays" ? [...cycle.countries] : [],
    slotMode: rule.time_slot === null ? "all" : "slot",
    slotStart: rule.time_slot?.start ?? "",
    slotEnd: rule.time_slot?.end ?? "",
    areaMode: rule.area_ids.length === 0 ? "all" : "some",
    areaIds: [...rule.area_ids],
    groupMode: rule.vehicle_group_ids.length === 0 ? "all" : "some",
    groupIds: [...rule.vehicle_group_ids],
    direction: rule.directions.length === 1 ? (rule.directions[0] as TripDirection) : "both",
    packageMode: rule.package_hours.length === 0 ? "all" : "some",
    packages: [...rule.package_hours],
    steps: rule.steps.map((step) => ({ up: step.value >= 0, type: step.type, value: step.type === "percent" ? basisPointsText(step.value) : amountText(Math.abs(step.value), currency) })),
  };
}

export interface AdjustProblem {
  text: string;
  /** 页面上元素的 id */
  target: string;
}

export interface AdjustReading {
  input: AdjustRuleInput | null;
  rule: AdjustRule | null;
  /** 读得出来的那些步骤（试算用；有读不出来的步骤时比表单里的少） */
  steps: AdjustStep[];
  problems: AdjustProblem[];
}

/** 读一遍表单。调价规则必须填完整才能保存，所以没填的也算在 problems 里。 */
export function readAdjustForm(form: AdjustForm, context: AdjustContext): AdjustReading {
  const problems: AdjustProblem[] = [];
  const name = form.name.trim();
  if (!hasVisibleText(name)) problems.push({ text: "请填写名称", target: "adjust-name" });
  else if (name.length > PRICE_LIMITS.maxAdjustNameLength) problems.push({ text: `名称最多 ${PRICE_LIMITS.maxAdjustNameLength} 个字`, target: "adjust-name" });

  let from: string | null = null;
  let to: string | null = null;
  if (form.cycle !== "dates") {
    if (form.from.trim() !== "" && (from = tidyDate(form.from)) === null) problems.push({ text: "出行日期：这不是一个日期，请按 2026-10-08 的格式填写", target: "adjust-from" });
    if (form.to.trim() !== "" && (to = tidyDate(form.to)) === null) problems.push({ text: "出行日期：这不是一个日期，请按 2026-10-08 的格式填写", target: "adjust-to" });
    if (from !== null && to !== null && to < from) problems.push({ text: "出行日期：结束日期不能早于开始日期", target: "adjust-to" });
  }
  if (form.cycle === "weekly" && form.weekdays.length === 0) problems.push({ text: "周期：请至少选一天", target: "adjust-weekdays" });
  if (form.cycle === "dates" && form.dates.length === 0) problems.push({ text: "周期：请至少添加一个日期", target: "adjust-date-add" });
  if (form.cycle === "dates" && form.dates.length > PRICE_LIMITS.maxAdjustDates) problems.push({ text: `周期：最多 ${PRICE_LIMITS.maxAdjustDates} 个日期`, target: "adjust-date-add" });
  if (form.cycle === "holidays" && form.countries.length === 0) problems.push({ text: "周期：请至少选一个国家的节假日", target: "adjust-countries" });

  let slot: { start: string; end: string } | null = null;
  if (form.slotMode === "slot") {
    const start = tidyTime(form.slotStart);
    const end = form.slotEnd.trim() === "24:00" ? "24:00" : tidyTime(form.slotEnd);
    if (start === null) problems.push({ text: "时段：请填时间，例如 22:00", target: "adjust-slot-start" });
    if (end === null) problems.push({ text: "时段：请填时间，例如 06:00", target: "adjust-slot-end" });
    if (start !== null && end !== null) {
      if (parseTimeOfDay(start) === parseTimeOfDay(end, { allowEndOfDay: true })) problems.push({ text: "时段：开始和结束不能相同。全天都调请选「全天」", target: "adjust-slot-end" });
      else slot = { start, end };
    }
  }
  if (form.areaMode === "some" && form.areaIds.length === 0) problems.push({ text: "区域：请至少选一个区域，或改成「全部区域」", target: "adjust-areas" });
  if (form.groupMode === "some" && form.groupIds.length === 0) problems.push({ text: "车型组：请至少选一个车型组，或改成「全部车型组」", target: "adjust-groups" });
  if (context.category === "charter" && form.packageMode === "some" && form.packages.length === 0) problems.push({ text: "套餐：请至少选一个套餐，或改成「全部套餐」", target: "adjust-packages" });

  const steps: AdjustStep[] = [];
  form.steps.forEach((step, index) => {
    const target = `adjust-step-${index}-value`;
    const label = `第 ${index + 1} 步`;
    if (step.value.trim() === "") return void problems.push({ text: `${label}：请填大于 0 的数。不想调，请删掉这一步`, target });
    if (step.type === "percent") {
      const bp = percentTextToBasisPoints(step.value);
      if (bp === null) problems.push({ text: `${label}：请填数字，最多两位小数`, target });
      else if (bp === 0) problems.push({ text: `${label}：请填大于 0 的数。不想调，请删掉这一步`, target });
      else if (step.up && bp > PRICE_LIMITS.maxPercentBp) problems.push({ text: `${label}：上调最多 ${basisPointsText(PRICE_LIMITS.maxPercentBp).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}%`, target });
      else if (!step.up && bp > -PRICE_LIMITS.minPercentBp) problems.push({ text: `${label}：下调要小于 100%`, target });
      else steps.push({ type: "percent", value: step.up ? bp : -bp });
    } else {
      const amount = readAmount(step.value, context.currency);
      if (!amount.ok) problems.push({ text: `${label}：${amount.message}`, target });
      else if (amount.minor === 0) problems.push({ text: `${label}：请填大于 0 的数。不想调，请删掉这一步`, target });
      else steps.push({ type: "amount", value: step.up ? amount.minor : -amount.minor });
    }
  });
  if (form.steps.length === 0) problems.push({ text: "怎么调：至少要有一步", target: "adjust-step-add" });

  const cycle: AdjustRule["cycle"] = form.cycle === "weekly" ? { type: "weekly", weekdays: [...form.weekdays].sort((x, y) => x - y) } : form.cycle === "dates" ? { type: "dates", dates: [...form.dates].sort() } : form.cycle === "holidays" ? { type: "holidays", countries: [...form.countries] } : { type: "daily" };
  const rule: AdjustRule = {
    name,
    travelFrom: from,
    travelTo: to,
    cycle,
    timeSlot: slot,
    areaIds: form.areaMode === "some" ? [...form.areaIds] : [],
    vehicleGroupIds: form.groupMode === "some" ? [...form.groupIds] : [],
    directions: context.category === "airport_transfer" && form.direction !== "both" ? [form.direction] : [],
    packageHours: context.category === "charter" && form.packageMode === "some" ? [...form.packages].sort((x, y) => x - y) : [],
    steps,
    status: form.enabled ? "enabled" : "disabled",
  };
  // 兜底：域里的规则还认为不对、而上面没有报过的（正常不会有）
  if (problems.length === 0) for (const issue of adjustRuleIssues(rule, { category: context.category })) problems.push({ text: `这条规则不符合要求（${issue.path.slice(1)}）`, target: "adjust-name" });
  if (problems.length > 0) return { input: null, rule: null, steps, problems };
  const input: AdjustRuleInput = { name, travel_from: from, travel_to: to, cycle, time_slot: slot, area_ids: rule.areaIds, vehicle_group_ids: rule.vehicleGroupIds, directions: rule.directions, package_hours: rule.packageHours, steps, status: rule.status };
  return { input, rule, steps, problems };
}

/** 接口里的一条调价规则 → 域里的写法（列表里的提醒、试算用）。 */
export function ruleFromBody(body: AdjustRuleInput): AdjustRule {
  return { name: body.name, travelFrom: body.travel_from, travelTo: body.travel_to, cycle: body.cycle, timeSlot: body.time_slot, areaIds: body.area_ids, vehicleGroupIds: body.vehicle_group_ids, directions: body.directions, packageHours: body.package_hours, steps: body.steps, status: body.status };
}

// ───────────── 读回来的话 ─────────────

/** 一步的话：「上调 20%」「下调 JPY 1,000」。 */
export function stepText(step: AdjustStep, currency: string): string {
  const verb = step.value >= 0 ? "上调" : "下调";
  return step.type === "percent" ? `${verb} ${basisPointsText(step.value)}%` : `${verb} ${moneyText(Math.abs(step.value), currency)}`;
}

/** 几步连起来：第一步之后的写「再…」。 */
export function stepsText(steps: readonly AdjustStep[], currency: string): string[] {
  return steps.map((step, index) => `${index === 0 ? "" : "再"}${stepText(step, currency)}`);
}

export function travelText(from: string | null, to: string | null): string {
  if (from !== null && to !== null) return `${from} 至 ${to}`;
  if (from !== null) return `${from} 起`;
  return to !== null ? `到 ${to} 为止` : "不限日期";
}

export function cycleText(cycle: AdjustRule["cycle"]): string {
  if (cycle.type === "daily") return "每天";
  if (cycle.type === "weekly") return `每${[...cycle.weekdays].sort((x, y) => x - y).map((day) => WEEKDAY_NAMES[day - 1] ?? "").join("、")}`;
  if (cycle.type === "dates") return cycle.dates.length <= 3 ? `指定日期 ${[...cycle.dates].sort().join("、")}` : `指定的 ${cycle.dates.length} 天`;
  return `${cycle.countries.map((code) => countryName(code) ?? code).join("、")}的节假日`;
}

/** 时段的话。和服务时间不同：这里结束那一刻不算在内，跨午夜的算在开始的那一天头上。 */
export function slotText(slot: { start: string; end: string } | null): string {
  if (slot === null) return "全天";
  const end = parseTimeOfDay(slot.end, { allowEndOfDay: true }) ?? 0;
  const start = parseTimeOfDay(slot.start) ?? 0;
  return end < start ? `${slot.start}–次日 ${slot.end}` : `${slot.start}–${slot.end}`;
}

/** 时段输入下面那一行：结合周期把跨午夜落在哪一天写清楚。时段不合法返回 null。 */
export function slotReadback(cycle: AdjustRule["cycle"], slot: { start: string; end: string }): string | null {
  const base = windowReadback(slot.start, slot.end);
  if (base === null) return null;
  const crossing = crossesMidnight(slot.start, slot.end);
  if (cycle.type === "weekly" && cycle.weekdays.length > 0) {
    return [...cycle.weekdays]
      .sort((x, y) => x - y)
      .map((day) => (crossing ? `${WEEKDAY_NAMES[day - 1]} ${slot.start}–${WEEKDAY_NAMES[day % 7]} ${slot.end}` : `${WEEKDAY_NAMES[day - 1]} ${slot.start}–${slot.end}`))
      .join("、");
  }
  if (cycle.type === "dates" && cycle.dates.length > 0) {
    const dates = [...cycle.dates].sort();
    const first = dates[0] as string;
    return `${first} ${slot.start}–${crossing ? `${addDays(first, 1)} ` : ""}${slot.end}${dates.length > 1 ? `，其余 ${dates.length - 1} 天同样` : ""}`;
  }
  if (cycle.type === "holidays") return base.replace(/^每天/, "每个假日");
  return base;
}

/**
 * 精确值（@nozomi/domain 的 ExactAmount，单位是最小货币单位）写成给人看的金额：按币种把小数点挪到主单位，带千分位和币种。
 * 换成主单位用 @nozomi/domain 的 formatExactMajor；这里只加千分位、币种和正负号。
 */
export function exactMoneyText(amount: ExactAmount, currency: string, signed = false): string {
  const raw = isCurrencyCode(currency) ? formatExactMajor(amount, currency) : formatExact(amount);
  const negative = raw.startsWith("-");
  const digits = isCurrencyCode(currency) ? CURRENCIES[currency].minorDigits : 0;
  const [whole = "0", shortFraction = ""] = (negative ? raw.slice(1) : raw).split(".");
  // 补齐到币种的小数位（4,600.5 写成 4,600.50）
  const fraction = shortFraction.padEnd(digits, "0");
  const sign = negative ? "−" : signed ? "+" : "";
  return `${sign}${currency} ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${fraction === "" ? "" : `.${fraction}`}`;
}

/** 精确值是不是整数个最小货币单位（不是的话要标「还没取整」）。 */
export function isWholeMinor(amount: ExactAmount): boolean {
  return amount.denominator === 1n;
}

export function bodyStatusText(rule: Pick<AdjustRuleBody, "status">): string {
  return rule.status === "enabled" ? "已启用" : "已停用";
}

/**
 * 一条规则存得下来，不等于它会生效（第 5.6 节）：适用范围里没有价格、出行日期和价格的生效日期不重合、选的周几在出行日期里一次都不出现。
 * `prices` 是启用且没过期的价格。没有问题返回 null。
 */
export function reachWarning(rule: AdjustRule, prices: readonly PriceRule[]): string | null {
  const covered = prices.filter((price) => adjustRuleCoversPrice(rule, price));
  if (covered.length === 0) return "适用范围里现在没有价格，这条规则暂时调不到任何东西。";
  const dates = rule.cycle.type === "dates" ? [...rule.cycle.dates].sort() : null;
  const from = dates ? (dates[0] ?? null) : rule.travelFrom;
  const to = dates ? (dates[dates.length - 1] ?? null) : rule.travelTo;
  const inEffect = (price: PriceRule): boolean => (dates ? dates.some((date) => date >= price.validFrom && (price.validTo === null || date <= price.validTo)) : (to === null || price.validFrom <= to) && (from === null || price.validTo === null || price.validTo >= from));
  if (!covered.some(inEffect)) return "这段出行日期里，适用范围内没有生效的价格。";
  if (rule.cycle.type === "weekly" && from !== null && to !== null && to >= from && addDays(from, 6) > to) {
    const present = new Set<number>();
    for (let date = from; date <= to; date = addDays(date, 1)) present.add(weekdayOf(date));
    const chosen = [...rule.cycle.weekdays].sort((x, y) => x - y);
    if (!chosen.some((day) => present.has(day))) return `出行日期里没有${chosen.map((day) => WEEKDAY_NAMES[day - 1] ?? "").join("、")}，这条规则不会生效。`;
  }
  return null;
}

/** 一串名字写成「第一个 + 等 N 个」。 */
export function firstAndCount(names: readonly string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names[0]}等 ${names.length} 个`;
}

export function tripDirectionsText(directions: readonly TripDirection[], station: boolean): string {
  const { pickup, dropoff } = priceDirectionNames(station ? "station" : null);
  return directions.length === 1 ? `只${directions[0] === "pickup" ? pickup : dropoff}` : `${pickup}和${dropoff}`;
}
