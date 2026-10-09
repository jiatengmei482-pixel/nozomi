import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PRODUCT_LIMITS,
  PRODUCT_STATUSES,
  PUBLISH_CHECK_KEYS,
  type ProductContent,
  type PublishFacts,
  type ServiceRules,
  addonAllowsFirstFree,
  areaUsableByCategory,
  canPublish,
  contentIssues,
  contentMissing,
  contentTitles,
  emptyServiceRules,
  freeWaitItems,
  isPhoneNumber,
  isPickupPlaceType,
  minimumFreeWaitMinutes,
  publishCheck,
  publishCheckSummary,
  serviceRuleIssues,
  serviceRuleMissing,
} from "./products.ts";

const airport = { category: "airport_transfer" as const, pickupPlace: { type: "airport" as const, flightScope: "mixed" as const } };
const charter = { category: "charter" as const, pickupPlace: null };

/** 一份填全了的接送机服务规则。 */
function complete(extra: Partial<ServiceRules> = {}): ServiceRules {
  return {
    booking: { saleFrom: "2026-10-01", saleTo: "2027-03-31", serviceTime: { start: "06:00", end: "23:00" }, leadTimeHours: 24, note: "节假日请提前联系" },
    urgent: { enabled: true, dailyQuota: 5, tiers: [{ withinHours: 12, surchargeMinor: 2000 }, { withinHours: 6, surchargeMinor: 5000 }] },
    night: { enabled: true, window: { start: "22:00", end: "06:00" }, amountMinor: 3000, chargeUnit: "per_order" },
    freeWait: { pickup: { mode: "limited", minutes: 90 }, dropoff: { mode: "limited", minutes: 15 }, general: null },
    addons: [{ addonId: "a1", enabled: true, unitPriceMinor: 1000, firstFree: true }],
    driverLanguages: [{ language: "zh", unitPriceMinor: 5000 }],
    ...extra,
  };
}

const reasons = (rules: ServiceRules, context: Parameters<typeof serviceRuleIssues>[1] = airport): string[] =>
  serviceRuleIssues(rules, context).map((issue) => `${issue.path} ${issue.reason}`);

test("常量：状态三种；上架校验六项；区域和品类的匹配；接送点只能是机场或车站", () => {
  assert.deepEqual([...PRODUCT_STATUSES], ["draft", "published", "unpublished"]);
  assert.deepEqual([...PUBLISH_CHECK_KEYS], ["basic_info", "service_rules", "price_rules", "content", "adjust_rules", "inventory"]);
  assert.equal(areaUsableByCategory("charter", "charter"), true);
  assert.equal(areaUsableByCategory("charter", "general"), true);
  assert.equal(areaUsableByCategory("charter", "airport_transfer"), false);
  assert.equal(areaUsableByCategory("point_to_point", "charter"), false);
  assert.deepEqual((["airport", "station", "poi", "terminal", "exit"] as const).map(isPickupPlaceType), [true, true, false, false, false]);
  assert.deepEqual([addonAllowsFirstFree("per_item"), addonAllowsFirstFree("per_order"), addonAllowsFirstFree("per_person")], [true, false, false]);
});

test("调度人的电话：数字，可带开头的 + 和中间的空格、横线", () => {
  for (const ok of ["+81 90-1234-5678", "09012345678", "+82-10-1234-5678", "031234"]) assert.equal(isPhoneNumber(ok), true, ok);
  for (const bad of ["", "12345", "abc-1234-5678", "+", "090 1234 5678 ext 3", "0".repeat(21), "++81901234567", "-0901234567"]) assert.equal(isPhoneNumber(bad), false, bad);
});

test("免等的平台最低值：国际线 90、国内线 60（两种都有按 60）、接站 30、送机和点对点 15、包车 0", () => {
  const at = (scope: "international" | "domestic" | "mixed" | null) => minimumFreeWaitMinutes("airport_transfer", "pickup", { type: "airport", flightScope: scope });
  assert.deepEqual([at("international"), at("domestic"), at("mixed"), at(null)], [90, 60, 60, 60]);
  assert.equal(minimumFreeWaitMinutes("airport_transfer", "pickup", { type: "station", flightScope: null }), 30);
  assert.equal(minimumFreeWaitMinutes("airport_transfer", "dropoff", { type: "airport", flightScope: "international" }), 15);
  assert.equal(minimumFreeWaitMinutes("point_to_point", "general", null), 15);
  assert.equal(minimumFreeWaitMinutes("charter", "general", null), 0);
  assert.deepEqual([freeWaitItems("airport_transfer"), freeWaitItems("point_to_point"), freeWaitItems("charter")], [["pickup", "dropoff"], ["general"], ["general"]]);
});

