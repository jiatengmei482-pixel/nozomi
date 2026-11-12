/**
 * 地图底图跟着亮暗主题走（M6-08）：新预订页路线图（Leaflet 后备）、区域编辑页、区域地图、旧预订页的地图选点共用。
 * - 暗色而底图有暗色样式（`dark_url_template`）时换暗色瓦片；没有时给容器加 `area-map__canvas--dimmed`，
 *   样式只压暗瓦片那一层（`.leaflet-tile-pane`），路线、起终点、图形、标记的颜色不变。
 * - 切换主题（改 `<html data-theme>`）或系统改了深浅色时，已经打开的地图当场更新，不用刷新页面。
 */
import type L from "leaflet";
import type { MapTiles } from "../api/areas.ts";
import type { ColorScheme } from "../theme/use-color-scheme.ts";

export const DIMMED_CLASS = "area-map__canvas--dimmed";

/** 这个主题下用哪一套瓦片地址。 */
export function tileUrlFor(tiles: Pick<MapTiles, "url_template" | "dark_url_template">, scheme: ColorScheme): string {
  return scheme === "dark" && tiles.dark_url_template !== null ? tiles.dark_url_template : tiles.url_template;
}

/** 这个主题下要不要压暗底图：暗色、底图又没有暗色样式时才要。 */
export function dimTilesFor(tiles: Pick<MapTiles, "dark_url_template">, scheme: ColorScheme): boolean {
  return scheme === "dark" && tiles.dark_url_template === null;
}

/** 把已经建好的地图换到这个主题：容器的压暗标记、瓦片地址（变了才换，换了会重新取瓦片）。 */
export function applyMapTheme(container: HTMLElement, layer: Pick<L.TileLayer, "setUrl"> & { _url?: string }, tiles: Pick<MapTiles, "url_template" | "dark_url_template">, scheme: ColorScheme): void {
  container.classList.toggle(DIMMED_CLASS, dimTilesFor(tiles, scheme));
  const url = tileUrlFor(tiles, scheme);
  if (layer._url !== url) layer.setUrl(url);
}
