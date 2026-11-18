/**
 * 人工报价申请（M8-21，ADR 0076）：官网一家都报不出价时客人留下邮箱或 WhatsApp，客服在运营后台跟进；以及官网设置（客服 WhatsApp 号码）。
 *
 * - 提交（`/site/v1`）：按地址、联系方式、全站三层限速；同一个联系方式、同一个行程 24 小时内只记一次；应答一律 202，不说是不是重复。
 *   联系方式和两端地点一份密文（乘客信息的方案，ADR 0057），没配主密钥时 503，不存明文。不发任何邮件。
 * - 运营后台：列表没有个人信息；打开详情才解密，每次留审计（`view_passenger`）；指派、改状态、写备注各留审计（内容不进审计）。
 * - 清除：结束 180 天、提交 365 天后清空密文、盲索引和备注（`ManualQuoteRetentionJobs`，每小时一轮，每批一条审计）。
 * - 不写进 M8-20 的「未覆盖需求」：以后那边加一列可空的申请编号指过来，个人信息只在这里。
 * - 验收留资（M8-39，ADR 0078 补充）：带有效验收会话提交的记成 `is_acceptance`（由接口层按会话判断，库里建好后不能改）；
 *   去重和真实客人的分开；运营后台列表和各状态的数量默认不算它，按筛选参数才列出来。
 * - 带行程单（M9T-08，ADR 0101 第十二节第 2 条）：可选的行程单编号要是这个官网渠道、还可读、验收标记和这次提交一致的，否则 400 `/trip_id` NOT_FOUND
 *   （不说是哪一种）；链接行和申请同一个事务写入；各点名称加密在联系方式的密文里。行程单编号是客人的访问凭证，不进日志、审计。
 *   运营后台详情凭它显示整张行程单和最近一次报价；行程单被清理（建单 30 天，M9T-05）后显示「已清理」。
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  MANUAL_QUOTE_FINISHED,
  MANUAL_QUOTE_RULES,
  type ManualQuotePlace,
  type ManualQuoteWaypoint,
  type ManualQuoteStatus,
  type ManualQuoteTrip,
  grantCan,
  isPlaceIdPlace,
  manualQuoteEmail,
  manualQuotePurgeCutoffs,
  manualQuoteStatusChangeAllowed,
  resolvePlatformGrant,
  scopeAllowsChannel,
  scopeAllowsCity,
  whatsappDigits,
} from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { type Db, passengerCryptoOfPool, withPlatformTx } from "../db/context.ts";
import { driverErrorCode } from "../db/pool.ts";
import { AppError } from "../errors.ts";
import { passengerEncryptionNotConfigured } from "../integrations/passenger-crypto.ts";
import { type AuditOrigin, insertAuditLog } from "../repos/audit-logs.ts";
import { type StoredTripPlan, type TripRow, findReadableTrip, findTripForStaff, listTripPlans } from "../repos/trips.ts";
import {
  type ManualQuoteAcceptanceFilter,
  type ManualQuoteEventRow,
  type ManualQuoteFilter,
  type ManualQuoteRow,
  type SitePageWidth,
  type SiteSettingsRow,
  cityExists,
  countManualQuotesByStatus,
  findManualQuote,
  findManualQuoteTripLink,
  hasRecentDuplicate,
  insertManualQuote,
  insertManualQuoteEvent,
  insertManualQuoteTripLink,
  listActiveStaffWithRoles,
  listManualQuoteEvents,
  listManualQuotes,
  lockPurgeCandidates,
  purgeManualQuotes,
  readSiteSettings,
  readPublicSiteSettings,
  saveSiteSettings,
  touchManualQuote,
  updateManualQuote,
} from "../repos/manual-quotes.ts";
import { type Page, type TimeCursor, toPage } from "../pagination.ts";
import { type InputIssue, validationFailed } from "../validation.ts";
import { consoleOrigin, platformActor } from "./audit.ts";
import { notFound, versionConflict } from "./errors.ts";
import type { PlatformPrincipal } from "./platform-auth.ts";
import { rateLimited, takeRateSlot } from "./rate-limit.ts";
import { requireOpenSite } from "./site.ts";

// ---- 客人提交 ----

export interface ManualQuoteSubmission {
  /** 已规范化（`manualQuoteEmail`）；没填为 null */
  email: string | null;
  /** 纯数字（`whatsappDigits`）；没填为 null */
  whatsapp: string | null;
  cityId: string | null;
  trip: ManualQuoteTrip;
  /** 带有效验收会话提交的（接口层用 `siteAudienceOf` 判断；production 永远是 false） */
  acceptance: boolean;
  /** 从行程报价页转人工时带的行程单（M9T-08）；没有为 null。`trip` 仍是第一天的一段 */
  tripRef: ManualQuoteTripRef | null;
}

