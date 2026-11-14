/**
 * M9W-11（ADR 0091 第四节第 5 小节）：包车按行程计价的报价，在引擎加「经停点默认占用、整单缓冲、最低套餐」之后、
 * 不传 `packageCheck` / `lockedItinerary` 时逐分、逐字段不变。
 * `itinerary-golden.json` 是改引擎之前的代码对 `itinerary-golden.samples.ts` 全部样例算出来的（单独一个提交）；这里用现在的引擎再算一遍逐条对比。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { itineraryGoldenEntry, itineraryGoldenSamples } from "./itinerary-golden.samples.ts";

const golden = JSON.parse(readFileSync(new URL("./itinerary-golden.json", import.meta.url), "utf8")) as Record<string, { summary: string; sha256: string }>;

test("包车按行程计价（各档、短档超时、正好等于套餐时长、超公里、经停点、调价 / 取整 / 加急 / 夜间）：不传 packageCheck 时和改引擎之前逐字段一致", () => {
  const samples = itineraryGoldenSamples();
  assert.equal(samples.length, Object.keys(golden).length, "样例和 golden 文件一一对应");
  for (const sample of samples) {
    const expected = golden[sample.key];
    assert.ok(expected !== undefined, sample.key);
    assert.deepEqual(itineraryGoldenEntry(sample), expected, sample.key);
  }
});

test("golden 样例覆盖到了各种情形（防止样例退化成全是报不出）", () => {
  const summaries = Object.values(golden).map((entry) => entry.summary);
  const has = (pattern: RegExp): boolean => summaries.some((summary) => pattern.test(summary));
  assert.ok(has(/ot\+[1-9]\d*\)/), "有超时费");
  assert.ok(has(/km\+[1-9]\d*,/), "有超公里费");
  assert.ok(has(/km\+0,ot\+0\)/), "有不超的");
  for (const reason of ["WAYPOINT_NOT_PRICED", "NO_PRICE_RULE", "IN_FORBIDDEN_AREA"]) assert.ok(has(new RegExp(reason)), reason);
  assert.ok(Object.keys(golden).length > 500);
});
