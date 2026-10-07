import { test } from "node:test";
import assert from "node:assert/strict";
import type { Pool } from "./db/pool.ts";
import { DB_ROLES } from "./db/roles.ts";
import { TimeoutError, checkHealth, withTimeout } from "./health.ts";
import { leakedSecrets, testConfig } from "./testing/fixtures.ts";

/** 只实现 query 的连接池替身。 */
function stubPool(query: () => Promise<unknown>): Pool {
  return { query } as unknown as Pool;
}

/** 数据库探测那条查询的应答：一个合格的（最小权限的）应用账号。 */
const LEAST_PRIVILEGE_ACCOUNT = {
  rows: [
    {
      login: "nozomi_api",
      superuser: false,
      create_role: false,
      create_db: false,
      bypass_rls: false,
      replication: false,
      member_of: [...DB_ROLES],
      inherits: [],
      can_set_role_to: [...DB_ROLES],
      owned_relations: 0,
      owns_database: false,
      unsafe_roles: [],
    },
  ],
};

/** 迁移探测要从连接池取一条连接开事务：这个替身的连接上每条语句都交给 `query` 处理。 */
function stubPoolWithConnection(query: (input: unknown) => Promise<unknown>): Pool {
  const client = { query, on: () => client, off: () => client, release: () => undefined };
  return { query, connect: () => Promise.resolve(client) } as unknown as Pool;
}

test("withTimeout：按时完成返回结果", async () => {
  assert.equal(await withTimeout(Promise.resolve("ok"), 50), "ok");
});

test("withTimeout：超时抛 TimeoutError", async () => {
  await assert.rejects(withTimeout(new Promise(() => {}), 10), TimeoutError);
});

test("withTimeout：原操作失败时原样抛出", async () => {
  await assert.rejects(withTimeout(Promise.reject(new Error("boom")), 50), /boom/);
});

test("withTimeout：超时之后原操作才失败，不会产生未处理的异常", async () => {
  let fail: (err: Error) => void = () => {};
  const late = new Promise<never>((_, reject) => {
    fail = reject;
  });
  await assert.rejects(withTimeout(late, 5), TimeoutError);
  fail(new Error("late failure"));
  await new Promise((resolve) => setImmediate(resolve));
});

test("数据库查询一直不返回：degraded + DB_TIMEOUT，迁移状态未知", async () => {
  const report = await checkHealth({
    config: testConfig(),
    pool: stubPool(() => new Promise(() => {})),
    migrationFiles: [],
    timeoutMs: 20,
  });
  assert.equal(report.status, "degraded");
  assert.deepEqual(report.database, { state: "down", latencyMs: null, errorCode: "DB_TIMEOUT" });
  assert.deepEqual(report.migrations, { state: "unknown", applied: null, pending: null, errorCode: null });
});

test("数据库查询报错：degraded + DB_UNREACHABLE，不透出驱动的原始报错", async () => {
  const report = await checkHealth({
    config: testConfig(),
    pool: stubPool(() => Promise.reject(new Error("password authentication failed for user app"))),
    migrationFiles: [],
    timeoutMs: 20,
  });
  assert.equal(report.database.errorCode, "DB_UNREACHABLE");
  assert.ok(!JSON.stringify(report).includes("authentication"));
});

test("数据库故障时仍给出集成状态（只有已配置 / 未配置，没有 detail）", async () => {
  const report = await checkHealth({
    config: testConfig(),
    pool: stubPool(() => Promise.reject(new Error("down"))),
    migrationFiles: [],
    timeoutMs: 20,
  });
  assert.deepEqual(report.integrations.map((i) => i.key), ["database", "auth", "stripe", "googleMaps", "fx"]);
  for (const item of report.integrations) assert.deepEqual(Object.keys(item), ["key", "label", "state"]);
  assert.deepEqual(leakedSecrets(JSON.stringify(report)), []);
  assert.equal(report.env, "ci");
});

test("整个健康检查共用一个时限：数据库探测用掉大半后，迁移探测只剩余下的时间，总耗时不超过时限太多", async () => {
  let calls = 0;
  const pool = stubPoolWithConnection(() => {
    calls++;
    if (calls === 1) return new Promise((resolve) => setTimeout(() => resolve(LEAST_PRIVILEGE_ACCOUNT), 120));
    return new Promise(() => {});
  });
  const startedAt = performance.now();
  const report = await checkHealth({ config: testConfig(), pool, migrationFiles: [], timeoutMs: 200 });
  const elapsedMs = performance.now() - startedAt;
  assert.equal(report.database.state, "up");
  assert.equal(report.migrations.state, "unknown");
  assert.equal(report.status, "degraded");
  assert.ok(elapsedMs < 300, `总耗时 ${Math.round(elapsedMs)}ms，接近两倍时限`);
});

test("探测用的每个查询都带客户端时限，且不超过健康检查的时限", async () => {
  const seen: unknown[] = [];
  const pool = stubPoolWithConnection((input) => {
    seen.push(input);
    const text = (input as { text?: string }).text ?? "";
    return Promise.resolve(text.includes("session_user") ? LEAST_PRIVILEGE_ACCOUNT : { rows: [{ exists: false }] });
  });
  const report = await checkHealth({ config: testConfig(), pool, migrationFiles: [], timeoutMs: 400 });
  assert.equal(report.status, "ok");
  // 数据库探测 1 条；迁移探测在登录前事务里：这条连接的账号自检、begin、切换角色、查迁移记录表、commit
  const statements = seen.map((input) => ((input as { text?: string }).text ?? "").trim().split(/\s+/).slice(0, 2).join(" "));
  assert.equal(statements.length, 6, statements.join(" | "));
  assert.deepEqual(statements.slice(2, 4), ["begin", "set local"]);
  assert.equal(statements[5], "commit");
  assert.equal((seen[3] as { text: string }).text, "set local role nozomi_preauth");
  for (const input of seen) {
    const timeout = (input as { query_timeout?: number }).query_timeout;
    assert.ok(typeof timeout === "number" && timeout >= 1 && timeout <= 400, `query_timeout = ${timeout}`);
  }
});

test("驱动自己报的超时（等应答超时、建连接超时）也归为 DB_TIMEOUT", async () => {
  for (const message of ["Query read timeout", "timeout exceeded when trying to connect"]) {
    const report = await checkHealth({
      config: testConfig(),
      pool: stubPool(() => Promise.reject(new Error(message))),
      migrationFiles: [],
      timeoutMs: 200,
    });
    assert.equal(report.database.errorCode, "DB_TIMEOUT", message);
  }
});

test("连得上但账号不是最小权限（例如把迁移账号配给了服务进程）：degraded + DB_ROLE_UNSAFE，不去读迁移记录", async () => {
  let calls = 0;
  const superuser = { rows: [{ ...LEAST_PRIVILEGE_ACCOUNT.rows[0], login: "nozomi", superuser: true }] };
  const report = await checkHealth({
    config: testConfig(),
    pool: stubPool(() => {
      calls++;
      return Promise.resolve(superuser);
    }),
    migrationFiles: [],
    timeoutMs: 200,
  });
  assert.equal(report.status, "degraded");
  assert.deepEqual(report.database, { state: "down", latencyMs: null, errorCode: "DB_ROLE_UNSAFE" });
  assert.equal(report.migrations.state, "unknown");
  assert.equal(calls, 1);
  assert.ok(!JSON.stringify(report).includes("nozomi\""), "响应里不应当出现账号名");
});
