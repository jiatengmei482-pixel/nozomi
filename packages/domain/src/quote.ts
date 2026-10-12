/**
 * 报价引擎（M2-01）：一个商品对一次用车请求的结算价和明细、报不出价的原因；多个供应商之间的比价和中标；报价快照的结构。
 * 全是纯函数，不碰数据库和网络：商品、规则、库存、路线预估、汇率、加价、评分都由调用方取好了传进来（ADR 0020）。
 *
 * 对应需求文档《用车报价服务平台》「报价引擎」的 13 步（下面注释里的「第 N 步」）、计价公式、取整规则、时区，
 * 以及文末各轮决策（轮次大的优先；第五轮：3% 价格带内评分高者中标、观察期 +5%、跨币种 1.5% 汇率缓冲、渠道最低加价 10%）。
 * 《平台运营端与渠道对接》的「中标排序（修正版）」「汇率缓冲与加价下限」「加价规则」。
 *
 * 钱：结算价是商品所属子品牌币种的最小货币单位整数；中间结果用精确分数，只在最后取整一次（pricing.ts / money.ts）。
 */
import { type AreaPolygonShape, locatePoint } from "./areas.ts";
import type { LatLng } from "./geo.ts";
import { type InventoryDay, type InventoryMode, hasInventory } from "./inventory.ts";
import type { AddonChargeUnit, FlightScope, PlaceType, ServiceCategory } from "./master-data.ts";
import { type CurrencyCode, minorDigits, roundFractionToUnit } from "./money.ts";
import {
  type AdjustRule,
  type ExactAmount,
  type HolidayLookup,
  PRICE_LIMITS,
  type PriceRule,
  type TripDirection,
  type TripUsage,
  addExact,
  compareExact,
  exactFromMinor,
  exceedsSettlementLimit,
  formatExact,
  scaleExact,
  tripPrice,
} from "./pricing.ts";
import { type FreeWait, type ProductStatus, type ServiceRules, addonAllowsFirstFree, freeWaitItems, minimumFreeWaitMinutes } from "./products.ts";
import { type UrgentTier, checkBookingWindow, instantToLocal, localDateTimeToInstant, overlapMinutes } from "./service-time.ts";

// ---- 常数（都来自需求文档和各轮决策）----

export const QUOTE_RULES = {
  /** 报价快照的有效期（第 12 步）：30 分钟 */
  snapshotTtlMinutes: 30,
  /** 价格带 δ（第 10 步、第五轮决策 ②）：默认 3%，渠道可配 0–5% */
  defaultBandBp: 300,
  maxBandBp: 500,
  /** 观察期租户排序时在对外价上加 5%（只用于比较，不影响客人支付） */
  observationPenaltyBp: 500,
  /** 跨币种的汇率缓冲 1.5%；同币种为 0（第 11 步、第五轮决策 ⑥） */
  fxBufferBp: 150,
  /** 汇率超过 48 小时没更新就暂停跨币种报价（「汇率中心」：数据源不可用时继续用最近一次有效汇率，超过 48 小时未更新则暂停） */
  fxMaxAgeHours: 48,
  /** 渠道加价比例的下限，默认 10%（第 11 步、第五轮决策 ⑥） */
  defaultMarkupFloorBp: 1_000,
  /** 加价比例的上限：防止配置写错（10 倍） */
  maxMarkupBp: 100_000,
  /** 对外价的上限（客人支付币种的最小货币单位）：结算价上限的 1000 倍，容得下换成小面额币种和加价 */
  maxSellMinor: 1_000_000_000_000_000,
  /** 评分口径：完成不足 20 单的租户用默认 4.5 分（《平台运营端》「中标排序（修正版）」第 5 条）。评分用百分之一分的整数 */
  defaultScoreCenti: 450,
  minOrdersForScore: 20,
  maxScoreCenti: 500,
  /** 一次询价的人数、行李数、附加服务个数的上限 */
  maxPassengers: 60,
  maxLuggage: 60,
  maxAddonKinds: 20,
  maxAddonQuantity: 20,
} as const;

// ---- 入参（第 1 步）----

/** 一次用车请求。时间是服务城市的当地时间（需求文档「时区」）。 */
export interface QuoteRequest {
  category: ServiceCategory;
  /** 上车点、下车点的坐标。接送机：机场 / 车站那一端不用给（商品自己带着接送点） */
  pickup: LatLng | null;
  dropoff: LatLng | null;
  /** 接送机：这一单的方向（pickup = 接机 / 接站，dropoff = 送机 / 送站）；其他品类 null */
  direction: TripDirection | null;
  /** 包车：套餐时长（小时）；其他品类 null */
  packageHours: number | null;
  /** 用车时间，城市当地时间 `YYYY-MM-DDTHH:mm` */
  serviceLocal: string;
  passengers: number;
  luggage: number;
  /** 要的附加服务：`quantity` 对按个计费的是个数，其他计费方式不看 */
  addons: readonly { addonId: string; quantity: number }[];
  /** 要的司机语言；不要求为 null */
  driverLanguage: string | null;
  /** 只看这些车型组；空 = 商品选的全部 */
  vehicleGroupIds: readonly string[];
}

export type QuoteRequestIssue = { path: string; reason: "REQUIRED" | "NOT_APPLICABLE" | "OUT_OF_RANGE" | "INVALID_SERVICE_TIME" | "DUPLICATE" };

