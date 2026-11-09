/**
 * M8-15 包车区域加价（ADR 0073 第三部分）：价格规则的新价格方式、冲突键、报价（上车 / 下车加价）、对外价参考。
 * 例子用 ADR 里参考截图的那一组：东京（商品本身的区域）0/0、富士山 1000/1000、千叶 500/500、八王子 800/800。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Position } from "./areas.ts";
import {
  type AdjustRule,
  type PriceRule,
  type Pricing,
  areaSurchargeFor,
  basePrice,
  findPriceRuleOverlaps,
  isSurchargeRule,
  priceCoverage,
  priceRuleIssues,
  pricingModelsFor,
  selectPriceRule,
  sellablePriceRules,
  surchargeAreaIds,
  surchargeModelsFor,
  tripPrice,
} from "./pricing.ts";
import { emptyServiceRules } from "./products.ts";
import { type QuoteArea, type QuoteMoment, type QuoteProduct, type QuoteRequest, compareQuotes, quoteProduct, sellEquivalentMinor } from "./quote.ts";

const square = (west: number, south: number, east: number, north: number): Position[] => [[west, south], [east, south], [east, north], [west, north], [west, south]];
const area = (areaId: string, ring: Position[], extra: Partial<QuoteArea> = {}): QuoteArea => ({ areaId, active: true, shapes: [{ id: `${areaId}-op`, kind: "operate", ring }], ...extra });

// 商品本身的区域：东京（139.5–139.9）。加价区域：千叶（140.0–140.3）、八王子（139.2–139.4）、富士山（138.6–138.9），
// 富士山北边和八王子重叠一块（138.6–139.3 × 35.8–35.9 里的 139.2–139.3）；另有一块「宽千叶」整个包住千叶（取最小用）
const TOKYO = area("tokyo", square(139.5, 35.5, 139.9, 35.9));
const CHIBA = area("chiba", square(140.0, 35.5, 140.3, 35.9));
const HACHIOJI = area("hachioji", square(139.2, 35.5, 139.4, 35.9));
const FUJI = area("fuji", square(138.6, 35.2, 139.3, 35.45));
const WIDE_CHIBA = area("wide-chiba", square(139.95, 35.4, 140.4, 36.0));
const P = {
  tokyo: { lng: 139.7, lat: 35.7 },
  chiba: { lng: 140.1, lat: 35.7 },
  hachioji: { lng: 139.3, lat: 35.7 },
  fuji: { lng: 138.7, lat: 35.3 },
  nowhere: { lng: 141.5, lat: 37.0 },
};

const pkg = (id: string, extra: Partial<PriceRule> = {}, packagePriceMinor = 50_000): PriceRule & { id: string } => ({
  id,
  areaId: "tokyo",
  vehicleGroupId: "biz7",
  direction: null,
  packageHours: 8,
  pricing: { model: "charter_package", packageKm: 150, packagePriceMinor, overtimePerHourMinor: 5_000, overKmPerKmMinor: 400 },
  validFrom: "2026-01-01",
  validTo: null,
  status: "enabled",
  ...extra,
});
const surcharge = (id: string, areaId: string, pickup: number, dropoff: number, extra: Partial<PriceRule> = {}): PriceRule & { id: string } => ({
  id,
  areaId,
  vehicleGroupId: "biz7",
  direction: null,
  packageHours: 8,
  pricing: { model: "charter_area_surcharge", pickupSurchargeMinor: pickup, dropoffSurchargeMinor: dropoff },
  validFrom: "2026-01-01",
  validTo: null,
  status: "enabled",
  ...extra,
});
const adjust = (name: string, steps: AdjustRule["steps"], extra: Partial<AdjustRule> = {}): AdjustRule & { id: string } => ({ id: name, name, travelFrom: null, travelTo: null, cycle: { type: "daily" }, timeSlot: null, areaIds: [], vehicleGroupIds: [], directions: [], packageHours: [], steps, status: "enabled", ...extra });

const SURCHARGES = [surcharge("s-fuji", "fuji", 1_000, 1_000), surcharge("s-chiba", "chiba", 500, 500), surcharge("s-hachioji", "hachioji", 800, 800)];

const charter = (extra: Partial<QuoteProduct> = {}): QuoteProduct => ({
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
  surchargeAreas: [FUJI, CHIBA, HACHIOJI],
  vehicleGroups: [{ vehicleGroupId: "biz7", passengers: 6, luggage: 4, active: true }, { vehicleGroupId: "eco4", passengers: 3, luggage: 2, active: true }],
  serviceRules: { ...emptyServiceRules(), booking: { saleFrom: null, saleTo: null, serviceTime: { start: "00:00", end: "24:00" }, leadTimeHours: 24, note: null }, freeWait: { pickup: null, dropoff: null, general: { mode: "limited", minutes: 0 } } },
  addonCatalog: [],
  priceRules: [pkg("base-8"), ...SURCHARGES],
  adjustRules: [],
  inventoryMode: "unlimited",
  ...extra,
});
const trip = (pickup: keyof typeof P, dropoff: keyof typeof P | null, extra: Partial<QuoteRequest> = {}): QuoteRequest => ({
  category: "charter",
  pickup: P[pickup],
  dropoff: dropoff === null ? null : P[dropoff],
  direction: null,
  packageHours: 8,
  serviceLocal: "2026-10-20T10:00",
  passengers: 2,
  luggage: 1,
  addons: [],
  driverLanguage: null,
  vehicleGroupIds: ["biz7"],
  ...extra,
});
const moment: QuoteMoment = { now: new Date("2026-10-07T01:00:00Z"), route: null, inventoryDay: null, urgentUsed: 0 };

/** 报价写成一个数（或原因） */
function total(product: QuoteProduct, request: QuoteRequest): number | string {
  const quoted = quoteProduct(product, request, moment);
  if (!quoted.ok) return quoted.reason;
  const offer = quoted.offers[0];
  return offer === undefined ? (quoted.refused[0]?.reason ?? "NONE") : offer.settlement.totalMinor;
}
function settlementOf(product: QuoteProduct, request: QuoteRequest) {
  const quoted = quoteProduct(product, request, moment);
  assert.ok(quoted.ok && quoted.offers.length === 1, JSON.stringify(quoted));
  return (quoted.offers[0] as (typeof quoted.offers)[number]).settlement;
}

