/**
 * 商品（M1-03）：基础信息、服务规则、商品详情、上架校验的规则。
 *
 * 来源：docs/requirements/01-tenant-and-quote-engine.md「2. 商品 · ① 基础信息」「3. 商品 · ② 服务规则」
 * 「6. 商品 · ⑤ 商品详情」「7. 上架校验」，以及文末第五轮决策（取消政策由平台统一，租户不设）。落地时定下的事见 ADR 0016。
 *
 * 全是纯函数，不依赖 Node 的模块：后端保存和上架时用，浏览器里填表时用的是同一份。
 * 检查函数只返回原因代码和位置（`path` 用接口里的字段名），不返回句子。
 *
 * 金额一律是商品所属子品牌币种的最小货币单位整数（money.ts）。
 */
import type { AreaBizType } from "./areas.ts";
import { type AddonChargeUnit, type FlightScope, type LocalizedText, MASTER_DATA_LANGUAGES, type PlaceType, type ServiceCategory, hasVisibleText } from "./master-data.ts";
import { type DailyWindow, dailyWindowIssue, isLocalDate } from "./service-time.ts";

/** 商品品类就是主数据里的三个品类：接送机、点对点、包车。 */
export const PRODUCT_CATEGORY_NAMES: Readonly<Record<ServiceCategory, string>> = {
  airport_transfer: "接送机",
  point_to_point: "点对点",
  charter: "包车",
};

/**
 * 商品状态：草稿 → 已上架 ⇄ 已下架。
 * 需求文档写的是四个（草稿 → 未上架 → 已上架 → 已下架）；「未上架」和「草稿」在本系统里没有行为上的区别
 * （都是还没上过架、可以改、不参与比价），所以合成一个（ADR 0016）。
 */