/** 申请带的行程单（M9T-08）。`tripId` 是客人访问行程单的凭证：不写日志、不进审计。 */
export interface ManualQuoteTripRef {
  tripId: string;
  planKind: "one_car" | "daily_best" | null;
  /** 每天、每个点在客人页面上的名称（行程单只存坐标、地点编号）；没有的点为 null，没给为 null */
  labels: (string | null)[][] | null;
}

/** 密文里的内容：联系方式、两端地点和包车的经停点（M9W-04；没有经停点时不写这一项，M9W-04 之前的也没有）。 */
interface SealedContact {
  email: string | null;
  whatsapp: string | null;
  pickup: ManualQuotePlace;
  dropoff: ManualQuotePlace | null;
  waypoints?: ManualQuoteWaypoint[];
  /** 行程单各点的名称（M9T-08，按天、按点）；没带行程单或没给名称时不写这一项 */
  tripLabels?: (string | null)[][];
}

const NO_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function newRequestNo(now: Date): string {
  const day = now.toISOString().slice(0, 10).replaceAll("-", "");
  const tail = [...randomBytes(8)].map((byte) => NO_CHARS[byte % NO_CHARS.length]).join("");
  return `MQ${day}${tail}`;
}

/**
 * 去重比的行程要点：坐标按 4 位小数（约 10 米），地点名称不算（同一个点换个写法还是同一个行程）。
 * 有经停点时（M9W-04）再加上经停点的坐标和停留；没有经停点时和以前完全一样。
 */
function tripKey(trip: ManualQuoteTrip): string {
  const point = (place: ManualQuotePlace | null) => (place === null ? null : [place.lat.toFixed(4), place.lng.toFixed(4)]);
  const parts: unknown[] = [trip.category, point(trip.pickup), point(trip.dropoff), trip.serviceLocal, trip.passengers, trip.luggage, trip.packageHours];
  // 指定到达时间（M9P-20 P3）只在给了时加进去：没指定的行程键和以前一样
  if (trip.waypoints.length > 0) parts.push(trip.waypoints.map((stop) => (stop.arriveBy === undefined ? [point(stop), stop.stayMinutes] : [point(stop), stop.stayMinutes, `${stop.arriveBy.day_offset}+${stop.arriveBy.time}`])));
  return JSON.stringify(parts);
}

/** 占一次按联系方式、全站的额度：单独的事务先提交，后面出错这一次照样算数。 */
async function takeSlot(ctx: AppContext, bucket: string, scope: "site_manual_quote_contact" | "site_manual_quote_all"): Promise<void> {
  const decision = await withPlatformTx(ctx.pool, (db) => takeRateSlot(db, createHash("sha256").update(`manual-quote:${bucket}`, "utf8").digest("hex"), scope, ctx.now()));
  if (!decision.allowed) throw rateLimited(decision.retryAfterSeconds);
}

/**
 * 记一条申请。按地址的两层额度由接口层先占（和别的官网接口一样，校验之前）；这里占联系方式和全站的。
 * 重复的（同一个联系方式、同一个行程 24 小时内）不再记，调用方照样回 202。
 */