// ---- 价格规则 ----

test("新价格方式：包车可以用区域加价（加价类，不是基础定价），别的品类不能；上车 / 下车加价是 0 到上限的整数，可以是 0", () => {
  assert.deepEqual(pricingModelsFor("charter"), ["charter_package"], "基础定价的计价方式不变");
  assert.deepEqual([surchargeModelsFor("charter"), surchargeModelsFor("point_to_point"), surchargeModelsFor("airport_transfer")], [["charter_area_surcharge"], [], []]);
  assert.deepEqual(priceRuleIssues(surcharge("x", "fuji", 0, 0), { category: "charter" }), []);
  assert.deepEqual(priceRuleIssues(surcharge("x", "fuji", -1, 1.5), { category: "charter" }), [{ path: "/pickup_surcharge", reason: "OUT_OF_RANGE", detail: { min: 0, max: 1_000_000_000 } }, { path: "/dropoff_surcharge", reason: "NOT_INTEGER" }]);
  assert.deepEqual(priceRuleIssues(surcharge("x", "fuji", 1, 1, { packageHours: null }), { category: "charter" }), [{ path: "/package_hours", reason: "REQUIRED" }], "按套餐时长填");
  assert.deepEqual(priceRuleIssues(surcharge("x", "fuji", 1, 1, { packageHours: null }), { category: "point_to_point" }), [{ path: "/pricing_model", reason: "MODEL_NOT_ALLOWED" }]);
  assert.equal(isSurchargeRule(surcharge("x", "fuji", 1, 1)), true);
  assert.equal(isSurchargeRule(pkg("y")), false);
  assert.equal(basePrice({ model: "charter_area_surcharge", pickupSurchargeMinor: 500, dropoffSurchargeMinor: 800 } satisfies Pricing).numerator, 0n, "区域加价没有自己的基础价");
});

