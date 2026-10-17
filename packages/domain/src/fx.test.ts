import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FX_CURRENCIES,
  FX_RULES,
  type FxTable,
  crossRate,
  findRateJumps,
  formatRate,
  fxFetchAbandoned,
  fxQuoteFromTable,
  fxStaleAt,
  fxTableState,
  nextFxFetchAt,
  parseRateText,
  rateToFraction,
} from "./fx.ts";
import { rateFraction, sellPrice } from "./quote.ts";

// 测试用的汇率表（只用于单元测试，不是业务数据）
const table: FxTable = { base: "USD", asOf: "2026-10-07T00:00:00.000Z", rates: { JPY: "150", CNY: "7.2", KRW: "1400.5" } };

test("数据源的数字原文 → 规范的十进制字符串：只在字符串上挪动，不经过浮点数", () => {
  const cases: [string, string | null][] = [
    ["151.21", "151.21"],
    ["151.210", "151.21"],
    ["1", "1"],
    ["1.0", "1"],
    ["0.5", "0.5"],
    ["1e-5", "0.00001"],
    ["1.5E2", "150"],
    ["2.5e+3", "2500"],
    ["123.456e-2", "1.23456"],
    // 浮点数表示不了的写法原样保留
    ["0.100000000000000005", "0.100000000000000005"],
    ["7.123456789012345678", "7.123456789012345678"],
    ["0.1000000000000000055", null],
    // 不是正数、写法不对、位数大得不正常
    ["0", null],
    ["0.000", null],
    ["0e10", null],
    ["-1", null],
    ["+1", null],
    [".5", null],
    ["1.", null],
    ["0x10", null],
    ["", null],
    ["1e-30", null],
    ["1234567890123456", null],
    ["0.0000000000000000001", null],
    ["1e999", null],
  ];
  for (const [text, expected] of cases) assert.equal(parseRateText(text), expected, text);
});

test("精确分数和十进制字符串互换：12 位小数四舍五入（0.5 远离零），去掉末尾的 0", () => {
  assert.deepEqual(rateToFraction("7.2"), { numerator: 72n, denominator: 10n });
  assert.deepEqual(rateToFraction("150"), { numerator: 150n, denominator: 1n });
  assert.throws(() => rateToFraction("07.2"), RangeError);
  assert.throws(() => rateToFraction("7.20"), RangeError);
  assert.throws(() => rateToFraction("0"), RangeError);
  assert.equal(formatRate({ numerator: 1n, denominator: 3n }), "0.333333333333");
  assert.equal(formatRate({ numerator: 2n, denominator: 3n }), "0.666666666667");
  assert.equal(formatRate({ numerator: 5n, denominator: 10n ** 13n }), "0.000000000001", "第 13 位是 5：远离零进上去");
  assert.equal(formatRate({ numerator: 4n, denominator: 10n ** 13n }), null, "舍入后是 0：不能用");
  assert.equal(formatRate({ numerator: 48n, denominator: 1n }), "48");
  assert.equal(formatRate({ numerator: 10n ** 13n, denominator: 1n }), null, "整数部分超过 12 位：报价引擎认不了");
});

test("交叉汇率：两项相除的精确分数；给报价的是 12 位小数的十进制字符串，报价引擎认得", () => {
  // 1 CNY = 150 / 7.2 JPY = 20.8333…
  assert.deepEqual(crossRate(table, "CNY", "JPY"), { numerator: 1500n, denominator: 72n });
  const cnyJpy = fxQuoteFromTable(table, "CNY", "JPY");
  assert.deepEqual(cnyJpy, { from: "CNY", to: "JPY", rate: "20.833333333333", asOf: table.asOf });
  assert.deepEqual(rateFraction(cnyJpy?.rate ?? ""), { numerator: 20_833_333_333_333n, denominator: 10n ** 12n });
  // 基准币种自己：就是表里的数；反过来是倒数
  assert.equal(fxQuoteFromTable(table, "USD", "KRW")?.rate, "1400.5");
  assert.equal(fxQuoteFromTable(table, "KRW", "USD")?.rate, "0.000714030703", "1 / 1400.5 = 0.000714030703320…");
  assert.equal(fxQuoteFromTable(table, "JPY", "USD")?.rate, "0.006666666667");
  // 同币种是 1；表里没有的币种给不出
  assert.deepEqual(fxQuoteFromTable(table, "JPY", "JPY"), { from: "JPY", to: "JPY", rate: "1", asOf: table.asOf });
  assert.equal(fxQuoteFromTable(table, "THB", "JPY"), null);
  assert.equal(fxQuoteFromTable(table, "JPY", "THB"), null);
  // 平台的每两种币种都换得出、而且报价引擎认得（真实量级）
  const real: FxTable = { base: "USD", asOf: table.asOf, rates: { JPY: "151.21", CNY: "7.1234", KRW: "1422.53", HKD: "7.7731", TWD: "32.115", THB: "36.21" } };
  for (const from of FX_CURRENCIES) for (const to of FX_CURRENCIES) assert.ok(rateFraction(fxQuoteFromTable(real, from, to)?.rate ?? "") !== null, `${from}→${to}`);
});

test("交叉汇率走精确分数：900 元按 150 / 7.2 换成日元正好 18,750", () => {
  const quote = fxQuoteFromTable(table, "CNY", "JPY");
  assert.ok(quote);
  const sold = sellPrice({ settlementMinor: 90_000, settlementCurrency: "CNY", currency: "JPY", markupBp: 0, markupFloorBp: 0, fxBufferBp: 0, fx: quote });
  assert.ok("sellMinor" in sold);
  assert.equal(sold.sellMinor, 18_750);
});