/** 请求本身写得对不对（和哪个商品无关的部分）：品类该给的给了没有、不该给的有没有给、数量在不在范围里。 */
export function quoteRequestIssues(request: QuoteRequest): QuoteRequestIssue[] {
  const issues: QuoteRequestIssue[] = [];
  const { category } = request;
  if ((category === "airport_transfer") !== (request.direction !== null)) issues.push({ path: "/direction", reason: category === "airport_transfer" ? "REQUIRED" : "NOT_APPLICABLE" });
  if ((category === "charter") !== (request.packageHours !== null)) issues.push({ path: "/package_hours", reason: category === "charter" ? "REQUIRED" : "NOT_APPLICABLE" });
  if (request.packageHours !== null && (!Number.isInteger(request.packageHours) || request.packageHours < 1 || request.packageHours > PRICE_LIMITS.maxPackageHours)) issues.push({ path: "/package_hours", reason: "OUT_OF_RANGE" });
  for (const point of quoteCheckPoints(request)) if (request[point] === null) issues.push({ path: `/${point}`, reason: "REQUIRED" });
  if (localDateTimeToInstant(request.serviceLocal, "UTC") === null) issues.push({ path: "/service_time", reason: "INVALID_SERVICE_TIME" });
  if (!Number.isInteger(request.passengers) || request.passengers < 1 || request.passengers > QUOTE_RULES.maxPassengers) issues.push({ path: "/passengers", reason: "OUT_OF_RANGE" });
  if (!Number.isInteger(request.luggage) || request.luggage < 0 || request.luggage > QUOTE_RULES.maxLuggage) issues.push({ path: "/luggage", reason: "OUT_OF_RANGE" });
  if (request.addons.length > QUOTE_RULES.maxAddonKinds) issues.push({ path: "/addons", reason: "OUT_OF_RANGE" });
  const seen = new Set<string>();
  for (const [index, addon] of request.addons.entries()) {
    if (seen.has(addon.addonId)) issues.push({ path: `/addons/${index}/addon_id`, reason: "DUPLICATE" });
    seen.add(addon.addonId);
    if (!Number.isInteger(addon.quantity) || addon.quantity < 1 || addon.quantity > QUOTE_RULES.maxAddonQuantity) issues.push({ path: `/addons/${index}/quantity`, reason: "OUT_OF_RANGE" });
  }
  return issues;
}

/**
 * 区域校验要看哪几个点（第 4 步、「区域管理」的区域规则）：
 * 接送机只校验非机场一端（接机看下车点，送机看上车点）；点对点两端都看；包车只看上车点。
 */
export function quoteCheckPoints(request: Pick<QuoteRequest, "category" | "direction">): ("pickup" | "dropoff")[] {
  if (request.category === "charter") return ["pickup"];
  if (request.category === "point_to_point") return ["pickup", "dropoff"];
  return request.direction === "dropoff" ? ["pickup"] : ["dropoff"];
}

// ---- 一个商品的全部事实 ----

/** 路线预估（第 6 步：里程 + 时长模型用谷歌地图 Routes API 预估）。取不到时为 null。 */
export interface RouteEstimate {
  meters: number;
  minutes: number;
}

export interface QuoteProduct {
  productId: string;
  tenantId: string;
  category: ServiceCategory;
  status: ProductStatus;
  /** 供应商是不是启用中（被平台暂停的不参与比价）、子品牌是不是启用中 */
  tenantActive: boolean;
  brandActive: boolean;
  /** 子品牌的币种和取整单位 */
  currency: CurrencyCode;
  roundingUnit: number;
  /** 商品所在城市的时区 */
  timeZone: string;
  /** 接送机商品的接送点；其他品类 null */
  pickupPlace: { type: PlaceType; flightScope: FlightScope | null } | null;
  /** 商品选的区域，按优先级；`shapes` 是它的营运 / 禁行图形 */
  areas: readonly { areaId: string; active: boolean; shapes: readonly (AreaPolygonShape & { id: string })[] }[];
  /** 商品选的车型组和各自的「人数 / 行李数」组合 */
  vehicleGroups: readonly { vehicleGroupId: string; passengers: number; luggage: number; active: boolean }[];
  serviceRules: ServiceRules;
  /** 服务规则里出现的附加服务在平台目录里的情况 */
  addonCatalog: readonly { addonId: string; chargeUnit: AddonChargeUnit; usable: boolean }[];
  priceRules: readonly (PriceRule & { id: string })[];
  adjustRules: readonly (AdjustRule & { id: string })[];
  inventoryMode: InventoryMode;
}

/** 随时间、随请求变的那部分事实。 */
export interface QuoteMoment {
  now: Date;
  holidays?: HolidayLookup;
  /** 这次用车的路线预估；取不到（服务不可用、没有配置）为 null */
  route: RouteEstimate | null;
  /** 用车那一天的库存（有限库存的商品才看）；没设过为 null */
  inventoryDay: InventoryDay | null;
  /** 用车那一天已经接了几单加急（查每日加急库存用） */
  urgentUsed: number;
}

// ---- 报不出价的原因 ----

export const QUOTE_REFUSALS = [
  /** 商品没有上架（草稿、已下架）。供应商自己试算时不查这一条 */
  "PRODUCT_NOT_PUBLISHED",
  /** 供应商被平台暂停：商品不参与比价 */
  "TENANT_SUSPENDED",
  "BRAND_DISABLED",
  /** 服务规则还没填全（没有服务时间或提前预订时长）：只会出现在没上架的商品上 */
  "SERVICE_RULES_INCOMPLETE",
  /** 用车时间写得不对 */
  "INVALID_SERVICE_TIME",
  /** 今天不在下单有效期里 */
  "OUTSIDE_SALE_PERIOD",
  /** 用车时间不在每天的服务时间里 */
  "OUTSIDE_SERVICE_TIME",
  /** 用车时间已经过去了 */
  "SERVICE_TIME_PASSED",
  /** 不足提前预订时长，没开加急或没有够用的一档（需求文档错误码 LEAD_TIME_TOO_SHORT） */
  "LEAD_TIME_TOO_SHORT",
  /** 走加急，但这一天的加急库存用完了 */
  "URGENT_SOLD_OUT",
  /** 要校验的点不在这个商品任何一个区域的营运区里（需求文档错误码 OUT_OF_SERVICE_AREA） */
  "OUT_OF_SERVICE_AREA",
  /** 要校验的点落在禁行区里，而且没有别的区域能接 */
  "IN_FORBIDDEN_AREA",
  /** 要的附加服务这个商品不提供（没开、被平台停用、不适用） */
  "ADDON_NOT_OFFERED",
  /** 要的司机语言这个商品不提供 */
  "DRIVER_LANGUAGE_NOT_OFFERED",
  /** 库存不足（需求文档错误码 SOLD_OUT） */
  "SOLD_OUT",
  // ---- 以下是按车型组的 ----
  /** 请求指定的车型组这个商品没有选 */
  "VEHICLE_GROUP_NOT_OFFERED",
  "VEHICLE_GROUP_DISABLED",
  /** 人数或行李数超过了车型组合（第 5 步） */
  "CAPACITY_EXCEEDED",
  /** 没有命中价格规则：这个组合没有价格 / 有但用车日期不在生效期 / 对得上的那条停用了 */
  "NO_PRICE_RULE",
  "PRICE_NOT_IN_EFFECT",
  "PRICE_RULE_DISABLED",
  /** 里程 + 时长的价格需要路线预估，而现在取不到 */
  "ROUTE_UNAVAILABLE",
  /** 调价、取整之后不大于 0 */
  "PRICE_NOT_POSITIVE",
  /** 结算价超过了上限 */
  "PRICE_OVER_LIMIT",
] as const;
export type QuoteRefusal = (typeof QUOTE_REFUSALS)[number];

