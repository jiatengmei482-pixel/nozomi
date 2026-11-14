/**
 * 包车按上下车点匹配商品（M9P-02，ADR 0093 第三节；规格第六节用例 4、5、8、11、12、18）。
 * 区域、金额按业主规格（东京包车、经济 7 座、结算价）构造；坐标是真实地点的近似值，区域是包住它们的方框。
 * 只断言匹配和上 / 下车加价：经停加价的口径由 M9P-01 改，总价验收放在 M9P-11。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Position } from "./areas.ts";
import { GOLDEN_POINTS, GOLDEN_PRODUCTS, type GoldenPoint, charterGoldenRequest } from "./charter-golden.samples.ts";
import { charterMatches, chooseCharterCity } from "./charter-match.ts";
import type { PriceRule } from "./pricing.ts";
import { emptyServiceRules } from "./products.ts";
import { type QuoteArea, type QuoteProduct, type QuoteRequest, quoteProduct } from "./quote.ts";

const square = (west: number, south: number, east: number, north: number): Position[] => [[west, south], [east, south], [east, north], [west, north], [west, south]];
const area = (areaId: string, ring: Position[], extra: Partial<QuoteArea> = {}): QuoteArea => ({ areaId, active: true, shapes: [{ id: `${areaId}-op`, kind: "operate", ring }], ...extra });

/** ①基础价区域：东京市内（含羽田）；③上下车加价区域：富士山、箱根、镰仓（东西不重叠） */
const AREAS = {
  tokyo: area("tokyo", square(139.55, 35.52, 139.95, 35.82)),
  fuji: area("fuji", square(138.6, 35.3, 138.95, 35.6)),
  hakone: area("hakone", square(138.96, 35.15, 139.15, 35.28)),
  kamakura: area("kamakura", square(139.5, 35.28, 139.6, 35.36)),
};

const PLACES = {
  shinjuku: { lat: 35.6905, lng: 139.7005 },
  asakusa: { lat: 35.7148, lng: 139.7967 },
  kawaguchiko: { lat: 35.5106, lng: 138.7637 },
  kawaguchikoStation: { lat: 35.4983, lng: 138.7686 },
  oshinoHakkai: { lat: 35.4602, lng: 138.8327 },
  ashinoko: { lat: 35.2, lng: 139.0 },
  kamakuraStation: { lat: 35.3192, lng: 139.5505 },
  kofu: { lat: 35.6622, lng: 138.5683 },
};

const rule = (id: string, areaId: string, packageHours: number, pricing: PriceRule["pricing"], extra: Partial<PriceRule> = {}): PriceRule & { id: string } => ({ id, areaId, vehicleGroupId: "eco7", direction: null, packageHours, pricing, validFrom: "2026-01-01", validTo: null, status: "enabled", ...extra });
const pkg = (hours: number, priceMinor: number) => rule(`p-${hours}`, "tokyo", hours, { model: "charter_package", packageKm: 300, packagePriceMinor: priceMinor, overtimePerHourMinor: 5_000, overKmPerKmMinor: 500 });
const surcharge = (areaId: string, hours: number, amount: number, extra: Partial<PriceRule> = {}) =>
  rule(`s-${areaId}-${hours}`, areaId, hours, { model: "charter_area_surcharge", pickupSurchargeMinor: amount, dropoffSurchargeMinor: amount, waypointSurchargeMinor: amount }, extra);

const RULES = [pkg(4, 28_000), pkg(5, 33_000), pkg(10, 55_000), ...[5, 10].flatMap((hours) => [surcharge("fuji", hours, 10_000), surcharge("hakone", hours, 10_000), surcharge("kamakura", hours, 8_000)])];

const tokyoCharter = (extra: Partial<QuoteProduct> = {}): QuoteProduct => ({
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
  areas: [AREAS.tokyo],
  surchargeAreas: [AREAS.fuji, AREAS.hakone, AREAS.kamakura],
  vehicleGroups: [{ vehicleGroupId: "eco7", passengers: 6, luggage: 4, active: true }],
  serviceRules: { ...emptyServiceRules(), booking: { saleFrom: null, saleTo: null, serviceTime: { start: "00:00", end: "24:00" }, leadTimeHours: 0, note: null } },
  addonCatalog: [],
  priceRules: RULES,
  adjustRules: [],
  inventoryMode: "unlimited",
  ...extra,
});

