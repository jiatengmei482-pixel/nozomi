/**
 * M9W-01 包车途经加价（ADR 0088；业主原文 docs/requirements/charter-waypoint-surcharge.md 13.4 算例、13.9 验收用例）。
 * 例子用原文的：经济 7 座 10 小时套餐 ¥55,000；富士山地区途经加价 ¥10,000、镰仓 ¥6,000；客人价 = 结算价 × 1.1（加价 10%）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Position } from "./areas.ts";
import type { LatLng } from "./geo.ts";
import { type PriceRule, areaSurchargeFor, priceRuleIssues } from "./pricing.ts";
import { emptyServiceRules } from "./products.ts";
import { type QuoteArea, type QuoteMoment, type QuoteProduct, type QuoteRequest, QUOTE_REFUSALS, compareQuotes, quoteProduct, quoteRequestIssues, sellBreakdown } from "./quote.ts";

const square = (west: number, south: number, east: number, north: number): Position[] => [[west, south], [east, south], [east, north], [west, north], [west, south]];
const area = (areaId: string, ring: Position[], extra: Partial<QuoteArea> = {}): QuoteArea => ({ areaId, active: true, shapes: [{ id: `${areaId}-op`, kind: "operate", ring }], ...extra });

const TOKYO = area("tokyo", square(139.55, 35.55, 139.95, 35.85));
const FUJI = area("fuji", square(138.55, 35.25, 139.0, 35.55));
const KAMAKURA = area("kamakura", square(139.5, 35.28, 139.6, 35.36));
/** 和富士山重叠一小块（138.95–139.0 × 35.25–35.30） */
const HAKONE = area("hakone", square(138.95, 35.15, 139.1, 35.3));
const P = {
  shinjuku: { lng: 139.7, lat: 35.69 },
  asakusa: { lng: 139.8, lat: 35.71 },
  gogome: { lng: 138.73, lat: 35.39 },
  kawaguchiko: { lng: 138.76, lat: 35.5 },
  chureito: { lng: 138.8, lat: 35.5 },
  kawaguchikoStation: { lng: 138.77, lat: 35.49 },
  tsurugaoka: { lng: 139.556, lat: 35.326 },
  daibutsu: { lng: 139.536, lat: 35.317 },
  /** 富士山和箱根重叠的地方 */
  fujiHakone: { lng: 138.97, lat: 35.27 },
  hakone: { lng: 139.05, lat: 35.2 },
  sendai: { lng: 140.87, lat: 38.27 },
} satisfies Record<string, LatLng>;
type Place = keyof typeof P;

const rule = (id: string, areaId: string, pricing: PriceRule["pricing"], extra: Partial<PriceRule> = {}): PriceRule & { id: string } => ({ id, areaId, vehicleGroupId: "eco7", direction: null, packageHours: 10, pricing, validFrom: "2026-01-01", validTo: null, status: "enabled", ...extra });
const pkg = rule("p-10", "tokyo", { model: "charter_package", packageKm: 300, packagePriceMinor: 55_000, overtimePerHourMinor: 5_000, overKmPerKmMinor: 400 });
const surcharge = (id: string, areaId: string, pickup: number, dropoff: number, waypoint: number | undefined, extra: Partial<PriceRule> = {}): PriceRule & { id: string } =>
  rule(id, areaId, { model: "charter_area_surcharge", pickupSurchargeMinor: pickup, dropoffSurchargeMinor: dropoff, ...(waypoint === undefined ? {} : { waypointSurchargeMinor: waypoint }) }, extra);
