/**
 * 平台主数据的接口（M1-01）：城市、地点、车型组、附加服务。
 *
 * - `/platform/v1/master/*`：平台员工查看（操作 `master_data.read`）、新增、修改、停用、启用（操作 `master_data.manage`）。
 *   没有删除接口：主数据只停用。修改用请求头 `If-Match` 带版本号。
 * - `/tenant/v1/master/*`：租户只读（操作 `master_data.read`）。这里没有任何租户的写接口；
 *   主数据全平台共用，返回内容和租户无关，也不含对外价、加价比例（规则 4）。
 *
 * 这里只做鉴权、校验字段的类型和长度、调用、返回；编码格式、时区、坐标范围、引用关系等规则在 services/ 和 @nozomi/domain。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  ADDON_CHARGE_UNITS,
  FLIGHT_SCOPES,
  type LocalizedText,
  MASTER_DATA_LANGUAGES,
  MAX_BOUNDARY_POINTS,
  MAX_VEHICLE_COMBOS,
  MAX_VEHICLE_SEATS,
  type MasterDataStatus,
  PLACE_CATEGORIES,
  PLACE_TYPES,
  type PlatformAction,
  SERVICE_CATEGORIES,
  type TenantAction,
  VEHICLE_GRADES,
  VEHICLE_POWERS,
  hasVisibleText,
} from "@nozomi/domain";
import { bearerToken } from "../auth/token.ts";
import type { AppContext } from "../context.ts";
import { decodeCodeCursor, decodeTimeCursor } from "../pagination.ts";
import type { Addon, City, ColumnValues, MasterRef, Place, VehicleGroup } from "../repos/master-data.ts";
import {
  ADDON,
  CITY,
  type MasterReader,
  type MasterResource,
  type MasterWriter,
  PLACE,
  type PlaceRefs,
  VEHICLE_GROUP,
  createAddon,
  createCity,
  createPlace,
  createVehicleGroup,
  getMaster,
  listMaster,
  loadPlaceRefs,
  setAddonStatus,
  setCityStatus,
  setPlaceStatus,
  setVehicleGroupStatus,
  updateAddon,
  updateCity,
  updatePlace,
  updateVehicleGroup,
} from "../services/master-data.ts";
import { authenticatePlatform } from "../services/platform-auth.ts";
import { authenticateTenant } from "../services/tenant-auth.ts";
import { dateTimeSchema, ifMatchVersion, pageQuerySchema, parseInput, resourceId, uuidSchema } from "../validation.ts";
import { pageJson } from "./serialize.ts";

type Json = Record<string, unknown>;

const LANGUAGE_HINT = `只支持这些语言：${MASTER_DATA_LANGUAGES.join("、")}`;

/** 一段要给人看的文字：去掉首尾空白后不为空，而且不能只有零宽空格这类不可见字符。 */
function visibleText(maxLength: number) {
  return z.string().trim().min(1).max(maxLength).refine((text) => text === "" || hasVisibleText(text), "不能只有空白或不可见字符");
}

/** 多语言文本：键是语言代码，值是去掉首尾空白后不为空的文字。结果里只留下填了的语言。 */
function localized(maxLength: number) {
  const text = visibleText(maxLength).optional();
  return z
    .object({ ja: text, zh: text, en: text, ko: text })
    .strict(LANGUAGE_HINT)
    .transform((value): LocalizedText => Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)));
}

const nameSchema = localized(200).refine((value) => Object.keys(value).length > 0, "至少填写一种语言的名称");
const descriptionSchema = localized(2000);

const codeSchema = z.string().min(1).max(50);
const pointSchema = z.object({ lng: z.number().finite(), lat: z.number().finite() });

const positionSchema = z.tuple([z.number().finite(), z.number().finite()]);
const ringSchema = z.array(positionSchema).max(MAX_BOUNDARY_POINTS);
const polygonSchema = z.array(ringSchema).max(100);
const boundarySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("Polygon"), coordinates: polygonSchema }),
  z.object({ type: z.literal("MultiPolygon"), coordinates: z.array(polygonSchema).max(100) }),
]);

const citySchema = z.object({
  code: codeSchema,
  country_code: z.string().min(1).max(10),
  name: nameSchema,
  timezone: z.string().min(1).max(64),
  center: pointSchema,
  boundary: boundarySchema.nullable().default(null),
});

