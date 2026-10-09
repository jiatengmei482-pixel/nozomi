/**
 * 供应商后台：区域、地图底图配置、首页数量、选城市和参考点用的平台主数据（只读）。
 * 类型手写，与 `apps/api/openapi.yaml` 对账（`areas.contract.test.ts`）。
 */
import type { AreaBizType, AreaPolygonKind, AreaPolygonSource, LocalizedText, MasterDataStatus, PlaceType } from "@nozomi/domain";
import { apiRequest } from "./client.ts";
import type { City, MasterPage, Place, Point } from "./master.ts";

export const TENANT_BASE = "/tenant/v1";
export const AREAS_PATH = `${TENANT_BASE}/areas`;

export interface AreaCity {
  id: string;
  code: string;
  name: LocalizedText;
  status: MasterDataStatus;
  center: Point;
  boundary: unknown | null;
}

export interface AreaCircle {
  center: { lat: number; lng: number };
  radius_m: number;
}

export interface AreaGeometry {
  type: "Polygon";
  /** 一圈、首尾闭合；每个点是 [经度, 纬度] */
  coordinates: [number, number][][];
}

export interface AreaPolygon {
  id: string;
  kind: AreaPolygonKind;
  /** 这一类里的序号（「营运 1」的 1），删除后不重排 */
  seq: number;
  label: string | null;
  source: AreaPolygonSource;
  /** 原本是圆的才有：只用于再次按圆来改，判断只认 geometry */
  circle: AreaCircle | null;
  geometry: AreaGeometry;
}

export interface AreaSummary {
  id: string;
  name: LocalizedText;
  city_id: string;
  city: AreaCity;
  biz_type: AreaBizType;
  status: MasterDataStatus;
  operate_polygon_count: number;
  forbid_polygon_count: number;
  usage: AreaUsage;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface Area extends AreaSummary {
  polygons: AreaPolygon[];
}

/** 提交的一块图形：多边形给 geometry，圆给 circle；已有的带 id，新加的不带。 */
export interface AreaPolygonInput {
  id?: string;
  kind: AreaPolygonKind;
  label: string | null;
  source: AreaPolygonSource;
  circle?: AreaCircle;
  geometry?: AreaGeometry;
}

export interface AreaCreate {
  city_id: string;
  name: LocalizedText;
  biz_type: AreaBizType;
  polygons: AreaPolygonInput[];
}
export type AreaUpdate = Omit<AreaCreate, "city_id">;

export interface AreaPointCheck {
  result: "operate" | "forbid" | "outside";
  operate_polygon_ids: string[];
  forbid_polygon_ids: string[];
}

export interface MapTiles {
  url_template: string;
  dark_url_template: string | null;
  min_zoom: number;
  max_zoom: number;
  tile_size: 256 | 512;
  referrer_policy: "no-referrer" | "origin" | "strict-origin" | "strict-origin-when-cross-origin";
  attribution: { text: string; href: string | null }[];
}

export interface MapConfig {
  /** 这个环境没有配置底图时为 null：页面照常可用，只是没有地图 */
  tiles: MapTiles | null;
}

export interface TenantDashboardSummary {
  /** 当前角色不能看区域时为 null */
  areas: { active: number; disabled: number } | null;
  /** 当前角色不能看商品时为 null */
  products: { draft: number; published: number; unpublished: number } | null;
}

/** 这个区域被多少个商品选了、其中多少个已上架。 */
export interface AreaUsage {
  product_count: number;
  published_product_count: number;
}

export interface AreaListQuery {
  limit?: number;
  cursor?: string;
  q?: string;
  city_id?: string;
  biz_type?: AreaBizType;
  status?: MasterDataStatus | "all";
}
export const AREA_LIST_QUERY_KEYS = ["limit", "cursor", "q", "city_id", "biz_type", "status"] as const satisfies readonly (keyof AreaListQuery)[];

export function query(path: string, values: object): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const text = params.toString();
  return text === "" ? path : `${path}?${text}`;
}

const one = (id: string): string => `${AREAS_PATH}/${encodeURIComponent(id)}`;

export function listAreas(token: string, values: AreaListQuery): Promise<MasterPage<AreaSummary>> {
  return apiRequest("GET", query(AREAS_PATH, values), { token });
}

export function getArea(token: string, id: string): Promise<Area> {
  return apiRequest("GET", one(id), { token });
}

/** 新增。`idempotencyKey` 进入新增页时生成一个，保存成功前不换：连点两次不会建出两个区域。 */
export function createArea(token: string, body: AreaCreate, idempotencyKey: string): Promise<Area> {
  return apiRequest("POST", AREAS_PATH, { token, body, headers: { "idempotency-key": idempotencyKey } });
}

