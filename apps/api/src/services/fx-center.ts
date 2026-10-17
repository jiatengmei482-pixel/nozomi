/**
 * 汇率中心（M2-03，ADR 0022）：拉取、校验、入库、挂起与确认、过期告警、给报价引擎的 `FxRates`、定时任务。
 *
 * - 拉取分三步：① 短事务里拿排他锁、看要不要拉、登记「正在拉」；② 事务之外下载（不占着连接等外部服务）；
 *   ③ 短事务里拿排他锁、校验、写结果。几个服务进程同时跑定时任务也只有一个在拉（数据库咨询锁 + 「正在拉」那一行）。
 * - 内容不对（解析失败、缺币种、汇率不是正数、时间不对、比现在用的还旧）整份拒收，记原因；连不上记失败。两种情况都继续用最近一次有效汇率。
 * - 和现在用的那批比，有币种变动超过 3%：整批挂起、告警，等人确认（`fx.manage`）才生效。
 * - 汇率超过 48 小时没更新：报价引擎拿不到汇率（跨币种暂停），首页和汇率页醒目提醒，审计日志和服务日志各记一条（每批只记一次）。
 */
import type { AppConfig } from "@nozomi/config";
import {
  type CurrencyCode,
  FX_CURRENCIES,
  FX_RULES,
  type FxQuote,
  type FxTable,
  type FxTableState,
  findRateJumps,
  fxFetchAbandoned,
  fxQuoteFromTable,
  fxStaleAt,
  fxTableState,
  nextFxFetchAt,
  parseFxSource,
} from "@nozomi/domain";
import { FxSourceError, MANUAL_FETCH, SCHEDULED_FETCH, downloadFxSource, fxSourceHost } from "../integrations/fx-source.ts";
import { type Db, withPlatformTx } from "../db/context.ts";
import type { Pool } from "../db/pool.ts";
import { AppError } from "../errors.ts";
import { type AuditOrigin, insertAuditLog } from "../repos/audit-logs.ts";
import type { PlatformUser } from "../repos/platform-users.ts";
import {
  type FetchOutcome,
  type FxFetch,
  type RateSet,
  decideHeld,
  finishFetch,
  getFetch,
  insertRateSet,
  insertRunningFetch,
  latestFetch,
  lastSuccessfulFetchAt,
  latestRateSet,
  lockFxFetching,
  pendingHeldFetches,
} from "../repos/fx.ts";
import { consoleOrigin, platformActor } from "./audit.ts";

/** 服务日志（Fastify 的日志对象满足它）。异常走统一的脱敏序列化；这里只记错误码、时间这类字段，不记数据源地址。 */
export interface FxLog {
  info(entry: Record<string, unknown>, message: string): void;
  warn(entry: Record<string, unknown>, message: string): void;
  error(entry: Record<string, unknown>, message: string): void;
}

/** 当前汇率在内存里缓存多久（需求：「放缓存」）。几个服务进程各有各的缓存；本进程里拉取、确认后立即作废 */
const CACHE_TTL_MS = 30_000;
/** 定时任务：启动后多久第一次检查，之后每隔多久检查一次「该不该拉、有没有过期」 */
const FIRST_TICK_MS = 5_000;
const TICK_INTERVAL_MS = 60_000;
/** 关闭时最多等正在进行的那次检查多久 */
const STOP_WAIT_MS = 3_000;

/** 谁触发的：平台员工（后台）或定时任务。 */
export type FxActor = { kind: "staff"; user: PlatformUser; ip: string } | { kind: "job" };

function origin(actor: FxActor, now: Date): AuditOrigin {
  return actor.kind === "staff" ? consoleOrigin(platformActor(actor.user), actor.ip, now) : { occurredAt: now, actor: { type: "system", id: null, email: null }, ip: null, source: "job" };
}

function tableOf(set: RateSet): FxTable {
  return { base: set.base, asOf: set.asOf.toISOString(), rates: set.rates };
}

export interface FxCenterOptions {
  pool: Pool;
  now: () => Date;
  config: AppConfig["fx"];
  log: FxLog;
}

export class FxCenter {
  readonly sourceHost: string;
  private readonly pool: Pool;
  private readonly now: () => Date;
  private readonly config: AppConfig["fx"];
  private readonly log: FxLog;
  private cached: { table: FxTable | null; loadedAt: number } | null = null;
  private loading: Promise<FxTable | null> | null = null;
  /** 缓存的代次：每次作废加一。作废之前开始的加载（旧代次）读到的可能是旧的一批，结果不写回缓存，也不交给作废之后的调用 */
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private ticking: Promise<void> | null = null;
  private stopped = true;

