/**
 * 乘客信息的自动脱敏（M4-21，ADR 0055；需求《平台运营端》「个人信息保护」：订单完成 180 天后自动脱敏）。
 *
 * 和其他定时任务一样跑在 API 进程里（ADR 0022）：启动后 10 秒第一次，之后每小时一轮；每轮最多 `MAX_BATCHES` 批，每批最多 `BATCH` 单。
 * - 多实例：一批一个事务，开头抢事务级的 advisory lock，抢不到就不做这一轮；每单再 `for update skip locked` 并在锁内重新判断。
 * - 幂等：跑过的单 `passenger_anonymized_at` 不为空，不会再被选中。
 * - 一单出错只回滚到它的保存点，这批其他单照常；这一轮不再选它，下一轮再试。日志只有订单编号和错误。
 * - 每批一条审计：只有数量和范围。批内出错的不算数量。
 * 只有服务进程（`buildApp({ jobs: true })`）启动它；命令行 `pnpm privacy:anonymize` 和测试直接调。
 */
import { passengerRetentionCutoff } from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { type Db, withPlatformTx } from "../db/context.ts";
import type { AuditOrigin, AuditSource } from "../repos/audit-logs.ts";
import { insertAuditLog } from "../repos/audit-logs.ts";
import { driverErrorCode } from "../db/pool.ts";
import { type RetentionSummary, anonymizeOrderPassenger, listOrdersWithLateTexts, listRetentionCandidates, lockRetentionOrder, scrubOrderTexts, summarizeRetention } from "../repos/passenger-retention.ts";

const FIRST_TICK_MS = 10_000;
const TICK_INTERVAL_MS = 60 * 60_000;
const STOP_WAIT_MS = 3_000;
const BATCH = 200;
const MAX_BATCHES = 10;
/** 补扫的范围：脱敏之后、最近两天写进手写内容的单。写入时已经打码，这里只兜并发窗口。 */
const LATE_TEXT_WINDOW_MS = 2 * 86_400_000;
const LATE_TEXT_BATCH = 200;