// ---- 结算价的明细 ----

export interface AddonCharge {
  addonId: string;
  chargeUnit: AddonChargeUnit;
  /** 请求里要的个数 */
  quantity: number;
  /** 实际计费的数量：按次 1；按个 = 个数（首个免费时减 1）；按人 = 人数；按时长 = 小时数（精确值的十进制写法） */
  chargedQuantity: string;
  firstFree: boolean;
  unitPriceMinor: number;
  amountMinor: number;
}

/**
 * 一个车型组的结算价明细（需求文档「总价」公式：P_total = Adjust(P_base) + F_urgent + F_night + ΣF_addon）。
 * 各项之和恒等于 `totalMinor`；取整只在最后做一次（按子品牌的取整单位），尾差计入调价项（需求文档「取整规则」）。
 */
export interface SettlementBreakdown {
  currency: CurrencyCode;
  roundingUnit: number;
  /** 结算价 */
  totalMinor: number;
  /** 基础价（四舍五入到最小货币单位） */
  baseMinor: number;
  /** 调价合计，含取整的尾差 */
  adjustMinor: number;
  urgentMinor: number;
  nightMinor: number;
  addonsMinor: number;
  driverLanguageMinor: number;
  /** 取整之前的精确值（十进制写法），对账、复算用 */
  exact: { base: string; adjusted: string; night: string; total: string };
  /** 命中的调价规则和每一步（按执行顺序）；`delta`、`after` 是这一步加了多少、之后是多少（精确值的十进制写法） */
  adjusts: { ruleId: string; name: string; steps: { type: "percent" | "amount"; value: number; delta: string; after: string }[] }[];
  /** 走加急时命中的那一档 */
  urgentTier: UrgentTier | null;
  /** 夜间费怎么来的：按次，或与夜间时段重叠的分钟数 */
  night: { chargeUnit: "per_order" | "per_hour"; overlapMinutes: number | null } | null;
  addons: AddonCharge[];
  driverLanguage: string | null;
  /** 里程 + 时长的价格用到的路线预估 */
  usage: RouteEstimate | null;
  /** 这个方向 / 品类的免费等待（供应商设的；不低于平台规定的最小值） */
  freeWait: { item: "pickup" | "dropoff" | "general"; value: FreeWait | null; platformMinimumMinutes: number };
}

export interface VehicleOffer {
  vehicleGroupId: string;
  packageHours: number | null;
  /** 用的是哪个区域、哪条价格规则（几个区域都能报时取最低的那个） */
  areaId: string;
  priceRuleId: string;
  settlement: SettlementBreakdown;
}

export type ProductQuote =
  /** 商品层面就报不出（对所有车型组都一样） */
  | { ok: false; productId: string; tenantId: string; reason: QuoteRefusal }
  /** 报得出的车型组各一个价；报不出的车型组各有原因 */
  | { ok: true; productId: string; tenantId: string; serviceDate: string; urgent: boolean; offers: VehicleOffer[]; refused: { vehicleGroupId: string; reason: QuoteRefusal }[] };

const ZERO: ExactAmount = { numerator: 0n, denominator: 1n };
const roundMinor = (amount: ExactAmount): number => roundFractionToUnit(amount.numerator, amount.denominator, 1);

/** 第 4 步：这个商品的哪些区域能接这次用车；一个都没有时说明原因。 */
function serviceAreas(product: QuoteProduct, request: QuoteRequest): { areaIds: string[] } | { reason: "OUT_OF_SERVICE_AREA" | "IN_FORBIDDEN_AREA" } {
  const usable = new Set<string>();
  for (const point of quoteCheckPoints(request)) {
    const position = request[point];
    if (position === null) return { reason: "OUT_OF_SERVICE_AREA" };
    // 禁行优先，只在禁行区所在的那个区域里管用：这个区域不接，别的区域的营运区包着它照样可以接（ADR 0015）
    const located = product.areas.filter((area) => area.active).map((area) => ({ areaId: area.areaId, result: locatePoint(area.shapes, position).result }));
    const operating = located.filter((entry) => entry.result === "operate");
    // 每一个要校验的点都得有区域能接（点对点：起点和终点都要在营运区）
    if (operating.length === 0) return { reason: located.some((entry) => entry.result === "forbid") ? "IN_FORBIDDEN_AREA" : "OUT_OF_SERVICE_AREA" };
    // 一个点落在多个区域：每个都算；点对点起终点在不同区域：两端的区域都算（取最低在后面做）
    for (const entry of operating) usable.add(entry.areaId);
  }
  return { areaIds: product.areas.flatMap((area) => (usable.has(area.areaId) ? [area.areaId] : [])) };
}

/** 一段用车有多长（分钟）：包车是套餐时长；其他品类用路线预估，取不到为 null。 */
function tripMinutes(request: QuoteRequest, route: RouteEstimate | null): number | null {
  if (request.packageHours !== null) return request.packageHours * 60;
  return route === null ? null : Math.max(0, Math.trunc(route.minutes));
}

