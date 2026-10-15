/**
 * M2-01 报价引擎：测试角色补的边界测试（金额取整、对照实现随机比对、中标排序的确定性、时间边界、区域）。
 * 对照实现都是在这里独立写的：只用 BigInt 有理数，不调被测模块里的计价函数。
 * 随机输入用固定种子的伪随机数，失败时能复现。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Position } from "./areas.ts";
import type { AdjustRule, PriceRule } from "./pricing.ts";
import { type ServiceRules, emptyServiceRules } from "./products.ts";
import { CURRENCIES, type CurrencyCode } from "./money.ts";
import {
  type ComparisonEntry,
  DEFAULT_TENANT_STANDING,
  type QuoteMoment,
  QUOTE_RULES,
  type QuoteProduct,
  type QuoteRequest,
  type RankCandidate,
  compareQuotes,
  fxQuoteUsable,
  quoteExpiresAt,
  quoteProduct,
  quoteSnapshotValid,
  rankCandidates,
  sellPrice,
} from "./quote.ts";

// ---- 固定种子的伪随机数（mulberry32） ----
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const intIn = (r: () => number, lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1));
const pick = <T>(r: () => number, list: readonly T[]): T => list[Math.floor(r() * list.length)] as T;
function shuffle<T>(r: () => number, list: readonly T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

// ---- 独立的有理数对照实现 ----
type Q = [bigint, bigint];
const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? (a < 0n ? -a : a) : gcd(b, a % b));
const norm = ([n, d]: Q): Q => {
  const g = gcd(n, d) || 1n;
  return d < 0n ? [-n / g, -d / g] : [n / g, d / g];
};
const qAdd = (a: Q, b: Q): Q => norm([a[0] * b[1] + b[0] * a[1], a[1] * b[1]]);
const qMul = (a: Q, n: bigint, d: bigint = 1n): Q => norm([a[0] * n, a[1] * d]);
/** 四舍五入（0.5 远离零）到 unit 的整数倍 */
function qRound([n, d]: Q, unit = 1n): bigint {
  const den = d * unit;
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const q = (2n * abs + den) / (2n * den);
  return (neg ? -q : q) * unit;
}

// ---- 夹具 ----
const square = (west: number, south: number, east: number, north: number): Position[] => [[west, south], [east, south], [east, north], [west, north], [west, south]];
const AREA_1 = { areaId: "a1", active: true, shapes: [{ id: "a1-op", kind: "operate" as const, ring: square(139.0, 35.0, 139.6, 36.0) }] };
const AREA_2 = { areaId: "a2", active: true, shapes: [{ id: "a2-op", kind: "operate" as const, ring: square(139.5, 35.0, 140.0, 36.0) }, { id: "a2-no", kind: "forbid" as const, ring: square(139.8, 35.4, 139.9, 35.6) }] };
const WEST = { lng: 139.2, lat: 35.5 };
const OVERLAP = { lng: 139.55, lat: 35.5 };
const EAST = { lng: 139.7, lat: 35.5 };
const FORBIDDEN = { lng: 139.85, lat: 35.5 };
const FAR = { lng: 141.0, lat: 35.5 };

const priceRule = (basePriceMinor: number, extra: Partial<PriceRule> = {}): PriceRule & { id: string } => ({
  id: `p-${extra.areaId ?? "a1"}-${extra.vehicleGroupId ?? "biz7"}-${String(extra.direction ?? "both")}-${extra.validFrom ?? ""}`,
  areaId: "a1",
  vehicleGroupId: "biz7",
  direction: "both",
  packageHours: null,
  pricing: { model: "fixed", basePriceMinor },
  validFrom: "2026-01-01",
  validTo: null,
  status: "enabled",
  ...extra,
});
const adjust = (name: string, steps: AdjustRule["steps"], extra: Partial<AdjustRule> = {}): AdjustRule & { id: string } => ({ id: `adj-${name}`, name, travelFrom: null, travelTo: null, cycle: { type: "daily" }, timeSlot: null, areaIds: [], vehicleGroupIds: [], directions: [], packageHours: [], steps, status: "enabled", ...extra });
const rules = (extra: Partial<ServiceRules> = {}): ServiceRules => ({
  ...emptyServiceRules(),
  booking: { saleFrom: null, saleTo: null, serviceTime: { start: "00:00", end: "24:00" }, leadTimeHours: 24, note: null },
  freeWait: { pickup: { mode: "limited", minutes: 90 }, dropoff: { mode: "limited", minutes: 15 }, general: { mode: "limited", minutes: 15 } },
  ...extra,
});
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
  vehicleGroups: [{ vehicleGroupId: "biz7", passengers: 6, luggage: 4, active: true }],
  serviceRules: rules(),
  addonCatalog: [],
  priceRules: [priceRule(20_000)],
  adjustRules: [],
  inventoryMode: "unlimited",
  ...extra,
});
const request = (extra: Partial<QuoteRequest> = {}): QuoteRequest => ({ category: "airport_transfer", pickup: null, dropoff: WEST, direction: "pickup", packageHours: null, serviceLocal: "2026-10-20T10:00", passengers: 2, luggage: 1, addons: [], driverLanguage: null, vehicleGroupIds: ["biz7"], ...extra });
// 东京 2026-10-07 10:00
const NOW = new Date("2026-10-07T01:00:00Z");
const moment = (extra: Partial<QuoteMoment> = {}): QuoteMoment => ({ now: NOW, route: null, inventoryDay: null, urgentUsed: 0, ...extra });

