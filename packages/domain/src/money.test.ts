import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyBasisPoints,
  formatMajor,
  isCurrencyCode,
  parseMajor,
  portionBasisPoints,
  roundHalfAwayFromZero,
  roundToUnit,
} from "./money.ts";

test("四舍五入 0.5 远离零，并修正浮点误差", () => {
  assert.equal(roundHalfAwayFromZero(2.5), 3);
  assert.equal(roundHalfAwayFromZero(-2.5), -3);
  assert.equal(roundHalfAwayFromZero(1.005 * 100), 101);
});

test("解析和输出主单位金额", () => {
  assert.equal(parseMajor("4600.5", "CNY"), 460050);
  assert.equal(parseMajor("98000", "JPY"), 98000);
  assert.equal(formatMajor(460050, "CNY"), "4600.50");
  assert.equal(formatMajor(5, "USD"), "0.05");
  assert.equal(formatMajor(-5, "USD"), "-0.05");
  assert.equal(formatMajor(98000, "JPY"), "98000");
  assert.throws(() => parseMajor("100.5", "JPY"), /最多 0 位小数/);
  assert.throws(() => parseMajor("1,000", "USD"), /格式不正确/);
});

test("加价用基点：98,000 日元加 10% = 107,800", () => {
  assert.equal(applyBasisPoints(98_000, 1_000), 107_800);
  assert.equal(applyBasisPoints(333, 150), 338); // 337.995 → 338
});

test("违约金按比例：结算价 98,000 的 30% = 29,400", () => {
  assert.equal(portionBasisPoints(98_000, 3_000), 29_400);
  assert.throws(() => portionBasisPoints(98_000, 30.5), RangeError);
});

test("按品牌取整单位取整", () => {
  assert.equal(roundToUnit(107_849, 100), 107_800);
  assert.equal(roundToUnit(107_850, 100), 107_900);
  assert.throws(() => roundToUnit(100, 0), RangeError);
});

test("币种代码校验", () => {
  assert.equal(isCurrencyCode("JPY"), true);
  assert.equal(isCurrencyCode("EUR"), false);
  assert.equal(isCurrencyCode("toString"), false);
});
