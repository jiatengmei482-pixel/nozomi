/**
 * ② 服务规则的表单模型（docs/design/pages/tenant-products.md 第 5 节）：页面上是用户敲的字，接口要的是整理好的值。
 * 这里把一份表单读成「接口的请求体 + @nozomi/domain 的规则对象 + 写错了的地方」。
 * 范围、上限、缺什么都问 @nozomi/domain（serviceRuleIssues / serviceRuleMissing）；这里只多管「字敲得不成样子」和「填了一半」。
 */
import { type FreeWaitItem, MASTER_DATA_LANGUAGES, type NightChargeUnit, PRODUCT_LIMITS, type RuleIssue, type ServiceCategory, type ServiceRuleContext, type ServiceRules, freeWaitItems, serviceRuleIssues } from "@nozomi/domain";
import type { DailyWindowBody, FreeWaitBody, ServiceRulesBody } from "../api/products.ts";
import { LANGUAGE_NAMES, amountText, readAmount } from "./product-display.ts";
import { tidyDate, tidyTime } from "./time-input.ts";

export interface TierRow {
  hours: string;
  amount: string;
}
export interface WaitField {
  mode: "limited" | "unlimited";
  minutes: string;
}
export interface AddonField {
  enabled: boolean;
  price: string;
  firstFree: boolean;
}
export interface LanguageRow {
  language: string;
  price: string;
}

export interface RulesForm {
  saleMode: "any" | "range";
  saleFrom: string;
  saleTo: string;
  allDay: boolean;
  serviceStart: string;
  serviceEnd: string;
  leadTime: string;
  note: string;
  urgent: boolean;
  quota: string;
  tiers: TierRow[];
  night: boolean;
  nightStart: string;
  nightEnd: string;
  nightUnit: NightChargeUnit | null;
  nightAmount: string;
  wait: Record<FreeWaitItem, WaitField>;
  addons: Record<string, AddonField>;
  languages: LanguageRow[];
}

export interface RulesFormContext extends ServiceRuleContext {
  currency: string | null;
  minimums: Record<FreeWaitItem, number | null>;
  /** 平台目录里现在能勾的附加服务（编号 → 名称）；只用来写出错文字 */
  addonNames: Readonly<Record<string, string>>;
}

export interface RulesProblem {
  text: string;
  /** 页面上元素的 id */
  target: string;
}

export interface RulesReading {
  body: ServiceRulesBody;
  rules: ServiceRules;
  problems: RulesProblem[];
}

const DEFAULT_NIGHT_UNIT: Readonly<Record<ServiceCategory, NightChargeUnit>> = { airport_transfer: "per_order", point_to_point: "per_order", charter: "per_hour" };

export function defaultNightUnit(category: ServiceCategory): NightChargeUnit {
  return DEFAULT_NIGHT_UNIT[category];
}

/** 接口读到的规则 → 表单。从没保存过的免费等待预先填成「等 平台规定的最少分钟数」（保存这一步时才真的存下来）。 */
export function formFromRules(body: ServiceRulesBody, context: Pick<RulesFormContext, "currency" | "category" | "minimums">): RulesForm {
  const { booking, urgent, night } = body;
  const allDay = booking.service_time?.start === "00:00" && booking.service_time.end === "24:00";
  const wait = (item: FreeWaitItem): WaitField => {
    const saved = body.free_wait[item];
    if (saved === null) return { mode: "limited", minutes: context.minimums[item] === null ? "" : String(context.minimums[item]) };
    return saved.mode === "unlimited" ? { mode: "unlimited", minutes: context.minimums[item] === null ? "" : String(context.minimums[item]) } : { mode: "limited", minutes: String(saved.minutes) };
  };
  return {
    saleMode: booking.sale_from !== null || booking.sale_to !== null ? "range" : "any",
    saleFrom: booking.sale_from ?? "",
    saleTo: booking.sale_to ?? "",
    allDay,
    serviceStart: allDay ? "" : (booking.service_time?.start ?? ""),
    serviceEnd: allDay ? "" : (booking.service_time?.end ?? ""),
    leadTime: booking.lead_time_hours === null ? "" : String(booking.lead_time_hours),
    note: booking.note ?? "",
    urgent: urgent.enabled,
    quota: urgent.daily_quota === null ? "" : String(urgent.daily_quota),
    tiers: urgent.tiers.map((tier) => ({ hours: String(tier.within_hours), amount: amountText(tier.surcharge, context.currency) })),
    night: night.enabled,
    nightStart: night.window?.start ?? "",
    nightEnd: night.window?.end ?? "",
    nightUnit: night.charge_unit ?? (night.enabled ? null : defaultNightUnit(context.category)),
    nightAmount: night.amount === null ? "" : amountText(night.amount, context.currency),
    wait: { pickup: wait("pickup"), dropoff: wait("dropoff"), general: wait("general") },
    addons: Object.fromEntries(body.addons.filter((addon) => addon.enabled).map((addon) => [addon.addon_id, { enabled: true, price: amountText(addon.unit_price, context.currency), firstFree: addon.first_free }])),
    languages: body.driver_languages.map((entry) => ({ language: entry.language, price: amountText(entry.unit_price, context.currency) })),
  };
}

