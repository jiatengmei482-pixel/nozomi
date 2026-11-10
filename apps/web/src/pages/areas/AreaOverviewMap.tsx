/**
 * 区域地图的画布（M8-18，tenant-areas.md 第 19 节、ADR 0074）：把一批区域画成半透明的多边形，重叠的地方用警告色标出来；
 * 点图上的区域 = 选中它（交给页面滚动列表）；页面选中一个区域时，把它放进视野。只看不改——改形状进编辑页（同一套编辑器）。
 *
 * 图形层只通过 `MapSurface`（lib/map-surface.ts）和底图打交道：坐标换像素、点击换坐标、移动视野。现在的底图是 Leaflet + 配置的瓦片；
 * 测试和以后换底图时换一个 `surfaceFactory` 即可，这里不用改。颜色只用设计令牌（样式文件 areas.css 的 `area-color--N`）。
 */
import { type AreaOverlapPiece, type AreaPolygonKind, type AreaRole, PRODUCT_CATEGORY_NAMES, type Position, locatePoint } from "@nozomi/domain";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { MapTiles } from "../../api/areas.ts";
import { Icon } from "../../components/Icon.tsx";
import { type LatLngBox, type LatLngPoint, type MapSurface, type Pixel, type SurfaceEvents, createLeafletSurface } from "../../lib/map-surface.ts";
import { formatLocalDateTime } from "../../lib/master-display.ts";
import { DEMAND_REASON_NAMES, type DemandMapPoint, demandDotRadius, pointText, serviceLocalText } from "../../lib/uncovered-demand-display.ts";
import { hatchLines, Swatch } from "./AreaMap.tsx";

export interface OverviewArea {
  id: string;
  name: string;
  /** 颜色（lib/area-overview.ts 的 `colorSlot`） */
  slot: number;
  active: boolean;
  /** 用途（M8-20）：运营区域虚线、很淡的填充；报价区域、运营 + 报价实线（不给按运营 + 报价） */
  role?: AreaRole;
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
  /** 报价区域超出运营区域的部分（M8-20）：警告色斜线；没有时不画、图例里不列 */
  outside?: readonly AreaOverlapPiece[];
  /** 运营后台「未覆盖需求」图层（M8-20）：给了就画、图例里列出；`null` / 不给 = 图层关着 */
  demands?: readonly DemandMapPoint[] | null;
  /** 地图的名字（读屏） */
  label?: string;
  /** 换底图、测试用；默认 Leaflet */
  surfaceFactory?: (container: HTMLElement, tiles: MapTiles, events: SurfaceEvents) => MapSurface;
}

const MAX_FIT_ZOOM = 15;
const MARKER_ZOOM = 15;
/** 区域在画面上小于这么多像素宽时不标名字（免得名字挤成一团） */
const LABEL_MIN_PIXELS = 48;
/** 运营区域的名字离上边框多少像素 */
const OPERATING_LABEL_OFFSET = 16;

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

/** 点在某个未覆盖需求的点上（像素距离在点的半径 + 4 以内），最近的那个。 */
export function demandAt(points: readonly DemandMapPoint[], at: Pixel, project: (point: LatLngPoint) => Pixel): DemandMapPoint | null {
  let best: DemandMapPoint | null = null;
  let bestDistance = Infinity;
  for (const entry of points) {
    const pixel = project(entry.point);
    const distance = Math.hypot(pixel.x - at.x, pixel.y - at.y);
    if (distance <= demandDotRadius(entry.item.repeat_count) + 4 && distance < bestDistance) {
      best = entry;
      bestDistance = distance;
    }
  }
  return best;
}

const isOperating = (area: OverviewArea): boolean => area.role === "operating";

