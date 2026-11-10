/**
 * M8-11 点对点线路价、含公里数（ADR 0073 第二部分）：价格规则的下车区域和含公里数字段、冲突键、报价时先找线路价、
 * 超出公里数向上取整、拿不到路线时不报、对外价参考。
 * 例子：商品有三个区域——市区（139.5–139.8）、机场（140.2–140.5）、港口（139.0–139.3），市区和港口之间有一块重叠（139.25–139.3 里没有，这里不重叠）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Position } from "./areas.ts";
import {
  type AdjustRule,
  type PriceRule,
  basePrice,
  calendarDay,
  findPriceRuleOverlaps,
  fixedPriceWithKm,
  hasIncludedKm,
  isRouteRule,
  overKm,
  priceCoverage,
  priceRuleComboKey,
  priceRuleIssues,
  selectPriceRule,
  sellablePriceRules,
  sellableRouteRules,
} from "./pricing.ts";
import { emptyServiceRules } from "./products.ts";
import { type QuoteArea, type QuoteMoment, type QuoteProduct, type QuoteRequest, compareQuotes, quoteProduct } from "./quote.ts";

const square = (west: number, south: number, east: number, north: number): Position[] => [[west, south], [east, south], [east, north], [west, north], [west, south]];
const area = (areaId: string, ring: Position[], extra: Partial<QuoteArea> = {}): QuoteArea => ({ areaId, active: true, shapes: [{ id: `${areaId}-op`, kind: "operate", ring }], ...extra });

const CITY = area("city", square(139.5, 35.5, 139.8, 35.9));
const AIRPORT = area("airport", square(140.2, 35.6, 140.5, 35.9));
const PORT = area("port", square(139.0, 35.5, 139.3, 35.9));
// 「大市区」整个包住市区（一个点落在两个区域里时用）
const WIDE_CITY = area("wide-city", square(139.45, 35.45, 139.85, 35.95));
const P = {
  city: { lng: 139.7, lat: 35.7 },
  airport: { lng: 140.3, lat: 35.7 },
  port: { lng: 139.1, lat: 35.7 },
  nowhere: { lng: 141.5, lat: 37.0 },
};

const rule = (id: string, extra: Partial<PriceRule> = {}, basePriceMinor = 10_000): PriceRule & { id: string } => ({
  id,
  areaId: "city",
  vehicleGroupId: "biz7",
  direction: null,
  packageHours: null,
  pricing: { model: "fixed", basePriceMinor },
  validFrom: "2026-01-01",
  validTo: null,
  status: "enabled",
  ...extra,
});
const line = (id: string, from: string, to: string, basePriceMinor: number, extra: Partial<PriceRule> = {}): PriceRule & { id: string } => rule(id, { areaId: from, toAreaId: to, ...extra }, basePriceMinor);
const withKm = (r: PriceRule & { id: string }, includedKm: number, overKmPerKmMinor: number): PriceRule & { id: string } => ({ ...r, pricing: { model: "fixed", basePriceMinor: (r.pricing as { basePriceMinor: number }).basePriceMinor, includedKm, overKmPerKmMinor } });
const adjust = (name: string, steps: AdjustRule["steps"], extra: Partial<AdjustRule> = {}): AdjustRule & { id: string } => ({ id: name, name, travelFrom: null, travelTo: null, cycle: { type: "daily" }, timeSlot: null, areaIds: [], vehicleGroupIds: [], directions: [], packageHours: [], steps, status: "enabled", ...extra });

const AREA_PRICES = [rule("city-area", {}, 10_000), rule("airport-area", { areaId: "airport" }, 8_000), rule("port-area", { areaId: "port" }, 9_000)];

const p2p = (extra: Partial<QuoteProduct> = {}): QuoteProduct => ({
  productId: "p2p-1",
  tenantId: "tenant-a",
  category: "point_to_point",
  status: "published",
  tenantActive: true,
  brandActive: true,
  currency: "JPY",
  roundingUnit: 1,
  timeZone: "Asia/Tokyo",
  pickupPlace: null,
  areas: [CITY, AIRPORT, PORT],
  vehicleGroups: [{ vehicleGroupId: "biz7", passengers: 6, luggage: 4, active: true }, { vehicleGroupId: "eco4", passengers: 3, luggage: 2, active: true }],
  serviceRules: { ...emptyServiceRules(), booking: { saleFrom: null, saleTo: null, serviceTime: { start: "00:00", end: "24:00" }, leadTimeHours: 24, note: null }, freeWait: { pickup: null, dropoff: null, general: { mode: "limited", minutes: 15 } } },
  addonCatalog: [],
  priceRules: AREA_PRICES,
  adjustRules: [],
  inventoryMode: "unlimited",
  ...extra,
});
const trip = (pickup: keyof typeof P, dropoff: keyof typeof P, extra: Partial<QuoteRequest> = {}): QuoteRequest => ({
  category: "point_to_point",
  pickup: P[pickup],
  dropoff: P[dropoff],
  direction: null,
  packageHours: null,
  serviceLocal: "2026-10-20T10:00",
  passengers: 2,
  luggage: 1,
  addons: [],
  driverLanguage: null,
  vehicleGroupIds: ["biz7"],
  ...extra,
});
const ROUTE = { meters: 34_200, minutes: 50 };
const moment = (route: QuoteMoment["route"] = ROUTE): QuoteMoment => ({ now: new Date("2026-10-07T01:00:00Z"), route, inventoryDay: null, urgentUsed: 0 });

/** 报价写成「用的哪条规则 + 结算价」（或原因） */
function quoted(product: QuoteProduct, request: QuoteRequest, route: QuoteMoment["route"] = ROUTE): [string, number] | string {
  const result = quoteProduct(product, request, moment(route));
  if (!result.ok) return result.reason;
  const offer = result.offers[0];
  return offer === undefined ? (result.refused[0]?.reason ?? "NONE") : [offer.priceRuleId, offer.settlement.totalMinor];
}
function settlementOf(product: QuoteProduct, request: QuoteRequest, route: QuoteMoment["route"] = ROUTE) {
  const result = quoteProduct(product, request, moment(route));
  assert.ok(result.ok && result.offers.length === 1, JSON.stringify(result));
  return (result.offers[0] as (typeof result.offers)[number]).settlement;
}