export const PRODUCT_STATUSES = ["draft", "published", "unpublished"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const PRODUCT_STATUS_NAMES: Readonly<Record<ProductStatus, string>> = { draft: "草稿", published: "已上架", unpublished: "已下架" };

export const PRODUCT_LIMITS = {
  /** 一个商品最多选多少个区域、车型组、调度人 */
  maxAreas: 50,
  maxVehicleGroups: 30,
  maxDispatchers: 10,
  maxDispatcherNameLength: 50,
  /** 提前预订时长的上限（小时）：30 天 */
  maxLeadTimeHours: 720,
  maxUrgentTiers: 10,
  maxAddons: 50,
  maxDriverLanguages: 10,
  maxNoteLength: 500,
  /** 免等时长的上限（分钟）：24 小时 */
  maxFreeWaitMinutes: 1440,
  /** 单项金额的上限（最小货币单位）：防止多打几个零 */
  maxAmountMinor: 1_000_000_000,
  maxTitleLength: 100,
  maxSummaryLength: 2000,
  maxListItems: 30,
  maxListItemLength: 200,
  maxGuideLength: 2000,
  /** 子品牌名称 */
  maxBrandNameLength: 50,
} as const;

/** 这个区域能不能给这个品类的商品用：业务类型和品类相同，或者是「通用」。 */
export function areaUsableByCategory(category: ServiceCategory, bizType: AreaBizType): boolean {
  return bizType === "general" || bizType === category;
}

/** 接送机商品的接送点只能是机场或车站。 */
export function isPickupPlaceType(type: PlaceType): boolean {
  return type === "airport" || type === "station";
}

const PHONE = /^\+?[0-9][0-9 -]{5,19}$/;

/** 调度人的电话：数字，可以带开头的 +、中间的空格和横线，6 到 20 位。 */
export function isPhoneNumber(text: string): boolean {
  return PHONE.test(text) && text.replace(/[^0-9]/g, "").length >= 6;
}

// ---- 服务规则 ----

export type FreeWait = { mode: "unlimited" } | { mode: "limited"; minutes: number };

export const NIGHT_CHARGE_UNITS = ["per_order", "per_hour"] as const;
export type NightChargeUnit = (typeof NIGHT_CHARGE_UNITS)[number];

export interface ServiceRules {
  booking: {
    /** 下单有效期（城市当地日期，含两端）；null = 不限 */
    saleFrom: string | null;
    saleTo: string | null;
    /** 每天的服务时间；用车时间必须在里面。跨午夜写成 22:00–06:00，全天写成 00:00–24:00 */
    serviceTime: DailyWindow | null;
    /** 提前预订时长（小时） */
    leadTimeHours: number | null;
    note: string | null;
  };
  urgent: {
    enabled: boolean;
    /** 每天最多接几单加急；null = 不限 */
    dailyQuota: number | null;
    /** 阶梯：离用车不到 withinHours 小时下单，加收 surchargeMinor */
    tiers: { withinHours: number; surchargeMinor: number }[];
  };
  night: {
    enabled: boolean;
    /** 夜间时段，可以跨午夜 */
    window: DailyWindow | null;
    amountMinor: number | null;
    /** 按次，还是按与夜间时段重叠的小时数 */
    chargeUnit: NightChargeUnit | null;
  };
  /** 免等：接送机填 pickup（接机 / 接站）和 dropoff（送机 / 送站）；点对点和包车填 general */
  freeWait: { pickup: FreeWait | null; dropoff: FreeWait | null; general: FreeWait | null };
  addons: { addonId: string; enabled: boolean; unitPriceMinor: number; firstFree: boolean }[];
  /** 司机语言：每种语言一个单价 */
  driverLanguages: { language: string; unitPriceMinor: number }[];
}

/** 一份空的服务规则（新建的草稿）。 */
export function emptyServiceRules(): ServiceRules {
  return {
    booking: { saleFrom: null, saleTo: null, serviceTime: null, leadTimeHours: null, note: null },
    urgent: { enabled: false, dailyQuota: null, tiers: [] },
    night: { enabled: false, window: null, amountMinor: null, chargeUnit: null },
    freeWait: { pickup: null, dropoff: null, general: null },
    addons: [],
    driverLanguages: [],
  };
}

export type FreeWaitItem = "pickup" | "dropoff" | "general";

/** 这个品类的商品要填哪几项免等。 */
export function freeWaitItems(category: ServiceCategory): FreeWaitItem[] {
  return category === "airport_transfer" ? ["pickup", "dropoff"] : ["general"];
}

/**
 * 平台统一的免等默认值（分钟），供应商只能设得更长：国际线 90、国内线 60、接站 30、其他 15、包车 0。
 * 这里给出某一项**最少**要设多少：
 * - 接机：机场只走国内线的是 60，只走国际线的是 90；两种都有或还没标明的按 60（报价时再按实际航班取 90 和供应商设的值里较大的）；
 * - 接站 30；送机 / 送站、点对点 15；包车 0。
 */
export function minimumFreeWaitMinutes(category: ServiceCategory, item: FreeWaitItem, pickupPlace: { type: PlaceType; flightScope: FlightScope | null } | null): number {
  if (category === "charter") return 0;
  if (category === "airport_transfer" && item === "pickup") {
    if (pickupPlace?.type === "station") return 30;
    return pickupPlace?.flightScope === "international" ? 90 : 60;
  }
  return 15;
}

export type RuleIssueReason =
  | "REQUIRED"
  | "INVALID_DATE"
  | "DATE_RANGE_REVERSED"
  | "INVALID_TIME"
  | "EMPTY_WINDOW"
  | "OUT_OF_RANGE"
  | "NOT_INTEGER"
  | "TOO_MANY"
  | "TOO_LONG"
  | "DUPLICATE"
  | "TIER_NOT_WITHIN_LEAD_TIME"
  | "BELOW_PLATFORM_MINIMUM"
  | "NOT_APPLICABLE"
  | "INVALID_LANGUAGE"
  | "INVALID_PHONE";

export interface RuleIssue {
  /** 接口里的字段路径，如 `/urgent/tiers/1/within_hours` */
  path: string;
  reason: RuleIssueReason;
  /** 补充的数字，如上限、平台规定的最小值 */
  detail?: Record<string, number>;
}

export interface ServiceRuleContext {
  category: ServiceCategory;
  /** 接送机商品的接送点；其他品类为 null */
  pickupPlace: { type: PlaceType; flightScope: FlightScope | null } | null;
}

function amountIssue(path: string, value: number, issues: RuleIssue[]): void {
  if (!Number.isInteger(value)) issues.push({ path, reason: "NOT_INTEGER" });
  else if (value < 0 || value > PRODUCT_LIMITS.maxAmountMinor) issues.push({ path, reason: "OUT_OF_RANGE", detail: { min: 0, max: PRODUCT_LIMITS.maxAmountMinor } });
}

function integerIssue(path: string, value: number, min: number, max: number, issues: RuleIssue[]): boolean {
  if (!Number.isInteger(value)) issues.push({ path, reason: "NOT_INTEGER" });
  else if (value < min || value > max) issues.push({ path, reason: "OUT_OF_RANGE", detail: { min, max } });
  else return true;
  return false;
}

/**
 * 服务规则里**填了的部分**写得对不对（保存草稿时查）。没填的不算问题——缺什么由 `serviceRuleMissing` 在上架时查。
 * 没有问题返回空数组。
 */
export function serviceRuleIssues(rules: ServiceRules, context: ServiceRuleContext): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const { booking, urgent, night, freeWait } = rules;

  for (const [field, value] of [["sale_from", booking.saleFrom], ["sale_to", booking.saleTo]] as const) {
    if (value !== null && !isLocalDate(value)) issues.push({ path: `/booking/${field}`, reason: "INVALID_DATE" });
  }
  if (booking.saleFrom !== null && booking.saleTo !== null && isLocalDate(booking.saleFrom) && isLocalDate(booking.saleTo) && booking.saleFrom > booking.saleTo) {
    issues.push({ path: "/booking/sale_to", reason: "DATE_RANGE_REVERSED" });
  }
  if (booking.serviceTime !== null) {
    const issue = dailyWindowIssue(booking.serviceTime);
    if (issue !== null) issues.push({ path: "/booking/service_time", reason: issue });
  }
  const leadOk = booking.leadTimeHours === null || integerIssue("/booking/lead_time_hours", booking.leadTimeHours, 0, PRODUCT_LIMITS.maxLeadTimeHours, issues);
  if (booking.note !== null && booking.note.length > PRODUCT_LIMITS.maxNoteLength) issues.push({ path: "/booking/note", reason: "TOO_LONG", detail: { max: PRODUCT_LIMITS.maxNoteLength } });

  if (urgent.dailyQuota !== null) integerIssue("/urgent/daily_quota", urgent.dailyQuota, 0, 10_000, issues);
  if (urgent.tiers.length > PRODUCT_LIMITS.maxUrgentTiers) issues.push({ path: "/urgent/tiers", reason: "TOO_MANY", detail: { max: PRODUCT_LIMITS.maxUrgentTiers } });
  const seenHours = new Set<number>();
  for (const [index, tier] of urgent.tiers.entries()) {
    const at = `/urgent/tiers/${index}`;
    if (integerIssue(`${at}/within_hours`, tier.withinHours, 1, PRODUCT_LIMITS.maxLeadTimeHours, issues)) {
      if (seenHours.has(tier.withinHours)) issues.push({ path: `${at}/within_hours`, reason: "DUPLICATE" });
      // 加急是「在提前预订时长以内」下单：一档的小时数不能超过提前预订时长，否则它永远用不上或和正常预订重叠
      else if (leadOk && booking.leadTimeHours !== null && tier.withinHours > booking.leadTimeHours) {
        issues.push({ path: `${at}/within_hours`, reason: "TIER_NOT_WITHIN_LEAD_TIME", detail: { lead_time_hours: booking.leadTimeHours } });
      }
      seenHours.add(tier.withinHours);
    }
    amountIssue(`${at}/surcharge`, tier.surchargeMinor, issues);
  }

  if (night.window !== null) {
    const issue = dailyWindowIssue(night.window);
    if (issue !== null) issues.push({ path: "/night/window", reason: issue });
  }
  if (night.amountMinor !== null) amountIssue("/night/amount", night.amountMinor, issues);

  const applicable = freeWaitItems(context.category);
  for (const item of ["pickup", "dropoff", "general"] as const) {
    const value = freeWait[item];
    if (value === null) continue;
    const at = `/free_wait/${item}`;
    if (!applicable.includes(item)) {
      issues.push({ path: at, reason: "NOT_APPLICABLE" });
      continue;
    }
    if (value.mode === "limited" && integerIssue(`${at}/minutes`, value.minutes, 0, PRODUCT_LIMITS.maxFreeWaitMinutes, issues)) {
      const minimum = minimumFreeWaitMinutes(context.category, item, context.pickupPlace);
      if (value.minutes < minimum) issues.push({ path: `${at}/minutes`, reason: "BELOW_PLATFORM_MINIMUM", detail: { min: minimum } });
    }
  }

  if (rules.addons.length > PRODUCT_LIMITS.maxAddons) issues.push({ path: "/addons", reason: "TOO_MANY", detail: { max: PRODUCT_LIMITS.maxAddons } });
  const seenAddons = new Set<string>();
  for (const [index, addon] of rules.addons.entries()) {
    if (seenAddons.has(addon.addonId)) issues.push({ path: `/addons/${index}/addon_id`, reason: "DUPLICATE" });
    seenAddons.add(addon.addonId);
    amountIssue(`/addons/${index}/unit_price`, addon.unitPriceMinor, issues);
  }
  if (rules.driverLanguages.length > PRODUCT_LIMITS.maxDriverLanguages) issues.push({ path: "/driver_languages", reason: "TOO_MANY", detail: { max: PRODUCT_LIMITS.maxDriverLanguages } });
  const seenLanguages = new Set<string>();
  for (const [index, entry] of rules.driverLanguages.entries()) {
    const at = `/driver_languages/${index}`;
    if (!/^[a-z]{2}$/.test(entry.language)) issues.push({ path: `${at}/language`, reason: "INVALID_LANGUAGE" });
    else if (seenLanguages.has(entry.language)) issues.push({ path: `${at}/language`, reason: "DUPLICATE" });
    seenLanguages.add(entry.language);
    amountIssue(`${at}/unit_price`, entry.unitPriceMinor, issues);
  }
  return issues;
}

