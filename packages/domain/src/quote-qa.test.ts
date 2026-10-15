/**
 * M2-01 报价引擎的补充测试（测试角色）：边界、时区、取整、区域、容量、库存、对外价。
 * 和 quote.test.ts 互补：那边逐项对应计价公式，这里专找边界和容易出错的组合。
 * 用 `{ todo: '缺陷 #n' }` 标记的测试是已发现的缺陷：断言写的是期望行为，现在会失败，修好后去掉 todo。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Position } from "./areas.ts";
import { roundFractionToUnit } from "./money.ts";
import type { AdjustRule, PriceRule, Pricing } from "./pricing.ts";
import { type ServiceRules, emptyServiceRules } from "./products.ts";
import { type ComparisonEntry, DEFAULT_TENANT_STANDING, type FxQuote, type ProductQuote, type QuoteMoment, type QuoteProduct, type QuoteRequest, compareQuotes, fxQuoteUsable, quoteProduct, rateFraction, sellPrice } from "./quote.ts";

const square = (west: number, south: number, east: number, north: number): Position[] => [[west, south], [east, south], [east, north], [west, north], [west, south]];
const AREA_1 = { areaId: "a1", active: true, shapes: [{ id: "a1-op", kind: "operate" as const, ring: square(139.0, 35.0, 139.6, 36.0) }] };
const AREA_2 = { areaId: "a2", active: true, shapes: [{ id: "a2-op", kind: "operate" as const, ring: square(139.5, 35.0, 140.0, 36.0) }, { id: "a2-no", kind: "forbid" as const, ring: square(139.8, 35.4, 139.9, 35.6) }] };
/** 盖住 A2 禁行区的第三个区域 */
const AREA_3 = { areaId: "a3", active: true, shapes: [{ id: "a3-op", kind: "operate" as const, ring: square(139.75, 35.3, 139.95, 35.7) }] };
const WEST = { lng: 139.2, lat: 35.5 };
const EAST = { lng: 139.7, lat: 35.5 };
const FORBIDDEN = { lng: 139.85, lat: 35.5 };
const FAR = { lng: 141.0, lat: 35.5 };

const fixed = (basePriceMinor: number): Pricing => ({ model: "fixed", basePriceMinor });
let priceSeq = 0;
const price = (pricing: Pricing, extra: Partial<PriceRule> = {}): PriceRule & { id: string } => ({ id: `p${(priceSeq += 1)}`, areaId: "a1", vehicleGroupId: "biz7", direction: "both", packageHours: null, pricing, validFrom: "2026-01-01", validTo: null, status: "enabled", ...extra });
const adjust = (name: string, steps: AdjustRule["steps"], extra: Partial<AdjustRule> = {}): AdjustRule & { id: string } => ({ id: `adj-${name}`, name, travelFrom: null, travelTo: null, cycle: { type: "daily" }, timeSlot: null, areaIds: [], vehicleGroupIds: [], directions: [], packageHours: [], steps, status: "enabled", ...extra });
const rules = (extra: Partial<ServiceRules> = {}): ServiceRules => ({
  ...emptyServiceRules(),
  booking: { saleFrom: null, saleTo: null, serviceTime: { start: "00:00", end: "24:00" }, leadTimeHours: 24, note: null },
  freeWait: { pickup: { mode: "limited", minutes: 90 }, dropoff: { mode: "limited", minutes: 15 }, general: { mode: "unlimited" } },
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
  priceRules: [price(fixed(20_000))],
  adjustRules: [],
  inventoryMode: "unlimited",
  ...extra,
});
const request = (extra: Partial<QuoteRequest> = {}): QuoteRequest => ({ category: "airport_transfer", pickup: null, dropoff: WEST, direction: "pickup", packageHours: null, serviceLocal: "2026-10-20T10:00", passengers: 2, luggage: 1, addons: [], driverLanguage: null, vehicleGroupIds: ["biz7"], ...extra });
/** 东京 2026-10-07 10:00（UTC 01:00） */
const NOW = new Date("2026-10-07T01:00:00Z");
const moment = (extra: Partial<QuoteMoment> = {}): QuoteMoment => ({ now: NOW, route: null, inventoryDay: null, urgentUsed: 0, ...extra });
const charterRequest = (extra: Partial<QuoteRequest> = {}): QuoteRequest => request({ category: "charter", direction: null, packageHours: 10, pickup: WEST, dropoff: null, ...extra });
const charterProduct = (extra: Partial<QuoteProduct> = {}): QuoteProduct =>
  product({ category: "charter", pickupPlace: null, priceRules: [price({ model: "charter_package", packageKm: 300, packagePriceMinor: 98_000, overtimePerHourMinor: 5_000, overKmPerKmMinor: 400 }, { direction: null, packageHours: 10 })], ...extra });
const p2pProduct = (extra: Partial<QuoteProduct> = {}): QuoteProduct => product({ category: "point_to_point", pickupPlace: null, priceRules: [price(fixed(8_000), { direction: null })], ...extra });
const p2pRequest = (pickup: typeof WEST, dropoff: typeof WEST): QuoteRequest => request({ category: "point_to_point", direction: null, pickup, dropoff });