function only(p: QuoteProduct, r: QuoteRequest = request(), m: QuoteMoment = moment()) {
  const quoted = quoteProduct(p, r, m);
  assert.ok(quoted.ok && quoted.offers.length === 1, JSON.stringify(quoted));
  return quoted.offers[0] as (typeof quoted.offers)[number];
}
function outcome(p: QuoteProduct, r: QuoteRequest = request(), m: QuoteMoment = moment()): unknown {
  const quoted = quoteProduct(p, r, m);
  if (!quoted.ok) return quoted.reason;
  if (quoted.offers.length === 1 && quoted.refused.length === 0) return (quoted.offers[0] as (typeof quoted.offers)[number]).settlement.totalMinor;
  return quoted.refused.map((entry) => entry.reason).join(",");
}
const sumOf = (s: { baseMinor: number; adjustMinor: number; urgentMinor: number; nightMinor: number; addonsMinor: number; driverLanguageMinor: number }): number => s.baseMinor + s.adjustMinor + s.urgentMinor + s.nightMinor + s.addonsMinor + s.driverLanguageMinor;

// ======================================================================
// 金额：取整
// ======================================================================

test("QA 取整：恰好一半按 0.5 远离零进位（不是银行家舍入），按取整单位只取整一次", () => {
  const cases: [number, number, number][] = [
    // [一口价, 取整单位, 期望结算价]
    [150, 100, 200],
    [250, 100, 300],
    [149, 100, 100],
    [1_050, 100, 1_100],
    [1_049, 100, 1_000],
    [25, 10, 30],
    [35, 10, 40],
    [5_000, 1_000, 5_000],
    [4_500, 1_000, 5_000],
    [4_499, 1_000, 4_000],
  ];
  for (const [base, unit, expected] of cases) {
    const s = only(product({ roundingUnit: unit, priceRules: [priceRule(base)] })).settlement;
    assert.equal(s.totalMinor, expected, `${base} 按 ${unit} 取整`);
    assert.equal(sumOf(s), s.totalMinor, "明细之和等于结算价");
  }
});

test("QA 取整：调价后的半个最小单位（20,001 × 0.5 = 10,000.5）四舍五入为 10,001；−10,000.5 这类负的调价项方向也对", () => {
  const s = only(product({ priceRules: [priceRule(20_001)], adjustRules: [adjust("半价", [{ type: "percent", value: -5_000 }])] })).settlement;
  assert.equal(s.totalMinor, 10_001);
  assert.equal(s.baseMinor, 20_001);
  assert.equal(s.adjustMinor, -10_000);
  assert.equal(s.exact.adjusted, "10000.5");
});

test("QA 取整：两位小数的结算币种（CNY，最小单位是分）——金额本来就是分，取整单位 1 分、100 分（整元）都对", () => {
  const cny = (unit: number, base: number, extra: Partial<QuoteProduct> = {}) => only(product({ currency: "CNY", roundingUnit: unit, priceRules: [priceRule(base)], ...extra })).settlement;
  assert.equal(cny(1, 33_333, { adjustRules: [adjust("+1/3%", [{ type: "percent", value: 33 }])] }).totalMinor, 33_443, "333.33 元 × 1.0033 = 334.43 元（334.4299 进位）");
  assert.equal(cny(100, 33_350).totalMinor, 33_400, "333.50 元取整到元 → 334 元");
  assert.equal(cny(100, 33_349).totalMinor, 33_300);
});

test("QA 取整：调价后的价单独取整会变 0，但加上夜间费等总价是正的——按「只在最后取整一次」应当照常报价（结算价 1,000），而不是 PRICE_NOT_POSITIVE", () => {
  // 一口价 1,000，调价 −960 → 40；取整单位 100；23:00 用车，夜间按次 1,000。总价精确值 1,040 → 取整 1,000
  const p = product({
    roundingUnit: 100,
    priceRules: [priceRule(1_000)],
    adjustRules: [adjust("大促", [{ type: "amount", value: -960 }])],
    serviceRules: rules({ night: { enabled: true, window: { start: "22:00", end: "06:00" }, amountMinor: 1_000, chargeUnit: "per_order" } }),
  });
  assert.equal(outcome(p, request({ serviceLocal: "2026-10-20T23:00" })), 1_000);
});

// ======================================================================
// 金额：对照实现随机比对
// ======================================================================

