/**
 * /tenant/v1 的区域接口（M1-02），外加供应商后台的底图配置和首页数量。这里只做鉴权、校验字段的类型和长度、调用、返回；
 * 图形的规则在 @nozomi/domain，流程在 services/areas.ts。
 *
 * 区域地图（M8-18，ADR 0074）：`GET /tenant/v1/area-map`（本租户的区域连同全部图形、最近修改人）；运营后台只读的
 * `GET /platform/v1/area-map`（`product.read`，按供应商、城市筛）和 `GET /platform/v1/map/config`（任何已登录的平台员工）。
 *
 * 租户编号只来自令牌（`principal.tenantId`）：这里没有任何地方从请求参数或请求体读 tenant_id，校验结构里也没有这个字段。
 * 规则 4：返回里没有对外价和加价比例（区域本来也不涉及价格）。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { MapTilesConfig } from "@nozomi/config";
import { AREA_BIZ_TYPES, AREA_LIMITS, AREA_POLYGON_KINDS, AREA_POLYGON_SOURCES, AREA_ROLES, type TenantAction, ringToGeoJson, tenantRoleCan } from "@nozomi/domain";
import { bearerToken } from "../auth/token.ts";
import type { AppContext } from "../context.ts";
import { decodeTimeCursor } from "../pagination.ts";
import type { AreaPolygon } from "../repos/areas.ts";
import {
  type AreaPolygonInput,
  type AreaMapView,
  type AreaView,
  type PlatformAreaMapView,
  areaCounts,
  checkAreaPoint,
  createArea,
  deleteArea,
  getArea,
  listAreas,
  platformAreaMap,
  setAreaStatus,
  tenantAreaMap,
  updateArea,
} from "../services/areas.ts";
import { productCounts } from "../services/products.ts";
import { type SharedArea, type SharedAreaShape, createAreaFromShared, getSharedArea, latestSharedVersions, listSharedAreasFor, similarSharedAreas, syncAreaToShared } from "../services/shared-areas.ts";
import { authenticatePlatform, platformCredentials } from "../services/platform-auth.ts";
import { type TenantPrincipal, authenticateTenant } from "../services/tenant-auth.ts";
import { idempotencyKey, ifMatchVersion, pageQuerySchema, parseInput, resourceId, uuidSchema } from "../validation.ts";
import { localized, visibleText } from "./master-data.ts";

type Json = Record<string, unknown>;

const nameSchema = localized(AREA_LIMITS.maxNameLength).refine((value) => Object.keys(value).length > 0, "至少填写一种语言的名称");
const positionSchema = z.tuple([z.number().finite(), z.number().finite()]).rest(z.number());
const pointSchema = z.object({ lat: z.number().finite(), lng: z.number().finite() });

/** 一块图形。数量和点数这里只挡明显离谱的（防止超大的请求体），业务上限由 domain 的规则报出原因代码。 */
const polygonSchema = z.object({
  id: uuidSchema.nullable().default(null),
  kind: z.enum(AREA_POLYGON_KINDS),
  label: visibleText(AREA_LIMITS.maxLabelLength).nullable().default(null),
  source: z.enum(AREA_POLYGON_SOURCES).nullable().default(null),
  circle: z.object({ center: pointSchema, radius_m: z.number().finite() }).nullable().default(null),
  geometry: z
    .object({ type: z.literal("Polygon"), coordinates: z.array(z.array(positionSchema).max(AREA_LIMITS.maxTotalVertices + 1)).max(100) })
    .nullable()
    .default(null),
});

const polygonsSchema = z.array(polygonSchema).max(AREA_LIMITS.maxPolygons * 4);

/**
 * 用途（ADR 0075）：新建时不给按「运营 + 报价」（和 M8-20 之前新建的区域一样，页面改版前的调用照旧可用）；修改时不给 = 不改。
 */
const createSchema = z.object({ city_id: uuidSchema, name: nameSchema, biz_type: z.enum(AREA_BIZ_TYPES), role: z.enum(AREA_ROLES).default("both"), polygons: polygonsSchema });
const updateSchema = z.object({ city_id: uuidSchema.optional(), name: nameSchema, biz_type: z.enum(AREA_BIZ_TYPES), role: z.enum(AREA_ROLES).optional(), polygons: polygonsSchema });

const listQuerySchema = pageQuerySchema.extend({
  q: z.string().trim().min(1).max(100).optional(),
  city_id: uuidSchema.optional(),
  biz_type: z.enum(AREA_BIZ_TYPES).optional(),
  role: z.enum(AREA_ROLES).optional(),
  status: z.enum(["active", "disabled", "all"]).default("all"),
});

