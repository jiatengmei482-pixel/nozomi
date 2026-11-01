/**
 * 邮箱登录验证码（ADR 0050）。一个邮箱一行，表里只有 HMAC。只在 withPreAuthTx 里调用。
 * 「不超过 5 次」「只成功一次」都靠这里单条语句的行锁保证，不靠应用代码的先后。
 */
import { EMAIL_CODE_MAX_ATTEMPTS } from "@nozomi/domain";
import type { Db } from "../db/context.ts";

/** 写入新码：同一个邮箱的旧码被覆盖，计数归零。顺手清掉已过期的行，表不会无限增长。 */
export async function replaceEmailCode(db: Db, input: { emailKey: string; codeHash: string; createdAt: Date; expiresAt: Date }): Promise<void> {
  await db.query("delete from email_login_codes where expires_at <= $1", [input.createdAt]);
  await db.query(
    `insert into email_login_codes (email_key, code_hash, attempt_count, created_at, expires_at)
     values ($1, $2, 0, $3, $4)
     on conflict (email_key) do update set code_hash = excluded.code_hash, attempt_count = 0, created_at = excluded.created_at, expires_at = excluded.expires_at`,
    [input.emailKey, input.codeHash, input.createdAt, input.expiresAt],
  );
}

/** 占用一次尝试，返回这个码的哈希和占用后的次数。没有码、已过期、次数已用尽都是 null。 */
export async function takeEmailCodeAttempt(db: Db, emailKey: string, now: Date): Promise<{ codeHash: string; attemptCount: number } | null> {
  const result = await db.query<{ code_hash: string; attempt_count: number }>(
    `update email_login_codes set attempt_count = attempt_count + 1
      where email_key = $1 and expires_at > $2 and attempt_count < $3
      returning code_hash, attempt_count`,
    [emailKey, now, EMAIL_CODE_MAX_ATTEMPTS],
  );
  const row = result.rows[0];
  return row ? { codeHash: row.code_hash, attemptCount: row.attempt_count } : null;
}

/** 用掉这个码。同一个码并发提交时只有一个请求能删到这一行。 */
export async function consumeEmailCode(db: Db, emailKey: string, codeHash: string): Promise<boolean> {
  const result = await db.query("delete from email_login_codes where email_key = $1 and code_hash = $2", [emailKey, codeHash]);
  return (result.rowCount ?? 0) === 1;
}
