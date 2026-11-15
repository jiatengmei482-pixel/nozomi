/**
 * M9P-05（ADR 0093 第一、五节）：包车三层区域的数据结构和引擎按商品标志切换新旧表。
 * - ②行程加价（`charter_itinerary_surcharge`）、整商品套餐价（区域为空）、加价的空套餐（= 所有套餐）只有迁移过的商品（`charterLayout: "three_layer"`）能用；
 * - 迁移过的商品：经停只从②取、套餐价只用整商品套餐价；没迁移过的整套用旧表，即使有新格式的行也不读。
 * - ②不参与上下车点匹配。
 * 例子沿用规格第一节：东京市内 10h 55,000；富士山上 / 下车 10,000、行程 10,000；镰仓上 / 下车 6,000、行程 6,000。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Position } from "./areas.ts";
import type { LatLng } from "./geo.ts";
import { charterMatches } from "./charter-match.ts";
import { type PriceRule, charterMigrationDiff, findPriceRuleOverlaps, itineraryAreaIds, priceRuleIssues, sellablePriceRules, surchargeAreaIds, surchargeModelsFor } from "./pricing.ts";
import { emptyServiceRules } from "./products.ts";
import { type QuoteArea, type QuoteMoment, type QuoteProduct, type QuoteRequest, lockableAreaSurcharge, quoteProduct } from "./quote.ts";

const square = (west: number, south: number, east: number, north: number): Position[] => [[west, south], [east, south], [east, north], [west, north], [west, south]];
const area = (areaId: string, ring: Position[]): QuoteArea => ({ areaId, active: true, shapes: [{ id: `${areaId}-op`, kind: "operate", ring }] });

const TOKYO = area("tokyo", square(139.55, 35.55, 139.95, 35.85));
const FUJI = area("fuji", square(138.55, 35.25, 139.0, 35.55));
const KAMAKURA = area("kamakura", square(139.5, 35.28, 139.6, 35.36));
/** 只当②用的小景区：河口湖（在富士山③里面） */
const LAKE = area("lake", square(138.74, 35.48, 138.8, 35.52));
const P = {
  shinjuku: { lng: 139.7, lat: 35.69 },
  gogome: { lng: 138.73, lat: 35.39 },
  lake: { lng: 138.76, lat: 35.5 },
  tsurugaoka: { lng: 139.556, lat: 35.326 },
} satisfies Record<string, LatLng>;
type Place = keyof typeof P;

const rule = (id: string, areaId: string | null, pricing: PriceRule["pricing"], extra: Partial<PriceRule> = {}): PriceRule & { id: string } => ({ id, areaId, vehicleGroupId: "eco7", direction: null, packageHours: 10, pricing, validFrom: "2026-01-01", validTo: null, status: "enabled", ...extra });
const pkgPricing = (packagePriceMinor: number): PriceRule["pricing"] => ({ model: "charter_package", packageKm: 300, packagePriceMinor, overtimePerHourMinor: 5_000, overKmPerKmMinor: 400 });
const updown = (id: string, areaId: string, pickup: number, dropoff: number, waypoint?: number, extra: Partial<PriceRule> = {}) =>
  rule(id, areaId, { model: "charter_area_surcharge", pickupSurchargeMinor: pickup, dropoffSurchargeMinor: dropoff, ...(waypoint === undefined ? {} : { waypointSurchargeMinor: waypoint }) }, extra);
const itinerary = (id: string, areaId: string, surchargeMinor: number, extra: Partial<PriceRule> = {}) => rule(id, areaId, { model: "charter_itinerary_surcharge", surchargeMinor }, extra);

/** 旧表：东京市内套餐价 55,000；③行里带途经加价 */
const LEGACY_RULES = [rule("p-tokyo", "tokyo", pkgPricing(55_000)), updown("s-fuji", "fuji", 10_000, 10_000, 10_000), updown("s-kama", "kamakura", 6_000, 6_000, 6_000)];
/**
 * 迁移后：旧行原样保留（按区域套餐价、③行里的途经加价都不再读）；新增整商品套餐价 60,000（故意和旧的 55,000 不同，好分辨读的是哪一条）、
 * ②富士山 12,000 / 镰仓 7,000（故意和③行里的途经加价不同）
 */
