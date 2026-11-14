/**
 * M9P-01：业主《包车报价逻辑规格（开发版）》2026-11-14（docs/requirements/charter-pricing-spec-2026-11-14.md）第六节验收用例里的加价部分，
 * 和第一节四个标准场景（ADR 0093 第二节）。
 *
 * 数据按规格：东京包车、经济 7 座；①东京市内（含羽田）；富士山、箱根 10,000，镰仓 8,000（结算价）；套餐 4h 28,000、5h 33,000、10h 55,000；
 * 前台价 = 结算价 × 1.1。M9P-05 迁移之前没有②表，行程加价取③行里的途经加价（ADR 0093 第一节、第二节第 4 小节），所以每个景区一行，三格同值。
 * 套餐按规格表里的时长直接给（自动选套餐是 M9P-03）；全程公里不超套餐。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Position } from "./areas.ts";
import type { LatLng } from "./geo.ts";
import type { PriceRule } from "./pricing.ts";
import { DEFAULT_CHARTER_ITINERARY, charterItineraryOf, emptyServiceRules, normalizeServiceRules, serviceRuleIssues } from "./products.ts";
import { type QuoteArea, type QuoteMoment, type QuoteProduct, type QuoteRequest, compareQuotes, quoteProduct, sellBreakdown } from "./quote.ts";

const square = (west: number, south: number, east: number, north: number): Position[] => [[west, south], [east, south], [east, north], [west, north], [west, south]];
const area = (areaId: string, ring: Position[]): QuoteArea => ({ areaId, active: true, shapes: [{ id: `${areaId}-op`, kind: "operate", ring }] });

/** ①东京市内（包住羽田） */
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
  oshino: { lng: 138.8325, lat: 35.4606 },
  ashinoko: { lng: 139.025, lat: 35.205 },
  tsurugaoka: { lng: 139.5565, lat: 35.3259 },
  hasedera: { lng: 139.5337, lat: 35.3125 },
  kamakuraStation: { lng: 139.5503, lat: 35.319 },
} satisfies Record<string, LatLng>;
type Place = keyof typeof P;

const HOURS = [4, 5, 10] as const;
const PACKAGE: Record<(typeof HOURS)[number], number> = { 4: 28_000, 5: 33_000, 10: 55_000 };
const SURCHARGE = { fuji: 10_000, hakone: 10_000, kamakura: 8_000 } as const;
const rule = (id: string, areaId: string, packageHours: number, pricing: PriceRule["pricing"]): PriceRule & { id: string } => ({ id, areaId, vehicleGroupId: "eco7", direction: null, packageHours, pricing, validFrom: "2026-01-01", validTo: null, status: "enabled" });
const RULES = HOURS.flatMap((hours) => [
  rule(`p-${hours}`, "tokyo", hours, { model: "charter_package", packageKm: 300, packagePriceMinor: PACKAGE[hours], overtimePerHourMinor: 5_000, overKmPerKmMinor: 500 }),
  ...Object.entries(SURCHARGE).map(([areaId, amount]) => rule(`s-${areaId}-${hours}`, areaId, hours, { model: "charter_area_surcharge", pickupSurchargeMinor: amount, dropoffSurchargeMinor: amount, waypointSurchargeMinor: amount })),
]);

const product = (dropoffItinerarySurcharge?: boolean): QuoteProduct => ({
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
    ...(dropoffItinerarySurcharge === undefined ? {} : { charterItinerary: { dropoffItinerarySurcharge } }),
  },
  addonCatalog: [],
  priceRules: RULES,
  adjustRules: [],
  inventoryMode: "unlimited",
});
const trip = (pickup: Place, waypoints: Place[], dropoff: Place, packageHours: number): QuoteRequest => ({
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
});
const moment: QuoteMoment = { now: new Date("2026-11-14T01:00:00Z"), route: null, inventoryDay: null, urgentUsed: 0 };