const INTEGER = /^\d+$/;
const tidyNumber = (text: string): string => text.trim().replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0)).replace(/,/g, "");

/** 一个时段的两格 → 值；填了一半、认不出来、开始结束相同都算写错。两格都空 = 没填。 */
function readWindow(start: string, end: string, ids: [string, string], label: string, example: string, sameText: string, problems: RulesProblem[]): DailyWindowBody | null {
  if (start.trim() === "" && end.trim() === "") return null;
  const from = tidyTime(start);
  const to = tidyTime(end);
  if (from === null) problems.push({ text: `${label}：${start.trim() === "" ? `请填时间，例如 ${example}` : "请填 00:00 到 23:59 之间的时间"}`, target: ids[0] });
  if (to === null) problems.push({ text: `${label}：${end.trim() === "" ? `请填时间，例如 ${example}` : "请填 00:00 到 23:59 之间的时间"}`, target: ids[1] });
  if (from === null || to === null) return null;
  if (from === to) {
    problems.push({ text: `${label}：${sameText}`, target: ids[1] });
    return null;
  }
  return { start: from, end: to };
}

const camelWindow = (window: DailyWindowBody | null): { start: string; end: string } | null => (window === null ? null : { start: window.start, end: window.end });

/** 域里的问题落在页面的哪个元素上。 */
export function rulePathTarget(path: string): string {
  const index = /\/(\d+)/.exec(path)?.[1] ?? "0";
  if (path.startsWith("/booking/sale_from")) return "sale-from";
  if (path.startsWith("/booking/sale_to")) return "sale-to";
  if (path.startsWith("/booking/service_time")) return "service-time-start";
  if (path.startsWith("/booking/lead_time_hours")) return "lead-time-input";
  if (path.startsWith("/booking/note")) return "note";
  if (path.startsWith("/urgent/daily_quota")) return "urgent-quota";
  if (path.startsWith("/urgent/tiers/")) return path.endsWith("surcharge") ? `tier-${index}-amount` : `tier-${index}-hours`;
  if (path.startsWith("/urgent")) return "urgent-toggle";
  if (path.startsWith("/night/window")) return "night-start";
  if (path.startsWith("/night/amount")) return "night-amount";
  if (path.startsWith("/night")) return "night-toggle";
  const wait = /^\/free_wait\/(pickup|dropoff|general)/.exec(path);
  if (wait) return `wait-${wait[1]}-minutes`;
  if (path.startsWith("/addons")) return "addons";
  if (path.startsWith("/driver_languages/")) return path.endsWith("unit_price") ? `language-${index}-price` : `language-${index}-select`;
  return "service-time-start";
}

