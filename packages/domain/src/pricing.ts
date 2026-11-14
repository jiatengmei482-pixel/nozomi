/**
 * 价格规则与调价规则（M1-04）。纯函数：浏览器里填表、算「这一行的意思」和价格日历，后端保存、上架校验、以后的报价，用的是同一份。
 *
 * 对应需求文档「4. 价格规则与调价规则」和「报价引擎」的计价公式、调价、取整：
 * - 金额是子品牌币种的最小货币单位整数；百分比是基点整数（1% = 100）。
 * - 中间结果用分数精确保留（里程单价 × 米数 ÷ 1000、百分比连乘都不丢精度），只在最后按取整单位四舍五入一次（money.ts）。
 * - 这里只算到「基础价 → 调价 → 取整」。加急费、夜间费、附加服务各自独立、不参与调价，由报价引擎（M2-01）相加。
 * - 检查函数只返回路径和原因代码，不返回句子（同 products.ts）。
 */
import type { PlaceType, ServiceCategory } from "./master-data.ts";
import { hasVisibleText, isCountryCode } from "./master-data.ts";
import { type CurrencyCode, assertMinor, minorDigits, roundFractionHalfAwayFromZero, roundFractionToUnit } from "./money.ts";
import { type DailyWindow, MINUTES_PER_DAY, dailyWindowIssue, isLocalDate, parseTimeOfDay } from "./service-time.ts";

// ---- 枚举和上限 ----

export const PRICING_MODELS = ["fixed", "mileage_time", "charter_package", "charter_area_surcharge", "charter_itinerary_surcharge"] as const;
export type PricingModel = (typeof PRICING_MODELS)[number];
export const PRICING_MODEL_NAMES: Readonly<Record<PricingModel, string>> = { fixed: "固定一口价", mileage_time: "里程 + 时长", charter_package: "包车套餐", charter_area_surcharge: "上下车加价", charter_itinerary_surcharge: "行程加价" };

/**
 * 加价类的价格方式（M8-15，ADR 0073 第三部分）：不是一条「基础定价」，而是加在基础定价上的一笔钱。
 * - ③上下车加价（`charter_area_surcharge`，原名「区域加价」）：`area_id` 是加价区域（本租户的任何报价区域，不必是商品选的区域），按车型组 × 套餐时长填上车加价、下车加价；
 * - ②行程加价（`charter_itinerary_surcharge`，M9P-05，ADR 0093 第一节）：`area_id` 是行程区域，经停点落在这里时加一次；不参与上下车点匹配。
 * 两种的套餐时长都可以为空（= 这个车型组的所有套餐，ADR 0093 第一节）；只有迁移过三层区域的商品（`charterLayout: "three_layer"`）才能用②和空套餐。
 */
export const SURCHARGE_PRICING_MODELS = ["charter_area_surcharge", "charter_itinerary_surcharge"] as const satisfies readonly PricingModel[];
export type SurchargePricingModel = (typeof SURCHARGE_PRICING_MODELS)[number];

/** 这种价格方式是不是加价类的（不是基础定价）。 */
export function isSurchargeModel(model: PricingModel): model is SurchargePricingModel {
  return (SURCHARGE_PRICING_MODELS as readonly PricingModel[]).includes(model);
}

/** 这条价格规则是不是加价类的（包车区域加价）：报价、上架检查、缺价统计、调价检查里的「基础定价」都不算它。 */
export function isSurchargeRule(rule: { pricing?: { model: PricingModel } }): boolean {
  return rule.pricing !== undefined && isSurchargeModel(rule.pricing.model);
}

/** 接送机价格的方向：接机（接站）、送机（送站），或两个方向用同一个价。 */
export const PRICE_DIRECTIONS = ["pickup", "dropoff", "both"] as const;
export type PriceDirection = (typeof PRICE_DIRECTIONS)[number];
/** 一次用车实际的方向 */
export const TRIP_DIRECTIONS = ["pickup", "dropoff"] as const;
export type TripDirection = (typeof TRIP_DIRECTIONS)[number];
export const PRICE_DIRECTION_NAMES: Readonly<Record<PriceDirection, string>> = { pickup: "接机", dropoff: "送机", both: "接送通用" };

/** 方向的中文名按接送点的类型取：接送点是车站时叫「接站 / 送站」（和服务规则里免费等待的叫法一致），其余叫「接机 / 送机」。 */
export function priceDirectionNames(pickupPlaceType: PlaceType | null): Readonly<Record<PriceDirection, string>> {
  return pickupPlaceType === "station" || pickupPlaceType === "exit" ? { pickup: "接站", dropoff: "送站", both: "接送通用" } : PRICE_DIRECTION_NAMES;
}

export const PRICE_RULE_STATUSES = ["enabled", "disabled"] as const;
export type PriceRuleStatus = (typeof PRICE_RULE_STATUSES)[number];

/** 这个品类的商品的基础定价可以用哪几种计价方式（需求文档的表）。加价类的另见 `surchargeModelsFor`。 */
export function pricingModelsFor(category: ServiceCategory): PricingModel[] {
  return category === "charter" ? ["charter_package"] : ["fixed", "mileage_time"];
}

/**
 * 这个品类的商品可以用哪几种加价类的价格方式：包车有上下车加价（ADR 0073）；迁移过三层区域的包车另有行程加价（ADR 0093）；别的品类没有。
 * 不给 `layout` 按没迁移过算。
 */
export function surchargeModelsFor(category: ServiceCategory, layout: CharterLayout | null = null): SurchargePricingModel[] {
  if (category !== "charter") return [];
  return layout === "three_layer" ? ["charter_area_surcharge", "charter_itinerary_surcharge"] : ["charter_area_surcharge"];
}

/**
 * 包车商品用哪套价格表（M9P-05，ADR 0093 第一节「新旧表按商品迁移过没有切换」）：`null` = 旧表（③行里的途经加价、按服务区域的套餐价）；
 * `three_layer` = 新表（②行程加价、整商品套餐价，`areaId` 为空）。只由迁移脚本写。
 */
export type CharterLayout = "three_layer";

export const PRICE_LIMITS = {
  /** 任何一个金额的上限（最小货币单位） */
  maxAmountMinor: 1_000_000_000,
  /** 起步里程（米）：0 到 1000 公里，精确到 100 米 */
  maxStartMeters: 1_000_000,
  startMetersStep: 100,
  maxStartMinutes: 1_440,
  /** 包车套餐：1 到 72 小时，1 到 5000 公里 */
  maxPackageHours: 72,
  maxPackageKm: 5_000,
  /** 点对点一口价「含 X 公里」的上限（公里，ADR 0073 第二部分第 4 节） */
  maxIncludedKm: 2_000,
  /** 一个商品最多多少条价格规则；一次批量保存最多改多少条（需求文档：500） */
  maxPriceRulesPerProduct: 2_000,
  maxBatchChanges: 500,
  maxAdjustRulesPerProduct: 100,
  maxAdjustNameLength: 50,
  maxAdjustSteps: 10,
  maxAdjustDates: 366,
  maxAdjustCountries: 10,
  /** 百分比调价的范围（基点）：下调不到 100%，上调最多 1000% */
  minPercentBp: -9_999,
  maxPercentBp: 100_000,
  /** 价格日历一次最多取多少天 */
  maxCalendarDays: 62,
  /**
   * 一次用车的结算价（基础价、调价之后的结果）的上限（最小货币单位）：一万亿，是单个金额上限的 1000 倍。
   * 超过它的不报价（`OVER_LIMIT`）——几条调价规则连乘可以乘出任意大的数，这样的价格只可能是配置写错了。
   * 中间结果不设上限（用整数分数精确保留，多大都不丢精度），只看最后这个数。
   */
  maxSettlementMinor: 1_000_000_000_000,
  /** 检查调价规则叠加时往后看多少天、最多看多少种「同时生效的规则组合」 */
  adjustStackDays: 366,
  maxAdjustStackSets: 200,
} as const;

/** 子品牌取整单位的可选值（最小货币单位）：没有小数的币种 1 / 10 / 100 / 1000；两位小数的币种 0.01 / 0.1 / 1 / 10 / 100。 */
export function roundingUnitOptions(currency: CurrencyCode): number[] {
  return minorDigits(currency) === 0 ? [1, 10, 100, 1_000] : [1, 10, 100, 1_000, 10_000];
}

// ---- 精确的金额 ----

/** 精确的金额：numerator / denominator 个最小货币单位（分母恒为正，已约分）。 */
export interface ExactAmount {
  numerator: bigint;
  denominator: bigint;
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
}

function exact(numerator: bigint, denominator: bigint = 1n): ExactAmount {
  const sign = denominator < 0n ? -1n : 1n;
  const divisor = gcd(numerator, denominator) || 1n;
  return { numerator: (sign * numerator) / divisor, denominator: (sign * denominator) / divisor };
}

export function exactFromMinor(minor: number): ExactAmount {
  if (!Number.isSafeInteger(minor)) throw new RangeError(`金额必须是安全整数（最小货币单位）：${minor}`);
  return { numerator: BigInt(minor), denominator: 1n };
}

function plus(a: ExactAmount, b: ExactAmount): ExactAmount {
  return exact(a.numerator * b.denominator + b.numerator * a.denominator, a.denominator * b.denominator);
}

function minus(a: ExactAmount, b: ExactAmount): ExactAmount {
  return plus(a, { numerator: -b.numerator, denominator: b.denominator });
}

function times(a: ExactAmount, numerator: bigint, denominator: bigint = 1n): ExactAmount {
  return exact(a.numerator * numerator, a.denominator * denominator);
}

/** 两个精确的金额相加。 */
export function addExact(a: ExactAmount, b: ExactAmount): ExactAmount {
  return plus(a, b);
}

/** 精确的金额乘以一个分数 numerator / denominator。 */
export function scaleExact(amount: ExactAmount, numerator: bigint, denominator: bigint = 1n): ExactAmount {
  if (denominator === 0n) throw new RangeError("分母不能为 0");
  return times(amount, numerator, denominator);
}

