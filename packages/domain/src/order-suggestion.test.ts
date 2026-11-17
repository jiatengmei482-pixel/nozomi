import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ORDER_SUGGESTION_RULES,
  type SuggestionStop,
  judgeSuggestion,
  orderSuggestionCacheKey,
  orderedPoints,
  refsInOrder,
  reorderByRefs,
  sameStopSet,
  segmentsToOptimize,
  suggestedOrder,
  suggestionRequestKey,
  suggestionSegments,
} from "./order-suggestion.ts";

const P = { lat: 35.6896, lng: 139.7006 };
const D = { lat: 35.6812, lng: 139.7671 };
const stop = (ref: string, i: number, fixed = false): SuggestionStop => ({ ref, lat: 35.4 + i / 10, lng: 138.7 + i / 10, ...(fixed ? { fixed } : {}) });
const THRESHOLDS = { minSavedMeters: 5_000, minSavedMinutes: 10 };

test("切段：没有固定点是一段；固定点在头、中、尾、相邻两个固定点；段内少于 2 个可动经停不问谷歌", () => {
  const a = stop("a", 1);
  const b = stop("b", 2);
  const c = stop("c", 3);
  const f = stop("f", 4, true);
  const g = stop("g", 5, true);
  assert.deepEqual(suggestionSegments(P, [a, b, c], D).map((s) => s.movable.map((x) => x.ref)), [["a", "b", "c"]]);
  assert.deepEqual(suggestionSegments(P, [f, a, b], D).map((s) => s.movable.map((x) => x.ref)), [[], ["a", "b"]]);
  const mid = suggestionSegments(P, [a, f, b, c], D);
  assert.deepEqual(mid.map((s) => s.movable.map((x) => x.ref)), [["a"], ["b", "c"]]);
  assert.deepEqual(mid[1]?.from, { lat: f.lat, lng: f.lng }, "固定点是下一段的起点");
  assert.deepEqual(mid[0]?.to, { lat: f.lat, lng: f.lng });
  assert.deepEqual(suggestionSegments(P, [a, b, f], D).map((s) => s.movable.map((x) => x.ref)), [["a", "b"], []]);
  assert.deepEqual(suggestionSegments(P, [a, f, g, b], D).map((s) => s.movable.map((x) => x.ref)), [["a"], [], ["b"]]);
  assert.equal(segmentsToOptimize(suggestionSegments(P, [a, f, g, b], D)).length, 0, "每段都不到 2 个：不调用");
  assert.equal(segmentsToOptimize(suggestionSegments(P, [a, b, f, c], D)).length, 1);
  assert.equal(segmentsToOptimize(suggestionSegments(P, [a], D)).length, 0);
});

test("缓存键：同一组点不同顺序同一个键；固定端不同键不同；取整同 routeCacheKey；同一个点出现两次不去重", () => {
  const [a, b, c] = [stop("a", 1), stop("b", 2), stop("c", 3)];
  const key = (stops: SuggestionStop[], from = P, to = D) => orderSuggestionCacheKey({ from, to, movable: stops });
  assert.equal(key([a, b, c]), key([c, a, b]));
  assert.notEqual(key([a, b, c]), key([a, b, c], P, P));
  assert.notEqual(key([a, b]), key([a, b, c]));
  assert.equal(key([{ ...a, lat: a.lat + 0.0001 }, b]), key([a, b]), "3 位小数以内同一个点");
  assert.match(key([a, b]), /^opt:v1:35\.690,139\.701\|35\.681,139\.767\|35\.500,138\.800;35\.600,138\.900$/);
  assert.notEqual(key([a, a]), key([a]));
});

test("谷歌的段内顺序 → 坐标列表 → 按 ref 映射回经停；整程顺序里固定点不动", () => {
  const [a, b, c] = [stop("a", 1), stop("b", 2), stop("c", 3)];
  const segment = { from: P, to: D, movable: [a, b, c] };
  const points = orderedPoints(segment, [2, 0, 1]);
  assert.deepEqual(points, [
    { lat: 35.7, lng: 139 },
    { lat: 35.5, lng: 138.8 },
    { lat: 35.6, lng: 138.9 },
  ]);
  assert.equal(orderedPoints(segment, [0, 0, 1]), null);
  assert.equal(orderedPoints(segment, [0, 1]), null);
  assert.equal(orderedPoints(segment, [0, 1, 3]), null);
  // 客人之后把顺序换成 c、b、a：缓存的坐标照样按 ref 映射
  assert.deepEqual(refsInOrder([c, b, a], points ?? []), ["c", "a", "b"]);
  // 两个经停同一个点：各分到一个，不去重
  const twin = { ...a, ref: "a2" };
  assert.deepEqual(refsInOrder([a, twin, b], [{ lat: 35.6, lng: 138.9 }, { lat: 35.5, lng: 138.8 }, { lat: 35.5, lng: 138.8 }]), ["b", "a", "a2"]);
  assert.equal(refsInOrder([a, b], [{ lat: 1, lng: 1 }, { lat: 35.5, lng: 138.8 }]), null);
  const f = stop("f", 9, true);
  assert.deepEqual(suggestedOrder([a, b, f, c, stop("d", 4)], new Map([[0, ["b", "a"]]])), ["b", "a", "f", "c", "d"]);
  assert.deepEqual(suggestedOrder([a, b, f, c, stop("d", 4)], new Map([[1, ["d", "c"]]])), ["a", "b", "f", "d", "c"]);
});

