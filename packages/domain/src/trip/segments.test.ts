/** 分段判定与拆法（ADR 0100 第三节第 3、4 小节）。 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { type SegmentPoint, classifySegment, daySplitOptions, naturalBreakpoints, pointTimes } from "./segments.ts";

const p = (extra: Partial<SegmentPoint> = {}): SegmentPoint => ({ isAirport: false, isStation: false, isHotel: false, stayMinutes: 0, ...extra });
const airport = p({ isAirport: true });
const hotel = p({ isHotel: true });

test("两个点：机场起 → 接机；机场止 → 送机；都不是 → 点对点；三点以上 → 包车", () => {
  assert.equal(classifySegment([airport, hotel], 0, 1), "airport_pickup");
  assert.equal(classifySegment([hotel, airport], 0, 1), "airport_dropoff");
  assert.equal(classifySegment([airport, airport], 0, 1), "airport_pickup");
  assert.equal(classifySegment([hotel, p()], 0, 1), "p2p");
  assert.equal(classifySegment([airport, p({ stayMinutes: 30 }), hotel], 0, 2), "charter");
  assert.throws(() => classifySegment([hotel], 0, 0), RangeError);
});

test("两个点的一天只有「不拆」", () => {
  assert.deepEqual(daySplitOptions([airport, hotel]), [{ cuts: [], segments: [{ type: "airport_pickup", from: 0, to: 1 }] }]);
  assert.deepEqual(daySplitOptions([hotel]), []);
});

test("接机 + 下午游览：另试「接机 + 包车」", () => {
  const points = [airport, hotel, p({ stayMinutes: 30 }), hotel];
  assert.deepEqual(naturalBreakpoints(points), [1]);
  const options = daySplitOptions(points);
  assert.deepEqual(options.map((o) => o.cuts), [[], [1]]);
  assert.deepEqual(options[1]?.segments, [
    { type: "airport_pickup", from: 0, to: 1 },
    { type: "charter", from: 1, to: 3 },
  ]);
  assert.equal(options[0]?.segments[0]?.type, "charter");
});

test("停留 ≥ 60 分钟、车站、酒店都是断点；不拆 + 每刀 + 全拆，最多 4 种", () => {
  const points = [hotel, p({ stayMinutes: 60 }), p({ stayMinutes: 59 }), p({ isStation: true }), hotel];
  assert.deepEqual(naturalBreakpoints(points), [1, 3]);
  const options = daySplitOptions(points);
  assert.deepEqual(options.map((o) => o.cuts), [[], [1], [3], [1, 3]]);
  assert.deepEqual(options.map((o) => o.segments.length), [1, 2, 2, 3]);
  assert.deepEqual(options[3]?.segments.map((s) => s.type), ["p2p", "charter", "p2p"]);
});

test("超过 4 种：留不拆、机场旁的刀、第一个酒店，其余按先后", () => {
  const points = [airport, p({ stayMinutes: 120 }), p({ stayMinutes: 120 }), hotel, p({ stayMinutes: 90 }), hotel];
  const options = daySplitOptions(points);
  assert.equal(options.length, 4);
  assert.deepEqual(options.map((o) => o.cuts), [[], [1], [3], [2]]);
  for (const option of options) for (const segment of option.segments) assert.ok(segment.to > segment.from);
});

test("pointTimes：出发 = 到达 + 停留，跨午夜累加", () => {
  assert.deepEqual(pointTimes(1320, [60, 90], [0, 30, 0]), { arrive: [1320, 1380, 1500], depart: [1320, 1410, 1500] });
  assert.throws(() => pointTimes(0, [10], [0]), RangeError);
});