/** 一个车型组的结果：结算价或原因 */
function outcome(p: QuoteProduct, r: QuoteRequest = request(), m: QuoteMoment = moment()): number | string {
  const quoted = quoteProduct(p, r, m);
  if (!quoted.ok) return quoted.reason;
  const first = quoted.offers[0];
  if (first) return first.settlement.totalMinor;
  return (quoted.refused[0] as { reason: string }).reason;
}
function settled(p: QuoteProduct, r: QuoteRequest = request(), m: QuoteMoment = moment()) {
  const quoted = quoteProduct(p, r, m);
  assert.ok(quoted.ok && quoted.offers.length === 1, JSON.stringify(quoted));
  return quoted.offers[0] as Extract<ProductQuote, { ok: true }>["offers"][number];
}
const sumOf = (s: ReturnType<typeof settled>["settlement"]): number => s.baseMinor + s.adjustMinor + s.urgentMinor + s.nightMinor + s.addonsMinor + s.driverLanguageMinor;

// ---- 计价公式 ----

test("QA 基础价·里程 + 时长：不足 1 公里按比例（不取整）、起步以内只收起步价、低于最低消费按最低消费；精确值最后才按取整单位取整", () => {
  const metered = (minPriceMinor: number | null): QuoteProduct => product({ roundingUnit: 10, priceRules: [price({ model: "mileage_time", startPriceMinor: 3_000, startMeters: 5_000, startMinutes: 20, perKmMinor: 333, perMinuteMinor: 7, minPriceMinor })] });
  // 5.5 公里 → 超出 0.5 公里 × 333 = 166.5；25 分钟 → 超出 5 分钟 × 7 = 35；3000 + 166.5 + 35 = 3201.5 → 取整到 10 = 3200
  const s = settled(metered(null), request(), moment({ route: { meters: 5_500, minutes: 25 } })).settlement;
  assert.deepEqual([s.exact.base, s.totalMinor, s.baseMinor, s.adjustMinor, sumOf(s)], ["3201.5", 3_200, 3_202, -2, 3_200]);
  // 起步以内：只收起步价
  assert.equal(outcome(metered(null), request(), moment({ route: { meters: 4_999, minutes: 20 } })), 3_000);
  // 最低消费 4,000 高于算出来的 3,201.5：按 4,000
  assert.equal(outcome(metered(4_000), request(), moment({ route: { meters: 5_500, minutes: 25 } })), 4_000);
  // 路线预估 0 米 0 分钟（同一个点）：起步价
  assert.equal(outcome(metered(null), request(), moment({ route: { meters: 0, minutes: 0 } })), 3_000);
});

test("QA 基础价·包车套餐：报价时 H = 套餐时长、不看路线预估——路线预估给了很长的里程和时长也不收超时、超公里", () => {
  const p = charterProduct();
  assert.equal(outcome(p, charterRequest(), moment({ route: null })), 98_000);
  assert.equal(outcome(p, charterRequest(), moment({ route: { meters: 900_000, minutes: 2_000 } })), 98_000);
  // 请求的套餐时长没有对应的价格：不报（不会拿 10 小时的价去算 8 小时）
  assert.equal(outcome(p, charterRequest({ packageHours: 8 })), "NO_PRICE_RULE");
});

test("QA 链式调价：百分比以前一步结果为基数、金额直接加减；负数步骤；规则之间按顺序，后一条以前一条的结果为基数", () => {
  // 10,000 → +10% = 11,000 → −500 = 10,500 → 第二条 −10% = 9,450
  const chain = product({ priceRules: [price(fixed(10_000))], adjustRules: [adjust("一", [{ type: "percent", value: 1_000 }, { type: "amount", value: -500 }]), adjust("二", [{ type: "percent", value: -1_000 }])] });
  const s = settled(chain).settlement;
  assert.deepEqual(
    [s.totalMinor, s.adjusts.map((entry) => entry.steps.map((step) => [step.delta, step.after]))],
    [9_450, [[["1000", "11000"], ["-500", "10500"]], [["-1050", "9450"]]]],
  );
  // 两条规则换个顺序：10,000 −10% = 9,000 → +10% = 9,900 → −500 = 9,400
  assert.equal(outcome({ ...chain, adjustRules: [...chain.adjustRules].reverse() }), 9_400);
});

