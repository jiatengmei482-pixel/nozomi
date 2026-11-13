/**
 * 只读回放的摘要值（M8-34 补充，ADR 0086）：同输入同摘要、改一分钱结果摘要变、改规则参数状态摘要变、行的先后不影响；不含时间、快照编号；
 * 回放窗口 [until − days, until) 的边界。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ProductQuote, SettlementBreakdown, VehicleOffer } from "@nozomi/domain";
import { inReplayWindow, replayWindow } from "./area-role-preview.ts";
import { type DigestLine, replayDigest, replayDigestLine, stableStringify, stateDigest } from "./replay-digest.ts";

const lineOf = (entry: DigestLine): string => entry.line;

const settlement = (totalMinor: number, extra: Partial<SettlementBreakdown> = {}): SettlementBreakdown => ({
  currency: "JPY",
  roundingUnit: 1,
  totalMinor,
  baseMinor: totalMinor,
  adjustMinor: 0,
  urgentMinor: 0,
  nightMinor: 0,
  addonsMinor: 0,
  driverLanguageMinor: 0,
  exact: { base: String(totalMinor), adjusted: String(totalMinor), night: "0", addons: "0", total: String(totalMinor) },
  adjusts: [],
  urgentTier: null,
  night: null,
  addons: [],
  driverLanguage: null,
  usage: null,
  freeWait: { item: "general", value: null, platformMinimumMinutes: 0 },
  ...extra,
});

const offer = (vehicleGroupId: string, totalMinor: number, extra: Partial<SettlementBreakdown> = {}): VehicleOffer => ({ vehicleGroupId, packageHours: 8, areaId: "area-1", priceRuleId: "rule-1", settlement: settlement(totalMinor, extra) });

const ok = (offers: VehicleOffer[], refused: { vehicleGroupId: string; reason: "CAPACITY_EXCEEDED" | "VEHICLE_GROUP_DISABLED" }[] = [], serviceDate = "2026-11-20"): ProductQuote => ({ ok: true, productId: "p-1", tenantId: "t-1", serviceDate, urgent: false, offers, refused });

const surcharge = (pickupMinor: number) => ({ areaSurcharge: { packageMinor: 40_000, pickup: { areaId: "s-1", priceRuleId: "sr-1", amountMinor: pickupMinor }, dropoff: { areaId: null, priceRuleId: null, amountMinor: 0 } } });

const sample = (): DigestLine[] => [
  replayDigestLine("log-1", "CH-1", ok([offer("vg-a", 45_000, surcharge(5_000)), offer("vg-b", 60_000)], [{ vehicleGroupId: "vg-c", reason: "CAPACITY_EXCEEDED" }])),
  replayDigestLine("log-1", "AT-1", { ok: false, productId: "p-2", tenantId: "t-1", reason: "OUT_OF_SERVICE_AREA" }),
  replayDigestLine("log-2", "CH-1", ok([offer("vg-a", 47_000)])),
];

test("同输入同摘要：十六进制 SHA-256，行数等于参与的「询价 × 商品」个数；空的也有固定的摘要", () => {
  const first = replayDigest(sample());
  assert.deepEqual(replayDigest(sample()), first);
  assert.match(first.resultDigest, /^[0-9a-f]{64}$/);
  assert.equal(first.resultLines, 3);
  assert.deepEqual(replayDigest([]), { resultDigest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", resultLines: 0, resultLineDigests: [] });
  // 逐行的摘要：按询价编号、商品编码排好，各是这一行的 SHA-256
  assert.deepEqual(first.resultLineDigests.map((entry) => [entry.logId, entry.productCode]), [["log-1", "AT-1"], ["log-1", "CH-1"], ["log-2", "CH-1"]]);
  for (const entry of first.resultLineDigests) assert.match(entry.digest, /^[0-9a-f]{64}$/);
});

test("行的先后、车型组的先后、报不出原因的先后都不影响摘要", () => {
  const lines = sample();
  assert.equal(replayDigest([...lines].reverse()).resultDigest, replayDigest(lines).resultDigest);
  const a = offer("vg-a", 45_000);
  const b = offer("vg-b", 60_000);
  const refusedA = { vehicleGroupId: "vg-c", reason: "CAPACITY_EXCEEDED" as const };
  const refusedB = { vehicleGroupId: "vg-d", reason: "VEHICLE_GROUP_DISABLED" as const };
  assert.deepEqual(replayDigestLine("log-1", "CH-1", ok([a, b], [refusedA, refusedB])), replayDigestLine("log-1", "CH-1", ok([b, a], [refusedB, refusedA])));
  assert.deepEqual(replayDigest([...lines].reverse()).resultLineDigests, replayDigest(lines).resultLineDigests);
});

test("改一分钱、改加价明细、改区域 / 规则 / 币种 / 计价方式 / 原因，摘要都会变", () => {
  const base = replayDigest(sample()).resultDigest;
  const changed = (line: DigestLine): string => {
    const lines = sample();
    lines[0] = line;
    return replayDigest(lines).resultDigest;
  };
  const refused = [{ vehicleGroupId: "vg-c", reason: "CAPACITY_EXCEEDED" as const }];
  assert.equal(changed(replayDigestLine("log-1", "CH-1", ok([offer("vg-a", 45_000, surcharge(5_000)), offer("vg-b", 60_000)], refused))), base);
  assert.notEqual(changed(replayDigestLine("log-1", "CH-1", ok([offer("vg-a", 45_001, surcharge(5_000)), offer("vg-b", 60_000)], refused))), base);
  assert.notEqual(changed(replayDigestLine("log-1", "CH-1", ok([offer("vg-a", 45_000, surcharge(5_001)), offer("vg-b", 60_000)], refused))), base);
  assert.notEqual(changed(replayDigestLine("log-1", "CH-1", ok([offer("vg-a", 45_000, { ...surcharge(5_000), currency: "USD" }), offer("vg-b", 60_000)], refused))), base);
  assert.notEqual(changed(replayDigestLine("log-1", "CH-1", ok([{ ...offer("vg-a", 45_000, surcharge(5_000)), areaId: "area-2" }, offer("vg-b", 60_000)], refused))), base);
  assert.notEqual(changed(replayDigestLine("log-1", "CH-1", ok([{ ...offer("vg-a", 45_000, surcharge(5_000)), priceRuleId: "rule-2" }, offer("vg-b", 60_000)], refused))), base);
  // 计价方式变了（金额一样）也算变
  assert.notEqual(changed(replayDigestLine("log-1", "CH-1", ok([offer("vg-a", 45_000, { ...surcharge(5_000), pricingBasis: "one_price_outside_km" }), offer("vg-b", 60_000)], refused))), base);
  assert.notEqual(changed(replayDigestLine("log-1", "CH-1", ok([offer("vg-a", 45_000, surcharge(5_000)), offer("vg-b", 60_000)], [{ vehicleGroupId: "vg-c", reason: "VEHICLE_GROUP_DISABLED" }]))), base);
  assert.notEqual(changed(replayDigestLine("log-1", "CH-1", { ok: false, productId: "p-1", tenantId: "t-1", reason: "OUT_OF_SERVICE_AREA" })), base);
  // 改了一分钱的那一行，逐行摘要只有这一行变
  const before = replayDigest(sample()).resultLineDigests;
  const lines = sample();
  lines[2] = replayDigestLine("log-2", "CH-1", ok([offer("vg-a", 47_001)]));
  const after = replayDigest(lines).resultLineDigests;
  assert.deepEqual(after.filter((entry, i) => entry.digest !== before[i]?.digest).map((entry) => [entry.logId, entry.productCode]), [["log-2", "CH-1"]]);
});

test("不看时间、快照、精确值写法这些不稳定的部分", () => {
  const plain = lineOf(replayDigestLine("log-1", "CH-1", ok([offer("vg-a", 45_000)])));
  assert.equal(lineOf(replayDigestLine("log-1", "CH-1", ok([offer("vg-a", 45_000, { exact: { base: "45000.0", adjusted: "45000.0", night: "0", addons: "0", total: "45000.0" } })], [], "2026-12-01"))), plain);
  assert.equal(lineOf(replayDigestLine("log-1", "CH-1", { ...ok([offer("vg-a", 45_000)]), productId: "p-other" })), plain);
});

const state = () => ({
  products: [{ id: "p-1", code: "CH-1", version: 3, status: "published" }],
  price_rules: [
    { id: "r-1", product_id: "p-1", area_id: "a-1", to_area_id: null, pricing_model: "fixed", params: { basePriceMinor: 45_000, includedKm: null }, valid_from: "2026-01-01", valid_to: null, status: "enabled" },
    { id: "r-2", product_id: "p-1", area_id: "a-2", to_area_id: null, pricing_model: "charter_area_surcharge", params: { amountMinor: 5_000 }, valid_from: "2026-01-01", valid_to: null, status: "enabled" },
  ],
  areas: [{ id: "a-1", version: 2, status: "active", shape_version: 4, role: "both" }],
});

test("状态摘要：同样的数据同样的摘要；行的先后、表的先后、参数里键的先后都不影响；改规则参数、生效日期、状态、区域图形版本、商品版本都会变", () => {
  const base = stateDigest(state());
  assert.match(base, /^[0-9a-f]{64}$/);
  assert.equal(stateDigest(state()), base);
  const reordered = state();
  reordered.price_rules.reverse();
  assert.equal(stateDigest({ areas: reordered.areas, price_rules: reordered.price_rules, products: reordered.products }), base);
  const keys = state();
  keys.price_rules[0] = { ...keys.price_rules[0]!, params: { includedKm: null, basePriceMinor: 45_000 } };
  assert.equal(stateDigest(keys), base);
  const edits: ((s: ReturnType<typeof state>) => void)[] = [
    (s) => (s.price_rules[0]!.params = { basePriceMinor: 45_001, includedKm: null }),
    (s) => (s.price_rules[1]!.params = { amountMinor: 5_500 }),
    (s) => (s.price_rules[0]!.valid_from = "2026-02-01"),
    (s) => (s.price_rules[0]!.status = "disabled"),
    (s) => (s.areas[0]!.shape_version = 5),
    (s) => (s.areas[0]!.status = "inactive"),
    (s) => (s.products[0]!.version = 4),
    (s) => s.price_rules.pop(),
  ];
  for (const edit of edits) {
    const next = state();
    edit(next);
    assert.notEqual(stateDigest(next), base, edit.toString());
  }
  assert.equal(stableStringify({ b: [1, { d: null, c: "x" }], a: new Date("2026-11-13T00:00:00Z") }), '{"a":"2026-11-13T00:00:00.000Z","b":[1,{"c":"x","d":null}]}');
});

test("回放窗口 [until − days, until)：含起点、不含截止时间；同一个 until 和天数，窗口一样", () => {
  const until = new Date("2026-11-13T00:00:00.000Z");
  const window = replayWindow(7, until);
  assert.equal(window.since.toISOString(), "2026-11-06T00:00:00.000Z");
  assert.equal(window.until.toISOString(), "2026-11-13T00:00:00.000Z");
  assert.deepEqual(replayWindow(7, new Date(until)), window);
  assert.equal(inReplayWindow(new Date("2026-11-06T00:00:00.000Z"), window), true);
  assert.equal(inReplayWindow(new Date("2026-11-12T23:59:59.999Z"), window), true);
  assert.equal(inReplayWindow(new Date("2026-11-13T00:00:00.000Z"), window), false);
  assert.equal(inReplayWindow(new Date("2026-11-05T23:59:59.999Z"), window), false);
});
