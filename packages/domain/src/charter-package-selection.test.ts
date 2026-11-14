/**
 * M9P-03：包车各商品在引擎里自己选套餐（ADR 0093 第四节；规格 docs/requirements/charter-pricing-spec-2026-11-14.md 步骤 2、3、5，差异表第 5、6、9 条）
 * 和下单不收超时费（ADR 0091 第三节）。
 *
 * 数据按规格第六节：东京包车、经济 7 座；①东京市内（含羽田）；富士山、箱根 10,000，镰仓 8,000（结算价）；套餐 4h 28,000、5h 33,000、10h 55,000；
 * 超公里 500 / 公里，4h 含 120 公里（用例 10：「4h 方案 28,000 + 12km × 500 = 34,000」）、5h 含 150 公里、10h 含 300 公里；前台价 = 结算价 × 1.1。
 * 预计用时、公里数按各用例的行程给（`routeUsage`），全程公里不超套餐含公里（用例 10 除外）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Position } from "./areas.ts";
import type { LatLng } from "./geo.ts";
import type { PriceRule } from "./pricing.ts";
import { type CharterItineraryRules, DEFAULT_CHARTER_ITINERARY, charterItineraryOf, emptyServiceRules, minPackageAboveAll, normalizeServiceRules, publishCheck, serviceRuleIssues } from "./products.ts";
import {
  type ProductQuote,
  type QuoteArea,
  type QuoteMoment,
  type QuoteProduct,
  type QuoteRequest,
  type RouteUsage,
  type SettlementBreakdown,
  compareQuotes,
  itineraryEstimate,
  quoteProduct,
  quoteRequestIssues,
  sellBreakdown,
  withOrderEstimate,
} from "./quote.ts";

const square = (west: number, south: number, east: number, north: number): Position[] => [[west, south], [east, south], [east, north], [west, north], [west, south]];
const area = (areaId: string, ring: Position[]): QuoteArea => ({ areaId, active: true, shapes: [{ id: `${areaId}-op`, kind: "operate", ring }] });

const TOKYO = area("tokyo", square(139.55, 35.52, 139.95, 35.85));
const FUJI = area("fuji", square(138.6, 35.4, 138.95, 35.6));
const HAKONE = area("hakone", square(138.95, 35.15, 139.15, 35.3));
const KAMAKURA = area("kamakura", square(139.5, 35.28, 139.6, 35.35));

const P = {
  shinjuku: { lng: 139.7, lat: 35.69 },
  asakusa: { lng: 139.7967, lat: 35.7148 },
  hanedaT3: { lng: 139.7798, lat: 35.5494 },
  kawaguchiko: { lng: 138.75, lat: 35.516 },
  kawaguchikoStation: { lng: 138.7689, lat: 35.4983 },
  tsurugaoka: { lng: 139.5565, lat: 35.3259 },
  hasedera: { lng: 139.5337, lat: 35.3125 },
  kamakuraStation: { lng: 139.5503, lat: 35.319 },
} satisfies Record<string, LatLng>;
type Place = keyof typeof P;

const PACKAGES: Record<number, { price: number; km: number }> = { 4: { price: 28_000, km: 120 }, 5: { price: 33_000, km: 150 }, 10: { price: 55_000, km: 300 } };
const SURCHARGE = { fuji: 10_000, hakone: 10_000, kamakura: 8_000 } as const;
const rule = (id: string, areaId: string, packageHours: number, pricing: PriceRule["pricing"]): PriceRule & { id: string } => ({ id, areaId, vehicleGroupId: "eco7", direction: null, packageHours, pricing, validFrom: "2026-01-01", validTo: null, status: "enabled" });
const packageRule = (hours: number, price: number, km: number, id = `p-${hours}`): PriceRule & { id: string } => rule(id, "tokyo", hours, { model: "charter_package", packageKm: km, packagePriceMinor: price, overtimePerHourMinor: 5_000, overKmPerKmMinor: 500 });
const surchargeRules = (hours: number): (PriceRule & { id: string })[] =>
  Object.entries(SURCHARGE).map(([areaId, amount]) => rule(`s-${areaId}-${hours}`, areaId, hours, { model: "charter_area_surcharge", pickupSurchargeMinor: amount, dropoffSurchargeMinor: amount, waypointSurchargeMinor: amount }));
const RULES = Object.entries(PACKAGES).flatMap(([hours, entry]) => [packageRule(Number(hours), entry.price, entry.km), ...surchargeRules(Number(hours))]);

const product = (charterItinerary?: Partial<CharterItineraryRules>, extra: Partial<QuoteProduct> = {}): QuoteProduct => ({
  productId: "tokyo-charter",
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
  surchargeAreas: [FUJI, HAKONE, KAMAKURA],
  vehicleGroups: [{ vehicleGroupId: "eco7", passengers: 6, luggage: 4, active: true }],
  serviceRules: {
    ...emptyServiceRules(),
    booking: { saleFrom: null, saleTo: null, serviceTime: { start: "00:00", end: "24:00" }, leadTimeHours: 24, note: null },
    freeWait: { pickup: null, dropoff: null, general: { mode: "limited", minutes: 0 } },
    ...(charterItinerary === undefined ? {} : { charterItinerary }),
  },
  addonCatalog: [],
  priceRules: RULES,
  adjustRules: [],
  inventoryMode: "unlimited",
  ...extra,
});

/** 行程：上车 → 经停 → 下车；`minutes` 是行驶 + 停留，`km` 是全程公里 */
const usage = (minutes: number, km: number): RouteUsage => ({ meters: km * 1_000, minutes });
const trip = (pickup: Place, waypoints: Place[], dropoff: Place, route: RouteUsage | undefined, selection: QuoteRequest["charterSelection"], packageHours: number | null = null): QuoteRequest => ({
  category: "charter",
  pickup: P[pickup],
  dropoff: P[dropoff],
  direction: null,
  packageHours,
  serviceLocal: "2026-12-01T09:00",
  passengers: 2,
  luggage: 1,
  addons: [],
  driverLanguage: null,
  vehicleGroupIds: [],
  ...(waypoints.length === 0 ? {} : { waypoints: waypoints.map((place) => P[place]) }),
  ...(route === undefined ? {} : { routeUsage: route }),
  ...(selection === undefined ? {} : { charterSelection: selection }),
});
const moment: QuoteMoment = { now: new Date("2026-11-14T01:00:00Z"), route: null, inventoryDay: null, urgentUsed: 0 };
const standing = { scoreCenti: null, completedOrders: 0, observation: false };