test("QA 加急、夜间、附加服务、司机语言不参与调价：调价 +50% 只乘在基础价上", () => {
  const p = product({
    priceRules: [price(fixed(10_000))],
    adjustRules: [adjust("+50%", [{ type: "percent", value: 5_000 }])],
    addonCatalog: [{ addonId: "sign", chargeUnit: "per_order", usable: true }],
    serviceRules: rules({
      urgent: { enabled: true, dailyQuota: null, tiers: [{ withinHours: 24, surchargeMinor: 1_000 }] },
      night: { enabled: true, window: { start: "22:00", end: "06:00" }, amountMinor: 2_000, chargeUnit: "per_order" },
      addons: [{ addonId: "sign", enabled: true, unitPriceMinor: 500, firstFree: false }],
      driverLanguages: [{ language: "zh", unitPriceMinor: 3_000 }],
    }),
  });
  // 今晚 23:00（加急）、举牌、中文司机：15,000 + 1,000 + 2,000 + 500 + 3,000 = 21,500
  const s = settled(p, request({ serviceLocal: "2026-10-07T23:00", addons: [{ addonId: "sign", quantity: 1 }], driverLanguage: "zh" })).settlement;
  assert.deepEqual([s.totalMinor, s.baseMinor, s.adjustMinor, s.urgentMinor, s.nightMinor, s.addonsMinor, s.driverLanguageMinor], [21_500, 10_000, 5_000, 1_000, 2_000, 500, 3_000]);
});

test("QA 只在最后取整一次：按时长计费的附加服务不足一小时时也不能先取整到最小货币单位", { todo: "缺陷 #1" }, () => {
  const p = product({
    priceRules: [price(fixed(1_001))],
    adjustRules: [adjust("-60%", [{ type: "percent", value: -6_000 }])],
    addonCatalog: [{ addonId: "guide", chargeUnit: "per_duration", usable: true }],
    serviceRules: rules({ addons: [{ addonId: "guide", enabled: true, unitPriceMinor: 100, firstFree: false }] }),
  });
  // 调价后 1001 × 0.4 = 400.4；导游 50 分钟 = 100 × 50/60 = 83.333…；合计 483.733… → 484
  const s = settled(p, request({ addons: [{ addonId: "guide", quantity: 1 }] }), moment({ route: { meters: 10_000, minutes: 50 } })).settlement;
  assert.equal(s.totalMinor, 484, `实际 ${s.totalMinor}，exact.total = ${s.exact.total}`);
});

test("QA 调价后单独取整为 0、但加上夜间费后结算价为正：不应因为中间取整报 PRICE_NOT_POSITIVE", { todo: "缺陷 #2" }, () => {
  const p = product({
    roundingUnit: 100,
    priceRules: [price(fixed(100))],
    adjustRules: [adjust("-60%", [{ type: "percent", value: -6_000 }])],
    serviceRules: rules({ night: { enabled: true, window: { start: "22:00", end: "06:00" }, amountMinor: 3_000, chargeUnit: "per_order" } }),
  });
  // 调价后精确值 40（> 0）+ 夜间 3,000 = 3,040 → 取整到 100 = 3,000
  assert.equal(outcome(p, request({ serviceLocal: "2026-10-20T23:00" })), 3_000);
});

test("QA 取整：一系列随机的价格、调价、费用组合——结算价 = (调价后的精确值 + 加急 + 夜间 + 附加服务) 按取整单位四舍五入一次、是取整单位的整数倍、明细各项之和恒等于结算价", () => {
  let seed = 20261007;
  const rand = (n: number): number => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed % n;
  };
  /** 有限小数的十进制写法 → 分数 */
  const decimal = (text: string): { numerator: bigint; denominator: bigint } => {
    const negative = text.startsWith("-");
    const [whole, fraction = ""] = text.replace("-", "").split(".");
    return { numerator: (negative ? -1n : 1n) * BigInt(`${whole}${fraction}`), denominator: 10n ** BigInt(fraction.length) };
  };
  for (let i = 0; i < 300; i += 1) {
    const unit = [1, 10, 100, 1_000][rand(4)] as number;
    const p = product({
      roundingUnit: unit,
      priceRules: [price(fixed(1_000 + rand(50_000)))],
      adjustRules: [adjust("a", [{ type: "percent", value: rand(4_000) - 1_500 }, { type: "amount", value: rand(2_000) - 500 }]), adjust("b", [{ type: "percent", value: rand(3_000) - 1_000 }])],
      addonCatalog: [{ addonId: "seat", chargeUnit: "per_item", usable: true }],
      serviceRules: rules({
        urgent: { enabled: true, dailyQuota: null, tiers: [{ withinHours: 24, surchargeMinor: rand(3_000) }] },
        // 每小时的金额取 60 的倍数：按分钟算出来的夜间费是整数，下面可以独立复算总价
        night: { enabled: true, window: { start: "22:00", end: "06:00" }, amountMinor: 60 * (1 + rand(80)), chargeUnit: "per_hour" },
        addons: [{ addonId: "seat", enabled: true, unitPriceMinor: rand(2_000), firstFree: rand(2) === 0 }],
      }),
    });
    const r = request({ serviceLocal: rand(2) === 0 ? "2026-10-07T21:47" : "2026-10-20T23:13", addons: [{ addonId: "seat", quantity: 1 + rand(3) }] });
    const quoted = quoteProduct(p, r, moment({ route: { meters: 30_000, minutes: 1 + rand(400) } }));
    assert.ok(quoted.ok, JSON.stringify(quoted));
    for (const offer of quoted.offers) {
      const s = offer.settlement;
      const label = JSON.stringify({ i, unit, s: { ...s, adjusts: undefined } });
      const adjusted = decimal(s.exact.adjusted);
      const extras = BigInt(s.urgentMinor + s.nightMinor + s.addonsMinor + s.driverLanguageMinor);
      assert.equal(s.exact.night, String(s.nightMinor), label);
      assert.equal(s.totalMinor, roundFractionToUnit(adjusted.numerator + extras * adjusted.denominator, adjusted.denominator, unit), label);
      assert.equal(s.totalMinor % unit, 0, label);
      assert.equal(sumOf(s), s.totalMinor, label);
    }
  }
});