/** 读一遍表单。`problems` 是「写错了的」（含填了一半的）；没填的不在里面。 */
export function readRulesForm(form: RulesForm, context: RulesFormContext): RulesReading {
  const problems: RulesProblem[] = [];
  const amount = (text: string, target: string, label: string): number | null => {
    const result = readAmount(text, context.currency);
    if (result.ok) return result.minor;
    problems.push({ text: `${label}：${result.message}`, target });
    return null;
  };

  // 预订规则
  let saleFrom: string | null = null;
  let saleTo: string | null = null;
  if (form.saleMode === "range") {
    for (const [text, target, assign] of [
      [form.saleFrom, "sale-from", (value: string) => (saleFrom = value)],
      [form.saleTo, "sale-to", (value: string) => (saleTo = value)],
    ] as const) {
      if (text.trim() === "") continue;
      const date = tidyDate(text);
      if (date === null) problems.push({ text: "下单有效期：这不是一个日期，请按 2026-10-08 的格式填写", target });
      else assign(date);
    }
    if (saleFrom !== null && saleTo !== null && saleFrom > saleTo) {
      problems.push({ text: "下单有效期：结束日期不能早于开始日期", target: "sale-to" });
      saleTo = null;
    }
  }
  const serviceTime = form.allDay ? { start: "00:00", end: "24:00" } : readWindow(form.serviceStart, form.serviceEnd, ["service-time-start", "service-time-end"], "服务时间", "08:00", "开始和结束不能相同。全天都接单请勾「全天 24 小时」", problems);
  let leadTime: number | null = null;
  const leadText = tidyNumber(form.leadTime);
  if (leadText !== "") {
    if (INTEGER.test(leadText) && Number(leadText) <= PRODUCT_LIMITS.maxLeadTimeHours) leadTime = Number(leadText);
    else problems.push({ text: `提前预订时长：请填 0 到 ${PRODUCT_LIMITS.maxLeadTimeHours} 之间的整数`, target: "lead-time-input" });
  }
  const note = form.note.trim() === "" ? null : form.note.trim();
  if (note !== null && note.length > PRODUCT_LIMITS.maxNoteLength) problems.push({ text: `备注最多 ${PRODUCT_LIMITS.maxNoteLength} 个字`, target: "note" });

  // 加急预订：没勾就整块清掉
  let quota: number | null = null;
  const tiers: { within_hours: number; surcharge: number }[] = [];
  if (form.urgent) {
    const quotaText = tidyNumber(form.quota);
    if (quotaText === "0") problems.push({ text: "每日加急库存：要停掉加急，请取消勾选「允许加急预订」", target: "urgent-quota" });
    else if (quotaText !== "") {
      if (INTEGER.test(quotaText) && Number(quotaText) <= 10_000) quota = Number(quotaText);
      else problems.push({ text: "每日加急库存：请填 1 到 10,000 之间的整数，或留空表示不限", target: "urgent-quota" });
    }
    const limit = leadTime ?? PRODUCT_LIMITS.maxLeadTimeHours;
    const seen = new Map<number, number>();
    form.tiers.forEach((row, index) => {
      const label = `加急阶梯第 ${index + 1} 档`;
      const hoursText = tidyNumber(row.hours);
      if (hoursText === "" && row.amount.trim() === "") return;
      let hours: number | null = null;
      if (hoursText === "") problems.push({ text: `${label}：请填写小时数`, target: `tier-${index}-hours` });
      else if (!INTEGER.test(hoursText) || Number(hoursText) < 1 || Number(hoursText) > limit) problems.push({ text: `${label}：请填 1 到 ${limit} 之间的整数`, target: `tier-${index}-hours` });
      else if (seen.has(Number(hoursText))) problems.push({ text: `第 ${(seen.get(Number(hoursText)) ?? 0) + 1} 档和第 ${index + 1} 档的小时数相同`, target: `tier-${index}-hours` });
      else {
        hours = Number(hoursText);
        seen.set(hours, index);
      }
      const surcharge = row.amount.trim() === "" ? null : amount(row.amount, `tier-${index}-amount`, label);
      if (row.amount.trim() === "") problems.push({ text: `${label}：请填写加收的金额，不加收请填 0`, target: `tier-${index}-amount` });
      if (hours !== null && surcharge !== null) tiers.push({ within_hours: hours, surcharge });
    });
    tiers.sort((x, y) => y.within_hours - x.within_hours);
  }

  // 夜间加价
  let nightWindow: DailyWindowBody | null = null;
  let nightAmount: number | null = null;
  if (form.night) {
    nightWindow = readWindow(form.nightStart, form.nightEnd, ["night-start", "night-end"], "夜间时段", "22:00", "开始和结束不能相同", problems);
    if (form.nightAmount.trim() !== "") nightAmount = amount(form.nightAmount, "night-amount", "夜间加价的金额");
  }

  // 免费等待：只有这个品类该填的几项
  const items = freeWaitItems(context.category);
  const wait = (item: FreeWaitItem): FreeWaitBody | null => {
    if (!items.includes(item)) return null;
    const field = form.wait[item];
    if (field.mode === "unlimited") return { mode: "unlimited" };
    const minimum = context.minimums[item] ?? 0;
    const text = tidyNumber(field.minutes);
    if (INTEGER.test(text) && Number(text) >= minimum && Number(text) <= PRODUCT_LIMITS.maxFreeWaitMinutes) return { mode: "limited", minutes: Number(text) };
    problems.push({ text: `免费等待：${INTEGER.test(text) && Number(text) < minimum ? `不能少于平台规定的 ${minimum} 分钟` : `请填 ${minimum} 到 1,440 之间的整数`}`, target: `wait-${item}-minutes` });
    return null;
  };
  const freeWait = { pickup: wait("pickup"), dropoff: wait("dropoff"), general: wait("general") };

  // 附加服务：只带勾选了的；勾了就必须有单价
  const addons: ServiceRulesBody["addons"] = [];
  for (const [id, field] of Object.entries(form.addons)) {
    if (!field.enabled) continue;
    const label = `附加服务「${context.addonNames[id] ?? ""}」`;
    if (field.price.trim() === "") {
      problems.push({ text: `${label}：请填单价，免费提供请填 0`, target: `addon-${id}-price` });
      continue;
    }
    const price = amount(field.price, `addon-${id}-price`, label);
    if (price !== null) addons.push({ addon_id: id, enabled: true, unit_price: price, first_free: field.firstFree && price > 0 });
  }

  // 司机语言
  const languages: ServiceRulesBody["driver_languages"] = [];
  const usedLanguages = new Map<string, number>();
  form.languages.forEach((row, index) => {
    if (row.language === "" && row.price.trim() === "") return;
    const name = (LANGUAGE_NAMES as Record<string, string>)[row.language] ?? row.language;
    if (row.language === "") problems.push({ text: `司机语言第 ${index + 1} 行：请选择语言`, target: `language-${index}-select` });
    else if (usedLanguages.has(row.language)) problems.push({ text: `司机语言：${name}已经在第 ${(usedLanguages.get(row.language) ?? 0) + 1} 行了`, target: `language-${index}-select` });
    else usedLanguages.set(row.language, index);
    if (row.price.trim() === "") return void problems.push({ text: `司机语言第 ${index + 1} 行：请填单价，免费提供请填 0`, target: `language-${index}-price` });
    const price = amount(row.price, `language-${index}-price`, `司机语言第 ${index + 1} 行`);
    if (price !== null && row.language !== "" && usedLanguages.get(row.language) === index) languages.push({ language: row.language, unit_price: price });
  });

  const body: ServiceRulesBody = {
    booking: { sale_from: saleFrom, sale_to: saleTo, service_time: serviceTime, lead_time_hours: leadTime, note },
    urgent: { enabled: form.urgent, daily_quota: quota, tiers },
    night: { enabled: form.night, window: nightWindow, amount: nightAmount, charge_unit: form.night ? form.nightUnit : null },
    free_wait: freeWait,
    addons,
    driver_languages: languages,
  };
  const rules: ServiceRules = {
    booking: { saleFrom, saleTo, serviceTime: camelWindow(serviceTime), leadTimeHours: leadTime, note },
    urgent: { enabled: form.urgent, dailyQuota: quota, tiers: tiers.map((tier) => ({ withinHours: tier.within_hours, surchargeMinor: tier.surcharge })) },
    night: { enabled: form.night, window: camelWindow(nightWindow), amountMinor: nightAmount, chargeUnit: body.night.charge_unit },
    freeWait,
    addons: addons.map((addon) => ({ addonId: addon.addon_id, enabled: true, unitPriceMinor: addon.unit_price, firstFree: addon.first_free })),
    driverLanguages: languages.map((entry) => ({ language: entry.language, unitPriceMinor: entry.unit_price })),
  };
  // 兜底：域里的规则还认为不对、而上面没有报过的（正常不会有）
  const reported = new Set(problems.map((problem) => problem.target));
  for (const issue of serviceRuleIssues(rules, context)) {
    const target = rulePathTarget(issue.path);
    if (!reported.has(target)) problems.push({ text: ruleIssueText(issue), target });
  }
  return { body, rules, problems };
}