export async function submitManualQuote(ctx: AppContext, input: ManualQuoteSubmission): Promise<void> {
  const site = await requireOpenSite(ctx);
  const crypto = passengerCryptoOfPool(ctx.pool);
  if (!crypto.configured) throw passengerEncryptionNotConfigured();
  const emailBidx = input.email === null ? null : crypto.manualQuoteIndex("email", input.email);
  const whatsappBidx = input.whatsapp === null ? null : crypto.manualQuoteIndex("phone", input.whatsapp);
  for (const bidx of [emailBidx, whatsappBidx]) if (bidx !== null) await takeSlot(ctx, bidx, "site_manual_quote_contact");
  await takeSlot(ctx, "all", "site_manual_quote_all");
  const now = ctx.now();
  // 验收留资和真实客人的留资各自去重：真实客人的一条不会因为验收先提交过同一行程而被当成重复丢掉（反过来也一样）。真实客人的键和以前完全相同
  const dedupParts: unknown[] = [emailBidx, whatsappBidx, tripKey(input.trip)];
  if (input.acceptance) dedupParts.push("acceptance");
  // 带行程单的再加上行程单和方案（M9T-08）：同一段第一天、不同行程单的不算重复；不带的键和以前完全相同
  if (input.tripRef !== null) dedupParts.push(["trip", input.tripRef.tripId, input.tripRef.planKind]);
  const dedupKey = crypto.manualQuoteFingerprint(JSON.stringify(dedupParts));
  await withPlatformTx(ctx.pool, async (db) => {
    const issues: InputIssue[] = [];
    if (input.cityId !== null && !(await cityExists(db, input.cityId))) issues.push({ path: "/trip/city_id", reason: "NOT_FOUND", message: "没有这个城市" });
    if (input.tripRef !== null) issues.push(...tripRefIssues(await findReadableTrip(db, input.tripRef.tripId, site.channel.id, now), input.tripRef, input.acceptance));
    if (issues.length > 0) throw validationFailed("body", issues);
    // 同一个去重键并发提交两次：事务级的锁让第二次看得到第一次
    await db.query("select pg_advisory_xact_lock(hashtext($1))", [`nozomi.manual-quote:${dedupKey}`]);
    if (await hasRecentDuplicate(db, dedupKey, new Date(now.getTime() - MANUAL_QUOTE_RULES.duplicateWindowMs))) return;
    const id = randomUUID();
    const sealed: SealedContact = {
      email: input.email,
      whatsapp: input.whatsapp,
      pickup: input.trip.pickup,
      dropoff: input.trip.dropoff,
      ...(input.trip.waypoints.length === 0 ? {} : { waypoints: input.trip.waypoints }),
      ...(input.tripRef === null || input.tripRef.labels === null ? {} : { tripLabels: input.tripRef.labels }),
    };
    await insertManualQuote(
      db,
      {
        id,
        requestNo: newRequestNo(now),
        category: input.trip.category,
        cityId: input.cityId,
        channelId: site.channel.id,
        serviceLocal: input.trip.serviceLocal,
        passengers: input.trip.passengers,
        luggage: input.trip.luggage,
        packageHours: input.trip.packageHours,
        hasEmail: input.email !== null,
        hasWhatsapp: input.whatsapp !== null,
        contactEnc: crypto.sealManualQuote("manual_quote_request", id, JSON.stringify(sealed)),
        emailBidx,
        whatsappBidx,
        dedupKey,
        isAcceptance: input.acceptance,
      },
      now,
    );
    if (input.tripRef !== null) await insertManualQuoteTripLink(db, id, { tripId: input.tripRef.tripId, planKind: input.tripRef.planKind }, now);
  });
}

/**
 * 带的行程单合不合格：不存在、过了可读期、别的渠道的、验收标记和这次提交不一致的，一律 `/trip_id` NOT_FOUND（不说是哪一种）；
 * 名称的天数、点数不能多于行程单。
 */
function tripRefIssues(trip: TripRow | null, ref: ManualQuoteTripRef, acceptance: boolean): InputIssue[] {
  if (trip === null || trip.isAcceptance !== acceptance) return [{ path: "/trip_id", reason: "NOT_FOUND", message: "行程单不存在或已过期，请重新报价" }];
  const days = trip.itinerary.days;
  if (ref.labels === null) return [];
  if (ref.labels.length > days.length) return [{ path: "/trip_labels", reason: "MISMATCH", message: "地点名称的天数比行程单多" }];
  const issues: InputIssue[] = [];
  ref.labels.forEach((labels, index) => {
    if (labels.length > (days[index]?.items.length ?? 0)) issues.push({ path: `/trip_labels/${index}`, reason: "MISMATCH", message: "地点名称比这一天的点多" });
  });
  return issues;
}

// ---- 运营后台 ----

export function manualQuoteNotFound(): AppError {
  return notFound("人工报价申请");
}

function purgedError(): AppError {
  return new AppError(409, "MANUAL_QUOTE_PURGED", "这条申请已过保留期，客人的联系方式和地点已清除，不能再跟进");
}