/**
 * 夜间费（第 8 步；「服务规则」：按次，或按与夜间时段重叠的小时数）。夜间时段是「开始含、结束不含」：22:00–06:00 的时段，06:00 整不算夜间。
 * - 按次：用车开始的时刻在夜间时段里就收一次；
 * - 按小时：金额 × 与夜间时段重叠的分钟数 ÷ 60（不足一小时按比例，精确值）。用车多长：包车是套餐时长，其他品类是路线预估的时长；
 *   取不到时长的（一口价商品、没有路线预估）按一次算——开始时刻在夜间时段里收一小时的钱。
 */
function nightFee(rules: ServiceRules, startMinute: number, durationMinutes: number | null): { fee: ExactAmount; detail: SettlementBreakdown["night"] } {
  const night = rules.night;
  if (!night.enabled || night.window === null || night.amountMinor === null || night.chargeUnit === null) return { fee: ZERO, detail: null };
  const startsAtNight = overlapMinutes(night.window, startMinute, 1) > 0;
  if (night.chargeUnit === "per_order" || durationMinutes === null) {
    if (!startsAtNight) return { fee: ZERO, detail: null };
    return { fee: exactFromMinor(night.amountMinor), detail: { chargeUnit: night.chargeUnit, overlapMinutes: null } };
  }
  const minutes = overlapMinutes(night.window, startMinute, durationMinutes);
  if (minutes === 0) return { fee: ZERO, detail: null };
  return { fee: scaleExact(exactFromMinor(night.amountMinor), BigInt(minutes), 60n), detail: { chargeUnit: "per_hour", overlapMinutes: minutes } };
}

/** 附加服务（第 8 步；「服务规则」：每项开关 + 单价，0 = 免费提供，座椅类可设首个免费）。要的东西商品不提供返回 null。 */
function addonCharges(product: QuoteProduct, request: QuoteRequest, durationMinutes: number | null): AddonCharge[] | null {
  const charges: AddonCharge[] = [];
  for (const wanted of request.addons) {
    const offered = product.serviceRules.addons.find((addon) => addon.addonId === wanted.addonId);
    const catalog = product.addonCatalog.find((addon) => addon.addonId === wanted.addonId);
    if (offered === undefined || !offered.enabled || catalog === undefined || !catalog.usable) return null;
    const unit = exactFromMinor(offered.unitPriceMinor);
    const firstFree = offered.firstFree && addonAllowsFirstFree(catalog.chargeUnit);
    let amount: ExactAmount;
    let chargedQuantity: string;
    if (catalog.chargeUnit === "per_item") {
      const count = Math.max(0, wanted.quantity - (firstFree ? 1 : 0));
      amount = scaleExact(unit, BigInt(count));
      chargedQuantity = String(count);
    } else if (catalog.chargeUnit === "per_person") {
      amount = scaleExact(unit, BigInt(request.passengers));
      chargedQuantity = String(request.passengers);
    } else if (catalog.chargeUnit === "per_duration" && durationMinutes !== null) {
      // 按时长：单价是每小时的，不足一小时按比例
      amount = scaleExact(unit, BigInt(durationMinutes), 60n);
      chargedQuantity = formatExact({ numerator: BigInt(durationMinutes), denominator: 60n });
    } else {
      // 按次；按时长而取不到时长的按一小时算
      amount = unit;
      chargedQuantity = "1";
    }
    charges.push({ addonId: wanted.addonId, chargeUnit: catalog.chargeUnit, quantity: wanted.quantity, chargedQuantity, firstFree, unitPriceMinor: offered.unitPriceMinor, amountMinor: roundMinor(amount) });
  }
  return charges;
}

/**
 * 一个商品对一次用车请求报价（第 2–9 步里和这个商品有关的全部）。
 * `forOwner`：供应商自己试算——没上架的商品也算（需求文档 `quote-preview`：用未上架商品试算报价），也不看供应商是不是被暂停。
 * 请求本身写得对不对由 `quoteRequestIssues` 查，这里假定是对的。
 */
