/**
 * M4-12 测试角色补充：路程公里数四舍五入显示（kmText）的边界——正好在 .x5（50 米）上、进位跨整数和千分位、负数、不是整数米时。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { kmText } from "./distance.ts";

test("M4-12 .x5 边界：7,250 进位，7,249 不进，7,251 进；每一档都是四舍五入、不是银行家取整", () => {
  assert.equal(kmText(7_250), "7.3");
  assert.equal(kmText(7_249), "7.2");
  assert.equal(kmText(7_251), "7.3");
  assert.equal(kmText(7_350), "7.4");
  assert.equal(kmText(7_450), "7.5", "7.45 要进到 7.5，不是银行家取整的 7.4");
  assert.equal(kmText(7_150), "7.2");
  assert.equal(kmText(7_050), "7.1");
  assert.equal(kmText(7_049), "7");
});

test("M4-12 截断和四舍五入的区别：每个 x.x5–x.x9 都比截断多 0.1（验收发现的 7,295 米）", () => {
  for (let meters = 7_250; meters <= 7_299; meters += 1) assert.equal(kmText(meters), "7.3", String(meters));
  for (let meters = 7_200; meters <= 7_249; meters += 1) assert.equal(kmText(meters), "7.2", String(meters));
});

test("M4-12 进位跨过整数和千分位：不留「.0」，进位后的千分位也对", () => {
  assert.equal(kmText(999), "1");
  assert.equal(kmText(949), "0.9");
  assert.equal(kmText(99_950), "100");
  assert.equal(kmText(99_949), "99.9");
  assert.equal(kmText(999_949), "999.9");
  assert.equal(kmText(999_950), "1,000");
  assert.equal(kmText(1_000_000), "1,000");
  assert.equal(kmText(1_234_567_890), "1,234,567.9");
  assert.equal(kmText(1_000_000_000_000), "1,000,000,000");
  assert.equal(kmText(Number.MAX_SAFE_INTEGER), "9,007,199,254,741");
});

test("M4-12 负数（不该出现，出现时也不写成「-0」）：远离零取整，符号在千分位前面", () => {
  assert.equal(kmText(-7_250), "-7.3");
  assert.equal(kmText(-7_249), "-7.2");
  assert.equal(kmText(-49), "0");
  assert.equal(kmText(-1_234_560), "-1,234.6");
});

test("M4-12 不是整数米（NaN、小数、无穷大）时直接报错，不会显示成「NaN 公里」这类文字", () => {
  for (const meters of [Number.NaN, 7_295.5, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.throws(() => kmText(meters), RangeError, String(meters));
  }
});