test("冲突键含价格方式：同一区域可以同时有套餐价和区域加价；同一区域 × 车型组 × 套餐时长 × 日期重叠的区域加价只能有一条；套餐时长、车型组不同不冲突", () => {
  assert.deepEqual(findPriceRuleOverlaps([pkg("a", { areaId: "fuji" }), surcharge("b", "fuji", 1, 1)]), []);
  assert.deepEqual(findPriceRuleOverlaps([surcharge("a", "fuji", 1, 1), surcharge("b", "fuji", 2, 2, { validFrom: "2026-06-01" })]), [[0, 1]]);
  assert.deepEqual(findPriceRuleOverlaps([surcharge("a", "fuji", 1, 1, { validTo: "2026-05-31" }), surcharge("b", "fuji", 2, 2, { validFrom: "2026-06-01" })]), []);
  assert.deepEqual(findPriceRuleOverlaps([surcharge("a", "fuji", 1, 1), surcharge("b", "fuji", 1, 1, { packageHours: 4 }), surcharge("c", "fuji", 1, 1, { vehicleGroupId: "eco4" })]), []);
  // 停用的也算（和基础定价一样）
  assert.deepEqual(findPriceRuleOverlaps([surcharge("a", "fuji", 1, 1, { status: "disabled" }), surcharge("b", "fuji", 2, 2)]), [[0, 1]]);
  // 基础定价的几种计价方式之间照旧冲突（键里只分「基础 / 加价」）
  const fixed: PriceRule = { ...pkg("f", { packageHours: null }), pricing: { model: "fixed", basePriceMinor: 1 } };
  const mileage: PriceRule = { ...fixed, pricing: { model: "mileage_time", startPriceMinor: 1, startMeters: 0, startMinutes: 0, perKmMinor: 1, perMinuteMinor: 1, minPriceMinor: null } };
  assert.deepEqual(findPriceRuleOverlaps([fixed, mileage]), [[0, 1]]);
});

test("区域加价不是「该有的价格」：上架检查（可以卖的价格）、缺价统计、命中基础定价都不算它", () => {
  const rules = [pkg("base"), surcharge("s", "tokyo", 100, 100), surcharge("s4", "fuji", 100, 100, { packageHours: 4 })];
  assert.deepEqual(sellablePriceRules(rules, { areaIds: ["tokyo", "fuji"], vehicleGroupIds: ["biz7"] }, "2026-10-07").map((rule) => rule.id), ["base"]);
  const coverage = priceCoverage({ category: "charter", areaIds: ["tokyo"], vehicleGroupIds: ["biz7"], rules, today: "2026-10-07" });
  assert.deepEqual([coverage.packages, coverage.total, coverage.priced], [[8], 1, 1], "区域加价的套餐时长 4 不算进「该有价格的组合」");
  assert.equal(selectPriceRule([surcharge("s", "tokyo", 100, 100)], { areaId: "tokyo", vehicleGroupId: "biz7", direction: null, packageHours: 8, date: "2026-10-20" }), null);
  assert.equal(tripPrice({ priceRules: [surcharge("s", "tokyo", 100, 100)], adjustRules: [], query: { areaId: "tokyo", vehicleGroupId: "biz7", direction: null, packageHours: 8, date: "2026-10-20" }, minuteOfDay: 600, roundingUnit: 1 }).noPriceReason, "NO_RULE");
  assert.deepEqual(surchargeAreaIds([...rules, surcharge("off", "chiba", 1, 1, { status: "disabled" })]), ["tokyo", "fuji"], "停用的不算挂着");
});