/** 结算价、前台价（× 1.1）和加价明细（上车 / 下车 / 行程，区域和金额） */
function quoted(request: QuoteRequest, item: QuoteProduct = product()) {
  const quote = quoteProduct(item, request, moment);
  assert.ok(quote.ok && quote.offers.length === 1, JSON.stringify(quote));
  const offer = quote.offers[0] as (typeof quote.offers)[number];
  const winner = compareQuotes({ request, currency: "JPY", now: moment.now, entries: [{ quote, productVersion: 1, standing: { scoreCenti: null, completedOrders: 0, observation: false }, markupBp: () => 1_000, fx: null }] }).groups[0]?.snapshot.winner;
  assert.ok(winner !== undefined);
  const s = offer.settlement.areaSurcharge;
  const surcharges = [
    ...(s?.pickup.areaId == null ? [] : [`上车 ${s.pickup.areaId} ${s.pickup.amountMinor}`]),
    ...(s?.dropoff.areaId == null ? [] : [`下车 ${s.dropoff.areaId} ${s.dropoff.amountMinor}`]),
    ...(s?.waypoints ?? []).map((entry) => `行程 ${entry.areaId} ${entry.amountMinor}${entry.fromDropoff === true ? "（下车点）" : ` @${entry.stopSeqs.join(",")}`}`),
  ];
  return { settlement: offer.settlement.totalMinor, sell: winner.sell.sellMinor, surcharges, winner };
}

const CASES: [number, string, Place, Place[], Place, number, string[], number, number][] = [
  [1, "新宿 → 浅草 → 新宿", "shinjuku", ["asakusa"], "shinjuku", 4, [], 28_000, 30_800],
  [2, "新宿 → 河口湖 → 新宿", "shinjuku", ["kawaguchiko"], "shinjuku", 10, ["行程 fuji 10000 @1"], 65_000, 71_500],
  [3, "新宿 → 河口湖 → 河口湖站下车（P0 #1）", "shinjuku", ["kawaguchiko"], "kawaguchikoStation", 10, ["下车 fuji 10000", "行程 fuji 10000 @1"], 75_000, 82_500],
  [4, "河口湖上车 → 忍野八海 → 河口湖下车", "kawaguchiko", ["oshino"], "kawaguchiko", 10, ["上车 fuji 10000", "下车 fuji 10000", "行程 fuji 10000 @1"], 85_000, 93_500],
  [5, "河口湖上车 → 芦之湖 → 河口湖下车（不收富士山行程）", "kawaguchiko", ["ashinoko"], "kawaguchiko", 10, ["上车 fuji 10000", "下车 fuji 10000", "行程 hakone 10000 @1"], 85_000, 93_500],
  [6, "新宿 → 河口湖 → 芦之湖 → 新宿", "shinjuku", ["kawaguchiko", "ashinoko"], "shinjuku", 10, ["行程 fuji 10000 @1", "行程 hakone 10000 @2"], 75_000, 82_500],
  [7, "新宿 → 鹤冈八幡宫 → 长谷寺 → 新宿（两个经停只收一次）", "shinjuku", ["tsurugaoka", "hasedera"], "shinjuku", 5, ["行程 kamakura 8000 @1,2"], 41_000, 45_100],
  [8, "镰仓站上车 → 浅草 → 新宿下车", "kamakuraStation", ["asakusa"], "shinjuku", 5, ["上车 kamakura 8000"], 41_000, 45_100],
  [9, "羽田 T3 上车 → 浅草 → 新宿（羽田在基础价区域）", "hanedaT3", ["asakusa"], "shinjuku", 5, [], 33_000, 36_300],
  [16, "新宿 → 河口湖站下车（不填经停点）", "shinjuku", [], "kawaguchikoStation", 10, ["下车 fuji 10000", "行程 fuji 10000（下车点）"], 75_000, 82_500],
  [17, "新宿 → 浅草 → 河口湖站下车（浅草在基础价区域，不算市外经停）", "shinjuku", ["asakusa"], "kawaguchikoStation", 10, ["下车 fuji 10000", "行程 fuji 10000（下车点）"], 75_000, 82_500],
  [18, "河口湖上车 → 新宿下车（不填经停点，不看上车点）", "kawaguchiko", [], "shinjuku", 10, ["上车 fuji 10000"], 65_000, 71_500],
];

for (const [no, name, pickup, waypoints, dropoff, hours, surcharges, settlement, sell] of CASES) {
  test(`规格第六节用例 ${no}：${name} → ${hours}h，结算 ${settlement}、前台 ${sell}`, () => {
    const result = quoted(trip(pickup, waypoints, dropoff, hours));
    assert.deepEqual([result.surcharges, result.settlement, result.sell], [surcharges, settlement, sell]);
  });
}

