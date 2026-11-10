/**
 * M8-15（ADR 0073「不变的」）：报价引擎改了之后，已有价格规则的报价逐分不变。
 *
 * `quote-compat.golden.json` 是改之前的引擎对 `quote-compat.samples.ts` 里全部样例算出来的结果（三个品类、多区域、禁行区、停用区域、
 * 调价、夜间费、加急、附加服务、司机语言、有没有路线预估）。这里用现在的引擎再算一遍逐项对比。
 * 唯一允许的变化是 ADR 0073 第三部分第 5 节写明的：包车给了下车点、而下车点不在商品本身的任何区域里（这些样例商品没有加价区域）→ 不报价、转人工。
 *
 * M8-11（点对点线路价、含公里数）在这里加了两条：已有规则的报价没有新字段；商品加了「这一单命中不了」的线路价、
 * 含公里数的价格（停用、过期、未生效、别的车型组、停用区域出发）之后，点对点样例仍和 golden 逐分一致。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { COMPAT_POINT_IN_PRODUCT_AREA, compatOutcome, compatSamples } from "./quote-compat.samples.ts";
import type { PriceRule } from "./pricing.ts";
import { type QuoteProduct, quoteProduct } from "./quote.ts";

const golden = JSON.parse(readFileSync(new URL("./quote-compat.golden.json", import.meta.url), "utf8")) as Record<string, unknown>;

test("已有规则的报价逐分不变：接送机、点对点、包车（没给下车点、下车点在商品区域里）和改之前的引擎一模一样", () => {
  const samples = compatSamples();
  assert.equal(samples.length, Object.keys(golden).length, "样例和 golden 文件一一对应");
  let compared = 0;
  for (const sample of samples) {
    if (sample.charterDropoff !== null && !COMPAT_POINT_IN_PRODUCT_AREA[sample.charterDropoff]) continue;
    assert.ok(sample.key in golden, sample.key);
    // 经过一次 JSON：golden 文件里没有 undefined 的键
    const now = JSON.parse(JSON.stringify(compatOutcome(quoteProduct(sample.product, sample.request, sample.moment))));
    assert.deepEqual(now, golden[sample.key], sample.key);
    compared += 1;
  }
  assert.ok(compared > 500, `对比了 ${compared} 个样例`);
});

test("ADR 0073 写明的唯一变化：包车下车点不在商品本身的区域里（也没有加价区域）→ 不报价、转人工；上车点那边原来就报不出的原因不变", () => {
  let changed = 0;
  for (const sample of compatSamples()) {
    if (sample.charterDropoff === null || COMPAT_POINT_IN_PRODUCT_AREA[sample.charterDropoff]) continue;
    const before = golden[sample.key];
    const now = quoteProduct(sample.product, sample.request, sample.moment);
    assert.equal(now.ok, false, sample.key);
    if (now.ok) continue;
    // 原来商品层面就报不出的（时间不对、上车点不在服务范围……），原因照旧；原来能报（或按车型组各有原因）的，现在是下车点不在服务范围
    if (typeof before === "string") assert.equal(now.reason, before, sample.key);
    else {
      assert.equal(now.reason, sample.charterDropoff === "forbidden" ? "IN_FORBIDDEN_AREA" : "OUT_OF_SERVICE_AREA", sample.key);
      changed += 1;
    }
  }
  assert.ok(changed > 0);
});

test("M8-11：已有规则的报价明细里没有线路价的下车区域、含公里数（新字段只出现在用了新规则的报价上）", () => {
  let offers = 0;
  for (const sample of compatSamples()) {
    const quoted = quoteProduct(sample.product, sample.request, sample.moment);
    if (!quoted.ok) continue;
    for (const offer of quoted.offers) {
      assert.deepEqual(["toAreaId" in offer.settlement, "distance" in offer.settlement], [false, false], sample.key);
      offers += 1;
    }
  }
  assert.ok(offers > 200, `看了 ${offers} 个报价`);
});

test("M8-11：点对点商品加了这些单命中不了的线路价和含公里数的价格之后，报价和改之前的引擎逐分一致", () => {
  const extra = (id: string, rule: Partial<PriceRule>): PriceRule & { id: string } => ({ id, areaId: "a1", vehicleGroupId: "biz7", direction: null, packageHours: null, pricing: { model: "fixed", basePriceMinor: 1, includedKm: 1, overKmPerKmMinor: 1 }, validFrom: "2026-01-01", validTo: null, status: "enabled", ...rule });
  const unmatched = [
    extra("line-off", { toAreaId: "a2", status: "disabled" }),
    extra("line-back-later", { areaId: "a2", toAreaId: "a1", validFrom: "2027-01-01" }),
    extra("line-eco-expired", { toAreaId: "a2", vehicleGroupId: "eco4", validTo: "2026-01-31" }),
    extra("line-from-disabled-area", { areaId: "a3", toAreaId: "a1" }),
    extra("line-to-disabled-area", { toAreaId: "a3" }),
    extra("km-inactive-group", { vehicleGroupId: "lux3" }),
  ];
  let compared = 0;
  for (const sample of compatSamples()) {
    if (sample.product.category !== "point_to_point") continue;
    const product: QuoteProduct = { ...sample.product, priceRules: [...sample.product.priceRules, ...unmatched] };
    const now = JSON.parse(JSON.stringify(compatOutcome(quoteProduct(product, sample.request, sample.moment))));
    assert.deepEqual(now, golden[sample.key], sample.key);
    compared += 1;
  }
  assert.ok(compared > 200, `对比了 ${compared} 个点对点样例`);
});
