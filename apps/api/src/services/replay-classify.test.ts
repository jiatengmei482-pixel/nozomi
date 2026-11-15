/**
 * M9P-14：回放逐行明细和差异归类（ADR 0093 第六节第 5 小节）。逐行明细的 digest 和摘要行一致；归类按车型组比、拆账在调价前的基础价上；
 * 只有区域 / 规则变了单列；旧格式日志的选档、超时费单列；只有一边有的行、声明以外的类别、数据状态不同都判失败；命令行读两份应答。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProductQuote } from "@nozomi/domain";
import { EXIT, classifyFiles, parseAllow } from "../cli/replay-classify.ts";
import { classifyReplay, classifyRow, replayVerdict } from "./replay-classify.ts";
import { type ReplayRow, type ReplayRowOffer, replayDigest, replayDigestLine, replayRow } from "./replay-digest.ts";

type Surcharge = NonNullable<ReplayRowOffer["surcharge"]>;
const SURCHARGE: Surcharge = { packageMinor: 55_000, pickupMinor: 0, dropoffMinor: 0, itineraryMinor: 10_000 };
/** 10h 套餐 55,000 + 行程加价 10,000 = 基础价 65,000，没有调价 */
const offer = (changes: Partial<ReplayRowOffer> = {}): ReplayRowOffer => ({ vehicleGroupId: "eco7", packageHours: 10, totalMinor: 65_000, currency: "JPY", pricingBasis: "one_price", areaId: "tokyo", toAreaId: null, priceRuleId: "r-10", baseMinor: 65_000, adjustMinor: 0, overtimeMinor: 0, surcharge: SURCHARGE, ...changes });
const row = (offers: ReplayRowOffer[], changes: Partial<ReplayRow> = {}): ReplayRow => ({ logId: "log-1", productCode: "P-1", digest: `d${JSON.stringify(offers)}${changes.refused ?? ""}${JSON.stringify(changes.refusedGroups ?? [])}`, legacy: false, manualPackage: false, refused: null, offers, refusedGroups: [], ...changes });

test("逐行明细和摘要行是同一行：digest 等于 resultLineDigests 里的那一项；带上摘要里的区域、规则、计价方式和基础价、调价、加价拆项", () => {
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
        settlement: { totalMinor: 82_500, baseMinor: 75_000, adjustMinor: 7_500, currency: "JPY", pricingBasis: "one_price", itinerary: { overtimeMinor: 0 }, areaSurcharge: { packageMinor: 55_000, pickup: { areaId: null, amountMinor: 0 }, dropoff: { areaId: "fuji", amountMinor: 10_000 }, waypoints: [{ areaId: "fuji", amountMinor: 6_000, stopSeqs: [1] }, { areaId: "hakone", amountMinor: 4_000, stopSeqs: [2] }] } },
      },
    ],
    refused: [{ vehicleGroupId: "lux4", reason: "NO_PRICE_RULE" }],
  } as unknown as ProductQuote;
  const line = replayDigestLine("log-1", "P-1", quote);
  const detail = replayRow(line, quote, { legacy: true, manualPackage: true });
  assert.equal(detail.digest, replayDigest([line]).resultLineDigests[0]?.digest);
  assert.deepEqual([detail.legacy, detail.manualPackage], [true, true]);
  assert.deepEqual(detail.offers, [{ vehicleGroupId: "eco7", packageHours: 10, totalMinor: 82_500, currency: "JPY", pricingBasis: "one_price", areaId: "tokyo", toAreaId: null, priceRuleId: "r", baseMinor: 75_000, adjustMinor: 7_500, overtimeMinor: 0, surcharge: { packageMinor: 55_000, pickupMinor: 0, dropoffMinor: 10_000, itineraryMinor: 10_000 } }]);
  assert.deepEqual(detail.refusedGroups, [{ vehicleGroupId: "lux4", reason: "NO_PRICE_RULE" }]);
  const refused = { ok: false, productId: "p", tenantId: "t", reason: "OUT_OF_SERVICE_AREA" } as unknown as ProductQuote;
  assert.deepEqual([replayRow(replayDigestLine("log-2", "P-1", refused), refused).refused, replayRow(replayDigestLine("log-2", "P-1", refused), refused).legacy], ["OUT_OF_SERVICE_AREA", false]);
});

