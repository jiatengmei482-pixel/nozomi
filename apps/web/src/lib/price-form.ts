/**
 * 「价格规则」页签的表格模型（docs/design/pages/tenant-prices.md 第 3、4 节）：每一行是一条价格，或一个还没有价格的组合（空行）。
 * 这里只管三件事：把用户敲的字读成数（金额、公里、分钟、日期）、把接口的数据和页面上的行互相转换、把一行读成一句人话。
 * 「写得对不对」、日期重叠、缺价的组合、基础价的例子全部问 @nozomi/domain（和后端同一份），不另写规则，不用浮点数算钱。
 */
import {
  CURRENCIES,
  PRICE_LIMITS,
  type PriceCoverage,
  type PriceDirection,
  type PriceRule,
  type Pricing,
  type PricingModel,
  type ServiceCategory,
  type TripDirection,
  addDays,
  basePrice,
  findPriceRuleOverlaps,
  formatExact,
  isCurrencyCode,
  priceCoverage,
  priceRuleIsActive,
  priceRuleIssues,
} from "@nozomi/domain";
import type { PriceRuleBatch, PriceRuleBody, PriceRuleInput } from "../api/prices.ts";
import { CURRENCY_NAMES, amountText, moneyText, readAmount } from "./product-display.ts";
import { tidyDate } from "./time-input.ts";

/** 一行里的各个数（都是用户敲的字）。 */
export const PRICE_FIELDS = ["base", "startKm", "startMin", "perKm", "perMin", "min", "pkgKm", "pkgPrice", "overHour", "overKm"] as const;
export type PriceField = (typeof PRICE_FIELDS)[number];
export type RowField = PriceField | "from" | "to";

export interface PriceRow {
  /** 已保存的是价格的编号；没保存的是页面起的记号（提交时当 ref 用） */
  key: string;
  id: string | null;
  areaId: string;
  vehicleGroupId: string;
  direction: PriceDirection | null;
  packageHours: number | null;
  model: PricingModel;
  /** `base` 是这一行的主价格：一口价的基础价、里程 + 时长的起步价；包车的套餐价在 `pkgPrice` */
  values: Record<PriceField, string>;
  from: string;
  to: string;
  enabled: boolean;
  /** 已保存的行标了「将删除」 */
  deleted: boolean;
  /** 打开（或上次保存）时的样子；没保存过的是 null */
  origin: PriceRuleBody | null;
}

export interface PriceContext {
  category: ServiceCategory;
  currency: string;
  /** 城市当地的今天（来自接口，不用浏览器的日期） */
  today: string;
  /** 接送点是车站：方向叫接站、送站 */
  station: boolean;
}

export const FIELD_NAMES: Readonly<Record<PriceField, string>> = { base: "基础价", startKm: "起步里程", startMin: "起步时长", perKm: "超出每公里", perMin: "超出每分钟", min: "最低消费", pkgKm: "套餐公里", pkgPrice: "套餐价", overHour: "超时每小时", overKm: "超公里每公里" };
/** 每种计价方式用到哪几格（按表格里从左到右）。 */
export const MODEL_FIELDS: Readonly<Record<PricingModel, readonly PriceField[]>> = { fixed: ["base"], mileage_time: ["base", "startKm", "startMin", "perKm", "perMin", "min"], charter_package: ["pkgKm", "pkgPrice", "overHour", "overKm"] };
const MONEY_FIELDS: readonly PriceField[] = ["base", "perKm", "perMin", "min", "pkgPrice", "overHour", "overKm"];
/** 可以填 0 的（0 = 不另收）。 */
const ZERO_OK: readonly PriceField[] = ["perKm", "perMin", "overHour", "overKm", "startKm", "startMin"];

export function fieldName(field: PriceField, model: PricingModel): string {
  return field === "base" && model === "mileage_time" ? "起步价" : FIELD_NAMES[field];
}

export function directionName(direction: PriceDirection | TripDirection, station: boolean): string {
  return direction === "both" ? "接送通用" : direction === "pickup" ? (station ? "接站" : "接机") : station ? "送站" : "送机";
}

const EMPTY_VALUES: Record<PriceField, string> = { base: "", startKm: "", startMin: "", perKm: "", perMin: "", min: "", pkgKm: "", pkgPrice: "", overHour: "", overKm: "" };
const halfWidth = (text: string): string => text.replace(/[０-９．，]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));