function only(quote: ProductQuote) {
  assert.ok(quote.ok && quote.offers.length === 1, JSON.stringify(quote));
  return quote.offers[0] as (typeof quote.offers)[number];
}

/** 套餐、结算价、前台价（加价 10%）、对外价明细 */
function quoted(request: QuoteRequest, item: QuoteProduct = product()) {
  const quote = quoteProduct(item, request, moment);
  const offer = only(quote);
  assert.deepEqual(quoteRequestIssues(request), []);
  const winner = compareQuotes({ request, currency: "JPY", now: moment.now, entries: [{ quote, productVersion: 1, standing, markupBp: () => 1_000, fx: null }] }).groups[0]?.snapshot.winner;
  assert.ok(winner !== undefined);
  return { hours: offer.packageHours, settlement: offer.settlement.totalMinor, sell: winner.sell.sellMinor, offer, breakdown: sellBreakdown(winner.offer.settlement, winner.sell) };
}

// 规格第六节：用例编号、行程、预计用时（行驶 + 停留，分钟）、全程公里 → 自动选的套餐、结算价、前台价
const CASES: [number, string, Place, Place[], Place, number, number, number, number, number][] = [
  [1, "新宿 → 浅草 → 新宿", "shinjuku", ["asakusa"], "shinjuku", 150, 40, 4, 28_000, 30_800],
  [7, "新宿 → 鹤冈八幡宫 → 长谷寺 → 新宿（镰仓两个经停只收一次）", "shinjuku", ["tsurugaoka", "hasedera"], "shinjuku", 270, 120, 5, 41_000, 45_100],
  [8, "镰仓站上车 → 浅草 → 新宿下车", "kamakuraStation", ["asakusa"], "shinjuku", 260, 110, 5, 41_000, 45_100],
  [9, "羽田 T3 上车 → 浅草 → 新宿（羽田属于基础价区域）", "hanedaT3", ["asakusa"], "shinjuku", 250, 50, 5, 33_000, 36_300],
  [10, "新宿 → 镰仓 → 新宿，预计 3h25m、132km（4h 28,000 + 12km × 500 = 34,000 > 5h 33,000）", "shinjuku", ["tsurugaoka"], "shinjuku", 205, 132, 5, 41_000, 45_100],
  // 下车点行程加价用例按自动选档的套餐（10h 以外的档按同一公式）
  [16, "新宿 → 河口湖站下车（不填经停点）", "shinjuku", [], "kawaguchikoStation", 110, 100, 4, 48_000, 52_800],
  [17, "新宿 → 浅草 → 河口湖站下车（浅草在基础价区域，不算市外经停）", "shinjuku", ["asakusa"], "kawaguchikoStation", 200, 110, 4, 48_000, 52_800],
  [18, "河口湖上车 → 新宿下车（不填经停点，不收行程加价）", "kawaguchiko", [], "shinjuku", 110, 100, 4, 38_000, 41_800],
];

