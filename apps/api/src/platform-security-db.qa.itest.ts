/**
 * 测试角色补充（M4-05，ADR 0030）：数据库层的兜底，用应用账号的真实连接、切到平台角色直接执行 SQL（模拟应用代码写错）。
 * - 会话触发器：已验证的会话不能改回待验证、不能再验证一次；
 *   已经过期的待验证会话不能被「验证」复活（ADR 0030：应用代码写错了也延长不了会话）；
 * - 内置角色：平台角色同样改不了、删不了。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "./db/pool.ts";
import { PLATFORM_DB_ROLE } from "./db/roles.ts";
import { createSuperAdmin } from "./services/platform-staff.ts";
import { TEST_PASSWORD, type TestApi, createTestApi } from "./testing/api.ts";

let api: TestApi;
let userId: string;

before(async () => {
  api = await createTestApi();
  await createSuperAdmin(api.db.pool, { email: "db-root@platform.test", name: "库", password: TEST_PASSWORD }, api.clock.now());
  userId = (await api.db.owner.query("select id from platform_users where email = 'db-root@platform.test'")).rows[0].id as string;
});
after(() => api.close());

async function asPlatform<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await api.db.pool.connect();
  try {
    await client.query("begin");
    await client.query(`set local role ${PLATFORM_DB_ROLE}`);
    return await fn(client);
  } finally {
    await client.query("rollback");
    client.release();
  }
}

const rejectedByTrigger = (err: unknown): boolean => (err as { code?: string }).code === "P0001";

async function session(createdAgoMs: number, expiresAfterCreateMs: number, verified: boolean): Promise<string> {
  const id = randomUUID();
  const created = new Date(Date.now() - createdAgoMs);
  await api.db.owner.query(
    "insert into platform_sessions (id, user_id, created_at, expires_at, mfa_verified_at, mfa_method) values ($1, $2, $3, $4, $5, $6)",
    [id, userId, created, new Date(created.getTime() + expiresAfterCreateMs), verified ? created : null, verified ? "totp" : null],
  );
  return id;
}

test("对照：没过期的待验证会话可以改成已验证（不超过建会话起 8 小时）", async () => {
  const id = await session(60_000, 15 * 60_000, false);
  const res = await asPlatform((c) => c.query("update platform_sessions set mfa_verified_at = now(), mfa_method = 'totp', expires_at = created_at + interval '8 hours' where id = $1", [id]));
  assert.equal(res.rowCount, 1);
});

test("已验证的会话：改回待验证、再验证一次、只改过期时间，都被触发器拒绝", async () => {
  const id = await session(60_000, 8 * 3_600_000, true);
  for (const sql of [
    "update platform_sessions set mfa_verified_at = null, mfa_method = null where id = $1",
    "update platform_sessions set mfa_verified_at = now(), mfa_method = 'recovery_code' where id = $1",
    "update platform_sessions set expires_at = created_at + interval '7 hours' where id = $1",
  ]) {
    await assert.rejects(asPlatform((c) => c.query(sql, [id])), rejectedByTrigger, sql);
  }
});

// 纵深防御（迁移 0041）：验证时间必须在待验证会话的有效期里，15 分钟早过了的待验证会话不能被一条 update 复活成 8 小时的正常会话
// （应用代码里的 `expires_at > now` 条件漏掉时数据库兜底）。
test("已经过期的待验证会话不能被「验证」复活成正常会话", async () => {
  const id = await session(60 * 60_000, 15 * 60_000, false);
  await assert.rejects(
    asPlatform((c) => c.query("update platform_sessions set mfa_verified_at = now(), mfa_method = 'totp', expires_at = created_at + interval '8 hours' where id = $1", [id])),
    rejectedByTrigger,
    "过期 45 分钟的待验证会话被改成了正常会话",
  );
});

test("内置角色：平台角色同样改不了、删不了，也插不进新的内置角色", async () => {
  for (const sql of [
    "update platform_roles set name = '超级管理员2' where key = 'super_admin'",
    "update platform_roles set builtin = false where key = 'readonly'",
    "delete from platform_roles where key = 'finance'",
    "insert into platform_roles (key, name, builtin, sort_order) values ('owner', '老板', true, 99)",
  ]) {
    await assert.rejects(asPlatform((c) => c.query(sql)), rejectedByTrigger, sql);
  }
});
