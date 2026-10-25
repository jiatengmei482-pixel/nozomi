/**
 * 派车（M3-02，ADR 0027）：供应商给订单指定司机和车辆、改派、司机链接、调度系统回传履约状态。
 * 需求「8. 订单与履约」（订单指派、改派、履约回传）、「履约规则（已确认）」（派车截止时间、改派只能同级或升级）、接口 `POST /orders/{id}:assign`、`GET /orders/{id}/assignable`、`POST /orders/{id}/events`。
 *
 * - 全部在租户事务里；别的供应商的单、没付款的单都当作不存在（404）。派车要带订单的版本号（If-Match），两个人同时派同一张单，后到的 409。
 * - 硬性条件（司机停用、证件过期、非营业牌照、降级、座位、司机语言）不满足：422 `ASSIGNMENT_MISMATCH`，逐项列出原因（@nozomi/domain 的 `assignmentIssues`）。
 * - 同一时段这位司机或这辆车已有别的单：409 `ASSIGNMENT_CONFLICT` 并列出那几单；调度确认后带 `confirm_conflicts: true` 再派（需求「提示冲突」）。
 *   判断冲突之前先拿司机和车辆的咨询锁：两张单同时派给同一位司机，后到的一定看得到先到的那一张。
 * - 派车 / 改派：记一条派车记录、一条状态流水、一条审计日志；旧的司机链接立即作废，发一个新的（原文只在这次应答里）；给供应商排一条 `order.assigned`（改派带 `change: true`）。
 * - 改派：已派车、司机已出发（还没到达）时可以改派；出发后改派回到「已派车」，新司机重新出发。司机到达上车点之后不能改派。
 */
import {
  ASSIGNMENT_ISSUE_MESSAGES,
  type AssignmentIssue,
  type VehicleGroupShape,
  driverAssignmentIssues,
  driverLinkExpiry,
  orderBusyWindow,
  vehicleAssignmentIssues,
  windowsOverlap,
} from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { type Db, withTenantTx } from "../db/context.ts";
import { AppError } from "../errors.ts";
import { newDriverToken } from "../auth/driver-token.ts";
import { type AuditValues, insertAuditLog } from "../repos/audit-logs.ts";
import { type DriverLink, currentDriverLink, insertAssignment, insertDriverLink, latestAssignmentId, listBusyOrders, lockFleetResource, revokeDriverLinks, updateFulfilment } from "../repos/dispatch.ts";
import { type Driver, type Vehicle, type VehicleGroupFacts, findDriver, findVehicle, findVehicleGroups, listActiveDrivers, listAvailableVehicles } from "../repos/fleet.ts";
import { type Order, findTenantOrder, insertOrderEvent } from "../repos/orders.ts";
import { validationFailed } from "../validation.ts";
import { consoleOrigin, tenantActor } from "./audit.ts";
import { notFound, versionConflict } from "./errors.ts";
import { type FulfilmentInput, applyFulfilmentEvent, orderStateInvalid } from "./fulfilment.ts";
import { enqueueTenantEvent } from "./tenant-webhooks.ts";
import type { TenantPrincipal } from "./tenant-auth.ts";

export interface DispatchWriter {
  principal: TenantPrincipal;
  ip: string;
}

/** 能派车（第一次）的状态和能改派的状态。 */
const ASSIGNABLE = new Set(["confirmed", "assigned", "departed"]);

async function lockOrder(db: Db, tenantId: string, orderId: string): Promise<Order> {
  const order = await findTenantOrder(db, tenantId, orderId, { lock: true });
  if (order === null) throw notFound("订单");
  return order;
}

function groupShape(group: VehicleGroupFacts): VehicleGroupShape {
  return { id: group.id, grade: group.grade, seats: group.seats };
}

export interface Conflict {
  resource: "driver" | "vehicle";
  /** 冲突的司机或车辆的编号 */
  resourceId: string;
  orderId: string;
  orderNo: string;
  serviceAt: Date;
}