/**
 * 上架前服务规则还缺什么（「必填齐全」）：服务时间、提前预订时长、这个品类该填的每一项免等；
 * 开了加急至少要有一档；开了夜间加价要有时段、金额、计费方式。下单有效期、备注、附加服务、司机语言不是必填。
 * 取消规则不在这里：它由平台按品类和车型级别统一设置，供应商不设（第五轮决策）。
 */
export function serviceRuleMissing(rules: ServiceRules, context: ServiceRuleContext): RuleIssue[] {
  const missing: RuleIssue[] = [];
  const need = (path: string, present: boolean): void => {
    if (!present) missing.push({ path, reason: "REQUIRED" });
  };
  need("/booking/service_time", rules.booking.serviceTime !== null);
  need("/booking/lead_time_hours", rules.booking.leadTimeHours !== null);
  if (rules.urgent.enabled) need("/urgent/tiers", rules.urgent.tiers.length > 0);
  if (rules.night.enabled) {
    need("/night/window", rules.night.window !== null);
    need("/night/amount", rules.night.amountMinor !== null);
    need("/night/charge_unit", rules.night.chargeUnit !== null);
  }
  for (const item of freeWaitItems(context.category)) need(`/free_wait/${item}`, rules.freeWait[item] !== null);
  return missing;
}

