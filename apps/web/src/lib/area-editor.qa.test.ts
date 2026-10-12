/**
 * M1-02 区域编辑器的图形状态：补充测试（测试工程师）。area-editor.test.ts 是开发自己写的。
 * 这里补的是不变量和两端的一致：
 * - 随机的一长串操作之后：撤销到底回到最初、全部重做回到最后；撤销后的新操作截断重做；撤销后要保存的内容就是画面上的；
 * - 前端「可以保存」和后端「接受」对同一份图形的结论一致（后端的做法照着 services/areas.ts 的 buildPolygons 在这里重做一遍：
 *   圆用 circleToRing、多边形用 normalizeRing，再过 areaShapeIssues）；
 * - 自测：画面上的结论 = 后端按保存下来的图形算的结论；
 * - 复制出去再粘贴回来、公里和米的换算。
 * 名字以「【缺陷】」开头的是现在会失败的用例，交回开发处理。纯函数，不依赖浏览器。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { AREA_LIMITS, type AreaPolygonShape, type Position, areaShapeIssues, circleToRing, locatePoint, normalizeRing, parseShapeText } from "@nozomi/domain";
import type { AreaPolygon } from "../api/areas.ts";
import {
  EMPTY_EDITOR,
  type EditorAction,
  type EditorShape,
  type EditorState,
  areaProblems,
  editorReducer,
  hasBlockingProblems,
  kmTextToMeters,
  locateInEditor,
  metersToKmText,
  sameShapes,
  shapeName,
  shapeProblems,
  shapeRing,
  shapesToGeoJson,
  toPolygonInputs,
} from "./area-editor.ts";

const SQUARE: Position[] = [[139.6, 35.6], [139.8, 35.6], [139.8, 35.8], [139.6, 35.8]];
const INNER: Position[] = [[139.68, 35.68], [139.72, 35.68], [139.72, 35.72], [139.68, 35.72]];
const run = (actions: EditorAction[], from: EditorState = EMPTY_EDITOR): EditorState => actions.reduce(editorReducer, from);
const closed = (ring: readonly Position[]): Position[][] => [[...ring, ring[0] as Position]];
const serverPolygon = (id: string, kind: "operate" | "forbid", seq: number, ring: Position[], label: string | null = null): AreaPolygon => ({ id, kind, seq, label, source: "drawn", circle: null, geometry: { type: "Polygon", coordinates: closed(ring) as [number, number][][] } });

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 画面上的图形，去掉和历史无关的东西，用来比较「是不是同一个画面」。 */
const picture = (state: EditorState): string => JSON.stringify(state.shapes);

/** 随机挑一个操作（都是界面上做得出来的）。 */
function randomAction(random: () => number, state: EditorState): EditorAction {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
  const point = (): Position => [139 + random(), 35 + random()];
  const kind = random() < 0.6 ? "operate" : "forbid";
  const shape = state.shapes.length > 0 ? pick(state.shapes) : null;
  const roll = random();
  if (shape === null || roll < 0.12) return { type: "addPolygon", kind, ring: [point(), point(), point(), point()] };
  if (roll < 0.2) return { type: "addCircle", kind, circle: { lat: 35 + random(), lng: 139 + random(), radiusM: 100 + Math.floor(random() * 5000) } };
  if (roll < 0.26) return { type: "addParsed", kind, parsed: parseShapeText("POLYGON((139 35,139.5 35,139.5 35.5,139 35.5,139 35),(139.1 35.1,139.2 35.1,139.2 35.2,139.1 35.1))") };
  if (roll < 0.34) return { type: "remove", key: shape.key };
  if (roll < 0.46) return { type: "movePoint", key: shape.key, index: Math.floor(random() * 4), position: point() };
  if (roll < 0.54) return { type: "insertPoint", key: shape.key, after: Math.floor(random() * 3), position: point() };
  if (roll < 0.6) return { type: "removePoint", key: shape.key, index: Math.floor(random() * 4) };
  if (roll < 0.66) return { type: "setLabel", key: shape.key, label: `备注${Math.floor(random() * 5)}` };
  if (roll < 0.7) return { type: "convertCircle", key: shape.key };
  if (roll < 0.76) return { type: "translate", key: shape.key, dLng: random() / 100, dLat: random() / 100 };
  if (roll < 0.82) return { type: "setCircle", key: shape.key, circle: { lat: 35 + random(), lng: 139 + random(), radiusM: 100 + Math.floor(random() * 5000) } };
  if (roll < 0.86) return { type: "replaceRing", key: shape.key, ring: [point(), point(), point()] };
  if (roll < 0.9) return { type: "select", key: random() < 0.3 ? null : shape.key };
  if (roll < 0.96) return { type: "undo" };
  return { type: "redo" };
}

