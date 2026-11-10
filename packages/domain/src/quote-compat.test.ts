/**
 * M8-15（ADR 0073「不变的」）：报价引擎改了之后，已有价格规则的报价逐分不变。
 *
 * `quote-compat.golden.json` 是改之前的引擎对 `quote-compat.samples.ts` 里全部样例算出来的结果（三个品类、多区域、禁行区、停用区域、
 * 调价、夜间费、加急、附加服务、司机语言、有没有路线预估）。这里用现在的引擎再算一遍逐项对比。
 * 唯一允许的变化是 ADR 0073 第三部分第 5 节写明的：包车给了下车点、而下车点不在商品本身的任何区域里（这些样例商品没有加价区域）→ 不报价、转人工。
 *
 * M8-11（点对点线路价、含公里数）在这里加了两条：已有规则的报价没有新字段；商品加了「这一单命中不了」的线路价、
 * 含公里数的价格（停用、过期、未生效、别的车型组、停用区域出发）之后，点对点样例仍和 golden 逐分一致。
 *
 * M8-20（ADR 0075 第三部分第 3 节）：迁移后每个区域都是「运营 + 报价」，运营范围 = 这个供应商的全部区域（包括商品没选的）。
 * 新引擎带上运营范围对全部样例再算一遍：和 golden（以及不做运营判断的同一个引擎）逐项一致，唯一的差别是内部原因
 * `OUT_OF_SERVICE_AREA` → `NO_PRICING_AREA`，而且只在「第一个报不出的点落在本供应商另一个没被选的区域里」的样例上（下面逐条列明）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { COMPAT_POINT_IN_PRODUCT_AREA, type CompatPoint, type CompatSample, compatOutcome, compatSamples } from "./quote-compat.samples.ts";
import type { Position } from "./areas.ts";
import type { PriceRule } from "./pricing.ts";
import { type QuoteArea, type QuoteProduct, quoteProduct } from "./quote.ts";

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

// ---- M8-20（ADR 0075）：迁移后的运营判断 ----

const square = (west: number, south: number, east: number, north: number): Position[] => [[west, south], [east, south], [east, north], [west, north], [west, south]];
/** 同一个供应商另一个区域（样例商品没选）：盖住样例里的 `far` 点。迁移后它也是「运营 + 报价」，所以是运营范围的一部分 */
const UNSELECTED: QuoteArea = { areaId: "a4", active: true, shapes: [{ id: "a4-op", kind: "operate", ring: square(142.0, 35.0, 143.0, 36.0) }] };
/** 迁移后这个供应商的运营范围：它的全部区域（启用的、业务类型相容的；停用的 a3 在里面也不算） */
const migrated = (product: QuoteProduct, extra: QuoteArea = UNSELECTED): QuoteProduct => ({ ...product, operatingAreas: [...product.areas, ...(product.surchargeAreas ?? []), extra] });

/** 样例要校验的点，按引擎判断的先后（接送机：非机场一端；点对点：起点、终点；包车：上车点、给了时的下车点） */
function checkedPoints(sample: CompatSample): CompatPoint[] {
  const name = sample.key.split("|")[3] as string;
  const [from, to] = name.split("→") as [string, string];
  if (sample.product.category === "airport_transfer") return [(from === "pickup" ? to : from) as CompatPoint];
  return [from as CompatPoint, ...(to === "none" ? [] : [to as CompatPoint])];
}

/** 允许的唯一变化在哪些样例上：第一个不在商品区域里的点是 `far`（落在本供应商没被选的区域 a4 里） */
const refined = (sample: CompatSample): boolean => checkedPoints(sample).find((point) => !COMPAT_POINT_IN_PRODUCT_AREA[point]) === "far";

