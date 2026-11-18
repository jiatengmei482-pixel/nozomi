/**
 * 包车按行程计价的 golden（M9W-11 分支 b6829d99 在没改引擎的代码上生成，M9P-01 带进来；ADR 0093 第六节第 4 小节、第十二节）：
 * 选档、超时费、超公里在加价算法改动前后逐分不变的证明。
 *
 * - `itinerary-golden.json` 是 M9P-01 之前的引擎对 `itinerary-golden.samples.ts` 全部样例算出来的，**不重新生成**。
 * - M9P-01（经停不再被上 / 下车加价抵消，规格 P0 #1）让「东京上车 → 富士山经停 → 富士山下车」这一类样例多收富士山的途经加价（3,000，`adjusted` 再过调价）。
 *   这些样例的新期望单独放在 `itinerary-golden.m9p-01.json`（`before` 是旧 golden 里的摘要，`summary` / `sha256` 是新期望），
 *   这里逐条核对：旧 golden 没被改、变的只有这一类、超公里和超时费一分不变、多出来的正好是富士山那一项行程加价。其余样例照旧逐字段相等。
 * - M9P-06（基础价区域优先，ADR 0093 第六节第 4 小节第 9 类）：`big`（大东京①包住 fuji、kamakura 等）里经停或上 / 下车点落在①里的样例不再加价，变便宜。
 *   新期望放在 `itinerary-golden.m9p-06.json`（`before` 是 M9P-01 之后的期望），这里核对：只有 big 变、只变便宜、选档 / 超公里 / 超时费 / 报不出的原因不变、
 *   ①里的点没有任何加价。big 的 `tokyo→fuji→fuji` 在 M9P-01 先多 3,000、M9P-06 再归 0（8h 150 km biz7 = 50,000）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { locateInAreas, quoteProduct } from "./quote.ts";
import { itineraryGoldenEntry, itineraryGoldenSamples } from "./itinerary-golden.samples.ts";

type Entry = { summary: string; sha256: string };
const golden = JSON.parse(readFileSync(new URL("./itinerary-golden.json", import.meta.url), "utf8")) as Record<string, Entry>;
const m9p01 = JSON.parse(readFileSync(new URL("./itinerary-golden.m9p-01.json", import.meta.url), "utf8")) as Record<string, Entry & { before: string }>;
const m9p06 = JSON.parse(readFileSync(new URL("./itinerary-golden.m9p-06.json", import.meta.url), "utf8")) as Record<string, Entry & { before: string }>;

test("包车按行程计价（各档、短档超时、正好等于套餐时长、超公里、经停点、调价 / 取整 / 加急 / 夜间）：除 M9P-01、M9P-06 有意改变的样例外，和改引擎之前逐字段一致", () => {
  const samples = itineraryGoldenSamples();
  assert.equal(samples.length, Object.keys(golden).length, "样例和 golden 文件一一对应");
  for (const sample of samples) {
    const changed = m9p06[sample.key] ?? m9p01[sample.key];
    const expected = changed === undefined ? golden[sample.key] : { summary: changed.summary, sha256: changed.sha256 };
    assert.ok(expected !== undefined, sample.key);
    assert.deepEqual(itineraryGoldenEntry(sample), expected, sample.key);
  }
});

/** 摘要里每个车型组：`biz7:51000(km+0,ot+0)` → [车型组, 总价, 「(km+…,ot+…)」]；报不出的 `eco4:NO_PRICE_RULE` → [车型组, null, 原因] */
const parts = (summary: string): [string, number | null, string][] =>
  summary.split(" ").map((item) => {
    const match = /^([^:]+):(\d+)(\(.*\))$/.exec(item);
    if (match !== null) return [match[1] as string, Number(match[2]), match[3] as string];
    const [group, reason] = item.split(":");
    return [group as string, null, reason as string];
  });

test("M9P-01 的 golden 变化：只有「东京上车 → 富士山经停 → 富士山下车」一类，全部列出；旧 golden 没改；超公里、超时费、报不出的车型组一分不变；多出来的是富士山行程加价", () => {
  const keys = Object.keys(m9p01);
  const fujiFuji = itineraryGoldenSamples().filter((sample) => sample.key.endsWith("|tokyo→fuji→fuji"));
  assert.deepEqual(keys.sort(), fujiFuji.map((sample) => sample.key).sort(), "变的正好是这一类的全部样例（72 条），别的一条没变");
  for (const sample of fujiFuji) {
    const changed = m9p01[sample.key] as Entry & { before: string };
    assert.equal(changed.before, golden[sample.key]?.summary, `旧 golden 没被改：${sample.key}`);
    const [before, after] = [parts(changed.before), parts(changed.summary)];
    assert.deepEqual(after.map(([group, , rest]) => [group, rest]), before.map(([group, , rest]) => [group, rest]), `选档、超公里、超时费、报不出的原因不变：${sample.key}`);
    // big 的这一类 M9P-06 又变了（富士山在大东京①里，经停、下车都不再加价），由下面 M9P-06 的测试核对
    if (sample.product.productId === "big") {
      assert.ok(m9p06[sample.key] !== undefined, sample.key);
      continue;
    }
    const quote = quoteProduct(sample.product, sample.request, sample.moment);
    assert.ok(quote.ok, sample.key);
    for (const offer of quote.offers) {
      const old = before.find(([group]) => group === offer.vehicleGroupId)?.[1] as number;
      // 富士山途经加价 3,000：经停点在富士山、下车也在富士山，M9P-01 之前被下车加价抵消
      assert.deepEqual(offer.settlement.areaSurcharge?.waypoints, [{ areaId: "fuji", priceRuleId: offer.settlement.areaSurcharge?.waypoints?.[0]?.priceRuleId, amountMinor: 3_000, stopSeqs: [1] }], sample.key);
      assert.equal(offer.settlement.areaSurcharge?.dropoff.areaId, "fuji", sample.key);
      // 没有调价的商品正好多 3,000；adjusted 的调价作用在合计上：多出来的 = 3,000 × 调价系数（调价后 ÷ 调价前的精确值），误差不超过一个取整单位（#229 审查建议，M9P-06 收紧）
      if (sample.product.productId === "adjusted") {
        const factor = Number(offer.settlement.exact.adjusted) / Number(offer.settlement.exact.base);
        assert.ok(Math.abs(offer.settlement.totalMinor - old - 3_000 * factor) <= sample.product.roundingUnit, `${sample.key}：多了 ${offer.settlement.totalMinor - old}，3,000 × ${factor}`);
      } else assert.equal(offer.settlement.totalMinor - old, 3_000, sample.key);
    }
  }
});

