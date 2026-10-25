/**
 * 司机 H5（M3-02，ADR 0027）：司机凭派车时生成的链接看这一单、回传履约、填落地时间、记联系客人、申请离开、提交 no-show。
 * 需求「14. 补充功能」（司机 H5：看订单、一键导航、出发 / 到达 / 接到 / 完成、自动上报定位、拍照上传凭证和 no-show 证据；链接用车后 24 小时失效）、
 * 「落地时间」「客人未出现」、《平台运营端》「免费等待与 no-show」（5 项证据）、第五轮决策 ③。
 *
 * - 没有账号：令牌里带着租户编号，直接进入那个租户的事务（行级安全之内）按令牌的哈希找链接。令牌不存在、被吊销（改派、重新生成、手动）、
 *   过期，一律 401 `DRIVER_LINK_INVALID`（不说是哪一种）。一个链接只对应一张单：接口路径里没有订单编号，拿着这一单的令牌碰不到别的单。
 * - 司机页面里**没有任何价格**（结算价、对外价、加价比例都不给）。乘客的姓名、电话、航班号、上下车点、时间、附加服务、备注是司机干活要用的。
 * - 时间一律用系统收到的时间（照片上的「系统时间」也是收到照片的时间），不认手机时钟。
 */
import { createHash } from "node:crypto";
import {
  EVIDENCE_FILE_RULES,
  type FreeWaitWindow,
  type NoShowChecklist,
  detectEvidenceType,
  effectiveLanding,
  freeWaitEnded,
  freeWaitWindow,
  landingReportIssue,
  noShowChecklist,
  orderStatusIsFinal,
} from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { type Db, withTenantTx } from "../db/context.ts";
import { AppError } from "../errors.ts";
import { hashDriverToken, tenantIdOfDriverToken } from "../auth/driver-token.ts";
import {
  type DriverLink,
  type NoShowClaim,
  type OrderContact,
  type OrderFile,
  type OrderFileKind,
  findAddonNames,
  findDriverLinkByToken,
  findNoShowClaim,
  findOrderFile,
  findPlace,
  insertNoShowClaim,
  insertOrderContact,
  insertOrderFile,
  insertOrderLocation,
  listDispatchers,
  listOrderContacts,
  listOrderFiles,
  touchDriverLink,
  updateFulfilment,
} from "../repos/dispatch.ts";
import { type Driver, type Vehicle, findDriver, findVehicle } from "../repos/fleet.ts";
import { type Order, findTenantOrder } from "../repos/orders.ts";
import { validationFailed } from "../validation.ts";
import { type FulfilmentInput, type ReportedLocation, applyFulfilmentEvent, orderStateInvalid, pickupPoint, recordStatusChange } from "./fulfilment.ts";
import { orderLanding, orderLandingApplies } from "./order-views.ts";

export function driverLinkInvalid(): AppError {
  return new AppError(401, "DRIVER_LINK_INVALID", "链接无效或已过期，请联系调度重新发送");
}

export interface DriverSession {
  tenantId: string;
  link: DriverLink;
}

/** 在令牌所属的租户事务里找到链接并核对：存在、没吊销、没过期、还是这一单现在的司机。通过后在同一个事务里做 `fn`。 */
async function withDriver<T>(ctx: AppContext, token: string | null, fn: (db: Db, session: DriverSession, order: Order) => Promise<T>): Promise<T> {
  const tenantId = token === null ? null : tenantIdOfDriverToken(token);
  if (token === null || tenantId === null) throw driverLinkInvalid();
  const now = ctx.now();
  return withTenantTx(ctx.pool, tenantId, async (db) => {
    const link = await findDriverLinkByToken(db, tenantId, hashDriverToken(token));
    if (link === null || link.revokedAt !== null || link.expiresAt.getTime() <= now.getTime()) throw driverLinkInvalid();
    const order = await findTenantOrder(db, tenantId, link.orderId, { lock: true });
    if (order === null || order.dispatch.driverId !== link.driverId) throw driverLinkInvalid();
    await touchDriverLink(db, tenantId, link.id, now);
    return fn(db, { tenantId, link }, order);
  });
}

/** 免费等待：接机从实际落地时间起算，其他从用车时间起算。 */
export function orderFreeWait(order: Order): FreeWaitWindow {
  const landing = orderLanding(order);
  return freeWaitWindow(landing?.landedAt ?? order.serviceAt, order.freeWaitMinutes);
}