const cityPatchSchema = z.object({
  code: codeSchema.optional(),
  country_code: z.string().min(1).max(10).optional(),
  name: nameSchema.optional(),
  timezone: z.string().min(1).max(64).optional(),
  center: pointSchema.optional(),
  boundary: boundarySchema.nullable().optional(),
});

const addressSchema = visibleText(300);

const placeSchema = z.object({
  type: z.enum(PLACE_TYPES),
  code: codeSchema,
  city_id: uuidSchema.nullable().default(null),
  parent_id: uuidSchema.nullable().default(null),
  name: nameSchema,
  location: pointSchema,
  category: z.enum(PLACE_CATEGORIES).nullable().default(null),
  flight_scope: z.enum(FLIGHT_SCOPES).nullable().default(null),
  address: addressSchema.nullable().default(null),
});

const placePatchSchema = z.object({
  type: z.enum(PLACE_TYPES).optional(),
  code: codeSchema.optional(),
  parent_id: uuidSchema.nullable().optional(),
  city_id: uuidSchema.optional(),
  name: nameSchema.optional(),
  location: pointSchema.optional(),
  category: z.enum(PLACE_CATEGORIES).nullable().optional(),
  flight_scope: z.enum(FLIGHT_SCOPES).nullable().optional(),
  address: addressSchema.nullable().optional(),
});

const comboSchema = z.object({ passengers: z.number().int().min(1).max(MAX_VEHICLE_SEATS), luggage: z.number().int().min(0).max(1000) });
const sampleModelsSchema = z.array(visibleText(100)).max(10);
const combosSchema = z.array(comboSchema).max(MAX_VEHICLE_COMBOS);

const vehicleGroupSchema = z.object({
  code: codeSchema,
  grade: z.enum(VEHICLE_GRADES),
  seats: z.number().int().min(1).max(MAX_VEHICLE_SEATS),
  name: nameSchema,
  sample_models: sampleModelsSchema.default([]),
  power: z.enum(VEHICLE_POWERS),
  combos: combosSchema,
});

const vehicleGroupPatchSchema = z.object({
  code: codeSchema.optional(),
  grade: z.enum(VEHICLE_GRADES).optional(),
  seats: z.number().int().min(1).max(MAX_VEHICLE_SEATS).optional(),
  name: nameSchema.optional(),
  sample_models: sampleModelsSchema.optional(),
  power: z.enum(VEHICLE_POWERS).optional(),
  combos: combosSchema.optional(),
});

const categoriesSchema = z.array(z.enum(SERVICE_CATEGORIES)).min(1).max(SERVICE_CATEGORIES.length);

const addonSchema = z.object({
  code: codeSchema,
  categories: categoriesSchema,
  charge_unit: z.enum(ADDON_CHARGE_UNITS),
  name: nameSchema,
  description: descriptionSchema.default({}),
});

const addonPatchSchema = z.object({
  code: codeSchema.optional(),
  categories: categoriesSchema.optional(),
  charge_unit: z.enum(ADDON_CHARGE_UNITS).optional(),
  name: nameSchema.optional(),
  description: descriptionSchema.optional(),
});

/** 各列表共有的筛选：状态、编码、这个时间之后改过的（增量同步用）。 */
const listQuerySchema = pageQuerySchema.extend({
  status: z.enum(["active", "disabled", "all"]).optional(),
  code: codeSchema.optional(),
  q: z.string().trim().min(1).max(100).optional(),
  sort: z.enum(["created", "code"]).default("created"),
  updated_since: dateTimeSchema.optional(),
});

const placeListQuerySchema = listQuerySchema.extend({
  type: z.enum(PLACE_TYPES).optional(),
  city_id: z.union([z.literal("none"), uuidSchema]).optional(),
  parent_id: uuidSchema.optional(),
  country_code: z.string().regex(/^[A-Z]{2}$/, "必须是两位大写字母的国家码").optional(),
});

const vehicleGroupListQuerySchema = listQuerySchema.extend({ grade: z.enum(VEHICLE_GRADES).optional() });

function versionedJson(item: { id: string; status: MasterDataStatus; version: number; createdAt: Date; updatedAt: Date }): Json {
  return {
    status: item.status,
    version: item.version,
    created_at: item.createdAt.toISOString(),
    updated_at: item.updatedAt.toISOString(),
  };
}

