/**
 * 包车三层区域的价格页模型（M9P-07，ADR 0093 第一、五、七节；规格第四节）：只用于迁移过的商品（价格规则的 `charter_layout = three_layer`）。
 * - 套餐价按「车型组 × 套餐」填一次：整商品套餐价的 `area_id` 是 null。价格表沿用 lib/price-form.ts 的行，区域记成 `WHOLE_PRODUCT_AREA`，提交时换回 null。
 * - 旧的按服务区域的套餐价：只读，折叠显示（`legacyPackageItems`）。
 * - ②行程加价（`charter_itinerary_surcharge`，一格金额）、③上下车加价（`charter_area_surcharge`，上车、下车两格）：按「区域 × 车型组」填，
 *   新填的不分套餐（`package_hours` 为 null）；已有按套餐的行原样显示、可以改。空格 = 不报价（要不加钱必须填 0）。
 * - ③行里迁移前的途经加价是只读旧数据：提交时不带 `waypoint_surcharge` 这个键（后端沿用原值）。
 * - 商品的基础价区域（服务区域）上的③行：后端不让新建、只能删（`AREA_IS_PRODUCT_AREA`），这里叫「挡住的区域」：只提交删除，不算没填的格。
 * 金额是结算价、最小货币单位整数；日期重叠用 @nozomi/domain 的 findPriceRuleOverlaps（和后端同一份）。不依赖浏览器。
 */
import { type PriceRule, type ServiceCategory, addDays, findPriceRuleOverlaps, priceRuleIsActive } from "@nozomi/domain";
import type { PriceRuleBatch, PriceRuleBody, PriceRuleInput, PriceRules } from "../api/prices.ts";
import { readNamedAmount } from "./area-surcharge.ts";
import { moneyText } from "./product-display.ts";
import { tidyDate } from "./time-input.ts";

/** 整商品套餐价在价格表里的「区域」记号（提交时换回 null） */
export const WHOLE_PRODUCT_AREA = "";

export type LayerModel = "charter_itinerary_surcharge" | "charter_area_surcharge";
export type LayerAmountField = "amount" | "pickup" | "dropoff";
export type LayerField = LayerAmountField | "from" | "to";
export const LAYER_FIELDS: Readonly<Record<LayerModel, readonly LayerAmountField[]>> = { charter_itinerary_surcharge: ["amount"], charter_area_surcharge: ["pickup", "dropoff"] };
export const LAYER_FIELD_NAMES: Readonly<Record<LayerAmountField, string>> = { amount: "行程加价", pickup: "上车加价", dropoff: "下车加价" };

/** 页面上的文字（集中放在这里，组件和测试共用） */
export const LAYER_TEXT = {
  itineraryTitle: "行程加价",
  updownTitle: "上下车加价",
  packageTitle: "套餐价",
  emptyCell: "空 = 不报价",
  legacyTitle: "旧的按区域套餐价（只读，迁移前的数据）",
  baseAreaOption: "基础价区域，不能设上下车加价",
  baseAreaRow: "这个区域是商品的基础价区域（服务区域），在这里上下车不加价，不能再设上下车加价。",
  deleteRow: "删除这一行",
  allPackages: "所有套餐",
} as const;

export const missingCellsText = (count: number): string => `${count} 格没填`;
export const migrationDiffText = (count: number): string => `迁移差异 ${count} 条`;

export function isLayeredCharter(category: ServiceCategory, prices: Pick<PriceRules, "charter_layout">): boolean {
  return category === "charter" && prices.charter_layout === "three_layer";
}

/** 整商品套餐价（区域为空），区域换成 `WHOLE_PRODUCT_AREA` 好放进价格表。 */
export function wholePackageItems(items: readonly PriceRuleBody[]): PriceRuleBody[] {
  return items.filter((item) => item.pricing_model === "charter_package" && (item.area_id as string | null) === null).map((item) => ({ ...item, area_id: WHOLE_PRODUCT_AREA }));
}

/** 迁移前的按服务区域套餐价（只读）。 */
export function legacyPackageItems(items: readonly PriceRuleBody[]): PriceRuleBody[] {
  return items.filter((item) => item.pricing_model === "charter_package" && (item.area_id as string | null) !== null);
}