async function checklistOf(db: Db, order: Order, now: Date): Promise<NoShowChecklist> {
  const files = await listOrderFiles(db, order.tenantId, order.id);
  const contacts = await listOrderContacts(db, order.tenantId, order.id);
  const signboard = files.filter((file) => file.kind === "signboard").at(-1) ?? null;
  return noShowChecklist({
    serviceAt: order.serviceAt,
    freeWait: orderFreeWait(order),
    arrivedAt: order.dispatch.arrivedAt,
    arrivalDistanceMeters: order.dispatch.arrivalDistanceM,
    contactAttempts: contacts.map((contact) => contact.occurredAt),
    signboardPhotoAt: signboard?.uploadedAt ?? null,
    leaveRequestedAt: order.dispatch.leaveRequestedAt,
    now,
  });
}

export interface TripView {
  order: Order;
  driver: Driver | null;
  vehicle: Vehicle | null;
  link: DriverLink;
  place: { name: Record<string, string>; code: string | null; lng: number; lat: number } | null;
  /** 上车点的坐标（一键导航、到达时算距离用）：接机是机场，其他是客人填的上车点 */
  pickup: { lng: number; lat: number } | null;
  addonNames: Map<string, Record<string, string>>;
  dispatchers: { name: string; phone: string }[];
  files: OrderFile[];
  contacts: OrderContact[];
  freeWait: FreeWaitWindow;
  checklist: NoShowChecklist;
  claim: NoShowClaim | null;
  now: Date;
}

async function tripView(db: Db, session: DriverSession, order: Order, now: Date): Promise<TripView> {
  const { tenantId } = session;
  const fresh = (await findTenantOrder(db, tenantId, order.id)) as Order;
  const place = fresh.placeId === null ? null : await findPlace(db, fresh.placeId);
  return {
    order: fresh,
    driver: fresh.dispatch.driverId === null ? null : await findDriver(db, tenantId, fresh.dispatch.driverId),
    vehicle: fresh.dispatch.vehicleId === null ? null : await findVehicle(db, tenantId, fresh.dispatch.vehicleId),
    link: session.link,
    place: place === null ? null : { name: place.name, code: place.code, lng: place.lng, lat: place.lat },
    pickup: await pickupPoint(db, fresh),
    addonNames: await findAddonNames(db, fresh.addons.map((addon) => addon.addonId)),
    dispatchers: await listDispatchers(db, tenantId, fresh.productId),
    files: await listOrderFiles(db, tenantId, fresh.id),
    contacts: await listOrderContacts(db, tenantId, fresh.id),
    freeWait: orderFreeWait(fresh),
    checklist: await checklistOf(db, fresh, now),
    claim: await findNoShowClaim(db, tenantId, fresh.id),
    now,
  };
}

export async function getTrip(ctx: AppContext, token: string | null): Promise<TripView> {
  const now = ctx.now();
  return withDriver(ctx, token, (db, session, order) => tripView(db, session, order, now));
}

/** 出发、到达、接到客人、完成。 */
export async function reportDriverEvent(ctx: AppContext, token: string | null, input: FulfilmentInput): Promise<TripView> {
  const now = ctx.now();
  return withDriver(ctx, token, async (db, session, order) => {
    await applyFulfilmentEvent(db, order, input, { type: "driver", id: session.link.id, linkId: session.link.id }, now);
    return tripView(db, session, order, now);
  });
}

/** 服务中定时上报定位（出发后到完成前）。 */
export async function reportDriverLocation(ctx: AppContext, token: string | null, location: ReportedLocation): Promise<void> {
  const now = ctx.now();
  await withDriver(ctx, token, async (db, session, order) => {
    if (!["departed", "arrived", "in_service"].includes(order.status)) throw orderStateInvalid(order.status, "location");
    await insertOrderLocation(db, session.tenantId, order.id, { kind: "ping", ...location, recordedAt: now }, session.link.id);
  });
}

const UPLOAD_KINDS = new Set<OrderFileKind>(["arrival_screen", "signboard", "contact_screenshot"]);

export function fileTooLarge(): AppError {
  return new AppError(413, "FILE_TOO_LARGE", `照片太大了（最大 ${EVIDENCE_FILE_RULES.maxBytes / 1024 / 1024} MB）`, { max_bytes: EVIDENCE_FILE_RULES.maxBytes });
}

