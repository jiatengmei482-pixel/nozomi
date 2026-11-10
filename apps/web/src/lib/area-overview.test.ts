import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parsePastedShapes } from "./area-editor.ts";
import type { AreaMapItem } from "../api/area-map.ts";
import { AREA_COLOR_SLOTS, areasInGeoJson, areasToGeoJson, checkImportText, colorSlot, computeOverlaps, editorText, exportFileName, filterAreas, overlapAreaText, overlapText, parseLatLngText, shapeSummary } from "./area-overview.ts";

const stamps = { created_at: "2026-11-01T00:00:00.000Z", updated_at: "2026-11-02T00:00:00.000Z" };
const city = { id: "c1", code: "CTY-JP-TYO", name: { zh: "东京" }, status: "active" as const, center: { lng: 139.7, lat: 35.7 }, boundary: null };

function square(lng: number, lat: number, size: number): { type: "Polygon"; coordinates: [number, number][][] } {
  return { type: "Polygon", coordinates: [[[lng, lat], [lng + size, lat], [lng + size, lat + size], [lng, lat + size], [lng, lat]]] };
}

function item(id: string, name: string, polygons: AreaMapItem["polygons"], extra: Partial<AreaMapItem> = {}): AreaMapItem {
  return {
    id,
    name: { zh: name },
    city_id: "c1",
    city,
    biz_type: "general",
    status: "active",
    operate_polygon_count: polygons.filter((polygon) => polygon.kind === "operate").length,
    forbid_polygon_count: polygons.filter((polygon) => polygon.kind === "forbid").length,
    usage: { product_count: 0, published_product_count: 0 },
    version: 1,
    ...stamps,
    polygons,
    last_editor: null,
    ...extra,
  };
}

const operate = (id: string, lng: number, lat: number, size: number): AreaMapItem["polygons"][number] => ({ id, kind: "operate", seq: 1, label: null, source: "drawn", circle: null, geometry: square(lng, lat, size) });