// ---- 夜间费 ----

const night = (chargeUnit: "per_order" | "per_hour", window = { start: "22:00", end: "06:00" }, amountMinor = 3_000): ServiceRules["night"] => ({ enabled: true, window, amountMinor, chargeUnit });

test("QA 夜间费按小时：跨午夜、06:00 整开始、跨两个夜晚的包车、不足一小时按比例且明细之和仍等于结算价", () => {
  const p = product({ serviceRules: rules({ night: night("per_hour") }) });
  const at = (time: string, minutes: number) => outcome(p, request({ serviceLocal: `2026-10-20T${time}` }), moment({ route: { meters: 1, minutes } }));
  // 23:00 出发 120 分钟：跨过午夜，整段都在夜间 → 6,000
  assert.equal(at("23:00", 120), 26_000);
  // 05:30 出发 60 分钟：05:30–06:00 半小时 → 1,500
  assert.equal(at("05:30", 60), 21_500);
  // 06:00 整出发：不算夜间
  assert.equal(at("06:00", 60), 20_000);
  // 21:59 出发 1 分钟：不重叠；2 分钟：重叠 1 分钟 = 50
  assert.deepEqual([at("21:59", 1), at("21:59", 2)], [20_000, 20_050]);
  // 7 分钟 × 1,000 / 60 = 116.67：明细里夜间 117，取整尾差进调价项，各项之和 = 结算价
  const odd = settled(product({ serviceRules: rules({ night: night("per_hour", undefined, 1_000) }) }), request({ serviceLocal: "2026-10-20T23:00" }), moment({ route: { meters: 1, minutes: 7 } })).settlement;
  assert.deepEqual([odd.totalMinor, odd.nightMinor, odd.night, sumOf(odd)], [20_117, 117, { chargeUnit: "per_hour", overlapMinutes: 7 }, 20_117]);
  // 包车 48 小时、21:00 出发：经过两个完整的夜晚（各 8 小时）→ 16 × 3,000
  const charter = charterProduct({ priceRules: [price({ model: "charter_package", packageKm: 300, packagePriceMinor: 98_000, overtimePerHourMinor: 5_000, overKmPerKmMinor: 400 }, { direction: null, packageHours: 48 })], serviceRules: rules({ night: night("per_hour") }) });
  const s = settled(charter, charterRequest({ packageHours: 48, serviceLocal: "2026-10-20T21:00" })).settlement;
  assert.deepEqual([s.nightMinor, s.night?.overlapMinutes], [48_000, 960]);
});

test("QA 夜间时段的其他写法：00:00–05:00（不跨天）、22:00–24:00、22:00–00:00（结束在午夜）都是「开始含、结束不含」", () => {
  const withWindow = (start: string, end: string) => product({ serviceRules: rules({ night: night("per_order", { start, end }) }) });
  const at = (p: QuoteProduct, time: string) => outcome(p, request({ serviceLocal: `2026-10-20T${time}` }));
  const early = withWindow("00:00", "05:00");
  assert.deepEqual(["23:59", "00:00", "04:59", "05:00"].map((time) => at(early, time)), [20_000, 23_000, 23_000, 20_000]);
  for (const end of ["24:00", "00:00"]) {
    const late = withWindow("22:00", end);
    assert.deepEqual(["21:59", "22:00", "23:59", "00:00"].map((time) => at(late, time)), [20_000, 23_000, 23_000, 20_000], end);
  }
});

// ---- 时区、日期边界 ----

test("QA 下单有效期按城市当地的「今天」：东京午夜前后一分钟（UTC 14:59 / 15:00）", () => {
  const p = product({ serviceRules: rules({ booking: { ...rules().booking, saleFrom: "2026-10-08", saleTo: "2026-10-08" } }) });
  assert.equal(outcome(p, request(), moment({ now: new Date("2026-10-07T14:59:59Z") })), "OUTSIDE_SALE_PERIOD", "东京 10-07 23:59:59");
  assert.equal(outcome(p, request(), moment({ now: new Date("2026-10-07T15:00:00Z") })), 20_000, "东京 10-08 00:00");
  assert.equal(outcome(p, request(), moment({ now: new Date("2026-10-08T14:59:59Z") })), 20_000, "东京 10-08 23:59:59");
  assert.equal(outcome(p, request(), moment({ now: new Date("2026-10-08T15:00:00Z") })), "OUTSIDE_SALE_PERIOD", "东京 10-09 00:00");
});