const MIGRATED_RULES = [...LEGACY_RULES, rule("p-wide", null, pkgPricing(60_000)), itinerary("i-fuji", "fuji", 12_000), itinerary("i-kama", "kamakura", 7_000)];

const product = (extra: Partial<QuoteProduct> = {}): QuoteProduct => ({
  productId: "charter-1",
  tenantId: "tenant-a",
  category: "charter",
  status: "published",
  tenantActive: true,
  brandActive: true,
  currency: "JPY",
  roundingUnit: 1,
  timeZone: "Asia/Tokyo",
  pickupPlace: null,
  areas: [TOKYO],
  surchargeAreas: [FUJI, KAMAKURA, LAKE],
  vehicleGroups: [{ vehicleGroupId: "eco7", passengers: 6, luggage: 4, active: true }],
  serviceRules: { ...emptyServiceRules(), booking: { saleFrom: null, saleTo: null, serviceTime: { start: "00:00", end: "24:00" }, leadTimeHours: 24, note: null }, freeWait: { pickup: null, dropoff: null, general: { mode: "limited", minutes: 0 } } },
  addonCatalog: [],
  priceRules: LEGACY_RULES,
  adjustRules: [],
  inventoryMode: "unlimited",
  ...extra,
});
const migrated = (extra: Partial<QuoteProduct> = {}): QuoteProduct => product({ charterLayout: "three_layer", priceRules: MIGRATED_RULES, ...extra });
const trip = (pickup: Place, waypoints: Place[], dropoff: Place, extra: Partial<QuoteRequest> = {}): QuoteRequest => ({
  category: "charter",
  pickup: P[pickup],
  dropoff: P[dropoff],
  direction: null,
  packageHours: 10,
  serviceLocal: "2026-10-20T10:00",
  passengers: 2,
  luggage: 1,
  addons: [],
  driverLanguage: null,
  vehicleGroupIds: [],
  ...(waypoints.length === 0 ? {} : { waypoints: waypoints.map((place) => P[place]) }),
  ...extra,
});
const moment: QuoteMoment = { now: new Date("2026-10-07T01:00:00Z"), route: null, inventoryDay: null, urgentUsed: 0 };

/** 结算价或原因（带第几个经停点） */
function priced(request: QuoteRequest, item: QuoteProduct): number | string {
  const quote = quoteProduct(item, request, moment);
  if (!quote.ok) return quote.reason;
  const offer = quote.offers[0];
  if (offer !== undefined) return offer.settlement.totalMinor;
  const refusal = quote.refused[0];
  return refusal === undefined ? "NONE" : `${refusal.reason}${refusal.stopSeq === undefined ? "" : `@${refusal.stopSeq}`}`;
}
function settlement(request: QuoteRequest, item: QuoteProduct) {
  const quote = quoteProduct(item, request, moment);
  assert.ok(quote.ok && quote.offers.length === 1, JSON.stringify(quote));
  return (quote.offers[0] as (typeof quote.offers)[number]).settlement;
}

// ---- 价格规则：新格式只有迁移过的商品能用 ----

