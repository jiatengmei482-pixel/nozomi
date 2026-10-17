/**
 * 渠道与加价规则（M2-04，ADR 0023）。纯函数，不碰数据库和网络。
 *
 * 需求：《平台运营端与渠道对接》「渠道管理」（渠道类型、配置项、授权范围）、「加价规则」（五级匹配、命中第一条即停、日期范围）、
 * 「汇率缓冲与加价下限」（每个渠道设最低加价比例，默认 10%；加价规则低于下限时系统拦截）；
 * 《用车报价服务平台》第 10、11 步（价格带 δ 由渠道配，0–5%，默认 3%；加价比例不得低于渠道下限）。
 *
 * 百分比一律是基点整数（1% = 100），金额是最小货币单位整数（规则 3）。
 */
import { CURRENCIES, type CurrencyCode, isCurrencyCode } from "./money.ts";
import { SERVICE_CATEGORIES, type ServiceCategory } from "./master-data.ts";
import { QUOTE_RULES } from "./quote.ts";

export const CHANNEL_TYPES = ["own", "api", "ota", "offline"] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

/** 测试（可以调接口联调）/ 启用 / 暂停（`/sales/v1` 一律拒绝） */
export const CHANNEL_STATUSES = ["testing", "active", "paused"] as const;
export type ChannelStatus = (typeof CHANNEL_STATUSES)[number];

/** 可卖的租户：全部 / 只卖名单里的 / 名单里的不卖 */
export const TENANT_SCOPES = ["all", "allow", "deny"] as const;
export type TenantScope = (typeof TENANT_SCOPES)[number];

export const PAYMENT_MODES = ["prepaid", "credit"] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

export const CHANNEL_RULES = {
  /** 平台的加价下限：渠道的下限不得低于它（第五轮决策 ⑥：渠道最低加价 10%） */
  platformMarkupFloorBp: QUOTE_RULES.defaultMarkupFloorBp,
  /** 新建渠道时的默认值：下限 10%、默认加价 10%、价格带 3% */
  defaultMarkupFloorBp: QUOTE_RULES.defaultMarkupFloorBp,
  defaultMarkupBp: QUOTE_RULES.defaultMarkupFloorBp,
  defaultBandBp: QUOTE_RULES.defaultBandBp,
  maxBandBp: QUOTE_RULES.maxBandBp,
  maxMarkupBp: QUOTE_RULES.maxMarkupBp,
  /** 最低毛利金额、额度的上限（最小货币单位）：防止写错 */
  maxMoneyMinor: 1_000_000_000_000,
  /** 对外价取整单位的上限（最小货币单位） */
  maxRoundingUnit: 1_000_000,
} as const;

// ---- 渠道的定价参数 ----

/** 对外价取整：客人支付这种币种时，对外价向上取整到这个单位（最小货币单位；1 = 不取整）。没写的币种不取整。 */
export type SellRounding = Partial<Record<CurrencyCode, number>>;

/** 渠道上和定价有关的配置：改它们要走双人复核（ADR 0023）。 */
export interface ChannelPricing {
  defaultMarkupBp: number;
  markupFloorBp: number;
  bandBp: number;
  /** 最低毛利金额（渠道结算币种的最小货币单位），0 = 不设 */
  minMarginMinor: number;
  sellRounding: SellRounding;
}

export type ChannelIssue = { path: string; reason: "OUT_OF_RANGE" | "BELOW_PLATFORM_FLOOR" | "BELOW_FLOOR" | "UNSUPPORTED_CURRENCY" | "NOT_INTEGER" };

const isBp = (value: number, max: number): boolean => Number.isInteger(value) && value >= 0 && value <= max;

