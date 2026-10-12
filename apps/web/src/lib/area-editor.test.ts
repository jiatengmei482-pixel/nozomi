import { test } from "node:test";
import assert from "node:assert/strict";
import { type Position, circleToRing, locatePoint, parseShapeText } from "@nozomi/domain";
import type { AreaPolygon } from "../api/areas.ts";
import {
  EMPTY_EDITOR,
  type EditorAction,
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
  shapeWarnings,
  shapesBounds,
  shapesToGeoJson,
  toPolygonInputs,
} from "./area-editor.ts";
import { areaProblemText, parseFailureText, ringProblemText, shapeProblemText, warningText } from "./area-messages.ts";

const SQUARE: Position[] = [[139.6, 35.6], [139.8, 35.6], [139.8, 35.8], [139.6, 35.8]];
const INNER: Position[] = [[139.68, 35.68], [139.72, 35.68], [139.72, 35.72], [139.68, 35.72]];
const run = (actions: EditorAction[], from: EditorState = EMPTY_EDITOR): EditorState => actions.reduce(editorReducer, from);

test("添加图形：自动编号按类型各数各的，删除后不重排；新加的被选中；备注名接在后面", () => {
  let state = run([
    { type: "addPolygon", kind: "operate", ring: SQUARE },
    { type: "addPolygon", kind: "forbid", ring: INNER },
    { type: "addCircle", kind: "operate", circle: { lat: 35.7, lng: 139.7, radiusM: 3000 } },
  ]);
  assert.deepEqual(state.shapes.map(shapeName), ["营运 1", "禁行 1", "营运 2"]);
  assert.equal(state.selected, state.shapes[2]?.key);
  state = run([{ type: "remove", key: state.shapes[0]?.key ?? "" }, { type: "addPolygon", kind: "operate", ring: SQUARE }, { type: "setLabel", key: "s2", label: " 皇居周边 " }], state);
  assert.deepEqual(state.shapes.map(shapeName), ["禁行 1 · 皇居周边", "营运 2", "营运 3"]);
});

test("改点：移动、插入、删除；少于 3 个点不再删；坐标保留 6 位小数", () => {
  let state = run([{ type: "addPolygon", kind: "operate", ring: SQUARE }]);
  const key = state.shapes[0]?.key ?? "";
  state = run([{ type: "movePoint", key, index: 1, position: [139.81234567, 35.61] }, { type: "insertPoint", key, after: 1, position: [139.85, 35.7] }], state);
  assert.deepEqual(state.shapes[0]?.ring, [[139.6, 35.6], [139.812346, 35.61], [139.85, 35.7], [139.8, 35.8], [139.6, 35.8]]);
  state = run([{ type: "removePoint", key, index: 2 }, { type: "removePoint", key, index: 0 }], state);
  assert.equal(state.shapes[0]?.ring.length, 3);
  assert.equal(run([{ type: "removePoint", key, index: 0 }], state).shapes[0]?.ring.length, 3, "至少保留 3 个点");
});

test("撤销和重做：每个操作一步；拖动过程只算一步；撤销后再改，重做记录清空", () => {
  let state = run([{ type: "addPolygon", kind: "operate", ring: SQUARE }]);
  const key = state.shapes[0]?.key ?? "";
  state = run([{ type: "beginGesture" }, { type: "movePoint", key, index: 0, position: [139.61, 35.6], live: true }, { type: "movePoint", key, index: 0, position: [139.62, 35.6], live: true }, { type: "movePoint", key, index: 0, position: [139.63, 35.6], live: true }], state);
  assert.deepEqual(state.shapes[0]?.ring[0], [139.63, 35.6]);
  state = editorReducer(state, { type: "undo" });
  assert.deepEqual(state.shapes[0]?.ring[0], [139.6, 35.6], "整段拖动一步撤销");
  state = editorReducer(state, { type: "undo" });
  assert.equal(state.shapes.length, 0);
  assert.equal(editorReducer(state, { type: "undo" }), state, "没有可撤销的");
  state = run([{ type: "redo" }, { type: "redo" }], state);
  assert.deepEqual(state.shapes[0]?.ring[0], [139.63, 35.6]);
  state = run([{ type: "undo" }, { type: "translate", key, dLng: 0.1, dLat: 0 }], state);
  assert.equal(state.future.length, 0);
  assert.deepEqual(state.shapes[0]?.ring[0], [139.7, 35.6]);
});