// ───────────── 撤销 / 重做的不变量 ─────────────

test("随机操作 400 轮 × 60 步：撤销到底回到最初的画面，再重做同样多步回到最后的画面；每一步之后编号不重复、块数不超上限、历史不超过 100 步", () => {
  const random = rng(20261008);
  for (let round = 0; round < 400; round += 1) {
    const initial = round % 3 === 0 ? editorReducer(EMPTY_EDITOR, { type: "load", polygons: [serverPolygon("11111111-1111-4111-8111-111111111111", "operate", 1, SQUARE), serverPolygon("22222222-2222-4222-8222-222222222222", "forbid", 4, INNER, "皇居")] }) : EMPTY_EDITOR;
    let state = initial;
    for (let step = 0; step < 60; step += 1) {
      state = editorReducer(state, randomAction(random, state));
      assert.equal(new Set(state.shapes.map((shape) => shape.key)).size, state.shapes.length, "本地编号重复了");
      for (const kind of ["operate", "forbid"] as const) {
        const seqs = state.shapes.filter((shape) => shape.kind === kind).map((shape) => shape.seq);
        assert.equal(new Set(seqs).size, seqs.length, `${kind} 的序号重复了`);
      }
      assert.ok(state.shapes.length <= AREA_LIMITS.maxPolygons);
      assert.ok(state.past.length <= 100);
      assert.ok(state.selected === null || state.shapes.some((shape) => shape.key === state.selected), "选中的图形已经不在了");
      for (const shape of state.shapes) assert.ok(shape.circle === null || shape.ring.length === 0, "圆不应带着一圈点");
    }
    const final = picture(state);
    const steps = state.past.length;
    if (steps === 100) continue; // 历史被截断时回不到最初，另一个用例管
    let undone = state;
    for (let i = 0; i < steps; i += 1) undone = editorReducer(undone, { type: "undo" });
    assert.equal(undone.past.length, 0);
    assert.equal(picture(undone), picture(initial), "撤销到底应当回到最初的画面");
    assert.equal(editorReducer(undone, { type: "undo" }), undone, "撤销到底以后再撤销什么都不变");
    // 重做同样多步：回到刚才的画面（刚才若还留着可重做的记录，它们也原样还在）
    let redone = undone;
    for (let i = 0; i < steps; i += 1) redone = editorReducer(redone, { type: "redo" });
    assert.equal(picture(redone), final, "重做同样多步应当回到最后的画面");
    assert.deepEqual([redone.past.length, redone.future.length], [steps, state.future.length]);
    while (redone.future.length > 0) redone = editorReducer(redone, { type: "redo" });
    assert.equal(editorReducer(redone, { type: "redo" }), redone, "没有可重做的时再重做什么都不变");
  }
});