export function quoteProduct(product: QuoteProduct, request: QuoteRequest, moment: QuoteMoment, options: { forOwner?: boolean } = {}): ProductQuote {
  const refuse = (reason: QuoteRefusal): ProductQuote => ({ ok: false, productId: product.productId, tenantId: product.tenantId, reason });
  // 第 2 步：已上架、供应商和子品牌启用中（城市、品类、接送点由找商品的那一层筛）
  if (options.forOwner !== true) {
    if (product.status !== "published") return refuse("PRODUCT_NOT_PUBLISHED");
    if (!product.tenantActive) return refuse("TENANT_SUSPENDED");
  }
  if (!product.brandActive) return refuse("BRAND_DISABLED");

  // 第 3 步：下单有效期、每日服务时间、提前预订时长；不足时开了加急走加急
  const { booking, urgent } = product.serviceRules;
  if (booking.serviceTime === null || booking.leadTimeHours === null) return refuse("SERVICE_RULES_INCOMPLETE");
  const window = checkBookingWindow(
    { saleFrom: booking.saleFrom, saleTo: booking.saleTo, serviceTime: booking.serviceTime, leadTimeHours: booking.leadTimeHours, urgentTiers: urgent.enabled ? urgent.tiers : [] },
    { now: moment.now, serviceLocal: request.serviceLocal, timeZone: product.timeZone },
  );
  if (!window.ok) return refuse(window.reason);
  // 第 9 步后半：加急单另查加急库存
  if (window.urgentTier !== null && urgent.dailyQuota !== null && moment.urgentUsed >= urgent.dailyQuota) return refuse("URGENT_SOLD_OUT");

  // 第 4 步：区域校验
  const areas = serviceAreas(product, request);
  if ("reason" in areas) return refuse(areas.reason);

  // 调价、夜间都按用车那一刻在城市当地的钟面（夏令时里不存在的时间按拨快之后）
  const local = instantToLocal(localDateTimeToInstant(request.serviceLocal, product.timeZone) as Date, product.timeZone);
  const durationMinutes = tripMinutes(request, moment.route);

  // 第 8 步：加急费、夜间费、附加服务、司机语言——各自独立，不参与调价
  const addons = addonCharges(product, request, durationMinutes);
  if (addons === null) return refuse("ADDON_NOT_OFFERED");
  const language = request.driverLanguage === null ? null : product.serviceRules.driverLanguages.find((entry) => entry.language === request.driverLanguage);
  if (language === undefined) return refuse("DRIVER_LANGUAGE_NOT_OFFERED");
  const urgentMinor = window.urgentTier?.surchargeMinor ?? 0;
  const night = nightFee(product.serviceRules, local.minuteOfDay, durationMinutes);
  const nightMinor = roundMinor(night.fee);
  const addonsMinor = addons.reduce((sum, addon) => sum + addon.amountMinor, 0);
  const driverLanguageMinor = language?.unitPriceMinor ?? 0;
  const extras = addExact(night.fee, exactFromMinor(urgentMinor + addonsMinor + driverLanguageMinor));

  // 第 9 步：有限库存时当日剩余 > 0
  if (!hasInventory(product.inventoryMode, moment.inventoryDay)) return refuse("SOLD_OUT");

  const item = freeWaitItems(product.category).length === 1 ? ("general" as const) : request.direction === "dropoff" ? ("dropoff" as const) : ("pickup" as const);
  const freeWait: SettlementBreakdown["freeWait"] = { item, value: product.serviceRules.freeWait[item], platformMinimumMinutes: minimumFreeWaitMinutes(product.category, item, product.pickupPlace) };
  // 包车报价时 H = 套餐时长、里程不超套餐（超时、超公里履约后按实际结算），不看路线预估；其他品类把预估交给计价公式
  const usage: TripUsage = moment.route === null || product.category === "charter" ? {} : { meters: moment.route.meters, minutes: moment.route.minutes };

  const offers: VehicleOffer[] = [];
  const refused: { vehicleGroupId: string; reason: QuoteRefusal }[] = [];
  const wanted = request.vehicleGroupIds.length === 0 ? product.vehicleGroups.map((group) => group.vehicleGroupId) : [...request.vehicleGroupIds];
  for (const vehicleGroupId of wanted) {
    const group = product.vehicleGroups.find((entry) => entry.vehicleGroupId === vehicleGroupId);
    if (group === undefined) {
      refused.push({ vehicleGroupId, reason: "VEHICLE_GROUP_NOT_OFFERED" });
      continue;
    }
    if (!group.active) {
      refused.push({ vehicleGroupId, reason: "VEHICLE_GROUP_DISABLED" });
      continue;
    }
    // 第 5 步：人数或行李超过车型组合的不报
    if (request.passengers > group.passengers || request.luggage > group.luggage) {
      refused.push({ vehicleGroupId, reason: "CAPACITY_EXCEEDED" });
      continue;
    }
    // 第 5–7 步：每个能接的区域各算一遍，取结算价最低的；一样低的取商品里排在前面的区域
    let best: VehicleOffer | null = null;
    const reasons: QuoteRefusal[] = [];
    for (const areaId of areas.areaIds) {
      const priced = tripPrice({
        priceRules: product.priceRules,
        adjustRules: product.adjustRules,
        query: { areaId, vehicleGroupId, direction: request.direction, packageHours: request.packageHours, date: local.date },
        minuteOfDay: local.minuteOfDay,
        usage,
        roundingUnit: product.roundingUnit,
        ...(moment.holidays === undefined ? {} : { holidays: moment.holidays }),
      });
      if (priced.priceRule === null || priced.price === null) {
        reasons.push(priced.noPriceReason === "NOT_IN_EFFECT" ? "PRICE_NOT_IN_EFFECT" : priced.noPriceReason === "RULE_DISABLED" ? "PRICE_RULE_DISABLED" : "NO_PRICE_RULE");
        continue;
      }
      // 第 6 步：里程 + 时长的价格按路线预估算；取不到预估就报不出（一口价、包车套餐不受影响）
      if (priced.priceRule.pricing.model === "mileage_time" && moment.route === null) {
        reasons.push("ROUTE_UNAVAILABLE");
        continue;
      }
      if (priced.price.finalMinor === null) {
        reasons.push(priced.noPriceReason === "OVER_LIMIT" ? "PRICE_OVER_LIMIT" : "PRICE_NOT_POSITIVE");
        continue;
      }
      // 总价 = 调价后的价 + 加急 + 夜间 + 附加服务，最后按取整单位取整一次
      const exactTotal = addExact(priced.price.unrounded, extras);
      if (exceedsSettlementLimit(exactTotal)) {
        reasons.push("PRICE_OVER_LIMIT");
        continue;
      }
      const totalMinor = roundFractionToUnit(exactTotal.numerator, exactTotal.denominator, product.roundingUnit);
      if (totalMinor <= 0) {
        reasons.push("PRICE_NOT_POSITIVE");
        continue;
      }
      if (best !== null && best.settlement.totalMinor <= totalMinor) continue;
      const baseMinor = roundMinor(priced.price.base);
      best = {
        vehicleGroupId,
        packageHours: request.packageHours,
        areaId,
        priceRuleId: priced.priceRule.id,
        settlement: {
          currency: product.currency,
          roundingUnit: product.roundingUnit,
          totalMinor,
          baseMinor,
          // 尾差计入调价项：各项之和恒等于结算价
          adjustMinor: totalMinor - baseMinor - urgentMinor - nightMinor - addonsMinor - driverLanguageMinor,
          urgentMinor,
          nightMinor,
          addonsMinor,
          driverLanguageMinor,
          exact: { base: formatExact(priced.price.base), adjusted: formatExact(priced.price.unrounded), night: formatExact(night.fee), total: formatExact(exactTotal) },
          adjusts: priced.price.adjusts.map((entry) => ({ ruleId: entry.rule.id, name: entry.rule.name, steps: entry.steps.map((step) => ({ type: step.step.type, value: step.step.value, delta: formatExact(step.delta), after: formatExact(step.after) })) })),
          urgentTier: window.urgentTier,
          night: night.detail,
          addons,
          driverLanguage: request.driverLanguage,
          usage: priced.priceRule.pricing.model === "mileage_time" ? moment.route : null,
          freeWait,
        },
      };
    }
    if (best !== null) offers.push(best);
    else refused.push({ vehicleGroupId, reason: pickRefusal(reasons) });
  }
  return { ok: true, productId: product.productId, tenantId: product.tenantId, serviceDate: local.date, urgent: window.urgentTier !== null, offers, refused };
}

