/**
 * 点对点「线路价」（docs/design/pages/tenant-prices.md 17.3、17.4，ADR 0073 第二部分，M8-12）：
 * 新增线路价的对话框（含返程价格）怎么展开成表里的行、复制线路怎么算、保存被拒时的说法。
 * 线路价和区域价是同一种价格规则（多一个下车区域），所以行的模型、读法、批量保存都沿用 price-form.ts；这里只管线路特有的部分。
 * 不依赖浏览器，用 node:test 直接测。金额都是结算价（规则 4）。
 */
import { PRICE_LIMITS, type PricingModel, applyBasisPoints, findPriceRuleOverlaps, priceRuleIsActive } from "@nozomi/domain";
import { percentTextToBasisPoints } from "./adjust-form.ts";
import { INCLUDED_KM_PROBLEM, KM_PAIR_PROBLEM, MODEL_FIELDS, type PriceContext, type PriceField, type PriceRow, type RowProblem, blankRow, liveRules, readRow, rowFields } from "./price-form.ts";
import { moneyText, readAmount } from "./product-display.ts";
import { tidyDate } from "./time-input.ts";

/** 一条线路（单向）：上车区域 → 下车区域。 */
export interface Route {
  from: string;
  to: string;
}

export const routeKey = (route: Route): string => `${route.from}>${route.to}`;
export const isRouteRow = (row: Pick<PriceRow, "toAreaId">): boolean => row.toAreaId !== null;
export const reverseOf = (route: Route): Route => ({ from: route.to, to: route.from });
export const routeOf = (row: PriceRow): Route => ({ from: row.areaId, to: row.toAreaId ?? "" });

export const ROUTE_LEAD = "给「从哪个区域上车、到哪个区域下车」单独定价，只管这一个方向。";
export const ROUTE_LEAD_2 = "有线路价的线路就用线路价，不再和区域价比谁低；没有线路价的线路照常用上面的区域价。";
export const RETURN_HELP = "填了会同时建反方向的线路价，车型组、含公里数、生效日期、启用都和去程一样。建好以后是两条独立的价格，各自改、停用、删除。";
export const INCLUDED_KM_HELP = "一口价里含多少公里。报价时按客人这一单的路线距离算，超出的部分加进一口价。";
export const KM_PRICE_HELP = "超过含的公里数以后每公里加多少。不足 1 公里按 1 公里算（和「里程 + 时长」的按比例不同）。";
export const NO_ROUTE_DISTANCE_NOTE = "拿不到路线距离时（地图服务暂时不可用），这条价格不报价——宁可报不出，也不少收。";

/** 线路在页面上的排列：按商品区域的先后（上车区域，再下车区域）；不在商品里的放最后。 */
export function routeOrder(areaIds: readonly string[]): (route: Route) => string {
  const at = (id: string): string => String(areaIds.indexOf(id) < 0 ? 9999 : areaIds.indexOf(id)).padStart(4, "0");
  return (route) => `${at(route.from)}|${at(route.to)}`;
}

/** 表里出现的线路（含刚添加、还没保存的；不含已经全删的没保存行）。 */
export function routesIn(rows: readonly PriceRow[], areaIds: readonly string[]): Route[] {
  const seen = new Map<string, Route>();
  for (const row of rows) if (isRouteRow(row)) seen.set(routeKey(routeOf(row)), routeOf(row));
  const order = routeOrder(areaIds);
  return [...seen.values()].sort((x, y) => order(x).localeCompare(order(y)));
}

/** 这条线路有没有算数的价格（不含将删除的、已过期的）：「返程：有 / 没有」用。 */
export function routeHasPrices(rows: readonly PriceRow[], route: Route, context: PriceContext): boolean {
  return liveRules(rows, context).some((entry) => entry.row.areaId === route.from && entry.row.toAreaId === route.to && priceRuleIsActive(entry.rule, context.today));
}

/** 这条线路上已经有（没过期的）线路价的车型组：新增对话框里默认不勾。 */
export function pricedGroups(rows: readonly PriceRow[], route: Route, context: PriceContext): Set<string> {
  return new Set(liveRules(rows, context).filter((entry) => entry.row.areaId === route.from && entry.row.toAreaId === route.to && priceRuleIsActive(entry.rule, context.today)).map((entry) => entry.row.vehicleGroupId));
}

// ───── 新增线路价（17.3.2）─────

export interface RouteDraft {
  route: Route;
  groups: string[];
  model: PricingModel;
  /** 主价格和（里程 + 时长的）其余几格、含公里数两格；格子的名字同价格表 */
  values: Record<PriceField, string>;
  /** 返程价格（只有一口价有）：空 = 不建返程 */
  returnPrice: string;
  from: string;
  to: string;
  enabled: boolean;
  attempted: boolean;
}