/** 独立的「与夜间时段 [start, end) 重叠的分钟数」：逐分钟数（每天重复，可跨午夜）。 */
function referenceOverlap(startMinute: number, endMinute: number, from: number, duration: number): number {
  let total = 0;
  for (let m = from; m < from + duration; m += 1) {
    const t = m % 1440;
    const inside = startMinute < endMinute ? t >= startMinute && t < endMinute : t >= startMinute || t < endMinute;
    if (inside) total += 1;
  }
  return total;
}

test("QA 对照实现：随机 400 组（一口价 × 链式调价 × 按小时夜间 × 加急 × 附加服务 × 司机语言 × 取整单位），quoteProduct 的结算价与独立的有理数实现逐个相等，明细之和恒等于结算价", () => {
  const r = rng(20261012);
  for (let i = 0; i < 400; i += 1) {
    const base = intIn(r, 1_000, 2_000_000);
    const steps: AdjustRule["steps"] = Array.from({ length: intIn(r, 0, 4) }, () => (r() < 0.6 ? { type: "percent" as const, value: intIn(r, -3_000, 5_000) } : { type: "amount" as const, value: intIn(r, -300, 50_000) }));
    const unit = pick(r, [1, 10, 50, 100, 1_000]);
    const nightAmount = intIn(r, 1, 9_999);
    const nightStart = intIn(r, 0, 23) * 60 + pick(r, [0, 15, 30, 45]);
    let nightEnd = intIn(r, 0, 23) * 60 + pick(r, [0, 30]);
    if (nightEnd === nightStart) nightEnd = (nightStart + 60) % 1440;
    const hh = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    const routeMinutes = intIn(r, 0, 600);
    const startHour = intIn(r, 0, 23);
    const startMin = pick(r, [0, 7, 30, 59]);
    const urgentSurcharge = intIn(r, 0, 20_000);
    const urgent = r() < 0.5;
    const seatUnit = intIn(r, 0, 3_333);
    const seatQty = intIn(r, 1, 5);
    const seatFirstFree = r() < 0.5;
    const guideUnit = intIn(r, 0, 4_999);
    const languageFee = intIn(r, 0, 3_000);
    const p = product({
      category: "point_to_point",
      pickupPlace: null,
      roundingUnit: unit,
      priceRules: [priceRule(base, { direction: null })],
      adjustRules: steps.length === 0 ? [] : [adjust("随机", steps)],
      serviceRules: rules({
        booking: { saleFrom: null, saleTo: null, serviceTime: { start: "00:00", end: "24:00" }, leadTimeHours: 24, note: null },
        urgent: { enabled: true, dailyQuota: null, tiers: [{ withinHours: 24, surchargeMinor: urgentSurcharge }] },
        night: { enabled: true, window: { start: hh(nightStart), end: hh(nightEnd) }, amountMinor: nightAmount, chargeUnit: "per_hour" },
        addons: [{ addonId: "seat", enabled: true, unitPriceMinor: seatUnit, firstFree: seatFirstFree }, { addonId: "guide", enabled: true, unitPriceMinor: guideUnit, firstFree: false }],
        driverLanguages: [{ language: "zh", unitPriceMinor: languageFee }],
      }),
      addonCatalog: [{ addonId: "seat", chargeUnit: "per_item", usable: true }, { addonId: "guide", chargeUnit: "per_duration", usable: true }],
    });
    const serviceLocal = `2026-10-20T${String(startHour).padStart(2, "0")}:${String(startMin).padStart(2, "0")}`;
    // 加急：现在离用车不到 24 小时（东京 10-19 的某个时刻）；否则 13 天前
    const now = urgent ? new Date(Date.parse(`${serviceLocal}:00+09:00`) - 12 * 3_600_000) : NOW;
    const req = request({ category: "point_to_point", direction: null, pickup: WEST, dropoff: WEST, serviceLocal, passengers: 2, addons: [{ addonId: "seat", quantity: seatQty }, { addonId: "guide", quantity: 1 }], driverLanguage: "zh" });
    const quoted = quoteProduct(p, req, moment({ now, route: { meters: 10_000, minutes: routeMinutes } }));
    assert.ok(quoted.ok && quoted.offers.length === 1, `#${i} ${JSON.stringify(quoted)}`);
    const s = (quoted.offers[0] as (typeof quoted.offers)[number]).settlement;

    // 对照实现
    let adjusted: Q = [BigInt(base), 1n];
    for (const step of steps) adjusted = step.type === "percent" ? qMul(adjusted, BigInt(10_000 + step.value), 10_000n) : qAdd(adjusted, [BigInt(step.value), 1n]);
    const overlap = referenceOverlap(nightStart, nightEnd, startHour * 60 + startMin, routeMinutes);
    const night: Q = [BigInt(nightAmount * overlap), 60n];
    const seat = BigInt(seatUnit * Math.max(0, seatQty - (seatFirstFree ? 1 : 0)));
    // 按时长的附加服务不足一小时按比例，精确值参与总价（只在最后取整一次，缺陷 #1）；明细里的附加服务是合计四舍五入到最小货币单位
    const guide: Q = norm([BigInt(guideUnit * routeMinutes), 60n]);
    const fixedExtras = BigInt(urgent ? urgentSurcharge : 0) + seat + BigInt(languageFee);
    const total = qAdd(qAdd(qAdd(adjusted, night), guide), [fixedExtras, 1n]);
    if (total[0] <= 0n || qRound(total, BigInt(unit)) <= 0n) continue;
    const label = `#${i} base=${base} steps=${JSON.stringify(steps)} unit=${unit} night=${nightAmount}@${hh(nightStart)}-${hh(nightEnd)} start=${serviceLocal} minutes=${routeMinutes}`;
    assert.equal(s.totalMinor, Number(qRound(total, BigInt(unit))), label);
    assert.equal(s.nightMinor, Number(qRound(night)), label);
    assert.equal(s.urgentMinor, urgent ? urgentSurcharge : 0, label);
    assert.equal(s.addonsMinor, Number(seat + qRound(guide)), label);
    assert.equal(s.baseMinor, base, label);
    assert.equal(sumOf(s), s.totalMinor, `${label}：明细之和`);
    for (const key of ["totalMinor", "baseMinor", "adjustMinor", "urgentMinor", "nightMinor", "addonsMinor", "driverLanguageMinor"] as const) assert.ok(Number.isSafeInteger(s[key]), `${label} ${key}`);
    assert.equal(s.totalMinor % unit, 0, `${label}：结算价是取整单位的整数倍`);
  }
});