test("QA 跨月：价格生效期按当地日期——10-31 23:59 用 10 月的价，11-01 00:00 用 11 月的价；跨午夜调价时段算在开始那天", () => {
  const p = product({
    priceRules: [price(fixed(20_000), { validFrom: "2026-10-01", validTo: "2026-10-31" }), price(fixed(25_000), { validFrom: "2026-11-01", validTo: null })],
    adjustRules: [adjust("万圣夜", [{ type: "amount", value: 1_000 }], { cycle: { type: "dates", dates: ["2026-10-31"] }, timeSlot: { start: "22:00", end: "02:00" } })],
  });
  // 10-31 23:59：10 月的价 + 万圣夜；11-01 00:00：11 月的价，调价时段仍算 10-31 的（跨午夜的后半段）
  assert.deepEqual([outcome(p, request({ serviceLocal: "2026-10-31T23:59" })), outcome(p, request({ serviceLocal: "2026-11-01T00:00" })), outcome(p, request({ serviceLocal: "2026-11-01T02:00" }))], [21_000, 26_000, 25_000]);
  assert.equal(quoteProduct(p, request({ serviceLocal: "2026-11-01T00:00" }), moment()).ok && (quoteProduct(p, request({ serviceLocal: "2026-11-01T00:00" }), moment()) as { serviceDate: string }).serviceDate, "2026-11-01");
  // 同一个钟面时间放在纽约的商品上：日期还是按纽约当地
  const ny = { ...p, timeZone: "America/New_York" };
  assert.equal(outcome(ny, request({ serviceLocal: "2026-11-01T00:00" })), 26_000);
});

test("QA 提前预订时长按真实经过的时间：纽约冬令时切换那晚（2026-11-01 01:00–02:00 出现两次）多出来的一小时也算", () => {
  // 纽约 2026-10-31 02:00（EDT）= UTC 06:00；提前 24 小时
  const ny = product({ timeZone: "America/New_York", priceRules: [price(fixed(100))] });
  const now = new Date("2026-10-31T06:00:00Z");
  // 11-01 01:00 出现两次，取先到的一次（EDT，UTC 05:00）：离现在 23 小时 → 不够
  assert.equal(outcome(ny, request({ serviceLocal: "2026-11-01T01:00" }), moment({ now })), "LEAD_TIME_TOO_SHORT");
  // 11-01 02:00（EST，UTC 07:00）：离现在 25 小时 → 够
  assert.equal(outcome(ny, request({ serviceLocal: "2026-11-01T02:00" }), moment({ now })), 100);
  // 11-01 01:59 EDT（UTC 05:59）：23 小时 59 分 → 不够
  assert.equal(outcome(ny, request({ serviceLocal: "2026-11-01T01:59" }), moment({ now })), "LEAD_TIME_TOO_SHORT");
});

test("QA 提前预订时长和加急阶梯的边界：正好等于某一档算命中；比提前时长短一分钟、但比最大的一档长时不报", () => {
  const urgent = (dailyQuota: number | null) => product({ serviceRules: rules({ urgent: { enabled: true, dailyQuota, tiers: [{ withinHours: 12, surchargeMinor: 2_000 }, { withinHours: 6, surchargeMinor: 5_000 }] } }) });
  const at = (local: string, m: QuoteMoment = moment()) => outcome(urgent(null), request({ serviceLocal: local }), m);
  assert.equal(at("2026-10-07T16:00"), 25_000, "正好 6 小时：6 小时内那一档");
  assert.equal(at("2026-10-07T16:01"), 22_000, "6 小时 1 分：12 小时内那一档");
  assert.equal(at("2026-10-07T22:00"), 22_000, "正好 12 小时");
  assert.equal(at("2026-10-07T22:01"), "LEAD_TIME_TOO_SHORT", "12 小时 1 分：不够 24 小时、也没有够用的一档");
  assert.equal(at("2026-10-07T10:01"), 25_000, "离用车 1 分钟也算最小的一档");
  assert.equal(at("2026-10-08T10:00"), 20_000, "正好 24 小时：不算加急");
  // 现在带秒：离用车 23 小时 59 分 30 秒，不够 24 小时
  assert.equal(outcome(product(), request({ serviceLocal: "2026-10-08T10:00" }), moment({ now: new Date("2026-10-07T01:00:30Z") })), "LEAD_TIME_TOO_SHORT");
  // 每日加急库存 0：加急单一律报不出；用量差一单时还能报
  assert.equal(outcome(urgent(0), request({ serviceLocal: "2026-10-07T16:00" })), "URGENT_SOLD_OUT");
  assert.equal(outcome(urgent(3), request({ serviceLocal: "2026-10-07T16:00" }), moment({ urgentUsed: 2 })), 25_000);
  assert.equal(outcome(urgent(3), request({ serviceLocal: "2026-10-07T16:00" }), moment({ urgentUsed: 3 })), "URGENT_SOLD_OUT");
});

