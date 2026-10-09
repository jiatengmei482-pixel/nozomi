/**
 * M1-03 商品规则的边界（测试工程师补）：各字段上限的「正好等于 / 多一个」、金额必须是最小货币单位整数、
 * 上架校验每个原因代码单独触发时不牵连别的项、每种品类该填的项。已有的 products.test.ts 覆盖了主干。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PRODUCT_LIMITS,
  type ProductContent,
  type ProductContentText,
  type PublishFacts,
  type PublishIssueReason,
  type ServiceRuleContext,
  type ServiceRules,
  canPublish,
  contentIssues,
  contentMissing,
  contentTitles,
  emptyServiceRules,
  isPhoneNumber,
  minimumFreeWaitMinutes,
  publishCheck,
  publishCheckSummary,
  serviceRuleIssues,
  serviceRuleMissing,
} from "./products.ts";

const airport: ServiceRuleContext = { category: "airport_transfer", pickupPlace: { type: "airport", flightScope: "mixed" } };
const charter: ServiceRuleContext = { category: "charter", pickupPlace: null };
const p2p: ServiceRuleContext = { category: "point_to_point", pickupPlace: null };

function rules(change: (draft: ServiceRules) => void = () => {}): ServiceRules {
  const draft = emptyServiceRules();
  change(draft);
  return draft;
}
const found = (value: ServiceRules, context: ServiceRuleContext = airport): string[] => serviceRuleIssues(value, context).map((issue) => `${issue.path} ${issue.reason}`);
const text = (extra: Partial<ProductContentText> = {}): ProductContentText => ({ title: "成田机场接送", summary: null, includes: [], excludes: [], itinerary: null, pickupGuide: null, ...extra });

function facts(extra: Partial<PublishFacts> = {}): PublishFacts {
  return {
    category: "airport_transfer",
    brandActive: true,
    cityActive: true,
    pickupPlace: { active: true, type: "airport", flightScope: "mixed" },
    areas: [{ status: "active", bizType: "general", cityActive: true }],
    vehicleGroups: [{ active: true, comboOffered: true }],
    dispatcherCount: 1,
    serviceRules: rules((draft) => {
      draft.booking.serviceTime = { start: "00:00", end: "24:00" };
      draft.booking.leadTimeHours = 24;
      draft.freeWait.pickup = { mode: "limited", minutes: 60 };
      draft.freeWait.dropoff = { mode: "limited", minutes: 15 };
    }),
    addons: [],
    content: { zh: text({ pickupGuide: "到达大厅 3 号门" }) },
    activePriceRuleCount: 1,
    ...extra,
  };
}
const failing = (extra: Partial<PublishFacts>): Record<string, string[]> =>
  Object.fromEntries(publishCheck(facts(extra)).filter((item) => !item.passed).map((item) => [item.key, item.issues.map((issue) => `${issue.path} ${issue.reason}`)]));

test("金额必须是最小货币单位整数：小数、负数、超过上限、NaN、无穷大都不行；0 和上限可以——加急费、夜间费、附加服务单价、司机语言单价四处一样", () => {
  const max = PRODUCT_LIMITS.maxAmountMinor;
  const cases: [number, string | null][] = [
    [0, null], [1, null], [max, null], [max + 1, "OUT_OF_RANGE"], [-1, "OUT_OF_RANGE"], [0.5, "NOT_INTEGER"], [99.99, "NOT_INTEGER"], [1e21, "OUT_OF_RANGE"],
    [Number.MAX_SAFE_INTEGER, "OUT_OF_RANGE"], [Number.NaN, "NOT_INTEGER"], [Number.POSITIVE_INFINITY, "NOT_INTEGER"], [-0.0001, "NOT_INTEGER"],
  ];
  const places: [string, (draft: ServiceRules, amount: number) => void][] = [
    ["/urgent/tiers/0/surcharge", (draft, amount) => void (draft.urgent.tiers = [{ withinHours: 1, surchargeMinor: amount }])],
    ["/night/amount", (draft, amount) => void (draft.night.amountMinor = amount)],
    ["/addons/0/unit_price", (draft, amount) => void (draft.addons = [{ addonId: "a", enabled: true, unitPriceMinor: amount, firstFree: false }])],
    ["/driver_languages/0/unit_price", (draft, amount) => void (draft.driverLanguages = [{ language: "zh", unitPriceMinor: amount }])],
  ];
  for (const [path, set] of places) {
    for (const [amount, reason] of cases) {
      assert.deepEqual(found(rules((draft) => set(draft, amount))), reason === null ? [] : [`${path} ${reason}`], `${path} = ${amount}`);
    }
  }
});

test("整数项的两端：提前预订时长 0–720、加急档 1–720、每日加急库存 1–10000、免等 0–1440；正好等于上限可以，多一就不行", () => {
  const lead = (hours: number): string[] => found(rules((draft) => void (draft.booking.leadTimeHours = hours)));
  assert.deepEqual([lead(0), lead(720), lead(721), lead(-1), lead(1.5)], [[], [], ["/booking/lead_time_hours OUT_OF_RANGE"], ["/booking/lead_time_hours OUT_OF_RANGE"], ["/booking/lead_time_hours NOT_INTEGER"]]);
  const tier = (hours: number, leadHours: number | null = null): string[] => found(rules((draft) => {
    draft.booking.leadTimeHours = leadHours;
    draft.urgent.tiers = [{ withinHours: hours, surchargeMinor: 0 }];
  }));
  assert.deepEqual([tier(1), tier(720), tier(0), tier(721), tier(2.5)], [[], [], ["/urgent/tiers/0/within_hours OUT_OF_RANGE"], ["/urgent/tiers/0/within_hours OUT_OF_RANGE"], ["/urgent/tiers/0/within_hours NOT_INTEGER"]]);
  assert.deepEqual([tier(24, 24), tier(25, 24), tier(1, 0)], [[], ["/urgent/tiers/0/within_hours TIER_NOT_WITHIN_LEAD_TIME"], ["/urgent/tiers/0/within_hours TIER_NOT_WITHIN_LEAD_TIME"]], "等于提前时长可以；提前时长是 0 时任何一档都用不上");
  assert.deepEqual(serviceRuleIssues(rules((draft) => { draft.booking.leadTimeHours = 24; draft.urgent.tiers = [{ withinHours: 25, surchargeMinor: 0 }]; }), airport)[0]?.detail, { lead_time_hours: 24 });
  const quota = (value: number): string[] => found(rules((draft) => void (draft.urgent.dailyQuota = value)));
  // 0 不行（和页面一致）：不限是留空，不想接加急是关掉加急
  assert.deepEqual([quota(1), quota(10_000), quota(0), quota(10_001), quota(-1), quota(0.5)], [[], [], ["/urgent/daily_quota OUT_OF_RANGE"], ["/urgent/daily_quota OUT_OF_RANGE"], ["/urgent/daily_quota OUT_OF_RANGE"], ["/urgent/daily_quota NOT_INTEGER"]]);
  assert.deepEqual(serviceRuleIssues(rules((draft) => void (draft.urgent.dailyQuota = 0)), airport)[0]?.detail, { min: 1, max: 10_000 });
  const wait = (minutes: number): string[] => found(rules((draft) => void (draft.freeWait.general = { mode: "limited", minutes })), charter);
  assert.deepEqual([wait(0), wait(1440), wait(1441), wait(-1), wait(0.5)], [[], [], ["/free_wait/general/minutes OUT_OF_RANGE"], ["/free_wait/general/minutes OUT_OF_RANGE"], ["/free_wait/general/minutes NOT_INTEGER"]]);
});

test("条数和长度的两端：加急 10 档、附加服务 50 个、司机语言 10 种、备注 500 字——正好等于可以，多一个就指出来", () => {
  const tiers = (count: number): string[] => found(rules((draft) => void (draft.urgent.tiers = Array.from({ length: count }, (_, index) => ({ withinHours: index + 1, surchargeMinor: 0 })))));
  assert.deepEqual([tiers(10), tiers(11)], [[], ["/urgent/tiers TOO_MANY"]]);
  const addons = (count: number): string[] => found(rules((draft) => void (draft.addons = Array.from({ length: count }, (_, index) => ({ addonId: `a${index}`, enabled: true, unitPriceMinor: 0, firstFree: false })))));
  assert.deepEqual([addons(50), addons(51)], [[], ["/addons TOO_MANY"]]);
  // 司机语言只能是平台支持的那几种（现在 4 种），所以正常填不到 10 条的上限；上限照样在，多于 10 条时先指出条数
  const languages = (list: string[]): string[] => found(rules((draft) => void (draft.driverLanguages = list.map((language) => ({ language, unitPriceMinor: 0 })))));
  assert.deepEqual(languages(["ja", "zh", "en", "ko"]), [], "支持的每一种各一条");
  assert.equal(languages(Array.from({ length: 10 }, () => "zh")).includes("/driver_languages TOO_MANY"), false, "正好 10 条不报条数");
  assert.equal(languages(Array.from({ length: 11 }, () => "zh"))[0], "/driver_languages TOO_MANY");
  const note = (length: number): string[] => found(rules((draft) => void (draft.booking.note = "字".repeat(length))));
  assert.deepEqual([note(500), note(501)], [[], ["/booking/note TOO_LONG"]]);
  for (const language of ["ZH", "zho", "z", "zh-CN", "中文", "", "fr", "th"]) assert.deepEqual(found(rules((draft) => void (draft.driverLanguages = [{ language, unitPriceMinor: 0 }]))), ["/driver_languages/0/language INVALID_LANGUAGE"], language);
});

test("下单有效期：同一天可以；只填一头可以；闰日；写法不对的那一头单独指出，不再报「顺序颠倒」", () => {
  const sale = (from: string | null, to: string | null): string[] => found(rules((draft) => { draft.booking.saleFrom = from; draft.booking.saleTo = to; }));
  assert.deepEqual(sale("2026-12-31", "2026-12-31"), []);
  assert.deepEqual(sale("2026-12-31", "2027-01-01"), [], "跨年");
  assert.deepEqual(sale("2028-02-29", null), []);
  assert.deepEqual(sale(null, "2028-02-29"), []);
  assert.deepEqual(sale("2027-02-29", null), ["/booking/sale_from INVALID_DATE"]);
  assert.deepEqual(sale("2027-01-01", "2026-12-31"), ["/booking/sale_to DATE_RANGE_REVERSED"]);
  assert.deepEqual(sale("2027-13-01", "2026-12-31"), ["/booking/sale_from INVALID_DATE"]);
  assert.deepEqual(sale("2026-10-08T00:00", "10/08/2026"), ["/booking/sale_from INVALID_DATE", "/booking/sale_to INVALID_DATE"]);
});

test("免等的平台最低值按品类和接送点：国际线 90、国内线 / 两种都有 / 没标 60、车站 30、送机 15、点对点 15、包车 0；正好等于可以，少一分钟不行", () => {
  const places: [ServiceRuleContext["pickupPlace"], number][] = [
    [{ type: "airport", flightScope: "international" }, 90], [{ type: "airport", flightScope: "domestic" }, 60], [{ type: "airport", flightScope: "mixed" }, 60], [{ type: "airport", flightScope: null }, 60], [{ type: "station", flightScope: null }, 30],
  ];
  for (const [pickupPlace, minimum] of places) {
    const context: ServiceRuleContext = { category: "airport_transfer", pickupPlace };
    assert.equal(minimumFreeWaitMinutes("airport_transfer", "pickup", pickupPlace), minimum);
    assert.equal(minimumFreeWaitMinutes("airport_transfer", "dropoff", pickupPlace), 15);
    assert.deepEqual(found(rules((draft) => void (draft.freeWait.pickup = { mode: "limited", minutes: minimum })), context), []);
    const below = serviceRuleIssues(rules((draft) => void (draft.freeWait.pickup = { mode: "limited", minutes: minimum - 1 })), context);
    assert.deepEqual(below, [{ path: "/free_wait/pickup/minutes", reason: "BELOW_PLATFORM_MINIMUM", detail: { min: minimum } }]);
    assert.deepEqual(found(rules((draft) => void (draft.freeWait.pickup = { mode: "unlimited" })), context), [], "无限不受最低值限制");
  }
  assert.deepEqual(found(rules((draft) => void (draft.freeWait.general = { mode: "limited", minutes: 14 })), p2p), ["/free_wait/general/minutes BELOW_PLATFORM_MINIMUM"]);
  assert.deepEqual(found(rules((draft) => void (draft.freeWait.general = { mode: "limited", minutes: 15 })), p2p), []);
  assert.deepEqual(found(rules((draft) => void (draft.freeWait.general = { mode: "limited", minutes: 0 })), charter), []);
  // 不是这个品类的项：填了就是错，不管填的是多少
  assert.deepEqual(found(rules((draft) => { draft.freeWait.pickup = { mode: "unlimited" }; draft.freeWait.dropoff = { mode: "limited", minutes: 999 }; }), charter), ["/free_wait/pickup NOT_APPLICABLE", "/free_wait/dropoff NOT_APPLICABLE"]);
  assert.deepEqual(found(rules((draft) => void (draft.freeWait.general = { mode: "limited", minutes: 1 })), airport), ["/free_wait/general NOT_APPLICABLE"]);
});

test("上架前还缺什么：三个品类各自该填的免等项；开了加急要有阶梯；开了夜间加价三样都要有；没开的不要求", () => {
  const missing = (value: ServiceRules, context: ServiceRuleContext): string[] => serviceRuleMissing(value, context).map((issue) => issue.path);
  assert.deepEqual(missing(emptyServiceRules(), airport), ["/booking/service_time", "/booking/lead_time_hours", "/free_wait/pickup", "/free_wait/dropoff"]);
  assert.deepEqual(missing(emptyServiceRules(), charter), ["/booking/service_time", "/booking/lead_time_hours", "/free_wait/general"]);
  assert.deepEqual(missing(emptyServiceRules(), p2p), ["/booking/service_time", "/booking/lead_time_hours", "/free_wait/general"]);
  assert.deepEqual(missing(rules((draft) => { draft.urgent.enabled = true; draft.night.enabled = true; }), charter).slice(2, 6), ["/urgent/tiers", "/night/window", "/night/amount", "/night/charge_unit"]);
  assert.deepEqual(missing(rules((draft) => { draft.booking.leadTimeHours = 0; draft.booking.serviceTime = { start: "00:00", end: "24:00" }; draft.freeWait.general = { mode: "limited", minutes: 0 }; draft.night.amountMinor = 0; }), charter), [], "0 是填了，不是没填");
});

test("调度人电话：数字个数 6 到 20；开头的 +、中间的空格和横线；括号、字母、全角数字、分机号不认", () => {
  const ok = ["123456", "+81 90-1234-5678", "090 1234 5678", "03-1234-5678", "+8613800138000", "12345678901234567890", "+12345678901234567890", "1-2-3-4-5-6"];
  const bad = ["", "12345", "+12345", "123456789012345678901", "+81 (90) 1234 5678", "(03) 1234-5678", "090-1234-5678 ext 12", "０９０１２３４５６７８", "+ 81 90 1234 5678", "-090-1234-5678", "++81 90 1234 5678", "090.1234.5678", "phone", "090/1234/5678"];
  assert.deepEqual(ok.filter((phone) => !isPhoneNumber(phone)), [], "应该认的");
  assert.deepEqual(bad.filter((phone) => isPhoneNumber(phone)), [], "不该认的");
});

test("商品详情的长度两端：标题 100、简介 2000、行程 2000、接机指引 2000、包含 / 不含各 30 条、每条 200——正好等于可以，多一个字 / 一条就指出来", () => {
  const issues = (content: ProductContent): string[] => contentIssues(content).map((issue) => `${issue.path} ${issue.reason}`);
  const fields: [keyof ProductContentText, string, number][] = [["title", "title", 100], ["summary", "summary", 2000], ["itinerary", "itinerary", 2000], ["pickupGuide", "pickup_guide", 2000]];
  for (const [field, path, max] of fields) {
    assert.deepEqual(issues({ ja: text({ [field]: "あ".repeat(max) }) }), [], `${path} 正好 ${max}`);
    assert.deepEqual(issues({ ja: text({ [field]: "あ".repeat(max + 1) }) }), [`/ja/${path} TOO_LONG`], `${path} 多一个字`);
    assert.deepEqual(issues({ ja: text({ [field]: " \n\t　" }) }), [`/ja/${path} REQUIRED`], `${path} 只有空白`);
  }
  for (const list of ["includes", "excludes"] as const) {
    assert.deepEqual(issues({ ko: text({ [list]: Array.from({ length: 30 }, () => "x".repeat(200)) }) }), []);
    assert.deepEqual(issues({ ko: text({ [list]: Array.from({ length: 31 }, () => "x") }) }), [`/ko/${list} TOO_MANY`]);
    assert.deepEqual(issues({ ko: text({ [list]: ["好", "x".repeat(201), " "] }) }), [`/ko/${list}/1 TOO_LONG`, `/ko/${list}/2 REQUIRED`]);
  }
  assert.deepEqual(contentIssues({ en: text({ title: "x".repeat(101) }) })[0]?.detail, { max: 100 });
});

test("接送机：每一种有标题的语言都要有接机指引——四种语言任意组合；没有标题的语言有没有指引都不管；包车和点对点不要求", () => {
  const languages = ["ja", "zh", "en", "ko"] as const;
  for (let titled = 0; titled < 16; titled += 1) {
    for (let guided = 0; guided < 16; guided += 1) {
      const content: ProductContent = {};
      languages.forEach((language, bit) => {
        const hasTitle = (titled & (1 << bit)) !== 0;
        const hasGuide = (guided & (1 << bit)) !== 0;
        if (hasTitle || hasGuide) content[language] = text({ title: hasTitle ? "标题" : null, pickupGuide: hasGuide ? "指引" : null });
      });
      const expected = titled === 0 ? ["/title"] : languages.filter((_, bit) => (titled & (1 << bit)) !== 0 && (guided & (1 << bit)) === 0).map((language) => `/${language}/pickup_guide`);
      assert.deepEqual(contentMissing(content, "airport_transfer").map((issue) => issue.path), expected, `标题 ${titled.toString(2)} 指引 ${guided.toString(2)}`);
      for (const category of ["charter", "point_to_point"] as const) assert.deepEqual(contentMissing(content, category).map((issue) => issue.path), titled === 0 ? ["/title"] : []);
      assert.deepEqual(Object.keys(contentTitles(content)).sort(), languages.filter((_, bit) => (titled & (1 << bit)) !== 0).sort());
    }
  }
});

test("上架校验：每个原因代码单独触发时只让它所在的那一项不通过，别的项不受牵连；概况里的个数跟着对", () => {
  const good = facts();
  assert.deepEqual(failing({}), {});
  const cases: [Partial<PublishFacts>, string, PublishIssueReason][] = [
    [{ brandActive: false }, "basic_info", "BRAND_DISABLED"],
    [{ cityActive: false }, "basic_info", "CITY_DISABLED"],
    [{ pickupPlace: null }, "basic_info", "PICKUP_PLACE_MISSING"],
    [{ pickupPlace: { active: false, type: "station", flightScope: null } }, "basic_info", "PICKUP_PLACE_DISABLED"],
    [{ areas: [] }, "basic_info", "NO_AREA"],
    [{ areas: [{ status: "disabled", bizType: "general", cityActive: true }] }, "basic_info", "AREA_DISABLED"],
    [{ areas: [{ status: "active", bizType: "general", cityActive: false }] }, "basic_info", "AREA_CITY_DISABLED"],
    [{ areas: [{ status: "active", bizType: "point_to_point", cityActive: true }] }, "basic_info", "AREA_NOT_USABLE"],
    [{ vehicleGroups: [] }, "basic_info", "NO_VEHICLE_GROUP"],
    [{ vehicleGroups: [{ active: false, comboOffered: false }] }, "basic_info", "VEHICLE_GROUP_DISABLED"],
    [{ vehicleGroups: [{ active: true, comboOffered: false }] }, "basic_info", "VEHICLE_COMBO_NOT_OFFERED"],
    [{ dispatcherCount: 0 }, "basic_info", "NO_DISPATCHER"],
    [{ addons: [{ enabled: true, active: false, applicable: false }] }, "service_rules", "ADDON_DISABLED"],
    [{ addons: [{ enabled: true, active: true, applicable: false }] }, "service_rules", "ADDON_NOT_APPLICABLE"],
    [{ serviceRules: { ...good.serviceRules, booking: { ...good.serviceRules.booking, serviceTime: null } } }, "service_rules", "REQUIRED"],
    [{ serviceRules: { ...good.serviceRules, booking: { ...good.serviceRules.booking, serviceTime: { start: "08:00", end: "08:00" } } } }, "service_rules", "EMPTY_WINDOW"],
    [{ serviceRules: { ...good.serviceRules, urgent: { enabled: true, dailyQuota: null, tiers: [] } } }, "service_rules", "REQUIRED"],
    [{ serviceRules: { ...good.serviceRules, urgent: { enabled: true, dailyQuota: null, tiers: [{ withinHours: 48, surchargeMinor: 1 }] } } }, "service_rules", "TIER_NOT_WITHIN_LEAD_TIME"],
    [{ pickupPlace: { active: true, type: "airport", flightScope: "international" } }, "service_rules", "BELOW_PLATFORM_MINIMUM"],
    [{ activePriceRuleCount: 0 }, "price_rules", "NO_ACTIVE_PRICE_RULE"],
    [{ activePriceRuleCount: null }, "price_rules", "FEATURE_NOT_AVAILABLE"],
    [{ content: {} }, "content", "REQUIRED"],
    [{ content: { zh: text({ pickupGuide: "指引", title: "题".repeat(101) }) } }, "content", "TOO_LONG"],
  ];
  for (const [change, key, reason] of cases) {
    const items = publishCheck(facts(change));
    const failed = items.filter((item) => !item.passed);
    assert.deepEqual(failed.map((item) => item.key), [key], `${reason}：只有 ${key} 不通过`);
    assert.deepEqual(failed[0]?.issues.map((issue) => issue.reason), [reason], reason);
    assert.equal(canPublish(items), false, reason);
    const summary = publishCheckSummary(items);
    assert.deepEqual(summary, { canPublish: false, failedRequired: reason === "FEATURE_NOT_AVAILABLE" ? 0 : 1, unavailableRequired: reason === "FEATURE_NOT_AVAILABLE" ? 1 : 0 }, reason);
  }
});

test("上架校验：区域业务类型和三个品类的全部组合；停用的区域同时业务类型不对时两条都报；包车 / 点对点不看接送点", () => {
  const bizTypes = ["general", "airport_transfer", "point_to_point", "charter"] as const;
  for (const category of ["airport_transfer", "point_to_point", "charter"] as const) {
    for (const bizType of bizTypes) {
      const usable = bizType === "general" || bizType === category;
      const basic = publishCheck(facts({ category, areas: [{ status: "active", bizType, cityActive: true }] }))[0];
      assert.deepEqual(basic?.issues.filter((issue) => issue.path.startsWith("/areas")).map((issue) => issue.reason), usable ? [] : ["AREA_NOT_USABLE"], `${category} × ${bizType}`);
    }
  }
  assert.deepEqual(failing({ areas: [{ status: "disabled", bizType: "charter", cityActive: false }] }).basic_info, ["/areas/0 AREA_DISABLED", "/areas/0 AREA_NOT_USABLE"]);
  const charterFacts = facts({ category: "charter", pickupPlace: null, content: { en: text() }, serviceRules: rules((draft) => { draft.booking.serviceTime = { start: "08:00", end: "20:00" }; draft.booking.leadTimeHours = 0; draft.freeWait.general = { mode: "limited", minutes: 0 }; }) });
  assert.deepEqual(publishCheck(charterFacts).filter((item) => !item.passed), []);
  assert.deepEqual(publishCheck({ ...charterFacts, category: "point_to_point" }).filter((item) => !item.passed).map((item) => item.issues.map((issue) => issue.reason)), [["BELOW_PLATFORM_MINIMUM"]], "同一份规则换成点对点：免等 0 低于 15");
});

test("上架校验：关着的加急 / 夜间加价不要求填，但里面写错的内容照样指出来；多个区域、车型组时路径里的序号对得上", () => {
  const base = facts().serviceRules;
  assert.deepEqual(failing({ serviceRules: { ...base, urgent: { enabled: false, dailyQuota: null, tiers: [] }, night: { enabled: false, window: null, amountMinor: null, chargeUnit: null } } }), {});
  assert.deepEqual(failing({ serviceRules: { ...base, night: { enabled: false, window: { start: "22:00", end: "22:00" }, amountMinor: -5, chargeUnit: null } } }).service_rules, ["/night/window EMPTY_WINDOW", "/night/amount OUT_OF_RANGE"]);
  assert.deepEqual(
    failing({
      areas: [{ status: "active", bizType: "general", cityActive: true }, { status: "disabled", bizType: "general", cityActive: true }, { status: "active", bizType: "general", cityActive: true }, { status: "active", bizType: "charter", cityActive: true }],
      vehicleGroups: [{ active: true, comboOffered: true }, { active: true, comboOffered: true }, { active: false, comboOffered: true }],
    }).basic_info,
    ["/areas/1 AREA_DISABLED", "/areas/3 AREA_NOT_USABLE", "/vehicle_groups/2 VEHICLE_GROUP_DISABLED"],
  );
  assert.deepEqual(failing({ addons: [{ enabled: false, active: false, applicable: false }, { enabled: true, active: true, applicable: true }, { enabled: true, active: false, applicable: true }] }).service_rules, ["/addons/2/addon_id ADDON_DISABLED"]);
});
