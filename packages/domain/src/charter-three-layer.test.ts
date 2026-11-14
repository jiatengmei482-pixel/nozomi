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
import { type PriceRule, findPriceRuleOverlaps, itineraryAreaIds, priceRuleIssues, sellablePriceRules, surchargeAreaIds, surchargeModelsFor } from "./pricing.ts";
import { emptyServiceRules } from "./products.ts";
import { type QuoteArea, type QuoteMoment, type QuoteProduct, type QuoteRequest, quoteProduct } from "./quote.ts";

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
