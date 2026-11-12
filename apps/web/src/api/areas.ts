/**
 * 供应商后台：区域、地图底图配置、首页数量、选城市和参考点用的平台主数据（只读）。
 * 类型手写，与 `apps/api/openapi.yaml` 对账（`areas.contract.test.ts`）。
 */
import type { AreaBizType, AreaPolygonKind, AreaPolygonSource, AreaRole, LocalizedText, MasterDataStatus, PlaceType } from "@nozomi/domain";
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
  /** 用途（M8-20，ADR 0075）：运营区域 / 报价区域 / 运营 + 报价。页面改版前可能没有这一项 */
  role?: AreaRole;
  status: MasterDataStatus;
  operate_polygon_count: number;
  forbid_polygon_count: number;
  usage: AreaUsage;
  version: number;
  /** 图形版本（M8-31，ADR 0083）：只有图形变了才加一 */
  shape_version?: number;
  /** 从共享库引用来的副本记住的来源；自己画的为 null */
  shared_source?: AreaSharedSource | null;
  created_at: string;
  updated_at: string;
}

export interface AreaSharedSource {
  shared_area_id: string;
  /** 引用（或上次切换）时来源的图形版本 */
  shape_version: number;
  /** 列表、详情里有：来源现在在库里的图形版本；比 shape_version 大 = 库里有新版本；null = 来源已不在库里 */
  latest_shape_version?: number | null;
}

/** 共享库里的一个区域（只有名称和形状概况，不显示创建者） */
export interface SharedArea {
  id: string;
  city_id: string;
  name: LocalizedText;
  shape_version: number;
  operate_polygon_count: number;
  forbid_polygon_count: number;
  updated_at: string;
}

export interface SharedAreaDetail extends SharedArea {
  polygons: { kind: AreaPolygonKind; geometry: AreaGeometry }[];
}

export interface SimilarSharedArea extends SharedArea {
  reasons: ("name" | "overlap")[];
}

export interface Area extends AreaSummary {
  polygons: AreaPolygon[];
  /** 报价区域有多少平方米不在任何运营区域里（不到 100 平方米为 0；运营区域、停用的为 null；M8-20） */
  outside_operating_m2?: number | null;
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
  /** 用途（M8-20）：新建时不给按运营 + 报价；修改时不给 = 不改 */
  role?: AreaRole;
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
  role?: AreaRole;
  status?: MasterDataStatus | "all";
}
export const AREA_LIST_QUERY_KEYS = ["limit", "cursor", "q", "city_id", "biz_type", "role", "status"] as const satisfies readonly (keyof AreaListQuery)[];

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

/** 区域共享库（M8-31）：一个城市里的共享区域，最多 50 个；`truncated` 为真时请输入名称缩小范围 */
export function listSharedAreas(token: string, cityId: string, q: string): Promise<{ items: SharedArea[]; truncated: boolean }> {
  return apiRequest("GET", query(`${TENANT_BASE}/shared-areas`, { city_id: cityId, q: q.trim() === "" ? undefined : q.trim() }), { token });
}

export function getSharedArea(token: string, id: string): Promise<SharedAreaDetail> {
  return apiRequest("GET", `${TENANT_BASE}/shared-areas/${encodeURIComponent(id)}`, { token });
}

/** 新建区域前查库里同名或营运区重叠的区域（最多 5 个，同名在前） */
export function similarSharedAreas(token: string, body: { city_id: string; name: LocalizedText | null; polygons: { kind: AreaPolygonKind; geometry: AreaGeometry }[] }): Promise<{ items: SimilarSharedArea[] }> {
  return apiRequest("POST", `${TENANT_BASE}/shared-areas/similar`, { token, body });
}

/** 引用：在自己名下新建一个副本（带幂等键） */
export function createAreaFromShared(token: string, body: { shared_area_id: string; name: LocalizedText | null; biz_type: AreaBizType; role: AreaRole }, idempotencyKey: string): Promise<Area> {
  return apiRequest("POST", `${AREAS_PATH}/from-shared`, { token, body, headers: { "idempotency-key": idempotencyKey } });
}

/** 把引用来的区域切换到来源在库里的新版本图形 */
export function syncAreaToShared(token: string, id: string, version: number): Promise<Area> {
  return apiRequest("POST", `${one(id)}/sync-shared`, { token, headers: { "if-match": `"${version}"` } });
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
const SUMMARY = ["id", "name", "city_id", "city", "biz_type", "role", "status", "operate_polygon_count", "forbid_polygon_count", "usage", "version", "shape_version", "shared_source", "created_at", "updated_at"] as const;
const SHARED = ["id", "city_id", "name", "shape_version", "operate_polygon_count", "forbid_polygon_count", "updated_at"] as const;
export const AREA_SCHEMA_FIELDS = {
  AreaSummary: SUMMARY,
  Area: [...SUMMARY, "polygons", "outside_operating_m2"],
  AreaCity: ["id", "code", "name", "status", "center", "boundary"],
  AreaPolygon: ["id", "kind", "seq", "label", "source", "circle", "geometry"],
  AreaCircle: ["center", "radius_m"],
  AreaGeometry: ["type", "coordinates"],
  AreaPointCheck: ["result", "operate_polygon_ids", "forbid_polygon_ids"],
  SharedArea: SHARED,
  SharedAreaDetail: [...SHARED, "polygons"],
  SimilarSharedArea: [...SHARED, "reasons"],
} as const satisfies {
  AreaSummary: readonly (keyof AreaSummary)[];
  Area: readonly (keyof Area)[];
  AreaCity: readonly (keyof AreaCity)[];
  AreaPolygon: readonly (keyof AreaPolygon)[];
  AreaCircle: readonly (keyof AreaCircle)[];
  AreaGeometry: readonly (keyof AreaGeometry)[];
  AreaPointCheck: readonly (keyof AreaPointCheck)[];
  SharedArea: readonly (keyof SharedArea)[];
  SharedAreaDetail: readonly (keyof SharedAreaDetail)[];
  SimilarSharedArea: readonly (keyof SimilarSharedArea)[];
};

export const AREA_WRITE_FIELDS = {
  AreaCreate: ["city_id", "name", "biz_type", "role", "polygons"],
  AreaUpdate: ["name", "biz_type", "role", "polygons"],
  AreaPolygonInput: ["id", "kind", "label", "source", "circle", "geometry"],
} as const satisfies {
  AreaCreate: readonly (keyof AreaCreate)[];
  AreaUpdate: readonly (keyof AreaUpdate)[];
  AreaPolygonInput: readonly (keyof AreaPolygonInput)[];
};

export const MAP_TILE_FIELDS = ["url_template", "dark_url_template", "min_zoom", "max_zoom", "tile_size", "referrer_policy", "attribution"] as const satisfies readonly (keyof MapTiles)[];

/** 前端按错误码或原因代码分别处理的区域错误。 */
export const AREA_ERROR_CODES = ["VERSION_CONFLICT", "FIELD_LOCKED", "AREA_NAME_TAKEN", "MASTER_DATA_NOT_READY", "CONCURRENT_UPDATE", "IDEMPOTENCY_KEY_REUSED", "AREA_IN_USE", "PRECONDITION_REQUIRED", "PRICING_AREA_OUTSIDE_OPERATING", "SHARED_AREA_UNAVAILABLE", "NOT_FROM_SHARED_LIBRARY"] as const;
