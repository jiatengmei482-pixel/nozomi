/**
 * M2-06 测试角色补充：汇率人工锁定的纯计算部分，和一套独立的 BigInt 对照实现比对（不复用 fx.ts 的分数函数）。
 * - 锁定值解析：各种「看起来像数字」的写法（全角数字、换行、下划线、十六进制……）一律不收；规范化只在字符串上做；
 * - 偏离：基点四舍五入（0.5 远离零，正负对称）、门槛严格大于，用对照实现在大量随机值上比；
 * - 交叉汇率：一边 / 两边锁定、和基准之间，随机数据上和对照实现逐位一致（12 位小数、0.5 远离零）；
 * - 到期边界、同一币种重复的锁定、锁定 USD 的数据被忽略；锁定期间 48 小时规则与 `fxQuoteUsable` 一致。
 * 测试数据只在这里构造。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { FX_LOCK_RULES, type FxLock, fxLockActive, fxLockApplyIssues, fxLockRequestIssues, fxQuoteWithLocks, lockDeviation, parseLockRate } from "./fx-lock.ts";
import type { FxTable } from "./fx.ts";
import type { CurrencyCode } from "./money.ts";
import { fxQuoteUsable } from "./quote.ts";

// ---- 独立的对照实现：十进制字符串 ↔ BigInt 分数，四舍五入（0.5 远离零） ----

interface Frac {
  n: bigint;
  d: bigint;
}
function dec(text: string): Frac {
  const [w = "0", f = ""] = text.split(".");
  return { n: BigInt(w + f), d: 10n ** BigInt(f.length) };
}
/** n/d 四舍五入到整数，0.5 远离零（d > 0）。 */
function roundHalfAway(n: bigint, d: bigint): bigint {
  const neg = n < 0n;
  const a = neg ? -n : n;
  const q = a / d;
  const r = a % d;
  const out = r * 2n >= d ? q + 1n : q;
  return neg ? -out : out;
}
function toDecimal12(f: Frac): string | null {
  const scaled = roundHalfAway(f.n * 10n ** 12n, f.d);
  if (scaled <= 0n) return null;
  const s = scaled.toString().padStart(13, "0");
  const w = s.slice(0, -12);
  const fr = s.slice(-12).replace(/0+$/, "");
  if (w.length > 12) return null;
  return fr === "" ? w : `${w}.${fr}`;
}
/** 1 from = ? to，给的是「1 USD = ?」 */
function oracleCross(perUsd: Record<string, string>, from: string, to: string): string | null {
  const f = from === "USD" ? { n: 1n, d: 1n } : dec(perUsd[from] as string);
  const t = to === "USD" ? { n: 1n, d: 1n } : dec(perUsd[to] as string);
  return toDecimal12({ n: t.n * f.d, d: t.d * f.n });
}
function oracleDeviation(central: string, locked: string): { bp: number; needsReason: boolean; tooLarge: boolean } {
  const c = dec(central);
  const l = dec(locked);
  // (l/c − 1) × 10000 = (l.n·c.d − c.n·l.d)·10000 / (l.d·c.n)
  const num = (l.n * c.d - c.n * l.d) * 10_000n;
  const den = l.d * c.n;
  const abs = num < 0n ? -num : num;
  return { bp: Number(roundHalfAway(num, den)), needsReason: abs > 300n * den, tooLarge: abs > 2_000n * den };
}

// ---- 确定性的随机数（可复现） ----
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1_664_525 + 1_013_904_223) >>> 0;
    return s / 2 ** 32;
  };
}
function randomRate(next: () => number): string {
  const intDigits = 1 + Math.floor(next() * 5);
  const fracDigits = Math.floor(next() * 13);
  let w = String(1 + Math.floor(next() * 9));
  for (let i = 1; i < intDigits; i += 1) w += String(Math.floor(next() * 10));
  let f = "";
  for (let i = 0; i < fracDigits; i += 1) f += String(Math.floor(next() * 10));
  f = f.replace(/0+$/, "");
  return f === "" ? w : `${w}.${f}`;
}