test("QA 对照实现：随机 2000 组（7 种币种两两组合 × 十进制汇率 × 缓冲 × 加价/下限），sellPrice 与独立的有理数实现逐个相等，结果是整数", () => {
  const r = rng(77);
  const codes = Object.keys(CURRENCIES) as CurrencyCode[];
  for (let i = 0; i < 2_000; i += 1) {
    const from = pick(r, codes);
    const to = pick(r, codes);
    const settlement = intIn(r, 1, 1_000_000_000);
    const intPart = String(intIn(r, 0, 2_000));
    const fracPart = String(intIn(r, 0, 999_999)).padStart(intIn(r, 6, 8), "0").slice(0, intIn(r, 1, 8));
    const rate = intPart === "0" && /^0+$/.test(fracPart) ? "1" : `${intPart}.${fracPart}`;
    const markupBp = intIn(r, 0, 5_000);
    const floorBp = intIn(r, 0, 2_000);
    const bufferBp = intIn(r, 0, 1_000);
    const got = sellPrice({ settlementMinor: settlement, settlementCurrency: from, currency: to, markupBp, markupFloorBp: floorBp, fxBufferBp: bufferBp, fx: { from, to, rate, asOf: NOW.toISOString() } });
    let amount: Q = [BigInt(settlement), 1n];
    if (from !== to) {
      const [whole, frac = ""] = rate.split(".");
      amount = qMul(amount, BigInt(`${whole}${frac}`), 10n ** BigInt(frac.length));
      amount = qMul(amount, 10n ** BigInt(CURRENCIES[to].minorDigits), 10n ** BigInt(CURRENCIES[from].minorDigits));
      amount = qMul(amount, BigInt(10_000 + bufferBp), 10_000n);
    }
    amount = qMul(amount, BigInt(10_000 + Math.max(markupBp, floorBp)), 10_000n);
    const label = `#${i} ${settlement} ${from}→${to} rate=${rate} m=${markupBp} floor=${floorBp} b=${bufferBp}`;
    assert.ok(!("failure" in got), label);
    assert.equal(got.sellMinor, Number(qRound(amount)), label);
    assert.ok(Number.isSafeInteger(got.sellMinor), label);
    assert.equal(got.markupBp, Math.max(markupBp, floorBp), label);
    assert.equal(got.fxBufferBp, from === to ? 0 : bufferBp, label);
  }
});

test("QA 对外价：恰好一半（结算价 5、加价 10% → 5.5）进位为 6；CNY 的 0.5 分同样进位；JPY → CNY 换算后按分取整", () => {
  const same = sellPrice({ settlementMinor: 5, settlementCurrency: "JPY", currency: "JPY", markupBp: 1_000, fx: null });
  assert.ok(!("failure" in same));
  assert.equal(same.sellMinor, 6);
  const cny = sellPrice({ settlementMinor: 15, settlementCurrency: "CNY", currency: "CNY", markupBp: 1_000, fx: null });
  assert.ok(!("failure" in cny));
  assert.equal(cny.sellMinor, 17, "0.15 元 × 1.1 = 0.165 元 → 0.17 元");
  // 10,000 日元 × 0.048 × 1.015 × 1.1 = 535.92 元 → 53,592 分
  const cross = sellPrice({ settlementMinor: 10_000, settlementCurrency: "JPY", currency: "CNY", markupBp: 1_000, fx: { from: "JPY", to: "CNY", rate: "0.048", asOf: NOW.toISOString() } });
  assert.ok(!("failure" in cross));
  assert.equal(cross.sellMinor, 53_592);
  // 反过来：100.00 元 × 20.5 × 1.015 × 1.1 = 2,288.8 日元 → 2,289
  const back = sellPrice({ settlementMinor: 10_000, settlementCurrency: "CNY", currency: "JPY", markupBp: 1_000, fx: { from: "CNY", to: "JPY", rate: "20.5", asOf: NOW.toISOString() } });
  assert.ok(!("failure" in back));
  assert.equal(back.sellMinor, 2_289);
});

