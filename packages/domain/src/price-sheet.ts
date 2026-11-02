/**
 * 价格表导入第 0 阶段（ADR 0059，M4-28）：把一份多 sheet 的价格表解析出来，按现有框架分类映射，生成只读报告。
 * 这里全是纯函数：不碰文件、网络和数据库。读 xlsx 和写报告在 apps/api/src/cli/price-sheet-report.ts。
 *
 * 表格内容是不可信的输入：
 * - 公式不取值（读取层给出的就是 formula，没有缓存值），错误值、逻辑值、文字写在价格格里都记为问题，不当成价格、也不当成空；
 * - 价格只接受十进制正整数原文，不经过浮点数（CLAUDE.md 规则 3）；
 * - 表里的名字只当数据，放进 Map 而不是对象的键，报告里转义后才输出。
 * 不猜测：名字对不上就列为未匹配，同名列不合并、不覆盖，归一化只做写法层面的统一（不做繁简转换、不拆分、不去后缀）。
 */
import { VEHICLE_GRADE_ABBREVIATIONS, type VehicleGrade, vehicleGroupCodeIssue } from "./master-data.ts";
import { PRICE_LIMITS } from "./pricing.ts";

// ---- 输入 ----

/** 和读取层（apps/api/src/integrations/xlsx.ts）的单元格结构相同；domain 不依赖它。 */
export type PriceSheetCell =
  | { type: "empty" }
  | { type: "text"; text: string }
  | { type: "number"; text: string }
  | { type: "boolean"; text: string }
  | { type: "error"; text: string }
  | { type: "formula" };

export interface PriceSheetRawSheet {
  name: string;
  rows: readonly (readonly PriceSheetCell[])[];
}

export const PRICE_SHEET_NOTES = "说明";
export const PRICE_SHEET_VEHICLES = "车型";
export const PRICE_SHEET_MILEAGE = "里程价";

/** 路线 sheet 的名字和国家 / 地区码（ISO 3166-1）。 */
export const PRICE_SHEET_COUNTRIES: readonly { sheet: string; countryCode: string }[] = [
  { sheet: "日本", countryCode: "JP" },
  { sheet: "中国大陆", countryCode: "CN" },
  { sheet: "中国香港", countryCode: "HK" },
  { sheet: "中国台湾", countryCode: "TW" },
  { sheet: "韩国", countryCode: "KR" },
  { sheet: "泰国", countryCode: "TH" },
  { sheet: "越南", countryCode: "VN" },
  { sheet: "新加坡", countryCode: "SG" },
  { sheet: "马来西亚", countryCode: "MY" },
  { sheet: "菲律宾", countryCode: "PH" },
];

export const PRICE_SHEET_NAMES: readonly string[] = [PRICE_SHEET_NOTES, PRICE_SHEET_VEHICLES, ...PRICE_SHEET_COUNTRIES.map((country) => country.sheet), PRICE_SHEET_MILEAGE];

const VEHICLE_HEADERS = ["国家/地区", "车型", "代表车型（或同级）", "最多乘客", "最多行李"] as const;
const MILEAGE_HEADERS = ["国家/地区", "车型", "价格包", "起步价（日元）", "最低消费（日元）", "超出后每公里（日元）", "来源"] as const;
const ROUTE_HEADERS = ["出发地", "目的地"] as const;

/** 名字长到不正常就当问题报出来，不进后面的分析 */
const MAX_NAME_LENGTH = 200;
/** 每一类异常在报告里最多列几个例子 */
export const PRICE_SHEET_EXAMPLE_LIMIT = 5;

export type PriceSheetErrorCode = "MISSING_SHEET" | "BAD_HEADER" | "BAD_MASTER";

/** 结构性错误：表的结构不是约定的样子，整份报告都不可信，直接拒绝。 */
export class PriceSheetError extends Error {
  readonly code: PriceSheetErrorCode;
  constructor(code: PriceSheetErrorCode, message: string) {
    super(message);
    this.name = "PriceSheetError";
    this.code = code;
  }
}

export type PriceSheetIssueCode =
  | "UNEXPECTED_SHEET"
  | "HIDDEN_SHEET"
  | "SHEET_LIST_UNAVAILABLE"
  | "FORMULA_CELL"
  | "INVALID_PRICE_CELL"
  | "INVALID_NUMBER_CELL"
  | "INVALID_ENDPOINT"
  | "INVALID_COLUMN_HEADER"
  | "CAPACITY_UNPARSEABLE"
  | "ORPHAN_VALUE"
  | "UNKNOWN_COUNTRY"
  | "DECLARED_COUNT_MISMATCH"
  | "DECLARED_COUNT_MISSING";

/** 不影响其他部分的问题：逐条报出来，这一格不算价格。`where` 是 `sheet!B12`，`detail` 不含公式内容。 */
export interface PriceSheetIssue {
  code: PriceSheetIssueCode;
  where: string;
  detail: string;
}

// ---- 解析 ----

