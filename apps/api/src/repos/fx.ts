/**
 * 汇率中心的读写（ADR 0022）。只在平台事务（withPlatformTx）里调用；租户只读当前汇率（`latestRateSet` 也能在租户事务里用）。
 * 汇率在库里是 numeric，取出来一律 `rate::text`——十进制原值，不经过浮点数。
 */
import type { CurrencyCode, FxFetchStatus, RateJump } from "@nozomi/domain";
import type { Db } from "../db/context.ts";

export type FxFetchTrigger = "schedule" | "manual";

export interface FxFetch {
  id: string;
  startedAt: Date;
  finishedAt: Date | null;
  trigger: FxFetchTrigger;
  triggeredBy: { id: string; name: string } | null;
  source: string;
  status: FxFetchStatus;
  errorCode: string | null;
  errorDetail: string | null;
  sourceAsOf: Date | null;
  sourceNextUpdateAt: Date | null;
  heldRates: Partial<Record<CurrencyCode, string>> | null;
  jumps: RateJump[] | null;
  decidedBy: { id: string; name: string } | null;
  decidedAt: Date | null;
}

interface FxFetchRow {
  id: string;
  started_at: Date;
  finished_at: Date | null;
  trigger: FxFetchTrigger;
  triggered_by: string | null;
  triggered_by_name: string | null;
  source: string;
  status: FxFetchStatus;
  error_code: string | null;
  error_detail: string | null;
  source_as_of: Date | null;
  source_next_update_at: Date | null;
  held_rates: Partial<Record<CurrencyCode, string>> | null;
  jumps: RateJump[] | null;
  decided_by: string | null;
  decided_by_name: string | null;
  decided_at: Date | null;
}

const FETCH_COLUMNS = `
  f.id::text as id, f.started_at, f.finished_at, f.trigger, f.triggered_by, t.name as triggered_by_name, f.source, f.status,
  f.error_code, f.error_detail, f.source_as_of, f.source_next_update_at, f.held_rates, f.jumps, f.decided_by, d.name as decided_by_name, f.decided_at`;
const FETCH_FROM = "fx_fetches f left join platform_users t on t.id = f.triggered_by left join platform_users d on d.id = f.decided_by";

function toFetch(row: FxFetchRow): FxFetch {
  return {
    id: row.id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    trigger: row.trigger,
    triggeredBy: row.triggered_by === null ? null : { id: row.triggered_by, name: row.triggered_by_name ?? "" },
    source: row.source,
    status: row.status,
    errorCode: row.error_code,
    errorDetail: row.error_detail,
    sourceAsOf: row.source_as_of,
    sourceNextUpdateAt: row.source_next_update_at,
    heldRates: row.held_rates,
    jumps: row.jumps,
    decidedBy: row.decided_by === null ? null : { id: row.decided_by, name: row.decided_by_name ?? "" },
    decidedAt: row.decided_at,
  };
}

/**
 * 拉取的排他锁（事务级咨询锁，事务结束自动释放）：同一个库里几个服务进程同时「看要不要拉、登记正在拉」「写结果」时排队，
 * 不会两个进程同时登记成正在拉。锁名带上当前 schema：集成测试各用各的 schema，互不排队。
 * 锁只在这两个很短的事务里持有；下载汇率在事务之外，不占着连接等外部服务。
 */
export async function lockFxFetching(db: Db): Promise<void> {
  await db.query("select pg_advisory_xact_lock(hashtext(current_schema() || ':nozomi.fx_fetch'))");
}

export async function latestFetch(db: Db): Promise<FxFetch | null> {
  const result = await db.query<FxFetchRow>(`select ${FETCH_COLUMNS} from ${FETCH_FROM} order by f.started_at desc, f.id desc limit 1`);
  return result.rows[0] === undefined ? null : toFetch(result.rows[0]);
}

export async function getFetch(db: Db, id: string, options: { forUpdate?: boolean } = {}): Promise<FxFetch | null> {
  if (options.forUpdate) await db.query("select id from fx_fetches where id = $1 for update", [id]);
  const result = await db.query<FxFetchRow>(`select ${FETCH_COLUMNS} from ${FETCH_FROM} where f.id = $1`, [id]);
  return result.rows[0] === undefined ? null : toFetch(result.rows[0]);
}

export async function listFetches(db: Db, limit: number): Promise<FxFetch[]> {
  const result = await db.query<FxFetchRow>(`select ${FETCH_COLUMNS} from ${FETCH_FROM} order by f.started_at desc, f.id desc limit $1`, [limit]);
  return result.rows.map(toFetch);
}

/** 最近一次成功取到汇率（生效、没变、挂起、确认）的时间。 */
export async function lastSuccessfulFetchAt(db: Db): Promise<Date | null> {
  const result = await db.query<{ at: Date | null }>("select max(finished_at) as at from fx_fetches where status in ('accepted', 'unchanged', 'held', 'confirmed', 'dismissed')");
  return result.rows[0]?.at ?? null;
}

