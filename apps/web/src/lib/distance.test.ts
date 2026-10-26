import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDistance, kmText } from "./distance.ts";

test("米换公里按四舍五入显示，不是截断：7,295 米是 7.3 公里", () => {
  assert.equal(kmText(7_295), "7.3");
  assert.equal(kmText(7_249), "7.2");
  assert.equal(kmText(7_299), "7.3");
});

test("正好在 .x5 上（50 米）进位，差 1 米不进", () => {
  assert.equal(kmText(7_250), "7.3");
  assert.equal(kmText(7_249), "7.2");
  assert.equal(kmText(50), "0.1");
  assert.equal(kmText(49), "0");
  assert.equal(kmText(950), "1");
  assert.equal(kmText(9_950), "10");
  assert.equal(kmText(999_950), "1,000");
});

test("0 和整数公里不带小数；千分位", () => {
  assert.equal(kmText(0), "0");
  assert.equal(kmText(1_000), "1");
  assert.equal(kmText(12_000), "12");
  assert.equal(kmText(12_040), "12");
  assert.equal(kmText(1_234_560), "1,234.6");
  assert.equal(kmText(5_000_000), "5,000");
});

test("约数的距离（待审核机场）照旧取整", () => {
  assert.equal(formatDistance(0.4), "不到 1 公里");
  assert.equal(formatDistance(17.6), "约 18 公里");
});