export type RouteDraftField = PriceField | "returnPrice" | "groups" | "from" | "to";

export function emptyRouteDraft(route: Route, groups: readonly string[], model: PricingModel, today: string): RouteDraft {
  const empty = blankRow({ areaId: route.from, toAreaId: route.to, vehicleGroupId: "", direction: null, packageHours: null }, model, today).values;
  return { route, groups: [...groups], model, values: empty, returnPrice: "", from: today, to: "", enabled: true, attempted: false };
}

/** 对话框里的话：用价格表的同一个读法（readRow）读一行样子，出错文字和表里一样。 */
export function routeDraftIssues(draft: RouteDraft, context: PriceContext): Partial<Record<RouteDraftField, string>> {
  const issues: Partial<Record<RouteDraftField, string>> = {};
  if (draft.groups.length === 0) issues.groups = "至少选一个车型组";
  const probe = probeRow(draft, draft.route, draft.values);
  const reading = readRow(probe, context);
  if (reading.blank) issues.base = draft.model === "mileage_time" ? "请填起步价" : "请填价格";
  for (const problem of reading.problems) if (issues[problem.field] === undefined) issues[problem.field] = draft.model === "fixed" ? problem.text.replace(/基础价/, "价格") : problem.text;
  if (draft.model === "fixed" && draft.returnPrice.trim() !== "") {
    const back = readRow(probeRow(draft, reverseOf(draft.route), { ...draft.values, base: draft.returnPrice }), context);
    const problem = back.problems.find((entry) => entry.field === "base");
    if (problem) issues.returnPrice = problem.text.replace(/^基础价/, "返程价格");
  }
  return issues;
}

function probeRow(draft: RouteDraft, route: Route, values: Record<PriceField, string>): PriceRow {
  // 只留这种计价方式用到的格子：切换计价方式时别的格子里剩下的字不算
  const fields = new Set<PriceField>([...MODEL_FIELDS[draft.model], ...(draft.model === "fixed" ? (["inclKm", "kmPrice"] as const) : [])]);
  const kept = Object.fromEntries(Object.entries(values).map(([field, value]) => [field, fields.has(field as PriceField) ? value : ""])) as Record<PriceField, string>;
  const row = blankRow({ areaId: route.from, toAreaId: route.to, vehicleGroupId: draft.groups[0] ?? "probe", direction: null, packageHours: null }, draft.model, draft.from, kept);
  return { ...row, from: draft.from, to: draft.to, enabled: draft.enabled };
}

export interface RoutePlan {
  outbound: PriceRow[];
  inbound: PriceRow[];
  /** 加进表里以后会和别的价格日期重叠的：去程几条、返程几条 */
  overlapOut: number;
  overlapBack: number;
}

/** 一张带返程的表单 → 表里的新行：每个车型组一行去程；填了返程价格的再一行返程（ADR 0073 第二部分第 3 节：前端展开成两条，一次批量保存）。 */
export function planRoute(rows: readonly PriceRow[], draft: RouteDraft, context: PriceContext): RoutePlan {
  const make = (route: Route, values: Record<PriceField, string>): PriceRow[] =>
    draft.groups.map((vehicleGroupId) => {
      const fields = rowFields(draft.model, context.category);
      const kept = Object.fromEntries(Object.entries(values).map(([field, value]) => [field, fields.includes(field as PriceField) ? value : ""])) as Partial<Record<PriceField, string>>;
      const row = blankRow({ areaId: route.from, toAreaId: route.to, vehicleGroupId, direction: null, packageHours: null }, draft.model, draft.from, kept);
      return { ...row, from: tidyDate(draft.from) ?? draft.from, to: draft.to.trim() === "" ? "" : (tidyDate(draft.to) ?? draft.to), enabled: draft.enabled };
    });
  const outbound = make(draft.route, draft.values);
  const inbound = draft.model === "fixed" && draft.returnPrice.trim() !== "" ? make(reverseOf(draft.route), { ...draft.values, base: draft.returnPrice }) : [];
  const counted = overlapsAmong(rows, [...outbound, ...inbound], context);
  return { outbound, inbound, overlapOut: outbound.filter((row) => counted.has(row.key)).length, overlapBack: inbound.filter((row) => counted.has(row.key)).length };
}

/** 新加的这些行里，有哪些会和表里（或彼此）日期重叠。判断用 @nozomi/domain 的 findPriceRuleOverlaps（和保存时同一个规则）。 */
function overlapsAmong(rows: readonly PriceRow[], added: readonly PriceRow[], context: PriceContext): Set<string> {
  const live = liveRules([...rows, ...added], context);
  const addedKeys = new Set(added.map((row) => row.key));
  const result = new Set<string>();
  for (const [a, b] of findPriceRuleOverlaps(live.map((entry) => entry.rule))) {
    for (const key of [live[a]?.row.key, live[b]?.row.key]) if (key !== undefined && addedKeys.has(key)) result.add(key);
  }
  return result;
}