const RULES = [pkg, surcharge("s-fuji", "fuji", 10_000, 10_000, 10_000), surcharge("s-kama", "kamakura", 6_000, 6_000, 6_000), surcharge("s-hakone", "hakone", 8_000, 8_000, 8_000)];

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
  surchargeAreas: [FUJI, KAMAKURA, HAKONE],
  vehicleGroups: [{ vehicleGroupId: "eco7", passengers: 6, luggage: 4, active: true }],
  serviceRules: { ...emptyServiceRules(), booking: { saleFrom: null, saleTo: null, serviceTime: { start: "00:00", end: "24:00" }, leadTimeHours: 24, note: null }, freeWait: { pickup: null, dropoff: null, general: { mode: "limited", minutes: 0 } } },
  addonCatalog: [],
  priceRules: RULES,
  adjustRules: [],
  inventoryMode: "unlimited",
  ...extra,
});
const trip = (pickup: Place, waypoints: Place[] | undefined, dropoff: Place, extra: Partial<QuoteRequest> = {}): QuoteRequest => ({
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
  ...(waypoints === undefined ? {} : { waypoints: waypoints.map((place) => P[place]) }),
  ...extra,
});
const moment: QuoteMoment = { now: new Date("2026-10-07T01:00:00Z"), route: null, inventoryDay: null, urgentUsed: 0 };

function quoted(request: QuoteRequest, item: QuoteProduct = product()) {
  return quoteProduct(item, request, moment);
}
/** 结算价、客人价（加价 10%）或原因 */
function prices(request: QuoteRequest, item: QuoteProduct = product()): [number, number] | string {
  const quote = quoted(request, item);
  if (!quote.ok) return quote.reason;
  const offer = quote.offers[0];
  if (offer === undefined) return quote.refused[0]?.reason ?? "NONE";
  const comparison = compareQuotes({ request, currency: "JPY", now: moment.now, entries: [{ quote, productVersion: 1, standing: { scoreCenti: null, completedOrders: 0, observation: false }, markupBp: () => 1_000, fx: null }] });
  return [offer.settlement.totalMinor, comparison.groups[0]?.snapshot.winner.sell.sellMinor ?? -1];
}
function settlement(request: QuoteRequest, item: QuoteProduct = product()) {
  const quote = quoted(request, item);
  assert.ok(quote.ok && quote.offers.length === 1, JSON.stringify(quote));
  return (quote.offers[0] as (typeof quote.offers)[number]).settlement;
}

// ---- 13.4 的 5 个算例（结算价 / 客人价） ----

test("13.4 算例 1：新宿 → 五合目 → 河口湖 → 忠灵塔 → 新宿 = 55,000 + 富士山 10,000（3 个点只算 1 次）= 65,000，客人 71,500", () => {
  const request = trip("shinjuku", ["gogome", "kawaguchiko", "chureito"], "shinjuku");
  assert.deepEqual(prices(request), [65_000, 71_500]);
  assert.deepEqual(settlement(request).areaSurcharge, {
    packageMinor: 55_000,
    pickup: { areaId: null, priceRuleId: null, amountMinor: 0 },
    dropoff: { areaId: null, priceRuleId: null, amountMinor: 0 },
    waypoints: [{ areaId: "fuji", priceRuleId: "s-fuji", amountMinor: 10_000, stopSeqs: [1, 2, 3] }],
  });
});

test("13.4 算例 2：新宿 → 鹤冈八幡宫 → 镰仓大佛 → 新宿 = 55,000 + 镰仓 6,000 = 61,000，客人 67,100", () => {
  assert.deepEqual(prices(trip("shinjuku", ["tsurugaoka", "daibutsu"], "shinjuku")), [61_000, 67_100]);
});

test("13.4 算例 3：新宿 → 镰仓大佛 → 河口湖 → 新宿 = 55,000 + 6,000 + 10,000 = 71,000，客人 78,100", () => {
  const request = trip("shinjuku", ["daibutsu", "kawaguchiko"], "shinjuku");
  assert.deepEqual(prices(request), [71_000, 78_100]);
  assert.deepEqual(settlement(request).areaSurcharge?.waypoints, [
    { areaId: "kamakura", priceRuleId: "s-kama", amountMinor: 6_000, stopSeqs: [1] },
    { areaId: "fuji", priceRuleId: "s-fuji", amountMinor: 10_000, stopSeqs: [2] },
  ]);
});