/** 整数米 → 公里的写法（最多 1 位小数），用字符串换算。 */
export function metersToKmText(meters: number): string {
  const tenths = Math.trunc(meters / 100);
  return tenths % 10 === 0 ? String(tenths / 10) : `${Math.trunc(tenths / 10)}.${tenths % 10}`;
}

/** 公里的写法（最多 1 位小数）→ 整数米；认不出来返回 null。 */
export function kmTextToMeters(text: string): number | null {
  const match = /^(\d+)(?:\.(\d))?$/.exec(halfWidth(text).trim().replace(/,/g, ""));
  return match ? Number(match[1]) * 1000 + Number(match[2] ?? "0") * 100 : null;
}

export function rowFromRule(rule: PriceRuleBody, currency: string): PriceRow {
  const money = (value: number | null): string => (value === null ? "" : amountText(value, currency));
  return {
    key: rule.id,
    id: rule.id,
    areaId: rule.area_id,
    vehicleGroupId: rule.vehicle_group_id,
    direction: rule.direction,
    packageHours: rule.package_hours,
    model: rule.pricing_model,
    values: {
      base: money(rule.pricing_model === "mileage_time" ? rule.start_price : rule.base_price),
      startKm: rule.start_meters === null ? "" : metersToKmText(rule.start_meters),
      startMin: rule.start_minutes === null ? "" : String(rule.start_minutes),
      perKm: money(rule.per_km),
      perMin: money(rule.per_minute),
      min: money(rule.min_price),
      pkgKm: rule.package_km === null ? "" : String(rule.package_km),
      pkgPrice: money(rule.package_price),
      overHour: money(rule.overtime_per_hour),
      overKm: money(rule.over_km_per_km),
    },
    from: rule.valid_from,
    to: rule.valid_to ?? "",
    enabled: rule.status === "enabled",
    deleted: false,
    origin: rule,
  };
}

let blankCounter = 0;
/** 一个还没有价格的组合的空行。 */
export function blankRow(combo: { areaId: string; vehicleGroupId: string; direction: PriceDirection | null; packageHours: number | null }, model: PricingModel, today: string, values: Partial<Record<PriceField, string>> = {}): PriceRow {
  blankCounter += 1;
  return { key: `new-${blankCounter}`, id: null, ...combo, model, values: { ...EMPTY_VALUES, ...values }, from: today, to: "", enabled: true, deleted: false, origin: null };
}

/** 这一行还没填任何价格（空行不提交；包车新套餐预先填好的套餐公里不算）。 */
export function isBlank(row: PriceRow): boolean {
  return row.id === null && MODEL_FIELDS[row.model].every((field) => (field === "pkgKm" ? true : row.values[field].trim() === ""));
}

export interface RowProblem {
  field: RowField;
  text: string;
}

export interface RowReading {
  blank: boolean;
  /** 读得出来的规则；有读不出来的格时是 null */
  rule: PriceRule | null;
  input: PriceRuleInput | null;
  problems: RowProblem[];
  /** 值得提醒、但不拦保存的 */
  notes: string[];
}

function decimalsText(currency: string): string {
  const digits = isCurrencyCode(currency) ? CURRENCIES[currency].minorDigits : 0;
  return digits === 0 ? `${CURRENCY_NAMES[currency] ?? currency}金额不能有小数` : `${currency} 最多 ${digits} 位小数`;
}

