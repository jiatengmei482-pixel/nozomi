/**
 * 运营后台「选城市」用的城市选项（M4-13，ADR 0030 补充）：`GET /platform/v1/city-options`。
 * 只有启用中的城市，只有编号、编码、名称、国家、时区，不含坐标和边界；后端按调用人的数据范围过滤（限定了城市的人只拿到范围里的）。
 * 有渠道编辑、订单查看、商品查看、报价试算、角色编辑、主数据查看任一权限即可调用——自建角色不必为了选城市再勾「主数据 · 查看」。
 * 主数据页面自己的城市管理（含已停用）仍走 `/platform/v1/master/cities`。
 */
import type { LocalizedText } from "@nozomi/domain";
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

export function listCityOptions(token: string): Promise<{ items: SelectableCity[] }> {
  return apiRequest("GET", CITY_OPTIONS_PATH, { token });
}