/** 提交前把整商品套餐价的区域记号换回 null。 */
export function withWholeProductArea(batch: PriceRuleBatch): PriceRuleBatch {
  const area = (id: string | null): string | null => (id === WHOLE_PRODUCT_AREA ? null : id);
  return { create: batch.create.map((entry) => ({ ...entry, area_id: area(entry.area_id) })), update: batch.update.map((entry) => ({ ...entry, area_id: area(entry.area_id) })), delete: batch.delete };
}

export interface LayerRow {
  /** 已保存的是价格的编号；没保存的是页面起的记号（提交时当 ref 用） */
  key: string;
  id: string | null;
  model: LayerModel;
  areaId: string;
  vehicleGroupId: string;
  /** null = 所有套餐（新填的都是）；迁移搬过来的、旧的③行可能按套餐 */
  packageHours: number | null;
  amount: string;
  pickup: string;
  dropoff: string;
  from: string;
  to: string;
  enabled: boolean;
  deleted: boolean;
  origin: PriceRuleBody | null;
}

export interface LayerProblem {
  field: LayerField;
  text: string;
}

export interface LayerReading {
  blank: boolean;
  rule: PriceRule | null;
  input: PriceRuleInput | null;
  problems: LayerProblem[];
}

const shown = (minor: number | null | undefined, currency: string): string => (minor === null || minor === undefined ? "" : moneyText(minor, currency).slice(currency.length).trim());

export function isLayerItem(item: Pick<PriceRuleBody, "pricing_model">, model: LayerModel): boolean {
  return item.pricing_model === model;
}

export function layerRowFromRule(rule: PriceRuleBody, model: LayerModel, currency: string): LayerRow {
  return {
    key: rule.id,
    id: rule.id,
    model,
    areaId: rule.area_id,
    vehicleGroupId: rule.vehicle_group_id,
    packageHours: rule.package_hours,
    amount: shown(rule.itinerary_surcharge, currency),
    pickup: shown(rule.pickup_surcharge, currency),
    dropoff: shown(rule.dropoff_surcharge, currency),
    from: rule.valid_from,
    to: rule.valid_to ?? "",
    enabled: rule.status === "enabled",
    deleted: false,
    origin: rule,
  };
}

export function layerRowsOf(data: Pick<PriceRules, "items" | "currency">, model: LayerModel): LayerRow[] {
  return data.items.filter((item) => isLayerItem(item, model)).map((item) => layerRowFromRule(item, model, data.currency));
}

/** 一格（区域 × 车型组）的空行：同一格总是同一个记号，一敲字就变成一条真的行。 */
export function blankLayerKey(model: LayerModel, areaId: string, vehicleGroupId: string): string {
  return `layer-blank|${model}|${areaId}|${vehicleGroupId}`;
}

export function blankLayerRow(model: LayerModel, areaId: string, vehicleGroupId: string, today: string): LayerRow {
  return { key: blankLayerKey(model, areaId, vehicleGroupId), id: null, model, areaId, vehicleGroupId, packageHours: null, amount: "", pickup: "", dropoff: "", from: today, to: "", enabled: true, deleted: false, origin: null };
}

export function isBlankLayer(row: LayerRow): boolean {
  return row.id === null && LAYER_FIELDS[row.model].every((field) => row[field].trim() === "");
}

