/** 方案组装（ADR 0101 第三节第 6 小节、第四节）的单元测试：两个方案、跨段费用、工时、按段选车、报不出、推荐。 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Position } from "../areas.ts";
import type { LatLng } from "../geo.ts";
import type { QuoteArea } from "../quote.ts";
import { type BuildDay, type BuildProduct, type BuildSegment, type TripOffer, buildTripPlans } from "./build.ts";
import { type TripRuleConfig, effectiveTripRules } from "./rules.ts";
import type { SegmentDraft } from "./segments.ts";

const square = (west: number, south: number, east: number, north: number): Position[] => [[west, south], [east, south], [east, north], [west, north], [west, south]];
const TOKYO: QuoteArea = { areaId: "tokyo", active: true, shapes: [{ id: "tokyo-op", kind: "operate", ring: square(139.55, 35.52, 139.95, 35.82) }] };
const SHINJUKU: LatLng = { lat: 35.69, lng: 139.7 };
const GINZA: LatLng = { lat: 35.67, lng: 139.76 };
const HAKONE: LatLng = { lat: 35.23, lng: 139.1 };
const HANEDA: LatLng = { lat: 35.55, lng: 139.78 };

const offer = (tenantId: string, vehicleGroupId: string, sellMinor: number, settlementMinor: number, extra: Partial<TripOffer> = {}): TripOffer => ({
  tenantId,
  productId: `p-${tenantId}`,
  vehicleGroupId,
  sellMinor,
  settlementMinor,
  winner: false,
  settlementCurrency: "JPY",
  markupBp: 2_000,
  fxBufferBp: 0,
  fx: null,
  durationMinutes: null,
  surcharge: null,
  addons: [],
  ...extra,
});
const win = (o: TripOffer): TripOffer => ({ ...o, winner: true });

const segment = (type: SegmentDraft["type"], offers: TripOffer[], startMinute: number, routeMinutes: number, from: LatLng, to: LatLng, reasons: string[] = []): BuildSegment => ({
  draft: { type, from: 0, to: type === "charter" ? 2 : 1 },
  offers,
  route: { startMinute, routeMinutes, driveMinutes: Math.round(routeMinutes * 0.7), meters: routeMinutes * 400 },
  startPoint: from,
  endPoint: to,
  reasons,
});

const day = (dayIndex: number, segments: BuildSegment[], extra: Partial<BuildDay> = {}): BuildDay => ({
  dayIndex,
  date: `2027-03-${String(28 + dayIndex).padStart(2, "0")}`,
  options: segments.length === 0 ? [] : [{ segments }],
  used: segments.length > 0,
  startPoint: segments[0]?.startPoint ?? null,
  endPoint: segments[segments.length - 1]?.endPoint ?? null,
  nightAt: null,
  lodgingProvided: false,
  reason: null,
  ...extra,
});

const products = (config: TripRuleConfig | null = null) => (productId: string): BuildProduct => ({ areas: [TOKYO], rules: effectiveTripRules(config, "JPY"), ruleVersion: productId === "p-T2" ? 3 : 0, priceRules: [] });

/** 东京 → 箱根过夜 → 东京：第 0 天 T1 中标，第 1 天 T2 中标 */
const twoDays = (surcharge = 0): BuildDay[] => [
  day(0, [segment("charter", [win(offer("T1", "V", 50_000, 40_000, surcharge > 0 ? { surcharge: { pickupMinor: 0, dropoffMinor: surcharge } } : {})), offer("T2", "V", 52_000, 42_000, surcharge > 0 ? { surcharge: { pickupMinor: 0, dropoffMinor: surcharge } } : {})], 540, 300, SHINJUKU, HAKONE)]),
  day(1, [segment("charter", [offer("T1", "V", 55_000, 44_000, surcharge > 0 ? { surcharge: { pickupMinor: surcharge, dropoffMinor: 0 } } : {}), win(offer("T2", "V", 50_000, 40_000, surcharge > 0 ? { surcharge: { pickupMinor: surcharge, dropoffMinor: 0 } } : {}))], 1_440 + 540, 300, HAKONE, GINZA)]),
];

