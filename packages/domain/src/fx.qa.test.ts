/**
 * 汇率中心纯计算部分的测试角色补充（M2-03）：
 * - 数字原文 → 规范十进制：和独立的 BigInt 实现（尾数 × 10^指数）在随机写法上逐个比对；
 * - 交叉汇率：和独立的 BigInt 分数实现在随机汇率上比对（12 位小数，0.5 远离零），并确认报价引擎认得每一个结果；
 * - 12 位小数的舍入边界、超大 / 超小交叉汇率；
 * - 3% 跳变的精确边界（上涨、下跌、长小数）；
 * - 48 小时、5 分钟钟差、5 分钟中断、15 分钟重试、12 小时上限这些时间边界；带时区偏移的写法。
 * 汇率都是测试里现场构造的数，不是业务数据。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { FX_RULES, type FxTable, crossRate, findRateJumps, formatRate, fxFetchAbandoned, fxQuoteFromTable, fxStaleAt, fxTableState, nextFxFetchAt, parseRateText, rateToFraction } from "./fx.ts";
import { rateFraction } from "./quote.ts";
import type { CurrencyCode } from "./money.ts";

/** 可复现的伪随机数（不用 Math.random，失败时能按种子重放）。 */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
}
const pick = (next: () => number, n: number): number => Math.floor(next() * n);
function digits(next: () => number, length: number, leadingNonZero: boolean): string {
  let text = "";
  for (let i = 0; i < length; i += 1) text += String(i === 0 && leadingNonZero ? 1 + pick(next, 9) : pick(next, 10));
  return text;
}

/** 独立实现：JSON 数字原文 → 尾数（BigInt）× 10^指数 → 规范十进制；位数超限、不是正数返回 null。 */
function oracleRateText(text: string): string | null {
  const match = /^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!match) return null;
  const mantissa = BigInt(`${match[1]}${match[2] ?? ""}`);
  const exponent = BigInt(match[3] ?? "0") - BigInt((match[2] ?? "").length);
  if (mantissa === 0n) return null;
  let whole: bigint;
  let fraction: string;
  if (exponent >= 0n) {
    whole = mantissa * 10n ** exponent;
    fraction = "";
  } else {
    const scale = 10n ** -exponent;
    whole = mantissa / scale;
    fraction = (mantissa % scale).toString().padStart(Number(-exponent), "0").replace(/0+$/, "");
  }
  const wholeText = whole.toString();
  if (wholeText.length > FX_RULES.maxIntegerDigits || fraction.length > FX_RULES.maxFractionDigits) return null;
  return fraction === "" ? wholeText : `${wholeText}.${fraction}`;
}

/** 独立实现：分数 → 四舍五入（0.5 远离零，这里只有正数）到 12 位小数的十进制；0 或整数部分超过 12 位返回 null。 */
function oracleRound12(numerator: bigint, denominator: bigint): string | null {
  const scaled = (numerator * 10n ** 12n * 2n + denominator) / (2n * denominator);
  if (scaled === 0n) return null;
  const whole = scaled / 10n ** 12n;
  const fraction = (scaled % 10n ** 12n).toString().padStart(12, "0").replace(/0+$/, "");
  if (whole.toString().length > 12) return null;
  return fraction === "" ? whole.toString() : `${whole}.${fraction}`;
}

function oracleFraction(rate: string): [bigint, bigint] {
  const [whole = "0", fraction = ""] = rate.split(".");
  return [BigInt(`${whole}${fraction}`), 10n ** BigInt(fraction.length)];
}

test("随机写法（整数、长小数、指数、前导 0 的小数）：parseRateText 和独立的 BigInt 实现逐个一致", () => {
  const next = rng(20261016);
  for (let i = 0; i < 20_000; i += 1) {
    const wholeLength = pick(next, 4) === 0 ? 0 : 1 + pick(next, 18);
    const whole = wholeLength === 0 ? "0" : digits(next, wholeLength, true);
    const fraction = pick(next, 3) === 0 ? "" : `.${digits(next, 1 + pick(next, 24), false)}`;
    const exponentKind = pick(next, 4);
    const exponent = exponentKind === 0 ? "" : `${pick(next, 2) === 0 ? "e" : "E"}${["", "+", "-"][pick(next, 3)]}${pick(next, 45)}`;
    const text = `${whole}${fraction}${exponent}`;
    // 只比对 JSON 认的写法（数据源给的一定是 JSON 数字）
    JSON.parse(text);
    const expected = Math.abs(Number(/[eE]([+-]?\d+)$/.exec(text)?.[1] ?? "0")) > 40 ? null : oracleRateText(text);
    assert.equal(parseRateText(text), expected, text);
  }
});