/** 渠道定价参数的问题（空数组 = 没问题）。下限不得低于平台下限，默认加价不得低于下限，价格带 0–5%。 */
export function channelPricingIssues(pricing: ChannelPricing): ChannelIssue[] {
  const issues: ChannelIssue[] = [];
  if (!isBp(pricing.markupFloorBp, CHANNEL_RULES.maxMarkupBp)) issues.push({ path: "/markup_floor_bp", reason: "OUT_OF_RANGE" });
  else if (pricing.markupFloorBp < CHANNEL_RULES.platformMarkupFloorBp) issues.push({ path: "/markup_floor_bp", reason: "BELOW_PLATFORM_FLOOR" });
  if (!isBp(pricing.defaultMarkupBp, CHANNEL_RULES.maxMarkupBp)) issues.push({ path: "/default_markup_bp", reason: "OUT_OF_RANGE" });
  else if (pricing.defaultMarkupBp < Math.max(pricing.markupFloorBp, CHANNEL_RULES.platformMarkupFloorBp)) issues.push({ path: "/default_markup_bp", reason: "BELOW_FLOOR" });
  if (!isBp(pricing.bandBp, CHANNEL_RULES.maxBandBp)) issues.push({ path: "/band_bp", reason: "OUT_OF_RANGE" });
  if (!Number.isSafeInteger(pricing.minMarginMinor) || pricing.minMarginMinor < 0 || pricing.minMarginMinor > CHANNEL_RULES.maxMoneyMinor) issues.push({ path: "/min_margin", reason: "OUT_OF_RANGE" });
  for (const [currency, unit] of Object.entries(pricing.sellRounding)) {
    if (!isCurrencyCode(currency)) issues.push({ path: `/sell_rounding/${currency}`, reason: "UNSUPPORTED_CURRENCY" });
    else if (!Number.isSafeInteger(unit) || (unit as number) < 1 || (unit as number) > CHANNEL_RULES.maxRoundingUnit) issues.push({ path: `/sell_rounding/${currency}`, reason: "OUT_OF_RANGE" });
  }
  return issues;
}

/** 两份定价参数是否一样（取整的币种顺序不算不同）。 */
export function samePricing(a: ChannelPricing, b: ChannelPricing): boolean {
  const rounding = (value: SellRounding): string => JSON.stringify(Object.keys(CURRENCIES).flatMap((code) => (value[code as CurrencyCode] === undefined ? [] : [[code, value[code as CurrencyCode]]])));
  return a.defaultMarkupBp === b.defaultMarkupBp && a.markupFloorBp === b.markupFloorBp && a.bandBp === b.bandBp && a.minMarginMinor === b.minMarginMinor && rounding(a.sellRounding) === rounding(b.sellRounding);
}

// ---- 授权范围 ----

export interface ChannelScope {
  tenantScope: TenantScope;
  /** 白名单或黑名单里的租户；`all` 时为空 */
  tenantIds: readonly string[];
  /** 可卖的城市；null = 全部城市 */
  cityIds: readonly string[] | null;
  /** 可卖的品类（至少一个） */
  categories: readonly ServiceCategory[];
}

/** 这个渠道能不能卖这个租户的商品。 */
export function channelSellsTenant(scope: Pick<ChannelScope, "tenantScope" | "tenantIds">, tenantId: string): boolean {
  if (scope.tenantScope === "all") return true;
  const listed = scope.tenantIds.includes(tenantId);
  return scope.tenantScope === "allow" ? listed : !listed;
}

export type ScopeRefusal = "CITY_NOT_AUTHORIZED" | "CATEGORY_NOT_AUTHORIZED";

/** 这次询价的城市和品类在不在渠道的授权范围里；在的话返回 null。 */
export function channelScopeRefusal(scope: Pick<ChannelScope, "cityIds" | "categories">, cityId: string, category: ServiceCategory): ScopeRefusal | null {
  if (scope.cityIds !== null && !scope.cityIds.includes(cityId)) return "CITY_NOT_AUTHORIZED";
  if (!scope.categories.includes(category)) return "CATEGORY_NOT_AUTHORIZED";
  return null;
}

export function isServiceCategoryList(values: readonly string[]): values is ServiceCategory[] {
  return values.every((value) => (SERVICE_CATEGORIES as readonly string[]).includes(value));
}

// ---- 加价规则（五级匹配）----

