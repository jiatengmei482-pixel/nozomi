/**
 * 地图「底」的接口（M8-18，ADR 0074）：区域地图的图形层、重叠、选中、点选只通过它和底图打交道——
 * 把坐标换算成画布上的像素、把点击换算成坐标、移动视野、底图出没出问题。
 *
 * 现在只有一种实现：Leaflet + 配置的栅格瓦片（`createLeafletSurface`，ADR 0011、0015、0017）。
 * 以后换底图（例如负责人决定用谷歌地图 JavaScript API，ADR 0074「以后换底图」）只要再写一个实现，图形层和页面不用改。
 */
import L from "leaflet";
import type { MapTiles } from "../api/areas.ts";
import { QuietTileLayer } from "./quiet-tile-layer.ts";
import "./leaflet-focus.ts";

export interface Pixel {
  x: number;
  y: number;
}

export interface LatLngPoint {
  lat: number;
  lng: number;
}

/** [[南, 西], [北, 东]] */
export type LatLngBox = [[number, number], [number, number]];

export interface MapSurface {
  /** 坐标 → 画布上的像素（相对地图容器左上角） */
  project(point: LatLngPoint): Pixel;
  /** 画布现在的大小 */
  size(): Pixel;
  fit(box: LatLngBox, maxZoom: number): void;
  setView(center: LatLngPoint, zoom: number): void;
  zoomIn(): void;
  zoomOut(): void;
  destroy(): void;
}

export interface SurfaceEvents {
  /** 视野变了（平移、缩放、容器大小）：图形层重画 */
  onView(): void;
  onClick(point: LatLngPoint): void;
  /** 底图是不是一张都加载不出来 */
  onTileTrouble(trouble: boolean): void;
}

export function prefersDark(): boolean {
  const chosen = document.documentElement.dataset["theme"];
  return chosen === "dark" || (chosen !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
}

/**
 * Leaflet 的实现：自带的控件、署名都关掉（用设计规范的按钮和署名），瓦片按配置的来源页策略单独设（ADR 0015）。
 * 暗色而底图没有暗色样式时，给容器加 `area-map__canvas--dimmed`（只压暗底图那一层）。
 */
export function createLeafletSurface(container: HTMLElement, tiles: MapTiles, events: SurfaceEvents): MapSurface {
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const map = L.map(container, { dragging: !coarse, zoomControl: false, attributionControl: false, zoomAnimation: false, fadeAnimation: false, minZoom: tiles.min_zoom, maxZoom: tiles.max_zoom });
  const dark = prefersDark();
  const url = dark && tiles.dark_url_template !== null ? tiles.dark_url_template : tiles.url_template;
  if (dark && tiles.dark_url_template === null) container.classList.add("area-map__canvas--dimmed");
  let loaded = 0;
  let failed = 0;
  new QuietTileLayer(url, { tileSize: tiles.tile_size, zoomOffset: tiles.tile_size === 512 ? -1 : 0, minZoom: tiles.min_zoom, maxZoom: tiles.max_zoom, referrerPolicy: tiles.referrer_policy })
    .on("tileload", () => {
      loaded += 1;
      events.onTileTrouble(false);
    })
    .on("tileerror", () => {
      failed += 1;
      if (loaded === 0 && failed >= 3) events.onTileTrouble(true);
    })
    .addTo(map);
  map.setView([0, 0], tiles.min_zoom);
  map.on("move zoom resize", () => events.onView());
  map.on("click", (event: L.LeafletMouseEvent) => events.onClick({ lat: event.latlng.lat, lng: event.latlng.lng }));
  return {
    project(point) {
      const at = map.latLngToContainerPoint([point.lat, point.lng]);
      return { x: at.x, y: at.y };
    },
    size() {
      const at = map.getSize();
      return { x: at.x, y: at.y };
    },
    fit(box, maxZoom) {
      map.fitBounds(box, { padding: [24, 24], maxZoom });
    },
    setView(center, zoom) {
      map.setView([center.lat, center.lng], zoom);
    },
    zoomIn() {
      map.zoomIn();
    },
    zoomOut() {
      map.zoomOut();
    },
    destroy() {
      map.remove();
    },
  };
}