test("服务规则：填全了的没有问题；空的草稿也没有问题（没填不算错），但上架时缺的都列出来", () => {
  assert.deepEqual(serviceRuleIssues(complete(), airport), []);
  assert.deepEqual(serviceRuleMissing(complete(), airport), []);
  assert.deepEqual(serviceRuleIssues(emptyServiceRules(), airport), []);
  assert.deepEqual(serviceRuleMissing(emptyServiceRules(), airport).map((issue) => issue.path), ["/booking/service_time", "/booking/lead_time_hours", "/free_wait/pickup", "/free_wait/dropoff"]);
  assert.deepEqual(serviceRuleMissing(emptyServiceRules(), charter).map((issue) => issue.path), ["/booking/service_time", "/booking/lead_time_hours", "/free_wait/general"]);
  const switchedOn = { ...emptyServiceRules(), urgent: { enabled: true, dailyQuota: null, tiers: [] }, night: { enabled: true, window: null, amountMinor: null, chargeUnit: null } };
  assert.deepEqual(serviceRuleMissing(switchedOn, charter).map((issue) => issue.path).slice(2), ["/urgent/tiers", "/night/window", "/night/amount", "/night/charge_unit", "/free_wait/general"]);
  // 下单有效期、备注、附加服务、司机语言不是必填
  const minimal = complete({ addons: [], driverLanguages: [] });
  minimal.booking = { ...minimal.booking, saleFrom: null, saleTo: null, note: null };
  assert.deepEqual(serviceRuleMissing(minimal, airport), []);
});

test("服务规则：预订规则——日期、服务时间、提前时长", () => {
  const booking = (extra: Partial<ServiceRules["booking"]>): ServiceRules => ({ ...complete(), booking: { ...complete().booking, ...extra }, urgent: { enabled: false, dailyQuota: null, tiers: [] } });
  assert.deepEqual(reasons(booking({ saleFrom: "2026-02-30" })), ["/booking/sale_from INVALID_DATE"]);
  assert.deepEqual(reasons(booking({ saleFrom: "2027-01-01", saleTo: "2026-12-31" })), ["/booking/sale_to DATE_RANGE_REVERSED"]);
  assert.deepEqual(reasons(booking({ saleFrom: "2026-12-31", saleTo: "2026-12-31" })), [], "同一天可以");
  assert.deepEqual(reasons(booking({ serviceTime: { start: "25:00", end: "23:00" } })), ["/booking/service_time INVALID_TIME"]);
  assert.deepEqual(reasons(booking({ serviceTime: { start: "08:00", end: "08:00" } })), ["/booking/service_time EMPTY_WINDOW"]);
  assert.deepEqual(reasons(booking({ serviceTime: { start: "20:00", end: "04:00" } })), [], "跨午夜的服务时间");
  assert.deepEqual(reasons(booking({ serviceTime: { start: "00:00", end: "24:00" } })), [], "全天");
  assert.deepEqual(reasons(booking({ leadTimeHours: -1 })), ["/booking/lead_time_hours OUT_OF_RANGE"]);
  assert.deepEqual(reasons(booking({ leadTimeHours: 721 })), ["/booking/lead_time_hours OUT_OF_RANGE"]);
  assert.deepEqual(reasons(booking({ leadTimeHours: 1.5 })), ["/booking/lead_time_hours NOT_INTEGER"]);
  assert.deepEqual(reasons(booking({ leadTimeHours: 0 })), []);
  assert.deepEqual(reasons(booking({ note: "注".repeat(501) })), ["/booking/note TOO_LONG"]);
});