/** 域里的一条问题的一句话（兜底用；常见的情况上面都有专门的文字）。 */
export function ruleIssueText(issue: Pick<RuleIssue, "path" | "reason" | "detail">): string {
  const detail = issue.detail ?? {};
  switch (issue.reason) {
    case "TIER_NOT_WITHIN_LEAD_TIME":
      return `加急阶梯：请填 1 到 ${detail["lead_time_hours"] ?? "提前预订时长"} 之间的整数`;
    case "BELOW_PLATFORM_MINIMUM":
      return `免费等待：不能少于平台规定的 ${detail["min"] ?? ""} 分钟`;
    case "OUT_OF_RANGE":
      return `请填 ${detail["min"] ?? 0} 到 ${detail["max"] ?? ""} 之间的数`;
    case "TOO_MANY":
      return `最多 ${detail["max"] ?? ""} 条`;
    case "TOO_LONG":
      return `最多 ${detail["max"] ?? ""} 个字`;
    case "DUPLICATE":
      return "有重复的内容";
    default:
      return "这一项不符合要求，请检查后重试";
  }
}

export const DRIVER_LANGUAGE_OPTIONS = (["zh", "ja", "en", "ko"] as const).filter((language) => (MASTER_DATA_LANGUAGES as readonly string[]).includes(language)).map((language) => ({ value: language, label: LANGUAGE_NAMES[language] }));