test("归类：加价、超时费、选档、套餐价、13 小时拦截各自认得出；拆账在调价前的基础价上，+10% 调价下加价变了也拆得平", () => {
  // 第 1、2、9、10 类：下车加价多了 10,000，基础价也多 10,000
  assert.deepEqual(classifyRow(row([offer()]), row([offer({ baseMinor: 75_000, totalMinor: 75_000, surcharge: { ...SURCHARGE, dropoffMinor: 10_000 } })])), ["surcharge"]);
  // 商品有 +10% 调价：基础价 65,000 → 75,000，调价 6,500 → 7,500，总价 71,500 → 82,500；总价差 11,000 ≠ 加价差 10,000，按基础价拆账照样平
  assert.deepEqual(classifyRow(row([offer({ adjustMinor: 6_500, totalMinor: 71_500 })]), row([offer({ baseMinor: 75_000, adjustMinor: 7_500, totalMinor: 82_500, surcharge: { ...SURCHARGE, dropoffMinor: 10_000 } })])), ["surcharge"]);
  // 加价多了 10,000，基础价却多了 11,000：拆不平
  assert.deepEqual(classifyRow(row([offer()]), row([offer({ baseMinor: 76_000, totalMinor: 76_000, surcharge: { ...SURCHARGE, dropoffMinor: 10_000 } })])), ["surcharge", "unclassified"]);
  // 第 4 类：不再预收超时费
  assert.deepEqual(classifyRow(row([offer({ baseMinor: 71_000, totalMinor: 71_000, overtimeMinor: 6_000 })]), row([offer()])), ["overtime"]);
  // 第 5、7 类：档变了（金额跟着档走）
  assert.deepEqual(classifyRow(row([offer({ packageHours: 4, baseMinor: 34_000, totalMinor: 34_000 })]), row([offer({ packageHours: 5, baseMinor: 33_000, totalMinor: 33_000 })])), ["package"]);
  // 第 8 类：同一档的套餐价变了
  assert.deepEqual(classifyRow(row([offer()]), row([offer({ baseMinor: 66_000, totalMinor: 66_000, surcharge: { ...SURCHARGE, packageMinor: 56_000 } })])), ["package_price"]);
  // 第 12 类：车型组 / 整个商品因超长不报
  assert.deepEqual(classifyRow(row([offer()]), row([], { refusedGroups: [{ vehicleGroupId: "eco7", reason: "ITINERARY_TOO_LONG" }] })), ["too_long"]);
  assert.deepEqual(classifyRow(row([offer()]), row([], { refused: "ITINERARY_TOO_LONG" })), ["too_long"]);
});