test("服务规则：加急阶梯——每档在提前时长以内、不重复、金额是不为负的整数", () => {
  const urgent = (tiers: ServiceRules["urgent"]["tiers"], leadTimeHours: number | null = 24): ServiceRules => ({
    ...complete(),
    booking: { ...complete().booking, leadTimeHours },
    urgent: { enabled: true, dailyQuota: 5, tiers },
  });
  assert.deepEqual(reasons(urgent([{ withinHours: 24, surchargeMinor: 0 }])), [], "等于提前时长、加收 0 都可以");
  assert.deepEqual(reasons(urgent([{ withinHours: 25, surchargeMinor: 100 }])), ["/urgent/tiers/0/within_hours TIER_NOT_WITHIN_LEAD_TIME"]);
  assert.deepEqual(serviceRuleIssues(urgent([{ withinHours: 25, surchargeMinor: 100 }]), airport)[0]?.detail, { lead_time_hours: 24 });
  assert.deepEqual(reasons(urgent([{ withinHours: 48, surchargeMinor: 100 }], null)), [], "提前时长还没填时不比较");
  assert.deepEqual(reasons(urgent([{ withinHours: 6, surchargeMinor: 100 }, { withinHours: 6, surchargeMinor: 200 }])), ["/urgent/tiers/1/within_hours DUPLICATE"]);
  assert.deepEqual(reasons(urgent([{ withinHours: 0, surchargeMinor: 100 }])), ["/urgent/tiers/0/within_hours OUT_OF_RANGE"]);
  assert.deepEqual(reasons(urgent([{ withinHours: 6, surchargeMinor: -1 }])), ["/urgent/tiers/0/surcharge OUT_OF_RANGE"]);
  assert.deepEqual(reasons(urgent([{ withinHours: 6, surchargeMinor: 10.5 }])), ["/urgent/tiers/0/surcharge NOT_INTEGER"]);
  assert.deepEqual(reasons(urgent([{ withinHours: 6, surchargeMinor: PRODUCT_LIMITS.maxAmountMinor + 1 }])), ["/urgent/tiers/0/surcharge OUT_OF_RANGE"]);
  assert.deepEqual(reasons(urgent(Array.from({ length: 11 }, (_, i) => ({ withinHours: i + 1, surchargeMinor: 100 })))), ["/urgent/tiers TOO_MANY"]);
  const quota = urgent([{ withinHours: 6, surchargeMinor: 100 }]);
  quota.urgent.dailyQuota = -1;
  assert.deepEqual(reasons(quota), ["/urgent/daily_quota OUT_OF_RANGE"]);
});

test("服务规则：夜间加价的时段可以跨午夜，不能是空的；金额不为负", () => {
  const night = (extra: Partial<ServiceRules["night"]>): ServiceRules => ({ ...complete(), night: { ...complete().night, ...extra } });
  assert.deepEqual(reasons(night({ window: { start: "22:00", end: "06:00" } })), []);
  assert.deepEqual(reasons(night({ window: { start: "22:00", end: "22:00" } })), ["/night/window EMPTY_WINDOW"]);
  assert.deepEqual(reasons(night({ window: { start: "22:00", end: "6:00" } })), ["/night/window INVALID_TIME"]);
  assert.deepEqual(reasons(night({ amountMinor: -100 })), ["/night/amount OUT_OF_RANGE"]);
  assert.deepEqual(reasons(night({ amountMinor: 0 })), []);
});