/** 这些司机、车辆在这一单的时段里已有的别的单。 */
async function conflictsFor(db: Db, order: Order, driverIds: readonly string[], vehicleIds: readonly string[]): Promise<Conflict[]> {
  const window = orderBusyWindow(order.serviceAt, order.packageHours);
  // 粗筛：用车时间在前后一天之内的单（包车最长也在这个范围里），再按各自的时段精确判断
  const day = 36 * 3_600_000;
  const busy = await listBusyOrders(db, order.tenantId, { driverIds, vehicleIds, from: new Date(window.start.getTime() - day), to: new Date(window.end.getTime() + day), exceptOrderId: order.id });
  const conflicts: Conflict[] = [];
  for (const other of busy) {
    if (!windowsOverlap(window, orderBusyWindow(other.serviceAt, other.packageHours))) continue;
    if (other.driverId !== null && driverIds.includes(other.driverId)) conflicts.push({ resource: "driver", resourceId: other.driverId, orderId: other.orderId, orderNo: other.orderNo, serviceAt: other.serviceAt });
    if (other.vehicleId !== null && vehicleIds.includes(other.vehicleId)) conflicts.push({ resource: "vehicle", resourceId: other.vehicleId, orderId: other.orderId, orderNo: other.orderNo, serviceAt: other.serviceAt });
  }
  return conflicts;
}

function driverIssuesOf(order: Order, driver: Driver): AssignmentIssue[] {
  return driverAssignmentIssues({ serviceDate: order.serviceDate, driverLanguage: order.driverLanguage, driver: { status: driver.status, languages: driver.languages, licenseExpiresOn: driver.licenseExpiresOn } });
}

function vehicleIssuesOf(order: Order, ordered: VehicleGroupShape, vehicle: Vehicle, vehicleGroup: VehicleGroupShape): AssignmentIssue[] {
  return vehicleAssignmentIssues({
    serviceDate: order.serviceDate,
    orderedGroup: ordered,
    vehicle: { status: vehicle.status, plateType: vehicle.plateType, seats: vehicle.seats, insuranceExpiresOn: vehicle.insuranceExpiresOn, inspectionExpiresOn: vehicle.inspectionExpiresOn, group: vehicleGroup },
  });
}

export interface AssignableEntry<T> {
  item: T;
  issues: AssignmentIssue[];
  conflicts: Conflict[];
}

/**
 * 这一单可以派的司机和车辆（`GET /orders/{id}/assignable`）：在职的司机、可用的车辆，各自带上不符合的原因和同一时段的单。
 * 没有原因、没有冲突的才是「可派」；有原因的不能派，有冲突的可以在确认后派。
 */
export async function assignableResources(ctx: AppContext, tenantId: string, orderId: string): Promise<{ order: Order; drivers: AssignableEntry<Driver>[]; vehicles: AssignableEntry<Vehicle>[] }> {
  return withTenantTx(
    ctx.pool,
    tenantId,
    async (db) => {
      const order = await findTenantOrder(db, tenantId, orderId);
      if (order === null) throw notFound("订单");
      const drivers = await listActiveDrivers(db, tenantId);
      const vehicles = await listAvailableVehicles(db, tenantId);
      const groups = await findVehicleGroups(db, [order.vehicleGroupId, ...vehicles.map((vehicle) => vehicle.vehicleGroupId)]);
      const ordered = groupShape(groups.get(order.vehicleGroupId) as VehicleGroupFacts);
      const conflicts = await conflictsFor(db, order, drivers.map((driver) => driver.id), vehicles.map((vehicle) => vehicle.id));
      return {
        order,
        drivers: drivers.map((driver) => ({ item: driver, issues: driverIssuesOf(order, driver), conflicts: conflicts.filter((conflict) => conflict.resource === "driver" && conflict.resourceId === driver.id) })),
        vehicles: vehicles.map((vehicle) => ({
          item: vehicle,
          issues: vehicleIssuesOf(order, ordered, vehicle, groupShape(groups.get(vehicle.vehicleGroupId) as VehicleGroupFacts)),
          conflicts: conflicts.filter((conflict) => conflict.resource === "vehicle" && conflict.resourceId === vehicle.id),
        })),
      };
    },
    { snapshot: true },
  );
}

export function assignmentMismatch(issues: readonly AssignmentIssue[]): AppError {
  return new AppError(422, "ASSIGNMENT_MISMATCH", "这位司机或这辆车不符合订单的要求", { issues: issues.map((code) => ({ code, message: ASSIGNMENT_ISSUE_MESSAGES[code] })) });
}

function assignmentConflict(conflicts: readonly Conflict[]): AppError {
  return new AppError(409, "ASSIGNMENT_CONFLICT", "这位司机或这辆车在同一时段已有别的订单。确认没问题的话，带上 confirm_conflicts: true 再派一次", {
    conflicts: conflicts.map((conflict) => ({ resource: conflict.resource, resource_id: conflict.resourceId, order_id: conflict.orderId, order_no: conflict.orderNo, service_time: conflict.serviceAt.toISOString() })),
  });
}

