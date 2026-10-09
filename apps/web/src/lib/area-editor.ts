/**
 * 区域编辑器里「图形」这部分的状态和操作：不依赖地图库、不依赖 React，全部是纯函数。
 * 地图画布、坐标表、粘贴、撤销重做改的都是这一份状态；判断规则全部来自 @nozomi/domain（和后端同一份）。
 *
 * 约定：
 * - 多边形记一圈点（不闭合，[经度, 纬度]）；圆只记圆心和半径，用到那圈点时现算（circleToRing）。
 * - 每块图形有本地的 key（不变）；已保存过的另有服务端的 id。
 * - 名字是「营运 1」「禁行 2」这样的自动编号，删除后不重排。
 */
import {
  AREA_LIMITS,
  AREA_POLYGON_KIND_NAMES,
  type AreaPolygonKind,
  type AreaPolygonSource,
  type AreaShapeIssue,
  type AreaShapeWarning,
  type ParsedShapes,
  type PointLocation,
  type Position,
  type Ring,
  type RingIssue,
  ShapeParseError,
  areaShapeIssues,
  areaShapeWarnings,
  circleIssues,
  circleToRing,
  locatePoint,
  normalizeRing,
  parseShapeText,
  ringIssues,
} from "@nozomi/domain";
import type { AreaPolygon, AreaPolygonInput } from "../api/areas.ts";

export interface CircleShape {
  lat: number;
  lng: number;
  radiusM: number;
}

export interface EditorShape {
  key: string;
  /** 服务端的编号；还没保存过的是 null */
  id: string | null;
  kind: AreaPolygonKind;
  seq: number;
  label: string;
  source: AreaPolygonSource;
  /** 多边形的一圈点；圆的这一项是空数组 */
  ring: Ring;
  circle: CircleShape | null;
}

interface Snapshot {
  shapes: EditorShape[];
  selected: string | null;
}

export interface EditorState extends Snapshot {
  /** 下一个本地 key 的序号 */
  nextKey: number;
  past: Snapshot[];
  future: Snapshot[];
  /** 一次拖动（或在一个格子里的一次修改）开始时的样子：真的改了东西才记进撤销，原地松开不记 */
  gesture?: Snapshot;
}

/** 粘贴进来的一个多边形；从这里复制出去的图形贴回来时，带着它原来的类型和备注名。 */
export type PastedPolygon = ParsedShapes["polygons"][number] & { kind?: AreaPolygonKind; label?: string };

/** 撤销记录最多留这么多步。 */
const HISTORY_LIMIT = 100;

export type EditorAction =
  | { type: "load"; polygons: readonly AreaPolygon[] }
  | { type: "select"; key: string | null }
  | { type: "addPolygon"; kind: AreaPolygonKind; ring: readonly Position[]; source?: AreaPolygonSource }
  | { type: "addCircle"; kind: AreaPolygonKind; circle: CircleShape }
  /** 一次粘贴进来的全部图形：整次是一步撤销。带洞的多边形加为营运区时，每个洞各加为一块禁行区 */
  | { type: "addParsed"; kind: AreaPolygonKind; parsed: ParsedShapes }
  | { type: "replaceRing"; key: string; ring: readonly Position[] }
  | { type: "remove"; key: string }
  | { type: "setLabel"; key: string; label: string }
  | { type: "convertCircle"; key: string }
  /** 拖动（或进入一个格子）开始：之后的改动（`live: true`）合起来只记一步撤销；什么都没改就不记 */
  | { type: "beginGesture" }
  /** 营运区 ⇄ 禁行区互换；序号按新的类型重新取 */
  | { type: "setKind"; key: string; kind: AreaPolygonKind }
  | { type: "movePoint"; key: string; index: number; position: Position; live?: boolean }
  | { type: "insertPoint"; key: string; after: number; position: Position }
  | { type: "removePoint"; key: string; index: number }
  | { type: "translate"; key: string; dLng: number; dLat: number; live?: boolean }
  | { type: "setCircle"; key: string; circle: CircleShape; live?: boolean }
  /** 把草稿里的图形换到画面上（算一步，可以撤销） */
  | { type: "restore"; shapes: readonly EditorShape[] }
  | { type: "undo" }
  | { type: "redo" };

export const EMPTY_EDITOR: EditorState = { shapes: [], selected: null, nextKey: 1, past: [], future: [] };

const round6 = (value: number): number => Math.round(value * 1e6) / 1e6;
const tidy = (position: Position): Position => [round6(position[0]), round6(position[1])];

