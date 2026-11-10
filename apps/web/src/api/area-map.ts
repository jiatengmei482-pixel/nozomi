/**
 * 区域地图（M8-18，ADR 0074）：一次取出一批区域连同全部图形、最近修改人。
 * 供应商后台用 `/tenant/v1/area-map`（只有自己的）；运营后台用 `/platform/v1/area-map`（全部供应商，只读）。
 * 类型手写，与 `apps/api/openapi.yaml` 对账（`area-map.contract.test.ts`）。
 */
import { apiRequest } from "./client.ts";
import { type Area, type MapConfig, TENANT_BASE, query } from "./areas.ts";

export const TENANT_AREA_MAP_PATH = `${TENANT_BASE}/area-map`;
export const PLATFORM_AREA_MAP_PATH = "/platform/v1/area-map";
export const PLATFORM_MAP_CONFIG_PATH = "/platform/v1/map/config";

export interface AreaLastEditor {
  type: "tenant_user" | "system" | "platform_user";
  /** 账号现在的名字；系统、账号已经不在了为 null */
  name: string | null;
  at: string;
}

export interface AreaMapItem extends Area {
  last_editor: AreaLastEditor | null;
}

export interface PlatformAreaMapItem extends AreaMapItem {
  tenant_id: string;
  tenant: { id: string; name: string; status: "active" | "suspended" } | null;
}

export interface AreaMapResponse<T extends AreaMapItem> {
  items: T[];
  /** 超过 300 个，只给了最近修改的 300 个 */
  truncated: boolean;
}

export interface AreaMapQuery {
  city_id?: string;
  status?: "active" | "disabled" | "all";
}

export interface PlatformAreaMapQuery extends AreaMapQuery {
  tenant_id?: string;
}

export function fetchTenantAreaMap(token: string, values: AreaMapQuery = {}): Promise<AreaMapResponse<AreaMapItem>> {
  return apiRequest("GET", query(TENANT_AREA_MAP_PATH, values), { token });
}

export function fetchPlatformAreaMap(token: string, values: PlatformAreaMapQuery = {}): Promise<AreaMapResponse<PlatformAreaMapItem>> {
  return apiRequest("GET", query(PLATFORM_AREA_MAP_PATH, values), { token });
}

export function fetchPlatformMapConfig(token: string): Promise<MapConfig> {
  return apiRequest("GET", PLATFORM_MAP_CONFIG_PATH, { token });
}

/** 对账用：字段名清单。 */
export const AREA_MAP_FIELDS = {
  AreaLastEditor: ["type", "name", "at"],
  AreaMapExtra: ["last_editor"],
  PlatformAreaMapExtra: ["last_editor", "tenant_id", "tenant"],
} as const satisfies {
  AreaLastEditor: readonly (keyof AreaLastEditor)[];
  AreaMapExtra: readonly Exclude<keyof AreaMapItem, keyof Area>[];
  PlatformAreaMapExtra: readonly Exclude<keyof PlatformAreaMapItem, keyof Area>[];
};
export const AREA_MAP_QUERY_KEYS = ["city_id", "status"] as const satisfies readonly (keyof AreaMapQuery)[];
export const PLATFORM_AREA_MAP_QUERY_KEYS = ["tenant_id", "city_id", "status"] as const satisfies readonly (keyof PlatformAreaMapQuery)[];