export interface AssignInput {
  driverId: string;
  vehicleId: string;
  confirmConflicts: boolean;
}

export interface IssuedLink {
  link: DriverLink;
  /** 令牌原文：只在这一次应答里出现 */
  token: string;
}

export interface AssignResult {
  order: Order;
  driver: Driver;
  vehicle: Vehicle;
  /** 改派时带 true；同一位司机、同一辆车再派一次什么都不变，为 null */
  isChange: boolean | null;
  link: IssuedLink | null;
}

async function issueLink(db: Db, order: Order, assignmentId: string, driverId: string, now: Date): Promise<IssuedLink> {
  const { token, tokenHash } = newDriverToken(order.tenantId);
  const link = await insertDriverLink(db, order.tenantId, { orderId: order.id, assignmentId, driverId, tokenHash, createdAt: now, expiresAt: driverLinkExpiry(order.serviceAt, order.packageHours) });
  return { link, token };
}

function auditOrigin(writer: DispatchWriter, now: Date): ReturnType<typeof consoleOrigin> {
  return consoleOrigin(tenantActor(writer.principal.user), writer.ip, now);
}

/** 派车或改派（`POST /orders/{id}/assign`）。`version` 是订单的 If-Match 版本号。 */
export async function assignOrder(ctx: AppContext, writer: DispatchWriter, orderId: string, version: number, input: AssignInput): Promise<AssignResult> {
  const tenantId = writer.principal.tenantId;
  const now = ctx.now();
  return withTenantTx(ctx.pool, tenantId, async (db) => {
    const order = await lockOrder(db, tenantId, orderId);
    if (!ASSIGNABLE.has(order.status)) throw orderStateInvalid(order.status, "assign");
    if (order.version !== version) throw versionConflict(order.version);
    const isChange = order.status !== "confirmed";
    await lockFleetResource(db, tenantId, "driver", input.driverId);
    await lockFleetResource(db, tenantId, "vehicle", input.vehicleId);
    const driver = await findDriver(db, tenantId, input.driverId);
    const vehicle = await findVehicle(db, tenantId, input.vehicleId);
    if (driver === null || vehicle === null) {
      throw validationFailed("body", [
        ...(driver === null ? [{ path: "/driver_id", reason: "UNKNOWN", message: "司机不存在" }] : []),
        ...(vehicle === null ? [{ path: "/vehicle_id", reason: "UNKNOWN", message: "车辆不存在" }] : []),
      ]);
    }
    if (isChange && order.dispatch.driverId === driver.id && order.dispatch.vehicleId === vehicle.id) return { order, driver, vehicle, isChange: null, link: null };
    const groups = await findVehicleGroups(db, [order.vehicleGroupId, vehicle.vehicleGroupId]);
    const issues = [...driverIssuesOf(order, driver), ...vehicleIssuesOf(order, groupShape(groups.get(order.vehicleGroupId) as VehicleGroupFacts), vehicle, groupShape(groups.get(vehicle.vehicleGroupId) as VehicleGroupFacts))];
    if (issues.length > 0) throw assignmentMismatch(issues);
    const conflicts = await conflictsFor(db, order, [driver.id], [vehicle.id]);
    if (conflicts.length > 0 && !input.confirmConflicts) throw assignmentConflict(conflicts);
    const assignment = await insertAssignment(db, tenantId, { orderId, driverId: driver.id, vehicleId: vehicle.id, isChange, conflictConfirmed: conflicts.length > 0, assignedAt: now, actorType: "tenant_user", actorId: writer.principal.user.id });
    await updateFulfilment(db, tenantId, orderId, { status: "assigned", driverId: driver.id, vehicleId: vehicle.id, assignedAt: now, ...(order.status === "departed" ? { departedAt: null } : {}) }, now);
    await insertOrderEvent(db, order, {
      fromStatus: order.status,
      toStatus: "assigned",
      actor: "tenant_user",
      reason: isChange ? "REASSIGNED" : "ASSIGNED",
      occurredAt: now,
      detail: { assignment_id: assignment.id, driver_id: driver.id, vehicle_id: vehicle.id, user_id: writer.principal.user.id, conflict_confirmed: conflicts.length > 0 },
    });
    await revokeDriverLinks(db, tenantId, orderId, "reassigned", now);
    const link = await issueLink(db, order, assignment.id, driver.id, now);
    const before: AuditValues | null = isChange ? { driver_id: order.dispatch.driverId, vehicle_id: order.dispatch.vehicleId, status: order.status } : null;
    await insertAuditLog(db, auditOrigin(writer, now), { tenantId, resource: "order", resourceId: orderId, action: isChange ? "reassign" : "assign", before, after: { driver_id: driver.id, vehicle_id: vehicle.id, status: "assigned", conflict_confirmed: conflicts.length > 0 } });
    await enqueueTenantEvent(db, { tenantId, type: "order.assigned", orderId, data: { change: isChange } }, now);
    const saved = (await findTenantOrder(db, tenantId, orderId)) as Order;
    return { order: saved, driver, vehicle, isChange, link };
  });
}

