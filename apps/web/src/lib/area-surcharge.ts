/**
 * 包车「区域加价」块的表格模型（docs/design/pages/tenant-prices.md 17.2，ADR 0073 第三部分，M8-12a）。
 * 一条区域加价 = 加价区域 × 车型组 × 套餐时长 × 生效日期 + 上车加价、下车加价（结算价，商品币种的最小货币单位整数，可以是 0）。
 * 这里只管：把用户敲的字读成数、和接口的数据互相转换、一个区域的汇总、「一次给所有车型组和套餐填同一个加价」展开成一条条、组成批量保存的请求。
 * 日期重叠用 @nozomi/domain 的 findPriceRuleOverlaps（和后端同一份）；不用浮点数算钱。不依赖浏览器，用 node:test 直接测。
 */
import { CURRENCIES, PRICE_LIMITS, type PriceRule, isCurrencyCode, addDays, findPriceRuleOverlaps, priceRuleIsActive, priceRuleIssues } from "@nozomi/domain";
import type { PriceRuleBatch, PriceRuleBody, PriceRuleInput } from "../api/prices.ts";
import { GROUPING_PROBLEM, otherCurrencyProblem, tidyAmountText } from "./amount-input.ts";
import { CURRENCY_NAMES, moneyText, readAmount, tidyAmountDisplay } from "./product-display.ts";
import { tidyDate } from "./time-input.ts";

export const SURCHARGE_MODEL = "charter_area_surcharge" as const;
export type SurchargeAmountField = "pickup" | "dropoff";
export type SurchargeField = SurchargeAmountField | "from" | "to";
export const SURCHARGE_FIELD_NAMES: Readonly<Record<SurchargeAmountField, string>> = { pickup: "上车加价", dropoff: "下车加价" };

/** 价格规则里是不是区域加价（价格表不显示它们，只在「区域加价」块里）。 */
export function isSurchargeItem(item: Pick<PriceRuleBody, "pricing_model">): boolean {
  return item.pricing_model === SURCHARGE_MODEL;
}

export interface SurchargeRow {
  /** 已保存的是价格的编号；没保存的是页面起的记号（提交时当 ref 用） */
  key: string;
  id: string | null;
  areaId: string;
  vehicleGroupId: string;
  packageHours: number;
  pickup: string;
  dropoff: string;
  from: string;
  to: string;
  enabled: boolean;
  /** 明细表里单条的「删除」（保存时真的删这一条；区域整块的「删除」是停用，见 `buildSurchargeBatch` 的 `removing`） */
  deleted: boolean;
  origin: PriceRuleBody | null;
}

export interface SurchargeProblem {
  field: SurchargeField;
  text: string;
}

export interface SurchargeReading {
  blank: boolean;
  rule: PriceRule | null;
  input: PriceRuleInput | null;
  problems: SurchargeProblem[];
}

const amountShown = (minor: number | null, currency: string): string => (minor === null ? "" : moneyText(minor, currency).slice(currency.length).trim());

export function surchargeRowFromRule(rule: PriceRuleBody, currency: string): SurchargeRow {
  return {
    key: rule.id,
    id: rule.id,
    areaId: rule.area_id,
    vehicleGroupId: rule.vehicle_group_id,
    packageHours: rule.package_hours ?? 0,
    pickup: amountShown(rule.pickup_surcharge ?? null, currency),
    dropoff: amountShown(rule.dropoff_surcharge ?? null, currency),
    from: rule.valid_from,
    to: rule.valid_to ?? "",
    enabled: rule.status === "enabled",
    deleted: false,
    origin: rule,
  };
}

/** 一个组合的空行的记号：同一个组合总是同一个，在空行里一敲字它就变成一条真的行。 */
export function blankSurchargeKey(areaId: string, vehicleGroupId: string, packageHours: number): string {
  return `sc-blank|${areaId}|${vehicleGroupId}|${packageHours}`;
}

export function blankSurchargeRow(areaId: string, vehicleGroupId: string, packageHours: number, today: string): SurchargeRow {
  return { key: blankSurchargeKey(areaId, vehicleGroupId, packageHours), id: null, areaId, vehicleGroupId, packageHours, pickup: "", dropoff: "", from: today, to: "", enabled: true, deleted: false, origin: null };
}

let counter = 0;
export function newSurchargeKey(): string {
  counter += 1;
  return `sc-new-${counter}`;
}

