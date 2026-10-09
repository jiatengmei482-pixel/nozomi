/**
 * 价格规则和库存的 Excel 批量导入导出（M1-05；需求文档「价格批量导入导出」）。
 *
 * 流程：下载模版（或导出现有的）→ 在 Excel 里填 → 上传**预览**（只校验、不写入，返回逐行结果和新增 / 修改 / 冲突 / 出错的条数）
 * → 用户确认 → 再上传同一个文件**写入**（全部成功或全部失败）。
 * - 服务器不保存上传的文件。确认时带上预览返回的文件指纹（SHA-256）和商品的版本号（`If-Match`）：
 *   文件内容变了 → 409 IMPORT_FILE_CHANGED；商品被别人改过 → 409 VERSION_CONFLICT。确认时整份文件重新校验一遍。
 * - 写入用的是和页面保存同一段代码（价格：applyPriceChanges；库存：applyInventoryChanges），规则完全一样。
 * - 同步完成，不排队：价格一次最多 500 行（需求文档 batch-upsert 的上限），库存最多 366 行，文件最大 1 MB。
 * - 金额在表格里填主单位（日元整数、美元两位小数），按字符换成最小货币单位的整数，不经过浮点数；小数位超过币种精度的报到具体单元格。
 * - 表格里的数据都是供应商自己的结算价和库存，没有对外价和加价比例。
 */
import { createHash } from "node:crypto";
import {
  type CurrencyCode,
  INVENTORY_LIMITS,
  type LocalizedText,
  PRICE_DIRECTION_NAMES,
  PRICE_LIMITS,
  PRICING_MODEL_NAMES,
  type PriceDirection,
  type PriceRule,
  type PriceRuleStatus,
  type Pricing,
  type PricingModel,
  type ServiceCategory,
  addDays,
  formatMajor,
  inventoryDateIssue,
  inventoryOccupiedBlocking,
  inventoryTotalIssue,
  isLocalDate,
  minorDigits,
  plainDecimal,
  plainInteger,
  scaledInteger,
  storedNumberDecimal,
  pricingModelsFor,
  sheetDate,
} from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import type { Db } from "../db/context.ts";
import { AppError } from "../errors.ts";
import { type XlsxCell, XlsxError, type XlsxSheet, type XlsxWriteCell, cellReference, readXlsxSheet, writeXlsx } from "../integrations/xlsx.ts";
import { listInventoryDays } from "../repos/inventory.ts";
import { type StoredPriceRule, findVehicleGroupLabels } from "../repos/prices.ts";
import { findAreasForProduct } from "../repos/products.ts";
import { validationFailed } from "../validation.ts";
import { versionConflict } from "./errors.ts";
import { runIdempotent } from "./idempotency.ts";
import { INVENTORY_ISSUE_MESSAGES, type InventoryChange, type InventoryContext, applyInventoryChanges, loadInventoryContext } from "./inventory.ts";
import { type PriceChanges, type PriceRulesView, type PricingContext, applyPriceChanges, checkPriceChanges, loadPricingContext, samePriceRule } from "./prices.ts";
import { type ProductWriter, readTx, writeTx } from "./products.ts";

export const IMPORT_LIMITS = { maxPriceRows: PRICE_LIMITS.maxBatchChanges, maxInventoryRows: INVENTORY_LIMITS.maxRangeDays } as const;

export type ImportFileReason = "NOT_XLSX" | "CORRUPT" | "TOO_LARGE" | "UNSAFE" | "EMPTY" | "MISSING_COLUMNS" | "TOO_MANY_ROWS";

/** 文件本身读不了（不是 xlsx、损坏、太大、缺列、行太多）：400 IMPORT_FILE_INVALID，`details.reason` 说明是哪一种。 */
function fileInvalid(reason: ImportFileReason, message: string, extra: Record<string, unknown> = {}): AppError {
  return new AppError(400, "IMPORT_FILE_INVALID", message, { reason, ...extra });
}

/** 读上传的表：有叫 `sheetName` 的工作表就读它（用户可能把「填写说明」挪到了前面），没有就读第一张。 */
function sheetRows(bytes: Uint8Array, sheetName: string): XlsxSheet {
  try {
    return readXlsxSheet(bytes, [sheetName]);
  } catch (err) {
    if (err instanceof XlsxError) throw fileInvalid(err.code, `这个文件读不了：${err.message}。请用下载的模版填写后另存为 .xlsx 再上传`);
    throw err;
  }
}