test("一端的加价：几个加价区域取最小（一样小取排在前面的）；没有能用的给出原因（没有 / 停用 / 不在生效期）", () => {
  const rules = [surcharge("a", "fuji", 1_000, 900), surcharge("b", "hachioji", 800, 900), pkg("base")];
  const query = { vehicleGroupId: "biz7", packageHours: 8, date: "2026-10-20" };
  assert.deepEqual(areaSurchargeFor(rules, { ...query, areaIds: ["fuji", "hachioji"], end: "pickup" }), { rule: rules[1], areaId: "hachioji", amountMinor: 800, noPriceReason: null });
  assert.equal(areaSurchargeFor(rules, { ...query, areaIds: ["fuji", "hachioji"], end: "dropoff" }).areaId, "fuji", "一样小取排在前面的");
  assert.equal(areaSurchargeFor(rules, { ...query, areaIds: ["hachioji", "fuji"], end: "dropoff" }).areaId, "hachioji");
  assert.equal(areaSurchargeFor(rules, { ...query, areaIds: ["chiba"], end: "pickup" }).noPriceReason, "NO_RULE");
  assert.equal(areaSurchargeFor([surcharge("x", "chiba", 1, 1, { status: "disabled" })], { ...query, areaIds: ["chiba"], end: "pickup" }).noPriceReason, "RULE_DISABLED");
  assert.equal(areaSurchargeFor([surcharge("x", "chiba", 1, 1, { validFrom: "2027-01-01" })], { ...query, areaIds: ["chiba"], end: "pickup" }).noPriceReason, "NOT_IN_EFFECT");
  assert.equal(areaSurchargeFor(rules, { ...query, areaIds: ["fuji"], vehicleGroupId: "eco4", end: "pickup" }).noPriceReason, "NO_RULE", "按车型组填");
});

// ---- 报价 ----

test("ADR 的例子：东京上车、富士山下车 = 基础价 + 0 + 1000；千叶上车、八王子下车 = 基础价 + 500 + 800；两端都在东京 = 基础价", () => {
  assert.equal(total(charter(), trip("tokyo", "fuji")), 51_000);
  assert.equal(total(charter(), trip("chiba", "hachioji")), 51_300);
  assert.equal(total(charter(), trip("tokyo", "tokyo")), 50_000);
  assert.equal(total(charter(), trip("fuji", "tokyo")), 51_000, "上车在富士山：加的是上车加价");
  // 明细：base 含加价（调价作用在合计上），area_surcharge 逐项写清；各项之和仍等于总价
  const s = settlementOf(charter(), trip("chiba", "hachioji"));
  assert.deepEqual([s.totalMinor, s.baseMinor, s.adjustMinor, s.exact.base], [51_300, 51_300, 0, "51300"]);
  assert.deepEqual(s.areaSurcharge, { packageMinor: 50_000, pickup: { areaId: "chiba", priceRuleId: "s-chiba", amountMinor: 500 }, dropoff: { areaId: "hachioji", priceRuleId: "s-hachioji", amountMinor: 800 } });
  assert.deepEqual(settlementOf(charter(), trip("tokyo", "tokyo")).areaSurcharge, { packageMinor: 50_000, pickup: { areaId: null, priceRuleId: null, amountMinor: 0 }, dropoff: { areaId: null, priceRuleId: null, amountMinor: 0 } });
});

test("一端落在几个区域：取最小，商品本身的区域算 0；上车点、下车点各判各的", () => {
  // 宽千叶（300）包住千叶（500）：千叶的点取 300
  const product = charter({ surchargeAreas: [FUJI, CHIBA, HACHIOJI, WIDE_CHIBA], priceRules: [pkg("base-8"), ...SURCHARGES, surcharge("s-wide", "wide-chiba", 300, 700)] });
  assert.equal(total(product, trip("chiba", "tokyo")), 50_300);
  assert.equal(total(product, trip("tokyo", "chiba")), 50_500, "下车：千叶 500 比宽千叶 700 小");
  // 商品本身的区域盖住加价区域时算 0
  const covered = charter({ areas: [area("tokyo", square(139.1, 35.5, 139.9, 35.9))] });
  assert.equal(total(covered, trip("hachioji", "tokyo")), 50_000);
});

