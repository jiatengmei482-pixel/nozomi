/**
 * 运营后台「选城市」用的城市选项（M4-13，ADR 0046）：`GET /platform/v1/city-options`。
 * 默认只有启用中的城市，只有编号、编码、名称、国家、时区，不含坐标和边界；后端按调用人的数据范围过滤（限定了城市的人只拿到范围里的）。
 * 有渠道编辑、订单查看、商品查看、报价试算、角色编辑、主数据查看任一权限即可调用——自建角色不必为了选城市再勾「主数据 · 查看」。
 * 订单、商品列表的城市筛选要能筛已停用城市的历史数据：带 `include_disabled=true`，每项多一个 `status`。
 * 主数据页面自己的城市管理仍走 `/platform/v1/master/cities`。
 */
import type { LocalizedText, MasterDataStatus } from "@nozomi/domain";
import { apiRequest } from "./client.ts";
import { PLATFORM_BASE } from "./platform.ts";

export const CITY_OPTIONS_PATH = `${PLATFORM_BASE}/city-options`;

export interface SelectableCity {
  id: string;
  code: string;
  name: LocalizedText;
  country_code: string;
  timezone: string;
}

/** 带 `include_disabled=true` 取回的城市：多一个状态 */
export interface FilterableCity extends SelectableCity {
  status: MasterDataStatus;
}

export function listCityOptions(token: string): Promise<{ items: SelectableCity[] }> {
  return apiRequest("GET", CITY_OPTIONS_PATH, { token });
}

/** 列表筛选用：连已停用的城市也要。 */
export function listFilterCityOptions(token: string): Promise<{ items: FilterableCity[] }> {
  return apiRequest("GET", `${CITY_OPTIONS_PATH}?include_disabled=true`, { token });
}

/** 对账用：字段名清单（`status` 只在 `include_disabled=true` 时有）。 */
export const CITY_OPTION_FIELDS = {
  required: ["id", "code", "name", "country_code", "timezone"],
  optional: ["status"],
} as const satisfies Record<string, readonly (keyof FilterableCity)[]>;
