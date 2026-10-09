/**
 * 登录限速的计数（规则见 @nozomi/domain 的 login-throttle.ts）。
 * 计数在一条 SQL 里原子完成（先占用、后验证密码），并发请求不可能绕过。
 * 表里只有哈希后的 key，没有邮箱和地址原文。平台表，只在 withPreAuthTx 里调用。
 */
import { LOGIN_THROTTLE_WINDOW_MS, type ThrottleCounter } from "@nozomi/domain";
import type { Db } from "../db/context.ts";

/** 窗口结束多久之后的计数行可以清掉。 */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/** 占用一次尝试，返回占用后的计数。窗口已结束的计数从 1 重新开始。 */
export async function reserveLoginAttempt(db: Db, key: string, now: Date): Promise<ThrottleCounter> {
  const windowExpiredBefore = new Date(now.getTime() - LOGIN_THROTTLE_WINDOW_MS);
  const result = await db.query<{ attempt_count: number; window_started_at: Date }>(
    `insert into login_throttles as t (key, attempt_count, window_started_at)
     values ($1, 1, $2)
     on conflict (key) do update set
       attempt_count = case when t.window_started_at <= $3 then 1 else t.attempt_count + 1 end,
       window_started_at = case when t.window_started_at <= $3 then $2 else t.window_started_at end
     returning attempt_count, window_started_at`,
    [key, now, windowExpiredBefore],
  );
  const row = result.rows[0] as { attempt_count: number; window_started_at: Date };
  return { attemptCount: row.attempt_count, windowStartedAt: row.window_started_at };
}

/**
 * 退还一次占用（登录成功的那一次不算进「同一来源地址」的失败次数）。
 *
 * 先减、减不了再删，而且「大于 1 才减」写在同一条语句的条件里。原来是「先删等于 1 的、再无条件减一」：
 * 同一个来源地址的两次登录同时成功时，两边都看到计数是 2、都不删，接着先后各减一，后一个把计数减成 0，
 * 撞上表的检查约束（attempt_count > 0），登录明明成功了却返回 500。现在后到的那次等前一次提交后会重新核对条件，
 * 发现已经是 1，就不减而去删这一行。计数永远不会小于 1；极端的交错下最多多算一次，等窗口结束自然清掉。
 */
export async function refundLoginAttempt(db: Db, key: string): Promise<void> {
  const decremented = await db.query("update login_throttles set attempt_count = attempt_count - 1 where key = $1 and attempt_count > 1", [key]);
  if ((decremented.rowCount ?? 0) > 0) return;
  await db.query("delete from login_throttles where key = $1 and attempt_count <= 1", [key]);
}

/** 登录成功后清掉计数。 */
export async function clearLoginAttempts(db: Db, keys: readonly string[]): Promise<void> {
  await db.query("delete from login_throttles where key = any($1::text[])", [keys]);
}

/** 顺手清掉早就过期的计数行，表不会无限增长。 */
export async function deleteStaleLoginThrottles(db: Db, now: Date): Promise<void> {
  await db.query("delete from login_throttles where window_started_at <= $1", [
    new Date(now.getTime() - LOGIN_THROTTLE_WINDOW_MS - STALE_AFTER_MS),
  ]);
}
