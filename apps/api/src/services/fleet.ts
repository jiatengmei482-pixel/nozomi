/**
 * 司机、车辆的业务流程（M3-02，ADR 0027）：列表、新增、修改、停用。需求「9. 司机管理」「10. 车辆管理」、接口「GET/POST /drivers，GET/PUT/DELETE /drivers/{id}（删除 = 停用）」。
 *
 * - 全部在租户事务里：租户编号只来自登录令牌，别的供应商的司机、车辆一律当作不存在（404）。
 * - 资料的规则在 @nozomi/domain 的 dispatch.ts（电话国际格式、语言来自主数据、非营业牌照不能设为可用）；这里取数据、写库、写审计日志。
 * - 新增带幂等键；修改带版本号（If-Match）；内容没变的修改不加版本、不写日志。
 * - 不删除：订单的派车记录引用着它们；「删除」就是停用。已经派了单的司机、车辆停用后，那些单不受影响（需要改派由调度决定）。
 */
import { isDeepStrictEqual } from "node:util";
import { type DriverStatus, type FleetIssue, type PlateType, type VehicleStatus, driverIssues, normalizeDriverPhone, normalizePlate, vehicleIssues } from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { type Db, isUniqueViolation, withTenantTx } from "../db/context.ts";
import { AppError } from "../errors.ts";
import type { Page, TimeCursor } from "../pagination.ts";
import { type AuditValues, insertAuditLog } from "../repos/audit-logs.ts";
import {
  type Driver,
  type DriverFields,
  type FleetFilter,
  type Vehicle,
  type VehicleFields,
  findDriver,
  findVehicle,
  findVehicleGroups,
  insertDriver,
  insertVehicle,
  listDrivers as listDriverRows,
  listVehicles as listVehicleRows,
  updateDriver as updateDriverRow,
  updateVehicle as updateVehicleRow,
} from "../repos/fleet.ts";
import { type InputIssue, validationFailed } from "../validation.ts";
import { consoleOrigin, tenantActor } from "./audit.ts";
import { notFound, versionConflict } from "./errors.ts";
import { runIdempotent } from "./idempotency.ts";
import type { TenantPrincipal } from "./tenant-auth.ts";

export interface FleetWriter {
  principal: TenantPrincipal;
  ip: string;
}

const ISSUE_MESSAGES: Readonly<Record<FleetIssue["reason"], string>> = {
  REQUIRED: "必填",
  TOO_LONG: "太长了",
  INVALID_PHONE: "电话要写成带国家码的国际格式，如 +81 90-1234-5678（客人来自不同国家）",
  UNKNOWN_LANGUAGE: "只能是平台支持的语言（ja、zh、en、ko）",
  DUPLICATE: "重复了",
  OUT_OF_RANGE: "超出范围",
  PLATE_NOT_BUSINESS: "非营业牌照的车辆不能设为「可用」（不能收费载客）",
};

function rejectIssues(issues: readonly FleetIssue[]): void {
  if (issues.length > 0) throw validationFailed("body", issues.map((issue): InputIssue => ({ path: issue.path, reason: issue.reason, message: ISSUE_MESSAGES[issue.reason] })));
}

function phoneTaken(): AppError {
  return new AppError(409, "DRIVER_PHONE_TAKEN", "已经有一位司机登记了这个电话");
}

function plateTaken(): AppError {
  return new AppError(409, "VEHICLE_PLATE_TAKEN", "已经登记过这个车牌");
}

export interface DriverInputFields {
  name: string;
  phone: string;
  languages: string[];
  licenseExpiresOn: string;
  drivingYears: number | null;
  gold: boolean;
  status: DriverStatus;
}

function driverFields(input: DriverInputFields): DriverFields {
  rejectIssues(driverIssues(input));
  return { ...input, name: input.name.trim(), phone: normalizeDriverPhone(input.phone) };
}

function driverAudit(driver: DriverFields): AuditValues {
  return { name: driver.name, phone: driver.phone, languages: driver.languages, license_expires_on: driver.licenseExpiresOn, driving_years: driver.drivingYears, gold: driver.gold, status: driver.status };
}

export async function listDrivers(ctx: AppContext, tenantId: string, filter: FleetFilter, limit: number, after: TimeCursor | null): Promise<Page<Driver> & { total: number }> {
  return withTenantTx(ctx.pool, tenantId, (db) => listDriverRows(db, tenantId, filter, limit, after), { snapshot: true });
}