test("QA 对外价的上限（1e15，仍在安全整数内）：结算价上限 10 亿 × 大汇率，刚好不超的照常报（整数），超了报 SELL_PRICE_OVER_LIMIT，都不抛错", () => {
  const at = (rate: string) => sellPrice({ settlementMinor: 1_000_000_000, settlementCurrency: "JPY", currency: "KRW", markupBp: 1_000, fx: { from: "JPY", to: "KRW", rate, asOf: NOW.toISOString() } });
  const fits = at("895656");
  assert.ok(!("failure" in fits));
  assert.ok(Number.isSafeInteger(fits.sellMinor) && fits.sellMinor <= QUOTE_RULES.maxSellMinor);
  assert.deepEqual(at("895657"), { failure: "SELL_PRICE_OVER_LIMIT" });
  assert.deepEqual(at("999999999999"), { failure: "SELL_PRICE_OVER_LIMIT" });
  assert.ok(QUOTE_RULES.maxSellMinor <= Number.MAX_SAFE_INTEGER);
});

// ======================================================================
// 中标排序
// ======================================================================

const cand = (tenantId: string, sellMinor: number, extra: Partial<RankCandidate> = {}): RankCandidate => ({ tenantId, sellMinor, observation: false, scoreCenti: 450, completedOrders: 0, tieBreak: `${tenantId}|p`, ...extra });
const winners = (list: readonly RankCandidate[], band?: number): string[] => rankCandidates(list, band).map((entry) => `${entry.candidate.tieBreak}${entry.inBand ? "*" : ""}`);

test("QA 价格带：观察期租户 × 1.05 后正好落在 3% 边界上算在区间内，多 1 个最小单位就在区间外", () => {
  // 最低的是观察期的 A：10,000 × 1.05 = 10,500 → 上沿 10,815
  const base = cand("A", 10_000, { observation: true, scoreCenti: 300, completedOrders: 100 });
  assert.deepEqual(winners([base, cand("B", 10_815, { scoreCenti: 490, completedOrders: 100 })]), ["B|p*", "A|p*"], "10,815 恰好等于上沿：在区间里，评分高者中标");
  assert.deepEqual(winners([base, cand("B", 10_816, { scoreCenti: 490, completedOrders: 100 })]), ["A|p*", "B|p"], "多 1：区间外");
  // 观察期的也会被推出区间：B 10,000、观察期 A 9,900 × 1.05 = 10,395 > 10,300
  assert.deepEqual(winners([cand("A", 9_900, { observation: true, scoreCenti: 500, completedOrders: 100 }), cand("B", 10_000)]), ["B|p*", "A|p"]);
  // 上沿不是整数：333 × 1.03 = 342.99 → 342 在、343 不在
  assert.deepEqual(winners([cand("A", 333), cand("B", 342, { scoreCenti: 490, completedOrders: 30 }), cand("C", 343, { scoreCenti: 500, completedOrders: 30 })]), ["B|p*", "A|p*", "C|p"]);
});

test("QA 价格带 δ 的取值：0 只有并列最低的在区间里；5%（上限）边界含；超过 5% 或非整数抛错", () => {
  assert.deepEqual(winners([cand("A", 10_000), cand("B", 10_000, { scoreCenti: 490, completedOrders: 30 }), cand("C", 10_001, { scoreCenti: 500, completedOrders: 30 })], 0), ["B|p*", "A|p*", "C|p"]);
  assert.deepEqual(winners([cand("A", 10_000), cand("B", 10_500, { scoreCenti: 490, completedOrders: 30 })], 500), ["B|p*", "A|p*"]);
  assert.throws(() => rankCandidates([cand("A", 1)], 501), RangeError);
  assert.throws(() => rankCandidates([cand("A", 1)], 1.5), RangeError);
  assert.throws(() => rankCandidates([cand("A", 1)], -1), RangeError);
});

test("QA 同一租户同车型组多个商品只留一个：留排序价最低的；价一样时留商品编号小的；留下来的那个才参与定基准", () => {
  const ranked = rankCandidates([cand("A", 10_000, { tieBreak: "A|p2" }), cand("A", 9_000, { tieBreak: "A|p3" }), cand("A", 9_000, { tieBreak: "A|p1" }), cand("B", 9_200)]);
  assert.deepEqual(ranked.map((entry) => entry.candidate.tieBreak), ["A|p1", "B|p"]);
  assert.equal(ranked.length, 2);
});