const NOW = new Date("2026-10-07T12:00:00.000Z");
const IN_24H = new Date(NOW.getTime() + 24 * 3_600_000).toISOString();
const CURRENCIES: CurrencyCode[] = ["USD", "JPY", "CNY", "KRW", "HKD", "TWD", "THB"];
const LOCKABLE: CurrencyCode[] = ["JPY", "CNY", "KRW", "HKD", "TWD", "THB"];
const lock = (currency: CurrencyCode, rate: string, expiresAt = IN_24H, id = `qa-${currency}`): FxLock => ({ id, currency, rate, expiresAt });

test("锁定值解析：全角数字、换行、下划线、十六进制、多个小数点、前导加号、unicode 空白都不收；前导零和末尾零只在字符串上规范", () => {
  const rejected = ["１５１.２", "151.2\n", "\n151.2", "151.2 ", "1_000", "0x10", "0b1", "1.2.3", "+1", "1e3", "1E3", "151,2", "١٥١", "151 ", "∞", "0.", "00", "0.000000000000", "-0", "1/2", "151.2a"];
  for (const text of rejected) assert.equal(parseLockRate(text), null, JSON.stringify(text));
  // 前导零不算进整数位数、末尾零不算进小数位数
  assert.equal(parseLockRate(`${"0".repeat(20)}151.2${"0".repeat(20)}`), "151.2");
  assert.equal(parseLockRate("000000000000999999999999.000000000001"), "999999999999.000000000001");
  assert.equal(parseLockRate("1.0000000000001"), null, "13 位有效小数");
  assert.equal(parseLockRate("1.0000000000010"), "1.000000000001", "末尾零去掉后 12 位");
  // 浮点数会走样的值原样保留
  assert.equal(parseLockRate("0.30000000000"), "0.3");
  assert.equal(parseLockRate("9007199254.740993"), "9007199254.740993", "超过 2^53 的有效数字不被截断");
  assert.equal(parseLockRate("123456789012.123456789012"), "123456789012.123456789012");
});

test("偏离：基点四舍五入正负对称（0.5 远离零），门槛严格大于；和对照实现在 2000 组随机值上完全一致", () => {
  // 精确的半基点：150 → 150.0075 是 +0.5bp → 1；150 → 149.9925 是 -0.5bp → -1
  assert.equal(lockDeviation("150", "150.0075").changeBp, 1);
  assert.equal(lockDeviation("150", "149.9925").changeBp, -1);
  assert.equal(lockDeviation("150", "150.00749999").changeBp, 0);
  // 正好 3%（-3%）不用原因；刚过一点点要原因——两个方向
  assert.equal(lockDeviation("7.2", "7.416").needsReason, false);
  assert.equal(lockDeviation("7.2", "7.416000000001").needsReason, true);
  assert.equal(lockDeviation("7.2", "6.984").needsReason, false);
  assert.equal(lockDeviation("7.2", "6.983999999999").needsReason, true);
  // 偏离用锁定值 / 中央汇率算（不是倒过来）：1400 → 1680 正好 +20% 允许；1400 → 1120 正好 −20% 允许
  assert.equal(lockDeviation("1400", "1680").tooLarge, false);
  assert.equal(lockDeviation("1400", "1120").tooLarge, false);
  assert.equal(lockDeviation("1400", "1119.999999999999").tooLarge, true);
  const next = rng(20261018);
  for (let i = 0; i < 2_000; i += 1) {
    const central = randomRate(next);
    // 锁定值在中央汇率附近 ±25% 之内随机（用整数挪动，保证覆盖门槛两侧）
    const c = dec(central);
    const factorBp = BigInt(Math.floor(next() * 5_000) - 2_500);
    const scaled = c.n * (10_000n + factorBp) * 10n ** 4n;
    const lockedFrac = { n: scaled + BigInt(Math.floor(next() * 3) - 1), d: c.d * 10n ** 8n };
    const locked = toDecimal12(lockedFrac);
    if (locked === null || parseLockRate(locked) === null) continue;
    const got = lockDeviation(central, locked);
    const want = oracleDeviation(central, locked);
    assert.deepEqual([got.changeBp, got.needsReason, got.tooLarge], [want.bp, want.needsReason, want.tooLarge], `${central} → ${locked}`);
  }
});

