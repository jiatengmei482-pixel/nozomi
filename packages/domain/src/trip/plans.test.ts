/** 方案组装、推荐、预算降级（ADR 0100 第三节第 5、6 小节；D1、D2）。 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { type QuotedDay, type QuotedSegment, type SegmentOffer, assembleDailyBest, budgetSplitOptions, oneCarCandidates, oneCarDays, recommendPlan } from "./plans.ts";
import type { SegmentDraft } from "./segments.ts";

const offer = (tenantId: string, sellMinor: number, extra: Partial<SegmentOffer> = {}): SegmentOffer => ({ tenantId, productId: `${tenantId}-p`, vehicleGroupId: "eco7", sellMinor, settlementMinor: Math.round(sellMinor / 1.15), winner: false, ...extra });
const seg = (type: SegmentDraft["type"], offers: SegmentOffer[]): QuotedSegment => {
  const min = offers.reduce<SegmentOffer | null>((m, o) => (m === null || o.sellMinor < m.sellMinor ? o : m), null);
  return { draft: { type, from: 0, to: type === "charter" ? 2 : 1 }, offers: offers.map((o) => ({ ...o, winner: o === min })) };
};

test("daily_best：每天取总价最低的拆法和中标价；一样时取段少的；没报价的天进 unquoted", () => {
  const days: QuotedDay[] = [
    { dayIndex: 0, options: [{ segments: [seg("charter", [offer("A", 60_000), offer("B", 55_000)])] }, { segments: [seg("airport_pickup", [offer("C", 20_000)]), seg("charter", [offer("B", 30_000)])] }] },
    { dayIndex: 1, options: [] },
    { dayIndex: 2, options: [{ segments: [seg("charter", [offer("A", 40_000)])] }, { segments: [seg("p2p", [offer("A", 20_000)]), seg("p2p", [offer("A", 20_000)])] }] },
    { dayIndex: 3, options: [{ segments: [seg("charter", [])] }] },
  ];
  const result = assembleDailyBest(days);
  assert.deepEqual(result.days.map((d) => [d.dayIndex, d.optionIndex, d.segments.map((s) => s.offer.tenantId).join("+")]), [[0, 1, "C+B"], [2, 0, "A"]]);
  assert.deepEqual(result.unquoted, [{ dayIndex: 3, reason: "NO_OFFER" }]);
});

test("one_car 候选 = 出现过的租户 × 车型组", () => {
  const days: QuotedDay[] = [{ dayIndex: 0, options: [{ segments: [seg("charter", [offer("A", 1), offer("B", 2), offer("A", 3, { vehicleGroupId: "van10" })])] }] }];
  assert.deepEqual(oneCarCandidates(days), [{ tenantId: "A", vehicleGroupId: "eco7" }, { tenantId: "B", vehicleGroupId: "eco7" }, { tenantId: "A", vehicleGroupId: "van10" }]);
});

test("one_car：同租户同车型组每天取自己的最低拆法（不一定是中标价）", () => {
  const days: QuotedDay[] = [
    { dayIndex: 0, options: [{ segments: [seg("charter", [offer("A", 60_000), offer("B", 50_000)])] }] },
    { dayIndex: 1, options: [{ segments: [seg("charter", [offer("A", 45_000), offer("B", 50_000)])] }] },
  ];
  const a = oneCarDays(days, { tenantId: "A", vehicleGroupId: "eco7" });
  assert.deepEqual(a?.map((d) => [d.dayIndex, d.segments[0]?.offer.sellMinor, d.otherVehicle]), [[0, 60_000, false], [1, 45_000, false]]);
});

test("one_car（D2）：机场日这家报不出 → 用当天中标价，标 otherVehicle；包车日报不出 → 不能一车到底", () => {
  const days: QuotedDay[] = [
    { dayIndex: 0, options: [{ segments: [seg("airport_pickup", [offer("C", 20_000)])] }] },
    { dayIndex: 1, options: [{ segments: [seg("charter", [offer("A", 45_000)])] }] },
  ];
  const a = oneCarDays(days, { tenantId: "A", vehicleGroupId: "eco7" });
  assert.deepEqual(a?.map((d) => [d.dayIndex, d.segments[0]?.offer.tenantId, d.otherVehicle]), [[0, "C", true], [1, "A", false]]);
  assert.equal(oneCarDays(days, { tenantId: "C", vehicleGroupId: "eco7" }), null);
});

test("one_car：机场日同租户能报（接送机或不拆按包车）就算同一辆车", () => {
  const days: QuotedDay[] = [
    { dayIndex: 0, options: [{ segments: [seg("charter", [offer("A", 50_000)])] }, { segments: [seg("airport_pickup", [offer("A", 18_000), offer("C", 15_000)]), seg("charter", [offer("A", 40_000)])] }] },
  ];
  const a = oneCarDays(days, { tenantId: "A", vehicleGroupId: "eco7" });
  assert.deepEqual(a?.map((d) => [d.optionIndex, d.otherVehicle, d.segments.map((s) => s.offer.sellMinor)]), [[0, false, [50_000]]]);
});

test("one_car：所有天都只能靠别家 → 不算一车到底", () => {
  const days: QuotedDay[] = [{ dayIndex: 0, options: [{ segments: [seg("airport_pickup", [offer("C", 20_000)])] }] }];
  assert.equal(oneCarDays(days, { tenantId: "A", vehicleGroupId: "eco7" }), null);
});

test("推荐：daily_best 便宜 10% 以上才推荐它；只有一个报出时推荐那个", () => {
  assert.equal(recommendPlan([{ kind: "one_car", quoted: true, sellMinor: 100_000 }, { kind: "daily_best", quoted: true, sellMinor: 90_000 }]), "daily_best");
  assert.equal(recommendPlan([{ kind: "one_car", quoted: true, sellMinor: 100_000 }, { kind: "daily_best", quoted: true, sellMinor: 90_001 }]), "one_car");
  assert.equal(recommendPlan([{ kind: "one_car", quoted: false, sellMinor: 0 }, { kind: "daily_best", quoted: true, sellMinor: 90_001 }]), "daily_best");
  assert.equal(recommendPlan([{ kind: "one_car", quoted: true, sellMinor: 100_000 }]), "one_car");
  assert.equal(recommendPlan([]), null);
});

test("预算：14 天 × 每天 4 种拆法（1+2+2+3 段）= 112 ≤ 120，不降级", () => {
  const counts = Array.from({ length: 14 }, () => [1, 2, 2, 3]);
  assert.deepEqual(budgetSplitOptions(counts), { keep: Array(14).fill(4), degraded: false });
});

test("预算：超出时按日期顺序，余下各天只报不拆；连不拆都超 → null", () => {
  const counts = [[1, 2, 2, 3], [1, 2, 2, 3], [1, 2]];
  assert.deepEqual(budgetSplitOptions(counts, 12), { keep: [4, 1, 1], degraded: true });
  assert.deepEqual(budgetSplitOptions([[], [1, 2]], 3), { keep: [0, 2], degraded: false });
  assert.equal(budgetSplitOptions([[3], [3]], 5), null);
});
