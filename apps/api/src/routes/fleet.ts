/**
 * 司机、车辆（M3-02，ADR 0027）：`/tenant/v1/drivers`、`/tenant/v1/vehicles`。这里只做鉴权、校验、调用、返回。
 * 看：`fleet.read`（管理员、调度、只读）；新增、修改、停用：`fleet.manage`（管理员、调度）。新增带 Idempotency-Key，修改带 If-Match。
 * `DELETE` = 停用（需求「删除 = 停用」）。证件的到期状态（快到期 / 已过期）按今天的日期（UTC）算，只用于提醒；能不能派单按用车日判断。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { DRIVER_STATUSES, PLATE_TYPES, type TenantAction, VEHICLE_STATUSES, expiryState, isLocalDate, vehicleIsNew } from "@nozomi/domain";
import { bearerToken } from "../auth/token.ts";
import type { AppContext } from "../context.ts";
import { decodeTimeCursor } from "../pagination.ts";
import type { Driver, Vehicle } from "../repos/fleet.ts";
import { createDriver, createVehicle, disableDriver, disableVehicle, getDriver, getVehicle, listDrivers, listVehicles, updateDriver, updateVehicle } from "../services/fleet.ts";
import { authenticateTenant } from "../services/tenant-auth.ts";
import { idempotencyKey, ifMatchVersion, pageQuerySchema, parseInput, resourceId, uuidSchema } from "../validation.ts";

const dateSchema = z.string().refine(isLocalDate, "日期写成 YYYY-MM-DD");

const driverBase = {
  name: z.string().max(200),
  phone: z.string().max(40),
  languages: z.array(z.string().max(10)).max(10),
  license_expires_on: dateSchema,
  driving_years: z.number().int().nullable().default(null),
  gold: z.boolean().default(false),
};
const createDriverSchema = z.object({ ...driverBase, status: z.enum(DRIVER_STATUSES).default("active") }).strict();
const updateDriverSchema = z.object({ ...driverBase, status: z.enum(DRIVER_STATUSES) }).strict();

const vehicleBase = {
  plate: z.string().max(40),
  vehicle_group_id: uuidSchema,
  model: z.string().max(200),
  color: z.string().max(60).default(""),
  seats: z.number().int(),
  mileage_km: z.number().int(),
  plate_type: z.enum(PLATE_TYPES),
  insurance_expires_on: dateSchema,
  inspection_expires_on: dateSchema,
};
const createVehicleSchema = z.object({ ...vehicleBase, status: z.enum(VEHICLE_STATUSES).default("available") }).strict();
const updateVehicleSchema = z.object({ ...vehicleBase, status: z.enum(VEHICLE_STATUSES) }).strict();

const driverListSchema = pageQuerySchema.extend({ status: z.enum(DRIVER_STATUSES).optional(), q: z.string().trim().min(1).max(50).optional() });
const vehicleListSchema = pageQuerySchema.extend({ status: z.enum(VEHICLE_STATUSES).optional(), q: z.string().trim().min(1).max(50).optional() });

const today = (now: Date): string => now.toISOString().slice(0, 10);

export function fleetDriverJson(driver: Driver, now: Date): Record<string, unknown> {
  return {
    id: driver.id,
    name: driver.name,
    phone: driver.phone,
    languages: driver.languages,
    license_expires_on: driver.licenseExpiresOn,
    license_state: expiryState(driver.licenseExpiresOn, today(now)),
    driving_years: driver.drivingYears,
    gold: driver.gold,
    status: driver.status,
    version: driver.version,
    created_at: driver.createdAt.toISOString(),
    updated_at: driver.updatedAt.toISOString(),
  };
}

export function fleetVehicleJson(vehicle: Vehicle, now: Date): Record<string, unknown> {
  return {
    id: vehicle.id,
    plate: vehicle.plate,
    vehicle_group_id: vehicle.vehicleGroupId,
    model: vehicle.model,
    color: vehicle.color,
    seats: vehicle.seats,
    mileage_km: vehicle.mileageKm,
    is_new: vehicleIsNew(vehicle.mileageKm),
    plate_type: vehicle.plateType,
    insurance_expires_on: vehicle.insuranceExpiresOn,
    insurance_state: expiryState(vehicle.insuranceExpiresOn, today(now)),
    inspection_expires_on: vehicle.inspectionExpiresOn,
    inspection_state: expiryState(vehicle.inspectionExpiresOn, today(now)),
    status: vehicle.status,
    version: vehicle.version,
    created_at: vehicle.createdAt.toISOString(),
    updated_at: vehicle.updatedAt.toISOString(),
  };
}

function driverFields(input: z.output<typeof updateDriverSchema>) {
  return { name: input.name, phone: input.phone, languages: input.languages, licenseExpiresOn: input.license_expires_on, drivingYears: input.driving_years, gold: input.gold, status: input.status };
}

function vehicleFields(input: z.output<typeof updateVehicleSchema>) {
  return {
    plate: input.plate,
    vehicleGroupId: input.vehicle_group_id.toLowerCase(),
    model: input.model,
    color: input.color,
    seats: input.seats,
    mileageKm: input.mileage_km,
    plateType: input.plate_type,
    insuranceExpiresOn: input.insurance_expires_on,
    inspectionExpiresOn: input.inspection_expires_on,
    status: input.status,
  };
}

export function registerFleetRoutes(app: FastifyInstance, ctx: AppContext): void {
  const authenticate = (request: FastifyRequest, action: TenantAction) => authenticateTenant(ctx, bearerToken(request.headers.authorization), { action });

  app.get("/tenant/v1/drivers", async (request) => {
    const principal = await authenticate(request, "fleet.read");
    const query = parseInput(driverListSchema, request.query, "querystring");
    const page = await listDrivers(ctx, principal.tenantId, { status: query.status ?? null, q: query.q ?? null }, query.limit, decodeTimeCursor(query.cursor ?? null));
    const now = ctx.now();
    return { items: page.items.map((driver) => fleetDriverJson(driver, now)), next_cursor: page.nextCursor, total: page.total };
  });

  app.post("/tenant/v1/drivers", async (request, reply) => {
    const principal = await authenticate(request, "fleet.manage");
    const key = idempotencyKey(request.headers["idempotency-key"]);
    const input = parseInput(createDriverSchema, request.body, "body");
    const result = await createDriver(ctx, { principal, ip: request.ip }, driverFields(input), { scope: "POST /tenant/v1/drivers", key }, (driver) => fleetDriverJson(driver, ctx.now()));
    return reply.code(result.status).send(result.body);
  });

  app.get("/tenant/v1/drivers/:id", async (request) => {
    const principal = await authenticate(request, "fleet.read");
    return fleetDriverJson(await getDriver(ctx, principal.tenantId, resourceId(request.params, "司机")), ctx.now());
  });

  app.put("/tenant/v1/drivers/:id", async (request) => {
    const principal = await authenticate(request, "fleet.manage");
    const id = resourceId(request.params, "司机");
    const version = ifMatchVersion(request.headers["if-match"]);
    const input = parseInput(updateDriverSchema, request.body, "body");
    return fleetDriverJson(await updateDriver(ctx, { principal, ip: request.ip }, id, version, driverFields(input)), ctx.now());
  });

  app.delete("/tenant/v1/drivers/:id", async (request) => {
    const principal = await authenticate(request, "fleet.manage");
    return fleetDriverJson(await disableDriver(ctx, { principal, ip: request.ip }, resourceId(request.params, "司机")), ctx.now());
  });

  app.get("/tenant/v1/vehicles", async (request) => {
    const principal = await authenticate(request, "fleet.read");
    const query = parseInput(vehicleListSchema, request.query, "querystring");
    const page = await listVehicles(ctx, principal.tenantId, { status: query.status ?? null, q: query.q ?? null }, query.limit, decodeTimeCursor(query.cursor ?? null));
    const now = ctx.now();
    return { items: page.items.map((vehicle) => fleetVehicleJson(vehicle, now)), next_cursor: page.nextCursor, total: page.total };
  });

  app.post("/tenant/v1/vehicles", async (request, reply) => {
    const principal = await authenticate(request, "fleet.manage");
    const key = idempotencyKey(request.headers["idempotency-key"]);
    const input = parseInput(createVehicleSchema, request.body, "body");
    const result = await createVehicle(ctx, { principal, ip: request.ip }, vehicleFields(input), { scope: "POST /tenant/v1/vehicles", key }, (vehicle) => fleetVehicleJson(vehicle, ctx.now()));
    return reply.code(result.status).send(result.body);
  });

  app.get("/tenant/v1/vehicles/:id", async (request) => {
    const principal = await authenticate(request, "fleet.read");
    return fleetVehicleJson(await getVehicle(ctx, principal.tenantId, resourceId(request.params, "车辆")), ctx.now());
  });

  app.put("/tenant/v1/vehicles/:id", async (request) => {
    const principal = await authenticate(request, "fleet.manage");
    const id = resourceId(request.params, "车辆");
    const version = ifMatchVersion(request.headers["if-match"]);
    const input = parseInput(updateVehicleSchema, request.body, "body");
    return fleetVehicleJson(await updateVehicle(ctx, { principal, ip: request.ip }, id, version, vehicleFields(input)), ctx.now());
  });

  app.delete("/tenant/v1/vehicles/:id", async (request) => {
    const principal = await authenticate(request, "fleet.manage");
    return fleetVehicleJson(await disableVehicle(ctx, { principal, ip: request.ip }, resourceId(request.params, "车辆")), ctx.now());
  });
}