describe("区域地图的纯函数", () => {
  it("颜色按列表顺序轮流用", () => {
    assert.deepEqual([0, 1, AREA_COLOR_SLOTS, AREA_COLOR_SLOTS + 1, -1].map(colorSlot), [0, 1, 0, 1, AREA_COLOR_SLOTS - 1]);
  });

  it("形状的一句话：一块多边形、一个圆、几块合起来；叫「点」不叫「顶点」", () => {
    assert.equal(shapeSummary(item("a", "甲", [operate("p", 0, 0, 1)])), "多边形 · 4 个点");
    const circle = { id: "c", kind: "operate" as const, seq: 1, label: null, source: "circle" as const, circle: { center: { lat: 0, lng: 0 }, radius_m: 3200 }, geometry: square(0, 0, 1) };
    assert.equal(shapeSummary(item("a", "甲", [circle])), "圆 · 半径 3.2 公里");
    const forbid = { ...operate("f", 0.2, 0.2, 0.1), kind: "forbid" as const };
    assert.equal(shapeSummary(item("a", "甲", [operate("p", 0, 0, 1), forbid])), "营运区 1 块 · 禁行区 1 块 · 共 8 个点");
    assert.ok(!shapeSummary(item("a", "甲", [operate("p", 0, 0, 1)])).includes("顶点"));
  });

  it("重叠的说法：最多列三个名字；面积按大小换单位", () => {
    assert.equal(overlapText([]), "");
    assert.equal(overlapText(["甲", "乙"]), "与「甲」、「乙」重叠");
    assert.equal(overlapText(["甲", "乙", "丙", "丁"]), "与「甲」、「乙」、「丙」等 4 个区域重叠");
    assert.equal(overlapAreaText(5_000), "约 5,000 平方米");
    assert.equal(overlapAreaText(2_340_000), "约 2.3 平方公里");
    assert.equal(overlapAreaText(23_400_000), "约 23 平方公里");
  });

  it("算重叠：同一个供应商的区域之间才算（运营后台按供应商分开）", () => {
    const a = item("a", "甲", [operate("pa", 0, 0, 0.02)]);
    const b = item("b", "乙", [operate("pb", 0.01, 0.01, 0.02)]);
    assert.deepEqual(computeOverlaps([a, b]).byArea.get("a"), ["b"]);
    const owners = new Map([["a", "t1"], ["b", "t2"]]);
    assert.equal(computeOverlaps([a, b], (entry) => owners.get(entry.id) ?? "").pairs.length, 0);
  });

  it("筛选：名称（任意一种语言、不分大小写）、只看有重叠的", () => {
    const a = item("a", "Tokyo 23", [operate("pa", 0, 0, 0.02)], { name: { zh: "东京 23 区", en: "Tokyo 23" } });
    const b = item("b", "乙", [operate("pb", 0.01, 0.01, 0.02)]);
    const c = item("c", "丙", [operate("pc", 5, 5, 0.02)]);
    const overlaps = computeOverlaps([a, b, c]);
    assert.deepEqual(filterAreas([a, b, c], { q: "tokyo", overlapOnly: false }, overlaps).map((entry) => entry.id), ["a"]);
    assert.deepEqual(filterAreas([a, b, c], { q: "", overlapOnly: true }, overlaps).map((entry) => entry.id), ["a", "b"]);
    assert.deepEqual(filterAreas([a, b, c], { q: "  ", overlapOnly: false }, overlaps).map((entry) => entry.id), ["a", "b", "c"]);
  });

  it("最近修改人：账号的名字、系统、账号不在了", () => {
    assert.equal(editorText(null), null);
    assert.equal(editorText({ type: "tenant_user", name: "张三", at: stamps.updated_at }), "张三");
    assert.equal(editorText({ type: "system", name: null, at: stamps.updated_at }), "系统");
    assert.equal(editorText({ type: "tenant_user", name: null, at: stamps.updated_at }), "已删除的账号");
  });

  it("导出 GeoJSON：一块图形一个要素，带区域和图形的信息；编辑器的「粘贴坐标」读回来时类型和备注名都在", () => {
    const forbid = { id: "f", kind: "forbid" as const, seq: 2, label: "皇居", source: "pasted" as const, circle: null, geometry: square(0.005, 0.005, 0.005) };
    const text = areasToGeoJson([item("a", "甲", [operate("pa", 0, 0, 0.02), forbid])]);
    const parsed = JSON.parse(text);
    assert.equal(parsed.type, "FeatureCollection");
    assert.equal(parsed.features.length, 2);
    assert.deepEqual(parsed.features[1].properties, { area_id: "a", area_name: "甲", city_code: "CTY-JP-TYO", biz_type: "general", status: "active", kind: "forbid", name: "禁行 2", label: "皇居" });
    const back = parsePastedShapes(text);
    assert.deepEqual(back.polygons.map((polygon) => [(polygon as { kind?: string }).kind, (polygon as { label?: string }).label]), [["operate", ""], ["forbid", "皇居"]]);
    assert.equal(areasInGeoJson(text), 1);
    assert.equal(areasInGeoJson(areasToGeoJson([item("a", "甲", [operate("pa", 0, 0, 1)]), item("b", "乙", [operate("pb", 0, 0, 1)])])), 2);
    assert.equal(areasInGeoJson("不是 JSON"), 0);
  });

  it("导出的文件名按本地日期", () => {
    assert.equal(exportFileName(new Date(2026, 10, 9, 23, 59)), "区域地图-2026-11-09.geojson");
  });

  it("导入的文件：只认 .geojson / .json，2 MB 以内，有内容，一次一个区域", () => {
    const one = areasToGeoJson([item("a", "甲", [operate("pa", 0, 0, 1)])]);
    const two = areasToGeoJson([item("a", "甲", [operate("pa", 0, 0, 1)]), item("b", "乙", [operate("pb", 0, 0, 1)])]);
    assert.deepEqual(checkImportText("区域.geojson", 100, one), { ok: true, text: one });
    assert.deepEqual(checkImportText("别人的.JSON", 100, '{"type":"Polygon"}'), { ok: true, text: '{"type":"Polygon"}' });
    assert.equal((checkImportText("区域.kml", 100, one) as { message: string }).message, "只能导入 .geojson 或 .json 文件。");
    assert.equal((checkImportText("区域.geojson", 3 * 1024 * 1024, one) as { message: string }).message, "文件超过 2 MB，读不了。");
    assert.equal((checkImportText("区域.geojson", 0, "  ") as { message: string }).message, "这个文件读不出文字内容。");
    assert.match((checkImportText("区域.geojson", 100, two) as { message: string }).message, /有 2 个区域。一次只能导入一个区域/);
  });

  it("定位用的坐标：纬度在前，中英文逗号或空格分开，超出范围不认", () => {
    assert.deepEqual(parseLatLngText("35.6895, 139.6917"), { lat: 35.6895, lng: 139.6917 });
    assert.deepEqual(parseLatLngText(" 35.6895，139.6917 "), { lat: 35.6895, lng: 139.6917 });
    assert.deepEqual(parseLatLngText("-33.9 151.2"), { lat: -33.9, lng: 151.2 });
    assert.equal(parseLatLngText("139.6917, 35.6895"), null, "纬度超过 90：多半是写反了，不猜");
    assert.equal(parseLatLngText("成田机场"), null);
    assert.equal(parseLatLngText("35.6"), null);
  });
});