test("13.4 算例 4：新宿 → 五合目 → 河口湖站（下车）= 55,000 + 下车加价 10,000 = 65,000，客人 71,500（下车已在富士山，途经不再加）", () => {
  const request = trip("shinjuku", ["gogome"], "kawaguchikoStation");
  assert.deepEqual(prices(request), [65_000, 71_500]);
  const s = settlement(request).areaSurcharge;
  assert.deepEqual([s?.dropoff, s?.waypoints], [{ areaId: "fuji", priceRuleId: "s-fuji", amountMinor: 10_000 }, []]);
});

test("13.4 算例 5：新宿 → 浅草 → 新宿 = 55,000，客人 60,500（都在服务区域）", () => {
  assert.deepEqual(prices(trip("shinjuku", ["asakusa"], "shinjuku")), [55_000, 60_500]);
  assert.deepEqual(settlement(trip("shinjuku", ["asakusa"], "shinjuku")).areaSurcharge?.waypoints, []);
});

// ---- 13.9 的 8 条验收用例（第 8 条按「取消重下」：去掉一个途经区域重新报价，差额就是那个区域的途经加价） ----

test("13.9 用例 1：3 个途经点都在富士山 → 只加 1 次", () => {
  assert.deepEqual(prices(trip("shinjuku", ["gogome", "kawaguchiko", "chureito"], "shinjuku")), [65_000, 71_500]);
});

test("13.9 用例 2：途经镰仓 + 富士山 → 两个区域各加 1 次", () => {
  assert.deepEqual(prices(trip("shinjuku", ["tsurugaoka", "gogome", "daibutsu", "chureito"], "shinjuku")), [71_000, 78_100]);
});

test("13.9 用例 3：下车在富士山、途经也在富士山 → 只加下车加价", () => {
  assert.deepEqual(prices(trip("shinjuku", ["gogome", "chureito"], "kawaguchikoStation")), [65_000, 71_500]);
  // 上车在富士山也一样
  assert.deepEqual(prices(trip("kawaguchikoStation", ["gogome"], "shinjuku")), [65_000, 71_500]);
});

test("13.9 用例 4：途经点在东京市内 → 不加价", () => {
  assert.deepEqual(prices(trip("shinjuku", ["asakusa", "shinjuku"], "shinjuku")), [55_000, 60_500]);
});

test("13.9 用例 5：途经点不在任何区域 → 不出在线价（WAYPOINT_NOT_PRICED），指出是第几个经停点", () => {
  const quote = quoted(trip("shinjuku", ["gogome", "sendai"], "shinjuku"));
  assert.ok(quote.ok);
  assert.deepEqual([quote.offers, quote.refused], [[], [{ vehicleGroupId: "eco7", reason: "WAYPOINT_NOT_PRICED", stopSeq: 2 }]]);
  assert.ok(QUOTE_REFUSALS.includes("WAYPOINT_NOT_PRICED"));
});

test("13.9 用例 6：一个点落在两个重叠区域 → 只按途经加价最高的那个收 1 次", () => {
  const request = trip("shinjuku", ["fujiHakone"], "shinjuku");
  assert.deepEqual(prices(request), [65_000, 71_500]);
  assert.deepEqual(settlement(request).areaSurcharge?.waypoints, [{ areaId: "fuji", priceRuleId: "s-fuji", amountMinor: 10_000, stopSeqs: [1] }]);
  // 箱根更高时归箱根
  const hakoneHigher = product({ priceRules: [pkg, surcharge("s-fuji", "fuji", 10_000, 10_000, 10_000), surcharge("s-hakone", "hakone", 8_000, 8_000, 12_000)] });
  assert.deepEqual(prices(request, hakoneHigher), [67_000, 73_700]);
  // 同一区域只一次：重叠点归了富士山，再途经富士山不再加；再途经箱根另加箱根
  assert.deepEqual(prices(trip("shinjuku", ["fujiHakone", "gogome", "hakone"], "shinjuku")), [73_000, 80_300]);
});