/** 这个附加服务能不能设「首个免费」：只有按个计费的（座椅类）可以。 */
export function addonAllowsFirstFree(chargeUnit: AddonChargeUnit): boolean {
  return chargeUnit === "per_item";
}

// ---- 商品详情 ----

/** 一种语言的商品详情。都可以先不填；上架时看 `contentMissing`。 */
export interface ProductContentText {
  title: string | null;
  summary: string | null;
  includes: string[];
  excludes: string[];
  /** 行程路线（包车用） */
  itinerary: string | null;
  /** 接机 / 接站指引（接送机必填） */
  pickupGuide: string | null;
}

export type ProductContent = Partial<Record<(typeof MASTER_DATA_LANGUAGES)[number], ProductContentText>>;

/** 商品详情里填了的部分写得对不对（长度、条数、不能只有空白）。 */
export function contentIssues(content: ProductContent): RuleIssue[] {
  const issues: RuleIssue[] = [];
  for (const [language, text] of Object.entries(content)) {
    const at = `/${language}`;
    const checkText = (field: string, value: string | null, max: number): void => {
      if (value === null) return;
      if (!hasVisibleText(value)) issues.push({ path: `${at}/${field}`, reason: "REQUIRED" });
      else if (value.length > max) issues.push({ path: `${at}/${field}`, reason: "TOO_LONG", detail: { max } });
    };
    checkText("title", text.title, PRODUCT_LIMITS.maxTitleLength);
    checkText("summary", text.summary, PRODUCT_LIMITS.maxSummaryLength);
    checkText("itinerary", text.itinerary, PRODUCT_LIMITS.maxGuideLength);
    checkText("pickup_guide", text.pickupGuide, PRODUCT_LIMITS.maxGuideLength);
    for (const [field, list] of [["includes", text.includes], ["excludes", text.excludes]] as const) {
      if (list.length > PRODUCT_LIMITS.maxListItems) issues.push({ path: `${at}/${field}`, reason: "TOO_MANY", detail: { max: PRODUCT_LIMITS.maxListItems } });
      for (const [index, item] of list.entries()) checkText(`${field}/${index}`, item, PRODUCT_LIMITS.maxListItemLength);
    }
  }
  return issues;
}