/**
 * 五级（《平台运营端》「加价规则」，从具体到通用，命中第一条即停）：
 * 1 渠道 × 租户 × 城市 × 品类 × 车型组；2 渠道 × 租户；3 渠道 × 城市 × 品类 × 车型组；4 渠道 × 城市 × 品类；5 渠道默认。
 * 第 5 级的「渠道默认」是渠道自己的默认加价比例；第 5 级的规则只用于「带日期范围的全渠道促销」，所以必须带日期。
 */
export type MarkupLevel = 1 | 2 | 3 | 4 | 5;
export const MARKUP_LEVELS: readonly MarkupLevel[] = [1, 2, 3, 4, 5];

export interface MarkupDimensions {
  tenantId: string | null;
  cityId: string | null;
  category: ServiceCategory | null;
  vehicleGroupId: string | null;
}

export interface MarkupRule extends MarkupDimensions {
  id: string;
  markupBp: number;
  /** 用车日期（城市当地）的范围，两端都含；null = 不限 */
  validFrom: string | null;
  validTo: string | null;
}

/** 这组维度对应哪一级；不是五种组合之一返回 null。 */
export function markupLevelOf(dims: MarkupDimensions): MarkupLevel | null {
  const t = dims.tenantId !== null;
  const c = dims.cityId !== null;
  const k = dims.category !== null;
  const v = dims.vehicleGroupId !== null;
  if (t && c && k && v) return 1;
  if (t && !c && !k && !v) return 2;
  if (!t && c && k && v) return 3;
  if (!t && c && k && !v) return 4;
  if (!t && !c && !k && !v) return 5;
  return null;
}

export interface MarkupQuery {
  tenantId: string;
  cityId: string;
  category: ServiceCategory;
  vehicleGroupId: string;
  /** 用车日期（城市当地）`YYYY-MM-DD` */
  serviceDate: string;
}

export interface MarkupMatch {
  markupBp: number;
  level: MarkupLevel;
  /** 命中的规则；用的是渠道的默认加价比例时为 null */
  ruleId: string | null;
}

function dimsMatch(rule: MarkupDimensions, query: MarkupQuery): boolean {
  return (
    (rule.tenantId === null || rule.tenantId === query.tenantId) &&
    (rule.cityId === null || rule.cityId === query.cityId) &&
    (rule.category === null || rule.category === query.category) &&
    (rule.vehicleGroupId === null || rule.vehicleGroupId === query.vehicleGroupId)
  );
}

const dated = (rule: Pick<MarkupRule, "validFrom" | "validTo">): boolean => rule.validFrom !== null || rule.validTo !== null;

/** 用车日期在不在规则的日期范围里（两端都含）。 */
export function markupRuleInEffect(rule: Pick<MarkupRule, "validFrom" | "validTo">, serviceDate: string): boolean {
  return (rule.validFrom === null || rule.validFrom <= serviceDate) && (rule.validTo === null || serviceDate <= rule.validTo);
}

/**
 * 这次询价（租户 × 城市 × 品类 × 车型组 × 用车日期）适用的加价比例。
 * 从第 1 级往下找，**命中第一级就停**；同一级里带日期范围（促销期）且用车日期在范围里的优先于不带日期的
 * （同一组维度上，带日期的规则互不重叠、不带日期的最多一条，保存时拦截，所以每级最多命中两条）。
 * 都没有命中用渠道的默认加价比例（第 5 级）。不在这里套下限：下限在算对外价时套（`sellPrice`），快照里记实际用的那个。
 */