test("13.9 用例 7：不填途经点 → 报价与现在完全一致（不给、给空数组都一样，明细里没有 waypoints）", () => {
  for (const [pickup, dropoff] of [["shinjuku", "shinjuku"], ["shinjuku", "kawaguchikoStation"], ["daibutsu", "gogome"]] as const) {
    const before = quoted(trip(pickup, undefined, dropoff));
    assert.deepEqual(quoted(trip(pickup, [], dropoff)), before);
    assert.ok(before.ok && before.offers[0] !== undefined);
    assert.equal("waypoints" in (before.offers[0].settlement.areaSurcharge ?? {}), false);
  }
});

test("13.9 用例 8（按取消重下）：去掉一个途经区域重新报价，新价少了那个区域的途经加价", () => {
  const [withBoth] = prices(trip("shinjuku", ["daibutsu", "kawaguchiko"], "shinjuku")) as [number, number];
  const [fujiOnly] = prices(trip("shinjuku", ["kawaguchiko"], "shinjuku")) as [number, number];
  assert.equal(withBoth - fujiOnly, 6_000);
});

// ---- 边界（ADR 0088 第 3 节） ----

test("规则：途经加价没设 = 这个区域对经停点没有规则（不当 0）；在商品区域外就报不出，原因沿用上 / 下车口径", () => {
  const unset = product({ priceRules: [pkg, surcharge("s-fuji", "fuji", 10_000, 10_000, undefined), surcharge("s-kama", "kamakura", 6_000, 6_000, 6_000)] });
  assert.equal(prices(trip("shinjuku", ["gogome"], "shinjuku"), unset), "NO_PRICE_RULE");
  // 上 / 下车照常
  assert.deepEqual(prices(trip("shinjuku", undefined, "gogome"), unset), [65_000, 71_500]);
  // 明填 0：能报、不加钱，明细里列出这个区域（0）
  const zero = product({ priceRules: [pkg, surcharge("s-fuji", "fuji", 10_000, 10_000, 0)] });
  assert.deepEqual(prices(trip("shinjuku", ["gogome"], "shinjuku"), zero), [55_000, 60_500]);
  assert.deepEqual(settlement(trip("shinjuku", ["gogome"], "shinjuku"), zero).areaSurcharge?.waypoints, [{ areaId: "fuji", priceRuleId: "s-fuji", amountMinor: 0, stopSeqs: [1] }]);
  // 停用、未生效（富士山另有一条启用的 8 小时规则，所以还算挂着；同上 / 下车的口径）
  const fuji8 = surcharge("s-fuji-8", "fuji", 1, 1, 1, { packageHours: 8 });
  const disabled = product({ priceRules: [pkg, fuji8, surcharge("s-fuji", "fuji", 1, 1, 10_000, { status: "disabled" })] });
  assert.equal(prices(trip("shinjuku", ["gogome"], "shinjuku"), disabled), "PRICE_RULE_DISABLED");
  // 区域只有停用的规则：不算挂着，经停点哪里都不在
  assert.equal(prices(trip("shinjuku", ["gogome"], "shinjuku"), product({ priceRules: [pkg, surcharge("s-fuji", "fuji", 1, 1, 10_000, { status: "disabled" })] })), "WAYPOINT_NOT_PRICED");
  const later = product({ priceRules: [pkg, fuji8, surcharge("s-fuji", "fuji", 1, 1, 10_000, { validFrom: "2027-01-01" })] });
  assert.equal(prices(trip("shinjuku", ["gogome"], "shinjuku"), later), "PRICE_NOT_IN_EFFECT");
  // 重叠区域里一个没设、一个设了：用设了的
  const partly = product({ priceRules: [pkg, surcharge("s-fuji", "fuji", 10_000, 10_000, undefined), surcharge("s-hakone", "hakone", 8_000, 8_000, 8_000)] });
  assert.deepEqual(prices(trip("shinjuku", ["fujiHakone"], "shinjuku"), partly), [63_000, 69_300]);
});