export function cityJson(city: City): Json {
  return {
    id: city.id,
    code: city.code,
    country_code: city.countryCode,
    name: city.name,
    timezone: city.timezone,
    center: { lng: city.centerLng, lat: city.centerLat },
    boundary: city.boundary,
    ...versionedJson(city),
  };
}

function refJson(ref: MasterRef | undefined): Json | null {
  return ref === undefined ? null : { id: ref.id, code: ref.code, name: ref.name };
}

/** 租户看到的地点：没有导入来源这些平台内部的信息。`city`、`parent` 是所属城市和上级的编码与名称，省得再查一次。 */
export function tenantPlaceJson(place: Place, refs?: PlaceRefs): Json {
  const parent = place.parentId === null ? undefined : refs?.parents.get(place.parentId);
  return {
    id: place.id,
    type: place.type,
    code: place.code,
    country_code: place.countryCode,
    city_id: place.cityId,
    parent_id: place.parentId,
    city: refJson(place.cityId === null ? undefined : refs?.cities.get(place.cityId)),
    parent: parent === undefined ? null : { ...refJson(parent), type: parent.type },
    name: place.name,
    location: { lng: place.lng, lat: place.lat },
    category: place.category,
    flight_scope: place.flightScope,
    address: place.address,
    ...versionedJson(place),
  };
}

export function placeJson(place: Place, refs?: PlaceRefs): Json {
  return {
    ...tenantPlaceJson(place, refs),
    source:
      place.source === null
        ? null
        : {
            name: place.source,
            ref: place.sourceRef,
            synced_at: place.sourceSyncedAt?.toISOString() ?? null,
            overridden: place.sourceOverridden,
          },
  };
}

export function vehicleGroupJson(group: VehicleGroup): Json {
  return {
    id: group.id,
    code: group.code,
    grade: group.grade,
    seats: group.seats,
    name: group.name,
    sample_models: group.sampleModels,
    power: group.power,
    combos: group.combos.map((combo) => ({ passengers: combo.passengers, luggage: combo.luggage })),
    ...versionedJson(group),
  };
}

export function addonJson(addon: Addon): Json {
  return {
    id: addon.id,
    code: addon.code,
    categories: addon.categories,
    charge_unit: addon.chargeUnit,
    name: addon.name,
    description: addon.description,
    ...versionedJson(addon),
  };
}

/** 一类主数据的接口怎么拼：路径里的名字、校验结构、调哪个流程、怎么返回。 */
interface Endpoints<T extends City | Place | VehicleGroup | Addon, Query extends z.ZodTypeAny, Create extends z.ZodTypeAny, Patch extends z.ZodTypeAny> {
  path: string;
  resource: MasterResource<T>;
  platformJson: (item: T, refs?: PlaceRefs) => Json;
  tenantJson: (item: T, refs?: PlaceRefs) => Json;
  /** 应答里要带上被引用记录的编码和名称时，怎么取（只有地点需要） */
  loadRefs?: (reader: MasterReader, items: T[]) => Promise<PlaceRefs>;
  /** 查询参数里要求「为空」的列 */
  nulls?: (query: z.output<Query>) => string[];
  /** 启用接口的请求体（只有地点有：顺带指定城市） */
  enableSchema?: z.ZodType<{ city_id?: string | undefined }>;
  querySchema: Query;
  /** 查询参数里各类主数据自己的筛选项 → 列名 */
  equals: (query: z.output<Query>) => ColumnValues;
  createSchema: Create;
  create: (writer: MasterWriter, input: z.output<Create>) => Promise<T>;
  patchSchema: Patch;
  update: (writer: MasterWriter, id: string, version: number, patch: z.output<Patch>) => Promise<T>;
  setStatus: (writer: MasterWriter, id: string, status: MasterDataStatus, cityId?: string) => Promise<T>;
}

function withoutUndefined(values: Record<string, unknown>): ColumnValues {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
}