test("服务规则：免等——只能填这个品类该填的项；有限时长不能低于平台的最低值，等于可以；无限可以", () => {
  const wait = (freeWait: ServiceRules["freeWait"]): ServiceRules => ({ ...complete(), freeWait });
  const intl = { category: "airport_transfer" as const, pickupPlace: { type: "airport" as const, flightScope: "international" as const } };
  assert.deepEqual(reasons(wait({ pickup: { mode: "limited", minutes: 89 }, dropoff: { mode: "limited", minutes: 15 }, general: null }), intl), ["/free_wait/pickup/minutes BELOW_PLATFORM_MINIMUM"]);
  assert.deepEqual(serviceRuleIssues(wait({ pickup: { mode: "limited", minutes: 89 }, dropoff: null, general: null }), intl)[0]?.detail, { min: 90 });
  assert.deepEqual(reasons(wait({ pickup: { mode: "limited", minutes: 90 }, dropoff: { mode: "limited", minutes: 14 }, general: null }), intl), ["/free_wait/dropoff/minutes BELOW_PLATFORM_MINIMUM"]);
  assert.deepEqual(reasons(wait({ pickup: { mode: "limited", minutes: 60 }, dropoff: { mode: "unlimited" }, general: null }), airport), []);
  assert.deepEqual(reasons(wait({ pickup: { mode: "unlimited" }, dropoff: { mode: "unlimited" }, general: null }), intl), []);
  assert.deepEqual(reasons(wait({ pickup: { mode: "limited", minutes: 30 }, dropoff: { mode: "limited", minutes: 15 }, general: null }), { category: "airport_transfer", pickupPlace: { type: "station", flightScope: null } }), []);
  assert.deepEqual(reasons(wait({ pickup: null, dropoff: null, general: { mode: "limited", minutes: 0 } }), charter), [], "包车可以是 0");
  assert.deepEqual(reasons(wait({ pickup: null, dropoff: null, general: { mode: "limited", minutes: 14 } }), { category: "point_to_point", pickupPlace: null }), ["/free_wait/general/minutes BELOW_PLATFORM_MINIMUM"]);
  assert.deepEqual(reasons(wait({ pickup: { mode: "unlimited" }, dropoff: null, general: { mode: "unlimited" } }), charter), ["/free_wait/pickup NOT_APPLICABLE"]);
  assert.deepEqual(reasons(wait({ pickup: { mode: "unlimited" }, dropoff: { mode: "unlimited" }, general: { mode: "unlimited" } }), airport), ["/free_wait/general NOT_APPLICABLE"]);
  assert.deepEqual(reasons(wait({ pickup: null, dropoff: null, general: { mode: "limited", minutes: 1441 } }), charter), ["/free_wait/general/minutes OUT_OF_RANGE"]);
  assert.deepEqual(reasons(wait({ pickup: null, dropoff: null, general: { mode: "limited", minutes: 2.5 } }), charter), ["/free_wait/general/minutes NOT_INTEGER"]);
});

test("服务规则：附加服务和司机语言——不重复、单价不为负（0 = 免费提供）、语言是两位小写代码", () => {
  const withAddons = (addons: ServiceRules["addons"], driverLanguages: ServiceRules["driverLanguages"] = []): ServiceRules => ({ ...complete(), addons, driverLanguages });
  assert.deepEqual(reasons(withAddons([{ addonId: "a", enabled: true, unitPriceMinor: 0, firstFree: false }, { addonId: "b", enabled: false, unitPriceMinor: 500, firstFree: false }])), []);
  assert.deepEqual(reasons(withAddons([{ addonId: "a", enabled: true, unitPriceMinor: 0, firstFree: false }, { addonId: "a", enabled: true, unitPriceMinor: 1, firstFree: false }])), ["/addons/1/addon_id DUPLICATE"]);
  assert.deepEqual(reasons(withAddons([{ addonId: "a", enabled: true, unitPriceMinor: -5, firstFree: false }])), ["/addons/0/unit_price OUT_OF_RANGE"]);
  assert.deepEqual(reasons(withAddons([], [{ language: "zh", unitPriceMinor: 0 }, { language: "en", unitPriceMinor: 3000 }])), []);
  assert.deepEqual(reasons(withAddons([], [{ language: "zh", unitPriceMinor: 0 }, { language: "zh", unitPriceMinor: 1 }])), ["/driver_languages/1/language DUPLICATE"]);
  assert.deepEqual(reasons(withAddons([], [{ language: "Chinese", unitPriceMinor: 0 }, { language: "ZH", unitPriceMinor: 1.5 }])), ["/driver_languages/0/language INVALID_LANGUAGE", "/driver_languages/1/language INVALID_LANGUAGE", "/driver_languages/1/unit_price NOT_INTEGER"]);
});

const text = (extra: Partial<NonNullable<ProductContent["zh"]>> = {}): NonNullable<ProductContent["zh"]> => ({ title: "成田机场接送", summary: null, includes: [], excludes: [], itinerary: null, pickupGuide: null, ...extra });

