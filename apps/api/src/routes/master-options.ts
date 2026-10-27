/**
 * 运营后台下拉框的主数据选项（M4-13，ADR 0046）：
 *
 * - `GET /platform/v1/city-options`：选城市（渠道、加价规则、订单和商品的城市筛选、报价试算、角色的数据范围）；
 * - `GET /platform/v1/vehicle-group-options`：选车型组（加价规则、报价试算）；
 * - `GET /platform/v1/place-options`：某个城市的机场 / 车站 / 地点（报价试算）；
 * - `GET /platform/v1/addon-options`：附加服务目录（运营后台查看商品）。
 *
 * 只给下拉需要的字段，不分页，默认只列启用中的。每个接口按用途允许几种操作中的任一种（`OPTION_ACTIONS`），
 * 自建角色不必为了一个下拉框再勾「主数据 · 查看」。主数据页面自己的管理仍走 `/platform/v1/master/*`。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { PlatformAction } from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import type { AddonOption, CityOption, PlaceOption, VehicleGroupOption } from "../repos/master-options.ts";
import { listAddonOptions, listCityOptions, listPlaceOptions, listVehicleGroupOptions } from "../services/master-options.ts";
import { authenticatePlatform, platformCredentials } from "../services/platform-auth.ts";
import { parseInput, uuidSchema } from "../validation.ts";

/** 每个选项接口允许的操作（有任一个即可）；权限矩阵测试和 ADR 0046 用同一份。 */
export const OPTION_ACTIONS = {
  "/platform/v1/city-options": ["channel.manage", "order.read", "product.read", "quote.preview", "role.manage", "master_data.read"],
  "/platform/v1/vehicle-group-options": ["channel.manage", "quote.preview", "master_data.read"],
  "/platform/v1/place-options": ["quote.preview", "master_data.read"],
  "/platform/v1/addon-options": ["product.read", "master_data.read"],
} as const satisfies Record<string, readonly PlatformAction[]>;

/** 选项接口能按哪些地点类型取：机场、车站、地点（航站楼、出口挂在机场下面，不单独选）。 */
export const OPTION_PLACE_TYPES = ["airport", "station", "poi"] as const;
type OptionPlaceType = (typeof OPTION_PLACE_TYPES)[number];

const includeDisabledSchema = z.object({ include_disabled: z.enum(["true", "false"]).default("false") }).strict();

const placeQuerySchema = z
  .object({
    city_id: uuidSchema,
    type: z
      .string()
      .max(100)
      .refine((value) => value.split(",").every((type) => (OPTION_PLACE_TYPES as readonly string[]).includes(type)), `只能是这些类型：${OPTION_PLACE_TYPES.join("、")}；多个用逗号分隔`)
      .transform((value) => [...new Set(value.split(","))] as OptionPlaceType[]),
  })
  .strict();

const noQuerySchema = z.object({}).strict();

function cityOptionJson(city: CityOption, withStatus: boolean): Record<string, unknown> {
  return { id: city.id, code: city.code, name: city.name, country_code: city.countryCode, timezone: city.timezone, ...(withStatus ? { status: city.status } : {}) };
}

function vehicleGroupOptionJson(group: VehicleGroupOption): Record<string, unknown> {
  return { id: group.id, code: group.code, name: group.name };
}

function placeOptionJson(place: PlaceOption): Record<string, unknown> {
  return { id: place.id, code: place.code, type: place.type, name: place.name };
}

function addonOptionJson(addon: AddonOption, withStatus: boolean): Record<string, unknown> {
  return {
    id: addon.id,
    code: addon.code,
    name: addon.name,
    description: addon.description,
    categories: addon.categories,
    charge_unit: addon.chargeUnit,
    ...(withStatus ? { status: addon.status } : {}),
  };
}

export function registerMasterOptionRoutes(app: FastifyInstance, ctx: AppContext): void {
  const platform = (request: FastifyRequest, path: keyof typeof OPTION_ACTIONS) =>
    authenticatePlatform(ctx, platformCredentials(request), { anyOf: OPTION_ACTIONS[path] });

  app.get("/platform/v1/city-options", async (request) => {
    const principal = await platform(request, "/platform/v1/city-options");
    const includeDisabled = parseInput(includeDisabledSchema, request.query, "querystring").include_disabled === "true";
    const cities = await listCityOptions(ctx, principal, includeDisabled);
    return { items: cities.map((city) => cityOptionJson(city, includeDisabled)) };
  });

  app.get("/platform/v1/vehicle-group-options", async (request) => {
    await platform(request, "/platform/v1/vehicle-group-options");
    parseInput(noQuerySchema, request.query, "querystring");
    return { items: (await listVehicleGroupOptions(ctx)).map(vehicleGroupOptionJson) };
  });

  app.get("/platform/v1/place-options", async (request) => {
    const principal = await platform(request, "/platform/v1/place-options");
    const query = parseInput(placeQuerySchema, request.query, "querystring");
    return { items: (await listPlaceOptions(ctx, principal, query.city_id, query.type)).map(placeOptionJson) };
  });

  app.get("/platform/v1/addon-options", async (request) => {
    await platform(request, "/platform/v1/addon-options");
    const includeDisabled = parseInput(includeDisabledSchema, request.query, "querystring").include_disabled === "true";
    return { items: (await listAddonOptions(ctx, includeDisabled)).map((addon) => addonOptionJson(addon, includeDisabled)) };
  });
}
