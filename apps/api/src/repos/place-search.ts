/**
 * 官网地址搜索和反查（M3-12，ADR 0044）的每日调用计数。只在平台事务（withPlatformTx）里调用；平台表，租户角色没有权限。
 * 做法和路线预估的计数（repos/route-estimates.ts）一样，表分开：客人搜地址用多了不挡住报价要用的路线。
 */
import type { PlaceFailureCode } from "@nozomi/domain";
import type { Db } from "../db/context.ts";

/**
 * 占一次今天的调用名额：锁住今天的那一行，读出已经调用的次数，由 `allowed` 判断；允许就加一，不允许就记一次「被挡下」。
 * 行锁让几个请求同时来也不会超过上限。在一个事务里调用。
 */
export async function reservePlaceCall(db: Db, day: string, allowed: (used: number) => boolean): Promise<boolean> {
  await db.query("insert into place_api_usage (day) values ($1) on conflict (day) do nothing", [day]);
  const current = await db.query<{ calls: number }>("select calls from place_api_usage where day = $1 for update", [day]);
  const ok = allowed((current.rows[0] as { calls: number }).calls);
  await db.query(ok ? "update place_api_usage set calls = calls + 1 where day = $1" : "update place_api_usage set refused = refused + 1 where day = $1", [day]);
  return ok;
}

/** 记一次「被每日上限挡下」（冷却期内直接挡下、没走占名额的那些）。 */
export async function recordPlaceRefused(db: Db, day: string): Promise<void> {
  await db.query("insert into place_api_usage (day, refused) values ($1, 1) on conflict (day) do update set refused = place_api_usage.refused + 1", [day]);
}

/** 记下一次调用的结果：成功记时间；失败记次数、时间和原因代码。 */
export async function recordPlaceOutcome(db: Db, day: string, outcome: { ok: true } | { ok: false; code: PlaceFailureCode }, at: Date): Promise<void> {
  if (outcome.ok) {
    await db.query("insert into place_api_usage (day, last_success_at) values ($1, $2) on conflict (day) do update set last_success_at = excluded.last_success_at", [day, at]);
    return;
  }
  await db.query(
    `insert into place_api_usage (day, failures, last_failure_at, last_failure_code) values ($1, 1, $2, $3)
     on conflict (day) do update set failures = place_api_usage.failures + 1, last_failure_at = excluded.last_failure_at, last_failure_code = excluded.last_failure_code`,
    [day, at, outcome.code],
  );
}
