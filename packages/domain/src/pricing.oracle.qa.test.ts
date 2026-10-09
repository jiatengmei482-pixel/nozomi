/**
 * M1-04 验收测试（测试工程师）：用一份独立写的对照实现核对金额计算和规则匹配。
 *
 * 对照实现的写法故意和 pricing.ts 不同：
 * - 金额用不约分的 bigint 分数 [分子, 分母]，比较用交叉相乘；取整用「加半个单位再向下取整」，负数先取绝对值；
 * - 日期用自己写的「公历 → 日序号」换算（不经过 Date），星期由日序号取模得到；
 * - 时段按「把跨午夜的时段拆成当天的后半段和次日的前半段」来判断，而不是先算归属日期。
 * 随机数用固定种子，失败时可以原样复现。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PRICE_LIMITS,
  type AdjustRule,
  type AdjustStep,
  type ExactAmount,
  type PriceRule,
  type Pricing,
  adjustRuleMatches,
  adjustRuleNonPositivePrices,
  applyAdjustRules,
  applyAdjustSteps,
  basePrice,
  calendarDay,
  exactFromMinor,
  findPriceRuleOverlaps,
  formatExact,
  formatExactMajor,
  holidayLookup,
  instantToLocal,
  priceRuleIsActive,
  roundFractionHalfAwayFromZero,
  roundFractionToUnit,
  selectPriceRule,
  tripPrice,
} from "./index.ts";

// ───────────── 随机数（固定种子）─────────────

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type Rand = () => number;
const int = (r: Rand, min: number, max: number): number => min + Math.floor(r() * (max - min + 1));
const pick = <T>(r: Rand, items: readonly T[]): T => items[Math.floor(r() * items.length)] as T;

// ───────────── 对照实现：分数 ─────────────

type Q = [bigint, bigint];
const q = (n: number | bigint): Q => [BigInt(n), 1n];
const qAdd = (a: Q, b: Q): Q => [a[0] * b[1] + b[0] * a[1], a[1] * b[1]];
const qMul = (a: Q, n: bigint, d: bigint): Q => [a[0] * n, a[1] * d];
const qCmp = (a: Q, b: Q): number => {
  const left = a[0] * b[1];
  const right = b[0] * a[1];
  return left < right ? -1 : left > right ? 1 : 0;
};
const qEq = (a: Q, b: ExactAmount): boolean => a[0] * b.denominator === b.numerator * a[1];
/** 四舍五入到 unit 的整数倍，正好一半远离零：|x| 加半个单位后向下取整。 */
function qRound(a: Q, unit: bigint): bigint {
  const negative = a[0] < 0n;
  const n = negative ? -a[0] : a[0];
  const d = a[1];
  // floor((n/d + unit/2) / unit) = floor((2n + unit·d) / (2·unit·d))
  const steps = (2n * n + unit * d) / (2n * unit * d);
  return (negative ? -steps : steps) * unit;
}

function oracleBase(pricing: Pricing, meters: number, minutes: number, packageHours: number | null): Q {
  if (pricing.model === "fixed") return q(pricing.basePriceMinor);
  if (pricing.model === "mileage_time") {
    const overMeters = Math.max(0, meters - pricing.startMeters);
    const overMinutes = Math.max(0, minutes - pricing.startMinutes);
    let total: Q = q(pricing.startPriceMinor);
    total = qAdd(total, [BigInt(pricing.perKmMinor) * BigInt(overMeters), 1000n]);
    total = qAdd(total, q(BigInt(pricing.perMinuteMinor) * BigInt(overMinutes)));
    if (pricing.minPriceMinor !== null && qCmp(total, q(pricing.minPriceMinor)) < 0) return q(pricing.minPriceMinor);
    return total;
  }
  const overMinutes = Math.max(0, minutes - (packageHours ?? 0) * 60);
  const overMeters = Math.max(0, meters - pricing.packageKm * 1000);
  let total: Q = q(pricing.packagePriceMinor);
  total = qAdd(total, [BigInt(pricing.overtimePerHourMinor) * BigInt(overMinutes), 60n]);
  total = qAdd(total, [BigInt(pricing.overKmPerKmMinor) * BigInt(overMeters), 1000n]);
  return total;
}

function oracleSteps(base: Q, steps: readonly AdjustStep[]): Q[] {
  const out: Q[] = [];
  let current = base;
  for (const step of steps) {
    current = step.type === "percent" ? qMul(current, 10_000n + BigInt(step.value), 10_000n) : qAdd(current, q(step.value));
    out.push(current);
  }
  return out;
}

/** 调价全部执行完再取整一次；不大于 0（含取整后为 0）就是报不出价。 */
function oracleFinal(base: Q, rules: readonly { steps: readonly AdjustStep[] }[], unit: number): { unrounded: Q; final: number | null } {
  let current = base;
  for (const rule of rules) current = oracleSteps(current, rule.steps).at(-1) ?? current;
  const rounded = qRound(current, BigInt(unit));
  return { unrounded: current, final: current[0] * current[1] <= 0n || rounded <= 0n ? null : Number(rounded) };
}

// ───────────── 对照实现：日期 ─────────────

/** 公历日期 → 从 1970-01-01 起的天数（Howard Hinnant 的 days_from_civil）。 */
function dayNumber(date: string): number {
  let y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}