test("②行程加价、整商品套餐价、加价的空套餐：迁移过的商品能用；没迁移过的（不给标志）照旧报错，和以前一样", () => {
  const layered = { category: "charter" as const, charterLayout: "three_layer" as const };
  const legacy = { category: "charter" as const };
  assert.deepEqual(surchargeModelsFor("charter", "three_layer"), ["charter_area_surcharge", "charter_itinerary_surcharge"]);
  assert.deepEqual(surchargeModelsFor("charter"), ["charter_area_surcharge"], "没迁移过的只有上下车加价");
  assert.deepEqual(surchargeModelsFor("point_to_point", "three_layer"), [], "别的品类没有加价");

  assert.deepEqual(priceRuleIssues(itinerary("i", "fuji", 0), layered), [], "行程加价可以是 0");
  assert.deepEqual(priceRuleIssues(itinerary("i", "fuji", 12_000, { packageHours: null }), layered), [], "套餐可空 = 所有套餐");
  assert.deepEqual(priceRuleIssues(updown("u", "fuji", 1, 1, undefined, { packageHours: null }), layered), []);
  assert.deepEqual(priceRuleIssues(rule("w", null, pkgPricing(60_000)), layered), [], "整商品套餐价");
  assert.deepEqual(priceRuleIssues(itinerary("i", "fuji", -1), layered), [{ path: "/itinerary_surcharge", reason: "OUT_OF_RANGE", detail: { min: 0, max: 1_000_000_000 } }]);
  assert.deepEqual(priceRuleIssues(itinerary("i", "fuji", 1.5), layered), [{ path: "/itinerary_surcharge", reason: "NOT_INTEGER" }]);
  assert.deepEqual(priceRuleIssues(rule("w", null, pkgPricing(60_000), { packageHours: null }), layered), [{ path: "/package_hours", reason: "REQUIRED" }], "套餐价的套餐仍必填");
  assert.deepEqual(priceRuleIssues(itinerary("i", "fuji", 1, { areaId: null }), layered), [{ path: "/area_id", reason: "REQUIRED" }], "加价必须挂区域");

  assert.deepEqual(priceRuleIssues(itinerary("i", "fuji", 0), legacy), [{ path: "/pricing_model", reason: "MODEL_NOT_ALLOWED" }]);
  assert.deepEqual(priceRuleIssues(rule("w", null, pkgPricing(60_000)), legacy), [{ path: "/area_id", reason: "REQUIRED" }]);
  assert.deepEqual(priceRuleIssues(updown("u", "fuji", 1, 1, undefined, { packageHours: null }), legacy), [{ path: "/package_hours", reason: "REQUIRED" }]);
  assert.deepEqual(priceRuleIssues(itinerary("i", "fuji", 0), { category: "point_to_point", charterLayout: "three_layer" }), [{ path: "/package_hours", reason: "NOT_APPLICABLE" }, { path: "/pricing_model", reason: "MODEL_NOT_ALLOWED" }]);
});

test("冲突分三类（套餐价 / 上下车加价 / 行程加价）：同一区域可以同时有③和②；整商品套餐价按「车型组 × 套餐 × 日期」查重；空套餐和具体套餐不冲突", () => {
  assert.deepEqual(findPriceRuleOverlaps([updown("u", "fuji", 1, 1), itinerary("i", "fuji", 1), rule("p", "fuji", pkgPricing(1))]), []);
  assert.deepEqual(findPriceRuleOverlaps([itinerary("a", "fuji", 1), itinerary("b", "fuji", 2, { validFrom: "2026-06-01" })]), [[0, 1]]);
  assert.deepEqual(findPriceRuleOverlaps([itinerary("a", "fuji", 1), itinerary("b", "fuji", 2, { packageHours: null })]), []);
  assert.deepEqual(findPriceRuleOverlaps([rule("a", null, pkgPricing(1)), rule("b", null, pkgPricing(2), { validFrom: "2026-06-01" })]), [[0, 1]]);
  assert.deepEqual(findPriceRuleOverlaps([rule("a", null, pkgPricing(1)), rule("b", null, pkgPricing(2), { packageHours: 8 }), rule("c", null, pkgPricing(2), { vehicleGroupId: "eco4" })]), []);
  assert.deepEqual(findPriceRuleOverlaps([rule("a", null, pkgPricing(1)), rule("b", "tokyo", pkgPricing(2))]), [], "整商品套餐价和旧的按区域套餐价不是同一个组合");
});

test("③区域只认上下车加价规则；②区域单独列出、不参与上下车点匹配", () => {
  assert.deepEqual(surchargeAreaIds(MIGRATED_RULES), ["fuji", "kamakura"]);
  assert.deepEqual(itineraryAreaIds([...MIGRATED_RULES, itinerary("i-lake", "lake", 3_000), itinerary("i-off", "kamakura", 1, { status: "disabled" })]), ["fuji", "kamakura", "lake"]);
  const onlyLake = migrated({ priceRules: [rule("p-wide", null, pkgPricing(60_000)), itinerary("i-lake", "lake", 3_000)] });
  assert.equal(charterMatches(onlyLake, P.lake, P.shinjuku), false, "只在②里的上车点不匹配");
  assert.equal(priced(trip("lake", [], "shinjuku"), onlyLake), "OUT_OF_SERVICE_AREA", "不做运营判断时的原因码");
  assert.equal(priced(trip("shinjuku", ["lake"], "shinjuku"), onlyLake), 63_000, "经停在②里照收");
  assert.deepEqual(sellablePriceRules(MIGRATED_RULES, { areaIds: ["tokyo"], vehicleGroupIds: ["eco7"] }, "2026-10-01").map((entry) => entry.id), ["p-tokyo", "p-wide"], "整商品套餐价也是能卖的价");
});