test("圆：只记圆心和半径，那圈点用 domain 的同一个函数现算；可以改、整体移动、转成多边形（可撤销）", () => {
  let state = run([{ type: "addCircle", kind: "operate", circle: { lat: 35.7, lng: 139.7, radiusM: 3000 } }]);
  const key = state.shapes[0]?.key ?? "";
  assert.deepEqual(state.shapes[0]?.ring, []);
  assert.deepEqual(shapeRing(state.shapes[0]!), circleToRing({ lat: 35.7, lng: 139.7 }, 3000));
  state = run([{ type: "setCircle", key, circle: { lat: 35.7, lng: 139.7, radiusM: 5200.4 } }, { type: "translate", key, dLng: 0.01, dLat: -0.01 }], state);
  assert.deepEqual(state.shapes[0]?.circle, { lat: 35.69, lng: 139.71, radiusM: 5200 });
  assert.deepEqual(toPolygonInputs(state.shapes), [{ kind: "operate", label: null, source: "circle", circle: { center: { lat: 35.69, lng: 139.71 }, radius_m: 5200 } }]);
  state = editorReducer(state, { type: "convertCircle", key });
  assert.equal(state.shapes[0]?.circle, null);
  assert.equal(state.shapes[0]?.ring.length, 64);
  assert.equal(state.shapes[0]?.source, "drawn");
  assert.ok(editorReducer(state, { type: "undo" }).shapes[0]?.circle);
});

test("粘贴进来的图形：整次是一步撤销；带洞的加为营运区时每个洞各成一块禁行区", () => {
  const parsed = parseShapeText(JSON.stringify({ type: "Polygon", coordinates: [[...SQUARE, SQUARE[0]], [...INNER, INNER[0]]] }));
  let state = run([{ type: "addParsed", kind: "operate", parsed }]);
  assert.deepEqual(state.shapes.map((shape) => `${shapeName(shape)}:${shape.source}:${shape.ring.length}`), ["营运 1:pasted:4", "禁行 1:pasted:4"]);
  assert.equal(state.selected, state.shapes[0]?.key);
  assert.equal(editorReducer(state, { type: "undo" }).shapes.length, 0);
  state = run([{ type: "addParsed", kind: "forbid", parsed: parseShapeText("POLYGON((139.61 35.61, 139.65 35.61, 139.65 35.65, 139.61 35.61))") }], state);
  assert.deepEqual(state.shapes.map(shapeName), ["营运 1", "禁行 1", "禁行 2"]);
});

test("从接口载入：圆按圆来改，多边形去掉闭合的那个点；原样提交回去时带上编号", () => {
  const polygons: AreaPolygon[] = [
    { id: "a", kind: "operate", seq: 2, label: null, source: "drawn", circle: null, geometry: { type: "Polygon", coordinates: [[...SQUARE, SQUARE[0]!] as [number, number][]] } },
    { id: "b", kind: "forbid", seq: 5, label: "皇居周边", source: "circle", circle: { center: { lat: 35.7, lng: 139.7 }, radius_m: 1500 }, geometry: { type: "Polygon", coordinates: [[]] } },
  ];
  const state = run([{ type: "load", polygons }]);
  assert.deepEqual(state.shapes.map(shapeName), ["营运 2", "禁行 5 · 皇居周边"]);
  assert.equal(state.shapes[0]?.ring.length, 4);
  assert.equal(state.past.length, 0);
  const inputs = toPolygonInputs(state.shapes);
  assert.equal(inputs[0]?.id, "a");
  assert.equal(inputs[0]?.geometry?.coordinates[0]?.length, 5, "提交的一圈是闭合的");
  assert.deepEqual(inputs[1], { id: "b", kind: "forbid", label: "皇居周边", source: "circle", circle: { center: { lat: 35.7, lng: 139.7 }, radius_m: 1500 } });
  assert.equal(run([{ type: "addPolygon", kind: "operate", ring: INNER }], state).shapes[2]?.seq, 3, "新编号接在已有的最大编号后面");
});