  constructor(options: FxCenterOptions) {
    this.pool = options.pool;
    this.now = options.now;
    this.config = options.config;
    this.log = options.log;
    this.sourceHost = fxSourceHost(options.config.sourceUrl);
  }

  /** 给报价引擎的中央汇率（ADR 0020 留的接口）：没有汇率、或超过 48 小时没更新返回 null（跨币种暂停）。 */
  readonly rates = {
    quote: async (from: CurrencyCode, to: CurrencyCode, at: Date): Promise<FxQuote | null> => {
      const table = await this.currentTable();
      if (table === null || fxTableState(table.asOf, at) !== "fresh") return null;
      return fxQuoteFromTable(table, from, to);
    },
  };

  /** 现在用的那批汇率（缓存 30 秒）。 */
  async currentTable(): Promise<FxTable | null> {
    const nowMs = Date.now();
    if (this.cached !== null && nowMs - this.cached.loadedAt < CACHE_TTL_MS) return this.cached.table;
    if (this.loading === null) {
      const generation = this.generation;
      const loading: Promise<FxTable | null> = withPlatformTx(this.pool, latestRateSet)
        .then((set) => {
          const table = set === null ? null : tableOf(set);
          if (generation === this.generation) this.cached = { table, loadedAt: Date.now() };
          return table;
        })
        .finally(() => {
          if (this.loading === loading) this.loading = null;
        });
      this.loading = loading;
    }
    return this.loading;
  }

  /** 本进程里汇率变了（拉到新的一批、确认了挂起的一批）：下次报价重新取；正在进行的加载作废，结果不写回缓存。 */
  invalidate(): void {
    this.generation += 1;
    this.cached = null;
    this.loading = null;
  }

  /**
   * 拉一次。`manual`：不管到没到时间都拉，正在有人拉时报 409 `FX_FETCH_IN_PROGRESS`；
   * `schedule`：没到时间、或正在有人拉时什么都不做，返回 null。
   */
  async fetch(trigger: "manual", actor: FxActor): Promise<FxFetch>;
  async fetch(trigger: "schedule", actor: FxActor): Promise<FxFetch | null>;
  async fetch(trigger: "manual" | "schedule", actor: FxActor): Promise<FxFetch | null> {
    const claimed = await withPlatformTx(this.pool, async (db) => {
      await lockFxFetching(db);
      const now = this.now();
      const last = await latestFetch(db);
      if (last !== null && last.status === "running") {
        if (!fxFetchAbandoned(last, now)) {
          if (trigger === "manual") throw new AppError(409, "FX_FETCH_IN_PROGRESS", "正在拉取汇率，请稍后再看结果", { started_at: last.startedAt.toISOString() });
          return null;
        }
        await finishFetch(db, last.id, { status: "failed", finishedAt: now, errorCode: "FX_FETCH_ABANDONED", errorDetail: "拉取中途中断（进程退出或超时），已作废" });
      } else if (trigger === "schedule" && nextFxFetchAt(last === null ? null : { status: last.status, startedAt: last.startedAt, finishedAt: last.finishedAt, sourceNextUpdateAt: last.sourceNextUpdateAt }).getTime() > now.getTime()) {
        return null;
      }
      return insertRunningFetch(db, { startedAt: now, trigger, triggeredBy: actor.kind === "staff" ? actor.user.id : null, source: this.sourceHost });
    });
    if (claimed === null) return null;

    let text: string | null = null;
    let failure: { code: string; detail: string } | null = null;
    try {
      text = await downloadFxSource(this.config.sourceUrl, trigger === "manual" ? MANUAL_FETCH : SCHEDULED_FETCH);
    } catch (err) {
      failure = err instanceof FxSourceError ? { code: err.code, detail: err.message } : { code: "FX_SOURCE_UNAVAILABLE", detail: "取汇率时出错" };
      if (!(err instanceof FxSourceError)) this.log.warn({ err }, "取汇率时出现意外的异常");
    }
    return this.record(claimed, trigger, actor, text, failure);
  }