export function isBlankSurcharge(row: SurchargeRow): boolean {
  return row.id === null && row.pickup.trim() === "" && row.dropoff.trim() === "";
}

/** 读一个金额格：不能空（不加钱填 0）、不能是负数、不能有多余的小数、不能超过上限。 */
export function readSurchargeAmount(text: string, field: SurchargeAmountField, currency: string): { minor: number } | { problem: string } {
  const name = SURCHARGE_FIELD_NAMES[field];
  const read = tidyAmountText(text, currency);
  if (!read.ok) {
    if (read.reason === "empty") return { problem: `请填${name}，不加钱请填 0` };
    if (read.reason === "negative") return { problem: `${name}不能是负数` };
    if (read.reason === "grouping") return { problem: GROUPING_PROBLEM };
    if (read.reason === "other-currency") return { problem: otherCurrencyProblem(currency) };
    return { problem: `${name}请填数字` };
  }
  const amount = readAmount(read.text, currency);
  if (!amount.ok) {
    const digits = isCurrencyCode(currency) ? CURRENCIES[currency].minorDigits : 0;
    return { problem: /小数/.test(amount.message) ? (digits === 0 ? `${CURRENCY_NAMES[currency] ?? `${currency} `}金额不能有小数` : `${currency} 最多 ${digits} 位小数`) : `${name}最多 ${moneyText(PRICE_LIMITS.maxAmountMinor, currency)}` };
  }
  if (amount.minor > PRICE_LIMITS.maxAmountMinor) return { problem: `${name}最多 ${moneyText(PRICE_LIMITS.maxAmountMinor, currency)}` };
  return { minor: amount.minor };
}

/** 读一行。空行没有问题也没有规则；填了任何一格，两个金额和开始日期就都要填。 */
export function readSurchargeRow(row: SurchargeRow, currency: string): SurchargeReading {
  if (isBlankSurcharge(row)) return { blank: true, rule: null, input: null, problems: [] };
  const problems: SurchargeProblem[] = [];
  const amounts: Partial<Record<SurchargeAmountField, number>> = {};
  for (const field of ["pickup", "dropoff"] as const) {
    const read = readSurchargeAmount(row[field], field, currency);
    if ("problem" in read) problems.push({ field, text: read.problem });
    else amounts[field] = read.minor;
  }
  let from: string | null = null;
  let to: string | null = null;
  if (row.from.trim() === "") problems.push({ field: "from", text: "请填开始日期" });
  else if ((from = tidyDate(row.from)) === null) problems.push({ field: "from", text: "这不是一个日期，请按 2026-10-08 的格式填写" });
  if (row.to.trim() !== "" && (to = tidyDate(row.to)) === null) problems.push({ field: "to", text: "这不是一个日期，请按 2026-10-08 的格式填写" });
  if (from !== null && to !== null && to < from) problems.push({ field: "to", text: "结束日期不能早于开始日期" });
  if (problems.length > 0 || from === null || amounts.pickup === undefined || amounts.dropoff === undefined) return { blank: false, rule: null, input: null, problems };
  const status = row.enabled ? "enabled" : "disabled";
  const rule: PriceRule = { areaId: row.areaId, vehicleGroupId: row.vehicleGroupId, direction: null, packageHours: row.packageHours, pricing: { model: SURCHARGE_MODEL, pickupSurchargeMinor: amounts.pickup, dropoffSurchargeMinor: amounts.dropoff }, validFrom: from, validTo: to, status };
  // 兜底：域里的规则还认为不对、而上面没有报过的（正常不会有）
  for (const issue of priceRuleIssues(rule, { category: "charter" })) problems.push({ field: issue.path === "/dropoff_surcharge" ? "dropoff" : issue.path === "/valid_to" ? "to" : issue.path === "/valid_from" ? "from" : "pickup", text: `这一行不符合要求（${issue.path.slice(1)}）` });
  if (problems.length > 0) return { blank: false, rule: null, input: null, problems };
  return { blank: false, rule, input: surchargeInput(row, amounts.pickup, amounts.dropoff, from, to, status), problems };
}