test("有没有未保存的修改：改了又撤销回原样算没改", () => {
  const base = run([{ type: "addPolygon", kind: "operate", ring: SQUARE }]);
  const key = base.shapes[0]?.key ?? "";
  const moved = editorReducer(base, { type: "movePoint", key, index: 0, position: [139.61, 35.6] });
  assert.equal(sameShapes(base.shapes, moved.shapes), false);
  assert.equal(sameShapes(base.shapes, editorReducer(moved, { type: "undo" }).shapes), true);
  assert.equal(sameShapes(base.shapes, editorReducer(base, { type: "select", key: null }).shapes), true);
});

test("问题：没有营运区、边交叉、点太少、半径不合规——用的是 domain 的规则，文案是规范的定稿", () => {
  assert.deepEqual(areaProblems([]), [{ reason: "NO_OPERATE_POLYGON" }]);
  assert.equal(areaProblemText("NO_OPERATE_POLYGON"), "至少要有一块营运区。在地图上画一块，或点「添加营运区」。");
  const bowtie = run([{ type: "addPolygon", kind: "operate", ring: [[139.6, 35.6], [139.8, 35.8], [139.8, 35.6], [139.6, 35.8]] }]);
  assert.deepEqual(shapeProblems(bowtie.shapes[0]!).map(shapeProblemText), ["第 1–2 个点之间的边，和第 3–4 个点之间的边交叉了。挪动这几个点，让边不再交叉。"]);
  assert.deepEqual(areaProblems(bowtie.shapes), [], "有营运区，只是它自己有问题：不再另报「至少要有一块营运区」");
  assert.equal(hasBlockingProblems(bowtie.shapes), true);
  const two = run([{ type: "addPolygon", kind: "operate", ring: SQUARE.slice(0, 2) }]);
  assert.deepEqual(shapeProblems(two.shapes[0]!).map(shapeProblemText), ["至少要 3 个点才能围成一个范围，现在只有 2 个。"]);
  const tiny = run([{ type: "addCircle", kind: "operate", circle: { lat: 35.7, lng: 139.7, radiusM: 50 } }]);
  assert.deepEqual(shapeProblems(tiny.shapes[0]!).map(shapeProblemText), ["半径要在 0.1 到 100 公里之间"]);
  assert.equal(ringProblemText("DUPLICATE_POINT", { a: 2, b: 3 }), "第 2 个点和第 3 个点在同一个位置，请删掉其中一个。");
  assert.equal(ringProblemText("SOMETHING_NEW"), null);
  assert.equal(hasBlockingProblems(run([{ type: "addPolygon", kind: "operate", ring: SQUARE }]).shapes), false);
});

test("提醒：禁行区在营运区外面、营运区整个在禁行区里、离城市太远——可以保存，只是提醒", () => {
  const state = run([
    { type: "addPolygon", kind: "operate", ring: INNER },
    { type: "addPolygon", kind: "forbid", ring: SQUARE },
    { type: "addPolygon", kind: "forbid", ring: [[140.5, 36.5], [140.6, 36.5], [140.6, 36.6]] },
  ]);
  const warnings = shapeWarnings(state.shapes, { lat: 35.7, lng: 139.7 });
  const texts = (key: string): string[] => (warnings.get(key) ?? []).map((warning) => warningText(warning, "东京", "禁行 1"));
  assert.deepEqual(texts("s1"), ["这块营运区整个在「禁行 1」里。禁行区优先，所以这一块实际上不会报价。"]);
  assert.deepEqual(texts("s3"), ["这块禁行区完全在营运区外面，不起作用。它外面本来就不报价。"]);
  assert.equal(hasBlockingProblems(state.shapes), false);
  const far = shapeWarnings(run([{ type: "addPolygon", kind: "operate", ring: [[35.6, 139.6], [35.8, 139.6], [35.8, 139.8]] }]).shapes, { lat: 35.7, lng: 139.7 });
  assert.equal(far.size, 0, "坐标本身不合法的（纬度 139）是问题，不是提醒");
});

