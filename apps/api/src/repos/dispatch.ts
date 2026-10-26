/**
 * 派车和履约的数据访问（M3-02，ADR 0027）：派车记录、司机链接、照片、联系记录、定位、no-show 申请，以及订单上派车和履约的那几列。
 * 都是租户表：供应商后台和司机 H5 都在租户事务里读写（司机的令牌里带着租户编号），每条查询都显式带 tenant_id。
 * 租户角色对订单只能改派车和履约的列（迁移 0026 的触发器按语句检查），这里的 update 只碰那几列。
 */
import type { LandingSource, NoShowChecklistItem, OrderStatus } from "@nozomi/domain";
import type { Db } from "../db/context.ts";

type Row = Record<string, any>;

// ---- 订单上的派车和履约 ----

export interface FulfilmentChange {
  status?: OrderStatus;
  driverId?: string;
  vehicleId?: string;
  assignedAt?: Date;
  departedAt?: Date | null;
  arrivedAt?: Date;
  arrivalDistanceM?: number | null;
  pickedUpAt?: Date;
  completedAt?: Date;
  actualMinutes?: number | null;
  actualKm?: number | null;
  leaveRequestedAt?: Date;
  driverLandedAt?: Date;
  driverLandedFileId?: string;
  landedAt?: Date;
  landedSource?: LandingSource;
}

const FULFILMENT_COLUMNS: Readonly<Record<keyof FulfilmentChange, string>> = {
  status: "status",
  driverId: "driver_id",
  vehicleId: "vehicle_id",
  assignedAt: "assigned_at",
  departedAt: "departed_at",
  arrivedAt: "arrived_at",
  arrivalDistanceM: "arrival_distance_m",
  pickedUpAt: "picked_up_at",
  completedAt: "completed_at",
  actualMinutes: "actual_minutes",
  actualKm: "actual_km",
  leaveRequestedAt: "leave_requested_at",
  driverLandedAt: "driver_landed_at",
  driverLandedFileId: "driver_landed_file_id",
  landedAt: "landed_at",
  landedSource: "landed_source",
};

/** 改订单上派车和履约的列（只改给了的），版本加一。列名来自上面的白名单，不拼接调用方的字符串。 */
export async function updateFulfilment(db: Db, tenantId: string, orderId: string, change: FulfilmentChange, now: Date): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [tenantId, orderId, now];
  for (const [key, column] of Object.entries(FULFILMENT_COLUMNS) as [keyof FulfilmentChange, string][]) {
    if (change[key] === undefined) continue;
    values.push(change[key]);
    sets.push(`${column} = $${values.length}`);
  }
  await db.query(`update orders set ${[...sets, "version = version + 1", "updated_at = $3"].join(", ")} where tenant_id = $1 and id = $2`, values);
}

/** 司机 / 车辆的咨询锁（事务结束自动释放）：两张单同时派给同一位司机时，后到的能看到先到的那一单，冲突提示不会漏。锁名带 schema，集成测试互不排队。 */
export async function lockFleetResource(db: Db, tenantId: string, kind: "driver" | "vehicle", id: string): Promise<void> {
  await db.query("select pg_advisory_xact_lock(hashtext(current_schema() || ':nozomi.fleet:' || $1 || ':' || $2 || ':' || $3))", [tenantId, kind, id]);
}

export interface BusyOrder {
  orderId: string;
  orderNo: string;
  driverId: string | null;
  vehicleId: string | null;
  serviceAt: Date;
  packageHours: number | null;
}

/** 这些司机或车辆在一段时间里（按用车时间粗筛）派着的、还没结束的单。不含 `exceptOrderId`。 */
export async function listBusyOrders(db: Db, tenantId: string, filter: { driverIds: readonly string[]; vehicleIds: readonly string[]; from: Date; to: Date; exceptOrderId: string }): Promise<BusyOrder[]> {
  const result = await db.query<Row>(
    `select id, order_no, driver_id, vehicle_id, service_at, package_hours from orders
      where tenant_id = $1 and id <> $2 and status in ('assigned', 'departed', 'arrived', 'in_service')
        and (driver_id = any($3::uuid[]) or vehicle_id = any($4::uuid[]))
        and service_at between $5 and $6
      order by service_at, id`,
    [tenantId, filter.exceptOrderId, [...filter.driverIds], [...filter.vehicleIds], filter.from, filter.to],
  );
  return result.rows.map((row) => ({ orderId: row["id"], orderNo: row["order_no"], driverId: row["driver_id"], vehicleId: row["vehicle_id"], serviceAt: row["service_at"], packageHours: row["package_hours"] }));
}

