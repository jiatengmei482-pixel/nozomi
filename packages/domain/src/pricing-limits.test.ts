/**
 * M1-04 修缺陷时补的规则：结算价的上限、可以卖的价格、调价规则的叠加检查、money.ts 的整数实现和适用范围。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { FLOAT_ROUNDING_LIMIT, applyBasisPoints, portionBasisPoints, roundHalfAwayFromZero, roundToUnit } from "./money.ts";
import { convertMinor } from "./fx.ts";
import {
  type AdjustRule,
  type AdjustStep,
  PRICE_LIMITS,
  type PriceRule,
  adjustRuleNonPositivePrices,
  adjustRuleOverLimitPrices,
  adjustStackProblems,
  applyAdjustRules,
  exactFromMinor,
  exceedsSettlementLimit,
  holidayLookup,
  sellablePriceRules,
  tripPrice,
} from "./pricing.ts";

const price = (basePriceMinor: number, extra: Partial<PriceRule> = {}): PriceRule => ({ areaId: "a1", vehicleGroupId: "g1", direction: null, packageHours: null, pricing: { model: "fixed", basePriceMinor }, validFrom: "2026-01-01", validTo: null, status: "enabled", ...extra });
const adjust = (steps: AdjustStep[], extra: Partial<AdjustRule> = {}): AdjustRule => ({ name: "规则", travelFrom: null, travelTo: null, cycle: { type: "daily" }, timeSlot: null, areaIds: [], vehicleGroupIds: [], directions: [], packageHours: [], steps, status: "enabled", ...extra });
const percent = (value: number): AdjustStep => ({ type: "percent", value });

test("结算价的上限：正好一万亿可以报，多一个最小单位就不报；连乘出任意大的数也不抛异常，取整前的精确值照样给出", () => {
  const limit = PRICE_LIMITS.maxSettlementMinor;
  assert.equal(applyAdjustRules(exactFromMinor(1_000_000_000), [{ steps: [percent(100_000), percent(100_000), percent(100_000)] }], 1).finalMinor, null, "10 亿 × 11³ = 1.331 万亿");
  assert.equal(applyAdjustRules(exactFromMinor(limit), [], 1).finalMinor, limit);
  assert.equal(applyAdjustRules(exactFromMinor(limit - 1), [{ steps: [{ type: "amount", value: 1 }] }], 1).finalMinor, limit);
  const over = applyAdjustRules(exactFromMinor(limit), [{ steps: [{ type: "amount", value: 1 }] }], 1);
  assert.deepEqual([over.finalMinor, over.baseMinor, over.adjustMinor, exceedsSettlementLimit(over.unrounded)], [null, null, null, true]);
  // 20 步 +1000%：20000 × 11^20，远超安全整数
  const steps = Array.from({ length: 10 }, () => percent(100_000));
  const huge = applyAdjustRules(exactFromMinor(20_000), [{ steps }, { steps }], 1_000);
  assert.deepEqual([huge.finalMinor, huge.unrounded.numerator, huge.unrounded.denominator], [null, 20_000n * 11n ** 20n, 1n]);
  // 中间超过上限、最后调回来的照常报（中间值不设上限）
  const back = applyAdjustRules(exactFromMinor(20_000), [{ steps }, { steps: Array.from({ length: 10 }, () => percent(-9_000)) }], 1);
  assert.equal(back.finalMinor, 51_875, "20000 × 11^10 ÷ 10^10 = 51874.849…");
  // 一次用车：原因是 OVER_LIMIT，不是 NOT_POSITIVE
  const quoted = tripPrice({ priceRules: [price(20_000)], adjustRules: [adjust(steps), adjust(steps)], query: { areaId: "a1", vehicleGroupId: "g1", direction: null, packageHours: null, date: "2026-10-09" }, minuteOfDay: 0, roundingUnit: 1 });
  assert.deepEqual([quoted.noPriceReason, quoted.price?.finalMinor], ["OVER_LIMIT", null]);
  // 基础价自己就超过上限（里程单价 × 很长的里程）也一样
  const far = tripPrice({ priceRules: [price(0, { pricing: { model: "mileage_time", startPriceMinor: 1, startMeters: 0, startMinutes: 0, perKmMinor: 1_000_000_000, perMinuteMinor: 0, minPriceMinor: null } })], adjustRules: [], query: { areaId: "a1", vehicleGroupId: "g1", direction: null, packageHours: null, date: "2026-10-09" }, minuteOfDay: 0, usage: { meters: 2_000_000 }, roundingUnit: 1 });
  assert.equal(far.noPriceReason, "OVER_LIMIT");
});

test("单条调价规则：调过上限的价格、取整之后不大于 0 的价格；光取整就是 0 的价格不算在调价规则头上", () => {
  const prices = [price(20_000), price(400), price(1_000_000_000, { areaId: "a2" })];
  assert.deepEqual(adjustRuleOverLimitPrices(adjust(Array.from({ length: 3 }, () => percent(100_000))), prices), [2]);
  assert.deepEqual(adjustRuleOverLimitPrices(adjust(Array.from({ length: 10 }, () => percent(100_000))), prices), [0, 1, 2]);
  assert.deepEqual(adjustRuleOverLimitPrices(adjust(Array.from({ length: 10 }, () => percent(100_000)), { areaIds: ["a1"] }), prices), [0, 1]);
  // −60%：20000 → 8000、400 → 160。取整单位 1000 时 160 → 0，但 400 本来就取整成 0，不算；取整单位 100 时 160 → 200，都没问题
  const sixty = adjust([percent(-6_000)]);
  assert.deepEqual(adjustRuleNonPositivePrices(sixty, prices), [], "不给取整单位：只看精确值");
  assert.deepEqual(adjustRuleNonPositivePrices(sixty, prices, 100), []);
  assert.deepEqual(adjustRuleNonPositivePrices(sixty, prices, 1_000), []);
  assert.deepEqual(adjustRuleNonPositivePrices(sixty, [price(1_000)], 1_000), [0], "1000 → 400 → 取整到 1000 是 0");
  assert.deepEqual(adjustRuleNonPositivePrices(adjust(Array.from({ length: 10 }, () => percent(100_000))), prices, 1), [], "超过上限的不算「不大于 0」");
});

test("可以卖的价格：启用、未过期，而且区域和车型组都是现在选着的", () => {
  const rules = [price(1), price(2, { areaId: "gone" }), price(3, { vehicleGroupId: "gone" }), price(4, { status: "disabled" }), price(5, { validTo: "2026-10-06" }), price(6, { validTo: "2026-10-07" }), price(7, { validFrom: "2027-01-01" })];
  const selected = { areaIds: ["a1", "a2"], vehicleGroupIds: ["g1"] };
  assert.deepEqual(sellablePriceRules(rules, selected, "2026-10-07").map((rule) => (rule.pricing as { basePriceMinor: number }).basePriceMinor), [1, 6, 7]);
  assert.deepEqual(sellablePriceRules(rules, { areaIds: [], vehicleGroupIds: ["g1"] }, "2026-10-07"), []);
});

test("调价规则叠加：每条单独都没问题、同时生效时叠加取整后不大于 0 的，指出是哪几条、最早哪一刻、今后有几天；错开了就没有问题", () => {
  const prices = [price(1_000), price(50_000, { areaId: "a2" })];
  const always = adjust([percent(-3_000)], { name: "常年" });
  const weekend = adjust([percent(-3_000)], { name: "周末晚上", cycle: { type: "weekly", weekdays: [6, 7] }, timeSlot: { start: "18:00", end: "24:00" } });
  const input = { priceRules: prices, roundingUnit: 1_000, from: "2026-10-07" };
  // 2026-10-07 是周三；最早的一次是 10-10（周六）18:00；只有 1000 的那条价格受影响（700 → 1000，490 → 0）
  assert.deepEqual(adjustStackProblems({ ...input, adjustRules: [always, weekend] }), [{ ruleIndexes: [0, 1], kind: "NOT_POSITIVE", priceIndexes: [0], date: "2026-10-10", minuteOfDay: 1_080, dayCount: 104 }]);
  assert.deepEqual(adjustStackProblems({ ...input, adjustRules: [always, weekend], days: 3 }), [], "只看到周五：还没到周末");
  assert.deepEqual(adjustStackProblems({ ...input, adjustRules: [always, { ...weekend, status: "disabled" }] }), []);
  assert.deepEqual(adjustStackProblems({ ...input, adjustRules: [always, { ...weekend, areaIds: ["a2"] }] }), [], "适用范围错开了");
  assert.deepEqual(adjustStackProblems({ ...input, adjustRules: [{ ...always, travelTo: "2026-10-09" }, weekend] }), [], "日期错开了");
  assert.deepEqual(adjustStackProblems({ ...input, roundingUnit: 1, adjustRules: [always, weekend] }), [], "取整单位是 1 时 490 报得出");
  assert.deepEqual(adjustStackProblems({ ...input, adjustRules: [always, weekend], skipRuleIndexes: [1] }), [], "单独就有问题的规则另有提示，不重复报");
  // 跨午夜的时段算在开始那天：周五 22:00–06:00 的规则在周六凌晨还生效
  const fridayNight = adjust([percent(-3_000)], { cycle: { type: "weekly", weekdays: [5] }, timeSlot: { start: "22:00", end: "06:00" } });
  const saturdayMorning = adjust([percent(-3_000)], { cycle: { type: "weekly", weekdays: [6] }, timeSlot: { start: "00:00", end: "03:00" } });
  assert.deepEqual(adjustStackProblems({ ...input, adjustRules: [fridayNight, saturdayMorning] }).map((problem) => [problem.date, problem.minuteOfDay, problem.dayCount]), [["2026-10-10", 0, 52]]);
  // 节假日：只有登记了节假日的那几天
  const holiday = adjust([percent(-3_000)], { cycle: { type: "holidays", countries: ["JP"] } });
  const holidays = holidayLookup([{ countryCode: "JP", date: "2026-11-03" }, { countryCode: "JP", date: "2026-11-23" }, { countryCode: "KR", date: "2026-10-09" }]);
  assert.deepEqual(adjustStackProblems({ ...input, adjustRules: [always, holiday], holidays }).map((problem) => [problem.date, problem.dayCount]), [["2026-11-03", 2]]);
  assert.deepEqual(adjustStackProblems({ ...input, adjustRules: [always, holiday] }), [], "没有节假日数据就不生效");
  // 接送通用的价格两个方向都看：只调接机的两条叠加
  const both = [price(1_000, { direction: "both" })];
  const pickupOnly = (name: string): AdjustRule => adjust([percent(-3_000)], { name, directions: ["pickup"] });
  assert.deepEqual(adjustStackProblems({ priceRules: both, roundingUnit: 1_000, from: "2026-10-07", adjustRules: [pickupOnly("甲"), pickupOnly("乙"), adjust([percent(-3_000)], { directions: ["dropoff"] })] }).map((problem) => problem.ruleIndexes), [[0, 1]]);
});

test("调价规则叠加：调过结算价上限的（一条或几条）单独一类；没有启用的规则、没有价格时什么都不做", () => {
  const seven = Array.from({ length: 7 }, () => percent(100_000));
  const rules = [adjust(seven, { name: "甲" }), adjust(seven, { name: "乙", travelFrom: "2026-12-01" })];
  const found = adjustStackProblems({ priceRules: [price(20_000), price(60_000, { areaId: "a2" })], adjustRules: rules, roundingUnit: 1, from: "2026-10-07" });
  // 60000 × 11^7 ≈ 1.17e12：单独一条就超；20000 的要两条叠加才超
  assert.deepEqual(found.map((problem) => [problem.kind, problem.ruleIndexes, problem.priceIndexes, problem.date]), [["OVER_LIMIT", [0], [1], "2026-10-07"], ["OVER_LIMIT", [0, 1], [0, 1], "2026-12-01"]]);
  assert.deepEqual(adjustStackProblems({ priceRules: [], adjustRules: rules, roundingUnit: 1, from: "2026-10-07" }), []);
  assert.deepEqual(adjustStackProblems({ priceRules: [price(1)], adjustRules: rules.map((rule) => ({ ...rule, status: "disabled" as const })), roundingUnit: 1, from: "2026-10-07" }), []);
});

test("money.ts：基点和取整单位的计算全程整数，10 亿以内和原来一样，大数也对；结果放不进安全整数时报错而不是给错数", () => {
  assert.deepEqual([applyBasisPoints(98_000, 1_000), applyBasisPoints(333, 150), applyBasisPoints(-333, 150), applyBasisPoints(1_000_000_000, 100_000)], [107_800, 338, -338, 11_000_000_000]);
  assert.deepEqual([portionBasisPoints(98_000, 3_000), portionBasisPoints(1, 5_000), portionBasisPoints(-1, 5_000), portionBasisPoints(3, 3_333)], [29_400, 1, -1, 1]);
  assert.deepEqual([roundToUnit(107_849, 100), roundToUnit(107_850, 100), roundToUnit(-50, 100), roundToUnit(49, 100), roundToUnit(0, 1_000)], [107_800, 107_900, -100, 0, 0]);
  // 浮点数的写法在这里会错：9007199254740991 × 1.0001 的个位
  assert.equal(applyBasisPoints(900_719_925_474_099, 1), 900_809_997_466_646, "900719925474099 × 1.0001 = 900809997466646.4099");
  assert.equal(roundToUnit(9_007_199_254_740_849, 100), 9_007_199_254_740_800);
  assert.throws(() => roundToUnit(9_007_199_254_740_951, 100), RangeError, "取整后超过安全整数");
  assert.throws(() => applyBasisPoints(9_007_199_254_740_991, 100_000), RangeError);
});

test("money.ts：浮点数的四舍五入只在绝对值不超过 10^15 时用，超出抛 RangeError；汇率换算跟着有这个范围", () => {
  assert.deepEqual([roundHalfAwayFromZero(2.5), roundHalfAwayFromZero(-2.5), roundHalfAwayFromZero(1.005 * 100), roundHalfAwayFromZero(FLOAT_ROUNDING_LIMIT), roundHalfAwayFromZero(-FLOAT_ROUNDING_LIMIT)], [3, -3, 101, FLOAT_ROUNDING_LIMIT, -FLOAT_ROUNDING_LIMIT]);
  for (const bad of [FLOAT_ROUNDING_LIMIT + 2, -FLOAT_ROUNDING_LIMIT - 2, Number.NaN, Number.POSITIVE_INFINITY]) assert.throws(() => roundHalfAwayFromZero(bad), RangeError, String(bad));
  const snapshot = { from: "USD" as const, to: "JPY" as const, rate: 150, bufferBasisPoints: 0, asOf: "2026-10-07" };
  assert.equal(convertMinor(1_000_000_000, snapshot), 1_500_000_000);
  assert.throws(() => convertMinor(9_000_000_000_000_000, snapshot), RangeError);
});
