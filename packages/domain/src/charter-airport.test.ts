/**
 * M9P-21（ADR 0098）：包车机场开始 / 机场结束套餐。
 * 例子按需求文档 P1 和 ADR 0098 第六节：东京市内①（含羽田），成田③上 / 下车加价 14,000、成田②行程加价 14,000；5h 33,000、6h 38,000。
 * 机场区域只画航站楼周边（成田机场区域在成田③里面，羽田机场区域在东京①里面）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Position } from "./areas.ts";
import type { LatLng } from "./geo.ts";
import { type AirportBinding, airportPackagePricing, airportScenarios, charterScenarioLabel } from "./charter-airport.ts";
import { type PriceRule, findPriceRuleOverlaps, isAirportPackageModel, isNonBaseRule, isSurchargeRule, priceRuleIssues } from "./pricing.ts";
import { emptyServiceRules } from "./products.ts";
import { type QuoteArea, type QuoteMoment, type QuoteProduct, type QuoteRequest, lockableAreaSurcharge, quoteProduct } from "./quote.ts";

const square = (west: number, south: number, east: number, north: number): Position[] => [[west, south], [east, south], [east, north], [west, north], [west, south]];
const area = (areaId: string, ring: Position[]): QuoteArea => ({ areaId, active: true, shapes: [{ id: `${areaId}-op`, kind: "operate", ring }] });

const TOKYO = area("tokyo", square(139.55, 35.5, 139.95, 35.85));
const NARITA = area("narita", square(140.2, 35.65, 140.5, 35.9));
/** 机场区域：只画航站楼周边 */
const NARITA_AIRPORT = area("narita-airport", square(140.37, 35.75, 140.4, 35.79));
const HANEDA_AIRPORT = area("haneda-airport", square(139.77, 35.54, 139.8, 35.56));
const P = {
  shinjuku: { lng: 139.7, lat: 35.69 },
  haneda: { lng: 139.785, lat: 35.55 },
  naritaT1: { lng: 140.385, lat: 35.77 },
  naritaHotel: { lng: 140.3, lat: 35.8 },
} satisfies Record<string, LatLng>;
type Place = keyof typeof P;

type Rule = PriceRule & { id: string };
const rule = (id: string, areaId: string | null, pricing: PriceRule["pricing"], extra: Partial<PriceRule> = {}): Rule => ({ id, areaId, vehicleGroupId: "eco7", direction: null, packageHours: 5, pricing, validFrom: "2026-01-01", validTo: null, status: "enabled", ...extra });
const pkg = (id: string, hours: number, price: number): Rule => rule(id, null, { model: "charter_package", packageKm: 300, packagePriceMinor: price, overtimePerHourMinor: 5_000, overKmPerKmMinor: 500 }, { packageHours: hours });
const airportPrice = (id: string, direction: "pickup" | "dropoff", hours: number, price: number, extra: Partial<PriceRule> = {}): Rule =>
  rule(id, "narita-airport", { model: "charter_airport_package", packagePriceMinor: price }, { direction, packageHours: hours, ...extra });

const BASE_RULES: Rule[] = [
  pkg("p5", 5, 33_000),
  pkg("p6", 6, 38_000),
  rule("u-narita", "narita", { model: "charter_area_surcharge", pickupSurchargeMinor: 14_000, dropoffSurchargeMinor: 14_000 }, { packageHours: null }),
  rule("i-narita", "narita", { model: "charter_itinerary_surcharge", surchargeMinor: 14_000 }, { packageHours: null }),
];
const binding = (scenario: AirportBinding["scenario"], placeId: string, airportArea: QuoteArea, name: string): AirportBinding => ({ scenario, placeId, area: airportArea, name });
const BINDINGS: AirportBinding[] = [
  binding("airport_start", "nrt", NARITA_AIRPORT, "成田机场"),
  binding("airport_end", "nrt", NARITA_AIRPORT, "成田机场"),
  binding("airport_start", "hnd", HANEDA_AIRPORT, "羽田机场"),
  binding("airport_end", "hnd", HANEDA_AIRPORT, "羽田机场"),
];

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
  surchargeAreas: [NARITA],
  charterLayout: "three_layer",
  airportBindings: BINDINGS,
  vehicleGroups: [{ vehicleGroupId: "eco7", passengers: 6, luggage: 4, active: true }],
  serviceRules: { ...emptyServiceRules(), booking: { saleFrom: null, saleTo: null, serviceTime: { start: "00:00", end: "24:00" }, leadTimeHours: 24, note: null }, freeWait: { pickup: null, dropoff: null, general: { mode: "limited", minutes: 0 } } },
  addonCatalog: [],
  priceRules: BASE_RULES,
  adjustRules: [],
  inventoryMode: "unlimited",
  ...extra,
});
const withRules = (...rules: Rule[]): QuoteProduct => product({ priceRules: [...BASE_RULES, ...rules] });
const trip = (pickup: Place, dropoff: Place, extra: Partial<QuoteRequest> = {}): QuoteRequest => ({
  category: "charter",
  pickup: P[pickup],
  dropoff: P[dropoff],
  direction: null,
  packageHours: 5,
  serviceLocal: "2026-10-20T10:00",
  passengers: 2,
  luggage: 1,
  addons: [],
  driverLanguage: null,
  vehicleGroupIds: [],
  ...extra,
});
const moment: QuoteMoment = { now: new Date("2026-10-07T01:00:00Z"), route: null, inventoryDay: null, urgentUsed: 0 };

