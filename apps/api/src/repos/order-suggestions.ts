/**
 * 包车经停顺序建议（M9P-20 P2，ADR 0096 第三节）：建议顺序的缓存和优化调用的每日计数。只在平台事务里调用；平台表。
 * 计数的做法和路线预估（repos/route-estimates.ts）一样，只是另一张表：优化用多了不挡报价要用的路线。
 */
import type { LatLng, RouteFailureCode } from "@nozomi/domain";
import type { Db } from "../db/context.ts";

/** 缓存里的一段：建议顺序（取整后的坐标列表），或只跟这组点有关的失败（没有路线、坐标无效）。 */
export type CachedOrder = { ok: true; points: LatLng[] } | { ok: false; code: "NO_ROUTE" | "INVALID_POINTS" };

export async function findCachedOrder(db: Db, key: string, now: Date): Promise<CachedOrder | null> {
  const result = await db.query<{ ordered_points: LatLng[] | null; failure_code: "NO_ROUTE" | "INVALID_POINTS" | null }>("select ordered_points, failure_code from route_order_suggestions where cache_key = $1 and expires_at > $2", [key, now]);
  const row = result.rows[0];
  if (row === undefined) return null;
  return row.ordered_points !== null ? { ok: true, points: row.ordered_points } : { ok: false, code: row.failure_code as "NO_ROUTE" | "INVALID_POINTS" };
}

/** 写入（覆盖）一段的结果；顺手删掉一批过期的行（每次最多 100 行）。 */
export async function saveCachedOrder(db: Db, key: string, value: CachedOrder, fetchedAt: Date, expiresAt: Date): Promise<void> {
  await db.query(
    `insert into route_order_suggestions (cache_key, ordered_points, failure_code, fetched_at, expires_at) values ($1, $2::jsonb, $3, $4, $5)
     on conflict (cache_key) do update set ordered_points = excluded.ordered_points, failure_code = excluded.failure_code, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at`,
    [key, value.ok ? JSON.stringify(value.points) : null, value.ok ? null : value.code, fetchedAt, expiresAt],
  );
  await db.query("delete from route_order_suggestions where ctid in (select ctid from route_order_suggestions where expires_at <= $1 limit 100)", [fetchedAt]);
}

/**
 * 一次占 `count` 个今天的名额（锁住今天那一行再判断，并发不超）：一次建议请求切出几段就要几个名额，**不够时整次不调**（不出半截建议）。
 * 不允许就记一次「被挡下」。
 */
export async function reserveOptimizeCalls(db: Db, day: string, count: number, limit: number): Promise<boolean> {
  await db.query("insert into route_optimize_api_usage (day) values ($1) on conflict (day) do nothing", [day]);
  const current = await db.query<{ calls: number }>("select calls from route_optimize_api_usage where day = $1 for update", [day]);
  const ok = (current.rows[0] as { calls: number }).calls + count <= limit;
  await db.query(ok ? "update route_optimize_api_usage set calls = calls + $2 where day = $1" : "update route_optimize_api_usage set refused = refused + 1 where day = $1", ok ? [day, count] : [day]);
  return ok;
}

export async function recordOptimizeRefused(db: Db, day: string): Promise<void> {
  await db.query("insert into route_optimize_api_usage (day, refused) values ($1, 1) on conflict (day) do update set refused = route_optimize_api_usage.refused + 1", [day]);
}

export async function recordOptimizeOutcome(db: Db, day: string, outcome: { ok: true } | { ok: false; code: RouteFailureCode }, at: Date): Promise<void> {
  if (outcome.ok) {
    await db.query("insert into route_optimize_api_usage (day, last_success_at) values ($1, $2) on conflict (day) do update set last_success_at = excluded.last_success_at", [day, at]);
    return;
  }
  await db.query(
    `insert into route_optimize_api_usage (day, failures, last_failure_at, last_failure_code) values ($1, 1, $2, $3)
     on conflict (day) do update set failures = route_optimize_api_usage.failures + 1, last_failure_at = excluded.last_failure_at, last_failure_code = excluded.last_failure_code`,
    [day, at, outcome.code],
  );
}

export interface OptimizeUsageStatus {
  day: string;
  calls: number;
  failures: number;
  refused: number;
  lastSuccessAt: Date | null;
  lastFailure: { code: string; at: Date } | null;
}

/** 系统状态：今天的计数、最近一次成功、最近一次失败。 */
export async function optimizeUsageStatus(db: Db, day: string): Promise<OptimizeUsageStatus> {
  const today = await db.query<{ calls: number; failures: number; refused: number }>("select calls, failures, refused from route_optimize_api_usage where day = $1", [day]);
  const success = await db.query<{ at: Date }>("select last_success_at as at from route_optimize_api_usage where last_success_at is not null order by day desc limit 1");
  const failure = await db.query<{ code: string; at: Date }>("select last_failure_code as code, last_failure_at as at from route_optimize_api_usage where last_failure_at is not null order by day desc limit 1");
  const row = today.rows[0];
  return { day, calls: row?.calls ?? 0, failures: row?.failures ?? 0, refused: row?.refused ?? 0, lastSuccessAt: success.rows[0]?.at ?? null, lastFailure: failure.rows[0] ?? null };
}