function origin(principal: PlatformPrincipal, ip: string, now: Date): AuditOrigin {
  return consoleOrigin(platformActor(principal.user), ip, now);
}

/** 运营后台按联系方式查：像邮箱的按邮箱，其余按 WhatsApp（+ 可有可无）；都不像的 400。 */
export function contactSearchIndex(ctx: AppContext, raw: string): string {
  const crypto = passengerCryptoOfPool(ctx.pool);
  if (!crypto.configured) throw passengerEncryptionNotConfigured();
  if (raw.includes("@")) {
    const email = manualQuoteEmail(raw);
    if (email !== null) return crypto.manualQuoteIndex("email", email);
  } else {
    const digits = whatsappDigits(raw, { requirePlus: false });
    if (digits !== null) return crypto.manualQuoteIndex("phone", digits);
  }
  throw validationFailed("querystring", [{ path: "/contact", reason: "FORMAT", message: "请输入完整的邮箱，或带国家码的 WhatsApp 号码" }]);
}

export interface ManualQuoteListQuery {
  status: ManualQuoteStatus | null;
  /** `me`：指给自己的；`unassigned`：没人跟进的；或某位员工的编号 */
  assignee: string | null;
  contact: string | null;
  /** 验收留资：默认 `exclude` */
  acceptance: ManualQuoteAcceptanceFilter;
}

export async function listManualQuoteRequests(
  ctx: AppContext,
  principal: PlatformPrincipal,
  query: ManualQuoteListQuery,
  limit: number,
  cursor: TimeCursor | null,
): Promise<Page<ManualQuoteRow> & { counts: Record<ManualQuoteStatus, number> }> {
  const filter: ManualQuoteFilter = {
    status: query.status,
    assignee: query.assignee === "me" ? principal.user.id : query.assignee,
    contactBidx: query.contact === null ? null : contactSearchIndex(ctx, query.contact),
  };
  return withPlatformTx(ctx.pool, async (db) => {
    const rows = await listManualQuotes(db, filter, query.acceptance, principal.grant.scope, limit, cursor);
    const page = toPage(rows, limit, (row) => row, (row) => ({ t: row.createdAtText, id: row.id }));
    return { ...page, counts: await countManualQuotesByStatus(db, query.acceptance, principal.grant.scope) };
  }, { snapshot: true });
}

export interface ManualQuoteEventView extends Omit<ManualQuoteEventRow, "noteEnc"> {
  /** 备注原文；清除后为 null */
  note: string | null;
}

/** 详情里的行程单（M9T-08）：没带为 null；带了但行程单已被清理为 `{ purged: true }` */
export type ManualQuoteTripView =
  | null
  | { purged: true }
  | {
      purged: false;
      tripId: string;
      planKind: "one_car" | "daily_best" | null;
      trip: Pick<TripRow, "id" | "itinerary" | "currency" | "createdAt" | "readableUntil">;
      /** 最近一次报价的方案（没报过价为空） */
      plans: StoredTripPlan[];
      /** 行程单里用到的平台地点（机场 / 车站） */
      places: Map<string, { name: Record<string, string>; lat: number; lng: number }>;
      /** 客人页面上的名称；联系方式已清除或没给时为 null */
      labels: (string | null)[][] | null;
    };

export interface ManualQuoteDetail {
  request: ManualQuoteRow;
  /** 清除后为 null */
  contact: SealedContact | null;
  events: ManualQuoteEventView[];
  trip: ManualQuoteTripView;
}

async function tripViewOf(db: Db, requestId: string, contact: SealedContact | null): Promise<ManualQuoteTripView> {
  const link = await findManualQuoteTripLink(db, requestId);
  if (link === null) return null;
  const trip = await findTripForStaff(db, link.tripId);
  if (trip === null) return { purged: true };
  const placeIds = [...new Set(trip.itinerary.days.flatMap((day) => day.items.flatMap((item) => (isPlaceIdPlace(item.place) ? [item.place.placeId] : []))))];
  const places =
    placeIds.length === 0 ? [] : (await db.query<{ id: string; name: Record<string, string>; lat: number; lng: number }>("select id, name, lat::float8 as lat, lng::float8 as lng from places where id = any($1::uuid[])", [placeIds])).rows;
  return {
    purged: false,
    tripId: link.tripId,
    planKind: link.planKind,
    trip,
    plans: await listTripPlans(db, link.tripId),
    places: new Map(places.map((place) => [place.id, { name: place.name, lat: Number(place.lat), lng: Number(place.lng) }])),
    labels: contact?.tripLabels ?? null,
  };
}