for (const [no, name, pickup, waypoints, dropoff, minutes, km, hours, settlement, sell] of CASES) {
  test(`规格第六节用例 ${no}：${name}——自动选 ${hours}h，结算 ${settlement}、前台 ${sell}；不收超时费`, () => {
    const result = quoted(trip(pickup, waypoints, dropoff, usage(minutes, km), "auto"));
    assert.deepEqual([result.hours, result.settlement, result.sell], [hours, settlement, sell]);
    assert.equal(result.offer.settlement.itinerary?.overtimeMinor, 0);
    assert.equal(result.offer.settlement.itinerary?.overtimeAtBooking, false);
    assert.equal(result.breakdown.reduce((sum, item) => sum + item.amountMinor, 0), sell);
    assert.equal(result.breakdown.some((item) => item.kind === "overtime"), false, "对外明细没有超时费一项");
  });
}

test("用例 10（差异表第 6 条）：含超公里取总价最低——4h 能覆盖 T 但超 12 公里（34,000），5h 33,000 更便宜，选 5h；客人仍可手动选 4h（不短于 T），按 4h 加超公里报", () => {
  const auto = quoted(trip("shinjuku", ["tsurugaoka"], "shinjuku", usage(205, 132), "auto"));
  assert.equal(auto.hours, 5);
  assert.deepEqual(auto.offer.settlement.itinerary && [auto.offer.settlement.itinerary.overMeters, auto.offer.settlement.itinerary.overKmMinor], [0, 0]);
  const four = quoted(trip("shinjuku", ["tsurugaoka"], "shinjuku", usage(205, 132), "manual", 4));
  assert.equal(four.hours, 4);
  assert.equal(four.settlement, 28_000 + 12 * 500 + 8_000);
  assert.equal(four.offer.autoPackageHours, 5, "手动选档时另记自动会选的档");
  assert.equal(four.offer.settlement.itinerary?.overKmMinor, 6_000);
  // 只按时长取最短（旧做法）会选 4h：总价贵 1,000
  assert.equal(four.settlement - auto.settlement, 1_000);
});