// ---- 派车记录 ----

export interface Assignment {
  id: string;
  orderId: string;
  driverId: string;
  vehicleId: string;
  isChange: boolean;
  conflictConfirmed: boolean;
  assignedAt: Date;
  actorType: "tenant_user" | "platform_user";
  actorId: string | null;
}

function toAssignment(row: Row): Assignment {
  return {
    id: row["id"],
    orderId: row["order_id"],
    driverId: row["driver_id"],
    vehicleId: row["vehicle_id"],
    isChange: row["is_change"],
    conflictConfirmed: row["conflict_confirmed"],
    assignedAt: row["assigned_at"],
    actorType: row["actor_type"],
    actorId: row["actor_id"],
  };
}

export async function insertAssignment(db: Db, tenantId: string, assignment: Omit<Assignment, "id">): Promise<Assignment> {
  const result = await db.query<Row>(
    `insert into order_assignments (tenant_id, order_id, driver_id, vehicle_id, is_change, conflict_confirmed, assigned_at, actor_type, actor_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`,
    [tenantId, assignment.orderId, assignment.driverId, assignment.vehicleId, assignment.isChange, assignment.conflictConfirmed, assignment.assignedAt, assignment.actorType, assignment.actorId],
  );
  return toAssignment(result.rows[0] as Row);
}

/** 这一单最近一次派车的记录编号；没派过为 null。 */
export async function latestAssignmentId(db: Db, tenantId: string, orderId: string): Promise<string | null> {
  const result = await db.query<Row>("select id from order_assignments where tenant_id = $1 and order_id = $2 order by seq desc limit 1", [tenantId, orderId]);
  return (result.rows[0]?.["id"] as string | undefined) ?? null;
}

export async function listAssignments(db: Db, tenantId: string, orderId: string): Promise<Assignment[]> {
  const result = await db.query<Row>("select * from order_assignments where tenant_id = $1 and order_id = $2 order by seq", [tenantId, orderId]);
  return result.rows.map(toAssignment);
}

// ---- 司机链接 ----

export interface DriverLink {
  id: string;
  orderId: string;
  assignmentId: string;
  driverId: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  revokeReason: "reassigned" | "reissued" | "manual" | null;
  lastUsedAt: Date | null;
}

const LINK_COLUMNS = "id, order_id, assignment_id, driver_id, created_at, expires_at, revoked_at, revoke_reason, last_used_at";

function toLink(row: Row): DriverLink {
  return {
    id: row["id"],
    orderId: row["order_id"],
    assignmentId: row["assignment_id"],
    driverId: row["driver_id"],
    createdAt: row["created_at"],
    expiresAt: row["expires_at"],
    revokedAt: row["revoked_at"],
    revokeReason: row["revoke_reason"],
    lastUsedAt: row["last_used_at"],
  };
}

export async function insertDriverLink(db: Db, tenantId: string, link: { orderId: string; assignmentId: string; driverId: string; tokenHash: string; createdAt: Date; expiresAt: Date }): Promise<DriverLink> {
  const result = await db.query<Row>(
    `insert into driver_links (tenant_id, order_id, assignment_id, driver_id, token_hash, created_at, expires_at) values ($1, $2, $3, $4, $5, $6, $7) returning ${LINK_COLUMNS}`,
    [tenantId, link.orderId, link.assignmentId, link.driverId, link.tokenHash, link.createdAt, link.expiresAt],
  );
  return toLink(result.rows[0] as Row);
}

/** 吊销这一单还有效的链接，返回吊销了几条。 */
export async function revokeDriverLinks(db: Db, tenantId: string, orderId: string, reason: "reassigned" | "reissued" | "manual", now: Date): Promise<number> {
  const result = await db.query("update driver_links set revoked_at = $3, revoke_reason = $4 where tenant_id = $1 and order_id = $2 and revoked_at is null", [tenantId, orderId, now, reason]);
  return result.rowCount ?? 0;
}