/**
 * 上架前商品详情还缺什么：至少一种语言有标题；接送机商品，每一种有标题的语言都要有接机指引
 * （客人用哪种语言看这个商品，就要能用那种语言看到怎么找司机）。
 */
export function contentMissing(content: ProductContent, category: ServiceCategory): RuleIssue[] {
  const titled = MASTER_DATA_LANGUAGES.filter((language) => (content[language]?.title ?? null) !== null);
  if (titled.length === 0) return [{ path: "/title", reason: "REQUIRED" }];
  if (category !== "airport_transfer") return [];
  return titled.filter((language) => (content[language]?.pickupGuide ?? null) === null).map((language) => ({ path: `/${language}/pickup_guide`, reason: "REQUIRED" as const }));
}

/** 商品在列表上显示的标题：按语言的先后取第一个填了的；都没填是 null。 */
export function contentTitles(content: ProductContent): LocalizedText {
  const titles: LocalizedText = {};
  for (const language of MASTER_DATA_LANGUAGES) {
    const title = content[language]?.title ?? null;
    if (title !== null) titles[language] = title;
  }
  return titles;
}

// ---- 上架校验 ----

export const PUBLISH_CHECK_KEYS = ["basic_info", "service_rules", "price_rules", "content", "adjust_rules", "inventory"] as const;
export type PublishCheckKey = (typeof PUBLISH_CHECK_KEYS)[number];

export const PUBLISH_CHECK_NAMES: Readonly<Record<PublishCheckKey, string>> = {
  basic_info: "基础信息",
  service_rules: "服务规则",
  price_rules: "价格规则",
  content: "商品详情",
  adjust_rules: "调价规则",
  inventory: "库存",
};

export type PublishIssueReason =
  | RuleIssueReason
  /** 至少要选一个区域 / 车型组 / 调度人 */
  | "NO_AREA"
  | "NO_VEHICLE_GROUP"
  | "NO_DISPATCHER"
  /** 引用的东西现在不能用：已停用、已删除、不再匹配 */
  | "BRAND_DISABLED"
  | "CITY_DISABLED"
  | "PICKUP_PLACE_MISSING"
  | "PICKUP_PLACE_DISABLED"
  | "AREA_DISABLED"
  | "AREA_CITY_DISABLED"
  | "AREA_NOT_USABLE"
  | "VEHICLE_GROUP_DISABLED"
  | "VEHICLE_COMBO_NOT_OFFERED"
  | "ADDON_DISABLED"
  | "ADDON_NOT_APPLICABLE"
  /** 至少要有一条启用且未过期的价格规则 */
  | "NO_ACTIVE_PRICE_RULE"
  /** 这项功能还没有上线，所以这一项现在一定不满足（或对可选项：没有东西可查） */
  | "FEATURE_NOT_AVAILABLE";

export interface PublishIssue {
  /** 相对于这一项的字段路径，如 `/areas/0`、`/booking/service_time`；没有具体位置时是 `/` */
  path: string;
  reason: PublishIssueReason;
  detail?: Record<string, number>;
}

export interface PublishCheckItem {
  key: PublishCheckKey;
  /** 这一项不通过就不能上架 */
  required: boolean;
  passed: boolean;
  issues: PublishIssue[];
}

/** 上架校验要看的全部事实：由后端从库里取出来（前端也可以用页面上的数据拼出来预览）。 */
export interface PublishFacts {
  category: ServiceCategory;
  brandActive: boolean;
  cityActive: boolean;
  /** 接送机商品的接送点：没选是 null */
  pickupPlace: { active: boolean; type: PlaceType; flightScope: FlightScope | null } | null;
  /** 选的区域，按优先级 */
  areas: { status: "active" | "disabled"; bizType: AreaBizType; cityActive: boolean }[];
  /** 选的车型组；`comboOffered` = 选的「人数 / 行李数」组合现在还在这个车型组的可选组合里 */
  vehicleGroups: { active: boolean; comboOffered: boolean }[];
  dispatcherCount: number;
  serviceRules: ServiceRules;
  /** 服务规则里选的附加服务现在的情况（和 serviceRules.addons 一一对应）；只看开着的 */
  addons: { enabled: boolean; active: boolean; applicable: boolean }[];
  content: ProductContent;
  /** 启用且未过期的价格规则条数；价格规则功能还没上线时是 null */
  activePriceRuleCount: number | null;
}

