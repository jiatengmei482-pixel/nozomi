/**
 * M1-04：价格规则与调价规则的计算。和需求文档「4. 价格规则与调价规则」「报价引擎」的公式、调价、取整逐项对应。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { roundFractionHalfAwayFromZero, roundFractionToUnit, roundToUnit } from "./money.ts";
import {
  type AdjustRule,
  type AdjustStep,
  type ExactAmount,
  NO_HOLIDAYS,
  PRICE_LIMITS,
  PRICING_MODELS,
  PRICING_MODEL_NAMES,
  type PriceRule,
  type Pricing,
  addDays,
  adjustRuleCoversPrice,
  adjustRuleHasEnded,
  adjustRuleIsUnusual,
  adjustRuleIssues,
  adjustRuleMatches,
  adjustRuleNonPositivePrices,
  applyAdjustRules,
  applyAdjustSteps,
  basePrice,
  calendarDay,
  compareExact,
  dateRangesOverlap,
  exactFromMinor,
  findPriceRuleOverlaps,
  formatExact,
  formatExactMajor,
  holidayLookup,
  priceCoverage,
  priceDirectionNames,
  priceRuleIsActive,
  priceRuleIssues,
  pricingModelsFor,
  roundingUnitOptions,
  selectPriceRule,
  timeSlotDate,
  tripPrice,
  weekdayOf,
} from "./pricing.ts";
import { instantToLocal, localDateTimeToInstant } from "./service-time.ts";

const FIXED: Pricing = { model: "fixed", basePriceMinor: 20_000 };
const MILEAGE: Pricing = { model: "mileage_time", startPriceMinor: 3_000, startMeters: 5_000, startMinutes: 20, perKmMinor: 400, perMinuteMinor: 80, minPriceMinor: 4_500 };
const CHARTER: Pricing = { model: "charter_package", packageKm: 300, packagePriceMinor: 98_000, overtimePerHourMinor: 5_000, overKmPerKmMinor: 400 };

const price = (extra: Partial<PriceRule> = {}): PriceRule => ({ areaId: "a1", vehicleGroupId: "v1", direction: "pickup", packageHours: null, pricing: FIXED, validFrom: "2026-10-01", validTo: null, status: "enabled", ...extra });
const adjust = (extra: Partial<AdjustRule> = {}): AdjustRule => ({
  name: "旺季",
  travelFrom: null,
  travelTo: null,
  cycle: { type: "daily" },
  timeSlot: null,
  areaIds: [],
  vehicleGroupIds: [],
  directions: [],
  packageHours: [],
  steps: [{ type: "percent", value: 2_000 }],
  status: "enabled",
  ...extra,
});
const show = (amount: ExactAmount): string => formatExact(amount);
const reasons = (issues: { path: string; reason: string }[]): string[] => issues.map((issue) => `${issue.path} ${issue.reason}`);
const moment = (date: string, time: string, extra: Record<string, unknown> = {}) => {
  const [hour, minute] = time.split(":").map(Number) as [number, number];
  return { date, minuteOfDay: hour * 60 + minute, areaId: "a1", vehicleGroupId: "v1", direction: "pickup" as const, packageHours: null, ...extra };
};

test("枚举：三种计价方式都有中文名；接送机和点对点用一口价、里程 + 时长，包车只有套餐（需求文档的表）", () => {
  assert.deepEqual([...PRICING_MODELS], ["fixed", "mileage_time", "charter_package"]);
  assert.deepEqual(PRICING_MODELS.map((model) => PRICING_MODEL_NAMES[model]), ["固定一口价", "里程 + 时长", "包车套餐"]);
  assert.deepEqual(pricingModelsFor("airport_transfer"), ["fixed", "mileage_time"]);
  assert.deepEqual(pricingModelsFor("point_to_point"), ["fixed", "mileage_time"]);
  assert.deepEqual(pricingModelsFor("charter"), ["charter_package"]);
  assert.equal(PRICE_LIMITS.maxBatchChanges, 500, "需求文档：一次最多 500 条");
  assert.deepEqual(roundingUnitOptions("JPY"), [1, 10, 100, 1_000]);
  assert.deepEqual(roundingUnitOptions("USD"), [1, 10, 100, 1_000, 10_000]);
});

test("精确取整（money.ts）：分数四舍五入，正好一半远离零；按取整单位只取整一次", () => {
  const round = (n: number, d: number): number => Number(roundFractionHalfAwayFromZero(BigInt(n), BigInt(d)));
  assert.deepEqual([round(1, 2), round(-1, 2), round(3, 2), round(149, 100), round(150, 100), round(-150, 100), round(0, 7), round(7, -2)], [1, -1, 2, 1, 2, -2, 0, -4]);
  assert.throws(() => roundFractionHalfAwayFromZero(1n, 0n), RangeError);
  assert.equal(roundFractionToUnit(23_150n, 1n, 100), 23_200);
  assert.equal(roundFractionToUnit(23_149n, 1n, 100), 23_100);
  assert.equal(roundFractionToUnit(231_499n, 10n, 100), 23_100, "23149.9 取整到 100：只取整一次，不是先到 23150 再到 23200");
  assert.equal(roundFractionToUnit(1n, 3n, 1), 0);
  assert.equal(roundFractionToUnit(-23_150n, 1n, 100), -23_200);
  assert.throws(() => roundFractionToUnit(1n, 1n, 0), RangeError);
  // 和已有的整数版本结论一致
  for (const minor of [0, 49, 50, 51, 149, 150, 12_345, -50, -49]) assert.equal(roundFractionToUnit(BigInt(minor), 1n, 100), roundToUnit(minor, 100) + 0, String(minor));
});

test("精确金额写成字符串：写得尽的原样，写不尽的保留 6 位小数", () => {
  assert.equal(show(exactFromMinor(20_000)), "20000");
  assert.equal(show({ numerator: 46_299n, denominator: 2n }), "23149.5");
  assert.equal(show({ numerator: -1n, denominator: 4n }), "-0.25");
  assert.equal(show({ numerator: 1n, denominator: 3n }), "0.333333");
  assert.equal(show({ numerator: 2n, denominator: 3n }), "0.666667");
  assert.equal(show({ numerator: 5_000n, denominator: 60n }), "83.333333");
  assert.equal(show({ numerator: 1n, denominator: 8n }), "0.125");
  assert.equal(show(exactFromMinor(0)), "0");
  assert.throws(() => exactFromMinor(1.5), RangeError);
});

test("精确金额换成主单位的写法：按币种的小数位挪小数点，不经过浮点数；日元、韩元和最小货币单位的写法一样", () => {
  const amount = (numerator: bigint, denominator = 1n): ExactAmount => ({ numerator, denominator });
  assert.equal(formatExactMajor(amount(4_600_505n, 10n), "CNY"), "4600.505", "460050.5 分");
  assert.equal(formatExactMajor(amount(460_050n), "CNY"), "4600.5");
  assert.equal(formatExactMajor(amount(460_000n), "CNY"), "4600");
  assert.equal(formatExactMajor(amount(5n), "USD"), "0.05");
  assert.equal(formatExactMajor(amount(-1n, 2n), "USD"), "-0.005");
  assert.equal(formatExactMajor(amount(0n), "USD"), "0");
  assert.equal(formatExactMajor(amount(1n, 3n), "USD"), "0.00333333", "写不尽的保留到最小货币单位之后 6 位");
  assert.equal(formatExactMajor(amount(2_315_775n, 100n), "JPY"), "23157.75");
  assert.equal(formatExactMajor(amount(23_158n), "KRW"), "23158");
  for (const value of [amount(46_299n, 2n), amount(1n, 3n), amount(-7n, 4n)]) assert.equal(formatExactMajor(value, "JPY"), formatExact(value));
  // 很大的数也不丢精度
  assert.equal(formatExactMajor(amount(9_007_199_254_740_993n, 10n), "USD"), "9007199254740.993");
});

test("方向的中文名按接送点类型取：机场是接机 / 送机，车站（和车站的出口）是接站 / 送站", () => {
  assert.deepEqual(priceDirectionNames("airport"), { pickup: "接机", dropoff: "送机", both: "接送通用" });
  assert.deepEqual(priceDirectionNames("terminal"), { pickup: "接机", dropoff: "送机", both: "接送通用" });
  assert.deepEqual(priceDirectionNames("station"), { pickup: "接站", dropoff: "送站", both: "接送通用" });
  assert.deepEqual(priceDirectionNames("exit"), { pickup: "接站", dropoff: "送站", both: "接送通用" });
  assert.deepEqual(priceDirectionNames(null), { pickup: "接机", dropoff: "送机", both: "接送通用" });
});

test("基础价 · 固定一口价：P = 基础价（和里程、时长无关）", () => {
  assert.equal(show(basePrice(FIXED)), "20000");
  assert.equal(show(basePrice(FIXED, { meters: 80_000, minutes: 300 })), "20000");
});

test("基础价 · 里程 + 时长：P = max(P_min, P_start + max(0, D − D_start) × p_km + max(0, T − T_start) × p_min)", () => {
  // 起步以内：3000，被最低消费抬到 4500
  assert.equal(show(basePrice(MILEAGE, { meters: 5_000, minutes: 20 })), "4500");
  assert.equal(show(basePrice(MILEAGE, { meters: 0, minutes: 0 })), "4500");
  assert.equal(show(basePrice(MILEAGE)), "4500", "没给用量按不超出算");
  // 超出 10 公里、25 分钟：3000 + 10 × 400 + 25 × 80 = 9000
  assert.equal(show(basePrice(MILEAGE, { meters: 15_000, minutes: 45 })), "9000");
  // 只超里程 / 只超时长
  assert.equal(show(basePrice(MILEAGE, { meters: 12_000, minutes: 5 })), "5800");
  assert.equal(show(basePrice(MILEAGE, { meters: 1_000, minutes: 50 })), "5400");
  // 里程不取整：超出 2.345 公里收 938 整
  assert.equal(show(basePrice(MILEAGE, { meters: 7_345, minutes: 20 })), "4500");
  assert.equal(show(basePrice({ ...MILEAGE, minPriceMinor: null }, { meters: 7_345, minutes: 20 })), "3938");
  assert.equal(show(basePrice({ ...MILEAGE, minPriceMinor: null, perKmMinor: 333 }, { meters: 5_001, minutes: 0 })), "3000.333");
  // 正好等于最低消费、刚好超过
  assert.equal(show(basePrice(MILEAGE, { meters: 8_750, minutes: 20 })), "4500");
  assert.equal(show(basePrice(MILEAGE, { meters: 8_751, minutes: 20 })), "4500.4");
  // 不设最低消费
  assert.equal(show(basePrice({ ...MILEAGE, minPriceMinor: null })), "3000");
});

test("基础价 · 包车套餐：P = P_pkg + max(0, H − H_pkg) × p_hour + max(0, D − D_pkg) × p_km；报价时 H = 套餐时长", () => {
  assert.equal(show(basePrice(CHARTER, {}, 10)), "98000", "报价：不超时、不超公里");
  assert.equal(show(basePrice(CHARTER, { minutes: 600, meters: 300_000 }, 10)), "98000", "正好用完");
  assert.equal(show(basePrice(CHARTER, { minutes: 720, meters: 300_000 }, 10)), "108000", "超 2 小时");
  assert.equal(show(basePrice(CHARTER, { minutes: 600, meters: 350_000 }, 10)), "118000", "超 50 公里");
  assert.equal(show(basePrice(CHARTER, { minutes: 690, meters: 312_500 }, 10)), "110500", "超 1.5 小时 + 12.5 公里：7500 + 5000");
  assert.equal(show(basePrice(CHARTER, { minutes: 601 }, 10)), "98083.333333", "超时按分钟折算，不凑整小时；中间结果保留精确值");
  assert.equal(show(basePrice(CHARTER, { minutes: 300 }, 5)), "98000", "套餐时长来自价格规则的组合");
});

test("价格规则的校验：方向只给接送机、套餐时长只给包车、计价方式要和品类对上、金额是范围内的整数、日期合法且不倒置", () => {
  assert.deepEqual(priceRuleIssues(price(), { category: "airport_transfer" }), []);
  assert.deepEqual(priceRuleIssues(price({ pricing: MILEAGE, direction: "both" }), { category: "airport_transfer" }), []);
  assert.deepEqual(priceRuleIssues(price({ direction: null }), { category: "point_to_point" }), []);
  assert.deepEqual(priceRuleIssues(price({ direction: null, packageHours: 10, pricing: CHARTER }), { category: "charter" }), []);
  assert.deepEqual(reasons(priceRuleIssues(price({ direction: null }), { category: "airport_transfer" })), ["/direction REQUIRED"]);
  assert.deepEqual(reasons(priceRuleIssues(price(), { category: "point_to_point" })), ["/direction NOT_APPLICABLE"]);
  assert.deepEqual(reasons(priceRuleIssues(price({ packageHours: 5 }), { category: "airport_transfer" })), ["/package_hours NOT_APPLICABLE"]);
  assert.deepEqual(reasons(priceRuleIssues(price({ direction: null, pricing: CHARTER }), { category: "charter" })), ["/package_hours REQUIRED"]);
  assert.deepEqual(reasons(priceRuleIssues(price({ direction: null, packageHours: 73, pricing: CHARTER }), { category: "charter" })), ["/package_hours OUT_OF_RANGE"]);
  assert.deepEqual(reasons(priceRuleIssues(price({ direction: null, packageHours: 4.5, pricing: CHARTER }), { category: "charter" })), ["/package_hours NOT_INTEGER"]);
  assert.deepEqual(reasons(priceRuleIssues(price({ pricing: CHARTER }), { category: "airport_transfer" })), ["/pricing_model MODEL_NOT_ALLOWED"]);
  assert.deepEqual(reasons(priceRuleIssues(price({ direction: null, packageHours: 10 }), { category: "charter" })), ["/pricing_model MODEL_NOT_ALLOWED"]);
  assert.deepEqual(reasons(priceRuleIssues(price({ pricing: { model: "fixed", basePriceMinor: 0 } }), { category: "airport_transfer" })), ["/base_price OUT_OF_RANGE"]);
  assert.deepEqual(reasons(priceRuleIssues(price({ pricing: { model: "fixed", basePriceMinor: 99.5 } }), { category: "airport_transfer" })), ["/base_price NOT_INTEGER"]);
  assert.deepEqual(reasons(priceRuleIssues(price({ pricing: { model: "fixed", basePriceMinor: 1_000_000_001 } }), { category: "airport_transfer" })), ["/base_price OUT_OF_RANGE"]);
  assert.deepEqual(
    reasons(priceRuleIssues(price({ pricing: { model: "mileage_time", startPriceMinor: -1, startMeters: 5_050, startMinutes: 1_441, perKmMinor: 0.5, perMinuteMinor: -3, minPriceMinor: 0 } }), { category: "point_to_point" })).sort(),
    ["/direction NOT_APPLICABLE", "/min_price OUT_OF_RANGE", "/per_km NOT_INTEGER", "/per_minute OUT_OF_RANGE", "/start_meters OUT_OF_RANGE", "/start_minutes OUT_OF_RANGE", "/start_price OUT_OF_RANGE"],
  );
  assert.deepEqual(reasons(priceRuleIssues(price({ pricing: { ...MILEAGE, startPriceMinor: 0, minPriceMinor: null } }), { category: "airport_transfer" })), ["/start_price OUT_OF_RANGE"], "起步价是 0 又没有最低消费：零里程会算出 0");
  assert.deepEqual(priceRuleIssues(price({ pricing: { ...MILEAGE, startPriceMinor: 0 } }), { category: "airport_transfer" }), []);
  assert.deepEqual(
    reasons(priceRuleIssues(price({ direction: null, packageHours: 10, pricing: { model: "charter_package", packageKm: 0, packagePriceMinor: 0, overtimePerHourMinor: -1, overKmPerKmMinor: 1.5 } }), { category: "charter" })),
    ["/package_km OUT_OF_RANGE", "/package_price OUT_OF_RANGE", "/overtime_per_hour OUT_OF_RANGE", "/over_km_per_km NOT_INTEGER"],
  );
  assert.deepEqual(reasons(priceRuleIssues(price({ validFrom: "2026-02-30" }), { category: "airport_transfer" })), ["/valid_from INVALID_DATE"]);
  assert.deepEqual(reasons(priceRuleIssues(price({ validTo: "2026/12/31" }), { category: "airport_transfer" })), ["/valid_to INVALID_DATE"]);
  assert.deepEqual(reasons(priceRuleIssues(price({ validFrom: "2026-10-02", validTo: "2026-10-01" }), { category: "airport_transfer" })), ["/valid_to DATE_RANGE_REVERSED"]);
  assert.deepEqual(priceRuleIssues(price({ validFrom: "2026-10-01", validTo: "2026-10-01" }), { category: "airport_transfer" }), [], "只卖一天");
});

test("唯一性：同一个「区域 + 车型组 + 方向或套餐时长」的生效日期不能重叠；两端都含；一直有效的和它之后的都重叠；停用的也算", () => {
  const range = (validFrom: string, validTo: string | null) => ({ validFrom, validTo });
  assert.equal(dateRangesOverlap(range("2026-10-01", "2027-03-31"), range("2027-03-31", "2027-06-30")), true, "到 03-31 和从 03-31 是重叠的");
  assert.equal(dateRangesOverlap(range("2026-10-01", "2027-03-31"), range("2027-04-01", null)), false);
  assert.equal(dateRangesOverlap(range("2026-10-01", null), range("2030-01-01", "2030-01-02")), true);
  assert.equal(dateRangesOverlap(range("2026-10-01", null), range("2026-01-01", "2026-09-30")), false);
  assert.equal(dateRangesOverlap(range("2026-10-01", null), range("2027-01-01", null)), true);
  assert.equal(dateRangesOverlap(range("2026-10-10", "2026-10-10"), range("2026-10-10", "2026-10-10")), true);

  const rules = [
    price({ validFrom: "2026-10-01", validTo: "2026-12-31" }), // 0
    price({ validFrom: "2026-12-31", validTo: null, status: "disabled" }), // 1：和 0 撞在 12-31，停用也算
    price({ validFrom: "2027-01-01", validTo: null, pricing: MILEAGE }), // 2：和 1 重叠；计价方式不同也算同一个组合
    price({ direction: "both" }), // 3：接送通用和接机不是同一个组合
    price({ direction: "dropoff" }), // 4
    price({ areaId: "a2" }), // 5
    price({ vehicleGroupId: "v2" }), // 6
    price({ direction: "both", validFrom: "2028-01-01" }), // 7：和 3 重叠
  ];
  assert.deepEqual(findPriceRuleOverlaps(rules), [[0, 1], [1, 2], [3, 7]]);
  // 包车：套餐时长在组合里，同一车型可以同时卖 5 小时和 10 小时
  const charter = (packageHours: number, validFrom = "2026-10-01") => price({ direction: null, packageHours, pricing: CHARTER, validFrom });
  assert.deepEqual(findPriceRuleOverlaps([charter(5), charter(10), charter(5, "2027-01-01")]), [[0, 2]]);
  assert.deepEqual(findPriceRuleOverlaps([]), []);
});

test("命中价格规则：启用、用车日期在生效期内（两端都含）；「接送通用」和具体方向同时有时，以更具体的为准", () => {
  const pickup = price({ pricing: { model: "fixed", basePriceMinor: 22_000 } });
  const both = price({ direction: "both" });
  const query = { areaId: "a1", vehicleGroupId: "v1", direction: "pickup" as const, packageHours: null, date: "2026-10-08" };
  assert.equal(selectPriceRule([both, pickup], query), pickup);
  assert.equal(selectPriceRule([both, pickup], { ...query, direction: "dropoff" }), both, "送机的仍用接送通用");
  assert.equal(selectPriceRule([both, { ...pickup, status: "disabled" }], query), both, "接机那条停用了就退回接送通用");
  assert.equal(selectPriceRule([both, { ...pickup, validFrom: "2026-11-01" }], query), both, "接机那条还没开始生效");
  assert.equal(selectPriceRule([pickup], { ...query, direction: "dropoff" }), null);
  assert.equal(selectPriceRule([pickup], { ...query, date: "2026-09-30" }), null);
  assert.equal(selectPriceRule([pickup], { ...query, date: "2026-10-01" }), pickup);
  assert.equal(selectPriceRule([{ ...pickup, validTo: "2026-10-08" }], query)?.validTo, "2026-10-08");
  assert.equal(selectPriceRule([{ ...pickup, validTo: "2026-10-07" }], query), null);
  assert.equal(selectPriceRule([pickup], { ...query, areaId: "a2" }), null);
  assert.equal(selectPriceRule([pickup], { ...query, vehicleGroupId: "v2" }), null);
  // 点对点没有方向；包车按套餐时长
  const p2p = price({ direction: null });
  assert.equal(selectPriceRule([p2p], { ...query, direction: null }), p2p);
  const five = price({ direction: null, packageHours: 5, pricing: CHARTER });
  const ten = price({ direction: null, packageHours: 10, pricing: CHARTER });
  assert.equal(selectPriceRule([five, ten], { ...query, direction: null, packageHours: 10 }), ten);
  assert.equal(selectPriceRule([five, ten], { ...query, direction: null, packageHours: 8 }), null);
  assert.equal(priceRuleIsActive({ status: "enabled", validTo: "2026-10-08" }, "2026-10-08"), true);
  assert.equal(priceRuleIsActive({ status: "enabled", validTo: "2026-10-07" }, "2026-10-08"), false);
  assert.equal(priceRuleIsActive({ status: "disabled", validTo: null }, "2026-10-08"), false);
});

test("调价 · 链式执行：后一步以前一步的结果为基数；百分比和金额可以混着来、可以为负", () => {
  const run = (base: number, steps: AdjustStep[]): string[] => applyAdjustSteps(exactFromMinor(base), steps).steps.map((step) => `${show(step.delta)} → ${show(step.after)}`);
  assert.deepEqual(run(20_000, [{ type: "percent", value: 2_000 }]), ["4000 → 24000"]);
  assert.deepEqual(run(20_000, [{ type: "amount", value: 1_500 }]), ["1500 → 21500"]);
  assert.deepEqual(run(20_000, [{ type: "percent", value: -1_000 }]), ["-2000 → 18000"]);
  assert.deepEqual(run(20_000, [{ type: "amount", value: -3_000 }]), ["-3000 → 17000"]);
  // +20% 再 +10%：是 1.2 × 1.1 = 1.32 倍，不是 1.3 倍
  assert.deepEqual(run(20_000, [{ type: "percent", value: 2_000 }, { type: "percent", value: 1_000 }]), ["4000 → 24000", "2400 → 26400"]);
  // 先加金额再乘百分比 ≠ 先乘再加
  assert.deepEqual(run(20_000, [{ type: "amount", value: 1_000 }, { type: "percent", value: 1_000 }]), ["1000 → 21000", "2100 → 23100"]);
  assert.deepEqual(run(20_000, [{ type: "percent", value: 1_000 }, { type: "amount", value: 1_000 }]), ["2000 → 22000", "1000 → 23000"]);
  // +20% 再 −20% 回不到原价
  assert.deepEqual(run(20_000, [{ type: "percent", value: 2_000 }, { type: "percent", value: -2_000 }]), ["4000 → 24000", "-4800 → 19200"]);
  // 中间结果不取整：19999 × 1.155 = 23098.845，再 × 1.1
  assert.deepEqual(run(19_999, [{ type: "percent", value: 1_550 }, { type: "percent", value: 1_000 }]), ["3099.845 → 23098.845", "2309.8845 → 25408.7295"]);
  assert.deepEqual(run(20_000, []), []);
  assert.equal(show(applyAdjustSteps(exactFromMinor(20_000), []).result), "20000");
});

test("调价 · 多条规则按优先级顺序链式执行：后一条以前一条的结果为基数，顺序不同结果不同", () => {
  const peak = { steps: [{ type: "percent", value: 2_000 }] as AdjustStep[] };
  const night = { steps: [{ type: "amount", value: 3_000 }] as AdjustStep[] };
  const first = applyAdjustRules(exactFromMinor(20_000), [peak, night]);
  assert.equal(first.finalMinor, 27_000, "(20000 × 1.2) + 3000");
  assert.deepEqual(first.adjusts.map((entry) => [entry.rule, entry.steps.map((step) => show(step.after))]), [[peak, ["24000"]], [night, ["27000"]]]);
  const second = applyAdjustRules(exactFromMinor(20_000), [night, peak]);
  assert.equal(second.finalMinor, 27_600, "(20000 + 3000) × 1.2");
  assert.equal(applyAdjustRules(exactFromMinor(20_000), []).finalMinor, 20_000);
  // 一条规则里有几步、几条规则连着：全部按顺序
  const promo = { steps: [{ type: "percent", value: -500 }, { type: "amount", value: -200 }] as AdjustStep[] };
  assert.equal(applyAdjustRules(exactFromMinor(20_000), [peak, promo, night]).finalMinor, 25_600, "((20000 × 1.2) × 0.95 − 200) + 3000");
});

test("取整：只在最后取整一次，四舍五入（正好一半远离零）；按子品牌的取整单位；没有调价时也取整；明细之和等于总价、尾差计入调价", () => {
  const up = (bp: number) => [{ steps: [{ type: "percent", value: bp }] as AdjustStep[] }];
  // 20050 +15.5% = 23157.75 → 23158；取整到 100 → 23200
  const fine = applyAdjustRules(exactFromMinor(20_050), up(1_550), 1);
  assert.deepEqual([show(fine.unrounded), fine.finalMinor, fine.baseMinor, fine.adjustMinor], ["23157.75", 23_158, 20_050, 3_108]);
  assert.equal(applyAdjustRules(exactFromMinor(20_050), up(1_550), 100).finalMinor, 23_200);
  assert.equal(applyAdjustRules(exactFromMinor(20_050), up(1_550), 1_000).finalMinor, 23_000);
  // 正好一半：23150 → 23200；差一点：23149.99 → 23100
  assert.equal(applyAdjustRules(exactFromMinor(23_150), [], 100).finalMinor, 23_200);
  assert.equal(applyAdjustRules({ numerator: 2_314_999n, denominator: 100n }, [], 100).finalMinor, 23_100);
  assert.equal(applyAdjustRules({ numerator: 46_299n, denominator: 2n }, [], 1).finalMinor, 23_150, "23149.5 → 23150");
  // 每一步不取整：两步各 +0.5 的尾数，逐步取整会多出 1
  const twice = applyAdjustRules(exactFromMinor(1_001), [{ steps: [{ type: "percent", value: 50 }, { type: "percent", value: 50 }] as AdjustStep[] }], 1);
  assert.deepEqual([show(twice.unrounded), twice.finalMinor], ["1011.035025", 1_011]);
  // 没有调价规则命中时也取整：基础价 20050、取整单位 100 → 20100，差的 50 记在调价项
  const plain = applyAdjustRules(exactFromMinor(20_050), [], 100);
  assert.deepEqual([plain.finalMinor, plain.baseMinor, plain.adjustMinor], [20_100, 20_050, 50]);
  for (const result of [fine, plain, twice]) assert.equal((result.baseMinor as number) + (result.adjustMinor as number), result.finalMinor);
  // 基础价本身带小数（里程 + 时长）：明细里的基础价取整到最小货币单位，尾差仍计入调价
  const fractional = applyAdjustRules({ numerator: 30_003_330n, denominator: 10_000n }, up(1_000), 10);
  assert.deepEqual([show(fractional.unrounded), fractional.finalMinor, fractional.baseMinor, fractional.adjustMinor], ["3300.3663", 3_300, 3_000, 300]);
  // 两位小数的币种一样：金额是分
  assert.equal(applyAdjustRules(exactFromMinor(12_345), up(1_000), 100).finalMinor, 13_600, "123.45 × 1.1 = 135.795 → 取整到 1 元 = 136.00");
});

test("下限：调完不大于 0 的价格不能报（finalMinor 为 null）；负数调价只要结果还是正的就照常", () => {
  const down = (steps: AdjustStep[]) => applyAdjustRules(exactFromMinor(5_000), [{ steps }], 100);
  assert.equal(down([{ type: "amount", value: -4_000 }]).finalMinor, 1_000);
  assert.deepEqual([down([{ type: "amount", value: -5_000 }]).finalMinor, show(down([{ type: "amount", value: -5_000 }]).unrounded)], [null, "0"]);
  const negative = down([{ type: "amount", value: -6_000 }]);
  assert.deepEqual([negative.finalMinor, negative.baseMinor, negative.adjustMinor, show(negative.unrounded)], [null, null, null, "-1000"]);
  assert.equal(down([{ type: "percent", value: -9_999 }]).finalMinor, null, "剩 0.5，取整到 100 是 0：同样不能报");
  assert.equal(applyAdjustRules(exactFromMinor(5_000), [{ steps: [{ type: "percent", value: -9_900 }] as AdjustStep[] }], 100).finalMinor, 100, "剩 50，取整到 100 是 100");
  // 调价规则保存前的检查：单独作用在碰得到的价格上不大于 0 的有哪些
  const prices = [price({ pricing: { model: "fixed", basePriceMinor: 5_000 } }), price({ areaId: "a2", pricing: { model: "fixed", basePriceMinor: 8_000 } }), price({ direction: "dropoff", pricing: MILEAGE })];
  assert.deepEqual(adjustRuleNonPositivePrices(adjust({ steps: [{ type: "amount", value: -5_000 }] }), prices), [0, 2], "5000 − 5000 = 0；里程 + 时长按最低消费 4500 算");
  assert.deepEqual(adjustRuleNonPositivePrices(adjust({ steps: [{ type: "amount", value: -5_000 }], areaIds: ["a2"] }), prices), []);
  assert.deepEqual(adjustRuleNonPositivePrices(adjust({ steps: [{ type: "amount", value: -5_000 }], directions: ["dropoff"] }), prices), [2]);
  assert.deepEqual(adjustRuleNonPositivePrices(adjust({ steps: [{ type: "amount", value: -6_000 }, { type: "amount", value: 2_000 }] }), prices), [], "看的是最后的结果，中间一步为负不算");
});

test("调价规则的校验：名称、出行日期、周期、时段、适用范围、步骤", () => {
  const check = (extra: Partial<AdjustRule>, category: "airport_transfer" | "point_to_point" | "charter" = "airport_transfer"): string[] => reasons(adjustRuleIssues(adjust(extra), { category }));
  assert.deepEqual(check({}), []);
  assert.deepEqual(check({ travelFrom: "2027-10-01", travelTo: "2027-10-07", cycle: { type: "weekly", weekdays: [5, 6, 7] }, timeSlot: { start: "22:00", end: "06:00" }, areaIds: ["a1"], directions: ["pickup"], steps: [{ type: "percent", value: -1_000 }, { type: "amount", value: 500 }] }), []);
  assert.deepEqual(check({ name: "  " }), ["/name REQUIRED"]);
  assert.deepEqual(check({ name: "旺".repeat(51) }), ["/name TOO_LONG"]);
  assert.deepEqual(check({ travelFrom: "2027-13-01" }), ["/travel_from INVALID_DATE"]);
  assert.deepEqual(check({ travelFrom: "2027-10-07", travelTo: "2027-10-01" }), ["/travel_to DATE_RANGE_REVERSED"]);
  assert.deepEqual(check({ cycle: { type: "weekly", weekdays: [] } }), ["/cycle/weekdays REQUIRED"]);
  assert.deepEqual(check({ cycle: { type: "weekly", weekdays: [0, 8, 1.5, 3, 3] } }), ["/cycle/weekdays/0 OUT_OF_RANGE", "/cycle/weekdays/1 OUT_OF_RANGE", "/cycle/weekdays/2 NOT_INTEGER", "/cycle/weekdays/4 DUPLICATE"]);
  assert.deepEqual(check({ cycle: { type: "dates", dates: [] } }), ["/cycle/dates REQUIRED"]);
  assert.deepEqual(check({ cycle: { type: "dates", dates: ["2027-02-29", "2027-05-01", "2027-05-01"] } }), ["/cycle/dates/0 INVALID_DATE", "/cycle/dates/2 DUPLICATE"]);
  assert.deepEqual(check({ cycle: { type: "dates", dates: Array.from({ length: 367 }, (_, i) => addDays("2027-01-01", i)) } }), ["/cycle/dates TOO_MANY"]);
  assert.deepEqual(check({ cycle: { type: "holidays", countries: [] } }), ["/cycle/countries REQUIRED"]);
  assert.deepEqual(check({ cycle: { type: "holidays", countries: ["JP", "jp", "XX", "JP"] } }), ["/cycle/countries/1 INVALID_COUNTRY", "/cycle/countries/2 INVALID_COUNTRY", "/cycle/countries/3 DUPLICATE"]);
  assert.deepEqual(check({ timeSlot: { start: "9:00", end: "18:00" } }), ["/time_slot INVALID_TIME"]);
  assert.deepEqual(check({ timeSlot: { start: "24:00", end: "06:00" } }), ["/time_slot INVALID_TIME"]);
  assert.deepEqual(check({ timeSlot: { start: "08:00", end: "08:00" } }), ["/time_slot EMPTY_WINDOW"]);
  assert.deepEqual(check({ timeSlot: { start: "00:00", end: "24:00" } }), []);
  assert.deepEqual(check({ areaIds: ["a1", "a1"], vehicleGroupIds: ["v1", "v1"] }), ["/area_ids/1 DUPLICATE", "/vehicle_group_ids/1 DUPLICATE"]);
  assert.deepEqual(check({ directions: ["pickup", "pickup"] }), ["/directions/1 DUPLICATE"]);
  assert.deepEqual(check({ directions: ["pickup"] }, "point_to_point"), ["/directions NOT_APPLICABLE"]);
  assert.deepEqual(check({ packageHours: [10] }), ["/package_hours NOT_APPLICABLE"]);
  assert.deepEqual(check({ packageHours: [10, 5] }, "charter"), []);
  assert.deepEqual(check({ packageHours: [0, 10, 10] }, "charter"), ["/package_hours/0 OUT_OF_RANGE", "/package_hours/2 DUPLICATE"]);
  assert.deepEqual(check({ steps: [] }), ["/steps REQUIRED"]);
  assert.deepEqual(check({ steps: Array.from({ length: 11 }, () => ({ type: "amount" as const, value: 1 })) }), ["/steps TOO_MANY"]);
  assert.deepEqual(check({ steps: [{ type: "percent", value: 0 }, { type: "amount", value: 0 }] }), ["/steps/0/value ZERO_STEP", "/steps/1/value ZERO_STEP"]);
  assert.deepEqual(check({ steps: [{ type: "percent", value: -10_000 }, { type: "percent", value: 100_001 }, { type: "percent", value: 12.5 }, { type: "amount", value: 1_000_000_001 }, { type: "amount", value: 0.5 }] }), [
    "/steps/0/value OUT_OF_RANGE", "/steps/1/value OUT_OF_RANGE", "/steps/2/value NOT_INTEGER", "/steps/3/value OUT_OF_RANGE", "/steps/4/value NOT_INTEGER",
  ]);
  assert.deepEqual(check({ steps: [{ type: "percent", value: -9_999 }, { type: "percent", value: 100_000 }] }), []);
});

test("调价规则生不生效 · 适用范围：区域、车型组、方向、套餐（空 = 全部）；停用的不生效", () => {
  const at = moment("2026-10-09", "10:00");
  assert.equal(adjustRuleMatches(adjust(), at), true);
  assert.equal(adjustRuleMatches(adjust({ status: "disabled" }), at), false);
  assert.equal(adjustRuleMatches(adjust({ areaIds: ["a1", "a2"] }), at), true);
  assert.equal(adjustRuleMatches(adjust({ areaIds: ["a2"] }), at), false);
  assert.equal(adjustRuleMatches(adjust({ vehicleGroupIds: ["v2"] }), at), false);
  assert.equal(adjustRuleMatches(adjust({ directions: ["pickup"] }), at), true);
  assert.equal(adjustRuleMatches(adjust({ directions: ["dropoff"] }), at), false);
  assert.equal(adjustRuleMatches(adjust({ directions: ["dropoff"] }), { ...at, direction: null }), false);
  const charter = { ...at, direction: null, packageHours: 10 };
  assert.equal(adjustRuleMatches(adjust({ packageHours: [5, 10] }), charter), true);
  assert.equal(adjustRuleMatches(adjust({ packageHours: [5] }), charter), false);
  assert.equal(adjustRuleMatches(adjust({ packageHours: [5] }), at), false);
  // 碰不碰得到一条价格（不看日期）：接送通用的价格两个方向的调价都碰得到
  assert.equal(adjustRuleCoversPrice(adjust({ directions: ["dropoff"] }), price({ direction: "both" })), true);
  assert.equal(adjustRuleCoversPrice(adjust({ directions: ["dropoff"] }), price({ direction: "pickup" })), false);
  assert.equal(adjustRuleCoversPrice(adjust({ areaIds: ["a2"] }), price()), false);
  assert.equal(adjustRuleCoversPrice(adjust({ packageHours: [5] }), price({ direction: null, packageHours: 10 })), false);
});

test("调价规则生不生效 · 出行日期范围（两端都含）和周期：每天 / 每周指定星期 / 指定日期 / 节假日", () => {
  const on = (rule: AdjustRule, date: string, holidays = NO_HOLIDAYS): boolean => adjustRuleMatches(rule, moment(date, "10:00"), holidays);
  const season = adjust({ travelFrom: "2027-10-01", travelTo: "2027-10-07" });
  assert.deepEqual(["2027-09-30", "2027-10-01", "2027-10-04", "2027-10-07", "2027-10-08"].map((date) => on(season, date)), [false, true, true, true, false]);
  assert.equal(on(adjust({ travelFrom: "2027-10-01" }), "2030-01-01"), true);
  assert.equal(on(adjust({ travelTo: "2027-10-07" }), "2020-01-01"), true);
  // 每周：2026-10-09 是周五
  assert.deepEqual(["2026-10-05", "2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12"].map(weekdayOf), [1, 5, 6, 7, 1]);
  const weekend = adjust({ cycle: { type: "weekly", weekdays: [6, 7] } });
  assert.deepEqual(["2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12"].map((date) => on(weekend, date)), [false, true, true, false]);
  // 每周 + 日期范围：两个条件都要满足
  assert.equal(on(adjust({ cycle: { type: "weekly", weekdays: [6] }, travelFrom: "2026-10-11" }), "2026-10-10"), false);
  // 指定日期
  const days = adjust({ cycle: { type: "dates", dates: ["2026-12-24", "2026-12-31"] } });
  assert.deepEqual(["2026-12-24", "2026-12-25", "2026-12-31"].map((date) => on(days, date)), [true, false, true]);
  // 节假日：按国家查平台的节假日日历；没有数据就不生效
  const holidays = holidayLookup([{ countryCode: "JP", date: "2027-01-01" }, { countryCode: "CN", date: "2027-10-01" }]);
  const japan = adjust({ cycle: { type: "holidays", countries: ["JP"] } });
  assert.deepEqual([on(japan, "2027-01-01", holidays), on(japan, "2027-10-01", holidays), on(japan, "2027-01-02", holidays), on(japan, "2027-01-01")], [true, false, false, false]);
  assert.equal(on(adjust({ cycle: { type: "holidays", countries: ["JP", "CN"] } }), "2027-10-01", holidays), true, "任何一个国家放假都算");
  // 已经结束的
  assert.equal(adjustRuleHasEnded(season, "2027-10-07"), false);
  assert.equal(adjustRuleHasEnded(season, "2027-10-08"), true);
  assert.equal(adjustRuleHasEnded(days, "2026-12-31"), false);
  assert.equal(adjustRuleHasEnded(days, "2027-01-01"), true);
  assert.equal(adjustRuleHasEnded(adjust(), "2099-01-01"), false);
});

test("调价规则生不生效 · 时段：开始算在里面、结束不算；跨午夜的时段算在开始的那一天头上", () => {
  const day = { start: "08:00", end: "22:00" };
  const inSlot = (slot: { start: string; end: string } | null, time: string): string | null => timeSlotDate(slot, "2026-10-10", moment("2026-10-10", time).minuteOfDay);
  assert.deepEqual(["07:59", "08:00", "21:59", "22:00"].map((time) => inSlot(day, time)), [null, "2026-10-10", "2026-10-10", null]);
  assert.equal(inSlot(null, "03:00"), "2026-10-10");
  assert.deepEqual(["00:00", "23:59"].map((time) => inSlot({ start: "00:00", end: "24:00" }, time)), ["2026-10-10", "2026-10-10"]);
  // 22:00–06:00：晚上的归当天，凌晨的归前一天；06:00 整不算
  const night = { start: "22:00", end: "06:00" };
  assert.deepEqual(["21:59", "22:00", "23:59", "00:00", "05:59", "06:00", "12:00"].map((time) => inSlot(night, time)), [null, "2026-10-10", "2026-10-10", "2026-10-09", "2026-10-09", null, null]);
  assert.deepEqual(["21:59", "22:00", "00:00"].map((time) => inSlot({ start: "22:00", end: "00:00" }, time)), [null, "2026-10-10", null], "到 00:00 就是到午夜为止");
  // 相邻的两个时段不会同时命中交界的那一分钟
  assert.deepEqual([inSlot({ start: "06:00", end: "22:00" }, "22:00"), inSlot(night, "22:00")], [null, "2026-10-10"]);

  // 「每周五 22:00–06:00」= 周五 22:00 到周六 06:00（2026-10-09 是周五）
  const fridayNight = adjust({ cycle: { type: "weekly", weekdays: [5] }, timeSlot: night });
  const hit = (date: string, time: string): boolean => adjustRuleMatches(fridayNight, moment(date, time));
  assert.deepEqual(
    [hit("2026-10-09", "05:00"), hit("2026-10-09", "21:59"), hit("2026-10-09", "22:00"), hit("2026-10-10", "00:00"), hit("2026-10-10", "05:59"), hit("2026-10-10", "06:00"), hit("2026-10-10", "22:00")],
    [false, false, true, true, true, false, false],
  );
  // 日期范围也按归属的那一天：范围到 12-31，元旦凌晨 01:00 仍算 12-31 夜里的；范围从 10-01 起，10-01 凌晨的不算（它属于 9-30 夜里）
  const yearEnd = adjust({ travelFrom: "2026-10-01", travelTo: "2026-12-31", timeSlot: night });
  assert.equal(adjustRuleMatches(yearEnd, moment("2027-01-01", "01:00")), true);
  assert.equal(adjustRuleMatches(yearEnd, moment("2027-01-01", "23:00")), false);
  assert.equal(adjustRuleMatches(yearEnd, moment("2026-10-01", "01:00")), false);
  assert.equal(adjustRuleMatches(yearEnd, moment("2026-10-01", "22:00")), true);
  // 指定日期 + 跨午夜：跨月、跨年照样往前归一天
  const eve = adjust({ cycle: { type: "dates", dates: ["2028-02-29"] }, timeSlot: night });
  assert.equal(adjustRuleMatches(eve, moment("2028-03-01", "03:00")), true);
  assert.equal(addDays("2028-03-01", -1), "2028-02-29");
  assert.equal(addDays("2027-01-01", -1), "2026-12-31");
});

test("城市时区和夏令时：调价按城市当地的日期和时刻判断，和服务器、浏览器在哪个时区无关", () => {
  const night = adjust({ cycle: { type: "weekly", weekdays: [5] }, timeSlot: { start: "22:00", end: "06:00" } });
  const hitAt = (instant: string, timeZone: string): boolean => {
    const local = instantToLocal(new Date(instant), timeZone);
    return adjustRuleMatches(night, { ...moment(local.date, "00:00"), minuteOfDay: local.minuteOfDay });
  };
  // 东京周五 22:30 = UTC 周五 13:30；同一时刻在首尔也是 22:30，在纽约是周五上午
  assert.equal(hitAt("2026-10-09T13:30:00Z", "Asia/Tokyo"), true);
  assert.equal(hitAt("2026-10-09T13:30:00Z", "Asia/Seoul"), true);
  assert.equal(hitAt("2026-10-09T13:30:00Z", "America/New_York"), false);
  // UTC 的周五 23:00 在东京已经是周六 08:00
  assert.equal(hitAt("2026-10-09T23:00:00Z", "Asia/Tokyo"), false);
  // UTC 的周四 15:00 在东京是周五 00:00：属于周四夜里，不是周五夜里
  assert.equal(hitAt("2026-10-08T15:00:00Z", "Asia/Tokyo"), false);
  // 夏令时结束的那一夜（纽约 2026-11-01 02:00 拨回 01:00）：周六 10-31 不是周五，换成周六的规则来看
  const saturday = adjust({ cycle: { type: "weekly", weekdays: [6] }, timeSlot: { start: "22:00", end: "06:00" } });
  const local = (instant: string) => instantToLocal(new Date(instant), "America/New_York");
  const hits = (instant: string): boolean => adjustRuleMatches(saturday, { ...moment(local(instant).date, "00:00"), minuteOfDay: local(instant).minuteOfDay });
  assert.equal(local("2026-11-01T05:30:00Z").dateTime, "2026-11-01T01:30", "第一次 01:30（夏令时）");
  assert.equal(local("2026-11-01T06:30:00Z").dateTime, "2026-11-01T01:30", "第二次 01:30（标准时间）");
  assert.deepEqual([hits("2026-11-01T01:59:00Z"), hits("2026-11-01T02:00:00Z"), hits("2026-11-01T05:30:00Z"), hits("2026-11-01T06:30:00Z"), hits("2026-11-01T10:59:00Z"), hits("2026-11-01T11:00:00Z")], [false, true, true, true, true, false]);
  // 夏令时开始的那一夜（2026-03-08 02:00 拨到 03:00）：当地 02:30 不存在，按拨快之后算
  assert.equal(instantToLocal(localDateTimeToInstant("2026-03-08T02:30", "America/New_York") as Date, "America/New_York").dateTime, "2026-03-08T03:30");
  const spring = (instant: string) => instantToLocal(new Date(instant), "America/New_York");
  assert.equal(adjustRuleMatches(saturday, { ...moment(spring("2026-03-08T07:30:00Z").date, "00:00"), minuteOfDay: spring("2026-03-08T07:30:00Z").minuteOfDay }), true, "周六夜里 03:30（拨快后）仍在 06:00 之前");
});

test("「调得很多」：结果高于基础价的 4 倍或低于一半时提醒（不拦）", () => {
  const bases = [exactFromMinor(10_000)];
  const unusual = (steps: AdjustStep[]): boolean => adjustRuleIsUnusual({ steps }, bases);
  assert.deepEqual([unusual([{ type: "percent", value: 30_000 }]), unusual([{ type: "percent", value: 30_001 }]), unusual([{ type: "percent", value: -5_000 }]), unusual([{ type: "percent", value: -5_001 }])], [false, true, false, true]);
  assert.equal(unusual([{ type: "amount", value: 30_001 }]), true);
  assert.equal(unusual([{ type: "amount", value: -5_001 }]), true);
  assert.equal(adjustRuleIsUnusual({ steps: [{ type: "amount", value: -3_000 }] }, [exactFromMinor(10_000), exactFromMinor(5_000)]), true, "对任何一条价格调得很多就提醒");
  assert.equal(adjustRuleIsUnusual({ steps: [{ type: "amount", value: -3_000 }] }, []), false);
});

test("一次用车的结算价：命中价格 → 基础价 → 匹配的调价按顺序链式执行 → 取整；没有价格时说明原因", () => {
  const priceRules = [price({ direction: "both" }), price({ direction: "pickup", pricing: { model: "fixed", basePriceMinor: 22_050 }, validFrom: "2026-11-01" }), price({ areaId: "a2", status: "disabled" })];
  const adjustRules = [
    adjust({ name: "周末", cycle: { type: "weekly", weekdays: [6, 7] }, steps: [{ type: "percent", value: 1_000 }] }),
    adjust({ name: "深夜", timeSlot: { start: "22:00", end: "06:00" }, steps: [{ type: "amount", value: 3_000 }] }),
    adjust({ name: "停用的", status: "disabled", steps: [{ type: "percent", value: 9_000 }] }),
    adjust({ name: "只管送机", directions: ["dropoff"], steps: [{ type: "amount", value: -500 }] }),
  ];
  const quote = (date: string, time: string, extra: Record<string, unknown> = {}) =>
    tripPrice({ priceRules, adjustRules, query: { areaId: "a1", vehicleGroupId: "v1", direction: "pickup", packageHours: null, date, ...extra }, minuteOfDay: moment(date, time).minuteOfDay, roundingUnit: 100 });
  // 周五白天：接送通用 20000，没有调价
  const plain = quote("2026-10-09", "10:00");
  assert.deepEqual([plain.priceRule, plain.price?.finalMinor, plain.price?.adjusts.length, plain.noPriceReason], [priceRules[0], 20_000, 0, null]);
  // 周六 23:00：先周末 +10%，再深夜 +3000（顺序即优先级）
  const both = quote("2026-10-10", "23:00");
  assert.deepEqual([both.price?.finalMinor, both.price?.adjusts.map((entry) => entry.rule.name)], [25_000, ["周末", "深夜"]]);
  // 周日凌晨 02:00：深夜算在周六头上，周末按用车当天（周日）也命中
  assert.equal(quote("2026-10-11", "02:00").price?.finalMinor, 25_000);
  // 周一凌晨 02:00：深夜（周日夜里）命中，周末不命中
  assert.deepEqual(quote("2026-10-12", "02:00").price?.adjusts.map((entry) => entry.rule.name), ["深夜"]);
  // 送机：只管送机的那条也命中，排在后面
  assert.equal(quote("2026-10-10", "23:00", { direction: "dropoff" }).price?.finalMinor, 24_500);
  // 11 月起接机有自己的价：22050，取整到 100 = 22100（没有调价也取整）
  const specific = quote("2026-11-02", "10:00");
  assert.deepEqual([specific.priceRule, specific.price?.finalMinor, specific.price?.baseMinor, specific.price?.adjustMinor], [priceRules[1], 22_100, 22_050, 50]);
  // 没有价格的三种情况
  assert.deepEqual([quote("2026-10-09", "10:00", { vehicleGroupId: "v9" }).noPriceReason, quote("2026-09-30", "10:00").noPriceReason, quote("2026-10-09", "10:00", { areaId: "a2" }).noPriceReason], ["NO_RULE", "NOT_IN_EFFECT", "RULE_DISABLED"]);
  assert.equal(quote("2026-09-30", "10:00").price, null);
  // 调完不大于 0
  const tooLow = tripPrice({ priceRules, adjustRules: [adjust({ steps: [{ type: "amount", value: -20_000 }] })], query: { areaId: "a1", vehicleGroupId: "v1", direction: "dropoff", packageHours: null, date: "2026-10-09" }, minuteOfDay: 600, roundingUnit: 1 });
  assert.deepEqual([tooLow.noPriceReason, tooLow.price?.finalMinor], ["NOT_POSITIVE", null]);
  // 里程 + 时长：用量参与基础价
  const metered = tripPrice({ priceRules: [price({ pricing: MILEAGE })], adjustRules: [adjustRules[0] as AdjustRule], query: { areaId: "a1", vehicleGroupId: "v1", direction: "pickup", packageHours: null, date: "2026-10-10" }, minuteOfDay: 600, usage: { meters: 15_000, minutes: 45 }, roundingUnit: 10 });
  assert.equal(metered.price?.finalMinor, 9_900, "9000 × 1.1");
});

test("价格日历的一天：按调价规则的时段切成几段，相邻的、结果相同的并在一起；和逐个时刻单独算的结果逐项相同", () => {
  const priceRules = [price({ direction: "both" })];
  const adjustRules = [
    adjust({ name: "周六", cycle: { type: "weekly", weekdays: [6] }, steps: [{ type: "percent", value: 1_000 }] }),
    adjust({ name: "深夜", timeSlot: { start: "22:00", end: "06:00" }, steps: [{ type: "amount", value: 3_000 }] }),
    adjust({ name: "早高峰", timeSlot: { start: "07:00", end: "09:00" }, areaIds: ["a2"], steps: [{ type: "amount", value: 999 }] }),
  ];
  const query = { areaId: "a1", vehicleGroupId: "v1", direction: "pickup" as const, packageHours: null, date: "2026-10-10" };
  const day = calendarDay({ priceRules, adjustRules, query, roundingUnit: 100 });
  assert.deepEqual(day.map((segment) => [segment.fromMinute, segment.toMinute, segment.price?.finalMinor, segment.price?.adjusts.map((entry) => entry.rule.name)]), [
    [0, 360, 25_000, ["周六", "深夜"]],
    [360, 1_320, 22_000, ["周六"]],
    [1_320, 1_440, 25_000, ["周六", "深夜"]],
  ]);
  // 别的区域的早高峰不把这一天多切一刀（切了但结果相同，并回去了）
  // 每一分钟单独算，和它所在的那一段一样
  for (let minute = 0; minute < 1_440; minute += 7) {
    const single = tripPrice({ priceRules, adjustRules, query, minuteOfDay: minute, roundingUnit: 100 });
    const segment = day.find((entry) => minute >= entry.fromMinute && minute < entry.toMinute);
    assert.equal(single.price?.finalMinor, segment?.price?.finalMinor, `第 ${minute} 分钟`);
  }
  // 没有带时段的调价：整天一段；没有价格的日子也是一段，带原因
  assert.deepEqual(calendarDay({ priceRules, adjustRules: [adjustRules[0] as AdjustRule], query, roundingUnit: 1 }).map((segment) => [segment.fromMinute, segment.toMinute]), [[0, 1_440]]);
  const none = calendarDay({ priceRules, adjustRules, query: { ...query, date: "2026-09-01" }, roundingUnit: 1 });
  assert.deepEqual(none.map((segment) => [segment.fromMinute, segment.toMinute, segment.noPriceReason, segment.price]), [[0, 1_440, "NOT_IN_EFFECT", null]]);
});

test("缺价的组合：接送机 = 区域 × 车型组 × 接 / 送，点对点 = 区域 × 车型组，包车 = 区域 × 车型组 × 出现过的套餐；有启用且没过期的价格才算有", () => {
  const today = "2026-10-08";
  const rules = [
    price({ direction: "both" }), // 0：a1 v1 接、送都有
    price({ vehicleGroupId: "v2", direction: "pickup", validFrom: "2026-11-01" }), // 1：以后才生效，也算有
    price({ areaId: "a2", direction: "dropoff", status: "disabled" }), // 2：停用的不算
    price({ areaId: "a2", vehicleGroupId: "v2", direction: "pickup", validTo: "2026-10-07" }), // 3：过期的不算
    price({ areaId: "a2", vehicleGroupId: "v2", direction: "dropoff", validTo: "2026-10-08" }), // 4：今天到期，还算
    price({ direction: "pickup", pricing: { model: "fixed", basePriceMinor: 30_000 } }), // 5：a1 v1 接机有自己的价，优先于通用
    price({ areaId: "a9" }), // 6：区域已经不在商品里，不计入
  ];
  const coverage = priceCoverage({ category: "airport_transfer", areaIds: ["a1", "a2"], vehicleGroupIds: ["v1", "v2"], rules, today });
  assert.deepEqual([coverage.total, coverage.priced, coverage.packages], [8, 4, []]);
  assert.deepEqual(coverage.combos.map((combo) => `${combo.areaId} ${combo.vehicleGroupId} ${combo.direction} ${combo.state} ${combo.ruleIndex}${combo.viaBoth ? " 通用" : ""}${combo.state === "upcoming" ? ` ${combo.from}` : ""}`), [
    "a1 v1 pickup priced 5",
    "a1 v1 dropoff priced 0 通用",
    "a1 v2 pickup upcoming 1 2026-11-01",
    "a1 v2 dropoff missing null",
    "a2 v1 pickup missing null",
    "a2 v1 dropoff missing null",
    "a2 v2 pickup missing null",
    "a2 v2 dropoff priced 4",
  ]);
  // 点对点
  const p2p = priceCoverage({ category: "point_to_point", areaIds: ["a1", "a2"], vehicleGroupIds: ["v1"], rules: [price({ direction: null })], today });
  assert.deepEqual([p2p.total, p2p.priced, p2p.combos.map((combo) => combo.state)], [2, 1, ["priced", "missing"]]);
  // 包车：套餐 = 现有价格里出现过的时长（停用的、过期的也算出现过）
  const charter = (packageHours: number, extra: Partial<PriceRule> = {}) => price({ direction: null, packageHours, pricing: CHARTER, ...extra });
  const chartered = priceCoverage({ category: "charter", areaIds: ["a1"], vehicleGroupIds: ["v1", "v2"], rules: [charter(10), charter(5, { vehicleGroupId: "v2" }), charter(8, { status: "disabled" })], today });
  assert.deepEqual([chartered.total, chartered.priced, chartered.packages], [6, 2, [5, 8, 10]]);
  assert.deepEqual(chartered.combos.filter((combo) => combo.state === "priced").map((combo) => `${combo.vehicleGroupId} ${combo.packageHours}`), ["v1 10", "v2 5"]);
  // 还没有任何价格：接送机照样数得出该有几个；包车没有套餐所以是 0
  assert.deepEqual([priceCoverage({ category: "airport_transfer", areaIds: ["a1"], vehicleGroupIds: ["v1"], rules: [], today }).total, priceCoverage({ category: "charter", areaIds: ["a1"], vehicleGroupIds: ["v1"], rules: [], today }).total], [2, 0]);
  assert.equal(compareExact(exactFromMinor(1), exactFromMinor(2)), -1);
});