test("需求二（差异表第 9 条）：每站默认占用 + 整单缓冲算进 T——短线路行驶 + 停留 3h20m，默认配置选 4h；占用 15 分 × 1 站 + 缓冲 60 分后 T = 4h35m，选 5h；明细记 T 的组成", () => {
  const plain = quoted(trip("shinjuku", ["asakusa"], "shinjuku", usage(200, 60), "auto"));
  assert.equal(plain.hours, 4);
  assert.equal(plain.offer.settlement.itinerary?.estimatedMinutes, undefined, "默认配置（0 / 0）时 T = 行驶 + 停留，明细不多记");
  const buffered = quoted(trip("shinjuku", ["asakusa"], "shinjuku", usage(200, 60), "auto"), product({ stopOccupancyMinutes: 15, bufferMinutes: 60 }));
  assert.equal(buffered.hours, 5);
  assert.equal(buffered.settlement, 33_000);
  const itinerary = buffered.offer.settlement.itinerary;
  assert.deepEqual(itinerary && [itinerary.routeMinutes, itinerary.stops, itinerary.stopOccupancyMinutes, itinerary.bufferMinutes, itinerary.estimatedMinutes], [200, 1, 15, 60, 275]);
  assert.equal(itinerary?.overtimeMinutes, 0, "超出的分钟按行驶 + 停留算（缓冲不是预计会发生的用时）");
  // 两站：占用按经停数算
  assert.equal(itineraryEstimate({ charterItinerary: { stopOccupancyMinutes: 15, bufferMinutes: 60 } }, { minutes: 200 }, 2).minutes, 200 + 30 + 60);
  assert.deepEqual(itineraryEstimate({}, { minutes: 200 }, 2), { minutes: 200, breakdown: null });
  // 下车点不算经停（ADR 0091 第一节）：不带经停点时 stops = 0
  const noStop = quoted(trip("shinjuku", [], "kawaguchikoStation", usage(110, 100), "auto"), product({ stopOccupancyMinutes: 15, bufferMinutes: 60 }));
  assert.deepEqual(noStop.offer.settlement.itinerary && [noStop.offer.settlement.itinerary.stops, noStop.offer.settlement.itinerary.estimatedMinutes, noStop.hours], [0, 170, 4]);
});

test("T 超过最大套餐：候选只有最大套餐（10h），不收超时费；超出的分钟照记（服务后参考）。同一行程不带 charterSelection（部署前的口径）照旧收超时费", () => {
  const long = trip("shinjuku", ["asakusa"], "shinjuku", usage(690, 250), "auto");
  const result = quoted(long);
  assert.deepEqual([result.hours, result.settlement], [10, 55_000]);
  const itinerary = result.offer.settlement.itinerary;
  assert.deepEqual(itinerary && [itinerary.packageMinutes, itinerary.overtimeMinutes, itinerary.overtimeMinor, itinerary.overtimeAtBooking], [600, 90, 0, false]);
  assert.deepEqual(result.breakdown.map((item) => item.kind), ["base", "over_km"]);
  // 部署前的口径：选 10h 时超 90 分钟 × 5,000 / 小时 = 7,500，明细列超时费，没有 overtimeAtBooking 键
  const legacy = quoted(trip("shinjuku", ["asakusa"], "shinjuku", usage(690, 250), undefined, 10));
  assert.equal(legacy.settlement, 62_500);
  assert.equal(legacy.offer.settlement.itinerary?.overtimeMinor, 7_500);
  assert.equal("overtimeAtBooking" in (legacy.offer.settlement.itinerary ?? {}), false);
  assert.deepEqual(legacy.breakdown.map((item) => item.kind), ["base", "over_km", "overtime"], "预收了超时费的旧单照旧列超时费");
  assert.equal(legacy.breakdown.find((item) => item.kind === "overtime")?.amountMinor, 8_250);
  assert.equal(legacy.breakdown.reduce((sum, item) => sum + item.amountMinor, 0), legacy.sell, "base 不会把超时费吞进去");
});