/**
 * 上架校验（需求文档第 7 节）：逐项给出通过 / 不通过和原因，界面照着显示清单。
 * 四项必须（基础信息、服务规则、价格规则、商品详情），两项可选（调价规则、库存：没有要求，恒通过）。
 * 价格规则功能上线之前（`activePriceRuleCount` 为 null），「价格规则」一项固定不通过——所以商品可以建、可以跑校验，但还上不了架。
 */
export function publishCheck(facts: PublishFacts): PublishCheckItem[] {
  const basic: PublishIssue[] = [];
  if (!facts.brandActive) basic.push({ path: "/brand_id", reason: "BRAND_DISABLED" });
  if (!facts.cityActive) basic.push({ path: "/city_id", reason: "CITY_DISABLED" });
  if (facts.category === "airport_transfer") {
    if (facts.pickupPlace === null) basic.push({ path: "/poi_id", reason: "PICKUP_PLACE_MISSING" });
    else if (!facts.pickupPlace.active) basic.push({ path: "/poi_id", reason: "PICKUP_PLACE_DISABLED" });
  }
  if (facts.areas.length === 0) basic.push({ path: "/areas", reason: "NO_AREA" });
  for (const [index, area] of facts.areas.entries()) {
    if (area.status !== "active") basic.push({ path: `/areas/${index}`, reason: "AREA_DISABLED" });
    else if (!area.cityActive) basic.push({ path: `/areas/${index}`, reason: "AREA_CITY_DISABLED" });
    if (!areaUsableByCategory(facts.category, area.bizType)) basic.push({ path: `/areas/${index}`, reason: "AREA_NOT_USABLE" });
  }
  if (facts.vehicleGroups.length === 0) basic.push({ path: "/vehicle_groups", reason: "NO_VEHICLE_GROUP" });
  for (const [index, group] of facts.vehicleGroups.entries()) {
    if (!group.active) basic.push({ path: `/vehicle_groups/${index}`, reason: "VEHICLE_GROUP_DISABLED" });
    else if (!group.comboOffered) basic.push({ path: `/vehicle_groups/${index}`, reason: "VEHICLE_COMBO_NOT_OFFERED" });
  }
  if (facts.dispatcherCount === 0) basic.push({ path: "/dispatchers", reason: "NO_DISPATCHER" });

  const context: ServiceRuleContext = { category: facts.category, pickupPlace: facts.pickupPlace };
  const rules: PublishIssue[] = [...serviceRuleMissing(facts.serviceRules, context), ...serviceRuleIssues(facts.serviceRules, context)];
  for (const [index, addon] of facts.addons.entries()) {
    if (!addon.enabled) continue;
    if (!addon.active) rules.push({ path: `/addons/${index}/addon_id`, reason: "ADDON_DISABLED" });
    else if (!addon.applicable) rules.push({ path: `/addons/${index}/addon_id`, reason: "ADDON_NOT_APPLICABLE" });
  }

  const price: PublishIssue[] =
    facts.activePriceRuleCount === null ? [{ path: "/", reason: "FEATURE_NOT_AVAILABLE" }] : facts.activePriceRuleCount > 0 ? [] : [{ path: "/", reason: "NO_ACTIVE_PRICE_RULE" }];

  const content: PublishIssue[] = [...contentMissing(facts.content, facts.category), ...contentIssues(facts.content)];

  const item = (key: PublishCheckKey, required: boolean, issues: PublishIssue[]): PublishCheckItem => ({ key, required, passed: issues.length === 0, issues });
  return [item("basic_info", true, basic), item("service_rules", true, rules), item("price_rules", true, price), item("content", true, content), item("adjust_rules", false, []), item("inventory", false, [])];
}

/** 校验结果能不能上架：必须的每一项都通过。 */
export function canPublish(items: readonly PublishCheckItem[]): boolean {
  return items.every((item) => !item.required || item.passed);
}

/** 校验结果的概况（列表上「上架准备」一列用）。 */
export interface PublishCheckSummary {
  canPublish: boolean;
  /** 没满足的必须项里，功能已经开放、供应商自己能补的有几项 */
  failedRequired: number;
  /** 没满足的必须项里，因为功能还没上线而没法满足的有几项 */
  unavailableRequired: number;
}

export function publishCheckSummary(items: readonly PublishCheckItem[]): PublishCheckSummary {
  const failed = items.filter((item) => item.required && !item.passed);
  const unavailable = failed.filter((item) => item.issues.some((issue) => issue.reason === "FEATURE_NOT_AVAILABLE")).length;
  return { canPublish: failed.length === 0, failedRequired: failed.length - unavailable, unavailableRequired: unavailable };
}