test("商品详情：至少一种语言的标题；接送机商品每一种有标题的语言都要有接机指引；列表上的标题", () => {
  assert.deepEqual(contentMissing({}, "charter"), [{ path: "/title", reason: "REQUIRED" }]);
  assert.deepEqual(contentMissing({ zh: text({ title: null, summary: "只有简介" }) }, "charter"), [{ path: "/title", reason: "REQUIRED" }]);
  assert.deepEqual(contentMissing({ zh: text() }, "charter"), []);
  assert.deepEqual(contentMissing({ zh: text() }, "point_to_point"), []);
  assert.deepEqual(contentMissing({ zh: text() }, "airport_transfer"), [{ path: "/zh/pickup_guide", reason: "REQUIRED" }]);
  assert.deepEqual(contentMissing({ zh: text({ pickupGuide: "到达大厅 3 号门" }), ja: text({ title: "成田空港送迎" }), en: text({ title: null, pickupGuide: "Gate 3" }) }, "airport_transfer"), [{ path: "/ja/pickup_guide", reason: "REQUIRED" }]);
  assert.deepEqual(contentTitles({ en: text({ title: "Narita transfer" }), zh: text(), ko: text({ title: null }) }), { zh: "成田机场接送", en: "Narita transfer" });
  assert.deepEqual(contentTitles({}), {});
});

test("商品详情：填了的部分——不能只有空白、长度和条数的上限", () => {
  assert.deepEqual(contentIssues({ zh: text({ summary: "简介", includes: ["司机", "油费"], excludes: ["高速费"], itinerary: "东京 → 富士山", pickupGuide: "3 号门" }) }), []);
  const paths = (content: ProductContent): string[] => contentIssues(content).map((issue) => `${issue.path} ${issue.reason}`);
  assert.deepEqual(paths({ zh: text({ title: "  " }) }), ["/zh/title REQUIRED"]);
  assert.deepEqual(paths({ zh: text({ title: "​" }) }), ["/zh/title REQUIRED"]);
  assert.deepEqual(paths({ ja: text({ title: "題".repeat(101) }) }), ["/ja/title TOO_LONG"]);
  assert.deepEqual(paths({ zh: text({ summary: "简".repeat(2001), pickupGuide: "引".repeat(2001) }) }), ["/zh/summary TOO_LONG", "/zh/pickup_guide TOO_LONG"]);
  assert.deepEqual(paths({ zh: text({ includes: Array.from({ length: 31 }, () => "项") }) }), ["/zh/includes TOO_MANY"]);
  assert.deepEqual(paths({ zh: text({ excludes: ["好", " ", "x".repeat(201)] }) }), ["/zh/excludes/1 REQUIRED", "/zh/excludes/2 TOO_LONG"]);
});

function facts(extra: Partial<PublishFacts> = {}): PublishFacts {
  return {
    category: "airport_transfer",
    brandActive: true,
    cityActive: true,
    pickupPlace: { active: true, type: "airport", flightScope: "mixed" },
    areas: [{ status: "active", bizType: "airport_transfer", cityActive: true }, { status: "active", bizType: "general", cityActive: true }],
    vehicleGroups: [{ active: true, comboOffered: true }],
    dispatcherCount: 1,
    serviceRules: complete(),
    addons: [{ enabled: true, active: true, applicable: true }],
    content: { zh: text({ pickupGuide: "到达大厅 3 号门" }) },
    activePriceRuleCount: 1,
    ...extra,
  };
}

const failing = (extra: Partial<PublishFacts>): Record<string, string[]> =>
  Object.fromEntries(publishCheck(facts(extra)).filter((item) => !item.passed).map((item) => [item.key, item.issues.map((issue) => `${issue.path} ${issue.reason}`)]));

test("上架校验：六项按顺序给出，四项必须、两项可选；全部满足时可以上架", () => {
  const items = publishCheck(facts());
  assert.deepEqual(items.map((item) => [item.key, item.required, item.passed]), [
    ["basic_info", true, true], ["service_rules", true, true], ["price_rules", true, true], ["content", true, true], ["adjust_rules", false, true], ["inventory", false, true],
  ]);
  assert.equal(canPublish(items), true);
  assert.ok(items.every((item) => item.issues.length === 0));
});

