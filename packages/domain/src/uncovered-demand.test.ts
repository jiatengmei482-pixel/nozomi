import assert from "node:assert/strict";
import { test } from "node:test";
import type { Position } from "./areas.ts";
import type { QuoteArea } from "./quote.ts";
import {
  UNCOVERED_DEMAND_RULES,
  demandFingerprint,
  demandPlaceName,
  operatingHits,
  refusalCounts,
  roundDemandCoordinate,
  roundDemandPoint,
  uncoveredDemandCutoff,
  uncoveredDemandReason,
} from "./uncovered-demand.ts";

const square = (west: number, south: number, east: number, north: number): Position[] => [[west, south], [east, south], [east, north], [west, north]];
const area = (areaId: string, ring: Position[], forbid: Position[] | null = null, active = true): QuoteArea => ({
  areaId,
  active,
  shapes: [{ id: `${areaId}-op`, kind: "operate", ring }, ...(forbid === null ? [] : [{ id: `${areaId}-no`, kind: "forbid" as const, ring: forbid }])],
});

test("operatingHits：一个点落在哪些供应商的哪些运营区域里（营运区里、不在那个区域的禁行区里；停用的不算；去重）", () => {
  const suppliers = [
    { tenantId: "t1", operatingAreas: [area("big", square(139, 35, 140, 36)), area("west", square(139, 35, 139.5, 36), square(139.1, 35.4, 139.3, 35.6))] },
    { tenantId: "t2", operatingAreas: [area("off", square(139, 35, 140, 36), null, false)] },
    { tenantId: "t1", operatingAreas: [area("big", square(139, 35, 140, 36))] },
  ];
  assert.deepEqual(operatingHits(suppliers, { lng: 139.2, lat: 35.5 }), [{ tenantId: "t1", areaId: "big" }]);
  assert.deepEqual(operatingHits(suppliers, { lng: 139.45, lat: 35.5 }), [{ tenantId: "t1", areaId: "big" }, { tenantId: "t1", areaId: "west" }]);
  assert.deepEqual(operatingHits(suppliers, { lng: 141, lat: 35.5 }), []);
  assert.deepEqual(operatingHits(suppliers, null), []);
});

test("主原因：没有候选或任一要校验的点不在任何运营区域里 → OUTSIDE_OPERATING；点都在运营区域里、拒绝原因全是区域原因 → NO_PRICING_AREA；其余 OTHER", () => {
  const hit = [{ tenantId: "t1", areaId: "a" }];
  assert.equal(uncoveredDemandReason({ candidateCount: 0, checkedPoints: [hit], refusals: [] }), "OUTSIDE_OPERATING");
  assert.equal(uncoveredDemandReason({ candidateCount: 2, checkedPoints: [hit, []], refusals: ["NO_PRICING_AREA"] }), "OUTSIDE_OPERATING");
  assert.equal(uncoveredDemandReason({ candidateCount: 2, checkedPoints: [hit, hit], refusals: ["NO_PRICING_AREA", "OUT_OF_SERVICE_AREA", "IN_FORBIDDEN_AREA"] }), "NO_PRICING_AREA");
  assert.equal(uncoveredDemandReason({ candidateCount: 2, checkedPoints: [hit], refusals: ["NO_PRICING_AREA", "LEAD_TIME_TOO_SHORT"] }), "OTHER");
  assert.equal(uncoveredDemandReason({ candidateCount: 1, checkedPoints: [hit], refusals: [] }), "OTHER");
});

test("拒绝原因计数：原因 → 次数，键按字母排", () => {
  assert.deepEqual(refusalCounts(["SOLD_OUT", "NO_PRICING_AREA", "SOLD_OUT"]), { NO_PRICING_AREA: 1, SOLD_OUT: 2 });
  assert.deepEqual(Object.keys(refusalCounts(["Z", "A", "M"])), ["A", "M", "Z"]);
  assert.deepEqual(refusalCounts([]), {});
});

test("坐标只存 4 位小数（约 10 米）；负零写成 0", () => {
  assert.equal(UNCOVERED_DEMAND_RULES.coordinateDecimals, 4);
  assert.equal(roundDemandCoordinate(139.767_125_9), 139.7671);
  assert.equal(roundDemandCoordinate(35.681_25), 35.6813);
  assert.equal(roundDemandCoordinate(-0.000_01), 0);
  assert.ok(Object.is(roundDemandCoordinate(-0.000_01), 0));
  assert.deepEqual(roundDemandPoint({ lat: 35.123_456, lng: -122.987_654 }), { lat: 35.1235, lng: -122.9877 });
  assert.equal(roundDemandPoint(null), null);
});

test("地点名称：去空白和控制字符、最多 200 个字（按字符）；空的为 null；不是字符串为 null", () => {
  assert.equal(demandPlaceName("  东京站\n八重洲口\t "), "东京站 八重洲口");
  assert.equal(demandPlaceName("   "), null);
  assert.equal(demandPlaceName(null), null);
  assert.equal(demandPlaceName(undefined), null);
  const long = "😀".repeat(250);
  assert.equal(Array.from(demandPlaceName(long) ?? "").length, 200);
});

test("去重指纹：同一渠道、品类、方向、套餐、两端（3 位小数）、日期、人数、车型组 → 同一个；任何一项不同 → 不同；64 位十六进制", () => {
  const base = { channelId: "c1", category: "point_to_point" as const, direction: null, packageHours: null, pickup: { lat: 35.6812, lng: 139.7671 }, dropoff: { lat: 35.7, lng: 139.8 }, serviceDate: "2026-12-01", passengers: 2, vehicleGroupId: null };
  const fingerprint = demandFingerprint(base);
  assert.match(fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(demandFingerprint({ ...base, pickup: { lat: 35.68124, lng: 139.76712 } }), fingerprint, "100 米以内挪一点仍是同一条");
  for (const changed of [
    { channelId: "c2" },
    { category: "charter" as const, packageHours: 8 },
    { pickup: { lat: 35.69, lng: 139.7671 } },
    { dropoff: null },
    { serviceDate: "2026-12-02" },
    { passengers: 3 },
    { vehicleGroupId: "vg" },
  ]) {
    assert.notEqual(demandFingerprint({ ...base, ...changed }), fingerprint, JSON.stringify(changed));
  }
  assert.notEqual(demandFingerprint({ ...base, category: "airport_transfer", direction: "pickup" }), demandFingerprint({ ...base, category: "airport_transfer", direction: "dropoff" }));
});

test("保留期 365 天", () => {
  const now = new Date("2027-01-01T00:00:00Z");
  assert.equal(uncoveredDemandCutoff(now).toISOString(), "2026-01-01T00:00:00.000Z");
});