/** 已经派了车、还没结束的单才有司机链接。 */
const LINKABLE = new Set(["assigned", "departed", "arrived", "in_service", "completed", "no_show_claimed"]);

/** 重新生成司机链接：旧的立即作废。原文只在这次应答里。 */
export async function reissueDriverLink(ctx: AppContext, writer: DispatchWriter, orderId: string): Promise<IssuedLink> {
  const tenantId = writer.principal.tenantId;
  const now = ctx.now();
  return withTenantTx(ctx.pool, tenantId, async (db) => {
    const order = await lockOrder(db, tenantId, orderId);
    if (!LINKABLE.has(order.status) || order.dispatch.driverId === null) throw orderStateInvalid(order.status, "reissue_driver_link");
    const current = await currentDriverLink(db, tenantId, orderId);
    if (current === null && order.dispatch.assignedAt === null) throw orderStateInvalid(order.status, "reissue_driver_link");
    if (driverLinkExpiry(order.serviceAt, order.packageHours).getTime() <= now.getTime()) throw new AppError(409, "DRIVER_LINK_EXPIRED", "用车结束已超过 24 小时，不能再生成司机链接");
    await revokeDriverLinks(db, tenantId, orderId, "reissued", now);
    const assignmentId = current?.assignmentId ?? (await latestAssignmentId(db, tenantId, orderId));
    if (assignmentId === null) throw orderStateInvalid(order.status, "reissue_driver_link");
    const issued = await issueLink(db, order, assignmentId, order.dispatch.driverId, now);
    await insertAuditLog(db, auditOrigin(writer, now), { tenantId, resource: "driver_link", resourceId: issued.link.id, action: "issue", before: current === null ? null : { link_id: current.id }, after: { order_id: orderId, expires_at: issued.link.expiresAt.toISOString() } });
    return issued;
  });
}

/** 吊销司机链接（司机换手机、链接发错人）：立即作废，之后可以重新生成。 */
export async function revokeDriverLink(ctx: AppContext, writer: DispatchWriter, orderId: string): Promise<void> {
  const tenantId = writer.principal.tenantId;
  const now = ctx.now();
  await withTenantTx(ctx.pool, tenantId, async (db) => {
    await lockOrder(db, tenantId, orderId);
    const current = await currentDriverLink(db, tenantId, orderId);
    if (current === null) throw notFound("司机链接");
    await revokeDriverLinks(db, tenantId, orderId, "manual", now);
    await insertAuditLog(db, auditOrigin(writer, now), { tenantId, resource: "driver_link", resourceId: current.id, action: "revoke", before: { order_id: orderId }, after: null });
  });
}

export async function currentLinkOf(ctx: AppContext, tenantId: string, orderId: string): Promise<DriverLink | null> {
  return withTenantTx(ctx.pool, tenantId, (db) => currentDriverLink(db, tenantId, orderId));
}

/** 调度系统回传履约状态（`POST /orders/{id}/events`）：和司机 H5 同一套规则。 */
export async function reportTenantFulfilment(ctx: AppContext, writer: DispatchWriter, orderId: string, input: FulfilmentInput): Promise<Order> {
  const tenantId = writer.principal.tenantId;
  const now = ctx.now();
  return withTenantTx(ctx.pool, tenantId, async (db) => {
    const order = await lockOrder(db, tenantId, orderId);
    await applyFulfilmentEvent(db, order, input, { type: "tenant_user", id: writer.principal.user.id, linkId: null }, now);
    const saved = (await findTenantOrder(db, tenantId, orderId)) as Order;
    await insertAuditLog(db, auditOrigin(writer, now), { tenantId, resource: "order", resourceId: orderId, action: "update", before: { status: order.status }, after: { status: saved.status, event: input.type } });
    return saved;
  });
}