test("归类：只有区域 / 规则 / 计价方式变了单列；旧格式日志的选档、超时费单列；别的都是未归类", () => {
  for (const changes of [{ priceRuleId: "r-other" }, { areaId: "tokyo-2" }, { toAreaId: "x" }, { pricingBasis: "distance_only" }]) assert.deepEqual(classifyRow(row([offer()]), row([offer(changes)])), ["ids_only"], JSON.stringify(changes));
  const legacy = { legacy: true };
  assert.deepEqual(classifyRow(row([offer({ packageHours: 4, baseMinor: 34_000, totalMinor: 34_000 })], legacy), row([offer({ packageHours: 5, baseMinor: 33_000, totalMinor: 33_000 })], legacy)), ["package_fixed"]);
  assert.deepEqual(classifyRow(row([offer({ baseMinor: 71_000, totalMinor: 71_000, overtimeMinor: 6_000 })], legacy), row([offer()], legacy)), ["overtime_unexpected"]);
  assert.deepEqual(classifyRow(row([offer()]), row([offer({ baseMinor: 71_000, totalMinor: 71_000, overtimeMinor: 6_000 })])), ["overtime_unexpected"], "新口径多收超时费也不是有意的");
  // 客人手动选的档（charter_selection: manual）：档变了不是有意的
  assert.deepEqual(classifyRow(row([offer({ packageHours: 8, baseMinor: 60_000, totalMinor: 60_000 })], { manualPackage: true }), row([offer({ packageHours: 10 })], { manualPackage: true })), ["package_fixed"]);
  assert.deepEqual(classifyRow(row([offer()]), row([], { refused: "NO_PRODUCT" })), ["unclassified"]);
  assert.deepEqual(classifyRow(row([offer()]), row([], { refusedGroups: [{ vehicleGroupId: "eco7", reason: "NO_PRICE_RULE" }] })), ["unclassified"]);
  assert.deepEqual(classifyRow(row([offer()]), row([offer({ baseMinor: 65_001, totalMinor: 65_001 })])), ["unclassified"]);
  assert.deepEqual(classifyRow(row([], { refusedGroups: [{ vehicleGroupId: "eco7", reason: "NO_PRICE_RULE" }] }), row([], { refusedGroups: [{ vehicleGroupId: "eco7", reason: "PRICE_RULE_DISABLED" }] })), ["unclassified"]);
  assert.deepEqual(classifyRow(row([], { refused: "OUT_OF_SERVICE_AREA" }), row([offer()])), ["unclassified"]);
});

test("#266 复核必改：已有有意类别时，基础价以外的变化（夜间等）、调价从无到有照样补未归类；基础价不变时调价变了也是未归类", () => {
  const surcharged = { ...SURCHARGE, dropoffMinor: 10_000 };
  // 复核例 1：加价 +10,000，同时总价里基础价、调价以外的部分多了 3,000（例如夜间费）
  assert.deepEqual(classifyRow(row([offer()]), row([offer({ baseMinor: 75_000, totalMinor: 78_000, surcharge: surcharged })])), ["surcharge", "unclassified"]);
  // 复核例 2：加价 +10,000，同时调价从 0 跳到 50,000
  assert.deepEqual(classifyRow(row([offer()]), row([offer({ baseMinor: 75_000, adjustMinor: 50_000, totalMinor: 125_000, surcharge: surcharged })])), ["surcharge", "unclassified"]);
  // 基础价没变、调价变了（总价跟着变）
  assert.deepEqual(classifyRow(row([offer({ adjustMinor: 6_500, totalMinor: 71_500 })]), row([offer({ adjustMinor: 7_000, totalMinor: 72_000 })])), ["unclassified"]);
  // 选档变了时夜间费可以跟着时长变（按小时收），不要求基础价以外的部分不变
  assert.deepEqual(classifyRow(row([offer({ packageHours: 4, baseMinor: 34_000, totalMinor: 36_000 })]), row([offer({ packageHours: 5, baseMinor: 33_000, totalMinor: 35_500 })])), ["package"]);
});