/** 这一单当前的链接（没吊销的那一条；可能已过期）。 */
export async function currentDriverLink(db: Db, tenantId: string, orderId: string): Promise<DriverLink | null> {
  const result = await db.query<Row>(`select ${LINK_COLUMNS} from driver_links where tenant_id = $1 and order_id = $2 and revoked_at is null order by created_at desc limit 1`, [tenantId, orderId]);
  const row = result.rows[0];
  return row === undefined ? null : toLink(row);
}

export async function findDriverLinkByToken(db: Db, tenantId: string, tokenHash: string): Promise<DriverLink | null> {
  const result = await db.query<Row>(`select ${LINK_COLUMNS} from driver_links where tenant_id = $1 and token_hash = $2`, [tenantId, tokenHash]);
  const row = result.rows[0];
  return row === undefined ? null : toLink(row);
}

export async function touchDriverLink(db: Db, tenantId: string, linkId: string, now: Date): Promise<void> {
  await db.query("update driver_links set last_used_at = $3 where tenant_id = $1 and id = $2", [tenantId, linkId, now]);
}

// ---- 照片 ----

/** 到达屏、举牌、联系客人的截图（司机 H5，M3-02）；票据（停车费、高速费的凭证，司机 H5 或供应商后台，M3-03） */
export type OrderFileKind = "arrival_screen" | "signboard" | "contact_screenshot" | "receipt";

export interface OrderFile {
  id: string;
  orderId: string;
  kind: OrderFileKind;
  contentType: string;
  byteSize: number;
  sha256: string;
  uploadedAt: Date;
}

const FILE_COLUMNS = "id, order_id, kind, content_type, byte_size, sha256, uploaded_at";

function toFile(row: Row): OrderFile {
  return { id: row["id"], orderId: row["order_id"], kind: row["kind"], contentType: row["content_type"], byteSize: row["byte_size"], sha256: row["sha256"], uploadedAt: row["uploaded_at"] };
}

/** 存一张照片。谁传的二选一：司机链接（`linkId`），或供应商后台的用户（`uploadedBy`）。 */
export async function insertOrderFile(db: Db, tenantId: string, file: { orderId: string; kind: OrderFileKind; contentType: string; data: Buffer; sha256: string; uploadedAt: Date; linkId: string | null; uploadedBy?: string | null }): Promise<OrderFile> {
  const result = await db.query<Row>(
    `insert into order_files (tenant_id, order_id, kind, content_type, byte_size, sha256, data, uploaded_at, link_id, uploaded_by) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning ${FILE_COLUMNS}`,
    [tenantId, file.orderId, file.kind, file.contentType, file.data.length, file.sha256, file.data, file.uploadedAt, file.linkId, file.uploadedBy ?? null],
  );
  return toFile(result.rows[0] as Row);
}

export async function listOrderFiles(db: Db, tenantId: string, orderId: string): Promise<OrderFile[]> {
  const result = await db.query<Row>(`select ${FILE_COLUMNS} from order_files where tenant_id = $1 and order_id = $2 order by uploaded_at, id`, [tenantId, orderId]);
  return result.rows.map(toFile);
}

export async function findOrderFile(db: Db, tenantId: string, orderId: string, fileId: string): Promise<(OrderFile & { data: Buffer }) | null> {
  const result = await db.query<Row>(`select ${FILE_COLUMNS}, data from order_files where tenant_id = $1 and order_id = $2 and id = $3`, [tenantId, orderId, fileId]);
  const row = result.rows[0];
  return row === undefined ? null : { ...toFile(row), data: row["data"] };
}

// ---- 联系记录 ----

export interface OrderContact {
  id: string;
  method: "phone" | "messaging";
  fileId: string | null;
  note: string | null;
  occurredAt: Date;
}

export async function insertOrderContact(db: Db, tenantId: string, contact: { orderId: string; method: "phone" | "messaging"; fileId: string | null; note: string | null; occurredAt: Date; linkId: string }): Promise<OrderContact> {
  const result = await db.query<Row>(
    "insert into order_contacts (tenant_id, order_id, method, file_id, note, occurred_at, link_id) values ($1, $2, $3, $4, $5, $6, $7) returning id, method, file_id, note, occurred_at",
    [tenantId, contact.orderId, contact.method, contact.fileId, contact.note, contact.occurredAt, contact.linkId],
  );
  const row = result.rows[0] as Row;
  return { id: row["id"], method: row["method"], fileId: row["file_id"], note: row["note"], occurredAt: row["occurred_at"] };
}