function surchargeInput(row: Pick<SurchargeRow, "areaId" | "vehicleGroupId" | "packageHours">, pickup: number, dropoff: number, from: string, to: string | null, status: "enabled" | "disabled"): PriceRuleInput {
  return {
    area_id: row.areaId,
    vehicle_group_id: row.vehicleGroupId,
    direction: null,
    package_hours: row.packageHours,
    pricing_model: SURCHARGE_MODEL,
    base_price: null,
    start_price: null,
    start_meters: null,
    start_minutes: null,
    per_km: null,
    per_minute: null,
    min_price: null,
    package_km: null,
    package_price: null,
    overtime_per_hour: null,
    over_km_per_km: null,
    pickup_surcharge: pickup,
    dropoff_surcharge: dropoff,
    valid_from: from,
    valid_to: to,
    status,
  };
}

const COMPARED = ["area_id", "vehicle_group_id", "package_hours", "pickup_surcharge", "dropoff_surcharge", "valid_from", "valid_to", "status"] as const;
const sameAsOrigin = (input: PriceRuleInput, origin: PriceRuleBody): boolean => COMPARED.every((key) => (input[key] ?? null) === (origin[key] ?? null));

export type SurchargeChange = "none" | "blank" | "new" | "changed" | "deleted";

export function surchargeChange(row: SurchargeRow, reading: SurchargeReading): SurchargeChange {
  if (row.deleted) return row.id === null ? "blank" : "deleted";
  if (reading.blank) return "blank";
  if (row.origin === null) return "new";
  return reading.input !== null && sameAsOrigin(reading.input, row.origin) ? "none" : "changed";
}

/**
 * 页面上的区域加价 → 批量保存的请求体（和价格表的一起提交，同一事务）。
 * `removing` 是标了「将删除」的加价区域：删除 = 停用（ADR 0073），已保存的启用中的那几条改成不启用，不发删除；没保存过的不提交。
 */
export function buildSurchargeBatch(rows: readonly SurchargeRow[], currency: string, removing: ReadonlySet<string>): PriceRuleBatch {
  const batch: PriceRuleBatch = { create: [], update: [], delete: [] };
  for (const row of rows) {
    if (removing.has(row.areaId)) {
      const origin = row.origin;
      if (row.id !== null && origin !== null && origin.status === "enabled") {
        batch.update.push({ ...surchargeInput(row, origin.pickup_surcharge ?? 0, origin.dropoff_surcharge ?? 0, origin.valid_from, origin.valid_to, "disabled"), id: row.id });
      }
      continue;
    }
    const reading = readSurchargeRow(row, currency);
    const change = surchargeChange(row, reading);
    if (change === "deleted" && row.id !== null) batch.delete.push(row.id);
    else if (change === "new" && reading.input) batch.create.push({ ...reading.input, ref: row.key });
    else if (change === "changed" && reading.input && row.id !== null) batch.update.push({ ...reading.input, id: row.id });
  }
  return batch;
}

/** 要保存的条数（和价格表的一起算「一次最多 500 条」）。 */
export function surchargeChangeCount(rows: readonly SurchargeRow[], currency: string, removing: ReadonlySet<string>): number {
  const batch = buildSurchargeBatch(rows, currency, removing);
  return batch.create.length + batch.update.length + batch.delete.length;
}

/** 还算数的行（不含将删除的、标了将删除的区域里的、空行、读不出来的）。 */
export function liveSurcharges(rows: readonly SurchargeRow[], currency: string, removing: ReadonlySet<string> = new Set()): { row: SurchargeRow; rule: PriceRule }[] {
  return rows.flatMap((row) => {
    if (row.deleted || removing.has(row.areaId)) return [];
    const rule = readSurchargeRow(row, currency).rule;
    return rule ? [{ row, rule }] : [];
  });
}

/** 日期重叠：行的 key → 和它重叠的那些行的 key（同一个加价区域 × 车型组 × 套餐时长）。 */
export function surchargeOverlaps(rows: readonly SurchargeRow[], currency: string, removing: ReadonlySet<string>): Map<string, string[]> {
  const live = liveSurcharges(rows, currency, removing);
  const result = new Map<string, string[]>();
  for (const [a, b] of findPriceRuleOverlaps(live.map((entry) => entry.rule))) {
    const [x, y] = [live[a]?.row.key, live[b]?.row.key];
    if (x === undefined || y === undefined) continue;
    result.set(x, [...(result.get(x) ?? []), y]);
    result.set(y, [...(result.get(y) ?? []), x]);
  }
  return result;
}

export interface Range {
  min: number;
  max: number;
}

export interface AreaSummary {
  pickup: Range | null;
  dropoff: Range | null;
  /** 范围里有几个「车型组 × 套餐」组合没有启用中（或以后生效）的加价 */
  missing: number;
  total: number;
}