test("QA 时区：纽约的商品夜间费按纽约的钟面——同一个 UTC 时刻在东京是白天", () => {
  const p = product({ timeZone: "America/New_York", serviceRules: rules({ night: night("per_order") }) });
  // 纽约 2026-10-20 23:00（EDT）= 东京 10-21 12:00
  assert.equal(outcome(p, request({ serviceLocal: "2026-10-20T23:00" })), 23_000);
  assert.equal(outcome(p, request({ serviceLocal: "2026-10-20T12:00" })), 20_000);
});

// ---- 区域、容量、库存 ----

test("QA 区域：压在营运区边线上算在里面；压在禁行区边线上算禁行；停用的区域即使更便宜也不用", () => {
  // A1 的东边线 lng = 139.6，只在 A1 和 A2 重叠的部分里——取 A1 的西边线 139.0
  assert.equal(outcome(product(), request({ dropoff: { lng: 139.0, lat: 35.5 } })), 20_000);
  // A2 禁行区的西边线 139.8（A2 营运区里、没有别的区域盖住）
  assert.equal(outcome(product(), request({ dropoff: { lng: 139.8, lat: 35.5 } })), "IN_FORBIDDEN_AREA");
  const twoPrices = [price(fixed(20_000), { areaId: "a1" }), price(fixed(10_000), { areaId: "a2" })];
  assert.equal(outcome(product({ areas: [AREA_1, { ...AREA_2, active: false }], priceRules: twoPrices }), request({ dropoff: { lng: 139.55, lat: 35.5 } })), 20_000);
  // 所有区域都停用：营运区外
  assert.equal(outcome(product({ areas: [{ ...AREA_1, active: false }, { ...AREA_2, active: false }] }), request({ dropoff: FORBIDDEN })), "OUT_OF_SERVICE_AREA");
  // 商品没有选区域
  assert.equal(outcome(product({ areas: [] })), "OUT_OF_SERVICE_AREA");
});

test("QA 区域：点对点起点落在禁行区（没有别的区域能接）就不报，不管终点在哪；送机只看上车点，下车点在禁行区也照报", () => {
  assert.equal(outcome(p2pProduct(), p2pRequest(FORBIDDEN, WEST)), "IN_FORBIDDEN_AREA");
  assert.equal(outcome(p2pProduct(), p2pRequest(FORBIDDEN, FAR)), "IN_FORBIDDEN_AREA", "先查起点");
  assert.equal(outcome(product({ priceRules: [price(fixed(20_000), { areaId: "a2" })] }), request({ direction: "dropoff", pickup: EAST, dropoff: FORBIDDEN })), 20_000);
  assert.equal(outcome(product(), request({ direction: "dropoff", pickup: FORBIDDEN, dropoff: WEST })), "IN_FORBIDDEN_AREA");
});

test("QA 区域：点对点终点在 A2 的禁行区里（由 A3 接）、起点只在 A2——A2 的价不应被用来报这一单（禁行区只管它所在的区域，但这一单正是进了 A2 的禁行区）", { todo: "缺陷 #3" }, () => {
  const p = p2pProduct({ areas: [AREA_1, AREA_2, AREA_3], priceRules: [price(fixed(8_000), { areaId: "a2", direction: null }), price(fixed(12_000), { areaId: "a3", direction: null })] });
  const quoted = settled(p, p2pRequest(EAST, FORBIDDEN));
  assert.deepEqual([quoted.areaId, quoted.settlement.totalMinor], ["a3", 12_000]);
});

test("QA 容量：人数、行李正好等于组合可以，多一个就不报；只超行李也不报；几个车型组各自判断", () => {
  const p = product({ vehicleGroups: [{ vehicleGroupId: "biz7", passengers: 6, luggage: 4, active: true }, { vehicleGroupId: "eco4", passengers: 3, luggage: 2, active: true }], priceRules: [price(fixed(20_000)), price(fixed(12_000), { vehicleGroupId: "eco4" })] });
  const all = (passengers: number, luggage: number) => {
    const quoted = quoteProduct(p, request({ passengers, luggage, vehicleGroupIds: [] }), moment());
    assert.ok(quoted.ok);
    return Object.fromEntries([...quoted.offers.map((o) => [o.vehicleGroupId, o.settlement.totalMinor]), ...quoted.refused.map((r) => [r.vehicleGroupId, r.reason])]);
  };
  assert.deepEqual(all(3, 2), { biz7: 20_000, eco4: 12_000 });
  assert.deepEqual(all(4, 2), { biz7: 20_000, eco4: "CAPACITY_EXCEEDED" });
  assert.deepEqual(all(3, 3), { biz7: 20_000, eco4: "CAPACITY_EXCEEDED" });
  assert.deepEqual(all(6, 4), { biz7: 20_000, eco4: "CAPACITY_EXCEEDED" });
  assert.deepEqual(all(6, 5), { biz7: "CAPACITY_EXCEEDED", eco4: "CAPACITY_EXCEEDED" });
  assert.deepEqual(all(7, 0), { biz7: "CAPACITY_EXCEEDED", eco4: "CAPACITY_EXCEEDED" });
  // 请求了商品没有的车型组；停用的车型组
  const quoted = quoteProduct({ ...p, vehicleGroups: [{ vehicleGroupId: "biz7", passengers: 6, luggage: 4, active: false }] }, request({ vehicleGroupIds: ["biz7", "van9"] }), moment());
  assert.ok(quoted.ok);
  assert.deepEqual(quoted.refused, [{ vehicleGroupId: "biz7", reason: "VEHICLE_GROUP_DISABLED" }, { vehicleGroupId: "van9", reason: "VEHICLE_GROUP_NOT_OFFERED" }]);
});