test("哪里都不在 = 不报价、转人工（OUT_OF_SERVICE_AREA）；落在禁行区里而没有别的区域接 = IN_FORBIDDEN_AREA；停用的加价区域不算", () => {
  assert.equal(total(charter(), trip("tokyo", "nowhere")), "OUT_OF_SERVICE_AREA");
  assert.equal(total(charter(), trip("nowhere", "tokyo")), "OUT_OF_SERVICE_AREA");
  const forbidChiba: QuoteArea = { ...CHIBA, shapes: [...CHIBA.shapes, { id: "chiba-no", kind: "forbid", ring: square(140.05, 35.6, 140.15, 35.8) }] };
  assert.equal(total(charter({ surchargeAreas: [FUJI, forbidChiba, HACHIOJI] }), trip("tokyo", "chiba")), "IN_FORBIDDEN_AREA");
  assert.equal(total(charter({ surchargeAreas: [FUJI, { ...CHIBA, active: false }, HACHIOJI] }), trip("tokyo", "chiba")), "OUT_OF_SERVICE_AREA");
  // 加价区域的图形在，但没有启用的区域加价：不算挂着
  assert.equal(total(charter({ priceRules: [pkg("base-8"), surcharge("s-chiba", "chiba", 500, 500, { status: "disabled" }), SURCHARGES[0] as PriceRule & { id: string }] }), trip("tokyo", "chiba")), "OUT_OF_SERVICE_AREA");
});

test("上车点不在商品区域里也能报（ADR 0073）：基础定价用下车点所在的商品区域；两端都只在加价区域里时商品的每个区域都算、取最低", () => {
  const second = area("tokyo-east", square(139.85, 35.5, 139.95, 35.9));
  const product = charter({ areas: [TOKYO, second], priceRules: [pkg("base-8"), pkg("east-8", { areaId: "tokyo-east" }, 45_000), ...SURCHARGES] });
  const s = settlementOf(product, trip("chiba", "tokyo"));
  assert.deepEqual([s.totalMinor, quoteProduct(product, trip("chiba", "tokyo"), moment).ok], [50_500, true], "下车点在东京（不在东边那块）：用东京的套餐价");
  assert.equal(total(product, trip("chiba", "hachioji")), 46_300, "两端都在加价区域里：两块商品区域都算，取最低 45,000");
  assert.equal(total(product, trip("tokyo", "chiba")), 50_500, "上车点在商品区域里：和以前一样用上车点所在的区域");
});

test("某个车型组、套餐没有能用的区域加价：只这个车型组不报（原因同缺价）；别的车型组照常", () => {
  const product = charter({ priceRules: [pkg("base-8"), pkg("eco-8", { vehicleGroupId: "eco4" }, 30_000), ...SURCHARGES] });
  const quoted = quoteProduct(product, trip("tokyo", "fuji", { vehicleGroupIds: [] }), moment);
  assert.ok(quoted.ok);
  assert.deepEqual(quoted.offers.map((offer) => [offer.vehicleGroupId, offer.settlement.totalMinor]), [["biz7", 51_000]]);
  assert.deepEqual(quoted.refused, [{ vehicleGroupId: "eco4", reason: "NO_PRICE_RULE" }]);
  assert.equal(total(charter({ priceRules: [pkg("base-8"), surcharge("s-fuji", "fuji", 1_000, 1_000, { status: "disabled" })] }), trip("tokyo", "fuji")), "OUT_OF_SERVICE_AREA", "富士山没有启用的区域加价：不算挂着");
  assert.equal(total(charter({ priceRules: [pkg("base-8"), surcharge("s-fuji", "fuji", 1_000, 1_000, { status: "disabled" }), surcharge("s-fuji4", "fuji", 1, 1, { packageHours: 4 })] }), trip("tokyo", "fuji")), "PRICE_RULE_DISABLED", "8 小时的停用了，4 小时的启用着");
  assert.equal(total(charter({ priceRules: [pkg("base-8"), surcharge("s-fuji", "fuji", 1_000, 1_000, { validFrom: "2027-01-01" })] }), trip("tokyo", "fuji")), "PRICE_NOT_IN_EFFECT");
});

