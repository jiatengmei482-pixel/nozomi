/**
 * 包车按行程计价的 golden（M9W-11 分支 b6829d99 在没改引擎的代码上生成，M9P-01 带进来；ADR 0093 第六节第 4 小节、第十二节）：
 * 选档、超时费、超公里在加价算法改动前后逐分不变的证明。
 *
 * - `itinerary-golden.json` 是 M9P-01 之前的引擎对 `itinerary-golden.samples.ts` 全部样例算出来的，**不重新生成**。
 * - M9P-01（经停不再被上 / 下车加价抵消，规格 P0 #1）让「东京上车 → 富士山经停 → 富士山下车」这一类样例多收富士山的途经加价（3,000，`adjusted` 再过调价）。
 *   这些样例的新期望单独放在 `itinerary-golden.m9p-01.json`（`before` 是旧 golden 里的摘要，`summary` / `sha256` 是新期望），
 *   这里逐条核对：旧 golden 没被改、变的只有这一类、超公里和超时费一分不变、多出来的正好是富士山那一项行程加价。其余样例照旧逐字段相等。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { quoteProduct } from "./quote.ts";
import { itineraryGoldenEntry, itineraryGoldenSamples } from "./itinerary-golden.samples.ts";

type Entry = { summary: string; sha256: string };
const golden = JSON.parse(readFileSync(new URL("./itinerary-golden.json", import.meta.url), "utf8")) as Record<string, Entry>;
const m9p01 = JSON.parse(readFileSync(new URL("./itinerary-golden.m9p-01.json", import.meta.url), "utf8")) as Record<string, Entry & { before: string }>;

test("包车按行程计价（各档、短档超时、正好等于套餐时长、超公里、经停点、调价 / 取整 / 加急 / 夜间）：除 M9P-01 有意改变的样例外，和改引擎之前逐字段一致", () => {
  const samples = itineraryGoldenSamples();
  assert.equal(samples.length, Object.keys(golden).length, "样例和 golden 文件一一对应");
  for (const sample of samples) {
    const changed = m9p01[sample.key];
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
    const quote = quoteProduct(sample.product, sample.request, sample.moment);
    assert.ok(quote.ok, sample.key);
    for (const offer of quote.offers) {
      const old = before.find(([group]) => group === offer.vehicleGroupId)?.[1] as number;
      // 富士山途经加价 3,000：经停点在富士山、下车也在富士山，M9P-01 之前被下车加价抵消
      assert.deepEqual(offer.settlement.areaSurcharge?.waypoints, [{ areaId: "fuji", priceRuleId: offer.settlement.areaSurcharge?.waypoints?.[0]?.priceRuleId, amountMinor: 3_000, stopSeqs: [1] }], sample.key);
      assert.equal(offer.settlement.areaSurcharge?.dropoff.areaId, "fuji", sample.key);
      // 没有调价的商品正好多 3,000；adjusted 的调价作用在合计上，多出来的按比例（大于 3,000）
      if (sample.product.productId === "adjusted") assert.ok(offer.settlement.totalMinor - old >= 3_000, sample.key);
      else assert.equal(offer.settlement.totalMinor - old, 3_000, sample.key);
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