test("规格第六节用例 19：同 16，但商品关闭下车点行程加价 → 只收富士山下车 10,000，结算 65,000、前台 71,500；明细里没有行程加价", () => {
  const result = quoted(trip("shinjuku", [], "kawaguchikoStation", 10), product(false));
  assert.deepEqual([result.surcharges, result.settlement, result.sell], [["下车 fuji 10000"], 65_000, 71_500]);
  assert.equal("waypoints" in (result.winner.offer.settlement.areaSurcharge ?? {}), false, "和 M9P-01 之前一模一样");
  // 关了只影响下车点行程加价：真实经停照收（用例 3）
  assert.deepEqual(quoted(trip("shinjuku", ["kawaguchiko"], "kawaguchikoStation", 10), product(false)).settlement, 75_000);
  // 显式开（true）和不设一样
  assert.deepEqual(quoted(trip("shinjuku", [], "kawaguchikoStation", 10), product(true)).settlement, 75_000);
});

test("第一节四个标准场景（10h，加价合计）：东京往返富士山 10,000；东京上车 → 富士山下车 20,000；富士山上 → 富士山游玩 → 富士山下 30,000；富士山上 → 箱根游玩 → 富士山下 30,000", () => {
  const extra = (request: QuoteRequest): number => quoted(request).settlement - PACKAGE[10];
  assert.deepEqual(
    [
      extra(trip("shinjuku", ["kawaguchiko"], "shinjuku", 10)),
      extra(trip("shinjuku", [], "kawaguchikoStation", 10)),
      extra(trip("kawaguchikoStation", ["oshino"], "kawaguchiko", 10)),
      extra(trip("kawaguchikoStation", ["ashinoko"], "kawaguchiko", 10)),
    ],
    [10_000, 20_000, 30_000, 30_000],
  );
});

test("下车点行程加价的边界：有市外经停就不再按下车点收；下车点所在区域已经因经停收过就不重复；下车点在基础价区域不收；下车点所在加价区域没设途经加价时跳过、不拒", () => {
  // 市外经停在箱根、下车在富士山：只收箱根行程 + 富士山下车（下车点不算经停）
  assert.deepEqual(quoted(trip("shinjuku", ["ashinoko"], "kawaguchikoStation", 10)).surcharges, ["下车 fuji 10000", "行程 hakone 10000 @1"]);
  // 经停在富士山、下车也在富士山：富士山只收一次行程
  assert.deepEqual(quoted(trip("shinjuku", ["oshino"], "kawaguchikoStation", 10)).surcharges, ["下车 fuji 10000", "行程 fuji 10000 @1"]);
  // 下车在羽田（基础价区域）：不收
  assert.deepEqual(quoted(trip("kawaguchiko", [], "hanedaT3", 10)).surcharges, ["上车 fuji 10000"]);
  // 镰仓同时是①（ADR 0093 第二节第 4 小节：同时在①和②里算①内）：
  // - 下车点在①里不触发——M9P-06 之前下车加价照 M8-38 收镰仓的，但不再加行程加价；
  // - 经停在①∩镰仓里：M9P-06 之前照现行规则收镰仓途经加价、进已收区域，下车点（富士山）不再触发，不会多收
  const kamakuraBase = product();
  kamakuraBase.areas = [TOKYO, area("kamakura-base", square(139.5, 35.28, 139.6, 35.35))];
  assert.deepEqual(quoted(trip("shinjuku", [], "kamakuraStation", 5), kamakuraBase).surcharges, ["下车 kamakura 8000"]);
  assert.deepEqual(quoted(trip("shinjuku", ["tsurugaoka"], "kawaguchikoStation", 10), kamakuraBase).surcharges, ["下车 fuji 10000", "行程 kamakura 8000 @1"]);
  // ①∩③里的经停 + 同一个③里下车（如羽田∩横滨经停、横滨下车）：M9P-06 之前经停照收途经加价、进已收区域，下车点不再触发——这个区域只收一次行程加价
  const partBase = product();
  partBase.areas = [TOKYO, area("kamakura-north", square(139.55, 35.32, 139.6, 35.35))];
  assert.deepEqual(quoted(trip("shinjuku", ["tsurugaoka"], "hasedera", 5), partBase).surcharges, ["下车 kamakura 8000", "行程 kamakura 8000 @1"]);
  // 下车点落在两个设了途经加价的加价区域的重叠处（过渡期）：取最高
  const overlapped = product();
  overlapped.surchargeAreas = [FUJI, HAKONE, KAMAKURA, area("fuji-lake", square(138.7, 35.45, 138.8, 35.55))];
  overlapped.priceRules = [...RULES, rule("s-lake-10", "fuji-lake", 10, { model: "charter_area_surcharge", pickupSurchargeMinor: 3_000, dropoffSurchargeMinor: 3_000, waypointSurchargeMinor: 12_000 })];
  assert.deepEqual(quoted(trip("shinjuku", [], "kawaguchikoStation", 10), overlapped).surcharges, ["下车 fuji 10000", "行程 fuji-lake 12000（下车点）"]);
  // 迁移前：富士山那一行没设途经加价 → 下车点行程加价跳过、照常报价（真实经停点在这里仍报不出，M9W-10）
  const noWaypoint = product();
  noWaypoint.priceRules = RULES.map((entry) => (entry.areaId === "fuji" && entry.pricing.model === "charter_area_surcharge" ? { ...entry, pricing: { model: "charter_area_surcharge", pickupSurchargeMinor: 10_000, dropoffSurchargeMinor: 10_000 } } : entry));
  assert.deepEqual(quoted(trip("shinjuku", [], "kawaguchikoStation", 10), noWaypoint).surcharges, ["下车 fuji 10000"]);
  const refused = quoteProduct(noWaypoint, trip("shinjuku", ["kawaguchiko"], "shinjuku", 10), moment);
  assert.ok(refused.ok);
  assert.deepEqual(refused.refused, [{ vehicleGroupId: "eco7", reason: "NO_PRICE_RULE", stopSeq: 1 }]);
  // 停用、不在生效期同样跳过
  for (const patch of [{ status: "disabled" as const }, { validFrom: "2027-01-01" }]) {
    const item = product();
    item.priceRules = [...RULES.filter((entry) => !(entry.areaId === "fuji" && entry.packageHours === 10)), { ...(RULES.find((entry) => entry.id === "s-fuji-10") as PriceRule & { id: string }), id: "s-fuji-10-dropoff", pricing: { model: "charter_area_surcharge", pickupSurchargeMinor: 10_000, dropoffSurchargeMinor: 10_000 } }, { ...(RULES.find((entry) => entry.id === "s-fuji-10") as PriceRule & { id: string }), id: "s-fuji-10-waypoint", pricing: { model: "charter_area_surcharge", pickupSurchargeMinor: 0, dropoffSurchargeMinor: 0, waypointSurchargeMinor: 10_000 }, ...patch }];
    assert.deepEqual(quoted(trip("shinjuku", [], "kawaguchikoStation", 10), item).surcharges, ["下车 fuji 10000"], JSON.stringify(patch));
  }
});

