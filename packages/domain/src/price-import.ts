/**
 * 价格表导入第 1 阶段（ADR 0062，M4-28）：把第 0 阶段解析出来的价格表变成「要建哪些区域、商品、价格规则」，
 * 并把表上的客人价（官网原价）倒算成供应商结算价。这里全是纯函数：不碰文件、网络和数据库。
 *
 * - 倒算不另写一套公式：每个候选结算价都用报价引擎同一个 `sellPrice`（和子品牌取整的 `roundToUnit`）正向算一遍显示价，
 *   在结算价上二分查找。对不上的不硬凑（不加调价规则、不改取整），取显示价不超过表上价的那一档，列出差额和原因。
 * - 范围只有一种：机场↔地区（ADR 0059 补记的决定 D）。滑雪场、港口、码头不导；不在映射里的、映射成待定的也不导，各有原因。
 * - 机场归哪个城市（商品的城市）只决定商品和区域挂在哪里，不参与任何价格的计算（业主的要求，测试固定）。
 * 表里的名字只当数据，放进 Map，不当对象的键。
 */
import { AREA_LIMITS } from "./areas.ts";
import { type MarkupRule, markupLevelOf, resolveMarkup } from "./channels.ts";
import { type CurrencyCode, isCurrencyCode, roundToUnit } from "./money.ts";
import { isLatitude, isLongitude } from "./master-data.ts";
import { type PriceSheetCapacity, type PriceSheetCountry, type PriceSheetNotes, classifyPriceSheetRoute, normalizePriceSheetName, suggestPriceSheetVehicleCode } from "./price-sheet.ts";
import { PRICE_LIMITS, type PriceDirection } from "./pricing.ts";
import { QUOTE_RULES, sellPrice } from "./quote.ts";

export type PriceImportErrorCode = "BAD_MAPPING" | "BAD_TARGET" | "CURRENCY_MISMATCH";