/** 写明会变的样例（不含用车时间、路线这两维）：逐条列出 */
const REFINED_NAMES = [
  "airport|pickup→far",
  "airport|far→dropoff",
  ...["west", "overlap", "east"].map((from) => `p2p|${from}→far`),
  ...["west", "overlap", "east", "forbidden", "disabledArea", "far"].map((to) => `p2p|far→${to}`),
  ...[5, 10, 8].flatMap((hours) => [
    ...["west", "overlap", "east"].map((from) => `charter|${from}→far|${hours}h`),
    ...["none", "west", "overlap", "east", "forbidden", "disabledArea", "far"].map((to) => `charter|far→${to}|${hours}h`),
  ]),
].sort();

test("M8-20：迁移后（全部区域是运营 + 报价）报价逐分不变，唯一的差别是写明的内部原因细分 OUT_OF_SERVICE_AREA → NO_PRICING_AREA", () => {
  const changedNames = new Set<string>();
  let compared = 0;
  for (const sample of compatSamples()) {
    const before = JSON.parse(JSON.stringify(compatOutcome(quoteProduct(sample.product, sample.request, sample.moment))));
    const after = JSON.parse(JSON.stringify(compatOutcome(quoteProduct(migrated(sample.product), sample.request, sample.moment))));
    // 和 golden 能直接比的样例（M8-15 以前就有同样结果的）先和 golden 比一遍：不做运营判断的结果就是 golden
    if (sample.charterDropoff === null || COMPAT_POINT_IN_PRODUCT_AREA[sample.charterDropoff]) assert.deepEqual(before, golden[sample.key], sample.key);
    if (refined(sample) && before === "OUT_OF_SERVICE_AREA") {
      assert.equal(after, "NO_PRICING_AREA", sample.key);
      const [product, , , ...name] = sample.key.split("|");
      changedNames.add([product, ...name].join("|"));
    } else {
      assert.deepEqual(after, before, sample.key);
    }
    compared += 1;
  }
  assert.equal(compared, compatSamples().length);
  assert.ok(compared > 800, `对比了 ${compared} 个样例`);
  assert.deepEqual([...changedNames].sort(), REFINED_NAMES);
});

test("M8-20：没选的区域不在样例点上时（只有商品自己的区域），带上运营范围的结果和 golden 一个字都不差", () => {
  const nowhere: QuoteArea = { areaId: "a5", active: true, shapes: [{ id: "a5-op", kind: "operate", ring: square(150.0, 10.0, 150.1, 10.1) }] };
  for (const sample of compatSamples()) {
    const before = JSON.parse(JSON.stringify(compatOutcome(quoteProduct(sample.product, sample.request, sample.moment))));
    const after = JSON.parse(JSON.stringify(compatOutcome(quoteProduct(migrated(sample.product, nowhere), sample.request, sample.moment))));
    assert.deepEqual(after, before, sample.key);
  }
});

test("M8-20：没被选的区域的禁行区盖住一个点、而那个点不在任何营运区里时，内部原因细分为 IN_FORBIDDEN_AREA（对外同是 OUT_OF_SERVICE_AREA）；报不报、金额不变", () => {
  const forbidOnly: QuoteArea = { areaId: "a4", active: true, shapes: [{ id: "a4-op", kind: "operate", ring: square(143.0, 35.0, 143.5, 36.0) }, { id: "a4-no", kind: "forbid", ring: square(142.0, 35.0, 143.0, 36.0) }] };
  let changed = 0;
  for (const sample of compatSamples()) {
    const before = JSON.parse(JSON.stringify(compatOutcome(quoteProduct(sample.product, sample.request, sample.moment))));
    const after = JSON.parse(JSON.stringify(compatOutcome(quoteProduct(migrated(sample.product, forbidOnly), sample.request, sample.moment))));
    if (refined(sample) && before === "OUT_OF_SERVICE_AREA") {
      assert.equal(after, "IN_FORBIDDEN_AREA", sample.key);
      changed += 1;
    } else assert.deepEqual(after, before, sample.key);
  }
  assert.ok(changed > 0);
});