/** 还在等人确认的挂起批次（比现在用的那批新的），新的在前。 */
export async function pendingHeldFetches(db: Db, currentAsOf: Date | null): Promise<FxFetch[]> {
  const result = await db.query<FxFetchRow>(
    `select ${FETCH_COLUMNS} from ${FETCH_FROM} where f.status = 'held' and ($1::timestamptz is null or f.source_as_of > $1) order by f.source_as_of desc, f.id desc`,
    [currentAsOf],
  );
  return result.rows.map(toFetch);
}

export async function insertRunningFetch(db: Db, input: { startedAt: Date; trigger: FxFetchTrigger; triggeredBy: string | null; source: string }): Promise<string> {
  const result = await db.query<{ id: string }>(
    "insert into fx_fetches (started_at, trigger, triggered_by, source, status) values ($1, $2, $3, $4, 'running') returning id::text as id",
    [input.startedAt, input.trigger, input.triggeredBy, input.source],
  );
  return (result.rows[0] as { id: string }).id;
}

export interface FetchOutcome {
  status: Exclude<FxFetchStatus, "running" | "confirmed" | "dismissed">;
  finishedAt: Date;
  errorCode?: string | null;
  errorDetail?: string | null;
  sourceAsOf?: Date | null;
  sourceNextUpdateAt?: Date | null;
  heldRates?: Partial<Record<CurrencyCode, string>> | null;
  jumps?: RateJump[] | null;
}

/** 一次拉取结束：写结果。只改还在「正在拉」的那一行（中途被判定为中断、改成失败的，不再覆盖）。返回是否写上了。调用方先锁住这一行。 */
export async function finishFetch(db: Db, id: string, outcome: FetchOutcome): Promise<boolean> {
  const result = await db.query(
    `update fx_fetches set status = $2, finished_at = $3, error_code = $4, error_detail = $5, source_as_of = $6, source_next_update_at = $7, held_rates = $8, jumps = $9
      where id = $1 and status = 'running'`,
    [
      id,
      outcome.status,
      outcome.finishedAt,
      outcome.errorCode ?? null,
      outcome.errorDetail ?? null,
      outcome.sourceAsOf ?? null,
      outcome.sourceNextUpdateAt ?? null,
      outcome.heldRates ? JSON.stringify(outcome.heldRates) : null,
      outcome.jumps ? JSON.stringify(outcome.jumps) : null,
    ],
  );
  return (result.rowCount ?? 0) > 0;
}

/** 挂起的一批：人工确认（confirmed）或放弃（dismissed）。`decidedBy` 为 null 表示被更新的一批自动取代。 */
export async function decideHeld(db: Db, id: string, status: "confirmed" | "dismissed", decidedBy: string | null, decidedAt: Date, note: string | null = null): Promise<void> {
  await db.query("update fx_fetches set status = $2, decided_by = $3, decided_at = $4, error_detail = coalesce($5, error_detail) where id = $1 and status = 'held'", [id, status, decidedBy, decidedAt, note]);
}

export interface RateSet {
  base: CurrencyCode;
  asOf: Date;
  fetchedAt: Date;
  source: string;
  rates: Partial<Record<CurrencyCode, string>>;
}

/** 现在用的那批汇率（取数时间最新的一批）；还没有时为 null。 */
export async function latestRateSet(db: Db): Promise<RateSet | null> {
  const result = await db.query<{ base: CurrencyCode; quote: CurrencyCode; rate: string; as_of: Date; fetched_at: Date; source: string }>(
    "select base, quote, rate::text as rate, as_of, fetched_at, source from fx_rates where as_of = (select max(as_of) from fx_rates) order by quote",
  );
  const first = result.rows[0];
  if (first === undefined) return null;
  return {
    base: first.base,
    asOf: first.as_of,
    fetchedAt: first.fetched_at,
    source: first.source,
    rates: Object.fromEntries(result.rows.map((row) => [row.quote, row.rate])) as Partial<Record<CurrencyCode, string>>,
  };
}

/** 写入一批汇率（同一个取数时间）。 */
export async function insertRateSet(db: Db, input: { base: CurrencyCode; asOf: Date; fetchedAt: Date; source: string; fetchId: string; rates: Partial<Record<CurrencyCode, string>> }): Promise<void> {
  const entries = Object.entries(input.rates);
  await db.query(
    `insert into fx_rates (base, quote, rate, as_of, fetched_at, source, fetch_id)
     select $1, quote, rate::numeric, $2, $3, $4, $5 from unnest($6::text[], $7::text[]) as t(quote, rate)`,
    [input.base, input.asOf, input.fetchedAt, input.source, input.fetchId, entries.map(([quote]) => quote), entries.map(([, rate]) => rate)],
  );
}

/** 某个时间以后的全部汇率（曲线用），按取数时间排。 */
export async function rateHistory(db: Db, since: Date): Promise<{ asOf: Date; quote: CurrencyCode; rate: string }[]> {
  const result = await db.query<{ as_of: Date; quote: CurrencyCode; rate: string }>("select as_of, quote, rate::text as rate from fx_rates where as_of >= $1 order by as_of, quote", [since]);
  return result.rows.map((row) => ({ asOf: row.as_of, quote: row.quote, rate: row.rate }));
}