test("QA 库存为 0 和剩最后一单：限量时总数 0 / 已占满 / 已售满不报；剩 1 单可以报；库存看的是商品层面，所有车型组一起不报", () => {
  const limited = product({ inventoryMode: "limited", vehicleGroups: [{ vehicleGroupId: "biz7", passengers: 6, luggage: 4, active: true }, { vehicleGroupId: "eco4", passengers: 3, luggage: 2, active: true }] });
  const at = (day: QuoteMoment["inventoryDay"]) => quoteProduct(limited, request({ vehicleGroupIds: [] }), moment({ inventoryDay: day }));
  for (const day of [{ total: 0, held: 0, sold: 0 }, { total: 2, held: 2, sold: 0 }, { total: 2, held: 0, sold: 2 }, { total: 2, held: 1, sold: 1 }]) assert.deepEqual(at(day), { ok: false, productId: "prd-1", tenantId: "tenant-a", reason: "SOLD_OUT" }, JSON.stringify(day));
  const last = at({ total: 2, held: 1, sold: 0 });
  assert.ok(last.ok && last.offers.length === 1);
});

// ---- 对外价 ----

test("QA 对外价·同币种：需求文档的例子 108,900 × 1.10 = 119,790（不是 119,800）；加价低于 10% 按 10%；高于下限照用；汇率给了也不用、没有缓冲", () => {
  const sell = (markupBp: number, extra: Partial<Parameters<typeof sellPrice>[0]> = {}) => sellPrice({ settlementMinor: 108_900, settlementCurrency: "JPY", currency: "JPY", markupBp, fx: null, ...extra });
  assert.deepEqual(sell(1_000), { currency: "JPY", sellMinor: 119_790, markupBp: 1_000, fxBufferBp: 0, fx: null, exact: "119790" });
  assert.deepEqual([sell(999), sell(0)].map((s) => "sellMinor" in s && [s.sellMinor, s.markupBp]), [[119_790, 1_000], [119_790, 1_000]]);
  const higher = sell(1_550);
  assert.deepEqual("sellMinor" in higher && [higher.sellMinor, higher.markupBp], [125_780, 1_550]);
  const withFx = sell(1_000, { fx: { from: "JPY", to: "USD", rate: "0.0067", asOf: "2026-10-07T00:00:00Z" } });
  assert.deepEqual("sellMinor" in withFx && [withFx.sellMinor, withFx.fxBufferBp, withFx.fx], [119_790, 0, null]);
  // 人民币：两位小数，按分四舍五入：123.45 元 × 1.1 = 135.795 → 135.80
  const cny = sellPrice({ settlementMinor: 12_345, settlementCurrency: "CNY", currency: "CNY", markupBp: 1_000, fx: null });
  assert.deepEqual("sellMinor" in cny && [cny.sellMinor, cny.exact], [13_580, "13579.5"]);
  // 加价比例不合法（负数、小数）直接拒绝，不会悄悄当成 0
  assert.throws(() => sell(-1), RangeError);
  assert.throws(() => sell(10.5), RangeError);
});