test("上架校验：价格规则功能还没上线时这一项固定不通过；上线后要至少一条启用且未过期的", () => {
  assert.deepEqual(failing({ activePriceRuleCount: null }), { price_rules: ["/ FEATURE_NOT_AVAILABLE"] });
  assert.equal(canPublish(publishCheck(facts({ activePriceRuleCount: null }))), false);
  assert.deepEqual(failing({ activePriceRuleCount: 0 }), { price_rules: ["/ NO_ACTIVE_PRICE_RULE"] });
});

test("上架校验：基础信息——至少一个区域、一个车型组、一个调度人；引用的东西现在都得能用", () => {
  assert.deepEqual(failing({ areas: [], vehicleGroups: [], dispatcherCount: 0 }), { basic_info: ["/areas NO_AREA", "/vehicle_groups NO_VEHICLE_GROUP", "/dispatchers NO_DISPATCHER"] });
  assert.deepEqual(failing({ brandActive: false, cityActive: false }), { basic_info: ["/brand_id BRAND_DISABLED", "/city_id CITY_DISABLED"] });
  assert.deepEqual(failing({ pickupPlace: null }).basic_info, ["/poi_id PICKUP_PLACE_MISSING"]);
  assert.deepEqual(failing({ pickupPlace: { active: false, type: "airport", flightScope: null } }).basic_info, ["/poi_id PICKUP_PLACE_DISABLED"]);
  assert.deepEqual(failing({ category: "charter", pickupPlace: null, content: { zh: text() }, serviceRules: complete({ freeWait: { pickup: null, dropoff: null, general: { mode: "unlimited" } } }), areas: [{ status: "active", bizType: "general", cityActive: true }] }), {}, "包车不需要接送点");
  assert.deepEqual(
    failing({ areas: [{ status: "disabled", bizType: "general", cityActive: true }, { status: "active", bizType: "charter", cityActive: true }, { status: "active", bizType: "general", cityActive: false }] }),
    { basic_info: ["/areas/0 AREA_DISABLED", "/areas/1 AREA_NOT_USABLE", "/areas/2 AREA_CITY_DISABLED"] },
  );
  assert.deepEqual(failing({ vehicleGroups: [{ active: true, comboOffered: true }, { active: false, comboOffered: true }, { active: true, comboOffered: false }] }), {
    basic_info: ["/vehicle_groups/1 VEHICLE_GROUP_DISABLED", "/vehicle_groups/2 VEHICLE_COMBO_NOT_OFFERED"],
  });
});

test("上架校验：服务规则——缺的、写错的、选的附加服务被平台停用或不再适用这个品类（关着的不查）", () => {
  assert.deepEqual(failing({ serviceRules: emptyServiceRules(), addons: [] }), {
    service_rules: ["/booking/service_time REQUIRED", "/booking/lead_time_hours REQUIRED", "/free_wait/pickup REQUIRED", "/free_wait/dropoff REQUIRED"],
  });
  assert.deepEqual(failing({ addons: [{ enabled: true, active: false, applicable: true }] }), { service_rules: ["/addons/0/addon_id ADDON_DISABLED"] });
  assert.deepEqual(failing({ addons: [{ enabled: true, active: true, applicable: false }] }), { service_rules: ["/addons/0/addon_id ADDON_NOT_APPLICABLE"] });
  assert.deepEqual(failing({ addons: [{ enabled: false, active: false, applicable: false }] }), {});
  // 机场后来被标成只走国际线：原来设的 60 分钟就低于平台的最低值了
  assert.deepEqual(
    failing({ pickupPlace: { active: true, type: "airport", flightScope: "international" }, serviceRules: complete({ freeWait: { pickup: { mode: "limited", minutes: 60 }, dropoff: { mode: "limited", minutes: 15 }, general: null } }) }),
    { service_rules: ["/free_wait/pickup/minutes BELOW_PLATFORM_MINIMUM"] },
  );
});