/** 读一行。空行没有问题也没有规则；填了任何一格价格，这一行的必填格就都要填齐。 */
export function readRow(row: PriceRow, context: PriceContext): RowReading {
  if (isBlank(row)) return { blank: true, rule: null, input: null, problems: [], notes: [] };
  const problems: RowProblem[] = [];
  const numbers: Partial<Record<PriceField, number | null>> = {};
  for (const field of MODEL_FIELDS[row.model]) {
    const name = fieldName(field, row.model);
    const text = halfWidth(row.values[field]).trim().replace(/[,\s¥円元]/g, "").replace(new RegExp(context.currency, "gi"), "");
    if (text === "") {
      if (field === "min") numbers[field] = null;
      else problems.push({ field, text: `请填${name}${ZERO_OK.includes(field) && field !== "startKm" && field !== "startMin" ? "，不另收请填 0" : ""}` });
      continue;
    }
    if (text.startsWith("-")) {
      problems.push({ field, text: `${name}不能是负数` });
      continue;
    }
    if (MONEY_FIELDS.includes(field)) {
      if (!/^\d+(\.\d+)?$/.test(text)) problems.push({ field, text: "请填数字" });
      else {
        const amount = readAmount(text, context.currency);
        if (!amount.ok) problems.push({ field, text: /小数/.test(amount.message) ? decimalsText(context.currency) : `${name}最多 ${moneyText(PRICE_LIMITS.maxAmountMinor, context.currency)}` });
        else if (amount.minor === 0 && !ZERO_OK.includes(field) && !(field === "base" && row.model === "mileage_time")) problems.push({ field, text: `${name}要大于 0` });
        else numbers[field] = amount.minor;
      }
    } else if (field === "startKm") {
      const meters = kmTextToMeters(text);
      if (meters === null || meters > PRICE_LIMITS.maxStartMeters) problems.push({ field, text: /^\d+(\.\d+)?$/.test(text) ? `请填 0 到 ${PRICE_LIMITS.maxStartMeters / 1000} 之间的数，最多 1 位小数` : "请填数字" });
      else numbers[field] = meters;
    } else {
      const [min, max] = field === "startMin" ? [0, PRICE_LIMITS.maxStartMinutes] : [1, PRICE_LIMITS.maxPackageKm];
      if (!/^\d+$/.test(text) || Number(text) < min || Number(text) > max) problems.push({ field, text: /^\d+(\.\d+)?$/.test(text) ? `请填 ${min} 到 ${max} 之间的整数` : "请填数字" });
      else numbers[field] = Number(text);
    }
  }
  let from: string | null = null;
  let to: string | null = null;
  if (row.from.trim() === "") problems.push({ field: "from", text: "请填开始日期" });
  else if ((from = tidyDate(row.from)) === null) problems.push({ field: "from", text: "这不是一个日期，请按 2026-10-08 的格式填写" });
  if (row.to.trim() !== "" && (to = tidyDate(row.to)) === null) problems.push({ field: "to", text: "这不是一个日期，请按 2026-10-08 的格式填写" });
  if (from !== null && to !== null && to < from) problems.push({ field: "to", text: "结束日期不能早于开始日期" });
  if (row.model === "mileage_time" && numbers.base === 0 && numbers.min === null && !problems.some((problem) => problem.field === "min")) problems.push({ field: "min", text: "起步价是 0 时，请填最低消费" });
  if (problems.length > 0 || from === null) return { blank: false, rule: null, input: null, problems, notes: [] };

  const n = (field: PriceField): number => numbers[field] as number;
  const pricing: Pricing =
    row.model === "fixed"
      ? { model: "fixed", basePriceMinor: n("base") }
      : row.model === "mileage_time"
        ? { model: "mileage_time", startPriceMinor: n("base"), startMeters: n("startKm"), startMinutes: n("startMin"), perKmMinor: n("perKm"), perMinuteMinor: n("perMin"), minPriceMinor: numbers.min ?? null }
        : { model: "charter_package", packageKm: n("pkgKm"), packagePriceMinor: n("pkgPrice"), overtimePerHourMinor: n("overHour"), overKmPerKmMinor: n("overKm") };
  const status = row.enabled ? "enabled" : "disabled";
  const rule: PriceRule = { areaId: row.areaId, vehicleGroupId: row.vehicleGroupId, direction: row.direction, packageHours: row.packageHours, pricing, validFrom: from, validTo: to, status };
  // 兜底：域里的规则还认为不对、而上面没有报过的（正常不会有）
  for (const issue of priceRuleIssues(rule, { category: context.category })) problems.push({ field: "base", text: `这一行不符合要求（${issue.path.slice(1)}）` });
  const input: PriceRuleInput = {
    area_id: row.areaId,
    vehicle_group_id: row.vehicleGroupId,
    direction: row.direction,
    package_hours: row.packageHours,
    pricing_model: row.model,
    base_price: pricing.model === "fixed" ? pricing.basePriceMinor : null,
    start_price: pricing.model === "mileage_time" ? pricing.startPriceMinor : null,
    start_meters: pricing.model === "mileage_time" ? pricing.startMeters : null,
    start_minutes: pricing.model === "mileage_time" ? pricing.startMinutes : null,
    per_km: pricing.model === "mileage_time" ? pricing.perKmMinor : null,
    per_minute: pricing.model === "mileage_time" ? pricing.perMinuteMinor : null,
    min_price: pricing.model === "mileage_time" ? pricing.minPriceMinor : null,
    package_km: pricing.model === "charter_package" ? pricing.packageKm : null,
    package_price: pricing.model === "charter_package" ? pricing.packagePriceMinor : null,
    overtime_per_hour: pricing.model === "charter_package" ? pricing.overtimePerHourMinor : null,
    over_km_per_km: pricing.model === "charter_package" ? pricing.overKmPerKmMinor : null,
    valid_from: from,
    valid_to: to,
    status,
  };
  const notes = pricing.model === "mileage_time" && pricing.minPriceMinor !== null && pricing.minPriceMinor < pricing.startPriceMinor ? ["最低消费比起步价低，不会起作用。"] : [];
  return { blank: false, rule: problems.length > 0 ? null : rule, input: problems.length > 0 ? null : input, problems, notes };
}

