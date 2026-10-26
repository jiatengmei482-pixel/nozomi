/**
 * 官网的地图选点（M3-12，ADR 0044；规范 site-booking.md 3.6）。
 *
 * 底图和供应商区域页同一份配置、同一个瓦片层（ADR 0015、0017），不加载谷歌地图的任何东西；标记、准星是我们自己画的，颜色只用令牌。
 * 选点的三种做法，结果都一样（`onPick` 一个坐标）：
 * - 点地图上的一个位置；
 * - 拖动标记；
 * - 不用鼠标：地图可以聚焦，方向键平移、加号减号缩放，中间有准星，按「选地图中间这个位置」。
 * 坐标从外面变了（搜索选中、常用地点、手填）就把地图移过去。
 */
import L from "leaflet";
import { type PointerEvent as ReactPointerEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MapTiles } from "../../api/areas.ts";
import { Button } from "../../components/Button.tsx";
import { Icon } from "../../components/Icon.tsx";
import { QuietTileLayer } from "../../lib/quiet-tile-layer.ts";

export interface LatLngValue {
  lat: number;
  lng: number;
}

export interface SiteMapPickerProps {
  tiles: MapTiles;
  /** 还没有选点时地图看哪里（城市中心） */
  center: LatLngValue;
  /** 现在选中的位置；没有为 null */
  point: LatLngValue | null;
  /** 「上车」「下车」：说明和按钮的文字 */
  word: string;
  onPick(point: LatLngValue): void;
}

const CITY_ZOOM = 12;
const POINT_ZOOM = 16;

function isDark(): boolean {
  const chosen = document.documentElement.dataset["theme"];
  return chosen === "dark" || (chosen !== "light" && (window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false));
}

/** 地图给的坐标保留 6 位小数（约 0.1 米），和坐标栏里的写法一致。 */
export function roundPoint(point: LatLngValue): LatLngValue {
  return { lat: Number(point.lat.toFixed(6)), lng: Number(L.Util.wrapNum(point.lng, [-180, 180], true).toFixed(6)) };
}

export function SiteMapPicker({ tiles, center, point, word, onPick }: SiteMapPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const [, setView] = useState(0);
  const [tileTrouble, setTileTrouble] = useState(false);
  const [dragAt, setDragAt] = useState<{ x: number; y: number } | null>(null);
  const latest = useRef({ onPick });
  latest.current = { onPick };

  // 建地图：只建一次（底图配置在页面打开期间不变）
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const map = L.map(container, { zoomControl: false, attributionControl: false, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false, keyboard: true, minZoom: tiles.min_zoom, maxZoom: tiles.max_zoom });
    const dark = isDark();
    if (dark && tiles.dark_url_template === null) container.classList.add("area-map__canvas--dimmed");
    let loaded = 0;
    let failed = 0;
    new QuietTileLayer(dark && tiles.dark_url_template !== null ? tiles.dark_url_template : tiles.url_template, {
      tileSize: tiles.tile_size,
      zoomOffset: tiles.tile_size === 512 ? -1 : 0,
      minZoom: tiles.min_zoom,
      maxZoom: tiles.max_zoom,
      referrerPolicy: tiles.referrer_policy,
    })
      .on("tileload", () => {
        loaded += 1;
        setTileTrouble(false);
      })
      .on("tileerror", () => {
        failed += 1;
        if (loaded === 0 && failed >= 3) setTileTrouble(true);
      })
      .addTo(map);
    const start = point ?? center;
    map.setView([start.lat, start.lng], point === null ? CITY_ZOOM : POINT_ZOOM);
    map.on("move zoom resize", () => setView((value) => value + 1));
    map.on("click", (event: L.LeafletMouseEvent) => latest.current.onPick(roundPoint(event.latlng)));
    mapRef.current = map;
    setView((value) => value + 1);
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // 只在打开时用一次起始位置；之后的变化由下面的 effect 处理
  }, [tiles]);

  // 坐标从外面变了：不在视野里就移过去
  const pointKey = point === null ? "" : `${point.lat},${point.lng}`;
  useEffect(() => {
    const map = mapRef.current;
    if (map === null || point === null) return;
    if (!map.getBounds().contains([point.lat, point.lng])) map.setView([point.lat, point.lng], Math.max(map.getZoom(), POINT_ZOOM));
  }, [pointKey]);

  const map = mapRef.current;
  const markerAt = dragAt ?? (map !== null && point !== null ? map.latLngToContainerPoint([point.lat, point.lng]) : null);
  // 标记的位置交给地图库定位（和瓦片同一种做法），不写内联样式：内容安全策略不放行 style 属性（ADR 0011、0017）
  const markerRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (markerRef.current !== null && markerAt !== null) L.DomUtil.setPosition(markerRef.current, L.point(markerAt.x, markerAt.y));
  });

  const pixelOf = (event: ReactPointerEvent<HTMLElement>): { x: number; y: number } | null => {
    const container = containerRef.current;
    if (container === null) return null;
    const box = container.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };
  const finishDrag = (): void => {
    if (dragAt !== null && map !== null) onPick(roundPoint(map.containerPointToLatLng([dragAt.x, dragAt.y])));
    setDragAt(null);
  };

  return (
    <div className="site-map">
      <div className="site-map__frame">
        <div
          ref={containerRef}
          className="site-map__canvas"
          role="application"
          aria-label={`地图：点一下选${word}位置，或拖动标记；也可以用方向键移动地图、加号减号缩放，再按地图下面的「选地图中间这个位置」`}
        />
        <span className="site-map__crosshair" aria-hidden="true" />
        {markerAt !== null && (
          <span
            ref={markerRef}
            className={dragAt === null ? "site-map__marker" : "site-map__marker site-map__marker--dragging"}
            aria-hidden="true"
            data-testid="site-map-marker"
            onPointerDown={(event) => {
              event.stopPropagation();
              event.currentTarget.setPointerCapture?.(event.pointerId);
              setDragAt(pixelOf(event));
            }}
            onPointerMove={(event) => {
              if (dragAt !== null) setDragAt(pixelOf(event));
            }}
            onPointerUp={finishDrag}
            onPointerCancel={() => setDragAt(null)}
          >
            <svg viewBox="0 0 24 32" className="site-map__pin">
              <path className="site-map__pin-body" d="M12 1C6 1 1.5 5.5 1.5 11.3 1.5 19 12 31 12 31s10.5-12 10.5-19.7C22.5 5.5 18 1 12 1z" />
              <circle className="site-map__pin-dot" cx="12" cy="11.5" r="4" />
            </svg>
          </span>
        )}
        <div className="site-map__controls">
          <button type="button" className="icon-button site-map__control" aria-label="放大地图" onClick={() => mapRef.current?.zoomIn()}>
            <Icon name="plus" />
          </button>
          <button type="button" className="icon-button site-map__control" aria-label="缩小地图" onClick={() => mapRef.current?.zoomOut()}>
            <Icon name="minus" />
          </button>
        </div>
        {tileTrouble && <p className="site-map__trouble">地图没有加载出来。可以用上面的搜索、常用地点，或直接填写地址和坐标。</p>}
        <p className="site-map__attribution">
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
      <Button
        size="lg"
        onClick={() => {
          const current = mapRef.current;
          if (current !== null) onPick(roundPoint(current.getCenter()));
        }}
      >
        <Icon name="target" />
        选地图中间这个位置
      </Button>
    </div>
  );
}