test("调价（节假日、急单、夜间这类）作用在「基础定价 + 加价」的合计上，和以前作用在套餐价上一样；加急费、夜间费另加不参与调价", () => {
  const product = charter({ adjustRules: [adjust("旺季 +10%", [{ type: "percent", value: 1_000 }]), adjust("立减 300", [{ type: "amount", value: -300 }])] });
  // (50000 + 500 + 800) × 1.1 − 300 = 56130
  const s = settlementOf(product, trip("chiba", "hachioji"));
  assert.deepEqual([s.totalMinor, s.baseMinor, s.adjustMinor], [56_130, 51_300, 4_830]);
  // 取整单位：只在最后取整一次
  assert.equal(total({ ...product, roundingUnit: 100 }, trip("chiba", "hachioji")), 56_100);
  // 加急费不参与调价
  const urgent = charter({ adjustRules: product.adjustRules, serviceRules: { ...product.serviceRules, urgent: { enabled: true, dailyQuota: null, tiers: [{ withinHours: 12, surchargeMinor: 2_000 }] } } });
  assert.equal(total(urgent, trip("chiba", "hachioji", { serviceLocal: "2026-10-07T20:00" })), 58_130);
});

test("没给下车点（只有渠道接口暂时允许）：没设区域加价的商品和以前一模一样（只看上车点）；设了的不报（DROPOFF_REQUIRED）", () => {
  const plain = charter({ priceRules: [pkg("base-8")], surchargeAreas: [] });
  assert.equal(total(plain, trip("tokyo", null)), 50_000);
  assert.equal(total(plain, trip("chiba", null)), "OUT_OF_SERVICE_AREA");
  assert.equal(settlementOf(plain, trip("tokyo", null)).areaSurcharge, undefined, "没判断下车点：明细里没有区域加价");
  assert.equal(total(charter(), trip("tokyo", null)), "DROPOFF_REQUIRED");
  // 给了下车点、没设区域加价：下车点出了商品区域就不报（ADR 0073 第三部分第 5 节）
  assert.equal(total(plain, trip("tokyo", "fuji")), "OUT_OF_SERVICE_AREA");
  assert.equal(total(plain, trip("tokyo", "tokyo")), 50_000);
});

// ---- 对外价参考 ----

test("对外价参考：上车、下车加价各自按这一单的汇率、缓冲、加价比例换成客人币种，单独四舍五入；写进快照的中标对外价里", () => {
  assert.equal(sellEquivalentMinor(800, "JPY", { currency: "JPY", fx: null, fxBufferBp: 0, markupBp: 1_500 }), 920);
  // 跨币种：800 日元 × 0.0067 × 1.015 × 1.15 = 6.256… 美元 → 626 美分
  assert.equal(sellEquivalentMinor(800, "JPY", { currency: "USD", fx: { from: "JPY", to: "USD", rate: "0.0067", asOf: "2026-10-07T00:00:00Z" }, fxBufferBp: 150, markupBp: 1_500 }), 626);
  const quoted = quoteProduct(charter(), trip("chiba", "hachioji"), moment);
  const comparison = compareQuotes({ request: trip("chiba", "hachioji"), currency: "JPY", now: moment.now, entries: [{ quote: quoted, productVersion: 3, standing: { scoreCenti: null, completedOrders: 0, observation: false }, markupBp: () => 1_500, fx: null }] });
  const winner = comparison.groups[0]?.snapshot.winner;
  assert.deepEqual([winner?.sell.sellMinor, winner?.sell.areaSurcharge], [58_995, { pickupMinor: 575, dropoffMinor: 920 }]);
  // 没有区域加价的报价不带这一项
  const plain = compareQuotes({ request: trip("tokyo", null), currency: "JPY", now: moment.now, entries: [{ quote: quoteProduct(charter({ priceRules: [pkg("b")] }), trip("tokyo", null), moment), productVersion: 1, standing: { scoreCenti: null, completedOrders: 0, observation: false }, markupBp: () => 1_500, fx: null }] });
  assert.equal(plain.groups[0]?.snapshot.winner.sell.areaSurcharge, undefined);
});