test("规则：经停点同时在商品区域和有途经规则的加价区域里 → 按 M8-38 收加价区域的；加价区域没有可用途经规则 → 在商品区域里不加", () => {
  const bigTokyo = area("tokyo", square(138.5, 35.1, 139.95, 35.85));
  assert.deepEqual(prices(trip("shinjuku", ["gogome"], "shinjuku"), product({ areas: [bigTokyo] })), [65_000, 71_500]);
  const unset = product({ areas: [bigTokyo], priceRules: [pkg, surcharge("s-fuji", "fuji", 10_000, 10_000, undefined)] });
  assert.deepEqual(prices(trip("shinjuku", ["gogome"], "shinjuku"), unset), [55_000, 60_500]);
  assert.deepEqual(settlement(trip("shinjuku", ["gogome"], "shinjuku"), unset).areaSurcharge?.waypoints, []);
});

test("规则：「已计价」只认上 / 下车最终选中的区域；选中的加价是 0 也算（待确认第 2 条）；那一端只在商品区域里就没有已计价区域", () => {
  const zeroDrop = product({ priceRules: [pkg, surcharge("s-fuji", "fuji", 10_000, 0, 10_000)] });
  assert.deepEqual(prices(trip("shinjuku", ["gogome"], "kawaguchikoStation"), zeroDrop), [55_000, 60_500]);
  // 下车点落在富士山 / 箱根重叠处，下车选中的是箱根（下车加价更高）：途经富士山照收
  const hakoneDrop = product({ priceRules: [pkg, surcharge("s-fuji", "fuji", 10_000, 1_000, 10_000), surcharge("s-hakone", "hakone", 8_000, 8_000, 8_000)] });
  assert.deepEqual(prices(trip("shinjuku", ["gogome"], "fujiHakone"), hakoneDrop), [73_000, 80_300]);
});

test("调价作用在「套餐 + 上下车加价 + 途经加价」的合计上；加急另加；结算价明细各项之和仍等于总价", () => {
  const adjusted = product({ adjustRules: [{ id: "peak", name: "旺季 +10%", travelFrom: null, travelTo: null, cycle: { type: "daily" }, timeSlot: null, areaIds: [], vehicleGroupIds: [], directions: [], packageHours: [], steps: [{ type: "percent", value: 1_000 }], status: "enabled" }] });
  const s = settlement(trip("shinjuku", ["gogome", "daibutsu"], "shinjuku"), adjusted);
  assert.deepEqual([s.totalMinor, s.baseMinor, s.adjustMinor, s.areaSurcharge?.packageMinor], [78_100, 71_000, 7_100, 55_000]);
  assert.equal(s.baseMinor + s.adjustMinor + s.urgentMinor + s.nightMinor + s.addonsMinor + s.driverLanguageMinor, s.totalMinor);
});