/** 上传一张照片。按文件开头的字节判断格式，和声明的类型不一致、不是认的格式都拒绝（415）。订单结束后不能再传。 */
export async function uploadDriverFile(ctx: AppContext, token: string | null, kind: OrderFileKind, declaredType: string | undefined, data: Buffer): Promise<OrderFile> {
  if (!UPLOAD_KINDS.has(kind)) throw validationFailed("querystring", [{ path: "/kind", message: "只能是 arrival_screen、signboard、contact_screenshot" }]);
  if (data.length === 0) throw validationFailed("body", [{ path: "/", reason: "REQUIRED", message: "没有收到照片" }]);
  if (data.length > EVIDENCE_FILE_RULES.maxBytes) throw fileTooLarge();
  const detected = detectEvidenceType(data);
  const declared = (declaredType ?? "").split(";")[0]?.trim().toLowerCase();
  if (detected === null || detected !== declared) throw new AppError(415, "UNSUPPORTED_MEDIA_TYPE", "只能上传 JPEG、PNG、WebP 或 HEIC 格式的照片，且请求头 Content-Type 要和文件一致", { accepted: [...EVIDENCE_FILE_RULES.contentTypes] });
  const now = ctx.now();
  return withDriver(ctx, token, async (db, session, order) => {
    if (orderStatusIsFinal(order.status)) throw orderStateInvalid(order.status, "upload");
    return insertOrderFile(db, session.tenantId, { orderId: order.id, kind, contentType: detected, data, sha256: createHash("sha256").update(data).digest("hex"), uploadedAt: now, linkId: session.link.id });
  });
}

export async function readDriverFile(ctx: AppContext, token: string | null, fileId: string): Promise<OrderFile & { data: Buffer }> {
  return withDriver(ctx, token, async (db, session, order) => {
    const file = await findOrderFile(db, session.tenantId, order.id, fileId);
    if (file === null) throw new AppError(404, "NOT_FOUND", "照片不存在");
    return file;
  });
}

export function landingAlreadyReported(): AppError {
  return new AppError(409, "LANDING_ALREADY_REPORTED", "落地时间已经提交过，不能修改（有争议请联系客服走工单）");
}

const LANDING_REPORT_STATUSES = new Set(["assigned", "departed", "arrived", "in_service"]);

const LANDING_ISSUE_MESSAGES = { IN_FUTURE: "落地时间不能晚于现在", TOO_EARLY: "落地时间比计划到达早了 3 小时以上，请检查" } as const;

/** 写入按规则取定的落地时间和来源（客人确认、司机填写之后都重新取定一次）。 */
export function landingChange(order: Order, reports: { guestLandedAt: Date | null; driverLandedAt: Date | null; driverHasPhoto: boolean }): { landedAt: Date; landedSource: "guest" | "driver" | "scheduled" } {
  const result = effectiveLanding({
    scheduledAt: order.serviceAt,
    guestReportedAt: reports.guestLandedAt,
    driver: reports.driverLandedAt === null ? null : { landedAt: reports.driverLandedAt, arrivalScreenPhoto: reports.driverHasPhoto },
  });
  return { landedAt: result.landedAt, landedSource: result.source };
}

/**
 * 司机填写实际落地时间：只有接机单；必须附一张这一单的到达屏照片（`arrival_screen`）；提交后不能改；时间不能晚于现在、不能比计划早 3 小时以上。
 * 写入后按规则重新取定这一单的落地时间（客人确认优先，不一致取较晚者）。
 */
export async function reportDriverLanding(ctx: AppContext, token: string | null, input: { landedAt: Date; fileId: string }): Promise<TripView> {
  const now = ctx.now();
  return withDriver(ctx, token, async (db, session, order) => {
    if (!orderLandingApplies(order)) throw new AppError(409, "LANDING_NOT_APPLICABLE", "这一单不是接机，不需要填落地时间");
    if (!LANDING_REPORT_STATUSES.has(order.status)) throw orderStateInvalid(order.status, "landing");
    if (order.dispatch.driverLandedAt !== null) throw landingAlreadyReported();
    const file = await findOrderFile(db, session.tenantId, order.id, input.fileId);
    if (file === null || file.kind !== "arrival_screen") throw validationFailed("body", [{ path: "/file_id", reason: "ARRIVAL_SCREEN_REQUIRED", message: "要先拍一张到达屏的照片（显示这个航班已到达）" }]);
    const issue = landingReportIssue(input.landedAt, order.serviceAt, now);
    if (issue !== null) throw validationFailed("body", [{ path: "/landed_at", reason: issue, message: LANDING_ISSUE_MESSAGES[issue] }]);
    const settled = landingChange(order, { guestLandedAt: order.dispatch.guestLandedAt, driverLandedAt: input.landedAt, driverHasPhoto: true });
    await updateFulfilment(db, session.tenantId, order.id, { driverLandedAt: input.landedAt, driverLandedFileId: file.id, ...settled }, now);
    return tripView(db, session, order, now);
  });
}