test("撤销后做新的操作：重做记录被清掉，之前被撤销的内容不会再冒出来；撤销后要保存的内容就是画面上的", () => {
  const drawn = run([
    { type: "addPolygon", kind: "operate", ring: SQUARE },
    { type: "addPolygon", kind: "forbid", ring: INNER },
    { type: "movePoint", key: "s1", index: 0, position: [139.5, 35.5] },
    { type: "addCircle", kind: "forbid", circle: { lat: 35.7, lng: 139.7, radiusM: 500 } },
  ]);
  const back = run([{ type: "undo" }, { type: "undo" }], drawn);
  assert.deepEqual(back.shapes.map((shape) => [shape.key, shape.ring[0]]), [["s1", [139.6, 35.6]], ["s2", [139.68, 35.68]]]);
  assert.equal(back.future.length, 2);
  // 这时保存：提交的是撤销以后画面上的两块，不是撤销之前的三块
  assert.deepEqual(toPolygonInputs(back.shapes), [
    { kind: "operate", label: null, source: "drawn", geometry: { type: "Polygon", coordinates: closed(SQUARE) } },
    { kind: "forbid", label: null, source: "drawn", geometry: { type: "Polygon", coordinates: closed(INNER) } },
  ]);
  const branched = editorReducer(back, { type: "setLabel", key: "s2", label: "皇居" });
  assert.equal(branched.future.length, 0, "新操作清掉重做");
  assert.equal(editorReducer(branched, { type: "redo" }), branched);
  assert.ok(!branched.shapes.some((shape) => shape.circle !== null), "被撤销的圆不会再出现");
  // 只是换一个选中的图形不算操作：不清掉重做
  const selected = editorReducer(back, { type: "select", key: "s1" });
  assert.equal(selected.future.length, 2);
  assert.equal(run([{ type: "redo" }, { type: "redo" }], selected).shapes.length, 3);
});