export function registerMasterDataRoutes(app: FastifyInstance, ctx: AppContext): void {
  const platform = (request: FastifyRequest, action: PlatformAction) =>
    authenticatePlatform(ctx, bearerToken(request.headers.authorization), { action });
  const tenant = (request: FastifyRequest, action: TenantAction) =>
    authenticateTenant(ctx, bearerToken(request.headers.authorization), { action });

  function register<T extends City | Place | VehicleGroup | Addon, Query extends z.ZodTypeAny, Create extends z.ZodTypeAny, Patch extends z.ZodTypeAny>(
    endpoints: Endpoints<T, Query, Create, Patch>,
  ): void {
    const { resource } = endpoints;
    type ToJson = (item: T, refs?: PlaceRefs) => Json;
    const PLATFORM: MasterReader = { kind: "platform" };
    const one = async (reader: MasterReader, item: T, toJson: ToJson): Promise<Json> =>
      toJson(item, endpoints.loadRefs ? await endpoints.loadRefs(reader, [item]) : undefined);
    const list = async (request: FastifyRequest, reader: MasterReader, toJson: ToJson): Promise<Json> => {
      const query = parseInput(endpoints.querySchema, request.query, "querystring") as z.output<typeof listQuerySchema>;
      // 平台默认看全部；租户默认只看启用中的（要引用的是能用的），需要时可以显式要停用的或全部
      const status = query.status ?? (reader.kind === "platform" ? "all" : "active");
      const page = await listMaster(
        ctx,
        reader,
        resource,
        {
          equals: withoutUndefined({ code: query.code, ...endpoints.equals(query) }),
          isNull: endpoints.nulls?.(query as z.output<Query>),
          status: status === "all" ? undefined : status,
          updatedSince: query.updated_since,
          search: query.q,
        },
        query.limit,
        // 两种排序的游标各解各的：换了排序还带着原来的游标会被拒绝（400），不会悄悄翻到错的位置
        query.sort === "code"
          ? { by: "code", after: decodeCodeCursor(query.cursor ?? null) }
          : { by: "created", after: decodeTimeCursor(query.cursor ?? null) },
      );
      const refs = endpoints.loadRefs ? await endpoints.loadRefs(reader, page.items) : undefined;
      return { ...pageJson(page, (item) => toJson(item, refs)), total: page.total };
    };

    const platformBase = `/platform/v1/master/${endpoints.path}`;
    app.get(platformBase, async (request) => {
      await platform(request, "master_data.read");
      return list(request, PLATFORM, endpoints.platformJson);
    });

    app.post(platformBase, async (request, reply) => {
      const principal = await platform(request, "master_data.manage");
      const input = parseInput(endpoints.createSchema, request.body, "body");
      const created = await endpoints.create({ principal, ip: request.ip }, input);
      return reply.code(201).send(await one(PLATFORM, created, endpoints.platformJson));
    });

    app.get(`${platformBase}/:id`, async (request) => {
      await platform(request, "master_data.read");
      const id = resourceId(request.params, resource.label);
      return one(PLATFORM, await getMaster(ctx, PLATFORM, resource, id), endpoints.platformJson);
    });

    app.patch(`${platformBase}/:id`, async (request) => {
      const principal = await platform(request, "master_data.manage");
      const id = resourceId(request.params, resource.label);
      const version = ifMatchVersion(request.headers["if-match"]);
      const patch = parseInput(endpoints.patchSchema, request.body, "body");
      return one(PLATFORM, await endpoints.update({ principal, ip: request.ip }, id, version, patch), endpoints.platformJson);
    });

    for (const [action, status] of [["disable", "disabled"], ["enable", "active"]] as const) {
      app.post(`${platformBase}/:id/${action}`, async (request) => {
        const principal = await platform(request, "master_data.manage");
        const id = resourceId(request.params, resource.label);
        const body = action === "enable" && endpoints.enableSchema ? parseInput(endpoints.enableSchema, request.body, "body") : {};
        return one(PLATFORM, await endpoints.setStatus({ principal, ip: request.ip }, id, status, body.city_id), endpoints.platformJson);
      });
    }

    const tenantBase = `/tenant/v1/master/${endpoints.path}`;
    app.get(tenantBase, async (request) => {
      const principal = await tenant(request, "master_data.read");
      return list(request, { kind: "tenant", tenantId: principal.tenantId }, endpoints.tenantJson);
    });

    app.get(`${tenantBase}/:id`, async (request) => {
      const principal = await tenant(request, "master_data.read");
      const id = resourceId(request.params, resource.label);
      const reader: MasterReader = { kind: "tenant", tenantId: principal.tenantId };
      return one(reader, await getMaster(ctx, reader, resource, id), endpoints.tenantJson);
    });
  }

  register({
    path: "cities",
    resource: CITY,
    platformJson: cityJson,
    tenantJson: cityJson,
    querySchema: listQuerySchema.extend({ country_code: z.string().regex(/^[A-Z]{2}$/, "必须是两位大写字母的国家码").optional() }),
    equals: (query) => ({ country_code: query.country_code }),
    createSchema: citySchema,
    create: (writer, input) =>
      createCity(ctx, writer, {
        code: input.code,
        countryCode: input.country_code,
        name: input.name,
        timezone: input.timezone,
        centerLng: input.center.lng,
        centerLat: input.center.lat,
        boundary: input.boundary,
      }),
    patchSchema: cityPatchSchema,
    update: (writer, id, version, patch) =>
      updateCity(ctx, writer, id, version, {
        code: patch.code,
        countryCode: patch.country_code,
        name: patch.name,
        timezone: patch.timezone,
        centerLng: patch.center?.lng,
        centerLat: patch.center?.lat,
        boundary: patch.boundary,
      }),
    setStatus: (writer, id, status) => setCityStatus(ctx, writer, id, status),
  });

  register({
    path: "places",
    resource: PLACE,
    platformJson: placeJson,
    tenantJson: tenantPlaceJson,
    querySchema: placeListQuerySchema,
    equals: (query) => ({
      type: query.type,
      city_id: query.city_id === "none" ? undefined : query.city_id,
      parent_id: query.parent_id,
      country_code: query.country_code,
    }),
    nulls: (query) => (query.city_id === "none" ? ["city_id"] : []),
    loadRefs: (reader, items) => loadPlaceRefs(ctx, reader, items),
    enableSchema: z.object({ city_id: uuidSchema.optional() }),
    createSchema: placeSchema,
    create: (writer, input) =>
      createPlace(ctx, writer, {
        type: input.type,
        code: input.code,
        cityId: input.city_id,
        parentId: input.parent_id,
        name: input.name,
        lng: input.location.lng,
        lat: input.location.lat,
        category: input.category,
        flightScope: input.flight_scope,
        address: input.address,
      }),
    patchSchema: placePatchSchema,
    update: (writer, id, version, patch) =>
      updatePlace(ctx, writer, id, version, {
        type: patch.type,
        code: patch.code,
        parentId: patch.parent_id,
        cityId: patch.city_id,
        name: patch.name,
        lng: patch.location?.lng,
        lat: patch.location?.lat,
        category: patch.category,
        flightScope: patch.flight_scope,
        address: patch.address,
      }),
    setStatus: (writer, id, status, cityId) => setPlaceStatus(ctx, writer, id, status, cityId),
  });

  register({
    path: "vehicle-groups",
    resource: VEHICLE_GROUP,
    platformJson: vehicleGroupJson,
    tenantJson: vehicleGroupJson,
    querySchema: vehicleGroupListQuerySchema,
    equals: (query) => ({ grade: query.grade }),
    createSchema: vehicleGroupSchema,
    create: (writer, input) =>
      createVehicleGroup(ctx, writer, {
        code: input.code,
        grade: input.grade,
        seats: input.seats,
        name: input.name,
        sampleModels: input.sample_models,
        power: input.power,
        combos: input.combos,
      }),
    patchSchema: vehicleGroupPatchSchema,
    update: (writer, id, version, patch) =>
      updateVehicleGroup(ctx, writer, id, version, {
        code: patch.code,
        grade: patch.grade,
        seats: patch.seats,
        name: patch.name,
        sampleModels: patch.sample_models,
        power: patch.power,
        combos: patch.combos,
      }),
    setStatus: (writer, id, status) => setVehicleGroupStatus(ctx, writer, id, status),
  });

  register({
    path: "addons",
    resource: ADDON,
    platformJson: addonJson,
    tenantJson: addonJson,
    querySchema: listQuerySchema,
    equals: () => ({}),
    createSchema: addonSchema,
    create: (writer, input) =>
      createAddon(ctx, writer, {
        code: input.code,
        categories: input.categories,
        chargeUnit: input.charge_unit,
        name: input.name,
        description: input.description,
      }),
    patchSchema: addonPatchSchema,
    update: (writer, id, version, patch) =>
      updateAddon(ctx, writer, id, version, {
        code: patch.code,
        categories: patch.categories,
        chargeUnit: patch.charge_unit,
        name: patch.name,
        description: patch.description,
      }),
    setStatus: (writer, id, status) => setAddonStatus(ctx, writer, id, status),
  });
}