/** 用到这块图形的那圈点时：圆现算，多边形原样。 */
export function shapeRing(shape: EditorShape): Ring {
  return shape.circle ? circleToRing({ lat: shape.circle.lat, lng: shape.circle.lng }, shape.circle.radiusM) : shape.ring;
}

export function shapeName(shape: Pick<EditorShape, "kind" | "seq" | "label">): string {
  const base = `${AREA_POLYGON_KIND_NAMES[shape.kind]} ${shape.seq}`;
  return shape.label.trim() === "" ? base : `${base} · ${shape.label.trim()}`;
}

function nextSeq(shapes: readonly EditorShape[], kind: AreaPolygonKind): number {
  return shapes.filter((shape) => shape.kind === kind).reduce((max, shape) => Math.max(max, shape.seq), 0) + 1;
}

function fromServer(polygon: AreaPolygon, index: number): EditorShape {
  const closed = polygon.geometry.coordinates[0] ?? [];
  return {
    key: `s${index + 1}`,
    id: polygon.id,
    kind: polygon.kind,
    seq: polygon.seq,
    label: polygon.label ?? "",
    source: polygon.source,
    ring: polygon.circle ? [] : normalizeRing(closed.map((point): Position => [point[0], point[1]])),
    circle: polygon.circle ? { lat: polygon.circle.center.lat, lng: polygon.circle.center.lng, radiusM: polygon.circle.radius_m } : null,
  };
}

function commit(state: EditorState, shapes: EditorShape[], selected: string | null = state.selected, nextKey = state.nextKey): EditorState {
  return { shapes, selected, nextKey, past: [...state.past, { shapes: state.shapes, selected: state.selected }].slice(-HISTORY_LIMIT), future: [] };
}

/** NaN（没填完的格子）在 JSON 里是 null，比较时照样分得出「改没改」。 */
const sameShape = (a: EditorShape, b: EditorShape): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

/**
 * 改一块图形。画面没变（挪到原位、改成原样）就什么都不记。
 * `live`：属于一次拖动——拖动里第一次真的改了东西时，把拖动开始时的样子记成一步撤销，之后不再另记。
 */
