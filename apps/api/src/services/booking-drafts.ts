/**
 * 预订草稿（M9E-01，ADR 0090 第二节）。
 *
 * - 读：`GET /site/v1/booking-drafts/{id}` 只给预订条件和到期时刻；过期、不存在、编号格式不对一律 404，不区分。
 * - 写：建草稿的接口随嵌入码一起做（M9E-02，`POST /embed/v1/booking-drafts`）；这里的 `insertBookingDraft` 先给它和测试用。
 * - 清理：`BookingDraftRetentionJobs` 每小时删一轮过期草稿（同 `ManualQuoteRetentionJobs` 的做法），过期就删、不留痕：
 *   草稿里没有个人信息，也不是任何业务记录。
 */
import { randomBytes } from "node:crypto";
import { type BookingDraft, bookingDraftExpiresAt, isBookingDraftId, parseBookingDraft } from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { type Db, withPlatformTx } from "../db/context.ts";
import { driverErrorCode } from "../db/pool.ts";
import { AppError } from "../errors.ts";

export interface BookingDraftSource {
  embedKeyId: string;
  embedOrigin: string;
  returnUrl: string | null;
}

export interface StoredBookingDraft {
  id: string;
  draft: BookingDraft;
  source: BookingDraftSource | null;
  createdAt: Date;
  expiresAt: Date;
}

export const bookingDraftNotFound = (): AppError => new AppError(404, "BOOKING_DRAFT_NOT_FOUND", "链接已过期，请重新填写");

/** 新编号：32 字节密码学随机数的 base64url（43 字符） */
export function newBookingDraftId(): string {
  return randomBytes(32).toString("base64url");
}

/** 写入一份已经校验过的草稿。调用方负责校验内容（`bookingDraftIssues`）和来源。 */
export async function insertBookingDraft(db: Db, draft: BookingDraft, source: BookingDraftSource | null, now: Date): Promise<StoredBookingDraft> {
  const id = newBookingDraftId();
  const expiresAt = bookingDraftExpiresAt(now);
  await db.query("insert into booking_drafts (id, content, embed_key_id, embed_origin, return_url, created_at, expires_at) values ($1, $2, $3, $4, $5, $6, $7)", [
    id,
    JSON.stringify(draft),
    source?.embedKeyId ?? null,
    source?.embedOrigin ?? null,
    source?.returnUrl ?? null,
    now,
    expiresAt,
  ]);
  return { id, draft, source, createdAt: now, expiresAt };
}

interface DraftRow {
  id: string;
  content: unknown;
  embed_key_id: string | null;
  embed_origin: string | null;
  return_url: string | null;
  created_at: Date;
  expires_at: Date;
}

/** 按编号读一份**还没过期**的草稿；过期、不存在、格式不对都是 null。库里的内容再校验一次，不合格按不存在。 */
export async function findLiveBookingDraft(db: Db, id: string, now: Date): Promise<StoredBookingDraft | null> {
  if (!isBookingDraftId(id)) return null;
  const result = await db.query<DraftRow>("select id, content, embed_key_id, embed_origin, return_url, created_at, expires_at from booking_drafts where id = $1 and expires_at > $2", [id, now]);
  const row = result.rows[0];
  if (row === undefined) return null;
  const draft = parseBookingDraft(row.content);
  if (draft === null) return null;
  const source = row.embed_key_id !== null && row.embed_origin !== null ? { embedKeyId: row.embed_key_id, embedOrigin: row.embed_origin, returnUrl: row.return_url } : null;
  return { id: row.id, draft, source, createdAt: row.created_at, expiresAt: row.expires_at };
}

/** 官网读草稿：只给预订条件和到期时刻，不给来源 */
export async function readBookingDraftForSite(ctx: AppContext, id: string): Promise<{ draft: BookingDraft; expiresAt: Date }> {
  const found = await withPlatformTx(ctx.pool, (db) => findLiveBookingDraft(db, id, ctx.now()), { snapshot: true });
  if (found === null) throw bookingDraftNotFound();
  return { draft: found.draft, expiresAt: found.expiresAt };
}

// ---- 过期清理 ----

const FIRST_TICK_MS = 20_000;
const TICK_INTERVAL_MS = 3_600_000;
const STOP_WAIT_MS = 3_000;
const PURGE_BATCH = 500;
const PURGE_MAX_BATCHES = 10;

export interface BookingDraftPurgeResult {
  deleted: number;
  batches: number;
  /** 别的进程正在清（拿不到锁），这一轮跳过 */
  busy: boolean;
}

export async function runBookingDraftPurge(ctx: AppContext): Promise<BookingDraftPurgeResult> {
  const result: BookingDraftPurgeResult = { deleted: 0, batches: 0, busy: false };
  for (let batch = 0; batch < PURGE_MAX_BATCHES; batch += 1) {
    const deleted = await withPlatformTx(ctx.pool, async (db) => {
      const lock = await db.query<{ got: boolean }>("select pg_try_advisory_xact_lock(hashtext(current_schema() || ':nozomi.booking-draft-purge')) as got");
      if (lock.rows[0]?.got !== true) return null;
      const removed = await db.query(
        "delete from booking_drafts where id in (select id from booking_drafts where expires_at <= $1 order by expires_at limit $2)",
        [ctx.now(), PURGE_BATCH],
      );
      return removed.rowCount ?? 0;
    });
    if (deleted === null) return { ...result, busy: true };
    result.deleted += deleted;
    result.batches += 1;
    if (deleted < PURGE_BATCH) break;
  }
  return result;
}

export interface BookingDraftPurgeLog {
  info(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

/** 定时清理：只有服务进程（`buildApp({ jobs: true })`）启动；测试直接调 `tick`。 */
export class BookingDraftRetentionJobs {
  private readonly ctx: AppContext;
  private readonly log: BookingDraftPurgeLog;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private ticking: Promise<unknown> | null = null;
  private stopped = true;

  constructor(ctx: AppContext, log: BookingDraftPurgeLog) {
    this.ctx = ctx;
    this.log = log;
  }

  async tick(): Promise<BookingDraftPurgeResult> {
    const result = await runBookingDraftPurge(this.ctx);
    if (result.deleted > 0) this.log.info({ event: "booking_draft.purged", deleted: result.deleted, batches: result.batches }, "过期预订草稿已删除");
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
        .catch((err: unknown) => this.log.error({ event: "booking_draft.purge_failed", code: driverErrorCode(err) }, "预订草稿清理这一轮失败"))
        .finally(() => {
          this.ticking = null;
          this.schedule(TICK_INTERVAL_MS);
        });
    }, delay);
    this.timer.unref();
  }
}
