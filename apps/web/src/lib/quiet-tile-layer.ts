/**
 * 瓦片层：和 Leaflet 自带的一样，只改一件事——丢掉一张还没加载完的瓦片时怎么取消它的请求。
 *
 * Leaflet 的做法是把那张图的地址换成一张内嵌的空白图（data:image/gif;base64,…）。全站的内容安全策略只放行同源和配置的瓦片来源，
 * 不放行 data:，于是每移动、缩放一次地图，控制台就多几条策略报错（测试发现的缺陷）。
 * 这里改成直接去掉图片的地址：同样会取消还没完成的请求，不产生新的加载，策略不用开口子（ADR 0017）。
 */
import L from "leaflet";

interface TileEntry {
  el: HTMLImageElement;
  coords: L.Coords;
}

/** 用到的几个 Leaflet 内部成员（1.9.4；升级 Leaflet 时对照 TileLayer.js 的 _abortLoading / _removeTile / _tileReady）。 */
interface TileLayerInternals {
  _tiles: Record<string, TileEntry>;
  _tileZoom: number | undefined;
  _map: L.Map | null;
  fire(type: string, data?: object): unknown;
}

interface GridLayerInternals {
  _removeTile(this: unknown, key: string): void;
  _tileReady(this: unknown, coords: L.Coords, err: Error | null, tile: HTMLElement | undefined): void;
}

const gridLayer = L.GridLayer.prototype as unknown as GridLayerInternals;
const nothing = (): boolean => false;
const ABORTED = "tileAborted";

function dropSource(tile: HTMLImageElement): void {
  tile.dataset[ABORTED] = "1";
  tile.removeAttribute("src");
}

export const QuietTileLayer: new (urlTemplate: string, options?: L.TileLayerOptions) => L.TileLayer = L.TileLayer.extend({
  _abortLoading(this: TileLayerInternals): void {
    for (const key of Object.keys(this._tiles)) {
      const entry = this._tiles[key];
      if (!entry || entry.coords.z === this._tileZoom) continue;
      const tile = entry.el;
      tile.onload = nothing;
      tile.onerror = nothing;
      if (tile.complete) continue;
      dropSource(tile);
      tile.remove();
      delete this._tiles[key];
      this.fire("tileabort", { tile, coords: entry.coords });
    }
  },
  _removeTile(this: TileLayerInternals, key: string): void {
    const entry = this._tiles[key];
    if (!entry) return;
    // 取消这张瓦片还没完成的请求
    dropSource(entry.el);
    gridLayer._removeTile.call(this, key);
  },
  _tileReady(this: TileLayerInternals, coords: L.Coords, err: Error | null, tile: HTMLImageElement | undefined): void {
    if (!this._map || tile?.dataset[ABORTED] === "1") return;
    gridLayer._tileReady.call(this, coords, err, tile);
  },
});