// ---- 价格规则 ----

test("下车区域只有点对点能填，不能等于上车区域；不填（null 或不给）就是区域价", () => {
  assert.deepEqual(priceRuleIssues(line("x", "city", "airport", 18_000), { category: "point_to_point" }), []);
  assert.deepEqual(priceRuleIssues(line("x", "city", "city", 18_000), { category: "point_to_point" }), [{ path: "/to_area_id", reason: "SAME_AREA" }]);
  assert.deepEqual(priceRuleIssues(line("x", "city", "airport", 18_000, { direction: "both" }), { category: "airport_transfer" }), [{ path: "/to_area_id", reason: "NOT_APPLICABLE" }]);
  assert.deepEqual(
    priceRuleIssues({ ...line("x", "city", "airport", 1, { packageHours: 8 }), pricing: { model: "charter_package", packageKm: 100, packagePriceMinor: 1, overtimePerHourMinor: 0, overKmPerKmMinor: 0 } }, { category: "charter" }),
    [{ path: "/to_area_id", reason: "NOT_APPLICABLE" }],
  );
  assert.deepEqual(priceRuleIssues(rule("x", { toAreaId: null }), { category: "point_to_point" }), []);
  assert.equal(isRouteRule(rule("x")), false);
  assert.equal(isRouteRule(rule("x", { toAreaId: null })), false);
  assert.equal(isRouteRule(line("x", "city", "airport", 1)), true);
});