function change(state: EditorState, key: string, live: boolean | undefined, update: (shape: EditorShape) => EditorShape): EditorState {
  let changed = false;
  const shapes = state.shapes.map((shape) => {
    if (shape.key !== key) return shape;
    const next = update(shape);
    if (sameShape(shape, next)) return shape;
    changed = true;
    return next;
  });
  if (!changed) return state;
  if (!live) return commit(state, shapes);
  if (!state.gesture) return { ...state, shapes };
  return { shapes, selected: state.selected, nextKey: state.nextKey, past: [...state.past, state.gesture].slice(-HISTORY_LIMIT), future: [] };
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "load": {
      const shapes = action.polygons.map(fromServer);
      return { shapes, selected: null, nextKey: shapes.length + 1, past: [], future: [] };
    }
    case "select":
      return action.key === state.selected ? state : { ...state, selected: action.key };
    case "restore": {
      const next = action.shapes.reduce((max, shape) => Math.max(max, Number(shape.key.slice(1)) || 0), 0) + 1;
      return commit(state, action.shapes.map((shape) => ({ ...shape })), null, Math.max(state.nextKey, next));
    }
    case "addPolygon": {
      if (state.shapes.length >= AREA_LIMITS.maxPolygons) return state;
      const key = `s${state.nextKey}`;
      const shape: EditorShape = { key, id: null, kind: action.kind, seq: nextSeq(state.shapes, action.kind), label: "", source: action.source ?? "drawn", ring: action.ring.map(tidy), circle: null };
      return commit(state, [...state.shapes, shape], key, state.nextKey + 1);
    }
    case "addCircle": {
      if (state.shapes.length >= AREA_LIMITS.maxPolygons) return state;
      const key = `s${state.nextKey}`;
      const circle = { lat: round6(action.circle.lat), lng: round6(action.circle.lng), radiusM: Math.round(action.circle.radiusM) };
      const shape: EditorShape = { key, id: null, kind: action.kind, seq: nextSeq(state.shapes, action.kind), label: "", source: "circle", ring: [], circle };
      return commit(state, [...state.shapes, shape], key, state.nextKey + 1);
    }
    case "addParsed": {
      const added: EditorShape[] = [];
      let counter = state.nextKey;
      const add = (kind: AreaPolygonKind, ring: Ring, label = ""): void => {
        const all = [...state.shapes, ...added];
        added.push({ key: `s${counter}`, id: null, kind, seq: nextSeq(all, kind), label, source: "pasted", ring, circle: null });
        counter += 1;
      };
      for (const polygon of action.parsed.polygons as readonly PastedPolygon[]) {
        // 从这里复制出去的图形带着自己的类型和备注名：原样还原，不看对话框里选的「加为」
        const kind = polygon.kind ?? action.kind;
        add(kind, polygon.outer, polygon.label ?? "");
        if (kind === "operate") for (const hole of polygon.holes) add("forbid", hole);
      }
      if (added.length === 0 || state.shapes.length + added.length > AREA_LIMITS.maxPolygons) return state;
      return commit(state, [...state.shapes, ...added], added[0]?.key ?? state.selected, counter);
    }
    case "replaceRing":
      return change(state, action.key, false, (shape) => ({ ...shape, ring: action.ring.map(tidy), circle: null, source: "pasted" }));
    case "remove": {
      if (!state.shapes.some((shape) => shape.key === action.key)) return state;
      return commit(state, state.shapes.filter((shape) => shape.key !== action.key), state.selected === action.key ? null : state.selected);
    }
    case "setLabel":
      return change(state, action.key, false, (shape) => ({ ...shape, label: action.label }));
    case "convertCircle":
      return change(state, action.key, false, (shape) => (shape.circle ? { ...shape, ring: shapeRing(shape), circle: null, source: "drawn" } : shape));
    case "beginGesture":
      return { ...state, gesture: { shapes: state.shapes, selected: state.selected } };
    case "setKind": {
      const target = state.shapes.find((shape) => shape.key === action.key);
      if (!target || target.kind === action.kind) return state;
      const seq = nextSeq(state.shapes.filter((shape) => shape.key !== action.key), action.kind);
      return commit(state, state.shapes.map((shape) => (shape.key === action.key ? { ...shape, kind: action.kind, seq } : shape)));
    }
    case "movePoint":
      return change(state, action.key, action.live, (shape) => (shape.circle ? shape : { ...shape, ring: shape.ring.map((point, index) => (index === action.index ? tidy(action.position) : point)) }));
    case "insertPoint":
      return change(state, action.key, false, (shape) => {
        if (shape.circle || shape.ring.length >= AREA_LIMITS.maxRingVertices) return shape;
        return { ...shape, ring: [...shape.ring.slice(0, action.after + 1), tidy(action.position), ...shape.ring.slice(action.after + 1)] };
      });
    case "removePoint":
      return change(state, action.key, false, (shape) => (shape.circle || shape.ring.length <= AREA_LIMITS.minRingVertices ? shape : { ...shape, ring: shape.ring.filter((_, index) => index !== action.index) }));
    case "translate":
      return change(state, action.key, action.live, (shape) =>
        shape.circle
          ? { ...shape, circle: { ...shape.circle, lat: round6(shape.circle.lat + action.dLat), lng: round6(shape.circle.lng + action.dLng) } }
          : { ...shape, ring: shape.ring.map((point): Position => [round6(point[0] + action.dLng), round6(point[1] + action.dLat)]) },
      );
    case "setCircle":
      return change(state, action.key, action.live, (shape) => (shape.circle ? { ...shape, circle: { lat: round6(action.circle.lat), lng: round6(action.circle.lng), radiusM: Math.round(action.circle.radiusM) } } : shape));
    case "undo": {
      const previous = state.past[state.past.length - 1];
      if (!previous) return state;
      const selected = previous.shapes.some((shape) => shape.key === state.selected) ? state.selected : previous.selected;
      return { nextKey: state.nextKey, shapes: previous.shapes, selected, past: state.past.slice(0, -1), future: [{ shapes: state.shapes, selected: state.selected }, ...state.future] };
    }
    case "redo": {
      const next = state.future[0];
      if (!next) return state;
      return { nextKey: state.nextKey, shapes: next.shapes, selected: next.selected, past: [...state.past, { shapes: state.shapes, selected: state.selected }], future: state.future.slice(1) };
    }
  }
}

/** 一块图形自己的问题（坐标、点数、相邻重复、跨 180° 经线、共线、边交叉；圆是半径）。 */
export type ShapeProblem = RingIssue | { reason: "RADIUS_OUT_OF_RANGE" } | { reason: "CIRCLE_OUT_OF_BOUNDS" };