function openEvents(ctx: AppContext, events: readonly ManualQuoteEventRow[]): ManualQuoteEventView[] {
  const crypto = passengerCryptoOfPool(ctx.pool);
  return events.map(({ noteEnc, ...event }) => ({ ...event, note: noteEnc === null ? null : crypto.openManualQuote("manual_quote_note", event.id, noteEnc) }));
}

/** 详情：解密联系方式、地点和备注，留一条审计（清除过的没有可看的，不记）。 */
export async function getManualQuoteRequest(ctx: AppContext, principal: PlatformPrincipal, ip: string, id: string): Promise<ManualQuoteDetail> {
  const crypto = passengerCryptoOfPool(ctx.pool);
  return withPlatformTx(ctx.pool, async (db) => {
    const request = await findManualQuote(db, id, principal.grant.scope, false);
    if (request === null) throw manualQuoteNotFound();
    const events = await listManualQuoteEvents(db, id);
    if (request.contactEnc === null) return { request, contact: null, events: openEvents(ctx, events), trip: await tripViewOf(db, id, null) };
    const contact = JSON.parse(crypto.openManualQuote("manual_quote_request", id, request.contactEnc)) as SealedContact;
    // 审计只记申请编号：行程单编号是客人的访问凭证，不进审计
    await insertAuditLog(db, origin(principal, ip, ctx.now()), { tenantId: null, resource: "manual_quote_request", resourceId: id, action: "view_passenger", before: null, after: { request_no: request.requestNo } });
    return { request, contact, events: openEvents(ctx, events), trip: await tripViewOf(db, id, contact) };
  });
}

/** 这位员工能不能跟进这条：账号在用、角色有 `manual_quote.read`、数据范围包含这条。 */
async function assigneeEligible(db: Db, userId: string, request: ManualQuoteRow): Promise<boolean> {
  const staff = (await listActiveStaffWithRoles(db)).find((entry) => entry.id === userId);
  if (staff === undefined) return false;
  const grant = resolvePlatformGrant(staff.role);
  if (!grantCan(grant, "manual_quote.read")) return false;
  return (request.city === null ? grant.scope.cityIds === null : scopeAllowsCity(grant.scope, request.city.id)) && scopeAllowsChannel(grant.scope, request.channelId);
}

/** 能被指派跟进的员工（不看某一条的范围；指派时再按那一条核对）。 */
export async function listManualQuoteAssignees(ctx: AppContext): Promise<{ id: string; name: string }[]> {
  return withPlatformTx(ctx.pool, async (db) =>
    (await listActiveStaffWithRoles(db)).filter((staff) => grantCan(resolvePlatformGrant(staff.role), "manual_quote.read")).map((staff) => ({ id: staff.id, name: staff.name })),
  );
}

export interface ManualQuoteChange {
  status?: ManualQuoteStatus;
  /** null = 取消指派；不给 = 不改 */
  assigneeId?: string | null;
}

