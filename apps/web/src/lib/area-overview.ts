/**
 * 区域地图（M8-18，tenant-areas.md 第 19 节、ADR 0074）的纯函数：给区域配颜色、一句话说明形状、重叠的说法、筛选、导出和导入 GeoJSON。
 * 不依赖地图库和浏览器，用 node:test 直接测。重叠怎么算在 @nozomi/domain 的 `findAreaOverlaps`。
 */
import { type AreaOverlapResult, type OverlapAreaInput, type Position, findAreaOverlaps } from "@nozomi/domain";
import type { AreaMapItem } from "../api/area-map.ts";
import { displayName } from "./master-display.ts";
import { metersToKmText } from "./area-editor.ts";

/** 区域的颜色有几种（样式文件里 `area-color--0` 到 `area-color--4`，每种对应一个现有的设计令牌），按列表顺序轮流用。 */
export const AREA_COLOR_SLOTS = 5;

export function colorSlot(index: number): number {
  return ((index % AREA_COLOR_SLOTS) + AREA_COLOR_SLOTS) % AREA_COLOR_SLOTS;
}

/** 一个区域的形状一句话（界面统一叫「点」不叫「顶点」，tenant-areas.md 第 14 节）。 */
export function shapeSummary(area: Pick<AreaMapItem, "polygons">): string {
  const operate = area.polygons.filter((polygon) => polygon.kind === "operate");
  const forbid = area.polygons.filter((polygon) => polygon.kind === "forbid");
  const points = area.polygons.reduce((sum, polygon) => sum + Math.max(0, (polygon.geometry.coordinates[0]?.length ?? 1) - 1), 0);
  const only = operate.length === 1 && forbid.length === 0 ? operate[0] : undefined;
  if (only?.circle) return `圆 · 半径 ${metersToKmText(only.circle.radius_m)} 公里`;
  if (only) return `多边形 · ${points} 个点`;
  return `营运区 ${operate.length} 块 · 禁行区 ${forbid.length} 块 · 共 ${points} 个点`;
}

/** 「与 X、Y 重叠」：最多列 3 个名字，其余写「等 N 个区域」。 */
export function overlapText(names: readonly string[]): string {
  if (names.length === 0) return "";
  const shown = names.slice(0, 3).map((name) => `「${name}」`).join("、");
  return names.length > 3 ? `与${shown}等 ${names.length} 个区域重叠` : `与${shown}重叠`;
}

/** 重叠的面积：不到 1 平方公里写平方米。 */
export function overlapAreaText(m2: number): string {
  if (m2 < 1_000_000) return `约 ${Math.round(m2).toLocaleString("zh-CN")} 平方米`;
  const km2 = m2 / 1_000_000;
  return `约 ${km2 >= 10 ? Math.round(km2).toLocaleString("zh-CN") : km2.toFixed(1)} 平方公里`;
}

export function areaRing(geometry: { coordinates: [number, number][][] }): Position[] {
  const closed = geometry.coordinates[0] ?? [];
  return closed.slice(0, -1).map(([lng, lat]) => [lng, lat]);
}

/** 交给 domain 算重叠的样子。 */
export function overlapInputs(items: readonly AreaMapItem[]): OverlapAreaInput[] {
  return items.map((item) => ({ id: item.id, bizType: item.biz_type, role: item.role ?? "both", active: item.status === "active", polygons: item.polygons.map((polygon) => ({ kind: polygon.kind, ring: areaRing(polygon.geometry) })) }));
}

/**
 * 重叠只在「同一个供应商」的区域之间算：运营后台一次看到几家的区域时，按供应商分开算再合起来。
 * 只在报价区域（报价、运营 + 报价）之间算（ADR 0075 第五部分）：运营区域之间、运营区域和报价区域之间都不算重叠。
 */
export function computeOverlaps<T extends AreaMapItem>(items: readonly T[], ownerOf: (item: T) => string = () => ""): AreaOverlapResult {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(ownerOf(item), [...(groups.get(ownerOf(item)) ?? []), item]);
  const merged: AreaOverlapResult = { pairs: [], pieces: [], byArea: new Map() };
  for (const group of groups.values()) {
    const found = findAreaOverlaps(overlapInputs(group));
    merged.pairs.push(...found.pairs);
    merged.pieces.push(...found.pieces);
    for (const [id, others] of found.byArea) merged.byArea.set(id, others);
  }
  return merged;
}

/** 区域地图按用途筛（ADR 0075 第五部分）：「运营」= 能决定接单的（运营、运营 + 报价），「报价」= 能挂价格的（报价、运营 + 报价）。 */
export type OverviewRoleFilter = "all" | "operating" | "pricing";

export interface OverviewFilter {
  q: string;
  overlapOnly: boolean;
  role?: OverviewRoleFilter;
}

function roleMatches(role: AreaMapItem["role"], filter: OverviewRoleFilter): boolean {
  const value = role ?? "both";
  if (filter === "operating") return value !== "pricing";
  if (filter === "pricing") return value !== "operating";
  return true;
}