test("48 小时的边界：正好 48 小时还能用，多 1 毫秒就停；没有汇率是 none；取数时间比现在晚 5 分钟以上算过期", () => {
  const asOf = "2026-10-07T00:00:00.000Z";
  const at = (ms: number): Date => new Date(new Date(asOf).getTime() + ms);
  assert.equal(fxTableState(null, at(0)), "none");
  assert.equal(fxTableState(asOf, at(0)), "fresh");
  assert.equal(fxTableState(asOf, at(48 * 3_600_000)), "fresh");
  assert.equal(fxTableState(asOf, at(48 * 3_600_000 + 1)), "stale");
  assert.equal(fxTableState(asOf, at(-5 * 60_000)), "fresh");
  assert.equal(fxTableState(asOf, at(-5 * 60_000 - 1)), "stale");
  assert.equal(fxStaleAt(asOf).toISOString(), "2026-10-09T00:00:00.001Z");
  assert.equal(fxTableState(asOf, fxStaleAt(asOf)), "stale");
  assert.equal(FX_RULES.maxAgeHours, 48);
});

test("跳变检测：变动严格大于 3% 的币种挂起（精确比较，正好 3% 不算），带正负号的幅度只给人看", () => {
  const before = { JPY: "150", CNY: "7.2", KRW: "1400" };
  // JPY +3% 整（154.5）不算；CNY −3.0001%（6.983992）算；KRW +3.0001%（1442.0014）算
  const after = { JPY: "154.5", CNY: "6.983992", KRW: "1442.0014" };
  assert.deepEqual(findRateJumps(before, after), [
    { currency: "KRW", previous: "1400", next: "1442.0014", changeBp: 300 },
    { currency: "CNY", previous: "7.2", next: "6.983992", changeBp: -300 },
  ]);
  assert.deepEqual(findRateJumps(before, { JPY: "145.5" }), [], "−3% 整也不算");
  assert.deepEqual(findRateJumps(before, { JPY: "145.4999" }).map((jump) => jump.currency), ["JPY"]);
  assert.deepEqual(findRateJumps(before, { JPY: "300" }), [{ currency: "JPY", previous: "150", next: "300", changeBp: 10_000 }]);
  assert.deepEqual(findRateJumps({}, after), [], "没有上一批：第一次拉取不比较");
  assert.deepEqual(findRateJumps(before, { JPY: "151" }, 50), [{ currency: "JPY", previous: "150", next: "151", changeBp: 67 }], "阈值可以换");
});

test("定时拉取的节奏：跟着数据源的更新时间，失败 15 分钟后重试，正在拉的超过 5 分钟算中断", () => {
  const t = (iso: string): Date => new Date(iso);
  assert.equal(nextFxFetchAt(null).getTime(), 0, "从没拉过：马上拉");
  // 数据源说 12:02 更新：12:07 再拉
  assert.equal(nextFxFetchAt({ status: "accepted", startedAt: t("2026-10-07T00:10:00Z"), finishedAt: t("2026-10-07T00:10:01Z"), sourceNextUpdateAt: t("2026-10-07T12:02:00Z") }).toISOString(), "2026-10-07T12:07:00.000Z");
  // 更新时间在 12 小时之后：最晚 12 小时后拉一次
  assert.equal(nextFxFetchAt({ status: "accepted", startedAt: t("2026-10-07T00:10:00Z"), finishedAt: t("2026-10-07T00:10:00Z"), sourceNextUpdateAt: t("2026-10-08T00:02:00Z") }).toISOString(), "2026-10-07T12:10:00.000Z");
  // 数据源说的更新时间已经过了还没更新（unchanged）：15 分钟后再问，不会每分钟去问
  assert.equal(nextFxFetchAt({ status: "unchanged", startedAt: t("2026-10-07T00:10:00Z"), finishedAt: t("2026-10-07T00:10:00Z"), sourceNextUpdateAt: t("2026-10-07T00:02:00Z") }).toISOString(), "2026-10-07T00:25:00.000Z");
  // 没说下次更新时间：1 小时后
  assert.equal(nextFxFetchAt({ status: "held", startedAt: t("2026-10-07T00:10:00Z"), finishedAt: t("2026-10-07T00:10:00Z"), sourceNextUpdateAt: null }).toISOString(), "2026-10-07T01:10:00.000Z");
  for (const status of ["failed", "rejected"] as const) {
    assert.equal(nextFxFetchAt({ status, startedAt: t("2026-10-07T00:10:00Z"), finishedAt: t("2026-10-07T00:10:30Z"), sourceNextUpdateAt: null }).toISOString(), "2026-10-07T00:25:30.000Z", status);
  }
  const running = { status: "running" as const, startedAt: t("2026-10-07T00:10:00Z"), finishedAt: null, sourceNextUpdateAt: null };
  assert.equal(nextFxFetchAt(running).toISOString(), "2026-10-07T00:15:00.001Z");
  assert.equal(fxFetchAbandoned(running, t("2026-10-07T00:15:00Z")), false);
  assert.equal(fxFetchAbandoned(running, t("2026-10-07T00:15:00.001Z")), true);
  assert.equal(fxFetchAbandoned({ ...running, status: "failed" }, t("2026-10-08T00:00:00Z")), false);
});