const INPUT_KEYS = ["area_id", "vehicle_group_id", "direction", "package_hours", "pricing_model", "base_price", "start_price", "start_meters", "start_minutes", "per_km", "per_minute", "min_price", "package_km", "package_price", "overtime_per_hour", "over_km_per_km", "valid_from", "valid_to", "status"] as const;
const sameInput = (input: PriceRuleInput, origin: PriceRuleBody): boolean => INPUT_KEYS.every((key) => input[key] === origin[key]);

export type RowChange = "none" | "blank" | "new" | "changed" | "deleted";

/** 这一行相对上次保存有没有变。读不出来的已保存行算「改过」（它肯定和原来不一样了）。 */
export function rowChange(row: PriceRow, reading: RowReading): RowChange {
  if (row.deleted) return "deleted";
  if (reading.blank) return "blank";
  if (row.origin === null) return "new";
  return reading.input !== null && sameInput(reading.input, row.origin) ? "none" : "changed";
}

/** 页面上现在的全部内容 → 批量保存的请求体。只在没有任何「写错了的」时调用。 */
export function buildBatch(rows: readonly PriceRow[], context: PriceContext): PriceRuleBatch {
  const batch: PriceRuleBatch = { create: [], update: [], delete: [] };
  for (const row of rows) {
    const reading = readRow(row, context);
    const change = rowChange(row, reading);
    if (change === "deleted" && row.id !== null) batch.delete.push(row.id);
    else if (change === "new" && reading.input) batch.create.push({ ...reading.input, ref: row.key });
    else if (change === "changed" && reading.input && row.id !== null) batch.update.push({ ...reading.input, id: row.id });
  }
  return batch;
}

/** 页面上现在算数的规则（不含将删除的、空行、读不出来的），连同它来自哪一行。 */
export function liveRules(rows: readonly PriceRow[], context: PriceContext): { row: PriceRow; rule: PriceRule }[] {
  return rows.flatMap((row) => {
    if (row.deleted) return [];
    const rule = readRow(row, context).rule;
    return rule ? [{ row, rule }] : [];
  });
}

/** 日期重叠的行：行的 key → 和它重叠的那些行的 key。判断用 @nozomi/domain 的 findPriceRuleOverlaps。 */
export function rowOverlaps(rows: readonly PriceRow[], context: PriceContext): Map<string, string[]> {
  const live = liveRules(rows, context);
  const result = new Map<string, string[]>();
  for (const [a, b] of findPriceRuleOverlaps(live.map((entry) => entry.rule))) {
    const [x, y] = [live[a]?.row.key, live[b]?.row.key];
    if (x === undefined || y === undefined) continue;
    result.set(x, [...(result.get(x) ?? []), y]);
    result.set(y, [...(result.get(y) ?? []), x]);
  }
  return result;
}

export interface Coverage {
  total: number;
  priced: number;
  missing: number;
  /** 包车：全部套餐时长（含刚新增、还没填价的） */
  packages: number[];
  combos: (PriceCoverage["combos"][number] & { row: PriceRow | null })[];
}