test("手动升档：可以改成更长的套餐；不能改成短于 T 的（PACKAGE_TOO_SHORT，带上能接受的最短档）；T 超过所有套餐时最长那一档可以选", () => {
  const route = usage(205, 100);
  const ten = quoted(trip("shinjuku", ["tsurugaoka"], "shinjuku", route, "manual", 10));
  assert.deepEqual([ten.hours, ten.settlement, ten.offer.autoPackageHours], [10, 63_000, 4]);
  const buffered = product({ bufferMinutes: 60 });
  const short = quoteProduct(buffered, trip("shinjuku", ["tsurugaoka"], "shinjuku", route, "manual", 4), moment);
  assert.ok(short.ok);
  assert.deepEqual([short.offers, short.refused], [[], [{ vehicleGroupId: "eco7", reason: "PACKAGE_TOO_SHORT", minPackageHours: 5 }]]);
  // T = 11.5h：只有 10h 能选，选 10h 照样报（不收超时）；选 5h 不报
  const longRoute = usage(690, 250);
  assert.equal(quoted(trip("shinjuku", ["asakusa"], "shinjuku", longRoute, "manual", 10)).settlement, 55_000);
  const five = quoteProduct(product(), trip("shinjuku", ["asakusa"], "shinjuku", longRoute, "manual", 5), moment);
  assert.ok(five.ok);
  assert.deepEqual(five.refused, [{ vehicleGroupId: "eco7", reason: "PACKAGE_TOO_SHORT", minPackageHours: 10 }]);
});

test("最低套餐（ADR 0091）：自动选档只在不短于最低套餐的档里选；客人自选时长（不按行程）低于最低套餐的不报（BELOW_MIN_PACKAGE）；比所有套餐都长时报不出", () => {
  const min5 = product({ minPackageHours: 5 });
  assert.equal(quoted(trip("shinjuku", ["asakusa"], "shinjuku", usage(150, 40), "auto"), min5).hours, 5);
  const four = quoteProduct(min5, trip("shinjuku", [], "shinjuku", undefined, "manual", 4), moment);
  assert.ok(four.ok);
  assert.deepEqual(four.refused, [{ vehicleGroupId: "eco7", reason: "BELOW_MIN_PACKAGE", minPackageHours: 5 }]);
  assert.equal(quoted(trip("shinjuku", [], "shinjuku", undefined, "manual", 5), min5).settlement, 33_000, "不按行程计价的包车只受最低套餐限制");
  const min12 = quoteProduct(product({ minPackageHours: 12 }), trip("shinjuku", ["asakusa"], "shinjuku", usage(150, 40), "auto"), moment);
  assert.ok(min12.ok);
  assert.deepEqual(min12.refused, [{ vehicleGroupId: "eco7", reason: "BELOW_MIN_PACKAGE", minPackageHours: 12 }]);
});

test("13 小时拦截（规格步骤 5，ADR 0093 第四节第 10 条）：T 超过商品的在线下单上限（默认 13 小时）整个商品不报 ITINERARY_TOO_LONG；正好 13 小时还能报；阈值按商品配置；改期、救援（locked）不拦", () => {
  const over = quoteProduct(product(), trip("shinjuku", ["asakusa"], "shinjuku", usage(810, 300), "auto"), moment);
  assert.deepEqual(over, { ok: false, productId: "tokyo-charter", tenantId: "tenant-a", reason: "ITINERARY_TOO_LONG" });
  assert.equal(quoteProduct(product(), trip("shinjuku", ["asakusa"], "shinjuku", usage(810, 300), "manual", 10), moment).ok, false, "手动选档同样拦");
  assert.equal(quoted(trip("shinjuku", ["asakusa"], "shinjuku", usage(780, 300), "auto")).hours, 10);
  // 缓冲算进 T：行驶 + 停留 12h30m + 缓冲 60 分 = 13h30m
  assert.equal(quoteProduct(product({ bufferMinutes: 60 }), trip("shinjuku", ["asakusa"], "shinjuku", usage(750, 300), "auto"), moment).ok, false);
  assert.equal(quoted(trip("shinjuku", ["asakusa"], "shinjuku", usage(810, 300), "auto"), product({ maxOnlineMinutes: 900 })).hours, 10);
  assert.equal(quoted(trip("shinjuku", ["asakusa"], "shinjuku", usage(810, 300), "locked", 10)).settlement, 55_000);
  // 商品本身报不出（没上架）时原因照旧，不报 ITINERARY_TOO_LONG
  const draft = quoteProduct(product(undefined, { status: "draft" }), trip("shinjuku", ["asakusa"], "shinjuku", usage(810, 300), "auto"), moment);
  assert.equal(!draft.ok && draft.reason, "PRODUCT_NOT_PUBLISHED");
});