export function AreaOverviewMap({ tiles, areas, selected, onSelect, overlaps, showOverlaps, focusSignal, marker, outside, demands = null, label = "区域地图", surfaceFactory = createLeafletSurface }: AreaOverviewMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const clipPrefix = `overview-clip-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const surfaceRef = useRef<MapSurface | null>(null);
  const [, setView] = useState(0);
  const [ready, setReady] = useState(false);
  const [tileTrouble, setTileTrouble] = useState(false);
  const [popup, setPopup] = useState<DemandMapPoint | null>(null);
  const latest = useRef({ areas, selected, onSelect, demands, marker });
  latest.current = { areas, selected, onSelect, demands, marker };

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
        const current = surfaceRef.current;
        if (state.demands && current) {
          const hit = demandAt(state.demands, current.project(point), (at) => current.project(at));
          setPopup(hit);
          if (hit) return;
        }
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
    // 有位置标记（定位、从未覆盖需求列表过来）时视野留在标记上，不被区域取回来之后的「看全部」挤走
    const pinned = latest.current.marker;
    if (pinned) surfaceRef.current?.setView(pinned.point, MARKER_ZOOM);
    else if (latest.current.selected === null) fitTo(null);
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
  const outsidePath = (outside ?? []).map((piece) => path(piece.ring)).join("");
  // 图例只列画面上有的：没有运营区域时和改版前一样只有「区域」一行；没有超出的部分时不列「超出运营区域」（图例小一点，少挡地图）
  const hasOperating = areas.some(isOperating);
  const selectedOutsidePath = selected !== null ? (outside ?? []).filter((piece) => piece.areaIds.includes(selected)).map((piece) => path(piece.ring)).join("") : "";
  // 图层关掉、换了一批点：弹出的说明跟着收起
  const shownPopup = popup !== null && demands?.some((entry) => entry.key === popup.key) ? popup : null;

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
            {outsidePath !== "" && (
              <clipPath id={`${clipPrefix}-outside`}>
                <path d={outsidePath} />
              </clipPath>
            )}
          </defs>
          {areas.map((area) => (
            <g key={`f-${area.id}`} className={`area-color--${area.slot}${area.active ? "" : " area-overview--disabled"}${isOperating(area) ? " area-overview--operating" : ""}`}>
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
          {outsidePath !== "" && (
            <g data-outside="all">
              <path className="area-outside" d={outsidePath} />
              <path className="area-hatch area-hatch--outside" d={hatch} clipPath={`url(#${clipPrefix}-outside)`} />
            </g>
          )}
          {selectedOutsidePath !== "" && <path className="area-outside area-outside--selected" d={selectedOutsidePath} data-outside="selected" />}
          {selectedOverlapPath !== "" && <path className="area-overlap area-overlap--selected" d={selectedOverlapPath} data-overlap="selected" />}
          {ordered.map((area) => (
            <g key={`s-${area.id}`} className={`area-color--${area.slot}${area.active ? "" : " area-overview--disabled"}${isOperating(area) ? " area-overview--operating" : ""}`} data-area={area.id} data-role={area.role ?? "both"}>
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
            // 运营区域通常很大、里面套着报价区域：名字标在上边框里面，不和里面报价区域的名字叠在一起
            const y = isOperating(area) ? Math.min(...ys) + OPERATING_LABEL_OFFSET : (Math.max(...ys) + Math.min(...ys)) / 2;
            return (
              <text key={`l-${area.id}`} className={area.id === selected ? "area-label area-label--selected" : "area-label"} x={(Math.max(...xs) + Math.min(...xs)) / 2} y={y} textAnchor="middle">
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
          {/* 未覆盖需求的点画在位置标记上面：从列表过来时标记和点在同一个位置 */}
          {demands && (
            <g data-demand-layer="on">
              {demands.map((entry) => {
                const at = project([entry.point.lng, entry.point.lat]);
                const radius = demandDotRadius(entry.item.repeat_count);
                return entry.end === "pickup" ? (
                  <circle key={entry.key} className={shownPopup?.key === entry.key ? "demand-dot demand-dot--active" : "demand-dot"} cx={at.x} cy={at.y} r={radius} data-demand={entry.key} />
                ) : (
                  <rect key={entry.key} className={shownPopup?.key === entry.key ? "demand-dot demand-dot--active" : "demand-dot"} x={at.x - radius} y={at.y - radius} width={radius * 2} height={radius * 2} data-demand={entry.key} />
                );
              })}
            </g>
          )}
        </svg>
      )}
      {/* 说明框固定在地图左上角（不跟着点走：不用内联样式定位，窄屏也不伸出地图）；点了的那个点在图上换成主色 */}
      {shownPopup && (
        <section className="demand-popup" aria-label="未覆盖需求">
          <p className="demand-popup__title">
            <strong>未覆盖需求</strong>
            <button type="button" className="icon-button demand-popup__close" aria-label="关闭" onClick={() => setPopup(null)}>
              <Icon name="x" />
            </button>
          </p>
          <dl className="demand-popup__facts">
            <dt>用车类型</dt>
            <dd>{PRODUCT_CATEGORY_NAMES[shownPopup.item.category]}</dd>
            <dt>用车时间</dt>
            <dd>{`${serviceLocalText(shownPopup.item.service_local)}（当地）`}</dd>
            <dt>最近出现</dt>
            <dd>{formatLocalDateTime(shownPopup.item.last_seen_at)}</dd>
            <dt>这一点</dt>
            <dd>{shownPopup.end === "pickup" ? "上车点" : "下车点"}</dd>
            <dt>原因</dt>
            <dd>{DEMAND_REASON_NAMES[shownPopup.item.reason]}</dd>
            <dt>次数</dt>
            <dd>{`${shownPopup.item.repeat_count} 次`}</dd>
            <dt>坐标</dt>
            <dd>{pointText(shownPopup.point)}</dd>
          </dl>
        </section>
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
          {hasOperating && (
            <li>
              <svg className="legend-swatch area-overview--operating" viewBox="0 0 24 14" aria-hidden="true">
                <path className="area-overview-fill area-color--0" d="M2,2H22V12H2Z" />
                <path className="area-overview-stroke area-color--0" d="M2,2H22V12H2Z" />
              </svg>
              <span>
                <strong>运营区域</strong> 虚线：只决定能不能接单
              </span>
            </li>
          )}
          <li>
            <svg className="legend-swatch" viewBox="0 0 24 14" aria-hidden="true">
              <path className="area-overview-fill area-color--0" d="M2,2H22V12H2Z" />
              <path className="area-overview-stroke area-color--0" d="M2,2H22V12H2Z" />
            </svg>
            {hasOperating ? (
              <span>
                <strong>报价区域 / 运营 + 报价</strong> 实线：颜色同列表圆点
              </span>
            ) : (
              <span>
                <strong>区域</strong> 颜色和列表的圆点一致
              </span>
            )}
          </li>
          <li>
            <Swatch kind="forbid" />
            <span>
              <strong>禁行区</strong> 只管它所在的区域
            </span>
          </li>
          {showOverlaps && (
            <li>
              <svg className="legend-swatch" viewBox="0 0 24 14" aria-hidden="true">
                <path className="area-overlap" d="M2,2H22V12H2Z" />
              </svg>
              <span>
                <strong>重叠的地方</strong> 报价区域之间，取最低价
              </span>
            </li>
          )}
          {outsidePath !== "" && (
            <li>
              <svg className="legend-swatch" viewBox="0 0 24 14" aria-hidden="true">
                <path className="area-outside" d="M2,2H22V12H2Z" />
                <path className="area-hatch area-hatch--outside" d="M6,2L2,6M12,2L2,12M18,2L8,12M22,4L14,12M22,10L20,12" />
              </svg>
              <span>
                <strong>超出运营区域</strong> 报价区域的这部分不会报价
              </span>
            </li>
          )}
          {demands && (
            <li>
              <svg className="legend-swatch" viewBox="0 0 24 14" aria-hidden="true">
                <circle className="demand-dot" cx="6" cy="7" r="4" />
                <rect className="demand-dot" x="14" y="3" width="8" height="8" />
              </svg>
              <span>
                <strong>未覆盖需求</strong> 圆是上车点，方是下车点；越大次数越多
              </span>
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