test("QA 结果确定：随机 300 组候选（有并列的价、分、单量、观察期、同租户多商品），把输入顺序打乱 5 次，名次完全一样", () => {
  const r = rng(4242);
  for (let i = 0; i < 300; i += 1) {
    const list = Array.from({ length: intIn(r, 1, 12) }, (_, k) => {
      const tenant = `T${intIn(r, 1, 6)}`;
      return cand(tenant, pick(r, [10_000, 10_000, 10_100, 10_300, 10_301, 9_800]), { observation: r() < 0.2, scoreCenti: pick(r, [450, 450, 480, 500]), completedOrders: pick(r, [0, 20, 20, 50]), tieBreak: `${tenant}|p${k}` });
    });
    const expected = rankCandidates(list).map((entry) => [entry.candidate.tieBreak, entry.position, entry.inBand, entry.rankPrice]);
    for (let s = 0; s < 5; s += 1) assert.deepEqual(rankCandidates(shuffle(r, list)).map((entry) => [entry.candidate.tieBreak, entry.position, entry.inBand, entry.rankPrice]), expected, `#${i}`);
  }
});

test("QA 结果确定（整条 compareQuotes）：几个供应商的报价全都一样时，中标和快照里的候选顺序与 entries 的顺序无关", () => {
  const r = rng(9);
  const entries: ComparisonEntry[] = ["t-c", "t-a", "t-b"].flatMap((tenantId) =>
    ["p-2", "p-1"].map((suffix): ComparisonEntry => ({
      quote: quoteProduct(product({ tenantId, productId: `${tenantId}-${suffix}` }), request(), moment()),
      productVersion: 1,
      standing: DEFAULT_TENANT_STANDING,
      markupBp: () => 1_000,
      fx: null,
    })),
  );
  const run = (list: readonly ComparisonEntry[]) => compareQuotes({ request: request(), currency: "JPY", entries: list, now: NOW }).groups.map((group) => group.snapshot.candidates.map((entry) => `${entry.position}:${entry.tenantId}/${entry.productId}`));
  const expected = run(entries);
  assert.deepEqual(expected, [["1:t-a/t-a-p-1", "2:t-b/t-b-p-1", "3:t-c/t-c-p-1"]]);
  for (let s = 0; s < 10; s += 1) assert.deepEqual(run(shuffle(r, entries)), expected);
});

// ======================================================================
// 时间
// ======================================================================

test("QA 夜间费（按次）的两端：22:00 整收，06:00 整不收，05:59 收；跨月的 23:59 也按当地时间收", () => {
  const p = product({ serviceRules: rules({ night: { enabled: true, window: { start: "22:00", end: "06:00" }, amountMinor: 3_000, chargeUnit: "per_order" } }) });
  const at = (serviceLocal: string) => only(p, request({ serviceLocal })).settlement.nightMinor;
  assert.equal(at("2026-10-20T22:00"), 3_000);
  assert.equal(at("2026-10-20T21:59"), 0);
  assert.equal(at("2026-10-21T06:00"), 0);
  assert.equal(at("2026-10-21T05:59"), 3_000);
  assert.equal(at("2026-10-31T23:59"), 3_000);
  assert.equal(at("2026-11-01T00:00"), 3_000);
});

test("QA 夜间费（按小时）：跨午夜的路线按重叠分钟数精确算——21:30 出发 90 分钟、夜间 22:00–06:00、每小时 1,000 → 1,000；05:30 出发 60 分钟 → 500", () => {
  const p = product({ serviceRules: rules({ night: { enabled: true, window: { start: "22:00", end: "06:00" }, amountMinor: 1_000, chargeUnit: "per_hour" } }) });
  const at = (serviceLocal: string, minutes: number) => only(p, request({ serviceLocal }), moment({ route: { meters: 1_000, minutes } })).settlement;
  assert.deepEqual([at("2026-10-20T21:30", 90).nightMinor, at("2026-10-20T21:30", 90).night], [1_000, { chargeUnit: "per_hour", overlapMinutes: 60 }]);
  assert.equal(at("2026-10-21T05:30", 60).nightMinor, 500);
  assert.equal(at("2026-10-20T23:00", 20).nightMinor, 333, "20 分钟 = 333.33… → 333");
  assert.equal(at("2026-10-20T23:00", 20).exact.night, "333.333333");
});

test("QA 跨午夜的服务时间（20:00–02:00 含两端）：01:59、02:00 能报，02:01、19:59 不能", () => {
  const p = product({ serviceRules: rules({ booking: { saleFrom: null, saleTo: null, serviceTime: { start: "20:00", end: "02:00" }, leadTimeHours: 24, note: null } }) });
  assert.equal(outcome(p, request({ serviceLocal: "2026-10-21T01:59" })), 20_000);
  assert.equal(outcome(p, request({ serviceLocal: "2026-10-21T02:00" })), 20_000);
  assert.equal(outcome(p, request({ serviceLocal: "2026-10-21T02:01" })), "OUTSIDE_SERVICE_TIME");
  assert.equal(outcome(p, request({ serviceLocal: "2026-10-20T19:59" })), "OUTSIDE_SERVICE_TIME");
});

