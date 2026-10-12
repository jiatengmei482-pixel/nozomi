/**
 * /health 在数据库出故障时的表现：查询挂起、数据库宕机后恢复、大量并发、连接悄无声息地失效。
 * 用测试专用的 TCP 转发器夹在连接池和真实 PostgreSQL 之间制造故障（见 testing/tcp-proxy.ts）。
 */
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.ts";
import { type Pool, createPool } from "./db/pool.ts";
import { type TestDatabase, createTestDatabase } from "./testing/db.ts";
import { leakedSecrets, testConfig } from "./testing/fixtures.ts";
import { sleep, waitUntil } from "./testing/process.ts";
import { type TcpProxy, databaseTarget, startTcpProxy } from "./testing/tcp-proxy.ts";

const HEALTH_TIMEOUT_MS = 500;
const POOL_MAX = 10;

let db: TestDatabase;
let proxy: TcpProxy;
let pool: Pool;
let app: FastifyInstance;

beforeEach(async () => {
  db = await createTestDatabase();
  proxy = await startTcpProxy(databaseTarget(db.url));
  const url = proxy.rewrite(db.url);
  pool = createPool(url, { max: POOL_MAX, connectionTimeoutMs: 2_000 });
  app = buildApp({
    config: testConfig(url),
    pool,
    migrationFiles: [],
    logger: false,
    healthTimeoutMs: HEALTH_TIMEOUT_MS,
  });
});

afterEach(async () => {
  await app.close();
  // 先关转发器：掐断所有连接，卡在途中的查询才会结束，连接池才关得掉
  await proxy.close();
  await pool.end();
  await db.drop();
});

interface Probe {
  statusCode: number;
  elapsedMs: number;
  text: string;
  body: { status: string; database: { state: string; latencyMs: number | null; errorCode: string | null }; migrations: { state: string } };
}

async function probe(): Promise<Probe> {
  const startedAt = performance.now();
  const res = await app.inject({ method: "GET", url: "/health" });
  return { statusCode: res.statusCode, elapsedMs: performance.now() - startedAt, text: res.body, body: res.json() };
}

/** 并发探测 n 次，让连接池建满连接。 */
async function probeConcurrently(n: number): Promise<Probe[]> {
  return Promise.all(Array.from({ length: n }, () => probe()));
}

test("数据库查询挂起（连接已建立）：在超时时间左右返回 503 DB_TIMEOUT，而不是一直卡住", async () => {
  assert.equal((await probe()).statusCode, 200);
  proxy.stall();
  const result = await probe();
  assert.equal(result.statusCode, 503);
  assert.deepEqual(result.body.database, { state: "down", latencyMs: null, errorCode: "DB_TIMEOUT" });
  assert.equal(result.body.migrations.state, "unknown");
  assert.ok(result.elapsedMs >= HEALTH_TIMEOUT_MS - 50, `返回得太早：${result.elapsedMs}ms`);
  assert.ok(result.elapsedMs < HEALTH_TIMEOUT_MS + 1_500, `返回得太晚：${result.elapsedMs}ms`);
  assert.deepEqual(leakedSecrets(result.text), []);
});

test("数据库在建立连接阶段就挂起（连接池是空的）：同样在超时时间左右返回 503 DB_TIMEOUT", async () => {
  proxy.stall();
  const result = await probe();
  assert.equal(result.statusCode, 503);
  assert.equal(result.body.database.errorCode, "DB_TIMEOUT");
  assert.ok(result.elapsedMs >= HEALTH_TIMEOUT_MS - 50, `返回得太早：${result.elapsedMs}ms`);
  assert.ok(result.elapsedMs < HEALTH_TIMEOUT_MS + 1_500, `返回得太晚：${result.elapsedMs}ms`);
});

test("数据库挂起后恢复：之后的 /health 回到 200，挂起期间占用的连接全部归还", async () => {
  assert.equal((await probe()).statusCode, 200);
  proxy.stall();
  assert.equal((await probe()).statusCode, 503);
  assert.equal((await probe()).statusCode, 503);
  proxy.resume();
  assert.ok(await waitUntil(() => pool.idleCount === pool.totalCount, 3_000), "挂起期间的连接没有归还");
  const result = await probe();
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.database.state, "up");
});

test("数据库宕机（连接全部被掐断）：503 DB_UNREACHABLE；恢复后自动重连，回到 200", async () => {
  assert.equal((await probeConcurrently(20)).filter((r) => r.statusCode !== 200).length, 0);
  proxy.down();
  await sleep(100);
  const down = await probe();
  assert.equal(down.statusCode, 503);
  assert.deepEqual(down.body.database, { state: "down", latencyMs: null, errorCode: "DB_UNREACHABLE" });
  assert.ok(down.elapsedMs < HEALTH_TIMEOUT_MS + 1_500, `返回得太晚：${down.elapsedMs}ms`);
  assert.deepEqual(leakedSecrets(down.text), []);

  proxy.up();
  const recovered = await probe();
  assert.equal(recovered.statusCode, 200);
  assert.equal(recovered.body.status, "ok");
});

test("300 个并发请求：全部 200，连接数不超过连接池上限，结束后没有排队和占用", async () => {
  const noTimeoutApp = buildApp({
    config: testConfig(proxy.rewrite(db.url)),
    pool,
    migrationFiles: [],
    logger: false,
    healthTimeoutMs: 20_000,
  });
  try {
    const results = await Promise.all(
      Array.from({ length: 300 }, () => noTimeoutApp.inject({ method: "GET", url: "/health" })),
    );
    const notOk = results.filter((r) => r.statusCode !== 200);
    assert.equal(notOk.length, 0, `有 ${notOk.length} 个请求不是 200，例如：${notOk[0]?.body.slice(0, 200)}`);
    assert.ok(pool.totalCount <= POOL_MAX, `连接数 ${pool.totalCount} 超过上限 ${POOL_MAX}`);
    assert.ok(proxy.openConnections() <= POOL_MAX, `实际连接数 ${proxy.openConnections()} 超过上限 ${POOL_MAX}`);
    assert.equal(pool.waitingCount, 0);
    assert.equal(pool.idleCount, pool.totalCount, "有连接没有归还");
  } finally {
    await noTimeoutApp.close();
  }
});

test("连接悄无声息地失效（网络中断，对端不再有任何应答）后数据库恢复：/health 应在几秒内回到 200", async () => {
  // 先让连接池建满连接，模拟有流量的服务
  await probeConcurrently(50);
  assert.equal(pool.totalCount, POOL_MAX);
  // 网络中断：现有连接全部变成黑洞（发出去的查询永远没有应答，连接也不会报错断开）
  proxy.blackholeExisting();
  const during = await probeConcurrently(POOL_MAX);
  assert.deepEqual([...new Set(during.map((r) => r.body.database.errorCode))], ["DB_TIMEOUT"]);
  // 此时数据库其实已经恢复：新建的连接完全正常。服务应当丢弃失效的连接并自行恢复。
  let last: Probe | undefined;
  const recovered = await waitUntil(
    async () => {
      last = await probe();
      return last.statusCode === 200;
    },
    6_000,
    250,
  );
  assert.ok(
    recovered,
    `数据库恢复 6 秒后 /health 仍是 ${last?.statusCode} ${last?.body.database.errorCode}；` +
      `连接池：共 ${pool.totalCount} 个连接，空闲 ${pool.idleCount}，排队 ${pool.waitingCount}`,
  );
});