/** 圆能不能保存问 @nozomi/domain 的 circleIssues（后端保存时用的是同一个函数）；这里只把结果换成界面上的说法。 */
export function shapeProblems(shape: EditorShape): ShapeProblem[] {
  if (shape.circle) {
    const issues = circleIssues({ lat: shape.circle.lat, lng: shape.circle.lng }, shape.circle.radiusM);
    if (issues.some((issue) => issue.reason === "INVALID_COORDINATE")) return [{ reason: "INVALID_COORDINATE", point: 1 }];
    if (issues.some((issue) => issue.reason === "RADIUS_OUT_OF_RANGE")) return [{ reason: "RADIUS_OUT_OF_RANGE" }];
    // 圆心和半径本身没问题、算出来的那圈点却不行：圆跨过了 180° 经线或盖住了南北极
    return issues.length > 0 ? [{ reason: "CIRCLE_OUT_OF_BOUNDS" }] : [];
  }
  return ringIssues(shape.ring);
}

/** 算规则时用的样子：圆的半径不合规时没有那圈点，按空圈处理（它自己的问题由 shapeProblems 报）。 */
function ruleShapes(shapes: readonly EditorShape[]): { kind: AreaPolygonKind; ring: Ring; id: string }[] {
  return shapes.map((shape) => ({ kind: shape.kind, id: shape.key, ring: shape.circle && shapeProblems(shape).length > 0 ? [] : shapeRing(shape) }));
}

/** 整个区域层面的问题（至少一块营运区、各项上限）。每一块自己的问题不在这里。 */
export function areaProblems(shapes: readonly EditorShape[]): Extract<AreaShapeIssue, { reason: "NO_OPERATE_POLYGON" | "TOO_MANY_POLYGONS" | "TOO_MANY_TOTAL_VERTICES" }>[] {
  const valid = shapes.filter((shape) => shapeProblems(shape).length === 0);
  const issues = areaShapeIssues(ruleShapes(valid));
  const area = issues.filter((issue): issue is Extract<AreaShapeIssue, { reason: "NO_OPERATE_POLYGON" | "TOO_MANY_POLYGONS" | "TOO_MANY_TOTAL_VERTICES" }> => !("polygon" in issue));
  if (!shapes.some((shape) => shape.kind === "operate") && !area.some((issue) => issue.reason === "NO_OPERATE_POLYGON")) area.unshift({ reason: "NO_OPERATE_POLYGON" });
  return area.filter((issue) => issue.reason !== "NO_OPERATE_POLYGON" || !shapes.some((shape) => shape.kind === "operate"));
}

/** 有没有不改就不能保存的问题。 */
export function hasBlockingProblems(shapes: readonly EditorShape[]): boolean {
  return areaProblems(shapes).length > 0 || shapes.some((shape) => shapeProblems(shape).length > 0);
}

/** 值得提醒、但可以保存的情况，按图形的 key 归好。只对没有问题的图形判断。 */
export function shapeWarnings(shapes: readonly EditorShape[], cityCenter: { lat: number; lng: number } | null): Map<string, AreaShapeWarning[]> {
  const valid = shapes.filter((shape) => shapeProblems(shape).length === 0);
  const result = new Map<string, AreaShapeWarning[]>();
  for (const warning of areaShapeWarnings(ruleShapes(valid), cityCenter ?? undefined)) {
    const key = valid[warning.polygon]?.key;
    if (key !== undefined) result.set(key, [...(result.get(key) ?? []), "forbid" in warning ? { ...warning, forbid: warning.forbid } : warning]);
  }
  return result;
}

/** 提醒里说的「第 n 块禁行区」是哪一块（areaShapeWarnings 的下标是按没有问题的图形数的）。 */
export function validShapeAt(shapes: readonly EditorShape[], index: number): EditorShape | null {
  return shapes.filter((shape) => shapeProblems(shape).length === 0)[index] ?? null;
}

/** 按画面上的图形判断一个位置在哪（和后端自测接口是同一个函数）。返回的编号是图形的本地 key。 */
export function locateInEditor(shapes: readonly EditorShape[], point: { lat: number; lng: number }): PointLocation {
  return locatePoint(ruleShapes(shapes), point);
}

/** 提交给接口的样子：多边形给一圈坐标（闭合），圆给圆心和半径；已有的带编号。 */
export function toPolygonInputs(shapes: readonly EditorShape[]): AreaPolygonInput[] {
  return shapes.map((shape) => {
    const base = { ...(shape.id !== null ? { id: shape.id } : {}), kind: shape.kind, label: shape.label.trim() === "" ? null : shape.label.trim(), source: shape.source };
    if (shape.circle) return { ...base, source: "circle" as const, circle: { center: { lat: shape.circle.lat, lng: shape.circle.lng }, radius_m: shape.circle.radiusM } };
    const first = shape.ring[0];
    const closed = first ? [...shape.ring, first] : [];
    return { ...base, geometry: { type: "Polygon" as const, coordinates: [closed.map((point): [number, number] => [point[0], point[1]])] } };
  });
}