// ---- 引擎按商品标志切换新旧表 ----

test("没迁移过的商品整套用旧表：多了②规则、整商品套餐价也不读，报价逐字段和只有旧行时一样", () => {
  const cases: QuoteRequest[] = [trip("shinjuku", [], "shinjuku"), trip("shinjuku", ["gogome"], "shinjuku"), trip("shinjuku", ["gogome"], "gogome"), trip("shinjuku", [], "tsurugaoka"), trip("gogome", ["tsurugaoka"], "gogome")];
  for (const request of cases) {
    const before = quoteProduct(product(), request, moment);
    const after = quoteProduct(product({ priceRules: MIGRATED_RULES }), request, moment);
    assert.deepEqual(after, before, JSON.stringify(request.waypoints));
  }
  assert.equal(priced(trip("shinjuku", ["gogome"], "shinjuku"), product({ priceRules: MIGRATED_RULES })), 65_000, "套餐 55,000 + ③行里的途经加价 10,000");
  // 新格式的行排在最前、而且是旧行没有的档（6h）：没迁移过的商品仍然不读——按 6h 报不出，自动选档也不把 6h 当候选
  const wideFirst = [rule("w-6", null, pkgPricing(30_000), { packageHours: 6 }), rule("w-10", null, pkgPricing(1_000)), itinerary("i-fuji", "fuji", 1), ...LEGACY_RULES];
  for (const request of cases) assert.deepEqual(quoteProduct(product({ priceRules: wideFirst }), request, moment), quoteProduct(product(), request, moment), JSON.stringify(request.waypoints));
  assert.equal(priced(trip("shinjuku", [], "shinjuku", { packageHours: 6 }), product({ priceRules: wideFirst })), "NO_PRICE_RULE");
  const auto = quoteProduct(product({ priceRules: wideFirst }), trip("shinjuku", [], "shinjuku", { packageHours: null, charterSelection: "auto", routeUsage: { meters: 50_000, minutes: 300 } }), moment);
  assert.ok(auto.ok);
  assert.deepEqual([auto.offers[0]?.packageHours, auto.offers[0]?.priceRuleId], [10, "p-tokyo"], "5 小时的行程：6h 的整商品套餐价不算候选，只有旧的 10h");
  // 行程比所有旧档都长（T = 11h40m）：客人手动选 10h（旧行里最长的那档）照常报；12h 的整商品套餐价不算「最长那一档」，否则会报 PACKAGE_TOO_SHORT
  const longer = [rule("w-12", null, pkgPricing(70_000), { packageHours: 12 }), ...wideFirst];
  const manual = quoteProduct(product({ priceRules: longer }), trip("shinjuku", [], "shinjuku", { charterSelection: "manual", routeUsage: { meters: 50_000, minutes: 700 } }), moment);
  assert.ok(manual.ok);
  assert.deepEqual([manual.offers[0]?.packageHours, manual.offers[0]?.priceRuleId, manual.refused], [10, "p-tokyo", []]);
  // 只有整商品套餐价、没迁移过：报不出（不会把它当成按区域的价）
  assert.equal(priced(trip("shinjuku", [], "shinjuku"), product({ priceRules: [rule("w-10", null, pkgPricing(60_000))] })), "NO_PRICE_RULE");
});