test("数字原文的边界：15 位整数、18 位小数正好收；多 1 位拒收；尾随的 0 不算位数；指数写法的大数和小数", () => {
  const cases: [string, string | null][] = [
    ["999999999999999", "999999999999999"],
    ["9999999999999999", null],
    ["9.99999999999999e14", "999999999999999"],
    ["1e14", "100000000000000"],
    ["1e15", null],
    ["0.000000000000000001", "0.000000000000000001"],
    ["1e-18", "0.000000000000000001"],
    ["1e-19", null],
    ["10e-19", "0.000000000000000001"],
    ["150.000000000000000000000000000000", "150"],
    ["1500000000000000000000e-19", "150"],
    ["0.0000000000000000000000150e24", "15"],
    ["1E0", "1"],
    ["1e+0", "1"],
    ["1e-0", "1"],
    ["00001", "1"],
    ["-0", null],
    ["-0.5", null],
    ["1e-5", "0.00001"],
    ["1.7976931348623157e308", null],
    ["5e-324", null],
  ];
  for (const [text, expected] of cases) assert.equal(parseRateText(text), expected, text);
});

test("随机汇率表：交叉汇率（12 位小数）和独立的 BigInt 分数实现逐个一致，报价引擎的 rateFraction 认得每一个结果", () => {
  const next = rng(4_242);
  const currencies: CurrencyCode[] = ["USD", "JPY", "CNY", "KRW", "HKD", "TWD", "THB"];
  const randomRate = (): string => {
    const whole = pick(next, 3) === 0 ? "0" : digits(next, 1 + pick(next, 6), true);
    const fraction = digits(next, pick(next, 12), false).replace(/0+$/, "");
    const text = fraction === "" ? whole : `${whole}.${fraction}`;
    return /^0(\.0*)?$/.test(text) ? "0.5" : text;
  };
  for (let i = 0; i < 3_000; i += 1) {
    const rates: Partial<Record<CurrencyCode, string>> = {};
    for (const currency of currencies) if (currency !== "USD") rates[currency] = randomRate();
    const table: FxTable = { base: "USD", asOf: "2026-10-07T00:00:00.000Z", rates };
    const from = currencies[pick(next, currencies.length)] as CurrencyCode;
    const to = currencies[pick(next, currencies.length)] as CurrencyCode;
    const quote = fxQuoteFromTable(table, from, to);
    if (from === to) {
      assert.deepEqual(quote, { from, to, rate: "1", asOf: table.asOf });
      continue;
    }
    const [fromNum, fromDen] = from === "USD" ? [1n, 1n] : oracleFraction(rates[from] as string);
    const [toNum, toDen] = to === "USD" ? [1n, 1n] : oracleFraction(rates[to] as string);
    const expected = oracleRound12(toNum * fromDen, toDen * fromNum);
    assert.equal(quote?.rate ?? null, expected, `${from}→${to} ${JSON.stringify(rates)}`);
    if (quote !== null) {
      assert.notEqual(rateFraction(quote.rate), null, `报价引擎认得 ${quote.rate}`);
      assert.doesNotMatch(quote.rate, /e|E|^0\d|\.\d*0$/, "规范的十进制写法");
    }
  }
});

