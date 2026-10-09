/**
 * M2-01 报价引擎：和需求文档《用车报价服务平台》「报价引擎」的 13 步、计价公式、取整规则、时区，以及各轮决策逐项对应。
 * 每条测试的名字里标着它对应的是哪一步 / 哪条公式 / 哪一轮决策。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Position } from "./areas.ts";
import type { AdjustRule, PriceRule, Pricing } from "./pricing.ts";
import { type ServiceRules, emptyServiceRules } from "./products.ts";
import {
  QUOTE_REFUSALS,
  QUOTE_RULES,
  type QuoteMoment,
  type QuoteProduct,
  type QuoteRefusal,
  type QuoteRequest,
  type RankCandidate,
  effectiveScoreCenti,
  quoteCheckPoints,
  quoteExpiresAt,
  quoteProduct,
  quoteRequestIssues,
  quoteSnapshotValid,
  rankCandidates,
  rateFraction,
  sellPrice,
} from "./quote.ts";

// 东京的两块营运区（A1 西、A2 东，中间重叠一条），A2 里有一块禁行区
const square = (west: number, south: number, east: number, north: number): Position[] => [[west, south], [east, south], [east, north], [west, north], [west, south]];
const AREA_1 = { areaId: "a1", active: true, shapes: [{ id: "a1-op", kind: "operate" as const, ring: square(139.0, 35.0, 139.6, 36.0) }] };
const AREA_2 = { areaId: "a2", active: true, shapes: [{ id: "a2-op", kind: "operate" as const, ring: square(139.5, 35.0, 140.0, 36.0) }, { id: "a2-no", kind: "forbid" as const, ring: square(139.8, 35.4, 139.9, 35.6) }] };
const WEST = { lng: 139.2, lat: 35.5 }; // 只在 A1
const OVERLAP = { lng: 139.55, lat: 35.5 }; // A1 和 A2 都在
const EAST = { lng: 139.7, lat: 35.5 }; // 只在 A2
const FORBIDDEN = { lng: 139.85, lat: 35.5 }; // A2 的禁行区里
const FAR = { lng: 141.0, lat: 35.5 }; // 哪个区域都不在

const fixed = (basePriceMinor: number): Pricing => ({ model: "fixed", basePriceMinor });
const price = (pricing: Pricing, extra: Partial<PriceRule> = {}): PriceRule & { id: string } => ({ id: `p-${extra.areaId ?? "a1"}-${extra.vehicleGroupId ?? "biz7"}-${extra.direction ?? "both"}-${extra.validFrom ?? ""}`, areaId: "a1", vehicleGroupId: "biz7", direction: "both", packageHours: null, pricing, validFrom: "2026-01-01", validTo: null, status: "enabled", ...extra });
const adjust = (name: string, steps: AdjustRule["steps"], extra: Partial<AdjustRule> = {}): AdjustRule & { id: string } => ({ id: `adj-${name}`, name, travelFrom: null, travelTo: null, cycle: { type: "daily" }, timeSlot: null, areaIds: [], vehicleGroupIds: [], directions: [], packageHours: [], steps, status: "enabled", ...extra });

const rules = (extra: Partial<ServiceRules> = {}): ServiceRules => ({
  ...emptyServiceRules(),
  booking: { saleFrom: null, saleTo: null, serviceTime: { start: "00:00", end: "24:00" }, leadTimeHours: 24, note: null },
  freeWait: { pickup: { mode: "limited", minutes: 90 }, dropoff: { mode: "limited", minutes: 15 }, general: null },
  ...extra,
});

/** 一个已上架的接送机商品（成田机场，东京，日元，取整单位 1）。 */
const product = (extra: Partial<QuoteProduct> = {}): QuoteProduct => ({
  productId: "prd-1",
  tenantId: "tenant-a",
  category: "airport_transfer",
  status: "published",
  tenantActive: true,
  brandActive: true,
  currency: "JPY",
  roundingUnit: 1,
  timeZone: "Asia/Tokyo",
  pickupPlace: { type: "airport", flightScope: "international" },
  areas: [AREA_1, AREA_2],
  vehicleGroups: [{ vehicleGroupId: "biz7", passengers: 6, luggage: 4, active: true }, { vehicleGroupId: "eco4", passengers: 3, luggage: 2, active: true }],
  serviceRules: rules(),
  addonCatalog: [],
  priceRules: [price(fixed(20_000))],
  adjustRules: [],
  inventoryMode: "unlimited",
  ...extra,
});

/** 接机到 WEST，2026-10-20 10:00（东京），2 人 1 件行李。 */
const request = (extra: Partial<QuoteRequest> = {}): QuoteRequest => ({ category: "airport_transfer", pickup: null, dropoff: WEST, direction: "pickup", packageHours: null, serviceLocal: "2026-10-20T10:00", passengers: 2, luggage: 1, addons: [], driverLanguage: null, vehicleGroupIds: ["biz7"], ...extra });
// 现在是东京 2026-10-07 10:00（离用车 13 天）
const moment = (extra: Partial<QuoteMoment> = {}): QuoteMoment => ({ now: new Date("2026-10-07T01:00:00Z"), route: null, inventoryDay: null, urgentUsed: 0, ...extra });

const seenRefusals = new Set<QuoteRefusal>();
/** 报价结果写成一行：商品层面被拒给原因；否则给每个车型组的结算价或原因。 */
function outcome(p: QuoteProduct, r: QuoteRequest = request(), m: QuoteMoment = moment(), options: { forOwner?: boolean } = {}): unknown {
  const quoted = quoteProduct(p, r, m, options);
  if (!quoted.ok) {
    seenRefusals.add(quoted.reason);
    return quoted.reason;
  }
  for (const entry of quoted.refused) seenRefusals.add(entry.reason);
  const all = [...quoted.offers.map((offer) => [offer.vehicleGroupId, offer.settlement.totalMinor] as const), ...quoted.refused.map((entry) => [entry.vehicleGroupId, entry.reason] as const)];
  return all.length === 1 ? (all[0] as readonly unknown[])[1] : Object.fromEntries(all);
}
const settlement = (p: QuoteProduct, r: QuoteRequest = request(), m: QuoteMoment = moment()) => {
  const quoted = quoteProduct(p, r, m);
  assert.ok(quoted.ok && quoted.offers.length === 1, JSON.stringify(quoted));
  return (quoted.offers[0] as (typeof quoted.offers)[number]).settlement;
};
const offer = (p: QuoteProduct, r: QuoteRequest = request(), m: QuoteMoment = moment()) => {
  const quoted = quoteProduct(p, r, m);
  assert.ok(quoted.ok && quoted.offers.length === 1, JSON.stringify(quoted));
  return quoted.offers[0] as (typeof quoted.offers)[number];
};