test("对齐和判定：摘要一样的算没变；只有一边有的行判失败；声明以外的类别判失败；不声明时 ids_only 和旧格式两类也失败；输出带报不出的原因", () => {
  const same = row([offer()], { logId: "a" });
  const changed = row([offer({ baseMinor: 71_000, totalMinor: 71_000, overtimeMinor: 6_000 })], { logId: "b" });
  const result = classifyReplay([same, changed], [same, row([offer()], { logId: "b" })]);
  assert.deepEqual([result.unchanged, result.onlyBefore, result.onlyAfter, result.counts], [1, [], [], { overtime: 1 }]);
  assert.deepEqual(result.diffs[0]?.before, { offers: [{ vehicleGroupId: "eco7", packageHours: 10, baseMinor: 71_000, adjustMinor: 0, totalMinor: 71_000 }], refused: null, refusedGroups: [] });
  assert.deepEqual(replayVerdict(result, null), { passed: true, undeclared: [] });
  assert.deepEqual(replayVerdict(result, ["surcharge"]), { passed: false, undeclared: ["overtime"] });
  const oneSided = classifyReplay([same, row([offer()], { logId: "gone" })], [same, row([offer()], { logId: "new" })]);
  assert.deepEqual([oneSided.onlyBefore, oneSided.onlyAfter], [[{ logId: "gone", productCode: "P-1" }], [{ logId: "new", productCode: "P-1" }]]);
  assert.equal(replayVerdict(oneSided, null).passed, false);
  const idsOnly = classifyReplay([same], [row([offer({ priceRuleId: "r-x" })], { logId: "a" })]);
  assert.deepEqual(replayVerdict(idsOnly, null), { passed: false, undeclared: ["ids_only"] });
  assert.equal(replayVerdict(idsOnly, ["ids_only"]).passed, true);
  const refusedNow = classifyReplay([same], [row([], { logId: "a", refused: "ITINERARY_TOO_LONG" })]);
  assert.deepEqual([refusedNow.diffs[0]?.after.refused, refusedNow.counts], ["ITINERARY_TOO_LONG", { too_long: 1 }]);
  assert.deepEqual(parseAllow("surcharge, package"), ["surcharge", "package"]);
  assert.equal(parseAllow(undefined), null);
  assert.throws(() => parseAllow("surcharge,nope"), /nope/);
});

test("命令行：读两份应答（整份或只有 replay）；退出码——通过 0、失败 1、数据状态不同 3；没有 resultRows 报错", async () => {
  const dir = await mkdtemp(join(tmpdir(), "replay-classify-"));
  try {
    const write = async (name: string, value: unknown): Promise<string> => {
      const file = join(dir, name);
      await writeFile(file, JSON.stringify(value));
      return file;
    };
    const replay = (rows: ReplayRow[], state = "s1") => ({ until: "2026-11-14T09:13:00.000Z", days: 30, stateDigest: state, resultRows: rows });
    const before = await write("before.json", { replay: replay([row([offer({ baseMinor: 71_000, totalMinor: 71_000, overtimeMinor: 6_000 })])]) });
    const after = await write("after.json", replay([row([offer()])]));
    const ok = await classifyFiles(before, after);
    assert.equal(ok.exitCode, EXIT.passed);
    assert.deepEqual((ok.output as any).counts, { "overtime：不再预收超时费（第 4 类）": 1 });
    assert.equal((await classifyFiles(before, after, ["surcharge"])).exitCode, EXIT.failed, "声明以外的类别");
    const odd = await write("odd.json", replay([row([offer({ baseMinor: 1, totalMinor: 1 })])]));
    assert.equal((await classifyFiles(before, odd)).exitCode, EXIT.failed, "未归类");
    const moved = await write("moved.json", replay([row([offer()])], "s2"));
    const state = await classifyFiles(before, moved);
    assert.equal(state.exitCode, EXIT.stateChanged);
    assert.match((state.output as any).warning, /stateDigest 不一样/);
    assert.deepEqual([(state.output as any).passed, (state.output as any).classificationPassed], [false, true], "归类本身是通过的");
    // 迁移这类有意改数据的比对：--expect-state-change 按归类本身判
    const migration = await classifyFiles(before, moved, null, { expectStateChange: true });
    assert.deepEqual([migration.exitCode, (migration.output as any).passed, "warning" in (migration.output as any)], [EXIT.passed, true, false]);
    const brokenMigration = await write("broken.json", replay([row([offer({ baseMinor: 1, totalMinor: 1 })])], "s2"));
    assert.equal((await classifyFiles(before, brokenMigration, null, { expectStateChange: true })).exitCode, EXIT.failed);
    const window = await write("window.json", { ...replay([row([offer()])]), days: 7 });
    assert.equal((await classifyFiles(before, window)).exitCode, EXIT.failed, "天数不同不能比");
    const missing = await write("missing.json", { replay: { until: "x" } });
    await assert.rejects(classifyFiles(before, missing), /rows=true/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