/** 按页面上现在的内容算「该有价格的组合」。包车：只有空行的新套餐也算进去（接口不知道它们）。 */
export function tableCoverage(rows: readonly PriceRow[], context: PriceContext, areaIds: readonly string[], vehicleGroupIds: readonly string[]): Coverage {
  const live = liveRules(rows, context).filter((entry) => areaIds.includes(entry.rule.areaId) && vehicleGroupIds.includes(entry.rule.vehicleGroupId));
  const coverage = priceCoverage({ category: context.category, areaIds, vehicleGroupIds, rules: live.map((entry) => entry.rule), today: context.today });
  const combos: Coverage["combos"] = coverage.combos.map((combo) => ({ ...combo, row: combo.ruleIndex === null ? null : (live[combo.ruleIndex]?.row ?? null) }));
  const packages = context.category === "charter" ? [...new Set([...coverage.packages, ...rows.filter((row) => !row.deleted && row.packageHours !== null).map((row) => row.packageHours as number)])].sort((x, y) => x - y) : [];
  for (const hours of packages) {
    if (coverage.packages.includes(hours)) continue;
    for (const areaId of areaIds) for (const vehicleGroupId of vehicleGroupIds) combos.push({ areaId, vehicleGroupId, direction: null, packageHours: hours, state: "missing", ruleIndex: null, viaBoth: false, from: null, row: null });
  }
  const priced = combos.filter((combo) => combo.state !== "missing").length;
  return { total: combos.length, priced, missing: combos.length - priced, packages, combos };
}

/**
 * 给每个还没有价格的组合补一个空行（已经有空行的不重复补）。
 * 接送机：两个方向都没有价格 → 一行「接送通用」；只缺一个方向 → 一行那个方向。
 */
export function withBlankRows(rows: readonly PriceRow[], context: PriceContext, areaIds: readonly string[], vehicleGroupIds: readonly string[], model: PricingModel, extraPackages: readonly number[] = []): PriceRow[] {
  const coverage = tableCoverage(rows, context, areaIds, vehicleGroupIds);
  const added: PriceRow[] = [];
  const hasBlank = (areaId: string, vehicleGroupId: string, packageHours: number | null): boolean => [...rows, ...added].some((row) => !row.deleted && row.areaId === areaId && row.vehicleGroupId === vehicleGroupId && row.packageHours === packageHours && isBlank(row));
  for (const areaId of areaIds) {
    for (const vehicleGroupId of vehicleGroupIds) {
      const missing = coverage.combos.filter((combo) => combo.areaId === areaId && combo.vehicleGroupId === vehicleGroupId && combo.state === "missing");
      if (context.category === "charter") {
        for (const hours of [...new Set([...coverage.packages, ...extraPackages])]) {
          const lacks = missing.some((combo) => combo.packageHours === hours) || !coverage.combos.some((combo) => combo.areaId === areaId && combo.vehicleGroupId === vehicleGroupId && combo.packageHours === hours);
          if (lacks && !hasBlank(areaId, vehicleGroupId, hours)) added.push(blankRow({ areaId, vehicleGroupId, direction: null, packageHours: hours }, "charter_package", context.today));
        }
      } else if (missing.length > 0 && !hasBlank(areaId, vehicleGroupId, null)) {
        const direction: PriceDirection | null = context.category === "airport_transfer" ? (missing.length === 2 ? "both" : (missing[0]?.direction ?? "both")) : null;
        added.push(blankRow({ areaId, vehicleGroupId, direction, packageHours: null }, model, context.today));
      }
    }
  }
  return [...rows, ...added];
}

export type RowState = "error" | "overlap" | "deleted" | "new" | "changed" | "blank" | "disabled" | "expired" | "upcoming" | "expiring" | "active";

/** 这一行现在怎么样（3.7）：从上往下取第一个符合的。 */
export function rowState(row: PriceRow, reading: RowReading, overlapping: boolean, context: PriceContext, rows: readonly PriceRow[]): { state: RowState; text: string } {
  const change = rowChange(row, reading);
  if (change === "deleted") return { state: "deleted", text: "将删除" };
  if (reading.problems.length > 0) return { state: "error", text: reading.problems[0]?.text ?? "" };
  if (overlapping) return { state: "overlap", text: "和别的价格日期重叠" };
  if (change === "new") return { state: "new", text: "新的，未保存" };
  if (change === "changed") return { state: "changed", text: "改过，未保存" };
  if (change === "blank") return { state: "blank", text: "没有价格" };
  const rule = reading.rule;
  if (!rule) return { state: "blank", text: "没有价格" };
  if (rule.status === "disabled") return { state: "disabled", text: "已停用" };
  if (!priceRuleIsActive(rule, context.today)) return { state: "expired", text: "已过期" };
  if (rule.validFrom > context.today) return { state: "upcoming", text: `${rule.validFrom} 起生效` };
  if (rule.validTo !== null && rule.validTo <= addDays(context.today, 30)) {
    const next = addDays(rule.validTo, 1);
    const continued = liveRules(rows, context).some((entry) => entry.row.key !== row.key && entry.rule.status === "enabled" && entry.rule.areaId === rule.areaId && entry.rule.vehicleGroupId === rule.vehicleGroupId && entry.rule.direction === rule.direction && entry.rule.packageHours === rule.packageHours && entry.rule.validFrom <= next && (entry.rule.validTo === null || entry.rule.validTo >= next));
    if (!continued) return { state: "expiring", text: `${rule.validTo} 到期，之后没有价格` };
  }
  return { state: "active", text: "生效中" };
}