test("第 1 步 入参：品类该给的要给（接送机的方向、包车的套餐时长、要校验的那一端的坐标），不该给的不能给；人数、行李、附加服务个数在范围里", () => {
  assert.deepEqual(quoteRequestIssues(request()), []);
  assert.deepEqual(quoteRequestIssues(request({ direction: null })), [{ path: "/direction", reason: "REQUIRED" }]);
  assert.deepEqual(quoteRequestIssues(request({ dropoff: null })), [{ path: "/dropoff", reason: "REQUIRED" }], "接机要给下车点");
  assert.deepEqual(quoteRequestIssues(request({ direction: "dropoff" })), [{ path: "/pickup", reason: "REQUIRED" }], "送机要给上车点");
  assert.deepEqual(quoteRequestIssues(request({ packageHours: 10 })), [{ path: "/package_hours", reason: "NOT_APPLICABLE" }]);
  const charter = request({ category: "charter", direction: null, packageHours: 10, pickup: WEST, dropoff: null });
  assert.deepEqual(quoteRequestIssues(charter), []);
  assert.deepEqual(quoteRequestIssues({ ...charter, packageHours: null, direction: "pickup" }), [{ path: "/direction", reason: "NOT_APPLICABLE" }, { path: "/package_hours", reason: "REQUIRED" }]);
  assert.deepEqual(quoteRequestIssues({ ...charter, packageHours: 73 }), [{ path: "/package_hours", reason: "OUT_OF_RANGE" }]);
  assert.deepEqual(quoteRequestIssues(request({ category: "point_to_point", direction: null, pickup: null })), [{ path: "/pickup", reason: "REQUIRED" }], "点对点两端都要给");
  assert.deepEqual(quoteRequestIssues(request({ serviceLocal: "2026-02-30T10:00" })), [{ path: "/service_time", reason: "INVALID_SERVICE_TIME" }]);
  assert.deepEqual(quoteRequestIssues(request({ passengers: 0, luggage: -1 })), [{ path: "/passengers", reason: "OUT_OF_RANGE" }, { path: "/luggage", reason: "OUT_OF_RANGE" }]);
  assert.deepEqual(quoteRequestIssues(request({ addons: [{ addonId: "x", quantity: 1 }, { addonId: "x", quantity: 0 }] })), [{ path: "/addons/1/addon_id", reason: "DUPLICATE" }, { path: "/addons/1/quantity", reason: "OUT_OF_RANGE" }]);
});

test("第 2 步 找商品：没上架的、供应商被暂停的、子品牌停用的不报价；供应商自己试算时没上架的商品也算（接口表 quote-preview）", () => {
  assert.equal(outcome(product({ status: "draft" })), "PRODUCT_NOT_PUBLISHED");
  assert.equal(outcome(product({ status: "unpublished" })), "PRODUCT_NOT_PUBLISHED");
  assert.equal(outcome(product({ tenantActive: false })), "TENANT_SUSPENDED");
  assert.equal(outcome(product({ brandActive: false })), "BRAND_DISABLED");
  assert.equal(outcome(product({ status: "draft", tenantActive: false }), request(), moment(), { forOwner: true }), 20_000);
  assert.equal(outcome(product({ status: "draft", serviceRules: emptyServiceRules() }), request(), moment(), { forOwner: true }), "SERVICE_RULES_INCOMPLETE");
});

test("第 3 步 服务规则：下单有效期（看下单那天）、每日服务时间、提前预订时长；不足时开了加急走加急，没开就不报价（错误码 LEAD_TIME_TOO_SHORT）", () => {
  const booking = (extra: Partial<ServiceRules["booking"]>, urgent?: ServiceRules["urgent"]): QuoteProduct => product({ serviceRules: rules({ booking: { ...rules().booking, ...extra }, ...(urgent ? { urgent } : {}) }) });
  assert.equal(outcome(booking({ saleFrom: "2026-10-08" })), "OUTSIDE_SALE_PERIOD", "今天 10-07，有效期从 10-08 起");
  assert.equal(outcome(booking({ saleTo: "2026-10-06" })), "OUTSIDE_SALE_PERIOD");
  assert.equal(outcome(booking({ saleFrom: "2026-10-07", saleTo: "2026-10-07" })), 20_000, "有效期看的是下单那天，不是用车那天");
  assert.equal(outcome(booking({ serviceTime: { start: "11:00", end: "22:00" } })), "OUTSIDE_SERVICE_TIME", "用车 10:00");
  assert.equal(outcome(booking({ serviceTime: { start: "08:00", end: "10:00" } })), 20_000, "两端都算在内");
  assert.equal(outcome(product(), request({ serviceLocal: "2026-10-07T09:59" })), "SERVICE_TIME_PASSED");
  assert.equal(outcome(product(), request({ serviceLocal: "2026-02-30T10:00" })), "INVALID_SERVICE_TIME");
  // 提前 24 小时：正好 24 小时可以；差一分钟、没开加急就不报
  assert.equal(outcome(product(), request({ serviceLocal: "2026-10-08T10:00" })), 20_000);
  assert.equal(outcome(product(), request({ serviceLocal: "2026-10-08T09:59" })), "LEAD_TIME_TOO_SHORT");
  // 开了加急：取最小的命中的一档（离用车 5 小时，有 12 小时内、6 小时内两档 → 6 小时内）
  const urgent = { enabled: true, dailyQuota: 2, tiers: [{ withinHours: 12, surchargeMinor: 2_000 }, { withinHours: 6, surchargeMinor: 5_000 }] };
  const five = request({ serviceLocal: "2026-10-07T15:00" });
  const quoted = settlement(booking({}, urgent), five);
  assert.deepEqual([quoted.totalMinor, quoted.urgentMinor, quoted.urgentTier], [25_000, 5_000, { withinHours: 6, surchargeMinor: 5_000 }]);
  assert.equal(outcome(booking({}, urgent), request({ serviceLocal: "2026-10-07T20:00" })), 22_000, "离用车 10 小时：12 小时内那一档");
  assert.equal(outcome(booking({}, urgent), request({ serviceLocal: "2026-10-08T02:00" })), "LEAD_TIME_TOO_SHORT", "离用车 16 小时：不够 24 小时，也没有够用的一档");
  assert.equal(outcome(booking({}, { ...urgent, enabled: false }), five), "LEAD_TIME_TOO_SHORT", "阶梯留着但没开加急");
});