/** 修改：整体替换，`version` 放在 If-Match 里。 */
export function updateArea(token: string, id: string, version: number, body: AreaUpdate): Promise<Area> {
  return apiRequest("PUT", one(id), { token, body, headers: { "if-match": `"${version}"` } });
}

export function deleteArea(token: string, id: string): Promise<void> {
  return apiRequest("DELETE", one(id), { token });
}

export function setAreaStatus(token: string, id: string, action: "enable" | "disable"): Promise<Area> {
  return apiRequest("POST", `${one(id)}/${action}`, { token });
}

export function checkAreaPoint(token: string, id: string, point: { lat: number; lng: number }): Promise<AreaPointCheck> {
  return apiRequest("POST", `${one(id)}/check-point`, { token, body: point });
}

export function fetchMapConfig(token: string): Promise<MapConfig> {
  return apiRequest("GET", `${TENANT_BASE}/map/config`, { token });
}

export function fetchTenantSummary(token: string): Promise<TenantDashboardSummary> {
  return apiRequest("GET", `${TENANT_BASE}/dashboard/summary`, { token });
}

export async function listAll<T>(path: string, token: string, values: object): Promise<T[]> {
  const all: T[] = [];
  let cursor: string | undefined;
  do {
    const page: MasterPage<T> = await apiRequest("GET", query(path, { ...values, limit: 200, cursor }), { token });
    all.push(...page.items);
    cursor = page.next_cursor ?? undefined;
  } while (cursor !== undefined);
  return all;
}

/** 平台的城市清单（供应商只读）。不带 status 只有启用的；`all` 连已停用的一起。 */
export function listTenantCities(token: string, status?: "all"): Promise<City[]> {
  return listAll(`${TENANT_BASE}/master/cities`, token, { sort: "code", ...(status ? { status } : {}) });
}

/** 一个城市里某一类的参考点（机场、车站、地标）。接口的 type 一次只能给一个值。 */
export function listTenantPlaces(token: string, cityId: string, type: PlaceType): Promise<Pick<Place, "id" | "code" | "name" | "type" | "location">[]> {
  return listAll(`${TENANT_BASE}/master/places`, token, { city_id: cityId, type });
}

/** 对账用：每个类型的字段名清单。 */
const SUMMARY = ["id", "name", "city_id", "city", "biz_type", "status", "operate_polygon_count", "forbid_polygon_count", "usage", "version", "created_at", "updated_at"] as const;
export const AREA_SCHEMA_FIELDS = {
  AreaSummary: SUMMARY,
  Area: [...SUMMARY, "polygons"],
  AreaCity: ["id", "code", "name", "status", "center", "boundary"],
  AreaPolygon: ["id", "kind", "seq", "label", "source", "circle", "geometry"],
  AreaCircle: ["center", "radius_m"],
  AreaGeometry: ["type", "coordinates"],
  AreaPointCheck: ["result", "operate_polygon_ids", "forbid_polygon_ids"],
} as const satisfies {
  AreaSummary: readonly (keyof AreaSummary)[];
  Area: readonly (keyof Area)[];
  AreaCity: readonly (keyof AreaCity)[];
  AreaPolygon: readonly (keyof AreaPolygon)[];
  AreaCircle: readonly (keyof AreaCircle)[];
  AreaGeometry: readonly (keyof AreaGeometry)[];
  AreaPointCheck: readonly (keyof AreaPointCheck)[];
};

export const AREA_WRITE_FIELDS = {
  AreaCreate: ["city_id", "name", "biz_type", "polygons"],
  AreaUpdate: ["name", "biz_type", "polygons"],
  AreaPolygonInput: ["id", "kind", "label", "source", "circle", "geometry"],
} as const satisfies {
  AreaCreate: readonly (keyof AreaCreate)[];
  AreaUpdate: readonly (keyof AreaUpdate)[];
  AreaPolygonInput: readonly (keyof AreaPolygonInput)[];
};

export const MAP_TILE_FIELDS = ["url_template", "dark_url_template", "min_zoom", "max_zoom", "tile_size", "referrer_policy", "attribution"] as const satisfies readonly (keyof MapTiles)[];

/** 前端按错误码或原因代码分别处理的区域错误。 */
export const AREA_ERROR_CODES = ["VERSION_CONFLICT", "FIELD_LOCKED", "AREA_NAME_TAKEN", "MASTER_DATA_NOT_READY", "CONCURRENT_UPDATE", "IDEMPOTENCY_KEY_REUSED", "AREA_IN_USE", "PRECONDITION_REQUIRED"] as const;
