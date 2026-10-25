/**
 * 派车和调度回传（M3-02，ADR 0027）。这里只做鉴权、校验、调用、返回；规则在 services/dispatch.ts 和 @nozomi/domain。
 * 都要 `order.dispatch`（管理员、调度）；租户编号只来自登录令牌，别的供应商的单一律 404。
 *
 * - `GET /tenant/v1/orders/{id}/assignable`：可以派的司机和车辆，各自带不符合的原因和同一时段的单；
 * - `POST /tenant/v1/orders/{id}/assign`：派车 / 改派（If-Match 带订单的版本号）。应答里有司机链接的令牌（只出现这一次）；
 * - `POST /tenant/v1/orders/{id}/driver-link`：重新生成司机链接（旧的作废）；`DELETE` 吊销；
 * - `POST /tenant/v1/orders/{id}/events`：调度系统回传出发 / 到达 / 接到客人 / 完成。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { ASSIGNMENT_ISSUE_MESSAGES } from "@nozomi/domain";
import { bearerToken } from "../auth/token.ts";
import type { AppContext } from "../context.ts";
import { type IssuedLink, type Conflict, assignOrder, assignableResources, reissueDriverLink, reportTenantFulfilment, revokeDriverLink } from "../services/dispatch.ts";
import { FULFILMENT_EVENTS } from "../services/fulfilment.ts";
import { tenantOrderJson } from "../services/order-views.ts";
import { getOrderForTenant } from "../services/order-queries.ts";
import { authenticateTenant } from "../services/tenant-auth.ts";
import { ifMatchVersion, parseInput, resourceId, uuidSchema } from "../validation.ts";
import { fleetDriverJson, fleetVehicleJson } from "./fleet.ts";

export const locationSchema = z.object({ lng: z.number().min(-180).max(180), lat: z.number().min(-90).max(90), accuracy_m: z.number().int().min(0).max(100_000).nullable().default(null) }).strict();

const assignSchema = z.object({ driver_id: uuidSchema, vehicle_id: uuidSchema, confirm_conflicts: z.boolean().default(false) }).strict();

export const fulfilmentSchema = z
  .object({
    type: z.enum(FULFILMENT_EVENTS),
    location: locationSchema.nullable().default(null),
    actual: z.object({ minutes: z.number().int().min(0).max(10_080).nullable().default(null), km: z.number().int().min(0).max(5_000).nullable().default(null) }).strict().nullable().default(null),
  })
  .strict();

export function toLocation(input: z.output<typeof locationSchema> | null): { lng: number; lat: number; accuracyM: number | null } | null {
  return input === null ? null : { lng: input.lng, lat: input.lat, accuracyM: input.accuracy_m };
}

/** 司机链接：令牌原文和页面路径（令牌放在 # 后面，不会发给服务器、不进访问日志）。 */
export function issuedLinkJson(issued: IssuedLink): Record<string, unknown> {
  return { token: issued.token, path: `/driver#${issued.token}`, created_at: issued.link.createdAt.toISOString(), expires_at: issued.link.expiresAt.toISOString() };
}

function conflictJson(conflict: Conflict): Record<string, unknown> {
  return { resource: conflict.resource, resource_id: conflict.resourceId, order_id: conflict.orderId, order_no: conflict.orderNo, service_time: conflict.serviceAt.toISOString() };
}

const issueJson = (code: keyof typeof ASSIGNMENT_ISSUE_MESSAGES): Record<string, unknown> => ({ code, message: ASSIGNMENT_ISSUE_MESSAGES[code] });

export function registerDispatchRoutes(app: FastifyInstance, ctx: AppContext): void {
  const authenticate = (request: FastifyRequest) => authenticateTenant(ctx, bearerToken(request.headers.authorization), { action: "order.dispatch" });

  app.get("/tenant/v1/orders/:id/assignable", async (request) => {
    const principal = await authenticate(request);
    const result = await assignableResources(ctx, principal.tenantId, resourceId(request.params, "订单"));
    const now = ctx.now();
    return {
      order_id: result.order.id,
      drivers: result.drivers.map((entry) => ({ driver: fleetDriverJson(entry.item, now), assignable: entry.issues.length === 0, issues: entry.issues.map(issueJson), conflicts: entry.conflicts.map(conflictJson) })),
      vehicles: result.vehicles.map((entry) => ({ vehicle: fleetVehicleJson(entry.item, now), assignable: entry.issues.length === 0, issues: entry.issues.map(issueJson), conflicts: entry.conflicts.map(conflictJson) })),
    };
  });

  app.post("/tenant/v1/orders/:id/assign", async (request) => {
    const principal = await authenticate(request);
    const id = resourceId(request.params, "订单");
    const version = ifMatchVersion(request.headers["if-match"]);
    const input = parseInput(assignSchema, request.body, "body");
    const result = await assignOrder(ctx, { principal, ip: request.ip }, id, version, { driverId: input.driver_id.toLowerCase(), vehicleId: input.vehicle_id.toLowerCase(), confirmConflicts: input.confirm_conflicts });
    return {
      order: tenantOrderJson(result.order, { driver: result.driver, vehicle: result.vehicle }, ctx.now()),
      change: result.isChange,
      driver_link: result.link === null ? null : issuedLinkJson(result.link),
    };
  });

  app.post("/tenant/v1/orders/:id/driver-link", async (request) => {
    const principal = await authenticate(request);
    return { driver_link: issuedLinkJson(await reissueDriverLink(ctx, { principal, ip: request.ip }, resourceId(request.params, "订单"))) };
  });

  app.delete("/tenant/v1/orders/:id/driver-link", async (request, reply) => {
    const principal = await authenticate(request);
    await revokeDriverLink(ctx, { principal, ip: request.ip }, resourceId(request.params, "订单"));
    return reply.code(204).send();
  });

  app.post("/tenant/v1/orders/:id/events", async (request) => {
    const principal = await authenticate(request);
    const input = parseInput(fulfilmentSchema, request.body, "body");
    const id = resourceId(request.params, "订单");
    await reportTenantFulfilment(ctx, { principal, ip: request.ip }, id, { type: input.type, location: toLocation(input.location), actual: input.actual });
    const found = await getOrderForTenant(ctx, principal.tenantId, id);
    return { order: tenantOrderJson(found.order, found.facts, ctx.now()) };
  });
}