test("第 9 步 库存：有限库存时当日剩余 > 0 才报（错误码 SOLD_OUT）；加急单另查每日加急库存", () => {
  const limited = product({ inventoryMode: "limited" });
  assert.equal(outcome(limited, request(), moment({ inventoryDay: null })), "SOLD_OUT", "限量而这一天没设过");
  assert.equal(outcome(limited, request(), moment({ inventoryDay: { total: 3, held: 1, sold: 2 } })), "SOLD_OUT");
  assert.equal(outcome(limited, request(), moment({ inventoryDay: { total: 0, held: 0, sold: 0 } })), "SOLD_OUT", "0 = 停售");
  assert.equal(outcome(limited, request(), moment({ inventoryDay: { total: 3, held: 1, sold: 1 } })), 20_000);
  assert.equal(outcome(product(), request(), moment({ inventoryDay: { total: 0, held: 0, sold: 0 } })), 20_000, "不限量的不看");
  const urgent = product({ serviceRules: rules({ urgent: { enabled: true, dailyQuota: 2, tiers: [{ withinHours: 12, surchargeMinor: 2_000 }] } }) });
  const soon = request({ serviceLocal: "2026-10-07T20:00" });
  assert.equal(outcome(urgent, soon, moment({ urgentUsed: 1 })), 22_000);
  assert.equal(outcome(urgent, soon, moment({ urgentUsed: 2 })), "URGENT_SOLD_OUT");
  assert.equal(outcome(urgent, request(), moment({ urgentUsed: 99 })), 20_000, "不走加急的单不看加急库存");
  assert.equal(outcome(product({ serviceRules: rules({ urgent: { enabled: true, dailyQuota: null, tiers: [{ withinHours: 12, surchargeMinor: 2_000 }] } }) }), soon, moment({ urgentUsed: 99 })), 22_000, "加急库存不限");
});

test("第 4 步 区域校验：接送机只校验非机场一端，点对点两端都要在营运区，包车只校验上车点（「区域管理」的区域规则）", () => {
  assert.deepEqual([quoteCheckPoints({ category: "airport_transfer", direction: "pickup" }), quoteCheckPoints({ category: "airport_transfer", direction: "dropoff" }), quoteCheckPoints({ category: "point_to_point", direction: null }), quoteCheckPoints({ category: "charter", direction: null })], [["dropoff"], ["pickup"], ["pickup", "dropoff"], ["pickup"]]);
  // 接机：只看下车点；上车点（机场）给了什么都不管
  assert.equal(outcome(product(), request({ dropoff: WEST, pickup: FAR })), 20_000);
  assert.equal(outcome(product(), request({ dropoff: FAR })), "OUT_OF_SERVICE_AREA");
  // 送机：只看上车点
  assert.equal(outcome(product(), request({ direction: "dropoff", pickup: WEST, dropoff: FAR })), 20_000);
  assert.equal(outcome(product(), request({ direction: "dropoff", pickup: FAR, dropoff: WEST })), "OUT_OF_SERVICE_AREA");
  // 点对点：两端都要在营运区
  const p2p = product({ category: "point_to_point", pickupPlace: null, priceRules: [price(fixed(8_000), { direction: null })], serviceRules: rules({ freeWait: { pickup: null, dropoff: null, general: { mode: "limited", minutes: 15 } } }) });
  const trip = (pickup: typeof WEST, dropoff: typeof WEST): QuoteRequest => request({ category: "point_to_point", direction: null, pickup, dropoff });
  assert.equal(outcome(p2p, trip(WEST, OVERLAP)), 8_000);
  assert.equal(outcome(p2p, trip(WEST, FAR)), "OUT_OF_SERVICE_AREA");
  assert.equal(outcome(p2p, trip(FAR, WEST)), "OUT_OF_SERVICE_AREA");
  // 包车：只看上车点
  const charter = product({ category: "charter", pickupPlace: null, priceRules: [price({ model: "charter_package", packageKm: 300, packagePriceMinor: 98_000, overtimePerHourMinor: 5_000, overKmPerKmMinor: 400 }, { direction: null, packageHours: 10 })], serviceRules: rules({ freeWait: { pickup: null, dropoff: null, general: { mode: "unlimited" } } }) });
  const day = (pickup: typeof WEST, dropoff: typeof WEST | null): QuoteRequest => request({ category: "charter", direction: null, packageHours: 10, pickup, dropoff });
  assert.equal(outcome(charter, day(WEST, FAR)), 98_000);
  assert.equal(outcome(charter, day(FAR, WEST)), "OUT_OF_SERVICE_AREA");
});

test("第 4 步 禁行优先：点落在禁行区就不报（没有别的区域能接时）；停用的区域不算；另一个区域的营运区包着这个点时由那个区域接", () => {
  assert.equal(outcome(product(), request({ dropoff: FORBIDDEN })), "IN_FORBIDDEN_AREA");
  const p2p = product({ category: "point_to_point", pickupPlace: null, priceRules: [price(fixed(8_000), { direction: null })] });
  assert.equal(outcome(p2p, request({ category: "point_to_point", direction: null, pickup: WEST, dropoff: FORBIDDEN })), "IN_FORBIDDEN_AREA", "起点或终点落入禁行区就不报价");
  assert.equal(outcome(product({ areas: [{ ...AREA_1, active: false }, AREA_2] }), request({ dropoff: WEST })), "OUT_OF_SERVICE_AREA", "只在已停用的区域里");
  // 第三个区域的营运区盖住了 A2 的禁行区：由它接（禁行区只管它所在的那个区域，ADR 0015）
  const cover = { areaId: "a3", active: true, shapes: [{ id: "a3-op", kind: "operate" as const, ring: square(139.75, 35.3, 139.95, 35.7) }] };
  const covered = product({ areas: [AREA_1, AREA_2, cover], priceRules: [price(fixed(20_000), { areaId: "a2" }), price(fixed(26_000), { areaId: "a3" })] });
  const quoted = offer(covered, request({ dropoff: FORBIDDEN }));
  assert.deepEqual([quoted.areaId, quoted.settlement.totalMinor], ["a3", 26_000], "A2 更便宜，但这个点在 A2 的禁行区里，不能用 A2 的价");
});

test("第 4 步 + 已确认的决策：一个点落在同一租户多个区域时每个区域都算、取最低；点对点起终点在不同区域时两端区域的价都算、取最低；一样低取排在前面的区域", () => {
  const both = product({ priceRules: [price(fixed(20_000), { areaId: "a1" }), price(fixed(18_000), { areaId: "a2" })] });
  assert.deepEqual([offer(both, request({ dropoff: OVERLAP })).areaId, offer(both, request({ dropoff: OVERLAP })).settlement.totalMinor], ["a2", 18_000]);
  assert.equal(outcome(both, request({ dropoff: WEST })), 20_000, "只在 A1 里：只有 A1 的价");
  assert.equal(outcome(both, request({ dropoff: EAST })), 18_000);
  // 调价只调 A2：+30% 之后 A1 更低
  const adjusted = { ...both, adjustRules: [adjust("A2 旺季", [{ type: "percent" as const, value: 3_000 }], { areaIds: ["a2"] })] };
  assert.deepEqual([offer(adjusted, request({ dropoff: OVERLAP })).areaId, offer(adjusted, request({ dropoff: OVERLAP })).settlement.totalMinor], ["a1", 20_000]);
  // 一样低：取商品里排在前面的区域
  const same = product({ priceRules: [price(fixed(20_000), { areaId: "a1" }), price(fixed(20_000), { areaId: "a2" })] });
  assert.equal(offer(same, request({ dropoff: OVERLAP })).areaId, "a1");
  assert.equal(offer({ ...same, areas: [AREA_2, AREA_1] }, request({ dropoff: OVERLAP })).areaId, "a2");
  // 其中一个区域没有价：用有价的那个
  assert.equal(outcome(product({ priceRules: [price(fixed(21_000), { areaId: "a2" })] }), request({ dropoff: OVERLAP })), 21_000);
  // 点对点：起点只在 A1、终点只在 A2，两个区域的价都算
  const p2p = product({ category: "point_to_point", pickupPlace: null, priceRules: [price(fixed(9_000), { areaId: "a1", direction: null }), price(fixed(7_000), { areaId: "a2", direction: null })] });
  const trip = request({ category: "point_to_point", direction: null, pickup: WEST, dropoff: EAST });
  assert.deepEqual([offer(p2p, trip).areaId, offer(p2p, trip).settlement.totalMinor], ["a2", 7_000]);
  assert.equal(outcome({ ...p2p, priceRules: [price(fixed(9_000), { areaId: "a1", direction: null })] }, trip), 9_000, "只有起点所在的区域有价");
});