test("QA 提前预订时长与加急档的边界：正好 24 小时不算加急；差 1 毫秒走加急；正好 12 小时命中「12 小时内」，正好 6 小时命中「6 小时内」", () => {
  const p = product({ serviceRules: rules({ urgent: { enabled: true, dailyQuota: null, tiers: [{ withinHours: 24, surchargeMinor: 1_000 }, { withinHours: 12, surchargeMinor: 2_000 }, { withinHours: 6, surchargeMinor: 5_000 }] } }) });
  const service = Date.parse("2026-10-20T10:00:00+09:00");
  const at = (aheadMs: number) => {
    const quoted = quoteProduct(p, request(), moment({ now: new Date(service - aheadMs) }));
    return quoted.ok ? [quoted.urgent, (quoted.offers[0] as (typeof quoted.offers)[number]).settlement.urgentMinor] : quoted.reason;
  };
  const H = 3_600_000;
  assert.deepEqual(at(24 * H), [false, 0]);
  assert.deepEqual(at(24 * H - 1), [true, 1_000]);
  assert.deepEqual(at(12 * H), [true, 2_000]);
  assert.deepEqual(at(6 * H), [true, 5_000]);
});

test("QA 加急档的边界（续）：12 < 离用车 < 24 小时时没有够用的一档 → LEAD_TIME_TOO_SHORT；正好 12 小时 → 12 小时档；正好 6 小时 → 6 小时档；6 小时多 1 毫秒 → 12 小时档", () => {
  const p = product({ serviceRules: rules({ urgent: { enabled: true, dailyQuota: null, tiers: [{ withinHours: 12, surchargeMinor: 2_000 }, { withinHours: 6, surchargeMinor: 5_000 }] } }) });
  const service = Date.parse("2026-10-20T10:00:00+09:00");
  const H = 3_600_000;
  const at = (aheadMs: number) => {
    const quoted = quoteProduct(p, request(), moment({ now: new Date(service - aheadMs) }));
    return quoted.ok ? (quoted.offers[0] as (typeof quoted.offers)[number]).settlement.urgentMinor : quoted.reason;
  };
  assert.equal(at(12 * H + 1), "LEAD_TIME_TOO_SHORT");
  assert.equal(at(12 * H), 2_000);
  assert.equal(at(6 * H + 1), 2_000);
  assert.equal(at(6 * H), 5_000);
  assert.equal(at(1), 5_000);
  assert.equal(at(0), "SERVICE_TIME_PASSED");
});

test("QA 夏令时城市（纽约）：提前预订时长按真实经过的时间——春季拨快那晚只过了 23 小时就不够 24 小时；当地不存在的 02:30 按 03:30 算", () => {
  const ny = (extra: Partial<QuoteProduct> = {}) => product({ timeZone: "America/New_York", ...extra });
  // 现在：纽约 2026-03-07 03:00 EST（08:00Z）。用车 2026-03-08 03:00 EDT（07:00Z）：只差 23 小时
  assert.equal(outcome(ny(), request({ serviceLocal: "2026-03-08T03:00" }), moment({ now: new Date("2026-03-07T08:00:00Z") })), "LEAD_TIME_TOO_SHORT");
  assert.equal(outcome(ny(), request({ serviceLocal: "2026-03-08T04:00" }), moment({ now: new Date("2026-03-07T08:00:00Z") })), 20_000, "04:00 EDT = 08:00Z：正好 24 小时");
  // 秋季拨回那晚：现在 2026-10-31 01:30 EDT（05:30Z），用车 2026-11-01 01:00（取先到的 EDT = 05:00Z）只差 23.5 小时
  assert.equal(outcome(ny(), request({ serviceLocal: "2026-11-01T01:00" }), moment({ now: new Date("2026-10-31T05:30:00Z") })), "LEAD_TIME_TOO_SHORT");
  // 不存在的 02:30：服务时间只到 03:00 的商品接不了（按 03:30 算）
  const short = ny({ serviceRules: rules({ booking: { saleFrom: null, saleTo: null, serviceTime: { start: "00:00", end: "03:00" }, leadTimeHours: 24, note: null } }) });
  assert.equal(outcome(short, request({ serviceLocal: "2026-03-08T02:30" }), moment({ now: new Date("2026-03-01T00:00:00Z") })), "OUTSIDE_SERVICE_TIME");
});

test("QA 跨月、出行日期按城市当地：价格 10-31 截止，东京 10-31 23:59 能报、11-01 00:00 是 PRICE_NOT_IN_EFFECT；同一时刻在 UTC 还是 10-31 也不影响", () => {
  const p = product({ priceRules: [priceRule(20_000, { validTo: "2026-10-31" })] });
  assert.equal(outcome(p, request({ serviceLocal: "2026-10-31T23:59" })), 20_000);
  assert.equal(outcome(p, request({ serviceLocal: "2026-11-01T00:00" })), "PRICE_NOT_IN_EFFECT");
  const quoted = quoteProduct(p, request({ serviceLocal: "2026-11-01T08:59" }), moment());
  assert.ok(!quoted.ok || quoted.serviceDate === "2026-11-01");
});

