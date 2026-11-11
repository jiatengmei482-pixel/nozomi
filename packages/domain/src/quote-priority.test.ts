/**
 * M8-30 报价优先级（ADR 0080，业主 2026-11-11）：接送机 / 点对点 一口价 → 一口价 + 区域外里程费 → 计程价 → 不报；
 * 运营区域仍是上限；包车不用计程兜底。另有计程价的校验、冲突、选用，以及客人看到的标注。
 * 例子：商品的报价区域「市区」（139.5–139.8）；运营范围是更大的一块（139.0–141.0）；「远处」在运营范围外。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Position } from "./areas.ts";
import { type DistancePrice, PRICING_BASIS_NOTES, distancePriceAllowed, distancePriceConflicts, distancePriceIssues, pricingBasisNote, selectDistancePrice } from "./distance-price.ts";
import type { AdjustRule, PriceRule } from "./pricing.ts";
import { emptyServiceRules } from "./products.ts";
import { type QuoteArea, type QuoteMoment, type QuoteProduct, type QuoteRequest, quoteProduct } from "./quote.ts";

const square = (west: number, south: number, east: number, north: number): Position[] => [[west, south], [east, south], [east, north], [west, north], [west, south]];
const area = (areaId: string, ring: Position[]): QuoteArea => ({ areaId, active: true, shapes: [{ id: `${areaId}-op`, kind: "operate", ring }] });
const CITY = area("city", square(139.5, 35.5, 139.8, 35.9));
const OPERATING = area("operating", square(139.0, 35.0, 141.0, 36.5));
const P = {
  city: { lng: 139.7, lat: 35.7 },
  city2: { lng: 139.6, lat: 35.8 },
  suburb: { lng: 140.5, lat: 35.7 },
  suburb2: { lng: 140.6, lat: 36.0 },
  far: { lng: 142.5, lat: 37.0 },
};

const rule = (id: string, extra: Partial<PriceRule> = {}): PriceRule & { id: string } => ({ id, areaId: "city", vehicleGroupId: "biz7", direction: null, packageHours: null, pricing: { model: "fixed", basePriceMinor: 10_000 }, validFrom: "2026-01-01", validTo: null, status: "enabled", ...extra });
const dp = (id: string, extra: Partial<DistancePrice> = {}): DistancePrice & { id: string } => ({ id, vehicleGroupId: "biz7", startMinor: 3_000, perKmMinor: 300, validFrom: "2026-01-01", validTo: null, status: "enabled", ...extra });
const adjust = (name: string, steps: AdjustRule["steps"], extra: Partial<AdjustRule> = {}): AdjustRule & { id: string } => ({ id: name, name, travelFrom: null, travelTo: null, cycle: { type: "daily" }, timeSlot: null, areaIds: [], vehicleGroupIds: [], directions: [], packageHours: [], steps, status: "enabled", ...extra });

const product = (extra: Partial<QuoteProduct> = {}): QuoteProduct => ({
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
  areas: [CITY],
  operatingAreas: [OPERATING, CITY],
  vehicleGroups: [{ vehicleGroupId: "biz7", passengers: 6, luggage: 4, active: true }],
  serviceRules: { ...emptyServiceRules(), booking: { saleFrom: null, saleTo: null, serviceTime: { start: "00:00", end: "24:00" }, leadTimeHours: 24, note: null }, freeWait: { pickup: null, dropoff: null, general: { mode: "limited", minutes: 15 } } },
  addonCatalog: [],
  priceRules: [rule("city-fixed")],
  adjustRules: [],
  distancePrices: [dp("dp-biz")],
  inventoryMode: "unlimited",
  ...extra,
});
const airport = (extra: Partial<QuoteProduct> = {}): QuoteProduct => product({ productId: "apt-1", category: "airport_transfer", pickupPlace: { type: "airport", flightScope: "international" }, priceRules: [rule("city-both", { direction: "both" })], ...extra });

const request = (pickup: { lng: number; lat: number } | null, dropoff: { lng: number; lat: number } | null, extra: Partial<QuoteRequest> = {}): QuoteRequest => ({
  category: "point_to_point",
  pickup,
  dropoff,
  direction: null,
  packageHours: null,
  serviceLocal: "2026-10-20T10:00",
  passengers: 2,
  luggage: 1,
  addons: [],
  driverLanguage: null,
  vehicleGroupIds: [],
  ...extra,
});
// 路线 23,456 米：⌈23.456⌉ = 24 公里
const MOMENT: QuoteMoment = { now: new Date("2026-10-07T01:00:00Z"), route: { meters: 23_456, minutes: 37 }, inventoryDay: null, urgentUsed: 0 };

function offer(quoted: ReturnType<typeof quoteProduct>) {
  assert.ok(quoted.ok, JSON.stringify(quoted));
  assert.equal(quoted.offers.length, 1, JSON.stringify(quoted));
  return quoted.offers[0] as NonNullable<(typeof quoted.offers)[number]>;
}

test("情形 1：两端都在报价区域里 → 一口价，和没有计程价时一模一样（没有计价方式、计程明细这两个新字段）", () => {
  const withDistance = quoteProduct(product(), request(P.city, P.city2), MOMENT);
  const without = quoteProduct(product({ distancePrices: [] }), request(P.city, P.city2), MOMENT);
  assert.deepEqual(withDistance, without);
  const found = offer(withDistance);
  assert.equal(found.settlement.totalMinor, 10_000);
  assert.deepEqual(["pricingBasis" in found.settlement, "mileage" in found.settlement], [false, false]);
});

test("情形 2：点对点只有一端在报价区域里 → 这一端区域的一口价 + 区域外里程费（路线公里向上取整 × 计程价的每公里单价）", () => {
  for (const [from, to] of [[P.city, P.suburb], [P.suburb, P.city]] as const) {
    const found = offer(quoteProduct(product(), request(from, to), MOMENT));
    assert.equal(found.areaId, "city");
    assert.equal(found.priceRuleId, "city-fixed");
    assert.equal(found.settlement.pricingBasis, "one_price_outside_km");
    assert.deepEqual(found.settlement.mileage, { distancePriceId: "dp-biz", routeMeters: 23_456, includedKm: 0, km: 24, startMinor: 0, perKmMinor: 300, feeMinor: 7_200 });
    assert.equal(found.settlement.baseMinor, 17_200);
    assert.equal(found.settlement.totalMinor, 17_200);
    assert.deepEqual(found.settlement.usage, MOMENT.route);
  }
});

test("情形 2：一口价设了含公里数时，区域外公里 = 路线距离 − 含的公里数（向上取整）；一口价自己的超出单价不再另算", () => {
  const priceRules = [rule("city-km", { pricing: { model: "fixed", basePriceMinor: 10_000, includedKm: 10, overKmPerKmMinor: 999 } })];
  const found = offer(quoteProduct(product({ priceRules }), request(P.city, P.suburb), MOMENT));
  assert.deepEqual(found.settlement.mileage, { distancePriceId: "dp-biz", routeMeters: 23_456, includedKm: 10, km: 14, startMinor: 0, perKmMinor: 300, feeMinor: 4_200 });
  assert.equal(found.settlement.totalMinor, 14_200);
  assert.equal("distance" in found.settlement, false);
  // 路线在含的公里数以内：里程费 0，仍标「一口价 + 区域外里程费」（这一单的说明一致）
  const short = offer(quoteProduct(product({ priceRules }), request(P.city, P.suburb), { ...MOMENT, route: { meters: 9_000, minutes: 15 } }));
  assert.equal(short.settlement.totalMinor, 10_000);
  assert.equal(short.settlement.mileage?.km, 0);
});

test("情形 2：调价作用在「一口价 + 里程费」的合计上（同包车区域加价）；里程 + 时长的区域价不叠加里程费（这个区域不报）", () => {
  const found = offer(quoteProduct(product({ adjustRules: [adjust("city+10%", [{ type: "percent", value: 1_000 }], { areaIds: ["city"] })] }), request(P.city, P.suburb), MOMENT));
  assert.equal(found.settlement.totalMinor, 18_920);
  assert.equal(found.settlement.baseMinor, 17_200);
  const mileage = quoteProduct(product({ priceRules: [rule("city-mt", { pricing: { model: "mileage_time", startPriceMinor: 5_000, startMeters: 0, startMinutes: 0, perKmMinor: 100, perMinuteMinor: 0, minPriceMinor: null } })] }), request(P.city, P.suburb), MOMENT);
  assert.ok(mileage.ok);
  assert.deepEqual(mileage.refused, [{ vehicleGroupId: "biz7", reason: "NO_PRICE_RULE" }]);
});

test("情形 3：两端都不在报价区域里（都在运营范围里）→ 计程价：起步价 + ⌈路线公里⌉ × 每公里；没有区域，规则编号是计程价的", () => {
  const found = offer(quoteProduct(product(), request(P.suburb, P.suburb2), MOMENT));
  assert.equal(found.areaId, null);
  assert.equal(found.priceRuleId, "dp-biz");
  assert.equal(found.settlement.pricingBasis, "distance_only");
  assert.deepEqual(found.settlement.mileage, { distancePriceId: "dp-biz", routeMeters: 23_456, includedKm: 0, km: 24, startMinor: 3_000, perKmMinor: 300, feeMinor: 10_200 });
  assert.equal(found.settlement.totalMinor, 10_200);
});

test("情形 3：只有适用全部区域的调价规则作用在计程价上；挂了区域的不作用", () => {
  const adjustRules = [adjust("all+10%", [{ type: "percent", value: 1_000 }]), adjust("city+50%", [{ type: "percent", value: 5_000 }], { areaIds: ["city"] })];
  const found = offer(quoteProduct(product({ adjustRules }), request(P.suburb, P.suburb2), MOMENT));
  assert.equal(found.settlement.totalMinor, 11_220);
  assert.deepEqual(found.settlement.adjusts.map((entry) => entry.ruleId), ["all+10%"]);
});

test("情形 2、3：没有路线距离 → 不报（ROUTE_UNAVAILABLE）；这个车型组没有计程价 / 停用 / 不在生效期 → 不报，原因同价格规则", () => {
  const noRoute = { ...MOMENT, route: null };
  for (const [from, to] of [[P.city, P.suburb], [P.suburb, P.suburb2]] as const) {
    const quoted = quoteProduct(product(), request(from, to), noRoute);
    assert.ok(quoted.ok);
    assert.deepEqual(quoted.refused, [{ vehicleGroupId: "biz7", reason: "ROUTE_UNAVAILABLE" }]);
  }
  const cases: [DistancePrice & { id: string }, string][] = [
    [dp("eco", { vehicleGroupId: "eco4" }), "NO_PRICE_RULE"],
    [dp("off", { status: "disabled" }), "PRICE_RULE_DISABLED"],
    [dp("later", { validFrom: "2027-01-01" }), "PRICE_NOT_IN_EFFECT"],
  ];
  for (const [price, reason] of cases) {
    const quoted = quoteProduct(product({ distancePrices: [price] }), request(P.suburb, P.suburb2), MOMENT);
    assert.ok(quoted.ok);
    assert.deepEqual(quoted.refused, [{ vehicleGroupId: "biz7", reason }], reason);
  }
});

test("商品没设计程价：只有一端 / 两端都不在报价区域里时照旧不报，原因和以前一样", () => {
  for (const [from, to] of [[P.city, P.suburb], [P.suburb, P.suburb2]] as const) {
    const quoted = quoteProduct(product({ distancePrices: [] }), request(from, to), MOMENT);
    assert.deepEqual(quoted, { ok: false, productId: "p2p-1", tenantId: "tenant-a", reason: "NO_PRICING_AREA" });
  }
});

test("运营区域仍是上限：任一端不在这个供应商的运营范围里 → 不报（有计程价也一样，原因和以前一样）；不带运营范围（不做运营判断）时不走计程", () => {
  for (const [from, to] of [[P.city, P.far], [P.far, P.suburb], [P.suburb, P.far]] as const) {
    // 原因和没有计程价时一样（报不出时不改原因）
    assert.deepEqual(quoteProduct(product(), request(from, to), MOMENT), quoteProduct(product({ distancePrices: [] }), request(from, to), MOMENT));
    assert.equal(quoteProduct(product(), request(from, to), MOMENT).ok, false);
  }
  const { operatingAreas: _operating, ...unchecked } = product();
  const quoted = quoteProduct(unchecked, request(P.city, P.suburb), MOMENT);
  assert.equal(quoted.ok, false);
});

test("M8-30 之前的口径（legacyAreaRules，只读回放用）：不走情形 2、3", () => {
  const quoted = quoteProduct(product(), request(P.suburb, P.suburb2), MOMENT, { legacyAreaRules: true });
  assert.deepEqual(quoted, { ok: false, productId: "p2p-1", tenantId: "tenant-a", reason: "NO_PRICING_AREA" });
});

test("点对点：另一端落在那个区域的禁行区里 → 这个区域不算（同以前的禁行区口径），没有别的区域时不报（原因同以前）", () => {
  const withForbid: QuoteArea = { ...CITY, shapes: [...CITY.shapes, { id: "city-no", kind: "forbid", ring: square(139.75, 35.85, 139.8, 35.9) }] };
  const quoted = quoteProduct(product({ areas: [withForbid], operatingAreas: [OPERATING] }), request(P.city, { lng: 139.78, lat: 35.88 }), MOMENT);
  assert.deepEqual(quoted, { ok: false, productId: "p2p-1", tenantId: "tenant-a", reason: "IN_FORBIDDEN_AREA" });
});

test("接送机：只看非机场一端——在报价区域里是一口价，不在（在运营范围里）是计程价；机场那一端不看区域", () => {
  const inside = offer(quoteProduct(airport(), request(null, P.city, { category: "airport_transfer", direction: "pickup" }), MOMENT));
  assert.equal(inside.settlement.totalMinor, 10_000);
  assert.equal("pricingBasis" in inside.settlement, false);
  for (const [pickup, dropoff, direction] of [[null, P.suburb, "pickup"], [P.suburb, null, "dropoff"]] as const) {
    const outside = offer(quoteProduct(airport(), request(pickup, dropoff, { category: "airport_transfer", direction }), MOMENT));
    assert.equal(outside.settlement.pricingBasis, "distance_only");
    assert.equal(outside.areaId, null);
    assert.equal(outside.settlement.totalMinor, 10_200);
  }
  const far = quoteProduct(airport(), request(null, P.far, { category: "airport_transfer", direction: "pickup" }), MOMENT);
  assert.equal(far.ok, false);
});

test("包车不用计程兜底：上车或下车不在商品区域、也不在加价区域 → 不报（即使数据里混进了计程价）", () => {
  const charter = product({ productId: "ch-1", category: "charter", priceRules: [rule("ch", { packageHours: 5, pricing: { model: "charter_package", packageKm: 100, packagePriceMinor: 50_000, overtimePerHourMinor: 0, overKmPerKmMinor: 0 } })] });
  const quoted = quoteProduct(charter, request(P.city, P.suburb, { category: "charter", packageHours: 5 }), MOMENT);
  assert.deepEqual(quoted, { ok: false, productId: "ch-1", tenantId: "tenant-a", reason: "NO_PRICING_AREA" });
});

test("计程价：校验（金额整数、不为负、不能都是 0、日期）；同车型组生效日期重叠算冲突；按日期和启停选用", () => {
  assert.deepEqual(distancePriceIssues(dp("x")), []);
  assert.deepEqual(distancePriceIssues(dp("x", { startMinor: 0, perKmMinor: 0 })).map((issue) => issue.path), ["/per_km"]);
  assert.deepEqual(distancePriceIssues(dp("x", { startMinor: -1, perKmMinor: 1.5 })).map((issue) => `${issue.path}:${issue.reason}`), ["/start_price:OUT_OF_RANGE", "/per_km:NOT_INTEGER"]);
  assert.deepEqual(distancePriceIssues(dp("x", { validFrom: "2026-02-01", validTo: "2026-01-01" })).map((issue) => issue.reason), ["DATE_RANGE_REVERSED"]);
  const existing = [dp("a", { validTo: "2026-06-30" }), dp("b", { validFrom: "2026-07-01" }), dp("c", { vehicleGroupId: "eco4" })];
  assert.deepEqual(distancePriceConflicts(dp("n", { validFrom: "2026-06-30", validTo: "2026-07-01" }), existing), [0, 1]);
  assert.deepEqual(distancePriceConflicts(dp("n", { vehicleGroupId: "lux" }), existing), []);
  assert.equal(selectDistancePrice(existing, { vehicleGroupId: "biz7", date: "2026-08-01" }).price?.id, "b");
  assert.equal(distancePriceAllowed("charter"), false);
  assert.equal(distancePriceAllowed("point_to_point") && distancePriceAllowed("airport_transfer"), true);
});

test("客人看到的标注（业主定的说法）：按里程计价 / 含里程费；一口价没有", () => {
  assert.equal(pricingBasisNote("distance_only"), "按里程计价");
  assert.equal(pricingBasisNote("one_price_outside_km"), "含里程费");
  assert.equal(pricingBasisNote(undefined), null);
  assert.equal(PRICING_BASIS_NOTES.one_price, null);
});