export function fileFingerprint(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** 一个单元格的问题：`cell` 是 Excel 里的位置（如 `G5`），`column` 是那一列的表头。 */
export interface CellIssue {
  cell: string;
  column: string;
  reason: string;
  message: string;
}

/** 表头在第几列、每一行按表头取值。 */
class Sheet {
  readonly rows: XlsxCell[][];
  private readonly columns = new Map<string, number>();

  /** 这个文件的日期序号是不是 1904 纪元 */
  readonly date1904: boolean;

  constructor(source: XlsxSheet, required: readonly string[]) {
    const rows = source.rows;
    this.rows = rows;
    this.date1904 = source.date1904;
    const header = rows[0] ?? [];
    if (rows.length === 0 || header.every((cell) => cell.type === "empty")) throw fileInvalid("EMPTY", "文件是空的：第一行应当是表头。请用下载的模版填写");
    for (const [index, cell] of header.entries()) if (cell.type === "text" && !this.columns.has(cell.text.trim())) this.columns.set(cell.text.trim(), index);
    const missing = required.filter((name) => !this.columns.has(name));
    if (missing.length > 0) throw fileInvalid("MISSING_COLUMNS", `表头里缺少这些列：${missing.join("、")}。请用下载的模版填写，不要改第一行`, { columns: missing });
  }

  has(column: string): boolean {
    return this.columns.has(column);
  }

  /** 有内容的数据行在表里的下标（跳过表头和整行都空的行）。 */
  dataRows(): number[] {
    return this.rows.flatMap((cells, index) => (index > 0 && cells.some((cell) => cell.type !== "empty") ? [index] : []));
  }

  cell(row: number, column: string): { at: string; value: XlsxCell } {
    const index = this.columns.get(column);
    if (index === undefined) return { at: "", value: { type: "empty" } };
    return { at: cellReference(row, index), value: this.rows[row]?.[index] ?? { type: "empty" } };
  }
}

/**
 * 一行里读单元格的小工具：读到的问题记进 `issues`。
 * 单元格的类型决定怎么读（xlsx.ts 给出的类型）：
 * - 要文字的列：文字原样；数字取原文；逻辑值、错误值给它在表里显示的字（`TRUE`、`#N/A`），不会变成 `1`；
 * - 要数字 / 日期的列：存成数字的按 `storedNumberDecimal`（Excel 把 19.99 存成 19.989999999999998，要读回 19.99），
 *   存成文字的按用户敲的字符（`plainDecimal`）；逻辑值、错误值一律报「不是数字」到那个单元格；
 * - 公式不取值，报到单元格。
 */
function rowReader(sheet: Sheet, row: number, issues: CellIssue[]) {
  const problem = (column: string, reason: string, message: string): null => {
    issues.push({ cell: sheet.cell(row, column).at, column, reason, message });
    return null;
  };
  const FORMULA_MESSAGE = "这一格是公式。请把它改成数值（复制后「选择性粘贴 → 值」）";
  /** 单元格里的原文；空的返回 null；带公式的报错 */
  const text = (column: string): string | null => {
    const { value } = sheet.cell(row, column);
    if (value.type === "empty") return null;
    if (value.type === "formula") return problem(column, "FORMULA", FORMULA_MESSAGE);
    const trimmed = value.text.trim();
    return trimmed === "" ? null : trimmed;
  };
  const missing = (column: string, required: boolean): null => (required && !issues.some((issue) => issue.column === column) ? problem(column, "REQUIRED", "必填") : null);
  const required = (column: string): string | null => text(column) ?? missing(column, true);
  /**
   * 这一格里的数，写成普通的十进制字符串；空的返回 null（必填的记一条）。
   * `reason` 是「不是数字」时用的原因代码：金额、里程列是 `NOT_A_NUMBER`，要整数的列是 `NOT_INTEGER`，日期列是 `INVALID_DATE`。
   */
  const decimal = (column: string, options: { required: boolean; reason: string; hint: string }): string | null => {
    const { value } = sheet.cell(row, column);
    if (value.type === "empty" || ((value.type === "text" || value.type === "number") && value.text.trim() === "")) return missing(column, options.required);
    if (value.type === "formula") return problem(column, "FORMULA", FORMULA_MESSAGE);
    if (value.type === "boolean") return problem(column, options.reason, `这一格是逻辑值 ${value.text}，不是数字。${options.hint}`);
    if (value.type === "error") return problem(column, options.reason, `这一格是错误值 ${value.text}，不是数字。${options.hint}`);
    const plain = value.type === "number" ? storedNumberDecimal(value.text) : plainDecimal(value.text);
    return plain ?? problem(column, options.reason, options.hint);
  };
  const integer = (column: string, isRequired: boolean): number | null => {
    const plain = decimal(column, { required: isRequired, reason: "NOT_INTEGER", hint: "必须是整数" });
    if (plain === null) return null;
    return plainInteger(plain) ?? problem(column, "NOT_INTEGER", "必须是整数");
  };
  const DATE_HINT = "不是合法的日期，请写成 2026-10-01 这样（不要带时间）";
  const date = (column: string, isRequired: boolean): string | null => {
    const { value } = sheet.cell(row, column);
    // 存成文字的日期按写法认；存成数字的是 Excel 的日期序号
    const raw = value.type === "text" ? (value.text.trim() === "" ? missing(column, isRequired) : value.text) : decimal(column, { required: isRequired, reason: "INVALID_DATE", hint: DATE_HINT });
    if (raw === null) return null;
    return sheetDate(raw, { date1904: sheet.date1904 }) ?? problem(column, "INVALID_DATE", DATE_HINT);
  };
  return { problem, text, required, decimal, integer, date };
}

// ---- 价格规则 ----

const P = {
  id: "价格编号",
  area: "区域",
  group: "车型组",
  direction: "方向",
  packageHours: "套餐时长(小时)",
  model: "计价方式",
  basePrice: "基础价",
  startPrice: "起步价",
  startKm: "起步里程(公里)",
  startMinutes: "起步时长(分钟)",
  perKm: "每公里单价",
  perMinute: "每分钟单价",
  minPrice: "最低消费",
  packageKm: "套餐公里",
  packagePrice: "套餐价",
  overtime: "超时单价(每小时)",
  overKm: "超公里单价(每公里)",
  validFrom: "生效开始",
  validTo: "生效结束",
  status: "状态",
} as const;

/** 各种计价方式自己的那几列（一种方式用不到的要留空） */
const MODEL_COLUMNS: readonly string[] = [P.basePrice, P.startPrice, P.startKm, P.startMinutes, P.perKm, P.perMinute, P.minPrice];

const PRICE_SHEET = "价格";

const STATUS_NAMES: Readonly<Record<PriceRuleStatus, string>> = { enabled: "启用", disabled: "停用" };

/** 这个品类的价格表有哪些列（顺序即模版里的顺序）。 */
function priceColumns(category: ServiceCategory): string[] {
  const middle =
    category === "charter"
      ? [P.packageHours, P.packageKm, P.packagePrice, P.overtime, P.overKm]
      : [...(category === "airport_transfer" ? [P.direction] : []), P.model, P.basePrice, P.startPrice, P.startKm, P.startMinutes, P.perKm, P.perMinute, P.minPrice];
  return [P.id, P.area, P.group, ...middle, P.validFrom, P.validTo, P.status];
}

/** 接口里的字段名 → 表头（把保存时的报错指回单元格用）。 */
const FIELD_COLUMNS: Readonly<Record<string, string>> = {
  id: P.id,
  area_id: P.area,
  vehicle_group_id: P.group,
  direction: P.direction,
  package_hours: P.packageHours,
  pricing_model: P.model,
  base_price: P.basePrice,
  start_price: P.startPrice,
  start_meters: P.startKm,
  start_minutes: P.startMinutes,
  per_km: P.perKm,
  per_minute: P.perMinute,
  min_price: P.minPrice,
  package_km: P.packageKm,
  package_price: P.packagePrice,
  overtime_per_hour: P.overtime,
  over_km_per_km: P.overKm,
  valid_from: P.validFrom,
  valid_to: P.validTo,
  status: P.status,
};

/** 保存时的检查报出来的问题，换成对着表格说的话（告诉供应商这一格怎么改）。 */
const SAVE_MESSAGES: Readonly<Record<string, string>> = {
  NOT_INTEGER: "这一格只能填整数，请去掉小数",
  DATE_RANGE_REVERSED: "「生效结束」不能早于「生效开始」，请改其中一个",
  INVALID_DATE: "不是合法的日期，请写成 2026-10-01 这样",
  REQUIRED: "这一格必填",
  NOT_APPLICABLE: "这个商品的品类不填这一列，请留空",
  MODEL_NOT_ALLOWED: "这个商品的品类不能用这种计价方式，请按「填写说明」里列出的填",
};

/** 金额的上限写成这个币种的主单位（上限是 10 亿最小货币单位：日元 1,000,000,000，美元 10,000,000.00）。 */
const amountLimitText = (currency: CurrencyCode): string => formatMajor(PRICE_LIMITS.maxAmountMinor, currency).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const amountRangeMessage = (currency: CurrencyCode): string => `金额不能是负数，最多 ${amountLimitText(currency)} ${currency}。请检查是不是多打了位数`;

/** 保存时的检查说「超出范围」：按是哪一列说清楚确切的范围。 */
function outOfRangeMessage(column: string, currency: CurrencyCode): string {
  if (column === P.packageHours) return `套餐时长要在 1 到 ${PRICE_LIMITS.maxPackageHours} 小时之间`;
  if (column === P.packageKm) return `套餐公里要在 1 到 ${PRICE_LIMITS.maxPackageKm} 之间`;
  if (column === P.startKm) return `起步里程要在 0 到 ${PRICE_LIMITS.maxStartMeters / 1_000} 公里之间，最多 1 位小数`;
  if (column === P.startMinutes) return `起步时长要在 0 到 ${PRICE_LIMITS.maxStartMinutes} 分钟之间`;
  const zeroAllowed = column === P.perKm || column === P.perMinute || column === P.overtime || column === P.overKm || column === P.startPrice;
  return `金额要${zeroAllowed ? "不小于 0" : "大于 0"}，最多 ${amountLimitText(currency)} ${currency}。请检查是不是多打或少打了位数`;
}

const nameKey = (text: string): string => text.normalize("NFKC").trim().toLowerCase();
const displayName = (name: LocalizedText): string => name.zh ?? name.ja ?? name.en ?? name.ko ?? "";

interface PriceNames {
  /** 商品现在选的区域和车型组，外加现有价格用到的（已经被商品去掉的） */
  areas: Map<string, LocalizedText>;
  groups: Map<string, { code: string; name: LocalizedText }>;
}

async function priceNames(db: Db, tenantId: string, context: PricingContext): Promise<PriceNames> {
  const areaIds = [...new Set([...context.areaIds, ...context.priceRules.map((rule) => rule.areaId)])];
  const groupIds = [...new Set([...context.vehicleGroupIds, ...context.priceRules.map((rule) => rule.vehicleGroupId)])];
  const areas = await findAreasForProduct(db, tenantId, areaIds);
  return { areas: new Map([...areas].map(([id, area]) => [id, area.name])), groups: await findVehicleGroupLabels(db, groupIds) };
}

const money = (minor: number | null, currency: CurrencyCode): XlsxWriteCell => (minor === null ? null : { number: formatMajor(minor, currency) });
const whole = (value: number | null): XlsxWriteCell => (value === null ? null : { number: String(value) });

function priceRow(rule: StoredPriceRule, names: PriceNames, currency: CurrencyCode, columns: readonly string[]): XlsxWriteCell[] {
  const pricing = rule.pricing;
  const km = (meters: number): XlsxWriteCell => ({ number: meters % 1_000 === 0 ? String(meters / 1_000) : `${Math.floor(meters / 1_000)}.${String(meters % 1_000).padStart(3, "0").replace(/0+$/, "")}` });
  const values: Record<string, XlsxWriteCell> = {
    [P.id]: rule.id,
    [P.area]: displayName(names.areas.get(rule.areaId) ?? {}),
    [P.group]: names.groups.get(rule.vehicleGroupId)?.code ?? "",
    [P.direction]: rule.direction === null ? null : PRICE_DIRECTION_NAMES[rule.direction],
    [P.packageHours]: whole(rule.packageHours),
    [P.model]: PRICING_MODEL_NAMES[pricing.model],
    [P.validFrom]: rule.validFrom,
    [P.validTo]: rule.validTo,
    [P.status]: STATUS_NAMES[rule.status],
  };
  if (pricing.model === "fixed") values[P.basePrice] = money(pricing.basePriceMinor, currency);
  else if (pricing.model === "mileage_time") {
    Object.assign(values, {
      [P.startPrice]: money(pricing.startPriceMinor, currency),
      [P.startKm]: km(pricing.startMeters),
      [P.startMinutes]: whole(pricing.startMinutes),
      [P.perKm]: money(pricing.perKmMinor, currency),
      [P.perMinute]: money(pricing.perMinuteMinor, currency),
      [P.minPrice]: money(pricing.minPriceMinor, currency),
    });
  } else {
    Object.assign(values, { [P.packageKm]: whole(pricing.packageKm), [P.packagePrice]: money(pricing.packagePriceMinor, currency), [P.overtime]: money(pricing.overtimePerHourMinor, currency), [P.overKm]: money(pricing.overKmPerKmMinor, currency) });
  }
  return columns.map((column) => values[column] ?? null);
}

export interface ExportedFile {
  fileName: string;
  content: Buffer;
}

/**
 * 导出价格表（.xlsx）。`withRows` 为假时只有表头——就是空白模版（不预置任何价格）。
 * 第二张表「填写说明」列出这个商品可以填的区域、车型组、方向、计价方式和各列怎么填。
 */
export function exportPriceRules(ctx: AppContext, tenantId: string, productId: string, withRows: boolean): Promise<ExportedFile> {
  const now = ctx.now();
  return readTx(ctx, tenantId, async (db) => {
    const context = await loadPricingContext(db, tenantId, productId, now, { lock: false });
    const names = await priceNames(db, tenantId, context);
    const { category, code } = context.product;
    const currency = context.currency ?? "JPY";
    const columns = priceColumns(category);
    const rows: XlsxWriteCell[][] = [columns, ...(withRows ? context.priceRules.map((rule) => priceRow(rule, names, currency, columns)) : [])];
    const digits = minorDigits(currency);
    const help: XlsxWriteCell[][] = [
      ["填写说明"],
      [`商品 ${code}；金额的币种是 ${currency}，${digits === 0 ? "只能填整数" : `最多 ${digits} 位小数`}。这些都是你的结算价。`],
      ["第一行是表头，不要改。每一行是一条价格；一次最多 500 行。"],
      [`「${P.id}」：导出的行带着它，留着 = 修改这一条；新增的行留空。这里不能删除价格（请在页面上删）。`],
      [`「${P.area}」填区域的名称，「${P.group}」填车型组的编码，只能用下面列出的。`],
      ["日期写成 2026-10-01；「生效结束」留空 = 一直有效。两头的日期都算在内，同一个组合的日期不能重叠。"],
      [`「${P.status}」填 启用 或 停用，留空 = 启用。`],
      ...(category === "charter"
        ? [[`包车：每一行要填「${P.packageHours}」「${P.packageKm}」「${P.packagePrice}」「${P.overtime}」「${P.overKm}」。`]]
        : [
            [`「${P.model}」填 ${pricingModelsFor(category).map((model) => PRICING_MODEL_NAMES[model]).join(" 或 ")}。`],
            [`${PRICING_MODEL_NAMES.fixed}：只填「${P.basePrice}」。${PRICING_MODEL_NAMES.mileage_time}：填「${P.startPrice}」「${P.startKm}」「${P.startMinutes}」「${P.perKm}」「${P.perMinute}」，「${P.minPrice}」可以不填。用不到的列留空。`],
          ]),
      ...(category === "airport_transfer" ? [[`「${P.direction}」填 ${Object.values(PRICE_DIRECTION_NAMES).join("、")}。`]] : []),
      [],
      ["可以填的区域"],
      ...context.areaIds.map((id): XlsxWriteCell[] => [displayName(names.areas.get(id) ?? {})]),
      [],
      ["可以填的车型组（编码）", "名称"],
      ...context.vehicleGroupIds.map((id): XlsxWriteCell[] => [names.groups.get(id)?.code ?? "", displayName(names.groups.get(id)?.name ?? {})]),
    ];
    return {
      fileName: `${code}-prices${withRows ? "" : "-template"}.xlsx`,
      content: writeXlsx([
        { name: PRICE_SHEET, rows, header: true, columnWidths: columns.map((column) => (column === P.id ? 38 : column === P.area ? 24 : 16)) },
        { name: "填写说明", rows: help, columnWidths: [60, 30] },
      ]),
    };
  });
}

export type ImportRowAction = "create" | "update" | "unchanged" | "error" | "conflict";

/** 一条价格是哪个组合：给人看的文字（区域的名称、车型组的编码）。 */
export interface PriceComboText {
  area: string | null;
  vehicleGroup: string | null;
  direction: PriceDirection | null;
  packageHours: number | null;
}

/** 这一行读到的内容（确认前让人核对）：读不出来的项是 null。 */
export interface PriceRowContent extends PriceComboText {
  pricingModel: PricingModel | null;
  /** 主价格（最小货币单位）：一口价的基础价、里程 + 时长的起步价、包车的套餐价 */
  mainPriceMinor: number | null;
  validFrom: string | null;
  validTo: string | null;
  status: PriceRuleStatus;
}

export interface PriceImportRow {
  /** Excel 里的行号（表头是第 1 行） */
  row: number;
  action: ImportRowAction;
  priceRuleId: string | null;
  content: PriceRowContent;
  issues: CellIssue[];
  /**
   * 和它日期重叠的：同一个文件里的行（`row`），或已经在库里、这次没动的价格（`id`——一定是这个商品的）。
   * 都带着组合的文字和日期，页面不用再去找。
   */
  conflictsWith: (PriceComboText & { row: number | null; id: string | null; validFrom: string; validTo: string | null })[];
}

export interface ImportSummary {
  rows: number;
  create: number;
  update: number;
  unchanged: number;
  error: number;
  conflict: number;
}

export interface PriceImportPreview {
  version: number;
  fileSha256: string;
  currency: CurrencyCode | null;
  summary: ImportSummary;
  /** 没有出错、没有冲突，而且至少有一行要新增或修改 */
  canImport: boolean;
  rows: PriceImportRow[];
}

function summarize(rows: readonly { action: string }[]): ImportSummary {
  const count = (action: string): number => rows.filter((row) => row.action === action).length;
  return { rows: rows.length, create: count("create"), update: count("update"), unchanged: count("unchanged"), error: count("error"), conflict: count("conflict") };
}

const DIRECTION_WORDS: Readonly<Record<string, PriceDirection>> = { 接机: "pickup", 接站: "pickup", pickup: "pickup", 送机: "dropoff", 送站: "dropoff", dropoff: "dropoff", 接送通用: "both", 通用: "both", both: "both" };
const MODEL_WORDS: Readonly<Record<string, PricingModel>> = { 固定一口价: "fixed", 一口价: "fixed", fixed: "fixed", "里程+时长": "mileage_time", "里程 + 时长": "mileage_time", mileage_time: "mileage_time", 包车套餐: "charter_package", charter_package: "charter_package" };
const STATUS_WORDS: Readonly<Record<string, PriceRuleStatus>> = { 启用: "enabled", enabled: "enabled", 停用: "disabled", disabled: "disabled" };

/** 读价格表：每一行换成一条价格，再用和保存相同的检查过一遍。只读不写。 */
function readPriceSheet(bytes: Uint8Array, context: PricingContext, names: PriceNames): { rows: PriceImportRow[]; changes: PriceChanges } {
  const { category } = context.product;
  const currency = context.currency ?? "JPY";
  const columns = priceColumns(category);
  const sheet = new Sheet(sheetRows(bytes, PRICE_SHEET), columns.filter((column) => column !== P.id && column !== P.validTo && column !== P.status && column !== P.minPrice));
  const dataRows = sheet.dataRows();
  if (dataRows.length > IMPORT_LIMITS.maxPriceRows) throw fileInvalid("TOO_MANY_ROWS", `一次最多导入 ${IMPORT_LIMITS.maxPriceRows} 行，这个文件有 ${dataRows.length} 行。请分几次导入`, { max: IMPORT_LIMITS.maxPriceRows, rows: dataRows.length });

  const stored = new Map(context.priceRules.map((rule) => [rule.id, rule]));
  const areaByName = new Map<string, string[]>();
  const groupByCode = new Map<string, string>();
  const productAreas = new Set(context.areaIds);
  const productGroups = new Set(context.vehicleGroupIds);
  for (const [id, name] of names.areas) for (const text of new Set(Object.values(name).map(nameKey))) areaByName.set(text, [...(areaByName.get(text) ?? []), id]);
  for (const [id, group] of names.groups) groupByCode.set(nameKey(group.code), id);

  const rows: PriceImportRow[] = [];
  const changes: PriceChanges = { create: [], update: [], remove: [] };
  /** changes 里的每一条来自表里的哪一行 */
  const origin = { create: [] as PriceImportRow[], update: [] as PriceImportRow[] };
  const seenIds = new Set<string>();
  for (const index of dataRows) {
    const issues: CellIssue[] = [];
    const read = rowReader(sheet, index, issues);
    const content: PriceRowContent = { area: null, vehicleGroup: null, direction: null, packageHours: null, pricingModel: null, mainPriceMinor: null, validFrom: null, validTo: null, status: "enabled" };
    const result: PriceImportRow = { row: index + 1, action: "error", priceRuleId: null, content, issues, conflictsWith: [] };
    rows.push(result);

    const idText = read.text(P.id);
    const before = idText === null ? null : (stored.get(idText.toLowerCase()) ?? null);
    if (idText !== null && before === null) read.problem(P.id, "UNKNOWN_PRICE_RULE", "这个编号不是这个商品的价格。新增的行请把这一格留空");
    else if (before !== null && seenIds.has(before.id)) read.problem(P.id, "DUPLICATE", "同一个价格编号在文件里出现了两次");
    if (before !== null) {
      seenIds.add(before.id);
      result.priceRuleId = before.id;
    }

    // 区域按名称认（任何一种语言的名称），车型组按编码认；修改的行可以沿用它原来的区域 / 车型组（即使商品已经去掉了）
    const areaText = read.required(P.area);
    let areaId: string | null = null;
    if (areaText !== null) {
      const candidates = (areaByName.get(nameKey(areaText)) ?? []).filter((id) => productAreas.has(id) || id === before?.areaId);
      if (candidates.length === 1) areaId = candidates[0] as string;
      else read.problem(P.area, candidates.length === 0 ? "AREA_NOT_IN_PRODUCT" : "AMBIGUOUS", candidates.length === 0 ? "这个商品没有选叫这个名字的区域（见「填写说明」里列出的）" : "有不止一个区域叫这个名字，请先在区域页面把名字改得不一样");
    }
    const groupText = read.required(P.group);
    let groupId: string | null = null;
    if (groupText !== null) {
      const found = groupByCode.get(nameKey(groupText));
      if (found !== undefined && (productGroups.has(found) || found === before?.vehicleGroupId)) groupId = found;
      else read.problem(P.group, "VEHICLE_GROUP_NOT_IN_PRODUCT", "这个商品没有选这个编码的车型组（见「填写说明」里列出的）");
    }

    const word = <T>(column: string, words: Readonly<Record<string, T>>, options: string[]): T | null => {
      const raw = read.text(column);
      if (raw === null) return null;
      const value = words[nameKey(raw)] ?? words[raw.replace(/\s+/g, "")];
      return value ?? read.problem(column, "UNKNOWN_VALUE", `只能填：${options.join("、")}`);
    };
    // 金额：表里填主单位，按字符换成最小货币单位（domain 的 scaledInteger：符号、小数位、范围都在那里统一处理）
    const amount = (column: string, optional = false): number | null => {
      const plain = read.decimal(column, { required: !optional, reason: "NOT_A_NUMBER", hint: "必须是数字（只填数字，不带币种符号）" });
      if (plain === null) return null;
      const scaled = scaledInteger(plain, minorDigits(currency), { min: 0, max: PRICE_LIMITS.maxAmountMinor });
      if ("value" in scaled) return scaled.value;
      if (scaled.issue === "PRECISION") return read.problem(column, "PRECISION", minorDigits(currency) === 0 ? `${currency} 的金额只能是整数` : `${currency} 的金额最多 ${minorDigits(currency)} 位小数`);
      return read.problem(column, "OUT_OF_RANGE", amountRangeMessage(currency));
    };
    const blank = (allowed: readonly string[]): void => {
      for (const column of MODEL_COLUMNS) {
        if (allowed.includes(column)) continue;
        if (read.text(column) !== null) read.problem(column, "NOT_APPLICABLE", "这种计价方式不填这一列，请留空");
      }
    };

    const direction = category === "airport_transfer" ? word(P.direction, DIRECTION_WORDS, Object.values(PRICE_DIRECTION_NAMES)) : null;
    if (category === "airport_transfer" && direction === null && !issues.some((issue) => issue.column === P.direction)) read.problem(P.direction, "REQUIRED", "必填");
    let pricing: Pricing | null = null;
    let packageHours: number | null = null;
    // 这一行读到了什么（哪怕别的格出了错）：区域、车型组认出来了就写规范的名称和编码，没认出来就写表里填的原文
    content.area = areaId === null ? areaText : displayName(names.areas.get(areaId) ?? {});
    content.vehicleGroup = groupId === null ? groupText : (names.groups.get(groupId)?.code ?? groupText);
    content.direction = direction;
    if (category === "charter") {
      packageHours = read.integer(P.packageHours, true);
      const packageKm = read.integer(P.packageKm, true);
      const [packagePrice, overtime, overKm] = [amount(P.packagePrice), amount(P.overtime), amount(P.overKm)];
      Object.assign(content, { packageHours, pricingModel: "charter_package", mainPriceMinor: packagePrice });
      if (packageKm !== null && packagePrice !== null && overtime !== null && overKm !== null) pricing = { model: "charter_package", packageKm, packagePriceMinor: packagePrice, overtimePerHourMinor: overtime, overKmPerKmMinor: overKm };
    } else {
      const model = word(P.model, MODEL_WORDS, pricingModelsFor(category).map((entry) => PRICING_MODEL_NAMES[entry]));
      if (model === null && !issues.some((issue) => issue.column === P.model)) read.problem(P.model, "REQUIRED", "必填");
      content.pricingModel = model;
      if (model === "fixed") {
        blank([P.basePrice]);
        const base = amount(P.basePrice);
        content.mainPriceMinor = base;
        if (base !== null) pricing = { model: "fixed", basePriceMinor: base };
      } else if (model === "mileage_time") {
        blank([P.startPrice, P.startKm, P.startMinutes, P.perKm, P.perMinute, P.minPrice]);
        const [startPrice, perKm, perMinute, minPrice] = [amount(P.startPrice), amount(P.perKm), amount(P.perMinute), amount(P.minPrice, true)];
        content.mainPriceMinor = startPrice;
        const startMinutes = read.integer(P.startMinutes, true);
        // 起步里程填公里（最多 1 位小数），按字符换成百米再乘 100 得到米——和金额用同一个换算函数，负数、太大的数在这里就报到这一格
        const kmPlain = read.decimal(P.startKm, { required: true, reason: "NOT_A_NUMBER", hint: "必须是数字" });
        let startMeters: number | null = null;
        if (kmPlain !== null) {
          const maxKm = PRICE_LIMITS.maxStartMeters / 1_000;
          const scaled = scaledInteger(kmPlain, 1, { min: 0, max: PRICE_LIMITS.maxStartMeters / PRICE_LIMITS.startMetersStep });
          if ("value" in scaled) startMeters = scaled.value * PRICE_LIMITS.startMetersStep;
          else if (scaled.issue === "PRECISION") read.problem(P.startKm, "PRECISION", "起步里程最多 1 位小数（精确到 0.1 公里）");
          else read.problem(P.startKm, "OUT_OF_RANGE", `起步里程要在 0 到 ${maxKm} 公里之间`);
        }
        if (startPrice !== null && perKm !== null && perMinute !== null && startMinutes !== null && startMeters !== null && !issues.some((issue) => issue.column === P.minPrice)) {
          pricing = { model: "mileage_time", startPriceMinor: startPrice, startMeters, startMinutes, perKmMinor: perKm, perMinuteMinor: perMinute, minPriceMinor: minPrice };
        }
      } else if (model === "charter_package") read.problem(P.model, "MODEL_NOT_ALLOWED", "这个品类不能用包车套餐");
    }
    const validFrom = read.date(P.validFrom, true);
    const validTo = read.date(P.validTo, false);
    const status = word(P.status, STATUS_WORDS, Object.values(STATUS_NAMES)) ?? "enabled";
    Object.assign(content, { validFrom, validTo, status });

    if (issues.length > 0 || areaId === null || groupId === null || pricing === null || validFrom === null) continue;
    const rule: PriceRule = { areaId, vehicleGroupId: groupId, direction, packageHours, pricing, validFrom, validTo, status };
    if (before !== null) {
      if (samePriceRule(rule, before)) result.action = "unchanged";
      else {
        result.action = "update";
        changes.update.push({ id: before.id, rule });
        origin.update.push(result);
      }
    } else {
      result.action = "create";
      changes.create.push({ ref: `row:${result.row}`, rule });
      origin.create.push(result);
    }
  }

  // 和页面保存同一套检查：字段的范围、日期、重叠
  const check = checkPriceChanges(context, changes, false);
  for (const issue of check.issues) {
    const match = /^\/(create|update)\/(\d+)\/(.+)$/.exec(issue.path);
    const target = match ? origin[match[1] as "create" | "update"][Number(match[2])] : undefined;
    if (!match || !target) throw fileInvalid("TOO_MANY_ROWS", issue.message);
    const column = FIELD_COLUMNS[(match[3] as string).split("/")[0] as string] ?? P.id;
    target.action = "error";
    const message = issue.reason === "OUT_OF_RANGE" ? outOfRangeMessage(column, currency) : (SAVE_MESSAGES[issue.reason ?? ""] ?? issue.message);
    target.issues.push({ cell: sheet.cell(target.row - 1, column).at, column, reason: issue.reason ?? "INVALID", message });
  }
  const rowOf = new Map<string, PriceImportRow>([...origin.update.map((row): [string, PriceImportRow] => [`id:${row.priceRuleId}`, row]), ...origin.create.map((row): [string, PriceImportRow] => [`ref:row:${row.row}`, row])]);
  for (const conflict of check.conflicts) {
    const target = rowOf.get(conflict.id !== undefined ? `id:${conflict.id}` : `ref:${conflict.ref}`);
    if (!target) continue;
    target.action = "conflict";
    target.conflictsWith = conflict.with.map((other) => {
      const otherRow = rowOf.get(other.id !== undefined ? `id:${other.id}` : `ref:${other.ref}`);
      // 不是文件里的行，就是这个商品已有的、这次没动的价格（stored 里只有这个商品的）
      const existing = otherRow || other.id === undefined ? undefined : stored.get(other.id);
      const combo: PriceComboText = otherRow
        ? { area: otherRow.content.area, vehicleGroup: otherRow.content.vehicleGroup, direction: otherRow.content.direction, packageHours: otherRow.content.packageHours }
        : { area: existing ? displayName(names.areas.get(existing.areaId) ?? {}) : null, vehicleGroup: existing ? (names.groups.get(existing.vehicleGroupId)?.code ?? null) : null, direction: existing?.direction ?? null, packageHours: existing?.packageHours ?? null };
      return { ...combo, row: otherRow?.row ?? null, id: otherRow ? null : (other.id ?? null), validFrom: other.valid_from, validTo: other.valid_to };
    });
  }
  return { rows, changes };
}

function pricePreview(bytes: Uint8Array, context: PricingContext, names: PriceNames): { preview: PriceImportPreview; changes: PriceChanges } {
  const { rows, changes } = readPriceSheet(bytes, context, names);
  const summary = summarize(rows);
  return { preview: { version: context.product.version, fileSha256: fileFingerprint(bytes), currency: context.currency, summary, canImport: summary.error === 0 && summary.conflict === 0 && summary.create + summary.update > 0, rows }, changes };
}

/** 预览：只校验不写入。 */
export function previewPriceImport(ctx: AppContext, tenantId: string, productId: string, bytes: Uint8Array): Promise<PriceImportPreview> {
  const now = ctx.now();
  return readTx(ctx, tenantId, async (db) => {
    const context = await loadPricingContext(db, tenantId, productId, now, { lock: false });
    return pricePreview(bytes, context, await priceNames(db, tenantId, context)).preview;
  });
}

function fileChanged(): AppError {
  return new AppError(409, "IMPORT_FILE_CHANGED", "这次上传的文件和预览时的不是同一份（内容变了）。请重新上传预览，确认结果后再导入");
}

/** 确认导入被拒：`details.preview` 是这次重新校验的完整结果（和预览接口的应答同一个结构），页面直接显示，不用再传一次去预览。 */
function notClean(summary: { error: number; conflict: number }, preview: Record<string, unknown>): AppError {
  return new AppError(409, "IMPORT_NOT_CLEAN", summary.error + summary.conflict > 0 ? `文件里有 ${summary.error} 行出错、${summary.conflict} 行冲突，没有导入。请看下面每一行的说明，改好后重新上传` : "文件里没有要新增或修改的内容，不用导入", { summary, preview });
}

/**
 * 确认导入：文件指纹要和预览时的一样，商品的版本号没变；整份文件重新校验，全部通过才写入（全部成功或全部失败）。
 * 带幂等键：同一个键、同一份文件、同一个版本号再来一次，原样返回第一次的结果。
 */
export function importPriceRules(
  ctx: AppContext,
  writer: ProductWriter,
  productId: string,
  expectedVersion: number,
  bytes: Uint8Array,
  previewSha256: string,
  idempotency: { scope: string; key: string },
  respond: (result: { view: PriceRulesView; summary: ImportSummary }) => Record<string, unknown>,
  previewJson: (preview: PriceImportPreview) => Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const now = ctx.now();
  const tenantId = writer.principal.tenantId;
  const fileSha256 = fileFingerprint(bytes);
  if (fileSha256 !== previewSha256.toLowerCase()) throw fileChanged();
  return writeTx(ctx, tenantId, async (db) => {
    const result = await runIdempotent(db, { tenantId, scope: idempotency.scope, key: idempotency.key, request: { productId, expectedVersion, fileSha256 }, now }, async () => {
      const context = await loadPricingContext(db, tenantId, productId, now, { lock: true });
      if (context.product.version !== expectedVersion) throw versionConflict(context.product.version);
      const { preview, changes } = pricePreview(bytes, context, await priceNames(db, tenantId, context));
      if (!preview.canImport) throw notClean(preview.summary, previewJson(preview));
      const saved = await applyPriceChanges(db, writer, context, changes, false, now);
      return { status: 200, body: respond({ view: saved.view, summary: preview.summary }) };
    });
    return { status: result.status, body: result.body };
  });
}

// ---- 库存 ----

const I = { date: "日期", total: "可售单数" } as const;
const INVENTORY_SHEET = "库存";
const IMPORT_DATE_MESSAGES: Readonly<Record<string, string>> = { TOO_FAR_AHEAD: `最远只能设到 ${INVENTORY_LIMITS.maxDaysAhead} 天以后，请删掉这一行` };

/** 导出一段日期的库存表：每天一行，没设过的那一格是空的——填上数再导入就是设置；也当模版用。 */
export function exportInventory(ctx: AppContext, tenantId: string, productId: string, from: string, to: string): Promise<ExportedFile> {
  if (!isLocalDate(from) || !isLocalDate(to) || to < from || addDays(from, INVENTORY_LIMITS.maxRangeDays - 1) < to) {
    throw validationFailed("querystring", [{ path: "/to", reason: "INVALID_RANGE", message: `要给合法的开始和结束日期，最多 ${INVENTORY_LIMITS.maxRangeDays} 天` }]);
  }
  const now = ctx.now();
  return readTx(ctx, tenantId, async (db) => {
    const context = await loadInventoryContext(db, tenantId, productId, now, { lock: false });
    const days = new Map((await listInventoryDays(db, tenantId, productId, from, to)).map((day) => [day.date, day.total]));
    const rows: XlsxWriteCell[][] = [[I.date, I.total]];
    for (let date = from; date <= to; date = addDays(date, 1)) rows.push([date, days.has(date) ? { number: String(days.get(date)) } : null]);
    const help: XlsxWriteCell[][] = [
      ["填写说明"],
      [`商品 ${context.product.code} 的每日库存（按城市当地的用车日期）。`],
      ["第一行是表头，不要改。每一行是一天；「可售单数」填 0 到 9999 的整数。"],
      ["填 0 = 这一天停售；留空 = 清除（限量模式下没设的日子不可售）。"],
      ["只能改今天和以后的日子；已经有订单占着的日子，不能改到占用数以下。一次最多 366 行。"],
    ];
    return { fileName: `${context.product.code}-inventory-${from}-${to}.xlsx`, content: writeXlsx([{ name: INVENTORY_SHEET, rows, header: true, columnWidths: [14, 12] }, { name: "填写说明", rows: help, columnWidths: [70] }]) };
  });
}

export interface InventoryImportRow {
  row: number;
  date: string | null;
  /** `set` 设成一个数；`clear` 清除；`unchanged` 和现在一样；`error` 写得不对；`conflict` 这一天有订单占着，不能改成这个数 */
  action: "set" | "clear" | "unchanged" | "error" | "conflict";
  total: number | null;
  issues: CellIssue[];
  occupied: number | null;
}

export interface InventoryImportPreview {
  version: number;
  fileSha256: string;
  summary: { rows: number; set: number; clear: number; unchanged: number; error: number; conflict: number };
  canImport: boolean;
  rows: InventoryImportRow[];
}

/**
 * 检查一份库存表。`lock`：确认导入时为真——读每一天现在的数和占用数的同时把这些天锁住，直到事务结束。
 * 这样「检查」和「写入」之间不会再有订单挤进来：确认被拒时一律是 IMPORT_NOT_CLEAN 加最新的检查结果，
 * 不会检查通过了、写的时候才发现被占用（那样返回的是另一个错误码，页面没法照着显示）。
 */
async function inventoryPreview(db: Db, tenantId: string, context: InventoryContext, bytes: Uint8Array, lock: boolean): Promise<{ preview: InventoryImportPreview; changes: InventoryChange[] }> {
  const sheet = new Sheet(sheetRows(bytes, INVENTORY_SHEET), [I.date, I.total]);
  const dataRows = sheet.dataRows();
  if (dataRows.length > IMPORT_LIMITS.maxInventoryRows) throw fileInvalid("TOO_MANY_ROWS", `一次最多导入 ${IMPORT_LIMITS.maxInventoryRows} 行，这个文件有 ${dataRows.length} 行`, { max: IMPORT_LIMITS.maxInventoryRows, rows: dataRows.length });
  const rows: InventoryImportRow[] = [];
  const seen = new Set<string>();
  const pastRows = new Set<number>();
  for (const index of dataRows) {
    const issues: CellIssue[] = [];
    const read = rowReader(sheet, index, issues);
    const date = read.date(I.date, true);
    const total = read.integer(I.total, false);
    let past = false;
    if (date !== null) {
      const dateIssue = inventoryDateIssue(date, context.today);
      // 过去的日子：先不报错——导出一整个月、只改后半个月的人，前半个月原样留着应当算「没变」。下面和现在的数比过之后，变了的才报
      if (dateIssue === "DATE_IN_PAST") past = true;
      else if (dateIssue !== null) read.problem(I.date, dateIssue, IMPORT_DATE_MESSAGES[dateIssue] ?? INVENTORY_ISSUE_MESSAGES[dateIssue]);
      if (seen.has(date)) read.problem(I.date, "DUPLICATE", "同一天在文件里出现了两次，请只留一行");
      seen.add(date);
    }
    const totalIssue = issues.some((issue) => issue.column === I.total) ? null : inventoryTotalIssue(total);
    if (totalIssue !== null) read.problem(I.total, totalIssue, `要填 0 到 ${INVENTORY_LIMITS.maxDailyTotal} 的整数`);
    rows.push({ row: index + 1, date, action: issues.length > 0 ? "error" : total === null ? "clear" : "set", total, issues, occupied: null });
    if (past) pastRows.add(index + 1);
  }
  const valid = rows.filter((row) => row.action !== "error" && row.date !== null);
  const dates = valid.map((row) => row.date as string).sort();
  const first = dates[0];
  const last = dates[dates.length - 1];
  const current = new Map(first === undefined || last === undefined ? [] : (await listInventoryDays(db, tenantId, context.product.id, first, last, { lock })).map((day) => [day.date, day]));
  const changes: InventoryChange[] = [];
  for (const row of valid) {
    const day = current.get(row.date as string) ?? null;
    const occupied = inventoryOccupiedBlocking(day, row.total);
    if (pastRows.has(row.row)) {
      if ((day?.total ?? null) === row.total) row.action = "unchanged";
      else {
        row.action = "error";
        row.issues.push({ cell: sheet.cell(row.row - 1, I.date).at, column: I.date, reason: "DATE_IN_PAST", message: "这一天已经过去了，库存不能再改。请把这一行改回原来的数，或者删掉这一行" });
      }
    } else if (occupied !== null) {
      row.action = "conflict";
      row.occupied = occupied;
      row.issues.push({ cell: sheet.cell(row.row - 1, I.total).at, column: I.total, reason: "INVENTORY_BELOW_OCCUPIED", message: `这一天已经有 ${occupied} 单占着库存，不能改到它以下，也不能清除` });
    } else if ((day?.total ?? null) === row.total) row.action = "unchanged";
    else changes.push({ date: row.date as string, total: row.total });
  }
  const count = (action: string): number => rows.filter((row) => row.action === action).length;
  const summary = { rows: rows.length, set: count("set"), clear: count("clear"), unchanged: count("unchanged"), error: count("error"), conflict: count("conflict") };
  return { preview: { version: context.product.version, fileSha256: fileFingerprint(bytes), summary, canImport: summary.error === 0 && summary.conflict === 0 && summary.set + summary.clear > 0, rows }, changes };
}

export function previewInventoryImport(ctx: AppContext, tenantId: string, productId: string, bytes: Uint8Array): Promise<InventoryImportPreview> {
  const now = ctx.now();
  return readTx(ctx, tenantId, async (db) => (await inventoryPreview(db, tenantId, await loadInventoryContext(db, tenantId, productId, now, { lock: false }), bytes, false)).preview);
}

/** 确认导入库存：规则同价格的导入。写入用的是和批量设置同一段代码，审计日志记一条（带每一天的前后值）。 */
export function importInventory(
  ctx: AppContext,
  writer: ProductWriter,
  productId: string,
  expectedVersion: number,
  bytes: Uint8Array,
  previewSha256: string,
  idempotency: { scope: string; key: string },
  previewJson: (preview: InventoryImportPreview) => Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const now = ctx.now();
  const tenantId = writer.principal.tenantId;
  const fileSha256 = fileFingerprint(bytes);
  if (fileSha256 !== previewSha256.toLowerCase()) throw fileChanged();
  return writeTx(ctx, tenantId, async (db) => {
    const result = await runIdempotent(db, { tenantId, scope: idempotency.scope, key: idempotency.key, request: { productId, expectedVersion, fileSha256 }, now }, async () => {
      const context = await loadInventoryContext(db, tenantId, productId, now, { lock: true });
      if (context.product.version !== expectedVersion) throw versionConflict(context.product.version);
      const { preview, changes } = await inventoryPreview(db, tenantId, context, bytes, true);
      if (!preview.canImport) throw notClean(preview.summary, previewJson(preview));
      const applied = await applyInventoryChanges(db, writer, context, changes, { source: "import", file_sha256: fileSha256 }, now);
      return { status: 200, body: { version: applied.version, changed_days: applied.changed.length, summary: preview.summary } };
    });
    return { status: result.status, body: result.body };
  });
}
