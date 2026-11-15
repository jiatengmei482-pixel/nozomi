/**
 * M9W-01（ADR 0088「验证」）：包车带加价区域的报价，在引擎加经停点之后、不带经停点时逐分、逐字段不变。
 * `charter-golden.json` 是改引擎之前的代码对 `charter-golden.samples.ts` 全部样例算出来的（单独一个提交）；这里用现在的引擎再算一遍逐条对比。
 *
 * M9P-06（ADR 0093 第二节「基础价区域优先」、第六节第 4 小节第 9 类）：上 / 下车点在商品任一①基础价区域里就不加价（取代 M8-38「大区不能把小加价区盖成 0」）。
 * 变了的样例单独放在 `charter-golden.m9p-06.json`（`before` 是旧 golden 的摘要，`summary` / `sha256` 是新期望），旧 golden 不重新生成；
 * 这里逐条核对：变的只有 `big`（大东京①包住加价区）里上 / 下车点落在①∩加价区的样例，变化只是那一端的加价变成 0、总价正好少这么多，报不出的原因不变。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { charterGoldenEntry, charterGoldenSamples } from "./charter-golden.samples.ts";
import { locateInAreas } from "./quote.ts";

type Entry = { summary: string; sha256: string };
const golden = JSON.parse(readFileSync(new URL("./charter-golden.json", import.meta.url), "utf8")) as Record<string, Entry>;
const m9p06 = JSON.parse(readFileSync(new URL("./charter-golden.m9p-06.json", import.meta.url), "utf8")) as Record<string, Entry & { before: string }>;

test("包车带加价区域（重叠取最高、停用、未生效、上车只在加价区、没给下车点……）：除 M9P-06 有意改变的样例外，不带经停点的报价和改引擎之前逐字段一致", () => {
  const samples = charterGoldenSamples();
  assert.equal(samples.length, Object.keys(golden).length, "样例和 golden 文件一一对应");
  for (const sample of samples) {
    const changed = m9p06[sample.key];
    const expected = changed === undefined ? golden[sample.key] : { summary: changed.summary, sha256: changed.sha256 };
    assert.ok(expected !== undefined, sample.key);
    assert.deepEqual(charterGoldenEntry(sample), expected, sample.key);
  }
});

/** `biz7:50800(hachioji+800,-+0)` → [车型组, 总价, [上车区域, 上车加价], [下车区域, 下车加价]]；报不出的 `eco4:NO_PRICE_RULE` 原样 */
const offers = (summary: string): (string | [string, number, [string, number], [string, number]])[] =>
  summary.split(" ").map((item) => {
    const match = /^([^:]+):(\d+)\((.+)\+(\d+),(.+)\+(\d+)\)$/.exec(item);
    return match === null ? item : [match[1] as string, Number(match[2]), [match[3] as string, Number(match[4])], [match[5] as string, Number(match[6])]];
  });

test("M9P-06 的 golden 变化：只有 big 商品里上 / 下车点落在①∩加价区的样例（全部列出），那一端的加价变成 0、总价正好少这么多；报不出的原因、别的商品一条不变", () => {
  const samples = new Map(charterGoldenSamples().map((sample) => [sample.key, sample]));
  const inBase = (key: string, end: "pickup" | "dropoff"): boolean => {
    const sample = samples.get(key);
    const point = sample?.request[end];
    return sample !== undefined && point !== null && point !== undefined && locateInAreas(sample.product.areas, point).operating.length > 0;
  };
  for (const [key, changed] of Object.entries(m9p06)) {
    assert.equal(changed.before, golden[key]?.summary, `旧 golden 没被改：${key}`);
    assert.ok(key.startsWith("big|"), `只有 big 变：${key}`);
    const [before, after] = [offers(changed.before), offers(changed.summary)];
    assert.equal(after.length, before.length, key);
    for (const [index, now] of after.entries()) {
      const old = before[index];
      if (old === undefined || typeof now === "string" || typeof old === "string") {
        assert.equal(now, old, `报不出的原因不变：${key}`);
        continue;
      }
      let dropped = 0;
      for (const [slot, end] of [[2, "pickup"], [3, "dropoff"]] as const) {
        if (now[slot][0] === old[slot][0] && now[slot][1] === old[slot][1]) continue;
        assert.ok(inBase(key, end), `变的那一端在①里：${key} ${end}`);
        assert.deepEqual(now[slot], ["-", 0], `①里的那一端加价是 0：${key} ${end}`);
        dropped += old[slot][1];
      }
      assert.equal(old[1] - now[1], dropped, `总价正好少了①里那几端的加价：${key}`);
    }
  }
  // 反过来：big 里一端在①里、旧 golden 收了那一端加价的样例，全都在变化清单里
  for (const [key, entry] of Object.entries(golden)) {
    if (!key.startsWith("big|")) continue;
    const charged = offers(entry.summary).some((item) => typeof item !== "string" && ((item[2][1] > 0 && inBase(key, "pickup")) || (item[3][1] > 0 && inBase(key, "dropoff"))));
    if (charged) assert.ok(m9p06[key] !== undefined, `漏列：${key}`);
  }
  assert.equal(Object.keys(m9p06).length, 115);
});

test("golden 样例覆盖到了各种情形（防止样例退化成全是报不出）", () => {
  const summaries = Object.values(golden).map((entry) => entry.summary);
  const has = (pattern: RegExp): boolean => summaries.some((summary) => pattern.test(summary));
  // 重叠取最高：富士山（1000）和富士北（1500）重叠处上车取富士北
  assert.ok(has(/biz7:\d+\(fuji-north\+1500,/), "重叠取最高");
  // 大区盖小区：旧 golden 里大东京商品的八王子上车收 800（M8-38）；M9P-06 起基础价区域优先，是 0
  assert.ok(golden["big|2026-10-20T10:00|8h|hachioji→tokyo"]?.summary.startsWith("biz7:50800(hachioji+800,-+0)"));
  assert.ok(m9p06["big|2026-10-20T10:00|8h|hachioji→tokyo"]?.summary.startsWith("biz7:50000(-+0,-+0)"));
  for (const reason of ["PRICE_RULE_DISABLED", "PRICE_NOT_IN_EFFECT", "NO_PRICE_RULE", "DROPOFF_REQUIRED", "IN_FORBIDDEN_AREA", "OUT_OF_SERVICE_AREA", "NO_PRICING_AREA"]) assert.ok(has(new RegExp(reason)), reason);
  assert.ok(Object.keys(golden).length > 2_000);
});