export async function listOrderContacts(db: Db, tenantId: string, orderId: string): Promise<OrderContact[]> {
  const result = await db.query<Row>("select id, method, file_id, note, occurred_at from order_contacts where tenant_id = $1 and order_id = $2 order by occurred_at, id", [tenantId, orderId]);
  return result.rows.map((row) => ({ id: row["id"], method: row["method"], fileId: row["file_id"], note: row["note"], occurredAt: row["occurred_at"] }));
}

// ---- 定位 ----

export type LocationKind = "departed" | "arrived" | "picked_up" | "completed" | "leave_requested" | "no_show" | "ping";

export interface OrderLocation {
  kind: LocationKind;
  lng: number;
  lat: number;
  accuracyM: number | null;
  recordedAt: Date;
}

export async function insertOrderLocation(db: Db, tenantId: string, orderId: string, location: OrderLocation, linkId: string | null): Promise<void> {
  await db.query("insert into order_locations (tenant_id, order_id, kind, lng, lat, accuracy_m, recorded_at, link_id) values ($1, $2, $3, $4, $5, $6, $7, $8)", [
    tenantId, orderId, location.kind, location.lng, location.lat, location.accuracyM, location.recordedAt, linkId,
  ]);
}

export async function listOrderLocations(db: Db, tenantId: string, orderId: string, limit = 500): Promise<OrderLocation[]> {
  const result = await db.query<Row>("select kind, lng::float8 as lng, lat::float8 as lat, accuracy_m, recorded_at from order_locations where tenant_id = $1 and order_id = $2 order by seq desc limit $3", [tenantId, orderId, limit]);
  return result.rows.reverse().map((row) => ({ kind: row["kind"], lng: row["lng"], lat: row["lat"], accuracyM: row["accuracy_m"], recordedAt: row["recorded_at"] }));
}

// ---- no-show 申请 ----

export interface NoShowClaim {
  submittedAt: Date;
  checklist: NoShowChecklistItem[];
  freeWaitStart: Date;
  freeWaitEnd: Date;
  status: "pending_review";
}

export async function insertNoShowClaim(db: Db, tenantId: string, orderId: string, claim: NoShowClaim, linkId: string): Promise<void> {
  await db.query(
    "insert into order_no_show_claims (tenant_id, order_id, submitted_at, checklist, free_wait_start, free_wait_end, status, link_id) values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)",
    [tenantId, orderId, claim.submittedAt, JSON.stringify(claim.checklist), claim.freeWaitStart, claim.freeWaitEnd, claim.status, linkId],
  );
}

export async function findNoShowClaim(db: Db, tenantId: string, orderId: string): Promise<NoShowClaim | null> {
  const result = await db.query<Row>("select submitted_at, checklist, free_wait_start, free_wait_end, status from order_no_show_claims where tenant_id = $1 and order_id = $2", [tenantId, orderId]);
  const row = result.rows[0];
  return row === undefined ? null : { submittedAt: row["submitted_at"], checklist: row["checklist"], freeWaitStart: row["free_wait_start"], freeWaitEnd: row["free_wait_end"], status: row["status"] };
}

// ---- 上车点、地点和附加服务的名字（司机页面用） ----

export interface PlaceFacts {
  id: string;
  type: string;
  code: string | null;
  name: Record<string, string>;
  lng: number;
  lat: number;
}

export async function findPlace(db: Db, placeId: string): Promise<PlaceFacts | null> {
  const result = await db.query<Row>("select id, type, code, name, lng::float8 as lng, lat::float8 as lat from places where id = $1", [placeId]);
  const row = result.rows[0];
  return row === undefined ? null : { id: row["id"], type: row["type"], code: row["code"], name: row["name"], lng: row["lng"], lat: row["lat"] };
}

export async function findAddonNames(db: Db, ids: readonly string[]): Promise<Map<string, Record<string, string>>> {
  if (ids.length === 0) return new Map();
  const result = await db.query<Row>("select id, name from addons where id = any($1::uuid[])", [[...new Set(ids)]]);
  return new Map(result.rows.map((row) => [row["id"] as string, row["name"] as Record<string, string>]));
}

export async function listDispatchers(db: Db, tenantId: string, productId: string): Promise<{ name: string; phone: string }[]> {
  const result = await db.query<Row>("select name, phone from product_dispatchers where tenant_id = $1 and product_id = $2 order by position", [tenantId, productId]);
  return result.rows.map((row) => ({ name: row["name"], phone: row["phone"] }));
}