test("迁移过的商品：套餐价只用整商品套餐价（按区域的旧行不读）；经停只从②取（③行里的途经加价不读）", () => {
  assert.equal(priced(trip("shinjuku", [], "shinjuku"), migrated()), 60_000);
  assert.equal(priced(trip("shinjuku", ["gogome"], "shinjuku"), migrated()), 60_000 + 12_000, "东京往返富士山：套餐 + 富士山行程（②）");
  // 规格四个标准场景（金额按本测试的②：富士山行程 12,000）
  assert.equal(priced(trip("shinjuku", [], "gogome"), migrated()), 60_000 + 12_000 + 10_000, "东京上车 → 富士山下车：套餐 + 富士山行程（下车点）+ 富士山下车");
  assert.equal(priced(trip("gogome", ["lake"], "gogome"), migrated()), 60_000 + 12_000 + 10_000 + 10_000, "富士山上车 → 富士山游玩 → 富士山下车");
  const s = settlement(trip("shinjuku", ["gogome", "tsurugaoka"], "shinjuku"), migrated());
  assert.equal(s.totalMinor, 60_000 + 12_000 + 7_000);
  assert.deepEqual(s.areaSurcharge, {
    packageMinor: 60_000,
    pickup: { areaId: null, priceRuleId: null, amountMinor: 0 },
    dropoff: { areaId: null, priceRuleId: null, amountMinor: 0 },
    waypoints: [
      { areaId: "fuji", priceRuleId: "i-fuji", amountMinor: 12_000, stopSeqs: [1] },
      { areaId: "kamakura", priceRuleId: "i-kama", amountMinor: 7_000, stopSeqs: [2] },
    ],
  });
  const quote = quoteProduct(migrated(), trip("shinjuku", [], "shinjuku"), moment);
  assert.ok(quote.ok);
  assert.deepEqual([quote.offers[0]?.priceRuleId, quote.offers[0]?.areaId], ["p-wide", "tokyo"], "价格规则是整商品的那条；区域记基础价区域（调价按它匹配）");
});

test("迁移过的商品：经停只在③里（没有②）→ 不报（WAYPOINT_NOT_PRICED，指出第几个点）；下车点行程加价查②，不查③行里的途经加价", () => {
  const noKamaItinerary = migrated({ priceRules: MIGRATED_RULES.filter((entry) => entry.id !== "i-kama") });
  assert.equal(priced(trip("shinjuku", ["gogome", "tsurugaoka"], "shinjuku"), noKamaItinerary), "WAYPOINT_NOT_PRICED@2");
  assert.equal(priced(trip("shinjuku", [], "tsurugaoka"), noKamaItinerary), 60_000 + 6_000, "下车点不在任何②：跳过、照常报价（只收镰仓下车）");
  assert.equal(priced(trip("shinjuku", [], "tsurugaoka"), migrated()), 60_000 + 7_000 + 6_000, "下车点在②镰仓：收一次镰仓行程（②的 7,000，不是③行里的 6,000）");
  // ②只画小景区（河口湖），③按大范围（富士山）：下车点在河口湖收河口湖行程，在富士山其他地方不收
  const lakeOnly = migrated({ priceRules: [...LEGACY_RULES, rule("p-wide", null, pkgPricing(60_000)), itinerary("i-lake", "lake", 3_000)] });
  assert.equal(priced(trip("shinjuku", [], "lake"), lakeOnly), 60_000 + 3_000 + 10_000);
  assert.equal(priced(trip("shinjuku", [], "gogome"), lakeOnly), 60_000 + 10_000);
  assert.equal(priced(trip("shinjuku", ["gogome"], "shinjuku"), lakeOnly), "WAYPOINT_NOT_PRICED@1", "经停在富士山③里、不在任何②里");
});

test("迁移过的商品：加价的空套餐 = 所有套餐；同一区域先用套餐对得上的那条，停用了才用空套餐那条", () => {
  const rules = [rule("p-8", null, pkgPricing(45_000), { packageHours: 8 }), rule("p-10", null, pkgPricing(60_000)), updown("u-fuji", "fuji", 9_000, 9_000, undefined, { packageHours: null }), itinerary("i-fuji", "fuji", 11_000, { packageHours: null }), itinerary("i-fuji-10", "fuji", 15_000)];
  const item = migrated({ priceRules: rules });
  assert.equal(priced(trip("shinjuku", ["gogome"], "shinjuku", { packageHours: 8 }), item), 45_000 + 11_000, "8h 没有专门的行：用空套餐那条");
  assert.equal(priced(trip("shinjuku", ["gogome"], "shinjuku"), item), 60_000 + 15_000, "10h 有专门的行：用它");
  assert.equal(priced(trip("gogome", [], "shinjuku", { packageHours: 8 }), item), 45_000 + 9_000, "上下车加价同样认空套餐");
  const disabled = migrated({ priceRules: rules.map((entry) => (entry.id === "i-fuji-10" ? { ...entry, status: "disabled" as const } : entry)) });
  assert.equal(priced(trip("shinjuku", ["gogome"], "shinjuku"), disabled), 60_000 + 11_000);
  // 没迁移过的商品不认空套餐（旧表；这种行也建不出来）
  assert.equal(priced(trip("gogome", [], "shinjuku"), product({ priceRules: [rule("p-tokyo", "tokyo", pkgPricing(55_000)), updown("u-fuji", "fuji", 9_000, 9_000, undefined, { packageHours: null })] })), "NO_PRICE_RULE");
});