export function routePlanText(plan: Pick<RoutePlan, "outbound" | "inbound">): string {
  if (plan.inbound.length === 0) return `会建 ${plan.outbound.length} 条线路价。`;
  return `会建 ${plan.outbound.length} 条线路价，返程 ${plan.inbound.length} 条，共 ${plan.outbound.length + plan.inbound.length} 条。`;
}

// ───── 复制线路（17.3.3）─────

export interface CopyDraft {
  source: Route;
  target: Route;
  groups: string[];
  adjust: "none" | "up" | "down";
  by: "percent" | "amount";
  amount: string;
  existing: "skip" | "replace";
  /** 从行的「更多」进来时只复制这一行（null = 这条线路的全部） */
  onlyRow: string | null;
  attempted: boolean;
}

export function copyDraftFor(rows: readonly PriceRow[], source: Route, context: PriceContext, onlyRow: string | null = null, target: Route = reverseOf(source)): CopyDraft {
  const groups = onlyRow !== null ? [rows.find((row) => row.key === onlyRow)?.vehicleGroupId ?? ""].filter((id) => id !== "") : [...new Set(sourceRows(rows, source, context, null).map((row) => row.vehicleGroupId))];
  return { source, target, groups, adjust: "none", by: "percent", amount: "", existing: "skip", onlyRow, attempted: false };
}

/** 原线路里可以复制的行：算数的（读得出来、没标将删除、没过期）。 */
function sourceRows(rows: readonly PriceRow[], source: Route, context: PriceContext, onlyRow: string | null): PriceRow[] {
  return liveRules(rows, context)
    .filter((entry) => entry.row.areaId === source.from && entry.row.toAreaId === source.to && priceRuleIsActive(entry.rule, context.today) && (onlyRow === null || entry.row.key === onlyRow))
    .map((entry) => entry.row);
}

/** 复制线路的车型组选项：原线路里有价格的那些。 */
export function copyGroupOptions(rows: readonly PriceRow[], source: Route, context: PriceContext): string[] {
  return [...new Set(sourceRows(rows, source, context, null).map((row) => row.vehicleGroupId))];
}

export function copyDraftIssues(draft: CopyDraft, currency: string): Partial<Record<"target" | "groups" | "amount", string>> {
  const issues: Partial<Record<"target" | "groups" | "amount", string>> = {};
  if (draft.target.from === "" || draft.target.to === "") issues.target = "请选上车区域和下车区域";
  else if (draft.target.from === draft.target.to) issues.target = "上车区域和下车区域不能相同";
  else if (draft.target.from === draft.source.from && draft.target.to === draft.source.to) issues.target = "要复制到另一条线路";
  if (draft.groups.length === 0) issues.groups = "至少勾一个车型组";
  if (draft.adjust !== "none" && adjustOf(draft, currency) === null) issues.amount = draft.by === "percent" ? "请填 0.01 到 100 之间的百分比，最多 2 位小数" : `请填大于 0 的金额（${currency}）`;
  return issues;
}

function adjustOf(draft: CopyDraft, currency: string): ((minor: number) => number) | null {
  if (draft.adjust === "none") return (minor) => minor;
  const sign = draft.adjust === "up" ? 1 : -1;
  if (draft.by === "percent") {
    const bp = percentTextToBasisPoints(draft.amount);
    if (bp === null || bp <= 0 || bp > 10_000) return null;
    return (minor) => applyBasisPoints(minor, sign * bp);
  }
  const read = readAmount(draft.amount, currency);
  if (!read.ok || read.minor <= 0) return null;
  return (minor) => minor + sign * read.minor;
}

export interface CopyPlan {
  /** 填进表里的新行（目标线路） */
  added: PriceRow[];
  /** 「换成复制过去的」：目标线路里日期重叠、要标成将删除的已保存行，和要去掉的没保存行 */
  replaced: string[];
  /** 目标已经有价格、按「跳过」没填的 */
  skipped: number;
  /** 调完不大于 0、没填的 */
  notPositive: number;
}