test("第 5 步 命中价格规则：区域 × 车型组 × 方向或套餐，启用且用车日期在生效期内；具体方向优先于接送通用；人数或行李超过车型组合的不报", () => {
  const p = product({ priceRules: [price(fixed(20_000), { direction: "both" }), price(fixed(18_000), { direction: "pickup" }), price(fixed(12_000), { vehicleGroupId: "eco4", direction: "dropoff" })] });
  assert.deepEqual(outcome(p, request({ vehicleGroupIds: [] })), { biz7: 18_000, eco4: "NO_PRICE_RULE" }, "接机：商务用具体方向的价；经济只有送机的价");
  assert.deepEqual(outcome(p, request({ direction: "dropoff", pickup: WEST, dropoff: null, vehicleGroupIds: [] })), { biz7: 20_000, eco4: 12_000 });
  // 人数、行李：正好等于组合可以，多一个不报
  assert.deepEqual(outcome(p, request({ passengers: 6, luggage: 4, vehicleGroupIds: [] })), { biz7: 18_000, eco4: "CAPACITY_EXCEEDED" });
  assert.equal(outcome(p, request({ passengers: 7 })), "CAPACITY_EXCEEDED");
  assert.equal(outcome(p, request({ luggage: 5 })), "CAPACITY_EXCEEDED");
  // 生效期两端都含；过了、还没到、停用
  const dated = (extra: Partial<PriceRule>): QuoteProduct => product({ priceRules: [price(fixed(20_000), extra)] });
  assert.equal(outcome(dated({ validFrom: "2026-10-20", validTo: "2026-10-20" })), 20_000);
  assert.equal(outcome(dated({ validFrom: "2026-10-21" })), "PRICE_NOT_IN_EFFECT");
  assert.equal(outcome(dated({ validTo: "2026-10-19" })), "PRICE_NOT_IN_EFFECT");
  assert.equal(outcome(dated({ status: "disabled" })), "PRICE_RULE_DISABLED");
  assert.equal(outcome(product({ priceRules: [] })), "NO_PRICE_RULE");
  // 请求指定的车型组：商品没选的、已被平台停用的
  assert.equal(outcome(product(), request({ vehicleGroupIds: ["lux4"] })), "VEHICLE_GROUP_NOT_OFFERED");
  assert.equal(outcome(product({ vehicleGroups: [{ vehicleGroupId: "biz7", passengers: 6, luggage: 4, active: false }] })), "VEHICLE_GROUP_DISABLED");
});

test("第 6 步 + 计价公式（固定一口价）：P_base = 基础价", () => {
  const quoted = settlement(product());
  assert.deepEqual([quoted.totalMinor, quoted.baseMinor, quoted.adjustMinor, quoted.exact.base, quoted.usage], [20_000, 20_000, 0, "20000", null]);
});

test("第 6 步 + 计价公式（里程 + 时长）：P_base = max(P_min, P_start + max(0, D − D_start)·p_km + max(0, T − T_start)·p_min)，D、T 来自路线预估；取不到预估就不报（一口价不受影响）", () => {
  const metered: Pricing = { model: "mileage_time", startPriceMinor: 3_000, startMeters: 5_000, startMinutes: 20, perKmMinor: 400, perMinuteMinor: 80, minPriceMinor: 6_000 };
  const p = product({ priceRules: [price(metered)] });
  // 12.5 公里、45 分钟：3000 + 7.5 × 400 + 25 × 80 = 8000
  const quoted = settlement(p, request(), moment({ route: { meters: 12_500, minutes: 45 } }));
  assert.deepEqual([quoted.totalMinor, quoted.exact.base, quoted.usage], [8_000, "8000", { meters: 12_500, minutes: 45 }]);
  // 没超出起步：3000，低于最低消费 6000 → 6000
  assert.equal(outcome(p, request(), moment({ route: { meters: 4_000, minutes: 10 } })), 6_000);
  // 超 1 米按 1/1000 公里收：3000 + 0.4 + 6 × 80 = 3480.4 < 6000；去掉最低消费后 3480.4 → 3480
  assert.equal(outcome(product({ priceRules: [price({ ...metered, minPriceMinor: null })] }), request(), moment({ route: { meters: 5_001, minutes: 26 } })), 3_480);
  // 取不到路线预估：里程 + 时长的不报，一口价照常
  assert.equal(outcome(p, request(), moment({ route: null })), "ROUTE_UNAVAILABLE");
  const mixed = product({ priceRules: [price(metered), price(fixed(15_000), { vehicleGroupId: "eco4" })] });
  assert.deepEqual(outcome(mixed, request({ vehicleGroupIds: [] }), moment({ route: null })), { biz7: "ROUTE_UNAVAILABLE", eco4: 15_000 });
});

test("第 6 步 + 计价公式（包车套餐）：报价时 H = 套餐时长，P_base = P_pkg（超时、超公里履约后按实际结算）；按套餐时长命中各自的价", () => {
  const pkg = (hours: number, priceMinor: number): PriceRule & { id: string } => price({ model: "charter_package", packageKm: hours * 30, packagePriceMinor: priceMinor, overtimePerHourMinor: 5_000, overKmPerKmMinor: 400 }, { direction: null, packageHours: hours, validFrom: `2026-01-0${hours === 5 ? 1 : 2}` });
  const charter = product({ category: "charter", pickupPlace: null, priceRules: [pkg(5, 55_000), pkg(10, 98_000)], serviceRules: rules({ freeWait: { pickup: null, dropoff: null, general: { mode: "unlimited" } } }) });
  const day = (hours: number): QuoteRequest => request({ category: "charter", direction: null, packageHours: hours, pickup: WEST, dropoff: null });
  assert.deepEqual([outcome(charter, day(5)), outcome(charter, day(10)), outcome(charter, day(8))], [55_000, 98_000, "NO_PRICE_RULE"]);
  assert.equal(offer(charter, day(10)).packageHours, 10);
  // 有没有路线预估都一样：包车套餐不看预估
  assert.equal(outcome(charter, day(10), moment({ route: { meters: 999_000, minutes: 9_999 } })), 98_000);
});