test("迁移过的商品：没有整商品套餐价 → 报不出（不回退到按区域的旧套餐价）；自动选档只看整商品套餐价的档", () => {
  const noWide = migrated({ priceRules: MIGRATED_RULES.filter((entry) => entry.id !== "p-wide") });
  assert.equal(priced(trip("shinjuku", [], "shinjuku"), noWide), "NO_PRICE_RULE");
  const rules = [rule("p-old-6", "tokyo", pkgPricing(30_000), { packageHours: 6 }), rule("w-8", null, pkgPricing(45_000), { packageHours: 8 }), rule("w-10", null, pkgPricing(60_000))];
  const auto = quoteProduct(migrated({ priceRules: rules }), trip("shinjuku", [], "shinjuku", { packageHours: null, charterSelection: "auto", routeUsage: { meters: 50_000, minutes: 300 } }), moment);
  assert.ok(auto.ok, JSON.stringify(auto));
  assert.deepEqual([auto.offers[0]?.packageHours, auto.offers[0]?.priceRuleId, auto.offers[0]?.settlement.totalMinor], [8, "w-8", 45_000], "5 小时的行程：按区域的 6h 旧行不算候选，选整商品的 8h");
});

test("「套餐价不一致」逐条明细：旧的按区域套餐价和整商品套餐价（同车型组、套餐、生效开始日）比，不一样或整商品没有的列出来", () => {
  const rules = [
    rule("old-tokyo", "tokyo", pkgPricing(60_000)),
    rule("old-yoko", "yokohama", pkgPricing(58_000)),
    rule("old-yoko-8", "yokohama", pkgPricing(45_000), { packageHours: 8 }),
    rule("wide", null, pkgPricing(60_000)),
    updown("u", "fuji", 1, 1),
  ];
  const terms = (packagePriceMinor: number) => ({ packagePriceMinor, packageKm: 300, overtimePerHourMinor: 5_000, overKmPerKmMinor: 400, validTo: null, status: "enabled" as const });
  assert.deepEqual(charterMigrationDiff(rules), [
    { oldRuleId: "old-yoko", areaId: "yokohama", vehicleGroupId: "eco7", packageHours: 10, validFrom: "2026-01-01", old: terms(58_000), productRuleId: "wide", product: terms(60_000) },
    { oldRuleId: "old-yoko-8", areaId: "yokohama", vehicleGroupId: "eco7", packageHours: 8, validFrom: "2026-01-01", old: terms(45_000), productRuleId: null, product: null },
  ]);
  assert.deepEqual(charterMigrationDiff([rule("old", "tokyo", pkgPricing(60_000)), rule("wide", null, pkgPricing(60_000), { status: "disabled" })]).map((entry) => entry.oldRuleId), ["old"], "状态不同也算不一致");
});

test("M9P-16：已下的单改期时传 lockedAreaSurcharge——加价用锁定的金额、不查现在的加价规则；套餐价、调价照常现算；没传的和以前一样", () => {
  const locked = { pickup: { areaId: null, priceRuleId: null, amountMinor: 0 }, dropoff: { areaId: "fuji", priceRuleId: "s-fuji", amountMinor: 10_000 }, waypoints: [] };
  const request = trip("shinjuku", ["gogome"], "gogome");
  assert.equal(priced(request, product()), 55_000 + 10_000 + 10_000, "现算：富士山行程 + 富士山下车");
  const quote = quoteProduct(product(), request, moment, { lockedAreaSurcharge: locked });
  assert.ok(quote.ok);
  const s = quote.offers[0]?.settlement;
  assert.deepEqual([s?.totalMinor, s?.areaSurcharge], [55_000 + 10_000, { packageMinor: 55_000, ...locked }], "锁定的是行程加价被下车抵消时的那份（0）");
  // 套餐价现算：改了套餐价，锁定的加价不变
  const cheaper = product({ priceRules: [rule("p-tokyo", "tokyo", pkgPricing(50_000)), ...LEGACY_RULES.slice(1)] });
  const again = quoteProduct(cheaper, request, moment, { lockedAreaSurcharge: locked });
  assert.ok(again.ok);
  assert.equal(again.offers[0]?.settlement.totalMinor, 50_000 + 10_000);
  // 加价规则都删了也照样按锁定的报（区域判断照常：富士山的③行还在，所以点还能匹配）
  const noWaypointRule = product({ priceRules: [rule("p-tokyo", "tokyo", pkgPricing(55_000)), updown("s-fuji", "fuji", 99_000, 99_000)] });
  const kept = quoteProduct(noWaypointRule, request, moment, { lockedAreaSurcharge: locked });
  assert.ok(kept.ok);
  assert.equal(kept.offers[0]?.settlement.totalMinor, 65_000);
});