/** 列表的筛选：名称（任意一种语言，不分大小写）、用途、只看有重叠的。 */
export function filterAreas<T extends AreaMapItem>(items: readonly T[], filter: OverviewFilter, overlaps: AreaOverlapResult): T[] {
  const q = filter.q.trim().toLowerCase();
  return items.filter((item) => (q === "" || Object.values(item.name).some((text) => (text ?? "").toLowerCase().includes(q))) && roleMatches(item.role, filter.role ?? "all") && (!filter.overlapOnly || overlaps.byArea.has(item.id)));
}

/** 最近修改人的说法。 */
export function editorText(editor: AreaMapItem["last_editor"]): string | null {
  if (editor === null) return null;
  if (editor.type === "system") return "系统";
  return editor.name ?? "已删除的账号";
}

/**
 * 导出成 GeoJSON（FeatureCollection，一块图形一个要素）。properties 里有区域的编号、名称、城市、业务类型、用途（M8-20）、状态，
 * 和图形的类型（`kind`）、名字、备注名（`label`）——和编辑器「复制坐标」的写法一致，导入时类型和备注名能带回来。
 */
export function areasToGeoJson(items: readonly AreaMapItem[]): string {
  const features = items.flatMap((item) =>
    item.polygons.map((polygon) => ({
      type: "Feature",
      properties: {
        area_id: item.id,
        area_name: displayName(item.name).text,
        city_code: item.city?.code ?? null,
        biz_type: item.biz_type,
        role: item.role ?? "both",
        status: item.status,
        kind: polygon.kind,
        name: `${polygon.kind === "operate" ? "营运" : "禁行"} ${polygon.seq}`,
        label: polygon.label ?? "",
      },
      geometry: polygon.geometry,
    })),
  );
  return `${JSON.stringify({ type: "FeatureCollection", features }, null, 1)}\n`;
}

/** 导出的文件名：区域地图-2026-11-09.geojson（本地日期）。 */
export function exportFileName(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `区域地图-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.geojson`;
}

/** 导入的文件最大多少字节（和粘贴坐标的「从文件读取」一致：2 MB）。 */
export const IMPORT_MAX_BYTES = 2 * 1024 * 1024;

export type ImportCheck = { ok: true; text: string } | { ok: false; message: string };

/**
 * 拖进来、选进来的文件：只看能不能读、是不是一个区域。图形本身的识别、出错文字交给编辑器的「粘贴坐标」（同一套规则和说法）。
 * 一个文件里有几个区域（我们自己导出的带 `area_id`）：一次只能导入一个区域，要先拆开。
 */
export function checkImportText(name: string, size: number, text: string | null): ImportCheck {
  if (!/\.(geo)?json$/i.test(name)) return { ok: false, message: "只能导入 .geojson 或 .json 文件。" };
  if (size > IMPORT_MAX_BYTES) return { ok: false, message: "文件超过 2 MB，读不了。" };
  if (text === null || text.trim() === "") return { ok: false, message: "这个文件读不出文字内容。" };
  const areas = areasInGeoJson(text);
  if (areas > 1) return { ok: false, message: `这个文件里有 ${areas} 个区域。一次只能导入一个区域：请在区域地图里只导出一个区域，或把文件拆开。` };
  return { ok: true, text };
}

/** 一段 GeoJSON 里有几个不同的区域（看要素的 `properties.area_id`，我们自己导出的才有）。不是 JSON、没有这一项的算 0。 */
export function areasInGeoJson(text: string): number {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return 0;
  }
  const features = typeof root === "object" && root !== null && Array.isArray((root as { features?: unknown }).features) ? ((root as { features: unknown[] }).features) : [];
  const ids = new Set<string>();
  for (const feature of features) {
    const id = typeof feature === "object" && feature !== null ? (feature as { properties?: { area_id?: unknown } }).properties?.area_id : undefined;
    if (typeof id === "string") ids.add(id);
  }
  return ids.size;
}

/** 导入的文件里写明的用途（我们自己导出的带 `properties.role`）：全部要素一致时才认，否则为 null（让用户在新增页自己选）。 */
export function roleInGeoJson(text: string): AreaMapItem["role"] | null {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return null;
  }
  const features = typeof root === "object" && root !== null && Array.isArray((root as { features?: unknown }).features) ? ((root as { features: unknown[] }).features) : [];
  const roles = new Set(features.map((feature) => (typeof feature === "object" && feature !== null ? (feature as { properties?: { role?: unknown } }).properties?.role : undefined)));
  const [only] = [...roles];
  return roles.size === 1 && (only === "operating" || only === "pricing" || only === "both") ? only : null;
}

const PAIR = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*[,，\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

/** 「35.6895, 139.6917」这样一对数字（纬度在前）；不是一对合法的坐标时为 null。 */
export function parseLatLngText(text: string): { lat: number; lng: number } | null {
  const match = PAIR.exec(text);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}