/** 改状态、指派（If-Match 版本）。每一项各一条跟进记录、一条审计；什么都没变时原样返回。 */
export async function changeManualQuoteRequest(ctx: AppContext, principal: PlatformPrincipal, ip: string, id: string, version: number, change: ManualQuoteChange): Promise<ManualQuoteRow> {
  return withPlatformTx(ctx.pool, async (db) => {
    const request = await findManualQuote(db, id, principal.grant.scope, true);
    if (request === null) throw manualQuoteNotFound();
    if (request.version !== version) throw versionConflict(request.version);
    if (request.purgedAt !== null) throw purgedError();
    const now = ctx.now();
    const status = change.status ?? request.status;
    const assigneeId = change.assigneeId === undefined ? (request.assignee?.id ?? null) : change.assigneeId;
    const statusChanged = status !== request.status;
    const assigneeChanged = assigneeId !== (request.assignee?.id ?? null);
    if (statusChanged && !manualQuoteStatusChangeAllowed(request.status, status)) {
      throw new AppError(409, "MANUAL_QUOTE_STATUS_INVALID", "不能改回「新」：「新」只表示还没人看过", { from: request.status, to: status });
    }
    if (assigneeChanged && assigneeId !== null && !(await assigneeEligible(db, assigneeId, request))) {
      throw validationFailed("body", [{ path: "/assignee_id", reason: "NOT_ELIGIBLE", message: "这位同事不能跟进人工报价申请（账号停用、没有权限或不在数据范围内）" }]);
    }
    if (!statusChanged && !assigneeChanged) return request;
    const finished = MANUAL_QUOTE_FINISHED.includes(status);
    const finishedAt = !finished ? null : statusChanged && !MANUAL_QUOTE_FINISHED.includes(request.status) ? now : (request.finishedAt ?? now);
    await updateManualQuote(db, id, { status, assigneeId, finishedAt }, now);
    const who = origin(principal, ip, now);
    if (statusChanged) {
      await insertManualQuoteEvent(db, { id: randomUUID(), requestId: id, kind: "status", fromStatus: request.status, toStatus: status, actorId: principal.user.id }, now);
      await insertAuditLog(db, who, { tenantId: null, resource: "manual_quote_request", resourceId: id, action: "change", before: { request_no: request.requestNo, status: request.status }, after: { request_no: request.requestNo, status } });
    }
    if (assigneeChanged) {
      await insertManualQuoteEvent(db, { id: randomUUID(), requestId: id, kind: "assign", assigneeId, actorId: principal.user.id }, now);
      await insertAuditLog(db, who, { tenantId: null, resource: "manual_quote_request", resourceId: id, action: "assign", before: { request_no: request.requestNo, assignee_id: request.assignee?.id ?? null }, after: { request_no: request.requestNo, assignee_id: assigneeId } });
    }
    return (await findManualQuote(db, id, principal.grant.scope, false)) as ManualQuoteRow;
  });
}

/** 写一条备注（加密存；审计只有编号和字数，不含内容）。 */
export async function addManualQuoteNote(ctx: AppContext, principal: PlatformPrincipal, ip: string, id: string, note: string): Promise<ManualQuoteEventView> {
  const crypto = passengerCryptoOfPool(ctx.pool);
  if (!crypto.configured) throw passengerEncryptionNotConfigured();
  return withPlatformTx(ctx.pool, async (db) => {
    const request = await findManualQuote(db, id, principal.grant.scope, true);
    if (request === null) throw manualQuoteNotFound();
    if (request.purgedAt !== null) throw purgedError();
    const now = ctx.now();
    const eventId = randomUUID();
    await insertManualQuoteEvent(db, { id: eventId, requestId: id, kind: "note", noteEnc: crypto.sealManualQuote("manual_quote_note", eventId, note), actorId: principal.user.id }, now);
    await touchManualQuote(db, id, now);
    await insertAuditLog(db, origin(principal, ip, now), { tenantId: null, resource: "manual_quote_request", resourceId: id, action: "note", before: null, after: { request_no: request.requestNo, note_id: eventId, length: [...note].length } });
    return { id: eventId, kind: "note", fromStatus: null, toStatus: null, assignee: null, note, actor: { id: principal.user.id, name: principal.user.name }, createdAt: now };
  });
}

// ---- 清除 ----

const FIRST_TICK_MS = 20_000;
const TICK_INTERVAL_MS = 60 * 60_000;
const STOP_WAIT_MS = 3_000;
const PURGE_BATCH = 200;
const PURGE_MAX_BATCHES = 10;