/** 读一行：填了任何一格，这一行的金额格和开始日期就都要填（不加钱填 0）。 */
export function readLayerRow(row: LayerRow, currency: string): LayerReading {
  if (isBlankLayer(row)) return { blank: true, rule: null, input: null, problems: [] };
  const problems: LayerProblem[] = [];
  const amounts: Partial<Record<LayerAmountField, number>> = {};
  for (const field of LAYER_FIELDS[row.model]) {
    const read = readNamedAmount(row[field], LAYER_FIELD_NAMES[field], currency);
    if ("problem" in read) problems.push({ field, text: read.problem });
    else amounts[field] = read.minor;
  }
  let from: string | null = null;
  let to: string | null = null;
  if (row.from.trim() === "") problems.push({ field: "from", text: "请填开始日期" });
  else if ((from = tidyDate(row.from)) === null) problems.push({ field: "from", text: "这不是一个日期，请按 2026-10-08 的格式填写" });
  if (row.to.trim() !== "" && (to = tidyDate(row.to)) === null) problems.push({ field: "to", text: "这不是一个日期，请按 2026-10-08 的格式填写" });
  if (from !== null && to !== null && to < from) problems.push({ field: "to", text: "结束日期不能早于开始日期" });
  if (problems.length > 0 || from === null) return { blank: false, rule: null, input: null, problems };
  const status = row.enabled ? "enabled" : "disabled";
  const itinerary = row.model === "charter_itinerary_surcharge";
  const [amount, pickup, dropoff] = [amounts.amount ?? 0, amounts.pickup ?? 0, amounts.dropoff ?? 0];
  const rule: PriceRule = {
    areaId: row.areaId,
    vehicleGroupId: row.vehicleGroupId,
    direction: null,
    packageHours: row.packageHours,
    pricing: itinerary ? { model: "charter_itinerary_surcharge", surchargeMinor: amount } : { model: "charter_area_surcharge", pickupSurchargeMinor: pickup, dropoffSurchargeMinor: dropoff },
    validFrom: from,
    validTo: to,
    status,
  };
  const input: PriceRuleInput = {
    area_id: row.areaId,
    vehicle_group_id: row.vehicleGroupId,
    direction: null,
    package_hours: row.packageHours,
    pricing_model: row.model,
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
    // ③行不带 waypoint_surcharge：迁移前的途经加价是只读旧数据，后端沿用原值
    ...(itinerary ? { itinerary_surcharge: amount } : { pickup_surcharge: pickup, dropoff_surcharge: dropoff }),
    valid_from: from,
    valid_to: to,
    status,
  };
  return { blank: false, rule, input, problems };
}

const COMPARED = ["area_id", "vehicle_group_id", "package_hours", "pickup_surcharge", "dropoff_surcharge", "itinerary_surcharge", "valid_from", "valid_to", "status"] as const;
const sameAsOrigin = (input: PriceRuleInput, origin: PriceRuleBody, model: LayerModel): boolean =>
  COMPARED.every((key) => (model === "charter_area_surcharge" && key === "itinerary_surcharge") || (model === "charter_itinerary_surcharge" && (key === "pickup_surcharge" || key === "dropoff_surcharge")) || (input[key] ?? null) === (origin[key] ?? null));

export type LayerChange = "none" | "blank" | "new" | "changed" | "deleted";

export function layerChange(row: LayerRow, reading: LayerReading): LayerChange {
  if (row.deleted) return row.id === null ? "blank" : "deleted";
  if (reading.blank) return "blank";
  if (row.origin === null) return "new";
  return reading.input !== null && sameAsOrigin(reading.input, row.origin, row.model) ? "none" : "changed";
}

/**
 * 页面上的一张加价表 → 批量保存的请求体（和价格表一起提交，同一事务）。
 * `blocked`：挡住的区域（商品的基础价区域上的③行）只提交删除，别的改动不提交——批量保存不再因为它们整批被拒（ADR 0093 第七节第 3 条）。
 */
export function buildLayerBatch(rows: readonly LayerRow[], currency: string, blocked: ReadonlySet<string>): PriceRuleBatch {
  const batch: PriceRuleBatch = { create: [], update: [], delete: [] };
  for (const row of rows) {
    const reading = readLayerRow(row, currency);
    const change = layerChange(row, reading);
    if (change === "deleted" && row.id !== null) batch.delete.push(row.id);
    else if (blocked.has(row.areaId)) continue;
    else if (change === "new" && reading.input) batch.create.push({ ...reading.input, ref: row.key });
    else if (change === "changed" && reading.input && row.id !== null) batch.update.push({ ...reading.input, id: row.id });
  }
  return batch;
}

export function layerChangeCount(rows: readonly LayerRow[], currency: string, blocked: ReadonlySet<string>): number {
  const batch = buildLayerBatch(rows, currency, blocked);
  return batch.create.length + batch.update.length + batch.delete.length;
}

/** 日期重叠：行的 key → 和它重叠的那些行的 key（同一区域 × 车型组 × 套餐）。挡住的区域不算（它们的改动不提交）。 */
export function layerOverlaps(rows: readonly LayerRow[], currency: string, blocked: ReadonlySet<string>): Map<string, string[]> {
  const live = rows.flatMap((row) => {
    if (row.deleted || blocked.has(row.areaId)) return [];
    const rule = readLayerRow(row, currency).rule;
    return rule ? [{ row, rule }] : [];
  });
  const result = new Map<string, string[]>();
  for (const [a, b] of findPriceRuleOverlaps(live.map((entry) => entry.rule))) {
    const [x, y] = [live[a]?.row.key, live[b]?.row.key];
    if (x === undefined || y === undefined) continue;
    result.set(x, [...(result.get(x) ?? []), y]);
    result.set(y, [...(result.get(y) ?? []), x]);
  }
  return result;
}