  private async record(id: string, trigger: "manual" | "schedule", actor: FxActor, text: string | null, failure: { code: string; detail: string } | null): Promise<FxFetch> {
    const result = await withPlatformTx(this.pool, async (db) => {
      await lockFxFetching(db);
      const now = this.now();
      // 拉得太久、已经被判定为中断（别的进程接着拉了）：这次的结果作废，什么都不写
      const own = await getFetch(db, id, { forUpdate: true });
      if (own === null || own.status !== "running") return { fetch: own, outcome: null };
      const outcome = await this.judge(db, id, now, text, failure);
      await finishFetch(db, id, outcome);
      if (outcome.status === "held") {
        await insertAuditLog(db, origin(actor, now), { tenantId: null, resource: "fx_fetch", resourceId: id, action: "hold", before: null, after: { as_of: outcome.sourceAsOf?.toISOString() ?? null, jumps: (outcome.jumps ?? []).map((jump) => ({ currency: jump.currency, previous: jump.previous, next: jump.next, change_bp: jump.changeBp })) } });
      }
      if (trigger === "manual") {
        await insertAuditLog(db, origin(actor, now), { tenantId: null, resource: "fx_fetch", resourceId: id, action: "fetch", before: null, after: { status: outcome.status, error_code: outcome.errorCode ?? null, as_of: outcome.sourceAsOf?.toISOString() ?? null } });
      }
      return { fetch: await getFetch(db, id), outcome };
    });
    const { outcome } = result;
    if (outcome === null) {
      this.log.warn({ fxFetchId: id }, "这次拉取已被判定为中断，结果作废");
    } else if (outcome.status === "accepted") {
      this.invalidate();
      this.log.info({ fxFetchId: id, asOf: outcome.sourceAsOf?.toISOString() }, "汇率已更新");
    } else if (outcome.status === "held") {
      this.log.error({ fxFetchId: id, event: "fx.held", currencies: (outcome.jumps ?? []).map((jump) => jump.currency) }, "汇率变动超过 3%，已挂起，等待人工确认");
    } else if (outcome.status === "failed" || outcome.status === "rejected") {
      this.log.warn({ fxFetchId: id, code: outcome.errorCode }, "汇率没有拉到，继续用最近一次有效汇率");
    }
    return result.fetch as FxFetch;
  }

  /** 判定这次拉到的内容怎么处理，需要时写入汇率、让旧的挂起批次作废。 */
  private async judge(db: Db, id: string, now: Date, text: string | null, failure: { code: string; detail: string } | null): Promise<FetchOutcome> {
    if (failure !== null || text === null) return { status: "failed", finishedAt: now, errorCode: failure?.code ?? "FX_SOURCE_UNAVAILABLE", errorDetail: failure?.detail ?? null };
    const parsed = parseFxSource(text, now);
    if (!parsed.ok) return { status: "rejected", finishedAt: now, errorCode: parsed.problem, errorDetail: parsed.detail };
    const doc = parsed.document;
    const asOf = new Date(doc.asOf);
    const next = doc.nextUpdateAt === null ? null : new Date(doc.nextUpdateAt);
    const base = { finishedAt: now, sourceAsOf: asOf, sourceNextUpdateAt: next };
    const current = await latestRateSet(db);
    if (current !== null && asOf.getTime() <= current.asOf.getTime()) {
      if (asOf.getTime() === current.asOf.getTime()) return { status: "unchanged", ...base };
      return { status: "rejected", ...base, errorCode: "FX_SOURCE_OLDER", errorDetail: `数据源给的这批（${doc.asOf}）比现在用的那批还旧` };
    }
    const pending = await pendingHeldFetches(db, current?.asOf ?? null);
    if (pending.some((held) => held.sourceAsOf?.getTime() === asOf.getTime())) return { status: "unchanged", ...base, errorDetail: "和挂起待确认的那批相同" };
    const jumps = current === null ? [] : findRateJumps(current.rates, doc.rates);
    // 有了更新的一批：数据源时间早于它的挂起批次不再能确认；比它新的挂起批次照旧等人确认（ADR 0022）
    for (const held of pending) {
      if (held.sourceAsOf !== null && held.sourceAsOf.getTime() < asOf.getTime()) await decideHeld(db, held.id, "dismissed", null, now, "被更新的一批取代");
    }
    if (jumps.length > 0) return { status: "held", ...base, heldRates: doc.rates, jumps, errorCode: "FX_RATE_JUMP", errorDetail: `${jumps.map((jump) => jump.currency).join("、")} 变动超过 ${FX_RULES.jumpThresholdBp / 100}%，等待人工确认` };
    await insertRateSet(db, { base: doc.base, asOf, fetchedAt: now, source: this.sourceHost, fetchId: id, rates: doc.rates });
    return { status: "accepted", ...base };
  }

