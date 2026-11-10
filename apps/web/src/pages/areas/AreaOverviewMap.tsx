/**
 * 区域地图的画布（M8-18，tenant-areas.md 第 19 节、ADR 0074）：把一批区域画成半透明的多边形，重叠的地方用警告色标出来；
 * 点图上的区域 = 选中它（交给页面滚动列表）；页面选中一个区域时，把它放进视野。只看不改——改形状进编辑页（同一套编辑器）。
 *
 * 图形层只通过 `MapSurface`（lib/map-surface.ts）和底图打交道：坐标换像素、点击换坐标、移动视野。现在的底图是 Leaflet + 配置的瓦片；
 * 测试和以后换底图时换一个 `surfaceFactory` 即可，这里不用改。颜色只用设计令牌（样式文件 areas.css 的 `area-color--N`）。
 */
import { type AreaOverlapPiece, type AreaPolygonKind, type Position, locatePoint } from "@nozomi/domain";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { MapTiles } from "../../api/areas.ts";
import { Icon } from "../../components/Icon.tsx";
import { type LatLngBox, type LatLngPoint, type MapSurface, type Pixel, type SurfaceEvents, createLeafletSurface } from "../../lib/map-surface.ts";
import { hatchLines, Swatch } from "./AreaMap.tsx";

export interface OverviewArea {
  id: string;
  name: string;
  /** 颜色（lib/area-overview.ts 的 `colorSlot`） */
  slot: number;
  active: boolean;
  polygons: readonly { id: string; kind: AreaPolygonKind; ring: readonly Position[] }[];
}

export interface OverviewMarker {
  point: LatLngPoint;
  label: string;
}

export interface AreaOverviewMapProps {
  tiles: MapTiles;
  areas: readonly OverviewArea[];
  selected: string | null;
  onSelect(id: string | null): void;
  overlaps: readonly AreaOverlapPiece[];
  showOverlaps: boolean;
  /** 变了就把视野移到选中的区域（没有选中时：全部区域） */
  focusSignal: number;
  marker: OverviewMarker | null;
  /** 地图的名字（读屏） */
  label?: string;
  /** 换底图、测试用；默认 Leaflet */
  surfaceFactory?: (container: HTMLElement, tiles: MapTiles, events: SurfaceEvents) => MapSurface;
}

const MAX_FIT_ZOOM = 15;
const MARKER_ZOOM = 15;
/** 区域在画面上小于这么多像素宽时不标名字（免得名字挤成一团） */
const LABEL_MIN_PIXELS = 48;

function boxOf(rings: readonly (readonly Position[])[]): LatLngBox | null {
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const ring of rings) {
    for (const [lng, lat] of ring) {
      south = Math.min(south, lat);
      north = Math.max(north, lat);
      west = Math.min(west, lng);
      east = Math.max(east, lng);
    }
  }
  return Number.isFinite(south) ? [[south, west], [north, east]] : null;
}

/** 点在哪些区域里（营运区或它自己的禁行区都算点中了这个区域），小的在前：叠在一起时先选小的。 */
export function areasAt(areas: readonly OverviewArea[], point: LatLngPoint): string[] {
  const hits = areas.filter((area) => locatePoint(area.polygons.map((polygon) => ({ id: polygon.id, kind: polygon.kind, ring: [...polygon.ring] })), point).result !== "outside");
  const span = (area: OverviewArea): number => {
    const box = boxOf(area.polygons.map((polygon) => polygon.ring));
    return box === null ? Infinity : (box[1][0] - box[0][0]) * (box[1][1] - box[0][1]);
  };
  return hits.sort((a, b) => span(a) - span(b)).map((area) => area.id);
}