test("候选只取能报出的档（ADR 0093 第四节第 2 条）：5h 缺镰仓的加价规则 → 镰仓行程不选 5h、选 10h；最长那一档也报不出时不报，不退到更短的档", () => {
  const no5 = product(undefined, { priceRules: RULES.filter((entry) => entry.id !== "s-kamakura-5") });
  const result = quoted(trip("shinjuku", ["tsurugaoka"], "shinjuku", usage(270, 120), "auto"), no5);
  assert.deepEqual([result.hours, result.settlement], [10, 63_000]);
  const no10 = product(undefined, { priceRules: RULES.filter((entry) => entry.id !== "s-kamakura-10") });
  const refused = quoteProduct(no10, trip("shinjuku", ["tsurugaoka"], "shinjuku", usage(690, 250), "auto"), moment);
  assert.ok(refused.ok);
  assert.deepEqual([refused.offers, refused.refused], [[], [{ vehicleGroupId: "eco7", reason: "NO_PRICE_RULE", stopSeq: 1 }]]);
  // 停用、不在生效期的套餐不算可用的档
  const disabled5 = product(undefined, { priceRules: RULES.map((entry) => (entry.id === "p-5" ? { ...entry, status: "disabled" as const } : entry)) });
  assert.equal(quoted(trip("shinjuku", ["tsurugaoka", "hasedera"], "shinjuku", usage(270, 120), "auto"), disabled5).hours, 10);
  // 一条套餐都没有：NO_PRICE_RULE
  const none = quoteProduct(product(undefined, { priceRules: [] }), trip("shinjuku", ["asakusa"], "shinjuku", usage(150, 40), "auto"), moment);
  assert.ok(none.ok);
  assert.deepEqual(none.refused, [{ vehicleGroupId: "eco7", reason: "NO_PRICE_RULE" }]);
});

test("差异表第 5 条：不同商品各自选自己的套餐、各自算总价，再比价——普通商品（4/5/10h）对 5h48m 的行程只能选 10h，特殊商品（只有 8/10/12h）选 8h 更便宜而中标；快照里每个候选记自己的档", () => {
  const special = product(undefined, {
    productId: "special",
    tenantId: "tenant-b",
    priceRules: [packageRule(8, 42_000, 250, "q-8"), packageRule(10, 50_000, 300, "q-10"), packageRule(12, 60_000, 360, "q-12"), ...[8, 10, 12].flatMap(surchargeRules)],
  });
  const request = trip("shinjuku", ["asakusa"], "shinjuku", usage(348, 200), "auto");
  const quotes = [quoteProduct(product(), request, moment), quoteProduct(special, request, moment)];
  assert.deepEqual(quotes.map((quote) => only(quote).packageHours), [10, 8]);
  const comparison = compareQuotes({ request, currency: "JPY", now: moment.now, bandBp: 0, entries: quotes.map((quote) => ({ quote, productVersion: 1, standing, markupBp: () => 1_000, fx: null })) });
  const group = comparison.groups[0];
  assert.ok(group !== undefined);
  assert.equal(group.packageHours, null, "自动选档的比价组没有统一的套餐时长");
  assert.deepEqual([group.snapshot.winner.productId, group.snapshot.winner.offer.packageHours, group.snapshot.winner.offer.settlement.totalMinor], ["special", 8, 42_000]);
  assert.deepEqual(group.snapshot.candidates.map((entry) => [entry.productId, entry.packageHours, entry.settlementMinor]), [["special", 8, 42_000], ["tokyo-charter", 10, 55_000]]);
  assert.equal(group.snapshot.request.charterSelection, "auto");
  // 不带 charterSelection 的快照候选没有 packageHours（和以前一样）
  const legacy = { ...request, packageHours: 10 };
  delete (legacy as { charterSelection?: unknown }).charterSelection;
  const old = compareQuotes({ request: legacy, currency: "JPY", now: moment.now, entries: [{ quote: quoteProduct(product(), legacy, moment), productVersion: 1, standing, markupBp: () => 1_000, fx: null }] });
  assert.equal("packageHours" in (old.groups[0]?.snapshot.candidates[0] ?? {}), false);
});