test("交叉汇率：随机的数据源汇率和随机的锁定组合，每一对币种的结果都和对照实现逐位一致；lock.legs / usesSource 正确", () => {
  const next = rng(4242);
  for (let round = 0; round < 300; round += 1) {
    const rates: Record<string, string> = {};
    for (const currency of LOCKABLE) rates[currency] = randomRate(next);
    const table: FxTable = { base: "USD", asOf: "2026-10-07T00:00:00.000Z", rates };
    const locks: FxLock[] = [];
    const effective: Record<string, string> = { ...rates };
    for (const currency of LOCKABLE) {
      if (next() < 0.35) {
        const value = randomRate(next);
        locks.push(lock(currency, value));
        effective[currency] = value;
      }
    }
    for (const from of CURRENCIES) {
      for (const to of CURRENCIES) {
        const quote = fxQuoteWithLocks(table, locks, from, to, NOW);
        if (from === to) {
          assert.equal(quote?.rate, "1");
          continue;
        }
        const want = oracleCross(effective, from, to);
        assert.equal(quote?.rate ?? null, want, `${JSON.stringify(effective)} ${from}→${to}`);
        if (quote === null) continue;
        const lockedLegs = [from, to].filter((currency) => locks.some((item) => item.currency === currency));
        if (lockedLegs.length === 0) {
          assert.equal(quote.lock, undefined);
        } else {
          assert.deepEqual(quote.lock?.legs.map((leg) => [leg.currency, leg.rate]), lockedLegs.map((currency) => [currency, effective[currency]]));
          const usesSource = [from, to].some((currency) => currency !== "USD" && !lockedLegs.includes(currency));
          assert.equal(quote.lock?.usesSource, usesSource, `${from}→${to}`);
        }
      }
    }
  }
});

test("交叉汇率的舍入边界：第 13 位正好是 5 时远离零进位，在锁定的一边和数据源的一边都一样", () => {
  // 1 USD = 8 JPY（锁定）、1 USD = 0.000000000004 KRW（数据源）：1 JPY = 0.0000000000005 KRW → 0.000000000001
  const table: FxTable = { base: "USD", asOf: "2026-10-07T00:00:00.000Z", rates: { JPY: "150", KRW: "0.000000000004" } };
  assert.equal(fxQuoteWithLocks(table, [lock("JPY", "8")], "JPY", "KRW", NOW)?.rate, "0.000000000001");
  // 1 USD = 3 CNY（锁定）：1 CNY = 0.333333333333…（第 13 位是 3，舍）；1 CNY → 2 USD 方向：1 USD = 3 → 2/3 = 0.666666666667
  const t2: FxTable = { base: "USD", asOf: table.asOf, rates: { CNY: "7.2", JPY: "2" } };
  assert.equal(fxQuoteWithLocks(t2, [lock("CNY", "3")], "CNY", "USD", NOW)?.rate, "0.333333333333");
  assert.equal(fxQuoteWithLocks(t2, [lock("CNY", "3")], "CNY", "JPY", NOW)?.rate, "0.666666666667");
  // 结果超过 12 位整数（报价引擎认不了）：返回 null，而不是给一个截断的数
  const t3: FxTable = { base: "USD", asOf: table.asOf, rates: { KRW: "999999999999", JPY: "150" } };
  assert.equal(fxQuoteWithLocks(t3, [lock("JPY", "0.000000000001")], "JPY", "KRW", NOW), null);
});