test("按 ref 重排：对不上（多、少、重复、不认识）为 null", () => {
  const list = [{ ref: "x", n: 1 }, { ref: "y", n: 2 }, { ref: "z", n: 3 }];
  assert.deepEqual(reorderByRefs(list, ["z", "x", "y"])?.map((s) => s.n), [3, 1, 2]);
  assert.equal(reorderByRefs(list, ["z", "x"]), null);
  assert.equal(reorderByRefs(list, ["z", "x", "x"]), null);
  assert.equal(reorderByRefs(list, ["z", "x", "w"]), null);
});

test("成不成立：刚好 5,000 米 / 10 分钟成立，4,999 / 9 不成立；一项省、另一项变差超出容差不成立", () => {
  const current = { meters: 100_000, minutes: 120 };
  assert.equal(judgeSuggestion(current, { meters: 95_000, minutes: 120 }, THRESHOLDS).ok, true);
  assert.equal(judgeSuggestion(current, { meters: 100_000, minutes: 110 }, THRESHOLDS).ok, true);
  assert.equal(judgeSuggestion(current, { meters: 95_001, minutes: 111 }, THRESHOLDS).ok, false);
  assert.deepEqual(judgeSuggestion(current, { meters: 95_001, minutes: 111 }, THRESHOLDS), { ok: false, savedMeters: 4_999, savedMinutes: 9 });
  assert.equal(judgeSuggestion(current, { meters: 101_000, minutes: 100 }, THRESHOLDS).ok, true, "多 1 公里在容差里");
  assert.equal(judgeSuggestion(current, { meters: 101_001, minutes: 100 }, THRESHOLDS).ok, false, "多 1 公里零 1 米");
  assert.equal(judgeSuggestion(current, { meters: 80_000, minutes: 123 }, THRESHOLDS).ok, true, "多 3 分钟在容差里");
  assert.equal(judgeSuggestion(current, { meters: 80_000, minutes: 124 }, THRESHOLDS).ok, false);
  assert.equal(judgeSuggestion(current, current, THRESHOLDS).ok, false, "一样的顺序");
  assert.equal(ORDER_SUGGESTION_RULES.defaultMinSavedMeters, 5_000);
  assert.equal(ORDER_SUGGESTION_RULES.defaultMinSavedMinutes, 10);
});

test("请求键：除顺序外任一字段变了键就变；只换顺序键不变", () => {
  const base = {
    pickup: P,
    dropoff: D,
    waypoints: [
      { lat: 35.5, lng: 138.8, name: "河口湖", stay_minutes: 60 },
      { lat: 35.2, lng: 139.1, name: "箱根", stay_minutes: 90 },
    ],
    service_local: "2030-11-20T09:00",
    passengers: 2,
    luggage: 2,
  };
  const key = suggestionRequestKey(base);
  assert.match(key, /^rk1:[0-9a-z]+$/);
  assert.equal(suggestionRequestKey({ ...base, waypoints: [...base.waypoints].reverse() }), key, "只换顺序");
  const changed = [
    { ...base, waypoints: [{ ...base.waypoints[0]!, stay_minutes: 90 }, base.waypoints[1]!] },
    { ...base, waypoints: [{ ...base.waypoints[0]!, name: "河口湖站" }, base.waypoints[1]!] },
    { ...base, waypoints: [{ ...base.waypoints[0]!, lat: 35.51 }, base.waypoints[1]!] },
    { ...base, waypoints: [{ ...base.waypoints[0]!, arrive_by: { day_offset: 0, time: "11:00" } }, base.waypoints[1]!] },
    { ...base, service_local: "2030-11-20T10:00" },
    { ...base, passengers: 3 },
    { ...base, luggage: 3 },
    { ...base, addons: [{ addon_id: "a", quantity: 1 }] },
    { ...base, package_hours: 10 },
    { ...base, dropoff: P },
  ];
  for (const fields of changed) assert.notEqual(suggestionRequestKey(fields), key, JSON.stringify(fields));
  assert.equal(suggestionRequestKey({ ...base, addons: [{ addon_id: "a", quantity: 1 }, { addon_id: "b", quantity: 2 }] }), suggestionRequestKey({ ...base, addons: [{ addon_id: "b", quantity: 2 }, { addon_id: "a", quantity: 1 }] }), "附加项不看先后");
});

test("同一组点：不看顺序、按 3 位小数取整", () => {
  assert.equal(sameStopSet([P, D], [D, P]), true);
  assert.equal(sameStopSet([P, D], [{ lat: P.lat + 0.0001, lng: P.lng }, D]), true);
  assert.equal(sameStopSet([P, D], [P, P]), false);
  assert.equal(sameStopSet([P], [P, D]), false);
});