test("含公里数：只有点对点的一口价；要么都填要么都不填；含公里数 1～2000 的整数，超出每公里 0 到金额上限", () => {
  const issues = (r: PriceRule, category: "point_to_point" | "airport_transfer" = "point_to_point") => priceRuleIssues(r, { category });
  assert.deepEqual(issues(withKm(rule("x"), 30, 300)), []);
  assert.deepEqual(issues(withKm(rule("x"), 30, 0)), [], "超出每公里可以是 0（超出不另收）");
  assert.deepEqual(issues(withKm(line("x", "city", "airport", 18_000), 2_000, 250)), [], "线路价也能用");
  assert.deepEqual(issues({ ...rule("x"), pricing: { model: "fixed", basePriceMinor: 1, includedKm: 30 } }), [{ path: "/over_km_per_km", reason: "REQUIRED" }]);
  assert.deepEqual(issues({ ...rule("x"), pricing: { model: "fixed", basePriceMinor: 1, overKmPerKmMinor: 0 } }), [{ path: "/included_km", reason: "REQUIRED" }]);
  assert.deepEqual(issues(withKm(rule("x"), 0, -1)), [
    { path: "/included_km", reason: "OUT_OF_RANGE", detail: { min: 1, max: 2_000 } },
    { path: "/over_km_per_km", reason: "OUT_OF_RANGE", detail: { min: 0, max: 1_000_000_000 } },
  ]);
  assert.deepEqual(issues(withKm(rule("x"), 2_001, 1.5)), [{ path: "/included_km", reason: "OUT_OF_RANGE", detail: { min: 1, max: 2_000 } }, { path: "/over_km_per_km", reason: "NOT_INTEGER" }]);
  assert.deepEqual(issues(withKm(rule("x"), 12.5, 100)), [{ path: "/included_km", reason: "NOT_INTEGER" }]);
  assert.deepEqual(issues(withKm(rule("x", { direction: "both" }), 30, 300), "airport_transfer"), [
    { path: "/included_km", reason: "NOT_APPLICABLE" },
    { path: "/over_km_per_km", reason: "NOT_APPLICABLE" },
  ]);
  assert.equal(hasIncludedKm(withKm(rule("x"), 30, 300).pricing), true);
  assert.equal(hasIncludedKm(rule("x").pricing), false);
});

test("冲突键含下车区域：同一线路 × 车型组 × 日期重叠只能有一条；线路价和区域价互不冲突；去程和返程是两条线路", () => {
  assert.notEqual(priceRuleComboKey(rule("a")), priceRuleComboKey(line("b", "city", "airport", 1)));
  assert.deepEqual(findPriceRuleOverlaps([rule("a"), line("b", "city", "airport", 1)]), [], "区域价和线路价不冲突");
  assert.deepEqual(findPriceRuleOverlaps([line("a", "city", "airport", 1), line("b", "airport", "city", 2)]), [], "反方向是另一条线路");
  assert.deepEqual(findPriceRuleOverlaps([line("a", "city", "airport", 1), line("b", "city", "port", 2)]), []);
  assert.deepEqual(findPriceRuleOverlaps([line("a", "city", "airport", 1), line("b", "city", "airport", 2, { validFrom: "2026-06-01" })]), [[0, 1]]);
  assert.deepEqual(findPriceRuleOverlaps([line("a", "city", "airport", 1), line("b", "city", "airport", 2, { vehicleGroupId: "eco4" })]), []);
  assert.deepEqual(findPriceRuleOverlaps([line("a", "city", "airport", 1, { validTo: "2026-05-31" }), line("b", "city", "airport", 2, { validFrom: "2026-06-01" })]), []);
  // 不给 toAreaId 和 toAreaId: null 是同一种（区域价）
  assert.deepEqual(findPriceRuleOverlaps([rule("a"), rule("b", { toAreaId: null })]), [[0, 1]]);
});

test("缺价统计、上架检查只看区域价：线路价不算「该有的价格」，只有线路价的区域照样算缺价", () => {
  const rules = [line("a", "city", "airport", 18_000), rule("b", { areaId: "airport" })];
  const coverage = priceCoverage({ category: "point_to_point", areaIds: ["city", "airport"], vehicleGroupIds: ["biz7"], rules, today: "2026-10-07" });
  assert.deepEqual(
    coverage.combos.map((combo) => [combo.areaId, combo.state, combo.ruleIndex]),
    [
      ["city", "missing", null],
      ["airport", "priced", 1],
    ],
  );
  assert.deepEqual(sellablePriceRules(rules, { areaIds: ["city", "airport"], vehicleGroupIds: ["biz7"] }, "2026-10-07").map((r) => r.id), ["b"]);
  assert.deepEqual(sellablePriceRules([line("a", "city", "airport", 1)], { areaIds: ["city", "airport"], vehicleGroupIds: ["biz7"] }, "2026-10-07"), [], "只有线路价的商品不能上架");
  // 调价规则的检查要看的线路价：启用、未过期、两端区域和车型组都是商品选着的
  const routes = [line("ok", "city", "airport", 1), line("off", "city", "airport", 1, { status: "disabled", validFrom: "2027-01-01" }), line("gone", "city", "port", 1), line("old", "airport", "city", 1, { validTo: "2026-10-06" }), rule("area")];
  assert.deepEqual(sellableRouteRules(routes, { areaIds: ["city", "airport"], vehicleGroupIds: ["biz7"] }, "2026-10-07").map((r) => r.id), ["ok"]);
});

