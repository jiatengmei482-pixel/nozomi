/**
 * /tenant/v1 的区域接口（M1-02），外加供应商后台的底图配置和首页数量。这里只做鉴权、校验字段的类型和长度、调用、返回；
 * 图形的规则在 @nozomi/domain，流程在 services/areas.ts。
 *
 * 租户编号只来自令牌（`principal.tenantId`）：这里没有任何地方从请求参数或请求体读 tenant_id，校验结构里也没有这个字段。
 * 规则 4：返回里没有对外价和加价比例（区域本来也不涉及价格）。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { MapTilesConfig } from "@nozomi/config";
import { AREA_BIZ_TYPES, AREA_LIMITS, AREA_POLYGON_KINDS, AREA_POLYGON_SOURCES, type TenantAction, ringToGeoJson, tenantRoleCan } from "@nozomi/domain";
import { bearerToken } from "../auth/token.ts";
import type { AppContext } from "../context.ts";
import { decodeTimeCursor } from "../pagination.ts";
import type { AreaPolygon } from "../repos/areas.ts";
import {
  type AreaPolygonInput,
  type AreaView,
  areaCounts,
  checkAreaPoint,
  createArea,
  deleteArea,
  getArea,
  listAreas,
  setAreaStatus,
  updateArea,
} from "../services/areas.ts";
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

const createSchema = z.object({ city_id: uuidSchema, name: nameSchema, biz_type: z.enum(AREA_BIZ_TYPES), polygons: polygonsSchema });
const updateSchema = z.object({ city_id: uuidSchema.optional(), name: nameSchema, biz_type: z.enum(AREA_BIZ_TYPES), polygons: polygonsSchema });

const listQuerySchema = pageQuerySchema.extend({
  q: z.string().trim().min(1).max(100).optional(),
  city_id: uuidSchema.optional(),
  biz_type: z.enum(AREA_BIZ_TYPES).optional(),
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
    status: area.status,
    operate_polygon_count: view.operatePolygonCount,
    forbid_polygon_count: view.forbidPolygonCount,
    version: area.version,
    created_at: area.createdAt.toISOString(),
    updated_at: area.updatedAt.toISOString(),
    ...(view.polygons === null ? {} : { polygons: view.polygons.map(polygonJson) }),
  };
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

export function registerAreaRoutes(app: FastifyInstance, ctx: AppContext): void {
  const authenticate = (request: FastifyRequest, action?: TenantAction): Promise<TenantPrincipal> =>
    authenticateTenant(ctx, bearerToken(request.headers.authorization), action === undefined ? {} : { action });

  app.get("/tenant/v1/areas", async (request) => {
    const principal = await authenticate(request, "area.read");
    const query = parseInput(listQuerySchema, request.query, "querystring");
    const page = await listAreas(
      ctx,
      principal.tenantId,
      { search: query.q, cityId: query.city_id?.toLowerCase(), bizType: query.biz_type, status: query.status === "all" ? undefined : query.status },
      query.limit,
      decodeTimeCursor(query.cursor ?? null),
    );
    return { items: page.items.map(areaJson), next_cursor: page.nextCursor, total: page.total };
  });

  app.post("/tenant/v1/areas", async (request, reply) => {
    const principal = await authenticate(request, "area.manage");
    const key = idempotencyKey(request.headers["idempotency-key"]);
    const input = parseInput(createSchema, request.body, "body");
    const result = await createArea(
      ctx,
      { principal, ip: request.ip },
      { cityId: input.city_id.toLowerCase(), name: input.name, bizType: input.biz_type, polygons: toPolygonInputs(input.polygons) },
      { scope: "POST /tenant/v1/areas", key },
      areaJson,
    );
    return reply.code(result.status).send(result.body);
  });

  app.get("/tenant/v1/areas/:id", async (request) => {
    const principal = await authenticate(request, "area.read");
    return areaJson(await getArea(ctx, principal.tenantId, resourceId(request.params, "区域")));
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

  // 底图配置：任何已登录的供应商账号都能取。值来自环境配置（packages/config），不是密钥——本来就是要发给浏览器用的。
  app.get("/tenant/v1/map/config", async (request) => {
    await authenticate(request);
    return mapConfigJson(ctx.config.mapTiles);
  });

  // 首页的数量：任何已登录的供应商账号都能调，按模块裁剪——没有 area.read 的角色拿到的 areas 是 null。
  app.get("/tenant/v1/dashboard/summary", async (request) => {
    const principal = await authenticate(request);
    return { areas: tenantRoleCan(principal.user.role, "area.read") ? await areaCounts(ctx, principal.tenantId) : null };
  });
}