/** 精确值（最小货币单位的十进制字符串）四舍五入成带币种的金额：只用来写「例」。 */
function exactMoney(amount: ReturnType<typeof basePrice>, currency: string): string {
  const text = formatExact(amount);
  const [whole = "0", fraction = ""] = text.split(".");
  const rounded = BigInt(whole) + (fraction !== "" && Number(fraction[0]) >= 5 ? 1n : 0n);
  return moneyText(Number(rounded), currency);
}

/** 「这一行的意思」里价格那一段（3.10）。 */
export function pricingSentence(pricing: Pricing, packageHours: number | null, currency: string): string {
  const money = (minor: number): string => moneyText(minor, currency);
  if (pricing.model === "fixed") return `每单 ${money(pricing.basePriceMinor)}，不看里程和时长。`;
  if (pricing.model === "mileage_time") {
    const included = [pricing.startMeters === 0 ? "起步价里不含里程" : `${metersToKmText(pricing.startMeters)} 公里`, pricing.startMinutes === 0 ? "起步价里不含时长" : `${pricing.startMinutes} 分钟`];
    const within = pricing.startMeters === 0 && pricing.startMinutes === 0 ? `起步价 ${money(pricing.startPriceMinor)}（不含里程和时长）` : `${included.join("、")}${pricing.startMeters > 0 || pricing.startMinutes > 0 ? "以内" : ""} ${money(pricing.startPriceMinor)}`;
    const over = [pricing.perKmMinor === 0 ? "超出里程不另收" : `每公里 ${money(pricing.perKmMinor)}（不足 1 公里按比例）`, pricing.perMinuteMinor === 0 ? "超出时长不另收" : `每分钟 ${money(pricing.perMinuteMinor)}`];
    const example = basePrice(pricing, { meters: pricing.startMeters + 10_000, minutes: pricing.startMinutes + 20 });
    return `${within}；超出的部分${over.join("、")}${pricing.minPriceMinor !== null ? `；最少收 ${money(pricing.minPriceMinor)}` : ""}。按预估的里程和时长报价，不按实际跑的结算。例：预估 ${metersToKmText(pricing.startMeters + 10_000)} 公里、${pricing.startMinutes + 20} 分钟 = ${exactMoney(example, currency)}。`;
  }
  const over = [pricing.overtimePerHourMinor === 0 ? "超时不另收" : `超时每小时 ${money(pricing.overtimePerHourMinor)}`, pricing.overKmPerKmMinor === 0 ? "超公里不另收" : `超公里每公里 ${money(pricing.overKmPerKmMinor)}`];
  return `${packageHours ?? ""} 小时、${pricing.packageKm} 公里以内 ${money(pricing.packagePriceMinor)}；${over.join("，")}（超出的部分服务结束后按实际结算，不足 1 小时、1 公里的按比例算）。`;
}

export function validitySentence(rule: Pick<PriceRule, "validFrom" | "validTo" | "status">): string {
  return `${rule.validTo === null ? `${rule.validFrom} 起一直有效。` : `${rule.validFrom} 至 ${rule.validTo} 有效。`}${rule.status === "disabled" ? "现在是停用的，不会用来报价。" : ""}`;
}

/** 这条价格能报出的最低数的写法（覆盖表的格子、试算的选项）：里程 + 时长写「…起」。 */
export function lowestText(pricing: Pricing, currency: string, withCurrency = false): string {
  const full = exactMoney(basePrice(pricing), currency);
  const text = withCurrency ? full : full.slice(currency.length).trim();
  return pricing.model === "mileage_time" ? `${text} 起` : text;
}