test("第 7 步 调价：筛出匹配的规则，按优先级顺序链式执行，后一步以前一步的结果为基数；顺序换了结果不同；停用的、范围不对的不参与", () => {
  const up = adjust("旺季 +20%", [{ type: "percent", value: 2_000 }]);
  const off = adjust("立减 1000", [{ type: "amount", value: -1_000 }]);
  const quoted = settlement(product({ adjustRules: [up, off] }));
  assert.deepEqual([quoted.totalMinor, quoted.baseMinor, quoted.adjustMinor, quoted.adjusts.map((entry) => [entry.name, entry.steps.map((step) => step.after)])], [23_000, 20_000, 3_000, [["旺季 +20%", ["24000"]], ["立减 1000", ["23000"]]]]);
  assert.equal(outcome(product({ adjustRules: [off, up] })), 22_800, "先减 1000 再 +20%");
  assert.equal(outcome(product({ adjustRules: [{ ...up, status: "disabled" }, off] })), 19_000);
  assert.equal(outcome(product({ adjustRules: [{ ...up, vehicleGroupIds: ["eco4"] }, { ...off, directions: ["dropoff"] }] })), 20_000);
  // 每周五 22:00–06:00 的调价：周六 05:59 还在（算在开始那天头上），06:00 没了。2026-10-24 是周六
  const night = adjust("周五夜间", [{ type: "percent", value: 1_000 }], { cycle: { type: "weekly", weekdays: [5] }, timeSlot: { start: "22:00", end: "06:00" } });
  assert.deepEqual([outcome(product({ adjustRules: [night] }), request({ serviceLocal: "2026-10-24T05:59" })), outcome(product({ adjustRules: [night] }), request({ serviceLocal: "2026-10-24T06:00" }))], [22_000, 20_000]);
  // 调完不大于 0、超过上限：不报
  assert.equal(outcome(product({ adjustRules: [adjust("减太多", [{ type: "amount", value: -20_000 }])] })), "PRICE_NOT_POSITIVE");
  assert.equal(outcome(product({ adjustRules: [adjust("乘太多", Array.from({ length: 10 }, () => ({ type: "percent" as const, value: 100_000 })))] })), "PRICE_OVER_LIMIT");
});

test("第 8 步 夜间费（「服务规则」：按次，或按与夜间时段重叠的小时数；时段可跨天）", () => {
  const night = (chargeUnit: "per_order" | "per_hour"): QuoteProduct => product({ serviceRules: rules({ night: { enabled: true, window: { start: "22:00", end: "06:00" }, amountMinor: 3_000, chargeUnit } }) });
  const at = (time: string): QuoteRequest => request({ serviceLocal: `2026-10-20T${time}` });
  // 按次：用车开始的时刻在夜间时段里收一次；开始含、结束不含
  assert.deepEqual(["21:59", "22:00", "23:30", "00:00", "05:59", "06:00", "12:00"].map((time) => outcome(night("per_order"), at(time))), [20_000, 23_000, 23_000, 23_000, 23_000, 20_000, 20_000]);
  assert.deepEqual(settlement(night("per_order"), at("23:30")).night, { chargeUnit: "per_order", overlapMinutes: null });
  // 按小时、接送机有路线预估：21:30 出发、90 分钟 → 和 22:00 之后重叠 60 分钟 = 1 小时
  assert.equal(outcome(night("per_hour"), at("21:30"), moment({ route: { meters: 60_000, minutes: 90 } })), 23_000);
  // 重叠 45 分钟：3000 × 45 / 60 = 2250
  assert.equal(outcome(night("per_hour"), at("21:30"), moment({ route: { meters: 60_000, minutes: 75 } })), 22_250);
  assert.equal(outcome(night("per_hour"), at("12:00"), moment({ route: { meters: 60_000, minutes: 75 } })), 20_000);
  // 按小时、取不到时长（一口价、没有路线预估）：开始时刻在夜间时段里按一小时算
  assert.deepEqual([outcome(night("per_hour"), at("23:00")), outcome(night("per_hour"), at("21:30"))], [23_000, 20_000]);
  // 包车：套餐 10 小时，20:00 出发 → 到次日 06:00，重叠 22:00–06:00 共 8 小时
  const charter = product({ category: "charter", pickupPlace: null, priceRules: [price({ model: "charter_package", packageKm: 300, packagePriceMinor: 98_000, overtimePerHourMinor: 5_000, overKmPerKmMinor: 400 }, { direction: null, packageHours: 10 })], serviceRules: rules({ night: { enabled: true, window: { start: "22:00", end: "06:00" }, amountMinor: 3_000, chargeUnit: "per_hour" }, freeWait: { pickup: null, dropoff: null, general: { mode: "unlimited" } } }) });
  const quoted = settlement(charter, request({ category: "charter", direction: null, packageHours: 10, pickup: WEST, dropoff: null, serviceLocal: "2026-10-20T20:00" }));
  assert.deepEqual([quoted.totalMinor, quoted.nightMinor, quoted.night], [122_000, 24_000, { chargeUnit: "per_hour", overlapMinutes: 480 }]);
  // 没开夜间加价的不收（哪怕时段和金额留着）
  assert.equal(outcome(product({ serviceRules: rules({ night: { enabled: false, window: { start: "22:00", end: "06:00" }, amountMinor: 3_000, chargeUnit: "per_order" } }) }), at("23:00")), 20_000);
});