test("经停点过运营 / 禁行判断：落在商品报价区域的禁行区 → 整个商品不报；落在运营区域的禁行区 → 不报；不在运营范围 → WAYPOINT_NOT_PRICED", () => {
  const forbidTokyo: QuoteArea = { ...TOKYO, shapes: [...TOKYO.shapes, { id: "tokyo-no", kind: "forbid", ring: square(139.78, 35.7, 139.82, 35.72) }] };
  assert.equal(prices(trip("shinjuku", ["asakusa"], "shinjuku"), product({ areas: [forbidTokyo] })), "IN_FORBIDDEN_AREA");
  const operating = [area("op", square(138.0, 35.0, 140.5, 36.5), { role: "both" }), { ...area("op-only", square(139.79, 35.7, 139.81, 35.72), { role: "operating" }), shapes: [{ id: "op-only-op", kind: "operate", ring: square(139.79, 35.7, 139.81, 35.72) }, { id: "op-only-no", kind: "forbid", ring: square(139.79, 35.7, 139.81, 35.72) }] } satisfies QuoteArea];
  assert.equal(prices(trip("shinjuku", ["asakusa"], "shinjuku"), product({ operatingAreas: operating })), "IN_FORBIDDEN_AREA");
  const quote = quoted(trip("shinjuku", ["gogome", "kawaguchiko", "sendai"], "shinjuku"), product({ operatingAreas: [area("op", square(138.0, 35.0, 140.5, 36.5), { role: "both" })] }));
  assert.ok(quote.ok);
  assert.deepEqual(quote.refused, [{ vehicleGroupId: "eco7", reason: "WAYPOINT_NOT_PRICED", stopSeq: 3 }]);
  // 只落在加价区域的禁行区里、哪里都不在：同上 / 下车那一端
  const forbidKama: QuoteArea = { ...KAMAKURA, shapes: [{ id: "kama-no", kind: "forbid", ring: square(139.5, 35.28, 139.6, 35.36) }] };
  assert.equal(prices(trip("shinjuku", ["daibutsu"], "shinjuku"), product({ surchargeAreas: [FUJI, forbidKama, HAKONE] })), "IN_FORBIDDEN_AREA");
});

test("请求校验：经停点只有包车能给、最多 10 个、给了就要有下车点；没下车点的引擎也不报（DROPOFF_REQUIRED）", () => {
  const ten = Array.from({ length: 10 }, () => P.gogome);
  assert.deepEqual(quoteRequestIssues({ ...trip("shinjuku", undefined, "shinjuku"), waypoints: ten }), []);
  assert.deepEqual(quoteRequestIssues({ ...trip("shinjuku", undefined, "shinjuku"), waypoints: [...ten, P.gogome] }), [{ path: "/waypoints", reason: "OUT_OF_RANGE" }]);
  assert.deepEqual(quoteRequestIssues({ ...trip("shinjuku", ["gogome"], "shinjuku"), dropoff: null }), [{ path: "/dropoff", reason: "REQUIRED" }]);
  assert.deepEqual(quoteRequestIssues({ ...trip("shinjuku", ["gogome"], "shinjuku"), category: "point_to_point", packageHours: null }), [{ path: "/waypoints", reason: "NOT_APPLICABLE" }]);
  assert.equal(prices({ ...trip("shinjuku", ["gogome"], "shinjuku"), dropoff: null }, product({ priceRules: [pkg], surchargeAreas: [] })), "DROPOFF_REQUIRED");
});

test("价格规则：途经加价可选，≥ 0、上限同上 / 下车加价；areaSurchargeFor 的经停点端只认设了途经加价的规则", () => {
  assert.deepEqual(priceRuleIssues(surcharge("x", "fuji", 0, 0, 0), { category: "charter" }), []);
  assert.deepEqual(priceRuleIssues(surcharge("x", "fuji", 0, 0, undefined), { category: "charter" }), []);
  assert.deepEqual(priceRuleIssues(surcharge("x", "fuji", 0, 0, -1), { category: "charter" }), [{ path: "/waypoint_surcharge", reason: "OUT_OF_RANGE", detail: { min: 0, max: 1_000_000_000 } }]);
  assert.deepEqual(priceRuleIssues(surcharge("x", "fuji", 0, 0, 1.5), { category: "charter" }), [{ path: "/waypoint_surcharge", reason: "NOT_INTEGER" }]);
  const rules = [surcharge("a", "fuji", 1, 1, undefined), surcharge("b", "hakone", 1, 1, 300)];
  const query = { vehicleGroupId: "eco7", packageHours: 10, date: "2026-10-20", prefer: "highest" as const };
  assert.deepEqual(areaSurchargeFor(rules, { ...query, areaIds: ["fuji", "hakone"], end: "waypoint" }), { rule: rules[1], areaId: "hakone", amountMinor: 300, noPriceReason: null });
  assert.equal(areaSurchargeFor(rules, { ...query, areaIds: ["fuji"], end: "waypoint" }).noPriceReason, "NO_RULE");
  assert.equal(areaSurchargeFor(rules, { ...query, areaIds: ["fuji"], end: "pickup" }).areaId, "fuji", "上 / 下车不受影响");
});