/** 几个区域各有各的原因时报哪一个：离「报得出」最近的那个（方便排查）。 */
function pickRefusal(reasons: readonly QuoteRefusal[]): QuoteRefusal {
  const order: QuoteRefusal[] = ["PRICE_OVER_LIMIT", "PRICE_NOT_POSITIVE", "ROUTE_UNAVAILABLE", "PRICE_RULE_DISABLED", "PRICE_NOT_IN_EFFECT", "NO_PRICE_RULE"];
  return order.find((reason) => reasons.includes(reason)) ?? "NO_PRICE_RULE";
}

// ---- 对外价（第 11 步）----

/** 换算到客人支付币种用的汇率：1 个 `from` 的主单位 = `rate` 个 `to` 的主单位（中央汇率，不含缓冲）。汇率写成十进制字符串，不经过浮点数。 */
export interface FxQuote {
  from: CurrencyCode;
  to: CurrencyCode;
  rate: string;
  /** 这个汇率是什么时候取的（快照里要记） */
  asOf: string;
}

/**
 * 这个汇率现在还能不能用来报价（「汇率中心」）：取数时间离现在不超过 48 小时（正好 48 小时还能用）。取数时间写得不对的当作不能用。
 * 汇率中心自己也该停掉过期的汇率；这里再查一遍，保证不管汇率从哪里来，过期的都进不了报价。
 */
export function fxQuoteUsable(fx: Pick<FxQuote, "asOf">, now: Date): boolean {
  const asOf = new Date(fx.asOf).getTime();
  return Number.isFinite(asOf) && now.getTime() - asOf <= QUOTE_RULES.fxMaxAgeHours * 3_600_000;
}

const DECIMAL_RATE = /^(\d{1,12})(?:\.(\d{1,12}))?$/;

/** 十进制写法的汇率 → 精确分数。写法不对、不大于 0 返回 null。 */
export function rateFraction(rate: string): { numerator: bigint; denominator: bigint } | null {
  const match = DECIMAL_RATE.exec(rate);
  if (!match) return null;
  const fraction = match[2] ?? "";
  const numerator = BigInt(`${match[1]}${fraction}`);
  return numerator > 0n ? { numerator, denominator: 10n ** BigInt(fraction.length) } : null;
}

export interface SellPrice {
  currency: CurrencyCode;
  /** 对外价（客人支付币种的最小货币单位），按币种的小数位四舍五入 */
  sellMinor: number;
  /** 实际用的加价比例（基点）：不低于渠道下限 */
  markupBp: number;
  /** 汇率缓冲（基点）：跨币种 150，同币种 0 */
  fxBufferBp: number;
  fx: FxQuote | null;
  /** 取整之前的精确值（十进制写法） */
  exact: string;
}

export type SellPriceFailure = "FX_RATE_UNAVAILABLE" | "SELL_PRICE_OVER_LIMIT";

/**
 * 对外价 = 结算价 × 汇率 × (1 + 汇率缓冲) × (1 + 加价比例)，按币种取整（第 11 步）。
 * - 客人支付币种和结算币种相同：汇率 1、缓冲 0；不同：要给汇率（`fx`），缓冲 1.5%。没有汇率时报不出价。
 * - 加价比例不得低于渠道下限（默认 10%）：给的比下限低就按下限算。
 */
export function sellPrice(input: { settlementMinor: number; settlementCurrency: CurrencyCode; currency: CurrencyCode; markupBp: number; markupFloorBp?: number; fxBufferBp?: number; fx: FxQuote | null }): SellPrice | { failure: SellPriceFailure } {
  const bufferBp = input.fxBufferBp ?? QUOTE_RULES.fxBufferBp;
  if (!Number.isInteger(bufferBp) || bufferBp < 0 || bufferBp > 1_000) throw new RangeError(`汇率缓冲必须是 0 到 1000 的整数基点：${bufferBp}`);
  const floor = input.markupFloorBp ?? QUOTE_RULES.defaultMarkupFloorBp;
  if (!Number.isInteger(input.markupBp) || !Number.isInteger(floor) || input.markupBp < 0 || floor < 0 || input.markupBp > QUOTE_RULES.maxMarkupBp) throw new RangeError(`加价比例必须是 0 到 ${QUOTE_RULES.maxMarkupBp} 的整数基点：${input.markupBp}`);
  const markupBp = Math.max(input.markupBp, floor);
  const sameCurrency = input.currency === input.settlementCurrency;
  let amount = exactFromMinor(input.settlementMinor);
  let fx: FxQuote | null = null;
  if (!sameCurrency) {
    const rate = input.fx !== null && input.fx.from === input.settlementCurrency && input.fx.to === input.currency ? rateFraction(input.fx.rate) : null;
    if (rate === null) return { failure: "FX_RATE_UNAVAILABLE" };
    fx = input.fx;
    // 最小货币单位之间的换算：先换成主单位（÷ 10^from 的小数位），乘汇率，再换成对方的最小单位（× 10^to 的小数位）
    amount = scaleExact(scaleExact(amount, rate.numerator, rate.denominator), 10n ** BigInt(minorDigits(input.currency)), 10n ** BigInt(minorDigits(input.settlementCurrency)));
    amount = scaleExact(amount, BigInt(10_000 + bufferBp), 10_000n);
  }
  amount = scaleExact(amount, BigInt(10_000 + markupBp), 10_000n);
  if (amount.numerator > BigInt(QUOTE_RULES.maxSellMinor) * amount.denominator) return { failure: "SELL_PRICE_OVER_LIMIT" };
  return { currency: input.currency, sellMinor: roundMinor(amount), markupBp, fxBufferBp: sameCurrency ? 0 : bufferBp, fx, exact: formatExact(amount) };
}