test("自测：按画面上的图形判断，和后端用的 locatePoint 是同一个结果（禁行优先）", () => {
  const state = run([
    { type: "addPolygon", kind: "operate", ring: SQUARE },
    { type: "addPolygon", kind: "forbid", ring: INNER },
    { type: "addCircle", kind: "operate", circle: { lat: 36.2, lng: 140.2, radiusM: 2000 } },
  ]);
  const backendView = state.shapes.map((shape) => ({ id: shape.key, kind: shape.kind, ring: shapeRing(shape) }));
  for (const point of [{ lat: 35.7, lng: 139.7 }, { lat: 35.62, lng: 139.62 }, { lat: 34, lng: 139 }, { lat: 36.2, lng: 140.2 }, { lat: 35.68, lng: 139.7 }]) {
    assert.deepEqual(locateInEditor(state.shapes, point), locatePoint(backendView, point), JSON.stringify(point));
  }
  assert.deepEqual(locateInEditor(state.shapes, { lat: 35.7, lng: 139.7 }), { result: "forbid", operatePolygonIds: ["s1"], forbidPolygonIds: ["s2"] });
  assert.equal(locateInEditor(state.shapes, { lat: 35.62, lng: 139.62 }).result, "operate");
  assert.equal(locateInEditor(state.shapes, { lat: 34, lng: 139 }).result, "outside");
});

test("复制成 GeoJSON 再粘贴回来，图形不变；范围；公里和米的换算不用浮点", () => {
  const state = run([{ type: "addPolygon", kind: "operate", ring: SQUARE }, { type: "addPolygon", kind: "forbid", ring: INNER }]);
  const parsed = parseShapeText(shapesToGeoJson(state.shapes));
  assert.equal(parsed.format, "geojson");
  assert.deepEqual(parsed.polygons.map((polygon) => polygon.outer), [SQUARE, INNER]);
  assert.deepEqual(shapesBounds(state.shapes), [[35.6, 139.6], [35.8, 139.8]]);
  assert.equal(shapesBounds([]), null);
  assert.equal(kmTextToMeters("3"), 3000);
  assert.equal(kmTextToMeters("2.5"), 2500);
  assert.equal(kmTextToMeters("0.1"), 100);
  assert.equal(kmTextToMeters("1.234"), 1234);
  assert.equal(kmTextToMeters("1.2345"), null);
  assert.equal(kmTextToMeters("abc"), null);
  assert.equal(kmTextToMeters(""), null);
  assert.equal(metersToKmText(3000), "3");
  assert.equal(metersToKmText(2500), "2.5");
  assert.equal(metersToKmText(1234), "1.234");
  assert.equal(metersToKmText(100), "0.1");
});

test("粘贴读不出来时的话", () => {
  assert.equal(parseFailureText({ reason: "EMPTY" }), "请粘贴坐标");
  assert.equal(parseFailureText({ reason: "GEOJSON_SYNTAX", line: 3 }), "这段 GeoJSON 不完整或有语法错误（第 3 行附近）。请重新复制一次。");
  assert.equal(parseFailureText({ reason: "COORDINATE_OUT_OF_RANGE", polygon: 2 }), "第 2 个多边形里有超出范围的坐标（纬度要在 -90 到 90、经度要在 -180 到 180 之间）。");
  assert.equal(parseFailureText({ reason: "UNSUPPORTED_SRID" }), "只支持 WGS84（EPSG:4326）的坐标。");
});