  /** 人工确认挂起的一批：写入汇率，立即生效。只有比现在用的那批新的才能确认。 */
  async confirm(id: string, actor: Extract<FxActor, { kind: "staff" }>): Promise<FxFetch> {
    const fetch = await withPlatformTx(this.pool, async (db) => {
      await lockFxFetching(db);
      const now = this.now();
      const held = await this.heldFetch(db, id);
      const current = await latestRateSet(db);
      if (held.sourceAsOf === null || held.heldRates === null || (current !== null && held.sourceAsOf.getTime() <= current.asOf.getTime())) {
        throw new AppError(409, "FX_HELD_OUTDATED", "这批汇率已经比现在用的旧，不能再确认");
      }
      await insertRateSet(db, { base: FX_RULES.base, asOf: held.sourceAsOf, fetchedAt: held.finishedAt ?? now, source: held.source, fetchId: held.id, rates: held.heldRates });
      await decideHeld(db, held.id, "confirmed", actor.user.id, now);
      await insertAuditLog(db, origin(actor, now), { tenantId: null, resource: "fx_fetch", resourceId: held.id, action: "confirm", before: { status: "held" }, after: { status: "confirmed", as_of: held.sourceAsOf.toISOString() } });
      return getFetch(db, held.id);
    });
    this.invalidate();
    this.log.info({ fxFetchId: id }, "挂起的汇率已人工确认生效");
    return fetch as FxFetch;
  }

  /** 人工放弃挂起的一批：不生效，继续用现在的汇率。 */
  async dismiss(id: string, actor: Extract<FxActor, { kind: "staff" }>): Promise<FxFetch> {
    const fetch = await withPlatformTx(this.pool, async (db) => {
      await lockFxFetching(db);
      const now = this.now();
      const held = await this.heldFetch(db, id);
      await decideHeld(db, held.id, "dismissed", actor.user.id, now);
      await insertAuditLog(db, origin(actor, now), { tenantId: null, resource: "fx_fetch", resourceId: held.id, action: "dismiss", before: { status: "held" }, after: { status: "dismissed" } });
      return getFetch(db, held.id);
    });
    return fetch as FxFetch;
  }

  private async heldFetch(db: Db, id: string): Promise<FxFetch> {
    const fetch = await getFetch(db, id, { forUpdate: true });
    if (fetch === null) throw new AppError(404, "NOT_FOUND", "这次拉取记录不存在");
    if (fetch.status !== "held") throw new AppError(409, "FX_FETCH_NOT_HELD", "这次拉取没有挂起待确认的汇率", { status: fetch.status });
    return fetch;
  }

  /**
   * 过期告警：现在用的那批超过 48 小时没更新时，审计日志和服务日志各记一条（`fx.stale`）。每一批只记一次（看审计日志里有没有记过），
   * 几个服务进程同时检查也只记一次（同一把排他锁）。返回现在的状态。
   */
  async checkStale(): Promise<FxTableState> {
    const result = await withPlatformTx(this.pool, async (db) => {
      await lockFxFetching(db);
      const now = this.now();
      const current = await latestRateSet(db);
      const state = fxTableState(current?.asOf.toISOString() ?? null, now);
      if (state !== "stale" || current === null) return { state, alerted: null };
      const asOf = current.asOf.toISOString();
      const seen = await db.query("select 1 from audit_logs where resource = 'fx_rate' and action = 'stale' and resource_id = $1 limit 1", [asOf]);
      if (seen.rowCount !== 0) return { state, alerted: null };
      await insertAuditLog(db, origin({ kind: "job" }, now), { tenantId: null, resource: "fx_rate", resourceId: asOf, action: "stale", before: null, after: { as_of: asOf, stale_at: fxStaleAt(asOf).toISOString() } });
      return { state, alerted: asOf };
    });
    if (result.alerted !== null) this.log.error({ event: "fx.stale", asOf: result.alerted }, "汇率超过 48 小时没有更新，已暂停跨币种报价");
    return result.state;
  }

  /** 定时任务的一步：到时间就拉，然后检查是否过期。 */
  async tick(): Promise<void> {
    if (this.config.autoFetch) await this.fetch("schedule", { kind: "job" });
    await this.checkStale();
  }