export function AreaOverviewMap({ tiles, areas, selected, onSelect, overlaps, showOverlaps, focusSignal, marker, label = "区域地图", surfaceFactory = createLeafletSurface }: AreaOverviewMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const clipPrefix = `overview-clip-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const surfaceRef = useRef<MapSurface | null>(null);
  const [, setView] = useState(0);
  const [ready, setReady] = useState(false);
  const [tileTrouble, setTileTrouble] = useState(false);
  const latest = useRef({ areas, selected, onSelect });
  latest.current = { areas, selected, onSelect };

  const fitTo = (id: string | null): void => {
    const surface = surfaceRef.current;
    const shown = latest.current.areas;
    const target = id === null ? shown : shown.filter((area) => area.id === id);
    const box = boxOf(target.flatMap((area) => area.polygons.map((polygon) => polygon.ring)));
    if (surface && box) surface.fit(box, MAX_FIT_ZOOM);
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const surface = surfaceFactory(container, tiles, {
      onView: () => setView((value) => value + 1),
      onTileTrouble: setTileTrouble,
      onClick: (point) => {
        const state = latest.current;
        const hits = areasAt(state.areas, point);
        // 叠在一起的地方再点一次，轮到下一个
        const index = hits.indexOf(state.selected ?? "");
        state.onSelect(hits.length === 0 ? null : (hits[(index + 1) % hits.length] ?? null));
      },
    });
    surfaceRef.current = surface;
    fitTo(latest.current.selected);
    setReady(true);
    return () => {
      surface.destroy();
      surfaceRef.current = null;
    };
    // 底图配置在页面打开期间不变
  }, [tiles, surfaceFactory]);

  useEffect(() => {
    if (focusSignal > 0) fitTo(latest.current.selected);
  }, [focusSignal]);

  // 换了一批区域（筛选、重新加载）而没有选中的：把这一批放进视野
  const areasKey = areas.map((area) => area.id).join(",");
  const firstKey = useRef(areasKey);
  useEffect(() => {
    if (areasKey === firstKey.current) return;
    firstKey.current = areasKey;
    if (latest.current.selected === null) fitTo(null);
  }, [areasKey]);

  const markerKey = marker ? `${marker.point.lat},${marker.point.lng}` : "";
  useEffect(() => {
    if (marker) surfaceRef.current?.setView(marker.point, MARKER_ZOOM);
  }, [markerKey]);

  const surface = surfaceRef.current;
  const project = (position: Position): Pixel => surface?.project({ lat: position[1], lng: position[0] }) ?? { x: 0, y: 0 };
  const path = (ring: readonly Position[]): string => (ring.length === 0 ? "" : `M${ring.map((point) => project(point)).map((at) => `${at.x.toFixed(1)},${at.y.toFixed(1)}`).join("L")}Z`);
  const size = surface?.size() ?? { x: 0, y: 0 };
  const hatch = useMemo(() => hatchLines(size.x, size.y), [size.x, size.y]);
  // 选中的区域画在最上面（描边、名字）；填充的层次不变
  const ordered = [...areas.filter((area) => area.id !== selected), ...areas.filter((area) => area.id === selected)];
  const overlapPath = showOverlaps ? overlaps.map((piece) => path(piece.ring)).join("") : "";
  const selectedOverlapPath = showOverlaps && selected !== null ? overlaps.filter((piece) => piece.areaIds.includes(selected)).map((piece) => path(piece.ring)).join("") : "";

  return (
    <div className="area-map area-overview-map">
      <div ref={containerRef} className="area-map__canvas" role="application" aria-label={`${label}：拖动平移，滚轮或加减号缩放；区域的名称、形状和重叠在旁边的列表里`} />
      {ready && surface && (
        <svg className="area-map__overlay" aria-hidden="true">
          <defs>
            {areas.flatMap((area) =>
              area.polygons
                .filter((polygon) => polygon.kind === "forbid")
                .map((polygon) => (
                  <clipPath key={polygon.id} id={`${clipPrefix}-${polygon.id}`}>
                    <path d={path(polygon.ring)} />
                  </clipPath>
                )),
            )}
          </defs>
          {areas.map((area) => (
            <g key={`f-${area.id}`} className={`area-color--${area.slot}${area.active ? "" : " area-overview--disabled"}`}>
              {area.polygons
                .filter((polygon) => polygon.kind === "operate")
                .map((polygon) => (
                  <path key={polygon.id} className={area.id === selected ? "area-overview-fill area-overview-fill--selected" : "area-overview-fill"} d={path(polygon.ring)} />
                ))}
            </g>
          ))}
          {areas.flatMap((area) =>
            area.polygons
              .filter((polygon) => polygon.kind === "forbid")
              .map((polygon) => (
                <g key={`x-${polygon.id}`}>
                  <path className="area-fill area-fill--forbid" d={path(polygon.ring)} />
                  <path className="area-hatch" d={hatch} clipPath={`url(#${clipPrefix}-${polygon.id})`} />
                </g>
              )),
          )}
          {overlapPath !== "" && <path className="area-overlap" d={overlapPath} data-overlap="all" />}
          {selectedOverlapPath !== "" && <path className="area-overlap area-overlap--selected" d={selectedOverlapPath} data-overlap="selected" />}
          {ordered.map((area) => (
            <g key={`s-${area.id}`} className={`area-color--${area.slot}${area.active ? "" : " area-overview--disabled"}`} data-area={area.id}>
              {area.polygons.map((polygon) => (
                <g key={polygon.id}>
                  <path className="area-casing" d={path(polygon.ring)} />
                  <path className={polygon.kind === "forbid" ? "area-stroke area-stroke--forbid" : `area-overview-stroke${area.id === selected ? " area-overview-stroke--selected" : ""}`} d={path(polygon.ring)} />
                </g>
              ))}
            </g>
          ))}
          {ordered.map((area) => {
            const operate = area.polygons.filter((polygon) => polygon.kind === "operate").flatMap((polygon) => polygon.ring.map(project));
            if (operate.length === 0) return null;
            const xs = operate.map((at) => at.x);
            const ys = operate.map((at) => at.y);
            const width = Math.max(...xs) - Math.min(...xs);
            if (width < LABEL_MIN_PIXELS && area.id !== selected) return null;
            return (
              <text key={`l-${area.id}`} className={area.id === selected ? "area-label area-label--selected" : "area-label"} x={(Math.max(...xs) + Math.min(...xs)) / 2} y={(Math.max(...ys) + Math.min(...ys)) / 2} textAnchor="middle">
                {area.name}
              </text>
            );
          })}
          {marker && (
            <g className="area-probe">
              <circle className="area-probe__pin" cx={project([marker.point.lng, marker.point.lat]).x} cy={project([marker.point.lng, marker.point.lat]).y} r={7} />
              <text className="area-label area-label--selected" x={project([marker.point.lng, marker.point.lat]).x + 12} y={project([marker.point.lng, marker.point.lat]).y}>
                {marker.label}
              </text>
            </g>
          )}
        </svg>
      )}
      <div className="area-map__controls">
        <button type="button" className="icon-button area-map__control" aria-label="放大" onClick={() => surfaceRef.current?.zoomIn()}>
          <Icon name="plus" />
        </button>
        <button type="button" className="icon-button area-map__control" aria-label="缩小" onClick={() => surfaceRef.current?.zoomOut()}>
          <Icon name="minus" />
        </button>
        <button type="button" className="icon-button area-map__control" aria-label="看全部区域" disabled={areas.length === 0} onClick={() => fitTo(null)}>
          <Icon name="map" />
        </button>
      </div>
      {tileTrouble && <p className="area-map__hint area-map__hint--trouble">底图没有加载出来。区域照常显示，名称和重叠见旁边的列表。</p>}
      <div className="area-map__footer">
        <ul className="area-map__legend" aria-label="图例">
          <li>
            <svg className="legend-swatch" viewBox="0 0 24 14" aria-hidden="true">
              <path className="area-overview-fill area-color--0" d="M2,2H22V12H2Z" />
              <path className="area-overview-stroke area-color--0" d="M2,2H22V12H2Z" />
            </svg>
            <strong>区域</strong> 颜色和列表的圆点一致
          </li>
          <li>
            <Swatch kind="forbid" />
            <strong>禁行区</strong> 只管它所在的区域
          </li>
          {showOverlaps && (
            <li>
              <svg className="legend-swatch" viewBox="0 0 24 14" aria-hidden="true">
                <path className="area-overlap" d="M2,2H22V12H2Z" />
              </svg>
              <strong>重叠的地方</strong> 报价取最低
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