test("锁定列表里的异常数据：同一币种两条只用第一条；USD 的锁定被忽略；已到期的被忽略、另一条未到期的照用", () => {
  const table: FxTable = { base: "USD", asOf: "2026-10-07T00:00:00.000Z", rates: { JPY: "150", CNY: "7.2" } };
  const twice = fxQuoteWithLocks(table, [lock("JPY", "151.2", IN_24H, "first"), lock("JPY", "160", IN_24H, "second")], "USD", "JPY", NOW);
  assert.deepEqual([twice?.rate, twice?.lock?.legs.map((leg) => leg.lockId)], ["151.2", ["first"]]);
  const usd = fxQuoteWithLocks(table, [lock("USD", "2")], "USD", "JPY", NOW);
  assert.deepEqual([usd?.rate, usd?.lock], ["150", undefined]);
  const mixed = fxQuoteWithLocks(table, [lock("JPY", "160", NOW.toISOString(), "expired"), lock("JPY", "151.2", IN_24H, "live")], "USD", "JPY", NOW);
  assert.deepEqual([mixed?.rate, mixed?.lock?.legs[0]?.lockId], ["151.2", "live"]);
});

test("到期边界精确到毫秒：差 1 毫秒还用，到点那一刻不用；fxQuoteUsable 和 fxLockActive 一致；时区写法不同的同一时刻结果相同", () => {
  const table: FxTable = { base: "USD", asOf: NOW.toISOString(), rates: { JPY: "150", CNY: "7.2" } };
  const tokyo = "2026-10-08T21:00:00.000+09:00"; // = 2026-10-08T12:00:00Z
  const expiry = new Date("2026-10-08T12:00:00.000Z");
  const l = lock("JPY", "151.2", tokyo);
  const before = new Date(expiry.getTime() - 1);
  assert.equal(fxLockActive(l, before), true);
  assert.equal(fxLockActive(l, expiry), false);
  const q = fxQuoteWithLocks(table, [l], "CNY", "JPY", before);
  assert.ok(q?.lock);
  assert.equal(fxQuoteUsable(q, before), true);
  assert.equal(fxQuoteUsable(q, expiry), false, "快照里带着的锁定到期了，即使数据源还新也不能再用这份");
  assert.equal(fxQuoteWithLocks(table, [l], "CNY", "JPY", expiry)?.lock, undefined);
  // 跨午夜、跨月：到期时刻在月末 23:59:59.999Z，下个月第一毫秒不再用
  const monthEnd = lock("JPY", "151.2", "2026-10-31T23:59:59.999Z");
  assert.equal(fxLockActive(monthEnd, new Date("2026-10-31T23:59:59.998Z")), true);
  assert.equal(fxLockActive(monthEnd, new Date("2026-10-31T23:59:59.999Z")), false);
  assert.equal(fxLockActive(monthEnd, new Date("2026-11-01T00:00:00.000Z")), false);
});