export interface ManualQuotePurgeLog {
  info(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface ManualQuotePurgeResult {
  purged: number;
  batches: number;
  /** 别的实例正在跑，这一轮没做 */
  busy: boolean;
}

/** 跑一轮：每批一个事务（抢不到锁就不做），每批一条审计（只有数量和截止时刻）。 */
export async function runManualQuotePurge(ctx: AppContext, source: "job" | "cli" = "job"): Promise<ManualQuotePurgeResult> {
  const result: ManualQuotePurgeResult = { purged: 0, batches: 0, busy: false };
  for (let batch = 0; batch < PURGE_MAX_BATCHES; batch += 1) {
    const done = await withPlatformTx(ctx.pool, async (db) => {
      const lock = await db.query<{ got: boolean }>("select pg_try_advisory_xact_lock(hashtext(current_schema() || ':nozomi.manual-quote-purge')) as got");
      if (lock.rows[0]?.got !== true) return null;
      const now = ctx.now();
      const cutoffs = manualQuotePurgeCutoffs(now);
      const candidates = await lockPurgeCandidates(db, cutoffs, PURGE_BATCH);
      const purged = await purgeManualQuotes(db, candidates.map((row) => row.id), now);
      if (purged > 0) {
        await insertAuditLog(db, { occurredAt: now, actor: { type: "system", id: null, email: null }, ip: null, source }, {
          tenantId: null,
          resource: "manual_quote_request",
          resourceId: null,
          action: "anonymize_passenger",
          before: null,
          after: { count: purged, finished_before: cutoffs.finishedBefore.toISOString(), created_before: cutoffs.createdBefore.toISOString() },
        });
      }
      return { purged, selected: candidates.length };
    });
    if (done === null) return { ...result, busy: true };
    result.purged += done.purged;
    result.batches += 1;
    if (done.selected < PURGE_BATCH) break;
  }
  return result;
}

/** 定时清除（ADR 0022 的定时任务做法）：只有服务进程（`buildApp({ jobs: true })`）启动；测试直接调 `tick`。 */
export class ManualQuoteRetentionJobs {
  private readonly ctx: AppContext;
  private readonly log: ManualQuotePurgeLog;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private ticking: Promise<unknown> | null = null;
  private stopped = true;

  constructor(ctx: AppContext, log: ManualQuotePurgeLog) {
    this.ctx = ctx;
    this.log = log;
  }

  async tick(): Promise<ManualQuotePurgeResult> {
    const result = await runManualQuotePurge(this.ctx);
    if (result.purged > 0) this.log.info({ event: "manual_quote.purged", purged: result.purged, batches: result.batches }, "人工报价申请到期清除");
    return result;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule(FIRST_TICK_MS);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (this.ticking !== null) await Promise.race([this.ticking, new Promise((resolve) => setTimeout(resolve, STOP_WAIT_MS).unref())]);
  }

  private schedule(delay: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.ticking = this.tick()
        .catch((err: unknown) => this.log.error({ event: "manual_quote.purge_failed", code: driverErrorCode(err) }, "人工报价申请清除这一轮失败"))
        .finally(() => {
          this.ticking = null;
          this.schedule(TICK_INTERVAL_MS);
        });
    }, delay);
    this.timer.unref();
  }
}

// ---- 官网设置 ----

export async function getSiteSettings(ctx: AppContext): Promise<SiteSettingsRow> {
  return withPlatformTx(ctx.pool, (db) => readSiteSettings(db), { snapshot: true });
}

/**
 * 改客服 WhatsApp 号码（纯数字，null = 不显示按钮）和页面宽度（M8-28，ADR 0079；`null` = 不改）。版本对不上 409；
 * 留审计（号码是公开的客服号，前后值原样记，页面宽度同样记前后）。
 */
export async function updateSiteSettings(ctx: AppContext, principal: PlatformPrincipal, ip: string, supportWhatsapp: string | null, pageWidth: SitePageWidth | null, version: number | null): Promise<SiteSettingsRow> {
  return withPlatformTx(ctx.pool, async (db) => {
    const before = await readSiteSettings(db, true);
    if ((version ?? 0) !== before.version) throw versionConflict(before.version);
    const width = pageWidth ?? before.pageWidth;
    if (before.version > 0 && before.supportWhatsapp === supportWhatsapp && before.pageWidth === width) return before;
    const now = ctx.now();
    if (!(await saveSiteSettings(db, supportWhatsapp, width, before.version, principal.user.id, now))) throw versionConflict(before.version);
    await insertAuditLog(db, origin(principal, ip, now), {
      tenantId: null,
      resource: "site_settings",
      resourceId: null,
      action: "update",
      before: { support_whatsapp: before.supportWhatsapp, page_width: before.pageWidth },
      after: { support_whatsapp: supportWhatsapp, page_width: width },
    });
    return readSiteSettings(db);
  });
}

/** 官网公开配置里的客服 WhatsApp 号码（纯数字；没设置为 null，页面不显示按钮）和页面宽度（没设过是 standard）。 */
export async function sitePublicSettings(ctx: AppContext): Promise<{ supportWhatsapp: string | null; pageWidth: SitePageWidth }> {
  return withPlatformTx(ctx.pool, (db) => readPublicSiteSettings(db), { snapshot: true });
}
