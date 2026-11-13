/**
 * M9W-01（ADR 0088「验证」）：包车带加价区域的报价，在引擎加经停点之后、不带经停点时逐分、逐字段不变。
 * `charter-golden.json` 是改引擎之前的代码对 `charter-golden.samples.ts` 全部样例算出来的（单独一个提交）；这里用现在的引擎再算一遍逐条对比。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { charterGoldenEntry, charterGoldenSamples } from "./charter-golden.samples.ts";

const golden = JSON.parse(readFileSync(new URL("./charter-golden.json", import.meta.url), "utf8")) as Record<string, { summary: string; sha256: string }>;

test("包车带加价区域（重叠取最高、大区盖小区、停用、未生效、上车只在加价区、没给下车点……）：不带经停点的报价和改引擎之前逐字段一致", () => {
  const samples = charterGoldenSamples();
  assert.equal(samples.length, Object.keys(golden).length, "样例和 golden 文件一一对应");
  for (const sample of samples) {
    const expected = golden[sample.key];
    assert.ok(expected !== undefined, sample.key);
    assert.deepEqual(charterGoldenEntry(sample), expected, sample.key);
  }
});

test("golden 样例覆盖到了各种情形（防止样例退化成全是报不出）", () => {
  const summaries = Object.values(golden).map((entry) => entry.summary);
  const has = (pattern: RegExp): boolean => summaries.some((summary) => pattern.test(summary));
  // 重叠取最高：富士山（1000）和富士北（1500）重叠处上车取富士北
  assert.ok(has(/biz7:\d+\(fuji-north\+1500,/), "重叠取最高");
  // 大区盖小区：大东京商品的八王子上车仍收 800
  assert.ok(golden["big|2026-10-20T10:00|8h|hachioji→tokyo"]?.summary.startsWith("biz7:50800(hachioji+800,-+0)"));
  for (const reason of ["PRICE_RULE_DISABLED", "PRICE_NOT_IN_EFFECT", "NO_PRICE_RULE", "DROPOFF_REQUIRED", "IN_FORBIDDEN_AREA", "OUT_OF_SERVICE_AREA", "NO_PRICING_AREA"]) assert.ok(has(new RegExp(reason)), reason);
  assert.ok(Object.keys(golden).length > 2_000);
});