test("对外价明细（price_breakdown）：各项按这一单的汇率、缓冲、加价比例换算，套餐倒算，各项之和等于对外价；跨币种也成立", () => {
  const request = trip("daibutsu", ["gogome", "hakone"], "kawaguchikoStation", { serviceLocal: "2026-10-07T15:00" });
  const urgent = product({ serviceRules: { ...product().serviceRules, urgent: { enabled: true, dailyQuota: null, tiers: [{ withinHours: 12, surchargeMinor: 2_000 }] } }, adjustRules: [{ id: "x", name: "x", travelFrom: null, travelTo: null, cycle: { type: "daily" }, timeSlot: null, areaIds: [], vehicleGroupIds: [], directions: [], packageHours: [], steps: [{ type: "percent", value: 333 }], status: "enabled" }] });
  const quote = quoted(request, urgent);
  for (const [currency, fx] of [["JPY", null], ["USD", { from: "JPY", to: "USD", rate: "0.0067", asOf: "2026-10-07T00:00:00Z" }]] as const) {
    const comparison = compareQuotes({ request, currency, now: moment.now, entries: [{ quote, productVersion: 1, standing: { scoreCenti: null, completedOrders: 0, observation: false }, markupBp: () => 1_000, fx }] });
    const winner = comparison.groups[0]?.snapshot.winner;
    assert.ok(winner !== undefined);
    const items = sellBreakdown(winner.offer.settlement, winner.sell);
    assert.deepEqual(items.map((item) => item.kind), ["base", "pickup", "dropoff", "waypoint", "adjust", "other"]);
    assert.equal(items.reduce((sum, item) => sum + item.amountMinor, 0), winner.sell.sellMinor, currency);
    assert.ok(items.every((item) => Number.isSafeInteger(item.amountMinor)));
    // 快照的请求里带着经停点（锁定）
    assert.deepEqual(comparison.groups[0]?.snapshot.request.waypoints, [P.gogome, P.hakone]);
  }
  // 同币种：上车镰仓 6,000 → 6,600；下车富士山 10,000 → 11,000；途经箱根 8,000 → 8,800
  const comparison = compareQuotes({ request, currency: "JPY", now: moment.now, entries: [{ quote, productVersion: 1, standing: { scoreCenti: null, completedOrders: 0, observation: false }, markupBp: () => 1_000, fx: null }] });
  const winner = comparison.groups[0]?.snapshot.winner;
  assert.ok(winner !== undefined);
  assert.deepEqual(sellBreakdown(winner.offer.settlement, winner.sell).slice(1, 4), [
    { kind: "pickup", areaId: "kamakura", amountMinor: 6_600 },
    { kind: "dropoff", areaId: "fuji", amountMinor: 11_000 },
    { kind: "waypoint", areaId: "hakone", stopSeqs: [2], amountMinor: 8_800 },
  ]);
  // 没有加价区域的报价只有一项基础价（= 对外价）
  const plain = quoted(trip("shinjuku", undefined, "shinjuku"), product({ priceRules: [pkg], surchargeAreas: [] }));
  const plainWinner = compareQuotes({ request: trip("shinjuku", undefined, "shinjuku"), currency: "JPY", now: moment.now, entries: [{ quote: plain, productVersion: 1, standing: { scoreCenti: null, completedOrders: 0, observation: false }, markupBp: () => 1_000, fx: null }] }).groups[0]?.snapshot.winner;
  assert.ok(plainWinner !== undefined);
  assert.deepEqual(sellBreakdown(plainWinner.offer.settlement, plainWinner.sell), [{ kind: "base", areaId: null, amountMinor: 60_500 }]);
});