export function compareExact(a: ExactAmount, b: ExactAmount): number {
  const difference = a.numerator * b.denominator - b.numerator * a.denominator;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

/** 这个金额超过了结算价的上限（`PRICE_LIMITS.maxSettlementMinor`）：不报价。 */
export function exceedsSettlementLimit(amount: ExactAmount): boolean {
  return amount.numerator > BigInt(PRICE_LIMITS.maxSettlementMinor) * amount.denominator;
}

const DISPLAY_DECIMALS = 6;

/**
 * 精确的金额写成十进制字符串（最小货币单位，如 `"23149.5"`）：能写尽的原样写出，写不尽的（除以 60、除以 3 这类）
 * 四舍五入到 6 位小数。只用来给人看计算过程；参与计算的始终是精确值。
 */
export function formatExact(amount: ExactAmount): string {
  return decimalText(amount, DISPLAY_DECIMALS);
}

/**
 * 精确的金额换成给人看的**主单位**写法（人民币 460050.5 分 → `"4600.505"`；日元没有小数位，和 `formatExact` 一样）。
 * 按币种的小数位挪小数点，全程整数运算；写不尽的保留到最小货币单位之后 6 位。只用来显示还没取整的中间结果，
 * 已经取整的金额用 money.ts 的 `formatMajor`。
 */
export function formatExactMajor(amount: ExactAmount, currency: CurrencyCode): string {
  const digits = minorDigits(currency);
  return decimalText(exact(amount.numerator, amount.denominator * 10n ** BigInt(digits)), DISPLAY_DECIMALS + digits);
}

function decimalText(amount: ExactAmount, maxDecimals: number): string {
  let scale = 0;
  while (scale < maxDecimals && 10n ** BigInt(scale) % amount.denominator !== 0n) scale += 1;
  const scaled = roundFractionHalfAwayFromZero(amount.numerator * 10n ** BigInt(scale), amount.denominator);
  const negative = scaled < 0n;
  const digits = (negative ? -scaled : scaled).toString().padStart(scale + 1, "0");
  const whole = digits.slice(0, digits.length - scale);
  const fraction = scale === 0 ? "" : digits.slice(-scale).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction === "" ? "" : `.${fraction}`}`;
}

// ---- 价格规则 ----

/**
 * 固定一口价：基础价。
 * 点对点的一口价可以再设「含 X 公里 + 超出每公里 Y」（ADR 0073 第二部分第 4 节）：`includedKm`、`overKmPerKmMinor` 要么都有、要么都没有；
 * 都没有 = 和以前一样，不看公里数。设了时报价 = 基础价 + 超出公里数 × Y（超出公里数向上取整到 1 公里，见 `overKm`）。
 */
export interface FixedPricing {
  model: "fixed";
  basePriceMinor: number;
  /** 一口价含多少公里（整数，1～2000） */
  includedKm?: number;
  /** 超出后每公里多少钱（最小货币单位整数，可以是 0） */
  overKmPerKmMinor?: number;
}

/** 这条一口价设了「含公里数」（点对点，ADR 0073）：报价要用路线距离，拿不到路线时不报。 */
export function hasIncludedKm(pricing: Pricing): pricing is FixedPricing & { includedKm: number; overKmPerKmMinor: number } {
  return pricing.model === "fixed" && pricing.includedKm !== undefined && pricing.overKmPerKmMinor !== undefined;
}

/**
 * 超出公里数（ADR 0073 第二部分第 4 节）：Z = max(0, ⌈(路线米数 − X × 1000) ÷ 1000⌉)，向上取整到 1 公里。
 * 例：含 30 公里，30.0 公里 → 0；30.2 公里 → 1；31.0 公里 → 1；31.4 公里 → 2。米数不是整数的先舍去小数（和里程计价一样）。
 */
export function overKm(routeMeters: number, includedKm: number): number {
  const over = BigInt(Math.max(0, Math.trunc(routeMeters))) - BigInt(includedKm) * 1_000n;
  return over <= 0n ? 0 : Number((over + 999n) / 1_000n);
}

/**
 * 设了含公里数的一口价在这段路线上的基础价（最小货币单位整数）：一口价 + 超出公里数 × 超出每公里单价。
 * 没设含公里数的就是一口价本身；`routeMeters` 为 null（不知道路线）按不超出算。
 */
export function fixedPriceWithKm(pricing: FixedPricing, routeMeters: number | null): number {
  if (!hasIncludedKm(pricing) || routeMeters === null) return pricing.basePriceMinor;
  return pricing.basePriceMinor + overKm(routeMeters, pricing.includedKm) * pricing.overKmPerKmMinor;
}

/** 里程 + 时长：起步价、起步里程（米）、起步时长（分钟）、超出每公里单价、超出每分钟单价、最低消费（null = 不设）。 */
export interface MileageTimePricing {
  model: "mileage_time";
  startPriceMinor: number;
  startMeters: number;
  startMinutes: number;
  perKmMinor: number;
  perMinuteMinor: number;
  minPriceMinor: number | null;
}

/** 包车套餐：套餐公里、套餐价、超时单价（每小时）、超公里单价（每公里）。套餐时长在价格规则的组合里（`packageHours`）。 */
export interface CharterPackagePricing {
  model: "charter_package";
  packageKm: number;
  packagePriceMinor: number;
  overtimePerHourMinor: number;
  overKmPerKmMinor: number;
}

/**
 * 包车区域加价（ADR 0073 第三部分）：上车点在这个区域时加 `pickupSurchargeMinor`，下车点在这个区域时加 `dropoffSurchargeMinor`。
 * 都是整数、可以是 0；套餐时长在价格规则的组合里（`packageHours`），区域是规则的 `areaId`。
 * `waypointSurchargeMinor`（途经加价，ADR 0088）：经停点在这个区域时加的钱，同一区域一单只加一次。可选——**没设 = 这个区域对经停点没有规则**（不当 0；不加钱要明填 0）。
 */
export interface CharterAreaSurchargePricing {
  model: "charter_area_surcharge";
  pickupSurchargeMinor: number;
  dropoffSurchargeMinor: number;
  waypointSurchargeMinor?: number;
}

/**
 * 包车②行程加价（M9P-05，ADR 0093 第一节）：经停点（和下车点行程加价）落在这个区域时加 `surchargeMinor`，同一区域一单只加一次。
 * 整数、可以是 0。没有这条规则 = 不报价（不加钱要明填 0）。
 */
export interface CharterItinerarySurchargePricing {
  model: "charter_itinerary_surcharge";
  surchargeMinor: number;
}

export type Pricing = FixedPricing | MileageTimePricing | CharterPackagePricing | CharterAreaSurchargePricing | CharterItinerarySurchargePricing;

/**
 * 一条价格规则 = 区域 × 车型组 ×（接送机：方向；包车：套餐时长）× 生效日期（用车日期，两端都含）的一条报价，带启停状态。
 */
export interface PriceRule {
  /** 区域。只有包车套餐可以为空：空 = 整个商品的套餐价（迁移过三层区域的商品，ADR 0093 第五节） */
  areaId: string | null;
  /**
   * 点对点的下车区域（ADR 0073 第二部分）：不填（null 或不给）= 区域价，和以前一样；
   * 填了 = 单向线路价，只管「上车点在 `areaId`、下车点在 `toAreaId`」的单。只有点对点能填，不能等于 `areaId`。
   */
  toAreaId?: string | null;
  vehicleGroupId: string;
  /** 接送机必填；其他品类为 null */
  direction: PriceDirection | null;
  /** 包车套餐必填（小时）；包车的②③加价可以为空（= 所有套餐，只限迁移过三层区域的商品）；其他品类为 null */
  packageHours: number | null;
  pricing: Pricing;
  /** `YYYY-MM-DD`，城市当地的用车日期 */
  validFrom: string;
  /** null = 一直有效 */
  validTo: string | null;
  status: PriceRuleStatus;
}

export type PriceIssueReason =
  | "REQUIRED"
  | "NOT_INTEGER"
  | "OUT_OF_RANGE"
  | "INVALID_DATE"
  | "DATE_RANGE_REVERSED"
  /** 这个品类的价格不填这一项（非接送机填了方向、非包车填了套餐时长） */
  | "NOT_APPLICABLE"
  /** 这个品类不能用这种计价方式 */
  | "MODEL_NOT_ALLOWED"
  | "INVALID_TIME"
  | "EMPTY_WINDOW"
  | "DUPLICATE"
  | "TOO_MANY"
  | "TOO_LONG"
  | "INVALID_COUNTRY"
  /** 步骤的值不能是 0 */
  | "ZERO_STEP"
  /** 线路价的下车区域和上车区域相同（同一个区域就是区域价，不填下车区域） */
  | "SAME_AREA";

export interface PriceIssue {
  /** 相对于这一条规则的字段路径（接口里的字段名），如 `/base_price`、`/steps/1/value` */
  path: string;
  reason: PriceIssueReason;
  detail?: Record<string, number>;
}

function integerIssue(issues: PriceIssue[], path: string, value: number, min: number, max: number): void {
  if (!Number.isInteger(value)) issues.push({ path, reason: "NOT_INTEGER" });
  else if (value < min || value > max) issues.push({ path, reason: "OUT_OF_RANGE", detail: { min, max } });
}

function dateRangeIssues(issues: PriceIssue[], fromPath: string, from: string | null, toPath: string, to: string | null): void {
  if (from !== null && !isLocalDate(from)) issues.push({ path: fromPath, reason: "INVALID_DATE" });
  if (to !== null && !isLocalDate(to)) issues.push({ path: toPath, reason: "INVALID_DATE" });
  if (from !== null && to !== null && isLocalDate(from) && isLocalDate(to) && to < from) issues.push({ path: toPath, reason: "DATE_RANGE_REVERSED" });
}

/**
 * 一条价格规则「写得对不对」。没有问题返回空数组。区域、车型组是不是这个商品选的，由保存的地方查。
 * 包车的②行程加价、整商品套餐价（区域为空）、加价的空套餐（= 所有套餐）只有迁移过三层区域的商品（`charterLayout: "three_layer"`）能用（ADR 0093 第一节）；
 * 不给 `charterLayout` 按没迁移过查（和以前一样）。保存的地方在这之前先按商品的标志给出 `CHARTER_LAYOUT_NOT_MIGRATED`。
 */
export function priceRuleIssues(rule: PriceRule, context: { category: ServiceCategory; charterLayout?: CharterLayout | null }): PriceIssue[] {
  const layered = context.category === "charter" && context.charterLayout === "three_layer";
  const issues: PriceIssue[] = [];
  const max = PRICE_LIMITS.maxAmountMinor;
  if (context.category === "airport_transfer") {
    if (rule.direction === null) issues.push({ path: "/direction", reason: "REQUIRED" });
  } else if (rule.direction !== null) issues.push({ path: "/direction", reason: "NOT_APPLICABLE" });
  if (context.category === "charter") {
    // 加价（②③）的套餐可以为空 = 这个车型组的所有套餐（ADR 0093 第一节）；套餐价必填
    if (rule.packageHours === null) {
      if (!layered || !isSurchargeModel(rule.pricing.model)) issues.push({ path: "/package_hours", reason: "REQUIRED" });
    } else integerIssue(issues, "/package_hours", rule.packageHours, 1, PRICE_LIMITS.maxPackageHours);
  } else if (rule.packageHours !== null) issues.push({ path: "/package_hours", reason: "NOT_APPLICABLE" });
  // 区域只有迁移过三层区域的包车套餐可以不填（整商品套餐价，ADR 0093 第五节）
  if (rule.areaId === null && (!layered || rule.pricing.model !== "charter_package")) issues.push({ path: "/area_id", reason: "REQUIRED" });
  // 线路价的下车区域：只有点对点（ADR 0073 第二部分）；和上车区域相同的不行
  const toAreaId = rule.toAreaId ?? null;
  if (toAreaId !== null) {
    if (context.category !== "point_to_point") issues.push({ path: "/to_area_id", reason: "NOT_APPLICABLE" });
    else if (toAreaId === rule.areaId) issues.push({ path: "/to_area_id", reason: "SAME_AREA" });
  }

  const pricing = rule.pricing;
  if (![...pricingModelsFor(context.category), ...surchargeModelsFor(context.category, layered ? "three_layer" : null)].includes(pricing.model)) issues.push({ path: "/pricing_model", reason: "MODEL_NOT_ALLOWED" });
  if (pricing.model === "fixed") {
    integerIssue(issues, "/base_price", pricing.basePriceMinor, 1, max);
    // 含公里数（ADR 0073 第二部分第 4 节）：只有点对点；要么都填、要么都不填
    const [km, perKm] = [pricing.includedKm, pricing.overKmPerKmMinor];
    if (km !== undefined || perKm !== undefined) {
      if (context.category !== "point_to_point") {
        if (km !== undefined) issues.push({ path: "/included_km", reason: "NOT_APPLICABLE" });
        if (perKm !== undefined) issues.push({ path: "/over_km_per_km", reason: "NOT_APPLICABLE" });
      } else {
        if (km === undefined) issues.push({ path: "/included_km", reason: "REQUIRED" });
        else integerIssue(issues, "/included_km", km, 1, PRICE_LIMITS.maxIncludedKm);
        if (perKm === undefined) issues.push({ path: "/over_km_per_km", reason: "REQUIRED" });
        else integerIssue(issues, "/over_km_per_km", perKm, 0, max);
      }
    }
  } else if (pricing.model === "mileage_time") {
    integerIssue(issues, "/start_price", pricing.startPriceMinor, 0, max);
    integerIssue(issues, "/start_meters", pricing.startMeters, 0, PRICE_LIMITS.maxStartMeters);
    if (Number.isInteger(pricing.startMeters) && pricing.startMeters % PRICE_LIMITS.startMetersStep !== 0) issues.push({ path: "/start_meters", reason: "OUT_OF_RANGE", detail: { step: PRICE_LIMITS.startMetersStep } });
    integerIssue(issues, "/start_minutes", pricing.startMinutes, 0, PRICE_LIMITS.maxStartMinutes);
    integerIssue(issues, "/per_km", pricing.perKmMinor, 0, max);
    integerIssue(issues, "/per_minute", pricing.perMinuteMinor, 0, max);
    if (pricing.minPriceMinor !== null) integerIssue(issues, "/min_price", pricing.minPriceMinor, 1, max);
    // 起步价是 0 时必须有最低消费或单价，否则零里程的行程算出来是 0
    if (pricing.startPriceMinor === 0 && pricing.minPriceMinor === null) issues.push({ path: "/start_price", reason: "OUT_OF_RANGE", detail: { min: 1, max } });
  } else if (pricing.model === "charter_area_surcharge") {
    // 加价可以是 0（这一端不加钱，但这个区域能接）
    integerIssue(issues, "/pickup_surcharge", pricing.pickupSurchargeMinor, 0, max);
    integerIssue(issues, "/dropoff_surcharge", pricing.dropoffSurchargeMinor, 0, max);
    if (pricing.waypointSurchargeMinor !== undefined) integerIssue(issues, "/waypoint_surcharge", pricing.waypointSurchargeMinor, 0, max);
  } else if (pricing.model === "charter_itinerary_surcharge") {
    integerIssue(issues, "/itinerary_surcharge", pricing.surchargeMinor, 0, max);
  } else {
    integerIssue(issues, "/package_km", pricing.packageKm, 1, PRICE_LIMITS.maxPackageKm);
    integerIssue(issues, "/package_price", pricing.packagePriceMinor, 1, max);
    integerIssue(issues, "/overtime_per_hour", pricing.overtimePerHourMinor, 0, max);
    integerIssue(issues, "/over_km_per_km", pricing.overKmPerKmMinor, 0, max);
  }
  dateRangeIssues(issues, "/valid_from", rule.validFrom, "/valid_to", rule.validTo);
  return issues;
}

/**
 * 唯一性的组合键：区域 + 下车区域 + 车型组 + 方向或套餐时长 + 价格方式的类别（ADR 0073 M8-15；ADR 0093 第一节改为三类）。
 * 类别：基础定价（几种计价方式之间不分，同一个组合同一天只能有一条基础定价）、③上下车加价、②行程加价——同一个区域可以同时有三类，不算冲突；
 * 整商品套餐价（区域为空）按「车型组 × 套餐 × 生效日期」查重；加价的空套餐（= 所有套餐）和具体套餐是不同的组合（报价先找具体套餐的）；
 * 点对点的线路价（有下车区域）按「上车区域 → 下车区域」各算各的，和区域价互不冲突。
 */
export function priceRuleComboKey(rule: Pick<PriceRule, "areaId" | "toAreaId" | "vehicleGroupId" | "direction" | "packageHours"> & { pricing?: { model: PricingModel } }): string {
  return `${rule.areaId ?? ""}|${rule.toAreaId ?? ""}|${rule.vehicleGroupId}|${rule.direction ?? ""}|${rule.packageHours ?? ""}|${isSurchargeRule(rule) ? (rule.pricing?.model ?? "surcharge") : "base"}`;
}

/** 这条是不是点对点的线路价（有下车区域，ADR 0073 第二部分）：不是「该有的价格」，缺价统计、上架检查不算它。 */
export function isRouteRule(rule: Pick<PriceRule, "toAreaId">): boolean {
  return (rule.toAreaId ?? null) !== null;
}

/** 两段生效日期有没有重叠。两端都含：「到 03-31」和「从 03-31」是重叠的；没有结束日期 = 一直有效。 */
export function dateRangesOverlap(a: { validFrom: string; validTo: string | null }, b: { validFrom: string; validTo: string | null }): boolean {
  return (b.validTo === null || a.validFrom <= b.validTo) && (a.validTo === null || b.validFrom <= a.validTo);
}

/**
 * 找出违反唯一性的每一对：同一个组合、生效日期重叠（需求文档）。停用的也算——否则一启用就撞上。
 * 返回的是下标对（i < j），按出现的先后。
 */
export function findPriceRuleOverlaps(rules: readonly (Pick<PriceRule, "areaId" | "toAreaId" | "vehicleGroupId" | "direction" | "packageHours" | "validFrom" | "validTo"> & { pricing?: { model: PricingModel } })[]): [number, number][] {
  const byCombo = new Map<string, number[]>();
  for (const [index, rule] of rules.entries()) {
    const key = priceRuleComboKey(rule);
    byCombo.set(key, [...(byCombo.get(key) ?? []), index]);
  }
  const pairs: [number, number][] = [];
  for (const indexes of byCombo.values()) {
    for (let i = 0; i < indexes.length; i += 1) {
      for (let j = i + 1; j < indexes.length; j += 1) {
        const a = indexes[i] as number;
        const b = indexes[j] as number;
        if (dateRangesOverlap(rules[a] as PriceRule, rules[b] as PriceRule)) pairs.push([a, b]);
      }
    }
  }
  return pairs.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
}

/** 这条价格在某个用车日期是不是在生效期内（不看启停）。 */
export function priceRuleCoversDate(rule: Pick<PriceRule, "validFrom" | "validTo">, date: string): boolean {
  return rule.validFrom <= date && (rule.validTo === null || date <= rule.validTo);
}

/** 「启用且未过期」：结束日期留空，或不早于城市当地的今天。以后才开始生效的也算（上架校验、缺价统计用）。 */
export function priceRuleIsActive(rule: Pick<PriceRule, "status" | "validTo">, today: string): boolean {
  return rule.status === "enabled" && (rule.validTo === null || rule.validTo >= today);
}

/**
 * 「可以卖的价格」：启用且未过期，而且区域和车型组都是商品**现在选着的**。
 * 能不能上架、首页和列表上「有没有可用价格」、已上架商品的修改保护，三处都看它有没有：一条都没有 = 商品现在一个价都报不出。
 * （商品去掉了某个区域 / 车型组之后，原来给它设的价格还留着，但不算数。个别组合缺价不拦，见 `priceCoverage`。）
 */
export function sellablePriceRules<T extends Pick<PriceRule, "areaId" | "toAreaId" | "vehicleGroupId" | "status" | "validTo" | "pricing">>(rules: readonly T[], selected: { areaIds: readonly string[]; vehicleGroupIds: readonly string[] }, today: string): T[] {
  // 区域加价、线路价是可选的补充：有没有它们都不影响「能不能上架」（ADR 0073 第五部分：上架检查按商品区域，不变）
  // 整商品套餐价（区域为空，ADR 0093 第五节）不挂区域：只看车型组
  return rules.filter((rule) => !isSurchargeRule(rule) && !isRouteRule(rule) && priceRuleIsActive(rule, today) && (rule.areaId === null || selected.areaIds.includes(rule.areaId)) && selected.vehicleGroupIds.includes(rule.vehicleGroupId));
}

/**
 * 「可以卖的线路价」（ADR 0073 第二部分）：启用且未过期、两端区域和车型组都是商品现在选着的点对点线路价。
 * 不算上架条件（见 `sellablePriceRules`），但调价规则的检查（调完不大于 0、超上限、叠加）要连它们一起看——它们同样会被报出去。
 */
export function sellableRouteRules<T extends Pick<PriceRule, "areaId" | "toAreaId" | "vehicleGroupId" | "status" | "validTo" | "pricing">>(rules: readonly T[], selected: { areaIds: readonly string[]; vehicleGroupIds: readonly string[] }, today: string): T[] {
  return rules.filter((rule) => isRouteRule(rule) && !isSurchargeRule(rule) && priceRuleIsActive(rule, today) && rule.areaId !== null && selected.areaIds.includes(rule.areaId) && selected.areaIds.includes(rule.toAreaId as string) && selected.vehicleGroupIds.includes(rule.vehicleGroupId));
}

/** 一次询价要找的组合。 */
export interface PriceQuery {
  areaId: string;
  vehicleGroupId: string;
  /** 接送机：这一单的方向；其他品类 null */
  direction: TripDirection | null;
  /** 包车：套餐时长；其他品类 null */
  packageHours: number | null;
  /** 城市当地的用车日期 */
  date: string;
  /** 点对点：找「`areaId` → `toAreaId`」的线路价（ADR 0073）；不给或 null = 找区域价（只看没有下车区域的规则） */
  toAreaId?: string | null;
  /**
   * 包车迁移过三层区域的商品（ADR 0093 第五节）：只找整商品套餐价（区域为空的规则）。`areaId` 仍是调价规则按区域匹配用的区域（基础价区域）。
   * 不给 = 按 `areaId` 找（和以前一样）。
   */
  productWide?: boolean;
}

/** 价格规则的区域对不对得上这次询价：整商品套餐价只看区域为空的，其余看 `areaId` */
function ruleAreaMatches(rule: Pick<PriceRule, "areaId">, query: Pick<PriceQuery, "areaId" | "productWide">): boolean {
  return query.productWide === true ? rule.areaId === null : rule.areaId === query.areaId;
}

/**
 * 命中价格规则（报价引擎第 5 步）：区域 × 车型组 × 方向或套餐，启用且用车日期在生效期内。
 * 接送机「接送通用」和具体方向同时存在时，以更具体的为准（需求文档）。没有命中返回 null。
 */
export function selectPriceRule<T extends PriceRule>(rules: readonly T[], query: PriceQuery): T | null {
  const candidates = rules.filter(
    (rule) => !isSurchargeRule(rule) && rule.status === "enabled" && ruleAreaMatches(rule, query) && (rule.toAreaId ?? null) === (query.toAreaId ?? null) && rule.vehicleGroupId === query.vehicleGroupId && rule.packageHours === query.packageHours && priceRuleCoversDate(rule, query.date),
  );
  if (query.direction === null) return candidates.find((rule) => rule.direction === null) ?? null;
  return candidates.find((rule) => rule.direction === query.direction) ?? candidates.find((rule) => rule.direction === "both") ?? null;
}

/** 一次行程的用量：预估里程（米）和时长（分钟）。包车报价时时长 = 套餐时长、里程不超套餐，所以两项都可以不给。 */
export interface TripUsage {
  meters?: number;
  minutes?: number;
}

/**
 * 基础价（需求文档的计价公式），精确值：
 * - 固定一口价：P = 基础价；点对点设了含 X 公里的：P = 基础价 + Z × 超出每公里单价，Z 见 `overKm`（向上取整到 1 公里，ADR 0073）
 * - 里程 + 时长：P = max(P_min, P_start + max(0, D − D_start) × p_km + max(0, T − T_start) × p_min)
 * - 包车套餐：P = P_pkg + max(0, H − H_pkg) × p_hour + max(0, D − D_pkg) × p_km
 * 里程按米、时长按分钟给，换算成公里、小时时不取整（超出 500 米就收 0.5 公里的钱）。没给的用量按「不超出」算。
 * 区域加价（ADR 0073）不是基础定价，没有自己的基础价：返回 0（加价由报价时按上车点、下车点另算，见 `areaSurchargeFor`）。
 */
export function basePrice(pricing: Pricing, usage: TripUsage = {}, packageHours: number | null = null): ExactAmount {
  const meters = BigInt(Math.max(0, Math.trunc(usage.meters ?? 0)));
  const minutes = BigInt(Math.max(0, Math.trunc(usage.minutes ?? 0)));
  const over = (used: bigint, included: bigint): bigint => (used > included ? used - included : 0n);
  if (pricing.model === "fixed") {
    if (!hasIncludedKm(pricing) || usage.meters === undefined) return exactFromMinor(pricing.basePriceMinor);
    return plus(exactFromMinor(pricing.basePriceMinor), times(exactFromMinor(pricing.overKmPerKmMinor), BigInt(overKm(usage.meters, pricing.includedKm))));
  }
  if (pricing.model === "charter_area_surcharge" || pricing.model === "charter_itinerary_surcharge") return exactFromMinor(0);
  if (pricing.model === "mileage_time") {
    const byDistance = times(exactFromMinor(pricing.perKmMinor), over(meters, BigInt(pricing.startMeters)), 1_000n);
    const byTime = times(exactFromMinor(pricing.perMinuteMinor), over(minutes, BigInt(pricing.startMinutes)));
    const total = plus(plus(exactFromMinor(pricing.startPriceMinor), byDistance), byTime);
    const floor = pricing.minPriceMinor === null ? null : exactFromMinor(pricing.minPriceMinor);
    return floor !== null && compareExact(total, floor) < 0 ? floor : total;
  }
  const overage = charterOverage(pricing, usage, packageHours);
  return plus(plus(exactFromMinor(pricing.packagePriceMinor), overage.overtime), overage.overKm);
}

/**
 * 包车套餐的超时、超公里（`basePrice` 里包车的后两项，同一个公式）：超时 = max(0, T − H) × 每小时单价，超公里 = max(0, D − D_pkg) × 每公里单价；
 * 分钟、米换算成小时、公里时不取整（精确值）。没给的用量按「不超出」算。包车「按行程计价」（ADR 0088 补充）的明细用它拆出这两项。
 */
export function charterOverage(pricing: CharterPackagePricing, usage: TripUsage, packageHours: number | null): { overtimeMinutes: number; overMeters: number; overtime: ExactAmount; overKm: ExactAmount } {
  const meters = BigInt(Math.max(0, Math.trunc(usage.meters ?? 0)));
  const minutes = BigInt(Math.max(0, Math.trunc(usage.minutes ?? 0)));
  const over = (used: bigint, included: bigint): bigint => (used > included ? used - included : 0n);
  const overtimeMinutes = over(minutes, BigInt((packageHours ?? 0) * 60));
  const overMeters = over(meters, BigInt(pricing.packageKm) * 1_000n);
  return {
    overtimeMinutes: Number(overtimeMinutes),
    overMeters: Number(overMeters),
    overtime: times(exactFromMinor(pricing.overtimePerHourMinor), overtimeMinutes, 60n),
    overKm: times(exactFromMinor(pricing.overKmPerKmMinor), overMeters, 1_000n),
  };
}

// ---- 调价规则 ----

/** 策略步骤：百分比（基点，可为负）或金额（最小货币单位，可为负）。 */
export type AdjustStep = { type: "percent"; value: number } | { type: "amount"; value: number };

/** 周期：每天 / 每周指定星期（1 = 周一 … 7 = 周日）/ 指定日期 / 这些国家的节假日。 */
export type AdjustCycle = { type: "daily" } | { type: "weekly"; weekdays: number[] } | { type: "dates"; dates: string[] } | { type: "holidays"; countries: string[] };
export const ADJUST_CYCLE_TYPES = ["daily", "weekly", "dates", "holidays"] as const;

export interface AdjustRule {
  name: string;
  /** 出行日期范围（城市当地的用车日期，两端都含）；null = 不限 */
  travelFrom: string | null;
  travelTo: string | null;
  cycle: AdjustCycle;
  /**
   * 适用时段（城市当地的用车时刻）：从 `start` 起（含）到 `end` 止（不含），`end` 可以写 `24:00`；null = 全天。
   * `end` 早于 `start` 是跨午夜的时段，**算在开始的那一天头上**：「每周五 22:00–06:00」是周五 22:00 到周六 06:00。
   */
  timeSlot: DailyWindow | null;
  /** 适用区域、车型组；空 = 全部 */
  areaIds: string[];
  vehicleGroupIds: string[];
  /** 接送机：适用方向，空 = 接和送都适用；其他品类必须为空 */
  directions: TripDirection[];
  /** 包车：适用的套餐时长，空 = 全部；其他品类必须为空 */
  packageHours: number[];
  /** 按顺序执行，后一步以前一步的结果为基数 */
  steps: AdjustStep[];
  status: PriceRuleStatus;
}

function duplicateIssues<T>(issues: PriceIssue[], path: string, values: readonly T[]): void {
  const seen = new Set<T>();
  for (const [index, value] of values.entries()) {
    if (seen.has(value)) issues.push({ path: `${path}/${index}`, reason: "DUPLICATE" });
    seen.add(value);
  }
}

/** 一条调价规则「写得对不对」。没有问题返回空数组。 */
export function adjustRuleIssues(rule: AdjustRule, context: { category: ServiceCategory }): PriceIssue[] {
  const issues: PriceIssue[] = [];
  if (!hasVisibleText(rule.name)) issues.push({ path: "/name", reason: "REQUIRED" });
  else if (rule.name.length > PRICE_LIMITS.maxAdjustNameLength) issues.push({ path: "/name", reason: "TOO_LONG", detail: { max: PRICE_LIMITS.maxAdjustNameLength } });
  dateRangeIssues(issues, "/travel_from", rule.travelFrom, "/travel_to", rule.travelTo);

  const cycle = rule.cycle;
  if (cycle.type === "weekly") {
    if (cycle.weekdays.length === 0) issues.push({ path: "/cycle/weekdays", reason: "REQUIRED" });
    for (const [index, day] of cycle.weekdays.entries()) integerIssue(issues, `/cycle/weekdays/${index}`, day, 1, 7);
    duplicateIssues(issues, "/cycle/weekdays", cycle.weekdays);
  } else if (cycle.type === "dates") {
    if (cycle.dates.length === 0) issues.push({ path: "/cycle/dates", reason: "REQUIRED" });
    if (cycle.dates.length > PRICE_LIMITS.maxAdjustDates) issues.push({ path: "/cycle/dates", reason: "TOO_MANY", detail: { max: PRICE_LIMITS.maxAdjustDates } });
    for (const [index, date] of cycle.dates.entries()) if (!isLocalDate(date)) issues.push({ path: `/cycle/dates/${index}`, reason: "INVALID_DATE" });
    duplicateIssues(issues, "/cycle/dates", cycle.dates);
  } else if (cycle.type === "holidays") {
    if (cycle.countries.length === 0) issues.push({ path: "/cycle/countries", reason: "REQUIRED" });
    if (cycle.countries.length > PRICE_LIMITS.maxAdjustCountries) issues.push({ path: "/cycle/countries", reason: "TOO_MANY", detail: { max: PRICE_LIMITS.maxAdjustCountries } });
    for (const [index, country] of cycle.countries.entries()) if (!isCountryCode(country)) issues.push({ path: `/cycle/countries/${index}`, reason: "INVALID_COUNTRY" });
    duplicateIssues(issues, "/cycle/countries", cycle.countries);
  }

  if (rule.timeSlot !== null) {
    const issue = dailyWindowIssue(rule.timeSlot);
    if (issue !== null) issues.push({ path: "/time_slot", reason: issue });
  }

  duplicateIssues(issues, "/area_ids", rule.areaIds);
  duplicateIssues(issues, "/vehicle_group_ids", rule.vehicleGroupIds);
  if (context.category !== "airport_transfer" && rule.directions.length > 0) issues.push({ path: "/directions", reason: "NOT_APPLICABLE" });
  duplicateIssues(issues, "/directions", rule.directions);
  if (context.category !== "charter" && rule.packageHours.length > 0) issues.push({ path: "/package_hours", reason: "NOT_APPLICABLE" });
  for (const [index, hours] of rule.packageHours.entries()) integerIssue(issues, `/package_hours/${index}`, hours, 1, PRICE_LIMITS.maxPackageHours);
  duplicateIssues(issues, "/package_hours", rule.packageHours);

  if (rule.steps.length === 0) issues.push({ path: "/steps", reason: "REQUIRED" });
  if (rule.steps.length > PRICE_LIMITS.maxAdjustSteps) issues.push({ path: "/steps", reason: "TOO_MANY", detail: { max: PRICE_LIMITS.maxAdjustSteps } });
  for (const [index, step] of rule.steps.entries()) {
    const path = `/steps/${index}/value`;
    if (step.type === "percent") integerIssue(issues, path, step.value, PRICE_LIMITS.minPercentBp, PRICE_LIMITS.maxPercentBp);
    else integerIssue(issues, path, step.value, -PRICE_LIMITS.maxAmountMinor, PRICE_LIMITS.maxAmountMinor);
    if (step.value === 0) issues.push({ path, reason: "ZERO_STEP" });
  }
  return issues;
}

/** 日期（`YYYY-MM-DD`）往前或往后几天。 */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** 星期几：1 = 周一 … 7 = 周日。 */
export function weekdayOf(date: string): number {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() || 7;
}

/** 节假日的查法：`has(国家码, 日期)`。数据来自平台维护的节假日日历。 */
export interface HolidayLookup {
  has(countryCode: string, date: string): boolean;
}

export const NO_HOLIDAYS: HolidayLookup = { has: () => false };

/** 从一批「国家 + 日期」建查法。 */
export function holidayLookup(entries: readonly { countryCode: string; date: string }[]): HolidayLookup {
  const keys = new Set(entries.map((entry) => `${entry.countryCode}|${entry.date}`));
  return { has: (countryCode, date) => keys.has(`${countryCode}|${date}`) };
}

/** 一次用车在调价规则眼里的样子：城市当地的用车日期和时刻（一天里的第几分钟），以及它命中的组合。 */
export interface AdjustMoment {
  date: string;
  minuteOfDay: number;
  areaId: string;
  vehicleGroupId: string;
  direction: TripDirection | null;
  packageHours: number | null;
}

/**
 * 时段算在哪一天头上：不在时段里返回 null；在里面返回这次用车归属的日期——
 * 跨午夜时段的后半段（凌晨）归到前一天，日期范围和周期都按归属的那一天判断。
 */
export function timeSlotDate(slot: DailyWindow | null, date: string, minuteOfDay: number): string | null {
  if (slot === null) return date;
  const start = parseTimeOfDay(slot.start);
  const end = parseTimeOfDay(slot.end, { allowEndOfDay: true });
  if (start === null || end === null || start === end) return null;
  if (start < end) return minuteOfDay >= start && minuteOfDay < end ? date : null;
  if (minuteOfDay >= start) return date;
  return minuteOfDay < end ? addDays(date, -1) : null;
}

/** 调价规则的适用范围（区域、车型组、方向、套餐）包不包括这次用车的组合。 */
function adjustScopeIncludes(rule: Pick<AdjustRule, "areaIds" | "vehicleGroupIds" | "directions" | "packageHours">, moment: Pick<AdjustMoment, "vehicleGroupId" | "direction" | "packageHours"> & { areaId: string | null }): boolean {
  // 区域为空 = 整商品套餐价（ADR 0093 第五节）：报价时按基础价区域匹配调价，哪个区域的调价都可能碰到它
  if (rule.areaIds.length > 0 && moment.areaId !== null && !rule.areaIds.includes(moment.areaId)) return false;
  if (rule.vehicleGroupIds.length > 0 && !rule.vehicleGroupIds.includes(moment.vehicleGroupId)) return false;
  if (rule.directions.length > 0 && (moment.direction === null || !rule.directions.includes(moment.direction))) return false;
  return rule.packageHours.length === 0 || (moment.packageHours !== null && rule.packageHours.includes(moment.packageHours));
}

/** 调价规则在这个时刻生不生效（只看出行日期范围、周期、时段；不看适用范围和启停）。 */
function adjustTimeMatches(rule: Pick<AdjustRule, "timeSlot" | "travelFrom" | "travelTo" | "cycle">, date: string, minuteOfDay: number, holidays: HolidayLookup): boolean {
  const day = timeSlotDate(rule.timeSlot, date, minuteOfDay);
  if (day === null) return false;
  if (rule.travelFrom !== null && day < rule.travelFrom) return false;
  if (rule.travelTo !== null && day > rule.travelTo) return false;
  const cycle = rule.cycle;
  if (cycle.type === "weekly") return cycle.weekdays.includes(weekdayOf(day));
  if (cycle.type === "dates") return cycle.dates.includes(day);
  if (cycle.type === "holidays") return cycle.countries.some((country) => holidays.has(country, day));
  return true;
}

/** 一条调价规则对这次用车生不生效（报价引擎第 7 步的「筛出匹配的调价规则」）。停用的不生效。 */
export function adjustRuleMatches(rule: AdjustRule, moment: AdjustMoment, holidays: HolidayLookup = NO_HOLIDAYS): boolean {
  return rule.status === "enabled" && adjustScopeIncludes(rule, moment) && adjustTimeMatches(rule, moment.date, moment.minuteOfDay, holidays);
}

/** 出行日期范围已经过去（以后不会再生效）。 */
export function adjustRuleHasEnded(rule: Pick<AdjustRule, "travelTo" | "cycle">, today: string): boolean {
  if (rule.travelTo !== null && rule.travelTo < today) return true;
  return rule.cycle.type === "dates" && rule.cycle.dates.every((date) => date < today);
}

/** 一步调价算出来的结果：`delta` 是这一步加（减）了多少，`after` 是这一步之后的数（都是精确值）。 */
export interface AdjustStepResult {
  step: AdjustStep;
  delta: ExactAmount;
  after: ExactAmount;
}

/** 链式执行一条规则的步骤：百分比步以上一步的结果为基数，金额步直接加减。不取整。 */
export function applyAdjustSteps(base: ExactAmount, steps: readonly AdjustStep[]): { steps: AdjustStepResult[]; result: ExactAmount } {
  let current = base;
  const results: AdjustStepResult[] = [];
  for (const step of steps) {
    const after = step.type === "percent" ? times(current, BigInt(10_000 + step.value), 10_000n) : plus(current, exactFromMinor(step.value));
    results.push({ step, delta: minus(after, current), after });
    current = after;
  }
  return { steps: results, result: current };
}

export interface AdjustedPrice<Rule> {
  base: ExactAmount;
  /** 依次执行的规则和每一步的结果 */
  adjusts: { rule: Rule; steps: AdjustStepResult[] }[];
  /** 全部调价之后、取整之前的精确值 */
  unrounded: ExactAmount;
  /**
   * 取整之后的结果（最小货币单位）：按取整单位四舍五入，只取整这一次；没有调价规则命中时也取整。
   * 调完之后不大于 0、或者超过了结算价的上限（`exceedsSettlementLimit(unrounded)`）时为 null——这样的价格不能报。
   */
  finalMinor: number | null;
  /**
   * 价格明细（各项之和等于 finalMinor，尾差计入调价项）：基础价四舍五入到最小货币单位，其余全部算作调价。
   * finalMinor 为 null 时两项都是 null。
   */
  baseMinor: number | null;
  adjustMinor: number | null;
}

/**
 * 调价（报价引擎第 7 步）：传进来的规则应当是已经筛出来的、按优先级排好的；按顺序链式执行，
 * 后一条以前一条的结果为基数。最后按子品牌的取整单位取整（需求文档「取整规则」）。
 */
export function applyAdjustRules<Rule extends { steps: readonly AdjustStep[] }>(base: ExactAmount, rules: readonly Rule[], roundingUnit: number = 1): AdjustedPrice<Rule> {
  let current = base;
  const adjusts: AdjustedPrice<Rule>["adjusts"] = [];
  for (const rule of rules) {
    const applied = applyAdjustSteps(current, rule.steps);
    adjusts.push({ rule, steps: applied.steps });
    current = applied.result;
  }
  // 超过上限的不取整、不报价：结果可以大到放不进 number（几条规则连乘），到这里为止全程是整数分数，不会出错
  const priceable = current.numerator > 0n && !exceedsSettlementLimit(current) && !exceedsSettlementLimit(base);
  const finalMinor = priceable ? roundFractionToUnit(current.numerator, current.denominator, roundingUnit) : null;
  if (finalMinor === null || finalMinor <= 0) return { base, adjusts, unrounded: current, finalMinor: null, baseMinor: null, adjustMinor: null };
  const baseMinor = roundFractionToUnit(base.numerator, base.denominator, 1);
  return { base, adjusts, unrounded: current, finalMinor, baseMinor, adjustMinor: finalMinor - baseMinor };
}

/**
 * 「调得很多」：这条规则单独作用在某个基础价上，结果高于基础价的 4 倍（超过 +300%）或低于一半（低于 −50%）。
 * 只用来在保存前提醒，不拦。
 */
export function adjustRuleIsUnusual(rule: Pick<AdjustRule, "steps">, bases: readonly ExactAmount[]): boolean {
  return bases.some((base) => {
    const { result } = applyAdjustSteps(base, rule.steps);
    return compareExact(result, times(base, 4n)) > 0 || compareExact(result, times(base, 1n, 2n)) < 0;
  });
}

/** 这条调价规则碰不碰得到这条价格（只看组合：区域、车型组、方向、套餐；不看日期和时段）。 */
export function adjustRuleCoversPrice(rule: Pick<AdjustRule, "areaIds" | "vehicleGroupIds" | "directions" | "packageHours">, price: Pick<PriceRule, "areaId" | "vehicleGroupId" | "direction" | "packageHours">): boolean {
  // 区域为空 = 整商品套餐价（ADR 0093 第五节）：哪个区域的调价都可能碰到它
  if (rule.areaIds.length > 0 && price.areaId !== null && !rule.areaIds.includes(price.areaId)) return false;
  if (rule.vehicleGroupIds.length > 0 && !rule.vehicleGroupIds.includes(price.vehicleGroupId)) return false;
  if (rule.directions.length > 0 && price.direction !== null && price.direction !== "both" && !rule.directions.includes(price.direction)) return false;
  return rule.packageHours.length === 0 || (price.packageHours !== null && rule.packageHours.includes(price.packageHours));
}

/**
 * 这条调价规则单独作用在它碰得到的价格上，算下来不大于 0 的有哪些（返回价格的下标）。这样的调价规则不能保存。
 * 基础价按「不超出起步 / 套餐」算（一口价的基础价、里程 + 时长的起步价或最低消费、包车的套餐价）——那是这条价格能报出的最低数。
 * 给了 `roundingUnit` 就看按取整单位取整之后的结果（1,000 调到 0.4、取整到 0 也算）；不调价、光取整就已经不大于 0 的价格
 * 不算在这条规则头上（那是取整单位的问题）。不给就只看取整之前的精确值。
 */
export function adjustRuleNonPositivePrices(rule: Pick<AdjustRule, "steps" | "areaIds" | "vehicleGroupIds" | "directions" | "packageHours">, prices: readonly PriceRule[], roundingUnit?: number): number[] {
  return prices.flatMap((price, index) => {
    if (!adjustRuleCoversPrice(rule, price)) return [];
    const base = basePrice(price.pricing, {}, price.packageHours);
    if (roundingUnit === undefined) return applyAdjustSteps(base, rule.steps).result.numerator > 0n ? [] : [index];
    if (applyAdjustRules(base, [], roundingUnit).finalMinor === null) return [];
    const adjusted = applyAdjustRules(base, [rule], roundingUnit);
    return adjusted.finalMinor === null && !exceedsSettlementLimit(adjusted.unrounded) ? [index] : [];
  });
}

/** 这条调价规则单独作用在它碰得到的价格上，结果超过结算价上限的有哪些（返回价格的下标）。这样的调价规则不能保存。 */
export function adjustRuleOverLimitPrices(rule: Pick<AdjustRule, "steps" | "areaIds" | "vehicleGroupIds" | "directions" | "packageHours">, prices: readonly PriceRule[]): number[] {
  return prices.flatMap((price, index) => {
    if (!adjustRuleCoversPrice(rule, price)) return [];
    const base = basePrice(price.pricing, {}, price.packageHours);
    return !exceedsSettlementLimit(base) && exceedsSettlementLimit(applyAdjustSteps(base, rule.steps).result) ? [index] : [];
  });
}

/** 几条调价规则同时生效时出的问题。 */
export interface AdjustStackProblem {
  /** 是哪几条规则（`adjustRules` 里的下标，按执行顺序） */
  ruleIndexes: number[];
  kind: "NOT_POSITIVE" | "OVER_LIMIT";
  /** 受影响的价格（`priceRules` 里的下标） */
  priceIndexes: number[];
  /** 最早出现的一次：城市当地的日期和时刻 */
  date: string;
  minuteOfDay: number;
  /** 往后看的这段日子里有几天会出现 */
  dayCount: number;
}

/**
 * 调价规则叠加、再按取整单位取整之后的问题（保存单条规则时查不出来的那些）：从 `from` 起往后 `days` 天，
 * 找出每一种「同时生效的规则组合」，把它按顺序作用在每条价格上——
 * - 两条以上叠加之后不大于 0（每条单独都没问题）→ `NOT_POSITIVE`；
 * - 结果超过结算价的上限（一条或几条）→ `OVER_LIMIT`。
 * 基础价按「不超出起步 / 套餐」算。`skipRuleIndexes` 里的规则（单独作用就已经不大于 0 的，另有提示）参与的组合不再重复报。
 * 「同时生效的规则组合」最多看 `PRICE_LIMITS.maxAdjustStackSets` 种（按出现的先后），超出的不看。
 */
export function adjustStackProblems(input: {
  priceRules: readonly PriceRule[];
  adjustRules: readonly AdjustRule[];
  roundingUnit: number;
  from: string;
  days?: number;
  holidays?: HolidayLookup;
  skipRuleIndexes?: readonly number[];
}): AdjustStackProblem[] {
  const holidays = input.holidays ?? NO_HOLIDAYS;
  const enabled = input.adjustRules.flatMap((rule, index) => (rule.status === "enabled" ? [index] : []));
  if (enabled.length === 0 || input.priceRules.length === 0) return [];
  const skip = new Set(input.skipRuleIndexes ?? []);
  const cuts = new Set<number>([0]);
  for (const index of enabled) {
    const slot = (input.adjustRules[index] as AdjustRule).timeSlot;
    if (slot === null) continue;
    for (const minute of [parseTimeOfDay(slot.start), parseTimeOfDay(slot.end, { allowEndOfDay: true })]) if (minute !== null && minute < MINUTES_PER_DAY) cuts.add(minute);
  }
  const minutes = [...cuts].sort((x, y) => x - y);

  // 第一步：每一种「同一时刻生效的规则组合」（不看适用范围），记下最早的一次和出现的日子
  const sets = new Map<string, { indexes: number[]; date: string; minuteOfDay: number; dates: Set<string> }>();
  const days = input.days ?? PRICE_LIMITS.adjustStackDays;
  for (let offset = 0, date = input.from; offset < days; offset += 1, date = addDays(date, 1)) {
    for (const minuteOfDay of minutes) {
      const indexes = enabled.filter((index) => adjustTimeMatches(input.adjustRules[index] as AdjustRule, date, minuteOfDay, holidays));
      if (indexes.length === 0) continue;
      const key = indexes.join(",");
      const seen = sets.get(key);
      if (seen) seen.dates.add(date);
      else if (sets.size < PRICE_LIMITS.maxAdjustStackSets) sets.set(key, { indexes, date, minuteOfDay, dates: new Set([date]) });
    }
  }

  // 第二步：每种组合按适用范围落到每条价格上，算一次
  const problems = new Map<string, AdjustStackProblem & { dates: Set<string>; prices: Set<number> }>();
  const outcomes = new Map<string, "NOT_POSITIVE" | "OVER_LIMIT" | null>();
  for (const set of sets.values()) {
    for (const [priceIndex, price] of input.priceRules.entries()) {
      const base = basePrice(price.pricing, {}, price.packageHours);
      const directions: (TripDirection | null)[] = price.direction === null ? [null] : price.direction === "both" ? [...TRIP_DIRECTIONS] : [price.direction];
      for (const direction of directions) {
        const scoped = set.indexes.filter((index) => adjustScopeIncludes(input.adjustRules[index] as AdjustRule, { areaId: price.areaId, vehicleGroupId: price.vehicleGroupId, direction, packageHours: price.packageHours }));
        if (scoped.length === 0 || scoped.some((index) => skip.has(index))) continue;
        const outcomeKey = `${scoped.join(",")}|${base.numerator}/${base.denominator}`;
        let outcome = outcomes.get(outcomeKey);
        if (outcome === undefined) {
          const adjusted = applyAdjustRules(base, scoped.map((index) => input.adjustRules[index] as AdjustRule), input.roundingUnit);
          const fine = adjusted.finalMinor !== null || applyAdjustRules(base, [], input.roundingUnit).finalMinor === null;
          outcome = fine ? null : exceedsSettlementLimit(adjusted.unrounded) ? "OVER_LIMIT" : scoped.length > 1 ? "NOT_POSITIVE" : null;
          outcomes.set(outcomeKey, outcome);
        }
        if (outcome === null) continue;
        const key = `${outcome}|${scoped.join(",")}`;
        const found = problems.get(key) ?? { ruleIndexes: scoped, kind: outcome, priceIndexes: [], date: set.date, minuteOfDay: set.minuteOfDay, dayCount: 0, dates: new Set<string>(), prices: new Set<number>() };
        if (set.date < found.date || (set.date === found.date && set.minuteOfDay < found.minuteOfDay)) [found.date, found.minuteOfDay] = [set.date, set.minuteOfDay];
        for (const day of set.dates) found.dates.add(day);
        found.prices.add(priceIndex);
        problems.set(key, found);
      }
    }
  }
  return [...problems.values()]
    .map(({ dates, prices, ...problem }) => ({ ...problem, priceIndexes: [...prices].sort((x, y) => x - y), dayCount: dates.size }))
    .sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.minuteOfDay - y.minuteOfDay || x.ruleIndexes.join(",").localeCompare(y.ruleIndexes.join(","))));
}

// ---- 一次用车的结算价（基础价 → 调价 → 取整）----

export type NoPriceReason =
  /** 这个组合没有任何价格规则 */
  | "NO_RULE"
  /** 有，但用车日期不在任何一条的生效期内 */
  | "NOT_IN_EFFECT"
  /** 生效期对得上的那条停用了 */
  | "RULE_DISABLED"
  /** 调价、取整之后不大于 0 */
  | "NOT_POSITIVE"
  /** 结算价超过了上限（`PRICE_LIMITS.maxSettlementMinor`）：只可能是价格或调价规则写错了 */
  | "OVER_LIMIT";

export interface TripPrice<P, A> {
  priceRule: P | null;
  noPriceReason: NoPriceReason | null;
  /** 命中了价格规则时才有 */
  price: AdjustedPrice<A> | null;
}

/**
 * 一个组合在某个用车时刻的结算价：命中价格规则 → 基础价 → 匹配的调价规则按顺序链式执行 → 取整。
 * `adjustRules` 按优先级顺序给（顺序即优先级）。价格日历和以后的报价引擎都用它。
 */
export function tripPrice<P extends PriceRule, A extends AdjustRule>(input: {
  priceRules: readonly P[];
  adjustRules: readonly A[];
  query: PriceQuery;
  minuteOfDay: number;
  usage?: TripUsage;
  roundingUnit: number;
  holidays?: HolidayLookup;
  /** 加在基础价上、和基础价一起被调价的钱（包车的区域加价，ADR 0073）；不给是 0 */
  surchargeMinor?: number;
}): TripPrice<P, A> {
  const { query } = input;
  const rule = selectPriceRule(input.priceRules, query);
  if (rule === null) {
    const sameCombo = input.priceRules.filter(
      (candidate) =>
        !isSurchargeRule(candidate) &&
        ruleAreaMatches(candidate, query) &&
        (candidate.toAreaId ?? null) === (query.toAreaId ?? null) &&
        candidate.vehicleGroupId === query.vehicleGroupId &&
        candidate.packageHours === query.packageHours &&
        (query.direction === null ? candidate.direction === null : candidate.direction === query.direction || candidate.direction === "both"),
    );
    const reason: NoPriceReason = sameCombo.length === 0 ? "NO_RULE" : sameCombo.some((candidate) => priceRuleCoversDate(candidate, query.date)) ? "RULE_DISABLED" : "NOT_IN_EFFECT";
    return { priceRule: null, noPriceReason: reason, price: null };
  }
  const moment: AdjustMoment = { date: query.date, minuteOfDay: input.minuteOfDay, areaId: query.areaId, vehicleGroupId: query.vehicleGroupId, direction: query.direction, packageHours: query.packageHours };
  const matched = input.adjustRules.filter((adjust) => adjustRuleMatches(adjust, moment, input.holidays));
  const base = basePrice(rule.pricing, input.usage, rule.packageHours);
  // 调价作用在「基础定价 + 区域加价」的合计上，和以前作用在套餐价上一样（ADR 0073 第三部分）
  const price = applyAdjustRules(input.surchargeMinor === undefined || input.surchargeMinor === 0 ? base : addExact(base, exactFromMinor(input.surchargeMinor)), matched, input.roundingUnit);
  const noPriceReason: NoPriceReason | null = price.finalMinor !== null ? null : exceedsSettlementLimit(price.unrounded) || exceedsSettlementLimit(price.base) ? "OVER_LIMIT" : "NOT_POSITIVE";
  return { priceRule: rule, noPriceReason, price };
}

// ---- 包车区域加价（ADR 0073 第三部分）----

/** 上车那一端、下车那一端，还是经停点（ADR 0088）：各用各的加价 */
export type SurchargeEnd = "pickup" | "dropoff" | "waypoint";

/**
 * 这个商品挂着的③上下车加价区域：有启用的上下车加价规则（`charter_area_surcharge`）的区域（不看生效日期；按规则的先后，去重）。
 * ②行程加价的区域不算（不参与上下车点匹配，ADR 0093 第三节第 1 条），见 `itineraryAreaIds`。
 */
export function surchargeAreaIds(rules: readonly Pick<PriceRule, "areaId" | "status" | "pricing">[]): string[] {
  return [...new Set(rules.flatMap((rule) => (rule.pricing.model === "charter_area_surcharge" && rule.status === "enabled" && rule.areaId !== null ? [rule.areaId] : [])))];
}

/** 这个商品的②行程区域：有启用的行程加价规则（`charter_itinerary_surcharge`）的区域（不看生效日期；按规则的先后，去重）。M9P-05，ADR 0093 第一节 */
export function itineraryAreaIds(rules: readonly Pick<PriceRule, "areaId" | "status" | "pricing">[]): string[] {
  return [...new Set(rules.flatMap((rule) => (rule.pricing.model === "charter_itinerary_surcharge" && rule.status === "enabled" && rule.areaId !== null ? [rule.areaId] : [])))];
}

export type AreaSurchargeChoice<P> =
  /** 用的是哪个区域的哪条规则、加多少 */
  | { rule: P; areaId: string; amountMinor: number; noPriceReason: null }
  /** 这几个区域对这个车型组、套餐、日期都没有能用的加价 */
  | { rule: null; areaId: null; amountMinor: null; noPriceReason: Exclude<NoPriceReason, "NOT_POSITIVE" | "OVER_LIMIT"> };

/**
 * 一端（上车或下车）在这几个加价区域里时加多少：每个区域找启用、用车日期在生效期内、车型组和套餐时长对得上的区域加价，
 * 默认取这一端最小的加价，`prefer: "highest"` 时取最大的（一样大小都取 `areaIds` 里排在前面的）。一个都没有时给出原因（没有规则 / 不在生效期 / 停用了），口径同 `tripPrice`。
 * 包车报价用 `highest`（M8-38，业主确认）：一个点落在几个加价区域里时用设了加价的那个，都设了取最高。
 * 经停点（`end: "waypoint"`，ADR 0088）：没设途经加价的规则在挑规则这一步就不算（没设 = 这个区域对经停点没有规则），所以都没设时原因是「没有规则」。
 * `threeLayer: true`（迁移过三层区域的商品，M9P-05，ADR 0093 第一节）：经停点改查②行程加价规则（`charter_itinerary_surcharge`），不看③行里的途经加价；
 * 并且认套餐时长为空的加价规则（= 所有套餐）：同一区域先用套餐对得上的那条，这个区域没有能用的才用套餐为空的那条。没迁移过的商品（旧表）不认空套餐。
 */
export function areaSurchargeFor<P extends PriceRule>(
  rules: readonly P[],
  query: { areaIds: readonly string[]; vehicleGroupId: string; packageHours: number | null; date: string; end: SurchargeEnd; prefer?: "lowest" | "highest"; threeLayer?: boolean },
): AreaSurchargeChoice<P> {
  const itinerary = query.end === "waypoint" && query.threeLayer === true;
  const sameCombo = rules.filter(
    (rule) =>
      rule.areaId !== null &&
      query.areaIds.includes(rule.areaId) &&
      rule.vehicleGroupId === query.vehicleGroupId &&
      (rule.packageHours === query.packageHours || (query.threeLayer === true && rule.packageHours === null)) &&
      (itinerary ? rule.pricing.model === "charter_itinerary_surcharge" : rule.pricing.model === "charter_area_surcharge" && (query.end !== "waypoint" || rule.pricing.waypointSurchargeMinor !== undefined)),
  );
  const usable = sameCombo.filter((rule) => rule.status === "enabled" && priceRuleCoversDate(rule, query.date));
  // 每个区域：套餐对得上的能用就用它，否则用套餐为空的
  const perArea = usable.filter((rule) => rule.packageHours !== null || !usable.some((other) => other.areaId === rule.areaId && other.packageHours !== null));
  let best: { rule: P; areaId: string; amountMinor: number; order: number } | null = null;
  for (const rule of perArea) {
    const pricing = rule.pricing;
    const amountMinor =
      pricing.model === "charter_itinerary_surcharge"
        ? pricing.surchargeMinor
        : pricing.model !== "charter_area_surcharge"
          ? 0
          : query.end === "pickup"
            ? pricing.pickupSurchargeMinor
            : query.end === "dropoff"
              ? pricing.dropoffSurchargeMinor
              : (pricing.waypointSurchargeMinor ?? 0);
    const areaId = rule.areaId as string;
    const order = query.areaIds.indexOf(areaId);
    const better = query.prefer === "highest" ? amountMinor > (best?.amountMinor ?? -1) : amountMinor < (best?.amountMinor ?? Number.POSITIVE_INFINITY);
    if (best === null || better || (amountMinor === best.amountMinor && order < best.order)) best = { rule, areaId, amountMinor, order };
  }
  if (best !== null) return { rule: best.rule, areaId: best.areaId, amountMinor: best.amountMinor, noPriceReason: null };
  const reason = sameCombo.length === 0 ? "NO_RULE" : sameCombo.some((rule) => priceRuleCoversDate(rule, query.date)) ? "RULE_DISABLED" : "NOT_IN_EFFECT";
  return { rule: null, areaId: null, amountMinor: null, noPriceReason: reason };
}

/**
 * 包车带区域加价的价（调价规则之前）：套餐价 + 上车加价 + 途经加价 + 下车加价，最小货币单位整数（ADR 0073 第三部分、ADR 0088）。
 * 价格页「这一行的意思」的例子用它（tenant-prices.md 17.2.3、17.10 第 5 条），页面不自己写公式。
 * 每一项都要是不小于 0 的安全整数；合计超出安全整数范围时抛 RangeError（不给出一个可能错的数）。
 */
export function charterPriceWithSurcharges(parts: { packageMinor: number; pickupMinor: number; dropoffMinor: number; waypointMinor?: number }): number {
  const items = [parts.packageMinor, parts.pickupMinor, parts.dropoffMinor, parts.waypointMinor ?? 0];
  for (const minor of items) {
    assertMinor(minor);
    if (minor < 0) throw new RangeError(`包车价的各项不能是负数：${minor}`);
  }
  const total = items.reduce((sum, minor) => sum + BigInt(minor), 0n);
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError(`包车价超出了安全整数范围：${total}`);
  return Number(total);
}

/** 价格日历里一天中的一段：从 `fromMinute`（含）到 `toMinute`（不含），这一段里结果相同。 */
export interface CalendarSegment<P, A> extends TripPrice<P, A> {
  fromMinute: number;
  toMinute: number;
}

/**
 * 价格日历的一天：把这一天按调价规则的时段切开，每一段算一次，相邻的、命中同一批规则的段并在一起。
 * 没有带时段的调价规则时整天是一段。
 */
export function calendarDay<P extends PriceRule, A extends AdjustRule>(input: {
  priceRules: readonly P[];
  adjustRules: readonly A[];
  query: PriceQuery;
  usage?: TripUsage;
  roundingUnit: number;
  holidays?: HolidayLookup;
}): CalendarSegment<P, A>[] {
  const cuts = new Set<number>([0, MINUTES_PER_DAY]);
  for (const rule of input.adjustRules) {
    if (rule.status !== "enabled" || rule.timeSlot === null) continue;
    const start = parseTimeOfDay(rule.timeSlot.start);
    const end = parseTimeOfDay(rule.timeSlot.end, { allowEndOfDay: true });
    if (start !== null) cuts.add(start);
    if (end !== null) cuts.add(end);
  }
  const points = [...cuts].sort((x, y) => x - y);
  const segments: CalendarSegment<P, A>[] = [];
  for (let i = 0; i + 1 < points.length; i += 1) {
    const fromMinute = points[i] as number;
    const priced = tripPrice({ ...input, minuteOfDay: fromMinute });
    const previous = segments[segments.length - 1];
    const sameRules = (a: TripPrice<P, A>, b: TripPrice<P, A>): boolean =>
      a.priceRule === b.priceRule && (a.price?.adjusts.length ?? 0) === (b.price?.adjusts.length ?? 0) && (a.price?.adjusts ?? []).every((entry, index) => entry.rule === b.price?.adjusts[index]?.rule);
    if (previous && sameRules(previous, priced)) previous.toMinute = points[i + 1] as number;
    else segments.push({ ...priced, fromMinute, toMinute: points[i + 1] as number });
  }
  return segments;
}

// ---- 缺价的组合 ----

export interface PriceCombo {
  /** 区域；迁移过三层区域的包车按整商品套餐价统计，为 null（ADR 0093 第五节） */
  areaId: string | null;
  vehicleGroupId: string;
  direction: TripDirection | null;
  packageHours: number | null;
  /**
   * - `priced`：今天就有启用、生效中的价格；
   * - `upcoming`：有启用、没过期的价格，但要到以后某一天才开始生效（`from` 是哪天）；
   * - `missing`：没有启用且没过期的价格——客人询价时报不出价。
   */
  state: "priced" | "upcoming" | "missing";
  /** 用的是哪一条（`rules` 里的下标）；missing 时为 null */
  ruleIndex: number | null;
  /** 接送机：用的是不是「接送通用」的价 */
  viaBoth: boolean;
  from: string | null;
}

export interface PriceCoverage {
  total: number;
  /** priced + upcoming 的个数 */
  priced: number;
  /** 包车：出现过的套餐时长（从小到大）；其他品类为空 */
  packages: number[];
  combos: PriceCombo[];
}

/**
 * 「该有价格的组合」和每个组合现在的情况：
 * - 接送机：区域 × 车型组 × 2（接机、送机）；点对点：区域 × 车型组；
 * - 包车：区域 × 车型组 × 套餐（套餐 = 这个商品现有价格里出现过的套餐时长）。
 * 「有价格」= 有一条启用、还没过期的价格（方向是它自己或「接送通用」）。缺价不是错，不拦保存和上架。
 * `productWide`（迁移过三层区域的包车，ADR 0093 第五节）：按整商品套餐价统计「车型组 × 套餐」，区域为 null；按服务区域的旧行不算。
 */
export function priceCoverage(input: { category: ServiceCategory; areaIds: readonly string[]; vehicleGroupIds: readonly string[]; rules: readonly PriceRule[]; today: string; productWide?: boolean }): PriceCoverage {
  const { category, today } = input;
  const wide = input.productWide === true;
  // 区域加价、线路价不是「该有的价格」：缺价统计只看区域的基础定价（ADR 0073 第五部分）；整商品统计时只看区域为空的
  const rules = input.rules.map((rule) => (isSurchargeRule(rule) || isRouteRule(rule) || wide !== (rule.areaId === null) ? null : rule));
  const baseRules = rules.filter((rule): rule is PriceRule => rule !== null);
  const packages = category === "charter" ? [...new Set(baseRules.flatMap((rule) => (rule.packageHours === null ? [] : [rule.packageHours])))].sort((x, y) => x - y) : [];
  const variants: { direction: TripDirection | null; packageHours: number | null }[] =
    category === "airport_transfer" ? TRIP_DIRECTIONS.map((direction) => ({ direction, packageHours: null })) : category === "charter" ? packages.map((packageHours) => ({ direction: null, packageHours })) : [{ direction: null, packageHours: null }];
  const combos: PriceCombo[] = [];
  for (const areaId of wide ? [null] : input.areaIds) {
    for (const vehicleGroupId of input.vehicleGroupIds) {
      for (const variant of variants) {
        const candidates = rules
          .flatMap((rule, index) => (rule === null ? [] : [{ rule, index }]))
          .filter(({ rule }) => rule.areaId === areaId && rule.vehicleGroupId === vehicleGroupId && rule.packageHours === variant.packageHours && priceRuleIsActive(rule, today))
          .filter(({ rule }) => (variant.direction === null ? rule.direction === null : rule.direction === variant.direction || rule.direction === "both"));
        // 今天生效的优先（其中具体方向优先于通用）；否则取最早开始的那条
        const rank = ({ rule }: { rule: PriceRule }): [number, number, string] => [rule.validFrom <= today ? 0 : 1, rule.direction === "both" ? 1 : 0, rule.validFrom];
        const best = candidates.sort((x, y) => {
          const [a, b] = [rank(x), rank(y)];
          return a[0] - b[0] || (a[0] === 0 ? a[1] - b[1] : a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : a[1] - b[1]);
        })[0];
        combos.push({
          areaId,
          vehicleGroupId,
          ...variant,
          state: best === undefined ? "missing" : best.rule.validFrom <= today ? "priced" : "upcoming",
          ruleIndex: best?.index ?? null,
          viaBoth: best?.rule.direction === "both",
          from: best === undefined ? null : best.rule.validFrom,
        });
      }
    }
  }
  return { total: combos.length, priced: combos.filter((combo) => combo.state !== "missing").length, packages, combos };
}

// ---- 三层区域迁移的「套餐价不一致」（M9P-05，ADR 0093 第六节第 1 小节）----

/** 一条包车套餐价的条款（比较新旧套餐价用） */
export interface CharterPackageTerms {
  packagePriceMinor: number;
  packageKm: number;
  overtimePerHourMinor: number;
  overKmPerKmMinor: number;
  validTo: string | null;
  status: PriceRuleStatus;
}

export interface CharterMigrationDiffEntry {
  /** 旧的按服务区域的套餐价 */
  oldRuleId: string;
  areaId: string;
  vehicleGroupId: string;
  packageHours: number | null;
  validFrom: string;
  old: CharterPackageTerms;
  /** 对应的整商品套餐价（同车型组、套餐、生效开始日）；没有为 null */
  productRuleId: string | null;
  product: CharterPackageTerms | null;
}

function packageTerms(rule: PriceRule): CharterPackageTerms | null {
  const pricing = rule.pricing;
  if (pricing.model !== "charter_package") return null;
  return { packagePriceMinor: pricing.packagePriceMinor, packageKm: pricing.packageKm, overtimePerHourMinor: pricing.overtimePerHourMinor, overKmPerKmMinor: pricing.overKmPerKmMinor, validTo: rule.validTo, status: rule.status };
}

/**
 * 迁移过三层区域的商品：保留的旧按服务区域套餐价里，和整商品套餐价（同车型组、套餐、生效开始日）不一样的那些（含整商品没有对应行的）。
 * 不存，随时由保留的旧行现算（ADR 0093 第六节第 1 小节）。按规则的先后。
 */
export function charterMigrationDiff<P extends PriceRule & { id: string }>(rules: readonly P[]): CharterMigrationDiffEntry[] {
  const wide = rules.filter((rule) => rule.pricing.model === "charter_package" && rule.areaId === null);
  return rules.flatMap((rule): CharterMigrationDiffEntry[] => {
    const old = packageTerms(rule);
    if (old === null || rule.areaId === null) return [];
    const match = wide.find((entry) => entry.vehicleGroupId === rule.vehicleGroupId && entry.packageHours === rule.packageHours && entry.validFrom === rule.validFrom);
    const product = match === undefined ? null : packageTerms(match);
    if (product !== null && JSON.stringify(product) === JSON.stringify(old)) return [];
    return [{ oldRuleId: rule.id, areaId: rule.areaId, vehicleGroupId: rule.vehicleGroupId, packageHours: rule.packageHours, validFrom: rule.validFrom, old, productRuleId: match?.id ?? null, product }];
  });
}