test("命中规则：找区域价时不看线路价，找线路价时只看那一条线路（单向）", () => {
  const rules = [rule("area"), line("go", "city", "airport", 18_000), line("back", "airport", "city", 17_000)];
  const query = { areaId: "city", vehicleGroupId: "biz7", direction: null, packageHours: null, date: "2026-10-20" };
  assert.equal(selectPriceRule(rules, query)?.id, "area");
  assert.equal(selectPriceRule(rules, { ...query, toAreaId: null })?.id, "area");
  assert.equal(selectPriceRule(rules, { ...query, toAreaId: "airport" })?.id, "go");
  assert.equal(selectPriceRule(rules, { ...query, areaId: "airport", toAreaId: "city" })?.id, "back");
  assert.equal(selectPriceRule(rules, { ...query, toAreaId: "port" }), null);
  assert.equal(selectPriceRule([line("go", "city", "airport", 1)], query), null, "只有线路价时找不到区域价");
});

// ---- 超出公里数 ----

test("超出公里数向上取整到 1 公里（ADR 的例子：含 30 公里，30.0 → 0，30.2 → 1，31.0 → 1，31.4 → 2）；没超出是 0", () => {
  assert.deepEqual([30_000, 30_200, 31_000, 31_400, 30_001, 29_999, 0].map((meters) => overKm(meters, 30)), [0, 1, 1, 2, 1, 0, 0]);
  assert.equal(overKm(30_000.9, 30), 0, "米数不是整数的先舍去小数");
  assert.equal(overKm(2_000_000, 2_000), 0);
  assert.equal(overKm(2_000_001, 1), 2_000);
  const pricing = { model: "fixed" as const, basePriceMinor: 18_000, includedKm: 30, overKmPerKmMinor: 300 };
  assert.equal(fixedPriceWithKm(pricing, 34_200), 18_000 + 5 * 300);
  assert.equal(fixedPriceWithKm(pricing, 30_000), 18_000);
  assert.equal(fixedPriceWithKm(pricing, null), 18_000, "不知道路线时按不超出算（日历、读回用）");
  assert.equal(fixedPriceWithKm({ model: "fixed", basePriceMinor: 18_000 }, 99_000), 18_000, "没设含公里数的不看距离");
  // 基础价（精确值）同一个口径；不给里程时按不超出
  assert.equal(basePrice(pricing, { meters: 34_200 }).numerator, 19_500n);
  assert.equal(basePrice(pricing).numerator, 18_000n);
  assert.equal(basePrice({ model: "fixed", basePriceMinor: 18_000 }, { meters: 99_000 }).numerator, 18_000n);
});

// ---- 报价 ----

test("线路价优先、单向：市区 → 机场用线路价（比区域价贵也用，不和区域价比低）；机场 → 市区没有线路价时退回区域价（取最低）", () => {
  const product = p2p({ priceRules: [...AREA_PRICES, line("city→airport", "city", "airport", 18_000)] });
  assert.deepEqual(quoted(product, trip("city", "airport")), ["city→airport", 18_000]);
  assert.deepEqual(quoted(product, trip("airport", "city")), ["airport-area", 8_000], "反方向不命中，退回区域价（两端区域取最低）");
  assert.deepEqual(quoted(p2p(), trip("city", "airport")), ["airport-area", 8_000], "没有线路价时和以前一样");
  // 同一区域里（上车、下车都在市区）不找线路价
  assert.deepEqual(quoted(product, trip("city", "city")), ["city-area", 10_000]);
});

test("返程价格不同：去程、返程两条独立的线路价各管一个方向", () => {
  const product = p2p({ priceRules: [...AREA_PRICES, line("go", "city", "airport", 18_000), line("back", "airport", "city", 17_000)] });
  assert.deepEqual(quoted(product, trip("city", "airport")), ["go", 18_000]);
  assert.deepEqual(quoted(product, trip("airport", "city")), ["back", 17_000]);
});