function offer(request: QuoteRequest, item: QuoteProduct) {
  const quote = quoteProduct(item, request, moment);
  assert.ok(quote.ok && quote.offers.length === 1, JSON.stringify(quote));
  return quote.offers[0] as (typeof quote.offers)[number];
}

test("场景只看上 / 下车点在不在机场区域：机场开始排在前面；停用的机场区域不算", () => {
  assert.deepEqual(
    airportScenarios(BINDINGS, P.naritaT1, P.haneda).map((entry) => [entry.kind, entry.placeId]),
    [
      ["airport_start", "nrt"],
      ["airport_end", "hnd"],
    ],
  );
  assert.deepEqual(airportScenarios(BINDINGS, P.naritaHotel, P.shinjuku), [], "成田③里、机场区域外的酒店不是机场");
  assert.deepEqual(airportScenarios([binding("airport_start", "nrt", { ...NARITA_AIRPORT, active: false }, "成田机场")], P.naritaT1, P.shinjuku), []);
  assert.equal(charterScenarioLabel("airport_start", "成田机场", 5), "成田机场接机 + 5 小时包车");
  assert.equal(charterScenarioLabel("airport_end", "羽田机场", 5), "5 小时包车 + 羽田机场送机");
});

test("没有机场绑定的商品、没迁移三层区域的商品：报价和以前逐字一样", () => {
  const plain = offer(trip("naritaT1", "shinjuku"), product({ airportBindings: [] }));
  assert.equal(plain.settlement.totalMinor, 47_000);
  assert.equal(plain.settlement.charterScenario, undefined);
  const { airportBindings: _bindings, ...noBindings } = product();
  assert.deepEqual(offer(trip("naritaT1", "shinjuku"), noBindings), plain);
  // 没迁移三层区域的商品（旧表：按服务区域的套餐价）：绑定不生效
  const { charterLayout: _layout, ...legacyProduct } = product();
  const legacy = offer(trip("naritaT1", "shinjuku"), { ...legacyProduct, priceRules: [rule("p5-tokyo", "tokyo", { model: "charter_package", packageKm: 300, packagePriceMinor: 33_000, overtimePerHourMinor: 5_000, overKmPerKmMinor: 500 }), { ...(BASE_RULES[2] as Rule), packageHours: 5 }] });
  assert.equal(legacy.settlement.totalMinor, 47_000);
  assert.equal(legacy.settlement.charterScenario, undefined);
  // 机场套餐价那一行在没有场景时不被当成套餐价
  assert.deepEqual(offer(trip("naritaHotel", "shinjuku"), withRules(airportPrice("a5", "pickup", 5, 45_000))).settlement.totalMinor, 47_000);
});

test("P1 成田上车、机场开始、继承：33,000 + 上车加价 14,000 = 47,000，套餐行是「成田机场接机 + 5 小时包车」", () => {
  const result = offer(trip("naritaT1", "shinjuku"), product());
  assert.equal(result.settlement.totalMinor, 47_000);
  assert.deepEqual(result.settlement.charterScenario, { kind: "airport_start", placeId: "nrt", areaId: "narita-airport", name: "成田机场", pricing: "inherit", priceRuleId: null });
  assert.equal(result.settlement.areaSurcharge?.pickup.amountMinor, 14_000);
  assert.equal(result.priceRuleId, "p5");
});

