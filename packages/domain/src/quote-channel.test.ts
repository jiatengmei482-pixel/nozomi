/**
 * M2-04：按渠道的规则算对外价（最低毛利金额、对外价取整、渠道的价格带和下限），以及比价时用渠道的规则。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ceilFractionToUnit } from "./money.ts";
import { type FxQuote, type SellPrice, sellPrice } from "./quote.ts";

const NOW = "2026-10-17T00:00:00.000Z";
const fx = (from: FxQuote["from"], to: FxQuote["to"], rate: string): FxQuote => ({ from, to, rate, asOf: NOW });
const ok = (result: ReturnType<typeof sellPrice>): SellPrice => {
  assert.ok(!("failure" in result), JSON.stringify(result));
  return result;
};

test("需求文档的例子：结算价 108,900、加价 10%，渠道按 100 日元取整 → 119,800（向上取整）", () => {
  const sold = ok(sellPrice({ settlementMinor: 108_900, settlementCurrency: "JPY", currency: "JPY", markupBp: 1_000, fx: null, channel: { minMargin: null, roundingUnit: 100 } }));
  assert.deepEqual([sold.sellMinor, sold.exact, sold.channel], [119_800, "119790", { roundingUnit: 100, minMarginMinor: 0, minMarginApplied: false, minMarginFx: null }]);
});

test("取整只往上：119,701 → 119,800；正好是整百的不动；取整单位 1 时和不按渠道一样四舍五入", () => {
  assert.equal(ok(sellPrice({ settlementMinor: 108_819, settlementCurrency: "JPY", currency: "JPY", markupBp: 1_000, fx: null, channel: { minMargin: null, roundingUnit: 100 } })).sellMinor, 119_800);
  assert.equal(ok(sellPrice({ settlementMinor: 109_000, settlementCurrency: "JPY", currency: "JPY", markupBp: 1_000, fx: null, channel: { minMargin: null, roundingUnit: 100 } })).sellMinor, 119_900);
  const plain = ok(sellPrice({ settlementMinor: 20_005, settlementCurrency: "JPY", currency: "JPY", markupBp: 1_250, fx: null }));
  const unitOne = ok(sellPrice({ settlementMinor: 20_005, settlementCurrency: "JPY", currency: "JPY", markupBp: 1_250, fx: null, channel: { minMargin: null, roundingUnit: 1 } }));
  assert.equal(unitOne.sellMinor, plain.sellMinor);
  assert.equal(plain.channel, undefined, "不按渠道算时没有渠道的明细");
});

test("最低毛利：加价部分不足时补到最低毛利；够了不动；正好等于不补", () => {
  const at = (settlementMinor: number, minor: number) => ok(sellPrice({ settlementMinor, settlementCurrency: "JPY", currency: "JPY", markupBp: 1_000, fx: null, channel: { minMargin: { minor, currency: "JPY", fx: null }, roundingUnit: 1 } }));
  // 结算价 3,000 加 10% 只有 300 的毛利，最低毛利 500 → 3,500
  assert.deepEqual([at(3_000, 500).sellMinor, at(3_000, 500).channel?.minMarginApplied], [3_500, true]);
  assert.deepEqual([at(10_000, 500).sellMinor, at(10_000, 500).channel?.minMarginApplied], [11_000, false]);
  assert.deepEqual([at(5_000, 500).sellMinor, at(5_000, 500).channel?.minMarginApplied], [5_500, false]);
});

test("最低毛利 + 取整：先补毛利再向上取整", () => {
  const sold = ok(sellPrice({ settlementMinor: 3_010, settlementCurrency: "JPY", currency: "JPY", markupBp: 1_000, fx: null, channel: { minMargin: { minor: 500, currency: "JPY", fx: null }, roundingUnit: 100 } }));
  assert.deepEqual([sold.sellMinor, sold.exact], [3_600, "3510"]);
});

test("最低毛利是渠道结算币种的金额：客人付别的币种时按中央汇率（不加缓冲）换过去；没有汇率报不出", () => {
  // 结算价 1,000 日元、客人付人民币：1000 × 0.048 × 1.015 = 48.72 元；加价 10% = 4.872 元，最低毛利 1,000 日元 = 48 元 → 对外价 48.72 + 48 = 96.72 元
  const rules = { minMargin: { minor: 1_000, currency: "JPY" as const, fx: fx("JPY", "CNY", "0.048") }, roundingUnit: 1 };
  const sold = ok(sellPrice({ settlementMinor: 1_000, settlementCurrency: "JPY", currency: "CNY", markupBp: 1_000, fx: fx("JPY", "CNY", "0.048"), channel: rules }));
  assert.deepEqual([sold.sellMinor, sold.channel?.minMarginMinor, sold.channel?.minMarginApplied], [9_672, 4_800, true]);
  assert.deepEqual(sellPrice({ settlementMinor: 1_000, settlementCurrency: "JPY", currency: "CNY", markupBp: 1_000, fx: fx("JPY", "CNY", "0.048"), channel: { ...rules, minMargin: { ...rules.minMargin, fx: null } } }), { failure: "FX_RATE_UNAVAILABLE" });
  // 汇率的方向不对也不用
  assert.deepEqual(sellPrice({ settlementMinor: 1_000, settlementCurrency: "JPY", currency: "CNY", markupBp: 1_000, fx: fx("JPY", "CNY", "0.048"), channel: { ...rules, minMargin: { ...rules.minMargin, fx: fx("CNY", "JPY", "20") } } }), { failure: "FX_RATE_UNAVAILABLE" });
  // 没设最低毛利（0）就不需要汇率
  assert.equal(ok(sellPrice({ settlementMinor: 1_000, settlementCurrency: "JPY", currency: "JPY", markupBp: 1_000, fx: null, channel: { minMargin: { minor: 0, currency: "CNY", fx: null }, roundingUnit: 1 } })).sellMinor, 1_100);
});

test("下限照旧：给的比例低于下限按下限算，再套渠道规则", () => {
  const sold = ok(sellPrice({ settlementMinor: 10_000, settlementCurrency: "JPY", currency: "JPY", markupBp: 1_000, markupFloorBp: 1_200, fx: null, channel: { minMargin: null, roundingUnit: 1_000 } }));
  assert.deepEqual([sold.markupBp, sold.sellMinor], [1_200, 12_000]);
});

test("向上取整：整数运算，任何分数都对", () => {
  assert.equal(ceilFractionToUnit(119_790n, 1n, 100), 119_800);
  assert.equal(ceilFractionToUnit(119_800n, 1n, 100), 119_800);
  assert.equal(ceilFractionToUnit(1n, 3n, 1), 1);
  assert.equal(ceilFractionToUnit(301n, 3n, 10), 110);
  assert.throws(() => ceilFractionToUnit(0n, 1n, 100), RangeError);
  assert.throws(() => ceilFractionToUnit(1n, 1n, 0), RangeError);
});
