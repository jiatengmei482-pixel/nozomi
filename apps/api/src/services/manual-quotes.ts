/**
 * 人工报价申请（M8-21，ADR 0076）：官网一家都报不出价时客人留下邮箱或 WhatsApp，客服在运营后台跟进；以及官网设置（客服 WhatsApp 号码）。
 *
 * - 提交（`/site/v1`）：按地址、联系方式、全站三层限速；同一个联系方式、同一个行程 24 小时内只记一次；应答一律 202，不说是不是重复。
 *   联系方式和两端地点一份密文（乘客信息的方案，ADR 0057），没配主密钥时 503，不存明文。不发任何邮件。
 * - 运营后台：列表没有个人信息；打开详情才解密，每次留审计（`view_passenger`）；指派、改状态、写备注各留审计（内容不进审计）。
 * - 清除：结束 180 天、提交 365 天后清空密文、盲索引和备注（`ManualQuoteRetentionJobs`，每小时一轮，每批一条审计）。
 * - 不写进 M8-20 的「未覆盖需求」：以后那边加一列可空的申请编号指过来，个人信息只在这里。
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  MANUAL_QUOTE_FINISHED,
  MANUAL_QUOTE_RULES,
  type ManualQuotePlace,
  type ManualQuoteStatus,
  type ManualQuoteTrip,
  grantCan,
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
import {
  type ManualQuoteEventRow,
  type ManualQuoteFilter,
  type ManualQuoteRow,
  type SitePageWidth,
  type SiteSettingsRow,
  cityExists,
  countManualQuotesByStatus,
  findManualQuote,
  hasRecentDuplicate,
  insertManualQuote,
  insertManualQuoteEvent,
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
import { validationFailed } from "../validation.ts";
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
}

/** 密文里的内容：联系方式和两端地点。 */
interface SealedContact {
  email: string | null;
  whatsapp: string | null;
  pickup: ManualQuotePlace;
  dropoff: ManualQuotePlace | null;
}

const NO_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function newRequestNo(now: Date): string {
  const day = now.toISOString().slice(0, 10).replaceAll("-", "");
  const tail = [...randomBytes(8)].map((byte) => NO_CHARS[byte % NO_CHARS.length]).join("");
  return `MQ${day}${tail}`;
}

/** 去重比的行程要点：坐标按 4 位小数（约 10 米），地点名称不算（同一个点换个写法还是同一个行程）。 */
function tripKey(trip: ManualQuoteTrip): string {
  const point = (place: ManualQuotePlace | null) => (place === null ? null : [place.lat.toFixed(4), place.lng.toFixed(4)]);
  return JSON.stringify([trip.category, point(trip.pickup), point(trip.dropoff), trip.serviceLocal, trip.passengers, trip.luggage, trip.packageHours]);
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
  const dedupKey = crypto.manualQuoteFingerprint(JSON.stringify([emailBidx, whatsappBidx, tripKey(input.trip)]));
  await withPlatformTx(ctx.pool, async (db) => {
    if (input.cityId !== null && !(await cityExists(db, input.cityId))) throw validationFailed("body", [{ path: "/trip/city_id", reason: "NOT_FOUND", message: "没有这个城市" }]);
    // 同一个去重键并发提交两次：事务级的锁让第二次看得到第一次
    await db.query("select pg_advisory_xact_lock(hashtext($1))", [`nozomi.manual-quote:${dedupKey}`]);
    if (await hasRecentDuplicate(db, dedupKey, new Date(now.getTime() - MANUAL_QUOTE_RULES.duplicateWindowMs))) return;
    const id = randomUUID();
    const sealed: SealedContact = { email: input.email, whatsapp: input.whatsapp, pickup: input.trip.pickup, dropoff: input.trip.dropoff };
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
      },
      now,
    );
  });
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
    const rows = await listManualQuotes(db, filter, principal.grant.scope, limit, cursor);
    const page = toPage(rows, limit, (row) => row, (row) => ({ t: row.createdAtText, id: row.id }));
    return { ...page, counts: await countManualQuotesByStatus(db, principal.grant.scope) };
  }, { snapshot: true });
}

export interface ManualQuoteEventView extends Omit<ManualQuoteEventRow, "noteEnc"> {
  /** 备注原文；清除后为 null */
  note: string | null;
}

export interface ManualQuoteDetail {
  request: ManualQuoteRow;
  /** 清除后为 null */
  contact: SealedContact | null;
  events: ManualQuoteEventView[];
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
    if (request.contactEnc === null) return { request, contact: null, events: openEvents(ctx, events) };
    const contact = JSON.parse(crypto.openManualQuote("manual_quote_request", id, request.contactEnc)) as SealedContact;
    await insertAuditLog(db, origin(principal, ip, ctx.now()), { tenantId: null, resource: "manual_quote_request", resourceId: id, action: "view_passenger", before: null, after: { request_no: request.requestNo } });
    return { request, contact, events: openEvents(ctx, events) };
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