/** 两份图形内容是否相同（判断「有没有未保存的修改」；撤销回到原样算没改）。 */
export function sameShapes(a: readonly EditorShape[], b: readonly EditorShape[]): boolean {
  return JSON.stringify(toPolygonInputs(a)) === JSON.stringify(toPolygonInputs(b));
}

/** 全部图形复制成一段 GeoJSON（FeatureCollection，每一块带上类型和备注名），可以用「粘贴坐标」贴回来。 */
export function shapesToGeoJson(shapes: readonly EditorShape[]): string {
  const features = shapes.map((shape) => {
    const ring = shapeRing(shape);
    const first = ring[0];
    return { type: "Feature", properties: { kind: shape.kind, name: shapeName(shape), label: shape.label.trim() }, geometry: { type: "Polygon", coordinates: [first ? [...ring, first] : []] } };
  });
  return JSON.stringify({ type: "FeatureCollection", features });
}

/**
 * 读粘贴进来的文字（GeoJSON、WKT、坐标行；解析用 @nozomi/domain 的 parseShapeText）。比它多做两件事：
 * - 一个点都没有的多边形不算多边形（`"coordinates": [[]]`）：全是这种就按「里面没有多边形」报；
 * - 是从这里「复制」出去的 GeoJSON（每个要素的 properties 里有 kind）时，把每一块的类型和备注名带回来。
 */
export function parsePastedShapes(text: string): ParsedShapes {
  const parsed = parseShapeText(text);
  const meta = parsed.format === "geojson" ? copiedMeta(text) : [];
  const polygons: PastedPolygon[] = parsed.polygons.map((polygon, index) => {
    const own = meta.length === parsed.polygons.length ? meta[index] : undefined;
    return own ? { ...polygon, ...own } : { ...polygon };
  });
  const kept = polygons.filter((polygon) => polygon.outer.length > 0);
  if (kept.length === 0) throw new ShapeParseError({ reason: "NO_POLYGON" });
  return { ...parsed, polygons: kept };
}

/** 一段 GeoJSON 里每个多边形（按 parseShapeText 展开的顺序）带的类型和备注名；不是我们复制出去的那种就是空数组。 */
function copiedMeta(text: string): ({ kind: AreaPolygonKind; label: string } | undefined)[] {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return [];
  }
  const features = typeof root === "object" && root !== null && (root as { type?: unknown }).type === "FeatureCollection" && Array.isArray((root as { features?: unknown }).features) ? ((root as { features: unknown[] }).features) : [];
  const meta: ({ kind: AreaPolygonKind; label: string } | undefined)[] = [];
  for (const feature of features) {
    const { geometry, properties } = (typeof feature === "object" && feature !== null ? feature : {}) as { geometry?: { type?: unknown; coordinates?: unknown }; properties?: { kind?: unknown; label?: unknown } };
    const count = geometry?.type === "Polygon" ? 1 : geometry?.type === "MultiPolygon" && Array.isArray(geometry.coordinates) ? geometry.coordinates.length : 0;
    const kind = properties?.kind === "operate" || properties?.kind === "forbid" ? properties.kind : null;
    const label = typeof properties?.label === "string" ? properties.label.trim().slice(0, AREA_LIMITS.maxLabelLength) : "";
    for (let index = 0; index < count; index += 1) meta.push(kind === null ? undefined : { kind, label });
  }
  return meta.some((entry) => entry !== undefined) ? meta : [];
}

/** 全部图形的范围：[[南, 西], [北, 东]]；一个点都没有时是 null。 */
export function shapesBounds(shapes: readonly EditorShape[]): [[number, number], [number, number]] | null {
  const points = shapes.flatMap(shapeRing).filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]));
  if (points.length === 0) return null;
  const lngs = points.map((point) => point[0]);
  const lats = points.map((point) => point[1]);
  return [[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]];
}

/** 公里（最多 3 位小数）的文字 ↔ 整数米，用字符串换算，不用浮点乘法。认不出来返回 null。 */
export function kmTextToMeters(text: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(text.trim());
  if (!match) return null;
  return Number(match[1]) * 1000 + Number((match[2] ?? "").padEnd(3, "0"));
}

export function metersToKmText(meters: number): string {
  const whole = Math.trunc(meters / 1000);
  const rest = String(meters % 1000).padStart(3, "0").replace(/0+$/, "");
  return rest === "" ? String(whole) : `${whole}.${rest}`;
}