function toPolygonInputs(polygons: z.output<typeof polygonsSchema>): AreaPolygonInput[] {
  return polygons.map((polygon) => ({
    id: polygon.id?.toLowerCase() ?? null,
    kind: polygon.kind,
    label: polygon.label,
    source: polygon.source,
    circle: polygon.circle === null ? null : { center: polygon.circle.center, radiusM: polygon.circle.radius_m },
    geometry: polygon.geometry === null ? null : { type: "Polygon", coordinates: polygon.geometry.coordinates.map((ring) => ring.map((point) => [point[0], point[1]])) },
  }));
}

function polygonJson(polygon: AreaPolygon): Json {
  return {
    id: polygon.id,
    kind: polygon.kind,
    seq: polygon.seq,
    label: polygon.label,
    source: polygon.source,
    circle: polygon.circle === null ? null : { center: { lat: polygon.circle.center.lat, lng: polygon.circle.center.lng }, radius_m: polygon.circle.radiusM },
    geometry: ringToGeoJson(polygon.ring),
  };
}

/** 区域的应答。列表项没有 `polygons`（不带坐标，只带块数）；详情有。 */
export function areaJson(view: AreaView): Json {
  const { area, city } = view;
  return {
    id: area.id,
    name: area.name,
    city_id: area.cityId,
    city: city === null ? null : { id: city.id, code: city.code, name: city.name, status: city.status, center: { lng: city.center.lng, lat: city.center.lat }, boundary: city.boundary },
    biz_type: area.bizType,
    role: area.role,
    status: area.status,
    operate_polygon_count: view.operatePolygonCount,
    forbid_polygon_count: view.forbidPolygonCount,
    usage: { product_count: view.usage.productCount, published_product_count: view.usage.publishedProductCount },
    version: area.version,
    // 图形版本和共享库引用来源（M8-31，ADR 0083）
    shape_version: area.shapeVersion,
    shared_source: area.sharedSource === null ? null : { shared_area_id: area.sharedSource.areaId, shape_version: area.sharedSource.shapeVersion },
    created_at: area.createdAt.toISOString(),
    updated_at: area.updatedAt.toISOString(),
    ...(view.polygons === null ? {} : { polygons: view.polygons.map(polygonJson) }),
    ...(view.outsideOperatingM2 === undefined ? {} : { outside_operating_m2: view.outsideOperatingM2 }),
  };
}

const areaMapQuerySchema = z.object({
  city_id: uuidSchema.optional(),
  status: z.enum(["active", "disabled", "all"]).default("all"),
});
/** 供应商的区域地图不认识的参数一律 400：尤其是 `tenant_id`，租户编号只来自令牌。 */
const tenantAreaMapQuerySchema = areaMapQuerySchema.strict();
const platformAreaMapQuerySchema = areaMapQuerySchema.extend({ tenant_id: uuidSchema.optional() });

/** 区域地图的一项：区域详情（带全部图形）+ 最近一次是谁改的。 */
export function areaMapItemJson(view: AreaMapView): Json {
  const editor = view.lastEditor;
  return { ...areaJson(view), last_editor: editor === null ? null : { type: editor.type, name: editor.name, at: editor.at.toISOString() } };
}

function platformAreaMapItemJson(view: PlatformAreaMapView): Json {
  return { ...areaMapItemJson(view), tenant_id: view.tenant?.id ?? null, tenant: view.tenant };
}

/** 底图配置的应答：没有配置时 `tiles` 是 null。 */
export function mapConfigJson(tiles: MapTilesConfig | null): Json {
  if (tiles === null) return { tiles: null };
  return {
    tiles: {
      url_template: tiles.urlTemplate,
      dark_url_template: tiles.darkUrlTemplate,
      min_zoom: tiles.minZoom,
      max_zoom: tiles.maxZoom,
      tile_size: tiles.tileSize,
      referrer_policy: tiles.referrerPolicy,
      attribution: tiles.attribution.map((item) => ({ text: item.text, href: item.href })),
    },
  };
}

/** 引用来源在库里现在的图形版本补进应答：`latest_shape_version` 为 null 表示来源已不在共享库里（副本照旧可用）。 */
function withLatest(json: Json, latest: ReadonlyMap<string, number>): Json {
  const source = json["shared_source"] as { shared_area_id: string; shape_version: number } | null;
  return source === null ? json : { ...json, shared_source: { ...source, latest_shape_version: latest.get(source.shared_area_id) ?? null } };
}

function sharedAreaJson(area: SharedArea): Json {
  return {
    id: area.id,
    city_id: area.cityId,
    name: area.name,
    shape_version: area.shapeVersion,
    operate_polygon_count: area.operatePolygonCount,
    forbid_polygon_count: area.forbidPolygonCount,
    updated_at: area.updatedAt.toISOString(),
  };
}

function sharedShapeJson(shape: SharedAreaShape): Json {
  return { kind: shape.kind, geometry: ringToGeoJson(shape.ring) };
}