type Place = keyof typeof PLACES;
const request = (pickup: Place, dropoff: Place, packageHours: number, waypoints: Place[] = []): QuoteRequest => ({
  category: "charter",
  pickup: PLACES[pickup],
  dropoff: PLACES[dropoff],
  direction: null,
  packageHours,
  serviceLocal: "2026-12-01T09:00",
  passengers: 2,
  luggage: 1,
  addons: [],
  driverLanguage: null,
  vehicleGroupIds: [],
  ...(waypoints.length === 0 ? {} : { waypoints: waypoints.map((name) => PLACES[name]) }),
});
const MOMENT = { now: new Date("2026-11-14T00:00:00Z"), route: null, inventoryDay: null, urgentUsed: 0 };

/** 报出来的唯一一个车型组：结算价、上车加价区域和金额、下车加价区域和金额 */
function offerOf(req: QuoteRequest) {
  const quote = quoteProduct(tokyoCharter(), req, MOMENT);
  assert.ok(quote.ok, `应该报得出：${JSON.stringify(quote)}`);
  assert.deepEqual(quote.refused, []);
  const [offer] = quote.offers;
  assert.ok(offer !== undefined);
  const surcharge = offer.settlement.areaSurcharge;
  assert.ok(surcharge !== undefined && surcharge !== null);
  return { total: offer.settlement.totalMinor, pickup: [surcharge.pickup.areaId, surcharge.pickup.amountMinor], dropoff: [surcharge.dropoff.areaId, surcharge.dropoff.amountMinor] };
}

test("用例 4：河口湖上车 → 忍野八海 → 河口湖下车，由东京包车报价，收富士山上车、下车加价", () => {
  assert.equal(charterMatches(tokyoCharter(), PLACES.kawaguchiko, PLACES.kawaguchiko), true);
  const offer = offerOf(request("kawaguchiko", "kawaguchiko", 10, ["oshinoHakkai"]));
  assert.deepEqual([offer.pickup, offer.dropoff], [["fuji", 10_000], ["fuji", 10_000]]);
});

test("用例 5：河口湖上车 → 芦之湖 → 河口湖下车，由东京包车报价：套餐 55,000 + 箱根行程 10,000 + 富士山上车 10,000 + 下车 10,000 = 85,000", () => {
  assert.equal(charterMatches(tokyoCharter(), PLACES.kawaguchiko, PLACES.kawaguchiko), true);
  const offer = offerOf(request("kawaguchiko", "kawaguchiko", 10, ["ashinoko"]));
  assert.deepEqual([offer.pickup, offer.dropoff], [["fuji", 10_000], ["fuji", 10_000]]);
  assert.equal(offer.total, 85_000);
});

test("用例 8：镰仓站上车 → 浅草 → 新宿下车（5h），由东京包车报价：套餐 33,000 + 镰仓上车 8,000 = 41,000", () => {
  assert.equal(charterMatches(tokyoCharter(), PLACES.kamakuraStation, PLACES.shinjuku), true);
  const offer = offerOf(request("kamakuraStation", "shinjuku", 5, ["asakusa"]));
  assert.deepEqual([offer.pickup, offer.dropoff], [["kamakura", 8_000], [null, 0]]);
  assert.equal(offer.total, 41_000);
});

test("用例 18：河口湖上车 → 新宿下车（不填经停），由东京包车报价：套餐 55,000 + 富士山上车 10,000 = 65,000", () => {
  assert.equal(charterMatches(tokyoCharter(), PLACES.kawaguchiko, PLACES.shinjuku), true);
  const offer = offerOf(request("kawaguchiko", "shinjuku", 10));
  assert.deepEqual([offer.pickup, offer.dropoff], [["fuji", 10_000], [null, 0]]);
  assert.equal(offer.total, 65_000);
});

test("用例 11：甲府上车（不在任何①③里）不匹配；下车点在甲府也不匹配", () => {
  assert.equal(charterMatches(tokyoCharter(), PLACES.kofu, PLACES.shinjuku), false);
  assert.equal(charterMatches(tokyoCharter(), PLACES.shinjuku, PLACES.kofu), false);
  const quote = quoteProduct(tokyoCharter(), request("kofu", "shinjuku", 10), MOMENT);
  assert.equal(quote.ok, false);
});

test("用例 12：经停不影响匹配——上下车都在①，经停在甲府：匹配，但引擎不报（WAYPOINT_NOT_PRICED，转人工）", () => {
  assert.equal(charterMatches(tokyoCharter(), PLACES.shinjuku, PLACES.shinjuku), true);
  const quote = quoteProduct(tokyoCharter(), request("shinjuku", "shinjuku", 10, ["kofu"]), MOMENT);
  assert.ok(quote.ok);
  assert.deepEqual(quote.offers, []);
  assert.deepEqual(quote.refused, [{ vehicleGroupId: "eco7", reason: "WAYPOINT_NOT_PRICED", stopSeq: 1 }]);
});

