/**
 * 运营后台下拉框用的主数据选项（M4-13，ADR 0046），城市之外的三种：
 * - 车型组 `GET /platform/v1/vehicle-group-options`：加价规则对话框、报价试算（渠道编辑、报价试算、主数据查看任一权限）；
 * - 地点 `GET /platform/v1/place-options?city_id=&type=`：报价试算的机场 / 车站（报价试算、主数据查看任一权限），按数据范围过滤；
 * - 附加服务 `GET /platform/v1/addon-options`：运营后台只读查看商品（商品查看、主数据查看任一权限）。
 * 只有启用中的（附加服务带 `include_disabled=true` 时连已停用的、每项多 `status`），只有下拉要的字段，不分页。
 * 主数据页面自己的管理仍走 `/platform/v1/master/*`。
 */
import type { AddonChargeUnit, LocalizedText, MasterDataStatus, ServiceCategory } from "@nozomi/domain";
import { apiRequest } from "./client.ts";
import { PLATFORM_BASE } from "./platform.ts";

export const VEHICLE_GROUP_OPTIONS_PATH = `${PLATFORM_BASE}/vehicle-group-options`;
export const PLACE_OPTIONS_PATH = `${PLATFORM_BASE}/place-options`;
export const ADDON_OPTIONS_PATH = `${PLATFORM_BASE}/addon-options`;

export interface VehicleGroupOption {
  id: string;
  code: string;
  name: LocalizedText;
}

/** 选项接口能取的地点类型（航站楼、出口挂在机场、车站下面，不单独选） */
export type OptionPlaceType = "airport" | "station" | "poi";

export interface PlaceOption {
  id: string;
  code: string;
  type: OptionPlaceType;
  name: LocalizedText;
}

/** 附加服务目录的一项（连已停用的取回，所以带状态）；供应商后台的主数据附加服务也满足这个形状 */
export interface AddonOption {
  id: string;
  code: string;
  name: LocalizedText;
  description: LocalizedText;
  categories: ServiceCategory[];
  charge_unit: AddonChargeUnit;
  status: MasterDataStatus;
}

export function listVehicleGroupOptions(token: string): Promise<VehicleGroupOption[]> {
  return apiRequest<{ items: VehicleGroupOption[] }>("GET", VEHICLE_GROUP_OPTIONS_PATH, { token }).then((page) => page.items);
}

export function listPlaceOptions(token: string, cityId: string, types: readonly OptionPlaceType[]): Promise<PlaceOption[]> {
  const query = new URLSearchParams({ city_id: cityId, type: types.join(",") });
  return apiRequest<{ items: PlaceOption[] }>("GET", `${PLACE_OPTIONS_PATH}?${query.toString()}`, { token }).then((page) => page.items);
}

/** 商品里勾着、后来被平台停用的附加服务也要显示（标「平台已停用」）：连已停用的一起取。 */
export function listAddonOptions(token: string): Promise<AddonOption[]> {
  return apiRequest<{ items: AddonOption[] }>("GET", `${ADDON_OPTIONS_PATH}?include_disabled=true`, { token }).then((page) => page.items);
}

/** 对账用：各选项的字段名清单（附加服务的 `status` 只在 `include_disabled=true` 时有）。 */
export const MASTER_OPTION_FIELDS = {
  VehicleGroupOption: ["id", "code", "name"],
  PlaceOption: ["id", "code", "type", "name"],
  AddonOption: ["id", "code", "name", "description", "categories", "charge_unit"],
} as const;
export const OPTION_PLACE_TYPES: readonly OptionPlaceType[] = ["airport", "station", "poi"];
