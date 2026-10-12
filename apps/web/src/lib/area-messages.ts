/**
 * 区域图形的问题、提醒、粘贴失败的定稿文案（docs/design/pages/tenant-areas.md 5.4、5.5、7.4）。
 * 原因代码来自 @nozomi/domain，后端保存时返回的也是同一套代码，所以两边的话是同一句。
 */
import { AREA_LIMITS, type AreaShapeWarning, type ShapeParseFailure, type ShapeTextFormat } from "@nozomi/domain";
import type { ShapeProblem } from "./area-editor.ts";
import { formatCount } from "./master-display.ts";

type Detail = Readonly<Record<string, unknown>>;
const num = (detail: Detail, key: string): number => (typeof detail[key] === "number" ? (detail[key] as number) : 0);

/** 一块图形自己的问题。`detail` 是原因附带的数字（点号、数量）。 */
export function ringProblemText(reason: string, detail: Detail = {}): string | null {
  switch (reason) {
    case "INVALID_COORDINATE":
      return `第 ${num(detail, "point")} 个点的坐标没填或不合法（纬度要在 -90 到 90、经度要在 -180 到 180 之间）。`;
    case "TOO_FEW_POINTS":
      return `至少要 ${AREA_LIMITS.minRingVertices} 个点才能围成一个范围，现在只有 ${num(detail, "count")} 个。`;
    case "TOO_MANY_VERTICES":
      return `这一块有 ${formatCount(num(detail, "count"))} 个点，一个多边形最多 ${formatCount(AREA_LIMITS.maxRingVertices)} 个点。`;
    case "DUPLICATE_POINT":
      return `第 ${num(detail, "a")} 个点和第 ${num(detail, "b")} 个点在同一个位置，请删掉其中一个。`;
    case "CROSSES_ANTIMERIDIAN":
      return "不支持跨过 180° 经线的图形。";
    case "COLLINEAR":
      return "这些点在一条直线上，围不成一个范围。";
    case "SELF_INTERSECTION": {
      const a = num(detail, "a");
      const b = num(detail, "b");
      return `第 ${a}–${a + 1} 个点之间的边，和第 ${b}–${b + 1} 个点之间的边交叉了。挪动这几个点，让边不再交叉。`;
    }
    case "HAS_HOLES":
      return "图形不能带洞。要在营运区中间挖掉一块，请在那里画一块禁行区。";
    case "CIRCLE_OUT_OF_BOUNDS":
      return "这个圆跨过了 180° 经线，或盖住了南北极，不支持。请把半径改小，或把圆心挪开。";
    case "RADIUS_OUT_OF_RANGE":
      return `半径要在 ${AREA_LIMITS.minRadiusM / 1000} 到 ${AREA_LIMITS.maxRadiusM / 1000} 公里之间`;
    default:
      return null;
  }
}

export function shapeProblemText(problem: ShapeProblem): string {
  return ringProblemText(problem.reason, problem as unknown as Detail) ?? "这一块图形不符合要求，请检查后重试。";
}

/** 整个区域层面的问题。 */
export function areaProblemText(reason: string, detail: Detail = {}): string | null {
  switch (reason) {
    case "NO_OPERATE_POLYGON":
      return "至少要有一块营运区。在地图上画一块，或点「添加营运区」。";
    case "TOO_MANY_POLYGONS":
      return `一个区域最多 ${AREA_LIMITS.maxPolygons} 块图形，现在有 ${num(detail, "count")} 块。`;
    case "TOO_MANY_TOTAL_VERTICES":
      return `这个区域一共有 ${formatCount(num(detail, "count"))} 个点，最多 ${formatCount(AREA_LIMITS.maxTotalVertices)} 个。请删掉一些点或一些图形。`;
    default:
      return null;
  }
}

/** 值得提醒、但可以保存的情况。`forbidName` 是「整个落在哪块禁行区里」的那一块的名字。 */
export function warningText(warning: AreaShapeWarning, cityName: string, forbidName: string): string {
  switch (warning.reason) {
    case "FORBID_OUTSIDE_OPERATE":
      return "这块禁行区完全在营运区外面，不起作用。它外面本来就不报价。";
    case "OPERATE_INSIDE_FORBID":
      return `这块营运区整个在「${forbidName}」里。禁行区优先，所以这一块实际上不会报价。`;
    case "FAR_FROM_CITY":
      return `有 ${warning.count} 个点离${cityName}中心超过 ${AREA_LIMITS.farFromCityKm} 公里，请确认坐标没有填错（例如纬度和经度填反了）。`;
  }
}

export const SHAPE_FORMAT_NAMES: Readonly<Record<ShapeTextFormat, string>> = { geojson: "GeoJSON", wkt: "WKT", rows: "坐标行" };

/** 粘贴的内容读不出来时的话。 */
export function parseFailureText(failure: ShapeParseFailure): string {
  switch (failure.reason) {
    case "EMPTY":
      return "请粘贴坐标";
    case "UNRECOGNIZED":
      return "认不出这段内容。请粘贴 GeoJSON、WKT，或每行一对「纬度, 经度」。";
    case "GEOJSON_SYNTAX":
      return failure.line === undefined ? "这段 GeoJSON 不完整或有语法错误。请重新复制一次。" : `这段 GeoJSON 不完整或有语法错误（第 ${failure.line} 行附近）。请重新复制一次。`;
    case "WKT_SYNTAX":
      return "这段 WKT 的写法不对。应该像这样：POLYGON((139.69 35.68, 139.75 35.68, 139.75 35.72, 139.69 35.68))";
    case "NO_POLYGON":
      return "这段内容里没有多边形（只有点、线，或多边形里一个点都没有）。区域需要的是多边形。";
    case "COORDINATE_OUT_OF_RANGE":
      return `第 ${failure.polygon} 个多边形里有超出范围的坐标（纬度要在 -90 到 90、经度要在 -180 到 180 之间）。`;
    case "UNSUPPORTED_SRID":
      return "只支持 WGS84（EPSG:4326）的坐标。";
  }
}