test("改期、救援（locked）：按订单的档报、不重新选档、不收超时费；预计用时四项由服务层从原订单抄（withOrderEstimate），旧单原样", () => {
  const locked = quoted(trip("shinjuku", ["asakusa"], "shinjuku", usage(690, 250), "locked", 5), product({ bufferMinutes: 60 }));
  assert.equal(locked.hours, 5);
  assert.equal(locked.settlement, 33_000 + 100 * 500);
  assert.deepEqual(locked.offer.settlement.itinerary && [locked.offer.settlement.itinerary.overtimeMinutes, locked.offer.settlement.itinerary.overtimeMinor, locked.offer.settlement.itinerary.overtimeAtBooking, locked.offer.settlement.itinerary.estimatedMinutes], [390, 0, false, undefined]);
  const original = quoted(trip("shinjuku", ["asakusa"], "shinjuku", usage(200, 60), "auto"), product({ stopOccupancyMinutes: 15, bufferMinutes: 60 })).offer.settlement;
  const rescheduled: SettlementBreakdown = withOrderEstimate(quoted(trip("shinjuku", ["asakusa"], "shinjuku", usage(200, 60), "locked", 5)).offer.settlement, original);
  assert.deepEqual(rescheduled.itinerary && [rescheduled.itinerary.stops, rescheduled.itinerary.stopOccupancyMinutes, rescheduled.itinerary.bufferMinutes, rescheduled.itinerary.estimatedMinutes], [1, 15, 60, 275]);
  // 再改一次期：仍在
  const twice = withOrderEstimate(quoted(trip("shinjuku", ["asakusa"], "shinjuku", usage(200, 60), "locked", 5)).offer.settlement, rescheduled);
  assert.equal(twice.itinerary?.estimatedMinutes, 275);
  // 部署前的单（原明细没有这几项）：原样
  const legacy = quoted(trip("shinjuku", ["asakusa"], "shinjuku", usage(200, 60), undefined, 5)).offer.settlement;
  assert.deepEqual(withOrderEstimate(legacy, legacy), legacy);
});

test("请求校验：auto 不给套餐时长、要给行程；只有包车能带 charterSelection；写错的值不认", () => {
  assert.deepEqual(quoteRequestIssues(trip("shinjuku", [], "shinjuku", usage(100, 10), "auto")), []);
  assert.deepEqual(quoteRequestIssues(trip("shinjuku", [], "shinjuku", usage(100, 10), "auto", 5)), [{ path: "/package_hours", reason: "NOT_APPLICABLE" }]);
  assert.deepEqual(quoteRequestIssues(trip("shinjuku", [], "shinjuku", undefined, "auto")), [{ path: "/route_usage", reason: "REQUIRED" }]);
  assert.deepEqual(quoteRequestIssues(trip("shinjuku", [], "shinjuku", undefined, "manual")), [{ path: "/package_hours", reason: "REQUIRED" }]);
  assert.deepEqual(quoteRequestIssues(trip("shinjuku", [], "shinjuku", undefined, "locked", 5)), []);
  assert.deepEqual(quoteRequestIssues({ ...trip("shinjuku", [], "shinjuku", undefined, "manual", 5), charterSelection: "fallback" as never }), [{ path: "/charter_selection", reason: "OUT_OF_RANGE" }]);
  const p2p: QuoteRequest = { category: "point_to_point", pickup: P.shinjuku, dropoff: P.asakusa, direction: null, packageHours: null, serviceLocal: "2026-12-01T09:00", passengers: 1, luggage: 0, addons: [], driverLanguage: null, vehicleGroupIds: [], charterSelection: "manual" };
  assert.deepEqual(quoteRequestIssues(p2p), [{ path: "/charter_selection", reason: "NOT_APPLICABLE" }]);
});

