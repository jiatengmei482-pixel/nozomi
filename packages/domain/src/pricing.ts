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
import { type CurrencyCode, minorDigits, roundFractionHalfAwayFromZero, roundFractionToUnit } from "./money.ts";
import { type DailyWindow, MINUTES_PER_DAY, dailyWindowIssue, isLocalDate, parseTimeOfDay } from "./service-time.ts";

// ---- 枚举和上限 ----

export const PRICING_MODELS = ["fixed", "mileage_time", "charter_package"] as const;
export type PricingModel = (typeof PRICING_MODELS)[number];
export const PRICING_MODEL_NAMES: Readonly<Record<PricingModel, string>> = { fixed: "固定一口价", mileage_time: "里程 + 时长", charter_package: "包车套餐" };

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

/** 这个品类的商品可以用哪几种计价方式（需求文档的表）。 */
export function pricingModelsFor(category: ServiceCategory): PricingModel[] {
  return category === "charter" ? ["charter_package"] : ["fixed", "mileage_time"];
}

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

export function compareExact(a: ExactAmount, b: ExactAmount): number {
  const difference = a.numerator * b.denominator - b.numerator * a.denominator;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
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

/** 固定一口价：基础价。 */
export interface FixedPricing {
  model: "fixed";
  basePriceMinor: number;
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

export type Pricing = FixedPricing | MileageTimePricing | CharterPackagePricing;

/**
 * 一条价格规则 = 区域 × 车型组 ×（接送机：方向；包车：套餐时长）× 生效日期（用车日期，两端都含）的一条报价，带启停状态。
 */
export interface PriceRule {
  areaId: string;
  vehicleGroupId: string;
  /** 接送机必填；其他品类为 null */
  direction: PriceDirection | null;
  /** 包车必填（小时）；其他品类为 null */
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
  | "ZERO_STEP";

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

/** 一条价格规则「写得对不对」。没有问题返回空数组。区域、车型组是不是这个商品选的，由保存的地方查。 */
export function priceRuleIssues(rule: PriceRule, context: { category: ServiceCategory }): PriceIssue[] {
  const issues: PriceIssue[] = [];
  const max = PRICE_LIMITS.maxAmountMinor;
  if (context.category === "airport_transfer") {
    if (rule.direction === null) issues.push({ path: "/direction", reason: "REQUIRED" });
  } else if (rule.direction !== null) issues.push({ path: "/direction", reason: "NOT_APPLICABLE" });
  if (context.category === "charter") {
    if (rule.packageHours === null) issues.push({ path: "/package_hours", reason: "REQUIRED" });
    else integerIssue(issues, "/package_hours", rule.packageHours, 1, PRICE_LIMITS.maxPackageHours);
  } else if (rule.packageHours !== null) issues.push({ path: "/package_hours", reason: "NOT_APPLICABLE" });

  const pricing = rule.pricing;
  if (!pricingModelsFor(context.category).includes(pricing.model)) issues.push({ path: "/pricing_model", reason: "MODEL_NOT_ALLOWED" });
  if (pricing.model === "fixed") integerIssue(issues, "/base_price", pricing.basePriceMinor, 1, max);
  else if (pricing.model === "mileage_time") {
    integerIssue(issues, "/start_price", pricing.startPriceMinor, 0, max);
    integerIssue(issues, "/start_meters", pricing.startMeters, 0, PRICE_LIMITS.maxStartMeters);
    if (Number.isInteger(pricing.startMeters) && pricing.startMeters % PRICE_LIMITS.startMetersStep !== 0) issues.push({ path: "/start_meters", reason: "OUT_OF_RANGE", detail: { step: PRICE_LIMITS.startMetersStep } });
    integerIssue(issues, "/start_minutes", pricing.startMinutes, 0, PRICE_LIMITS.maxStartMinutes);
    integerIssue(issues, "/per_km", pricing.perKmMinor, 0, max);
    integerIssue(issues, "/per_minute", pricing.perMinuteMinor, 0, max);
    if (pricing.minPriceMinor !== null) integerIssue(issues, "/min_price", pricing.minPriceMinor, 1, max);
    // 起步价是 0 时必须有最低消费或单价，否则零里程的行程算出来是 0
    if (pricing.startPriceMinor === 0 && pricing.minPriceMinor === null) issues.push({ path: "/start_price", reason: "OUT_OF_RANGE", detail: { min: 1, max } });
  } else {
    integerIssue(issues, "/package_km", pricing.packageKm, 1, PRICE_LIMITS.maxPackageKm);
    integerIssue(issues, "/package_price", pricing.packagePriceMinor, 1, max);
    integerIssue(issues, "/overtime_per_hour", pricing.overtimePerHourMinor, 0, max);
    integerIssue(issues, "/over_km_per_km", pricing.overKmPerKmMinor, 0, max);
  }
  dateRangeIssues(issues, "/valid_from", rule.validFrom, "/valid_to", rule.validTo);
  return issues;
}

/** 唯一性的组合键：区域 + 车型组 + 方向或套餐时长。计价方式不在里面——同一个组合同一天只能有一条价格。 */
export function priceRuleComboKey(rule: Pick<PriceRule, "areaId" | "vehicleGroupId" | "direction" | "packageHours">): string {
  return `${rule.areaId}|${rule.vehicleGroupId}|${rule.direction ?? ""}|${rule.packageHours ?? ""}`;
}

/** 两段生效日期有没有重叠。两端都含：「到 03-31」和「从 03-31」是重叠的；没有结束日期 = 一直有效。 */
export function dateRangesOverlap(a: { validFrom: string; validTo: string | null }, b: { validFrom: string; validTo: string | null }): boolean {
  return (b.validTo === null || a.validFrom <= b.validTo) && (a.validTo === null || b.validFrom <= a.validTo);
}

/**
 * 找出违反唯一性的每一对：同一个组合、生效日期重叠（需求文档）。停用的也算——否则一启用就撞上。
 * 返回的是下标对（i < j），按出现的先后。
 */
export function findPriceRuleOverlaps(rules: readonly Pick<PriceRule, "areaId" | "vehicleGroupId" | "direction" | "packageHours" | "validFrom" | "validTo">[]): [number, number][] {
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
}

/**
 * 命中价格规则（报价引擎第 5 步）：区域 × 车型组 × 方向或套餐，启用且用车日期在生效期内。
 * 接送机「接送通用」和具体方向同时存在时，以更具体的为准（需求文档）。没有命中返回 null。
 */
export function selectPriceRule<T extends PriceRule>(rules: readonly T[], query: PriceQuery): T | null {
  const candidates = rules.filter(
    (rule) => rule.status === "enabled" && rule.areaId === query.areaId && rule.vehicleGroupId === query.vehicleGroupId && rule.packageHours === query.packageHours && priceRuleCoversDate(rule, query.date),
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
 * - 固定一口价：P = 基础价
 * - 里程 + 时长：P = max(P_min, P_start + max(0, D − D_start) × p_km + max(0, T − T_start) × p_min)
 * - 包车套餐：P = P_pkg + max(0, H − H_pkg) × p_hour + max(0, D − D_pkg) × p_km
 * 里程按米、时长按分钟给，换算成公里、小时时不取整（超出 500 米就收 0.5 公里的钱）。没给的用量按「不超出」算。
 */
export function basePrice(pricing: Pricing, usage: TripUsage = {}, packageHours: number | null = null): ExactAmount {
  const meters = BigInt(Math.max(0, Math.trunc(usage.meters ?? 0)));
  const minutes = BigInt(Math.max(0, Math.trunc(usage.minutes ?? 0)));
  const over = (used: bigint, included: bigint): bigint => (used > included ? used - included : 0n);
  if (pricing.model === "fixed") return exactFromMinor(pricing.basePriceMinor);
  if (pricing.model === "mileage_time") {
    const byDistance = times(exactFromMinor(pricing.perKmMinor), over(meters, BigInt(pricing.startMeters)), 1_000n);
    const byTime = times(exactFromMinor(pricing.perMinuteMinor), over(minutes, BigInt(pricing.startMinutes)));
    const total = plus(plus(exactFromMinor(pricing.startPriceMinor), byDistance), byTime);
    const floor = pricing.minPriceMinor === null ? null : exactFromMinor(pricing.minPriceMinor);
    return floor !== null && compareExact(total, floor) < 0 ? floor : total;
  }
  const overtime = times(exactFromMinor(pricing.overtimePerHourMinor), over(minutes, BigInt((packageHours ?? 0) * 60)), 60n);
  const overDistance = times(exactFromMinor(pricing.overKmPerKmMinor), over(meters, BigInt(pricing.packageKm) * 1_000n), 1_000n);
  return plus(plus(exactFromMinor(pricing.packagePriceMinor), overtime), overDistance);
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

/** 一条调价规则对这次用车生不生效（报价引擎第 7 步的「筛出匹配的调价规则」）。停用的不生效。 */
export function adjustRuleMatches(rule: AdjustRule, moment: AdjustMoment, holidays: HolidayLookup = NO_HOLIDAYS): boolean {
  if (rule.status !== "enabled") return false;
  if (rule.areaIds.length > 0 && !rule.areaIds.includes(moment.areaId)) return false;
  if (rule.vehicleGroupIds.length > 0 && !rule.vehicleGroupIds.includes(moment.vehicleGroupId)) return false;
  if (rule.directions.length > 0 && (moment.direction === null || !rule.directions.includes(moment.direction))) return false;
  if (rule.packageHours.length > 0 && (moment.packageHours === null || !rule.packageHours.includes(moment.packageHours))) return false;
  const date = timeSlotDate(rule.timeSlot, moment.date, moment.minuteOfDay);
  if (date === null) return false;
  if (rule.travelFrom !== null && date < rule.travelFrom) return false;
  if (rule.travelTo !== null && date > rule.travelTo) return false;
  const cycle = rule.cycle;
  if (cycle.type === "weekly") return cycle.weekdays.includes(weekdayOf(date));
  if (cycle.type === "dates") return cycle.dates.includes(date);
  if (cycle.type === "holidays") return cycle.countries.some((country) => holidays.has(country, date));
  return true;
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
   * 调完之后不大于 0 时为 null——这样的价格不能报。
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
  const finalMinor = current.numerator > 0n ? roundFractionToUnit(current.numerator, current.denominator, roundingUnit) : null;
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
  if (rule.areaIds.length > 0 && !rule.areaIds.includes(price.areaId)) return false;
  if (rule.vehicleGroupIds.length > 0 && !rule.vehicleGroupIds.includes(price.vehicleGroupId)) return false;
  if (rule.directions.length > 0 && price.direction !== null && price.direction !== "both" && !rule.directions.includes(price.direction)) return false;
  return rule.packageHours.length === 0 || (price.packageHours !== null && rule.packageHours.includes(price.packageHours));
}

/**
 * 这条调价规则单独作用在它碰得到的价格上，算下来不大于 0 的有哪些（返回价格的下标）。这样的调价规则不能保存。
 * 基础价按「不超出起步 / 套餐」算（一口价的基础价、里程 + 时长的起步价或最低消费、包车的套餐价）——那是这条价格能报出的最低数。
 */
export function adjustRuleNonPositivePrices(rule: Pick<AdjustRule, "steps" | "areaIds" | "vehicleGroupIds" | "directions" | "packageHours">, prices: readonly PriceRule[]): number[] {
  return prices.flatMap((price, index) => {
    if (!adjustRuleCoversPrice(rule, price)) return [];
    return applyAdjustSteps(basePrice(price.pricing, {}, price.packageHours), rule.steps).result.numerator > 0n ? [] : [index];
  });
}

// ---- 一次用车的结算价（基础价 → 调价 → 取整）----

export type NoPriceReason =
  /** 这个组合没有任何价格规则 */
  | "NO_RULE"
  /** 有，但用车日期不在任何一条的生效期内 */
  | "NOT_IN_EFFECT"
  /** 生效期对得上的那条停用了 */
  | "RULE_DISABLED"
  /** 调价之后不大于 0 */
  | "NOT_POSITIVE";

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
}): TripPrice<P, A> {
  const { query } = input;
  const rule = selectPriceRule(input.priceRules, query);
  if (rule === null) {
    const sameCombo = input.priceRules.filter(
      (candidate) =>
        candidate.areaId === query.areaId &&
        candidate.vehicleGroupId === query.vehicleGroupId &&
        candidate.packageHours === query.packageHours &&
        (query.direction === null ? candidate.direction === null : candidate.direction === query.direction || candidate.direction === "both"),
    );
    const reason: NoPriceReason = sameCombo.length === 0 ? "NO_RULE" : sameCombo.some((candidate) => priceRuleCoversDate(candidate, query.date)) ? "RULE_DISABLED" : "NOT_IN_EFFECT";
    return { priceRule: null, noPriceReason: reason, price: null };
  }
  const moment: AdjustMoment = { date: query.date, minuteOfDay: input.minuteOfDay, areaId: query.areaId, vehicleGroupId: query.vehicleGroupId, direction: query.direction, packageHours: query.packageHours };
  const matched = input.adjustRules.filter((adjust) => adjustRuleMatches(adjust, moment, input.holidays));
  const price = applyAdjustRules(basePrice(rule.pricing, input.usage, rule.packageHours), matched, input.roundingUnit);
  return { priceRule: rule, noPriceReason: price.finalMinor === null ? "NOT_POSITIVE" : null, price };
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
  areaId: string;
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
 */
export function priceCoverage(input: { category: ServiceCategory; areaIds: readonly string[]; vehicleGroupIds: readonly string[]; rules: readonly PriceRule[]; today: string }): PriceCoverage {
  const { category, rules, today } = input;
  const packages = category === "charter" ? [...new Set(rules.flatMap((rule) => (rule.packageHours === null ? [] : [rule.packageHours])))].sort((x, y) => x - y) : [];
  const variants: { direction: TripDirection | null; packageHours: number | null }[] =
    category === "airport_transfer" ? TRIP_DIRECTIONS.map((direction) => ({ direction, packageHours: null })) : category === "charter" ? packages.map((packageHours) => ({ direction: null, packageHours })) : [{ direction: null, packageHours: null }];
  const combos: PriceCombo[] = [];
  for (const areaId of input.areaIds) {
    for (const vehicleGroupId of input.vehicleGroupIds) {
      for (const variant of variants) {
        const candidates = rules
          .map((rule, index) => ({ rule, index }))
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
