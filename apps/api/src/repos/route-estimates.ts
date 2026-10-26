/**
 * 路线预估（M2-02，ADR 0042）的缓存和每日调用计数。只在平台事务（withPlatformTx）里调用；平台表，租户角色没有权限。
 */
import type { RouteFailureCode } from "@nozomi/domain";
import type { Db } from "../db/context.ts";

/** 缓存里的一行：成功的（里程米、时长秒），或只跟这组点有关的失败。 */
export type CachedRoute = { ok: true; meters: number; seconds: number } | { ok: false; code: "NO_ROUTE" | "INVALID_POINTS" };

/** 查一组起终点的缓存；过期的当作没有。 */
export async function findRouteEstimate(db: Db, key: string, now: Date): Promise<CachedRoute | null> {
  const result = await db.query<{ failure_code: "NO_ROUTE" | "INVALID_POINTS" | null; distance_meters: number | null; duration_seconds: number | null }>(
    "select failure_code, distance_meters, duration_seconds from route_estimates where cache_key = $1 and expires_at > $2",
    [key, now],
  );
  const row = result.rows[0];
  if (!row) return null;
  return row.failure_code === null ? { ok: true, meters: row.distance_meters as number, seconds: row.duration_seconds as number } : { ok: false, code: row.failure_code };
}

/** 写入（覆盖）一组起终点的结果；顺手删掉一批过期一天以上的行（每次最多 100 行，不让一次写入变慢）。 */
export async function saveRouteEstimate(db: Db, key: string, route: CachedRoute, fetchedAt: Date, expiresAt: Date): Promise<void> {
  await db.query(
    `insert into route_estimates (cache_key, failure_code, distance_meters, duration_seconds, fetched_at, expires_at)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (cache_key) do update set failure_code = excluded.failure_code, distance_meters = excluded.distance_meters,
       duration_seconds = excluded.duration_seconds, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at`,
    [key, route.ok ? null : route.code, route.ok ? route.meters : null, route.ok ? route.seconds : null, fetchedAt, expiresAt],
  );
  await db.query(
    "delete from route_estimates where ctid in (select ctid from route_estimates where expires_at < $1 limit 100)",
    [new Date(fetchedAt.getTime() - 24 * 3_600_000)],
  );
}

/**
 * 占一次今天的调用名额：今天已经调用的次数小于上限才加一并返回 true；否则记一次「被挡下」，返回 false。
 * 判断和加一在同一条语句里（行锁），几个请求同时来也不会超过上限。
 */
export async function reserveRouteCall(db: Db, day: string, dailyLimit: number): Promise<boolean> {
  const reserved = await db.query(
    `insert into route_api_usage (day, calls) select $1::date, 1 where $2::integer > 0
     on conflict (day) do update set calls = route_api_usage.calls + 1 where route_api_usage.calls < $2::integer
     returning calls`,
    [day, dailyLimit],
  );
  if (reserved.rows.length > 0) return true;
  await db.query("insert into route_api_usage (day, refused) values ($1, 1) on conflict (day) do update set refused = route_api_usage.refused + 1", [day]);
  return false;
}

/** 记下一次调用的结果：成功记时间；失败记次数、时间和原因代码。 */
export async function recordRouteOutcome(db: Db, day: string, outcome: { ok: true } | { ok: false; code: RouteFailureCode }, at: Date): Promise<void> {
  if (outcome.ok) {
    await db.query("insert into route_api_usage (day, last_success_at) values ($1, $2) on conflict (day) do update set last_success_at = excluded.last_success_at", [day, at]);
    return;
  }
  await db.query(
    `insert into route_api_usage (day, failures, last_failure_at, last_failure_code) values ($1, 1, $2, $3)
     on conflict (day) do update set failures = route_api_usage.failures + 1, last_failure_at = excluded.last_failure_at, last_failure_code = excluded.last_failure_code`,
    [day, at, outcome.code],
  );
}

export interface RouteUsageStatus {
  day: string;
  calls: number;
  failures: number;
  refused: number;
  lastSuccessAt: Date | null;
  /** 最近一次失败（不限今天） */
  lastFailure: { code: string; at: Date } | null;
}

/** 系统状态：今天的计数、最近一次成功（不限今天）、最近一次失败（不限今天）。 */
export async function routeUsageStatus(db: Db, day: string): Promise<RouteUsageStatus> {
  const today = await db.query<{ calls: number; failures: number; refused: number }>("select calls, failures, refused from route_api_usage where day = $1", [day]);
  const success = await db.query<{ at: Date }>("select last_success_at as at from route_api_usage where last_success_at is not null order by day desc limit 1");
  const failure = await db.query<{ code: string; at: Date }>("select last_failure_code as code, last_failure_at as at from route_api_usage where last_failure_at is not null order by day desc limit 1");
  const row = today.rows[0];
  return {
    day,
    calls: row?.calls ?? 0,
    failures: row?.failures ?? 0,
    refused: row?.refused ?? 0,
    lastSuccessAt: success.rows[0]?.at ?? null,
    lastFailure: failure.rows[0] ?? null,
  };
}
