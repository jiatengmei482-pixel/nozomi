/**
 * 包车机场开始 / 机场结束套餐的机场绑定（M9P-21 接口，M9P-22 页面；ADR 0098 第三节第 2、8 小节）：
 * - 供应商后台：`GET/PUT /tenant/v1/products/{id}/charter-airports`（整组替换，带商品版本号）；
 * - 运营后台：`GET /platform/v1/products/{id}/charter-airports`（只读）。
 * 价格页第四张表「机场套餐价」算继承价时，要知道机场在哪（主数据地点的坐标）、各区域的图形（区域地图接口）。
 * 类型手写，与 `apps/api/openapi.yaml` 对账（`charter-airports.contract.test.ts`）。这些接口里只有结算价相关的配置，没有对外价。
 */
import type { AirportScenarioKind, LocalizedText } from "@nozomi/domain";
import { TENANT_BASE, listAll } from "./areas.ts";
import { apiRequest } from "./client.ts";
import { MASTER_BASE, type Place } from "./master.ts";
import { PLATFORM_PRODUCTS_PATH } from "./platform-products.ts";
import { PRODUCTS_PATH } from "./products.ts";

export interface CharterAirportBinding {
  scenario: AirportScenarioKind;
  place_id: string;
  place_code: string;
  place_name: LocalizedText;
  area_id: string;
  area_name: LocalizedText;
  short_name_zh: string | null;
  /** false：机场区域或机场已停用，报价时这条不生效 */
  effective: boolean;
}

export interface CharterAirports {
  /** 商品的版本号 */
  version: number;
  bindings: CharterAirportBinding[];
}

export interface CharterAirportBindingInput {
  scenario: AirportScenarioKind;
  place_id: string;
  area_id: string;
  short_name_zh: string | null;
}

const tenantPath = (id: string): string => `${PRODUCTS_PATH}/${encodeURIComponent(id)}/charter-airports`;

export function getCharterAirports(token: string, id: string): Promise<CharterAirports> {
  return apiRequest("GET", tenantPath(id), { token });
}

export function putCharterAirports(token: string, id: string, version: number, bindings: readonly CharterAirportBindingInput[]): Promise<CharterAirports> {
  return apiRequest("PUT", tenantPath(id), { token, body: { bindings }, headers: { "if-match": `"${version}"` } });
}

export function getPlatformCharterAirports(token: string, id: string): Promise<CharterAirports> {
  return apiRequest("GET", `${PLATFORM_PRODUCTS_PATH}/${encodeURIComponent(id)}/charter-airports`, { token });
}

/** 商品编辑页选机场：平台启用中的机场（同一个国家的；成田这样的机场不在商品城市里，所以不按城市筛） */
export function listAirportOptions(token: string, countryCode: string): Promise<Place[]> {
  return listAll(`${TENANT_BASE}/master/places`, token, { type: "airport", country_code: countryCode, sort: "code" });
}

/** 一个机场的主数据（算继承价时要它的坐标）：供应商后台走租户的只读主数据，运营后台走平台主数据 */
export function getAirportPlace(portal: "tenant" | "platform", token: string, id: string): Promise<Place> {
  const base = portal === "tenant" ? `${TENANT_BASE}/master/places` : `${MASTER_BASE}/places`;
  return apiRequest("GET", `${base}/${encodeURIComponent(id)}`, { token });
}

/** 对账用：字段名清单。 */
export const CHARTER_AIRPORT_FIELDS = {
  CharterAirports: ["version", "bindings"],
  CharterAirportBinding: ["scenario", "place_id", "place_code", "place_name", "area_id", "area_name", "short_name_zh", "effective"],
  CharterAirportBindingInput: ["scenario", "place_id", "area_id", "short_name_zh"],
} as const satisfies {
  CharterAirports: readonly (keyof CharterAirports)[];
  CharterAirportBinding: readonly (keyof CharterAirportBinding)[];
  CharterAirportBindingInput: readonly (keyof CharterAirportBindingInput)[];
};

/** 页面专门处理的错误码 */
export const CHARTER_AIRPORT_ERROR_CODES = ["VALIDATION_FAILED", "VERSION_CONFLICT", "CHARTER_LAYOUT_NOT_MIGRATED", "AIRPORT_PRICES_EXIST"] as const;
