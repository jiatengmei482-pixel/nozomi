/**
 * 运营后台下拉框的主数据选项（M4-13，ADR 0046）。
 *
 * 选城市、选车型组、选机场车站、看附加服务是渠道、订单、商品、报价试算、角色这些页面里的一个下拉框，
 * 不该要求自建角色另外勾「主数据 · 查看」；所以单开只读、字段最少的选项接口，按用途允许几种权限中的任一种（路由里写）。
 * 城市和地点按调用人的数据范围过滤：限定了城市的人只拿到范围里的城市、范围里城市的地点。车型组、附加服务没有城市之分，不过滤。
 */
import type { PlaceType } from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { withPlatformTx } from "../db/context.ts";
import {
  type AddonOption,
  type CityOption,
  type PlaceOption,
  type VehicleGroupOption,
  selectAddonOptions,
  selectCityOptions,
  selectPlaceOptions,
  selectVehicleGroupOptions,
} from "../repos/master-options.ts";
import type { PlatformPrincipal } from "./platform-auth.ts";

export function listCityOptions(ctx: AppContext, principal: PlatformPrincipal, includeDisabled: boolean): Promise<CityOption[]> {
  return withPlatformTx(ctx.pool, (db) => selectCityOptions(db, { includeDisabled, cityIds: principal.grant.scope.cityIds }));
}

export function listVehicleGroupOptions(ctx: AppContext): Promise<VehicleGroupOption[]> {
  return withPlatformTx(ctx.pool, (db) => selectVehicleGroupOptions(db));
}

/** 不在调用人城市范围里的城市：和不存在的城市一样，得到空列表。 */
export function listPlaceOptions(ctx: AppContext, principal: PlatformPrincipal, cityId: string, types: readonly PlaceType[]): Promise<PlaceOption[]> {
  return withPlatformTx(ctx.pool, (db) => selectPlaceOptions(db, { cityId, types, cityIds: principal.grant.scope.cityIds }));
}

export function listAddonOptions(ctx: AppContext, includeDisabled: boolean): Promise<AddonOption[]> {
  return withPlatformTx(ctx.pool, (db) => selectAddonOptions(db, { includeDisabled }));
}