test("线路价比区域价便宜时也用线路价；停用的、不在生效期的、别的车型组的线路价不算命中，退回区域价", () => {
  const cheap = p2p({ priceRules: [...AREA_PRICES, line("cheap", "city", "airport", 5_000)] });
  assert.deepEqual(quoted(cheap, trip("city", "airport")), ["cheap", 5_000]);
  for (const extra of [{ status: "disabled" as const }, { validFrom: "2026-11-01" }, { validTo: "2026-10-19" }, { vehicleGroupId: "eco4" }]) {
    assert.deepEqual(quoted(p2p({ priceRules: [...AREA_PRICES, line("x", "city", "airport", 18_000, extra)] }), trip("city", "airport")), ["airport-area", 8_000], JSON.stringify(extra));
  }
});

test("一个点落在几个区域里：每个「上车区域 → 下车区域」组合都试，命中几条取结算价最低的，一样低取商品里排在前面的区域", () => {
  const product = p2p({
    areas: [CITY, WIDE_CITY, AIRPORT, PORT],
    priceRules: [...AREA_PRICES, line("city→airport", "city", "airport", 18_000), line("wide→airport", "wide-city", "airport", 16_000)],
  });
  assert.deepEqual(quoted(product, trip("city", "airport")), ["wide→airport", 16_000]);
  const tie = p2p({ areas: [CITY, WIDE_CITY, AIRPORT, PORT], priceRules: [...AREA_PRICES, line("wide→airport", "wide-city", "airport", 16_000), line("city→airport", "city", "airport", 16_000)] });
  assert.deepEqual(quoted(tie, trip("city", "airport")), ["city→airport", 16_000], "一样低取商品里排在前面的区域（市区在大市区前面）");
  // 停用的区域不参与
  const off = p2p({ areas: [{ ...CITY, active: false }, WIDE_CITY, AIRPORT], priceRules: [...AREA_PRICES, line("city→airport", "city", "airport", 1_000), line("wide→airport", "wide-city", "airport", 16_000)] });
  assert.deepEqual(quoted(off, trip("city", "airport")), ["wide→airport", 16_000]);
});

test("落在禁行区的区域不参与：上车点在某区域的禁行区里时，这个区域出发的线路价不用", () => {
  const cityWithHole: QuoteArea = { areaId: "city", active: true, shapes: [{ id: "c-op", kind: "operate", ring: square(139.5, 35.5, 139.8, 35.9) }, { id: "c-no", kind: "forbid", ring: square(139.65, 35.65, 139.75, 35.75) }] };
  const product = p2p({ areas: [cityWithHole, WIDE_CITY, AIRPORT], priceRules: [...AREA_PRICES, rule("wide-area", { areaId: "wide-city" }, 12_000), line("city→airport", "city", "airport", 1_000)] });
  assert.deepEqual(quoted(product, trip("city", "airport")), ["airport-area", 8_000]);
});

test("调价规则照常作用在线路价上（按上车区域匹配），各项之和仍等于总价；明细带下车区域", () => {
  const product = p2p({ priceRules: [...AREA_PRICES, line("go", "city", "airport", 18_000)], adjustRules: [adjust("city+10%", [{ type: "percent", value: 1_000 }], { areaIds: ["city"] }), adjust("airport-5%", [{ type: "percent", value: -500 }], { areaIds: ["airport"] })] });
  const settlement = settlementOf(product, trip("city", "airport"));
  assert.equal(settlement.totalMinor, 19_800);
  assert.equal(settlement.baseMinor + settlement.adjustMinor, settlement.totalMinor);
  assert.equal(settlement.toAreaId, "airport");
  assert.equal(settlement.distance, undefined, "没设含公里数");
  // 区域价的明细没有这两项（和以前一样）
  const plain = settlementOf(p2p(), trip("city", "airport"));
  assert.deepEqual(["toAreaId" in plain, "distance" in plain], [false, false]);
});

