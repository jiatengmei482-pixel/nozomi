/**
 * 地图底图跟着亮暗主题走（M6-08）：取哪套瓦片、要不要压暗；已经打开的地图（新预订页路线图、旧预订页地图选点、区域编辑页、区域地图）
 * 切换主题（`<html data-theme>`）时当场换瓦片地址或压暗标记，不重建地图、路线和标记不动。
 * 压暗只作用在瓦片那一层（样式里的 `.leaflet-tile-pane`）由端到端测试在真实浏览器里核对。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, render, waitFor } from "@testing-library/react";
import type { MapTiles } from "../api/areas.ts";
import { AreaOverviewMap } from "../pages/areas/AreaOverviewMap.tsx";
import { RouteMap } from "../pages/book/new/RouteMap.tsx";
import { SiteMapPicker } from "../pages/book/SiteMapPicker.tsx";
import { resetBrowser } from "../testing/harness.tsx";
import type { ColorScheme } from "../theme/use-color-scheme.ts";
import type { MapSurface } from "./map-surface.ts";
import { DIMMED_CLASS, applyMapTheme, dimTilesFor, tileUrlFor } from "./map-theme.ts";

afterEach(resetBrowser);

const LIGHT = "https://tiles.example.com/light/{z}/{x}/{y}.png";
const DARK = "https://tiles.example.com/dark/{z}/{x}/{y}.png";
const tilesOf = (dark: string | null): MapTiles => ({ url_template: LIGHT, dark_url_template: dark, min_zoom: 3, max_zoom: 18, tile_size: 256, referrer_policy: "strict-origin-when-cross-origin", attribution: [{ text: "© 测试底图", href: null }] });

const setTheme = async (theme: "light" | "dark"): Promise<void> => {
  await act(async () => {
    document.documentElement.dataset["theme"] = theme;
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};
const tileSources = (container: HTMLElement): string[] => [...container.querySelectorAll<HTMLImageElement>(".leaflet-tile-pane img")].map((image) => image.getAttribute("src") ?? "").filter((src) => src !== "");

test("取哪套瓦片、要不要压暗：暗色有暗色瓦片就换，没有才压暗；亮色都不动", () => {
  assert.equal(tileUrlFor(tilesOf(DARK), "dark"), DARK);
  assert.equal(tileUrlFor(tilesOf(null), "dark"), LIGHT);
  assert.equal(tileUrlFor(tilesOf(DARK), "light"), LIGHT);
  assert.equal(dimTilesFor(tilesOf(null), "dark"), true);
  assert.equal(dimTilesFor(tilesOf(DARK), "dark"), false);
  assert.equal(dimTilesFor(tilesOf(null), "light"), false);
});

test("applyMapTheme：切到暗色加压暗标记、切回去去掉；瓦片地址按主题交给图层（地址相同时 Leaflet 自己不重绘）", () => {
  const container = document.createElement("div");
  const calls: string[] = [];
  const layer = { setUrl(url: string) { calls.push(url); return this as never; } };
  applyMapTheme(container, layer, tilesOf(null), "dark");
  assert.ok(container.classList.contains(DIMMED_CLASS));
  assert.deepEqual(calls, [LIGHT], "没有暗色瓦片：仍用亮色地址");
  applyMapTheme(container, layer, tilesOf(null), "light");
  assert.ok(!container.classList.contains(DIMMED_CLASS));
  applyMapTheme(container, layer, tilesOf(DARK), "dark");
  assert.deepEqual(calls, [LIGHT, LIGHT, DARK]);
  assert.ok(!container.classList.contains(DIMMED_CLASS), "有暗色瓦片就不压暗");
});

test("新预订页路线图（Leaflet 后备）：打开后切换主题，压暗标记跟着变；路线还在、地图不重建", async () => {
  await setTheme("light");
  const { container } = render(<RouteMap tiles={tilesOf(null)} points={[{ lat: 35.68, lng: 139.76 }, { lat: 35.69, lng: 139.7 }]} label="路线图：东京站 → 新宿站" />);
  const canvas = container.querySelector(".route-map__canvas") as HTMLElement;
  await waitFor(() => assert.ok(canvas.classList.contains("leaflet-container")));
  assert.ok(!canvas.classList.contains(DIMMED_CLASS));
  const line = canvas.querySelector(".route-map__line");
  assert.ok(line, "路线");
  await setTheme("dark");
  await waitFor(() => assert.ok(canvas.classList.contains(DIMMED_CLASS)));
  assert.equal(canvas.querySelector(".route-map__line"), line, "路线是同一条，没有重画");
  await setTheme("light");
  await waitFor(() => assert.ok(!canvas.classList.contains(DIMMED_CLASS)));
});

test("新预订页路线图：底图有暗色样式时，切到暗色换暗色瓦片、不压暗；切回亮色换回来", async () => {
  await setTheme("light");
  const { container } = render(<RouteMap tiles={tilesOf(DARK)} points={[{ lat: 35.68, lng: 139.76 }, { lat: 35.69, lng: 139.7 }]} label="路线图：东京站 → 新宿站" />);
  const canvas = container.querySelector(".route-map__canvas") as HTMLElement;
  await waitFor(() => assert.ok(tileSources(canvas).length > 0));
  assert.ok(tileSources(canvas).every((src) => src.startsWith("https://tiles.example.com/light/")));
  await setTheme("dark");
  await waitFor(() => assert.ok(tileSources(canvas).length > 0 && tileSources(canvas).every((src) => src.startsWith("https://tiles.example.com/dark/"))));
  assert.ok(!canvas.classList.contains(DIMMED_CLASS));
  await setTheme("light");
  await waitFor(() => assert.ok(tileSources(canvas).length > 0 && tileSources(canvas).every((src) => src.startsWith("https://tiles.example.com/light/"))));
});

test("旧预订页地图选点：打开后切换主题，压暗标记跟着变", async () => {
  await setTheme("dark");
  const { container } = render(<SiteMapPicker tiles={tilesOf(null)} center={{ lat: 35.68, lng: 139.76 }} point={null} word="上车" onPick={() => {}} />);
  const canvas = container.querySelector(".leaflet-container") as HTMLElement;
  await waitFor(() => assert.ok(canvas.classList.contains(DIMMED_CLASS)));
  await setTheme("light");
  await waitFor(() => assert.ok(!canvas.classList.contains(DIMMED_CLASS)));
});

test("区域地图：切换主题时把新主题交给底图（换瓦片或压暗），不重建底图", async () => {
  await setTheme("light");
  const schemes: ColorScheme[] = [];
  let created = 0;
  const factory = (): MapSurface => {
    created += 1;
    return { project: (point) => ({ x: point.lng, y: point.lat }), size: () => ({ x: 800, y: 600 }), fit() {}, setView() {}, zoomIn() {}, zoomOut() {}, setColorScheme: (scheme) => void schemes.push(scheme), destroy() {} };
  };
  render(<AreaOverviewMap tiles={tilesOf(null)} areas={[]} selected={null} onSelect={() => {}} overlaps={[]} showOverlaps focusSignal={0} marker={null} outside={[]} surfaceFactory={factory} />);
  await waitFor(() => assert.equal(schemes.at(-1), "light"));
  await setTheme("dark");
  await waitFor(() => assert.equal(schemes.at(-1), "dark"));
  await setTheme("light");
  await waitFor(() => assert.equal(schemes.at(-1), "light"));
  assert.equal(created, 1, "底图只建一次");
});