test("服务规则三项 + 在线下单上限：默认 0 / 0 / 不限 / 13 小时，只存和默认不同的项；范围；只有包车能设；最低套餐比所有套餐都长时上架检查给提醒", () => {
  assert.deepEqual(DEFAULT_CHARTER_ITINERARY, { dropoffItinerarySurcharge: true, stopOccupancyMinutes: 0, bufferMinutes: 0, minPackageHours: null, maxOnlineMinutes: 780 });
  assert.deepEqual(charterItineraryOf({ charterItinerary: { bufferMinutes: 60 } }), { ...DEFAULT_CHARTER_ITINERARY, bufferMinutes: 60 });
  const allow = (): boolean => true;
  assert.equal("charterItinerary" in normalizeServiceRules({ ...emptyServiceRules(), charterItinerary: { ...DEFAULT_CHARTER_ITINERARY } }, allow), false, "全是默认值不存");
  assert.deepEqual(normalizeServiceRules({ ...emptyServiceRules(), charterItinerary: { ...DEFAULT_CHARTER_ITINERARY, stopOccupancyMinutes: 15, minPackageHours: 5 } }, allow).charterItinerary, { stopOccupancyMinutes: 15, minPackageHours: 5 });
  const context = { pickupPlace: null, category: "charter" as const };
  assert.deepEqual(serviceRuleIssues({ ...emptyServiceRules(), charterItinerary: { stopOccupancyMinutes: 15, bufferMinutes: 60, minPackageHours: 5, maxOnlineMinutes: 780 } }, context), []);
  assert.deepEqual(
    serviceRuleIssues({ ...emptyServiceRules(), charterItinerary: { stopOccupancyMinutes: 121, bufferMinutes: 1.5, minPackageHours: 0, maxOnlineMinutes: 59 } }, context).map((issue) => [issue.path, issue.reason]),
    [["/charter_itinerary/stop_occupancy_minutes", "OUT_OF_RANGE"], ["/charter_itinerary/buffer_minutes", "NOT_INTEGER"], ["/charter_itinerary/min_package_hours", "OUT_OF_RANGE"], ["/charter_itinerary/max_online_minutes", "OUT_OF_RANGE"]],
  );
  assert.deepEqual(serviceRuleIssues({ ...emptyServiceRules(), charterItinerary: { bufferMinutes: 60 } }, { ...context, category: "point_to_point" }), [{ path: "/charter_itinerary", reason: "NOT_APPLICABLE" }]);
  assert.deepEqual(minPackageAboveAll({ charterItinerary: { minPackageHours: 12 } }, [4, 5, 10]), { minPackageHours: 12, longestPackageHours: 10 });
  assert.equal(minPackageAboveAll({ charterItinerary: { minPackageHours: 10 } }, [4, 5, 10]), null);
  assert.equal(minPackageAboveAll({}, [4]), null);
});

test("上架检查：包车最低套餐比所有启用的套餐都长时多一项提醒 charter_min_package（不拦上架）", () => {
  const facts = {
    category: "charter" as const,
    brandActive: true,
    cityActive: true,
    pickupPlace: null,
    areas: [{ status: "active" as const, bizType: "charter" as const, cityActive: true }],
    vehicleGroups: [{ active: true, comboOffered: true }],
    dispatcherCount: 1,
    serviceRules: { ...product().serviceRules, charterItinerary: { minPackageHours: 12 } },
    addons: [],
    content: {},
    activePriceRuleCount: 3,
  };
  const item = publishCheck({ ...facts, charterPackageHours: [4, 5, 10] }).find((entry) => entry.key === "charter_min_package");
  assert.deepEqual(item, { key: "charter_min_package", required: false, passed: false, issues: [{ path: "/charter_itinerary/min_package_hours", reason: "MIN_PACKAGE_ABOVE_ALL", detail: { min_package_hours: 12, longest_package_hours: 10 } }] });
  assert.equal(publishCheck({ ...facts, charterPackageHours: [4, 5, 12] }).some((entry) => entry.key === "charter_min_package"), false);
});