/** 记一次联系客人（电话或即时通讯，可附截图）。只在司机到达后、提交 no-show 之前。 */
export async function addDriverContact(ctx: AppContext, token: string | null, input: { method: "phone" | "messaging"; note: string | null; fileId: string | null }): Promise<TripView> {
  const now = ctx.now();
  return withDriver(ctx, token, async (db, session, order) => {
    if (order.status !== "arrived") throw orderStateInvalid(order.status, "contact");
    if (input.fileId !== null) {
      const file = await findOrderFile(db, session.tenantId, order.id, input.fileId);
      if (file === null || file.kind !== "contact_screenshot") throw validationFailed("body", [{ path: "/file_id", reason: "UNKNOWN", message: "截图不存在" }]);
    }
    await insertOrderContact(db, session.tenantId, { orderId: order.id, method: input.method, fileId: input.fileId, note: input.note, occurredAt: now, linkId: session.link.id });
    return tripView(db, session, order, now);
  });
}

/** 申请离开（no-show 第 4 项）：免费等待结束后才能申请；只能申请一次。客服 10 分钟内没处理视为同意（客服的处理在 M4-02）。 */
export async function requestLeave(ctx: AppContext, token: string | null, location: ReportedLocation | null): Promise<TripView> {
  const now = ctx.now();
  return withDriver(ctx, token, async (db, session, order) => {
    if (order.status !== "arrived") throw orderStateInvalid(order.status, "request_leave");
    if (order.dispatch.leaveRequestedAt !== null) throw new AppError(409, "LEAVE_ALREADY_REQUESTED", "已经申请过离开");
    const window = orderFreeWait(order);
    if (!freeWaitEnded(window, now)) {
      throw new AppError(409, "FREE_WAIT_NOT_ENDED", window.end === null ? "这一单是无限免费等待，不能申请离开，请联系调度" : "免费等待还没结束，结束后才能申请离开", { free_wait_ends_at: window.end?.toISOString() ?? null });
    }
    await updateFulfilment(db, session.tenantId, order.id, { leaveRequestedAt: now }, now);
    if (location !== null) await insertOrderLocation(db, session.tenantId, order.id, { kind: "leave_requested", ...location, recordedAt: now }, session.link.id);
    return tripView(db, session, order, now);
  });
}

export function noShowIncomplete(checklist: NoShowChecklist): AppError {
  return new AppError(422, "NO_SHOW_EVIDENCE_INCOMPLETE", "no-show 的 5 项证据还不齐，不能提交", {
    missing: checklist.items.filter((entry) => !entry.ok).map((entry) => entry.item),
    checklist: checklist.items,
  });
}

/** 提交 no-show：5 项证据都满足才能提交（不满足的逐项列出）；提交后订单变成「客人未出现（待审核）」，等平台审核（M4-02）。 */
export async function submitNoShow(ctx: AppContext, token: string | null, location: ReportedLocation | null): Promise<TripView> {
  const now = ctx.now();
  return withDriver(ctx, token, async (db, session, order) => {
    if (order.status !== "arrived") throw orderStateInvalid(order.status, "no_show");
    const checklist = await checklistOf(db, order, now);
    if (!checklist.complete) throw noShowIncomplete(checklist);
    const window = orderFreeWait(order);
    await insertNoShowClaim(db, session.tenantId, order.id, { submittedAt: now, checklist: checklist.items, freeWaitStart: window.start, freeWaitEnd: window.end as Date, status: "pending_review" }, session.link.id);
    await updateFulfilment(db, session.tenantId, order.id, { status: "no_show_claimed" }, now);
    if (location !== null) await insertOrderLocation(db, session.tenantId, order.id, { kind: "no_show", ...location, recordedAt: now }, session.link.id);
    await recordStatusChange(db, order, "no_show_claimed", { type: "driver", detail: { link_id: session.link.id } }, "NO_SHOW_CLAIMED", now);
    return tripView(db, session, order, now);
  });
}