test("上架校验：商品详情；几项同时不满足时各自列出，可选项不影响能不能上架", () => {
  assert.deepEqual(failing({ content: {} }), { content: ["/title REQUIRED"] });
  assert.deepEqual(failing({ content: { zh: text() } }), { content: ["/zh/pickup_guide REQUIRED"] });
  const many = publishCheck(facts({ content: {}, areas: [], activePriceRuleCount: null, serviceRules: emptyServiceRules(), addons: [] }));
  assert.deepEqual(many.filter((item) => !item.passed).map((item) => item.key), ["basic_info", "service_rules", "price_rules", "content"]);
  assert.equal(canPublish(many), false);
  assert.equal(canPublish([{ key: "inventory", required: false, passed: false, issues: [] }]), true);
});

test("上架校验的概况：分开数「自己能补的」和「功能还没上线的」必须项；可选项不算", () => {
  assert.deepEqual(publishCheckSummary(publishCheck(facts())), { canPublish: true, failedRequired: 0, unavailableRequired: 0 });
  assert.deepEqual(publishCheckSummary(publishCheck(facts({ activePriceRuleCount: null }))), { canPublish: false, failedRequired: 0, unavailableRequired: 1 });
  assert.deepEqual(publishCheckSummary(publishCheck(facts({ activePriceRuleCount: 0, content: {} }))), { canPublish: false, failedRequired: 2, unavailableRequired: 0 });
  assert.deepEqual(publishCheckSummary(publishCheck(facts({ activePriceRuleCount: null, areas: [], content: {} }))), { canPublish: false, failedRequired: 2, unavailableRequired: 1 });
  assert.deepEqual(publishCheckSummary([{ key: "inventory", required: false, passed: false, issues: [] }]), { canPublish: true, failedRequired: 0, unavailableRequired: 0 });
});

test("上架校验：价格规则的三种不通过原因、调价规则和库存的提醒（后两项不是必须的，不通过也能上架）", () => {
  const item = (extra: Parameters<typeof facts>[0], key: string) => publishCheck(facts(extra)).find((entry) => entry.key === key);
  const priceReasons = (extra: Parameters<typeof facts>[0]): string[] => (item(extra, "price_rules")?.issues ?? []).map((issue) => issue.reason);
  assert.deepEqual(priceReasons({ activePriceRuleCount: 0 }), ["NO_ACTIVE_PRICE_RULE"]);
  assert.deepEqual(priceReasons({ activePriceRuleCount: 0, priceRuleStats: { total: 0, enabled: 0 } }), ["NO_ACTIVE_PRICE_RULE"]);
  assert.deepEqual(priceReasons({ activePriceRuleCount: 0, priceRuleStats: { total: 3, enabled: 0 } }), ["ALL_PRICE_RULES_DISABLED"]);
  assert.deepEqual(priceReasons({ activePriceRuleCount: 0, priceRuleStats: { total: 3, enabled: 2 } }), ["ALL_PRICE_RULES_EXPIRED"]);
  assert.deepEqual(priceReasons({ activePriceRuleCount: 1, priceRuleStats: { total: 3, enabled: 2 } }), []);
  // 调价规则：把价格调到不大于 0 的那几条
  const adjust = item({ nonPositiveAdjustRules: [0, 2] }, "adjust_rules");
  assert.deepEqual([adjust?.required, adjust?.passed, adjust?.issues], [false, false, [{ path: "/0", reason: "ADJUST_RESULT_NOT_POSITIVE" }, { path: "/2", reason: "ADJUST_RESULT_NOT_POSITIVE" }]]);
  assert.equal(canPublish(publishCheck(facts({ nonPositiveAdjustRules: [0] }))), true);
  // 库存：不限量、限量且有库存 → 通过；限量但从今天起一天都没有 → 提醒
  assert.equal(item({}, "inventory")?.passed, true);
  assert.equal(item({ inventory: { mode: "unlimited", sellableDaysAhead: 0 } }, "inventory")?.passed, true);
  assert.equal(item({ inventory: { mode: "limited", sellableDaysAhead: 3 } }, "inventory")?.passed, true);
  const empty = item({ inventory: { mode: "limited", sellableDaysAhead: 0 } }, "inventory");
  assert.deepEqual([empty?.required, empty?.passed, empty?.issues], [false, false, [{ path: "/", reason: "NO_INVENTORY_AHEAD" }]]);
  assert.equal(canPublish(publishCheck(facts({ inventory: { mode: "limited", sellableDaysAhead: 0 } }))), true, "库存不是必须项");
});
