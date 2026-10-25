/**
 * 司机、车辆的数据访问（M3-02，ADR 0027）。两张都是租户表：只在租户事务里读写（运营后台只读），每条查询都显式带 tenant_id。
 */
import type { DriverStatus, PlateType, VehicleGrade, VehicleStatus } from "@nozomi/domain";
import type { Db } from "../db/context.ts";
import { type Page, type TimeCursor, toPage } from "../pagination.ts";

type Row = Record<string, any>;

export interface Driver {
  tenantId: string;
  id: string;
  name: string;
  phone: string;
  languages: string[];
  licenseExpiresOn: string;
  drivingYears: number | null;
  gold: boolean;
  status: DriverStatus;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const DRIVER_COLUMNS = "d.tenant_id, d.id, d.name, d.phone, d.languages, d.license_expires_on::text as license_expires_on, d.driving_years, d.gold, d.status, d.version, d.created_at, d.updated_at";

function toDriver(row: Row): Driver {
  return {
    tenantId: row["tenant_id"],
    id: row["id"],
    name: row["name"],
    phone: row["phone"],
    languages: row["languages"],
    licenseExpiresOn: row["license_expires_on"],
    drivingYears: row["driving_years"],
    gold: row["gold"],
    status: row["status"],
    version: row["version"],
    createdAt: row["created_at"],
    updatedAt: row["updated_at"],
  };
}

export type DriverFields = Pick<Driver, "name" | "phone" | "languages" | "licenseExpiresOn" | "drivingYears" | "gold" | "status">;

export async function insertDriver(db: Db, tenantId: string, fields: DriverFields, now: Date): Promise<Driver> {
  const result = await db.query<Row>(
    `insert into drivers as d (tenant_id, name, phone, languages, license_expires_on, driving_years, gold, status, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) returning ${DRIVER_COLUMNS}`,
    [tenantId, fields.name, fields.phone, fields.languages, fields.licenseExpiresOn, fields.drivingYears, fields.gold, fields.status, now],
  );
  return toDriver(result.rows[0] as Row);
}

export async function updateDriver(db: Db, tenantId: string, id: string, fields: DriverFields, now: Date): Promise<Driver> {
  const result = await db.query<Row>(
    `update drivers d set name = $3, phone = $4, languages = $5, license_expires_on = $6, driving_years = $7, gold = $8, status = $9, version = version + 1, updated_at = $10
      where d.tenant_id = $1 and d.id = $2 returning ${DRIVER_COLUMNS}`,
    [tenantId, id, fields.name, fields.phone, fields.languages, fields.licenseExpiresOn, fields.drivingYears, fields.gold, fields.status, now],
  );
  return toDriver(result.rows[0] as Row);
}

export async function findDriver(db: Db, tenantId: string, id: string, options: { lock?: boolean } = {}): Promise<Driver | null> {
  const result = await db.query<Row>(`select ${DRIVER_COLUMNS} from drivers d where d.tenant_id = $1 and d.id = $2 ${options.lock ? "for update" : ""}`, [tenantId, id]);
  const row = result.rows[0];
  return row === undefined ? null : toDriver(row);
}

export async function findDriversByIds(db: Db, tenantId: string, ids: readonly string[]): Promise<Map<string, Driver>> {
  if (ids.length === 0) return new Map();
  const result = await db.query<Row>(`select ${DRIVER_COLUMNS} from drivers d where d.tenant_id = $1 and d.id = any($2::uuid[])`, [tenantId, [...new Set(ids)]]);
  return new Map(result.rows.map((row) => [row["id"] as string, toDriver(row)]));
}

export interface FleetFilter {
  status: string | null;
  q: string | null;
}

export async function listDrivers(db: Db, tenantId: string, filter: FleetFilter, limit: number, after: TimeCursor | null): Promise<Page<Driver> & { total: number }> {
  const where = `d.tenant_id = $1 and ($2::text is null or d.status = $2) and ($3::text is null or strpos(lower(d.name), lower($3)) > 0 or strpos(d.phone, $3) > 0)`;
  const params = [tenantId, filter.status, filter.q];
  const result = await db.query<Row>(
    `select ${DRIVER_COLUMNS}, d.created_at::text as cursor_time from drivers d where ${where}
        and ($4::timestamptz is null or (d.created_at, d.id) < ($4::timestamptz, $5::uuid))
      order by d.created_at desc, d.id desc limit $6`,
    [...params, after?.t ?? null, after?.id ?? null, limit + 1],
  );
  const total = await db.query<{ n: number }>(`select count(*)::int as n from drivers d where ${where}`, params);
  return { ...toPage(result.rows, limit, toDriver, (row) => ({ t: row["cursor_time"], id: row["id"] })), total: (total.rows[0] as { n: number }).n };
}

/** 全部在职的司机（派车时列可派的人；一个供应商的司机不会多到要分页）。 */
export async function listActiveDrivers(db: Db, tenantId: string): Promise<Driver[]> {
  const result = await db.query<Row>(`select ${DRIVER_COLUMNS} from drivers d where d.tenant_id = $1 and d.status = 'active' order by d.name, d.id`, [tenantId]);
  return result.rows.map(toDriver);
}

export interface Vehicle {
  tenantId: string;
  id: string;
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
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const VEHICLE_COLUMNS = `v.tenant_id, v.id, v.plate, v.vehicle_group_id, v.model, v.color, v.seats, v.mileage_km, v.plate_type, v.insurance_expires_on::text as insurance_expires_on,
  v.inspection_expires_on::text as inspection_expires_on, v.status, v.version, v.created_at, v.updated_at`;

function toVehicle(row: Row): Vehicle {
  return {
    tenantId: row["tenant_id"],
    id: row["id"],
    plate: row["plate"],
    vehicleGroupId: row["vehicle_group_id"],
    model: row["model"],
    color: row["color"],
    seats: row["seats"],
    mileageKm: row["mileage_km"],
    plateType: row["plate_type"],
    insuranceExpiresOn: row["insurance_expires_on"],
    inspectionExpiresOn: row["inspection_expires_on"],
    status: row["status"],
    version: row["version"],
    createdAt: row["created_at"],
    updatedAt: row["updated_at"],
  };
}

export type VehicleFields = Pick<Vehicle, "plate" | "vehicleGroupId" | "model" | "color" | "seats" | "mileageKm" | "plateType" | "insuranceExpiresOn" | "inspectionExpiresOn" | "status">;

export async function insertVehicle(db: Db, tenantId: string, fields: VehicleFields, now: Date): Promise<Vehicle> {
  const result = await db.query<Row>(
    `insert into vehicles as v (tenant_id, plate, vehicle_group_id, model, color, seats, mileage_km, plate_type, insurance_expires_on, inspection_expires_on, status, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12) returning ${VEHICLE_COLUMNS}`,
    [tenantId, fields.plate, fields.vehicleGroupId, fields.model, fields.color, fields.seats, fields.mileageKm, fields.plateType, fields.insuranceExpiresOn, fields.inspectionExpiresOn, fields.status, now],
  );
  return toVehicle(result.rows[0] as Row);
}

export async function updateVehicle(db: Db, tenantId: string, id: string, fields: VehicleFields, now: Date): Promise<Vehicle> {
  const result = await db.query<Row>(
    `update vehicles v set plate = $3, vehicle_group_id = $4, model = $5, color = $6, seats = $7, mileage_km = $8, plate_type = $9, insurance_expires_on = $10,
            inspection_expires_on = $11, status = $12, version = version + 1, updated_at = $13
      where v.tenant_id = $1 and v.id = $2 returning ${VEHICLE_COLUMNS}`,
    [tenantId, id, fields.plate, fields.vehicleGroupId, fields.model, fields.color, fields.seats, fields.mileageKm, fields.plateType, fields.insuranceExpiresOn, fields.inspectionExpiresOn, fields.status, now],
  );
  return toVehicle(result.rows[0] as Row);
}

export async function findVehicle(db: Db, tenantId: string, id: string, options: { lock?: boolean } = {}): Promise<Vehicle | null> {
  const result = await db.query<Row>(`select ${VEHICLE_COLUMNS} from vehicles v where v.tenant_id = $1 and v.id = $2 ${options.lock ? "for update" : ""}`, [tenantId, id]);
  const row = result.rows[0];
  return row === undefined ? null : toVehicle(row);
}

export async function findVehiclesByIds(db: Db, tenantId: string, ids: readonly string[]): Promise<Map<string, Vehicle>> {
  if (ids.length === 0) return new Map();
  const result = await db.query<Row>(`select ${VEHICLE_COLUMNS} from vehicles v where v.tenant_id = $1 and v.id = any($2::uuid[])`, [tenantId, [...new Set(ids)]]);
  return new Map(result.rows.map((row) => [row["id"] as string, toVehicle(row)]));
}

export async function listVehicles(db: Db, tenantId: string, filter: FleetFilter, limit: number, after: TimeCursor | null): Promise<Page<Vehicle> & { total: number }> {
  const where = `v.tenant_id = $1 and ($2::text is null or v.status = $2) and ($3::text is null or strpos(lower(v.plate), lower($3)) > 0 or strpos(lower(v.model), lower($3)) > 0)`;
  const params = [tenantId, filter.status, filter.q];
  const result = await db.query<Row>(
    `select ${VEHICLE_COLUMNS}, v.created_at::text as cursor_time from vehicles v where ${where}
        and ($4::timestamptz is null or (v.created_at, v.id) < ($4::timestamptz, $5::uuid))
      order by v.created_at desc, v.id desc limit $6`,
    [...params, after?.t ?? null, after?.id ?? null, limit + 1],
  );
  const total = await db.query<{ n: number }>(`select count(*)::int as n from vehicles v where ${where}`, params);
  return { ...toPage(result.rows, limit, toVehicle, (row) => ({ t: row["cursor_time"], id: row["id"] })), total: (total.rows[0] as { n: number }).n };
}

export async function listAvailableVehicles(db: Db, tenantId: string): Promise<Vehicle[]> {
  const result = await db.query<Row>(`select ${VEHICLE_COLUMNS} from vehicles v where v.tenant_id = $1 and v.status = 'available' order by v.plate, v.id`, [tenantId]);
  return result.rows.map(toVehicle);
}

export interface VehicleGroupFacts {
  id: string;
  grade: VehicleGrade;
  seats: number;
  status: string;
}

/** 车型组（平台主数据）：派车时比较等级和座位。 */
export async function findVehicleGroups(db: Db, ids: readonly string[]): Promise<Map<string, VehicleGroupFacts>> {
  if (ids.length === 0) return new Map();
  const result = await db.query<Row>("select id, grade, seats, status from vehicle_groups where id = any($1::uuid[])", [[...new Set(ids)]]);
  return new Map(result.rows.map((row) => [row["id"] as string, { id: row["id"], grade: row["grade"], seats: row["seats"], status: row["status"] }]));
}