test("第 8 步 附加服务（「服务规则」：每项开关 + 单价，0 = 免费提供，座椅类可设首个免费；司机语言为「语言 + 单价」）：按次 / 按个 / 按人 / 按时长", () => {
  const catalog = [
    { addonId: "seat", chargeUnit: "per_item" as const, usable: true },
    { addonId: "sign", chargeUnit: "per_order" as const, usable: true },
    { addonId: "water", chargeUnit: "per_person" as const, usable: true },
    { addonId: "guide", chargeUnit: "per_duration" as const, usable: true },
    { addonId: "gone", chargeUnit: "per_order" as const, usable: false },
  ];
  const offered = (addonId: string, unitPriceMinor: number, extra: { enabled?: boolean; firstFree?: boolean } = {}) => ({ addonId, enabled: extra.enabled ?? true, unitPriceMinor, firstFree: extra.firstFree ?? false });
  const p = product({
    addonCatalog: catalog,
    serviceRules: rules({ addons: [offered("seat", 1_000, { firstFree: true }), offered("sign", 500), offered("water", 200), offered("guide", 3_000), offered("gone", 100), offered("off", 100, { enabled: false })], driverLanguages: [{ language: "zh", unitPriceMinor: 5_000 }, { language: "en", unitPriceMinor: 0 }] }),
  });
  const want = (...addons: [string, number][]): QuoteRequest => request({ addons: addons.map(([addonId, quantity]) => ({ addonId, quantity })) });
  // 儿童座椅 2 个、首个免费：1000 × 1
  assert.equal(outcome(p, want(["seat", 2])), 21_000);
  assert.equal(outcome(p, want(["seat", 1])), 20_000, "只要一个：免费");
  // 举牌按次：不管要几个都收一次；饮用水按人（2 人）
  assert.equal(outcome(p, want(["sign", 3], ["water", 1])), 20_900);
  // 导游按时长：有路线预估 90 分钟 → 1.5 小时 × 3000；取不到时长按一小时
  assert.equal(outcome(p, want(["guide", 1]), moment({ route: { meters: 1, minutes: 90 } })), 24_500);
  assert.equal(outcome(p, want(["guide", 1])), 23_000);
  const detailed = settlement(p, want(["seat", 3], ["sign", 1]));
  assert.deepEqual(detailed.addons, [
    { addonId: "seat", chargeUnit: "per_item", quantity: 3, chargedQuantity: "2", firstFree: true, unitPriceMinor: 1_000, amountMinor: 2_000 },
    { addonId: "sign", chargeUnit: "per_order", quantity: 1, chargedQuantity: "1", firstFree: false, unitPriceMinor: 500, amountMinor: 500 },
  ]);
  assert.deepEqual([detailed.totalMinor, detailed.addonsMinor], [22_500, 2_500]);
  // 商品不提供的：没选、关着、被平台停用 / 不适用
  for (const addonId of ["unknown", "off", "gone"]) assert.equal(outcome(p, want([addonId, 1])), "ADDON_NOT_OFFERED", addonId);
  // 司机语言
  assert.deepEqual([outcome(p, request({ driverLanguage: "zh" })), outcome(p, request({ driverLanguage: "en" })), outcome(p, request({ driverLanguage: "ko" }))], [25_000, 20_000, "DRIVER_LANGUAGE_NOT_OFFERED"]);
  assert.deepEqual([settlement(p, request({ driverLanguage: "zh" })).driverLanguageMinor, settlement(p, request({ driverLanguage: "zh" })).driverLanguage], [5_000, "zh"]);
});

test("总价公式 + 取整规则：P_total = Adjust(P_base) + F_urgent + F_night + ΣF_addon；加急、夜间、附加服务不参与调价；只在最后按取整单位取整一次；明细各项之和等于总价，尾差计入调价项", () => {
  const p = product({
    roundingUnit: 100,
    priceRules: [price(fixed(20_050))],
    adjustRules: [adjust("+15.5%", [{ type: "percent", value: 1_550 }])],
    addonCatalog: [{ addonId: "seat", chargeUnit: "per_item", usable: true }],
    serviceRules: rules({
      urgent: { enabled: true, dailyQuota: null, tiers: [{ withinHours: 12, surchargeMinor: 2_030 }] },
      night: { enabled: true, window: { start: "22:00", end: "06:00" }, amountMinor: 1_015, chargeUnit: "per_order" },
      addons: [{ addonId: "seat", enabled: true, unitPriceMinor: 990, firstFree: false }],
    }),
  });
  // 今天 10-07 10:00，用车今晚 22:00（离用车 12 小时：加急）；调价后 20050 × 1.155 = 23157.75
  const quoted = settlement(p, request({ serviceLocal: "2026-10-07T22:00", addons: [{ addonId: "seat", quantity: 1 }] }));
  // 23157.75 + 2030 + 1015 + 990 = 27192.75 → 取整到 100 = 27200
  assert.deepEqual([quoted.exact.adjusted, quoted.exact.total, quoted.totalMinor], ["23157.75", "27192.75", 27_200]);
  assert.deepEqual([quoted.baseMinor, quoted.urgentMinor, quoted.nightMinor, quoted.addonsMinor, quoted.driverLanguageMinor], [20_050, 2_030, 1_015, 990, 0]);
  assert.equal(quoted.adjustMinor, 27_200 - 20_050 - 2_030 - 1_015 - 990, "调价项 = 3107.75 的调价 + 7.25 的取整尾差");
  assert.equal(quoted.baseMinor + quoted.adjustMinor + quoted.urgentMinor + quoted.nightMinor + quoted.addonsMinor + quoted.driverLanguageMinor, quoted.totalMinor);
  // 不是先各自取整再相加：调价后单独取整是 23200，加上 4035 是 27235，不是取整单位的整数倍
  assert.equal(quoted.totalMinor % 100, 0);
  // 取整单位 1：按币种的最小单位四舍五入，恰好一半往大的取
  assert.equal(settlement({ ...p, roundingUnit: 1 }, request({ serviceLocal: "2026-10-20T10:00" })).totalMinor, 23_158);
  assert.equal(settlement(product({ priceRules: [price(fixed(20_001))], adjustRules: [adjust("半价", [{ type: "percent", value: -5_000 }])] })).totalMinor, 10_001, "10000.5 → 10001");
  // 两位小数的币种（人民币）：取整单位 100 = 1 元
  const cny = settlement(product({ currency: "CNY", roundingUnit: 100, priceRules: [price(fixed(46_005))] }));
  assert.deepEqual([cny.currency, cny.totalMinor, cny.baseMinor, cny.adjustMinor], ["CNY", 46_000, 46_005, -5]);
});

test("免费等待（「服务规则」免等）：接机 / 送机各用各的那一项，点对点和包车用通用的那一项；带出平台规定的最小值（国际线 90）", () => {
  const p = product();
  assert.deepEqual(settlement(p).freeWait, { item: "pickup", value: { mode: "limited", minutes: 90 }, platformMinimumMinutes: 90 });
  assert.deepEqual(settlement(p, request({ direction: "dropoff", pickup: WEST, dropoff: null })).freeWait, { item: "dropoff", value: { mode: "limited", minutes: 15 }, platformMinimumMinutes: 15 });
  const p2p = product({ category: "point_to_point", pickupPlace: null, priceRules: [price(fixed(8_000), { direction: null })], serviceRules: rules({ freeWait: { pickup: null, dropoff: null, general: { mode: "unlimited" } } }) });
  assert.deepEqual(settlement(p2p, request({ category: "point_to_point", direction: null, pickup: WEST, dropoff: WEST })).freeWait, { item: "general", value: { mode: "unlimited" }, platformMinimumMinutes: 15 });
});