test("锁定期间的 48 小时规则：只涉及锁定币种和 USD 的不看取数时间；另一边用数据源的照看；取数时间在未来太远（钟错）照样拒", () => {
  const asOf = "2026-10-01T00:00:00.000Z";
  const table: FxTable = { base: "USD", asOf, rates: { JPY: "150", CNY: "7.2" } };
  const longAfter = new Date("2026-10-04T00:00:00.000Z"); // 72 小时后：数据源已过期
  const l = lock("JPY", "151.2", "2026-10-04T00:00:00.001Z");
  const usdJpy = fxQuoteWithLocks(table, [l], "JPY", "USD", longAfter);
  const cnyJpy = fxQuoteWithLocks(table, [l], "CNY", "JPY", longAfter);
  assert.ok(usdJpy && cnyJpy);
  assert.equal(fxQuoteUsable(usdJpy, longAfter), true);
  assert.equal(fxQuoteUsable(cnyJpy, longAfter), false);
  // 正好 48 小时那一刻：另一边还在用数据源的，和没有锁定时的判断一致
  const at48 = new Date(new Date(asOf).getTime() + 48 * 3_600_000);
  const plain = fxQuoteWithLocks(table, [], "CNY", "JPY", at48);
  const half = fxQuoteWithLocks(table, [lock("JPY", "151.2", "2026-10-05T00:00:00.000Z")], "CNY", "JPY", at48);
  assert.ok(plain && half);
  assert.equal(fxQuoteUsable(half, at48), fxQuoteUsable(plain, at48));
  // 数据源的时间写成了很远的将来（钟错）：另一边用数据源的照样拒
  const future: FxTable = { ...table, asOf: "2027-01-01T00:00:00.000Z" };
  const skew = fxQuoteWithLocks(future, [lock("JPY", "151.2", "2026-10-02T00:00:00.000Z")], "CNY", "JPY", new Date("2026-10-01T01:00:00.000Z"));
  assert.ok(skew);
  assert.equal(fxQuoteUsable(skew, new Date("2026-10-01T01:00:00.000Z")), false);
});

test("发起与批准的校验：门槛两侧用同一套精确比较；批准时的中央汇率变了按新的算；到期时间正好是批准那一刻不能生效、差 1 毫秒可以", () => {
  const base = { currency: "CNY", rate: "7.416", expiresAt: new Date(NOW.getTime() + 3_600_000), reason: null };
  assert.deepEqual(fxLockRequestIssues(base, "7.2", NOW).issues, []);
  assert.deepEqual(fxLockRequestIssues({ ...base, rate: "7.416000000001" }, "7.2", NOW).issues.map((issue) => issue.reason), ["REASON_REQUIRED"]);
  // 原因只有全角空格、换行、制表符：不算写了原因
  for (const reason of ["　", "\n\t", "  　 "]) assert.deepEqual(fxLockRequestIssues({ ...base, rate: "7.5", reason }, "7.2", NOW).issues.map((issue) => issue.reason), ["REASON_REQUIRED"], JSON.stringify(reason));
  // 偏离超过 20% 时只报「不允许」，不再叠一条「要原因」
  assert.deepEqual(fxLockRequestIssues({ ...base, rate: "9" }, "7.2", NOW).issues.map((issue) => issue.reason), ["DEVIATION_TOO_LARGE"]);
  // 批准时：发起时 +3%（不用原因），中央汇率之后跌到 7.1 → 偏离 +4.45%，要原因
  const apply = { currency: "CNY" as const, rate: "7.416", expiresAt: base.expiresAt, reason: null };
  assert.deepEqual(fxLockApplyIssues(apply, "7.2", NOW), []);
  assert.deepEqual(fxLockApplyIssues(apply, "7.1", NOW).map((issue) => issue.reason), ["REASON_REQUIRED"]);
  // 中央汇率跌到 6.18 → 正好 +20% 还允许；跌到 6.17 → +20.19%，拦截（即使有原因）
  assert.deepEqual(fxLockApplyIssues({ ...apply, reason: "x" }, "6.18", NOW), []);
  assert.deepEqual(fxLockApplyIssues({ ...apply, reason: "x" }, "6.17", NOW).map((issue) => issue.reason), ["DEVIATION_TOO_LARGE"]);
  assert.deepEqual(fxLockApplyIssues(apply, "7.2", base.expiresAt).map((issue) => issue.reason), ["EXPIRES_TOO_SOON"]);
  assert.deepEqual(fxLockApplyIssues(apply, "7.2", new Date(base.expiresAt.getTime() - 1)), []);
  // 规则常量和 ADR 一致
  assert.deepEqual([FX_LOCK_RULES.maxHours, FX_LOCK_RULES.minMinutes, FX_LOCK_RULES.reasonAboveBp, FX_LOCK_RULES.maxDeviationBp], [72, 30, 300, 2_000]);
});