export function resolveMarkup(pricing: { defaultMarkupBp: number; rules: readonly MarkupRule[] }, query: MarkupQuery): MarkupMatch {
  for (const level of MARKUP_LEVELS) {
    const hits = pricing.rules.filter((rule) => markupLevelOf(rule) === level && dimsMatch(rule, query) && markupRuleInEffect(rule, query.serviceDate));
    if (hits.length === 0) continue;
    const best = [...hits].sort((a, b) => Number(dated(b)) - Number(dated(a)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0] as MarkupRule;
    return { markupBp: best.markupBp, level, ruleId: best.id };
  }
  return { markupBp: pricing.defaultMarkupBp, level: 5, ruleId: null };
}

export type MarkupRuleIssue = {
  path: string;
  reason: "UNSUPPORTED_COMBINATION" | "OUT_OF_RANGE" | "BELOW_FLOOR" | "DATE_ORDER" | "INVALID_DATE" | "DATES_REQUIRED";
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
function realDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * 一条加价规则本身的问题（不看别的规则）：维度组合必须是五级之一；比例是基点整数且**不低于渠道下限**（「加价规则低于下限时系统拦截」）；
 * 日期是真实的日期、开始不晚于结束；第 5 级（全渠道）的规则必须带日期范围（不带日期的全渠道比例就是渠道的默认加价比例）。
 */
export function markupRuleIssues(rule: Omit<MarkupRule, "id">, floorBp: number): MarkupRuleIssue[] {
  const issues: MarkupRuleIssue[] = [];
  const level = markupLevelOf(rule);
  if (level === null) issues.push({ path: "/", reason: "UNSUPPORTED_COMBINATION" });
  if (!isBp(rule.markupBp, CHANNEL_RULES.maxMarkupBp)) issues.push({ path: "/markup_bp", reason: "OUT_OF_RANGE" });
  else if (rule.markupBp < Math.max(floorBp, CHANNEL_RULES.platformMarkupFloorBp)) issues.push({ path: "/markup_bp", reason: "BELOW_FLOOR" });
  for (const key of ["validFrom", "validTo"] as const) {
    const value = rule[key];
    if (value !== null && !realDate(value)) issues.push({ path: key === "validFrom" ? "/valid_from" : "/valid_to", reason: "INVALID_DATE" });
  }
  if (rule.validFrom !== null && rule.validTo !== null && realDate(rule.validFrom) && realDate(rule.validTo) && rule.validFrom > rule.validTo) issues.push({ path: "/valid_to", reason: "DATE_ORDER" });
  if (level === 5 && !dated(rule)) issues.push({ path: "/valid_from", reason: "DATES_REQUIRED" });
  return issues;
}

const sameDims = (a: MarkupDimensions, b: MarkupDimensions): boolean => a.tenantId === b.tenantId && a.cityId === b.cityId && a.category === b.category && a.vehicleGroupId === b.vehicleGroupId;

function rangesOverlap(a: Pick<MarkupRule, "validFrom" | "validTo">, b: Pick<MarkupRule, "validFrom" | "validTo">): boolean {
  const startA = a.validFrom ?? "0000-01-01";
  const endA = a.validTo ?? "9999-12-31";
  const startB = b.validFrom ?? "0000-01-01";
  const endB = b.validTo ?? "9999-12-31";
  return startA <= endB && startB <= endA;
}

/**
 * 和这条规则冲突的已有规则（同一组维度上：都不带日期，或都带日期且日期范围重叠）。`exceptId` 是正在修改的那一条自己。
 * 带日期的和不带日期的可以并存：促销期里用带日期的，其余日子用不带日期的。
 */
export function conflictingMarkupRules(rules: readonly MarkupRule[], rule: Omit<MarkupRule, "id">, exceptId: string | null = null): MarkupRule[] {
  return rules.filter((other) => other.id !== exceptId && sameDims(other, rule) && dated(other) === dated(rule) && (!dated(rule) || rangesOverlap(other, rule)));
}

/**
 * 把渠道的下限调高到 `floorBp` 时，会低于新下限的规则（结束日期早于 `today` 的已经用不上了，不算）。
 * 调高下限之前要先把它们改掉：否则规则表上写着 8%、实际按 12% 算，运营看到的和客人付的对不上。
 */
export function rulesBelowFloor(rules: readonly MarkupRule[], floorBp: number, today: string): MarkupRule[] {
  return rules.filter((rule) => rule.markupBp < floorBp && (rule.validTo === null || rule.validTo >= today));
}