test("③只认有启用的区域加价规则的区域：规则都停用了、区域停用了、只有套餐价的区域都不算", () => {
  const disabled = RULES.map((entry) => (entry.areaId === "fuji" ? { ...entry, status: "disabled" as const } : entry));
  assert.equal(charterMatches(tokyoCharter({ priceRules: disabled }), PLACES.kawaguchiko, PLACES.shinjuku), false);
  // 只要还有一条启用的（哪怕是别的套餐时长）就算：日期、套餐时长对不对由引擎在报价时看
  const oneLeft = RULES.map((entry) => (entry.areaId === "fuji" && entry.packageHours === 5 ? { ...entry, status: "disabled" as const } : entry));
  assert.equal(charterMatches(tokyoCharter({ priceRules: oneLeft }), PLACES.kawaguchiko, PLACES.shinjuku), true);
  assert.equal(charterMatches(tokyoCharter({ surchargeAreas: [{ ...AREAS.fuji, active: false }, AREAS.hakone, AREAS.kamakura] }), PLACES.kawaguchiko, PLACES.shinjuku), false);
  // 区域图形带着、但没有任何区域加价规则：不算③
  assert.equal(charterMatches(tokyoCharter({ priceRules: RULES.filter((entry) => entry.areaId !== "fuji") }), PLACES.kawaguchiko, PLACES.shinjuku), false);
});

test("①的禁行区里不算在①里；③的营运区照样算", () => {
  const forbid = { ...AREAS.tokyo, shapes: [...AREAS.tokyo.shapes, { id: "tokyo-no", kind: "forbid" as const, ring: square(139.68, 35.68, 139.72, 35.7) }] };
  assert.equal(charterMatches(tokyoCharter({ areas: [forbid] }), PLACES.shinjuku, PLACES.asakusa), false);
  assert.equal(charterMatches(tokyoCharter({ areas: [forbid] }), PLACES.asakusa, PLACES.kawaguchiko), true);
});

test("和报价引擎同一套判断：golden 的商品（不带运营范围的）× 所有点对，不匹配的引擎都不报；引擎报得出的都匹配", () => {
  const points = Object.keys(GOLDEN_POINTS) as GoldenPoint[];
  let checked = 0;
  for (const product of GOLDEN_PRODUCTS.filter((entry) => entry.operatingAreas === undefined)) {
    for (const pickup of points) {
      for (const dropoff of points) {
        const matched = charterMatches(product, GOLDEN_POINTS[pickup], GOLDEN_POINTS[dropoff]);
        for (const hours of [8, 10]) {
          const quote = quoteProduct(product, charterGoldenRequest(pickup, dropoff, hours, "2026-10-20T10:00"), { now: new Date("2026-10-07T01:00:00Z"), route: null, inventoryDay: null, urgentUsed: 0 });
          const priced = quote.ok && quote.offers.length > 0;
          if (priced) assert.equal(matched, true, `${product.productId} ${pickup}→${dropoff} ${hours}h 报得出，应该匹配`);
          if (!matched) assert.ok(!quote.ok && ["NO_PRICING_AREA", "OUT_OF_SERVICE_AREA", "IN_FORBIDDEN_AREA"].includes(quote.reason), `${product.productId} ${pickup}→${dropoff} 不匹配，引擎应该按区域不报：${JSON.stringify(quote)}`);
          checked += 1;
        }
      }
    }
  }
  assert.ok(checked > 300);
});

test("多个城市只取一个：请求的城市 → 上车点所在城市 → 编号最小；一个都没有为 null", () => {
  assert.equal(chooseCharterCity([], { requestedCityId: "c-1", pickupCityId: "c-1" }), null);
  assert.deepEqual(chooseCharterCity(["c-2", "c-2"], { requestedCityId: "c-1", pickupCityId: null }), { cityId: "c-2", by: "only" });
  assert.deepEqual(chooseCharterCity(["c-3", "c-2"], { requestedCityId: "c-3", pickupCityId: "c-2" }), { cityId: "c-3", by: "requested" });
  assert.deepEqual(chooseCharterCity(["c-3", "c-2"], { requestedCityId: "c-9", pickupCityId: "c-3" }), { cityId: "c-3", by: "pickup_city" });
  assert.deepEqual(chooseCharterCity(["c-3", "c-2"], { requestedCityId: null, pickupCityId: "c-9" }), { cityId: "c-2", by: "smallest_id" });
});