test("QA 快照 30 分钟边界：expiresAt = createdAt + 30 分钟；差 1 毫秒还能用，到点那一刻失效", () => {
  const created = new Date("2026-10-07T01:00:00.000Z");
  const expires = quoteExpiresAt(created);
  assert.equal(expires.toISOString(), "2026-10-07T01:30:00.000Z");
  assert.equal(quoteSnapshotValid({ expiresAt: expires.toISOString() }, new Date(expires.getTime() - 1)), true);
  assert.equal(quoteSnapshotValid({ expiresAt: expires.toISOString() }, expires), false);
  const group = compareQuotes({ request: request(), currency: "JPY", entries: [{ quote: quoteProduct(product(), request(), moment()), productVersion: 3, standing: DEFAULT_TENANT_STANDING, markupBp: () => 1_000, fx: null }], now: created }).groups[0];
  assert.ok(group);
  assert.deepEqual([group.snapshot.createdAt, group.snapshot.expiresAt, group.snapshot.winner.productVersion], [created.toISOString(), expires.toISOString(), 3]);
});

test("QA 汇率 48 小时边界：正好 48 小时可用，多 1 毫秒不可用（compareQuotes 里跨币种的报不出，同币种的不受影响）；取数时间写错的不可用", () => {
  const now = new Date("2026-10-07T01:00:00.000Z");
  const at = (ms: number) => new Date(now.getTime() - ms).toISOString();
  assert.equal(fxQuoteUsable({ asOf: at(48 * 3_600_000) }, now), true);
  assert.equal(fxQuoteUsable({ asOf: at(48 * 3_600_000 + 1) }, now), false);
  assert.equal(fxQuoteUsable({ asOf: "昨天" }, now), false);
  const entry = (asOf: string): ComparisonEntry => ({ quote: quoteProduct(product({ currency: "CNY" }), request(), moment()), productVersion: 1, standing: DEFAULT_TENANT_STANDING, markupBp: () => 1_000, fx: { from: "CNY", to: "JPY", rate: "20", asOf } });
  assert.equal(compareQuotes({ request: request(), currency: "JPY", entries: [entry(at(48 * 3_600_000))], now }).groups.length, 1);
  const stale = compareQuotes({ request: request(), currency: "JPY", entries: [entry(at(48 * 3_600_000 + 1))], now });
  assert.deepEqual([stale.groups.length, stale.refused.map((x) => x.reason)], [0, ["FX_RATE_UNAVAILABLE"]]);
});

// ======================================================================
// 区域
// ======================================================================

test("QA 区域：点对点两端各在不同区域、两端都在营运区才报；一端在营运区外 → OUT_OF_SERVICE_AREA；一端只在禁行区 → IN_FORBIDDEN_AREA", () => {
  const p = product({ category: "point_to_point", pickupPlace: null, priceRules: [priceRule(20_000, { direction: null }), priceRule(18_000, { areaId: "a2", direction: null })] });
  const p2p = (pickup: { lng: number; lat: number }, dropoff: { lng: number; lat: number }) => request({ category: "point_to_point", direction: null, pickup, dropoff });
  assert.equal(outcome(p, p2p(WEST, EAST)), 18_000, "两端区域的价都算，取最低");
  assert.equal(outcome(p, p2p(WEST, FAR)), "OUT_OF_SERVICE_AREA");
  assert.equal(outcome(p, p2p(FAR, WEST)), "OUT_OF_SERVICE_AREA");
  assert.equal(outcome(p, p2p(WEST, FORBIDDEN)), "IN_FORBIDDEN_AREA");
  assert.equal(outcome(p, p2p(OVERLAP, OVERLAP)), 18_000, "落在两个区域：都算，取最低");
});

test("QA 区域：几个区域的结算价一样低时取商品里排在前面的区域（与价格规则的先后无关）", () => {
  const p = product({ areas: [AREA_2, AREA_1], priceRules: [priceRule(20_000), priceRule(20_000, { areaId: "a2" })] });
  assert.equal(only(p, request({ dropoff: OVERLAP })).areaId, "a2");
  const q = product({ areas: [AREA_1, AREA_2], priceRules: [priceRule(20_000, { areaId: "a2" }), priceRule(20_000)] });
  assert.equal(only(q, request({ dropoff: OVERLAP })).areaId, "a1");
});

test("QA 请求里同一个车型组写了两次：一个车型组只出一个价（不该出两条一样的报价）", () => {
  const quoted = quoteProduct(product(), request({ vehicleGroupIds: ["biz7", "biz7"] }), moment());
  assert.ok(quoted.ok);
  assert.equal(quoted.offers.length + quoted.refused.length, 1, JSON.stringify(quoted.offers.map((o) => o.vehicleGroupId)));
});