/** 输入文件的写法不对、或者条件不满足：整批不做。 */
export class PriceImportError extends Error {
  readonly code: PriceImportErrorCode;
  constructor(code: PriceImportErrorCode, message: string) {
    super(message);
    this.name = "PriceImportError";
    this.code = code;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isSafePositive = (value: number): boolean => Number.isSafeInteger(value) && value > 0;

// ---- 官网显示价：正向 ----

/**
 * 算官网显示价要的全部参数。子品牌、渠道、客人支付的币种必须相同（跨币种的显示价随汇率每天变，倒算没有意义）。
 * `markupBp` 是按渠道五级规则匹配出来的加价比例（`resolveMarkup`），下限在这里再套一次，和报价引擎一致。
 */
export interface SitePriceRules {
  /** 子品牌的结算币种 */
  currency: CurrencyCode;
  /** 渠道的结算币种 = 官网客人支付的币种；不给时和子品牌相同 */
  channelCurrency?: CurrencyCode;
  brandRoundingUnit: number;
  markupBp: number;
  markupFloorBp: number;
  /** 渠道的最低毛利（渠道结算币种的最小单位）；0 = 不设 */
  minMarginMinor: number;
  /** 渠道对外价的取整单位（客人支付币种）；1 = 四舍五入到最小单位，大于 1 向上取整 */
  sellRoundingUnit: number;
}

/**
 * 价格规则的一口价 `baseMinor`、没有调价规则和加急 / 夜间 / 附加服务时，官网显示的价格（报价引擎第 7、11 步）：
 * 结算价 = 一口价按子品牌取整单位取整；显示价 = `sellPrice`（加价、下限、最低毛利、渠道取整）。结算价不大于 0 时报不出，返回 null。
 */
export function siteDisplayPrice(baseMinor: number, rules: SitePriceRules): { settlementMinor: number; displayMinor: number } | null {
  const channelCurrency = rules.channelCurrency ?? rules.currency;
  if (channelCurrency !== rules.currency) throw new PriceImportError("CURRENCY_MISMATCH", `子品牌的币种（${rules.currency}）和官网渠道的币种（${channelCurrency}）不同，显示价随汇率变，不能倒算`);
  const settlementMinor = roundToUnit(baseMinor, rules.brandRoundingUnit);
  if (settlementMinor <= 0) return null;
  const sell = sellPrice({
    settlementMinor,
    settlementCurrency: rules.currency,
    currency: channelCurrency,
    markupBp: rules.markupBp,
    markupFloorBp: rules.markupFloorBp,
    fx: null,
    channel: { roundingUnit: rules.sellRoundingUnit, minMargin: rules.minMarginMinor === 0 ? null : { minor: rules.minMarginMinor, currency: channelCurrency, fx: null } },
  });
  if ("failure" in sell) return null;
  return { settlementMinor, displayMinor: sell.sellMinor };
}

// ---- 官网显示价：倒算 ----

export type InverseStatus = "exact" | "below" | "impossible";
/**
 * 对不上的原因：
 * - SELL_ROUNDING：渠道把对外价向上取整到某个单位，表上价不是这个单位的倍数；
 * - BRAND_ROUNDING：子品牌的结算价按取整单位取整，相邻两档结算价的显示价跨过了表上价；
 * - MARKUP_STEP：结算价每加 1 个最小单位，显示价加 (1 + 加价比例) 个，中间有显示价是跳过去的；
 * - BELOW_MINIMUM：表上价比最小的结算价（1 个取整单位）的显示价还低（通常是最低毛利比表上价还高）。
 */
export type InverseReason = "SELL_ROUNDING" | "BRAND_ROUNDING" | "MARKUP_STEP" | "BELOW_MINIMUM";

export interface InverseResult {
  targetMinor: number;
  status: InverseStatus;
  /** 要写进价格规则的一口价（= 结算价）；报不出时 null */
  baseMinor: number | null;
  /** 正向算出的官网显示价 */
  displayMinor: number | null;
  /** 显示价 − 表上价；对上时 0，对不上时是负数（只往下取，不让客人多付） */
  diffMinor: number | null;
  reason: InverseReason | null;
  /** 对不上时，下一档结算价和它的显示价（比表上价高） */
  next: { baseMinor: number; displayMinor: number } | null;
}

/**
 * 倒算：找显示价不超过表上价的最大结算价（取整单位的倍数）。显示价随结算价单调不减，所以二分查找。
 * - 正好等于表上价：`exact`。同一个显示价对应一段结算价时取最大的——实际加价最接近渠道设定的比例；
 * - 没有正好等于的：`below`，取低一档（显示价比表上价低），`next` 是高一档，原因见 `InverseReason`；
 * - 连最小的结算价都超过表上价：`impossible`，不导入。
 */
export function inverseSitePrice(targetMinor: number, rules: SitePriceRules): InverseResult {
  if (!isSafePositive(targetMinor) || targetMinor > PRICE_LIMITS.maxAmountMinor) throw new RangeError(`表上价必须是正整数（最小货币单位），不超过 ${PRICE_LIMITS.maxAmountMinor}：${targetMinor}`);
  const unit = rules.brandRoundingUnit;
  const display = (steps: number): number => siteDisplayPrice(steps * unit, rules)?.displayMinor ?? Number.POSITIVE_INFINITY;
  // 显示价不低于结算价（加价不为负），所以结算价不超过表上价
  let low = 0;
  let high = Math.floor(targetMinor / unit);
  if (high === 0 || display(1) > targetMinor) {
    return { targetMinor, status: "impossible", baseMinor: null, displayMinor: null, diffMinor: null, reason: "BELOW_MINIMUM", next: high === 0 ? null : { baseMinor: unit, displayMinor: display(1) } };
  }
  low = 1;
  while (low < high) {
    const middle = low + Math.ceil((high - low) / 2);
    if (display(middle) <= targetMinor) low = middle;
    else high = middle - 1;
  }
  const baseMinor = low * unit;
  const displayMinor = display(low);
  if (displayMinor === targetMinor) return { targetMinor, status: "exact", baseMinor, displayMinor, diffMinor: 0, reason: null, next: null };
  const reason: InverseReason = rules.sellRoundingUnit > 1 && targetMinor % rules.sellRoundingUnit !== 0 ? "SELL_ROUNDING" : unit > 1 ? "BRAND_ROUNDING" : "MARKUP_STEP";
  return { targetMinor, status: "below", baseMinor, displayMinor, diffMinor: displayMinor - targetMinor, reason, next: { baseMinor: baseMinor + unit, displayMinor: display(low + 1) } };
}

export const INVERSE_REASON_NAMES: Readonly<Record<InverseReason, string>> = {
  SELL_ROUNDING: "官网把对外价向上取整到固定单位，表上价不是这个单位的倍数",
  BRAND_ROUNDING: "子品牌的结算价按取整单位取整，相邻两档的显示价跨过了表上价",
  MARKUP_STEP: "结算价每加 1 日元显示价加（1 + 加价比例）日元，表上价正好落在跳过去的那个数上",
  BELOW_MINIMUM: "表上价比最低能报的价还低（通常是最低毛利比表上价高）",
};

// ---- 范围 ----

export type PriceImportExclusion = "SKI_RESORT" | "PORT";

/** 决定 E：滑雪场、码头暂不导。以「港」结尾的（空港、香港除外）按港口算，和码头、邮轮一样不导——宁可少导，确认后再补。 */
export function priceImportExclusion(name: string): PriceImportExclusion | null {
  const text = normalizePriceSheetName(name);
  if (/滑雪|スキー/.test(text)) return "SKI_RESORT";
  if (/码头|碼頭|邮轮|郵輪|游轮|遊輪|港口|ふ頭|埠頭/.test(text)) return "PORT";
  if (text.endsWith("港") && !text.endsWith("空港") && !text.endsWith("香港")) return "PORT";
  return null;
}

// ---- 映射 ----

export interface PriceImportRegion {
  lat: number;
  lng: number;
  radiusM: number;
}

/** 表里的名字 → 平台里的东西。值是 null 的明确不导（待定、不卖）；没写进来的也不导，原因不同。 */
export interface PriceImportMapping {
  /** 表里的机场名 → IATA 三字码 */
  airports: ReadonlyMap<string, string | null>;
  /** 表里的地区名 → 中心点 + 半径 */
  regions: ReadonlyMap<string, PriceImportRegion | null>;
  /** 表里的车型列名 → 车型组编码 */
  vehicles: ReadonlyMap<string, string | null>;
}

const IATA = /^[A-Z]{3}$/;
const VEHICLE_CODE = /^VG-[A-Z0-9]{1,20}-[0-9]{1,2}$/;
const REGION_KEYS = new Set(["lat", "lng", "radius_m", "source", "note"]);

function entriesOf(input: unknown, what: string): [string, unknown][] {
  if (!isRecord(input)) throw new PriceImportError("BAD_MAPPING", `映射文件的 ${what} 要是对象`);
  return Object.entries(input);
}

/**
 * 映射文件：`{ "airports": { 表里的机场名: "NRT" | null }, "regions": { 表里的地区名: { "lat", "lng", "radius_m", "source"?, "note"? } | null }, "vehicles": { 车型列名: "VG-ECO-5" | null } }`。
 * 写法不对整份拒绝（跳过会让导入的东西悄悄变少）。半径的范围和区域的圆一样（ADR 0015）。
 */
export function parsePriceImportMapping(input: unknown): PriceImportMapping {
  const bad = (what: string): PriceImportError => new PriceImportError("BAD_MAPPING", `映射文件的写法不对：${what}`);
  if (!isRecord(input)) throw bad("最外层要是对象");
  const extra = Object.keys(input).filter((key) => !["airports", "regions", "vehicles"].includes(key));
  if (extra.length > 0) throw bad(`不认识的键 ${extra.join("、")}`);
  const airports = new Map<string, string | null>();
  for (const [name, code] of entriesOf(input.airports, "airports")) {
    if (code !== null && (typeof code !== "string" || !IATA.test(code))) throw bad(`机场「${name}」要写三位大写字母的 IATA 码或 null`);
    airports.set(name, code);
  }
  const regions = new Map<string, PriceImportRegion | null>();
  for (const [name, value] of entriesOf(input.regions, "regions")) {
    if (value === null) {
      regions.set(name, null);
      continue;
    }
    if (!isRecord(value) || Object.keys(value).some((key) => !REGION_KEYS.has(key))) throw bad(`地区「${name}」只能有 lat、lng、radius_m、source、note`);
    const { lat, lng, radius_m: radiusM } = value;
    if (typeof lat !== "number" || typeof lng !== "number" || !isLatitude(lat) || !isLongitude(lng)) throw bad(`地区「${name}」的坐标不合法`);
    if (typeof radiusM !== "number" || !Number.isInteger(radiusM) || radiusM < AREA_LIMITS.minRadiusM || radiusM > AREA_LIMITS.maxRadiusM) {
      throw bad(`地区「${name}」的半径要是 ${AREA_LIMITS.minRadiusM} 到 ${AREA_LIMITS.maxRadiusM} 米的整数`);
    }
    regions.set(name, { lat, lng, radiusM });
  }
  const vehicles = new Map<string, string | null>();
  for (const [name, code] of entriesOf(input.vehicles, "vehicles")) {
    if (code !== null && (typeof code !== "string" || !VEHICLE_CODE.test(code))) throw bad(`车型「${name}」要写车型组编码（VG-等级-座位数）或 null`);
    vehicles.set(name, code);
  }
  return { airports, regions, vehicles };
}

/**
 * 车型列的默认映射：第 0 阶段的建议编码，只给等级在现有四个里的列（Economy、Comfort、Luxury……）。
 * 名字里没有座位数、有不认识的词、等级不在现有四个里的（Premium、Bus、Van、SUV、EV）给不出：
 * 这些归哪个等级、要不要导是业主的决定，必须在映射文件里写明编码或 null（ADR 0062）。
 */
export function defaultPriceImportVehicle(name: string): string | null {
  const suggestion = suggestPriceSheetVehicleCode(name);
  return suggestion.grade === null ? null : suggestion.code;
}

// ---- 计划 ----

export type PriceImportSkipReason =
  | PriceImportExclusion
  | "AIRPORT_UNMAPPED"
  | "AIRPORT_EXCLUDED"
  | "REGION_UNMAPPED"
  | "REGION_PENDING"
  | "VEHICLE_UNMAPPED"
  | "VEHICLE_GRADE_UNSET"
  | "VEHICLE_EXCLUDED"
  | "VEHICLE_CODE_REPEATED"
  | "CAPACITY_UNKNOWN"
  | "DUPLICATE_CONFLICT"
  | "REVERSE_RULE_MISSING";

export const PRICE_IMPORT_SKIP_NAMES: Readonly<Record<PriceImportSkipReason, string>> = {
  SKI_RESORT: "滑雪场，暂不导（决定 E）",
  PORT: "港口 / 码头，暂不导（决定 E）",
  AIRPORT_UNMAPPED: "映射文件里没有这个机场",
  AIRPORT_EXCLUDED: "映射文件把这个机场标为不导",
  REGION_UNMAPPED: "映射文件里没有这个地区",
  REGION_PENDING: "地区范围待定（业主核对后再导）",
  VEHICLE_UNMAPPED: "映射文件里没有这个车型列，名字也给不出建议编码",
  VEHICLE_GRADE_UNSET: "车型列的等级不在现有四个里（Premium、Bus、Van、SUV 等），映射文件没写明编码或 null，不导",
  VEHICLE_EXCLUDED: "映射文件把这个车型列标为不导",
  VEHICLE_CODE_REPEATED: "两个车型列映射到了同一个车型组，后面的不导",
  CAPACITY_UNKNOWN: "车型列的容量读不出来（选车型组的人数 / 行李组合要用）",
  DUPLICATE_CONFLICT: "同一方向重复列了几行、价格不一致，不选其中一行",
  REVERSE_RULE_MISSING: "只列了一个方向，说明页又没写反向同价",
};

/** 一条要导入的价格：机场 × 地区 × 车型列 × 方向。 */
export interface PriceImportCell {
  airport: string;
  iata: string;
  region: string;
  regionShape: PriceImportRegion;
  column: string;
  vehicleGroupCode: string;
  capacity: PriceSheetCapacity;
  direction: PriceDirection;
  sheetPriceMinor: number;
  /** 表里的行号（从 1 数） */
  rows: number[];
  /** 两个方向都列、但这一列只有一个方向有价：原样只导这个方向（决定 C） */
  oneSided: boolean;
}

export interface PriceImportSkip {
  from: string;
  to: string;
  rows: number[];
  /** 整行（整个机场 / 地区）不导时为 null */
  column: string | null;
  reason: PriceImportSkipReason;
}

export interface PriceImportPlan {
  /** 机场↔地区的路线行数（决定 D 的范围） */
  routesInScope: number;
  /** 其中至少导入了一格的行数 */
  routesImported: number;
  cells: PriceImportCell[];
  skips: PriceImportSkip[];
}

interface PairRows {
  airport: string;
  region: string;
  /** 机场 → 地区（接机） */
  pickup: PriceSheetCountry["routes"];
  /** 地区 → 机场（送机） */
  dropoff: PriceSheetCountry["routes"];
}

/** 一个方向的几行在这一列上的价：没有行 `absent`；行里都空 null；几行价不一致 `conflict`。 */
function directionPrice(rows: PriceSheetCountry["routes"], index: number): number | null | "absent" | "conflict" {
  if (rows.length === 0) return "absent";
  const prices = new Set(rows.map((row) => row.prices[index] ?? null));
  if (prices.size > 1) return "conflict";
  return [...prices][0] ?? null;
}

/**
 * 决定 D 的范围（机场↔地区）里，每一格价格导不导、按什么方向导。
 * - 机场在前面的一行是接机（从机场出发），机场在后面的是送机；
 * - 只列一个方向：说明页写了「未列出的反向同价」时是接送通用（`both`），没写就不导；
 * - 两个方向都列：这一列两边同价是通用；不同价拆成接机 + 送机；只有一边有价的原样只导那一边（决定 C，进异常清单）；
 * - 同一方向重复几行、价格不一致：这一列整对不导。
 */
export function planPriceSheetImport(country: PriceSheetCountry, notes: PriceSheetNotes, mapping: PriceImportMapping): PriceImportPlan {
  const pairs = new Map<string, PairRows>();
  let routesInScope = 0;
  for (const route of country.routes) {
    if (classifyPriceSheetRoute(route.from, route.to).detail !== "airport_place") continue;
    routesInScope += 1;
    const airportFirst = /机场|機場|空港/.test(normalizePriceSheetName(route.from));
    const airport = airportFirst ? route.from : route.to;
    const region = airportFirst ? route.to : route.from;
    const key = JSON.stringify([normalizePriceSheetName(airport), normalizePriceSheetName(region)]);
    const pair = pairs.get(key) ?? { airport, region, pickup: [], dropoff: [] };
    (airportFirst ? pair.pickup : pair.dropoff).push(route);
    pairs.set(key, pair);
  }

  // 车型列：映射文件优先，没写的用建议编码；映射到同一个车型组的只取第一列
  const columns = country.columns.map((column) => {
    const mapped = mapping.vehicles.has(column.name) ? mapping.vehicles.get(column.name) : defaultPriceImportVehicle(column.name);
    const unmappedReason: PriceImportSkipReason = suggestPriceSheetVehicleCode(column.name).code !== null ? "VEHICLE_GRADE_UNSET" : "VEHICLE_UNMAPPED";
    const reason: PriceImportSkipReason | null = mapped === undefined ? unmappedReason : mapped === null ? (mapping.vehicles.has(column.name) ? "VEHICLE_EXCLUDED" : unmappedReason) : column.capacity === null ? "CAPACITY_UNKNOWN" : null;
    return { column, code: mapped ?? null, reason: reason as PriceImportSkipReason | null };
  });
  const seenCodes = new Set<string>();
  for (const entry of columns) {
    if (entry.reason !== null || entry.code === null) continue;
    if (seenCodes.has(entry.code)) entry.reason = "VEHICLE_CODE_REPEATED";
    seenCodes.add(entry.code);
  }

  const cells: PriceImportCell[] = [];
  const skips: PriceImportSkip[] = [];
  const imported = new Set<number>();
  for (const pair of pairs.values()) {
    const all = [...pair.pickup, ...pair.dropoff];
    const rowsOf = (list: PriceSheetCountry["routes"]): number[] => list.map((route) => route.row);
    const head = (pair.pickup[0] ?? pair.dropoff[0]) as PriceSheetCountry["routes"][number];
    const skipPair = (reason: PriceImportSkipReason): void => void skips.push({ from: head.from, to: head.to, rows: rowsOf(all), column: null, reason });
    const exclusion = priceImportExclusion(pair.region);
    if (exclusion !== null) {
      skipPair(exclusion);
      continue;
    }
    const iata = mapping.airports.get(pair.airport);
    if (iata === undefined || iata === null) {
      skipPair(iata === null ? "AIRPORT_EXCLUDED" : "AIRPORT_UNMAPPED");
      continue;
    }
    const shape = mapping.regions.get(pair.region);
    if (shape === undefined || shape === null) {
      skipPair(shape === null ? "REGION_PENDING" : "REGION_UNMAPPED");
      continue;
    }
    columns.forEach((entry, index) => {
      const pickup = directionPrice(pair.pickup, index);
      const dropoff = directionPrice(pair.dropoff, index);
      if ((pickup === null || pickup === "absent") && (dropoff === null || dropoff === "absent")) return;
      const skipCell = (reason: PriceImportSkipReason): void => void skips.push({ from: head.from, to: head.to, rows: rowsOf(all), column: entry.column.name, reason });
      if (entry.reason !== null) return skipCell(entry.reason);
      if (pickup === "conflict" || dropoff === "conflict") return skipCell("DUPLICATE_CONFLICT");
      const base = { airport: pair.airport, iata, region: pair.region, regionShape: shape, column: entry.column.name, vehicleGroupCode: entry.code as string, capacity: entry.column.capacity as PriceSheetCapacity };
      const add = (direction: PriceDirection, price: number, rows: PriceSheetCountry["routes"], oneSided: boolean): void => {
        cells.push({ ...base, direction, sheetPriceMinor: price, rows: rowsOf(rows), oneSided });
        for (const row of rows) imported.add(row.row);
      };
      if (pickup === "absent" || dropoff === "absent") {
        if (!notes.reverseSamePrice) return skipCell("REVERSE_RULE_MISSING");
        return add("both", (pickup === "absent" ? dropoff : pickup) as number, all, false);
      }
      if (pickup !== null && dropoff !== null) {
        if (pickup === dropoff) return add("both", pickup, all, false);
        add("pickup", pickup, pair.pickup, false);
        return add("dropoff", dropoff, pair.dropoff, false);
      }
      if (pickup !== null) return add("pickup", pickup, pair.pickup, true);
      return add("dropoff", dropoff as number, pair.dropoff, true);
    });
  }
  return { routesInScope, routesImported: imported.size, cells, skips };
}

// ---- 分组：商品、区域、价格 ----

export interface PriceImportProductPlan {
  iata: string;
  airport: string;
  /** 商品的城市（= 机场在平台主数据里的城市，即机场服务的主要城市） */
  city: string;
  regions: string[];
  vehicles: { code: string; capacity: PriceSheetCapacity }[];
}

export interface PriceImportAreaPlan {
  city: string;
  region: string;
  shape: PriceImportRegion;
}

export interface PriceImportPriceKey {
  iata: string;
  region: string;
  vehicleGroupCode: string;
  direction: PriceDirection;
  sheetPriceMinor: number;
}

/**
 * 按机场分商品：一个机场一个商品，商品的城市是机场所属的城市（`cityOf`）。区域按「城市 × 地区」建：
 * 同一城市的几个机场共用同一个地区的区域；不同城市各建一个（区域只能被同城市的商品选，ADR 0016）。
 * **价格和城市无关**：`prices` 只由机场、地区、车型组、方向、表上价决定。
 */
export function groupPriceImport(cells: readonly PriceImportCell[], cityOf: (iata: string) => string): { products: PriceImportProductPlan[]; areas: PriceImportAreaPlan[]; prices: PriceImportPriceKey[] } {
  const products = new Map<string, PriceImportProductPlan>();
  const areas = new Map<string, PriceImportAreaPlan>();
  const prices: PriceImportPriceKey[] = [];
  for (const cell of cells) {
    const city = cityOf(cell.iata);
    const product = products.get(cell.iata) ?? { iata: cell.iata, airport: cell.airport, city, regions: [], vehicles: [] };
    if (!product.regions.includes(cell.region)) product.regions.push(cell.region);
    if (!product.vehicles.some((vehicle) => vehicle.code === cell.vehicleGroupCode)) product.vehicles.push({ code: cell.vehicleGroupCode, capacity: cell.capacity });
    products.set(cell.iata, product);
    const areaKey = JSON.stringify([city, cell.region]);
    if (!areas.has(areaKey)) areas.set(areaKey, { city, region: cell.region, shape: cell.regionShape });
    prices.push({ iata: cell.iata, region: cell.region, vehicleGroupCode: cell.vehicleGroupCode, direction: cell.direction, sheetPriceMinor: cell.sheetPriceMinor });
  }
  return { products: [...products.values()], areas: [...areas.values()], prices };
}

export interface PricedImportCell extends PriceImportCell {
  rules: SitePriceRules;
  result: InverseResult;
}

/** 每一格按它适用的官网规则（加价比例按渠道的五级规则匹配）倒算。 */
export function pricePriceImportCells(cells: readonly PriceImportCell[], rulesOf: (cell: PriceImportCell) => SitePriceRules): PricedImportCell[] {
  return cells.map((cell) => {
    const rules = rulesOf(cell);
    return { ...cell, rules, result: inverseSitePrice(cell.sheetPriceMinor, rules) };
  });
}

// ---- 异常（决定 C：原样导入，列给业主核对）----

export interface PriceImportAnomalies {
  /** 同一行、同一级别（名称的第一个词），座位多的反而便宜 */
  inversions: { airport: string; region: string; row: number; direction: "pickup" | "dropoff"; fewer: { name: string; seats: number; price: number }; more: { name: string; seats: number; price: number } }[];
  /** 两个方向都列、价格不同（拆成接机 + 送机导入） */
  differentDirections: { airport: string; region: string; column: string; pickup: number; dropoff: number }[];
  /** 两个方向都列、只有一个方向有价（原样只导那个方向） */
  oneSided: { airport: string; region: string; column: string; direction: PriceDirection; price: number }[];
}

export function priceImportAnomalies(country: PriceSheetCountry, plan: PriceImportPlan): PriceImportAnomalies {
  const result: PriceImportAnomalies = { inversions: [], differentDirections: [], oneSided: [] };
  const importedRows = new Set(plan.cells.flatMap((cell) => cell.rows));
  const info = country.columns.map((column) => ({ name: column.name, ...suggestPriceSheetVehicleCode(column.name) }));
  for (const route of country.routes) {
    if (!importedRows.has(route.row)) continue;
    const airportFirst = /机场|機場|空港/.test(normalizePriceSheetName(route.from));
    for (let i = 0; i < info.length; i += 1) {
      const fewer = info[i] as (typeof info)[number];
      const fewerPrice = route.prices[i] ?? null;
      if (fewer.seats === null || fewerPrice === null) continue;
      for (let j = 0; j < info.length; j += 1) {
        const more = info[j] as (typeof info)[number];
        const morePrice = route.prices[j] ?? null;
        if (more.seats === null || morePrice === null || more.level !== fewer.level || more.seats <= fewer.seats || morePrice >= fewerPrice) continue;
        result.inversions.push({
          airport: airportFirst ? route.from : route.to,
          region: airportFirst ? route.to : route.from,
          row: route.row,
          direction: airportFirst ? "pickup" : "dropoff",
          fewer: { name: fewer.name, seats: fewer.seats, price: fewerPrice },
          more: { name: more.name, seats: more.seats, price: morePrice },
        });
      }
    }
  }
  const pickups = new Map<string, PriceImportCell>();
  for (const cell of plan.cells) if (cell.direction === "pickup" && !cell.oneSided) pickups.set(JSON.stringify([cell.iata, cell.region, cell.column]), cell);
  for (const cell of plan.cells) {
    if (cell.oneSided) result.oneSided.push({ airport: cell.airport, region: cell.region, column: cell.column, direction: cell.direction, price: cell.sheetPriceMinor });
    if (cell.direction !== "dropoff" || cell.oneSided) continue;
    const pickup = pickups.get(JSON.stringify([cell.iata, cell.region, cell.column]));
    if (pickup) result.differentDirections.push({ airport: cell.airport, region: cell.region, column: cell.column, pickup: pickup.sheetPriceMinor, dropoff: cell.sheetPriceMinor });
  }
  return result;
}

// ---- 批次 ----

const BATCH = /^[A-Za-z0-9][A-Za-z0-9-]{2,23}$/;

/** 批次号：字母、数字、短横线，3 到 24 位，字母或数字开头。不合规返回原因。 */
export function priceImportBatchIssue(batch: string): string | null {
  return BATCH.test(batch) ? null : "批次号只能用字母、数字和短横线，3 到 24 位，字母或数字开头";
}

/** 这一批的子品牌名：子品牌在同一个供应商下不重名，所以它就是「这一批建过没有」的依据。 */
export function priceImportBrandName(batch: string): string {
  return `价格表导入 ${batch}`;
}

/** 这一批建的区域的营运区图形的备注名（40 个字以内）：撤回时按它认出这一批的区域。 */
export function priceImportBatchLabel(batch: string): string {
  return `价格表导入 ${batch}`;
}

export type PriceImportRevertBlocker = { reason: "PRODUCT_NOT_DRAFT"; id: string } | { reason: "AREA_USED_OUTSIDE_BATCH"; id: string };

/**
 * 撤回一批：删掉这一批子品牌下的全部商品（价格规则随商品删除），再删掉这一批建的区域。
 * 有任何一个商品不是草稿（上过架就可能有订单），或者区域被这一批以外的商品选了（删区域会连带删掉那些商品在这个区域的价格），
 * 整批不动，列出原因。子品牌本身不能删除（ADR 0016：没有删除子品牌），留下一个空的子品牌，再导同一批时接着用。
 */
export function planPriceImportRevert(input: { products: readonly { id: string; status: string }[]; areas: readonly { id: string; usedBy: readonly string[] }[] }):
  | { ok: true; deleteProducts: string[]; deleteAreas: string[] }
  | { ok: false; blockers: PriceImportRevertBlocker[] } {
  const batchProducts = new Set(input.products.map((product) => product.id));
  const blockers: PriceImportRevertBlocker[] = [
    ...input.products.filter((product) => product.status !== "draft").map((product): PriceImportRevertBlocker => ({ reason: "PRODUCT_NOT_DRAFT", id: product.id })),
    ...input.areas.filter((area) => area.usedBy.some((id) => !batchProducts.has(id))).map((area): PriceImportRevertBlocker => ({ reason: "AREA_USED_OUTSIDE_BATCH", id: area.id })),
  ];
  if (blockers.length > 0) return { ok: false, blockers };
  return { ok: true, deleteProducts: input.products.map((product) => product.id), deleteAreas: input.areas.map((area) => area.id) };
}

// ---- 目标环境 ----

export interface PriceImportTarget {
  tenant: { id: string; name: string; status: string };
  channel: { id: string; name: string; settleCurrency: CurrencyCode; defaultMarkupBp: number; markupFloorBp: number; minMarginMinor: number; sellRounding: ReadonlyMap<string, number> };
  markupRules: MarkupRule[];
  cities: { id: string; code: string; status: string; name: Record<string, string> }[];
  places: { id: string; code: string; type: string; status: string; cityId: string | null; name: Record<string, string> }[];
  vehicleGroups: { id: string; code: string; status: string; combos: PriceSheetCapacity[] }[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 目标环境（租户、官网渠道的定价参数和加价规则、城市、机场、车型组）的只读导出。字段名和表的列名一致；
 * 命令行连数据库时读的是同样的内容（`apps/api/src/services/price-import.ts`）。写法不对整份拒绝。
 */
export function parsePriceImportTarget(input: unknown): PriceImportTarget {
  const bad = (what: string): PriceImportError => new PriceImportError("BAD_TARGET", `目标环境的导出写法不对：${what}`);
  const record = (value: unknown, what: string): Record<string, unknown> => {
    if (!isRecord(value)) throw bad(`${what} 要是对象`);
    return value;
  };
  const list = (value: unknown, what: string): unknown[] => {
    if (!Array.isArray(value)) throw bad(`${what} 要是数组`);
    return value;
  };
  const id = (value: unknown, what: string): string => {
    if (typeof value !== "string" || !UUID.test(value.toLowerCase())) throw bad(`${what} 要是 UUID`);
    return value.toLowerCase();
  };
  const optionalId = (value: unknown, what: string): string | null => (value === null ? null : id(value, what));
  const text = (value: unknown, what: string): string => {
    if (typeof value !== "string") throw bad(`${what} 要是文字`);
    return value;
  };
  const whole = (value: unknown, what: string): number => {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw bad(`${what} 要是不小于 0 的整数`);
    return value;
  };
  const names = (value: unknown, what: string): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [language, name] of Object.entries(record(value, what))) out[language] = text(name, what);
    return out;
  };
  const date = (value: unknown, what: string): string | null => {
    if (value === null) return null;
    if (typeof value !== "string" || !DATE.test(value)) throw bad(`${what} 要是 YYYY-MM-DD 或 null`);
    return value;
  };

  const root = record(input, "最外层");
  const tenant = record(root.tenant, "tenant");
  const channel = record(root.channel, "channel");
  const currency = text(channel.settle_currency, "channel.settle_currency");
  if (!isCurrencyCode(currency)) throw bad("channel.settle_currency 不是支持的币种");
  const sellRounding = new Map<string, number>();
  for (const [code, unit] of Object.entries(record(channel.sell_rounding, "channel.sell_rounding"))) {
    if (typeof unit !== "number" || !isSafePositive(unit)) throw bad("channel.sell_rounding 的取整单位要是正整数");
    sellRounding.set(code, unit);
  }
  const markupRules = list(root.markup_rules, "markup_rules").map((value, index): MarkupRule => {
    const rule = record(value, `markup_rules[${index}]`);
    const category = rule.category === null ? null : text(rule.category, "category");
    if (category !== null && !["airport_transfer", "point_to_point", "charter"].includes(category)) throw bad(`markup_rules[${index}].category 不认识`);
    const parsed: MarkupRule = {
      id: id(rule.id, `markup_rules[${index}].id`),
      tenantId: optionalId(rule.supplier_tenant_id, `markup_rules[${index}].supplier_tenant_id`),
      cityId: optionalId(rule.city_id, `markup_rules[${index}].city_id`),
      category: category as MarkupRule["category"],
      vehicleGroupId: optionalId(rule.vehicle_group_id, `markup_rules[${index}].vehicle_group_id`),
      markupBp: whole(rule.markup_bp, `markup_rules[${index}].markup_bp`),
      validFrom: date(rule.valid_from, `markup_rules[${index}].valid_from`),
      validTo: date(rule.valid_to, `markup_rules[${index}].valid_to`),
    };
    if (markupLevelOf(parsed) === null) throw bad(`markup_rules[${index}] 的维度不是五级之一`);
    return parsed;
  });
  return {
    tenant: { id: id(tenant.id, "tenant.id"), name: text(tenant.name, "tenant.name"), status: text(tenant.status, "tenant.status") },
    channel: {
      id: id(channel.id, "channel.id"),
      name: text(channel.name, "channel.name"),
      settleCurrency: currency,
      defaultMarkupBp: whole(channel.default_markup_bp, "channel.default_markup_bp"),
      markupFloorBp: whole(channel.markup_floor_bp, "channel.markup_floor_bp"),
      minMarginMinor: whole(channel.min_margin_minor, "channel.min_margin_minor"),
      sellRounding,
    },
    markupRules,
    cities: list(root.cities, "cities").map((value, index) => {
      const city = record(value, `cities[${index}]`);
      return { id: id(city.id, `cities[${index}].id`), code: text(city.code, `cities[${index}].code`), status: text(city.status, `cities[${index}].status`), name: names(city.name, `cities[${index}].name`) };
    }),
    places: list(root.places, "places").map((value, index) => {
      const place = record(value, `places[${index}]`);
      return {
        id: id(place.id, `places[${index}].id`),
        code: text(place.code, `places[${index}].code`),
        type: text(place.type, `places[${index}].type`),
        status: text(place.status, `places[${index}].status`),
        cityId: optionalId(place.city_id, `places[${index}].city_id`),
        name: names(place.name, `places[${index}].name`),
      };
    }),
    vehicleGroups: list(root.vehicle_groups, "vehicle_groups").map((value, index) => {
      const group = record(value, `vehicle_groups[${index}]`);
      return {
        id: id(group.id, `vehicle_groups[${index}].id`),
        code: text(group.code, `vehicle_groups[${index}].code`),
        status: text(group.status, `vehicle_groups[${index}].status`),
        combos: list(group.combos, `vehicle_groups[${index}].combos`).map((combo) => {
          const entry = record(combo, "combos[]");
          return { passengers: whole(entry.passengers, "combos[].passengers"), luggage: whole(entry.luggage, "combos[].luggage") };
        }),
      };
    }),
  };
}

// ---- 前置检查：目标环境里缺什么 ----

export type PriceImportPrecheckIssue =
  | { code: "TENANT_NOT_ACTIVE"; detail: string }
  | { code: "CHANNEL_CURRENCY"; detail: string }
  | { code: "AIRPORT_MISSING"; iata: string; detail: string }
  | { code: "AIRPORT_NOT_READY"; iata: string; detail: string }
  | { code: "CITY_NOT_ACTIVE"; iata: string; detail: string }
  | { code: "VEHICLE_GROUP_MISSING"; vehicleGroupCode: string; detail: string }
  | { code: "VEHICLE_GROUP_DISABLED"; vehicleGroupCode: string; detail: string }
  | { code: "VEHICLE_COMBO_MISSING"; vehicleGroupCode: string; detail: string };

export interface PriceImportResolved {
  /** IATA → 机场的编号和城市 */
  airports: Map<string, { placeId: string; cityId: string; cityCode: string }>;
  /** 车型组编码 → 编号 */
  vehicleGroups: Map<string, string>;
  issues: PriceImportPrecheckIssue[];
}

/**
 * 写入前的前置检查：机场、车型组、城市都要在平台主数据里、启用中；车型组要有表里那个「人数 / 行李」组合；
 * 官网渠道的结算币种要是日元（全表是日元，子品牌建成日元）。缺了就停——工具不建平台主数据，由平台按现有流程建。
 */
export function resolvePriceImportTarget(target: PriceImportTarget, products: readonly PriceImportProductPlan[], currency: CurrencyCode): PriceImportResolved {
  const issues: PriceImportPrecheckIssue[] = [];
  if (target.tenant.status !== "active") issues.push({ code: "TENANT_NOT_ACTIVE", detail: `目标租户的状态是 ${target.tenant.status}` });
  if (target.channel.settleCurrency !== currency) issues.push({ code: "CHANNEL_CURRENCY", detail: `官网渠道的结算币种是 ${target.channel.settleCurrency}，价格表是 ${currency}` });
  const cities = new Map(target.cities.map((city) => [city.id, city]));
  const airports = new Map<string, { placeId: string; cityId: string; cityCode: string }>();
  for (const iata of new Set(products.map((product) => product.iata))) {
    const place = target.places.find((entry) => entry.code === iata && entry.type === "airport");
    if (!place) {
      issues.push({ code: "AIRPORT_MISSING", iata, detail: "主数据里没有这个机场" });
      continue;
    }
    if (place.cityId === null || place.status !== "active") {
      issues.push({ code: "AIRPORT_NOT_READY", iata, detail: place.cityId === null ? "机场还没有指定所属城市（平台要先指定城市并启用）" : "机场是停用的" });
      continue;
    }
    const city = cities.get(place.cityId);
    if (!city || city.status !== "active") {
      issues.push({ code: "CITY_NOT_ACTIVE", iata, detail: "机场所属的城市不存在或停用" });
      continue;
    }
    airports.set(iata, { placeId: place.id, cityId: city.id, cityCode: city.code });
  }
  const vehicleGroups = new Map<string, string>();
  const needs = new Map<string, PriceSheetCapacity[]>();
  for (const product of products) for (const vehicle of product.vehicles) needs.set(vehicle.code, [...(needs.get(vehicle.code) ?? []), vehicle.capacity]);
  for (const [code, capacities] of needs) {
    const group = target.vehicleGroups.find((entry) => entry.code === code);
    if (!group) {
      issues.push({ code: "VEHICLE_GROUP_MISSING", vehicleGroupCode: code, detail: "平台主数据里没有这个车型组，要由平台先建" });
      continue;
    }
    if (group.status !== "active") {
      issues.push({ code: "VEHICLE_GROUP_DISABLED", vehicleGroupCode: code, detail: "车型组是停用的" });
      continue;
    }
    const missing = capacities.filter((capacity) => !group.combos.some((combo) => combo.passengers === capacity.passengers && combo.luggage === capacity.luggage));
    if (missing.length > 0) {
      const first = missing[0] as PriceSheetCapacity;
      issues.push({ code: "VEHICLE_COMBO_MISSING", vehicleGroupCode: code, detail: `车型组没有「${first.passengers} 人 / ${first.luggage} 件」这个组合` });
      continue;
    }
    vehicleGroups.set(code, group.id);
  }
  return { airports, vehicleGroups, issues };
}

/**
 * 一格价格适用的官网规则：加价比例按渠道的五级规则匹配（租户、机场所属城市、接送机、车型组），**只看不带日期的规则**——
 * 价格从生效日起一直有效，促销期（带日期的规则）里显示价会不同，另列在 `datedRules` 里提醒。
 */
export function sitePriceRulesFor(
  target: PriceImportTarget,
  query: { cityId: string; vehicleGroupId: string; validFrom: string },
  brand: { currency: CurrencyCode; roundingUnit: number },
): { rules: SitePriceRules; datedRules: MarkupRule[] } {
  const undated = target.markupRules.filter((rule) => rule.validFrom === null && rule.validTo === null);
  const markupQuery = { tenantId: target.tenant.id, cityId: query.cityId, category: "airport_transfer" as const, vehicleGroupId: query.vehicleGroupId, serviceDate: query.validFrom };
  const match = resolveMarkup({ defaultMarkupBp: target.channel.defaultMarkupBp, rules: undated }, markupQuery);
  const datedRules = target.markupRules.filter(
    (rule) =>
      (rule.validFrom !== null || rule.validTo !== null) &&
      (rule.validTo === null || rule.validTo >= query.validFrom) &&
      (rule.tenantId === null || rule.tenantId === markupQuery.tenantId) &&
      (rule.cityId === null || rule.cityId === markupQuery.cityId) &&
      (rule.category === null || rule.category === markupQuery.category) &&
      (rule.vehicleGroupId === null || rule.vehicleGroupId === markupQuery.vehicleGroupId),
  );
  return {
    rules: {
      currency: brand.currency,
      channelCurrency: target.channel.settleCurrency,
      brandRoundingUnit: brand.roundingUnit,
      markupBp: match.markupBp,
      markupFloorBp: target.channel.markupFloorBp,
      minMarginMinor: target.channel.minMarginMinor,
      sellRoundingUnit: target.channel.sellRounding.get(target.channel.settleCurrency) ?? 1,
    },
    datedRules,
  };
}

/** 平台的加价下限（10%）：没有导出时按它和「渠道默认 = 下限」估算的场景用。 */
export const PRICE_IMPORT_PLATFORM_FLOOR_BP = QUOTE_RULES.defaultMarkupFloorBp;