  /** 启动定时任务（服务进程里调用；测试直接调 `tick`）。 */
  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    const run = (): void => {
      this.ticking = this.tick()
        .catch((err: unknown) => this.log.warn({ err }, "汇率定时任务这一轮出错，下一轮再试"))
        .finally(() => {
          this.ticking = null;
          if (!this.stopped) this.schedule(run, TICK_INTERVAL_MS);
        });
    };
    this.schedule(run, FIRST_TICK_MS);
  }

  private schedule(run: () => void, delayMs: number): void {
    this.timer = setTimeout(run, delayMs);
    this.timer.unref();
  }

  /** 停止定时任务；正在进行的那一轮最多等 3 秒。 */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (this.ticking !== null) await Promise.race([this.ticking, new Promise((resolve) => setTimeout(resolve, STOP_WAIT_MS).unref())]);
  }
}

// ---- 看板用的读取 ----

export interface FxOverview {
  base: CurrencyCode;
  state: FxTableState;
  asOf: Date | null;
  fetchedAt: Date | null;
  staleAt: Date | null;
  source: string | null;
  /** 1 个 base = ? 个各币种（12 位小数）；表里没有的为 null */
  rates: { currency: CurrencyCode; rate: string | null }[];
  /** 平台币种两两之间：1 个 from = ? 个 to */
  cross: { from: CurrencyCode; to: CurrencyCode; rate: string | null }[];
}

export async function fxOverview(db: Db, base: CurrencyCode, now: Date): Promise<FxOverview> {
  const set = await latestRateSet(db);
  const table = set === null ? null : tableOf(set);
  const rate = (from: CurrencyCode, to: CurrencyCode): string | null => (table === null ? null : (fxQuoteFromTable(table, from, to)?.rate ?? null));
  return {
    base,
    state: fxTableState(table?.asOf ?? null, now),
    asOf: set?.asOf ?? null,
    fetchedAt: set?.fetchedAt ?? null,
    staleAt: table === null ? null : fxStaleAt(table.asOf),
    source: set?.source ?? null,
    rates: FX_CURRENCIES.filter((currency) => currency !== base).map((currency) => ({ currency, rate: rate(base, currency) })),
    cross: FX_CURRENCIES.flatMap((from) => FX_CURRENCIES.filter((to) => to !== from).map((to) => ({ from, to, rate: rate(from, to) }))),
  };
}

export interface FxSeries {
  currency: CurrencyCode;
  points: { asOf: Date; rate: string }[];
}

/** 近 N 天的曲线：每批汇率一个点，换算成「1 个 base = ? 个该币种」。 */
export function fxSeries(history: readonly { asOf: Date; quote: CurrencyCode; rate: string }[], base: CurrencyCode): FxSeries[] {
  const batches = new Map<number, { asOf: Date; rates: Partial<Record<CurrencyCode, string>> }>();
  for (const row of history) {
    const key = row.asOf.getTime();
    const batch = batches.get(key) ?? { asOf: row.asOf, rates: {} };
    batch.rates[row.quote] = row.rate;
    batches.set(key, batch);
  }
  return FX_CURRENCIES.filter((currency) => currency !== base).map((currency) => ({
    currency,
    points: [...batches.values()].flatMap((batch) => {
      const quote = fxQuoteFromTable({ base: FX_RULES.base, asOf: batch.asOf.toISOString(), rates: batch.rates }, base, currency);
      return quote === null ? [] : [{ asOf: batch.asOf, rate: quote.rate }];
    }),
  }));
}

export interface FxSourceStatus {
  host: string;
  autoFetch: boolean;
  lastAttempt: FxFetch | null;
  lastSuccessAt: Date | null;
  /** 下一次定时拉取的时间；没开定时拉取时为 null */
  nextFetchAt: Date | null;
  /** 等人确认的挂起批次（最新的一个）；没有为 null */
  held: FxFetch | null;
}

export async function fxSourceStatus(db: Db, center: FxCenter, autoFetch: boolean, now: Date): Promise<FxSourceStatus> {
  const last = await latestFetch(db);
  const current = await latestRateSet(db);
  const held = await pendingHeldFetches(db, current?.asOf ?? null);
  const next = nextFxFetchAt(last === null ? null : { status: last.status, startedAt: last.startedAt, finishedAt: last.finishedAt, sourceNextUpdateAt: last.sourceNextUpdateAt });
  return {
    host: center.sourceHost,
    autoFetch,
    lastAttempt: last,
    lastSuccessAt: await lastSuccessfulFetchAt(db),
    nextFetchAt: autoFetch ? new Date(Math.max(next.getTime(), now.getTime())) : null,
    held: held[0] ?? null,
  };
}