// ---- 选中标（第 10 步）----

/** 评分口径：完成不足 20 单、或还没有评分的租户用默认 4.5 分。评分是百分之一分的整数（4.90 分 = 490）。 */
export function effectiveScoreCenti(scoreCenti: number | null, completedOrders: number): number {
  if (scoreCenti === null || completedOrders < QUOTE_RULES.minOrdersForScore) return QUOTE_RULES.defaultScoreCenti;
  return Math.min(QUOTE_RULES.maxScoreCenti, Math.max(0, Math.trunc(scoreCenti)));
}

/** 参加比价的一个报价（同一个车型组、同一个套餐）。 */
export interface RankCandidate {
  tenantId: string;
  /** 对外价，已经换算到同一个币种 */
  sellMinor: number;
  /** 观察期租户：排序价 = 对外价 × 1.05 */
  observation: boolean;
  scoreCenti: number;
  completedOrders: number;
  /** 前面都一样时用它定先后（商品编号这类稳定的字符串），保证结果是确定的 */
  tieBreak: string;
}

export interface RankedCandidate<T> {
  candidate: T;
  /** 排序价（精确值的十进制写法）：只用于比较，不影响客人支付的金额 */
  rankPrice: string;
  /** 在不在同价区间里（排序价 ≤ 最低排序价 × (1 + δ)） */
  inBand: boolean;
  /** 名次：1 是中标 */
  position: number;
}

/**
 * 选中标（第 10 步，《平台运营端》「中标排序（修正版）」）：
 * 1. 排序价 R = 对外价（观察期租户 × 1.05）；最低的 R 是基准；
 * 2. R ≤ 基准 × (1 + δ) 的进同价区间，δ 由渠道配（0–5%，默认 3%）；恰好等于也算在里面；
 * 3. 区间内：评分高者 → 已完成订单数多者 → 排序价低者（→ `tieBreak` 小者，保证确定）；
 * 4. 区间外的按排序价从低到高排在后面。客人支付的是中标者自己的对外价。
 * 同一个租户有几个报价时只留排序价最低的那个（每个车型组每个租户只出一个价）。
 */
export function rankCandidates<T extends RankCandidate>(candidates: readonly T[], bandBp: number = QUOTE_RULES.defaultBandBp): RankedCandidate<T>[] {
  if (!Number.isInteger(bandBp) || bandBp < 0 || bandBp > QUOTE_RULES.maxBandBp) throw new RangeError(`价格带必须是 0 到 ${QUOTE_RULES.maxBandBp} 的整数基点：${bandBp}`);
  const rank = (candidate: RankCandidate): ExactAmount => scaleExact(exactFromMinor(candidate.sellMinor), BigInt(10_000 + (candidate.observation ? QUOTE_RULES.observationPenaltyBp : 0)), 10_000n);
  const byPrice = (a: T, b: T): number => compareExact(rank(a), rank(b)) || (a.tieBreak < b.tieBreak ? -1 : a.tieBreak > b.tieBreak ? 1 : 0);
  const perTenant = new Map<string, T>();
  for (const candidate of [...candidates].sort(byPrice)) if (!perTenant.has(candidate.tenantId)) perTenant.set(candidate.tenantId, candidate);
  const entries = [...perTenant.values()];
  if (entries.length === 0) return [];
  const lowest = entries.map(rank).reduce((min, value) => (compareExact(value, min) < 0 ? value : min));
  const ceiling = scaleExact(lowest, BigInt(10_000 + bandBp), 10_000n);
  const inBand = (candidate: T): boolean => compareExact(rank(candidate), ceiling) <= 0;
  const sorted = entries.sort((a, b) => {
    const [bandA, bandB] = [inBand(a), inBand(b)];
    if (bandA !== bandB) return bandA ? -1 : 1;
    if (bandA) return b.scoreCenti - a.scoreCenti || b.completedOrders - a.completedOrders || byPrice(a, b);
    return byPrice(a, b);
  });
  return sorted.map((candidate, index) => ({ candidate, rankPrice: formatExact(rank(candidate)), inBand: inBand(candidate), position: index + 1 }));
}

// ---- 报价快照（第 12 步）----

/**
 * 报价快照：下单以它为准，对账、复算、处理异议都靠它。记录中标租户、结算价、加价比例、对外价、汇率、当时的规则版本，
 * 以及全部候选的排序依据（《平台运营端》「自营中立」：每次报价快照保存全部候选租户的排序依据）。
 */
export interface QuoteSnapshot {
  createdAt: string;
  /** 有效期 30 分钟 */
  expiresAt: string;
  request: QuoteRequest;
  /** 客人支付的币种 */
  currency: CurrencyCode;
  bandBp: number;
  winner: {
    tenantId: string;
    productId: string;
    /** 商品当时的版本号（它下面任何规则变了都会加一） */
    productVersion: number;
    offer: VehicleOffer;
    sell: SellPrice;
  };
  /** 全部参与比价的租户和它们的排序依据（含中标的） */
  candidates: { tenantId: string; productId: string; productVersion: number; settlementMinor: number; settlementCurrency: CurrencyCode; sellMinor: number; markupBp: number; observation: boolean; scoreCenti: number; completedOrders: number; rankPrice: string; inBand: boolean; position: number }[];
}

export function quoteExpiresAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + QUOTE_RULES.snapshotTtlMinutes * 60_000);
}

/** 快照还能不能用来下单：到了有效期的那一刻就不能用了（需求文档错误码 QUOTE_EXPIRED）。 */
export function quoteSnapshotValid(snapshot: Pick<QuoteSnapshot, "expiresAt">, now: Date): boolean {
  return now.getTime() < new Date(snapshot.expiresAt).getTime();
}

// ---- 多个供应商比价（第 10–12 步合起来）----

/** 一个租户在比价里的身份：评分（百分之一分，没有为 null）、已完成订单数、是不是在观察期。 */
export interface TenantStanding {
  scoreCenti: number | null;
  completedOrders: number;
  observation: boolean;
}