test("P1 成田上车、单独填价 45,000：报 45,000，成田不再加 14,000（这一端记 0、含在套餐里）", () => {
  const result = offer(trip("naritaT1", "shinjuku"), withRules(airportPrice("a5", "pickup", 5, 45_000)));
  assert.equal(result.settlement.totalMinor, 45_000);
  assert.equal(result.priceRuleId, "a5");
  assert.equal(result.settlement.charterScenario?.pricing, "own");
  assert.deepEqual(result.settlement.areaSurcharge?.pickup, { areaId: "narita-airport", priceRuleId: null, amountMinor: 0, includedInPackage: true });
  assert.equal(result.settlement.areaSurcharge?.packageMinor, 45_000);
});

test("P1 新宿上车、羽田下车 → 机场结束（羽田在①里，继承 = 普通价）；上下车都不在机场 → 只有普通套餐", () => {
  const haneda = offer(trip("shinjuku", "haneda"), product());
  assert.equal(haneda.settlement.totalMinor, 33_000);
  assert.equal(haneda.settlement.charterScenario?.kind, "airport_end");
  assert.equal(haneda.settlement.charterScenario?.name, "羽田机场");
  const plain = offer(trip("shinjuku", "shinjuku"), product());
  assert.equal(plain.settlement.totalMinor, 33_000);
  assert.equal(plain.settlement.charterScenario, undefined);
});

test("成田下车（机场结束）：继承 = 33,000 + 下车加价 14,000 = 47,000，下车点行程加价不收（Q13，业主 2026-11-17：套餐价已含去机场的路程）；单独 45,000 两项都免", () => {
  const inherit = offer(trip("shinjuku", "naritaT1"), product());
  assert.equal(inherit.settlement.totalMinor, 47_000);
  assert.deepEqual(inherit.settlement.areaSurcharge?.waypoints, [{ areaId: "narita", priceRuleId: "i-narita", amountMinor: 0, stopSeqs: [], fromDropoff: true, includedInPackage: true }]);
  const own = offer(trip("shinjuku", "naritaT1"), withRules(airportPrice("e5", "dropoff", 5, 45_000)));
  assert.equal(own.settlement.totalMinor, 45_000);
  assert.deepEqual(own.settlement.areaSurcharge?.dropoff, { areaId: "narita-airport", priceRuleId: null, amountMinor: 0, includedInPackage: true });
  assert.deepEqual(own.settlement.areaSurcharge?.waypoints, [{ areaId: "narita", priceRuleId: "i-narita", amountMinor: 0, stopSeqs: [], fromDropoff: true, includedInPackage: true }]);
});

test("机场开始单独定价只免上车那一端：成田上车 → 成田下车，下车加价和下车点行程加价照收", () => {
  // 机场 → 机场（同一个机场）：机场开始单独 30,000 + 下车 14,000 + 下车点行程 14,000 = 58,000；机场结束继承 = 33,000 + 上车 14,000 + 下车 14,000（行程不收）= 61,000 → 取 58,000
  const result = offer(trip("naritaT1", "naritaT1"), withRules(airportPrice("a5", "pickup", 5, 30_000)));
  assert.equal(result.settlement.totalMinor, 58_000);
  assert.equal(result.settlement.charterScenario?.kind, "airport_start");
});

test("机场 → 机场：两个场景各报一遍取结算价低的，一样时取机场开始", () => {
  // 成田上车、羽田下车：机场开始继承 47,000，机场结束继承（羽田①）= 33,000 + 成田上车 14,000 = 47,000 → 一样，取机场开始
  const same = offer(trip("naritaT1", "haneda"), product());
  assert.equal(same.settlement.totalMinor, 47_000);
  assert.equal(same.settlement.charterScenario?.kind, "airport_start");
  // 机场开始单独 50,000 > 机场结束 47,000 → 取机场结束
  const cheaperEnd = offer(trip("naritaT1", "haneda"), withRules(airportPrice("a5", "pickup", 5, 50_000)));
  assert.equal(cheaperEnd.settlement.totalMinor, 47_000);
  assert.equal(cheaperEnd.settlement.charterScenario?.kind, "airport_end");
});