function dateOf(day: number): string {
  const z = day + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
/** 1 = 周一 … 7 = 周日。1970-01-01 是周四。 */
const weekday = (day: number): number => ((((day + 3) % 7) + 7) % 7) + 1;
const minuteOf = (text: string): number => (text === "24:00" ? 1440 : Number(text.slice(0, 2)) * 60 + Number(text.slice(3, 5)));

interface Moment {
  date: string;
  minuteOfDay: number;
  areaId: string;
  vehicleGroupId: string;
  direction: "pickup" | "dropoff" | null;
  packageHours: number | null;
}

/** 这条规则在「某一天开始的那一次时段」里算不算数：日期范围、周期都看开始的那一天。 */
function oracleDayCounts(rule: AdjustRule, day: number, holidays: ReadonlySet<string>): boolean {
  const date = dateOf(day);
  if (rule.travelFrom !== null && day < dayNumber(rule.travelFrom)) return false;
  if (rule.travelTo !== null && day > dayNumber(rule.travelTo)) return false;
  if (rule.cycle.type === "weekly") return rule.cycle.weekdays.includes(weekday(day));
  if (rule.cycle.type === "dates") return rule.cycle.dates.includes(date);
  if (rule.cycle.type === "holidays") return rule.cycle.countries.some((country) => holidays.has(`${country}|${date}`));
  return true;
}

function oracleMatches(rule: AdjustRule, moment: Moment, holidays: ReadonlySet<string>): boolean {
  if (rule.status !== "enabled") return false;
  if (rule.areaIds.length > 0 && !rule.areaIds.includes(moment.areaId)) return false;
  if (rule.vehicleGroupIds.length > 0 && !rule.vehicleGroupIds.includes(moment.vehicleGroupId)) return false;
  if (rule.directions.length > 0 && (moment.direction === null || !rule.directions.includes(moment.direction))) return false;
  if (rule.packageHours.length > 0 && (moment.packageHours === null || !rule.packageHours.includes(moment.packageHours))) return false;
  const day = dayNumber(moment.date);
  const minute = moment.minuteOfDay;
  if (rule.timeSlot === null) return oracleDayCounts(rule, day, holidays);
  const start = minuteOf(rule.timeSlot.start);
  const end = minuteOf(rule.timeSlot.end);
  if (start < end) return minute >= start && minute < end && oracleDayCounts(rule, day, holidays);
  // 跨午夜：今天的 [start, 24:00) 属于今天开始的那一次；今天的 [00:00, end) 属于昨天开始的那一次
  if (minute >= start) return oracleDayCounts(rule, day, holidays);
  if (minute < end) return oracleDayCounts(rule, day - 1, holidays);
  return false;
}

function oracleSelect(rules: readonly PriceRule[], query: { areaId: string; vehicleGroupId: string; direction: "pickup" | "dropoff" | null; packageHours: number | null; date: string }): PriceRule[] {
  const day = dayNumber(query.date);
  const live = rules.filter(
    (rule) =>
      rule.status === "enabled" &&
      rule.areaId === query.areaId &&
      rule.vehicleGroupId === query.vehicleGroupId &&
      rule.packageHours === query.packageHours &&
      dayNumber(rule.validFrom) <= day &&
      (rule.validTo === null || day <= dayNumber(rule.validTo)),
  );
  if (query.direction === null) return live.filter((rule) => rule.direction === null);
  const exactDirection = live.filter((rule) => rule.direction === query.direction);
  return exactDirection.length > 0 ? exactDirection : live.filter((rule) => rule.direction === "both");
}

// ───────────── 随机输入 ─────────────

const AMOUNTS = [0, 1, 2, 3, 7, 9, 10, 11, 33, 49, 50, 51, 99, 100, 101, 149, 150, 333, 499, 500, 501, 999, 1_000, 1_001, 4_600, 12_345, 20_050, 98_000, 999_999, 123_456_789, 999_999_999, 1_000_000_000];
function amount(r: Rand, min = 0): number {
  const value = r() < 0.6 ? pick(r, AMOUNTS) : int(r, 0, r() < 0.5 ? 2_000 : 1_000_000_000);
  return Math.max(min, value);
}

function randomPricing(r: Rand): { pricing: Pricing; packageHours: number | null } {
  const kind = int(r, 0, 2);
  if (kind === 0) return { pricing: { model: "fixed", basePriceMinor: amount(r, 1) }, packageHours: null };
  if (kind === 1) {
    const start = amount(r);
    return {
      pricing: { model: "mileage_time", startPriceMinor: start, startMeters: int(r, 0, 300) * 100, startMinutes: int(r, 0, 240), perKmMinor: amount(r), perMinuteMinor: amount(r), minPriceMinor: start === 0 || r() < 0.5 ? amount(r, 1) : null },
      packageHours: null,
    };
  }
  return { pricing: { model: "charter_package", packageKm: int(r, 1, 600), packagePriceMinor: amount(r, 1), overtimePerHourMinor: amount(r), overKmPerKmMinor: amount(r) }, packageHours: int(r, 1, 72) };
}

/** 用量：故意往「恰好相等、多 1 米、多 1 分钟」上凑。 */
function randomUsage(r: Rand, pricing: Pricing, packageHours: number | null): { meters: number; minutes: number } {
  const includedMeters = pricing.model === "mileage_time" ? pricing.startMeters : pricing.model === "charter_package" ? pricing.packageKm * 1000 : 0;
  const includedMinutes = pricing.model === "mileage_time" ? pricing.startMinutes : (packageHours ?? 0) * 60;
  const near = (included: number, far: number): number => Math.max(0, r() < 0.7 ? included + pick(r, [-1000, -1, 0, 1, 2, 3, 7, 59, 61, 100, 333, 499, 500, 501, 999, 1000, 1001]) : int(r, 0, far));
  return { meters: near(includedMeters, 3_000_000), minutes: near(includedMinutes, 6_000) };
}

function randomSteps(r: Rand, max = 10): AdjustStep[] {
  return Array.from({ length: int(r, 1, max) }, (): AdjustStep => {
    if (r() < 0.5) {
      const value = r() < 0.5 ? pick(r, [-9_999, -9_000, -5_000, -3_333, -1_250, -500, -1, 1, 3, 33, 50, 125, 333, 1_000, 1_250, 2_000, 3_333, 10_000, 100_000]) : int(r, -9_999, 100_000);
      return { type: "percent", value: value === 0 ? 1 : value };
    }
    const value = r() < 0.5 ? pick(r, [-20_000, -1_000, -500, -50, -1, 1, 5, 50, 500, 1_000, 3_000, 1_000_000_000, -1_000_000_000]) : int(r, -50_000, 50_000);
    return { type: "amount", value: value === 0 ? 1 : value };
  });
}

const UNITS = [1, 10, 100, 1_000, 10_000];

// ───────────── 基础价 ─────────────

test("基础价：三种计价方式 20,000 组随机输入（故意凑在起步 / 套餐的边界上）和独立的分数算法逐个相等", () => {
  const r = rng(20261009);
  for (let i = 0; i < 20_000; i += 1) {
    const { pricing, packageHours } = randomPricing(r);
    const usage = randomUsage(r, pricing, packageHours);
    const actual = basePrice(pricing, usage, packageHours);
    const expected = oracleBase(pricing, usage.meters, usage.minutes, packageHours);
    assert.ok(qEq(expected, actual), `第 ${i} 组 ${JSON.stringify({ pricing, packageHours, usage })}：期望 ${expected[0]}/${expected[1]}，实际 ${actual.numerator}/${actual.denominator}`);
    assert.ok(actual.denominator > 0n, "分母恒为正");
  }
});

test("基础价的边界：起步里程恰好相等不加钱、超 1 米按 1/1000 公里收、超时 1 分钟收 1 分钟、最低消费恰好相等、包车超时和超公里同时发生", () => {
  const mt: Pricing = { model: "mileage_time", startPriceMinor: 3_000, startMeters: 10_000, startMinutes: 30, perKmMinor: 333, perMinuteMinor: 7, minPriceMinor: 3_340 };
  const text = (usage: { meters?: number; minutes?: number }, pricing: Pricing = mt, hours: number | null = null): string => formatExact(basePrice(pricing, usage, hours));
  // 恰好相等：起步价 3,000，低于最低消费 3,340 → 3,340
  assert.equal(text({ meters: 10_000, minutes: 30 }), "3340");
  // 不设最低消费时恰好相等 = 起步价
  const noFloor: Pricing = { ...mt, minPriceMinor: null };
  assert.equal(text({ meters: 10_000, minutes: 30 }, noFloor), "3000");
  // 超 1 米：333 × 1 / 1000 = 0.333，不凑整
  assert.equal(text({ meters: 10_001, minutes: 30 }, noFloor), "3000.333");
  // 超时 1 分钟：+7
  assert.equal(text({ meters: 10_000, minutes: 31 }, noFloor), "3007");
  // 最低消费恰好相等：3,000 + 333 × 1 + 7 × 1 = 3,340 = 最低消费
  assert.equal(text({ meters: 11_000, minutes: 31 }), "3340");
  // 比最低消费多 0.333
  assert.equal(text({ meters: 11_001, minutes: 31 }), "3340.333");
  // 比最低消费少 0.333 → 抬到最低消费
  assert.equal(text({ meters: 10_999, minutes: 31 }), "3340");

  const pkg: Pricing = { model: "charter_package", packageKm: 300, packagePriceMinor: 98_000, overtimePerHourMinor: 5_000, overKmPerKmMinor: 400 };
  assert.equal(text({ meters: 300_000, minutes: 600 }, pkg, 10), "98000");
  // 超 1 分钟 = 5000/60 = 83.333333…；超 1 米 = 0.4
  assert.deepEqual(basePrice(pkg, { meters: 300_000, minutes: 601 }, 10), { numerator: 294_250n, denominator: 3n });
  assert.equal(text({ meters: 300_001, minutes: 600 }, pkg, 10), "98000.4");
  // 同时：超 90 分钟（7,500）+ 超 12.5 公里（5,000）
  assert.equal(text({ meters: 312_500, minutes: 690 }, pkg, 10), "110500");
  // 没给用量 = 不超出
  assert.equal(text({}, pkg, 10), "98000");
});

test("基础价不经过浮点数：0.1 + 0.2 这一类在浮点数里对不上的输入，结果是精确的分数", () => {
  // 每公里 1、超 100 米和超 200 米：浮点数里 0.1 + 0.2 ≠ 0.3
  const p: Pricing = { model: "mileage_time", startPriceMinor: 0, startMeters: 0, startMinutes: 0, perKmMinor: 1, perMinuteMinor: 0, minPriceMinor: 1 };
  const free: Pricing = { ...p, minPriceMinor: null, startPriceMinor: 0 };
  const a = basePrice(free, { meters: 100 });
  const b = basePrice(free, { meters: 200 });
  const c = basePrice(free, { meters: 300 });
  assert.equal(a.numerator * b.denominator * c.denominator + b.numerator * a.denominator * c.denominator, c.numerator * a.denominator * b.denominator, "1/10 + 2/10 = 3/10");
  // 每公里 1.005 元（100.5 分不可能，换成 1005 厘米…）：4.35 × 100 在浮点数里是 434.99999999999994
  const cny: Pricing = { model: "mileage_time", startPriceMinor: 0, startMeters: 0, startMinutes: 0, perKmMinor: 435, perMinuteMinor: 0, minPriceMinor: null };
  assert.deepEqual(basePrice(cny, { meters: 100_000 }), { numerator: 43_500n, denominator: 1n });
  // 5000 / 60 × 60 回到 5000，不留尾巴
  const pkg: Pricing = { model: "charter_package", packageKm: 1, packagePriceMinor: 1, overtimePerHourMinor: 5_000, overKmPerKmMinor: 0 };
  assert.deepEqual(basePrice(pkg, { minutes: 60 + 60 }, 1), { numerator: 5_001n, denominator: 1n });
  // 1.15 × 100 = 114.99999999999999（浮点）；这里 +15% 作用在 100 上必须正好是 115
  assert.equal(applyAdjustRules(exactFromMinor(100), [{ steps: [{ type: "percent", value: 1_500 }] }], 1).finalMinor, 115);
  // 1.005 × 1000 = 1004.9999999999999（浮点）；+0.5% 作用在 1000 上是 1005
  assert.equal(applyAdjustRules(exactFromMinor(1_000), [{ steps: [{ type: "percent", value: 50 }] }], 1).finalMinor, 1_005);
  // 8.5% 的 4,650 = 5,045.25；再 ×10 取整单位 → 5,050
  assert.equal(applyAdjustRules(exactFromMinor(4_650), [{ steps: [{ type: "percent", value: 850 }] }], 1).finalMinor, 5_045);
});

// ───────────── 调价链 ─────────────

test("调价步骤：5,000 组随机的百分比 / 金额混合链（含负数、最多 10 步），每一步的 after 和 delta 都和对照实现相等，delta 之和 = 最后 − 基数", () => {
  const r = rng(424242);
  for (let i = 0; i < 5_000; i += 1) {
    const { pricing, packageHours } = randomPricing(r);
    const usage = randomUsage(r, pricing, packageHours);
    const base = basePrice(pricing, usage, packageHours);
    const steps = randomSteps(r);
    const actual = applyAdjustSteps(base, steps);
    const expected = oracleSteps([base.numerator, base.denominator], steps);
    assert.equal(actual.steps.length, steps.length);
    let previous: Q = [base.numerator, base.denominator];
    let sum: Q = [0n, 1n];
    for (const [index, step] of actual.steps.entries()) {
      const want = expected[index] as Q;
      assert.ok(qEq(want, step.after), `第 ${i} 组第 ${index + 1} 步 after：${JSON.stringify(steps)}`);
      assert.ok(qEq(qAdd(want, [-previous[0], previous[1]]), step.delta), `第 ${i} 组第 ${index + 1} 步 delta`);
      sum = qAdd(sum, [step.delta.numerator, step.delta.denominator]);
      previous = want;
    }
    assert.ok(qEq(qAdd(previous, [-base.numerator, base.denominator]), { numerator: sum[0], denominator: sum[1] }), "各步 delta 之和 = 结果 − 基数");
    assert.ok(qEq(previous, actual.result));
  }
});

test("调价 + 取整：10,000 组随机输入在取整单位 1 / 10 / 100 / 1000 / 10000 下，结算价和对照实现相等；明细之和恒等于总价；不大于 0 时三项都是 null", () => {
  const r = rng(77);
  let nulls = 0;
  let overLimit = 0;
  for (let i = 0; i < 10_000; i += 1) {
    const { pricing, packageHours } = randomPricing(r);
    const usage = randomUsage(r, pricing, packageHours);
    const base = basePrice(pricing, usage, packageHours);
    const rules = Array.from({ length: int(r, 0, 4) }, () => ({ steps: randomSteps(r, 4) }));
    const unit = pick(r, UNITS);
    const expected = oracleFinal([base.numerator, base.denominator], rules, unit);
    const actual = applyAdjustRules(base, rules, unit);
    const context = `第 ${i} 组 ${JSON.stringify({ pricing, packageHours, usage, rules, unit })}`;
    // 结算价有上限（PRICE_LIMITS.maxSettlementMinor，修缺陷时定的）：基础价或调完的结果超过它的不报价，取整前的精确值照样要对
    const limit: Q = [BigInt(PRICE_LIMITS.maxSettlementMinor), 1n];
    if (qCmp(expected.unrounded, limit) > 0 || qCmp([base.numerator, base.denominator], limit) > 0) {
      overLimit += 1;
      assert.ok(qEq(expected.unrounded, actual.unrounded), `${context}：取整前`);
      assert.deepEqual([actual.finalMinor, actual.baseMinor, actual.adjustMinor], [null, null, null], `${context}：超过上限的不报价`);
      continue;
    }
    assert.ok(qEq(expected.unrounded, actual.unrounded), `${context}：取整前`);
    assert.equal(actual.finalMinor, expected.final, `${context}：取整后`);
    if (actual.finalMinor === null) {
      nulls += 1;
      assert.equal(actual.baseMinor, null);
      assert.equal(actual.adjustMinor, null);
      continue;
    }
    assert.equal(actual.finalMinor % unit, 0, `${context}：结算价是取整单位的整数倍`);
    assert.equal((actual.baseMinor as number) + (actual.adjustMinor as number), actual.finalMinor, `${context}：明细之和 = 总价`);
    assert.equal(actual.baseMinor, Number(qRound([base.numerator, base.denominator], 1n)), `${context}：明细里的基础价 = 基础价四舍五入到最小货币单位`);
    assert.ok(Number.isSafeInteger(actual.adjustMinor));
    // 取整的误差不超过半个单位
    const diff = qAdd(expected.unrounded, q(-actual.finalMinor));
    assert.ok(qCmp([diff[0] < 0n ? -diff[0] : diff[0], diff[1]], [BigInt(unit), 2n]) <= 0, `${context}：离精确值不超过半个取整单位`);
  }
  assert.ok(nulls > 100, `随机输入里应当有相当一部分调到不大于 0（实际 ${nulls} 组），否则没测到这一支`);
  assert.ok(overLimit > 0, "随机输入里应当有超过结算价上限的，否则没测到这一支");
});

test("取整：恰好一半时远离零（往大的取），差 1 个最小单位就不进位；取整单位 1 / 10 / 100 / 1000 / 10000 各一组；没有调价命中也取整", () => {
  for (const unit of UNITS) {
    const half = unit / 2;
    if (unit > 1) {
      assert.equal(applyAdjustRules(exactFromMinor(20 * unit + half), [], unit).finalMinor, 21 * unit, `单位 ${unit}：恰好一半进位`);
      assert.equal(applyAdjustRules(exactFromMinor(20 * unit + half - 1), [], unit).finalMinor, 20 * unit, `单位 ${unit}：差 1 不进位`);
      assert.equal(applyAdjustRules(exactFromMinor(20 * unit + half + 1), [], unit).finalMinor, 21 * unit);
    }
    // 分数形式的恰好一半：(20·unit + unit/2) 用百分比凑出来
    const exactHalf: ExactAmount = { numerator: BigInt(41 * unit), denominator: 2n };
    assert.equal(applyAdjustRules(exactHalf, [], unit).finalMinor, 21 * unit, `单位 ${unit}：分数的恰好一半`);
    // 比一半少一丁点（1/10^12）不进位
    const below: ExactAmount = { numerator: BigInt(41 * unit) * 10n ** 12n - 1n, denominator: 2n * 10n ** 12n };
    assert.equal(applyAdjustRules(below, [], unit).finalMinor, 20 * unit, `单位 ${unit}：比一半少 1e-12 不进位`);
  }
  // 负责人确认的例子：基础价 20050、取整单位 100，没有调价也报 20100
  assert.equal(applyAdjustRules(exactFromMinor(20_050), [], 100).finalMinor, 20_100);
  // 23,149.5 → 23,150（单位 1）；→ 23,100（单位 100）；→ 23,000（单位 1000）
  const p: ExactAmount = { numerator: 46_299n, denominator: 2n };
  assert.deepEqual([1, 10, 100, 1_000].map((unit) => applyAdjustRules(p, [], unit).finalMinor), [23_150, 23_150, 23_100, 23_000]);
});

test("四舍五入的正负对称：round(−x) = −round(x)，对 3,000 组随机分数和各取整单位成立；恰好半个最小单位时 +0.5 → 1、−0.5 → −1", () => {
  assert.equal(roundFractionHalfAwayFromZero(1n, 2n), 1n);
  assert.equal(roundFractionHalfAwayFromZero(-1n, 2n), -1n);
  assert.equal(roundFractionHalfAwayFromZero(1n, -2n), -1n);
  assert.equal(roundFractionHalfAwayFromZero(-1n, -2n), 1n);
  assert.equal(roundFractionHalfAwayFromZero(49n, 100n), 0n);
  assert.equal(roundFractionHalfAwayFromZero(-49n, 100n), 0n);
  assert.equal(roundFractionHalfAwayFromZero(-3n, 2n), -2n);
  assert.equal(roundFractionHalfAwayFromZero(5n, 2n), 3n);
  const r = rng(5);
  for (let i = 0; i < 3_000; i += 1) {
    const n = BigInt(int(r, 0, 2_000_000_000)) * BigInt(int(r, 1, 1_000_000));
    const d = BigInt(pick(r, [1, 2, 3, 4, 6, 7, 10, 60, 1_000, 10_000, 60_000, 100_000_000]));
    for (const unit of UNITS) {
      const up = roundFractionHalfAwayFromZero(n, d * BigInt(unit));
      assert.equal(roundFractionHalfAwayFromZero(-n, d * BigInt(unit)), -up);
      assert.equal(up * BigInt(unit), qRound([n, d], BigInt(unit)));
    }
  }
  // 调价步骤里的对称：+x 和 −x 的金额步骤互相抵消，回到原值
  const base = exactFromMinor(12_345);
  assert.deepEqual(applyAdjustSteps(base, [{ type: "amount", value: 777 }, { type: "amount", value: -777 }]).result, base);
  // 百分比步骤的 delta 一正一负绝对值相等
  const up = applyAdjustSteps(base, [{ type: "percent", value: 333 }]).steps[0]?.delta as ExactAmount;
  const down = applyAdjustSteps(base, [{ type: "percent", value: -333 }]).steps[0]?.delta as ExactAmount;
  assert.equal(up.numerator, -down.numerator);
  assert.equal(up.denominator, down.denominator);
});

test("尾差归属：基础价带小数、调价带小数、取整单位 100 时，明细里的基础价 + 调价项 = 结算价，尾差在调价项里", () => {
  // 里程 + 时长：3000 + 333 × 0.001 = 3000.333；+12.5% = 3375.374625；取整到 100 → 3400
  const base = basePrice({ model: "mileage_time", startPriceMinor: 3_000, startMeters: 0, startMinutes: 0, perKmMinor: 333, perMinuteMinor: 0, minPriceMinor: null }, { meters: 1 });
  const priced = applyAdjustRules(base, [{ steps: [{ type: "percent", value: 1_250 }] }], 100);
  assert.equal(formatExact(priced.unrounded), "3375.374625");
  assert.deepEqual([priced.finalMinor, priced.baseMinor, priced.adjustMinor], [3_400, 3_000, 400]);
  // 没有调价命中、取整把价格往下带：尾差是负的调价项
  const plain = applyAdjustRules(exactFromMinor(20_049), [], 100);
  assert.deepEqual([plain.finalMinor, plain.baseMinor, plain.adjustMinor], [20_000, 20_049, -49]);
  // 基础价恰好 x.5：明细里的基础价进位，调价项吸收
  const half = applyAdjustRules({ numerator: 46_299n, denominator: 2n }, [{ steps: [{ type: "amount", value: 1 }] }], 1);
  assert.deepEqual([half.finalMinor, half.baseMinor, half.adjustMinor], [23_151, 23_150, 1]);
});

test("极大金额：上限 10 亿最小货币单位的基础价经 10 步百分比和金额调价，中间值是精确的（和 bigint 对照逐位相等），不丢精度", () => {
  const base = exactFromMinor(1_000_000_000);
  const steps: AdjustStep[] = [
    { type: "percent", value: 3_333 },
    { type: "percent", value: -3_333 },
    { type: "amount", value: 999_999_999 },
    { type: "percent", value: 1 },
    { type: "percent", value: -1 },
    { type: "percent", value: 9_999 },
    { type: "percent", value: -9_999 },
    { type: "amount", value: -1 },
    { type: "percent", value: 12_345 },
    { type: "percent", value: -4_321 },
  ];
  const actual = applyAdjustSteps(base, steps);
  const expected = oracleSteps(q(1_000_000_000), steps);
  for (const [index, step] of actual.steps.entries()) assert.ok(qEq(expected[index] as Q, step.after), `第 ${index + 1} 步`);
  const final = applyAdjustRules(base, [{ steps }], 1);
  assert.equal(BigInt(final.finalMinor as number), qRound(expected.at(-1) as Q, 1n));
  // 里程：每公里 10 亿 × 3,000 公里 = 3e12，仍是精确整数
  assert.deepEqual(basePrice({ model: "mileage_time", startPriceMinor: 1_000_000_000, startMeters: 0, startMinutes: 0, perKmMinor: 1_000_000_000, perMinuteMinor: 1_000_000_000, minPriceMinor: null }, { meters: 3_000_001, minutes: 1_441 }), {
    numerator: 1_000_000_000n + 3_000_001_000_000n + 1_441_000_000_000n,
    denominator: 1n,
  });
});

test("【缺陷】极大金额：校验允许的调价规则（每步最多 +1000%、每条最多 10 步）连乘后超出安全整数时，applyAdjustRules 直接抛异常，而不是给出「报不出价」", () => {
  // 基础价 20,000 日元；两条各 10 步 +1000% 的规则（都在 adjustRuleIssues 允许的范围内）：20000 × 11^20 ≈ 1.3e25
  const steps: AdjustStep[] = Array.from({ length: 10 }, () => ({ type: "percent", value: 100_000 }));
  assert.doesNotThrow(() => applyAdjustRules(exactFromMinor(20_000), [{ steps }, { steps }], 1), "超出可表示范围时应当返回一个能处理的结果（或者这样的规则根本存不了），不应当抛出 RangeError 让价格日历和报价整个失败");
});

// ───────────── 币种小数位 ─────────────

test("币种小数位：精确值换成主单位——日元（0 位）原样、人民币（2 位）挪两位；写得尽的原样写出，写不尽的四舍五入到最小单位后 6 位；负数对称", () => {
  const third: ExactAmount = { numerator: 294_250n, denominator: 3n };
  assert.equal(formatExact(third), "98083.333333");
  assert.equal(formatExactMajor(third, "JPY"), "98083.333333");
  assert.equal(formatExactMajor(third, "CNY"), "980.83333333");
  assert.equal(formatExactMajor({ numerator: 460_050n, denominator: 1n }, "CNY"), "4600.5");
  assert.equal(formatExactMajor({ numerator: 920_101n, denominator: 2n }, "CNY"), "4600.505");
  assert.equal(formatExactMajor({ numerator: -920_101n, denominator: 2n }, "USD"), "-4600.505");
  assert.equal(formatExactMajor({ numerator: 1n, denominator: 1n }, "CNY"), "0.01");
  assert.equal(formatExactMajor({ numerator: -1n, denominator: 3n }, "CNY"), "-0.00333333");
  assert.equal(formatExact({ numerator: 2n, denominator: 3n }), "0.666667");
  assert.equal(formatExact({ numerator: -2n, denominator: 3n }), "-0.666667");
  assert.equal(formatExact({ numerator: 0n, denominator: 1n }), "0");
  // 2 位小数的币种：取整单位 100 = 1 元。CNY 46.005 元（4600.5 分）→ 46.01 元（单位 1）→ 46 元（单位 100）
  const cny: ExactAmount = { numerator: 9_201n, denominator: 2n };
  assert.equal(roundFractionToUnit(cny.numerator, cny.denominator, 1), 4_601);
  assert.equal(roundFractionToUnit(cny.numerator, cny.denominator, 100), 4_600);
  assert.equal(roundFractionToUnit(9_301n, 2n, 100), 4_700);
  assert.equal(roundFractionToUnit(9_299n, 2n, 100), 4_600);
});

// ───────────── 规则匹配 ─────────────

const AREAS = ["a1", "a2", "a3"];
const GROUPS = ["g1", "g2"];
const DAY0 = dayNumber("2026-09-20");
const HOLIDAYS = [
  { countryCode: "JP", date: "2026-10-12" },
  { countryCode: "JP", date: "2026-11-03" },
  { countryCode: "KR", date: "2026-10-03" },
  { countryCode: "KR", date: "2026-10-12" },
  { countryCode: "JP", date: "2026-09-30" },
  { countryCode: "JP", date: "2026-10-31" },
];
const HOLIDAY_SET = new Set(HOLIDAYS.map((entry) => `${entry.countryCode}|${entry.date}`));
const TIMES = ["00:00", "00:01", "05:59", "06:00", "06:01", "12:00", "21:59", "22:00", "22:01", "23:59"];

function randomAdjustRule(r: Rand, category: "airport" | "charter" | "p2p", name: string): AdjustRule {
  const cycleType = int(r, 0, 3);
  const cycle: AdjustRule["cycle"] =
    cycleType === 0
      ? { type: "daily" }
      : cycleType === 1
        ? { type: "weekly", weekdays: [...new Set(Array.from({ length: int(r, 1, 3) }, () => int(r, 1, 7)))] }
        : cycleType === 2
          ? { type: "dates", dates: [...new Set(Array.from({ length: int(r, 1, 6) }, () => dateOf(DAY0 + int(r, 0, 60))))] }
          : { type: "holidays", countries: r() < 0.5 ? ["JP"] : ["JP", "KR"] };
  let timeSlot: AdjustRule["timeSlot"] = null;
  if (r() < 0.7) {
    const start = pick(r, TIMES);
    const end = pick(r, [...TIMES.filter((time) => time !== start), "24:00"]);
    if (!(start === "00:00" && end === "00:00")) timeSlot = { start, end };
  }
  const from = r() < 0.5 ? dateOf(DAY0 + int(r, 0, 40)) : null;
  const to = r() < 0.5 ? dateOf((from === null ? DAY0 : dayNumber(from)) + int(r, 0, 40)) : null;
  const some = <T>(items: readonly T[]): T[] => (r() < 0.6 ? [] : items.filter(() => r() < 0.5));
  return {
    name,
    travelFrom: from,
    travelTo: to,
    cycle,
    timeSlot,
    areaIds: some(AREAS),
    vehicleGroupIds: some(GROUPS),
    directions: category === "airport" ? some(["pickup", "dropoff"] as const) : [],
    packageHours: category === "charter" ? some([8, 10]) : [],
    steps: randomSteps(r, 3),
    status: r() < 0.85 ? "enabled" : "disabled",
  };
}

function randomMoment(r: Rand, category: "airport" | "charter" | "p2p"): Moment {
  return {
    date: dateOf(DAY0 + int(r, -2, 64)),
    minuteOfDay: r() < 0.6 ? minuteOf(pick(r, TIMES)) : int(r, 0, 1439),
    areaId: pick(r, AREAS),
    vehicleGroupId: pick(r, GROUPS),
    direction: category === "airport" ? pick(r, ["pickup", "dropoff"] as const) : null,
    packageHours: category === "charter" ? pick(r, [8, 10]) : null,
  };
}

test("对照实现自己的日期换算是对的：日序号往返、星期（2026-10-07 是周三、2024-02-29 是周四、2000-01-01 是周六）", () => {
  assert.equal(dateOf(dayNumber("2026-10-07")), "2026-10-07");
  assert.equal(weekday(dayNumber("2026-10-07")), 3);
  assert.equal(weekday(dayNumber("2024-02-29")), 4);
  assert.equal(weekday(dayNumber("2000-01-01")), 6);
  assert.equal(dateOf(dayNumber("2026-12-31") + 1), "2027-01-01");
  assert.equal(dateOf(dayNumber("2028-03-01") - 1), "2028-02-29");
});

test("调价规则匹配：40,000 组随机的规则 × 用车时刻（每天 / 每周几 / 指定日期 / 节假日，时段含跨午夜和 24:00，日期范围，适用范围，启停）和对照实现一致", () => {
  const r = rng(31337);
  const lookup = holidayLookup(HOLIDAYS);
  let hits = 0;
  for (let i = 0; i < 40_000; i += 1) {
    const category = pick(r, ["airport", "charter", "p2p"] as const);
    const rule = randomAdjustRule(r, category, "规则");
    const moment = randomMoment(r, category);
    const actual = adjustRuleMatches(rule, moment, lookup);
    const expected = oracleMatches(rule, moment, HOLIDAY_SET);
    if (expected) hits += 1;
    assert.equal(actual, expected, `第 ${i} 组 ${JSON.stringify({ rule, moment })}`);
  }
  assert.ok(hits > 2_000, `应当有相当一部分命中（实际 ${hits}）`);
});

test("调价时段的口径：开始含、结束不含；24:00 结束含 23:59；跨午夜的凌晨算在开始那天（日期范围、周几、指定日期、节假日都按开始那天）", () => {
  const rule = (extra: Partial<AdjustRule>): AdjustRule => ({ name: "夜间", travelFrom: null, travelTo: null, cycle: { type: "daily" }, timeSlot: null, areaIds: [], vehicleGroupIds: [], directions: [], packageHours: [], steps: [{ type: "percent", value: 2_000 }], status: "enabled", ...extra });
  const at = (date: string, time: string): Moment => ({ date, minuteOfDay: minuteOf(time), areaId: "a1", vehicleGroupId: "g1", direction: null, packageHours: null });
  const day = rule({ timeSlot: { start: "06:00", end: "22:00" } });
  assert.deepEqual(["05:59", "06:00", "21:59", "22:00"].map((time) => adjustRuleMatches(day, at("2026-10-09", time))), [false, true, true, false]);
  const lateNight = rule({ timeSlot: { start: "22:00", end: "24:00" } });
  assert.deepEqual(["21:59", "22:00", "23:59", "00:00"].map((time) => adjustRuleMatches(lateNight, at("2026-10-09", time))), [false, true, true, false]);
  // 周五 22:00–06:00：2026-10-09 是周五
  const friday = rule({ cycle: { type: "weekly", weekdays: [5] }, timeSlot: { start: "22:00", end: "06:00" } });
  assert.deepEqual(
    [["2026-10-09", "21:59"], ["2026-10-09", "22:00"], ["2026-10-10", "00:00"], ["2026-10-10", "05:59"], ["2026-10-10", "06:00"], ["2026-10-09", "05:59"], ["2026-10-10", "22:00"]].map(([date, time]) => adjustRuleMatches(friday, at(date as string, time as string))),
    [false, true, true, true, false, false, false],
  );
  // 范围到 12-31 的规则，元旦凌晨 01:00 仍然生效；范围从 10-01 起的规则，10-01 凌晨 01:00 不生效（那是 09-30 夜里的后半段）
  const yearEnd = rule({ travelFrom: "2026-10-01", travelTo: "2026-12-31", timeSlot: { start: "22:00", end: "06:00" } });
  assert.equal(adjustRuleMatches(yearEnd, at("2027-01-01", "01:00")), true);
  assert.equal(adjustRuleMatches(yearEnd, at("2027-01-01", "22:00")), false);
  assert.equal(adjustRuleMatches(yearEnd, at("2026-10-01", "01:00")), false);
  assert.equal(adjustRuleMatches(yearEnd, at("2026-10-01", "22:00")), true);
  // 跨月：指定日期 10-31 的夜间，11-01 凌晨算数
  const dated = rule({ cycle: { type: "dates", dates: ["2026-10-31"] }, timeSlot: { start: "23:00", end: "02:00" } });
  assert.equal(adjustRuleMatches(dated, at("2026-11-01", "01:59")), true);
  assert.equal(adjustRuleMatches(dated, at("2026-11-01", "02:00")), false);
  assert.equal(adjustRuleMatches(dated, at("2026-10-31", "01:00")), false);
  // 节假日 10-12 的夜间：10-13 凌晨算数，10-12 凌晨不算
  const holiday = rule({ cycle: { type: "holidays", countries: ["JP"] }, timeSlot: { start: "22:00", end: "06:00" } });
  const lookup = holidayLookup([{ countryCode: "JP", date: "2026-10-12" }]);
  assert.equal(adjustRuleMatches(holiday, at("2026-10-13", "03:00"), lookup), true);
  assert.equal(adjustRuleMatches(holiday, at("2026-10-12", "03:00"), lookup), false);
  assert.equal(adjustRuleMatches(holiday, at("2026-10-12", "22:00"), lookup), true);
  // 别的国家的假日不算；没有假日数据不生效
  assert.equal(adjustRuleMatches(rule({ cycle: { type: "holidays", countries: ["KR"] } }), at("2026-10-12", "10:00"), lookup), false);
  assert.equal(adjustRuleMatches(holiday, at("2026-10-12", "22:00")), false);
});

test("城市时区：同一个时刻在东京和纽约落在不同的当地日期；纽约夏令时开始（02:00 → 03:00）和结束（01:00 出现两次）那一夜，时段规则按当地钟面判断", () => {
  const night: AdjustRule = { name: "凌晨", travelFrom: null, travelTo: null, cycle: { type: "dates", dates: ["2026-03-08", "2026-11-01"] }, timeSlot: { start: "01:00", end: "03:00" }, areaIds: [], vehicleGroupIds: [], directions: [], packageHours: [], steps: [{ type: "amount", value: 500 }], status: "enabled" };
  const matches = (iso: string, zone: string): { local: string; hit: boolean } => {
    const local = instantToLocal(new Date(iso), zone);
    return { local: local.dateTime, hit: adjustRuleMatches(night, { date: local.date, minuteOfDay: local.minuteOfDay, areaId: "a", vehicleGroupId: "g", direction: null, packageHours: null }) };
  };
  // 夏令时开始：06:59Z = 01:59 EST（命中）；07:00Z = 03:00 EDT（02:00–03:00 这一小时不存在，直接到了结束，不命中）
  assert.deepEqual(matches("2026-03-08T06:59:00Z", "America/New_York"), { local: "2026-03-08T01:59", hit: true });
  assert.deepEqual(matches("2026-03-08T07:00:00Z", "America/New_York"), { local: "2026-03-08T03:00", hit: false });
  assert.deepEqual(matches("2026-03-08T05:59:00Z", "America/New_York"), { local: "2026-03-08T00:59", hit: false });
  // 夏令时结束：05:30Z = 01:30 EDT，06:30Z = 01:30 EST（两次 01:30 都命中），07:59Z = 02:59 EST，08:00Z = 03:00 EST
  assert.deepEqual(matches("2026-11-01T05:30:00Z", "America/New_York"), { local: "2026-11-01T01:30", hit: true });
  assert.deepEqual(matches("2026-11-01T06:30:00Z", "America/New_York"), { local: "2026-11-01T01:30", hit: true });
  assert.deepEqual(matches("2026-11-01T07:59:00Z", "America/New_York"), { local: "2026-11-01T02:59", hit: true });
  assert.deepEqual(matches("2026-11-01T08:00:00Z", "America/New_York"), { local: "2026-11-01T03:00", hit: false });
  // 同一个时刻：东京已经是 3 月 8 日下午，规则（指定日期 03-08 的 01:00–03:00）不命中
  assert.deepEqual(matches("2026-03-08T06:59:00Z", "Asia/Tokyo"), { local: "2026-03-08T15:59", hit: false });
  // 「今天」的边界：东京 23:59 和 00:00 差一天；UTC 同一天
  assert.equal(instantToLocal(new Date("2026-10-31T14:59:59Z"), "Asia/Tokyo").date, "2026-10-31");
  assert.equal(instantToLocal(new Date("2026-10-31T15:00:00Z"), "Asia/Tokyo").date, "2026-11-01");
  assert.equal(priceRuleIsActive({ status: "enabled", validTo: "2026-10-31" }, instantToLocal(new Date("2026-10-31T14:59:59Z"), "Asia/Tokyo").date), true);
  assert.equal(priceRuleIsActive({ status: "enabled", validTo: "2026-10-31" }, instantToLocal(new Date("2026-10-31T15:00:00Z"), "Asia/Tokyo").date), false);
});

function randomPriceRules(r: Rand, category: "airport" | "charter" | "p2p"): PriceRule[] {
  const rules: PriceRule[] = [];
  for (let i = 0; i < int(r, 0, 10); i += 1) {
    const from = DAY0 + int(r, -5, 50);
    const direction = category === "airport" ? pick(r, ["pickup", "dropoff", "both"] as const) : null;
    const packageHours = category === "charter" ? pick(r, [8, 10]) : null;
    const pricing: Pricing =
      category === "charter"
        ? { model: "charter_package", packageKm: 300, packagePriceMinor: amount(r, 1), overtimePerHourMinor: amount(r), overKmPerKmMinor: amount(r) }
        : r() < 0.6
          ? { model: "fixed", basePriceMinor: amount(r, 1) }
          : { model: "mileage_time", startPriceMinor: amount(r, 1), startMeters: int(r, 0, 100) * 100, startMinutes: int(r, 0, 60), perKmMinor: amount(r), perMinuteMinor: amount(r), minPriceMinor: r() < 0.5 ? amount(r, 1) : null };
    const candidate: PriceRule = { areaId: pick(r, AREAS), vehicleGroupId: pick(r, GROUPS), direction, packageHours, pricing, validFrom: dateOf(from), validTo: r() < 0.4 ? null : dateOf(from + int(r, 0, 30)), status: r() < 0.8 ? "enabled" : "disabled" };
    // 只保留满足唯一性的（同一个组合的日期不重叠），和库里能存在的数据一样
    if (findPriceRuleOverlaps([...rules, candidate]).length === 0) rules.push(candidate);
  }
  return rules;
}

test("命中价格规则：8,000 组随机规则 × 询价和对照实现一致——具体方向优先于接送通用、生效日期两端都含、停用和过期的不命中", () => {
  const r = rng(99);
  let found = 0;
  let viaBoth = 0;
  for (let i = 0; i < 8_000; i += 1) {
    const category = pick(r, ["airport", "charter", "p2p"] as const);
    const rules = randomPriceRules(r, category);
    const query = { areaId: pick(r, AREAS), vehicleGroupId: pick(r, GROUPS), direction: category === "airport" ? pick(r, ["pickup", "dropoff"] as const) : null, packageHours: category === "charter" ? pick(r, [8, 10]) : null, date: dateOf(DAY0 + int(r, -6, 82)) };
    const expected = oracleSelect(rules, query);
    assert.ok(expected.length <= 1, "满足唯一性的规则里，同一个组合同一天最多命中一条");
    const actual = selectPriceRule(rules, query);
    assert.equal(actual, expected[0] ?? null, `第 ${i} 组 ${JSON.stringify({ rules, query })}`);
    if (actual) found += 1;
    if (actual?.direction === "both") viaBoth += 1;
  }
  assert.ok(found > 500 && viaBoth > 50, `命中 ${found}、经接送通用 ${viaBoth}`);
});

test("命中价格规则的口径：生效的第一天和最后一天都命中、前后各差一天不命中；具体方向停用时退回接送通用；具体方向过期后退回接送通用", () => {
  const base = { areaId: "a1", vehicleGroupId: "g1", packageHours: null, pricing: { model: "fixed", basePriceMinor: 100 } as Pricing };
  const both: PriceRule = { ...base, direction: "both", validFrom: "2026-10-01", validTo: null, status: "enabled" };
  const pickup: PriceRule = { ...base, direction: "pickup", pricing: { model: "fixed", basePriceMinor: 200 }, validFrom: "2026-10-10", validTo: "2026-10-20", status: "enabled" };
  const ask = (date: string, direction: "pickup" | "dropoff", rules: PriceRule[] = [both, pickup]): PriceRule | null => selectPriceRule(rules, { areaId: "a1", vehicleGroupId: "g1", direction, packageHours: null, date });
  assert.equal(ask("2026-10-09", "pickup"), both);
  assert.equal(ask("2026-10-10", "pickup"), pickup);
  assert.equal(ask("2026-10-20", "pickup"), pickup);
  assert.equal(ask("2026-10-21", "pickup"), both);
  assert.equal(ask("2026-10-15", "dropoff"), both);
  assert.equal(ask("2026-09-30", "pickup"), null);
  assert.equal(ask("2026-10-15", "pickup", [both, { ...pickup, status: "disabled" }]), both);
  // 同一天的一条：从 10-10 到 10-10
  const oneDay: PriceRule = { ...pickup, validFrom: "2026-10-10", validTo: "2026-10-10" };
  assert.equal(ask("2026-10-10", "pickup", [oneDay]), oneDay);
  assert.equal(ask("2026-10-11", "pickup", [oneDay]), null);
  assert.equal(ask("2026-10-09", "pickup", [oneDay]), null);
  // 跨年、闰日
  const leap: PriceRule = { ...pickup, validFrom: "2027-12-31", validTo: "2028-02-29" };
  assert.equal(ask("2028-02-29", "pickup", [leap]), leap);
  assert.equal(ask("2028-03-01", "pickup", [leap]), null);
  assert.equal(ask("2028-01-01", "pickup", [leap]), leap);
});

test("一次用车的结算价和价格日历：400 组随机的价格 + 调价规则，每天 1,440 分钟逐分钟核对——日历的每一段内结果相同、等于 tripPrice、等于对照实现；段首尾相接铺满一天", () => {
  const r = rng(2026);
  const lookup = holidayLookup(HOLIDAYS);
  let priced = 0;
  let notPositive = 0;
  let split = 0;
  for (let i = 0; i < 400; i += 1) {
    const category = pick(r, ["airport", "charter", "p2p"] as const);
    const priceRules = randomPriceRules(r, category);
    const adjustRules = Array.from({ length: int(r, 0, 6) }, (_, index) => randomAdjustRule(r, category, `规则 ${index}`));
    const unit = pick(r, UNITS);
    const query = { areaId: pick(r, AREAS), vehicleGroupId: pick(r, GROUPS), direction: category === "airport" ? pick(r, ["pickup", "dropoff"] as const) : null, packageHours: category === "charter" ? pick(r, [8, 10]) : null, date: dateOf(DAY0 + int(r, 0, 60)) };
    // 多数时候保证这个组合有一条长期有效的价格（否则大部分随机询价都落在「没有价格」上，测不到调价）
    if (r() < 0.75) {
      const always: PriceRule = { areaId: query.areaId, vehicleGroupId: query.vehicleGroupId, direction: category === "airport" ? pick(r, [query.direction, "both"] as const) : null, packageHours: query.packageHours, pricing: category === "charter" ? { model: "charter_package", packageKm: 300, packagePriceMinor: amount(r, 1), overtimePerHourMinor: 5_000, overKmPerKmMinor: 400 } : { model: "fixed", basePriceMinor: amount(r, 1) }, validFrom: dateOf(DAY0 - 30), validTo: null, status: "enabled" };
      if (findPriceRuleOverlaps([...priceRules, always]).length === 0) priceRules.push(always);
    }
    const segments = calendarDay({ priceRules, adjustRules, query, roundingUnit: unit, holidays: lookup });
    assert.equal(segments[0]?.fromMinute, 0);
    assert.equal(segments.at(-1)?.toMinute, 1440);
    for (let s = 1; s < segments.length; s += 1) assert.equal(segments[s]?.fromMinute, segments[s - 1]?.toMinute, "段首尾相接");
    if (segments.length > 1) split += 1;
    const selected = oracleSelect(priceRules, query)[0] ?? null;
    for (let minute = 0; minute < 1440; minute += 1) {
      const segment = segments.find((entry) => entry.fromMinute <= minute && minute < entry.toMinute);
      assert.ok(segment, `第 ${minute} 分钟落在某一段里`);
      const moment: Moment = { ...query, minuteOfDay: minute };
      const matched = adjustRules.filter((rule) => oracleMatches(rule, moment, HOLIDAY_SET));
      const context = `第 ${i} 组 ${query.date} 第 ${minute} 分钟 ${JSON.stringify({ priceRules, adjustRules, query, unit })}`;
      assert.equal(segment.priceRule, selected, `${context}：命中的价格规则`);
      if (selected === null) {
        assert.equal(segment.price, null);
        assert.ok(segment.noPriceReason !== null && segment.noPriceReason !== "NOT_POSITIVE");
        assert.equal(segments.length, 1, `${context}：没有价格的一天不分段`);
        break;
      }
      const got = segment.price?.adjusts ?? [];
      assert.ok(got.length === matched.length && got.every((entry, index) => entry.rule === matched[index]), `${context}：命中的调价规则和顺序`);
      const expected = oracleFinal(oracleBase(selected.pricing, 0, 0, selected.packageHours), matched, unit);
      if (expected.final !== null && !Number.isSafeInteger(expected.final)) continue;
      assert.equal(segment.price?.finalMinor ?? null, expected.final, `${context}：结算价`);
      assert.equal(segment.noPriceReason, expected.final === null ? "NOT_POSITIVE" : null);
      if (expected.final === null) notPositive += 1;
      else priced += 1;
    }
    // 抽几个分钟直接问 tripPrice（报价引擎以后走的入口），应当和日历那一段一样
    for (const minute of [0, 359, 360, 1319, 1320, 1439, int(r, 0, 1439)]) {
      const direct = tripPrice({ priceRules, adjustRules, query, minuteOfDay: minute, roundingUnit: unit, holidays: lookup });
      const segment = segments.find((entry) => entry.fromMinute <= minute && minute < entry.toMinute);
      assert.equal(direct.priceRule, segment?.priceRule);
      assert.equal(direct.price?.finalMinor ?? null, segment?.price?.finalMinor ?? null);
      assert.equal(direct.noPriceReason, segment?.noPriceReason);
    }
  }
  assert.ok(priced > 50_000 && notPositive > 1_000 && split > 60, `有价 ${priced} 分钟、不大于 0 ${notPositive} 分钟、一天分成几段的 ${split} 组`);
});

test("没有价格的原因：这个组合没有规则 NO_RULE、有但日期对不上 NOT_IN_EFFECT、对得上的那条停用 RULE_DISABLED、调完不大于 0 NOT_POSITIVE", () => {
  const rule: PriceRule = { areaId: "a1", vehicleGroupId: "g1", direction: "pickup", packageHours: null, pricing: { model: "fixed", basePriceMinor: 1_000 }, validFrom: "2026-10-10", validTo: "2026-10-20", status: "enabled" };
  const ask = (priceRules: PriceRule[], date: string, adjustRules: AdjustRule[] = [], direction: "pickup" | "dropoff" = "pickup") => tripPrice({ priceRules, adjustRules, query: { areaId: "a1", vehicleGroupId: "g1", direction, packageHours: null, date }, minuteOfDay: 600, roundingUnit: 1 }).noPriceReason;
  assert.equal(ask([], "2026-10-15"), "NO_RULE");
  assert.equal(ask([rule], "2026-10-15", [], "dropoff"), "NO_RULE");
  assert.equal(ask([rule], "2026-10-21"), "NOT_IN_EFFECT");
  assert.equal(ask([{ ...rule, status: "disabled" }], "2026-10-15"), "RULE_DISABLED");
  assert.equal(ask([rule], "2026-10-15"), null);
  const drop: AdjustRule = { name: "减", travelFrom: null, travelTo: null, cycle: { type: "daily" }, timeSlot: null, areaIds: [], vehicleGroupIds: [], directions: [], packageHours: [], steps: [{ type: "amount", value: -1_000 }], status: "enabled" };
  assert.equal(ask([rule], "2026-10-15", [drop]), "NOT_POSITIVE");
  assert.equal(ask([rule], "2026-10-15", [{ ...drop, steps: [{ type: "amount", value: -999 }] }]), null);
});

test("顺序即优先级：同样两条规则换个先后，结果不同（先 +20% 再 −1000 ≠ 先 −1000 再 +20%）；停用的那条不参与", () => {
  const price: PriceRule = { areaId: "a1", vehicleGroupId: "g1", direction: null, packageHours: null, pricing: { model: "fixed", basePriceMinor: 20_000 }, validFrom: "2026-01-01", validTo: null, status: "enabled" };
  const make = (name: string, steps: AdjustStep[], status: "enabled" | "disabled" = "enabled"): AdjustRule => ({ name, travelFrom: null, travelTo: null, cycle: { type: "daily" }, timeSlot: null, areaIds: [], vehicleGroupIds: [], directions: [], packageHours: [], steps, status });
  const up = make("涨", [{ type: "percent", value: 2_000 }]);
  const off = make("减", [{ type: "amount", value: -1_000 }]);
  const ask = (adjustRules: AdjustRule[]): number | null => tripPrice({ priceRules: [price], adjustRules, query: { areaId: "a1", vehicleGroupId: "g1", direction: null, packageHours: null, date: "2026-10-09" }, minuteOfDay: 0, roundingUnit: 1 }).price?.finalMinor ?? null;
  assert.equal(ask([up, off]), 23_000);
  assert.equal(ask([off, up]), 22_800);
  assert.equal(ask([{ ...up, status: "disabled" }, off]), 19_000);
});

test("「调完不大于 0」的判断：正好调到 0 算、调到 1 个最小单位不算；里程 + 时长按起步价或最低消费中较高的那个算；只看碰得到的价格", () => {
  const price = (pricing: Pricing, extra: Partial<PriceRule> = {}): PriceRule => ({ areaId: "a1", vehicleGroupId: "g1", direction: "pickup", packageHours: null, pricing, validFrom: "2026-01-01", validTo: null, status: "enabled", ...extra });
  const rule = (steps: AdjustStep[], extra: Partial<AdjustRule> = {}) => ({ steps, areaIds: [], vehicleGroupIds: [], directions: [], packageHours: [], ...extra });
  const prices = [price({ model: "fixed", basePriceMinor: 1_000 }), price({ model: "mileage_time", startPriceMinor: 500, startMeters: 0, startMinutes: 0, perKmMinor: 100, perMinuteMinor: 0, minPriceMinor: 1_200 }, { areaId: "a2" }), price({ model: "fixed", basePriceMinor: 3_000 }, { direction: "dropoff" })];
  assert.deepEqual(adjustRuleNonPositivePrices(rule([{ type: "amount", value: -1_000 }]), prices), [0]);
  assert.deepEqual(adjustRuleNonPositivePrices(rule([{ type: "amount", value: -999 }]), prices), []);
  assert.deepEqual(adjustRuleNonPositivePrices(rule([{ type: "amount", value: -1_200 }]), prices), [0, 1]);
  assert.deepEqual(adjustRuleNonPositivePrices(rule([{ type: "amount", value: -1_199 }]), prices), [0]);
  assert.deepEqual(adjustRuleNonPositivePrices(rule([{ type: "amount", value: -5_000 }], { directions: ["dropoff"] }), prices), [2]);
  assert.deepEqual(adjustRuleNonPositivePrices(rule([{ type: "amount", value: -5_000 }], { areaIds: ["a2"] }), prices), [1]);
  // 先 −99.99% 再减 1：1000 × 0.0001 = 0.1，再 −1 → 负
  assert.deepEqual(adjustRuleNonPositivePrices(rule([{ type: "percent", value: -9_999 }]), prices), []);
  assert.deepEqual(adjustRuleNonPositivePrices(rule([{ type: "percent", value: -9_999 }, { type: "amount", value: -1 }]), prices), [0, 1, 2]);
});

// ───────────── 唯一性 ─────────────

test("日期重叠：3,000 组随机规则和「逐天比较」的笨办法一致（相邻、包含、开放结束、同一天、不同组合、停用的也算）", () => {
  const r = rng(808);
  type Slim = { areaId: string; vehicleGroupId: string; direction: "pickup" | "dropoff" | "both" | null; packageHours: number | null; validFrom: string; validTo: string | null };
  const FAR = DAY0 + 400;
  for (let i = 0; i < 3_000; i += 1) {
    const rules: Slim[] = Array.from({ length: int(r, 0, 8) }, () => {
      const from = DAY0 + int(r, 0, 12);
      return { areaId: pick(r, ["a1", "a2"]), vehicleGroupId: "g1", direction: pick(r, ["pickup", "both", null] as const), packageHours: pick(r, [null, 8]), validFrom: dateOf(from), validTo: r() < 0.3 ? null : dateOf(from + int(r, 0, 6)) };
    });
    const expected: [number, number][] = [];
    for (let a = 0; a < rules.length; a += 1) {
      for (let b = a + 1; b < rules.length; b += 1) {
        const [x, y] = [rules[a] as Slim, rules[b] as Slim];
        if (x.areaId !== y.areaId || x.direction !== y.direction || x.packageHours !== y.packageHours) continue;
        const days = (rule: Slim): Set<number> => {
          const out = new Set<number>();
          for (let day = dayNumber(rule.validFrom); day <= (rule.validTo === null ? FAR : dayNumber(rule.validTo)); day += 1) out.add(day);
          return out;
        };
        const mine = days(x);
        if ([...days(y)].some((day) => mine.has(day))) expected.push([a, b]);
      }
    }
    assert.deepEqual(findPriceRuleOverlaps(rules), expected, `第 ${i} 组 ${JSON.stringify(rules)}`);
  }
});

test("日期重叠的口径：到 03-31 和从 03-31 重叠、到 03-31 和从 04-01 不重叠；同一天的两条重叠；开放结束和它之后任何一段重叠、和它之前结束的不重叠；接送通用和接机是不同的组合", () => {
  const rule = (validFrom: string, validTo: string | null, direction: "pickup" | "dropoff" | "both" = "pickup") => ({ areaId: "a", vehicleGroupId: "g", direction, packageHours: null, validFrom, validTo });
  const overlap = (...rules: ReturnType<typeof rule>[]): [number, number][] => findPriceRuleOverlaps(rules);
  assert.deepEqual(overlap(rule("2026-01-01", "2026-03-31"), rule("2026-03-31", "2026-06-30")), [[0, 1]]);
  assert.deepEqual(overlap(rule("2026-01-01", "2026-03-31"), rule("2026-04-01", "2026-06-30")), []);
  assert.deepEqual(overlap(rule("2026-04-01", "2026-06-30"), rule("2026-01-01", "2026-03-31")), []);
  assert.deepEqual(overlap(rule("2026-05-05", "2026-05-05"), rule("2026-05-05", "2026-05-05")), [[0, 1]]);
  assert.deepEqual(overlap(rule("2026-01-01", "2026-12-31"), rule("2026-05-05", "2026-05-05")), [[0, 1]]);
  assert.deepEqual(overlap(rule("2026-04-01", null), rule("2030-01-01", "2030-01-02")), [[0, 1]]);
  assert.deepEqual(overlap(rule("2026-04-01", null), rule("2026-01-01", "2026-03-31")), []);
  assert.deepEqual(overlap(rule("2026-04-01", null), rule("2026-01-01", "2026-04-01")), [[0, 1]]);
  assert.deepEqual(overlap(rule("2026-04-01", null), rule("2027-01-01", null)), [[0, 1]]);
  assert.deepEqual(overlap(rule("2026-01-01", null, "both"), rule("2026-01-01", null, "pickup"), rule("2026-01-01", null, "dropoff")), []);
  // 跨月末、跨年、闰日相邻
  assert.deepEqual(overlap(rule("2027-12-01", "2027-12-31"), rule("2028-01-01", "2028-02-29"), rule("2028-03-01", null)), []);
  assert.deepEqual(overlap(rule("2027-12-01", "2028-01-01"), rule("2028-01-01", "2028-02-29"), rule("2028-02-29", null)), [[0, 1], [1, 2]]);
});

// ───────────── 静态扫描 ─────────────

test("静态扫描：计价、取整相关的业务代码里没有 parseFloat / toFixed / Math.round / 小数字面量，也没有调用 money.ts 里基于浮点数的函数", () => {
  const files = ["./pricing.ts", "../../../apps/api/src/services/prices.ts", "../../../apps/api/src/routes/prices.ts", "../../../apps/api/src/repos/prices.ts", "../../../apps/web/src/lib/price-form.ts", "../../../apps/web/src/lib/adjust-form.ts", "../../../apps/web/src/lib/price-calendar.ts"];
  const found: string[] = [];
  for (const file of files) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    // 去掉注释和字符串、模板、正则（里面的「0.5」「1.5」是说明文字）
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/`(?:\\.|[^`\\])*`/g, "``")
      .replace(/"(?:\\.|[^"\\])*"/g, '""')
      .replace(/\s\/\/ .*$/gm, "");
    for (const [index, line] of code.split("\n").entries()) {
      if (/parseFloat|toFixed|Math\.round|Math\.ceil|toPrecision|Number\.EPSILON/.test(line)) found.push(`${file}:${index + 1} ${line.trim()}`);
      if (/(^|[^\w.])\d+\.\d+(?!\w)/.test(line.replace(/\/[^/\n]+\/[gimsuy]*/g, ""))) found.push(`${file}:${index + 1} 小数字面量 ${line.trim()}`);
      if (/\b(applyBasisPoints|portionBasisPoints|roundHalfAwayFromZero|roundToUnit)\(/.test(line)) found.push(`${file}:${index + 1} 基于浮点数的函数 ${line.trim()}`);
    }
  }
  assert.deepEqual(found, []);
});