export async function getDriver(ctx: AppContext, tenantId: string, id: string): Promise<Driver> {
  const driver = await withTenantTx(ctx.pool, tenantId, (db) => findDriver(db, tenantId, id));
  if (driver === null) throw notFound("司机");
  return driver;
}

function audit(db: Db, writer: FleetWriter, now: Date, event: { resource: "driver" | "vehicle"; id: string; action: "create" | "update" | "disable"; before: AuditValues | null; after: AuditValues | null }): Promise<void> {
  return insertAuditLog(db, consoleOrigin(tenantActor(writer.principal.user), writer.ip, now), {
    tenantId: writer.principal.tenantId,
    resource: event.resource,
    resourceId: event.id,
    action: event.action,
    before: event.before,
    after: event.after,
  });
}

async function guardUnique<T>(work: () => Promise<T>, constraint: string, error: () => AppError): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (isUniqueViolation(err, constraint)) throw error();
    throw err;
  }
}

export async function createDriver(
  ctx: AppContext,
  writer: FleetWriter,
  input: DriverInputFields,
  idempotency: { scope: string; key: string },
  respond: (driver: Driver) => Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const fields = driverFields(input);
  const now = ctx.now();
  const tenantId = writer.principal.tenantId;
  return guardUnique(
    () =>
      withTenantTx(ctx.pool, tenantId, (db) =>
        runIdempotent(db, { tenantId, scope: idempotency.scope, key: idempotency.key, request: input, now }, async () => {
          const driver = await insertDriver(db, tenantId, fields, now);
          await audit(db, writer, now, { resource: "driver", id: driver.id, action: "create", before: null, after: driverAudit(driver) });
          return { status: 201, body: respond(driver) };
        }),
      ),
    "drivers_phone_key",
    phoneTaken,
  );
}

/** 修改（含停用、恢复在职）。`version` 是 If-Match 里的版本号。 */
export async function updateDriver(ctx: AppContext, writer: FleetWriter, id: string, version: number, input: DriverInputFields): Promise<Driver> {
  const fields = driverFields(input);
  const now = ctx.now();
  const tenantId = writer.principal.tenantId;
  return guardUnique(
    () =>
      withTenantTx(ctx.pool, tenantId, async (db) => {
        const current = await findDriver(db, tenantId, id, { lock: true });
        if (current === null) throw notFound("司机");
        if (current.version !== version) throw versionConflict(current.version);
        if (isDeepStrictEqual(driverAudit(current), driverAudit(fields))) return current;
        const saved = await updateDriverRow(db, tenantId, id, fields, now);
        const action = current.status === "active" && saved.status === "disabled" ? "disable" : "update";
        await audit(db, writer, now, { resource: "driver", id, action, before: driverAudit(current), after: driverAudit(saved) });
        return saved;
      }),
    "drivers_phone_key",
    phoneTaken,
  );
}

/** 停用（`DELETE /drivers/{id}`）：已经停用的再停用什么都不变。 */
export async function disableDriver(ctx: AppContext, writer: FleetWriter, id: string): Promise<Driver> {
  const now = ctx.now();
  const tenantId = writer.principal.tenantId;
  return withTenantTx(ctx.pool, tenantId, async (db) => {
    const current = await findDriver(db, tenantId, id, { lock: true });
    if (current === null) throw notFound("司机");
    if (current.status === "disabled") return current;
    const saved = await updateDriverRow(db, tenantId, id, { ...current, status: "disabled" }, now);
    await audit(db, writer, now, { resource: "driver", id, action: "disable", before: driverAudit(current), after: driverAudit(saved) });
    return saved;
  });
}

export interface VehicleInputFields {
  plate: string;
  vehicleGroupId: string;
  model: string;
  color: string;
  seats: number;
  mileageKm: number;
  plateType: PlateType;
  insuranceExpiresOn: string;
  inspectionExpiresOn: string;
  status: VehicleStatus;
}

function vehicleFields(input: VehicleInputFields): VehicleFields {
  rejectIssues(vehicleIssues(input));
  return { ...input, plate: normalizePlate(input.plate), model: input.model.trim(), color: input.color.trim() };
}