test("选档（ADR 0098 第三节第 4 小节第 3 步）：继承的档要加这一端机场加价再比——5h 单独 45,000 对 6h 继承 38,000 + 14,000，选 5h", () => {
  const request = trip("naritaT1", "shinjuku", { packageHours: null, charterSelection: "auto", routeUsage: { meters: 80_000, minutes: 270 } });
  const result = offer(request, withRules(airportPrice("a5", "pickup", 5, 45_000)));
  assert.equal(result.packageHours, 5);
  assert.equal(result.settlement.totalMinor, 45_000);
  // T 超过 5h 时只剩 6h 继承
  const longer = offer({ ...request, routeUsage: { meters: 80_000, minutes: 320 } }, withRules(airportPrice("a5", "pickup", 5, 45_000)));
  assert.equal(longer.packageHours, 6);
  assert.equal(longer.settlement.totalMinor, 52_000);
});

test("只填了机场套餐价的档也能选；补不齐含公里 / 单价时这一档报不出", () => {
  const full = rule("a8", "narita-airport", { model: "charter_airport_package", packagePriceMinor: 70_000, packageKm: 400, overKmPerKmMinor: 500, overtimePerHourMinor: 6_000 }, { direction: "pickup", packageHours: 8 });
  assert.equal(offer(trip("naritaT1", "shinjuku", { packageHours: 8 }), withRules(full)).settlement.totalMinor, 70_000);
  const partial = airportPrice("a7", "pickup", 7, 60_000, { packageHours: 7 });
  const quote = quoteProduct(withRules(partial), trip("naritaT1", "shinjuku", { packageHours: 7 }), moment);
  assert.ok(quote.ok);
  assert.deepEqual(quote.refused, [{ vehicleGroupId: "eco7", reason: "NO_PRICE_RULE" }]);
  assert.deepEqual(airportPackagePricing([...BASE_RULES], airportPrice("a5", "pickup", 5, 45_000), "2026-10-20"), { model: "charter_package", packageKm: 300, packagePriceMinor: 45_000, overKmPerKmMinor: 500, overtimePerHourMinor: 5_000 });
});

test("机场套餐价的价格规则：方向必填（pickup / dropoff）、套餐必填、只有迁移过三层区域的包车能用；不是加价也不是基础定价", () => {
  const layered = { category: "charter" as const, charterLayout: "three_layer" as const };
  assert.deepEqual(priceRuleIssues(airportPrice("a", "pickup", 5, 45_000), layered), []);
  assert.deepEqual(priceRuleIssues(airportPrice("a", "pickup", 5, 45_000, { direction: null }), layered), [{ path: "/direction", reason: "REQUIRED" }]);
  assert.deepEqual(priceRuleIssues(airportPrice("a", "pickup", 5, 45_000, { direction: "both" }), layered), [{ path: "/direction", reason: "OUT_OF_RANGE" }]);
  assert.deepEqual(priceRuleIssues(airportPrice("a", "pickup", 5, 45_000, { packageHours: null }), layered), [{ path: "/package_hours", reason: "REQUIRED" }]);
  assert.deepEqual(priceRuleIssues(airportPrice("a", "pickup", 5, 0), layered), [{ path: "/package_price", reason: "OUT_OF_RANGE", detail: { min: 1, max: 1_000_000_000 } }]);
  assert.deepEqual(priceRuleIssues(airportPrice("a", "pickup", 5, 45_000), { category: "charter" }), [{ path: "/pricing_model", reason: "MODEL_NOT_ALLOWED" }]);
  const sample = airportPrice("a", "pickup", 5, 45_000);
  assert.equal(isAirportPackageModel(sample.pricing.model), true);
  assert.equal(isSurchargeRule(sample), false);
  assert.equal(isNonBaseRule(sample), true);
  assert.deepEqual(findPriceRuleOverlaps([sample, airportPrice("b", "dropoff", 5, 45_000), airportPrice("c", "pickup", 6, 50_000)]), [], "方向、套餐不同不冲突");
  assert.deepEqual(findPriceRuleOverlaps([sample, airportPrice("d", "pickup", 5, 46_000, { validFrom: "2026-06-01" })]), [[0, 1]]);
});

