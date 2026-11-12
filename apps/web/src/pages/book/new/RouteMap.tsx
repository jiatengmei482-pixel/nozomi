/**
 * 右侧栏的路线图（M8-04，ADR 0069「B1 + B11 → A」：后端给路线折线，画在现有底图上，浏览器不放谷歌密钥、不加载谷歌脚本）。
 * M8-10 起这是后备：平台还没开通谷歌静态地图（`route-map` 应答 NOT_ENABLED）时才用它，见 StaticRouteMap.tsx。
 * 底图和地图选点同一份配置、同一个瓦片层；只是看的图：不能拖、不能缩放、不能聚焦（键盘用户读到的是旁边的「约 X 分钟 · Y 公里」和图的文字说明）。
 * 路线、起终点的颜色用令牌（样式在 book-new.css，Leaflet 的 className）。
 */
import L from "leaflet";
import { useEffect, useRef } from "react";
import type { MapTiles } from "../../../api/areas.ts";
import { applyMapTheme, dimTilesFor, tileUrlFor } from "../../../lib/map-theme.ts";
import { QuietTileLayer } from "../../../lib/quiet-tile-layer.ts";
import { currentColorScheme, useColorScheme } from "../../../theme/use-color-scheme.ts";

export function RouteMap({ tiles, points, label }: { tiles: MapTiles; points: readonly { lat: number; lng: number }[]; label: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<L.TileLayer | null>(null);
  const scheme = useColorScheme();
  const key = points.map((point) => `${point.lat},${point.lng}`).join(";");
  useEffect(() => {
    const container = containerRef.current;
    if (container === null || points.length < 2) return;
    const map = L.map(container, {
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      touchZoom: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      zoomAnimation: false,
      fadeAnimation: false,
      markerZoomAnimation: false,
      minZoom: tiles.min_zoom,
      maxZoom: tiles.max_zoom,
    });
    const opened = currentColorScheme();
    if (dimTilesFor(tiles, opened)) container.classList.add("area-map__canvas--dimmed");
    layerRef.current = new QuietTileLayer(tileUrlFor(tiles, opened), {
      tileSize: tiles.tile_size,
      zoomOffset: tiles.tile_size === 512 ? -1 : 0,
      minZoom: tiles.min_zoom,
      maxZoom: tiles.max_zoom,
      referrerPolicy: tiles.referrer_policy,
    }).addTo(map);
    const line = points.map((point): [number, number] => [point.lat, point.lng]);
    L.polyline(line, { className: "route-map__line", interactive: false }).addTo(map);
    const first = line[0] as [number, number];
    const last = line[line.length - 1] as [number, number];
    L.circleMarker(first, { className: "route-map__start", radius: 6, interactive: false }).addTo(map);
    L.circleMarker(last, { className: "route-map__end", radius: 6, interactive: false }).addTo(map);
    map.fitBounds(L.latLngBounds(line), { padding: [16, 16] });
    container.removeAttribute("tabindex");
    return () => {
      map.remove();
      layerRef.current = null;
    };
  }, [tiles, key]);

  // 切换亮暗主题：换瓦片或压暗底图，路线不动（M6-08）
  useEffect(() => {
    const container = containerRef.current;
    if (container !== null && layerRef.current !== null) applyMapTheme(container, layerRef.current, tiles, scheme);
  }, [scheme, tiles, key]);
  return (
    <div className="route-map">
      <div ref={containerRef} className="route-map__canvas" role="img" aria-label={label} />
      <p className="route-map__attribution">
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
  );
}