const widen = (range: Range | null, value: number): Range => (range === null ? { min: value, max: value } : { min: Math.min(range.min, value), max: Math.max(range.max, value) });

/** 一个加价区域在「看：」范围里的汇总：只看启用、现在或以后生效的，加上没保存的修改。 */
export function areaSummary(rows: readonly SurchargeRow[], areaId: string, groupIds: readonly string[], packages: readonly number[], currency: string, today: string): AreaSummary {
  const live = liveSurcharges(rows.filter((row) => row.areaId === areaId), currency).filter((entry) => priceRuleIsActive(entry.rule, today));
  let pickup: Range | null = null;
  let dropoff: Range | null = null;
  let missing = 0;
  for (const groupId of groupIds) {
    for (const hours of packages) {
      const found = live.filter((entry) => entry.rule.vehicleGroupId === groupId && entry.rule.packageHours === hours);
      if (found.length === 0) missing += 1;
      for (const entry of found) {
        if (entry.rule.pricing.model !== SURCHARGE_MODEL) continue;
        pickup = widen(pickup, entry.rule.pricing.pickupSurchargeMinor);
        dropoff = widen(dropoff, entry.rule.pricing.dropoffSurchargeMinor);
      }
    }
  }
  return { pickup, dropoff, missing, total: groupIds.length * packages.length };
}

/** 汇总格的数：一样写一个数，不一样写「最小–最大」（不带币种，千分位）。 */
export function rangeText(range: Range | null, currency: string): string {
  if (range === null) return "—";
  const one = (minor: number): string => amountShown(minor, currency);
  return range.min === range.max ? one(range.min) : `${one(range.min)}–${one(range.max)}`;
}

export interface FillRequest {
  areaId: string;
  groupIds: readonly string[];
  packages: readonly number[];
  /** 空 = 不改这一项（只在编辑、范围里各组合不同时允许） */
  pickup: string;
  dropoff: string;
  from: string;
  to: string;
  /** 已经填了的组合：改成这次填的 / 跳过 */
  existing: "overwrite" | "skip";
}

export interface FillPlan {
  /** 会新填的空组合 */
  fill: number;
  /** 会改的已经填了的组合 */
  overwrite: number;
  /** 不止一段还没过期的日期的组合（只改最后一段） */
  multiSegment: number;
}

const sameCombo = (row: SurchargeRow, areaId: string, groupId: string, hours: number): boolean => row.areaId === areaId && row.vehicleGroupId === groupId && row.packageHours === hours;
const ending = (row: SurchargeRow): string => (row.to.trim() === "" ? "9999-12-31" : row.to.trim());

/** 这个组合里「填了的」行（不含将删除的、空行）。 */
function filledRows(rows: readonly SurchargeRow[], areaId: string, groupId: string, hours: number): SurchargeRow[] {
  return rows.filter((row) => sameCombo(row, areaId, groupId, hours) && !row.deleted && !isBlankSurcharge(row));
}

export function planFill(rows: readonly SurchargeRow[], request: Pick<FillRequest, "areaId" | "groupIds" | "packages" | "existing">, today: string): FillPlan {
  const plan: FillPlan = { fill: 0, overwrite: 0, multiSegment: 0 };
  for (const groupId of request.groupIds) {
    for (const hours of request.packages) {
      const filled = filledRows(rows, request.areaId, groupId, hours);
      if (filled.length === 0) plan.fill += 1;
      else if (request.existing === "overwrite") {
        plan.overwrite += 1;
        if (filled.filter((row) => ending(row) >= today).length > 1) plan.multiSegment += 1;
      }
    }
  }
  return plan;
}

/**
 * 「一次给所有车型组和套餐填同一个加价」：按勾选的组合展开成一条条（新的，未保存）。
 * 空着的组合新填一条（空行就地填上）；已经填了的组合按 `existing`：改「结束得最晚的那一段」的金额，或跳过。
 * 返回新的全部行和第一条被填的行（焦点落到那里）。
 */
