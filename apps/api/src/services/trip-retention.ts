/**
 * 行程单清理（M9T-05，ADR 0100 第二节「保留期与清理」；设计篇第八节第 6 小节；CLAUDE.md 第 7 条）。
 *
 * 行程单 `readable_until`（建单 + 30 天）过后 `GET` 已经是 404；这里每小时删一轮过期的 `trips`，方案、段、费用随外键级联删除。
 * 行程单只有坐标、时间、人数，不含姓名电话，也不是任何业务记录（P1 不下单），过期就删、不留痕。
 * 只删 `trips`（和它级联的 `trip_plans` / `trip_segments` / `trip_fees`），不碰别的表。写法同 `BookingDraftRetentionJobs`：
 * 分批（每批 500、一轮最多 10 批）、advisory 锁防多实例同时清。
 */
import type { AppContext } from "../context.ts";
import { withPlatformTx } from "../db/context.ts";
import { driverErrorCode } from "../db/pool.ts";

const FIRST_TICK_MS = 25_000;
const TICK_INTERVAL_MS = 3_600_000;
const STOP_WAIT_MS = 3_000;
export const TRIP_PURGE_RULES = { batch: 500, maxBatches: 10 } as const;

export interface TripPurgeResult {
  deleted: number;
  batches: number;
  /** 别的进程正在清（拿不到锁），这一轮跳过 */
  busy: boolean;
}

export async function runTripPurge(ctx: AppContext): Promise<TripPurgeResult> {
  const result: TripPurgeResult = { deleted: 0, batches: 0, busy: false };
  for (let batch = 0; batch < TRIP_PURGE_RULES.maxBatches; batch += 1) {
    const deleted = await withPlatformTx(ctx.pool, async (db) => {
      const lock = await db.query<{ got: boolean }>("select pg_try_advisory_xact_lock(hashtext(current_schema() || ':nozomi.trip-purge')) as got");
      if (lock.rows[0]?.got !== true) return null;
      const removed = await db.query("delete from trips where id in (select id from trips where readable_until <= $1 order by readable_until limit $2)", [ctx.now(), TRIP_PURGE_RULES.batch]);
      return removed.rowCount ?? 0;
    });
    if (deleted === null) return { ...result, busy: true };
    result.deleted += deleted;
    result.batches += 1;
    if (deleted < TRIP_PURGE_RULES.batch) break;
  }
  return result;
}

export interface TripPurgeLog {
  info(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

/** 定时清理：只有服务进程（`buildApp({ jobs: true })`）启动；测试直接调 `tick`。 */
export class TripRetentionJobs {
  private readonly ctx: AppContext;
  private readonly log: TripPurgeLog;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private ticking: Promise<unknown> | null = null;
  private stopped = true;

  constructor(ctx: AppContext, log: TripPurgeLog) {
    this.ctx = ctx;
    this.log = log;
  }

  async tick(): Promise<TripPurgeResult> {
    const result = await runTripPurge(this.ctx);
    if (result.deleted > 0) this.log.info({ event: "trip.purged", deleted: result.deleted, batches: result.batches }, "过期行程单已删除");
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
        .catch((err: unknown) => this.log.error({ event: "trip.purge_failed", code: driverErrorCode(err) }, "行程单清理这一轮失败"))
        .finally(() => {
          this.ticking = null;
          this.schedule(TICK_INTERVAL_MS);
        });
    }, delay);
    this.timer.unref();
  }
}
