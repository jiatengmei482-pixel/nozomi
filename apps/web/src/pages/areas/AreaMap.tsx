/**
 * 区域编辑器的地图画布（docs/design/02-components.md 第 20–22 节、tenant-areas.md 第 6、7 节）。
 *
 * 分工（ADR 0017）：Leaflet 只负责底图、平移缩放、把屏幕位置换算成坐标；
 * 图形、控制点、图例全部是这里自己画的 SVG / HTML，颜色只用设计令牌；
 * 图形的状态和操作在 lib/area-editor.ts（纯函数），这里只把指针事件翻译成那边的操作。
 */
import { AREA_LIMITS, type AreaPolygonKind, type Position, haversineMeters, normalizeRing } from "@nozomi/domain";
import L from "leaflet";
import { type Dispatch, type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import type { MapTiles } from "../../api/areas.ts";
import { Icon } from "../../components/Icon.tsx";
import { QuietTileLayer } from "../../lib/quiet-tile-layer.ts";
import { type EditorAction, type EditorShape, locateInEditor, metersToKmText, shapeName, shapeProblems, shapeRing, shapesBounds } from "../../lib/area-editor.ts";
import type { ProbeResult } from "./SelfTest.tsx";

export type MapTool = "select" | "polygon" | "circle" | "probe";

export interface AreaMapProps {
  tiles: MapTiles;
  shapes: readonly EditorShape[];
  selected: string | null;
  dispatch: Dispatch<EditorAction>;
  readOnly: boolean;
  tool: MapTool;
  /** 新画的图形是营运区还是禁行区 */
  newKind: AreaPolygonKind;
  /** 画完一块、点完自测位置、按了 Esc：回到「选择」 */
  onToolDone(): void;
  onProbe(point: { lat: number; lng: number }): void;
  probe: ProbeResult | null;
  cityCenter: { lat: number; lng: number } | null;
  /** 变了就把全部图形放进视野（载入、粘贴之后） */
  fitSignal: number;
}

const CITY_ZOOM = 11;
const MAX_FIT_ZOOM = 16;
/** 点在第一个点这么近（像素）以内算「点第一个点完成」。 */
const CLOSE_PIXELS = 12;
const HATCH_SPACING = 6;
const LABEL_SHIFT = 0.6;
const PROBE_LABELS = { operate: "在营运区内", forbid: "在禁行区内", outside: "不在营运区内" } as const;

interface Pixel {
  x: number;
  y: number;
}

type Drag =
  | { kind: "vertex"; key: string; index: number }
  | { kind: "center"; key: string }
  | { kind: "radius"; key: string };

/** 铺满画布的 45° 斜线（间距 6px）。禁行区的斜纹 = 这组线裁剪到图形内部；线的颜色在样式文件里。 */
function hatchLines(width: number, height: number): string {
  const step = HATCH_SPACING * Math.SQRT2;
  const parts: string[] = [];
  for (let x = 0; x < width + height; x += step) parts.push(`M${x.toFixed(1)},0L${(x - height).toFixed(1)},${height}`);
  return parts.join("");
}

/** 图例里的小图样：和地图上用同一套类名，所以画法一定相同。 */
export function Swatch({ kind }: { kind: "operate" | "forbid" | "overlap" | "probe" }) {
  const box = "M2,2H22V12H2Z";
  return (
    <svg className="legend-swatch" viewBox="0 0 24 14" aria-hidden="true">
      {kind === "probe" ? (
        <circle className="area-probe__pin" cx="12" cy="7" r="5" />
      ) : (
        <>
          {kind !== "forbid" && <path className="area-fill area-fill--operate" d={box} />}
          {kind !== "operate" && <path className="area-fill area-fill--forbid" d={box} />}
          {kind !== "operate" && <path className="area-hatch" d="M6,2L2,6M12,2L2,12M18,2L8,12M22,4L14,12M22,10L20,12" />}
          {kind !== "overlap" && <path className="area-casing" d={box} />}
          {kind !== "overlap" && <path className={`area-stroke area-stroke--${kind}`} d={box} />}
        </>
      )}
    </svg>
  );
}

/** 坐标表里还没填完的点（空格子）不是数：这样的点不上地图。 */
function isPlaced(position: Position): boolean {
  return Number.isFinite(position[0]) && Number.isFinite(position[1]);
}

function isDark(): boolean {
  const chosen = document.documentElement.dataset["theme"];
  return chosen === "dark" || (chosen !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
}

export function AreaMap({ tiles, shapes, selected, dispatch, readOnly, tool, newKind, onToolDone, onProbe, probe, cityCenter, fitSignal }: AreaMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const clipId = `area-clip-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const mapRef = useRef<L.Map | null>(null);
  const [, setView] = useState(0);
  const [ready, setReady] = useState(false);
  const [tileTrouble, setTileTrouble] = useState(false);
  const [draft, setDraft] = useState<Position[]>([]);
  const [hover, setHover] = useState<Position | null>(null);
  const drag = useRef<Drag | null>(null);
  const [radiusHint, setRadiusHint] = useState<string | null>(null);

  // 这些值在事件处理函数里要拿最新的
  const latest = useRef({ tool, newKind, shapes, selected, draft, readOnly, onToolDone, onProbe, dispatch });
  latest.current = { tool, newKind, shapes, selected, draft, readOnly, onToolDone, onProbe, dispatch };

  const finishPolygon = (): void => {
    const ring = normalizeRing(latest.current.draft, { dedupe: true });
    if (ring.length < AREA_LIMITS.minRingVertices) return;
    latest.current.dispatch({ type: "addPolygon", kind: latest.current.newKind, ring });
    setDraft([]);
    setHover(null);
    latest.current.onToolDone();
  };

  // 建地图：只建一次
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const map = L.map(container, { dragging: !coarse, zoomControl: false, attributionControl: false, zoomAnimation: false, fadeAnimation: false, doubleClickZoom: false, minZoom: tiles.min_zoom, maxZoom: tiles.max_zoom });
    const dark = isDark();
    const url = dark && tiles.dark_url_template !== null ? tiles.dark_url_template : tiles.url_template;
    if (dark && tiles.dark_url_template === null) container.classList.add("area-map__canvas--dimmed");
    let loaded = 0;
    let failed = 0;
    new QuietTileLayer(url, { tileSize: tiles.tile_size, zoomOffset: tiles.tile_size === 512 ? -1 : 0, minZoom: tiles.min_zoom, maxZoom: tiles.max_zoom, referrerPolicy: tiles.referrer_policy })
      .on("tileload", () => {
        loaded += 1;
        setTileTrouble(false);
      })
      .on("tileerror", () => {
        failed += 1;
        if (loaded === 0 && failed >= 3) setTileTrouble(true);
      })
      .addTo(map);
    const bounds = shapesBounds(latest.current.shapes);
    if (bounds) map.fitBounds(bounds, { padding: [24, 24], maxZoom: MAX_FIT_ZOOM });
    else if (cityCenter) map.setView([cityCenter.lat, cityCenter.lng], CITY_ZOOM);
    else map.setView([0, 0], tiles.min_zoom);
    const redraw = (): void => setView((value) => value + 1);
    map.on("move zoom resize", redraw);

    map.on("click", (event: L.LeafletMouseEvent) => {
      const state = latest.current;
      const position: Position = [event.latlng.lng, event.latlng.lat];
      if (state.tool === "probe") {
        state.onProbe({ lat: event.latlng.lat, lng: event.latlng.lng });
        state.onToolDone();
      } else if (state.tool === "polygon") {
        const first = state.draft[0];
        if (first && state.draft.length >= AREA_LIMITS.minRingVertices) {
          const a = map.latLngToContainerPoint([first[1], first[0]]);
          if (a.distanceTo(event.containerPoint) <= CLOSE_PIXELS) return finishPolygon();
        }
        if (state.draft.length < AREA_LIMITS.maxRingVertices) setDraft([...state.draft, position]);
      } else if (state.tool === "circle") {
        const center = state.draft[0];
        if (!center) return setDraft([position]);
        const radius = Math.round(haversineMeters({ lat: center[1], lng: center[0] }, event.latlng));
        const clamped = Math.min(AREA_LIMITS.maxRadiusM, Math.max(AREA_LIMITS.minRadiusM, radius));
        state.dispatch({ type: "addCircle", kind: state.newKind, circle: { lat: center[1], lng: center[0], radiusM: clamped } });
        setDraft([]);
        setHover(null);
        state.onToolDone();
      } else {
        // 选择：点在哪块里就选哪块；禁行区在上面，先选它；同一个位置再点一次轮换到下一块
        const hit = locateInEditor(state.shapes.filter((shape) => shapeProblems(shape).length === 0), event.latlng);
        const candidates = [...hit.forbidPolygonIds, ...hit.operatePolygonIds];
        const index = candidates.indexOf(state.selected ?? "");
        state.dispatch({ type: "select", key: candidates.length === 0 ? null : (candidates[(index + 1) % candidates.length] ?? null) });
      }
    });
    map.on("dblclick", () => {
      if (latest.current.tool === "polygon") finishPolygon();
    });
    map.on("mousemove", (event: L.LeafletMouseEvent) => {
      if (latest.current.tool === "polygon" || latest.current.tool === "circle") setHover([event.latlng.lng, event.latlng.lat]);
    });
    mapRef.current = map;
    setReady(true);
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // 底图配置在页面打开期间不变
  }, [tiles]);

  // 换了工具：丢掉画了一半的
  useEffect(() => {
    setDraft([]);
    setHover(null);
  }, [tool]);

  // 画图时的键盘：Enter 完成，Esc 取消，Backspace 去掉上一个点
  useEffect(() => {
    if (tool === "select") return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key === "Escape") latest.current.onToolDone();
      else if (event.key === "Enter" && latest.current.tool === "polygon") {
        event.preventDefault();
        finishPolygon();
      } else if (event.key === "Backspace" && latest.current.tool === "polygon") setDraft((points) => points.slice(0, -1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tool]);

  const fitAll = (): void => {
    const bounds = shapesBounds(latest.current.shapes);
    if (bounds) mapRef.current?.fitBounds(bounds, { padding: [24, 24], maxZoom: MAX_FIT_ZOOM });
  };
  useEffect(() => {
    if (fitSignal > 0) fitAll();
  }, [fitSignal]);

  // 选了城市（或换了城市）而还没有图形：移到城市中心
  const centerKey = cityCenter ? `${cityCenter.lat},${cityCenter.lng}` : "";
  useEffect(() => {
    if (cityCenter && mapRef.current && shapesBounds(latest.current.shapes) === null) mapRef.current.setView([cityCenter.lat, cityCenter.lng], CITY_ZOOM);
  }, [centerKey]);

  // 自测的位置不在视野里时移过去
  const probeKey = probe ? `${probe.point.lat},${probe.point.lng}` : "";
  useEffect(() => {
    const map = mapRef.current;
    if (probe && map && !map.getBounds().contains([probe.point.lat, probe.point.lng])) map.panTo([probe.point.lat, probe.point.lng]);
  }, [probeKey]);

  const map = mapRef.current;
  const project = (position: Position): Pixel => {
    const point = map?.latLngToContainerPoint([position[1], position[0]]);
    return { x: point?.x ?? 0, y: point?.y ?? 0 };
  };
  const path = (ring: readonly Position[], closed = true): string => {
    const points = ring.filter(isPlaced).map(project);
    return points.length === 0 ? "" : `M${points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join("L")}${closed ? "Z" : ""}`;
  };

  const eventPosition = (event: ReactPointerEvent<SVGElement>): Position | null => {
    const container = containerRef.current;
    if (!map || !container) return null;
    const box = container.getBoundingClientRect();
    const latlng = map.containerPointToLatLng([event.clientX - box.left, event.clientY - box.top]);
    return [latlng.lng, latlng.lat];
  };
  const startDrag = (event: ReactPointerEvent<SVGElement>, target: Drag): void => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = target;
    dispatch({ type: "beginGesture" });
  };
  const moveDrag = (event: ReactPointerEvent<SVGElement>): void => {
    const target = drag.current;
    const position = eventPosition(event);
    if (!target || !position) return;
    const shape = shapes.find((entry) => entry.key === target.key);
    if (!shape) return;
    if (target.kind === "vertex") dispatch({ type: "movePoint", key: target.key, index: target.index, position, live: true });
    else if (shape.circle && target.kind === "center") dispatch({ type: "setCircle", key: target.key, circle: { ...shape.circle, lat: position[1], lng: position[0] }, live: true });
    else if (shape.circle) {
      const radius = Math.round(haversineMeters({ lat: shape.circle.lat, lng: shape.circle.lng }, { lat: position[1], lng: position[0] }));
      const radiusM = Math.min(AREA_LIMITS.maxRadiusM, Math.max(AREA_LIMITS.minRadiusM, radius));
      setRadiusHint(`半径 ${metersToKmText(radiusM)} 公里`);
      dispatch({ type: "setCircle", key: target.key, circle: { ...shape.circle, radiusM }, live: true });
    }
  };
  const endDrag = (): void => {
    drag.current = null;
    setRadiusHint(null);
  };
  const handle = (key: string, at: Pixel, className: string, label: string, target: Drag): ReactNode => (
    <circle key={key} className={className} cx={at.x} cy={at.y} r={7} role="img" aria-label={label} onPointerDown={(event) => startDrag(event, target)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} />
  );

  const drawable = useMemo(() => shapes.map((shape) => ({ shape, ring: shapeRing(shape) })).filter((entry) => entry.ring.filter(isPlaced).length >= 2), [shapes]);
  const operate = drawable.filter((entry) => entry.shape.kind === "operate");
  const forbid = drawable.filter((entry) => entry.shape.kind === "forbid");
  const selectedEntry = drawable.find((entry) => entry.shape.key === selected) ?? null;
  /** 名字标在图形里面：禁行区在正中；营运区往第一个点那边偏一些，免得被画在它里面的禁行区的名字盖住。 */
  const labelAt = (ring: readonly Position[], kind: AreaPolygonKind): Pixel => {
    const points = ring.filter(isPlaced).map(project);
    const middle = { x: points.reduce((sum, point) => sum + point.x, 0) / points.length, y: points.reduce((sum, point) => sum + point.y, 0) / points.length };
    const first = points[0];
    return kind === "forbid" || !first ? middle : { x: middle.x + (first.x - middle.x) * LABEL_SHIFT, y: middle.y + (first.y - middle.y) * LABEL_SHIFT };
  };
  const draftCircle = tool === "circle" && draft[0] && hover ? { center: project(draft[0]), edge: project(hover), meters: Math.round(haversineMeters({ lat: draft[0][1], lng: draft[0][0] }, { lat: hover[1], lng: hover[0] })) } : null;

  const size = map?.getSize() ?? null;
  const hatch = useMemo(() => hatchLines(size?.x ?? 0, size?.y ?? 0), [size?.x, size?.y]);

  const hint =
    tool === "polygon"
      ? "点地图加点；双击、按 Enter 或点第一个点完成；Backspace 去掉上一个点；Esc 取消。"
      : tool === "circle"
        ? draft.length === 0
          ? "点一下定圆心；Esc 取消。"
          : "再点一下定半径；Esc 取消。"
        : tool === "probe"
          ? "点一个位置来自测；Esc 取消。"
          : null;

  return (
    <div className={tool === "select" ? "area-map" : "area-map area-map--drawing"}>
      <div ref={containerRef} className="area-map__canvas" role="application" aria-label="地图：拖动平移，滚轮或加减号缩放" />
      {ready && map && (
        <svg className="area-map__overlay" aria-hidden={readOnly || undefined}>
          <defs>
            {forbid.map(({ shape, ring }) => (
              <clipPath key={shape.key} id={`${clipId}-${shape.key}`}>
                <path d={path(ring)} />
              </clipPath>
            ))}
          </defs>
          {operate.map(({ shape, ring }) => (
            <path key={`f-${shape.key}`} className={shape.key === selected ? "area-fill area-fill--operate area-fill--selected" : "area-fill area-fill--operate"} d={path(ring)} />
          ))}
          {forbid.map(({ shape, ring }) => (
            <g key={`f-${shape.key}`}>
              <path className={shape.key === selected ? "area-fill area-fill--forbid area-fill--selected" : "area-fill area-fill--forbid"} d={path(ring)} />
              <path className="area-hatch" d={hatch} clipPath={`url(#${clipId}-${shape.key})`} />
            </g>
          ))}
          {[...operate, ...forbid].map(({ shape, ring }) => (
            <g key={`s-${shape.key}`} data-shape={shape.key} data-kind={shape.kind}>
              <path className="area-casing" d={path(ring)} />
              <path className={`area-stroke area-stroke--${shape.kind}${shape.key === selected ? " area-stroke--selected" : ""}${shapeProblems(shape).length > 0 ? " area-stroke--problem" : ""}`} d={path(ring)} />
            </g>
          ))}
          {drawable.map(({ shape, ring }) => {
            const at = labelAt(ring, shape.kind);
            return (
              <text key={`l-${shape.key}`} className={shape.key === selected ? "area-label area-label--selected" : "area-label"} x={at.x} y={at.y} textAnchor="middle">
                {shapeName(shape)}
              </text>
            );
          })}
          {!readOnly && tool === "select" && selectedEntry && !selectedEntry.shape.circle && (
            <g>
              {selectedEntry.ring.map((point, index) => {
                const next = selectedEntry.ring[(index + 1) % selectedEntry.ring.length] as Position;
                if (!isPlaced(point) || !isPlaced(next)) return null;
                const a = project(point);
                const b = project(next);
                return (
                  <circle
                    key={`m-${index}`}
                    className="area-handle area-handle--mid"
                    cx={(a.x + b.x) / 2}
                    cy={(a.y + b.y) / 2}
                    r={5}
                    role="img"
                    aria-label={`在第 ${index + 1} 个点后面加一个点`}
                    onPointerDown={(event) => {
                      const position = eventPosition(event);
                      if (!position) return;
                      event.stopPropagation();
                      event.currentTarget.setPointerCapture(event.pointerId);
                      dispatch({ type: "insertPoint", key: selectedEntry.shape.key, after: index, position });
                      drag.current = { kind: "vertex", key: selectedEntry.shape.key, index: index + 1 };
                    }}
                    onPointerMove={moveDrag}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                  />
                );
              })}
              {selectedEntry.ring.map((point, index) => (isPlaced(point) ? handle(`v-${index}`, project(point), "area-handle", `第 ${index + 1} 个点`, { kind: "vertex", key: selectedEntry.shape.key, index }) : null))}
            </g>
          )}
          {!readOnly && tool === "select" && selectedEntry?.shape.circle && (
            <g>
              {handle("c", project([selectedEntry.shape.circle.lng, selectedEntry.shape.circle.lat]), "area-handle", "圆心", { kind: "center", key: selectedEntry.shape.key })}
              {handle("r", project(selectedEntry.ring[16] ?? selectedEntry.ring[0] ?? [0, 0]), "area-handle area-handle--radius", "半径", { kind: "radius", key: selectedEntry.shape.key })}
            </g>
          )}
          {tool === "polygon" && draft.length > 0 && (
            <g>
              <path className={`area-stroke area-stroke--${newKind} area-stroke--draft`} d={path(hover ? [...draft, hover] : draft, false)} />
              {draft.map((point, index) => {
                const at = project(point);
                return <circle key={index} className={index === 0 ? "area-handle area-handle--first" : "area-handle area-handle--static"} cx={at.x} cy={at.y} r={index === 0 ? 7 : 4} />;
              })}
            </g>
          )}
          {draftCircle && (
            <g>
              <circle className={`area-stroke area-stroke--${newKind} area-stroke--draft`} cx={draftCircle.center.x} cy={draftCircle.center.y} r={Math.hypot(draftCircle.edge.x - draftCircle.center.x, draftCircle.edge.y - draftCircle.center.y)} />
              <text className="area-label area-label--selected" x={draftCircle.edge.x + 10} y={draftCircle.edge.y}>{`半径 ${metersToKmText(Math.min(AREA_LIMITS.maxRadiusM, Math.max(AREA_LIMITS.minRadiusM, draftCircle.meters)))} 公里`}</text>
            </g>
          )}
          {tool === "circle" && draft[0] && <circle className="area-handle area-handle--static" cx={project(draft[0]).x} cy={project(draft[0]).y} r={4} />}
          {probe && (
            <g className="area-probe">
              <circle className="area-probe__pin" cx={project([probe.point.lng, probe.point.lat]).x} cy={project([probe.point.lng, probe.point.lat]).y} r={7} />
              <text className="area-label area-label--selected" x={project([probe.point.lng, probe.point.lat]).x + 12} y={project([probe.point.lng, probe.point.lat]).y + 4}>
                {PROBE_LABELS[probe.location.result]}
              </text>
            </g>
          )}
        </svg>
      )}
      <div className="area-map__controls">
        <button type="button" className="icon-button area-map__control" aria-label="放大" onClick={() => mapRef.current?.zoomIn()}>
          <Icon name="plus" />
        </button>
        <button type="button" className="icon-button area-map__control" aria-label="缩小" onClick={() => mapRef.current?.zoomOut()}>
          <Icon name="minus" />
        </button>
        <button type="button" className="icon-button area-map__control" aria-label="看全部图形" disabled={drawable.length === 0} onClick={fitAll}>
          <Icon name="map" />
        </button>
        <button type="button" className="icon-button area-map__control" aria-label="回到城市中心" disabled={cityCenter === null} onClick={() => cityCenter && mapRef.current?.setView([cityCenter.lat, cityCenter.lng], CITY_ZOOM)}>
          <Icon name="target" />
        </button>
      </div>
      {(hint !== null || radiusHint !== null) && (
        <p className="area-map__hint" role="status">
          {radiusHint ?? hint}
        </p>
      )}
      {tileTrouble && <p className="area-map__hint area-map__hint--trouble">底图没有加载出来。图形照常显示，也可以用左边的坐标表完成全部操作。</p>}
      <div className="area-map__footer">
        <ul className="area-map__legend" aria-label="图例">
          <li>
            <Swatch kind="operate" />
            <strong>营运区</strong> 可以报价
          </li>
          <li>
            <Swatch kind="forbid" />
            <strong>禁行区</strong> 不报价，优先于营运区
          </li>
          <li>
            <Swatch kind="overlap" />
            <strong>重叠的地方</strong> 按禁行区算
          </li>
          {probe && (
            <li>
              <Swatch kind="probe" />
              自测的位置
            </li>
          )}
        </ul>
        <p className="area-map__attribution">
          {tiles.attribution.map((entry) =>
            entry.href !== null ? (
              <a key={entry.text} className="link" href={entry.href} rel="noopener noreferrer">
                {entry.text}
              </a>
            ) : (
              <span key={entry.text}>{entry.text}</span>
            ),
          )}
        </p>
      </div>
    </div>
  );
}