const sharedListQuerySchema = z.object({ city_id: uuidSchema, q: z.string().trim().min(1).max(100).optional() });
const fromSharedSchema = z.object({ shared_area_id: uuidSchema, name: nameSchema.nullable().default(null), biz_type: z.enum(AREA_BIZ_TYPES), role: z.enum(AREA_ROLES).default("both") });
const similarSchema = z.object({
  city_id: uuidSchema,
  name: z.record(z.string(), z.string().max(200)).nullable().default(null),
  polygons: z.array(z.object({ kind: z.enum(AREA_POLYGON_KINDS), geometry: z.object({ type: z.literal("Polygon"), coordinates: z.array(z.array(positionSchema).max(AREA_LIMITS.maxTotalVertices + 1)).max(100) }) })).max(AREA_LIMITS.maxPolygons * 4).default([]),
});

export function registerAreaRoutes(app: FastifyInstance, ctx: AppContext): void {
  const authenticate = (request: FastifyRequest, action?: TenantAction): Promise<TenantPrincipal> =>
    authenticateTenant(ctx, bearerToken(request.headers.authorization), action === undefined ? {} : { action });

  app.get("/tenant/v1/areas", async (request) => {
    const principal = await authenticate(request, "area.read");
    const query = parseInput(listQuerySchema, request.query, "querystring");
    const page = await listAreas(
      ctx,
      principal.tenantId,
      { search: query.q, cityId: query.city_id?.toLowerCase(), bizType: query.biz_type, role: query.role, status: query.status === "all" ? undefined : query.status },
      query.limit,
      decodeTimeCursor(query.cursor ?? null),
    );
    const latest = await latestSharedVersions(ctx, page.items.flatMap((item) => (item.area.sharedSource === null ? [] : [item.area.sharedSource.areaId])));
    return { items: page.items.map((item) => withLatest(areaJson(item), latest)), next_cursor: page.nextCursor, total: page.total };
  });

  app.post("/tenant/v1/areas", async (request, reply) => {
    const principal = await authenticate(request, "area.manage");
    const key = idempotencyKey(request.headers["idempotency-key"]);
    const input = parseInput(createSchema, request.body, "body");
    const result = await createArea(
      ctx,
      { principal, ip: request.ip },
      { cityId: input.city_id.toLowerCase(), name: input.name, bizType: input.biz_type, role: input.role, polygons: toPolygonInputs(input.polygons) },
      { scope: "POST /tenant/v1/areas", key },
      areaJson,
    );
    return reply.code(result.status).send(result.body);
  });

  app.get("/tenant/v1/areas/:id", async (request) => {
    const principal = await authenticate(request, "area.read");
    const view = await getArea(ctx, principal.tenantId, resourceId(request.params, "区域"));
    const latest = await latestSharedVersions(ctx, view.area.sharedSource === null ? [] : [view.area.sharedSource.areaId]);
    return withLatest(areaJson(view), latest);
  });

  // 区域共享库（M8-31，ADR 0083）：只有名称和形状，不显示创建者，不共享价格和加价
  app.get("/tenant/v1/shared-areas", async (request) => {
    const principal = await authenticate(request, "area.read");
    const query = parseInput(sharedListQuerySchema, request.query, "querystring");
    const result = await listSharedAreasFor(ctx, principal.tenantId, { cityId: query.city_id.toLowerCase(), search: query.q });
    return { items: result.items.map(sharedAreaJson), truncated: result.truncated };
  });

  app.get("/tenant/v1/shared-areas/:id", async (request) => {
    await authenticate(request, "area.read");
    const found = await getSharedArea(ctx, resourceId(request.params, "共享区域"));
    return { ...sharedAreaJson(found.area), polygons: found.shapes.map(sharedShapeJson) };
  });

  app.post("/tenant/v1/shared-areas/similar", async (request) => {
    const principal = await authenticate(request, "area.read");
    const input = parseInput(similarSchema, request.body, "body");
    const rings = input.polygons
      .filter((polygon) => polygon.kind === "operate")
      .map((polygon) => {
        const closed = (polygon.geometry.coordinates[0] ?? []).map((point) => [point[0], point[1]] as [number, number]);
        return closed.length > 1 && closed[0]?.[0] === closed.at(-1)?.[0] && closed[0]?.[1] === closed.at(-1)?.[1] ? closed.slice(0, -1) : closed;
      })
      .filter((ring) => ring.length >= 3);
    const name = input.name === null || Object.values(input.name).every((value) => value.trim() === "") ? null : input.name;
    const found = await similarSharedAreas(ctx, principal.tenantId, { cityId: input.city_id.toLowerCase(), name, operateRings: rings });
    return { items: found.map((item) => ({ ...sharedAreaJson(item.area), reasons: item.reasons })) };
  });

  app.post("/tenant/v1/areas/from-shared", async (request, reply) => {
    const principal = await authenticate(request, "area.manage");
    const key = idempotencyKey(request.headers["idempotency-key"]);
    const input = parseInput(fromSharedSchema, request.body, "body");
    const result = await createAreaFromShared(
      ctx,
      { principal, ip: request.ip },
      input.shared_area_id.toLowerCase(),
      { name: input.name, bizType: input.biz_type, role: input.role },
      { scope: "POST /tenant/v1/areas/from-shared", key },
      areaJson,
    );
    return reply.code(result.status).send(result.body);
  });

  app.post("/tenant/v1/areas/:id/sync-shared", async (request) => {
    const principal = await authenticate(request, "area.manage");
    const id = resourceId(request.params, "区域");
    const view = await syncAreaToShared(ctx, { principal, ip: request.ip }, id, ifMatchVersion(request.headers["if-match"]));
    const latest = await latestSharedVersions(ctx, view.area.sharedSource === null ? [] : [view.area.sharedSource.areaId]);
    return withLatest(areaJson(view), latest);
  });

  app.put("/tenant/v1/areas/:id", async (request) => {
    const principal = await authenticate(request, "area.manage");
    const id = resourceId(request.params, "区域");
    const version = ifMatchVersion(request.headers["if-match"]);
    const input = parseInput(updateSchema, request.body, "body");
    const updated = await updateArea(ctx, { principal, ip: request.ip }, id, version, {
      cityId: input.city_id?.toLowerCase() ?? null,
      name: input.name,
      bizType: input.biz_type,
      role: input.role ?? null,
      polygons: toPolygonInputs(input.polygons),
    });
    return areaJson(updated);
  });

  app.delete("/tenant/v1/areas/:id", async (request, reply) => {
    const principal = await authenticate(request, "area.manage");
    await deleteArea(ctx, { principal, ip: request.ip }, resourceId(request.params, "区域"));
    return reply.code(204).send();
  });

  for (const [action, status] of [["disable", "disabled"], ["enable", "active"]] as const) {
    app.post(`/tenant/v1/areas/:id/${action}`, async (request) => {
      const principal = await authenticate(request, "area.manage");
      return areaJson(await setAreaStatus(ctx, { principal, ip: request.ip }, resourceId(request.params, "区域"), status));
    });
  }

  app.post("/tenant/v1/areas/:id/check-point", async (request) => {
    const principal = await authenticate(request, "area.read");
    const id = resourceId(request.params, "区域");
    const point = parseInput(pointSchema, request.body, "body");
    const location = await checkAreaPoint(ctx, principal.tenantId, id, point);
    return { result: location.result, operate_polygon_ids: location.operatePolygonIds, forbid_polygon_ids: location.forbidPolygonIds };
  });

  app.get("/tenant/v1/area-map", async (request) => {
    const principal = await authenticate(request, "area.read");
    const query = parseInput(tenantAreaMapQuerySchema, request.query, "querystring");
    const found = await tenantAreaMap(ctx, principal.tenantId, { cityId: query.city_id?.toLowerCase(), status: query.status === "all" ? undefined : query.status });
    return { items: found.items.map(areaMapItemJson), truncated: found.truncated };
  });

  // 运营后台只读看全部供应商的区域：和看商品同一个权限（区域是商品配置的一部分）
  app.get("/platform/v1/area-map", async (request) => {
    await authenticatePlatform(ctx, platformCredentials(request), { action: "product.read" });
    const query = parseInput(platformAreaMapQuerySchema, request.query, "querystring");
    const found = await platformAreaMap(ctx, { tenantId: query.tenant_id?.toLowerCase(), cityId: query.city_id?.toLowerCase(), status: query.status === "all" ? undefined : query.status });
    return { items: found.items.map(platformAreaMapItemJson), truncated: found.truncated };
  });

  app.get("/platform/v1/map/config", async (request) => {
    await authenticatePlatform(ctx, platformCredentials(request));
    return mapConfigJson(ctx.config.mapTiles);
  });

  // 底图配置：任何已登录的供应商账号都能取。值来自环境配置（packages/config），不是密钥——本来就是要发给浏览器用的。
  app.get("/tenant/v1/map/config", async (request) => {
    await authenticate(request);
    return mapConfigJson(ctx.config.mapTiles);
  });

  // 首页的数量：任何已登录的供应商账号都能调，按模块裁剪——没有 area.read 的角色拿到的 areas 是 null。
  app.get("/tenant/v1/dashboard/summary", async (request) => {
    const principal = await authenticate(request);
    const role = principal.user.role;
    return {
      areas: tenantRoleCan(role, "area.read") ? await areaCounts(ctx, principal.tenantId) : null,
      products: tenantRoleCan(role, "product.read") ? await productCounts(ctx, principal.tenantId) : null,
    };
  });
}
