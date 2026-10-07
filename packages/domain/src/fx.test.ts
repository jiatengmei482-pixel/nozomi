import { test } from "node:test";
import assert from "node:assert/strict";
import { type FxTable, FxRateMissingError, convertMinor, snapshotRate } from "./fx.ts";

// 测试用的固定汇率表（只用于单元测试，不是业务数据）
const table: FxTable = { base: "USD", rates: { JPY: 150, CNY: 7.2 }, asOf: "2026-10-07T00:00:00Z" };

test("同币种不换算、不加缓冲", () => {
  const s = snapshotRate(table, "JPY", "JPY", 150);
  assert.equal(s.rate, 1);
  assert.equal(s.bufferBasisPoints, 0);
  assert.equal(convertMinor(98_000, s), 98_000);
});

test("CNY → JPY 中间价：4,600.00 元 = 95,833 日元", () => {
  const s = snapshotRate(table, "CNY", "JPY", 0);
  assert.equal(convertMinor(460_000, s), 95_833);
});

test("跨币种加 1.5% 缓冲", () => {
  const s = snapshotRate(table, "CNY", "JPY", 150);
  assert.equal(convertMinor(460_000, s), 97_271); // 95,833.33 × 1.015
});

test("JPY → USD 换到美分", () => {
  const s = snapshotRate(table, "JPY", "USD", 0);
  assert.equal(convertMinor(15_000, s), 10_000);
});

test("缺汇率时明确报错", () => {
  assert.throws(() => snapshotRate(table, "KRW", "JPY", 0), FxRateMissingError);
  assert.throws(() => snapshotRate(table, "CNY", "JPY", -1), RangeError);
});