test("12 位小数的舍入边界：正好 0.5 往上进，差一点就舍；舍成 0 的、整数部分超过 12 位的不给", () => {
  const usd = (rates: Partial<Record<CurrencyCode, string>>): FxTable => ({ base: "USD", asOf: "2026-10-07T00:00:00.000Z", rates });
  // 1 JPY = CNY / JPY；CNY = 0.000000000001（1e-12），JPY = 2：0.5e-12 → 进位到 1e-12
  assert.equal(fxQuoteFromTable(usd({ JPY: "2", CNY: "0.000000000001" }), "JPY", "CNY")?.rate, "0.000000000001");
  // 1.5e-12 → 2e-12；2.5e-12 → 3e-12（远离零，不是银行家舍入）
  assert.equal(fxQuoteFromTable(usd({ JPY: "2", CNY: "0.000000000003" }), "JPY", "CNY")?.rate, "0.000000000002");
  assert.equal(fxQuoteFromTable(usd({ JPY: "2", CNY: "0.000000000005" }), "JPY", "CNY")?.rate, "0.000000000003");
  // 差一点点不到 0.5e-12：舍成 0 → 不给
  assert.equal(fxQuoteFromTable(usd({ JPY: "2", CNY: "0.000000000000999999" }), "JPY", "CNY"), null);
  // 0.4999…e-12 + 进位刚好到第 12 位的 9 → 进到整数
  assert.equal(formatRate({ numerator: 19_999_999_999_995n, denominator: 10n ** 13n }), "2");
  assert.equal(formatRate({ numerator: 19_999_999_999_994n, denominator: 10n ** 13n }), "1.999999999999");
  // 整数部分 12 位正好收、13 位不给（报价引擎认不了）
  assert.equal(formatRate({ numerator: 999_999_999_999n, denominator: 1n }), "999999999999");
  assert.equal(formatRate({ numerator: 9_999_999_999_999_999_999_999_995n, denominator: 10n ** 13n }), null, "999999999999.9999999999995 舍入后整数 13 位");
  assert.equal(fxQuoteFromTable(usd({ JPY: "0.000000000000000001", CNY: "999999999999999" }), "JPY", "CNY"), null);
  // 交叉汇率的精确值不丢：分子分母都是 BigInt
  const exact = crossRate(usd({ JPY: "149.123456789012345678", CNY: "7.000000000000000001" }), "CNY", "JPY");
  assert.deepEqual(exact, { numerator: 149_123_456_789_012_345_678n * 10n ** 18n, denominator: 10n ** 18n * 7_000_000_000_000_000_001n });
});

test("3% 的精确边界：涨跌正好 3% 不挂起，多一丁点就挂起；长小数也按精确分数比；只报超限的那个币种", () => {
  const base = { JPY: "150", CNY: "7.123456789", KRW: "1400", HKD: "7.8", TWD: "32", THB: "36" };
  const jumps = (next: Partial<Record<CurrencyCode, string>>): string[] => findRateJumps(base, { ...base, ...next }).map((jump) => `${jump.currency}:${jump.changeBp}`);
  assert.deepEqual(jumps({ JPY: "154.5" }), []);
  assert.deepEqual(jumps({ JPY: "154.500000000000000001" }), ["JPY:300"]);
  assert.deepEqual(jumps({ JPY: "145.5" }), []);
  assert.deepEqual(jumps({ JPY: "145.499999999999999999" }), ["JPY:-300"]);
  // 7.123456789 × 1.03 = 7.33716049267（精确）
  assert.deepEqual(jumps({ CNY: "7.33716049267" }), []);
  assert.deepEqual(jumps({ CNY: "7.337160492670000001" }), ["CNY:300"]);
  // 7.123456789 × 0.97 = 6.90975308533
  assert.deepEqual(jumps({ CNY: "6.90975308533" }), []);
  assert.deepEqual(jumps({ CNY: "6.909753085329999999" }), ["CNY:-300"]);
  // 多个币种里只有一个超限
  assert.deepEqual(jumps({ JPY: "154", KRW: "1440", THB: "40", HKD: "7.81" }), ["THB:1111"]);
  // 翻倍、腰斩这类极端变化
  assert.deepEqual(jumps({ KRW: "2800", HKD: "3.9" }), ["KRW:10000", "HKD:-5000"]);
});