/** 复制线路：主价格（价格 / 起步价）按选择上调或下调，含公里数、超出每公里和别的数原样；车型组、生效日期、启用原样。 */
export function planCopy(rows: readonly PriceRow[], draft: CopyDraft, context: PriceContext): CopyPlan {
  const plan: CopyPlan = { added: [], replaced: [], skipped: 0, notPositive: 0 };
  const adjust = adjustOf(draft, context.currency);
  if (adjust === null || Object.keys(copyDraftIssues(draft, context.currency)).some((key) => key !== "amount")) return plan;
  const targetRows = (groupId: string): PriceRow[] => rows.filter((row) => !row.deleted && row.areaId === draft.target.from && row.toAreaId === draft.target.to && row.vehicleGroupId === groupId);
  for (const source of sourceRows(rows, draft.source, context, draft.onlyRow)) {
    if (!draft.groups.includes(source.vehicleGroupId)) continue;
    const existing = targetRows(source.vehicleGroupId).filter((row) => readRow(row, context).rule !== null);
    if (existing.length > 0 && draft.existing === "skip") {
      plan.skipped += 1;
      continue;
    }
    const sourceRule = readRow(source, context).rule;
    if (sourceRule === null) continue;
    const mainMinor = sourceRule.pricing.model === "fixed" ? sourceRule.pricing.basePriceMinor : sourceRule.pricing.model === "mileage_time" ? sourceRule.pricing.startPriceMinor : null;
    if (mainMinor === null) continue;
    const next = adjust(mainMinor);
    const floor = sourceRule.pricing.model === "mileage_time" ? 0 : 1;
    if (next < floor || next > PRICE_LIMITS.maxAmountMinor) {
      plan.notPositive += 1;
      continue;
    }
    for (const row of existing) {
      const rule = readRow(row, context).rule;
      if (rule && rule.validFrom <= (sourceRule.validTo ?? "9999-12-31") && sourceRule.validFrom <= (rule.validTo ?? "9999-12-31")) plan.replaced.push(row.key);
    }
    const added = blankRow({ areaId: draft.target.from, toAreaId: draft.target.to, vehicleGroupId: source.vehicleGroupId, direction: null, packageHours: null }, source.model, source.from, { ...source.values, base: moneyText(next, context.currency).slice(context.currency.length).trim() });
    plan.added.push({ ...added, from: source.from, to: source.to, enabled: source.enabled });
  }
  return plan;
}

/** 把复制的结果放进表里：被换掉的已保存行标成将删除，没保存的直接去掉。 */
export function applyCopy(rows: readonly PriceRow[], plan: CopyPlan): PriceRow[] {
  const replaced = new Set(plan.replaced);
  const kept = rows.flatMap((row) => (!replaced.has(row.key) ? [row] : row.id === null ? [] : [{ ...row, deleted: true }]));
  return [...kept, ...plan.added];
}

export function copyPlanText(plan: CopyPlan): string {
  const parts = [`会填 ${plan.added.length} 条`];
  if (plan.skipped > 0) parts.push(`跳过 ${plan.skipped} 条已经有线路价的`);
  if (plan.notPositive > 0) parts.push(`${plan.notPositive} 条调完不大于 0，不填`);
  return `${parts.join("，")}。`;
}

// ───── 保存被拒（17.7）─────

/**
 * 接口在批量保存里对一条线路价 / 含公里数说「不行」的原因 → 页面上的话（和对应的格子）。认不出的返回 null（用接口的 message）。
 * `name` 是出错那一格指的区域的名字（下车区域的问题指下车区域）。
 */
export function routeIssue(reason: string, field: string, name: string, currency: string): RowProblem | null {
  if (field === "to_area_id" || field === "area_id") {
    if (reason === "SAME_AREA") return { field: "base", text: "上车区域和下车区域相同，同一个区域请用区域价。" };
    if (reason === "AREA_NOT_IN_PRODUCT") return { field: "base", text: `「${name}」已经不在这个商品里，这条线路价保存不了。` };
    if (reason === "AREA_ROLE_NOT_PRICING") return { field: "base", text: `「${name}」是运营区域，不能用来定价：运营区域只决定能不能接单，不带价格。请换一个报价区域（或到区域页面把它改成「运营 + 报价」）。` };
    if (reason === "NOT_APPLICABLE") return { field: "base", text: "只有点对点能设线路价（下车区域）。" };
  }
  if (field === "included_km") {
    if (reason === "REQUIRED") return { field: "inclKm", text: KM_PAIR_PROBLEM };
    if (reason === "OUT_OF_RANGE" || reason === "INVALID") return { field: "inclKm", text: INCLUDED_KM_PROBLEM };
    if (reason === "NOT_APPLICABLE") return { field: "inclKm", text: "只有点对点的一口价能设含公里数。" };
  }
  if (field === "over_km_per_km") {
    if (reason === "REQUIRED") return { field: "kmPrice", text: KM_PAIR_PROBLEM };
    if (reason === "OUT_OF_RANGE" || reason === "INVALID") return { field: "kmPrice", text: `超出每公里最多 ${moneyText(PRICE_LIMITS.maxAmountMinor, currency)}` };
    if (reason === "NOT_APPLICABLE") return { field: "kmPrice", text: "只有点对点的一口价能设超出每公里。" };
  }
  return null;
}