test("时区：服务时间、夜间时段、出行日期、加急小时数都按服务城市当地时间；同一个钟面时间在纽约和东京是不同的时刻；夏令时里不存在的时间按拨快之后", () => {
  // 纽约的商品：价格只在当地 2026-10-07 这一天有效。现在是 UTC 10-07 01:00 = 纽约 10-06 21:00
  const ny = product({ timeZone: "America/New_York", priceRules: [price(fixed(100), { validFrom: "2026-10-07", validTo: "2026-10-07" })], serviceRules: rules({ booking: { ...rules().booking, leadTimeHours: 2 } }) });
  assert.equal(outcome(ny, request({ serviceLocal: "2026-10-07T00:00" })), 100, "纽约 10-07 00:00 离现在 3 小时");
  assert.equal(outcome(ny, request({ serviceLocal: "2026-10-06T23:59" })), "PRICE_NOT_IN_EFFECT", "还是纽约的 10-06（提前时长够了）");
  assert.equal(outcome(ny, request({ serviceLocal: "2026-10-06T22:59" })), "LEAD_TIME_TOO_SHORT", "离现在不到 2 小时");
  // 同样的钟面时间放在东京的商品上：10-07 00:00（东京）已经过去 10 小时了
  assert.equal(outcome(product({ priceRules: [price(fixed(100))] }), request({ serviceLocal: "2026-10-07T00:00" })), "SERVICE_TIME_PASSED");
  // 纽约 2027-03-14 02:00 拨快到 03:00：订 02:30 的车按 03:30 算——03:00–04:00 的调价命中
  const spring = product({ timeZone: "America/New_York", adjustRules: [adjust("三点档", [{ type: "amount", value: 1_000 }], { timeSlot: { start: "03:00", end: "04:00" } })] });
  assert.equal(outcome(spring, request({ serviceLocal: "2027-03-14T02:30" })), 21_000);
});

test("第 11 步 对外价 = 结算价 × 汇率 × (1 + 汇率缓冲) × (1 + 加价比例)，按币种取整；同币种汇率缓冲为 0，跨币种 1.5%（第五轮决策 ⑥）", () => {
  const same = sellPrice({ settlementMinor: 108_900, settlementCurrency: "JPY", currency: "JPY", markupBp: 1_000, fx: null });
  assert.deepEqual(same, { currency: "JPY", sellMinor: 119_790, markupBp: 1_000, fxBufferBp: 0, fx: null, exact: "119790" });
  // 取整：20,001 × 1.125 = 22501.125 → 22501；恰好一半往大的取：20,004 × 1.125 = 22504.5 → 22505
  assert.equal((sellPrice({ settlementMinor: 20_001, settlementCurrency: "JPY", currency: "JPY", markupBp: 1_250, fx: null }) as { sellMinor: number }).sellMinor, 22_501);
  assert.equal((sellPrice({ settlementMinor: 20_004, settlementCurrency: "JPY", currency: "JPY", markupBp: 1_250, fx: null }) as { sellMinor: number }).sellMinor, 22_505);
  // 跨币种：20,000 日元 → 人民币，1 日元 = 0.0468 元；20000 × 0.0468 × 1.015 × 1.10 = 1045.0440 元 = 104504.4 分 → 104504 分
  const fx = { from: "JPY" as const, to: "CNY" as const, rate: "0.0468", asOf: "2026-10-07T00:00:00Z" };
  const cross = sellPrice({ settlementMinor: 20_000, settlementCurrency: "JPY", currency: "CNY", markupBp: 1_000, fx });
  assert.deepEqual(cross, { currency: "CNY", sellMinor: 104_504, markupBp: 1_000, fxBufferBp: 150, fx, exact: "104504.4" });
  // 反过来：460.05 元（46005 分）→ 日元，1 元 = 21.3675 日元；460.05 × 21.3675 × 1.015 × 1.10 = 10975.36… → 10975 日元
  const back = sellPrice({ settlementMinor: 46_005, settlementCurrency: "CNY", currency: "JPY", markupBp: 1_000, fx: { from: "CNY", to: "JPY", rate: "21.3675", asOf: "x" } });
  assert.equal((back as { sellMinor: number }).sellMinor, 10_975);
  // 没有汇率、汇率的方向不对、写法不对：报不出
  for (const bad of [null, { ...fx, from: "USD" as const }, { ...fx, to: "USD" as const }, { ...fx, rate: "0" }, { ...fx, rate: "abc" }, { ...fx, rate: "-1" }]) {
    assert.deepEqual(sellPrice({ settlementMinor: 20_000, settlementCurrency: "JPY", currency: "CNY", markupBp: 1_000, fx: bad }), { failure: "FX_RATE_UNAVAILABLE" });
  }
  assert.deepEqual([rateFraction("0.0468"), rateFraction("150"), rateFraction("1.5e2"), rateFraction("")], [{ numerator: 468n, denominator: 10_000n }, { numerator: 150n, denominator: 1n }, null, null]);
});

test("第 11 步 加价比例不得低于渠道下限（默认 10%，第五轮决策 ⑥）：给的比下限低就按下限算；渠道可以把下限设得更高或更低", () => {
  const sell = (markupBp: number, markupFloorBp?: number): [number, number] => {
    const result = sellPrice({ settlementMinor: 10_000, settlementCurrency: "JPY", currency: "JPY", markupBp, ...(markupFloorBp === undefined ? {} : { markupFloorBp }), fx: null });
    assert.ok("sellMinor" in result);
    return [result.sellMinor, result.markupBp];
  };
  assert.deepEqual([sell(1_500), sell(1_000), sell(800), sell(0)], [[11_500, 1_500], [11_000, 1_000], [11_000, 1_000], [11_000, 1_000]]);
  assert.deepEqual([sell(800, 500), sell(1_200, 2_000), sell(0, 0)], [[10_800, 800], [12_000, 2_000], [10_000, 0]]);
  assert.throws(() => sell(-1), RangeError);
  assert.throws(() => sell(10.5), RangeError);
  assert.equal(QUOTE_RULES.defaultMarkupFloorBp, 1_000);
});

const candidate = (tenantId: string, sellMinor: number, extra: Partial<RankCandidate> = {}): RankCandidate => ({ tenantId, sellMinor, observation: false, scoreCenti: 450, completedOrders: 0, tieBreak: tenantId, ...extra });
const order = (candidates: RankCandidate[], bandBp?: number): string[] => rankCandidates(candidates, bandBp).map((entry) => `${entry.candidate.tenantId}${entry.inBand ? "" : "(外)"}`);

test("第 10 步 选中标（第五轮决策 ②、《平台运营端》中标排序修正版）：与最低排序价相差 δ（默认 3%）以内时评分高者中标——文档的例子：A ¥30,000 评分 4.9，B ¥29,500 评分 4.3，价差 1.7% < 3%，A 中标", () => {
  const ranked = rankCandidates([candidate("A", 30_000, { scoreCenti: 490, completedOrders: 100 }), candidate("B", 29_500, { scoreCenti: 430, completedOrders: 100 })]);
  assert.deepEqual(ranked.map((entry) => [entry.candidate.tenantId, entry.position, entry.inBand, entry.rankPrice]), [["A", 1, true, "30000"], ["B", 2, true, "29500"]]);
  assert.equal(ranked[0]?.candidate.sellMinor, 30_000, "客人支付中标租户自己的对外价");
  assert.equal(QUOTE_RULES.defaultBandBp, 300);
});