test("48 小时从取数时间算：正好 48 小时 fresh，多 1 毫秒 stale；取数时间在未来 5 分钟内 fresh、超过 stale；带时区偏移的写法同一时刻同一结论", () => {
  const asOf = "2026-10-07T00:00:00.000Z";
  const t = (iso: string): Date => new Date(iso);
  assert.equal(fxTableState(asOf, t("2026-10-09T00:00:00.000Z")), "fresh");
  assert.equal(fxTableState(asOf, t("2026-10-09T00:00:00.001Z")), "stale");
  assert.equal(fxStaleAt(asOf).toISOString(), "2026-10-09T00:00:00.001Z");
  assert.equal(fxTableState(asOf, new Date(fxStaleAt(asOf).getTime() - 1)), "fresh");
  assert.equal(fxTableState(asOf, fxStaleAt(asOf)), "stale");
  // 跨月：10 月 31 日的汇率 11 月 2 日同一时刻还能用
  assert.equal(fxTableState("2026-10-31T23:30:00.000Z", t("2026-11-02T23:30:00.000Z")), "fresh");
  assert.equal(fxTableState("2026-10-31T23:30:00.000Z", t("2026-11-02T23:30:00.001Z")), "stale");
  // 数据源时间在未来（钟差）
  assert.equal(fxTableState("2026-10-07T00:05:00.000Z", t("2026-10-07T00:00:00.000Z")), "fresh");
  assert.equal(fxTableState("2026-10-07T00:05:00.001Z", t("2026-10-07T00:00:00.000Z")), "stale");
  // 东京时间写法和 UTC 写法是同一时刻
  assert.equal(fxTableState("2026-10-07T09:00:00.000+09:00", t("2026-10-09T00:00:00.000Z")), "fresh");
  assert.equal(fxTableState("2026-10-07T09:00:00.000+09:00", t("2026-10-09T00:00:00.001Z")), "stale");
  assert.equal(fxStaleAt("2026-10-07T09:00:00.000+09:00").toISOString(), "2026-10-09T00:00:00.001Z");
  // 不是时间的写法：不当成能用
  assert.equal(fxTableState("not-a-date", t("2026-10-07T00:00:00.000Z")), "stale");
});

test("中断与节奏的边界：正在拉正好 5 分钟不算中断、多 1 毫秒算；失败 / 拒收 15 分钟后重试；成功后不早于 15 分钟、不晚于 12 小时、没说下次时间就 1 小时", () => {
  const started = new Date("2026-10-07T00:00:00.000Z");
  const plus = (ms: number): Date => new Date(started.getTime() + ms);
  const minute = 60_000;
  assert.equal(fxFetchAbandoned({ status: "running", startedAt: started }, plus(5 * minute)), false);
  assert.equal(fxFetchAbandoned({ status: "running", startedAt: started }, plus(5 * minute + 1)), true);
  assert.equal(fxFetchAbandoned({ status: "accepted", startedAt: started }, plus(60 * minute)), false, "结束了的不算中断");
  assert.equal(nextFxFetchAt({ status: "running", startedAt: started, finishedAt: null, sourceNextUpdateAt: null }).toISOString(), plus(5 * minute + 1).toISOString());

  const finished = plus(10_000);
  const after = (ms: number): string => new Date(finished.getTime() + ms).toISOString();
  for (const status of ["failed", "rejected"] as const) {
    // 数据源说的下次时间不管用：失败一律 15 分钟后
    assert.equal(nextFxFetchAt({ status, startedAt: started, finishedAt: finished, sourceNextUpdateAt: plus(24 * 60 * minute) }).toISOString(), after(15 * minute), status);
  }
  for (const status of ["accepted", "unchanged", "held", "confirmed", "dismissed"] as const) {
    assert.equal(nextFxFetchAt({ status, startedAt: started, finishedAt: finished, sourceNextUpdateAt: null }).toISOString(), after(60 * minute), `${status} 没说下次时间`);
    // 数据源说的下次时间早就过了（数据源停更）：15 分钟后，不是每分钟
    assert.equal(nextFxFetchAt({ status, startedAt: started, finishedAt: finished, sourceNextUpdateAt: plus(-24 * 60 * minute) }).toISOString(), after(15 * minute), `${status} 下次时间已过`);
    // 下次时间在 2 小时后：再等 5 分钟
    assert.equal(nextFxFetchAt({ status, startedAt: started, finishedAt: finished, sourceNextUpdateAt: new Date(finished.getTime() + 120 * minute) }).toISOString(), after(125 * minute), `${status} 2 小时后`);
    // 下次时间在 3 天后：最晚 12 小时
    assert.equal(nextFxFetchAt({ status, startedAt: started, finishedAt: finished, sourceNextUpdateAt: plus(3 * 24 * 60 * minute) }).toISOString(), after(12 * 60 * minute), `${status} 3 天后`);
  }
});