export interface RetentionLog {
  info(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface RetentionTickResult {
  anonymized: number;
  /** 出错或锁内判断已不满足的单（下一轮再看） */
  skipped: number;
  batches: number;
  /** 别的实例正在跑，这一轮没做 */
  busy: boolean;
}

interface BatchResult {
  anonymized: number;
  skipped: number;
  /** 这一批选中的单数：不足一批就说明做完了 */
  selected: number;
  busy: boolean;
}

export interface RetentionPlan {
  retentionDays: number;
  cutoff: Date;
  summary: RetentionSummary;
}

export function retentionCutoff(ctx: AppContext): { days: number; cutoff: Date } {
  const days = ctx.config.passengerRetention.days;
  return { days, cutoff: passengerRetentionCutoff(ctx.now(), days) };
}

/** dry-run：只读，只有数量和范围。 */
export async function planPassengerRetention(ctx: AppContext): Promise<RetentionPlan> {
  const { days, cutoff } = retentionCutoff(ctx);
  return { retentionDays: days, cutoff, summary: await withPlatformTx(ctx.pool, (db) => summarizeRetention(db, cutoff), { snapshot: true }) };
}

async function runBatch(ctx: AppContext, db: Db, source: AuditSource, cutoff: Date, days: number, failed: Set<string>, log: RetentionLog): Promise<BatchResult> {
  const lock = await db.query<{ got: boolean }>("select pg_try_advisory_xact_lock(hashtext(current_schema() || ':nozomi.passenger-retention')) as got");
  if (lock.rows[0]?.got !== true) return { anonymized: 0, skipped: 0, selected: 0, busy: true };
  const now = ctx.now();
  const candidates = await listRetentionCandidates(db, cutoff, BATCH, [...failed]);
  const done: Date[] = [];
  let skipped = 0;
  for (const candidate of candidates) {
    await db.query("savepoint retention_order");
    try {
      if (await lockRetentionOrder(db, candidate.orderId, cutoff)) {
        await anonymizeOrderPassenger(db, candidate.orderId, now);
        done.push(candidate.endedAt);
      } else {
        skipped += 1;
        failed.add(candidate.orderId);
      }
      await db.query("release savepoint retention_order");
    } catch (err) {
      await db.query("rollback to savepoint retention_order");
      skipped += 1;
      failed.add(candidate.orderId);
      // 只记错误码：驱动的报错详情（err.detail）可能带这一行的内容
      log.error({ orderId: candidate.orderId, code: driverErrorCode(err) }, "这一单脱敏失败，下一轮再试");
    }
  }
  if (done.length > 0) {
    const origin: AuditOrigin = { occurredAt: now, actor: { type: "system", id: null, email: null }, ip: null, source };
    const times = done.map((at) => at.getTime());
    await insertAuditLog(db, origin, {
      tenantId: null,
      resource: "order",
      resourceId: null,
      action: "anonymize_passenger",
      before: null,
      after: { count: done.length, skipped, retention_days: days, ended_before: cutoff.toISOString(), ended_from: new Date(Math.min(...times)).toISOString(), ended_to: new Date(Math.max(...times)).toISOString() },
    });
  }
  return { anonymized: done.length, skipped, selected: candidates.length, busy: false };
}

/** 跑一轮。开关在调用方（定时任务只在开启时启动；命令行开关关闭时拒绝）。 */
export async function runPassengerRetention(ctx: AppContext, log: RetentionLog, source: AuditSource = "job"): Promise<RetentionTickResult> {
  const { days, cutoff } = retentionCutoff(ctx);
  const result: RetentionTickResult = { anonymized: 0, skipped: 0, batches: 0, busy: false };
  const failed = new Set<string>();
  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const done = await withPlatformTx(ctx.pool, (db) => runBatch(ctx, db, source, cutoff, days, failed, log));
    if (done.busy) return { ...result, busy: true };
    result.anonymized += done.anonymized;
    result.skipped += done.skipped;
    result.batches += 1;
    if (done.selected < BATCH) break;
  }
  await withPlatformTx(ctx.pool, (db) => rescanLateTexts(ctx, db, log));
  return result;
}

/** 已脱敏的单上后来写进去的手写内容再清一遍（幂等）。这时已经不知道姓名，电话、邮箱按规则清。 */
async function rescanLateTexts(ctx: AppContext, db: Db, log: RetentionLog): Promise<void> {
  const lock = await db.query<{ got: boolean }>("select pg_try_advisory_xact_lock(hashtext(current_schema() || ':nozomi.passenger-retention')) as got");
  if (lock.rows[0]?.got !== true) return;
  const since = new Date(ctx.now().getTime() - LATE_TEXT_WINDOW_MS);
  for (const orderId of await listOrdersWithLateTexts(db, since, LATE_TEXT_BATCH)) {
    await db.query("savepoint retention_rescan");
    try {
      await scrubOrderTexts(db, orderId, { names: [], literals: [] });
      await db.query("release savepoint retention_rescan");
    } catch (err) {
      await db.query("rollback to savepoint retention_rescan");
      log.error({ orderId, code: driverErrorCode(err) }, "已脱敏的单补扫失败，下一轮再试");
    }
  }
}

export class PassengerRetentionJobs {
  private readonly ctx: AppContext;
  private readonly log: RetentionLog;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private ticking: Promise<unknown> | null = null;
  private stopped = true;

  constructor(ctx: AppContext, log: RetentionLog) {
    this.ctx = ctx;
    this.log = log;
  }

  /** 开关关闭时什么都不做。 */
  async tick(): Promise<RetentionTickResult> {
    if (!this.ctx.config.passengerRetention.enabled) return { anonymized: 0, skipped: 0, batches: 0, busy: false };
    const result = await runPassengerRetention(this.ctx, this.log);
    if (result.anonymized > 0 || result.skipped > 0) this.log.info({ event: "passenger.anonymized", anonymized: result.anonymized, skipped: result.skipped, batches: result.batches }, "乘客信息自动脱敏");
    return result;
  }

  start(): void {
    if (!this.stopped || !this.ctx.config.passengerRetention.enabled) return;
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
        .catch((err: unknown) => this.log.error({ code: driverErrorCode(err) }, "乘客信息脱敏这一轮失败"))
        .finally(() => {
          this.ticking = null;
          this.schedule(TICK_INTERVAL_MS);
        });
    }, delay);
    this.timer.unref();
  }
}