test("撤销以后新加的图形不会和已有的撞编号；被撤销又重做回来的图形保留它原来的编号和服务端的 id", () => {
  const loaded = editorReducer(EMPTY_EDITOR, { type: "load", polygons: [serverPolygon("11111111-1111-4111-8111-111111111111", "operate", 1, SQUARE), serverPolygon("22222222-2222-4222-8222-222222222222", "forbid", 4, INNER)] });
  const removed = editorReducer(loaded, { type: "remove", key: "s2" });
  const restored = editorReducer(removed, { type: "undo" });
  assert.deepEqual(restored.shapes.map((shape) => [shape.key, shape.id, shape.seq]), [["s1", "11111111-1111-4111-8111-111111111111", 1], ["s2", "22222222-2222-4222-8222-222222222222", 4]]);
  assert.ok(sameShapes(restored.shapes, loaded.shapes), "撤销回原样算没改");
  const added = run([{ type: "addPolygon", kind: "forbid", ring: INNER }, { type: "undo" }, { type: "addPolygon", kind: "forbid", ring: INNER }, { type: "addPolygon", kind: "operate", ring: SQUARE }], restored);
  assert.equal(new Set(added.shapes.map((shape) => shape.key)).size, 4);
  assert.deepEqual(added.shapes.map((shape) => shapeName(shape)), ["营运 1", "禁行 4", "禁行 5", "营运 2"]);
  // 提交时：原有的带 id，新加的不带
  assert.deepEqual(toPolygonInputs(added.shapes).map((input) => input.id ?? null), ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", null, null]);
});

test("超过 100 步以后最早的丢掉：最多撤销 100 步，撤销到底不是空白而是第 N-100 步时的画面", () => {
  let state = editorReducer(EMPTY_EDITOR, { type: "addPolygon", kind: "operate", ring: SQUARE });
  for (let i = 1; i <= 150; i += 1) state = editorReducer(state, { type: "movePoint", key: "s1", index: 0, position: [139 + i / 1000, 35] });
  assert.equal(state.past.length, 100);
  let undone = state;
  for (let i = 0; i < 120; i += 1) undone = editorReducer(undone, { type: "undo" });
  assert.deepEqual(undone.shapes[0]?.ring[0], [139.05, 35]);
  assert.equal(undone.future.length, 100);
});

test("一次拖动（按下 → 挪很多次 → 松开）是一步撤销：顶点、圆心、半径都一样；拖动中途的位置不留在历史里", () => {
  const base = run([
    { type: "addPolygon", kind: "operate", ring: SQUARE },
    { type: "addCircle", kind: "forbid", circle: { lat: 35.7, lng: 139.7, radiusM: 500 } },
  ]);
  const dragVertex = run([{ type: "beginGesture" }, ...Array.from({ length: 30 }, (_, i): EditorAction => ({ type: "movePoint", key: "s1", index: 2, position: [139.8 + i / 1000, 35.8], live: true }))], base);
  assert.equal(dragVertex.past.length, base.past.length + 1);
  assert.deepEqual(dragVertex.shapes[0]?.ring[2], [139.829, 35.8]);
  assert.equal(picture(editorReducer(dragVertex, { type: "undo" })), picture(base));
  const dragRadius = run([{ type: "beginGesture" }, ...Array.from({ length: 30 }, (_, i): EditorAction => ({ type: "setCircle", key: "s2", circle: { lat: 35.7, lng: 139.7, radiusM: 500 + i * 10 }, live: true }))], base);
  assert.equal(dragRadius.shapes[1]?.circle?.radiusM, 790);
  assert.equal(picture(editorReducer(dragRadius, { type: "undo" })), picture(base));
  // 拖边中间的点：插入一个点是一步，之后的拖动不再另记
  const dragMid = run([{ type: "insertPoint", key: "s1", after: 0, position: [139.7, 35.6] }, ...Array.from({ length: 10 }, (_, i): EditorAction => ({ type: "movePoint", key: "s1", index: 1, position: [139.7, 35.6 - i / 1000], live: true }))], base);
  assert.equal(dragMid.past.length, base.past.length + 1);
  assert.equal(dragMid.shapes[0]?.ring.length, 5);
  assert.equal(picture(editorReducer(dragMid, { type: "undo" })), picture(base));
});

test("【缺陷】按下控制点又原地松开（没有挪动）、删只剩 3 个点的图形的点、把备注名改成和原来一样——画面没有变，不应当多出一步「撤销」，实际各多出一步什么都不撤销的记录", () => {
  const base = run([{ type: "addPolygon", kind: "operate", ring: SQUARE.slice(0, 3) }, { type: "setLabel", key: "s1", label: "市区" }]);
  const cases: [string, EditorAction][] = [
    ["按下顶点没有挪动就松开", { type: "beginGesture" }],
    ["删只剩 3 个点的图形的点（界面上按钮是禁用的，键盘 Delete 能走到）", { type: "removePoint", key: "s1", index: 0 }],
    ["备注名没变", { type: "setLabel", key: "s1", label: "市区" }],
    ["把点挪到它原来的位置", { type: "movePoint", key: "s1", index: 0, position: [139.6, 35.6] }],
  ];
  for (const [name, action] of cases) {
    const after = editorReducer(base, action);
    assert.equal(picture(after), picture(base), `${name}：画面不该变`);
    assert.equal(after.past.length, base.past.length, `${name}：不该多出一步撤销（多出来的那一步按「撤销」时什么都不发生）`);
  }
});

// ───────────── 前端放行 ⇔ 后端接受 ─────────────

/** 后端收到 toPolygonInputs 的结果后会怎么判断（照 services/areas.ts 的 buildPolygons）：返回它会报的原因代码。 */
function backendReasons(shapes: readonly EditorShape[]): string[] {
  const reasons: string[] = [];
  const drafts: AreaPolygonShape[] = toPolygonInputs(shapes).map((input) => {
    if (input.circle) {
      const { center, radius_m: radius } = input.circle;
      const centerOk = Number.isFinite(center.lat) && Number.isFinite(center.lng) && Math.abs(center.lat) <= 90 && Math.abs(center.lng) <= 180;
      const radiusOk = Number.isInteger(radius) && radius >= AREA_LIMITS.minRadiusM && radius <= AREA_LIMITS.maxRadiusM;
      if (!centerOk) reasons.push("INVALID_COORDINATE");
      if (!radiusOk) reasons.push("RADIUS_OUT_OF_RANGE");
      return { kind: input.kind, ring: centerOk && radiusOk ? circleToRing({ lat: Math.round(center.lat * 1e6) / 1e6, lng: Math.round(center.lng * 1e6) / 1e6 }, radius) : [] };
    }
    return { kind: input.kind, ring: normalizeRing((input.geometry?.coordinates[0] ?? []) as Position[]) };
  });
  if (reasons.length > 0) return reasons;
  return areaShapeIssues(drafts).map((issue) => issue.reason);
}

const polygonShape = (ring: Position[], kind: "operate" | "forbid" = "operate"): EditorState => editorReducer(EMPTY_EDITOR, { type: "addPolygon", kind, ring });

test("前端「可以保存」和后端「接受」的结论一致：各种合规和不合规的多边形（含坐标表里手工写了闭合点、没填完的格子、取整后才重合的点）", () => {
  const cases: [string, Position[]][] = [
    ["正方形", SQUARE],
    ["顺时针", [...SQUARE].reverse()],
    ["手工把第一个点又写了一遍作为最后一个点", [...SQUARE, SQUARE[0] as Position]],
    ["写了两遍闭合点", [...SQUARE, SQUARE[0] as Position, SQUARE[0] as Position]],
    ["蝴蝶结", [[139, 35], [139.2, 35.2], [139.2, 35], [139, 35.2]]],
    ["一条线", [[139, 35], [139.1, 35.1], [139.2, 35.2]]],
    ["相邻重复", [[139, 35], [139.2, 35], [139.2, 35], [139.2, 35.2]]],
    ["取整后重复", [[139, 35], [139.2, 35], [139.2000004, 35.0000004], [139.2, 35.2]]],
    ["取整后共线", [[139, 35], [139.2, 35], [139.1, 35.0000004]]],
    ["两个点", [[139, 35], [139.2, 35]]],
    ["有格子没填", [[139, 35], [Number.NaN, 35], [139.2, 35.2]]],
    ["纬度超范围", [[139, 35], [139.2, 35], [139.2, 95]]],
    ["跨 180°", [[179, 35], [-179, 35], [-179, 36], [179, 36]]],
    ["贴着 180° 不跨", [[179.9, 35], [180, 35], [180, 36], [179.9, 36]]],
    ["折回去的尖刺", [[139, 35], [139.2, 35], [139.2, 35.2], [139.3, 35.3], [139.2, 35.2], [139, 35.2]]],
    ["极小的三角形", [[139.7, 35.7], [139.700001, 35.7], [139.7, 35.700001]]],
    ["1000 个点", Array.from({ length: 1000 }, (_, i): Position => [Math.round((139.7 + 0.05 * Math.cos((2 * Math.PI * i) / 1000)) * 1e6) / 1e6, Math.round((35.7 + 0.05 * Math.sin((2 * Math.PI * i) / 1000)) * 1e6) / 1e6])],
  ];
  for (const [name, ring] of cases) {
    const { shapes } = polygonShape(ring);
    const front = hasBlockingProblems(shapes);
    // 没填完的格子（NaN）发不出去（JSON 里是 null，后端在字段类型那一层就拒绝），这里算后端拒绝
    const back = ring.some((point) => !Number.isFinite(point[0]) || !Number.isFinite(point[1])) ? ["INVALID_COORDINATE"] : backendReasons(shapes);
    assert.equal(front, back.length > 0, `${name}：前端${front ? "不让存" : "放行"}，后端${back.length > 0 ? `拒绝（${back.join("、")}）` : "接受"}`);
    if (front && back.length > 0 && shapeProblems(shapes[0] as EditorShape).length > 0) {
      assert.equal(shapeProblems(shapes[0] as EditorShape)[0]?.reason, back[0], `${name}：两边说的原因不一样`);
    }
  }
  // 只有禁行区
  const onlyForbid = polygonShape(SQUARE, "forbid").shapes;
  assert.deepEqual([hasBlockingProblems(onlyForbid), backendReasons(onlyForbid), areaProblems(onlyForbid).map((problem) => problem.reason)], [true, ["NO_OPERATE_POLYGON"], ["NO_OPERATE_POLYGON"]]);
  // 51 块加不进去（前端在加的时候就挡住），50 块两边都接受
  let many = EMPTY_EDITOR;
  for (let i = 0; i < 51; i += 1) many = editorReducer(many, { type: "addPolygon", kind: "operate", ring: SQUARE.map((point): Position => [point[0] + i, point[1] - 30]).map((point): Position => [((point[0] + 180) % 360) - 180, point[1]]) });
  assert.equal(many.shapes.length, 50);
});

test("前端「可以保存」和后端「接受」的结论一致：圆——半径的两侧、圆心的范围、圆心多于 6 位小数", () => {
  const circle = (lat: number, lng: number, radiusM: number): EditorShape[] => editorReducer(EMPTY_EDITOR, { type: "addCircle", kind: "operate", circle: { lat, lng, radiusM } }).shapes;
  for (const [lat, lng, radius] of [
    [35.7, 139.7, 100], [35.7, 139.7, 99], [35.7, 139.7, 100_000], [35.7, 139.7, 100_001], [35.7, 139.7, 0], [35.7, 139.7, -5],
    [91, 139.7, 1000], [35.7, 181, 1000], [Number.NaN, 139.7, 1000], [35.68517549, 139.75279951, 1500], [-33.86, 151.2, 2500], [80, 20, 100_000],
  ] as const) {
    const shapes = circle(lat, lng, radius);
    const front = hasBlockingProblems(shapes);
    const back = Number.isFinite(lat) ? backendReasons(shapes) : ["INVALID_COORDINATE"];
    assert.equal(front, back.length > 0, `圆心 ${lat},${lng} 半径 ${radius}：前端${front ? "不让存" : "放行"}，后端${back.length > 0 ? `拒绝（${back.join("、")}）` : "接受"}`);
  }
});

test("【缺陷】圆跨过 180° 经线或盖住极点：后端拒绝（CROSSES_ANTIMERIDIAN），前端应当同样在保存前指出来，实际放行——两端的结论不一致（日本、韩国的城市碰不到，以后做别的地区时会遇到）", () => {
  const circle = (lat: number, lng: number, radiusM: number): EditorShape[] => editorReducer(EMPTY_EDITOR, { type: "addCircle", kind: "operate", circle: { lat, lng, radiusM } }).shapes;
  for (const [name, lat, lng, radius] of [
    ["斐济附近、贴着 180° 经线的圆", -16.5, 179.99, 5_000],
    ["圆心在 180° 经线上", 0, 180, 500],
    ["盖住北极的圆", 89.9, 20, 50_000],
  ] as const) {
    const shapes = circle(lat, lng, radius);
    const back = backendReasons(shapes);
    assert.ok(back.length > 0, `${name}：后端拒绝`);
    assert.equal(hasBlockingProblems(shapes), true, `${name}：后端会拒绝（${back.join("、")}），前端也应当不让存`);
  }
});

// ───────────── 自测：画面上的结论 = 后端的结论 ─────────────

test("自测的两条路结论一致：画面上的图形（圆现算、多边形可能是顺时针、没整理过）对一批位置的结论，和后端保存下来的图形（整理过的）的结论逐个相同", () => {
  const random = rng(42);
  const state = run([
    { type: "addPolygon", kind: "operate", ring: [...SQUARE].reverse() },
    { type: "addPolygon", kind: "operate", ring: [[139.9, 35.6], [140.1, 35.6], [140, 35.8]] },
    { type: "addCircle", kind: "operate", circle: { lat: 35.9, lng: 139.7, radiusM: 3000 } },
    { type: "addPolygon", kind: "forbid", ring: INNER },
    { type: "addCircle", kind: "forbid", circle: { lat: 35.9, lng: 139.7, radiusM: 400 } },
    { type: "addPolygon", kind: "forbid", ring: [[139.75, 35.55], [139.85, 35.55], [139.85, 35.65], [139.75, 35.65]] },
  ]);
  // 后端保存下来的样子
  const saved = toPolygonInputs(state.shapes).map((input, index) => ({
    id: state.shapes[index]?.key as string,
    kind: input.kind,
    ring: input.circle ? circleToRing(input.circle.center, input.circle.radius_m) : normalizeRing((input.geometry?.coordinates[0] ?? []) as Position[]),
  }));
  const points: Position[] = [...SQUARE, ...INNER, [139.7, 35.6], [139.6, 35.7], [139.7, 35.7], [139.8, 35.6], [139.75, 35.6], [139.7, 35.9], [139.7, 35.9036], [139.7, 35.93], [140, 35.8], [139.95, 35.7], [0, 0]];
  for (const shape of state.shapes) points.push(...shapeRing(shape).slice(0, 6));
  for (let i = 0; i < 3000; i += 1) points.push([Math.round((139.5 + random() * 0.7) * 1e6) / 1e6, Math.round((35.5 + random() * 0.5) * 1e6) / 1e6]);
  const seen = new Set<string>();
  for (const [lng, lat] of points) {
    const local = locateInEditor(state.shapes, { lat, lng });
    const remote = locatePoint(saved, { lat, lng });
    assert.deepEqual(local, remote, `${lng},${lat}`);
    seen.add(local.result);
  }
  assert.deepEqual([...seen].sort(), ["forbid", "operate", "outside"]);
});

// ───────────── 复制出去再粘贴回来 ─────────────

test("复制成 GeoJSON：每一块一个要素，带类型和名字；圆复制出来的是判断用的那 64 个点；名字里的引号和尖括号不会弄坏 JSON", () => {
  const state = run([
    { type: "addPolygon", kind: "operate", ring: SQUARE },
    { type: "setLabel", key: "s1", label: `"市区" </script><b>` },
    { type: "addCircle", kind: "forbid", circle: { lat: 35.7, lng: 139.7, radiusM: 500 } },
  ]);
  const copied = JSON.parse(shapesToGeoJson(state.shapes)) as { type: string; features: { properties: { kind: string; name: string }; geometry: { type: string; coordinates: Position[][] } }[] };
  assert.equal(copied.type, "FeatureCollection");
  assert.deepEqual(copied.features.map((feature) => [feature.properties.kind, feature.properties.name, feature.geometry.coordinates[0]?.length]), [["operate", `营运 1 · "市区" </script><b>`, 5], ["forbid", "禁行 1", 65]]);
  assert.deepEqual(copied.features[1]?.geometry.coordinates[0]?.slice(0, -1), circleToRing({ lat: 35.7, lng: 139.7 }, 500));
  // 贴回来：点一个不差
  const parsed = parseShapeText(shapesToGeoJson(state.shapes));
  assert.deepEqual(parsed.polygons.map((polygon) => polygon.outer), [SQUARE, circleToRing({ lat: 35.7, lng: 139.7 }, 500)]);
});

test("【缺陷】版本冲突时「复制我画的图形」再「粘贴坐标」贴回来：复制出来的内容里带着每一块的类型和备注名，贴回来应当还是原来的营运区 / 禁行区和备注名，实际全部变成对话框里选的那一种（禁行区变成了营运区）、备注名丢失", () => {
  const mine = run([
    { type: "addPolygon", kind: "operate", ring: SQUARE },
    { type: "addPolygon", kind: "forbid", ring: INNER },
    { type: "setLabel", key: "s2", label: "皇居" },
  ]);
  const copied = shapesToGeoJson(mine.shapes);
  // 载入最新内容以后（这里用空的画面代表），用工具条的「粘贴坐标」贴回来，「加为」是默认的营运区
  const pasted = editorReducer(EMPTY_EDITOR, { type: "addParsed", kind: "operate", parsed: parseShapeText(copied) });
  assert.deepEqual(pasted.shapes.map((shape) => shape.ring), [SQUARE, INNER], "坐标都在");
  assert.deepEqual(pasted.shapes.map((shape) => shape.kind), ["operate", "forbid"], "禁行区贴回来变成了营运区：那里本来不报价，保存后变成会报价");
  assert.deepEqual(pasted.shapes.map((shape) => shape.label), ["", "皇居"], "备注名没有带回来");
});

// ───────────── 公里和米 ─────────────

test("半径的公里和米：100 到 100000 米的每一个整数米换成公里再换回来都不变；不合规的写法返回 null", () => {
  for (let meters = AREA_LIMITS.minRadiusM; meters <= AREA_LIMITS.maxRadiusM; meters += 1) {
    const text = metersToKmText(meters);
    assert.match(text, /^\d+(\.\d{1,3})?$/, `${meters} → ${text}`);
    assert.equal(kmTextToMeters(text), meters, `${meters} → ${text}`);
  }
  assert.deepEqual(["0.1", "100", "3.2", "0.001", " 2.5 ", "007", "1.050"].map(kmTextToMeters), [100, 100_000, 3200, 1, 2500, 7000, 1050]);
  for (const bad of ["", "abc", "1e2", "-3", "+3", "3.", ".5", "1.2345", "1,5", "３", "1 000", "0x10", "Infinity"]) assert.equal(kmTextToMeters(bad), null, JSON.stringify(bad));
  // 0.29 * 1000 这类浮点会算错的值
  assert.deepEqual(["0.29", "1.005", "4.35", "8.2", "99.999"].map(kmTextToMeters), [290, 1005, 4350, 8200, 99_999]);
});

test("从接口载入以后原样提交回去，内容一字不差（不会因为打开看了一眼就产生「未保存的修改」或一次多余的修改）", () => {
  const polygons: AreaPolygon[] = [
    serverPolygon("11111111-1111-4111-8111-111111111111", "operate", 1, SQUARE, "市区"),
    { id: "22222222-2222-4222-8222-222222222222", kind: "forbid", seq: 3, label: null, source: "circle", circle: { center: { lat: 35.685175, lng: 139.752799 }, radius_m: 1500 }, geometry: { type: "Polygon", coordinates: closed(circleToRing({ lat: 35.685175, lng: 139.752799 }, 1500)) as [number, number][][] } },
    { ...serverPolygon("33333333-3333-4333-8333-333333333333", "forbid", 5, INNER), source: "pasted" },
  ];
  const loaded = editorReducer(EMPTY_EDITOR, { type: "load", polygons });
  assert.deepEqual(toPolygonInputs(loaded.shapes), [
    { id: polygons[0]?.id, kind: "operate", label: "市区", source: "drawn", geometry: polygons[0]?.geometry },
    { id: polygons[1]?.id, kind: "forbid", label: null, source: "circle", circle: { center: { lat: 35.685175, lng: 139.752799 }, radius_m: 1500 } },
    { id: polygons[2]?.id, kind: "forbid", label: null, source: "pasted", geometry: polygons[2]?.geometry },
  ]);
  assert.equal(hasBlockingProblems(loaded.shapes), false);
  assert.deepEqual([loaded.past.length, loaded.future.length, loaded.selected], [0, 0, null]);
  // 圆在画面上的那圈点 = 接口返回的那圈点
  assert.deepEqual(shapeRing(loaded.shapes[1] as EditorShape), polygons[1]?.geometry.coordinates[0]?.slice(0, -1));
});