test("两天：daily_best 取每天中标；one_car 取段 + 住宿最低的租户车型组；daily_best 便宜 10% 以上推荐它", () => {
  const result = buildTripPlans({ currency: "JPY", days: twoDays(), product: products() });
  const [oneCar, daily] = result.plans;
  assert.equal(daily?.kind, "daily_best");
  assert.equal(daily?.sellMinor, 100_000);
  assert.deepEqual(daily?.fees, []);
  // T1：50,000 + 55,000 + 住宿 18,000 = 123,000；T2：52,000 + 50,000 + 18,000 = 120,000
  assert.equal(oneCar?.kind, "one_car");
  assert.equal(oneCar?.tenantId, "T2");
  assert.equal(oneCar?.sellMinor, 120_000);
  assert.equal(oneCar?.settlementMinor, 42_000 + 40_000 + 15_000);
  assert.equal(oneCar?.fees.length, 1);
  assert.deepEqual({ type: oneCar?.fees[0]?.type, night: oneCar?.fees[0]?.nightIndex, sell: oneCar?.fees[0]?.sellMinor, productId: oneCar?.fees[0]?.productId, ruleVersion: oneCar?.fees[0]?.ruleVersion }, { type: "lodging", night: 0, sell: 18_000, productId: "p-T2", ruleVersion: 3 });
  // 100,000 ≤ 120,000 × 0.9
  assert.equal(daily?.recommended, true);
  assert.equal(oneCar?.recommended, false);
  assert.deepEqual(result.unquoted, []);
});

test("过夜点在③：两笔空驶加价合计 ≥ 住宿时车回基地、不收住宿；合计 < 住宿时收住宿再抵掉两笔加价（D4）", () => {
  const stay = buildTripPlans({ currency: "JPY", days: twoDays(8_000), product: products() }).plans.find((plan) => plan.kind === "one_car");
  // 15,000 − 16,000 = −1,000 < 0：车留在当地更便宜
  assert.deepEqual(stay?.fees.map((fee) => [fee.type, fee.settlementMinor, fee.sellMinor]), [["lodging", 15_000, 18_000], ["lodging_offset", -16_000, -19_200]]);
  assert.equal(stay?.sellMinor, 102_000 - 1_200);
  const result = buildTripPlans({ currency: "JPY", days: twoDays(6_000), product: products() });
  const oneCar = result.plans.find((plan) => plan.kind === "one_car");
  assert.deepEqual(oneCar?.fees, []);
  assert.equal(oneCar?.sellMinor, 102_000);
  // 差距不到 10%：推荐一车到底
  assert.equal(oneCar?.recommended, true);
});

test("工时：拘束超 13 h 加第二司机（固定金额），告警 SECOND_DRIVER；没配金额时这一天报不出", () => {
  const days = [day(0, [segment("charter", [win(offer("T1", "V", 80_000, 64_000, { durationMinutes: 760 }))], 480, 700, SHINJUKU, GINZA)])];
  const fixed = buildTripPlans({ currency: "JPY", days, product: products({ secondDriver: { mode: "fixed", fixedMinor: 30_000 } }) });
  assert.equal(fixed.plans.length, 1);
  const plan = fixed.plans[0];
  assert.deepEqual(plan?.warnings, [{ code: "SECOND_DRIVER", dayIndex: 0 }]);
  assert.equal(plan?.fees[0]?.type, "second_driver");
  assert.equal(plan?.sellMinor, 80_000 + 36_000);
  assert.equal(plan?.recommended, true);
  const missing = buildTripPlans({ currency: "JPY", days, product: products() });
  assert.equal(missing.plans[0]?.sellMinor, null);
  assert.deepEqual(missing.unquoted, [{ planKind: "one_car", dayIndex: 0, reason: "SECOND_DRIVER_PRICE_UNAVAILABLE" }]);
});

test("单日行程只出 one_car", () => {
  const result = buildTripPlans({ currency: "JPY", days: [twoDays()[0] as BuildDay], product: products() });
  assert.deepEqual(result.plans.map((plan) => plan.kind), ["one_car"]);
  assert.equal(result.plans[0]?.tenantId, "T1");
});

test("某天一个报价都没有：两个方案都报不出，带天和原因", () => {
  const days = [twoDays()[0] as BuildDay, day(1, [segment("charter", [], 1_440 + 540, 300, HAKONE, GINZA, ["OUT_OF_SERVICE_AREA"])])];
  const result = buildTripPlans({ currency: "JPY", days, product: products() });
  assert.ok(result.plans.every((plan) => plan.sellMinor === null));
  assert.deepEqual(result.unquoted, [
    { planKind: "one_car", dayIndex: 1, reason: "OUT_OF_SERVICE_AREA" },
    { planKind: "daily_best", dayIndex: 1, reason: "OUT_OF_SERVICE_AREA" },
  ]);
});

test("路线取不到的用车日：两个方案都报不出，原因是这一天的原因", () => {
  const days = [twoDays()[0] as BuildDay, day(1, [], { used: true, reason: "ROUTE_UNAVAILABLE" })];
  const result = buildTripPlans({ currency: "JPY", days, product: products() });
  assert.deepEqual(result.unquoted, [
    { planKind: "one_car", dayIndex: 1, reason: "ROUTE_UNAVAILABLE" },
    { planKind: "daily_best", dayIndex: 1, reason: "ROUTE_UNAVAILABLE" },
  ]);
});