test("第 10 步 价格带的边界：恰好 3% 算在区间里；略超（多 1 个最小货币单位）就在区间外，这时最低价中标", () => {
  const high = { scoreCenti: 500, completedOrders: 999 };
  // 基准 100,000：恰好 103,000 在区间里（评分高者中标）；103,001 不在
  assert.deepEqual(order([candidate("low", 100_000), candidate("high", 103_000, high)]), ["high", "low"]);
  assert.deepEqual(order([candidate("low", 100_000), candidate("high", 103_001, high)]), ["low", "high(外)"]);
  // 基准不是整百：29,999 × 1.03 = 30898.97 → 30,898 在区间里，30,899 不在（用精确值比，不取整）
  assert.deepEqual(order([candidate("low", 29_999), candidate("high", 30_898, high)]), ["high", "low"]);
  assert.deepEqual(order([candidate("low", 29_999), candidate("high", 30_899, high)]), ["low", "high(外)"]);
  // δ 由渠道配置，0–5%：0 = 只有并列最低的在区间里；5% 更宽
  assert.deepEqual(order([candidate("low", 100_000), candidate("high", 100_001, high)], 0), ["low", "high(外)"]);
  assert.deepEqual(order([candidate("low", 100_000), candidate("high", 100_000, high)], 0), ["high", "low"]);
  assert.deepEqual(order([candidate("low", 100_000), candidate("high", 105_000, high)], 500), ["high", "low"]);
  assert.throws(() => rankCandidates([candidate("a", 1)], 501), RangeError);
  assert.throws(() => rankCandidates([candidate("a", 1)], -1), RangeError);
  // 区间外的按排序价从低到高
  assert.deepEqual(order([candidate("c", 120_000, high), candidate("a", 100_000), candidate("b", 110_000)]), ["a", "b(外)", "c(外)"]);
});

test("第 10 步 区间内的排序：评分高者 → 已完成订单数多者 → 排序价低者（第二轮决策：先比履约评分，再比已完成订单数）；全都一样时结果仍然是确定的", () => {
  assert.deepEqual(order([candidate("a", 10_000, { scoreCenti: 470, completedOrders: 500 }), candidate("b", 10_100, { scoreCenti: 480, completedOrders: 30 })]), ["b", "a"], "评分高的赢，哪怕贵一点、单量少");
  assert.deepEqual(order([candidate("a", 10_000, { scoreCenti: 480, completedOrders: 30 }), candidate("b", 10_100, { scoreCenti: 480, completedOrders: 31 })]), ["b", "a"], "评分一样比已完成订单数");
  assert.deepEqual(order([candidate("a", 10_100, { scoreCenti: 480, completedOrders: 30 }), candidate("b", 10_000, { scoreCenti: 480, completedOrders: 30 })]), ["b", "a"], "再一样取排序价低者");
  // 全都一样：按 tieBreak 的字典序，和传进来的先后无关
  const [x, y] = [candidate("x", 10_000, { tieBreak: "prd-2" }), candidate("y", 10_000, { tieBreak: "prd-1" })];
  assert.deepEqual([order([x, y]), order([y, x])], [["y", "x"], ["y", "x"]]);
  // 评分口径：完成不足 20 单的、还没有评分的用默认 4.5
  assert.deepEqual([effectiveScoreCenti(490, 19), effectiveScoreCenti(490, 20), effectiveScoreCenti(null, 500), effectiveScoreCenti(320, 50), effectiveScoreCenti(999, 50)], [450, 490, 450, 320, 500]);
  // 评分算法没定之前都用默认分：就是按已完成订单数排（第二轮决策的备注）
  assert.deepEqual(order([candidate("new", 10_000, { completedOrders: 3 }), candidate("old", 10_200, { completedOrders: 80 })]), ["old", "new"]);
});

test("第 10 步 观察期租户按对外价 × 1.05 参与排序（第五轮决策 ②）：排序价只用于比较，不影响客人支付的金额", () => {
  // 观察期的 B 对外价最低，但排序价 10,000 × 1.05 = 10,500 超出了 A（10,100）的 3% 区间
  const ranked = rankCandidates([candidate("A", 10_100), candidate("B", 10_000, { observation: true, scoreCenti: 500, completedOrders: 999 })]);
  assert.deepEqual(ranked.map((entry) => [entry.candidate.tenantId, entry.rankPrice, entry.inBand, entry.candidate.sellMinor]), [["A", "10100", true, 10_100], ["B", "10500", false, 10_000]]);
  // 排序价在区间里时照常比评分：A 10,300，B 观察期 10,000 → 10,500；基准 10,300，上限 10,609
  assert.deepEqual(order([candidate("A", 10_300, { scoreCenti: 400 }), candidate("B", 10_000, { observation: true, scoreCenti: 480 })]), ["B", "A"]);
  // 观察期租户自己是唯一的候选：照样中标
  assert.deepEqual(order([candidate("B", 10_000, { observation: true })]), ["B"]);
  assert.equal(QUOTE_RULES.observationPenaltyBp, 500);
});

test("每个车型组每个租户只出一个价：同一个租户的几个报价（几个商品）只留排序价最低的；没有候选时没有结果", () => {
  const ranked = rankCandidates([candidate("A", 12_000, { tieBreak: "prd-a1" }), candidate("A", 11_000, { tieBreak: "prd-a2" }), candidate("B", 11_500, { tieBreak: "prd-b" })]);
  assert.deepEqual(ranked.map((entry) => [entry.candidate.tenantId, entry.candidate.tieBreak, entry.candidate.sellMinor]), [["A", "prd-a2", 11_000], ["B", "prd-b", 11_500]]);
  assert.deepEqual(rankCandidates([]), []);
});

test("第 12 步 报价快照有效期 30 分钟：到点的那一刻就不能用了（错误码 QUOTE_EXPIRED）", () => {
  const created = new Date("2026-10-06T06:00:00Z");
  const expiresAt = quoteExpiresAt(created).toISOString();
  assert.equal(expiresAt, "2026-10-06T06:30:00.000Z");
  assert.deepEqual([quoteSnapshotValid({ expiresAt }, new Date("2026-10-06T06:29:59.999Z")), quoteSnapshotValid({ expiresAt }, new Date("2026-10-06T06:30:00.000Z"))], [true, false]);
});

test("每一个报不出价的原因都有测试触发过（上面各条）", () => {
  assert.deepEqual(QUOTE_REFUSALS.filter((reason) => !seenRefusals.has(reason)), []);
});