function vehicleAudit(vehicle: VehicleFields): AuditValues {
  return {
    plate: vehicle.plate,
    vehicle_group_id: vehicle.vehicleGroupId,
    model: vehicle.model,
    color: vehicle.color,
    seats: vehicle.seats,
    mileage_km: vehicle.mileageKm,
    plate_type: vehicle.plateType,
    insurance_expires_on: vehicle.insuranceExpiresOn,
    inspection_expires_on: vehicle.inspectionExpiresOn,
    status: vehicle.status,
  };
}

/** 车型组必须是平台主数据里启用中的（停用的车型组上已有的车辆可以照常修改其他内容）。 */
async function checkVehicleGroup(db: Db, vehicleGroupId: string, unchangedFrom: string | null): Promise<void> {
  const group = (await findVehicleGroups(db, [vehicleGroupId])).get(vehicleGroupId);
  if (group === undefined) throw validationFailed("body", [{ path: "/vehicle_group_id", reason: "UNKNOWN", message: "车型组不存在" }]);
  if (group.status !== "active" && unchangedFrom !== vehicleGroupId) throw validationFailed("body", [{ path: "/vehicle_group_id", reason: "DISABLED", message: "车型组已被平台停用" }]);
}

export async function listVehicles(ctx: AppContext, tenantId: string, filter: FleetFilter, limit: number, after: TimeCursor | null): Promise<Page<Vehicle> & { total: number }> {
  return withTenantTx(ctx.pool, tenantId, (db) => listVehicleRows(db, tenantId, filter, limit, after), { snapshot: true });
}

export async function getVehicle(ctx: AppContext, tenantId: string, id: string): Promise<Vehicle> {
  const vehicle = await withTenantTx(ctx.pool, tenantId, (db) => findVehicle(db, tenantId, id));
  if (vehicle === null) throw notFound("车辆");
  return vehicle;
}

export async function createVehicle(
  ctx: AppContext,
  writer: FleetWriter,
  input: VehicleInputFields,
  idempotency: { scope: string; key: string },
  respond: (vehicle: Vehicle) => Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const fields = vehicleFields(input);
  const now = ctx.now();
  const tenantId = writer.principal.tenantId;
  return guardUnique(
    () =>
      withTenantTx(ctx.pool, tenantId, (db) =>
        runIdempotent(db, { tenantId, scope: idempotency.scope, key: idempotency.key, request: input, now }, async () => {
          await checkVehicleGroup(db, fields.vehicleGroupId, null);
          const vehicle = await insertVehicle(db, tenantId, fields, now);
          await audit(db, writer, now, { resource: "vehicle", id: vehicle.id, action: "create", before: null, after: vehicleAudit(vehicle) });
          return { status: 201, body: respond(vehicle) };
        }),
      ),
    "vehicles_plate_key",
    plateTaken,
  );
}

export async function updateVehicle(ctx: AppContext, writer: FleetWriter, id: string, version: number, input: VehicleInputFields): Promise<Vehicle> {
  const fields = vehicleFields(input);
  const now = ctx.now();
  const tenantId = writer.principal.tenantId;
  return guardUnique(
    () =>
      withTenantTx(ctx.pool, tenantId, async (db) => {
        const current = await findVehicle(db, tenantId, id, { lock: true });
        if (current === null) throw notFound("车辆");
        if (current.version !== version) throw versionConflict(current.version);
        if (isDeepStrictEqual(vehicleAudit(current), vehicleAudit(fields))) return current;
        await checkVehicleGroup(db, fields.vehicleGroupId, current.vehicleGroupId);
        const saved = await updateVehicleRow(db, tenantId, id, fields, now);
        const action = current.status !== "disabled" && saved.status === "disabled" ? "disable" : "update";
        await audit(db, writer, now, { resource: "vehicle", id, action, before: vehicleAudit(current), after: vehicleAudit(saved) });
        return saved;
      }),
    "vehicles_plate_key",
    plateTaken,
  );
}

export async function disableVehicle(ctx: AppContext, writer: FleetWriter, id: string): Promise<Vehicle> {
  const now = ctx.now();
  const tenantId = writer.principal.tenantId;
  return withTenantTx(ctx.pool, tenantId, async (db) => {
    const current = await findVehicle(db, tenantId, id, { lock: true });
    if (current === null) throw notFound("车辆");
    if (current.status === "disabled") return current;
    const saved = await updateVehicleRow(db, tenantId, id, { ...current, status: "disabled" }, now);
    await audit(db, writer, now, { resource: "vehicle", id, action: "disable", before: vehicleAudit(current), after: vehicleAudit(saved) });
    return saved;
  });
}