test("对外价明细：下车点行程加价是一项 waypoint，带 fromDropoff、stopSeqs 为空；各项之和等于对外价", () => {
  const { winner } = quoted(trip("shinjuku", [], "kawaguchikoStation", 10));
  const items = sellBreakdown(winner.offer.settlement, winner.sell);
  assert.deepEqual(items, [
    { kind: "base", areaId: null, amountMinor: 60_500 },
    { kind: "waypoint", areaId: "fuji", stopSeqs: [], fromDropoff: true, amountMinor: 11_000 },
    { kind: "dropoff", areaId: "fuji", amountMinor: 11_000 },
  ]);
  assert.equal(items.reduce((sum, item) => sum + item.amountMinor, 0), winner.sell.sellMinor);
  assert.deepEqual(winner.offer.settlement.areaSurcharge?.waypoints, [{ areaId: "fuji", priceRuleId: "s-fuji-10", amountMinor: 10_000, stopSeqs: [], fromDropoff: true }]);
});

test("服务规则：下车点行程加价默认开、不存键；关掉才存；只有包车能设", () => {
  assert.deepEqual(DEFAULT_CHARTER_ITINERARY, { dropoffItinerarySurcharge: true });
  assert.equal(charterItineraryOf(emptyServiceRules()).dropoffItinerarySurcharge, true);
  const allow = (): boolean => true;
  assert.equal("charterItinerary" in normalizeServiceRules({ ...emptyServiceRules(), charterItinerary: { dropoffItinerarySurcharge: true } }, allow), false, "默认值不存");
  assert.deepEqual(normalizeServiceRules({ ...emptyServiceRules(), charterItinerary: { dropoffItinerarySurcharge: false } }, allow).charterItinerary, { dropoffItinerarySurcharge: false });
  const context = { pickupPlace: null };
  assert.deepEqual(serviceRuleIssues({ ...emptyServiceRules(), charterItinerary: { dropoffItinerarySurcharge: false } }, { ...context, category: "charter" }), []);
  assert.deepEqual(serviceRuleIssues({ ...emptyServiceRules(), charterItinerary: { dropoffItinerarySurcharge: false } }, { ...context, category: "point_to_point" }), [{ path: "/charter_itinerary", reason: "NOT_APPLICABLE" }]);
});
