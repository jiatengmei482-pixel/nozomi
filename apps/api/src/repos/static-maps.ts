/**
 * 官网路线小地图（M8-10，ADR 0072）的图片缓存和每日调用计数。只在平台事务（withPlatformTx）里调用；平台表，租户角色没有权限。
 * 计数的做法和路线预估（repos/route-estimates.ts）一样，只是另一张表：小地图用多了不挡报价要用的路线。
 */
import type { StaticMapFailureCode } from "@nozomi/domain";
import type { Db } from "../db/context.ts";
import type { StaticMapImageType } from "../integrations/google-static-maps.ts";

export interface CachedStaticMap {
  contentType: StaticMapImageType;
  image: Buffer;
}

/** 查一张图；过期的当作没有。 */
export async function findStaticMap(db: Db, key: string, now: Date): Promise<CachedStaticMap | null> {
  const result = await db.query<{ content_type: StaticMapImageType; image: Buffer }>("select content_type, image from static_map_images where cache_key = $1 and expires_at > $2", [key, now]);
  const row = result.rows[0];
  return row === undefined ? null : { contentType: row.content_type, image: row.image };
}

/** 写入（覆盖）一张图；顺手删掉一批已经过期的行（每次最多 100 行，不让一次写入变慢）。 */
export async function saveStaticMap(db: Db, key: string, map: CachedStaticMap, fetchedAt: Date, expiresAt: Date): Promise<void> {
  await db.query(
    `insert into static_map_images (cache_key, content_type, image, fetched_at, expires_at) values ($1, $2, $3, $4, $5)
     on conflict (cache_key) do update set content_type = excluded.content_type, image = excluded.image, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at`,
    [key, map.contentType, map.image, fetchedAt, expiresAt],
  );
  await db.query("delete from static_map_images where ctid in (select ctid from static_map_images where expires_at <= $1 limit 100)", [fetchedAt]);
}

/** 占一次今天的调用名额（锁住今天那一行再判断，并发不超）；不允许就记一次「被挡下」。在一个事务里调用。 */
export async function reserveStaticMapCall(db: Db, day: string, allowed: (used: number) => boolean): Promise<boolean> {
  await db.query("insert into static_map_api_usage (day) values ($1) on conflict (day) do nothing", [day]);
  const current = await db.query<{ calls: number }>("select calls from static_map_api_usage where day = $1 for update", [day]);
  const ok = allowed((current.rows[0] as { calls: number }).calls);
  await db.query(ok ? "update static_map_api_usage set calls = calls + 1 where day = $1" : "update static_map_api_usage set refused = refused + 1 where day = $1", [day]);
  return ok;
}

/** 记一次「被每日上限挡下」（冷却期内直接挡下、没走占名额的那些）。 */
export async function recordStaticMapRefused(db: Db, day: string): Promise<void> {
  await db.query("insert into static_map_api_usage (day, refused) values ($1, 1) on conflict (day) do update set refused = static_map_api_usage.refused + 1", [day]);
}

/** 记下一次调用的结果：成功记时间；失败记次数、时间和原因代码。 */
export async function recordStaticMapOutcome(db: Db, day: string, outcome: { ok: true } | { ok: false; code: StaticMapFailureCode }, at: Date): Promise<void> {
  if (outcome.ok) {
    await db.query("insert into static_map_api_usage (day, last_success_at) values ($1, $2) on conflict (day) do update set last_success_at = excluded.last_success_at", [day, at]);
    return;
  }
  await db.query(
    `insert into static_map_api_usage (day, failures, last_failure_at, last_failure_code) values ($1, 1, $2, $3)
     on conflict (day) do update set failures = static_map_api_usage.failures + 1, last_failure_at = excluded.last_failure_at, last_failure_code = excluded.last_failure_code`,
    [day, at, outcome.code],
  );
}

export interface StaticMapUsageStatus {
  day: string;
  calls: number;
  failures: number;
  refused: number;
  lastSuccessAt: Date | null;
  /** 最近一次失败（不限今天） */
  lastFailure: { code: string; at: Date } | null;
}

/** 系统状态：今天的计数、最近一次成功、最近一次失败（都不限今天）。 */
export async function staticMapUsageStatus(db: Db, day: string): Promise<StaticMapUsageStatus> {
  const today = await db.query<{ calls: number; failures: number; refused: number }>("select calls, failures, refused from static_map_api_usage where day = $1", [day]);
  const success = await db.query<{ at: Date }>("select last_success_at as at from static_map_api_usage where last_success_at is not null order by day desc limit 1");
  const failure = await db.query<{ code: string; at: Date }>("select last_failure_code as code, last_failure_at as at from static_map_api_usage where last_failure_at is not null order by day desc limit 1");
  const row = today.rows[0];
  return { day, calls: row?.calls ?? 0, failures: row?.failures ?? 0, refused: row?.refused ?? 0, lastSuccessAt: success.rows[0]?.at ?? null, lastFailure: failure.rows[0] ?? null };
}