/** 改期时服务层（order-changes）的真实调用：锁下单时的加价（`lockableAreaSurcharge`），同时锁场景（没有场景锁成 null） */
function reschedule(booked: QuoteProduct, now: QuoteProduct, request: QuoteRequest) {
  const settlement = offer(request, booked).settlement;
  const lockedAreaSurcharge = lockableAreaSurcharge({ request, packageHours: request.packageHours, areaSurcharge: settlement.areaSurcharge }, request, request.packageHours);
  assert.ok(lockedAreaSurcharge !== undefined);
  return quoteProduct(now, request, moment, { lockedAreaSurcharge, lockedCharterScenario: settlement.charterScenario ?? null });
}
const totalOf = (quote: ReturnType<typeof quoteProduct>): number | string => (quote.ok ? (quote.offers[0]?.settlement.totalMinor ?? quote.refused[0]?.reason ?? "NONE") : quote.reason);

test("改期锁定下单时的场景（带真实的 lockedAreaSurcharge）：单独定价的单找不到机场套餐价就报不出；继承的单不改用后来设的机场套餐价", () => {
  const request = trip("naritaT1", "shinjuku");
  const own = withRules(airportPrice("a5", "pickup", 5, 45_000));
  assert.equal(totalOf(reschedule(own, withRules(airportPrice("a5", "pickup", 5, 46_000)), request)), 46_000, "机场套餐价现算，上车加价锁定为 0");
  assert.equal(totalOf(reschedule(own, product(), request)), "NO_PRICE_RULE", "删了机场套餐价：不退回普通价");
  const later = reschedule(product(), withRules(airportPrice("a5", "pickup", 5, 45_000)), request);
  assert.equal(totalOf(later), 47_000);
  assert.ok(later.ok && later.offers[0]?.settlement.charterScenario?.pricing === "inherit");
});

test("#261 必改 1：下单时没有场景的单（后来才绑定机场、设单独价 45,000）改期仍是 47,000，不是 45,000 + 锁定的 14,000 = 59,000", () => {
  const request = trip("naritaT1", "shinjuku");
  const booked = product({ airportBindings: [] });
  assert.equal(offer(request, booked).settlement.charterScenario, undefined);
  const result = reschedule(booked, withRules(airportPrice("a5", "pickup", 5, 45_000)), request);
  assert.equal(totalOf(result), 47_000);
  assert.ok(result.ok && result.offers[0]?.settlement.charterScenario === undefined, "锁成没有场景");
  // 对照：不锁场景（旧写法）会多收
  const settlement = offer(request, booked).settlement;
  const lockedAreaSurcharge = lockableAreaSurcharge({ request, packageHours: 5, areaSurcharge: settlement.areaSurcharge }, request, 5);
  assert.ok(lockedAreaSurcharge !== undefined);
  assert.equal(totalOf(quoteProduct(withRules(airportPrice("a5", "pickup", 5, 45_000)), request, moment, { lockedAreaSurcharge })), 59_000);
});

test("规则 A：机场区域画进成田外围、和千叶超远③重叠（重叠处按机场 14,000）：继承收 14,000；单独定价整端免，不退回收 12,000", () => {
  const CHIBA_FAR = area("chiba-far", square(140.38, 35.7, 140.6, 35.78));
  const point = { lng: 140.39, lat: 35.76 };
  const rules: Rule[] = [...BASE_RULES, rule("u-chiba", "chiba-far", { model: "charter_area_surcharge", pickupSurchargeMinor: 12_000, dropoffSurchargeMinor: 12_000 }, { packageHours: null })];
  const item = (extra: Rule[]): QuoteProduct => product({ surchargeAreas: [NARITA, CHIBA_FAR], priceRules: [...rules, ...extra] });
  const request = { ...trip("naritaT1", "shinjuku"), pickup: point };
  const inherit = offer(request, item([]));
  assert.equal(inherit.settlement.totalMinor, 47_000);
  assert.deepEqual([inherit.settlement.areaSurcharge?.pickup.areaId, inherit.settlement.areaSurcharge?.pickup.amountMinor], ["narita", 14_000]);
  const own = offer(request, item([airportPrice("a5", "pickup", 5, 45_000)]));
  assert.equal(own.settlement.totalMinor, 45_000);
  assert.deepEqual(own.settlement.areaSurcharge?.pickup, { areaId: "narita-airport", priceRuleId: null, amountMinor: 0, includedInPackage: true });
});