test("按段选车：接机日这个租户报不出 → 用当天中标的接机，告警 SEGMENT_OTHER_VEHICLE，前后不收住宿", () => {
  const days = [
    day(0, [segment("airport_pickup", [win(offer("T3", "V2", 12_000, 10_000))], 600, 60, HANEDA, HAKONE)]),
    day(1, [segment("charter", [win(offer("T1", "V", 50_000, 40_000))], 1_440 + 540, 300, HAKONE, GINZA)]),
  ];
  const result = buildTripPlans({ currency: "JPY", days, product: products() });
  const oneCar = result.plans.find((plan) => plan.kind === "one_car");
  assert.equal(oneCar?.tenantId, "T1");
  assert.equal(oneCar?.days[0]?.otherVehicle, true);
  assert.deepEqual(oneCar?.warnings, [{ code: "SEGMENT_OTHER_VEHICLE", dayIndex: 0 }]);
  assert.deepEqual(oneCar?.fees, []);
  assert.equal(oneCar?.sellMinor, 62_000);
});

test("夹空闲日、过夜在①外：两晚住宿 + 一天停驻（最短套餐取不到 → 每天 10,000）", () => {
  const days = [
    day(0, [segment("charter", [win(offer("T1", "V", 50_000, 40_000))], 540, 300, SHINJUKU, HAKONE)]),
    day(1, [], { nightAt: HAKONE }),
    day(2, [segment("charter", [win(offer("T1", "V", 50_000, 40_000))], 2 * 1_440 + 540, 300, HAKONE, GINZA)]),
  ];
  const result = buildTripPlans({ currency: "JPY", days, product: products() });
  const oneCar = result.plans.find((plan) => plan.kind === "one_car");
  assert.deepEqual(oneCar?.fees.map((fee) => [fee.type, fee.nightIndex, fee.dayIndex, fee.settlementMinor]), [
    ["lodging", 0, null, 15_000],
    ["idle", null, 1, 10_000],
    ["lodging", 1, null, 15_000],
  ]);
  assert.equal(oneCar?.sellMinor, 100_000 + 48_000);
  // 客人第 1 晚提供住宿：那一晚记 0
  const provided = buildTripPlans({ currency: "JPY", days: days.map((d) => (d.dayIndex === 1 ? { ...d, lodgingProvided: true } : d)), product: products() });
  assert.equal(provided.plans.find((plan) => plan.kind === "one_car")?.fees.find((fee) => fee.nightIndex === 1)?.settlementMinor, 0);
});

test("按次附加项：同一辆车第二段起记等额负数抵掉；按件的照收", () => {
  const seat = { addonId: "child-seat", chargeUnit: "per_order" as const, amountMinor: 2_000 };
  const item = { addonId: "luggage", chargeUnit: "per_item" as const, amountMinor: 500 };
  const days = [
    day(0, [segment("charter", [win(offer("T1", "V", 50_000, 40_000, { addons: [seat, item] }))], 540, 300, SHINJUKU, GINZA)]),
    day(1, [segment("charter", [win(offer("T1", "V", 50_000, 40_000, { addons: [seat, item] }))], 1_440 + 540, 300, GINZA, SHINJUKU)]),
  ];
  const oneCar = buildTripPlans({ currency: "JPY", days, product: products() }).plans.find((plan) => plan.kind === "one_car");
  assert.deepEqual(oneCar?.fees.map((fee) => [fee.type, fee.dayIndex, fee.settlementMinor, fee.sellMinor]), [["bundle_discount", 1, -2_000, -2_400]]);
  assert.equal(oneCar?.sellMinor, 100_000 - 2_400);
});

test("每天各自最优的工时只算包车那家自己的段：别家的接机段不算进拘束", () => {
  // 接机 X（08:00–10:00），下午包车 Y 10:30 起 600 分钟：合在一起超 13 h，但 Y 自己只有 10 h + 出入库
  const days = [
    day(0, [segment("airport_pickup", [win(offer("X", "V2", 12_000, 10_000, { durationMinutes: 120 }))], 480, 120, HANEDA, SHINJUKU), segment("charter", [win(offer("Y", "V", 60_000, 48_000, { durationMinutes: 600 }))], 630, 600, SHINJUKU, GINZA)]),
    day(1, [segment("charter", [win(offer("Y", "V", 50_000, 40_000))], 1_440 + 540, 300, GINZA, SHINJUKU)]),
  ];
  const daily = buildTripPlans({ currency: "JPY", days, product: products({ secondDriver: { mode: "fixed", fixedMinor: 30_000 } }) }).plans.find((plan) => plan.kind === "daily_best");
  assert.deepEqual(daily?.warnings, []);
  assert.deepEqual(daily?.fees, []);
  assert.equal(daily?.sellMinor, 12_000 + 60_000 + 50_000);
});
