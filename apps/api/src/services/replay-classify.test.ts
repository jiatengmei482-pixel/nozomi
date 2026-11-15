/**
 * M9P-14：回放逐行明细和差异归类（ADR 0093 第六节第 5 小节）。逐行明细的 digest 和摘要行一致；归类按车型组比、拆不开的算「未归类」；命令行读两份应答。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProductQuote } from "@nozomi/domain";
import { classifyFiles } from "../cli/replay-classify.ts";
import { classifyReplay, classifyRow } from "./replay-classify.ts";
import { type ReplayRow, type ReplayRowOffer, replayDigest, replayDigestLine, replayRow } from "./replay-digest.ts";

const offer = (changes: Partial<ReplayRowOffer> = {}): ReplayRowOffer => ({ vehicleGroupId: "eco7", packageHours: 10, totalMinor: 65_000, currency: "JPY", overtimeMinor: 0, surcharge: { packageMinor: 55_000, pickupMinor: 0, dropoffMinor: 0, itineraryMinor: 10_000 }, ...changes });
const row = (offers: ReplayRowOffer[], changes: Partial<ReplayRow> = {}): ReplayRow => ({ logId: "log-1", productCode: "P-1", digest: `d${JSON.stringify(offers)}${changes.refused ?? ""}`, refused: null, offers, refusedGroups: [], ...changes });

test("逐行明细和摘要行是同一行：digest 等于 resultLineDigests 里的那一项；拆出套餐价、上下车、行程加价合计和超时费", () => {
  const quote = {
    ok: true,
    productId: "p",
    tenantId: "t",
    serviceDate: "2026-10-20",
    urgent: false,
    offers: [
      {
        vehicleGroupId: "eco7",
        packageHours: 10,
        areaId: "tokyo",
        priceRuleId: "r",
        settlement: { totalMinor: 75_000, currency: "JPY", itinerary: { overtimeMinor: 0 }, areaSurcharge: { packageMinor: 55_000, pickup: { areaId: null, amountMinor: 0 }, dropoff: { areaId: "fuji", amountMinor: 10_000 }, waypoints: [{ areaId: "fuji", amountMinor: 6_000, stopSeqs: [1] }, { areaId: "hakone", amountMinor: 4_000, stopSeqs: [2] }] } },
      },
    ],
    refused: [{ vehicleGroupId: "lux4", reason: "NO_PRICE_RULE" }],
  } as unknown as ProductQuote;
  const line = replayDigestLine("log-1", "P-1", quote);
  const detail = replayRow(line, quote);
  assert.equal(detail.digest, replayDigest([line]).resultLineDigests[0]?.digest);
  assert.deepEqual(detail.offers, [{ vehicleGroupId: "eco7", packageHours: 10, totalMinor: 75_000, currency: "JPY", overtimeMinor: 0, surcharge: { packageMinor: 55_000, pickupMinor: 0, dropoffMinor: 10_000, itineraryMinor: 10_000 } }]);
  assert.deepEqual(detail.refusedGroups, [{ vehicleGroupId: "lux4", reason: "NO_PRICE_RULE" }]);
  const refused = { ok: false, productId: "p", tenantId: "t", reason: "OUT_OF_SERVICE_AREA" } as unknown as ProductQuote;
  assert.deepEqual(replayRow(replayDigestLine("log-2", "P-1", refused), refused).refused, "OUT_OF_SERVICE_AREA");
});

test("归类：加价、超时费、选档、套餐价、13 小时拦截各自认得出；差额拆不开、报不出的原因换了算未归类", () => {
  const base = offer();
  // 第 1、2、9、10 类：加价变了、差额正好是加价的差
  assert.deepEqual(classifyRow(row([base]), row([offer({ totalMinor: 75_000, surcharge: { ...(base.surcharge as NonNullable<ReplayRowOffer["surcharge"]>), dropoffMinor: 10_000 } })])), ["surcharge"]);
  // 加价变了 1 万、总价却变了 1 万 1：拆不开
  assert.deepEqual(classifyRow(row([base]), row([offer({ totalMinor: 76_000, surcharge: { ...(base.surcharge as NonNullable<ReplayRowOffer["surcharge"]>), dropoffMinor: 10_000 } })])), ["surcharge", "unclassified"]);
  // 第 4 类：不再预收超时费
  assert.deepEqual(classifyRow(row([offer({ totalMinor: 71_000, overtimeMinor: 6_000 })]), row([base])), ["overtime"]);
  // 第 5、7 类：档变了（金额跟着档走）
  assert.deepEqual(classifyRow(row([offer({ packageHours: 4, totalMinor: 34_000 })]), row([offer({ packageHours: 5, totalMinor: 33_000 })])), ["package"]);
  // 第 8 类：同一档的套餐价变了
  assert.deepEqual(classifyRow(row([base]), row([offer({ totalMinor: 66_000, surcharge: { ...(base.surcharge as NonNullable<ReplayRowOffer["surcharge"]>), packageMinor: 56_000 } })])), ["package_price"]);
  // 第 12 类：车型组 / 整个商品因超长不报
  assert.deepEqual(classifyRow(row([base]), row([], { refusedGroups: [{ vehicleGroupId: "eco7", reason: "ITINERARY_TOO_LONG" }] })), ["too_long"]);
  assert.deepEqual(classifyRow(row([base]), row([], { refused: "ITINERARY_TOO_LONG" })), ["too_long"]);
  // 别的原因报不出、原因换了、金额变了却什么都没变：未归类
  assert.deepEqual(classifyRow(row([base]), row([], { refused: "NO_PRODUCT" })), ["unclassified"]);
  assert.deepEqual(classifyRow(row([base]), row([], { refusedGroups: [{ vehicleGroupId: "eco7", reason: "NO_PRICE_RULE" }] })), ["unclassified"]);
  assert.deepEqual(classifyRow(row([base]), row([offer({ totalMinor: 65_001 })])), ["unclassified"]);
  assert.deepEqual(classifyRow(row([], { refusedGroups: [{ vehicleGroupId: "eco7", reason: "NO_PRICE_RULE" }] }), row([], { refusedGroups: [{ vehicleGroupId: "eco7", reason: "PRICE_RULE_DISABLED" }] })), ["unclassified"]);
  // 新报出来的（以前报不出）：不在任何有意改动里
  assert.deepEqual(classifyRow(row([], { refused: "OUT_OF_SERVICE_AREA" }), row([base])), ["unclassified"]);
});

test("两份明细对齐：摘要一样的算没变；只有一边有的单独计数；每类计数", () => {
  const same = row([offer()], { logId: "a" });
  const before = [same, row([offer({ totalMinor: 71_000, overtimeMinor: 6_000 })], { logId: "b" }), row([offer()], { logId: "gone" })];
  const after = [same, row([offer()], { logId: "b" }), row([offer()], { logId: "new" })];
  const result = classifyReplay(before, after);
  assert.deepEqual([result.unchanged, result.onlyBefore, result.onlyAfter, result.counts], [1, 1, 1, { overtime: 1 }]);
  assert.deepEqual(result.diffs, [{ logId: "b", productCode: "P-1", categories: ["overtime"], before: [{ vehicleGroupId: "eco7", packageHours: 10, totalMinor: 71_000 }], after: [{ vehicleGroupId: "eco7", packageHours: 10, totalMinor: 65_000 }] }]);
});

test("命令行：读两份应答（整份或只有 replay）；有未归类或窗口不同判失败；stateDigest 不同标出来；没有 resultRows 报错", async () => {
  const dir = await mkdtemp(join(tmpdir(), "replay-classify-"));
  try {
    const write = async (name: string, value: unknown): Promise<string> => {
      const file = join(dir, name);
      await writeFile(file, JSON.stringify(value));
      return file;
    };
    const replay = (rows: ReplayRow[], state = "s1") => ({ until: "2026-11-14T09:13:00.000Z", days: 30, stateDigest: state, resultRows: rows });
    const before = await write("before.json", { replay: replay([row([offer({ totalMinor: 71_000, overtimeMinor: 6_000 })])]) });
    const after = await write("after.json", replay([row([offer()])]));
    const ok = await classifyFiles(before, after);
    assert.equal(ok.failed, false);
    assert.deepEqual((ok.output as any).counts, { "不再预收超时费（第 4 类）": 1 });
    assert.equal((ok.output as any).sameState, true);
    const odd = await write("odd.json", replay([row([offer({ totalMinor: 1 })])], "s2"));
    const bad = await classifyFiles(before, odd);
    assert.equal(bad.failed, true);
    assert.match((bad.output as any).warning, /stateDigest 不一样/);
    const window = await write("window.json", { ...replay([row([offer()])]), days: 7 });
    assert.equal((await classifyFiles(before, window)).failed, true, "天数不同不能比");
    const missing = await write("missing.json", { replay: { until: "x" } });
    await assert.rejects(classifyFiles(before, missing), /rows=true/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
