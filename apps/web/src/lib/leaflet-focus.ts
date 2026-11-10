/**
 * 点地图时不让页面跳（M8-18 验收发现的缺陷）。
 *
 * Leaflet 1.9.4 的键盘操作（Map.Keyboard）在按下鼠标时给地图容器 `focus()`，好让方向键、加减号能操作地图；
 * 它只把 `window` 的滚动位置还原回去，不管别的滚动容器。我们的后台内容区（`.shell__main`）自己滚动，
 * 地图没有完全在视野里时，浏览器为了让获得焦点的容器露出来会把内容区滚一段——第一次点地图时画面上移，
 * 点中的就成了下面那一块。这里改成 `focus({ preventScroll: true })`：焦点照样落到地图上（键盘操作不变），只是不滚。
 *
 * 升级 Leaflet 时对照 src/map/handler/Map.Keyboard.js 的 `_onMouseDown`。导入本模块即生效（只改一次原型）。
 */
import L from "leaflet";

interface KeyboardInternals {
  _focused: boolean;
  _map: L.Map;
  _onMouseDown(this: KeyboardInternals): void;
}

const keyboard = (L.Map as unknown as { Keyboard: { prototype: KeyboardInternals } }).Keyboard.prototype;

keyboard._onMouseDown = function onMouseDown(this: KeyboardInternals): void {
  if (this._focused) return;
  this._map.getContainer().focus({ preventScroll: true });
};