function cellRef(row: number, column: number): string {
  let letters = "";
  for (let n = column + 1; n > 0; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  return `${letters}${row + 1}`;
}

const EMPTY_CELL: PriceSheetCell = { type: "empty" };
const cellAt = (row: readonly PriceSheetCell[] | undefined, column: number): PriceSheetCell => row?.[column] ?? EMPTY_CELL;
const cellText = (cell: PriceSheetCell): string | null => (cell.type === "text" ? cell.text.trim() : null);

const PRICE_TEXT = /^[1-9][0-9]{0,11}$/;
const WHOLE_TEXT = /^(?:0|[1-9][0-9]{0,11})$/;

/** 一个数字格：只接受十进制整数原文（`1.2E+4`、`12000.5`、文字都不算）。空返回 null；不合规记问题并返回 undefined。 */
function readInteger(cell: PriceSheetCell, where: string, issues: PriceSheetIssue[], options: { allowZero: boolean; code: PriceSheetIssueCode }): number | null | undefined {
  if (cell.type === "empty") return null;
  if (cell.type === "formula") {
    issues.push({ code: "FORMULA_CELL", where, detail: "单元格是公式，没有取值" });
    return undefined;
  }
  if (cell.type !== "number") {
    issues.push({ code: options.code, where, detail: `不是数字（${cell.type}）` });
    return undefined;
  }
  if (!(options.allowZero ? WHOLE_TEXT : PRICE_TEXT).test(cell.text)) {
    issues.push({ code: options.code, where, detail: "不是合规的正整数" });
    return undefined;
  }
  const value = Number(cell.text);
  if (value > PRICE_LIMITS.maxAmountMinor) {
    issues.push({ code: options.code, where, detail: `超过单个金额的上限 ${PRICE_LIMITS.maxAmountMinor}` });
    return undefined;
  }
  return value;
}

export interface PriceSheetCapacity {
  passengers: number;
  luggage: number;
}

export interface PriceSheetColumn {
  /** 表里的列号（从 0 数） */
  column: number;
  ref: string;
  name: string;
  capacity: PriceSheetCapacity | null;
}

export interface PriceSheetRoute {
  /** 表里的行号（从 1 数） */
  row: number;
  from: string;
  to: string;
  /** 和 `columns` 一一对应：价格；空或不合规是 null */
  prices: (number | null)[];
  invalidCells: number;
}

export interface PriceSheetCountry {
  sheet: string;
  countryCode: string;
  columns: PriceSheetColumn[];
  routes: PriceSheetRoute[];
}

export interface PriceSheetVehicleEntry {
  sheet: string;
  name: string;
  sampleModels: string;
  capacity: PriceSheetCapacity | null;
  row: number;
}

export interface PriceSheetMileageEntry {
  sheet: string;
  name: string;
  source: string;
  startPrice: number | null;
  minPrice: number | null;
  perKm: number | null;
  row: number;
}

export interface PriceSheetNotes {
  /** 说明页写了「未单独列出反向线路，反向同价」 */
  reverseSamePrice: boolean;
  /** 说明页写的起步价含多少公里；没写是 null */
  startKilometers: number | null;
  /** 说明页声明的各 sheet 路线数 */
  declaredRoutes: { name: string; count: number }[];
}

export interface ParsedPriceWorkbook {
  notes: PriceSheetNotes;
  vehicles: PriceSheetVehicleEntry[];
  countries: PriceSheetCountry[];
  mileage: PriceSheetMileageEntry[];
  issues: PriceSheetIssue[];
}

function requireHeaders(sheet: PriceSheetRawSheet, expected: readonly string[]): void {
  const header = sheet.rows[0];
  expected.forEach((title, column) => {
    if (cellText(cellAt(header, column)) !== title) throw new PriceSheetError("BAD_HEADER", `「${sheet.name}」的第 ${column + 1} 列表头应该是「${title}」`);
  });
}

const isEmptyRow = (row: readonly PriceSheetCell[]): boolean => row.every((cell) => cell.type === "empty");

const CAPACITY_TEXT = /^最多\s*([0-9]{1,3})\s*人\s*\/\s*([0-9]{1,3})\s*件$/;

function parseNotes(sheet: PriceSheetRawSheet): PriceSheetNotes {
  const lines = sheet.rows.flatMap((row) => row.flatMap((cell) => (cell.type === "text" ? [cell.text] : [])));
  const notes: PriceSheetNotes = { reverseSamePrice: false, startKilometers: null, declaredRoutes: [] };
  for (const line of lines) {
    if (/未单独列出反向线路.{0,8}反向同价/.test(line)) notes.reverseSamePrice = true;
    const start = /起步价含前\s*([0-9]{1,4})\s*公里/.exec(line);
    if (start) notes.startKilometers = Number(start[1]);
    const declared = /^\s*([^：:\s]{1,20})[：:]\s*([0-9]{1,6})\s*条\s*$/.exec(line);
    if (declared) notes.declaredRoutes.push({ name: declared[1] as string, count: Number(declared[2]) });
  }
  return notes;
}

function parseRouteSheet(sheet: PriceSheetRawSheet, countryCode: string, issues: PriceSheetIssue[]): PriceSheetCountry {
  requireHeaders(sheet, ROUTE_HEADERS);
  const at = (row: number, column: number): string => `${sheet.name}!${cellRef(row, column)}`;
  const header = sheet.rows[0] as readonly PriceSheetCell[];
  const capacityRow = sheet.rows[1];
  const columns: PriceSheetColumn[] = [];
  for (let column = ROUTE_HEADERS.length; column < header.length; column += 1) {
    const cell = cellAt(header, column);
    if (cell.type === "empty") continue;
    const name = cellText(cell);
    if (name === null || name === "" || name.length > MAX_NAME_LENGTH) {
      issues.push({ code: "INVALID_COLUMN_HEADER", where: at(0, column), detail: "车型列的表头不是有效的文字，这一列不读" });
      continue;
    }
    const match = CAPACITY_TEXT.exec(cellText(cellAt(capacityRow, column)) ?? "");
    if (!match) issues.push({ code: "CAPACITY_UNPARSEABLE", where: at(1, column), detail: "容量不是「最多 N 人/M 件」的写法" });
    columns.push({ column, ref: at(0, column), name, capacity: match ? { passengers: Number(match[1]), luggage: Number(match[2]) } : null });
  }
  const known = new Set(columns.map((entry) => entry.column));
  const routes: PriceSheetRoute[] = [];
  sheet.rows.forEach((row, rowIndex) => {
    if (rowIndex < 2 || isEmptyRow(row)) return;
    const from = cellText(cellAt(row, 0));
    const to = cellText(cellAt(row, 1));
    const badEndpoint = (name: string | null): boolean => name === null || name === "" || name.length > MAX_NAME_LENGTH;
    if (badEndpoint(from) || badEndpoint(to)) {
      issues.push({ code: "INVALID_ENDPOINT", where: at(rowIndex, badEndpoint(from) ? 0 : 1), detail: "出发地、目的地必须是有效的文字，这一行不读" });
      return;
    }
    row.forEach((cell, column) => {
      if (column >= ROUTE_HEADERS.length && cell.type !== "empty" && !known.has(column)) issues.push({ code: "ORPHAN_VALUE", where: at(rowIndex, column), detail: "这一格所在的列没有车型表头，不读" });
    });
    let invalidCells = 0;
    const prices = columns.map((entry) => {
      const value = readInteger(cellAt(row, entry.column), at(rowIndex, entry.column), issues, { allowZero: false, code: "INVALID_PRICE_CELL" });
      if (value === undefined) invalidCells += 1;
      return value ?? null;
    });
    routes.push({ row: rowIndex + 1, from: from as string, to: to as string, prices, invalidCells });
  });
  return { sheet: sheet.name, countryCode, columns, routes };
}

function parseVehicleSheet(sheet: PriceSheetRawSheet, issues: PriceSheetIssue[]): PriceSheetVehicleEntry[] {
  requireHeaders(sheet, VEHICLE_HEADERS);
  const entries: PriceSheetVehicleEntry[] = [];
  const countries = new Set(PRICE_SHEET_COUNTRIES.map((country) => country.sheet));
  sheet.rows.forEach((row, rowIndex) => {
    if (rowIndex === 0 || isEmptyRow(row)) return;
    const where = (column: number): string => `${sheet.name}!${cellRef(rowIndex, column)}`;
    const country = cellText(cellAt(row, 0));
    const name = cellText(cellAt(row, 1));
    if (country === null || !countries.has(country)) {
      issues.push({ code: "UNKNOWN_COUNTRY", where: where(0), detail: "不是约定的 10 个国家 / 地区之一，这一行不读" });
      return;
    }
    if (name === null || name === "" || name.length > MAX_NAME_LENGTH) {
      issues.push({ code: "INVALID_COLUMN_HEADER", where: where(1), detail: "车型名称不是有效的文字，这一行不读" });
      return;
    }
    const passengers = readInteger(cellAt(row, 3), where(3), issues, { allowZero: false, code: "INVALID_NUMBER_CELL" });
    const luggage = readInteger(cellAt(row, 4), where(4), issues, { allowZero: true, code: "INVALID_NUMBER_CELL" });
    const capacity = typeof passengers === "number" && typeof luggage === "number" ? { passengers, luggage } : null;
    entries.push({ sheet: country, name, sampleModels: cellText(cellAt(row, 2)) ?? "", capacity, row: rowIndex + 1 });
  });
  return entries;
}

function parseMileageSheet(sheet: PriceSheetRawSheet, issues: PriceSheetIssue[]): PriceSheetMileageEntry[] {
  requireHeaders(sheet, MILEAGE_HEADERS);
  const entries: PriceSheetMileageEntry[] = [];
  const countries = new Set(PRICE_SHEET_COUNTRIES.map((country) => country.sheet));
  sheet.rows.forEach((row, rowIndex) => {
    if (rowIndex === 0 || isEmptyRow(row)) return;
    const where = (column: number): string => `${sheet.name}!${cellRef(rowIndex, column)}`;
    const country = cellText(cellAt(row, 0));
    const name = cellText(cellAt(row, 1));
    if (country === null || !countries.has(country)) {
      issues.push({ code: "UNKNOWN_COUNTRY", where: where(0), detail: "不是约定的 10 个国家 / 地区之一，这一行不读" });
      return;
    }
    if (name === null || name === "" || name.length > MAX_NAME_LENGTH) {
      issues.push({ code: "INVALID_COLUMN_HEADER", where: where(1), detail: "车型名称不是有效的文字，这一行不读" });
      return;
    }
    const money = (column: number, allowZero: boolean): number | null => readInteger(cellAt(row, column), where(column), issues, { allowZero, code: "INVALID_PRICE_CELL" }) ?? null;
    entries.push({ sheet: country, name, source: cellText(cellAt(row, 6)) ?? "", startPrice: money(3, true), minPrice: money(4, false), perKm: money(5, true), row: rowIndex + 1 });
  });
  return entries;
}

/**
 * 解析整份价格表。缺 sheet、表头不对抛 `PriceSheetError`；单元格层面的问题记在 `issues` 里。
 * `extraIssues`：读取层发现的问题（多余的、隐藏的 sheet）。
 */
export function parsePriceWorkbook(sheets: readonly PriceSheetRawSheet[], extraIssues: readonly PriceSheetIssue[] = []): ParsedPriceWorkbook {
  const byName = new Map(sheets.map((sheet) => [sheet.name, sheet]));
  const need = (name: string): PriceSheetRawSheet => {
    const sheet = byName.get(name);
    if (!sheet) throw new PriceSheetError("MISSING_SHEET", `缺少「${name}」这张表`);
    return sheet;
  };
  const issues: PriceSheetIssue[] = [...extraIssues];
  const notes = parseNotes(need(PRICE_SHEET_NOTES));
  const vehicles = parseVehicleSheet(need(PRICE_SHEET_VEHICLES), issues);
  const countries = PRICE_SHEET_COUNTRIES.map((country) => parseRouteSheet(need(country.sheet), country.countryCode, issues));
  const mileage = parseMileageSheet(need(PRICE_SHEET_MILEAGE), issues);
  const byCount = new Map(countries.map((country) => [country.sheet, country.routes.length]));
  const total = countries.reduce((sum, country) => sum + country.routes.length, 0);
  for (const country of countries) {
    if (!notes.declaredRoutes.some((declared) => declared.name === country.sheet)) issues.push({ code: "DECLARED_COUNT_MISSING", where: PRICE_SHEET_NOTES, detail: `说明页没有写「${country.sheet}」的路线数` });
  }
  for (const declared of notes.declaredRoutes) {
    const actual = declared.name === "合计" ? total : byCount.get(declared.name);
    if (actual !== undefined && actual !== declared.count) issues.push({ code: "DECLARED_COUNT_MISMATCH", where: PRICE_SHEET_NOTES, detail: `说明页写「${declared.name}」${declared.count} 条，实际读到 ${actual} 条` });
  }
  return { notes, vehicles, countries, mileage, issues };
}

// ---- 名字和分类 ----

/** 名字的归一化：全角半角统一（NFKC）、去控制字符、空白合并、不分大小写。不做繁简转换，不拆分，不去后缀。 */
export function normalizePriceSheetName(name: string): string {
  return name
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export type PriceSheetEndpointKind = "airport" | "station" | "pier" | "place";

const AIRPORT_WORDS = /机场|機場|機场|机場|空港/;
const PIER_WORDS = /码头|碼頭|邮轮|郵輪|游轮|遊輪|港口/;
const STATION_END = /[站駅驿驛]$/;

/** 端点是什么：**只看名字里明确的字**（这张表没有别的信息），判断不了的都算地点。 */
export function classifyPriceSheetEndpoint(name: string): PriceSheetEndpointKind {
  const text = normalizePriceSheetName(name);
  if (AIRPORT_WORDS.test(text)) return "airport";
  if (PIER_WORDS.test(text)) return "pier";
  return STATION_END.test(text) ? "station" : "place";
}

/**
 * 分类算成地点、但名字看着可能不是的：不改分类（以「港」结尾的既可能是港口，也可能是城市，比如岘港），只列出来让人看。
 */
export function priceSheetEndpointSuspicion(name: string): string | null {
  const text = normalizePriceSheetName(name);
  if (classifyPriceSheetEndpoint(name) !== "place") return null;
  if (text.endsWith("港") && !text.endsWith("香港")) return "以「港」结尾，可能是港口";
  if (/[场場]$/.test(text)) return "以「场」结尾，可能是机场或场地";
  return text.includes("口岸") ? "是口岸，地点类型里没有" : null;
}

export const PRICE_SHEET_ROUTE_CLASSES = ["airport_place", "station_pier_other", "airport_airport", "place_place"] as const;
export type PriceSheetRouteClass = (typeof PRICE_SHEET_ROUTE_CLASSES)[number];
export const PRICE_SHEET_ROUTE_CLASS_NAMES: Readonly<Record<PriceSheetRouteClass, string>> = {
  airport_place: "机场↔非机场",
  station_pier_other: "车站或码头↔非机场",
  airport_airport: "机场↔机场",
  place_place: "地点↔地点",
};

export const PRICE_SHEET_SCOPES = ["in_framework", "out_of_framework", "owner_confirm"] as const;
export type PriceSheetScope = (typeof PRICE_SHEET_SCOPES)[number];
export const PRICE_SHEET_SCOPE_NAMES: Readonly<Record<PriceSheetScope, string>> = { in_framework: "框架内", out_of_framework: "框架外", owner_confirm: "需业主确认" };

/** 路线在现有框架里算哪一种。 */
export const PRICE_SHEET_ROUTE_DETAILS = {
  airport_place: { title: "机场↔地点", scope: "in_framework", group: "transfer", note: "接送机：接送点是机场，另一端是区域" },
  station_place: { title: "车站↔地点", scope: "in_framework", group: "transfer", note: "接送机：接送点是车站，另一端是区域" },
  station_airport: { title: "车站↔机场", scope: "owner_confirm", group: "conditional", note: "接送机一条价只有一个接送点，另一端要当区域，需要决定以哪一端为接送点、另一端怎么画区域" },
  station_station: { title: "车站↔车站", scope: "owner_confirm", group: "conditional", note: "同上，两端都是接送点类型" },
  pier_place: { title: "码头↔地点", scope: "out_of_framework", group: "conditional", note: "地点类型没有码头，接送点只能是机场或车站（ADR 0012、0016）" },
  pier_airport: { title: "码头↔机场", scope: "out_of_framework", group: "conditional", note: "同上" },
  pier_station: { title: "码头↔车站", scope: "out_of_framework", group: "conditional", note: "同上" },
  pier_pier: { title: "码头↔码头", scope: "out_of_framework", group: "conditional", note: "同上" },
  airport_airport: { title: "机场↔机场", scope: "out_of_framework", group: "point_to_point", note: "接送机只有一个接送点；点对点的价按区域，不按起终点" },
  place_same: {
    title: "地点↔同一地点",
    scope: "owner_confirm",
    group: "point_to_point",
    note: "可以映射成同一区域内的点对点价；但起终点跨区域时，引擎把两端区域的价都算、取最低（ADR 0020），导入后跨区行程会按区内价报出",
  },
  place_other: { title: "地点↔另一地点", scope: "out_of_framework", group: "point_to_point", note: "点对点的价是「区域 × 车型组」，没有起点 + 终点的价（ADR 0018、0020）" },
} as const satisfies Record<string, { title: string; scope: PriceSheetScope; group: "transfer" | "conditional" | "point_to_point"; note: string }>;
export type PriceSheetRouteDetail = keyof typeof PRICE_SHEET_ROUTE_DETAILS;

const detailOf = (a: PriceSheetEndpointKind, b: PriceSheetEndpointKind, sameName: boolean): PriceSheetRouteDetail => {
  const kinds = new Set([a, b]);
  if (kinds.has("pier")) {
    if (kinds.size === 1) return "pier_pier";
    if (kinds.has("airport")) return "pier_airport";
    return kinds.has("station") ? "pier_station" : "pier_place";
  }
  if (kinds.has("station")) {
    if (kinds.size === 1) return "station_station";
    return kinds.has("airport") ? "station_airport" : "station_place";
  }
  if (kinds.has("airport")) return kinds.size === 1 ? "airport_airport" : "airport_place";
  return sameName ? "place_same" : "place_other";
};

export function classifyPriceSheetRoute(from: string, to: string): { routeClass: PriceSheetRouteClass; detail: PriceSheetRouteDetail } {
  const a = classifyPriceSheetEndpoint(from);
  const b = classifyPriceSheetEndpoint(to);
  const detail = detailOf(a, b, normalizePriceSheetName(from) === normalizePriceSheetName(to));
  // 大类先看机场：一端是机场、另一端不是的都归「机场↔非机场」（含机场↔车站、码头，这两种的结论在 detail 里）
  if (a === "airport" && b === "airport") return { routeClass: "airport_airport", detail };
  if (a === "airport" || b === "airport") return { routeClass: "airport_place", detail };
  if (detail === "place_same" || detail === "place_other") return { routeClass: "place_place", detail };
  return { routeClass: "station_pier_other", detail };
}

// ---- 反向价 ----

export type PriceSheetReverseKind = "self" | "one_way" | "both_same" | "both_partial" | "both_different" | "duplicate_conflict";

export const PRICE_SHEET_REVERSE_NAMES: Readonly<Record<PriceSheetReverseKind, string>> = {
  self: "起终点相同（没有反向）",
  one_way: "只列了一个方向",
  both_same: "两个方向都列、价格相同",
  both_partial: "两个方向都列、共同的车型价格相同，但有车型只有一个方向有价",
  both_different: "两个方向都列、有车型价格不同",
  duplicate_conflict: "同一方向重复列了几行、价格不一致（不选其中一行）",
};

export interface PriceSheetReversePair {
  from: string;
  to: string;
  kind: PriceSheetReverseKind;
  group: "transfer" | "conditional" | "point_to_point";
  /** 这个方向对的重复行数（完全相同的重复也算） */
  duplicateRows: number;
  /** 两个方向都有价、价格相同的车型列数 */
  sameColumns: number;
  /** 两个方向都有价、价格不同的车型列数 */
  differentColumns: number;
  /** 只有一个方向有价的车型列数 */
  oneSidedColumns: number;
  /** 只列一个方向时有价的车型列数 */
  pricedColumns: number;
}

const samePrices = (a: readonly (number | null)[], b: readonly (number | null)[]): boolean => a.length === b.length && a.every((value, index) => value === b[index]);

/** 按国家内的无序端点对，判断每一对的反向价情况。`both` 只用于同一 sheet 的路线（列相同）。 */
export function analyzePriceSheetReverse(routes: readonly Pick<PriceSheetRoute, "from" | "to" | "prices">[]): PriceSheetReversePair[] {
  const pairs = new Map<string, { forward: typeof routes[number][]; backward: typeof routes[number][] }>();
  for (const route of routes) {
    const a = normalizePriceSheetName(route.from);
    const b = normalizePriceSheetName(route.to);
    const key = JSON.stringify(a <= b ? [a, b] : [b, a]);
    let pair = pairs.get(key);
    if (!pair) {
      pair = { forward: [], backward: [] };
      pairs.set(key, pair);
    }
    const first = pair.forward[0];
    const isForward = first === undefined || (normalizePriceSheetName(first.from) === a && normalizePriceSheetName(first.to) === b);
    (isForward ? pair.forward : pair.backward).push(route);
  }
  const result: PriceSheetReversePair[] = [];
  for (const { forward, backward } of pairs.values()) {
    const head = forward[0] as (typeof routes)[number];
    const group = PRICE_SHEET_ROUTE_DETAILS[classifyPriceSheetRoute(head.from, head.to).detail].group;
    const conflict = forward.some((route) => !samePrices(route.prices, head.prices)) || backward.some((route) => !samePrices(route.prices, (backward[0] as (typeof routes)[number]).prices));
    const pair: PriceSheetReversePair = { from: head.from, to: head.to, kind: "one_way", group, duplicateRows: forward.length + backward.length - (backward.length > 0 ? 2 : 1), sameColumns: 0, differentColumns: 0, oneSidedColumns: 0, pricedColumns: head.prices.filter((price) => price !== null).length };
    if (conflict) pair.kind = "duplicate_conflict";
    else if (normalizePriceSheetName(head.from) === normalizePriceSheetName(head.to)) pair.kind = "self";
    else if (backward.length > 0) {
      const back = backward[0] as (typeof routes)[number];
      head.prices.forEach((price, index) => {
        const other = back.prices[index] ?? null;
        if (price === null && other === null) return;
        if (price === null || other === null) pair.oneSidedColumns += 1;
        else if (price === other) pair.sameColumns += 1;
        else pair.differentColumns += 1;
      });
      pair.kind = pair.differentColumns > 0 ? "both_different" : pair.oneSidedColumns > 0 ? "both_partial" : "both_same";
    }
    result.push(pair);
  }
  return result;
}

/** 反向价映射的结果：接送机能映射成几条 both / pickup + dropoff；其余无法表达。 */
export interface PriceSheetReverseSummary {
  /** 按种类和归属统计端点对数 */
  pairs: { kind: PriceSheetReverseKind; group: PriceSheetReversePair["group"]; count: number; scope: PriceSheetScope }[];
  /** 接送机可映射的价格条数（按车型列算）：通用；接机 + 送机（一列两条） */
  transferBothRules: number;
  transferPickupRules: number;
  transferDropoffRules: number;
  /** 接送机两个方向都列、但某车型只有一个方向有价：反向同价的规则说的是「未列出路线」，这种要确认 */
  transferOneSidedCells: number;
  /** 点对点无法表达的端点对（不算起终点相同的） */
  pointToPointUnexpressible: number;
}

function reverseScope(kind: PriceSheetReverseKind, group: PriceSheetReversePair["group"], reverseRuleDeclared: boolean): PriceSheetScope {
  if (kind === "duplicate_conflict" || kind === "both_partial") return "owner_confirm";
  if (group === "conditional") return "owner_confirm";
  if (group === "point_to_point") return kind === "self" ? "owner_confirm" : "out_of_framework";
  if (kind === "one_way" && !reverseRuleDeclared) return "owner_confirm";
  return "in_framework";
}

export function summarizePriceSheetReverse(pairs: readonly PriceSheetReversePair[], reverseRuleDeclared: boolean): PriceSheetReverseSummary {
  const counts = new Map<string, PriceSheetReverseSummary["pairs"][number]>();
  const summary: PriceSheetReverseSummary = { pairs: [], transferBothRules: 0, transferPickupRules: 0, transferDropoffRules: 0, transferOneSidedCells: 0, pointToPointUnexpressible: 0 };
  for (const pair of pairs) {
    const key = `${pair.kind}|${pair.group}`;
    const entry = counts.get(key) ?? { kind: pair.kind, group: pair.group, count: 0, scope: reverseScope(pair.kind, pair.group, reverseRuleDeclared) };
    entry.count += 1;
    counts.set(key, entry);
    if (pair.group === "point_to_point" && pair.kind !== "self") summary.pointToPointUnexpressible += 1;
    if (pair.group !== "transfer") continue;
    if (pair.kind === "one_way") summary.transferBothRules += pair.pricedColumns;
    else if (pair.kind !== "duplicate_conflict" && pair.kind !== "self") {
      summary.transferBothRules += pair.sameColumns;
      summary.transferPickupRules += pair.differentColumns;
      summary.transferDropoffRules += pair.differentColumns;
      summary.transferOneSidedCells += pair.oneSidedColumns;
    }
  }
  summary.pairs = [...counts.values()];
  return summary;
}

// ---- 城市匹配 ----

export interface PriceSheetMasterCity {
  code: string;
  countryCode: string;
  names: string[];
  status: string;
}

export interface PriceSheetMaster {
  cities: PriceSheetMasterCity[];
  /** 没给（null）时不核对现有车型组以外的内容 */
  vehicleGroupCodes: string[] | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * 主数据文件的内容（`--master`）：`{ "cities": [{ "code", "country_code", "name": { 语言: 名称 }, "status" }], "vehicle_groups": [{ "code" }] }`。
 * 字段名和 cities、vehicle_groups 表一致，多余的字段不看。写法不对就拒绝，不跳过（跳过会让匹配结果悄悄变少）。
 */
export function parsePriceSheetMaster(input: unknown): PriceSheetMaster {
  const bad = (what: string): PriceSheetError => new PriceSheetError("BAD_MASTER", `主数据文件的写法不对：${what}`);
  if (!isRecord(input) || !Array.isArray(input.cities)) throw bad("最外层要有 cities 数组");
  const cities = input.cities.map((city: unknown, index): PriceSheetMasterCity => {
    if (!isRecord(city) || typeof city.code !== "string" || typeof city.country_code !== "string" || typeof city.status !== "string" || !isRecord(city.name)) throw bad(`cities 第 ${index + 1} 条缺少 code、country_code、name 或 status`);
    const names = Object.values(city.name);
    if (!names.every((name): name is string => typeof name === "string")) throw bad(`cities 第 ${index + 1} 条的 name 不是文字`);
    return { code: city.code, countryCode: city.country_code, names, status: city.status };
  });
  let vehicleGroupCodes: string[] | null = null;
  if (input.vehicle_groups !== undefined) {
    if (!Array.isArray(input.vehicle_groups)) throw bad("vehicle_groups 要是数组");
    vehicleGroupCodes = input.vehicle_groups.map((group: unknown, index) => {
      if (!isRecord(group) || typeof group.code !== "string") throw bad(`vehicle_groups 第 ${index + 1} 条缺少 code`);
      return group.code;
    });
  }
  return { cities, vehicleGroupCodes };
}

export interface PriceSheetEndpointEntry {
  sheet: string;
  countryCode: string;
  name: string;
  normalized: string;
  kind: PriceSheetEndpointKind;
  /** 名字里有分隔符，可能是几个地方写在一起（只标出来，不拆） */
  composite: boolean;
  /** 分类算成地点、但名字看着可能不是的原因；只提示，不改分类 */
  suspicion: string | null;
  routes: number;
}

export type PriceSheetCityMatch =
  | { status: "matched"; code: string; cityStatus: string }
  | { status: "ambiguous"; codes: string[] }
  | { status: "unmatched" };

const COMPOSITE_NAME = /[,、/]/;

/** 这个 sheet 的端点清单（不重复，按归一化后的名字）。 */
export function priceSheetEndpoints(country: Pick<PriceSheetCountry, "sheet" | "countryCode" | "routes">): PriceSheetEndpointEntry[] {
  const entries = new Map<string, PriceSheetEndpointEntry>();
  for (const route of country.routes) {
    for (const name of route.from === route.to ? [route.from] : [route.from, route.to]) {
      const normalized = normalizePriceSheetName(name);
      const entry = entries.get(normalized);
      if (entry) entry.routes += 1;
      else entries.set(normalized, { sheet: country.sheet, countryCode: country.countryCode, name, normalized, kind: classifyPriceSheetEndpoint(name), composite: COMPOSITE_NAME.test(normalized), suspicion: priceSheetEndpointSuspicion(name), routes: 1 });
    }
  }
  return [...entries.values()];
}

/** 端点名和同一国家的城市比较：归一化后和某个语言的名称完全相同才算。几个城市都相同的是歧义，不选。 */
export function matchPriceSheetCity(normalized: string, countryCode: string, cities: readonly PriceSheetMasterCity[]): PriceSheetCityMatch {
  const hits = cities.filter((city) => city.countryCode === countryCode && city.names.some((name) => normalizePriceSheetName(name) === normalized));
  if (hits.length === 0) return { status: "unmatched" };
  const [only] = hits;
  if (hits.length === 1 && only) return { status: "matched", code: only.code, cityStatus: only.status };
  return { status: "ambiguous", codes: hits.map((city) => city.code) };
}

// ---- 车型 ----

const SEATER_NAME = /^(.+?)\s+([0-9]{1,2})\s+seater$/i;
const VEHICLE_TOKENS: ReadonlyMap<string, string> = new Map([
  ["economy", VEHICLE_GRADE_ABBREVIATIONS.economy],
  ["comfort", VEHICLE_GRADE_ABBREVIATIONS.comfort],
  ["luxury", VEHICLE_GRADE_ABBREVIATIONS.luxury],
  ["premium", "PRM"],
  ["bus", "BUS"],
  ["van", "VAN"],
  ["suv", "SUV"],
  ["sedan", "SEDAN"],
  ["mpv", "MPV"],
  ["electric", "EV"],
]);
const VEHICLE_GRADE_WORDS: ReadonlyMap<string, VehicleGrade> = new Map([
  ["economy", "economy"],
  ["comfort", "comfort"],
  ["luxury", "luxury"],
]);

export interface PriceSheetVehicleCode {
  /** 名字里没有座位数、或有不认识的词时是 null */
  code: string | null;
  seats: number | null;
  /** 第一个词（同级别比较用） */
  level: string | null;
  /** 现有的四个等级之一；名字对不上（Premium、Bus、Van、SUV……）是 null，要业主定 */
  grade: VehicleGrade | null;
  problem: string | null;
}

/** 按车型名称给出建议的车型组编码（`VG-等级-座位数`，ADR 0012）。只是建议，不写任何地方。 */
export function suggestPriceSheetVehicleCode(name: string): PriceSheetVehicleCode {
  const match = SEATER_NAME.exec(normalizePriceSheetName(name));
  if (!match) return { code: null, seats: null, level: null, grade: null, problem: "名称里没有座位数" };
  const words = (match[1] as string).split(" ");
  const level = words[0] as string;
  const seats = Number(match[2]);
  const tokens = words.map((word) => VEHICLE_TOKENS.get(word));
  const grade = VEHICLE_GRADE_WORDS.get(level) ?? null;
  if (tokens.some((token) => token === undefined)) return { code: null, seats, level, grade, problem: "名称里有不认识的词" };
  const code = `VG-${tokens.join("")}-${seats}`;
  const issue = vehicleGroupCodeIssue(code, seats, grade ?? undefined);
  return issue === null ? { code, seats, level, grade, problem: null } : { code: null, seats, level, grade, problem: issue };
}

export interface PriceSheetVehicleRow {
  name: string;
  countries: string[];
  capacities: { capacity: string; sheets: string[] }[];
  capacityDiffers: boolean;
  code: string | null;
  codeProblem: string | null;
  grade: VehicleGrade | null;
  existing: boolean;
  passengersOverSeats: boolean;
  scope: PriceSheetScope;
}

export interface PriceSheetInversionExample {
  sheet: string;
  from: string;
  to: string;
  fewer: { name: string; seats: number; price: number };
  more: { name: string; seats: number; price: number };
}

export interface PriceSheetVehicleAnalysis {
  rows: PriceSheetVehicleRow[];
  /** 不同名称（大小写不同算一个以上）给出了同一个编码 */
  codeCollisions: { code: string; names: string[] }[];
  /** 只差大小写、空白的名称 */
  caseVariants: string[][];
  /** 同一 sheet 里出现多次的车型列 */
  duplicateColumns: { sheet: string; name: string; refs: string[]; sameCapacity: boolean; rowsBothPriced: number; rowsDiffering: number }[];
  /** 车型表里同一国家出现多次的车型 */
  duplicateEntries: { sheet: string; name: string; rows: number[]; sampleModels: string[]; sameCapacity: boolean }[];
  /** 路线表第 2 行的容量和车型表不一致；路线表有、车型表没有；车型表有、路线表没有 */
  capacityMismatches: { sheet: string; name: string; ref: string }[];
  missingFromVehicleSheet: { sheet: string; name: string }[];
  missingFromRouteSheet: { sheet: string; name: string }[];
  inversions: { sheet: string; routes: number; comparisons: number; examples: PriceSheetInversionExample[] }[];
}

const capacityText = (capacity: PriceSheetCapacity | null): string => (capacity === null ? "未知" : `${capacity.passengers}人/${capacity.luggage}件`);
const sameCapacity = (a: PriceSheetCapacity | null, b: PriceSheetCapacity | null): boolean => capacityText(a) === capacityText(b);

/** 同一路线、同一级别（名称的第一个词），座位多的比座位少的便宜。只数和举例，不判断对错。 */
export function findPriceSheetInversions(country: Pick<PriceSheetCountry, "sheet" | "columns" | "routes">): PriceSheetVehicleAnalysis["inversions"][number] {
  const info = country.columns.map((column) => ({ name: column.name, ...suggestPriceSheetVehicleCode(column.name) }));
  const result: PriceSheetVehicleAnalysis["inversions"][number] = { sheet: country.sheet, routes: 0, comparisons: 0, examples: [] };
  for (const route of country.routes) {
    let hit = false;
    for (let i = 0; i < info.length; i += 1) {
      const fewer = info[i] as (typeof info)[number];
      const fewerPrice = route.prices[i] ?? null;
      if (fewer.seats === null || fewerPrice === null) continue;
      for (let j = 0; j < info.length; j += 1) {
        const more = info[j] as (typeof info)[number];
        const morePrice = route.prices[j] ?? null;
        if (more.seats === null || morePrice === null || more.level !== fewer.level || more.seats <= fewer.seats || morePrice >= fewerPrice) continue;
        hit = true;
        result.comparisons += 1;
        if (result.examples.length < PRICE_SHEET_EXAMPLE_LIMIT) {
          result.examples.push({ sheet: country.sheet, from: route.from, to: route.to, fewer: { name: fewer.name, seats: fewer.seats, price: fewerPrice }, more: { name: more.name, seats: more.seats, price: morePrice } });
        }
      }
    }
    if (hit) result.routes += 1;
  }
  return result;
}

/** 一个 sheet 里同名的车型列：不合并、不覆盖，报告成歧义。 */
export function findPriceSheetDuplicateColumns(country: Pick<PriceSheetCountry, "sheet" | "columns" | "routes">): PriceSheetVehicleAnalysis["duplicateColumns"] {
  const byName = new Map<string, number[]>();
  country.columns.forEach((column, index) => byName.set(column.name, [...(byName.get(column.name) ?? []), index]));
  const result: PriceSheetVehicleAnalysis["duplicateColumns"] = [];
  for (const [name, indexes] of byName) {
    if (indexes.length < 2) continue;
    const columns = indexes.map((index) => country.columns[index] as PriceSheetColumn);
    let rowsBothPriced = 0;
    let rowsDiffering = 0;
    for (const route of country.routes) {
      const priced = indexes.flatMap((index) => {
        const price = route.prices[index] ?? null;
        return price === null ? [] : [price];
      });
      if (priced.length < 2) continue;
      rowsBothPriced += 1;
      if (new Set(priced).size > 1) rowsDiffering += 1;
    }
    result.push({ sheet: country.sheet, name, refs: columns.map((column) => column.ref), sameCapacity: columns.every((column) => sameCapacity(column.capacity, (columns[0] as PriceSheetColumn).capacity)), rowsBothPriced, rowsDiffering });
  }
  return result;
}

function analyzeVehicles(book: ParsedPriceWorkbook, existingCodes: readonly string[]): PriceSheetVehicleAnalysis {
  const names = new Map<string, { sheets: Set<string>; capacities: Map<string, Set<string>> }>();
  const note = (name: string, sheet: string, capacity: PriceSheetCapacity | null): void => {
    let entry = names.get(name);
    if (!entry) {
      entry = { sheets: new Set(), capacities: new Map() };
      names.set(name, entry);
    }
    entry.sheets.add(sheet);
    const text = capacityText(capacity);
    entry.capacities.set(text, (entry.capacities.get(text) ?? new Set()).add(sheet));
  };
  for (const vehicle of book.vehicles) note(vehicle.name, vehicle.sheet, vehicle.capacity);
  for (const country of book.countries) for (const column of country.columns) note(column.name, country.sheet, column.capacity);

  const rows: PriceSheetVehicleRow[] = [...names].map(([name, entry]) => {
    const suggestion = suggestPriceSheetVehicleCode(name);
    const existing = suggestion.code !== null && existingCodes.includes(suggestion.code);
    const capacities = [...entry.capacities].map(([capacity, sheets]) => ({ capacity, sheets: [...sheets] }));
    const passengersOverSeats = suggestion.seats !== null && [...entry.capacities.keys()].some((text) => Number.parseInt(text, 10) > (suggestion.seats as number));
    const ready = suggestion.code !== null && suggestion.grade !== null && !passengersOverSeats;
    return {
      name,
      countries: [...entry.sheets],
      capacities,
      capacityDiffers: capacities.length > 1,
      code: suggestion.code,
      codeProblem: suggestion.problem,
      grade: suggestion.grade,
      existing,
      passengersOverSeats,
      scope: existing && ready && capacities.length === 1 ? "in_framework" : "owner_confirm",
    };
  });

  const codes = new Map<string, string[]>();
  const spellings = new Map<string, string[]>();
  for (const row of rows) {
    if (row.code !== null) codes.set(row.code, [...(codes.get(row.code) ?? []), row.name]);
    const key = normalizePriceSheetName(row.name);
    spellings.set(key, [...(spellings.get(key) ?? []), row.name]);
  }

  const duplicateEntries: PriceSheetVehicleAnalysis["duplicateEntries"] = [];
  const entriesBySheet = new Map<string, PriceSheetVehicleEntry[]>();
  for (const vehicle of book.vehicles) {
    const key = JSON.stringify([vehicle.sheet, vehicle.name]);
    entriesBySheet.set(key, [...(entriesBySheet.get(key) ?? []), vehicle]);
  }
  for (const entries of entriesBySheet.values()) {
    const first = entries[0] as PriceSheetVehicleEntry;
    if (entries.length > 1) {
      duplicateEntries.push({ sheet: first.sheet, name: first.name, rows: entries.map((entry) => entry.row), sampleModels: entries.map((entry) => entry.sampleModels), sameCapacity: entries.every((entry) => sameCapacity(entry.capacity, first.capacity)) });
    }
  }

  const capacityMismatches: PriceSheetVehicleAnalysis["capacityMismatches"] = [];
  const missingFromVehicleSheet: PriceSheetVehicleAnalysis["missingFromVehicleSheet"] = [];
  const missingFromRouteSheet: PriceSheetVehicleAnalysis["missingFromRouteSheet"] = [];
  for (const country of book.countries) {
    for (const column of country.columns) {
      const entries = entriesBySheet.get(JSON.stringify([country.sheet, column.name]));
      if (!entries) missingFromVehicleSheet.push({ sheet: country.sheet, name: column.name });
      else if (!entries.some((entry) => sameCapacity(entry.capacity, column.capacity))) capacityMismatches.push({ sheet: country.sheet, name: column.name, ref: column.ref });
    }
    const inSheet = new Set(country.columns.map((column) => column.name));
    const listed = new Set(book.vehicles.filter((vehicle) => vehicle.sheet === country.sheet).map((vehicle) => vehicle.name));
    for (const name of listed) if (!inSheet.has(name)) missingFromRouteSheet.push({ sheet: country.sheet, name });
  }

  return {
    rows,
    codeCollisions: [...codes].filter(([, list]) => list.length > 1).map(([code, list]) => ({ code, names: list })),
    caseVariants: [...spellings.values()].filter((list) => list.length > 1),
    duplicateColumns: book.countries.flatMap((country) => findPriceSheetDuplicateColumns(country)),
    duplicateEntries,
    capacityMismatches,
    missingFromVehicleSheet,
    missingFromRouteSheet,
    inversions: book.countries.map((country) => findPriceSheetInversions(country)),
  };
}

// ---- 里程价 ----

export interface PriceSheetMileageAnalysis {
  rows: number;
  incompleteRows: number;
  bySource: { source: string; rows: number }[];
  byCountry: { sheet: string; rows: number }[];
  startKilometers: number | null;
  /** 最低消费高于起步价的 */
  minAboveStart: { count: number; examples: { sheet: string; name: string; startPrice: number; minPrice: number }[] };
  /** 同一国家同一车型重复的行：完全相同的；不一致的（不选其中一行） */
  duplicates: { identical: number; conflicting: number; examples: { sheet: string; name: string; rows: number[]; conflicting: boolean }[] };
  /** 同一国家、同一级别，座位多的起步价反而低 */
  inversions: { count: number; examples: { sheet: string; fewer: string; more: string; fewerStart: number; moreStart: number }[] };
  /** 车型表里没有的车型 */
  unknownVehicles: { sheet: string; name: string }[];
}

function analyzeMileage(book: ParsedPriceWorkbook): PriceSheetMileageAnalysis {
  const groups = new Map<string, PriceSheetMileageEntry[]>();
  const sources = new Map<string, number>();
  const countries = new Map<string, number>();
  for (const entry of book.mileage) {
    const key = JSON.stringify([entry.sheet, entry.name]);
    groups.set(key, [...(groups.get(key) ?? []), entry]);
    sources.set(entry.source, (sources.get(entry.source) ?? 0) + 1);
    countries.set(entry.sheet, (countries.get(entry.sheet) ?? 0) + 1);
  }
  const known = new Set(book.vehicles.map((vehicle) => JSON.stringify([vehicle.sheet, vehicle.name])));
  const result: PriceSheetMileageAnalysis = {
    rows: book.mileage.length,
    incompleteRows: book.mileage.filter((entry) => entry.startPrice === null || entry.perKm === null).length,
    bySource: [...sources].map(([source, rows]) => ({ source, rows })),
    byCountry: [...countries].map(([sheet, rows]) => ({ sheet, rows })),
    startKilometers: book.notes.startKilometers,
    minAboveStart: { count: 0, examples: [] },
    duplicates: { identical: 0, conflicting: 0, examples: [] },
    inversions: { count: 0, examples: [] },
    unknownVehicles: [],
  };
  for (const entry of book.mileage) {
    if (entry.startPrice !== null && entry.minPrice !== null && entry.minPrice > entry.startPrice) {
      result.minAboveStart.count += 1;
      if (result.minAboveStart.examples.length < PRICE_SHEET_EXAMPLE_LIMIT) result.minAboveStart.examples.push({ sheet: entry.sheet, name: entry.name, startPrice: entry.startPrice, minPrice: entry.minPrice });
    }
  }
  for (const [key, entries] of groups) {
    const first = entries[0] as PriceSheetMileageEntry;
    if (!known.has(key)) result.unknownVehicles.push({ sheet: first.sheet, name: first.name });
    if (entries.length < 2) continue;
    const conflicting = entries.some((entry) => entry.startPrice !== first.startPrice || entry.minPrice !== first.minPrice || entry.perKm !== first.perKm);
    if (conflicting) result.duplicates.conflicting += 1;
    else result.duplicates.identical += 1;
    if (result.duplicates.examples.length < PRICE_SHEET_EXAMPLE_LIMIT) result.duplicates.examples.push({ sheet: first.sheet, name: first.name, rows: entries.map((entry) => entry.row), conflicting });
  }
  const single = [...groups.values()].flatMap((entries) => (entries.length === 1 ? entries : []));
  for (const fewer of single) {
    const a = suggestPriceSheetVehicleCode(fewer.name);
    for (const more of single) {
      if (more.sheet !== fewer.sheet || fewer.startPrice === null || more.startPrice === null) continue;
      const b = suggestPriceSheetVehicleCode(more.name);
      if (a.seats === null || b.seats === null || a.level !== b.level || b.seats <= a.seats || more.startPrice >= fewer.startPrice) continue;
      result.inversions.count += 1;
      if (result.inversions.examples.length < PRICE_SHEET_EXAMPLE_LIMIT) result.inversions.examples.push({ sheet: fewer.sheet, fewer: fewer.name, more: more.name, fewerStart: fewer.startPrice, moreStart: more.startPrice });
    }
  }
  return result;
}

// ---- 报告 ----

export interface PriceSheetClassStats {
  routes: number;
  pricedCells: number;
  emptyCells: number;
  invalidCells: number;
}

export interface PriceSheetCountryReport extends PriceSheetClassStats {
  sheet: string;
  countryCode: string;
  vehicleColumns: number;
  classes: Record<PriceSheetRouteClass, PriceSheetClassStats>;
  details: { detail: PriceSheetRouteDetail; title: string; scope: PriceSheetScope; note: string; stats: PriceSheetClassStats }[];
  reverse: PriceSheetReverseSummary;
  endpoints: { total: number; byKind: Record<PriceSheetEndpointKind, number> };
}

export interface PriceSheetCityReport {
  /** 主数据有没有提供；没提供时下面的匹配结果都是 null，只有待匹配清单 */
  masterProvided: boolean;
  matched: number;
  ambiguous: number;
  unmatched: number;
  /** 不是地点的端点（机场、车站、码头）不和城市比 */
  notCompared: number;
  endpoints: (PriceSheetEndpointEntry & { match: PriceSheetCityMatch | null })[];
}

export interface PriceSheetReportItem {
  id: string;
  title: string;
  scope: PriceSheetScope;
  count: number;
  note: string;
}

export interface PriceSheetReport {
  /** 这份报告不写任何业务数据；只有 dry-run 一种模式 */
  mode: "dry_run";
  totals: PriceSheetClassStats & { classes: Record<PriceSheetRouteClass, PriceSheetClassStats> };
  countries: PriceSheetCountryReport[];
  cities: PriceSheetCityReport;
  vehicles: PriceSheetVehicleAnalysis;
  existingVehicleCodes: { codes: string[]; source: "master" | "assumed" };
  mileage: PriceSheetMileageAnalysis;
  /** 同一个端点对出现在几个 sheet 里 */
  crossSheetRoutes: { count: number; differingPrices: number; examples: { from: string; to: string; sheets: string[]; differing: boolean }[] };
  /** 同一个端点名出现在几个 sheet 里（比如中国大陆的表里有香港的地点） */
  crossSheetEndpoints: { name: string; sheets: string[]; routes: number }[];
  items: PriceSheetReportItem[];
  issues: PriceSheetIssue[];
}

const emptyStats = (): PriceSheetClassStats => ({ routes: 0, pricedCells: 0, emptyCells: 0, invalidCells: 0 });

function addRoute(stats: PriceSheetClassStats, route: PriceSheetRoute): void {
  stats.routes += 1;
  const priced = route.prices.filter((price) => price !== null).length;
  stats.pricedCells += priced;
  stats.invalidCells += route.invalidCells;
  stats.emptyCells += route.prices.length - priced - route.invalidCells;
}

const emptyClasses = (): Record<PriceSheetRouteClass, PriceSheetClassStats> => ({ airport_place: emptyStats(), station_pier_other: emptyStats(), airport_airport: emptyStats(), place_place: emptyStats() });

function countryReport(country: PriceSheetCountry, reverseRuleDeclared: boolean): PriceSheetCountryReport {
  const report: PriceSheetCountryReport = {
    sheet: country.sheet,
    countryCode: country.countryCode,
    vehicleColumns: country.columns.length,
    ...emptyStats(),
    classes: emptyClasses(),
    details: [],
    reverse: summarizePriceSheetReverse(analyzePriceSheetReverse(country.routes), reverseRuleDeclared),
    endpoints: { total: 0, byKind: { airport: 0, station: 0, pier: 0, place: 0 } },
  };
  const details = new Map<PriceSheetRouteDetail, PriceSheetClassStats>();
  for (const route of country.routes) {
    const { routeClass, detail } = classifyPriceSheetRoute(route.from, route.to);
    addRoute(report, route);
    addRoute(report.classes[routeClass], route);
    const stats = details.get(detail) ?? emptyStats();
    addRoute(stats, route);
    details.set(detail, stats);
  }
  report.details = [...details].map(([detail, stats]) => ({ detail, title: PRICE_SHEET_ROUTE_DETAILS[detail].title, scope: PRICE_SHEET_ROUTE_DETAILS[detail].scope, note: PRICE_SHEET_ROUTE_DETAILS[detail].note, stats }));
  const endpoints = priceSheetEndpoints(country);
  report.endpoints.total = endpoints.length;
  for (const endpoint of endpoints) report.endpoints.byKind[endpoint.kind] += 1;
  return report;
}

function crossSheetEndpoints(book: ParsedPriceWorkbook): PriceSheetReport["crossSheetEndpoints"] {
  const seen = new Map<string, { name: string; sheets: string[]; routes: number }>();
  for (const country of book.countries) {
    for (const endpoint of priceSheetEndpoints(country)) {
      const entry = seen.get(endpoint.normalized) ?? { name: endpoint.name, sheets: [], routes: 0 };
      entry.sheets.push(country.sheet);
      entry.routes += endpoint.routes;
      seen.set(endpoint.normalized, entry);
    }
  }
  return [...seen.values()].filter((entry) => entry.sheets.length > 1);
}

function crossSheetRoutes(book: ParsedPriceWorkbook): PriceSheetReport["crossSheetRoutes"] {
  const seen = new Map<string, { from: string; to: string; entries: { sheet: string; prices: Map<string, number> }[] }>();
  for (const country of book.countries) {
    for (const route of country.routes) {
      const a = normalizePriceSheetName(route.from);
      const b = normalizePriceSheetName(route.to);
      const key = JSON.stringify(a <= b ? [a, b] : [b, a]);
      const prices = new Map<string, number>();
      const counts = new Map<string, number>();
      for (const column of country.columns) counts.set(column.name, (counts.get(column.name) ?? 0) + 1);
      country.columns.forEach((column, index) => {
        const price = route.prices[index] ?? null;
        if (price !== null && counts.get(column.name) === 1) prices.set(column.name, price);
      });
      let entry = seen.get(key);
      if (!entry) {
        entry = { from: route.from, to: route.to, entries: [] };
        seen.set(key, entry);
      }
      entry.entries.push({ sheet: country.sheet, prices });
    }
  }
  const result: PriceSheetReport["crossSheetRoutes"] = { count: 0, differingPrices: 0, examples: [] };
  for (const entry of seen.values()) {
    const sheets = [...new Set(entry.entries.map((item) => item.sheet))];
    if (sheets.length < 2) continue;
    const first = entry.entries.find((item) => item.sheet === sheets[0]) as (typeof entry.entries)[number];
    const second = entry.entries.find((item) => item.sheet === sheets[1]) as (typeof entry.entries)[number];
    const differing = [...first.prices].some(([name, price]) => second.prices.has(name) && second.prices.get(name) !== price);
    result.count += 1;
    if (differing) result.differingPrices += 1;
    if (result.examples.length < PRICE_SHEET_EXAMPLE_LIMIT) result.examples.push({ from: entry.from, to: entry.to, sheets, differing });
  }
  return result;
}

/** 现有车型组：主数据没提供时用任务当时的现状，报告里标明没有核对。 */
const ASSUMED_VEHICLE_CODES = ["VG-ECO-7"];

/** 汇总成一份报告。纯函数：同样的输入得到同样的输出。 */
export function buildPriceSheetReport(book: ParsedPriceWorkbook, master: PriceSheetMaster | null): PriceSheetReport {
  const countries = book.countries.map((country) => countryReport(country, book.notes.reverseSamePrice));
  const totals = { ...emptyStats(), classes: emptyClasses() };
  for (const country of countries) {
    for (const key of ["routes", "pricedCells", "emptyCells", "invalidCells"] as const) {
      totals[key] += country[key];
      for (const routeClass of PRICE_SHEET_ROUTE_CLASSES) totals.classes[routeClass][key] += country.classes[routeClass][key];
    }
  }

  const endpoints = book.countries.flatMap((country) => priceSheetEndpoints(country));
  const cities: PriceSheetCityReport = { masterProvided: master !== null, matched: 0, ambiguous: 0, unmatched: 0, notCompared: 0, endpoints: [] };
  for (const endpoint of endpoints) {
    let match: PriceSheetCityMatch | null = null;
    if (endpoint.kind !== "place") cities.notCompared += 1;
    else if (master !== null) {
      match = matchPriceSheetCity(endpoint.normalized, endpoint.countryCode, master.cities);
      cities[match.status] += 1;
    }
    cities.endpoints.push({ ...endpoint, match });
  }

  const existingCodes = master?.vehicleGroupCodes ?? ASSUMED_VEHICLE_CODES;
  const vehicles = analyzeVehicles(book, existingCodes);
  const mileage = analyzeMileage(book);
  const cross = crossSheetRoutes(book);
  const sharedEndpoints = crossSheetEndpoints(book);
  const suspects = endpoints.filter((endpoint) => endpoint.suspicion !== null);

  const sumDetail = (detail: PriceSheetRouteDetail): number => countries.reduce((sum, country) => sum + (country.details.find((entry) => entry.detail === detail)?.stats.routes ?? 0), 0);
  const items: PriceSheetReportItem[] = (Object.keys(PRICE_SHEET_ROUTE_DETAILS) as PriceSheetRouteDetail[]).flatMap((detail) => {
    const count = sumDetail(detail);
    const definition = PRICE_SHEET_ROUTE_DETAILS[detail];
    return count === 0 ? [] : [{ id: `route.${detail}`, title: `路线：${definition.title}`, scope: definition.scope, count, note: definition.note }];
  });
  const sumReverse = (key: "transferBothRules" | "transferPickupRules" | "transferDropoffRules" | "transferOneSidedCells" | "pointToPointUnexpressible"): number => countries.reduce((sum, country) => sum + country.reverse[key], 0);
  const placeEndpoints = endpoints.filter((endpoint) => endpoint.kind === "place").length;
  items.push(
    { id: "reverse.both", title: "反向价：可映射成 direction=both 的价格条数", scope: book.notes.reverseSamePrice ? "in_framework" : "owner_confirm", count: sumReverse("transferBothRules"), note: book.notes.reverseSamePrice ? "说明页写明未列出的反向同价" : "说明页没有写反向同价的规则" },
    { id: "reverse.directional", title: "反向价：可映射成 pickup + dropoff 的价格条数", scope: "in_framework", count: sumReverse("transferPickupRules") + sumReverse("transferDropoffRules"), note: "两个方向都列且价不同的接送机" },
    { id: "reverse.one_sided", title: "反向价：两个方向都列、但这个车型只有一个方向有价", scope: "owner_confirm", count: sumReverse("transferOneSidedCells"), note: "反向同价的规则说的是「未列出的路线」，这种情况是另一方向不卖还是同价要确认" },
    { id: "reverse.p2p", title: "反向价：点对点无法表达的端点对", scope: "out_of_framework", count: sumReverse("pointToPointUnexpressible"), note: "点对点的价没有方向，也没有起终点" },
    { id: "area.shapes", title: "区域图形：表里的地点没有图形", scope: "owner_confirm", count: placeEndpoints, note: "价格挂在区域上，区域必须有营运区图形（ADR 0015）；表里只有名字。要决定图形从哪里来" },
    { id: "area.cross_city", title: "跨城路线：接送点和区域必须属于同一城市", scope: "owner_confirm", count: sumDetail("airport_place") + sumDetail("station_place"), note: "商品的接送点、区域都要在商品的城市里（ADR 0016），机场到邻近城市的路线要决定怎么归属。不知道每个端点属于哪个城市前算不出确切数量，这里是上限" },
    { id: "city.master", title: "城市：端点和主数据的匹配", scope: master === null ? "owner_confirm" : "in_framework", count: cities.matched, note: master === null ? "没有提供 --master，只输出待匹配清单" : `匹配 ${cities.matched}，未匹配 ${cities.unmatched}，歧义 ${cities.ambiguous}` },
    { id: "city.unmatched", title: "城市：未匹配和有歧义的端点", scope: "owner_confirm", count: cities.unmatched + cities.ambiguous, note: "不猜测，由人决定" },
    { id: "vehicle.duplicate_columns", title: "车型：同一 sheet 里同名的列（歧义）", scope: "owner_confirm", count: vehicles.duplicateColumns.length, note: "不合并、不覆盖；要决定哪一列是哪个车型" },
    { id: "vehicle.new_groups", title: "车型：现有车型组里没有、要新建的名称", scope: "owner_confirm", count: vehicles.rows.filter((row) => !row.existing).length, note: "建议编码只是建议；车型组由平台创建" },
    { id: "vehicle.grade_unknown", title: "车型：等级对不上现有四级的名称（Premium、Bus、Van、SUV……）", scope: "owner_confirm", count: vehicles.rows.filter((row) => row.grade === null).length, note: "现有等级只有经济、舒适、商务、豪华（ADR 0012）" },
    { id: "vehicle.no_code", title: "车型：给不出建议编码的名称", scope: "owner_confirm", count: vehicles.rows.filter((row) => row.code === null).length, note: "名称里没有座位数等，不猜" },
    { id: "vehicle.capacity_differs", title: "车型：同名不同国家容量不同", scope: "owner_confirm", count: vehicles.rows.filter((row) => row.capacityDiffers).length, note: "车型组可以有多个「人数 / 行李」组合，商品选用其中的（ADR 0016），框架能放下；但要确认是不是同一个车型组" },
    { id: "vehicle.inversions", title: "车型：同级别座位多反而便宜的路线数", scope: "owner_confirm", count: vehicles.inversions.reduce((sum, entry) => sum + entry.routes, 0), note: "只列出，不判断对错" },
    { id: "mileage.mapping", title: "里程价：可映射成 mileage_time 的行", scope: mileage.startKilometers === null ? "owner_confirm" : "in_framework", count: mileage.rows - mileage.incompleteRows, note: mileage.startKilometers === null ? "说明页没有写起步价含多少公里" : "起步里程取说明页的公里数，起步时长和每分钟单价填 0；依赖路线预估（ADR 0018、0020）" },
    { id: "mileage.fallback", title: "里程价：作为「没有固定线路时」的兜底", scope: "owner_confirm", count: mileage.rows, note: "同一组合同一天只能有一条价（ADR 0018），几个区域都能报时取最低（ADR 0020），表里的「兜底」含义框架不能直接表达，要决定怎么挂区域" },
    { id: "mileage.min_above_start", title: "里程价：最低消费高于起步价的行", scope: "owner_confirm", count: mileage.minAboveStart.count, note: "公式能算（取较大值），只列出" },
    { id: "mileage.duplicates", title: "里程价：同一国家同一车型重复的行", scope: "owner_confirm", count: mileage.duplicates.identical + mileage.duplicates.conflicting, note: `完全相同 ${mileage.duplicates.identical}，不一致 ${mileage.duplicates.conflicting}` },
    { id: "endpoint.suspects", title: "端点：算成地点、但名字看着可能不是的", scope: "owner_confirm", count: suspects.length, note: `涉及 ${suspects.reduce((sum, endpoint) => sum + endpoint.routes, 0)} 条路线次；不改分类，由人确认` },
    { id: "cross_sheet.endpoints", title: "同一端点名出现在几个 sheet 里", scope: "owner_confirm", count: sharedEndpoints.length, note: "比如中国大陆的表里有香港的地点；跨境路线一个商品只有一个城市，这些名字属于哪个国家 / 地区、跨境怎么挂要确认" },
    { id: "cross_sheet", title: "同一端点对出现在几个 sheet 里", scope: "owner_confirm", count: cross.count, note: `其中价格不同的 ${cross.differingPrices} 对（只比较名称唯一的车型列）；这些路线归哪个国家、用哪一份价要确认` },
    { id: "price.meaning", title: "价格含义：表里的价是结算价还是对外价", scope: "owner_confirm", count: totals.pricedCells, note: "价格规则存的是供应商结算价，对外价由加价算出（ADR 0020、0023）；表名是「官网」费率。不确认不能写入" },
    { id: "price.currency", title: "币种：全表是日元，路线分布在 10 个国家 / 地区", scope: "owner_confirm", count: totals.pricedCells, note: "金额按子品牌的结算币种存（ADR 0016），要决定挂在哪个租户、哪个子品牌" },
    { id: "price.valid_from", title: "生效日期：表里没有", scope: "owner_confirm", count: totals.pricedCells, note: "价格规则的开始日期必填（ADR 0018）" },
  );

  return {
    mode: "dry_run",
    totals,
    countries,
    cities,
    vehicles,
    existingVehicleCodes: { codes: [...existingCodes], source: master?.vehicleGroupCodes ? "master" : "assumed" },
    mileage,
    crossSheetRoutes: cross,
    crossSheetEndpoints: sharedEndpoints,
    items,
    issues: book.issues,
  };
}

// ---- Markdown ----

/** 表里的文字放进 Markdown：去控制字符，转义表格和 HTML 用到的符号。 */
export function escapePriceSheetText(text: string): string {
  return text
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\\/g, "\\\\")
    .replace(/[|`*_[\]]/g, (mark) => `\\${mark}`);
}

const table = (head: readonly string[], rows: readonly (readonly (string | number)[])[]): string[] => [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rows.map((row) => `| ${row.join(" | ")} |`)];
const scopeName = (scope: PriceSheetScope): string => PRICE_SHEET_SCOPE_NAMES[scope];
const groupNames: Readonly<Record<PriceSheetReversePair["group"], string>> = { transfer: "接送机", conditional: "车站 / 码头（待定）", point_to_point: "点对点" };

/** 只读报告的 Markdown。文件信息（文件名、sha256、大小、时间）由调用方给出。 */
export function renderPriceSheetMarkdown(report: PriceSheetReport, file: { name: string; sha256: string; bytes: number; masterProvided: boolean }): string {
  const e = escapePriceSheetText;
  const lines: string[] = [
    "# 价格表映射报告（第 0 阶段，只读 dry-run）",
    "",
    "本报告没有写任何业务数据。内容含价格举例，属业主的商业数据，不要提交进仓库。",
    "",
    `- 文件：${e(file.name)}（${file.bytes} 字节）`,
    `- sha256：${file.sha256}`,
    `- 主数据：${file.masterProvided ? "已提供 --master" : "没有提供，城市只有待匹配清单"}`,
    "",
    "## 合计",
    "",
    ...table(
      ["分类", "路线", "有价的格", "空的格", "不合规的格"],
      [...PRICE_SHEET_ROUTE_CLASSES.map((routeClass) => [PRICE_SHEET_ROUTE_CLASS_NAMES[routeClass], report.totals.classes[routeClass].routes, report.totals.classes[routeClass].pricedCells, report.totals.classes[routeClass].emptyCells, report.totals.classes[routeClass].invalidCells]), ["合计", report.totals.routes, report.totals.pricedCells, report.totals.emptyCells, report.totals.invalidCells]],
    ),
    "",
    "机场、车站、码头都按名称里明确的字判断，判断不了的算地点。大类先看机场：一端是机场、另一端不是的都归「机场↔非机场」，其中机场↔车站、机场↔码头的结论不同，看下面的「路线种类」。",
    "",
    "## 逐项结论",
    "",
    ...table(["项目", "数量", "结论", "说明"], report.items.map((item) => [e(item.title), item.count, scopeName(item.scope), e(item.note)])),
    "",
    "## 分国家",
    "",
  ];
  for (const country of report.countries) {
    lines.push(`### ${e(country.sheet)}（${country.countryCode}）`, "", `路线 ${country.routes}，车型列 ${country.vehicleColumns}，有价 ${country.pricedCells}，空 ${country.emptyCells}，不合规 ${country.invalidCells}；端点 ${country.endpoints.total}（机场 ${country.endpoints.byKind.airport}、车站 ${country.endpoints.byKind.station}、码头 ${country.endpoints.byKind.pier}、地点 ${country.endpoints.byKind.place}）`, "");
    lines.push(...table(["路线种类", "路线", "有价", "空", "结论", "说明"], country.details.map((detail) => [detail.title, detail.stats.routes, detail.stats.pricedCells, detail.stats.emptyCells, scopeName(detail.scope), e(detail.note)])), "");
    lines.push(...table(["反向价", "归属", "端点对", "结论"], country.reverse.pairs.map((pair) => [PRICE_SHEET_REVERSE_NAMES[pair.kind], groupNames[pair.group], pair.count, scopeName(pair.scope)])), "");
    lines.push(`接送机可映射：通用 ${country.reverse.transferBothRules} 条，接机 ${country.reverse.transferPickupRules} 条，送机 ${country.reverse.transferDropoffRules} 条；只有一个方向有价的 ${country.reverse.transferOneSidedCells} 格；点对点无法表达 ${country.reverse.pointToPointUnexpressible} 对。`, "");
  }

  lines.push("## 城市", "");
  if (report.cities.masterProvided) lines.push(`匹配 ${report.cities.matched}，歧义 ${report.cities.ambiguous}，未匹配 ${report.cities.unmatched}；机场、车站、码头 ${report.cities.notCompared} 个不和城市比较。`, "");
  else lines.push(`没有提供 --master：下面是归一化后的待匹配清单。机场、车站、码头 ${report.cities.notCompared} 个不和城市比较。`, "");
  lines.push("归一化只统一全半角、空白和大小写，不做繁简转换，不拆分，不去后缀；名字完全相同才算匹配。", "");
  const matchText = (match: PriceSheetCityMatch | null): string => {
    if (match === null) return "待匹配";
    if (match.status === "matched") return `匹配 ${e(match.code)}（${e(match.cityStatus)}）`;
    return match.status === "ambiguous" ? `歧义：${match.codes.map(e).join("、")}` : "未匹配";
  };
  const placeRows = report.cities.endpoints.filter((endpoint) => endpoint.kind === "place");
  lines.push(...table(["国家", "原名", "归一化", "可能是几个地方", "存疑", "路线", "结果"], placeRows.map((endpoint) => [e(endpoint.sheet), e(endpoint.name), e(endpoint.normalized), endpoint.composite ? "是" : "", endpoint.suspicion ?? "", endpoint.routes, matchText(endpoint.match)])), "");

  const vehicles = report.vehicles;
  lines.push("## 车型", "", `共 ${vehicles.rows.length} 个名称。现有车型组：${report.existingVehicleCodes.codes.map(e).join("、") || "无"}（${report.existingVehicleCodes.source === "master" ? "来自 --master" : "没有提供 --master，未核对"}）。`, "");
  lines.push(
    ...table(
      ["名称", "建议编码", "现有等级", "已有", "容量", "国家数", "结论"],
      vehicles.rows.map((row) => [e(row.name), row.code ?? `无（${e(row.codeProblem ?? "")}）`, row.grade ?? "对不上", row.existing ? "是" : "", row.capacities.map((entry) => `${e(entry.capacity)}（${entry.sheets.length}）`).join("、"), row.countries.length, scopeName(row.scope)]),
    ),
    "",
  );
  if (vehicles.duplicateColumns.length > 0) {
    lines.push("### 同名的车型列（歧义，不合并、不覆盖）", "");
    lines.push(...table(["sheet", "名称", "列", "容量相同", "两列都有价的行", "其中价格不同"], vehicles.duplicateColumns.map((entry) => [e(entry.sheet), e(entry.name), entry.refs.map(e).join("、"), entry.sameCapacity ? "是" : "否", entry.rowsBothPriced, entry.rowsDiffering])), "");
  }
  if (vehicles.duplicateEntries.length > 0) {
    lines.push("### 车型表里同一国家重复的车型", "");
    lines.push(...table(["国家", "名称", "行", "代表车型", "容量相同"], vehicles.duplicateEntries.map((entry) => [e(entry.sheet), e(entry.name), entry.rows.join("、"), entry.sampleModels.map(e).join(" / "), entry.sameCapacity ? "是" : "否"])), "");
  }
  if (vehicles.caseVariants.length > 0) lines.push(`只差大小写的名称：${vehicles.caseVariants.map((list) => list.map(e).join(" = ")).join("；")}`, "");
  if (vehicles.codeCollisions.length > 0) lines.push(`给出同一编码的名称：${vehicles.codeCollisions.map((entry) => `${entry.code}（${entry.names.map(e).join("、")}）`).join("；")}`, "");
  lines.push(`路线表容量和车型表不一致 ${vehicles.capacityMismatches.length} 列；路线表有、车型表没有 ${vehicles.missingFromVehicleSheet.length} 列；车型表有、路线表没有 ${vehicles.missingFromRouteSheet.length} 个。`, "");
  lines.push("### 同级别座位多反而便宜（只列数量和前几例，不判断对错）", "");
  lines.push(...table(["sheet", "路线数", "比较数"], vehicles.inversions.map((entry) => [e(entry.sheet), entry.routes, entry.comparisons])), "");
  const examples = vehicles.inversions.flatMap((entry) => entry.examples);
  if (examples.length > 0) lines.push(...table(["路线", "座位少", "座位多"], examples.map((example) => [`${e(example.from)} → ${e(example.to)}`, `${e(example.fewer.name)}：${example.fewer.price}`, `${e(example.more.name)}：${example.more.price}`])), "");

  const mileage = report.mileage;
  lines.push("## 里程价", "", `共 ${mileage.rows} 行，缺起步价或每公里的 ${mileage.incompleteRows} 行；说明页写的起步公里数：${mileage.startKilometers ?? "没有写"}。`, "");
  lines.push(`来源：${mileage.bySource.map((entry) => `${e(entry.source) || "（空）"} ${entry.rows}`).join("、")}。国家：${mileage.byCountry.map((entry) => `${e(entry.sheet)} ${entry.rows}`).join("、")}。`, "");
  lines.push(`最低消费高于起步价 ${mileage.minAboveStart.count} 行；重复行：完全相同 ${mileage.duplicates.identical} 组，不一致 ${mileage.duplicates.conflicting} 组；同级别座位多起步价反而低 ${mileage.inversions.count} 对；车型表里没有的车型 ${mileage.unknownVehicles.length} 个。`, "");
  if (mileage.minAboveStart.examples.length > 0) lines.push(...table(["国家", "车型", "起步价", "最低消费"], mileage.minAboveStart.examples.map((example) => [e(example.sheet), e(example.name), example.startPrice, example.minPrice])), "");
  if (mileage.duplicates.examples.length > 0) lines.push(...table(["国家", "车型", "行", "不一致"], mileage.duplicates.examples.map((example) => [e(example.sheet), e(example.name), example.rows.join("、"), example.conflicting ? "是" : "否"])), "");
  if (mileage.inversions.examples.length > 0) lines.push(...table(["国家", "座位少", "起步价", "座位多", "起步价"], mileage.inversions.examples.map((example) => [e(example.sheet), e(example.fewer), example.fewerStart, e(example.more), example.moreStart])), "");

  lines.push("## 跨 sheet 重复的路线", "", `${report.crossSheetRoutes.count} 对，其中价格不同 ${report.crossSheetRoutes.differingPrices} 对（前几例）。`, "");
  if (report.crossSheetRoutes.examples.length > 0) lines.push(...table(["路线", "sheet", "价格不同"], report.crossSheetRoutes.examples.map((example) => [`${e(example.from)} ↔ ${e(example.to)}`, example.sheets.map(e).join("、"), example.differing ? "是" : "否"])), "");

  lines.push("## 跨 sheet 重复的端点名", "", `${report.crossSheetEndpoints.length} 个。`, "");
  if (report.crossSheetEndpoints.length > 0) lines.push(...table(["名称", "sheet", "路线次"], report.crossSheetEndpoints.map((entry) => [e(entry.name), entry.sheets.map(e).join("、"), entry.routes])), "");

  lines.push("## 解析问题", "");
  if (report.issues.length === 0) lines.push("没有。", "");
  else lines.push(...table(["问题", "位置", "说明"], report.issues.map((issue) => [issue.code, e(issue.where), e(issue.detail)])), "");
  return `${lines.join("\n")}\n`;
}