export function applyFill(rows: readonly SurchargeRow[], request: FillRequest, currency: string): { rows: SurchargeRow[]; first: string | null; count: number } {
  const next = [...rows];
  let first: string | null = null;
  let count = 0;
  const tidy = (text: string): string => tidyAmountDisplay(text, currency);
  for (const groupId of request.groupIds) {
    for (const hours of request.packages) {
      const filled = filledRows(next, request.areaId, groupId, hours);
      if (filled.length === 0) {
        if (request.pickup.trim() === "" || request.dropoff.trim() === "") continue;
        const values = { pickup: tidy(request.pickup), dropoff: tidy(request.dropoff), from: request.from, to: request.to, enabled: true };
        const at = next.findIndex((row) => sameCombo(row, request.areaId, groupId, hours) && row.id === null && !row.deleted);
        let key: string;
        if (at >= 0) {
          const row = next[at] as SurchargeRow;
          next[at] = { ...row, ...values };
          key = row.key;
        } else {
          key = newSurchargeKey();
          next.push({ key, id: null, areaId: request.areaId, vehicleGroupId: groupId, packageHours: hours, ...values, deleted: false, origin: null });
        }
        first ??= key;
        count += 1;
      } else if (request.existing === "overwrite") {
        const latest = [...filled].sort((x, y) => ending(y).localeCompare(ending(x)))[0] as SurchargeRow;
        const at = next.findIndex((row) => row.key === latest.key);
        next[at] = { ...latest, ...(request.pickup.trim() === "" ? {} : { pickup: tidy(request.pickup) }), ...(request.dropoff.trim() === "" ? {} : { dropoff: tidy(request.dropoff) }) };
        first ??= latest.key;
        count += 1;
      }
    }
  }
  return { rows: next, first, count };
}

/** 编辑对话框预先填的数：范围里填了的组合都一样就是那个数，不一样（或一个都没填）是空。 */
export function commonAmount(rows: readonly SurchargeRow[], areaId: string, field: SurchargeAmountField, currency: string, today: string): string {
  const live = liveSurcharges(rows.filter((row) => row.areaId === areaId), currency).filter((entry) => priceRuleIsActive(entry.rule, today));
  const values = new Set(live.map((entry) => (entry.rule.pricing.model === SURCHARGE_MODEL ? (field === "pickup" ? entry.rule.pricing.pickupSurchargeMinor : entry.rule.pricing.dropoffSurchargeMinor) : -1)));
  if (values.size !== 1) return "";
  return amountShown([...values][0] as number, currency);
}

/** 「这一行的意思」里加价那一段（17.2.3）。填 0 写成人话。 */
export function surchargeSentence(areaName: string, pickupMinor: number, dropoffMinor: number, currency: string): string {
  const part = (end: "上车点" | "下车点", minor: number): string => (minor === 0 ? `${end}在${areaName}时不加钱` : `${end}在${areaName}时加 ${moneyText(minor, currency)}`);
  return `${part("上车点", pickupMinor)}，${part("下车点", dropoffMinor)}。`;
}

/** 生效日期的一句话（同价格表）。 */
export function surchargeValidity(rule: Pick<PriceRule, "validFrom" | "validTo" | "status">): string {
  return `${rule.validTo === null ? `${rule.validFrom} 起一直有效。` : `${rule.validFrom} 至 ${rule.validTo} 有效。`}${rule.status === "disabled" ? "现在是停用的，不会用来报价。" : ""}`;
}

/** 这一行现在怎么样（同价格表 3.7 的写法）。 */
export function surchargeState(row: SurchargeRow, reading: SurchargeReading, overlapping: boolean, today: string): { state: "error" | "overlap" | "deleted" | "new" | "changed" | "blank" | "disabled" | "expired" | "upcoming" | "active"; text: string } {
  const change = surchargeChange(row, reading);
  if (change === "deleted") return { state: "deleted", text: "将删除" };
  if (reading.problems.length > 0) return { state: "error", text: reading.problems[0]?.text ?? "" };
  if (overlapping) return { state: "overlap", text: "和别的区域加价日期重叠" };
  if (change === "new") return { state: "new", text: "新的，未保存" };
  if (change === "changed") return { state: "changed", text: "改过，未保存" };
  const rule = reading.rule;
  if (change === "blank" || rule === null) return { state: "blank", text: "没填" };
  if (rule.status === "disabled") return { state: "disabled", text: "已停用" };
  if (!priceRuleIsActive(rule, today)) return { state: "expired", text: "已过期" };
  if (rule.validFrom > today) return { state: "upcoming", text: `${rule.validFrom} 起生效` };
  if (rule.validTo !== null && rule.validTo <= addDays(today, 30)) return { state: "active", text: `生效中，${rule.validTo} 到期` };
  return { state: "active", text: "生效中" };
}