/** 这一格（区域 × 车型组）有没有启用、现在或以后生效的加价（含没保存的修改）。 */
export function cellFilled(rows: readonly LayerRow[], areaId: string, vehicleGroupId: string, currency: string, today: string): boolean {
  return rows.some((row) => {
    if (row.deleted || row.areaId !== areaId || row.vehicleGroupId !== vehicleGroupId) return false;
    const rule = readLayerRow(row, currency).rule;
    return rule !== null && rule.status === "enabled" && priceRuleIsActive(rule, today);
  });
}

/** 一张表里没填的格数（「N 格没填」）：列出来的区域（挡住的除外）× 商品的车型组。 */
export function missingCells(rows: readonly LayerRow[], areaIds: readonly string[], vehicleGroupIds: readonly string[], currency: string, today: string, blocked: ReadonlySet<string>): number {
  let count = 0;
  for (const areaId of areaIds) {
    if (blocked.has(areaId)) continue;
    for (const groupId of vehicleGroupIds) if (!cellFilled(rows, areaId, groupId, currency, today)) count += 1;
  }
  return count;
}

export type LayerRowState = "error" | "overlap" | "deleted" | "new" | "changed" | "blank" | "disabled" | "expired" | "upcoming" | "active";

/** 这一行现在怎么样（同价格表 3.7 的写法）。 */
export function layerState(row: LayerRow, reading: LayerReading, overlapping: boolean, today: string): { state: LayerRowState; text: string } {
  const change = layerChange(row, reading);
  if (change === "deleted") return { state: "deleted", text: "将删除" };
  if (reading.problems.length > 0) return { state: "error", text: reading.problems[0]?.text ?? "" };
  if (overlapping) return { state: "overlap", text: "和别的加价日期重叠" };
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

/** 保存被拒（`AREA_LAYER_OVERLAP` / `AREA_BASE_SURCHARGE_OVERLAP`）时 `details` 里的重叠：两个区域名、重叠面积（平方公里）、哪一层。 */
export interface LayerOverlapDetail {
  layer: string;
  areas: [string, string];
  areaIds: [string, string];
  km2: number;
}

export function layerOverlapDetails(details: Readonly<Record<string, unknown>>): LayerOverlapDetail[] {
  const one = (entry: unknown): LayerOverlapDetail | null => {
    if (typeof entry !== "object" || entry === null) return null;
    const value = entry as Record<string, unknown>;
    const areas = Array.isArray(value["areas"]) ? value["areas"].map(String) : [];
    const ids = Array.isArray(value["area_ids"]) ? value["area_ids"].map(String) : [];
    const km2 = typeof value["overlap_km2"] === "number" ? value["overlap_km2"] : null;
    if (areas.length < 2 || km2 === null) return null;
    return { layer: typeof value["layer"] === "string" ? value["layer"] : "", areas: [areas[0] ?? "", areas[1] ?? ""], areaIds: [ids[0] ?? "", ids[1] ?? ""], km2 };
  };
  const all = Array.isArray(details["overlaps"]) ? details["overlaps"].map(one).filter((entry): entry is LayerOverlapDetail => entry !== null) : [];
  if (all.length > 0) return all;
  const first = one(details);
  return first === null ? [] : [first];
}

/** 一条重叠的一句话：写出两个区域名和重叠面积。 */
export function layerOverlapSentence(entry: LayerOverlapDetail): string {
  const [a, b] = entry.areas;
  const area = `重叠约 ${entry.km2} 平方公里`;
  if (entry.layer === "base_pickup_dropoff") return `基础价区域「${a}」和上下车加价的区域「${b}」${area}：在基础价区域里上下车不加价，两者不能重叠。请先在区域页面切掉重叠的部分`;
  const where = entry.layer === "itinerary" ? "行程加价的区域" : entry.layer === "base" ? "基础价区域" : "上下车加价的区域";
  return `「${a}」和「${b}」${area}：同一个商品的${where}不能重叠（一个点只能有一个答案）。请先在区域页面切掉重叠的部分`;
}