test("QA 对外价·跨币种：最小货币单位的小数位换算（日元 ↔ 美元、韩元 → 日元）、1.5% 缓冲、恰好一半往大的取；汇率方向不对、写法不对都当作没有汇率", () => {
  const fx = (from: FxQuote["from"], to: FxQuote["to"], rate: string): FxQuote => ({ from, to, rate, asOf: "2026-10-07T00:00:00Z" });
  const sell = (settlementMinor: number, from: FxQuote["from"], to: FxQuote["to"], quote: FxQuote | null) => sellPrice({ settlementMinor, settlementCurrency: from, currency: to, markupBp: 1_000, fx: quote });
  // ¥10,000 × 0.0067 = $67.00 = 6,700 美分 × 1.015 × 1.1 = 7,480.55 → 7,481
  assert.deepEqual(sell(10_000, "JPY", "USD", fx("JPY", "USD", "0.0067")), { currency: "USD", sellMinor: 7_481, markupBp: 1_000, fxBufferBp: 150, fx: fx("JPY", "USD", "0.0067"), exact: "7480.55" });
  // $12.34 × 149.5 = ¥1,844.83 × 1.015 × 1.1 = 2,059.75… → 2,060
  const usd = sell(1_234, "USD", "JPY", fx("USD", "JPY", "149.5"));
  assert.deepEqual("sellMinor" in usd && usd.sellMinor, 2_060);
  // ₩100,000 × 0.11 = ¥11,000 × 1.015 × 1.1 = 12,281.5 → 12,282（恰好一半往大的取）
  const krw = sell(100_000, "KRW", "JPY", fx("KRW", "JPY", "0.11"));
  assert.deepEqual("sellMinor" in krw && [krw.sellMinor, krw.exact], [12_282, "12281.5"]);
  // 汇率方向反了、币种对不上、写法不对、为 0
  for (const bad of [fx("USD", "JPY", "0.0067"), fx("JPY", "CNY", "0.0468"), fx("JPY", "USD", "1e-3"), fx("JPY", "USD", "0"), fx("JPY", "USD", "-0.5"), fx("JPY", "USD", ""), fx("JPY", "USD", " 0.0067")]) {
    assert.deepEqual(sell(10_000, "JPY", "USD", bad), { failure: "FX_RATE_UNAVAILABLE" }, JSON.stringify(bad));
  }
  assert.deepEqual(sell(10_000, "JPY", "USD", null), { failure: "FX_RATE_UNAVAILABLE" });
  assert.deepEqual([rateFraction("0.000000000001"), rateFraction("1.0000000000001")], [{ numerator: 1n, denominator: 10n ** 12n }, null]);
});

test("QA 汇率 48 小时边界（毫秒级）：正好 48 小时还能用，多 1 毫秒就不用；取数时间写得不对也不用", () => {
  const now = new Date("2026-10-07T01:00:00.000Z");
  assert.equal(fxQuoteUsable({ asOf: "2026-10-05T01:00:00.000Z" }, now), true);
  assert.equal(fxQuoteUsable({ asOf: "2026-10-05T00:59:59.999Z" }, now), false);
  assert.equal(fxQuoteUsable({ asOf: "2026-10-05T10:00:00+09:00" }, now), true, "带时区偏移的写法：东京 10:00 = UTC 01:00");
  assert.equal(fxQuoteUsable({ asOf: "昨天" }, now), false);
  assert.equal(fxQuoteUsable({ asOf: "" }, now), false);
});

test("QA 比价·跨币种：人民币商品按汇率和缓冲换成日元后与日元商品比；汇率过期 1 毫秒的那家报不出、日元的照常中标；同一租户只留最低的一个", () => {
  const offerOf = (tenantId: string, productId: string, currency: "JPY" | "CNY", totalMinor: number): ProductQuote => {
    const p = product({ tenantId, productId, currency, priceRules: [price(fixed(totalMinor))] });
    return quoteProduct(p, request(), moment());
  };
  const entry = (quote: ProductQuote, fx: FxQuote | null): ComparisonEntry => ({ quote, productVersion: 1, standing: DEFAULT_TENANT_STANDING, markupBp: () => 1_000, fx });
  const rate = (asOf: string): FxQuote => ({ from: "CNY", to: "JPY", rate: "21.5", asOf });
  const entries = (asOf: string) => [
    entry(offerOf("t-jpy", "p-jpy", "JPY", 21_000), null),
    entry(offerOf("t-cny", "p-cny", "CNY", 90_000), rate(asOf)),
    entry(offerOf("t-cny", "p-cny-2", "CNY", 95_000), rate(asOf)),
  ];
  const fresh = compareQuotes({ request: request(), currency: "JPY", entries: entries("2026-10-05T01:00:00.000Z"), now: NOW });
  // 900 × 21.5 × 1.015 × 1.1 = 21,604；21,000 × 1.1 = 23,100
  const ranked = (fresh.groups[0]?.ranked ?? []).map((r) => [r.candidate.productId, r.candidate.sellMinor, r.inBand]);
  assert.deepEqual(ranked, [["p-cny", 21_604, true], ["p-jpy", 23_100, false]]);
  const stale = compareQuotes({ request: request(), currency: "JPY", entries: entries("2026-10-05T00:59:59.999Z"), now: NOW });
  assert.deepEqual((stale.groups[0]?.ranked ?? []).map((r) => r.candidate.productId), ["p-jpy"]);
  assert.deepEqual(stale.refused.map((r) => [r.productId, r.reason]), [["p-cny", "FX_RATE_UNAVAILABLE"], ["p-cny-2", "FX_RATE_UNAVAILABLE"]]);
  // 快照里记的是实际用的加价比例（低于下限时记下限）
  const floored = compareQuotes({ request: request(), currency: "JPY", entries: [{ ...entry(offerOf("t-jpy", "p-jpy", "JPY", 21_000), null), markupBp: () => 500 }], now: NOW });
  assert.deepEqual([floored.groups[0]?.snapshot.winner.sell.markupBp, floored.groups[0]?.snapshot.candidates[0]?.markupBp, floored.groups[0]?.snapshot.winner.sell.sellMinor], [1_000, 1_000, 23_100]);
});