test("下车点行程加价（ADR 0093 第二节第 4 小节）：big 的下车点 fuji 在大东京①里不触发；small 的 fuji 在①外，不带经停时触发", () => {
  const fujiFuji = itineraryGoldenSamples().filter((sample) => sample.key.endsWith("|tokyo→fuji→fuji") && sample.key.includes("|8h|"));
  for (const productId of ["big", "small"]) {
    for (const sample of fujiFuji.filter((entry) => entry.product.productId === productId)) {
      // 带 fuji 经停（golden 原样）：经停已收行程加价，下车点不再触发——两个商品都只有经停那一条
      const withStop = quoteProduct(sample.product, sample.request, sample.moment);
      assert.ok(withStop.ok && withStop.offers.length > 0, sample.key);
      for (const offer of withStop.offers) assert.equal(offer.settlement.areaSurcharge?.waypoints?.some((entry) => entry.fromDropoff === true), false, sample.key);
      // 去掉经停（东京上车 → fuji 下车）：big 的 fuji 在①里，不收；small 收 fuji 一次（3,000）
      const { waypoints: _stops, ...plain } = sample.request;
      const noStop = quoteProduct(sample.product, plain, sample.moment);
      assert.ok(noStop.ok && noStop.offers.length > 0, sample.key);
      for (const offer of noStop.offers) {
        const expected = productId === "big" ? undefined : [{ areaId: "fuji", priceRuleId: offer.settlement.areaSurcharge?.waypoints?.[0]?.priceRuleId, amountMinor: 3_000, stopSeqs: [], fromDropoff: true }];
        assert.deepEqual(offer.settlement.areaSurcharge?.waypoints, expected, `${sample.key}（不带经停）`);
      }
    }
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

test("M9P-06 的 golden 变化：只有 big 商品（大东京①）、只变便宜；选档、超公里、超时费、报不出的原因不变；①里的上 / 下车点、经停点没有任何加价", () => {
  const samples = new Map(itineraryGoldenSamples().map((sample) => [sample.key, sample]));
  for (const [key, changed] of Object.entries(m9p06)) {
    assert.ok(key.startsWith("big|"), `只有 big 变：${key}`);
    assert.equal(changed.before, (m9p01[key] ?? golden[key])?.summary, `before 是 M9P-01 之后的期望：${key}`);
    const [before, after] = [parts(changed.before), parts(changed.summary)];
    assert.deepEqual(after.map(([group, , rest]) => [group, rest]), before.map(([group, , rest]) => [group, rest]), `选档、超公里、超时费、报不出的原因不变：${key}`);
    // 每个车型组不变或变便宜（有的车型组那一端本来就是 0），至少一个变便宜
    const deltas = after.flatMap(([, total], index) => (total === null ? [] : [(before[index]?.[1] as number) - total]));
    assert.ok(deltas.every((delta) => delta >= 0) && deltas.some((delta) => delta > 0), `只变便宜：${key}`);
    const sample = samples.get(key);
    assert.ok(sample !== undefined);
    const quote = quoteProduct(sample.product, sample.request, sample.moment);
    assert.ok(quote.ok, key);
    const inBase = (point: { lat: number; lng: number } | null): boolean => point !== null && locateInAreas(sample.product.areas, point).operating.length > 0;
    for (const offer of quote.offers) {
      const surcharge = offer.settlement.areaSurcharge;
      assert.ok(surcharge !== undefined && surcharge !== null, key);
      if (inBase(sample.request.pickup)) assert.deepEqual(surcharge.pickup, { areaId: null, priceRuleId: null, amountMinor: 0 }, key);
      if (inBase(sample.request.dropoff)) assert.deepEqual(surcharge.dropoff, { areaId: null, priceRuleId: null, amountMinor: 0 }, key);
      const charged = new Set((surcharge.waypoints ?? []).flatMap((entry) => entry.stopSeqs));
      for (const [index, stop] of (sample.request.waypoints ?? []).entries()) if (inBase(stop)) assert.ok(!charged.has(index + 1), `①里的经停点不加价：${key} 第 ${index + 1} 个`);
    }
  }
  // ADR 0093 第六节第 4 小节点名的那一条：下车点 fuji 在①里，不触发下车点行程加价（漏了这个判断会多出 3,000）
  assert.equal(m9p06["big|2026-10-20T10:00|8h|150000m/480min|tokyo→fuji→fuji"]?.summary.split(" ")[0], "biz7:50000(km+0,ot+0)");
  assert.equal(Object.keys(m9p06).length, 48);
});