test("含公里数的一口价：超出部分报价时算进一口价（再调价、取整），路线距离和超出公里数锁进明细；拿不到路线时这条不报", () => {
  const product = p2p({ roundingUnit: 100, priceRules: [withKm(line("go", "city", "airport", 18_000), 30, 300), rule("airport-area", { areaId: "airport" }, 8_000)], adjustRules: [adjust("+10%", [{ type: "percent", value: 1_000 }])] });
  const settlement = settlementOf(product, trip("city", "airport"), { meters: 34_200, minutes: 50 });
  // (18000 + 5 × 300) × 1.1 = 21450 → 取整到 100 = 21500（四舍五入）
  assert.deepEqual([settlement.baseMinor, settlement.totalMinor], [19_500, 21_500]);
  assert.deepEqual(settlement.distance, { includedKm: 30, routeMeters: 34_200, overKm: 5, overKmPerKmMinor: 300 });
  assert.deepEqual(settlement.usage, { meters: 34_200, minutes: 50 }, "用到的路线预估也记下（改期重算用同一段路线）");
  // 没超出
  assert.deepEqual(settlementOf(product, trip("city", "airport"), { meters: 30_000, minutes: 40 }).distance, { includedKm: 30, routeMeters: 30_000, overKm: 0, overKmPerKmMinor: 300 });
  // 拿不到路线：这条线路价不报（不退回区域价：线路价已经命中了，宁可报不出）
  assert.equal(quoted(product, trip("city", "airport"), null), "ROUTE_UNAVAILABLE");
  // 没设含公里数的规则拿不到路线也照常报
  assert.deepEqual(quoted(product, trip("airport", "city"), null), ["airport-area", 8_800]);
});

test("区域价也能设含公里数；超出每公里是 0 时超出不另收，明细照样记距离", () => {
  const product = p2p({ priceRules: [withKm(rule("city-km"), 10, 0)] });
  const settlement = settlementOf(product, trip("city", "city"), { meters: 12_345, minutes: 20 });
  assert.equal(settlement.totalMinor, 10_000);
  assert.deepEqual(settlement.distance, { includedKm: 10, routeMeters: 12_345, overKm: 3, overKmPerKmMinor: 0 });
  assert.equal(settlement.toAreaId, undefined);
  assert.equal(quoted(product, trip("city", "city"), null), "ROUTE_UNAVAILABLE");
});

test("对外价参考：超出每公里按这一单的汇率、缓冲、加价比例换成客人币种，单独四舍五入；只在快照的中标对外价里", () => {
  const product = p2p({ priceRules: [withKm(line("go", "city", "airport", 18_000), 30, 250)] });
  const request = trip("city", "airport");
  const comparison = compareQuotes({ request, currency: "JPY", now: moment().now, entries: [{ quote: quoteProduct(product, request, moment()), productVersion: 2, standing: { scoreCenti: null, completedOrders: 0, observation: false }, markupBp: () => 1_500, fx: null }] });
  const winner = comparison.groups[0]?.snapshot.winner;
  // (18000 + 5 × 250) × 1.15 = 22137.5 → 22138；每公里 250 × 1.15 = 287.5 → 288
  assert.deepEqual([winner?.sell.sellMinor, winner?.sell.overKmPerKmMinor], [22_138, 288]);
  const usd = compareQuotes({ request, currency: "USD", now: moment().now, entries: [{ quote: quoteProduct(product, request, moment()), productVersion: 2, standing: { scoreCenti: null, completedOrders: 0, observation: false }, markupBp: () => 1_500, fx: { from: "JPY", to: "USD", rate: "0.0067", asOf: "2026-10-07T00:00:00Z" } }] });
  // 250 × 0.0067 × 1.015 × 1.15 = 1.955… 美元 → 196 美分
  assert.equal(usd.groups[0]?.snapshot.winner.sell.overKmPerKmMinor, 196);
  const plain = compareQuotes({ request, currency: "JPY", now: moment().now, entries: [{ quote: quoteProduct(p2p(), request, moment()), productVersion: 1, standing: { scoreCenti: null, completedOrders: 0, observation: false }, markupBp: () => 1_500, fx: null }] });
  assert.equal(plain.groups[0]?.snapshot.winner.sell.overKmPerKmMinor, undefined);
});

test("价格日历：给了下车区域就算这条线路的价（线路价）；含公里数的一口价按不超出算", () => {
  const rules = [rule("area"), withKm(line("go", "city", "airport", 18_000), 30, 300)];
  const day = (toAreaId: string | null) => calendarDay({ priceRules: rules, adjustRules: [], query: { areaId: "city", vehicleGroupId: "biz7", direction: null, packageHours: null, date: "2026-10-20", toAreaId }, roundingUnit: 1 });
  assert.deepEqual(day("airport").map((segment) => [segment.priceRule?.id, segment.price?.finalMinor]), [["go", 18_000]]);
  assert.deepEqual(day(null).map((segment) => [segment.priceRule?.id, segment.price?.finalMinor]), [["area", 10_000]]);
  assert.deepEqual(day("port").map((segment) => [segment.priceRule, segment.noPriceReason]), [[null, "NO_RULE"]]);
});