test("M9P-16：加价锁定的改期照常做区域判断——经停所在的区域后来被删了（不在任何区域里）→ 报不出（WAYPOINT_NOT_PRICED），不按锁定的金额报", () => {
  const locked = { pickup: { areaId: null, priceRuleId: null, amountMinor: 0 }, dropoff: { areaId: null, priceRuleId: null, amountMinor: 0 }, waypoints: [{ areaId: "fuji", priceRuleId: "s-fuji", amountMinor: 10_000, stopSeqs: [1] }] };
  const request = trip("shinjuku", ["gogome"], "shinjuku");
  assert.equal(quoteProduct(product(), request, moment, { lockedAreaSurcharge: locked }).ok, true);
  const fujiGone = product({ surchargeAreas: [KAMAKURA, LAKE], priceRules: LEGACY_RULES.filter((entry) => entry.areaId !== "fuji") });
  assert.equal(priced(request, fujiGone), "WAYPOINT_NOT_PRICED@1", "现算：报不出");
  const quote = quoteProduct(fujiGone, request, moment, { lockedAreaSurcharge: locked });
  assert.ok(quote.ok);
  assert.deepEqual(quote.refused, [{ vehicleGroupId: "eco7", reason: "WAYPOINT_NOT_PRICED", stopSeq: 1 }], "锁定的改期同样报不出");
});

test("M9P-16：lockableAreaSurcharge——行程（上车、下车、经停点的坐标和顺序）和套餐时长都和下单时一样才锁；有一样变了、不是包车、没有加价明细都不锁（现算）", () => {
  const breakdown = { packageMinor: 55_000, pickup: { areaId: null, priceRuleId: null, amountMinor: 0 }, dropoff: { areaId: "fuji", priceRuleId: "s-fuji", amountMinor: 10_000 }, waypoints: [] };
  const booked = { request: trip("shinjuku", ["gogome"], "gogome"), packageHours: 10, areaSurcharge: breakdown };
  const { packageMinor: _package, ...surcharge } = breakdown;
  assert.deepEqual(lockableAreaSurcharge(booked, trip("shinjuku", ["gogome"], "gogome"), 10), surcharge);
  assert.equal(lockableAreaSurcharge(booked, trip("lake", ["gogome"], "gogome"), 10), undefined, "上车点变了");
  assert.equal(lockableAreaSurcharge(booked, trip("shinjuku", ["gogome"], "lake"), 10), undefined, "下车点变了");
  assert.equal(lockableAreaSurcharge(booked, trip("shinjuku", ["gogome", "tsurugaoka"], "gogome"), 10), undefined, "经停点变了");
  assert.equal(lockableAreaSurcharge(booked, trip("shinjuku", ["tsurugaoka"], "gogome"), 10), undefined, "经停点换了");
  assert.equal(lockableAreaSurcharge(booked, trip("shinjuku", ["gogome"], "gogome"), 8), undefined, "套餐时长变了");
  assert.equal(lockableAreaSurcharge({ ...booked, areaSurcharge: undefined }, trip("shinjuku", ["gogome"], "gogome"), 10), undefined, "M8-15 之前的单没有加价明细");
  assert.equal(lockableAreaSurcharge(booked, { ...trip("shinjuku", ["gogome"], "gogome"), category: "point_to_point" }, 10), undefined, "不是包车");
});