/** 评分数据还没有的时候（M4-01 之前）每个租户的身份：默认分、0 单、不在观察期。 */
export const DEFAULT_TENANT_STANDING: TenantStanding = { scoreCenti: null, completedOrders: 0, observation: false };

/** 一个商品参加比价要带的东西：它的报价，和平台一侧给它定的加价、汇率、身份。 */
export interface ComparisonEntry {
  quote: ProductQuote;
  /** 商品当时的版本号（快照里记） */
  productVersion: number;
  standing: TenantStanding;
  /** 这个渠道对这个租户、这个车型组适用的加价比例（基点） */
  markupBp: (vehicleGroupId: string) => number;
  /** 从这个商品的结算币种换到客人支付币种的汇率；同币种、或没有汇率时为 null。超过 48 小时没更新的当作没有 */
  fx: FxQuote | null;
}

export type ComparisonRefusal = QuoteRefusal | SellPriceFailure;

export interface ComparedOffer extends RankCandidate {
  productId: string;
  productVersion: number;
  offer: VehicleOffer;
  sell: SellPrice;
}

export interface ComparisonGroup {
  vehicleGroupId: string;
  packageHours: number | null;
  /** 全部候选，按名次；第一个是中标的 */
  ranked: RankedCandidate<ComparedOffer>[];
  /** 这个车型组的报价快照（没有候选时没有这一组） */
  snapshot: QuoteSnapshot;
}

export interface QuoteComparison {
  /** 每个车型组（包车再按套餐）一组，只有一个中标价；按车型组编号排 */
  groups: ComparisonGroup[];
  /** 没能参加比价的：商品层面的（`vehicleGroupId` 为 null）和某个车型组的 */
  refused: { tenantId: string; productId: string; vehicleGroupId: string | null; reason: ComparisonRefusal }[];
}

/**
 * 把各个商品的报价放在一起比（第 10–12 步）：每个报价算出对外价（各自的加价比例、汇率），换到客人支付的币种后，
 * 按车型组分组选中标，每组生成一份快照。同一个租户的几个商品在同一个车型组里只留排序价最低的那个。
 */
export function compareQuotes(input: { request: QuoteRequest; currency: CurrencyCode; entries: readonly ComparisonEntry[]; now: Date; bandBp?: number; markupFloorBp?: number; fxBufferBp?: number }): QuoteComparison {
  const bandBp = input.bandBp ?? QUOTE_RULES.defaultBandBp;
  const refused: QuoteComparison["refused"] = [];
  const byGroup = new Map<string, ComparedOffer[]>();
  for (const entry of input.entries) {
    const { quote } = entry;
    if (!quote.ok) {
      refused.push({ tenantId: quote.tenantId, productId: quote.productId, vehicleGroupId: null, reason: quote.reason });
      continue;
    }
    for (const item of quote.refused) refused.push({ tenantId: quote.tenantId, productId: quote.productId, vehicleGroupId: item.vehicleGroupId, reason: item.reason });
    for (const offer of quote.offers) {
      const sell = sellPrice({
        settlementMinor: offer.settlement.totalMinor,
        settlementCurrency: offer.settlement.currency,
        currency: input.currency,
        markupBp: entry.markupBp(offer.vehicleGroupId),
        ...(input.markupFloorBp === undefined ? {} : { markupFloorBp: input.markupFloorBp }),
        ...(input.fxBufferBp === undefined ? {} : { fxBufferBp: input.fxBufferBp }),
        // 超过 48 小时没更新的汇率不用：跨币种的这一个报不出（同币种的不看汇率，不受影响）
        fx: entry.fx !== null && fxQuoteUsable(entry.fx, input.now) ? entry.fx : null,
      });
      if ("failure" in sell) {
        refused.push({ tenantId: quote.tenantId, productId: quote.productId, vehicleGroupId: offer.vehicleGroupId, reason: sell.failure });
        continue;
      }
      const compared: ComparedOffer = {
        tenantId: quote.tenantId,
        productId: quote.productId,
        productVersion: entry.productVersion,
        sellMinor: sell.sellMinor,
        observation: entry.standing.observation,
        scoreCenti: effectiveScoreCenti(entry.standing.scoreCenti, entry.standing.completedOrders),
        completedOrders: entry.standing.completedOrders,
        // 全都一样时的决胜：租户编号、再商品编号（稳定，和取数的先后无关）
        tieBreak: `${quote.tenantId}|${quote.productId}`,
        offer,
        sell,
      };
      byGroup.set(offer.vehicleGroupId, [...(byGroup.get(offer.vehicleGroupId) ?? []), compared]);
    }
  }
  const createdAt = input.now.toISOString();
  const expiresAt = quoteExpiresAt(input.now).toISOString();
  const groups = [...byGroup.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([vehicleGroupId, offers]): ComparisonGroup => {
      const ranked = rankCandidates(offers, bandBp);
      const winner = (ranked[0] as RankedCandidate<ComparedOffer>).candidate;
      return {
        vehicleGroupId,
        packageHours: input.request.packageHours,
        ranked,
        snapshot: {
          createdAt,
          expiresAt,
          request: input.request,
          currency: input.currency,
          bandBp,
          winner: { tenantId: winner.tenantId, productId: winner.productId, productVersion: winner.productVersion, offer: winner.offer, sell: winner.sell },
          candidates: ranked.map(({ candidate, rankPrice, inBand, position }) => ({
            tenantId: candidate.tenantId,
            productId: candidate.productId,
            productVersion: candidate.productVersion,
            settlementMinor: candidate.offer.settlement.totalMinor,
            settlementCurrency: candidate.offer.settlement.currency,
            sellMinor: candidate.sellMinor,
            markupBp: candidate.sell.markupBp,
            observation: candidate.observation,
            scoreCenti: candidate.scoreCenti,
            completedOrders: candidate.completedOrders,
            rankPrice,
            inBand,
            position,
          })),
        },
      };
    });
  return { groups, refused };
}
